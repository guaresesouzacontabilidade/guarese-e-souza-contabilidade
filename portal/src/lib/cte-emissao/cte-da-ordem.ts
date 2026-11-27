import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import type { PedidoCte } from "./acoes";

type Cliente = ContextoEmpresa["supabase"];

/**
 * Monta o pedido do CT-e a partir da ordem de carregamento: destinatário
 * (comprador), a própria empresa como remetente (quando já cadastrada), quem
 * paga o frete pela modalidade da ordem, a NF-e da ordem, o produto, o peso da
 * balança e o valor da carga. O valor do frete fica para quem emite.
 * Transporte próprio (o vendedor leva a própria mercadoria) não precisa de CT-e.
 */
export async function pedidoCteDaOrdem(
  supabase: Cliente,
  empresaId: string,
  ordemId: string,
): Promise<{ numero: number; pedido: PedidoCte; avisos: string[] } | null> {
  const [{ data: o }, { data: emp }] = await Promise.all([
    supabase
      .from("ordens_carregamento")
      .select(
        "numero, status, destinatario_id, destinatario_nome, destinatario_documento, produto_descricao, quantidade, preco_unitario, peso_previsto_kg, peso_liquido_kg, frete_por_conta, placa, motorista_nome, ticket_balanca, nota:nfe_emissoes(chave, situacao, valor_total)",
      )
      .eq("id", ordemId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase.from("empresas").select("documento").eq("id", empresaId).maybeSingle(),
  ]);
  if (!o || o.status === "cancelada") return null;
  const avisos: string[] = [];

  if (o.frete_por_conta === 3 || o.frete_por_conta === 4) {
    avisos.push("A ordem é de transporte próprio (quem vende leva a própria mercadoria): nesse caso não se emite CT-e. Confira com o escritório antes de emitir.");
  } else if (o.frete_por_conta === 9) {
    avisos.push("A ordem está marcada como sem frete. Confira antes de emitir o CT-e.");
  }

  let destinatarioId = o.destinatario_id ?? "";
  if (!destinatarioId && o.destinatario_documento) {
    const { data: d } = await supabase.from("nfe_destinatarios").select("id").eq("empresa_id", empresaId).eq("documento", o.destinatario_documento).limit(1);
    destinatarioId = d?.[0]?.id ?? "";
  }
  if (!destinatarioId) avisos.push(`O comprador ${o.destinatario_nome} ainda não está cadastrado: cadastre-o no destinatário.`);

  let remetenteId = "";
  if (emp?.documento) {
    const { data: r } = await supabase.from("nfe_destinatarios").select("id").eq("empresa_id", empresaId).eq("documento", emp.documento).limit(1);
    remetenteId = r?.[0]?.id ?? "";
  }
  if (!remetenteId) avisos.push("Escolha o remetente: se a mercadoria é da própria empresa, use o botão “A própria empresa”.");

  const nota = o.nota as { chave: string | null; situacao: string; valor_total: number } | null;
  const nfeValida = nota?.chave && ["autorizada", "cancelando"].includes(nota.situacao);
  if (!nfeValida) avisos.push("A ordem ainda não tem NF-e autorizada: informe a chave da nota da carga.");

  const peso = o.peso_liquido_kg ?? o.peso_previsto_kg;
  if (o.peso_liquido_kg == null) avisos.push("A pesagem ainda não foi registrada: o peso veio da previsão da ordem.");
  const valorCarga = nfeValida ? Number(nota!.valor_total) : o.preco_unitario != null ? Math.round(Number(o.quantidade) * Number(o.preco_unitario) * 100) / 100 : null;
  const tomador = o.frete_por_conta === 0 ? "remetente" : o.frete_por_conta === 1 ? "destinatario" : o.frete_por_conta === 2 ? "outro" : undefined;

  return {
    numero: Number(o.numero),
    avisos,
    pedido: {
      operacao_id: "",
      tomador: tomador as PedidoCte["tomador"],
      remetente_id: remetenteId,
      destinatario_id: destinatarioId,
      valor_prestacao: "",
      componentes: [],
      carga: { produto: o.produto_descricao.slice(0, 60), peso_kg: peso != null ? String(peso) : "", valor: valorCarga != null ? valorCarga.toFixed(2) : "" },
      nfes: nfeValida ? [nota!.chave!] : [],
      observacoes: [
        `Ordem de carregamento nº ${o.numero}`,
        o.placa ? `placa ${o.placa}` : null,
        o.motorista_nome ? `motorista ${o.motorista_nome}` : null,
        o.ticket_balanca ? `ticket da balança ${o.ticket_balanca}` : null,
      ]
        .filter(Boolean)
        .join(" - "),
      origem: { ordem_id: ordemId, ordem_numero: Number(o.numero) },
    },
  };
}
