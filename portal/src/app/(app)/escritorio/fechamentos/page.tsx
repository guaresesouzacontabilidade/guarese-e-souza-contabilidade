import type { Metadata } from "next";
import { CalendarCheck, Search } from "lucide-react";
import { exigirEquipe, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { QuadroFechamentos, type LinhaFechamento } from "@/components/fechamento/quadro-fechamentos";
import { competenciaAtual, lerCompetencia, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { parametro, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Fechamentos da carteira" };

const SITUACOES = ["nao_iniciado", "em_fechamento", "fechada", "impeditivas", "pendencias"] as const;
const ORDEM_STATUS: Record<string, number> = { em_fechamento: 0, aberta: 1, fechada: 2 };

type Nome = { nome: string } | null;

export default async function FechamentosCarteira({ searchParams }: PageProps<"/escritorio/fechamentos">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const situacao = parametro(sp, "situacao", SITUACOES);
  const responsavel = parametro(sp, "responsavel");
  const regime = parametro(sp, "regime", Object.keys(REGIMES));
  const busca = termoBusca(sp.busca).toLowerCase();

  const [empresas, competencias, etapas, pendencias, itens, { data: equipe }, acessos] = await Promise.all([
    buscarTudo((de, ate) =>
      s.supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, regime_tributario, contador_responsavel_id, contador:perfis!empresas_contador_responsavel_id_fkey(nome)")
        .eq("ativa", true)
        .order("razao_social")
        .range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("competencias").select("id, empresa_id, status, fechada_em, reaberta_em").eq("competencia", comp).range(de, ate)),
    buscarTudo((de, ate) =>
      s.supabase
        .from("fechamento_etapas")
        .select("empresa_id, etapa, ordem, status, resp:perfis!fechamento_etapas_responsavel_id_fkey(nome), competencias!inner(competencia)")
        .eq("competencias.competencia", comp)
        .order("ordem")
        .range(de, ate),
    ),
    buscarTudo((de, ate) =>
      s.supabase
        .from("fechamento_pendencias")
        .select("empresa_id, impeditiva, competencias!inner(competencia)")
        .eq("status", "aberta")
        .eq("competencias.competencia", comp)
        .range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("checklist_itens").select("empresa_id, status, obrigatorio").eq("competencia", comp).range(de, ate)),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    obterEmpresasDoUsuario(),
  ]);

  const podeFechar = new Set(acessos.filter((a) => a.permissoes.has("fechamento.gerenciar")).map((a) => a.id));
  const porEmpresa = new Map<string, LinhaFechamento>();
  for (const e of empresas) {
    porEmpresa.set(e.id, {
      id: e.id,
      nome: e.nome_fantasia ?? e.razao_social,
      responsavel: (e.contador as Nome)?.nome ?? null,
      acesso: podeFechar.has(e.id),
      status: "aberta",
      iniciado: false,
      etapasConcluidas: 0,
      etapasTotal: 0,
      etapaAtual: null,
      responsavelEtapa: null,
      impeditivas: 0,
      pendenciasAbertas: 0,
      checklist: null,
      fechadaEm: null,
      reaberta: false,
    });
  }
  for (const c of competencias) {
    const l = porEmpresa.get(c.empresa_id);
    if (!l) continue;
    l.status = c.status;
    l.fechadaEm = c.status === "fechada" ? c.fechada_em : null;
    l.reaberta = Boolean(c.reaberta_em) && c.status !== "fechada";
  }
  // Etapas vêm ordenadas: a primeira não concluída é a etapa atual.
  for (const et of etapas) {
    const l = porEmpresa.get(et.empresa_id);
    if (!l) continue;
    l.iniciado = true;
    l.etapasTotal++;
    if (et.status === "concluida") l.etapasConcluidas++;
    else if (!l.etapaAtual) {
      l.etapaAtual = et.etapa;
      l.responsavelEtapa = (et.resp as Nome)?.nome ?? null;
    }
  }
  for (const p of pendencias) {
    const l = porEmpresa.get(p.empresa_id);
    if (!l) continue;
    l.pendenciasAbertas++;
    if (p.impeditiva) l.impeditivas++;
  }
  const obrig = new Map<string, { total: number; ok: number }>();
  for (const i of itens) {
    if (!i.obrigatorio) continue;
    const o = obrig.get(i.empresa_id) ?? { total: 0, ok: 0 };
    o.total++;
    if (i.status === "concluido" || i.status === "nao_se_aplica") o.ok++;
    obrig.set(i.empresa_id, o);
  }
  for (const [id, o] of obrig) {
    const l = porEmpresa.get(id);
    if (l && o.total) l.checklist = Math.round((100 * o.ok) / o.total);
  }

  const naoIniciado = (l: LinhaFechamento) => l.status === "aberta";
  const filtradas = empresas
    .filter((e) => !responsavel || e.contador_responsavel_id === responsavel)
    .filter((e) => !regime || e.regime_tributario === regime)
    .filter((e) => !busca || `${e.razao_social} ${e.nome_fantasia ?? ""}`.toLowerCase().includes(busca))
    .map((e) => porEmpresa.get(e.id)!)
    .filter((l) => {
      switch (situacao) {
        case "nao_iniciado":
          return naoIniciado(l);
        case "em_fechamento":
          return l.status === "em_fechamento";
        case "fechada":
          return l.status === "fechada";
        case "impeditivas":
          return l.impeditivas > 0;
        case "pendencias":
          return l.pendenciasAbertas > 0;
        default:
          return true;
      }
    })
    .sort(
      (a, b) =>
        b.impeditivas - a.impeditivas ||
        (ORDEM_STATUS[a.status] ?? 9) - (ORDEM_STATUS[b.status] ?? 9) ||
        a.etapasConcluidas - b.etapasConcluidas ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  const todas = [...porEmpresa.values()];
  const fechadas = todas.filter((l) => l.status === "fechada").length;
  const emFechamento = todas.filter((l) => l.status === "em_fechamento").length;
  const naoIniciadas = todas.filter(naoIniciado).length;
  const comImpeditivas = todas.filter((l) => l.impeditivas > 0).length;
  const rota = "/escritorio/fechamentos";
  const filtros = { competencia: comp.slice(0, 7), responsavel, regime, busca };

  return (
    <>
      <CabecalhoPagina
        titulo="Fechamentos da carteira"
        descricao={`Situação do fechamento de ${formatarCompetencia(comp, true)} em todas as empresas atendidas: etapas, pendências e entrega de documentos.`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Fechadas"
          valor={fechadas}
          tom="sucesso"
          detalhe={todas.length ? `${Math.round((100 * fechadas) / todas.length)}% da carteira` : undefined}
          href={urlCom(rota, filtros, { situacao: "fechada" })}
        />
        <Indicador rotulo="Em fechamento" valor={emFechamento} tom={emFechamento ? "alerta" : "neutro"} href={urlCom(rota, filtros, { situacao: "em_fechamento" })} />
        <Indicador rotulo="Não iniciadas" valor={naoIniciadas} tom={naoIniciadas ? "info" : "neutro"} href={urlCom(rota, filtros, { situacao: "nao_iniciado" })} />
        <Indicador rotulo="Com pendências impeditivas" valor={comImpeditivas} tom={comImpeditivas ? "perigo" : "neutro"} href={urlCom(rota, filtros, { situacao: "impeditivas" })} />
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar empresa" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Competência">
          {listaCompetencias(24, 1).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="situacao" defaultValue={situacao} aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="nao_iniciado">Não iniciado</option>
          <option value="em_fechamento">Em fechamento</option>
          <option value="fechada">Fechada</option>
          <option value="impeditivas">Com pendências impeditivas</option>
          <option value="pendencias">Com pendências abertas</option>
        </Select>
        <Select name="responsavel" defaultValue={responsavel} aria-label="Responsável">
          <option value="">Todos os responsáveis</option>
          {(equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
        <Select name="regime" defaultValue={regime} aria-label="Regime">
          <option value="">Todos os regimes</option>
          {Object.entries(REGIMES).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="secundario">
          Filtrar
        </Button>
      </form>
      {filtradas.length ? (
        <>
          <QuadroFechamentos linhas={filtradas} competencia={comp.slice(0, 7)} />
          <p className="mt-3 text-xs text-muted-foreground">{filtradas.length} empresa(s)</p>
        </>
      ) : (
        <EstadoVazio icone={CalendarCheck} titulo="Nenhuma empresa com estes filtros" />
      )}
    </>
  );
}
