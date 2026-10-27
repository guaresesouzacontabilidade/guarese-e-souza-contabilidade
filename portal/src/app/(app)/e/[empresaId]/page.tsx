import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, Building2, CalendarPlus, FileCheck2, MessagesSquare, PackageCheck, ReceiptText, Route, ShoppingCart, Truck, Upload } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Button } from "@/components/ui/button";
import { competenciaAtual, hojeISO, somarDias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora, formatarDocumento, nomeMes } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { calcularPrevisao, receitaDoMes, type DadosPrevisao } from "@/lib/calculos/previsao";
import { situacaoVencimento } from "@/lib/vencimentos/rotulos";
import { Alerta } from "@/components/ui/feedback";
import { MarcaEmpresa } from "@/components/empresas/marca-empresa";
import { BarrasMeses, Bloco, CabecaDia, diasDaSemana, Estatistica, GradeBlocos, Medidor, Selo } from "@/components/painel/blocos";
import { NumeroAnimado } from "@/components/painel/numero-animado";
import { cn } from "@/lib/utils";
import type { Ferramenta } from "@/lib/empresas/ferramentas";

export const metadata: Metadata = { title: "Visão geral" };

type Evento = { texto: string; tom: "sucesso" | "alerta" | "perigo" | "escuro"; href: string };

