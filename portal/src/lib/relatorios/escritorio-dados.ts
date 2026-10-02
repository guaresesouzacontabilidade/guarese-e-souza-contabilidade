import "server-only";
import type { ClienteSupabase } from "@/lib/supabase/server";
import { buscarTudo } from "@/lib/supabase/paginar";
import { competenciaDe, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, formatarDocumento } from "@/lib/formatos";
import { STATUS_COMPETENCIA } from "@/lib/rotulos";
import { mesesEntre } from "./calculos";
import { contarPorEmpresaMes, entregaChecklist, pendenciasChecklist, percentualInteiro } from "./carteira";
import type { Secao } from "./tabelas";

/**
 * Relatórios operacionais do escritório (documentos, checklist, fechamento e
 * pendências) para as empresas visíveis ao usuário (RLS). Usado pela página
 * /escritorio/relatorios e pela exportação.
 */

export const ABAS_ESCRITORIO = {
  documentos: "Documentos recebidos",
  checklist: "Entrega do checklist",
  fechamento: "Fechamento",
  pendencias: "Pendências atuais",
} as const;

export type AbaEscritorio = keyof typeof ABAS_ESCRITORIO;

export function lerAbaEscritorio(v: unknown): AbaEscritorio {
  return typeof v === "string" && v in ABAS_ESCRITORIO ? (v as AbaEscritorio) : "documentos";
}

export interface FiltrosEscritorio {
  inicio: string;
  fim: string;
  responsavel: string;
  situacao: "ativas" | "todas";
}

export async function carregarRelatorioEscritorio(sb: ClienteSupabase, f: FiltrosEscritorio, hoje: string) {
  const ate = ultimoDiaDoMes(f.fim);
  const [empresas, documentos, itens, itensAbertos, competencias, pendenciasFechamento, aposFechamento] = await Promise.all([
    buscarTudo((de, a) => {
      let q = sb
        .from("empresas")
        .select("id, razao_social, nome_fantasia, documento, contador_responsavel_id, ativa")
        .order("razao_social")
        .order("id")
        .range(de, a);
      if (f.situacao === "ativas") q = q.eq("ativa", true);
      if (f.responsavel) q = q.eq("contador_responsavel_id", f.responsavel);
      return q;
    }),
    buscarTudo((de, a) =>
      sb
        .from("documentos")
        .select("empresa_id, competencia, status")
        .eq("direcao", "cliente")
        .eq("upload_status", "concluido")
        .is("excluido_em", null)
        .is("zip_origem_id", null)
        .gte("competencia", f.inicio)
        .lte("competencia", ate)
        .order("id")
        .range(de, a),
    ),
    buscarTudo((de, a) =>
      sb
        .from("checklist_itens")
        .select("empresa_id, competencia, status, obrigatorio, prazo")
        .gte("competencia", f.inicio)
        .lte("competencia", ate)
        .order("id")
        .range(de, a),
    ),
    // Pendências atuais: itens em aberto de qualquer competência
    buscarTudo((de, a) =>
      sb
        .from("checklist_itens")
        .select("empresa_id, competencia, status, obrigatorio, prazo")
        .in("status", ["pendente", "correcao", "nao_se_aplica_solicitado"])
        .order("id")
        .range(de, a),
    ),
    buscarTudo((de, a) =>
      sb.from("competencias").select("empresa_id, competencia, status").gte("competencia", f.inicio).lte("competencia", ate).order("id").range(de, a),
    ),
    buscarTudo((de, a) => sb.from("fechamento_pendencias").select("empresa_id, impeditiva").eq("status", "aberta").order("id").range(de, a)),
    buscarTudo((de, a) =>
      sb
        .from("documentos")
        .select("empresa_id")
        .eq("recebido_apos_fechamento", true)
        .is("apos_fechamento_avaliado_em", null)
        .is("excluido_em", null)
        .order("id")
        .range(de, a),
    ),
  ]);

  const ids = new Set(empresas.map((e) => e.id));
  const meses = mesesEntre(f.inicio, f.fim);
  const docs = documentos.filter((d) => ids.has(d.empresa_id));
  const docsMatriz = contarPorEmpresaMes(docs, meses);
  const docsPorMes = meses.map((_, i) => [...docsMatriz.values()].reduce((t, v) => t + v[i], 0));
  const docsPorStatus = docs.reduce<Record<string, number>>((acc, d) => ((acc[d.status ?? "recebido"] = (acc[d.status ?? "recebido"] ?? 0) + 1), acc), {});
  const entrega = entregaChecklist(
    itens.filter((i) => ids.has(i.empresa_id)),
    meses,
  );
  const statusComp = new Map<string, string[]>();
  const idxMes = new Map(meses.map((m, i) => [m, i]));
  for (const c of competencias) {
    if (!ids.has(c.empresa_id)) continue;
    const i = idxMes.get(competenciaDe(c.competencia));
    if (i === undefined) continue;
    const v = statusComp.get(c.empresa_id) ?? meses.map(() => "aberta");
    v[i] = c.status;
    statusComp.set(c.empresa_id, v);
  }
  const mesAtual = competenciaDe(hoje);
  const mesesPassados = meses.filter((m) => m < mesAtual);
  const fechadas = [...statusComp.values()].reduce((t, v) => t + v.filter((st, i) => st === "fechada" && meses[i] < mesAtual).length, 0);

  const pendChecklist = pendenciasChecklist(
    itensAbertos.filter((i) => ids.has(i.empresa_id)),
    hoje,
  );
  const contar = (lista: { empresa_id: string }[]) =>
    lista.reduce((m, x) => (ids.has(x.empresa_id) ? m.set(x.empresa_id, (m.get(x.empresa_id) ?? 0) + 1) : m), new Map<string, number>());
  const pendFech = contar(pendenciasFechamento);
  const aposFech = contar(aposFechamento);
  const pendencias = empresas
    .map((e) => {
      const p = pendChecklist.get(e.id) ?? { atrasados: 0, faltantes: 0, correcao: 0, naoAplicaRevisar: 0 };
      return { empresaId: e.id, ...p, fechamento: pendFech.get(e.id) ?? 0, aposFechamento: aposFech.get(e.id) ?? 0 };
    })
    .sort((a, b) => b.atrasados - a.atrasados || b.faltantes - a.faltantes);

  return {
    meses,
    mesAtual,
    empresas: empresas.map((e) => ({ ...e, nome: e.nome_fantasia ?? e.razao_social })),
    docsMatriz,
    docsPorMes,
    docsPorStatus,
    totalDocs: docs.length,
    entrega,
    statusComp,
    fechadas,
    possiveisFechadas: mesesPassados.length * empresas.length,
    pendencias,
  };
}

