// Testes de ponta a ponta: as tarefas principais precisam ser fáceis e corretas
// em telas pequenas e grandes.
import { test, expect } from '@playwright/test';

const NOW = new Date('2026-10-14T10:00:00-03:00'); // quarta-feira

const money = (s) => s.replace(/ /g, ' ');

async function start(page, { name = 'Ana' } = {}) {
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

const isDesktop = (page) => page.viewportSize().width >= 900;

async function openAdd(page, option) {
  const add = isDesktop(page)
    ? page.locator('.sidebar').getByRole('button', { name: 'Adicionar' })
    : page.getByRole('button', { name: /^Adicionar compromisso, tarefa/ });
  await add.click();
  await page.locator('.add-opt', { hasText: option }).click();
}

async function goTo(page, label) {
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

async function typeMoney(page, label, digits) {
  const input = page.getByLabel(label, { exact: true });
  await input.click();
  await input.pressSequentially(digits);
}

async function addExpense(page, { amount, description }) {
  await openAdd(page, 'Despesa');
  await typeMoney(page, 'Valor', amount);
  await page.getByLabel('Descrição', { exact: true }).fill(description);
  await page.getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

async function addBill(page, { description, amount, monthly = false }) {
  await openAdd(page, 'Conta');
  await page.getByLabel('Descrição', { exact: true }).fill(description);
  await typeMoney(page, 'Valor', amount);
  if (monthly) await page.getByRole('button', { name: 'Todo mês', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar conta' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

async function expectNoHorizontalScroll(page) {
  // Compara com a largura real da tela (no celular a "viewport de layout" pode crescer junto com o conteúdo).
  const width = page.viewportSize().width;
  const scroll = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(scroll).toBeLessThanOrEqual(width);
  // A barra de navegação precisa estar inteira na tela.
  const nav = page.locator(width >= 900 ? '.sidebar' : '.tabbar');
  const box = await nav.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
}

test('criar compromisso em poucos toques e vê-lo em Hoje e na Agenda', async ({ page }) => {
  const errors = await start(page);
  await openAdd(page, 'Compromisso');
  await page.getByLabel('O que é?', { exact: true }).fill('Dentista');
  await page.getByLabel('Horário (opcional)', { exact: true }).fill('15:30');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Compromisso salvo para hoje');

  const today = page.locator('section.card', { hasText: 'Hoje' }).first();
  await expect(today).toContainText('Dentista');
  await expect(today).toContainText('15:30');

  await goTo(page, 'Agenda');
  await expect(page.locator('.day-nav-title')).toContainText('Hoje');
  await expect(page.locator('.card').first()).toContainText('Dentista');

  // Semana e mês mostram o mesmo compromisso.
  await page.getByRole('tab', { name: 'Semana' }).click();
  await expect(page.locator('.week-list')).toContainText('Dentista');
  await page.getByRole('tab', { name: 'Mês' }).click();
  await expect(page.locator('.month-cell.is-selected .mark')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('tarefa: concluir com um toque e desfazer', async ({ page }) => {
  await start(page);
  await openAdd(page, 'Tarefa');
  await page.getByLabel('O que precisa fazer?', { exact: true }).fill('Ligar para o banco');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const check = page.getByRole('checkbox', { name: 'Concluir “Ligar para o banco”' });
  await check.click();
  await expect(page.getByRole('checkbox', { name: 'Desmarcar “Ligar para o banco”' })).toHaveAttribute('aria-checked', 'true');
  await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.getByRole('checkbox', { name: 'Concluir “Ligar para o banco”' })).toHaveAttribute('aria-checked', 'false');
});

test('registrar despesa e ver o resumo do mês atualizado', async ({ page }) => {
  const errors = await start(page);
  await addExpense(page, { amount: '4590', description: 'Gasolina' });
  await expect(page.locator('.toast').first()).toContainText('Despesa de R$');

  const month = page.locator('.card-hero');
  await expect(month).toContainText('Finanças de outubro');
  expect(money(await month.locator('.hero-value').innerText())).toBe('-R$ 45,90');
  expect(money(await month.locator('.flow-item.out').innerText())).toContain('R$ 45,90');

  await goTo(page, 'Finanças');
  await expect(page.locator('.month-nav-title')).toHaveText('outubro de 2026');
  const row = page.locator('.item', { hasText: 'Gasolina' });
  await expect(row).toContainText('Combustível'); // categoria sugerida automaticamente
  expect(money(await row.locator('.item-end').innerText())).toBe('-R$ 45,90');
  expect(money(await page.locator('.kpi', { hasText: 'Despesas' }).innerText())).toContain('R$ 45,90');
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('editar e excluir lançamento pede confirmação e permite desfazer', async ({ page }) => {
  await start(page);
  await addExpense(page, { amount: '1000', description: 'Padaria' });
  await goTo(page, 'Finanças');
  await page.locator('.item', { hasText: 'Padaria' }).click();
  await page.getByRole('button', { name: 'Editar' }).click();
  const value = page.getByLabel('Valor', { exact: true });
  await value.click();
  await value.press('End');
  await value.press('Backspace');
  await value.press('Backspace');
  await value.press('Backspace');
  await value.press('Backspace');
  await value.pressSequentially('1250');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  expect(money(await page.locator('.item', { hasText: 'Padaria' }).locator('.item-end').innerText())).toBe('-R$ 12,50');

  await page.locator('.item', { hasText: 'Padaria' }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Excluir “Padaria”?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.locator('.item', { hasText: 'Padaria' })).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('.item', { hasText: 'Padaria' })).toHaveCount(1);
});

test('marcar conta como paga com um toque e registrar em Finanças sem duplicar', async ({ page }) => {
  const errors = await start(page);
  await addBill(page, { description: 'Luz', amount: '18000', monthly: true });
  await goTo(page, 'Contas');
  await expect(page.locator('section.card', { hasText: 'Vencem em breve' })).toContainText('Luz');

  await page.getByRole('button', { name: 'Marcar como paga: Luz' }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Luz marcada como paga');
  await expect(sheet).toContainText('Próxima já agendada para 14 nov');
  await sheet.getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(page.locator('.toast').last()).toContainText('registrada em Finanças');

  // A próxima conta do mês seguinte aparece e a paga sai das pendentes.
  await expect(page.locator('section.card', { hasText: 'Próximas' })).toContainText('Luz');
  await expect(page.locator('section.card', { hasText: 'Pagas' })).toContainText('Pagas · 1');

  await goTo(page, 'Finanças');
  await expect(page.locator('.item', { hasText: 'Luz' })).toHaveCount(1);
  expect(money(await page.locator('.kpi', { hasText: 'Despesas' }).innerText())).toContain('R$ 180,00');
  expect(errors).toEqual([]);
});

test('ao pagar, reaproveita lançamento parecido em vez de duplicar', async ({ page }) => {
  await start(page);
  await addExpense(page, { amount: '10000', description: 'Internet' });
  await addBill(page, { description: 'Internet', amount: '10000' });
  await goTo(page, 'Contas');
  await page.getByRole('button', { name: 'Marcar como paga: Internet' }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Encontramos um lançamento parecido');
  await sheet.getByRole('button', { name: 'Usar lançamento existente' }).click();
  await expect(page.locator('.toast').last()).toContainText('Nada foi duplicado');
  await goTo(page, 'Finanças');
  await expect(page.locator('.item', { hasText: 'Internet' })).toHaveCount(1);
});

test('conta semanal: o pagamento da semana seguinte não reaproveita o lançamento da anterior', async ({ page }) => {
  await start(page);
  await openAdd(page, 'Conta');
  await page.getByLabel('Descrição', { exact: true }).fill('Diarista');
  await typeMoney(page, 'Valor', '15000');
  await page.getByRole('button', { name: 'Toda semana', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar conta' }).click();
  await goTo(page, 'Contas');
  await page.getByRole('button', { name: 'Marcar como paga: Diarista' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  // A próxima (semana que vem) também é paga hoje: deve criar um lançamento novo.
  await page.getByRole('button', { name: 'Marcar como paga: Diarista' }).click();
  await expect(page.locator('.sheet')).not.toContainText('Encontramos um lançamento parecido');
  await page.locator('.sheet').getByRole('button', { name: 'Registrar despesa' }).click();
  await goTo(page, 'Finanças');
  await expect(page.locator('.item', { hasText: 'Diarista' })).toHaveCount(2);
});

test('aviso de lançamento repetido ao registrar a mesma despesa', async ({ page }) => {
  await start(page);
  await addExpense(page, { amount: '5000', description: 'Mercado' });
  await openAdd(page, 'Despesa');
  await typeMoney(page, 'Valor', '5000');
  await page.getByLabel('Descrição', { exact: true }).fill('Mercado');
  await page.getByRole('button', { name: 'Registrar despesa' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Parece repetido');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Voltar' }).click();
  await expect(page.locator('.sheet')).toHaveCount(1);
});

test('assistente responde as perguntas principais mostrando o cálculo', async ({ page }) => {
  const errors = await start(page);
  await addExpense(page, { amount: '20000', description: 'Gasolina' });
  await addExpense(page, { amount: '150000', description: 'Aluguel' });
  await addBill(page, { description: 'Escola', amount: '70000' });

  await goTo(page, 'Ajustes');
  await page.getByRole('button', { name: /Não definido/ }).click();
  await typeMoney(page, 'Limite de gastos por mês', '300000');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();

  await goTo(page, 'Assistente');
  const ask = async (q) => {
    await page.getByLabel('Sua pergunta').fill(q);
    await page.getByRole('button', { name: 'Enviar pergunta' }).click();
    return page.locator('.msg.bot .answer').last();
  };
  await expect(await ask('Quanto gastei este mês?')).toHaveText(/Este mês você gastou R\$\s1\.700,00\./);
  await expect(await ask('Quanto gastei com combustível?')).toHaveText(/R\$\s200,00 com Combustível/);
  await expect(await ask('Quais contas vencem esta semana?')).toHaveText(/1 conta a pagar, somando R\$\s700,00/);
  await expect(await ask('Quanto ainda tenho no orçamento?')).toHaveText(/Você ainda tem R\$\s1\.300,00 no orçamento/);
  await expect(await ask('Qual foi meu maior gasto?')).toHaveText(/“Aluguel”: R\$\s1\.500,00/);

  // "Como calculei" mostra os lançamentos usados.
  const how = page.locator('.msg.bot').last().locator('details.how');
  await how.locator('summary').click();
  await expect(how).toContainText('Comparei 2 despesas');
  await expect(await ask('Faça um pix de 100 reais')).toHaveText(/não faço pagamentos/);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('dados continuam salvos depois de fechar e abrir o app', async ({ page }) => {
  await start(page, { name: 'Bia' });
  await addExpense(page, { amount: '3300', description: 'Farmácia' });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bia');
  expect(money(await page.locator('.card-hero .flow-item.out').innerText())).toContain('R$ 33,00');
});

test('ocultar valores com um toque', async ({ page }) => {
  await start(page);
  await addExpense(page, { amount: '3300', description: 'Farmácia' });
  await page.getByRole('button', { name: 'Ocultar valores' }).click();
  await expect(page.locator('.card-hero .hero-value')).toHaveText('R$ •••••');
  await page.getByRole('button', { name: 'Mostrar valores' }).click();
  expect(money(await page.locator('.card-hero .hero-value').innerText())).toBe('-R$ 33,00');
});

test('relatórios: período, categorias e comparação em frases', async ({ page }) => {
  await start(page);
  await addExpense(page, { amount: '20000', description: 'Gasolina' });
  await goTo(page, 'Relatórios');
  await expect(page.locator('.page-sub')).toHaveText('Outubro de 2026');
  await expect(page.locator('.bars')).toContainText('Combustível');
  await expect(page.locator('.sentences')).toContainText('As despesas passaram as receitas em R$');
  await page.getByRole('button', { name: 'Este ano', exact: true }).click();
  await expect(page.locator('.page-sub')).toHaveText('Ano de 2026');
  await page.getByRole('button', { name: 'Ver tabela' }).click();
  await expect(page.locator('table.table')).toContainText('outubro');
  await expectNoHorizontalScroll(page);
});

test('voltar do navegador/Android fecha o painel em vez de sair da tela', async ({ page }) => {
  await start(page);
  await openAdd(page, 'Despesa');
  await expect(page.locator('.sheet')).toHaveCount(1);
  await page.goBack();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ana');
});

test('painéis e confirmações mantêm o histórico certo', async ({ page }) => {
  await start(page);
  const hash = await page.evaluate(() => location.hash);
  // Fecha um painel e abre outro no mesmo instante: o "voltar" deve fechar o novo.
  await page.evaluate(async () => {
    const ui = await import('./js/ui/state.js');
    const { html } = await import('./js/vendor/preact.js');
    ui.openSheet(() => html`<p>Painel A</p>`);
    await new Promise((r) => setTimeout(r, 50));
    ui.closeLayer();
    ui.openSheet(() => html`<p>Painel B</p>`);
  });
  await expect(page.locator('.sheet')).toContainText('Painel B');
  await page.waitForTimeout(150);
  await page.goBack();
  await expect(page.locator('.sheet')).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe(hash);

  // Excluir com confirmação dentro de um painel e depois usar "voltar" normalmente.
  await addExpense(page, { amount: '1000', description: 'Pão' });
  await goTo(page, 'Finanças');
  await page.locator('.item', { hasText: 'Pão' }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.locator('.sheet, .dialog')).toHaveCount(0);
  await page.waitForTimeout(150);
  await expect(page).toHaveURL(/#\/financas/);
  await openAdd(page, 'Tarefa');
  await page.goBack();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/financas/);
});

test('tema escuro e claro', async ({ page }) => {
  await start(page);
  await goTo(page, 'Ajustes');
  await page.getByRole('radio', { name: 'Escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('nenhuma tela tem rolagem lateral', async ({ page }) => {
  await start(page);
  await addExpense(page, { amount: '123456789', description: 'Um lançamento com descrição bem comprida para testar quebra' });
  await addBill(page, { description: 'Conta com nome comprido de verdade', amount: '99999999' });
  for (const hash of ['#/', '#/agenda', '#/agenda?modo=semana', '#/agenda?modo=mes', '#/financas', '#/contas', '#/relatorios', '#/assistente', '#/ajustes']) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForTimeout(150);
    await expectNoHorizontalScroll(page);
  }
});
