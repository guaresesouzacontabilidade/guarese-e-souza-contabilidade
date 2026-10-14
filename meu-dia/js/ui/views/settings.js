// Ajustes: perfil, aparência, orçamento, lembretes, conta, instalação e dados.
import { html, useState, useRef } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { BILL_REMIND_OPTIONS } from '../../core/bills.js';
import { formatMoney } from '../../core/money.js';
import { Card, Icon, Button, Field, Chips, MoneyInput, SheetHeader, SheetActions, Hint, TextInput, Toggle } from '../components.js';
import { openSheet, confirm, toast, useCloud } from '../state.js';
import { downloadBackup, downloadTransactionsCSV, importBackupFile } from '../../data/backup.js';
import {
  notificationsSupported, permission, requestPermission, disableNotifications, needsInstallForNotifications,
} from '../../services/notifications.js';
import { isStandalone, isIOS, canPromptInstall, promptInstall } from '../../services/install.js';
import { cloudEnabled, syncNow, signOut, deleteAccount, friendlyError, unsyncedCount } from '../../services/cloud.js';
import { openAuthSheet } from './auth.js';

export const APP_VERSION = '1.0.0';

function BudgetSheet({ onClose }) {
  const [value, setValue] = useState(store.getState().settings.budget || 0);
  const save = (e) => {
    e?.preventDefault();
    store.updateSettings({ budget: value });
    toast(value ? `Orçamento de ${formatMoney(value)} por mês` : 'Orçamento removido', { tone: 'success' });
    onClose();
  };
  return html`<form class="form" onSubmit=${save} novalidate>
    <${SheetHeader} title="Orçamento mensal" subtitle="Quanto você quer gastar, no máximo, por mês." onClose=${onClose} />
    <${MoneyInput} big value=${value} onChange=${setValue} autoFocus label="Limite de gastos por mês" />
    <${Hint}>O painel mostra quanto já foi usado e quanto ainda dá para gastar por dia. Conta todas as despesas do mês.</${Hint}>
    <${SheetActions}>
      ${store.getState().settings.budget > 0 && html`<${Button} variant="secondary" onClick=${() => { setValue(0); store.updateSettings({ budget: 0 }); toast('Orçamento removido'); onClose(); }}>Remover</${Button}>`}
      <${Button} type="submit" size="lg" icon="check">Salvar</${Button}>
    </${SheetActions}>
  </form>`;
}

export function openBudgetSheet() {
  return openSheet((close) => html`<${BudgetSheet} onClose=${close} />`);
}

