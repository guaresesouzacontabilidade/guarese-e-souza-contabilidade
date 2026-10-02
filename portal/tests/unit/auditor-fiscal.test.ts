import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { lerXmlFiscal, type NotaLida } from "@/lib/fiscal/xml";
import { classificarNcm, type LinhaCatalogo } from "@/lib/auditor-fiscal/catalogo";
import { aliquotaEfetiva, auditar, inicioPrazo, prazoRestituicao, type GrupoItens, type MesSimples } from "@/lib/auditor-fiscal/regras";
import { cfopRevenda, cfopVenda, cfopVendaSt } from "@/lib/auditor-fiscal/cfop";

const fixture = (n: string) => readFileSync(join(__dirname, "../fixtures", n), "utf8");
const ler = (arquivo: string, documento: string) => (lerXmlFiscal(fixture(arquivo), { documento }) as { dados: NotaLida }).dados;

const FONTE = { titulo: "Lei de teste", url: "https://www.planalto.gov.br" };
const linha = (ncm: string, extra: Partial<LinhaCatalogo> = {}): LinhaCatalogo => ({
  ncm,
  ex: null,
  excecao: false,
  grupo: "farmaceuticos",
  descricao: `NCM ${ncm}`,
  condicao: null,
  somente_varejo: false,
  confianca: "alta",
  fonte: FONTE,
  inicio: "2004-01-01",
  fim: null,
  ...extra,
});
// Recorte do catálogo oficial (a lista completa está na migração do banco)
const CATALOGO: LinhaCatalogo[] = [
  linha("3004"),
  linha("30049046", { excecao: true }),
  linha("3003"),
  linha("30039056", { excecao: true }),
  linha("3305", { grupo: "higiene_perfumaria" }),
  linha("34011190", { grupo: "higiene_perfumaria" }),
  linha("34011190", { grupo: "higiene_perfumaria", ex: "01", excecao: true }),
  linha("8708", { grupo: "autopecas" }),
  linha("40169990", { grupo: "autopecas", ex: "03" }),
  linha("2203", { grupo: "bebidas_frias", somente_varejo: true }),
  linha("2202", { grupo: "bebidas_frias", somente_varejo: true, confianca: "conferir" }),
  linha("22011000", { grupo: "bebidas_frias", ex: "01", excecao: true }),
  linha("2201", { grupo: "bebidas_frias", somente_varejo: true }),
  linha("27101259", { grupo: "combustiveis" }),
];

/** Mesmo agrupamento de public.auditor_itens_agrupados (para testar sem banco). */
function agrupar(notas: NotaLida[]): GrupoItens[] {
  const grupos = new Map<string, GrupoItens & { _ex: GrupoItens["exemplos"] }>();
  for (const n of notas) {
    if (!["55", "65"].includes(n.modelo) || n.operacao === "nao_relacionada") continue;
    const competencia = `${n.data_emissao!.slice(0, 7)}-01`;
    const consumidorFinal = n.consumidor_final ?? n.modelo === "65";
    const apos = new Date(n.data_emissao!).getTime() >= new Date("2026-08-03T00:00:00-03:00").getTime();
    for (const i of n.itens) {
      const t = i.tributos;
      const g = {
        competencia, operacao: n.operacao as "entrada" | "saida", modelo: n.modelo, consumidor_final: consumidorFinal, crt: n.crt_emitente,
        cfop: i.cfop, ncm: i.ncm, gtin: i.gtin, cest: i.cest, ex: i.ex_tipi, csosn: t.csosn ?? null, cst_icms: t.cst_icms ?? null,
        cst_pis: t.cst_pis ?? null, cst_cofins: t.cst_cofins ?? null, cst_ibscbs: t.cst_ibscbs ?? null, cclasstrib: t.cclasstrib ?? null,
        p_cbs: t.p_cbs ?? null, p_ibs_uf: t.p_ibs_uf ?? null, p_ibs_mun: t.p_ibs_mun ?? null, reducao: "p_red_cbs" in t || "p_red_ibs" in t,
        apos_ibscbs_normal: apos,
      };
      const chave = JSON.stringify(g);
      const atual = grupos.get(chave) ?? {
        ...g, itens: 0, notas: 0, valor: "0", icms: "0", icms_st: "0", icms_st_retido: "0", pis: "0", cofins: "0", cbs: "0", ibs: "0",
        exemplos: [], _ex: [],
      };
      const soma = (a: unknown, b: unknown) => new Decimal(String(a ?? 0)).plus(new Decimal(String(b ?? 0))).toString();
      const valor = new Decimal(i.valor_total ?? 0).minus(i.valor_desconto ?? 0).toString();
      atual.itens += 1;
      atual.notas += 1;
      atual.valor = soma(atual.valor, valor);
      atual.icms = soma(atual.icms, t.icms);
      atual.icms_st = soma(atual.icms_st, t.icms_st);
      atual.pis = soma(atual.pis, t.pis);
      atual.cofins = soma(atual.cofins, t.cofins);
      atual.exemplos = [...(atual.exemplos ?? []), { nota_id: n.identificador, numero: n.numero, modelo: n.modelo, data: n.data_emissao, item: i.numero_item, descricao: i.descricao, valor }].slice(0, 3);
      grupos.set(chave, atual);
    }
  }
  return [...grupos.values()];
}

