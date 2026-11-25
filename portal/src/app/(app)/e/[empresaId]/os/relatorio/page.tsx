import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AjustarEstimativa, BaixarCsv, GraficoDias, GraficoServicos } from "@/components/os/relatorio";
import { parametro } from "@/lib/busca";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora } from "@/lib/formatos";
import { montarRelatorio, type ItemRelatorio, type OrdemRelatorio } from "@/lib/os/relatorio";
import { entregaPrevista, formatarMinutos } from "@/lib/os/rotulos";

export const metadata: Metadata = { title: "Relatório das ordens de serviço" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (m: number | null) => (m === null ? "—" : formatarMinutos(m));

export default async function RelatorioOs({ params, searchParams }: PageProps<"/e/[empresaId]/os/relatorio">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("os.gerenciar")) return <Alerta tom="alerta">Só quem gerencia as ordens de serviço vê o relatório.</Alerta>;

  const hoje = new Date(new Date().getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const inicio = DATA.test(parametro(sp, "inicio")) ? parametro(sp, "inicio") : `${hoje.slice(0, 8)}01`;
  let fim = DATA.test(parametro(sp, "fim")) ? parametro(sp, "fim") : hoje;
  if (fim < inicio) fim = inicio;
  const de = `${inicio}T00:00:00-03:00`;
  const ate = new Date(new Date(`${fim}T00:00:00-03:00`).getTime() + 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const entre = (c: string) => `and(${c}.gte."${de}",${c}.lt."${ate}")`;
  const filtro = ["aberta_em", "pronta_em", "entregue_em", "cancelada_em"].map(entre).join(",");
  const [{ data: ordens, error }, { data: servicos }, { data: equipe }] = await Promise.all([
    ctx.supabase.from("os_ordens").select("*").eq("empresa_id", empresaId).or(filtro).order("numero").limit(5000),
    ctx.supabase.from("os_servicos").select("id, nome, unidade, minutos_por_unidade, minutos_fixos").eq("empresa_id", empresaId),
    ctx.supabase.from("os_equipe").select("id, nome").eq("empresa_id", empresaId),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível montar o relatório.</Alerta>;
  const ids = (ordens ?? []).map((o) => o.id);
  const itens: ItemRelatorio[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await ctx.supabase.from("os_itens").select("ordem_id, servico_id, descricao, quantidade, unidade, minutos_estimados").in("ordem_id", ids.slice(i, i + 300));
    itens.push(...((data ?? []) as ItemRelatorio[]));
  }
  const r = montarRelatorio({ ordens: (ordens ?? []) as OrdemRelatorio[], itens, servicos: servicos ?? [], equipe: equipe ?? [] }, inicio, fim);
  const nomes = new Map((equipe ?? []).map((e) => [e.id, e.nome]));
  const csv: (string | number)[][] = [
    ["OS", "Cliente", "Responsável", "Aberta em", "Iniciada em", "Pronta em", "Entregue em", "Estimado (min)", "Execução (min)", "Pausas (min)", "No prazo", "Valor (R$)"],
    ...r.concluidasLista.map((o) => {
      const limite = entregaPrevista(o);
      return [
        o.numero,
        o.cliente_nome,
        o.responsavel_id ? (nomes.get(o.responsavel_id) ?? "") : "",
        formatarDataHora(o.aberta_em),
        formatarDataHora(o.iniciada_em),
        formatarDataHora(o.pronta_em),
        formatarDataHora(o.entregue_em),
        String(Number(o.minutos_estimados)).replace(".", ","),
        String(Number(o.minutos_execucao)).replace(".", ","),
        String(Number(o.minutos_pausa)).replace(".", ","),
        limite ? (new Date(o.pronta_em!).getTime() <= new Date(limite).getTime() ? "sim" : "não") : "",
        String(Number(o.valor_total)).replace(".", ","),
      ];
    }),
  ];

  return (
    <>
      <CabecalhoPagina
        titulo="Relatório das ordens de serviço"
        descricao="Tempos de cada etapa, estimado × real, entregas no prazo e desempenho da equipe no período."
        voltar={{ href: `/e/${empresaId}/os`, rotulo: "Esteira de serviços" }}
        acoes={
          <>
            <form className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                De
                <Input type="date" name="inicio" defaultValue={inicio} className="mt-1 w-40" />
              </label>
              <label className="text-xs text-muted-foreground">
                Até
                <Input type="date" name="fim" defaultValue={fim} className="mt-1 w-40" />
              </label>
              <Button type="submit" variante="contorno">
                Ver
              </Button>
            </form>
            <BaixarCsv linhas={csv} nome={`os-${inicio}-a-${fim}.csv`} />
          </>
        }
      />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="os-indicadores">
          <Indicador rotulo="OS abertas" valor={r.abertas} detalhe={`${r.canceladas} cancelada(s)`} />
          <Indicador rotulo="Concluídas" valor={r.concluidas} detalhe={`${r.entregues} entregue(s) · ${formatarMoeda(r.valorConcluido)}`} tom="sucesso" />
          <Indicador
            rotulo="Entregues no prazo"
            valor={r.percentualNoPrazo === null ? "—" : `${r.percentualNoPrazo}%`}
            detalhe={`${r.noPrazo} de ${r.comPrazo} com prazo ou previsão`}
            tom={r.percentualNoPrazo === null ? "neutro" : r.percentualNoPrazo >= 90 ? "sucesso" : r.percentualNoPrazo >= 70 ? "alerta" : "perigo"}
          />
          <Indicador
            rotulo="Real × estimado"
            valor={r.desvioPercentual === null ? "—" : `${r.desvioPercentual > 0 ? "+" : ""}${r.desvioPercentual}%`}
            detalhe={`${formatarMinutos(r.realTotal)} reais × ${formatarMinutos(r.estimadoTotal)} estimados`}
            tom={r.desvioPercentual === null ? "neutro" : Math.abs(r.desvioPercentual) <= 10 ? "sucesso" : Math.abs(r.desvioPercentual) <= 25 ? "alerta" : "perigo"}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tempo médio de cada etapa</CardTitle>
            <CardDescription>Das OS que ficaram prontas no período (a execução não conta as pausas).</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {[
                ["Na fila", r.mediaFila],
                ["Execução", r.mediaExecucao],
                ["Pausas", r.mediaPausa],
                ["Esperando retirada", r.mediaAguardandoRetirada],
                ["Total (abertura até pronta)", r.mediaTotal],
              ].map(([rotulo, v]) => (
                <div key={rotulo as string} className="rounded-xl bg-muted/50 p-3">
                  <dt className="text-xs text-muted-foreground">{rotulo}</dt>
                  <dd className="text-lg font-semibold">{fmt(v as number | null)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {r.abertas || r.concluidas ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>OS por dia</CardTitle>
              </CardHeader>
              <CardContent>
                <GraficoDias dias={r.porDia} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Estimado × real por serviço</CardTitle>
              </CardHeader>
              <CardContent>{r.porServico.length ? <GraficoServicos linhas={r.porServico} /> : <p className="text-sm text-muted-foreground">Sem OS concluídas no período.</p>}</CardContent>
            </Card>
          </div>
        ) : (
          <EstadoVazio titulo="Nenhuma OS no período" descricao="Escolha outro período ou abra as primeiras OS na esteira." />
        )}

        {r.porServico.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Serviços</CardTitle>
              <CardDescription>O tempo real de cada OS é dividido entre os serviços pela proporção do estimado. Com 3 OS ou mais e diferença acima de 20%, o portal sugere ajustar.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <Tr>
                    <Th>Serviço</Th>
                    <Th className="text-right">OS</Th>
                    <Th className="text-right">Quantidade</Th>
                    <Th className="text-right">Estimado</Th>
                    <Th className="text-right">Real</Th>
                    <Th className="text-right">Diferença</Th>
                    <Th>Por unidade</Th>
                  </Tr>
                </THead>
                <TBody>
                  {r.porServico.map((s) => (
                    <Tr key={s.chave}>
                      <Td className="font-medium">{s.nome}</Td>
                      <Td className="text-right">{s.ordens}</Td>
                      <Td className="text-right">
                        {String(Math.round(s.quantidade * 100) / 100).replace(".", ",")} {s.unidade}
                      </Td>
                      <Td className="text-right">{formatarMinutos(s.minutosEstimados)}</Td>
                      <Td className="text-right">{formatarMinutos(s.minutosReais)}</Td>
                      <Td className={`text-right ${s.desvioPercentual !== null && Math.abs(s.desvioPercentual) > 20 ? "font-semibold text-perigo" : ""}`}>
                        {s.desvioPercentual === null ? "—" : `${s.desvioPercentual > 0 ? "+" : ""}${s.desvioPercentual}%`}
                      </Td>
                      <Td className="text-sm">
                        {s.realPorUnidade !== null && s.estimadoPorUnidade !== null ? (
                          <span className="text-muted-foreground">
                            real {String(s.realPorUnidade).replace(".", ",")} × estimado {String(s.estimadoPorUnidade).replace(".", ",")} min/{s.unidade}
                          </span>
                        ) : (
                          "—"
                        )}
                        {s.sugestaoPorUnidade !== null ? (
                          <div className="mt-1">
                            <AjustarEstimativa empresaId={empresaId} servicoId={s.chave} sugestao={s.sugestaoPorUnidade} unidade={s.unidade} />
                          </div>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {r.porResponsavel.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Equipe</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <Tr>
                    <Th>Responsável</Th>
                    <Th className="text-right">Concluídas</Th>
                    <Th className="text-right">Horas trabalhadas</Th>
                    <Th className="text-right">Média por OS</Th>
                    <Th className="text-right">Real × estimado</Th>
                    <Th className="text-right">No prazo</Th>
                  </Tr>
                </THead>
                <TBody>
                  {r.porResponsavel.map((p) => (
                    <Tr key={p.id ?? "sem"}>
                      <Td className="font-medium">{p.nome}</Td>
                      <Td className="text-right">{p.concluidas}</Td>
                      <Td className="text-right">{formatarMinutos(p.minutosExecucao)}</Td>
                      <Td className="text-right">{formatarMinutos(p.mediaExecucao)}</Td>
                      <Td className="text-right">
                        {p.minutosEstimados > 0 ? `${Math.round(((p.minutosExecucao - p.minutosEstimados) / p.minutosEstimados) * 100) > 0 ? "+" : ""}${Math.round(((p.minutosExecucao - p.minutosEstimados) / p.minutosEstimados) * 100)}%` : "—"}
                      </Td>
                      <Td className="text-right">{p.comPrazo ? `${Math.round((p.noPrazo / p.comPrazo) * 100)}%` : "—"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
