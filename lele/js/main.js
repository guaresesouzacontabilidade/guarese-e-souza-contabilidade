// Ponto de partida: carrega os dados salvos, aplica o tema e desenha o app.
import { html, render } from './vendor/preact.js';
import * as store from './data/store.js';
import { requestPersistence } from './data/idb.js';
import { initSync } from './services/sync.js';
import { App } from './ui/app.js';

function applyTheme() {
  const pref = store.getPrefs().theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#170d13' : '#fbf5f2');
}

async function boot() {
  applyTheme();
  store.subscribePrefs(applyTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  await store.init();
  render(html`<${App} />`, document.getElementById('app'));
  document.documentElement.classList.add('is-ready');
  initSync();
  requestPersistence();
  // Salva antes de sair ou ir para segundo plano.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });
  addEventListener('pagehide', () => store.flush());

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('app').innerHTML =
    '<p style="padding:24px;font-family:system-ui">Não consegui abrir o app. Feche e abra de novo; se continuar, avise quem fez o app 💗</p>';
});
