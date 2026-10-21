import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { auditar, type EntradaAuditoria, type GrupoItens, type MesSimples } from "@/lib/auditor-fiscal/regras";
import { exclusaoSt, type ExclusaoSt } from "@/lib/auditor-fiscal/st-estadual";
import { cfopVendaProducaoInterna } from "@/lib/auditor-fiscal/cfop";

/**
 * Produtos que saíram da ST por regra do Tocantins (Decreto nº 6.996/2025 e
 * alterações): só a venda interna da indústria fabricante do Estado fica
 * fora da ST; a compra de outro estado continua com ST.
 */
const FONTE = { titulo: "Decreto de teste (TO)" };
const exc = (cest: string, extra: Partial<ExclusaoSt> = {}): ExclusaoSt => ({
  uf: "TO",
  item: "4.4 do Anexo XXI",
  segmento: "tintas_vernizes",
  cest,
  ncm: null,
  descricao: `CEST ${cest}`,
  condicao: null,
  somente_fabricante_uf: true,
  confianca: "conferir",
  fonte: FONTE,
  inicio: "2025-08-08",
  fim: null,
  ...extra,
});
const LISTA: ExclusaoSt[] = [
  exc("2400100"),
  exc("03", { segmento: "bebidas_frias", item: "8.29 a 8.51 do Anexo XXI", inicio: "2025-07-01" }),
  exc("200480", { segmento: "higiene_cosmeticos", item: "16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI", ncm: "9619", inicio: "2026-02-13" }),
];

let seq = 0;
function grupo(extra: Partial<GrupoItens>): GrupoItens {
  seq += 1;
  return {
    competencia: "2026-03-01", operacao: "entrada", modelo: "55", consumidor_final: false, crt: "3", cfop: "5101", ncm: "32091010",
    gtin: "7890000000017", cest: "2400100", ex: null, csosn: null, cst_icms: "00", cst_pis: "01", cst_cofins: "01", cst_ibscbs: null,
    cclasstrib: null, p_cbs: null, p_ibs_uf: null, p_ibs_mun: null, reducao: false, apos_ibscbs_normal: false, itens: 1, notas: 1,
    valor: "1000.00", icms: "200.00", icms_st: "0", icms_st_retido: "0", pis: "0", cofins: "0", cbs: "0", ibs: "0",
    exemplos: [{ nota_id: `n${seq}`, numero: String(seq), modelo: "55", data: "2026-03-10", item: 1, descricao: "TINTA ACRILICA 18L", valor: "1000.00" }],
    ...extra,
  };
}

const simples = (): MesSimples => ({ rbt12: new Decimal("300000"), anexo: "I", anexoInformado: true, mesesSemDados: [], observacao: null });

function entrada(grupos: GrupoItens[], extra: Partial<EntradaAuditoria> = {}): EntradaAuditoria {
  return {
    hoje: "2026-10-21",
    inicio: "2025-01-01",
    fim: "2026-10-01",
    regimeDoMes: () => "simples_nacional",
    simples: () => simples(),
    grupos,
    catalogo: [],
    uf: "TO",
    exclusoesSt: LISTA,
    ...extra,
  };
}

describe("ST estadual — lista e CFOP", () => {
  it("acha a exclusão pelo CEST (e NCM quando a linha pede) só dentro da vigência", () => {
    expect(exclusaoSt("2400100", "32091010", "2026-03-31", "TO", LISTA)?.segmento).toBe("tintas_vernizes");
    expect(exclusaoSt("2400100", "32091010", "2025-08-07", "TO", LISTA)).toBeNull();
    expect(exclusaoSt("0302100", "22030000", "2025-07-31", "TO", LISTA)?.segmento).toBe("bebidas_frias");
    expect(exclusaoSt("2004801", "96190000", "2026-03-31", "TO", LISTA)?.segmento).toBe("higiene_cosmeticos");
    expect(exclusaoSt("2004801", "48189090", "2026-03-31", "TO", LISTA)).toBeNull(); // NCM fora da linha
    expect(exclusaoSt("2400200", "32041100", "2026-03-31", "TO", LISTA)).toBeNull(); // corantes continuam na ST
    expect(exclusaoSt("2400100", "32091010", "2026-03-31", "GO", LISTA)).toBeNull();
    expect(exclusaoSt(null, "32091010", "2026-03-31", "TO", LISTA)).toBeNull();
  });

  it("reconhece a venda interna da produção da indústria na nota do fornecedor", () => {
    expect(cfopVendaProducaoInterna("5101") && cfopVendaProducaoInterna("5401")).toBe(true);
    expect(cfopVendaProducaoInterna("5102")).toBe(false); // revenda
    expect(cfopVendaProducaoInterna("6101")).toBe(false); // outro estado
    expect(cfopVendaProducaoInterna("5405")).toBe(false);
  });
});

