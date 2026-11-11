// Progresso: sequência, calendário, revisões, acertos e previsão.
import { html } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { bestStreak, lastDays, cardCounts, forecast, formatDuration } from '../../core/stats.js';
import { dayNumber, keyFromNumber, weekdayShort, shortDate } from '../../core/dates.js';
import { MaturityBar, plural } from '../components.js';
import { summary } from '../summary.js';

export function StatsView() {
  const sum = summary();
  const notes = store.list('notes');
  const cards = store.getState().cards;
  const counts = cardCounts(notes, cards);
  const best = bestStreak(sum.days);
  const month = lastDays(sum.days, 30);
  const monthTotal = month.reduce((a, d) => a + d.reviews, 0);
  const monthMs = month.reduce((a, d) => a + d.ms, 0);
  const studiedDays = month.filter((d) => d.reviews > 0).length;
  const fc = forecast(notes, cards, 7);
  const ret = sum.retention;
  const st = sum.streak;

  return html`<section class="view">
    <div class="topbar"><span class="topbar__title" style="font-size:28px">Progresso</span></div>

    <div class="panel">
      <div class="streak-hero">
        <div class="streak-hero__flame" aria-hidden="true">🔥</div>
        <div>
          <div class="streak-hero__n">${plural(st.current, 'dia', 'dias')}</div>
          <div class="muted">
            ${st.current
              ? st.studiedToday
                ? 'seguidos estudando. Hoje já conta!'
                : 'seguidos. Estude hoje para não perder a sequência.'
              : 'Comece hoje uma sequência nova.'}
          </div>
          ${best > 0 && html`<div class="small" style="margin-top:4px;font-weight:700">Recorde: ${plural(best, 'dia', 'dias')}</div>`}
        </div>
      </div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Calendário</h2>
      <p class="panel__sub">${plural(studiedDays, 'dia estudado', 'dias estudados')} nos últimos 30 dias</p>
      <${Heatmap} days=${sum.days} />
    </div>

    <div class="panel">
      <h2 class="panel__title">Revisões por dia</h2>
      <p class="panel__sub">${plural(monthTotal, 'resposta', 'respostas')} em 30 dias${monthMs ? ` · ${formatDuration(monthMs)} de estudo` : ''}</p>
      <${Bars} data=${month.map((d) => ({ n: d.reviews }))} />
      <div class="axis"><span>${shortDate(month[0].num)}</span><span>hoje</span></div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Acertos nas revisões</h2>
      <p class="panel__sub">Cartões que você já sabia, nos últimos 30 dias</p>
      <div class="ring">
        <${Ring} pct=${ret.pct || 0} />
        <div>
          <div class="ring__n">${ret.pct == null ? '—' : `${ret.pct}%`}</div>
          <div class="muted small">
            ${ret.pct == null
              ? 'Aparece depois das primeiras revisões.'
              : ret.pct >= 85
                ? 'Excelente memória! A meta do método é ficar entre 80% e 90%.'
                : ret.pct >= 70
                  ? 'Bom! Se estiver difícil, diminua os cartões novos por dia.'
                  : 'Muitos erros: vale estudar menos cartões novos por um tempo.'}
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2 class="panel__title">Próximos 7 dias</h2>
      <p class="panel__sub">Revisões previstas (sem contar cartões novos)</p>
      <${Bars} data=${fc.map((d, i) => ({ n: d.count, label: i === 0 ? 'hoje' : weekdayShort(d.num) }))} forecast />
    </div>

    <div class="panel">
      <h2 class="panel__title">Seus cartões</h2>
      <p class="panel__sub">${plural(counts.total, 'cartão', 'cartões')} em ${plural(store.list('decks').length, 'baralho', 'baralhos')}</p>
      <${MaturityBar} counts=${counts} />
      <div class="legend">
        <span><i style="background:var(--c-mature)"></i>${counts.mature} dominados</span>
        <span><i style="background:var(--c-young)"></i>${counts.young} recentes</span>
        <span><i style="background:var(--c-learn)"></i>${counts.learning} aprendendo</span>
        <span><i style="background:color-mix(in srgb, var(--c-new) 35%, var(--surface-3))"></i>${counts.new} novos</span>
      </div>
      <p class="muted small" style="margin:10px 0 0">“Dominados” são cartões que só voltam daqui a 3 semanas ou mais.</p>
    </div>
  </section>`;
}

function Heatmap({ days }) {
  const today = dayNumber();
  const weeks = 15;
  // Começa num domingo para as linhas serem dias da semana.
  const end = today;
  const startDow = new Date(end * 86400000).getUTCDay();
  const start = end - (weeks - 1) * 7 - startDow;
  const cells = [];
  for (let n = start; n <= end; n++) {
    const r = days.get(keyFromNumber(n))?.reviews || 0;
    const level = r === 0 ? 0 : r < 10 ? 1 : r < 30 ? 2 : r < 60 ? 3 : 4;
    cells.push(html`<i data-l=${level} class=${n === today ? 'is-today' : ''} title=${`${shortDate(n)}: ${r} respostas`}></i>`);
  }
  return html`<div class="heatmap" role="img" aria-label="Calendário de dias estudados">${cells}</div>`;
}

function Bars({ data, forecast: isForecast = false }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const showNumbers = data.length <= 10;
  return html`<div class=${`bars ${isForecast ? 'bars--forecast' : ''}`}>
    ${data.map(
      (d) => html`<div class="bars__col">
        ${showNumbers && html`<span class="bars__n">${d.n}</span>`}
        <div class=${`bars__bar ${d.n ? '' : 'is-zero'}`} style=${`height:${Math.max(2, (d.n / max) * (showNumbers ? 78 : 100))}%`}></div>
        ${d.label && html`<span class="bars__label">${d.label}</span>`}
      </div>`,
    )}
  </div>`;
}

function Ring({ pct }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return html`<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="ring__track" cx="50" cy="50" r=${r} fill="none" stroke-width="12" />
    <circle class="ring__value" cx="50" cy="50" r=${r} fill="none" stroke-width="12" stroke-linecap="round"
      stroke-dasharray=${c} stroke-dashoffset=${c * (1 - pct / 100)} />
  </svg>`;
}
