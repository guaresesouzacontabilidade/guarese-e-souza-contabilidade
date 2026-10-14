// Lembretes. Só usa notificações do sistema se o usuário autorizar.
// Na versão web, os avisos aparecem enquanto o app está aberto ou em segundo plano;
// avisos com o app totalmente fechado dependem da versão para lojas (notificações locais nativas).
import * as store from '../data/store.js';
import { dueReminders } from '../core/reminders.js';

const CHECK_EVERY = 30000;
const CATCH_UP_WINDOW = 12 * 3600000; // ao abrir o app, mostra o que venceu nas últimas 12 h

let onInApp = null;
let started = false;

export const notificationsSupported = () => 'Notification' in globalThis;
export const permission = () => (notificationsSupported() ? Notification.permission : 'unsupported');

// iPhone só permite notificações quando o app foi adicionado à Tela de Início.
export function needsInstallForNotifications() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !standalone;
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  store.updatePrefs({ notifications: result === 'granted' });
  return result;
}

export function disableNotifications() {
  store.updatePrefs({ notifications: false });
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

function check() {
  const s = store.getState();
  if (!s.ready) return;
  const now = Date.now();
  const last = s.meta.lastReminderCheck || now - CATCH_UP_WINDOW;
  const from = Math.max(last, now - CATCH_UP_WINDOW);
  const due = dueReminders(s, from, now).filter((r) => !s.meta.notified?.[r.key]);
  const notified = { ...(s.meta.notified || {}) };
  for (const key of Object.keys(notified)) if (notified[key] < now - 10 * 86400000) delete notified[key];
  for (const r of due) notified[r.key] = now;
  store.updateMeta({ lastReminderCheck: now, notified });
  if (!due.length) return;

  const useSystem = s.prefs.notifications && permission() === 'granted';
  if (useSystem && document.visibilityState !== 'visible') {
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
  check();
  setInterval(check, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
