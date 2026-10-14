// Leitura de extratos bancários e faturas de cartão (texto de PDF, OFX ou CSV).
// Tudo acontece no aparelho. O resultado é sempre revisado pela pessoa antes de importar.
import { parseMoney } from './money.js';
import { normalize } from './text.js';
import { MONTHS_SHORT, addDays, isValidISODate } from './dates.js';
import { suggestCategory } from './categories.js';

const MONTH_ABBR = MONTHS_SHORT.map((m) => normalize(m));
// Valor com vírgula decimal, com sinal antes (- / +) ou depois (- / + / D / C).
const MONEY_RE = /(?:^|[\s(])(-|\+)?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?:\s*(-|\+|D|C))?(?=$|[\s)])/gi;

// Linhas que não são lançamentos.
const SKIP = /\b(saldo|total|subtotal|limite|fatura anterior|valor minimo|pagamento minimo|encargos|juros do rotativo|cet|iof financ|taxa de juros|demonstrativo|resumo|vencimento|melhor dia|pagina|extrato de|periodo|lancamentos futuros|saldo disponivel|cheque especial disponivel)\b/;
const CREDIT_WORDS = /\b(recebid[oa]|recebimento|deposito|salario|credito|estorno|rendimento|devolucao|reembolso|resgate|transferencia recebida|ted recebida|doc recebido|pix recebido|cashback|proventos)\b/;
const DEBIT_WORDS = /\b(compra|pagamento|pago|pix enviado|transferencia enviada|ted enviada|saque|tarifa|debito|boleto|aplicacao|iof|juros|mensalidade|anuidade|enviado|enviada)\b/;
const CARD_PAYMENT = /\b(pagamento (recebido|efetuado|de fatura|da fatura|fatura)|pgto fatura|pagto fatura|pag fatura|credito de pagamento)\b/;
const CARD_HINT = /\b(fatura|cartao de credito|limite disponivel|limite total|vencimento da fatura|pagamento minimo|melhor dia de compra)\b/;

export function detectMode(text) {
  return CARD_HINT.test(normalize(text)) ? 'card' : 'bank';
}

function guessYear(text, today) {
  const counts = {};
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const year = best ? Number(best[0]) : Number(today.slice(0, 4));
  return Math.abs(year - Number(today.slice(0, 4))) <= 2 ? year : Number(today.slice(0, 4));
}

function iso(y, m, d) {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISODate(s) ? s : null;
}

// Procura uma data no começo da linha: 14/10/2026, 14/10/26, 14/10, 14-10-2026, 14 OUT, 14 OUT 2026.
function leadingDate(line, year, today) {
  const t = line.trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?=\s|$)/);
  if (m) {
    let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : year;
    let date = iso(y, Number(m[2]), Number(m[1]));
    if (date && !m[3] && date > addDays(today, 31)) date = iso(y - 1, Number(m[2]), Number(m[1]));
    return date ? { date, rest: t.slice(m[0].length) } : null;
  }
  m = normalize(t).match(/^(\d{1,2}) (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*(?: (\d{4}))?\b/);
  if (m) {
    const month = MONTH_ABBR.indexOf(m[2]) + 1;
    const y = m[3] ? Number(m[3]) : year;
    let date = iso(y, month, Number(m[1]));
    if (date && !m[3] && date > addDays(today, 31)) date = iso(y - 1, month, Number(m[1]));
    // Remove a data do texto original (mesmo comprimento de palavras).
    const words = m[0].split(' ').length;
    const rest = t.split(/\s+/).slice(words).join(' ');
    return date ? { date, rest } : null;
  }
  return null;
}

function amountsIn(text) {
  const out = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const value = parseMoney(m[2]);
    const sign = (m[1] || '') + (m[3] || '');
    const negative = /-|D/i.test(sign);
    const positive = /\+|C/i.test(sign);
    out.push({ value, negative, positive, explicit: negative || positive, index: m.index, raw: m[0] });
  }
  return out;
}

function cleanDescription(text) {
  return text
    .replace(MONEY_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–•*|]+|[\s\-–•*|]+$/g, '')
    .trim();
}

let seq = 0;
const rowId = () => `r${++seq}`;

function finishRow(row, mode, history, hints = {}) {
  const n = normalize(row.description);
  if (mode === 'card' && CARD_PAYMENT.test(n)) row.type = 'transfer';
  row.category = row.type === 'transfer' ? null : suggestCategory(row.description, row.type, history, hints.custom, hints.rules);
  return row;
}

// Texto extraído de PDF (uma linha por linha visual do documento).
export function parseStatementText(text, { today, mode: forcedMode, history = [], rules = [], custom = [] } = {}) {
  const mode = forcedMode || detectMode(text);
  const year = guessYear(text, today);
  const rows = [];
  let currentDate = null;
  let lastBalance = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const dated = leadingDate(line, year, today);
    if (dated) currentDate = dated.date;
    const body = dated ? dated.rest : line;
    const amounts = amountsIn(body);
    const n = normalize(body);
    if (!amounts.length) continue;
    if (SKIP.test(n) && !CREDIT_WORDS.test(n) && !DEBIT_WORDS.test(n)) {
      // Guarda o saldo para deduzir o sinal das próximas linhas.
      if (/\bsaldo\b/.test(n)) lastBalance = signed(amounts[amounts.length - 1]);
      continue;
    }
    if (!currentDate) continue;
    const description = cleanDescription(body);
    if (!description || description.length < 2) continue;

    const value = amounts[0];
    let balance = amounts.length >= 2 ? signed(amounts[amounts.length - 1]) : null;
    let type;
    let confident = true;
    if (mode === 'card') {
      type = value.negative || CREDIT_WORDS.test(n) || CARD_PAYMENT.test(n) ? 'income' : 'expense';
    } else if (value.explicit) {
      type = value.negative ? 'expense' : 'income';
    } else if (balance !== null && lastBalance !== null && Math.abs(lastBalance + value.value - balance) <= 1) {
      type = 'income';
    } else if (balance !== null && lastBalance !== null && Math.abs(lastBalance - value.value - balance) <= 1) {
      type = 'expense';
    } else if (CREDIT_WORDS.test(n)) {
      type = 'income';
    } else if (DEBIT_WORDS.test(n)) {
      type = 'expense';
    } else {
      type = 'expense';
      confident = false;
    }
    if (balance !== null) lastBalance = balance;
    rows.push(finishRow({ id: rowId(), date: currentDate, description: tidyCase(description), amount: value.value, type, confident }, mode, history, { rules, custom }));
  }
  return summarize(rows, mode);
}

