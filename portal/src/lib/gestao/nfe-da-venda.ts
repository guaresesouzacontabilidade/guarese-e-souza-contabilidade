import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import type { PedidoNfe } from "@/lib/nfe-emissao/acoes";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";
import { FORMAS_PAGAMENTO, parcelasDoPrazo, type FormaPagamento } from "./rotulos";

type Cliente = ContextoEmpresa["supabase"];

/** Forma de pagamento da venda → código da NF-e (tPag). */
const TPAG: Record<FormaPagamento, string> = {
  dinheiro: "01",
  pix: "17",
  cartao_debito: "04",
  cartao_credito: "03",
  a_prazo: "05",
  outro: "99",
};

/**
 * Monta o pedido da NF-e a partir de uma venda concluída da loja: itens
 * (quantidade e preço da venda), frete, descontos (da venda e dos itens),
 * forma de pagamento (a de maior valor; as demais vão nas informações) e o
 * cliente, quando ele já estiver cadastrado como destinatário da NF-e.
 */
export async function pedidoDaVenda(supabase: Cliente, empresaId: string, vendaId: string): Promise<{ numero: number; pedido: PedidoNfe; avisos: string[] } | null> {
  const { data: v } = await supabase
    .from("vendas")
    .select("id, numero, tipo, status, cliente_nome, cliente_documento, desconto, frete, nfe_emissao_id, venda_itens(ordem, produto_id, quantidade, preco_unitario, desconto), venda_pagamentos(forma, valor, parcelas, primeiro_vencimento, intervalo_dias)")
    .eq("id", vendaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!v || v.tipo !== "venda" || v.status !== "concluida") return null;

  const avisos: string[] = [];
  if (v.nfe_emissao_id) avisos.push("Esta venda já tem uma NF-e ligada. Confira antes de emitir outra.");

  let destinatarioId = "";
  if (v.cliente_documento) {
    const { data: d } = await supabase.from("nfe_destinatarios").select("id").eq("empresa_id", empresaId).eq("documento", v.cliente_documento).maybeSingle();
    destinatarioId = d?.id ?? "";
  }
  if (!destinatarioId) {
    avisos.push(
      v.cliente_documento
        ? `O cliente ${v.cliente_nome ?? ""} (${formatarDocumento(v.cliente_documento)}) ainda não está cadastrado como destinatário da NF-e: cadastre-o com o endereço no campo do cliente abaixo.`
        : "A venda não tem CPF/CNPJ do cliente. Escolha ou cadastre o destinatário abaixo.",
    );
  }

  const itens = [...(v.venda_itens ?? [])].sort((a, b) => a.ordem - b.ordem);
  const descontoItens = itens.reduce((s, i) => s.plus(dec(i.desconto)), dec(0));
  const desconto = dec(v.desconto).plus(descontoItens);

  const pagamentos = [...(v.venda_pagamentos ?? [])].sort((a, b) => dec(b.valor).comparedTo(dec(a.valor)));
  const principal = pagamentos[0];
  const forma = (principal?.forma ?? "outro") as FormaPagamento;
  const aPrazo = forma === "a_prazo" && principal?.primeiro_vencimento;
  const informacoes = [`Venda nº ${v.numero}.`];
  if (pagamentos.length > 1) {
    informacoes.push(`Pagamento: ${pagamentos.map((p) => `${FORMAS_PAGAMENTO[p.forma as FormaPagamento]} ${formatarMoeda(p.valor)}`).join(" + ")}.`);
  }

  return {
    numero: Number(v.numero),
    avisos,
    pedido: {
      emitente_id: "",
      operacao_id: "",
      destinatario_id: destinatarioId,
      itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: dec(i.quantidade).toFixed(4), valor_unitario: dec(i.preco_unitario).toString() })),
      frete: dec(v.frete).gt(0) ? dec(v.frete).toFixed(2) : "",
      desconto: desconto.gt(0) ? desconto.toFixed(2) : "",
      transporte: { modalidade: dec(v.frete).gt(0) ? 0 : 9 },
      pagamento: {
        forma: TPAG[forma],
        descricao: forma === "outro" ? "Outros" : undefined,
        a_prazo: Boolean(aPrazo),
        parcelas: aPrazo
          ? parcelasDoPrazo(principal.valor, principal.parcelas, principal.primeiro_vencimento!, principal.intervalo_dias ?? 30).map((p) => ({ vencimento: p.vencimento, valor: p.valor.toFixed(2) }))
          : [],
      },
      informacoes: informacoes.join(" "),
    },
  };
}
