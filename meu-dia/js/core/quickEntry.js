// Entende frases curtas como "gastei 45 reais de gasolina ontem" ou "recebi 1.500 do cliente".
import { parseMoney } from './money.js';
import { normalize } from './text.js';
import { addDays } from './dates.js';
import { parsePeriod } from './assistant.js';
import { suggestCategory } from './categories.js';

const INCOME = /\b(recebi|ganhei|entrou|entraram|caiu|vendi|recebimento|salario|faturei)\b/;

function findAmount(text) {
  const t = text.toLowerCase();
  let m;
  // "45 reais e 90 centavos"
  if ((m = t.match(/(\d[\d.]*)\s*reais?\s*e\s*(\d{1,2})\s*centavos?/))) {
    return { cents: parseMoney(m[1]) + Number(m[2].padEnd(2, '0')), text: m[0] };
  }
  // "2 mil", "1,5 mil"
  if ((m = t.match(/(\d+(?:,\d+)?)\s*mil\b(?:\s*reais?)?/))) {
    return { cents: Math.round(Number(m[1].replace(',', '.')) * 100000), text: m[0] };
  }
  // "R$ 45,90", "45,90 reais", "45 reais", "R$45"
  if ((m = t.match(/r\$\s*(\d[\d.]*(?:,\d{1,2})?)/)) || (m = t.match(/(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais|real|conto|contos|pila|pilas)\b/))) {
    return { cents: parseMoney(m[1]), text: m[0] };
  }
  // Número solto que não seja "dia 10"
  const re = /(?<!dia\s)(?<!\/)\b(\d[\d.]*(?:,\d{1,2})?)\b(?!\/)/g;
  while ((m = re.exec(t))) {
    const cents = parseMoney(m[1]);
    if (cents) return { cents, text: m[0] };
  }
  return null;
}

function findDate(text, today) {
  const q = normalize(text);
  let m;
  if (/\banteontem\b/.test(q)) return { date: addDays(today, -2), text: 'anteontem' };
  if ((m = q.match(/\bdia (\d{1,2})\b/))) {
    const d = Number(m[1]);
    if (d >= 1 && d <= 31) {
      let date = `${today.slice(0, 8)}${String(d).padStart(2, '0')}`;
      if (date > today) {
        const prev = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, d);
        date = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
      }
      return { date, text: m[0] };
    }
  }
  const p = parsePeriod(q, today, { pastBias: true });
  if (p && p.from === p.to) return { date: p.from, text: p.text };
  return null;
}

const FILLER = /^(eu |hoje |agora |acabei de |acabei |ja |gastei |gasto |paguei |comprei |foi |foram |deu |recebi |ganhei |entrou |caiu |vendi |um |uma |uns |umas |de |do |da |dos |das |com |no |na |nos |nas |em |pro |pra |para |pelo |pela |o |a |os |as |reais |real )+/;

export function parseQuickEntry(text, today, history = []) {
  if (!text || !text.trim()) return null;
  const type = INCOME.test(normalize(text)) ? 'income' : 'expense';
  const amount = findAmount(text);
  const date = findDate(text, today);
  let rest = text.toLowerCase();
  if (amount) rest = rest.replace(amount.text, ' ');
  rest = normalizeKeepAccents(rest);
  if (date) {
    for (const piece of [date.text, 'ontem', 'hoje', 'anteontem']) {
      rest = rest.replace(new RegExp(`\\b(?:de |do |no |na |em )?${escapeRe(piece)}\\b`), ' ');
    }
  }
  rest = rest.replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = rest;
    rest = rest.replace(FILLER, '').trim();
    rest = rest.replace(/\s+(de|do|da|com|no|na|em|e|reais|real)$/, '').trim();
  } while (rest !== prev);
  const description = rest ? rest[0].toUpperCase() + rest.slice(1) : '';
  return {
    type,
    amount: amount ? amount.cents : 0,
    date: date ? date.date : today,
    description,
    category: description ? suggestCategory(description, type, history) : null,
  };
}

// Minúsculas e sem pontuação, mas mantendo acentos para a descrição ficar bonita.
function normalizeKeepAccents(s) {
  return s.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
