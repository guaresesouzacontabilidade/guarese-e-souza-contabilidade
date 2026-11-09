// Gestos e atalhos: arrastar linhas, fechar painel arrastando, número na aba Contas e "registrar de novo".
import { test, expect } from '@playwright/test';
import { start, goTo } from './helpers.mjs';

// Arrasta com o "dedo" (ponteiro) a partir do centro do elemento.
async function drag(page, locator, dx, dy = 0) {
  // Espera a troca de tela terminar (durante a animação a página não recebe toques).
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-navigating'));
  // Traz o elemento para o meio da tela (longe da barra de abas) antes de arrastar.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = await locator.boundingBox();
  const x = b.x + Math.min(b.width / 2, 120);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
  await page.mouse.up();
}

async function seed(page, fn) {
  await page.evaluate(fn);
}

test.describe('gestos', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'android', 'roda uma vez, no perfil Android');
  });

  test('arrastar: conta para pagar, tarefa para concluir, lançamento para excluir', async ({ page }) => {
    const errors = await start(page);
    await seed(page, async () => {
      const s = await import('./js/data/store.js');
      s.create('bills', { kind: 'pay', description: 'Internet', amount: 12000, dueDate: '2026-10-14', status: 'open', repeat: 'none', remind: [] });
      s.create('events', { kind: 'task', title: 'Renovar CNH', date: '2026-10-14', done: false, doneDates: [], skipDates: [], repeat: 'none' });
      s.create('transactions', { type: 'expense', amount: 4500, description: 'Farmácia', date: '2026-10-14', category: 'saude' });
    });

    // Número na aba Contas: 1 conta vence hoje.
    const contasTab = page.locator('.tabbar .tab', { hasText: 'Contas' });
    await expect(contasTab.locator('.tab-badge')).toHaveText('1');
    await expect(page.getByRole('link', { name: 'Contas (1 conta para hoje ou vencida)' })).toBeVisible();

    // Arrastar pouco não faz nada (nem abre o detalhe).
    await goTo(page, 'Finanças');
    await expect(page.locator('.swipe-hint')).toBeVisible();
    const row = page.locator('.swipe', { hasText: 'Farmácia' });
    await drag(page, row, -40);
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(row).toBeVisible();

    // Arrastar para a esquerda exclui, com "Desfazer".
    await drag(page, row, -170);
    await expect(page.locator('.toast').last()).toContainText('Lançamento excluído');
    await expect(page.locator('.swipe', { hasText: 'Farmácia' })).toHaveCount(0);
    await page.locator('.toast').last().getByRole('button', { name: 'Desfazer' }).click();
    await expect(page.locator('.swipe', { hasText: 'Farmácia' })).toHaveCount(1);
    // Depois de usar o gesto, a dica some.
    await expect(page.locator('.swipe-hint')).toHaveCount(0);

    // Tarefa: arrastar para a direita conclui.
    await goTo(page, 'Início');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ana');
    await drag(page, page.locator('.swipe', { hasText: 'Renovar CNH' }), 160);
    await expect(page.locator('.toast').last()).toContainText('Tarefa concluída');
    await expect(page.getByRole('checkbox', { name: /Desmarcar “Renovar CNH”/ })).toBeVisible();

    // Conta: arrastar para a direita paga.
    await goTo(page, 'Contas');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contas');
    await drag(page, page.locator('.swipe', { hasText: 'Internet' }).locator('.item-main'), 170);
    await expect(page.locator('.sheet')).toContainText('Internet marcada como paga');
    await page.locator('.sheet').getByRole('button', { name: 'Fechar' }).click();
    await expect(contasTab.locator('.tab-badge')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('registrar de novo com um toque e fechar painel arrastando', async ({ page }) => {
    const errors = await start(page);
    await seed(page, async () => {
      const s = await import('./js/data/store.js');
      for (const date of ['2026-10-06', '2026-10-09', '2026-10-13']) {
        s.create('transactions', { type: 'expense', amount: 850, description: 'Café da esquina', date, category: 'alimentacao' });
      }
    });
    const chip = page.getByRole('button', { name: 'Registrar despesa “Café da esquina” de R$ 8,50 hoje' });
    await chip.click();
    await expect(page.locator('.toast').last()).toContainText('“Café da esquina” de R$ 8,50 registrada');
    expect(await page.evaluate(async () => (await import('./js/data/store.js')).getState().transactions.filter((t) => t.date === '2026-10-14').length)).toBe(1);

    // Painel: arrastar o título para baixo fecha.
    await page.getByRole('button', { name: /^Adicionar compromisso, tarefa/ }).click();
    await expect(page.locator('.sheet')).toHaveCount(1);
    // Espera o painel terminar de subir antes de arrastar.
    await page.locator('.sheet').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await drag(page, page.locator('.sheet .sheet-title'), 0, 260);
    await expect(page.locator('.sheet')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
