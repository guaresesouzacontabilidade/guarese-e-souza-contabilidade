// Repetição espaçada no estilo do Anki (SM-2 com etapas de aprendizado).
// Respostas: 1 = Errei, 2 = Difícil, 3 = Bom, 4 = Fácil.
import { dayNumber, dayStart, MINUTE, DAY } from './dates.js';

export const AGAIN = 1;
export const HARD = 2;
export const GOOD = 3;
export const EASY = 4;

export const DEFAULT_SRS = Object.freeze({
  learnSteps: [1, 10], // minutos
  relearnSteps: [10], // minutos
  graduatingIvl: 1, // dias
  easyIvl: 4, // dias
  startEase: 2.5,
  minEase: 1.3,
  hardFactor: 1.2,
  easyBonus: 1.3,
  maxIvl: 36500,
  leechThreshold: 8,
});

export function newCardState() {
  return { state: 'new', due: 0, step: 0, ivl: 0, ease: DEFAULT_SRS.startEase, reps: 0, lapses: 0, lastReview: 0 };
}

const clampEase = (e, cfg) => Math.max(cfg.minEase, Math.round(e * 1000) / 1000);

function hardDelay(steps, step) {
  if (step === 0 && steps.length > 1) return (steps[0] + steps[1]) / 2;
  if (step === 0) return Math.min(steps[0] * 1.5, steps[0] + 1440);
  return steps[Math.min(step, steps.length - 1)];
}

// Pequena variação nos intervalos longos para os cartões não vencerem todos no mesmo dia.
function fuzz(ivl, rng) {
  if (!rng || ivl < 3) return ivl;
  const spread = ivl < 7 ? 1 : Math.max(1, Math.round(ivl * 0.05));
  return ivl + Math.round((rng() * 2 - 1) * spread);
}

// Calcula os novos intervalos de revisão (em dias) para Difícil, Bom e Fácil.
function reviewIntervals(card, now, cfg) {
  const today = dayNumber(now);
  const dueDay = card.due ? dayNumber(card.due) : today;
  const late = Math.max(0, today - dueDay);
  const ivl = Math.max(1, card.ivl || 1);
  const hard = Math.max(ivl + 1, Math.round(ivl * cfg.hardFactor));
  const good = Math.max(hard + 1, Math.round((ivl + late / 2) * card.ease));
  const easy = Math.max(good + 1, Math.round((ivl + late) * card.ease * cfg.easyBonus));
  const cap = (d) => Math.min(cfg.maxIvl, d);
  return { [HARD]: cap(hard), [GOOD]: cap(good), [EASY]: cap(easy) };
}

const graduate = (card, ivl, now, cfg) => ({
  ...card,
  state: 'review',
  step: 0,
  ivl: Math.min(cfg.maxIvl, ivl),
  due: dayStart(dayNumber(now) + Math.min(cfg.maxIvl, ivl)),
});

/**
 * Aplica uma resposta ao cartão e devolve o novo estado de agendamento.
 * `rng` (opcional) adiciona variação aos intervalos longos.
 */
export function answer(card, rating, now = Date.now(), cfg = DEFAULT_SRS, rng = null) {
  const base = { ...newCardState(), ...card };
  let next;
  if (base.state === 'new' || base.state === 'learning') {
    const steps = cfg.learnSteps;
    const step = base.state === 'new' ? 0 : base.step;
    if (rating === AGAIN) next = { ...base, state: 'learning', step: 0, due: now + steps[0] * MINUTE };
    else if (rating === HARD) next = { ...base, state: 'learning', step, due: now + hardDelay(steps, step) * MINUTE };
    else if (rating === GOOD) {
      next = step + 1 < steps.length
        ? { ...base, state: 'learning', step: step + 1, due: now + steps[step + 1] * MINUTE }
        : graduate(base, cfg.graduatingIvl, now, cfg);
    } else next = graduate(base, cfg.easyIvl, now, cfg);
    if (base.state === 'new') next.ease = cfg.startEase;
  } else if (base.state === 'relearning') {
    const steps = cfg.relearnSteps.length ? cfg.relearnSteps : [10];
    const step = base.step;
    if (rating === AGAIN) next = { ...base, step: 0, due: now + steps[0] * MINUTE };
    else if (rating === HARD) next = { ...base, step, due: now + hardDelay(steps, step) * MINUTE };
    else if (rating === GOOD) {
      next = step + 1 < steps.length
        ? { ...base, step: step + 1, due: now + steps[step + 1] * MINUTE }
        : graduate(base, Math.max(1, base.ivl), now, cfg);
    } else next = graduate(base, Math.max(1, base.ivl) + 1, now, cfg);
  } else {
    // Revisão
    if (rating === AGAIN) {
      const ease = clampEase(base.ease - 0.2, cfg);
      next = cfg.relearnSteps.length
        ? { ...base, state: 'relearning', step: 0, ease, ivl: 1, lapses: base.lapses + 1, due: now + cfg.relearnSteps[0] * MINUTE }
        : { ...graduate(base, 1, now, cfg), ease, lapses: base.lapses + 1 };
    } else {
      const ivls = reviewIntervals(base, now, cfg);
      let ivl = fuzz(ivls[rating], rng);
      ivl = Math.max(ivl, (base.ivl || 0) + 1);
      let ease = base.ease;
      if (rating === HARD) ease = clampEase(ease - 0.15, cfg);
      if (rating === EASY) ease = clampEase(ease + 0.15, cfg);
      next = { ...graduate(base, ivl, now, cfg), ease };
    }
  }
  next.reps = base.reps + 1;
  next.lastReview = now;
  return next;
}

// Quanto tempo até o cartão voltar, para cada botão (sem variação).
export function previewIntervals(card, now = Date.now(), cfg = DEFAULT_SRS) {
  const out = {};
  for (const r of [AGAIN, HARD, GOOD, EASY]) {
    const next = answer(card, r, now, cfg, null);
    out[r] = next.state === 'review' ? { days: next.ivl } : { minutes: Math.max(1, Math.round((next.due - now) / MINUTE)) };
  }
  return out;
}

export function formatInterval(iv) {
  if (iv.minutes != null) {
    const m = iv.minutes;
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h`;
    return formatInterval({ days: Math.round(m / 1440) });
  }
  const d = iv.days;
  if (d < 1) return '<1 dia';
  if (d === 1) return '1 dia';
  if (d < 30) return `${d} dias`;
  const months = d / 30.4;
  if (months < 12) {
    const v = Math.round(months * 10) / 10;
    return `${String(v).replace('.', ',')} ${v < 2 ? 'mês' : 'meses'}`;
  }
  const years = Math.round((d / 365) * 10) / 10;
  return `${String(years).replace('.', ',')} ${years < 2 ? 'ano' : 'anos'}`;
}

// Classificação do cartão para estatísticas e listas.
export function maturity(card) {
  if (!card || card.state === 'new') return 'new';
  if (card.state === 'learning' || card.state === 'relearning') return 'learning';
  return card.ivl >= 21 ? 'mature' : 'young';
}

export const isLeech = (card, cfg = DEFAULT_SRS) => (card?.lapses || 0) >= cfg.leechThreshold;

export const daysUntil = (card, now = Date.now()) => Math.round((card.due - now) / DAY);
