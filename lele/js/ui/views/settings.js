// Ajustes: nome, estudo, aparência, sincronização, backup.
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { cloudEnabled, createVault, joinVault, disconnect, syncNow, formatCode } from '../../services/sync.js';
import { exportBackup, readBackup, restoreBackup } from '../../data/backup.js';
import { isIOS, isStandalone } from '../../services/install.js';
import { toast, confirm, openSheet, SheetParts, useSync } from '../state.js';
import { Icon, Switch, Stepper, Segmented, plural } from '../components.js';
import { loveNoteAvailable, openLoveNote } from '../sheets/loveNote.js';

export const APP_VERSION = '1.0.0';

export function SettingsView() {
  const settings = store.settings();
  const prefs = store.getPrefs();

  function editName() {
    openSheet(({ close }) => html`<${NameSheet} close=${close} />`, { label: 'Seu nome' });
  }

  return html`<section class="view">
    <div class="topbar"><span class="topbar__title" style="font-size:28px">Ajustes</span></div>

    <div class="list">
      <button class="row" onClick=${editName}>
        <span class="row__icon"><${Icon} name="heart" /></span>
        <span class="row__body"><span class="row__title">Nome</span><span class="row__sub">Aparece na saudação do início</span></span>
        <span class="row__end">${settings.name}</span>
      </button>
    </div>

    <div class="section">
      <h2 class="section__title" style="margin-bottom:12px">Estudo</h2>
      <div class="list">
        <div class="row">
          <span class="row__icon"><${Icon} name="sparkles" /></span>
          <span class="row__body">
            <span class="row__title">Cartões novos por dia</span>
            <span class="row__sub">${settings.newPerDay ? `Até ${settings.newPerDay} novos por dia, somando todos os baralhos` : 'Só revisões, nenhum novo'}</span>
          </span>
          <${Stepper} label="Cartões novos por dia" value=${settings.newPerDay} min=${0} max=${200} step=${5} onChange=${(v) => store.updateSettings({ newPerDay: v })} />
        </div>
      </div>
      <p class="muted small" style="margin:8px 4px 0">Dica: cada cartão novo gera umas 10 revisões no primeiro mês. 20 por dia é um bom ritmo.</p>
    </div>

    <div class="section">
      <h2 class="section__title" style="margin-bottom:12px">Aparência e sons</h2>
      <div class="list">
        <div class="row" style="flex-wrap:wrap">
          <span class="row__icon"><${Icon} name="moon" /></span>
          <span class="row__body"><span class="row__title">Tema</span></span>
          <div style="flex-basis:100%;padding-left:50px">
            <${Segmented}
              label="Tema"
              value=${prefs.theme}
              onChange=${(theme) => store.updatePrefs({ theme })}
              options=${[
                { id: 'auto', label: 'Automático' },
                { id: 'light', label: 'Claro' },
                { id: 'dark', label: 'Escuro' },
              ]}
            />
          </div>
        </div>
        <div class="row">
          <span class="row__icon"><${Icon} name=${prefs.sound ? 'volume-2' : 'volume-x'} /></span>
          <span class="row__body"><span class="row__title">Sons</span><span class="row__sub">Ao virar, responder e terminar</span></span>
          <${Switch} label="Sons" checked=${prefs.sound} onChange=${(sound) => store.updatePrefs({ sound })} />
        </div>
      </div>
    </div>

    <${SyncSection} />

    ${!isStandalone() &&
    html`<div class="section">
      <h2 class="section__title" style="margin-bottom:12px">Instalar no celular</h2>
      <div class="list">
        <div class="row">
          <span class="row__icon"><${Icon} name="smartphone" /></span>
          <span class="row__body">
            <span class="row__title">${isIOS() ? 'iPhone' : 'Tela de início'}</span>
            <span class="row__sub">
              ${isIOS()
                ? html`No Safari: <b>Compartilhar</b> <${Icon} name="share" size="sm" /> › <b>Adicionar à Tela de Início</b>. Abre em tela cheia e funciona sem internet.`
                : 'No Chrome ou Edge: menu › Instalar app (ou o ícone de instalar na barra de endereço).'}
            </span>
          </span>
        </div>
      </div>
    </div>`}

    <${BackupSection} />

    <div class="section">
      <h2 class="section__title" style="margin-bottom:12px">Sobre</h2>
      <div class="list">
        ${loveNoteAvailable() &&
        html`<button class="row" onClick=${openLoveNote}>
          <span class="row__icon"><${Icon} name="mail" /></span>
          <span class="row__body"><span class="row__title">Um recado pra você 💌</span></span>
          <${Icon} name="chevron-right" />
        </button>`}
        <div class="row">
          <span class="row__icon"><${Icon} name="brain" /></span>
          <span class="row__body">
            <span class="row__title">Como o app decide</span>
            <span class="row__sub">Repetição espaçada no estilo do Anki: o que você erra volta logo; o que acerta volta cada vez mais tarde. O dia vira às 4h da manhã.</span>
          </span>
        </div>
        <${DangerRow} />
      </div>
    </div>

    <p class="footer-love">App da Lelé · versão ${APP_VERSION}<br />feito com 💗 para a Lelé</p>
  </section>`;
}

