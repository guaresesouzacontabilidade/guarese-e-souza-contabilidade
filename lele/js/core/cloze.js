// Cartões de lacuna (como no Anki): "O {{c1::nervo frênico}} inerva o {{c2::diafragma}}".
// Cada número vira um cartão. Dica opcional: {{c1::resposta::dica}}.
import { renderRich } from './rich.js';

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function hasCloze(text) {
  CLOZE.lastIndex = 0;
  return CLOZE.test(String(text ?? ''));
}

// Números das lacunas presentes no texto, em ordem.
export function clozeOrds(text) {
  const set = new Set();
  for (const m of String(text ?? '').matchAll(CLOZE)) set.add(Number(m[1]));
  return [...set].filter((n) => n > 0).sort((a, b) => a - b);
}

// Próximo número livre (para o botão "Ocultar").
export function nextClozeNumber(text) {
  const ords = clozeOrds(text);
  return ords.length ? ords[ords.length - 1] + 1 : 1;
}

/** HTML do cartão de lacuna `ord`, lado 'front' (pergunta) ou 'back' (resposta). */
export function renderCloze(text, ord, side) {
  return renderRich(text, (escaped) =>
    escaped.replace(CLOZE, (_, n, answer, hint) => {
      if (Number(n) !== Number(ord)) return answer;
      if (side === 'front') return `<span class="cloze">${hint ? `[${hint}]` : '[…]'}</span>`;
      return `<span class="cloze is-revealed">${answer}</span>`;
    }),
  );
}

// Envolve o trecho selecionado em uma lacuna. Devolve o novo texto e a posição do cursor.
export function wrapCloze(text, start, end, number = nextClozeNumber(text)) {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const open = `{{c${number}::`;
  const inserted = `${open}${selected}}}`;
  const cursor = selected ? before.length + inserted.length : before.length + open.length;
  return { text: before + inserted + after, cursor };
}

// Transforma "{{texto}}" (sem número) em lacunas numeradas — mais fácil de digitar no celular.
export function autoNumber(text) {
  let n = nextClozeNumber(text);
  return String(text ?? '').replace(/\{\{(?!c\d+::)([^{}]+?)\}\}/g, (_, inner) => `{{c${n++}::${inner}}}`);
}
