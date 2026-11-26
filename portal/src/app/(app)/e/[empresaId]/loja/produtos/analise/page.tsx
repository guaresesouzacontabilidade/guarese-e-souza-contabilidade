import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, FileDown, FileSpreadsheet, PackageSearch, ShoppingCart, Snail, Warehouse } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AbasLink } from "@/components/ui/abas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { Table, TBody, TFoot, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { AbasEstoque } from "@/components/loja/abas-estoque";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { ALVOS, LIMITES_PARADO, PERIODOS, carregarAnaliseEstoque, opcao } from "@/lib/gestao/dados-analise";
import { curvaAbc, estoquePorGrupo, produtosParados, sugestaoCompra, totaisEstoque } from "@/lib/gestao/analise-estoque";
import { formatarQuantidade, un } from "@/lib/gestao/rotulos";
import { Decimal, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Reposição e análise do estoque" };

const VISOES = ["compras", "parados", "abc", "grupos"] as const;
type Visao = (typeof VISOES)[number];

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const MOTIVO = { zerado: { rotulo: "Sem estoque", tom: "perigo" }, minimo: { rotulo: "Abaixo do mínimo", tom: "alerta" }, ritmo: { rotulo: "Vai faltar", tom: "info" } } as const;

export default async function PaginaAnalise({ params, searchParams }: PageProps<"/e/[empresaId]/loja/produtos/analise">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const cabecalho = (
    <CabecalhoPagina
      titulo="Reposição e análise"
      descricao="O que comprar, o que está parado, o que mais vende e quanto vale o estoque."
      voltar={{ href: `/e/${empresaId}/loja/produtos`, rotulo: "Produtos e estoque" }}
    />
  );
  if (!ctx.custos) {
    return (
      <>
        {cabecalho}
        <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
        <EstadoVazio
          icone={BarChart3}
          titulo="A análise do estoque mostra custos e o valor do estoque"
          descricao="Peça ao responsável pela loja a permissão “Ver custos e margens”."
        />
      </>
    );
  }

  const dias = opcao(sp.dias, PERIODOS, 30);
  const alvo = opcao(sp.alvo, ALVOS, 30);
  const limite = opcao(sp.parado, LIMITES_PARADO, 60);
  const visao: Visao = VISOES.includes(sp.ver as Visao) ? (sp.ver as Visao) : "compras";
  const dados = await carregarAnaliseEstoque(ctx.supabase, empresaId, dias);
  const compras = sugestaoCompra(dados.produtos, dados.vendas, dias, alvo);
  const parados = produtosParados(dados.produtos, dados.vendas, dados.ultimaEntrada, dados.hoje, limite);
  const abc = curvaAbc(dados.produtos, dados.vendas);
  const grupos = estoquePorGrupo(dados.produtos);
  const totais = totaisEstoque(dados.produtos);
  const totalCompra = compras.reduce((s, c) => s.plus(c.valorCompra), new Decimal(0));
  const totalParado = parados.reduce((s, c) => s.plus(c.valorParado), new Decimal(0));
  const faturamento = abc.reduce((s, c) => s.plus(c.faturamento), new Decimal(0));
  const lucro = abc.reduce((s, c) => s.plus(c.lucro), new Decimal(0));
  const classeA = abc.filter((x) => x.classe === "A");

  const base = `/e/${empresaId}/loja/produtos/analise`;
  const filtros = { dias: String(dias), alvo: String(alvo), parado: String(limite) };
  const url = (extra: Record<string, string>) => `${base}?${new URLSearchParams({ ...filtros, ver: visao, ...extra })}`;
  const exportar = (tipo: string, formato: string) => `/api/loja/estoque/relatorio?${new URLSearchParams({ empresa: empresaId, tipo, formato, dias: String(dias), alvo: String(alvo) })}`;
  const produtoHref = (id: string) => `/e/${empresaId}/loja/produtos/${id}`;

  return (
    <>
      {cabecalho}
      <NavegacaoLoja empresaId={empresaId} configurar />
      <AbasEstoque empresaId={empresaId} ativa="analise" custos />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Valor do estoque (custo)" valor={formatarMoeda(totais.valor)} detalhe={totais.m3.gt(0) ? `${formatarQuantidade(totais.m3, 3)} m³ de madeira` : undefined} icone={Warehouse} tom="info" />
        <Indicador rotulo={`Comprar para ${alvo} dias`} valor={formatarMoeda(totalCompra)} detalhe={`${compras.length} produto(s), pelo custo`} icone={ShoppingCart} tom={compras.length ? "alerta" : "neutro"} href={url({ ver: "compras" })} />
        <Indicador rotulo={`Parado há ${limite}+ dias`} valor={formatarMoeda(totalParado)} detalhe={`${parados.length} produto(s) com dinheiro empatado`} icone={Snail} tom={parados.length ? "perigo" : "neutro"} href={url({ ver: "parados" })} />
        <Indicador rotulo={`Vendas em ${dias} dias`} valor={formatarMoeda(faturamento)} detalhe={faturamento.gt(0) ? `lucro bruto ${formatarMoeda(lucro)}` : "sem vendas no período"} icone={BarChart3} tom="sucesso" href={url({ ver: "abc" })} />
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end justify-between gap-3 pt-5">
          <form className="flex flex-wrap items-end gap-2" action={base}>
            <input type="hidden" name="ver" value={visao} />
            <label className="text-sm">
              <span className="mb-1 block font-medium">Ritmo de venda dos últimos</span>
              <Select name="dias" defaultValue={String(dias)} className="w-36">
                {PERIODOS.map((p) => (
                  <option key={p} value={p}>
                    {p} dias
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Comprar para</span>
              <Select name="alvo" defaultValue={String(alvo)} className="w-36">
                {ALVOS.map((p) => (
                  <option key={p} value={p}>
                    {p} dias
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Parado há mais de</span>
              <Select name="parado" defaultValue={String(limite)} className="w-36">
                {LIMITES_PARADO.map((p) => (
                  <option key={p} value={p}>
                    {p} dias
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variante="secundario">
              Atualizar
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button asChild variante="contorno" tamanho="sm">
              <a href={exportar("compras", "pdf")}>
                <FileDown /> Lista de compras (PDF)
              </a>
            </Button>
            <Button asChild variante="contorno" tamanho="sm">
              <a href={exportar("posicao", "pdf")}>
                <FileDown /> Posição do estoque (PDF)
              </a>
            </Button>
            <Button asChild variante="contorno" tamanho="sm">
              <a href={exportar("completo", "xlsx")}>
                <FileSpreadsheet /> Tudo em Excel
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <AbasLink
        ativa={visao}
        abas={[
          { valor: "compras", rotulo: "Sugestão de compra", href: url({ ver: "compras" }), contador: compras.length },
          { valor: "parados", rotulo: "Parados", href: url({ ver: "parados" }), contador: parados.length },
          { valor: "abc", rotulo: "Mais vendidos (curva ABC)", href: url({ ver: "abc" }) },
          { valor: "grupos", rotulo: "Estoque por grupo", href: url({ ver: "grupos" }) },
        ]}
      />

      {visao === "compras" ? (
        <Card>
          <CardHeader>
            <CardTitle>Sugestão de compra</CardTitle>
            <CardDescription>
              Para ter estoque para {alvo} dias no ritmo de venda dos últimos {dias} dias, e nunca menos que o estoque mínimo. O que acaba antes vem primeiro.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {compras.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Produto</Th>
                    <Th className="text-right">Estoque</Th>
                    <Th className="text-right">Dura</Th>
                    <Th className="text-right">Vende por dia</Th>
                    <Th className="text-right">Comprar</Th>
                    <Th className="text-right">Valor estimado</Th>
                  </tr>
                </THead>
                <TBody>
                  {compras.map((c) => (
                    <Tr key={c.produto.id}>
                      <Td>
                        <Link href={produtoHref(c.produto.id)} className="font-medium hover:underline">
                          {c.produto.descricao}
                        </Link>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          <Badge variante={MOTIVO[c.motivo].tom}>{MOTIVO[c.motivo].rotulo}</Badge>
                          {c.produto.grupo ?? ""}
                        </span>
                      </Td>
                      <Td className="text-right numero">
                        {formatarQuantidade(c.produto.estoque_atual)} {un(c.produto.unidade)}
                        {c.produto.estoque_minimo ? <span className="block text-xs text-muted-foreground">mín. {formatarQuantidade(c.produto.estoque_minimo)}</span> : null}
                      </Td>
                      <Td className="text-right numero">{c.cobertura === null ? <span className="text-muted-foreground">não vendeu</span> : c.cobertura === 0 ? <span className="text-perigo">acabou</span> : `${c.cobertura} dia(s)`}</Td>
                      <Td className="text-right numero">{c.media.gt(0) ? `${formatarQuantidade(c.media, 2)} ${un(c.produto.unidade)}` : "—"}</Td>
                      <Td className="text-right numero font-semibold">
                        {formatarQuantidade(c.comprar, 3)} {un(c.produto.unidade)}
                      </Td>
                      <Td className="text-right numero">{c.valorCompra.gt(0) ? formatarMoeda(c.valorCompra) : <span className="text-xs text-muted-foreground">sem custo</span>}</Td>
                    </Tr>
                  ))}
                </TBody>
                <TFoot>
                  <tr>
                    <Td colSpan={5}>Total estimado (pelo custo)</Td>
                    <Td className="text-right numero">{formatarMoeda(totalCompra)}</Td>
                  </tr>
                </TFoot>
              </Table>
            ) : (
              <EstadoVazio icone={ShoppingCart} titulo="Nada para comprar agora" descricao={`O estoque dá para mais de ${alvo} dias no ritmo atual e está acima do mínimo.`} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {visao === "parados" ? (
        <Card>
          <CardHeader>
            <CardTitle>Produtos parados</CardTitle>
            <CardDescription>Com estoque e sem vender há {limite} dias ou mais. Dinheiro empatado = estoque × custo médio. Uma promoção pode ajudar a girar.</CardDescription>
          </CardHeader>
          <CardContent>
            {parados.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Produto</Th>
                    <Th className="text-right">Estoque</Th>
                    <Th className="text-right">Última venda</Th>
                    <Th className="text-right">Dinheiro empatado</Th>
                  </tr>
                </THead>
                <TBody>
                  {parados.map((p) => (
                    <Tr key={p.produto.id}>
                      <Td>
                        <Link href={produtoHref(p.produto.id)} className="font-medium hover:underline">
                          {p.produto.descricao}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{p.produto.grupo ?? ""}</span>
                      </Td>
                      <Td className="text-right numero">
                        {formatarQuantidade(p.estoque)} {un(p.produto.unidade)}
                      </Td>
                      <Td className="text-right numero">
                        {p.ultimaVenda ? (
                          <>
                            {formatarData(p.ultimaVenda)}
                            <span className="block text-xs text-muted-foreground">há {p.diasSemVender} dias</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">nunca vendeu</span>
                        )}
                      </Td>
                      <Td className="text-right numero font-medium">{p.valorParado.gt(0) ? formatarMoeda(p.valorParado) : "—"}</Td>
                    </Tr>
                  ))}
                </TBody>
                <TFoot>
                  <tr>
                    <Td colSpan={3}>Total empatado</Td>
                    <Td className="text-right numero">{formatarMoeda(totalParado)}</Td>
                  </tr>
                </TFoot>
              </Table>
            ) : (
              <EstadoVazio icone={Snail} titulo="Nenhum produto parado" descricao={`Todos os produtos com estoque venderam nos últimos ${limite} dias (ou entraram há pouco).`} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {visao === "abc" ? (
        <Card>
          <CardHeader>
            <CardTitle>Mais vendidos — curva ABC</CardTitle>
            <CardDescription>
              Pelo faturamento dos últimos {dias} dias.{" "}
              {classeA.length ? `${classeA.length} produto(s) (classe A) fazem cerca de 80% das vendas: não deixe faltar.` : ""} B: até 95%. C: o resto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {abc.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th className="w-10">#</Th>
                    <Th>Produto</Th>
                    <Th>Classe</Th>
                    <Th className="text-right">Vendido</Th>
                    <Th className="text-right">Faturamento</Th>
                    <Th className="text-right">Lucro bruto</Th>
                    <Th className="text-right">% das vendas</Th>
                  </tr>
                </THead>
                <TBody>
                  {abc.map((x, i) => (
                    <Tr key={x.produto.id}>
                      <Td className="numero text-muted-foreground">{i + 1}</Td>
                      <Td>
                        <Link href={produtoHref(x.produto.id)} className="font-medium hover:underline">
                          {x.produto.descricao}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{x.produto.grupo ?? ""}</span>
                      </Td>
                      <Td>
                        <Badge variante={x.classe === "A" ? "sucesso" : x.classe === "B" ? "info" : "neutro"}>{x.classe}</Badge>
                      </Td>
                      <Td className="text-right numero">
                        {formatarQuantidade(x.quantidade, 3)} {un(x.produto.unidade)}
                      </Td>
                      <Td className="text-right numero">{formatarMoeda(x.faturamento)}</Td>
                      <Td className={`text-right numero ${x.lucro.lt(0) ? "text-perigo" : ""}`}>{formatarMoeda(x.lucro)}</Td>
                      <Td className="text-right numero">
                        {pct(x.participacao)}
                        <span className="block text-xs text-muted-foreground">acum. {pct(x.acumulado)}</span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EstadoVazio icone={BarChart3} titulo="Sem vendas no período" descricao="As vendas concluídas no caixa aparecem aqui." />
            )}
          </CardContent>
        </Card>
      ) : null}

      {visao === "grupos" ? (
        <Card>
          <CardHeader>
            <CardTitle>Estoque por grupo</CardTitle>
            <CardDescription>Quantidade, metros cúbicos (madeira com as medidas da peça) e valor pelo custo médio.</CardDescription>
          </CardHeader>
          <CardContent>
            {grupos.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Grupo</Th>
                    <Th className="text-right">Produtos</Th>
                    <Th className="text-right">Quantidade</Th>
                    <Th className="text-right">m³</Th>
                    <Th className="text-right">Valor (custo)</Th>
                  </tr>
                </THead>
                <TBody>
                  {grupos.map((g) => (
                    <Tr key={g.grupo}>
                      <Td className="font-medium">
                        {g.grupo}
                        {g.semEstoque ? <span className="block text-xs font-normal text-perigo">{g.semEstoque} sem estoque</span> : null}
                      </Td>
                      <Td className="text-right numero">{g.produtos}</Td>
                      <Td className="text-right numero">
                        {Object.entries(g.quantidades)
                          .map(([u, q]) => `${formatarQuantidade(q, 3)} ${un(u)}`)
                          .join(" + ") || "—"}
                      </Td>
                      <Td className="text-right numero">{g.m3.gt(0) ? formatarQuantidade(g.m3, 3) : "—"}</Td>
                      <Td className="text-right numero font-medium">{formatarMoeda(g.valor)}</Td>
                    </Tr>
                  ))}
                </TBody>
                <TFoot>
                  <tr>
                    <Td colSpan={3}>Total</Td>
                    <Td className="text-right numero">{totais.m3.gt(0) ? formatarQuantidade(totais.m3, 3) : "—"}</Td>
                    <Td className="text-right numero">{formatarMoeda(totais.valor)}</Td>
                  </tr>
                </TFoot>
              </Table>
            ) : (
              <EstadoVazio icone={PackageSearch} titulo="Nenhum produto com controle de estoque" />
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
