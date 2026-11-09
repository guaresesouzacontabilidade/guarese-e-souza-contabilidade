// Ajudantes dos testes de ponta a ponta (abrir o app, navegar, preencher valores).
import { expect } from '@playwright/test';

export const NOW = new Date('2026-10-14T10:00:00-03:00'); // quarta-feira

export const money = (s) => s.replace(/ /g, ' ');

export async function start(page, { name = 'Ana' } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.clock.setFixedTime(NOW);
  await page.goto('./');
  await page.getByLabel('Como quer ser chamado? (opcional)', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  return errors;
}

export const isDesktop = (page) => page.viewportSize().width >= 900;

export async function openAdd(page, option) {
  const add = isDesktop(page)
    ? page.locator('.sidebar').getByRole('button', { name: 'Adicionar' })
    : page.getByRole('button', { name: /^Adicionar compromisso, tarefa/ });
  await add.click();
  await page.locator('.add-opt', { hasText: option }).click();
}

export async function goTo(page, label) {
  const nav = isDesktop(page) ? page.locator('.sidebar') : page.locator('.tabbar');
  if (['Relatórios', 'Assistente', 'Ajustes'].includes(label) && !isDesktop(page)) {
    if (label === 'Relatórios') {
      await nav.getByRole('link', { name: 'Finanças' }).click();
      await page.getByRole('button', { name: 'Relatórios' }).click();
    } else {
      await page.locator('.topbar').getByRole('button', { name: label }).click();
    }
    return;
  }
  await nav.getByRole('link', { name: label }).click();
}

export async function typeMoney(page, label, digits) {
  const input = page.getByLabel(label, { exact: true });
  await input.click();
  await input.pressSequentially(digits);
}

export async function addExpense(page, { amount, description }) {
  await openAdd(page, 'Despesa');
  await typeMoney(page, 'Valor', amount);
  await page.getByLabel('Descrição', { exact: true }).fill(description);
  await page.getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

export async function addBill(page, { description, amount, monthly = false }) {
  await openAdd(page, 'Conta');
  await page.getByLabel('Descrição', { exact: true }).fill(description);
  await typeMoney(page, 'Valor', amount);
  if (monthly) await page.getByRole('button', { name: 'Todo mês', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar conta' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

export async function expectNoHorizontalScroll(page) {
  // Compara com a largura real da tela (no celular a "viewport de layout" pode crescer junto com o conteúdo).
  const width = page.viewportSize().width;
  const scroll = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(scroll).toBeLessThanOrEqual(width);
  // A barra de navegação precisa estar inteira na tela.
  const nav = page.locator(width >= 900 ? '.sidebar' : '.tabbar');
  const box = await nav.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
}
