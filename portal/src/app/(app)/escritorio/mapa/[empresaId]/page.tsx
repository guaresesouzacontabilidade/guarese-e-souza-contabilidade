import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, Check, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { AnotacoesEquipe, type Anotacao } from "@/components/operacional/anotacoes";
import { BotaoAcaoEtapa, MarcacaoEtapa } from "@/components/operacional/controles-etapa";
import { CLASSE_PRAZO, CLASSE_STATUS, IconeStatus } from "@/components/operacional/visual";
import { parametro } from "@/lib/busca";
import { competenciaAtual, diasEntre, hojeISO, lerCompetencia, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import {
  ETAPAS_MAPA,
  STATUS_MAPA,
  calcularEtapas,
  diaMes,
  montarEmpresaMapa,
  proximoPasso,
  type DadosMapa,
  type EtapaCalculada,
  type LinhaMapaBanco,
} from "@/lib/operacional/mapa";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ficha operacional" };

const UUID = /^[0-9a-f-]{36}$/i;
const ETAPA_TAREFA: Record<string, string> = { apuracao: "apuração", entrega: "entrega", pagamento: "pagamento" };

type Historico = "prazo" | "tarde" | "atrasado" | "nao" | "na";
const HISTORICO: Record<Historico, { rotulo: string; classe: string }> = {
  prazo: { rotulo: "No prazo", classe: "border-sucesso bg-sucesso-bg" },
  tarde: { rotulo: "Feito com atraso", classe: "border-alerta bg-alerta-bg" },
  atrasado: { rotulo: "Atrasado", classe: "border-perigo bg-perigo" },
  nao: { rotulo: "Ainda não", classe: "border-dashed border-muted-foreground/50 bg-muted" },
  na: { rotulo: "Não se aplica", classe: "border-dashed border-border bg-card" },
};

function historicoDe(e: EtapaCalculada): Historico {
  if (e.status === "na") return "na";
  if (e.status === "ok") return e.tarde ? "tarde" : "prazo";
  return e.status === "atraso" ? "atrasado" : "nao";
}

export default async function FichaOperacional({ params, searchParams }: PageProps<"/escritorio/mapa/[empresaId]">) {
  const s = await exigirEquipe();
  const { empresaId } = await params;
  if (!UUID.test(empresaId)) notFound();
  const sp = await searchParams;
  const atual = competenciaAtual();
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(atual, -1);
  const hoje = hojeISO();

  const { data: linhas, error } = await s.supabase.rpc("operacional_mapa", { p_competencia: comp, p_empresa_id: empresaId });
  if (error) {
    return <Alerta tom="perigo">Não foi possível abrir a ficha da empresa.</Alerta>;
  }
  const linha = ((linhas ?? []) as LinhaMapaBanco[])[0];
  if (!linha) notFound();
  const empresa = montarEmpresaMapa(linha, comp, hoje, atual);

  const [{ data: historico }, { data: acoes }, { data: notas }, { data: tarefas }] = await Promise.all([
    s.supabase.rpc("operacional_historico", { p_empresa_id: empresaId, p_ate: comp, p_meses: 6 }),
    s.supabase.rpc("operacional_ultimas_acoes", { p_empresa_id: empresaId, p_limite: 8 }),
    s.supabase
      .from("operacional_anotacoes")
      .select("id, texto, criada_em, autor_id, autor:perfis!operacional_anotacoes_autor_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .order("criada_em", { ascending: false })
      .limit(30),
    s.supabase
      .from("tarefas")
      .select("id, etapa, status, prazo_legal, prazo_interno, guia_documento_id, obrigacao:obrigacoes(nome)")
      .eq("empresa_id", empresaId)
      .eq("competencia", comp)
      .not("status", "in", "(concluida,dispensada)")
      .order("prazo_interno")
      .limit(8),
  ]);

  const meses = (historico ?? []).map((h) => ({
    competencia: h.competencia,
    etapas: calcularEtapas(h.dados as unknown as DadosMapa, { empresaId, competencia: h.competencia, hoje, competenciaAtual: atual }),
  }));
  const fechados = meses.filter((m) => m.competencia < comp);
  const avisos = ETAPAS_MAPA.slice(0, 5)
    .map((et, j) => ({ nome: et.nome, vezes: fechados.filter((m) => m.etapas[j].tarde).length }))
    .filter((a) => a.vezes >= 2);

  const anotacoes: Anotacao[] = (notas ?? []).map((n) => ({
    id: n.id,
    texto: n.texto,
    criadaEm: n.criada_em,
    autor: (n.autor as { nome: string } | null)?.nome ?? null,
    podeApagar: n.autor_id === s.perfil.id || s.perfil.tipo === "admin",
  }));
  const prazos = (tarefas ?? [])
    .filter((t) => !(t.etapa === "pagamento" && t.guia_documento_id))
    .map((t) => {
      const data = t.prazo_legal ?? t.prazo_interno;
      const dias = diasEntre(hoje, data);
      return {
        id: t.id,
        data,
        nome: `${(t.obrigacao as { nome: string } | null)?.nome ?? "Obrigação"} (${ETAPA_TAREFA[t.etapa] ?? t.etapa})`,
        quando: dias < 0 ? `Atrasada há ${-dias} ${-dias === 1 ? "dia" : "dias"}` : dias === 0 ? "Vence hoje" : dias === 1 ? "Vence amanhã" : `Faltam ${dias} dias`,
        tom: (dias < 0 ? "atraso" : dias <= 3 ? "perto" : "normal") as "atraso" | "perto" | "normal",
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, 6);

  const passo = proximoPasso(empresa.etapas);
  const doc = (linha.dados as unknown as DadosMapa).documentos;
  const esperando = empresa.etapas[0].status !== "ok" && empresa.etapas[0].status !== "na" && doc.cliente + doc.atrasados > 0;
  const pct = empresa.total ? Math.round((empresa.feitas * 100) / empresa.total) : 100;
  const base = `/escritorio/mapa/${empresaId}`;

  return (
    <div className="space-y-5">
      <Link href={`/escritorio/mapa?competencia=${comp.slice(0, 7)}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <ChevronLeft className="size-4" aria-hidden /> Mapa da carteira
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 flex-[1_1_520px] items-center gap-4">
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <Building2 className="size-7" />
          </span>
          <div className="min-w-0 space-y-2">
            <h1 className="font-titulo text-2xl font-semibold tracking-tight text-titulo sm:text-3xl">{empresa.nome}</h1>
            <div className="flex flex-wrap gap-2 text-xs text-foreground">
              {[
                empresa.regime || "Regime não informado",
                formatarDocumento(empresa.documento),
                [empresa.cidade, empresa.uf].filter(Boolean).join("/") || null,
                `Responsável: ${empresa.responsavel ?? "ninguém"}`,
              ]
                .filter(Boolean)
                .map((t) => (
                  <span key={t} className="rounded-full border border-border bg-card px-2.5 py-1">
                    {t}
                  </span>
                ))}
            </div>
          </div>
        </div>
        <div className="flex flex-[0_1_320px] flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
              <Button asChild variante="fantasma" className="size-9 p-0" aria-label="Mês anterior">
                <Link href={`${base}?competencia=${somarMeses(comp, -1).slice(0, 7)}`}>
                  <ChevronLeft />
                </Link>
              </Button>
              <span className="min-w-[132px] text-center text-sm font-semibold text-titulo">{formatarCompetencia(comp, true)}</span>
              <Button asChild variante="fantasma" className="size-9 p-0" aria-label="Próximo mês">
                <Link href={`${base}?competencia=${somarMeses(comp, 1).slice(0, 7)}`}>
                  <ChevronRight />
                </Link>
              </Button>
            </div>
            <Link href={`/e/${empresaId}`} className="whitespace-nowrap text-sm font-semibold text-primary hover:underline">
              Abrir no portal
            </Link>
          </div>
          <div className="flex justify-between text-sm">
            <span className="font-semibold text-titulo">
              {empresa.feitas} de {empresa.total} etapas concluídas
            </span>
            <span className="text-muted-foreground numero">{pct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-sucesso" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
          {passo ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
              <div className="min-w-0 flex-[1_1_380px] space-y-1.5">
                <p className="text-xs font-bold tracking-wide text-primary">PRÓXIMO PASSO</p>
                <h2 className="font-titulo text-xl font-semibold text-titulo">
                  {passo.nome}: {passo.texto.toLowerCase()}
                </h2>
                <p className="text-sm text-muted-foreground">{passo.detalhe}</p>
              </div>
              {passo.acao ? <BotaoAcaoEtapa acao={passo.acao} empresaId={empresaId} competencia={comp} /> : null}
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-xl bg-sucesso-bg p-5 text-sm font-semibold text-sucesso-fg">
              <Check className="size-5" aria-hidden /> Todas as etapas do mês estão concluídas.
            </p>
          )}

          <section aria-labelledby="etapas-titulo" className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 id="etapas-titulo" className="font-titulo text-lg font-semibold text-titulo">
                Etapas do mês
              </h2>
              <p className="text-sm text-muted-foreground">Na ordem em que a equipe trabalha. Cada botão abre a tela certa da empresa.</p>
            </div>
            <ol>
              {empresa.etapas.map((e, i) => (
                <li key={e.chave} className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-border/60 px-5 py-4 last:border-b-0">
                  <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border", CLASSE_STATUS[e.status])}>
                    <IconeStatus status={e.status} className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-[1_1_300px] space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-titulo">
                        {i + 1}. {e.nome}
                      </h3>
                      <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", CLASSE_STATUS[e.status])}>
                        {STATUS_MAPA[e.status]} · {e.texto}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{e.detalhe}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {e.acao ? <BotaoAcaoEtapa acao={e.acao} empresaId={empresaId} competencia={comp} principal={false} tamanho="sm" /> : null}
                    <MarcacaoEtapa etapa={e} empresaId={empresaId} competencia={comp} tamanho="sm" />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="historico-titulo" className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="historico-titulo" className="font-titulo text-lg font-semibold text-titulo">
                Como foi nos últimos meses
              </h2>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {(Object.keys(HISTORICO) as Historico[]).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn("size-3 rounded-[3px] border", HISTORICO[k].classe)} />
                    {HISTORICO[k].rotulo}
                  </span>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-1.5 text-left">
                <thead>
                  <tr className="text-[11px] font-semibold text-muted-foreground">
                    <th scope="col" className="w-28 font-semibold">
                      Mês
                    </th>
                    {ETAPAS_MAPA.map((et) => (
                      <th key={et.chave} scope="col" className="font-semibold">
                        {et.curto}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m) => (
                    <tr key={m.competencia}>
                      <th scope="row" className={cn("text-sm text-foreground", m.competencia === comp ? "font-bold" : "font-medium")}>
                        <Link href={`${base}?competencia=${m.competencia.slice(0, 7)}`} className="hover:underline">
                          {formatarCompetencia(m.competencia)}
                        </Link>
                      </th>
                      {m.etapas.map((e) => {
                        const h = historicoDe(e);
                        return (
                          <td key={e.chave}>
                            <span role="img" aria-label={`${formatarCompetencia(m.competencia)}, ${e.nome}: ${HISTORICO[h].rotulo}`} title={`${e.nome}: ${HISTORICO[h].rotulo} · ${e.texto}`} className={cn("block h-6 rounded-md border", HISTORICO[h].classe)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {avisos.map((a) => (
              <p key={a.nome} className="flex items-start gap-2 rounded-lg border border-alerta/40 bg-alerta-bg p-3 text-sm text-alerta-fg">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <strong>
                    {a.nome}: atrasou em {a.vezes} dos últimos {fechados.length} meses.
                  </strong>{" "}
                  {a.nome === "Documentos do cliente" ? "Vale cobrar o cliente mais cedo no mês." : "Vale começar essa etapa mais cedo."}
                </span>
              </p>
            ))}
          </section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <section aria-labelledby="prazos-titulo" className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 id="prazos-titulo" className="font-titulo text-base font-semibold text-titulo">
              Prazos deste mês
            </h2>
            {prazos.length ? (
              <ul className="space-y-3">
                {prazos.map((p) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className={cn("w-14 shrink-0 rounded-lg py-1.5 text-center text-sm font-bold numero", p.tom === "atraso" ? "bg-perigo-bg text-perigo-fg" : p.tom === "perto" ? "bg-alerta-bg text-alerta-fg" : "bg-muted text-foreground")}>
                      {diaMes(p.data)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{p.nome}</p>
                      <p className={cn("text-xs font-semibold", CLASSE_PRAZO[p.tom])}>{p.quando}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma tarefa com prazo em aberto neste mês.</p>
            )}
            <Link href={`/escritorio/obrigacoes/empresas/${empresaId}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">
              Calendário de obrigações <ArrowRight className="size-4" aria-hidden />
            </Link>
          </section>

          <section aria-labelledby="cliente-titulo" className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 id="cliente-titulo" className="font-titulo text-base font-semibold text-titulo">
              Esperando o cliente
            </h2>
            {esperando ? (
              <>
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                  {doc.faltam.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                  {doc.cliente + doc.atrasados > doc.faltam.length ? <li>e mais {doc.cliente + doc.atrasados - doc.faltam.length}</li> : null}
                </ul>
                {doc.prazo ? <p className={cn("text-xs font-semibold", doc.atrasados ? "text-perigo" : "text-muted-foreground")}>Prazo: {diaMes(doc.prazo)}</p> : null}
                <BotaoAcaoEtapa acao={{ rotulo: "Cobrar o cliente agora", tipo: "cobrar" }} empresaId={empresaId} competencia={comp} principal={false} />
              </>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-sucesso-bg px-3 py-2.5 text-sm font-semibold text-sucesso-fg">
                <Check className="size-4" aria-hidden /> Nada pendente com o cliente.
              </p>
            )}
          </section>

          <section aria-labelledby="notas-titulo" className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 id="notas-titulo" className="font-titulo text-base font-semibold text-titulo">
              Anotações da equipe
            </h2>
            <AnotacoesEquipe empresaId={empresaId} anotacoes={anotacoes} />
          </section>

          <section aria-labelledby="acoes-titulo" className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 id="acoes-titulo" className="font-titulo text-base font-semibold text-titulo">
              Últimas ações
            </h2>
            {(acoes ?? []).length ? (
              <ul className="space-y-3">
                {(acoes ?? []).map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{a.texto}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.quem ?? "Portal"} · {formatarDataHora(a.quando)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
