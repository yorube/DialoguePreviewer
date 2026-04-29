// loc-parser.js
// 把翻譯人員填回來的檔案（.csv 或 .xlsx）解析成 { uid → translation } 的 Map。
//
// 支援格式：
//   v2 LocKit CSV (6 欄，含 BOM)：
//     Type, Gender, CharacterName, en-US, {locale}, ID
//   翻譯人員精簡版 xlsx (5 欄，無 Gender)：
//     Type, CharacterName, en-US, {locale}, ID
//   未來可能的 8 欄版（v2 加上 FileName/NodeTitle）：
//     Type, Gender, CharacterName, en-US, {locale}, ID, FileName, NodeTitle
//
// 解析時不依賴欄位順序，靠 header 名稱定位 ID 跟翻譯欄。
// 全域 export：window.LocParser.{ parseFile, parseCsv, parseXlsx }
//
// 依賴：xlsx.full.min.js 必須先載入（用於 xlsx 解析）

(function (global) {
    'use strict';

    /**
     * 通用入口：自動依副檔名選擇 parser。
     * @param {File} file - 從 <input type="file"> 拿到的 File 物件
     * @param {string} expectedLocale - e.g. 'fr-FR' / 'ru-RU'。用於選翻譯欄。
     * @returns {Promise<ParsedResult>}
     *
     * ParsedResult = {
     *   translations: Map<UID, text>,
     *   stats: { sourceFile, locale, totalRows, withTranslation, missingUid, dupUids, headerColumns, format, csvHasBom },
     *   warnings: string[],
     *   source: {                       // 給「下載同格式譯文」用
     *     format: 'csv' | 'xlsx',
     *     fileName: string,
     *     headers: string[],
     *     rows: string[][],             // 不含 header；對齊 headers 的長度
     *     idCol: number,
     *     localeCol: number,
     *     csvHasBom: boolean,           // 只在 csv 時有意義
     *   }
     * }
     */
    async function parseFile(file, expectedLocale) {
        if (!file) throw new Error('file is required');
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.csv')) {
            const text = await file.text();
            return parseCsv(text, expectedLocale, { fileName: file.name });
        }
        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
            const buf = await file.arrayBuffer();
            return parseXlsx(buf, expectedLocale, { fileName: file.name });
        }
        throw new Error(`不支援的副檔名：${file.name}（僅支援 .csv / .xlsx / .xls）`);
    }

    /**
     * 解析 CSV 字串。處理 RFC 4180（雙引號跳脫、引號內換行）。
     */
    function parseCsv(text, expectedLocale, opts) {
        opts = opts || {};
        if (typeof text !== 'string') throw new Error('text must be string');

        // 去 BOM；記住有沒有，下載時要寫回去
        let hadBom = false;
        if (text.charCodeAt(0) === 0xFEFF) {
            text = text.slice(1);
            hadBom = true;
        }

        const rows = parseCsvText(text);
        if (rows.length === 0) {
            throw new Error('CSV 是空的');
        }
        return rowsToTranslations(rows, expectedLocale, Object.assign({}, opts, { format: 'csv', csvHasBom: hadBom }));
    }

    /**
     * 解析 .xlsx ArrayBuffer。需要全域 XLSX 物件（SheetJS）。
     */
    function parseXlsx(arrayBuffer, expectedLocale, opts) {
        opts = opts || {};
        if (typeof XLSX === 'undefined') {
            throw new Error('SheetJS (XLSX) 未載入；請確認 xlsx.full.min.js 有先 include');
        }
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        if (!wb.SheetNames.length) throw new Error('xlsx 沒有任何工作表');
        const ws = wb.Sheets[wb.SheetNames[0]];

        // SheetJS sheet_to_json with header:1 → array of arrays
        const rows = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            blankrows: false,
            defval: '',
            raw: true,
        });
        if (rows.length === 0) throw new Error('xlsx 第一張工作表是空的');
        // sheet_to_json 已經回 string[][]，但 cells 可能是 number/boolean，統一成 string
        const normalized = rows.map(r => r.map(c => c == null ? '' : String(c)));
        return rowsToTranslations(normalized, expectedLocale, Object.assign({}, opts, { format: 'xlsx', csvHasBom: false }));
    }

    /**
     * 從 string[][] 抽出翻譯。第一列是 header，靠名稱定位欄位。
     */
    function rowsToTranslations(rows, expectedLocale, opts) {
        const headerRow = rows[0].map(s => String(s || '').trim());
        const cols = identifyColumns(headerRow, expectedLocale);

        const translations = new Map();
        const warnings = [];
        let totalRows = 0;
        let withTranslation = 0;
        let dupUids = 0;
        let missingUid = 0;
        const sourceFile = opts.fileName || '(unknown)';

        // 把所有 data rows 保留下來，方便之後 round-trip 寫回同格式檔
        const dataRows = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            // 全空行跳過（xlsx 有時會夾空 row）
            if (row.every(c => !c || String(c).trim() === '')) continue;

            // 標準化：對齊 header 長度（短的補空、長的保留）
            const normalized = row.length === headerRow.length
                ? row.slice()
                : (() => {
                    const r = row.slice(0, headerRow.length);
                    while (r.length < headerRow.length) r.push('');
                    return r;
                })();
            dataRows.push(normalized);

            totalRows++;
            const uid  = (normalized[cols.idCol]     || '').toString().trim();
            const text = (normalized[cols.localeCol] || '').toString();

            if (!uid) {
                missingUid++;
                if (warnings.length < 20) {
                    warnings.push(`第 ${i + 1} 行沒有 UID，跳過`);
                }
                continue;
            }
            if (text === '') continue;

            if (translations.has(uid)) {
                dupUids++;
                // 後者覆蓋前者（與 v2 對齊）
            }
            translations.set(uid, text);
            withTranslation++;
        }

        if (dupUids > 0) {
            warnings.push(`偵測到 ${dupUids} 個重複 UID，後出現的會覆蓋先前的`);
        }

        return {
            translations,
            stats: {
                sourceFile,
                locale: cols.detectedLocale,
                totalRows,
                withTranslation,
                missingUid,
                dupUids,
                headerColumns: headerRow,
                format: opts.format || 'csv',
                csvHasBom: !!opts.csvHasBom,
            },
            warnings,
            source: {
                format:    opts.format || 'csv',
                fileName:  sourceFile,
                headers:   headerRow,
                rows:      dataRows,
                idCol:     cols.idCol,
                localeCol: cols.localeCol,
                csvHasBom: !!opts.csvHasBom,
            },
        };
    }

    /**
     * 從 header 列找出 ID 欄、翻譯欄、en-US 欄等位置。
     * 翻譯欄優先：完全等於 expectedLocale。其次：任何看起來像 locale code 但不是 en-US 的欄。
     */
    function identifyColumns(headerRow, expectedLocale) {
        // 把 header 統一成小寫 + 底線→連字號（LocKit 偶爾出現 "ru_RU" 拼錯的格子）
        const norm = headerRow.map(h => h.toLowerCase().replace(/_/g, '-'));
        const localeCodeRe = /^[a-z]{2}-[a-z]{2}$/;

        // ID 欄
        let idCol = norm.indexOf('id');
        if (idCol === -1) {
            idCol = norm.indexOf('uid');
        }
        if (idCol === -1) {
            // fallback 到最後一個欄位（v2 LocKit CSV / 譯者 xlsx 都把 ID 放最後或倒數）
            idCol = headerRow.length - 1;
        }

        // 翻譯欄
        let localeCol = -1;
        let detectedLocale = '';
        if (expectedLocale) {
            const exp = expectedLocale.toLowerCase().replace(/_/g, '-');
            localeCol = norm.indexOf(exp);
            if (localeCol !== -1) detectedLocale = expectedLocale;
        }
        if (localeCol === -1) {
            // 找第一個非 en-US 的 locale-code 欄位
            for (let i = 0; i < norm.length; i++) {
                const h = norm[i];
                if (localeCodeRe.test(h) && h !== 'en-us') {
                    localeCol = i;
                    detectedLocale = headerRow[i].replace(/_/g, '-');
                    break;
                }
            }
        }
        if (localeCol === -1) {
            throw new Error(
                `找不到翻譯欄位。Header 必須含有 locale code（例如 fr-FR / ru-RU）。\n` +
                `當前 header: [${headerRow.join(', ')}]`);
        }
        if (localeCol === idCol) {
            throw new Error(`翻譯欄與 ID 欄重疊，header 結構異常：[${headerRow.join(', ')}]`);
        }

        return {
            idCol,
            localeCol,
            detectedLocale,
        };
    }

    /**
     * RFC 4180 風格的 CSV parser。處理：
     *   - 雙引號 escape ("")
     *   - 引號內可以包含 \r\n 跟逗號
     *   - 自動偵測 LF / CRLF / CR 行尾
     */
    function parseCsvText(text) {
        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;
        let i = 0;
        const len = text.length;
        while (i < len) {
            const c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
                    inQuotes = false; i++; continue;
                }
                cell += c; i++;
                continue;
            }
            // not in quotes
            if (c === '"') { inQuotes = true; i++; continue; }
            if (c === ',') { row.push(cell); cell = ''; i++; continue; }
            if (c === '\r') {
                row.push(cell); rows.push(row); row = []; cell = '';
                if (text[i + 1] === '\n') i += 2; else i++;
                continue;
            }
            if (c === '\n') {
                row.push(cell); rows.push(row); row = []; cell = '';
                i++; continue;
            }
            cell += c; i++;
        }
        // 最後一格 / 最後一行
        if (cell.length > 0 || row.length > 0) {
            row.push(cell);
            rows.push(row);
        }
        return rows;
    }

    global.LocParser = {
        parseFile,
        parseCsv,
        parseXlsx,
        // export for testing
        _parseCsvText: parseCsvText,
        _identifyColumns: identifyColumns,
    };
})(typeof window !== 'undefined' ? window : globalThis);
