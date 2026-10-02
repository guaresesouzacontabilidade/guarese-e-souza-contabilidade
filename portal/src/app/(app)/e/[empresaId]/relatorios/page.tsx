import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, FileDown, FilePlus2, FileSpreadsheet, Landmark, Scale, TrendingUp, Wallet } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CartoesSaude } from "@/components/relatorios/cartoes-saude";
import { GraficoComposicao, GraficoEvolucao, GraficoProjecao, GraficoSaldoMensal } from "@/components/relatorios/graficos";
import { SeletorPeriodo } from "@/components/relatorios/seletor-periodo";
import { carregarPainel } from "@/lib/relatorios/dados";
import { lerPeriodo, opcoesPeriodo } from "@/lib/relatorios/periodo";
import { parametro } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { TIPOS_CONTA } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Saúde financeira" };

function Variacao({ atual, anterior, inverso = false }: { atual: string; anterior: string; inverso?: boolean }) {
  const a = dec(atual);
  const b = dec(anterior);
  if (b.isZero()) return null;
  const v = a.minus(b).dividedBy(b.abs()).times(100);
  if (v.abs().lessThan(0.5)) return <span className="text-muted-foreground">estável</span>;
  const bom = inverso ? v.lessThan(0) : v.greaterThan(0);
  const Icone = v.greaterThan(0) ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={bom ? "text-sucesso" : "text-perigo"}>
      <Icone className="inline size-3.5" aria-hidden /> {v.abs().toFixed(0)}%
    </span>
  );
}

