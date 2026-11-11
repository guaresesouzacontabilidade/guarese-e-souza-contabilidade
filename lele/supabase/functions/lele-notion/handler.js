// Função lele-notion: liga o App da Lelé ao Notion (OAuth) e lê as páginas que ela escolheu.
// Escrita em JavaScript puro (APIs web: fetch, crypto) para rodar no Supabase (Deno) e nos testes (Node).
//
// POST { action, code, ... }   code = código de sincronização (identifica a pessoa)
//   config                      → { configured }
//   start   { returnUrl }       → { url }   (endereço de autorização do Notion)
//   status                      → { connected, workspace, icon }
//   pages   { query }           → { items: [{ id, type, title, icon, lastEdited }] }
//   page    { id }              → { id, title, icon, blocks, truncated }
//   database { id }             → { id, title, pages: [{ id, title, icon }] }
//   disconnect                  → { ok }
// GET ?code=…&state=…           → volta do Notion: troca o código pelo token e redireciona para notion-ok.html

const NOTION = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const CODE_RE = /^[A-HJ-NP-Z2-9]{20}$/;
const MAX_CALLS = 350;
const DEFAULT_RETURN = 'https://guaresesouzacontabilidade.github.io/guarese-e-souza-contabilidade/lele/notion-ok.html';
const DEFAULT_ORIGINS = 'https://guaresesouzacontabilidade.github.io,http://localhost';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const redirect = (url) => new Response(null, { status: 302, headers: { ...CORS, Location: url } });

