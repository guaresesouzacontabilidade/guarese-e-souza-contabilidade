// Recursos do app Android, com a ponte nativa do Capacitor simulada.
import { test, expect } from '@playwright/test';
import { bankDV, factorFromDate } from '../../js/core/boleto.js';

const NOW = new Date('2026-10-14T10:00:00-03:00');

function boletoBarcode() {
  const noDV = `3419${String(factorFromDate('2026-10-20')).padStart(4, '0')}${'18000'.padStart(10, '0')}1234567890123456789012345`;
  return `${noDV.slice(0, 4)}${bankDV(noDV)}${noDV.slice(4)}`;
}

function fakeBridge(barcode) {
  const calls = [];
  const listeners = {};
  window.__calls = calls;
  const record = (plugin, method, args) => calls.push({ plugin, method, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) });
  const files = {};
  window.__files = files;
  let pending = [];
  const listen = (plugin) => (event, fn) => {
    listeners[`${plugin}:${event}`] = fn;
    return Promise.resolve({ remove() {} });
  };
  window.__emit = (plugin, event, data) => listeners[`${plugin}:${event}`]?.(data);
  const Plugins = {
    LocalNotifications: {
      checkPermissions: async () => ({ display: 'granted' }),
      requestPermissions: async () => ({ display: 'granted' }),
      registerActionTypes: async (a) => record('LocalNotifications', 'registerActionTypes', a),
      getPending: async () => ({ notifications: pending }),
      cancel: async () => {
        pending = [];
      },
      schedule: async (a) => {
        record('LocalNotifications', 'schedule', a);
        pending = a.notifications.map((n) => ({ id: n.id }));
      },
      addListener: listen('LocalNotifications'),
    },
    MeuDia: {
      takeLaunchRoute: async () => ({ route: null }),
      updateWidget: async (a) => record('MeuDia', 'updateWidget', a),
      setPrivacy: async (a) => record('MeuDia', 'setPrivacy', a),
      addListener: listen('MeuDia'),
    },
    App: { addListener: listen('App'), exitApp: async () => record('App', 'exitApp') },
    Haptics: { impact: async (a) => record('Haptics', 'impact', a), notification: async (a) => record('Haptics', 'notification', a) },
    SystemBars: { setStyle: async () => {} },
    NativeBiometric: {
      isAvailable: async () => ({ isAvailable: true, biometryType: 3 }),
      verifyIdentity: async (a) => record('NativeBiometric', 'verifyIdentity', a),
    },
    Filesystem: {
      writeFile: async (a) => {
        record('Filesystem', 'writeFile', { path: a.path });
        files[a.path] = a.data;
        return { uri: `file:///data/${a.path}` };
      },
      readdir: async () => ({
        files: Object.keys(files)
          .filter((p) => p.startsWith('backups/'))
          .map((p) => ({ name: p.slice(8), size: files[p].length, mtime: Date.now(), type: 'file' })),
      }),
      readFile: async (a) => ({ data: files[a.path] }),
      deleteFile: async (a) => {
        delete files[a.path];
      },
    },
    Share: { share: async (a) => record('Share', 'share', a) },
    SpeechRecognition: {
      available: async () => ({ available: true }),
      requestPermissions: async () => ({ speechRecognition: 'granted' }),
      start: async (a) => {
        record('SpeechRecognition', 'start', a);
        return { matches: ['gastei 45 reais de gasolina ontem'] };
      },
    },
    BarcodeScanner: {
      isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
      installGoogleBarcodeScannerModule: async () => {},
      scan: async (a) => {
        record('BarcodeScanner', 'scan', a);
        return { barcodes: [{ rawValue: barcode, format: 'ITF' }] };
      },
    },
  };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins, registerPlugin: (n) => Plugins[n] };
}

const calls = (page, plugin, method) => page.evaluate(([p, m]) => window.__calls.filter((c) => c.plugin === p && (!m || c.method === m)), [plugin, method]);

async function start(page) {
  await page.addInitScript(fakeBridge, boletoBarcode());
  await page.clock.setFixedTime(NOW);
  await page.goto('./');
  await page.getByRole('button', { name: 'Começar', exact: true }).click();
}

