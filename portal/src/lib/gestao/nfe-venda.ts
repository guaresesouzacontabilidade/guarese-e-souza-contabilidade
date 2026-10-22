import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { emitirNota } from "@/lib/nfe-emissao/acoes";
import { pedidoDaVenda } from "./nfe-da-venda";
import type { NfeNaVenda } from "./rotulos";

export type { NfeNaVenda };

type Cliente = ContextoEmpresa["supabase"];

/** Lê a configuração da NF-e da empresa e as escolhas da loja (o banco aplica as regras de acesso). */
export async function nfeNaVenda(supabase: Cliente, empresaId: string, podeEmitir: boolean): Promise<NfeNaVenda> {
  const vazio: NfeNaVenda = { configurada: false, disponivel: false, motivo: null, ambiente: null, marcadaPadrao: false, emitenteId: null, operacaoId: null, documentosComEndereco: [] };
  if (!podeEmitir) return vazio;
  const [{ data: cfg }, { data: loja }, { data: ops }, { data: emits }, { data: dests }] = await Promise.all([
    supabase.from("nfe_config").select("ativa, ambiente").eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("gestao_config").select("nfe_operacao_id, nfe_emitente_id, nfe_marcada_padrao").eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("nfe_operacoes").select("id").eq("empresa_id", empresaId).eq("ativa", true),
    supabase.from("nfe_emitentes").select("id").eq("empresa_id", empresaId).eq("ativo", true),
    supabase.from("nfe_destinatarios").select("documento").eq("empresa_id", empresaId).not("documento", "is", null).limit(10000),
  ]);
  if (!cfg) return vazio;
  const operacaoId = loja?.nfe_operacao_id ?? (ops?.length === 1 ? ops[0].id : null);
  const emitenteId = loja?.nfe_emitente_id ?? (emits?.length === 1 ? emits[0].id : null);
  const motivo = !cfg.ativa
    ? "A emissão de NF-e desta empresa está desligada (falta o certificado digital ou a autorização do escritório)."
    : !operacaoId
      ? "Escolha a operação da NF-e nas configurações da loja."
      : !emitenteId
        ? "Escolha a inscrição que emite a NF-e nas configurações da loja."
        : null;
  return {
    configurada: true,
    disponivel: !motivo,
    motivo,
    ambiente: cfg.ambiente as NfeNaVenda["ambiente"],
    marcadaPadrao: Boolean(loja?.nfe_marcada_padrao),
    emitenteId,
    operacaoId,
    documentosComEndereco: (dests ?? []).map((d) => d.documento!).filter(Boolean),
  };
}

/**
 * Emite a NF-e de uma venda concluída: monta a nota com os itens, o frete, o
 * desconto e o pagamento da venda e envia à SEFAZ pela emissão de NF-e da
 * empresa. A venda já está gravada: se a nota não sair, a venda continua valendo.
 */
export async function emitirNfeDaVenda(supabase: Cliente, empresaId: string, vendaId: string, nfe: NfeNaVenda): Promise<{ ok: boolean; id?: string; mensagem: string }> {
  if (!nfe.disponivel || !nfe.emitenteId || !nfe.operacaoId) return { ok: false, mensagem: nfe.motivo ?? "A emissão de NF-e não está disponível." };
  const d = await pedidoDaVenda(supabase, empresaId, vendaId);
  if (!d) return { ok: false, mensagem: "Venda não encontrada para a nota." };
  if (!d.pedido.destinatario_id) {
    return { ok: false, mensagem: "O cliente não tem o endereço cadastrado para a nota. Complete o cadastro e emita pela venda." };
  }
  const r = await emitirNota(empresaId, { ...d.pedido, emitente_id: nfe.emitenteId, operacao_id: nfe.operacaoId }, null, vendaId);
  if (!r.ok || !r.dados?.id) {
    return { ok: false, mensagem: r.dados?.repetida ? "Uma nota igual (mesmo cliente e valor) saiu há poucos minutos. Confira antes de emitir pela venda." : (r.mensagem ?? "A nota não pôde ser enviada.") };
  }
  return { ok: true, id: r.dados.id, mensagem: r.mensagem ?? "NF-e enviada à SEFAZ." };
}
