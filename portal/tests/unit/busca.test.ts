import { describe, expect, it } from "vitest";
import { aplicarBusca, casaBusca, condicaoBusca, filtrarLista, normalizarBusca, palavrasDaBusca, textoBuscavel } from "@/lib/busca";

/** Busca do portal: sem acento, palavras em qualquer ordem e pela metade, CPF/CNPJ com ou sem pontos. */
describe("busca do portal", () => {
  it("normaliza igual ao banco: sem acento, minúsculo e pontuação vira espaço", () => {
    expect(normalizarBusca("João da SILVA-ME")).toBe("joao da silva me");
    expect(normalizarBusca("Ação & Çedilha / Pão")).toBe("acao cedilha pao");
  });

  it("separa as palavras e junta número com pontuação (CPF, CNPJ, telefone)", () => {
    expect(palavrasDaBusca("  Silva   joão silva ")).toEqual(["silva", "joao"]);
    expect(palavrasDaBusca("123.456.789-00")).toEqual(["12345678900"]);
    expect(palavrasDaBusca("(63) 99999-0000")).toEqual(["63999990000"]);
    expect(palavrasDaBusca("TAB-30")).toEqual(["tab", "30"]);
    expect(palavrasDaBusca("")).toEqual([]);
    expect(palavrasDaBusca(undefined)).toEqual([]);
    expect(palavrasDaBusca("a b c d e f g h i j")).toHaveLength(8);
  });

  const clientes = [
    { nome: "Construtora Horizonte", documento: "55666777000191", telefone: null },
    { nome: "João Carpinteiro", documento: "14725836982", telefone: "63966665555" },
    { nome: "Maria João Silva", documento: null, telefone: "6332150000" },
    { nome: "Tábua de pinus 2,5 x 30 cm", documento: null, telefone: null },
  ];
  const campos = (c: (typeof clientes)[number]) => [c.nome, c.documento, c.telefone];

  it("acha sem acento, com as palavras em qualquer ordem e pela metade", () => {
    expect(filtrarLista(clientes, "joao", campos).map((c) => c.nome)).toEqual(["João Carpinteiro", "Maria João Silva"]);
    expect(filtrarLista(clientes, "carpinteiro JOÃO", campos).map((c) => c.nome)).toEqual(["João Carpinteiro"]);
    expect(filtrarLista(clientes, "tab pin", campos).map((c) => c.nome)).toEqual(["Tábua de pinus 2,5 x 30 cm"]);
    expect(filtrarLista(clientes, "xyz", campos)).toEqual([]);
  });

  it("acha CPF, CNPJ e telefone com ou sem pontuação", () => {
    expect(filtrarLista(clientes, "147.258.369-82", campos).map((c) => c.nome)).toEqual(["João Carpinteiro"]);
    expect(filtrarLista(clientes, "55.666.777/0001-91", campos).map((c) => c.nome)).toEqual(["Construtora Horizonte"]);
    expect(filtrarLista(clientes, "(63) 3215", campos).map((c) => c.nome)).toEqual(["Maria João Silva"]);
  });

  it("sobe primeiro quem começa com o que foi digitado e mantém o resto na ordem", () => {
    const lista = [{ nome: "Silva Transportes" }, { nome: "José da Silva" }, { nome: "Ana" }];
    expect(filtrarLista(lista, "silva", (x) => [x.nome]).map((x) => x.nome)).toEqual(["Silva Transportes", "José da Silva"]);
    expect(filtrarLista(lista, "", (x) => [x.nome])).toHaveLength(3);
  });

  it("casa a busca com campos soltos e, sem nada digitado, casa sempre", () => {
    expect(casaBusca("", "qualquer")).toBe(true);
    expect(casaBusca("horizonte construtora", "Construtora Horizonte Ltda")).toBe(true);
    expect(casaBusca("horizonte", "Outra empresa")).toBe(false);
    expect(textoBuscavel("CPF 123.456", null)).toContain("cpf123456");
  });

  it("monta o filtro do banco: cada palavra no campo de busca", () => {
    const chamadas: [string, string][] = [];
    const consulta = {
      ilike(coluna: "busca", padrao: string) {
        chamadas.push([coluna, padrao]);
        return consulta;
      },
    };
    aplicarBusca(consulta, "João  Silva");
    expect(chamadas).toEqual([
      ["busca", "%joao%"],
      ["busca", "%silva%"],
    ]);
    chamadas.length = 0;
    aplicarBusca(consulta, "   ");
    expect(chamadas).toEqual([]);
    expect(condicaoBusca("joao")).toBe("busca.ilike.%joao%");
    expect(condicaoBusca("joao silva")).toBe("and(busca.ilike.%joao%,busca.ilike.%silva%)");
    expect(condicaoBusca("")).toBeNull();
    // Nada que quebre a sintaxe do filtro (vírgula, parênteses, %) passa para o banco
    expect(condicaoBusca("a,b) or (id.eq.1")).toBe("and(busca.ilike.%a%,busca.ilike.%b%,busca.ilike.%or%,busca.ilike.%id%,busca.ilike.%eq%,busca.ilike.%1%)");
  });
});
