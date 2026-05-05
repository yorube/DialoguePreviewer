// translation-state.js
// 翻譯狀態管理：把譯者的「上傳 + 在站上編輯」兩個來源合併成一份 UID → text Map，
// 自動 localStorage 持久化，並追蹤每筆來源（upload 還是 inline-edit）。
// 額外維護一條人工 review status 軌（needs-review / approved），跟 baseline /
// overrides 平行,不影響顯示文字,只是 metadata。
//
// 全域 export：window.TranslationState
//
// 設計原則：
//   - inline edit 優先：同一個 UID 同時有 upload 與 inline，inline 蓋掉 upload
//   - upload 重新覆寫時提醒（會吃掉現有的 upload baseline，但保留 inline edits）
//   - 每筆操作即時 persist 到 localStorage（key = yp.translation.{locale}）
//   - review status 跟 overrides 同調：upload 預設清掉,preserveOverrides=true 時 preserve

(function (global) {
    'use strict';

    // Single namespace `yp.*` shared with ui.js's per-feature keys
    // (yp.lang / yp.notes / yp.layout / yp.activePage / yp.exportState) and
    // ui-strings.js (yp.uiStrings / yp.uiStrings.exportState).
    const STORAGE_PREFIX = 'yp.translation.';
    // Bump on schema break. Old payloads (different prefix or different v)
    // are ignored on load — no migration code, by design.
    const STORAGE_VERSION = 4;

    // Whitelist of allowed manual status values. Anything else is treated as
    // "no status" — defends against bad CSV imports without crashing.
    const VALID_STATUSES = new Set(['needs-review', 'approved']);

    /**
     * 每個 locale 一個 State 實例。
     */
    function createState(locale) {
        if (!locale) throw new Error('locale required');
        const storageKey = STORAGE_PREFIX + locale;

        // baseline     = upload 過來的 UID→text，read-only 概念
        // overrides    = 站內 inline edit 的 UID→text，覆蓋 baseline
        // manualStatus = 譯者人工標記的 review 狀態（needs-review / approved）
        // sourceMeta   = upload 時的檔名 / 時間 / 統計
        // source       = 原檔結構（headers + rows + idCol/localeCol/format/csvHasBom）
        const state = {
            locale,
            baseline: new Map(),        // Map<uid, text>
            overrides: new Map(),       // Map<uid, text>
            manualStatus: new Map(),    // Map<uid, 'needs-review' | 'approved'>
            sourceMeta: null,           // {fileName, importedAt, totalRows, withTranslation}
            source: null,               // {format, fileName, headers, rows, idCol, localeCol, csvHasBom}
        };

        load();

        // ----- Persistence -----

        // Persist only what's load-bearing: the translator's work (baseline +
        // overrides + manualStatus) and lightweight metadata. state.source
        // (the raw xlsx / csv rows) is intentionally NOT persisted — it can
        // run several MB and was the sole cause of localStorage quota
        // failures. After a refresh, getSource() returns null and
        // onDownloadLocFile falls back to buildSyntheticSource() (rebuilds
        // the LocKit CSV from the en-US AST). The trade-off: byte-for-byte
        // identical re-export across refresh is lost; data integrity is
        // unconditional.
        // Returns: 'ok' | 'failed'.
        function persist() {
            const payload = {
                v: STORAGE_VERSION,
                locale: state.locale,
                baseline: Array.from(state.baseline.entries()),
                overrides: Array.from(state.overrides.entries()),
                manualStatus: Array.from(state.manualStatus.entries()),
                sourceMeta: state.sourceMeta,
            };
            try {
                localStorage.setItem(storageKey, JSON.stringify(payload));
                return 'ok';
            } catch (e) {
                console.error('[TranslationState] persist failed:', e.message);
                return 'failed';
            }
        }

        function load() {
            try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) return;
                const obj = JSON.parse(raw);
                if (!obj || obj.v !== STORAGE_VERSION) return;
                if (Array.isArray(obj.baseline)) state.baseline = new Map(obj.baseline);
                if (Array.isArray(obj.overrides)) state.overrides = new Map(obj.overrides);
                if (Array.isArray(obj.manualStatus)) {
                    state.manualStatus = new Map(
                        obj.manualStatus.filter(([, v]) => VALID_STATUSES.has(v))
                    );
                }
                if (obj.sourceMeta) state.sourceMeta = obj.sourceMeta;
            } catch (e) {
                console.warn('[TranslationState] load failed:', e);
            }
        }

        // ----- Public API -----

        /**
         * 取一個 UID 目前的翻譯（合併 baseline + overrides，後者優先）。
         */
        function get(uid) {
            if (state.overrides.has(uid)) return state.overrides.get(uid);
            return state.baseline.get(uid);
        }

        /**
         * 取一個 UID 的來源類型：
         *   'override' = 站內編輯過
         *   'baseline' = 上傳的譯文
         *   'none'     = 還沒翻
         */
        function source(uid) {
            if (state.overrides.has(uid)) return 'override';
            if (state.baseline.has(uid)) return 'baseline';
            return 'none';
        }

        /**
         * 取一個 UID 的人工 review 狀態（'needs-review' / 'approved' / null）。
         */
        function getStatus(uid) {
            return state.manualStatus.get(uid) || null;
        }

        /**
         * inline edit：寫到 overrides。空字串 = 清掉 override（回退到 baseline）。
         * 不影響 manualStatus — 譯者改字不代表狀態變動，仍維持原 review 狀態。
         */
        function setOverride(uid, text) {
            if (text == null || text === '') {
                state.overrides.delete(uid);
            } else {
                state.overrides.set(uid, text);
            }
            return persist();
        }

        /**
         * 設定人工 review 狀態。null / '' / unknown value = 清掉狀態。
         */
        function setStatus(uid, status) {
            if (!status || !VALID_STATUSES.has(status)) {
                state.manualStatus.delete(uid);
            } else {
                state.manualStatus.set(uid, status);
            }
            return persist();
        }

        /**
         * 一次設多筆 status,只 persist 一次。兩種呼叫方式:
         *   bulkSetStatus(['u1', 'u2'], 'approved')         — 給多 uid 設同一個狀態
         *   bulkSetStatus(['u1', 'u2'], null)               — 一次清掉多 uid 的狀態
         *   bulkSetStatus(new Map([['u1','approved'], ['u2','needs-review']]))
         *                                                    — Map 裡每筆獨立 status (給 import 用)
         * Map 裡值若是 null / unknown,等於清掉該 uid。
         */
        function bulkSetStatus(uidsOrMap, status) {
            if (uidsOrMap instanceof Map) {
                for (const [uid, st] of uidsOrMap) {
                    if (st && VALID_STATUSES.has(st)) state.manualStatus.set(uid, st);
                    else state.manualStatus.delete(uid);
                }
                return persist();
            }
            if (!uidsOrMap || typeof uidsOrMap[Symbol.iterator] !== 'function') return persist();
            const valid = status && VALID_STATUSES.has(status) ? status : null;
            for (const uid of uidsOrMap) {
                if (valid) state.manualStatus.set(uid, valid);
                else state.manualStatus.delete(uid);
            }
            return persist();
        }

        /**
         * 一次性把整個 baseline 換掉（譯者上傳新檔）。
         * 預設語意：上傳代表譯者最新進度，**會清掉站內編輯 (overrides) 與 manualStatus**，
         * 整個語言以新檔為準（review status 也以新檔內 ReviewStatus 欄為準）。
         * 若刻意想保留站內編輯與狀態，傳 options.preserveOverrides = true。
         * source 帶過來會被存著，給「下載同格式」用。
         */
        function replaceBaseline(translations, sourceMeta, options) {
            options = options || {};
            state.baseline = new Map(translations);
            state.sourceMeta = sourceMeta || null;
            if (options.source) state.source = options.source;
            if (!options.preserveOverrides) {
                state.overrides = new Map();
                state.manualStatus = new Map();
            }
            return persist();
        }

        function getSource() { return state.source; }

        /**
         * 完全清空（debug / 重新開始）。
         */
        function reset() {
            state.baseline = new Map();
            state.overrides = new Map();
            state.manualStatus = new Map();
            state.sourceMeta = null;
            try { localStorage.removeItem(storageKey); } catch (_) {}
        }

        /**
         * 對所有 UID 算合併後的 Map<uid, text>。
         * 給 yarn-converter.applyTranslations 用。
         */
        function buildMergedMap() {
            const merged = new Map(state.baseline);
            for (const [uid, text] of state.overrides) merged.set(uid, text);
            return merged;
        }

        /**
         * 直接拿到 manualStatus 的 read-only view（給 export pipeline 寫進 CSV）。
         */
        function getStatusMap() {
            return new Map(state.manualStatus);
        }

        /**
         * 統計：給 UI 顯示「上傳 N 條 / 自編輯 M 條 / 待校 K 條 / 已核可 L 條」之類。
         */
        function stats() {
            // baseline 中有多少 UID 已經被 override 蓋掉
            let overriddenFromBaseline = 0;
            for (const k of state.overrides.keys()) {
                if (state.baseline.has(k)) overriddenFromBaseline++;
            }
            let needsReviewCount = 0;
            let approvedCount = 0;
            for (const v of state.manualStatus.values()) {
                if (v === 'needs-review') needsReviewCount++;
                else if (v === 'approved') approvedCount++;
            }
            return {
                baselineCount: state.baseline.size,
                overrideCount: state.overrides.size,
                overriddenFromBaseline,
                onlyOverrideCount: state.overrides.size - overriddenFromBaseline,
                needsReviewCount,
                approvedCount,
                manualStatusCount: state.manualStatus.size,
                sourceMeta: state.sourceMeta,
                locale: state.locale,
            };
        }

        return {
            locale,
            get,
            source,
            getStatus,
            setOverride,
            setStatus,
            bulkSetStatus,
            replaceBaseline,
            reset,
            buildMergedMap,
            getStatusMap,
            stats,
            getSource,
        };
    }

    global.TranslationState = {
        createState,
        VALID_STATUSES: Array.from(VALID_STATUSES),
    };
})(typeof window !== 'undefined' ? window : globalThis);
