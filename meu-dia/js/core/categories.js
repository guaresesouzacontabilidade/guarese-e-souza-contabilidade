// Categorias sugeridas para lançamentos e agenda, com palavras-chave para sugestão automática.
import { normalize } from './text.js';

export const EXPENSE_CATEGORIES = [
  { id: 'alimentacao', label: 'Alimentação', icon: 'utensils', words: ['alimentacao', 'comida', 'restaurante', 'lanche', 'lanchonete', 'almoco', 'jantar', 'cafe', 'padaria', 'ifood', 'pizza', 'hamburguer', 'delivery', 'marmita', 'acai', 'sorvete', 'rappi', 'refeicao', 'pastel'] },
  { id: 'mercado', label: 'Mercado', icon: 'shopping-cart', words: ['mercado', 'supermercado', 'feira', 'hortifruti', 'sacolao', 'atacadao', 'assai', 'carrefour', 'acougue', 'compras do mes'] },
  { id: 'combustivel', label: 'Combustível', icon: 'fuel', words: ['combustivel', 'gasolina', 'etanol', 'alcool', 'diesel', 'posto', 'abastecimento', 'abasteci', 'gnv', 'shell', 'ipiranga', 'petrobras'] },
  { id: 'transporte', label: 'Transporte', icon: 'car', words: ['transporte', 'uber', '99', 'onibus', 'metro', 'taxi', 'estacionamento', 'pedagio', 'passagem', 'bilhete', 'oficina', 'mecanico', 'ipva', 'licenciamento', 'carro', 'moto', 'lavagem', 'pneu'] },
  { id: 'moradia', label: 'Moradia', icon: 'house', words: ['moradia', 'aluguel', 'condominio', 'luz', 'energia', 'agua', 'gas', 'internet', 'iptu', 'reforma', 'manutencao', 'faxina', 'diarista', 'casa', 'financiamento'] },
  { id: 'saude', label: 'Saúde', icon: 'heart-pulse', words: ['saude', 'farmacia', 'remedio', 'medicamento', 'medico', 'consulta', 'exame', 'dentista', 'plano de saude', 'hospital', 'academia', 'terapia', 'psicologo', 'drogaria'] },
  { id: 'educacao', label: 'Educação', icon: 'graduation-cap', words: ['educacao', 'escola', 'faculdade', 'curso', 'livro', 'material escolar', 'mensalidade escolar', 'aula', 'apostila'] },
  { id: 'lazer', label: 'Lazer', icon: 'ticket', words: ['lazer', 'cinema', 'show', 'viagem', 'hotel', 'passeio', 'bar', 'festa', 'ingresso', 'jogo', 'teatro', 'praia', 'balada'] },
  { id: 'compras', label: 'Compras', icon: 'shopping-bag', words: ['compras', 'roupa', 'sapato', 'tenis', 'loja', 'shopping', 'amazon', 'mercado livre', 'shopee', 'eletronico', 'presente', 'magazine'] },
  { id: 'assinaturas', label: 'Assinaturas', icon: 'tv', words: ['assinatura', 'assinaturas', 'netflix', 'spotify', 'prime', 'disney', 'hbo', 'max', 'youtube', 'icloud', 'google one', 'streaming', 'celular', 'plano do celular', 'telefone'] },
  { id: 'trabalho', label: 'Trabalho', icon: 'briefcase', words: ['trabalho', 'escritorio', 'material de escritorio', 'software', 'coworking', 'ferramenta', 'equipamento'] },
  { id: 'impostos', label: 'Impostos e taxas', icon: 'receipt-text', words: ['imposto', 'impostos', 'taxa', 'taxas', 'das', 'inss', 'irpf', 'darf', 'multa', 'tarifa', 'anuidade', 'juros'] },
  { id: 'pets', label: 'Pets', icon: 'paw-print', words: ['pet', 'pets', 'racao', 'veterinario', 'petshop', 'pet shop', 'banho e tosa', 'cachorro', 'gato'] },
  { id: 'outros', label: 'Outros', icon: 'circle-ellipsis', words: ['outros', 'outro', 'diversos'] },
];

export const INCOME_CATEGORIES = [
  { id: 'salario', label: 'Salário', icon: 'banknote', words: ['salario', 'holerite', 'pagamento', '13', 'decimo terceiro', 'ferias', 'adiantamento', 'vale'] },
  { id: 'servicos', label: 'Trabalho extra', icon: 'briefcase-business', words: ['freela', 'freelance', 'servico', 'servicos', 'consultoria', 'honorario', 'honorarios', 'comissao', 'cliente', 'bico', 'extra'] },
  { id: 'vendas', label: 'Vendas', icon: 'store', words: ['venda', 'vendas', 'vendi'] },
  { id: 'rendimentos', label: 'Rendimentos', icon: 'trending-up', words: ['rendimento', 'rendimentos', 'juros', 'dividendos', 'cdb', 'poupanca', 'investimento', 'aluguel recebido'] },
  { id: 'reembolso', label: 'Reembolso', icon: 'undo-2', words: ['reembolso', 'estorno', 'devolucao', 'cashback', 'restituicao'] },
  { id: 'presente', label: 'Presentes', icon: 'gift', words: ['presente', 'pix de', 'mesada'] },
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

// Sugere uma categoria a partir da descrição: primeiro aprende com o histórico, depois usa palavras-chave.
export function suggestCategory(description, type, history = [], custom = []) {
  const text = normalize(description);
  if (!text) return null;
  const valid = new Set(categoriesFor(type, custom).map((c) => c.id));
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
