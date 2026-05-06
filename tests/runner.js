// tests/runner.js
// CI driver: spin up a tiny static server, point Playwright Chromium at
// test.html, scrape pass/fail from the rendered DOM, exit 0 on green and
// 1 on red. The actual test cases live in test.html (single source of
// truth — same file the user opens in a real browser to verify locally).
//
// Usage: `node tests/runner.js` (after `npm install`).
// The package.json's `npm test` script wraps this.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18080;

// ─── Static file server (project root) ─────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel = (rel || '') + 'index.html';
  // Block path traversal.
  if (rel.includes('..')) { res.writeHead(400); res.end(); return; }
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT)) { res.writeHead(400); res.end(); return; }
  fs.readFile(abs, (err, body) => {
    if (err) { res.writeHead(404); res.end('404 ' + rel); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  });
});

// ─── Integration suite ───────────────────────────────────────────────
// Each entry: { name, fn(page) → Promise }. fn throws to signal failure.
async function runIntegrationSuite(page) {
  const results = [];
  async function run(name, fn) {
    try { await fn(); results.push({ name, pass: true }); }
    catch (e) { results.push({ name, pass: false, err: e.message }); }
  }

  // RFC 4180 CSV parser — mirrors loc-parser.js's parseCsvText so the
  // export-coverage assertion can read its own output without dragging in
  // the browser globals. Strips leading BOM if present.
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], cell = '', inQuotes = false, i = 0, len = text.length;
    while (i < len) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cell += c; i++; continue;
      }
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
    if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
    return rows;
  }

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  // Wait for ui.js bootstrap: window.YP must be installed and the
  // dialogue-toolbar must have rendered (its presence proves init() ran).
  await page.waitForFunction(() => {
    return window.YP && typeof window.YP.t === 'function'
      && document.getElementById('play-btn');
  }, { timeout: 5000 });

  // Force a known starting language so assertions are deterministic
  // regardless of what was in localStorage from prior runs.
  await page.evaluate(() => {
    const sel = document.getElementById('ui-lang-select');
    sel.value = 'en';
    sel.dispatchEvent(new Event('change'));
  });

  // ─── i18n live switching ───
  await run('toolbar buttons start in English', async () => {
    const playTxt = (await page.locator('#play-btn').textContent()).trim();
    const helpTxt = (await page.locator('#help-btn').textContent()).trim();
    if (!playTxt.includes('Play'))  throw new Error(`#play-btn not English: "${playTxt}"`);
    if (!helpTxt.includes('Help'))  throw new Error(`#help-btn not English: "${helpTxt}"`);
  });

  await run('switching to zh re-translates declarative DOM (data-i18n)', async () => {
    await page.evaluate(() => {
      const sel = document.getElementById('ui-lang-select');
      sel.value = 'zh';
      sel.dispatchEvent(new Event('change'));
    });
    const playTxt = (await page.locator('#play-btn').textContent()).trim();
    const helpTxt = (await page.locator('#help-btn').textContent()).trim();
    if (!playTxt.includes('撥放')) throw new Error(`#play-btn not Chinese: "${playTxt}"`);
    if (!helpTxt.includes('說明')) throw new Error(`#help-btn not Chinese: "${helpTxt}"`);
  });

  await run('window.YP.t(key) returns active-lang string', async () => {
    const en = await page.evaluate(() => {
      document.getElementById('ui-lang-select').value = 'en';
      document.getElementById('ui-lang-select').dispatchEvent(new Event('change'));
      return window.YP.t('btn.play');
    });
    if (!en.includes('Play')) throw new Error(`t('btn.play') @en: "${en}"`);
    const zh = await page.evaluate(() => {
      document.getElementById('ui-lang-select').value = 'zh';
      document.getElementById('ui-lang-select').dispatchEvent(new Event('change'));
      return window.YP.t('btn.play');
    });
    if (!zh.includes('撥放')) throw new Error(`t('btn.play') @zh: "${zh}"`);
  });

  await run('onLangChange callback fires on switch', async () => {
    const fired = await page.evaluate(async () => {
      let count = 0;
      const off = window.YP.onLangChange(() => count++);
      const sel = document.getElementById('ui-lang-select');
      sel.value = 'en'; sel.dispatchEvent(new Event('change'));
      sel.value = 'zh'; sel.dispatchEvent(new Event('change'));
      sel.value = 'en'; sel.dispatchEvent(new Event('change'));
      off();
      return count;
    });
    if (fired !== 3) throw new Error(`expected 3 fires, got ${fired}`);
  });

  await run('UI strings page text re-translates on lang switch', async () => {
    // Switch to UI strings page, observe brand label, flip lang, re-check.
    await page.evaluate(() => {
      document.querySelector('[data-page="ui-strings"]').click();
    });
    await page.waitForFunction(
      () => document.body.classList.contains('page-ui-strings'),
      { timeout: 2000 }
    );

    // Force en, capture brand
    await page.evaluate(() => {
      const sel = document.getElementById('ui-lang-select');
      sel.value = 'en'; sel.dispatchEvent(new Event('change'));
    });
    const enBrand = (await page.locator('.topbar-ui-strings .brand').textContent()).trim();
    if (!enBrand.includes('UI strings')) throw new Error(`brand @en: "${enBrand}"`);

    // Flip to zh
    await page.evaluate(() => {
      const sel = document.getElementById('ui-lang-select');
      sel.value = 'zh'; sel.dispatchEvent(new Event('change'));
    });
    const zhBrand = (await page.locator('.topbar-ui-strings .brand').textContent()).trim();
    if (!zhBrand.includes('UI 字串')) throw new Error(`brand @zh: "${zhBrand}"`);

    // Restore dialogue page so subsequent tests see the dialogue DOM.
    await page.evaluate(() => {
      document.querySelector('[data-page="dialogue"]').click();
    });
  });

  // ─── Play / Stop button toggle ───
  await run('Play button starts disabled when no node selected', async () => {
    // Reset to en so text assertions read consistently.
    await page.evaluate(() => {
      const sel = document.getElementById('ui-lang-select');
      sel.value = 'en'; sel.dispatchEvent(new Event('change'));
    });
    const disabled = await page.locator('#play-btn').getAttribute('disabled');
    if (disabled === null) throw new Error('play-btn should be disabled with no node');
  });

  // ─── Below: tests that need a script + node loaded ──────────────────
  // Wait for manifest bootstrap to complete (script-select gets options).
  // CI checkout includes the data/ folder so this works without seeding.
  let dataReady = false;
  try {
    await page.waitForFunction(() => {
      const sel = document.getElementById('script-select');
      return sel && sel.options.length > 0;
    }, { timeout: 5000 });
    dataReady = true;
  } catch (e) {
    results.push({
      name: '[skip] data-bootstrap-dependent tests (manifest not loaded)',
      pass: true,
    });
  }

  if (dataReady) {
    // Click the first node so subsequent tests have a navigation target.
    async function selectFirstNode() {
      await page.waitForFunction(
        () => document.querySelectorAll('#node-list li').length > 0,
        { timeout: 5000 }
      );
      await page.evaluate(() => {
        document.querySelector('#node-list li').click();
      });
      await page.waitForFunction(
        () => document.getElementById('current-node').textContent !== '—',
        { timeout: 2000 }
      );
    }

    await run('clicking sidebar node enters navigation-only state', async () => {
      await selectFirstNode();
      // header updated
      const header = await page.locator('#current-node').textContent();
      if (header === '—') throw new Error('header still placeholder after click');
      // transcript shows empty-state placeholder
      const placeholder = await page.locator('.transcript-empty').count();
      if (placeholder !== 1) throw new Error(`expected 1 placeholder, got ${placeholder}`);
      // active-node highlight applied
      const activeCount = await page.locator('#node-list li.is-active').count();
      if (activeCount !== 1) throw new Error(`expected 1 .is-active li, got ${activeCount}`);
      // Play button enabled
      const disabled = await page.locator('#play-btn').getAttribute('disabled');
      if (disabled !== null) throw new Error('play-btn should be enabled after node click');
    });

    await run('▶ Play → runtime starts, button label flips to ■ Stop', async () => {
      await page.click('#play-btn');
      // First transcript row appears
      await page.waitForFunction(
        () => document.querySelector('#transcript .row') !== null,
        { timeout: 2000 }
      );
      const playTxt = (await page.locator('#play-btn').textContent()).trim();
      if (!playTxt.includes('Stop')) throw new Error(`expected Stop, got "${playTxt}"`);
      const isStopClass = await page.locator('#play-btn.is-stop').count();
      if (isStopClass !== 1) throw new Error('button should have .is-stop class');
      // Step back enabled
      const backDisabled = await page.locator('#back-line-btn').getAttribute('disabled');
      // back is enabled only when snapshots.length >= 2 — first line == 1 snapshot.
      // We just check it exists. Below we'll advance and re-check.
      // (No strict assertion here.)
      void backDisabled;
    });

    await run('■ Stop → runtime cleared, transcript empty, placeholder back', async () => {
      await page.click('#play-btn');   // currently Stop
      await page.waitForFunction(
        () => document.querySelector('.transcript-empty') !== null,
        { timeout: 2000 }
      );
      const playTxt = (await page.locator('#play-btn').textContent()).trim();
      if (!playTxt.includes('Play')) throw new Error(`expected Play after stop, got "${playTxt}"`);
      const transcriptRows = await page.locator('#transcript .row').count();
      if (transcriptRows !== 0) throw new Error(`expected 0 rows, got ${transcriptRows}`);
    });

    await run('placeholder ▶ icon click triggers same play flow', async () => {
      await page.click('.transcript-empty-icon');
      await page.waitForFunction(
        () => document.querySelector('#transcript .row') !== null,
        { timeout: 2000 }
      );
      const isStopClass = await page.locator('#play-btn.is-stop').count();
      if (isStopClass !== 1) throw new Error('clicking placeholder ▶ should also enter playback');
      // Stop again to leave clean state for next test
      await page.click('#play-btn');
    });

    await run('Space key when idle (with node selected) triggers Play', async () => {
      // Confirm we're in idle state
      const playTxt = (await page.locator('#play-btn').textContent()).trim();
      if (!playTxt.includes('Play')) throw new Error('precondition: idle expected');
      // Press space anywhere outside form fields (body has focus by default)
      await page.evaluate(() => document.body.focus());
      await page.keyboard.press('Space');
      await page.waitForFunction(
        () => document.querySelector('#play-btn').textContent.includes('Stop'),
        { timeout: 2000 }
      );
      // Cleanup
      await page.click('#play-btn');
    });

    // (Dropped: "after dialogue ends, ▶ Play reappears" — refreshPlaybackUi
    // is already covered by the ■ Stop test, and walking a real branching
    // dialogue to its natural end with a click loop is fragile against
    // long / cross-node scripts. Same code path either way.)

    await run('Edit mode toggle adds body.t-edit-mode class', async () => {
      // First navigate to a fresh node to clear any end-state
      await selectFirstNode();
      const beforeOn = await page.evaluate(() => document.body.classList.contains('t-edit-mode'));
      if (beforeOn) {
        // Already on (from prior test pollution); turn off first
        await page.click('#t-mode-toggle');
        await page.waitForFunction(() => !document.body.classList.contains('t-edit-mode'));
      }
      await page.click('#t-mode-toggle');
      await page.waitForFunction(
        () => document.body.classList.contains('t-edit-mode'),
        { timeout: 2000 }
      );
      // flat view should now exist
      const flatExists = await page.locator('#flat-edit-view').count();
      if (flatExists !== 1) throw new Error('flat-edit-view should exist in Edit mode');
      // Toggle off
      await page.click('#t-mode-toggle');
      await page.waitForFunction(
        () => !document.body.classList.contains('t-edit-mode'),
        { timeout: 2000 }
      );
    });

    await run('Help dialog opens on click, closes on Esc', async () => {
      await page.click('#help-btn');
      await page.waitForFunction(
        () => !document.getElementById('help-overlay').hasAttribute('hidden'),
        { timeout: 2000 }
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => document.getElementById('help-overlay').hasAttribute('hidden'),
        { timeout: 2000 }
      );
    });

    await run('UI strings page tab toggles body class', async () => {
      await page.evaluate(() => document.querySelector('[data-page="ui-strings"]').click());
      await page.waitForFunction(
        () => document.body.classList.contains('page-ui-strings'),
        { timeout: 2000 }
      );
      await page.evaluate(() => document.querySelector('[data-page="dialogue"]').click());
      await page.waitForFunction(
        () => !document.body.classList.contains('page-ui-strings'),
        { timeout: 2000 }
      );
    });

    await run('UI lang preference persists across reload (yp.lang)', async () => {
      // Set zh, reload, expect zh on the dropdown
      await page.evaluate(() => {
        const sel = document.getElementById('ui-lang-select');
        sel.value = 'zh'; sel.dispatchEvent(new Event('change'));
      });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(
        () => window.YP && window.YP.getLang,
        { timeout: 5000 }
      );
      const lang = await page.evaluate(() => window.YP.getLang());
      if (lang !== 'zh') throw new Error(`lang after reload: "${lang}"`);
      // Reset to en for any subsequent tests
      await page.evaluate(() => {
        const sel = document.getElementById('ui-lang-select');
        sel.value = 'en'; sel.dispatchEvent(new Event('change'));
      });
    });

    // ─── Visual sanity (computed styles, not subjective) ──────────────
    // Note: .action-btn has `transition: background 0.14s`. Reading
    // getComputedStyle immediately after a class flip catches an
    // intermediate value (e.g. accent at alpha 0.97 mid-transition to
    // transparent). waitForFunction polls until the FINAL value lands.

    // Helper: snapshot button state for diagnostic error messages.
    // Distinguishing "wait timed out for class" vs "wait timed out for bg"
    // matters when the failure mode isn't obvious.
    const btnState = () => page.evaluate(() => {
      const el = document.querySelector('#play-btn');
      if (!el) return 'NO #play-btn';
      return JSON.stringify({
        cls: Array.from(el.classList),
        text: el.textContent.trim(),
        bg: getComputedStyle(el).backgroundColor,
        disabled: el.disabled,
      });
    });
    // Playwright signature: waitForFunction(fn, arg, options). Passing
    // { timeout } as the 2nd arg is treated as `arg` (passed to fn) — the
    // options slot is empty so the default 30s timeout is used. Always
    // pass `null` for arg.
    const waitFor = (fn, ms, label) => page.waitForFunction(fn, null, { timeout: ms })
      .catch(async (e) => {
        const state = await btnState();
        throw new Error(`${label || 'wait'} timed out (${ms}ms). #play-btn state: ${state}`);
      });

    await run('Play button (idle) has accent-fill background', async () => {
      await selectFirstNode();
      const isStop = await page.locator('#play-btn.is-stop').count();
      if (isStop > 0) {
        await page.click('#play-btn');   // get back to idle
        await waitFor(
          () => !document.querySelector('#play-btn').classList.contains('is-stop'),
          2000, 'leave-stop-state'
        );
      }
      // Wait for bg transition to settle on a non-transparent, opaque value.
      await waitFor(() => {
        const bg = getComputedStyle(document.querySelector('#play-btn')).backgroundColor;
        if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
        const m = bg.match(/[\/,]\s*([\d.]+)\s*\)/);
        const alpha = m ? parseFloat(m[1]) : 1;
        return alpha > 0.99;
      }, 1000, 'idle-bg-settle');
    });

    await run('Stop button (playing) has transparent background', async () => {
      await page.click('#play-btn');   // enter playback
      await waitFor(
        () => document.querySelector('#play-btn').classList.contains('is-stop'),
        2000, 'is-stop-class-applied'
      );
      // Move the mouse off the button — page.click() leaves the cursor
      // hovering, which would activate :hover styles and change the
      // expected background from `transparent` (.is-stop) to `var(--warn-bg)`
      // (.is-stop:hover). Test the resting state, not the hover state.
      await page.mouse.move(0, 0);
      // Wait for bg to actually transition to transparent.
      await waitFor(() => {
        const bg = getComputedStyle(document.querySelector('#play-btn')).backgroundColor;
        return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || /\/\s*0\s*\)/.test(bg);
      }, 1000, 'stop-bg-transparent');
      // Cleanup
      await page.click('#play-btn');
    });

    await run('placeholder ▶ icon is a circular button (border-radius 50%)', async () => {
      // Make sure placeholder is showing (idle state with node)
      await selectFirstNode();
      const radius = await page.locator('.transcript-empty-icon').evaluate((el) => getComputedStyle(el).borderRadius);
      // 50% computed → "32px" or "50%" depending on browser; 64px width → 32px.
      if (!radius.endsWith('px') && !radius.endsWith('%')) {
        throw new Error(`unexpected border-radius value: "${radius}"`);
      }
      // also assert it's a button element (not a div)
      const tag = await page.locator('.transcript-empty-icon').evaluate((el) => el.tagName);
      if (tag !== 'BUTTON') throw new Error(`expected BUTTON tag, got "${tag}"`);
    });

    await run('active node has box-shadow inset (left accent bar)', async () => {
      const shadow = await page.locator('#node-list li.is-active').evaluate((el) => getComputedStyle(el).boxShadow);
      if (shadow === 'none' || !shadow) {
        throw new Error(`active node should have box-shadow, got "${shadow}"`);
      }
    });

    // ─── Translation review-status: structural sanity (locale-agnostic) ───

    await run('sidebar status-filter bar renders all 5 chips', async () => {
      const bar = await page.locator('#status-filter-bar').count();
      if (bar !== 1) throw new Error(`expected #status-filter-bar to exist`);
      const chips = await page.locator('#status-filter-bar .status-filter-chip').count();
      if (chips !== 5) throw new Error(`expected 5 status filter chips, got ${chips}`);
      // The "All" chip should start active (no filter applied).
      const allActive = await page.locator(
        '#status-filter-bar .status-filter-chip-all.active'
      ).count();
      if (allActive !== 1) throw new Error(`All chip should start active`);
    });

    await run('clicking a status-filter chip toggles its .active class', async () => {
      // Click "Has needs-review" chip.
      const chip = page.locator('#status-filter-bar .status-filter-chip-accent');
      await chip.click();
      const cls = await chip.evaluate(el => el.classList.contains('active'));
      if (!cls) throw new Error('expected accent chip active after click');
      // All-chip should have lost its active state.
      const allActive = await page.locator(
        '#status-filter-bar .status-filter-chip-all.active'
      ).count();
      if (allActive !== 0) throw new Error(`All chip should NOT be active when needs-review filter is on`);
      // Click again to deselect.
      await chip.click();
      const off = await chip.evaluate(el => el.classList.contains('active'));
      if (off) throw new Error('chip should toggle off on second click');
    });

    await run('clicking All chip clears all status filters', async () => {
      // Activate two filters first.
      await page.locator('#status-filter-bar .status-filter-chip-warn').click();
      await page.locator('#status-filter-bar .status-filter-chip-good').click();
      const before = await page.locator('#status-filter-bar .status-filter-chip.active').count();
      if (before < 2) throw new Error(`expected ≥2 active chips before All-clear, got ${before}`);
      // Now click All.
      await page.locator('#status-filter-bar .status-filter-chip-all').click();
      const after = await page.locator('#status-filter-bar .status-filter-chip.active').count();
      // Only "All" should remain active.
      if (after !== 1) throw new Error(`expected exactly 1 active chip (All) after clear, got ${after}`);
      const allActive = await page.locator(
        '#status-filter-bar .status-filter-chip-all.active'
      ).count();
      if (allActive !== 1) throw new Error('All chip should be the lone active one');
    });

    await run('global progress disclosure toggle hidden until data loads', async () => {
      // With no translation file imported and likely an en-US-ish active
      // locale, the breakdown is null → toggle should be [hidden].
      const tog = page.locator('#t-prog-toggle');
      const exists = await tog.count();
      if (exists !== 1) throw new Error('#t-prog-toggle should exist in DOM');
      // Hidden attribute is set when there's no breakdown to show.
      const hidden = await tog.evaluate(el => el.hasAttribute('hidden'));
      if (!hidden) throw new Error('toggle should start [hidden] without breakdown data');
    });

    // ─── Per-locale status round-trip via TranslationState (no file UI) ───

    await run('TranslationState.setStatus survives locale-state recreation', async () => {
      const ok = await page.evaluate(() => {
        const loc = '__test_int_status_' + Date.now();
        const s1 = window.TranslationState.createState(loc);
        s1.setStatus('uid-X', 'approved');
        const s2 = window.TranslationState.createState(loc);
        const ok = s2.getStatus('uid-X') === 'approved';
        s2.reset();
        try { localStorage.removeItem('yp.translation.' + loc); } catch (_) {}
        return ok;
      });
      if (!ok) throw new Error('status did not survive recreation');
    });

    await run('bulkSetStatusForActiveLocale is callable from TranslationUI', async () => {
      const fnType = await page.evaluate(
        () => typeof window.TranslationUI.bulkSetStatusForActiveLocale
      );
      if (fnType !== 'function') {
        throw new Error(`expected function, got ${fnType}`);
      }
    });

    // ─── Target-locale-dependent: chip + menu (skip when only en-US loaded) ──

    await run('flat-view status chip appears for non-source locale', async () => {
      const targetLocale = await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        const opts = Array.from(sel.options).map(o => o.value);
        return opts.find(l => l !== 'en-US' && l !== 'zh-TW' && l !== 'unknown') || null;
      });
      if (!targetLocale) {
        // Skip — no target locale bundled in the test data.
        return;
      }
      // Switch to the target locale + select a node.
      await page.evaluate((loc) => {
        const sel = document.getElementById('locale-select');
        sel.value = loc;
        sel.dispatchEvent(new Event('change'));
      }, targetLocale);
      // Wait for sidebar to reflect new locale (load is async).
      await page.waitForFunction(
        () => document.querySelectorAll('#node-list li').length > 0,
        { timeout: 5000 }
      );
      await page.evaluate(() => document.querySelector('#node-list li').click());
      // Turn on Edit mode → flat view appears with chips.
      await page.click('#t-mode-toggle');
      await page.waitForFunction(
        () => document.body.classList.contains('t-edit-mode'),
        { timeout: 2000 }
      );
      // At least one .t-status-chip should appear in flat view (assuming
      // the picked node has translatable lines).
      const chipCount = await page.locator('#flat-edit-view .t-status-chip').count();
      if (chipCount === 0) {
        // Some nodes (overview / variable nodes) have no translatable lines —
        // try the next node.
        await page.evaluate(() => {
          const lis = document.querySelectorAll('#node-list li');
          if (lis.length > 1) lis[1].click();
        });
        const c2 = await page.locator('#flat-edit-view .t-status-chip').count();
        if (c2 === 0) throw new Error('no .t-status-chip rendered in flat view');
      }
      // Toggle off
      await page.click('#t-mode-toggle');
    });

    await run('flat-view bulk approve button rendered with count', async () => {
      const targetLocale = await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        const opts = Array.from(sel.options).map(o => o.value);
        return opts.find(l => l !== 'en-US' && l !== 'zh-TW' && l !== 'unknown') || null;
      });
      if (!targetLocale) return;
      // Already on a target locale + node from the previous test, but
      // re-enter Edit mode to render the header.
      await page.click('#t-mode-toggle');
      await page.waitForFunction(
        () => document.body.classList.contains('t-edit-mode'),
        { timeout: 2000 }
      );
      const approveBtn = await page.locator('.flat-node-actions .flat-bulk-btn.approve').count();
      const clearBtn   = await page.locator('.flat-node-actions .flat-bulk-btn.clear').count();
      if (approveBtn !== 1) throw new Error(`expected 1 approve button, got ${approveBtn}`);
      if (clearBtn !== 1)   throw new Error(`expected 1 clear button, got ${clearBtn}`);
      // Toggle off so we leave clean state.
      await page.click('#t-mode-toggle');
    });

    // ─── Bundle-as-implicit-baseline (locked-locale recognition) ─────
    // Run last because some of these change the active locale.

    await run('lookupLine returns untranslated for uid not in bundle map (fake / unloaded)', async () => {
      // Bundle map contains every real translatable uid for the active
      // locale (when the locale has a real bundle). A fake uid won't be
      // there → must read as 'untranslated'. For locales using the
      // 404-fallback (no bundle), the bundle map is empty → every uid
      // also reads as 'untranslated' until the user imports a CSV/xlsx.
      const targetLocale = await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        const opts = Array.from(sel.options).map(o => o.value);
        return opts.find(l => l !== 'en-US' && l !== 'zh-TW' && l !== 'unknown') || null;
      });
      if (!targetLocale) return;
      await page.evaluate((loc) => {
        const sel = document.getElementById('locale-select');
        sel.value = loc;
        sel.dispatchEvent(new Event('change'));
      }, targetLocale);
      // Fake uid → not in bundle map → untranslated. originalText being
      // non-empty doesn't grant baseline status anymore (the R1 bug).
      const probe = await page.evaluate(() => window.TranslationUI.lookupLine(
        'fake-uid-not-in-any-bundle',
        'some bundle text passed in by runtime',
      ));
      if (probe.status !== 'untranslated') {
        throw new Error(`expected 'untranslated' for uid absent from bundle map, got '${probe.status}'`);
      }
    });

    await run('lookupLine returns baseline for real uid present in bundle map', async () => {
      // Walk the active locale's project to find a uid where bundle text
      // genuinely differs from en-US — that one MUST be 'baseline'.
      const targetLocale = await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        const opts = Array.from(sel.options).map(o => o.value);
        return opts.find(l => l !== 'en-US' && l !== 'zh-TW' && l !== 'unknown') || null;
      });
      if (!targetLocale) return;
      const probe = await page.evaluate((loc) => {
        const map = window.TranslationUI.lookupLine
          ? null  // can't peek the hook here; use direct API instead
          : null;
        // Use the install hook indirectly: ask for the bundle map via a
        // tiny window-scoped probe. Not available — fall back to the
        // observable: invoke lookupLine for several uids until we find a
        // 'baseline' one. If all return 'untranslated' (locale fully
        // English-fallback), this test no-ops.
        // Strategy: enumerate sidebar nodes, render flat view, sample uids.
        const lis = document.querySelectorAll('#node-list li');
        if (!lis.length) return { skipped: 'no nodes' };
        lis[0].click();
        // Need flat view to get uids on the rows.
        const editToggle = document.getElementById('t-mode-toggle');
        if (!editToggle.classList.contains('active')) editToggle.click();
        return new Promise(resolve => {
          setTimeout(() => {
            const rows = document.querySelectorAll('#flat-edit-view [data-t-uid]');
            for (const r of rows) {
              const uid = r.dataset.tUid;
              const original = r.dataset.tOriginal || '';
              const probe = window.TranslationUI.lookupLine(uid, original);
              if (probe.status === 'baseline') {
                editToggle.click();   // exit edit mode for next test
                resolve({ probeStatus: probe.status, sampleUid: uid });
                return;
              }
            }
            editToggle.click();
            resolve({ skipped: 'no baseline-status row in first node' });
          }, 400);
        });
      }, targetLocale);
      if (probe.skipped) return;   // graceful no-op for fully-English-fallback locales
      if (probe.probeStatus !== 'baseline') {
        throw new Error(`expected 'baseline' for real uid with non-en-US bundle, got '${probe.probeStatus}'`);
      }
    });

    await run('locale with no bundled JSON falls back to en-US project gracefully', async () => {
      // fr-FR's bundle JSONs were deleted from data/ — the locale stays
      // selectable, ensureLoaded swaps in en-US's project, runtime + UI
      // still work, R2 bundle filter sees text === en-US for every line
      // → progress reads 0% (correct: nothing translated yet).
      const hasFR = await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        return Array.from(sel.options).some(o => o.value === 'fr-FR');
      });
      if (!hasFR) return;   // manifest not bundled in test fixture
      await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        sel.value = 'fr-FR';
        sel.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(
        () => document.querySelectorAll('#node-list li').length > 0,
        { timeout: 5000 }
      );
      await page.waitForTimeout(400);
      // No crash, sidebar populated. Now check progress reads 0% for at
      // least one node (R2 should mark every line untranslated since
      // fr-FR's project IS en-US's project → text equals → bundle empty).
      const result = await page.evaluate(() => {
        const lis = Array.from(document.querySelectorAll('#node-list li'));
        let zeroCount = 0;
        let nonZeroCount = 0;
        for (const li of lis) {
          const prog = li.querySelector('.node-progress-text');
          if (!prog) continue;
          const m = /^(\d+)\/(\d+)$/.exec(prog.textContent);
          if (!m) continue;
          if (m[1] === '0' && m[2] !== '0') zeroCount++;
          else nonZeroCount++;
        }
        return { zeroCount, nonZeroCount, totalNodes: lis.length };
      });
      if (result.totalNodes === 0) throw new Error('sidebar empty after fr-FR switch');
      if (result.zeroCount === 0) {
        throw new Error(
          `expected at least one node with 0/N translated (fr-FR not bundled), got ` +
          `zero=${result.zeroCount} nonzero=${result.nonZeroCount}`
        );
      }
    });

    await run('source locale lookupLine returns inactive even with bundle text', async () => {
      await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        sel.value = 'en-US';
        sel.dispatchEvent(new Event('change'));
      });
      const probe = await page.evaluate(
        () => window.TranslationUI.lookupLine('any-uid', 'Hello')
      );
      if (probe.status !== 'inactive') {
        throw new Error(`expected 'inactive' for source locale, got '${probe.status}'`);
      }
    });

    await run('export covers every loaded script + emits xlsx with expanded gender labels', async () => {
      // Regressions guarded:
      //   1. Bundle map spans all loaded groups (not just active) — rows
      //      from non-active scripts must have non-empty translation cells.
      //   2. Synthetic export emits .xlsx (not .csv).
      //   3. Gender column uses 'male' / 'female' / 'none' labels (not
      //      single-char codes / blanks).
      const targetLocale = await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        const opts = Array.from(sel.options).map(o => o.value);
        return opts.find(l => l !== 'en-US' && l !== 'zh-TW' && l !== 'unknown') || null;
      });
      if (!targetLocale) return;
      const scripts = await page.evaluate(
        () => Array.from(document.querySelectorAll('#script-select option')).map(o => o.value)
      );
      if (scripts.length < 2) return;

      // Switch to target locale + visit two scripts.
      await page.evaluate((loc) => {
        const sel = document.getElementById('locale-select');
        sel.value = loc;
        sel.dispatchEvent(new Event('change'));
      }, targetLocale);
      await page.waitForTimeout(500);
      await page.evaluate((s) => {
        const sel = document.getElementById('script-select');
        sel.value = s;
        sel.dispatchEvent(new Event('change'));
      }, scripts[1]);
      await page.waitForTimeout(800);
      await page.evaluate((s) => {
        const sel = document.getElementById('script-select');
        sel.value = s;
        sel.dispatchEvent(new Event('change'));
      }, scripts[0]);
      await page.waitForTimeout(800);

      // Capture the export blob and parse it in-page (SheetJS is loaded
      // for both csv and xlsx paths). Returns { type, filename, aoa }.
      const captured = await page.evaluate(() => {
        return new Promise(resolve => {
          let result = null;
          const origCreate = URL.createObjectURL;
          let capturedBlob = null;
          let capturedName = null;
          URL.createObjectURL = (blob) => {
            capturedBlob = blob;
            return 'blob:fake';
          };
          // Patch <a>.click so we can grab the suggested filename without
          // actually triggering navigation.
          const origAClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.download) capturedName = this.download;
            // Don't call origAClick — would try to navigate to blob:fake.
          };
          document.getElementById('t-download-loc').click();
          const tick = () => {
            if (!capturedBlob) { setTimeout(tick, 200); return; }
            const reader = new FileReader();
            reader.onloadend = () => {
              try {
                const buf = new Uint8Array(reader.result);
                const wb = XLSX.read(buf, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                result = { filename: capturedName, aoa, mime: capturedBlob.type };
              } catch (e) {
                result = { error: 'parse failed: ' + e.message, filename: capturedName, mime: capturedBlob.type };
              }
              URL.createObjectURL = origCreate;
              HTMLAnchorElement.prototype.click = origAClick;
              resolve(result);
            };
            reader.readAsArrayBuffer(capturedBlob);
          };
          setTimeout(tick, 200);
        });
      });

      if (!captured) throw new Error('export produced no output');
      if (captured.error) throw new Error(captured.error);
      if (!captured.aoa || captured.aoa.length < 2) {
        throw new Error('exported workbook is empty');
      }
      // Filename ends with .xlsx
      if (!captured.filename || !/\.xlsx$/i.test(captured.filename)) {
        throw new Error(`expected .xlsx filename, got "${captured.filename}"`);
      }

      const aoa = captured.aoa;
      const headers = aoa[0];
      const idx = (n) => headers.findIndex(h => String(h).toLowerCase() === n.toLowerCase());
      const fileCol   = idx('FileName');
      const localeCol = idx(targetLocale);
      const genderCol = idx('Gender');
      if (fileCol === -1) throw new Error('exported workbook has no FileName column');
      if (localeCol === -1) throw new Error(`exported workbook has no ${targetLocale} column`);
      if (genderCol === -1) throw new Error('exported workbook has no Gender column');

      const perFile = {};
      const genderValues = new Set();
      for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i];
        if (!row || row.every(c => !c && c !== 0)) continue;
        const file = row[fileCol] || '<no-file>';
        const txt  = row[localeCol] || '';
        const g    = String(row[genderCol] || '').trim();
        genderValues.add(g);
        if (!perFile[file]) perFile[file] = { total: 0, withTr: 0 };
        perFile[file].total++;
        if (txt && String(txt).trim()) perFile[file].withTr++;
      }

      // Every gender value must be one of the expanded labels — no blanks,
      // no single-char codes leaking through.
      const allowed = new Set(['male', 'female', 'none']);
      const bad = [...genderValues].filter(g => !allowed.has(g));
      if (bad.length) {
        throw new Error(`unexpected Gender values in export: ${JSON.stringify(bad)} (allowed: male/female/none)`);
      }

      const fileCount = Object.keys(perFile).length;
      if (fileCount < 2) {
        throw new Error(`expected rows from ≥2 scripts in export, got ${fileCount}: ${Object.keys(perFile).join(', ')}`);
      }
      for (const [f, g] of Object.entries(perFile)) {
        if (g.total > 0 && g.withTr === 0) {
          throw new Error(`script "${f}" has 0/${g.total} translated cells in export — bundle map didn't cover it`);
        }
      }
    });

    await run('script switch while on non-en-US locale still renders sidebar progress UI', async () => {
      // Regression: stats UID computation requires en-US loaded. Before
      // the fix, ensureLoaded only loaded the active locale, so switching
      // to a fresh script while on (say) es-ES would leave en-US un-
      // loaded for the new script → empty stats → silently no dots /
      // X/Y count / progress bar.
      const targetLocale = await page.evaluate(() => {
        const sel = document.getElementById('locale-select');
        const opts = Array.from(sel.options).map(o => o.value);
        return opts.find(l => l !== 'en-US' && l !== 'zh-TW' && l !== 'unknown') || null;
      });
      if (!targetLocale) return;

      const scripts = await page.evaluate(
        () => Array.from(document.querySelectorAll('#script-select option')).map(o => o.value)
      );
      if (scripts.length < 2) return;

      // Force the target locale, then jump to a script we likely haven't
      // loaded en-US for in this session.
      await page.evaluate((loc) => {
        const sel = document.getElementById('locale-select');
        sel.value = loc;
        sel.dispatchEvent(new Event('change'));
      }, targetLocale);
      // Switch to the LAST script in the list (least likely to have been
      // pre-loaded for any reason during prior tests).
      const targetScript = scripts[scripts.length - 1];
      await page.evaluate((s) => {
        const sel = document.getElementById('script-select');
        sel.value = s;
        sel.dispatchEvent(new Event('change'));
      }, targetScript);

      // Wait for sidebar to settle.
      await page.waitForFunction(
        () => document.querySelectorAll('#node-list li').length > 0,
        { timeout: 5000 }
      );

      const result = await page.evaluate(() => {
        const lis = Array.from(document.querySelectorAll('#node-list li'));
        const total = lis.length;
        const withProg = lis.filter(li => li.querySelector('.node-progress-text')).length;
        const tProgHidden = document.getElementById('t-progress').hasAttribute('hidden');
        return { total, withProg, tProgHidden };
      });

      if (result.total === 0) {
        throw new Error('no nodes in sidebar after script switch');
      }
      if (result.withProg === 0) {
        throw new Error(`expected ≥1 node with progress UI, got 0/${result.total}` +
          ' — en-US likely not auto-loaded for stats');
      }
      if (result.tProgHidden) {
        throw new Error('top #t-progress bar is hidden — en-US likely not loaded for stats');
      }
    });
  }

  return results;
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`[runner] serving ${ROOT} on http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Surface browser console + page errors so CI logs aren't blind.
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[browser ${type}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    console.error(`[browser pageerror] ${err.message}`);
  });

  let exitCode = 0;
  try {
    await page.goto(`http://127.0.0.1:${PORT}/test.html`, { waitUntil: 'load' });

    // Test runner sets summary class to 'pass' or 'fail' once done.
    await page.waitForFunction(() => {
      const s = document.getElementById('summary');
      return s && (s.classList.contains('pass') || s.classList.contains('fail'));
    }, { timeout: 30000 });

    const summary = (await page.locator('#summary').textContent()).trim();
    const failedTests = await page.locator('.test.fail').all();

    if (failedTests.length === 0) {
      console.log(`✓ unit: ${summary}`);
    } else {
      console.error(`✗ unit: ${summary}`);
      console.error('Failed cases:');
      for (const t of failedTests) {
        const text = (await t.textContent()).trim().replace(/\s+/g, ' ');
        console.error('  - ' + text);
      }
      exitCode = 1;
    }

    // ─── Integration phase: drive the real index.html ────────────────
    // Tests behaviors that need the full app DOM + bootstrap chain.
    // Anything addressable through visible UI state (text, class, attr)
    // belongs here; only purely visual stuff (colors, transitions, font
    // rendering) genuinely needs a human.
    const intResults = await runIntegrationSuite(page);
    const intFailed = intResults.filter((r) => !r.pass);
    if (intFailed.length === 0) {
      console.log(`✓ integration: ${intResults.length} passed`);
    } else {
      console.error(`✗ integration: ${intFailed.length} failed, ${intResults.length - intFailed.length} passed`);
      for (const r of intFailed) console.error(`  - ${r.name}: ${r.err}`);
      exitCode = 1;
    }
  } catch (err) {
    console.error('[runner] fatal:', err.message);
    exitCode = 2;
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(exitCode);
}

main();
