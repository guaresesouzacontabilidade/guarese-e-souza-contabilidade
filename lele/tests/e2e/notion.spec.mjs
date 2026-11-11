import { test, expect } from '@playwright/test';
import { start } from './helpers.mjs';

test('conecta o Notion e gera um baralho por tópico', async ({ page, context }) => {
  const errors = await start(page);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByText('Conectar com o Notion')).toBeVisible();

  // Autoriza numa janela nova (como no iPhone) e volta.
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup.getByRole('heading', { name: 'Notion conectado! 🎉' })).toBeVisible();
  await expect(popup.getByText('Conectado a “Notion da Lelé”')).toBeVisible();
  await popup.close();
  await expect(page.getByText('Conectado a “Notion da Lelé”')).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /Gerar cartões do Notion/ }).click();
  await page.getByText('Cardiologia', { exact: true }).click();
  await page.getByRole('button', { name: 'Gerar cartões de 1 página' }).click();
  await expect(page.getByText('5 cartões novos em 2 baralhos novos.')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.notion-topic__name').first()).toContainText('Insuficiência cardíaca');
  // Tira um tópico e volta a colocar.
  await page.locator('.notion-topic input').nth(1).uncheck();
  await expect(page.getByText('3 cartões novos em 1 baralho novo.')).toBeVisible();
  await page.locator('.notion-topic input').nth(1).check();
  await page.getByRole('button', { name: 'Criar 5 cartões' }).click();

  await expect(page.getByRole('heading', { name: 'Cardiologia' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Insuficiência cardíaca/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pericardite/ })).toBeVisible();

  // Estuda um cartão do Notion: o tópico aparece no cartão.
  await page.getByRole('button', { name: /Pericardite/ }).click();
  await page.getByRole('button', { name: /Estudar 2 cartões/ }).click();
  await expect(page.locator('.flash__face').first()).toContainText('Pericardite');
  await page.getByRole('button', { name: 'Mostrar resposta' }).click();
  await expect(page.locator('.flash__back')).toContainText('Dose:');
  await page.getByRole('button', { name: 'Fechar' }).click();

  // Atualizar não duplica nada.
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: /Atualizar do Notion/ }).click();
  await expect(page.getByText('Tudo em dia com o Notion.')).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('conecta com a chave de integração interna e importa', async ({ page }) => {
  const errors = await start(page);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: /Usar chave de integração/ }).click();
  const key = page.getByLabel('Chave de integração do Notion');
  await key.fill('ntn_invalida_1234567890123456');
  await page.getByRole('button', { name: 'Conectar', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('não aceitou');
  await key.fill('ntn_boa_12345678901234567890');
  await page.getByRole('button', { name: 'Conectar', exact: true }).last().click();
  await expect(page.getByText('Conectado a “Notion da Lelé”', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Gerar cartões do Notion/ }).click();
  await page.getByText('Farmacologia', { exact: true }).click();
  await page.getByRole('button', { name: 'Gerar cartões de 1 página' }).click();
  await expect(page.getByText('2 cartões novos em 1 baralho novo.')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Criar 2 cartões' }).click();
  await expect(page.getByRole('heading', { name: 'Notion' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Farmacologia/ })).toBeVisible();
  // O 400 é da chave errada de propósito, no começo do teste.
  expect(errors.filter((e) => !e.includes('status of 400'))).toEqual([]);
});
