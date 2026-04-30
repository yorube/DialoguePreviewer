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
      'tr.editMode.help.tip': 'Open the Edit Mode help (flat view symbols, ✏️ inline editor, clickable goto labels, …)',
      'tr.editMode.help.title': 'Edit Mode operation guide',
      'tr.editMode.help.body': `
<p><b>What Edit Mode does.</b> The dialogue panel switches from the runtime preview to a <b>flat editing view</b>: the entire current node — every line, every option, every <code>&lt;&lt;if&gt;&gt;</code> branch — is expanded into one scrollable page. You sweep through it top-to-bottom instead of clicking choices to reach lines. Toggle Edit Mode off to return to the runtime preview; your edits show up there too.</p>

<h3>Edit a single line</h3>
<ul>
  <li>Hover any line or option → click the <b>✏️</b> icon → an inline editor opens.</li>
  <li>Save with <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> or the <b>✓</b> button. Cancel with <kbd>Esc</kbd> or <b>✗</b>.</li>
</ul>

<h3>Symbols in the flat view</h3>
<ul>
  <li><span style="color:#88c8ff;font-weight:600">→ 1.</span>, <span style="color:#88c8ff;font-weight:600">→ 2.</span> … — <b>choice options</b>. The indented block underneath each one is the option's body (what plays when the player picks it).</li>
  <li><span style="color:#c8a878;font-family:monospace">«if $cond»</span> … <span style="color:#c8a878;font-family:monospace">«endif»</span> — <b>conditional branch</b>. Everything inside only plays when <code>$cond</code> is true. <b>All branches are shown</b> so nothing is missed in translation; the dashed indent on the left tells you what's nested.</li>
  <li><span style="color:#88e088">@labelName</span> — a <b>jump target</b>. Other lines may <code>goto</code> here.</li>
  <li><span style="color:#88c8ff;text-decoration:underline">goto labelName</span> / <span style="color:#88c8ff;text-decoration:underline">condGoto labelName (cond)</span> — <b>clickable!</b> Click the underlined label and the view scrolls to the matching <code>@labelName</code>. If the label lives in another node, the previewer switches to that node first, then scrolls. The destination row briefly flashes yellow so you can spot it.</li>
  <li><span style="color:#d68a8a;font-weight:700;border:1px solid #d68a8a;padding:2px 6px;border-radius:3px">— end —</span> — the dialogue ends here. Hover for a tooltip. Anything below this in the same indent isn't reachable from this branch.</li>
  <li><span style="opacity:0.6;font-family:monospace">set $foo = 1</span>, <span style="opacity:0.6;font-family:monospace">wait 0.5s</span>, <span style="opacity:0.6;font-family:monospace">→ goto X</span> — runtime side-effects shown as dim metadata. Not editable; provided as context so you understand what the line above / below does.</li>
</ul>

<h3>Save / portability</h3>
<p>Edits are cached in your browser's localStorage as a session backup. The <b>file you press 💾 Export</b> is the canonical save — keep that file safe and re-import it next time you come back. localStorage can be cleared by Safari (after 7 days of no visits), by clearing site data, or by switching browsers / computers, so don't rely on it for long-term storage.</p>
`,
      'tr.upload': '📥 Import translation file',
      'tr.upload.tip': 'Import your filled .csv / .xlsx — fully replaces the current language with the new file.',
      'tr.download': '💾 Export translation file',
      'tr.download.tip': 'Export a .csv / .xlsx with the same format you imported, with translations + inline edits filled in.',
      'tr.reset': '🔁 Reset this language',
      'tr.reset.tip': 'Clear imported translation + inline edits for this language. Falls back to bundled defaults.',
      'tr.editBtn.tip': 'Edit this line (Ctrl/Cmd+Enter to save, Esc to cancel)',
      'tr.editConfirm': '✓ Save',
      'tr.editCancel': '✗ Cancel',
      'tr.stats.noLocale': 'Pick a target language first',
      'tr.stats.notLoaded': '{locale}: no translation file loaded',
      'tr.stats.loaded': '{locale}: baseline {b} / inline edits {o}',
      'tr.stats.loadedFile': ' ({file})',
      'tr.stats.loading': 'Loading translation tables…',
      'tr.alert.pickLocale': 'Please switch the Language selector to your target language (e.g. fr-FR / ru-RU) before importing.',
      'tr.alert.sourceLocale': 'Translation import only applies to target languages. {locale} is a source language (text comes FROM it, not into it).\n\nWhat to do:\n  1. Switch the "Text language" selector to a target language (ru-RU / fr-FR / it-IT / es-ES / ja-JP).\n  2. Then import the matching translation file (e.g. Loc_ru-RU.csv).',
      'tr.alert.sourceLocaleDownload': 'Export produces a translation file (en-US source → target language). {locale} is the source language, so there is nothing to export as a translation.\n\nWhat to do:\n  1. Switch the "Text language" selector to a target language (ru-RU / fr-FR / it-IT / es-ES / ja-JP).\n  2. Then press [💾 Export] again.',
      'tr.alert.parseFailed': 'Parse failed: {msg}',
      'tr.alert.loaded': 'Loaded {locale}:\n  file: {file}\n  rows: {total}\n  with translation: {translated}\n  missing UID: {missing}',
      'tr.alert.warnings': '\n\n⚠️ Warnings:\n  {head}',
      'tr.alert.warningsMore': '\n  …({n} more, see console)',
      'tr.alert.noBaseline': 'No translation file imported yet. Please import first, then edit + export.',
      'tr.alert.noSource': 'Source structure missing (probably dropped due to localStorage quota). Please re-import your original .csv / .xlsx, then export.',
      'tr.alert.downloadFailed': 'Failed to write translation file: {msg}',
      'tr.alert.resetEmpty': 'Nothing to reset for {locale}.',
      'tr.confirm.replace': 'Fully replace {locale} with the imported file?\n\n  current baseline: {b} entries\n  current inline edits: {o} entries',
      'tr.confirm.replaceOverrideWarn': '\n\n⚠️ You have {o} inline edits that will be wiped completely when you import. The whole {locale} will follow the new file.\n\nIf you don\'t want to lose them: press [💾 Export] first to save your current state, then import.',
      'tr.confirm.localeMismatch': 'Detected locale "{got}" in the file, but you selected "{want}". Apply this file as the {want} translation anyway? (Usually means the file or selection is wrong.)',
      'tr.confirm.reset': 'Reset {locale}?\n\n  baseline (imported): {b} entries\n  inline edits: {o} entries\n\nAfter reset the preview falls back to the bundled default ({locale}).json. This cannot be undone.',
      'tr.export.clean': '✓ Saved {ago} ago',
      'tr.export.dirty': '⚠️ Unexported edits (last export {ago} ago)',
      'tr.export.dirtyNever': '⚠️ Unexported edits — never exported',
      'tr.export.ago.lt1m': '<1m',
      'tr.export.ago.minutes': '{n}m',
      'tr.export.ago.hours': '{n}h',
      'tr.export.ago.days': '{n}d',
      'flat.end.tip': 'Dialogue ends here',
      'flat.goto.tip': 'Jump to @{label}',
      'help.btn.tip': 'Help',
      'help.title': 'How to use this previewer',
      'help.body': `
<h3>Preview a script</h3>
<ul>
  <li>Pick the <b>Script</b> in the sidebar and the <b>Text language</b> in the top bar.</li>
  <li>Click any <b>node</b> in the sidebar to start it. Press <kbd>Space</kbd> / <kbd>Enter</kbd> or click <b>▼ Continue</b> to advance.</li>
  <li>When choices appear, click one or press <kbd>1</kbd>–<kbd>9</kbd>.</li>
  <li><b>⟳ Replay this node</b> restarts from the top. <b>← Step back</b> rewinds one line. The <b>↶</b> on each line jumps the runtime back to that point.</li>
</ul>

<h3>Edit translations (✏️ Edit Mode)</h3>
<ul>
  <li>Pick a target language (not en-US) in the top bar, then toggle <b>✏️ Translation Edit Mode</b> above the dialogue.</li>
  <li>The dialogue panel switches to a flat view that expands every line / option / <code>&lt;&lt;if&gt;&gt;</code> branch of the current node, with a <b>✏️</b> icon on each translatable row.</li>
  <li><b>For the full operation guide</b> — the symbols in the flat view, the clickable goto labels, the inline editor shortcuts — click the <b>?</b> button right next to the Edit Mode toggle.</li>
</ul>

<h3>Import / Export</h3>
<ul>
  <li><b>📥 Import translation file</b>: load a translator-filled <code>.csv</code> / <code>.xlsx</code>. Fully replaces the current language with the file's contents (and restores any <i>Notes</i> column inside it).</li>
  <li><b>💾 Export translation file</b>: download a <code>.csv</code> in Unity v2 LocKit format (Type / Gender / CharacterName / en-US / locale / ID / FileName / NodeTitle / Notes), filled with everything you've imported + edited inline.</li>
  <li><b>🔁 Reset this language</b>: clear imported baseline + inline edits for this language. Cannot be undone.</li>
  <li>The status pill in the top bar shows <b>✓ Saved Nm ago</b> when everything is exported, or <b>⚠️ Unexported edits</b> when you have local changes that aren't in any file yet. Closing the tab while dirty triggers a browser confirmation.</li>
</ul>

<h3>Translator notes (📝)</h3>
<ul>
  <li>Each node has a free-form note. Click <b>📝 Note</b> in the dialogue toolbar (or the <b>Notes</b> tab in the source panel) to write one. Nodes with notes show 📝 in the sidebar.</li>
  <li>Notes save automatically as you type. They're stored in your browser <i>and</i> embedded in the Notes column of every Export, so they travel across machines / browsers.</li>
</ul>

<h3>Variables</h3>
<ul>
  <li>The right-hand panel shows live variable values. Edit any of them to override what the runtime sees on the next replay — useful for testing branch-specific dialogue.</li>
  <li><b>🔄 Reset overrides</b> appears when overrides exist; click to revert.</li>
</ul>

<h3>What is saved</h3>
<ul>
  <li>Saved in your browser only: imported baseline, inline edits, notes, splitter widths, source font size, UI language.</li>
  <li>Not saved across reloads: which script / node / language was active, Edit Mode toggle, variable overrides.</li>
  <li>If you might switch browsers, switch computers, or use Safari (which clears site data after 7 days of no visits), <b>Export your work</b> regularly — the file carries your translations <i>and</i> your notes.</li>
</ul>

<h3>Keyboard shortcuts</h3>
<ul>
  <li><kbd>Space</kbd> / <kbd>Enter</kbd> — advance one line</li>
  <li><kbd>1</kbd>–<kbd>9</kbd> — pick the corresponding option</li>
  <li><kbd>R</kbd> — replay current node from the top</li>
  <li><kbd>←</kbd> / <kbd>Backspace</kbd> — step back one line</li>
  <li><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> — save inline edit; <kbd>Esc</kbd> — cancel</li>
</ul>
`,
    },
    zh: {
      'topbar.script': '劇本',
      'topbar.locale': '文本語言',
      'topbar.uiLang': '介面語言',
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
      'tr.editMode.help.tip': '打開 Edit Mode 說明(攤平視圖符號、✏️ 編輯器、可點 goto 等等)',
      'tr.editMode.help.title': 'Edit Mode 操作說明',
      'tr.editMode.help.body': `
<p><b>Edit Mode 在做什麼。</b> 對話面板從 runtime 預覽切到 <b>攤平編輯視圖</b>:把當前 node 整個展開 — 每一行、每個選項、每個 <code>&lt;&lt;if&gt;&gt;</code> 分支 — 變成一張可捲動清單。你由上到下掃過去翻,而不用反覆點選項追路徑。關掉 Edit Mode 會回到 runtime 預覽,你的編輯會直接套上去。</p>

<h3>編輯一行</h3>
<ul>
  <li>滑鼠移到任一行或選項 → 點 <b>✏️</b> → 出現內聯編輯器。</li>
  <li><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> 或 <b>✓</b> 儲存,<kbd>Esc</kbd> 或 <b>✗</b> 取消。</li>
</ul>

<h3>攤平視圖裡的符號</h3>
<ul>
  <li><span style="color:#88c8ff;font-weight:600">→ 1.</span>、<span style="color:#88c8ff;font-weight:600">→ 2.</span> … — <b>玩家可選的選項</b>。下方有縮排的就是該選項被選中後執行的內容。</li>
  <li><span style="color:#c8a878;font-family:monospace">«if $條件»</span> … <span style="color:#c8a878;font-family:monospace">«endif»</span> — <b>條件分支</b>。中間的內容只在 <code>$條件</code> 成立時播放。<b>所有分支都會列出來</b>,確保翻譯不漏;左側虛線縮排告訴你哪些是巢狀的。</li>
  <li><span style="color:#88e088">@標籤名稱</span> — <b>跳轉目標</b>,其他地方可能會 <code>goto</code> 過來。</li>
  <li><span style="color:#88c8ff;text-decoration:underline">goto 標籤名稱</span> / <span style="color:#88c8ff;text-decoration:underline">condGoto 標籤名稱 (cond)</span> — <b>可以點!</b> 點下底線文字會自動 scroll 到對應的 <code>@標籤名稱</code>。如果標籤在別的 node,預覽器會自動切到那個 node 再 scroll 過去。目標行會閃一下黃光,讓你一眼看到位置。</li>
  <li><span style="color:#d68a8a;font-weight:700;border:1px solid #d68a8a;padding:2px 6px;border-radius:3px">— end —</span> — 對話到這裡結束(滑鼠停上去看 tooltip)。同一縮排下面的內容從這條路徑走不到。</li>
  <li><span style="opacity:0.6;font-family:monospace">set $foo = 1</span>、<span style="opacity:0.6;font-family:monospace">wait 0.5s</span>、<span style="opacity:0.6;font-family:monospace">→ goto X</span> — runtime 副作用,以淡灰色 monospace 顯示;不能編輯,純粹給譯者了解上下文。</li>
</ul>

<h3>存檔與可攜性</h3>
<p>編輯會即時 cache 到瀏覽器 localStorage 當 session 備份。但<b>唯一可信的存檔是按 [💾 匯出翻譯檔] 拿到的那個 CSV</b> — 把那份檔案存好,下次回來再用 [📥 匯入翻譯檔] 載入。localStorage 可能被 Safari(7 天 ITP)/ 清除網站資料 / 換瀏覽器 / 換電腦清掉,別把它當長期存檔。</p>
`,
      'tr.upload': '📥 匯入翻譯檔',
      'tr.upload.tip': '匯入填好的 .csv / .xlsx — 會「整個替換」當前語言為新檔內容。',
      'tr.download': '💾 匯出翻譯檔',
      'tr.download.tip': '匯出與匯入同格式的 .csv / .xlsx，譯文欄填上目前所有匯入 + 站內編輯的最新內容。',
      'tr.reset': '🔁 重置該語言譯文',
      'tr.reset.tip': '清掉這個語言的「匯入譯文 + 站內編輯」，回到 bundle 預設的譯文。',
      'tr.editBtn.tip': '編輯這句譯文（Ctrl/Cmd+Enter 存、Esc 取消）',
      'tr.editConfirm': '✓ 儲存',
      'tr.editCancel': '✗ 取消',
      'tr.stats.noLocale': '請先選擇目標語言',
      'tr.stats.notLoaded': '{locale}：尚未載入譯文檔',
      'tr.stats.loaded': '{locale}：基準 {b} 條 / 站內編輯 {o} 條',
      'tr.stats.loadedFile': '（{file}）',
      'tr.stats.loading': '載入翻譯對照表中…',
      'tr.alert.pickLocale': '請先在右上「Language」切換到要載入的目標語言（如 fr-FR / ru-RU）。',
      'tr.alert.sourceLocale': '翻譯匯入僅適用於目標語言。{locale} 是來源語言（文本是「從」這個語言翻出去的，不是翻「到」這個語言）。\n\n要怎麼測試：\n  1. 把上方「文本語言」切到目標語言（ru-RU / fr-FR / it-IT / es-ES / ja-JP）。\n  2. 再匯入對應的翻譯檔（例如 Loc_ru-RU.csv）。',
      'tr.alert.sourceLocaleDownload': '匯出會產出一份翻譯檔（en-US 原文 → 目標語言）。{locale} 是來源語言，所以沒有「翻譯」可以匯出。\n\n要怎麼處理：\n  1. 把上方「文本語言」切到目標語言（ru-RU / fr-FR / it-IT / es-ES / ja-JP）。\n  2. 再按一次 [💾 匯出譯文]。',
      'tr.alert.parseFailed': '解析失敗：{msg}',
      'tr.alert.loaded': '已載入 {locale} 譯文：\n  檔案：{file}\n  資料列：{total}\n  含譯文：{translated}\n  缺 UID：{missing}',
      'tr.alert.warnings': '\n\n⚠️ 警告：\n  {head}',
      'tr.alert.warningsMore': '\n  …（再 {n} 條，請看 console）',
      'tr.alert.noBaseline': '尚未匯入任何譯文檔。請先匯入，編輯完再匯出。',
      'tr.alert.noSource': '找不到當初匯入檔案的結構（可能 localStorage 容量不夠被丟掉）。請重新匯入一次原始 .csv / .xlsx，再匯出。',
      'tr.alert.downloadFailed': '產出譯文檔失敗：{msg}',
      'tr.alert.resetEmpty': '{locale} 沒有需要重置的內容。',
      'tr.confirm.replace': '要把 {locale} 整個替換成匯入檔的內容嗎？\n\n  目前基準：{b} 條\n  目前站內編輯：{o} 條',
      'tr.confirm.replaceOverrideWarn': '\n\n⚠️ 你目前有 {o} 條站內編輯會被「全部清掉」，整個 {locale} 以新檔為準。\n\n如果不想丟掉：先按 [💾 匯出譯文] 把目前狀態存下來，再匯入。',
      'tr.confirm.localeMismatch': '偵測到的翻譯欄位是「{got}」，但你目前選的語言是「{want}」。要把這份檔案套用為 {want} 的譯文嗎？（通常表示你選錯語言或檔案標頭錯誤）',
      'tr.confirm.reset': '要重置 {locale} 嗎？\n\n  匯入基準：{b} 條\n  站內編輯：{o} 條\n\n重置後預覽會回到 bundle 預設的 ({locale}).json 內容。此動作無法復原。',
      'tr.export.clean': '✓ 已存檔 {ago} 前',
      'tr.export.dirty': '⚠️ 有未匯出的編輯（上次匯出 {ago} 前）',
      'tr.export.dirtyNever': '⚠️ 有未匯出的編輯 — 還沒匯出過',
      'tr.export.ago.lt1m': '不到 1 分鐘',
      'tr.export.ago.minutes': '{n} 分鐘',
      'tr.export.ago.hours': '{n} 小時',
      'tr.export.ago.days': '{n} 天',
      'flat.end.tip': '對話在這裡結束',
      'flat.goto.tip': '點此跳到 @{label}',
      'help.btn.tip': '說明',
      'help.title': '使用說明',
      'help.body': `
<h3>預覽劇本</h3>
<ul>
  <li>在 sidebar 選 <b>劇本</b>,在上方選 <b>文本語言</b>。</li>
  <li>點 sidebar 任一個 <b>節點</b> 開始預覽。按 <kbd>Space</kbd> / <kbd>Enter</kbd> 或點 <b>▼ 繼續</b> 推進對話。</li>
  <li>出現選項時,直接點或按 <kbd>1</kbd>-<kbd>9</kbd>。</li>
  <li><b>⟳ 從本節點重看</b> 從頭重來。<b>← 退一行</b> 倒回上一行。每行尾的 <b>↶</b> 可以直接跳回那個位置。</li>
</ul>

<h3>編輯翻譯(✏️ Edit Mode)</h3>
<ul>
  <li>先把文本語言切到目標語言(不要選 en-US),再按對話面板上方的 <b>✏️ 翻譯編輯模式</b>。</li>
  <li>對話區會切成攤平視圖,把當前 node 的每一行 / 選項 / <code>&lt;&lt;if&gt;&gt;</code> 分支全部展開,每行旁邊有 <b>✏️</b> 可以編輯。</li>
  <li><b>完整操作說明</b>(攤平視圖的符號、可點 goto 標籤、編輯快捷鍵)— 按 Edit Mode 切換按鈕旁邊那個 <b>?</b>。</li>
</ul>

<h3>匯入 / 匯出</h3>
<ul>
  <li><b>📥 匯入翻譯檔</b>:載入譯者填好的 <code>.csv</code> / <code>.xlsx</code>。會「整個替換」當前語言的譯文(順便還原檔案內 Notes 欄的譯者註記)。</li>
  <li><b>💾 匯出翻譯檔</b>:下載 Unity v2 LocKit 格式的 <code>.csv</code>(Type / Gender / CharacterName / en-US / locale / ID / FileName / NodeTitle / Notes),裡面已經填好你所有匯入過的 + 站內編輯的內容。</li>
  <li><b>🔁 重置該語言譯文</b>:清掉這個語言的匯入基準 + 站內編輯,無法復原。</li>
  <li>上方狀態小燈顯示 <b>✓ 已存檔 N 分鐘前</b>(都匯出過了)或 <b>⚠️ 有未匯出的編輯</b>(本機有改但還沒寫入任何檔案)。dirty 狀態下關 tab 會被瀏覽器擋一下確認。</li>
</ul>

<h3>譯者註記(📝)</h3>
<ul>
  <li>每個 node 都可以寫一則自由文字註記。按對話列上的 <b>📝 筆記</b> 或 source 面板的 <b>Notes</b> 分頁切過去寫。有註記的 node 在 sidebar 會顯示 📝。</li>
  <li>邊打邊存。註記不只存在你的瀏覽器,匯出時也會包進 CSV 的 Notes 欄,可以跟著檔案走到別的電腦 / 瀏覽器。</li>
</ul>

<h3>變數</h3>
<ul>
  <li>右側面板顯示 runtime 變數即時值。改任一格會覆寫,下次 Replay 時 runtime 會用這個新值 — 方便測條件分支對話。</li>
  <li>有覆寫值時會出現 <b>🔄 重置覆寫</b>,點下去全部回到原值。</li>
</ul>

<h3>什麼會被存</h3>
<ul>
  <li>會留在瀏覽器:匯入過的譯文基準、站內編輯、註記、splitter 寬度、字級、UI 語言。</li>
  <li>不會跨重整:當前選的劇本 / node / 語言、Edit Mode 開關、變數覆寫。</li>
  <li>會換瀏覽器、換電腦、或用 Safari(7 天沒回來會被清)的人,<b>請定期匯出</b> — 檔案裡同時包含譯文跟註記,搬到哪都帶得走。</li>
</ul>

<h3>鍵盤快捷鍵</h3>
<ul>
  <li><kbd>Space</kbd> / <kbd>Enter</kbd> — 推進一行</li>
  <li><kbd>1</kbd>-<kbd>9</kbd> — 選對應的選項</li>
  <li><kbd>R</kbd> — 從本節點重新開始</li>
  <li><kbd>←</kbd> / <kbd>Backspace</kbd> — 退一行</li>
  <li><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> — 儲存編輯;<kbd>Esc</kbd> — 取消</li>
</ul>
`,
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

    let titles = [...proj.nodes.keys()];
    if (state.nodeFilter) {
      const f = state.nodeFilter.toLowerCase();
      titles = titles.filter(x => x.toLowerCase().includes(f));
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
    const frag = document.createDocumentFragment();
    titles.forEach((title, i) => {
      const li = document.createElement('li');
      const hasNote = noted.has(title);
      if (hasNote) li.classList.add('has-note');

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
        startAt(title);
        openNote();
      });

      li.appendChild(num);
      li.appendChild(ttl);
      li.appendChild(noteBtn);
      li.title = title;
      li.onclick = () => startAt(title);
      frag.appendChild(li);
    });
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
    let el = document.getElementById('flat-edit-view');
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
    const title = state.runtime && state.runtime.currentNodeTitle;
    if (!title) return;
    const node = proj.nodes.get(title);
    if (!node) return;

    const header = document.createElement('div');
    header.className = 'flat-node-title';
    header.textContent = title;
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
    const uid = uidForFlat(nodeCtx, stmt.srcLine);
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
      const uid = uidForFlat(nodeCtx, item.srcLine);
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
    const view = document.getElementById('flat-edit-view');
    if (!view) return;
    const sel = `[data-label-name="${CSS.escape(labelName)}"]`;
    let target = view.querySelector(sel);
    if (target) { flashFlatTarget(target); return; }
    const proj = activeProject();
    const ownerNode = proj && proj.globalLabels && proj.globalLabels.get(labelName);
    if (!ownerNode) return;  // unknown label — silent no-op
    startAt(ownerNode);       // re-renders flat view for the owner node
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

  function uidForFlat(nodeCtx, srcLine) {
    if (srcLine == null) return null;
    if (!state.activeGroup) return null;
    const groupMap = state.groups.get(state.activeGroup);
    if (!groupMap) return null;
    const enEntry = groupMap.get('en-US');
    if (!enEntry) return null;
    if (typeof TranslationUI === 'undefined' || !TranslationUI.getUidFor) return null;
    return TranslationUI.getUidFor(enEntry.filename, nodeCtx.nodeIndex, srcLine);
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
    // If Edit Mode is on, refresh the flat view so it follows the active node.
    if (typeof TranslationUI !== 'undefined' && TranslationUI.isActive && TranslationUI.isActive()) {
      redrawTranslationsInPlace();
    }
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
        // Non-destructive redraw: refresh translation visuals on existing
        // transcript rows + pending choices. Toggling Edit Mode or saving an
        // inline edit no longer rewinds the dialogue.
        requestRedraw: redrawTranslationsInPlace,
        // Notes round-trip hooks (export/import preserves translator notes).
        getNote: (group, title) => getNote(group, title),
        setNote: (group, title, text) => {
          setNote(group, title, text);
          if (state.activeGroup === group) refreshNodeList();
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
