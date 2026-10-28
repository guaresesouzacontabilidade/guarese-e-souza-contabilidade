import type { Metadata } from "next";
import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import { BotaoRelerEfd, FormCodigoAjuste, FormConfiguracaoEfd, FormGerarEfd } from "@/components/efd/gerador";
import { FormDarIcms } from "@/components/dar-mt/gerar-dar";
import { carregarDadosDar } from "@/lib/dar-mt/carregar";
import { envPublico } from "@/lib/env";
import { TIPOS_LANCAMENTO_ICMS } from "@/lib/calculos/icms";
import { competenciaDosCalculos } from "@/lib/calculos/competencias";
import { carregarEfd } from "@/lib/efd/carregar";
import { gerarEfd, type ApuracaoE110, type PendenciaEfd } from "@/lib/efd/gerar";
import { competenciaAtual, somarMeses } from "@/lib/competencia";
import { parametro } from "@/lib/busca";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "EFD ICMS/IPI" };

const TOM: Record<PendenciaEfd["nivel"], "perigo" | "alerta" | "info"> = { bloqueio: "perigo", confirmar: "alerta", aviso: "info" };
const PVA = "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/sped-sistema-publico-de-escrituracao-digital/escrituracao-fiscal-digital-efd/escrituracao-fiscal-digital-efd";
const TABELAS = "https://www.sped.fazenda.gov.br/spedtabelas/AppConsulta/publico/aspx/ConsultaTabelasExternas.aspx?CodSistema=SpedFiscal";

function opcoesMeses() {
  const lista: { valor: string; rotulo: string }[] = [];
  for (let c = competenciaAtual(), i = 0; i < 24; i++, c = somarMeses(c, -1)) {
    const r = formatarCompetencia(c, true);
    lista.push({ valor: c.slice(0, 7), rotulo: r.charAt(0).toUpperCase() + r.slice(1) });
  }
  return lista;
}

function LinhasApuracao({ a }: { a: ApuracaoE110 }) {
  const linhas: [string, string, boolean?][] = [
    ["Débitos das saídas (C190 e D190)", a.debitos],
    ["(+) Outros débitos (E111)", a.ajustes_debito],
    ["(+) Estornos de crédito (E111)", a.estornos_credito],
    ["(−) Créditos das entradas (C190 e D190)", a.creditos],
    ["(−) Ajustes por documento (D197: crédito presumido)", a.ajustes_credito_documentos],
    ["(−) Outros créditos (E111)", a.ajustes_credito],
    ["(−) Estornos de débito (E111)", a.estornos_debito],
    ["(−) Saldo credor do mês anterior", a.saldo_credor_anterior],
    ["Saldo devedor", a.saldo_devedor, true],
    ["(−) Deduções (E111)", a.deducoes],
    ["ICMS a recolher (E116)", a.a_recolher, true],
    ["Saldo credor para o mês seguinte", a.saldo_credor_transportar, true],
  ];
  return (
    <Table>
      <TBody>
        {linhas
          .filter(([, v, forte]) => forte || Number(v) !== 0)
          .map(([rotulo, v, forte]) => (
            <Tr key={rotulo}>
              <Td className={forte ? "font-semibold text-titulo" : "text-muted-foreground"}>{rotulo}</Td>
              <Td className={`text-right numero ${forte ? "font-bold text-titulo" : ""}`}>{formatarMoeda(v)}</Td>
            </Tr>
          ))}
      </TBody>
    </Table>
  );
}

