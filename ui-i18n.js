// ui-i18n.js
// English + Traditional-Chinese string tables for the Dialogue page.
// ui.js reads this via `window.YP_I18N`; ui-strings.js uses it indirectly
// through `window.YP.t` (exposed by ui.js).
//
// Contract: 1:1 key parity between en and zh — every key must exist in both
// tables, otherwise t() falls back to en silently and the missing-key bug is
// hard to spot.

(function (global) {
  'use strict';

  global.YP_I18N = {
    en: {
      'topbar.script': 'Script',
      'topbar.locale': 'Text language',
      'topbar.uiLang': 'Interface language',
      'page.dialogue': '💬 Dialogue',
      'page.uiStrings': '🧩 UI strings',
      'btn.play': '▶ Play',
      'btn.play.tip': 'Start the dialogue runtime from line 1 of this node (Space / Enter / R).',
      'btn.stop': '■ Stop',
      'btn.stop.tip': 'Stop playback and return to navigation. Click ▶ again to replay from line 1.',
      'btn.replayNode': '⟳ Replay',
      'btn.stepBack': '← Step back',
      'btn.continue': '▼ Continue (Space)',
      'btn.openNote': '📝 Note',
      'btn.resetOverrides': '🔄 Reset overrides ({n})',
      'sidebar.nodes': 'Nodes',
      'sidebar.uidSearch': 'UID search',
      'sidebar.uidSearch.placeholder': 'Paste UID…',
      'sidebar.uidSearch.tip': 'Search a UID and jump to the matching script + node.',
      'uidSearch.invalidUid': 'Invalid UID format.',
      'uidSearch.notFound': 'Not found.',
      'uidSearch.guidsUnavailable': 'Could not load the UID lookup table.',
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
      'transcript.pressPlay': 'Press ▶ Play to step through the dialogue, or open Translation edit mode to edit this node\'s lines directly.',
      'tooltip.overridden': 'Overridden by user',
      'tooltip.rewind': 'Rewind to this line',
      'tooltip.gender': 'Grammatical gender (for translation)',
      'tooltip.scrollSourceTop': 'Click to scroll source to top',
      // ----- Translation edit mode -----
      'tr.editMode': '✏️ Translation edit mode',
      'tr.editMode.tip': 'Enable to inline-edit translations on the dialogue preview. Edits are saved in your browser only.',
      'tr.editMode.help.tip': 'Open the Edit mode help (flat view symbols, ✏️ inline editor, clickable goto labels, …)',
      'tr.editMode.help.title': 'Edit mode operation guide',
      'tr.editMode.help.body': `
<p><b>What Edit mode does.</b> The dialogue panel switches from the runtime preview to a <b>flat editing view</b>: the entire current node — every line, every option, every <code>&lt;&lt;if&gt;&gt;</code> branch — is expanded into one scrollable page. You sweep through it top-to-bottom instead of clicking choices to reach lines. Toggle Edit mode off to return to the runtime preview; your edits show up there too.</p>

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
      'tr.stats.loadedFile': ' ({file})',
      'tr.stats.progress': '{done} / {total} translated',
      'tr.progress.translated': 'translated',
      'tr.alert.pickLocale': 'Switch the Text language selector to your target language (e.g. fr-FR / ru-RU) before importing.',
      'tr.alert.sourceLocale': 'Translation import only applies to target languages. {locale} is a source language (text comes FROM it, not into it).\n\nWhat to do:\n  1. Switch the "Text language" selector to a target language (ru-RU / fr-FR / it-IT / es-ES / ja-JP).\n  2. Then import the matching translation file (e.g. Loc_ru-RU.csv).',
      'tr.alert.sourceLocaleDownload': 'Export produces a translation file (en-US source → target language). {locale} is the source language, so there is nothing to export as a translation.\n\nWhat to do:\n  1. Switch the "Text language" selector to a target language (ru-RU / fr-FR / it-IT / es-ES / ja-JP).\n  2. Then press [💾 Export] again.',
      'tr.alert.parseFailed': 'Parse failed: {msg}',
      'tr.alert.loaded': 'Loaded {locale}:\n  file: {file}\n  rows: {total}\n  with translation: {translated}\n  missing UID: {missing}',
      'tr.alert.warnings': '\n\n⚠️ Warnings:\n  {head}',
      'tr.alert.warningsMore': '\n  …({n} more, see console)',
      'tr.alert.persistFailed': '⛔ Could not save {locale} translations to browser storage (file: {file}).\n\nThe import is shown but WILL BE LOST if you refresh.\nClear other site data or use a different browser profile, then import again.',
      'tr.alert.notesRestored': '\n  📝 translator notes restored: {n}',
      'tr.alert.noBaseline': 'No translation file imported yet. Import first, then edit and export.',
      'tr.alert.noSource': 'Source structure missing (probably dropped due to localStorage quota). Re-import your original .csv / .xlsx, then export.',
      'tr.alert.downloadFailed': 'Failed to write translation file: {msg}',
      'tr.alert.resetEmpty': 'Nothing to reset for {locale}.',
      'tr.confirm.replace': 'Fully replace {locale} with the imported file?\n\n  current baseline: {b} entries\n  current inline edits: {o} entries',
      'tr.confirm.replaceOverrideWarn': '\n\n⚠️ You have {o} inline edits that will be wiped completely when you import. The whole {locale} will follow the new file.\n\nIf you don\'t want to lose them: press [💾 Export] first to save your current state, then import.',
      'tr.confirm.localeMismatch': 'Detected locale "{got}" in the file, but you selected "{want}". Apply this file as the {want} translation anyway? (Usually means the file or selection is wrong.)',
      'tr.confirm.reset': 'Reset {locale}?\n\n  baseline (imported): {b} entries\n  inline edits: {o} entries\n\nAfter reset the preview falls back to the bundled default ({locale}).json. This cannot be undone.',
      'tr.export.clean': '✓ Saved {date} ({ago} ago)',
      'tr.export.dirty': '⚠️ Unexported edits (last export {date}, {ago} ago)',
      'tr.export.dirtyNever': '⚠️ Unexported edits, never exported',
      'tr.export.ago.lt1m': '<1m',
      'tr.export.ago.minutes': '{n}m',
      'tr.export.ago.hours': '{n}h',
      'tr.export.ago.days': '{n}d',
      'flat.end.tip': 'Dialogue ends here',
      'flat.goto.tip': 'Jump to @{label}',
      // ----- Translation review status -----
      'status.untranslated':         'Untranslated',
      'status.translated':           'Translated',
      'status.edited':               'Inline-edited',
      'status.needsReview':          'Needs review',
      'status.approved':             'Approved',
      'sidebar.statusFilter.label':  'Status:',
      'sidebar.statusFilter.all':    'All',
      'sidebar.statusFilter.all.tip':          'Show every node (clear status filter)',
      'sidebar.statusFilter.untranslated':     'Has untranslated',
      'sidebar.statusFilter.untranslated.tip': 'Only show nodes with at least one untranslated line',
      'sidebar.statusFilter.needsReview':      'Has needs-review',
      'sidebar.statusFilter.needsReview.tip':  'Only show nodes with at least one line marked needs-review',
      'sidebar.statusFilter.approved':         'Has approved',
      'sidebar.statusFilter.approved.tip':     'Only show nodes with at least one line marked approved',
      'sidebar.statusFilter.done':             'Fully done',
      'sidebar.statusFilter.done.tip':         'Only show nodes with no untranslated and no needs-review lines',
      'sidebar.nodeProgress.tip':              '{done}/{total} translated · {nr} needs-review · {ap} approved · {ed} edited',
      'tr.statusChip.empty.label':             'set status',
      'tr.statusChip.empty.tip':               'Click to set review status',
      'tr.statusChip.tip':                     'Click to change review status',
      'tr.statusChip.menu.clear':              'Clear status',
      'tr.statusChip.menu.needsReview':        'Mark as needs review',
      'tr.statusChip.menu.approved':           'Mark as approved',
      'tr.bulk.approveAll':                    '✓ Approve all ({n})',
      'tr.bulk.approveAll.tip':                'Mark every translatable line in this node as approved',
      'tr.bulk.clearAll':                      '🔁 Clear status ({n})',
      'tr.bulk.clearAll.tip':                  'Clear review status from every line in this node',
      'tr.bulk.confirm.approve':               'Mark {n} lines in this node as approved?',
      'tr.bulk.confirm.clear':                 'Clear review status on {n} lines in this node?',
      'tr.bulk.empty':                         'This node has no translatable lines.',
      'tr.alert.statusesRestored':             '\n  ✓ review statuses restored: {n}',
      'tr.export.preparing':                   'Preparing export…',
      'tr.progress.disclosure.expand':         'Show status breakdown',
      'tr.progress.disclosure.collapse':       'Hide status breakdown',
      'tr.progress.breakdown.untranslated':    'untranslated {n}',
      'tr.progress.breakdown.edited':          'edited {n}',
      'tr.progress.breakdown.needsReview':     'needs-review {n}',
      'tr.progress.breakdown.approved':        'approved {n}',
      'tr.progress.breakdown.cleanBaseline':   'imported {n}',
      'tr.progress.breakdown.filterTip':       'Filter the sidebar to nodes containing this status',
      // ----- UI strings page -----
      'ui.brand': 'UI strings',
      'ui.import': '📥 Import .xlsx',
      'ui.export': '💾 Export .xlsx',
      'ui.reset': '🗑 Clear',
      'ui.filter.placeholder': 'Filter key…',
      'ui.status.empty': 'No file imported yet',
      'ui.status.loaded': 'Imported: {file} ({n} sheet)',
      'ui.status.dirtyKnown': '⚠️ Unexported edits (last export {date}, {ago} ago)',
      'ui.status.dirtyNever': '⚠️ Unexported edits, never exported',
      'ui.status.clean': '✓ Saved {date} ({ago} ago)',
      'ui.counter.filtered': 'Showing {visible} / {total} rows',
      'ui.counter.total': '{total} rows',
      'ui.empty.noWorkbook': 'No data. Click 📥 Import .xlsx above.',
      'ui.empty.noSheet': 'Sheet not found.',
      'ui.cell.empty': '— empty —',
      'ui.tab.tip': '{n} rows',
      'ui.alert.persistFailed': 'Save to localStorage failed (likely quota): {msg}\n\nClick 💾 Export .xlsx to save the current state to a file.',
      'ui.alert.parserMissing': 'xlsx parser not loaded',
      'ui.alert.parseFailed': 'Failed to parse .xlsx: {msg}',
      'ui.alert.noSheets': 'The .xlsx has no readable sheets.',
      'ui.alert.imported': 'Imported {file}\n  {sheets} sheet(s)\n  {rows} rows',
      'ui.alert.nothingToExport': 'Nothing to export. Import an .xlsx first.',
      'ui.alert.writerMissing': 'xlsx writer not loaded',
      'ui.alert.nothingToReset': 'Nothing to reset.',
      'ui.confirm.reset': 'Clear all UI strings data?\n\nAll local edits will be lost; you will need to re-import the .xlsx.\n(Recommended: export to .xlsx first as a backup.)',
      'help.btn': '❔ Help',
      'help.btn.tip': 'Open the help dialog',
      'help.title': 'How to use this previewer',
      'help.body': `
<h3>Preview a script</h3>
<ul>
  <li>Pick the <b>Script</b> in the sidebar and the <b>Text language</b> in the top bar.</li>
  <li>Click any <b>node</b> in the sidebar to start it. Press <kbd>Space</kbd> / <kbd>Enter</kbd> or click <b>▼ Continue</b> to advance.</li>
  <li>When choices appear, click one or press <kbd>1</kbd>–<kbd>9</kbd>.</li>
  <li><b>⟳ Replay this node</b> restarts from the top. <b>← Step back</b> rewinds one line. The <b>↶</b> on each line jumps the runtime back to that point.</li>
</ul>

<h3>Edit translations (✏️ Edit mode)</h3>
<ul>
  <li>Pick a target language (not en-US) in the top bar, then toggle <b>✏️ Translation edit mode</b> above the dialogue.</li>
  <li>The dialogue panel switches to a flat view that expands every line / option / <code>&lt;&lt;if&gt;&gt;</code> branch of the current node, with a <b>✏️</b> icon on each translatable row.</li>
  <li><b>For the full operation guide</b> — the symbols in the flat view, the clickable goto labels, the inline editor shortcuts — click the <b>?</b> button right next to the Edit mode toggle.</li>
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
  <li>Not saved across reloads: which script / node / language was active, Edit mode toggle, variable overrides.</li>
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
      'page.dialogue': '💬 對話',
      'page.uiStrings': '🧩 UI 字串',
      'btn.play': '▶ 撥放',
      'btn.play.tip': '從本節點第 1 行開始跑對話 runtime（Space / Enter / R）。',
      'btn.stop': '■ 停止',
      'btn.stop.tip': '停止播放並回到導覽狀態。再按一次 ▶ 會從第 1 行重播。',
      'btn.replayNode': '⟳ 重看',
      'btn.stepBack': '← 退一行',
      'btn.continue': '▼ 繼續 (Space)',
      'btn.openNote': '📝 筆記',
      'btn.resetOverrides': '🔄 重置覆寫 ({n})',
      'sidebar.nodes': '節點清單',
      'sidebar.uidSearch': 'UID 搜尋',
      'sidebar.uidSearch.placeholder': '貼上 UID…',
      'sidebar.uidSearch.tip': '輸入 UID 後跳到對應的劇本與節點。',
      'uidSearch.invalidUid': 'UID 格式不正確。',
      'uidSearch.notFound': '找不到。',
      'uidSearch.guidsUnavailable': '無法載入 UID 對照表。',
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
      'transcript.pressPlay': '按 ▶ 撥放可以一步步跑對話；或者開啟 Translation edit mode 直接編輯這個節點的所有對話。',
      'tooltip.overridden': '使用者覆寫',
      'tooltip.rewind': '退回到此句',
      'tooltip.gender': '文法性別（翻譯用）',
      'tooltip.scrollSourceTop': '點擊回到原始碼最上方',
      // ----- 翻譯編輯模式 -----
      'tr.editMode': '✏️ 翻譯編輯模式',
      'tr.editMode.tip': '開啟後，可以在對話預覽上點 ✏️ 直接修改該句譯文。所有改動只存在你的瀏覽器內。',
      'tr.editMode.help.tip': '打開 Edit mode 說明（攤平視圖符號、✏️ 編輯器、可點 goto 等等）',
      'tr.editMode.help.title': 'Edit mode 操作說明',
      'tr.editMode.help.body': `
<p><b>Edit mode 在做什麼。</b> 對話面板從 runtime 預覽切到 <b>攤平編輯視圖</b>：把當前 node 整個展開 — 每一行、每個選項、每個 <code>&lt;&lt;if&gt;&gt;</code> 分支 — 變成一張可捲動清單。你由上到下掃過去翻，而不用反覆點選項追路徑。關掉 Edit mode 會回到 runtime 預覽，你的編輯會直接套上去。</p>

<h3>編輯一行</h3>
<ul>
  <li>滑鼠移到任一行或選項 → 點 <b>✏️</b> → 出現內聯編輯器。</li>
  <li><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> 或 <b>✓</b> 儲存，<kbd>Esc</kbd> 或 <b>✗</b> 取消。</li>
</ul>

<h3>攤平視圖裡的符號</h3>
<ul>
  <li><span style="color:#88c8ff;font-weight:600">→ 1.</span>、<span style="color:#88c8ff;font-weight:600">→ 2.</span> … — <b>玩家可選的選項</b>。下方有縮排的就是該選項被選中後執行的內容。</li>
  <li><span style="color:#c8a878;font-family:monospace">«if $條件»</span> … <span style="color:#c8a878;font-family:monospace">«endif»</span> — <b>條件分支</b>。中間的內容只在 <code>$條件</code> 成立時播放。<b>所有分支都會列出來</b>，確保翻譯不漏；左側虛線縮排告訴你哪些是巢狀的。</li>
  <li><span style="color:#88e088">@標籤名稱</span> — <b>跳轉目標</b>，其他地方可能會 <code>goto</code> 過來。</li>
  <li><span style="color:#88c8ff;text-decoration:underline">goto 標籤名稱</span> / <span style="color:#88c8ff;text-decoration:underline">condGoto 標籤名稱 (cond)</span> — <b>可以點！</b> 點下底線文字會自動 scroll 到對應的 <code>@標籤名稱</code>。如果標籤在別的 node，預覽器會自動切到那個 node 再 scroll 過去。目標行會閃一下黃光，讓你一眼看到位置。</li>
  <li><span style="color:#d68a8a;font-weight:700;border:1px solid #d68a8a;padding:2px 6px;border-radius:3px">— end —</span> — 對話到這裡結束（滑鼠停上去看 tooltip）。同一縮排下面的內容從這條路徑走不到。</li>
  <li><span style="opacity:0.6;font-family:monospace">set $foo = 1</span>、<span style="opacity:0.6;font-family:monospace">wait 0.5s</span>、<span style="opacity:0.6;font-family:monospace">→ goto X</span> — runtime 副作用，以淡灰色 monospace 顯示；不能編輯，純粹給譯者了解上下文。</li>
</ul>

<h3>存檔與可攜性</h3>
<p>編輯會即時 cache 到瀏覽器 localStorage 當 session 備份。但<b>唯一可信的存檔是按 [💾 匯出翻譯檔] 拿到的那個 CSV</b> — 把那份檔案存好，下次回來再用 [📥 匯入翻譯檔] 載入。localStorage 可能被 Safari（7 天 ITP）/ 清除網站資料 / 換瀏覽器 / 換電腦清掉，別把它當長期存檔。</p>
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
      'tr.stats.loadedFile': '（{file}）',
      'tr.stats.progress': '{done} / {total} 已翻譯',
      'tr.progress.translated': '已翻譯',
      'tr.alert.pickLocale': '請先在右上「Language」切換到要載入的目標語言（如 fr-FR / ru-RU）。',
      'tr.alert.sourceLocale': '翻譯匯入僅適用於目標語言。{locale} 是來源語言（文本是「從」這個語言翻出去的，不是翻「到」這個語言）。\n\n要怎麼測試：\n  1. 把上方「文本語言」切到目標語言（ru-RU / fr-FR / it-IT / es-ES / ja-JP）。\n  2. 再匯入對應的翻譯檔（例如 Loc_ru-RU.csv）。',
      'tr.alert.sourceLocaleDownload': '匯出會產出一份翻譯檔（en-US 原文 → 目標語言）。{locale} 是來源語言，所以沒有「翻譯」可以匯出。\n\n要怎麼處理：\n  1. 把上方「文本語言」切到目標語言（ru-RU / fr-FR / it-IT / es-ES / ja-JP）。\n  2. 再按一次 [💾 匯出譯文]。',
      'tr.alert.parseFailed': '解析失敗：{msg}',
      'tr.alert.loaded': '已載入 {locale} 譯文：\n  檔案：{file}\n  資料列：{total}\n  含譯文：{translated}\n  缺 UID：{missing}',
      'tr.alert.warnings': '\n\n⚠️ 警告：\n  {head}',
      'tr.alert.warningsMore': '\n  …（再 {n} 條，請看 console）',
      'tr.alert.persistFailed': '⛔ 無法將 {locale} 譯文存入瀏覽器（檔案：{file}）。\n\n畫面顯示了匯入結果，但**重新整理就會消失**。\n請清掉其他網站資料或換一個瀏覽器設定檔，再重新匯入。',
      'tr.alert.notesRestored': '\n  📝 還原譯者筆記：{n} 條',
      'tr.alert.noBaseline': '尚未匯入任何譯文檔。請先匯入，編輯完再匯出。',
      'tr.alert.noSource': '找不到當初匯入檔案的結構（可能 localStorage 容量不夠被丟掉）。請重新匯入一次原始 .csv / .xlsx，再匯出。',
      'tr.alert.downloadFailed': '產出譯文檔失敗：{msg}',
      'tr.alert.resetEmpty': '{locale} 沒有需要重置的內容。',
      'tr.confirm.replace': '要把 {locale} 整個替換成匯入檔的內容嗎？\n\n  目前基準：{b} 條\n  目前站內編輯：{o} 條',
      'tr.confirm.replaceOverrideWarn': '\n\n⚠️ 你目前有 {o} 條站內編輯會被「全部清掉」，整個 {locale} 以新檔為準。\n\n如果不想丟掉：先按 [💾 匯出譯文] 把目前狀態存下來，再匯入。',
      'tr.confirm.localeMismatch': '偵測到的翻譯欄位是「{got}」，但你目前選的語言是「{want}」。要把這份檔案套用為 {want} 的譯文嗎？（通常表示你選錯語言或檔案標頭錯誤）',
      'tr.confirm.reset': '要重置 {locale} 嗎？\n\n  匯入基準：{b} 條\n  站內編輯：{o} 條\n\n重置後預覽會回到 bundle 預設的 ({locale}).json 內容。此動作無法復原。',
      'tr.export.clean': '✓ 已存檔 {date}（{ago} 前）',
      'tr.export.dirty': '⚠️ 有未匯出的編輯（上次匯出 {date}，{ago} 前）',
      'tr.export.dirtyNever': '⚠️ 有未匯出的編輯，還沒匯出過',
      'tr.export.ago.lt1m': '不到 1 分鐘',
      'tr.export.ago.minutes': '{n} 分鐘',
      'tr.export.ago.hours': '{n} 小時',
      'tr.export.ago.days': '{n} 天',
      'flat.end.tip': '對話在這裡結束',
      'flat.goto.tip': '點此跳到 @{label}',
      // ----- 翻譯校對狀態 -----
      'status.untranslated':         '未翻譯',
      'status.translated':           '已翻譯',
      'status.edited':               '站內編輯',
      'status.needsReview':          '待校',
      'status.approved':             '已核可',
      'sidebar.statusFilter.label':  '狀態：',
      'sidebar.statusFilter.all':    '全部',
      'sidebar.statusFilter.all.tip':          '顯示所有節點（清掉狀態篩選）',
      'sidebar.statusFilter.untranslated':     '未完成',
      'sidebar.statusFilter.untranslated.tip': '只顯示有未翻譯行的節點',
      'sidebar.statusFilter.needsReview':      '待校',
      'sidebar.statusFilter.needsReview.tip':  '只顯示有「待校」行的節點',
      'sidebar.statusFilter.approved':         '有已核可',
      'sidebar.statusFilter.approved.tip':     '只顯示有「已核可」行的節點',
      'sidebar.statusFilter.done':             '全完成',
      'sidebar.statusFilter.done.tip':         '只顯示沒有未翻譯也沒有待校的節點',
      'sidebar.nodeProgress.tip':              '{done}/{total} 已翻 · 待校 {nr} · 已核可 {ap} · 站內編輯 {ed}',
      'tr.statusChip.empty.label':             '設狀態',
      'tr.statusChip.empty.tip':               '點擊設定校對狀態',
      'tr.statusChip.tip':                     '點擊變更校對狀態',
      'tr.statusChip.menu.clear':              '清除狀態',
      'tr.statusChip.menu.needsReview':        '標記為待校',
      'tr.statusChip.menu.approved':           '標記為已核可',
      'tr.bulk.approveAll':                    '✓ 全節點核可 ({n})',
      'tr.bulk.approveAll.tip':                '把這個節點所有可翻譯行標為已核可',
      'tr.bulk.clearAll':                      '🔁 清空狀態 ({n})',
      'tr.bulk.clearAll.tip':                  '清掉這個節點所有行的校對狀態',
      'tr.bulk.confirm.approve':               '把這個節點 {n} 行標記為已核可？',
      'tr.bulk.confirm.clear':                 '清掉這個節點 {n} 行的校對狀態？',
      'tr.bulk.empty':                         '這個節點沒有可翻譯的行。',
      'tr.alert.statusesRestored':             '\n  ✓ 還原校對狀態：{n} 條',
      'tr.export.preparing':                   '準備匯出中…',
      'tr.progress.disclosure.expand':         '展開狀態細目',
      'tr.progress.disclosure.collapse':       '收起狀態細目',
      'tr.progress.breakdown.untranslated':    '未翻 {n}',
      'tr.progress.breakdown.edited':          '站內編輯 {n}',
      'tr.progress.breakdown.needsReview':     '待校 {n}',
      'tr.progress.breakdown.approved':        '已核可 {n}',
      'tr.progress.breakdown.cleanBaseline':   '已匯入 {n}',
      'tr.progress.breakdown.filterTip':       '依此狀態篩選 sidebar 節點清單',
      // ----- UI strings 分頁 -----
      'ui.brand': 'UI 字串',
      'ui.import': '📥 匯入 .xlsx',
      'ui.export': '💾 匯出 .xlsx',
      'ui.reset': '🗑 清空',
      'ui.filter.placeholder': '篩選 Key…',
      'ui.status.empty': '尚未匯入任何檔案',
      'ui.status.loaded': '已匯入：{file}（{n} 個分頁）',
      'ui.status.dirtyKnown': '⚠️ 有未匯出的編輯（上次匯出 {date}，{ago} 前）',
      'ui.status.dirtyNever': '⚠️ 有未匯出的編輯，還沒匯出過',
      'ui.status.clean': '✓ 已存檔 {date}（{ago} 前）',
      'ui.counter.filtered': '顯示 {visible} / {total} 列',
      'ui.counter.total': '共 {total} 列',
      'ui.empty.noWorkbook': '沒有資料。請按上方 📥 匯入 .xlsx。',
      'ui.empty.noSheet': '找不到分頁。',
      'ui.cell.empty': '— 空 —',
      'ui.tab.tip': '{n} 列',
      'ui.alert.persistFailed': '儲存到 localStorage 失敗（可能容量不夠）：{msg}\n\n請按 💾 匯出 .xlsx 把目前狀態存到檔案。',
      'ui.alert.parserMissing': 'xlsx parser 未載入',
      'ui.alert.parseFailed': '解析 .xlsx 失敗：{msg}',
      'ui.alert.noSheets': 'xlsx 內沒有可讀取的分頁。',
      'ui.alert.imported': '已匯入 {file}\n  {sheets} 個分頁\n  {rows} 列',
      'ui.alert.nothingToExport': '沒有可匯出的內容，請先匯入一份 .xlsx。',
      'ui.alert.writerMissing': 'xlsx writer 未載入',
      'ui.alert.nothingToReset': '目前沒有資料。',
      'ui.confirm.reset': '確定要清空當前 UI 字串資料嗎？\n\n本地的所有編輯會全部丟掉，需要重新匯入 .xlsx。\n（建議先按 💾 匯出 .xlsx 留底）',
      'help.btn': '❔ 說明',
      'help.btn.tip': '開啟說明視窗',
      'help.title': '使用說明',
      'help.body': `
<h3>預覽劇本</h3>
<ul>
  <li>在 sidebar 選 <b>劇本</b>，在上方選 <b>文本語言</b>。</li>
  <li>點 sidebar 任一個 <b>節點</b> 開始預覽。按 <kbd>Space</kbd> / <kbd>Enter</kbd> 或點 <b>▼ 繼續</b> 推進對話。</li>
  <li>出現選項時，直接點或按 <kbd>1</kbd>-<kbd>9</kbd>。</li>
  <li><b>⟳ 從本節點重看</b> 從頭重來。<b>← 退一行</b> 倒回上一行。每行尾的 <b>↶</b> 可以直接跳回那個位置。</li>
</ul>

<h3>編輯翻譯（✏️ Edit mode）</h3>
<ul>
  <li>先把文本語言切到目標語言（不要選 en-US），再按對話面板上方的 <b>✏️ 翻譯編輯模式</b>。</li>
  <li>對話區會切成攤平視圖，把當前 node 的每一行 / 選項 / <code>&lt;&lt;if&gt;&gt;</code> 分支全部展開，每行旁邊有 <b>✏️</b> 可以編輯。</li>
  <li><b>完整操作說明</b>(攤平視圖的符號、可點 goto 標籤、編輯快捷鍵)— 按 Edit mode 切換按鈕旁邊那個 <b>?</b>。</li>
</ul>

<h3>匯入 / 匯出</h3>
<ul>
  <li><b>📥 匯入翻譯檔</b>：載入譯者填好的 <code>.csv</code> / <code>.xlsx</code>。會「整個替換」當前語言的譯文（順便還原檔案內 Notes 欄的譯者註記）。</li>
  <li><b>💾 匯出翻譯檔</b>：下載 Unity v2 LocKit 格式的 <code>.csv</code>（Type / Gender / CharacterName / en-US / locale / ID / FileName / NodeTitle / Notes），裡面已經填好你所有匯入過的 + 站內編輯的內容。</li>
  <li><b>🔁 重置該語言譯文</b>：清掉這個語言的匯入基準 + 站內編輯，無法復原。</li>
  <li>上方狀態小燈顯示 <b>✓ 已存檔 N 分鐘前</b>（都匯出過了）或 <b>⚠️ 有未匯出的編輯</b>（本機有改但還沒寫入任何檔案）。dirty 狀態下關 tab 會被瀏覽器擋一下確認。</li>
</ul>

<h3>譯者註記（📝）</h3>
<ul>
  <li>每個 node 都可以寫一則自由文字註記。按對話列上的 <b>📝 筆記</b> 或 source 面板的 <b>Notes</b> 分頁切過去寫。有註記的 node 在 sidebar 會顯示 📝。</li>
  <li>邊打邊存。註記不只存在你的瀏覽器，匯出時也會包進 CSV 的 Notes 欄，可以跟著檔案走到別的電腦 / 瀏覽器。</li>
</ul>

<h3>變數</h3>
<ul>
  <li>右側面板顯示 runtime 變數即時值。改任一格會覆寫，下次 Replay 時 runtime 會用這個新值 — 方便測條件分支對話。</li>
  <li>有覆寫值時會出現 <b>🔄 重置覆寫</b>，點下去全部回到原值。</li>
</ul>

<h3>什麼會被存</h3>
<ul>
  <li>會留在瀏覽器：匯入過的譯文基準、站內編輯、註記、splitter 寬度、字級、UI 語言。</li>
  <li>不會跨重整：當前選的劇本 / node / 語言、Edit mode 開關、變數覆寫。</li>
  <li>會換瀏覽器、換電腦、或用 Safari（7 天沒回來會被清）的人，<b>定期匯出</b> — 檔案裡同時包含譯文跟註記，搬到哪都帶得走。</li>
</ul>

<h3>鍵盤快捷鍵</h3>
<ul>
  <li><kbd>Space</kbd> / <kbd>Enter</kbd> — 推進一行</li>
  <li><kbd>1</kbd>-<kbd>9</kbd> — 選對應的選項</li>
  <li><kbd>R</kbd> — 從本節點重新開始</li>
  <li><kbd>←</kbd> / <kbd>Backspace</kbd> — 退一行</li>
  <li><kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> — 儲存編輯；<kbd>Esc</kbd> — 取消</li>
</ul>
`,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
