import { describe, expect, it } from "vitest";
import { ehCatalogoFacilZap, lerCatalogo, lerCategoria, lerProduto, nomeVitrine, subcategorias, sugestaoNcm } from "@/lib/vitrine/facilzap";
import { chaveDaRequisicao, gerarChaveSite, hashChave } from "@/lib/vitrine/chave";
import { formatoFoto } from "@/lib/vitrine/fotos";
import { enderecoPublico } from "@/lib/vitrine/buscar-externo";

const CATALOGO = `# Catalogo de Shop Exemplo

**URL canonica:** https://loja.exemplo.com.br

## Categorias

- [MAQUIAGENS](https://loja.exemplo.com.br/categoria/106210.md): 3 produtos
- [BASES](https://loja.exemplo.com.br/categoria/106212.md): 2 produtos
- [PRATA 925](https://loja.exemplo.com.br/categoria/277581.md): 1 produtos

## Produtos

- [BASE ALTA COBERTURA SOFT MATTE - BAUNY](https://loja.exemplo.com.br/produto/3421215.md): R$ 69,90 - MAQUIAGENS - FPS 45 – Proteção Superior: Uma das maiores...
- [BASE SKIN TINT- OCEANE](https://loja.exemplo.com.br/produto/3021225.md): R$ 1.015,00 - ACHADINHOS
- [ANEL PRATA 925 (199,90)](https://loja.exemplo.com.br/produto/4548602.md): R$ 199,90 - PRATA 925
- [ANEL PRATA 925 (199,90)](https://loja.exemplo.com.br/produto/4548602.md): R$ 199,90 - PRATA 925

## Sobre a Loja
`;

const PRODUTO = `# BASE ALTA COBERTURA SOFT MATTE - BAUNY

**Preco a partir de:** R$ 69,90
**Disponibilidade:** Em estoque (20 unidades)
**Categoria:** MAQUIAGENS
**SKU:** FZ3421215

## Descricao

FPS 45 – Proteção Superior.
Fórmula de Alta Cobertura.

## Variacoes

- Variacoes: 020, 030, 040, 030

## Especificacoes

| Atributo | Valor |
|---|---|
| SKU | FZ3421215 |
| Peso | 34 g |

## Imagens

- https://arquivos.facilzap.app.br/produtos/1759157162_2fddca.webp.webp
- https://arquivos-cdn.facilzap.app.br/produtos/1779303897_ddfb08.webp
- https://exemplo-malicioso.com/foto.webp

## Links
`;

