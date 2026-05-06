// translation-export.js
// Pure data-pipeline helpers used by translation-ui.js's onDownloadLocFile +
// onUpload flows. No DOM, no STATE — every dependency comes in as ctx so the
// functions are easy to test in isolation and easy to reason about.
//
// Exposed via window.TranslationExport.

(function (global) {
  'use strict';

  // Map speakers.json single-char codes ('M' / 'F' / 'N') to the long-form
  // labels written into the Gender column. Anything unrecognised — narrators,
  // unmarked NPCs, missing entries — falls through to 'none' so the column
  // is never blank.
  function genderLabel(raw) {
    if (raw === 'M' || raw === 'm') return 'male';
    if (raw === 'F' || raw === 'f') return 'female';
    return 'none';
  }

  // Build a v2 LocKit-style sheet (Type, Gender, CharacterName, en-US,
  // {locale}, ID, FileName, NodeTitle, Notes, ReviewStatus) by re-running
  // YarnConverter.buildSO over every loaded en-US project — same code path
  // Unity v2 uses, so the file is import-ready. Trailing FileName / NodeTitle
  // / Notes / ReviewStatus columns let translator notes and review states
  // round-trip across browsers (Unity's parser locates columns by header name
  // and ignores unknown extras). Defaults to .xlsx — translators read in Excel,
  // and xlsx avoids CSV's BOM / escape pitfalls plus preserves cell formatting.
  // Returns null when there's nothing to emit (no loaded en-US projects, no
  // matching guids, etc).
  //
  // ctx = { guids, characterKeys, characterTranslations, speakerGender,
  //         getAllGroups, getEntry, getNote }
  function buildSyntheticSource(targetLocale, ctx) {
    if (!ctx || !ctx.getAllGroups || !ctx.getEntry) return null;
    if (!ctx.guids) return null;
    if (typeof YarnConverter === 'undefined') return null;

    const headers = ['Type', 'Gender', 'CharacterName', 'en-US', targetLocale, 'ID', 'FileName', 'NodeTitle', 'Notes', 'ReviewStatus'];
    const rows = [];
    const charCtx = {
      characterKeys: ctx.characterKeys || {},
      characterTranslations: ctx.characterTranslations || {},
      locale: 'en-US',
    };
    const genderMap = ctx.speakerGender || {};
    const getNote = ctx.getNote || (() => '');

    for (const group of ctx.getAllGroups()) {
      const enEntry = ctx.getEntry(group, 'en-US');
      if (!enEntry || !enEntry.project) continue;
      const guid = ctx.guids[enEntry.filename];
      if (!guid) continue;
      const rawNodes = enEntry.project.rawNodes || [];
      let so;
      try {
        so = YarnConverter.buildSO(rawNodes, guid, charCtx);
      } catch (e) {
        console.warn('[translation-export] buildSO failed for', enEntry.filename, e);
        continue;
      }
      for (const node of so) {
        const noteText = getNote(group, node.title) || '';
        let firstRow = true;
        for (const line of node.textLines) {
          if (line.category !== 'Dialogue' && line.category !== 'Option') continue;
          if (!line.dialogue) continue;
          rows.push([
            line.category,
            genderLabel(genderMap[line.characterName]),
            line.characterName || '',
            line.dialogue,
            '',
            line.uid,
            enEntry.filename,
            node.title,
            firstRow ? noteText : '',
            '',   // ReviewStatus — populated by writer from the statuses map
          ]);
          firstRow = false;
        }
      }
    }

    if (rows.length === 0) return null;
    return {
      format: 'xlsx',
      fileName: `${targetLocale}_translations.xlsx`,
      headers,
      rows,
      idCol: 5,
      localeCol: 4,
      statusCol: 9,
      csvHasBom: false,   // xlsx doesn't carry a BOM; field kept for shape parity
    };
  }

  // Augment an uploaded source structure (whatever shape the user gave us)
  // with FileName / NodeTitle / Notes / ReviewStatus columns so notes and
  // statuses round-trip even when the original file didn't carry them.
  // No-op when the original already has every column we'd add.
  //
  // ctx = { guids, getAllGroups, getEntry, getNote }
  function augmentSourceForExport(source, ctx) {
    if (!source || !ctx || !ctx.getNote) return source;
    const out = {
      format:    source.format,
      fileName:  source.fileName,
      headers:   source.headers.slice(),
      rows:      source.rows.map(r => r.slice()),
      idCol:     source.idCol,
      localeCol: source.localeCol,
      statusCol: typeof source.statusCol === 'number' ? source.statusCol : -1,
      csvHasBom: source.csvHasBom,
      // Pass through to LocWriter's surgical-patch path. originalHeaderCount
      // is captured BEFORE we mutate headers below so the patcher knows
      // exactly which columns are "new" vs "existing in user's xlsx".
      originalArrayBuffer: source.originalArrayBuffer,
      originalHeaderCount: source.headers.length,
    };

    const headerIdx = (name) => {
      const target = name.toLowerCase();
      for (let i = 0; i < out.headers.length; i++) {
        if (String(out.headers[i] || '').toLowerCase() === target) return i;
      }
      return -1;
    };

    const ensureCol = (name) => {
      let idx = headerIdx(name);
      if (idx !== -1) return idx;
      idx = out.headers.length;
      out.headers.push(name);
      out.rows.forEach(r => r.push(''));
      return idx;
    };

    const fileCol  = ensureCol('FileName');
    const nodeCol  = ensureCol('NodeTitle');
    const notesCol = ensureCol('Notes');
    const statusCol = ensureCol('ReviewStatus');
    out.statusCol = statusCol;

    // Reverse map: guid → {filename, group, project}
    const guidLookup = {};
    if (ctx.guids && ctx.getAllGroups && ctx.getEntry) {
      for (const group of ctx.getAllGroups()) {
        const en = ctx.getEntry(group, 'en-US');
        if (!en) continue;
        const g = ctx.guids[en.filename];
        if (g) guidLookup[g] = { filename: en.filename, group, project: en.project };
      }
    }

    // First pass: ensure every row has FileName + NodeTitle if we can derive them.
    const seenNodeFirstRow = new Map(); // group||title → rowIdx of first row for that node
    for (let i = 0; i < out.rows.length; i++) {
      const row = out.rows[i];
      const uid = (row[out.idCol] || '').toString().trim();
      const m = uid.match(/^(.+)-(\d+)-\d+$/);
      if (!m) continue;
      const meta = guidLookup[m[1]];
      if (!meta) continue;
      const nodeIndex = parseInt(m[2], 10);
      const nodeTitle = meta.project?.rawNodes?.[nodeIndex]?.title;
      if (!nodeTitle) continue;
      if (!row[fileCol]) row[fileCol] = meta.filename;
      if (!row[nodeCol]) row[nodeCol] = nodeTitle;
      const key = meta.group + '\x00' + nodeTitle;
      if (!seenNodeFirstRow.has(key)) {
        seenNodeFirstRow.set(key, { rowIdx: i, group: meta.group, title: nodeTitle });
      }
    }

    // Second pass: drop the note onto the first row of each node (only if
    // the cell isn't already populated by the user).
    for (const { rowIdx, group, title } of seenNodeFirstRow.values()) {
      if (out.rows[rowIdx][notesCol]) continue;
      const note = ctx.getNote(group, title) || '';
      if (note) out.rows[rowIdx][notesCol] = note;
    }

    return out;
  }

  // Walk an imported source's rows looking for a Notes column; restore each
  // non-empty cell into yp.notes via ctx.setNote.
  //
  // ctx = { guids, getAllGroups, getEntry, setNote }
  function restoreNotesFromSource(source, ctx) {
    if (!source || !source.headers || !source.rows) return 0;
    if (!ctx || !ctx.setNote) return 0;

    const headerIdx = (name) => {
      const target = name.toLowerCase();
      for (let i = 0; i < source.headers.length; i++) {
        if (String(source.headers[i] || '').toLowerCase() === target) return i;
      }
      return -1;
    };
    const notesCol = headerIdx('Notes');
    if (notesCol === -1) return 0;
    const fileCol = headerIdx('FileName');
    const nodeCol = headerIdx('NodeTitle');

    // For finding group when only FileName is available.
    const filenameToGroup = {};
    if (ctx.getAllGroups && ctx.getEntry) {
      for (const group of ctx.getAllGroups()) {
        const en = ctx.getEntry(group, 'en-US');
        if (en) filenameToGroup[en.filename] = group;
      }
    }
    const guidLookup = {};
    if (ctx.guids) {
      for (const [fn, g] of Object.entries(ctx.guids)) {
        guidLookup[g] = { filename: fn, group: filenameToGroup[fn] };
      }
    }
    const idCol = source.idCol;

    let restored = 0;
    for (const row of source.rows) {
      const noteText = (row[notesCol] || '').toString();
      if (!noteText) continue;

      // Resolve (group, nodeTitle) for this row.
      let group = null;
      let nodeTitle = nodeCol !== -1 ? (row[nodeCol] || '').toString().trim() : '';
      if (fileCol !== -1) {
        const fn = (row[fileCol] || '').toString().trim();
        if (fn && filenameToGroup[fn]) group = filenameToGroup[fn];
      }
      if ((!group || !nodeTitle) && idCol != null) {
        const uid = (row[idCol] || '').toString().trim();
        const m = uid.match(/^(.+)-(\d+)-\d+$/);
        if (m) {
          const meta = guidLookup[m[1]];
          if (meta) {
            if (!group) group = meta.group;
            if (!nodeTitle && filenameToGroup[meta.filename]) {
              const en = ctx.getEntry(filenameToGroup[meta.filename], 'en-US');
              const idx = parseInt(m[2], 10);
              nodeTitle = en?.project?.rawNodes?.[idx]?.title || '';
            }
          }
        }
      }
      if (!group || !nodeTitle) continue;
      ctx.setNote(group, nodeTitle, noteText);
      restored++;
    }
    return restored;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.TranslationExport = {
    buildSyntheticSource,
    augmentSourceForExport,
    restoreNotesFromSource,
    downloadBlob,
  };
})(typeof window !== 'undefined' ? window : globalThis);
