import "server-only";
import { createHash } from "node:crypto";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { dec, somar } from "@/lib/dinheiro";
import { normalizarDescricao, type LinhaInvalida, type TransacaoExtrato } from "@/lib/extratos/comum";
import { ehOfx, lerOfx } from "@/lib/extratos/ofx";
import { aplicarMapeamento, lerArquivoPlanilha, sugerirMapeamento, type Mapeamento } from "@/lib/extratos/planilha";
import { lerData } from "@/lib/extratos/comum";
import { lerValorBR } from "@/lib/dinheiro";

export const EXTENSOES_IMPORTAVEIS = ["ofx", "csv", "xlsx", "txt"];

export interface ArquivoImportacao {
  id: string;
  nome: string;
  sha256: string | null;
  bytes: Uint8Array;
}

/** Lê um documento da empresa respeitando as permissões do usuário (RLS do armazenamento). */
export async function lerDocumentoParaImportacao(ctx: ContextoEmpresa, empresaId: string, documentoId: string): Promise<ArquivoImportacao> {
  const { data: doc } = await ctx.supabase
    .from("documentos")
    .select("id, nome_original, extensao, sha256, storage_path, verificacao_status, excluido_em")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!doc || doc.excluido_em) throw new Error("Documento não encontrado.");
  if (!EXTENSOES_IMPORTAVEIS.includes(doc.extensao ?? "")) throw new Error("Para importar, o arquivo precisa ser OFX, CSV ou XLSX.");
  if (doc.verificacao_status === "bloqueado") throw new Error("Este arquivo foi bloqueado pela verificação de segurança.");
  if (!doc.storage_path) throw new Error("Arquivo indisponível.");
  const { data, error } = await ctx.supabase.storage.from("documentos").download(doc.storage_path);
  if (error || !data) throw new Error("Você não tem acesso ao arquivo ou ele está indisponível.");
  return { id: doc.id, nome: doc.nome_original, sha256: doc.sha256, bytes: new Uint8Array(await data.arrayBuffer()) };
}

/** Mesma chave de deduplicação calculada pelo banco (app.chave_movimento). */
export function chaveMovimento(t: { data: string; valor: string; descricao: string; ocorrencia: number }) {
  const desc = (t.descricao.trim() || "Sem descrição").slice(0, 500);
  return createHash("md5")
    .update(`${t.data}|${dec(t.valor).toFixed(2)}|${normalizarDescricao(desc)}|${t.ocorrencia}`)
    .digest("hex");
}

export type Analise =
  | {
      tipo: "ofx";
      transacoes: TransacaoExtrato[];
      invalidas: LinhaInvalida[];
      conta: string | null;
      banco: string | null;
      cartao: boolean;
      inicio: string | null;
      fim: string | null;
      saldo: { valor: string; data: string | null } | null;
      avisos: string[];
    }
  | { tipo: "planilha"; linhas: string[][]; mapeamento: Mapeamento };

export async function analisarArquivo(arq: ArquivoImportacao): Promise<Analise> {
  const ext = arq.nome.toLowerCase().split(".").pop() ?? "";
  const inicio = new TextDecoder("latin1").decode(arq.bytes.slice(0, 2000));
  if (ext === "ofx" || ehOfx(inicio)) {
    const o = lerOfx(arq.bytes);
    return {
      tipo: "ofx",
      transacoes: o.transacoes,
      invalidas: o.invalidas,
      conta: o.conta,
      banco: o.bancoId,
      cartao: o.tipoConta === "cartao",
      inicio: o.inicio,
      fim: o.fim,
      saldo: o.saldo,
      avisos: o.avisos,
    };
  }
  const linhas = await lerArquivoPlanilha(arq.bytes, arq.nome);
  return { tipo: "planilha", linhas, mapeamento: sugerirMapeamento(linhas) };
}

export interface PreviaExtrato {
  total: number;
  novas: number;
  duplicadas: number;
  invalidas: LinhaInvalida[];
  ignoradas: number;
  creditos: string;
  debitos: string;
  inicio: string | null;
  fim: string | null;
  saldoFinal: { valor: string; data: string | null } | null;
  amostra: (TransacaoExtrato & { duplicada: boolean })[];
}

