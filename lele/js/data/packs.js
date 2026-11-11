// Baralhos prontos que vêm com o app (pasta packs/). Ao adicionar um pacote, só entram
// as notas que ainda não existem: nada do que a Lelé editou ou apagou é sobrescrito.
import * as store from './store.js';

export async function fetchIndex() {
  try {
    const res = await fetch('./packs/index.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export const installedPacks = () => store.settings().packs || {};

// Pacotes novos ou com versão nova.
export function pendingPacks(index) {
  const done = installedPacks();
  return index.filter((p) => (done[p.id] || 0) < p.version);
}

export async function installPack(meta) {
  const res = await fetch(`./packs/${meta.file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Não consegui baixar o baralho. Confira a internet e tente de novo.');
  const pack = await res.json();
  const s = store.getState();
  const entries = [];
  const deckId = (key) => `p_${pack.id}_${key}`;
  const newNotes = pack.notes.filter((n) => !s.notes[`p_${pack.id}_${n.id}`]);
  const decksWithNew = new Set(newNotes.map((n) => n.deck));
  for (const d of pack.decks) {
    const id = deckId(d.key);
    const existing = s.decks[id];
    if (!existing || (existing.deleted && decksWithNew.has(d.key))) {
      entries.push(['decks', { id, name: d.name, group: d.group || '', color: d.color, emoji: d.emoji, createdAt: Date.now(), pack: pack.id }]);
    }
  }
  const base = Date.now();
  newNotes.forEach((n, i) => {
    entries.push([
      'notes',
      {
        id: `p_${pack.id}_${n.id}`,
        deckId: deckId(n.deck),
        type: n.type || 'basic',
        front: n.front || '',
        back: n.back || '',
        extra: n.extra || '',
        tags: n.tags || [],
        image: null,
        imageSide: 'back',
        createdAt: base + i,
        pack: pack.id,
      },
    ]);
  });
  const packs = { ...installedPacks(), [pack.id]: pack.version };
  entries.push(['settings', { ...store.settings(), packs, id: 'main' }]);
  store.putMany(entries);
  return newNotes.length;
}
