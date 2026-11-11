// Criar e editar cartões.
import { html, useRef, useState, useEffect } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import * as actions from '../../data/actions.js';
import { NOTE_TYPES, validateNote, renderSide, cardOrds } from '../../core/notes.js';
import { wrapCloze, autoNumber, clozeOrds } from '../../core/cloze.js';
import { openSheet, SheetParts, toast, confirm } from '../state.js';
import { Icon, Segmented, plural } from '../components.js';
import { compressImage } from '../../services/image.js';
import { openDeckForm } from './deckForm.js';

const LAST_DECK = 'lele:last-deck';
const LAST_TYPE = 'lele:last-type';

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function openEditor({ noteId = null, deckId = null } = {}) {
  if (!noteId && !store.list('decks').length) {
    toast('Crie um baralho primeiro');
    openDeckForm();
    return;
  }
  openSheet(({ close }) => html`<${Editor} close=${close} noteId=${noteId} deckId=${deckId} />`, {
    label: noteId ? 'Editar cartão' : 'Novo cartão',
  });
}

function blankNote(deckId, type) {
  return { deckId, type, front: '', back: '', extra: '', image: null, imageSide: 'back' };
}

function Editor({ close, noteId, deckId }) {
  const existing = noteId ? store.get('notes', noteId) : null;
  const decks = [...store.list('decks')].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const initialDeck = existing?.deckId || deckId || (decks.some((d) => d.id === recall(LAST_DECK)) ? recall(LAST_DECK) : decks[0]?.id);
  const [note, setNote] = useState(() => (existing ? { ...existing } : blankNote(initialDeck, recall(LAST_TYPE) || 'basic')));
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(0);
  const frontRef = useRef();
  const media = note.image ? store.get('media', note.image) : null;
  // Imagens escolhidas e não usadas (cancelou ou trocou) são apagadas ao fechar.
  const added = useRef(new Set());
  const kept = useRef(new Set());
  useEffect(
    () => () => {
      const orphans = [...added.current].filter((id) => !kept.current.has(id) && store.get('media', id));
      if (orphans.length) store.putMany(store.tombstones('media', orphans));
    },
    [],
  );

  useEffect(() => {
    if (!existing) setTimeout(() => frontRef.current?.focus({ preventScroll: true }), 380);
  }, [saved]);

  const set = (patch) => {
    setError('');
    setNote((n) => ({ ...n, ...patch }));
  };

  function hide() {
    const el = frontRef.current;
    if (!el) return;
    const { text, cursor } = wrapCloze(note.front, el.selectionStart, el.selectionEnd);
    set({ front: text });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function wrap(field, ref, left, right = left) {
    const el = ref.current;
    if (!el) return;
    const v = note[field];
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const next = v.slice(0, a) + left + v.slice(a, b) + right + v.slice(b);
    set({ [field]: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + left.length, b + left.length);
    });
  }

  async function pickImage(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const { data, w, h } = await compressImage(file);
      const id = actions.addMedia(data, w, h);
      added.current.add(id);
      set({ image: id });
    } catch (err) {
      toast(err.message || 'Não consegui usar essa imagem.');
    }
  }

  function save(again = false) {
    const prepared = note.type === 'cloze' ? { ...note, front: autoNumber(note.front) } : note;
    const problem = validateNote(prepared);
    if (problem) {
      setError(problem);
      return;
    }
    actions.saveNote(prepared);
    if (prepared.image) kept.current.add(prepared.image);
    remember(LAST_DECK, prepared.deckId);
    remember(LAST_TYPE, prepared.type);
    const n = cardOrds(prepared).length;
    if (again) {
      toast(`Salvo! ${n > 1 ? `(${n} cartões)` : ''}`.trim());
      setNote(blankNote(prepared.deckId, prepared.type));
      setPreview(false);
      setSaved((x) => x + 1);
    } else {
      toast(existing ? 'Cartão atualizado' : n > 1 ? `${n} cartões criados` : 'Cartão criado');
      close();
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Apagar cartão?',
      text: 'Ele some de todos os aparelhos, junto com o histórico de revisões.',
      confirmLabel: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    actions.deleteNote(existing.id);
    toast('Cartão apagado');
    close();
  }

  async function reset() {
    const ok = await confirm({
      title: 'Recomeçar este cartão?',
      text: 'Ele volta a ser novo, como se nunca tivesse sido estudado.',
      confirmLabel: 'Recomeçar',
    });
    if (!ok) return;
    actions.resetNote(existing.id);
    toast('O cartão voltou a ser novo');
  }

  function toggleSuspend() {
    actions.setSuspended(existing.id, !existing.suspended);
    toast(existing.suspended ? 'O cartão voltou para as revisões' : 'Cartão pausado: não aparece nas revisões');
    close();
  }

  const isCloze = note.type === 'cloze';
  const backRef = useRef();
  const clozeCount = isCloze ? clozeOrds(autoNumber(note.front)).length : 0;

  return html`<${SheetParts}
    title=${existing ? 'Editar cartão' : 'Novo cartão'}
    close=${close}
    headExtra=${html`<button class="btn btn--ghost btn--sm" onClick=${() => setPreview(!preview)} aria-pressed=${preview ? 'true' : 'false'}>
      <${Icon} name=${preview ? 'pencil' : 'eye'} size="sm" /> ${preview ? 'Editar' : 'Ver'}
    </button>`}
    foot=${html`
      ${!existing && html`<button class="btn btn--secondary" onClick=${() => save(true)}>Salvar e novo</button>`}
      <button class="btn btn--primary" onClick=${() => save(false)}>Salvar</button>
    `}
  >
    ${preview
      ? html`<${Preview} note=${isCloze ? { ...note, front: autoNumber(note.front) } : note} media=${media} />`
      : html`
          <label class="field">
            <span class="field__label">Baralho</span>
            <select
              class="select"
              value=${note.deckId}
              onChange=${(e) => {
                if (e.currentTarget.value === '__new') {
                  e.currentTarget.value = note.deckId;
                  openDeckForm({ onSaved: (d) => set({ deckId: d.id }) });
                } else set({ deckId: e.currentTarget.value });
              }}
            >
              ${decks.map((d) => html`<option value=${d.id}>${d.emoji} ${d.name}</option>`)}
              <option value="__new">＋ Novo baralho…</option>
            </select>
          </label>

          <div class="field">
            <span class="field__label">Tipo</span>
            <${Segmented}
              label="Tipo de cartão"
              value=${note.type}
              onChange=${(type) => set({ type })}
              options=${NOTE_TYPES.map((t) => ({ id: t.id, label: t.short }))}
            />
          </div>

          ${isCloze
            ? html`
                <div class="field">
                  <span class="field__label">
                    Texto
                    <span class="muted small">${clozeCount ? plural(clozeCount, 'lacuna', 'lacunas') : ''}</span>
                  </span>
                  <div class="toolbar">
                    <button type="button" class="tool tool--accent" onMouseDown=${(e) => e.preventDefault()} onClick=${hide}>
                      <${Icon} name="square-dashed-text" /> Ocultar
                    </button>
                    <button type="button" class="tool" onMouseDown=${(e) => e.preventDefault()} onClick=${() => wrap('front', frontRef, '**')}>
                      <${Icon} name="bold" /> Negrito
                    </button>
                    <button type="button" class="tool" onMouseDown=${(e) => e.preventDefault()} onClick=${() => wrap('front', frontRef, '==')}>
                      <${Icon} name="highlighter" /> Destaque
                    </button>
                  </div>
                  <textarea
                    ref=${frontRef}
                    class="textarea textarea--tall"
                    value=${note.front}
                    onInput=${(e) => set({ front: e.currentTarget.value })}
                    placeholder="Ex.: A tríade de Beck é {{c1::hipotensão}}, {{c2::turgência jugular}} e {{c3::bulhas abafadas}}."
                    aria-label="Texto com lacunas"
                  ></textarea>
                  <p class="field__hint">Selecione um trecho e toque em <b>Ocultar</b>. Cada lacuna vira um cartão. Também vale escrever {{assim}}.</p>
                </div>
                <label class="field">
                  <span class="field__label">Extra <span class="muted small">opcional, aparece na resposta</span></span>
                  <textarea
                    ref=${backRef}
                    class="textarea"
                    value=${note.extra}
                    onInput=${(e) => set({ extra: e.currentTarget.value })}
                    placeholder="Explicação, mnemônico, fonte…"
                  ></textarea>
                </label>
              `
            : html`
                <div class="field">
                  <span class="field__label">Frente <span class="muted small">pergunta</span></span>
                  <div class="toolbar">
                    <button type="button" class="tool" onMouseDown=${(e) => e.preventDefault()} onClick=${() => wrap('front', frontRef, '**')}>
                      <${Icon} name="bold" /> Negrito
                    </button>
                    <button type="button" class="tool" onMouseDown=${(e) => e.preventDefault()} onClick=${() => wrap('front', frontRef, '==')}>
                      <${Icon} name="highlighter" /> Destaque
                    </button>
                  </div>
                  <textarea
                    ref=${frontRef}
                    class="textarea"
                    value=${note.front}
                    onInput=${(e) => set({ front: e.currentTarget.value })}
                    placeholder="Ex.: Qual o antídoto do paracetamol?"
                    aria-label="Frente"
                  ></textarea>
                </div>
                <div class="field">
                  <span class="field__label">Verso <span class="muted small">resposta</span></span>
                  <div class="toolbar">
                    <button type="button" class="tool" onMouseDown=${(e) => e.preventDefault()} onClick=${() => wrap('back', backRef, '**')}>
                      <${Icon} name="bold" /> Negrito
                    </button>
                    <button type="button" class="tool" onMouseDown=${(e) => e.preventDefault()} onClick=${() => wrap('back', backRef, '==')}>
                      <${Icon} name="highlighter" /> Destaque
                    </button>
                  </div>
                  <textarea
                    ref=${backRef}
                    class="textarea"
                    value=${note.back}
                    onInput=${(e) => set({ back: e.currentTarget.value })}
                    placeholder="Ex.: N-acetilcisteína"
                    aria-label="Verso"
                  ></textarea>
                  ${note.type === 'reverse' &&
                  html`<p class="field__hint">Vira dois cartões: frente → verso e verso → frente. Bom para termos e definições.</p>`}
                </div>
                <label class="field">
                  <span class="field__label">Extra <span class="muted small">opcional</span></span>
                  <textarea
                    class="textarea"
                    style="min-height:70px"
                    value=${note.extra}
                    onInput=${(e) => set({ extra: e.currentTarget.value })}
                    placeholder="Explicação, mnemônico, fonte…"
                  ></textarea>
                </label>
              `}

          <div class="field">
            <span class="field__label">Imagem <span class="muted small">opcional</span></span>
            ${media
              ? html`<div class="img-pick">
                  <img class="img-thumb" src=${media.data} alt="Imagem do cartão" />
                  <div style="display:grid;gap:8px;flex:1">
                    <${Segmented}
                      label="Onde mostrar a imagem"
                      value=${note.imageSide}
                      onChange=${(imageSide) => set({ imageSide })}
                      options=${[
                        { id: 'front', label: 'Na frente' },
                        { id: 'back', label: 'No verso' },
                      ]}
                    />
                    <button type="button" class="btn btn--ghost btn--sm" onClick=${() => set({ image: null })}>
                      <${Icon} name="trash-2" size="sm" /> Remover imagem
                    </button>
                  </div>
                </div>`
              : html`<label class="btn btn--secondary btn--sm" style="cursor:pointer">
                  <${Icon} name="image-plus" size="sm" /> Foto ou imagem
                  <input type="file" accept="image/*" class="sr-only" onChange=${pickImage} />
                </label>`}
          </div>

          ${error && html`<div class="notice notice--warn" role="alert"><${Icon} name="triangle-alert" size="sm" /> ${error}</div>`}

          ${existing &&
          html`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:18px">
            <button class="btn btn--ghost btn--sm" onClick=${toggleSuspend}>
              <${Icon} name=${existing.suspended ? 'play' : 'eye-off'} size="sm" /> ${existing.suspended ? 'Voltar a revisar' : 'Pausar cartão'}
            </button>
            <button class="btn btn--ghost btn--sm" onClick=${reset}><${Icon} name="rotate-ccw" size="sm" /> Recomeçar</button>
            <button class="btn btn--danger btn--sm" onClick=${remove}><${Icon} name="trash-2" size="sm" /> Apagar</button>
          </div>`}
        `}
  <//>`;
}

function Preview({ note, media }) {
  const ords = cardOrds(note);
  if (!ords.length) return html`<div class="notice"><${Icon} name="info" size="sm" /> Escreva o cartão para ver como fica.</div>`;
  return html`${ords.slice(0, 4).map(
    (ord, i) => html`
      <div class="preview">
        <div class="preview__side">${ords.length > 1 ? `Cartão ${i + 1} · ` : ''}Frente</div>
        <div class="rich" dangerouslySetInnerHTML=${{ __html: renderSide(note, ord, 'front') }}></div>
        ${media && note.imageSide === 'front' && html`<img class="flash__img" src=${media.data} alt="" />`}
      </div>
      <div class="preview">
        <div class="preview__side">Verso</div>
        <div class="rich" dangerouslySetInnerHTML=${{ __html: renderSide(note, ord, 'back') }}></div>
        ${media && note.imageSide !== 'front' && html`<img class="flash__img" src=${media.data} alt="" />`}
      </div>
    `,
  )}`;
}
