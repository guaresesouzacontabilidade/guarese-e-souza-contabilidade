// Primeira abertura: uma tela só, sem tutorial.
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { Icon, Button, TextInput } from '../components.js';
import { cloudEnabled } from '../../services/cloud.js';
import { openAuthSheet } from './auth.js';

export function Welcome() {
  const [name, setName] = useState('');
  const start = (e) => {
    e?.preventDefault();
    if (name.trim()) store.updateSettings({ name: name.trim() });
    store.updatePrefs({ onboarded: true });
  };
  return html`<main class="welcome">
    <form class="welcome-card" onSubmit=${start}>
      <img class="welcome-logo" src="./assets/icons/icon.svg" alt="" width="76" height="76" />
      <div>
        <h1>Seu dia e seu dinheiro, <span class="grad">organizados</span>.</h1>
        <p class="lead">Agenda, tarefas, contas e finanças num só lugar — simples de verdade.</p>
      </div>
      <ul class="features">
        <li><span class="f-ico"><${Icon} name="calendar-check" /></span>Compromissos e tarefas com lembrete</li>
        <li><span class="f-ico"><${Icon} name="wallet" /></span>Gastos, receitas e orçamento do mês</li>
        <li><span class="f-ico"><${Icon} name="sparkles" /></span>Assistente que responde sobre seus gastos</li>
      </ul>
      <${TextInput} label="Como quer ser chamado? (opcional)" placeholder="Seu nome" value=${name} onInput=${setName} autocomplete="given-name" maxlength="40" />
      <${Button} type="submit" size="lg" icon="arrow-right">Começar</${Button}>
      ${cloudEnabled() &&
      html`<${Button}
        variant="ghost"
        icon="log-in"
        onClick=${() => {
          store.updatePrefs({ onboarded: true });
          setTimeout(() => openAuthSheet('login'), 50);
        }}
      >
        Já tenho conta
      </${Button}>`}
      <p class="fine">
        <${Icon} name="lock" size=${14} className="inline-ico" />
        ${cloudEnabled() ? ' Seus dados ficam neste aparelho. Crie uma conta quando quiser sincronizar.' : ' Seus dados ficam salvos neste aparelho.'}
      </p>
    </form>
  </main>`;
}
