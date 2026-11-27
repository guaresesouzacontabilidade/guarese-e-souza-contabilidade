// Render calendar pages at 300 dpi: node render_cal.js <outDir> [filter] [scaleFactor]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), http = require('http');
(async () => {
  const dir = __dirname, outDir = process.argv[2] || 'cal_out', only = process.argv[3] || '', k = parseFloat(process.argv[4] || '1');
  fs.mkdirSync(outDir, { recursive: true });
  const types = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = http.createServer((q, r) => { const p = path.join(dir, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
  const port = server.address().port, b = await chromium.launch();
  // px per mm in each layout -> scale to 300 dpi (11.811 px/mm)
  const SPEC = { mesa: 5, parede: 3, bolso: 10 };
  for (const f of fs.readdirSync(path.join(dir, 'cal')).filter(f => f.endsWith('.html') && f.includes(only)).sort()) {
    const kind = f.split('_')[0];
    const ctx = await b.newContext({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: (300 / 25.4 / SPEC[kind]) * k });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/cal/${f}`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(120);
    await p.locator('.cover').screenshot({ path: path.join(outDir, f.replace('.html', '.png')) });
    await ctx.close();
  }
  await b.close(); server.close();
})();
