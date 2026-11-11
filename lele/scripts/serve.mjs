// Servidor local simples para desenvolvimento e testes (sem dependências).
// LELE_FAKE_CLOUD=1 liga uma "nuvem" de mentira em memória (para testar a sincronização).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4180);
const FAKE = process.env.LELE_FAKE_CLOUD === '1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// Imitação das funções lele_push / lele_pull do Supabase.
const vaults = new Map();
let clock = Date.now();
const vaultOf = (code) => {
  if (!/^[A-HJ-NP-Z2-9]{20}$/.test(code || '')) throw new Error('código de sincronização inválido');
  return createHash('sha256').update(`app-da-lele:${code}`).digest('hex');
};
function fakeRpc(name, body) {
  const v = vaultOf(body.p_code);
  if (!vaults.has(v)) vaults.set(v, new Map());
  const rows = vaults.get(v);
  if (name === 'lele_push') {
    let n = 0;
    for (const r of body.p_rows) {
      const key = `${r.c}:${r.i}`;
      const cur = rows.get(key);
      if (cur && cur.client_updated_at > r.u) continue;
      clock = Math.max(clock + 1, Date.now());
      rows.set(key, { collection: r.c, id: r.i, data: r.x ? {} : r.d, deleted: !!r.x, client_updated_at: r.u, server_updated_at: new Date(clock).toISOString() });
      n++;
    }
    return n;
  }
  if (name === 'lele_pull') {
    const since = body.p_since ? Date.parse(body.p_since) : -Infinity;
    return [...rows.values()]
      .filter((r) => Date.parse(r.server_updated_at) > since)
      .sort((a, b) => Date.parse(a.server_updated_at) - Date.parse(b.server_updated_at))
      .slice(0, body.p_limit || 500);
  }
  throw new Error('função desconhecida');
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (FAKE && p.startsWith('/fake-cloud/rest/v1/rpc/')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        const out = fakeRpc(p.split('/').pop(), JSON.parse(raw || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: err.message }));
      }
      return;
    }
    if (p === '/js/config.js' && process.env.LELE_CONFIG !== 'real') {
      const body = FAKE
        ? `export const SUPABASE_URL = 'http://localhost:${port}/fake-cloud';\nexport const SUPABASE_KEY = 'fake';\n`
        : "export const SUPABASE_URL = '';\nexport const SUPABASE_KEY = '';\n";
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
      res.end(body);
      return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root)) throw new Error('fora da pasta');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('não é arquivo');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }
}).listen(port, () => console.log(`App da Lelé em http://localhost:${port}/${FAKE ? ' (nuvem de teste ligada)' : ''}`));
