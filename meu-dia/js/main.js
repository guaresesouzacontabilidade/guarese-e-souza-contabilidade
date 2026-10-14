// Ponto de entrada do Meu Dia.
import { html, render } from './vendor/preact.js';
import { App } from './ui/app.js';
import * as store from './data/store.js';
import { initCloud } from './services/cloud.js';
import { registerServiceWorker } from './services/install.js';
import { openAddForm } from './ui/forms/add.js';

async function start() {
  await store.load();
  render(html`<${App} />`, document.getElementById('app'));
  document.documentElement.classList.add('is-ready');

  // Atalhos do ícone do app (ex.: "Nova despesa").
  const add = new URLSearchParams(location.search).get('add');
  if (add) {
    history.replaceState(history.state, '', location.pathname + location.hash);
    if (store.getState().prefs.onboarded) setTimeout(() => openAddForm(add), 300);
  }

  // Salva antes de sair ou ir para segundo plano.
  addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });

  initCloud().catch((err) => console.warn('[meu-dia] nuvem indisponível', err));
  registerServiceWorker();
}

start().catch((err) => {
  console.error(err);
  document.getElementById('app').innerHTML =
    '<div style="padding:24px;font-family:system-ui"><h1 style="font-size:20px">Não foi possível abrir o Meu Dia</h1><p>Atualize a página. Se o problema continuar, verifique se o navegador permite salvar dados do site.</p></div>';
});