const simples = (rbt12: string, extra: Partial<MesSimples> = {}): MesSimples => ({
  rbt12: new Decimal(rbt12),
  anexo: "I",
  anexoInformado: true,
  mesesSemDados: [],
  observacao: null,
  ...extra,
});

describe("auditor fiscal — catálogo, prazos e CFOP", () => {
  it("enquadra o NCM pelo prefixo mais longo e respeita as exceções e o Ex da TIPI", () => {
    expect(classificarNcm("30049099", null, "2026-09-01", CATALOGO)?.ncm).toBe("3004");
    expect(classificarNcm("30049046", null, "2026-09-01", CATALOGO)).toBeNull();
    expect(classificarNcm("30039056", null, "2026-09-01", CATALOGO)).toBeNull();
    expect(classificarNcm("34011190", null, "2026-09-01", CATALOGO)?.grupo).toBe("higiene_perfumaria");
    expect(classificarNcm("34011190", "01", "2026-09-01", CATALOGO)).toBeNull();
    expect(classificarNcm("40169990", "03", "2026-09-01", CATALOGO)?.grupo).toBe("autopecas");
    expect(classificarNcm("40169990", null, "2026-09-01", CATALOGO)).toBeNull();
    expect(classificarNcm("22011000", "01", "2026-09-01", CATALOGO)).toBeNull();
    expect(classificarNcm("22011000", null, "2026-09-01", CATALOGO)?.grupo).toBe("bebidas_frias");
    expect(classificarNcm("27101932", null, "2026-09-01", CATALOGO)).toBeNull(); // óleo lubrificante não é monofásico
    expect(classificarNcm("123", null, "2026-09-01", CATALOGO)).toBeNull();
  });

  it("calcula o prazo de 5 anos da restituição e o início da janela", () => {
    expect(prazoRestituicao("2026-09-01")).toBe("2031-10-20");
    expect(prazoRestituicao("2021-12-01")).toBe("2027-01-20");
    expect(inicioPrazo("2026-10-02")).toBe("2021-09-01");
    expect(inicioPrazo("2026-10-21")).toBe("2021-10-01");
  });

  it("separa venda, venda com ST e revenda", () => {
    expect(cfopVenda("5102") && cfopVenda("6108") && cfopVenda("5405")).toBe(true);
    expect(cfopVenda("1102")).toBe(false);
    expect(cfopVendaSt("5405")).toBe(true);
    expect(cfopRevenda("5102")).toBe(true);
    expect(cfopRevenda("5101")).toBe(false);
  });

  it("acha a faixa e a alíquota efetiva do Simples (Anexo I)", () => {
    expect(aliquotaEfetiva("I", new Decimal(0))?.efetiva.toString()).toBe("0.04");
    const f3 = aliquotaEfetiva("I", new Decimal(500000))!;
    expect(f3.faixa).toBe(2);
    expect(f3.efetiva.toString()).toBe("0.06728");
    expect(f3.reparticao).toMatchObject({ pis: "2.76", cofins: "12.74", icms: "33.50" });
    expect(aliquotaEfetiva("I", new Decimal(4000000))?.reparticao.icms).toBeNull();
    expect(aliquotaEfetiva("I", new Decimal(5000000))).toBeNull();
  });
});

