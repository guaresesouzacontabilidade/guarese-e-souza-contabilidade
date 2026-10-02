import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BadgeDollarSign, FileSearch, PiggyBank, ScanSearch } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AcoesAchado, BotaoAnalisar, BotaoPedirAjuda } from "@/components/auditor-fiscal/auditor-fiscal";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import {
  CONFIANCA,
  FILTROS_SITUACAO,
  ORIGEM_EXECUCAO,
  ROTULO_REGRA,
  SITUACAO_ACHADO,
  SITUACAO_EXECUCAO,
  TIPO_ACHADO,
  mensagemSugerida,
} from "@/lib/auditor-fiscal/rotulos";
import { prazoRestituicao, type Referencia } from "@/lib/auditor-fiscal/regras";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Auditor fiscal" };

type Fonte = { titulo: string; url?: string | null };
type Linha = { rotulo: string; valor: string };
type Nome = { nome: string } | null;

const soma = (lista: { valor_estimado: number | string | null }[]) => lista.reduce((t, a) => t + Number(a.valor_estimado ?? 0), 0);
const nomeModelo = (modelo: string) => (modelo === "65" ? "NFC-e" : modelo.startsWith("nfse") ? "NFS-e" : "NF-e");

/** Análise na fila ou em andamento há menos de 30 minutos (depois disso, considera-se parada). */
function analiseEmAndamento(ultima: { situacao: string; criada_em: string } | undefined) {
  return Boolean(ultima && ["pendente", "processando"].includes(ultima.situacao) && Date.now() - new Date(ultima.criada_em).getTime() < 30 * 60_000);
}

export default async function AuditorFiscal({ params, searchParams }: PageProps<"/e/[empresaId]/auditor-fiscal">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const gerenciar = ctx.pode("auditor.gerenciar");
  if (!gerenciar && !ctx.pode("auditor.ver")) return <Alerta tom="alerta">Seu acesso não inclui o auditor fiscal desta empresa.</Alerta>;
  const base = `/e/${empresaId}`;
  return gerenciar ? <VisaoEquipe empresaId={empresaId} base={base} sp={sp} ctx={ctx} /> : <VisaoCliente empresaId={empresaId} base={base} ctx={ctx} />;
}

type Ctx = Awaited<ReturnType<typeof obterContextoEmpresa>>;

