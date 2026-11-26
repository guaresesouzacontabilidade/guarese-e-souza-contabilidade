import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { DialogoProduto, ExcluirProduto, LancarEstoque } from "@/components/loja/produtos";
import { diasAtras, obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarMargens, carregarProdutosLoja, estoqueBaixo } from "@/lib/gestao/dados";
import { custoReferencia, margemAlvo, margemReal } from "@/lib/gestao/precos";
import { TIPOS_MOVIMENTO, formatarQuantidade, secaoPeca, un } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Produto" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaProduto({ params }: PageProps<"/e/[empresaId]/loja/produtos/[produtoId]">) {
  const { empresaId, produtoId } = await params;
  if (!UUID.test(produtoId)) notFound();
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const todos = await carregarProdutosLoja(ctx.supabase, empresaId);
  const p = todos.find((x) => x.id === produtoId);
  if (!p) notFound();
  const grupos = [...new Set(todos.map((x) => x.grupo).filter((g): g is string => Boolean(g)))].sort();
  const [{ data: movimentos }, { data: vendidos }, margens, { data: historico }] = await Promise.all([
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
    ctx.gerente ? carregarMargens(ctx.supabase, empresaId) : null,
    ctx.gerente
      ? ctx.supabase
          .from("produto_precos_historico")
          .select("id, preco_anterior, preco_novo, custo_referencia, origem, created_at, autor:perfis!produto_precos_historico_criado_por_fkey(nome)")
          .eq("empresa_id", empresaId)
          .eq("produto_id", produtoId)
          .order("id", { ascending: false })
          .limit(100)
      : { data: null },
  ]);
  const vendido30 = (vendidos ?? []).reduce((s, i) => ({ q: s.q.plus(dec(i.quantidade)), v: s.v.plus(dec(i.total)) }), { q: dec(0), v: dec(0) });
  const custo = dec(p.custo_medio ?? p.preco_custo ?? 0);
  // Margem sobre o custo (custo 100, preço 130 = 30%), pelo custo da última compra
  const custoRef = custoReferencia({ ultimo_custo_entrada: margens?.situacao.get(p.id)?.ultimo_custo_entrada, preco_custo: p.preco_custo, custo_medio: p.custo_medio });
  const margem = margens ? margemReal(p.valor_unitario, custoRef) : null;
  const alvo = margens ? margemAlvo(p, margens.grupos, margens.padrao) : null;
  const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

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
              <ExcluirProduto empresaId={empresaId} produto={p} />
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
        <Indicador
          rotulo={`Preço de venda (${un(p.unidade)})`}
          valor={formatarMoeda(p.valor_unitario)}
          detalhe={margem !== null ? `margem ${pct(margem)} sobre o custo${alvo ? ` · meta ${pct(alvo.valor)}` : ""}` : undefined}
          tom={margem !== null && alvo && margem < alvo.valor - 0.05 ? "alerta" : "neutro"}
        />
        {ctx.gerente ? (
          <Indicador rotulo="Custo médio" valor={custo.gt(0) ? formatarMoeda(custo) : "—"} detalhe={custo.gt(0) && p.controla_estoque ? `estoque vale ${formatarMoeda(dec(p.estoque_atual).times(custo))}` : undefined} tom="info" />
        ) : (
          <Indicador rotulo="Grupo" valor={p.grupo ?? "—"} tom="info" />
        )}
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
                  {ctx.gerente ? <Th className="text-right">Custo</Th> : null}
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
                      {ctx.gerente ? <Td className="text-right numero">{m.custo_unitario != null ? formatarMoeda(m.custo_unitario) : "—"}</Td> : null}
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
      {historico?.length ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Histórico de preços</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <tr>
                  <Th>Quando</Th>
                  <Th className="text-right">De</Th>
                  <Th className="text-right">Para</Th>
                  <Th className="text-right">Custo na época</Th>
                  <Th>Quem</Th>
                </tr>
              </THead>
              <TBody>
                {historico.map((h) => (
                  <Tr key={h.id}>
                    <Td className="numero text-muted-foreground">{formatarDataHora(h.created_at)}</Td>
                    <Td className="text-right numero">{h.preco_anterior != null ? formatarMoeda(h.preco_anterior) : "cadastro"}</Td>
                    <Td className="text-right numero font-medium">{formatarMoeda(h.preco_novo)}</Td>
                    <Td className="text-right numero">{h.custo_referencia != null ? formatarMoeda(h.custo_referencia) : "—"}</Td>
                    <Td className="text-sm">
                      {(h.autor as { nome?: string } | null)?.nome ?? "—"}
                      <span className="block text-xs text-muted-foreground">{h.origem === "tabela_precos" ? "pela tabela de preços" : "pelo cadastro"}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
