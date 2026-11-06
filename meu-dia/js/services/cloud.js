// Conta e sincronização (Supabase). O cliente só é carregado quando a nuvem está configurada.
import { SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_URL } from '../config.js';
import * as store from '../data/store.js';
import { isNative } from './native.js';

const TABLE = 'meudia_records';

export const cloudEnabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;
export function getClient() {
  if (!cloudEnabled()) return Promise.resolve(null);
  clientPromise ??= import('../vendor/supabase.js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'meu-dia-auth' },
    }),
  );
  return clientPromise;
}

// ---------- Estado observável ----------

let auth = { enabled: cloudEnabled(), ready: !cloudEnabled(), user: null, recovery: false, pendingMerge: null };
let sync = { state: cloudEnabled() ? 'idle' : 'disabled', lastSyncAt: null, error: null };
const listeners = new Set();

export const getAuth = () => auth;
export const getSync = () => sync;
export function subscribeCloud(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}
function setAuth(patch) {
  auth = { ...auth, ...patch };
  emit();
}
function setSync(patch) {
  sync = { ...sync, ...patch };
  emit();
}

// ---------- Mensagens de erro em português ----------

export function friendlyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('network')) return 'Sem conexão com a internet. Tente de novo em instantes.';
  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'Já existe uma conta com este e-mail. Tente entrar.';
  if (msg.includes('password should be') || msg.includes('weak password') || msg.includes('at least')) return 'Use uma senha mais forte, com pelo menos 8 caracteres.';
  if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('security purposes')) return 'Muitas tentativas seguidas. Aguarde um minuto e tente novamente.';
  if (msg.includes('same password') || msg.includes('should be different')) return 'A nova senha precisa ser diferente da anterior.';
  if (msg.includes('invalid email') || msg.includes('unable to validate email')) return 'Confira o e-mail digitado.';
  if (msg.includes('expired') || msg.includes('otp')) return 'O link expirou. Peça um novo.';
  return 'Não foi possível concluir agora. Tente novamente.';
}

// ---------- Sessão ----------

export async function initCloud() {
  const client = await getClient();
  if (!client) return;
  store.onLocalChange(() => scheduleSync(2500));

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') setAuth({ recovery: true });
    const user = session?.user ? { id: session.user.id, email: session.user.email } : null;
    if (event === 'SIGNED_OUT') {
      handledUserId = null;
      setAuth({ user: null });
      return;
    }
    if (user && user.id !== auth.user?.id) {
      setAuth({ user });
      // Fora do callback para não travar o cliente.
      setTimeout(() => handleSignedIn(user), 0);
    }
  });

  const { data } = await client.auth.getSession();
  const user = data?.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
  setAuth({ ready: true, user });
  if (user) handleSignedIn(user);

  addEventListener('online', () => scheduleSync(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(300);
    else if (Object.keys(store.getState().meta.dirty).length) syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  }, 60000);
}

let handledUserId = null;

function handleSignedIn(user) {
  if (handledUserId === user.id) return;
  handledUserId = user.id;
  const s = store.getState();
  if (s.meta.ownerId === user.id) {
    scheduleSync(0);
    return;
  }
  if (!s.meta.ownerId && store.countRecords() > 0) {
    // Dados criados antes de entrar: o usuário decide se junta à conta.
    setAuth({ pendingMerge: { count: store.countRecords() } });
    return;
  }
  // Aparelho sem registros (ou de outra pessoa): usa os dados da conta.
  adoptDevice(user, { merge: !s.meta.ownerId });
}

export async function resolveMerge(merge) {
  const user = auth.user;
  setAuth({ pendingMerge: null });
  if (user) await adoptDevice(user, { merge });
}

async function adoptDevice(user, { merge }) {
  const s = store.getState();
  if (!merge || (s.meta.ownerId && s.meta.ownerId !== user.id)) {
    await store.resetLocal();
  } else {
    // Envia os registros do aparelho; os ajustes da conta (orçamento, categorias…)
    // têm prioridade e os locais só servem se a conta ainda não tiver nenhum.
    store.prepareMerge();
  }
  store.updateMeta({ ownerId: user.id, lastPulledAt: null });
  if (current) await current.catch(() => {});
  await syncNow();
  // A conta ainda não tinha ajustes: usa os do aparelho (ex.: nome digitado no cadastro).
  const st = store.getState();
  if (sync.state === 'ok' && st.meta.ownerId === user.id && !st.settings.updatedAt && store.hasCustomSettings()) {
    store.updateSettings({});
    scheduleSync(0);
  }
}

export async function signUp({ email, password, name }) {
  const client = await getClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: appUrl(), data: { name } },
  });
  if (error) throw error;
  if (name) store.updateSettings({ name });
  return { needsConfirmation: !data.session };
}

export async function signIn({ email, password }) {
  const client = await getClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  const client = await getClient();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) throw error;
}

