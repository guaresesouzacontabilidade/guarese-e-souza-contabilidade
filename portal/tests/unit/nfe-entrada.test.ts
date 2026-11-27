import { describe, expect, it } from "vitest";
import { mesclarEntradas, numeroDaChave, totaisPorEmpresa, type FiscalEntrada, type ResumoEntrada } from "@/lib/fiscal/nfe-entrada";

const EMPRESA = "00000000-0000-0000-0000-00000000000a";
const OUTRA = "00000000-0000-0000-0000-00000000000b";
const CNPJ_EMPRESA = "11222333000181";
// UF 17, 09/2026, CNPJ do fornecedor, modelo 55, série 1, número 456
const CHAVE_COM_XML = "17260998765432000198550010000004561876543215";
const CHAVE_SO_RESUMO = "17260955566677000188550020000099991000099991";

function resumo(p: Partial<ResumoEntrada>): ResumoEntrada {
  return {
    empresa_id: EMPRESA,
    chave: CHAVE_SO_RESUMO,
    emitente_documento: "55566677000188",
    emitente_nome: "FORNECEDOR RESUMO",
    emitente_ie: "123",
    data_emissao: "2026-09-10T10:00:00-03:00",
    tipo_operacao: "entrada",
    valor: "321.09",
    situacao: "autorizada",
    ciencia_em: null,
    ciencia_retorno: null,
    documento_id: null,
    ...p,
  };
}

function fiscal(p: Partial<FiscalEntrada>): FiscalEntrada {
  return {
    empresa_id: EMPRESA,
    documento_id: "doc-1",
    chave_acesso: CHAVE_COM_XML,
    numero: "456",
    serie: "1",
    data_emissao: "2026-09-05T08:00:00-03:00",
    emitente_documento: "98765432000198",
    emitente_nome: "FORNECEDOR XML",
    emitente_uf: "SP",
    emitente_ie: null,
    destinatario_documento: CNPJ_EMPRESA,
    destinatario_nome: "PADARIA",
    destinatario_uf: "TO",
    tp_nf: "1",
    valor_total: 1000.5,
    cancelada_evento: false,
    situacao_arquivo: "protocolo_autorizacao_no_arquivo",
    natureza_operacao: "VENDA",
    cfops: ["5102", "5405"],
    ...p,
  };
}

describe("NF-e de entrada (planilha)", () => {
  it("lê número e série da chave de acesso", () => {
    expect(numeroDaChave(CHAVE_COM_XML)).toEqual({ numero: "456", serie: "1" });
    expect(numeroDaChave(CHAVE_SO_RESUMO)).toEqual({ numero: "9999", serie: "2" });
    expect(numeroDaChave("123")).toEqual({ numero: null, serie: null });
    expect(numeroDaChave(null)).toEqual({ numero: null, serie: null });
  });

  it("junta resumos e XML sem repetir a chave; o resumo acrescenta a ciência", () => {
    const linhas = mesclarEntradas(
      [
        resumo({}),
        resumo({ chave: CHAVE_COM_XML, documento_id: "doc-1", ciencia_em: "2026-09-11T12:00:00Z", emitente_ie: "999" }),
      ],
      [fiscal({})],
    );
    expect(linhas).toHaveLength(2);
    const [comXml, soResumo] = linhas;
    expect(comXml).toMatchObject({
      chave: CHAVE_COM_XML,
      numero: "456",
      fornecedor: "FORNECEDOR XML",
      fornecedorIe: "999",
      valor: 1000.5,
      xmlCompleto: true,
      ciencia: "registrada",
      situacao: "Autorizada",
      tipo: "fornecedor",
      cfops: "5102, 5405",
    });
    expect(soResumo).toMatchObject({ chave: CHAVE_SO_RESUMO, numero: "9999", serie: "2", valor: 321.09, xmlCompleto: false, ciencia: "pendente", tipo: "fornecedor" });
  });

  it("marca cancelamento, ciência recusada e nota de entrada do emitente", () => {
    const linhas = mesclarEntradas(
      [
        resumo({ situacao: "cancelada" }),
        resumo({ chave: CHAVE_COM_XML, ciencia_retorno: "596 - Rejeição: evento fora do prazo", tipo_operacao: "saida" }),
      ],
      [],
    );
    const porChave = new Map(linhas.map((l) => [l.chave, l]));
    expect(porChave.get(CHAVE_SO_RESUMO)?.situacao).toBe("Cancelada");
    expect(porChave.get(CHAVE_COM_XML)).toMatchObject({ ciencia: "recusada", cienciaDetalhe: "596 - Rejeição: evento fora do prazo", tipo: "entrada_do_emitente" });
  });

  it("nota de entrada emitida pela própria empresa mostra o destinatário como a outra parte", () => {
    const [l] = mesclarEntradas(
      [],
      [fiscal({ tp_nf: "0", emitente_documento: CNPJ_EMPRESA, emitente_nome: "PADARIA", destinatario_documento: "12345678909", destinatario_nome: "PRODUTOR RURAL", destinatario_uf: "TO" })],
      new Map([[EMPRESA, "11.222.333/0001-81"]]),
    );
    expect(l).toMatchObject({ tipo: "propria", fornecedor: "PRODUTOR RURAL", fornecedorDocumento: "12345678909", fornecedorUf: "TO", fornecedorIe: null });
    // Sem o CNPJ da empresa, a nota com tpNF 0 é tratada como entrada do emitente
    expect(mesclarEntradas([], [fiscal({ tp_nf: "0" })])[0].tipo).toBe("entrada_do_emitente");
  });

  it("a mesma chave em empresas diferentes fica em linhas separadas, e os totais são por empresa", () => {
    const linhas = mesclarEntradas(
      [resumo({}), resumo({ empresa_id: OUTRA }), resumo({ empresa_id: OUTRA, chave: CHAVE_COM_XML, situacao: "cancelada", valor: 50 })],
      [fiscal({ situacao_arquivo: "protocolo_nao_autorizado_no_arquivo", chave_acesso: "17260998765432000198550010000004571876543210" })],
    );
    expect(linhas).toHaveLength(4);
    const t = totaisPorEmpresa(linhas);
    expect(t.get(EMPRESA)).toEqual({ notas: 2, valor: 321.09, comXml: 1, soResumo: 1, canceladas: 1 });
    expect(t.get(OUTRA)).toEqual({ notas: 2, valor: 321.09, comXml: 0, soResumo: 2, canceladas: 1 });
  });
});
