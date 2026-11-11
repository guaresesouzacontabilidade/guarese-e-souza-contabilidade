// Estrutura do app: boas-vindas, telas, barra de abas e botão de novo cartão.
import { html, useEffect } from '../vendor/preact.js';
import * as store from '../data/store.js';
import { useStore, useRoute, navigate, closeTopSheet, hasOpenSheet } from './state.js';
import { Icon, Toasts, Sheets } from './components.js';
import { Welcome } from './views/welcome.js';
import { HomeView } from './views/home.js';
import { DeckView } from './views/deck.js';
import { StudyView } from './views/study.js';
import { StatsView } from './views/stats.js';
import { SettingsView } from './views/settings.js';
import { openEditor } from './sheets/editor.js';

const TABS = [
  { path: '/', icon: 'house', label: 'Início' },
  { path: '/progresso', icon: 'chart-column', label: 'Progresso' },
  { path: '/ajustes', icon: 'settings', label: 'Ajustes' },
];

export function App() {
  const state = useStore();
  const route = useRoute();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && hasOpenSheet()) {
        e.preventDefault();
        closeTopSheet();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  if (!state.meta.onboarded) {
    return html`<${Welcome} /><${Sheets} /><${Toasts} />`;
  }

  const [first, second] = route.parts;
  let view;
  let showChrome = true;
  if (first === 'estudar') {
    view = html`<${StudyView} key=${route.path + JSON.stringify(route.params)} params=${route.params} />`;
    showChrome = false;
  } else if (first === 'baralho' && second) {
    view = html`<${DeckView} key=${second} id=${second} />`;
  } else if (first === 'progresso') view = html`<${StatsView} />`;
  else if (first === 'ajustes') view = html`<${SettingsView} />`;
  else view = html`<${HomeView} />`;

  const tabPath = '/' + (first || '');
  const hasDecks = store.list('decks').length > 0;

  return html`
    <main class="app" id="main">${view}</main>
    ${showChrome &&
    html`
      ${first === undefined &&
      hasDecks &&
      html`<button class="fab" aria-label="Novo cartão" title="Novo cartão" onClick=${() => openEditor()}>
        <${Icon} name="plus" />
      </button>`}
      <nav class="tabbar" aria-label="Navegação">
        ${TABS.map(
          (t) => html`<button
            class="tab"
            aria-current=${(t.path === '/' ? tabPath === '/' || first === 'baralho' : tabPath === t.path) ? 'page' : undefined}
            aria-label=${t.label}
            onClick=${() => navigate(t.path)}
          >
            <${Icon} name=${t.icon} /><span>${t.label}</span>
          </button>`,
        )}
      </nav>
    `}
    <${Sheets} />
    <${Toasts} />
  `;
}
