import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, FileText, Lock } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { AcoesPendencia, BotaoIniciar, CartaoEtapa, FecharMes, NovaPendencia, ReabrirMes, type EtapaVisual } from "@/components/fechamento/fechamento";
import { carregarVerificacoes, type VerificacoesFechamento } from "@/lib/fechamento/verificacoes";
import { parametro } from "@/lib/busca";
import { competenciaAtual, lerCompetencia, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarDataHora } from "@/lib/formatos";
import { ETAPAS_FECHAMENTO, STATUS_COMPETENCIA } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Fechamento mensal" };

const ACOES_HISTORICO: Record<string, string> = {
  fechamento_iniciado: "Fechamento iniciado",
  etapa_nao_iniciada: "Etapa voltou para não iniciada",
  etapa_em_andamento: "Etapa em andamento",
  etapa_concluida: "Etapa concluída",
  pendencia_registrada: "Pendência registrada",
  pendencia_resolvida: "Pendência resolvida",
  pendencia_dispensada: "Pendência dispensada",
  pendencia_aberta: "Pendência reaberta",
  fechada: "Mês fechado",
  reaberta: "Mês reaberto",
  relatorio_publicado: "Relatório do mês publicado",
};
const ORDEM = ["coleta", "conferencia", "conciliacao", "revisao", "publicacao"] as const;
const nome = (p: unknown) => (p as { nome: string } | null)?.nome ?? null;

