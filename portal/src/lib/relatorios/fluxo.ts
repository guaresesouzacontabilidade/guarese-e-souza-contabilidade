import { Decimal, dec } from "@/lib/dinheiro";

/**
 * Fluxo de caixa consolidado das contas que compõem o saldo disponível.
 * Transferências entre essas contas são internas e não entram nos totais;
 * transferências para contas fora do disponível (ex.: aplicações) aparecem.
 */
export interface LinhaFluxoBruta {
  data: string;
  registro: string; // "baixa" | "transferencia"
  conta_disponivel: boolean | null;
  conta_contrapartida_disponivel: boolean | null;
  grupo: string; // operacional | investimento | financiamento | transferencia
  categoria_nome: string | null;
  tipo_categoria: string | null;
  entrada: number | string;
  saida: number | string;
}

export const GRUPOS_FLUXO: Record<string, string> = {
  operacional: "Atividades operacionais",
  investimento: "Investimentos",
  financiamento: "Financiamentos e sócios",
  transferencia: "Movimentação com contas fora do caixa",
};

export interface MesFluxo {
  mes: string;
  saldoInicial: string;
  entradas: string;
  saidas: string;
  /** Saldo inicial de contas cadastradas durante o período (não é entrada de caixa). */
  abertura: string;
  saldoFinal: string;
  porGrupo: Record<string, { entradas: string; saidas: string }>;
}

export interface ResultadoFluxo {
  meses: MesFluxo[];
  total: { entradas: string; saidas: string; geracao: string };
  porCategoria: { grupo: string; categoria: string; entradas: string; saidas: string }[];
}

export function linhaConta(l: LinhaFluxoBruta) {
  if (l.conta_disponivel === false) return false;
  if (l.registro === "transferencia" && l.conta_contrapartida_disponivel !== false) return false; // interna
  return true;
}

export function resumirFluxo(
  linhas: LinhaFluxoBruta[],
  meses: string[],
  saldoInicial: number | string,
  aberturas: { data: string; valor: number | string }[] = [],
): ResultadoFluxo {
  const validas = linhas.filter(linhaConta);
  const porMes = new Map(meses.map((m) => [m, { entradas: new Decimal(0), saidas: new Decimal(0), grupos: new Map<string, { e: Decimal; s: Decimal }>() }]));
  const cat = new Map<string, { grupo: string; categoria: string; e: Decimal; s: Decimal }>();
  for (const l of validas) {
    const mes = l.data.slice(0, 8) + "01";
    const alvo = porMes.get(mes);
    if (!alvo) continue;
    const e = dec(l.entrada);
    const s = dec(l.saida);
    alvo.entradas = alvo.entradas.plus(e);
    alvo.saidas = alvo.saidas.plus(s);
    const g = alvo.grupos.get(l.grupo) ?? { e: new Decimal(0), s: new Decimal(0) };
    g.e = g.e.plus(e);
    g.s = g.s.plus(s);
    alvo.grupos.set(l.grupo, g);
    const nome = l.categoria_nome ?? "Sem categoria";
    const k = `${l.grupo}|${nome}`;
    const c = cat.get(k) ?? { grupo: l.grupo, categoria: nome, e: new Decimal(0), s: new Decimal(0) };
    c.e = c.e.plus(e);
    c.s = c.s.plus(s);
    cat.set(k, c);
  }
  let saldo = dec(saldoInicial);
  let totE = new Decimal(0);
  let totS = new Decimal(0);
  const resultado: MesFluxo[] = meses.map((m) => {
    const x = porMes.get(m)!;
    const inicial = saldo;
    const abertura = aberturas.filter((a) => a.data.slice(0, 8) + "01" === m).reduce((t, a) => t.plus(dec(a.valor)), new Decimal(0));
    saldo = saldo.plus(x.entradas).minus(x.saidas).plus(abertura);
    totE = totE.plus(x.entradas);
    totS = totS.plus(x.saidas);
    return {
      mes: m,
      saldoInicial: inicial.toFixed(2),
      entradas: x.entradas.toFixed(2),
      saidas: x.saidas.toFixed(2),
      abertura: abertura.toFixed(2),
      saldoFinal: saldo.toFixed(2),
      porGrupo: Object.fromEntries([...x.grupos.entries()].map(([g, v]) => [g, { entradas: v.e.toFixed(2), saidas: v.s.toFixed(2) }])),
    };
  });
  return {
    meses: resultado,
    total: { entradas: totE.toFixed(2), saidas: totS.toFixed(2), geracao: totE.minus(totS).toFixed(2) },
    porCategoria: [...cat.values()]
      .sort((a, b) => a.grupo.localeCompare(b.grupo) || b.e.plus(b.s).comparedTo(a.e.plus(a.s)))
      .map((c) => ({ grupo: c.grupo, categoria: c.categoria, entradas: c.e.toFixed(2), saidas: c.s.toFixed(2) })),
  };
}