function signed(a) {
  return a.negative ? -a.value : a.value;
}

// Deixa "PADARIA DO ZE" como "Padaria do ze" (mais legível), sem mexer em textos já mistos.
function tidyCase(s) {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower[0].toUpperCase() + lower.slice(1);
}

// ---------- OFX ----------

export function parseOFX(text, { today, history = [], rules = [], custom = [] } = {}) {
  const card = /CREDITCARDMSGSRSV1|CCSTMTRS/i.test(text);
  const mode = card ? 'card' : 'bank';
  const rows = [];
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const tag = (name) => {
      const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const amountRaw = tag('TRNAMT');
    const dt = tag('DTPOSTED');
    if (!amountRaw || !dt) continue;
    const value = Math.round(Number(amountRaw.replace(',', '.')) * 100);
    const date = iso(Number(dt.slice(0, 4)), Number(dt.slice(4, 6)), Number(dt.slice(6, 8)));
    if (!date || !Number.isFinite(value) || value === 0) continue;
    const description = tidyCase([tag('NAME'), tag('MEMO')].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' — ') || 'Lançamento');
    rows.push(
      finishRow(
        { id: rowId(), date, description, amount: Math.abs(value), type: value < 0 ? 'expense' : 'income', confident: true, externalId: tag('FITID') || null },
        mode,
        history,
        { rules, custom },
      ),
    );
  }
  return summarize(rows, mode, today);
}

// ---------- CSV ----------

function splitCSVLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseAnyDate(s, today) {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return iso(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[2]), Number(m[1]));
  const d = leadingDate(t, Number(today.slice(0, 4)), today);
  return d ? d.date : null;
}

function parseCSVNumber(s) {
  const t = String(s || '').replace(/r\$|\s/gi, '');
  if (!t) return null;
  // "1234.56" (padrão inglês) vs "1.234,56" (padrão brasileiro)
  if (/^-?\d+\.\d{1,2}$/.test(t)) return Math.round(Number(t) * 100);
  return parseMoney(t);
}

export function parseCSV(text, { today, mode: forcedMode, history = [], rules = [], custom = [] } = {}) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return summarize([], forcedMode || 'bank');
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = splitCSVLine(lines[0], sep).map((h) => normalize(h));
  const find = (...names) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iDate = find('data', 'date');
  const iDesc = find('descricao', 'historico', 'title', 'titulo', 'memo', 'lancamento', 'estabelecimento', 'description');
  const iValue = find('valor', 'amount', 'value', 'quantia');
  const iCredit = find('credito', 'entrada');
  const iDebit = find('debito', 'saida');
  const mode = forcedMode || (header.includes('title') && header.includes('amount') ? 'card' : detectMode(text));
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = splitCSVLine(line, sep);
    const date = iDate >= 0 ? parseAnyDate(cols[iDate] || '', today) : null;
    if (!date) continue;
    let value = iValue >= 0 ? parseCSVNumber(cols[iValue]) : null;
    if (value === null && (iCredit >= 0 || iDebit >= 0)) {
      const c = iCredit >= 0 ? parseCSVNumber(cols[iCredit]) : null;
      const d = iDebit >= 0 ? parseCSVNumber(cols[iDebit]) : null;
      value = c ? Math.abs(c) : d ? -Math.abs(d) : null;
    }
    if (!value) continue;
    const description = tidyCase((iDesc >= 0 ? cols[iDesc] : '') || 'Lançamento');
    // Na fatura, valor positivo é compra; no extrato, positivo é entrada.
    const type = mode === 'card' ? (value > 0 ? 'expense' : 'income') : value < 0 ? 'expense' : 'income';
    rows.push(finishRow({ id: rowId(), date, description, amount: Math.abs(value), type, confident: true }, mode, history, { rules, custom }));
  }
  return summarize(rows, mode);
}

// ---------- Resultado ----------

function summarize(rows, mode) {
  const dates = rows.map((r) => r.date).sort();
  return {
    mode,
    rows,
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
  };
}

export function totalsOf(rows) {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.type === 'income') income += r.amount;
    else if (r.type === 'expense') expense += r.amount;
  }
  return { income, expense, balance: income - expense };
}

// Identificador estável para não importar o mesmo lançamento duas vezes.
export function importKey(row, source = '') {
  return normalize(`${source}|${row.externalId || ''}|${row.date}|${row.amount}|${row.description}`).replace(/ /g, '_');
}

// Agrupa trechos de texto do PDF em linhas, pela posição vertical.
export function itemsToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.y);
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.str.trim()).join('  ')).join('\n');
}
