// Cria/atualiza baralhos e cartões a partir das páginas do Notion.
// Cartões têm id fixo (vindo do bloco do Notion): importar de novo só traz o que é novo
// ou o que mudou lá, e nunca mexe no que a Lelé apagou ou editou no app.
import * as store from './store.js';
import { DECK_COLORS } from './actions.js';
import { pageToCards, hashText } from '../core/notionCards.js';
import { normalize } from '../core/rich.js';

const short = (id) => String(id).replace(/-/g, '');
const slug = (s) => normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'geral';

export function deckIdFor(pageId, mode, topicName) {
  return mode === 'topic' ? `ntd_${short(pageId)}_${slug(topicName)}` : `ntd_${short(pageId)}`;
}

/**
 * pages: [{ page, mode, excluded?: string[] }] (page = resposta da função: { id, title, icon, blocks, group })
 * Devolve o plano: o que criar, atualizar e o que fica como está.
 */
export function planNotionImport(pages) {
  const s = store.getState();
  const plan = { decks: [], create: [], update: [], unchanged: 0, kept: 0, skipped: 0, pages: [] };
  const base = Date.now();
  let order = 0;
  for (const { page, mode, excluded = [] } of pages) {
    const result = pageToCards(page, { mode });
    const skip = new Set(excluded);
    const pageSummary = { id: page.id, title: result.title, icon: page.icon || null, mode, topics: [] };
    for (const topic of result.topics) {
      const included = !skip.has(topic.name);
      pageSummary.topics.push({ name: topic.name, count: topic.cards.length, included, sample: topic.cards.slice(0, 3) });
      if (!included) continue;
      const deckId = deckIdFor(page.id, mode, topic.name);
      const deck = s.decks[deckId];
      const deckNeeded = !deck || deck.deleted;
      for (const card of topic.cards) {
        const existing = s.notes[card.id];
        if (existing?.deleted) {
          plan.skipped += 1;
          continue;
        }
        const fields = { type: card.type, front: card.front, back: card.back, extra: card.extra, context: card.context };
        if (!existing) {
          plan.create.push({
            id: card.id,
            deckId,
            ...fields,
            tags: [],
            image: null,
            imageSide: 'back',
            createdAt: base + order++,
            source: { notion: page.id, hash: card.hash },
          });
        } else if (existing.source?.hash === card.hash) plan.unchanged += 1;
        else if (existing.source?.edited) plan.kept += 1;
        else plan.update.push({ ...existing, ...fields, source: { ...(existing.source || {}), notion: page.id, hash: card.hash } });
      }
      const willAdd = plan.create.some((n) => n.deckId === deckId);
      if (deckNeeded && willAdd) {
        const name = mode === 'topic' ? topic.name : result.title;
        // Página sem títulos: o baralho já tem o nome da página, então vai para o grupo "Notion".
        const group = mode === 'topic' && topic.name !== result.title ? result.title : page.group || 'Notion';
        const color = DECK_COLORS[parseInt(hashText(deckId), 36) % DECK_COLORS.length];
        plan.decks.push({ id: deckId, name, group, color, emoji: page.icon || '📝', createdAt: base, notion: page.id });
      }
    }
    plan.pages.push(pageSummary);
  }
  return plan;
}

export function applyNotionPlan(plan, pages) {
  const entries = [
    ...plan.decks.map((d) => ['decks', d]),
    ...plan.create.map((n) => ['notes', n]),
    ...plan.update.map((n) => {
      const { updatedAt, ...rest } = n;
      return ['notes', rest];
    }),
  ];
  // Lembra as páginas importadas (para "Atualizar do Notion" em qualquer aparelho).
  const saved = { ...(store.settings().notionPages || {}) };
  for (const { page, mode, excluded = [] } of pages) {
    saved[page.id] = { title: page.title, icon: page.icon || null, mode, excluded, group: page.group || null, at: Date.now() };
  }
  entries.push(['settings', { ...store.settings(), notionPages: saved, id: 'main' }]);
  store.putMany(entries);
  store.updateMeta({ onboarded: true });
  return { created: plan.create.length, updated: plan.update.length };
}

export const importedNotionPages = () => store.settings().notionPages || {};