export default async function FechamentoMensal({ params, searchParams }: PageProps<"/e/[empresaId]/fechamento">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const podeGerenciar = ctx.pode("fechamento.gerenciar");
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const rotulo = formatarCompetencia(comp, true);
  const meses = Array.from({ length: 13 }, (_, i) => somarMeses(competenciaAtual(), -i));

  const [{ data: competencia }, { data: historicoMeses }] = await Promise.all([
    ctx.supabase
      .from("competencias")
      .select("id, status, fechada_em, reaberta_em, reabertura_justificativa, observacoes, fechou:perfis!competencias_fechada_por_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("competencia", comp)
      .maybeSingle(),
    ctx.supabase.from("competencias").select("competencia, status").eq("empresa_id", empresaId).gte("competencia", meses[meses.length - 1]),
  ]);
  const statusMes = new Map((historicoMeses ?? []).map((c) => [c.competencia, c.status]));

  const [etapasR, pendR, histR, equipeR, verificacoes] = await Promise.all([
    competencia
      ? ctx.supabase
          .from("fechamento_etapas")
          .select("id, etapa, ordem, status, responsavel_id, observacao, concluida_em, responsavel:perfis!fechamento_etapas_responsavel_id_fkey(nome)")
          .eq("competencia_id", competencia.id)
          .order("ordem")
      : Promise.resolve({ data: [] }),
    competencia
      ? ctx.supabase
          .from("fechamento_pendencias")
          .select("id, etapa, descricao, impeditiva, visivel_cliente, status, criada_em, resolvida_em, resolucao, criador:perfis!fechamento_pendencias_criada_por_fkey(nome)")
          .eq("competencia_id", competencia.id)
          .order("criada_em", { ascending: false })
      : Promise.resolve({ data: [] }),
    competencia && podeGerenciar
      ? ctx.supabase
          .from("competencia_historico")
          .select("id, acao, etapa, detalhes, em, por:perfis!competencia_historico_por_fkey(nome)")
          .eq("competencia_id", competencia.id)
          .order("em", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    podeGerenciar ? ctx.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome") : Promise.resolve({ data: [] }),
    podeGerenciar ? carregarVerificacoes(ctx.supabase, empresaId, comp) : Promise.resolve(null),
  ]);

  const pendencias = (pendR.data ?? []) as {
    id: string;
    etapa: string | null;
    descricao: string;
    impeditiva: boolean;
    visivel_cliente: boolean;
    status: string;
    criada_em: string;
    resolvida_em: string | null;
    resolucao: string | null;
    criador: unknown;
  }[];
  const abertasPorEtapa = new Map<string, number>();
  for (const p of pendencias) if (p.status === "aberta" && p.impeditiva && p.etapa) abertasPorEtapa.set(p.etapa, (abertasPorEtapa.get(p.etapa) ?? 0) + 1);
  const etapasBrutas = (etapasR.data ?? []) as { id: string; etapa: string; ordem: number; status: string; responsavel_id: string | null; observacao: string | null; concluida_em: string | null; responsavel: unknown }[];
  const etapas: EtapaVisual[] = ORDEM.map((e, i) => {
    const x = etapasBrutas.find((y) => y.etapa === e);
    return {
      id: x?.id ?? "",
      etapa: e,
      ordem: i + 1,
      status: x?.status ?? "nao_iniciada",
      responsavel_id: x?.responsavel_id ?? null,
      responsavel: nome(x?.responsavel),
      observacao: x?.observacao ?? null,
      concluida_em: x?.concluida_em ?? null,
      pendenciasAbertas: abertasPorEtapa.get(e) ?? 0,
    };
  });
  const status = competencia?.status ?? "aberta";
  const fechada = status === "fechada";
  const concluidas = etapas.filter((e) => e.status === "concluida").length;
  const faltando = etapas.filter((e) => e.etapa !== "publicacao" && e.status !== "concluida").map((e) => ETAPAS_FECHAMENTO[e.etapa]);
  const impeditivas = pendencias.filter((p) => p.status === "aberta" && p.impeditiva).length;
  const liberado = Boolean(competencia) && !fechada && faltando.length === 0 && impeditivas === 0;
  const motivo = !competencia ? "Inicie o fechamento primeiro." : faltando.length ? `Conclua: ${faltando.join(", ")}.` : impeditivas ? `Resolva ${impeditivas} pendência(s) impeditiva(s).` : null;
  const st = STATUS_COMPETENCIA[status] ?? { rotulo: status, tom: "neutro" as const };

  return (
    <>
      <CabecalhoPagina
        titulo="Fechamento mensal"
        descricao="Coleta de documentos → conferência → conciliação → revisão → publicação dos relatórios. Depois de fechado, o mês fica protegido contra alterações."
        acoes={
          <form className="flex items-center gap-2">
            <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Mês" className="w-64">
              {meses.map((m) => (
                <option key={m} value={m.slice(0, 7)}>
                  {formatarCompetencia(m, true)}
                  {statusMes.get(m) === "fechada" ? " (fechado)" : statusMes.get(m) === "em_fechamento" ? " (em fechamento)" : ""}
                </option>
              ))}
            </Select>
            <Button type="submit" variante="contorno">
              Ver
            </Button>
          </form>
        }
      />

      <section className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {rotulo} <Badge variante={st.tom}>{st.rotulo}</Badge>
          </p>
          <p className="text-sm text-muted-foreground">
            {fechada
              ? `Fechado em ${formatarDataHora(competencia?.fechada_em)}${nome(competencia?.fechou) ? ` por ${nome(competencia?.fechou)}` : ""}.`
              : competencia
                ? `${concluidas} de 5 etapas concluídas.`
                : "O fechamento deste mês ainda não foi iniciado."}
          </p>
          {competencia?.observacoes ? <p className="text-sm">Observação: {competencia.observacoes}</p> : null}
        </div>
        {podeGerenciar ? (
          <div className="flex flex-wrap items-start gap-2">
            {!competencia || status === "aberta" ? <BotaoIniciar empresaId={empresaId} comp={comp} /> : null}
            {competencia && !fechada ? <FecharMes empresaId={empresaId} comp={comp} rotulo={rotulo} liberado={liberado} motivo={motivo} /> : null}
            {fechada && ctx.pode("fechamento.reabrir") ? <ReabrirMes empresaId={empresaId} comp={comp} rotulo={rotulo} /> : null}
            <Button asChild variante="contorno">
              <Link href={`/e/${empresaId}/relatorios/publicados/novo?periodo=${comp.slice(0, 7)}`}>
                <FileText /> Preparar relatório do mês
              </Link>
            </Button>
          </div>
        ) : null}
      </section>

      {competencia?.reaberta_em ? (
        <Alerta tom="alerta" className="mb-5" titulo={`Mês reaberto em ${formatarDataHora(competencia.reaberta_em)}`}>
          Justificativa: {competencia.reabertura_justificativa}
        </Alerta>
      ) : null}

      {podeGerenciar && verificacoes ? (
        <section className="mb-8 space-y-3" aria-labelledby="t-etapas">
          <h2 id="t-etapas" className="text-base font-semibold">
            Etapas
          </h2>
          {!competencia ? (
            <Alerta tom="info">As verificações abaixo já mostram a situação do mês. Clique em “Iniciar fechamento” para acompanhar as etapas e definir responsáveis.</Alerta>
          ) : null}
          <ol className="space-y-3">
            {etapas.map((e) => (
              <CartaoEtapa
                key={e.etapa}
                empresaId={empresaId}
                etapa={e}
                verificacoes={(verificacoes as VerificacoesFechamento)[e.etapa as keyof VerificacoesFechamento]}
                equipe={(equipeR.data ?? []) as { id: string; nome: string }[]}
                podeGerenciar={podeGerenciar && Boolean(e.id)}
                bloqueada={fechada && e.etapa !== "publicacao"}
              />
            ))}
          </ol>
        </section>
      ) : !podeGerenciar ? (
        <section className="mb-8">
          <ol className="grid gap-2 sm:grid-cols-5">
            {etapas.map((e) => (
              <li key={e.etapa} className="rounded-lg border border-border bg-card p-3 text-sm">
                <p className="font-medium">
                  {e.ordem}. {ETAPAS_FECHAMENTO[e.etapa]}
                </p>
                <Badge variante={e.status === "concluida" ? "sucesso" : e.status === "em_andamento" ? "alerta" : "neutro"} className="mt-1">
                  {e.status === "concluida" ? "Concluída" : e.status === "em_andamento" ? "Em andamento" : "Não iniciada"}
                </Badge>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="mb-8 space-y-3" aria-labelledby="t-pend">
        <div className="flex items-center justify-between gap-2">
          <h2 id="t-pend" className="text-base font-semibold">
            Pendências do fechamento
          </h2>
          {podeGerenciar && competencia && !fechada ? <NovaPendencia empresaId={empresaId} competenciaId={competencia.id} /> : null}
        </div>
        {pendencias.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {pendencias.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className={p.status === "aberta" ? "font-medium" : "text-muted-foreground line-through"}>{p.descricao}</p>
                  <p className="flex flex-wrap gap-1.5 pt-1 text-xs text-muted-foreground">
                    {p.etapa ? <Badge variante="contorno">{ETAPAS_FECHAMENTO[p.etapa]}</Badge> : null}
                    {p.impeditiva ? <Badge variante="perigo">Impede o fechamento</Badge> : null}
                    {p.visivel_cliente ? <Badge variante="info">Visível ao cliente</Badge> : null}
                    <span>
                      {formatarDataHora(p.criada_em)}
                      {nome(p.criador) ? ` · ${nome(p.criador)}` : ""}
                    </span>
                    {p.status !== "aberta" ? (
                      <span>
                        · {p.status === "resolvida" ? "resolvida" : "dispensada"} em {formatarDataHora(p.resolvida_em)}
                        {p.resolucao ? ` — ${p.resolucao}` : ""}
                      </span>
                    ) : null}
                  </p>
                </div>
                {podeGerenciar && !fechada ? <AcoesPendencia empresaId={empresaId} pendenciaId={p.id} status={p.status} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma pendência registrada para este mês.</p>
        )}
      </section>

      {podeGerenciar && (histR.data ?? []).length ? (
        <details className="rounded-lg border border-border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Histórico do fechamento</summary>
          <ul className="space-y-1 px-4 pb-4 text-sm">
            {((histR.data ?? []) as { id: number; acao: string; etapa: string | null; detalhes: Record<string, unknown> | null; em: string; por: unknown }[]).map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{formatarDataHora(h.em)}</span>
                <span className="font-medium">{ACOES_HISTORICO[h.acao] ?? h.acao}</span>
                {h.etapa ? <span>· {ETAPAS_FECHAMENTO[h.etapa]}</span> : null}
                {nome(h.por) ? <span className="text-muted-foreground">· {nome(h.por)}</span> : null}
                {typeof h.detalhes?.justificativa === "string" ? <span className="text-muted-foreground">— {h.detalhes.justificativa}</span> : null}
                {typeof h.detalhes?.descricao === "string" ? <span className="text-muted-foreground">— {h.detalhes.descricao}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!podeGerenciar && !competencia ? (
        <EstadoVazio icone={CalendarCheck} titulo="O escritório ainda não iniciou o fechamento deste mês" descricao="Envie os documentos do mês para que o fechamento possa começar." />
      ) : null}
      {fechada ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden /> Lançamentos, pagamentos, conciliações e documentos de {rotulo} estão protegidos contra alterações.
        </p>
      ) : null}
    </>
  );
}
