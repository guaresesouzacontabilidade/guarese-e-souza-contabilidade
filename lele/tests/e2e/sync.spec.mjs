import { test, expect } from '@playwright/test';
import { start } from './helpers.mjs';

test('sincroniza entre dois aparelhos com o código', async ({ browser, baseURL }) => {
  const a = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const b = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const pa = await a.newPage();
  const pb = await b.newPage();

  // Aparelho A: começa e já liga a sincronização.
  await start(pa);
  await pa.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(pa.getByText(/Sincronizado/)).toBeVisible({ timeout: 10000 });
  await pa.getByRole('button', { name: 'Mostrar' }).click();
  const code = (await pa.locator('.code').textContent()).trim();
  expect(code).toMatch(/^LELE-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);

  // Aparelho B: entra com o código (em minúsculas e sem traços também vale).
  await pb.goto('/');
  await pb.getByRole('button', { name: 'Já uso em outro aparelho' }).click();
  await pb.getByLabel('Código de sincronização').fill(code.toLowerCase().replace(/-/g, ' '));
  await pb.getByRole('button', { name: 'Entrar com o código' }).click();
  await expect(pb.getByRole('button', { name: /Comece por aqui/ })).toBeVisible();
  await expect(pb.locator('.hero__number')).toHaveText('6');

  // B estuda um cartão; A recebe.
  await pb.getByRole('button', { name: 'Estudar agora' }).click();
  await pb.getByRole('button', { name: 'Mostrar resposta' }).click();
  await pb.getByRole('button', { name: /^Fácil/ }).click();
  await pb.getByRole('button', { name: 'Fechar' }).click();
  await pb.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await pb.getByRole('button', { name: /Agora/ }).click();
  await expect(pb.getByText('Tudo salvo na nuvem')).toBeVisible({ timeout: 10000 });

  await pa.getByRole('button', { name: /Agora/ }).click();
  await expect(pa.getByText('Tudo salvo na nuvem')).toBeVisible({ timeout: 10000 });
  await pa.getByRole('button', { name: 'Início', exact: true }).click();
  await expect(pa.locator('.hero__number')).toHaveText('5');

  // Código errado não apaga nada.
  const c = await browser.newContext({ baseURL });
  const pc = await c.newPage();
  await pc.goto('/');
  await pc.getByRole('button', { name: 'Já uso em outro aparelho' }).click();
  await pc.getByLabel('Código de sincronização').fill('LELE-AAAAA-BBBBB-CCCCC-DDDDD');
  await pc.getByRole('button', { name: 'Entrar com o código' }).click();
  await expect(pc.getByRole('alert')).toContainText('Não encontrei dados');
  await pc.getByLabel('Código de sincronização').fill('abc');
  await pc.getByRole('button', { name: 'Entrar com o código' }).click();
  await expect(pc.getByRole('alert')).toContainText('não parece certo');

  await a.close();
  await b.close();
  await c.close();
});
