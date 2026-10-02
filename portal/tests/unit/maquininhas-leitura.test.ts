import { describe, expect, it } from "vitest";
import { detectarDelimitador } from "@/lib/extratos/planilha";
import {
  assinaturaCabecalho,
  detectarCabecalho,
  lerParcelas,
  lerSituacao,
  lerVendas,
  localizarCabecalho,
  normalizarBandeira,
  normalizarModalidade,
  sugerirAdquirente,
  sugerirMapeamento,
} from "@/lib/maquininhas/leitura";

// Relatório no formato de uma credenciadora de cartões (linhas de título antes do cabeçalho)
const CARTAO: string[][] = [
  ["Relatório de vendas", "", "", ""],
  ["Período: 01/09/2026 a 30/09/2026"],
  [],
  [
    "Data da venda", "Hora da venda", "Forma de pagamento", "Bandeira", "Quantidade de parcelas", "Valor bruto", "Taxa/tarifa", "Valor líquido",
    "NSU/DOC", "Código de autorização", "Número da máquina", "Status", "Data prevista de pagamento",
  ],
  ["05/09/2026", "10:15", "Crédito à vista", "Visa", "1", "100,00", "-3,15", "96,85", "123456", "A1B2C3", "12345678", "Aprovada", "07/10/2026"],
  ["05/09/2026", "10:20", "Débito", "Maestro", "1", "50,00", "-0,75", "49,25", "123457", "A1B2C4", "12345678", "Aprovada", "06/09/2026"],
  ["06/09/2026", "11:00", "Crédito parcelado loja", "Elo", "3", "300,00", "-14,40", "285,60", "123458", "", "12345678", "Aprovada", ""],
  ["07/09/2026", "12:00", "Crédito à vista", "Visa", "1", "80,00", "-2,52", "77,48", "123459", "", "12345678", "Cancelada", ""],
  ["Total", "", "", "", "", "530,00", "", "", "", "", "", "", ""],
];

describe("cabeçalho e colunas", () => {
  it("CSV brasileiro: separador ';' mesmo com a vírgula decimal", () => {
    expect(detectarDelimitador("Relatório de vendas\r\nData;Valor bruto;Valor líquido\r\n01/09/2026;154,85;150,22\r\n02/09/2026;10,00;9,70")).toBe(";");
    expect(detectarDelimitador("Data\tValor\n01/09/2026\t154,85")).toBe("\t");
    expect(detectarDelimitador("Data,Valor\n2026-09-01,154.85")).toBe("");
  });

  it("acha o cabeçalho depois das linhas de título", () => {
    expect(detectarCabecalho(CARTAO)).toBe(3);
  });

  it("sugere cada coluna pelo nome (data da venda, não a hora nem a previsão)", () => {
    const m = sugerirMapeamento(CARTAO[3], 3);
    expect(m).toMatchObject({
      linhaCabecalho: 3,
      data: 0,
      modalidade: 2,
      bandeira: 3,
      parcelas: 4,
      bruto: 5,
      taxa: 6,
      liquido: 7,
      nsu: 8,
      autorizacao: 9,
      terminal: 10,
      situacao: 11,
      previsao: 12,
    });
    expect(m.taxa_percentual).toBeNull();
  });

  it("assinatura pelos nomes das colunas e localização em outro arquivo igual", () => {
    const assinatura = assinaturaCabecalho([...CARTAO[3], "", ""]);
    expect(assinatura.startsWith("data da venda|hora da venda|forma de pagamento|bandeira|")).toBe(true);
    expect(assinatura.endsWith("|data prevista de pagamento")).toBe(true);
    const outro = [["Relatório de vendas"], CARTAO[3], CARTAO[4]];
    expect(localizarCabecalho(outro, assinatura)).toBe(1);
  });
});