describe("auditor fiscal — farmácia do Simples", () => {
  const FARMACIA = "11222333000181";
  const grupos = agrupar([ler("nfe-compra-farmacia.xml", FARMACIA), ler("nfce-venda-farmacia.xml", FARMACIA)]);
  const achados = auditar({
    hoje: "2026-10-02",
    inicio: "2021-09-01",
    fim: "2026-10-01",
    regimeDoMes: () => "simples_nacional",
    simples: () => simples("500000"),
    grupos,
    catalogo: CATALOGO,
  });

  it("acha o PIS/Cofins monofásico pago no DAS, com a conta passo a passo", () => {
    const a = achados.find((x) => x.regra === "monofasico_simples")!;
    expect(a).toMatchObject({
      chave: "monofasico_simples:2026-09",
      competencia: "2026-09-01",
      tipo: "oportunidade",
      confianca: "alta",
      valor_base: "500.00",
      // 500,00 × 6,728% × (2,76% + 12,74%) = 5,21
      valor_estimado: "5.21",
    });
    expect(a.resumo).toContain("medicamentos, perfumaria e higiene");
    expect(a.resumo).toContain("20/10/2031");
    expect(a.memoria.map((m) => m.rotulo)).toContain("Parcela de PIS + Cofins dentro do DAS");
    expect(a.referencias.map((r) => r.descricao)).toEqual(["DIPIRONA 500MG 10 COMP", "SHAMPOO 300ML"]);
    expect(a.referencias[0].motivo).toContain("comprado com CST 04");
    expect(a.fontes[0].titulo).toContain("art. 18, § 4º-A");
  });

  it("acha o ICMS-ST pago de novo no DAS só no produto vendido como tributado", () => {
    const a = achados.find((x) => x.regra === "st_simples")!;
    // Dipirona (comprada com ST, vendida com CSOSN 102): 360,00 × 6,728% × 33,50% = 8,11. O xampu saiu com CSOSN 500: fora.
    expect(a).toMatchObject({ valor_base: "360.00", valor_estimado: "8.11", confianca: "alta" });
    expect(a.resumo).toContain("CSOSN 102");
    expect(a.referencias).toHaveLength(1);
  });

  it("não acusa IBS/CBS ausente para o Simples em 2026", () => {
    expect(achados.some((x) => x.regra.startsWith("ibscbs"))).toBe(false);
    expect(achados.map((x) => x.regra).sort()).toEqual(["monofasico_simples", "st_simples"]);
  });

  it("baixa a confiança quando falta receita de meses anteriores ou o anexo não foi informado", () => {
    const r = auditar({
      hoje: "2026-10-02", inicio: "2026-09-01", fim: "2026-09-01", regimeDoMes: () => "simples_nacional",
      simples: () => simples("500000", { mesesSemDados: ["2026-01-01"], anexoInformado: false }), grupos, catalogo: CATALOGO,
    });
    expect(r.find((x) => x.regra === "monofasico_simples")?.confianca).toBe("media");
  });

  it("MEI não tem achados de DAS (valor fixo)", () => {
    const r = auditar({
      hoje: "2026-10-02", inicio: "2026-09-01", fim: "2026-09-01", regimeDoMes: () => "mei", simples: () => null, grupos, catalogo: CATALOGO,
    });
    expect(r).toEqual([]);
  });
});

