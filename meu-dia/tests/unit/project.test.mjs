// Verificações do projeto: o modo offline (service worker) precisa listar todos os arquivos do app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runtimeFiles } from '../../scripts/precache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('sw.js lista exatamente os arquivos do app (rode `npm run precache` se falhar)', async () => {
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  const listed = JSON.parse(sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  const expected = ['./', ...(await runtimeFiles()).map((f) => `./${f}`)];
  assert.deepEqual(listed, expected);
  for (const f of listed.slice(1)) await access(path.join(root, f));
});

test('todos os imports relativos apontam para arquivos existentes', async () => {
  const files = (await runtimeFiles()).filter((f) => f.endsWith('.js') && !f.includes('/vendor/'));
  for (const f of files) {
    const src = await readFile(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+'(\.[^']+)'|import\('(\.[^']+)'\)/g)) {
      const rel = m[1] || m[2];
      await access(path.resolve(path.dirname(path.join(root, f)), rel)).catch(() => assert.fail(`${f} importa ${rel}, que não existe`));
    }
  }
});

test('manifesto do PWA tem ícones e textos em português', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.lang, 'pt-BR');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) await access(path.join(root, icon.src));
});
