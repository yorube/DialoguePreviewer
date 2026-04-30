# Translator Reference

Internal reference for translators using the MBU Dialogue Previewer. Rules, scenarios, and the things that go wrong in real workflows.

---

## Hard rules

1. **`en-US` and `zh-TW` are source languages — never editable.** If you "translate" something while either is set as the Text language, your edits go nowhere. Always set the Text language to your target locale (`fr-FR`, `ja-JP`, `ru-RU`, `it-IT`, `es-ES`, `zh-CN`) before editing.
2. **The exported file is the only real save.** Browser-stored progress is not durable — Safari clears it after 7 days idle, switching browsers / computers loses it, clearing site data wipes it, the browser may evict it on its own when storage is tight. Press 💾 Export every session and keep the file.
3. **Importing fully replaces that language's state.** If you import `Loc_fr-FR.csv`, every existing French baseline + every inline edit you made for French is overwritten by the file. Nothing merges. Other languages are untouched. Export before importing if you have unsaved edits.
4. **Edit Mode and Compare Mode can't be on at the same time.** Turning either on turns the other off. The dialogue area only shows one of: runtime preview / flat editing view / comparison table.
5. **`//`-prefixed rows in the UI Strings file are section headers, not data.** They show up as banners. Don't put real keys behind a `//`. Their other-language cells are not edited or saved.
6. **Two pages, two separate files.** The 💬 Dialogue page and the 🧩 UI Strings page each have their own Import / Export. They don't share state. Switching tabs doesn't lose work on the other side.

---

## Workflow — Dialogue page

### Setting up
1. **Text language** dropdown (top-right) → pick your target locale.
2. **Script** dropdown (left sidebar) → scripts are listed in story order: tutorial → 主角家 → 第一日 → 第二日 (早/工/歸) → 第三日 → 第四日 → 第五日 → 後日談 → 異常後日談 → 跨日對話 (支線/路人/街景).
3. **📥 Import translation file** — load the file the team last sent you. Replaces this language's state.
4. If you have no starter file, just start editing — Export will generate one for you.

### Editing in context — ✏️ Translation Edit Mode
This is the main editing flow.

1. With your target locale selected, click **✏️ Translation Edit Mode** above the dialogue area. Click the **?** next to it for the symbol legend.
2. The dialogue panel switches to a **flat editing view**: every line, every choice option, every `«if»` branch of the current node is laid out top-to-bottom. You sweep through it instead of clicking choices.
3. Hover any line → click **✏️** → textarea opens. `Ctrl/Cmd + Enter` saves, `Esc` cancels.
4. **All branches are shown.** Even if `«if cond»` and `«else»` are mutually exclusive at runtime, both branches need translating — the game ships both.
5. **`goto labelName` is clickable.** It scrolls to the matching `@labelName`. If the label is in another node, the previewer switches nodes and scrolls. The destination flashes yellow so you can see it land.
6. **`— end —`** (red badge) means the dialogue ends there. Anything below it in the same indent is unreachable from that branch.
7. **Dim grey monospace lines** (`set $foo = 1`, `wait 0.5s`) are runtime side-effects shown for context. Not translatable.

### Side-by-side review — 📊 Compare languages
1. Click **📊 Compare languages** (next to the Edit Mode toggle) to swap the dialogue area for a comparison table of the active node.
2. One row per line / option, one column per available language.
3. **Click any non-source cell** (anything except the `en-US` / `zh-TW` columns) to edit it directly. You can edit any language from here, not only the one in the Text-language dropdown.
4. Press **Esc** to leave Compare Mode.

### Translator notes
1. **📝 Note** in the dialogue toolbar opens a free-form note for the current node.
2. Saves automatically as you type. Nodes that have a note show 📝 in the sidebar.
3. Notes ride along inside the exported file (in the `Notes` column), so they travel with the file across machines / browsers / translators. They don't travel through the browser cache alone.

### Export
1. **💾 Export translation file** downloads a `.csv`.
2. Send the file to the team. **Keep a copy locally.** Next session, re-import it to keep going.
3. The status pill at the top reads **✓ Saved Nm ago** (clean) or **⚠️ Unexported edits** (dirty). If you close the tab while dirty, the browser will warn you. Trust the warning.

---

## Workflow — UI Strings page

For the multi-sheet `翻譯對照表 (*).xlsx` (item names, sign descriptions, menu copy, character names, …).

1. **📥 Import .xlsx** — loads the whole workbook. Replaces any UI Strings work currently in the browser.
2. **Sheet tabs** across the top mirror the Excel sheet order (流程調查物件 / 常態調查物件 / 互動 / 任務 / 角色 / 章節 / 其它 / 人員名單). Click to switch.
3. **Click any cell** to edit (any language column — UI Strings has no source-locked language). `Ctrl/Cmd + Enter` saves, `Esc` cancels.
4. **Filter** narrows visible rows by Key within the active sheet only. Switching sheets clears the filter.
5. **💾 Export .xlsx** rebuilds the workbook with your edits. Sheet order, column order, every original row (including the `//` divider rows) are preserved exactly. Send this back to the team — it can be re-uploaded as-is next session.
6. **🗑 Clear** drops everything from the browser cache. Only do this after exporting.

