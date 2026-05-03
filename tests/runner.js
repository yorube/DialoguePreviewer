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

  await run('UI Strings page text re-translates on lang switch', async () => {
    // Switch to UI Strings page, observe brand label, flip lang, re-check.
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
    if (!enBrand.includes('UI Strings')) throw new Error(`brand @en: "${enBrand}"`);

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
    // disabled attr present (any value, including "" or "true") means disabled
    if (disabled === null) throw new Error('play-btn should be disabled with no node');
  });

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
