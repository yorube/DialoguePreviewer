// ui-strings.js
// Visual UI-strings translation table.
//
// Format (matches "翻譯對照表 (3).xlsx" the team uses for in-game UI):
//   - Multi-sheet xlsx; each sheet is a category (流程調查物件 / 互動 / ...)
//   - Each sheet's columns are: Key | zh-TW | zh-CN | en-US | ja-JP | it-IT
//     | ru-RU | es-ES | fr-FR
//   - Rows whose Key starts with `//` are visual section dividers (e.g.
//     `//第一日`, `//第二日`); other-language cells are blank for those rows
//   - Cell content can be multi-line
//
// Page layout (rendered into #page-ui-strings):
//   - Top: Import .xlsx, Export .xlsx, status indicator
//   - Sheet tab strip — click to switch active sheet
//   - Filter box (filters by Key within the active sheet)
//   - Comparison table: every row of the active sheet, all 8 locale columns,
//     each cell click-to-edit. Source-row dividers render as full-width
//     section headers, not rows in the table.
//
// Persistence: the entire imported workbook (headers + rows) is held in
// localStorage under `mbu-ui-strings`. Edits mutate cells in place and
// re-save. Re-importing replaces the whole workbook. Export rebuilds the
// xlsx from the in-memory state, preserving sheet order, column order, and
// every original row (including dividers).