test.describe('app Android', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'android', 'roda uma vez, no perfil Android');
  });

  test('atalhos do ícone, voz, widget e vibração', async ({ page }) => {
    await start(page);
    // Atalho "Nova despesa" (segurar o ícone) abre o formulário.
    await page.evaluate(() => window.__emit('MeuDia', 'route', { route: 'add:expense' }));
    await expect(page.locator('.sheet')).toContainText('Nova despesa');
    await page.locator('.sheet').getByRole('button', { name: 'Fechar' }).click();

    // Atalho "Falar um gasto": ouve, entende e preenche para conferir.
    await page.evaluate(() => window.__emit('MeuDia', 'route', { route: 'voice:expense' }));
    const sheet = page.locator('.sheet');
    await expect(sheet).toContainText('Ouvi: “gastei 45 reais de gasolina ontem”');
    await expect(sheet.getByLabel('Valor', { exact: true })).toHaveValue('45,00');
    await expect(sheet.getByLabel('Descrição', { exact: true })).toHaveValue('Gasolina');
    await expect(sheet.getByRole('button', { name: 'Combustível' })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Registrar despesa' }).click();

    // Vibração ao salvar e widget atualizado com o saldo do mês.
    await expect.poll(async () => (await calls(page, 'Haptics')).length).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const w = (await calls(page, 'MeuDia', 'updateWidget')).at(-1);
        return w ? JSON.parse(w.args.data).balance : '';
      })
      .toContain('-R$');
  });

  test('boleto pela câmera e código para copiar', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: /^Adicionar compromisso, tarefa/ }).click();
    await page.locator('.add-opt', { hasText: 'Conta' }).first().click();
    await page.getByRole('button', { name: 'Ler código de barras' }).click();
    const sheet = page.locator('.sheet');
    await expect(sheet.getByLabel('Valor', { exact: true })).toHaveValue('180,00');
    await expect(sheet.getByLabel('Descrição', { exact: true })).toHaveValue('Boleto Itaú');
    await expect(sheet).toContainText('Código do boleto guardado');
    await sheet.getByRole('button', { name: 'Salvar conta' }).click();
    await page.evaluate(() => (location.hash = '#/contas'));
    await page.locator('.item-main', { hasText: 'Boleto Itaú' }).click();
    await expect(page.locator('.sheet').getByRole('button', { name: 'Copiar código do boleto' })).toBeVisible();
  });

  test('botões das notificações: pagar e adiar', async ({ page }) => {
    await start(page);
    await page.evaluate(async () => {
      const s = await import('./js/data/store.js');
      s.updatePrefs({ notifications: true });
      s.create('bills', { kind: 'pay', description: 'Luz', amount: 18000, dueDate: '2026-10-16', status: 'open', repeat: 'none', remind: [1] });
    });
    await expect.poll(async () => (await calls(page, 'LocalNotifications', 'registerActionTypes')).length).toBe(1);
    await expect
      .poll(async () => (await calls(page, 'LocalNotifications', 'schedule')).at(-1)?.args.notifications[0]?.actionTypeId, { timeout: 8000 })
      .toBe('MD_BILL');
    const n = (await calls(page, 'LocalNotifications', 'schedule')).at(-1).args.notifications[0];

    // "Lembrar em 1 h" agenda um novo aviso.
    await page.evaluate((extra) => window.__emit('LocalNotifications', 'localNotificationActionPerformed', { actionId: 'snooze', notification: { title: 'Luz', body: '', extra } }), n.extra);
    await expect
      .poll(async () => (await calls(page, 'LocalNotifications', 'schedule')).at(-1)?.args.notifications.length, { timeout: 8000 })
      .toBe(2);

    // "Pagar" abre a confirmação de pagamento.
    await page.evaluate((extra) => window.__emit('LocalNotifications', 'localNotificationActionPerformed', { actionId: 'pay', notification: { extra } }), n.extra);
    await expect(page.locator('.sheet')).toContainText('Luz marcada como paga');
  });

  test('bloqueio com digital, voltar do Android, backup e restauração', async ({ page }) => {
    await start(page);
    await page.evaluate(async () => {
      const s = await import('./js/data/store.js');
      s.create('transactions', { type: 'expense', amount: 1000, description: 'Café', date: '2026-10-14', category: 'alimentacao' });
    });
    await page.locator('.topbar').getByRole('button', { name: 'Ajustes' }).click();

    // Ativar o bloqueio confirma a identidade e esconde a tela nos apps recentes.
    await page.getByRole('switch', { name: /Bloquear com digital ou rosto/ }).check();
    await expect.poll(async () => (await calls(page, 'NativeBiometric', 'verifyIdentity')).length).toBe(1);
    expect((await calls(page, 'MeuDia', 'setPrivacy')).at(-1).args).toEqual({ hideInRecents: true });

    // Cópia agora e restauração.
    await page.getByRole('button', { name: /Fazer uma cópia agora/ }).click();
    await expect.poll(async () => (await calls(page, 'Filesystem', 'writeFile')).map((c) => c.args.path)).toContain('backups/meu-dia-2026-10-14.json');
    await page.evaluate(async () => {
      const s = await import('./js/data/store.js');
      const t = s.getState().transactions[0];
      s.remove('transactions', t.id);
    });
    await page.getByRole('button', { name: /Restaurar uma cópia/ }).click();
    await page.locator('.sheet .settings-row', { hasText: '14 de outubro' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurar' }).click();
    await expect(page.locator('.toast').last()).toContainText('Cópia restaurada');
    expect(await page.evaluate(async () => (await import('./js/data/store.js')).getState().transactions.filter((t) => !t.deleted).length)).toBe(1);

    // Botão voltar: fecha painel, depois vai ao Início, depois sai.
    await page.getByRole('button', { name: /Restaurar uma cópia/ }).click();
    await expect(page.locator('.sheet')).toHaveCount(1);
    await page.evaluate(() => window.__emit('App', 'backButton', {}));
    await expect(page.locator('.sheet')).toHaveCount(0);
    await page.evaluate(() => window.__emit('App', 'backButton', {}));
    await expect(page).toHaveURL(/#\/$/);
    await page.evaluate(() => window.__emit('App', 'backButton', {}));
    expect((await calls(page, 'App', 'exitApp')).length).toBe(1);

    // Ao abrir de novo, o app pede a digital antes de mostrar os dados.
    await page.reload();
    await expect.poll(async () => (await calls(page, 'NativeBiometric', 'verifyIdentity')).length).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Bom dia|Boa tarde|Boa noite/);
  });
});
