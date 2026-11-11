import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, vaultOf, richToText, simplifyBlock } from '../../supabase/functions/lele-notion/handler.js';
import { createFakeNotion, SAMPLE_PAGES } from '../../scripts/fake-notion.mjs';
import { pageToCards } from '../../js/core/notionCards.js';

const CODE = 'ABCDEFGHJKLMNPQRSTUV';
const ENV = { NOTION_CLIENT_ID: 'cid', NOTION_CLIENT_SECRET: 'secret', SUPABASE_URL: 'https://proj.supabase.co' };
const post = (h, body) =>
  h(new Request('https://proj.supabase.co/functions/v1/lele-notion', { method: 'POST', body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, body: await r.json() }));

async function connect(h) {
  const start = await post(h, { action: 'start', code: CODE, returnUrl: 'http://localhost:4180/notion-ok.html' });
  const state = new URL(start.body.url).searchParams.get('state');
  const res = await h(new Request(`https://proj.supabase.co/functions/v1/lele-notion?code=abc&state=${state}`));
  return { start, res };
}

test('hash do código igual ao do banco (lele_vault) e código inválido recusado', async () => {
  assert.match(await vaultOf(CODE), /^[0-9a-f]{64}$/);
  const fake = createFakeNotion();
  const h = createHandler({ env: ENV, db: fake.db, fetchImpl: fake.fetchImpl });
  const r = await post(h, { action: 'status', code: 'abc' });
  assert.equal(r.status, 400);
});

test('conectar: start → Notion → callback salva o token e volta para o app', async () => {
  const fake = createFakeNotion();
  const h = createHandler({ env: ENV, db: fake.db, fetchImpl: fake.fetchImpl });
  assert.deepEqual((await post(h, { action: 'status', code: CODE })).body, { connected: false });
  const { start, res } = await connect(h);
  const url = new URL(start.body.url);
  assert.equal(url.origin + url.pathname, 'https://api.notion.com/v1/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://proj.supabase.co/functions/v1/lele-notion');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'http://localhost:4180/notion-ok.html?ok=1&ws=Notion+da+Lel%C3%A9');
  assert.deepEqual((await post(h, { action: 'status', code: CODE })).body, { connected: true, workspace: 'Notion da Lelé', icon: null });
  // O mesmo "state" não serve duas vezes.
  const again = await h(new Request(`https://proj.supabase.co/functions/v1/lele-notion?code=abc&state=${url.searchParams.get('state')}`));
  assert.match(again.headers.get('location'), /erro=expirou/);
});

test('endereço de volta fora da lista é trocado pelo padrão', async () => {
  const fake = createFakeNotion();
  const h = createHandler({ env: ENV, db: fake.db, fetchImpl: fake.fetchImpl });
  await post(h, { action: 'start', code: CODE, returnUrl: 'https://site-malicioso.com/x' });
  const row = [...fake.states.values()][0];
  assert.equal(row.return_url, 'https://guaresesouzacontabilidade.github.io/guarese-e-souza-contabilidade/lele/notion-ok.html');
});

test('cancelar no Notion volta com erro=cancelado', async () => {
  const fake = createFakeNotion();
  const h = createHandler({ env: ENV, db: fake.db, fetchImpl: fake.fetchImpl });
  const start = await post(h, { action: 'start', code: CODE, returnUrl: 'http://localhost:4180/notion-ok.html' });
  const state = new URL(start.body.url).searchParams.get('state');
  const res = await h(new Request(`https://proj.supabase.co/functions/v1/lele-notion?error=access_denied&state=${state}`));
  assert.match(res.headers.get('location'), /erro=cancelado/);
  assert.deepEqual((await post(h, { action: 'status', code: CODE })).body, { connected: false });
});

test('listar páginas e ler a página inteira (com subitens e paginação) gera os cartões', async () => {
  const fake = createFakeNotion(SAMPLE_PAGES, { pageSize: 2 });
  const h = createHandler({ env: ENV, db: fake.db, fetchImpl: fake.fetchImpl });
  await connect(h);
  const pages = await post(h, { action: 'pages', code: CODE, query: '' });
  assert.deepEqual(pages.body.items.map((p) => [p.title, p.icon, p.type]), [['Cardiologia', '🫀', 'page'], ['Farmacologia', '💊', 'page']]);
  const page = await post(h, { action: 'page', code: CODE, id: SAMPLE_PAGES[0].id });
  assert.equal(page.status, 200);
  assert.equal(page.body.title, 'Cardiologia');
  assert.equal(page.body.truncated, false);
  assert.equal(page.body.blocks.length, 6);
  const toggle = page.body.blocks.find((b) => b.type === 'toggle');
  assert.equal(toggle.children.length, 4);
  const cards = pageToCards(page.body);
  assert.deepEqual(cards.topics.map((t) => [t.name, t.cards.length]), [['Insuficiência cardíaca', 3], ['Pericardite', 2]]);
  assert.equal(cards.topics[0].cards[0].front, 'Furosemida');
  assert.equal(cards.topics[0].cards[1].front, 'A principal causa de IC é a {{c1::cardiopatia isquêmica}}.');
});

test('sem conexão, ler páginas pede para conectar; desconectar apaga o token', async () => {
  const fake = createFakeNotion();
  const h = createHandler({ env: ENV, db: fake.db, fetchImpl: fake.fetchImpl });
  assert.equal((await post(h, { action: 'pages', code: CODE })).status, 409);
  await connect(h);
  assert.equal((await post(h, { action: 'disconnect', code: CODE })).body.ok, true);
  assert.equal(fake.tokens.size, 0);
});

test('sem configurar o Notion, start avisa', async () => {
  const fake = createFakeNotion();
  const h = createHandler({ env: { SUPABASE_URL: 'https://p.supabase.co' }, db: fake.db, fetchImpl: fake.fetchImpl });
  assert.deepEqual((await post(h, { action: 'config' })).body, { configured: false });
  assert.equal((await post(h, { action: 'start', code: CODE })).status, 503);
});

test('espera e tenta de novo quando o Notion pede calma (429)', async () => {
  const fake = createFakeNotion();
  let first = true;
  const fetchImpl = async (url, init) => {
    if (first && String(url).includes('/search')) {
      first = false;
      return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
    }
    return fake.fetchImpl(url, init);
  };
  const h = createHandler({ env: ENV, db: fake.db, fetchImpl, sleep: async () => {} });
  await connect(h);
  assert.equal((await post(h, { action: 'pages', code: CODE })).body.items.length, 2);
});

test('texto rico do Notion vira a formatação do app', () => {
  const r = (text, a = {}) => ({ plain_text: text, annotations: { bold: false, italic: false, underline: false, color: 'default', ...a } });
  assert.equal(richToText([r('A causa é '), r('cardiopatia ', { bold: true }), r('isquêmica', { bold: true }), r('.')]), 'A causa é **cardiopatia isquêmica**.');
  assert.equal(richToText([r('marca', { color: 'yellow_background' })]), '==marca==');
  assert.equal(richToText([r('itálico', { italic: true })]), '*itálico*');
  assert.deepEqual(simplifyBlock({ id: 'x', type: 'heading_2', has_children: false, heading_2: { rich_text: [r('T')], is_toggleable: true } }), {
    id: 'x', hasChildren: false, type: 'heading', level: 2, toggleable: true, text: 'T',
  });
});
