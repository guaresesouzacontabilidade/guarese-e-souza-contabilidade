import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, CalendarClock, FileCheck2, FolderOpen, ListChecks, MessagesSquare, Upload } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progresso } from "@/components/ui/feedback";
import { competenciaAtual, hojeISO, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { STATUS_CHECKLIST, STATUS_DOCUMENTO } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Visão geral" };

export default async function VisaoGeralEmpresa({ params }: PageProps<"/e/[empresaId]">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const { acesso, sessao } = ctx;
  const hoje = hojeISO();
  const comp = somarMeses(competenciaAtual(), -1);
  const verDocs = ctx.pode("documentos.ver");

  const [resumo, itens, recebidos, doEscritorio, conversas] = await Promise.all([
    verDocs ? ctx.supabase.rpc("resumo_checklist", { p_empresa_id: empresaId, p_competencia: comp }) : Promise.resolve({ data: null }),
    verDocs
      ? ctx.supabase
          .from("checklist_itens")
          .select("id, titulo, prazo, status, competencia")
          .eq("empresa_id", empresaId)
          .in("status", ["pendente", "correcao"])
          .order("prazo")
          .limit(6)
      : Promise.resolve({ data: [] }),
    verDocs
      ? ctx.supabase
          .from("documentos")
          .select("id, nome_original, titulo, status, enviado_em, competencia")
          .eq("empresa_id", empresaId)
          .eq("direcao", "cliente")
          .eq("upload_status", "concluido")
          .is("excluido_em", null)
          .is("zip_origem_id", null)
          .order("enviado_em", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    verDocs
      ? ctx.supabase
          .from("documentos")
          .select("id, nome_original, titulo, vencimento, valor, publicado_em")
          .eq("empresa_id", empresaId)
          .eq("direcao", "escritorio")
          .not("publicado_em", "is", null)
          .is("excluido_em", null)
          .order("publicado_em", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    ctx.pode("mensagens.usar")
      ? ctx.supabase.from("conversas").select("id, assunto, aguardando, ultima_mensagem_em").eq("empresa_id", empresaId).eq("status", "aberta").order("ultima_mensagem_em", { ascending: false }).limit(4)
      : Promise.resolve({ data: [] }),
  ]);

  const r = resumo.data as { total: number; percentual: number | null; pendentes: number; atrasados: number; correcao: number; enviados: number; concluidos: number } | null;
  const primeiroNome = sessao.perfil.nome.split(" ")[0];
  const nomeEmpresa = acesso.nome_fantasia ?? acesso.razao_social;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{ctx.equipe ? "Empresa" : `Olá, ${primeiroNome}!`}</p>
          <h1 className="truncate text-xl font-bold text-titulo sm:text-2xl">{nomeEmpresa}</h1>
          <p className="text-sm text-muted-foreground">
            {acesso.razao_social !== nomeEmpresa ? `${acesso.razao_social} · ` : ""}
            {formatarDocumento(acesso.documento)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ctx.pode("documentos.enviar") ? (
            <Button asChild tamanho="lg">
              <Link href={`/e/${empresaId}/enviar`}>
                <Upload /> Enviar documentos
              </Link>
            </Button>
          ) : null}
          {ctx.equipe ? (
            <Button asChild variante="contorno" tamanho="lg">
              <Link href={`/escritorio/empresas/${empresaId}`}>
                <Building2 /> Cadastro
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        {verDocs ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-4" /> Pendências
              </CardTitle>
              <CardDescription>Documentos que o escritório precisa receber. Progresso de {formatarCompetencia(comp, true)}:</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {r && r.total > 0 ? (
                <>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span>{r.percentual == null ? "—" : `${r.percentual}% concluído`}</span>
                      <span className="text-muted-foreground">
                        {r.concluidos} de {r.total} itens
                      </span>
                    </div>
                    <Progresso valor={r.percentual} rotulo="Conclusão das pendências" />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {r.atrasados ? <Badge variante="perigo">{r.atrasados} atrasado(s)</Badge> : null}
                    {r.correcao ? <Badge variante="perigo">{r.correcao} para corrigir</Badge> : null}
                    {r.pendentes ? <Badge variante="alerta">{r.pendentes} faltante(s)</Badge> : null}
                    {r.enviados ? <Badge variante="info">{r.enviados} em conferência</Badge> : null}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma pendência cadastrada para este mês.</p>
              )}
              {itens.data?.length ? (
                <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Em aberto, pelo prazo</p>
                <ul className="divide-y divide-border text-sm">
                  {itens.data.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{i.titulo}</span>
                        <span className={i.prazo < hoje ? "text-xs text-perigo" : "text-xs text-muted-foreground"}>
                          {formatarCompetencia(i.competencia)} · prazo {formatarData(i.prazo)}
                          {i.prazo < hoje ? " (atrasado)" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variante={STATUS_CHECKLIST[i.status]?.tom ?? "neutro"}>{STATUS_CHECKLIST[i.status]?.rotulo ?? i.status}</Badge>
                        {ctx.pode("documentos.enviar") ? (
                          <Link href={`/e/${empresaId}/enviar?item=${i.id}`} className="text-primary hover:underline" aria-label={`Enviar ${i.titulo}`}>
                            <Upload className="size-4" />
                          </Link>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                </>
              ) : r && r.total > 0 ? (
                <p className="flex items-center gap-2 text-sm text-sucesso-fg">
                  <FileCheck2 className="size-4" /> Nenhum documento faltando no momento.
                </p>
              ) : null}
              <Link href={`/e/${empresaId}/pendencias`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Ver pendências <ArrowRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {verDocs ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4" /> Documentos do escritório
              </CardTitle>
              <CardDescription>Guias, folhas, recibos e relatórios disponibilizados para a empresa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {doEscritorio.data?.length ? (
                <ul className="divide-y divide-border text-sm">
                  {doEscritorio.data.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/e/${empresaId}/documentos/${d.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {d.titulo ?? d.nome_original}
                      </Link>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {d.vencimento ? (
                          <span className={d.vencimento < hoje ? "text-perigo" : undefined}>vence {formatarData(d.vencimento)}</span>
                        ) : (
                          formatarData(d.publicado_em)
                        )}
                        {d.valor != null ? <span className="block">{formatarMoeda(d.valor)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum documento disponibilizado ainda.</p>
              )}
              <Link href={`/e/${empresaId}/documentos?origem=escritorio`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Ver todos <ArrowRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {verDocs ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="size-4" /> Últimos envios
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recebidos.data?.length ? (
                <ul className="divide-y divide-border text-sm">
                  {recebidos.data.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <Link href={`/e/${empresaId}/documentos/${d.id}`} className="block truncate font-medium hover:underline">
                          {d.titulo ?? d.nome_original}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {formatarCompetencia(d.competencia)} · {formatarDataHora(d.enviado_em)}
                        </span>
                      </span>
                      {d.status ? <Badge variante={STATUS_DOCUMENTO[d.status]?.tom ?? "neutro"}>{STATUS_DOCUMENTO[d.status]?.rotulo}</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum documento enviado ainda.</p>
              )}
              <Link href={`/e/${empresaId}/documentos`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Ver documentos <ArrowRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {ctx.pode("mensagens.usar") ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessagesSquare className="size-4" /> Conversas com o escritório
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {conversas.data?.length ? (
                <ul className="divide-y divide-border text-sm">
                  {conversas.data.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/e/${empresaId}/mensagens/${c.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {c.assunto}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {c.aguardando === (ctx.equipe ? "escritorio" : "cliente") ? <Badge variante="alerta">Aguardando você</Badge> : formatarDataHora(c.ultima_mensagem_em)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma conversa em aberto.</p>
              )}
              <Link href={`/e/${empresaId}/mensagens`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Abrir mensagens <ArrowRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
