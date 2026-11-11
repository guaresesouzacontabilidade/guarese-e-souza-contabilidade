// Estudo: um cartão por vez, virar e responder.
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import * as actions from '../../data/actions.js';
import { pickNext, afterAnswer, sessionCounts, nextLearningDue } from '../../core/queue.js';
import { previewIntervals, formatInterval, newCardState, AGAIN, HARD, GOOD, EASY } from '../../core/srs.js';
import { parseCardId, renderSide, imageOnSide } from '../../core/notes.js';
import { formatDuration } from '../../core/stats.js';
import { back, hasOpenSheet, toast, useStore } from '../state.js';
import { Icon, IconButton, plural } from '../components.js';
import { confetti, sounds, haptic } from '../../services/fx.js';
import { openEditor } from '../sheets/editor.js';
import { openLoveNote, loveNoteAvailable } from '../sheets/loveNote.js';

const BUTTONS = [
  { r: AGAIN, label: 'Errei', cls: 'answer--again', key: '1' },
  { r: HARD, label: 'Difícil', cls: 'answer--hard', key: '2' },
  { r: GOOD, label: 'Bom', cls: 'answer--good', key: '3' },
  { r: EASY, label: 'Fácil', cls: 'answer--easy', key: '4' },
];

const CHEERS = [
  'Orgulho define, Lelé!',
  'Mais um dia de constância. É assim que se vira médica.',
  'Seu eu do futuro (e da prova) agradece.',
  'Cérebro alimentado com sucesso!',
  'Revisão feita, coração tranquilo.',
  'Arrasou! Pode descansar com a consciência leve.',
];

