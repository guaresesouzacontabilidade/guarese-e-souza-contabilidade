// Boletos brasileiros: código de barras (44 dígitos) e linha digitável (47 ou 48 dígitos).
// O próprio código traz o valor e, nos boletos bancários, a data de vencimento.
import { addDays, diffDays } from './dates.js';

const BANKS = {
  '001': 'Banco do Brasil', '033': 'Santander', '041': 'Banrisul', '070': 'BRB', '077': 'Inter', '104': 'Caixa',
  '208': 'BTG Pactual', '212': 'Banco Original', '237': 'Bradesco', '260': 'Nubank', '318': 'BMG', '336': 'C6 Bank',
  '341': 'Itaú', '389': 'Mercantil', '422': 'Safra', '623': 'Banco Pan', '655': 'Votorantim', '745': 'Citibank',
  '748': 'Sicredi', '756': 'Sicoob',
};

// Arrecadação (contas de consumo e tributos): o 2º dígito diz o segmento.
const SEGMENTS = {
  1: { description: 'Prefeitura (IPTU/taxas)', category: 'impostos' },
  2: { description: 'Conta de água', category: 'moradia' },
  3: { description: 'Conta de luz/gás', category: 'moradia' },
  4: { description: 'Telefone/Internet', category: 'assinaturas' },
  5: { description: 'Tributo', category: 'impostos' },
  6: { description: 'Carnê', category: null },
  7: { description: 'Multa de trânsito', category: 'transporte' },
  9: { description: 'Boleto', category: null },
};

export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

export function mod10(num) {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * weight;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(num) {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum;
}

// Dígito geral do boleto bancário (posição 5 do código de barras).
export function bankDV(barcodeWithoutDV) {
  const dv = 11 - (mod11Sum(barcodeWithoutDV) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

function utilityMod11(num) {
  const r = mod11Sum(num) % 11;
  return r === 0 || r === 1 ? 0 : 11 - r;
}

// Fator de vencimento: dias desde 07/10/1997; reiniciou em 1000 no dia 22/02/2025.
export function dueDateFromFactor(factor, today) {
  if (!factor) return null;
  const a = addDays('1997-10-07', factor);
  const b = factor >= 1000 ? addDays('2025-02-22', factor - 1000) : null;
  if (!b) return a;
  return Math.abs(diffDays(today, a)) <= Math.abs(diffDays(today, b)) ? a : b;
}

export function factorFromDate(iso) {
  return diffDays('2025-02-22', iso) + 1000;
}

function lineToBarcode(digits) {
  if (digits.length === 47) {
    return digits.slice(0, 4) + digits[32] + digits.slice(33, 47) + digits.slice(4, 9) + digits.slice(10, 20) + digits.slice(21, 31);
  }
  if (digits.length === 48) {
    return [0, 12, 24, 36].map((i) => digits.slice(i, i + 11)).join('');
  }
  return digits;
}

export function bankBarcodeToLine(b) {
  const f1 = b.slice(0, 4) + b.slice(19, 24);
  const f2 = b.slice(24, 34);
  const f3 = b.slice(34, 44);
  const line = `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${b[4]}${b.slice(5, 19)}`;
  return `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} ${line.slice(21, 26)}.${line.slice(26, 32)} ${line[32]} ${line.slice(33)}`;
}

function utilityBarcodeToLine(b) {
  const useMod10 = b[2] === '6' || b[2] === '7';
  return [0, 11, 22, 33]
    .map((i) => {
      const block = b.slice(i, i + 11);
      return `${block}-${useMod10 ? mod10(block) : utilityMod11(block)}`;
    })
    .join(' ');
}

// Interpreta um código lido pela câmera ou colado. Devolve null se não for um boleto.
export function parseBoleto(input, today) {
  const digits = onlyDigits(input);
  if (![44, 47, 48].includes(digits.length)) return null;
  const barcode = lineToBarcode(digits);
  if (barcode.length !== 44) return null;

  if (barcode[0] === '8') {
    const valueId = barcode[2];
    const realValue = valueId === '6' || valueId === '8';
    const amount = realValue ? Number(barcode.slice(4, 15)) : null;
    const withoutDV = barcode.slice(0, 3) + barcode.slice(4);
    const dv = valueId === '6' || valueId === '7' ? mod10(withoutDV) : utilityMod11(withoutDV);
    const seg = SEGMENTS[Number(barcode[1])] || SEGMENTS[9];
    return {
      kind: 'utility',
      barcode,
      line: utilityBarcodeToLine(barcode),
      amount: amount || null,
      dueDate: null,
      valid: dv === Number(barcode[3]),
      suggestion: { description: seg.description, category: seg.category },
    };
  }

  const bank = BANKS[barcode.slice(0, 3)];
  const factor = Number(barcode.slice(5, 9));
  const amount = Number(barcode.slice(9, 19));
  return {
    kind: 'bank',
    barcode,
    line: bankBarcodeToLine(barcode),
    amount: amount || null,
    dueDate: dueDateFromFactor(factor, today),
    valid: bankDV(barcode.slice(0, 4) + barcode.slice(5)) === Number(barcode[4]),
    bank: bank || null,
    suggestion: { description: bank ? `Boleto ${bank}` : 'Boleto', category: null },
  };
}
