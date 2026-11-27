import { Decimal, dec } from "@/lib/dinheiro";
import { naturezaDoTipo, TIPOS_DRE } from "@/lib/financeiro/plano-contas";
import { ESTRUTURA_DRE, type LinhaDre, type LinhaDreBruta } from "./dre";

/**
 * DRE personalizado pela empresa (tabela dre_modelo_linhas).
 * - Linha de contas: soma as contas que caem nela (receitas somam, deduções,
 *   custos e despesas subtraem, pela natureza da conta).
 * - Subtotal: soma tudo o que está acima dele.
 * - Conta cai na linha escolhida para ela, senão na do grupo dela, senão na
 *   linha do padrão que recebe o tipo da conta.
 * - O resultado líquido fica sempre por último. Nenhum valor some.
 */
export interface LinhaModeloDre {
  id: string;
  ordem: number;
  tipo: "grupo" | "total";
  rotulo: string;
  chave_padrao: string | null;
  tipos: string[];
  mostrar_contas: boolean;
  oculta: boolean;
  destaque: boolean;
}

export interface CategoriaModeloDre {
  id: string;
  pai_id: string | null;
  tipo: string;
  dre_linha_id: string | null;
}

export interface ModeloDre {
  linhas: LinhaModeloDre[];
  categorias: CategoriaModeloDre[];
}

/** Estrutura padrão no formato do modelo (para mostrar antes de personalizar). */
export function modeloPadrao(): LinhaModeloDre[] {
  return ESTRUTURA_DRE.map((l, i) => ({
    id: l.chave,
    ordem: i + 1,
    tipo: l.tipo,
    rotulo: l.rotulo,
    chave_padrao: l.chave,
    tipos: l.tipo === "grupo" ? l.tipos : [],
    mostrar_contas: true,
    oculta: false,
    destaque: l.tipo === "total" && Boolean(l.destaque),
  }));
}

/** Linhas na ordem, com o resultado líquido sempre por último. */
export function ordenarLinhas(linhas: LinhaModeloDre[]): LinhaModeloDre[] {
  const ordenadas = [...linhas].sort((a, b) => a.ordem - b.ordem);
  const i = ordenadas.findIndex((l) => l.chave_padrao === "resultado_liquido");
  if (i >= 0 && i !== ordenadas.length - 1) ordenadas.push(...ordenadas.splice(i, 1));
  return ordenadas;
}

/** Linha do DRE em que a conta aparece (ou null se a conta fica fora do resultado). */
export function linhaDaConta(modelo: ModeloDre, categoriaId: string, tipo?: string): LinhaModeloDre | null {
  const porId = new Map(modelo.linhas.map((l) => [l.id, l]));
  const cat = modelo.categorias.find((c) => c.id === categoriaId);
  const tipoConta = cat?.tipo ?? tipo;
  if (!tipoConta || !(TIPOS_DRE as readonly string[]).includes(tipoConta)) return null;
  const explicita = cat?.dre_linha_id ?? (cat?.pai_id ? modelo.categorias.find((c) => c.id === cat.pai_id)?.dre_linha_id : null);
  const escolhida = explicita ? porId.get(explicita) : undefined;
  if (escolhida && escolhida.tipo === "grupo") return escolhida;
  return ordenarLinhas(modelo.linhas).find((l) => l.tipo === "grupo" && l.tipos.includes(tipoConta)) ?? null;
}

const SEMPRE_VISIVEIS = new Set(["receita_bruta", "custos", "despesas_operacionais"]);

