import { expect } from '@playwright/test';

export async function start(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.getByRole('button', { name: /Começar/ }).click();
  await expect(page.getByRole('heading', { name: /Lelé/ })).toBeVisible();
  return errors;
}

// O conteúdo nunca pode ser mais largo que a tela (no celular isso faz a página "encolher").
export async function expectNoHorizontalScroll(page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw);
}

export async function answerAll(page, label = /^Bom/) {
  for (let i = 0; i < 40; i++) {
    const reveal = page.getByRole('button', { name: 'Mostrar resposta' });
    if (!(await reveal.isVisible().catch(() => false))) break;
    await reveal.click();
    await page.getByRole('button', { name: label }).click();
  }
}
