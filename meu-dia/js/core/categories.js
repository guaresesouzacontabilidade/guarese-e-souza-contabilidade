// Categorias sugeridas para lançamentos e agenda, com palavras-chave para sugestão automática.
import { normalize } from './text.js';

export const EXPENSE_CATEGORIES = [
  { id: 'alimentacao', hue: 24, label: 'Alimentação', icon: 'utensils', words: ['alimentacao', 'comida', 'restaurante', 'lanche', 'lanchonete', 'almoco', 'jantar', 'cafe', 'padaria', 'ifood', 'pizza', 'hamburguer', 'delivery', 'marmita', 'acai', 'sorvete', 'rappi', 'refeicao', 'pastel'] },
  { id: 'mercado', hue: 142, label: 'Mercado', icon: 'shopping-cart', words: ['mercado', 'supermercado', 'feira', 'hortifruti', 'sacolao', 'atacadao', 'assai', 'carrefour', 'acougue', 'compras do mes'] },
  { id: 'combustivel', hue: 4, label: 'Combustível', icon: 'fuel', words: ['combustivel', 'gasolina', 'etanol', 'alcool', 'diesel', 'posto', 'abastecimento', 'abasteci', 'gnv', 'shell', 'ipiranga', 'petrobras'] },
  { id: 'transporte', hue: 210, label: 'Transporte', icon: 'car', words: ['transporte', 'uber', '99', 'onibus', 'metro', 'taxi', 'estacionamento', 'pedagio', 'passagem', 'bilhete', 'oficina', 'mecanico', 'ipva', 'licenciamento', 'carro', 'moto', 'lavagem', 'pneu'] },
  { id: 'moradia', hue: 36, label: 'Moradia', icon: 'house', words: ['moradia', 'aluguel', 'condominio', 'luz', 'energia', 'agua', 'gas', 'internet', 'iptu', 'reforma', 'manutencao', 'faxina', 'diarista', 'casa', 'financiamento'] },
  { id: 'saude', hue: 340, label: 'Saúde', icon: 'heart-pulse', words: ['saude', 'farmacia', 'remedio', 'medicamento', 'medico', 'consulta', 'exame', 'dentista', 'plano de saude', 'hospital', 'academia', 'terapia', 'psicologo', 'drogaria'] },
  { id: 'educacao', hue: 262, label: 'Educação', icon: 'graduation-cap', words: ['educacao', 'escola', 'faculdade', 'curso', 'livro', 'material escolar', 'mensalidade escolar', 'aula', 'apostila'] },
  { id: 'lazer', hue: 288, label: 'Lazer', icon: 'ticket', words: ['lazer', 'cinema', 'show', 'viagem', 'hotel', 'passeio', 'bar', 'festa', 'ingresso', 'jogo', 'teatro', 'praia', 'balada'] },
  { id: 'compras', hue: 318, label: 'Compras', icon: 'shopping-bag', words: ['compras', 'roupa', 'sapato', 'tenis', 'loja', 'shopping', 'amazon', 'mercado livre', 'shopee', 'eletronico', 'presente', 'magazine'] },
  { id: 'assinaturas', hue: 192, label: 'Assinaturas', icon: 'tv', words: ['assinatura', 'assinaturas', 'netflix', 'spotify', 'prime', 'disney', 'hbo', 'max', 'youtube', 'icloud', 'google one', 'streaming', 'celular', 'plano do celular', 'telefone'] },
  { id: 'trabalho', hue: 232, label: 'Trabalho', icon: 'briefcase', words: ['trabalho', 'escritorio', 'material de escritorio', 'software', 'coworking', 'ferramenta', 'equipamento'] },
  { id: 'impostos', hue: 52, label: 'Impostos e taxas', icon: 'receipt-text', words: ['imposto', 'impostos', 'taxa', 'taxas', 'das', 'inss', 'irpf', 'darf', 'multa', 'tarifa', 'anuidade', 'juros'] },
  { id: 'pets', hue: 170, label: 'Pets', icon: 'paw-print', words: ['pet', 'pets', 'racao', 'veterinario', 'petshop', 'pet shop', 'banho e tosa', 'cachorro', 'gato'] },
  { id: 'outros', label: 'Outros', icon: 'circle-ellipsis', words: ['outros', 'outro', 'diversos'] },
];

