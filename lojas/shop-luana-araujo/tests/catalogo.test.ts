import { describe, expect, it } from "vitest";
import { acharCategoria, arvoreCategorias, buscar, cnpjVisivel, linkWhatsApp, mensagemPedido, moeda, ordenar, produtosDaCategoria, slug, telefoneVisivel, urlProduto } from "@/lib/catalogo";
import { frasePrincipal } from "@/lib/textos";
import { criarLimitador, validarPedido } from "@/lib/validar-pedido";
import type { Categoria, ProdutoResumo } from "@/lib/tipos";

const p = (id: string, nome: string, extra: Partial<ProdutoResumo> = {}): ProdutoResumo => ({
  id, nome, preco: 10, preco_de: null, categoria_id: null, fotos: [], destaque: false, disponivel: true, ultimas: false, opcoes: 0, publicado_em: "2026-11-01T00:00:00Z", ...extra,
});
const cats: Categoria[] = [
  { id: "m", pai_id: null, nome: "Maquiagens", slug: "maquiagens", ordem: 0 },
  { id: "b", pai_id: "m", nome: "Bases", slug: "bases", ordem: 0 },
  { id: "g", pai_id: "m", nome: "Gloss", slug: "gloss", ordem: 1 },
  { id: "pr", pai_id: null, nome: "Prata 925", slug: "prata-925", ordem: 1 },
  { id: "vazia", pai_id: null, nome: "Vazia", slug: "vazia", ordem: 2 },
];

describe("catálogo", () => {
  it("busca sem acento e com palavras em qualquer ordem", () => {
    const lista = [p("1", "Brinco Argola Prata 925"), p("2", "Pó Compacto Matte"), p("3", "Anel Prata")];
    expect(buscar(lista, "prata brinco").map((x) => x.id)).toEqual(["1"]);
    expect(buscar(lista, "po compacto").map((x) => x.id)).toEqual(["2"]);
    expect(buscar(lista, "   ")).toEqual([]);
  });

  it("ordena e manda os esgotados para o fim", () => {
    const lista = [p("a", "B", { preco: 30 }), p("b", "A", { preco: 10, disponivel: false }), p("c", "C", { preco: 20, destaque: true })];
    expect(ordenar(lista, "menor").map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(ordenar(lista, "maior").map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(ordenar(lista, "destaque")[0].id).toBe("c");
    expect(ordenar(lista, "az").map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("árvore de categorias com contagem, sem as vazias; subcategoria acha a principal", () => {
    const produtos = [p("1", "x", { categoria_id: "b" }), p("2", "y", { categoria_id: "b" }), p("3", "z", { categoria_id: "m" }), p("4", "w", { categoria_id: "pr" })];
    const arvore = arvoreCategorias(cats, produtos);
    expect(arvore.map((c) => [c.slug, c.total, c.filhas.map((f) => f.slug)])).toEqual([
      ["maquiagens", 3, ["bases"]],
      ["prata-925", 1, []],
    ]);
    const achada = acharCategoria(arvore, "bases");
    expect(achada?.pai?.slug).toBe("maquiagens");
    expect(produtosDaCategoria(arvore[0], produtos).map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(acharCategoria(arvore, "vazia")).toBeNull();
    expect(frasePrincipal(arvore)).toBe("Maquiagens e prata 925");
  });

  it("endereços, telefone, CNPJ e moeda", () => {
    expect(slug("Base Líquida Matte - Bauny 020")).toBe("base-liquida-matte-bauny-020");
    expect(urlProduto({ id: "abc", nome: "Anel Prata 925" })).toBe("/p/abc/anel-prata-925");
    expect(telefoneVisivel("5563992088810")).toBe("(63) 99208-8810");
    expect(cnpjVisivel("11444777000161")).toBe("11.444.777/0001-61");
    expect(moeda(1234.5)).toBe("R$ 1.234,50");
    expect(linkWhatsApp("5563992088810", "Olá & tudo")).toBe("https://wa.me/5563992088810?text=Ol%C3%A1%20%26%20tudo");
  });

  it("mensagem do pedido para o WhatsApp traz número, itens, opção, entrega e total", () => {
    const m = mensagemPedido({
      numero: 12, subtotal: 139.8, frete: 25, frete_a_combinar: false, total: 164.8, entrega: "Entrega em Palmas", endereco: "Rua 10, 123",
      pagamento: "PIX", troco_para: null, whatsapp: "5563992088810", nome: "Maria",
      itens: [{ nome: "Base Matte", quantidade: 2, preco: 69.9, total: 139.8, variacao: "030", rotulo_variacao: "Tom" }],
    });
    expect(m).toContain("Fiz o pedido nº 12 pelo site.");
    expect(m).toContain("• 2x Base Matte (Tom: 030) — R$ 139,80");
    expect(m).toContain("Entrega: Entrega em Palmas (R$ 25,00)");
    expect(m).toContain("Total: R$ 164,80");
    expect(m).toContain("Endereço: Rua 10, 123");
  });
});

describe("validação do pedido antes de mandar ao portal", () => {
  const valido = {
    nome: "  Maria   Souza ", telefone: "(63) 98888-7777", entrega: "entrega-em-palmas", endereco: "Rua 10, 123", pagamento: "pix",
    aceite: true, site: "", total_visto: 164.8, itens: [{ produto_id: "6bbe308e-3aa5-440b-ace6-7d6d22610e0c", quantidade: 2, variacao: "030" }],
  };
  it("aceita o pedido completo e limpa os campos", () => {
    const r = validarPedido(valido);
    expect(r.ok && r.dados).toMatchObject({ nome: "Maria Souza", telefone: "63988887777", troco_para: null, total_visto: 164.8 });
  });
  it("recusa sem aceite, telefone sem DDD, item inválido e robô", () => {
    expect(validarPedido({ ...valido, aceite: false }).ok).toBe(false);
    expect(validarPedido({ ...valido, telefone: "98888-7777" }).ok).toBe(false);
    expect(validarPedido({ ...valido, itens: [{ produto_id: "x", quantidade: 1 }] }).ok).toBe(false);
    expect(validarPedido({ ...valido, itens: [{ produto_id: valido.itens[0].produto_id, quantidade: 100 }] }).ok).toBe(false);
    const robo = validarPedido({ ...valido, site: "http://spam" });
    expect(robo.ok === false && robo.robo).toBe(true);
  });
  it("limita pedidos por endereço", () => {
    const lim = criarLimitador(2, 1000);
    expect([lim("a", 0), lim("a", 1), lim("a", 2), lim("b", 2), lim("a", 1500)]).toEqual([true, true, false, true, true]);
  });
});
