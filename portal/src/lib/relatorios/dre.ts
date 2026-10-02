import { Decimal, dec } from "@/lib/dinheiro";

/**
 * DRE gerencial (Demonstração do Resultado) por competência, a partir das
 * linhas de `relatorio_dre_linhas`. Valores das linhas vêm positivos; o sinal
 * é dado pelo grupo (receitas somam, deduções/custos/despesas subtraem).
 */
export interface LinhaDreBruta {
  mes: string;
  origem: string;
  categoria_id: string;
  categoria_codigo: string;
  categoria_nome: string;
  tipo: string;
  valor: number | string;
  quantidade?: number;
}

type Grupo = { chave: string; rotulo: string; tipos: string[]; sinal: 1 | -1 };
type Total = { chave: string; rotulo: string; soma: string[]; destaque?: boolean };

export const ESTRUTURA_DRE: (({ tipo: "grupo" } & Grupo) | ({ tipo: "total" } & Total))[] = [
  { tipo: "grupo", chave: "receita_bruta", rotulo: "Receita bruta (vendas e serviços)", tipos: ["receita_operacional"], sinal: 1 },
  { tipo: "grupo", chave: "deducoes", rotulo: "(−) Impostos sobre vendas, devoluções e descontos", tipos: ["deducao_receita"], sinal: -1 },
  { tipo: "total", chave: "receita_liquida", rotulo: "Receita líquida", soma: ["receita_bruta", "deducoes"] },
  { tipo: "grupo", chave: "custos", rotulo: "(−) Custos das mercadorias e dos serviços", tipos: ["custo_mercadoria", "custo_servico"], sinal: -1 },
  { tipo: "total", chave: "lucro_bruto", rotulo: "Lucro bruto", soma: ["receita_liquida", "custos"] },
  { tipo: "grupo", chave: "despesas_operacionais", rotulo: "(−) Despesas operacionais", tipos: ["despesa_operacional"], sinal: -1 },
  { tipo: "total", chave: "resultado_operacional", rotulo: "Resultado operacional", soma: ["lucro_bruto", "despesas_operacionais"] },
  { tipo: "grupo", chave: "receitas_financeiras", rotulo: "(+) Receitas financeiras", tipos: ["receita_financeira"], sinal: 1 },
  { tipo: "grupo", chave: "despesas_financeiras", rotulo: "(−) Despesas financeiras (juros, tarifas, taxas)", tipos: ["despesa_financeira"], sinal: -1 },
  { tipo: "grupo", chave: "outras_receitas", rotulo: "(+) Outras receitas", tipos: ["outras_receitas"], sinal: 1 },
  { tipo: "grupo", chave: "outras_despesas", rotulo: "(−) Outras despesas", tipos: ["outras_despesas"], sinal: -1 },
  {
    tipo: "total",
    chave: "resultado_antes_impostos",
    rotulo: "Resultado antes do IRPJ/CSLL",
    soma: ["resultado_operacional", "receitas_financeiras", "despesas_financeiras", "outras_receitas", "outras_despesas"],
  },
  { tipo: "grupo", chave: "impostos_lucro", rotulo: "(−) IRPJ e CSLL", tipos: ["impostos_lucro"], sinal: -1 },
  { tipo: "total", chave: "resultado_liquido", rotulo: "Resultado líquido (lucro ou prejuízo)", soma: ["resultado_antes_impostos", "impostos_lucro"], destaque: true },
];

export interface LinhaDre {
  chave: string;
  rotulo: string;
  tipo: "grupo" | "categoria" | "total";
  nivel: 0 | 1;
  destaque?: boolean;
  /** Valores com sinal por mês ("AAAA-MM-01" → "1234.56"). */
  valores: Record<string, string>;
  total: string;
  /** Participação sobre a receita bruta do período (análise vertical), em %. */
  percentual: number | null;
  categoria_id?: string;
  tipos?: string[];
}

export interface ResultadoDre {
  meses: string[];
  linhas: LinhaDre[];
  totais: Record<string, { valores: Record<string, string>; total: string }>;
}

