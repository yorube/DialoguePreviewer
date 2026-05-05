// loc-writer.js
// 把譯者上傳的檔案結構（headers + rows + idCol/localeCol）拿出來，
// 把翻譯欄填上「baseline + overrides 合併後的最新譯文」，原檔的其他欄位（Type / Gender /
// CharacterName / en-US / FileName / NodeTitle…）一律保留。
//
// 目的：讓譯者「下載譯文」拿回的就是他原本給的 .csv / .xlsx 同格式，
// 翻譯流程不需要碰到 Unity-side 的 JSON。
//
// 依賴：XLSX (SheetJS) for xlsx 寫出。CSV 是純字串組裝。

(function (global) {
  'use strict';

  // 'ReviewStatus' header 名稱（case-insensitive 比對）
  const REVIEW_STATUS_HEADER_NORM = 'reviewstatus';

  /**
  * 主要入口：依 source.format 自動產生 CSV 字串或 xlsx Blob。
  * @param {object} source - LocParser.parseFile 回傳的 source 結構
  * @param {Map<uid, text>} mergedTranslations - 要寫進譯文欄的內容
  * @param {object} [opts]
  * @param {Map<uid, status>} [opts.statuses] - manualStatus map;會寫進 ReviewStatus 欄
  *                                              (找不到欄時自動 append)
  * @returns {{ filename: string, mime: string, payload: string | Blob }}
  */
  function writeLocFile(source, mergedTranslations, opts) {
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

    const filledRows = applyTranslationsToRows(workingSource, mergedTranslations, statuses);
    const baseName = opts.suggestedName || deriveOutputName(workingSource.fileName, workingSource.format);

    if (workingSource.format === 'xlsx') {
      return {
        filename: baseName,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        payload: buildXlsxBlob(workingSource.headers, filledRows),
      };
    }
    // 預設走 CSV
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

  // ---- xlsx ----

  function buildXlsxBlob(headers, rows) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) 未載入；無法產生 xlsx');
    }
    const aoa = [headers].concat(rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Translations');
    // 用 array 輸出，SheetJS 會回 Uint8Array
    const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([arr], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  global.LocWriter = { writeLocFile };
})(typeof window !== 'undefined' ? window : globalThis);
