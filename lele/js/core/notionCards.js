// Transforma anotações do Notion em flashcards, sem inteligência artificial (grátis e previsível).
//
// Entrada: página simplificada pela função lele-notion:
//   { id, title, blocks: [{ id, type, text, children?, level?, toggleable?, cells?, hasColumnHeader? }] }
//   type: heading | paragraph | bulleted | numbered | todo | toggle | quote | callout | table | row | code | ...
//   text já vem com a formatação do app: **negrito**, *itálico*, __sublinhado__, ==marca-texto==
//
// Regras (na ordem):
//   1. Toggle (inclusive título "recolhível")  → pergunta = título do toggle, resposta = conteúdo
//   2. Frase terminando em "?"                → pergunta; resposta = subitens ou o bloco seguinte
//   3. "Termo: definição" (também — – -> = )  → pergunta e resposta
//   4. Item de lista com subitens             → pergunta = item, resposta = subitens
//   5. **negrito** ou ==marca-texto==         → lacunas
//   6. Tabela                                 → uma linha = um cartão (1ª coluna → demais colunas)
// Títulos (H1/H2/H3) definem os tópicos: cada tópico vira um baralho (ou tudo num baralho só por página).

const TEXT_TYPES = new Set(['paragraph', 'bulleted', 'numbered', 'todo', 'quote', 'callout']);
const LIST_TYPES = new Set(['bulleted', 'numbered', 'todo']);
const MAX_CLOZES = 8;

const strip = (s) => String(s ?? '').replace(/\*\*|__|==/g, '').replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,;:!?])/g, '$1$2').trim();
const hasLetters = (s) => /\p{L}/u.test(s);

// Hash curto e estável (para saber se o texto mudou no Notion).
export function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const shortId = (id) => String(id).replace(/-/g, '');

// ---------- Conteúdo dos filhos em texto ----------

export function renderBlocks(blocks, depth = 0) {
  const lines = [];
  let n = 0;
  for (const b of blocks || []) {
    const pad = '  '.repeat(depth);
    if (b.type === 'table') {
      for (const r of tableRows(b)) lines.push(`${pad}- ${r.join(' | ')}`);
      continue;
    }
    if (b.type === 'divider' || b.type === 'child_page' || b.type === 'child_database') continue;
    const text = b.text?.trim();
    if (text) {
      if (b.type === 'numbered') lines.push(`${pad}${++n}. ${text}`);
      else if (LIST_TYPES.has(b.type) || b.type === 'toggle' || (depth > 0 && b.type !== 'paragraph')) lines.push(`${pad}- ${text}`);
      else lines.push(`${pad}${text}`);
    }
    if (b.type !== 'numbered') n = 0;
    if (b.children?.length) lines.push(...renderBlocks(b.children, depth + 1).split('\n').filter(Boolean));
  }
  return lines.join('\n');
}

function tableRows(table) {
  return (table.children || []).filter((r) => r.type === 'row').map((r) => (r.cells || []).map((c) => c.trim()));
}

// ---------- Padrões ----------

const DEF_SEPARATORS = [':', ' — ', ' – ', ' -> ', ' → ', ' = ', ' - '];

