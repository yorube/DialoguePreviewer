# Translator Guide

Quick reference for translators working in the MBU Dialogue Previewer.

---

## Get going in 5 steps

1. Open the previewer in any modern browser (Chrome, Edge, Firefox, Safari).
2. Top-right **Text language** dropdown → pick your target locale (`fr-FR`, `ja-JP`, etc.). `en-US` and `zh-TW` are source — don't pick those.
3. Left sidebar **Script** dropdown → pick a script. Click any node in the list.
4. Press **✏️ Translation Edit Mode** above the dialogue area. Hover any line, click ✏️, type your translation, save with `Ctrl/Cmd + Enter`.
5. When you're done (or finishing for the day), press **💾 Export translation file** at the top. Keep that file safe — it's your save.

That's the whole loop. Everything below is detail and edge cases.

---

## A few things worth knowing upfront

- **The exported file is your only real save.** Browser-stored progress is convenient but not durable — Safari clears it after 7 days idle, switching browsers / computers loses it, clearing site data wipes it. Export every session and keep the file.
- **Importing replaces, doesn't merge.** When you import a translation file, it overwrites the current state for that language entirely. Import a fresh starter file at the start of a session, edit, export. Don't import again mid-session unless you mean to throw away your work.
- **Two pages, two separate files.** The 💬 Dialogue page handles spoken lines; the 🧩 UI Strings page handles item names / sign descriptions / menu copy. They have their own Import / Export and don't interfere with each other.

---

## Dialogue page — editing in context

After you toggle **✏️ Translation Edit Mode**, the dialogue area changes to a **flat view**: every line, every choice option, every `«if»` branch of the current node is laid out top-to-bottom on one scrollable page. You sweep through it instead of clicking choices to walk the dialogue.

Hover any row → click **✏️** → a textarea opens. Save with `Ctrl/Cmd + Enter`, cancel with `Esc`.

A few notes on what you'll see:

- **All branches show.** Even mutually exclusive `«if»` / `«else»` blocks display both — both need translating because the game ships both.
- **`goto labelName` is clickable.** It scrolls to the matching `@labelName`, switching nodes if needed. The destination flashes yellow.
- **`— end —`** (red badge) means the dialogue ends there. Anything below in the same indent isn't reachable.
- **Dim grey monospace lines** (`set $foo = 1`, `wait 0.5s`) are runtime side-effects shown for context only. Not editable.
- **Click the `?`** next to the Edit Mode toggle for the full symbol legend.

---

## Dialogue page — side-by-side review (📊)

Click **📊 Compare languages** (next to the Edit Mode toggle) to swap the dialogue area for a comparison table of the active node — one row per line, one column per available language.

Click any non-source cell to edit it directly. You can edit any language from here, not only the one in the Text-language dropdown. Press **Esc** to leave.

---

## Dialogue page — translator notes (📝)

Click **📝 Note** in the dialogue toolbar to attach a free-form note to the current node. Saves as you type. Notes ride along inside the exported file (in the `Notes` column), so they travel across machines / browsers / translators.

---

## UI Strings page

For the multi-sheet `翻譯對照表 (*).xlsx` (item names, sign descriptions, menu copy, character names, …).

1. **📥 Import .xlsx** — loads the whole workbook.
2. **Sheet tabs** across the top mirror the Excel sheet order. Click to switch.
3. **Click any cell to edit** (any language column). `Ctrl/Cmd + Enter` to save.
4. **Filter** narrows visible rows by Key within the active sheet.
5. **💾 Export .xlsx** rebuilds the file — sheet order, columns, every row preserved exactly. Re-uploadable as-is next session.

Rows whose Key starts with `//` (like `//第一日`) are section headers — they show up as banners and aren't editable.

---

## When something looks off

| What you see | What to try |
| --- | --- |
| English source instead of your translation | Text language dropdown is on `en-US`. Switch to your target locale. |
| Edit Mode toggle does nothing visible | Same reason — switch to your target locale. ✏️ buttons only appear for editable rows. |
| Export does nothing / says "no baseline" | You're on a source locale, or you've never edited anything. Switch locale + edit at least one line. |
| Import warns "detected locale X but you selected Y" | The file's locale doesn't match the dropdown. Cancel, fix, retry. |
| Pill says ⚠️ Unexported edits but I don't think I changed anything | Press 💾 Export anyway — pill flips back to clean. If you really want to discard, **🔁 Reset this language**. |
| Refreshed and my work is gone | If the cache wasn't cleared, it's still there — just keep editing. If it was cleared (Safari ITP, browser switch, etc.), re-import your last exported file. |
| Compare Mode shows `!` or `— missing —` in some columns | That language's data didn't load. Refresh and try again. |
| Browser says storage is full | Export your work, then **🔁 Reset this language** on locales you're not actively touching. |
| Import refuses the file | The previewer expects v2 LocKit CSV/xlsx for dialogue, or the multi-sheet `翻譯對照表` xlsx for UI strings. Other formats won't import — ask the team to convert. |

---

## Keep these intact while translating

- **TMP markup tags** — `<color=#xxxxxx>...</color>`, `<i>...</i>`, `<b>...</b>`, `<size=N>...</size>`, `<y>...</y>` (warm yellow), `<s>...</s>` (whisper italic), `<sup>` / `<sub>`, `<mark=#xxxxxx>...</mark>`. Wrap the equivalent words in your translation; deleting a tag drops the visual effect, mistyping the closing tag breaks the rest of the line on screen.
- **Speaker names** in dialogue — translated through a separate character-name table maintained by the team. Translate the line text, leave the `Speaker:` prefix alone.
- **`@labelName` and `goto labelName`** — these are identifiers, not visible text. Don't translate them. (They don't reach the export anyway.)

---

## What's saved where

| Item | Where | Survives 7+ days idle? | Survives browser / machine switch? |
| --- | --- | --- | --- |
| Imported file + your edits | Browser cache | **No** | **No** |
| Translator notes | Browser cache (and inside the exported file) | **No** for the cache; **Yes** in the file | Same |
| UI Strings workbook + edits | Browser cache | **No** | **No** |
| **Exported `.csv` / `.xlsx`** | **The file you saved** | **Yes** | **Yes** |

Short version: **export every session.**

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

Shortcuts pause while you're typing in any input or textarea.

---

## In-app help

- Top-right **?** — overview of every feature.
- **?** next to the Edit Mode toggle — Edit Mode specifics (flat view symbols, the inline editor, clickable goto labels).