export async function vaultOf(code) {
  if (!CODE_RE.test(code || '')) throw new HttpError(400, 'código de sincronização inválido');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`app-da-lele:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomState() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

// ---------- Banco (PostgREST com a chave service role) ----------

export function createRestDb({ url, key, fetchImpl = fetch }) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const rest = async (path, init = {}) => {
    const res = await fetchImpl(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) throw new HttpError(500, `banco: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  return {
    async saveState(row) {
      await rest(`lele_notion_states?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE' });
      await rest('lele_notion_states', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } });
    },
    async takeState(state) {
      const rows = await rest(`lele_notion_states?state=eq.${encodeURIComponent(state)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      });
      return rows?.[0] || null;
    },
    async saveToken(row) {
      await rest('lele_notion?on_conflict=vault', {
        method: 'POST',
        body: JSON.stringify(row),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    },
    async getToken(vault) {
      const rows = await rest(`lele_notion?vault=eq.${vault}&select=*`);
      return rows?.[0] || null;
    },
    async deleteToken(vault) {
      await rest(`lele_notion?vault=eq.${vault}`, { method: 'DELETE' });
    },
  };
}

// ---------- Texto do Notion → formatação do app ----------

export function richToText(rich = []) {
  const out = rich
    .map((r) => {
      const t = r.plain_text ?? r.text?.content ?? '';
      if (!t.trim()) return t;
      const a = r.annotations || {};
      const lead = t.match(/^\s*/)[0];
      const trail = t.match(/\s*$/)[0];
      let core = t.trim();
      if (a.bold) core = `**${core}**`;
      else if (a.italic) core = `*${core}*`;
      if (a.underline) core = `__${core}__`;
      if (a.color && a.color.endsWith('_background')) core = `==${core}==`;
      return lead + core + trail;
    })
    .join('');
  // Trechos vizinhos com a mesma marcação viram um só ("**a** **b**" → "**a b**").
  return out.replace(/\*\*(\s*)\*\*/g, '$1').replace(/==(\s*)==/g, '$1');
}

const TYPE_MAP = {
  paragraph: 'paragraph',
  bulleted_list_item: 'bulleted',
  numbered_list_item: 'numbered',
  to_do: 'todo',
  toggle: 'toggle',
  quote: 'quote',
  callout: 'callout',
};

export function simplifyBlock(b) {
  const t = b.type;
  const d = b[t] || {};
  const base = { id: b.id, hasChildren: Boolean(b.has_children) };
  if (t in TYPE_MAP) return { ...base, type: TYPE_MAP[t], text: richToText(d.rich_text), ...(t === 'to_do' ? { checked: Boolean(d.checked) } : {}) };
  if (/^heading_[123]$/.test(t)) return { ...base, type: 'heading', level: Number(t.slice(-1)), toggleable: Boolean(d.is_toggleable), text: richToText(d.rich_text) };
  if (t === 'code') return { ...base, type: 'code', text: (d.rich_text || []).map((r) => r.plain_text).join('') };
  if (t === 'equation') return { ...base, type: 'paragraph', text: d.expression || '' };
  if (t === 'table') return { ...base, type: 'table', hasColumnHeader: Boolean(d.has_column_header), hasRowHeader: Boolean(d.has_row_header) };
  if (t === 'table_row') return { ...base, type: 'row', cells: (d.cells || []).map((c) => richToText(c)) };
  if (t === 'child_page') return { ...base, type: 'child_page', text: d.title || '', hasChildren: false };
  if (t === 'child_database') return { ...base, type: 'child_database', text: d.title || '', hasChildren: false };
  if (t === 'divider') return { ...base, type: 'divider' };
  if (['column_list', 'column', 'synced_block'].includes(t)) return { ...base, type: 'group' };
  return { ...base, type: 'other' };
}

const titleOf = (obj) => {
  if (obj.object === 'database') return (obj.title || []).map((r) => r.plain_text).join('').trim();
  const prop = Object.values(obj.properties || {}).find((p) => p.type === 'title');
  return (prop?.title || []).map((r) => r.plain_text).join('').trim();
};
const iconOf = (obj) => (obj.icon?.type === 'emoji' ? obj.icon.emoji : null);

// ---------- Função ----------

export function createHandler({ env, db, fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const clientId = env.NOTION_CLIENT_ID || '';
  const clientSecret = env.NOTION_CLIENT_SECRET || '';
  const redirectUri = env.NOTION_REDIRECT_URI || `${env.SUPABASE_URL}/functions/v1/lele-notion`;
  const defaultReturn = env.APP_RETURN_URL || DEFAULT_RETURN;
  const origins = (env.APP_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  const configured = Boolean(clientId && clientSecret);
  const basic = () => `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

  const allowedReturn = (url) => {
    try {
      const u = new URL(url);
      return origins.some((o) => u.origin === o || (o === 'http://localhost' && u.hostname === 'localhost'));
    } catch {
      return false;
    }
  };

  async function oauthToken(body) {
    const res = await fetchImpl(`${NOTION}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: basic(), 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(400, `Notion recusou a conexão (${data.error || res.status})`);
    return data;
  }

  // Chamada à API do Notion com o token da pessoa (renova o token se precisar, espera se pedir calma).
  function notionClient(vault, row) {
    let token = row.access_token;
    let calls = 0;
    const api = async (path, init = {}, retry = 0) => {
      calls += 1;
      const res = await fetchImpl(`${NOTION}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      });
      if (res.status === 429 && retry < 3) {
        await sleep(Math.min(5, Number(res.headers.get('retry-after')) || 1) * 1000);
        return api(path, init, retry + 1);
      }
      if (res.status === 401 && row.refresh_token && retry === 0) {
        const fresh = await oauthToken({ grant_type: 'refresh_token', refresh_token: row.refresh_token }).catch(() => null);
        if (fresh?.access_token) {
          token = fresh.access_token;
          row = { ...row, access_token: fresh.access_token, refresh_token: fresh.refresh_token || row.refresh_token };
          await db.saveToken({ ...row, updated_at: new Date(now()).toISOString() });
          return api(path, init, 1);
        }
      }
      if (res.status === 401) throw new HttpError(401, 'A conexão com o Notion expirou. Conecte de novo em Ajustes.');
      if (res.status === 404) throw new HttpError(404, 'Página não encontrada. Ela pode não ter sido liberada para o app no Notion.');
      if (!res.ok) throw new HttpError(502, `Notion respondeu ${res.status}`);
      return res.json();
    };
    return { api, calls: () => calls };
  }

  async function listChildren(client, id) {
    const out = [];
    let cursor = null;
    do {
      const r = await client.api(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      out.push(...r.results.filter((b) => !b.archived && !b.in_trash).map(simplifyBlock));
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor && client.calls() < MAX_CALLS);
    return out;
  }

  // Lê a página inteira (subitens também), 3 pedidos por vez, até MAX_CALLS chamadas.
  async function fetchTree(client, rootId) {
    const root = await listChildren(client, rootId);
    let queue = root.filter((b) => b.hasChildren).map((b) => ({ b, depth: 1 }));
    let truncated = false;
    while (queue.length) {
      if (client.calls() >= MAX_CALLS) {
        truncated = true;
        break;
      }
      const batch = queue.splice(0, 3);
      const results = await Promise.all(batch.map(({ b }) => listChildren(client, b.id)));
      batch.forEach(({ b, depth }, i) => {
        b.children = results[i];
        if (depth < 8) queue.push(...results[i].filter((c) => c.hasChildren).map((c) => ({ b: c, depth: depth + 1 })));
      });
    }
    return { blocks: root, truncated };
  }

  async function connected(code) {
    const vault = await vaultOf(code);
    const row = await db.getToken(vault);
    if (!row) throw new HttpError(409, 'O Notion ainda não está conectado.');
    return { vault, row, client: notionClient(vault, row) };
  }

  async function handleCallback(url) {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const pending = state ? await db.takeState(state) : null;
    if (!pending || new Date(pending.expires_at).getTime() < now()) return redirect(withParams(defaultReturn, { erro: 'expirou' }));
    if (url.searchParams.get('error') || !code) return redirect(withParams(pending.return_url, { erro: 'cancelado' }));
    try {
      const t = await oauthToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      await db.saveToken({
        vault: pending.vault,
        access_token: t.access_token,
        refresh_token: t.refresh_token || null,
        workspace_name: t.workspace_name || null,
        workspace_icon: t.workspace_icon || null,
        bot_id: t.bot_id || null,
        updated_at: new Date(now()).toISOString(),
      });
      return redirect(withParams(pending.return_url, { ok: '1', ws: t.workspace_name || '' }));
    } catch {
      return redirect(withParams(pending.return_url, { erro: 'falhou' }));
    }
  }

  async function handleAction(body) {
    const { action } = body;
    if (action === 'config') return { configured };
    if (action === 'start') {
      if (!configured) throw new HttpError(503, 'A ligação com o Notion ainda não foi configurada.');
      const vault = await vaultOf(body.code);
      const returnUrl = allowedReturn(body.returnUrl) ? body.returnUrl : defaultReturn;
      const state = randomState();
      await db.saveState({ state, vault, return_url: returnUrl, expires_at: new Date(now() + 15 * 60 * 1000).toISOString() });
      const url = withParams(`${NOTION}/oauth/authorize`, { client_id: clientId, response_type: 'code', owner: 'user', redirect_uri: redirectUri, state });
      return { url };
    }
    if (action === 'status') {
      const vault = await vaultOf(body.code);
      const row = await db.getToken(vault);
      return row ? { connected: true, workspace: row.workspace_name, icon: row.workspace_icon } : { connected: false };
    }
    if (action === 'disconnect') {
      const vault = await vaultOf(body.code);
      await db.deleteToken(vault);
      return { ok: true };
    }
    if (action === 'pages') {
      const { client } = await connected(body.code);
      const items = [];
      let cursor = null;
      do {
        const r = await client.api('/search', {
          method: 'POST',
          body: JSON.stringify({
            query: String(body.query || '').slice(0, 100),
            page_size: 100,
            sort: { direction: 'descending', timestamp: 'last_edited_time' },
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        });
        for (const o of r.results) {
          if (o.archived || o.in_trash || !['page', 'database'].includes(o.object)) continue;
          items.push({ id: o.id, type: o.object, title: titleOf(o) || 'Sem título', icon: iconOf(o), lastEdited: o.last_edited_time, inDatabase: o.parent?.type === 'database_id' });
        }
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor && items.length < 300);
      return { items };
    }
    if (action === 'page') {
      const { client } = await connected(body.code);
      const meta = await client.api(`/pages/${body.id}`);
      const { blocks, truncated } = await fetchTree(client, body.id);
      return { id: meta.id, title: titleOf(meta) || 'Sem título', icon: iconOf(meta), lastEdited: meta.last_edited_time, blocks, truncated };
    }
    if (action === 'database') {
      const { client } = await connected(body.code);
      const meta = await client.api(`/databases/${body.id}`);
      const pages = [];
      let cursor = null;
      do {
        const r = await client.api(`/databases/${body.id}/query`, { method: 'POST', body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) });
        for (const p of r.results) if (!p.archived && !p.in_trash) pages.push({ id: p.id, title: titleOf(p) || 'Sem título', icon: iconOf(p) });
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor && pages.length < 300);
      return { id: meta.id, title: titleOf(meta) || 'Sem título', pages };
    }
    throw new HttpError(400, 'ação desconhecida');
  }

  return async function handler(req) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const url = new URL(req.url);
      if (req.method === 'GET') return await handleCallback(url);
      if (req.method !== 'POST') throw new HttpError(405, 'método não permitido');
      const body = await req.json().catch(() => ({}));
      return json(200, await handleAction(body));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json(status, { message: status === 500 ? 'Erro inesperado. Tente de novo.' : err.message });
    }
  };
}
