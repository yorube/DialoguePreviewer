# Dialogue Previewer — Translator Guide

A read-only tool for previewing in-game dialogue and leaving translation notes.
Open the URL in any modern browser; nothing to install.

## Picking what to read

Top bar:

- **Script** — choose a chapter / scene
- **Language** — switch translations (en-US / es-ES / ru-RU / it-IT / ja-JP / zh-CN / zh-TW)
- **UI** — interface language (English / 繁體中文)
- **Load .json** — drop in a local file to override the bundled version (your changes stay in your tab only)

Left panel: every node in the current script, with its index number.
Type in the filter box to narrow the list. Click a node to jump there.

## Reading dialogue

Center panel shows the dialogue line by line. Speakers are colored; thoughts
are dimmed. A small `M` or `F` chip next to a name is a grammatical-gender
hint for translators (no chip = neutral / narrator).

To advance:

- Click anywhere in the empty area, or
- Press **Space** / **Enter**, or
- Click the **▼ Continue** button

When choices appear you must pick one — there's no auto-advance for choices.
Click a choice or press its number key (1–9). Your pick gets a blue quoted
line in the transcript so you can see what you chose.

## Going back

Three ways:

- **← Step back** (toolbar) — undo one line
- **↶** at the right end of every past line — jump straight back to that line
- **⟳ Replay this node** (toolbar) — restart the current node from the beginning

History after the point you jumped to is discarded — you can take a new path
from there.

## Source text + per-node notes

Right side has two tabs:

- **Source** — the raw script for the current node, with line numbers. The
  line being shown highlights as you advance. `A-` / `A+` adjusts the font
  size; **Ctrl + scroll** also zooms.
- **Notes** — a private text box. Anything you write here is saved in your
  browser only (no upload). Each node has its own note. Notes survive
  refresh and browser restart.

The **📝 Note** button on the dialogue toolbar is a shortcut to flip to the
Notes tab. The button shows an amber dot when the current node already has a
saved note; nodes with notes also show a 📝 mark in the left list.

## Variables (right side)

Shows the live state of the dialogue's variables. You can override any value
inline (number / boolean / text); the override is reapplied on every replay,
which lets you force-route to a specific branch for testing. The 🔄 button
clears all overrides.

## Layout

The four columns can be resized — drag any of the thin vertical dividers
between panels. Your layout is saved in your browser.

On phones the columns stack vertically.

## Keyboard reference

| Key | Action |
|---|---|
| **Space** or **Enter** | Continue to next line |
| **1**–**9** | Pick choice |
| **←** or **Backspace** | Step back |
| **R** | Replay current node |

## Where notes go

Translation notes live in your browser's local storage, scoped to this tool's
URL. They are **not** uploaded, **not** shared with the dev, and **not**
visible to other translators. Clearing your browser data will wipe them.
