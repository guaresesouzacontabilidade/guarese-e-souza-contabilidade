// Render notebook mockups: node render_mockups.js <coverDir> <outDir> <scale> [filter]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = process.env.CFG ? JSON.parse(process.env.CFG) : process.env.LUX ? {
  'lx1-imperial': { spiral: 'gold', elastic: 'caramel', back: '#04261a', bg: 'dark' },
  'lx2-noir':     { spiral: 'gold', elastic: 'green', back: '#0d0d0d', bg: 'dark', corners: 'gold' },
  'lx3-bordeaux': { spiral: 'gold', elastic: 'green', back: '#3a050c', bg: 'dark' },
  'lx4-couture':  { spiral: 'gold', elastic: 'green', back: '#06321b', bg: 'dark' },
} : {
  '01-classico':       { spiral: 'white',  elastic: 'green', back: '#0a4a25' },
  '02-verde-premium':  { spiral: 'gold',   elastic: 'wine',  back: '#05351a' },
  '03-ondas-bandeira': { spiral: 'white',  elastic: 'green', back: '#7a0710' },
  '04-minimalista':    { spiral: 'black',  elastic: 'black', back: '#2a2a2a' },
  '05-vinho-elegante': { spiral: 'gold',   elastic: 'green', back: '#4a060e' },
  '06-executivo':      { spiral: 'silver', elastic: 'wine',  back: '#07431f' },
};

(async () => {
  const dir = __dirname;
  const coverDir = process.argv[2] || 'out';
  const outDir = process.argv[3] || path.join(dir, 'mock');
  const scale = parseFloat(process.argv[4] || '2');
  const only = process.argv[5];
  fs.mkdirSync(outDir, { recursive: true });
  const types = { '.html': 'text/html', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
  }).listen(0);
  const port = server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1250 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  for (const [name, c] of Object.entries(CONFIG)) {
    if (only && !name.includes(only)) continue;
    const qs = new URLSearchParams({ cover: `${coverDir}/cover_${name}.png`, ...c }).toString();
    await page.goto(`http://127.0.0.1:${port}/mockup.html?${qs}`);
    await page.waitForFunction(() => document.title === 'ready' && document.querySelector('#cover img').complete);
    await page.waitForTimeout(100);
    const out = path.join(outDir, `mockup_${name}.png`);
    await page.locator('#scene').screenshot({ path: out });
    console.log(out);
  }
  await browser.close();
  server.close();
})();
