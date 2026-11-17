import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { gerarPdfRecibo, nomeArquivoRecibo, numeroRecibo, type ReciboPdf } from "@/lib/recibos/pdf";

/** Recibo de exemplo (dados fictícios de pagador; escritório como no cadastro). */
const RECIBO: ReciboPdf = {
  ano: 2026,
  numero: 7,
  valor: "810.00",
  pagador: { nome: "Condomínio Residencial Exemplo", documento: "11444777000161" },
  referencia: "Honorários contábeis",
  competencia: "2026-11-01",
  descricao: null,
  data: "2026-11-15",
  cidade: "Porto Nacional",
  uf: "TO",
  formaPagamento: null,
  nfseNumero: null,
  observacao: null,
  emitente: {
    razao_social: "Guarese's ON Soluções Empresariais Ltda",
    nome_fantasia: "Guarese's ON Contabilidade",
    cnpj: "62935399000150",
    endereco: "Praça do Centenário, nº 713, Centro, Porto Nacional/TO",
    cep: "77500000",
    telefone: "63992969763",
    email: "contato@exemplo.com.br",
    contador_nome: "Contador Exemplo",
    contador_crc: "CRC TO 000000-O",
    cidade: "Porto Nacional",
    uf: "TO",
  },
  logo: null,
  situacao: "emitido",
};

async function textoDoPdf(pdf: Buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { texto: text.replace(/\s+/g, " "), paginas: totalPages };
}

describe("recibo de honorários em PDF", () => {
  it("numera com três dígitos e monta o nome do arquivo", () => {
    expect(numeroRecibo({ ano: 2026, numero: 7 })).toBe("007/2026");
    expect(numeroRecibo({ ano: 2027, numero: 1234 })).toBe("1234/2027");
    expect(nomeArquivoRecibo(RECIBO)).toBe("Recibo_007_2026_Residencial_Exemplo_Novembro.pdf");
    expect(nomeArquivoRecibo({ ...RECIBO, pagador: { nome: "CONDOMÍNIO LAKE SIDE RESIDENCE", documento: null } })).toBe(
      "Recibo_007_2026_Lake_Side_Residence_Novembro.pdf",
    );
  });

  it("gera uma página com o timbre, o valor por extenso e a assinatura", async () => {
    const pdf = await gerarPdfRecibo(RECIBO);
    if (process.env.RECIBO_AMOSTRA) writeFileSync(process.env.RECIBO_AMOSTRA, pdf);
    const { texto, paginas } = await textoDoPdf(pdf);
    expect(paginas).toBe(1);
    expect(texto).toContain("RECIBO Nº 007/2026");
    expect(texto).toContain("VALOR: R$ 810,00");
    expect(texto).toContain("CONTADOR EXEMPLO");
    expect(texto).toContain("CRC TO 000000-O");
    expect(texto).toContain("CNPJ: 62.935.399/0001-50");
    expect(texto).toContain("CONDOMÍNIO RESIDENCIAL EXEMPLO");
    expect(texto).toContain("CNPJ sob nº 11.444.777/0001-61");
    expect(texto).toContain("R$ 810,00 (oitocentos e dez reais)");
    expect(texto).toContain("competência de novembro de 2026");
    expect(texto).toContain("Competência: novembro/2026");
    expect(texto).toContain("Porto Nacional/TO, 15 de novembro de 2026.");
    expect(texto).toContain("firmamos o presente recibo");
    expect(texto).not.toContain("CANCELADO");
  });

  it("traz forma de pagamento, NFS-e, pagador com CPF e marca d'água quando cancelado", async () => {
    const pdf = await gerarPdfRecibo({
      ...RECIBO,
      valor: "1500.5",
      pagador: { nome: "Fulana de Tal", documento: "52998224725" },
      formaPagamento: "pix",
      nfseNumero: "123",
      observacao: "Pagamento referente ao contrato de 2026.",
      situacao: "cancelado",
      motivoCancelamento: "Valor lançado errado",
    });
    const { texto } = await textoDoPdf(pdf);
    expect(texto).toContain("CPF sob nº 529.982.247-25");
    expect(texto).toContain("R$ 1.500,50 (mil e quinhentos reais e cinquenta centavos)");
    expect(texto).toContain("pago por PIX");
    expect(texto).toContain("NFS-e nº 123");
    expect(texto).toContain("Pagamento referente ao contrato de 2026.");
    expect(texto).toContain("CANCELADO");
    expect(texto).toContain("Recibo cancelado: Valor lançado errado.");
  });

  it("usa o texto próprio do 'referente a' quando informado", async () => {
    const { texto } = await textoDoPdf(
      await gerarPdfRecibo({ ...RECIBO, competencia: null, referencia: "Abertura de empresa", descricao: "serviço de abertura da empresa." }),
    );
    expect(texto).toContain("referente ao serviço de abertura da empresa.");
    expect(texto).not.toContain("Competência:");
  });
});
