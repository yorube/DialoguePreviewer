// ui-patch.js — non-invasive enhancements layered on top of ui.js.
// Loaded AFTER ui.js. Adds:
//   1. Active-node highlight in the sidebar (#node-list .is-active).
//   2. Translation status dots on each node entry (when a translation file is loaded).
//   3. Inline "$var: from → to" badges on transcript rows when variables mutate.
//   4. Click-the-current-node-title to scroll the source view into view.
//
// Everything degrades gracefully if hooks/elements are missing.

(function () {
  'use strict';

  // ── 1. Active-node highlight ────────────────────────────────────────────
  // Watch the dialogue header h1; whenever its text changes, mark the matching
  // <li> in #node-list as active. We use a MutationObserver so we don't have
  // to monkey-patch any of ui.js's functions.
  const currentEl = document.getElementById('current-node');
  const nodeListEl = document.getElementById('node-list');

  function syncActiveNode() {
    if (!currentEl || !nodeListEl) return;
    const title = currentEl.textContent.trim();
    nodeListEl.querySelectorAll('li').forEach(li => {
      const t = li.querySelector('.node-title')?.textContent;
      li.classList.toggle('is-active', t === title);
    });
    // Scroll the active item into view if it isn't.
    const active = nodeListEl.querySelector('li.is-active');
    if (active) {
      const r = active.getBoundingClientRect();
      const pr = nodeListEl.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) {
        active.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  if (currentEl) {
    new MutationObserver(syncActiveNode).observe(currentEl, {
      childList: true, characterData: true, subtree: true,
    });
  }
  // Re-sync when the node list itself rebuilds (filter, locale switch).
  if (nodeListEl) {
    new MutationObserver(() => syncActiveNode())
      .observe(nodeListEl, { childList: true });
  }

  // ── 2. Inline var-change badges ─────────────────────────────────────────
  // Hook into runtime.onVarChange. The runtime handlers are reset on every
  // YarnRuntime() construction (in ui.js's startAt()), so we re-hook each
  // time the dialogue header changes (which always coincides with a new
  // runtime instance).
  let lastVarSnapshot = null;

  function hookVarChange() {
    // ui.js stores the runtime in its IIFE state; we read from window via
    // the onVarChange handler chain — but we don't have direct access.
    // Strategy: poll once per microtask after a header change, find the
    // most recently appended .row-line and append a badge if its data
    // differs from our snapshot.
    // Simpler & safer: tap window.YarnRuntime prototype's _doSet path by
    // wrapping advance/choose at the DOM level — see below.
  }

  // We instead piggyback on the existing var panel's mutations. When a
  // .var-row's input value changes (programmatically by ui.js after a
  // runtime set), we know that variable just mutated and we can attach a
  // badge to the most recent .row-line in the transcript.
  const varsEl = document.getElementById('vars');
  const transcriptEl = document.getElementById('transcript');

  function snapshotVars() {
    const snap = {};
    if (!varsEl) return snap;
    varsEl.querySelectorAll('.var-row').forEach(row => {
      const name = row.dataset.varName;
      if (!name) return;
      const input = row.querySelector('.var-edit');
      if (!input) return;
      const val = input.type === 'checkbox' ? input.checked : input.value;
      snap[name] = val;
    });
    return snap;
  }

  function annotateVarTypes() {
    if (!varsEl) return;
    varsEl.querySelectorAll('.var-row').forEach(row => {
      const input = row.querySelector('.var-edit');
      if (!input) return;
      let type = 'string';
      if (input.classList.contains('var-edit-bool')) type = 'boolean';
      else if (input.classList.contains('var-edit-number')) type = 'number';
      row.dataset.type = type;
    });
  }

  function flashVarRow(name) {
    if (!varsEl) return;
    const row = varsEl.querySelector(`.var-row[data-var-name="${CSS.escape(name)}"]`);
    if (!row) return;
    row.classList.remove('flash');
    // Force reflow so the animation re-triggers.
    void row.offsetWidth;
    row.classList.add('flash');
  }

  function appendBadgeToLastRow(name, from, to) {
    if (!transcriptEl) return;
    // Find the most recently appended .row-line OR the .row-jump (since
    // <<set>> often happens at node entry before the first line).
    const rows = transcriptEl.querySelectorAll('.row-line, .row-jump, .row-chose');
    const target = rows[rows.length - 1];
    if (!target) return;
    const badge = document.createElement('span');
    badge.className = 'var-change-badge';
    const fromStr = from === undefined ? '∅' : String(from);
    const toStr = to === undefined ? '∅' : String(to);
    badge.innerHTML =
      `<span class="vc-name">$${escapeHtml(name)}</span>` +
      `<span class="vc-from">${escapeHtml(fromStr)}</span>` +
      `<span class="vc-arrow">→</span>` +
      `<span class="vc-to">${escapeHtml(toStr)}</span>`;
    target.appendChild(badge);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  if (varsEl) {
    new MutationObserver(() => {
      annotateVarTypes();
      const next = snapshotVars();
      if (lastVarSnapshot) {
        for (const [name, val] of Object.entries(next)) {
          if (lastVarSnapshot[name] !== val && name in lastVarSnapshot) {
            appendBadgeToLastRow(name, lastVarSnapshot[name], val);
            flashVarRow(name);
          }
        }
      }
      lastVarSnapshot = next;
    }).observe(varsEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });

    // Initial annotation pass.
    setTimeout(() => { annotateVarTypes(); lastVarSnapshot = snapshotVars(); }, 0);
  }

  // ── 3. Header click → reveal in source ──────────────────────────────────
  if (currentEl) {
    currentEl.style.cursor = 'pointer';
    currentEl.title = 'Click to scroll source to top';
    currentEl.addEventListener('click', () => {
      const view = document.getElementById('source-view');
      if (view) view.scrollTop = 0;
    });
  }

  // ── 5. Dismissable hint pill ────────────────────────────────────────────
  const hintEl = document.getElementById('hint');
  const hintCloseEl = document.getElementById('hint-close');
  const HINT_KEY = 'mbu-yarn-preview.hint-dismissed';
  if (hintEl && hintCloseEl) {
    if (localStorage.getItem(HINT_KEY) === '1') {
      hintEl.classList.add('hidden');
    }
    hintCloseEl.addEventListener('click', () => {
      hintEl.classList.add('hidden');
      try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
    });
  }

  // Initial sync.
  setTimeout(syncActiveNode, 0);
})();
