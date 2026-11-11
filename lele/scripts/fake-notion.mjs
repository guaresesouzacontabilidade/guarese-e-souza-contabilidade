// Notion e banco "de mentira" para testes e desenvolvimento (sem internet).
// Monta respostas no formato da API do Notion a partir de uma descrição simples das páginas.

const rich = (parts) =>
  (Array.isArray(parts) ? parts : [{ text: parts }]).map((p) => ({
    type: 'text',
    plain_text: p.text,
    text: { content: p.text },
    annotations: { bold: !!p.bold, italic: !!p.italic, underline: false, strikethrough: false, code: false, color: p.highlight ? 'yellow_background' : 'default' },
  }));

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function toBlock(spec, store) {
  const id = spec.id || uid();
  const type = spec.type;
  const kids = (spec.children || []).map((c) => toBlock(c, store));
  store.set(id, kids);
  let body;
  if (type === 'table') body = { table_width: spec.rows[0].length, has_column_header: !!spec.header, has_row_header: false };
  else if (type === 'table_row') body = { cells: spec.cells.map((c) => rich(c)) };
  else body = { rich_text: rich(spec.text ?? ''), ...(spec.toggleable ? { is_toggleable: true } : {}) };
  if (type === 'table') {
    const rows = spec.rows.map((cells) => toBlock({ type: 'table_row', cells }, store));
    store.set(id, rows);
    return { object: 'block', id, type, has_children: true, archived: false, [type]: body };
  }
  return { object: 'block', id, type, has_children: kids.length > 0, archived: false, [type]: body };
}

export const SAMPLE_PAGES = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Cardiologia',
    icon: '🫀',
    blocks: [
      { type: 'heading_1', text: 'Insuficiência cardíaca' },
      { type: 'bulleted_list_item', text: [{ text: 'Furosemida', bold: true }, { text: ': diurético de alça' }] },
      { type: 'paragraph', text: [{ text: 'A principal causa de IC é a ' }, { text: 'cardiopatia isquêmica', bold: true }, { text: '.' }] },
      {
        type: 'toggle',
        text: 'Quais drogas reduzem mortalidade na ICFEr?',
        children: [
          { type: 'bulleted_list_item', text: 'IECA/BRA ou sacubitril-valsartana' },
          { type: 'bulleted_list_item', text: 'Betabloqueador' },
          { type: 'bulleted_list_item', text: 'Espironolactona' },
          { type: 'bulleted_list_item', text: 'iSGLT2' },
        ],
      },
      { type: 'heading_1', text: 'Pericardite' },
      {
        type: 'table',
        header: true,
        rows: [
          [[{ text: 'Droga' }], [{ text: 'Dose' }]],
          [[{ text: 'AAS' }], [{ text: '750–1000 mg 8/8h' }]],
          [[{ text: 'Colchicina' }], [{ text: '0,5 mg 12/12h' }]],
        ],
      },
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Farmacologia',
    icon: '💊',
    blocks: [
      { type: 'bulleted_list_item', text: 'Antídoto do paracetamol -> N-acetilcisteína' },
      { type: 'bulleted_list_item', text: 'Antídoto da heparina -> Protamina' },
    ],
  },
];

export function createFakeNotion(pages = SAMPLE_PAGES, { pageSize = 100 } = {}) {
  const children = new Map();
  const meta = new Map();
  for (const p of pages) {
    const blocks = p.blocks.map((b) => toBlock(b, children));
    children.set(p.id, blocks);
    meta.set(p.id, {
      object: 'page',
      id: p.id,
      icon: p.icon ? { type: 'emoji', emoji: p.icon } : null,
      last_edited_time: '2026-11-10T12:00:00.000Z',
      parent: { type: 'workspace', workspace: true },
      properties: { title: { type: 'title', title: rich(p.title) } },
    });
  }
  const calls = [];
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const path = u.pathname.replace('/v1', '');
    calls.push(`${init.method || 'GET'} ${path}`);
    if (path === '/oauth/token') return ok({ access_token: 'fake-token', refresh_token: 'fake-refresh', workspace_name: 'Notion da Lelé', bot_id: 'bot-1' });
    if (path === '/users/me') {
      const auth = init.headers?.Authorization || '';
      if (auth.includes('invalida')) return new Response('{}', { status: 401 });
      return ok({ object: 'user', id: 'bot-interno', type: 'bot', bot: { owner: { type: 'workspace', workspace: true }, workspace_name: 'Notion da Lelé' } });
    }
    if (path === '/search') return ok({ results: [...meta.values()], has_more: false, next_cursor: null });
    let m = path.match(/^\/pages\/(.+)$/);
    if (m) return meta.has(m[1]) ? ok(meta.get(m[1])) : new Response('{}', { status: 404 });
    m = path.match(/^\/blocks\/(.+)\/children$/);
    if (m) {
      const all = children.get(m[1]) || [];
      const start = Number(u.searchParams.get('start_cursor') || 0);
      const slice = all.slice(start, start + pageSize);
      const more = start + pageSize < all.length;
      return ok({ results: slice, has_more: more, next_cursor: more ? String(start + pageSize) : null });
    }
    return new Response('{}', { status: 404 });
  }

  // Banco em memória com a mesma interface de createRestDb.
  const states = new Map();
  const tokens = new Map();
  const db = {
    async saveState(row) {
      states.set(row.state, row);
    },
    async takeState(state) {
      const row = states.get(state) || null;
      states.delete(state);
      return row;
    },
    async saveToken(row) {
      tokens.set(row.vault, { ...(tokens.get(row.vault) || {}), ...row });
    },
    async getToken(vault) {
      return tokens.get(vault) || null;
    },
    async deleteToken(vault) {
      tokens.delete(vault);
    },
  };
  return { fetchImpl, db, calls, tokens, states };
}