describe("vitrine: leitura do catálogo da FácilZap", () => {
  it("reconhece o catálogo e lê categorias e produtos (sem repetir)", () => {
    expect(ehCatalogoFacilZap(CATALOGO)).toBe(true);
    expect(ehCatalogoFacilZap("<html>outra coisa</html>")).toBe(false);
    const c = lerCatalogo(CATALOGO);
    expect(c.loja).toBe("Shop Exemplo");
    expect(c.categorias).toEqual([
      { nome: "MAQUIAGENS", id: "106210", total: 3 },
      { nome: "BASES", id: "106212", total: 2 },
      { nome: "PRATA 925", id: "277581", total: 1 },
    ]);
    expect(c.produtos).toEqual([
      { id: "3421215", nome: "BASE ALTA COBERTURA SOFT MATTE - BAUNY", preco: 69.9, categoria: "MAQUIAGENS" },
      { id: "3021225", nome: "BASE SKIN TINT- OCEANE", preco: 1015, categoria: "ACHADINHOS" },
      { id: "4548602", nome: "ANEL PRATA 925 (199,90)", preco: 199.9, categoria: "PRATA 925" },
    ]);
  });

  it("lê o produto: preço, estoque, SKU, descrição, variações sem repetir, peso e só fotos da FácilZap", () => {
    const p = lerProduto(PRODUTO, "3421215");
    expect(p).toMatchObject({ nome: "BASE ALTA COBERTURA SOFT MATTE - BAUNY", preco: 69.9, estoque: 20, categoria: "MAQUIAGENS", sku: "FZ3421215" });
    expect(p.descricao).toBe("FPS 45 – Proteção Superior.\nFórmula de Alta Cobertura.");
    expect(p.variacoes).toEqual(["020", "030", "040"]);
    expect(p.pesoKg).toBeCloseTo(0.034);
    expect(p.fotos).toEqual(["https://arquivos.facilzap.app.br/produtos/1759157162_2fddca.webp.webp", "https://arquivos-cdn.facilzap.app.br/produtos/1779303897_ddfb08.webp"]);
  });

  it("produto esgotado vem com estoque zero; sem informação, fica em branco", () => {
    expect(lerProduto(PRODUTO.replace("Em estoque (20 unidades)", "Esgotado"), "1").estoque).toBe(0);
    expect(lerProduto(PRODUTO.replace(/\*\*Disponibilidade:\*\*.*\n/, ""), "1").estoque).toBeNull();
  });

  it("subcategoria: a página é filha da categoria principal que mais aparece nela", () => {
    const bases = lerCategoria(`# BASES

## Produtos da Categoria

- [BASE A](https://l/produto/1.md): R$ 10,00 - MAQUIAGENS
- [BASE B](https://l/produto/2.md): R$ 10,00 - ACHADINHOS - descrição
- [BASE C](https://l/produto/3.md): R$ 10,00 - MAQUIAGENS
`);
    expect(bases.nome).toBe("BASES");
    const mapa = subcategorias([{ nome: "BASES", produtos: bases.produtos }], new Set(["MAQUIAGENS", "ACHADINHOS"]));
    expect([...mapa.entries()]).toEqual([
      ["1", "BASES"],
      ["3", "BASES"],
    ]);
  });

  it("nome de vitrine sai do caixa alta sem estragar números, siglas e nomes já escritos", () => {
    expect(nomeVitrine("BASE ALTA COBERTURA SOFT MATTE - BAUNY")).toBe("Base Alta Cobertura Soft Matte - Bauny");
    expect(nomeVitrine("PINGENTE MENINA OU MENINO PRATA 925")).toBe("Pingente Menina ou Menino Prata 925");
    expect(nomeVitrine("LAPIS DE OLHO MARROM- CH")).toBe("Lapis de Olho Marrom- CH");
    expect(nomeVitrine("PINCEL SFFUMATO - S08")).toBe("Pincel Sffumato - S08");
    expect(nomeVitrine("Gloss da Sarah's Beauty")).toBe("Gloss da Sarah's Beauty");
    expect(nomeVitrine("AÇO INOXIDÁVEL")).toBe("Aço Inoxidável");
  });

  it("sugere NCM só para as categorias mais comuns", () => {
    expect(sugestaoNcm("PRATA 925")).toBe("71131100");
    expect(sugestaoNcm("AÇO INOXIDÁVEL")).toBe("71171900");
    expect(sugestaoNcm("MAQUIAGENS")).toBe("33049990");
    expect(sugestaoNcm("ESPELHO")).toBe("");
  });
});

describe("vitrine: chave do site, fotos e endereços externos", () => {
  it("gera chave com prefixo, guarda só o hash e lê do cabeçalho Authorization", () => {
    const { chave, hash, inicio } = gerarChaveSite();
    expect(chave).toMatch(/^lj_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashChave(chave));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inicio).toBe(chave.slice(0, 10));
    expect(chaveDaRequisicao(new Request("https://p/x", { headers: { authorization: `Bearer ${chave}` } }))).toBe(chave);
    expect(chaveDaRequisicao(new Request("https://p/x", { headers: { authorization: "Bearer outra-coisa" } }))).toBeNull();
    expect(chaveDaRequisicao(new Request("https://p/x"))).toBeNull();
  });

  it("reconhece JPEG, PNG e WebP pelo conteúdo", () => {
    expect(formatoFoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(formatoFoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("png");
    expect(formatoFoto(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(formatoFoto(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it("não busca rede interna, localhost, IP direto nem http", async () => {
    expect(await enderecoPublico(new URL("http://loja.exemplo.com.br/catalogo.md"))).toBe(false);
    expect(await enderecoPublico(new URL("https://localhost/catalogo.md"))).toBe(false);
    expect(await enderecoPublico(new URL("https://127.0.0.1/catalogo.md"))).toBe(false);
    expect(await enderecoPublico(new URL("https://169.254.169.254/latest/meta-data"))).toBe(false);
    expect(await enderecoPublico(new URL("https://[::1]/x"))).toBe(false);
    expect(await enderecoPublico(new URL("https://usuario:senha@loja.exemplo.com.br/"))).toBe(false);
    expect(await enderecoPublico(new URL("https://loja.exemplo.com.br:8443/"))).toBe(false);
  });
});
