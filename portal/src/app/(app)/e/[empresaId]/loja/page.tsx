import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Banknote, CreditCard, FileText, QrCode, Receipt, ShoppingCart, Wallet } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { hojeLocal, obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarProdutosLoja, estoqueBaixo } from "@/lib/gestao/dados";
import { formatarQuantidade, hora, un } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Loja" };

export default async function PainelLoja({ params }: PageProps<"/e/[empresaId]/loja">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} />;
  const hoje = hojeLocal();
  const inicioMes = hoje.slice(0, 8) + "01";
  const [{ data: vendasMes }, { data: abertos }, produtos, { data: orcamentos }, receber] = await Promise.all([
    ctx.supabase
      .from("vendas")
      .select("id, numero, data, created_at, cliente_nome, total, venda_pagamentos(forma, valor)")
      .eq("empresa_id", empresaId)
      .eq("tipo", "venda")
      .eq("status", "concluida")
      .gte("data", inicioMes)
      .order("created_at", { ascending: false })
      .limit(20000),
    ctx.supabase
      .from("caixa_sessoes")
      .select("id, caixa_nome, aberto_em, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("status", "aberto"),
    carregarProdutosLoja(ctx.supabase, empresaId, { ativos: true }),
    ctx.supabase
      .from("vendas")
      .select("id, numero, cliente_nome, total, validade")
      .eq("empresa_id", empresaId)
      .eq("tipo", "orcamento")
      .eq("status", "aberto")
      .order("validade")
      .limit(8),
    ctx.pode("financeiro.ver")
      ? ctx.supabase
          .from("lancamentos")
          .select("id, descricao, data_vencimento, valor_previsto, valor_baixado")
          .eq("empresa_id", empresaId)
          .eq("tipo", "receber")
          .eq("origem", "venda")
          .in("situacao", ["aberto", "parcial"])
          .order("data_vencimento")
          .limit(2000)
      : Promise.resolve(null),
  ]);

  const doDia = (vendasMes ?? []).filter((v) => v.data === hoje);
  const somaForma = (lista: typeof doDia, formas: string[]) =>
    lista.flatMap((v) => v.venda_pagamentos).filter((p) => formas.includes(p.forma)).reduce((s, p) => s.plus(dec(p.valor)), dec(0));
  const totalDia = doDia.reduce((s, v) => s.plus(dec(v.total)), dec(0));
  const totalMes = (vendasMes ?? []).reduce((s, v) => s.plus(dec(v.total)), dec(0));
  const baixos = produtos.filter(estoqueBaixo);
  const abertosReceber = receber?.data ?? [];
  const saldo = (l: { valor_previsto: number; valor_baixado: number }) => dec(l.valor_previsto).minus(dec(l.valor_baixado));
  const vencidos = abertosReceber.filter((l) => l.data_vencimento < hoje);
  const totalReceber = abertosReceber.reduce((s, l) => s.plus(saldo(l)), dec(0));
  const totalVencido = vencidos.reduce((s, l) => s.plus(saldo(l)), dec(0));
  const base = `/e/${empresaId}/loja`;

  return (
    <>
      <CabecalhoPagina
        titulo="Loja"
        descricao={`Hoje, ${formatarData(hoje)}. Tudo o que é vendido aqui já entra no Financeiro e na contabilidade.`}
        acoes={
          <Button asChild tamanho="lg">
            <Link href={`${base}/vender`}>
              <ShoppingCart /> Vender
            </Link>
          </Button>
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Indicador rotulo="Vendido hoje" valor={formatarMoeda(totalDia)} detalhe={`${doDia.length} venda(s)`} icone={Receipt} href={`${base}/caixa`} />
          <Indicador rotulo="Dinheiro hoje" valor={formatarMoeda(somaForma(doDia, ["dinheiro"]))} icone={Banknote} tom="sucesso" />
          <Indicador rotulo="PIX hoje" valor={formatarMoeda(somaForma(doDia, ["pix"]))} icone={QrCode} tom="info" />
          <Indicador rotulo="Cartão hoje" valor={formatarMoeda(somaForma(doDia, ["cartao_debito", "cartao_credito"]))} icone={CreditCard} />
          <Indicador rotulo="A prazo hoje" valor={formatarMoeda(somaForma(doDia, ["a_prazo"]))} icone={Wallet} tom="alerta" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador rotulo="Vendido no mês" valor={formatarMoeda(totalMes)} detalhe={`${(vendasMes ?? []).length} venda(s)`} href={`${base}/vendas`} />
          {receber ? (
            <>
              <Indicador rotulo="A receber (vendas a prazo)" valor={formatarMoeda(totalReceber)} detalhe={`${abertosReceber.length} parcela(s) em aberto`} tom="info" href={`/e/${empresaId}/financeiro/lancamentos?tipo=receber&situacao=em_aberto`} />
              <Indicador rotulo="Parcelas vencidas" valor={formatarMoeda(totalVencido)} detalhe={`${vencidos.length} parcela(s)`} tom={vencidos.length ? "perigo" : "neutro"} href={`/e/${empresaId}/financeiro/lancamentos?tipo=receber&situacao=atrasado`} />
            </>
          ) : null}
          <Indicador rotulo="Estoque baixo" valor={baixos.length} detalhe="produtos abaixo do mínimo" icone={AlertTriangle} tom={baixos.length ? "alerta" : "neutro"} href={`${base}/produtos?filtro=baixo`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Caixas abertos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(abertos ?? []).length ? (
                (abertos ?? []).map((s) => (
                  <Link key={s.id} href={`${base}/caixa/${s.id}`} className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted/50">
                    <span>
                      <span className="font-medium">{s.caixa_nome}</span>
                      <span className="block text-xs text-muted-foreground">
                        {(s.operador as { nome?: string } | null)?.nome ?? "—"} · desde {hora(s.aberto_em)}
                      </span>
                    </span>
                    <Badge variante="sucesso">Aberto</Badge>
                  </Link>
                ))
              ) : (
                <p className="text-muted-foreground">Nenhum caixa aberto agora.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Últimas vendas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {(vendasMes ?? []).slice(0, 8).map((v) => (
                <Link key={v.id} href={`${base}/vendas/${v.id}`} className="flex justify-between gap-2 hover:underline">
                  <span className="truncate">
                    nº {v.numero} · {v.cliente_nome ?? "Consumidor"}
                    <span className="text-xs text-muted-foreground"> · {v.data === hoje ? hora(v.created_at) : formatarData(v.data)}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap numero font-medium">{formatarMoeda(v.total)}</span>
                </Link>
              ))}
              {!(vendasMes ?? []).length ? <p className="text-muted-foreground">Nenhuma venda neste mês.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Atenção</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {baixos.slice(0, 6).map((p) => (
                <Link key={p.id} href={`${base}/produtos/${p.id}`} className="flex justify-between gap-2 hover:underline">
                  <span className="truncate">{p.descricao}</span>
                  <span className={`shrink-0 whitespace-nowrap numero ${dec(p.estoque_atual).lte(0) ? "text-perigo" : "text-alerta"}`}>
                    {formatarQuantidade(p.estoque_atual)} {un(p.unidade)}
                  </span>
                </Link>
              ))}
              {(orcamentos ?? []).length ? (
                <div className="border-t border-border pt-2">
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <FileText className="size-3.5" /> Orçamentos em aberto
                  </p>
                  {(orcamentos ?? []).map((o) => (
                    <Link key={o.id} href={`${base}/vendas/${o.id}`} className="flex justify-between gap-2 hover:underline">
                      <span className="truncate">
                        nº {o.numero} · {o.cliente_nome ?? "—"}
                        {o.validade && o.validade < hoje ? <span className="text-xs text-perigo"> · vencido</span> : null}
                      </span>
                      <span className="shrink-0 whitespace-nowrap numero">{formatarMoeda(o.total)}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
              {!baixos.length && !(orcamentos ?? []).length ? <p className="text-muted-foreground">Tudo em dia.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