export default async function PaginaEfd({ params, searchParams }: PageProps<"/e/[empresaId]/calculos/efd">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.gerenciar")) return <Alerta tom="alerta">A EFD ICMS/IPI é gerada pela equipe do escritório.</Alerta>;
  const comp = competenciaDosCalculos(parametro(sp, "competencia"));
  const mes = formatarCompetencia(comp, true);
  const base = `/e/${empresaId}`;
  const cabecalho = (
    <CabecalhoPagina
      titulo="EFD ICMS/IPI (SPED Fiscal)"
      descricao="Gera o arquivo do mês a partir das notas guardadas no portal e da Apuração do ICMS. O escritório valida, assina e transmite no programa da Receita (PVA): o portal não transmite nada."
      acoes={<SeletorCompetencia valor={comp.slice(0, 7)} opcoes={opcoesMeses()} />}
    />
  );
  const carregado = await carregarEfd(ctx.supabase, empresaId, comp);
  if ("erro" in carregado) {
    return (
      <>
        {cabecalho}
        <Alerta tom="perigo">{carregado.erro}</Alerta>
      </>
    );
  }
  const { dados, icms, vencimentoSugerido } = carregado;
  // Prévia: as mesmas contas da geração, com as confirmações dadas, para mostrar pendências e totais
  const previa = gerarEfd(dados, icms, { finalidade: 0, vencimento: vencimentoSugerido, confirmadas: ["mes_aberto", "sem_saidas", "sem_xml", "inventario", "municipios"] });
  const semVencimento = gerarEfd(dados, icms, { finalidade: 0, vencimento: vencimentoSugerido });
  // Onde resolver o que depende do cadastro da empresa (telas do escritório)
  const links: Record<string, PendenciaEfd["link"]> = {
    regime: { rotulo: "Abrir o perfil da empresa", href: `/escritorio/obrigacoes/empresas/${empresaId}` },
    empresa: { rotulo: "Abrir o cadastro da empresa", href: `/escritorio/empresas/${empresaId}` },
  };
  const pendencias = semVencimento.pendencias
    .filter((p) => !(p.id === "vencimento" && vencimentoSugerido))
    .map((p) => (p.link || !links[p.id] ? p : { ...p, link: links[p.id] }));
  const bloqueios = pendencias.filter((p) => p.nivel === "bloqueio" && p.id !== "vencimento");
  const confirmar = pendencias.filter((p) => p.nivel === "confirmar").map((p) => ({ id: p.id, titulo: p.titulo }));
  const aRecolher = Number(previa.resumo.apuracao.a_recolher) > 0;
  const lancamentos = icms.dados.lancamentos.filter((l) => l.tipo !== "guia_extra");
  const resumo = previa.resumo;
  const regimeNormal = icms.resultado.modo === "normal";
  const notas = dados.notas;
  // DAR do ICMS (SEFAZ-MT): robô do portal oficial
  const darCarregado = dados.empresa.uf === "MT" && regimeNormal ? await carregarDadosDar(ctx.supabase, empresaId, comp) : null;
  const dar = darCarregado && "dados" in darCarregado ? darCarregado.dados : null;
  const fimDoMes = dar ? new Date(Date.UTC(Number(dar.hoje.slice(0, 4)), Number(dar.hoje.slice(5, 7)), 0)).toISOString().slice(0, 10) : "";

  return (
    <>
      {cabecalho}
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador rotulo="Notas de entrada" valor={notas.filter((n) => n.operacao === "entrada" && n.modelo !== "57").length} detalhe={`${mes}`} />
          <Indicador rotulo="Notas de saída" valor={notas.filter((n) => n.operacao === "saida" && n.modelo !== "57").length} tom={notas.some((n) => n.operacao === "saida") ? "neutro" : "alerta"} />
          <Indicador rotulo="CT-e" valor={notas.filter((n) => n.modelo === "57").length} />
          <Indicador
            rotulo="ICMS a recolher no arquivo"
            valor={formatarMoeda(resumo.apuracao.a_recolher)}
            detalhe={Number(resumo.apuracao.saldo_credor_transportar) > 0 ? `Saldo credor: ${formatarMoeda(resumo.apuracao.saldo_credor_transportar)}` : undefined}
          />
        </div>

        {pendencias.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Antes de gerar</CardTitle>
              <CardDescription>
                Em vermelho, o que impede a geração; em amarelo, o que precisa da sua confirmação; em azul, avisos para conferir no PVA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendencias.map((p) => (
                <Alerta
                  key={p.id}
                  tom={TOM[p.nivel]}
                  titulo={p.titulo}
                  acao={
                    p.acao === "reler" ? (
                      <BotaoRelerEfd empresaId={empresaId} competencia={comp} />
                    ) : p.link ? (
                      <Link href={p.link.href} className="text-sm font-medium underline">
                        {p.link.rotulo}
                      </Link>
                    ) : undefined
                  }
                >
                  {p.detalhe}
                </Alerta>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Alerta tom="sucesso" titulo="Tudo pronto para gerar">
            Nenhuma pendência encontrada para {mes}.
          </Alerta>
        )}

        <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
          <div className="space-y-5 xl:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gerar o arquivo de {mes}</CardTitle>
                <CardDescription>
                  O arquivo fica guardado aqui (área privada da equipe). Depois, abra no PVA da EFD ICMS/IPI, valide, assine com o certificado digital da empresa e transmita.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormGerarEfd
                  empresaId={empresaId}
                  competencia={comp}
                  confirmar={confirmar}
                  vencimento={vencimentoSugerido}
                  pedeVencimento={aRecolher}
                  bloqueado={bloqueios.length > 0}
                />
              </CardContent>
            </Card>

            {regimeNormal ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Prévia da apuração (registro E110)</CardTitle>
                  <CardDescription>
                    Calculada dos registros analíticos do arquivo, como o PVA confere. {resumo.notas.entradas} entradas, {resumo.notas.saidas} saídas
                    {resumo.notas.canceladas ? `, ${resumo.notas.canceladas} canceladas` : ""}; {resumo.participantes} participantes e {resumo.itens} itens.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LinhasApuracao a={resumo.apuracao} />
                </CardContent>
              </Card>
            ) : null}

            {lancamentos.length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Códigos de ajuste dos lançamentos (registro E111)</CardTitle>
                  <CardDescription>
                    Cada valor lançado na Apuração do ICMS precisa do código da{" "}
                    <a href={TABELAS} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                      tabela 5.1.1 do estado
                    </a>{" "}
                    (8 caracteres: UF, 0, o tipo do ajuste e 4 números).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Lançamento</Th>
                        <Th className="text-right">Valor</Th>
                        <Th>Código</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {lancamentos.map((l) => (
                        <Tr key={l.id}>
                          <Td>
                            <span className="font-medium">{l.descricao}</span>
                            <span className="block text-xs text-muted-foreground">{TIPOS_LANCAMENTO_ICMS[l.tipo].rotulo}</span>
                          </Td>
                          <Td className="text-right numero">{formatarMoeda(l.valor)}</Td>
                          <Td>
                            <FormCodigoAjuste empresaId={empresaId} id={l.id} tipo={l.tipo} codigo={dados.lancamentos_codigos[l.id] ?? null} uf={dados.empresa.uf} />
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Arquivos gerados em {mes}</CardTitle>
              </CardHeader>
              <CardContent>
                {dados.geracoes.length ? (
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Gerado em</Th>
                        <Th className="hidden sm:table-cell">Por</Th>
                        <Th className="text-right">ICMS a recolher</Th>
                        <Th />
                      </Tr>
                    </THead>
                    <TBody>
                      {dados.geracoes.map((g) => (
                        <Tr key={g.id}>
                          <Td>
                            {formatarDataHora(g.criado_em)}
                            <span className="block text-xs text-muted-foreground">
                              {g.linhas} linhas{g.finalidade === 1 ? " · substituto" : ""}
                            </span>
                          </Td>
                          <Td className="hidden sm:table-cell">{g.gerado_por ?? "—"}</Td>
                          <Td className="text-right numero">{"apuracao" in g.resumo ? formatarMoeda(g.resumo.apuracao.a_recolher) : "—"}</Td>
                          <Td className="text-right">
                            <a href={`/api/efd/${empresaId}/${g.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" aria-label={`Baixar o arquivo gerado em ${formatarDataHora(g.criado_em)}`}>
                              <Download className="size-4" /> Baixar
                            </a>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum arquivo gerado para este mês.</p>
                )}
              </CardContent>
            </Card>

            {dar ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">DAR do ICMS de {mes} (SEFAZ-MT)</CardTitle>
                  <CardDescription>
                    O robô preenche o DAR-1/AUT no site da SEFAZ-MT (receita 1112 — ICMS normal), com a multa e os juros de atraso, baixa o PDF oficial e publica na agenda
                    de pagamentos da empresa. Gere depois de transmitir a EFD, com o mesmo valor do registro E116.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dar.efd && Number(dar.efd.a_recolher ?? 0) !== Number(resumo.apuracao.a_recolher) ? (
                    <Alerta tom="alerta">
                      O último arquivo gerado ({formatarDataHora(dar.efd.created_at)}) tem {formatarMoeda(dar.efd.a_recolher ?? 0)} a recolher, mas a apuração de hoje dá{" "}
                      {formatarMoeda(resumo.apuracao.a_recolher)}. O DAR deve ter o valor da EFD transmitida: se mudou algo, gere o arquivo de novo (retificadora) antes.
                    </Alerta>
                  ) : null}
                  <FormDarIcms
                    empresaId={empresaId}
                    competencia={comp.slice(0, 7)}
                    valor={formatarMoeda(dar.efd?.a_recolher ?? resumo.apuracao.a_recolher, { semSimbolo: true })}
                    vencimento={dar.efd?.vencimento ?? vencimentoSugerido}
                    pagamento={dar.ultimo_dia_util >= dar.hoje ? dar.ultimo_dia_util : dar.hoje}
                    hoje={dar.hoje}
                    fimDoMes={fimDoMes}
                    disponivel={envPublico.ambiente() === "producao" && !dar.empresa.demonstracao}
                    temVigente={dar.emissoes.some((e) => e.vencimento >= dar.hoje)}
                  />
                  {dar.emissoes.length ? (
                    <Table>
                      <THead>
                        <Tr>
                          <Th>DAR</Th>
                          <Th className="text-right">Total</Th>
                          <Th className="hidden sm:table-cell">Pagar até</Th>
                          <Th />
                        </Tr>
                      </THead>
                      <TBody>
                        {dar.emissoes.map((e) => (
                          <Tr key={e.id}>
                            <Td>
                              <span className="numero">nº {e.numero}</span>
                              <span className="block text-xs text-muted-foreground">
                                {formatarDataHora(e.created_at)}
                                {e.gerado_por ? ` · ${e.gerado_por}` : ""}
                              </span>
                            </Td>
                            <Td className="text-right numero">
                              {formatarMoeda(e.total)}
                              {Number(e.multa) + Number(e.juros) > 0 ? (
                                <span className="block text-xs text-muted-foreground">com {formatarMoeda(Number(e.multa) + Number(e.juros))} de multa e juros</span>
                              ) : null}
                            </Td>
                            <Td className="hidden sm:table-cell">
                              {formatarData(e.vencimento)}
                              {e.vencimento < dar.hoje ? <Badge variante="neutro" className="ml-1">vencido</Badge> : null}
                            </Td>
                            <Td className="text-right">
                              {e.documento_id ? (
                                <Link href={`${base}/documentos/${e.documento_id}`} className="text-sm font-medium text-primary hover:underline">
                                  Abrir a guia
                                </Link>
                              ) : null}
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuração da EFD da empresa</CardTitle>
              </CardHeader>
              <CardContent>
                <FormConfiguracaoEfd
                  empresaId={empresaId}
                  perfil={dados.config?.perfil ?? "A"}
                  codigoReceita={dados.config?.codigo_receita ?? null}
                  uf={dados.empresa.uf}
                  presumido={icms.dados.credito_presumido_cte ? { percentual: String(icms.dados.credito_presumido_cte.percentual), codigo: icms.dados.credito_presumido_cte.codigo } : null}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Como entregar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ol className="list-decimal space-y-2 pl-5">
                  <li>Gere e baixe o arquivo do mês.</li>
                  <li>
                    No computador do escritório, abra o{" "}
                    <a href={PVA} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium underline">
                      PVA da EFD ICMS/IPI <ExternalLink className="size-3" />
                    </a>{" "}
                    e importe o arquivo.
                  </li>
                  <li>Corrija o que o PVA apontar (o portal avisa acima o que ainda não gera).</li>
                  <li>Assine com o certificado digital da empresa ou do contador com procuração e transmita.</li>
                  <li>
                    Guarde o recibo e envie o arquivo transmitido em Documentos (categoria SPED Fiscal): ele aparece na{" "}
                    <Link href={`${base}/auditor-fiscal/sped`} className="font-medium underline">
                      Conferência do SPED
                    </Link>
                    , que compara com os XML.
                  </li>
                </ol>
                <p className="text-xs text-muted-foreground">
                  Prazo da EFD: definido pela SEFAZ de cada estado (em geral, dia 15 a 25 do mês seguinte). Veja em Obrigações e prazos.
                </p>
                <p className="text-xs text-muted-foreground">
                  Os valores vêm da{" "}
                  <Link href={`${base}/calculos/icms?competencia=${comp.slice(0, 7)}`} className="font-medium underline">
                    Apuração do ICMS
                  </Link>
                  {icms.dados.apuracao?.conferida_em ? `, conferida em ${formatarData(icms.dados.apuracao.conferida_em)}` : " (mês ainda não conferido)"}.
                </p>
                {previa.foraDoArquivo.length ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium">
                      <Badge variante="neutro">{previa.foraDoArquivo.length}</Badge> {previa.foraDoArquivo.length === 1 ? "nota fora" : "notas fora"} do arquivo
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                      {previa.foraDoArquivo.map((f, i) => (
                        <li key={i}>
                          {f.nota}: {f.motivo}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
