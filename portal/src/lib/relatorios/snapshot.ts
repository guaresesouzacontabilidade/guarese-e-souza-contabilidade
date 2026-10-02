import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { somarDias } from "@/lib/competencia";
import { carregarFluxo, carregarPainel, carregarProjecao } from "./dados";
import type { ResultadoDre } from "./dre";
import type { Projecao, ResultadoFluxo } from "./fluxo";
import type { Indicador } from "./indicadores";
import type { Periodo } from "./periodo";

/**
 * "Foto" dos números de um período, guardada no relatório publicado. Assim o
 * cliente vê exatamente o que foi revisado, mesmo que os lançamentos mudem depois.
 */
export interface SnapshotRelatorio {
  formato: 1;
  periodo: Pick<Periodo, "tipo" | "chave" | "inicio" | "fim" | "rotulo" | "anterior">;
  dataBase: string;
  dre: ResultadoDre;
  fluxo: ResultadoFluxo;
  projecao: Pick<Projecao, "janelas" | "menorSaldo" | "vencidos"> & {
    saldoHoje: string;
    proximas: { data: string; vencido: boolean; descricao: string; contraparte: string | null; entrada: number; saida: number }[];
  };
  indicadores: Indicador[];
  resumoAutomatico: string[];
  evolucao: { mes: string; receita: number; gastos: number; resultado: number; saldoFinal: number }[];
  composicao: { nome: string; valor: number }[];
  clientes: { nome: string; valor: number; percentual: number }[];
}

export const TIPOS_RELATORIO = {
  pacote_mensal: { rotulo: "Pacote completo", descricao: "Resumo, indicadores, resultado (DRE), fluxo de caixa e previsão." },
  resumo_executivo: { rotulo: "Resumo executivo", descricao: "Resumo em texto e indicadores de saúde financeira." },
  dre: { rotulo: "Resultado (DRE)", descricao: "Demonstração do resultado do período." },
  fluxo_caixa: { rotulo: "Fluxo de caixa", descricao: "Entradas e saídas realizadas e previsão dos próximos dias." },
} as const;
export type TipoRelatorio = keyof typeof TIPOS_RELATORIO;

export async function gerarSnapshot(supabase: ContextoEmpresa["supabase"], empresaId: string, periodo: Periodo, hoje: string) {
  const [painel, fluxo, prev] = await Promise.all([
    carregarPainel(supabase, empresaId, periodo, hoje),
    carregarFluxo(supabase, empresaId, periodo.inicio, periodo.fim),
    carregarProjecao(supabase, empresaId, hoje, 90),
  ]);
  const limite30 = somarDias(hoje, 30);
  const snapshot: SnapshotRelatorio = {
    formato: 1,
    periodo: { tipo: periodo.tipo, chave: periodo.chave, inicio: periodo.inicio, fim: periodo.fim, rotulo: periodo.rotulo, anterior: periodo.anterior },
    dataBase: hoje,
    dre: painel.dre,
    fluxo,
    projecao: {
      janelas: prev.projecao.janelas,
      menorSaldo: prev.projecao.menorSaldo,
      vencidos: prev.projecao.vencidos,
      saldoHoje: prev.saldoHoje,
      proximas: prev.linhas
        .filter((l) => l.data <= limite30)
        .slice(0, 60)
        .map((l) => ({ data: l.data, vencido: l.vencido, descricao: l.descricao, contraparte: l.contraparte, entrada: Number(l.entrada), saida: Number(l.saida) })),
    },
    indicadores: painel.indicadores,
    resumoAutomatico: painel.resumo,
    evolucao: painel.evolucao,
    composicao: painel.composicao,
    clientes: painel.clientes,
  };
  // Limitações conhecidas dos dados (aparecem no relatório para o cliente)
  const q = painel.dadosSaude.qualidade;
  const limitacoes: string[] = [];
  if (q.movimentosPendentes) limitacoes.push(`${q.movimentosPendentes} movimentação(ões) bancária(s) do período ainda não conciliada(s).`);
  if (q.contasSemExtrato) limitacoes.push(`${q.contasSemExtrato} conta(s) sem extrato importado no período.`);
  if (q.lancamentosSugeridos) limitacoes.push(`${q.lancamentosSugeridos} lançamento(s) sugerido(s) ainda não confirmado(s) — não entram nos números.`);
  if (q.checklistPercentual !== null && q.checklistPercentual < 100) limitacoes.push(`Documentos obrigatórios do mês ${q.checklistPercentual}% entregues.`);
  if (painel.semSaldoInicial) limitacoes.push(`${painel.semSaldoInicial} conta(s) sem saldo inicial definido para a data.`);
  return { snapshot, limitacoes };
}

export function lerSnapshot(dados: unknown): SnapshotRelatorio | null {
  const d = dados as Partial<SnapshotRelatorio> | null;
  return d && d.formato === 1 && d.dre && d.fluxo ? (d as SnapshotRelatorio) : null;
}
