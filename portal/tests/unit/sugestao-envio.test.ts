import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { combinarSugestoes, competenciaNoNome, sugerirPorConteudo, sugerirPorNome } from "@/lib/documentos/sugestao";

const fixture = (n: string) => readFileSync(resolve(__dirname, "../fixtures", n), "latin1");

describe("competência pelo nome do arquivo", () => {
  it("reconhece formatos comuns", () => {
    expect(competenciaNoNome("extrato_09-2026.pdf")).toBe("2026-09");
    expect(competenciaNoNome("Extrato 2026.08 BB.ofx")).toBe("2026-08");
    expect(competenciaNoNome("fatura setembro de 2026.pdf")).toBe("2026-09");
    expect(competenciaNoNome("guia DAS set26.pdf")).toBe("2026-09");
    expect(competenciaNoNome("nota 12345.pdf")).toBeUndefined();
  });
  it("não aceita anos impossíveis", () => {
    expect(competenciaNoNome("contrato 13-2026.pdf")).toBeUndefined();
    expect(competenciaNoNome("plano 2099-01.pdf")).toBeUndefined();
  });
});

describe("categoria pelo nome", () => {
  it("identifica tipos frequentes", () => {
    expect(sugerirPorNome("Comprovante PIX fornecedor.jpg")?.categoria).toBe("comprovante");
    expect(sugerirPorNome("DAS 09-2026.pdf")?.categoria).toBe("guia_imposto");
    expect(sugerirPorNome("Relatório Stone setembro.xlsx")?.categoria).toBe("relatorio_maquininha");
    expect(sugerirPorNome("Fatura cartão Visa.pdf")?.categoria).toBe("extrato_cartao");
    expect(sugerirPorNome("holerites.pdf")?.categoria).toBe("folha_pagamento");
    expect(sugerirPorNome("qualquer.ofx")?.categoria).toBe("extrato_bancario");
    expect(sugerirPorNome("IMG_2034.jpg")).toBeNull();
  });
});

describe("sugestão pelo conteúdo", () => {
  it("NF-e emitida pela empresa é de saída; recebida é de entrada", () => {
    const saida = fixture("nfe-saida.xml");
    const emitente = /<emit>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/.exec(saida)![1];
    expect(sugerirPorConteudo("a.xml", saida, emitente)?.categoria).toBe("nfe_saida_xml");
    const entrada = fixture("nfe-entrada.xml");
    const dest = /<dest>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/.exec(entrada)![1];
    expect(sugerirPorConteudo("b.xml", entrada, dest)?.categoria).toBe("nfe_entrada_xml");
  });
  it("nota de terceiros não recebe categoria (pede confirmação)", () => {
    const s = sugerirPorConteudo("a.xml", fixture("nfe-saida.xml"), "00000000000191");
    expect(s?.categoria).toBeUndefined();
    expect(s?.competencia).toMatch(/^\d{4}-\d{2}$/);
  });
  it("OFX traz o período do extrato", () => {
    const s = sugerirPorConteudo("extrato.ofx", fixture("extrato-bb.ofx"), "");
    expect(s?.categoria).toBe("extrato_bancario");
    expect(s?.competencia).toBe("2026-09");
  });
  it("conteúdo tem prioridade sobre o nome", () => {
    const s = combinarSugestoes({ categoria: "extrato_bancario", motivo: "conteúdo" }, { categoria: "comprovante", competencia: "2026-01", motivo: "nome" });
    expect(s).toEqual({ categoria: "extrato_bancario", competencia: "2026-01", motivo: "conteúdo" });
  });
});
