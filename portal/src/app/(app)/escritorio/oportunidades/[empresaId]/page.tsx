import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, ExternalLink, ListChecks } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { AcoesEstudo, BotaoRodarRobo, FormPremissas } from "@/components/estudos/acoes-estudo";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCnpj, formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import type { Passo } from "@/lib/estudos/estudar";
import { ESTADO_ESTUDO, SITUACAO_ESTUDO, SITUACAO_EXECUCAO_ESTUDO, TIPOS_ESTUDO, estudandoAgora } from "@/lib/estudos/rotulos";

export const metadata: Metadata = { title: "Estudo tributário" };

const UUID = /^[0-9a-f-]{36}$/i;

interface Detalhes {
  passos?: Passo[];
  avisos?: string[];
  links?: { rotulo: string; href: string }[];
}

const textoNumero = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","));

export default async function EstudoDaEmpresa({ params }: PageProps<"/escritorio/oportunidades/[empresaId]">) {
  const s = await exigirEquipe();
  const { empresaId } = await params;
  if (!UUID.test(empresaId)) notFound();

  const [{ data: empresa }, { data: estudos }, { data: execucoes }, { data: parametros }] = await Promise.all([
    s.supabase.from("empresas").select("id, razao_social, nome_fantasia, documento, regime_tributario, contribuinte_icms").eq("id", empresaId).maybeSingle(),
    s.supabase
      .from("estudo_oportunidades")
      .select("id, tipo, estado, titulo, resumo, economia_anual, valor_unico, detalhes, faltando, situacao, motivo, revisado_em, valor_na_revisao, apresentado_em, detectado_em, atualizado_em, revisor:perfis!estudo_oportunidades_revisado_por_fkey(nome)")
      .eq("empresa_id", empresaId),
    s.supabase.from("estudo_execucoes").select("id, origem, situacao, iniciado_em, concluido_em, resumo, erro").eq("empresa_id", empresaId).order("iniciado_em", { ascending: false }).limit(8),
    s.supabase.from("calculo_parametros").select("margem_lucro, aliquota_icms_media").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (!empresa) notFound();
  const nome = empresa.nome_fantasia || empresa.razao_social;
  const porTipo = new Map((estudos ?? []).map((e) => [e.tipo, e]));
  const emAndamento = (execucoes ?? []).some(estudandoAgora);
  const ultima = (execucoes ?? []).find((x) => x.situacao !== "na_fila");

  return (
    <>
      <CabecalhoPagina
        titulo={`Estudo tributário — ${nome}`}
        descricao={`${formatarCnpj(empresa.documento)} · ${REGIMES[empresa.regime_tributario] ?? empresa.regime_tributario}. Estimativas com os dados do portal; cada estudo mostra a conta passo a passo e o que falta.`}
        acoes={
          <div className="flex flex-wrap gap-2">
            <Button asChild variante="contorno">
              <Link href="/escritorio/oportunidades">
                <ArrowLeft /> Carteira
              </Link>
            </Button>
            <Button asChild variante="contorno">
              <Link href={`/e/${empresaId}/calculos`}>
                <Building2 /> Abrir a empresa
              </Link>
            </Button>
            <BotaoRodarRobo empresaId={empresaId} emAndamento={emAndamento} />
          </div>
        }
      />
      <AtualizarEnquanto ativo={emAndamento} intervaloMs={4000} />
      {emAndamento ? (
        <Alerta tom="info" className="mb-4">
          O robô está estudando esta empresa. A tela se atualiza sozinha em alguns segundos.
        </Alerta>
      ) : ultima?.situacao === "erro" ? (
        <Alerta tom="perigo" className="mb-4">
          A última análise não terminou: {ultima.erro ?? "erro desconhecido"}. Tente Rodar agora; se continuar, avise o suporte.
        </Alerta>
      ) : null}
      {!estudos?.length && !emAndamento ? (
        <Alerta tom="info" className="mb-4">
          O robô ainda não estudou esta empresa. Clique em Rodar agora para ver o resultado em instantes.
        </Alerta>
      ) : null}

      <div className="space-y-4">
        {TIPOS_ESTUDO.map((t) => {
          const e = porTipo.get(t.tipo);
          if (!e) return null;
          const d = (e.detalhes ?? {}) as Detalhes;
          const estado = ESTADO_ESTUDO[e.estado];
          const situacao = SITUACAO_ESTUDO[e.situacao];
          const revisavel = e.estado === "oportunidade" || e.estado === "alerta";
          const revisor = (e.revisor as { nome?: string | null } | null)?.nome;
          return (
            <Card key={t.tipo} id={t.tipo} data-estudo={e.id} className="scroll-mt-20">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardDescription className="text-xs font-medium uppercase tracking-wide">{t.nome}</CardDescription>
                  {estado ? <Badge variante={estado.tom}>{estado.rotulo}</Badge> : null}
                  {revisavel && situacao ? <Badge variante={situacao.tom}>{situacao.rotulo}</Badge> : null}
                </div>
                <CardTitle className="text-lg">{e.titulo}</CardTitle>
                <p className="text-sm text-muted-foreground">{e.resumo}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {e.economia_anual || e.valor_unico ? (
                  <div className="flex flex-wrap gap-6">
                    {e.economia_anual ? (
                      <div>
                        <p className="text-xs text-muted-foreground">Economia estimada por ano</p>
                        <p className="numero text-xl font-semibold text-sucesso">{formatarMoeda(e.economia_anual)}</p>
                      </div>
                    ) : null}
                    {e.valor_unico ? (
                      <div>
                        <p className="text-xs text-muted-foreground">Valor a recuperar</p>
                        <p className="numero text-xl font-semibold text-sucesso">{formatarMoeda(e.valor_unico)}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {e.faltando.length ? (
                  <div className="rounded-xl border border-info/30 bg-info-bg/50 p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-titulo">
                      <ListChecks className="size-4" /> O que falta para estudar
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">
                      {e.faltando.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {d.passos?.length ? (
                  <details className="group rounded-xl border border-border" open={revisavel}>
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-titulo">Como chegamos nesse resultado</summary>
                    <Table>
                      <TBody>
                        {d.passos.map((p, i) => (
                          <Tr key={`${p.rotulo}-${i}`}>
                            <Td className="text-sm">{p.rotulo}</Td>
                            <Td className="numero text-right text-sm font-medium">{p.valor}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </details>
                ) : null}

                {d.avisos?.length ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {d.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                ) : null}

                {d.links?.length ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {d.links.map((l) => (
                      <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                        {l.rotulo} <ExternalLink className="size-3.5" />
                      </Link>
                    ))}
                  </div>
                ) : null}

                {revisavel ? (
                  <div className="space-y-2 border-t border-border pt-3">
                    {e.situacao !== "nova" ? (
                      <p className="text-xs text-muted-foreground">
                        {SITUACAO_ESTUDO[e.situacao]?.rotulo ?? e.situacao}
                        {revisor ? ` por ${revisor}` : ""}
                        {e.revisado_em ? ` em ${formatarDataHora(e.revisado_em)}` : ""}
                        {e.valor_na_revisao ? ` (valor na época: ${formatarMoeda(e.valor_na_revisao)})` : ""}
                        {e.apresentado_em ? ` · apresentado em ${formatarDataHora(e.apresentado_em)}` : ""}
                        {e.motivo ? ` · ${e.motivo}` : ""}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Encontrado {formatarRelativo(e.detectado_em)}. Revise a conta antes de aprovar.</p>
                    )}
                    <AcoesEstudo id={e.id} situacao={e.situacao} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardHeader>
            <CardTitle>Premissas do comparativo de regimes</CardTitle>
            <CardDescription>
              O que as notas não informam. O robô e o comparativo de regimes usam estes valores; ao guardar, o robô estuda a empresa de novo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {parametros ? (
              <FormPremissas
                empresaId={empresaId}
                margem={textoNumero(parametros.margem_lucro)}
                icms={textoNumero(parametros.aliquota_icms_media)}
                mostrarIcms={empresa.contribuinte_icms}
              />
            ) : (
              <Alerta tom="alerta">
                Configure os cálculos desta empresa primeiro (anexos do Simples, presunção, ISS e pró-labore).{" "}
                <Link href={`/e/${empresaId}/calculos/configuracao`} className="font-medium underline">
                  Abrir a configuração
                </Link>
              </Alerta>
            )}
          </CardContent>
        </Card>

        {execucoes?.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Últimas análises</CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Quando</Th>
                    <Th>Como</Th>
                    <Th>Situação</Th>
                    <Th className="hidden sm:table-cell">Resultado</Th>
                  </Tr>
                </THead>
                <TBody>
                  {execucoes.map((x) => {
                    const r = (x.resumo ?? {}) as { novas?: number; mudaram?: number };
                    const sit = SITUACAO_EXECUCAO_ESTUDO[x.situacao];
                    return (
                      <Tr key={x.id}>
                        <Td className="text-sm">{formatarDataHora(x.concluido_em ?? x.iniciado_em)}</Td>
                        <Td className="text-sm">{x.origem === "manual" ? "Rodar agora" : "Rotina da noite"}</Td>
                        <Td>{sit ? <Badge variante={sit.tom}>{sit.rotulo}</Badge> : x.situacao}</Td>
                        <Td className="hidden text-sm text-muted-foreground sm:table-cell">
                          {x.situacao === "erro"
                            ? x.erro
                            : x.situacao === "concluida"
                              ? [r.novas ? `${r.novas} ${r.novas === 1 ? "novidade" : "novidades"}` : null, r.mudaram ? `${r.mudaram} com valor diferente` : null].filter(Boolean).join(", ") ||
                                "Sem novidades"
                              : "Aguardando a fila"}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
