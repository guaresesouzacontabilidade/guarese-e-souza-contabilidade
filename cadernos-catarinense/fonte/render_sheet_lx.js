const { chromium } = require('playwright'); const fs=require('fs'), path=require('path'), http=require('http');
(async()=>{ const dir=__dirname; const types={'.html':'text/html','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
 const server=http.createServer((q,r)=>{const p=path.join(dir,decodeURIComponent(q.url.split('?')[0]));fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});r.end(d);});}).listen(0);
 const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:2000,height:1000},deviceScaleFactor:1.25})).newPage();
 await p.goto(`http://127.0.0.1:${server.address().port}/sheet_lx.html`); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
 await p.locator('#sheet').screenshot({path:'final/apresentacao-linha-executiva.png'}); await b.close(); server.close(); })();