describe("ST estadual — achados do auditor (Tocantins)", () => {
  it("não acusa ICMS-ST pago de novo no DAS como certo quando o produto também veio sem ST da indústria do Estado", () => {
    const grupos = [
      // Compra antiga de outro estado com ST
      grupo({ competencia: "2025-05-01", cfop: "6403", cst_icms: "10", icms_st: "120.00" }),
      // Compra da indústria do TO, já fora da ST
      grupo({ competencia: "2026-03-01", cfop: "5101" }),
      // Venda tributada no Simples
      grupo({ competencia: "2026-03-01", operacao: "saida", cfop: "5102", cst_icms: null, csosn: "102", valor: "1500.00", icms: "0" }),
    ];
    const st = auditar(entrada(grupos)).find((a) => a.regra === "st_simples");
    expect(st?.confianca).toBe("conferir");
    expect(st?.referencias[0].motivo).toMatch(/também foi comprado sem ST de indústria do TO/);
  });

  it("sem a regra estadual, a mesma venda continua com confiança alta", () => {
    const grupos = [
      grupo({ competencia: "2025-05-01", cfop: "6403", cst_icms: "10", icms_st: "120.00" }),
      grupo({ competencia: "2026-03-01", cfop: "5101" }),
      grupo({ competencia: "2026-03-01", operacao: "saida", cfop: "5102", cst_icms: null, csosn: "102", valor: "1500.00", icms: "0" }),
    ];
    const st = auditar(entrada(grupos, { exclusoesSt: [] })).find((a) => a.regra === "st_simples");
    expect(st?.confianca).toBe("alta");
  });

  it("aponta o ICMS-ST retido pela indústria do Estado depois da exclusão (oportunidade), mas não a compra de outro estado", () => {
    const grupos = [
      grupo({ competencia: "2026-03-01", cfop: "5401", cst_icms: "10", icms_st: "70.00" }),
      grupo({ competencia: "2026-03-01", cfop: "6401", cst_icms: "10", icms_st: "90.00", gtin: "7890000000024" }),
      // Agosto/2025: a exclusão começou no dia 8, o mês não conta inteiro
      grupo({ competencia: "2025-08-01", cfop: "5401", cst_icms: "10", icms_st: "50.00" }),
    ];
    const achados = auditar(entrada(grupos)).filter((a) => a.regra === "st_retida_fora_da_st");
    expect(achados).toHaveLength(1);
    expect(achados[0].competencia).toBe("2026-03-01");
    expect(achados[0].valor_estimado).toBe("70.00");
    expect(achados[0].tipo).toBe("oportunidade");
    expect(achados[0].confianca).toBe("conferir");
    expect(achados[0].titulo).toMatch(/indústria do TO/);
    expect(achados[0].fontes.map((f) => f.titulo)).toContain("Decreto de teste (TO)");
  });

  it("aponta a venda como ST de produto que já vem sem ST da indústria do Estado (risco) e estima o ICMS do DAS", () => {
    const grupos = [
      grupo({ competencia: "2025-05-01", cfop: "6403", cst_icms: "10", icms_st: "120.00" }),
      grupo({ competencia: "2026-03-01", cfop: "5101" }),
      grupo({ competencia: "2026-03-01", operacao: "saida", cfop: "5405", cst_icms: null, csosn: "500", valor: "1500.00", icms: "0" }),
    ];
    const achados = auditar(entrada(grupos));
    const risco = achados.find((a) => a.regra === "venda_st_fora_da_st");
    expect(risco?.tipo).toBe("risco");
    expect(risco?.resumo).toMatch(/CSOSN 102/);
    // 1.500 × 5,32% (RBT12 300 mil, 2ª faixa) × 34% = 27,13
    expect(risco?.memoria.at(-1)?.valor).toMatch(/27,13/);
    // O achado geral não se repete (houve compra com ST do mesmo NCM)
    expect(achados.some((a) => a.regra === "st_sem_compra_st")).toBe(false);
  });

  it("quando o NCM só foi comprado sem ST, fica só o achado geral", () => {
    const grupos = [
      grupo({ competencia: "2026-03-01", cfop: "5101" }),
      grupo({ competencia: "2026-03-01", operacao: "saida", cfop: "5405", cst_icms: null, csosn: "500", valor: "1500.00", icms: "0" }),
    ];
    const regras = auditar(entrada(grupos)).map((a) => a.regra);
    expect(regras).toContain("st_sem_compra_st");
    expect(regras).not.toContain("venda_st_fora_da_st");
  });

  it("lembra do estoque na data da mudança quando houve compra com ST da indústria do Estado nos 6 meses anteriores", () => {
    const grupos = [
      grupo({ competencia: "2025-11-01", cfop: "5401", cst_icms: "10", icms_st: "70.00", cest: "2004800", ncm: "96190000", gtin: "7890000000031" }),
      // Compra de outro estado não entra no estoque da regra estadual
      grupo({ competencia: "2025-12-01", cfop: "6401", cst_icms: "10", icms_st: "90.00", cest: "2004800", ncm: "96190000", gtin: "7890000000048" }),
    ];
    const estoque = auditar(entrada(grupos)).filter((a) => a.regra === "estoque_saida_st");
    expect(estoque).toHaveLength(1);
    expect(estoque[0].competencia).toBe("2026-02-01");
    expect(estoque[0].tipo).toBe("informativo");
    expect(estoque[0].valor_base).toBe("1000.00");
    expect(estoque[0].resumo).toMatch(/art\. 46-D do RICMS\/TO/);
  });

  it("empresa de outro estado não recebe os achados da regra do Tocantins", () => {
    const grupos = [grupo({ competencia: "2026-03-01", cfop: "5401", cst_icms: "10", icms_st: "70.00" })];
    const regras = auditar(entrada(grupos, { uf: "GO" })).map((a) => a.regra);
    expect(regras).not.toContain("st_retida_fora_da_st");
  });
});
