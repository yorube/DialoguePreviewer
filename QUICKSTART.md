# Quick Start for Translators

Welcome! This is a one-page primer for using the **MBU Dialogue Previewer** to translate the game. You don't need to install anything — just open the link in any modern desktop browser (Chrome, Edge, Firefox, Safari).

> **The single most important rule.** Your work is saved in your browser as you edit, but the **only safe long-term save is the file you press 💾 Export to download.** Always export before closing the tab, and re-import the file the next time you sit down to keep going. Treat the browser cache as scratch paper, not a save slot.

---

## 1. The two pages

At the very top of the screen there are two tabs:

| Tab | What it's for |
| --- | --- |
| **💬 Dialogue** | All in-game spoken lines and player choices, organised by script and node. |
| **🧩 UI Strings** | Item names, sign descriptions, menu copy — the short UI text the team ships as a multi-sheet `.xlsx`. |

Both pages save independently and have their own Import / Export. Switch between them as needed; your selection is remembered after a refresh.

---

## 2. Translating dialogue (the 💬 Dialogue page)

### 2.1 First-time setup
1. **Pick your target language.** Top-right of the screen, **Text language** dropdown. Choose your locale (e.g. `fr-FR`, `ja-JP`, `ru-RU`). This is the only language that will accept your edits.
2. **Pick the script** in the left sidebar — they're listed in story order (tutorial → Day 1 → Day 2 → … → epilogues → cross-day side dialogues).
3. **(Optional) Import a translation file.** If your team gave you a partially-filled `.csv` / `.xlsx`, click **📥 Import translation file** in the top toolbar. The file fully replaces this language's current state.
4. If you don't have a starter file, just start editing — the tool will generate a fresh export for you when you're done.

### 2.2 Editing in context — ✏️ Translation Edit Mode
This is the everyday editing flow.

