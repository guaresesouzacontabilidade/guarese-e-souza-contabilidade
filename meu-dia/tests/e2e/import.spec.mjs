// Importar extrato e fatura em PDF (arquivos de exemplo com dados fictícios).
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const money = (s) => s.replace(/ /g, ' ');

async function start(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-14T10:00:00-03:00'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
  return errors;
}

async function openImport(page) {
  await page.evaluate(() => (location.hash = '#/financas'));
  await page.getByRole('button', { name: 'Importar extrato' }).click();
}

test('importa extrato em PDF e mostra o que entrou e saiu', async ({ page }, info) => {
  test.skip(info.project.name === 'celular-pequeno', 'coberto pelos outros tamanhos');
  const errors = await start(page);
  await openImport(page);
  await page.locator('.sheet input[type=file]').setInputFiles(path.join(fixtures, 'extrato-exemplo.pdf'));
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('6 lançamentos encontrados', { timeout: 15000 });
  await expect(page.getByRole('tab', { name: 'Extrato da conta' })).toHaveAttribute('aria-selected', 'true');
  const summary = sheet.locator('.import-summary');
  expect(money(await summary.innerText())).toContain('R$ 5.300,00'); // entrou: salário + pix
  expect(money(await summary.innerText())).toContain('R$ 605,80'); // saiu
  await sheet.getByRole('button', { name: /^Importar 6 lançamentos/ }).click();
  await expect(sheet).toContainText('Pronto!');
  await expect(sheet).toContainText('Onde mais saiu');
  await sheet.getByRole('button', { name: 'Ver relatório do período' }).click();
  await expect(page).toHaveURL(/#\/relatorios\?periodo=custom&de=2026-10-02&ate=2026-10-10/);
  await expect(page.locator('.kpi', { hasText: 'Receitas' })).toContainText('5.300,00');

  // Importar o mesmo arquivo de novo não duplica.
  await openImport(page);
  await page.locator('.sheet input[type=file]').setInputFiles(path.join(fixtures, 'extrato-exemplo.pdf'));
  await expect(sheet).toContainText('Já importado', { timeout: 15000 });
  await expect(sheet.getByRole('button', { name: 'Nada selecionado' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('fatura com senha: pede a senha, ignora o pagamento da fatura', async ({ page }, info) => {
  test.skip(info.project.name === 'celular-pequeno', 'coberto pelos outros tamanhos');
  await start(page);
  await openImport(page);
  await page.locator('.sheet input[type=file]').setInputFiles(path.join(fixtures, 'fatura-com-senha.pdf'));
  await page.getByLabel('Senha do PDF', { exact: true }).fill('00000');
  await page.getByRole('button', { name: 'Abrir' }).click();
  await expect(page.locator('.sheet')).toContainText('Senha incorreta', { timeout: 15000 });
  await page.getByLabel('Senha do PDF', { exact: true }).fill('12345');
  await page.getByRole('button', { name: 'Abrir' }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('5 lançamentos encontrados', { timeout: 15000 });
  await expect(page.getByRole('tab', { name: 'Fatura do cartão' })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.locator('.import-row', { hasText: 'Pagamento recebido' })).toContainText('não conta');
  expect(money(await sheet.locator('.import-summary').innerText())).toContain('R$ 325,25');
  await sheet.getByRole('button', { name: /^Importar 4 lançamentos/ }).click();
  await expect(sheet).toContainText('Pronto!');
});
