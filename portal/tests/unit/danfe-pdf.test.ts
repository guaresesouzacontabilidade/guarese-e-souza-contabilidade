import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { DanfeIlegivel, lerDanfePdf } from "@/lib/gestao/danfe-pdf";
import { gerarDanfe } from "@/lib/nfe-emissao/danfe";
import { lerXmlFiscal, type NotaLida } from "@/lib/fiscal/xml";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { dvChave } from "@/lib/fiscal/chave";
import { danfeFicticio, type ItemDanfeFicticio } from "../apoio/notas-ficticias";

/**
 * Leitura do DANFE em PDF: o que sai do PDF tem de ser igual ao XML da nota
 * (DANFE gerado pelo próprio portal) e também ler o leiaute de outros
 * sistemas (rótulos em duas linhas, coluna de desconto, descrição quebrada,
 * várias páginas, chave sem espaços). Se a conferência não bate, aponta o
 * problema; PDF sem texto ou sem chave é recusado.
 */

const DEST = "11222333000181";

function nota(arquivo: string): { xml: string; lida: NotaLida } {
  const xml = readFileSync(`tests/fixtures/${arquivo}`, "utf8");
  const r = lerXmlFiscal(xml, { documento: "" });
  if (!r.sucesso || r.dados.tipo !== "nota") throw new Error(`fixture inválida: ${arquivo}`);
  return { xml, lida: r.dados };
}

describe("DANFE gerado pelo portal × XML da nota", () => {
  for (const arquivo of ["nfe-compra-farmacia.xml", "nfe-venda-autopecas.xml", "nfe-entrada.xml"]) {
    it(`lê ${arquivo} igual ao XML`, async () => {
      const { xml, lida } = nota(arquivo);
      const pdf = await gerarDanfe(xml);
      const r = await lerDanfePdf(new Uint8Array(pdf), { documentoEmpresa: lida.destinatario_documento ?? "" });
      expect(r.problemas).toEqual([]);
      expect(r.chave).toBe(lida.chave_acesso);
      expect(r.numero).toBe(String(Number(lida.numero)));
      expect(r.serie).toBe(String(Number(lida.serie)));
      expect(r.emitente_documento).toBe(lida.emitente_documento);
      expect(r.emitente_nome).toBe(lida.emitente_nome);
      expect(r.data_emissao).toBe(lida.data_emissao?.slice(0, 10));
      expect(new Decimal(r.valor_produtos!).eq(lida.valor_produtos!)).toBe(true);
      expect(new Decimal(r.valor_total!).eq(lida.valor_total!)).toBe(true);
      expect(r.empresa_no_documento).toBe(true);
      expect(r.itens).toHaveLength(lida.itens.length);
      r.itens.forEach((it, k) => {
        const x = lida.itens[k];
        expect(it.codigo).toBe(x.codigo);
        expect(it.descricao).toBe(x.descricao);
        expect(it.ncm).toBe(x.ncm);
        expect(it.cfop).toBe(x.cfop);
        expect(it.unidade).toBe(x.unidade);
        expect(new Decimal(it.quantidade).eq(x.quantidade!)).toBe(true);
        expect(new Decimal(it.valor_total).eq(x.valor_total!)).toBe(true);
      });
    }, 30_000);
  }

  it("avisa quando o CNPJ da empresa não aparece na nota", async () => {
    const { xml } = nota("nfe-compra-farmacia.xml");
    const r = await lerDanfePdf(new Uint8Array(await gerarDanfe(xml)), { documentoEmpresa: "99888777000101" });
    expect(r.empresa_no_documento).toBe(false);
  }, 30_000);
});

// -----------------------------------------------------------------------------
// DANFE de "outro sistema" (leiaute diferente do portal)
// -----------------------------------------------------------------------------
const BASE_CHAVE = `1726094455566600017255002000012345100012345`;
const CHAVE = BASE_CHAVE + String(dvChave(BASE_CHAVE));

function danfeOutroSistema(itens: ItemDanfeFicticio[], opcoes: { totalProdutos: string; quebraPagina?: number; chave?: string }) {
  return danfeFicticio({ chave: opcoes.chave ?? CHAVE, destinatario: "11.222.333/0001-81", itens, totalProdutos: opcoes.totalProdutos, quebraPagina: opcoes.quebraPagina });
}

