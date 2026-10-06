import { describe, expect, it } from "vitest";
import { contarSemXml, diasDesdeEmissao, estadoSemXml, podeConfirmar, type ResumoSemXml } from "@/lib/notas-automaticas/situacao-xml";

const HOJE = "2026-10-06";
const base: ResumoSemXml = {
  data_emissao: "2026-09-02T10:00:00-03:00",
  ciencia_em: null,
  ciencia_retorno: null,
  confirmacao_pedida_em: null,
  confirmacao_em: null,
  confirmacao_retorno: null,
};
const RECUSA_PRAZO = "596 - Rejeicao: Evento apresentado apos o prazo permitido para o evento: [10 dias]";

describe("NF-e só em resumo: ciência e confirmação da operação", () => {
  it("classifica cada nota pela manifestação", () => {
    expect(estadoSemXml(base)).toBe("aguardando_ciencia");
    expect(estadoSemXml({ ...base, ciencia_em: "2026-10-05T12:00:00Z", ciencia_retorno: "135 - Evento registrado" })).toBe("ciencia_registrada");
    expect(estadoSemXml({ ...base, ciencia_retorno: RECUSA_PRAZO })).toBe("ciencia_recusada");
    expect(estadoSemXml({ ...base, ciencia_retorno: RECUSA_PRAZO, confirmacao_pedida_em: "2026-10-06T12:00:00Z" })).toBe("confirmacao_pedida");
    expect(estadoSemXml({ ...base, confirmacao_pedida_em: "2026-10-06T12:00:00Z", confirmacao_retorno: "596 - prazo" })).toBe("confirmacao_recusada");
    expect(estadoSemXml({ ...base, confirmacao_pedida_em: "x", confirmacao_em: "y", confirmacao_retorno: "135 - ok" })).toBe("confirmada");
  });

  it("só oferece a confirmação quando a ciência foi recusada (ou a confirmação falhou), dentro dos 180 dias", () => {
    expect(diasDesdeEmissao("2026-09-02T10:00:00-03:00", HOJE)).toBe(34);
    expect(podeConfirmar({ ...base, ciencia_retorno: RECUSA_PRAZO }, HOJE)).toBe(true);
    expect(podeConfirmar({ ...base, confirmacao_pedida_em: "x", confirmacao_retorno: "999 - erro" }, HOJE)).toBe(true);
    expect(podeConfirmar(base, HOJE)).toBe(false); // ainda dá para pedir a ciência
    expect(podeConfirmar({ ...base, ciencia_retorno: RECUSA_PRAZO, confirmacao_pedida_em: "x" }, HOJE)).toBe(false); // já pedida
    expect(podeConfirmar({ ...base, ciencia_retorno: RECUSA_PRAZO, data_emissao: "2026-03-01T10:00:00-03:00" }, HOJE)).toBe(false); // mais de 180 dias
    expect(podeConfirmar({ ...base, ciencia_retorno: RECUSA_PRAZO, data_emissao: null }, HOJE)).toBe(false);
  });

  it("conta as notas por situação", () => {
    const t = contarSemXml(
      [
        base,
        { ...base, ciencia_em: "a" },
        { ...base, ciencia_retorno: RECUSA_PRAZO },
        { ...base, ciencia_retorno: RECUSA_PRAZO },
        { ...base, ciencia_retorno: RECUSA_PRAZO, confirmacao_pedida_em: "p" },
        { ...base, confirmacao_pedida_em: "p", confirmacao_em: "c" },
      ],
      HOJE,
    );
    expect(t).toEqual({ total: 6, aguardandoCiencia: 1, aCaminho: 2, confirmacaoPedida: 1, recusadas: 2, confirmaveis: 2 });
  });
});
