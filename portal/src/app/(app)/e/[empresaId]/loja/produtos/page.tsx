import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, ClipboardCheck, FileInput, FileSpreadsheet, PackageX, Tags, Warehouse } from "lucide-react";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { DialogoProduto, LancarEstoque } from "@/components/loja/produtos";
import { AbasEstoque } from "@/components/loja/abas-estoque";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarMargens, carregarProdutosLoja, estoqueBaixo } from "@/lib/gestao/dados";
import { formatarQuantidade, secaoPeca, un } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { custoUnitario } from "@/lib/gestao/analise-estoque";
import { custoReferencia, margemAlvo, margemReal } from "@/lib/gestao/precos";

export const metadata: Metadata = { title: "Produtos e estoque" };

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export default async function PaginaProdutos({ params, searchParams }: PageProps<"/e/[empresaId]/loja/produtos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;

  const [todos, margens] = await Promise.all([
    carregarProdutosLoja(ctx.supabase, empresaId, { custos: ctx.custos }),
    ctx.custos ? carregarMargens(ctx.supabase, empresaId) : null,
  ]);
  // Margem real (sobre o custo da última compra) e meta: só para quem vê custos e margens
  const margemDe = (p: (typeof todos)[number]) => {
    if (!margens) return null;
    const s = margens.situacao.get(p.id);
    const custo = custoReferencia({ ultimo_custo_entrada: s?.ultimo_custo_entrada, preco_custo: p.preco_custo, custo_medio: p.custo_medio });
    const real = margemReal(p.valor_unitario, custo);
    const alvo = margemAlvo(p, margens.grupos, margens.padrao);
    return { real, alvo, abaixo: alvo !== null && real !== null && real < alvo.valor - 0.05 };
  };
  const grupos = [...new Set(todos.map((p) => p.grupo).filter((g): g is string => Boolean(g)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const grupo = typeof sp.grupo === "string" ? sp.grupo : "";
  const filtro = typeof sp.filtro === "string" ? sp.filtro : "";
  const lista = todos.filter(
    (p) =>
      (!q || `${p.descricao} ${p.codigo} ${p.gtin ?? ""}`.toLowerCase().includes(q)) &&
      (!grupo || p.grupo === grupo) &&
      (filtro === "baixo" ? estoqueBaixo(p) : filtro === "inativos" ? !p.ativo : filtro === "margem" ? p.ativo && Boolean(margemDe(p)?.abaixo) : p.ativo),
  );

  const ativos = todos.filter((p) => p.ativo);
  const valorEstoque = ativos
    .filter((p) => p.controla_estoque && dec(p.estoque_atual).gt(0))
    .reduce((s, p) => s.plus(dec(p.estoque_atual).times(custoUnitario(p))), dec(0));
  const baixos = ativos.filter(estoqueBaixo).length;
  const zerados = ativos.filter((p) => p.controla_estoque && dec(p.estoque_atual).lte(0)).length;
  const base = `/e/${empresaId}/loja/produtos`;

  return (
    <>
      <CabecalhoPagina
        titulo="Produtos e estoque"
        descricao="Um cadastro só para vender no caixa e emitir a nota. Cada venda baixa o estoque sozinha."
        acoes={
          ctx.gerente ? (
            <>
              <LancarEstoque empresaId={empresaId} produtos={ativos} custos={ctx.custos} />
              {ctx.custos ? (
                <Button asChild variante="contorno">
                  <Link href={`${base}/entrada-nota`}>
                    <FileInput /> Entrada de mercadorias
                  </Link>
                </Button>
              ) : null}
              <Button asChild variante="contorno">
                <Link href={`${base}/inventario`}>
                  <ClipboardCheck /> Inventário
                </Link>
              </Button>
              <Button asChild variante="contorno">
                <Link href={`${base}/importar`}>
                  <FileSpreadsheet /> Importar planilha
                </Link>
              </Button>
              <DialogoProduto empresaId={empresaId} grupos={grupos} custos={ctx.custos} />
            </>
          ) : null
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <AbasEstoque empresaId={empresaId} ativa="produtos" custos={ctx.custos} />
      {ctx.custos && sp.conferir ? (
        <Alerta
          tom="sucesso"
          titulo="Entrada lançada no estoque"
          className="mb-4"
          acao={
            <Button asChild tamanho="sm">
              <Link href={`${base}/precos?filtro=entrada`}>
                <Tags /> Conferir preços de venda
              </Link>
            </Button>
          }
        >
          Se o custo dos produtos mudou, confira se o preço de venda ainda dá a margem que você quer.
        </Alerta>
      ) : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Produtos ativos" valor={ativos.length} icone={Boxes} />
        {ctx.custos ? (
          <Indicador rotulo="Valor do estoque (custo)" valor={formatarMoeda(valorEstoque)} detalhe="pelo custo médio" icone={Warehouse} tom="info" />
        ) : (
          <Indicador rotulo="Grupos" valor={grupos.length} icone={Warehouse} tom="info" />
        )}
        <Indicador rotulo="Abaixo do mínimo" valor={baixos} icone={AlertTriangle} tom={baixos ? "alerta" : "neutro"} href={urlCom(base, {}, { filtro: "baixo" })} />
        <Indicador rotulo="Sem estoque" valor={zerados} icone={PackageX} tom={zerados ? "perigo" : "neutro"} href={urlCom(base, {}, { filtro: "baixo" })} />
      </div>
      <Card>
        <CardContent className="space-y-4 pt-5">
          <form className="flex flex-wrap items-end gap-2" action={base}>
            <Input name="q" defaultValue={typeof sp.q === "string" ? sp.q : ""} placeholder="Buscar por nome, código ou código de barras" className="w-full sm:w-80" aria-label="Buscar produto" />
            <Select name="grupo" defaultValue={grupo} className="w-full sm:w-48" aria-label="Grupo">
              <option value="">Todos os grupos</option>
              {grupos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
            <Select name="filtro" defaultValue={filtro} className="w-full sm:w-52" aria-label="Situação">
              <option value="">Ativos</option>
              <option value="baixo">Estoque baixo ou zerado</option>
              {ctx.custos ? <option value="margem">Margem abaixo da meta</option> : null}
              <option value="inativos">Inativos</option>
            </Select>
            <Button type="submit" variante="secundario">
              Filtrar
            </Button>
          </form>
          {lista.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="text-right">Preço de venda</Th>
                  {ctx.custos ? <Th className="text-right">Margem</Th> : null}
                  <Th className="text-right">Estoque</Th>
                  {ctx.custos ? (
                    <>
                      <Th className="text-right">Custo médio</Th>
                      <Th className="text-right">Valor em estoque</Th>
                    </>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {lista.map((p) => {
                  const baixo = estoqueBaixo(p);
                  const custo = custoUnitario(p);
                  const margem = margemDe(p);
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`${base}/${p.id}`} className="font-medium hover:underline">
                          {p.descricao}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {p.codigo}
                          {p.grupo ? ` · ${p.grupo}` : ""}
                          {secaoPeca(p) ? ` · peça ${secaoPeca(p)}` : ""}
                          {p.comprimento_m ? ` × ${formatarQuantidade(p.comprimento_m, 3)} m` : ""}
                        </span>
                      </Td>
                      <Td className="text-right numero">
                        {formatarMoeda(p.valor_unitario)}
                        <span className="block text-xs text-muted-foreground">por {un(p.unidade)}</span>
                      </Td>
                      {margem ? (
                        <Td className="text-right numero">
                          {margem.real !== null ? (
                            <span className={margem.abaixo ? "font-medium text-perigo" : margem.alvo ? "font-medium text-sucesso" : undefined}>{pct(margem.real)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {margem.alvo ? <span className={`block text-xs ${margem.abaixo ? "text-perigo" : "text-muted-foreground"}`}>meta {pct(margem.alvo.valor)}</span> : null}
                        </Td>
                      ) : null}
                      <Td className="text-right numero">
                        {p.controla_estoque ? (
                          <>
                            <span className={baixo ? "font-semibold text-perigo" : undefined}>
                              {formatarQuantidade(p.estoque_atual)} {un(p.unidade)}
                            </span>
                            {baixo ? (
                              <span className="block">
                                <Badge variante={dec(p.estoque_atual).lte(0) ? "perigo" : "alerta"}>{dec(p.estoque_atual).lte(0) ? "Sem estoque" : "Abaixo do mínimo"}</Badge>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">não controla</span>
                        )}
                      </Td>
                      {ctx.custos ? (
                        <>
                          <Td className="text-right numero">{custo.gt(0) ? formatarMoeda(custo) : "—"}</Td>
                          <Td className="text-right numero">{p.controla_estoque && dec(p.estoque_atual).gt(0) && custo.gt(0) ? formatarMoeda(dec(p.estoque_atual).times(custo)) : "—"}</Td>
                        </>
                      ) : null}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio
              icone={Boxes}
              titulo={todos.length ? "Nenhum produto com esse filtro" : "Nenhum produto cadastrado"}
              descricao={todos.length ? undefined : "Cadastre os produtos com o preço de venda e o NCM. Para madeira, informe as medidas da peça e o sistema calcula os m³."}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
