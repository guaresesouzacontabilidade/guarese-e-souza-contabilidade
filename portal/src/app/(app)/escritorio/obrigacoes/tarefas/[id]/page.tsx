import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check, FileText, History, Scale } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progresso } from "@/components/ui/feedback";
import { AcoesTarefa, type DocumentoOpcao } from "@/components/obrigacoes/acoes-tarefa";
import { EtapaBadge } from "@/components/obrigacoes/tarefas";
import { hojeISO, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { descreverAplicabilidade, descreverFeriados, descreverPrazo, urgencia, type RegraObrigacao } from "@/lib/obrigacoes/regras";
import { ACAO_HISTORICO_TAREFA, ETAPAS, STATUS_TAREFA } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tarefa" };

function rotuloHistorico(acao: string, anterior: string | null, novo: string | null, detalhes: unknown) {
  if (acao === "status" && novo) return `${STATUS_TAREFA[anterior ?? ""]?.rotulo ?? "—"} → ${STATUS_TAREFA[novo]?.rotulo ?? novo}`;
  if (acao === "atualizacao" && detalhes && typeof detalhes === "object") {
    const d = detalhes as Record<string, unknown>;
    const partes: string[] = [];
    if (d.comprovante) partes.push("comprovante anexado");
    if (d.guia) partes.push("guia vinculada");
    if (d.protocolo) partes.push("protocolo informado");
    if (d.valor != null) partes.push("valor informado");
    if (d.responsavel || d.revisor) partes.push("responsáveis alterados");
    if (partes.length) return partes.join(", ").replace(/^./, (c) => c.toUpperCase());
  }
  return ACAO_HISTORICO_TAREFA[acao] ?? acao;
}

export default async function DetalheTarefa({ params }: PageProps<"/escritorio/obrigacoes/tarefas/[id]">) {
  const { id } = await params;
  const s = await exigirEquipe();
  const { data: t } = await s.supabase
    .from("tarefas")
    .select(
      "*, empresa:empresas(id, razao_social, nome_fantasia), obrigacao:obrigacoes(id, codigo, nome, descricao, periodicidade, etapas), regra:obrigacao_regras(*), guia:documentos!tarefas_guia_documento_id_fkey(id, nome_original, valor, vencimento), comprovante:documentos!tarefas_comprovante_documento_id_fkey(id, nome_original, categoria_codigo)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();
  const empresa = t.empresa as unknown as { id: string; razao_social: string; nome_fantasia: string | null };
  const obrigacao = t.obrigacao as unknown as { id: string; codigo: string; nome: string; descricao: string | null; periodicidade: string; etapas: string[] };
  const regra = t.regra as unknown as RegraObrigacao | null;
  const guia = t.guia as unknown as { id: string; nome_original: string; valor: number | null; vencimento: string | null } | null;
  const comprovante = t.comprovante as unknown as { id: string; nome_original: string; categoria_codigo: string } | null;
  const hoje = hojeISO();

  const [{ data: historico }, { data: etapas }, { data: documentos }, { data: categorias }, { data: equipe }, { data: checklist }] = await Promise.all([
    s.supabase.from("tarefa_historico").select("*").eq("tarefa_id", id).order("ocorrido_em", { ascending: false }),
    s.supabase.from("tarefas").select("id, etapa, status").eq("empresa_id", empresa.id).eq("obrigacao_id", obrigacao.id).eq("competencia", t.competencia),
    s.supabase
      .from("documentos")
      .select("id, nome_original, categoria_codigo, competencia, enviado_em, direcao")
      .eq("empresa_id", empresa.id)
      .eq("upload_status", "concluido")
      .is("excluido_em", null)
      .gte("competencia", t.competencia)
      .lte("competencia", somarMeses(t.competencia, 3))
      .order("enviado_em", { ascending: false })
      .limit(60),
    s.supabase.from("categorias_documento").select("codigo, nome"),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    s.supabase.rpc("resumo_checklist", { p_empresa_id: empresa.id, p_competencia: t.competencia }),
  ]);
  const ids = [...new Set((historico ?? []).map((h) => h.usuario_id).filter(Boolean) as string[])];
  const { data: autores } = ids.length ? await s.supabase.from("perfis").select("id, nome").in("id", ids) : { data: [] };
  const nomeAutor = new Map((autores ?? []).map((p) => [p.id, p.nome]));
  const nomesCategorias = Object.fromEntries((categorias ?? []).map((c) => [c.codigo, c.nome]));
  const nomes = new Map((equipe ?? []).map((p) => [p.id, p.nome]));
  const st = STATUS_TAREFA[t.status] ?? { rotulo: t.status, tom: "neutro" as const };
  const aberta = !["concluida", "dispensada"].includes(t.status);
  const u = urgencia(aberta ? (t.prazo_legal && t.prazo_legal < hoje ? t.prazo_legal : t.prazo_interno) : null, hoje);
  const ck = (checklist ?? {}) as { total?: number; percentual?: number | null; pendentes?: number; correcao?: number; atrasados?: number };
  const prazoDaEtapa = t.etapa === "entrega" ? regra?.prazo_entrega : t.etapa === "pagamento" ? regra?.prazo_pagamento : regra?.prazo_apuracao;
  const ordemEtapas = obrigacao.etapas.map((e) => (etapas ?? []).find((x) => x.etapa === e) ?? { id: null, etapa: e, status: null });

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: "/escritorio/obrigacoes/tarefas", rotulo: "Tarefas" }}
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {obrigacao.nome}
            <Badge variante={st.tom}>{st.rotulo}</Badge>
          </span>
        }
        descricao={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <EtapaBadge etapa={t.etapa} />·
            <Link href={`/escritorio/obrigacoes/empresas/${empresa.id}?competencia=${t.competencia.slice(0, 7)}`} className="hover:underline">
              {empresa.nome_fantasia || empresa.razao_social}
            </Link>
            · competência {formatarCompetencia(t.competencia)}
          </span>
        }
      />

      <ol className="mb-5 flex flex-wrap items-center gap-2" aria-label="Etapas da obrigação nesta competência">
        {ordemEtapas.map((e, i) => {
          const feito = e.status === "concluida" || e.status === "dispensada";
          const atual = e.id === t.id;
          const conteudo = (
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
                atual ? "border-primary bg-primary text-primary-foreground" : feito ? "border-sucesso/40 bg-sucesso-bg text-sucesso-fg" : "border-border bg-card text-muted-foreground",
              )}
            >
              {feito ? <Check className="size-3.5" /> : <span className="text-xs font-semibold">{i + 1}</span>}
              {ETAPAS[e.etapa]?.rotulo ?? e.etapa}
              {e.status ? <span className="text-xs opacity-80">· {STATUS_TAREFA[e.status]?.rotulo}</span> : <span className="text-xs opacity-80">· sem tarefa</span>}
            </span>
          );
          return (
            <li key={e.etapa} className="flex items-center gap-2">
              {i > 0 ? <span className="h-px w-4 bg-border" aria-hidden /> : null}
              {e.id && !atual ? <Link href={`/escritorio/obrigacoes/tarefas/${e.id}`}>{conteudo}</Link> : conteudo}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Prazos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Prazo interno</p>
                <p className="mt-1 text-lg font-semibold numero">{formatarData(t.prazo_interno)}</p>
                {aberta ? <p className={cn("text-xs", u.tom === "perigo" ? "text-perigo" : u.tom === "alerta" ? "text-alerta-fg" : "text-muted-foreground")}>{u.rotulo}</p> : null}
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{ETAPAS[t.etapa]?.prazo ?? "Prazo legal"}</p>
                <p className="mt-1 text-lg font-semibold numero">{t.prazo_legal ? formatarData(t.prazo_legal) : "—"}</p>
                <p className="text-xs text-muted-foreground">{t.etapa === "apuracao" ? "apuração não tem prazo legal próprio" : "prazo legal"}</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Situação</p>
                <p className="mt-1 text-lg font-semibold">{st.rotulo}</p>
                {t.concluida_em ? <p className="text-xs text-muted-foreground">em {formatarDataHora(t.concluida_em)}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Andamento</CardTitle>
              <CardDescription>Situação, comprovante e revisão. Nada é marcado como transmitido ou pago sem o documento.</CardDescription>
            </CardHeader>
            <CardContent>
              {comprovante || guia ? (
                <ul className="mb-4 space-y-2 text-sm">
                  {guia ? (
                    <li className="flex flex-wrap items-center gap-2">
                      <FileText className="size-4 text-info-fg" /> Guia:
                      <Link href={`/e/${empresa.id}/documentos/${guia.id}`} className="font-medium hover:underline">
                        {guia.nome_original}
                      </Link>
                      {guia.valor != null ? <span className="text-muted-foreground">· {formatarMoeda(guia.valor)}</span> : null}
                      {guia.vencimento ? <span className="text-muted-foreground">· vence {formatarData(guia.vencimento)}</span> : null}
                    </li>
                  ) : null}
                  {comprovante ? (
                    <li className="flex flex-wrap items-center gap-2">
                      <FileText className="size-4 text-sucesso" /> {t.etapa === "entrega" ? "Recibo" : "Comprovante"}:
                      <Link href={`/e/${empresa.id}/documentos/${comprovante.id}`} className="font-medium hover:underline">
                        {comprovante.nome_original}
                      </Link>
                      <span className="text-muted-foreground">· {nomesCategorias[comprovante.categoria_codigo] ?? comprovante.categoria_codigo}</span>
                    </li>
                  ) : null}
                  {t.protocolo ? <li className="text-muted-foreground">Protocolo/autenticação: {t.protocolo}</li> : null}
                  {t.valor != null ? <li className="text-muted-foreground">Valor: {formatarMoeda(t.valor)}</li> : null}
                  {t.dispensa_motivo && t.status === "dispensada" ? <li className="text-muted-foreground">Motivo da dispensa: {t.dispensa_motivo}</li> : null}
                </ul>
              ) : null}
              <AcoesTarefa
                tarefa={{
                  id: t.id,
                  etapa: t.etapa,
                  status: t.status,
                  responsavel_id: t.responsavel_id,
                  revisor_id: t.revisor_id,
                  concluida_por: t.concluida_por,
                  protocolo: t.protocolo,
                  valor: t.valor,
                  comprovante_documento_id: t.comprovante_documento_id,
                  guia_documento_id: t.guia_documento_id,
                }}
                empresaId={empresa.id}
                competencia={t.competencia}
                documentos={(documentos ?? []).map((d) => ({ id: d.id, nome: d.nome_original, categoria: d.categoria_codigo, competencia: d.competencia, enviado_em: d.enviado_em, direcao: d.direcao })) as DocumentoOpcao[]}
                nomesCategorias={nomesCategorias}
                equipe={equipe ?? []}
                usuarioId={s.usuarioId}
                admin={s.perfil.tipo === "admin"}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4" /> Documentos do cliente
              </CardTitle>
              <CardDescription>Checklist de {formatarCompetencia(t.competencia, true)} no portal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {ck.total ? (
                <>
                  <div className="flex items-center justify-between">
                    <span>Obrigatórios recebidos e conferidos</span>
                    <span className="font-semibold numero">{ck.percentual ?? 0}%</span>
                  </div>
                  <Progresso valor={ck.percentual ?? 0} rotulo="Checklist do mês" />
                  <p className="text-xs text-muted-foreground">
                    {ck.pendentes ? `${ck.pendentes} item(ns) ainda não enviado(s)` : "Todos os itens enviados"}
                    {ck.correcao ? ` · ${ck.correcao} com correção pedida` : ""}
                    {ck.atrasados ? ` · ${ck.atrasados} em atraso` : ""}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Sem checklist nesta competência.</p>
              )}
              <Link href={`/e/${empresa.id}/pendencias?competencia=${t.competencia.slice(0, 7)}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Ver pendências da empresa <ArrowUpRight className="size-3" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Scale className="size-4" /> Regra aplicada
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {regra ? (
                <>
                  <p>{descreverPrazo(prazoDaEtapa ?? null, obrigacao.periodicidade)}</p>
                  {prazoDaEtapa ? <p className="text-xs text-muted-foreground">{descreverFeriados(prazoDaEtapa)}</p> : null}
                  <p className="text-xs text-muted-foreground">Prazo interno: {regra.prazo_interno_dias_uteis} dia(s) útil(eis) antes, no calendário do escritório.</p>
                  <p className="text-xs text-muted-foreground">Aplica-se a: {descreverAplicabilidade(regra)}</p>
                  <p className="text-xs text-muted-foreground">
                    Vigência: {formatarCompetencia(regra.vigencia_inicio)} {regra.vigencia_fim ? `a ${formatarCompetencia(regra.vigencia_fim)}` : "em diante"}
                  </p>
                  <p className="text-xs">
                    Fonte:{" "}
                    {regra.fonte_url ? (
                      <a href={regra.fonte_url} target="_blank" rel="noreferrer" className="underline">
                        {regra.fonte_titulo}
                      </a>
                    ) : (
                      regra.fonte_titulo
                    )}{" "}
                    <span className="text-muted-foreground">(consultada em {formatarData(regra.fonte_consultada_em)})</span>
                  </p>
                  <Link href={`/escritorio/obrigacoes/catalogo/${obrigacao.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Ver no catálogo <ArrowUpRight className="size-3" />
                  </Link>
                </>
              ) : (
                <p className="text-muted-foreground">A regra que gerou esta tarefa foi removida do catálogo.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" /> Histórico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 border-l border-border pl-4">
                {(historico ?? []).map((h) => (
                  <li key={h.id} className="relative text-sm">
                    <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary/60" aria-hidden />
                    <p className="font-medium">{rotuloHistorico(h.acao, h.status_anterior, h.status_novo, h.detalhes)}</p>
                    {h.comentario ? <p className="text-muted-foreground">{h.comentario}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {formatarDataHora(h.ocorrido_em)} · {h.usuario_id ? nomeAutor.get(h.usuario_id) ?? "Equipe" : "Sistema"}
                    </p>
                  </li>
                ))}
                <li className="relative text-sm">
                  <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-muted-foreground/40" aria-hidden />
                  <p className="font-medium">Tarefa gerada</p>
                  <p className="text-xs text-muted-foreground">
                    {formatarDataHora(t.created_at)} · responsável: {t.responsavel_id ? nomes.get(t.responsavel_id) ?? "—" : "—"}
                  </p>
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
