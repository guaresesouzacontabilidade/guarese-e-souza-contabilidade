import { describe, expect, it } from "vitest";
import { crc16, lerPixCopiaECola, montarPixCopiaECola, normalizarChavePix, textoPix } from "@/lib/honorarios/pix";
import { encargos, numeroCobranca, situacaoExibida } from "@/lib/honorarios/comum";
import { MENSAGENS_PADRAO, preencher, resumoWhatsapp, textoDaMensagem, tipoDaMensagem } from "@/lib/honorarios/mensagens";

describe("Pix copia e cola (BR Code estático)", () => {
  it("calcula o CRC16 igual ao exemplo do manual do Banco Central", () => {
    const exemplo =
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
    expect(crc16(exemplo)).toBe("1D3D");
  });

  it("monta o Pix com chave, valor, nome, cidade e txid, e o CRC confere", () => {
    const pix = montarPixCopiaECola({ chave: "62935399000150", nome: "Guarese's ON Soluções Empresariais", cidade: "Porto Nacional", valor: "850", txid: "HON2026000007" });
    const { campos, crcValido } = lerPixCopiaECola(pix);
    expect(crcValido).toBe(true);
    expect(campos["00"]).toBe("01");
    expect(campos["26"]).toBe("0014br.gov.bcb.pix011462935399000150");
    expect(campos["53"]).toBe("986");
    expect(campos["54"]).toBe("850.00");
    expect(campos["58"]).toBe("BR");
    expect(campos["59"]).toBe("GUARESE S ON SOLUCOES EMP");
    expect(campos["60"]).toBe("PORTO NACIONAL");
    expect(campos["62"]).toBe("0513HON2026000007");
  });

  it("sem valor, quem paga digita; sem txid, usa ***", () => {
    const { campos } = lerPixCopiaECola(montarPixCopiaECola({ chave: "a@b.com", nome: "X", cidade: "Y" }));
    expect(campos["54"]).toBeUndefined();
    expect(campos["62"]).toBe("0503***");
  });

  it("confere e normaliza a chave pelo tipo", () => {
    expect(normalizarChavePix("cnpj", "62.935.399/0001-50")).toBe("62935399000150");
    expect(normalizarChavePix("cnpj", "62.935.399/0001-51")).toBeNull();
    expect(normalizarChavePix("cpf", "529.982.247-25")).toBe("52998224725");
    expect(normalizarChavePix("telefone", "(63) 99999-0000")).toBe("+5563999990000");
    expect(normalizarChavePix("email", "Financeiro@Escritorio.com.BR")).toBe("financeiro@escritorio.com.br");
    expect(normalizarChavePix("aleatoria", "123E4567-E12B-12D1-A456-426655440000")).toBe("123e4567-e12b-12d1-a456-426655440000");
    expect(normalizarChavePix("aleatoria", "abc")).toBeNull();
  });

  it("tira acentos e limita o tamanho dos textos", () => {
    expect(textoPix("São João d'Aliança", 15)).toBe("SAO JOAO D ALIA");
  });
});

describe("Encargos de atraso", () => {
  it("multa fixa + juros simples por dia (igual ao banco)", () => {
    const e = encargos(830, "2026-09-10", "2026-09-20", 2, 1);
    expect(e.dias).toBe(10);
    expect(e.multa.toFixed(2)).toBe("16.60");
    expect(e.juros.toFixed(2)).toBe("2.77");
    expect(e.total.toFixed(2)).toBe("849.37");
  });

  it("sem atraso, sem encargos", () => {
    const e = encargos(830, "2026-09-10", "2026-09-10", 2, 1);
    expect(e.total.toFixed(2)).toBe("830.00");
  });
});

describe("Rótulos", () => {
  it("número da cobrança e situação vencida", () => {
    expect(numeroCobranca({ ano: 2026, numero: 7 })).toBe("0007/2026");
    expect(situacaoExibida({ situacao: "aberta", vencimento: "2026-11-10" }, "2026-11-23").rotulo).toBe("Vencida");
    expect(situacaoExibida({ situacao: "aberta", vencimento: "2026-11-23" }, "2026-11-23").rotulo).toBe("Vence hoje");
    expect(situacaoExibida({ situacao: "paga", vencimento: "2026-11-10" }, "2026-11-23").rotulo).toBe("Paga");
  });
});

describe("Mensagens do robô", () => {
  it("escolhe o texto pela etapa da régua", () => {
    expect(tipoDaMensagem("emissao", null)).toBe("emissao");
    expect(tipoDaMensagem("lembrete", -5)).toBe("antes");
    expect(tipoDaMensagem("lembrete", 0)).toBe("no_dia");
    expect(tipoDaMensagem("lembrete", 10)).toBe("atraso");
    expect(tipoDaMensagem("lembrete", 30)).toBe("formal");
    expect(tipoDaMensagem("pagamento", null)).toBe("pagamento");
  });

  it("usa o texto editado pelo escritório e cai no padrão quando vazio", () => {
    expect(textoDaMensagem("antes", { antes: { assunto: "Oi {cliente}", texto: "" } })).toEqual({ assunto: "Oi {cliente}", texto: MENSAGENS_PADRAO.antes.texto });
    expect(textoDaMensagem("antes", null)).toEqual(MENSAGENS_PADRAO.antes);
  });

  it("preenche as variáveis e deixa as desconhecidas", () => {
    expect(preencher("Olá, {cliente}! {x}", { cliente: "Padaria" })).toBe("Olá, Padaria! {x}");
    expect(resumoWhatsapp("no_dia", { descricao: "Honorários", valor: "R$ 10,00" })).toBe("Honorários (R$ 10,00) vence hoje.");
  });
});
