// Gera os ícones PNG a partir de assets/icons/icon.svg usando o Chromium do Playwright.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets/icons');
const svg = await readFile(path.join(dir, 'icon.svg'), 'utf8');
const fullBleed = svg.replace('rx="116"', 'rx="0"');

// Selo monocromático para notificações no Android.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path d="M289.13 379.64 A128 128 0 1 1 379.64 289.13" fill="none" stroke="#fff" stroke-width="52" stroke-linecap="round"/>
  <circle cx="346.5" cy="346.5" r="32" fill="#fff"/>
  <path d="M206 258l34 34 68-72" fill="none" stroke="#fff" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const jobs = [
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'maskable-512.png', size: 512, src: fullBleed },
  { file: 'apple-touch-icon.png', size: 180, src: fullBleed },
  { file: 'badge-96.png', size: 96, src: badge },
];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
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
