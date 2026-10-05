import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, CloudDownload, FileArchive, KeyRound, ShieldCheck } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import {
  ApagarNotasAnteriores,
  BotaoBuscarAgora,
  BotaoPedirXml,
  FormCertificado,
  MesInicialNotas,
  PreferenciasNotas,
  RemoverCertificado,
} from "@/components/notas-automaticas/notas-automaticas";
import { FormPlanilhaEntradas } from "@/components/notas-automaticas/planilha-entradas";
import { FormLoteXml } from "@/components/lotes-xml/form-lote";
import { TabelaLotes, emPreparo, type LoteXml } from "@/components/lotes-xml/tabela-lotes";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { pedirLoteXml } from "@/lib/lotes-xml/acoes";
import { mesesDoLote } from "@/lib/lotes-xml/rotulos";
import {
  AUTORIZACAO_CLIENTE,
  AUTORIZACAO_ESCRITORIO,
  RESULTADO_EXECUCAO,
  SERVICO_EXECUCAO,
  SITUACAO_NOTAS,
  situacaoNotas,
} from "@/lib/notas-automaticas/rotulos";
import { envServidor } from "@/lib/env-servidor";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCnpj, formatarCompetencia, formatarData, formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { competenciaAtual, diasEntre, hojeISO } from "@/lib/competencia";

export const metadata: Metadata = { title: "Notas automáticas" };

