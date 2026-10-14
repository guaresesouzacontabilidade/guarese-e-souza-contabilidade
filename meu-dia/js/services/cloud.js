// Conta e sincronização (Supabase). O cliente só é carregado quando a nuvem está configurada.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import * as store from '../data/store.js';

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
  adoptDevice(user, { merge: false });
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
    store.markAllDirty();
  }
  store.updateMeta({ ownerId: user.id, lastPulledAt: null });
  await syncNow();
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

export async function signOut() {
  const client = await getClient();
  // Tenta enviar o que falta antes de sair.
  try {
    await syncNow();
  } catch {
    /* segue mesmo offline */
  }
  await client.auth.signOut({ scope: 'local' });
  handledUserId = null;
  await store.resetLocal();
  setAuth({ user: null });
  setSync({ state: 'idle', lastSyncAt: null });
}

export async function deleteAccount() {
  const client = await getClient();
  const { error } = await client.rpc('meudia_delete_account');
  if (error) throw error;
  await client.auth.signOut({ scope: 'local' });
  handledUserId = null;
  await store.resetLocal({ keepPrefs: false });
  setAuth({ user: null });
}

export function unsyncedCount() {
  return Object.keys(store.getState().meta.dirty || {}).length;
}

function appUrl() {
  return `${location.origin}${location.pathname}`;
}

// ---------- Sincronização ----------

let timer = null;
let running = false;
let again = false;

export function scheduleSync(delay = 2000) {
  if (!auth.user || auth.pendingMerge) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function syncNow() {
  const client = await getClient();
  if (!client || !auth.user || auth.pendingMerge) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setSync({ state: 'syncing', error: null });
  try {
    await push(client);
    await pull(client);
    setSync({ state: 'ok', lastSyncAt: Date.now(), error: null });
  } catch (err) {
    console.warn('[meu-dia] sincronização falhou', err);
    setSync({ state: navigator.onLine ? 'error' : 'offline', error: friendlyError(err) });
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(800);
    }
  }
}

async function push(client) {
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
      user_id: auth.user.id,
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
  store.clearDirty(versions);
}

async function pull(client) {
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
    store.applyRemote(data);
    for (const r of data) {
      if (!maxTs || new Date(r.server_updated_at) > new Date(maxTs)) maxTs = r.server_updated_at;
    }
    if (data.length < 1000) break;
  }
  store.updateMeta({ lastPulledAt: maxTs, lastSyncAt: Date.now() });
}
