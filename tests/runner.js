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
      console.log(`✓ ${summary}`);
    } else {
      console.error(`✗ ${summary}`);
      console.error('Failed cases:');
      for (const t of failedTests) {
        const text = (await t.textContent()).trim().replace(/\s+/g, ' ');
        console.error('  - ' + text);
      }
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