/** Transações finais (OFX ou planilha mapeada) + prévia de duplicidade para a conta escolhida. */
export async function prepararExtrato(ctx: ContextoEmpresa, analise: Analise, mapeamento: Mapeamento | null, contaId: string | null) {
  let transacoes: TransacaoExtrato[];
  let invalidas: LinhaInvalida[];
  let ignoradas = 0;
  let saldoFinal: { valor: string; data: string | null } | null;
  if (analise.tipo === "ofx") {
    transacoes = analise.transacoes;
    invalidas = analise.invalidas;
    saldoFinal = analise.saldo;
  } else {
    const r = aplicarMapeamento(analise.linhas, mapeamento ?? analise.mapeamento);
    transacoes = r.transacoes;
    invalidas = r.invalidas;
    ignoradas = r.ignoradas.length;
    saldoFinal = r.saldoFinal;
  }
  const chaves = transacoes.map(chaveMovimento);
  const existentes = new Set<string>();
  if (contaId && chaves.length) {
    for (let i = 0; i < chaves.length; i += 300) {
      const { data } = await ctx.supabase.from("movimentos_bancarios").select("chave_dedupe").eq("conta_financeira_id", contaId).in("chave_dedupe", chaves.slice(i, i + 300));
      for (const d of data ?? []) existentes.add(d.chave_dedupe);
    }
  }
  const datas = transacoes.map((t) => t.data).sort();
  const previa: PreviaExtrato = {
    total: transacoes.length,
    novas: chaves.filter((c) => !existentes.has(c)).length,
    duplicadas: chaves.filter((c) => existentes.has(c)).length,
    invalidas: invalidas.slice(0, 100),
    ignoradas,
    creditos: somar(transacoes.filter((t) => dec(t.valor).isPositive()).map((t) => t.valor)).toFixed(2),
    debitos: somar(transacoes.filter((t) => dec(t.valor).isNegative()).map((t) => t.valor)).toFixed(2),
    inicio: datas[0] ?? null,
    fim: datas.at(-1) ?? null,
    saldoFinal,
    amostra: transacoes.slice(0, 200).map((t, i) => ({ ...t, duplicada: existentes.has(chaves[i]) })),
  };
  return { transacoes, invalidas, previa };
}

// --------------------------------------------------------------- lançamentos (contas a pagar/receber)
export interface MapeamentoLancamentos {
  linhaCabecalho: number;
  tipo: number | null; // coluna com "pagar/receber", "despesa/receita", "D/C" ou sinal
  tipoFixo: "receber" | "pagar" | null;
  descricao: number | null;
  data_competencia: number | null;
  data_vencimento: number | null;
  valor: number | null;
  categoria: number | null;
  contraparte_nome: number | null;
  contraparte_documento: number | null;
  numero_documento: number | null;
  data_pagamento: number | null;
  valor_pago: number | null;
}

export interface LinhaLancamentoImportada {
  linha: number;
  tipo: "receber" | "pagar";
  descricao: string;
  data_competencia: string;
  data_vencimento: string;
  valor: string;
  categoria_codigo: string | null;
  contraparte_nome: string | null;
  contraparte_documento: string | null;
  numero_documento: string | null;
  data_pagamento: string | null;
  valor_pago: string | null;
  ocorrencia: number;
}

const ROTULOS_LANC: Record<keyof Omit<MapeamentoLancamentos, "linhaCabecalho" | "tipoFixo">, RegExp> = {
  tipo: /^(tipo|natureza|receita\/despesa|pagar\/receber|d\/c)$/i,
  descricao: /descri|hist[oó]rico|referente/i,
  data_competencia: /compet[eê]ncia|emiss[aã]o|data\s*(do\s*)?documento/i,
  data_vencimento: /venc/i,
  valor: /^valor(\s*(total|original|documento|bruto))?$/i,
  categoria: /categoria|plano|conta\s*cont/i,
  contraparte_nome: /cliente|fornecedor|favorecido|pagador|nome|raz[aã]o/i,
  contraparte_documento: /cpf|cnpj|documento\s*(do\s*)?(cliente|fornecedor)/i,
  numero_documento: /n[º°o]?\.?\s*(do\s*)?(doc|nota|nf|t[ií]tulo|boleto)|^nota|^nf$/i,
  data_pagamento: /pagamento|pago\s*em|baixa|quita/i,
  valor_pago: /valor\s*pago|pago$|recebido/i,
};

