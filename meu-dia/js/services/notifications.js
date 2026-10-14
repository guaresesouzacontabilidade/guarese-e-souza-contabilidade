// Lembretes. Só usa notificações do sistema se o usuário autorizar.
// - App nativo (Android/iOS): os lembretes são agendados no aparelho e tocam mesmo com o app fechado.
// - Web: os avisos aparecem enquanto o app está aberto ou em segundo plano.
import * as store from '../data/store.js';
import { dueReminders } from '../core/reminders.js';
import { isNative, plugin } from './native.js';

const CHECK_EVERY = 30000;
const CATCH_UP_WINDOW = 12 * 3600000; // ao abrir o app, mostra o que venceu nas últimas 12 h
const NATIVE_HORIZON = 45 * 86400000; // agenda os próximos 45 dias
const NATIVE_MAX = 60; // limite seguro de lembretes agendados (o iOS aceita 64)

let onInApp = null;
let started = false;
let nativePermission = 'prompt';

const LocalNotifications = () => plugin('LocalNotifications');

export const notificationsSupported = () => (isNative() ? Boolean(LocalNotifications()) : 'Notification' in globalThis);

export function permission() {
  if (isNative()) return nativePermission;
  return 'Notification' in globalThis ? Notification.permission : 'unsupported';
}

// iPhone só permite notificações na web quando o app foi adicionado à Tela de Início.
export function needsInstallForNotifications() {
  if (isNative()) return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !standalone;
}

export const remindersWorkWhenClosed = () => isNative();

const toPermission = (display) => (display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default');

export async function requestPermission() {
  if (isNative()) {
    const res = await LocalNotifications().requestPermissions();
    nativePermission = toPermission(res.display);
    store.updatePrefs({ notifications: nativePermission === 'granted' });
    scheduleNativeSoon(0);
    return nativePermission;
  }
  if (!('Notification' in globalThis)) return 'unsupported';
  const result = await Notification.requestPermission();
  store.updatePrefs({ notifications: result === 'granted' });
  return result;
}

export function disableNotifications() {
  store.updatePrefs({ notifications: false });
  scheduleNativeSoon(0);
}

async function showSystem(reminder) {
  const options = {
    body: reminder.body,
    tag: reminder.key,
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/badge-96.png',
    data: { route: reminder.route },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(reminder.title, options);
    const n = new Notification(reminder.title, options);
    n.onclick = () => {
      focus();
      location.hash = reminder.route;
    };
  } catch (err) {
    console.warn('[meu-dia] notificação não exibida', err);
  }
}

// ---------- Agendamento nativo ----------

// Número estável (int de 31 bits) para cada lembrete.
function notificationId(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

let nativeTimer = null;
let lastSignature = '';

function scheduleNativeSoon(delay = 1500) {
  if (!isNative()) return;
  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(() => syncNativeSchedule().catch((err) => console.warn('[meu-dia] agendamento falhou', err)), delay);
}

async function syncNativeSchedule() {
  const LN = LocalNotifications();
  if (!LN) return;
  const s = store.getState();
  const enabled = s.prefs.notifications && nativePermission === 'granted';
  const now = Date.now();
  const list = enabled ? dueReminders(s, now, now + NATIVE_HORIZON).slice(0, NATIVE_MAX) : [];
  const signature = list.map((r) => `${r.key}|${r.title}|${r.body}`).join('\n');
  if (signature === lastSignature) return;
  const pending = await LN.getPending();
  if (pending.notifications?.length) await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (list.length) {
    await LN.schedule({
      notifications: list.map((r) => ({
        id: notificationId(r.key),
        title: r.title,
        body: r.body,
        schedule: { at: new Date(r.fireAt), allowWhileIdle: true },
        extra: { route: r.route },
        smallIcon: 'ic_stat_meudia',
        iconColor: '#2DD4BF',
      })),
    });
  }
  lastSignature = signature;
}

async function initNative() {
  const LN = LocalNotifications();
  if (!LN) return;
  try {
    const res = await LN.checkPermissions();
    nativePermission = toPermission(res.display);
  } catch {
    /* plugin indisponível */
  }
  LN.addListener('localNotificationActionPerformed', (event) => {
    const route = event?.notification?.extra?.route;
    if (route) location.hash = route;
  });
  // Reagenda quando compromissos, contas ou ajustes mudam (ignora mudanças só de controle interno).
  let prev = store.getState();
  store.subscribe((s) => {
    if (s.events !== prev.events || s.bills !== prev.bills || s.settings !== prev.settings || s.prefs !== prev.prefs) scheduleNativeSoon();
    prev = s;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleNativeSoon(500);
  });
  scheduleNativeSoon(0);
}

// ---------- Verificação dentro do app ----------

function check() {
  const s = store.getState();
  if (!s.ready) return;
  const useSystem = s.prefs.notifications && permission() === 'granted';
  const visible = document.visibilityState === 'visible';
  // Sem notificação do sistema, o aviso só pode aparecer dentro do app: espera a pessoa voltar.
  if (!useSystem && !visible) return;
  const now = Date.now();
  const last = s.meta.lastReminderCheck || now - CATCH_UP_WINDOW;
  const from = Math.max(last, now - CATCH_UP_WINDOW);
  const due = dueReminders(s, from, now).filter((r) => !s.meta.notified?.[r.key]);
  const notified = { ...(s.meta.notified || {}) };
  for (const key of Object.keys(notified)) if (notified[key] < now - 10 * 86400000) delete notified[key];
  for (const r of due) notified[r.key] = now;
  store.updateMeta({ lastReminderCheck: now, notified });
  if (!due.length) return;

  // No app nativo com permissão, o próprio sistema já mostrou a notificação agendada.
  if (isNative() && useSystem) return;
  if (useSystem && !visible) {
    if (due.length > 3) {
      showSystem({ key: 'resumo', title: `Você tem ${due.length} lembretes`, body: due.slice(0, 3).map((r) => r.title).join(' · '), route: '#/' });
    } else {
      due.forEach(showSystem);
    }
  } else {
    onInApp?.(due);
  }
}

export function startReminders(inAppHandler) {
  onInApp = inAppHandler;
  if (started) return;
  started = true;
  if (isNative()) initNative();
  check();
  setInterval(check, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
