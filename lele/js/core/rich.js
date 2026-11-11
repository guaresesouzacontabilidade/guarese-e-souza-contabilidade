// Texto dos cartões: formatação simples e segura (o HTML digitado nunca é executado).
//   **negrito**   *itálico*   ==destaque==   __sublinhado__
//   linhas começando com "- " viram lista; "1. " vira lista numerada
//   -> vira →, <- vira ←, <-> vira ↔, => vira ⇒

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Formatação dentro de uma linha (recebe texto já escapado).
export function inline(s) {
  return s
    .replace(/&lt;-&gt;/g, '↔')
    .replace(/-&gt;/g, '→')
    .replace(/&lt;-/g, '←')
    .replace(/=&gt;/g, '⇒')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<u>$1</u>')
    .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1<em>$2</em>');
}

/**
 * Converte o texto do cartão em HTML. `preprocess` recebe o texto escapado
 * (usado pelas lacunas) antes da formatação.
 */
export function renderRich(text, preprocess = (s) => s) {
  const escaped = preprocess(escapeHtml(String(text ?? '').replace(/\r\n?/g, '\n').trim()));
  const lines = escaped.split('\n');
  const out = [];
  let list = null; // { tag, items }
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*(?:[-•*]|–)\s+(.*)$/);
    const ol = line.match(/^\s*\d{1,2}[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((ul || ol)[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join('');
}

// Texto puro (para listas e busca): sem marcações.
export function plainText(text) {
  return String(text ?? '')
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1')
    .replace(/\*\*|__|==/g, '')
    .replace(/(^|\s)\*(\S)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Para buscar sem se preocupar com acentos e maiúsculas.
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
