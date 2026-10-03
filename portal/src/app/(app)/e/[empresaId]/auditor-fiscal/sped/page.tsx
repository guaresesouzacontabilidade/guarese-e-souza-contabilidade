import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FileCheck2, FileText, ListChecks, Upload } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { AcoesSped } from "@/components/sped/acoes-sped";
import { parametro } from "@/lib/busca";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { GRAVIDADE_SPED, ORDEM_REGRAS, REGRAS_SPED, SITUACAO_SPED, TIPO_SPED } from "@/lib/sped/rotulos";
import type { AnaliticoSped, ApuracaoIcms } from "@/lib/sped/leitura";

export const metadata: Metadata = { title: "SPED Fiscal" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDEM_GRAVIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const LIMITE_POR_REGRA = 100;

type Resumo = {
  documentos: number;
  saidas: number;
  entradas: number;
  canceladas: number;
  valor_saidas: number;
  valor_entradas: number;
  com_xml: number;
  xml_emitidas: number;
  xml_recebidas: number;
  alta: number;
  media: number;
  baixa: number;
};
type Totais = { registros?: number; analitico?: AnaliticoSped[]; apuracao?: ApuracaoIcms | null };

const n = (v: unknown) => Number(v ?? 0);

export default async function SpedFiscal({ params, searchParams }: PageProps<"/e/[empresaId]/auditor-fiscal/sped">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("auditor.gerenciar")) return <Alerta tom="alerta">A conferência do SPED é de uso da equipe do escritório.</Alerta>;
  const base = `/e/${empresaId}`;

  const { data: arquivos } = await ctx.supabase
    .from("sped_arquivos")
    .select("id, nome_arquivo, tipo, versao_leiaute, finalidade, periodo_inicio, periodo_fim, cnpj, uf, ie, perfil, situacao, vigente, totais, resumo, avisos, erro, created_at, conferido_em, documento_id")
    .eq("empresa_id", empresaId)
    .order("periodo_inicio", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(36);
  const lista = arquivos ?? [];
  const pedido = parametro(sp, "arquivo");
  const sel = (UUID.test(pedido) ? lista.find((a) => a.id === pedido) : null) ?? lista.find((a) => a.vigente) ?? lista[0] ?? null;

  const { data: divergencias } = sel
    ? await ctx.supabase
        .from("sped_divergencias")
        .select("id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_sped, valor_xml, diferenca, detalhe, xml:documentos_fiscais(documento_id)")
        .eq("arquivo_id", sel.id)
        .limit(5000)
    : { data: [] };
  const grupos = ORDEM_REGRAS.map((regra) => ({ regra, itens: (divergencias ?? []).filter((d) => d.regra === regra) }))
    .filter((g) => g.itens.length)
    .sort((a, b) => ORDEM_GRAVIDADE[a.itens[0].gravidade] - ORDEM_GRAVIDADE[b.itens[0].gravidade]);
  const resumo = (sel?.resumo ?? null) as Resumo | null;
  const totais = (sel?.totais ?? {}) as Totais;
  const apuracao = totais.apuracao ?? null;
  const situacao = sel ? (SITUACAO_SPED[sel.situacao] ?? { rotulo: sel.situacao, variante: "neutro" as const }) : null;

  return (
    <>
      <CabecalhoPagina
        titulo="Conferência do SPED Fiscal"
        descricao="Compara as notas escrituradas na EFD ICMS/IPI com os XML que o portal tem da empresa, antes da transmissão. O portal não transmite nem altera a EFD."
        voltar={{ href: `${base}/auditor-fiscal`, rotulo: "Voltar ao auditor fiscal" }}
        acoes={
          <Button asChild>
            <Link href={`${base}/enviar?categoria=sped_fiscal`}>
              <Upload /> Enviar arquivo do SPED
            </Link>
          </Button>
        }
      />
      <AtualizarEnquanto ativo={lista.some((a) => a.situacao === "processando")} />

      {!lista.length ? (
        <EstadoVazio
          icone={FileCheck2}
          titulo="Nenhum arquivo do SPED ainda"
          descricao="Gere a EFD ICMS/IPI do mês no sistema fiscal e envie o arquivo .txt (tipo “Arquivos do SPED”). O portal confere as notas escrituradas com os XML recebidos e mostra o que corrigir antes de transmitir."
        />
      ) : null}

      {sel && situacao ? (
        <>
          <Card className="mb-4">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {TIPO_SPED[sel.tipo] ?? sel.tipo} de {formatarCompetencia(sel.periodo_inicio, true)}
                  <Badge variante={situacao.variante}>{situacao.rotulo}</Badge>
                  {!sel.vigente ? <Badge variante="neutro">Substituído por um arquivo mais novo</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {formatarData(sel.periodo_inicio)} a {formatarData(sel.periodo_fim)}
                  {sel.finalidade === "substituto" ? " · arquivo substituto" : ""}
                  {sel.versao_leiaute ? ` · leiaute ${sel.versao_leiaute}` : ""}
                  {sel.perfil ? ` · perfil ${sel.perfil}` : ""}
                  {sel.cnpj ? ` · ${formatarDocumento(sel.cnpj)}` : ""}
                  {sel.uf ? ` · ${sel.uf}` : ""}
                  {sel.ie ? ` · IE ${sel.ie}` : ""}
                </CardDescription>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sel.nome_arquivo} · recebido em {formatarDataHora(sel.created_at)}
                  {sel.conferido_em ? ` · conferido em ${formatarDataHora(sel.conferido_em)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {sel.documento_id ? (
                  <Button asChild variante="contorno" tamanho="sm">
                    <Link href={`${base}/documentos/${sel.documento_id}`}>
                      <FileText /> Ver arquivo
                    </Link>
                  </Button>
                ) : null}
                <AcoesSped empresaId={empresaId} arquivoId={sel.id} conferir={sel.situacao === "conferido"} />
              </div>
            </CardHeader>
            {sel.situacao === "nao_suportado" ? (
              <CardContent>
                <Alerta tom="info">{sel.erro ?? "Arquivo guardado. A conferência com os XML lê, por enquanto, a EFD ICMS/IPI."}</Alerta>
              </CardContent>
            ) : sel.situacao === "erro" ? (
              <CardContent>
                <Alerta tom="perigo">{sel.erro ?? "Não foi possível ler o arquivo."}</Alerta>
              </CardContent>
            ) : sel.situacao === "processando" ? (
              <CardContent>
                <Alerta tom="info">Lendo o arquivo e conferindo com os XML. Esta página se atualiza sozinha.</Alerta>
              </CardContent>
            ) : null}
          </Card>

          {resumo ? (
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Indicador
                rotulo="Notas no arquivo"
                valor={n(resumo.documentos).toLocaleString("pt-BR")}
                detalhe={`${n(resumo.saidas)} saídas · ${n(resumo.entradas)} entradas${resumo.canceladas ? ` · ${resumo.canceladas} canceladas` : ""}`}
                icone={ListChecks}
              />
              <Indicador
                rotulo="Com XML no portal"
                valor={n(resumo.com_xml).toLocaleString("pt-BR")}
                detalhe={`XML do mês: ${n(resumo.xml_emitidas)} emitidas · ${n(resumo.xml_recebidas)} recebidas`}
                icone={FileCheck2}
              />
              <Indicador rotulo="Corrigir" valor={n(resumo.alta)} detalhe="antes de transmitir" tom={resumo.alta ? "perigo" : "sucesso"} icone={AlertTriangle} />
              <Indicador
                rotulo="Conferir"
                valor={n(resumo.media)}
                detalhe={`${n(resumo.baixa)} ${n(resumo.baixa) === 1 ? "informação" : "informações"}`} tom={resumo.media ? "alerta" : "neutro"} icone={AlertTriangle} />
            </div>
          ) : null}

          {sel.situacao === "conferido" && !grupos.length ? (
            <Alerta tom="sucesso" className="mb-4" titulo="As notas escrituradas batem com os XML do portal">
              Nenhuma nota emitida ou recebida no mês ficou de fora, e valores, ICMS e situações conferem.
            </Alerta>
          ) : null}

          {grupos.map((g) => {
            const regra = REGRAS_SPED[g.regra] ?? { titulo: g.regra, explicacao: "" };
            const grav = GRAVIDADE_SPED[g.itens[0].gravidade] ?? GRAVIDADE_SPED.baixa;
            const temDiferenca = g.itens.some((d) => d.diferenca !== null);
            return (
              <Card key={g.regra} className="mb-4">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {regra.titulo}
                    <Badge variante={grav.variante}>{grav.rotulo}</Badge>
                    <span className="text-sm font-normal text-muted-foreground">
                      {g.itens.length} {g.itens.length === 1 ? "nota" : "notas"}
                    </span>
                  </CardTitle>
                  <CardDescription>{regra.explicacao}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Nota</Th>
                        <Th className="hidden sm:table-cell">Data</Th>
                        <Th className="hidden md:table-cell">Cliente ou fornecedor</Th>
                        <Th className="text-right">No SPED</Th>
                        <Th className="text-right">No XML</Th>
                        {temDiferenca ? <Th className="hidden text-right sm:table-cell">Diferença</Th> : null}
                      </Tr>
                    </THead>
                    <TBody>
                      {g.itens.slice(0, LIMITE_POR_REGRA).map((d) => {
                        const xml = d.xml as { documento_id: string } | null;
                        return (
                          <Tr key={d.id}>
                            <Td>
                              <span className="font-medium">
                                {d.modelo === "65" ? "NFC-e" : "NF-e"} {d.numero ?? "—"}
                                {d.serie ? `/${d.serie.replace(/^0+(?=\d)/, "")}` : ""}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {d.operacao === "saida" ? "Saída" : d.operacao === "entrada" ? "Entrada" : ""}
                                {d.chave ? ` · ${d.chave.slice(0, 6)}…${d.chave.slice(-6)}` : ""}
                              </span>
                              {xml?.documento_id ? (
                                <Link href={`${base}/documentos/${xml.documento_id}`} className="text-xs text-primary hover:underline">
                                  Ver XML
                                </Link>
                              ) : null}
                              {g.regra === "duplicada" && d.detalhe ? <span className="block text-xs text-muted-foreground">{d.detalhe}</span> : null}
                            </Td>
                            <Td className="hidden sm:table-cell">{formatarData(d.data)}</Td>
                            <Td className="hidden max-w-60 truncate md:table-cell">{d.participante ?? "—"}</Td>
                            <Td className="text-right numero whitespace-nowrap">{d.valor_sped !== null ? formatarMoeda(d.valor_sped) : "—"}</Td>
                            <Td className="text-right numero whitespace-nowrap">{d.valor_xml !== null ? formatarMoeda(d.valor_xml) : "—"}</Td>
                            {temDiferenca ? (
                              <Td className="hidden text-right numero whitespace-nowrap sm:table-cell">
                                {d.diferenca !== null ? formatarMoeda(d.diferenca, { sinal: true }) : "—"}
                              </Td>
                            ) : null}
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                  {g.itens.length > LIMITE_POR_REGRA ? (
                    <p className="mt-2 text-xs text-muted-foreground">Mostrando as primeiras {LIMITE_POR_REGRA} de {g.itens.length}.</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}

          {apuracao || totais.analitico?.length ? (
            <div className="mb-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              {apuracao ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Apuração do ICMS (registro E110)</CardTitle>
                    <CardDescription>Como está no arquivo.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-1.5 text-sm">
                      {[
                        ["Débitos pelas saídas", apuracao.debitos],
                        ["Ajustes e estornos a débito", n(apuracao.ajustes_debito) + n(apuracao.estornos_credito)],
                        ["Créditos pelas entradas", apuracao.creditos],
                        ["Ajustes e estornos a crédito", n(apuracao.ajustes_credito) + n(apuracao.estornos_debito)],
                        ["Saldo credor do mês anterior", apuracao.saldo_credor_anterior],
                        ["Deduções", apuracao.deducoes],
                      ].map(([rotulo, valor]) => (
                        <div key={String(rotulo)} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{rotulo}</dt>
                          <dd className="numero">{formatarMoeda(valor)}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
                        <dt>ICMS a recolher</dt>
                        <dd className="numero">{formatarMoeda(apuracao.a_recolher)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Saldo credor para o mês seguinte</dt>
                        <dd className="numero">{formatarMoeda(apuracao.saldo_credor_transportar)}</dd>
                      </div>
                      {n(apuracao.extra_apuracao) ? (
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Extra-apuração</dt>
                          <dd className="numero">{formatarMoeda(apuracao.extra_apuracao)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </CardContent>
                </Card>
              ) : null}
              {totais.analitico?.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Notas por CFOP (registro C190)</CardTitle>
                    <CardDescription>
                      Saídas: {formatarMoeda(resumo?.valor_saidas ?? 0)} · entradas: {formatarMoeda(resumo?.valor_entradas ?? 0)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <THead>
                        <Tr>
                          <Th>CFOP</Th>
                          <Th className="text-right">Operações</Th>
                          <Th className="text-right">ICMS</Th>
                          <Th className="hidden text-right sm:table-cell">ICMS-ST</Th>
                          <Th className="hidden text-right sm:table-cell">IPI</Th>
                        </Tr>
                      </THead>
                      <TBody>
                        {totais.analitico.map((a) => (
                          <Tr key={a.cfop}>
                            <Td className="numero">{a.cfop}</Td>
                            <Td className="text-right numero whitespace-nowrap">{formatarMoeda(a.valor_operacao)}</Td>
                            <Td className="text-right numero whitespace-nowrap">{formatarMoeda(a.icms)}</Td>
                            <Td className="hidden text-right numero whitespace-nowrap sm:table-cell">{formatarMoeda(a.icms_st)}</Td>
                            <Td className="hidden text-right numero whitespace-nowrap sm:table-cell">{formatarMoeda(a.ipi)}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {lista.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Arquivos recebidos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <Tr>
                  <Th>Período</Th>
                  <Th className="hidden md:table-cell">Arquivo</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Corrigir</Th>
                  <Th className="hidden text-right sm:table-cell">Conferir</Th>
                </Tr>
              </THead>
              <TBody>
                {lista.map((a) => {
                  const s = SITUACAO_SPED[a.situacao] ?? { rotulo: a.situacao, variante: "neutro" as const };
                  const r = (a.resumo ?? null) as Resumo | null;
                  return (
                    <Tr key={a.id} className={a.id === sel?.id ? "bg-muted/50" : undefined}>
                      <Td>
                        <Link href={urlCom(`${base}/auditor-fiscal/sped`, {}, { arquivo: a.id })} className="font-medium text-primary hover:underline">
                          {formatarCompetencia(a.periodo_inicio, true)}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {TIPO_SPED[a.tipo] ?? a.tipo}
                          {a.vigente ? "" : " · substituído"}
                        </span>
                      </Td>
                      <Td className="hidden max-w-72 truncate md:table-cell">{a.nome_arquivo}</Td>
                      <Td>
                        <Badge variante={s.variante}>{s.rotulo}</Badge>
                      </Td>
                      <Td className="text-right numero">{r ? n(r.alta) : "—"}</Td>
                      <Td className="hidden text-right numero sm:table-cell">{r ? n(r.media) : "—"}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
