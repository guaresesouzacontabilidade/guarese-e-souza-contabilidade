import { aplicarBusca, parametro, termoBusca } from "@/lib/busca";
import { ordemLancamentos, type OrdemLancamentos } from "@/lib/financeiro/ordem-lancamentos";

/**
 * Filtros das contas a pagar e a receber — os mesmos na tela, na planilha e
 * nos totais. A situação de pagamento (em aberto, pago em parte, liquidado)
 * fica separada do prazo (vencido, vence hoje, próximos dias): um título pode
 * estar pago em parte e vencido ao mesmo tempo.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const SITUACOES = ["em_aberto", "aberto", "parcial", "quitado", "cancelado", "renegociado", "nao_canceladas", "todos"] as const;
export const PRAZOS = ["vencido", "hoje", "proximos7", "proximos30", "a_vencer"] as const;
export const APROVACOES = ["pendente", "aprovado", "reprovado"] as const;

export type FiltrosTitulos = {
  tipo: "" | "receber" | "pagar";
  /** Situação de pagamento; vazio = tudo menos cancelados e renegociados */
  situacao: "" | (typeof SITUACOES)[number];
  prazo: "" | (typeof PRAZOS)[number];
  revisao: "" | "sugerido" | "confirmado";
  aprovacao: "" | (typeof APROVACOES)[number];
  por: "vencimento" | "competencia";
  inicio: string;
  fim: string;
  categoria: string;
  contraparte: string;
  centro: string;
  busca: string;
  ordem: OrdemLancamentos;
};

type Sp = Record<string, string | string[] | undefined>;

export function lerFiltros(sp: Sp, tipoFixo?: "receber" | "pagar"): FiltrosTitulos {
  // Endereços antigos: situacao=atrasado vira prazo=vencido (em aberto)
  // Sem escolha no endereço, a lista começa pelo que está em aberto ("Todas" = nao_canceladas)
  let situacao = sp.situacao === undefined ? "em_aberto" : (parametro(sp, "situacao", [...SITUACOES, "atrasado"]) as string);
  let prazo = parametro(sp, "prazo", [...PRAZOS]) as FiltrosTitulos["prazo"];
  if (situacao === "atrasado") {
    situacao = "em_aberto";
    prazo = "vencido";
  }
  // Prazo só faz sentido para o que ainda está em aberto
  if (prazo && !situacao) situacao = "em_aberto";
  const tipo = tipoFixo ?? ((parametro(sp, "tipo", ["receber", "pagar"]) || "") as FiltrosTitulos["tipo"]);
  return {
    tipo,
    situacao: situacao as FiltrosTitulos["situacao"],
    prazo,
    revisao: parametro(sp, "revisao", ["sugerido", "confirmado"]) as FiltrosTitulos["revisao"],
    aprovacao: parametro(sp, "aprovacao", [...APROVACOES]) as FiltrosTitulos["aprovacao"],
    por: (parametro(sp, "por", ["vencimento", "competencia"]) || "vencimento") as FiltrosTitulos["por"],
    inicio: DATA.test(parametro(sp, "inicio")) ? parametro(sp, "inicio") : "",
    fim: DATA.test(parametro(sp, "fim")) ? parametro(sp, "fim") : "",
    categoria: UUID.test(parametro(sp, "categoria")) ? parametro(sp, "categoria") : "",
    contraparte: UUID.test(parametro(sp, "contraparte")) ? parametro(sp, "contraparte") : "",
    centro: UUID.test(parametro(sp, "centro")) ? parametro(sp, "centro") : "",
    busca: termoBusca(sp.busca),
    ordem: ordemLancamentos(parametro(sp, "ordem", ["crescente", "decrescente"]), situacao),
  };
}

export function colunaData(f: FiltrosTitulos) {
  return f.por === "competencia" ? "data_competencia" : "data_vencimento";
}

function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Aplica os filtros numa consulta de "lancamentos" (o banco ainda confere a empresa e a permissão). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aplicarFiltros<Q extends { eq: any; neq: any; in: any; lt: any; lte: any; gt: any; gte: any; or: any; not: any; ilike: any }>(q: Q, f: FiltrosTitulos, hoje: string): Q {
  let r = q;
  if (f.tipo) r = r.eq("tipo", f.tipo);
  switch (f.situacao) {
    case "em_aberto":
      r = r.in("situacao", ["aberto", "parcial"]);
      break;
    case "todos":
      break;
    case "":
    case "nao_canceladas":
      r = r.not("situacao", "in", "(cancelado,renegociado)");
      break;
    default:
      r = r.eq("situacao", f.situacao);
  }
  if (f.prazo === "vencido") r = r.lt("data_vencimento", hoje);
  else if (f.prazo === "hoje") r = r.eq("data_vencimento", hoje);
  else if (f.prazo === "proximos7") r = r.gt("data_vencimento", hoje).lte("data_vencimento", somarDias(hoje, 7));
  else if (f.prazo === "proximos30") r = r.gt("data_vencimento", hoje).lte("data_vencimento", somarDias(hoje, 30));
  else if (f.prazo === "a_vencer") r = r.gt("data_vencimento", hoje);
  if (f.revisao) r = r.eq("status_revisao", f.revisao);
  if (f.aprovacao) r = r.eq("aprovacao_status", f.aprovacao);
  const col = colunaData(f);
  if (f.inicio) r = r.gte(col, f.inicio);
  if (f.fim) r = r.lte(col, f.fim);
  if (f.categoria) r = r.eq("categoria_id", f.categoria);
  if (f.contraparte) r = r.eq("contraparte_id", f.contraparte);
  if (f.centro) r = r.eq("centro_custo_id", f.centro);
  r = aplicarBusca(r, f.busca);
  return r;
}

/** Os filtros como parâmetros de endereço (para a planilha e para voltar à lista). */
export function filtrosNaUrl(f: FiltrosTitulos): Record<string, string> {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v && k !== "ordem") p[k] = String(v);
  p.ordem = f.ordem;
  return p;
}