---

## What is durable, what is not

| What | Where | Survives a refresh? | Survives 7+ days idle? | Survives a browser switch? |
| --- | --- | --- | --- | --- |
| Imported file + your inline edits | Browser cache | Yes | **No** (Safari ITP, eviction) | **No** |
| Translator notes | Browser cache | Yes | **No** | **No** |
| UI Strings workbook + edits | Browser cache | Yes | **No** | **No** |
| **Exported `.csv` / `.xlsx`** | **The file you saved** | **Yes** | **Yes** | **Yes** |

Translation: **Export every session.** The file is the only thing you can rely on long-term.

---

## Common scenarios

### "I see the English source instead of my translation"
The Text language dropdown is on `en-US` (or `zh-TW`). Switch to your target locale. The source languages are intentionally not overrideable; you're seeing the source because the previewer treats it as un-translatable.

### "Export doesn't seem to do anything / says 'no baseline'"
You're on a source locale. Switch to a target locale and try again. If you're already on a target locale and have never imported a file, edit at least one line first — Export needs something to package.

### "Import warns 'detected locale X but you selected Y'"
The file's locale doesn't match the dropdown. Usually one of them is wrong. Cancel, fix, retry.

### "The pill says ⚠️ Unexported edits but I don't think I changed anything"
Some action — a one-character edit, a note added — marked the state dirty. Press 💾 Export anyway; the pill flips to clean afterwards. If you genuinely don't want to save, **🔁 Reset this language** wipes back to bundled defaults (destructive, no undo).

### "I refreshed / closed the tab and my work is gone"
- If you didn't export and the cache was cleared (Safari ITP, manual clear, browser switch) — the work is gone. Re-import your last exported file and continue.
- If the cache wasn't cleared, the work is still there. Just keep editing.

### "Edit Mode looks the same as before"
You're probably on a source locale. Switch to your target locale and toggle Edit Mode again — the ✏️ buttons only appear for editable rows.

### "Compare Mode shows `!` or `— missing —` in some columns"
That language's source data couldn't load (network blip, missing locale file). Other columns still work. Refresh the page and try again; if it persists, tell the team.

### "Browser says storage is full"
You've accumulated too much in the cache (multiple languages with full baselines). Export everything you care about, then use **🔁 Reset this language** on locales you're not actively touching.

### "The file the team sent me won't import"
The previewer reads two formats:
- Dialogue: a CSV/xlsx with columns roughly `Type / Gender / CharacterName / en-US / <locale> / ID / FileName / NodeTitle / Notes` (Unity v2 LocKit format).
- UI Strings: the multi-sheet `翻譯對照表` xlsx with `Key | zh-TW | zh-CN | en-US | …` columns.

Anything else won't import — ask the team to convert it.

---

## Things to keep intact while translating

- **`{$variableName}` markers in dialogue lines.** These are runtime substitutions — the game replaces them with the actual value (player name, item name, count, etc.). Leave them exactly as-is, including the `$` and the curly braces. Spacing around them: keep what the source has.
- **Markup tags.** `<color=#xxxxxx>...</color>`, `<i>...</i>`, `<b>...</b>`, `<size=N>...</size>`, `<y>...</y>` (warm yellow), `<s>...</s>` (whisper italic), `<sup>` / `<sub>`, `<mark=#xxxxxx>...</mark>`. Keep the tags around the same words. Rearranging where the tagged span sits in the sentence is fine; deleting tags removes the visual effect; mistyping the closing tag breaks the rest of the line on screen.
- **Speaker names** in dialogue do not need to be translated through this tool — they come from a separate character-name table maintained by the team. Translate the line text, leave the `Speaker:` prefix alone.
- **Goto / label names** (`@labelName`, `goto labelName`) are identifiers, not visible text. Don't translate them. They don't appear in the exported file anyway.

---

## Keyboard shortcuts (Dialogue page)

| Key | Action |
| --- | --- |
| `Space` / `Enter` | Advance one line |
| `1`–`9` | Pick the corresponding option |
| `R` | Replay current node from the top |
| `←` / `Backspace` | Step back one line |
| `Ctrl/Cmd + Enter` | Save inline edit |
| `Esc` | Cancel inline edit / exit Compare Mode |

Shortcuts are off while typing in any input / textarea.

---

## In-app help

- Top-right **?** — overview of every feature.
- **?** next to the Edit Mode toggle — Edit Mode specifics: flat view symbols, the inline editor, clickable goto labels.
