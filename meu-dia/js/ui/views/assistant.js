// Assistente financeiro em formato de conversa.
import { html, useEffect, useRef, useState } from '../../vendor/preact.js';
import { ask, EXAMPLE_QUESTIONS } from '../../core/assistant.js';
import { todayISO } from '../../core/dates.js';
import { getState } from '../../data/store.js';
import { Icon, Button, Chips, Hint } from '../components.js';
import { goTo } from '../state.js';
import { openAddForm } from '../forms/add.js';

// A conversa fica na memória enquanto o app está aberto.
let conversation = [];
let seq = 0;

function Answer({ a }) {
  const hasHow = (a.steps && a.steps.length) || (a.items && a.items.length && a.total);
  return html`<div class="bubble">
    <p class="answer">${a.text}</p>
    ${a.items && a.items.length > 0 && !a.total && html`<ul>${a.items.map((it, i) => html`<li key=${i}>${it}</li>`)}</ul>`}
    ${a.extra && html`<p class="extra">${a.extra}</p>`}
    ${hasHow &&
    html`<details class="how">
      <summary><${Icon} name="list-checks" size=${16} />Como calculei</summary>
      <ol>
        ${(a.steps || []).map((st, i) => html`<li key=${i}>${st}</li>`)}
      </ol>
      ${a.items && a.items.length > 0 && a.total && html`<ul class="calc-items">${a.items.map((it, i) => html`<li key=${i}>${it}</li>`)}</ul>`}
      ${a.total && html`<p class="total">${a.total}</p>`}
    </details>`}
    ${a.action &&
    html`<div>
      <${Button}
        variant="secondary"
        size="sm"
        icon=${a.action.add ? 'plus' : 'arrow-right'}
        onClick=${() => (a.action.add ? openAddForm(a.action.add) : goTo(a.action.route.replace(/^#/, '')))}
      >
        ${a.action.label}
      </${Button}>
    </div>`}
  </div>`;
}

export function AssistantView({ params }) {
  const [, force] = useState(0);
  const [text, setText] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const send = (question) => {
    const q = (question ?? text).trim();
    if (!q) return;
    const s = getState();
    const answer = ask(q, { ...s, today: todayISO() });
    conversation = [...conversation, { id: ++seq, role: 'user', text: q }, { id: ++seq, role: 'bot', answer }].slice(-40);
    setText('');
    force((n) => n + 1);
  };

  // Pergunta vinda de outro lugar (ex.: atalho da tela inicial).
  useEffect(() => {
    if (!params.q) return;
    send(params.q);
    window.history.replaceState(window.history.state, '', '#/assistente');
  }, [params.q]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation.length]);

  const last = conversation[conversation.length - 1];
  const suggestions = last?.answer?.suggestions?.length ? last.answer.suggestions : EXAMPLE_QUESTIONS.slice(0, 5);

  return html`<div class="view stack">
    <header class="page-head">
      <div>
        <h1 class="page-title">Assistente</h1>
        <p class="page-sub">Pergunte sobre seus gastos, contas e agenda</p>
      </div>
      ${conversation.length > 0 &&
      html`<button
        type="button"
        class="link-btn"
        onClick=${() => {
          conversation = [];
          force((n) => n + 1);
        }}
      >
        <span>Limpar</span>
      </button>`}
    </header>

    <div class="chat" aria-live="polite">
      ${conversation.length === 0 &&
      html`<div class="msg bot">
        <span class="bot-avatar"><${Icon} name="sparkles" size=${18} /></span>
        <div class="bubble">
          <p class="answer">Olá! Eu respondo com base no que você registrou e mostro como fiz cada conta.</p>
          <p class="extra">Experimente uma das perguntas abaixo ou escreva do seu jeito.</p>
        </div>
      </div>`}
      ${conversation.map((m) =>
        m.role === 'user'
          ? html`<div class="msg user" key=${m.id}>${m.text}</div>`
          : html`<div class="msg bot" key=${m.id}>
              <span class="bot-avatar"><${Icon} name="sparkles" size=${18} /></span>
              <${Answer} a=${m.answer} />
            </div>`,
      )}
      <div ref=${endRef}></div>
    </div>

    <div class="composer">
      <${Chips} label="Sugestões" options=${suggestions.map((q) => ({ id: q, label: q }))} value=${null} onChange=${(q) => q && send(q)} wrap=${false} />
      <form
        class="composer-row"
        onSubmit=${(e) => {
          e.preventDefault();
          send();
          inputRef.current?.focus();
        }}
      >
        <label for="ask" class="sr-only">Sua pergunta</label>
        <input id="ask" ref=${inputRef} value=${text} onInput=${(e) => setText(e.currentTarget.value)} placeholder="Ex.: Quanto gastei com mercado?" autocomplete="off" enterkeyhint="send" maxlength="200" />
        <button type="submit" class="send-btn" aria-label="Enviar pergunta" disabled=${!text.trim()}><${Icon} name="send" size=${20} /></button>
      </form>
      ${conversation.length === 0 && html`<${Hint} icon="shield-check">Usa só os seus dados, não faz pagamentos nem transferências e não promete resultados.</${Hint}>`}
    </div>
  </div>`;
}
