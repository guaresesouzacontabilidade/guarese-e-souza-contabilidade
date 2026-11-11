// Importar vários cartões de uma vez (texto colado ou arquivo).
import { html, useMemo, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import * as actions from '../../data/actions.js';
import { parseImport, SEPARATORS } from '../../core/importer.js';
import { plainText } from '../../core/rich.js';
import { openSheet, SheetParts, toast, navigate } from '../state.js';
import { Icon, plural } from '../components.js';

export function openImport({ deckId = null } = {}) {
  openSheet(({ close }) => html`<${ImportSheet} close=${close} deckId=${deckId} />`, { label: 'Importar cartões' });
}

const EXAMPLE = `Antídoto do paracetamol ; N-acetilcisteína
Tríade de Beck ; Hipotensão, turgência jugular e bulhas abafadas
O {{c1::nervo frênico}} inerva o {{c2::diafragma}}`;

function ImportSheet({ close, deckId }) {
  const decks = [...store.list('decks')].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const [target, setTarget] = useState(deckId || decks[0]?.id || '__new');
  const [newName, setNewName] = useState('');
  const [text, setText] = useState('');
  const [sep, setSep] = useState('auto');
  const [error, setError] = useState('');

  const result = useMemo(() => (text.trim() ? parseImport(text, sep) : null), [text, sep]);
  const cloze = result ? result.cards.filter((c) => c.type === 'cloze').length : 0;

  async function readFile(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (file.size > 5_000_000) {
      setError('Arquivo grande demais (máx. 5 MB).');
      return;
    }
    setText(await file.text());
    if (!newName && target === '__new') setNewName(file.name.replace(/\.[^.]+$/, ''));
  }

  function run() {
    if (!result?.cards.length) {
      setError('Não encontrei cartões no texto. Confira o formato no exemplo abaixo.');
      return;
    }
    let id = target;
    if (target === '__new') {
      if (!newName.trim()) {
        setError('Dê um nome ao baralho novo.');
        return;
      }
      id = actions.createDeck({ name: newName }).id;
    }
    const n = actions.importCards(id, result.cards);
    toast(`${plural(n, 'cartão importado', 'cartões importados')} 🎉`);
    close();
    navigate(`/baralho/${id}`);
  }

  return html`<${SheetParts}
    title="Importar cartões"
    close=${close}
    foot=${html`<button class="btn btn--primary" disabled=${!result?.cards.length} onClick=${run}>
      ${result?.cards.length ? `Importar ${plural(result.cards.length, 'cartão', 'cartões')}` : 'Importar'}
    </button>`}
  >
    <label class="field">
      <span class="field__label">Para o baralho</span>
      <select class="select" value=${target} onChange=${(e) => setTarget(e.currentTarget.value)}>
        ${decks.map((d) => html`<option value=${d.id}>${d.emoji} ${d.name}</option>`)}
        <option value="__new">＋ Baralho novo…</option>
      </select>
    </label>
    ${target === '__new' &&
    html`<label class="field">
      <span class="field__label">Nome do baralho novo</span>
      <input class="input" value=${newName} onInput=${(e) => setNewName(e.currentTarget.value)} placeholder="Ex.: Farmacologia" />
    </label>`}

    <div class="field">
      <span class="field__label">
        Cartões
        <label class="btn btn--ghost btn--sm" style="cursor:pointer">
          <${Icon} name="file-up" size="sm" /> Abrir arquivo
          <input type="file" accept=".txt,.csv,.tsv,.md,text/plain,text/csv" class="sr-only" onChange=${readFile} />
        </label>
      </span>
      <textarea
        class="textarea textarea--tall"
        value=${text}
        onInput=${(e) => {
          setText(e.currentTarget.value);
          setError('');
        }}
        placeholder="Cole aqui: uma pergunta por linha, separando a resposta com ponto e vírgula"
        aria-label="Texto para importar"
      ></textarea>
      <p class="field__hint">Exemplo:</p>
      <pre class="example">${EXAMPLE}</pre>
    </div>

    <label class="field">
      <span class="field__label">Separador</span>
      <select class="select" value=${sep} onChange=${(e) => setSep(e.currentTarget.value)}>
        ${SEPARATORS.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
      </select>
      ${result && sep === 'auto' && html`<p class="field__hint">Detectado: ${SEPARATORS.find((s) => s.id === result.separator)?.label}</p>`}
    </label>

    ${result &&
    html`<div class=${`notice ${result.cards.length ? 'notice--ok' : 'notice--warn'}`}>
        <${Icon} name=${result.cards.length ? 'circle-check' : 'triangle-alert'} size="sm" />
        <span>
          ${result.cards.length
            ? `${plural(result.cards.length, 'cartão encontrado', 'cartões encontrados')}${cloze ? ` (${cloze} de lacunas)` : ''}.`
            : 'Nenhum cartão encontrado.'}
          ${result.skipped.length ? ` ${plural(result.skipped.length, 'linha ficou', 'linhas ficaram')} de fora (sem resposta).` : ''}
        </span>
      </div>
      <div class="import-list">
        ${result.cards.slice(0, 5).map(
          (c) => html`<div class="import-item">
            <b>${plainText(c.front)}</b>
            <span>${c.type === 'cloze' ? 'Lacunas' : plainText(c.back)}</span>
          </div>`,
        )}
        ${result.cards.length > 5 && html`<p class="muted small" style="margin:4px 2px">e mais ${result.cards.length - 5}…</p>`}
      </div>`}
    ${error && html`<div class="notice notice--warn" role="alert" style="margin-top:12px">${error}</div>`}
  <//>`;
}
