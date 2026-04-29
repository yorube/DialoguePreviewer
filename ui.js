// ui.js — wires data → parser → runtime → DOM.
// Single-file IIFE intentionally; sections below are the main concerns.
//
//   §1  Constants & version
//   §2  i18n
//   §3  Global state
//   §4  Storage helpers (localStorage)
//   §5  Speaker → gender map
//   §6  Markup helpers
//   §7  Manifest + per-locale file loading
//   §8  Dropdowns + node list
//   §9  Source panel (tabs, font, render, highlight)
//   §10 Translator notes
//   §11 Variables panel (with overrides)
//   §12 Transcript / dialogue advance
//   §13 Snapshots + back navigation
//   §14 Resizable column splitters
//   §15 Dialogue glue (startAt / setActiveNode)
//   §16 Init / event wiring
//   §17 Bootstrap

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // §1  Constants & version
  // ─────────────────────────────────────────────────────────────────────────

  const VERSION = '1.0.0';
  const SNAPSHOT_LIMIT = 500;
  const SRC_FONT_MIN = 10, SRC_FONT_MAX = 22, SRC_FONT_DEFAULT = 14;
  const LOCALE_RE = /^(.+)\(([^()]+)\)\.json$/i;
  const NOTE_DEBOUNCE_MS = 700;

  // Per-speaker name colors. Hash(name) → index → color, so the same speaker
  // always gets the same hue. Palette skips pink/blue stereotypes and the
  // hues already used by gender badges (teal / amber).
  const SPEAKER_COLORS = [
    '#ffd479',  // warm yellow (default fallback)
    '#9ad9a4',  // sage green
    '#c8a6ff',  // lavender
    '#ffaa66',  // orange
    '#6dd0ff',  // sky
    '#d4ff7a',  // chartreuse
    '#a6b8ff',  // periwinkle
    '#ffc7a3',  // peach
  ];

  const $ = (id) => document.getElementById(id);

  // ─────────────────────────────────────────────────────────────────────────
  // §2  i18n
  // ─────────────────────────────────────────────────────────────────────────

  const I18N = {
    en: {
      'topbar.script': 'Script',
      'topbar.locale': 'Text language',
      'topbar.uiLang': 'Interface language',
      'btn.loadJson': '📂 Load .json',
      'btn.replayNode': '⟳ Replay this node',
      'btn.stepBack': '← Step back',
      'btn.continue': '▼ Continue (Space)',
      'btn.openNote': '📝 Note',
      'btn.resetOverrides': '🔄 Reset overrides ({n})',
      'sidebar.nodes': 'Nodes',
      'panel.vars': 'Variables',
      'panel.source': 'Source',
      'panel.notes': 'Notes',
      'note.placeholder': 'Add a translator note for this node…',
      'input.filter': 'Filter…',
      'hint.drop': 'Drop per-locale .json files into the window, or click "Load .json" above.',
      'hint.keys': 'Keys: Space/Enter to continue, 1-9 to pick option.',
      'status.loading': 'Loading {file}…',
      'status.loaded': 'Loaded: {n} nodes ({ms}ms)',
      'status.loadedWithErrors': 'Loaded: {n} nodes ({ms}ms) — {err} parse errors (see F12)',
      'status.loadFailed': 'Load failed: {msg}',
      'status.noManifest': 'No bundled data. Drop .json files in or click "Load .json".',
      'status.readingManifest': 'Reading manifest…',
      'status.bootstrapFailed': 'Bootstrap failed: {msg}',
      'status.error': 'Error: {msg} @ {at}',
      'status.asyncError': 'Async error: {msg}',
      'error.invalidJson': 'Invalid JSON (must be an array)',
      'error.parserCrashed': 'Parser crashed: {msg}',
      'error.nodeNotFound': 'Node not found: {title}',
      'error.loadFailedFile': 'Failed to load: {file}\n{msg}',
      'transcript.dialogueEnded': '— Dialogue ended —',
      'transcript.jumpTo': '→ Jump to node: {title}',
      'tooltip.overridden': 'Overridden by user',
      'tooltip.rewind': 'Rewind to this line',
      'tooltip.gender': 'Grammatical gender (for translation)',
      // ----- Translation Edit Mode -----
      'tr.editMode': '✏️ Translation Edit Mode',
      'tr.editMode.tip': 'Enable to inline-edit translations on the dialogue preview. Edits are saved in your browser only.',
      'tr.upload': '📥 Upload translation file',
      'tr.upload.tip': 'Upload your filled .csv / .xlsx — fully replaces the current language with the new file.',
      'tr.download': '💾 Download translation file',
      'tr.download.tip': 'Download a .csv / .xlsx with the same format you uploaded, with translations + inline edits filled in.',
      'tr.reset': '🔁 Reset this language',
      'tr.reset.tip': 'Clear uploaded translation + inline edits for this language. Falls back to bundled defaults.',
      'tr.editBtn.tip': 'Edit this line (Ctrl/Cmd+Enter to save, Esc to cancel)',
      'tr.editConfirm': '✓ Save',
      'tr.editCancel': '✗ Cancel',
      'tr.stats.noLocale': 'Pick a target language first',
      'tr.stats.notLoaded': '{locale}: no translation file loaded',
      'tr.stats.loaded': '{locale}: baseline {b} / inline edits {o}',
      'tr.stats.loadedFile': ' ({file})',
      'tr.stats.loading': 'Loading translation tables…',
      'tr.alert.pickLocale': 'Please switch the Language selector to your target language (e.g. fr-FR / ru-RU) before uploading.',
      'tr.alert.sourceLocale': 'You picked a source language ({locale}); translation flow only applies to target languages.',
      'tr.alert.parseFailed': 'Parse failed: {msg}',
      'tr.alert.loaded': 'Loaded {locale}:\n  file: {file}\n  rows: {total}\n  with translation: {translated}\n  missing UID: {missing}',
      'tr.alert.warnings': '\n\n⚠️ Warnings:\n  {head}',
      'tr.alert.warningsMore': '\n  …({n} more, see console)',
      'tr.alert.noBaseline': 'No translation file uploaded yet. Please upload first, then edit + download.',
      'tr.alert.noSource': 'Source structure missing (probably dropped due to localStorage quota). Please re-upload your original .csv / .xlsx, then download.',
      'tr.alert.downloadFailed': 'Failed to write translation file: {msg}',
      'tr.alert.resetEmpty': 'Nothing to reset for {locale}.',
      'tr.confirm.replace': 'Fully replace {locale} with the uploaded file?\n\n  current baseline: {b} entries\n  current inline edits: {o} entries',
      'tr.confirm.replaceOverrideWarn': '\n\n⚠️ You have {o} inline edits that will be wiped completely when you upload. The whole {locale} will follow the new file.\n\nIf you don\'t want to lose them: press [💾 Download] first to save your current state, then upload.',
      'tr.confirm.localeMismatch': 'Detected locale "{got}" in the file, but you selected "{want}". Apply this file as the {want} translation anyway? (Usually means the file or selection is wrong.)',
      'tr.confirm.reset': 'Reset {locale}?\n\n  baseline (uploaded): {b} entries\n  inline edits: {o} entries\n\nAfter reset the preview falls back to the bundled default ({locale}).json. This cannot be undone.',
    },
    zh: {
      'topbar.script': '劇本',
      'topbar.locale': '文本語言',
      'topbar.uiLang': '介面語言',
      'btn.loadJson': '📂 載入 .json',
      'btn.replayNode': '⟳ 從本節點重看',
      'btn.stepBack': '← 退一行',
      'btn.continue': '▼ 繼續 (Space)',
      'btn.openNote': '📝 筆記',
      'btn.resetOverrides': '🔄 重置覆寫 ({n})',
      'sidebar.nodes': '節點清單',
      'panel.vars': '變數狀態',
      'panel.source': '原始文本',
      'panel.notes': '筆記',
      'note.placeholder': '在這裡為此節點加翻譯筆記…',
      'input.filter': '篩選…',
      'hint.drop': '把 .json per-locale 檔拖進視窗，或按上方「載入 .json」。',
      'hint.keys': '鍵盤：空白／Enter 繼續、數字鍵 1-9 選選項。',
      'status.loading': '載入 {file}…',
      'status.loaded': '載入完成：{n} 個節點 ({ms}ms)',
      'status.loadedWithErrors': '載入完成：{n} 個節點 ({ms}ms)，但有 {err} 個節點解析失敗（F12 看細節）',
      'status.loadFailed': '載入失敗：{msg}',
      'status.noManifest': '沒有 bundle 資料，請拖曳 .json 檔進來，或按上方「載入 .json」。',
      'status.readingManifest': '讀取 manifest…',
      'status.bootstrapFailed': 'Bootstrap 失敗：{msg}',
      'status.error': '錯誤：{msg} @ {at}',
      'status.asyncError': '非同步錯誤：{msg}',
      'error.invalidJson': 'JSON 格式錯誤（應為陣列）',
      'error.parserCrashed': 'Parser 整體炸掉：{msg}',
      'error.nodeNotFound': '找不到節點：{title}',
      'error.loadFailedFile': '載入失敗：{file}\n{msg}',
      'transcript.dialogueEnded': '— 對話結束 —',
      'transcript.jumpTo': '→ 跳到節點：{title}',
      'tooltip.overridden': '使用者覆寫',
      'tooltip.rewind': '退回到此句',
      'tooltip.gender': '文法性別（翻譯用）',
      // ----- 翻譯編輯模式 -----
      'tr.editMode': '✏️ 翻譯編輯模式',
      'tr.editMode.tip': '開啟後，可以在對話預覽上點 ✏️ 直接修改該句譯文。所有改動只存在你的瀏覽器內。',
      'tr.upload': '📥 上傳翻譯檔',
      'tr.upload.tip': '上傳填好的 .csv / .xlsx — 會「整個替換」當前語言為新檔內容。',
      'tr.download': '💾 下載翻譯檔',
      'tr.download.tip': '下載與上傳同格式的 .csv / .xlsx，譯文欄填上目前所有上傳 + 站內編輯的最新內容。',
      'tr.reset': '🔁 重置該語言譯文',
      'tr.reset.tip': '清掉這個語言的「上傳譯文 + 站內編輯」，回到 bundle 預設的譯文。',
      'tr.editBtn.tip': '編輯這句譯文（Ctrl/Cmd+Enter 存、Esc 取消）',
      'tr.editConfirm': '✓ 儲存',
      'tr.editCancel': '✗ 取消',
      'tr.stats.noLocale': '請先選擇目標語言',
      'tr.stats.notLoaded': '{locale}：尚未載入譯文檔',
      'tr.stats.loaded': '{locale}：基準 {b} 條 / 站內編輯 {o} 條',
      'tr.stats.loadedFile': '（{file}）',
      'tr.stats.loading': '載入翻譯對照表中…',
      'tr.alert.pickLocale': '請先在右上「Language」切換到要載入的目標語言（如 fr-FR / ru-RU）。',
      'tr.alert.sourceLocale': '你選的是來源語言（{locale}），翻譯流程僅適用於目標語言。',
      'tr.alert.parseFailed': '解析失敗：{msg}',
      'tr.alert.loaded': '已載入 {locale} 譯文：\n  檔案：{file}\n  資料列：{total}\n  含譯文：{translated}\n  缺 UID：{missing}',
      'tr.alert.warnings': '\n\n⚠️ 警告：\n  {head}',
      'tr.alert.warningsMore': '\n  …（再 {n} 條，請看 console）',
      'tr.alert.noBaseline': '尚未上傳任何譯文檔。請先上傳，編輯完再下載。',
      'tr.alert.noSource': '找不到當初上傳檔案的結構（可能 localStorage 容量不夠被丟掉）。請重新上傳一次原始 .csv / .xlsx，再下載。',
      'tr.alert.downloadFailed': '產出譯文檔失敗：{msg}',
      'tr.alert.resetEmpty': '{locale} 沒有需要重置的內容。',
      'tr.confirm.replace': '要把 {locale} 整個替換成上傳檔的內容嗎？\n\n  目前基準：{b} 條\n  目前站內編輯：{o} 條',
      'tr.confirm.replaceOverrideWarn': '\n\n⚠️ 你目前有 {o} 條站內編輯會被「全部清掉」，整個 {locale} 以新檔為準。\n\n如果不想丟掉：先按 [💾 下載譯文] 把目前狀態存下來，再上傳。',
      'tr.confirm.localeMismatch': '偵測到的翻譯欄位是「{got}」，但你目前選的語言是「{want}」。要把這份檔案套用為 {want} 的譯文嗎？（通常表示你選錯語言或檔案標頭錯誤）',
      'tr.confirm.reset': '要重置 {locale} 嗎？\n\n  上傳基準：{b} 條\n  站內編輯：{o} 條\n\n重置後預覽會回到 bundle 預設的 ({locale}).json 內容。此動作無法復原。',
    },
  };

  let currentLang = (() => {
    try {
      const saved = localStorage.getItem('yp.lang');
      if (saved && I18N[saved]) return saved;
    } catch (e) { /* localStorage may be blocked */ }
    return 'en';
  })();

  function t(key, params) {
    let s = (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return s;
  }

  function applyI18n() {
    document.documentElement.lang = currentLang === 'zh' ? 'zh-Hant' : 'en';
    for (const el of document.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
    }
  }

  function setLang(lang) {
    if (!I18N[lang]) lang = 'en';
    currentLang = lang;
    try { localStorage.setItem('yp.lang', lang); } catch (e) {}
    applyI18n();
    // Re-render dynamic strings.
    if (state.runtime) renderVars();
    syncResetBtn();
    syncOverrideMarkers();
    const cont = document.querySelector('.continue-btn');
    if (cont) cont.textContent = t('btn.continue');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §3  Global state
  // ─────────────────────────────────────────────────────────────────────────

  const state = {
    // groups: Map<scriptName, Map<locale, entry>>; entry: {filename, fetchUrl?, project?}
    groups: new Map(),
    activeGroup: null,
    activeLocale: null,
    runtime: null,                  // current YarnRuntime instance
    snapshots: [],                  // {rt, transcriptHtml, nodeTitle}
    varOverrides: new Map(),        // user-edited var values, re-applied on start()
    nodeFilter: '',                 // text in the node-list filter input
    speakerGender: {},              // name → 'M' | 'F' | 'N'
    noteSaveTimer: null,            // debounce timer for note autosave
    noteLoadedFor: null,            // {group, title} the textarea is bound to
  };

  function activeProject() {
    if (!state.activeGroup || !state.activeLocale) return null;
    return state.groups.get(state.activeGroup).get(state.activeLocale).project;
  }

  function setStatus(msg) { $('status').textContent = msg || ''; }

  // ─────────────────────────────────────────────────────────────────────────
  // §4  Storage helpers (localStorage)
  // ─────────────────────────────────────────────────────────────────────────

  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function lsGetJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSetJSON(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §5  Speaker → gender map
  // ─────────────────────────────────────────────────────────────────────────

  async function loadSpeakerGenderMap() {
    try {
      const r = await fetch('data/speakers.json', { cache: 'no-cache' });
      if (r.ok) state.speakerGender = await r.json();
    } catch (e) { /* speakers.json is optional */ }
  }

  function genderBadgeFor(name) {
    const g = state.speakerGender[name];
    if (g === 'M') return 'M';
    if (g === 'F') return 'F';
    return '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §6  Markup helpers
  // ─────────────────────────────────────────────────────────────────────────

  // djb2-style string hash → small non-negative int. Used to deterministically
  // map a speaker name to a color slot.
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }
  function colorForSpeaker(rawName) {
    if (!rawName) return null;
    return SPEAKER_COLORS[hashStr(rawName) % SPEAKER_COLORS.length];
  }

  // Render a text node that may carry MBU/TMP markup. Pulls a leading [M]/[F]
  // marker (added by formatSpeaker) into a styled chip; pushes the rest as
  // plain text. Tints the whole span by hashed-color of the bare character
  // name so multi-speaker scenes are easy to scan.
  function renderSpeakerInto(span, speaker) {
    const m = speaker.match(/^\[([MF])\]\s+(.*)$/);
    const displayName = m ? m[2] : speaker;
    if (m) {
      const badge = document.createElement('span');
      badge.className = 'gender-badge gender-' + m[1].toLowerCase();
      badge.textContent = m[1];
      badge.title = t('tooltip.gender');
      span.appendChild(badge);
      span.appendChild(document.createTextNode(' ' + m[2]));
    } else {
      span.textContent = speaker;
    }
    // Strip narrator/communicator decorators before hashing — same actor
    // should keep the same color whether the line is on the comm or in person.
    const bareName = displayName
      .replace(/^📱\s*/, '')
      .replace(/^\?\?\?（(.+?)）.*$/, '$1');
    const color = colorForSpeaker(bareName);
    if (color) span.style.color = color;
  }

  function formatSpeaker(line) {
    if (!line.speaker) return '';
    let s = line.speaker;
    if (line.isAnonymous) s = `???（${s}）`;
    if (line.isCommunicator) s = `📱 ${s}`;
    const badge = genderBadgeFor(line.speaker);
    if (badge) s = `[${badge}] ${s}`;
    return s;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §7  Manifest + per-locale file loading
  // ─────────────────────────────────────────────────────────────────────────

  function detectLocale(filename) {
    const m = filename.match(LOCALE_RE);
    if (m) return { group: m[1], locale: m[2] };
    return { group: filename.replace(/\.json$/i, ''), locale: 'unknown' };
  }

  function registerEntry(group, locale, entry) {
    if (!state.groups.has(group)) state.groups.set(group, new Map());
    state.groups.get(group).set(locale, entry);
  }

  async function ensureLoaded(group, locale) {
    const localesMap = state.groups.get(group);
    if (!localesMap) throw new Error(`Unknown script: ${group}`);
    const entry = localesMap.get(locale);
    if (!entry) throw new Error(`Unknown locale: ${locale} for ${group}`);
    if (entry.project) return entry.project;
    if (!entry.fetchUrl) throw new Error(`No source for ${group}/${locale}`);

    setStatus(t('status.loading', { file: entry.filename }));
    const t0 = performance.now();
    const r = await fetch(entry.fetchUrl, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    if (!Array.isArray(json)) throw new Error(t('error.invalidJson'));

    let project;
    try {
      project = YarnParser.parseProject(json);
    } catch (e) {
      console.error('[parser] parseProject threw:', e);
      throw new Error(t('error.parserCrashed', { msg: e.message }));
    }
    entry.project = project;

    const errs = project.parseErrors?.length || 0;
    const dt = (performance.now() - t0).toFixed(0);
    setStatus(t(errs ? 'status.loadedWithErrors' : 'status.loaded',
      { n: project.nodes.size, ms: dt, err: errs }));
    return project;
  }

  async function tryLoadManifest() {
    try {
      const res = await fetch('data/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return false;
      const manifest = await res.json();
      if (!manifest || !Array.isArray(manifest.scripts)) return false;
      for (const script of manifest.scripts) {
        for (const [loc, file] of Object.entries(script.locales || {})) {
          registerEntry(script.name, loc, {
            filename: file,
            fetchUrl: 'data/' + encodeURIComponent(file),
          });
        }
      }
      if (!state.groups.size) return false;
      refreshScriptDropdown();
      const firstGroup = state.groups.keys().next().value;
      await selectGroup(firstGroup);
      return true;
    } catch (e) {
      console.info('No bundled manifest:', e.message);
      return false;
    }
  }

  async function ingestFiles(fileList) {
    let lastGroup = null, lastLocale = null;
    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (!Array.isArray(json)) {
          console.warn('Skipping non-array JSON:', file.name);
          continue;
        }
        const project = YarnParser.parseProject(json);
        const { group, locale } = detectLocale(file.name);
        registerEntry(group, locale, { filename: file.name, project });
        lastGroup = group; lastLocale = locale;
      } catch (e) {
        console.error('Failed to load', file.name, e);
        alert(t('error.loadFailedFile', { file: file.name, msg: e.message }));
      }
    }
    refreshScriptDropdown();
    if (lastGroup) {
      state.activeGroup = lastGroup;
      state.activeLocale = lastLocale;
      $('script-select').value = lastGroup;
      await refreshLocaleDropdown();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §8  Dropdowns + node list
  // ─────────────────────────────────────────────────────────────────────────

  function refreshScriptDropdown() {
    const sel = $('script-select');
    sel.innerHTML = '';
    for (const name of [...state.groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    if (state.activeGroup) sel.value = state.activeGroup;
  }

  async function refreshLocaleDropdown() {
    const sel = $('locale-select');
    sel.innerHTML = '';
    if (!state.activeGroup) return;
    const localesMap = state.groups.get(state.activeGroup);
    const locs = [...localesMap.keys()].sort();
    for (const loc of locs) {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      sel.appendChild(opt);
    }
    if (!state.activeLocale || !localesMap.has(state.activeLocale)) {
      // Default priority: en-US → es-ES → ru-RU → first available
      state.activeLocale = ['en-US', 'es-ES', 'ru-RU', locs[0]].find(l => localesMap.has(l));
    }
    sel.value = state.activeLocale;
    await loadAndShowCurrent();
  }

  async function selectGroup(name) {
    state.activeGroup = name;
    // Different scripts have different variables; stale overrides would mislead.
    state.varOverrides.clear();
    // Keep activeLocale across script switches when the new script has it.
    await refreshLocaleDropdown();
  }

  async function selectLocale(loc) {
    state.activeLocale = loc;
    await loadAndShowCurrent();
    if (typeof TranslationUI !== 'undefined' && TranslationUI.notifyLocaleChange) {
      TranslationUI.notifyLocaleChange();
    }
  }

  async function loadAndShowCurrent() {
    if (!state.activeGroup || !state.activeLocale) return;
    try {
      await ensureLoaded(state.activeGroup, state.activeLocale);
    } catch (e) {
      console.error(e);
      setStatus(t('status.loadFailed', { msg: e.message }));
      return;
    }
    refreshNodeList();
    const proj = activeProject();
    const desired = state.runtime?.currentNodeTitle || 'Start';
    const startTitle = proj.nodes.has(desired)
      ? desired
      : (proj.nodes.has('Start') ? 'Start' : proj.nodes.keys().next().value);
    if (startTitle) startAt(startTitle);
  }

  function refreshNodeList() {
    const list = $('node-list');
    list.innerHTML = '';
    const proj = activeProject();
    if (!proj) return;

    // Stable index based on JSON's natural order (survives sort + filter).
    const allTitles = [...proj.nodes.keys()];
    const idxByTitle = new Map(allTitles.map((title, i) => [title, i + 1]));

    let titles = allTitles;
    if (state.nodeFilter) {
      const f = state.nodeFilter.toLowerCase();
      titles = titles.filter(x => x.toLowerCase().includes(f));
    }
    titles.sort((a, b) => {
      const meta = (s) => (s === '總覽' || s === '變數紀錄') ? 1 : 0;
      const ma = meta(a), mb = meta(b);
      return ma !== mb ? ma - mb : a.localeCompare(b);
    });

    const padWidth = String(allTitles.length).length;
    const noted = state.activeGroup ? notedTitlesIn(state.activeGroup) : new Set();
    const frag = document.createDocumentFragment();
    for (const title of titles) {
      const li = document.createElement('li');
      const hasNote = noted.has(title);
      if (hasNote) li.classList.add('has-note');

      const num = document.createElement('span');
      num.className = 'node-num';
      num.textContent = String(idxByTitle.get(title)).padStart(padWidth, '0');

      const ttl = document.createElement('span');
      ttl.className = 'node-title';
      ttl.textContent = title;

      const noteBtn = document.createElement('button');
      noteBtn.className = 'node-note-btn';
      noteBtn.type = 'button';
      noteBtn.textContent = hasNote ? '📝' : '+';
      noteBtn.title = hasNote ? 'Has note — click to open' : 'Add note';
      noteBtn.addEventListener('click', e => {
        e.stopPropagation();
        startAt(title);
        openNote();
      });

      li.appendChild(num);
      li.appendChild(ttl);
      li.appendChild(noteBtn);
      li.title = title;
      li.onclick = () => startAt(title);
      frag.appendChild(li);
    }
    list.appendChild(frag);
    $('node-count').textContent = `(${titles.length})`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §9  Source panel (tabs, font, render, highlight)
  // ─────────────────────────────────────────────────────────────────────────

  function setSourcePanelTab(tabName) {
    const panel = document.querySelector('.source-panel');
    if (!panel) return;
    document.querySelectorAll('.source-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });
    document.querySelectorAll('.source-pane').forEach(p => {
      p.classList.toggle('active', p.id === 'source-pane-' + tabName);
    });
    panel.classList.toggle('tab-source', tabName === 'source');
    panel.classList.toggle('tab-notes', tabName === 'notes');
    if (tabName === 'notes') $('note-textarea').focus({ preventScroll: true });
  }

  function setSourceFontSize(px) {
    const v = Math.max(SRC_FONT_MIN, Math.min(SRC_FONT_MAX, Math.round(px)));
    document.documentElement.style.setProperty('--src-font-size', v + 'px');
    lsSet('yp.srcFontSize', String(v));
  }
  function bumpSourceFontSize(delta) {
    const cur = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--src-font-size')) || SRC_FONT_DEFAULT;
    setSourceFontSize(cur + delta);
  }
  function loadSavedSourceFontSize() {
    const raw = lsGet('yp.srcFontSize');
    setSourceFontSize(raw ? (parseFloat(raw) || SRC_FONT_DEFAULT) : SRC_FONT_DEFAULT);
  }

  function colorizeSourceLine(rawLine) {
    let s = String(rawLine || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (!s.trim()) return '&nbsp;';
    if (/^\s*\/\//.test(rawLine)) {
      return '<span class="src-comment">' + s + '</span>';
    }
    s = s.replace(/&lt;&lt;[\s\S]*?&gt;&gt;/g,
      m => '<span class="src-cmd">' + m + '</span>');
    if (/^\s*-&gt;/.test(s)) {
      return s.replace(/^(\s*)(-&gt;)/, '$1<span class="src-option">$2</span>');
    }
    s = s.replace(/^(\s*)([^:：&lt;&gt;]{1,40}?)([:：])/,
      '$1<span class="src-speaker">$2$3</span>');
    return s;
  }

  function renderSource(nodeTitle) {
    const view = $('source-view');
    if (!view) return;
    view.innerHTML = '';
    const proj = activeProject();
    if (!proj || !nodeTitle) return;
    const node = proj.nodes.get(nodeTitle);
    if (!node || !node.body) {
      view.textContent = '(no source)';
      return;
    }
    const frag = document.createDocumentFragment();
    node.body.split('\n').forEach((line, i) => {
      const row = document.createElement('div');
      row.className = 'src-line';
      row.dataset.line = String(i + 1);
      const num = document.createElement('span');
      num.className = 'src-num';
      num.textContent = String(i + 1);
      row.appendChild(num);
      const code = document.createElement('span');
      code.className = 'src-code';
      code.innerHTML = colorizeSourceLine(line);
      row.appendChild(code);
      frag.appendChild(row);
    });
    view.appendChild(frag);
    view.scrollTop = 0;
  }

  function highlightSourceLine(srcLine) {
    const view = $('source-view');
    if (!view) return;
    view.querySelectorAll('.src-line-active').forEach(el =>
      el.classList.remove('src-line-active'));
    if (!srcLine) return;
    const row = view.querySelector('.src-line[data-line="' + srcLine + '"]');
    if (row) {
      row.classList.add('src-line-active');
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function syncSourceHighlight() {
    const rt = state.runtime;
    if (!rt || !rt.current) return highlightSourceLine(null);
    highlightSourceLine(rt.current.srcLine);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §10 Translator notes
  // ─────────────────────────────────────────────────────────────────────────
  // Stored in localStorage as { [scriptName]: { [nodeTitle]: text } }.
  // Notes are local to the user's browser — never uploaded.

  function notesStore() { return lsGetJSON('yp.notes', {}) || {}; }
  function notesSave(obj) { lsSetJSON('yp.notes', obj); }

  function getNote(group, title) {
    return notesStore()[group]?.[title] || '';
  }
  function setNote(group, title, text) {
    const all = notesStore();
    if (!all[group]) all[group] = {};
    if (text) all[group][title] = text;
    else delete all[group][title];
    if (all[group] && !Object.keys(all[group]).length) delete all[group];
    notesSave(all);
  }
  function notedTitlesIn(group) {
    return new Set(Object.keys(notesStore()[group] || {}));
  }

  // Bind the note panel to a specific node title. We take the title as a
  // parameter — not state.runtime.currentNodeTitle — because callers like
  // startAt() invoke us BEFORE runtime.start() runs (currentNodeTitle would
  // still be null then and the load would silently miss the saved note).
  function loadNoteForNode(title) {
    flushPendingNote();
    if (!state.activeGroup || !title) {
      state.noteLoadedFor = null;
      $('note-textarea').value = '';
      $('notes-tab-btn').classList.remove('has-note');
      $('note-toggle').classList.remove('has-note');
      return;
    }
    const text = getNote(state.activeGroup, title);
    $('note-textarea').value = text;
    state.noteLoadedFor = { group: state.activeGroup, title };
    $('notes-tab-btn').classList.toggle('has-note', !!text);
    $('note-toggle').classList.toggle('has-note', !!text);
  }

  // Save against the node the textarea was loaded for (not the current
  // runtime node, which may have changed mid-navigation).
  function commitNoteValue() {
    if (!state.noteLoadedFor) return;
    const text = $('note-textarea').value.trim();
    setNote(state.noteLoadedFor.group, state.noteLoadedFor.title, text);
    $('notes-tab-btn').classList.toggle('has-note', !!text);
    $('note-toggle').classList.toggle('has-note', !!text);
    refreshNodeList();
  }

  function flushPendingNote() {
    clearTimeout(state.noteSaveTimer);
    state.noteSaveTimer = null;
    if (!state.noteLoadedFor) return;
    const text = $('note-textarea').value.trim();
    if (text !== getNote(state.noteLoadedFor.group, state.noteLoadedFor.title)) {
      setNote(state.noteLoadedFor.group, state.noteLoadedFor.title, text);
    }
  }

  function openNote() { setSourcePanelTab('notes'); }

  // ─────────────────────────────────────────────────────────────────────────
  // §11 Variables panel (with overrides)
  // ─────────────────────────────────────────────────────────────────────────

  function renderVars() {
    const rt = state.runtime;
    const panel = $('vars');
    panel.innerHTML = '';
    if (!rt) return;

    const entries = Object.entries(rt.vars).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, value] of entries) {
      const row = document.createElement('div');
      row.className = 'var-row';
      if (state.varOverrides.has(name)) row.classList.add('var-overridden');
      row.dataset.varName = name;

      const label = document.createElement('span');
      label.className = 'var-name';
      label.textContent = name;
      if (state.varOverrides.has(name)) label.title = t('tooltip.overridden');
      row.appendChild(label);

      row.appendChild(makeVarEditor(name, value));
      panel.appendChild(row);
    }
    syncResetBtn();
  }

  function makeVarEditor(name, value) {
    let input;
    if (typeof value === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value;
      input.className = 'var-edit var-edit-bool';
      input.addEventListener('change', () => updateVar(name, input.checked));
    } else if (typeof value === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.value = String(value);
      input.step = 'any';
      input.className = 'var-edit var-edit-number';
      input.addEventListener('change', () => {
        const n = parseFloat(input.value);
        updateVar(name, isNaN(n) ? 0 : n);
      });
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = value === undefined ? '' : String(value);
      input.className = 'var-edit var-edit-text';
      input.addEventListener('change', () => updateVar(name, input.value));
    }
    return input;
  }

  // Apply a manual var edit. Persisted in state.varOverrides so the value
  // survives "從 Start 重啟" / replay (re-applied after declared defaults).
  function updateVar(name, value) {
    if (!state.runtime) return;
    state.runtime.vars[name] = value;
    state.varOverrides.set(name, value);
    // Sync the topmost snapshot so backLine doesn't undo a manual edit.
    if (state.snapshots.length) {
      state.snapshots[state.snapshots.length - 1].rt.vars[name] = value;
    }
    syncOverrideMarkers();
    syncResetBtn();
  }

  function syncOverrideMarkers() {
    for (const row of $('vars').querySelectorAll('.var-row')) {
      const name = row.dataset.varName;
      const overridden = state.varOverrides.has(name);
      row.classList.toggle('var-overridden', overridden);
      row.querySelector('.var-name').title = overridden ? t('tooltip.overridden') : '';
    }
  }

  function syncResetBtn() {
    const panel = $('vars');
    let btn = panel.querySelector('.var-reset-btn');
    if (state.varOverrides.size) {
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'var-reset-btn';
        btn.addEventListener('click', () => {
          state.varOverrides.clear();
          const title = state.runtime?.currentNodeTitle;
          if (title) startAt(title);
        });
        panel.appendChild(btn);
      }
      btn.textContent = t('btn.resetOverrides', { n: state.varOverrides.size });
    } else if (btn) {
      btn.remove();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §12 Transcript / dialogue advance
  // ─────────────────────────────────────────────────────────────────────────

  function appendTranscript(kind, text, speaker) {
    const tEl = $('transcript');
    const row = document.createElement('div');
    row.className = `row row-${kind}`;
    if (speaker) {
      const sp = document.createElement('span');
      sp.className = 'speaker';
      renderSpeakerInto(sp, speaker);
      row.appendChild(sp);
      row.appendChild(document.createTextNode(': '));
    }
    const tx = document.createElement('span');
    tx.className = 'text';
    tx.innerHTML = YarnParser.markupToSafeHtml(text);
    row.appendChild(tx);
    // Per-row rewind handle — only on dialogue lines. choice/jump/end rows
    // have no meaningful single-row rewind target.
    if (kind === 'line') {
      const rb = document.createElement('button');
      rb.className = 'row-rewind';
      rb.title = t('tooltip.rewind');
      rb.textContent = '↶';
      rb.dataset.snapIdx = String(state.snapshots.length);
      row.appendChild(rb);
    }
    tEl.appendChild(row);
    tEl.scrollTop = tEl.scrollHeight;
    return row;
  }

  // 給 translation-ui 用：算出當前行/選項的 UID（v2 一致：en-US source guid + nodeIndex + lineNumber）
  function computeLineUid(srcLine) {
    if (srcLine == null) return null;
    if (!state.activeGroup) return null;
    const groupMap = state.groups.get(state.activeGroup);
    if (!groupMap) return null;
    const enEntry = groupMap.get('en-US');
    if (!enEntry) return null;
    const proj = activeProject();
    if (!proj) return null;
    const nodeTitle = state.runtime && state.runtime.currentNodeTitle;
    if (!nodeTitle) return null;
    const nodeData = proj.nodes.get(nodeTitle);
    if (!nodeData || nodeData.nodeIndex == null) return null;
    if (typeof TranslationUI === 'undefined' || !TranslationUI.getUidFor) return null;
    return TranslationUI.getUidFor(enEntry.filename, nodeData.nodeIndex, srcLine);
  }

  // 把 transcript 行的譯文/原文挑出來：
  //   - Translation Mode off：直接回傳原文（runtime 給的 text）
  //   - Translation Mode on ：用 UID 在 TranslationState 找；找不到 → 回原文 + status=untranslated
  function getDisplayedText(originalText, srcLine) {
    if (typeof TranslationUI === 'undefined' || !TranslationUI.isActive()) {
      return { text: originalText, info: null };
    }
    const uid = computeLineUid(srcLine);
    if (!uid) return { text: originalText, info: null };
    const info = TranslationUI.lookupLine(uid, originalText);
    return { text: info.text, info };
  }

  function appendContinueAction() {
    const tEl = $('transcript');
    const btn = document.createElement('button');
    btn.className = 'continue-btn pending-action';
    btn.textContent = t('btn.continue');
    btn.onclick = advanceForward;
    tEl.appendChild(btn);
    tEl.scrollTop = tEl.scrollHeight;
    btn.focus({ preventScroll: true });
  }

  function appendChoiceActions(items) {
    const tEl = $('transcript');
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn pending-action';

      const num = document.createElement('span');
      num.className = 'choice-num';
      num.textContent = (i + 1) + '.';
      btn.appendChild(num);

      // 翻譯模式下把選項文字也換成譯文（read-only；要編輯選項請從 transcript 上重新選擇後）
      const original = item.text || '(empty)';
      const disp = getDisplayedText(original, item.srcLine);
      const txt = document.createElement('span');
      txt.innerHTML = YarnParser.markupToSafeHtml(disp.text);
      btn.appendChild(txt);

      btn.onclick = () => chooseForward(i, disp.text);
      tEl.appendChild(btn);
    });
    tEl.scrollTop = tEl.scrollHeight;
  }

  function removePendingActions() {
    document.querySelectorAll('.pending-action').forEach(el => el.remove());
  }

  // Render the action area (continue / choice buttons) inline at the end of
  // the transcript. Also keeps the source-line highlight in sync.
  function renderActions() {
    removePendingActions();
    const rt = state.runtime;
    if (rt && !rt.ended && rt.current) {
      if (rt.current.kind === 'line') appendContinueAction();
      else if (rt.current.kind === 'choices') appendChoiceActions(rt.current.items);
    }
    syncSourceHighlight();
  }

  function advanceForward() {
    removePendingActions();
    state.runtime.advance();
    appendCurrent();
    renderActions();
    pushSnapshot();
  }

  function chooseForward(idx, text) {
    removePendingActions();
    appendTranscript('chose', text);
    state.runtime.choose(idx);
    appendCurrent();
    renderActions();
    pushSnapshot();
  }

  // Append the current event to the transcript (forward-flow only).
  function appendCurrent() {
    const rt = state.runtime;
    if (!rt) return;
    if (rt.ended) {
      appendTranscript('end', t('transcript.dialogueEnded'));
      return;
    }
    if (!rt.current) return;
    // Detect mid-dialogue node jumps, refresh the header/source/note context.
    if (rt.currentNodeTitle !== $('current-node').textContent) {
      setActiveNode(rt.currentNodeTitle);
      appendTranscript('jump', t('transcript.jumpTo', { title: rt.currentNodeTitle }));
    }
    if (rt.current.kind === 'line') {
      const disp = getDisplayedText(rt.current.text, rt.current.srcLine);
      const row = appendTranscript('line', disp.text, formatSpeaker(rt.current));
      if (disp.info && typeof TranslationUI !== 'undefined' && TranslationUI.decorateLine) {
        TranslationUI.decorateLine(row, disp.info, rt.current.text);
      }
    }
    // 'choices' rows are not appended; they appear as pending-action buttons.
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §13 Snapshots + back navigation
  // ─────────────────────────────────────────────────────────────────────────

  function pushSnapshot() {
    if (!state.runtime) return;
    state.snapshots.push({
      rt: state.runtime.snapshot(),
      transcriptHtml: $('transcript').innerHTML,
      nodeTitle: state.runtime.currentNodeTitle,
    });
    if (state.snapshots.length > SNAPSHOT_LIMIT) state.snapshots.shift();
    updateBackBtn();
  }

  function rewindToSnapshot(targetIdx) {
    if (!state.runtime) return;
    if (targetIdx < 0 || targetIdx >= state.snapshots.length) return;
    state.snapshots.length = targetIdx + 1;
    const target = state.snapshots[targetIdx];
    state.runtime.restore(target.rt);
    $('transcript').innerHTML = target.transcriptHtml;
    setActiveNode(target.nodeTitle);
    renderActions();
    renderVars();
    updateBackBtn();
    const tEl = $('transcript');
    tEl.scrollTop = tEl.scrollHeight;
  }

  function backLine() {
    if (state.snapshots.length < 2) return;
    rewindToSnapshot(state.snapshots.length - 2);
  }

  function updateBackBtn() {
    const btn = $('back-line-btn');
    if (btn) btn.disabled = state.snapshots.length < 2;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §14 Resizable column splitters
  // ─────────────────────────────────────────────────────────────────────────

  const SPLITTER_VAR = {
    'sidebar-source':  { name: '--col-sidebar', sign:  1, min: 120, max: 500 },
    'source-dialogue': { name: '--col-source',  sign:  1, min: 150, max: 700 },
    'dialogue-vars':   { name: '--col-vars',    sign: -1, min: 120, max: 600 },
  };

  function loadSavedLayout() {
    const saved = lsGetJSON('yp.layout');
    if (!saved) return;
    const layout = document.querySelector('.layout');
    for (const k of Object.keys(SPLITTER_VAR)) {
      const v = saved[SPLITTER_VAR[k].name];
      if (v) layout.style.setProperty(SPLITTER_VAR[k].name, v);
    }
  }
  function saveLayout() {
    const layout = document.querySelector('.layout');
    const cs = getComputedStyle(layout);
    const out = {};
    for (const k of Object.keys(SPLITTER_VAR)) {
      const name = SPLITTER_VAR[k].name;
      out[name] = cs.getPropertyValue(name).trim();
    }
    lsSetJSON('yp.layout', out);
  }

  function initSplitters() {
    document.querySelectorAll('.splitter').forEach(splitter => {
      const cfg = SPLITTER_VAR[splitter.dataset.split];
      if (!cfg) return;
      splitter.addEventListener('mousedown', e => beginDrag(e.clientX, splitter, cfg));
      splitter.addEventListener('touchstart', e => {
        if (e.touches.length === 1) {
          e.preventDefault();
          beginDrag(e.touches[0].clientX, splitter, cfg);
        }
      }, { passive: false });
    });
  }

  function beginDrag(startX, splitter, cfg) {
    const layout = document.querySelector('.layout');
    const initial = parseFloat(getComputedStyle(layout).getPropertyValue(cfg.name)) || 0;
    splitter.classList.add('dragging');
    document.body.classList.add('dragging-splitter');

    const onMove = x => {
      const next = Math.max(cfg.min, Math.min(cfg.max, initial + cfg.sign * (x - startX)));
      layout.style.setProperty(cfg.name, next + 'px');
    };
    const onMouseMove = e => onMove(e.clientX);
    const onTouchMove = e => { onMove(e.touches[0].clientX); e.preventDefault(); };
    const stop = () => {
      splitter.classList.remove('dragging');
      document.body.classList.remove('dragging-splitter');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stop);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', stop);
      saveLayout();
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', stop);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §15 Dialogue glue (startAt / setActiveNode)
  // ─────────────────────────────────────────────────────────────────────────

  // Single source of truth for "the active node": keeps the header chip,
  // source view and note panel all in sync.
  function setActiveNode(title) {
    if (!title) return;
    $('current-node').textContent = title;
    renderSource(title);
    loadNoteForNode(title);
  }

  function startAt(nodeTitle) {
    const proj = activeProject();
    if (!proj) return;
    if (!proj.nodes.has(nodeTitle)) {
      alert(t('error.nodeNotFound', { title: nodeTitle }));
      return;
    }
    state.runtime = new YarnRuntime(proj);
    state.runtime.onVarChange = renderVars;
    $('transcript').innerHTML = '';
    setActiveNode(nodeTitle);
    state.snapshots = [];
    state.runtime.start(nodeTitle, state.varOverrides);
    renderVars();
    appendCurrent();
    renderActions();
    pushSnapshot();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §16 Init / event wiring
  // ─────────────────────────────────────────────────────────────────────────

  function init() {
    // Layout / source font preferences before anything renders.
    loadSavedLayout();
    loadSavedSourceFontSize();
    initSplitters();

    // Topbar version display.
    $('app-version').textContent = 'v' + VERSION;

    // Source font controls.
    $('src-zoom-in').addEventListener('click', () => bumpSourceFontSize(+1));
    $('src-zoom-out').addEventListener('click', () => bumpSourceFontSize(-1));
    $('source-view').addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      bumpSourceFontSize(e.deltaY < 0 ? +1 : -1);
    }, { passive: false });

    // File input + drag-drop.
    $('file-input').addEventListener('change', e => ingestFiles(e.target.files));
    document.body.addEventListener('dragover', e => {
      e.preventDefault(); document.body.classList.add('dragover');
    });
    document.body.addEventListener('dragleave', () => document.body.classList.remove('dragover'));
    document.body.addEventListener('drop', e => {
      e.preventDefault(); document.body.classList.remove('dragover');
      if (e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files);
    });

    // Top-bar selectors.
    $('script-select').addEventListener('change', e => selectGroup(e.target.value));
    $('locale-select').addEventListener('change', e => selectLocale(e.target.value));
    $('ui-lang-select').value = currentLang;
    $('ui-lang-select').addEventListener('change', e => setLang(e.target.value));

    // Dialogue toolbar buttons.
    $('replay-btn').addEventListener('click', () => {
      const title = state.runtime?.currentNodeTitle;
      if (title) startAt(title);
    });
    $('back-line-btn').addEventListener('click', backLine);

    // Source-panel tabs + note shortcut.
    document.querySelectorAll('.source-tab').forEach(btn => {
      btn.addEventListener('click', () => setSourcePanelTab(btn.dataset.tab));
    });
    $('note-toggle').addEventListener('click', () => setSourcePanelTab('notes'));
    $('note-textarea').addEventListener('blur', commitNoteValue);
    $('note-textarea').addEventListener('input', () => {
      clearTimeout(state.noteSaveTimer);
      state.noteSaveTimer = setTimeout(commitNoteValue, NOTE_DEBOUNCE_MS);
    });
    $('note-textarea').addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        commitNoteValue();
        setSourcePanelTab('source');
      }
    });

    // Transcript: per-row rewind / blank-area click-to-advance.
    $('transcript').addEventListener('click', e => {
      const rb = e.target.closest('.row-rewind');
      if (rb) {
        const idx = parseInt(rb.dataset.snapIdx, 10);
        if (!Number.isNaN(idx)) rewindToSnapshot(idx);
        return;
      }
      // 在翻譯模式的編輯器內部（含按鈕、textarea、邊距）按一下不應該推進對話
      if (e.target.closest('.t-inline-editor') || e.target.closest('.t-edit-btn')) return;
      if (e.target.closest('.choice-btn') || e.target.closest('.continue-btn')) return;
      const sel = window.getSelection?.();
      if (sel && sel.toString()) return;
      const rt = state.runtime;
      if (rt && !rt.ended && rt.current && rt.current.kind === 'line') {
        advanceForward();
      }
    });

    // Node filter input.
    $('node-filter').addEventListener('input', e => {
      state.nodeFilter = e.target.value.trim();
      refreshNodeList();
    });

    // Translation tab UI（如果模組有載入的話）。提供 hooks 讓它讀 ui.js 的 state。
    if (typeof TranslationUI !== 'undefined') {
      TranslationUI.install({
        getActiveGroup:  () => state.activeGroup,
        getActiveLocale: () => state.activeLocale,
        getAllGroups:    () => Array.from(state.groups.keys()),
        getEntry:        (group, locale) => {
          const m = state.groups.get(group);
          return m ? m.get(locale) : null;
        },
        setStatus,
        t,                                            // 翻譯字串
        applyI18n,                                    // 注入新 DOM 後重跑 i18n
        // 收到 redraw 請求 → 從當前 node 重新跑一次顯示
        requestRedraw: () => {
          const title = state.runtime && state.runtime.currentNodeTitle;
          if (title) startAt(title);
        },
      });
    }

    // Global keyboard shortcuts (skip when typing in form fields).
    document.addEventListener('keydown', e => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.target.isContentEditable) return;
      if (e.key === ' ' || e.key === 'Enter') {
        const cont = document.querySelector('.continue-btn');
        if (cont) { e.preventDefault(); cont.click(); }
      } else if (/^[1-9]$/.test(e.key)) {
        const btns = document.querySelectorAll('.choice-btn');
        const btn = btns[parseInt(e.key, 10) - 1];
        if (btn) { e.preventDefault(); btn.click(); }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault(); $('replay-btn').click();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault(); $('back-line-btn').click();
      }
    });
  }

  // Last-resort save of any unsaved note when the user closes the tab.
  window.addEventListener('beforeunload', flushPendingNote);

  // ─────────────────────────────────────────────────────────────────────────
  // §17 Bootstrap
  // ─────────────────────────────────────────────────────────────────────────

  async function bootstrap() {
    window.addEventListener('error', e => {
      console.error('[uncaught]', e.error || e.message);
      setStatus(t('status.error', { msg: e.message, at: `${e.filename}:${e.lineno}` }));
    });
    window.addEventListener('unhandledrejection', e => {
      console.error('[unhandled-rejection]', e.reason);
      setStatus(t('status.asyncError', { msg: e.reason?.message || e.reason }));
    });

    init();
    applyI18n();
    setStatus(t('status.readingManifest'));
    try {
      await loadSpeakerGenderMap();
      const ok = await tryLoadManifest();
      if (!ok) setStatus(t('status.noManifest'));
    } catch (e) {
      console.error('[bootstrap]', e);
      setStatus(t('status.bootstrapFailed', { msg: e.message }));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
