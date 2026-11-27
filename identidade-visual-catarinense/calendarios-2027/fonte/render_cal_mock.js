// node render_cal_mock.js <outDir> <scale>
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), http = require('http');
(async () => {
  const dir = __dirname, outDir = process.argv[2] || 'cal_mock', scale = parseFloat(process.argv[3] || '1.5');
  fs.mkdirSync(outDir, { recursive: true });
  const types = { '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css' };
  const server = http.createServer((q, r) => { const p = path.join(dir, decodeURIComponent(q.url.split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
  const port = server.address().port, b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: scale })).newPage();
  const jobs = [
    ['calendario-mesa-capa', { mode: 'desk', page: 'cal_out/mesa_00-capa.png' }],
    ['calendario-mesa-janeiro', { mode: 'desk', page: 'cal_out/mesa_01-janeiro.png' }],
    ['calendario-mesa-maio', { mode: 'desk', page: 'cal_out/mesa_05-maio.png' }],
    ['calendario-parede-a3', { mode: 'wall', page: 'cal_out/parede_a3.png' }],
    ['calendario-bolso', { mode: 'pocket', front: 'cal_out/bolso_frente.png', back: 'cal_out/bolso_verso.png' }],
  ];
  for (const [name, params] of jobs) {
    await p.goto(`http://127.0.0.1:${port}/cal_mockups.html?${new URLSearchParams(params)}`);
    await p.waitForFunction(() => document.title === 'ready' && [...document.images].every(i => i.complete));
    await p.waitForTimeout(150);
    await p.locator('#scene').screenshot({ path: path.join(outDir, name + '.png') });
    console.log(name);
  }
  await b.close(); server.close();
})();
