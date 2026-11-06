// Conta e sincronização entre dois aparelhos. A "nuvem" é uma imitação do Supabase feita aqui
// mesmo (nada sai para a internet), com as mesmas regras do banco: cada um só vê os próprios
// dados e vence a alteração mais recente.
import { test, expect } from '@playwright/test';
import { NOW, money, start, goTo, addExpense } from './helpers.mjs';

const CLOUD = 'https://nuvem.teste';
const EMAIL = 'ana@exemplo.com';
const PASSWORD = 'senha1234';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function fakeCloud() {
  const users = new Map([[EMAIL, { id: '6f1c2a5e-0000-4000-8000-00000000a0a0', password: PASSWORD }]]);
  const rows = new Map(); // `${user}|${collection}|${id}` → registro
  let clock = Date.parse('2026-10-14T13:00:00Z');
  const unknown = [];

  const session = (email, user) => {
    const exp = Math.floor(NOW.getTime() / 1000) + 365 * 86400;
    return {
      access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email, role: 'authenticated', aud: 'authenticated', exp })}.x`,
      token_type: 'bearer',
      expires_in: 365 * 86400,
      expires_at: exp,
      refresh_token: `r-${user.id}`,
      user: userJson(email, user),
    };
  };
  const userJson = (email, user) => ({
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: '2026-10-01T12:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-10-01T12:00:00Z',
  });
  // Quem está pedindo (o token diz), como a regra de segurança (RLS) do banco.
  const caller = (req) => {
    const token = (req.headers().authorization || '').replace(/^Bearer /, '');
    try {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub || null;
    } catch {
      return null;
    }
  };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = req.postDataJSON();
      const user = users.get(email);
      if (!user || user.password !== password) return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(route, 200, session(email, user));
    }
    if (p === '/auth/v1/user') {
      const uid = caller(req);
      const [email, user] = [...users].find(([, u]) => u.id === uid) || [];
      return user ? json(route, 200, userJson(email, user)) : json(route, 401, { msg: 'invalid JWT' });
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (p === '/rest/v1/meudia_records') {
      const uid = caller(req);
      if (!uid) return json(route, 401, { code: '42501', message: 'permission denied' });
      if (req.method() === 'POST') {
        for (const r of req.postDataJSON()) {
          if (r.user_id !== uid) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });
          const key = `${uid}|${r.collection}|${r.id}`;
          const old = rows.get(key);
          // Igual ao gatilho do banco: uma versão mais antiga não sobrescreve a mais nova.
          if (old && r.client_updated_at < old.client_updated_at) continue;
          rows.set(key, { ...r, server_updated_at: new Date((clock += 1000)).toISOString() });
        }
        return route.fulfill({ status: 201, body: '' });
      }
      const since = (url.searchParams.get('server_updated_at') || 'gt.1970-01-01T00:00:00Z').replace(/^gt\./, '');
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 1000);
      const list = [...rows.values()]
        .filter((r) => r.user_id === uid && Date.parse(r.server_updated_at) > Date.parse(since))
        .sort((x, y) => Date.parse(x.server_updated_at) - Date.parse(y.server_updated_at))
        .slice(offset, offset + limit)
        .map(({ user_id, ...r }) => r);
      return json(route, 200, list);
    }
    unknown.push(`${req.method()} ${p}`);
    return json(route, 404, { message: 'não existe na nuvem de teste' });
  }

  return {
    unknown,
    find: (collection, test) => [...rows.values()].find((r) => r.collection === collection && test(r)),
    // Liga um aparelho (página) a esta nuvem.
    async attach(page) {
      await page.route('**/js/config.js', (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          body: `export const SUPABASE_URL = '${CLOUD}';\nexport const SUPABASE_ANON_KEY = 'sb_publishable_teste';\nexport const PUBLIC_URL = '';\n`,
        }),
      );
      await page.route(`${CLOUD}/**`, handle);
    },
  };
}

async function login(page, password = PASSWORD) {
  const sheet = page.locator('.sheet');
  await sheet.getByLabel('E-mail', { exact: true }).fill(EMAIL);
  await sheet.getByLabel('Senha', { exact: true }).fill(password);
  await sheet.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test.describe('conta e sincronização', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'android', 'roda uma vez, no perfil Android');
  });

  test('dois celulares na mesma conta: juntar, ver, alterar, excluir e sair', async ({ page, browser }, info) => {
    const cloud = fakeCloud();

    // Celular 1: já usava o app sem conta e entra depois.
    await cloud.attach(page);
    const errors = await start(page);
    await addExpense(page, { amount: '4590', description: 'Mercado' });
    await goTo(page, 'Ajustes');
    const account = page.locator('section.card', { hasText: 'Conta e sincronização' });
    await account.getByRole('button', { name: 'Entrar' }).click();
    await login(page);
    await page.getByRole('button', { name: 'Sim, juntar à minha conta' }).click();
    await expect(account).toContainText(EMAIL);
    await expect(account).toContainText('Sincronizado agora');
    await expect.poll(() => cloud.find('transactions', (r) => r.data.description === 'Mercado')).toBeTruthy();
    await expect.poll(() => cloud.find('settings', (r) => r.data.name === 'Ana')).toBeTruthy();

    // Celular 2: instalação nova, entra direto na conta.
    const { launchOptions, ...use } = info.project.use;
    const other = await browser.newContext(use);
    const phone2 = await other.newPage();
    const errors2 = [];
    phone2.on('pageerror', (e) => errors2.push(e.message));
    await cloud.attach(phone2);
    await phone2.clock.setFixedTime(new Date(NOW.getTime() + 3600000));
    await phone2.goto('./');
    await phone2.getByRole('button', { name: 'Já tenho conta' }).click();
    await login(phone2, 'senha-errada1');
    await expect(phone2.locator('.sheet .field-error')).toHaveText('E-mail ou senha incorretos.');
    await login(phone2);
    // Os dados da conta chegam: nome e o gasto do outro celular.
    await expect(phone2.getByRole('heading', { level: 1 })).toContainText('Ana');
    await goTo(phone2, 'Finanças');
    const mercado = phone2.locator('.swipe', { hasText: 'Mercado' });
    await expect(mercado).toHaveCount(1);
    expect(money(await mercado.innerText())).toContain('R$ 45,90');

    // No celular 2: um gasto novo e o "Mercado" excluído.
    await addExpense(phone2, { amount: '2000', description: 'Farmácia' });
    await phone2.evaluate(async () => {
      const s = await import('./js/data/store.js');
      const t = s.getState().transactions.find((x) => x.description === 'Mercado');
      s.remove('transactions', t.id);
    });
    await expect.poll(() => cloud.find('transactions', (r) => r.data.description === 'Farmácia')).toBeTruthy();
    await expect.poll(() => cloud.find('transactions', (r) => r.data.description === 'Mercado')?.deleted).toBe(true);

    // Celular 1 sincroniza e fica igual.
    await account.getByRole('button', { name: /Sincronizar agora/ }).click();
    await goTo(page, 'Finanças');
    await expect(page.locator('.swipe', { hasText: 'Farmácia' })).toHaveCount(1);
    await expect(page.locator('.swipe', { hasText: 'Mercado' })).toHaveCount(0);

    // Sair da conta tira os dados deste celular; a conta continua com eles.
    await goTo(page, 'Ajustes');
    await account.getByRole('button', { name: /Sair da conta/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('Você saiu da conta');
    await expect(account.getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(await page.evaluate(async () => (await import('./js/data/store.js')).getState().transactions.length)).toBe(0);
    expect(cloud.find('transactions', (r) => r.data.description === 'Farmácia')).toBeTruthy();

    expect(cloud.unknown).toEqual([]);
    expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
    expect(errors2).toEqual([]);
    await other.close();
  });
});
