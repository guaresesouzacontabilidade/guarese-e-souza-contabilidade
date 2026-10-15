// Estrutura do app: navegação, telas e camadas.
import { html, useEffect, useRef, useState } from '../vendor/preact.js';
import { useStore, useRoute, useCloud, navigate, choose, toast, goTo, hasLayers, closeLayer, parseRoute } from './state.js';
import { Icon, IconButton } from './components.js';
import { Layers, Toasts } from './layers.js';
import { HomeView } from './views/home.js';
import { AgendaView } from './views/agenda.js';
import { FinanceView } from './views/finance.js';
import { BillsView } from './views/bills.js';
import { ReportsView } from './views/reports.js';
import { AssistantView } from './views/assistant.js';
import { SettingsView, SyncStatus } from './views/settings.js';
import { Welcome } from './views/welcome.js';
import { openAuthSheet } from './views/auth.js';
import { openAddMenu } from './forms/add.js';
import { resolveMerge } from '../services/cloud.js';
import { startReminders, onReminderAction, snoozeReminder } from '../services/notifications.js';
import { quickPay } from './forms/bill.js';
import * as store from '../data/store.js';
import { isDoneOn } from '../core/agenda.js';
import { feedback } from '../services/feedback.js';
import { applyMotionPref } from './fx.js';
import { subscribeInstall, hasUpdate, applyUpdate } from '../services/install.js';
import { setSystemBarsTheme, isNative, plugin } from '../services/native.js';
import { startWidgetSync, listenLaunchRoutes } from '../services/widget.js';
import { startLock, subscribeLock, isLocked, unlock } from '../services/lock.js';
import { startAutoBackup } from '../services/autobackup.js';
import { openAddForm } from './forms/add.js';
import { startVoiceEntry } from './forms/transaction.js';

const NAV = [
  { path: '/', label: 'Início', icon: 'house' },
  { path: '/agenda', label: 'Agenda', icon: 'calendar' },
  { path: '/financas', label: 'Finanças', icon: 'wallet' },
  { path: '/contas', label: 'Contas', icon: 'receipt' },
  { path: '/relatorios', label: 'Relatórios', icon: 'chart-column', desktopOnly: true },
  { path: '/assistente', label: 'Assistente', icon: 'sparkles', desktopOnly: true },
];

const TITLES = {
  '/': 'Início',
  '/agenda': 'Agenda',
  '/financas': 'Finanças',
  '/contas': 'Contas',
  '/relatorios': 'Relatórios',
  '/assistente': 'Assistente',
  '/ajustes': 'Ajustes',
};

function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#060912' : '#f2f4f9');
  setSystemBarsTheme(dark);
}

// Botões dos lembretes: "Pagar"/"Recebi" abre a confirmação; "Concluir" marca a tarefa.
function handleReminderAction(actionId, info) {
  const ref = info?.ref || {};
  if (actionId === 'pay') {
    const bill = store.findById('bills', ref.id);
    if (!bill || bill.status === 'paid') {
      toast('Esta conta já está paga.');
      return;
    }
    goTo('/contas');
    setTimeout(() => quickPay(bill), 350);
    return;
  }
  if (actionId === 'done') {
    const item = store.findById('events', ref.id);
    if (!item) return;
    if (!isDoneOn(item, ref.date)) store.toggleTask(item, ref.date);
    feedback('complete');
    toast(`Tarefa concluída: ${item.title}`, { tone: 'success' });
  }
}

// Telas pedidas por atalhos do ícone e botões do widget.
let pendingRoute = null;
function handleLaunchRoute(route) {
  if (!store.getState().prefs.onboarded) return;
  if (isLocked()) {
    pendingRoute = route;
    return;
  }
  if (route.startsWith('add:')) openAddForm(route.slice(4));
  else if (route === 'voice:expense') startVoiceEntry();
  else if (route.startsWith('#')) goTo(route.slice(1));
}