describe("leitura das vendas", () => {
  const m = sugerirMapeamento(CARTAO[3], 3);
  const r = lerVendas(CARTAO, m, "cartao");

  it("lê as vendas, ignora o total e marca a cancelada", () => {
    expect(r.vendas).toHaveLength(4);
    expect(r.invalidas).toEqual([]);
    expect(r.ignoradas).toBe(1);
    expect(r.vendas[0]).toMatchObject({
      data_venda: "2026-09-05",
      bandeira: "VISA",
      modalidade: "credito_vista",
      parcelas: 1,
      valor_bruto: "100.00",
      valor_taxa: "3.15",
      valor_liquido: "96.85",
      nsu: "123456",
      autorizacao: "A1B2C3",
      terminal: "12345678",
      data_prevista: "2026-10-07",
      situacao: "aprovada",
      linha: 5,
    });
    expect(r.vendas[1]).toMatchObject({ bandeira: "MASTERCARD", modalidade: "debito", valor_taxa: "0.75" });
    expect(r.vendas[2]).toMatchObject({ bandeira: "ELO", modalidade: "credito_parcelado", parcelas: 3, valor_taxa: "14.40" });
    expect(r.vendas[3].situacao).toBe("cancelada");
  });

  it("a taxa cobrada é a diferença entre o bruto e o líquido (inclui antecipação)", () => {
    const linhas = [CARTAO[3], ["05/09/2026", "", "Crédito à vista", "Visa", "1", "100,00", "-2,00", "96,50", "9", "", "", "Aprovada", ""]];
    expect(lerVendas(linhas, { ...m, linhaCabecalho: 0 }, "cartao").vendas[0].valor_taxa).toBe("3.50");
  });

  it("chave da venda: pelo NSU; sem NSU, vendas iguais no mesmo dia não se confundem", () => {
    expect(r.vendas[0].chave_unica).toBe("2026-09-05|N:123456|100.00|1");
    const semNsu = sugerirMapeamento(["Data", "Valor bruto", "Valor líquido", "Bandeira"], 0);
    const v = lerVendas(
      [
        ["Data", "Valor bruto", "Valor líquido", "Bandeira"],
        ["01/09/2026", "10,00", "9,70", "Visa"],
        ["01/09/2026", "10,00", "9,70", "Visa"],
      ],
      semNsu,
      "cartao",
    ).vendas;
    expect(v.map((x) => x.chave_unica)).toEqual(["2026-09-01|10.00|1|VISA|outros||1", "2026-09-01|10.00|1|VISA|outros||2"]);
  });

  it("taxa em percentual quando não há líquido nem valor da taxa", () => {
    const cab = ["Data da transação", "Valor da venda", "Taxa (%)"];
    const mp = sugerirMapeamento(cab, 0);
    expect(mp).toMatchObject({ data: 0, bruto: 1, taxa_percentual: 2, taxa: null });
    expect(lerVendas([cab, ["2026-09-03", "200,00", "2,5%"]], mp, "cartao").vendas[0]).toMatchObject({ valor_taxa: "5.00", valor_liquido: "195.00" });
  });

  it("linhas com problema vão para a lista de não lidas", () => {
    const cab = ["Data da venda", "Valor bruto", "Valor líquido"];
    const r2 = lerVendas([cab, ["xx", "10,00", "9,00", "a"], ["01/09/2026", "0,00", "0,00"], ["01/09/2026", "10,00", "11,00"]], sugerirMapeamento(cab, 0), "cartao");
    expect(r2.vendas).toEqual([]);
    expect(r2.invalidas.map((i) => i.motivo)).toEqual([
      "Data da venda ausente ou inválida",
      "Valor da venda ausente ou zero",
      "Valor líquido maior que o valor da venda",
    ]);
  });

  it("valor negativo é estorno (fica fora da conta)", () => {
    const cab = ["Data da venda", "Valor bruto", "Valor líquido", "NSU"];
    expect(lerVendas([cab, ["02/09/2026", "-50,00", "-48,50", "777"]], sugerirMapeamento(cab, 0), "cartao").vendas[0]).toMatchObject({
      situacao: "cancelada",
      valor_bruto: "50.00",
      valor_taxa: "1.50",
    });
  });
});

describe("frota, benefícios e convênios", () => {
  it("frota: toda venda é da modalidade frota", () => {
    const cab = ["Data Transação", "Estabelecimento", "Produto", "Valor", "Taxa Adm (%)", "Valor Líquido", "Autorização"];
    const m = sugerirMapeamento(cab, 0);
    expect(m).toMatchObject({ data: 0, modalidade: 2, bruto: 3, taxa_percentual: 4, liquido: 5, autorizacao: 6 });
    const v = lerVendas([cab, ["10/09/2026", "Posto Exemplo", "Diesel S10", "1.250,00", "3,5", "1.206,25", "998877"]], m, "frota").vendas[0];
    expect(v).toMatchObject({ modalidade: "frota", valor_bruto: "1250.00", valor_taxa: "43.75", chave_unica: "2026-09-10|A:998877|1250.00|1" });
  });

  it("benefício: vale-refeição pela credenciadora do vale", () => {
    const cab = ["Data", "Cartão", "Valor bruto", "Valor líquido"];
    const v = lerVendas([cab, ["11/09/2026", "Alelo Refeição", "40,00", "37,20"]], sugerirMapeamento(cab, 0), "beneficio").vendas[0];
    expect(v).toMatchObject({ modalidade: "voucher", valor_taxa: "2.80" });
  });

  it("voucher passado na maquininha de cartão", () => {
    expect(normalizarModalidade("Voucher", 1, "cartao")).toBe("voucher");
    expect(normalizarModalidade("Refeição", 1, "cartao")).toBe("voucher");
  });

  it("convênio sem modalidade informada", () => {
    expect(normalizarModalidade("", 1, "convenio")).toBe("outros");
    expect(normalizarModalidade("", 4, "convenio")).toBe("credito_parcelado");
  });
});

