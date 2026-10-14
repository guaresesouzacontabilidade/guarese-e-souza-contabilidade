// Prepara a pasta dist/ com só os arquivos do app, para empacotar com Capacitor
// (Android/iOS). Veja "Publicar nas lojas" no README.
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runtimeFiles } from './precache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
const files = [...(await runtimeFiles()), 'sw.js'];
for (const f of files) {
  const to = path.join(dist, f);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(path.join(root, f), to);
}
console.log(`dist/ pronto com ${files.length} arquivos. Próximo passo: npx cap sync`);
