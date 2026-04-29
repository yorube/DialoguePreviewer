// translation-ui.js
// 翻譯編輯模式：上傳 CSV/xlsx → 預覽即時切換 → 站內 inline 編輯 → 下載同格式
//
// 整合到既有 DialoguePreviewer 的方式：
//   - ui.js 暴露 hooks（在 init 時呼叫 install）；本檔不直接讀 ui.js 的 state
//   - 譯文存在 TranslationState（每 locale 一份），自動 localStorage persist
//   - 所有顯示字串走 i18n（hooks.t），DOM 新增後 hooks.applyI18n 會自動翻譯
//
// 全域依賴：YarnConverter / LocParser / LocWriter / TranslationState
//          XLSX (SheetJS)、JSZip

(function (global) {
    'use strict';

    const STATE = {
        states: new Map(),               // locale → TranslationState
        guids: null,                     // filename → guid
        characterKeys: null,             // en-US name → Key
        characterTranslations: null,     // Key → { locale → name }
        ready: false,
        translationMode: false,
        hooks: null,
    };

    let loadingPromise = null;

    function t(key, params) {
        if (STATE.hooks && STATE.hooks.t) return STATE.hooks.t(key, params);
        return key;
    }

    function refreshI18n() {
        if (STATE.hooks && STATE.hooks.applyI18n) STATE.hooks.applyI18n();
    }

    /** 由 ui.js 在 init 時呼叫 */
    function install(hooks) {
        STATE.hooks = hooks;
        injectStyles();
        injectToolbar();
        ensureLoaded();
        // 初始 stats 顯示
        updateStats();
    }

    async function ensureLoaded() {
        if (STATE.ready) return;
        if (loadingPromise) return loadingPromise;
        loadingPromise = (async () => {
            try { STATE.guids = await fetchJson('data/guids.json'); }
            catch (e) { console.warn('[translation-ui] guids.json missing:', e.message); STATE.guids = {}; }
            try { STATE.characterKeys = await fetchJson('data/character-keys.json'); }
            catch (e) { STATE.characterKeys = {}; }
            try { STATE.characterTranslations = await fetchJson('data/character-translations.json'); }
            catch (e) { STATE.characterTranslations = {}; }
            STATE.ready = true;
            updateStats();
        })();
        return loadingPromise;
    }

    async function fetchJson(url) {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`fetch ${url} failed: HTTP ${r.status}`);
        return await r.json();
    }

    // ----- UI 注入 -----

    function injectStyles() {
        const css = `
        .ctrl.t-ctrl {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            background: rgba(120, 180, 255, 0.10);
            border: 1px solid rgba(120, 180, 255, 0.30);
            border-radius: 4px;
            cursor: pointer;
            user-select: none;
            font-size: 13px;
            color: var(--fg);
        }
        .ctrl.t-ctrl:hover { background: rgba(120, 180, 255, 0.22); }
        .ctrl.t-ctrl.danger { background: rgba(220, 120, 120, 0.10); border-color: rgba(220, 120, 120, 0.35); }
        .ctrl.t-ctrl.danger:hover { background: rgba(220, 120, 120, 0.22); }
        .ctrl.t-ctrl.active {
            background: rgba(80, 180, 100, 0.25);
            border-color: rgba(80, 180, 100, 0.7);
        }
        input[type="file"].t-file { display: none; }
        .t-stats {
            font-size: 11px;
            color: var(--fg-dim);
            font-family: ui-monospace, "Cascadia Code", monospace;
            white-space: nowrap;
            align-self: center;
        }
        .t-stats .stat-good { color: #88e088; }
        .t-stats .stat-warn { color: #e0c060; }

        .row-line.t-untranslated .text,
        .row-choice.t-untranslated .choice-text {
            opacity: 0.55;
            font-style: italic;
        }
        .row-line.t-overridden .text,
        .row-choice.t-overridden .choice-text {
            border-left: 2px solid #88c8ff;
            padding-left: 4px;
        }
        .row-line .t-edit-btn,
        .row-choice .t-edit-btn {
            margin-left: 6px;
            padding: 0 4px;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 3px;
            cursor: pointer;
            opacity: 0.4;
            color: inherit;
            font-size: 12px;
        }
        .row-line:hover .t-edit-btn,
        .row-choice:hover .t-edit-btn { opacity: 1; }
        .row-line .t-edit-btn:hover,
        .row-choice .t-edit-btn:hover { background: rgba(255,255,255,0.08); border-color: #555; }
        /* Choice wrapper: keep button + ✏️ + editor on the same flow. */
        .row-choice { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px; margin: 2px 0; }
        .row-choice .choice-btn { flex: 1 1 auto; }
        .row-choice .t-inline-editor { flex-basis: 100%; margin-left: 0; }

        /* Flat edit view — entire node expanded. Hidden by default; shown only
           when body.t-edit-mode is on (set by ui.js). Transcript is hidden then. */
        .flat-edit-view { display: none; padding: 8px 12px; overflow: auto; flex: 1; min-height: 0; }
        body.t-edit-mode #transcript { display: none !important; }
        body.t-edit-mode .flat-edit-view { display: block; }
        .flat-node-title {
            font-size: 13px;
            font-weight: 600;
            opacity: 0.7;
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .flat-edit-view .row-line.flat-row,
        .flat-edit-view .row-choice.flat-row { margin: 4px 0; padding: 2px 0; }
        .flat-edit-view .row-choice.flat-row { background: rgba(120, 180, 255, 0.04); border-left: 2px solid rgba(120, 180, 255, 0.4); padding-left: 6px; }
        .flat-edit-view .row-choice .choice-num { color: #88c8ff; font-weight: 600; margin-right: 4px; }
        .flat-cond { opacity: 0.55; font-size: 11px; font-family: ui-monospace, monospace; margin-left: 6px; }
        .flat-branch {
            font-family: ui-monospace, "Cascadia Code", monospace;
            font-size: 11px;
            color: #c8a878;
            margin: 6px 0 2px;
            opacity: 0.85;
        }
        .flat-branch-end { opacity: 0.5; }
        .flat-meta {
            font-family: ui-monospace, "Cascadia Code", monospace;
            font-size: 11px;
            color: var(--fg-dim, #888);
            opacity: 0.6;
            margin: 2px 0;
        }
        .flat-label { color: #88e088; opacity: 0.8; }
        .flat-body { padding-left: 16px; border-left: 1px dashed rgba(255,255,255,0.08); margin-left: 4px; }
        /* In flat view, ✏️ is the primary action — keep it visible without hover. */
        .flat-edit-view .t-edit-btn { opacity: 0.7; }
        .flat-edit-view .row-line:hover .t-edit-btn,
        .flat-edit-view .row-choice:hover .t-edit-btn { opacity: 1; }

        .t-inline-editor {
            display: flex;
            gap: 4px;
            margin-top: 4px;
            margin-left: calc(1em + 4px);
        }
        .t-inline-editor textarea {
            flex: 1;
            min-height: 2em;
            font: inherit;
            background: rgba(0,0,0,0.3);
            color: inherit;
            border: 1px solid #88c8ff;
            border-radius: 3px;
            padding: 2px 4px;
            resize: vertical;
        }
        .t-inline-editor .actions { display: flex; flex-direction: column; gap: 2px; }
        .t-inline-editor button {
            padding: 1px 6px;
            background: transparent;
            border: 1px solid #555;
            border-radius: 3px;
            color: inherit;
            cursor: pointer;
            font-size: 11px;
        }
        .t-inline-editor button.confirm { border-color: #6c6; }
        .t-inline-editor button.cancel  { border-color: #c66; }
        `;
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }

    function injectToolbar() {
        // 第二行 topbar：Upload / Download / Reset / stats
        const ops = document.getElementById('topbar-globalops');
        if (ops) {
            // Upload (file label)
            const uploadLabel = document.createElement('label');
            uploadLabel.className = 'ctrl t-ctrl';
            uploadLabel.dataset.i18nTitle = 'tr.upload.tip';
            const uploadText = document.createElement('span');
            uploadText.dataset.i18n = 'tr.upload';
            uploadText.textContent = '📥 Upload translation file';
            const uploadInput = document.createElement('input');
            uploadInput.type = 'file';
            uploadInput.id = 't-upload-input';
            uploadInput.accept = '.csv,.xlsx,.xls';
            uploadInput.className = 't-file';
            uploadInput.addEventListener('change', onUpload);
            uploadLabel.appendChild(uploadText);
            uploadLabel.appendChild(uploadInput);
            ops.appendChild(uploadLabel);

            // Download
            const dlBtn = document.createElement('button');
            dlBtn.id = 't-download-loc';
            dlBtn.className = 'ctrl t-ctrl';
            dlBtn.type = 'button';
            dlBtn.dataset.i18n = 'tr.download';
            dlBtn.dataset.i18nTitle = 'tr.download.tip';
            dlBtn.textContent = '💾 Download translation file';
            dlBtn.addEventListener('click', onDownloadLocFile);
            ops.appendChild(dlBtn);

            // Reset
            const rstBtn = document.createElement('button');
            rstBtn.id = 't-reset';
            rstBtn.className = 'ctrl t-ctrl danger';
            rstBtn.type = 'button';
            rstBtn.dataset.i18n = 'tr.reset';
            rstBtn.dataset.i18nTitle = 'tr.reset.tip';
            rstBtn.textContent = '🔁 Reset this language';
            rstBtn.addEventListener('click', onResetLocale);
            ops.appendChild(rstBtn);

            // Stats（右側）
            const stats = document.createElement('span');
            stats.id = 't-stats';
            stats.className = 't-stats';
            ops.appendChild(stats);
        }

        // 對話介面最上方：Edit Mode toggle
        const modebar = document.getElementById('dialogue-modebar');
        if (modebar) {
            const toggle = document.createElement('button');
            toggle.id = 't-mode-toggle';
            toggle.className = 'ctrl t-ctrl';
            toggle.type = 'button';
            toggle.dataset.i18n = 'tr.editMode';
            toggle.dataset.i18nTitle = 'tr.editMode.tip';
            toggle.textContent = '✏️ Translation Edit Mode';
            toggle.addEventListener('click', toggleMode);
            modebar.appendChild(toggle);
        }
    }

    function toggleMode() {
        STATE.translationMode = !STATE.translationMode;
        const toggle = document.getElementById('t-mode-toggle');
        if (toggle) toggle.classList.toggle('active', STATE.translationMode);
        if (STATE.translationMode) ensureLoaded();
        updateStats();
        if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    }

    function getOrCreateState(locale) {
        if (!locale) return null;
        if (!STATE.states.has(locale)) {
            STATE.states.set(locale, TranslationState.createState(locale));
        }
        return STATE.states.get(locale);
    }

    function isSourceLocale(locale) {
        return locale === 'zh-TW' || locale === 'en-US' || locale === 'unknown';
    }

    // ----- Upload -----

    async function onUpload(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;

        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) { alert(t('tr.alert.pickLocale')); return; }
        if (isSourceLocale(activeLocale)) {
            alert(t('tr.alert.sourceLocale', { locale: activeLocale }));
            return;
        }

        const ts = getOrCreateState(activeLocale);
        const before = ts.stats();
        if (before.baselineCount > 0 || before.overrideCount > 0) {
            const overrideWarn = before.overrideCount > 0
                ? t('tr.confirm.replaceOverrideWarn', { o: before.overrideCount, locale: activeLocale })
                : '';
            const msg = t('tr.confirm.replace', {
                locale: activeLocale,
                b: before.baselineCount,
                o: before.overrideCount,
            }) + overrideWarn;
            if (!confirm(msg)) return;
        }

        let parsed;
        try {
            parsed = await LocParser.parseFile(file, activeLocale);
        } catch (err) {
            alert(t('tr.alert.parseFailed', { msg: err.message }));
            return;
        }

        if (parsed.stats.locale && parsed.stats.locale !== activeLocale) {
            const proceed = confirm(t('tr.confirm.localeMismatch', {
                got:  parsed.stats.locale,
                want: activeLocale,
            }));
            if (!proceed) return;
        }

        ts.replaceBaseline(parsed.translations, {
            fileName: parsed.stats.sourceFile,
            importedAt: new Date().toISOString(),
            totalRows: parsed.stats.totalRows,
            withTranslation: parsed.stats.withTranslation,
        }, { source: parsed.source }); // 預設清掉 overrides（完全替代語意）

        if (parsed.warnings.length) {
            console.warn('[translation-ui] upload warnings:', parsed.warnings);
        }
        const head = parsed.warnings.slice(0, 5).join('\n  ');
        const more = parsed.warnings.length > 5
            ? t('tr.alert.warningsMore', { n: parsed.warnings.length - 5 })
            : '';
        const warningSummary = parsed.warnings.length
            ? t('tr.alert.warnings', { head }) + more
            : '';
        alert(t('tr.alert.loaded', {
            locale: activeLocale,
            file: parsed.stats.sourceFile,
            total: parsed.stats.totalRows,
            translated: parsed.stats.withTranslation,
            missing: parsed.stats.missingUid,
        }) + warningSummary);

        updateStats();
        if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    }

    // ----- Reset -----

    function onResetLocale() {
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) { alert(t('tr.alert.pickLocale')); return; }
        if (isSourceLocale(activeLocale)) {
            alert(t('tr.alert.sourceLocale', { locale: activeLocale }));
            return;
        }
        const ts = STATE.states.get(activeLocale);
        const s = ts ? ts.stats() : { baselineCount: 0, overrideCount: 0 };
        if (s.baselineCount === 0 && s.overrideCount === 0) {
            alert(t('tr.alert.resetEmpty', { locale: activeLocale }));
            return;
        }
        const proceed = confirm(t('tr.confirm.reset', {
            locale: activeLocale,
            b: s.baselineCount,
            o: s.overrideCount,
        }));
        if (!proceed) return;
        if (ts) ts.reset();
        updateStats();
        if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    }

    // ----- Stats display -----

    function updateStats() {
        const el = document.getElementById('t-stats');
        if (!el) return;
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) {
            el.textContent = t('tr.stats.noLocale');
            return;
        }
        const ts = STATE.states.get(activeLocale);
        if (!ts) {
            el.textContent = t('tr.stats.notLoaded', { locale: activeLocale });
            return;
        }
        const s = ts.stats();
        el.innerHTML = '';
        const main = document.createElement('span');
        main.textContent = t('tr.stats.loaded', {
            locale: activeLocale,
            b: s.baselineCount,
            o: s.overrideCount,
        });
        el.appendChild(main);
        if (s.sourceMeta && s.sourceMeta.fileName) {
            const file = document.createElement('span');
            file.style.opacity = '0.6';
            file.textContent = t('tr.stats.loadedFile', { file: s.sourceMeta.fileName });
            el.appendChild(file);
        }
    }

    // ----- Translation lookup（給 transcript 渲染用） -----

    // 上傳的譯文 + 站內編輯永遠都覆蓋顯示（跟 Edit Mode 無關）。
    // Edit Mode 只控制 ✏️ 按鈕 + 視覺裝飾（dim/border）。
    function lookupLine(uid, originalText) {
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) return { text: originalText, status: 'inactive', uid };
        const ts = STATE.states.get(activeLocale);
        if (!ts) return { text: originalText, status: 'untranslated', uid };
        const text = ts.get(uid);
        if (text == null || text === '') {
            return { text: originalText, status: 'untranslated', uid };
        }
        return { text, status: ts.source(uid), uid };
    }

    function decorateLine(rowEl, info, originalText) {
        if (!info || !info.uid) return;
        rowEl.dataset.tUid = info.uid;
        rowEl.dataset.tOriginal = originalText;
        // Edit Mode 才顯示視覺裝飾與 ✏️ 編輯按鈕；非 Edit Mode 只悄悄帶 data 屬性
        if (!STATE.translationMode) return;
        rowEl.classList.add('t-line');
        if (info.status === 'untranslated') rowEl.classList.add('t-untranslated');
        else if (info.status === 'override') rowEl.classList.add('t-overridden');

        const editBtn = document.createElement('button');
        editBtn.className = 't-edit-btn';
        editBtn.type = 'button';
        editBtn.textContent = '✏️';
        editBtn.dataset.i18nTitle = 'tr.editBtn.tip';
        editBtn.title = t('tr.editBtn.tip');
        editBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // 預填當前畫面顯示的文本（已翻就是譯文，沒翻就是英文）
            openInlineEditor(rowEl, info.uid, info.text);
        });
        rowEl.appendChild(editBtn);
    }

    function openInlineEditor(rowEl, uid, currentText) {
        if (rowEl.querySelector('.t-inline-editor')) return;

        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) return;
        const ts = getOrCreateState(activeLocale);

        const editor = document.createElement('div');
        editor.className = 't-inline-editor';
        // 阻止編輯器內任何點擊冒泡到 transcript 觸發 advance
        editor.addEventListener('click', (ev) => ev.stopPropagation());
        editor.addEventListener('mousedown', (ev) => ev.stopPropagation());

        const ta = document.createElement('textarea');
        ta.value = currentText || '';
        ta.rows = Math.min(6, Math.max(1, (currentText || '').split('\n').length));

        const actions = document.createElement('div');
        actions.className = 'actions';
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'confirm';
        ok.dataset.i18n = 'tr.editConfirm';
        ok.textContent = '✓';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'cancel';
        cancel.dataset.i18n = 'tr.editCancel';
        cancel.textContent = '✗';
        actions.appendChild(ok);
        actions.appendChild(cancel);

        editor.appendChild(ta);
        editor.appendChild(actions);
        rowEl.appendChild(editor);
        refreshI18n();
        ta.focus();
        ta.select();

        const close = () => editor.remove();
        cancel.addEventListener('click', close);
        ok.addEventListener('click', () => {
            const newText = ta.value;
            ts.setOverride(uid, newText);
            updateStats();
            close();
            if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
        });
        ta.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); close(); }
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); ok.click(); }
        });
    }

    // ----- Download (CSV/xlsx in same format as upload) -----

    function onDownloadLocFile() {
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) { alert(t('tr.alert.pickLocale')); return; }
        if (isSourceLocale(activeLocale)) {
            alert(t('tr.alert.sourceLocale', { locale: activeLocale }));
            return;
        }
        if (typeof LocWriter === 'undefined') {
            console.error('LocWriter missing');
            return;
        }
        const ts = STATE.states.get(activeLocale);
        // If the user uploaded a file we keep their original format byte-for-byte.
        // Otherwise (inline-edits-only) we synthesize a CSV from the en-US project
        // AST so they can still download their progress.
        let source = ts ? ts.getSource() : null;
        if (!source) {
            source = buildSyntheticSource(activeLocale);
            if (!source) { alert(t('tr.alert.noBaseline')); return; }
        }
        try {
            const merged = ts ? ts.buildMergedMap() : new Map();
            const result = LocWriter.writeLocFile(source, merged, {});
            const blob = result.payload instanceof Blob
                ? result.payload
                : new Blob([result.payload], { type: result.mime });
            downloadBlob(blob, result.filename);
        } catch (e) {
            console.error('[translation-ui] download loc failed:', e);
            alert(t('tr.alert.downloadFailed', { msg: e.message }));
        }
    }

    // Build a CSV source structure from the en-US project AST across every
    // loaded script. Used when the translator has been editing inline without
    // uploading a baseline file.
    function buildSyntheticSource(targetLocale) {
        if (!STATE.hooks || !STATE.hooks.getAllGroups || !STATE.hooks.getEntry) return null;
        if (!STATE.guids) return null;
        const headers = ['UID', 'en-US', targetLocale];
        const rows = [];
        for (const group of STATE.hooks.getAllGroups()) {
            const enEntry = STATE.hooks.getEntry(group, 'en-US');
            if (!enEntry || !enEntry.project) continue;
            const guid = STATE.guids[enEntry.filename];
            if (!guid) continue;
            for (const [, nodeData] of enEntry.project.nodes) {
                collectTranslatableRows(nodeData.statements, guid, nodeData.nodeIndex, rows);
            }
        }
        if (rows.length === 0) return null;
        return {
            format: 'csv',
            fileName: `${targetLocale}_translations.csv`,
            headers,
            rows,
            idCol: 0,
            localeCol: 2,
            csvHasBom: true,
        };
    }

    function collectTranslatableRows(statements, guid, nodeIndex, rows) {
        for (const s of statements) {
            if (s.type === 'line' && s.srcLine != null && s.text) {
                rows.push([`${guid}-${nodeIndex}-${s.srcLine}`, s.text, '']);
            } else if (s.type === 'choices') {
                for (const item of s.items) {
                    if (item.srcLine != null && item.text) {
                        rows.push([`${guid}-${nodeIndex}-${item.srcLine}`, item.text, '']);
                    }
                    if (item.body) collectTranslatableRows(item.body, guid, nodeIndex, rows);
                }
            } else if (s.type === 'if') {
                if (s.then) collectTranslatableRows(s.then, guid, nodeIndex, rows);
                if (s.else) collectTranslatableRows(s.else, guid, nodeIndex, rows);
            }
        }
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ----- 給 ui.js 算 UID -----

    function getUidFor(filename, nodeIndex, srcLine) {
        if (!STATE.guids || !filename) return null;
        const guid = STATE.guids[filename];
        if (!guid) return null;
        return `${guid}-${nodeIndex}-${srcLine}`;
    }

    global.TranslationUI = {
        install,
        lookupLine,
        decorateLine,
        getUidFor,
        notifyLocaleChange: () => updateStats(),
        isActive: () => STATE.translationMode,
    };
})(typeof window !== 'undefined' ? window : globalThis);
