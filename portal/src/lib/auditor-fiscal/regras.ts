import Decimal from "decimal.js";
import { ANEXOS_SIMPLES, type Fonte } from "@/lib/calculos/tabelas";
import { centavos, dec, formatarMoeda } from "@/lib/dinheiro";
import { somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { classificarNcm, ROTULO_GRUPO, type GrupoMonofasico, type LinhaCatalogo } from "./catalogo";
import { cfopCompraNaEntrada, cfopDevolucaoNaEntrada, cfopRevenda, cfopVenda, cfopVendaProducaoInterna, cfopVendaSt } from "./cfop";
import { exclusaoSt, ROTULO_SEGMENTO_ST, somenteDigitos, type ExclusaoSt } from "./st-estadual";
import { FONTES, OBRIGACAO_IBS_CBS, PIS_COFINS_ESTIMADO, REPARTICAO_SIMPLES, TESTE_2026 } from "./tabelas";

/**
 * Regras do auditor fiscal. Tudo aqui é cálculo fixo, com a base legal de
 * cada achado e a memória de cálculo: nenhum valor vem de inteligência
 * artificial. Os achados são indícios para o contador conferir (por exemplo,
 * o auditor não vê o PGDAS-D: ele mostra quanto o DAS cobrou A MAIS caso a
 * receita não tenha sido separada).
 */

type Num = number | string | null | undefined;

export interface ExemploItem {
  nota_id: string;
  documento_id?: string | null;
  numero: string | null;
  modelo: string;
  data: string | null;
  item: number;
  descricao: string | null;
  valor: Num;
}

/** Itens das notas agrupados por mês e códigos fiscais (public.auditor_itens_agrupados). */
export interface GrupoItens {
  competencia: string;
  operacao: "entrada" | "saida";
  modelo: string;
  consumidor_final: boolean;
  crt: string | null;
  cfop: string | null;
  ncm: string | null;
  gtin: string | null;
  cest: string | null;
  ex: string | null;
  csosn: string | null;
  cst_icms: string | null;
  cst_pis: string | null;
  cst_cofins: string | null;
  cst_ibscbs: string | null;
  cclasstrib: string | null;
  p_cbs: string | null;
  p_ibs_uf: string | null;
  p_ibs_mun: string | null;
  reducao: boolean;
  apos_ibscbs_normal: boolean;
  itens: number;
  notas: number;
  valor: Num;
  icms: Num;
  icms_st: Num;
  icms_st_retido: Num;
  pis: Num;
  cofins: Num;
  cbs: Num;
  ibs: Num;
  exemplos: ExemploItem[] | null;
}

export interface MesSimples {
  rbt12: Decimal;
  anexo: "I" | "II";
  /** Anexo definido nos Cálculos da empresa (sem isso, presume-se o Anexo I, comércio). */
  anexoInformado: boolean;
  mesesSemDados: string[];
  observacao: string | null;
}

export interface EntradaAuditoria {
  /** Hoje (AAAA-MM-DD). */
  hoje: string;
  /** Primeira e última competência analisadas (AAAA-MM-01). */
  inicio: string;
  fim: string;
  regimeDoMes: (competencia: string) => string | null;
  simples: (competencia: string) => MesSimples | null;
  grupos: GrupoItens[];
  catalogo: LinhaCatalogo[];
  /** Notas de venda sem o grupo IBS/CBS no mês (contagem exata, do banco); sem ela, conta pelos grupos de itens. */
  semIbsCbs?: (competencia: string) => { total: number; apos_normal: number } | null;
  /** Estado da empresa e produtos que saíram da ST por regra desse Estado (tabela auditor_st_exclusoes). */
  uf?: string | null;
  exclusoesSt?: ExclusaoSt[];
}

export type TipoAchado = "oportunidade" | "risco" | "informativo";
export type Confianca = "alta" | "media" | "conferir";

export interface Referencia extends ExemploItem {
  motivo: string;
}

export interface AchadoCalculado {
  regra: string;
  chave: string;
  competencia: string;
  tipo: TipoAchado;
  confianca: Confianca;
  titulo: string;
  resumo: string;
  valor_base: string | null;
  valor_estimado: string | null;
  memoria: { rotulo: string; valor: string }[];
  referencias: Referencia[];
  fontes: Fonte[];
}

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------
const num = (v: Num) => dec(v ?? 0);
const moeda = (v: Decimal) => formatarMoeda(v);
const pct = (fracao: Decimal, casas = 2) => `${fracao.times(100).toFixed(casas).replace(".", ",")}%`;
const pctTexto = (p: string) => `${p.replace(".", ",")}%`;
const mes = (c: string) => formatarCompetencia(c);
const mesLongo = (c: string) => formatarCompetencia(c, true);
const fmtNcm = (n: string | null) => (n && /^\d{8}$/.test(n) ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : (n ?? "sem NCM"));
const ORDEM_CONFIANCA: Confianca[] = ["alta", "media", "conferir"];
const pior = (a: Confianca, b: Confianca): Confianca => (ORDEM_CONFIANCA.indexOf(a) >= ORDEM_CONFIANCA.indexOf(b) ? a : b);
const REGIME_NORMAL = new Set(["lucro_presumido", "lucro_real", "lucro_arbitrado"]);

/** Último dia para pedir a restituição de um tributo pago no dia 20 do mês seguinte à competência (5 anos). */
export function prazoRestituicao(competencia: string): string {
  const pagamento = somarMeses(competencia, 1);
  return `${Number(pagamento.slice(0, 4)) + 5}${pagamento.slice(4, 8)}20`;
}

/** Primeira competência ainda dentro do prazo de 5 anos na data informada. */
export function inicioPrazo(hoje: string): string {
  const atual = `${hoje.slice(0, 7)}-01`;
  let c = somarMeses(atual, -62);
  while (prazoRestituicao(c) < hoje) c = somarMeses(c, 1);
  return c;
}

function referencias(grupos: { g: GrupoItens; motivo: string }[], limite = 15): Referencia[] {
  return grupos
    .flatMap(({ g, motivo }) => (g.exemplos ?? []).map((e) => ({ ...e, motivo })))
    .sort((a, b) => num(b.valor).comparedTo(num(a.valor)))
    .slice(0, limite);
}

function fontesUnicas(lista: (Fonte | null | undefined)[]): Fonte[] {
  const vistas = new Set<string>();
  const r: Fonte[] = [];
  for (const f of lista) {
    if (!f || vistas.has(f.titulo)) continue;
    vistas.add(f.titulo);
    r.push(f);
  }
  return r;
}

// -----------------------------------------------------------------------------
// Evidências nas compras
// -----------------------------------------------------------------------------
const CST_ICMS_COM_ST = ["10", "30", "60", "70"];
const CSOSN_COM_ST = ["201", "202", "203", "500"];

function compraComSt(g: GrupoItens) {
  return CST_ICMS_COM_ST.includes(g.cst_icms ?? "") || CSOSN_COM_ST.includes(g.csosn ?? "") || num(g.icms_st).gt(0) || num(g.icms_st_retido).gt(0);
}
function compraSemSt(g: GrupoItens) {
  const tributada = ["00", "20", "40", "41", "51"].includes(g.cst_icms ?? "") || ["101", "102", "103", "300", "400"].includes(g.csosn ?? "");
  return tributada && num(g.icms_st).isZero() && num(g.icms_st_retido).isZero();
}
/** A própria venda foi emitida como mercadoria com ICMS já retido por ST. */
function vendaComoSt(g: GrupoItens) {
  return cfopVendaSt(g.cfop) || CSOSN_COM_ST.includes(g.csosn ?? "") || CST_ICMS_COM_ST.includes(g.cst_icms ?? "");
}

interface Evidencias {
  monoGtin: Set<string>;
  monoNcm: Set<string>;
  stGtin: Set<string>;
  stNcmCest: Set<string>;
  stNcm: Set<string>;
  semStNcm: Set<string>;
  /** Comprado sem ST da indústria do próprio Estado, já fora da ST pela regra estadual (GTIN e NCM:CEST). */
  exclGtin: Set<string>;
  exclNcmCest: Set<string>;
}

const competenciaDe = (g: GrupoItens) => `${String(g.competencia).slice(0, 7)}-01`;
const chaveNcmCest = (g: GrupoItens) => `${g.ncm}:${somenteDigitos(g.cest)}`;

/**
 * Compra interna da indústria do próprio Estado de produto que, na data,
 * estava fora da ST pela regra estadual (na nota do fornecedor: CFOP 5.101,
 * 5.401...). Sem a exigência da indústria, basta a compra ser interna.
 */
function exclusaoNaCompra(g: GrupoItens, e: EntradaAuditoria, data: string): ExclusaoSt | null {
  if (g.operacao !== "entrada" || !/^5\d{3}$/.test((g.cfop ?? "").trim())) return null;
  const exc = exclusaoSt(g.cest, g.ncm, data, e.uf ?? null, e.exclusoesSt ?? []);
  return exc && (!exc.somente_fabricante_uf || cfopVendaProducaoInterna(g.cfop)) ? exc : null;
}

function evidencias(e: EntradaAuditoria): Evidencias {
  const ev: Evidencias = {
    monoGtin: new Set(), monoNcm: new Set(), stGtin: new Set(), stNcmCest: new Set(), stNcm: new Set(), semStNcm: new Set(),
    exclGtin: new Set(), exclNcmCest: new Set(),
  };
  for (const g of e.grupos) {
    if (g.operacao !== "entrada" || !cfopCompraNaEntrada(g.cfop)) continue;
    if (g.cst_pis === "04" || g.cst_cofins === "04") {
      if (g.gtin) ev.monoGtin.add(g.gtin);
      if (g.ncm) ev.monoNcm.add(g.ncm);
    }
    if (compraComSt(g)) {
      if (g.gtin) ev.stGtin.add(g.gtin);
      if (g.ncm) {
        ev.stNcm.add(g.ncm);
        if (g.cest) ev.stNcmCest.add(`${g.ncm}:${g.cest}`);
      }
    } else if (g.ncm && compraSemSt(g)) {
      ev.semStNcm.add(g.ncm);
      if (exclusaoNaCompra(g, e, ultimoDiaDoMes(competenciaDe(g)))) {
        if (g.gtin) ev.exclGtin.add(g.gtin);
        if (g.cest) ev.exclNcmCest.add(chaveNcmCest(g));
      }
    }
  }
  return ev;
}

/** O produto (ou o NCM e CEST) foi comprado sem ST da indústria do Estado depois da exclusão estadual. */
function compradoForaDaSt(g: GrupoItens, ev: Evidencias) {
  return Boolean((g.gtin && ev.exclGtin.has(g.gtin)) || (g.ncm && g.cest && ev.exclNcmCest.has(chaveNcmCest(g))));
}

interface ClasseMonofasico {
  grupo: GrupoMonofasico | "compra_cst04";
  confianca: Confianca;
  motivo: string;
  fonte: Fonte | null;
}

function monofasico(g: GrupoItens, ev: Evidencias, catalogo: LinhaCatalogo[]): ClasseMonofasico | null {
  let cat = classificarNcm(g.ncm, g.ex, g.competencia, catalogo);
  if (cat?.somente_varejo && !g.consumidor_final) cat = null;
  const porGtin = Boolean(g.gtin && ev.monoGtin.has(g.gtin));
  const porNcm = Boolean(g.ncm && ev.monoNcm.has(g.ncm));
  const compra = porGtin ? "o mesmo produto foi comprado com CST 04 (monofásico)" : porNcm ? "itens do mesmo NCM foram comprados com CST 04" : null;
  if (cat && (cat.confianca === "alta" || porGtin || porNcm)) {
    return {
      grupo: cat.grupo,
      confianca: "alta",
      motivo: [`NCM ${fmtNcm(g.ncm)} — ${cat.descricao}`, compra].filter(Boolean).join("; "),
      fonte: cat.fonte,
    };
  }
  if (porGtin) return { grupo: "compra_cst04", confianca: "alta", motivo: compra!, fonte: null };
  if (porNcm) return { grupo: "compra_cst04", confianca: "media", motivo: `${compra} (NCM ${fmtNcm(g.ncm)})`, fonte: null };
  if (cat) {
    return {
      grupo: cat.grupo,
      confianca: "conferir",
      motivo: `NCM ${fmtNcm(g.ncm)} — ${cat.descricao}${cat.condicao ? `. ${cat.condicao}` : ""}`,
      fonte: cat.fonte,
    };
  }
  return null;
}

function evidenciaSt(g: GrupoItens, ev: Evidencias): { confianca: Confianca; motivo: string } | null {
  if (g.gtin && ev.stGtin.has(g.gtin)) return { confianca: "alta", motivo: "o mesmo produto foi comprado com ICMS-ST retido" };
  if (g.ncm && g.cest && ev.stNcmCest.has(`${g.ncm}:${g.cest}`)) {
    return { confianca: "media", motivo: `itens do NCM ${fmtNcm(g.ncm)} (CEST ${g.cest}) foram comprados com ICMS-ST` };
  }
  if (g.ncm && ev.stNcm.has(g.ncm)) return { confianca: "conferir", motivo: `itens do NCM ${fmtNcm(g.ncm)} foram comprados com ICMS-ST` };
  return null;
}

/**
 * Evidência de ST para uma venda tributada normalmente: se o produto saiu da
 * ST no Estado e também foi comprado sem ST da indústria local, a venda
 * tributada pode estar certa (só o estoque antigo ou de outro estado tem ST).
 */
function evidenciaStVenda(g: GrupoItens, ev: Evidencias, e: EntradaAuditoria): { confianca: Confianca; motivo: string } | null {
  const st = evidenciaSt(g, ev);
  if (!st) return null;
  const exc = exclusaoSt(g.cest, g.ncm, ultimoDiaDoMes(competenciaDe(g)), e.uf ?? null, e.exclusoesSt ?? []);
  if (!exc || !compradoForaDaSt(g, ev)) return st;
  return {
    confianca: "conferir",
    motivo:
      `${st.motivo}, mas também foi comprado sem ST de indústria do ${exc.uf} ` +
      `(${ROTULO_SEGMENTO_ST[exc.segmento]}: fora da ST desde ${formatarData(exc.inicio)}) — a venda tributada pode estar correta`,
  };
}

// -----------------------------------------------------------------------------
// Simples Nacional: faixa, alíquota efetiva e partilha
// -----------------------------------------------------------------------------
export function aliquotaEfetiva(anexo: "I" | "II", rbt12: Decimal) {
  const tabela = ANEXOS_SIMPLES[anexo];
  if (rbt12.gt(tabela[tabela.length - 1].ate)) return null;
  const faixa = Math.max(0, tabela.findIndex((f) => rbt12.lte(f.ate)));
  const nominal = dec(tabela[faixa].aliquota).div(100);
  const efetiva = rbt12.lte(0) ? nominal : rbt12.times(nominal).minus(dec(tabela[faixa].deduzir)).div(rbt12);
  return { faixa, nominal, efetiva, reparticao: REPARTICAO_SIMPLES[anexo][faixa] };
}

function memoriaSimples(s: MesSimples, ef: NonNullable<ReturnType<typeof aliquotaEfetiva>>) {
  const linhas = [
    { rotulo: "Receita bruta dos 12 meses anteriores (RBT12)", valor: moeda(s.rbt12) },
    { rotulo: "Anexo e faixa do Simples", valor: `Anexo ${s.anexo}${s.anexoInformado ? "" : " (presumido: comércio)"}, ${ef.faixa + 1}ª faixa` },
    { rotulo: "Alíquota efetiva do mês", valor: pct(ef.efetiva) },
  ];
  if (s.observacao) linhas.push({ rotulo: "Observação sobre a RBT12", valor: s.observacao });
  if (s.mesesSemDados.length) {
    linhas.push({ rotulo: "Meses sem receita no portal", valor: s.mesesSemDados.map((m) => mes(m)).join(", ") });
  }
  return linhas;
}

// -----------------------------------------------------------------------------
// Auditoria
// -----------------------------------------------------------------------------
export function auditar(e: EntradaAuditoria): AchadoCalculado[] {
  const ev = evidencias(e);
  const porMes = new Map<string, GrupoItens[]>();
  for (const g of e.grupos) {
    const c = `${String(g.competencia).slice(0, 7)}-01`;
    const lista = porMes.get(c) ?? [];
    lista.push({ ...g, competencia: c });
    porMes.set(c, lista);
  }
  const achados: AchadoCalculado[] = [];
  for (let c = e.inicio; c <= e.fim; c = somarMeses(c, 1)) {
    const grupos = porMes.get(c);
    if (!grupos?.length) continue;
    const regime = e.regimeDoMes(c);
    const vendas = grupos.filter((g) => g.operacao === "saida" && cfopVenda(g.cfop));
    const devolucoes = grupos.filter((g) => g.operacao === "entrada" && cfopDevolucaoNaEntrada(g.cfop));
    if (regime === "simples_nacional") {
      const s = e.simples(c);
      achados.push(...monofasicoSimples(c, vendas, devolucoes, s, ev, e));
      achados.push(...stSimples(c, vendas, devolucoes, s, ev, e));
    } else if (regime && REGIME_NORMAL.has(regime)) {
      achados.push(...monofasicoRegimeNormal(c, regime, vendas, ev, e));
      achados.push(...icmsStRegimeNormal(c, vendas, ev, e));
    }
    achados.push(...vendaStSemCompraSt(c, vendas, ev, e));
    if (e.exclusoesSt?.length) {
      achados.push(...stRetidaForaDaSt(c, grupos, e));
      achados.push(...vendaStForaDaSt(c, regime, vendas, ev, e));
    }
    achados.push(...ibsCbsAusente(c, regime, vendas, e.semIbsCbs?.(c) ?? null));
    achados.push(...ibsCbsAliquota(c, vendas));
    achados.push(...ncmInvalido(c, vendas));
  }
  achados.push(...estoqueSaidaSt(e));
  return achados;
}

// PIS/Cofins monofásico pago dentro do DAS ------------------------------------
function monofasicoSimples(
  c: string,
  vendas: GrupoItens[],
  devolucoes: GrupoItens[],
  s: MesSimples | null,
  ev: Evidencias,
  e: EntradaAuditoria,
): AchadoCalculado[] {
  const marcadas = vendas.map((g) => ({ g, classe: monofasico(g, ev, e.catalogo) })).filter((x) => x.classe);
  if (!marcadas.length || !s) return [];
  const devolvidas = devolucoes.map((g) => ({ g, classe: monofasico(g, ev, e.catalogo) })).filter((x) => x.classe);
  const bruto = marcadas.reduce((t, x) => t.plus(num(x.g.valor)), new Decimal(0));
  const devolvido = devolvidas.reduce((t, x) => t.plus(num(x.g.valor)), new Decimal(0));
  const receita = centavos(Decimal.max(0, bruto.minus(devolvido)));
  if (receita.lte(0)) return [];
  const ef = aliquotaEfetiva(s.anexo, s.rbt12);
  if (!ef) return [];
  const parcela = dec(ef.reparticao.pis).plus(ef.reparticao.cofins);
  const valor = centavos(receita.times(ef.efetiva).times(parcela).div(100));
  if (valor.lt("0.01")) return [];

  let confianca: Confianca = marcadas.reduce<Confianca>((acc, x) => pior(acc, x.classe!.confianca), "alta");
  if (s.mesesSemDados.length || !s.anexoInformado) confianca = pior(confianca, "media");
  const porGrupo = new Map<string, Decimal>();
  for (const x of marcadas) porGrupo.set(x.classe!.grupo, (porGrupo.get(x.classe!.grupo) ?? new Decimal(0)).plus(num(x.g.valor)));
  const grupos = [...porGrupo.entries()].sort((a, b) => b[1].comparedTo(a[1]));
  const nomes = grupos.map(([g]) => ROTULO_GRUPO[g as GrupoMonofasico]).join(", ");
  const prazo = prazoRestituicao(c);
  const itens = marcadas.reduce((t, x) => t + x.g.itens, 0);

  return [
    {
      regra: "monofasico_simples",
      chave: `monofasico_simples:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca,
      titulo: `PIS/Cofins monofásico possivelmente pago no DAS — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, a empresa vendeu ${moeda(receita)} em produtos com PIS/Cofins monofásico (${nomes}). ` +
        `Nesses produtos o PIS e a Cofins já foram pagos pelo fabricante ou importador. Se essa receita não foi separada como ` +
        `monofásica no PGDAS-D, o DAS cobrou PIS e Cofins de novo: cerca de ${moeda(valor)}. Confira a apuração do mês; ` +
        `se não houve a separação, cabe retificar o PGDAS-D e pedir a restituição até ${formatarData(prazo)}.`,
      valor_base: receita.toFixed(2),
      valor_estimado: valor.toFixed(2),
      memoria: [
        { rotulo: "Vendas de produtos monofásicos no mês", valor: moeda(bruto) },
        ...(devolvido.gt(0) ? [{ rotulo: "Devoluções desses produtos", valor: `− ${moeda(devolvido)}` }] : []),
        { rotulo: "Receita monofásica considerada", valor: `${moeda(receita)} (${itens} ${itens === 1 ? "item" : "itens"})` },
        ...grupos.map(([g, v]) => ({ rotulo: `  · ${ROTULO_GRUPO[g as GrupoMonofasico]}`, valor: moeda(v) })),
        ...memoriaSimples(s, ef),
        {
          rotulo: "Parcela de PIS + Cofins dentro do DAS",
          valor: `${pctTexto(ef.reparticao.pis)} + ${pctTexto(ef.reparticao.cofins)} = ${pctTexto(parcela.toFixed(2))}`,
        },
        { rotulo: "PIS/Cofins cobrado a mais, se não houve a separação", valor: `${moeda(receita)} × ${pct(ef.efetiva)} × ${pctTexto(parcela.toFixed(2))} = ${moeda(valor)}` },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(marcadas.map((x) => ({ g: x.g, motivo: x.classe!.motivo }))),
      fontes: fontesUnicas([FONTES.segregacao, ...marcadas.map((x) => x.classe!.fonte), FONTES.restituicao]),
    },
  ];
}

// ICMS-ST pago de novo dentro do DAS -------------------------------------------
function stSimples(
  c: string,
  vendas: GrupoItens[],
  devolucoes: GrupoItens[],
  s: MesSimples | null,
  ev: Evidencias,
  e: EntradaAuditoria,
): AchadoCalculado[] {
  if (!s) return [];
  const marcadas = vendas
    .filter((g) => !vendaComoSt(g))
    .map((g) => ({ g, st: evidenciaStVenda(g, ev, e) }))
    .filter((x) => x.st);
  if (!marcadas.length) return [];
  const devolvidas = devolucoes.filter((g) => !vendaComoSt(g) && evidenciaStVenda(g, ev, e));
  const bruto = marcadas.reduce((t, x) => t.plus(num(x.g.valor)), new Decimal(0));
  const devolvido = devolvidas.reduce((t, g) => t.plus(num(g.valor)), new Decimal(0));
  const receita = centavos(Decimal.max(0, bruto.minus(devolvido)));
  const ef = aliquotaEfetiva(s.anexo, s.rbt12);
  // Na 6ª faixa o ICMS é pago fora do DAS: não há parcela de ICMS a separar.
  if (receita.lte(0) || !ef || !ef.reparticao.icms) return [];
  const valor = centavos(receita.times(ef.efetiva).times(dec(ef.reparticao.icms)).div(100));
  if (valor.lt("0.01")) return [];
  let confianca: Confianca = marcadas.reduce<Confianca>((acc, x) => pior(acc, x.st!.confianca), "alta");
  if (s.mesesSemDados.length || !s.anexoInformado) confianca = pior(confianca, "media");
  const prazo = prazoRestituicao(c);
  const itens = marcadas.reduce((t, x) => t + x.g.itens, 0);
  const cfops = [...new Set(marcadas.map((x) => x.g.cfop).filter(Boolean))].join(", ");
  const csosns = [...new Set(marcadas.map((x) => x.g.csosn).filter(Boolean))].join(", ");

  return [
    {
      regra: "st_simples",
      chave: `st_simples:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca,
      titulo: `ICMS-ST possivelmente pago de novo no DAS — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, ${moeda(receita)} em vendas foram de produtos comprados com ICMS já retido por substituição tributária, ` +
        `mas as notas de venda saíram como tributadas normalmente (CFOP ${cfops || "—"}${csosns ? `, CSOSN ${csosns}` : ""}). ` +
        `Se essa receita não foi separada como "ICMS por substituição" no PGDAS-D, o DAS cobrou o ICMS de novo: cerca de ${moeda(valor)}. ` +
        `Confira a apuração e o cadastro fiscal dos produtos (o certo é CSOSN 500 e CFOP 5.405). A restituição pode ser pedida até ${formatarData(prazo)}.`,
      valor_base: receita.toFixed(2),
      valor_estimado: valor.toFixed(2),
      memoria: [
        { rotulo: "Vendas de produtos com ICMS-ST retido na compra", valor: moeda(bruto) },
        ...(devolvido.gt(0) ? [{ rotulo: "Devoluções desses produtos", valor: `− ${moeda(devolvido)}` }] : []),
        { rotulo: "Receita considerada", valor: `${moeda(receita)} (${itens} ${itens === 1 ? "item" : "itens"})` },
        ...memoriaSimples(s, ef),
        { rotulo: "Parcela do ICMS dentro do DAS", valor: pctTexto(ef.reparticao.icms) },
        { rotulo: "ICMS cobrado a mais, se não houve a separação", valor: `${moeda(receita)} × ${pct(ef.efetiva)} × ${pctTexto(ef.reparticao.icms)} = ${moeda(valor)}` },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(marcadas.map((x) => ({ g: x.g, motivo: x.st!.motivo }))),
      fontes: fontesUnicas([FONTES.segregacao, FONTES.st, FONTES.restituicao]),
    },
  ];
}

// PIS/Cofins destacado na revenda de monofásicos (Lucro Presumido/Real) --------
function monofasicoRegimeNormal(c: string, regime: string, vendas: GrupoItens[], ev: Evidencias, e: EntradaAuditoria): AchadoCalculado[] {
  const marcadas = vendas
    .filter((g) => cfopRevenda(g.cfop))
    .map((g) => ({ g, classe: monofasico(g, ev, e.catalogo) }))
    .filter((x) => x.classe && (num(x.g.pis).plus(num(x.g.cofins)).gt(0) || ["01", "02", "03"].includes(x.g.cst_pis ?? "")));
  if (!marcadas.length) return [];
  let destacado = new Decimal(0);
  let estimado = new Decimal(0);
  let receita = new Decimal(0);
  for (const x of marcadas) {
    receita = receita.plus(num(x.g.valor));
    const v = num(x.g.pis).plus(num(x.g.cofins));
    if (v.gt(0)) destacado = destacado.plus(v);
    else estimado = estimado.plus(num(x.g.valor).times(dec(PIS_COFINS_ESTIMADO[regime] ?? "3.65")).div(100));
  }
  const valor = centavos(destacado.plus(estimado));
  if (valor.lt("0.01")) return [];
  let confianca: Confianca = marcadas.reduce<Confianca>((acc, x) => pior(acc, x.classe!.confianca), "alta");
  if (estimado.gt(0)) confianca = pior(confianca, "media");
  const prazo = prazoRestituicao(c);
  return [
    {
      regra: "monofasico_regime_normal",
      chave: `monofasico_regime_normal:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca,
      titulo: `PIS/Cofins cobrado na revenda de produtos monofásicos — ${mes(c)}`,
      resumo:
        `Na revenda de produtos com PIS/Cofins monofásico a alíquota é zero (CST 04). Em ${mesLongo(c)}, ${moeda(centavos(receita))} ` +
        `em vendas desses produtos saíram com PIS/Cofins: ${moeda(valor)}. Se esses valores foram recolhidos, cabe pedir a restituição ` +
        `ou compensação (PER/DCOMP) até ${formatarData(prazo)} e corrigir o cadastro fiscal dos produtos no sistema de vendas.`,
      valor_base: centavos(receita).toFixed(2),
      valor_estimado: valor.toFixed(2),
      memoria: [
        { rotulo: "Vendas de produtos monofásicos com PIS/Cofins", valor: moeda(centavos(receita)) },
        { rotulo: "PIS + Cofins destacados nas notas", valor: moeda(centavos(destacado)) },
        ...(estimado.gt(0)
          ? [{ rotulo: `PIS + Cofins estimados (${pctTexto(PIS_COFINS_ESTIMADO[regime] ?? "3.65")}) onde a nota não traz o valor`, valor: moeda(centavos(estimado)) }]
          : []),
        { rotulo: "Total possivelmente pago a mais", valor: moeda(valor) },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(marcadas.map((x) => ({ g: x.g, motivo: x.classe!.motivo }))),
      fontes: fontesUnicas([...marcadas.map((x) => x.classe!.fonte), FONTES.restituicao]),
    },
  ];
}

// ICMS próprio destacado em mercadoria que já teve o ICMS retido (regime normal)
function icmsStRegimeNormal(c: string, vendas: GrupoItens[], ev: Evidencias, e: EntradaAuditoria): AchadoCalculado[] {
  const marcadas = vendas
    .filter((g) => ["00", "20"].includes(g.cst_icms ?? "") && num(g.icms).gt(0))
    .map((g) => ({ g, st: evidenciaStVenda(g, ev, e) }))
    .filter((x) => x.st);
  if (!marcadas.length) return [];
  const valor = centavos(marcadas.reduce((t, x) => t.plus(num(x.g.icms)), new Decimal(0)));
  const receita = centavos(marcadas.reduce((t, x) => t.plus(num(x.g.valor)), new Decimal(0)));
  const confianca = pior(
    marcadas.reduce<Confianca>((acc, x) => pior(acc, x.st!.confianca), "alta"),
    "media",
  );
  return [
    {
      regra: "icms_st_regime_normal",
      chave: `icms_st_regime_normal:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca,
      titulo: `ICMS destacado em produto que já teve o ICMS retido — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, ${moeda(receita)} em vendas de produtos comprados com ICMS-ST saíram com ICMS próprio destacado (CST 00/20): ${moeda(valor)}. ` +
        `Na revenda de mercadoria com o imposto já retido, o correto é CST 60, sem novo débito. Confira a apuração do ICMS do mês; ` +
        `se o débito entrou na apuração, avalie o crédito ou a restituição conforme a legislação do Estado.`,
      valor_base: receita.toFixed(2),
      valor_estimado: valor.toFixed(2),
      memoria: [
        { rotulo: "Vendas de produtos com ICMS-ST retido na compra", valor: moeda(receita) },
        { rotulo: "ICMS próprio destacado nessas vendas", valor: moeda(valor) },
      ],
      referencias: referencias(marcadas.map((x) => ({ g: x.g, motivo: x.st!.motivo }))),
      fontes: fontesUnicas([FONTES.st, FONTES.restituicao]),
    },
  ];
}

// Venda como ST de produto comprado sem ST (risco) --------------------------------
/** Venda emitida como ST de um NCM que, no portal, só foi comprado sem ST. */
function vendaStSoComprasSemSt(g: GrupoItens, ev: Evidencias) {
  return vendaComoSt(g) && Boolean(g.ncm) && !evidenciaSt(g, ev) && ev.semStNcm.has(g.ncm!) && !ev.stNcm.has(g.ncm!);
}

function vendaStSemCompraSt(c: string, vendas: GrupoItens[], ev: Evidencias, e: EntradaAuditoria): AchadoCalculado[] {
  void e;
  const marcadas = vendas.filter((g) => vendaStSoComprasSemSt(g, ev));
  if (!marcadas.length) return [];
  const receita = centavos(marcadas.reduce((t, g) => t.plus(num(g.valor)), new Decimal(0)));
  if (receita.lte(0)) return [];
  const ncms = [...new Set(marcadas.map((g) => fmtNcm(g.ncm)))];
  return [
    {
      regra: "st_sem_compra_st",
      chave: `st_sem_compra_st:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "risco",
      confianca: "conferir",
      titulo: `Vendas tratadas como ICMS-ST sem compra com ST — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, ${moeda(receita)} em vendas saíram como se o ICMS já tivesse sido pago por substituição tributária, ` +
        `mas as compras desses mesmos NCMs registradas no portal vieram sem ST (${ncms.slice(0, 5).join(", ")}${ncms.length > 5 ? "…" : ""}). ` +
        `Se o ICMS não foi pago antes, há risco de cobrança do imposto com multa. Confira o cadastro fiscal desses produtos.`,
      valor_base: receita.toFixed(2),
      valor_estimado: null,
      memoria: [
        { rotulo: "Vendas emitidas como ST", valor: moeda(receita) },
        { rotulo: "NCMs envolvidos", valor: ncms.join(", ") },
      ],
      referencias: referencias(marcadas.map((g) => ({ g, motivo: `vendido como ST; compras do NCM ${fmtNcm(g.ncm)} sem ST` }))),
      fontes: [FONTES.st],
    },
  ];
}

// Produtos que saíram da ST por regra do Estado -----------------------------------
function descreverExclusoes(lista: ExclusaoSt[]) {
  const marcos = [...new Map(lista.map((l) => [`${l.segmento}|${l.inicio}`, l])).values()];
  return {
    uf: marcos[0].uf,
    segmentos: [...new Set(marcos.map((l) => ROTULO_SEGMENTO_ST[l.segmento]))].join(", "),
    desde: marcos.map((l) => `${ROTULO_SEGMENTO_ST[l.segmento]} desde ${formatarData(l.inicio)}`).join("; "),
    itens: [...new Set(marcos.map((l) => l.item))].join("; "),
    confianca: marcos.reduce<Confianca>((acc, l) => pior(acc, l.confianca), "alta"),
    fontes: marcos.map((l) => l.fonte),
  };
}
const motivoExclusao = (g: GrupoItens, exc: ExclusaoSt) => `CFOP ${g.cfop ?? "—"}, CEST ${g.cest ?? "—"} — ${exc.descricao}`;

/** Compra da indústria do Estado com ICMS-ST retido depois que o produto saiu da ST (oportunidade). */
function stRetidaForaDaSt(c: string, grupos: GrupoItens[], e: EntradaAuditoria): AchadoCalculado[] {
  // O portal agrupa as notas por mês: só conta o mês inteiro já dentro da exclusão
  const marcadas = grupos
    .filter((g) => cfopCompraNaEntrada(g.cfop) && num(g.icms_st).gt(0))
    .map((g) => ({ g, exc: exclusaoNaCompra(g, e, c) }))
    .filter((x): x is { g: GrupoItens; exc: ExclusaoSt } => x.exc !== null);
  if (!marcadas.length) return [];
  const st = centavos(marcadas.reduce((t, x) => t.plus(num(x.g.icms_st)), new Decimal(0)));
  const compras = centavos(marcadas.reduce((t, x) => t.plus(num(x.g.valor)), new Decimal(0)));
  if (st.lt("0.01")) return [];
  const d = descreverExclusoes(marcadas.map((x) => x.exc));
  const prazo = prazoRestituicao(c);
  const itens = marcadas.reduce((t, x) => t + x.g.itens, 0);
  return [
    {
      regra: "st_retida_fora_da_st",
      chave: `st_retida_fora_da_st:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca: d.confianca,
      titulo: `ICMS-ST cobrado por indústria do ${d.uf} em produto que saiu da ST — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, a empresa comprou ${moeda(compras)} de indústrias do ${d.uf} em produtos que saíram da substituição tributária ` +
        `(${d.segmentos}), e as notas vieram com ICMS-ST retido: ${moeda(st)}. Pela regra do Estado, a venda interna da indústria local desses ` +
        `produtos não tem mais ST (${d.desde}). Confira o CEST no Anexo XXI vigente e fale com o fornecedor: se a retenção foi indevida, ele corrige ` +
        `as próximas notas e o valor retido pode ser recuperado com o pedido de restituição à SEFAZ (com a prova de quem suportou o imposto), ` +
        `até ${formatarData(prazo)}.`,
      valor_base: compras.toFixed(2),
      valor_estimado: st.toFixed(2),
      memoria: [
        { rotulo: "Compras de indústrias do Estado com ICMS-ST retido", valor: `${moeda(compras)} (${itens} ${itens === 1 ? "item" : "itens"})` },
        { rotulo: "ICMS-ST retido nessas notas", valor: moeda(st) },
        { rotulo: "Produtos (lista de ST do Estado)", valor: d.itens },
        { rotulo: "Fora da ST", valor: d.desde },
        { rotulo: "Condição da regra", valor: "Venda interna da indústria fabricante do Estado (CFOP 5.101 a 5.122, 5.401 ou 5.402 na nota do fornecedor)" },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(marcadas.map((x) => ({ g: x.g, motivo: motivoExclusao(x.g, x.exc) }))),
      fontes: fontesUnicas([...d.fontes, FONTES.restituicao]),
    },
  ];
}

/** Venda como ST de produto que a empresa já compra sem ST da indústria do Estado (risco). */
function vendaStForaDaSt(c: string, regime: string | null, vendas: GrupoItens[], ev: Evidencias, e: EntradaAuditoria): AchadoCalculado[] {
  const data = ultimoDiaDoMes(c);
  const marcadas = vendas
    // Quando o NCM só foi comprado sem ST, o achado geral (st_sem_compra_st) já aponta a venda
    .filter((g) => vendaComoSt(g) && compradoForaDaSt(g, ev) && !vendaStSoComprasSemSt(g, ev))
    .map((g) => ({ g, exc: exclusaoSt(g.cest, g.ncm, data, e.uf ?? null, e.exclusoesSt ?? []) }))
    .filter((x): x is { g: GrupoItens; exc: ExclusaoSt } => x.exc !== null);
  if (!marcadas.length) return [];
  const receita = centavos(marcadas.reduce((t, x) => t.plus(num(x.g.valor)), new Decimal(0)));
  if (receita.lte(0)) return [];
  const d = descreverExclusoes(marcadas.map((x) => x.exc));
  const simplesNacional = regime === "simples_nacional";
  const s = simplesNacional ? e.simples(c) : null;
  const ef = s ? aliquotaEfetiva(s.anexo, s.rbt12) : null;
  const icmsDas = ef?.reparticao.icms ? centavos(receita.times(ef.efetiva).times(dec(ef.reparticao.icms)).div(100)) : null;
  const correto = simplesNacional
    ? "o ICMS entra no DAS (CSOSN 102, sem separar a receita como ST no PGDAS-D)"
    : regime && REGIME_NORMAL.has(regime)
      ? "há débito de ICMS na venda (CST 00), com o crédito da compra"
      : "o ICMS da venda segue a regra normal";
  return [
    {
      regra: "venda_st_fora_da_st",
      chave: `venda_st_fora_da_st:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "risco",
      confianca: "conferir",
      titulo: `Produto que saiu da ST vendido como ST — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, ${moeda(receita)} em vendas de ${d.segmentos} saíram como se o ICMS já tivesse sido pago por substituição tributária ` +
        `(CFOP 5.405, CST 60 ou CSOSN 500), mas a empresa também comprou esses produtos sem ST de indústria do ${d.uf}, depois que saíram da ST ` +
        `(${d.desde}). Só o estoque comprado com ST (antes da mudança ou de outro estado) pode sair assim; no restante, ${correto}. ` +
        `Confira o estoque e o cadastro fiscal dos produtos no sistema de vendas.`,
      valor_base: receita.toFixed(2),
      valor_estimado: null,
      memoria: [
        { rotulo: "Vendas emitidas como ST desses produtos", valor: moeda(receita) },
        { rotulo: "Produtos (lista de ST do Estado)", valor: d.itens },
        { rotulo: "Fora da ST", valor: d.desde },
        ...(s && ef && icmsDas
          ? [
              ...memoriaSimples(s, ef),
              {
                rotulo: "ICMS do DAS sobre essa receita, se nada dela tinha ST",
                valor: `${moeda(receita)} × ${pct(ef.efetiva)} × ${pctTexto(ef.reparticao.icms!)} = ${moeda(icmsDas)}`,
              },
            ]
          : []),
      ],
      referencias: referencias(marcadas.map((x) => ({ g: x.g, motivo: `vendido como ST; comprado sem ST de indústria do ${x.exc.uf} (${motivoExclusao(x.g, x.exc)})` }))),
      fontes: fontesUnicas([...d.fontes, simplesNacional ? FONTES.segregacao : null]),
    },
  ];
}

/** Estoque na data em que o produto saiu da ST: compras com ST da indústria do Estado nos 6 meses anteriores (informativo). */
function estoqueSaidaSt(e: EntradaAuditoria): AchadoCalculado[] {
  const marcos = new Map<string, ExclusaoSt[]>();
  for (const l of e.exclusoesSt ?? []) {
    if (l.uf !== e.uf) continue;
    const k = `${l.segmento}|${l.inicio}`;
    marcos.set(k, [...(marcos.get(k) ?? []), l]);
  }
  const achados: AchadoCalculado[] = [];
  for (const linhas of marcos.values()) {
    const inicio = linhas[0].inicio;
    const c = `${inicio.slice(0, 7)}-01`;
    if (c < e.inicio || c > e.fim) continue;
    const desde = somarMeses(c, -6);
    const so = { ...e, exclusoesSt: linhas };
    const marcadas = e.grupos
      .filter((g) => competenciaDe(g) >= desde && competenciaDe(g) < c && cfopCompraNaEntrada(g.cfop) && compraComSt(g))
      .map((g) => ({ g, exc: exclusaoNaCompra(g, so, inicio) }))
      .filter((x): x is { g: GrupoItens; exc: ExclusaoSt } => x.exc !== null);
    if (!marcadas.length) continue;
    const valor = centavos(marcadas.reduce((t, x) => t.plus(num(x.g.valor)), new Decimal(0)));
    const st = centavos(marcadas.reduce((t, x) => t.plus(num(x.g.icms_st)), new Decimal(0)));
    const d = descreverExclusoes(linhas);
    const procedimento =
      d.uf === "TO" ? "siga os procedimentos do art. 46-D do RICMS/TO para esse estoque (art. 46, § 4º)" : "siga a regra de estoque da legislação do Estado";
    achados.push({
      regra: "estoque_saida_st",
      chave: `estoque_saida_st:${c.slice(0, 7)}:${linhas[0].segmento}`,
      competencia: c,
      tipo: "informativo",
      confianca: "conferir",
      titulo: `Estoque na saída da ST (${d.segmentos}) — ${mes(c)}`,
      resumo:
        `Desde ${formatarData(inicio)}, ${d.segmentos} vendidos por indústria do ${d.uf} estão fora da substituição tributária. Nos 6 meses ` +
        `anteriores, a empresa comprou ${moeda(valor)} desses produtos de indústrias do Estado com ICMS-ST retido${st.gt(0) ? ` (${moeda(st)})` : ""}. ` +
        `Se havia estoque na data, faça o inventário (EFD, Bloco H, motivo 02 — mudança na forma de tributação) e ${procedimento}: ` +
        `as vendas desse estoque passam à apuração normal do ICMS.`,
      valor_base: valor.toFixed(2),
      valor_estimado: null,
      memoria: [
        { rotulo: `Compras com ST de indústrias do Estado (${mes(desde)} a ${mes(somarMeses(c, -1))})`, valor: moeda(valor) },
        ...(st.gt(0) ? [{ rotulo: "ICMS-ST retido nessas compras", valor: moeda(st) }] : []),
        { rotulo: "Produtos (lista de ST do Estado)", valor: d.itens },
        { rotulo: "Fora da ST", valor: d.desde },
      ],
      referencias: referencias(marcadas.map((x) => ({ g: x.g, motivo: motivoExclusao(x.g, x.exc) }))),
      fontes: fontesUnicas(d.fontes),
    });
  }
  return achados;
}

// Reforma tributária: grupo IBS/CBS ausente nas notas de venda (risco) ------------
function ibsCbsAusente(
  c: string,
  regime: string | null,
  vendas: GrupoItens[],
  contagem: { total: number; apos_normal: number } | null,
): AchadoCalculado[] {
  const simples = regime === "simples_nacional" || regime === "mei";
  if (!regime || (!simples && !REGIME_NORMAL.has(regime))) return [];
  const inicioObrigacao = simples ? OBRIGACAO_IBS_CBS.simples : OBRIGACAO_IBS_CBS.regimeNormal;
  if (`${c.slice(0, 7)}-31` < inicioObrigacao) return [];
  const sem = vendas.filter((g) => ["55", "65"].includes(g.modelo) && !g.cst_ibscbs && (simples || g.apos_ibscbs_normal));
  if (!sem.length) return [];
  const notas = contagem ? (simples ? contagem.total : contagem.apos_normal) || sem.reduce((t, g) => t + g.notas, 0) : sem.reduce((t, g) => t + g.notas, 0);
  const valor = centavos(sem.reduce((t, g) => t.plus(num(g.valor)), new Decimal(0)));
  return [
    {
      regra: "ibscbs_ausente",
      chave: `ibscbs_ausente:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "risco",
      confianca: "alta",
      titulo: `Notas de venda sem IBS/CBS — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, cerca de ${notas} ${notas === 1 ? "nota de venda saiu" : "notas de venda saíram"} sem o grupo de IBS/CBS ` +
        `(${moeda(valor)} em produtos). Desde ${formatarData(inicioObrigacao)} o destaque é obrigatório para ${simples ? "o Simples Nacional" : "o regime normal"}. ` +
        `A SEFAZ não está recusando essas notas, mas a obrigação continua e, em 2026, a dispensa de pagar a CBS e o IBS de teste depende de cumpri-la. ` +
        `Ajuste o sistema emissor da empresa.`,
      valor_base: valor.toFixed(2),
      valor_estimado: null,
      memoria: [
        { rotulo: "Notas de venda sem o grupo IBS/CBS (aprox.)", valor: String(notas) },
        { rotulo: "Valor dos produtos dessas notas", valor: moeda(valor) },
        { rotulo: "Obrigatório desde", valor: formatarData(inicioObrigacao) },
      ],
      referencias: referencias(sem.map((g) => ({ g, motivo: "nota sem o grupo IBSCBS" }))),
      fontes: [FONTES.ibsCbs, FONTES.notaTecnica],
    },
  ];
}

// Reforma tributária: alíquotas de teste de 2026 diferentes (risco) ---------------
function ibsCbsAliquota(c: string, vendas: GrupoItens[]): AchadoCalculado[] {
  if (!c.startsWith("2026-")) return [];
  const difere = (v: string | null, esperado: string) => v === null || !dec(v).eq(dec(esperado));
  const marcadas = vendas.filter(
    (g) =>
      g.cst_ibscbs === "000" &&
      !g.reducao &&
      (difere(g.p_cbs, TESTE_2026.cbs) || difere(g.p_ibs_uf, TESTE_2026.ibsUf) || difere(g.p_ibs_mun ?? "0", TESTE_2026.ibsMun)),
  );
  if (!marcadas.length) return [];
  const notas = marcadas.reduce((t, g) => t + g.notas, 0);
  const encontradas = [...new Set(marcadas.map((g) => `CBS ${g.p_cbs ?? "—"}%, IBS UF ${g.p_ibs_uf ?? "—"}%, IBS Mun ${g.p_ibs_mun ?? "—"}%`))];
  return [
    {
      regra: "ibscbs_aliquota",
      chave: `ibscbs_aliquota:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "risco",
      confianca: "alta",
      titulo: `IBS/CBS com alíquota diferente da de teste de 2026 — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, cerca de ${notas} ${notas === 1 ? "nota" : "notas"} de venda com tributação integral (CST 000) ` +
        `trouxeram alíquotas diferentes das de teste de 2026 (CBS 0,9%, IBS estadual 0,1%, IBS municipal 0%). ` +
        `A SEFAZ recusa cálculos incoerentes; confira a configuração do sistema emissor.`,
      valor_base: centavos(marcadas.reduce((t, g) => t.plus(num(g.valor)), new Decimal(0))).toFixed(2),
      valor_estimado: null,
      memoria: [
        { rotulo: "Alíquotas encontradas", valor: encontradas.slice(0, 5).join(" | ") },
        { rotulo: "Alíquotas de teste de 2026", valor: "CBS 0,9% · IBS estadual 0,1% · IBS municipal 0%" },
      ],
      referencias: referencias(marcadas.map((g) => ({ g, motivo: `CBS ${g.p_cbs ?? "—"}%, IBS UF ${g.p_ibs_uf ?? "—"}%` }))),
      fontes: [FONTES.ibsCbs, FONTES.notaTecnica],
    },
  ];
}

// NCM ausente ou inválido nas vendas (risco) ---------------------------------------
function ncmInvalido(c: string, vendas: GrupoItens[]): AchadoCalculado[] {
  const marcadas = vendas.filter(
    (g) => ["55", "65"].includes(g.modelo) && !/^[56]933$/.test(g.cfop ?? "") && (!g.ncm || !/^\d{8}$/.test(g.ncm) || g.ncm === "00000000"),
  );
  if (!marcadas.length) return [];
  const itens = marcadas.reduce((t, g) => t + g.itens, 0);
  const valor = centavos(marcadas.reduce((t, g) => t.plus(num(g.valor)), new Decimal(0)));
  return [
    {
      regra: "ncm_invalido",
      chave: `ncm_invalido:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "risco",
      confianca: "alta",
      titulo: `Produtos vendidos com NCM ausente ou inválido — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, ${itens} ${itens === 1 ? "item saiu" : "itens saíram"} sem um NCM válido de 8 dígitos (${moeda(valor)}). ` +
        `O NCM define a tributação do produto (inclusive monofásico, ST e a classificação da reforma tributária): corrija o cadastro no sistema de vendas.`,
      valor_base: valor.toFixed(2),
      valor_estimado: null,
      memoria: [
        { rotulo: "Itens com NCM ausente ou inválido", valor: String(itens) },
        { rotulo: "Valor desses itens", valor: moeda(valor) },
      ],
      referencias: referencias(marcadas.map((g) => ({ g, motivo: `NCM informado: ${g.ncm ?? "nenhum"}` }))),
      fontes: [],
    },
  ];
}
