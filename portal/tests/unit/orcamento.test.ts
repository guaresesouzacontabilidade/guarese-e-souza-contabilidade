import { describe, expect, it } from "vitest";
import { linkPublicoOrcamento, linkWhatsAppOrcamento, mensagemOrcamento, telefoneComDdd } from "@/lib/gestao/orcamento-link";

describe("orçamento pelo WhatsApp", () => {
  it("monta o link do orçamento sem barra dobrada", () => {
    expect(linkPublicoOrcamento("https://portal.exemplo.com.br/", "abc123def456ghi7")).toBe("https://portal.exemplo.com.br/orcamento/abc123def456ghi7");
  });

  it("aceita telefone com DDD, com ou sem 55 e máscara", () => {
    expect(telefoneComDdd("(63) 99999-1234")).toBe("63999991234");
    expect(telefoneComDdd("+55 63 3215-1234")).toBe("6332151234");
    expect(telefoneComDdd("99999-1234")).toBeNull();
    expect(telefoneComDdd("")).toBeNull();
    expect(telefoneComDdd(null)).toBeNull();
  });

  it("mensagem com o primeiro nome, o total, a validade e o link", () => {
    const m = mensagemOrcamento({
      cliente: "João Carlos Teste",
      numero: 12,
      loja: "Varejão das Madeiras ",
      total: "1250.5",
      validade: "2026-12-10",
      link: "https://portal.exemplo.com.br/orcamento/abc",
    });
    expect(m).toContain("Olá, João!");
    expect(m).toContain("orçamento nº 12 da Varejão das Madeiras.");
    expect(m).toMatch(/R\$\s?1\.250,50/);
    expect(m).toContain("válido até 10/12/2026");
    expect(m).toContain("https://portal.exemplo.com.br/orcamento/abc");
    expect(m).not.toContain("Carlos");
  });

  it("sem nome do cliente, cumprimenta sem nome", () => {
    expect(mensagemOrcamento({ cliente: null, numero: 1, loja: "Loja", total: 10, validade: null, link: "x" })).toMatch(/^Olá! Segue/);
  });

  it("com telefone abre a conversa do cliente; sem telefone deixa escolher o contato", () => {
    expect(linkWhatsAppOrcamento("63999991234", "oi & tchau")).toBe("https://wa.me/5563999991234?text=oi%20%26%20tchau");
    expect(linkWhatsAppOrcamento(null, "oi")).toBe("https://wa.me/?text=oi");
    expect(linkWhatsAppOrcamento("123", "oi")).toBe("https://wa.me/?text=oi");
  });
});
