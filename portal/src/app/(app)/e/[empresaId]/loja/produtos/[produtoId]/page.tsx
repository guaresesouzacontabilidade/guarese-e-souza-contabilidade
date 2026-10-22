import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { DialogoProduto, LancarEstoque } from "@/components/loja/produtos";
import { diasAtras, obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarProdutosLoja, estoqueBaixo } from "@/lib/gestao/dados";
import { TIPOS_MOVIMENTO, formatarQuantidade, secaoPeca, un } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Produto" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaProduto({ params }: PageProps<"/e/[empresaId]/loja/produtos/[produtoId]">) {
  const { empresaId, produtoId } = await params;
  if (!UUID.test(produtoId)) notFound();
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} />;
  const todos = await carregarProdutosLoja(ctx.supabase, empresaId);
  const p = todos.find((x) => x.id === produtoId);
  if (!p) notFound();
  const grupos = [...new Set(todos.map((x) => x.grupo).filter((g): g is string => Boolean(g)))].sort();
  const [{ data: movimentos }, { data: vendidos }] = await Promise.all([
    ctx.supabase
      .from("estoque_movimentos")
      .select("id, tipo, quantidade, custo_unitario, saldo_apos, observacao, created_at, venda_id, autor:perfis!estoque_movimentos_criado_por_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("produto_id", produtoId)
      .order("created_at", { ascending: false })
      .limit(200),
    ctx.supabase
      .from("venda_itens")
      .select("quantidade, total, venda:vendas!inner(status, tipo, data)")
      .eq("empresa_id", empresaId)
      .eq("produto_id", produtoId)
      .eq("venda.tipo", "venda")
      .eq("venda.status", "concluida")
      .gte("venda.data", diasAtras(30))
      .limit(5000),
  ]);
  const vendido30 = (vendidos ?? []).reduce((s, i) => ({ q: s.q.plus(dec(i.quantidade)), v: s.v.plus(dec(i.total)) }), { q: dec(0), v: dec(0) });
  const custo = dec(p.custo_medio ?? p.preco_custo ?? 0);
  const margem = custo.gt(0) && p.valor_unitario ? dec(p.valor_unitario).minus(custo).div(p.valor_unitario).times(100) : null;

  return (
    <>
      <CabecalhoPagina
        titulo={p.descricao}
        descricao={`Código ${p.codigo} · NCM ${p.ncm}${p.grupo ? ` · ${p.grupo}` : ""}${secaoPeca(p) ? ` · peça ${secaoPeca(p)}` : ""}${p.comprimento_m ? ` × ${formatarQuantidade(p.comprimento_m, 3)} m` : ""}`}
        voltar={{ href: `/e/${empresaId}/loja/produtos`, rotulo: "Produtos e estoque" }}
        acoes={
          ctx.gerente ? (
            <>
              <LancarEstoque empresaId={empresaId} produtos={[p]} produtoId={p.id} />
              <DialogoProduto empresaId={empresaId} produto={p} grupos={grupos} />
            </>
          ) : null
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Estoque"
          valor={p.controla_estoque ? `${formatarQuantidade(p.estoque_atual)} ${un(p.unidade)}` : "Não controla"}
          detalhe={p.estoque_minimo ? `mínimo ${formatarQuantidade(p.estoque_minimo)} ${un(p.unidade)}` : undefined}
          tom={estoqueBaixo(p) ? "perigo" : "neutro"}
        />
        <Indicador rotulo={`Preço de venda (${un(p.unidade)})`} valor={formatarMoeda(p.valor_unitario)} detalhe={margem ? `margem ${margem.toFixed(1).replace(".", ",")}% sobre o custo médio` : undefined} />
        <Indicador rotulo="Custo médio" valor={custo.gt(0) ? formatarMoeda(custo) : "—"} detalhe={custo.gt(0) && p.controla_estoque ? `estoque vale ${formatarMoeda(dec(p.estoque_atual).times(custo))}` : undefined} tom="info" />
        <Indicador rotulo="Vendido em 30 dias" valor={`${formatarQuantidade(vendido30.q)} ${un(p.unidade)}`} detalhe={formatarMoeda(vendido30.v)} tom="sucesso" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Movimentos do estoque</CardTitle>
        </CardHeader>
        <CardContent>
          {(movimentos ?? []).length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Movimento</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">Custo</Th>
                  <Th className="text-right">Saldo</Th>
                </tr>
              </THead>
              <TBody>
                {(movimentos ?? []).map((m) => {
                  const q = dec(m.quantidade);
                  return (
                    <Tr key={m.id}>
                      <Td className="numero text-muted-foreground">{formatarDataHora(m.created_at)}</Td>
                      <Td>
                        <Badge variante={q.gt(0) ? "sucesso" : "neutro"}>{TIPOS_MOVIMENTO[m.tipo] ?? m.tipo}</Badge>
                        <span className="block text-xs text-muted-foreground">
                          {[m.observacao, (m.autor as { nome?: string } | null)?.nome].filter(Boolean).join(" · ")}
                        </span>
                      </Td>
                      <Td className={`text-right numero ${q.gt(0) ? "text-sucesso" : "text-perigo"}`}>
                        {q.gt(0) ? "+" : ""}
                        {formatarQuantidade(q)}
                      </Td>
                      <Td className="text-right numero">{m.custo_unitario != null ? formatarMoeda(m.custo_unitario) : "—"}</Td>
                      <Td className="text-right numero font-medium">{formatarQuantidade(m.saldo_apos)}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum movimento ainda.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
