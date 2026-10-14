// Assistente financeiro: entende perguntas simples em português e responde
// apenas com os dados registrados pelo usuário, mostrando como chegou ao resultado.
import {
  addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear,
  formatNumeric, formatDayMonth, MONTHS, WEEKDAYS, weekday,
} from './dates.js';
import { formatMoney, formatPercent, sumBy } from './money.js';
import { normalize, plural, joinList } from './text.js';
import { totals, byCategory, budgetStatus, walletBalance, live } from './finance.js';
import { categoryFromTerm, findCategory } from './categories.js';
import { billsDueBetween, openBills } from './bills.js';
import { occurrencesInRange, overdueTasks } from './agenda.js';
import { comparePeriods, periodLabel } from './reports.js';

export const EXAMPLE_QUESTIONS = [
  'Quanto gastei este mês?',
  'Quanto gastei com combustível?',
  'Quais contas vencem esta semana?',
  'Quanto ainda tenho no orçamento?',
  'Qual foi meu maior gasto?',
  'Onde gastei mais este mês?',
  'Comparar com o mês passado',
  'O que tenho na agenda hoje?',
];

const SOURCE_NOTE = 'Calculado só com o que você registrou no Meu Dia.';
const MAX_ITEMS = 8;

// ---------- Períodos ----------

const MONTH_NORMAL = MONTHS.map((m) => normalize(m));
const WEEKDAY_NORMAL = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function period(from, to, label, text, explicit = true) {
  return { from, to, label, text, explicit };
}

export function parsePeriod(q, today, { pastBias = true } = {}) {
  let m;
  if ((m = q.match(/\b(?:nos |nas )?ultim[oa]s (\d{1,3}) dias\b/))) {
    const n = Number(m[1]);
    return period(addDays(today, -(n - 1)), today, `nos últimos ${n} dias`, m[0]);
  }
  if ((m = q.match(/\b(?:nos )?ultimos (\d{1,2}) meses\b/))) {
    const n = Number(m[1]);
    return period(startOfMonth(addMonths(today, -(n - 1))), endOfMonth(today), `nos últimos ${n} meses`, m[0]);
  }
  if ((m = q.match(/\b(?:de |para |pra )?hoje\b/))) return period(today, today, 'hoje', m[0]);
  if ((m = q.match(/\b(?:de |para |pra )?ontem\b/))) return period(addDays(today, -1), addDays(today, -1), 'ontem', m[0]);
  if ((m = q.match(/\b(?:de |para |pra )?amanha\b/))) return period(addDays(today, 1), addDays(today, 1), 'amanhã', m[0]);
  if ((m = q.match(/\b(?:na |da )?(?:semana passada|ultima semana)\b/))) {
    const s = addDays(startOfWeek(today), -7);
    return period(s, addDays(s, 6), 'na semana passada', m[0]);
  }
  if ((m = q.match(/\b(?:na |da |para a |pra )?(?:proxima semana|semana que vem)\b/))) {
    const s = addDays(startOfWeek(today), 7);
    return period(s, addDays(s, 6), 'na próxima semana', m[0]);
  }
  if ((m = q.match(/\b(?:(?:esta|essa|nesta|nessa|na|da|desta|dessa) )?semana\b/))) {
    return period(startOfWeek(today), endOfWeek(today), 'esta semana', m[0]);
  }
  if ((m = q.match(/\b(?:no |do )?(?:mes passado|ultimo mes|mes anterior)\b/))) {
    const d = addMonths(today, -1);
    return period(startOfMonth(d), endOfMonth(d), `em ${MONTHS[Number(d.slice(5, 7)) - 1]}`, m[0]);
  }
  if ((m = q.match(/\b(?:no |do |para o )?(?:proximo mes|mes que vem)\b/))) {
    const d = addMonths(today, 1);
    return period(startOfMonth(d), endOfMonth(d), `em ${MONTHS[Number(d.slice(5, 7)) - 1]}`, m[0]);
  }
  if ((m = q.match(/\b(?:no |do )?ano passado\b/))) {
    const y = Number(today.slice(0, 4)) - 1;
    return period(`${y}-01-01`, `${y}-12-31`, `em ${y}`, m[0]);
  }
  if ((m = q.match(/\b(?:(?:este|esse|neste|nesse|no|do|deste|desse) )?ano\b/))) {
    return period(startOfYear(today), endOfYear(today), 'este ano', m[0]);
  }
  // Mês só conta com preposição ou ano junto ("em março", "março de 2025"), para não confundir "Marco" (nome).
  const months = MONTH_NORMAL.join('|');
  const monthRe = new RegExp(`\\b(?:(?:em|no|de|do|desde|ate|mes de) (${months})(?: (?:de )?(\\d{4}))?|(${months}) (?:de )?(\\d{4}))\\b|^(${months})$`);
  if ((m = q.match(monthRe))) {
    const name = m[1] || m[3] || m[5];
    const yearText = m[2] || m[4];
    const idx = MONTH_NORMAL.indexOf(name);
    let year = yearText ? Number(yearText) : Number(today.slice(0, 4));
    if (!yearText && pastBias && idx + 1 > Number(today.slice(5, 7))) year -= 1;
    const start = `${year}-${String(idx + 1).padStart(2, '0')}-01`;
    return period(start, endOfMonth(start), `em ${MONTHS[idx]}${year !== Number(today.slice(0, 4)) ? ` de ${year}` : ''}`, m[0]);
  }
  const wd = q.match(/\b(?:(?:na|no|de|da|do|nesta|neste|nessa|nesse|esta|este|essa|esse|proxima|proximo|ultima|ultimo|passada|passado) )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?: feira)?(?: (?:passada|passado|que vem))?\b/);
  if (wd) {
    const target = WEEKDAY_NORMAL.indexOf(wd[1]);
    const past = /\b(ultima|ultimo|passada|passado)\b/.test(wd[0]) || (pastBias && !/\b(proxima|proximo|que vem)\b/.test(wd[0]));
    let diff = target - weekday(today);
    if (past && diff > 0) diff -= 7;
    if (!past && diff < 0) diff += 7;
    const day = addDays(today, diff);
    const masc = target === 0 || target === 6; // domingo e sábado
    const article = diff < 0 ? (masc ? 'no último' : 'na última') : masc ? 'no' : 'na';
    const label = diff === 0 ? 'hoje' : `${article} ${WEEKDAYS[target]} (${formatNumeric(day).slice(0, 5)})`;
    return period(day, day, label, wd[0]);
  }
  if ((m = q.match(/\b(?:(?:este|esse|neste|nesse|no|do|deste|desse) )?mes\b/))) {
    return period(startOfMonth(today), endOfMonth(today), 'este mês', m[0]);
  }
  if ((m = q.match(/\b(?:em |de )?(20\d{2})\b/))) {
    return period(`${m[1]}-01-01`, `${m[1]}-12-31`, `em ${m[1]}`, m[0]);
  }
  return null;
}

