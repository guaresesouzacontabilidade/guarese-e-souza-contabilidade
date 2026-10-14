// Exportar e importar dados (backup em JSON e planilha em CSV).
import { exportData, importData, getState } from './store.js';
import { findCategory } from '../core/categories.js';
import { formatNumeric, todayISO } from '../core/dates.js';

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadBackup() {
  download(`meu-dia-backup-${todayISO()}.json`, JSON.stringify(exportData(), null, 2), 'application/json');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  // Evita que planilhas interpretem textos como fórmulas.
  const numeric = /^-?\d+(,\d+)?$/.test(s);
  const safe = !numeric && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// CSV com ponto e vírgula e vírgula decimal (abre direto no Excel/Planilhas em português).
export function transactionsToCSV(list) {
  const s = getState();
  const wallets = new Map(s.wallets.map((w) => [w.id, w.name]));
  const header = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Carteira', 'Valor', 'Observações'];
  const rows = [...list]
    .filter((t) => !t.deleted)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => [
      formatNumeric(t.date),
      t.type === 'income' ? 'Receita' : 'Despesa',
      t.description,
      t.category ? findCategory(t.category, t.type, s.settings.customCategories).label : '',
      wallets.get(t.walletId) || '',
      ((t.type === 'income' ? 1 : -1) * t.amount / 100).toFixed(2).replace('.', ','),
      t.notes || '',
    ]);
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}`;
}

export function downloadTransactionsCSV(list, filename = `meu-dia-lancamentos-${todayISO()}.csv`) {
  download(filename, transactionsToCSV(list), 'text/csv;charset=utf-8');
}

export async function importBackupFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Arquivo inválido. Escolha um backup .json exportado pelo Meu Dia.');
  }
  return importData(data);
}
