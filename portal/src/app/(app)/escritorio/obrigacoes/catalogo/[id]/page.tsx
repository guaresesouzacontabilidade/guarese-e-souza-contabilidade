import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FilePlus2, GitPullRequestArrow } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { EditarObrigacao, ProporEncerramento, type ObrigacaoForm } from "@/components/obrigacoes/catalogo";
import { SimuladorPrazos } from "@/components/obrigacoes/form-regra";
import { competenciaAtual, hojeISO } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { descreverAplicabilidade, descreverFeriados, descreverPrazo, type RegraObrigacao } from "@/lib/obrigacoes/regras";
import { AREAS, ESFERAS, ETAPAS, MODOS_CONFIG, PERIODICIDADES, STATUS_NORMA, TIPO_NORMA } from "@/lib/obrigacoes/rotulos";
import { carregarLocalEscritorio } from "@/lib/obrigacoes/local";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Obrigação" };

export default async function ObrigacaoDetalhe({ params }: PageProps<"/escritorio/obrigacoes/catalogo/[id]">) {
  const { id } = await params;
  const s = await exigirEquipe();
  const { data: o } = await s.supabase.from("obrigacoes").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();
  const atual = competenciaAtual();
  const hoje = hojeISO();
  const admin = s.perfil.tipo === "admin";

  const [{ data: regras }, { data: normas }, { data: configs }, { data: categorias }, { data: empresas }, local] = await Promise.all([
    s.supabase.from("obrigacao_regras").select("*").eq("obrigacao_id", id).order("vigencia_inicio", { ascending: false }),
    s.supabase.from("atualizacoes_normativas").select("id, titulo, tipo, status, vigencia_inicio, proposta_em, aplicada_em").eq("obrigacao_id", id).order("proposta_em", { ascending: false }),
    s.supabase.from("empresa_obrigacoes").select("id, modo, vigencia_inicio, vigencia_fim, motivo, empresa:empresas(id, razao_social)").eq("obrigacao_id", id),
    s.supabase.from("categorias_documento").select("codigo, nome").eq("ativo", true).order("ordem"),
    s.supabase.from("empresas").select("id, razao_social").eq("ativa", true).order("razao_social"),
    carregarLocalEscritorio(s.supabase),
  ]);
  const codigosMunicipios = [...new Set((regras ?? []).flatMap((r) => r.municipios ?? []))];
  const { data: municipios } = codigosMunicipios.length
    ? await s.supabase.from("municipios").select("ibge, nome, uf").in("ibge", codigosMunicipios)
    : { data: [] as { ibge: string; nome: string; uf: string }[] };
  const nomeMunicipio = new Map((municipios ?? []).map((m) => [m.ibge, `${m.nome}/${m.uf}`]));
  const nomeEmpresa = new Map((empresas ?? []).map((e) => [e.id, e.razao_social]));
  const lista = (regras ?? []) as unknown as RegraObrigacao[];

  const situacaoRegra = (r: RegraObrigacao) => {
    if (r.status === "rascunho") return { rotulo: "Proposta", tom: "alerta" as const };
    if (r.status === "revogada") return { rotulo: "Encerrada", tom: "neutro" as const };
    if (r.vigencia_inicio > atual) return { rotulo: "Futura", tom: "info" as const };
    if (r.vigencia_fim && r.vigencia_fim < atual) return { rotulo: "Encerrada (histórico)", tom: "neutro" as const };
    return { rotulo: "Em vigor", tom: "sucesso" as const };
  };
  const abrangencia = (r: RegraObrigacao) =>
    r.empresa_id ? `Somente ${nomeEmpresa.get(r.empresa_id) ?? "uma empresa"}` : r.municipios?.length ? r.municipios.map((m) => nomeMunicipio.get(m) ?? m).join(", ") : r.ufs?.length ? `Estado: ${r.ufs.join(", ")}` : "Todo o país";

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: "/escritorio/obrigacoes/catalogo", rotulo: "Catálogo" }}
        titulo={o.nome}
        descricao={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variante="contorno">{o.codigo}</Badge>
            <Badge>{ESFERAS[o.esfera]}</Badge>
            <Badge>{AREAS[o.area]}</Badge>
            <Badge>{PERIODICIDADES[o.periodicidade]}</Badge>
            {o.etapas.map((e: string) => (
              <Badge key={e} variante="primario">
                {ETAPAS[e]?.rotulo}
              </Badge>
            ))}
            {o.tributos.length ? <span className="text-xs text-muted-foreground">Tributos: {o.tributos.join(", ")}</span> : null}
            {!o.ativa ? <Badge variante="alerta">Inativa</Badge> : null}
          </span>
        }
        acoes={
          <>
            {admin ? <EditarObrigacao obrigacao={o as unknown as ObrigacaoForm} categorias={categorias ?? []} /> : null}
            <Button asChild>
              <Link href={`/escritorio/obrigacoes/catalogo/${id}/propor`}>
                <FilePlus2 /> Propor regra
              </Link>
            </Button>
          </>
        }
      />
      {o.descricao ? <p className="-mt-2 mb-5 max-w-3xl text-sm text-muted-foreground">{o.descricao}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Regras por vigência</CardTitle>
              <CardDescription>Regra validada não é editada: mudanças entram por atualização normativa, com fonte e validação. As antigas ficam no histórico.</CardDescription>
            </CardHeader>
            <CardContent>
              {lista.length ? (
                <div className="space-y-3">
                  {lista.map((r) => {
                    const sit = situacaoRegra(r);
                    const prazos = [
                      { etapa: "entrega", p: r.prazo_entrega },
                      { etapa: "pagamento", p: r.prazo_pagamento },
                      { etapa: "apuracao", p: r.prazo_apuracao },
                    ].filter((x) => x.p);
                    const vigente = sit.rotulo === "Em vigor" || sit.rotulo === "Futura";
                    return (
                      <article key={r.id} className={cn("rounded-lg border border-border p-3 sm:p-4", !vigente && r.status !== "rascunho" && "bg-muted/40")}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variante={sit.tom}>{sit.rotulo}</Badge>
                              <span className="text-sm font-medium">
                                {formatarCompetencia(r.vigencia_inicio)} {r.vigencia_fim ? `a ${formatarCompetencia(r.vigencia_fim)}` : "em diante"}
                              </span>
                              <span className="text-sm text-muted-foreground">· {abrangencia(r)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Aplica-se a: {descreverAplicabilidade(r)}</p>
                          </div>
                          {r.status === "validada" && vigente ? (
                            <div className="flex flex-wrap gap-1">
                              <Button asChild variante="fantasma" tamanho="sm">
                                <Link href={`/escritorio/obrigacoes/catalogo/${id}/propor?anterior=${r.id}`}>
                                  <GitPullRequestArrow /> Propor alteração
                                </Link>
                              </Button>
                              <ProporEncerramento regraId={r.id} hoje={hoje} />
                            </div>
                          ) : null}
                        </div>
                        <ul className="mt-3 space-y-1.5 text-sm">
                          {prazos.length ? (
                            prazos.map((x) => (
                              <li key={x.etapa}>
                                <span className="font-medium">{ETAPAS[x.etapa]?.prazo}:</span> {descreverPrazo(x.p, o.periodicidade)}{" "}
                                <span className="text-xs text-muted-foreground">({descreverFeriados(x.p)})</span>
                              </li>
                            ))
                          ) : (
                            <li className="text-muted-foreground">Sem prazo definido: aguardando regulamentação. Nenhuma data é presumida.</li>
                          )}
                          <li className="text-xs text-muted-foreground">Prazo interno: {r.prazo_interno_dias_uteis} dia(s) útil(eis) antes do prazo legal.</li>
                          {r.observacao ? <li className="text-xs text-muted-foreground">Obs.: {r.observacao}</li> : null}
                        </ul>
                        <p className="mt-2 text-xs">
                          Fonte:{" "}
                          {r.fonte_url ? (
                            <a href={r.fonte_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                              {r.fonte_titulo} <ExternalLink className="size-3" />
                            </a>
                          ) : (
                            r.fonte_titulo
                          )}{" "}
                          <span className="text-muted-foreground">· consultada em {formatarData(r.fonte_consultada_em)}</span>
                        </p>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EstadoVazio titulo="Nenhuma regra cadastrada" descricao="Proponha a regra com a fonte oficial. Até lá, nenhuma data é calculada para esta obrigação." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Atualizações normativas</CardTitle>
            </CardHeader>
            <CardContent>
              {(normas ?? []).length ? (
                <Table>
                  <THead>
                    <tr>
                      <Th>Atualização</Th>
                      <Th>Vigência</Th>
                      <Th>Situação</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {(normas ?? []).map((n) => (
                      <Tr key={n.id}>
                        <Td>
                          <Link href={`/escritorio/obrigacoes/normas?status=${n.status}#n-${n.id}`} className="font-medium hover:underline">
                            {n.titulo}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {TIPO_NORMA[n.tipo]} · proposta em {formatarDataHora(n.proposta_em)}
                            {n.aplicada_em ? ` · aplicada em ${formatarDataHora(n.aplicada_em)}` : ""}
                          </p>
                        </Td>
                        <Td className="text-sm">{formatarCompetencia(n.vigencia_inicio)}</Td>
                        <Td>
                          <Badge variante={STATUS_NORMA[n.status]?.tom ?? "neutro"}>{STATUS_NORMA[n.status]?.rotulo ?? n.status}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma atualização registrada.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {lista.some((r) => r.status === "validada") ? (
            <SimuladorPrazos
              prazos={(() => {
                const r = lista.find((x) => x.status === "validada" && x.vigencia_inicio <= atual && (!x.vigencia_fim || x.vigencia_fim >= atual)) ?? lista.find((x) => x.status === "validada")!;
                return { prazo_entrega: r.prazo_entrega, prazo_pagamento: r.prazo_pagamento, prazo_apuracao: r.prazo_apuracao };
              })()}
              periodicidade={o.periodicidade}
              etapas={o.etapas}
              inicio={atual.slice(0, 7)}
              empresas={(empresas ?? []).map((e) => ({ id: e.id, nome: e.razao_social }))}
              local={local}
            />
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Configurações por empresa</CardTitle>
              <CardDescription>Inclusões e exclusões com motivo e vigência.</CardDescription>
            </CardHeader>
            <CardContent>
              {(configs ?? []).length ? (
                <ul className="space-y-2 text-sm">
                  {(configs ?? []).map((c) => {
                    const e = c.empresa as unknown as { id: string; razao_social: string } | null;
                    return (
                      <li key={c.id} className="rounded-md border border-border p-2.5">
                        <Link href={`/escritorio/obrigacoes/empresas/${e?.id}`} className="font-medium hover:underline">
                          {e?.razao_social ?? "—"}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {MODOS_CONFIG[c.modo]?.rotulo} · {formatarCompetencia(c.vigencia_inicio)} {c.vigencia_fim ? `a ${formatarCompetencia(c.vigencia_fim)}` : "em diante"}
                        </p>
                        {c.motivo ? <p className="text-xs text-muted-foreground">{c.motivo}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma empresa com configuração própria.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
