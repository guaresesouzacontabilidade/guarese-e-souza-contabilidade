import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, CheckCheck, Hand, History, Link2, Wand2 } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EtiquetaPeriodicidade } from "@/components/rh/etiqueta";
import {
  AtribuirTarefa,
  BotaoConferencia,
  ConcluirTarefa,
  DependenciasTarefa,
  EvidenciasTarefa,
  SugestoesTarefa,
} from "@/components/rh/tarefa";
import {
  carregarFuncionarios,
  iaLigada,
  obterContextoRh,
} from "@/lib/rh/dados";
import {
  REGRA,
  STATUS,
  atrasada,
  formatarDataHoraRh,
  formatarPrazo,
  rotuloPeriodo,
  segundaDaSemana,
  type Periodicidade,
  type RegraTarefa,
  type StatusTarefa,
} from "@/lib/rh/rotulos";

export const metadata: Metadata = { title: "Tarefa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIPO_EVENTO: Record<string, string> = {
  criada: "Criada",
  atribuida: "Responsável",
  status: "Andamento",
  concluida: "Concluída",
  evidencia: "Anexo",
  vinculo: "Registro ligado",
  sugestao: "Registro para confirmar",
  sugestao_confirmada: "Registro confirmado",
  sugestao_recusada: "Registro recusado",
  dependencia: "Dependência",
  aguardando: "Aguardando etapa anterior",
};

