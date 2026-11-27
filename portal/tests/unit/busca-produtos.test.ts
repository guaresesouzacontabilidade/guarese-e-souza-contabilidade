import { describe, expect, it } from "vitest";
import { buscarProdutos, normalizarBusca } from "@/lib/gestao/busca-produtos";

const p = (codigo: string, descricao: string, grupo: string | null = null, gtin: string | null = null) => ({ codigo, descricao, grupo, gtin });

const PRODUTOS = [
  p("000101", "CASE ULTRA GUARDIAN - LINHA PRO HAWK STRONG BLACK IPHONE:17PROMAX"),
  p("000102", "CASE ULTRA GUARDIAN - LINHA PRO HAWK STRONG BLACK IPHONE:16PRO"),
  p("000116", "*CABO USB-C 2M* TURBO"),
  p("000200", "PELÍCULA 3D VIDRO IPHONE 15", "Películas", "7891234567895"),
  ...Array.from({ length: 40 }, (_, i) => p(String(300 + i), `CASE SILICONE MODELO ${i + 1}`)),
];

describe("busca de produtos do caixa", () => {
  it("normaliza acento, maiúscula e pontuação", () => {
    expect(normalizarBusca("  Película: IPHONE-17*Pro ")).toBe("pelicula iphone 17 pro");
  });

  it("acha com as palavras em qualquer ordem, mesmo grudadas no nome", () => {
    expect(buscarProdutos(PRODUTOS, "iphone 17 case").itens.map((x) => x.codigo)).toEqual(["000101"]);
    expect(buscarProdutos(PRODUTOS, "17 pro max").itens.map((x) => x.codigo)).toEqual(["000101"]);
    expect(buscarProdutos(PRODUTOS, "iphone17").itens.map((x) => x.codigo)).toEqual(["000101"]);
  });

  it("ignora acento e os asteriscos do nome", () => {
    expect(buscarProdutos(PRODUTOS, "pelicula").itens.map((x) => x.codigo)).toEqual(["000200"]);
    expect(buscarProdutos(PRODUTOS, "cabo usb c").itens.map((x) => x.codigo)).toEqual(["000116"]);
  });

  it("código e código de barras exatos vêm primeiro", () => {
    expect(buscarProdutos(PRODUTOS, "000116").itens[0].codigo).toBe("000116");
    expect(buscarProdutos(PRODUTOS, "7891234567895").itens.map((x) => x.codigo)).toEqual(["000200"]);
  });

  it("mostra até o limite e conta o total achado", () => {
    const r = buscarProdutos(PRODUTOS, "case");
    expect(r.total).toBe(42);
    expect(r.itens).toHaveLength(30);
    // Os que começam com a palavra digitada vêm antes
    expect(r.itens.every((x) => x.descricao.startsWith("CASE"))).toBe(true);
  });

  it("acha pelo grupo e não acha o que não tem a palavra", () => {
    expect(buscarProdutos(PRODUTOS, "peliculas").itens.map((x) => x.codigo)).toEqual(["000200"]);
    expect(buscarProdutos(PRODUTOS, "carregador").total).toBe(0);
    expect(buscarProdutos(PRODUTOS, "   ").total).toBe(0);
  });
});
