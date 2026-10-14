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
let onAction = null;
let started = false;
let nativePermission = 'prompt';

// Botões que aparecem na notificação (Android).
const ACTION_TYPES = [
  { id: 'MD_BILL', actions: [{ id: 'pay', title: 'Pagar' }, { id: 'snooze', title: 'Lembrar em 1 h' }] },
  { id: 'MD_BILL_RECEIVE', actions: [{ id: 'pay', title: 'Recebi' }, { id: 'snooze', title: 'Lembrar em 1 h' }] },
  { id: 'MD_TASK', actions: [{ id: 'done', title: 'Concluir' }, { id: 'snooze', title: 'Adiar 1 h' }] },
  { id: 'MD_EVENT', actions: [{ id: 'snooze10', title: 'Lembrar em 10 min' }] },
];
const ACTION_TYPE_FOR = { bill: 'MD_BILL', 'bill-receive': 'MD_BILL_RECEIVE', task: 'MD_TASK', event: 'MD_EVENT' };

// Quem trata "Pagar"/"Concluir" (a interface registra ao iniciar).
export function onReminderAction(fn) {
  onAction = fn;
}

// "Adiar": guarda um lembrete extra e reagenda.
export function snoozeReminder(reminder, minutes) {
  const now = Date.now();
  const s = store.getState();
  const snoozes = (s.meta.snoozes || []).filter((x) => x.fireAt > now);
  snoozes.push({ ...reminder, key: `${reminder.key.split(':snz')[0]}:snz${now}`, fireAt: now + minutes * 60000 });
  store.updateMeta({ snoozes });
  scheduleNativeSoon(0);
}

function pendingSnoozes(s, from, to) {
  return (s.meta.snoozes || []).filter((x) => x.fireAt > from && x.fireAt <= to);
}

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
  const list = enabled
    ? [...dueReminders(s, now, now + NATIVE_HORIZON), ...pendingSnoozes(s, now, now + NATIVE_HORIZON)].sort((a, b) => a.fireAt - b.fireAt).slice(0, NATIVE_MAX)
    : [];
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
        extra: { route: r.route, kind: r.kind, ref: r.ref, key: r.key, title: r.title, body: r.body },
        actionTypeId: ACTION_TYPE_FOR[r.kind],
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
  try {
    await LN.registerActionTypes({ types: ACTION_TYPES });
  } catch {
    /* versões sem botões */
  }
  LN.addListener('localNotificationActionPerformed', (event) => {
    const extra = event?.notification?.extra || {};
    const actionId = event?.actionId || 'tap';
    if (actionId === 'snooze' || actionId === 'snooze10') {
      snoozeReminder({ key: extra.key || 'lembrete', title: extra.title || event.notification.title, body: extra.body || event.notification.body, route: extra.route, kind: extra.kind, ref: extra.ref }, actionId === 'snooze10' ? 10 : 60);
      return;
    }
    if ((actionId === 'pay' || actionId === 'done') && onAction) {
      onAction(actionId, extra);
      return;
    }
    if (extra.route) location.hash = extra.route;
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
  const due = [...dueReminders(s, from, now), ...pendingSnoozes(s, from, now)].filter((r) => !s.meta.notified?.[r.key]);
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
