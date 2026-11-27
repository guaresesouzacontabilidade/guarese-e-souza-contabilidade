import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { parametro } from "@/lib/busca";
import { competenciaAtual, hojeISO, lerCompetencia, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, nomeMes } from "@/lib/formatos";
import { ETAPAS } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agenda de obrigações" };

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const UUID = /^[0-9a-f-]{36}$/i;

interface Item {
  id: string;
  dia: string;
  titulo: string;
  empresa: string;
  etapa: string;
  status: string;
}

function diaSemana(iso: string) {
  // 0 = segunda ... 6 = domingo
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export default async function Agenda({ searchParams }: PageProps<"/escritorio/obrigacoes/agenda">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const mes = lerCompetencia(parametro(sp, "mes")) ?? competenciaAtual();
  const base = parametro(sp, "base", ["interno", "legal"]) || "interno";
  const responsavel = parametro(sp, "responsavel");
  const empresa = parametro(sp, "empresa");
  const fim = ultimoDiaDoMes(mes);
  const hoje = hojeISO();
  const coluna = base === "legal" ? "prazo_legal" : "prazo_interno";

  let q = s.supabase
    .from("tarefas")
    .select("id, etapa, status, prazo_legal, prazo_interno, empresa:empresas(razao_social, nome_fantasia), obrigacao:obrigacoes(nome)")
    .neq("status", "dispensada")
    .gte(coluna, mes)
    .lte(coluna, fim)
    .order(coluna)
    .limit(2000);
  if (UUID.test(responsavel)) q = q.eq("responsavel_id", responsavel);
  if (UUID.test(empresa)) q = q.eq("empresa_id", empresa);

  const [{ data: tarefas }, { data: escritorio }, { data: equipe }, { data: empresas }] = await Promise.all([
    q,
    s.supabase.from("escritorio").select("cidade, uf").eq("id", 1).maybeSingle(),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    s.supabase.from("empresas").select("id, razao_social").eq("ativa", true).order("razao_social"),
  ]);
  const uf = escritorio?.uf?.toUpperCase() ?? null;
  const { data: munEscritorio } =
    uf && escritorio?.cidade ? await s.supabase.from("municipios").select("ibge").eq("uf", uf).ilike("nome", escritorio.cidade).maybeSingle() : { data: null };
  const { data: feriados } = await s.supabase.from("feriados").select("data, nome, abrangencia, uf, municipio_ibge, tipo").gte("data", mes).lte("data", fim);
  const feriadosLocais = (feriados ?? []).filter(
    (f) => f.abrangencia === "nacional" || (f.abrangencia === "estadual" && f.uf === uf) || (f.abrangencia === "municipal" && f.municipio_ibge === munEscritorio?.ibge),
  );

  const itens: Item[] = (tarefas ?? []).map((t) => {
    const e = t.empresa as unknown as { razao_social: string; nome_fantasia: string | null } | null;
    return {
      id: t.id,
      dia: (base === "legal" ? t.prazo_legal : t.prazo_interno) as string,
      titulo: (t.obrigacao as unknown as { nome: string } | null)?.nome ?? "—",
      empresa: e?.nome_fantasia || e?.razao_social || "—",
      etapa: t.etapa,
      status: t.status,
    };
  });
  const porDia = new Map<string, Item[]>();
  for (const i of itens) porDia.set(i.dia, [...(porDia.get(i.dia) ?? []), i]);
  const feriadoDoDia = new Map<string, string[]>();
  for (const f of feriadosLocais) feriadoDoDia.set(f.data, [...(feriadoDoDia.get(f.data) ?? []), f.tipo === "feriado" ? f.nome : `${f.nome} (sem expediente bancário)`]);

  const totalDias = Number(fim.slice(8, 10));
  const dias = Array.from({ length: totalDias }, (_, i) => `${mes.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
  const vazios = diaSemana(dias[0]);
  const rota = "/escritorio/obrigacoes/agenda";
  const ano = mes.slice(0, 4);
  const nome = nomeMes(Number(mes.slice(5, 7)));
  const titulo = `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;

  const chip = (i: Item) => {
    const feito = i.status === "concluida";
    const atrasado = !feito && i.dia < hoje;
    const cor = feito ? "bg-sucesso" : atrasado ? "bg-perigo" : i.etapa === "pagamento" ? "bg-alerta" : i.etapa === "entrega" ? "bg-info" : "bg-primary/60";
    return (
      <Link
        key={i.id}
        href={`/escritorio/obrigacoes/tarefas/${i.id}`}
        title={`${i.titulo} — ${ETAPAS[i.etapa]?.rotulo} — ${i.empresa}`}
        className={cn(
          "flex items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight transition-colors hover:bg-muted",
          feito ? "text-muted-foreground line-through decoration-muted-foreground/40" : atrasado ? "bg-perigo-bg/70 text-perigo-fg" : "text-foreground",
        )}
      >
        {feito ? <Check className="size-3 shrink-0 text-sucesso" /> : <span className={cn("size-2 shrink-0 rounded-full", cor)} aria-hidden />}
        <span className="truncate">
          <span className="font-medium">{i.titulo.split(" — ")[0]}</span> · {i.empresa}
        </span>
      </Link>
    );
  };

  return (
    <>
      <CabecalhoPagina
        titulo="Agenda"
        descricao={base === "legal" ? "Prazos legais de entrega e de pagamento." : "Prazos internos da equipe (antes do vencimento legal)."}
        acoes={
          <div className="flex items-center gap-1">
            <Button variante="contorno" tamanho="icone" asChild aria-label="Mês anterior">
              <Link href={urlCom(rota, sp, { mes: somarMeses(mes, -1).slice(0, 7) })}>
                <ChevronLeft />
              </Link>
            </Button>
            <span className="min-w-40 text-center text-base font-semibold text-titulo">{titulo}</span>
            <Button variante="contorno" tamanho="icone" asChild aria-label="Próximo mês">
              <Link href={urlCom(rota, sp, { mes: somarMeses(mes, 1).slice(0, 7) })}>
                <ChevronRight />
              </Link>
            </Button>
            {mes !== competenciaAtual() ? (
              <Button variante="fantasma" tamanho="sm" asChild>
                <Link href={urlCom(rota, sp, { mes: null })}>Hoje</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="mes" value={mes.slice(0, 7)} />
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Prazo exibido">
          {[
            { v: "interno", r: "Prazo interno" },
            { v: "legal", r: "Prazo legal" },
          ].map((o) => (
            <Link
              key={o.v}
              href={urlCom(rota, sp, { base: o.v === "interno" ? null : o.v })}
              className={cn("rounded-md px-3 py-1.5 text-sm", base === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {o.r}
            </Link>
          ))}
        </div>
        {base !== "interno" ? <input type="hidden" name="base" value={base} /> : null}
        <Select name="responsavel" defaultValue={responsavel} aria-label="Responsável" className="w-full sm:w-52">
          <option value="">Toda a equipe</option>
          {(equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
        <Select name="empresa" defaultValue={empresa} aria-label="Empresa" className="w-full sm:w-60">
          <option value="">Todas as empresas</option>
          {(empresas ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.razao_social}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {[
          { c: "bg-primary/60", r: "Apuração" },
          { c: "bg-info", r: "Entrega" },
          { c: "bg-alerta", r: "Pagamento" },
          { c: "bg-perigo", r: "Atrasada" },
          { c: "bg-sucesso", r: "Concluída" },
        ].map((l) => (
          <span key={l.r} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", l.c)} /> {l.r}
          </span>
        ))}
      </div>

      {/* Grade mensal (telas médias e grandes) */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
        <div className="grid grid-cols-7 border-b border-border bg-muted/60">
          {DIAS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: vazios }, (_, i) => (
            <div key={`v${i}`} className="min-h-32 border-b border-r border-border bg-muted/30" />
          ))}
          {dias.map((d) => {
            const lista = porDia.get(d) ?? [];
            const feriado = feriadoDoDia.get(d);
            const fds = diaSemana(d) >= 5;
            return (
              <div key={d} className={cn("min-h-32 border-b border-r border-border p-1.5", (fds || feriado) && "bg-muted/40", d === hoje && "ring-2 ring-inset ring-primary")}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("text-xs font-semibold", d === hoje ? "rounded-full bg-primary px-1.5 text-primary-foreground" : fds || feriado ? "text-muted-foreground" : "text-foreground")}>
                    {Number(d.slice(8, 10))}
                  </span>
                  {lista.length ? <span className="text-[10px] text-muted-foreground">{lista.length}</span> : null}
                </div>
                {feriado ? <p className="mb-1 truncate text-[10px] font-medium text-perigo-fg" title={feriado.join(" · ")}>{feriado[0]}</p> : null}
                <div className="space-y-0.5">
                  {lista.slice(0, 4).map(chip)}
                  {lista.length > 4 ? (
                    <a href={`#dia-${d}`} className="block text-[11px] font-medium text-primary hover:underline">
                      + {lista.length - 4} tarefa(s)
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista por dia (todas as telas; detalha os dias cheios) */}
      <section className="mt-6 space-y-4" aria-label="Tarefas por dia">
        <h2 className="flex items-center gap-2 text-base font-semibold text-titulo">
          <CalendarDays className="size-4" /> Dia a dia — {formatarCompetencia(mes, true)}
        </h2>
        {dias.filter((d) => porDia.has(d)).length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma tarefa com prazo neste mês.</p> : null}
        {dias
          .filter((d) => porDia.has(d))
          .map((d) => (
            <div key={d} id={`dia-${d}`} className="scroll-mt-20 rounded-lg border border-border bg-card p-3">
              <p className={cn("mb-2 text-sm font-semibold", d < hoje ? "text-muted-foreground" : "text-titulo")}>
                {DIAS[diaSemana(d)]}, {d.slice(8, 10)}/{d.slice(5, 7)}
                {feriadoDoDia.get(d) ? <span className="ml-2 text-xs font-normal text-perigo-fg">{feriadoDoDia.get(d)!.join(" · ")}</span> : null}
              </p>
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{(porDia.get(d) ?? []).map(chip)}</div>
            </div>
          ))}
      </section>
    </>
  );
}
