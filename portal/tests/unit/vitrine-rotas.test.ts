import { beforeEach, describe, expect, it, vi } from "vitest";

const lerVitrine = vi.fn();
const registrarPedidoSite = vi.fn();
vi.mock("@/lib/vitrine/servico", () => ({
  lerVitrine: (...a: unknown[]) => lerVitrine(...a),
  lerProdutoVitrine: vi.fn(),
  registrarPedidoSite: (...a: unknown[]) => registrarPedidoSite(...a),
}));

const CHAVE = "lj_" + "a".repeat(43);
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) }) as never;
const req = (url: string, init: RequestInit & { chave?: string | null; ip?: string } = {}) => {
  const h = new Headers(init.headers);
  if (init.chave !== null) h.set("authorization", `Bearer ${init.chave ?? CHAVE}`);
  if (init.ip) h.set("x-cliente-ip", init.ip);
  return new Request(url, { ...init, headers: h }) as never;
};

describe("vitrine: rota do catálogo", () => {
  beforeEach(() => lerVitrine.mockReset());

  it("sem chave ou com endereço curto inválido: 404 sem consultar o banco", async () => {
    const { GET } = await import("@/app/api/vitrine/[slug]/route");
    expect((await GET(req("https://p/api/vitrine/loja-a", { chave: null }), ctx("loja-a"))).status).toBe(404);
    expect((await GET(req("https://p/api/vitrine/LOJA_A"), ctx("LOJA_A"))).status).toBe(404);
    expect(lerVitrine).not.toHaveBeenCalled();
  });

  it("chave errada (banco não acha a loja): 404; certa: catálogo sem cache", async () => {
    const { GET } = await import("@/app/api/vitrine/[slug]/route");
    lerVitrine.mockResolvedValueOnce(null);
    expect((await GET(req("https://p/api/vitrine/loja-a"), ctx("loja-a"))).status).toBe(404);
    lerVitrine.mockResolvedValueOnce({ aberta: true, loja: { nome: "Loja A" }, categorias: [], produtos: [] });
    const r = await GET(req("https://p/api/vitrine/loja-a"), ctx("loja-a"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(lerVitrine).toHaveBeenLastCalledWith("loja-a", CHAVE);
  });
});

describe("vitrine: rota do pedido", () => {
  beforeEach(() => registrarPedidoSite.mockReset());
  const corpo = JSON.stringify({ nome: "Maria", itens: [] });

  it("pedido aceito: 201 com o pedido", async () => {
    const { POST } = await import("@/app/api/vitrine/[slug]/pedidos/route");
    registrarPedidoSite.mockResolvedValueOnce({ ok: true, pedido: { numero: 7 } });
    const r = await POST(req("https://p/api/vitrine/loja-a/pedidos", { method: "POST", body: corpo, ip: "10.0.0.1" }), ctx("loja-a"));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ok: true, pedido: { numero: 7 } });
  });

  it("preço mudou: 422 avisando para conferir; loja não encontrada: 404", async () => {
    const { POST } = await import("@/app/api/vitrine/[slug]/pedidos/route");
    registrarPedidoSite.mockResolvedValueOnce({ ok: false, mensagem: "Os preços mudaram.", precosMudaram: true });
    let r = await POST(req("https://p/api/vitrine/loja-a/pedidos", { method: "POST", body: corpo, ip: "10.0.0.2" }), ctx("loja-a"));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ ok: false, mensagem: "Os preços mudaram.", precosMudaram: true });
    registrarPedidoSite.mockResolvedValueOnce({ ok: false, mensagem: "Loja não encontrada.", naoEncontrada: true });
    r = await POST(req("https://p/api/vitrine/loja-a/pedidos", { method: "POST", body: corpo, ip: "10.0.0.2" }), ctx("loja-a"));
    expect(r.status).toBe(404);
  });

  it("corpo inválido não chega ao banco; mais de 10 pedidos em 10 minutos do mesmo cliente: 429", async () => {
    const { POST } = await import("@/app/api/vitrine/[slug]/pedidos/route");
    expect((await POST(req("https://p/api/vitrine/loja-b/pedidos", { method: "POST", body: "{", ip: "10.0.0.3" }), ctx("loja-b"))).status).toBe(400);
    expect((await POST(req("https://p/api/vitrine/loja-b/pedidos", { method: "POST", body: "[1]", ip: "10.0.0.3" }), ctx("loja-b"))).status).toBe(400);
    expect(registrarPedidoSite).not.toHaveBeenCalled();
    registrarPedidoSite.mockResolvedValue({ ok: true, pedido: {} });
    for (let i = 0; i < 8; i++) await POST(req("https://p/api/vitrine/loja-b/pedidos", { method: "POST", body: corpo, ip: "10.0.0.3" }), ctx("loja-b"));
    const r = await POST(req("https://p/api/vitrine/loja-b/pedidos", { method: "POST", body: corpo, ip: "10.0.0.3" }), ctx("loja-b"));
    expect(r.status).toBe(429);
  });
});
