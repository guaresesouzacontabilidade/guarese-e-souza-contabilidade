/**
 * Cálculos do hotel que rodam fora do banco (prévia da reserva na tela e
 * indicadores dos relatórios). As mesmas regras do banco: a diária de cada
 * noite é a tarifa do período mais curto que cobre a data ou a da categoria,
 * mais o adicional por pessoa acima das incluídas; a tarifa acordada vale para
 * todas as noites.
 */
import { Decimal } from "@/lib/dinheiro";
import { noites as contarNoites, somarDias } from "./rotulos";

export interface CategoriaPreco {
  id: string;
  diaria: number;
  pessoas_incluidas: number;
  adicional_pessoa: number;
}

export interface TarifaPeriodo {
  categoria_id: string;
  inicio: string;
  fim: string;
  diaria: number;
  created_at?: string;
}

/** Diária de tabela de uma noite. */
export function diariaDaNoite(categoria: CategoriaPreco, tarifas: TarifaPeriodo[], data: string): number {
  const aplicaveis = tarifas
    .filter((t) => t.categoria_id === categoria.id && t.inicio <= data && data <= t.fim)
    .sort((a, b) => contarNoites(a.inicio, a.fim) - contarNoites(b.inicio, b.fim) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return aplicaveis[0]?.diaria ?? categoria.diaria;
}

/** Noites da estadia e o valor de cada uma. */
export function diariasDaEstadia(
  categoria: CategoriaPreco,
  tarifas: TarifaPeriodo[],
  estadia: { entrada: string; saida: string; adultos: number; diariaAcordada?: number | null },
): { data: string; valor: number }[] {
  const n = contarNoites(estadia.entrada, estadia.saida);
  if (!(n > 0) || n > 365) return [];
  const extra = new Decimal(Math.max(estadia.adultos - categoria.pessoas_incluidas, 0)).times(categoria.adicional_pessoa);
  return Array.from({ length: n }, (_, i) => {
    const data = somarDias(estadia.entrada, i);
    const valor = estadia.diariaAcordada ? new Decimal(estadia.diariaAcordada) : new Decimal(diariaDaNoite(categoria, tarifas, data)).plus(extra);
    return { data, valor: valor.toDecimalPlaces(2).toNumber() };
  });
}

export interface ReservaIndicador {
  status: string;
  entrada: string;
  saida: string;
  origem: string;
  categoria: string;
}

/** Quantas noites da reserva caem no período [de, ate). */
export function noitesNoPeriodo(r: { entrada: string; saida: string }, de: string, ate: string) {
  const ini = r.entrada > de ? r.entrada : de;
  const fim = r.saida < ate ? r.saida : ate;
  return Math.max(0, contarNoites(ini, fim));
}

export interface IndicadoresHotel {
  dias: number;
  quartos: number;
  quartosNoite: number;
  noitesVendidas: number;
  /** Noites já cobradas (diárias lançadas no check-out): base da diária média. */
  noitesFaturadas: number;
  ocupacao: number;
  receitaDiarias: number;
  diariaMedia: number;
  revpar: number;
  receitaConsumo: number;
  receitaServicos: number;
  hospedagens: number;
  canceladas: number;
  noShow: number;
  porOrigem: { origem: string; noites: number; reservas: number }[];
  porCategoria: { categoria: string; noites: number; receita: number }[];
  porDia: { data: string; ocupados: number; ocupacao: number }[];
}

/**
 * Indicadores do período [de, ate): ocupação (noites ocupadas ÷ quartos-noite
 * disponíveis), diária média (receita de diárias ÷ noites cobradas) e RevPAR
 * (receita de diárias ÷ quartos-noite disponíveis). As diárias entram na
 * receita no check-out, com a data de cada noite.
 */
export function calcularIndicadores(entrada: {
  de: string;
  ate: string;
  quartos: number;
  reservas: ReservaIndicador[];
  /** Diárias e demais lançamentos da conta no período (data do lançamento). */
  itens: { tipo: string; total: number; categoria?: string }[];
  canceladas: number;
  noShow: number;
}): IndicadoresHotel {
  const dias = Math.max(0, contarNoites(entrada.de, entrada.ate));
  const quartosNoite = dias * entrada.quartos;
  const ocupando = entrada.reservas.filter((r) => r.status === "hospedado" || r.status === "encerrada");
  let noitesVendidas = 0;
  const origem = new Map<string, { noites: number; reservas: number }>();
  const categoria = new Map<string, { noites: number; receita: number }>();
  for (const r of ocupando) {
    const n = noitesNoPeriodo(r, entrada.de, entrada.ate);
    if (!n) continue;
    noitesVendidas += n;
    const o = origem.get(r.origem) ?? { noites: 0, reservas: 0 };
    o.noites += n;
    o.reservas += 1;
    origem.set(r.origem, o);
    const c = categoria.get(r.categoria) ?? { noites: 0, receita: 0 };
    c.noites += n;
    categoria.set(r.categoria, c);
  }
  let receitaDiarias = new Decimal(0);
  let receitaConsumo = new Decimal(0);
  let receitaServicos = new Decimal(0);
  let noitesFaturadas = 0;
  for (const i of entrada.itens) {
    if (i.tipo === "diaria") {
      receitaDiarias = receitaDiarias.plus(i.total);
      noitesFaturadas += 1;
      if (i.categoria) {
        const c = categoria.get(i.categoria) ?? { noites: 0, receita: 0 };
        c.receita = new Decimal(c.receita).plus(i.total).toNumber();
        categoria.set(i.categoria, c);
      }
    } else if (i.tipo === "consumo" || i.tipo === "taxa_servico") receitaConsumo = receitaConsumo.plus(i.total);
    else receitaServicos = receitaServicos.plus(i.total);
  }
  const porDia = Array.from({ length: dias }, (_, k) => {
    const data = somarDias(entrada.de, k);
    const ocupados = ocupando.filter((r) => r.entrada <= data && data < r.saida).length;
    return { data, ocupados, ocupacao: entrada.quartos ? ocupados / entrada.quartos : 0 };
  });
  return {
    dias,
    quartos: entrada.quartos,
    quartosNoite,
    noitesVendidas,
    noitesFaturadas,
    ocupacao: quartosNoite ? noitesVendidas / quartosNoite : 0,
    receitaDiarias: receitaDiarias.toNumber(),
    diariaMedia: noitesFaturadas ? receitaDiarias.div(noitesFaturadas).toDecimalPlaces(2).toNumber() : 0,
    revpar: quartosNoite ? receitaDiarias.div(quartosNoite).toDecimalPlaces(2).toNumber() : 0,
    receitaConsumo: receitaConsumo.toNumber(),
    receitaServicos: receitaServicos.toNumber(),
    hospedagens: ocupando.filter((r) => noitesNoPeriodo(r, entrada.de, entrada.ate) > 0).length,
    canceladas: entrada.canceladas,
    noShow: entrada.noShow,
    porOrigem: [...origem].map(([o, v]) => ({ origem: o, ...v })).sort((a, b) => b.noites - a.noites),
    porCategoria: [...categoria].map(([c, v]) => ({ categoria: c, ...v })).sort((a, b) => b.receita - a.receita || b.noites - a.noites),
    porDia,
  };
}
