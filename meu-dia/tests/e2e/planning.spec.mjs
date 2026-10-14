// Compras parceladas, regras de categoria, limites por categoria e previsão do fim do mês.
import { test, expect } from '@playwright/test';
import { money, start, openAdd, goTo, typeMoney, addExpense, addBill, expectNoHorizontalScroll } from './helpers.mjs';

const toasts = (page) => page.locator('.toast');

test('compra parcelada: 10 parcelas, uma por mês, e excluir todas', async ({ page }) => {
  const errors = await start(page);
  await openAdd(page, 'Despesa');
  await typeMoney(page, 'Valor', '300000');
  await page.getByRole('switch', { name: /Compra parcelada/ }).check();
  await page.getByLabel('Quantas parcelas?', { exact: true }).selectOption('10');
  await page.getByLabel('Descrição', { exact: true }).fill('Geladeira');
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('.split-box')).toContainText('10x de R$');
  await expect(sheet.locator('.split-box')).toContainText('out/2026 a jul/2027');
  await sheet.getByRole('button', { name: 'Ver todas as categorias' }).click();
  await sheet.getByRole('button', { name: 'Compras', exact: true }).click();
  await sheet.getByRole('button', { name: 'Registrar 10 parcelas' }).click();
  await expect(toasts(page).first()).toContainText('Compra parcelada registrada: 10x de R$');

  // O mês só conta a parcela de outubro; as outras aparecem como compromisso futuro.
  await goTo(page, 'Finanças');
  expect(money(await page.locator('.kpi', { hasText: 'Despesas' }).innerText())).toContain('R$ 300,00');
  const card = page.locator('section.card', { hasText: 'Compras parceladas' });
  await expect(card).toContainText('Geladeira');
  await expect(card).toContainText('Faltam 9 de 10');
  expect(money(await card.locator('.kpi').first().innerText())).toContain('R$ 300,00');
  await expectNoHorizontalScroll(page);

  // Detalhe da parcela e exclusão da compra toda.
  await card.locator('.item', { hasText: 'Geladeira' }).click();
  await expect(page.locator('.sheet')).toContainText('Parcela 2 de 10 de uma compra de');
  await page.locator('.sheet').getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Todas as 10 parcelas' }).click();
  await expect(toasts(page).last()).toContainText('10 parcelas excluídas');
  await expect(page.locator('section.card', { hasText: 'Compras parceladas' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('regra de categoria: aprende com a correção e vale para a próxima', async ({ page }) => {
  const errors = await start(page);
  await openAdd(page, 'Despesa');
  await typeMoney(page, 'Valor', '2500');
  await page.getByLabel('Descrição', { exact: true }).fill('Uber centro');
  const sheet = page.locator('.sheet');
  await expect(sheet.getByRole('button', { name: 'Transporte', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Ver todas as categorias' }).click();
  await sheet.getByRole('button', { name: 'Trabalho', exact: true }).click();
  await sheet.getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(toasts(page).first()).toContainText('Daqui pra frente, “uber” vai para Trabalho');

  // Um texto diferente, do jeito que vem no extrato, já sai com a categoria aprendida.
  await openAdd(page, 'Despesa');
  await page.getByLabel('Descrição', { exact: true }).fill('UBER *TRIP 99');
  await expect(page.locator('.sheet').getByRole('button', { name: 'Trabalho', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.sheet').getByRole('button', { name: 'Fechar' }).click();

  // A regra aparece em Ajustes e pode ser apagada.
  await goTo(page, 'Ajustes');
  const rules = page.locator('section.card', { hasText: 'Regras de categoria' });
  await expect(rules).toContainText('“uber”');
  await expect(rules).toContainText('Despesa → Trabalho');
  await rules.getByRole('button', { name: 'Apagar a regra “uber”' }).click();
  await expect(rules).toContainText('Quando você corrigir a categoria');
  expect(errors).toEqual([]);
});

test('limite por categoria: avisa em 80% e ao passar, no Início e no assistente', async ({ page }) => {
  const errors = await start(page);
  await goTo(page, 'Ajustes');
  await page.getByRole('button', { name: /Limites por categoria/ }).click();
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Mercado', exact: true }).click();
  await typeMoney(page, 'Limite mensal de Mercado', '10000');
  await sheet.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(toasts(page).last()).toContainText('Limite de Mercado: R$');
  await expect(sheet.locator('.limit')).toContainText('Mercado');
  await sheet.getByRole('button', { name: 'Fechar' }).click();

  await addExpense(page, { amount: '8500', description: 'Mercado' });
  await expect(toasts(page).last()).toContainText('Atenção: Mercado já usou 85% do limite do mês');
  await goTo(page, 'Início');
  await expect(page.locator('.limit-alerts')).toContainText('Mercado: 85% do limite');

  await addExpense(page, { amount: '2000', description: 'Mercado' });
  await expect(toasts(page).last()).toContainText('Mercado passou do limite do mês');
  await goTo(page, 'Finanças');
  const card = page.locator('section.card', { hasText: 'Limites do mês' });
  expect(money(await card.innerText())).toContain('Passou R$ 5,00');
  await expectNoHorizontalScroll(page);

  await goTo(page, 'Assistente');
  await page.getByLabel('Sua pergunta').fill('Quanto ainda posso gastar com mercado?');
  await page.getByRole('button', { name: 'Enviar pergunta' }).click();
  await expect(page.locator('.msg.bot .answer').last()).toHaveText(/Você passou R\$\s5,00 do limite de Mercado/);
  expect(errors).toEqual([]);
});

test('previsão do fim do mês: saldo mais o que ainda vai entrar e sair', async ({ page }) => {
  const errors = await start(page);
  await openAdd(page, 'Receita');
  await typeMoney(page, 'Valor', '500000');
  await page.getByLabel('Descrição', { exact: true }).fill('Salário');
  await page.getByRole('button', { name: 'Registrar receita' }).click();
  await addBill(page, { description: 'Aluguel', amount: '150000' });

  const box = page.locator('.card-hero .forecast');
  await expect(box).toContainText('Previsão para 31/10');
  expect(money(await box.innerText())).toContain('R$ 3.500,00');
  await box.getByRole('button', { name: /Previsão para/ }).click();
  await expect(box).toContainText('A pagar até 31/10 (1 conta)');
  await expect(box).toContainText('não entram na conta');
  await expectNoHorizontalScroll(page);

  await goTo(page, 'Assistente');
  await page.getByLabel('Sua pergunta').fill('Como vou terminar o mês?');
  await page.getByRole('button', { name: 'Enviar pergunta' }).click();
  await expect(page.locator('.msg.bot .answer').last()).toHaveText(/A previsão é terminar o mês com saldo de R\$\s3\.500,00/);
  expect(errors).toEqual([]);
});

test('importação: corrigir a categoria de uma linha corrige as parecidas e vira regra', async ({ page }, info) => {
  test.skip(info.project.name === 'celular-pequeno', 'a importação já é testada nas outras telas');
  const errors = await start(page);
  await goTo(page, 'Finanças');
  await page.getByRole('button', { name: 'Importar extrato' }).click();
  const csv = 'date,title,amount\n2026-10-02,UBER *TRIP,23.45\n2026-10-05,UBER *TRIP HELP,18.90\n2026-10-06,PADARIA PAO QUENTE,12.00\n';
  await page.locator('.sheet input[type=file]').setInputFiles({ name: 'fatura.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('3 lançamentos encontrados');
  await sheet.getByRole('button', { name: /^Categoria de Uber \*trip: Transporte/ }).click();
  await sheet.locator('.import-cats').getByRole('button', { name: 'Trabalho', exact: true }).click();
  await expect(toasts(page).last()).toContainText('Também mudei 1 linha parecida');
  await expect(sheet.getByRole('button', { name: /^Categoria de Uber \*trip help: Trabalho/ })).toBeVisible();
  await sheet.getByRole('button', { name: 'Importar 3 lançamentos' }).click();
  await expect(page.locator('.sheet')).toContainText('Aprendi com suas correções: “uber” → Trabalho');
  expect(errors).toEqual([]);
});
