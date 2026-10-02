/** Regras de prazo: tipos e descrição em linguagem simples. */

import { nomeMes } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { LUCRO_REAL_APURACAO } from "./rotulos";

export interface RegraPrazo {
  tipo: "dia_fixo" | "dia_util" | "ultimo_dia_util";
  dia?: number;
  meses_apos: number;
  ajuste?: "antecipar" | "postergar" | "manter";
  calendario?: "dia_util" | "expediente_bancario";
  feriados?: "nacional" | "estadual" | "municipal";
}

export interface RegraObrigacao {
  id: string;
  obrigacao_id: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  regimes: string[];
  ufs: string[] | null;
  municipios: string[] | null;
  empresa_id: string | null;
  exige_empregados: boolean;
  exige_folha: boolean;
  exige_icms: boolean;
  exige_iss: boolean;
  lucro_real_apuracao: string | null;
  servico: string | null;
  prazo_entrega: RegraPrazo | null;
  prazo_pagamento: RegraPrazo | null;
  prazo_apuracao: RegraPrazo | null;
  prazo_interno_dias_uteis: number;
  fonte_titulo: string;
  fonte_url: string | null;
  fonte_consultada_em: string;
  observacao: string | null;
  status: string;
}

function mesReferencia(meses: number, periodicidade: string) {
  if (periodicidade === "anual") {
    if (meses === 0) return "de dezembro do ano-base";
    if (meses <= 12) return `de ${nomeMes(meses)} do ano seguinte`;
    return `${meses} meses após dezembro do ano-base`;
  }
  const base = periodicidade === "trimestral" ? " ao fim do trimestre" : "";
  if (meses === 0) return periodicidade === "trimestral" ? "do último mês do trimestre" : "do próprio mês";
  if (meses === 1) return `do mês seguinte${base}`;
  return `do ${meses}º mês seguinte${base}`;
}

/** Ex.: "Dia 20 do mês seguinte; sem expediente bancário, no dia útil seguinte". */
export function descreverPrazo(p: RegraPrazo | null | undefined, periodicidade = "mensal"): string {
  if (!p) return "—";
  const ref = mesReferencia(p.meses_apos, periodicidade);
  const bancario = p.calendario === "expediente_bancario";
  const util = bancario ? "dia com expediente bancário" : "dia útil";
  let texto: string;
  if (p.tipo === "ultimo_dia_util") texto = `Último ${util} ${ref}`;
  else if (p.tipo === "dia_util") texto = `${p.dia}º ${util} ${ref}`;
  else {
    texto = `Dia ${p.dia} ${ref}`;
    if (p.ajuste === "postergar") texto += `; se não for ${util}, passa para o seguinte`;
    else if (p.ajuste === "antecipar") texto += `; se não for ${util}, antecipa para o anterior`;
    else texto += "; vale a data mesmo em fim de semana ou feriado";
  }
  return texto;
}

export function descreverFeriados(p: RegraPrazo | null | undefined): string | null {
  if (!p) return null;
  const f = p.feriados ?? "municipal";
  return f === "nacional" ? "Feriados nacionais" : f === "estadual" ? "Feriados nacionais e estaduais" : "Feriados nacionais, estaduais e municipais";
}

/** Aplicabilidade em uma linha (regimes e exigências do cadastro). */
export function descreverAplicabilidade(r: Pick<RegraObrigacao, "regimes" | "exige_empregados" | "exige_folha" | "exige_icms" | "exige_iss" | "lucro_real_apuracao" | "servico">) {
  const partes = [r.regimes.map((x) => REGIMES[x] ?? x).join(", ")];
  if (r.lucro_real_apuracao) partes.push(`Lucro Real ${LUCRO_REAL_APURACAO[r.lucro_real_apuracao]?.toLowerCase() ?? r.lucro_real_apuracao}`);
  if (r.exige_empregados) partes.push("com empregados");
  if (r.exige_folha) partes.push("com folha (empregados ou pró-labore)");
  if (r.exige_icms) partes.push("contribuinte do ICMS");
  if (r.exige_iss) partes.push("contribuinte do ISS");
  if (r.servico) partes.push(`serviço ${r.servico === "contabil" ? "contábil" : r.servico} contratado`);
  return partes.join(" · ");
}

/** Situação de prazo de uma tarefa aberta em relação a hoje. */
export function urgencia(prazo: string | null, hoje: string): { rotulo: string; tom: "perigo" | "alerta" | "info" | "neutro"; dias: number | null } {
  if (!prazo) return { rotulo: "Sem prazo", tom: "neutro", dias: null };
  const dias = Math.round((new Date(`${prazo}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime()) / 86400000);
  if (dias < 0) return { rotulo: `Atrasada há ${-dias} dia${dias === -1 ? "" : "s"}`, tom: "perigo", dias };
  if (dias === 0) return { rotulo: "Vence hoje", tom: "perigo", dias };
  if (dias <= 3) return { rotulo: `Vence em ${dias} dia${dias === 1 ? "" : "s"}`, tom: "alerta", dias };
  if (dias <= 7) return { rotulo: `Vence em ${dias} dias`, tom: "info", dias };
  return { rotulo: `Em ${dias} dias`, tom: "neutro", dias };
}

/** Estado de um prazo no formulário (tudo em texto). */
export interface EstadoPrazo {
  tipo: "" | RegraPrazo["tipo"];
  dia: string;
  meses: string;
  ajuste: string;
  calendario: string;
  feriados: string;
}

export const PRAZO_VAZIO: EstadoPrazo = { tipo: "", dia: "", meses: "1", ajuste: "postergar", calendario: "dia_util", feriados: "nacional" };

export function estadoDoPrazo(p: RegraPrazo | null | undefined): EstadoPrazo {
  if (!p) return { ...PRAZO_VAZIO };
  return {
    tipo: p.tipo,
    dia: p.dia != null ? String(p.dia) : "",
    meses: String(p.meses_apos),
    ajuste: p.ajuste ?? "postergar",
    calendario: p.calendario ?? "dia_util",
    feriados: p.feriados ?? "municipal",
  };
}

/** Converte o estado do formulário na regra gravada no banco (null = sem prazo). */
export function montarPrazo(e: EstadoPrazo): RegraPrazo | null {
  if (!e.tipo) return null;
  const p: RegraPrazo = {
    tipo: e.tipo,
    meses_apos: Number(e.meses || 0),
    calendario: e.calendario === "expediente_bancario" ? "expediente_bancario" : "dia_util",
    feriados: e.feriados === "estadual" || e.feriados === "municipal" ? e.feriados : "nacional",
  };
  if (e.tipo !== "ultimo_dia_util") p.dia = Number(e.dia || 0);
  if (e.tipo === "dia_fixo") p.ajuste = e.ajuste === "antecipar" || e.ajuste === "manter" ? e.ajuste : "postergar";
  return p;
}

/** Problemas de um prazo em edição (mensagem em português) ou null. */
export function problemaPrazo(e: EstadoPrazo): string | null {
  if (!e.tipo) return null;
  const meses = Number(e.meses);
  if (!Number.isInteger(meses) || meses < 0 || meses > 24) return "Informe em quantos meses após a competência (0 a 24).";
  if (e.tipo !== "ultimo_dia_util") {
    const dia = Number(e.dia);
    const max = e.tipo === "dia_util" ? 23 : 31;
    if (!Number.isInteger(dia) || dia < 1 || dia > max) return e.tipo === "dia_util" ? "Informe qual dia útil (1 a 23)." : "Informe o dia do mês (1 a 31).";
  }
  return null;
}