export function montarDre(linhas: LinhaDreBruta[], meses: string[]): ResultadoDre {
  const zero = () => Object.fromEntries(meses.map((m) => [m, new Decimal(0)])) as Record<string, Decimal>;
  const somaGrupo = new Map<string, Record<string, Decimal>>();
  const categorias = new Map<string, { grupo: string; id: string; codigo: string; nome: string; valores: Record<string, Decimal> }>();

  for (const g of ESTRUTURA_DRE) if (g.tipo === "grupo") somaGrupo.set(g.chave, zero());
  for (const l of linhas) {
    const g = ESTRUTURA_DRE.find((x) => x.tipo === "grupo" && x.tipos.includes(l.tipo)) as ({ tipo: "grupo" } & Grupo) | undefined;
    if (!g) continue;
    const mes = l.mes.slice(0, 8) + "01";
    if (!meses.includes(mes)) continue;
    const valor = dec(l.valor).times(g.sinal);
    const s = somaGrupo.get(g.chave)!;
    s[mes] = s[mes].plus(valor);
    const chaveCat = `${g.chave}:${l.categoria_id}`;
    if (!categorias.has(chaveCat)) {
      categorias.set(chaveCat, { grupo: g.chave, id: l.categoria_id, codigo: l.categoria_codigo, nome: l.categoria_nome, valores: zero() });
    }
    const c = categorias.get(chaveCat)!;
    c.valores[mes] = c.valores[mes].plus(valor);
  }

  const totais = new Map<string, Record<string, Decimal>>(somaGrupo);
  for (const t of ESTRUTURA_DRE) {
    if (t.tipo !== "total") continue;
    const v = zero();
    for (const parte of t.soma) {
      const p = totais.get(parte);
      if (!p) continue;
      for (const m of meses) v[m] = v[m].plus(p[m]);
    }
    totais.set(t.chave, v);
  }

  const somaMeses = (v: Record<string, Decimal>) => meses.reduce((a, m) => a.plus(v[m]), new Decimal(0));
  const receitaBruta = somaMeses(totais.get("receita_bruta")!);
  const percentual = (v: Decimal) => (receitaBruta.isZero() ? null : Number(v.dividedBy(receitaBruta).times(100).toFixed(1)));
  const texto = (v: Record<string, Decimal>) => Object.fromEntries(meses.map((m) => [m, v[m].toFixed(2)]));

  const resultado: LinhaDre[] = [];
  for (const item of ESTRUTURA_DRE) {
    const v = totais.get(item.chave)!;
    const total = somaMeses(v);
    if (item.tipo === "grupo") {
      const cats = [...categorias.values()].filter((c) => c.grupo === item.chave).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
      // Grupos sem movimento ficam ocultos, exceto os principais
      if (!cats.length && !["receita_bruta", "custos", "despesas_operacionais"].includes(item.chave)) continue;
      resultado.push({ chave: item.chave, rotulo: item.rotulo, tipo: "grupo", nivel: 0, valores: texto(v), total: total.toFixed(2), percentual: percentual(total), tipos: item.tipos });
      for (const c of cats) {
        const tc = somaMeses(c.valores);
        resultado.push({
          chave: `${item.chave}:${c.id}`,
          rotulo: `${c.codigo} ${c.nome}`,
          tipo: "categoria",
          nivel: 1,
          valores: texto(c.valores),
          total: tc.toFixed(2),
          percentual: percentual(tc),
          categoria_id: c.id,
          tipos: item.tipos,
        });
      }
    } else {
      resultado.push({ chave: item.chave, rotulo: item.rotulo, tipo: "total", nivel: 0, destaque: item.destaque, valores: texto(v), total: total.toFixed(2), percentual: percentual(total) });
    }
  }

  return {
    meses,
    linhas: resultado,
    totais: Object.fromEntries([...totais.entries()].map(([k, v]) => [k, { valores: texto(v), total: somaMeses(v).toFixed(2) }])),
  };
}

/** Despesas e custos por categoria (positivos), do maior para o menor. */
export function composicaoDespesas(dre: ResultadoDre, limite = 6) {
  const grupos = new Set(["deducoes", "custos", "despesas_operacionais", "despesas_financeiras", "outras_despesas", "impostos_lucro"]);
  const itens = dre.linhas
    .filter((l) => l.tipo === "categoria" && grupos.has(l.chave.split(":")[0]))
    .map((l) => ({ nome: l.rotulo.replace(/^[\d.]+\s/, ""), valor: dec(l.total).negated() }))
    .filter((i) => i.valor.greaterThan(0))
    .sort((a, b) => b.valor.comparedTo(a.valor));
  const principais = itens.slice(0, limite);
  const resto = itens.slice(limite).reduce((s, i) => s.plus(i.valor), new Decimal(0));
  if (resto.greaterThan(0)) principais.push({ nome: "Outras", valor: resto });
  return principais.map((i) => ({ nome: i.nome, valor: Number(i.valor.toFixed(2)) }));
}
