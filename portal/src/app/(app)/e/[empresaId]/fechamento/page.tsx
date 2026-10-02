import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, CheckCircle2, History, ListChecks } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio, Progresso } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { EtapasFechamento, type EtapaFechamento } from "@/components/fechamento/etapas";
import { PendenciasFechamento, type PendenciaFechamento } from "@/components/fechamento/pendencias";
import { BotaoFecharCompetencia, BotaoIniciarFechamento, BotaoReabrirCompetencia } from "@/components/fechamento/acoes-competencia";
import { competenciaAtual, lerCompetencia, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { ACAO_HISTORICO_COMPETENCIA, ETAPAS_FECHAMENTO, STATUS_COMPETENCIA } from "@/lib/rotulos";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Fechamento" };

interface Resumo {
  total: number;
  obrigatorios: number;
  concluidos: number;
  nao_se_aplica: number;
  nao_se_aplica_solicitado: number;
  enviados: number;
  correcao: number;
  pendentes: number;
  atrasados: number;
  percentual: number | null;
  proximo_prazo: string | null;
}

type Nome = { nome: string } | null;

function detalheHistorico(detalhes: unknown): string | null {
  if (!detalhes || typeof detalhes !== "object") return null;
  const d = detalhes as Record<string, unknown>;
  for (const chave of ["justificativa", "observacao", "resolucao", "descricao"]) {
    const v = d[chave];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export default async function PaginaFechamento({ params, searchParams }: PageProps<"/e/[empresaId]/fechamento">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.gerenciar")) return <Alerta tom="alerta">Seu acesso não inclui o fechamento desta empresa.</Alerta>;
  const podeReabrir = ctx.pode("fechamento.reabrir");
  const atual = competenciaAtual();
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(atual, -1);
  const compUrl = comp.slice(0, 7);
  const rotuloComp = formatarCompetencia(comp, true);
  const base = `/e/${empresaId}/fechamento`;

  const [{ data: competencia }, { data: resumo }, { data: recentes }, docsConferir, docsAposFechamento, { data: equipe }] = await Promise.all([
    ctx.supabase
      .from("competencias")
      .select(
        "id, status, fechada_em, reaberta_em, reabertura_justificativa, observacoes, fechou:perfis!competencias_fechada_por_fkey(nome), reabriu:perfis!competencias_reaberta_por_fkey(nome)",
      )
      .eq("empresa_id", empresaId)
      .eq("competencia", comp)
      .maybeSingle(),
    ctx.supabase.rpc("resumo_checklist", { p_empresa_id: empresaId, p_competencia: comp }),
    ctx.supabase.from("competencias").select("competencia, status, fechada_em").eq("empresa_id", empresaId).order("competencia", { ascending: false }).limit(12),
    ctx.supabase
      .from("documentos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("competencia", comp)
      .eq("direcao", "cliente")
      .eq("upload_status", "concluido")
      .is("excluido_em", null)
      .in("status", ["recebido", "em_analise"]),
    ctx.supabase
      .from("documentos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("competencia", comp)
      .eq("recebido_apos_fechamento", true)
      .is("apos_fechamento_avaliado_em", null)
      .is("excluido_em", null),
    ctx.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
  ]);

  const [{ data: etapasBd }, { data: pendenciasBd }, { data: historico }] = competencia
    ? await Promise.all([
        ctx.supabase
          .from("fechamento_etapas")
          .select(
            "id, etapa, ordem, status, responsavel_id, iniciada_em, concluida_em, observacao, resp:perfis!fechamento_etapas_responsavel_id_fkey(nome), concluiu:perfis!fechamento_etapas_concluida_por_fkey(nome)",
          )
          .eq("competencia_id", competencia.id)
          .order("ordem"),
        ctx.supabase
          .from("fechamento_pendencias")
          .select(
            "id, etapa, descricao, impeditiva, visivel_cliente, status, criada_em, resolvida_em, resolucao, criou:perfis!fechamento_pendencias_criada_por_fkey(nome), resolveu:perfis!fechamento_pendencias_resolvida_por_fkey(nome)",
          )
          .eq("competencia_id", competencia.id)
          .order("criada_em", { ascending: false }),
        ctx.supabase
          .from("competencia_historico")
          .select("id, acao, etapa, detalhes, em, autor:perfis!competencia_historico_por_fkey(nome)")
          .eq("competencia_id", competencia.id)
          .order("em", { ascending: false })
          .limit(100),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const pendencias: PendenciaFechamento[] = (pendenciasBd ?? []).map((p) => ({
    id: p.id,
    etapa: p.etapa,
    descricao: p.descricao,
    impeditiva: p.impeditiva,
    visivel_cliente: p.visivel_cliente,
    status: p.status,
    criada_por: (p.criou as Nome)?.nome ?? null,
    criada_em: p.criada_em,
    resolvida_por: (p.resolveu as Nome)?.nome ?? null,
    resolvida_em: p.resolvida_em,
    resolucao: p.resolucao,
  }));
  const impeditivasAbertas = pendencias.filter((p) => p.status === "aberta" && p.impeditiva);
  const etapas: EtapaFechamento[] = (etapasBd ?? []).map((e) => ({
    id: e.id,
    etapa: e.etapa,
    ordem: e.ordem,
    status: e.status,
    responsavel_id: e.responsavel_id,
    responsavel: (e.resp as Nome)?.nome ?? null,
    iniciada_em: e.iniciada_em,
    concluida_em: e.concluida_em,
    concluida_por: (e.concluiu as Nome)?.nome ?? null,
    observacao: e.observacao,
    impeditivas: impeditivasAbertas.filter((p) => p.etapa === e.etapa).length,
  }));

  const status = competencia?.status ?? "aberta";
  const fechada = status === "fechada";
  const iniciado = etapas.length > 0;
  const stComp = STATUS_COMPETENCIA[status] ?? { rotulo: status, tom: "neutro" as const };
  const r = (resumo ?? null) as Resumo | null;
  const concluidas = etapas.filter((e) => e.status === "concluida").length;
  const percentualEtapas = iniciado ? Math.round((100 * concluidas) / etapas.length) : null;
  const etapaAtual = etapas.find((e) => e.status !== "concluida");

  // Impedimentos recusados pelo banco ao fechar, e pontos de atenção que não bloqueiam.
  const bloqueios: string[] = [];
  const etapasAbertas = etapas.filter((e) => e.etapa !== "publicacao" && e.status !== "concluida");
  if (!iniciado) bloqueios.push("O fechamento ainda não foi iniciado.");
  if (etapasAbertas.length) bloqueios.push(`Etapas não concluídas: ${etapasAbertas.map((e) => ETAPAS_FECHAMENTO[e.etapa] ?? e.etapa).join(", ")}.`);
  if (impeditivasAbertas.length) bloqueios.push(`${impeditivasAbertas.length} pendência(s) impeditiva(s) aberta(s).`);
  const avisos: string[] = [];
  if (r && r.total > 0) {
    if (r.pendentes + r.correcao > 0) avisos.push(`${r.pendentes + r.correcao} item(ns) do checklist ainda faltante(s) ou em correção.`);
    if (r.enviados > 0) avisos.push(`${r.enviados} item(ns) do checklist enviado(s) e ainda não conferido(s).`);
    if (r.nao_se_aplica_solicitado > 0) avisos.push(`${r.nao_se_aplica_solicitado} pedido(s) de “não se aplica” aguardando revisão.`);
  } else {
    avisos.push("Não há checklist de documentos para esta competência.");
  }
  if ((docsConferir.count ?? 0) > 0) avisos.push(`${docsConferir.count} documento(s) do mês aguardando conferência.`);
  const pendenciasNaoImpeditivas = pendencias.filter((p) => p.status === "aberta" && !p.impeditiva).length;
  if (pendenciasNaoImpeditivas) avisos.push(`${pendenciasNaoImpeditivas} pendência(s) não impeditiva(s) em aberto.`);

  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            Fechamento de {rotuloComp} <Badge variante={stComp.tom}>{stComp.rotulo}</Badge>
          </span>
        }
        descricao="Coleta de documentos → Conferência → Conciliação → Revisão → Publicação. A competência só fecha com as etapas concluídas e sem pendências impeditivas."
        acoes={
          <form className="flex items-center gap-2">
            <Select name="competencia" defaultValue={compUrl} aria-label="Competência" className="w-52">
              {listaCompetencias(24, 1).map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </Select>
            <Button type="submit" variante="secundario">
              Ver
            </Button>
          </form>
        }
      />

      {fechada && competencia ? (
        <Alerta
          tom="sucesso"
          className="mb-4"
          titulo={`Competência fechada em ${formatarDataHora(competencia.fechada_em)}${(competencia.fechou as Nome)?.nome ? ` por ${(competencia.fechou as Nome)!.nome}` : ""}`}
          acao={podeReabrir ? <BotaoReabrirCompetencia empresaId={empresaId} competencia={compUrl} rotulo={rotuloComp} /> : undefined}
        >
          {competencia.observacoes ? <p className="whitespace-pre-line">{competencia.observacoes}</p> : null}
          {(docsAposFechamento.count ?? 0) > 0 ? (
            <p>
              {docsAposFechamento.count} documento(s) recebido(s) após o fechamento aguardam avaliação.{" "}
              <Link className="underline" href={`/e/${empresaId}/documentos?competencia=${compUrl}`}>
                Ver documentos
              </Link>
            </p>
          ) : null}
          {!podeReabrir ? <p className="text-xs">Somente quem tem a permissão “Reabrir competência” pode reabri-la.</p> : null}
        </Alerta>
      ) : null}
      {competencia?.reaberta_em ? (
        <Alerta tom="info" className="mb-4" titulo={`Reaberta em ${formatarDataHora(competencia.reaberta_em)}${(competencia.reabriu as Nome)?.nome ? ` por ${(competencia.reabriu as Nome)!.nome}` : ""}`}>
          {competencia.reabertura_justificativa ? <p className="whitespace-pre-line">Justificativa: {competencia.reabertura_justificativa}</p> : null}
        </Alerta>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Etapas concluídas"
          valor={iniciado ? `${concluidas}/${etapas.length}` : "—"}
          detalhe={etapaAtual ? `atual: ${ETAPAS_FECHAMENTO[etapaAtual.etapa] ?? etapaAtual.etapa}` : iniciado ? "todas concluídas" : "fechamento não iniciado"}
          icone={CalendarCheck}
          tom={iniciado && concluidas === etapas.length ? "sucesso" : "neutro"}
        />
        <Indicador
          rotulo="Pendências impeditivas"
          valor={impeditivasAbertas.length}
          detalhe={pendenciasNaoImpeditivas ? `+ ${pendenciasNaoImpeditivas} não impeditiva(s)` : undefined}
          icone={AlertTriangle}
          tom={impeditivasAbertas.length ? "perigo" : "neutro"}
        />
        <Indicador
          rotulo="Checklist do mês"
          valor={r && r.total > 0 && r.percentual != null ? `${r.percentual}%` : "—"}
          detalhe={r && r.total > 0 ? `${r.concluidos} concluído(s) de ${r.total}` : "sem checklist"}
          icone={ListChecks}
          tom={r?.percentual === 100 ? "sucesso" : r && r.atrasados > 0 ? "perigo" : "neutro"}
          href={`/e/${empresaId}/pendencias?competencia=${compUrl}`}
        />
        <Indicador
          rotulo="Documentos a conferir"
          valor={docsConferir.count ?? 0}
          icone={CheckCircle2}
          tom={(docsConferir.count ?? 0) ? "info" : "neutro"}
          href={`/e/${empresaId}/documentos?competencia=${compUrl}`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Etapas do fechamento</CardTitle>
              {iniciado ? (
                <div className="space-y-1.5 pt-1">
                  <Progresso valor={percentualEtapas} rotulo="Progresso das etapas" />
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {iniciado ? (
                <EtapasFechamento empresaId={empresaId} etapas={etapas} fechada={fechada} equipe={equipe ?? []} />
              ) : (
                <EstadoVazio
                  icone={CalendarCheck}
                  titulo="Fechamento ainda não iniciado"
                  descricao={
                    comp > atual
                      ? "Esta competência ainda está em curso. Você pode iniciar o fechamento, mas o normal é fazê-lo depois do fim do mês."
                      : "Ao iniciar, as etapas são criadas e a coleta de documentos fica em andamento."
                  }
                  acao={<BotaoIniciarFechamento empresaId={empresaId} competencia={compUrl} rotulo={rotuloComp} />}
                />
              )}
            </CardContent>
          </Card>

          {competencia && iniciado ? (
            <Card>
              <CardHeader>
                <CardTitle>Pendências do fechamento</CardTitle>
                <CardDescription>Problemas encontrados pela equipe. As visíveis ao cliente aparecem nas pendências dele e geram aviso.</CardDescription>
              </CardHeader>
              <CardContent>
                <PendenciasFechamento empresaId={empresaId} competenciaId={competencia.id} pendencias={pendencias} fechada={fechada} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {!fechada ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck className="size-4" /> Fechar a competência
                </CardTitle>
                <CardDescription>
                  {bloqueios.length ? "Resolva os impedimentos abaixo para poder fechar." : "Tudo pronto: as etapas obrigatórias estão concluídas e não há pendências impeditivas."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {bloqueios.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {bloqueios.map((b) => (
                      <li key={b} className="flex gap-2 text-perigo-fg">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-perigo" /> {b}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {avisos.length ? (
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {avisos.map((a) => (
                      <li key={a} className="flex gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerta" /> {a}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {iniciado ? (
                  <BotaoFecharCompetencia empresaId={empresaId} competencia={compUrl} rotulo={rotuloComp} bloqueios={bloqueios} avisos={avisos} />
                ) : (
                  <BotaoIniciarFechamento empresaId={empresaId} competencia={compUrl} rotulo={rotuloComp} />
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-4" /> Checklist de {rotuloComp}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {r && r.total > 0 ? (
                <>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span>{r.percentual == null ? "Sem itens obrigatórios" : `${r.percentual}% dos obrigatórios`}</span>
                      <span className="text-muted-foreground">{r.total} item(ns)</span>
                    </div>
                    <Progresso valor={r.percentual} rotulo="Conclusão do checklist" />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Concluídos</dt>
                    <dd className="text-right numero">{r.concluidos}</dd>
                    <dt className="text-muted-foreground">Não se aplica</dt>
                    <dd className="text-right numero">{r.nao_se_aplica}</dd>
                    <dt className="text-muted-foreground">Enviados a conferir</dt>
                    <dd className="text-right numero">{r.enviados}</dd>
                    <dt className="text-muted-foreground">Faltantes</dt>
                    <dd className="text-right numero">{r.pendentes}</dd>
                    <dt className="text-muted-foreground">Em correção</dt>
                    <dd className="text-right numero">{r.correcao}</dd>
                    <dt className="text-muted-foreground">Atrasados</dt>
                    <dd className={r.atrasados ? "text-right font-medium text-perigo numero" : "text-right numero"}>{r.atrasados}</dd>
                    <dt className="text-muted-foreground">“Não se aplica” em revisão</dt>
                    <dd className="text-right numero">{r.nao_se_aplica_solicitado}</dd>
                  </dl>
                  {r.proximo_prazo ? <p className="text-xs text-muted-foreground">Próximo prazo: {formatarData(r.proximo_prazo)}</p> : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum item de checklist gerado para esta competência.</p>
              )}
              <Link href={`/e/${empresaId}/pendencias?competencia=${compUrl}`} className="inline-flex text-sm font-medium text-primary hover:underline">
                Abrir as pendências do mês
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" /> Histórico da competência
              </CardTitle>
            </CardHeader>
            <CardContent>
              {historico?.length ? (
                <ol className="space-y-3 text-sm">
                  {historico.map((h) => {
                    const detalhe = detalheHistorico(h.detalhes);
                    return (
                      <li key={h.id} className="border-l-2 border-border pl-3">
                        <p className="font-medium">
                          {ACAO_HISTORICO_COMPETENCIA[h.acao] ?? h.acao}
                          {h.etapa ? <span className="font-normal text-muted-foreground"> · {ETAPAS_FECHAMENTO[h.etapa] ?? h.etapa}</span> : null}
                        </p>
                        {detalhe ? <p className="whitespace-pre-line text-muted-foreground">{detalhe}</p> : null}
                        <p className="text-xs text-muted-foreground">
                          {formatarDataHora(h.em)}
                          {(h.autor as Nome)?.nome ? ` · ${(h.autor as Nome)!.nome}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum registro para esta competência.</p>
              )}
            </CardContent>
          </Card>

          {recentes?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Competências anteriores</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <tr>
                      <Th>Competência</Th>
                      <Th>Situação</Th>
                      <Th>Fechada em</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {recentes.map((c) => {
                      const st = STATUS_COMPETENCIA[c.status] ?? { rotulo: c.status, tom: "neutro" as const };
                      return (
                        <Tr key={c.competencia} className={c.competencia === comp ? "bg-muted/50" : undefined}>
                          <Td>
                            <Link href={urlCom(base, {}, { competencia: c.competencia.slice(0, 7) })} className="hover:underline">
                              {formatarCompetencia(c.competencia)}
                            </Link>
                          </Td>
                          <Td>
                            <Badge variante={st.tom}>{st.rotulo}</Badge>
                          </Td>
                          <Td className="whitespace-nowrap text-xs">{formatarData(c.fechada_em)}</Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        <Link href={urlCom(base, {}, { competencia: somarMeses(comp, -1).slice(0, 7) })} className="underline-offset-2 hover:underline">
          ← {formatarCompetencia(somarMeses(comp, -1), true)}
        </Link>
        {comp < somarMeses(atual, 1) ? (
          <>
            {" · "}
            <Link href={urlCom(base, {}, { competencia: somarMeses(comp, 1).slice(0, 7) })} className="underline-offset-2 hover:underline">
              {formatarCompetencia(somarMeses(comp, 1), true)} →
            </Link>
          </>
        ) : null}
      </p>
    </>
  );
}