export default async function SaudeFinanceira({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) redirect(`/e/${empresaId}/relatorios/publicados`);
  const hoje = hojeISO();
  const periodo = lerPeriodo(parametro(sp, "periodo"), hoje);
  const painel = await carregarPainel(ctx.supabase, empresaId, periodo, hoje);
  const t = painel.dre.totais;
  const ta = painel.dreAnterior.totais;
  const gastos = dec(t.receita_bruta.total).minus(t.resultado_liquido.total);
  const gastosAnt = dec(ta.receita_bruta.total).minus(ta.resultado_liquido.total);
  const resultado = dec(t.resultado_liquido.total);
  const q = painel.dadosSaude.qualidade;
  const exportar = (formato: string) => `/api/relatorios/exportar?empresa=${empresaId}&tipo=painel&periodo=${periodo.chave}&formato=${formato}`;
  const temDados = !dec(t.receita_bruta.total).isZero() || !gastos.isZero() || painel.evolucao.some((e) => e.receita || e.gastos);

  return (
    <>
      <CabecalhoPagina
        titulo="Saúde financeira"
        descricao="Como a empresa está: resultado, caixa, contas a pagar e a receber — com explicações em linguagem simples."
        acoes={
          <>
            <Button asChild variante="contorno">
              <a href={exportar("pdf")}>
                <FileDown /> PDF
              </a>
            </Button>
            <Button asChild variante="contorno">
              <a href={exportar("xlsx")}>
                <FileSpreadsheet /> Excel
              </a>
            </Button>
            {ctx.pode("relatorios.publicar") ? (
              <Button asChild>
                <Link href={`/e/${empresaId}/relatorios/publicados/novo?periodo=${periodo.chave}`}>
                  <FilePlus2 /> Preparar relatório para o cliente
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SeletorPeriodo valor={periodo.chave} opcoes={opcoesPeriodo(hoje)} />
        <p className="text-sm text-muted-foreground">
          {periodo.rotulo} · comparado com {periodo.anterior.rotulo}
        </p>
      </div>

      {q.competenciasFechadas ? (
        <Alerta tom="sucesso" className="mb-5" titulo="Período fechado e revisado pelo escritório">
          Os números deste período foram conferidos.
        </Alerta>
      ) : (
        <Alerta tom="info" className="mb-5" titulo="Números preliminares">
          O período ainda não foi fechado pelo escritório: os valores podem mudar conforme documentos, extratos e conciliações forem concluídos.
        </Alerta>
      )}

      {!temDados ? (
        <Alerta tom="alerta" className="mb-5" titulo="Ainda não há movimento financeiro neste período">
          Os indicadores aparecem quando houver vendas, despesas e pagamentos confirmados.{" "}
          <Link className="underline" href={`/e/${empresaId}/financeiro`}>
            Ir para o financeiro
          </Link>
        </Alerta>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador
          rotulo="Receitas"
          valor={formatarMoeda(t.receita_bruta.total)}
          icone={TrendingUp}
          detalhe={
            <>
              <Variacao atual={t.receita_bruta.total} anterior={ta.receita_bruta.total} /> vs {periodo.anterior.rotulo}
            </>
          }
          href={`/e/${empresaId}/relatorios/dre?periodo=${periodo.chave}`}
        />
        <Indicador
          rotulo="Custos e despesas"
          valor={formatarMoeda(gastos)}
          icone={Scale}
          detalhe={
            <>
              <Variacao atual={gastos.toFixed(2)} anterior={gastosAnt.toFixed(2)} inverso /> vs {periodo.anterior.rotulo}
            </>
          }
          href={`/e/${empresaId}/relatorios/dre?periodo=${periodo.chave}`}
        />
        <Indicador
          rotulo={resultado.lessThan(0) ? "Prejuízo" : "Lucro"}
          valor={formatarMoeda(resultado)}
          tom={resultado.lessThan(0) ? "perigo" : "sucesso"}
          icone={Wallet}
          detalhe={
            dec(t.receita_bruta.total).isZero() ? undefined : (
              <>Margem de {resultado.dividedBy(dec(t.receita_bruta.total)).times(100).toFixed(1).replace(".", ",")}%</>
            )
          }
        />
        <Indicador
          rotulo="Saldo disponível hoje"
          valor={formatarMoeda(painel.saldoHoje)}
          icone={Landmark}
          tom={dec(painel.saldoHoje).lessThan(0) ? "perigo" : "neutro"}
          detalhe={`Previsto em 30 dias: ${formatarMoeda(painel.projecao.janelas[0]?.saldo ?? painel.saldoHoje)}`}
          href={`/e/${empresaId}/relatorios/fluxo?periodo=${periodo.chave}`}
        />
      </div>

      <section className="mb-6 space-y-3" aria-labelledby="t-saude">
        <h2 id="t-saude" className="text-base font-semibold">
          Indicadores de saúde
        </h2>
        <CartoesSaude indicadores={painel.indicadores} />
      </section>

      <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="t-resumo">
        <h2 id="t-resumo" className="text-base font-semibold">
          Resumo do período
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">Texto montado automaticamente a partir dos números do portal (sem inteligência artificial).</p>
        <div className="space-y-2 text-sm leading-relaxed">
          {painel.resumo.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </section>

      <div className="mb-6 grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <GraficoEvolucao dados={painel.evolucao} />
        <GraficoProjecao pontos={painel.projecao.pontos} />
        <GraficoComposicao dados={painel.composicao} />
        <GraficoSaldoMensal dados={painel.evolucao} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="space-y-2" aria-labelledby="t-clientes">
          <h2 id="t-clientes" className="text-base font-semibold">
            Principais clientes do período
          </h2>
          {painel.clientes.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Cliente</Th>
                  <Th className="text-right">Receita</Th>
                  <Th className="text-right">Participação</Th>
                </tr>
              </THead>
              <TBody>
                {painel.clientes.map((c) => (
                  <Tr key={c.nome}>
                    <Td className="max-w-[16rem] truncate">{c.nome}</Td>
                    <Td className="whitespace-nowrap text-right numero">{formatarMoeda(c.valor)}</Td>
                    <Td className="text-right numero">{c.percentual.toFixed(1).replace(".", ",")}%</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Sem receitas no período.</p>
          )}
          {painel.clientes[0] && painel.clientes[0].percentual >= 40 && painel.clientes[0].nome !== "Vendas sem cliente identificado" ? (
            <p className="text-xs text-alerta-fg">
              Um único cliente representa {painel.clientes[0].percentual.toFixed(0)}% da receita. Depender de poucos clientes aumenta o risco.
            </p>
          ) : null}
        </section>
        <section className="space-y-2" aria-labelledby="t-contas">
          <h2 id="t-contas" className="text-base font-semibold">
            Onde está o dinheiro hoje
          </h2>
          <Table>
            <THead>
              <tr>
                <Th>Conta</Th>
                <Th className="text-right">Saldo</Th>
                <Th>Conciliado até</Th>
              </tr>
            </THead>
            <TBody>
              {painel.contas.map((c) => (
                <Tr key={c.conta_id}>
                  <Td className="max-w-[14rem]">
                    <p className="truncate">{c.nome}</p>
                    <p className="text-xs text-muted-foreground">{TIPOS_CONTA[c.tipo] ?? c.tipo}</p>
                  </Td>
                  <Td className={`whitespace-nowrap text-right numero ${c.saldo_sistema !== null && c.saldo_sistema < 0 ? "text-perigo" : ""}`}>
                    {c.saldo_sistema === null ? "—" : formatarMoeda(c.saldo_sistema)}
                  </Td>
                  <Td className="text-sm">
                    {c.conciliado_ate ? formatarData(c.conciliado_ate) : "—"}
                    {c.movimentos_pendentes ? <span className="block text-xs text-alerta-fg">{c.movimentos_pendentes} pendente(s)</span> : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      </div>
    </>
  );
}
