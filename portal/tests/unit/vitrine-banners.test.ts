import { describe, expect, it } from "vitest";
import { horaTocantins, normalizarLinkBanner, paraCampoLocal, situacaoBanner } from "@/lib/vitrine/banners";

describe("link do banner", () => {
  it("aceita o endereço inteiro de uma página do site e guarda só o caminho", () => {
    expect(normalizarLinkBanner("https://shopluanaaraujo.com.br/c/prata-925")).toBe("/c/prata-925");
    expect(normalizarLinkBanner("https://shopluanaaraujo.com.br/c/prata-925/")).toBe("/c/prata-925");
    expect(normalizarLinkBanner("https://shopluanaaraujo.com.br/busca?q=colar+prata")).toBe("/busca?q=colar+prata");
    expect(normalizarLinkBanner("/p/0b9e3c1e-4f1a-4a57-9f55-1d2c3b4a5e6f/anel-solitario")).toBe("/p/0b9e3c1e-4f1a-4a57-9f55-1d2c3b4a5e6f/anel-solitario");
  });

  it("vazio é sem link", () => {
    expect(normalizarLinkBanner("   ")).toBeNull();
  });

  it("recusa o que não é página do site", () => {
    expect(normalizarLinkBanner("https://shopluanaaraujo.com.br/")).toBe(false);
    expect(normalizarLinkBanner("/sacola")).toBe(false);
    expect(normalizarLinkBanner("javascript:alert(1)")).toBe(false);
    expect(normalizarLinkBanner("//outro-site.com/c/x")).toBe(false);
    expect(normalizarLinkBanner("/c/Prata 925")).toBe(false);
  });
});

describe("datas do banner (hora de Tocantins)", () => {
  it("o campo do formulário vira horário com o fuso de Tocantins", () => {
    expect(horaTocantins("2026-11-20T08:00")).toBe("2026-11-20T08:00:00-03:00");
    expect(horaTocantins("")).toBeNull();
    expect(horaTocantins("20/11/2026")).toBe(false);
  });

  it("o horário gravado volta para o campo na mesma hora local", () => {
    expect(paraCampoLocal("2026-11-20T11:00:00+00:00")).toBe("2026-11-20T08:00");
    expect(paraCampoLocal(horaTocantins("2026-12-24T23:59") as string)).toBe("2026-12-24T23:59");
    expect(paraCampoLocal(null)).toBe("");
  });
});

describe("situação do banner", () => {
  const agora = Date.parse("2026-11-20T12:00:00-03:00");
  const base = { ativo: true, imagem_computador: "e/b/x/img", inicio: null, fim: null };

  it("no ar sem período, ou dentro dele", () => {
    expect(situacaoBanner(base, agora)).toBe("no_ar");
    expect(situacaoBanner({ ...base, inicio: "2026-11-20T00:00:00-03:00", fim: "2026-11-30T23:59:00-03:00" }, agora)).toBe("no_ar");
  });

  it("agendado, encerrado, desligado e sem imagem", () => {
    expect(situacaoBanner({ ...base, inicio: "2026-11-27T00:00:00-03:00" }, agora)).toBe("agendado");
    expect(situacaoBanner({ ...base, fim: "2026-11-20T12:00:00-03:00" }, agora)).toBe("encerrado");
    expect(situacaoBanner({ ...base, ativo: false }, agora)).toBe("desligado");
    expect(situacaoBanner({ ...base, imagem_computador: null }, agora)).toBe("sem_imagem");
  });
});