function LockScreen() {
  const [busy, setBusy] = useState(false);
  const tryUnlock = async () => {
    setBusy(true);
    const ok = await unlock();
    setBusy(false);
    if (ok && pendingRoute) {
      const r = pendingRoute;
      pendingRoute = null;
      setTimeout(() => handleLaunchRoute(r), 200);
    }
  };
  useEffect(() => {
    tryUnlock();
  }, []);
  return html`<div class="lock-screen" role="dialog" aria-modal="true" aria-label="Meu Dia bloqueado">
    <img src="./assets/icons/icon.svg" alt="" width="72" height="72" class="welcome-logo" />
    <h1>Meu Dia</h1>
    <p>Bloqueado para proteger seus dados.</p>
    <button type="button" class="btn btn-primary btn-lg" onClick=${tryUnlock} disabled=${busy}>
      <${Icon} name="fingerprint" /><span>${busy ? 'Aguardando…' : 'Desbloquear'}</span>
    </button>
  </div>`;
}

function useLocked() {
  const [locked, setLocked] = useState(isLocked());
  useEffect(() => subscribeLock(setLocked), []);
  return locked;
}

// Android: "voltar" fecha o painel aberto; depois volta ao Início; no Início, sai do app.
function setupBackButton() {
  const app = plugin('App');
  if (!app) return;
  app.addListener('backButton', () => {
    if (hasLayers()) {
      closeLayer();
      return;
    }
    const route = parseRoute();
    if (route.params.busca) {
      location.replace(`#${route.path}`);
    } else if (route.path !== '/') {
      location.replace('#/');
    } else {
      app.exitApp();
    }
  });
}
if (isNative()) setupBackButton();

function addContext(route) {
  return route.path === '/agenda' && route.params.dia ? { date: route.params.dia } : {};
}

function Sidebar({ route }) {
  return html`<nav class="sidebar" aria-label="Navegação principal">
    <a class="brand" href="#/"><img class="brand-mark" src="./assets/icons/icon.svg" alt="" width="32" height="32" />Meu Dia</a>
    <button type="button" class="btn btn-primary btn-lg side-add" onClick=${() => openAddMenu(addContext(route))}>
      <${Icon} name="plus" /><span>Adicionar</span>
    </button>
    ${NAV.map(
      (n) => html`<a key=${n.path} class="side-link" href=${`#${n.path}`} aria-current=${route.path === n.path ? 'page' : undefined}>
        <${Icon} name=${n.icon} />${n.label}
      </a>`,
    )}
    <div class="side-foot">
      <a class="side-link" href="#/ajustes" aria-current=${route.path === '/ajustes' ? 'page' : undefined}><${Icon} name="settings" />Ajustes</a>
      <div style=${{ padding: '4px 12px' }}><${SyncStatus} /></div>
    </div>
  </nav>`;
}

function Topbar({ route }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 4);
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  return html`<header class=${`topbar ${scrolled ? 'is-scrolled' : ''}`}>
    <a class="brand" href="#/" aria-label="Meu Dia — início"><img class="brand-mark" src="./assets/icons/icon.svg" alt="" width="32" height="32" />Meu Dia</a>
    <div class="topbar-actions">
      <${SyncStatus} compact />
      <${IconButton} icon="sparkles" label="Assistente" onClick=${() => navigate('/assistente')} aria-current=${route.path === '/assistente' ? 'page' : undefined} />
      <${IconButton} icon="settings" label="Ajustes" onClick=${() => navigate('/ajustes')} aria-current=${route.path === '/ajustes' ? 'page' : undefined} />
    </div>
  </header>`;
}

