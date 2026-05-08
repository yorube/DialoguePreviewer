// loc-writer.js
// 把譯者上傳的檔案結構（headers + rows + idCol/localeCol）拿出來，
// 把翻譯欄填上「baseline + overrides 合併後的最新譯文」，原檔的其他欄位（Type / Gender /
// CharacterName / en-US / Script / NodeTitle…）一律保留。
//
// xlsx 路徑優先走 surgical-patch (patchXlsxBytes): 直接編輯使用者上傳的
// 原 xlsx ArrayBuffer 內的 sheet XML, 只動目標 cells, 其他 cell 樣式 / sheet
// 名 / merge cells / column widths / cell comments / theme / styles.xml /
// sharedStrings.xml 全部保留 byte-equal。Patch 失敗時 fallback 到 rebuild
// (buildXlsxBlob), 確保最壞情況跟舊行為一樣 (產出可開啟但無樣式)。
//
// 目的：讓譯者「下載譯文」拿回的就是他原本給的 .csv / .xlsx 同格式，
// 翻譯流程不需要碰到 Unity-side 的 JSON。
//
// 依賴：XLSX (SheetJS) for xlsx rebuild。CSV 是純字串組裝。
//      JSZip for xlsx surgical patch。DOMParser/XMLSerializer (browser builtin).

