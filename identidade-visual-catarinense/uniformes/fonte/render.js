// node render.js <outDir> <scale> name1 name2 ...   (serves the parent work/ dir)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), http = require('http');
(async () => {
  const root = path.join(__dirname, '..');
  const [outDir, scale, ...names] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const types = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
  const server = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
  const port = server.address().port; const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 2000, height: 2400 }, deviceScaleFactor: parseFloat(scale) });
  const page = await ctx.newPage();
  for (const n of names) {
    await page.goto(`http://127.0.0.1:${port}/uniformes/${n}.html`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))));
    await page.waitForTimeout(250);
    const el = await page.$('#scene') || await page.$('body');
    await el.screenshot({ path: path.join(outDir, n + '.png') });
    console.log(n);
  }
  await b.close(); server.close();
})();
