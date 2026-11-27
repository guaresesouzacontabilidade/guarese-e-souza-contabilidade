// node render.js jobs.json   – each job: {html, out, dsf, w, h, sel?, omit?}
// Serves the parent work/ folder over HTTP (CSS masks need http, not file://).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const only = process.argv[3];
  const types = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
  const server = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
  }).listen(0);
  const port = server.address().port;
  const browser = await chromium.launch();
  for (const j of jobs) {
    if (only && !j.out.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: j.dsf });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text()); });
    await page.goto(`http://127.0.0.1:${port}/escritorio/${j.html}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(i => i.complete) && (!window.READY_FLAG || window.READY === true));
    await page.waitForTimeout(250);
    const out = path.join(__dirname, j.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.locator(j.sel || '.art').screenshot({ path: out, omitBackground: !!j.omit });
    console.log(out);
    await ctx.close();
  }
  await browser.close(); server.close();
})();
