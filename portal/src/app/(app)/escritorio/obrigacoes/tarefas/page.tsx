import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, ListTodo } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { BotaoAcao } from "@/components/ui/acao";
import { TabelaTarefas, type TarefaLinha } from "@/components/obrigacoes/tarefas";
import { parametro } from "@/lib/busca";
import { competenciaAtual, hojeISO, lerCompetencia, listaCompetencias, somarDias } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { gerarTarefas } from "@/lib/obrigacoes/acoes";
import { ETAPAS, STATUS_ABERTOS, STATUS_TAREFA } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tarefas" };

const POR_PAGINA = 50;

interface Filtravel<T> {
  in(coluna: string, valores: readonly string[]): T;
  eq(coluna: string, valor: string): T;
  or(filtros: string): T;
  gte(coluna: string, valor: string): T;
  lte(coluna: string, valor: string): T;
}
const UUID = /^[0-9a-f-]{36}$/i;

const FILTROS = [
  { valor: "abertas", rotulo: "Abertas" },
  { valor: "minhas", rotulo: "Minhas" },
  { valor: "revisar", rotulo: "Para eu revisar" },
  { valor: "atrasadas", rotulo: "Atrasadas" },
  { valor: "semana", rotulo: "Próximos 7 dias" },
  { valor: "cliente", rotulo: "Aguardando cliente" },
  { valor: "concluidas", rotulo: "Concluídas" },
  { valor: "todas", rotulo: "Todas" },
] as const;

