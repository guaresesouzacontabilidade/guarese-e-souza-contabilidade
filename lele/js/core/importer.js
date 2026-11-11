// Importar vários cartões de uma vez a partir de texto colado ou arquivo (.txt, .csv, .tsv, .md).
// Formatos aceitos (detectados sozinhos):
//   pergunta<TAB>resposta        (planilhas e exportação do Anki)
//   pergunta ; resposta
//   pergunta :: resposta
//   pergunta | resposta
//   blocos separados por linha em branco: 1ª linha = pergunta, resto = resposta
//   linhas com {{c1::…}} viram cartões de lacuna (o que vier depois do separador vira "extra")
import { hasCloze, autoNumber } from './cloze.js';

export const SEPARATORS = [
  { id: 'auto', label: 'Automático' },
  { id: 'tab', label: 'Tabulação', token: '\t' },
  { id: 'semicolon', label: 'Ponto e vírgula ( ; )', token: ';' },
  { id: 'doublecolon', label: 'Dois-pontos duplo ( :: )', token: '::' },
  { id: 'pipe', label: 'Barra ( | )', token: '|' },
  { id: 'comma', label: 'Vírgula ( , )', token: ',' },
  { id: 'blocks', label: 'Blocos (linha em branco entre cartões)' },
];

const tokenOf = (id) => SEPARATORS.find((s) => s.id === id)?.token;

// Converte HTML simples (exportações do Anki) em texto com a formatação do app.
export function htmlToText(s) {
  if (!/<[a-z/][^>]*>|&[a-z]+;|&#\d+;/i.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<u>([\s\S]*?)<\/u>/gi, '__$1__')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Divide uma linha pelo separador, respeitando "campos entre aspas" (CSV).
export function splitLine(line, token) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) {
      quoted = true;
      cur = '';
    } else if (line.startsWith(token, i)) {
      out.push(cur);
      cur = '';
      i += token.length - 1;
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Qual separador aparece em mais linhas?
export function detectSeparator(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) return 'semicolon';
  const candidates = ['tab', 'doublecolon', 'semicolon', 'pipe'];
  let best = null;
  let bestCount = 0;
  for (const id of candidates) {
    const token = tokenOf(id);
    // "::" das lacunas não conta como separador.
    const count = lines.filter((l) => l.replace(/\{\{c\d+::[\s\S]*?\}\}/g, '').includes(token)).length;
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  // Separador em menos da metade das linhas: provavelmente são blocos de texto.
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim().split('\n').length >= 2).length;
  if ((!best || bestCount < lines.length / 2) && blocks >= 1) return 'blocks';
  return best || 'semicolon';
}

function toCard(front, back, extraTags = []) {
  front = htmlToText(front || '').trim();
  back = htmlToText(back || '').trim();
  const withNumbers = autoNumber(front);
  if (hasCloze(withNumbers)) return { type: 'cloze', front: withNumbers, back: '', extra: back, tags: extraTags };
  if (!front || !back) return null;
  return { type: 'basic', front, back, extra: '', tags: extraTags };
}

/**
 * Lê o texto e devolve { cards, skipped, separator }.
 * skipped: linhas que não viraram cartão (para mostrar na revisão).
 */
export function parseImport(text, separator = 'auto') {
  const clean = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sep = separator === 'auto' ? detectSeparator(clean) : separator;
  const cards = [];
  const skipped = [];
  if (sep === 'blocks') {
    for (const block of clean.split(/\n\s*\n/)) {
      const lines = block.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      if (!lines.length) continue;
      const first = lines[0].replace(/^\s*(?:P|Pergunta|Q)\s*[:.-]\s*/i, '');
      const rest = lines
        .slice(1)
        .map((l) => l.replace(/^\s*(?:R|Resposta|A)\s*[:.-]\s*/i, ''))
        .join('\n');
      const card = toCard(first, rest);
      if (card) cards.push(card);
      else skipped.push(block.trim());
    }
    return { cards, skipped, separator: sep };
  }
  const token = tokenOf(sep) || ';';
  for (const line of clean.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    let parts;
    if (hasCloze(line) && token === '::') {
      // Protege o "::" de dentro das lacunas.
      const masked = line.replace(/\{\{c\d+::[\s\S]*?\}\}/g, (m) => m.replace(/::/g, '\u0000'));
      parts = splitLine(masked, token).map((p) => p.replace(/\u0000/g, '::'));
    } else parts = splitLine(line, token);
    const [front, back, ...more] = parts;
    const tags = more.length && /^[\wÀ-ú:\- ]+$/.test(more[more.length - 1]) && sep === 'tab'
      ? more[more.length - 1].split(/\s+/).filter(Boolean)
      : [];
    const card = toCard(front, back, tags);
    if (card) cards.push(card);
    else skipped.push(line.trim());
  }
  return { cards, skipped, separator: sep };
}
