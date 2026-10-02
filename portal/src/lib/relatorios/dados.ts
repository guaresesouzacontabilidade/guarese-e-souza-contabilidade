import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { somarDias, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { Decimal, dec, somar } from "@/lib/dinheiro";
import { composicaoDespesas, montarDre, type LinhaDreBruta, type ResultadoDre } from "./dre";
import { projetarSaldo, resumirFluxo, type LinhaFluxoBruta, type LinhaProjetadaBruta, type Projecao, type ResultadoFluxo } from "./fluxo";
import { calcularIndicadores, resumoExecutivo, type DadosSaude, type Indicador } from "./indicadores";
import type { Periodo } from "./periodo";

type Cliente = ContextoEmpresa["supabase"];

function listaMeses(inicio: string, fim: string) {
  const r: string[] = [];
  for (let m = inicio.slice(0, 8) + "01"; m <= fim; m = somarMeses(m, 1)) r.push(m);
  return r;
}

export async function carregarDre(supabase: Cliente, empresaId: string, inicio: string, fim: string, filtros: { centro?: string; projeto?: string } = {}): Promise<ResultadoDre> {
  const { data, error } = await supabase.rpc("relatorio_dre_linhas", {
    p_empresa_id: empresaId,
    p_inicio: inicio,
    p_fim: fim,
    p_centro_custo_id: filtros.centro || undefined,
    p_projeto_id: filtros.projeto || undefined,
  });
  if (error) throw new Error(`Não foi possível calcular o resultado: ${error.message}`);
  return montarDre((data ?? []) as LinhaDreBruta[], listaMeses(inicio, fim));
}

/** Saldo das contas que compõem o disponível ao final de uma data (contas sem saldo inicial ainda contam zero). */
export async function saldoDisponivelEm(supabase: Cliente, empresaId: string, data: string) {
  const { data: saldos, error } = await supabase.rpc("saldos_contas", { p_empresa_id: empresaId, p_data: data });
  if (error) throw new Error(error.message);
  const disponiveis = (saldos ?? []).filter((s) => s.compoe_saldo_disponivel);
  return { total: somar(disponiveis.map((s) => s.saldo_sistema ?? 0)), contas: saldos ?? [], semSaldoInicial: disponiveis.filter((s) => s.saldo_sistema === null).length };
}

export async function carregarFluxo(supabase: Cliente, empresaId: string, inicio: string, fim: string): Promise<ResultadoFluxo> {
  const [{ data, error }, inicial, { data: contas }] = await Promise.all([
    supabase.rpc("relatorio_fluxo_realizado", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }),
    saldoDisponivelEm(supabase, empresaId, somarDias(inicio, -1)),
    supabase.from("contas_financeiras").select("saldo_inicial, saldo_inicial_data, compoe_saldo_disponivel, ativa").eq("empresa_id", empresaId),
  ]);
  if (error) throw new Error(`Não foi possível calcular o fluxo de caixa: ${error.message}`);
  // Contas cujo saldo inicial é posterior ao início do período entram no mês do saldo inicial.
  const aberturas = (contas ?? [])
    .filter((c) => c.ativa && c.compoe_saldo_disponivel && c.saldo_inicial_data >= inicio && c.saldo_inicial_data <= fim)
    .map((c) => ({ data: c.saldo_inicial_data, valor: c.saldo_inicial }));
  return resumirFluxo((data ?? []) as LinhaFluxoBruta[], listaMeses(inicio, fim), inicial.total.toFixed(2), aberturas);
}

export async function carregarProjecao(supabase: Cliente, empresaId: string, hoje: string, dias = 90) {
  const ate = somarDias(hoje, dias);
  const [{ data, error }, atual] = await Promise.all([
    supabase.rpc("relatorio_fluxo_projetado", { p_empresa_id: empresaId, p_ate: ate }),
    saldoDisponivelEm(supabase, empresaId, hoje),
  ]);
  if (error) throw new Error(`Não foi possível calcular a previsão: ${error.message}`);
  const linhas = (data ?? []) as LinhaProjetadaBruta[];
  return { linhas, projecao: projetarSaldo(linhas, atual.total.toFixed(2), hoje, ate), saldoHoje: atual.total.toFixed(2), contas: atual.contas, semSaldoInicial: atual.semSaldoInicial };
}

export interface Painel {
  periodo: Periodo;
  dre: ResultadoDre;
  dreAnterior: ResultadoDre;
  evolucao: { mes: string; receita: number; gastos: number; resultado: number; saldoFinal: number }[];
  composicao: { nome: string; valor: number }[];
  clientes: { nome: string; valor: number; percentual: number }[];
  projecao: Projecao;
  saldoHoje: string;
  semSaldoInicial: number;
  contas: { conta_id: string; nome: string; tipo: string; compoe_saldo_disponivel: boolean; saldo_sistema: number | null; movimentos_pendentes: number; conciliado_ate: string | null }[];
  indicadores: Indicador[];
  resumo: string[];
  dadosSaude: DadosSaude;
  qualidade: Record<string, unknown>;
}

