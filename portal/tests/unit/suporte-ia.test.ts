import { describe, expect, it, vi } from "vitest";

// A IA usa o cliente administrador e a cifra só para ler a chave; aqui a chave é passada direto
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => ({}) }));

import { montarPedido, responderComIa, SISTEMA_SUPORTE } from "@/lib/suporte/ia";
import type { EntradaGuia } from "@/lib/suporte/guia";

const trechos: EntradaGuia[] = [
  { id: "agenda", publico: "cliente", secao: "Agenda de pagamentos", titulo: "Agenda de pagamentos", texto: "As guias aparecem na Agenda de pagamentos com o botão Paguei." },
];
const atalhos = [
  { rotulo: "Agenda de pagamentos", href: "/e/abc/agenda", grupo: "Pagamentos e prazos" },
  { rotulo: "Enviar documentos", href: "/e/abc/documentos/enviar", grupo: "Documentos" },
];
const respostaOk = (dados: unknown) =>
  new Response(
    JSON.stringify({
      id: "msg_teste", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(dados) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("suporte com o assistente de IA (resposta simulada só no teste)", () => {
  it("envia só a pergunta, os trechos do guia e as telas; descarta atalhos inventados", async () => {
    const chamadas: Record<string, unknown>[] = [];
    const fetchFalso = (async (_url: string, init: RequestInit) => {
      chamadas.push(JSON.parse(String(init.body)));
      return respostaOk({ resposta: "Abra a Agenda de pagamentos e toque em Paguei.", atalhos: ["/e/abc/agenda", "/e/abc/inventado"], falar_com_escritorio: false });
    }) as unknown as typeof fetch;
    const r = await responderComIa({ chave: "sk-ant-teste-000000000000000000000", modelo: "claude-opus-5-5" }, "onde pago o boleto?", trechos, atalhos, { fetch: fetchFalso });
    expect(r.dados.atalhos).toEqual(["/e/abc/agenda"]);
    expect(r.dados.resposta).toMatch(/Agenda de pagamentos/);
    expect(r.tokensEntrada).toBe(900);
    const corpo = chamadas[0];
    expect(corpo.system).toBe(SISTEMA_SUPORTE);
    expect(corpo.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    const enviado = JSON.stringify(corpo.messages);
    expect(enviado).toContain("onde pago o boleto?");
    expect(enviado).toContain("/e/abc/agenda");
  });

  it("o pedido lista os trechos e as telas", () => {
    const p = montarPedido("como envio documentos?", trechos, atalhos);
    expect(p).toContain("Pergunta: como envio documentos?");
    expect(p).toContain("[1] Agenda de pagamentos");
    expect(p).toContain("- Documentos › Enviar documentos — /e/abc/documentos/enviar");
  });
});
