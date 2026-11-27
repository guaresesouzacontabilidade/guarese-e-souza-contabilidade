import type { Metadata } from "next";
import Link from "next/link";
import { Download, HandCoins } from "lucide-react";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/form";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { BotaoImprimir, LancarComissoes } from "@/components/loja/comissoes";
import { obterContextoLoja, hojeLocal } from "@/lib/gestao/contexto";
import { carregarComissoes, lerFiltroComissoes } from "@/lib/gestao/comissoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Comissões" };

/**
 * Comissões dos vendedores por período: quantas vendas, total vendido e
 * comissão de cada um, com o detalhe venda a venda. Quem gerencia vê todos e
 * lança no Contas a pagar; o vendedor com login vê só as dele.
 */
export default async function PaginaComissoes({ params, searchParams }: PageProps<"/e/[empresaId]/loja/comissoes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende && !ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;

  const hoje = hojeLocal();
  const f = lerFiltroComissoes(sp, hoje);
  const base = `/e/${empresaId}/loja/comissoes`;
  const [dados, { data: vendedores }, { data: meu }, { data: categorias }] = await Promise.all([
    carregarComissoes(ctx.supabase, empresaId, f),
    ctx.gerente ? ctx.supabase.from("loja_vendedores").select("id, nome").eq("empresa_id", empresaId).order("nome") : Promise.resolve({ data: [] }),
    ctx.supabase.from("loja_vendedores").select("id, nome").eq("empresa_id", empresaId).eq("usuario_id", ctx.sessao.usuarioId).maybeSingle(),
    ctx.gerente && ctx.pode("financeiro.editar")
      ? ctx.supabase.from("categorias_financeiras").select("id, nome, codigo").eq("empresa_id", empresaId).eq("natureza", "despesa").eq("sintetica", false).eq("ativa", true).order("codigo")
      : Promise.resolve({ data: [] }),
  ]);
  const { linhas, resumo, totais } = dados;
  const planilha = urlCom(`/api/loja/comissoes`, {}, { empresa: empresaId, inicio: f.inicio, fim: f.fim, vendedor: f.vendedor || null });
  const proximoMes = (() => {
    const [a, m] = hoje.split("-").map(Number);
    return new Date(Date.UTC(a, m, 10)).toISOString().slice(0, 10);
  })();

  return (
    <>
      <CabecalhoPagina
        titulo={ctx.gerente ? "Comissões" : "Minhas comissões"}
        descricao={`Vendas concluídas de ${formatarData(f.inicio)} a ${formatarData(f.fim)}. A comissão é sobre os produtos com desconto, sem o frete; venda cancelada não entra.`}
        acoes={
          <>
            <Button asChild variante="contorno" className="print:hidden">
              <a href={planilha}>
                <Download /> Excel
              </a>
            </Button>
            <BotaoImprimir />
            {ctx.gerente && ctx.pode("financeiro.editar") ? (
              <LancarComissoes
                empresaId={empresaId}
                inicio={f.inicio}
                fim={f.fim}
                aLancar={totais.aLancar}
                categorias={(categorias ?? []).map((c) => ({ id: c.id, nome: `${c.codigo} ${c.nome}` }))}
                vencimentoPadrao={proximoMes}
              />
            ) : null}
          </>
        }
      />
      <div className="print:hidden">
        <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      </div>

      {!ctx.gerente && !meu ? (
        <Alerta tom="info" className="mb-4">
          Seu login não está ligado a um cadastro de vendedor. Peça a quem gerencia a loja para ligar em Loja → Vendedores.
        </Alerta>
      ) : null}

      <form className="mb-4 flex flex-wrap items-end gap-2 print:hidden" role="search">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">De</span>
          <Input type="date" name="inicio" defaultValue={f.inicio} aria-label="De" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Até</span>
          <Input type="date" name="fim" defaultValue={f.fim} aria-label="Até" />
        </label>
        {ctx.gerente ? (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Vendedor</span>
            <Select name="vendedor" defaultValue={f.vendedor} aria-label="Vendedor">
              <option value="">Todos</option>
              {(vendedores ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4" data-testid="totais-comissoes">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Vendas com vendedor</p>
          <p className="text-lg font-semibold numero">{totais.vendas}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total vendido (base)</p>
          <p className="text-lg font-semibold numero">{formatarMoeda(totais.vendido)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Comissões</p>
          <p className="text-lg font-bold numero text-primary" data-testid="total-comissao">
            {formatarMoeda(totais.comissao)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Ainda não lançado no Contas a pagar</p>
          <p className="text-lg font-semibold numero">{formatarMoeda(totais.aLancar)}</p>
        </div>
      </div>

      {linhas.length ? (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Por vendedor</h2>
            <Table>
              <THead>
                <Tr>
                  <Th>Vendedor</Th>
                  <Th className="text-right">Vendas</Th>
                  <Th className="text-right">Vendido</Th>
                  <Th className="text-right">Comissão</Th>
                  <Th className="text-right">Já lançado</Th>
                  <Th className="text-right">A lançar</Th>
                </Tr>
              </THead>
              <TBody>
                {resumo.map((r) => (
                  <Tr key={r.vendedorId} data-testid="resumo-vendedor">
                    <Td className="font-medium">
                      {ctx.gerente ? (
                        <Link href={urlCom(base, sp, { vendedor: r.vendedorId })} className="hover:underline">
                          {r.vendedor}
                        </Link>
                      ) : (
                        r.vendedor
                      )}
                    </Td>
                    <Td className="numero text-right">{r.vendas}</Td>
                    <Td className="numero text-right">{formatarMoeda(r.vendido)}</Td>
                    <Td className="numero text-right font-semibold">{formatarMoeda(r.comissao)}</Td>
                    <Td className="numero text-right text-muted-foreground">{formatarMoeda(r.lancado)}</Td>
                    <Td className="numero text-right">{formatarMoeda(r.aLancar)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Venda a venda</h2>
            <Table>
              <THead>
                <Tr>
                  <Th>Data</Th>
                  <Th>Venda</Th>
                  <Th>Cliente</Th>
                  <Th>Vendedor</Th>
                  <Th className="text-right">Base</Th>
                  <Th className="text-right">%</Th>
                  <Th className="text-right">Comissão</Th>
                  <Th>Situação</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => (
                  <Tr key={l.vendaId} data-testid="linha-comissao">
                    <Td>{formatarData(l.data)}</Td>
                    <Td>
                      <Link href={`/e/${empresaId}/loja/vendas/${l.vendaId}`} className="hover:underline">
                        nº {l.numero}
                      </Link>
                    </Td>
                    <Td className="max-w-48 truncate text-sm text-muted-foreground">{l.cliente ?? "—"}</Td>
                    <Td>{l.vendedor}</Td>
                    <Td className="numero text-right">{formatarMoeda(l.base)}</Td>
                    <Td className="numero text-right">{l.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</Td>
                    <Td className="numero text-right font-medium">{formatarMoeda(l.valor)}</Td>
                    <Td>{l.lancada ? <Badge variante="sucesso">Lançada</Badge> : <Badge variante="neutro">A lançar</Badge>}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </section>
        </div>
      ) : (
        <EstadoVazio
          icone={HandCoins}
          titulo="Nenhuma comissão no período"
          descricao={ctx.gerente ? "Cadastre os vendedores em Vendedores e escolha o vendedor no orçamento e no caixa." : "Ainda não há vendas suas neste período."}
        />
      )}
    </>
  );
}