const thisMonth = (today) => period(startOfMonth(today), endOfMonth(today), 'este mês', '', false);

// ---------- Intenções ----------

const has = (q, re) => re.test(q);

export function detectIntent(q) {
  if (has(q, /\b(pode pagar|consegue pagar|faca (um )?pix|fazer (um )?pix|faz (um )?pix|transfira|transferir|transfere|envie dinheiro|mandar dinheiro|investir por mim|aplique)\b/)) return 'action';
  if (has(q, /^(pague|paga|quita|quite)\b/) || has(q, /\b(pague|paga|pagar)\b.*\b(pra mim|por mim)\b/)) return 'action';
  if (has(q, /^(oi|ola|bom dia|boa tarde|boa noite|e ai)\b/) && q.split(' ').length <= 3) return 'hello';
  if (has(q, /\b(ajuda|o que voce (faz|sabe|consegue)|como (funciona|te uso|usar)|exemplos?)\b/)) return 'help';
  if (has(q, /\b(dica|dicas|economizar|economia|gastar menos|sugest\w*|organizar (minhas|meu|as) (financas|dinheiro|contas))\b/)) return 'tips';
  if (has(q, /\b(orcamento|posso gastar|ainda posso|limite (do mes|mensal|de gastos))\b/)) return 'budget';
  if (has(q, /\b(tenho (que|pra|para|a) (pagar|receber)|falta (pagar|receber)|faltam pagar|preciso pagar|vou (pagar|receber)|a pagar|a receber)\b/)) return 'bills';
  if (has(q, /\b(contas?|boletos?|faturas?)\b/) && has(q, /\b(venc\w*|pagar|receber|aberto|abertas|pendentes?|atrasad\w*|proximas?|tenho que pagar|falta pagar|faltam)\b/)) return 'bills';
  if (has(q, /\b(boletos?)\b/)) return 'bills';
  if (has(q, /\b(compar\w*|em relacao ao|versus|vs|diferenca)\b/) || has(q, /\b(mais|menos) (do )?que (no |em )?(o )?mes passado\b/)) return 'compare';
  if (has(q, /\b(maior|maiores) (gasto|gastos|despesa|despesas|compra|compras|saida|saidas)\b/) || has(q, /\b(gasto|despesa|compra) mais (cara|caro|alta|alto)\b/)) return 'biggest';
  if (has(q, /\b(onde|com o que|com que|em que|no que|para onde|pra onde)\b.*\b(gastei|gasto|gastando|vai|foi)\b/) || has(q, /\b(por categoria|categorias?)\b/) || has(q, /\b(mais gastei|gastei mais)\b/)) return 'categories';
  if (has(q, /\b(compromissos?|agenda|tarefas?|reunio\w*|marcado|o que tenho (hoje|amanha|para|pra|essa|esta|nessa|nesta|neste|nesse|na|no|dia|de)|o que (eu )?tenho\??$)\b/)) return 'agenda';
  if (has(q, /\b(saldo|sobrou|sobra|quanto (eu )?tenho|dinheiro (eu )?tenho|balanco)\b/)) return 'balance';
  if (has(q, /\b(recebi|ganhei|receitas?|entrou|entradas?|faturei|renda)\b/)) return 'income';
  if (has(q, /\b(gastei|gasto|gastos|gastamos|despesas?|paguei|custou|saiu|saidas?)\b/)) return 'spend';
  return 'unknown';
}

