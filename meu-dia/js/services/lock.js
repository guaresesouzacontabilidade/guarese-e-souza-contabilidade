// Bloqueio com digital, rosto ou senha do celular (app nativo).
import * as store from '../data/store.js';
import { isNative, plugin } from './native.js';

const RELOCK_AFTER = 60000; // volta a bloquear depois de 1 minuto fora do app
let locked = false;
let hiddenAt = null;
const listeners = new Set();

const bio = () => plugin('NativeBiometric');
const emit = () => listeners.forEach((fn) => fn(locked));

export const isLocked = () => locked;
export function subscribeLock(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function lockAvailable() {
  if (!isNative() || !bio()) return false;
  try {
    const r = await bio().isAvailable({ useFallback: true });
    return Boolean(r?.isAvailable);
  } catch {
    return false;
  }
}

export async function verify(reason = 'Desbloquear o Meu Dia') {
  await bio().verifyIdentity({ reason, title: 'Meu Dia', subtitle: reason, negativeButtonText: 'Cancelar', maxAttempts: 5 });
}

function applyPrivacy(enabled) {
  plugin('MeuDia')?.setPrivacy({ hideInRecents: enabled }).catch(() => {});
}

export async function setLockEnabled(enabled) {
  if (enabled) await verify('Confirme para ativar o bloqueio');
  store.updatePrefs({ lock: enabled });
  applyPrivacy(enabled);
}

export async function unlock() {
  try {
    await verify();
    locked = false;
    emit();
    return true;
  } catch {
    return false;
  }
}

export function startLock() {
  if (!isNative()) return;
  const enabled = () => store.getState().prefs.lock === true;
  applyPrivacy(enabled());
  if (enabled()) {
    locked = true;
    emit();
  }
  document.addEventListener('visibilitychange', () => {
    if (!enabled()) return;
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER) {
      locked = true;
      emit();
    }
  });
}
