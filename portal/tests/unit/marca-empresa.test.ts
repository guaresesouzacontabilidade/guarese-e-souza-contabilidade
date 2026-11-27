import { describe, expect, it } from "vitest";
import { gerarPdf, type Cabecalho } from "@/lib/relatorios/pdf";
import { gerarPdfOrdem, type OrdemPdf } from "@/lib/gestao/pdf-carregamento";
import { modeloEmail } from "@/lib/email/modelo";

/** Valor de um campo das propriedades do PDF (Author, Creator...), que o pdfkit grava como objeto à parte. */
function campoInfo(pdf: string, campo: string): string | null {
  const ref = new RegExp(`/${campo} (\\d+) 0 R`).exec(pdf);
  if (!ref) return null;
  return new RegExp(`\\n${ref[1]} 0 obj\\n\\((.*)\\)\\nendobj`).exec(pdf)?.[1] ?? null;
}

/**
 * Documento feito na empresa do cliente (relatório, ordem de carregamento,
 * e-mail da nota ao comprador) sai só com a marca da própria empresa. O
 * documento do escritório (estudo tributário, relatório do auditor) continua
 * com a marca do escritório.
 */

const cabecalho: Cabecalho = {
  titulo: "Relatorio gerencial",
  subtitulo: "Outubro de 2026",
  empresa: { nome: "Varejao Teste Ltda", documento: "12.345.678/0001-95", endereco: "Rua A, 10, Centro", contato: "(63) 3363-0000" },
  escritorio: { nome: "Guarese's ON", razao: "Escritorio de teste", cnpj: "00.000.000/0001-00", email: null, endereco: "" },
  situacao: "revisado",
  geradoEm: "2026-11-25T12:00:00.000Z",
};

const ordem: OrdemPdf = {
  numero: 7,
  status: "aberta",
  data_emissao: "2026-11-25",
  validade: null,
  local_carregamento: "Patio",
  destinatario_nome: "Comprador Teste",
  destinatario_documento: null,
  local_descarga: null,
  produto_descricao: "Tabua de pinus",
  unidade: "m3",
  quantidade: 10,
  peso_previsto_kg: null,
  contrato: null,
  frete_por_conta: 0,
  transportador_nome: null,
  transportador_documento: null,
  rntrc: null,
  motorista_nome: null,
  motorista_cpf: null,
  placa: null,
  placa_uf: null,
  placas_reboque: [],
  observacoes: null,
  peso_bruto_kg: null,
  tara_kg: null,
  peso_liquido_kg: null,
  umidade: null,
  impureza: null,
  ticket_balanca: null,
  carregado_em: null,
  motivo_cancelamento: null,
};

describe("marca nos documentos da empresa", () => {
  it("relatório da empresa leva o nome da empresa como autor e nada do escritório", async () => {
    const texto = (await gerarPdf(cabecalho, [{ text: "Conteudo" }])).toString("latin1");
    expect(texto.startsWith("%PDF")).toBe(true);
    expect(campoInfo(texto, "Author")).toBe("Varejao Teste Ltda");
    expect(campoInfo(texto, "Creator")).toBe("Varejao Teste Ltda");
    expect(texto).not.toMatch(/Guarese/i);
  });

  it("documento do escritório (marca escritorio) continua com o escritório como autor", async () => {
    const texto = (await gerarPdf({ ...cabecalho, marca: "escritorio" }, [{ text: "Conteudo" }])).toString("latin1");
    expect(campoInfo(texto, "Author")).toMatch(/^Guarese/);
  });

  it("ordem de carregamento sai com a empresa e sem o nome do portal", async () => {
    const pdf = await gerarPdfOrdem({
      ordem,
      pesoKgUnidade: null,
      vendedor: { razao: "Varejao Teste Ltda", documento: "12345678000195", inscricao: null },
      nota: null,
      mensagem: null,
      demonstracao: false,
      logo: null,
      geradoEm: "2026-11-25T12:00:00.000Z",
    });
    const texto = pdf.toString("latin1");
    expect(campoInfo(texto, "Creator")).toBe("Varejao Teste Ltda");
    expect(texto).not.toMatch(/Guarese/i);
  });

  it("e-mail mandado em nome da empresa não leva o cabeçalho nem o rodapé do escritório", () => {
    const { html, texto } = modeloEmail({
      titulo: "NF-e de Varejao",
      paragrafos: ["Segue a nota."],
      aviso: "Mensagem automática enviada a pedido de Varejao.",
      remetente: { nome: "Varejao", contatos: ["(63) 3363-0000"] },
    });
    expect(html).toContain("Varejao");
    expect(html).not.toMatch(/Guarese|CONTABILIDADE/i);
    expect(texto).not.toMatch(/Guarese/i);
  });
});
