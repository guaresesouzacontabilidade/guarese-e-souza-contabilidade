/**
 * Privacidade no assistente de IA: os nomes dos funcionários não saem do
 * portal. Antes do envio, cada pessoa vira um apelido (P1, P2...) e os nomes
 * que aparecerem no texto do pedido são trocados pelos apelidos; na volta, os
 * apelidos da resposta viram nomes de novo, só na tela.
 */

export interface Apelidos {
  /** id da pessoa → apelido */
  porId: Map<string, string>;
  /** apelido → id */
  porApelido: Map<string, string>;
  /** apelido → nome (para mostrar a resposta) */
  nomes: Map<string, string>;
}

export function criarApelidos(pessoas: { id: string; nome: string }[]): Apelidos {
  const porId = new Map<string, string>();
  const porApelido = new Map<string, string>();
  const nomes = new Map<string, string>();
  pessoas.forEach((p, i) => {
    const a = `P${i + 1}`;
    porId.set(p.id, a);
    porApelido.set(a, p.id);
    nomes.set(a, p.nome);
  });
  return { porId, porApelido, nomes };
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Expressão que acha a palavra com ou sem acento, sem diferenciar maiúsculas. */
function padrao(palavra: string) {
  const letras = [...semAcento(palavra)].map((c) => {
    const base = escapar(c);
    const variantes: Record<string, string> = { a: "aáàâãä", e: "eéèêë", i: "iíìîï", o: "oóòôõö", u: "uúùûü", c: "cç", n: "nñ" };
    const v = variantes[c.toLowerCase()];
    return v ? `[${v}${v.toUpperCase()}]` : base;
  });
  return new RegExp(`(?<![\\p{L}\\p{N}])${letras.join("")}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * Troca no texto os nomes completos e os primeiros nomes (quando não se repetem
 * na empresa e têm 3 letras ou mais) pelos apelidos.
 */
export function anonimizarTexto(texto: string, pessoas: { id: string; nome: string }[], apelidos: Apelidos): string {
  let saida = texto;
  const limpar = (nome: string) => nome.replace(/\s*\((?:DEMO|demonstra[çc][ãa]o)\)\s*/gi, " ").trim();
  // Nomes completos primeiro (mais longos antes)
  const completos = pessoas.map((p) => ({ id: p.id, nome: limpar(p.nome) })).sort((a, b) => b.nome.length - a.nome.length);
  for (const p of completos) if (p.nome.length >= 3) saida = saida.replace(padrao(p.nome), apelidos.porId.get(p.id)!);
  // Primeiros nomes que identificam uma só pessoa
  const contagem = new Map<string, number>();
  for (const p of completos) {
    const primeiro = semAcento(p.nome.split(/\s+/)[0] ?? "").toLowerCase();
    contagem.set(primeiro, (contagem.get(primeiro) ?? 0) + 1);
  }
  for (const p of completos) {
    const primeiro = p.nome.split(/\s+/)[0] ?? "";
    if (primeiro.length >= 3 && contagem.get(semAcento(primeiro).toLowerCase()) === 1) saida = saida.replace(padrao(primeiro), apelidos.porId.get(p.id)!);
  }
  // Sobrenomes soltos
  for (const p of completos) {
    for (const parte of p.nome.split(/\s+/).slice(1)) {
      if (parte.length >= 4 && !/^(de|da|do|dos|das)$/i.test(parte)) saida = saida.replace(padrao(parte), apelidos.porId.get(p.id)!);
    }
  }
  // Números que parecem documentos (CPF, telefone) saem do texto
  return saida.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento removido]").replace(/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, "[telefone removido]");
}

/** Troca os apelidos (P1, P2...) da resposta pelos nomes. */
export function nomearTexto(texto: string, apelidos: Apelidos): string {
  return texto.replace(/\bP(\d{1,3})\b/g, (m) => apelidos.nomes.get(m) ?? m);
}