// Extrai o termo depois de "gastei com ...", "recebi de ...".
export function extractTerm(q, keywordRe) {
  const m = q.match(keywordRe);
  if (!m) return '';
  let rest = q.slice(m.index + m[0].length).trim();
  rest = rest.replace(/^(eu |ja |ate agora |no total |ao todo |total |so |somente |apenas |muito |mais |bastante |tanto |demais |ao todo )+/g, '');
  const pm = rest.match(/^(?:com|em|no|na|nos|nas|de|do|da|dos|das|pra|para|pro|pela|pelo|o|a|os|as)\s+(.+)$/);
  if (!pm) return '';
  let term = pm[1];
  term = term.replace(/\b(ate agora|no total|ao todo|por favor|pf|ai)\b/g, '').trim();
  for (let i = 0; i < 3; i++) term = term.replace(/\s+(em|no|na|de|do|da|com|nos|nas|neste|nesse|este|esse|ate|desde|e|o|a)$/, '').trim();
  term = term.replace(/^(o|a|os|as|meu|minha|meus|minhas)\s+/, '').trim();
  return term.length >= 2 ? term : '';
}

function removePeriodText(q, p) {
  return p && p.text ? q.replace(p.text, ' ').replace(/\s+/g, ' ').trim() : q;
}

// ---------- Respostas ----------

const money = formatMoney;

function txLine(t, custom) {
  const cat = findCategory(t.category, t.type, custom);
  return `${formatNumeric(t.date).slice(0, 5)} · ${t.description}${t.category ? ` (${cat.label})` : ''} · ${money(t.amount)}`;
}

