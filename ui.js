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

  const VERSION = '1.3.0';
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
  // String tables live in ui-i18n.js (loaded before ui.js) so the en+zh
  // dictionaries don't dominate this file. ui.js owns the t() / setLang()
  // / applyI18n() wiring + the lang-change broadcast.

  const I18N = (typeof window !== 'undefined' && window.YP_I18N) || { en: {}, zh: {} };

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
    for (const el of document.querySelectorAll('[data-i18n-html]')) {
      // Strings under data-i18n-html come from this file's hardcoded lang
      // tables, so innerHTML is safe here (no untrusted input flows in).
      el.innerHTML = t(el.dataset.i18nHtml);
    }
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
    }
  }

  const __langChangeListeners = new Set();
  function setLang(lang) {
    if (!I18N[lang]) lang = 'en';
    currentLang = lang;
    try { localStorage.setItem('yp.lang', lang); } catch (e) {}
    applyI18n();
    // Re-render dynamic strings (vars panel works in both pre-runtime and
    // active-runtime states now).
    renderVars();
    syncResetBtn();
    syncOverrideMarkers();
    const cont = document.querySelector('.continue-btn');
    if (cont) cont.textContent = t('btn.continue');
    // Notify sibling modules (ui-strings.js) so their dynamic
    // (non-data-i18n) text updates too.
    for (const cb of __langChangeListeners) {
      try { cb(lang); } catch (e) { console.error('[i18n] listener', e); }
    }
  }

  // Sibling-module i18n surface — exposed on window so ui-strings.js (and
  // any future sibling page) can share this app's translation table without
  // duplicating it.
  window.YP = window.YP || {};
  window.YP.t = t;
  window.YP.applyI18n = applyI18n;
  window.YP.getLang = () => currentLang;
  window.YP.onLangChange = (cb) => {
    __langChangeListeners.add(cb);
    return () => __langChangeListeners.delete(cb);
  };

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
    statusFilter: new Set(),        // sidebar status filter chips: 'untranslated'|'needsReview'|'approved'|'done'
    speakerGender: {},              // name → 'M' | 'F' | 'N'
    noteSaveTimer: null,            // debounce timer for note autosave
    noteLoadedFor: null,            // {group, title} the textarea is bound to
    lastVarValues: {},              // previous var values for change badges
    guidsRev: null,                 // {guid → en-US filename}, lazily loaded
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

  // ----- Export-state tracking (shared with translation-ui.js via hooks) -----
  // lastEditAt advances when the user edits a note or confirms an inline
  // translation override. lastExportAt advances on Export success or after
  // Import (since import replaces local state with the imported file).
  // dirty = lastEditAt > lastExportAt → topbar warns + beforeunload prompts.
  function getExportState() { return lsGetJSON('yp.exportState', {}) || {}; }
  function isExportDirty() {
    const s = getExportState();
    if (!s.lastEditAt) return false;
    if (!s.lastExportAt) return true;
    return new Date(s.lastEditAt).getTime() > new Date(s.lastExportAt).getTime();
  }
  function markEditDirty() {
    const s = getExportState();
    s.lastEditAt = new Date().toISOString();
    lsSetJSON('yp.exportState', s);
    notifyExportStateChanged();
  }
  function markExported() {
    const s = getExportState();
    s.lastExportAt = new Date().toISOString();
    lsSetJSON('yp.exportState', s);
    notifyExportStateChanged();
  }
  function notifyExportStateChanged() {
    if (typeof TranslationUI !== 'undefined' && TranslationUI.refreshExportStatus) {
      TranslationUI.refreshExportStatus();
    }
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

    // Non-source locales whose JSON 404s (e.g. fr-FR mid-translation
    // where the project hasn't bundled a fr-FR build yet) fall back to
    // sharing en-US's parsed project — the runtime needs SOME project
    // to drive playback, en-US is the canonical structure, and the
    // display layer's lookupLine still overrides text from the user's
    // imported CSV / inline edits per locale. The R2 bundle filter
    // naturally reads "every line equals en-US → 0% translated", which
    // is the correct visual signal for "this locale needs work".
    // Guard against infinite recursion if en-US itself is missing.
    const tryFallback = async (reason) => {
      if (locale === 'en-US' || !localesMap.has('en-US')) return null;
      console.warn(`[ensureLoaded] ${group}/${locale} ${reason} — falling back to en-US`);
      const enProject = await ensureLoaded(group, 'en-US');
      entry.project = enProject;
      entry.isFallbackToEnUS = true;
      return enProject;
    };

    setStatus(t('status.loading', { file: entry.filename }));
    const t0 = performance.now();
    let r;
    try {
      r = await fetch(entry.fetchUrl, { cache: 'no-cache' });
    } catch (netErr) {
      const fallback = await tryFallback(`fetch errored (${netErr.message})`);
      if (fallback) { setStatus(''); return fallback; }
      throw netErr;
    }
    if (!r.ok) {
      // 404 / 403 / 500 → only fall back for missing-file (404). Other
      // statuses indicate server config issues that should surface as
      // errors so the user knows.
      if (r.status === 404) {
        const fallback = await tryFallback(`HTTP 404`);
        if (fallback) { setStatus(''); return fallback; }
      }
      throw new Error(`HTTP ${r.status}`);
    }
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

  // ─────────────────────────────────────────────────────────────────────────
  // §7b UID Searcher
  // ─────────────────────────────────────────────────────────────────────────
  // Paste a UID ({en-US-guid}-{nodeIndex}-{srcLine}); on success the previewer
  // jumps to the matching script + node and prints the line text in the
  // currently-active locale beneath the input.

  async function ensureGuidsReverseMap() {
    if (state.guidsRev) return state.guidsRev;
    try {
      const r = await fetch('data/guids.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const rev = Object.create(null);
      for (const [filename, guid] of Object.entries(data)) {
        // Only en-US filenames are the canonical UID anchor (UIDs are computed
        // from the en-US guid + en-US nodeIndex). Skip everything else so the
        // reverse map is unambiguous.
        if (/\(en-US\)\.json$/i.test(filename)) {
          rev[guid] = filename;
        }
      }
      state.guidsRev = rev;
      return rev;
    } catch (e) {
      console.error('[uid-search] failed to load guids.json', e);
      return null;
    }
  }

  // Walk a parsed node's statement tree to find the line / option that owns
  // the given srcLine. Returns { kind, text, speaker? } or null.
  function findStatementBySrcLine(statements, srcLine) {
    for (const s of statements || []) {
      if (!s) continue;
      if (s.type === 'line' && s.srcLine === srcLine) {
        return { kind: 'line', text: s.text || '', speaker: formatSpeaker(s) };
      }
      if (s.type === 'choices') {
        for (const item of s.items || []) {
          if (item.srcLine === srcLine) {
            return { kind: 'option', text: item.text || '', speaker: '' };
          }
          if (item.body) {
            const r = findStatementBySrcLine(item.body, srcLine);
            if (r) return r;
          }
        }
      } else if (s.type === 'if') {
        const r1 = findStatementBySrcLine(s.then, srcLine);
        if (r1) return r1;
        if (s.else) {
          const r2 = findStatementBySrcLine(s.else, srcLine);
          if (r2) return r2;
        }
      }
    }
    return null;
  }

  function setUidSearchResult(state_, message) {
    const el = $('uid-search-result');
    if (!el) return;
    el.hidden = false;
    el.className = 'uid-search-result ' + state_;
    el.innerHTML = '';
    if (typeof message === 'string') {
      el.textContent = message;
    } else if (message) {
      el.appendChild(message);
    }
  }

  async function searchByUid(rawInput) {
    const uid = (rawInput || '').trim();
    if (!uid) {
      const el = $('uid-search-result');
      if (el) el.hidden = true;
      return;
    }

    // UID = "{guid}-{nodeIndex}-{srcLine}"; guid may itself contain dashes
    // (Unity hex formats vary), so anchor on the trailing two integer parts.
    const m = uid.match(/^(.+)-(\d+)-(\d+)$/);
    if (!m) {
      setUidSearchResult('error', t('uidSearch.invalidUid'));
      return;
    }
    const guid = m[1];
    const nodeIndex = parseInt(m[2], 10);
    const srcLine = parseInt(m[3], 10);

    const rev = await ensureGuidsReverseMap();
    if (!rev) {
      setUidSearchResult('error', t('uidSearch.guidsUnavailable'));
      return;
    }

    const enFilename = rev[guid];
    if (!enFilename) {
      setUidSearchResult('not-found', t('uidSearch.notFound'));
      return;
    }

    const { group } = detectLocale(enFilename);
    if (!state.groups.has(group)) {
      setUidSearchResult('not-found', t('uidSearch.notFound'));
      return;
    }

    // Switch script if needed. selectGroup() refreshes the locale dropdown
    // and triggers loadAndShowCurrent which calls ensureLoaded for the active
    // locale; so by the time it returns, activeProject() is populated.
    if (state.activeGroup !== group) {
      $('script-select').value = group;
      await selectGroup(group);
    }

    const proj = activeProject();
    if (!proj) {
      setUidSearchResult('not-found', t('uidSearch.notFound'));
      return;
    }

    // Resolve node title via en-US's authoritative ordering. If the active
    // locale's JSON happens to be reordered, the title-based lookup below
    // still gets us to the right node.
    let nodeTitle = null;
    try {
      const enProject = await ensureLoaded(group, 'en-US');
      nodeTitle = enProject.rawNodes && enProject.rawNodes[nodeIndex] && enProject.rawNodes[nodeIndex].title;
    } catch (e) {
      console.warn('[uid-search] en-US load failed, falling back to active locale', e);
    }
    if (!nodeTitle) {
      const rn = proj.rawNodes && proj.rawNodes[nodeIndex];
      nodeTitle = rn && rn.title;
    }
    if (!nodeTitle || !proj.nodes.has(nodeTitle)) {
      setUidSearchResult('not-found', t('uidSearch.notFound'));
      return;
    }

    // Navigate to the node — UID search is "find this exact line", not
    // "play through it". The translator usually wants to land on the line in
    // context, not be forced into a runtime tick.
    navigateToNode(nodeTitle);

    const node = proj.nodes.get(nodeTitle);
    const hit = findStatementBySrcLine(node.statements, srcLine);
    if (!hit) {
      setUidSearchResult('not-found', t('uidSearch.notFound'));
      return;
    }

    // Apply imported / inline-edited overrides for the active locale.
    const disp = getDisplayedText(hit.text, srcLine);
    const text = disp.text || hit.text;

    const wrap = document.createElement('div');
    const meta = document.createElement('div');
    meta.className = 'uid-search-result-meta';
    meta.textContent = `${state.activeLocale} · ${nodeTitle}`;
    wrap.appendChild(meta);
    if (hit.speaker) {
      const sp = document.createElement('div');
      sp.className = 'uid-search-result-speaker';
      sp.textContent = hit.speaker + ':';
      wrap.appendChild(sp);
    } else if (hit.kind === 'option') {
      const sp = document.createElement('div');
      sp.className = 'uid-search-result-speaker';
      sp.textContent = '→';
      wrap.appendChild(sp);
    }
    const body = document.createElement('div');
    body.className = 'uid-search-result-text';
    body.textContent = text;
    wrap.appendChild(body);

    setUidSearchResult('found', wrap);
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
    // Iterate in manifest insertion order so the dropdown follows the story
    // sequence the project authors chose, not alphabetical.
    for (const name of state.groups.keys()) {
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
    // Status filter is per-script meaningful but cross-script noise — clear
    // it so a "Has needs-review" filter picked on one script doesn't make
    // the new script appear empty.
    state.statusFilter.clear();
    renderStatusFilterBar();
    // Keep activeLocale across script switches when the new script has it.
    await refreshLocaleDropdown();
  }

  async function selectLocale(loc) {
    state.activeLocale = loc;
    await loadAndShowCurrent();
    // notifyContextChange is fired from loadAndShowCurrent itself — no
    // redundant call here.
  }

  async function loadAndShowCurrent() {
    if (!state.activeGroup || !state.activeLocale) return;
    // Active locale drives the dialogue panel — load it first (must succeed).
    try {
      await ensureLoaded(state.activeGroup, state.activeLocale);
    } catch (e) {
      console.error(e);
      setStatus(t('status.loadFailed', { msg: e.message }));
      return;
    }
    // en-US is the canonical UID source for every stats path (top progress
    // bar, sidebar dots / X/Y count, bundle-as-implicit-baseline map).
    // Without it loaded, all those compute as empty and the progress UI
    // silently disappears. Load it best-effort in parallel — failure here
    // shouldn't block the dialogue panel, just degrades the sidebar to
    // "no progress UI" (same as the pre-fix state).
    if (state.activeLocale !== 'en-US') {
      const localesMap = state.groups.get(state.activeGroup);
      if (localesMap && localesMap.has('en-US')) {
        try {
          await ensureLoaded(state.activeGroup, 'en-US');
        } catch (e) {
          console.warn('[ui] en-US auto-load for stats failed:', e.message);
        }
      }
    }
    refreshNodeList();
    const proj = activeProject();
    // Preserve which node the translator was on across locale / script swaps
    // so they don't lose their place. Playback intent is preserved too: if
    // they were actively playing that node, re-play it (so getDisplayedText
    // shows the new locale's text); if they were just navigating, stay in
    // navigation-only mode.
    const wasPlaying = !!state.runtime;
    const lastNode = currentNodeTitle();
    if (lastNode && proj.nodes.has(lastNode)) {
      navigateToNode(lastNode);
      if (wasPlaying) playFromCurrentNode();
    } else {
      // Fresh script load with no carried-over node: clear to a known empty
      // state. Vars panel still shows declared defaults so the translator
      // can pre-set branch-relevant flags before picking a node.
      state.runtime = null;
      state.snapshots = [];
      state.lastVarValues = {};
      $('transcript').innerHTML = '';
      $('current-node').textContent = '—';
      const flat = $('flat-edit-view');
      if (flat) flat.innerHTML = '';
      removePendingActions();
      updateBackBtn();
      renderVars();
      syncActiveNodeInList();
      refreshPlaybackUi();
    }
    // Refresh translation stats / progress now that the active script or
    // locale data has finished loading — getActiveProjectUids depends on
    // the en-US project being parsed.
    if (typeof TranslationUI !== 'undefined' && TranslationUI.notifyContextChange) {
      TranslationUI.notifyContextChange();
    }
  }

  let __nodeListRefreshScheduled = false;
  function scheduleNodeListRefresh() {
    if (__nodeListRefreshScheduled) return;
    __nodeListRefreshScheduled = true;
    requestAnimationFrame(() => {
      __nodeListRefreshScheduled = false;
      refreshNodeList();
    });
  }

  function refreshNodeList(activeTitleHint) {
    const list = $('node-list');
    list.innerHTML = '';
    const proj = activeProject();
    if (!proj) return;

    // Per-node status data drives both the status-filter and the dots/count.
    // Computed once per refresh; cheap (walks merged map keyed by uid).
    const perNode = collectPerNodeStats();

    let titles = [...proj.nodes.keys()];
    if (state.nodeFilter) {
      const f = state.nodeFilter.toLowerCase();
      titles = titles.filter(x => x.toLowerCase().includes(f));
    }
    if (state.statusFilter.size > 0) {
      titles = titles.filter(x => nodePassesStatusFilter(perNode.get(x)));
    }
    titles.sort((a, b) => {
      const meta = (s) => (s === '總覽' || s === '變數紀錄') ? 1 : 0;
      const ma = meta(a), mb = meta(b);
      return ma !== mb ? ma - mb : a.localeCompare(b);
    });

    // Number = position in the visible list, so it always reads 1, 2, 3 …
    // regardless of sort order or active filter.
    const padWidth = String(titles.length).length;
    const noted = state.activeGroup ? notedTitlesIn(state.activeGroup) : new Set();
    // Same caveat as syncActiveNodeInList: refreshNodeList is sometimes
    // called before runtime.start() — accept an explicit title via the
    // parameter, otherwise fall back to runtime.
    const activeTitle = activeTitleHint
      || (state.runtime && state.runtime.currentNodeTitle) || null;
    const frag = document.createDocumentFragment();
    titles.forEach((title, i) => {
      const li = document.createElement('li');
      const hasNote = noted.has(title);
      if (hasNote) li.classList.add('has-note');
      if (title === activeTitle) li.classList.add('is-active');
      li.dataset.nodeTitle = title;

      const num = document.createElement('span');
      num.className = 'node-num';
      num.textContent = String(i + 1).padStart(padWidth, '0');

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
        navigateToNode(title);
        openNote();
      });

      // Final DOM order: [num] [title] [progress?] [dots?] [noteBtn]
      // Progress + dots are present when we have stats data for this node.
      li.appendChild(num);
      li.appendChild(ttl);

      const stats = perNode.get(title);
      if (stats && stats.total > 0) {
        const progress = document.createElement('span');
        progress.className = 'node-progress-text';
        progress.textContent = `${stats.translated}/${stats.total}`;
        li.appendChild(progress);

        const dots = document.createElement('span');
        dots.className = 'node-dots';
        const dotSpec = [
          { cls: 'warn',   on: stats.untranslated > 0 },
          { cls: 'info',   on: stats.edited       > 0 },
          { cls: 'accent', on: stats.needsReview  > 0 },
          { cls: 'good',   on: stats.approved     > 0 },
        ];
        for (const d of dotSpec) {
          const dot = document.createElement('span');
          dot.className = 'node-dot node-dot-' + d.cls + (d.on ? ' active' : '');
          dots.appendChild(dot);
        }
        li.appendChild(dots);
        li.title = t('sidebar.nodeProgress.tip', {
          done: stats.translated,
          total: stats.total,
          nr: stats.needsReview,
          ap: stats.approved,
          ed: stats.edited,
        });
      } else {
        li.title = title;
      }

      li.appendChild(noteBtn);
      li.onclick = () => navigateToNode(title);
      frag.appendChild(li);
    });
    list.appendChild(frag);
    $('node-count').textContent = `(${titles.length})`;
  }

  // Sync the .is-active class on the node-list. Pass `title` explicitly
  // from navigation paths (we have it directly); omit it from playback
  // paths (mid-dialogue jumps, snapshot restore) to fall back to the
  // runtime's currentNodeTitle.
  function syncActiveNodeInList(title) {
    const list = $('node-list');
    if (!list) return;
    const activeTitle = title != null
      ? title
      : (state.runtime && state.runtime.currentNodeTitle) || null;
    let activeLi = null;
    for (const li of list.querySelectorAll('li')) {
      const on = li.dataset.nodeTitle === activeTitle;
      li.classList.toggle('is-active', on);
      if (on) activeLi = li;
    }
    if (activeLi) {
      // Keep the highlighted row in view when the runtime jumps between
      // nodes. block: 'nearest' avoids unnecessary scrolling when it's
      // already visible.
      activeLi.scrollIntoView({ block: 'nearest' });
    }
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

  // Bind the note panel to a specific node title. Takes title as a
  // parameter so it works in both navigation-only and playback states,
  // independent of whether state.runtime is set.
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
    const prev = getNote(state.noteLoadedFor.group, state.noteLoadedFor.title);
    setNote(state.noteLoadedFor.group, state.noteLoadedFor.title, text);
    if (text !== prev) markEditDirty();
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
      markEditDirty();
    }
  }

  function openNote() { setSourcePanelTab('notes'); }

  // ─────────────────────────────────────────────────────────────────────────
  // §11 Variables panel (with overrides)
  // ─────────────────────────────────────────────────────────────────────────

  // Compute the pre-runtime variable map: declared defaults from the
  // 變數紀錄 node, overlaid with any user overrides. Used to populate the
  // panel before any node has been started, so translators can adjust
  // branch-relevant flags before the runtime ticks the first line.
  function readPreRuntimeVars() {
    const proj = activeProject();
    if (!proj || typeof YarnRuntime === 'undefined' || !YarnRuntime.readDeclaredDefaults) {
      return Object.fromEntries(state.varOverrides);
    }
    const declNode = proj.nodes.get('變數紀錄');
    const defaults = declNode ? (YarnRuntime.readDeclaredDefaults(declNode.body) || {}) : {};
    for (const [k, v] of state.varOverrides) defaults[k] = v;
    return defaults;
  }

  function handleVarChange(name, value) {
    const prev = state.lastVarValues[name];
    state.lastVarValues[name] = value;
    appendVarChangeBadge(name, prev, value);
    flashVarRow(name);
    renderVars();
  }

  function appendVarChangeBadge(name, prev, next) {
    const tEl = $('transcript');
    if (!tEl) return;
    const rows = tEl.querySelectorAll('.row-line, .row-jump, .row-choice');
    const target = rows[rows.length - 1];
    if (!target) return;
    const badge = document.createElement('span');
    badge.className = 'var-change-badge';
    const fromStr = prev === undefined ? '∅' : String(prev);
    const toStr   = next === undefined ? '∅' : String(next);
    const make = (cls, txt) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = txt;
      return s;
    };
    badge.appendChild(make('vc-name', '$' + name));
    badge.appendChild(make('vc-from', fromStr));
    badge.appendChild(make('vc-arrow', '→'));
    badge.appendChild(make('vc-to', toStr));
    target.appendChild(badge);
  }

  function flashVarRow(name) {
    const panel = $('vars');
    if (!panel) return;
    const row = panel.querySelector(`.var-row[data-var-name="${CSS.escape(name)}"]`);
    if (!row) return;
    row.classList.remove('flash');
    void row.offsetWidth; // restart the animation
    row.classList.add('flash');
  }

  function renderVars() {
    const rt = state.runtime;
    const panel = $('vars');
    panel.innerHTML = '';

    // Live runtime vars when a node is playing; declared defaults + the
    // user's overrides otherwise. Either way the panel is editable.
    const source = rt ? rt.vars : readPreRuntimeVars();
    const entries = Object.entries(source).sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) {
      syncResetBtn();
      return;
    }

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
  // Works both pre-runtime (just records the override) and during a run
  // (also writes through to the live runtime + topmost snapshot).
  function updateVar(name, value) {
    state.varOverrides.set(name, value);
    if (state.runtime) {
      state.runtime.vars[name] = value;
      // Sync the topmost snapshot so backLine doesn't undo a manual edit.
      if (state.snapshots.length) {
        state.snapshots[state.snapshots.length - 1].rt.vars[name] = value;
      }
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
          // Mid-playback: re-play the active node so the cleared overrides
          // re-evaluate from the first line. Navigation-only: just re-render
          // the panel so values fall back to declared defaults.
          if (state.runtime) playFromCurrentNode();
          else renderVars();
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

  // v2-compatible UID = en-US source guid + nodeIndex + srcLine. Resolves the
  // active group's en-US filename + asks translation-ui.js for the formatted UID.
  function uidFor(nodeIndex, srcLine) {
    if (srcLine == null || nodeIndex == null) return null;
    if (!state.activeGroup) return null;
    const groupMap = state.groups.get(state.activeGroup);
    const enEntry = groupMap && groupMap.get('en-US');
    if (!enEntry) return null;
    if (typeof TranslationUI === 'undefined' || !TranslationUI.getUidFor) return null;
    return TranslationUI.getUidFor(enEntry.filename, nodeIndex, srcLine);
  }

  // Wrapper used by transcript paths: pulls nodeIndex from the currently active
  // node (works in both navigation-only and playback states).
  function computeLineUid(srcLine) {
    const proj = activeProject();
    const nodeTitle = currentNodeTitle();
    if (!proj || !nodeTitle) return null;
    const nodeData = proj.nodes.get(nodeTitle);
    return uidFor(nodeData && nodeData.nodeIndex, srcLine);
  }

  // 把 transcript 行的譯文/原文挑出來：
  //   - 已上傳譯文或站內編輯：永遠覆蓋顯示（跟 Edit Mode 無關）
  //   - 都沒有：用 runtime 給的原文（bundled JSON 內的譯文）
  // Edit Mode 只負責 ✏️ 按鈕 + 視覺裝飾（在 decorateLine 內判斷）
  function getDisplayedText(originalText, srcLine) {
    if (typeof TranslationUI === 'undefined') {
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
      // Wrapper carries pending-action + translation data; decorateLine attaches
      // ✏️ and the inline editor here as siblings of the button (textarea inside
      // a <button> would be invalid HTML).
      const wrap = document.createElement('div');
      wrap.className = 'row row-choice pending-action';

      const btn = document.createElement('button');
      btn.className = 'choice-btn';

      const num = document.createElement('span');
      num.className = 'choice-num';
      num.textContent = (i + 1) + '.';
      btn.appendChild(num);

      const original = item.text || '(empty)';
      const disp = getDisplayedText(original, item.srcLine);
      const txt = document.createElement('span');
      txt.className = 'choice-text';
      txt.innerHTML = YarnParser.markupToSafeHtml(disp.text);
      btn.appendChild(txt);

      // Click uses live text so an edited translation is what gets recorded.
      btn.onclick = () => chooseForward(i, txt.textContent || disp.text);
      wrap.appendChild(btn);

      if (disp.info && typeof TranslationUI !== 'undefined' && TranslationUI.decorateLine) {
        TranslationUI.decorateLine(wrap, disp.info, original);
      }

      tEl.appendChild(wrap);
    });
    tEl.scrollTop = tEl.scrollHeight;
  }

  function removePendingActions() {
    document.querySelectorAll('.pending-action').forEach(el => el.remove());
  }

  // Refresh translation visuals + swap between runtime preview and flat edit view.
  // Called on Edit Mode toggle, inline edit confirm, locale upload, and node change.
  // - When Edit Mode is ON: hide transcript, render the current node fully expanded
  //   (every line, every option, every if-branch) in the flat edit view.
  // - When Edit Mode is OFF: hide flat view, runtime preview comes back unchanged.
  // Existing transcript rows are also refreshed in place so edits made in flat view
  // appear when the user switches back.
  function redrawTranslationsInPlace() {
    if (typeof TranslationUI === 'undefined' || !TranslationUI.lookupLine) return;
    const editMode = !!(TranslationUI.isActive && TranslationUI.isActive());
    document.body.classList.toggle('t-edit-mode', editMode);

    const tEl = $('transcript');
    const refresh = (rowEl, textSelector) => {
      const uid = rowEl.dataset.tUid;
      const original = rowEl.dataset.tOriginal;
      if (!uid) return;
      const info = TranslationUI.lookupLine(uid, original);
      const textEl = rowEl.querySelector(textSelector);
      if (textEl && typeof YarnParser !== 'undefined') {
        textEl.innerHTML = YarnParser.markupToSafeHtml(info.text);
      }
      rowEl.classList.remove('t-line', 't-untranslated', 't-overridden');
      const oldBtn = rowEl.querySelector(':scope > .t-edit-btn');
      if (oldBtn) oldBtn.remove();
      const oldEditor = rowEl.querySelector(':scope > .t-inline-editor');
      if (oldEditor) oldEditor.remove();
      if (TranslationUI.decorateLine) {
        TranslationUI.decorateLine(rowEl, info, original);
      }
    };
    tEl.querySelectorAll('.row-line[data-t-uid]').forEach(row => refresh(row, '.text'));
    tEl.querySelectorAll('.row-choice[data-t-uid]').forEach(row => refresh(row, '.choice-text'));

    if (editMode) renderFlatEditView();
  }

  // Lazy-create the flat edit view container as a sibling of #transcript.
  function getFlatViewEl() {
    let el = $('flat-edit-view');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'flat-edit-view';
    el.className = 'flat-edit-view';
    const tEl = $('transcript');
    tEl.parentNode.insertBefore(el, tEl.nextSibling);
    return el;
  }

  // Render the current node fully expanded for translator editing.
  function renderFlatEditView() {
    const view = getFlatViewEl();
    view.innerHTML = '';
    const proj = activeProject();
    if (!proj) return;
    // Edit Mode is independent of playback — use the canonical title source
    // so the flat view follows navigation, not just the runtime.
    const title = currentNodeTitle();
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
    const perNodeIndex = collectPerNodeUidIndex();
    const nodeUids = perNodeIndex.get(title);
    const isSrc = !state.activeLocale
      || state.activeLocale === 'en-US' || state.activeLocale === 'zh-TW'
      || state.activeLocale === 'unknown';
    if (!isSrc && nodeUids && nodeUids.size > 0) {
      const actions = document.createElement('span');
      actions.className = 'flat-node-actions';

      const approveAll = document.createElement('button');
      approveAll.type = 'button';
      approveAll.className = 'flat-bulk-btn approve';
      approveAll.textContent = t('tr.bulk.approveAll', { n: nodeUids.size });
      approveAll.title = t('tr.bulk.approveAll.tip');
      approveAll.addEventListener('click', () => {
        if (!confirm(t('tr.bulk.confirm.approve', { n: nodeUids.size }))) return;
        if (typeof TranslationUI !== 'undefined' && TranslationUI.bulkSetStatusForActiveLocale) {
          TranslationUI.bulkSetStatusForActiveLocale(nodeUids, 'approved');
        }
      });
      actions.appendChild(approveAll);

      const clearAll = document.createElement('button');
      clearAll.type = 'button';
      clearAll.className = 'flat-bulk-btn clear';
      clearAll.textContent = t('tr.bulk.clearAll', { n: nodeUids.size });
      clearAll.title = t('tr.bulk.clearAll.tip');
      clearAll.addEventListener('click', () => {
        if (!confirm(t('tr.bulk.confirm.clear', { n: nodeUids.size }))) return;
        if (typeof TranslationUI !== 'undefined' && TranslationUI.bulkSetStatusForActiveLocale) {
          TranslationUI.bulkSetStatusForActiveLocale(nodeUids, null);
        }
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
    if (stmt.speaker) {
      const sp = document.createElement('span');
      sp.className = 'speaker';
      renderSpeakerInto(sp, formatSpeaker(stmt));
      row.appendChild(sp);
      row.appendChild(document.createTextNode(': '));
    }
    const original = stmt.text || '';
    const uid = uidFor(nodeCtx.nodeIndex, stmt.srcLine);
    const info = uid && TranslationUI.lookupLine
      ? TranslationUI.lookupLine(uid, original)
      : { text: original, status: 'inactive', uid: null };
    const tx = document.createElement('span');
    tx.className = 'text';
    tx.innerHTML = YarnParser.markupToSafeHtml(info.text);
    row.appendChild(tx);
    container.appendChild(row);
    if (info.uid && TranslationUI.decorateLine) {
      TranslationUI.decorateLine(row, info, original);
    }
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
      const uid = uidFor(nodeCtx.nodeIndex, item.srcLine);
      const info = uid && TranslationUI.lookupLine
        ? TranslationUI.lookupLine(uid, original)
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
      if (info.uid && TranslationUI.decorateLine) {
        TranslationUI.decorateLine(row, info, original);
      }
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
  // navigate there and scroll once the flat view rebuilds.
  function jumpToLabel(labelName) {
    const view = $('flat-edit-view');
    if (!view) return;
    const sel = `[data-label-name="${CSS.escape(labelName)}"]`;
    let target = view.querySelector(sel);
    if (target) { flashFlatTarget(target); return; }
    const proj = activeProject();
    const ownerNode = proj && proj.globalLabels && proj.globalLabels.get(labelName);
    if (!ownerNode) return;  // unknown label — silent no-op
    // Edit Mode flat view — jumping to a label in another node is a
    // navigation action, not a playback action. navigateToNode triggers
    // refreshAuxModes which re-renders the flat view for the owner node.
    navigateToNode(ownerNode);
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

  // Walk the active script's en-US project; for every translatable line /
  // choice option, call visit(uid, node). Centralises the AST traversal so
  // collectActiveProjectUids + collectPerNodeUidIndex share one walker.
  function walkTranslatableUids(visit) {
    if (!state.activeGroup) return;
    const groupMap = state.groups.get(state.activeGroup);
    if (!groupMap) return;
    const enEntry = groupMap.get('en-US');
    if (!enEntry || !enEntry.project) return;
    if (typeof TranslationUI === 'undefined' || !TranslationUI.getUidFor) return;
    const visitStmts = (statements, node) => {
      for (const s of statements) {
        if (s.type === 'line') {
          const uid = TranslationUI.getUidFor(enEntry.filename, node.nodeIndex, s.srcLine);
          if (uid) visit(uid, node);
        } else if (s.type === 'choices') {
          for (const item of s.items) {
            const uid = TranslationUI.getUidFor(enEntry.filename, node.nodeIndex, item.srcLine);
            if (uid) visit(uid, node);
            if (item.body) visitStmts(item.body, node);
          }
        } else if (s.type === 'if') {
          if (s.then) visitStmts(s.then, node);
          if (s.else) visitStmts(s.else, node);
        }
      }
    };
    for (const node of enEntry.project.nodes.values()) {
      if (!node || !node.statements) continue;
      visitStmts(node.statements, node);
    }
  }

  // Cache key on en-US project identity — stable for an entry's lifetime,
  // only replaced when the script reloads. Stats updates reuse cached result
  // across keystrokes / inline edits without re-walking thousands of nodes.
  const __projectUidCache = new WeakMap();        // project → Set<uid>
  const __projectPerNodeUidCache = new WeakMap(); // project → Map<title, Set<uid>>

  function activeEnProject() {
    if (!state.activeGroup) return null;
    const groupMap = state.groups.get(state.activeGroup);
    const enEntry = groupMap && groupMap.get('en-US');
    return enEntry && enEntry.project || null;
  }

  function collectActiveProjectUids() {
    const proj = activeEnProject();
    if (!proj) return new Set();
    const cached = __projectUidCache.get(proj);
    if (cached) return cached;
    const out = new Set();
    walkTranslatableUids((uid) => out.add(uid));
    __projectUidCache.set(proj, out);
    return out;
  }

  function collectPerNodeUidIndex() {
    const proj = activeEnProject();
    if (!proj) return new Map();
    const cached = __projectPerNodeUidCache.get(proj);
    if (cached) return cached;
    const out = new Map();
    walkTranslatableUids((uid, node) => {
      let bucket = out.get(node.title);
      if (!bucket) { bucket = new Set(); out.set(node.title, bucket); }
      bucket.add(uid);
    });
    __projectPerNodeUidCache.set(proj, out);
    return out;
  }

  // Run per-node stats through the active locale's TranslationState. Returns
  // Map<title, {total, translated, baselineTranslated, edited, untranslated,
  //             needsReview, approved}>. Source locales return all-translated.
  function collectPerNodeStats() {
    if (typeof TranslationUI === 'undefined'
        || !TranslationUI.perNodeStatsForActiveLocale) {
      return new Map();
    }
    return TranslationUI.perNodeStatsForActiveLocale(collectPerNodeUidIndex());
  }

  // Build a Map<uid, bundledText> for one locale, where uid uses the en-US
  // canonical key (en-US filename's GUID + en-US nodeIndex + en-US srcLine)
  // and text comes from that locale's bundled .json. Used by translation-ui
  // to treat the bundled translation as an implicit baseline — so locales
  // whose translations were already locked in the project (es-ES / it-IT /
  // ru-RU / ja-JP / zh-CN) don't show as untranslated just because the user
  // never imported a CSV for them.
  //
  // AST-position alignment handles CJK srcLine drift: en-US's srcLine drives
  // the UID, active locale contributes the text at the same AST index.
  //
  // Caching: per-(locale project) WeakMap. The project object identity is
  // stable for an entry's lifetime; replaced on script reload, which
  // naturally invalidates.
  const __bundleTextCache = new WeakMap();   // localeProject → Map<uid, text>
  function collectLocaleBundleMap(locale, group) {
    if (!locale) return new Map();
    if (locale === 'en-US' || locale === 'zh-TW' || locale === 'unknown') {
      return new Map();
    }
    if (group == null) group = state.activeGroup;
    if (!group) return new Map();
    const groupMap = state.groups.get(group);
    if (!groupMap) return new Map();
    const enEntry = groupMap.get('en-US');
    const localeEntry = groupMap.get(locale);
    if (!enEntry || !enEntry.project) return new Map();
    if (!localeEntry || !localeEntry.project) return new Map();
    if (typeof TranslationUI === 'undefined' || !TranslationUI.getUidFor) return new Map();

    // 404-fallback: when the locale has no bundle JSON of its own,
    // ensureLoaded points its project at en-US's so the runtime can play
    // dialogue. Treat that as "no real bundle data" — bundle map stays
    // empty, stats show 0/N (correct: nothing translated yet for this
    // locale). Without this short-circuit the next loop would walk en-US
    // against itself and add every line, falsely showing 100%.
    if (localeEntry.isFallbackToEnUS) return new Map();

    const cached = __bundleTextCache.get(localeEntry.project);
    if (cached) return cached;

    const out = new Map();
    for (const [title, enNode] of enEntry.project.nodes) {
      const localeNode = localeEntry.project.nodes.get(title);
      if (!localeNode) continue;
      const enArr = flattenComparableEntries(enNode);
      const localeArr = flattenComparableEntries(localeNode);
      const len = Math.min(enArr.length, localeArr.length);
      for (let i = 0; i < len; i++) {
        const e = enArr[i];
        const l = localeArr[i];
        if (e.srcLine == null) continue;
        const txt = (l.text || '').toString();
        if (!txt.trim()) continue;
        // Simple rule: non-empty bundle text counts as translated. We
        // trust the bundler to leave missing lines empty (project policy)
        // and trust translators to put real translations in the cells —
        // no equality-with-en-US check here, because that would falsely
        // flag legitimate same-as-source lines (proper nouns "Microsoft" /
        // "OK" / character names like "Mira"). The only "missing data"
        // shape we have to defend against is the 404-fallback case above,
        // where there's no real bundle at all.
        const uid = TranslationUI.getUidFor(enEntry.filename, enNode.nodeIndex, e.srcLine);
        if (uid) out.set(uid, txt);
      }
    }
    __bundleTextCache.set(localeEntry.project, out);
    return out;
  }

  // Union the bundle map across every group that has BOTH en-US and the
  // target locale loaded — not just the active one. The export pipeline
  // (buildSyntheticSource) emits rows from every loaded en-US group; without
  // this, rows from non-active groups would have empty translation cells in
  // the exported CSV even though the data sits in the locale's bundled .json.
  // Each per-group call still hits the WeakMap cache, so re-export is cheap.
  function collectLocaleBundleMapAllGroups(locale) {
    if (!locale || locale === 'en-US' || locale === 'zh-TW' || locale === 'unknown') {
      return new Map();
    }
    const out = new Map();
    for (const [group, localesMap] of state.groups) {
      if (!localesMap.has('en-US') || !localesMap.has(locale)) continue;
      const m = collectLocaleBundleMap(locale, group);
      for (const [uid, text] of m) out.set(uid, text);
    }
    return out;
  }

  // Best-effort auto-load every (group × locale) combo needed for a
  // complete export. Does not throw — failures are logged and skipped
  // (the export still proceeds with whatever loaded). Resolves once all
  // pending loads settle so the caller can build the source + bundle
  // with confidence.
  async function ensureAllGroupsLoadedFor(locale) {
    const groups = Array.from(state.groups.keys());
    const tasks = [];
    for (const g of groups) {
      const localesMap = state.groups.get(g);
      if (!localesMap) continue;
      // en-US: needed for UID computation + buildSyntheticSource rows.
      const en = localesMap.get('en-US');
      if (en && !en.project) {
        tasks.push(ensureLoaded(g, 'en-US')
          .catch(e => console.warn('[export]', g, 'en-US', e.message)));
      }
      // Target locale: needed for the bundle-as-implicit-baseline fallback.
      // Skip when the script doesn't ship that locale at all (manifest miss).
      if (locale && locale !== 'en-US') {
        const tgt = localesMap.get(locale);
        if (tgt && !tgt.project) {
          tasks.push(ensureLoaded(g, locale)
            .catch(e => console.warn('[export]', g, locale, e.message)));
        }
      }
    }
    if (tasks.length) await Promise.all(tasks);
  }

  function nodePassesStatusFilter(stats) {
    if (!state.statusFilter || state.statusFilter.size === 0) return true;
    if (!stats) return true;   // no data yet — don't hide anything
    // OR semantics across selected filters.
    for (const f of state.statusFilter) {
      if (f === 'untranslated' && stats.untranslated > 0) return true;
      if (f === 'needsReview'  && stats.needsReview  > 0) return true;
      if (f === 'approved'     && stats.approved     > 0) return true;
      if (f === 'done' && stats.untranslated === 0 && stats.needsReview === 0
          && stats.total > 0) return true;
    }
    return false;
  }

  function toggleStatusFilter(filter) {
    if (!filter) {
      state.statusFilter.clear();
    } else if (state.statusFilter.has(filter)) {
      state.statusFilter.delete(filter);
    } else {
      state.statusFilter.add(filter);
    }
    renderStatusFilterBar();
    refreshNodeList();
  }

  function clearStatusFilter() {
    state.statusFilter.clear();
    renderStatusFilterBar();
    refreshNodeList();
  }

  function renderStatusFilterBar() {
    const bar = $('status-filter-bar');
    if (!bar) return;
    bar.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'status-filter-label';
    label.textContent = t('sidebar.statusFilter.label');
    bar.appendChild(label);

    const chips = [
      { key: null,             i18n: 'sidebar.statusFilter.all',           tip: 'sidebar.statusFilter.all.tip',           cls: 'all' },
      { key: 'untranslated',   i18n: 'sidebar.statusFilter.untranslated',  tip: 'sidebar.statusFilter.untranslated.tip',  cls: 'warn' },
      { key: 'needsReview',    i18n: 'sidebar.statusFilter.needsReview',   tip: 'sidebar.statusFilter.needsReview.tip',   cls: 'accent' },
      { key: 'approved',       i18n: 'sidebar.statusFilter.approved',      tip: 'sidebar.statusFilter.approved.tip',      cls: 'good' },
      { key: 'done',           i18n: 'sidebar.statusFilter.done',          tip: 'sidebar.statusFilter.done.tip',          cls: 'done' },
    ];
    const allActive = state.statusFilter.size === 0;
    for (const c of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'status-filter-chip status-filter-chip-' + c.cls;
      const isActive = c.key === null ? allActive : state.statusFilter.has(c.key);
      if (isActive) btn.classList.add('active');
      const dot = document.createElement('span');
      dot.className = 'status-filter-dot';
      btn.appendChild(dot);
      const lbl = document.createElement('span');
      lbl.textContent = t(c.i18n);
      btn.appendChild(lbl);
      btn.title = t(c.tip);
      btn.addEventListener('click', () => toggleStatusFilter(c.key));
      bar.appendChild(btn);
    }
  }

  // Walk a parsed node DFS, yield every translatable entry (line / option) in
  // display order keyed by srcLine. Used by collectLocaleBundleMap to align
  // en-US AST positions with locale AST positions — locale .json bodies
  // sometimes have extra blank lines that shift srcLine while the AST shape
  // stays parallel.
  function flattenComparableEntries(node) {
    const out = [];
    if (!node || !node.statements) return out;
    function walk(stmts) {
      for (const s of stmts) {
        if (!s) continue;
        if (s.type === 'line') {
          out.push({
            kind: 'line',
            srcLine: s.srcLine,
            speaker: formatSpeaker(s),
            rawSpeaker: s.speaker || '',
            text: s.text || '',
          });
        } else if (s.type === 'choices') {
          for (const item of (s.items || [])) {
            out.push({
              kind: 'option',
              srcLine: item.srcLine,
              speaker: '',
              rawSpeaker: '',
              text: item.text || '',
              cond: item.cond || null,
            });
            if (item.body && item.body.length) walk(item.body);
          }
        } else if (s.type === 'if') {
          walk(s.then || []);
          if (s.else) walk(s.else);
        }
      }
    }
    walk(node.statements);
    return out;
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
    if (state.runtime.ended) refreshPlaybackUi();
  }

  function chooseForward(idx, text) {
    removePendingActions();
    appendTranscript('chose', text);
    state.runtime.choose(idx);
    appendCurrent();
    renderActions();
    pushSnapshot();
    if (state.runtime.ended) refreshPlaybackUi();
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
    refreshPlaybackUi();   // covers updateBackBtn + Play visibility (runtime.ended may flip)
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
  // §15 Dialogue glue (navigateToNode / playFromCurrentNode / setActiveNode)
  // ─────────────────────────────────────────────────────────────────────────

  // Single source of truth for "the active node": keeps the header chip,
  // source view and note panel all in sync.
  function setActiveNode(title) {
    if (!title) return;
    $('current-node').textContent = title;
    renderSource(title);
    loadNoteForNode(title);
    syncActiveNodeInList(title);
  }

  // Two-state playback model:
  //   navigateToNode(title)     → runtime = null (read-only browsing)
  //   playFromCurrentNode()     → constructs + starts the runtime
  // The "constructed-but-not-started" middle state that used to exist inside
  // startAt is gone, so any code that reads state.runtime sees a binary:
  // either there is one and it's running, or there isn't.

  function navigateToNode(title) {
    const proj = activeProject();
    if (!proj || !title) return;
    if (!proj.nodes.has(title)) {
      alert(t('error.nodeNotFound', { title }));
      return;
    }
    state.runtime = null;
    state.snapshots = [];
    state.lastVarValues = {};
    $('transcript').innerHTML = '';
    setActiveNode(title);
    removePendingActions();
    renderVars();              // declared defaults + user overrides
    refreshPlaybackUi();       // toggle play vs step-back/replay enable
    renderEmptyState();        // "press ▶ to start" placeholder
    // Edit Mode follows the active node directly — it never needed the
    // runtime, so refresh on navigation.
    refreshAuxModes();
  }

  // Tear down the runtime and return to navigation-only state for the same
  // node. The transcript clears, snapshots are dropped, the placeholder
  // re-appears — same shape as if the user had just clicked the node from
  // the sidebar without ever pressing ▶.
  function stopPlayback() {
    const title = currentNodeTitle();
    if (!title) return;
    navigateToNode(title);
  }

  function playFromCurrentNode() {
    const proj = activeProject();
    const title = state.runtime ? state.runtime.currentNodeTitle : currentNodeTitle();
    if (!proj || !title) return;
    if (!proj.nodes.has(title)) {
      alert(t('error.nodeNotFound', { title }));
      return;
    }
    state.runtime = new YarnRuntime(proj);
    state.lastVarValues = {};
    state.runtime.onVarChange = handleVarChange;
    state.snapshots = [];
    $('transcript').innerHTML = '';
    state.runtime.start(title, state.varOverrides);
    renderVars();
    appendCurrent();
    renderActions();
    pushSnapshot();
    refreshPlaybackUi();
    refreshAuxModes();
  }

  // Read whichever node is currently focused — runtime title preferred when
  // playing, falls back to the dialogue header (set by setActiveNode).
  function currentNodeTitle() {
    if (state.runtime && state.runtime.currentNodeTitle) {
      return state.runtime.currentNodeTitle;
    }
    const headerTxt = $('current-node').textContent;
    return (headerTxt && headerTxt !== '—') ? headerTxt : null;
  }

  function refreshAuxModes() {
    if (typeof TranslationUI !== 'undefined' && TranslationUI.isActive && TranslationUI.isActive()) {
      redrawTranslationsInPlace();
    }
  }

  // Show / hide the empty-state placeholder when the transcript has no rows.
  // Cleared automatically by appendCurrent / appendChoiceActions writing into
  // the transcript, which knock the placeholder out of sight.
  function renderEmptyState() {
    const tEl = $('transcript');
    if (!tEl) return;
    const playing = !!state.runtime;
    const title = currentNodeTitle();
    if (playing || !title) {
      const ph = tEl.querySelector('.transcript-empty');
      if (ph) ph.remove();
      return;
    }
    if (tEl.querySelector('.transcript-empty')) return;
    const ph = document.createElement('div');
    ph.className = 'transcript-empty';
    ph.innerHTML =
      `<button type="button" class="transcript-empty-icon"
         data-i18n-title="btn.play.tip" aria-label="Play">▶</button>` +
      `<div class="transcript-empty-text" data-i18n="transcript.pressPlay"></div>`;
    ph.querySelector('.transcript-empty-icon').addEventListener('click', playFromCurrentNode);
    tEl.appendChild(ph);
    applyI18n();
  }

  // Sync the dialogue toolbar to the current playback state.
  //   #play-btn    — same element throughout. ▶ Play when idle (no runtime
  //                  or ended); ■ Stop while playing. Click dispatches
  //                  on current state, so the click handler stays one line.
  //   ⟳ Replay     — always present; only meaningful with a node selected
  //   ← Step back  — handled by updateBackBtn (snapshot-count aware)
  function refreshPlaybackUi() {
    const playing = !!state.runtime && !state.runtime.ended;
    const hasNode = !!currentNodeTitle();
    const playBtn = $('play-btn');
    const replayBtn = $('replay-btn');
    if (playBtn) {
      playBtn.disabled = !hasNode;
      const key = playing ? 'btn.stop' : 'btn.play';
      const tipKey = playing ? 'btn.stop.tip' : 'btn.play.tip';
      playBtn.dataset.i18n = key;
      playBtn.dataset.i18nTitle = tipKey;
      playBtn.textContent = t(key);
      playBtn.title = t(tipKey);
      playBtn.classList.toggle('is-stop', playing);
    }
    if (replayBtn) replayBtn.disabled = !hasNode;
    updateBackBtn();
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

    // Toolbar starts in "no node selected" state — Play disabled, Step
    // back / Replay disabled. loadAndShowCurrent will refresh once a
    // script + locale combination loads.
    refreshPlaybackUi();

    // Source font controls.
    $('src-zoom-in').addEventListener('click', () => bumpSourceFontSize(+1));
    $('src-zoom-out').addEventListener('click', () => bumpSourceFontSize(-1));
    $('source-view').addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      bumpSourceFontSize(e.deltaY < 0 ? +1 : -1);
    }, { passive: false });

    // Help (?) modal — open on button click, close on backdrop / × / Esc.
    const helpOverlay = $('help-overlay');
    const openHelp = () => { helpOverlay.hidden = false; };
    const closeHelp = () => { helpOverlay.hidden = true; };
    $('help-btn').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    helpOverlay.addEventListener('click', e => {
      if (e.target === helpOverlay) closeHelp();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !helpOverlay.hidden) closeHelp();
    });

    // Drag-drop fallback for loading per-locale .json directly (dev / no manifest).
    document.body.addEventListener('dragover', e => {
      e.preventDefault(); document.body.classList.add('dragover');
    });
    document.body.addEventListener('dragleave', () => document.body.classList.remove('dragover'));
    document.body.addEventListener('drop', e => {
      e.preventDefault(); document.body.classList.remove('dragover');
      if (e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files);
    });

    // UID Searcher (sidebar). Submit jumps to the matching script + node and
    // prints the line beneath the input. Empty submissions clear the result.
    const uidForm = $('uid-search-form');
    const uidInput = $('uid-search-input');
    if (uidForm && uidInput) {
      uidForm.addEventListener('submit', (e) => {
        e.preventDefault();
        searchByUid(uidInput.value).catch(err => {
          console.error('[uid-search]', err);
          setUidSearchResult('error', err.message || String(err));
        });
      });
      // Clear the result the moment the input is emptied so stale messages
      // don't linger after the translator deletes the text.
      uidInput.addEventListener('input', () => {
        if (!uidInput.value.trim()) {
          const el = $('uid-search-result');
          if (el) el.hidden = true;
        }
      });
    }

    // Top-bar selectors.
    $('script-select').addEventListener('change', e => selectGroup(e.target.value));
    $('locale-select').addEventListener('change', e => selectLocale(e.target.value));
    $('ui-lang-select').value = currentLang;
    $('ui-lang-select').addEventListener('change', e => setLang(e.target.value));

    // Dialogue toolbar buttons. Play / Stop are the same element; dispatch
    // on the current playback state.
    $('play-btn').addEventListener('click', () => {
      if (state.runtime && !state.runtime.ended) stopPlayback();
      else playFromCurrentNode();
    });
    $('replay-btn').addEventListener('click', () => {
      if (currentNodeTitle()) playFromCurrentNode();
    });
    $('back-line-btn').addEventListener('click', backLine);

    // Source-panel tabs + note shortcut.
    document.querySelectorAll('.source-tab').forEach(btn => {
      btn.addEventListener('click', () => setSourcePanelTab(btn.dataset.tab));
    });
    $('note-toggle').addEventListener('click', () => setSourcePanelTab('notes'));

    // Click the current node title to scroll the source view back to top.
    const headerTitle = $('current-node');
    if (headerTitle) {
      headerTitle.style.cursor = 'pointer';
      headerTitle.title = t('tooltip.scrollSourceTop');
      headerTitle.addEventListener('click', () => {
        const view = $('source-view');
        if (view) view.scrollTop = 0;
      });
    }
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
        // Non-destructive redraw: refresh translation visuals on existing
        // transcript rows + pending choices. Toggling Edit Mode or saving an
        // inline edit no longer rewinds the dialogue. Sidebar dots / counts
        // are derived from the same translation data so refresh together.
        requestRedraw: () => {
          redrawTranslationsInPlace();
          scheduleNodeListRefresh();
        },
        // Notes round-trip hooks (export/import preserves translator notes).
        getNote: (group, title) => getNote(group, title),
        setNote: (group, title, text) => {
          setNote(group, title, text);
          // Coalesce rapid bursts (translation import restores hundreds of
          // notes in a tight loop, each previously triggered a full DOM
          // rebuild + re-highlight, which made the active node flash off).
          if (state.activeGroup === group) scheduleNodeListRefresh();
          if (state.noteLoadedFor && state.noteLoadedFor.group === group && state.noteLoadedFor.title === title) {
            $('note-textarea').value = text || '';
            $('notes-tab-btn').classList.toggle('has-note', !!text);
            $('note-toggle').classList.toggle('has-note', !!text);
          }
        },
        // Export-state tracking. translation-ui.js calls markEditDirty after
        // an inline translation edit and markExported after a successful
        // Import or Export. ui.js renders the dirty indicator in the topbar.
        markEditDirty,
        markExported,
        getExportState,
        isExportDirty,
        // Translatable UID set for the active script (en-US baseline). Used
        // by the stats / progress bar to render "X / Y translated".
        getActiveProjectUids: collectActiveProjectUids,
        // Bundled-translation map for any locale (Map<uid, text>). Used as
        // implicit baseline so locales with locked .json translations don't
        // show as untranslated when the user hasn't imported a CSV. Empty
        // for source locales / when projects aren't loaded.
        getLocaleBundleMap: collectLocaleBundleMap,
        // Same as above but spans every loaded group — used by the export
        // pipeline so rows from non-active scripts also get bundle text.
        getLocaleBundleMapAllGroups: collectLocaleBundleMapAllGroups,
        // Async pre-loader the export pipeline awaits before building the
        // synthetic source + bundle, ensuring the CSV covers every script
        // in the manifest (not just ones the user has manually visited).
        ensureAllGroupsLoadedFor,
        // Click on a global breakdown segment → toggle the matching sidebar
        // status filter chip (cross-component wiring so the breakdown
        // disclosure is actionable, not just informational).
        toggleStatusFilter,
      });
      // First-time render of the sidebar status-filter chip bar.
      renderStatusFilterBar();
      applyI18n();
    }

    // Re-render sidebar chips on UI language switch so labels follow the
    // active language.
    if (window.YP && window.YP.onLangChange) {
      window.YP.onLangChange(() => renderStatusFilterBar());
    }

    // Global keyboard shortcuts (skip when typing in form fields).
    document.addEventListener('keydown', e => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.target.isContentEditable) return;
      if (e.key === ' ' || e.key === 'Enter') {
        // Playback advance vs first-press play: same key does both, which
        // matches the visual model — pressing space when the play button is
        // showing does the same thing as clicking it.
        const cont = document.querySelector('.continue-btn');
        if (cont) { e.preventDefault(); cont.click(); return; }
        if (!state.runtime && currentNodeTitle()) {
          e.preventDefault(); playFromCurrentNode();
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const btns = document.querySelectorAll('.choice-btn');
        const btn = btns[parseInt(e.key, 10) - 1];
        if (btn) { e.preventDefault(); btn.click(); }
      } else if (e.key === 'r' || e.key === 'R') {
        if (currentNodeTitle()) { e.preventDefault(); playFromCurrentNode(); }
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        if (state.runtime) { e.preventDefault(); backLine(); }
      }
    });
  }

  // Last-resort save of any unsaved note when the user closes the tab, plus
  // a "you have unexported edits" prompt if the dirty flag is set.
  window.addEventListener('beforeunload', (e) => {
    flushPendingNote();
    if (isExportDirty()) {
      e.preventDefault();
      // Modern browsers ignore the message but still show a generic prompt
      // when returnValue is non-empty.
      e.returnValue = '';
      return '';
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §17 Bootstrap
  // ─────────────────────────────────────────────────────────────────────────

  // Top-level page tabs (Dialogue / UI Strings). Body class drives which
  // page is visible; CSS in ui-strings.js handles UI-strings-specific show
  // / hide. Persisted across reloads via yp.activePage.
  function initPageTabs() {
    const tabs = document.querySelectorAll('.page-tab');
    if (!tabs.length) return;
    const setPage = (name) => {
      tabs.forEach(b => {
        const on = b.dataset.page === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.body.classList.toggle('page-ui-strings', name === 'ui-strings');
      lsSet('yp.activePage', name);
      if (name === 'ui-strings' && typeof UIStrings !== 'undefined' && UIStrings.show) {
        UIStrings.show();
      }
    };
    tabs.forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));
    const saved = lsGet('yp.activePage', 'dialogue');
    setPage(saved === 'ui-strings' ? 'ui-strings' : 'dialogue');
  }

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
    if (typeof UIStrings !== 'undefined' && UIStrings.init) {
      try { UIStrings.init(); } catch (e) { console.error('[ui-strings] init failed', e); }
    }
    initPageTabs();
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
