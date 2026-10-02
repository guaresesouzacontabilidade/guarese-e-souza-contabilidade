import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { EditarObrigacao } from "@/components/obrigacoes/catalogo";
import { parametro, termoBusca } from "@/lib/busca";
import { competenciaAtual } from "@/lib/competencia";
import { descreverPrazo, type RegraPrazo } from "@/lib/obrigacoes/regras";
import { AREAS, ESFERAS, ETAPAS, PERIODICIDADES } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Catálogo de obrigações" };

const ORDEM_ESFERA = ["federal", "nacional", "estadual", "municipal"];

export default async function Catalogo({ searchParams }: PageProps<"/escritorio/obrigacoes/catalogo">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const esfera = parametro(sp, "esfera", ORDEM_ESFERA);
  const area = parametro(sp, "area", Object.keys(AREAS));
  const busca = termoBusca(sp.busca).toLowerCase();
  const atual = competenciaAtual();
  const admin = s.perfil.tipo === "admin";

  const [{ data: obrigacoes }, { data: regras }, { data: categorias }] = await Promise.all([
    s.supabase.from("obrigacoes").select("*").order("nome"),
    s.supabase.from("obrigacao_regras").select("id, obrigacao_id, status, vigencia_inicio, vigencia_fim, prazo_entrega, prazo_pagamento, ufs, municipios, empresa_id"),
    s.supabase.from("categorias_documento").select("codigo, nome").eq("ativo", true).order("ordem"),
  ]);

  const lista = (obrigacoes ?? [])
    .filter((o) => !esfera || o.esfera === esfera)
    .filter((o) => !area || o.area === area)
    .filter((o) => !busca || `${o.nome} ${o.codigo} ${o.tributos.join(" ")}`.toLowerCase().includes(busca));

  const resumo = (obrigacaoId: string, periodicidade: string) => {
    const doItem = (regras ?? []).filter((r) => r.obrigacao_id === obrigacaoId);
    const vigentes = doItem.filter((r) => r.status === "validada" && r.vigencia_inicio <= atual && (!r.vigencia_fim || r.vigencia_fim >= atual));
    const futuras = doItem.filter((r) => r.status === "validada" && r.vigencia_inicio > atual);
    const propostas = doItem.filter((r) => r.status === "rascunho").length;
    const geral = vigentes.find((r) => !r.ufs?.length && !r.municipios?.length && !r.empresa_id) ?? vigentes[0];
    const prazo = (geral?.prazo_pagamento ?? geral?.prazo_entrega ?? null) as RegraPrazo | null;
    const locais = vigentes.filter((r) => r.ufs?.length || r.municipios?.length).length;
    const encerrada = !vigentes.length && doItem.some((r) => r.status === "validada" && r.vigencia_fim && r.vigencia_fim < atual);
    return { vigentes: vigentes.length, futuras: futuras.length, propostas, prazo: prazo ? descreverPrazo(prazo, periodicidade) : null, locais, encerrada, inicioFutura: futuras[0]?.vigencia_inicio };
  };

  const grupos = ORDEM_ESFERA.map((e) => ({ esfera: e, itens: lista.filter((o) => o.esfera === e) })).filter((g) => g.itens.length);
  const base = "/escritorio/obrigacoes/catalogo";

  return (
    <>
      <CabecalhoPagina
        titulo="Catálogo de obrigações"
        descricao="Cada obrigação tem regras por vigência, com aplicabilidade, periodicidade, regra de vencimento, tratamento de feriados e fonte oficial."
        acoes={admin ? <EditarObrigacao obrigacao={null} categorias={categorias ?? []} /> : null}
      />

      <div className="mb-5 grid gap-3 rounded-xl border border-border bg-gradient-to-br from-bege/60 to-card p-4 text-sm sm:grid-cols-4">
        <div className="sm:col-span-4">
          <p className="font-semibold text-titulo">Transição da reforma tributária (EC nº 132/2023 e LC nº 214/2025)</p>
          <p className="text-xs text-muted-foreground">Cada tributo segue a vigência das regras por competência; o histórico das competências anteriores é preservado.</p>
        </div>
        {[
          { ano: "2026", texto: "Ano de teste: CBS 0,9% e IBS 0,1% destacados nas notas; PIS/Cofins, ICMS e ISS continuam." },
          { ano: "2027", texto: "CBS substitui PIS/Cofins (competências até 12/2026 mantidas). IBS a 0,1% em 2027–2028." },
          { ano: "2029–2032", texto: "ICMS e ISS reduzem gradualmente; IBS aumenta na mesma proporção." },
          { ano: "2033", texto: "ICMS e ISS extintos; o histórico permanece nas tarefas das competências anteriores." },
        ].map((f) => (
          <div key={f.ano} className="rounded-lg border border-border/70 bg-card/80 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">{f.ano}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.texto}</p>
          </div>
        ))}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar obrigação ou tributo" className="pl-9" aria-label="Buscar" />
        </div>
        <Select name="esfera" defaultValue={esfera} aria-label="Esfera" className="w-full sm:w-48">
          <option value="">Todas as esferas</option>
          {ORDEM_ESFERA.map((e) => (
            <option key={e} value={e}>
              {ESFERAS[e]}
            </option>
          ))}
        </Select>
        <Select name="area" defaultValue={area} aria-label="Área" className="w-full sm:w-48">
          <option value="">Todas as áreas</option>
          {Object.entries(AREAS).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      {grupos.length ? (
        <div className="space-y-6">
          {grupos.map((g) => (
            <section key={g.esfera}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ESFERAS[g.esfera]}</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.itens.map((o) => {
                  const r = resumo(o.id, o.periodicidade);
                  return (
                    <Link
                      key={o.id}
                      href={`${base}/${o.id}`}
                      className={cn(
                        "group flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                        !o.ativa && "opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold leading-snug text-titulo">{o.nome}</p>
                        <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {PERIODICIDADES[o.periodicidade]} · {AREAS[o.area]} · {o.etapas.map((e: string) => ETAPAS[e]?.rotulo).join(", ")}
                        {o.tributos.length ? ` · ${o.tributos.join(", ")}` : ""}
                      </p>
                      <p className="mt-3 flex-1 text-sm">
                        {r.prazo ? (
                          r.prazo
                        ) : r.encerrada ? (
                          <span className="text-muted-foreground">Encerrada — mantida no histórico</span>
                        ) : r.inicioFutura ? (
                          <span className="text-muted-foreground">Passa a valer em {r.inicioFutura.slice(5, 7)}/{r.inicioFutura.slice(0, 4)}</span>
                        ) : r.vigentes ? (
                          <span className="text-muted-foreground">{r.locais ? `${r.locais} regra(s) por estado/município` : "Em vigor — prazo a regulamentar"}</span>
                        ) : (
                          <span className="text-muted-foreground">Sem regra validada: nenhuma data é presumida</span>
                        )}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {r.vigentes ? <Badge variante="sucesso">{r.vigentes} regra(s) em vigor</Badge> : null}
                        {r.futuras ? <Badge variante="info">{r.futuras} futura(s)</Badge> : null}
                        {r.propostas ? <Badge variante="alerta">{r.propostas} aguardando validação</Badge> : null}
                        {!r.vigentes && !r.futuras && !r.propostas ? <Badge variante="perigo">sem regra</Badge> : null}
                        {!o.ativa ? <Badge>inativa</Badge> : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EstadoVazio icone={BookOpenCheck} titulo="Nenhuma obrigação encontrada" />
      )}
    </>
  );
}
