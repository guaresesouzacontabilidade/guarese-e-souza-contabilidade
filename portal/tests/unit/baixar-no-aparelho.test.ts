import { describe, expect, it } from "vitest";
import { nomeDoArquivo } from "@/lib/arquivos/baixar-no-aparelho";

describe("nome do arquivo baixado no celular", () => {
  it("usa o nome do cabeçalho Content-Disposition (inline ou attachment)", () => {
    expect(nomeDoArquivo('inline; filename="NFSe-15-1234.pdf"', "https://portal/api/nfse/a/b?formato=pdf")).toBe("NFSe-15-1234.pdf");
    expect(nomeDoArquivo("attachment; filename=relatorio.xlsx", "https://portal/api/x")).toBe("relatorio.xlsx");
  });

  it("prefere o nome com acentos (filename*) quando existe", () => {
    expect(nomeDoArquivo("attachment; filename=\"Relatorio.pdf\"; filename*=UTF-8''Relat%C3%B3rio%20do%20m%C3%AAs.pdf", "https://portal/api/x")).toBe("Relatório do mês.pdf");
  });

  it("no endereço assinado do armazenamento, usa o ?download=", () => {
    const url = "https://abc.supabase.co/storage/v1/object/sign/documentos/e1/9f8a.bin?token=x&download=DEMO-ICMS%20Compra%20Goias%202026-10.xml";
    expect(nomeDoArquivo(null, url)).toBe("DEMO-ICMS Compra Goias 2026-10.xml");
  });

  it("sem cabeçalho nem ?download=, usa o nome sugerido pelo link ou o fim do caminho com extensão", () => {
    expect(nomeDoArquivo(null, "https://portal/api/x", "nota.pdf")).toBe("nota.pdf");
    expect(nomeDoArquivo(null, "https://abc.supabase.co/storage/v1/object/sign/docs/extrato%20outubro.pdf?token=1")).toBe("extrato outubro.pdf");
    expect(nomeDoArquivo(null, "https://portal/api/documentos/123/arquivo?modo=ver")).toBe("arquivo");
  });

  it("tira caracteres que não podem ir no nome do arquivo", () => {
    expect(nomeDoArquivo('attachment; filename="a/b:c*d?.pdf"', "https://portal/api/x")).toBe("a-b-c-d-.pdf");
  });
});
