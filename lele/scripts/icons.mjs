// Gera os ícones PNG a partir de assets/icons/icon.svg usando o Chromium do Playwright.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets/icons');
const svg = await readFile(path.join(dir, 'icon.svg'), 'utf8');
// iPhone e "maskable" recortam o ícone sozinhos: o fundo precisa ir até a borda.
const fullBleed = svg.replace('rx="116"', 'rx="0"');

const jobs = [
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'maskable-512.png', size: 512, src: fullBleed },
  { file: 'apple-touch-icon.png', size: 180, src: fullBleed },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const job of jobs) {
  await page.setViewportSize({ width: job.size, height: job.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img style="display:block;width:${job.size}px;height:${job.size}px" src="data:image/svg+xml;base64,${Buffer.from(job.src).toString('base64')}"></body></html>`,
  );
  await page.waitForTimeout(50);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: job.size, height: job.size } });
  await writeFile(path.join(dir, job.file), png);
  console.log('ok', job.file);
}
await browser.close();
