import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import type { PedidoNfe } from "@/lib/nfe-emissao/acoes";
import { dec } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";
import { notaVale, quantidadePelaPesagem, textoPesagem } from "./carregamentos";

type Cliente = ContextoEmpresa["supabase"];

/**
 * Monta o pedido da NF-e a partir da ordem de carregamento: comprador,
 * produto com a quantidade da pesagem (peso líquido convertido para a unidade
 * do produto), preço combinado, transporte (frete, transportador, placa e
 * RNTRC) e a pesagem nas informações complementares. A inscrição e a operação
 * vêm da ordem ou, sem elas, das escolhidas nas configurações da gestão.
 */
export async function pedidoDaOrdem(
  supabase: Cliente,
  empresaId: string,
  ordemId: string,
): Promise<{ numero: number; pedido: PedidoNfe; avisos: string[] } | null> {
  const [{ data: o }, { data: cfg }] = await Promise.all([
    supabase
      .from("ordens_carregamento")
      .select("*, produto:nfe_produtos(unidade, peso_kg, valor_unitario), nota:nfe_emissoes(situacao)")
      .eq("id", ordemId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase.from("gestao_config").select("nfe_operacao_id, nfe_emitente_id").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (!o || o.status === "cancelada") return null;

  const avisos: string[] = [];
  const nota = o.nota as { situacao: string } | null;
  if (o.status === "faturada" && notaVale(nota?.situacao)) {
    avisos.push("Esta ordem já tem uma NF-e ligada. Confira antes de emitir outra.");
  }

  let destinatarioId = o.destinatario_id ?? "";
  if (!destinatarioId && o.destinatario_documento) {
    const { data: d } = await supabase
      .from("nfe_destinatarios")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("documento", o.destinatario_documento)
      .maybeSingle();
    destinatarioId = d?.id ?? "";
  }
  if (!destinatarioId) {
    avisos.push(
      `O comprador ${o.destinatario_nome}${o.destinatario_documento ? ` (${formatarDocumento(o.destinatario_documento)})` : ""} ainda não está cadastrado como destinatário da NF-e: cadastre-o com o endereço no campo do cliente abaixo.`,
    );
  }

  const produto = o.produto as {
    unidade: string;
    peso_kg: number | null;
    valor_unitario: number | null;
  } | null;
  let quantidade = dec(o.quantidade);
  if (o.peso_liquido_kg != null) {
    const daPesagem = quantidadePelaPesagem(o.peso_liquido_kg, o.unidade, produto?.peso_kg ?? null);
    if (daPesagem) quantidade = daPesagem;
    else
      avisos.push(`Não foi possível converter o peso da balança para a unidade ${o.unidade}: a nota veio com a quantidade prevista. Confira antes de enviar.`);
  } else {
    avisos.push("A pesagem ainda não foi registrada: a nota veio com a quantidade prevista na ordem.");
  }
  const preco = o.preco_unitario ?? produto?.valor_unitario ?? null;
  if (preco == null) avisos.push("A ordem não tem preço: informe o valor unitário do produto.");

  return {
    numero: Number(o.numero),
    avisos,
    pedido: {
      emitente_id: o.emitente_id ?? cfg?.nfe_emitente_id ?? "",
      operacao_id: o.operacao_id ?? cfg?.nfe_operacao_id ?? "",
      destinatario_id: destinatarioId,
      itens: [
        {
          produto_id: o.produto_id,
          quantidade: quantidade.toFixed(4),
          valor_unitario: preco == null ? "" : dec(preco).toString(),
        },
      ],
      transporte: {
        modalidade: o.frete_por_conta,
        transportador_id: o.transportador_id ?? "",
        placa: o.placa ?? undefined,
        placa_uf: o.placa_uf ?? undefined,
        rntc: o.rntrc ?? undefined,
      },
      pagamento: { forma: "18", a_prazo: false, parcelas: [] },
      informacoes: textoPesagem(o),
      pedido_compra: o.contrato ? o.contrato.slice(0, 15) : undefined,
    },
  };
}
