import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BookOpenCheck, FileCheck2, FileSearch, PiggyBank, ScanSearch } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarTudo } from "@/lib/supabase/paginar";
import { ROTULO_GRUPO, type GrupoMonofasico } from "@/lib/auditor-fiscal/catalogo";
import { SITUACAO_EXECUCAO } from "@/lib/auditor-fiscal/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCnpj, formatarCompetencia, formatarRelativo } from "@/lib/formatos";
import { SITUACAO_SPED } from "@/lib/sped/rotulos";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Auditor fiscal" };

interface Resumo {
  economia: number;
  paraRevisar: number;
  riscos: number;
  publicado: number;
  concluido: number;
}

export default async function AuditorFiscalCarteira() {
  const s = await exigirEquipe();
  const resultado = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia, documento, regime_tributario").order("razao_social").range(de, ate)),
    buscarTudo((de, ate) => s.supabase.from("auditor_achados").select("empresa_id, tipo, situacao, valor_estimado").range(de, ate)),
    buscarTudo((de, ate) =>
      s.supabase.from("auditor_execucoes").select("empresa_id, situacao, criada_em, erro").order("criada_em", { ascending: false }).range(de, ate),
    ),
    buscarTudo((de, ate) =>
      s.supabase.from("auditor_ncm_monofasico").select("ncm_prefixo, ex_tipi, excecao, grupo, descricao, condicao, confianca, fonte_titulo, fonte_url").eq("ativo", true).order("grupo").order("ncm_prefixo").range(de, ate),
    ),
  ])
    .then(([empresas, achados, execucoes, catalogo]) => ({ empresas, achados, execucoes, catalogo, erro: null as string | null }))
    .catch((e: unknown) => ({ empresas: [], achados: [], execucoes: [], catalogo: [], erro: mensagemErro(e) }));
  const { data: speds } = await s.supabase.rpc("sped_carteira");
  const ultimosSped = (speds ?? []) as unknown as {
    empresa_id: string;
    empresa: string;
    tipo: string;
    periodo_inicio: string;
    situacao: string;
    alta: number;
    media: number;
    arquivo_id: string;
  }[];

  const resumo = new Map<string, Resumo>();
  for (const a of resultado.achados) {
    const r = resumo.get(a.empresa_id) ?? { economia: 0, paraRevisar: 0, riscos: 0, publicado: 0, concluido: 0 };
    const valor = Number(a.valor_estimado ?? 0);
    if (a.situacao === "novo") r.paraRevisar++;
    if (a.tipo === "oportunidade" && ["novo", "confirmado", "publicado"].includes(a.situacao)) r.economia += valor;
    if (a.tipo === "risco" && ["novo", "confirmado", "publicado"].includes(a.situacao)) r.riscos++;
    if (a.situacao === "publicado") r.publicado += valor;
    if (a.situacao === "resolvido") r.concluido++;
    resumo.set(a.empresa_id, r);
  }
  const ultima = new Map<string, (typeof resultado.execucoes)[number]>();
  for (const e of resultado.execucoes) if (!ultima.has(e.empresa_id)) ultima.set(e.empresa_id, e);

  const linhas = resultado.empresas
    .map((e) => ({ ...e, r: resumo.get(e.id) ?? null, exec: ultima.get(e.id) ?? null }))
    .sort((a, b) => (b.r?.economia ?? 0) - (a.r?.economia ?? 0) || (b.r?.paraRevisar ?? 0) - (a.r?.paraRevisar ?? 0));
  const total = linhas.reduce((t, l) => t + (l.r?.economia ?? 0), 0);
  const paraRevisar = linhas.reduce((t, l) => t + (l.r?.paraRevisar ?? 0), 0);
  const riscos = linhas.reduce((t, l) => t + (l.r?.riscos ?? 0), 0);
  const comAchados = linhas.filter((l) => l.r && (l.r.economia > 0 || l.r.paraRevisar || l.r.riscos)).length;
  const grupos = new Map<string, typeof resultado.catalogo>();
  for (const c of resultado.catalogo) grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c]);

  return (
    <>
      <CabecalhoPagina
        titulo="Auditor fiscal"
        descricao="Imposto possivelmente pago a mais e riscos nas notas de todas as empresas da carteira, nos últimos 5 anos. Cada achado traz a memória de cálculo e a lei; a equipe revisa antes de publicar ao cliente."
      />
      {resultado.erro ? <Alerta tom="perigo" className="mb-4">{resultado.erro}</Alerta> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador rotulo="Possível economia" valor={formatarMoeda(total)} detalhe="oportunidades em aberto" tom="sucesso" icone={PiggyBank} />
        <Indicador rotulo="Para revisar" valor={paraRevisar} tom={paraRevisar ? "alerta" : "neutro"} icone={FileSearch} />
        <Indicador rotulo="Riscos em aberto" valor={riscos} tom={riscos ? "alerta" : "neutro"} icone={AlertTriangle} />
        <Indicador rotulo="Empresas com achados" valor={comAchados} icone={ScanSearch} />
      </div>

      {linhas.length ? (
        <Card className="mb-4">
          <CardContent className="px-0 pt-2 sm:px-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th className="text-right">Possível economia</Th>
                  <Th className="hidden sm:table-cell text-right">Para revisar</Th>
                  <Th className="hidden md:table-cell text-right">Riscos</Th>
                  <Th className="hidden lg:table-cell text-right">Publicado</Th>
                  <Th className="hidden md:table-cell">Última análise</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <Link href={`/e/${l.id}/auditor-fiscal`} className="font-medium text-primary hover:underline">
                        {l.nome_fantasia ?? l.razao_social}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{l.documento ? formatarCnpj(l.documento) : ""}</span>
                    </Td>
                    <Td className="numero text-right font-medium text-sucesso">{l.r?.economia ? formatarMoeda(l.r.economia) : "—"}</Td>
                    <Td className="hidden text-right sm:table-cell">{l.r?.paraRevisar ? <Badge variante="alerta">{l.r.paraRevisar}</Badge> : "—"}</Td>
                    <Td className="hidden text-right md:table-cell">{l.r?.riscos || "—"}</Td>
                    <Td className="numero hidden text-right lg:table-cell">{l.r?.publicado ? formatarMoeda(l.r.publicado) : "—"}</Td>
                    <Td className="hidden text-sm md:table-cell">
                      {l.exec ? (
                        <>
                          {formatarRelativo(l.exec.criada_em)}{" "}
                          {l.exec.situacao !== "concluida" ? (
                            <Badge variante={SITUACAO_EXECUCAO[l.exec.situacao]?.tom ?? "neutro"} title={l.exec.erro ?? undefined}>
                              {SITUACAO_EXECUCAO[l.exec.situacao]?.rotulo ?? l.exec.situacao}
                            </Badge>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">sem notas analisadas</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={ScanSearch} titulo="Nenhuma empresa na carteira" />
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="size-4" /> SPED Fiscal × XML
          </CardTitle>
          <CardDescription>
            Último arquivo da EFD de cada empresa, conferido com os XML do portal. Para conferir um mês, envie o .txt da EFD na empresa (tipo “Arquivos do
            SPED”).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ultimosSped.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Período</Th>
                  <Th className="text-right">Corrigir</Th>
                  <Th className="hidden text-right sm:table-cell">Conferir</Th>
                </Tr>
              </THead>
              <TBody>
                {ultimosSped.map((l) => (
                  <Tr key={l.empresa_id}>
                    <Td>
                      <Link href={`/e/${l.empresa_id}/auditor-fiscal/sped?arquivo=${l.arquivo_id}`} className="font-medium text-primary hover:underline">
                        {l.empresa}
                      </Link>
                    </Td>
                    <Td>
                      {formatarCompetencia(l.periodo_inicio)}
                      <span className="block text-xs text-muted-foreground">{SITUACAO_SPED[l.situacao]?.rotulo ?? l.situacao}</span>
                    </Td>
                    <Td className="text-right">{l.alta ? <Badge variante="perigo">{l.alta}</Badge> : "—"}</Td>
                    <Td className="hidden text-right sm:table-cell">{l.media ? <Badge variante="alerta">{l.media}</Badge> : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum arquivo do SPED enviado ainda.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpenCheck className="size-4" /> Produtos com PIS/Cofins monofásico usados pelo auditor
          </CardTitle>
          <CardDescription>
            Lista por NCM conferida no texto vigente das leis. Além dela, o auditor considera monofásico o produto que a própria empresa comprou com CST 04
            na nota do fornecedor. Linhas marcadas &ldquo;conferir&rdquo; dependem de uma condição (destinação, varejo, correlação de NCM).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {[...grupos.entries()].map(([grupo, linhasGrupo]) => (
            <details key={grupo} className="rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                {(ROTULO_GRUPO[grupo as GrupoMonofasico] ?? grupo).replace(/^./, (l) => l.toUpperCase())} ({linhasGrupo.length})
              </summary>
              <div className="overflow-x-auto px-3 pb-3">
                <Table>
                  <THead>
                    <Tr>
                      <Th>NCM</Th>
                      <Th>Produto</Th>
                      <Th className="hidden md:table-cell">Lei</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {linhasGrupo.map((c) => (
                      <Tr key={`${c.ncm_prefixo}-${c.ex_tipi ?? ""}-${c.excecao}`}>
                        <Td className="font-mono text-xs">
                          {c.ncm_prefixo}
                          {c.ex_tipi ? ` Ex ${c.ex_tipi}` : ""}
                          {c.excecao ? <Badge variante="neutro" className="ml-1">exceção</Badge> : null}
                          {c.confianca === "conferir" ? <Badge variante="alerta" className="ml-1">conferir</Badge> : null}
                        </Td>
                        <Td className="text-sm">
                          {c.descricao}
                          {c.condicao ? <span className="block text-xs text-muted-foreground">{c.condicao}</span> : null}
                        </Td>
                        <Td className="hidden text-xs md:table-cell">
                          {c.fonte_url ? (
                            <a href={c.fonte_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                              {c.fonte_titulo}
                            </a>
                          ) : (
                            c.fonte_titulo
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
