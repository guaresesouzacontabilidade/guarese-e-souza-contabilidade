import type { Metadata } from "next";
import Link from "next/link";
import { Globe, ShoppingBag } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja, NavegacaoSite } from "@/components/loja/navegacao-loja";
import { hojeLocal, obterContextoLoja } from "@/lib/gestao/contexto";
import { hora } from "@/lib/gestao/rotulos";
import { carregarSite } from "@/lib/vitrine/dados";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Site da loja" };

const SITUACOES: Record<string, { rotulo: string; variante: "sucesso" | "perigo" | "info" | "neutro" }> = {
  aberto: { rotulo: "Novo", variante: "info" },
  convertido: { rotulo: "Virou venda", variante: "sucesso" },
  cancelada: { rotulo: "Cancelado", variante: "perigo" },
};

const whats = (tel: string | null) => (tel ? `https://wa.me/55${tel}` : null);

export default async function PaginaSite({ params }: PageProps<"/e/[empresaId]/loja/site">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const gerente = ctx.gerente || ctx.equipe;
  const inicioMes = hojeLocal().slice(0, 8) + "01";
  const [site, { data: pedidos }, { data: vendasMes }, { count: noSite }] = await Promise.all([
    carregarSite(ctx.supabase, empresaId),
    ctx.supabase
      .from("vendas")
      .select("id, numero, status, created_at, data, cliente_nome, cliente_telefone, entrega, total, venda_itens(quantidade)")
      .eq("empresa_id", empresaId)
      .eq("tipo", "orcamento")
      .eq("origem", "site")
      .order("created_at", { ascending: false })
      .limit(100),
    ctx.supabase.from("vendas").select("total").eq("empresa_id", empresaId).eq("tipo", "venda").eq("origem", "site").eq("status", "concluida").gte("data", inicioMes).limit(20000),
    ctx.supabase.from("loja_site_produtos").select("produto_id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("visivel", true),
  ]);
  const novos = (pedidos ?? []).filter((p) => p.status === "aberto");
  const doMes = (pedidos ?? []).filter((p) => p.data >= inicioMes);
  const vendidoMes = (vendasMes ?? []).reduce((s, v) => s.plus(dec(v.total)), dec(0));
  const base = `/e/${empresaId}/loja`;

  return (
    <>
      <CabecalhoPagina
        titulo="Site da loja"
        descricao="Os pedidos do site chegam aqui como orçamento. Em “Vender”, o pedido vira venda: baixa o estoque, entra no Financeiro e pode sair a nota."
        acoes={
          site?.endereco_site ? (
            <Button asChild variante="contorno">
              <a href={site.endereco_site} target="_blank" rel="noopener noreferrer">
                <Globe /> Abrir o site
              </a>
            </Button>
          ) : null
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <NavegacaoSite empresaId={empresaId} gerente={gerente} />
      {!site ? (
        <EstadoVazio
          icone={Globe}
          titulo="O site da loja ainda não foi configurado"
          descricao="Uma vitrine na internet, no domínio da loja, que mostra os produtos e o estoque daqui e manda os pedidos para cá. O cliente finaliza pelo WhatsApp."
          acao={
            gerente ? (
              <Button asChild>
                <Link href={`${base}/site/configurar`}>Configurar o site</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Indicador rotulo="Pedidos novos" valor={novos.length} detalhe="esperando o atendimento" icone={ShoppingBag} tom={novos.length ? "alerta" : "neutro"} />
            <Indicador rotulo="Pedidos no mês" valor={doMes.length} detalhe={formatarMoeda(doMes.reduce((s, p) => s.plus(dec(p.total)), dec(0)))} />
            <Indicador rotulo="Vendido pelo site no mês" valor={formatarMoeda(vendidoMes)} detalhe={`${(vendasMes ?? []).length} venda(s)`} tom="sucesso" />
            <Indicador rotulo="Produtos no site" valor={noSite ?? 0} detalhe={site.ativo ? (site.chave_inicio ? "site ligado" : "falta a chave do site") : "site desligado"} tom={site.ativo && site.chave_inicio ? "info" : "alerta"} href={gerente ? `${base}/site/produtos` : undefined} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Pedidos do site</CardTitle>
            </CardHeader>
            <CardContent>
              {(pedidos ?? []).length ? (
                <Table>
                  <THead>
                    <tr>
                      <Th>Pedido</Th>
                      <Th>Cliente</Th>
                      <Th>Entrega</Th>
                      <Th className="text-right">Itens</Th>
                      <Th className="text-right">Total</Th>
                      <Th>Situação</Th>
                      <Th />
                    </tr>
                  </THead>
                  <TBody>
                    {(pedidos ?? []).map((p) => {
                      const s = SITUACOES[p.status] ?? { rotulo: p.status, variante: "neutro" as const };
                      const link = whats(p.cliente_telefone);
                      return (
                        <Tr key={p.id}>
                          <Td>
                            <Link href={`${base}/vendas/${p.id}`} className="font-medium hover:underline">
                              nº {p.numero}
                            </Link>
                            <span className="block text-xs text-muted-foreground">
                              {formatarData(p.data)} às {hora(p.created_at)}
                            </span>
                          </Td>
                          <Td>
                            {p.cliente_nome ?? "—"}
                            {link ? (
                              <a href={link} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline">
                                WhatsApp
                              </a>
                            ) : null}
                          </Td>
                          <Td className="max-w-56 truncate text-muted-foreground" title={p.entrega ?? undefined}>
                            {p.entrega ?? "—"}
                          </Td>
                          <Td className="text-right numero">{(p.venda_itens ?? []).reduce((n, i) => n + Number(i.quantidade), 0).toLocaleString("pt-BR")}</Td>
                          <Td className="text-right numero font-medium">{formatarMoeda(p.total)}</Td>
                          <Td>
                            <Badge variante={s.variante}>{s.rotulo}</Badge>
                          </Td>
                          <Td className="text-right">
                            {p.status === "aberto" ? (
                              <Button asChild tamanho="sm">
                                <Link href={`${base}/vender?orcamento=${p.id}`}>Vender</Link>
                              </Button>
                            ) : null}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum pedido pelo site ainda.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
