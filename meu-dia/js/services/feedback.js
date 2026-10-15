// Resposta ao toque: som curto e vibração leve, cada um com seu ajuste em Ajustes › Aparência.
import { getState } from '../data/store.js';
import { isNative, plugin } from './native.js';
import { playSound } from './sound.js';

const PATTERNS = { selection: 6, light: 10, medium: 18, success: [12, 40, 12], warning: [30, 60, 30] };

// Vibração de cada momento (sem vibração no toque comum, para não cansar).
const HAPTIC_FOR = { nav: 'selection', on: 'light', off: 'light', save: 'light', success: 'success', complete: 'success', undo: 'light', warning: 'warning', delete: 'medium' };

export const vibrationSupported = () => isNative() || 'vibrate' in navigator;

export function haptic(kind = 'light') {
  if (getState().prefs.vibration === false) return;
  try {
    if (isNative()) {
      const h = plugin('Haptics');
      if (!h) return;
      if (kind === 'success') h.notification({ type: 'SUCCESS' }).catch(() => {});
      else if (kind === 'warning') h.notification({ type: 'WARNING' }).catch(() => {});
      else h.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(PATTERNS[kind] || PATTERNS.light);
  } catch {
    /* sem vibração */
  }
}

// tap · nav · on · off · save · success · complete · undo · warning · delete
export function feedback(kind) {
  if (getState().prefs.sound !== false) playSound(kind);
  if (HAPTIC_FOR[kind]) haptic(HAPTIC_FOR[kind]);
}
