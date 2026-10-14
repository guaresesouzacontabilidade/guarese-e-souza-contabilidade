// Instalação como app (PWA) e atualização do service worker.

let deferredPrompt = null;
const listeners = new Set();
let updateReady = null;

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canPromptInstall = () => Boolean(deferredPrompt);
export const hasUpdate = () => Boolean(updateReady);

export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  emit();
});

addEventListener('appinstalled', () => {
  deferredPrompt = null;
  emit();
});

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  emit();
  return outcome === 'accepted';
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    if (!reg) return;
    const track = (worker) => {
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          updateReady = worker;
          emit();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      updateReady = reg.waiting;
      emit();
    }
    reg.addEventListener('updatefound', () => track(reg.installing));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    // Procura versão nova quando o app volta ao primeiro plano.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (err) {
    console.warn('[meu-dia] service worker não registrado', err);
  }
}

export function applyUpdate() {
  updateReady?.postMessage({ type: 'SKIP_WAITING' });
}
