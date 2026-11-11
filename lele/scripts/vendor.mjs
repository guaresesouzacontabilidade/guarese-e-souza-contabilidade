// Gera os arquivos de terceiros usados pelo app (sem etapa de build no runtime).
// Rode com `npm run vendor` depois de atualizar as versões no package.json.
import { build } from 'esbuild';
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => path.join(root, 'node_modules', p);

await mkdir(path.join(root, 'js/vendor'), { recursive: true });
await build({
  stdin: {
    contents: `export { h, render, Fragment, createContext, createRef } from 'preact';
      export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer, useId } from 'preact/hooks';
      import htm from 'htm';
      import { h } from 'preact';
      export const html = htm.bind(h);`,
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2020', 'safari15'],
  platform: 'browser',
  outfile: path.join(root, 'js/vendor/preact.js'),
  legalComments: 'inline',
});

// Fontes variáveis (subconjunto latino, cobre português). Licença OFL.
await mkdir(path.join(root, 'assets/fonts'), { recursive: true });
const fonts = {
  'fraunces.woff2': '@fontsource-variable/fraunces/files/fraunces-latin-soft-normal.woff2',
  'fraunces-italic.woff2': '@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2',
  'nunito.woff2': '@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2',
};
for (const [out, src] of Object.entries(fonts)) await copyFile(nm(src), path.join(root, 'assets/fonts', out));

// Ícones (Lucide, licença ISC): só o conteúdo interno de cada SVG.
const ICONS = [
  'house', 'chart-column', 'settings', 'plus', 'search', 'x', 'check', 'chevron-left', 'chevron-right', 'chevron-down',
  'ellipsis', 'pencil', 'trash-2', 'undo-2', 'rotate-ccw', 'eye', 'eye-off', 'image', 'image-plus', 'layers', 'library',
  'book-open', 'flame', 'sparkles', 'heart', 'cloud', 'cloud-off', 'refresh-cw', 'copy', 'download', 'upload', 'file-up',
  'sun', 'moon', 'monitor', 'volume-2', 'volume-x', 'info', 'triangle-alert', 'circle-check', 'clipboard-paste', 'zap',
  'timer', 'shuffle', 'play', 'folder', 'tag', 'wand-sparkles', 'list', 'mail', 'gift', 'smartphone', 'share',
  'square-plus', 'link', 'key-round', 'log-out', 'graduation-cap', 'stethoscope', 'brain', 'target', 'calendar', 'clock',
  'arrow-right', 'star', 'bookmark', 'heart-pulse', 'bold', 'highlighter', 'mail-open', 'party-popper', 'square-dashed-text',
  'trophy', 'calendar-clock', 'funnel', 'text-cursor-input',
];
const out = {};
for (const name of ICONS) {
  const svg = await readFile(nm(`lucide-static/icons/${name}.svg`), 'utf8');
  out[name] = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s*\n\s*/g, '')
    .replace(/ \/>/g, '/>')
    .trim();
}
await writeFile(
  path.join(root, 'js/vendor/icons.js'),
  `// Gerado por scripts/vendor.mjs — ícones Lucide (https://lucide.dev), licença ISC.\nexport const ICONS = ${JSON.stringify(out)};\n`,
);
console.log('vendor ok:', Object.keys(out).length, 'ícones');