export interface LinhaProjetadaBruta {
  data: string;
  vencido: boolean;
  origem: string;
  lancamento_id?: string | null;
  descricao: string;
  contraparte: string | null;
  entrada: number | string;
  saida: number | string;
}

export interface Projecao {
  pontos: { data: string; entradas: number; saidas: number; saldo: number }[];
  /** Totais até 30, 60 e 90 dias (inclui vencidos, considerados para hoje). */
  janelas: { dias: number; entradas: string; saidas: string; saldo: string }[];
  menorSaldo: { data: string; valor: string } | null;
  vencidos: { entradas: string; saidas: string };
}

/** Projeção diária do saldo disponível a partir de hoje. */
export function projetarSaldo(linhas: LinhaProjetadaBruta[], saldoHoje: number | string, hoje: string, ate: string): Projecao {
  const porDia = new Map<string, { e: Decimal; s: Decimal }>();
  let vencE = new Decimal(0);
  let vencS = new Decimal(0);
  for (const l of linhas) {
    if (l.data > ate) continue;
    const d = l.data < hoje ? hoje : l.data;
    const x = porDia.get(d) ?? { e: new Decimal(0), s: new Decimal(0) };
    x.e = x.e.plus(dec(l.entrada));
    x.s = x.s.plus(dec(l.saida));
    porDia.set(d, x);
    if (l.vencido) {
      vencE = vencE.plus(dec(l.entrada));
      vencS = vencS.plus(dec(l.saida));
    }
  }
  const dias = [...porDia.keys()].sort();
  let saldo = dec(saldoHoje);
  const pontos: Projecao["pontos"] = [{ data: hoje, entradas: 0, saidas: 0, saldo: saldo.toNumber() }];
  let menor: { data: string; valor: Decimal } | null = { data: hoje, valor: saldo };
  for (const d of dias) {
    const x = porDia.get(d)!;
    saldo = saldo.plus(x.e).minus(x.s);
    if (d === hoje) pontos[0] = { data: d, entradas: x.e.toNumber(), saidas: x.s.toNumber(), saldo: saldo.toNumber() };
    else pontos.push({ data: d, entradas: x.e.toNumber(), saidas: x.s.toNumber(), saldo: saldo.toNumber() });
    if (!menor || saldo.lessThan(menor.valor)) menor = { data: d, valor: saldo };
  }
  const janela = (n: number) => {
    const limite = new Date(`${hoje}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() + n);
    const fim = limite.toISOString().slice(0, 10);
    let e = new Decimal(0);
    let s = new Decimal(0);
    for (const d of dias) {
      if (d > fim) continue;
      e = e.plus(porDia.get(d)!.e);
      s = s.plus(porDia.get(d)!.s);
    }
    return { dias: n, entradas: e.toFixed(2), saidas: s.toFixed(2), saldo: dec(saldoHoje).plus(e).minus(s).toFixed(2) };
  };
  return {
    pontos,
    janelas: [30, 60, 90].map(janela),
    menorSaldo: menor ? { data: menor.data, valor: menor.valor.toFixed(2) } : null,
    vencidos: { entradas: vencE.toFixed(2), saidas: vencS.toFixed(2) },
  };
}