/** Linhas do DRE no formato do modelo da empresa (mesma forma de LinhaDre do padrão). */
export function linhasDoModelo(brutas: LinhaDreBruta[], meses: string[], modelo: ModeloDre): LinhaDre[] {
  const zero = () => Object.fromEntries(meses.map((m) => [m, new Decimal(0)])) as Record<string, Decimal>;
  const ordenadas = ordenarLinhas(modelo.linhas);
  const sobra: LinhaModeloDre = {
    id: "sem-linha",
    ordem: Number.MAX_SAFE_INTEGER,
    tipo: "grupo",
    rotulo: "Outras contas",
    chave_padrao: null,
    tipos: [],
    mostrar_contas: true,
    oculta: false,
    destaque: false,
  };
  const somaLinha = new Map<string, Record<string, Decimal>>();
  const contas = new Map<string, { linha: string; id: string; codigo: string; nome: string; valores: Record<string, Decimal> }>();
  let receitaBruta = new Decimal(0);

  for (const b of brutas) {
    const mes = b.mes.slice(0, 8) + "01";
    if (!meses.includes(mes)) continue;
    const linha = linhaDaConta(modelo, b.categoria_id, b.tipo) ?? sobra;
    const valor = dec(b.valor).times(naturezaDoTipo(b.tipo) === "receita" ? 1 : -1);
    if (b.tipo === "receita_operacional") receitaBruta = receitaBruta.plus(b.valor);
    if (!somaLinha.has(linha.id)) somaLinha.set(linha.id, zero());
    const s = somaLinha.get(linha.id)!;
    s[mes] = s[mes].plus(valor);
    const chave = `${linha.id}:${b.categoria_id}`;
    if (!contas.has(chave)) contas.set(chave, { linha: linha.id, id: b.categoria_id, codigo: b.categoria_codigo, nome: b.categoria_nome, valores: zero() });
    const c = contas.get(chave)!;
    c.valores[mes] = c.valores[mes].plus(valor);
  }

  const somaMeses = (v: Record<string, Decimal>) => meses.reduce((a, m) => a.plus(v[m]), new Decimal(0));
  const percentual = (v: Decimal) => (receitaBruta.isZero() ? null : Number(v.dividedBy(receitaBruta).times(100).toFixed(1)));
  const texto = (v: Record<string, Decimal>) => Object.fromEntries(meses.map((m) => [m, v[m].toFixed(2)]));
  const acumulado = zero();
  const resultado: LinhaDre[] = [];
  const linhas = somaLinha.has(sobra.id) ? [...ordenadas.slice(0, -1), sobra, ...ordenadas.slice(-1)] : ordenadas;

  for (const l of linhas) {
    if (l.tipo === "grupo") {
      const v = somaLinha.get(l.id) ?? zero();
      for (const m of meses) acumulado[m] = acumulado[m].plus(v[m]);
      const cats = [...contas.values()].filter((c) => c.linha === l.id).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
      if (!cats.length && !(l.chave_padrao && SEMPRE_VISIVEIS.has(l.chave_padrao))) continue;
      const total = somaMeses(v);
      resultado.push({
        chave: `linha:${l.id}`,
        rotulo: l.rotulo,
        tipo: "grupo",
        nivel: 0,
        valores: texto(v),
        total: total.toFixed(2),
        percentual: percentual(total),
        tipos: [...TIPOS_DRE],
        categoria_ids: cats.map((c) => c.id),
      });
      if (!l.mostrar_contas) continue;
      for (const c of cats) {
        const tc = somaMeses(c.valores);
        resultado.push({
          chave: `linha:${l.id}:${c.id}`,
          rotulo: `${c.codigo} ${c.nome}`,
          tipo: "categoria",
          nivel: 1,
          valores: texto(c.valores),
          total: tc.toFixed(2),
          percentual: percentual(tc),
          categoria_id: c.id,
          tipos: [...TIPOS_DRE],
        });
      }
    } else {
      if (l.oculta && l.chave_padrao !== "resultado_liquido") continue;
      const total = somaMeses(acumulado);
      resultado.push({
        chave: `linha:${l.id}`,
        rotulo: l.rotulo,
        tipo: "total",
        nivel: 0,
        destaque: l.destaque || l.chave_padrao === "resultado_liquido",
        valores: texto(acumulado),
        total: total.toFixed(2),
        percentual: percentual(total),
      });
    }
  }
  return resultado;
}
