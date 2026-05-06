// translation-ui.js
// 翻譯編輯模式：上傳 CSV/xlsx → 預覽即時切換 → 站內 inline 編輯 → 下載同格式
// 同時管理 review status (needs-review / approved) 的顯示與互動。
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
    progressExpanded: false,         // global progress breakdown disclosure
  };

  let loadingPromise = null;

  // Singleton popup element for the status chip menu (created lazily).
  let statusMenuEl = null;
  // Track outside-click / Esc listeners attached when menu is open so we can
  // detach them on close (avoid leaking a listener per open).
  let statusMenuCleanup = null;

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
    injectToolbar();
    ensureLoaded();
    // 初始 stats 顯示
    loadProgressDisclosurePref();
    updateStats();
    refreshExportStatus();
  }

  function loadProgressDisclosurePref() {
    try {
      STATE.progressExpanded = localStorage.getItem('yp.progressExpanded') === '1';
    } catch (_) { STATE.progressExpanded = false; }
  }

  function setProgressDisclosurePref(expanded) {
    STATE.progressExpanded = !!expanded;
    try { localStorage.setItem('yp.progressExpanded', expanded ? '1' : '0'); } catch (_) {}
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
      try { STATE.speakerGender = await fetchJson('data/speakers.json'); }
      catch (e) { STATE.speakerGender = {}; }
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

  // ----- UI 注入（樣式統一由 style.css 管理） -----

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
      uploadText.textContent = '📥 Import translation file';
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
      dlBtn.textContent = '💾 Export translation file';
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

      // Export-state indicator (✓ saved / ⚠️ unexported edits).
      const expStatus = document.createElement('span');
      expStatus.id = 't-export-status';
      expStatus.className = 't-export-status';
      ops.appendChild(expStatus);
    }

    // 對話介面最上方：Edit Mode toggle + 旁邊的 ? 說明按鈕
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

      // ? — opens a dedicated Edit Mode help modal (separate from the
      // global ? in the top bar). Content is Edit Mode-specific: flat
      // view symbols, the inline editor flow, clickable goto labels —
      // things only relevant once you're already in Edit Mode.
      const help = document.createElement('button');
      help.id = 't-mode-help';
      help.className = 'help-btn t-mode-help';
      help.type = 'button';
      help.textContent = '?';
      help.dataset.i18nTitle = 'tr.editMode.help.tip';
      help.title = '?';
      help.addEventListener('click', openEditModeHelp);
      modebar.appendChild(help);
    }

    // Wire global progress disclosure toggle (chevron in #t-progress).
    // The chevron sits inside index.html's #t-progress block — bind once.
    const discl = document.getElementById('t-prog-toggle');
    if (discl) {
      discl.addEventListener('click', () => {
        setProgressDisclosurePref(!STATE.progressExpanded);
        renderBreakdownVisibility();
      });
    }
  }

  // ----- Dedicated Edit Mode help modal -----

  function openEditModeHelp() {
    let overlay = document.getElementById('t-editmode-help-overlay');
    if (!overlay) overlay = createEditModeHelpModal();
    overlay.hidden = false;
    // Reset scroll so opening always lands at the top.
    const dialog = overlay.querySelector('.help-dialog');
    if (dialog) dialog.scrollTop = 0;
  }

  function createEditModeHelpModal() {
    const overlay = document.createElement('div');
    overlay.id = 't-editmode-help-overlay';
    overlay.className = 'help-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'help-dialog';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'help-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => { overlay.hidden = true; });

    const h2 = document.createElement('h2');
    h2.dataset.i18n = 'tr.editMode.help.title';
    h2.textContent = 'Edit Mode help';

    const body = document.createElement('div');
    body.className = 'help-body';
    body.dataset.i18nHtml = 'tr.editMode.help.body';

    dialog.appendChild(closeBtn);
    dialog.appendChild(h2);
    dialog.appendChild(body);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
    document.body.appendChild(overlay);

    // First-time apply i18n so the dataset attributes resolve.
    refreshI18n();
    return overlay;
  }

  // Esc closes any visible help overlay (this Edit Mode one + the global ?).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('t-editmode-help-overlay');
    if (overlay && !overlay.hidden) overlay.hidden = true;
  });

  function toggleMode() { setMode(!STATE.translationMode); }

  function setMode(on) {
    on = !!on;
    if (STATE.translationMode === on) return;
    STATE.translationMode = on;
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
    if (before.baselineCount > 0 || before.overrideCount > 0 || before.manualStatusCount > 0) {
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

    // Persist baseline FIRST. If localStorage is exhausted (quota), we
    // need to know before touching anything else — refusing the import
    // is safer than half-saving and surprising the translator with a
    // post-refresh rollback.
    const persistResult = ts.replaceBaseline(parsed.translations, {
      fileName: parsed.stats.sourceFile,
      importedAt: new Date().toISOString(),
      totalRows: parsed.stats.totalRows,
      withTranslation: parsed.stats.withTranslation,
    }, { source: parsed.source });

    if (persistResult !== 'ok') {
      // Persist refused (browser localStorage is full from other apps,
      // or this locale's translation map alone exceeds the quota).
      // baseline lives only in memory — refresh will lose it. Don't
      // touch notes either; we don't want notes outliving the
      // translations they belonged to across a refresh.
      alert(t('tr.alert.persistFailed', {
        locale: activeLocale,
        file: parsed.stats.sourceFile,
      }));
      try { updateStats(); } catch (e) { console.error('[updateStats]', e); }
      try { if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw(); }
      catch (e) { console.error('[requestRedraw]', e); }
      return;
    }

    // ReviewStatus restore happens after baseline is persisted (same reason
    // as notes: don't outlive translations across refresh). replaceBaseline
    // already cleared manualStatus so we just write the new map.
    let statusesRestored = 0;
    if (parsed.statuses && parsed.statuses.size > 0) {
      ts.bulkSetStatus(parsed.statuses);
      statusesRestored = parsed.statuses.size;
    }

    // Notes restore happens only after baseline is durably persisted —
    // avoids the "notes saved but translations vanished on refresh" bug.
    let notesRestored = 0;
    try {
      notesRestored = TranslationExport.restoreNotesFromSource(parsed.source, exportCtx());
    } catch (e) {
      console.error('[translation-ui] note restore failed:', e);
    }

    if (STATE.hooks && STATE.hooks.markExported) STATE.hooks.markExported();

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
    const notesLine = notesRestored
      ? t('tr.alert.notesRestored', { n: notesRestored })
      : '';
    const statusLine = statusesRestored
      ? t('tr.alert.statusesRestored', { n: statusesRestored })
      : '';
    alert(t('tr.alert.loaded', {
      locale: activeLocale,
      file: parsed.stats.sourceFile,
      total: parsed.stats.totalRows,
      translated: parsed.stats.withTranslation,
      missing: parsed.stats.missingUid,
    }) + notesLine + statusLine + warningSummary);

    // Both display-refresh paths are isolated — a thrown updateStats
    // (e.g. en-US not loaded for the active script yet) must not block
    // the transcript from picking up the new translations.
    try { updateStats(); } catch (e) { console.error('[updateStats]', e); }
    try { if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw(); }
    catch (e) { console.error('[requestRedraw]', e); }
  }

  // ----- Reset -----

  function onResetLocale() {
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale) { alert(t('tr.alert.pickLocale')); return; }
    if (isSourceLocale(activeLocale)) {
      alert(t('tr.alert.sourceLocale', { locale: activeLocale }));
      return;
    }
    const ts = getOrCreateState(activeLocale);
    const s = ts ? ts.stats() : { baselineCount: 0, overrideCount: 0, manualStatusCount: 0 };
    if (s.baselineCount === 0 && s.overrideCount === 0 && s.manualStatusCount === 0) {
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

  // ----- Export-state indicator -----

  function formatAgo(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return t('tr.export.ago.lt1m');
    if (m < 60) return t('tr.export.ago.minutes', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('tr.export.ago.hours', { n: h });
    return t('tr.export.ago.days', { n: Math.floor(h / 24) });
  }

  function formatExportDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}/${mo}/${da}`;
  }

  function refreshExportStatus() {
    const el = document.getElementById('t-export-status');
    if (!el) return;
    if (!STATE.hooks || !STATE.hooks.getExportState) {
      el.textContent = '';
      el.className = 't-export-status';
      return;
    }
    const s = STATE.hooks.getExportState() || {};
    if (!s.lastEditAt) {
      // Never edited anything → don't show indicator at all.
      el.textContent = '';
      el.className = 't-export-status';
      return;
    }
    const dirty = !s.lastExportAt
      || new Date(s.lastEditAt).getTime() > new Date(s.lastExportAt).getTime();
    if (dirty) {
      el.className = 't-export-status dirty';
      el.textContent = s.lastExportAt
        ? t('tr.export.dirty', {
          date: formatExportDate(s.lastExportAt),
          ago: formatAgo(Date.now() - new Date(s.lastExportAt).getTime()),
         })
        : t('tr.export.dirtyNever');
    } else {
      el.className = 't-export-status clean';
      el.textContent = t('tr.export.clean', {
        date: formatExportDate(s.lastExportAt),
        ago: formatAgo(Date.now() - new Date(s.lastExportAt).getTime()),
      });
    }
  }

  // Refresh "X minutes ago" copy on a slow timer.
  setInterval(() => {
    try { refreshExportStatus(); } catch (e) {}
  }, 30 * 1000);

  // ----- Stats display + global breakdown -----

  function updateStats() {
    const el = document.getElementById('t-stats');
    if (!el) return;
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    const projUids = STATE.hooks && STATE.hooks.getActiveProjectUids
      ? STATE.hooks.getActiveProjectUids() : null;
    const total = projUids ? projUids.size : 0;

    // Reset progress before any early return so a stale bar doesn't linger
    // when we switch into "no locale" / "not loaded" states.
    const noStats = !activeLocale || !total;
    if (noStats) {
      updateProgress(0, 0, null);
      renderProgressBreakdown(null);
    }

    if (!activeLocale) {
      el.textContent = t('tr.stats.noLocale');
      el.classList.remove('has-untranslated');
      return;
    }
    const ts = getOrCreateState(activeLocale);
    const s = ts ? ts.stats() : null;
    const isSrc = isSourceLocale(activeLocale);

    // Aggregate breakdown across the active project's UID set:
    //   untranslated / baselineTranslated / edited (orthogonal axis)
    //   needsReview / approved              (manual status, orthogonal)
    // baselineTranslated counts both ts.baseline (uploaded CSV) AND the
    // locale's bundled .json text — both are "translated, not edited."
    let done = 0;
    let breakdown = null;
    if (ts && total) {
      breakdown = {
        total,
        untranslated: 0,
        baselineTranslated: 0,
        edited: 0,
        needsReview: 0,
        approved: 0,
      };
      const merged = ts.buildMergedMap();
      const bundleMap = STATE.hooks.getLocaleBundleMap
        ? STATE.hooks.getLocaleBundleMap(activeLocale)
        : new Map();
      for (const uid of projUids) {
        const v = merged.get(uid);
        if (v != null && v !== '') {
          done++;
          if (ts.source(uid) === 'override') breakdown.edited++;
          else breakdown.baselineTranslated++;
        } else {
          const bundle = bundleMap.get(uid);
          if (bundle && bundle !== '') {
            done++;
            breakdown.baselineTranslated++;
          } else {
            breakdown.untranslated++;
          }
        }
        const st = ts.getStatus(uid);
        if (st === 'needs-review') breakdown.needsReview++;
        else if (st === 'approved') breakdown.approved++;
      }
    }
    // Source locales (en-US / zh-TW) are authored, not translated — they
    // are always 100% by definition. Suppress the warn-state highlight.
    if (isSrc && total) done = total;

    el.innerHTML = '';
    if (total) {
      const main = document.createElement('span');
      main.textContent = t('tr.stats.progress', { done, total });
      el.appendChild(main);
      if (s && s.sourceMeta && s.sourceMeta.fileName) {
        const file = document.createElement('span');
        file.style.opacity = '0.6';
        file.textContent = t('tr.stats.loadedFile', { file: s.sourceMeta.fileName });
        el.appendChild(file);
      }
      updateProgress(done, total, isSrc ? null : breakdown);
      renderProgressBreakdown(isSrc ? null : breakdown);
      el.classList.toggle('has-untranslated', !isSrc && done < total);
    } else {
      el.textContent = t('tr.stats.notLoaded', { locale: activeLocale });
      el.classList.remove('has-untranslated');
      renderProgressBreakdown(null);
    }
  }

  function updateProgress(done, total, breakdown) {
    const wrap   = document.getElementById('t-progress');
    const dEl    = document.getElementById('t-prog-done');
    const tEl    = document.getElementById('t-prog-total');
    const fillEl = document.getElementById('t-prog-fill');
    const pctEl  = document.getElementById('t-prog-pct');
    const tog    = document.getElementById('t-prog-toggle');
    if (!wrap) return;
    if (!total) {
      wrap.hidden = true;
      if (tog) tog.hidden = true;
      return;
    }
    wrap.hidden = false;
    if (dEl) dEl.textContent = String(done);
    if (tEl) tEl.textContent = String(total);
    const pct = Math.round((done / total) * 100);
    if (fillEl) fillEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    // Toggle is only meaningful when there's a breakdown to show.
    if (tog) {
      tog.hidden = !breakdown;
      tog.setAttribute('aria-expanded', STATE.progressExpanded ? 'true' : 'false');
      tog.title = t(STATE.progressExpanded
        ? 'tr.progress.disclosure.collapse'
        : 'tr.progress.disclosure.expand');
      tog.textContent = STATE.progressExpanded ? '▲' : '▼';
    }
  }

  function renderProgressBreakdown(breakdown) {
    const el = document.getElementById('t-progress-breakdown');
    if (!el) return;
    el.innerHTML = '';
    if (!breakdown) {
      el.hidden = true;
      return;
    }
    // Five segments — order matches sidebar dot order + reading priority.
    const segments = [
      { key: 'untranslated', count: breakdown.untranslated,
        i18n: 'tr.progress.breakdown.untranslated', cls: 'warn',
        filter: 'untranslated' },
      { key: 'edited', count: breakdown.edited,
        i18n: 'tr.progress.breakdown.edited', cls: 'info',
        filter: null },
      { key: 'needsReview', count: breakdown.needsReview,
        i18n: 'tr.progress.breakdown.needsReview', cls: 'accent',
        filter: 'needsReview' },
      { key: 'approved', count: breakdown.approved,
        i18n: 'tr.progress.breakdown.approved', cls: 'good',
        filter: 'approved' },
      { key: 'cleanBaseline', count: breakdown.baselineTranslated,
        i18n: 'tr.progress.breakdown.cleanBaseline', cls: 'neutral',
        filter: null },
    ];
    for (const seg of segments) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 't-bd-item t-bd-' + seg.cls;
      if (!seg.filter) item.classList.add('t-bd-static');
      const dot = document.createElement('span');
      dot.className = 't-bd-dot';
      const label = document.createElement('span');
      label.className = 't-bd-label';
      label.textContent = t(seg.i18n, { n: seg.count });
      item.appendChild(dot);
      item.appendChild(label);
      if (seg.filter) {
        item.title = t('tr.progress.breakdown.filterTip');
        item.addEventListener('click', () => {
          if (STATE.hooks && STATE.hooks.toggleStatusFilter) {
            STATE.hooks.toggleStatusFilter(seg.filter);
          }
        });
      } else {
        item.disabled = true;
      }
      el.appendChild(item);
    }
    renderBreakdownVisibility();
  }

  function renderBreakdownVisibility() {
    const el = document.getElementById('t-progress-breakdown');
    if (!el) return;
    if (!el.children.length) { el.hidden = true; return; }
    el.hidden = !STATE.progressExpanded;
    const tog = document.getElementById('t-prog-toggle');
    if (tog) {
      tog.setAttribute('aria-expanded', STATE.progressExpanded ? 'true' : 'false');
      tog.textContent = STATE.progressExpanded ? '▲' : '▼';
      tog.title = t(STATE.progressExpanded
        ? 'tr.progress.disclosure.collapse'
        : 'tr.progress.disclosure.expand');
    }
  }

  // ----- Translation lookup（給 transcript 渲染用） -----

  // 顯示優先級鏈 (上→下):
  //   1. ts.override     站內 inline edit
  //   2. ts.baseline     使用者匯入的 CSV
  //   3. bundle .json    該 locale 隨專案 ship 的鎖定譯文,且*不等於 en-US*
  //   4. ''              真的沒譯 (含 bundle 等於 en-US 的 fallback 情況)
  // 上傳的譯文 + 站內編輯永遠都覆蓋顯示（跟 Edit Mode 無關）。
  // Edit Mode 只控制 ✏️ 按鈕 + 視覺裝飾（dim/border）。
  // 注意:judging "bundle 算翻譯過" 不能只看 originalText 非空 —
  // 進行中的 locale (fr-FR mid-translation) 的 bundle 對未翻譯行常常
  // 保留英文 fallback,只看「非空」會 100% 全當翻譯過。改查 bundle
  // map (collectLocaleBundleMap 已經把英文 fallback 過濾掉了)。
  function lookupLine(uid, originalText) {
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale) return { text: originalText, status: 'inactive', uid };
    if (isSourceLocale(activeLocale)) return { text: originalText, status: 'inactive', uid };
    const ts = getOrCreateState(activeLocale);
    if (!ts) return { text: originalText, status: 'untranslated', uid };
    const text = ts.get(uid);
    if (text != null && text !== '') {
      return { text, status: ts.source(uid), uid };
    }
    const bundleMap = STATE.hooks.getLocaleBundleMap
      ? STATE.hooks.getLocaleBundleMap(activeLocale)
      : null;
    if (bundleMap && bundleMap.has(uid)) {
      return { text: originalText, status: 'baseline', uid };
    }
    return { text: originalText, status: 'untranslated', uid };
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

    // Manual review status chip (always-open menu — single click opens
    // the menu, no left-click cycling).
    appendStatusChip(rowEl, info.uid);
  }

  function appendStatusChip(rowEl, uid) {
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale || isSourceLocale(activeLocale)) return;
    const ts = getOrCreateState(activeLocale);
    if (!ts) return;
    const status = ts.getStatus(uid);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 't-status-chip';
    chip.dataset.tUidStatus = uid;
    if (status === 'needs-review') chip.classList.add('needs-review');
    else if (status === 'approved') chip.classList.add('approved');
    else chip.classList.add('empty');

    const dot = document.createElement('span');
    dot.className = 't-status-chip-dot';
    chip.appendChild(dot);

    const label = document.createElement('span');
    label.className = 't-status-chip-label';
    label.textContent = chipLabelFor(status);
    chip.appendChild(label);

    chip.title = t(status
      ? 'tr.statusChip.tip'
      : 'tr.statusChip.empty.tip');

    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openStatusMenu(chip, uid);
    });
    rowEl.appendChild(chip);
  }

  function chipLabelFor(status) {
    if (status === 'needs-review') return t('status.needsReview');
    if (status === 'approved') return t('status.approved');
    return t('tr.statusChip.empty.label');
  }

  // ----- Status menu (always-open popup) -----

  function ensureStatusMenu() {
    if (statusMenuEl) return statusMenuEl;
    const m = document.createElement('div');
    m.className = 't-status-menu';
    m.setAttribute('role', 'menu');
    m.hidden = true;
    document.body.appendChild(m);
    statusMenuEl = m;
    return m;
  }

  function closeStatusMenu() {
    if (!statusMenuEl) return;
    statusMenuEl.hidden = true;
    statusMenuEl.innerHTML = '';
    statusMenuEl.removeAttribute('data-uid');
    if (statusMenuCleanup) {
      statusMenuCleanup();
      statusMenuCleanup = null;
    }
  }

  function openStatusMenu(anchor, uid) {
    const menu = ensureStatusMenu();
    // If menu's already open against this anchor, treat as toggle.
    if (!menu.hidden && menu.dataset.uid === uid) {
      closeStatusMenu();
      return;
    }
    closeStatusMenu();
    menu.dataset.uid = uid;

    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale || isSourceLocale(activeLocale)) return;
    const ts = getOrCreateState(activeLocale);
    if (!ts) return;
    const cur = ts.getStatus(uid);

    const items = [
      { value: null,             i18n: 'tr.statusChip.menu.clear',       cls: 'clear' },
      { value: 'needs-review',   i18n: 'tr.statusChip.menu.needsReview', cls: 'needs-review' },
      { value: 'approved',       i18n: 'tr.statusChip.menu.approved',    cls: 'approved' },
    ];
    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 't-status-menu-item ' + it.cls;
      if (cur === it.value || (cur == null && it.value == null)) {
        btn.classList.add('active');
      }
      const dot = document.createElement('span');
      dot.className = 't-status-menu-dot';
      btn.appendChild(dot);
      const lbl = document.createElement('span');
      lbl.textContent = t(it.i18n);
      btn.appendChild(lbl);
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyStatusChange(uid, it.value);
        closeStatusMenu();
      });
      menu.appendChild(btn);
    }

    // Position below the anchor (clamp into viewport).
    const r = anchor.getBoundingClientRect();
    menu.hidden = false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Reset before measure so prior positioning doesn't bias offsetWidth.
    menu.style.left = '0px';
    menu.style.top  = '0px';
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = r.left + window.scrollX;
    let top  = r.bottom + 4 + window.scrollY;
    if (left + mw > vw - 8) left = Math.max(8, vw - mw - 8);
    if (r.bottom + mh + 8 > vh && r.top - mh - 4 > 8) {
      top = r.top - mh - 4 + window.scrollY;
    }
    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';

    // Outside-click + Esc close.
    const onDocClick = (ev) => {
      if (menu.contains(ev.target)) return;
      if (anchor.contains(ev.target)) return;
      closeStatusMenu();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); closeStatusMenu(); }
    };
    // Defer doc-click attach so the click that opened the menu doesn't
    // immediately close it (event still bubbling).
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
    document.addEventListener('keydown', onKey);
    statusMenuCleanup = () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }

  function applyStatusChange(uid, status) {
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale || isSourceLocale(activeLocale)) return;
    const ts = getOrCreateState(activeLocale);
    if (!ts) return;
    const persistResult = ts.setStatus(uid, status);
    if (persistResult !== 'ok') {
      alert(t('tr.alert.persistFailed', { locale: activeLocale, file: '(status change)' }));
      return;
    }
    if (STATE.hooks && STATE.hooks.markEditDirty) STATE.hooks.markEditDirty();
    try { updateStats(); } catch (e) { console.error('[updateStats]', e); }
    if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
  }

  // ----- Flat edit view -----
  // The dialogue panel switches to this when Edit Mode is on: the entire
  // current node is expanded into one scrollable view (every line, every
  // option, every if-branch) so translators can sweep top-to-bottom instead
  // of clicking through choices. Lives here (not in ui.js) because it's
  // entirely about translation editing — UID resolution, lookupLine, status
  // chip, decorateLine. Host hooks supply the AST + speaker formatting.

  // Lazy-create the flat edit view container as a sibling of #transcript.
  function getFlatViewEl() {
    let el = document.getElementById('flat-edit-view');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'flat-edit-view';
    el.className = 'flat-edit-view';
    const tEl = document.getElementById('transcript');
    tEl.parentNode.insertBefore(el, tEl.nextSibling);
    return el;
  }

  // Render the current node fully expanded for translator editing. Called
  // from host's redrawTranslationsInPlace whenever Edit Mode is active.
  function renderFlatEditView() {
    if (!STATE.hooks) return;
    const view = getFlatViewEl();
    view.innerHTML = '';
    const proj = STATE.hooks.getActiveProject && STATE.hooks.getActiveProject();
    if (!proj) return;
    // Edit Mode is independent of playback — use the canonical title source
    // so the flat view follows navigation, not just the runtime.
    const title = STATE.hooks.getCurrentNodeTitle && STATE.hooks.getCurrentNodeTitle();
    if (!title) return;
    const node = proj.nodes.get(title);
    if (!node) return;

    const header = document.createElement('div');
    header.className = 'flat-node-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'flat-node-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);

    // Bulk status actions for the active node — only meaningful when the
    // active locale is a target language (not source) and the node has
    // translatable lines.
    const perNodeIndex = STATE.hooks.getPerNodeUidIndex
      ? STATE.hooks.getPerNodeUidIndex()
      : new Map();
    const nodeUids = perNodeIndex.get(title);
    const activeLocale = STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!isSourceLocale(activeLocale) && nodeUids && nodeUids.size > 0) {
      const actions = document.createElement('span');
      actions.className = 'flat-node-actions';

      const approveAll = document.createElement('button');
      approveAll.type = 'button';
      approveAll.className = 'flat-bulk-btn approve';
      approveAll.textContent = t('tr.bulk.approveAll', { n: nodeUids.size });
      approveAll.title = t('tr.bulk.approveAll.tip');
      approveAll.addEventListener('click', () => {
        if (!confirm(t('tr.bulk.confirm.approve', { n: nodeUids.size }))) return;
        bulkSetStatusForActiveLocale(nodeUids, 'approved');
      });
      actions.appendChild(approveAll);

      const clearAll = document.createElement('button');
      clearAll.type = 'button';
      clearAll.className = 'flat-bulk-btn clear';
      clearAll.textContent = t('tr.bulk.clearAll', { n: nodeUids.size });
      clearAll.title = t('tr.bulk.clearAll.tip');
      clearAll.addEventListener('click', () => {
        if (!confirm(t('tr.bulk.confirm.clear', { n: nodeUids.size }))) return;
        bulkSetStatusForActiveLocale(nodeUids, null);
      });
      actions.appendChild(clearAll);

      header.appendChild(actions);
    }

    view.appendChild(header);
    renderFlatStatements(view, node.statements, node);
  }

  // Recursive walker. `nodeCtx` carries nodeIndex for UID computation.
  function renderFlatStatements(container, statements, nodeCtx) {
    for (const stmt of statements) {
      if (stmt.type === 'line') renderFlatLine(container, stmt, nodeCtx);
      else if (stmt.type === 'choices') renderFlatChoices(container, stmt, nodeCtx);
      else if (stmt.type === 'if') renderFlatIf(container, stmt, nodeCtx);
      else renderFlatMeta(container, stmt);
    }
  }

  function renderFlatLine(container, stmt, nodeCtx) {
    const row = document.createElement('div');
    row.className = 'row row-line flat-row';
    if (stmt.speaker && STATE.hooks.formatSpeaker && STATE.hooks.renderSpeakerInto) {
      const sp = document.createElement('span');
      sp.className = 'speaker';
      STATE.hooks.renderSpeakerInto(sp, STATE.hooks.formatSpeaker(stmt));
      row.appendChild(sp);
      row.appendChild(document.createTextNode(': '));
    }
    const original = stmt.text || '';
    const uid = STATE.hooks.uidFor && STATE.hooks.uidFor(nodeCtx.nodeIndex, stmt.srcLine);
    const info = uid
      ? lookupLine(uid, original)
      : { text: original, status: 'inactive', uid: null };
    const tx = document.createElement('span');
    tx.className = 'text';
    tx.innerHTML = YarnParser.markupToSafeHtml(info.text);
    row.appendChild(tx);
    container.appendChild(row);
    if (info.uid) decorateLine(row, info, original);
  }

  function renderFlatChoices(container, stmt, nodeCtx) {
    stmt.items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'row row-choice flat-row';
      const arrow = document.createElement('span');
      arrow.className = 'choice-num';
      arrow.textContent = `→ ${idx + 1}.`;
      row.appendChild(arrow);
      const original = item.text || '';
      const uid = STATE.hooks.uidFor && STATE.hooks.uidFor(nodeCtx.nodeIndex, item.srcLine);
      const info = uid
        ? lookupLine(uid, original)
        : { text: original, status: 'inactive', uid: null };
      const tx = document.createElement('span');
      tx.className = 'choice-text';
      tx.innerHTML = YarnParser.markupToSafeHtml(info.text);
      row.appendChild(tx);
      if (item.cond) {
        const c = document.createElement('span');
        c.className = 'flat-cond';
        c.textContent = `(${item.cond})`;
        row.appendChild(c);
      }
      container.appendChild(row);
      if (info.uid) decorateLine(row, info, original);
      if (item.body && item.body.length) {
        const body = document.createElement('div');
        body.className = 'flat-body';
        renderFlatStatements(body, item.body, nodeCtx);
        container.appendChild(body);
      }
    });
  }

  function renderFlatIf(container, stmt, nodeCtx) {
    const tag = document.createElement('div');
    tag.className = 'flat-branch';
    tag.textContent = `«if ${stmt.cond}»`;
    container.appendChild(tag);
    const thenBody = document.createElement('div');
    thenBody.className = 'flat-body';
    renderFlatStatements(thenBody, stmt.then || [], nodeCtx);
    container.appendChild(thenBody);
    if (stmt.else && stmt.else.length) {
      const elseTag = document.createElement('div');
      elseTag.className = 'flat-branch';
      elseTag.textContent = '«else»';
      container.appendChild(elseTag);
      const elseBody = document.createElement('div');
      elseBody.className = 'flat-body';
      renderFlatStatements(elseBody, stmt.else, nodeCtx);
      container.appendChild(elseBody);
    }
    const endTag = document.createElement('div');
    endTag.className = 'flat-branch flat-branch-end';
    endTag.textContent = '«endif»';
    container.appendChild(endTag);
  }

  function renderFlatMeta(container, stmt) {
    const row = document.createElement('div');
    row.className = 'flat-meta';
    if (stmt.type === 'end') {
      row.classList.add('flat-end');
      row.textContent = '— end —';
      row.title = t('flat.end.tip');
    } else if (stmt.type === 'label') {
      row.classList.add('flat-label');
      row.dataset.labelName = stmt.name;
      row.textContent = `@${stmt.name}`;
    } else if (stmt.type === 'goto' || stmt.type === 'condGoto') {
      const prefix = stmt.type === 'goto' ? 'goto' : (stmt.isElse ? 'elseGoto' : 'condGoto');
      row.appendChild(document.createTextNode(`→ ${prefix} `));
      const target = document.createElement('span');
      target.className = 'flat-goto-target';
      target.textContent = stmt.label;
      target.title = t('flat.goto.tip', { label: stmt.label });
      target.addEventListener('click', () => jumpToLabel(stmt.label));
      row.appendChild(target);
      if (stmt.type === 'condGoto') {
        row.appendChild(document.createTextNode(` (${stmt.cond})`));
      }
    } else if (stmt.type === 'set') {
      row.textContent = `set ${stmt.variable} = ${stmt.expr}`;
    } else if (stmt.type === 'wait') {
      row.textContent = `wait ${stmt.seconds}s`;
    } else {
      return;
    }
    container.appendChild(row);
  }

  // Click handler for flat-view goto targets. Scroll to the @label row inside
  // the current node first; if the label belongs to a different node,
  // navigate there and re-query once the flat view rebuilds.
  function jumpToLabel(labelName) {
    const view = document.getElementById('flat-edit-view');
    if (!view) return;
    const sel = `[data-label-name="${CSS.escape(labelName)}"]`;
    let target = view.querySelector(sel);
    if (target) { flashFlatTarget(target); return; }
    const proj = STATE.hooks.getActiveProject && STATE.hooks.getActiveProject();
    const ownerNode = proj && proj.globalLabels && proj.globalLabels.get(labelName);
    if (!ownerNode) return;  // unknown label — silent no-op
    if (STATE.hooks.navigateToNode) STATE.hooks.navigateToNode(ownerNode);
    target = view.querySelector(sel);
    if (target) flashFlatTarget(target);
  }

  function flashFlatTarget(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash-target');
    void el.offsetWidth;       // force restart of CSS animation
    el.classList.add('flash-target');
    setTimeout(() => el.classList.remove('flash-target'), 1600);
  }

  // Bulk: apply status to a list of UIDs in the active locale (used by
  // flat-view node header). status = null clears.
  function bulkSetStatusForActiveLocale(uids, status) {
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale || isSourceLocale(activeLocale)) return 'no-locale';
    const ts = getOrCreateState(activeLocale);
    if (!ts) return 'no-state';
    const persistResult = ts.bulkSetStatus(uids, status);
    if (persistResult !== 'ok') {
      alert(t('tr.alert.persistFailed', { locale: activeLocale, file: '(bulk status change)' }));
      return persistResult;
    }
    if (STATE.hooks && STATE.hooks.markEditDirty) STATE.hooks.markEditDirty();
    try { updateStats(); } catch (e) { console.error('[updateStats]', e); }
    if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    return 'ok';
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
      const persistResult = ts.setOverride(uid, newText);
      if (persistResult !== 'ok') {
        alert(t('tr.alert.persistFailed', {
          locale: STATE.hooks.getActiveLocale(), file: '(inline edit)',
        }));
      }
      try { updateStats(); } catch (e) { console.error('[updateStats]', e); }
      if (STATE.hooks && STATE.hooks.markEditDirty) STATE.hooks.markEditDirty();
      close();
      if (STATE.hooks && STATE.hooks.requestRedraw) STATE.hooks.requestRedraw();
    });
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); ok.click(); }
    });
  }

  // ----- Download (CSV/xlsx in same format as upload) -----

  async function onDownloadLocFile() {
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale) { alert(t('tr.alert.pickLocale')); return; }
    if (isSourceLocale(activeLocale)) {
      alert(t('tr.alert.sourceLocaleDownload', { locale: activeLocale }));
      return;
    }
    if (typeof LocWriter === 'undefined') {
      console.error('LocWriter missing');
      return;
    }

    // Disable + status-flash the button while we batch-load anything not
    // yet in memory. Without this the user can double-click and we'd
    // queue overlapping exports.
    const dlBtn = document.getElementById('t-download-loc');
    let priorLabel = '';
    if (dlBtn) {
      priorLabel = dlBtn.textContent;
      dlBtn.disabled = true;
      dlBtn.textContent = t('tr.export.preparing');
    }

    try {
      // getOrCreateState (not raw .get) so a fresh page load that hasn't yet
      // touched this locale still pulls the persisted overrides + source out
      // of localStorage. Without this the export would silently produce a
      // CSV with empty translation columns.
      const ts = getOrCreateState(activeLocale);
      const uploadedSource = ts ? ts.getSource() : null;
      // If we'll go through the surgical-patch path we DON'T need the
      // ensureAllGroupsLoadedFor pre-fetch — the user's uploaded xlsx
      // already has every row baked in, and the bundle-all-groups merge
      // only matters for the synthetic / rebuild path that emits rows
      // for any-loaded-group. Skipping this avoids ~38 file fetches on
      // typical projects (19 scripts × en-US + target locale) which is
      // both slow and entirely wasted work.
      const willPatch = !!(
        uploadedSource &&
        uploadedSource.format === 'xlsx' &&
        uploadedSource.originalArrayBuffer &&
        typeof JSZip !== 'undefined'
      );

      if (!willPatch && STATE.hooks && STATE.hooks.ensureAllGroupsLoadedFor) {
        await STATE.hooks.ensureAllGroupsLoadedFor(activeLocale);
      }

      // If the user uploaded a file we keep their original format byte-for-byte.
      // Otherwise (inline-edits-only OR locked-locale-no-import) we synthesize
      // a CSV from the en-US project AST so they can still download progress.
      const ctx = exportCtx();
      let source;
      if (uploadedSource) {
        // Add FileName / NodeTitle / Notes / ReviewStatus columns so notes
        // and statuses travel with the export. No-op when the source already
        // has them and the relevant data is empty.
        source = TranslationExport.augmentSourceForExport(uploadedSource, ctx);
      } else {
        source = TranslationExport.buildSyntheticSource(activeLocale, ctx);
        if (!source) { alert(t('tr.alert.noBaseline')); return; }
      }

      const merged = ts ? ts.buildMergedMap() : new Map();
      // Fold the locale's bundled .json text into merged so locked-locale
      // exports include the actual translations even when the user hasn't
      // imported a CSV. ts entries take priority. Skipped for the patch
      // path — the user's xlsx already carries its own translations and
      // ts mirrors them (round-trip is exact, bundle would be redundant).
      if (!willPatch) {
        const bundleHook = STATE.hooks && (
          STATE.hooks.getLocaleBundleMapAllGroups || STATE.hooks.getLocaleBundleMap
        );
        if (bundleHook) {
          const bundle = bundleHook(activeLocale);
          for (const [uid, text] of bundle) {
            if (!merged.has(uid)) merged.set(uid, text);
          }
        }
      }
      const statuses = ts ? ts.getStatusMap() : new Map();
      const result = await LocWriter.writeLocFile(source, merged, { statuses });
      const blob = result.payload instanceof Blob
        ? result.payload
        : new Blob([result.payload], { type: result.mime });
      TranslationExport.downloadBlob(blob, result.filename);
      if (STATE.hooks && STATE.hooks.markExported) STATE.hooks.markExported();
    } catch (e) {
      console.error('[translation-ui] download loc failed:', e);
      alert(t('tr.alert.downloadFailed', { msg: e.message }));
    } finally {
      if (dlBtn) {
        dlBtn.disabled = false;
        dlBtn.textContent = priorLabel;
      }
    }
  }

  // Pack STATE-owned data + host hooks into a single ctx object for the
  // pure functions in translation-export.js.
  function exportCtx() {
    return {
      guids: STATE.guids,
      characterKeys: STATE.characterKeys,
      characterTranslations: STATE.characterTranslations,
      speakerGender: STATE.speakerGender,
      getAllGroups: STATE.hooks && STATE.hooks.getAllGroups,
      getEntry: STATE.hooks && STATE.hooks.getEntry,
      getNote: STATE.hooks && STATE.hooks.getNote,
      setNote: STATE.hooks && STATE.hooks.setNote,
    };
  }

  // ----- 給 ui.js 算 UID -----

  function getUidFor(filename, nodeIndex, srcLine) {
    if (!STATE.guids || !filename) return null;
    const guid = STATE.guids[filename];
    if (!guid) return null;
    return `${guid}-${nodeIndex}-${srcLine}`;
  }

  // Per-node stats helper used by the sidebar dot/count rendering. ui.js
  // owns the per-node UID index (it knows the active project's AST); we
  // overlay the per-locale TranslationState on top to get the breakdown.
  function getPerNodeStatsForActiveLocale(perNodeUidIndex) {
    const out = new Map();
    if (!perNodeUidIndex) return out;
    const activeLocale = STATE.hooks && STATE.hooks.getActiveLocale && STATE.hooks.getActiveLocale();
    if (!activeLocale) return out;
    if (isSourceLocale(activeLocale)) {
      // Source locales: every line is "translated" by definition,
      // no untranslated, no review status.
      for (const [title, uids] of perNodeUidIndex) {
        out.set(title, {
          total: uids.size,
          translated: uids.size,
          baselineTranslated: uids.size,
          edited: 0,
          untranslated: 0,
          needsReview: 0,
          approved: 0,
        });
      }
      return out;
    }
    const ts = getOrCreateState(activeLocale);
    if (!ts) return out;
    const merged = ts.buildMergedMap();
    const bundleMap = STATE.hooks.getLocaleBundleMap
      ? STATE.hooks.getLocaleBundleMap(activeLocale)
      : new Map();
    for (const [title, uids] of perNodeUidIndex) {
      let translated = 0, baselineTranslated = 0, edited = 0, untranslated = 0;
      let needsReview = 0, approved = 0;
      for (const uid of uids) {
        const v = merged.get(uid);
        if (v != null && v !== '') {
          translated++;
          if (ts.source(uid) === 'override') edited++;
          else baselineTranslated++;
        } else {
          // ts has nothing — fall back to bundled locale .json (locked
          // translation). Counted as baseline-translated, same priority
          // as ts.baseline for stats purposes.
          const bundle = bundleMap.get(uid);
          if (bundle && bundle !== '') {
            translated++;
            baselineTranslated++;
          } else {
            untranslated++;
          }
        }
        const st = ts.getStatus(uid);
        if (st === 'needs-review') needsReview++;
        else if (st === 'approved') approved++;
      }
      out.set(title, {
        total: uids.size,
        translated,
        baselineTranslated,
        edited,
        untranslated,
        needsReview,
        approved,
      });
    }
    return out;
  }

  global.TranslationUI = {
    install,
    lookupLine,
    decorateLine,
    getUidFor,
    setEditMode: setMode,
    // Host calls this after the active script or active locale changes
    // (anywhere the in-memory project / locale data has been swapped).
    notifyContextChange: () => updateStats(),
    isActive: () => STATE.translationMode,
    refreshExportStatus,
    // Flat edit view rendering — host calls this from redrawTranslationsInPlace
    // when Edit Mode is active.
    renderFlatEditView,
    // Status-related public API consumed by ui.js (sidebar).
    bulkSetStatusForActiveLocale,
    getPerNodeStatsForActiveLocale,
  };
})(typeof window !== 'undefined' ? window : globalThis);
