/**
 * Lista nacional de serviços da NFS-e (Anexo B do leiaute v1.01, de
 * 22/01/2026): os 338 códigos de tributação nacional (item, subitem e desdobro
 * da LC 116/2003), guardados na tabela nfse_lista_servicos.
 *
 * A nota nacional não leva o CNAE, e sim o código de tributação. Não existe
 * tabela oficial que ligue um ao outro, então as sugestões daqui comparam as
 * palavras da descrição da atividade (CNAE) com as descrições oficiais da
 * lista. São só sugestões: o escritório confere o código antes de cadastrar.
 */

export interface ServicoNacional {
  codigo: string;
  descricao: string;
  descricao_subitem: string | null;
  descricao_item: string | null;
}

export interface Cnae {
  codigo: string;
  descricao: string | null;
  principal: boolean;
}

/** Atividades da empresa: as da consulta à Receita ou, sem ela, a principal do cadastro. */
export function cnaesDaEmpresa(
  receita: { cnaePrincipal: { codigo: string; descricao: string | null } | null; cnaesSecundarios: { codigo: string; descricao: string | null }[] } | null,
  cnae: string | null | undefined,
  atividade: string | null | undefined,
): Cnae[] {
  const lista: Cnae[] = [];
  if (receita?.cnaePrincipal) lista.push({ ...receita.cnaePrincipal, principal: true });
  else if (cnae && /^\d{4}-\d\/\d{2}$/.test(cnae.trim())) lista.push({ codigo: cnae.trim(), descricao: atividade?.trim() || null, principal: true });
  for (const c of receita?.cnaesSecundarios ?? []) if (!lista.some((l) => l.codigo === c.codigo)) lista.push({ ...c, principal: false });
  return lista;
}

/** "140101" → "14.01.01" */
export function formatarCodigoServico(codigo: string) {
  return /^\d{6}$/.test(codigo) ? `${codigo.slice(0, 2)}.${codigo.slice(2, 4)}.${codigo.slice(4)}` : codigo;
}

// Palavras que aparecem em quase toda descrição e não dizem qual é o serviço
const VAZIAS = new Set(
  (
    "para pelo pela pelos pelas como com sem sobre entre ainda outros outras outro outra demais quaisquer qualquer natureza " +
    "congeneres similares inclusive exceto especificados especificadas especificado especificada anteriormente " +
    "servicos servico atividades atividade geral gerais tipo tipos forma formas meio meios caso casos quando cujo cuja " +
    "desta deste dessa desse esta este essa esse lista itens item contida contidos sujeito sujeita fica ficam " +
    "preponderantemente principalmente exclusivamente realizada realizado realizados realizadas executada executados " +
    "prestados prestado prestadas prestada destinados destinadas destinado destinada relacionados relacionadas " +
    "classificados classificadas subposicoes anteriores"
  ).split(" "),
);

export function palavras(texto: string | null | undefined): string[] {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4 && !/^\d+$/.test(p) && !VAZIAS.has(p));
}

/** Quanto duas palavras se parecem pelo começo, de 0 a 1: "lavanderias" × "lavanderia" sim; "contabilidade" × "conta" não. */
function semelhanca(a: string, b: string) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const q = i / Math.max(a.length, b.length);
  return i >= 4 && q >= 0.5 ? q : 0;
}

/**
 * Itens da LC 116 em que caem as atividades de cada divisão da CNAE (ex.: 75
 * veterinária → item 5; 86 saúde → item 4). Nas divisões listadas, as
 * sugestões ficam só nesses itens; lista vazia = atividade que não é serviço
 * da LC 116 (energia, água, administração pública, associações...).
 */
const ITENS_POR_DIVISAO: Record<string, number[]> = {
  "18": [13, 24], "33": [14], "35": [], "36": [], "37": [7], "38": [7], "39": [7], "41": [7], "42": [7], "43": [7, 14],
  "45": [14], "49": [16], "50": [16, 20], "51": [20], "52": [11, 16, 20], "53": [26], "55": [9], "56": [17], "58": [13],
  "59": [12, 13], "60": [12, 13], "61": [1], "62": [1], "63": [1, 17], "64": [15, 17], "65": [10, 15, 18],
  "66": [10, 15, 17, 18], "68": [10, 17], "69": [17, 21], "70": [17], "71": [7, 30, 31, 32], "72": [2, 30],
  "73": [10, 17, 23], "74": [10, 13, 17, 23, 24], "75": [5], "77": [3], "78": [17], "79": [9], "80": [11, 34], "81": [7],
  "82": [15, 17], "84": [], "85": [8], "86": [4], "87": [4, 27], "88": [4, 27], "90": [12, 37, 40], "91": [12, 29, 38],
  "92": [19], "93": [6, 12], "94": [], "95": [14], "96": [5, 6, 14, 25], "97": [], "99": [],
};

