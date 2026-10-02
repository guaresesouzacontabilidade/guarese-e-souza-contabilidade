import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerXmlFiscal, categoriaDoXml, type NotaLida, type EventoLido } from "@/lib/fiscal/xml";
import { chaveValida, partesChave } from "@/lib/fiscal/chave";

const fixture = (n: string) => readFileSync(join(__dirname, "../fixtures", n), "utf8");
const EMPRESA = { documento: "11222333000181" };

describe("chave de acesso", () => {
  it("valida o dígito verificador", () => {
    expect(chaveValida("17260911222333000181550010000001231123456785")).toBe(true);
    expect(chaveValida("17260911222333000181550010000001231123456784")).toBe(false);
    expect(chaveValida("123")).toBe(false);
  });
  it("decompõe a chave", () => {
    const p = partesChave("17260911222333000181550010000001231123456785")!;
    expect(p.modelo).toBe("55");
    expect(p.numero).toBe("123");
    expect(p.documentoEmitente).toBe("11222333000181");
  });
});

describe("NF-e de saída", () => {
  const r = lerXmlFiscal(fixture("nfe-saida.xml"), EMPRESA);
  it("lê os campos principais sem perder precisão", () => {
    expect(r.sucesso).toBe(true);
    const n = (r as { dados: NotaLida }).dados;
    expect(n.tipo).toBe("nota");
    expect(n.tipo_documento).toBe("NF-e");
    expect(n.chave_acesso).toBe("17260911222333000181550010000001231123456785");
    expect(n.numero).toBe("123");
    expect(n.serie).toBe("1");
    expect(n.valor_total).toBe("1500.00");
    expect(n.valor_produtos).toBe("1500.10");
    expect(n.valor_desconto).toBe("0.10");
    expect(n.emitente_documento).toBe("11222333000181");
    expect(n.destinatario_documento).toBe("98765432000198");
    expect(n.operacao).toBe("saida");
    expect(n.relacionado_empresa).toBe(true);
    expect(n.itens).toHaveLength(2);
    expect(n.itens[1].valor_unitario).toBe("500.1000000000");
    expect(n.cfops).toEqual(["5102"]);
    expect(n.situacao_arquivo).toBe("protocolo_autorizacao_no_arquivo");
    expect(n.protocolo?.numero).toBe("317260000000001");
    expect(n.tributos.total_tributos_aprox).toBe("210.15");
  });
  it("sugere contas a receber pelas duplicatas", () => {
    const n = (r as { dados: NotaLida }).dados;
    expect(n.sugestao?.tipo).toBe("receber");
    expect(n.sugestao?.categoria_sistema).toBe("VENDAS");
    expect(n.sugestao?.parcelas).toEqual([
      { numero: 1, vencimento: "2026-10-15", valor: "750.00" },
      { numero: 2, vencimento: "2026-11-15", valor: "750.00" },
    ]);
    expect(categoriaDoXml(n)).toBe("nfe_saida_xml");
  });
});

describe("NF-e de entrada", () => {
  it("identifica a empresa como destinatária e alerta sobre a falta de protocolo", () => {
    const r = lerXmlFiscal(fixture("nfe-entrada.xml"), EMPRESA);
    expect(r.sucesso).toBe(true);
    const n = (r as { dados: NotaLida }).dados;
    expect(n.operacao).toBe("entrada");
    expect(n.situacao_arquivo).toBe("sem_protocolo");
    expect(n.avisos.join(" ")).toMatch(/não contém protocolo/);
    expect(n.sugestao?.tipo).toBe("pagar");
    expect(n.sugestao?.categoria_sistema).toBeNull();
    expect(n.tributos.ipi).toBe("16.50");
    expect(categoriaDoXml(n)).toBe("nfe_entrada_xml");
  });
  it("não relaciona nota de outra empresa", () => {
    const r = lerXmlFiscal(fixture("nfe-entrada.xml"), { documento: "32165498000139" });
    const n = (r as { dados: NotaLida }).dados;
    expect(n.relacionado_empresa).toBe(false);
    expect(n.operacao).toBe("nao_relacionada");
    expect(n.sugestao).toBeNull();
    expect(categoriaDoXml(n)).toBeNull();
  });
});

describe("eventos", () => {
  it("lê cancelamento com identificador e protocolo", () => {
    const r = lerXmlFiscal(fixture("evento-cancelamento.xml"), EMPRESA);
    expect(r.sucesso).toBe(true);
    const e = (r as { dados: EventoLido }).dados;
    expect(e.tipo).toBe("evento");
    expect(e.tipo_evento).toBe("110111");
    expect(e.cancelamento).toBe(true);
    expect(e.cstat).toBe("135");
    expect(e.identificador).toBe("ID1101111726091122233300018155001000000124122222222401");
    expect(e.justificativa).toMatch(/Erro na digitacao/);
    expect(categoriaDoXml(e)).toBe("eventos_fiscais");
  });
});

describe("CT-e", () => {
  it("identifica a empresa como tomadora (remetente com toma=0)", () => {
    const r = lerXmlFiscal(fixture("cte-tomador.xml"), EMPRESA);
    const n = (r as { dados: NotaLida }).dados;
    expect(n.tipo_documento).toBe("CT-e");
    expect(n.operacao).toBe("entrada");
    expect(n.valor_total).toBe("250.00");
    expect(n.sugestao?.tipo).toBe("pagar");
    expect(categoriaDoXml(n)).toBe("cte_xml");
  });
});

describe("NFS-e", () => {
  it("padrão nacional: prestador = empresa → receber pelo valor líquido", () => {
    const r = lerXmlFiscal(fixture("nfse-nacional.xml"), EMPRESA);
    const n = (r as { dados: NotaLida }).dados;
    expect(n.modelo).toBe("nfse_nacional");
    expect(n.operacao).toBe("saida");
    expect(n.valor_total).toBe("1900.00");
    expect(n.valor_servicos).toBe("2000.00");
    expect(n.tributos.iss).toBe("100.00");
    expect(n.sugestao?.categoria_sistema).toBe("SERVICOS");
    expect(n.identificador).toMatch(/^NFS/);
  });
  it("ABRASF: tomador = empresa → pagar", () => {
    const r = lerXmlFiscal(fixture("nfse-abrasf.xml"), EMPRESA);
    const n = (r as { dados: NotaLida }).dados;
    expect(n.modelo).toBe("nfse_abrasf");
    expect(n.operacao).toBe("entrada");
    expect(n.identificador).toBe("NFSE:45612378000184:9001:1721000");
    expect(n.sugestao?.tipo).toBe("pagar");
  });
});

describe("segurança e formatos não suportados", () => {
  it("recusa DOCTYPE/ENTITY (XXE)", () => {
    const r = lerXmlFiscal(fixture("xxe.xml"), EMPRESA);
    expect(r.sucesso).toBe(false);
    expect((r as { motivo: string }).motivo).toBe("invalido");
  });
  it("informa formato não suportado", () => {
    const r = lerXmlFiscal(fixture("desconhecido.xml"), EMPRESA);
    expect(r.sucesso).toBe(false);
    expect((r as { motivo: string }).motivo).toBe("nao_suportado");
  });
  it("informa XML malformado", () => {
    const r = lerXmlFiscal("<NFe><infNFe>", EMPRESA);
    expect(r.sucesso).toBe(false);
  });
});
