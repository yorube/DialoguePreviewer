// translation-ui.js
// 翻譯 tab：上傳 CSV/xlsx → 預覽即時切換 → 站內編輯 → 下載 zip
//
// 整合到既有 DialoguePreviewer 的方式：
//   - ui.js 暴露 window.YarnPreviewHooks（在它 init 時呼叫此檔的 install）
//   - 此檔只透過 hooks 跟 ui.js 互動，避免互相耦合
//   - 譯文狀態存在 TranslationState（每 locale 一份），自動 localStorage persist
//
// 全域依賴：
//   YarnConverter / LocParser / TranslationState / YarnParser   (我們自己的)
//   XLSX (SheetJS)、JSZip                                       (第三方)

(function (global) {
    'use strict';

    const STATE = {
        // locale → TranslationState 實例
        states: new Map(),
        // filename → guid（從 data/guids.json 載入）
        guids: null,
        // 角色名翻譯表
        characterKeys: null,           // en-US name → key
        characterTranslations: null,   // key → { locale → name }
        // 是否載入完成
        ready: false,
        // 當前是否處於 Translation Mode
        translationMode: false,
        // ui.js 提供的 hooks
        hooks: null,
    };

    // 確保「初次嘗試 lazy load」只觸發一次
    let loadingPromise = null;

    /** 由 ui.js 在 init 時呼叫 */
    function install(hooks) {
        STATE.hooks = hooks;
        injectToolbar();
        injectStyles();
        ensureLoaded(); // 在背景開始載入翻譯對照表
    }

    async function ensureLoaded() {
        if (STATE.ready) return;
        if (loadingPromise) return loadingPromise;
        loadingPromise = (async () => {
            try {
                STATE.guids = await fetchJson('data/guids.json');
            } catch (e) {
                console.warn('[translation-ui] guids.json 沒有，先停用翻譯模式：', e.message);
                STATE.guids = {};
            }
            try {
                STATE.characterKeys = await fetchJson('data/character-keys.json');
            } catch (e) {
                STATE.characterKeys = {};
            }
            try {
                STATE.characterTranslations = await fetchJson('data/character-translations.json');
            } catch (e) {
                STATE.characterTranslations = {};
            }
            STATE.ready = true;
            // 載完之後若已有當前 locale，refresh UI
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
        .translation-toolbar {
            display: none;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            padding: 6px 8px;
            margin-top: 4px;
            background: rgba(120, 180, 255, 0.08);
            border: 1px solid rgba(120, 180, 255, 0.25);
            border-radius: 4px;
            font-size: 12px;
        }
        .translation-toolbar.active { display: flex; }
        .translation-toolbar label.upload-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            background: rgba(120, 180, 255, 0.2);
            border: 1px solid rgba(120, 180, 255, 0.5);
            border-radius: 3px;
            cursor: pointer;
            user-select: none;
        }
        .translation-toolbar label.upload-btn:hover { background: rgba(120, 180, 255, 0.35); }
        .translation-toolbar input[type="file"] { display: none; }
        .translation-toolbar .stats { color: #aaa; font-family: monospace; }
        .translation-toolbar .stats .stat-good { color: #88e088; }
        .translation-toolbar .stats .stat-warn { color: #e0c060; }
        .translation-toolbar .stats .stat-bad  { color: #e08080; }
        .translation-toolbar button {
            padding: 3px 8px;
            background: transparent;
            border: 1px solid #555;
            border-radius: 3px;
            color: inherit;
            cursor: pointer;
        }
        .translation-toolbar button:hover { background: rgba(255,255,255,0.08); }
        .translation-toolbar button.primary {
            background: rgba(80, 180, 100, 0.2);
            border-color: rgba(80, 180, 100, 0.6);
        }
        .translation-toolbar button.primary:hover { background: rgba(80, 180, 100, 0.4); }
        .translation-toolbar button:disabled { opacity: 0.4; cursor: not-allowed; }

        .row-line.t-untranslated .text {
            opacity: 0.55;
            font-style: italic;
        }
        .row-line.t-overridden .text {
            border-left: 2px solid #88c8ff;
            padding-left: 4px;
        }
        .row-line .t-edit-btn {
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
        .row-line:hover .t-edit-btn { opacity: 1; }
        .row-line .t-edit-btn:hover { background: rgba(255,255,255,0.08); border-color: #555; }

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

        .t-mode-toggle.active {
            background: rgba(80, 180, 100, 0.25) !important;
            border-color: rgba(80, 180, 100, 0.7) !important;
        }
        `;
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }

    function injectToolbar() {
        const dialogueToolbar = document.querySelector('.dialogue-toolbar');
        if (!dialogueToolbar) return;

        // Mode toggle button (放在 toolbar 內)
        const toggle = document.createElement('button');
        toggle.id = 't-mode-toggle';
        toggle.className = 'action-btn t-mode-toggle';
        toggle.textContent = '🌐 Translation';
        toggle.title = '切換翻譯模式：上傳譯文 / 站內編輯 / 下載 zip';
        toggle.addEventListener('click', toggleMode);
        dialogueToolbar.appendChild(toggle);

        // Translation sub-toolbar (放在 dialogue-toolbar 之後)
        const tt = document.createElement('div');
        tt.id = 'translation-toolbar';
        tt.className = 'translation-toolbar';
        tt.innerHTML = `
            <label class="upload-btn" title="上傳譯者填好的 .csv 或 .xlsx">
                📥 上傳譯文
                <input type="file" id="t-upload-input" accept=".csv,.xlsx,.xls">
            </label>
            <button id="t-clear-overrides" title="清掉站內編輯，回到上傳的版本">🔄 重設站內編輯</button>
            <button id="t-download-loc" class="primary" title="下載成跟你上傳同格式的譯文檔（含站內編輯）">💾 下載譯文</button>
            <details class="t-advanced" style="margin-left:8px;">
                <summary style="cursor:pointer; opacity:0.7; font-size:11px;">進階</summary>
                <div style="display:flex; gap:6px; padding-top:4px; flex-wrap:wrap;">
                    <button id="t-download-current" title="只下載當前 script 的目標語言 .json (Unity 用)">⬇️ Unity JSON (當前)</button>
                    <button id="t-download-zip" title="下載所有 script 的目標語言 .json zip (Unity 用)">📦 Unity JSON (zip)</button>
                </div>
            </details>
            <span class="stats" id="t-stats">尚未載入翻譯</span>
        `;
        dialogueToolbar.parentNode.insertBefore(tt, dialogueToolbar.nextSibling);

        // Wire events
        document.getElementById('t-upload-input').addEventListener('change', onUpload);
        document.getElementById('t-clear-overrides').addEventListener('click', onClearOverrides);
        document.getElementById('t-download-loc').addEventListener('click', onDownloadLocFile);
        document.getElementById('t-download-current').addEventListener('click', onDownloadCurrent);
        document.getElementById('t-download-zip').addEventListener('click', onDownloadZip);
    }

    function toggleMode() {
        STATE.translationMode = !STATE.translationMode;
        const toggle = document.getElementById('t-mode-toggle');
        const tt     = document.getElementById('translation-toolbar');
        toggle.classList.toggle('active', STATE.translationMode);
        tt.classList.toggle('active', STATE.translationMode);
        if (STATE.translationMode) ensureLoaded();
        updateStats();
        // 重新繪製 transcript
        if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    }

    function getOrCreateState(locale) {
        if (!locale) return null;
        if (!STATE.states.has(locale)) {
            STATE.states.set(locale, TranslationState.createState(locale));
        }
        return STATE.states.get(locale);
    }

    // ----- Upload -----

    async function onUpload(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;

        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale || activeLocale === 'zh-TW' || activeLocale === 'unknown') {
            alert('請先在右上角 Language 切換到要載入的目標語言（例如 fr-FR / ru-RU）。');
            return;
        }

        const ts = getOrCreateState(activeLocale);
        const before = ts.stats();
        if (before.baselineCount > 0 || before.overrideCount > 0) {
            const overrideWarn = before.overrideCount > 0
                ? `\n\n⚠️ 你目前有 ${before.overrideCount} 條站內編輯（含尚未匯入新檔的修改），上傳會把它們「全部清掉」，整個 ${activeLocale} 以新檔為準。\n\n如果你不想丟掉站內編輯：先按 [💾 下載譯文] 把目前狀態存下來，再上傳。`
                : '';
            const proceed = confirm(
                `將要把 ${activeLocale} 的譯文「整個替換」成上傳檔的內容：\n\n` +
                `  目前基準: ${before.baselineCount} 條\n` +
                `  目前站內編輯: ${before.overrideCount} 條` +
                overrideWarn +
                `\n\n要繼續覆寫嗎？`);
            if (!proceed) return;
        }

        let parsed;
        try {
            parsed = await LocParser.parseFile(file, activeLocale);
        } catch (err) {
            alert(`解析失敗：${err.message}`);
            return;
        }

        if (parsed.stats.locale && parsed.stats.locale !== activeLocale) {
            const proceed = confirm(
                `偵測到的翻譯欄位是「${parsed.stats.locale}」，但你目前選的語言是「${activeLocale}」。\n\n` +
                `要把這份檔案套用為 ${activeLocale} 的譯文嗎？(通常表示你選錯語言或檔案標頭錯誤)`);
            if (!proceed) return;
        }

        ts.replaceBaseline(parsed.translations, {
            fileName: parsed.stats.sourceFile,
            importedAt: new Date().toISOString(),
            totalRows: parsed.stats.totalRows,
            withTranslation: parsed.stats.withTranslation,
        }, { source: parsed.source });

        const warningSummary = parsed.warnings.length
            ? `\n\n⚠️ 警告：\n  ${parsed.warnings.slice(0, 5).join('\n  ')}`
              + (parsed.warnings.length > 5 ? `\n  …（再 ${parsed.warnings.length - 5} 條，請看 console）` : '')
            : '';
        if (parsed.warnings.length) {
            console.warn('[translation-ui] upload warnings:', parsed.warnings);
        }

        const tip =
            `已載入 ${activeLocale} 譯文：\n` +
            `  檔案: ${parsed.stats.sourceFile}\n` +
            `  資料列: ${parsed.stats.totalRows}\n` +
            `  含譯文: ${parsed.stats.withTranslation}\n` +
            `  缺 UID: ${parsed.stats.missingUid}` +
            warningSummary;
        alert(tip);

        updateStats();
        if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    }

    function onClearOverrides() {
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) return;
        const ts = getOrCreateState(activeLocale);
        const n = ts.stats().overrideCount;
        if (n === 0) { alert('沒有站內編輯可重設。'); return; }
        if (!confirm(`要清掉 ${n} 條站內編輯嗎？這會回到上傳檔的原始譯文。`)) return;
        ts.clearOverrides();
        updateStats();
        if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    }

    function updateStats() {
        const el = document.getElementById('t-stats');
        if (!el) return;
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) { el.textContent = '尚未選擇語言'; return; }
        const ts = STATE.states.get(activeLocale);
        if (!ts) {
            el.innerHTML = `<span>${activeLocale}: 尚未載入譯文</span>`;
            return;
        }
        const s = ts.stats();
        el.innerHTML =
            `<span>${activeLocale}:</span> ` +
            `<span class="stat-good">基準 ${s.baselineCount}</span> / ` +
            `<span class="stat-warn">站內編輯 ${s.overrideCount}</span>` +
            (s.sourceMeta ? ` <span style="opacity:0.6;">(${s.sourceMeta.fileName})</span>` : '');
    }

    // ----- Translation lookup（給 transcript 渲染用） -----

    /**
     * 取一行對話/選項應該顯示的譯文 + meta。
     * 若沒譯，回傳原文。
     */
    function lookupLine(uid, originalText) {
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!STATE.translationMode || !activeLocale) {
            return { text: originalText, status: 'inactive', uid };
        }
        const ts = STATE.states.get(activeLocale);
        if (!ts) return { text: originalText, status: 'untranslated', uid };
        const text = ts.get(uid);
        if (text == null || text === '') {
            return { text: originalText, status: 'untranslated', uid };
        }
        return { text, status: ts.source(uid), uid };
    }

    /** 公開給 ui.js：對轉譯後的行套樣式 + 加編輯按鈕 */
    function decorateLine(rowEl, info, originalText) {
        if (!STATE.translationMode || !info || !info.uid) return;
        rowEl.classList.add('t-line');
        if (info.status === 'untranslated') rowEl.classList.add('t-untranslated');
        else if (info.status === 'override') rowEl.classList.add('t-overridden');
        rowEl.dataset.tUid = info.uid;
        rowEl.dataset.tOriginal = originalText;

        const editBtn = document.createElement('button');
        editBtn.className = 't-edit-btn';
        editBtn.textContent = '✏️';
        editBtn.title = '編輯這句譯文（預填當前顯示的文本）';
        editBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // 預填當前畫面上顯示的文本：
            //   - 已翻譯 → 預填譯文
            //   - 還沒翻 → 預填英文原文（譯者直接覆蓋翻譯，不用對著空白起手）
            openInlineEditor(rowEl, info.uid, info.text);
        });
        rowEl.appendChild(editBtn);
    }

    function openInlineEditor(rowEl, uid, currentText) {
        // 防止同一行重複開啟
        if (rowEl.querySelector('.t-inline-editor')) return;

        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) return;
        const ts = getOrCreateState(activeLocale);

        const editor = document.createElement('div');
        editor.className = 't-inline-editor';
        const ta = document.createElement('textarea');
        ta.value = currentText || '';
        ta.rows = Math.min(6, Math.max(1, (currentText || '').split('\n').length));

        const actions = document.createElement('div');
        actions.className = 'actions';
        const ok = document.createElement('button');
        ok.className = 'confirm'; ok.textContent = '✓ 存';
        const cancel = document.createElement('button');
        cancel.className = 'cancel'; cancel.textContent = '✗ 取消';
        actions.appendChild(ok);
        actions.appendChild(cancel);
        editor.appendChild(ta);
        editor.appendChild(actions);
        rowEl.appendChild(editor);
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

    // ----- Download: 同格式譯文檔（給譯者用）-----

    function onDownloadLocFile() {
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) { alert('請先選擇目標語言'); return; }
        const ts = STATE.states.get(activeLocale);
        if (!ts) {
            alert('還沒上傳任何譯文檔。請先上傳，編輯完再下載。');
            return;
        }
        const source = ts.getSource();
        if (!source) {
            alert(
                '找不到當初上傳檔案的結構（可能是上次上傳後 localStorage 容量太大被丟掉）。\n' +
                '請重新上傳一次原始 .csv / .xlsx，再下載。');
            return;
        }
        if (typeof LocWriter === 'undefined') {
            alert('LocWriter 未載入'); return;
        }
        try {
            const merged = ts.buildMergedMap();
            const result = LocWriter.writeLocFile(source, merged, {});
            const blob = result.payload instanceof Blob
                ? result.payload
                : new Blob([result.payload], { type: result.mime });
            downloadBlob(blob, result.filename);
        } catch (e) {
            console.error('[translation-ui] download loc failed:', e);
            alert(`產出譯文檔失敗：${e.message}`);
        }
    }

    // ----- Download (Unity-side JSON) -----

    async function onDownloadCurrent() {
        const activeGroup  = STATE.hooks && STATE.hooks.getActiveGroup && STATE.hooks.getActiveGroup();
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeGroup || !activeLocale) { alert('請先選擇 script + 目標語言'); return; }
        if (activeLocale === 'zh-TW' || activeLocale === 'unknown') {
            alert('來源語言（zh-TW）不需要產出譯文。'); return;
        }

        await ensureLoaded();
        const result = await buildOneTarget(activeGroup, activeLocale);
        if (!result) return;
        downloadBlob(new Blob([result.json], { type: 'application/json;charset=utf-8' }), result.filename);
    }

    async function onDownloadZip() {
        const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
        if (!activeLocale) { alert('請先選擇目標語言'); return; }
        if (activeLocale === 'zh-TW' || activeLocale === 'unknown') {
            alert('來源語言（zh-TW）不需要產出譯文。'); return;
        }
        if (typeof JSZip === 'undefined') {
            alert('JSZip 未載入'); return;
        }

        await ensureLoaded();
        const groups = STATE.hooks.getAllGroups ? STATE.hooks.getAllGroups() : [];
        if (!groups.length) { alert('沒有可處理的 script'); return; }

        const ts = STATE.states.get(activeLocale);
        if (!ts || ts.stats().baselineCount + ts.stats().overrideCount === 0) {
            const proceed = confirm(`目前沒載入任何 ${activeLocale} 譯文。產出的 zip 內所有對話會跟英文版一樣。\n\n還是要繼續嗎？`);
            if (!proceed) return;
        }

        const zip = new JSZip();
        const issues = [];
        const setStatus = STATE.hooks.setStatus || (() => {});

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            setStatus(`產出 ${group} (${i + 1}/${groups.length})…`);
            try {
                const result = await buildOneTarget(group, activeLocale);
                if (result) zip.file(result.filename, result.json);
                else issues.push(`${group}: 略過（沒有 en-US 來源）`);
            } catch (e) {
                issues.push(`${group}: ${e.message}`);
                console.error(`[translation-ui] failed for ${group}:`, e);
            }
            // 讓 UI 有機會重繪
            await new Promise(r => setTimeout(r, 0));
        }

        setStatus('打包中…');
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
        downloadBlob(blob, `${activeLocale}_${stamp}.zip`);
        setStatus(`完成 ${groups.length} 個 script` + (issues.length ? `（${issues.length} 個有問題，看 console）` : ''));

        if (issues.length) {
            console.warn('[translation-ui] download issues:', issues);
        }
    }

    /**
     * 產出單一 group + locale 的目標 JSON 字串。
     * 流程：取 en-US source → buildSO → applyTranslations → serializeJson
     */
    async function buildOneTarget(groupName, locale) {
        if (!STATE.hooks || !STATE.hooks.getEntry) {
            throw new Error('缺少 hooks.getEntry');
        }
        const sourceEntry = STATE.hooks.getEntry(groupName, 'en-US');
        if (!sourceEntry) return null; // 沒英文版來源 → 跳過

        // 取 GUID
        const guid = STATE.guids && STATE.guids[sourceEntry.filename];
        if (!guid) {
            throw new Error(`找不到 ${sourceEntry.filename} 的 GUID（data/guids.json 缺項）`);
        }

        // 取 raw JSON array（從已 cache 的 project.rawNodes，或重新 fetch）
        let rawNodes = sourceEntry.project && sourceEntry.project.rawNodes;
        if (!rawNodes) {
            const r = await fetch(sourceEntry.fetchUrl, { cache: 'no-cache' });
            if (!r.ok) throw new Error(`HTTP ${r.status} for ${sourceEntry.fetchUrl}`);
            rawNodes = await r.json();
        }

        const ts = STATE.states.get(locale);
        const merged = ts ? ts.buildMergedMap() : new Map();

        const characterContext = {
            characterKeys:         STATE.characterKeys || {},
            characterTranslations: STATE.characterTranslations || {},
            locale,
        };

        const so = YarnConverter.buildSO(rawNodes, guid, characterContext);
        YarnConverter.applyTranslations(so, merged);
        const jsonText = YarnConverter.serializeJson(so);

        // 檔名：把 (en-US) 換成 (locale)。對於少數沒有 en-US suffix 的，加上 (locale)。
        let outName = sourceEntry.filename.replace(/\(en-US\)/, `(${locale})`);
        if (outName === sourceEntry.filename) {
            outName = sourceEntry.filename.replace(/\.json$/i, `(${locale}).json`);
        }
        return { filename: outName, json: jsonText };
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // 延遲釋放避免某些瀏覽器在 click 還沒 fire 完就把 url 關掉
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ----- Public API for ui.js -----

    function getUidFor(filename, nodeIndex, srcLine) {
        if (!STATE.guids || !filename) return null;
        const guid = STATE.guids[filename];
        if (!guid) return null;
        return `${guid}-${nodeIndex}-${srcLine}`;
    }

    global.TranslationUI = {
        install,
        // ui.js 用這個拿譯文蓋掉 transcript 的 text
        lookupLine,
        // ui.js 在 appendTranscript 後呼叫這個套樣式 + 加編輯鈕
        decorateLine,
        // ui.js 算 UID 時用：filename → guid 對照
        getUidFor,
        // ui.js 在 locale 改變時呼叫，讓 stats 跟 button state 更新
        notifyLocaleChange: () => updateStats(),
        // 是否啟用（給 ui.js 判斷要不要 lookup）
        isActive: () => STATE.translationMode,
    };
})(typeof window !== 'undefined' ? window : globalThis);
