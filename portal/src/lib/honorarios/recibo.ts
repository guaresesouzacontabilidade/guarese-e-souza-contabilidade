import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mensagemErro } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { gerarArquivoRecibo } from "@/lib/recibos/arquivo";
import { carregarRecibo } from "@/lib/recibos/carregar";
import { publicarReciboNosDocumentos } from "@/lib/recibos/publicar";
import type { Database } from "@/lib/supabase/database.types";
import { numeroCobranca } from "./comum";

/**
 * Depois da baixa: emite o recibo de honorários (numeração do ano), assina
 * com o certificado do escritório (quando cadastrado), liga à cobrança e
 * publica nos documentos da empresa cliente. Uma falha aqui não desfaz o
 * pagamento: volta o aviso para a tela.
 */
export async function reciboDaCobranca(
  supabase: SupabaseClient<Database>,
  cobrancaId: string,
  opcoes: { publicar: boolean; servico?: boolean },
): Promise<{ reciboId: string | null; avisos: string[] }> {
  const avisos: string[] = [];
  const { data: c } = await supabase.from("honorarios_cobrancas").select("*").eq("id", cobrancaId).single();
  if (!c || c.situacao !== "paga" || !c.pago_em || c.valor_pago === null) return { reciboId: null, avisos: ["a cobrança não está paga"] };
  const { data: itens } = await supabase.from("honorarios_cobranca_itens").select("descricao, valor").eq("cobranca_id", cobrancaId).order("ordem");

  const partes = (itens ?? []).map((i) => `${i.descricao} (${formatarMoeda(i.valor)})`);
  const encargos = Number(c.multa) + Number(c.juros);
  if (encargos > 0) partes.push(`multa e juros por atraso (${formatarMoeda(encargos)})`);
  if (Number(c.desconto) > 0) partes.push(`desconto de ${formatarMoeda(c.desconto)}`);
  const descricao = `pagamento da cobrança nº ${numeroCobranca(c)}: ${partes.join("; ")}`.slice(0, 500);

  const { data: emitido, error } = await supabase.rpc("recibo_emitir", {
    p_dados: {
      empresa_id: c.empresa_id,
      pagador_nome: c.empresa_id ? null : c.pagador_nome,
      pagador_documento: c.empresa_id ? null : c.pagador_documento,
      valor: Number(c.valor_pago).toFixed(2),
      referencia: c.tipo === "mensal" ? "Honorários contábeis" : c.descricao.slice(0, 120),
      competencia: c.competencia,
      descricao,
      data_recibo: c.pago_em,
      forma_pagamento: c.forma_pagamento,
    },
  });
  const recibo = emitido?.[0];
  if (error || !recibo) return { reciboId: null, avisos: [`o recibo não foi emitido (${mensagemErro(error)})`] };
  // Pela confirmação do banco (servidor), a ligação também agenda o agradecimento com o recibo
  if (opcoes.servico) await supabase.rpc("honorarios_banco_vincular_recibo", { p_id: cobrancaId, p_recibo_id: recibo.id });
  else await supabase.rpc("honorarios_cobranca_vincular_recibo", { p_id: cobrancaId, p_recibo_id: recibo.id });

  const carregado = await carregarRecibo(supabase, recibo.id);
  const arquivo = carregado ? await gerarArquivoRecibo(supabase, carregado.linha) : null;
  if (arquivo?.erro) avisos.push(`o recibo saiu sem assinatura digital (${arquivo.erro})`);
  // A publicação nos documentos é feita pela equipe (a baixa automática deixa para a tela de recibos)
  if (opcoes.publicar && c.empresa_id && !opcoes.servico) {
    const pub = await publicarReciboNosDocumentos(supabase, recibo.id, arquivo?.pdf);
    if ("erro" in pub) avisos.push(`o recibo não foi publicado ao cliente (${pub.erro})`);
  }
  return { reciboId: recibo.id, avisos };
}