/** "Termo: definição" → { term, definition } ou null. */
export function matchDefinition(text) {
  const t = text.trim();
  for (const sep of DEF_SEPARATORS) {
    const i = t.indexOf(sep);
    if (i <= 0) continue;
    const term = t.slice(0, i).trim();
    const definition = t.slice(i + sep.length).trim();
    const plainTerm = strip(term);
    if (!definition || !hasLetters(plainTerm) || plainTerm.length > 70) continue;
    if (plainTerm.split(/\s+/).length > 9) continue;
    // "10:30", "1:2" e similares não são definições.
    if (sep === ':' && (/\d$/.test(plainTerm) && /^\d/.test(definition))) continue;
    if (sep === ':' && /^\/\//.test(definition)) continue; // URL
    return { term: plainTerm, definition };
  }
  return null;
}

// Trechos em **negrito** ou ==marca-texto== viram {{cN::…}}.
export function toCloze(text) {
  const plainLen = strip(text).length || 1;
  let n = 0;
  let covered = 0;
  const out = text.replace(/\*\*(.+?)\*\*|==(.+?)==/g, (m, b, h) => {
    const inner = strip(b ?? h);
    if (!inner || n >= MAX_CLOZES) return m;
    covered += inner.length;
    n += 1;
    return `{{c${n}::${inner}}}`;
  });
  // Tudo em negrito = é um título disfarçado, não uma lacuna.
  if (!n || covered / plainLen > 0.75) return null;
  return out;
}

// ---------- Conversão ----------

/**
 * Gera os cartões de uma página.
 * options.mode: 'topic' (um baralho por título) | 'page' (um baralho só)
 * Devolve { title, topics: [{ name, cards: [...] }], total }
 */
export function pageToCards(page, { mode = 'topic' } = {}) {
  const blocks = page.blocks || [];
  const levels = collectHeadingLevels(blocks);
  const topLevel = levels.length ? Math.min(...levels) : null;
  const topics = new Map();
  const headings = []; // pilha de títulos: [{ level, text }]
  const pageTitle = page.title?.trim() || 'Notion';

  const topicName = () => {
    if (mode !== 'topic' || topLevel == null) return pageTitle;
    const top = headings.find((h) => h.level === topLevel);
    return top ? top.text : pageTitle;
  };
  const contextLine = () => {
    const parts = headings.filter((h) => mode !== 'topic' || h.level !== topLevel).map((h) => h.text);
    return parts.join(' › ');
  };

  const add = (card) => {
    const name = topicName();
    if (!topics.has(name)) topics.set(name, []);
    const context = contextLine();
    const full = { ...card, context, pageId: page.id };
    full.hash = hashText([full.type, full.front, full.back, full.extra, context].join('\u0001'));
    topics.get(name).push(full);
  };

  function walk(list) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const text = (b.text || '').trim();

      if (b.type === 'heading' && !b.toggleable) {
        while (headings.length && headings[headings.length - 1].level >= b.level) headings.pop();
        if (strip(text)) headings.push({ level: b.level, text: strip(text) });
        continue;
      }

      if (b.type === 'toggle' || (b.type === 'heading' && b.toggleable)) {
        const kids = b.children || [];
        const nested = kids.some((k) => k.type === 'toggle' || (k.type === 'heading' && k.toggleable));
        if (!nested && text && kids.length) {
          add({ id: `nt_${shortId(b.id)}`, type: 'basic', front: text, back: renderBlocks(kids), extra: '', rule: 'toggle' });
          continue;
        }
        // Toggle que agrupa outros toggles: funciona como um subtítulo.
        if (b.type === 'heading') headings.push({ level: b.level, text: strip(text) });
        else headings.push({ level: 9, text: strip(text) });
        walk(kids);
        headings.pop();
        continue;
      }

      if (b.type === 'table') {
        const rows = tableRows(b);
        const header = b.hasColumnHeader ? rows.shift() : null;
        const rowBlocks = (b.children || []).filter((r) => r.type === 'row').slice(b.hasColumnHeader ? 1 : 0);
        rows.forEach((cells, k) => {
          const [first, ...rest] = cells;
          if (!strip(first || '') || !rest.some((c) => strip(c))) return;
          const back = rest
            .map((c, j) => (strip(c) ? (header?.[j + 1] && strip(header[j + 1]) ? `**${strip(header[j + 1])}:** ${c}` : c) : null))
            .filter(Boolean)
            .join('\n');
          add({ id: `nt_${shortId(rowBlocks[k]?.id || `${b.id}_${k}`)}`, type: 'basic', front: first, back, extra: '', rule: 'table' });
        });
        continue;
      }

      if (!TEXT_TYPES.has(b.type) || !text) {
        if (b.children?.length && !['child_page', 'child_database'].includes(b.type)) walk(b.children);
        continue;
      }

      const kids = b.children || [];
      const id = `nt_${shortId(b.id)}`;

      // 2. Pergunta
      if (/\?\s*$/.test(strip(text))) {
        if (kids.length) {
          add({ id, type: 'basic', front: text, back: renderBlocks(kids), extra: '', rule: 'question' });
          continue;
        }
        const next = list[i + 1];
        if (next && TEXT_TYPES.has(next.type) && next.text?.trim() && !/\?\s*$/.test(strip(next.text))) {
          const back = [next.text.trim(), next.children?.length ? renderBlocks(next.children) : ''].filter(Boolean).join('\n');
          add({ id, type: 'basic', front: text, back, extra: '', rule: 'question' });
          i += 1;
          continue;
        }
      }

      // 3. Definição
      const def = matchDefinition(text);
      if (def) {
        const back = [def.definition, kids.length ? renderBlocks(kids) : ''].filter(Boolean).join('\n');
        add({ id, type: 'basic', front: def.term, back, extra: '', rule: 'definition' });
        continue;
      }

      // 4. Item com subitens
      if (kids.length && (LIST_TYPES.has(b.type) || b.type === 'paragraph' || b.type === 'callout')) {
        const ownCloze = toCloze(text);
        if (!ownCloze || LIST_TYPES.has(b.type)) {
          add({ id, type: 'basic', front: text, back: renderBlocks(kids), extra: '', rule: 'list' });
          continue;
        }
      }

      // 5. Lacunas
      const cloze = toCloze(text);
      if (cloze) {
        add({ id, type: 'cloze', front: cloze, back: '', extra: kids.length ? renderBlocks(kids) : '', rule: 'cloze' });
        continue;
      }

      // Texto corrido sem marcação: não vira cartão, mas os filhos podem virar.
      if (kids.length) walk(kids);
    }
  }

  walk(blocks);
  const list = [...topics.entries()].map(([name, cards]) => ({ name, cards }));
  return { title: pageTitle, topics: list, total: list.reduce((a, t) => a + t.cards.length, 0) };
}

function collectHeadingLevels(blocks, out = []) {
  for (const b of blocks) {
    if (b.type === 'heading' && !b.toggleable) out.push(b.level);
  }
  return [...new Set(out)];
}

// Contagem por regra (para mostrar "de onde veio cada cartão").
export function ruleCounts(result) {
  const out = {};
  for (const t of result.topics) for (const c of t.cards) out[c.rule] = (out[c.rule] || 0) + 1;
  return out;
}
