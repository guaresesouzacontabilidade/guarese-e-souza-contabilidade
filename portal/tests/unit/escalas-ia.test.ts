import { describe, expect, it, vi } from "vitest";

// A IA usa o cliente administrador e a cifra só para ler a chave; aqui a chave é passada direto
vi.mock("@/lib/supabase/admin", () => ({ criarClienteAdmin: () => ({}) }));

import { anonimizarTexto, criarApelidos, nomearTexto } from "@/lib/escalas/apelidos";
import { aplicarAjuste, aplicarSugestao, ajusteIaSchema, perguntaAjuste, perguntaSugestao, sugestaoIaSchema, SISTEMA_ESCALAS } from "@/lib/escalas/ia-prompt";
import { ErroIa, mensagemDeErro, perguntarIa, testarChave } from "@/lib/escalas/ia";
import { conferirEscala } from "@/lib/escalas/conferencia";
import { gerarGrade } from "@/lib/escalas/gerador";
import { configPadrao, type ConfigEscala, type Pessoa } from "@/lib/escalas/tipos";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";

function pessoa(id: string, nome: string, extra: Partial<Pessoa> = {}): Pessoa {
  return {
    id, nome, cargo: "Atendente", jornadaSemanal: 44, naoTrabalha: [], domingoQuinzenal: false, menorIdade: false,
    modelo: "6x1", turnos: ["T1"], diasTrabalho: [], folgasPreferidas: [], deslocamento: 0, ...extra,
  };
}

const pessoas = [pessoa(A, "Maria José da Silva"), pessoa(B, "João Pereira (DEMO)", { cargo: "Padeiro" }), pessoa(C, "Mariana Souza")];
const config: ConfigEscala = { ...configPadrao(), pessoas };
const funcionarios = pessoas.map((p) => ({ id: p.id, nome: p.nome, preferencias: p.id === B ? "O João estuda à noite; CPF 123.456.789-09" : null }));

describe("apelidos (privacidade)", () => {
  const ap = criarApelidos(pessoas);
  it("troca nomes completos, primeiros nomes e sobrenomes pelos apelidos e tira documentos", () => {
    const t = anonimizarTexto("Maria José da Silva folga sábado, o joão não pode domingo e a Souza prefere manhã. CPF 123.456.789-09, fone (63) 99999-1234.", pessoas, ap);
    expect(t).toBe("P1 folga sábado, o P2 não pode domingo e a P3 prefere manhã. CPF [documento removido], fone [telefone removido].");
    expect(t).not.toMatch(/Maria|João|joão|Souza|123\.456/);
  });
  it("primeiro nome repetido não é trocado por engano; nome completo sim", () => {
    const duas = [pessoa(A, "Ana Lima"), pessoa(B, "Ana Costa")];
    const ap2 = criarApelidos(duas);
    expect(anonimizarTexto("Ana Lima e Ana Costa", duas, ap2)).toBe("P1 e P2");
  });
  it("na volta, os apelidos viram nomes", () => {
    expect(nomearTexto("P1 e P3 ficam no turno da manhã; P9 não existe.", ap)).toBe("Maria José da Silva e Mariana Souza ficam no turno da manhã; P9 não existe.");
  });
});

describe("pergunta ao assistente", () => {
  const ap = criarApelidos(pessoas);
  it("a pergunta de sugestão não leva nomes nem documentos", () => {
    const q = perguntaSugestao(config, "2026-12-01", "A Mariana Souza só pode de manhã", funcionarios, ap);
    for (const proibido of ["Maria", "João", "Mariana", "Souza", "Pereira", "123.456"]) expect(q).not.toContain(proibido);
    expect(q).toContain('"ref":"P1"');
    expect(q).toContain("P3 só pode de manhã");
    expect(q).toContain("P2 estuda à noite");
    expect(q).toContain("dezembro de 2026");
  });
  it("a pergunta de ajuste leva a grade e os problemas apontados, sem nomes", () => {
    const grade = gerarGrade(config, "2026-12-01");
    const conf = conferirEscala(config, "2026-12-01", grade);
    const q = perguntaAjuste(config, "2026-12-01", grade, conf, "Dê folga para a Maria José da Silva no dia 24", funcionarios, ap);
    expect(q).toContain('"gradeAtual"');
    expect(q).toContain("P1 no dia 24");
    expect(q).not.toMatch(/Maria|João|Mariana/);
  });
  it("o sistema explica as regras e o formato sem pedir dados pessoais", () => {
    expect(SISTEMA_ESCALAS).toContain("P1, P2, P3");
    expect(SISTEMA_ESCALAS).toContain("12x36");
    expect(SISTEMA_ESCALAS).toContain("11 horas");
  });
});

