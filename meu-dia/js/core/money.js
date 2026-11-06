// Valores sempre em centavos (inteiros) para evitar erros de arredondamento.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Troca o espaço especial do Intl por um espaço comum não separável e consistente.
const tidy = (s) => s.replace(/\s/g, ' ');

export function formatMoney(cents, { signed = false } = {}) {
  const value = tidy(brl.format(Math.abs(cents || 0) / 100));
  if (cents < 0) return `-${value}`;
  if (signed && cents > 0) return `+${value}`;
  return value;
}

export function formatAmount(cents) {
  return plain.format((cents || 0) / 100);
}

// Interpreta "1.234,56", "1234,56", "1234.56", "R$ 12" ou "12" e devolve centavos (ou null).
export function parseMoney(input) {
  if (typeof input === 'number') return Math.round(input * 100);
  if (!input) return null;
  let s = String(input).replace(/r\$|\s/gi, '');
  const negative = /^-/.test(s);
  s = s.replace(/^[-+]/, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

// Para o campo de valor estilo app de banco: os dígitos digitados viram centavos.
export function digitsToCents(text) {
  const digits = String(text || '').replace(/\D/g, '').slice(0, 11);
  return digits ? Number(digits) : 0;
}

export function sumBy(list, fn) {
  let total = 0;
  for (const item of list) total += fn(item);
  return total;
}

export function percent(part, whole) {
  if (!whole) return 0;
  return part / whole;
}

export function formatPercent(ratio, digits = 0) {
  return `${(ratio * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
}
