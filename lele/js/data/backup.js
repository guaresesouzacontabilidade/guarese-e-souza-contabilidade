// Backup em arquivo .json (todos os baralhos, cartões, imagens e histórico).
import * as store from './store.js';
import { COLLECTIONS } from './store.js';
import { dayKey } from '../core/dates.js';

export async function exportBackup() {
  await store.flush();
  const s = store.getState();
  const data = {};
  for (const c of COLLECTIONS) data[c] = Object.fromEntries(Object.entries(s[c]).filter(([, r]) => r && !r.deleted));
  const payload = { app: 'app-da-lele', format: 1, exportedAt: new Date().toISOString(), data };
  const name = `app-da-lele-backup-${dayKey()}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
  // No iPhone instalado, o menu de compartilhar é o jeito mais fácil de salvar no Arquivos.
  if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: 'Backup do App da Lelé' });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function readBackup(file) {
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('Esse arquivo não é um backup válido.');
  }
  if (json?.app !== 'app-da-lele' || !json.data) throw new Error('Esse arquivo não é um backup do App da Lelé.');
  return json.data;
}

// Junta o backup aos dados atuais (o backup vence nos itens repetidos) e sincroniza.
export function restoreBackup(data) {
  const entries = [];
  for (const c of COLLECTIONS) {
    for (const rec of Object.values(data[c] || {})) {
      if (rec && rec.id && !rec.deleted) entries.push([c, rec]);
    }
  }
  store.putMany(entries);
  store.updateMeta({ onboarded: true });
  return entries.length;
}