1. With a target language selected (not `en-US` or `zh-TW` — those are source languages), click **✏️ Translation Edit Mode** above the dialogue area. Click the **?** next to it for the full guide.
2. The dialogue panel switches to a **flat editing view**: the entire current node — every line, every option, every `<<if>>` branch — is laid out top-to-bottom on one scrollable page.
3. Hover any line → click the **✏️** icon → a textarea opens. Type your translation, then `Ctrl/Cmd + Enter` to save (or `Esc` to cancel).
4. **Goto labels are clickable.** When you see `goto someLabel`, click it; the view scrolls to the matching `@someLabel` (even if it's in another node) and flashes briefly. Useful for following branches without losing your place.
5. **Symbols you'll see:**
   - `→ 1.`, `→ 2.` — player choice options. The indented block under each one is what plays after that choice.
   - `«if $cond»` … `«endif»` — a conditional branch. **Both branches are always shown** so nothing slips through; the dashed indent on the left tells you what's nested.
   - `@labelName` — a jump target. Other lines may `goto` here.
   - `— end —` (red badge) — the dialogue ends at that point. Anything below in the same indent isn't reachable from this branch.
   - Dim grey monospace lines (`set $foo = 1`, `wait 0.5s`, `→ goto X`) are runtime side-effects shown for context. Not editable.

### 2.3 Side-by-side review — 📊 Compare languages
1. Right next to the Edit Mode toggle, click **📊 Compare languages** to swap the dialogue panel for a multi-language comparison table.
2. You'll see one row per translatable line / option in the current node, one column per locale (`en-US`, `zh-TW`, plus every translation).
3. Click any **non-source** cell to edit it directly. Saving writes back to that locale's translation immediately. You can edit any language from here, not only the active one in the dropdown.
4. The active-language column is highlighted; source columns (`en-US`, `zh-TW`) have a slightly darker background and aren't editable.
5. Press **Esc** to leave Compare Mode. Compare Mode and Edit Mode are mutually exclusive — turning either on will turn the other off.

### 2.4 Translator notes
1. Click **📝 Note** in the toolbar (or the **Notes** tab in the source panel) to attach a free-form note to the current node.
2. Notes save automatically as you type. Nodes that have a note show 📝 in the sidebar.
3. Notes travel inside your exported `.csv` / `.xlsx` (Notes column), so they work across browsers, machines, and translators.

### 2.5 Exporting your work
1. Click **💾 Export translation file** in the top toolbar.
2. You'll get a `.csv` in Unity v2 LocKit format (`Type | Gender | CharacterName | en-US | <locale> | ID | FileName | NodeTitle | Notes`).
3. **Send this file to the team. Keep a copy.** Next time, re-import it so you don't lose progress.

The status pill at the top of the screen reads **✓ Saved Nm ago** when everything is exported, or **⚠️ Unexported edits** when you have local changes that aren't in any file yet. Closing the tab while dirty triggers a browser confirmation prompt.

---

## 3. Translating UI text (the 🧩 UI Strings page)

This page is for the multi-sheet `翻譯對照表 (*).xlsx` the team uses for item names, sign descriptions, and other short UI copy.

1. **📥 Import .xlsx** in the top toolbar. The whole workbook (all sheets, all rows) loads at once.
2. Sheet tabs appear across the top — one per category (`流程調查物件`, `常態調查物件`, `互動`, `任務`, `角色`, `章節`, `其它`, `人員名單`). Click a tab to switch.
3. Each sheet is a comparison table: `Key | zh-TW | zh-CN | en-US | ja-JP | it-IT | ru-RU | es-ES | fr-FR`. **Click any cell** (any language) to edit; `Ctrl/Cmd + Enter` saves, `Esc` cancels.
4. Rows whose Key starts with `//` (e.g. `//第一日`) are visual section headers — they render as full-width banners and aren't editable.
5. Use the **filter box** to narrow rows by Key.
6. **💾 Export .xlsx** rebuilds the workbook with your edits, keeping every original sheet, column, and row intact. Round-trip safe — send this file back to the team.

---

## 4. Keyboard shortcuts (Dialogue page)

| Key | Action |
| --- | --- |
| `Space` / `Enter` | Advance one line |
| `1`–`9` | Pick the corresponding option |
| `R` | Replay the current node from the top |
| `←` / `Backspace` | Step back one line |
| `Ctrl/Cmd + Enter` | Save an inline edit |
| `Esc` | Cancel an inline edit / exit Compare Mode |

---

## 5. Things that are saved (and things that aren't)

**Saved in your browser** until you clear it:
- Imported translation file (baseline) and your inline edits
- Translator notes
- UI Strings workbook + edits
- Source font size, splitter widths, interface language, last active page

**Not saved across reloads:**
- Which script / node / language was active
- Edit Mode / Compare Mode toggles
- Variable overrides on the right-hand panel

**Always lost without an export:**
- Anything, if you switch browsers / computers, clear site data, or use Safari for more than 7 days without revisiting (Safari's ITP automatically clears localStorage).

So: **export early, export often.** The file you download is the truth.

---

## 6. Where to find help in the app

- The **?** button at the top-right opens the global help (overview of every feature).
- Inside Translation Edit Mode, a **?** sits next to the toggle — that one is dedicated to Edit Mode mechanics (flat-view symbols, the inline editor, clickable goto labels).
- This document covers the workflow; the in-app help covers the details.

---

## 7. If something looks wrong

1. Check the **Text language** dropdown in the top-right. Most "I see English instead of my translation" issues are because the dropdown is set to `en-US`, which is the source language and intentionally not editable.
2. If you've edited but the indicator is still **⚠️ Unexported edits**, you haven't yet downloaded the file — press **💾 Export** before closing.
3. If the page is blank or loading forever, refresh once. Your work is held in localStorage, so a refresh won't lose anything you typed.
4. Anything stranger than that, send a screenshot + a description (which page, which node, which language, what you clicked) to the team.

Happy translating!