export type RelatorioEscritorio = Awaited<ReturnType<typeof carregarRelatorioEscritorio>>;

export function secoesEscritorio(r: RelatorioEscritorio, aba: AbaEscritorio): Secao[] {
  const meses = r.meses.map((m) => formatarCompetencia(m));
  const empresa = (e: RelatorioEscritorio["empresas"][number]) => [e.nome, formatarDocumento(e.documento)];
  const cab = [
    { rotulo: "Empresa", tipo: "texto" as const },
    { rotulo: "CNPJ/CPF", tipo: "texto" as const },
  ];
  if (aba === "documentos") {
    const linhas = r.empresas.map((e) => {
      const v = r.docsMatriz.get(e.id) ?? r.meses.map(() => 0);
      return [...empresa(e), ...v, v.reduce((t, x) => t + x, 0)];
    });
    linhas.push(["Total", "", ...r.docsPorMes, r.totalDocs]);
    return [
      {
        titulo: "Documentos recebidos por competência",
        colunas: [...cab, ...meses.map((m) => ({ rotulo: m, tipo: "numero" as const })), { rotulo: "Total", tipo: "numero" }],
        linhas,
        destaques: [linhas.length - 1],
        observacao: "Documentos enviados pelos clientes (arquivos ZIP contam uma vez), pela competência informada.",
      },
    ];
  }
  if (aba === "checklist") {
    const linhas = r.empresas.map((e) => {
      const v = r.entrega.porEmpresa.get(e.id);
      return [...empresa(e), ...r.meses.map((_, i) => (v ? percentualInteiro(v[i].ok, v[i].total) : null))];
    });
    linhas.push(["Carteira", "", ...r.entrega.porMes.map((m) => percentualInteiro(m.ok, m.total))]);
    return [
      {
        titulo: "Entrega do checklist (itens obrigatórios concluídos ou dispensados)",
        colunas: [...cab, ...meses.map((m) => ({ rotulo: m, tipo: "percentual" as const }))],
        linhas,
        destaques: [linhas.length - 1],
        observacao: "Vazio: checklist não gerado para a competência.",
      },
    ];
  }
  if (aba === "fechamento") {
    return [
      {
        titulo: "Situação do fechamento por competência",
        colunas: [...cab, ...meses.map((m) => ({ rotulo: m, tipo: "texto" as const }))],
        linhas: r.empresas.map((e) => {
          const v = r.statusComp.get(e.id);
          return [...empresa(e), ...r.meses.map((m, i) => (m > r.mesAtual ? "" : STATUS_COMPETENCIA[v?.[i] ?? "aberta"]?.rotulo ?? v?.[i] ?? ""))];
        }),
      },
    ];
  }
  const nomes = new Map(r.empresas.map((e) => [e.id, e]));
  return [
    {
      titulo: "Pendências atuais por empresa",
      colunas: [
        ...cab,
        { rotulo: "Itens atrasados", tipo: "numero" },
        { rotulo: "Itens faltantes", tipo: "numero" },
        { rotulo: "Em correção", tipo: "numero" },
        { rotulo: "“Não se aplica” a revisar", tipo: "numero" },
        { rotulo: "Pendências de fechamento", tipo: "numero" },
        { rotulo: "Recebidos após fechamento", tipo: "numero" },
      ],
      linhas: r.pendencias.map((p) => [...empresa(nomes.get(p.empresaId)!), p.atrasados, p.faltantes, p.correcao, p.naoAplicaRevisar, p.fechamento, p.aposFechamento]),
    },
  ];
}