function Tabbar({ route }) {
  const items = NAV.filter((n) => !n.desktopOnly);
  const tab = (n) => html`<a key=${n.path} class="tab" href=${`#${n.path}`} aria-current=${route.path === n.path ? 'page' : undefined}>
    <span class="tab-ico"><${Icon} name=${n.icon} /></span>${n.label}
  </a>`;
  return html`<nav class="tabbar" aria-label="Navegação principal">
    ${tab(items[0])}${tab(items[1])}
    <button type="button" class="tab tab-add" onClick=${() => openAddMenu(addContext(route))} aria-label="Adicionar compromisso, tarefa, receita, despesa ou conta">
      <span class="fab"><${Icon} name="plus" size=${26} /></span>
      <span aria-hidden="true">Adicionar</span>
    </button>
    ${tab(items[2])}${tab(items[3])}
  </nav>`;
}

function UpdateBar() {
  const [, force] = useState(0);
  useEffect(() => subscribeInstall(() => force((n) => n + 1)), []);
  if (!hasUpdate()) return null;
  return html`<div class="update-bar" role="status">
    <${Icon} name="sparkles" size=${18} />Nova versão disponível
    <button type="button" class="btn btn-primary btn-sm" onClick=${applyUpdate}>Atualizar</button>
  </div>`;
}

function View({ route, s }) {
  const p = route.params;
  switch (route.path) {
    case '/agenda':
      return html`<${AgendaView} s=${s} params=${p} />`;
    case '/financas':
      return html`<${FinanceView} s=${s} params=${p} />`;
    case '/contas':
      return html`<${BillsView} s=${s} params=${p} />`;
    case '/relatorios':
      return html`<${ReportsView} s=${s} params=${p} />`;
    case '/assistente':
      return html`<${AssistantView} s=${s} params=${p} />`;
    case '/ajustes':
      return html`<${SettingsView} s=${s} params=${p} />`;
    default:
      return html`<${HomeView} s=${s} />`;
  }
}

export function App() {
  const s = useStore();
  const route = useRoute();
  const { auth } = useCloud();
  const mainRef = useRef(null);
  const firstRoute = useRef(true);

  useEffect(() => {
    applyTheme(s.prefs.theme);
    if (s.prefs.theme !== 'auto') return undefined;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('auto');
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [s.prefs.theme]);

  useEffect(applyMotionPref, [s.prefs.motion]);

  // Ao trocar de tela: volta ao topo e anuncia o título para leitores de tela.
  useEffect(() => {
    document.title = `${TITLES[route.path] || 'Início'} · Meu Dia`;
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [route.path]);

  const locked = useLocked();

  useEffect(() => {
    if (!s.ready) return;
    startLock();
    startWidgetSync();
    startAutoBackup();
    listenLaunchRoutes(handleLaunchRoute);
    onReminderAction(handleReminderAction);
    startReminders((due) => {
      for (const r of due.slice(0, 3)) {
        const action =
          r.kind === 'bill' || r.kind === 'bill-receive'
            ? { label: r.kind === 'bill' ? 'Pagar' : 'Recebi', onClick: () => handleReminderAction('pay', r) }
            : r.kind === 'task'
              ? { label: 'Concluir', onClick: () => handleReminderAction('done', r) }
              : { label: 'Ver', onClick: () => goTo(r.route.replace(/^#/, '')) };
        toast(`${r.title} · ${r.body}`, { tone: 'reminder', duration: 10000, action });
      }
      if (due.length > 3) toast(`+ ${due.length - 3} lembretes`, { tone: 'reminder' });
    });
  }, [s.ready]);

  // Dados criados antes de entrar na conta: perguntar se junta.
  useEffect(() => {
    if (!auth.pendingMerge) return;
    choose({
      title: 'Juntar com sua conta?',
      message: `Este aparelho tem ${auth.pendingMerge.count} itens criados antes de você entrar. Quer enviá-los para a sua conta?`,
      icon: 'cloud',
      options: [
        { value: true, label: 'Sim, juntar à minha conta', variant: 'primary' },
        { value: false, label: 'Não, usar só os dados da conta', variant: 'secondary' },
      ],
      cancelValue: true,
    }).then((merge) => resolveMerge(merge));
  }, [auth.pendingMerge]);

  useEffect(() => {
    if (auth.recovery) openAuthSheet('recovery');
  }, [auth.recovery]);

  if (!s.ready) return null;
  if (!s.prefs.onboarded) {
    return html`<${Welcome} /><${Layers} /><${Toasts} />`;
  }
  if (locked) return html`<${LockScreen} />`;

  return html`
    <div id="app-shell" class="app">
      <${Sidebar} route=${route} />
      <${Topbar} route=${route} />
      <main id="app-main" class="content" tabindex="-1" ref=${mainRef} aria-label=${TITLES[route.path] || 'Início'}>
        <${View} key=${route.path} route=${route} s=${s} />
      </main>
      <${Tabbar} route=${route} />
    </div>
    <${Layers} />
    <${Toasts} />
    <${UpdateBar} />
  `;
}
