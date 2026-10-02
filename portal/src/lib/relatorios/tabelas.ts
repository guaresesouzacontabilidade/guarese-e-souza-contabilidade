/**
 * Converte os relatórios calculados em tabelas genéricas para exportação
 * (Excel e PDF). Funções puras; valores monetários seguem como texto com 2
 * casas ("1234.50"), convertidos só na hora de gravar a planilha.
 */
import type { Decimal } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { TIPOS_CONTA } from "@/lib/rotulos";
import { FAIXAS_AGING, percentual, type Aging, type Dre, type FluxoMensal } from "./calculos";

export type TipoColuna = "texto" | "moeda" | "numero" | "percentual";

export interface Secao {
  titulo: string;
  colunas: { rotulo: string; tipo: TipoColuna }[];
  linhas: (string | number | null)[][];
  /** Linhas em destaque (subtotais e totais). */
  destaques?: number[];
  observacao?: string;
}

const m = (v: Decimal | null | undefined) => (v == null ? null : v.toFixed(2));

export function secoesFluxo(f: FluxoMensal): Secao[] {
  const linhas = f.meses.map((x) => [
    formatarCompetencia(x.mes),
    m(x.entradasPrevistas),
    m(x.entradasRealizadas),
    m(x.saidasPrevistas),
    m(x.saidasRealizadas),
    m(x.entradasPrevistas.minus(x.saidasPrevistas)),
    m(x.entradasRealizadas.minus(x.saidasRealizadas)),
  ]);
  const t = f.totais;
  linhas.push([
    "Total",
    m(t.entradasPrevistas),
    m(t.entradasRealizadas),
    m(t.saidasPrevistas),
    m(t.saidasRealizadas),
    m(t.entradasPrevistas.minus(t.saidasPrevistas)),
    m(t.entradasRealizadas.minus(t.saidasRealizadas)),
  ]);
  const secoes: Secao[] = [
    {
      titulo: "Fluxo de caixa mensal",
      colunas: [
        { rotulo: "Mês", tipo: "texto" },
        { rotulo: "Entradas previstas", tipo: "moeda" },
        { rotulo: "Entradas realizadas", tipo: "moeda" },
        { rotulo: "Saídas previstas", tipo: "moeda" },
        { rotulo: "Saídas realizadas", tipo: "moeda" },
        { rotulo: "Saldo previsto", tipo: "moeda" },
        { rotulo: "Saldo realizado", tipo: "moeda" },
      ],
      linhas,
      destaques: [linhas.length - 1],
      observacao:
        "Previsto: lançamentos confirmados pelo vencimento. Realizado: pagamentos, recebimentos e transferências nas contas que compõem o saldo disponível.",
    },
  ];
  if (f.grupos.length) {
    secoes.push({
      titulo: "Realizado por natureza",
      colunas: [
        { rotulo: "Natureza", tipo: "texto" },
        { rotulo: "Entradas", tipo: "moeda" },
        { rotulo: "Saídas", tipo: "moeda" },
        { rotulo: "Líquido", tipo: "moeda" },
      ],
      linhas: f.grupos.map((g) => [g.rotulo, m(g.entradas), m(g.saidas), m(g.entradas.minus(g.saidas))]),
    });
  }
  return secoes;
}

export function secoesDre(d: Dre & { meses: string[] }): Secao[] {
  const destaques: number[] = [];
  const linhas = d.linhas.map((l, i) => {
    if (l.nivel !== "categoria") destaques.push(i);
    return [
      l.nivel === "categoria" ? `    ${l.rotulo}` : l.rotulo,
      ...l.valores.map(m),
      m(l.total),
      percentual(l.total, d.receitaBruta.total),
    ];
  });
  return [
    {
      titulo: "Demonstração do resultado (gerencial, por competência)",
      colunas: [
        { rotulo: "Linha", tipo: "texto" },
        ...d.meses.map((mes) => ({ rotulo: formatarCompetencia(mes), tipo: "moeda" as const })),
        { rotulo: "Total", tipo: "moeda" },
        { rotulo: "% receita bruta", tipo: "percentual" },
      ],
      linhas,
      destaques,
      observacao:
        "Lançamentos confirmados pela data de competência; juros, multas, descontos e taxas na data do pagamento. Lançamentos sugeridos e movimentações de sócios, empréstimos e investimentos não entram.",
    },
  ];
}

