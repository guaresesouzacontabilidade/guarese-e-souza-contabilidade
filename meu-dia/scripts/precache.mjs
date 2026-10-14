// Atualiza a lista de arquivos do service worker (sw.js) e a versão do cache.
// `npm run precache` grava; `npm run check` só confere se está atualizado.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = ['index.html', 'manifest.webmanifest', 'css', 'js', 'assets'];

async function walk(rel) {
  const abs = path.join(root, rel);
  const entries = await readdir(abs, { withFileTypes: true }).catch(() => null);
  if (!entries) return [rel];
  const out = [];
  for (const e of entries) out.push(...(await walk(path.join(rel, e.name))));
  return out;
}

export async function runtimeFiles() {
  const files = [];
  for (const r of RUNTIME) files.push(...(await walk(r)));
  return files.map((f) => f.split(path.sep).join('/')).sort();
}

async function build() {
  const files = await runtimeFiles();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(await readFile(path.join(root, f)));
  const version = hash.digest('hex').slice(0, 12);
  const assets = ['./', ...files.map((f) => `./${f}`)];
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  const next = sw
    .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
    .replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = ${JSON.stringify(assets, null, 2).replace(/"/g, "'")};`);
  return { sw, next, version, count: assets.length };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { sw, next, version, count } = await build();
  if (process.argv.includes('--check')) {
    if (sw !== next) {
      console.error('sw.js desatualizado: rode `npm run precache`.');
      process.exit(1);
    }
    console.log(`sw.js em dia (versão ${version}, ${count} arquivos).`);
  } else {
    await writeFile(path.join(root, 'sw.js'), next);
    console.log(`sw.js atualizado (versão ${version}, ${count} arquivos).`);
  }
}
