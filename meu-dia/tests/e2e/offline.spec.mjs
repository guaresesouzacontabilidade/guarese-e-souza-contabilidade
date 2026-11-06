// O app instalado precisa abrir sem internet, com os dados salvos.
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('abre sem internet depois da primeira visita', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Garante que o service worker já controla a página e o cache está completo.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Bom dia|Boa tarde|Boa noite/);
  await expect(page.locator('.card-hero')).toBeVisible();
  await context.setOffline(false);
});