describe("resposta do assistente na escala", () => {
  const ap = criarApelidos(pessoas);
  it("aplica modelos, turnos e cobertura; ignora o que não existe", () => {
    const r = aplicarSugestao(
      config,
      {
        resumo: "P1 e P2 no 6x1; P3 no meio período.",
        modeloPrincipal: "6x1",
        alternativas: [{ modelo: "5x2", motivo: "Se fechar aos sábados, P1 pode ir para 5x2." }],
        turnos: [
          { id: "T1", nome: "Manhã", inicio: "07:00", fim: "15:20", intervaloMin: 60 },
          { id: "T2", nome: "Tarde", inicio: "13:00", fim: "19:15", intervaloMin: 15 },
          { id: "T3", nome: "Errado", inicio: "25:00", fim: "10:00", intervaloMin: 60 },
        ],
        cobertura: [{ turno: "T1", minimo: [1, 2, 2] }, { turno: "T9", minimo: [1, 1, 1, 1, 1, 1, 1] }],
        pessoas: [
          { ref: "P1", modelo: "6x1", turnos: ["T1"], diasTrabalho: [], folgasPreferidas: [3, 9] },
          { ref: "p3", modelo: "parcial", turnos: ["T2", "T3"], diasTrabalho: [1, 2, 3, 4, 5], folgasPreferidas: [] },
          { ref: "P7", modelo: "6x1", turnos: ["T1"], diasTrabalho: [], folgasPreferidas: [] },
        ],
        alertas: ["P3 precisa de contrato de tempo parcial."],
      },
      ap,
    );
    expect(r.config.turnos.map((t) => t.id)).toEqual(["T1", "T2"]);
    expect(r.config.cobertura).toEqual([{ turno: "T1", minimo: [1, 2, 2, 0, 0, 0, 0] }]);
    expect(r.config.pessoas.find((p) => p.id === A)!.folgasPreferidas).toEqual([3]);
    expect(r.config.pessoas.find((p) => p.id === C)!).toMatchObject({ modelo: "parcial", turnos: ["T2"], diasTrabalho: [1, 2, 3, 4, 5] });
    expect(r.config.pessoas.find((p) => p.id === B)!.modelo).toBe("6x1");
    expect(r.ignorados.join(" ")).toContain("T3");
    expect(r.ignorados.join(" ")).toContain("P7");
    expect(r.resumo).toBe("Maria José da Silva e João Pereira (DEMO) no 6x1; Mariana Souza no meio período.");
    expect(r.alertas[0]).toBe("Mariana Souza precisa de contrato de tempo parcial.");
  });
  it("aplica só as alterações válidas da grade", () => {
    const grade = gerarGrade(config, "2026-12-01");
    const r = aplicarAjuste(
      config,
      "2026-12-01",
      grade,
      { resumo: "Folga para P1 no dia 24.", alteracoes: [{ ref: "P1", dia: 24, codigo: "f" }, { ref: "P1", dia: 40, codigo: "F" }, { ref: "P2", dia: 3, codigo: "T7" }, { ref: "P8", dia: 3, codigo: "F" }], alertas: [] },
      ap,
    );
    expect(r.grade[A][23]).toBe("F");
    expect(r.ignorados).toHaveLength(3);
    expect(r.alteradas).toBe(grade[A][23] === "F" ? 0 : 1);
    expect(grade[A][23]).not.toBe(r.grade === grade ? "x" : undefined); // a grade original não é alterada
  });
});

describe("chamada ao serviço (Anthropic) com resposta simulada", () => {
  const respostaOk = (dados: unknown, extra: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({
        id: "msg_teste", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(dados) }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 340 }, ...extra,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const ajuste = { resumo: "Feito.", alteracoes: [{ ref: "P1", dia: 2, codigo: "F" }], alertas: [] };

  it("envia o modelo, a saída estruturada, o esforço e o plano B de recusa, e devolve o resultado conferido", async () => {
    const chamadas: { url: string; corpo: Record<string, unknown>; headers: Headers }[] = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), corpo: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
      return respostaOk(ajuste);
    }) as unknown as typeof fetch;
    const q = perguntaSugestao(config, "2026-12-01", "", funcionarios, criarApelidos(pessoas));
    const r = await perguntarIa({ chave: "sk-ant-teste-000000000000000000000", modelo: "claude-opus-5-5" }, q, ajusteIaSchema, { fetch: fetchFalso });
    expect(r.dados).toEqual(ajuste);
    expect(r.tokensEntrada).toBe(1200);
    expect(r.tokensSaida).toBe(340);
    const { url, corpo, headers } = chamadas[0];
    expect(url).toContain("/v1/messages");
    expect(corpo.model).toBe("claude-opus-5-5");
    expect(corpo.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(corpo.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(JSON.stringify(corpo)).not.toMatch(/Maria|João|Mariana|123\.456/);
  });

  it("recusa e resposta fora do formato viram mensagem clara", async () => {
    const recusa = (async () => respostaOk({}, { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } })) as unknown as typeof fetch;
    await expect(perguntarIa({ chave: "sk-ant-x", modelo: "claude-opus-5-5" }, "oi", sugestaoIaSchema, { fetch: recusa })).rejects.toBeInstanceOf(ErroIa);
  });

  it("chave recusada (401) vira orientação para o administrador; teste da chave idem", async () => {
    const negado = (async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const erro = await perguntarIa({ chave: "sk-ant-x", modelo: "claude-opus-5-5" }, "oi", ajusteIaSchema, { fetch: negado }).catch((e) => e);
    expect(mensagemDeErro(erro)).toContain("chave da Anthropic foi recusada");
    const teste = await testarChave("sk-ant-x", "claude-opus-5-5", negado);
    expect(teste).toEqual({ ok: false, erro: expect.stringContaining("recusada") });
  });
});
