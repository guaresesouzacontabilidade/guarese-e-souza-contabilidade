import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { linhasDoTextoCielo, lerRelatorioPdf, PdfNaoReconhecido } from "@/lib/maquininhas/pdf";
import { assinaturaCabecalho, detectarCabecalho, lerVendas, normalizarModalidade, sugerirMapeamento } from "@/lib/maquininhas/leitura";

/** Texto como sai da "Lista de Vendas" da Cielo em PDF (valores fictícios). */
const LINHAS_CIELO = [
  "Esse relatório não deve ser utilizado como documento fiscal.",
  "Lista de Vendas",
  "Totalizador",
  "Filtros:",
  "Data da venda: 01/10/2026 à 15/10/2026",
  "Visualizar por: Forma de pagamento",
  "Status: Aprovada",
  "4 9 R$ 2.000,00 -R$ 40,00 R$ 1.960,00",
  "Data da venda Forma de pagamento Quantidade de vendas Valor bruto Valor Taxa/Tarifa Valor líquido",
  "06/10/2026 Crédito à vista 2 R$ 1.000,00 -R$ 32,20 R$ 967,80",
  "10/10/2026 Débito à vista 3 R$ 500,00 -R$ 4,55 R$ 495,45",
  "10/10/2026 Débito pré-pago 1 R$ 100,00 -R$ 0,91 R$ 99,09",
  "12/10/2026 Crédito pré-pago 3 R$ 400,00 -R$ 2,34 R$ 397,66",
  "Consolidado de vendas Cielo",
];

describe("maquininhas: Lista de Vendas da Cielo em PDF", () => {
  it("reconhece o texto e monta as linhas com cabeçalho fixo", () => {
    const r = linhasDoTextoCielo(LINHAS_CIELO.join("\n"));
    expect(r && "linhas" in r).toBe(true);
    const { linhas } = r as { linhas: string[][] };
    expect(linhas).toHaveLength(5);
    expect(linhas[1]).toEqual(["06/10/2026", "Crédito à vista", "2", "1.000,00", "-32,20", "967,80", ""]);
    // A linha do totalizador (sem data) não entra
    expect(linhas.some((l) => l[0] === "4")).toBe(false);
  });

  it("o formato já vem cadastrado para o escritório (mesma assinatura da migração)", () => {
    const { linhas } = linhasDoTextoCielo(LINHAS_CIELO.join("\n")) as { linhas: string[][] };
    const migracao = readFileSync("supabase/migrations/20261016005400_maquininhas_pdf_quantidade.sql", "utf8");
    expect(migracao).toContain(`'${assinaturaCabecalho(linhas[0])}'`);
  });

  it("lê as vendas: quantidade por linha, pré-pago de débito e de crédito, taxa pelo líquido", () => {
    const { linhas } = linhasDoTextoCielo(LINHAS_CIELO.join("\n")) as { linhas: string[][] };
    const cab = detectarCabecalho(linhas);
    expect(cab).toBe(0);
    const m = sugerirMapeamento(linhas[0], cab);
    expect(m).toMatchObject({ data: 0, modalidade: 1, quantidade: 2, bruto: 3, liquido: 5 });
    const { vendas, invalidas } = lerVendas(linhas, m, "cartao");
    expect(invalidas).toEqual([]);
    expect(vendas.map((v) => [v.modalidade, v.quantidade, v.valor_bruto, v.valor_taxa])).toEqual([
      ["credito_vista", 2, "1000.00", "32.20"],
      ["debito", 3, "500.00", "4.55"],
      ["debito", 1, "100.00", "0.91"],
      ["credito_vista", 3, "400.00", "2.34"],
    ]);
  });

  it("lista por bandeira não diz se é débito ou crédito: pede a visualização por forma de pagamento", () => {
    const texto = LINHAS_CIELO.join("\n").replace("Visualizar por: Forma de pagamento", "Visualizar por: Bandeira");
    expect(linhasDoTextoCielo(texto)).toMatchObject({ erro: expect.stringContaining("Forma de pagamento") });
    expect(linhasDoTextoCielo("Nota fiscal qualquer")).toBeNull();
  });

  it("lê o PDF de verdade (texto extraído do arquivo)", async () => {
    const pm = await carregarPdfMake();
    const pdf = await pm.createPdf({ content: LINHAS_CIELO.map((t) => ({ text: t })) }).getBuffer();
    const r = await lerRelatorioPdf(new Uint8Array(pdf));
    expect(r.adquirente).toBe("cielo");
    expect(r.linhas.slice(1).map((l) => l[1])).toEqual(["Crédito à vista", "Débito à vista", "Débito pré-pago", "Crédito pré-pago"]);
    const outro = await pm.createPdf({ content: [{ text: "Boleto de cobrança" }] }).getBuffer();
    await expect(lerRelatorioPdf(new Uint8Array(outro))).rejects.toBeInstanceOf(PdfNaoReconhecido);
  });

  it("modalidade do pré-pago segue o débito ou o crédito; pré-pago sem indicação continua pré-pago", () => {
    expect(normalizarModalidade("Débito pré-pago", 1, "cartao")).toBe("debito");
    expect(normalizarModalidade("Crédito pré-pago", 1, "cartao")).toBe("credito_vista");
    expect(normalizarModalidade("Pré-pago", 1, "cartao")).toBe("pre_pago");
  });
});
