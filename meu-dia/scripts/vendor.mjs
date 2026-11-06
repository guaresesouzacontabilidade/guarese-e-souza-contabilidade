// Gera os arquivos de terceiros usados pelo app (sem etapa de build no runtime).
// Rode com `npm run vendor` depois de atualizar as versões no package.json.
import { build } from 'esbuild';
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => path.join(root, 'node_modules', p);

async function bundle(contents, outfile) {
  await build({
    stdin: { contents, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'esm',
    minify: true,
    target: ['es2020', 'safari15'],
    platform: 'browser',
    outfile: path.join(root, outfile),
    legalComments: 'inline',
  });
}

await mkdir(path.join(root, 'js/vendor'), { recursive: true });

await bundle(
  `export { h, render, Fragment, createContext, createRef } from 'preact';
   export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer, useId } from 'preact/hooks';
   import htm from 'htm';
   import { h } from 'preact';
   export const html = htm.bind(h);`,
  'js/vendor/preact.js',
);

await bundle(`export { createClient } from '@supabase/supabase-js';`, 'js/vendor/supabase.js');

// Leitor de PDF (Mozilla pdf.js, licença Apache 2.0) para importar extratos e faturas.
await copyFile(nm('pdfjs-dist/legacy/build/pdf.min.mjs'), path.join(root, 'js/vendor/pdf.min.mjs'));
await copyFile(nm('pdfjs-dist/legacy/build/pdf.worker.min.mjs'), path.join(root, 'js/vendor/pdf.worker.min.mjs'));

// Fontes variáveis (subconjunto latino, cobre português).
await mkdir(path.join(root, 'assets/fonts'), { recursive: true });
await copyFile(nm('@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'), path.join(root, 'assets/fonts/manrope.woff2'));
await copyFile(nm('@fontsource-variable/sora/files/sora-latin-wght-normal.woff2'), path.join(root, 'assets/fonts/sora.woff2'));

// Ícones (Lucide, licença ISC): só o conteúdo interno de cada SVG.
const ICONS = [
  'house', 'calendar', 'calendar-days', 'calendar-check', 'calendar-clock', 'wallet', 'receipt', 'receipt-text', 'plus',
  'sparkles', 'settings', 'search', 'x', 'check', 'chevron-left', 'chevron-right', 'chevron-down', 'chevron-up', 'eye',
  'eye-off', 'clock', 'map-pin', 'bell', 'bell-off', 'repeat', 'trash-2', 'pencil', 'arrow-up-right', 'arrow-down-left',
  'trending-up', 'trending-down', 'credit-card', 'landmark', 'banknote', 'piggy-bank', 'circle', 'circle-check',
  'triangle-alert', 'info', 'sun', 'moon', 'monitor', 'download', 'upload', 'log-in', 'log-out', 'user', 'cloud',
  'cloud-off', 'refresh-cw', 'send', 'chart-column', 'chart-pie', 'list-filter', 'ellipsis', 'smartphone', 'share',
  'square-plus', 'flag', 'tag', 'notebook-pen', 'arrow-left', 'arrow-right', 'lock', 'mail', 'key-round', 'shield-check',
  'history', 'target', 'utensils', 'shopping-cart', 'fuel', 'car', 'heart-pulse', 'graduation-cap', 'ticket',
  'shopping-bag', 'tv', 'briefcase', 'paw-print', 'circle-ellipsis', 'briefcase-business', 'store', 'undo-2', 'gift',
  'users', 'book-open', 'list-checks', 'hand-coins', 'message-circle', 'circle-help', 'rotate-ccw', 'file-down',
  'file-up', 'database', 'house-plug', 'mic', 'scan-barcode', 'fingerprint', 'copy', 'lock-keyhole', 'archive-restore',
  'calendar-range', 'wand-sparkles', 'gauge', 'sunrise', 'sunset', 'zap',
];
const out = {};
for (const name of ICONS) {
  const svg = await readFile(nm(`lucide-static/icons/${name}.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  out[name] = inner.replace(/\s*\n\s*/g, '').replace(/\s+\/>/g, '/>').trim();
}
await writeFile(
  path.join(root, 'js/vendor/icons.js'),
  `// Gerado por scripts/vendor.mjs — ícones Lucide (https://lucide.dev), licença ISC.\nexport const ICONS = ${JSON.stringify(out, null, 0)};\n`,
);

console.log('Vendor atualizado.');
