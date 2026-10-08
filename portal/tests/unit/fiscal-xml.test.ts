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
    expect(n.tributos).toMatchObject({ aliq_iss: "5", base_iss: "800.00", tp_ret_iss: "1" });
  });
  it("padrão nacional (leitura 3): regime do prestador, ISS retido e retenções federais", () => {
    const r = lerXmlFiscal(fixture("nfse-nacional-retencoes.xml"), EMPRESA);
    const n = (r as { dados: NotaLida }).dados;
    expect(n.leitura_versao).toBe(4);
    expect(n.tributos).toMatchObject({
      iss: "500.00",
      iss_retido: "sim",
      tp_ret_iss: "2",
      trib_iss: "1",
      aliq_iss: "5.00",
      base_iss: "10000.00",
      op_simp_nac: "3",
      reg_ap_trib_sn: "1",
      c_trib_nac: "170101",
      cst_pis_cofins: "00",
      tp_ret_pis_cofins: "3",
      ret_irrf: "150.00",
      ret_csll: "465.00",
      total_ret: "1115.00",
      loc_incid: "1718204",
    });
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

describe("códigos fiscais de cada item (leitura versão 2)", () => {
  const FARMACIA = { documento: "11222333000181" };
  it("compra: CST, ST, PIS/Cofins monofásico, GTIN, CEST e IBS/CBS por item", () => {
    const r = lerXmlFiscal(fixture("nfe-compra-farmacia.xml"), FARMACIA);
    expect(r.sucesso).toBe(true);
    const n = (r as { dados: NotaLida }).dados;
    expect(n.avisos).toEqual([]);
    expect(n.operacao).toBe("entrada");
    expect(n.leitura_versao).toBe(4);
    expect(n).toMatchObject({ crt_emitente: "3", consumidor_final: false, id_destino: "1", ind_ie_dest: "1" });
    expect(n.tributos).toMatchObject({ icms_st: "108.00", ibs: "1.00", cbs: "9.00", base_ibscbs: "1000.00" });
    const [remedio, shampoo, biscoito] = n.itens;
    expect(remedio).toMatchObject({ ncm: "30049099", gtin: "7891234567895", cest: "1300100", cfop: "5405" });
    expect(remedio.tributos).toEqual({
      orig: "0", cst_icms: "10", bc_icms: "500.00", p_icms: "20.00", icms: "100.00", bc_icms_st: "800.00", p_icms_st: "20.00", icms_st: "60.00",
      cst_pis: "04", cst_cofins: "04",
      cst_ibscbs: "000", cclasstrib: "000001", bc_ibscbs: "500.00", p_ibs_uf: "0.1000", ibs_uf: "0.50", p_ibs_mun: "0.0000", ibs_mun: "0.00",
      ibs: "0.50", p_cbs: "0.9000", cbs: "4.50",
    });
    // "SEM GTIN" não é código de barras
    expect(shampoo.gtin).toBeNull();
    expect(shampoo.tributos).toMatchObject({ cst_pis: "04", icms_st: "48.00" });
    expect(biscoito.tributos).toMatchObject({ cst_icms: "00", cst_pis: "01", p_pis: "1.65", pis: "1.65", cst_cofins: "01", cofins: "7.60" });
  });

  it("leitura 4: frete, seguro e outras despesas por item, crédito do Simples e DIFAL de destino", () => {
    const xml = fixture("nfe-compra-farmacia.xml")
      .replace("<vProd>100.00</vProd><indTot>1</indTot>", "<vProd>100.00</vProd><vFrete>12.50</vFrete><vSeg>1.00</vSeg><vOutro>2.00</vOutro><indTot>1</indTot>")
      .replace(
        "<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>20.00</pICMS><vICMS>20.00</vICMS></ICMS00>",
        "<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>1.25</pCredSN><vCredICMSSN>1.25</vCredICMSSN></ICMSSN101>",
      )
      .replace("<vOutro>0.00</vOutro><vNF>", "<vOutro>0.00</vOutro><vICMSUFDest>30.00</vICMSUFDest><vFCPUFDest>5.00</vFCPUFDest><vNF>");
    const n = (lerXmlFiscal(xml, FARMACIA) as { dados: NotaLida }).dados;
    const biscoito = n.itens[2];
    expect(biscoito.tributos).toMatchObject({ frete: "12.50", seguro: "1.00", outros: "2.00", csosn: "101", p_cred_sn: "1.25", cred_icms_sn: "1.25" });
    expect(n.itens[0].tributos.frete).toBeUndefined();
    expect(n.tributos).toMatchObject({ difal_destino: "30.00", fcp_destino: "5.00" });
  });

  it("NFC-e do Simples: CSOSN, consumidor final e sem grupo de IBS/CBS", () => {
    const n = (lerXmlFiscal(fixture("nfce-venda-farmacia.xml"), FARMACIA) as { dados: NotaLida }).dados;
    expect(n.modelo).toBe("65");
    expect(n.operacao).toBe("saida");
    expect(n).toMatchObject({ crt_emitente: "1", consumidor_final: true, ind_ie_dest: null });
    expect(n.itens.map((i) => [i.ncm, i.cfop, i.tributos.csosn, i.tributos.cst_pis])).toEqual([
      ["30049099", "5102", "102", "49"],
      ["33051000", "5405", "500", "49"],
      ["19053100", "5102", "102", "49"],
    ]);
    expect(n.itens.some((i) => "cst_ibscbs" in i.tributos)).toBe(false);
  });

  it("autopeças do regime normal: PIS/Cofins cobrados no item", () => {
    const n = (lerXmlFiscal(fixture("nfe-venda-autopecas.xml"), { documento: "55666777000190" }) as { dados: NotaLida }).dados;
    expect(n.crt_emitente).toBe("3");
    expect(n.itens[0].tributos).toMatchObject({ cst_pis: "01", p_pis: "0.65", pis: "7.80", cst_cofins: "01", cofins: "36.00" });
  });
});
