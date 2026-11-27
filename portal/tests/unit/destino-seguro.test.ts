import { describe, expect, it } from "vitest";
import { destinoSeguro } from "@/lib/destino-seguro";

describe("destinoSeguro (volta para onde estava depois do login)", () => {
  it("aceita páginas do próprio portal, com filtros", () => {
    expect(destinoSeguro("/painel")).toBe("/painel");
    expect(destinoSeguro("/e/123/documentos?mes=2026-10#lista")).toBe("/e/123/documentos?mes=2026-10#lista");
  });

  it("usa o padrão quando não há destino", () => {
    expect(destinoSeguro(null)).toBe("/painel");
    expect(destinoSeguro("", "/conta")).toBe("/conta");
  });

  it.each([
    "https://site-falso.com",
    "//site-falso.com",
    "/\\site-falso.com",
    "/\t/site-falso.com",
    "/\n/site-falso.com",
    "/\r/site-falso.com",
    "/ /site-falso.com",
    "\\\\site-falso.com",
    "javascript:alert(1)",
    "/%09/site-falso.com".replace("%09", "\u0009"),
    "painel",
  ])("recusa %j", (destino) => {
    expect(destinoSeguro(destino)).toBe("/painel");
  });

  it("mantém códigos escritos com %, que continuam dentro do portal", () => {
    expect(destinoSeguro("/%2F%2Fsite-falso.com")).toBe("/%2F%2Fsite-falso.com");
  });
});
