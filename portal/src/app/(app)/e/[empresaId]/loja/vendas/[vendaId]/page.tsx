import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2, Printer, ShoppingCart } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, TFoot, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { CancelarVenda } from "@/components/loja/acoes-venda";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { FORMAS_PAGAMENTO, formatarQuantidade, hora, parcelasDoPrazo, type FormaPagamento, un } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, formatarDocumento, formatarTelefone } from "@/lib/formatos";

export const metadata: Metadata = { title: "Venda" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nome = (p: unknown) => (p as { nome?: string } | null)?.nome ?? null;

const SITUACAO_LANC: Record<string, { rotulo: string; variante: "sucesso" | "alerta" | "info" | "perigo" }> = {
  quitado: { rotulo: "Recebido", variante: "sucesso" },
  parcial: { rotulo: "Parcial", variante: "alerta" },
  aberto: { rotulo: "A receber", variante: "info" },
  cancelado: { rotulo: "Cancelado", variante: "perigo" },
};

export default async function PaginaVenda({ params }: PageProps<"/e/[empresaId]/loja/vendas/[vendaId]">) {
  const { empresaId, vendaId } = await params;
  if (!UUID.test(vendaId)) notFound();
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} />;

  const { data: v } = await ctx.supabase
    .from("vendas")
    .select(
      "*, vendedor:perfis!vendas_vendedor_id_fkey(nome), cancelador:perfis!vendas_cancelada_por_fkey(nome), sessao:caixa_sessoes(id, caixa_nome, status), nfe:nfe_emissoes(id, numero, serie, situacao), venda_itens(*), venda_pagamentos(*)",
    )
    .eq("id", vendaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!v) notFound();
  const orcamento = v.tipo === "orcamento";
  const [{ data: parcelas }, { data: origem }, { data: virou }] = await Promise.all([
    ctx.pode("financeiro.ver") && !orcamento
      ? ctx.supabase
          .from("lancamentos")
          .select("id, descricao, data_vencimento, valor_previsto, valor_baixado, situacao, parcela_numero")
          .eq("empresa_id", empresaId)
          .eq("origem", "venda")
          .eq("origem_referencia", vendaId)
          .order("data_vencimento")
      : Promise.resolve({ data: null }),
    v.orcamento_id ? ctx.supabase.from("vendas").select("id, numero").eq("id", v.orcamento_id).maybeSingle() : Promise.resolve({ data: null }),
    orcamento && v.status === "convertido" ? ctx.supabase.from("vendas").select("id, numero").eq("orcamento_id", v.id).eq("tipo", "venda").maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const sessao = v.sessao as { id: string; caixa_nome: string; status: string } | null;
  const nfe = v.nfe as { id: string; numero: number; serie: number; situacao: string } | null;
  const itens = [...(v.venda_itens ?? [])].sort((a, b) => a.ordem - b.ordem);
  const pagamentos = v.venda_pagamentos ?? [];
  const titulo = `${orcamento ? "Orçamento" : "Venda"} nº ${v.numero}`;
  const situacao =
    v.status === "concluida"
      ? { rotulo: "Concluída", variante: "sucesso" as const }
      : v.status === "cancelada"
        ? { rotulo: "Cancelada", variante: "perigo" as const }
        : v.status === "aberto"
          ? { rotulo: "Em aberto", variante: "info" as const }
          : { rotulo: "Virou venda", variante: "neutro" as const };
  const podeCancelar = orcamento ? v.status === "aberto" : v.status === "concluida" && ctx.gerente && sessao?.status === "aberto" && !nfe;
  const nfeAtiva = nfe && !["cancelada", "descartada", "rejeitada", "denegada", "falha"].includes(nfe.situacao);
  const podeNfe = !orcamento && v.status === "concluida" && ctx.pode("nfe.emitir") && !nfeAtiva;

  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {titulo} <Badge variante={situacao.variante}>{situacao.rotulo}</Badge>
          </span>
        }
        descricao={`${formatarData(v.data)} às ${hora(v.created_at)}${nome(v.vendedor) ? ` · ${orcamento ? "feito" : "vendido"} por ${nome(v.vendedor)}` : ""}${sessao ? ` · ${sessao.caixa_nome}` : ""}`}
        voltar={{ href: `/e/${empresaId}/loja/vendas${orcamento ? "?tipo=orcamento" : ""}`, rotulo: "Vendas e orçamentos" }}
        acoes={
          <>
            {orcamento && v.status === "aberto" ? (
              <Button asChild>
                <Link href={`/e/${empresaId}/loja/vender?orcamento=${v.id}`}>
                  <ShoppingCart /> Vender este orçamento
                </Link>
              </Button>
            ) : null}
            {podeNfe ? (
              <Button asChild variante="secundario">
                <Link href={`/e/${empresaId}/notas-produto/nova?venda=${v.id}`}>
                  <FileCheck2 /> Emitir NF-e desta venda
                </Link>
              </Button>
            ) : null}
            <Button asChild variante="contorno">
              <a href={`/impressao/venda/${v.id}`} target="_blank" rel="noopener">
                <Printer /> {orcamento ? "Imprimir orçamento" : "Imprimir comprovante"}
              </a>
            </Button>
            {podeCancelar ? <CancelarVenda empresaId={empresaId} vendaId={v.id} orcamento={orcamento} /> : null}
          </>
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <div className="space-y-4">
        {v.status === "cancelada" ? (
          <Alerta tom="perigo" titulo={`${orcamento ? "Orçamento cancelado" : "Venda cancelada"} em ${formatarDataHora(v.cancelada_em)}${nome(v.cancelador) ? ` por ${nome(v.cancelador)}` : ""}`}>
            Motivo: {v.motivo_cancelamento ?? "—"}
            {!orcamento ? " Os produtos voltaram ao estoque e os recebimentos foram cancelados no Financeiro." : ""}
          </Alerta>
        ) : null}
        {!orcamento && v.status === "concluida" && !podeCancelar && !nfe && ctx.gerente && sessao?.status !== "aberto" ? (
          <Alerta tom="info">
            O caixa desta venda já foi fechado, então ela não pode mais ser cancelada aqui. Para devolução de mercadoria, fale com o escritório.
          </Alerta>
        ) : null}
        {origem ? (
          <p className="text-sm text-muted-foreground">
            Veio do{" "}
            <Link href={`/e/${empresaId}/loja/vendas/${origem.id}`} className="text-primary hover:underline">
              orçamento nº {origem.numero}
            </Link>
            .
          </p>
        ) : null}
        {virou ? (
          <Alerta tom="sucesso">
            Este orçamento virou a{" "}
            <Link href={`/e/${empresaId}/loja/vendas/${virou.id}`} className="underline">
              venda nº {virou.numero}
            </Link>
            .
          </Alerta>
        ) : null}
        {nfe ? (
          <Alerta tom={nfeAtiva ? "sucesso" : "alerta"} titulo={`NF-e nº ${nfe.numero} (série ${nfe.serie})`}>
            Situação: {nfe.situacao}.{" "}
            <Link href={`/e/${empresaId}/notas-produto/${nfe.id}`} className="underline">
              Ver a nota
            </Link>
          </Alerta>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader>
              <CardTitle>Itens</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <tr>
                    <Th>Produto</Th>
                    <Th className="text-right">Quantidade</Th>
                    <Th className="text-right">Preço</Th>
                    <Th className="text-right">Desconto</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </THead>
                <TBody>
                  {itens.map((i) => (
                    <Tr key={i.id}>
                      <Td>
                        {i.descricao}
                        <span className="block text-xs text-muted-foreground">
                          {i.codigo}
                          {i.pecas ? ` · ${formatarQuantidade(i.pecas, 3)} peça(s)${i.comprimento_m ? ` de ${formatarQuantidade(i.comprimento_m, 3)} m` : ""}` : ""}
                        </span>
                      </Td>
                      <Td className="text-right numero">
                        {formatarQuantidade(i.quantidade)} {un(i.unidade)}
                      </Td>
                      <Td className="text-right numero">
                        {formatarMoeda(i.preco_unitario)}
                        {i.preco_tabela != null && dec(i.preco_tabela).gt(dec(i.preco_unitario)) ? (
                          <span className="block text-xs text-muted-foreground line-through">{formatarMoeda(i.preco_tabela)}</span>
                        ) : null}
                      </Td>
                      <Td className="text-right numero">{dec(i.desconto).gt(0) ? formatarMoeda(i.desconto) : "—"}</Td>
                      <Td className="text-right numero font-medium">{formatarMoeda(i.total)}</Td>
                    </Tr>
                  ))}
                </TBody>
                <TFoot>
                  <tr>
                    <Td colSpan={4} className="text-right">
                      Subtotal
                    </Td>
                    <Td className="text-right numero">{formatarMoeda(v.subtotal)}</Td>
                  </tr>
                  {dec(v.desconto).gt(0) ? (
                    <tr>
                      <Td colSpan={4} className="text-right">
                        Desconto
                      </Td>
                      <Td className="text-right numero">− {formatarMoeda(v.desconto)}</Td>
                    </tr>
                  ) : null}
                  {dec(v.frete).gt(0) ? (
                    <tr>
                      <Td colSpan={4} className="text-right">
                        Frete / entrega
                      </Td>
                      <Td className="text-right numero">{formatarMoeda(v.frete)}</Td>
                    </tr>
                  ) : null}
                  <tr>
                    <Td colSpan={4} className="text-right font-semibold">
                      Total
                    </Td>
                    <Td className="text-right numero text-base font-bold">{formatarMoeda(v.total)}</Td>
                  </tr>
                </TFoot>
              </Table>
              {v.observacao || v.entrega ? (
                <div className="mt-4 space-y-1 text-sm">
                  {v.entrega ? (
                    <p>
                      <strong>Entrega:</strong> {v.entrega}
                    </p>
                  ) : null}
                  {v.observacao ? (
                    <p>
                      <strong>Observação:</strong> {v.observacao}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Cliente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium">{v.cliente_nome ?? "Consumidor (sem identificação)"}</p>
                {v.cliente_documento ? <p className="text-muted-foreground">{formatarDocumento(v.cliente_documento)}</p> : null}
                {v.cliente_telefone ? <p className="text-muted-foreground">{formatarTelefone(v.cliente_telefone)}</p> : null}
                {orcamento && v.validade ? <p className="pt-2">Válido até {formatarData(v.validade)}</p> : null}
              </CardContent>
            </Card>

            {!orcamento ? (
              <Card>
                <CardHeader>
                  <CardTitle>Pagamento</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {pagamentos.map((p) => (
                    <div key={p.id}>
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">
                          {FORMAS_PAGAMENTO[p.forma as FormaPagamento]}
                          {p.parcelas > 1 ? ` em ${p.parcelas}x` : ""}
                        </span>
                        <span className="numero">{formatarMoeda(p.valor)}</span>
                      </div>
                      {p.forma === "dinheiro" && p.valor_recebido != null && dec(p.valor_recebido).gt(dec(p.valor)) ? (
                        <p className="text-xs text-muted-foreground">
                          Recebeu {formatarMoeda(p.valor_recebido)} · troco {formatarMoeda(dec(p.valor_recebido).minus(dec(p.valor)))}
                        </p>
                      ) : null}
                      {p.forma === "a_prazo" && p.primeiro_vencimento && !parcelas ? (
                        <ul className="mt-1 text-xs text-muted-foreground">
                          {parcelasDoPrazo(p.valor, p.parcelas, p.primeiro_vencimento, p.intervalo_dias ?? 30).map((x) => (
                            <li key={x.numero}>
                              {x.numero}ª · {formatarData(x.vencimento)} · {formatarMoeda(x.valor)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                  {parcelas?.length ? (
                    <div className="border-t border-border pt-2">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">No Financeiro</p>
                      <ul className="space-y-1">
                        {parcelas.map((l) => {
                          const s = SITUACAO_LANC[l.situacao] ?? SITUACAO_LANC.aberto;
                          return (
                            <li key={l.id} className="flex items-center justify-between gap-2 text-xs">
                              <span>
                                {l.parcela_numero ? `${l.parcela_numero}ª · ` : ""}vence {formatarData(l.data_vencimento)}
                              </span>
                              <span className="flex items-center gap-1.5">
                                <span className="numero">{formatarMoeda(l.valor_previsto)}</span>
                                <Badge variante={s.variante}>{s.rotulo}</Badge>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <Link href={`/e/${empresaId}/financeiro/lancamentos?tipo=receber&situacao=em_aberto`} className="mt-2 inline-block text-xs text-primary hover:underline">
                        Abrir contas a receber
                      </Link>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