describe("auditor fiscal — autopeças do Lucro Presumido", () => {
  const grupos = agrupar([ler("nfe-venda-autopecas.xml", "55666777000190")]);
  const achados = auditar({
    hoje: "2026-10-02",
    inicio: "2021-09-01",
    fim: "2026-10-01",
    regimeDoMes: () => "lucro_presumido",
    simples: () => null,
    grupos,
    catalogo: CATALOGO,
  });

  it("acha o PIS/Cofins destacado na revenda de autopeças (valor exato das notas)", () => {
    const a = achados.find((x) => x.regra === "monofasico_regime_normal")!;
    // Pastilha de freio (87.08): PIS 7,80 + Cofins 36,00. O óleo lubrificante não é monofásico.
    expect(a).toMatchObject({ valor_base: "1200.00", valor_estimado: "43.80", confianca: "alta", tipo: "oportunidade" });
  });

  it("aponta as notas sem IBS/CBS emitidas depois de 03/08/2026", () => {
    const a = achados.find((x) => x.regra === "ibscbs_ausente")!;
    expect(a).toMatchObject({ tipo: "risco", confianca: "alta", valor_estimado: null, valor_base: "2000.00" });
    expect(a.resumo).toContain("03/08/2026");
  });
});

describe("auditor fiscal — riscos de cadastro", () => {
  const base: GrupoItens = {
    competencia: "2026-09-01", operacao: "saida", modelo: "55", consumidor_final: false, crt: "3", cfop: "5102", ncm: "84713012",
    gtin: null, cest: null, ex: null, csosn: null, cst_icms: "00", cst_pis: "01", cst_cofins: "01", cst_ibscbs: "000", cclasstrib: "000001",
    p_cbs: "0.9000", p_ibs_uf: "0.1000", p_ibs_mun: "0.0000", reducao: false, apos_ibscbs_normal: true, itens: 1, notas: 1, valor: "100",
    icms: "20", icms_st: "0", icms_st_retido: "0", pis: "0.65", cofins: "3", cbs: "0.9", ibs: "0.1",
    exemplos: [{ nota_id: "n1", numero: "1", modelo: "55", data: "2026-09-10T10:00:00-03:00", item: 1, descricao: "PRODUTO", valor: "100" }],
  };
  const rodar = (grupos: GrupoItens[]) =>
    auditar({ hoje: "2026-10-02", inicio: "2026-01-01", fim: "2026-10-01", regimeDoMes: () => "lucro_real", simples: () => null, grupos, catalogo: CATALOGO });

  it("nota correta não gera achado", () => {
    expect(rodar([base])).toEqual([]);
  });

  it("alíquota de teste diferente e NCM inválido viram riscos", () => {
    const r = rodar([{ ...base, p_cbs: "8.8000" }, { ...base, ncm: "00000000", cst_ibscbs: null, apos_ibscbs_normal: false }]);
    expect(r.map((x) => x.regra).sort()).toEqual(["ibscbs_aliquota", "ncm_invalido"]);
  });

  it("venda como ST de NCM que só foi comprado sem ST vira risco", () => {
    const compra: GrupoItens = { ...base, operacao: "entrada", cfop: "1102", cst_icms: "00", ncm: "85171231" };
    const venda: GrupoItens = { ...base, cfop: "5405", cst_icms: "60", icms: "0", ncm: "85171231" };
    const r = rodar([compra, venda]);
    expect(r.find((x) => x.regra === "st_sem_compra_st")).toMatchObject({ tipo: "risco", confianca: "conferir", valor_base: "100.00" });
  });

  it("ICMS próprio destacado em produto comprado com ST (regime normal)", () => {
    const compra: GrupoItens = { ...base, operacao: "entrada", cfop: "1403", cst_icms: "10", icms_st: "15", gtin: "7891000000001" };
    const venda: GrupoItens = { ...base, gtin: "7891000000001", icms: "18" };
    const r = rodar([compra, venda]);
    expect(r.find((x) => x.regra === "icms_st_regime_normal")).toMatchObject({ valor_estimado: "18.00", confianca: "media" });
  });
});
