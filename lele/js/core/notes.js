// Notas e cartões. Uma nota pode gerar mais de um cartão:
//   basic   → 1 cartão (frente → verso)
//   reverse → 2 cartões (frente → verso e verso → frente)
//   cloze   → 1 cartão por lacuna {{c1::…}}, {{c2::…}}…
import { clozeOrds, renderCloze } from './cloze.js';
import { renderRich, plainText } from './rich.js';

export const NOTE_TYPES = [
  { id: 'basic', label: 'Pergunta e resposta', short: 'Pergunta' },
  { id: 'cloze', label: 'Lacunas', short: 'Lacunas' },
  { id: 'reverse', label: 'Pergunta e resposta + invertido', short: 'Ida e volta' },
];

export const cardId = (noteId, ord) => `${noteId}~${ord}`;

export function parseCardId(id) {
  const i = String(id).lastIndexOf('~');
  return { noteId: id.slice(0, i), ord: Number(id.slice(i + 1)) };
}

export function cardOrds(note) {
  if (!note || note.deleted) return [];
  if (note.type === 'cloze') return clozeOrds(note.front);
  if (note.type === 'reverse') return note.back?.trim() ? [0, 1] : [0];
  return [0];
}

// O que falta para a nota poder ser salva (ou null se está tudo certo).
export function validateNote(note) {
  if (!note.deckId) return 'Escolha um baralho.';
  if (note.type === 'cloze') {
    if (!note.front?.trim()) return 'Escreva o texto do cartão.';
    if (!clozeOrds(note.front).length) return 'Marque pelo menos uma lacuna: selecione um trecho e toque em “Ocultar”.';
    return null;
  }
  if (!note.front?.trim() && !note.image) return 'Escreva a pergunta.';
  if (!note.back?.trim() && !(note.image && note.imageSide === 'back')) return 'Escreva a resposta.';
  return null;
}

/**
 * HTML de um lado do cartão. `side` é 'front' (pergunta) ou 'back' (resposta).
 * Na resposta dos cartões de pergunta e resposta, só o verso (a pergunta fica visível acima).
 */
export function renderSide(note, ord, side) {
  if (note.type === 'cloze') {
    const main = renderCloze(note.front, ord, side);
    if (side === 'back' && note.extra?.trim()) return `${main}<div class="card-extra">${renderRich(note.extra)}</div>`;
    return main;
  }
  const reversed = note.type === 'reverse' && ord === 1;
  const q = reversed ? note.back : note.front;
  const a = reversed ? note.front : note.back;
  if (side === 'front') return renderRich(q);
  const extra = note.extra?.trim() ? `<div class="card-extra">${renderRich(note.extra)}</div>` : '';
  return renderRich(a) + extra;
}

// A imagem aparece na frente ou no verso, conforme a nota (no invertido, troca de lado).
export function imageOnSide(note, ord, side) {
  if (!note.image) return false;
  let where = note.imageSide === 'front' ? 'front' : 'back';
  if (note.type === 'reverse' && ord === 1) where = where === 'front' ? 'back' : 'front';
  return side === 'front' ? where === 'front' : true;
}

// Resumo de uma linha para listas.
export function noteTitle(note) {
  return plainText(note.front) || (note.image ? 'Cartão com imagem' : 'Cartão sem texto');
}

export function noteSubtitle(note) {
  if (note.type === 'cloze') {
    const n = clozeOrds(note.front).length;
    return `${n} ${n === 1 ? 'lacuna' : 'lacunas'}`;
  }
  return plainText(note.back);
}
