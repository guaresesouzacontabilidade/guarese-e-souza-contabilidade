import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CircleCheck, Clock, Lock, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { competenciaAtual, lerCompetencia, listaCompetencias, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, formatarDataHora } from "@/lib/formatos";
import { ETAPAS_FECHAMENTO, STATUS_COMPETENCIA } from "@/lib/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Fechamentos" };
const ORDEM = ["coleta", "conferencia", "conciliacao", "revisao", "publicacao"];

export default async function Fechamentos({ searchParams }: PageProps<"/escritorio/fechamentos">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const situacao = parametro(sp, "situacao", ["aberta", "em_fechamento", "fechada"]);
  const responsavel = parametro(sp, "responsavel");
  const busca = termoBusca(sp.busca).toLowerCase();
  const fim = ultimoDiaDoMes(comp);

  const [empresas, competencias, itens, movimentos, relatorios, { data: equipe }] = await Promise.all([
    buscarTudo((de, ate) =>
      s.supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, contador_responsavel_id, contador:perfis!empresas_contador_responsavel_id_fkey(nome)")
        .eq("ativa", true)
        .order("razao_social")
        .range(de, ate),
    ),
    buscarTudo((de, ate) =>
      s.supabase
        .from("competencias")
        .select("id, empresa_id, status, fechada_em, etapas:fechamento_etapas(etapa, status), pendencias:fechamento_pendencias(status, impeditiva)")
        .eq("competencia", comp)
        .range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("checklist_itens").select("empresa_id, obrigatorio, status").eq("competencia", comp).range(de, ate)),
    buscarTudo((de, ate) =>
      s.supabase.from("movimentos_bancarios").select("empresa_id").eq("status_conciliacao", "pendente").gte("data", comp).lte("data", fim).range(de, ate),
    ),
    buscarTudo((de, ate) =>
      s.supabase.from("relatorios_publicados").select("empresa_id, situacao").eq("tipo", "pacote_mensal").eq("competencia", comp).eq("status", "publicado").range(de, ate),
    ),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
  ]);

  const porEmpresa = new Map(competencias.map((c) => [c.empresa_id, c]));
  const checklist = new Map<string, { obrig: number; ok: number }>();
  for (const i of itens) {
    if (!i.obrigatorio) continue;
    const x = checklist.get(i.empresa_id) ?? { obrig: 0, ok: 0 };
    x.obrig++;
    if (i.status === "concluido" || i.status === "nao_se_aplica") x.ok++;
    checklist.set(i.empresa_id, x);
  }
  const movPend = new Map<string, number>();
  for (const m of movimentos) movPend.set(m.empresa_id, (movPend.get(m.empresa_id) ?? 0) + 1);
  const publicados = new Map(relatorios.map((r) => [r.empresa_id, r.situacao]));

  const linhas = empresas
    .map((e) => {
      const c = porEmpresa.get(e.id);
      const etapas = (c?.etapas ?? []) as { etapa: string; status: string }[];
      const pend = ((c?.pendencias ?? []) as { status: string; impeditiva: boolean }[]).filter((p) => p.status === "aberta" && p.impeditiva).length;
      const ck = checklist.get(e.id);
      return {
        id: e.id,
        nome: e.nome_fantasia || e.razao_social,
        razao: e.razao_social,
        contadorId: e.contador_responsavel_id,
        contador: (e.contador as { nome: string } | null)?.nome ?? null,
        status: c?.status ?? "aberta",
        fechadaEm: c?.fechada_em ?? null,
        etapas: ORDEM.map((o) => etapas.find((x) => x.etapa === o)?.status ?? "nao_iniciada"),
        pendencias: pend,
        checklist: ck ? Math.round((100 * ck.ok) / ck.obrig) : null,
        movimentos: movPend.get(e.id) ?? 0,
        relatorio: publicados.get(e.id) ?? null,
      };
    })
    .filter((l) => !situacao || l.status === situacao)
    .filter((l) => !responsavel || l.contadorId === responsavel)
    .filter((l) => !busca || l.nome.toLowerCase().includes(busca) || l.razao.toLowerCase().includes(busca));

  const todas = empresas.map((e) => porEmpresa.get(e.id)?.status ?? "aberta");
  const qtd = (st: string) => todas.filter((x) => x === st).length;
  const base = "/escritorio/fechamentos";

  return (
    <>
      <CabecalhoPagina titulo="Fechamentos" descricao={`Situação do fechamento de ${formatarCompetencia(comp, true)} em cada empresa da carteira.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador rotulo="Empresas ativas" valor={empresas.length} icone={CalendarCheck} href={`${base}?competencia=${comp.slice(0, 7)}`} />
        <Indicador rotulo="Não iniciados" valor={qtd("aberta")} icone={Clock} tom={qtd("aberta") ? "alerta" : "neutro"} href={`${base}?competencia=${comp.slice(0, 7)}&situacao=aberta`} />
        <Indicador rotulo="Em fechamento" valor={qtd("em_fechamento")} icone={CalendarCheck} tom="info" href={`${base}?competencia=${comp.slice(0, 7)}&situacao=em_fechamento`} />
        <Indicador rotulo="Fechados" valor={qtd("fechada")} icone={CircleCheck} tom="sucesso" href={`${base}?competencia=${comp.slice(0, 7)}&situacao=fechada`} />
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Mês" className="w-full sm:w-52">
          {listaCompetencias(18, 0).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-full sm:w-44">
          <option value="">Todas as situações</option>
          <option value="aberta">Não iniciado</option>
          <option value="em_fechamento">Em fechamento</option>
          <option value="fechada">Fechado</option>
        </Select>
        <Select name="responsavel" defaultValue={responsavel} aria-label="Responsável" className="w-full sm:w-52">
          <option value="">Todos os responsáveis</option>
          {(equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar empresa" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>
      {linhas.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Empresa</Th>
              <Th>Situação</Th>
              <Th>Etapas</Th>
              <Th className="text-right">Documentos</Th>
              <Th className="text-right">Conciliação</Th>
              <Th>Relatório</Th>
              <Th className="text-right">Ação</Th>
            </tr>
          </THead>
          <TBody>
            {linhas.map((l) => {
              const st = STATUS_COMPETENCIA[l.status] ?? { rotulo: l.status, tom: "neutro" as const };
              return (
                <Tr key={l.id}>
                  <Td className="max-w-[15rem]">
                    <p className="truncate font-medium" title={l.razao}>
                      {l.nome}
                    </p>
                    {l.contador ? <p className="truncate text-xs text-muted-foreground">{l.contador}</p> : null}
                  </Td>
                  <Td>
                    <Badge variante={st.tom}>{l.status === "aberta" ? "Não iniciado" : st.rotulo}</Badge>
                    {l.status === "fechada" && l.fechadaEm ? <p className="text-xs text-muted-foreground">{formatarDataHora(l.fechadaEm)}</p> : null}
                    {l.pendencias ? <p className="text-xs text-perigo">{l.pendencias} pendência(s)</p> : null}
                  </Td>
                  <Td>
                    <ol className="flex gap-1" aria-label="Etapas">
                      {l.etapas.map((e, i) => (
                        <li
                          key={ORDEM[i]}
                          title={`${ETAPAS_FECHAMENTO[ORDEM[i]]}: ${e === "concluida" ? "concluída" : e === "em_andamento" ? "em andamento" : "não iniciada"}`}
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full text-[11px] font-bold",
                            e === "concluida" ? "bg-sucesso text-white" : e === "em_andamento" ? "bg-alerta-bg text-alerta-fg ring-1 ring-alerta/40" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </li>
                      ))}
                    </ol>
                  </Td>
                  <Td className="text-right text-sm">
                    {l.checklist === null ? <span className="text-muted-foreground">—</span> : <span className={l.checklist >= 100 ? "text-sucesso" : ""}>{l.checklist}%</span>}
                  </Td>
                  <Td className="text-right text-sm">
                    {l.movimentos ? <span className="whitespace-nowrap text-alerta-fg">{l.movimentos} pend.</span> : <span className="text-sucesso">em dia</span>}
                  </Td>
                  <Td>
                    {l.relatorio ? (
                      <Badge variante={l.relatorio === "revisado" ? "sucesso" : "alerta"}>{l.relatorio === "revisado" ? "Revisado" : "Preliminar"}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">não publicado</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Button asChild tamanho="sm" variante={l.status === "fechada" ? "contorno" : "primario"}>
                      <Link href={`/e/${l.id}/fechamento?competencia=${comp.slice(0, 7)}`}>
                        {l.status === "fechada" ? <Lock /> : null}
                        {l.status === "fechada" ? "Ver" : "Abrir"}
                      </Link>
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio icone={CalendarCheck} titulo="Nenhuma empresa nesta situação" />
      )}
    </>
  );
}
