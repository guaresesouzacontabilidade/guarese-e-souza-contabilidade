import type { Metadata } from "next";
import { ListChecks, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { QuadroCarteira, type LinhaCarteira } from "@/components/checklist/quadro-carteira";
import { competenciaAtual, hojeISO, lerCompetencia, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { parametro, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Pendências da carteira" };

export default async function PendenciasCarteira({ searchParams }: PageProps<"/escritorio/pendencias">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const situacao = parametro(sp, "situacao", ["atraso", "incompletas", "completas", "sem_checklist", "correcao", "conferir"]);
  const responsavel = parametro(sp, "responsavel");
  const regime = parametro(sp, "regime", Object.keys(REGIMES));
  const busca = termoBusca(sp.busca).toLowerCase();
  const hoje = hojeISO();

  const [empresas, itens, docs, lembretes, { data: equipe }] = await Promise.all([
    buscarTudo((de, ate) =>
      s.supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, regime_tributario, contador_responsavel_id, contador:perfis!empresas_contador_responsavel_id_fkey(nome)")
        .eq("ativa", true)
        .order("razao_social")
        .range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("checklist_itens").select("empresa_id, status, obrigatorio, prazo").eq("competencia", comp).range(de, ate)),
    buscarTudo((de, ate) =>
      s.supabase
        .from("documentos")
        .select("empresa_id, enviado_em")
        .eq("competencia", comp)
        .eq("direcao", "cliente")
        .eq("upload_status", "concluido")
        .is("excluido_em", null)
        .order("enviado_em", { ascending: false })
        .range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("lembretes").select("empresa_id, created_at").eq("competencia", comp).order("created_at", { ascending: false }).range(de, ate)),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
  ]);

  const porEmpresa = new Map<string, LinhaCarteira>();
  for (const e of empresas) {
    porEmpresa.set(e.id, {
      id: e.id,
      nome: e.nome_fantasia ?? e.razao_social,
      responsavel: (e.contador as { nome: string } | null)?.nome ?? null,
      total: 0,
      percentual: null,
      faltantes: 0,
      atrasados: 0,
      correcao: 0,
      emRevisao: 0,
      enviados: 0,
      proximoPrazo: null,
      ultimoEnvio: null,
      ultimoLembrete: null,
    });
  }
  const obrig = new Map<string, { total: number; ok: number }>();
  for (const i of itens) {
    const l = porEmpresa.get(i.empresa_id);
    if (!l) continue;
    l.total++;
    if (i.status === "pendente") l.faltantes++;
    if (i.status === "correcao") l.correcao++;
    if (i.status === "nao_se_aplica_solicitado") l.emRevisao++;
    if (i.status === "enviado" || i.status === "em_analise") l.enviados++;
    const aberto = i.status === "pendente" || i.status === "correcao";
    if (aberto && i.prazo < hoje) l.atrasados++;
    if (aberto && i.prazo >= hoje && (!l.proximoPrazo || i.prazo < l.proximoPrazo)) l.proximoPrazo = i.prazo;
    if (i.obrigatorio) {
      const o = obrig.get(i.empresa_id) ?? { total: 0, ok: 0 };
      o.total++;
      if (i.status === "concluido" || i.status === "nao_se_aplica") o.ok++;
      obrig.set(i.empresa_id, o);
    }
  }
  for (const [id, o] of obrig) {
    const l = porEmpresa.get(id);
    if (l) l.percentual = o.total ? Math.round((100 * o.ok) / o.total) : null;
  }
  for (const d of docs) {
    const l = porEmpresa.get(d.empresa_id);
    if (l && !l.ultimoEnvio) l.ultimoEnvio = d.enviado_em;
  }
  for (const r of lembretes) {
    const l = porEmpresa.get(r.empresa_id);
    if (l && !l.ultimoLembrete) l.ultimoLembrete = r.created_at;
  }

  const filtradas = empresas
    .filter((e) => !responsavel || e.contador_responsavel_id === responsavel)
    .filter((e) => !regime || e.regime_tributario === regime)
    .filter((e) => !busca || `${e.razao_social} ${e.nome_fantasia ?? ""}`.toLowerCase().includes(busca))
    .map((e) => porEmpresa.get(e.id)!)
    .filter((l) => {
      switch (situacao) {
        case "atraso":
          return l.atrasados > 0;
        case "incompletas":
          return l.total > 0 && (l.percentual ?? 0) < 100;
        case "completas":
          return l.total > 0 && l.percentual === 100;
        case "sem_checklist":
          return l.total === 0;
        case "correcao":
          return l.correcao > 0;
        case "conferir":
          return l.enviados > 0 || l.emRevisao > 0;
        default:
          return true;
      }
    })
    .sort((a, b) => b.atrasados - a.atrasados || (a.percentual ?? -1) - (b.percentual ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));

  const todas = [...porEmpresa.values()];
  const completas = todas.filter((l) => l.total > 0 && l.percentual === 100).length;
  const comAtraso = todas.filter((l) => l.atrasados > 0).length;
  const aConferir = todas.reduce((n, l) => n + l.enviados + l.emRevisao, 0);

  return (
    <>
      <CabecalhoPagina
        titulo="Pendências da carteira"
        descricao={`Entrega de documentos de ${formatarCompetencia(comp, true)} em todas as empresas atendidas. Enviado não significa conferido: os itens só concluem após a conferência.`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Empresas ativas" valor={todas.length} />
        <Indicador rotulo="Entrega completa" valor={completas} tom="sucesso" detalhe={todas.length ? `${Math.round((100 * completas) / todas.length)}% da carteira` : undefined} />
        <Indicador rotulo="Com atraso" valor={comAtraso} tom={comAtraso ? "perigo" : "neutro"} />
        <Indicador rotulo="Itens a conferir" valor={aConferir} tom={aConferir ? "info" : "neutro"} />
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
          <option value="">Todas</option>
          <option value="atraso">Com itens atrasados</option>
          <option value="correcao">Com correções pendentes</option>
          <option value="conferir">Com itens a conferir</option>
          <option value="incompletas">Entrega incompleta</option>
          <option value="completas">Entrega completa</option>
          <option value="sem_checklist">Sem checklist</option>
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
        <QuadroCarteira linhas={filtradas} competencia={comp.slice(0, 7)} />
      ) : (
        <EstadoVazio icone={ListChecks} titulo="Nenhuma empresa com estes filtros" />
      )}
    </>
  );
}
