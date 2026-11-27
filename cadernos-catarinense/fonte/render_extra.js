const { chromium } = require('playwright'); const fs=require('fs'), path=require('path'), http=require('http');
(async()=>{ const dir=__dirname;
 const types={'.html':'text/html','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
 const server=http.createServer((q,r)=>{const p=path.join(dir,decodeURIComponent(q.url.split('?')[0]));fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});r.end(d);});}).listen(0);
 const port=server.address().port; const b=await chromium.launch();
 let p=await (await b.newContext({viewport:{width:1800,height:1000},deviceScaleFactor:1.5})).newPage();
 await p.goto(`http://127.0.0.1:${port}/sheet.html`); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
 await p.locator('#sheet').screenshot({path:'final/apresentacao.png'});
 p=await (await b.newContext({viewport:{width:1500,height:3000},deviceScaleFactor:1})).newPage();
 await p.goto(`http://127.0.0.1:${port}/logos.html`); await p.waitForTimeout(300);
 for (const [id,n] of [['l1','logo-transparente'],['l2','logo-fundo-escuro-creme'],['l3','logo-fundo-escuro-dourado']])
   await p.locator('#'+id).screenshot({path:`final/${n}.png`,omitBackground:true});
 await b.close(); server.close(); })();