interface Indexado {
  servico: ServicoNacional;
  /** palavra → peso: descrição do código 1; do subitem 0,6; do item 0,3 */
  termos: Map<string, number>;
}

export interface IndiceServicos {
  itens: Indexado[];
  idf: Map<string, number>;
}

const raiz = (p: string) => p.slice(0, 6);

export function indexarServicos(lista: ServicoNacional[]): IndiceServicos {
  const itens = lista.map((s) => {
    const termos = new Map<string, number>();
    for (const p of palavras(s.descricao_item)) termos.set(p, 0.3);
    for (const p of palavras(s.descricao_subitem)) termos.set(p, 0.6);
    for (const p of palavras(s.descricao)) termos.set(p, 1);
    return { servico: s, termos };
  });
  // Palavra rara (em poucos códigos) pesa mais; a descrição do item, repetida em todos os códigos dele, não entra na conta
  const freq = new Map<string, number>();
  for (const { termos } of itens) {
    const proprias = [...termos].filter(([, peso]) => peso >= 0.6).map(([p]) => raiz(p));
    for (const r of new Set(proprias)) freq.set(r, (freq.get(r) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [r, f] of freq) idf.set(r, Math.log(1 + itens.length / f));
  const raro = Math.log(1 + itens.length);
  for (const { termos } of itens) for (const p of termos.keys()) if (!idf.has(raiz(p))) idf.set(raiz(p), raro);
  return { itens, idf };
}

function pontuar(indice: IndiceServicos, consulta: string[], item: Indexado) {
  let total = 0;
  for (const q of consulta) {
    let melhor = 0;
    for (const [d, peso] of item.termos) {
      const s = semelhanca(q, d);
      if (s) melhor = Math.max(melhor, s * peso * (indice.idf.get(raiz(d)) ?? 0));
    }
    total += melhor;
  }
  return total;
}

/** Busca por palavras ("conserto de carro") ou pelo código ("14.01", "140101"). */
export function buscarServicos(indice: IndiceServicos, texto: string, limite = 8): ServicoNacional[] {
  const digitos = texto.replace(/[\s.\-/]/g, "");
  if (/^\d{1,6}$/.test(digitos)) {
    const prefixo = digitos.length % 2 && digitos.length < 6 ? digitos.padStart(digitos.length + 1, "0") : digitos;
    return indice.itens.filter((i) => i.servico.codigo.startsWith(prefixo)).slice(0, limite).map((i) => i.servico);
  }
  const consulta = palavras(texto);
  if (!consulta.length) return [];
  return indice.itens
    .map((i) => ({ i, nota: pontuar(indice, consulta, i) }))
    .filter((r) => r.nota > 0)
    .sort((a, b) => b.nota - a.nota || a.i.servico.codigo.localeCompare(b.i.servico.codigo))
    .slice(0, limite)
    .map((r) => r.i.servico);
}

/**
 * Comércio (divisões 45 a 47 da CNAE) vende mercadoria: a nota é a de produto
 * (NF-e), não a de serviço. As exceções são os consertos de veículos (4520) e
 * de motos (4543), que são serviço.
 */
export function atividadeDeComercio(cnae: string) {
  const d = cnae.replace(/\D/g, "");
  return /^4[5-7]/.test(d) && !d.startsWith("4520") && !d.startsWith("4543");
}

/** Até 3 serviços da lista nacional com descrição parecida com a da atividade. */
export function sugerirServicos(indice: IndiceServicos, cnae: Cnae, limite = 3): ServicoNacional[] {
  if (atividadeDeComercio(cnae.codigo)) return [];
  const divisao = cnae.codigo.replace(/\D/g, "").slice(0, 2);
  const tipicos = ITENS_POR_DIVISAO[divisao];
  // Agropecuária, extração e indústria (01 a 32): só as atividades descritas como serviço ou apoio
  if (!tipicos && Number(divisao) <= 32 && !/servi|apoio/i.test(cnae.descricao ?? "")) return [];
  const consulta = palavras(cnae.descricao);
  if (!consulta.length) return [];
  const notas = indice.itens
    .map((i) => ({ i, nota: pontuar(indice, consulta, i) }))
    .filter((r) => r.nota > 0 && (!tipicos || tipicos.includes(Number(r.i.servico.codigo.slice(0, 2)))));
  notas.sort((a, b) => b.nota - a.nota || a.i.servico.codigo.localeCompare(b.i.servico.codigo));
  if (!notas.length) return [];
  // Só o que chega perto da melhor, com ao menos uma palavra pouco comum em comum
  const corte = Math.max(notas[0].nota * 0.5, 1.5);
  return notas
    .filter((r) => r.nota >= corte)
    .slice(0, limite)
    .map((r) => r.i.servico);
}