export default async function PaginaTarefa({
  params,
}: PageProps<"/e/[empresaId]/rh/tarefas/[tarefaId]">) {
  const { empresaId, tarefaId } = await params;
  if (!UUID.test(tarefaId)) notFound();
  const ctx = await obterContextoRh(empresaId);
  if (!ctx.gestor && !ctx.fazTarefas) notFound();
  const { data: t } = await ctx.supabase
    .from("rh_tarefas")
    .select(
      "id, empresa_id, modelo_id, titulo, periodicidade, periodo_inicio, periodo_fim, prazo, status, responsavel_id, concluida_em, origem_conclusao, conclusao_pendente, area, semana_referencia, observacao, iniciada_em, responsavel:escala_funcionarios(nome), quem:perfis!rh_tarefas_concluida_por_fkey(nome), modelo:rh_tarefa_modelos(titulo, descricao, regra, exige_foto, exige_area, exige_semana, cargo:rh_cargos(nome))",
    )
    .eq("id", tarefaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!t) notFound();
  type Modelo = {
    titulo: string;
    descricao: string | null;
    regra: RegraTarefa;
    exige_foto: boolean;
    exige_area: boolean;
    exige_semana: boolean;
    cargo: { nome: string } | null;
  };
  const modelo = t.modelo as unknown as Modelo;
  const periodicidade = t.periodicidade as Periodicidade;
  const status = t.status as StatusTarefa;
  const aberta = status !== "concluida";
  const regra = modelo.regra;

  const [
    eventos,
    evidencias,
    vinculos,
    deps,
    funcionarios,
    candidatas,
    extratos,
    ia,
  ] = await Promise.all([
    ctx.supabase
      .from("rh_tarefa_eventos")
      .select(
        "id, tipo, origem, detalhe, em, autor:perfis!rh_tarefa_eventos_usuario_fkey(nome)",
      )
      .eq("tarefa_id", tarefaId)
      .order("em", { ascending: false })
      .limit(100),
    ctx.supabase
      .from("rh_tarefa_evidencias")
      .select(
        "id, mime, legenda, confirmado_em, autor:perfis!rh_tarefa_evidencias_enviado_por_fkey(nome)",
      )
      .eq("tarefa_id", tarefaId)
      .not("confirmado_em", "is", null)
      .order("confirmado_em"),
    ctx.supabase
      .from("rh_tarefa_vinculos")
      .select(
        "id, tipo, registro_id, descricao, situacao, origem, ia_recomendado, ia_explicacao, criado_em, decidido_em, decisor:perfis!rh_tarefa_vinculos_decidido_por_fkey(nome)",
      )
      .eq("tarefa_id", tarefaId)
      .order("criado_em"),
    ctx.supabase
      .from("rh_tarefa_dependencias")
      .select("depende_de_id")
      .eq("tarefa_id", tarefaId),
    ctx.gestor
      ? carregarFuncionarios(ctx.supabase, empresaId)
      : Promise.resolve([]),
    ctx.gestor && aberta
      ? ctx.supabase
          .from("rh_tarefas")
          .select("id, titulo, periodicidade, periodo_inicio, periodo_fim")
          .eq("empresa_id", empresaId)
          .neq("id", tarefaId)
          .neq("status", "concluida")
          .order("prazo")
          .limit(100)
      : Promise.resolve({ data: [] }),
    regra === "envio_extrato" && aberta
      ? ctx.supabase
          .from("documentos")
          .select("id, titulo, nome_original, enviado_em")
          .eq("empresa_id", empresaId)
          .eq("categoria_codigo", "extrato_bancario")
          .is("excluido_em", null)
          .gte(
            "enviado_em",
            `${segundaDaSemana(t.periodo_inicio)}T00:00:00-03:00`,
          )
          .order("enviado_em", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
    iaLigada(),
  ]);
  const depIds = (deps.data ?? []).map((d) => d.depende_de_id);
  const { data: depTarefas } = depIds.length
    ? await ctx.supabase
        .from("rh_tarefas")
        .select(
          "id, titulo, periodicidade, periodo_inicio, periodo_fim, status",
        )
        .in("id", depIds)
    : {
        data: [] as {
          id: string;
          titulo: string;
          periodicidade: string;
          periodo_inicio: string;
          periodo_fim: string;
          status: string;
        }[],
      };
  const dependencias = (depTarefas ?? []).map((d) => ({
    id: d.id,
    titulo: d.titulo,
    periodo: rotuloPeriodo(
      d.periodicidade as Periodicidade,
      d.periodo_inicio,
      d.periodo_fim,
    ),
    concluida: d.status === "concluida",
  }));
  const abertasDep = [
    ...dependencias.filter((d) => !d.concluida).map((d) => d.titulo),
    ...(depIds.length > dependencias.length ? ["tarefa de outra pessoa"] : []),
  ];
  type Vinculo = {
    id: string;
    tipo: string;
    registro_id: string | null;
    descricao: string;
    situacao: string;
    origem: string;
    ia_recomendado: boolean;
    ia_explicacao: string | null;
    criado_em: string;
    decidido_em: string | null;
    decisor: { nome: string } | null;
  };
  const lista = (vinculos.data ?? []) as unknown as Vinculo[];
  const sugestoes = lista.filter((v) => v.situacao === "sugerido");
  const ligados = lista.filter((v) => v.situacao === "confirmado");
  const fotos = (
    (evidencias.data ?? []) as unknown as {
      id: string;
      mime: string;
      legenda: string | null;
      confirmado_em: string;
      autor: { nome: string } | null;
    }[]
  ).map((e) => ({
    id: e.id,
    mime: e.mime,
    legenda: e.legenda,
    enviado_em: formatarDataHoraRh(e.confirmado_em),
    autor: e.autor?.nome ?? null,
  }));
  const podeAgir = ctx.gestor || ctx.fazTarefas;
  const manual = regra === "manual" || regra === "envio_extrato";
  const base = `/e/${empresaId}`;
  const linkDoRegistro = (v: Vinculo) =>
    !ctx.gestor
      ? null
      : v.tipo === "caixa_sessao" && v.registro_id
        ? `${base}/loja/caixa/${v.registro_id}`
        : v.tipo === "conciliacao_semana"
          ? `${base}/conciliacao`
          : v.tipo === "documento" && v.registro_id
            ? `/api/documentos/${v.registro_id}/arquivo`
            : null;
  const quem = (t.quem as unknown as { nome: string } | null)?.nome;

  return (
    <>
      <CabecalhoPagina
        titulo={t.titulo}
        descricao={rotuloPeriodo(
          periodicidade,
          t.periodo_inicio,
          t.periodo_fim,
        )}
        voltar={{
          href: `${base}/rh/tarefas`,
          rotulo: ctx.gestor ? "Tarefas" : "Minhas tarefas",
        }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              <Dado rotulo="Situação">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge
                    variante={
                      aberta
                        ? atrasada({ status, prazo: t.prazo })
                          ? "perigo"
                          : "info"
                        : "sucesso"
                    }
                  >
                    {STATUS[status].rotulo}
                    {aberta && atrasada({ status, prazo: t.prazo })
                      ? " · atrasada"
                      : ""}
                  </Badge>
                  <EtiquetaPeriodicidade periodicidade={periodicidade} />
                </span>
              </Dado>
              <Dado rotulo="Prazo">{formatarDataHoraRh(t.prazo)}</Dado>
              <Dado rotulo="Responsável">
                {ctx.gestor && aberta ? (
                  <AtribuirTarefa
                    empresaId={empresaId}
                    tarefaId={t.id}
                    atual={t.responsavel_id}
                    funcionarios={funcionarios
                      .filter((f) => f.ativo)
                      .map((f) => ({ id: f.id, nome: f.nome }))}
                  />
                ) : (
                  ((t.responsavel as unknown as { nome: string } | null)
                    ?.nome ?? "Sem responsável")
                )}
              </Dado>
              <Dado rotulo="Cargo">{modelo.cargo?.nome ?? "—"}</Dado>
              <Dado rotulo="Como conclui" className="sm:col-span-2">
                <span className="flex items-start gap-1.5">
                  {REGRA[regra].automatica ? (
                    <Wand2
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  ) : (
                    <Hand
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span>
                    {REGRA[regra].rotulo}. {REGRA[regra].ajuda}
                    {manual &&
                    (modelo.exige_foto ||
                      modelo.exige_area ||
                      modelo.exige_semana ||
                      regra === "envio_extrato")
                      ? ` Exige: ${[modelo.exige_foto && "foto", modelo.exige_area && "área", (modelo.exige_semana || regra === "envio_extrato") && "semana de referência"].filter(Boolean).join(", ")}.`
                      : ""}
                  </span>
                </span>
              </Dado>
              {modelo.descricao ? (
                <Dado rotulo="Como fazer" className="sm:col-span-2">
                  <span className="whitespace-pre-line">
                    {modelo.descricao}
                  </span>
                </Dado>
              ) : null}
            </CardContent>
          </Card>

          {!aberta ? (
            <Card data-testid="rh-conclusao">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCheck className="size-5 text-sucesso" /> Conclusão
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Dado rotulo="Quando">
                  {t.concluida_em ? formatarDataHoraRh(t.concluida_em) : "—"}
                </Dado>
                <Dado rotulo="Quem">
                  {quem ??
                    (t.origem_conclusao === "automatica"
                      ? "Registro do sistema"
                      : "—")}
                </Dado>
                <Dado rotulo="Origem">
                  {t.origem_conclusao === "automatica"
                    ? "Automática (registro do sistema)"
                    : "Manual"}
                </Dado>
                {t.semana_referencia ? (
                  <Dado rotulo="Semana de referência">
                    {rotuloPeriodo(
                      "semanal",
                      t.semana_referencia,
                      addDias(t.semana_referencia, 6),
                    )}
                  </Dado>
                ) : null}
                {t.area ? <Dado rotulo="Área">{t.area}</Dado> : null}
                {t.observacao ? (
                  <Dado rotulo="Observação" className="sm:col-span-2">
                    {t.observacao}
                  </Dado>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {aberta && podeAgir && sugestoes.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="size-5" /> Registro para confirmar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SugestoesTarefa
                  empresaId={empresaId}
                  iaLigada={ia}
                  sugestoes={sugestoes.map((s) => ({
                    id: s.id,
                    descricao: s.descricao,
                    ia_recomendado: s.ia_recomendado,
                    ia_explicacao: s.ia_explicacao,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

          {aberta && podeAgir && regra === "conferencia_estoque" ? (
            <Card id="concluir">
              <CardHeader>
                <CardTitle>Confirmar a conferência</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Depois de conferir o estoque, clique no botão. O portal
                  registra quem conferiu e quando e conclui esta tarefa.
                </p>
                <BotaoConferencia empresaId={empresaId} />
              </CardContent>
            </Card>
          ) : null}

          {aberta && podeAgir && manual ? (
            <Card id="concluir">
              <CardHeader>
                <CardTitle>Concluir</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    {modelo.exige_foto
                      ? "Foto (obrigatória)"
                      : "Anexos (opcional)"}
                  </h3>
                  <EvidenciasTarefa
                    empresaId={empresaId}
                    tarefaId={t.id}
                    evidencias={fotos}
                    podeEnviar
                  />
                </div>
                <ConcluirTarefa
                  empresaId={empresaId}
                  tarefaId={t.id}
                  periodoInicio={t.periodo_inicio}
                  exigeArea={modelo.exige_area}
                  exigeSemana={modelo.exige_semana}
                  exigeFoto={modelo.exige_foto}
                  temFoto={fotos.some((f) => f.mime.startsWith("image/"))}
                  extratos={
                    regra === "envio_extrato"
                      ? (
                          (extratos.data ?? []) as {
                            id: string;
                            titulo: string | null;
                            nome_original: string;
                            enviado_em: string | null;
                          }[]
                        ).map((d) => ({
                          id: d.id,
                          nome: `${d.titulo || d.nome_original}${d.enviado_em ? ` (enviado ${formatarPrazo(d.enviado_em)})` : ""}`,
                        }))
                      : undefined
                  }
                  bloqueio={abertasDep.length ? abertasDep.join(", ") : null}
                />
              </CardContent>
            </Card>
          ) : null}

          {aberta &&
          REGRA[regra].automatica &&
          regra !== "conferencia_estoque" ? (
            <Card>
              <CardContent className="flex items-start gap-3 pt-5 text-sm">
                <Bot
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <p>
                  {regra === "fechamento_caixa"
                    ? "Esta tarefa conclui sozinha quando o caixa deste dia é fechado no portal (Loja → Caixa do dia)."
                    : "Esta tarefa conclui sozinha quando todos os movimentos do extrato desta semana estiverem conciliados (Financeiro → Conciliação)."}
                  {t.conclusao_pendente
                    ? " O registro já confere; falta concluir a etapa anterior."
                    : ""}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {(!aberta || !manual) && fotos.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Evidências</CardTitle>
              </CardHeader>
              <CardContent>
                <EvidenciasTarefa
                  empresaId={empresaId}
                  tarefaId={t.id}
                  evidencias={fotos}
                  podeEnviar={false}
                />
              </CardContent>
            </Card>
          ) : null}

          {ligados.length ? (
            <Card data-testid="rh-registros">
              <CardHeader>
                <CardTitle>Registros ligados</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {ligados.map((v) => {
                    const href = linkDoRegistro(v);
                    return (
                      <li
                        key={v.id}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        {href ? (
                          <Link
                            href={href}
                            className="font-medium hover:underline"
                            target={
                              v.tipo === "documento" ? "_blank" : undefined
                            }
                          >
                            {v.descricao}
                          </Link>
                        ) : (
                          <span className="font-medium">{v.descricao}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {v.origem === "manual"
                            ? `Confirmado por ${v.decisor?.nome ?? "—"}`
                            : "Ligado automaticamente"}{" "}
                          em {formatarDataHoraRh(v.decidido_em ?? v.criado_em)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Depende de</CardTitle>
            </CardHeader>
            <CardContent>
              <DependenciasTarefa
                empresaId={empresaId}
                tarefaId={t.id}
                dependencias={dependencias}
                podeEditar={ctx.gestor && aberta}
                candidatas={(
                  (candidatas.data ?? []) as {
                    id: string;
                    titulo: string;
                    periodicidade: string;
                    periodo_inicio: string;
                    periodo_fim: string;
                  }[]
                )
                  .filter((c) => !depIds.includes(c.id))
                  .map((c) => ({
                    id: c.id,
                    titulo: c.titulo,
                    periodo: rotuloPeriodo(
                      c.periodicidade as Periodicidade,
                      c.periodo_inicio,
                      c.periodo_fim,
                    ),
                  }))}
              />
            </CardContent>
          </Card>
          <Card data-testid="rh-historico">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-5" /> Histórico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {(
                  (eventos.data ?? []) as unknown as {
                    id: number;
                    tipo: string;
                    origem: string;
                    detalhe: string | null;
                    em: string;
                    autor: { nome: string } | null;
                  }[]
                ).map((e) => (
                  <li
                    key={e.id}
                    className="border-l-2 border-border pl-3 text-sm"
                  >
                    <p className="font-medium">
                      {TIPO_EVENTO[e.tipo] ?? e.tipo}
                      {e.tipo === "concluida" ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          ·{" "}
                          {e.origem === "automatica" ? "automática" : "manual"}
                        </span>
                      ) : null}
                    </p>
                    {e.detalhe ? (
                      <p className="text-muted-foreground">{e.detalhe}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {formatarDataHoraRh(e.em)}
                      {e.autor?.nome
                        ? ` · ${e.autor.nome}`
                        : e.origem === "sistema"
                          ? " · sistema"
                          : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function addDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function Dado({
  rotulo,
  children,
  className,
}: {
  rotulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