export const INCOME_CATEGORIES = [
  { id: 'salario', hue: 156, label: 'Salário', icon: 'banknote', words: ['salario', 'holerite', 'pagamento', '13', 'decimo terceiro', 'ferias', 'adiantamento', 'vale'] },
  { id: 'servicos', hue: 188, label: 'Trabalho extra', icon: 'briefcase-business', words: ['freela', 'freelance', 'servico', 'servicos', 'consultoria', 'honorario', 'honorarios', 'comissao', 'cliente', 'bico', 'extra'] },
  { id: 'vendas', hue: 96, label: 'Vendas', icon: 'store', words: ['venda', 'vendas', 'vendi'] },
  { id: 'rendimentos', hue: 172, label: 'Rendimentos', icon: 'trending-up', words: ['rendimento', 'rendimentos', 'juros', 'dividendos', 'cdb', 'poupanca', 'investimento', 'aluguel recebido'] },
  { id: 'reembolso', hue: 214, label: 'Reembolso', icon: 'undo-2', words: ['reembolso', 'estorno', 'devolucao', 'cashback', 'restituicao'] },
  { id: 'presente', hue: 330, label: 'Presentes', icon: 'gift', words: ['presente', 'pix de', 'mesada'] },
  { id: 'outras-receitas', label: 'Outras receitas', icon: 'circle-ellipsis', words: ['outros', 'outra', 'diversos'] },
];

export const AGENDA_CATEGORIES = [
  { id: 'pessoal', label: 'Pessoal', icon: 'user' },
  { id: 'trabalho', label: 'Trabalho', icon: 'briefcase' },
  { id: 'saude', label: 'Saúde', icon: 'heart-pulse' },
  { id: 'familia', label: 'Família', icon: 'users' },
  { id: 'estudos', label: 'Estudos', icon: 'book-open' },
  { id: 'casa', label: 'Casa', icon: 'house' },
];

const ALL = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