(function (global) {
  'use strict';

  // 'ReviewStatus' header 名稱（case-insensitive 比對）
  const REVIEW_STATUS_HEADER_NORM = 'reviewstatus';
  // SpreadsheetML namespace (used throughout patch)
  const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /**
  * 主要入口：依 source.format 自動產生 CSV 字串或 xlsx Blob。
  * @param {object} source - LocParser.parseFile 回傳的 source 結構
  * @param {Map<uid, text>} mergedTranslations - 要寫進譯文欄的內容
  * @param {object} [opts]
  * @param {Map<uid, status>} [opts.statuses] - manualStatus map;會寫進 ReviewStatus 欄
  *                                              (找不到欄時自動 append)
  * @returns {Promise<{ filename: string, mime: string, payload: string | Blob }>}
  *   xlsx surgical-patch 是 async (JSZip 是 promise-based), 所以整個入口
  *   永遠回 Promise — caller 一律 await。
  */
  async function writeLocFile(source, mergedTranslations, opts) {
    opts = opts || {};
    if (!source || !source.headers || !source.rows) {
      throw new Error('source 必須含有 headers + rows');
    }

    // statuses 非空時,確保 source 裡有 ReviewStatus 欄;沒有就 append。
    // 同時更新一份本地的 source view (不汙染呼叫端的物件)。
    const statuses = opts.statuses;
    let workingSource = source;
    if (statuses && statuses.size > 0) {
      workingSource = ensureStatusColumn(source);
    }

    const baseName = opts.suggestedName || deriveOutputName(workingSource.fileName, workingSource.format);

    if (workingSource.format === 'xlsx') {
      // Surgical-patch path: only available when the user uploaded an xlsx
      // (originalArrayBuffer carried through from LocParser). For
      // synthetic / refresh-lost-source cases we fall through to rebuild.
      if (workingSource.originalArrayBuffer && typeof JSZip !== 'undefined') {
        try {
          const buf = await patchXlsxBytes(workingSource, mergedTranslations, statuses);
          return {
            filename: baseName,
            mime: XLSX_MIME,
            payload: new Blob([buf], { type: XLSX_MIME }),
          };
        } catch (e) {
          // Loud + structured so the user (or me, in their console) can
          // see EXACTLY why patch bailed when their export comes out
          // bloated / unstyled — fallback is lossy on both fronts.
          console.error('[LocWriter] xlsx surgical-patch FAILED — falling back to lossy rebuild');
          console.error('  reason:', e.message);
          console.error('  stack:', e.stack);
          console.error('  fileName:', workingSource.fileName);
          console.error('  source.originalHeaderCount:', workingSource.originalHeaderCount);
          console.error('  source.headers.length:', workingSource.headers.length);
        }
      }
      const filledRows = applyTranslationsToRows(workingSource, mergedTranslations, statuses);
      return {
        filename: baseName,
        mime: XLSX_MIME,
        payload: buildXlsxBlob(workingSource.headers, filledRows),
      };
    }
    // CSV
    const filledRows = applyTranslationsToRows(workingSource, mergedTranslations, statuses);
    return {
      filename: baseName,
      mime: 'text/csv;charset=utf-8',
      payload: buildCsvText(workingSource.headers, filledRows, workingSource.csvHasBom),
    };
  }

  // 確保 source.headers 含 ReviewStatus 欄,並且每 row 的長度對齊。
  // 回傳的是 source 的 shallow copy with deep-copied headers/rows;原物件不變。
  function ensureStatusColumn(source) {
    const findStatusCol = (headers) => {
      for (let i = 0; i < headers.length; i++) {
        if (String(headers[i] || '').toLowerCase() === REVIEW_STATUS_HEADER_NORM) return i;
      }
      return -1;
    };
    const existing = findStatusCol(source.headers);
    if (existing !== -1) {
      return Object.assign({}, source, { statusCol: existing });
    }
    const headers = source.headers.slice();
    headers.push('ReviewStatus');
    const rows = source.rows.map(r => {
      const c = r.slice();
      while (c.length < headers.length) c.push('');
      return c;
    });
    return Object.assign({}, source, {
      headers,
      rows,
      statusCol: headers.length - 1,
    });
  }

  /**
  * 把翻譯填回 source.rows 的 localeCol、把 status 填回 statusCol,回傳新的 rows
  * （不修改原物件）。
  */
  function applyTranslationsToRows(source, mergedTranslations, statuses) {
    const statusCol = typeof source.statusCol === 'number' ? source.statusCol : -1;
    const hasStatuses = statuses && statuses.size > 0 && statusCol !== -1;
    const out = [];
    for (const row of source.rows) {
      const r = row.slice();
      const uid = (r[source.idCol] || '').toString().trim();
      if (uid && mergedTranslations.has(uid)) {
        r[source.localeCol] = String(mergedTranslations.get(uid));
      }
      // 沒譯文的格子保留上傳時的內容（可能是空，可能是譯者已填的舊版）

      // ReviewStatus 欄:有就覆寫,沒就清空 (確保「站內清掉狀態」也能 round-trip)
      if (statusCol !== -1) {
        if (hasStatuses && uid && statuses.has(uid)) {
          r[statusCol] = String(statuses.get(uid));
        } else if (statusCol >= row.length) {
          // 因為 ensureStatusColumn 加欄而新出現的格子,預設空白
          r[statusCol] = '';
        } else {
          // 既有欄但這 uid 已沒狀態 → 清空,避免殘留
          r[statusCol] = '';
        }
      }
      out.push(r);
    }
    return out;
  }

  /**
  * 從輸入檔名推下載名稱。把 (en-US) 留著（譯者的檔本來就是給某個 locale 的），
  * 加上 _filled 後綴免得跟原檔搞混。
  */
  function deriveOutputName(originalName, format) {
    if (!originalName) return 'translation_filled.' + (format === 'xlsx' ? 'xlsx' : 'csv');
    // 移除既有副檔名 → 加 _filled → 加新副檔名
    const dotIdx = originalName.lastIndexOf('.');
    const stem = dotIdx === -1 ? originalName : originalName.slice(0, dotIdx);
    const ext = format === 'xlsx' ? 'xlsx' : 'csv';
    return `${stem}_filled.${ext}`;
  }

  // ---- CSV ----

  function buildCsvText(headers, rows, withBom) {
    const lines = [];
    lines.push(headers.map(escapeCsvCell).join(','));
    for (const row of rows) {
      lines.push(row.map(escapeCsvCell).join(','));
    }
    // v2 的 LocKit CSV 用 \r\n（看 BOM + cat -A 看出來），保險寫 \r\n
    const text = lines.join('\r\n') + '\r\n';
    return withBom ? '﻿' + text : text;
  }

  function escapeCsvCell(value) {
    if (value == null) return '';
    const s = String(value);
    // RFC 4180：含 , " \r \n 一律用引號包，內部 " 加倍
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // ---- xlsx (rebuild fallback) ----

  function buildXlsxBlob(headers, rows) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) 未載入；無法產生 xlsx');
    }
    const aoa = [headers].concat(rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Translations');
    // compression:true → DEFLATE. Without this, SheetJS writes the zip
    // entries with STORE (no compression), producing files ~10x larger
    // than the patched / Excel-authored equivalent. Critical for the
    // fallback path because that's the lossy "we couldn't patch, here's
    // a rebuild" outcome — should at least not be huge.
    const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
    return new Blob([arr], { type: XLSX_MIME });
  }

  // ---- xlsx (surgical patch) -----------------------------------------
  // Reads the user's original xlsx (zip), parses ONLY the active sheet's
  // XML, replaces target cells in place (using inline strings so we don't
  // touch the shared-string table), re-zips. styles.xml / theme.xml /
  // sharedStrings.xml / other-sheet XMLs are passed through byte-equal.
  // Failure throws — caller falls back to buildXlsxBlob.

  /**
   * Patch the user's uploaded xlsx ArrayBuffer with new translation /
   * status / appended-column values.
   * @returns {Promise<ArrayBuffer>}
   */
  async function patchXlsxBytes(source, mergedTranslations, statuses) {
    if (!source || !source.originalArrayBuffer) {
      throw new Error('originalArrayBuffer required for patch');
    }
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip not loaded');
    }
    if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
      throw new Error('DOM XML APIs unavailable');
    }

    const zip = await JSZip.loadAsync(source.originalArrayBuffer);
    const sheetPath = await findFirstSheetPath(zip);
    if (!sheetPath) throw new Error('cannot locate first worksheet in xlsx');
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) throw new Error(`worksheet "${sheetPath}" missing from zip`);

    const sheetXml = await sheetFile.async('string');
    const xmlDoc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const errs = xmlDoc.getElementsByTagName('parsererror');
    if (errs.length) throw new Error('xlsx sheet XML parse error');

    const sheetData = firstChildByTag(xmlDoc.documentElement, SS_NS, 'sheetData');
    if (!sheetData) throw new Error('no <sheetData> in worksheet');

    // Determine which columns we'll patch.
    const originalCols = typeof source.originalHeaderCount === 'number'
      ? source.originalHeaderCount
      : source.headers.length;
    const statusCol = typeof source.statusCol === 'number' ? source.statusCol : -1;
    const patchCols = new Set();
    if (typeof source.localeCol === 'number' && source.localeCol >= 0) {
      patchCols.add(source.localeCol);
    }
    if (statusCol >= 0) patchCols.add(statusCol);
    // Any column added by augmentSourceForExport (Script / NodeTitle /
    // Notes / ReviewStatus when they didn't exist) — always emit.
    for (let c = originalCols; c < source.headers.length; c++) patchCols.add(c);

    // Refuse to patch if a merged-cell range overlaps any target column —
    // writing into a merge-absorbed cell corrupts the file in Excel.
    detectMergeConflicts(xmlDoc, source.rows.length, patchCols);

    // Build row + cell index maps ONCE for O(1) lookups during the patch
    // loop. Without these, getOrCreateCell would linear-scan every row /
    // cell per update — for a typical translator xlsx (~10k rows × a few
    // cols/row patched) that's hundreds of millions of DOM ops and the
    // browser hangs visibly under "Preparing export…".
    const rowIndex = new Map();      // rowNum (string) → row element
    const cellIndex = new WeakMap(); // row element → Map<cellRef, cell el>
    for (const row of childrenByTag(sheetData, SS_NS, 'row')) {
      rowIndex.set(row.getAttribute('r'), row);
      const cells = new Map();
      for (const cell of childrenByTag(row, SS_NS, 'c')) {
        cells.set(cell.getAttribute('r'), cell);
      }
      cellIndex.set(row, cells);
    }

    // Apply translation + status to source.rows (mirrors the rebuild path
    // so behavior is identical re: empty-cell-clearing, status removal etc.).
    const filledRows = applyTranslationsToRows(source, mergedTranslations, statuses);

    // Patch header row (row 1) for newly added columns.
    for (let c = originalCols; c < source.headers.length; c++) {
      const cell = getOrCreateCell(xmlDoc, sheetData, 1, c, rowIndex, cellIndex);
      setInlineString(xmlDoc, cell, source.headers[c] || '');
    }

    // Patch data rows.
    for (let i = 0; i < filledRows.length; i++) {
      const excelRow = i + 2;  // header is row 1, data starts at row 2
      const row = filledRows[i];
      for (const colIdx of patchCols) {
        const value = row[colIdx] != null ? row[colIdx] : '';
        const cell = getOrCreateCell(xmlDoc, sheetData, excelRow, colIdx, rowIndex, cellIndex);
        setInlineString(xmlDoc, cell, String(value));
      }
    }

    // Update <dimension> ref if columns were appended.
    if (source.headers.length > originalCols) {
      const dim = firstChildByTag(xmlDoc.documentElement, SS_NS, 'dimension');
      if (dim) {
        const ref = dim.getAttribute('ref') || '';
        const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
        if (m) {
          const newLastCol = colLetterFromIndex(source.headers.length - 1);
          dim.setAttribute('ref', `${m[1]}${m[2]}:${newLastCol}${m[4]}`);
        }
      }
    }

    // Serialize back into the zip. Other zip entries (styles.xml,
    // sharedStrings.xml, theme, other-sheet xml, _rels, …) are passed
    // through byte-equal because we never opened them.
    const newXml = new XMLSerializer().serializeToString(xmlDoc);
    zip.file(sheetPath, newXml);

    // level: 9 matches what Excel writes — keeps re-saved files within
    // the same size envelope as the original (vs JSZip's level 6 default
    // which is 5-15% bigger).
    return await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
  }

  // ---- xlsx patch helpers ----

  // Convert 0-based column index to spreadsheet letter (0→A, 25→Z, 26→AA…).
  function colLetterFromIndex(idx) {
    if (idx < 0) throw new Error('colLetterFromIndex: negative index');
    let n = idx;
    let s = '';
    for (;;) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
      if (n < 0) break;
    }
    return s;
  }

  // Convert "AB123" → 28 (1-based column number).
  function colNumFromRef(ref) {
    const m = /^([A-Z]+)/i.exec(ref || '');
    if (!m) return 0;
    const letters = m[1].toUpperCase();
    let n = 0;
    for (const c of letters) {
      n = n * 26 + (c.charCodeAt(0) - 64);
    }
    return n;
  }

  function rowNumFromRef(ref) {
    const m = /(\d+)$/.exec(ref || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  // Replace cell content with an inline string, preserving the cell's
  // style index (s="N" attribute → keeps user's color/font/border).
  // Drops formula attributes (cm) and cached value (we're replacing with
  // literal text — any formula on this cell is being intentionally erased).
  function setInlineString(xmlDoc, cellEl, value) {
    while (cellEl.firstChild) cellEl.removeChild(cellEl.firstChild);
    cellEl.setAttribute('t', 'inlineStr');
    cellEl.removeAttribute('cm');
    const is = xmlDoc.createElementNS(SS_NS, 'is');
    const t = xmlDoc.createElementNS(SS_NS, 't');
    // Preserve significant leading/trailing whitespace per OOXML spec.
    if (/^\s|\s$/.test(value)) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }
    t.textContent = String(value);
    is.appendChild(t);
    cellEl.appendChild(is);
  }

  // O(1) row+cell lookup via the pre-built indexes. Inserts in numeric
  // order when creating new rows / cells (those re-walk children, but
  // creation is rare on translator xlsx — almost every patch hits an
  // existing row / cell and skips the linear-cost branch).
  function getOrCreateCell(xmlDoc, sheetData, excelRow, colIdx, rowIndex, cellIndex) {
    const colLetter = colLetterFromIndex(colIdx);
    const cellRef = colLetter + excelRow;
    const rowKey = String(excelRow);

    let row = rowIndex.get(rowKey);
    if (!row) {
      row = xmlDoc.createElementNS(SS_NS, 'row');
      row.setAttribute('r', rowKey);
      insertNodeInOrder(sheetData, row, childrenByTag(sheetData, SS_NS, 'row'),
        (a, b) => parseInt(a.getAttribute('r'), 10) - parseInt(b.getAttribute('r'), 10));
      rowIndex.set(rowKey, row);
      cellIndex.set(row, new Map());
    }

    const cells = cellIndex.get(row);
    let cell = cells.get(cellRef);
    if (!cell) {
      cell = xmlDoc.createElementNS(SS_NS, 'c');
      cell.setAttribute('r', cellRef);
      insertNodeInOrder(row, cell, childrenByTag(row, SS_NS, 'c'),
        (a, b) => colNumFromRef(a.getAttribute('r')) - colNumFromRef(b.getAttribute('r')));
      cells.set(cellRef, cell);
    }
    return cell;
  }

  // Generic ordered-insert: comparator receives (existing, candidate);
  // candidate goes before the first existing where comparator > 0 (i.e.
  // existing > candidate).
  function insertNodeInOrder(parent, candidate, existing, cmp) {
    for (const e of existing) {
      if (cmp(e, candidate) > 0) {
        parent.insertBefore(candidate, e);
        return;
      }
    }
    parent.appendChild(candidate);
  }

  // getElementsByTagNameNS is recursive — we want only direct children
  // of a specific parent. Filter manually.
  function childrenByTag(parent, ns, localName) {
    const out = [];
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && n.localName === localName && n.namespaceURI === ns) {
        out.push(n);
      }
    }
    return out;
  }

  function firstChildByTag(parent, ns, localName) {
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && n.localName === localName && n.namespaceURI === ns) {
        return n;
      }
    }
    return null;
  }

  // Throw if any merged-cell range covers a (row, col) we intend to patch.
  // Writing into a non-anchor cell of a merged range corrupts the file in
  // Excel ("found a problem with some content"). Caller catches → fallback.
  function detectMergeConflicts(xmlDoc, dataRowCount, patchCols) {
    const mergeEl = firstChildByTag(xmlDoc.documentElement, SS_NS, 'mergeCells');
    if (!mergeEl) return;
    const merges = childrenByTag(mergeEl, SS_NS, 'mergeCell');
    const lastRow = dataRowCount + 1;   // header + data
    for (const me of merges) {
      const ref = me.getAttribute('ref') || '';
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const c1 = colNumFromRef(m[1]);
      const r1 = parseInt(m[2], 10);
      const c2 = colNumFromRef(m[3]);
      const r2 = parseInt(m[4], 10);
      if (r2 < 1 || r1 > lastRow) continue;
      for (const colIdx of patchCols) {
        const c = colIdx + 1;
        if (c >= c1 && c <= c2) {
          throw new Error(
            `merged cell ${ref} overlaps patch column ${colLetterFromIndex(colIdx)}`
          );
        }
      }
    }
  }

  // Locate the first worksheet's path inside the zip. xlsx convention is
  // xl/worksheets/sheet1.xml but spec allows any name — read workbook.xml
  // + its rels to resolve. Falls back to the conventional path when rels
  // info is unavailable.
  async function findFirstSheetPath(zip) {
    const wbFile = zip.file('xl/workbook.xml');
    if (!wbFile) return 'xl/worksheets/sheet1.xml';
    let firstRid = null;
    try {
      const wbXml = await wbFile.async('string');
      const wbDoc = new DOMParser().parseFromString(wbXml, 'application/xml');
      const sheets = wbDoc.getElementsByTagNameNS(SS_NS, 'sheet');
      if (sheets.length) firstRid = sheets[0].getAttributeNS(REL_NS, 'id');
    } catch (_) { /* fall through */ }
    if (!firstRid) return 'xl/worksheets/sheet1.xml';
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    if (!relsFile) return 'xl/worksheets/sheet1.xml';
    try {
      const relsXml = await relsFile.async('string');
      const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
      const rels = relsDoc.getElementsByTagName('Relationship');
      for (let i = 0; i < rels.length; i++) {
        if (rels[i].getAttribute('Id') === firstRid) {
          const target = rels[i].getAttribute('Target') || '';
          // Target is relative to xl/ unless absolute (starts with /).
          if (target.startsWith('/')) return target.slice(1);
          return 'xl/' + target;
        }
      }
    } catch (_) { /* fall through */ }
    return 'xl/worksheets/sheet1.xml';
  }

  global.LocWriter = { writeLocFile };
})(typeof window !== 'undefined' ? window : globalThis);
