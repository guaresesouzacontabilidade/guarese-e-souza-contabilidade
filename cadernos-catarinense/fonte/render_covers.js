// Render cover_*.html to PNG at print resolution (154x216 mm @ 300 dpi = 1819x2551 px)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const dir = __dirname;
  const outDir = process.argv[2] || path.join(dir, 'out');
  const scale = parseFloat(process.argv[3] || (1819 / 770));
  const only = process.argv[4];
  fs.mkdirSync(outDir, { recursive: true });
  const http = require('http');
  const types = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
  }).listen(0);
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 770, height: 1080 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  const files = fs.readdirSync(dir).filter(f => /^cover_.*\.html$/.test(f) && (!only || f.includes(only))).sort();
  for (const f of files) {
    await page.goto(`http://127.0.0.1:${port}/${f}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const out = path.join(outDir, f.replace('.html', '.png'));
    await page.locator('.cover').screenshot({ path: out });
    console.log(out);
  }
  await browser.close();
  server.close();
})();