describe("normalização", () => {
  it("bandeiras", () => {
    expect(normalizarBandeira("MASTER")).toBe("MASTERCARD");
    expect(normalizarBandeira("Mastercard Débito")).toBe("MASTERCARD");
    expect(normalizarBandeira("VISA ELECTRON")).toBe("VISA");
    expect(normalizarBandeira("American Express")).toBe("AMEX");
    expect(normalizarBandeira("Hipercard")).toBe("HIPERCARD");
    expect(normalizarBandeira("Hiper")).toBe("HIPER");
    expect(normalizarBandeira("Sodexo")).toBe("PLUXEE");
    expect(normalizarBandeira("Ben Visa Vale")).toBe("BEN");
    expect(normalizarBandeira("Ticket Log")).toBe("TICKET LOG");
    expect(normalizarBandeira("Ticket Restaurante")).toBe("TICKET");
    expect(normalizarBandeira("Bandeira Regional")).toBe("BANDEIRA REGIONAL");
    expect(normalizarBandeira("Débito")).toBeNull();
    expect(normalizarBandeira("Crédito à vista", true)).toBeNull();
  });

  it("parcelas", () => {
    expect(lerParcelas("3x")).toBe(3);
    expect(lerParcelas("1/3")).toBe(3);
    expect(lerParcelas("Parcela 2 de 6")).toBe(6);
    expect(lerParcelas("À vista")).toBe(1);
    expect(lerParcelas("12")).toBe(12);
    expect(lerParcelas("Crédito parcelado em 10")).toBe(10);
    expect(lerParcelas("")).toBeNull();
  });

  it("modalidades", () => {
    expect(normalizarModalidade("Crédito à vista", 1, "cartao")).toBe("credito_vista");
    expect(normalizarModalidade("Crédito 1x", 1, "cartao")).toBe("credito_vista");
    expect(normalizarModalidade("Crédito", 3, "cartao")).toBe("credito_parcelado");
    expect(normalizarModalidade("Parcelado lojista", 1, "cartao")).toBe("credito_parcelado");
    expect(normalizarModalidade("Parcelado emissor", 1, "cartao")).toBe("credito_vista");
    expect(normalizarModalidade("Débito Visa Electron", 1, "cartao")).toBe("debito");
    expect(normalizarModalidade("Pré-pago", 1, "cartao")).toBe("pre_pago");
    expect(normalizarModalidade("PIX", 1, "cartao")).toBe("pix");
    expect(normalizarModalidade("", 1, "frota")).toBe("frota");
    expect(normalizarModalidade("", 1, "cartao")).toBe("outros");
  });

  it("situação da venda", () => {
    expect(lerSituacao("Aprovada")).toBe("aprovada");
    expect(lerSituacao("")).toBe("aprovada");
    expect(lerSituacao("Cancelada")).toBe("cancelada");
    expect(lerSituacao("Estornada")).toBe("cancelada");
    expect(lerSituacao("Negada")).toBe("cancelada");
    expect(lerSituacao("Chargeback")).toBe("chargeback");
  });

  it("adquirente pelo nome do arquivo", () => {
    const catalogo = [
      { codigo: "cielo", nome: "Cielo" },
      { codigo: "pagbank", nome: "PagBank / PagSeguro (Moderninha)" },
      { codigo: "ticket", nome: "Ticket (Edenred)" },
      { codigo: "ticket_log", nome: "Ticket Log (Edenred)" },
      { codigo: "mercado_pago", nome: "Mercado Pago (Point)" },
    ];
    expect(sugerirAdquirente(["Relatorio_Cielo_09-2026.csv"], catalogo)?.codigo).toBe("cielo");
    expect(sugerirAdquirente(["vendas pagseguro setembro.xlsx"], catalogo)?.codigo).toBe("pagbank");
    expect(sugerirAdquirente(["ticket log setembro.csv"], catalogo)?.codigo).toBe("ticket_log");
    expect(sugerirAdquirente(["relatorio-mercado-pago.csv"], catalogo)?.codigo).toBe("mercado_pago");
    expect(sugerirAdquirente(["extrato.csv"], catalogo)).toBeNull();
  });
});