export function secoesAging(a: Aging, hoje: string): Secao[] {
  const linhas = FAIXAS_AGING.map((f) => [
    f.rotulo,
    a.receber.faixas[f.chave].quantidade,
    m(a.receber.faixas[f.chave].valor),
    a.pagar.faixas[f.chave].quantidade,
    m(a.pagar.faixas[f.chave].valor),
  ]);
  linhas.push([
    "Total em aberto",
    FAIXAS_AGING.reduce((s, f) => s + a.receber.faixas[f.chave].quantidade, 0),
    m(a.receber.total),
    FAIXAS_AGING.reduce((s, f) => s + a.pagar.faixas[f.chave].quantidade, 0),
    m(a.pagar.total),
  ]);
  const maiores = (lado: Aging["receber"], titulo: string, rotulo: string): Secao => ({
    titulo,
    colunas: [
      { rotulo, tipo: "texto" },
      { rotulo: "Títulos", tipo: "numero" },
      { rotulo: "Em aberto", tipo: "moeda" },
      { rotulo: "Vencido", tipo: "moeda" },
    ],
    linhas: lado.maiores.map((c) => [c.nome, c.quantidade, m(c.valor), m(c.vencido)]),
  });
  return [
    {
      titulo: `Contas em aberto por vencimento — posição em ${formatarData(hoje)}`,
      colunas: [
        { rotulo: "Faixa", tipo: "texto" },
        { rotulo: "Títulos a receber", tipo: "numero" },
        { rotulo: "A receber", tipo: "moeda" },
        { rotulo: "Títulos a pagar", tipo: "numero" },
        { rotulo: "A pagar", tipo: "moeda" },
      ],
      linhas,
      destaques: [linhas.length - 1],
      observacao: "Lançamentos confirmados em aberto ou parciais (valor ainda não pago). Compras no cartão de crédito entram pela fatura.",
    },
    maiores(a.receber, "Maiores valores a receber", "Cliente"),
    maiores(a.pagar, "Maiores valores a pagar", "Fornecedor"),
  ];
}

export interface ContaSaldoExport {
  nome: string;
  tipo: string;
  compoe_saldo_disponivel: boolean;
  saldo_inicial_periodo: Decimal | null;
  saldo_sistema: Decimal | null;
  saldo_extrato: Decimal | null;
  saldo_extrato_data: string | null;
  conciliado_ate: string | null;
}

export function secoesSaldos(
  contas: ContaSaldoExport[],
  dataInicial: string,
  dataFinal: string,
  evolucao: { mes: string; data: string; valor: Decimal | null; incompleto: boolean }[],
): Secao[] {
  return [
    {
      titulo: `Saldos por conta — ${formatarData(dataInicial)} a ${formatarData(dataFinal)}`,
      colunas: [
        { rotulo: "Conta", tipo: "texto" },
        { rotulo: "Tipo", tipo: "texto" },
        { rotulo: "Compõe disponível", tipo: "texto" },
        { rotulo: `Saldo em ${formatarData(dataInicial)}`, tipo: "moeda" },
        { rotulo: `Saldo em ${formatarData(dataFinal)}`, tipo: "moeda" },
        { rotulo: "Variação", tipo: "moeda" },
        { rotulo: "Último extrato", tipo: "moeda" },
        { rotulo: "Data do extrato", tipo: "texto" },
        { rotulo: "Conciliado até", tipo: "texto" },
      ],
      linhas: contas.map((c) => [
        c.nome,
        TIPOS_CONTA[c.tipo] ?? c.tipo,
        c.compoe_saldo_disponivel ? "Sim" : "Não",
        m(c.saldo_inicial_periodo),
        m(c.saldo_sistema),
        c.saldo_sistema && c.saldo_inicial_periodo ? m(c.saldo_sistema.minus(c.saldo_inicial_periodo)) : null,
        m(c.saldo_extrato),
        c.saldo_extrato_data ? formatarData(c.saldo_extrato_data) : "",
        c.conciliado_ate ? formatarData(c.conciliado_ate) : "",
      ]),
    },
    {
      titulo: "Saldo disponível ao fim de cada mês",
      colunas: [
        { rotulo: "Mês", tipo: "texto" },
        { rotulo: "Data", tipo: "texto" },
        { rotulo: "Saldo disponível", tipo: "moeda" },
        { rotulo: "Observação", tipo: "texto" },
      ],
      linhas: evolucao.map((e) => [formatarCompetencia(e.mes), formatarData(e.data), m(e.valor), e.incompleto ? "Há contas sem saldo inicial nesta data" : ""]),
    },
  ];
}
