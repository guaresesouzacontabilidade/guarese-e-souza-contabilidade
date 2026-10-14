// Cópias automáticas diárias (app nativo): ficam nos arquivos do app, que o Android
// inclui no backup do Google quando ele está ativo no celular.
import * as store from '../data/store.js';
import { isNative, plugin } from './native.js';
import { todayISO } from '../core/dates.js';

const DIR = 'backups';
const KEEP = 7;
let timer = null;

const fs = () => plugin('Filesystem');
export const autoBackupAvailable = () => isNative() && Boolean(fs());

export async function listBackups() {
  if (!autoBackupAvailable()) return [];
  try {
    const { files } = await fs().readdir({ path: DIR, directory: 'DATA' });
    return files
      .filter((f) => /^meu-dia-\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
      .map((f) => ({ name: f.name, date: f.name.slice(8, 18), size: f.size, mtime: f.mtime }))
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  } catch {
    return [];
  }
}

export async function writeBackupNow() {
  if (!autoBackupAvailable() || store.countRecords() === 0) return;
  const name = `meu-dia-${todayISO()}.json`;
  await fs().writeFile({ path: `${DIR}/${name}`, data: JSON.stringify(store.exportData()), directory: 'DATA', encoding: 'utf8', recursive: true });
  store.updateMeta({ lastAutoBackup: Date.now() });
  const all = await listBackups();
  for (const old of all.slice(KEEP)) await fs().deleteFile({ path: `${DIR}/${old.name}`, directory: 'DATA' }).catch(() => {});
}

export async function readBackup(name) {
  const { data } = await fs().readFile({ path: `${DIR}/${name}`, directory: 'DATA', encoding: 'utf8' });
  return JSON.parse(data);
}

export function startAutoBackup() {
  if (!autoBackupAvailable()) return;
  let prev = store.getState();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => writeBackupNow().catch((e) => console.warn('[meu-dia] backup automático falhou', e)), 8000);
  };
  store.subscribe((s) => {
    if (s.events !== prev.events || s.bills !== prev.bills || s.transactions !== prev.transactions || s.wallets !== prev.wallets || s.settings !== prev.settings) schedule();
    prev = s;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') writeBackupNow().catch(() => {});
  });
  schedule();
}