function Row({ icon, label, desc, onClick, end, danger }) {
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} type=${onClick ? 'button' : undefined} class="settings-row" onClick=${onClick}>
    <span class=${`cat-icon ${danger ? 'tone-danger' : ''}`}><${Icon} name=${icon} size=${20} /></span>
    <span class="grow">
      <span class="label" style=${{ display: 'block', color: danger ? 'var(--negative)' : undefined }}>${label}</span>
      ${desc && html`<span class="desc" style=${{ display: 'block' }}>${desc}</span>`}
    </span>
    ${end ?? (onClick && html`<${Icon} name="chevron-right" size=${18} />`)}
  </${Tag}>`;
}

function ThemePicker({ value }) {
  const opts = [
    { id: 'auto', label: 'Automático', icon: 'monitor' },
    { id: 'light', label: 'Claro', icon: 'sun' },
    { id: 'dark', label: 'Escuro', icon: 'moon' },
  ];
  return html`<div class="theme-pick" role="radiogroup" aria-label="Tema">
    ${opts.map(
      (o) => html`<button
        type="button"
        key=${o.id}
        role="radio"
        aria-checked=${value === o.id ? 'true' : 'false'}
        class=${`theme-opt ${value === o.id ? 'is-active' : ''}`}
        onClick=${() => store.updatePrefs({ theme: o.id })}
      >
        <${Icon} name=${o.icon} />${o.label}
      </button>`,
    )}
  </div>`;
}

function NotificationsSection({ s }) {
  const [perm, setPerm] = useState(permission());
  const supported = notificationsSupported();
  const iosNeedsInstall = needsInstallForNotifications();
  const enabled = s.prefs.notifications && perm === 'granted';

  const toggle = async (on) => {
    if (!on) {
      disableNotifications();
      return;
    }
    const result = await requestPermission();
    setPerm(result);
    if (result === 'granted') toast('Notificações ativadas', { tone: 'success' });
    else if (result === 'denied') toast('Permissão negada. Você pode liberar nos ajustes do navegador.', { tone: 'warning', duration: 6000 });
  };

  return html`<${Card} title="Lembretes" icon="bell">
    ${supported && !iosNeedsInstall
      ? html`<${Toggle}
          label="Notificações no aparelho"
          description=${perm === 'denied' ? 'Bloqueadas no navegador. Libere nas configurações do site para ativar.' : 'Só pedimos permissão quando você ativar aqui.'}
          checked=${enabled}
          onChange=${toggle}
        />`
      : html`<${Hint}>
          ${iosNeedsInstall
            ? 'No iPhone, as notificações funcionam depois de adicionar o Meu Dia à Tela de Início (veja “Instalar app” abaixo).'
            : 'Este navegador não permite notificações. Os lembretes aparecem dentro do app.'}
        </${Hint}>`}
    <${Field} label="Horário padrão dos avisos" id="rem-time" hint="Usado para contas e para tarefas sem horário.">
      <input id="rem-time" type="time" class="input" value=${s.settings.reminderTime} onChange=${(e) => e.currentTarget.value && store.updateSettings({ reminderTime: e.currentTarget.value })} />
    </${Field}>
    <div style=${{ height: '14px' }}></div>
    <${Field} label="Lembrete padrão para contas novas">
      <${Chips} label="Lembrete padrão" multiple options=${BILL_REMIND_OPTIONS} value=${s.settings.billRemind || []} onChange=${(v) => store.updateSettings({ billRemind: v })} />
    </${Field}>
    <div style=${{ height: '14px' }}></div>
    <${Hint}>Nesta versão web, os avisos aparecem enquanto o Meu Dia está aberto ou em segundo plano. Com o app fechado por completo, o aviso aparece assim que você abrir.</${Hint}>
  </${Card}>`;
}

function syncLabel(sync) {
  if (sync.state === 'syncing') return 'Sincronizando…';
  if (sync.state === 'offline') return 'Sem internet — tudo salvo neste aparelho';
  if (sync.state === 'error') return sync.error || 'Não foi possível sincronizar agora';
  if (sync.lastSyncAt) {
    const mins = Math.round((Date.now() - sync.lastSyncAt) / 60000);
    return mins < 1 ? 'Sincronizado agora' : `Sincronizado há ${mins} min`;
  }
  return 'Aguardando sincronização';
}

export function SyncStatus({ compact = false }) {
  const { auth, sync } = useCloud();
  if (!auth.enabled) return compact ? null : html`<span class="sync-status"><span class="sync-dot"></span>Salvo neste aparelho</span>`;
  if (!auth.user) return compact ? null : html`<span class="sync-status"><span class="sync-dot"></span>Sem conta conectada</span>`;
  return html`<span class="sync-status"><span class=${`sync-dot ${sync.state}`}></span>${syncLabel(sync)}</span>`;
}

function AccountSection() {
  const { auth, sync } = useCloud();
  const [busy, setBusy] = useState(false);

  if (!cloudEnabled()) {
    return html`<${Card} title="Conta e sincronização" icon="cloud">
      <${Hint} icon="cloud-off">
        A sincronização entre aparelhos ainda não foi ativada nesta instalação. Seus dados estão salvos com segurança neste aparelho — use “Exportar backup” para guardar uma cópia.
      </${Hint}>
    </${Card}>`;
  }

  if (!auth.ready) return html`<${Card} title="Conta e sincronização" icon="cloud"><p class="hero-hint">Carregando…</p></${Card}>`;

  if (!auth.user) {
    return html`<${Card} title="Conta e sincronização" icon="cloud">
      <p class="hero-hint" style=${{ marginBottom: '14px' }}>Entre para guardar seus dados na nuvem e usar no celular e no computador.</p>
      <div class="row-actions">
        <${Button} icon="log-in" onClick=${() => openAuthSheet('login')}>Entrar</${Button}>
        <${Button} variant="secondary" icon="user" onClick=${() => openAuthSheet('signup')}>Criar conta</${Button}>
      </div>
    </${Card}>`;
  }

  const pending = unsyncedCount();
  const doSignOut = async () => {
    const ok = await confirm({
      title: 'Sair da conta?',
      message: pending
        ? `Ainda há ${pending} alteração(ões) não enviadas. Conecte-se à internet antes de sair para não perdê-las.`
        : 'Seus dados continuam salvos na conta e serão removidos deste aparelho.',
      confirmLabel: 'Sair',
      icon: 'log-out',
      danger: Boolean(pending),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await signOut();
      toast('Você saiu da conta');
    } catch (err) {
      toast(friendlyError(err), { tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };
  const doDelete = async () => {
    const ok = await confirm({
      title: 'Excluir sua conta?',
      message: 'Todos os seus dados serão apagados da nuvem e deste aparelho. Isso não pode ser desfeito. Se quiser, exporte um backup antes.',
      confirmLabel: 'Excluir conta e dados',
      danger: true,
    });
    if (!ok) return;
    const sure = await confirm({ title: 'Tem certeza?', message: `A conta ${auth.user.email} será excluída definitivamente.`, confirmLabel: 'Sim, excluir tudo', danger: true });
    if (!sure) return;
    setBusy(true);
    try {
      await deleteAccount();
      toast('Conta excluída');
    } catch (err) {
      toast(friendlyError(err), { tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };

  return html`<${Card} title="Conta e sincronização" icon="cloud">
    <div class="settings-list">
      <${Row} icon="user" label=${auth.user.email} desc=${html`<${SyncStatus} />`} />
      <${Row} icon="refresh-cw" label="Sincronizar agora" desc=${pending ? `${pending} alteração(ões) aguardando envio` : 'Tudo enviado'} onClick=${() => syncNow()} end=${sync.state === 'syncing' ? html`<span class="badge">…</span>` : undefined} />
      <${Row} icon="key-round" label="Trocar senha" onClick=${() => openAuthSheet('change')} />
      <${Row} icon="log-out" label="Sair da conta" onClick=${busy ? undefined : doSignOut} />
      <${Row} icon="trash-2" label="Excluir conta" desc="Apaga a conta e todos os dados" danger onClick=${busy ? undefined : doDelete} />
    </div>
  </${Card}>`;
}

function InstallSection() {
  const [, force] = useState(0);
  if (isStandalone()) return null;
  return html`<${Card} title="Instalar app" icon="smartphone">
    ${canPromptInstall()
      ? html`<p class="hero-hint" style=${{ marginBottom: '12px' }}>Adicione o Meu Dia à tela inicial para abrir como um app, mesmo sem internet.</p>
          <${Button} icon="download" onClick=${async () => { await promptInstall(); force((n) => n + 1); }}>Instalar Meu Dia</${Button}>`
      : isIOS()
        ? html`<ol class="steps">
            <li>Toque em <strong>Compartilhar</strong> <${Icon} name="share" size=${16} className="inline-ico" /> na barra do Safari.</li>
            <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
            <li>Toque em <strong>Adicionar</strong>. Pronto!</li>
          </ol>`
        : html`<ol class="steps">
            <li>Abra o menu do navegador (⋮ ou ⋯).</li>
            <li>Escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</li>
          </ol>`}
  </${Card}>`;
}

function DataSection({ s }) {
  const fileRef = useRef(null);
  const onFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const n = await importBackupFile(file);
      toast(n ? `${n} itens importados` : 'Nada novo para importar', { tone: 'success' });
    } catch (err) {
      toast(err.message || 'Não foi possível importar', { tone: 'warning' });
    }
  };
  const clearDevice = async () => {
    const ok = await confirm({
      title: 'Apagar dados deste aparelho?',
      message: 'Compromissos, lançamentos, contas e carteiras deste aparelho serão apagados. Exporte um backup antes se quiser guardar.',
      confirmLabel: 'Apagar tudo',
      danger: true,
    });
    if (!ok) return;
    await store.resetLocal({ keepPrefs: true });
    store.updatePrefs({ onboarded: true });
    toast('Dados apagados deste aparelho');
  };
  const { auth } = useCloud();
  return html`<${Card} title="Seus dados" icon="database">
    <div class="settings-list">
      <${Row} icon="file-down" label="Exportar backup completo" desc="Arquivo .json com tudo que você registrou" onClick=${downloadBackup} />
      <${Row} icon="download" label="Exportar lançamentos (planilha)" desc="Arquivo .csv para Excel ou Planilhas" onClick=${() => downloadTransactionsCSV(s.transactions)} />
      <${Row} icon="file-up" label="Importar backup" desc="Junta um backup .json aos dados atuais" onClick=${() => fileRef.current?.click()} />
      ${!auth.user && html`<${Row} icon="trash-2" label="Apagar dados deste aparelho" danger onClick=${clearDevice} />`}
    </div>
    <input ref=${fileRef} type="file" accept="application/json,.json" hidden onChange=${onFile} />
  </${Card}>`;
}

export function SettingsView({ s, params }) {
  const [name, setName] = useState(s.settings.name || '');
  const budget = s.settings.budget;
  return html`<div class="view stack">
    <header class="page-head">
      <div>
        <h1 class="page-title">Ajustes</h1>
        <p class="page-sub">Personalize o Meu Dia</p>
      </div>
    </header>

    <${Card} title="Você" icon="user">
      <${TextInput}
        label="Como quer ser chamado?"
        placeholder="Seu nome"
        value=${name}
        onInput=${setName}
        onBlur=${() => name.trim() !== (s.settings.name || '') && store.updateSettings({ name: name.trim() })}
        maxlength="40"
        autocomplete="given-name"
      />
    </${Card}>

    <${Card} title="Aparência" icon="sun">
      <${ThemePicker} value=${s.prefs.theme} />
      <div style=${{ height: '8px' }}></div>
      <${Toggle} label="Ocultar valores" description="Esconde os valores em reais nas telas. Útil em público." checked=${s.prefs.hideValues} onChange=${(v) => store.updatePrefs({ hideValues: v })} />
    </${Card}>

    <${Card} title="Orçamento mensal" icon="target" id="orcamento" className=${params.secao === 'orcamento' ? 'card-hero' : ''}>
      <div class="settings-list">
        <${Row}
          icon="piggy-bank"
          label=${budget ? formatMoney(budget) : 'Não definido'}
          desc=${budget ? 'Limite de gastos por mês' : 'Defina para acompanhar quanto ainda pode gastar'}
          onClick=${openBudgetSheet}
        />
      </div>
    </${Card}>

    <${NotificationsSection} s=${s} />
    <${AccountSection} />
    <${InstallSection} />
    <${DataSection} s=${s} />

    <${Card} title="Sobre" icon="info">
      <p class="hero-hint">Meu Dia ${APP_VERSION} · Seus dados são seus: ficam neste aparelho${cloudEnabled() ? ' e, se você entrar, na sua conta protegida' : ''}. O app não se conecta a bancos e não movimenta dinheiro.</p>
    </${Card}>
  </div>`;
}
