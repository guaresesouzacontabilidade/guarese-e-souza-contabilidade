import { describe, expect, it, vi, beforeEach } from "vitest";
import { criarLimitador, origemPermitida, validarContato } from "@/lib/site/contato";

const enviarEmail = vi.fn();
vi.mock("@/lib/email/enviar", () => ({ enviarEmail: (...a: unknown[]) => enviarEmail(...a) }));
vi.mock("@/lib/auth/escritorio-publico", () => ({ obterEscritorioPublico: async () => ({ email: "escritorio@teste.local" }) }));

const valido = {
  nome: "Maria Souza",
  email: "Maria@Empresa.com.br",
  telefone: "(63) 99999-0000",
  empresa: "Empresa Teste",
  assunto: "Quero ser cliente",
  mensagem: "Gostaria de uma proposta.",
  consentimento: true,
  site: "",
  tempo: 8000,
};
const ORIGEM = "https://onguaresescontabilidade.com.br";

function pedido(corpo: unknown, origem: string | null = ORIGEM, ip = "10.0.0.1") {
  const h = new Headers({ "Content-Type": "application/json", "x-forwarded-for": ip });
  if (origem) h.set("origin", origem);
  return new Request("https://portal.teste/api/site/contato", { method: "POST", headers: h, body: JSON.stringify(corpo) }) as never;
}

describe("site: validação do formulário de contato", () => {
  it("aceita o contato completo e limpa os campos", () => {
    const r = validarContato({ ...valido, nome: "  Maria   Souza ", assunto: "inventado" });
    expect(r).toEqual({ ok: true, dados: { nome: "Maria Souza", email: "maria@empresa.com.br", telefone: "(63) 99999-0000", empresa: "Empresa Teste", assunto: "Outro assunto", mensagem: "Gostaria de uma proposta." } });
  });

  it("barra robôs (campo isca ou envio rápido) sem dizer o motivo", () => {
    expect(validarContato({ ...valido, site: "http://spam" })).toEqual({ ok: false, robo: true });
    expect(validarContato({ ...valido, tempo: 500 })).toEqual({ ok: false, robo: true });
    expect(validarContato({ ...valido, tempo: undefined })).toEqual({ ok: false, robo: true });
  });

  it("pede o que falta, em português", () => {
    expect(validarContato({ ...valido, nome: "" })).toMatchObject({ ok: false, mensagem: "Informe o seu nome." });
    expect(validarContato({ ...valido, email: "sem-arroba" })).toMatchObject({ ok: false, mensagem: expect.stringContaining("e-mail") });
    expect(validarContato({ ...valido, telefone: "abc" })).toMatchObject({ ok: false, mensagem: expect.stringContaining("telefone") });
    expect(validarContato({ ...valido, mensagem: "oi" })).toMatchObject({ ok: false, mensagem: "Escreva a sua mensagem." });
    expect(validarContato({ ...valido, consentimento: false })).toMatchObject({ ok: false, mensagem: expect.stringContaining("concordar") });
  });

  it("só aceita o site do escritório (e o endereço de teste dele)", () => {
    expect(origemPermitida("https://onguaresescontabilidade.com.br", true)).toBe(true);
    expect(origemPermitida("https://www.onguaresescontabilidade.com.br", true)).toBe(true);
    expect(origemPermitida("https://site-on-guareses.vercel.app", true)).toBe(true);
    expect(origemPermitida("https://site-on-guareses-abc123-portal-on-guareses.vercel.app", true)).toBe(true);
    expect(origemPermitida("https://site-on-guareses-qualquer.vercel.app", true)).toBe(false);
    expect(origemPermitida("https://outro-site.com", true)).toBe(false);
    expect(origemPermitida(null, true)).toBe(false);
    expect(origemPermitida("http://localhost:4000", true)).toBe(false);
    expect(origemPermitida("http://localhost:4000", false)).toBe(true);
  });

  it("limita os envios por endereço na janela de tempo", () => {
    const limite = criarLimitador(2, 1000);
    expect(limite("a", 0)).toBe(true);
    expect(limite("a", 10)).toBe(true);
    expect(limite("a", 20)).toBe(false);
    expect(limite("b", 20)).toBe(true);
    expect(limite("a", 1500)).toBe(true);
  });
});

describe("site: rota do formulário no portal", () => {
  beforeEach(() => enviarEmail.mockReset());

  it("envia ao e-mail do escritório, com resposta para o visitante, e libera só a origem do site", async () => {
    enviarEmail.mockResolvedValue({ enviado: true, id: "1" });
    const { POST } = await import("@/app/api/site/contato/route");
    const r = await POST(pedido(valido, ORIGEM, "10.0.0.2"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGEM);
    const [para, assunto, conteudo, , opcoes] = enviarEmail.mock.calls[0];
    expect(para).toBe("escritorio@teste.local");
    expect(assunto).toBe("Contato pelo site: Quero ser cliente — Maria Souza");
    expect(conteudo.paragrafos).toContain("E-mail: maria@empresa.com.br");
    expect(opcoes).toEqual({ responderPara: "maria@empresa.com.br" });
  });

  it("outra origem é recusada; robô recebe ok sem envio; sem e-mail configurado, avisa (não simula)", async () => {
    const { POST, OPTIONS } = await import("@/app/api/site/contato/route");
    const fora = await POST(pedido(valido, "https://outro-site.com", "10.0.0.3"));
    expect(fora.status).toBe(403);
    expect(fora.headers.get("access-control-allow-origin")).toBeNull();
    expect((await OPTIONS(pedido({}, ORIGEM))).status).toBe(204);

    const robo = await POST(pedido({ ...valido, site: "x" }, ORIGEM, "10.0.0.4"));
    expect(await robo.json()).toEqual({ ok: true });
    expect(enviarEmail).not.toHaveBeenCalled();

    enviarEmail.mockResolvedValue({ enviado: false, motivo: "nao_configurado" });
    const semSmtp = await POST(pedido(valido, ORIGEM, "10.0.0.5"));
    expect(semSmtp.status).toBe(503);
    expect((await semSmtp.json()).mensagem).toContain("ainda não está ligado");

    const invalido = await POST(pedido({ ...valido, email: "x" }, ORIGEM, "10.0.0.6"));
    expect(invalido.status).toBe(400);
  });

  it("muitas mensagens do mesmo endereço: pede para esperar", async () => {
    enviarEmail.mockResolvedValue({ enviado: true, id: "1" });
    const { POST } = await import("@/app/api/site/contato/route");
    const status: number[] = [];
    for (let i = 0; i < 6; i++) status.push((await POST(pedido(valido, ORIGEM, "10.9.9.9"))).status);
    expect(status).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
