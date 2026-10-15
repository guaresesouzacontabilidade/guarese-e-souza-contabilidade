// Efeitos de toque, troca de tela, sons e confete — e os ajustes que desligam cada um.
import { test, expect } from '@playwright/test';
import { start } from './helpers.mjs';

// Conta as notas tocadas (o teste não tem alto-falante).
function countSounds() {
  window.__notes = 0;
  const AC = window.AudioContext;
  const create = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function () {
    window.__notes++;
    return create.call(this);
  };
}
const notes = (page) => page.evaluate(() => window.__notes);

test.describe('efeitos', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'android', 'roda uma vez, no perfil Android');
  });

  test('troca de tela desliza, toque tem onda e som, concluir solta confete', async ({ page }) => {
    await page.addInitScript(countSounds);
    const errors = await start(page);
    await page.evaluate(async () => {
      const s = await import('./js/data/store.js');
      s.create('events', { kind: 'task', title: 'Pagar o IPVA', date: '2026-10-14', done: false, doneDates: [], skipDates: [], repeat: 'none' });
    });
    const html = page.locator('html');
    await expect(html).toHaveClass(/\bvt\b/);
    await expect(html).toHaveAttribute('data-motion', 'full');

    // Aba à direita: desliza para a frente, com onda no ícone e som de troca.
    const ripple = page.waitForSelector('.tabbar .ripple-host', { state: 'attached' });
    await page.locator('.tabbar .tab', { hasText: 'Finanças' }).click();
    await ripple;
    await expect(html).toHaveAttribute('data-nav', 'forward');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finanças');
    expect(await notes(page)).toBeGreaterThan(0);
    // A onda some sozinha e não deixa nada para trás.
    await expect(page.locator('.ripple-host')).toHaveCount(0);

    await page.locator('.tabbar .tab', { hasText: 'Início' }).click();
    await expect(html).toHaveAttribute('data-nav', 'back');

    // Concluir tarefa: confete saindo do toque.
    const confetti = page.waitForSelector('.fx-layer .fx-bit', { state: 'attached' });
    await page.getByRole('checkbox', { name: /Concluir “Pagar o IPVA”/ }).click();
    await confetti;
    await expect(page.locator('.fx-layer')).toHaveCount(0, { timeout: 3000 });
    expect(errors).toEqual([]);
  });

  test('ajustes desligam sons e animações', async ({ page }) => {
    await page.addInitScript(countSounds);
    const errors = await start(page);
    await page.evaluate(async () => {
      const s = await import('./js/data/store.js');
      s.create('events', { kind: 'task', title: 'Ligar para o banco', date: '2026-10-14', done: false, doneDates: [], skipDates: [], repeat: 'none' });
    });
    await page.locator('.topbar').getByRole('button', { name: 'Ajustes' }).click();
    await page.getByRole('switch', { name: /^Sons/ }).uncheck();
    await page.getByRole('switch', { name: /^Animações/ }).uncheck();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

    // Sem sons: tocar em botões e trocar de tela não toca nada.
    const before = await notes(page);
    await page.locator('.tabbar .tab', { hasText: 'Início' }).click();
    await page.getByRole('checkbox', { name: /Concluir “Ligar para o banco”/ }).click();
    await expect(page.locator('.toast').last()).toContainText('Tarefa concluída');
    expect(await notes(page)).toBe(before);
    // Sem animações: nem onda nem confete.
    await expect(page.locator('.fx-layer, .ripple-host')).toHaveCount(0);

    // As escolhas ficam salvas no aparelho.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    expect(await page.evaluate(async () => (await import('./js/data/store.js')).getState().prefs)).toMatchObject({ sound: false, motion: false });
    expect(errors).toEqual([]);
  });
});