/** Dias até a data (negativo = já passou). */
function diasAte(data: string, hoje: string) {
  return Math.round((new Date(`${data}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime()) / 86_400_000);
}

export default async function VisaoGeralEmpresa({ params }: PageProps<"/e/[empresaId]">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const { acesso, sessao } = ctx;
  const base = `/e/${empresaId}`;
  const hoje = hojeISO();
  const comp = somarMeses(competenciaAtual(), -1);
  const semana = diasDaSemana(hoje);
  const verDocs = ctx.pode("documentos.ver");
  const conversar = ctx.pode("mensagens.usar");
  // Ferramentas desligadas pelo escritório não aparecem no painel
  const ligada = (f: Ferramenta) => !acesso.ferramentas_desligadas.includes(f);
  const verAgenda = verDocs && ligada("agenda");
  const verVencimentos = verDocs && ligada("vencimentos");
  const verSolicitacoes = conversar && ligada("solicitacoes");

  const [resumo, itens, guiasRes, conversas, aguardando, pedidos, dadosPrevisao, vencendo, saidas, entradas] = await Promise.all([
    verDocs ? ctx.supabase.rpc("resumo_checklist", { p_empresa_id: empresaId, p_competencia: comp }) : Promise.resolve({ data: null }),
    verDocs
      ? ctx.supabase.from("checklist_itens").select("id, titulo, prazo, status, competencia").eq("empresa_id", empresaId).in("status", ["pendente", "correcao"]).order("prazo").limit(30)
      : Promise.resolve({ data: [] }),
    verAgenda
      ? ctx.supabase
          .from("documentos")
          .select("id, titulo, nome_original, vencimento, valor, pagamento:guia_pagamentos!guia_pagamentos_guia_fk(pago_em)")
          .eq("empresa_id", empresaId)
          .eq("direcao", "escritorio")
          .eq("categoria_codigo", "esc_guia")
          .not("publicado_em", "is", null)
          .is("excluido_em", null)
          .gte("vencimento", somarDias(hoje, -45))
          .lte("vencimento", somarDias(hoje, 90))
          .order("vencimento")
          .limit(40)
      : Promise.resolve({ data: [] }),
    conversar
      ? ctx.supabase.from("conversas").select("id, assunto, aguardando, ultima_mensagem_em").eq("empresa_id", empresaId).eq("status", "aberta").order("ultima_mensagem_em", { ascending: false }).limit(2)
      : Promise.resolve({ data: [] }),
    conversar
      ? ctx.supabase
          .from("conversas")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", empresaId)
          .eq("status", "aberta")
          .eq("aguardando", ctx.equipe ? "escritorio" : "cliente")
      : Promise.resolve({ count: 0 }),
    verSolicitacoes
      ? ctx.supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("status", ["aberta", "em_andamento", "aguardando_cliente"])
      : Promise.resolve({ count: 0 }),
    ctx.pode("calculos.ver") ? ctx.supabase.rpc("dados_previsao_impostos", { p_empresa_id: empresaId, p_competencia: comp }) : Promise.resolve({ data: null }),
    verVencimentos
      ? ctx.supabase.from("vencimentos").select("id, descricao, validade").eq("empresa_id", empresaId).eq("situacao", "ativo").lte("validade", somarDias(hoje, 30)).order("validade").limit(6)
      : Promise.resolve({ data: [] }),
    verDocs
      ? ctx.supabase
          .from("documentos_fiscais")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", empresaId)
          .eq("competencia", comp)
          .eq("operacao", "saida")
          .eq("relacionado_empresa", true)
          .eq("cancelada_evento", false)
      : Promise.resolve({ count: null }),
    verDocs
      ? ctx.supabase
          .from("documentos_fiscais")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", empresaId)
          .eq("competencia", comp)
          .eq("operacao", "entrada")
          .eq("relacionado_empresa", true)
          .eq("cancelada_evento", false)
      : Promise.resolve({ count: null }),
  ]);

  const nomeEmpresa = acesso.nome_fantasia ?? acesso.razao_social;
  const primeiroNome = sessao.perfil.nome.split(" ")[0];
  const r = resumo.data as { total: number; percentual: number | null; pendentes: number; atrasados: number; correcao: number; enviados: number; concluidos: number } | null;
  const pendentes = itens.data ?? [];

  // Previsão de impostos e faturamento dos 12 meses (das notas ou da receita informada)
  const dados = dadosPrevisao.data as unknown as DadosPrevisao | null;
  const previsao = dados ? calcularPrevisao(dados) : null;
  const previsaoOk = previsao && previsao.situacao !== "sem_parametros" && previsao.situacao !== "competencia_nao_suportada";
  // O cliente vê a previsão quando os documentos do mês chegaram (a equipe vê sempre)
  const previsaoVisivel = Boolean(previsaoOk && (ctx.equipe || !previsao!.checklist.faltantes.length));
  const faturamento = dados
    ? Array.from({ length: 12 }, (_, i) => {
        const c = somarMeses(comp, i - 11);
        const m = dados.meses.find((x) => x.competencia.slice(0, 7) === c.slice(0, 7));
        return { rotulo: nomeMes(Number(c.slice(5, 7)), true), valor: receitaDoMes(m).total.toNumber() };
      })
    : [];
  const temFaturamento = faturamento.some((m) => m.valor > 0);
  const fatMes = faturamento.at(-1)?.valor ?? 0;
  const fatAnterior = faturamento.at(-2)?.valor ?? 0;
  const variacao = fatAnterior > 0 ? Math.round(((fatMes - fatAnterior) / fatAnterior) * 100) : null;
  const linhasImposto = previsaoVisivel ? previsao!.linhas.filter((l) => l.grupo === "pagar" && l.valor.gt(0)) : [];
  const totalImpostos = previsaoVisivel ? previsao!.totalPagar.toNumber() : 0;

  // Guias publicadas pelo escritório: a próxima a pagar vai para o destaque
  const guias = (guiasRes.data ?? []).map((g) => ({
    id: g.id,
    titulo: g.titulo ?? g.nome_original,
    vencimento: g.vencimento as string,
    valor: g.valor == null ? null : Number(g.valor),
    pago: Boolean(Array.isArray(g.pagamento) ? g.pagamento.length : g.pagamento),
  }));
  const proxima = guias.find((g) => !g.pago);

  // A semana: guias, documentos a enviar e vencimentos de cada dia
  const eventos = new Map<string, Evento[]>();
  const juntar = (data: string, e: Evento) => eventos.set(data, [...(eventos.get(data) ?? []), e]);
  for (const g of guias) {
    if (g.vencimento < semana[0].data || g.vencimento > semana[6].data) continue;
    juntar(g.vencimento, { texto: `${g.titulo}${g.pago ? " · pago" : g.valor != null ? ` · ${formatarMoeda(g.valor)}` : ""}`, tom: g.pago ? "sucesso" : "escuro", href: `${base}/agenda` });
  }
  for (const i of pendentes) {
    if (i.prazo < semana[0].data || i.prazo > semana[6].data) continue;
    juntar(i.prazo, { texto: `Enviar: ${i.titulo}`, tom: "alerta", href: `${base}/enviar?item=${i.id}` });
  }
  for (const v of vencendo.data ?? []) {
    if (v.validade < semana[0].data || v.validade > semana[6].data) continue;
    juntar(v.validade, { texto: `Vence: ${v.descricao}`, tom: "perigo", href: `${base}/vencimentos` });
  }

  // Atalhos conforme o que a pessoa pode fazer
  const transporte = acesso.loja && acesso.gestao_modalidade === "notas";
  const hotel = acesso.loja && acesso.gestao_modalidade === "hotel";
  const atalhos = [
    hotel && ctx.pode("gestao.vender") ? { rotulo: "Painel do hotel", href: `${base}/hotel`, icone: BedDouble } : null,
    hotel && ctx.pode("gestao.vender") ? { rotulo: "Nova reserva", href: `${base}/hotel/reservas/nova`, icone: CalendarPlus } : null,
    ctx.pode("documentos.enviar") ? { rotulo: "Enviar documentos", href: `${base}/enviar`, icone: Upload } : null,
    transporte && ctx.pode("nfe.emitir") ? { rotulo: "Ordens de carregamento", href: `${base}/loja/carregamentos`, icone: Truck } : null,
    acesso.loja && !transporte && !hotel && ctx.pode("gestao.vender") ? { rotulo: "Vender", href: `${base}/loja/vender`, icone: ShoppingCart } : null,
    ctx.pode("nfe.emitir") ? { rotulo: "Emitir nota de produto", href: `${base}/notas-produto`, icone: PackageCheck } : null,
    ctx.pode("cte.configurar") || (ctx.pode("cte.emitir") && acesso.cte) ? { rotulo: "Emitir CT-e (frete)", href: `${base}/cte`, icone: Route } : null,
    ctx.pode("nfse.emitir") ? { rotulo: "Emitir nota de serviço", href: `${base}/notas-servico`, icone: ReceiptText } : null,
    conversar ? { rotulo: "Mensagens", href: `${base}/mensagens`, icone: MessagesSquare } : null,
  ]
    .filter((a) => a !== null)
    .slice(0, 4);

  const corEvento = { sucesso: "bg-sucesso-bg text-sucesso-fg", alerta: "bg-alerta-bg text-alerta-fg", perigo: "bg-perigo-bg text-perigo-fg", escuro: "bg-foreground text-background" };

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center">
          <MarcaEmpresa
            nome={nomeEmpresa}
            logo={acesso.logo_path ? `/api/empresas/${empresaId}/logo?v=${encodeURIComponent(acesso.logo_atualizado_em ?? "1")}` : null}
            tamanho="lg"
          />
          <div className="w-full min-w-0 sm:w-auto">
            <p className="text-sm text-muted-foreground">
              {ctx.equipe ? "Empresa" : `Olá, ${primeiroNome}!`} · {formatarDocumento(acesso.documento)}
            </p>
            <h1 className="truncate font-titulo text-2xl font-semibold tracking-tight text-titulo sm:text-3xl">{nomeEmpresa}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {ctx.pode("documentos.enviar") ? (
                <Button asChild tamanho="sm">
                  <Link href={`${base}/enviar`}>
                    <Upload /> Enviar documentos
                  </Link>
                </Button>
              ) : null}
              {ctx.equipe ? (
                <Button asChild variante="contorno" tamanho="sm">
                  <Link href={`/escritorio/empresas/${empresaId}`}>
                    <Building2 /> Cadastro
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {temFaturamento ? (
            <Estatistica
              rotulo={`Faturamento de ${nomeMes(Number(comp.slice(5, 7)))}`}
              valor={<NumeroAnimado valor={fatMes} formato="moeda" />}
              selo={variacao != null ? <Selo tom={variacao >= 0 ? "sucesso" : "perigo"}>{`${variacao >= 0 ? "+" : ""}${variacao}%`}</Selo> : null}
            />
          ) : null}
          {previsaoVisivel ? (
            <Estatistica rotulo="Impostos previstos" valor={<NumeroAnimado valor={totalImpostos} formato="moeda" />} href={`${base}/calculos`} />
          ) : null}
          {r && r.total > 0 ? (
            <Estatistica
              rotulo={`Documentos de ${nomeMes(Number(comp.slice(5, 7)))}`}
              valor={
                <>
                  <NumeroAnimado valor={r.concluidos} /> de {r.total}
                </>
              }
              selo={r.total - r.concluidos > 0 ? <Selo tom="alerta">{`faltam ${r.total - r.concluidos}`}</Selo> : <Selo tom="sucesso">completo</Selo>}
              href={`${base}/pendencias`}
            />
          ) : null}
        </div>
      </section>

      {vencendo.data?.length ? (
        <Alerta
          tom={vencendo.data.some((v) => situacaoVencimento(v.validade, hoje).tom === "perigo") ? "perigo" : "alerta"}
          titulo="Documentos vencendo"
          acao={
            <Button asChild variante="contorno" tamanho="sm">
              <Link href={`${base}/vencimentos`}>Ver vencimentos</Link>
            </Button>
          }
        >
          {vencendo.data.map((v) => `${v.descricao}: ${situacaoVencimento(v.validade, hoje).rotulo.toLowerCase()} (${formatarData(v.validade)})`).join(" · ")}
        </Alerta>
      ) : null}

      <GradeBlocos>
        {verDocs ? (
          <Bloco titulo={`Documentos de ${nomeMes(Number(comp.slice(5, 7)))}`} largura={r && r.total > 0 ? 2 : 1} href={`${base}/pendencias`} rotuloLink="Abrir pendências">
            {r && r.total > 0 ? (
              <div className="flex flex-wrap items-center gap-6">
                <Medidor percentual={r.percentual} legenda={`${r.concluidos} de ${r.total} entregues`} rotulo={`${r.percentual ?? 0}% dos documentos do mês entregues`} />
                <div className="flex min-w-48 flex-1 flex-col gap-2 text-sm">
                  {pendentes.length ? (
                    <>
                      <p className="font-semibold text-muted-foreground">O escritório ainda precisa de:</p>
                      {pendentes.slice(0, 3).map((i) => (
                        <Link key={i.id} href={`${base}/enviar?item=${i.id}`} className="flex items-center gap-2 hover:underline">
                          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", i.prazo < hoje ? "bg-perigo" : "bg-alerta")} />
                          <span className="min-w-0 truncate">{i.titulo}</span>
                          {i.prazo < hoje ? <span className="shrink-0 text-xs text-perigo">atrasado</span> : null}
                        </Link>
                      ))}
                      {pendentes.length > 3 ? <span className="text-xs text-muted-foreground">e mais {pendentes.length - 3}</span> : null}
                    </>
                  ) : (
                    <p className="flex items-center gap-2 text-sucesso-fg">
                      <FileCheck2 className="size-4" /> Nenhum documento faltando no momento.
                    </p>
                  )}
                  {ctx.pode("documentos.enviar") ? (
                    <Button asChild className="mt-1 self-start rounded-full">
                      <Link href={`${base}/enviar`}>
                        <Upload /> Enviar documentos
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma pendência cadastrada para {formatarCompetencia(comp, true)}.</p>
            )}
          </Bloco>
        ) : null}

        {verAgenda ? (
          <Bloco
            titulo={proxima ? "Próximo pagamento" : "Pagamentos"}
            destaque
            acao={
              proxima ? (
                <Selo tom="claro">
                  {(() => {
                    const d = diasAte(proxima.vencimento, hoje);
                    return d < 0 ? "vencida" : d === 0 ? "vence hoje" : d === 1 ? "amanhã" : `em ${d} dias`;
                  })()}
                </Selo>
              ) : null
            }
          >
            {proxima ? (
              <>
                <p className="mt-auto truncate text-sm opacity-90">{proxima.titulo}</p>
                <p className="font-titulo text-3xl font-semibold leading-tight">
                  {proxima.valor != null ? <NumeroAnimado valor={proxima.valor} formato="moeda" /> : "Valor na guia"}
                </p>
                <p className="text-sm">Vence em {formatarData(proxima.vencimento)}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Link
                    href={`${base}/documentos/${proxima.id}`}
                    className="inline-flex min-h-10 items-center rounded-full bg-primary-foreground px-4 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
                  >
                    Ver guia
                  </Link>
                  <Link
                    href={`${base}/agenda`}
                    className="inline-flex min-h-10 items-center rounded-full border border-primary-foreground/70 px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/15"
                  >
                    Já paguei
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="mt-auto font-titulo text-2xl font-semibold">Tudo em dia</p>
                <p className="text-sm opacity-90">Nenhuma guia a pagar agora. Quando o escritório publicar uma guia, ela aparece aqui.</p>
                <Link
                  href={`${base}/agenda`}
                  className="mt-1 inline-flex min-h-10 items-center self-start rounded-full bg-primary-foreground px-4 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
                >
                  Agenda de pagamentos
                </Link>
              </>
            )}
          </Bloco>
        ) : null}

        {conversar ? (
          <Bloco titulo="Falar com o escritório" href={`${base}/mensagens`} rotuloLink="Abrir mensagens">
            {aguardando.count ? (
              <p className="-mt-1">
                <Selo>{aguardando.count === 1 ? "1 conversa esperando você" : `${aguardando.count} conversas esperando você`}</Selo>
              </p>
            ) : null}
            {conversas.data?.length ? (
              <ul className="space-y-2">
                {conversas.data.map((c) => (
                  <li key={c.id}>
                    <Link href={`${base}/mensagens/${c.id}`} className="flex gap-2.5 rounded-2xl bg-muted/70 p-2.5 transition-colors hover:bg-muted">
                      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                        <MessagesSquare className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{c.assunto}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.aguardando === (ctx.equipe ? "escritorio" : "cliente") ? "Esperando sua resposta" : formatarDataHora(c.ultima_mensagem_em)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma conversa em aberto.</p>
            )}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-sm">
              {verSolicitacoes ? (
                <Link href={`${base}/solicitacoes`} className="text-muted-foreground hover:text-foreground hover:underline">
                  {pedidos.count ? `${pedidos.count} solicitação(ões) em andamento` : "Solicitações"}
                </Link>
              ) : (
                <span />
              )}
              <Link href={`${base}/mensagens`} className="font-semibold text-primary hover:underline">
                Abrir conversas
              </Link>
            </div>
          </Bloco>
        ) : null}

        {temFaturamento ? (
          <Bloco titulo="Faturamento" largura={2} href={`${base}/calculos`} rotuloLink="Abrir cálculos e previsão">
            <p className="-mt-2 text-sm text-muted-foreground">
              Últimos 12 meses · média de {formatarMoeda(faturamento.reduce((s, m) => s + m.valor, 0) / 12)}
            </p>
            <BarrasMeses
              meses={faturamento}
              rotuloDestaque={formatarMoeda(fatMes)}
              descricao={`Faturamento mensal dos últimos 12 meses; ${formatarCompetencia(comp, true)}: ${formatarMoeda(fatMes)}`}
            />
          </Bloco>
        ) : null}

        {previsaoVisivel ? (
          <Bloco titulo={`Impostos de ${nomeMes(Number(comp.slice(5, 7)))}`} href={`${base}/calculos`} rotuloLink="Ver o cálculo">
            <div>
              <p className="text-sm text-muted-foreground">Previsão, a pagar em {formatarCompetencia(previsao!.mesPagamento, true)}</p>
              <p className="font-titulo text-2xl font-semibold text-titulo">
                <NumeroAnimado valor={totalImpostos} formato="moeda" />
              </p>
            </div>
            {linhasImposto.length ? (
              <>
                <div aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                  {linhasImposto.slice(0, 4).map((l, i) => (
                    <span key={l.chave} className={["bg-primary", "bg-primary/60", "bg-info", "bg-muted-foreground/30"][i]} style={{ flex: l.valor.toNumber() }} />
                  ))}
                </div>
                <ul className="space-y-1.5 text-sm">
                  {linhasImposto.slice(0, 4).map((l, i) => (
                    <li key={l.chave} className="flex items-center gap-2">
                      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-sm", ["bg-primary", "bg-primary/60", "bg-info", "bg-muted-foreground/30"][i])} />
                      <span className="min-w-0 flex-1 truncate">{l.tributo}</span>
                      <span className="numero">{formatarMoeda(l.valor)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nada a pagar neste mês.</p>
            )}
            {ctx.equipe && previsao!.checklist.faltantes.length ? <p className="text-xs text-alerta-fg">O cliente ainda não vê: faltam documentos do mês.</p> : null}
          </Bloco>
        ) : null}

        {verDocs ? (
          <Bloco titulo="Notas do mês" href={ligada("notas_automaticas") ? `${base}/notas-automaticas` : undefined} rotuloLink="Abrir notas automáticas">
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between border-b border-border pb-2">
                <dt className="text-muted-foreground">Notas de saída</dt>
                <dd className="font-titulo text-2xl font-semibold text-titulo">
                  <NumeroAnimado valor={saidas.count ?? 0} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">Notas de entrada</dt>
                <dd className="font-titulo text-2xl font-semibold text-titulo">
                  <NumeroAnimado valor={entradas.count ?? 0} />
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">{formatarCompetencia(comp, true)}, das notas que estão no portal.</p>
          </Bloco>
        ) : null}

        {verDocs ? (
          <Bloco
            titulo="Esta semana"
            largura={3}
            href={verAgenda ? `${base}/agenda` : `${base}/pendencias`}
            rotuloLink={verAgenda ? "Abrir a agenda de pagamentos" : "Abrir pendências"}
          >
            {/* No celular: só os dias com algo marcado, um embaixo do outro */}
            <ul className="space-y-2 sm:hidden">
              {semana
                .filter((d) => eventos.has(d.data))
                .flatMap((d) =>
                  (eventos.get(d.data) ?? []).map((e, i) => (
                    <li key={`${d.data}-${i}`}>
                      <Link href={e.href} className="flex items-center gap-3 rounded-2xl border border-border p-2 transition-colors hover:bg-muted">
                        <span
                          className={cn(
                            "flex size-11 shrink-0 flex-col items-center justify-center rounded-full text-xs leading-tight",
                            d.hoje ? "bg-primary text-primary-foreground" : "bg-muted",
                          )}
                        >
                          {d.dia}
                          <strong className="text-sm">{d.numero}</strong>
                        </span>
                        <span className="min-w-0 flex-1 text-sm">{e.texto}</span>
                        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", { sucesso: "bg-sucesso", alerta: "bg-alerta", perigo: "bg-perigo", escuro: "bg-foreground" }[e.tom])} />
                      </Link>
                    </li>
                  )),
                )}
            </ul>
            <div className="-mx-1 hidden overflow-x-auto px-1 pb-1 sm:block">
              <ol className="grid min-w-[640px] grid-cols-7 gap-2">
                {semana.map((d) => {
                  const lista = eventos.get(d.data) ?? [];
                  return (
                    <li key={d.data} className="flex flex-col items-center gap-2">
                      <CabecaDia dia={d} />
                      {lista.slice(0, 2).map((e, i) => (
                        <Link key={i} href={e.href} className={cn("w-full rounded-2xl px-2.5 py-2 text-xs leading-snug transition-opacity hover:opacity-85", corEvento[e.tom])}>
                          {e.texto}
                        </Link>
                      ))}
                      {lista.length > 2 ? <span className="text-xs text-muted-foreground">+{lista.length - 2}</span> : null}
                    </li>
                  );
                })}
              </ol>
            </div>
            {eventos.size === 0 ? <p className="text-sm text-muted-foreground">Nenhum pagamento, entrega ou vencimento nesta semana.</p> : null}
          </Bloco>
        ) : null}

        {atalhos.length ? (
          <Bloco titulo="Atalhos">
            <div className="grid grid-cols-2 gap-2.5">
              {atalhos.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="flex min-h-[4.5rem] flex-col justify-between gap-2 rounded-2xl border border-border p-3 text-[13px] font-semibold leading-snug hyphens-auto transition-colors [overflow-wrap:anywhere] hover:border-primary/40 hover:bg-secondary"
                >
                  <a.icone className="size-5 text-primary" aria-hidden />
                  {a.rotulo}
                </Link>
              ))}
            </div>
          </Bloco>
        ) : null}
      </GradeBlocos>
    </div>
  );
}