export async function setNewPassword(password) {
  const client = await getClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
  setAuth({ recovery: false });
}

export function cancelRecovery() {
  setAuth({ recovery: false });
}

// Espera a sincronização em andamento e envia o que faltar antes de sair.
async function finishSync() {
  clearTimeout(timer);
  try {
    if (current) await current;
    await syncNow();
  } catch {
    /* segue mesmo offline */
  }
}

export async function signOut() {
  const client = await getClient();
  await finishSync();
  blocked = true;
  clearTimeout(timer);
  try {
    await client.auth.signOut({ scope: 'local' });
    handledUserId = null;
    await store.resetLocal();
    setAuth({ user: null });
    setSync({ state: 'idle', lastSyncAt: null });
  } finally {
    blocked = false;
  }
}

export async function deleteAccount() {
  const client = await getClient();
  clearTimeout(timer);
  if (current) await current.catch(() => {});
  blocked = true;
  try {
    const { error } = await client.rpc('meudia_delete_account');
    if (error) throw error;
    await client.auth.signOut({ scope: 'local' });
    handledUserId = null;
    await store.resetLocal({ keepPrefs: false });
    setAuth({ user: null });
    setSync({ state: 'idle', lastSyncAt: null });
  } finally {
    blocked = false;
  }
}

export function unsyncedCount() {
  return Object.keys(store.getState().meta.dirty || {}).length;
}

// No app nativo o endereço é interno (https://localhost), então os e-mails apontam para o site.
function appUrl() {
  return isNative() ? PUBLIC_URL : `${location.origin}${location.pathname}`;
}

// ---------- Sincronização ----------

let timer = null;
let current = null; // sincronização em andamento
let again = false;
let blocked = false; // saindo da conta: nada de sincronizar

export function scheduleSync(delay = 2000) {
  if (!auth.user || auth.pendingMerge || blocked) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export function syncNow() {
  if (current) {
    again = true;
    return current;
  }
  current = runSync().finally(() => {
    current = null;
    if (again) {
      again = false;
      scheduleSync(800);
    }
  });
  return current;
}

async function runSync() {
  const client = await getClient();
  if (!client || !auth.user || auth.pendingMerge || blocked) return;
  const uid = auth.user.id;
  setSync({ state: 'syncing', error: null });
  try {
    await push(client, uid);
    await pull(client, uid);
    setSync({ state: 'ok', lastSyncAt: Date.now(), error: null });
  } catch (err) {
    console.warn('[meu-dia] sincronização falhou', err);
    setSync({ state: navigator.onLine ? 'error' : 'offline', error: friendlyError(err) });
  }
}

// O aparelho ainda pertence a este usuário? (pode ter saído no meio da sincronização)
const stillOwner = (uid) => !blocked && auth.user?.id === uid && store.getState().meta.ownerId === uid;

async function push(client, uid) {
  if (!stillOwner(uid)) return;
  const s = store.getState();
  const keys = Object.keys(s.meta.dirty || {});
  if (!keys.length) return;
  const rows = [];
  const versions = [];
  for (const key of keys) {
    const [collection, id] = key.split(/:(.+)/);
    const rec = collection === 'settings' ? s.settings : s[collection]?.find((r) => r.id === id);
    if (!rec) {
      versions.push({ key, updatedAt: Infinity });
      continue;
    }
    const { id: _id, updatedAt, deleted, ...data } = rec;
    rows.push({
      user_id: uid,
      collection,
      id,
      data,
      deleted: Boolean(deleted),
      client_updated_at: updatedAt || 1,
    });
    versions.push({ key, updatedAt: updatedAt || 0 });
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await client.from(TABLE).upsert(rows.slice(i, i + 200), { onConflict: 'user_id,collection,id' });
    if (error) throw error;
  }
  if (stillOwner(uid)) store.clearDirty(versions);
}

async function pull(client, uid) {
  if (!stillOwner(uid)) return;
  const cursor = store.getState().meta.lastPulledAt;
  // Pequena sobreposição para não perder gravações simultâneas; aplicar de novo é inofensivo.
  const since = cursor ? new Date(new Date(cursor).getTime() - 5000).toISOString() : '1970-01-01T00:00:00Z';
  let maxTs = cursor;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from(TABLE)
      .select('collection,id,data,deleted,client_updated_at,server_updated_at')
      .gt('server_updated_at', since)
      .order('server_updated_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!stillOwner(uid)) return;
    store.applyRemote(data);
    for (const r of data) {
      if (!maxTs || new Date(r.server_updated_at) > new Date(maxTs)) maxTs = r.server_updated_at;
    }
    if (data.length < 1000) break;
  }
  if (stillOwner(uid)) store.updateMeta({ lastPulledAt: maxTs, lastSyncAt: Date.now() });
}