export default async function Tarefas({ searchParams }: PageProps<"/escritorio/obrigacoes/tarefas">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const filtro = parametro(sp, "filtro", FILTROS.map((f) => f.valor)) || "abertas";
  const empresa = parametro(sp, "empresa");
  const obrigacao = parametro(sp, "obrigacao");
  const etapa = parametro(sp, "etapa", Object.keys(ETAPAS));
  const responsavel = parametro(sp, "responsavel");
  const comp = lerCompetencia(parametro(sp, "competencia"));
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);
  const hoje = hojeISO();
  const semana = somarDias(hoje, 7);
  const abertos = [...STATUS_ABERTOS];

  // Aplica o filtro rápido e os filtros da URL a uma consulta de tarefas
  const aplicar = <Q extends Filtravel<Q>>(q: Q, f: string): Q => {
    let r = q;
    if (f === "abertas") r = r.in("status", abertos);
    if (f === "minhas") r = r.in("status", abertos).eq("responsavel_id", s.usuarioId);
    if (f === "revisar") r = r.eq("status", "em_revisao").eq("revisor_id", s.usuarioId);
    if (f === "atrasadas") r = r.in("status", abertos).or(`prazo_legal.lt.${hoje},and(prazo_legal.is.null,prazo_interno.lt.${hoje})`);
    if (f === "semana") r = r.in("status", abertos).gte("prazo_interno", hoje).lte("prazo_interno", semana);
    if (f === "cliente") r = r.eq("status", "aguardando_cliente");
    if (f === "concluidas") r = r.in("status", ["concluida", "dispensada"]);
    if (UUID.test(empresa)) r = r.eq("empresa_id", empresa);
    if (UUID.test(obrigacao)) r = r.eq("obrigacao_id", obrigacao);
    if (etapa) r = r.eq("etapa", etapa);
    if (UUID.test(responsavel)) r = r.eq("responsavel_id", responsavel);
    if (comp) r = r.eq("competencia", comp);
    return r;
  };

  let consulta = aplicar(
    s.supabase
      .from("tarefas")
      .select(
        "id, competencia, etapa, status, prazo_legal, prazo_interno, guia_documento_id, comprovante_documento_id, concluida_em, empresa:empresas(razao_social, nome_fantasia), obrigacao:obrigacoes(nome), responsavel:perfis!tarefas_responsavel_id_fkey(nome), revisor:perfis!tarefas_revisor_id_fkey(nome)",
        { count: "exact" },
      ),
    filtro,
  );
  consulta =
    filtro === "concluidas"
      ? consulta.order("concluida_em", { ascending: false, nullsFirst: false }).order("prazo_interno", { ascending: false })
      : consulta.order("prazo_interno").order("competencia");
  const inicio = (pagina - 1) * POR_PAGINA;

  const contar = (f: string) => aplicar(s.supabase.from("tarefas").select("id", { count: "exact", head: true }), f);
  const [{ data, count }, contagens, { data: equipe }, { data: empresas }, { data: obrigacoes }] = await Promise.all([
    consulta.range(inicio, inicio + POR_PAGINA - 1),
    Promise.all(FILTROS.map((f) => contar(f.valor))),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    s.supabase.from("empresas").select("id, razao_social").eq("ativa", true).order("razao_social"),
    s.supabase.from("obrigacoes").select("id, nome").order("nome"),
  ]);

  const linhas: TarefaLinha[] = (data ?? []).map((t) => {
    const e = t.empresa as unknown as { razao_social: string; nome_fantasia: string | null } | null;
    return {
      id: t.id,
      empresa: e?.nome_fantasia || e?.razao_social || "—",
      obrigacao: (t.obrigacao as unknown as { nome: string } | null)?.nome ?? "—",
      competencia: t.competencia,
      etapa: t.etapa,
      status: t.status,
      prazo_legal: t.prazo_legal,
      prazo_interno: t.prazo_interno,
      responsavel: (t.responsavel as unknown as { nome: string } | null)?.nome ?? null,
      revisor: (t.revisor as unknown as { nome: string } | null)?.nome ?? null,
      guia: Boolean(t.guia_documento_id),
      comprovante: Boolean(t.comprovante_documento_id),
      concluida_em: t.concluida_em,
    };
  });
  const base = "/escritorio/obrigacoes/tarefas";
  const total = count ?? 0;
  const atual = competenciaAtual();

  return (
    <>
      <CabecalhoPagina
        titulo="Tarefas"
        descricao="Apuração, entrega e pagamento de cada obrigação, por competência. Entrega e pagamento só são concluídos com recibo ou comprovante."
        acoes={
          <BotaoAcao acao={gerarTarefas.bind(null, atual.slice(0, 7), undefined)} variante="contorno">
            <CalendarPlus /> Gerar tarefas de {formatarCompetencia(atual)}
          </BotaoAcao>
        }
      />
      <nav aria-label="Filtros rápidos" className="-mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1.5">
          {FILTROS.map((f, i) => {
            const qtd = contagens[i]?.count ?? 0;
            const ativo = filtro === f.valor;
            const alerta = (f.valor === "atrasadas" || f.valor === "revisar") && qtd > 0;
            return (
              <li key={f.valor}>
                <Link
                  href={urlCom(base, sp, { filtro: f.valor === "abertas" ? null : f.valor, pagina: null })}
                  aria-current={ativo ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    ativo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {f.rotulo}
                  {f.valor !== "concluidas" && f.valor !== "todas" ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-xs font-semibold numero",
                        ativo ? "bg-primary-foreground/20" : alerta ? "bg-perigo-bg text-perigo-fg" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {qtd}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {filtro !== "abertas" ? <input type="hidden" name="filtro" value={filtro} /> : null}
        <Select name="empresa" defaultValue={empresa} aria-label="Empresa" className="w-full sm:w-64">
          <option value="">Todas as empresas</option>
          {(empresas ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.razao_social}
            </option>
          ))}
        </Select>
        <Select name="obrigacao" defaultValue={obrigacao} aria-label="Obrigação" className="w-full sm:w-60">
          <option value="">Todas as obrigações</option>
          {(obrigacoes ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </Select>
        <Select name="competencia" defaultValue={comp?.slice(0, 7) ?? ""} aria-label="Competência" className="w-full sm:w-56">
          <option value="">Todas as competências</option>
          {listaCompetencias(18, 3).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="etapa" defaultValue={etapa} aria-label="Etapa" className="w-full sm:w-44">
          <option value="">Todas as etapas</option>
          {Object.entries(ETAPAS).map(([v, e]) => (
            <option key={v} value={v}>
              {e.rotulo}
            </option>
          ))}
        </Select>
        <Select name="responsavel" defaultValue={responsavel} aria-label="Responsável" className="w-full sm:w-48">
          <option value="">Todos os responsáveis</option>
          {(equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>
      {linhas.length ? (
        <>
          <TabelaTarefas linhas={linhas} equipe={equipe ?? []} hoje={hoje} />
          <Paginacao pagina={pagina} totalPaginas={Math.ceil(total / POR_PAGINA)} total={total} montarHref={(p) => urlCom(base, sp, { pagina: p })} />
        </>
      ) : (
        <EstadoVazio
          icone={ListTodo}
          titulo={filtro === "atrasadas" ? "Nenhuma tarefa atrasada" : "Nenhuma tarefa encontrada"}
          descricao="As tarefas são geradas todos os dias pelas regras validadas. Ajuste os filtros ou gere as tarefas da competência."
        />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Situações: {Object.values(STATUS_TAREFA).map((x) => x.rotulo).join(" · ")}. O prazo mostrado é o interno; o legal aparece logo abaixo.
      </p>
    </>
  );
}
