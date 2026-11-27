import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeISO } from "@/lib/competencia";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { encargos } from "./comum";
import type { CobrancaPdf } from "./pdf";
import { montarPixCopiaECola } from "./pix";

export type LinhaCobranca = Database["public"]["Tables"]["honorarios_cobrancas"]["Row"];
export type ItemCobranca = Database["public"]["Tables"]["honorarios_cobranca_itens"]["Row"];

/** Dados do escritório para o PDF e as mensagens (cadastro público do escritório). */
export async function dadosEscritorio(): Promise<CobrancaPdf["escritorio"]> {
  const { data: e } = await criarClienteAdmin()
    .from("escritorio")
    .select("nome_fantasia, razao_social, cnpj, logradouro, numero, bairro, cidade, uf, telefone, email")
    .eq("id", 1)
    .single();
  const endereco = e
    ? [[e.logradouro, e.numero ? `nº ${e.numero}` : null].filter(Boolean).join(", "), e.bairro, [e.cidade, e.uf].filter(Boolean).join("/")]
        .filter((p) => p && String(p).trim())
        .join(" — ")
    : null;
  return {
    nome: e?.nome_fantasia ?? "Escritório de contabilidade",
    razao_social: e?.razao_social ?? "",
    cnpj: e?.cnpj ?? "",
    endereco: endereco || null,
    telefone: e?.telefone ?? null,
    email: e?.email ?? null,
  };
}

/**
 * Quanto pagar hoje: o valor da cobrança ou, depois do vencimento (com
 * encargos ligados), o valor com multa e juros até hoje.
 */
export function valorParaPagar(c: Pick<LinhaCobranca, "valor" | "vencimento" | "cobrar_encargos" | "multa_percentual" | "juros_mes_percentual">, hoje = hojeISO()) {
  if (!c.cobrar_encargos || hoje <= c.vencimento) return { valor: String(Number(c.valor).toFixed(2)), atualizado: null };
  const e = encargos(c.valor, c.vencimento, hoje, c.multa_percentual, c.juros_mes_percentual);
  return {
    valor: e.total.toFixed(2),
    atualizado: { valor: e.total.toFixed(2), data: hoje, multa: e.multa.toFixed(2), juros: e.juros.toFixed(2), dias: e.dias },
  };
}

/** Pix copia e cola da cobrança aberta (null sem chave configurada na aprovação). */
export function pixDaCobranca(c: Pick<LinhaCobranca, "pix_chave" | "pix_nome" | "pix_cidade" | "pix_txid" | "situacao" | "banco_pix">, valor: string) {
  if (c.situacao !== "aberta") return null;
  // Cobrança criada no banco: Pix dinâmico (o banco calcula multa e juros na hora e confirma o pagamento)
  if (c.banco_pix) return c.banco_pix;
  if (!c.pix_chave) return null;
  return montarPixCopiaECola({ chave: c.pix_chave, nome: c.pix_nome ?? "", cidade: c.pix_cidade ?? "", valor, txid: c.pix_txid });
}

export async function itensDaCobranca(supabase: SupabaseClient<Database>, id: string) {
  const { data } = await supabase.from("honorarios_cobranca_itens").select("*").eq("cobranca_id", id).order("ordem");
  return data ?? [];
}

export async function montarCobrancaPdf(c: LinhaCobranca, itens: ItemCobranca[], hoje = hojeISO()): Promise<CobrancaPdf> {
  const pagar = valorParaPagar(c, hoje);
  return {
    ano: c.ano,
    numero: c.numero,
    descricao: c.descricao,
    pagador: { nome: c.pagador_nome, documento: c.pagador_documento },
    itens: itens.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario), valor: Number(i.valor) })),
    valor: Number(c.valor),
    vencimento: c.vencimento,
    situacao: c.situacao,
    pagoEm: c.pago_em,
    valorPago: c.valor_pago === null ? null : Number(c.valor_pago),
    valorAtualizado: pagar.atualizado,
    pix: pixDaCobranca(c, pagar.valor),
    encargos: c.cobrar_encargos ? { multa: String(c.multa_percentual).replace(".", ","), juros: String(c.juros_mes_percentual).replace(".", ",") } : null,
    escritorio: await dadosEscritorio(),
  };
}
