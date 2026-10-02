import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Eye, Hourglass, Scale, TimerReset } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta, EstadoVazio, Progresso } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { EtapaBadge } from "@/components/obrigacoes/tarefas";
import { buscarTudo } from "@/lib/supabase/paginar";
import { competenciaAtual, hojeISO, somarDias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { urgencia } from "@/lib/obrigacoes/regras";
import { STATUS_ABERTOS, STATUS_TAREFA } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Obrigações e prazos" };

interface Linha {
  id: string;
  status: string;
  etapa: string;
  competencia: string;
  prazo_legal: string | null;
  prazo_interno: string;
  responsavel_id: string | null;
  revisor_id: string | null;
  empresa: { razao_social: string; nome_fantasia: string | null } | null;
  obrigacao: { nome: string } | null;
}

export default async function PainelObrigacoes() {
  const s = await exigirEquipe();
  const hoje = hojeISO();
  const semana = somarDias(hoje, 7);
  const atual = competenciaAtual();
  const anterior = somarMeses(atual, -1);
  const campos = "id, status, etapa, competencia, prazo_legal, prazo_interno, responsavel_id, revisor_id, empresa:empresas(razao_social, nome_fantasia), obrigacao:obrigacoes(nome)";

  const [abertas, doMesAnterior, { count: concluidasMes }, { count: normasPendentes }, { data: equipe }, { data: semMunicipio }] = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("tarefas").select(campos).in("status", [...STATUS_ABERTOS]).order("prazo_interno").range(de, ate)) as Promise<unknown[]> as Promise<Linha[]>,
    buscarTudo((de, ate) => s.supabase.from("tarefas").select("id, status, obrigacao:obrigacoes(nome)").eq("competencia", anterior).range(de, ate)),
    s.supabase.from("tarefas").select("id", { count: "exact", head: true }).eq("status", "concluida").gte("concluida_em", `${atual}T00:00:00-03:00`),
    s.supabase.from("atualizacoes_normativas").select("id", { count: "exact", head: true }).in("status", ["proposta", "validada"]),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    s.supabase.from("empresas").select("id").eq("ativa", true).is("municipio_ibge", null),
  ]);

  const atrasada = (t: Linha) => (t.prazo_legal ?? t.prazo_interno) < hoje;
  const atrasadas = abertas.filter(atrasada);
  const vencendo = abertas.filter((t) => !atrasada(t) && t.prazo_interno >= hoje && t.prazo_interno <= semana);
  const cliente = abertas.filter((t) => t.status === "aguardando_cliente");
  const revisao = abertas.filter((t) => t.status === "em_revisao");
  const minhas = abertas.filter((t) => t.responsavel_id === s.usuarioId || (t.status === "em_revisao" && t.revisor_id === s.usuarioId)).slice(0, 8);
  const proximosLegais = abertas
    .filter((t) => t.prazo_legal && t.prazo_legal >= hoje)
    .sort((a, b) => (a.prazo_legal! < b.prazo_legal! ? -1 : 1))
    .slice(0, 8);

  // Carga de trabalho por pessoa (responsável; revisões contam para quem revisa)
  const carga = (equipe ?? [])
    .map((p) => {
      const dele = abertas.filter((t) => t.responsavel_id === p.id);
      return {
        id: p.id,
        nome: p.nome,
        abertas: dele.length,
        atrasadas: dele.filter(atrasada).length,
        semana: dele.filter((t) => !atrasada(t) && t.prazo_interno <= semana).length,
        revisar: abertas.filter((t) => t.status === "em_revisao" && t.revisor_id === p.id).length,
      };
    })
    .filter((c) => c.abertas || c.revisar)
    .sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas);
  const semResponsavel = abertas.filter((t) => !t.responsavel_id).length;
  const maior = Math.max(1, ...carga.map((c) => c.abertas));

  // Andamento da competência anterior, por obrigação
  const porObrigacao = new Map<string, { total: number; feitas: number }>();
  for (const t of doMesAnterior) {
    const nome = (t.obrigacao as unknown as { nome: string } | null)?.nome ?? "—";
    const x = porObrigacao.get(nome) ?? { total: 0, feitas: 0 };
    x.total++;
    if (t.status === "concluida" || t.status === "dispensada") x.feitas++;
    porObrigacao.set(nome, x);
  }
  const andamento = [...porObrigacao.entries()].sort((a, b) => a[1].feitas / a[1].total - b[1].feitas / b[1].total);
  const totalAnterior = doMesAnterior.length;
  const feitasAnterior = doMesAnterior.filter((t) => t.status === "concluida" || t.status === "dispensada").length;

  const nomeEmpresa = (t: Linha) => t.empresa?.nome_fantasia || t.empresa?.razao_social || "—";
  const base = "/escritorio/obrigacoes";

  return (
    <>
      <CabecalhoPagina
        titulo="Obrigações e prazos"
        descricao="Painel de gestão da equipe: o que está atrasado, o que vence nesta semana, o que depende do cliente e a carga de cada pessoa."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6 [&>*]:min-w-0">
        <Indicador rotulo="Atrasadas" valor={atrasadas.length} icone={AlertTriangle} tom={atrasadas.length ? "perigo" : "sucesso"} href={`${base}/tarefas?filtro=atrasadas`} />
        <Indicador rotulo="Vencem em 7 dias" valor={vencendo.length} icone={TimerReset} tom={vencendo.length ? "alerta" : "neutro"} href={`${base}/tarefas?filtro=semana`} />
        <Indicador rotulo="Aguardando cliente" valor={cliente.length} icone={Hourglass} tom={cliente.length ? "info" : "neutro"} href={`${base}/tarefas?filtro=cliente`} />
        <Indicador rotulo="Em revisão" valor={revisao.length} icone={Eye} tom="info" href={`${base}/tarefas?filtro=todas&status=em_revisao`} />
        <Indicador rotulo="Concluídas no mês" valor={concluidasMes ?? 0} icone={CheckCircle2} tom="sucesso" href={`${base}/tarefas?filtro=concluidas`} />
        <Indicador
          rotulo="Normas a validar"
          valor={normasPendentes ?? 0}
          icone={Scale}
          tom={normasPendentes ? "alerta" : "neutro"}
          href={`${base}/normas`}
          detalhe={normasPendentes ? "sem validação, não há prazo" : "tudo validado"}
        />
      </div>

      {semMunicipio?.length || semResponsavel ? (
        <div className="mb-5 space-y-2">
          {semMunicipio?.length ? (
            <Alerta tom="alerta" acao={<Link href={`${base}/empresas?situacao=cadastro`} className="text-sm font-medium underline">Ver empresas</Link>}>
              {semMunicipio.length} empresa(s) sem município do IBGE: feriados locais e regras estaduais/municipais não podem ser aplicados.
            </Alerta>
          ) : null}
          {semResponsavel ? (
            <Alerta tom="info" acao={<Link href={`${base}/tarefas`} className="text-sm font-medium underline">Atribuir</Link>}>
              {semResponsavel} tarefa(s) aberta(s) sem responsável.
            </Alerta>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Minhas prioridades</CardTitle>
              <CardDescription>Suas tarefas e revisões, pelo prazo interno.</CardDescription>
            </div>
            <Link href={`${base}/tarefas?filtro=minhas`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Ver todas <ArrowRight className="size-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {minhas.length ? (
              <ul className="divide-y divide-border">
                {minhas.map((t) => {
                  const u = urgencia(atrasada(t) ? (t.prazo_legal ?? t.prazo_interno) : t.prazo_interno, hoje);
                  const st = STATUS_TAREFA[t.status];
                  return (
                    <li key={t.id}>
                      <Link href={`${base}/tarefas/${t.id}`} className="flex items-center gap-3 py-2.5 hover:bg-muted/40">
                        <span className={cn("h-9 w-1 shrink-0 rounded-full", u.tom === "perigo" ? "bg-perigo" : u.tom === "alerta" ? "bg-alerta" : "bg-border")} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{t.obrigacao?.nome}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {nomeEmpresa(t)} · {formatarCompetencia(t.competencia)} · <EtapaBadge etapa={t.etapa} />
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm numero">{formatarData(t.prazo_interno)}</p>
                          <p className={cn("text-xs", u.tom === "perigo" ? "text-perigo" : u.tom === "alerta" ? "text-alerta-fg" : "text-muted-foreground")}>{u.rotulo}</p>
                        </div>
                        {t.status !== "pendente" ? <Badge variante={st?.tom ?? "neutro"} className="hidden sm:inline-flex">{st?.rotulo}</Badge> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EstadoVazio icone={CheckCircle2} titulo="Nada pendente com você" className="py-6" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Carga de trabalho</CardTitle>
            <CardDescription>Tarefas abertas por responsável (e revisões pendentes).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {carga.length ? (
              carga.map((c) => (
                <Link key={c.id} href={`${base}/tarefas?responsavel=${c.id}`} className="block rounded-lg p-2 hover:bg-muted/50">
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{c.nome}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.abertas} aberta(s){c.revisar ? ` · ${c.revisar} para revisar` : ""}
                    </span>
                  </div>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-label={`${c.atrasadas} atrasadas, ${c.semana} na semana, ${c.abertas - c.atrasadas - c.semana} depois`}>
                    <span className="bg-perigo" style={{ width: `${(100 * c.atrasadas) / maior}%` }} />
                    <span className="bg-alerta" style={{ width: `${(100 * c.semana) / maior}%` }} />
                    <span className="bg-primary/40" style={{ width: `${(100 * (c.abertas - c.atrasadas - c.semana)) / maior}%` }} />
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma tarefa aberta.</p>
            )}
            <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-perigo" /> atrasadas
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-alerta" /> próximos 7 dias
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary/40" /> depois
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4" /> Próximos vencimentos legais
              </CardTitle>
              <CardDescription>Entregas e pagamentos de toda a carteira.</CardDescription>
            </div>
            <Link href={`${base}/agenda?base=legal`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Agenda <ArrowRight className="size-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {proximosLegais.length ? (
              <ul className="divide-y divide-border">
                {proximosLegais.map((t) => (
                  <li key={t.id}>
                    <Link href={`${base}/tarefas/${t.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-muted/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.obrigacao?.nome}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {nomeEmpresa(t)} · <EtapaBadge etapa={t.etapa} />
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-sm font-medium numero">{formatarData(t.prazo_legal)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum vencimento legal em aberto.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Competência {formatarCompetencia(anterior)}</CardTitle>
            <CardDescription>
              {totalAnterior ? `${feitasAnterior} de ${totalAnterior} tarefas concluídas ou dispensadas.` : "Sem tarefas geradas para esta competência."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {totalAnterior ? <Progresso valor={Math.round((100 * feitasAnterior) / totalAnterior)} rotulo="Andamento da competência" /> : null}
            <ul className="space-y-2">
              {andamento.map(([nome, x]) => (
                <li key={nome} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{nome}</span>
                    <span className="shrink-0 text-xs text-muted-foreground numero">
                      {x.feitas}/{x.total}
                    </span>
                  </div>
                  <Progresso valor={Math.round((100 * x.feitas) / x.total)} className="mt-1 h-1.5" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