export function StudyView({ params }) {
  useStore();
  const cram = params.modo === 'treino';
  const deckIds = useMemo(() => (params.deck ? new Set([params.deck]) : null), [params.deck]);
  const deck = params.deck ? store.get('decks', params.deck) : null;

  const initial = useMemo(() => {
    if (cram) {
      const ids = actions.cramQueue(deckIds);
      return { learning: [], main: ids.map((id) => ({ id, kind: 'cram' })) };
    }
    const q = actions.todayQueue(deckIds);
    return { learning: q.learning, main: q.main };
  }, []);

  const [session, setSession] = useState(initial);
  const [current, setCurrent] = useState(() => pickNext(initial, Date.now()));
  const [revealed, setRevealed] = useState(false);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ answered: 0, correct: 0, start: Date.now() });
  const [seq, setSeq] = useState(0);
  const shownAt = useRef(Date.now());
  const [cramMisses, setCramMisses] = useState({});
  const total0 = useRef(initial.main.length + initial.learning.length);

  const s = store.getState();
  const { noteId, ord } = current ? parseCardId(current.id) : {};
  const note = current ? store.get('notes', noteId) : null;
  const cardDeck = note ? store.get('decks', note.deckId) : null;

  // Cartão apagado ou editado no meio da sessão (sem esta lacuna): pula.
  useEffect(() => {
    if (current && (!note || !cardStillExists(note, ord))) advance(skip(session, current.id));
  }, [current, note]);

  function skip(sess, id) {
    return { learning: sess.learning.filter((c) => c.id !== id), main: sess.main.filter((c) => c.id !== id) };
  }

  function advance(nextSession) {
    const nxt = pickNext(nextSession, Date.now());
    setSession(nextSession);
    setCurrent(nxt);
    setRevealed(false);
    setSeq((n) => n + 1);
    shownAt.current = Date.now();
    if (!nxt) finish();
  }

  function finish() {
    sounds.done();
    confetti();
  }

  function reveal() {
    if (!current || revealed) return;
    setRevealed(true);
    sounds.flip();
  }

  function rate(r) {
    if (!current || !revealed) return;
    const now = Date.now();
    const ms = now - shownAt.current;
    haptic(8);
    if (r === AGAIN) sounds.again();
    else sounds.good();
    setStats((st) => ({ ...st, answered: st.answered + 1, correct: st.correct + (r > AGAIN ? 1 : 0) }));
    if (cram) {
      let nextSession = skip(session, current.id);
      const misses = cramMisses[current.id] || 0;
      if (r === AGAIN && misses < 3) {
        nextSession = { ...nextSession, main: [...nextSession.main, { id: current.id, kind: 'cram' }] };
        setCramMisses({ ...cramMisses, [current.id]: misses + 1 });
      }
      setHistory([...history, { session, current }]);
      advance(nextSession);
      return;
    }
    const undo = actions.recordAnswer(current.id, r, { ms, now });
    setHistory([...history.slice(-30), { undo, session, current, r }]);
    advance(afterAnswer(session, current.id, undo.next, now));
  }

  function undoLast() {
    const h = history[history.length - 1];
    if (!h) return;
    if (h.undo) actions.undoAnswer(h.undo);
    setHistory(history.slice(0, -1));
    setSession(h.session);
    setCurrent(h.current);
    setRevealed(false);
    setSeq((n) => n + 1);
    setStats((st) => ({ ...st, answered: Math.max(0, st.answered - 1), correct: Math.max(0, st.correct - (h.r > AGAIN ? 1 : 0)) }));
    shownAt.current = Date.now();
    toast('Resposta desfeita');
  }

  function editCurrent() {
    if (note) openEditor({ noteId: note.id });
  }

  // Atalhos de teclado (computador).
  const keyRef = useRef();
  keyRef.current = (e) => {
    if (hasOpenSheet() || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      undoLast();
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (!revealed) reveal();
      else rate(GOOD);
    } else if (revealed && ['1', '2', '3', '4'].includes(k)) {
      if (cram && !['1', '3'].includes(k)) return;
      rate(Number(k));
    } else if (k === 'e') editCurrent();
    else if (k === 'escape') back('/');
  };
  useEffect(() => {
    const on = (e) => keyRef.current(e);
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  // Cartões em aprendizado voltam sozinhos quando chega a hora.
  useEffect(() => {
    if (current || cram) return;
    const due = nextLearningDue(session);
    if (!due) return;
    const t = setTimeout(() => advance(session), Math.max(1000, due - Date.now() + 500));
    return () => clearTimeout(t);
  }, [current, session]);

  const counts = sessionCounts(session);
  const remaining = session.main.length + session.learning.length;
  const progress = total0.current ? Math.min(1, stats.answered / (stats.answered + remaining || 1)) : 0;

  return html`<div class="study">
    <div class="study__top">
      <${IconButton} icon="x" label="Fechar" onClick=${() => back('/')} />
      <div class="study__counts" aria-label="Cartões restantes">
        ${cram
          ? html`<span class="muted">${deck ? deck.name : 'Treino livre'} · ${remaining}</span>`
          : html`
              <span style="color:var(--c-new)" class=${current?.kind === 'new' ? 'is-current' : ''} title="Novos">${counts.fresh}</span>
              <span style="color:var(--c-learn)" class=${current?.kind === 'learning' ? 'is-current' : ''} title="Aprendendo">${counts.learning}</span>
              <span style="color:var(--c-review)" class=${current?.kind === 'review' ? 'is-current' : ''} title="Para revisar">${counts.review}</span>
            `}
      </div>
      <${IconButton} icon="undo-2" label="Desfazer" onClick=${undoLast} disabled=${!history.length} />
      <${IconButton} icon="pencil" label="Editar cartão" onClick=${editCurrent} disabled=${!note} />
    </div>
    <div class="study__progress" aria-hidden="true"><span style=${`width:${progress * 100}%`}></span></div>

    ${current && note
      ? html`
          <div class="study__stage">
            <div class="flash-wrap" key=${seq}>
              <div
                class=${`flash ${revealed ? 'is-flipped' : ''}`}
                style=${`--deck-color:${cardDeck?.color || 'var(--accent)'}`}
                onClick=${reveal}
                role="button"
                tabindex="0"
                aria-label=${revealed ? 'Resposta' : 'Pergunta. Toque para ver a resposta'}
              >
                <${Face} note=${note} ord=${ord} side="front" deck=${cardDeck} media=${s.media} />
                <${Face} note=${note} ord=${ord} side="back" deck=${cardDeck} media=${s.media} />
              </div>
            </div>
          </div>
          <div class="study__actions">
            ${revealed
              ? cram
                ? html`<div class="answers answers--two">
                    <button class="answer answer--again" onClick=${() => rate(AGAIN)}><span class="answer__label">Errei</span><span class="answer__ivl">de novo no fim</span></button>
                    <button class="answer answer--good" onClick=${() => rate(GOOD)}><span class="answer__label">Acertei</span><span class="answer__ivl">próximo</span></button>
                  </div>`
                : html`<${AnswerButtons} id=${current.id} onRate=${rate} cards=${s.cards} />`
              : html`<button class="btn btn--primary reveal" onClick=${reveal}>Mostrar resposta</button>`}
            <p class="kbd-hint">Espaço: virar / Bom · 1–4: responder · Z: desfazer · E: editar · Esc: sair</p>
          </div>
        `
      : html`<${Done} stats=${stats} session=${session} cram=${cram} deck=${deck} />`}
  </div>`;
}

function cardStillExists(note, ord) {
  if (note.type === 'cloze') return new RegExp(`\\{\\{c${ord}::`).test(note.front);
  if (note.type === 'reverse') return ord === 0 || (ord === 1 && note.back?.trim());
  return ord === 0;
}

function Face({ note, ord, side, deck, media }) {
  const img = imageOnSide(note, ord, side) ? media[note.image]?.data : null;
  const longText = (note.front?.length || 0) + (note.back?.length || 0) > 260;
  const isCloze = note.type === 'cloze';
  return html`<div class=${`flash__face ${side === 'back' ? 'flash__back' : ''}`}>
    <div class="flash__scroll">
      <div class="flash__deck"><span>${deck?.emoji || '📚'}</span> ${deck?.name || ''}${note.context ? ` · ${note.context}` : ''}</div>
      <div class=${`flash__content rich ${longText ? 'flash__content--left' : ''}`}>
        ${side === 'back' && !isCloze
          ? html`<div class="flash__question rich" dangerouslySetInnerHTML=${{ __html: renderSide(note, ord, 'front') }}></div>
              <div class="flash__answer" dangerouslySetInnerHTML=${{ __html: renderSide(note, ord, 'back') }}></div>`
          : html`<div dangerouslySetInnerHTML=${{ __html: renderSide(note, ord, side) }}></div>`}
        ${img && html`<img class="flash__img" src=${img} alt="Imagem do cartão" />`}
      </div>
      ${side === 'front' && html`<p class="flash__hint">Toque para virar</p>`}
    </div>
  </div>`;
}

function AnswerButtons({ id, onRate, cards }) {
  const card = cards[id] && !cards[id].deleted ? cards[id] : newCardState();
  const ivls = previewIntervals(card, Date.now());
  return html`<div class="answers">
    ${BUTTONS.map(
      (b) => html`<button class=${`answer ${b.cls}`} onClick=${() => onRate(b.r)} aria-label=${`${b.label}, volta em ${formatInterval(ivls[b.r])}`}>
        <span class="answer__label">${b.label}</span>
        <span class="answer__ivl">${formatInterval(ivls[b.r])}</span>
      </button>`,
    )}
  </div>`;
}

function Done({ stats, session, cram, deck }) {
  const later = nextLearningDue(session);
  const pct = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : null;
  const elapsed = Date.now() - stats.start;
  const [cheer] = useState(() => CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  const [noteShown, setNoteShown] = useState(false);
  const showLove = !cram && stats.answered > 0 && loveNoteAvailable() && !store.getState().meta.loveSeen;

  if (!stats.answered) {
    const hasCards = deck ? store.list('notes').some((n) => n.deckId === deck.id) : store.list('notes').length > 0;
    return html`<div class="done">
      <div class="done__art">🌷</div>
      <h2 class="done__title">Nada para estudar agora</h2>
      <p class="done__text">
        ${later
          ? `Alguns cartões em aprendizado voltam em ${Math.max(1, Math.round((later - Date.now()) / 60000))} min.`
          : 'Você está em dia. Que tal um treino livre, sem mexer na agenda?'}
      </p>
      <div class="done__actions">
        ${hasCards &&
        html`<a class="btn btn--primary btn--block" href=${`#/estudar?modo=treino${deck ? `&deck=${deck.id}` : ''}`}
          ><${Icon} name="shuffle" /> Treino livre</a
        >`}
        <button class="btn btn--secondary btn--block" onClick=${() => back('/')}>Voltar</button>
      </div>
    </div>`;
  }

  return html`<div class="done">
    <div class="done__art">${cram ? '💪' : '🎉'}</div>
    <h2 class="done__title">${cram ? 'Treino concluído!' : 'Revisão concluída!'}</h2>
    <p class="done__text">${cheer}</p>
    <div class="done__stats">
      <div class="stat"><div class="stat__value">${stats.answered}</div><div class="stat__label">respostas</div></div>
      <div class="stat"><div class="stat__value">${pct}%</div><div class="stat__label">acertos</div></div>
      <div class="stat"><div class="stat__value">${formatDuration(elapsed)}</div><div class="stat__label">de estudo</div></div>
    </div>
    ${later &&
    html`<p class="done__text small">
      ${plural(session.learning.length, 'cartão ainda volta', 'cartões ainda voltam')} em ${Math.max(1, Math.round((later - Date.now()) / 60000))} min.
      Pode deixar esta tela aberta que eles aparecem sozinhos.
    </p>`}
    <div class="done__actions">
      ${showLove &&
      !noteShown &&
      html`<button
        class="btn btn--soft btn--block"
        onClick=${() => {
          setNoteShown(true);
          store.updateMeta({ loveSeen: true });
          openLoveNote();
        }}
      >
        <${Icon} name="mail" /> Tem um recado pra você 💌
      </button>`}
      <button class="btn btn--primary btn--block" onClick=${() => back('/')}>Voltar ao início</button>
    </div>
  </div>`;
}
