import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import base from "@/lib/suporte/base-guia.json";
import { atalhosParaPergunta, IndiceGuia, raiz, resumo, sugestoesDaTela, termos } from "@/lib/suporte/busca";
import { extrairBase, type EntradaGuia } from "@/lib/suporte/guia";

const BASE = base as EntradaGuia[];
const indice = new IndiceGuia(BASE);
const titulos = (pergunta: string, publicos: ("todos" | "cliente" | "equipe")[] = ["todos", "cliente"]) =>
  indice.buscar(pergunta, publicos, 3).map((r) => r.entrada.titulo);

describe("base do suporte (guia de uso)", () => {
  it("está em dia com o guia (rode npm run suporte:base depois de mudar o guia)", () => {
    expect(extrairBase(readFileSync("docs/GUIA-DE-USO.md", "utf8"))).toEqual(BASE);
  });

  it("separa as seções, os itens em negrito e as perguntas frequentes; a parte da equipe é só da equipe", () => {
    expect(BASE.length).toBeGreaterThan(150);
    expect(BASE.some((e) => e.titulo === "Ordens de serviço (esteira de serviços) › Pausar")).toBe(true);
    expect(BASE.some((e) => e.secao === "Perguntas frequentes" && e.titulo.endsWith("O cliente pode ver dados de outra empresa?"))).toBe(true);
    expect(BASE.find((e) => e.secao.startsWith("Mapa da carteira"))?.publico).toBe("equipe");
    expect(BASE.every((e) => !/\*\*/.test(e.texto))).toBe(true);
  });
});

describe("busca do suporte", () => {
  it("entende o jeito do cliente escrever", () => {
    expect(raiz("emissoes")).toBe("emissao");
    expect(raiz("notas")).toBe("nota");
    expect(termos("Como eu pago os boletos?", true)).toEqual(expect.arrayContaining(["pago", "boleto", "guia", "agenda"]));
    expect(titulos("como pauso uma OS por falta de material?")[0]).toContain("Ordens de serviço");
    expect(titulos("onde estão os boletos pra pagar").join(" ")).toMatch(/Agenda de pagamentos/);
    expect(titulos("como emito nfse").join(" ")).toMatch(/nota de serviço/i);
    expect(titulos("esqueci a senha").join(" ")).toMatch(/senha|Primeiro acesso|Minha conta/i);
  });

  it("não mostra ao cliente o que é só da equipe", () => {
    const cliente = indice.buscar("mapa da carteira do escritório", ["todos", "cliente"], 10);
    expect(cliente.every((r) => r.entrada.publico !== "equipe")).toBe(true);
    expect(titulos("mapa da carteira", ["todos", "cliente", "equipe"])[0]).toMatch(/Mapa da carteira/);
  });

  it("sugere as telas certas do menu da pessoa", () => {
    const menu = [
      { rotulo: "Agenda de pagamentos", href: "/e/x/agenda", grupo: "Pagamentos e prazos" },
      { rotulo: "Emitir nota de serviço", href: "/e/x/notas-servico", grupo: "Notas" },
      { rotulo: "Esteira de serviços", href: "/e/x/os", grupo: "Ordens de serviço" },
      { rotulo: "Enviar documentos", href: "/e/x/documentos/enviar", grupo: "Documentos" },
    ];
    expect(atalhosParaPergunta("onde pago o boleto do imposto?", menu, [])[0].href).toBe("/e/x/agenda");
    expect(atalhosParaPergunta("quero abrir uma ordem de serviço", menu, [])[0].href).toBe("/e/x/os");
    expect(atalhosParaPergunta("como mando os documentos", menu, [])[0].href).toBe("/e/x/documentos/enviar");
    expect(atalhosParaPergunta("bom dia", menu, [])).toEqual([]);
  });

  it("resumo e sugestões da tela", () => {
    expect(resumo("a ".repeat(300), 20).endsWith("…")).toBe(true);
    expect(sugestoesDaTela("/e/123/os/relatorio", false)[0]).toMatch(/ordem de serviço/);
    expect(sugestoesDaTela("/escritorio/empresas", true)[0]).toMatch(/empresa/);
  });
});