function listItems(list, custom, max = MAX_ITEMS) {
  const sorted = [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
  const lines = sorted.slice(0, max).map((t) => txLine(t, custom));
  if (sorted.length > max) lines.push(`… e mais ${sorted.length - max} ${sorted.length - max === 1 ? 'lançamento' : 'lançamentos'}.`);
  return lines;
}

function noFinanceData(ctx) {
  return live(ctx.transactions).length === 0;
}

function emptyFinance() {
  return {
    kind: 'no-data',
    text: 'Ainda não há receitas nem despesas registradas, então não tenho como calcular isso.',
    steps: ['Assim que você registrar seus lançamentos, eu respondo com base neles.'],
    action: { label: 'Registrar despesa', add: 'expense' },
    suggestions: ['O que você consegue fazer?'],
  };
}

function rangeText(p) {
  return periodLabel(p.from, p.to);
}

function filterByTerm(list, term, type, custom) {
  if (!term) return { list, filterText: '', note: '' };
  const cat = categoryFromTerm(term, custom);
  if (cat && cat.exact) {
    return { list: list.filter((t) => t.category === cat.category.id), filterText: `com ${cat.category.label}`, filterStep: `da categoria ${cat.category.label}`, category: cat.category };
  }
  const nt = normalize(term);
  const byDesc = list.filter((t) => normalize(`${t.description} ${t.notes || ''}`).includes(nt));
  if (byDesc.length) {
    return { list: byDesc, filterText: `com “${term}”`, filterStep: `com “${term}” na descrição` };
  }
  if (cat) {
    return {
      list: list.filter((t) => t.category === cat.category.id),
      filterText: `com ${cat.category.label}`,
      notFoundText: `com “${term}” nem na categoria ${cat.category.label}`,
      filterStep: `da categoria ${cat.category.label} (entendi “${term}” como ${cat.category.label})`,
      category: cat.category,
      viaKeyword: true,
    };
  }
  return { list: [], filterText: `com “${term}”`, filterStep: `com “${term}” na descrição ou categoria`, notFound: true };
}

function answerSpend(q, ctx, p) {
  if (noFinanceData(ctx)) return emptyFinance();
  const custom = ctx.settings?.customCategories || [];
  const term = extractTerm(removePeriodText(q, p), /\b(gastei|gasto|gastos|gastamos|despesas?|paguei|custou|saiu|saidas?)\b/);
  const all = totals(ctx.transactions, p.from, p.to).list.filter((t) => t.type === 'expense');
  const f = filterByTerm(all, term, 'expense', custom);
  const total = sumBy(f.list, (t) => t.amount);
  const steps = [`Período: ${rangeText(p)}.`];

  if (!f.list.length) {
    return {
      kind: 'no-data',
      text: term ? `Não encontrei despesas ${f.notFoundText || f.filterText} ${p.label}.` : `Não há despesas registradas ${p.label}.`,
      steps: [...steps, term ? `Procurei despesas ${f.filterStep}.` : 'Nenhuma despesa com data nesse período.', SOURCE_NOTE],
      suggestions: ['Onde gastei mais este mês?', 'Quanto gastei no mês passado?'],
    };
  }

  steps.push(`Somei ${plural(f.list.length, 'despesa', 'despesas')}${f.filterStep ? ` ${f.filterStep}` : ''}:`);
  const result = {
    kind: 'answer',
    text: f.viaKeyword
      ? `Não achei “${term}” nas descrições. Considerando toda a categoria ${f.category.label}, ${p.label} você gastou ${money(total)}.`
      : `${capitalizeFirst(p.label)} você gastou ${money(total)}${f.filterText ? ` ${f.filterText}` : ''}.`,
    steps,
    items: listItems(f.list, custom),
    total: `Total: ${money(total)}`,
    suggestions: [],
  };
  if (term && all.length) {
    const allTotal = sumBy(all, (t) => t.amount);
    if (allTotal > total) result.extra = `Isso é ${formatPercent(total / allTotal)} de todas as despesas do período (${money(allTotal)}).`;
    result.suggestions = ['Onde gastei mais este mês?', 'Comparar com o mês passado'];
  } else {
    const cats = byCategory(f.list, 'expense', custom).slice(0, 3);
    if (cats.length > 1) result.extra = `Maiores categorias: ${joinList(cats.map((c) => `${c.category.label} (${money(c.total)})`))}.`;
    result.suggestions = ['Qual foi meu maior gasto?', 'Quanto ainda tenho no orçamento?', 'Comparar com o mês passado'];
  }
  steps.push(SOURCE_NOTE);
  return result;
}

function answerIncome(q, ctx, p) {
  if (noFinanceData(ctx)) return emptyFinance();
  const custom = ctx.settings?.customCategories || [];
  const term = extractTerm(removePeriodText(q, p), /\b(recebi|ganhei|receitas?|entrou|entradas?|faturei|renda)\b/);
  const all = totals(ctx.transactions, p.from, p.to).list.filter((t) => t.type === 'income');
  const f = filterByTerm(all, term, 'income', custom);
  const total = sumBy(f.list, (t) => t.amount);
  if (!f.list.length) {
    return {
      kind: 'no-data',
      text: term ? `Não encontrei receitas ${f.notFoundText || f.filterText} ${p.label}.` : `Não há receitas registradas ${p.label}.`,
      steps: [`Período: ${rangeText(p)}.`, SOURCE_NOTE],
      action: { label: 'Registrar receita', add: 'income' },
      suggestions: ['Quanto gastei este mês?'],
    };
  }
  return {
    kind: 'answer',
    text: f.viaKeyword
      ? `Não achei “${term}” nas descrições. Considerando toda a categoria ${f.category.label}, ${p.label} você recebeu ${money(total)}.`
      : `${capitalizeFirst(p.label)} você recebeu ${money(total)}${f.filterText ? ` ${f.filterText}` : ''}.`,
    steps: [`Período: ${rangeText(p)}.`, `Somei ${plural(f.list.length, 'receita', 'receitas')}${f.filterStep ? ` ${f.filterStep}` : ''}:`, SOURCE_NOTE],
    items: listItems(f.list, custom),
    total: `Total: ${money(total)}`,
    suggestions: ['Qual o saldo do mês?', 'Quanto gastei este mês?'],
  };
}

function answerBalance(q, ctx, p) {
  const wallets = live(ctx.wallets || []);
  const asksWallets = /\b(carteira|carteiras|conta bancaria|contas bancarias|banco|bancos|no total|guardado)\b/.test(q) || (/\bquanto (eu )?tenho\b/.test(q) && !p.explicit);
  if (asksWallets && wallets.length) {
    const lines = wallets.map((w) => ({ w, bal: walletBalance(w, ctx.transactions) }));
    const total = sumBy(lines, (l) => l.bal);
    return {
      kind: 'answer',
      text: `Somando suas carteiras, você tem ${money(total)}.`,
      steps: ['Para cada carteira: saldo inicial + receitas − despesas lançadas nela.', SOURCE_NOTE],
      items: lines.map((l) => `${l.w.name} · ${money(l.bal)}`),
      total: `Total: ${money(total)}`,
      extra: 'Lançamentos sem carteira escolhida não entram nessa soma.',
      suggestions: ['Quanto gastei este mês?', 'Quais contas vencem esta semana?'],
    };
  }
  if (noFinanceData(ctx)) return emptyFinance();
  const t = totals(ctx.transactions, p.from, p.to);
  if (!t.count) {
    return { kind: 'no-data', text: `Não há lançamentos ${p.label}.`, steps: [`Período: ${rangeText(p)}.`, SOURCE_NOTE], suggestions: ['Quanto gastei no mês passado?'] };
  }
  const word = t.balance >= 0 ? 'sobraram' : 'faltaram';
  return {
    kind: 'answer',
    text: `${capitalizeFirst(p.label)} ${word} ${money(Math.abs(t.balance))}: você recebeu ${money(t.income)} e gastou ${money(t.expense)}.`,
    steps: [`Período: ${rangeText(p)}.`, `Receitas: ${money(t.income)}`, `Despesas: ${money(t.expense)}`, `${money(t.income)} − ${money(t.expense)} = ${money(t.balance)}`, SOURCE_NOTE],
    extra: wallets.length && asksWallets ? '' : wallets.length ? 'Para ver quanto há em cada carteira, pergunte “Quanto tenho nas carteiras?”.' : '',
    suggestions: ['Onde gastei mais este mês?', 'Comparar com o mês passado'],
  };
}

function answerBudget(q, ctx) {
  const today = ctx.today;
  const budget = ctx.settings?.budget || 0;
  if (!budget) {
    return {
      kind: 'no-data',
      text: 'Você ainda não definiu um orçamento mensal, então não consigo dizer quanto resta.',
      steps: ['O orçamento é o quanto você pretende gastar por mês. Defina em Ajustes › Orçamento mensal.'],
      action: { label: 'Definir orçamento', route: '#/ajustes?secao=orcamento' },
      suggestions: ['Quanto gastei este mês?'],
    };
  }
  const t = totals(ctx.transactions, startOfMonth(today), endOfMonth(today));
  const s = budgetStatus(budget, t.expense, today);
  const steps = [
    `Orçamento mensal: ${money(budget)}`,
    `Despesas de ${periodLabel(startOfMonth(today), endOfMonth(today))}: ${money(t.expense)}`,
    `${money(budget)} − ${money(t.expense)} = ${money(s.remaining)}`,
  ];
  let text;
  if (s.remaining >= 0) {
    text = `Você ainda tem ${money(s.remaining)} no orçamento deste mês (usou ${formatPercent(s.ratio)}).`;
    steps.push(`Faltam ${plural(s.daysLeft, 'dia', 'dias')} no mês: cerca de ${money(s.perDay)} por dia.`);
  } else {
    text = `Você passou ${money(-s.remaining)} do orçamento deste mês.`;
  }
  const pending = billsDueBetween(ctx.bills || [], today, endOfMonth(today), { kind: 'pay', includeOverdue: true, today });
  let extra = '';
  if (pending.length && s.remaining >= 0) {
    const sum = sumBy(pending, (b) => b.amount);
    const after = s.remaining - sum;
    extra = `Ainda há ${plural(pending.length, 'conta', 'contas')} a pagar até o fim do mês (${money(sum)}). ${after >= 0 ? `Pagando todas, sobram ${money(after)}.` : `Pagando todas, o orçamento estoura em ${money(-after)}.`}`;
  }
  steps.push(SOURCE_NOTE);
  return { kind: 'answer', text, steps, extra, suggestions: ['Onde gastei mais este mês?', 'Quais contas vencem esta semana?'] };
}

function answerBills(q, ctx, p) {
  const today = ctx.today;
  const kind = /\b(receber|recebo|a receber)\b/.test(q) ? 'receive' : 'pay';
  const kindWord = kind === 'receive' ? 'a receber' : 'a pagar';
  const all = (ctx.bills || []).filter((b) => !b.deleted && b.kind === kind);
  if (!all.length) {
    return {
      kind: 'no-data',
      text: `Você ainda não cadastrou contas ${kindWord}.`,
      steps: ['Cadastre suas contas para eu avisar o que vence e quando.'],
      action: { label: 'Cadastrar conta', add: 'bill' },
      suggestions: ['Quanto gastei este mês?'],
    };
  }
  const onlyOverdue = /\b(vencid\w*|atrasad\w*)\b/.test(q);
  const overdue = billsDueBetween(all, '0000-01-01', addDays(today, -1), { kind });
  if (onlyOverdue) {
    if (!overdue.length) return { kind: 'answer', text: `Nenhuma conta ${kindWord} está vencida.`, steps: [SOURCE_NOTE], suggestions: ['Quais contas vencem esta semana?'] };
    const sum = sumBy(overdue, (b) => b.amount);
    return {
      kind: 'answer',
      text: `${plural(overdue.length, 'conta vencida', 'contas vencidas')} ${kindWord}, somando ${money(sum)}.`,
      steps: ['Contas em aberto com vencimento antes de hoje:', SOURCE_NOTE],
      items: overdue.map((b) => `${formatNumeric(b.dueDate).slice(0, 5)} · ${b.description} · ${money(b.amount)}`),
      total: `Total: ${money(sum)}`,
      action: { label: 'Ver contas', route: '#/contas' },
      suggestions: ['Quais contas vencem esta semana?'],
    };
  }
  const range = p || period(today, addDays(today, 30), 'nos próximos 30 dias', '', false);
  const from = range.from < today && range.to >= today ? today : range.from;
  const list = billsDueBetween(all, from, range.to, { kind });
  const sum = sumBy(list, (b) => b.amount);
  const steps = [`Período: ${periodLabel(from, range.to)}. Considerei só contas ${kindWord} ainda em aberto.`];
  let extra = '';
  if (overdue.length && range.to >= today) {
    extra = `Atenção: ${plural(overdue.length, 'conta já está vencida', 'contas já estão vencidas')} (${money(sumBy(overdue, (b) => b.amount))}).`;
  }
  steps.push(SOURCE_NOTE);
  if (!list.length) {
    return {
      kind: 'answer',
      text: `Nenhuma conta ${kindWord} vence ${range.label}.`,
      steps,
      extra,
      action: overdue.length ? { label: 'Ver contas', route: '#/contas' } : null,
      suggestions: ['Quais contas vencem este mês?', 'Quanto ainda tenho no orçamento?'],
    };
  }
  const verbo = list.length === 1 ? 'vence' : 'vencem';
  return {
    kind: 'answer',
    text: `${capitalizeFirst(range.label)} ${verbo} ${plural(list.length, `conta ${kindWord}`, `contas ${kindWord}`)}, somando ${money(sum)}.`,
    steps,
    items: list.map((b) => `${formatNumeric(b.dueDate).slice(0, 5)} · ${b.description} · ${money(b.amount)}`),
    total: `Total: ${money(sum)}`,
    extra,
    action: { label: 'Ver contas', route: '#/contas' },
    suggestions: ['Quanto ainda tenho no orçamento?', 'Quanto gastei este mês?'],
  };
}

function answerBiggest(q, ctx, p) {
  if (noFinanceData(ctx)) return emptyFinance();
  const custom = ctx.settings?.customCategories || [];
  const list = totals(ctx.transactions, p.from, p.to).list.filter((t) => t.type === 'expense');
  if (!list.length) {
    return { kind: 'no-data', text: `Não há despesas registradas ${p.label}.`, steps: [`Período: ${rangeText(p)}.`, SOURCE_NOTE], suggestions: ['Qual foi meu maior gasto no mês passado?'] };
  }
  const sorted = [...list].sort((a, b) => b.amount - a.amount || (a.date < b.date ? 1 : -1));
  const top = sorted[0];
  const cats = byCategory(list, 'expense', custom);
  const total = sumBy(list, (t) => t.amount);
  return {
    kind: 'answer',
    text: `Seu maior gasto ${p.label} foi “${top.description}”: ${money(top.amount)} em ${formatDayMonth(top.date, ctx.today)}.`,
    steps: [`Período: ${rangeText(p)}.`, `Comparei ${plural(list.length, 'despesa', 'despesas')} (total de ${money(total)}). As maiores:`, SOURCE_NOTE],
    items: sorted.slice(0, 5).map((t) => txLine(t, custom)),
    extra: cats.length > 1 ? `A categoria com mais gastos foi ${cats[0].category.label}: ${money(cats[0].total)} (${formatPercent(cats[0].share)} do total).` : '',
    suggestions: ['Onde gastei mais este mês?', 'Comparar com o mês passado'],
  };
}

function answerCategories(q, ctx, p) {
  if (noFinanceData(ctx)) return emptyFinance();
  const custom = ctx.settings?.customCategories || [];
  const list = totals(ctx.transactions, p.from, p.to).list.filter((t) => t.type === 'expense');
  if (!list.length) {
    return { kind: 'no-data', text: `Não há despesas registradas ${p.label}.`, steps: [`Período: ${rangeText(p)}.`, SOURCE_NOTE], suggestions: ['Onde gastei mais no mês passado?'] };
  }
  const cats = byCategory(list, 'expense', custom);
  const total = sumBy(list, (t) => t.amount);
  return {
    kind: 'answer',
    text: `${capitalizeFirst(p.label)} você gastou mais com ${cats[0].category.label}: ${money(cats[0].total)} (${formatPercent(cats[0].share)} das despesas).`,
    steps: [`Período: ${rangeText(p)}.`, `Agrupei ${plural(list.length, 'despesa', 'despesas')} por categoria (total de ${money(total)}):`, SOURCE_NOTE],
    items: cats.slice(0, 6).map((c) => `${c.category.label} · ${money(c.total)} · ${formatPercent(c.share)}`),
    total: `Total: ${money(total)}`,
    action: { label: 'Ver relatório', route: '#/relatorios' },
    suggestions: ['Qual foi meu maior gasto?', 'Comparar com o mês passado'],
  };
}

function answerCompare(q, ctx, p) {
  if (noFinanceData(ctx)) return emptyFinance();
  // "Comparar com o mês passado": o período citado é a referência, então o atual é este mês/semana.
  let range = p && p.explicit ? p : thisMonth(ctx.today);
  if (p && /passad|anterior|ultim/.test(p.text)) {
    range = /semana/.test(p.text)
      ? period(startOfWeek(ctx.today), endOfWeek(ctx.today), 'esta semana', '')
      : /ano/.test(p.text)
        ? period(startOfYear(ctx.today), endOfYear(ctx.today), 'este ano', '')
        : thisMonth(ctx.today);
  }
  const custom = ctx.settings?.customCategories || [];
  const c = comparePeriods(ctx.transactions, range.from, range.to, ctx.today, custom);
  const steps = [
    `Período atual: ${periodLabel(c.cur.from, c.cur.to)} — despesas ${money(c.curTotals.expense)}, receitas ${money(c.curTotals.income)}.`,
    `Período anterior: ${periodLabel(c.prev.from, c.prev.to)} — despesas ${money(c.prevTotals.expense)}, receitas ${money(c.prevTotals.income)}.`,
  ];
  if (c.partial) steps.push('Como o período atual ainda não terminou, comparei os mesmos dias do período anterior.');
  steps.push(SOURCE_NOTE);
  if (!c.curTotals.count && !c.prevTotals.count) {
    return { kind: 'no-data', text: 'Não há lançamentos suficientes nos dois períodos para comparar.', steps, suggestions: ['Quanto gastei este mês?'] };
  }
  return {
    kind: 'answer',
    text: c.sentences[0] || 'Não há despesas suficientes para comparar.',
    steps,
    items: c.sentences.slice(1),
    action: { label: 'Ver relatório', route: '#/relatorios' },
    suggestions: ['Onde gastei mais este mês?', 'Quanto ainda tenho no orçamento?'],
  };
}

function answerAgenda(q, ctx, p) {
  const today = ctx.today;
  const range = p || period(today, today, 'hoje', '', false);
  const events = ctx.events || [];
  const occ = occurrencesInRange(events, range.from, range.to);
  const onlyTasks = /\btarefas?\b/.test(q) && !/\bcompromissos?\b/.test(q);
  const onlyEvents = /\b(compromissos?|reunio\w*)\b/.test(q) && !/\btarefas?\b/.test(q);
  let list = occ;
  if (onlyTasks) list = list.filter((o) => o.item.kind === 'task');
  if (onlyEvents) list = list.filter((o) => o.item.kind === 'event');
  const pendingOnly = /\b(pendentes?|falta|faltam|atrasad\w*)\b/.test(q);
  if (pendingOnly) list = list.filter((o) => !o.done);
  const late = range.from <= today && range.to >= today && !onlyEvents ? overdueTasks(events, today) : [];
  const items = list.map((o) => {
    const day = range.from === range.to ? '' : `${formatNumeric(o.date).slice(0, 5)} · `;
    const label = o.item.kind === 'task' ? (o.done ? 'Tarefa feita' : 'Tarefa') : 'Compromisso';
    return `${day}${o.item.time ? `${o.item.time} · ` : ''}${o.item.title} (${label})`;
  });
  const events_ = list.filter((o) => o.item.kind === 'event').length;
  const tasks = list.filter((o) => o.item.kind === 'task').length;
  const parts = [];
  if (events_) parts.push(plural(events_, 'compromisso', 'compromissos'));
  if (tasks) parts.push(plural(tasks, pendingOnly ? 'tarefa pendente' : 'tarefa', pendingOnly ? 'tarefas pendentes' : 'tarefas'));
  const extra = late.length ? `Você também tem ${plural(late.length, 'tarefa atrasada', 'tarefas atrasadas')} de dias anteriores.` : '';
  if (!list.length) {
    return {
      kind: 'answer',
      text: `Nada na agenda ${range.label}.`,
      steps: [`Olhei compromissos e tarefas de ${periodLabel(range.from, range.to)}.`],
      extra,
      action: { label: 'Abrir agenda', route: '#/agenda' },
      suggestions: ['O que tenho amanhã?', 'Quais contas vencem esta semana?'],
    };
  }
  return {
    kind: 'answer',
    text: `${capitalizeFirst(range.label)} você tem ${joinList(parts)}.`,
    steps: [`Olhei compromissos e tarefas de ${periodLabel(range.from, range.to)}:`],
    items: items.slice(0, 12),
    extra,
    action: { label: 'Abrir agenda', route: range.from === range.to ? `#/agenda?dia=${range.from}` : '#/agenda' },
    suggestions: ['O que tenho amanhã?', 'Quais contas vencem esta semana?'],
  };
}

function answerTips(q, ctx) {
  const today = ctx.today;
  const custom = ctx.settings?.customCategories || [];
  const tips = [];
  const month = totals(ctx.transactions, startOfMonth(today), endOfMonth(today));
  const expenses = month.list.filter((t) => t.type === 'expense');
  if (!live(ctx.transactions).length) {
    tips.push('Comece registrando cada gasto logo depois de fazê-lo — leva poucos segundos pelo botão Adicionar.');
  }
  if (!ctx.settings?.budget) tips.push('Defina um orçamento mensal em Ajustes. Assim fica fácil saber quanto ainda pode gastar por dia.');
  const s = budgetStatus(ctx.settings?.budget, month.expense, today);
  if (s && s.level !== 'ok') tips.push(`Seu orçamento está em ${formatPercent(s.ratio)} e o mês está em ${formatPercent(s.expectedRatio)}. Vale segurar os gastos não essenciais nos próximos dias.`);
  const cats = byCategory(expenses, 'expense', custom);
  if (cats.length >= 2 && cats[0].share >= 0.35) tips.push(`${cats[0].category.label} representa ${formatPercent(cats[0].share)} das despesas do mês. Se quiser economizar, é o primeiro lugar para olhar.`);
  const uncategorized = expenses.filter((t) => !t.category).length;
  if (uncategorized >= 3) tips.push(`${plural(uncategorized, 'despesa está', 'despesas estão')} sem categoria. Categorizar ajuda a ver para onde vai o dinheiro.`);
  const overdue = openBills(ctx.bills || [], 'pay').filter((b) => b.dueDate < today);
  if (overdue.length) tips.push(`Há ${plural(overdue.length, 'conta vencida', 'contas vencidas')}. Pagar em dia evita multa e juros.`);
  const subs = cats.find((c) => c.id === 'assinaturas');
  if (subs && subs.total > 0) tips.push(`Você gastou ${money(subs.total)} com assinaturas este mês. Revise se usa todas.`);
  const withReminder = (ctx.bills || []).filter((b) => !b.deleted && (b.remind || []).length).length;
  if ((ctx.bills || []).length && !withReminder) tips.push('Ative lembretes nas suas contas para ser avisado antes do vencimento.');
  if (!tips.length) tips.push('Suas finanças estão organizadas! Continue registrando os gastos e confira o relatório no fim do mês.');
  return {
    kind: 'answer',
    text: 'Algumas ideias práticas com base nos seus registros:',
    items: tips.slice(0, 4),
    steps: ['São sugestões gerais de organização, não recomendações de investimento nem promessa de resultado.'],
    suggestions: ['Onde gastei mais este mês?', 'Quanto ainda tenho no orçamento?'],
  };
}

function helpAnswer() {
  return {
    kind: 'help',
    text: 'Eu respondo perguntas sobre o que você registrou: gastos, receitas, saldo, orçamento, contas e agenda. Sempre mostro como fiz a conta.',
    items: [
      '“Quanto gastei este mês?”',
      '“Quanto gastei com mercado em setembro?”',
      '“Quais contas vencem esta semana?”',
      '“Quanto ainda tenho no orçamento?”',
      '“Qual foi meu maior gasto?”',
      '“Comparar com o mês passado”',
      '“O que tenho amanhã?”',
    ],
    steps: ['Não faço pagamentos, transferências nem prometo resultados financeiros.'],
    suggestions: EXAMPLE_QUESTIONS.slice(0, 3),
  };
}

function capitalizeFirst(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Ponto de entrada.
export function ask(question, ctx) {
  const q = normalize(question);
  const today = ctx.today;
  if (!q) return helpAnswer();
  const intent = detectIntent(q);
  const forward = intent === 'bills' || intent === 'agenda';
  const p = parsePeriod(q, today, { pastBias: !forward });

  switch (intent) {
    case 'action':
      return {
        kind: 'refuse',
        text: 'Eu não faço pagamentos, transferências nem movimento dinheiro. Posso mostrar suas contas e ajudar a se organizar.',
        steps: ['O Meu Dia não se conecta a bancos nesta versão.'],
        action: { label: 'Ver contas', route: '#/contas' },
        suggestions: ['Quais contas vencem esta semana?', 'Quanto ainda tenho no orçamento?'],
      };
    case 'hello':
      return { ...helpAnswer(), text: `Olá! ${helpAnswer().text}` };
    case 'help':
      return helpAnswer();
    case 'tips':
      return answerTips(q, ctx);
    case 'budget':
      return answerBudget(q, ctx);
    case 'bills':
      return answerBills(q, ctx, p);
    case 'compare':
      return answerCompare(q, ctx, p);
    case 'biggest':
      return answerBiggest(q, ctx, p || thisMonth(today));
    case 'categories':
      return answerCategories(q, ctx, p || thisMonth(today));
    case 'agenda':
      return answerAgenda(q, ctx, p);
    case 'balance':
      return answerBalance(q, ctx, p || thisMonth(today));
    case 'income':
      return answerIncome(q, ctx, p || thisMonth(today));
    case 'spend':
      return answerSpend(q, ctx, p || thisMonth(today));
    default:
      return {
        kind: 'unknown',
        text: 'Não entendi bem. Posso responder sobre gastos, receitas, saldo, orçamento, contas e agenda.',
        steps: ['Tente uma das perguntas abaixo ou escreva de outro jeito.'],
        suggestions: EXAMPLE_QUESTIONS.slice(0, 4),
      };
  }
}