export default async function NotasAutomaticas({ params }: PageProps<"/e/[empresaId]/notas-automaticas">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const gerenciar = ctx.pode("certificado.gerenciar");
  const verDocumentos = ctx.pode("documentos.ver");
  const baixar = ctx.pode("documentos.baixar");
  const admin = ctx.acesso.papel === "admin";
  if (!gerenciar && !verDocumentos) return <Alerta tom="alerta">Seu acesso não inclui as notas automáticas desta empresa.</Alerta>;
  const base = `/e/${empresaId}`;

  const [{ data: certificado }, { data: config }, { data: execucoes }, { data: resumos }, { data: lotes }, { data: porMes }] = await Promise.all([
    gerenciar
      ? ctx.supabase
          .from("certificados_digitais")
          .select("id, titular, documento, emissor, numero_serie, impressao_digital, valido_de, valido_ate, autorizacao, created_at, cadastrado:perfis!certificados_digitais_cadastrado_por_fkey(nome)")
          .eq("empresa_id", empresaId)
          .is("revogado_em", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.supabase.from("notas_automaticas").select("*").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase
      .from("notas_automaticas_execucoes")
      .select("id, servico, iniciado_em, resultado, documentos, resumos, ignorados, codigo, mensagem")
      .eq("empresa_id", empresaId)
      .order("iniciado_em", { ascending: false })
      .limit(15),
    verDocumentos
      ? ctx.supabase
          .from("nfe_resumos")
          .select("id, chave, emitente_documento, emitente_nome, data_emissao, tipo_operacao, valor, situacao, ciencia_em, ciencia_retorno, documento_id")
          .eq("empresa_id", empresaId)
          .order("data_emissao", { ascending: false, nullsFirst: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    baixar
      ? ctx.supabase
          .from("xml_lotes")
          .select("id, empresa_id, competencia, tipos, situacao, partes, total_arquivos, resumo, erro, criado_em, expira_em")
          .eq("empresa_id", empresaId)
          .order("criado_em", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    verDocumentos ? ctx.supabase.rpc("notas_automaticas_por_mes", { p_empresa_id: empresaId }) : Promise.resolve({ data: [] }),
  ]);
  // NF-e recebidas só em resumo (sem o XML completo), pela situação da ciência da emissão
  const soResumo = () =>
    ctx.supabase.from("nfe_resumos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("situacao", "autorizada").is("documento_id", null);
  const [{ count: semCiencia }, { count: xmlACaminho }, { count: cienciaRecusada }] = verDocumentos
    ? await Promise.all([
        soResumo().is("ciencia_em", null).is("ciencia_retorno", null),
        soResumo().not("ciencia_em", "is", null),
        soResumo().is("ciencia_em", null).not("ciencia_retorno", "is", null),
      ])
    : [{ count: 0 }, { count: 0 }, { count: 0 }];
  const listaLotes = (lotes ?? []) as LoteXml[];
  const { meses, padrao } = mesesDoLote(competenciaAtual());
  const situacao = situacaoNotas(config?.certificado_valido_ate ? { valido_ate: config.certificado_valido_ate } : null, config);
  const s = SITUACAO_NOTAS[situacao];
  const chaveServidor = Boolean(envServidor.certificadosChave());
  const diasValidade = certificado ? diasEntre(hojeISO(), certificado.valido_ate.slice(0, 10)) : null;
  const cadastradoPor = (certificado?.cadastrado as unknown as { nome: string } | null)?.nome ?? null;
  const semXml = (semCiencia ?? 0) + (xmlACaminho ?? 0) + (cienciaRecusada ?? 0);
  const cienciaLigada = Boolean(config?.ciencia_automatica && config.nfe_ativa && !config.pausada);
  const certificadoValido = situacao !== "desconectada" && situacao !== "vencido";
  const meses_ = porMes ?? [];
  const desde = config?.buscar_desde ?? null;
  const anteriores = desde ? meses_.filter((m) => m.competencia < desde).reduce((t, m) => t + m.total, 0) : 0;
  const rotuloDesde = desde ? formatarCompetencia(desde, true) : null;

  return (
    <>
      <CabecalhoPagina
        titulo="Notas automáticas"
        descricao="Busca das notas fiscais da empresa direto nos serviços oficiais (SEFAZ – Ambiente Nacional da NF-e e Ambiente Nacional da NFS-e) com o certificado digital A1. As notas chegam em Documentos sem ninguém precisar enviar."
        acoes={gerenciar && certificado && situacao !== "vencido" ? <BotaoBuscarAgora empresaId={empresaId} /> : undefined}
      />

      {envServidor.notasSemRede() ? (
        <Alerta tom="info" className="mb-4" titulo="Consultas desligadas neste ambiente">
          Este é um ambiente de demonstração ou de teste: o portal não consulta a SEFAZ nem o Ambiente Nacional daqui. No portal oficial, a busca funciona
          com o certificado da empresa.
        </Alerta>
      ) : null}
      <div className="mb-4 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Situação <Badge variante={s.tom}>{s.rotulo}</Badge>
            </CardTitle>
            <CardDescription>
              {situacao === "desconectada"
                ? "Desligada até o cadastro do certificado digital A1 da empresa. Nenhuma consulta é feita sem ele."
                : situacao === "vencido"
                  ? "O certificado venceu. Cadastre o certificado renovado para voltar a buscar as notas."
                  : situacao === "pausada"
                    ? "A busca está pausada ou sem nenhum serviço marcado."
                    : "O portal consulta os serviços oficiais de hora em hora."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {config?.ultima_execucao ? (
              <p>
                <span className="text-muted-foreground">Última busca:</span> {formatarRelativo(config.ultima_execucao)}
              </p>
            ) : null}
            {config?.ultimo_sucesso ? (
              <p>
                <span className="text-muted-foreground">Última busca sem erro:</span> {formatarDataHora(config.ultimo_sucesso)}
              </p>
            ) : null}
            {situacao === "ativa" || situacao === "erro" ? (
              <>
                {config?.nfe_ativa && config.nfe_proxima ? (
                  <p>
                    <span className="text-muted-foreground">Próxima consulta da NF-e:</span> {formatarDataHora(config.nfe_proxima)}
                  </p>
                ) : null}
                {config?.nfse_ativa && config.nfse_proxima ? (
                  <p>
                    <span className="text-muted-foreground">Próxima consulta da NFS-e:</span> {formatarDataHora(config.nfse_proxima)}
                  </p>
                ) : null}
              </>
            ) : null}
            {config?.ultimo_erro && situacao !== "desconectada" ? (
              <Alerta tom="perigo" titulo="Último erro">
                {config.ultimo_erro}
              </Alerta>
            ) : null}
            {verDocumentos && semXml > 0 ? (
              <p className="text-alerta-fg">
                <Link href="#nfe-recebidas" className="underline-offset-4 hover:underline">
                  {semXml === 1 ? "1 NF-e recebida só em resumo" : `${semXml} NF-e recebidas só em resumo`}
                </Link>{" "}
                (sem o XML completo).
              </p>
            ) : null}
          </CardContent>
        </Card>

        {gerenciar ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4" /> Certificado digital A1
              </CardTitle>
              <CardDescription>
                O portal não guarda a senha do certificado: o arquivo é aberto uma vez, no cadastro, e a chave fica guardada cifrada, usada só pelo servidor
                para falar com a SEFAZ e o Ambiente Nacional. Ninguém consegue baixá-la pelo portal. Você pode removê-la a qualquer momento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!chaveServidor ? (
                <Alerta tom="alerta" titulo="Cadastro ainda indisponível">
                  {ctx.equipe
                    ? "Falta configurar no servidor a chave de criptografia dos certificados (CERTIFICADOS_CHAVE). Sem ela, nenhum certificado é aceito."
                    : "O escritório ainda está ativando esta função. Tente de novo mais tarde ou fale com o escritório."}
                </Alerta>
              ) : null}
              {certificado ? (
                <>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Titular</dt>
                      <dd className="font-medium break-words">{certificado.titular}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">CNPJ</dt>
                      <dd>{certificado.documento ? formatarCnpj(certificado.documento) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Validade</dt>
                      <dd className={diasValidade !== null && diasValidade <= 30 ? "font-medium text-perigo" : ""}>
                        {formatarData(certificado.valido_de.slice(0, 10))} a {formatarData(certificado.valido_ate.slice(0, 10))}
                        {diasValidade !== null ? (diasValidade < 0 ? " (vencido)" : ` (${diasValidade} ${diasValidade === 1 ? "dia" : "dias"})`) : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Emitido por</dt>
                      <dd className="break-words">{certificado.emissor ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Cadastrado</dt>
                      <dd>
                        {formatarDataHora(certificado.created_at)}
                        {cadastradoPor ? ` por ${cadastradoPor}` : ""} ·{" "}
                        {certificado.autorizacao === "cliente_no_portal" ? "autorizado pelo cliente no portal" : "com autorização escrita do cliente"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Impressão digital (SHA-256)</dt>
                      <dd className="font-mono text-xs break-all">{certificado.impressao_digital.match(/.{1,2}/g)?.slice(0, 8).join(":")}…</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {chaveServidor ? <FormCertificado empresaId={empresaId} textoAutorizacao={ctx.equipe ? AUTORIZACAO_ESCRITORIO : AUTORIZACAO_CLIENTE} troca /> : null}
                    <RemoverCertificado empresaId={empresaId} />
                  </div>
                </>
              ) : chaveServidor ? (
                <FormCertificado
                  empresaId={empresaId}
                  textoAutorizacao={ctx.equipe ? AUTORIZACAO_ESCRITORIO : AUTORIZACAO_CLIENTE}
                  meses={meses}
                  mesPadrao={desde ? desde.slice(0, 7) : padrao}
                />
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {gerenciar && certificado && config ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>O que buscar</CardTitle>
            <CardDescription>A SEFAZ permite uma consulta por hora quando não há documentos novos; o portal segue essa regra.</CardDescription>
          </CardHeader>
          <CardContent>
            <PreferenciasNotas empresaId={empresaId} nfe={config.nfe_ativa} nfse={config.nfse_ativa} ciencia={config.ciencia_automatica} pausada={config.pausada} />
          </CardContent>
        </Card>
      ) : null}

      {verDocumentos || (gerenciar && config) ? (
        <Card className="mb-4 scroll-mt-20" id="por-mes">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="size-4" /> Notas por mês
            </CardTitle>
            <CardDescription>
              A SEFAZ e o Ambiente Nacional entregam as notas numa fila, da mais antiga para a mais nova, sem consulta por mês. O portal guarda só as
              emitidas a partir do mês inicial e organiza tudo pelo mês de emissão.
              {rotuloDesde ? (
                <>
                  {" "}
                  Mês inicial: <strong>{rotuloDesde}</strong>.
                </>
              ) : config ? (
                <>
                  {" "}
                  <strong>Sem mês inicial:</strong> a busca traz tudo o que os serviços ainda disponibilizam.
                </>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {gerenciar && config ? <MesInicialNotas empresaId={empresaId} atual={desde} meses={meses} /> : null}
            {anteriores > 0 && rotuloDesde ? (
              <Alerta
                tom="alerta"
                titulo={`${anteriores === 1 ? "1 arquivo anterior" : `${anteriores} arquivos anteriores`} a ${rotuloDesde} no portal`}
                acao={admin ? <ApagarNotasAnteriores empresaId={empresaId} quantidade={anteriores} mesInicial={rotuloDesde} /> : undefined}
              >
                Foram trazidos antes da escolha do mês inicial e continuam em Documentos.
                {admin ? " O administrador pode apagá-los do portal." : " Só o administrador do escritório pode apagá-los."}
              </Alerta>
            ) : null}
            {verDocumentos ? (
              meses_.length ? (
                <div className="-mx-4 sm:-mx-6">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Mês de emissão</Th>
                        <Th className="hidden text-right sm:table-cell">NF-e de entrada</Th>
                        <Th className="hidden text-right sm:table-cell">NF-e de saída</Th>
                        <Th className="hidden text-right md:table-cell">NFS-e prestadas</Th>
                        <Th className="hidden text-right md:table-cell">NFS-e tomadas</Th>
                        <Th className="hidden text-right lg:table-cell">Outros</Th>
                        <Th className="text-right">Total</Th>
                        <Th className="w-16" />
                      </Tr>
                    </THead>
                    <TBody>
                      {meses_.map((m) => {
                        const antes = Boolean(desde && m.competencia < desde);
                        return (
                          <Tr key={m.competencia}>
                            <Td>
                              <span className="block font-medium capitalize">{formatarCompetencia(m.competencia, true)}</span>
                              <span className="block text-xs text-muted-foreground md:hidden">
                                {[
                                  m.nfe_entrada ? `${m.nfe_entrada} entrada` : null,
                                  m.nfe_saida ? `${m.nfe_saida} saída` : null,
                                  m.nfse_prestada ? `${m.nfse_prestada} NFS-e prestada${m.nfse_prestada === 1 ? "" : "s"}` : null,
                                  m.nfse_tomada ? `${m.nfse_tomada} NFS-e tomada${m.nfse_tomada === 1 ? "" : "s"}` : null,
                                  m.outros ? `${m.outros} outro${m.outros === 1 ? "" : "s"}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              {antes ? <Badge variante="alerta">Anterior ao mês inicial</Badge> : null}
                            </Td>
                            <Td className="numero hidden text-right sm:table-cell">{m.nfe_entrada || "—"}</Td>
                            <Td className="numero hidden text-right sm:table-cell">{m.nfe_saida || "—"}</Td>
                            <Td className="numero hidden text-right md:table-cell">{m.nfse_prestada || "—"}</Td>
                            <Td className="numero hidden text-right md:table-cell">{m.nfse_tomada || "—"}</Td>
                            <Td className="numero hidden text-right lg:table-cell">{m.outros || "—"}</Td>
                            <Td className="numero text-right font-semibold">{m.total}</Td>
                            <Td className="text-right text-sm">
                              <Link
                                href={`${base}/documentos?competencia=${m.competencia.slice(0, 7)}&fonte=automatica`}
                                className="text-primary hover:underline"
                                aria-label={`Ver as notas de ${formatarCompetencia(m.competencia, true)}`}
                              >
                                Ver
                              </Link>
                            </Td>
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                </div>
              ) : (
                <EstadoVazio icone={CalendarRange} titulo="Nenhuma nota trazida pela busca ainda" descricao="Depois da primeira busca, as notas aparecem aqui separadas por mês." />
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {baixar ? (
        <Card className="mb-4 scroll-mt-20" id="lotes-xml">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileArchive className="size-4" /> XML do mês em lote
            </CardTitle>
            <CardDescription>
              Um arquivo ZIP com todos os XML do mês de emissão escolhido, separados em pastas por tipo (entradas, saídas, NFC-e, CT-e, NFS-e e
              eventos), com uma planilha da relação das notas. Inclui as notas buscadas com o certificado e as enviadas em Documentos. O arquivo fica
              disponível por 7 dias.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormLoteXml acao={pedirLoteXml.bind(null, empresaId)} meses={meses} padrao={padrao} textoBotao="Gerar arquivo do mês" />
            {listaLotes.length ? (
              <div className="-mx-4 sm:-mx-6">
                <TabelaLotes lotes={listaLotes} />
              </div>
            ) : null}
            <AtualizarEnquanto ativo={listaLotes.some(emPreparo)} limiteMs={600_000} />
          </CardContent>
        </Card>
      ) : null}

      {verDocumentos ? (
        <Card className="mb-4 scroll-mt-20" id="nfe-recebidas">
          <CardHeader>
            <CardTitle>NF-e recebidas</CardTitle>
            <CardDescription>
              Resumos que a SEFAZ entregou para a empresa. A SEFAZ só libera o XML completo depois da ciência da emissão; quando ele chega (ou já
              tinha sido enviado), fica em{" "}
              <Link href={`${base}/documentos`} className="text-primary hover:underline">
                Documentos
              </Link>{" "}
              e entra no XML do mês em lote.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-0 pt-0 sm:px-0">
            <div className="space-y-4 px-4 sm:px-6">
              {semCiencia ? (
                <Alerta
                  tom="alerta"
                  titulo={semCiencia === 1 ? "1 NF-e esperando o XML completo" : `${semCiencia} NF-e esperando o XML completo`}
                >
                  {cienciaLigada ? (
                    "A ciência automática está ligada: o portal registra a ciência da emissão nas próximas buscas e a SEFAZ libera o XML logo depois."
                  ) : gerenciar && certificadoValido ? (
                    <>
                      <p>
                        Com a ciência da emissão registrada na SEFAZ, o XML completo chega em Documentos, normalmente em algumas horas. A SEFAZ aceita a
                        ciência até 10 dias depois da emissão da nota.
                      </p>
                      <div className="pt-2">
                        <BotaoPedirXml empresaId={empresaId} pausada={Boolean(config?.pausada)} />
                      </div>
                    </>
                  ) : gerenciar ? (
                    "Para pedir o XML completo, cadastre um certificado digital válido da empresa."
                  ) : (
                    "O escritório pode pedir o XML completo à SEFAZ (ciência da emissão)."
                  )}
                </Alerta>
              ) : null}
              {xmlACaminho ? (
                <p className="text-sm text-muted-foreground">
                  {xmlACaminho === 1 ? "1 NF-e com a ciência registrada" : `${xmlACaminho} NF-e com a ciência registrada`}: o XML completo chega nas
                  próximas buscas.
                </p>
              ) : null}
              {cienciaRecusada ? (
                <p className="text-sm text-perigo">
                  {cienciaRecusada === 1 ? "1 NF-e teve a ciência recusada" : `${cienciaRecusada} NF-e tiveram a ciência recusada`} pela SEFAZ — em geral,
                  por passar do prazo de 10 dias depois da emissão (o motivo aparece na lista abaixo). Peça o XML ao fornecedor e envie em Documentos: a
                  nota passa a ter o XML completo e entra no XML do mês em lote.
                </p>
              ) : null}
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">Planilha das NF-e de entrada</p>
                <p className="text-xs text-muted-foreground">
                  Todas as NF-e de entrada emitidas no mês (as recebidas só em resumo e as que já têm o XML no portal), com fornecedor, valor,
                  situação, chave de acesso e a coluna “XML completo no portal”.
                </p>
                <FormPlanilhaEntradas empresaId={empresaId} meses={meses} padrao={padrao} />
              </div>
            </div>
            {resumos?.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Fornecedor</Th>
                    <Th className="hidden sm:table-cell">Emissão</Th>
                    <Th className="text-right">Valor</Th>
                    <Th>XML</Th>
                  </Tr>
                </THead>
                <TBody>
                  {resumos.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <span className="block font-medium">{r.emitente_nome ?? "—"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.emitente_documento ? formatarCnpj(r.emitente_documento) : ""}
                          {r.tipo_operacao === "saida" ? " · nota de entrada do emitente (ex.: devolução)" : ""}
                          <span className="sm:hidden"> · {r.data_emissao ? formatarData(r.data_emissao.slice(0, 10)) : ""}</span>
                        </span>
                        {r.situacao !== "autorizada" ? <Badge variante="perigo">{r.situacao === "cancelada" ? "Cancelada" : "Denegada"}</Badge> : null}
                      </Td>
                      <Td className="hidden sm:table-cell">{r.data_emissao ? formatarData(r.data_emissao.slice(0, 10)) : "—"}</Td>
                      <Td className="numero text-right">{r.valor != null ? formatarMoeda(r.valor) : "—"}</Td>
                      <Td className="text-sm">
                        {r.documento_id ? (
                          <Link href={`${base}/documentos/${r.documento_id}`} className="text-primary hover:underline">
                            Abrir
                          </Link>
                        ) : r.ciencia_em ? (
                          <span className="text-muted-foreground">ciência registrada; XML a caminho</span>
                        ) : r.ciencia_retorno ? (
                          <>
                            <span className="block text-perigo">ciência recusada</span>
                            <span className="block max-w-56 text-xs break-words text-muted-foreground">{r.ciencia_retorno}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">só resumo</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <div className="px-4 sm:px-6">
                <EstadoVazio icone={CloudDownload} titulo="Nenhuma NF-e recebida pela busca automática" descricao="As notas aparecem aqui depois da primeira busca com o certificado." />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {execucoes?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" /> Histórico das buscas
            </CardTitle>
            <CardDescription>As 15 últimas consultas, com a resposta de cada serviço.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pt-0 sm:px-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Quando</Th>
                  <Th>Serviço</Th>
                  <Th>Resultado</Th>
                  <Th className="hidden md:table-cell">Resposta</Th>
                </Tr>
              </THead>
              <TBody>
                {execucoes.map((e) => {
                  const r = RESULTADO_EXECUCAO[e.resultado] ?? { rotulo: e.resultado, tom: "neutro" as const };
                  return (
                    <Tr key={e.id}>
                      <Td className="text-sm">{formatarDataHora(e.iniciado_em)}</Td>
                      <Td className="text-sm">{SERVICO_EXECUCAO[e.servico] ?? e.servico}</Td>
                      <Td>
                        <Badge variante={r.tom}>{r.rotulo}</Badge>
                        {e.documentos || e.resumos || e.ignorados ? (
                          <span className="block text-xs text-muted-foreground">
                            {[
                              e.documentos ? `${e.documentos} XML` : null,
                              e.resumos ? `${e.resumos} ${e.servico === "ciencia" ? "ciência(s)" : "resumo(s)"}` : null,
                              e.ignorados ? `${e.ignorados} anterior(es) ao mês inicial (ignorada(s))` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                        <span className="block text-xs text-muted-foreground md:hidden">{e.mensagem}</span>
                      </Td>
                      <Td className="hidden text-xs text-muted-foreground md:table-cell">{e.mensagem ?? e.codigo ?? "—"}</Td>
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
