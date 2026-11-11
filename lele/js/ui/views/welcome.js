// Boas-vindas (primeira vez neste aparelho).
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { fetchIndex, installPack } from '../../data/packs.js';
import { cloudEnabled, createVault, joinVault } from '../../services/sync.js';
import { Icon } from '../components.js';

export function Welcome() {
  const [mode, setMode] = useState('intro');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true);
    try {
      const index = await fetchIndex();
      for (const p of index.filter((p) => p.starter)) await installPack(p).catch(() => {});
      store.updateMeta({ onboarded: true });
      if (cloudEnabled()) await createVault();
    } finally {
      setBusy(false);
    }
  }

  async function join(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await joinVault(code);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="welcome">
    <div class="welcome__inner">
      <img class="welcome__icon" src="./assets/icons/icon.svg" alt="" />
      <h1 class="welcome__title">App da <em>Lelé</em></h1>
      ${mode === 'intro'
        ? html`
            <p class="welcome__lead">Seus flashcards de medicina, com repetição espaçada. Feito especialmente pra você.</p>
            <ul class="welcome__steps">
              <li>
                <span class="e">🧠</span>
                <span><b>Pense antes de virar</b>Tente lembrar a resposta e só depois toque no cartão.</span>
              </li>
              <li>
                <span class="e">🎯</span>
                <span><b>Seja sincera</b>Errei, Difícil, Bom ou Fácil: o app decide quando cada cartão volta.</span>
              </li>
              <li>
                <span class="e">🔥</span>
                <span><b>Um pouquinho todo dia</b>Vale mais que maratona na véspera da prova.</span>
              </li>
            </ul>
            <div class="welcome__actions">
              <button class="btn btn--light btn--block" disabled=${busy} onClick=${start}>
                ${busy ? 'Preparando…' : 'Começar'} <${Icon} name="arrow-right" />
              </button>
              ${cloudEnabled() &&
              html`<button class="btn btn--glass btn--block" disabled=${busy} onClick=${() => setMode('join')}>
                Já uso em outro aparelho
              </button>`}
            </div>
          `
        : html`
            <p class="welcome__lead">
              Digite o código de sincronização que aparece no outro aparelho, em
              <b>Ajustes › Sincronização</b>.
            </p>
            <form onSubmit=${join}>
              <label class="field">
                <span class="sr-only">Código de sincronização</span>
                <input
                  class="input"
                  value=${code}
                  onInput=${(e) => setCode(e.currentTarget.value)}
                  placeholder="LELE-XXXXX-XXXXX-XXXXX-XXXXX"
                  autocapitalize="characters"
                  autocomplete="off"
                  autocorrect="off"
                  spellcheck="false"
                  inputmode="text"
                  aria-label="Código de sincronização"
                />
              </label>
              ${error && html`<p class="welcome__error" role="alert">${error}</p>`}
              <div class="welcome__actions" style="margin-top:20px">
                <button class="btn btn--light btn--block" type="submit" disabled=${busy || !code.trim()}>
                  ${busy ? 'Buscando seus cartões…' : 'Entrar com o código'}
                </button>
                <button class="btn btn--glass btn--block" type="button" disabled=${busy} onClick=${() => setMode('intro')}>
                  Voltar
                </button>
              </div>
            </form>
          `}
      <p class="welcome__love">feito com 💗 para a Lelé</p>
    </div>
  </div>`;
}