const ITENS: ItemDanfeFicticio[] = [
  { cod: "7001", desc: "PARAFUSO SEXTAVADO ZINCADO 1/4 X 2 POLEGADAS CAIXA COM 100 UNIDADES", ncm: "73181500", cst: "0102", cfop: "5102", un: "CX", qtd: "12,5000", vun: "3,9900", vtot: "49,88", vdesc: "1,00" },
  { cod: "7002", desc: "PORCA 1/4", ncm: "73181600", cst: "0102", cfop: "5102", un: "UN", qtd: "1.000,0000", vun: "0,1200", vtot: "120,00", vdesc: "0,00" },
  { cod: "AB-9", desc: "ARRUELA LISA", ncm: "73182200", cst: "0500", cfop: "5405", un: "KG", qtd: "2,3500", vun: "18,0000", vtot: "42,30", vdesc: "0,00" },
];

describe("DANFE de outro sistema", () => {
  it("lê rótulos em duas linhas, desconto, descrição quebrada e chave sem espaços", async () => {
    const pdf = await danfeOutroSistema(ITENS, { totalProdutos: "212,18" });
    const r = await lerDanfePdf(new Uint8Array(pdf), { documentoEmpresa: DEST });
    expect(r.problemas).toEqual([]);
    expect(r.chave).toBe(CHAVE);
    expect(r.numero).toBe("12345");
    expect(r.serie).toBe("2");
    expect(r.emitente_documento).toBe("44555666000172");
    expect(r.emitente_nome).toBeNull();
    expect(r.data_emissao).toBe("2026-09-15");
    expect(r.valor_produtos).toBe("212.18");
    expect(r.empresa_no_documento).toBe(true);
    expect(r.itens.map((i) => [i.codigo, i.descricao, i.ncm, i.cfop, i.unidade, i.quantidade, i.valor_unitario, i.valor_total, i.valor_desconto])).toEqual([
      ["7001", "PARAFUSO SEXTAVADO ZINCADO 1/4 X 2 POLEGADAS CAIXA COM 100 UNIDADES", "73181500", "5102", "CX", "12.5", "3.99", "49.88", "1"],
      ["7002", "PORCA 1/4", "73181600", "5102", "UN", "1000", "0.12", "120", null],
      ["AB-9", "ARRUELA LISA", "73182200", "5405", "KG", "2.35", "18", "42.3", null],
    ]);
  }, 30_000);

  it("lê os itens que continuam na página seguinte", async () => {
    const pdf = await danfeOutroSistema(ITENS, { totalProdutos: "212,18", quebraPagina: 2 });
    const r = await lerDanfePdf(new Uint8Array(pdf), { documentoEmpresa: DEST });
    expect(r.problemas).toEqual([]);
    expect(r.itens.map((i) => i.codigo)).toEqual(["7001", "7002", "AB-9"]);
  }, 30_000);

  it("aponta quando a soma dos itens não bate com o total dos produtos", async () => {
    const pdf = await danfeOutroSistema(ITENS, { totalProdutos: "300,00" });
    const r = await lerDanfePdf(new Uint8Array(pdf), { documentoEmpresa: DEST });
    expect(r.problemas.join(" ")).toMatch(/soma dos itens lidos \(R\$ 212,18\) não bate com o total dos produtos da nota \(R\$ 300,00\)/);
  }, 30_000);

  it("aponta item com quantidade × valor unitário diferente do total", async () => {
    const errado = [{ ...ITENS[1], vtot: "150,00" }];
    const pdf = await danfeOutroSistema(errado, { totalProdutos: "150,00" });
    const r = await lerDanfePdf(new Uint8Array(pdf), { documentoEmpresa: DEST });
    expect(r.problemas.join(" ")).toMatch(/item 1 \(PORCA 1\/4\): quantidade × valor unitário não bate/);
  }, 30_000);

  it("recusa PDF sem a chave de acesso", async () => {
    const pdf = await danfeOutroSistema(ITENS, { totalProdutos: "212,18", chave: "1234 5678" });
    await expect(lerDanfePdf(new Uint8Array(pdf), { documentoEmpresa: DEST })).rejects.toThrow(/chave de acesso/);
  }, 30_000);

  it("recusa PDF sem texto (imagem digitalizada)", async () => {
    const pm = await carregarPdfMake();
    const pdf = await pm.createPdf({ content: [{ canvas: [{ type: "rect", x: 0, y: 0, w: 200, h: 100, color: "#888" }] }] }).getBuffer();
    await expect(lerDanfePdf(new Uint8Array(pdf), { documentoEmpresa: DEST })).rejects.toBeInstanceOf(DanfeIlegivel);
  }, 30_000);

  it("recusa arquivo que não é PDF", async () => {
    await expect(lerDanfePdf(new TextEncoder().encode("não sou um pdf"), { documentoEmpresa: DEST })).rejects.toThrow(/Não consegui abrir este PDF/);
  });
});
