import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorCompetencia } from "@/components/calculos/seletor-competencia";
import {
  BotaoConferirIcms,
  BotaoRelerIcms,
  DestinacaoPadrao,
  LancamentosIcms,
  ReabrirIcms,
  SaldoAnteriorIcms,
  SeletorDestinacao,
} from "@/components/calculos/icms";
import { DESTINACOES, mudouDesdeConferencia, type LinhaIcms, type NotaCalculada } from "@/lib/calculos/icms";
import { carregarIcms } from "@/lib/calculos/icms-carregar";
import { icmsNoDas, type DadosPrevisao } from "@/lib/calculos/previsao";
import { competenciaDosCalculos, opcoesCompetencia } from "@/lib/calculos/competencias";
import { somarMeses } from "@/lib/competencia";
import { parametro } from "@/lib/busca";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "Apuração do ICMS" };

const moeda = (v: Parameters<typeof formatarMoeda>[0]) => formatarMoeda(v);

function TabelaGuias({ linhas, total }: { linhas: LinhaIcms[]; total: string }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Guia</Th>
          <Th className="hidden sm:table-cell">Vencimento</Th>
          <Th className="text-right">Valor</Th>
        </Tr>
      </THead>
      <TBody>
        {linhas.map((l) => (
          <Tr key={l.chave}>
            <Td className="align-top">
              <details className="group">
                <summary className="cursor-pointer list-none">
                  <span className="font-medium text-titulo">{l.titulo}</span> <span className="text-xs text-muted-foreground">· {l.guia}</span>
                  <span className="ml-1 text-xs text-primary group-open:hidden">ver cálculo</span>
                  <span className="block text-xs text-muted-foreground sm:hidden">{l.vencimento ? `Vence em ${formatarData(l.vencimento)}` : l.vencimentoTexto}</span>
                </summary>
                {l.detalhes.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {l.detalhes.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </details>
            </Td>
            <Td className="hidden align-top text-sm sm:table-cell">
              {l.vencimento ? formatarData(l.vencimento) : <span className="text-muted-foreground">{l.vencimentoTexto}</span>}
            </Td>
            <Td className="text-right align-top numero font-semibold">{moeda(l.valor)}</Td>
          </Tr>
        ))}
      </TBody>
      <TFoot>
        <Tr>
          <Td className="font-semibold">Total em guias de ICMS</Td>
          <Td className="hidden sm:table-cell" />
          <Td className="text-right numero font-bold text-titulo">{total}</Td>
        </Tr>
      </TFoot>
    </Table>
  );
}

function rotuloNota(n: NotaCalculada) {
  const tipo = n.modelo === "57" ? "CT-e" : "NF-e";
  return `${tipo} ${n.numero ?? "s/n"}${n.serie ? `/${n.serie}` : ""}`;
}

export default async function ApuracaoIcms({ params, searchParams }: PageProps<"/e/[empresaId]/calculos/icms">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.gerenciar")) return <Alerta tom="alerta">A apuração do ICMS é feita pela equipe do escritório.</Alerta>;
  const comp = competenciaDosCalculos(parametro(sp, "competencia"));
  const mes = formatarCompetencia(comp, true);
  const todas = parametro(sp, "notas") === "todas";

  const r = await carregarIcms(ctx.supabase, empresaId, comp);
  const cabecalho = (
    <CabecalhoPagina
      titulo="Apuração do ICMS"
      descricao="ICMS que a empresa tem a pagar no mês, calculado com as notas guardadas no portal e as regras do estado. Confira a destinação das compras e os lançamentos antes de conferir o mês."
      acoes={<SeletorCompetencia valor={comp.slice(0, 7)} opcoes={opcoesCompetencia()} />}
    />
  );
  if ("erro" in r) {
    return (
      <>
        {cabecalho}
        <Alerta tom="perigo">{r.erro}</Alerta>
      </>
    );
  }
  const { dados, resultado: res } = r;
  const mesPag = formatarCompetencia(res.mesPagamento, true);
  const proximo = formatarCompetencia(somarMeses(comp, 1), true);
  const conferida = dados.apuracao?.conferida_em ? dados.apuracao : null;
  const mudou = conferida ? mudouDesdeConferencia(res, conferida.resultado) : false;
  const bloqueado = Boolean(conferida);
  const regimeNormal = res.modo === "normal";
  const base = `/e/${empresaId}`;

  // ICMS que já está dentro do DAS (Simples), só para informação
  let das: ReturnType<typeof icmsNoDas> = null;
  if (res.regime === "simples_nacional") {
    const { data } = await ctx.supabase.rpc("dados_previsao_impostos", { p_empresa_id: empresaId, p_competencia: comp });
    if (data) das = icmsNoDas(data as unknown as DadosPrevisao, comp);
  }

  if (res.mensagem) {
    return (
      <>
        {cabecalho}
        <Alerta tom="info" titulo={`${dados.empresa.nome} · ${res.regimeRotulo}`}>
          {res.mensagem}
        </Alerta>
        {res.avisos.length ? (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {res.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  const notasVisiveis = res.modo === "simples" && !todas ? res.notas.filter((n) => n.interestadual && !n.propria) : res.notas;
  const ocultas = res.notas.length - notasVisiveis.length;

  return (
    <>
      {cabecalho}

      <div className="space-y-4">
        {conferida ? (
          <Alerta
            tom={mudou ? "alerta" : "sucesso"}
            titulo={`Apuração de ${mes} conferida em ${formatarDataHora(conferida.conferida_em)}${conferida.conferida_por ? ` por ${conferida.conferida_por}` : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Guias conferidas: <strong className="numero">{moeda(conferida.total_guias)}</strong>
                {regimeNormal ? (
                  <>
                    {" "}
                    · saldo credor para {proximo}: <strong className="numero">{moeda(conferida.saldo_credor_transportar)}</strong>
                  </>
                ) : null}
                .{" "}
                {mudou
                  ? "Os valores calculados agora são diferentes (notas, destinações ou lançamentos mudaram depois da conferência): reabra o mês para atualizar."
                  : "A previsão de impostos do cliente usa estes valores."}
              </span>
              <ReabrirIcms empresaId={empresaId} competencia={comp} />
            </div>
          </Alerta>
        ) : dados.apuracao?.reaberta_em ? (
          <Alerta tom="info">
            Reaberta em {formatarDataHora(dados.apuracao.reaberta_em)}
            {dados.apuracao.motivo_reabertura ? ` — ${dados.apuracao.motivo_reabertura}` : ""}.
          </Alerta>
        ) : null}

        {dados.releitura_pendente ? (
          <Alerta tom="info">Atualizando a leitura das notas do mês. Em instantes, atualize a página para ver os valores completos.</Alerta>
        ) : dados.leitura_antiga > 0 && !bloqueado ? (
          <Alerta tom="alerta" titulo={`${dados.leitura_antiga} ${dados.leitura_antiga === 1 ? "nota lida" : "notas lidas"} antes da leitura completa`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Releia os XML guardados para trazer o frete de cada item, o crédito de fornecedores do Simples e o DIFAL das vendas.</span>
              <BotaoRelerIcms empresaId={empresaId} competencia={comp} />
            </div>
          </Alerta>
        ) : null}

        {res.semXml.notas.length ? (
          <Alerta
            tom="alerta"
            titulo={`${res.semXml.notas.length} NF-e de entrada ainda sem o XML completo (${moeda(res.semXml.valor)}) — fora do cálculo`}
          >
            <p>
              A SEFAZ entregou só o resumo {res.semXml.notas.length === 1 ? "desta nota" : "destas notas"}: sem os itens e o ICMS, {res.semXml.notas.length === 1 ? "ela não entra" : "elas não entram"} na apuração até o XML chegar
              {res.semXml.outroEstado ? ` (${res.semXml.outroEstado} de outro estado, que ${res.semXml.outroEstado === 1 ? "muda" : "mudam"} a complementação e o DIFAL)` : ""}. Confirme a operação em{" "}
              <Link className="font-medium underline" href={`${base}/notas-automaticas`}>
                Notas automáticas
              </Link>{" "}
              (o XML vem nas buscas seguintes) ou envie os XML em{" "}
              <Link className="font-medium underline" href={`${base}/enviar?competencia=${comp.slice(0, 7)}`}>
                Enviar documentos
              </Link>
              .
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">Ver as notas</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {res.semXml.notas.map((n) => (
                  <li key={n.chave} className="flex flex-wrap justify-between gap-x-3">
                    <span>
                      NF-e {n.numero} · {formatarData(n.data)} · {n.emitente ?? "Fornecedor"} · {n.uf ?? "—"}
                      {n.outroEstado ? " (outro estado)" : ""} ·{" "}
                      {n.confirmada ? "confirmada, XML a caminho" : n.confirmacao_pedida ? "confirmação pedida" : n.ciencia ? "ciência registrada, XML a caminho" : "só resumo"}
                    </span>
                    <span className="numero">{moeda(n.valor)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </Alerta>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <Indicador
            rotulo={`Guias de ICMS a pagar em ${mesPag}`}
            valor={moeda(conferida ? conferida.total_guias : res.totalGuias)}
            detalhe={`${dados.empresa.nome} · ${res.regimeRotulo}${conferida ? " · conferido" : ""}`}
            tom="info"
          />
          {regimeNormal && res.propria ? (
            <>
              <Indicador
                rotulo="ICMS próprio a recolher"
                valor={moeda(res.propria.aRecolher)}
                detalhe={`Débitos ${moeda(res.propria.debitos)} − créditos ${moeda(res.propria.creditos)}`}
              />
              <Indicador
                rotulo={`Saldo credor para ${proximo}`}
                valor={moeda(res.propria.saldoCredorTransportar)}
                detalhe="Créditos que sobram para o mês seguinte"
                tom={res.propria.saldoCredorTransportar.gt(0) ? "sucesso" : "neutro"}
              />
            </>
          ) : (
            <>
              <Indicador
                rotulo="ICMS dentro do DAS"
                valor={das ? moeda(das.valor) : "—"}
                detalhe={das ? "Já incluído no DAS (não é guia à parte)" : "Configure os cálculos para estimar o DAS"}
                href={`${base}/calculos?competencia=${comp.slice(0, 7)}`}
              />
              <Indicador
                rotulo="Compras de outros estados"
                valor={String(res.resumoEntradas.interestaduais)}
                detalhe={`${res.resumoEntradas.notas} ${res.resumoEntradas.notas === 1 ? "nota de entrada" : "notas de entrada"} no mês`}
              />
            </>
          )}
        </div>

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>
                Guias de ICMS de {mes} (pagamento em {mesPag})
              </CardTitle>
              <CardDescription>
                {res.modo === "simples"
                  ? "No Simples Nacional, o ICMS das vendas está no DAS; aqui ficam as guias pagas à parte (DARE/GNRE)."
                  : "ICMS apurado das operações próprias e as guias pagas à parte."}
              </CardDescription>
            </div>
            {!bloqueado ? <BotaoConferirIcms empresaId={empresaId} competencia={comp} mes={mes} total={moeda(res.totalGuias)} /> : null}
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            {res.linhas.length ? (
              <TabelaGuias linhas={res.linhas} total={moeda(res.totalGuias)} />
            ) : (
              <p className="px-6 text-sm text-muted-foreground">Nenhuma guia de ICMS a pagar em {mes} com as notas e os lançamentos do portal.</p>
            )}
          </CardContent>
        </Card>

        {das && das.detalhes.length ? (
          <p className="text-xs text-muted-foreground">ICMS dentro do DAS: {das.detalhes.join(" ")}</p>
        ) : null}

        {regimeNormal && res.propria ? (
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle>Apuração do ICMS próprio</CardTitle>
                <CardDescription>Na mesma ordem do registro E110 da EFD ICMS/IPI.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {(
                    [
                      ["Débitos (ICMS das saídas)", res.propria.debitos, null],
                      ["(+) Outros débitos", res.propria.outrosDebitos, null],
                      ["(+) Estornos de crédito", res.propria.estornosCredito, null],
                      ["(−) Créditos das entradas", res.propria.creditos, null],
                      ["(−) Outros créditos", res.propria.outrosCreditos, null],
                      ["(−) Estornos de débito", res.propria.estornosDebito, null],
                      ["(−) Saldo credor do mês anterior", res.propria.saldoAnterior, "saldo"],
                      ["Saldo devedor", res.propria.saldoDevedor, null],
                      ["(−) Deduções", res.propria.deducoes, null],
                    ] as const
                  ).map(([rotulo, valor, tipo]) => (
                    <div key={rotulo} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border pb-2">
                      <dt className="text-muted-foreground">
                        {rotulo}
                        {tipo === "saldo" ? (
                          <span className="block text-xs">
                            {res.propria!.origemSaldo === "informado"
                              ? `Informado pelo escritório${dados.apuracao?.saldo_observacao ? ` (${dados.apuracao.saldo_observacao})` : ""}`
                              : res.propria!.origemSaldo === "mes_anterior"
                                ? "Da conferência do mês anterior"
                                : "Mês anterior não conferido"}
                            {!bloqueado ? (
                              <>
                                {" · "}
                                <SaldoAnteriorIcms
                                  empresaId={empresaId}
                                  competencia={comp}
                                  valor={dados.apuracao?.saldo_credor_anterior ?? null}
                                  observacao={dados.apuracao?.saldo_observacao ?? null}
                                />
                              </>
                            ) : null}
                          </span>
                        ) : null}
                      </dt>
                      <dd className="numero font-medium">{moeda(valor)}</dd>
                    </div>
                  ))}
                  <div className="flex flex-wrap justify-between gap-x-4 pt-1 text-base">
                    <dt className="font-semibold">ICMS a recolher</dt>
                    <dd className="numero font-bold text-titulo">{moeda(res.propria.aRecolher)}</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-4">
                    <dt className="text-muted-foreground">Saldo credor a transportar</dt>
                    <dd className="numero font-medium">{moeda(res.propria.saldoCredorTransportar)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Débitos e créditos</CardTitle>
                <CardDescription>Saídas por CFOP e entradas com e sem crédito.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {res.propria.debitosPorCfop.length ? (
                  <ul className="space-y-1">
                    {res.propria.debitosPorCfop.map((d) => (
                      <li key={d.cfop} className="flex flex-wrap justify-between gap-x-3">
                        <span className={d.excluido ? "text-muted-foreground line-through" : undefined} title={d.excluido ?? undefined}>
                          CFOP {d.cfop || "—"} · {d.notas} {d.notas === 1 ? "nota" : "notas"} · {moeda(d.valor)}
                        </span>
                        <span className="numero">{moeda(d.icms)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Nenhuma nota de saída (NF-e/NFC-e) no mês.</p>
                )}
                {res.propria.creditosPorGrupo.length ? (
                  <ul className="space-y-1 border-t border-border pt-3">
                    {res.propria.creditosPorGrupo.map((g) => (
                      <li key={g.chave} className="flex flex-wrap justify-between gap-x-3">
                        <span className={g.creditado ? undefined : "text-muted-foreground"}>{g.rotulo}</span>
                        <span className={`numero ${g.creditado ? "" : "text-muted-foreground"}`}>{moeda(g.icms)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {res.comparacaoSped ? (
          <Card>
            <CardHeader>
              <CardTitle>Comparação com a EFD ICMS/IPI enviada</CardTitle>
              <CardDescription>Registro E110 do arquivo {dados.sped?.nome ?? ""}. Diferenças apontam notas sem XML no portal, CFOP ou lançamentos diferentes.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Campo</Th>
                    <Th className="text-right">Portal</Th>
                    <Th className="text-right">EFD</Th>
                  </Tr>
                </THead>
                <TBody>
                  {res.comparacaoSped.map((c) => (
                    <Tr key={c.rotulo}>
                      <Td>
                        {c.rotulo} {c.diferente ? <Badge variante="alerta">diferente</Badge> : null}
                      </Td>
                      <Td className="text-right numero">{moeda(c.portal)}</Td>
                      <Td className="text-right numero">{moeda(c.sped)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Notas de entrada de {mes}</CardTitle>
            <CardDescription>
              A nota do fornecedor não diz para que a compra serve. Marque o que é uso e consumo ou ativo imobilizado: muda o crédito
              {res.modo === "simples" ? ", a complementação de alíquota" : ""} e o diferencial de alíquotas. A escolha vale para o item, a nota ou todas as notas do
              fornecedor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label htmlFor="icms-destinacao-padrao" className="font-medium">
                Compras da empresa, por padrão:
              </label>
              <DestinacaoPadrao empresaId={empresaId} valor={dados.destinacao_padrao} desabilitado={bloqueado} />
            </div>
            {notasVisiveis.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {notasVisiveis.map((n) => (
                  <li key={n.id} className="space-y-2 p-3 text-sm" data-nota={n.numero ?? ""}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-titulo">
                          {rotuloNota(n)} · {formatarData(n.data)}
                          {n.propria ? <Badge variante="neutro" className="ml-2">emitida pela empresa</Badge> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {n.emitente ?? "Emitente"} {n.emitenteDocumento ? `(${formatarDocumento(n.emitenteDocumento)})` : ""} · {n.emitenteUf ?? "—"}
                          {n.interestadual ? " · outro estado" : ""}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="numero text-sm font-semibold">{moeda(n.valor)}</p>
                        {regimeNormal ? <p className="numero text-muted-foreground">crédito {moeda(n.credito)}</p> : null}
                        {n.complementacao.gt(0) ? <p className="numero text-titulo">complementação {moeda(n.complementacao)}</p> : null}
                        {n.difal.gt(0) ? <p className="numero text-titulo">DIFAL {moeda(n.difal)}</p> : null}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <span className="text-xs text-muted-foreground sm:w-24">Esta nota:</span>
                      <SeletorDestinacao
                        empresaId={empresaId}
                        alvo={{ notaId: n.id }}
                        valor={n.escolhaNota}
                        herdada={n.destinacao ? `Automática: ${DESTINACOES[n.destinacao].curto}` : "Automática (por item)"}
                        rotulo={`Destinação da ${rotuloNota(n)}`}
                        desabilitado={bloqueado}
                      />
                      {n.emitenteDocumento && !n.propria && n.modelo !== "57" ? (
                        <>
                          <span className="text-xs text-muted-foreground sm:ml-2">Fornecedor (todas as notas):</span>
                          <SeletorDestinacao
                            empresaId={empresaId}
                            alvo={{ fornecedor: n.emitenteDocumento }}
                            valor={n.escolhaFornecedor}
                            herdada={`Sem regra (padrão: ${DESTINACOES[dados.destinacao_padrao].curto})`}
                            rotulo={`Destinação das notas de ${n.emitente ?? "fornecedor"}`}
                            desabilitado={bloqueado}
                          />
                        </>
                      ) : null}
                    </div>
                    {n.modelo !== "57" ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-primary">Itens e cálculo ({n.itens.length})</summary>
                        <ul className="mt-2 space-y-2">
                          {n.itens.map((it) => (
                            <li key={it.n} className="rounded-md bg-muted/40 p-2 text-xs">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <span className="min-w-0">
                                  <span className="font-medium">
                                    {it.n}. {it.descricao ?? "Item"}
                                  </span>{" "}
                                  <span className="text-muted-foreground">
                                    · CFOP {it.cfop ?? "—"}
                                    {it.ncm ? ` · NCM ${it.ncm}` : ""}
                                    {it.aliquotaInterestadual != null ? ` · interestadual ${it.aliquotaInterestadual}%` : ""}
                                    {it.st ? " · com ICMS-ST" : ""}
                                  </span>
                                </span>
                                <span className="numero">{moeda(it.valorOperacao)}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <SeletorDestinacao
                                  empresaId={empresaId}
                                  alvo={{ notaId: n.id, item: it.n }}
                                  valor={it.escolhaItem}
                                  herdada={it.escolhaItem ? "Automática (como a nota)" : `Automática: ${DESTINACOES[it.destinacao].curto}`}
                                  rotulo={`Destinação do item ${it.n} da ${rotuloNota(n)}`}
                                  desabilitado={bloqueado}
                                />
                                {regimeNormal ? (
                                  <span className="text-muted-foreground">
                                    {it.credito.gt(0) ? `crédito ${moeda(it.credito)}` : it.semCredito ?? (it.icmsDestacado.gt(0) ? "" : "sem ICMS destacado")}
                                  </span>
                                ) : null}
                              </div>
                              {it.memoria.length ? (
                                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                                  {it.memoria.map((m, i) => (
                                    <li key={i}>{m}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {res.modo === "simples" ? "Nenhuma compra de outro estado no mês." : "Nenhuma nota de entrada (NF-e/CT-e) no mês."}
              </p>
            )}
            {ocultas > 0 ? (
              <p className="text-xs text-muted-foreground">
                {ocultas} {ocultas === 1 ? "nota do próprio estado (ou emitida pela empresa) não entra" : "notas do próprio estado (ou emitidas pela empresa) não entram"} na
                complementação nem no DIFAL.{" "}
                <Link className="text-primary hover:underline" href={`${base}/calculos/icms?competencia=${comp.slice(0, 7)}&notas=todas`}>
                  Mostrar todas
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lançamentos do escritório</CardTitle>
            <CardDescription>
              {regimeNormal
                ? "Créditos e débitos que não estão nas notas (ex.: CIAP, energia, nota sem XML), deduções e outras guias de ICMS."
                : "Outras guias de ICMS do mês (ex.: ICMS-ST na entrada sem retenção, antecipação)."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LancamentosIcms
              empresaId={empresaId}
              competencia={comp}
              lancamentos={dados.lancamentos}
              regimeNormal={regimeNormal}
              bloqueado={bloqueado}
            />
          </CardContent>
        </Card>

        {res.avisos.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Pontos de atenção</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
                {res.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {res.fontes.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Base legal usada</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {res.fontes.map((f) => (
                  <li key={f.titulo}>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        {f.titulo} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      f.titulo
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Apuração de conferência feita pelo portal com os XML guardados e as escolhas do escritório
          {dec(res.aliquotaInterna ?? 0).gt(0) ? ` (alíquota interna de ${res.uf}: ${res.aliquotaInterna}%)` : ""}. O portal não emite o DARE nem transmite a EFD: emita as
          guias no portal da SEFAZ e confira os prazos no calendário fiscal do estado.
        </p>
      </div>
    </>
  );
}