function NameSheet({ close }) {
  const [name, setName] = useState(store.settings().name);
  const save = (e) => {
    e?.preventDefault();
    store.updateSettings({ name: name.trim() || 'Lelé' });
    close();
  };
  return html`<${SheetParts} title="Seu nome" close=${close} foot=${html`<button class="btn btn--primary" onClick=${save}>Salvar</button>`}>
    <form onSubmit=${save}>
      <label class="field">
        <span class="field__label">Como o app te chama</span>
        <input class="input" value=${name} onInput=${(e) => setName(e.currentTarget.value)} maxlength="30" autofocus />
      </label>
    </form>
  <//>`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

function SyncSection() {
  const status = useSync();
  const code = store.getState().meta.syncCode;
  const [show, setShow] = useState(false);

  if (!cloudEnabled()) {
    return html`<div class="section">
      <h2 class="section__title" style="margin-bottom:12px">Sincronização</h2>
      <div class="list">
        <div class="row">
          <span class="row__icon"><${Icon} name="cloud-off" /></span>
          <span class="row__body">
            <span class="row__title">Só neste aparelho</span>
            <span class="row__sub">A sincronização ainda não foi configurada. Faça um backup de vez em quando.</span>
          </span>
        </div>
      </div>
    </div>`;
  }

  if (!code) {
    return html`<div class="section">
      <h2 class="section__title" style="margin-bottom:12px">Sincronização</h2>
      <div class="list">
        <div class="row">
          <span class="row__icon"><${Icon} name="cloud" /></span>
          <span class="row__body">
            <span class="row__title">Desligada</span>
            <span class="row__sub">Ligue para ter os mesmos cartões no iPhone e no computador, com cópia na nuvem.</span>
          </span>
        </div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button class="btn btn--primary btn--sm" onClick=${async () => {
            await createVault();
            toast('Sincronização ligada ☁️');
          }}>Ligar sincronização</button>
          <button class="btn btn--secondary btn--sm" onClick=${() => openJoin()}>Já tenho um código</button>
        </div>
      </div>
    </div>`;
  }

  const label = {
    syncing: 'Sincronizando…',
    ok: `Sincronizado ${timeAgo(status.lastSyncAt)}`,
    error: status.error || 'Erro ao sincronizar',
    offline: 'Sem internet: sincroniza quando voltar',
    idle: 'Ligada',
    off: 'Ligada',
  }[status.state];
  const pending = store.pendingCount();

  return html`<div class="section">
    <h2 class="section__title" style="margin-bottom:12px">Sincronização</h2>
    <div class="list">
      <div class="row">
        <span class="row__icon"><${Icon} name="cloud" /></span>
        <span class="row__body">
          <span class="row__title"><span class=${`sync-dot sync-dot--${status.state}`}></span> ${label}</span>
          <span class="row__sub">${pending ? `${plural(pending, 'alteração esperando', 'alterações esperando')} para enviar` : 'Tudo salvo na nuvem'}</span>
        </span>
        <button class="btn btn--ghost btn--sm" onClick=${() => syncNow()} disabled=${status.state === 'syncing'}>
          <${Icon} name="refresh-cw" size="sm" /> Agora
        </button>
      </div>
      <div class="row" style="display:block">
        <div class="row__title">Código de sincronização</div>
        <div class="row__sub">Para usar no computador ou em outro celular: abra o app lá, toque em <b>Já uso em outro aparelho</b> e digite este código. Guarde-o com carinho: quem tiver o código vê os cartões.</div>
        <code class="code" aria-label="Código de sincronização">${show ? formatCode(code) : 'LELE-•••••-•••••-•••••-•••••'}</code>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn--secondary btn--sm" onClick=${() => setShow(!show)}>
            <${Icon} name=${show ? 'eye-off' : 'eye'} size="sm" /> ${show ? 'Esconder' : 'Mostrar'}
          </button>
          <button class="btn btn--secondary btn--sm" onClick=${async () => {
            try {
              await navigator.clipboard.writeText(formatCode(code));
              toast('Código copiado');
            } catch {
              setShow(true);
              toast('Não consegui copiar. Selecione o código e copie.');
            }
          }}><${Icon} name="copy" size="sm" /> Copiar</button>
        </div>
      </div>
      <button class="row" onClick=${async () => {
        const ok = await confirm({
          title: 'Desligar a sincronização aqui?',
          text: 'Os cartões continuam neste aparelho e na nuvem, mas este aparelho para de enviar e receber mudanças. Para religar, use o mesmo código.',
          confirmLabel: 'Desligar',
        });
        if (ok) {
          disconnect();
          toast('Sincronização desligada neste aparelho');
        }
      }}>
        <span class="row__icon"><${Icon} name="log-out" /></span>
        <span class="row__body"><span class="row__title">Desligar neste aparelho</span></span>
      </button>
    </div>
  </div>`;
}

function openJoin() {
  openSheet(({ close }) => html`<${JoinSheet} close=${close} />`, { label: 'Entrar com código' });
}

function JoinSheet({ close }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasLocal = store.list('notes').length > 0;
  const go = async (e) => {
    e?.preventDefault();
    if (hasLocal) {
      const ok = await confirm({
        title: 'Trocar os cartões deste aparelho?',
        text: 'Os cartões que estão aqui serão substituídos pelos do código. Se quiser guardar estes, faça um backup antes.',
        confirmLabel: 'Trocar',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      const n = await joinVault(code);
      toast(`Pronto! ${plural(n, 'item sincronizado', 'itens sincronizados')} ☁️`);
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return html`<${SheetParts}
    title="Entrar com código"
    close=${close}
    foot=${html`<button class="btn btn--primary" disabled=${busy || !code.trim()} onClick=${go}>${busy ? 'Buscando…' : 'Entrar'}</button>`}
  >
    <form onSubmit=${go}>
      <label class="field">
        <span class="field__label">Código do outro aparelho</span>
        <input
          class="input"
          value=${code}
          onInput=${(e) => setCode(e.currentTarget.value)}
          placeholder="LELE-XXXXX-XXXXX-XXXXX-XXXXX"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          style="font-family:ui-monospace,Menlo,monospace;text-transform:uppercase"
          autofocus
        />
        <p class="field__hint">Fica em Ajustes › Sincronização, no aparelho onde ela já está ligada.</p>
      </label>
      ${error && html`<div class="notice notice--warn" role="alert">${error}</div>`}
    </form>
  <//>`;
}

function BackupSection() {
  async function doImport(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const data = await readBackup(file);
      const ok = await confirm({
        title: 'Restaurar este backup?',
        text: 'Os cartões do backup são juntados aos que já estão aqui. Nos repetidos, vale a versão do backup.',
        confirmLabel: 'Restaurar',
      });
      if (!ok) return;
      const n = restoreBackup(data);
      toast(`${plural(n, 'item restaurado', 'itens restaurados')}`);
    } catch (err) {
      toast(err.message);
    }
  }
  return html`<div class="section">
    <h2 class="section__title" style="margin-bottom:12px">Backup</h2>
    <div class="list">
      <button class="row" onClick=${() => exportBackup().catch((err) => toast(err.message))}>
        <span class="row__icon"><${Icon} name="download" /></span>
        <span class="row__body"><span class="row__title">Salvar backup</span><span class="row__sub">Um arquivo .json com todos os baralhos, cartões e histórico</span></span>
      </button>
      <label class="row" style="cursor:pointer">
        <span class="row__icon"><${Icon} name="upload" /></span>
        <span class="row__body"><span class="row__title">Restaurar backup</span><span class="row__sub">Abrir um arquivo salvo antes</span></span>
        <input type="file" accept=".json,application/json" class="sr-only" onChange=${doImport} />
      </label>
    </div>
  </div>`;
}

function DangerRow() {
  return html`<button class="row row--danger" onClick=${async () => {
    const code = store.getState().meta.syncCode;
    const ok = await confirm({
      title: 'Apagar os dados deste aparelho?',
      text: code
        ? `Os cartões somem deste aparelho, mas continuam na nuvem. Para trazer de volta, use o código ${formatCode(code)} (anote antes!).`
        : 'Todos os baralhos, cartões e o histórico deste aparelho serão apagados. Não dá para desfazer.',
      confirmLabel: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    disconnect();
    await store.resetLocal({ onboarded: false });
    location.hash = '#/';
  }}>
    <span class="row__icon"><${Icon} name="trash-2" /></span>
    <span class="row__body"><span class="row__title">Apagar dados deste aparelho</span></span>
  </button>`;
}