/** Tudo o que o painel de saúde financeira precisa, para o período escolhido. */
export async function carregarPainel(supabase: Cliente, empresaId: string, periodo: Periodo, hoje: string): Promise<Painel> {
  const fimEvolucao = periodo.fim < hoje ? periodo.fim : ultimoDiaDoMes(hoje);
  const inicioEvolucao = somarMeses(fimEvolucao.slice(0, 8) + "01", -11);
  const [dre, dreAnterior, dre12, fluxo12, prev, qualidadeR, receitasPorCliente] = await Promise.all([
    carregarDre(supabase, empresaId, periodo.inicio, periodo.fim),
    carregarDre(supabase, empresaId, periodo.anterior.inicio, periodo.anterior.fim),
    carregarDre(supabase, empresaId, inicioEvolucao, fimEvolucao),
    carregarFluxo(supabase, empresaId, inicioEvolucao, fimEvolucao),
    carregarProjecao(supabase, empresaId, hoje, 90),
    supabase.rpc("qualidade_dados", { p_empresa_id: empresaId, p_inicio: periodo.inicio, p_fim: periodo.fim }),
    supabase.rpc("relatorio_dre_composicao", { p_empresa_id: empresaId, p_inicio: periodo.inicio, p_fim: periodo.fim, p_tipos: ["receita_operacional"] }),
  ]);

  const evolucao = dre12.meses.map((m, i) => {
    const receita = dec(dre12.totais.receita_bruta.valores[m]);
    const resultado = dec(dre12.totais.resultado_liquido.valores[m]);
    return {
      mes: m,
      receita: receita.toNumber(),
      gastos: receita.minus(resultado).toNumber(),
      resultado: resultado.toNumber(),
      saldoFinal: dec(fluxo12.meses[i]?.saldoFinal ?? 0).toNumber(),
    };
  });

  // Média mensal de saídas de caixa nos últimos 3 meses com movimento
  const ultimos = fluxo12.meses.slice(-3).filter((m) => !dec(m.saidas).isZero());
  const mediaSaidas = ultimos.length ? somar(ultimos.map((m) => m.saidas)).dividedBy(ultimos.length) : null;
  const receita3 = somar(dre12.meses.slice(-3).map((m) => dre12.totais.receita_bruta.valores[m]));

  const proj = prev.projecao;
  const em30 = somarDias(hoje, 30);
  const soma = (campo: "entrada" | "saida", filtro: (l: LinhaProjetadaBruta) => boolean) => somar(prev.linhas.filter(filtro).map((l) => l[campo]));
  const receberVencido = soma("entrada", (l) => l.vencido);
  const pagarVencido = soma("saida", (l) => l.vencido);
  const aReceber30 = soma("entrada", (l) => l.data <= em30);
  const aPagar30 = soma("saida", (l) => l.data <= em30);

  const q = (qualidadeR.data ?? {}) as {
    checklist?: { percentual: number | null }[];
    movimentos?: { pendentes: number };
    contas_sem_extrato?: unknown[];
    lancamentos_sugeridos?: number;
    competencias?: { mes: string; status: string }[];
  };
  const percentuais = (q.checklist ?? []).map((c) => c.percentual).filter((p): p is number => p !== null);
  const composicao = composicaoDespesas(dre);

  // Principais clientes (receitas por contraparte)
  const porCliente = new Map<string, Decimal>();
  for (const r of (receitasPorCliente.data ?? []) as { contraparte: string | null; valor: number; origem: string }[]) {
    if (r.origem !== "lancamento") continue;
    const nome = r.contraparte ?? "Vendas sem cliente identificado";
    porCliente.set(nome, (porCliente.get(nome) ?? new Decimal(0)).plus(dec(r.valor)));
  }
  const receitaTotal = dec(dre.totais.receita_bruta.total);
  const clientes = [...porCliente.entries()]
    .sort((a, b) => b[1].comparedTo(a[1]))
    .slice(0, 5)
    .map(([nome, valor]) => ({ nome, valor: valor.toNumber(), percentual: receitaTotal.isZero() ? 0 : Number(valor.dividedBy(receitaTotal).times(100).toFixed(1)) }));

  const disponiveis = prev.contas.filter((c) => c.compoe_saldo_disponivel);
  const dadosSaude: DadosSaude = {
    periodoRotulo: periodo.rotulo,
    anteriorRotulo: periodo.anterior.rotulo,
    receitaBruta: dre.totais.receita_bruta.total,
    receitaBrutaAnterior: dreAnterior.totais.receita_bruta.total,
    resultado: dre.totais.resultado_liquido.total,
    resultadoAnterior: dreAnterior.totais.resultado_liquido.total,
    saldoDisponivel: disponiveis.length && disponiveis.some((c) => c.saldo_sistema !== null) ? prev.saldoHoje : null,
    mediaSaidasMensais: mediaSaidas ? mediaSaidas.toFixed(2) : null,
    aReceber30: aReceber30.toFixed(2),
    aPagar30: aPagar30.toFixed(2),
    receberVencido: receberVencido.toFixed(2),
    pagarVencido: pagarVencido.toFixed(2),
    receitaTresMeses: receita3.toFixed(2),
    maioresDespesas: composicao,
    menorSaldoProjetado: proj.menorSaldo,
    saldoProjetado30: proj.janelas[0]?.saldo ?? null,
    qualidade: {
      competenciasFechadas: Boolean(q.competencias?.length) && (q.competencias ?? []).every((c) => c.status === "fechada"),
      movimentosPendentes: q.movimentos?.pendentes ?? 0,
      contasSemExtrato: q.contas_sem_extrato?.length ?? 0,
      lancamentosSugeridos: q.lancamentos_sugeridos ?? 0,
      checklistPercentual: percentuais.length ? Math.min(...percentuais) : null,
    },
  };

  return {
    periodo,
    dre,
    dreAnterior,
    evolucao,
    composicao,
    clientes,
    projecao: proj,
    saldoHoje: prev.saldoHoje,
    semSaldoInicial: prev.semSaldoInicial,
    contas: prev.contas,
    indicadores: calcularIndicadores(dadosSaude),
    resumo: resumoExecutivo(dadosSaude),
    dadosSaude,
    qualidade: q as Record<string, unknown>,
  };
}