// Cor de cada categoria (matiz de 0 a 360). Categorias criadas pela pessoa ganham uma cor fixa pelo nome;
// "Outros" e "Sem categoria" ficam neutros.
export function categoryHue(cat) {
  if (!cat || cat.id === 'outros' || cat.id === 'outras-receitas' || cat.id === 'sem-categoria') return null;
  if (typeof cat.hue === 'number') return cat.hue;
  let h = 0;
  for (const ch of String(cat.id || cat.label || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
const FALLBACK = { id: 'outros', label: 'Sem categoria', icon: 'tag' };

export function categoriesFor(type, custom = []) {
  const base = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const extra = custom.filter((c) => c.type === type).map((c) => ({ ...c, icon: c.icon || 'tag', words: [] }));
  // "Outros" sempre por último.
  return [...base.slice(0, -1), ...extra, base[base.length - 1]];
}

export function findCategory(id, type, custom = []) {
  if (!id) return FALLBACK;
  const list = type ? categoriesFor(type, custom) : [...ALL, ...custom];
  return list.find((c) => c.id === id) || custom.find((c) => c.id === id) || ALL.find((c) => c.id === id) || { ...FALLBACK, id, label: id };
}

export function findAgendaCategory(id) {
  return AGENDA_CATEGORIES.find((c) => c.id === id) || null;
}

function wordHit(text, word) {
  const w = normalize(word);
  if (!w) return false;
  return (` ${text} `).includes(` ${w} `) || (w.length >= 5 && text.includes(w));
}

// ---------- Regras aprendidas ("UBER" é sempre Transporte) ----------

// Palavras que os bancos colocam antes do nome da loja e não ajudam a reconhecê-la.
const NOISE = new Set([
  'compra', 'compras', 'cartao', 'credito', 'debito', 'deb', 'cred', 'aut', 'automatico', 'pagamento', 'pagto', 'pgto', 'pag', 'pg',
  'ec', 'mp', 'pp', 'ifd', 'dl', 'ebanx', 'mc', 'vs', 'elo', 'visa', 'master', 'mastercard', 'int', 'internacional', 'nacional',
  'parc', 'parcela', 'parcelado', 'estab', 'loja', 'lojas', 'no', 'na', 'de', 'do', 'da', 'dos', 'das', 'em', 'com', 'para', 'pra',
  'boleto', 'conta', 'tarifa', 'sa', 'ltda', 'me', 'eireli', 'br', 'bra', 'www', 'net',
]);
const TRANSFER = new Set(['pix', 'ted', 'doc', 'transferencia', 'transf', 'enviado', 'enviada', 'recebido', 'recebida', 'qrcode', 'qr']);
// Palavras genéricas: junto com elas, guarda também a palavra seguinte ("posto shell", "farmacia sao joao").
const GENERIC = new Set(['posto', 'farmacia', 'drogaria', 'supermercado', 'mercado', 'restaurante', 'padaria', 'auto', 'comercio', 'casa', 'bar', 'lanchonete', 'academia', 'clinica', 'hospital', 'escola', 'the', 'super', 'atacado', 'distribuidora']);

// Palavras da descrição, sem acentos, números e símbolos ("IFD*IFOOD CLUB 12" → ifd ifood club).
export function descriptionWords(description) {
  return normalize(String(description || '').replace(/[*._/\\-]/g, ' '))
    .split(' ')
    .filter((w) => w.length >= 2 && !/\d/.test(w));
}

// O "nome" que identifica a loja ou pessoa numa descrição, usado como chave da regra.
export function ruleKey(description) {
  const words = descriptionWords(description);
  const isTransfer = words.some((w) => TRANSFER.has(w));
  const rest = words.filter((w) => !NOISE.has(w) && !TRANSFER.has(w));
  if (!rest.length || rest[0].length < 3) return null;
  // Pix e transferências: o nome da pessoa (duas palavras) para não juntar "João Silva" com "João Souza".
  const take = isTransfer || GENERIC.has(rest[0]) || rest[0].length < 4 ? 2 : 1;
  return rest.slice(0, take).join(' ');
}

export function ruleMatches(rule, description) {
  return (` ${descriptionWords(description).join(' ')} `).includes(` ${rule.match} `);
}

// A regra mais específica (texto mais longo) que vale para a descrição.
export function findRule(description, type, rules = []) {
  let best = null;
  for (const r of rules) {
    if (r.type !== type || !ruleMatches(r, description)) continue;
    if (!best || r.match.length > best.match.length) best = r;
  }
  return best;
}

// Guarda (ou atualiza) a regra a partir de uma correção. Devolve a lista nova e a regra, ou null se nada mudou.
export function learnRule(rules = [], { description, type, category, id }) {
  const match = ruleKey(description);
  if (!match || !category || type === 'transfer') return { rules, rule: null };
  const existing = rules.find((r) => r.type === type && r.match === match);
  if (existing) {
    if (existing.category === category) return { rules, rule: null };
    const rule = { ...existing, category };
    return { rules: rules.map((r) => (r === existing ? rule : r)), rule };
  }
  const rule = { id, type, match, category };
  return { rules: [...rules, rule], rule };
}

// Sugere uma categoria a partir da descrição: regras aprendidas, depois o histórico, depois palavras-chave.
export function suggestCategory(description, type, history = [], custom = [], rules = []) {
  const text = normalize(description);
  if (!text) return null;
  const valid = new Set(categoriesFor(type, custom).map((c) => c.id));
  const rule = findRule(description, type, rules);
  if (rule && valid.has(rule.category)) return rule.category;
  const past = history
    .filter((t) => t.type === type && t.category && !t.deleted && normalize(t.description) === text)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (past && valid.has(past.category)) return past.category;
  const list = categoriesFor(type, custom);
  for (const cat of list) {
    if (wordHit(text, cat.label)) return cat.id;
  }
  for (const cat of list) {
    if ((cat.words || []).some((w) => wordHit(text, w))) return cat.id;
  }
  return null;
}

// Usado pelo assistente: encontra a categoria citada numa pergunta ("combustível", "gasolina"...).
export function categoryFromTerm(term, custom = []) {
  const text = normalize(term);
  if (!text) return null;
  const all = [...categoriesFor('expense', custom), ...categoriesFor('income', custom)];
  const byLabel = all.find((c) => normalize(c.label) === text || c.id === text || (text.length >= 4 && normalize(c.label).startsWith(text)));
  if (byLabel) return { category: byLabel, exact: true };
  const byWord = all.find((c) => (c.words || []).some((w) => normalize(w) === text));
  if (byWord) return { category: byWord, exact: false };
  return null;
}
