// Servidor local que imita a Vercel para testar o site: URLs limpas, 404.html e os cabeçalhos do vercel.json.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };

export function iniciarServidor(raiz, porta = 0) {
  const cfg = JSON.parse(fs.readFileSync(path.join(raiz, "vercel.json"), "utf8"));
  const regras = cfg.headers.map((r) => ({ re: new RegExp("^" + r.source.replace(/\(\.\*\)/g, ".*") + "$"), headers: r.headers }));
  const cabecalhos = (url) => Object.fromEntries(regras.filter((r) => r.re.test(url)).flatMap((r) => r.headers.map(({ key, value }) => [key, value])));
  const servidor = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let arq = path.join(raiz, url);
    if (url.endsWith("/")) arq = path.join(arq, "index.html");
    else if (!path.extname(arq) && fs.existsSync(arq + ".html")) arq += ".html";
    const h = cabecalhos(url);
    if (!arq.startsWith(raiz) || arq.includes(`${path.sep}testes${path.sep}`) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404, { ...h, "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(raiz, "404.html")));
    }
    res.writeHead(200, { ...h, "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise((ok) => servidor.listen(porta, "127.0.0.1", () => ok({ servidor, base: `http://127.0.0.1:${servidor.address().port}` })));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  iniciarServidor(raiz, Number(process.argv[2] || 4000)).then(({ base }) => console.log(`site em ${base}`));
}
