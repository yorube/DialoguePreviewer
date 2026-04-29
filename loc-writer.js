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

    /**
     * 主要入口：依 source.format 自動產生 CSV 字串或 xlsx Blob。
     * @returns {{ filename: string, mime: string, payload: string | Blob }}
     */
    function writeLocFile(source, mergedTranslations, opts) {
        opts = opts || {};
        if (!source || !source.headers || !source.rows) {
            throw new Error('source 必須含有 headers + rows');
        }
        const filledRows = applyTranslationsToRows(source, mergedTranslations);
        const baseName = opts.suggestedName || deriveOutputName(source.fileName, source.format);

        if (source.format === 'xlsx') {
            return {
                filename: baseName,
                mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                payload: buildXlsxBlob(source.headers, filledRows),
            };
        }
        // 預設走 CSV
        return {
            filename: baseName,
            mime: 'text/csv;charset=utf-8',
            payload: buildCsvText(source.headers, filledRows, source.csvHasBom),
        };
    }

    /**
     * 把翻譯填回 source.rows 的 localeCol，回傳新的 rows（不修改原物件）。
     */
    function applyTranslationsToRows(source, mergedTranslations) {
        const out = [];
        for (const row of source.rows) {
            const r = row.slice();
            const uid = (r[source.idCol] || '').toString().trim();
            if (uid && mergedTranslations.has(uid)) {
                r[source.localeCol] = String(mergedTranslations.get(uid));
            }
            // 沒譯文的格子保留上傳時的內容（可能是空，可能是譯者已填的舊版）
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

    global.LocWriter = {
        writeLocFile,
        // 給測試用
        _applyTranslationsToRows: applyTranslationsToRows,
        _buildCsvText: buildCsvText,
        _escapeCsvCell: escapeCsvCell,
    };
})(typeof window !== 'undefined' ? window : globalThis);
