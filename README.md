# Dialogue Previewer — Translator Reference

Browser tool for translating MBU dialogue and UI strings. Open the URL — nothing to install.

For the bare-minimum starter, see [QUICKSTART.md](QUICKSTART.md).

---

## Two pages

A tab strip at the very top switches between two independent tools:

- **💬 Dialogue / 對話** — Yarn dialogue files, organised by script and node.
- **🧩 UI Strings / UI 字串** — the multi-sheet `翻譯對照表` xlsx for in-game UI copy (item names, sign descriptions, menu copy, character names).

Each page has its own Import / Export. They don't share state. Your last-active page is remembered across reloads.

---

## Dialogue page

### Top bar

- **Text language** — your target locale. `en-US` and `zh-TW` are source languages and intentionally not editable.
- **Interface language** — UI in English / 繁體中文.
- **📥 Import translation file** — load a `.csv` / `.xlsx` the team gave you. Replaces the current language's state entirely.
- **💾 Export translation file** — download your translation as a `.csv` (Unity v2 LocKit format). This is your canonical save.
- **🔁 Reset this language** — clear all imported baseline + inline edits for the current language. Falls back to bundled defaults. Cannot be undone.
- **Status pill** — `✓ Saved Nm ago` (clean) or `⚠️ Unexported edits` (dirty). Closing the tab while dirty triggers a browser confirmation.

### Sidebar (nodes)

Scripts are listed in story order: tutorial → 主角家 → 第一日 → 第二日 (早 / 工 / 歸) → 第三日 → 第四日 → 第五日 → 後日談 → 異常後日談 → 跨日對話 (支線 / 路人 / 街景).

Type in the filter box to narrow the list. Each node is numbered by its visible position. Nodes with translator notes show 📝.

### Source panel (left of the dialogue)

Two tabs:

- **Source** — raw script for the current node, with line numbers. The line being shown highlights as you advance. `A-` / `A+` adjusts font size; `Ctrl + scroll` zooms.
- **Notes** — free-form note for the current node. Saves as you type. Notes ride along inside the exported file (in the `Notes` column), so they travel across machines / browsers / translators.

The **📝 Note** button on the dialogue toolbar is a shortcut to flip to the Notes tab.

### Variables panel (right)

Live state of dialogue variables. You can override any value (number / boolean / text); overrides reapply on every replay, useful for forcing branch-specific dialogue. The 🔄 button clears all overrides.

### Runtime preview

Click any node to play it. To advance:

- Click in the empty area, or press **Space** / **Enter**, or click **▼ Continue**.
- Choices: click one or press its number key (1–9). Your choice gets a blue quoted line in the transcript.
- **← Step back** undoes one line. **↶** at the right end of any past line jumps back to that point. **⟳ Replay this node** restarts.

### ✏️ Translation Edit Mode

Above the dialogue area. With a target locale selected, click to enter. The dialogue area swaps to a **flat editing view**: every line, every choice option, every `«if»` branch of the current node is laid out top-to-bottom. You sweep through it instead of clicking choices.

Hover any line → click **✏️** → textarea opens. `Ctrl/Cmd + Enter` saves, `Esc` cancels.

Symbols in the flat view:

- `→ 1.`, `→ 2.` — choice options. The indented block below each is its body.
- `«if cond»` … `«endif»` — conditional branch. Both branches show; both need translating.
- `@labelName` — a jump target.
- `goto labelName` / `condGoto labelName (cond)` — clickable; scrolls to the matching `@labelName` (switching nodes if needed). Destination flashes yellow.
- `— end —` (red badge) — dialogue ends here. Anything below in the same indent isn't reachable.
- Dim grey monospace lines (`set $foo = 1`, `wait 0.5s`, `→ goto X`) — runtime side-effects shown for context. Not editable.

The **?** next to the Edit Mode toggle opens a dedicated guide for these symbols.

### 📊 Compare Mode

Next to the Edit Mode toggle. Swaps the dialogue area for a side-by-side comparison table — one row per line / option, one column per available locale.

Click any non-source cell to edit it directly. You can edit any locale here, not only the active one in the Text-language dropdown. Press **Esc** to leave.

Compare Mode and Edit Mode are mutually exclusive — turning either on disables the other.

### Import / Export

- **Import** fully replaces the current locale's state with the file's contents. Existing inline edits are wiped — export first if you want to keep them. Import also restores translator notes if the file's `Notes` column is populated.
- **Export** writes a `.csv` in Unity v2 LocKit format: `Type | Gender | CharacterName | en-US | <locale> | ID | FileName | NodeTitle | Notes`. If you imported a file, the export reuses its exact format. If you never imported, the export synthesises the CSV from the bundled en-US sources — usable as-is for first-time translators.

---

## UI Strings page

For the multi-sheet `翻譯對照表 (*).xlsx`. Columns: `Key | zh-TW | zh-CN | en-US | ja-JP | it-IT | ru-RU | es-ES | fr-FR`.

- **📥 Import .xlsx** — loads the whole workbook. Replaces any UI Strings work currently in the browser.
- **Sheet tabs** across the top mirror the Excel sheet order. Click to switch.
- **Click any cell** to edit (any language column — UI Strings has no source-locked language). `Ctrl/Cmd + Enter` saves, `Esc` cancels.
- **Filter** narrows visible rows by Key within the active sheet only.
- **💾 Export .xlsx** rebuilds the workbook with your edits. Sheet order, columns, every original row (including `//` divider rows) preserved exactly. Re-uploadable as-is.
- **🗑 Clear** drops everything from the browser cache. Only do this after exporting.

Rows whose Key starts with `//` (like `//第一日`) are visual section headers — they render as banners and aren't editable.

---

## Things to keep intact while translating

- **TMP markup tags** — `<color=#xxxxxx>...</color>`, `<i>`, `<b>`, `<size=N>`, `<y>` (warm yellow), `<s>` (whisper italic), `<sup>` / `<sub>`, `<mark=#xxxxxx>`. Wrap the equivalent words in your translation. Deleting a tag drops the visual effect; mistyping the closing tag breaks the rest of the line on screen.
- **Speaker names** — translated through a separate character-name table maintained by the team, not here. Translate the line text after the colon; leave the `Speaker:` prefix alone.
- **`@labelName` and `goto labelName`** — identifiers, not visible text. Don't translate them. They don't reach the export anyway.

---

## What's saved where

| Item | Where | Survives 7+ days idle? | Survives browser / machine switch? |
| --- | --- | --- | --- |
| Imported file + your edits | Browser cache | **No** | **No** |
| Translator notes (cache) | Browser cache | **No** | **No** |
| Translator notes (in exported file) | The file you saved | **Yes** | **Yes** |
| UI Strings workbook + edits | Browser cache | **No** | **No** |
| Layout, font size, UI language | Browser cache | Mostly yes | **No** |
| **Exported `.csv` / `.xlsx`** | **The file you saved** | **Yes** | **Yes** |

Browser cache (`localStorage`) gets wiped by Safari ITP after 7 days of no visits, by clearing site data, by switching browsers, or under storage pressure. **Export every session — the file is the only thing you can rely on.**

---

## Layout

The four columns on the Dialogue page can be resized — drag any of the thin vertical dividers between panels. Layout is saved in your browser. On phones the columns stack vertically.

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

Shortcuts pause while typing in any input or textarea.

---

## In-app help

- Top-right **?** — overview of every feature.
- **?** next to the Edit Mode toggle — Edit Mode specifics (flat view symbols, the inline editor, clickable goto labels).
