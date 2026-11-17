import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { EmitenteRecibo, ReciboPdf } from "./pdf";

export type LinhaRecibo = Database["public"]["Tables"]["recibos_honorarios"]["Row"];

const textoOuNulo = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Dados do PDF a partir do recibo guardado (o escritório e o contador são os do dia da emissão). */
export function reciboParaPdf(r: LinhaRecibo): ReciboPdf {
  const e = (r.emitente ?? {}) as Record<string, unknown>;
  const emitente: EmitenteRecibo = {
    razao_social: textoOuNulo(e.razao_social) ?? "Escritório",
    nome_fantasia: textoOuNulo(e.nome_fantasia),
    cnpj: textoOuNulo(e.cnpj) ?? "",
    endereco: textoOuNulo(e.endereco),
    cep: textoOuNulo(e.cep),
    telefone: textoOuNulo(e.telefone),
    email: textoOuNulo(e.email),
    contador_nome: textoOuNulo(e.contador_nome),
    contador_crc: textoOuNulo(e.contador_crc),
    cidade: textoOuNulo(e.cidade),
    uf: textoOuNulo(e.uf),
  };
  return {
    ano: r.ano,
    numero: r.numero,
    valor: r.valor,
    pagador: { nome: r.pagador_nome, documento: r.pagador_documento },
    referencia: r.referencia,
    competencia: r.competencia,
    descricao: r.descricao,
    data: r.data_recibo,
    cidade: r.cidade,
    uf: r.uf,
    formaPagamento: r.forma_pagamento,
    nfseNumero: r.nfse_numero,
    observacao: r.observacao,
    emitente,
    // Logo oficial do escritório em vetor, como no modelo de recibo
    logo: null,
    situacao: r.situacao === "cancelado" ? "cancelado" : "emitido",
    motivoCancelamento: r.motivo_cancelamento,
  };
}

/** Recibo e dados do PDF (null quando não existe ou a pessoa não é da equipe). */
export async function carregarRecibo(supabase: SupabaseClient<Database>, id: string): Promise<{ linha: LinhaRecibo; pdf: ReciboPdf } | null> {
  const { data } = await supabase.from("recibos_honorarios").select("*").eq("id", id).maybeSingle();
  return data ? { linha: data, pdf: reciboParaPdf(data) } : null;
}
