import { test, expect } from '@playwright/test';
import { start, expectNoHorizontalScroll, answerAll } from './helpers.mjs';

test('boas-vindas cria o baralho inicial e estuda até o fim', async ({ page }) => {
  const errors = await start(page);
  await expect(page.locator('.hero__number')).toHaveText('6');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Estudar agora' }).click();
  await expect(page.getByText('Oi, Lelé! Como funciona este app?').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar resposta' }).click();
  // Botões mostram quando o cartão volta.
  await expect(page.getByRole('button', { name: /Errei, volta em 1 min/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Fácil, volta em 4 dias/ })).toBeVisible();
  await page.getByRole('button', { name: /^Fácil/ }).click();
  await answerAll(page, /^Fácil/);
  await expect(page.getByRole('heading', { name: 'Revisão concluída!' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar ao início' }).click();
  await expect(page.getByText('Tudo em dia!')).toBeVisible();
  // Sequência e cartões de hoje.
  await expect(page.locator('.stat').first()).toContainText('1');
  expect(errors).toEqual([]);
});

test('errar faz o cartão voltar na mesma sessão e desfazer funciona', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Estudar agora' }).click();
  const counts = page.locator('.study__counts');
  await page.getByRole('button', { name: 'Mostrar resposta' }).click();
  await page.getByRole('button', { name: /^Errei/ }).click();
  await expect(counts).toContainText('5');
  // aprendendo = 1
  await expect(counts.locator('span').nth(1)).toHaveText('1');
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(counts.locator('span').nth(0)).toHaveText('6');
  await expect(counts.locator('span').nth(1)).toHaveText('0');
});

test('criar baralho e cartão de lacunas, e estudar as lacunas', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /Novo$/ }).first().click();
  await page.getByPlaceholder('Ex.: Cardiologia').fill('Cardiologia');
  await page.getByPlaceholder('Ex.: Clínica Médica').fill('Clínica Médica');
  await page.getByRole('button', { name: '🫀' }).click();
  await page.getByRole('button', { name: 'Criar baralho' }).click();
  await expect(page.getByRole('heading', { name: 'Clínica Médica' })).toBeVisible();
  await page.getByRole('button', { name: /Cardiologia/ }).click();
  await expect(page.getByRole('heading', { name: 'Cardiologia' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Novo cartão' }).click();
  await page.getByRole('button', { name: 'Lacunas', exact: true }).click();
  const text = page.getByLabel('Texto com lacunas');
  await text.fill('Tríade de Beck: hipotensão, turgência jugular e {{bulhas abafadas}}');
  await text.evaluate((el) => el.setSelectionRange(16, 26)); // "hipotensão"
  await page.getByRole('button', { name: 'Ocultar', exact: true }).click();
  await expect(text).toHaveValue('Tríade de Beck: {{c1::hipotensão}}, turgência jugular e {{bulhas abafadas}}');
  await page.getByRole('button', { name: 'Ver' }).click();
  await expect(page.locator('.preview .cloze').first()).toHaveText('[…]');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('2 cartões criados')).toBeVisible();
  await expect(page.locator('.note')).toHaveCount(1);
  await expect(page.locator('.note__sub')).toHaveText('2 lacunas');

  await page.getByRole('button', { name: /Estudar 2 cartões/ }).click();
  await expect(page.locator('.flash__face').first().locator('.cloze')).toHaveText('[…]');
  await page.getByRole('button', { name: 'Mostrar resposta' }).click();
  await expect(page.locator('.flash__back .cloze.is-revealed')).toHaveText('hipotensão');
});

test('importar lista com ponto e vírgula e lacunas', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /Importar/ }).first().click();
  await page.getByRole('combobox').first().selectOption('__new');
  await page.getByPlaceholder('Ex.: Farmacologia').fill('Farmaco');
  await page
    .getByLabel('Texto para importar')
    .fill('Antídoto do paracetamol ; N-acetilcisteína\nAntídoto da heparina ; Protamina\nO {{c1::nervo frênico}} inerva o {{c2::diafragma}}\nlinha sem resposta');
  await expect(page.getByText('3 cartões encontrados (1 de lacunas).')).toBeVisible();
  await page.getByRole('button', { name: 'Importar 3 cartões' }).click();
  await expect(page.getByRole('heading', { name: 'Farmaco' })).toBeVisible();
  await expect(page.locator('.note')).toHaveCount(3);
  await expect(page.locator('.study-card__n').first()).toHaveText('4');
});

test('editar, pausar e apagar cartão', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /Comece por aqui/ }).click();
  await page.getByRole('button', { name: /Qual o segredo/ }).click();
  await page.getByLabel('Frente').fill('Qual o segredo da constância?');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('button', { name: /segredo da constância/ })).toBeVisible();
  await page.getByRole('button', { name: /segredo da constância/ }).click();
  await page.getByRole('button', { name: 'Pausar cartão' }).click();
  await page.getByRole('button', { name: 'Pausados' }).click();
  await expect(page.locator('.note')).toHaveCount(1);
  await page.locator('.note').click();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Apagar' }).click();
  await expect(page.getByText('Cartão apagado')).toBeVisible();
  await page.getByRole('button', { name: 'Todos' }).click();
  await expect(page.locator('.note')).toHaveCount(5);
});

test('treino livre não mexe na agenda', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /Comece por aqui/ }).click();
  await page.getByRole('button', { name: 'Treino livre' }).click();
  await page.getByRole('button', { name: 'Mostrar resposta' }).click();
  await page.getByRole('button', { name: /^Errei/ }).click();
  await answerAll(page, /^Acertei/);
  await expect(page.getByRole('heading', { name: 'Treino concluído!' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar ao início' }).click();
  await expect(page.locator('.hero__number')).toHaveText('6');
});

test('progresso e ajustes abrem sem erros e o tema escuro aplica', async ({ page }) => {
  const errors = await start(page);
  await page.getByRole('button', { name: 'Progresso' }).click();
  await expect(page.getByText('Calendário')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByText('Cartões novos por dia')).toBeVisible();
  await page.getByRole('button', { name: 'Escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Aumentar' }).click();
  await expect(page.locator('.stepper output')).toHaveText('25');
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('os dados continuam depois de recarregar', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Estudar agora' }).click();
  await page.getByRole('button', { name: 'Mostrar resposta' }).click();
  await page.getByRole('button', { name: /^Fácil/ }).click();
  await page.waitForTimeout(600);
  await page.goto('/#/');
  await page.reload();
  await expect(page.locator('.hero__number')).toHaveText('5');
});
