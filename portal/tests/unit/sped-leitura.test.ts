import { describe, expect, it } from "vitest";
import { dvChave } from "@/lib/fiscal/chave";
import { dataSped, ehSped, lerCabecalhoSped, lerSped, valorSped } from "@/lib/sped/leitura";

// EFD ICMS/IPI fictícia (setembro/2026): uma venda, uma compra para revenda,
// uma venda cancelada; apuração com R$ 180,00 a recolher.
const CNPJ = "11444777000161";
function chave(cnpj: string, numero: number) {
  const base = `17${"2609"}${cnpj}55001${String(numero).padStart(9, "0")}1${String(numero).padStart(8, "0")}`;
  return `${base}${dvChave(base)}`;
}
const K_VENDA = chave(CNPJ, 1001);
const K_COMPRA = chave("33444555000191", 5501);
const K_CANCELADA = chave(CNPJ, 1002);

const vazio = (n: number) => Array(n).fill("").join("|");
const SPED = [
  `|0000|020|0|01092026|30092026|EMPRESA FICTICIA COMERCIO LTDA|${CNPJ}||TO|123456789|1721000|||A|1|`,
  "|0001|0|",
  "|0150|C001|CLIENTE FICTICIO LTDA|1058|98765432000198||||1721000||RUA A|1||CENTRO|",
  "|0150|F001|FORNECEDOR FICTICIO SA|1058|33444555000191||||3550308||RUA B|2||CENTRO|",
  "|0200|P1|PRODUTO FICTICIO|||UN|00|22021000||||18,00||",
  "|0990|6|",
  "|C001|0|",
  `|C100|1|0|C001|55|00|001|000001001|${K_VENDA}|05092026|05092026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|1000,00|180,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
  "|C190|000|5102|18,00|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00||",
  `|C100|0|1|F001|55|00|001|000005501|${K_COMPRA}|10092026|12092026|2000,00|1|0,00|0,00|2000,00|1|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
  `|C170|1|P1||100|UN|2000,00|0,00|0|000|1102||0,00|0,00|0,00|0,00|0,00|0,00|0|||${vazio(14)}|`,
  "|C190|000|1102|0,00|2000,00|0,00|0,00|0,00|0,00|0,00|0,00||",
  `|C100|1|0||55|02|001|000001002|${K_CANCELADA}|${vazio(19)}|`,
  "|C990|9|",
  "|E001|0|",
  "|E100|01092026|30092026|",
  "|E110|180,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|180,00|0,00|180,00|0,00|0,00|",
  "|E990|4|",
  "|9001|0|",
  "|9900|0000|1|",
  "|9990|3|",
  "|9999|22|",
  "SBRCAAEPDR%%assinatura digital (ignorada)%%",
].join("\r\n");

describe("valores e datas do SPED", () => {
  it("datas ddmmaaaa e valores com vírgula", () => {
    expect(dataSped("05092026")).toBe("2026-09-05");
    expect(dataSped("31022026")).toBeNull();
    expect(dataSped("")).toBeNull();
    expect(valorSped("1234,5")).toBe("1234.50");
    expect(valorSped("0,00")).toBe("0.00");
    expect(valorSped("")).toBeNull();
    expect(valorSped("1.234,50")).toBeNull();
  });
});

describe("cabeçalho (registro 0000)", () => {
  it("EFD ICMS/IPI: período, CNPJ, UF, perfil e finalidade", () => {
    expect(lerCabecalhoSped(SPED.split("\r\n")[0])).toEqual({
      tipo: "efd_icms_ipi",
      versao_leiaute: "020",
      finalidade: "original",
      inicio: "2026-09-01",
      fim: "2026-09-30",
      nome: "EMPRESA FICTICIA COMERCIO LTDA",
      cnpj: CNPJ,
      cpf: null,
      uf: "TO",
      ie: "123456789",
      perfil: "A",
    });
  });

  it("EFD-Contribuições é reconhecida, mas ainda não lida", () => {
    const contrib = `|0000|006|0|||01092026|30092026|EMPRESA FICTICIA COMERCIO LTDA|${CNPJ}|TO|1721000||00|1|`;
    expect(lerCabecalhoSped(contrib)).toMatchObject({ tipo: "efd_contribuicoes", inicio: "2026-09-01", fim: "2026-09-30", cnpj: CNPJ });
    const r = lerSped(`${contrib}\r\n|0001|0|\r\n|9999|3|`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("nao_suportado");
      expect(r.cabecalho?.tipo).toBe("efd_contribuicoes");
    }
  });

  it("arquivo que não é SPED", () => {
    expect(ehSped("Data;Valor\n01/09/2026;10,00")).toBe(false);
    expect(ehSped(SPED)).toBe(true);
    const r = lerSped("qualquer coisa");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_e_sped");
  });
});

describe("notas escrituradas (C100/C190) e apuração (E110)", () => {
  const r = lerSped(SPED);
  if (!r.ok) throw new Error(r.mensagem);
  const d = r.dados;

  it("lê as três notas com o participante e os CFOP", () => {
    expect(d.documentos).toHaveLength(3);
    expect(d.documentos[0]).toMatchObject({
      ind_oper: "1",
      ind_emit: "0",
      cod_mod: "55",
      cod_sit: "00",
      serie: "001",
      numero: "1001",
      chave: K_VENDA,
      dt_doc: "2026-09-05",
      vl_doc: "1000.00",
      vl_icms: "180.00",
      vl_icms_st: "0.00",
      vl_ipi: "0.00",
      participante_nome: "CLIENTE FICTICIO LTDA",
      participante_documento: "98765432000198",
      cfops: ["5102"],
    });
    expect(d.documentos[1]).toMatchObject({ ind_oper: "0", ind_emit: "1", dt_e_s: "2026-09-12", vl_icms: "0.00", cfops: ["1102"] });
    expect(d.documentos[2]).toMatchObject({ cod_sit: "02", chave: K_CANCELADA, vl_doc: null, dt_doc: null, cfops: [] });
  });

  it("resume por CFOP e lê a apuração do ICMS", () => {
    expect(d.analitico).toEqual([
      { cfop: "1102", valor_operacao: "2000.00", base_icms: "0.00", icms: "0.00", icms_st: "0.00", ipi: "0.00" },
      { cfop: "5102", valor_operacao: "1000.00", base_icms: "1000.00", icms: "180.00", icms_st: "0.00", ipi: "0.00" },
    ]);
    expect(d.apuracao).toMatchObject({ debitos: "180.00", creditos: "0.00", saldo_devedor: "180.00", a_recolher: "180.00", saldo_credor_transportar: "0.00" });
  });

  it("para no registro 9999 (a assinatura digital fica de fora) e avisa quando ele falta", () => {
    expect(d.avisos).toEqual([]);
    const semFim = lerSped(SPED.split("\r\n").slice(0, 12).join("\n"));
    expect(semFim.ok && semFim.dados.avisos[0]).toMatch(/9999/);
  });
});
