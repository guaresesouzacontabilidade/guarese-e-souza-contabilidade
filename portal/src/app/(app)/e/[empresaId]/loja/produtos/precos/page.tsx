import type { Metadata } from "next";
import { Percent, Tags } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { AbasEstoque } from "@/components/loja/abas-estoque";
import { ConfigMargens, TabelaPrecos, type LinhaPreco } from "@/components/loja/tabela-precos";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarMargens, carregarProdutosLoja } from "@/lib/gestao/dados";
import { m3PorUnidade } from "@/lib/gestao/precos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Preços de venda" };


export default async function PaginaPrecos({ params, searchParams }: PageProps<"/e/[empresaId]/loja/produtos/precos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const cabecalho = <CabecalhoPagina titulo="Preços de venda" descricao="Confira o custo, a margem e ajuste os preços depois de cada entrada de mercadorias." voltar={{ href: `/e/${empresaId}/loja/produtos`, rotulo: "Produtos e estoque" }} />;
  if (!ctx.gerente) {
    return (
      <>
        {cabecalho}
        <NavegacaoLoja empresaId={empresaId} configurar={ctx.equipe} />
        <EstadoVazio icone={Tags} titulo="Só quem gerencia a loja vê custos e muda preços" descricao="Peça ao responsável pela loja para liberar a permissão de gerenciar." />
      </>
    );
  }

  const [produtos, { situacao: porProduto, grupos, padrao }, { data: historico }] = await Promise.all([
    carregarProdutosLoja(ctx.supabase, empresaId, { ativos: true }),
    carregarMargens(ctx.supabase, empresaId),
    ctx.supabase
      .from("produto_precos_historico")
      .select("id, produto_id, preco_anterior, preco_novo, origem, created_at, autor:perfis!produto_precos_historico_criado_por_fkey(nome)")
      .eq("empresa_id", empresaId)
      .not("preco_anterior", "is", null)
      .order("id", { ascending: false })
      .limit(30),
  ]);

  // "Da última entrada": o que entrou até 30 minutos antes da entrada mais recente
  const ultima = Math.max(0, ...[...porProduto.values()].map((x) => (x.ultima_entrada_em ? new Date(x.ultima_entrada_em).getTime() : 0)));
  const corte = ultima - 30 * 60000;
  const linhas: LinhaPreco[] = produtos
    .map((p) => {
      const s = porProduto.get(p.id);
      const m3 = m3PorUnidade(p);
      return {
        id: p.id,
        descricao: p.descricao,
        codigo: p.codigo,
        grupo: p.grupo,
        unidade: p.unidade,
        preco: p.valor_unitario,
        custo_medio: p.custo_medio,
        preco_custo: p.preco_custo,
        ultimo_custo_entrada: s?.ultimo_custo_entrada ?? null,
        ultima_entrada_em: s?.ultima_entrada_em ?? null,
        preco_alterado_em: s?.preco_alterado_em ?? null,
        custo_na_alteracao: s?.custo_na_alteracao ?? null,
        margem_desejada: p.margem_desejada ?? null,
        m3: m3 ? m3.toString() : null,
        da_entrada: Boolean(ultima && s?.ultima_entrada_em && new Date(s.ultima_entrada_em).getTime() >= corte),
      };
    })
    .sort((a, b) => (b.ultima_entrada_em ?? "").localeCompare(a.ultima_entrada_em ?? "") || a.descricao.localeCompare(b.descricao, "pt-BR"));

  const contagemGrupos = new Map<string, number>();
  for (const p of produtos) if (p.grupo) contagemGrupos.set(p.grupo, (contagemGrupos.get(p.grupo) ?? 0) + 1);
  const listaGrupos = [...contagemGrupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([grupo, n]) => ({ grupo, produtos: n, margem: grupos[grupo] ?? null }));
  const nomes = new Map(produtos.map((p) => [p.id, p.descricao]));
  const filtro = typeof sp.filtro === "string" ? sp.filtro : undefined;

  return (
    <>
      {cabecalho}
      <NavegacaoLoja empresaId={empresaId} configurar />
      <AbasEstoque empresaId={empresaId} ativa="precos" gerente />
      <details className="group mb-4 rounded-2xl border border-border bg-card" open={!padrao && !listaGrupos.some((g) => g.margem)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm">
          <Percent className="size-4 shrink-0 text-primary" />
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">Margem que quero ganhar</span>
            <span className="text-muted-foreground">
              {padrao ? `padrão ${padrao.replace(".", ",")}%` : "opcional"}
              {listaGrupos.some((g) => g.margem) ? ` · ${listaGrupos.filter((g) => g.margem).length} grupo(s) com margem própria` : ""}
            </span>
          </span>
          <span className="shrink-0 text-xs text-primary group-open:hidden">mostrar</span>
        </summary>
        <div className="border-t border-border p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            A margem é sobre o custo: custo de R$ 100,00 com margem de 30% dá preço de R$ 130,00. Cada produto usa a meta dele; sem meta, usa a do grupo; sem a do grupo, a padrão. É só uma
            referência: o preço só muda quando você salvar.
          </p>
          <ConfigMargens empresaId={empresaId} padrao={padrao} grupos={listaGrupos} />
        </div>
      </details>
      <Card>
        <CardContent className="pt-5">
          {linhas.length ? (
            <TabelaPrecos empresaId={empresaId} linhas={linhas} grupos={grupos} padrao={padrao} filtroInicial={filtro} rotuloEntrada="Da última entrada" />
          ) : (
            <EstadoVazio icone={Tags} titulo="Nenhum produto ativo" descricao="Cadastre os produtos ou dê entrada numa nota de compra." />
          )}
        </CardContent>
      </Card>
      {(historico ?? []).length ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Últimas mudanças de preço</CardTitle>
            <CardDescription>Quem mudou, quando e de quanto para quanto. O histórico completo fica na página de cada produto.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Produto</Th>
                  <Th className="text-right">De</Th>
                  <Th className="text-right">Para</Th>
                  <Th>Quem</Th>
                </tr>
              </THead>
              <TBody>
                {(historico ?? []).map((h) => (
                  <Tr key={h.id}>
                    <Td className="numero text-muted-foreground">{formatarDataHora(h.created_at)}</Td>
                    <Td>{nomes.get(h.produto_id) ?? "Produto inativo"}</Td>
                    <Td className="text-right numero">{formatarMoeda(h.preco_anterior)}</Td>
                    <Td className="text-right numero font-medium">{formatarMoeda(h.preco_novo)}</Td>
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