(function (global) {
  'use strict';

  const LS_KEY = 'mbu-ui-strings';
  const LS_EXPORT_KEY = 'mbu-ui-strings.exportState';

  const STATE = {
    // workbook: { fileName, sheets: [{ name, headers, rows: [[...]] }] }
    workbook: null,
    activeSheet: null,
    filter: '',
  };

  const $ = (id) => document.getElementById(id);

  function init() {
    const root = $('page-ui-strings');
    if (!root) return;
    root.innerHTML = renderShell();
    wireShell();
    loadFromLocalStorage();
    renderSheetTabs();
    renderTable();
    refreshExportStatus();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────────────

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.sheets) && parsed.sheets.length) {
        STATE.workbook = parsed;
        STATE.activeSheet = parsed.sheets[0].name;
      }
    } catch (e) {
      console.warn('[ui-strings] failed to load saved workbook', e);
    }
  }

  function saveToLocalStorage() {
    if (!STATE.workbook) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(STATE.workbook));
    } catch (e) {
      console.error('[ui-strings] save failed (likely quota):', e);
      alert('儲存到 localStorage 失敗（可能容量不夠）：' + e.message + '\n\n請按 💾 匯出 .xlsx 把目前狀態存到檔案。');
    }
  }

  function getExportState() {
    try { return JSON.parse(localStorage.getItem(LS_EXPORT_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function setExportState(s) {
    try { localStorage.setItem(LS_EXPORT_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function markEditDirty() {
    const s = getExportState();
    s.lastEditAt = new Date().toISOString();
    setExportState(s);
    refreshExportStatus();
  }
  function markExported() {
    const s = getExportState();
    s.lastExportAt = new Date().toISOString();
    setExportState(s);
    refreshExportStatus();
  }

  function refreshExportStatus() {
    const el = $('ui-strings-status');
    if (!el) return;
    if (!STATE.workbook) {
      el.textContent = '尚未匯入任何檔案';
      el.className = 'ui-strings-status muted';
      return;
    }
    const s = getExportState();
    if (!s.lastEditAt) {
      el.textContent = `已匯入：${STATE.workbook.fileName} (${STATE.workbook.sheets.length} sheet)`;
      el.className = 'ui-strings-status clean';
      return;
    }
    const dirty = !s.lastExportAt
      || new Date(s.lastEditAt).getTime() > new Date(s.lastExportAt).getTime();
    if (dirty) {
      el.textContent = s.lastExportAt
        ? `⚠️ 有未匯出的編輯（上次匯出 ${formatDate(s.lastExportAt)}，${formatAgo(Date.now() - new Date(s.lastExportAt).getTime())} 前）`
        : '⚠️ 有未匯出的編輯，還沒匯出過';
      el.className = 'ui-strings-status dirty';
    } else {
      el.textContent = `✓ 已存檔 ${formatDate(s.lastExportAt)}（${formatAgo(Date.now() - new Date(s.lastExportAt).getTime())} 前）`;
      el.className = 'ui-strings-status clean';
    }
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}/${mo}/${da}`;
  }

  function formatAgo(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  // Refresh "X minutes ago" copy on a slow timer.
  setInterval(() => {
    try { refreshExportStatus(); } catch (e) {}
  }, 30 * 1000);

  // ─────────────────────────────────────────────────────────────────────
  // Shell: top toolbar, sheet tabs, filter, table container
  // ─────────────────────────────────────────────────────────────────────

  function renderShell() {
    return `
    <header class="topbar topbar-ui-strings">
     <span class="brand">UI Strings</span>
     <label class="ctrl ctrl-import">
      <span>📥 匯入 .xlsx</span>
      <input type="file" id="ui-strings-import" accept=".xlsx,.xls">
     </label>
     <button id="ui-strings-export" class="ctrl-btn">💾 匯出 .xlsx</button>
     <button id="ui-strings-reset" class="ctrl-btn danger">🗑 清空</button>
     <span id="ui-strings-status" class="ui-strings-status muted">尚未匯入任何檔案</span>
    </header>
    <div id="ui-strings-sheet-tabs" class="ui-strings-sheet-tabs"></div>
    <div class="ui-strings-toolbar">
     <input id="ui-strings-filter" type="search" placeholder="篩選 Key…" class="ui-strings-filter">
     <span id="ui-strings-counter" class="ui-strings-counter"></span>
    </div>
    <div id="ui-strings-view" class="ui-strings-view"></div>
    `;
  }

  function wireShell() {
    $('ui-strings-import').addEventListener('change', onImport);
    $('ui-strings-export').addEventListener('click', onExport);
    $('ui-strings-reset').addEventListener('click', onReset);
    $('ui-strings-filter').addEventListener('input', (e) => {
      STATE.filter = e.target.value.trim().toLowerCase();
      renderTable();
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Import / Export
  // ─────────────────────────────────────────────────────────────────────

  async function onImport(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (typeof XLSX === 'undefined') {
      alert('xlsx parser not loaded');
      return;
    }
    const buf = await file.arrayBuffer();
    let wb;
    try {
      wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    } catch (e) {
      alert('解析 .xlsx 失敗：' + e.message);
      return;
    }
    const sheets = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
      if (!aoa.length) continue;
      const headers = (aoa[0] || []).map(h => String(h || ''));
      const rows = aoa.slice(1).map(r => {
        // Pad / trim each row to header length so cell access by index is safe.
        const out = [];
        for (let i = 0; i < headers.length; i++) {
          out.push(r[i] != null ? String(r[i]) : '');
        }
        return out;
      });
      sheets.push({ name, headers, rows });
    }
    if (!sheets.length) {
      alert('xlsx 內沒有可讀取的分頁。');
      return;
    }
    STATE.workbook = { fileName: file.name, sheets };
    STATE.activeSheet = sheets[0].name;
    STATE.filter = '';
    const filterEl = $('ui-strings-filter');
    if (filterEl) filterEl.value = '';
    saveToLocalStorage();
    markExported();   // imported state == file state, so we're clean
    renderSheetTabs();
    renderTable();
    refreshExportStatus();
    alert(`已匯入 ${file.name}\n  ${sheets.length} 個分頁\n  ${sheets.reduce((n, s) => n + s.rows.length, 0)} 列`);
  }

  function onExport() {
    if (!STATE.workbook || !STATE.workbook.sheets.length) {
      alert('沒有可匯出的內容，請先匯入一份 .xlsx。');
      return;
    }
    if (typeof XLSX === 'undefined') {
      alert('xlsx writer not loaded');
      return;
    }
    const wb = XLSX.utils.book_new();
    for (const sheet of STATE.workbook.sheets) {
      const aoa = [sheet.headers, ...sheet.rows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Sanitize sheet name to xlsx limits (≤31 chars, no [/\?*:]).
      const safe = String(sheet.name).replace(/[\[\]\/\\?*:]/g, '_').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, safe);
    }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const orig = STATE.workbook.fileName || 'ui-strings.xlsx';
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    a.download = orig.replace(/\.xlsx?$/i, '') + `_${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markExported();
  }

  function onReset() {
    if (!STATE.workbook) {
      alert('目前沒有資料。');
      return;
    }
    const ok = confirm('確定要清空當前 UI 字串資料嗎？\n\n本地的所有編輯會全部丟掉，需要重新匯入 .xlsx。\n（建議先按 💾 匯出 .xlsx 留底）');
    if (!ok) return;
    STATE.workbook = null;
    STATE.activeSheet = null;
    STATE.filter = '';
    const filterEl = $('ui-strings-filter');
    if (filterEl) filterEl.value = '';
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    try { localStorage.removeItem(LS_EXPORT_KEY); } catch (e) {}
    renderSheetTabs();
    renderTable();
    refreshExportStatus();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Sheet tab strip
  // ─────────────────────────────────────────────────────────────────────

  function renderSheetTabs() {
    const tabs = $('ui-strings-sheet-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    if (!STATE.workbook) {
      tabs.classList.add('empty');
      return;
    }
    tabs.classList.remove('empty');
    for (const sheet of STATE.workbook.sheets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ui-strings-sheet-tab';
      if (sheet.name === STATE.activeSheet) btn.classList.add('active');
      btn.textContent = sheet.name;
      btn.title = `${sheet.rows.length} rows`;
      btn.addEventListener('click', () => {
        if (STATE.activeSheet === sheet.name) return;
        STATE.activeSheet = sheet.name;
        STATE.filter = '';
        const filterEl = $('ui-strings-filter');
        if (filterEl) filterEl.value = '';
        renderSheetTabs();
        renderTable();
      });
      tabs.appendChild(btn);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Comparison table
  // ─────────────────────────────────────────────────────────────────────

  function renderTable() {
    const view = $('ui-strings-view');
    const counter = $('ui-strings-counter');
    if (!view) return;
    view.innerHTML = '';
    if (!STATE.workbook) {
      view.innerHTML = '<div class="ui-strings-empty">沒有資料。請按上方 📥 匯入 .xlsx。</div>';
      if (counter) counter.textContent = '';
      return;
    }
    const sheet = STATE.workbook.sheets.find(s => s.name === STATE.activeSheet);
    if (!sheet) {
      view.innerHTML = '<div class="ui-strings-empty">找不到分頁。</div>';
      if (counter) counter.textContent = '';
      return;
    }

    const filter = STATE.filter;

    const tableWrap = document.createElement('div');
    tableWrap.className = 'ui-strings-table-wrap';
    const table = document.createElement('table');
    table.className = 'ui-strings-table';

    // ── Header
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    const idxTh = document.createElement('th');
    idxTh.className = 'ui-col-idx';
    idxTh.textContent = '#';
    trh.appendChild(idxTh);
    for (const h of sheet.headers) {
      const th = document.createElement('th');
      th.className = 'ui-col-' + cssEscape(h);
      if (h === 'Key') th.classList.add('ui-col-key');
      th.textContent = h;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    // ── Body
    const tbody = document.createElement('tbody');
    let visibleCount = 0;
    sheet.rows.forEach((row, rIdx) => {
      const key = (row[0] || '').toString();
      // Section divider rows: render as a single full-width header row.
      if (key.startsWith('//')) {
        if (filter && !key.toLowerCase().includes(filter)) return;
        const tr = document.createElement('tr');
        tr.className = 'ui-strings-divider';
        const td = document.createElement('td');
        td.colSpan = sheet.headers.length + 1;
        td.textContent = key.replace(/^\/+/, '').trim();
        tr.appendChild(td);
        tbody.appendChild(tr);
        visibleCount++;
        return;
      }
      // Non-divider rows: filter by Key.
      if (filter && !key.toLowerCase().includes(filter)) return;
      const tr = document.createElement('tr');
      tr.className = 'ui-strings-row';

      const idxTd = document.createElement('td');
      idxTd.className = 'ui-col-idx';
      idxTd.textContent = String(rIdx + 1);
      tr.appendChild(idxTd);

      for (let c = 0; c < sheet.headers.length; c++) {
        const td = document.createElement('td');
        const text = row[c] != null ? String(row[c]) : '';
        td.dataset.row = String(rIdx);
        td.dataset.col = String(c);
        if (sheet.headers[c] === 'Key') {
          td.classList.add('ui-cell-key');
          td.textContent = text;
        } else {
          td.classList.add('ui-cell-text');
          if (!text) td.classList.add('ui-cell-empty');
          td.textContent = text;
          td.addEventListener('click', () => openCellEditor(td, sheet, rIdx, c));
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
      visibleCount++;
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    view.appendChild(tableWrap);

    if (counter) {
      const total = sheet.rows.length;
      counter.textContent = filter
        ? `顯示 ${visibleCount} / ${total} 列`
        : `共 ${total} 列`;
    }
  }

  function openCellEditor(td, sheet, rIdx, cIdx) {
    if (td.querySelector('.ui-cell-editor')) return;
    const original = sheet.rows[rIdx][cIdx] != null ? String(sheet.rows[rIdx][cIdx]) : '';
    const prevHtml = td.innerHTML;
    const prevClass = td.className;

    const editor = document.createElement('div');
    editor.className = 'ui-cell-editor';
    const ta = document.createElement('textarea');
    ta.value = original;
    ta.rows = Math.min(10, Math.max(2, original.split('\n').length + 1));
    const actions = document.createElement('div');
    actions.className = 'actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'confirm';
    ok.textContent = '✓';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cancel';
    cancel.textContent = '✗';
    actions.appendChild(ok);
    actions.appendChild(cancel);
    editor.appendChild(ta);
    editor.appendChild(actions);

    td.innerHTML = '';
    td.appendChild(editor);
    ta.focus();
    ta.select();

    const close = () => {
      td.className = prevClass;
      td.innerHTML = prevHtml;
    };
    cancel.addEventListener('click', (ev) => { ev.stopPropagation(); close(); });
    ok.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const newText = ta.value;
      if (newText !== original) {
        sheet.rows[rIdx][cIdx] = newText;
        saveToLocalStorage();
        markEditDirty();
      }
      // Re-render only this cell to avoid losing scroll position.
      td.className = prevClass.replace('ui-cell-empty', '').trim();
      if (!newText) td.classList.add('ui-cell-empty');
      td.innerHTML = '';
      td.textContent = newText;
    });
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); ok.click(); }
    });
    editor.addEventListener('click', (ev) => ev.stopPropagation());
    editor.addEventListener('mousedown', (ev) => ev.stopPropagation());
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  // Strip CSS-unfriendly chars from a header name so we can use it in a class.
  function cssEscape(s) {
    return String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  global.UIStrings = {
    init,
    // For the page-tabs switcher in ui.js — it can call .show() to ensure
    // any deferred setup has run before the tab becomes visible.
    show() { /* render functions are idempotent and read STATE; nothing extra here */ },
  };
})(typeof window !== 'undefined' ? window : globalThis);
