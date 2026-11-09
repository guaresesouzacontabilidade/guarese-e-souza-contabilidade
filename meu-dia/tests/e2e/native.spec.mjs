// Comportamento dentro do app nativo (Capacitor), com a ponte nativa simulada.
import { test, expect } from '@playwright/test';

const NOW = new Date('2026-10-14T10:00:00-03:00');

// Simula window.Capacitor com os plugins usados pelo app e registra as chamadas.
function fakeBridge() {
  const calls = [];
  window.__nativeCalls = calls;
  const listeners = {};
  const ok = (name, method, result = {}) => (args) => {
    calls.push({ plugin: name, method, args: JSON.parse(JSON.stringify(args ?? null)) });
    return Promise.resolve(result);
  };
  let pending = [];
  const Plugins = {
    LocalNotifications: {
      checkPermissions: ok('LocalNotifications', 'checkPermissions', { display: 'prompt' }),
      requestPermissions: ok('LocalNotifications', 'requestPermissions', { display: 'granted' }),
      getPending: () => Promise.resolve({ notifications: pending }),
      cancel: (args) => {
        calls.push({ plugin: 'LocalNotifications', method: 'cancel', args });
        pending = [];
        return Promise.resolve();
      },
      schedule: (args) => {
        calls.push({ plugin: 'LocalNotifications', method: 'schedule', args: JSON.parse(JSON.stringify(args)) });
        pending = args.notifications.map((n) => ({ id: n.id }));
        return Promise.resolve({ notifications: pending });
      },
      addListener: (event, fn) => {
        listeners[event] = fn;
        return Promise.resolve({ remove() {} });
      },
    },
    SystemBars: { setStyle: ok('SystemBars', 'setStyle') },
    Filesystem: { writeFile: ok('Filesystem', 'writeFile', { uri: 'file:///cache/backup.json' }) },
    Share: { share: ok('Share', 'share') },
  };
  window.__fireNotificationTap = (route) => listeners.localNotificationActionPerformed?.({ notification: { extra: { route } } });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins, registerPlugin: (n) => Plugins[n] };
  const register = navigator.serviceWorker?.register?.bind(navigator.serviceWorker);
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = (...a) => {
      calls.push({ plugin: 'web', method: 'serviceWorker.register' });
      return register(...a);
    };
  }
}

const calls = (page, plugin, method) =>
  page.evaluate(([p, m]) => window.__nativeCalls.filter((c) => c.plugin === p && (!m || c.method === m)), [plugin, method]);

test('app nativo: lembretes agendados no sistema, exportar pelo compartilhar, barra de status', async ({ page }, info) => {
  test.skip(info.project.name !== 'android', 'roda uma vez, no perfil Android');
  await page.addInitScript(fakeBridge);
  await page.clock.setFixedTime(NOW);
  await page.goto('./');
  await page.getByRole('button', { name: 'Começar', exact: true }).click();

  // Sem service worker no app nativo; barra de status acompanha o tema.
  expect(await calls(page, 'web', 'serviceWorker.register')).toEqual([]);
  await expect.poll(async () => (await calls(page, 'SystemBars', 'setStyle')).length).toBeGreaterThan(0);

  // Ativar notificações pede permissão ao Android.
  await page.locator('.topbar').getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.locator('section.card', { hasText: 'Lembretes' })).toContainText('mesmo com o Meu Dia fechado');
  await expect(page.locator('section.card', { hasText: 'Instalar app' })).toHaveCount(0);
  await page.getByRole('switch', { name: /Notificações no aparelho/ }).check();
  await expect.poll(async () => (await calls(page, 'LocalNotifications', 'requestPermissions')).length).toBe(1);

  // Um compromisso com lembrete vira notificação agendada no sistema.
  await page.getByRole('button', { name: /^Adicionar compromisso, tarefa/ }).click();
  await page.locator('.add-opt', { hasText: 'Compromisso' }).click();
  await page.getByLabel('O que é?', { exact: true }).fill('Dentista');
  await page.getByRole('button', { name: 'Amanhã', exact: true }).click();
  await page.getByLabel('Horário (opcional)', { exact: true }).fill('15:00');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect
    .poll(async () => {
      const s = await calls(page, 'LocalNotifications', 'schedule');
      return s.at(-1)?.args.notifications.map((n) => n.title) ?? [];
    }, { timeout: 8000 })
    .toContain('Dentista');
  const scheduled = (await calls(page, 'LocalNotifications', 'schedule')).at(-1).args.notifications.find((n) => n.title === 'Dentista');
  expect(new Date(scheduled.schedule.at).getTime()).toBe(new Date('2026-10-15T14:30:00-03:00').getTime());
  expect(scheduled.smallIcon).toBe('ic_stat_meudia');
  expect(scheduled.schedule.allowWhileIdle).toBe(true);

  // Tocar na notificação abre a agenda do dia.
  await page.evaluate(() => window.__fireNotificationTap('#/agenda?dia=2026-10-15'));
  await expect(page).toHaveURL(/#\/agenda\?dia=2026-10-15/);

  // Exportar backup usa o menu de compartilhar do celular.
  await page.locator('.topbar').getByRole('button', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: /Exportar backup completo/ }).click();
  await expect.poll(async () => (await calls(page, 'Share', 'share')).length).toBe(1);
  const written = (await calls(page, 'Filesystem', 'writeFile'))[0].args;
  expect(written.path).toMatch(/^meu-dia-backup-.*\.json$/);
  expect(JSON.parse(written.data).app).toBe('meu-dia');
});
