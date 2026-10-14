// Vibração leve para confirmar ações (concluir, pagar, salvar). Discreta e só onde existe.
import { isNative, plugin } from './native.js';

const PATTERNS = { light: 10, success: [12, 40, 12], warning: [30, 60, 30] };

export function haptic(kind = 'light') {
  try {
    if (isNative()) {
      const h = plugin('Haptics');
      if (!h) return;
      if (kind === 'success') h.notification({ type: 'SUCCESS' }).catch(() => {});
      else if (kind === 'warning') h.notification({ type: 'WARNING' }).catch(() => {});
      else h.impact({ style: 'LIGHT' }).catch(() => {});
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(PATTERNS[kind] || PATTERNS.light);
  } catch {
    /* sem vibração */
  }
}
