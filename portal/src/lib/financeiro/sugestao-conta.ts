/**
 * Sugestão da conta (categoria) no lançamento, só com o histórico da própria
 * empresa: a conta usada da última vez com o mesmo fornecedor/cliente ou com
 * uma descrição parecida. Sem serviço externo e sem inteligência artificial.
 */
export interface LancamentoHistorico {
  tipo: "pagar" | "receber";
  descricao: string;
  categoria_id: string;
  contraparte_id: string | null;
}

export interface Sugestao {
  categoriaId: string;
  motivo: "fornecedor" | "descricao";
  exemplo: string;
}

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "para", "pra", "com", "sem", "por", "the", "uma", "um", "e", "a", "o", "em", "no", "na", "ref", "referente", "pagamento", "pgto", "pag", "compra", "valor", "conta", "mes"]);

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function palavras(texto: string): string[] {
  return [...new Set(normalizar(texto).split(" ").filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p)))];
}

/** Contas mais usadas no tipo (do mais usado para o menos; empate: a mais recente). */
export function contasMaisUsadas(historico: LancamentoHistorico[], tipo: "pagar" | "receber", limite = 6): string[] {
  const contagem = new Map<string, { n: number; ordem: number }>();
  historico.forEach((h, i) => {
    if (h.tipo !== tipo) return;
    const atual = contagem.get(h.categoria_id);
    contagem.set(h.categoria_id, { n: (atual?.n ?? 0) + 1, ordem: atual?.ordem ?? i });
  });
  return [...contagem.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].ordem - b[1].ordem)
    .slice(0, limite)
    .map(([id]) => id);
}

/**
 * O histórico vem do mais recente para o mais antigo. Primeiro o mesmo
 * fornecedor/cliente; depois a descrição com mais palavras em comum (pelo
 * menos metade das palavras da descrição digitada).
 */
export function sugerirConta(
  historico: LancamentoHistorico[],
  entrada: { tipo: "pagar" | "receber"; descricao: string; contraparteId?: string | null },
  contasValidas?: Set<string>,
): Sugestao | null {
  const doTipo = historico.filter((h) => h.tipo === entrada.tipo && (!contasValidas || contasValidas.has(h.categoria_id)));
  if (entrada.contraparteId) {
    const mesmo = doTipo.find((h) => h.contraparte_id === entrada.contraparteId);
    if (mesmo) return { categoriaId: mesmo.categoria_id, motivo: "fornecedor", exemplo: mesmo.descricao };
  }
  const alvo = palavras(entrada.descricao);
  if (!alvo.length) return null;
  let melhor: { h: LancamentoHistorico; nota: number } | null = null;
  for (const h of doTipo) {
    const ph = palavras(h.descricao);
    if (!ph.length) continue;
    const comuns = alvo.filter((p) => ph.some((q) => q === p || (p.length >= 5 && q.startsWith(p)) || (q.length >= 5 && p.startsWith(q)))).length;
    const nota = comuns / alvo.length;
    if (nota >= 0.5 && (!melhor || nota > melhor.nota)) melhor = { h, nota };
  }
  return melhor ? { categoriaId: melhor.h.categoria_id, motivo: "descricao", exemplo: melhor.h.descricao } : null;
}