// -----------------------------------------------------------------------------
// Equipe
// -----------------------------------------------------------------------------
async function VisaoEquipe({ empresaId, base, sp, ctx }: { empresaId: string; base: string; sp: Record<string, string | string[] | undefined>; ctx: Ctx }) {
  const filtro = typeof sp.situacao === "string" && sp.situacao in FILTROS_SITUACAO ? sp.situacao : "abertos";
  const tipo = sp.tipo === "oportunidade" || sp.tipo === "risco" ? sp.tipo : null;
  let consulta = ctx.supabase
    .from("auditor_achados")
    .select(
      "id, regra, competencia, tipo, confianca, titulo, resumo, valor_base, valor_estimado, memoria, referencias, fontes, situacao, motivo, texto_cliente, revisado_em, publicado_em, valores_alterados_em, atualizado_em, revisado:perfis!auditor_achados_revisado_por_fkey(nome), publicado:perfis!auditor_achados_publicado_por_fkey(nome), solicitacao:solicitacoes(id, numero, status)",
    )
    .eq("empresa_id", empresaId)
    .in("situacao", FILTROS_SITUACAO[filtro].situacoes)
    .order("competencia", { ascending: false })
    .order("tipo")
    .limit(200);
  if (tipo) consulta = consulta.eq("tipo", tipo);

  const [{ data: achados }, { data: todos }, { data: execucoes }, { data: empresa }, { data: parametros }] = await Promise.all([
    consulta,
    ctx.supabase.from("auditor_achados").select("tipo, situacao, valor_estimado").eq("empresa_id", empresaId),
    ctx.supabase
      .from("auditor_execucoes")
      .select("id, situacao, origem, criada_em, concluida_em, notas_analisadas, itens_analisados, notas_relidas, achados_novos, erro, periodo_inicio, periodo_fim")
      .eq("empresa_id", empresaId)
      .order("criada_em", { ascending: false })
      .limit(5),
    ctx.supabase.from("empresas").select("regime_tributario").eq("id", empresaId).single(),
    ctx.supabase.from("calculo_parametros").select("anexo_mercadorias").eq("empresa_id", empresaId).maybeSingle(),
  ]);

  const ativos = (todos ?? []).filter((a) => a.situacao !== "descartado");
  const oportunidades = ativos.filter((a) => a.tipo === "oportunidade" && a.situacao !== "resolvido");
  const paraRevisar = (todos ?? []).filter((a) => a.situacao === "novo").length;
  const riscos = ativos.filter((a) => a.tipo === "risco" && a.situacao !== "resolvido").length;
  const publicados = (todos ?? []).filter((a) => a.situacao === "publicado");
  const ultima = execucoes?.[0];
  const emAndamento = analiseEmAndamento(ultima);
  const regime = empresa?.regime_tributario ?? null;

  return (
    <>
      <CabecalhoPagina
        titulo="Auditor fiscal"
        descricao="Confere as notas de compra e de venda e as notas de serviço dos últimos 5 anos (prazo para pedir de volta) e aponta imposto pago a mais e riscos. Os valores saem de regras fixas, com a lei citada; a equipe confere antes de mostrar ao cliente."
        acoes={<BotaoAnalisar empresaId={empresaId} emAndamento={emAndamento} />}
      />
      <AtualizarEnquanto ativo={emAndamento} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Possível economia" valor={formatarMoeda(soma(oportunidades))} detalhe={`${oportunidades.length} ${oportunidades.length === 1 ? "oportunidade" : "oportunidades"} em aberto`} tom="sucesso" icone={PiggyBank} />
        <Indicador rotulo="Para revisar" valor={paraRevisar} detalhe="achados novos" tom={paraRevisar ? "alerta" : "neutro"} icone={FileSearch} href={urlCom(`${base}/auditor-fiscal`, {}, { situacao: "abertos" })} />
        <Indicador rotulo="Riscos" valor={riscos} detalhe="cadastro e reforma tributária" tom={riscos ? "alerta" : "neutro"} icone={AlertTriangle} href={urlCom(`${base}/auditor-fiscal`, {}, { tipo: "risco" })} />
        <Indicador rotulo="Publicado ao cliente" valor={formatarMoeda(soma(publicados))} detalhe={`${publicados.length} aguardando o cliente`} icone={BadgeDollarSign} href={urlCom(`${base}/auditor-fiscal`, {}, { situacao: "publicados" })} />
      </div>

      {regime === "mei" ? (
        <Alerta tom="info" className="mb-4">
          O MEI paga um valor fixo por mês: o auditor aponta só os riscos de cadastro das notas (NCM e reforma tributária).
        </Alerta>
      ) : regime === "simples_nacional" && !parametros ? (
        <Alerta tom="alerta" className="mb-4" titulo="Defina o anexo do Simples nos Cálculos">
          Sem a configuração dos{" "}
          <Link href={`${base}/calculos/configuracao`} className="font-medium underline">
            Cálculos
          </Link>
          , o auditor presume o Anexo I (comércio) e marca os valores como &ldquo;confiança média&rdquo;.
        </Alerta>
      ) : null}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
          {ultima ? (
            <div className="space-y-1">
              <p>
                <span className="text-muted-foreground">Última análise:</span> {formatarRelativo(ultima.criada_em)} ({ORIGEM_EXECUCAO[ultima.origem] ?? ultima.origem}){" "}
                <Badge variante={SITUACAO_EXECUCAO[ultima.situacao]?.tom ?? "neutro"}>{SITUACAO_EXECUCAO[ultima.situacao]?.rotulo ?? ultima.situacao}</Badge>
              </p>
              {ultima.situacao === "concluida" ? (
                <p className="text-muted-foreground">
                  {ultima.notas_analisadas ?? 0} notas e {ultima.itens_analisados ?? 0} itens de {formatarCompetencia(ultima.periodo_inicio)} a{" "}
                  {formatarCompetencia(ultima.periodo_fim)}
                  {ultima.achados_novos ? ` · ${ultima.achados_novos} achado(s) novo(s)` : ""}
                </p>
              ) : null}
              {ultima.situacao === "pendente" && ultima.notas_relidas ? (
                <p className="text-muted-foreground">Relendo as notas antigas ({ultima.notas_relidas} até agora)...</p>
              ) : null}
              {ultima.situacao === "erro" && ultima.erro ? <p className="text-perigo">{ultima.erro}</p> : null}
            </div>
          ) : (
            <p className="text-muted-foreground">Nenhuma análise ainda. Ela começa sozinha quando chegam notas, ou clique em &ldquo;Analisar agora&rdquo;.</p>
          )}
          <p className="text-xs text-muted-foreground">Regime: {regime ? (REGIMES[regime] ?? regime) : "não informado"}</p>
        </CardContent>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {Object.entries(FILTROS_SITUACAO).map(([chave, f]) => (
          <Link
            key={chave}
            href={urlCom(`${base}/auditor-fiscal`, sp, { situacao: chave })}
            className={`rounded-full border px-3 py-1 ${chave === filtro ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
          >
            {f.rotulo}
          </Link>
        ))}
        <span className="mx-1 text-muted-foreground">|</span>
        {[
          [null, "Tudo"],
          ["oportunidade", "Oportunidades"],
          ["risco", "Riscos"],
        ].map(([valor, rotulo]) => (
          <Link
            key={rotulo}
            href={urlCom(`${base}/auditor-fiscal`, sp, { tipo: valor })}
            className={`rounded-full border px-3 py-1 ${tipo === valor ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
          >
            {rotulo}
          </Link>
        ))}
      </div>

      {achados?.length ? (
        <div className="space-y-3">
          {achados.map((a) => {
            const valor = a.valor_estimado != null ? formatarMoeda(a.valor_estimado) : null;
            const memoria = (a.memoria as unknown as Linha[]) ?? [];
            const refs = (a.referencias as unknown as Referencia[]) ?? [];
            const fontes = (a.fontes as unknown as Fonte[]) ?? [];
            const solicitacao = a.solicitacao as unknown as { id: string; numero: number; status: string } | null;
            return (
              <Card key={a.id} data-achado={a.regra}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variante={TIPO_ACHADO[a.tipo]?.tom}>{TIPO_ACHADO[a.tipo]?.rotulo ?? a.tipo}</Badge>
                        <Badge variante={SITUACAO_ACHADO[a.situacao]?.tom}>{SITUACAO_ACHADO[a.situacao]?.rotulo ?? a.situacao}</Badge>
                        <Badge variante={CONFIANCA[a.confianca]?.tom} title={CONFIANCA[a.confianca]?.descricao}>
                          {CONFIANCA[a.confianca]?.rotulo ?? a.confianca}
                        </Badge>
                        <Badge variante="contorno">{ROTULO_REGRA[a.regra] ?? a.regra}</Badge>
                      </div>
                      <CardTitle className="text-base">{a.titulo}</CardTitle>
                    </div>
                    {valor ? (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{a.tipo === "oportunidade" ? "Valor estimado" : "Em risco"}</p>
                        <p className={`numero text-xl font-bold ${a.tipo === "oportunidade" ? "text-sucesso" : "text-alerta-fg"}`}>{valor}</p>
                      </div>
                    ) : a.valor_base != null ? (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Valor envolvido</p>
                        <p className="numero text-lg font-semibold">{formatarMoeda(a.valor_base)}</p>
                      </div>
                    ) : null}
                  </div>
                  <CardDescription className="pt-1">{a.resumo}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {a.valores_alterados_em ? (
                    <Alerta tom="info">Os valores mudaram depois da revisão ({formatarDataHora(a.valores_alterados_em)}), com notas novas. Confira de novo.</Alerta>
                  ) : null}
                  <details className="rounded-lg border border-border">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary">Memória de cálculo, notas e base legal</summary>
                    <div className="space-y-4 px-3 pb-3">
                      {memoria.length ? (
                        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                          {memoria.map((m, i) => (
                            <div key={i} className="contents">
                              <dt className="text-muted-foreground">{m.rotulo}</dt>
                              <dd className="numero break-words sm:text-right">{m.valor}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {refs.length ? (
                        <div className="overflow-x-auto">
                          <Table>
                            <THead>
                              <Tr>
                                <Th>Nota</Th>
                                <Th>Item ou tomador</Th>
                                <Th className="text-right">Valor</Th>
                                <Th className="hidden md:table-cell">Por quê</Th>
                              </Tr>
                            </THead>
                            <TBody>
                              {refs.map((r, i) => (
                                <Tr key={`${r.nota_id}-${r.item}-${i}`}>
                                  <Td className="text-sm">
                                    {r.documento_id ? (
                                      <Link href={`${base}/documentos/${r.documento_id}`} className="text-primary hover:underline">
                                        {nomeModelo(r.modelo)} {r.numero ?? ""}
                                      </Link>
                                    ) : (
                                      `${nomeModelo(r.modelo)} ${r.numero ?? ""}`
                                    )}
                                    <span className="block text-xs text-muted-foreground">{r.data ? formatarData(r.data) : ""}</span>
                                  </Td>
                                  <Td className="text-sm">
                                    {r.descricao ?? "—"}
                                    <span className="block text-xs text-muted-foreground md:hidden">{r.motivo}</span>
                                  </Td>
                                  <Td className="numero text-right text-sm">{formatarMoeda(r.valor)}</Td>
                                  <Td className="hidden text-xs text-muted-foreground md:table-cell">{r.motivo}</Td>
                                </Tr>
                              ))}
                            </TBody>
                          </Table>
                          <p className="mt-1 text-xs text-muted-foreground">Exemplos com maior valor (até 15).</p>
                        </div>
                      ) : null}
                      {fontes.length ? (
                        <div className="text-sm">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Base legal</p>
                          <ul className="list-disc space-y-0.5 pl-5">
                            {fontes.map((f) => (
                              <li key={f.titulo}>
                                {f.url ? (
                                  <a href={f.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                    {f.titulo}
                                  </a>
                                ) : (
                                  f.titulo
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </details>
                  {a.motivo || a.texto_cliente || a.revisado_em ? (
                    <div className="space-y-1 text-sm">
                      {a.texto_cliente ? (
                        <p>
                          <span className="text-muted-foreground">Mensagem ao cliente:</span> {a.texto_cliente}
                        </p>
                      ) : null}
                      {a.motivo ? (
                        <p>
                          <span className="text-muted-foreground">{a.situacao === "descartado" ? "Motivo do descarte" : "Observação"}:</span> {a.motivo}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {a.revisado_em ? `Revisado ${formatarDataHora(a.revisado_em)}${(a.revisado as unknown as Nome)?.nome ? ` por ${(a.revisado as unknown as Nome)!.nome}` : ""}` : ""}
                        {a.publicado_em ? ` · Publicado ${formatarDataHora(a.publicado_em)}${(a.publicado as unknown as Nome)?.nome ? ` por ${(a.publicado as unknown as Nome)!.nome}` : ""}` : ""}
                      </p>
                    </div>
                  ) : null}
                  {solicitacao ? (
                    <p className="text-sm">
                      O cliente pediu ajuda:{" "}
                      <Link href={`${base}/solicitacoes/${solicitacao.id}`} className="text-primary hover:underline">
                        solicitação #{solicitacao.numero}
                      </Link>
                    </p>
                  ) : null}
                  <AcoesAchado
                    empresaId={empresaId}
                    achado={{ id: a.id, situacao: a.situacao, publicado: Boolean(a.publicado_em), pedidoCliente: Boolean(solicitacao) }}
                    mensagemPadrao={mensagemSugerida(a, valor ?? formatarMoeda(a.valor_base), formatarCompetencia(a.competencia, true))}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EstadoVazio
          icone={ScanSearch}
          titulo={filtro === "abertos" ? "Nada em aberto" : "Nenhum achado nesta lista"}
          descricao={
            ultima?.situacao === "concluida"
              ? "A última análise não encontrou pontos para revisar nas notas desta empresa."
              : "Os achados aparecem aqui depois da análise das notas da empresa."
          }
        />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Cliente
// -----------------------------------------------------------------------------
async function VisaoCliente({ empresaId, base, ctx }: { empresaId: string; base: string; ctx: Ctx }) {
  const { data: achados } = await ctx.supabase
    .from("auditor_achados")
    .select("id, competencia, tipo, titulo, valor_estimado, texto_cliente, situacao, publicado_em, solicitacao:solicitacoes(id, numero, status)")
    .eq("empresa_id", empresaId)
    .order("publicado_em", { ascending: false });
  const abertos = (achados ?? []).filter((a) => a.situacao === "publicado");
  const concluidos = (achados ?? []).filter((a) => a.situacao === "resolvido");
  const valorAberto = soma(abertos.filter((a) => a.tipo === "oportunidade"));

  return (
    <>
      <CabecalhoPagina
        titulo="Economia de impostos"
        descricao="O escritório confere as suas notas fiscais de compra e de venda e mostra aqui o que pode ser recuperado ou ajustado para a sua empresa pagar só o imposto devido."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Indicador rotulo="Pode voltar para o caixa" valor={formatarMoeda(valorAberto)} detalhe="estimativa do escritório, a confirmar" tom="sucesso" icone={PiggyBank} />
        <Indicador rotulo="Assuntos concluídos" valor={concluidos.length} detalhe="já tratados pelo escritório" icone={BadgeDollarSign} />
      </div>
      {abertos.length || concluidos.length ? (
        <div className="space-y-3">
          {[...abertos, ...concluidos].map((a) => {
            const solicitacao = a.solicitacao as unknown as { id: string; numero: number; status: string } | null;
            return (
              <Card key={a.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variante={a.tipo === "oportunidade" ? "sucesso" : "alerta"}>{a.tipo === "oportunidade" ? "Oportunidade de economia" : "Ponto de atenção"}</Badge>
                        {a.situacao === "resolvido" ? <Badge variante="sucesso">Concluído</Badge> : null}
                      </div>
                      <CardTitle className="text-base">{formatarCompetencia(a.competencia, true).replace(/^./, (l) => l.toUpperCase())}</CardTitle>
                    </div>
                    {a.valor_estimado != null && a.tipo === "oportunidade" ? (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Valor estimado</p>
                        <p className="numero text-xl font-bold text-sucesso">{formatarMoeda(a.valor_estimado)}</p>
                      </div>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="whitespace-pre-line">{a.texto_cliente}</p>
                  {a.tipo === "oportunidade" && a.situacao === "publicado" ? (
                    <p className="text-xs text-muted-foreground">Prazo para pedir de volta: até {formatarData(prazoRestituicao(a.competencia))}.</p>
                  ) : null}
                  {solicitacao ? (
                    <p>
                      Pedido enviado ao escritório:{" "}
                      <Link href={`${base}/solicitacoes/${solicitacao.id}`} className="text-primary hover:underline">
                        acompanhar a solicitação #{solicitacao.numero}
                      </Link>
                    </p>
                  ) : a.situacao === "publicado" && ctx.pode("mensagens.usar") ? (
                    <BotaoPedirAjuda empresaId={empresaId} achadoId={a.id} />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EstadoVazio
          icone={PiggyBank}
          titulo="Nenhuma oportunidade publicada ainda"
          descricao="O escritório analisa as suas notas sempre que chegam novas. Quando encontrar algo, você recebe um aviso e vê aqui."
        />
      )}
    </>
  );
}
