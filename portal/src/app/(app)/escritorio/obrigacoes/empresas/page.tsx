import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownAZ, Building2, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { parametro, termoBusca } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { formatarData, formatarDocumento } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { urgencia } from "@/lib/obrigacoes/regras";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Empresas — obrigações" };

const ORDENS = [
  { valor: "razao", rotulo: "Razão social" },
  { valor: "fantasia", rotulo: "Nome fantasia" },
  { valor: "urgencia", rotulo: "Urgência de prazo" },
] as const;

const comparar = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

export default async function EmpresasOperacional({ searchParams }: PageProps<"/escritorio/obrigacoes/empresas">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const ordem = parametro(sp, "ordem", ["razao", "fantasia", "urgencia"]) || "razao";
  const regime = parametro(sp, "regime");
  const responsavel = parametro(sp, "responsavel");
  const situacao = parametro(sp, "situacao", ["atrasadas", "semana", "cliente", "revisao", "cadastro"]);
  const busca = termoBusca(sp.busca).toLowerCase();
  const hoje = hojeISO();

  const [{ data: linhas }, { data: cadastros }, { data: equipe }] = await Promise.all([
    s.supabase.rpc("operacional_empresas"),
    s.supabase.from("empresas").select("id, municipio_ibge, contador_responsavel_id").eq("ativa", true),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
  ]);
  const cadastro = new Map((cadastros ?? []).map((c) => [c.id, c]));

  const lista = (linhas ?? [])
    .map((l) => ({ ...l, semMunicipio: !cadastro.get(l.empresa_id)?.municipio_ibge, responsavelId: cadastro.get(l.empresa_id)?.contador_responsavel_id ?? null }))
    .filter((l) => !regime || l.regime === regime)
    .filter((l) => !responsavel || l.responsavelId === responsavel)
    .filter((l) => {
      if (situacao === "atrasadas") return l.atrasadas > 0;
      if (situacao === "semana") return l.vencendo_7d > 0;
      if (situacao === "cliente") return l.aguardando_cliente > 0;
      if (situacao === "revisao") return l.em_revisao > 0;
      if (situacao === "cadastro") return l.semMunicipio;
      return true;
    })
    .filter((l) => !busca || `${l.razao_social} ${l.nome_fantasia ?? ""} ${l.documento}`.toLowerCase().includes(busca));

  lista.sort((a, b) => {
    if (ordem === "fantasia") return comparar(a.nome_fantasia || a.razao_social, b.nome_fantasia || b.razao_social);
    if (ordem === "urgencia") {
      if (a.atrasadas !== b.atrasadas) return b.atrasadas - a.atrasadas;
      if (a.proximo_prazo !== b.proximo_prazo) {
        if (!a.proximo_prazo) return 1;
        if (!b.proximo_prazo) return -1;
        return a.proximo_prazo < b.proximo_prazo ? -1 : 1;
      }
      return comparar(a.razao_social, b.razao_social);
    }
    return comparar(a.razao_social, b.razao_social);
  });

  const base = "/escritorio/obrigacoes/empresas";
  const regimes = [...new Set((linhas ?? []).map((l) => l.regime))].sort();

  return (
    <>
      <CabecalhoPagina
        titulo="Tabela operacional"
        descricao="Empresas ativas com regime, local e situação das tarefas. Clique em uma empresa para ver o calendário de obrigações."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ArrowDownAZ className="size-4" /> Ordenar por
        </span>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Ordenação">
          {ORDENS.map((o) => (
            <Link
              key={o.valor}
              href={urlCom(base, sp, { ordem: o.valor === "razao" ? null : o.valor })}
              aria-current={ordem === o.valor ? "true" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                ordem === o.valor ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {o.rotulo}
            </Link>
          ))}
        </div>
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {ordem !== "razao" ? <input type="hidden" name="ordem" value={ordem} /> : null}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar por nome ou CNPJ" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Select name="regime" defaultValue={regime} aria-label="Regime" className="w-full sm:w-48">
          <option value="">Todos os regimes</option>
          {regimes.map((r) => (
            <option key={r} value={r}>
              {REGIMES[r] ?? r}
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
        <Select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-full sm:w-52">
          <option value="">Todas as situações</option>
          <option value="atrasadas">Com tarefas atrasadas</option>
          <option value="semana">Com prazos nos próximos 7 dias</option>
          <option value="cliente">Aguardando o cliente</option>
          <option value="revisao">Com tarefas em revisão</option>
          <option value="cadastro">Sem município do IBGE</option>
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      {lista.length ? (
        <Table>
          <THead>
            <tr>
              <Th>{ordem === "fantasia" ? "Nome fantasia" : "Razão social"}</Th>
              <Th>Regime</Th>
              <Th className="text-right">Abertas</Th>
              <Th className="text-right">Atrasadas</Th>
              <Th className="text-right">Até 7 dias</Th>
              <Th className="hidden text-right lg:table-cell">Com o cliente</Th>
              <Th className="hidden text-right lg:table-cell">Em revisão</Th>
              <Th>Próximo prazo</Th>
            </tr>
          </THead>
          <TBody>
            {lista.map((l) => {
              const u = urgencia(l.proximo_prazo, hoje);
              const titulo = ordem === "fantasia" ? l.nome_fantasia || l.razao_social : l.razao_social;
              const subtitulo = ordem === "fantasia" ? l.razao_social : l.nome_fantasia;
              const numero = (v: number, tom: string) => (
                <span className={cn("numero", v ? tom : "text-muted-foreground/60")}>{v || "—"}</span>
              );
              return (
                <Tr key={l.empresa_id}>
                  <Td className="min-w-[16rem]">
                    <Link href={`${base}/${l.empresa_id}`} className="font-medium text-titulo hover:underline" title={l.razao_social}>
                      {titulo}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {subtitulo ? `${subtitulo} · ` : ""}
                      {formatarDocumento(l.documento)}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{l.municipio ? `${l.municipio}/${l.uf ?? ""}` : "Local não informado"}</span>
                      {l.responsavel ? <span>· {l.responsavel}</span> : null}
                      {l.semMunicipio ? (
                        <span className="inline-flex items-center gap-1 text-alerta-fg">
                          <AlertTriangle className="size-3" /> sem código IBGE
                        </span>
                      ) : null}
                    </p>
                  </Td>
                  <Td>
                    <Badge variante="primario">{REGIMES[l.regime] ?? l.regime}</Badge>
                  </Td>
                  <Td className="text-right">{numero(l.abertas, "text-foreground")}</Td>
                  <Td className="text-right">{numero(l.atrasadas, "font-semibold text-perigo")}</Td>
                  <Td className="text-right">{numero(l.vencendo_7d, "font-semibold text-alerta-fg")}</Td>
                  <Td className="hidden text-right lg:table-cell">{numero(l.aguardando_cliente, "text-info-fg")}</Td>
                  <Td className="hidden text-right lg:table-cell">{numero(l.em_revisao, "text-foreground")}</Td>
                  <Td className="whitespace-nowrap">
                    {l.proximo_prazo ? (
                      <>
                        <p className="text-sm numero">{formatarData(l.proximo_prazo)}</p>
                        <p className={cn("text-xs", u.tom === "perigo" ? "text-perigo" : u.tom === "alerta" ? "text-alerta-fg" : "text-muted-foreground")}>{u.rotulo}</p>
                      </>
                    ) : (
                      <span className="text-xs text-sucesso">sem pendências</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio icone={Building2} titulo="Nenhuma empresa encontrada" descricao="Ajuste os filtros ou cadastre empresas em Empresas." />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {lista.length} empresa(s). O próximo prazo considera o prazo interno e o legal das tarefas abertas. Ordem padrão: razão social (A–Z).
      </p>
    </>
  );
}