export function sugerirMapeamentoLancamentos(linhas: string[][]): MapeamentoLancamentos {
  let linhaCabecalho = -1;
  for (let i = 0; i < Math.min(linhas.length, 30); i++) {
    const acertos = linhas[i].filter((c) => c && Object.values(ROTULOS_LANC).some((p) => p.test(c.trim()))).length;
    if (acertos >= 3) {
      linhaCabecalho = i;
      break;
    }
  }
  const cab = linhaCabecalho >= 0 ? linhas[linhaCabecalho] : [];
  const usados = new Set<number>();
  const achar = (p: RegExp) => {
    const i = cab.findIndex((c, idx) => !usados.has(idx) && p.test((c ?? "").trim()));
    if (i >= 0) usados.add(i);
    return i >= 0 ? i : null;
  };
  const m: MapeamentoLancamentos = {
    linhaCabecalho,
    tipo: null,
    tipoFixo: null,
    descricao: null,
    data_competencia: null,
    data_vencimento: null,
    valor: null,
    categoria: null,
    contraparte_nome: null,
    contraparte_documento: null,
    numero_documento: null,
    data_pagamento: null,
    valor_pago: null,
  };
  // Ordem importa: campos mais específicos primeiro
  m.valor_pago = achar(ROTULOS_LANC.valor_pago);
  m.data_vencimento = achar(ROTULOS_LANC.data_vencimento);
  m.data_pagamento = achar(ROTULOS_LANC.data_pagamento);
  m.data_competencia = achar(ROTULOS_LANC.data_competencia);
  m.valor = achar(ROTULOS_LANC.valor);
  m.contraparte_documento = achar(ROTULOS_LANC.contraparte_documento);
  m.numero_documento = achar(ROTULOS_LANC.numero_documento);
  m.tipo = achar(ROTULOS_LANC.tipo);
  m.categoria = achar(ROTULOS_LANC.categoria);
  m.descricao = achar(ROTULOS_LANC.descricao);
  m.contraparte_nome = achar(ROTULOS_LANC.contraparte_nome);
  return m;
}

function lerTipo(texto: string, valor: string | null): "receber" | "pagar" | null {
  const t = normalizarDescricao(texto);
  if (/^(R|C|RECEBER|RECEITA|ENTRADA|CREDITO|VENDA)/.test(t)) return "receber";
  if (/^(P|D|PAGAR|DESPESA|SAIDA|DEBITO|COMPRA|CUSTO)/.test(t)) return "pagar";
  if (valor) {
    const v = lerValorBR(valor);
    if (v) return v.isNegative() ? "pagar" : "receber";
  }
  return null;
}

export function aplicarMapeamentoLancamentos(linhas: string[][], m: MapeamentoLancamentos) {
  const validas: LinhaLancamentoImportada[] = [];
  const invalidas: LinhaInvalida[] = [];
  const pegar = (l: string[], i: number | null) => (i === null || i < 0 ? "" : (l[i] ?? "").trim());
  for (let i = m.linhaCabecalho + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l || l.every((c) => !c)) continue;
    const numero = i + 1;
    const valorTxt = pegar(l, m.valor);
    const valor = lerValorBR(valorTxt);
    const tipo = m.tipoFixo ?? lerTipo(pegar(l, m.tipo), valorTxt);
    const venc = lerData(pegar(l, m.data_vencimento));
    const comp = lerData(pegar(l, m.data_competencia)) ?? venc;
    const descricao = pegar(l, m.descricao) || pegar(l, m.contraparte_nome);
    if (!valor || valor.isZero()) {
      invalidas.push({ linha: numero, motivo: "Valor ausente ou inválido.", conteudo: l.join(" | ").slice(0, 200) });
      continue;
    }
    if (!tipo) {
      invalidas.push({ linha: numero, motivo: "Não foi possível saber se é a pagar ou a receber.", conteudo: l.join(" | ").slice(0, 200) });
      continue;
    }
    if (!comp) {
      invalidas.push({ linha: numero, motivo: "Data de competência/vencimento ausente ou inválida.", conteudo: l.join(" | ").slice(0, 200) });
      continue;
    }
    const pagoTxt = pegar(l, m.valor_pago);
    validas.push({
      linha: numero,
      tipo,
      descricao: descricao.slice(0, 300) || "Importado",
      data_competencia: comp,
      data_vencimento: venc ?? comp,
      valor: valor.abs().toFixed(2),
      categoria_codigo: pegar(l, m.categoria) || null,
      contraparte_nome: pegar(l, m.contraparte_nome) || null,
      contraparte_documento: pegar(l, m.contraparte_documento).replace(/\D/g, "") || null,
      numero_documento: pegar(l, m.numero_documento) || null,
      data_pagamento: lerData(pegar(l, m.data_pagamento)),
      valor_pago: pagoTxt ? lerValorBR(pagoTxt)?.abs().toFixed(2) ?? null : null,
      ocorrencia: 1,
    });
  }
  // Ocorrências idênticas no mesmo arquivo continuam distintas (chave de importação)
  const cont = new Map<string, number>();
  for (const v of validas) {
    const k = `${v.tipo}|${v.data_competencia}|${v.data_vencimento}|${v.valor}|${normalizarDescricao(v.descricao)}`;
    const n = (cont.get(k) ?? 0) + 1;
    cont.set(k, n);
    v.ocorrencia = n;
  }
  return { validas, invalidas };
}
