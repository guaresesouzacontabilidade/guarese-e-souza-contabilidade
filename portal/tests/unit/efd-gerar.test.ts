import { describe, expect, it } from "vitest";
import { calcularIcms, type DadosIcms, type NotaEntradaDados } from "@/lib/calculos/icms";
import { cfopEntrada, cstEntrada, dataCampo, gerarEfd, numeroCampo, paraLatin1, textoCampo, versaoLeiaute, type DadosEfd, type NotaEfdDados } from "@/lib/efd/gerar";
import { lerSped } from "@/lib/sped/leitura";
import type { ComplementoNota, ParticipanteNota } from "@/lib/fiscal/xml";

/** Empresa e notas fictícias (CNPJ de teste). */
const CNPJ = "11222333000181";
const COMP = "2026-09-01";

const participante = (documento: string, nome: string, uf: string, cmun: string, ie: string | null = null): ParticipanteNota => ({
  documento,
  nome,
  ie,
  uf,
  cmun,
  municipio: "Cidade",
  cep: "78000000",
  logradouro: "Rua Teste",
  numero: "10",
  complemento: null,
  bairro: "Centro",
  pais: "1058",
  suframa: null,
});
const EMPRESA_P = participante(CNPJ, "VENDEDORA TESTE LTDA (FICTICIA)", "MT", "5103403", "131234567");
const complemento = (emit: ParticipanteNota, dest: ParticipanteNota, extra: Partial<ComplementoNota> = {}): ComplementoNota => ({
  emitente: emit,
  destinatario: dest,
  data_local: "2026-09-10",
  data_saida: null,
  mod_frete: "9",
  ind_pag: "0",
  cte: null,
  ...extra,
});

let seq = 0;
function nfe(p: Partial<NotaEfdDados> & Pick<NotaEfdDados, "operacao" | "emitente_documento" | "itens">): NotaEfdDados {
  seq++;
  const total = p.itens.reduce((s, i) => s + Number(i.valor ?? 0), 0);
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    modelo: "55",
    chave: null,
    numero: String(100 + seq),
    serie: "1",
    data_emissao: "2026-09-10T10:00:00-04:00",
    tp_nf: "1",
    finalidade: "1",
    natureza: "Venda",
    emitente_nome: `Emitente ${seq}`,
    emitente_uf: "GO",
    emitente_ie: null,
    destinatario_documento: CNPJ,
    destinatario_nome: "VENDEDORA TESTE LTDA (FICTICIA)",
    destinatario_uf: "MT",
    valor_total: total,
    valor_produtos: total,
    valor_desconto: 0,
    valor_frete: 0,
    valor_outros: 0,
    tributos: {},
    cfops: [],
    cancelada: false,
    duplicatas: 0,
    pagamentos: [],
    complemento: null,
    leitura: 5,
    ...p,
  };
}
const item = (n: number, x: Partial<NotaEfdDados["itens"][number]> = {}): NotaEfdDados["itens"][number] => ({
  n,
  codigo: `P${n}`,
  descricao: `PRODUTO ${n}`,
  ncm: "10059010",
  cfop: "6102",
  unidade: "SC",
  quantidade: "10.0000",
  valor: 0,
  desconto: 0,
  tributos: {},
  gtin: null,
  cest: null,
  ex_tipi: null,
  produto: null,
  ...x,
});

const GO = participante("45612378000184", "FORNECEDOR GO LTDA (FICTICIO)", "GO", "5208707", "101234567");
const SN = participante("98765432000198", "FORNECEDOR SIMPLES (FICTICIO)", "MT", "5103403", "132222222");
const CLIENTE = participante("33444555000106", "CLIENTE SP LTDA (FICTICIO)", "SP", "3550308", "111111111111");
const TRANSP = participante("22333444000105", "TRANSPORTADORA (FICTICIA)", "MT", "5103403", "133333333");

function cenario() {
  seq = 0;
  // 1. Compra de outro estado: item para revenda (crédito) e item para uso e consumo (sem crédito)
  const compra = nfe({
    operacao: "entrada",
    emitente_documento: GO.documento,
    emitente_nome: GO.nome,
    complemento: complemento(GO, EMPRESA_P, { mod_frete: "1" }),
    duplicatas: 1,
    itens: [
      item(1, { valor: "1000.00", tributos: { orig: "0", cst_icms: "00", bc_icms: "1000.00", p_icms: "12.00", icms: "120.00" } }),
      item(2, { valor: "200.00", unidade: "UN", ncm: "84713012", tributos: { orig: "0", cst_icms: "00", bc_icms: "200.00", p_icms: "12.00", icms: "24.00" } }),
    ],
  });
  // 2. Compra no estado com ICMS-ST (sem crédito; o ST entra no valor do item)
  const comSt = nfe({
    operacao: "entrada",
    emitente_documento: "55666777000108",
    emitente_uf: "MT",
    complemento: complemento(participante("55666777000108", "DISTRIBUIDORA ST (FICTICIA)", "MT", "5103403", "134444444"), EMPRESA_P),
    valor_total: "550.00",
    itens: [item(1, { cfop: "5405", valor: "500.00", tributos: { orig: "0", cst_icms: "10", icms_st: "50.00", bc_icms_st: "600.00" } })],
  });
  // 3. Compra de fornecedor do Simples com crédito (CSOSN 101)
  const simples = nfe({
    operacao: "entrada",
    emitente_documento: SN.documento,
    emitente_uf: "MT",
    complemento: complemento(SN, EMPRESA_P),
    itens: [item(1, { cfop: "5102", valor: "1000.00", tributos: { orig: "0", csosn: "101", p_cred_sn: "3.00", cred_icms_sn: "30.00" } })],
  });
  // 4. Venda para outro estado com frete do emitente no item
  const venda = nfe({
    operacao: "saida",
    emitente_documento: CNPJ,
    emitente_uf: "MT",
    destinatario_documento: CLIENTE.documento,
    destinatario_nome: CLIENTE.nome,
    destinatario_uf: "SP",
    valor_total: "5100.00",
    valor_produtos: "5000.00",
    valor_frete: "100.00",
    complemento: complemento(EMPRESA_P, CLIENTE, { mod_frete: "0", data_saida: "2026-09-11" }),
    itens: [item(1, { valor: "5000.00", tributos: { orig: "0", cst_icms: "00", bc_icms: "5100.00", p_icms: "12.00", icms: "612.00", frete: "100.00" } })],
  });
  // 5. Venda cancelada (sai só com os campos mínimos)
  const cancelada = nfe({ operacao: "saida", emitente_documento: CNPJ, cancelada: true, complemento: complemento(EMPRESA_P, CLIENTE), itens: [item(1, { valor: "10.00" })] });
  // 6. Compra cancelada pelo fornecedor (fica de fora)
  const canceladaTerceiro = nfe({ operacao: "entrada", emitente_documento: GO.documento, cancelada: true, complemento: complemento(GO, EMPRESA_P), itens: [item(1, { valor: "10.00" })] });
  // 7. CT-e tomado (frete da compra) com crédito
  seq++;
  const cte: NotaEfdDados = {
    ...nfe({ operacao: "entrada", emitente_documento: TRANSP.documento, itens: [] }),
    modelo: "57",
    emitente_nome: TRANSP.nome,
    emitente_uf: "MT",
    valor_total: "300.00",
    cfops: ["5353"],
    tributos: { icms: "36.00" },
    complemento: complemento(TRANSP, EMPRESA_P, {
      mod_frete: null,
      cte: { toma: "3", tp_cte: "0", tp_serv: "0", cmun_ini: "5103403", uf_ini: "MT", cmun_fim: "5108402", uf_fim: "MT", cst: "00", bc_icms: "300.00", p_icms: "12.00", icms: "36.00", p_red_bc: null, valor_prestacao: "300.00", valor_receber: "300.00", chave_substituida: null },
    }),
  };
  const notas = [compra, comSt, simples, venda, cancelada, canceladaTerceiro, cte];

  const dados: DadosEfd = {
    competencia: COMP,
    empresa: {
      razao_social: "VENDEDORA TESTE LTDA (FICTICIA)",
      nome_fantasia: "VENDEDORA TESTE",
      tipo_pessoa: "PJ",
      documento: CNPJ,
      inscricao_estadual: "13.123.456-7",
      inscricao_municipal: null,
      uf: "MT",
      municipio_ibge: "5103403",
      logradouro: "Av. Teste",
      numero: "100",
      complemento: null,
      bairro: "Centro",
      cep: "78000-000",
      telefone: "(65) 3333-4444",
      email: "contato@teste.com.br",
      cnae: "4622200",
      regime: "lucro_real",
      contribuinte_icms: true,
      demonstracao: false,
    },
    contador: {
      nome: "CONTADORA TESTE",
      crc: "TO-012345/O-6",
      cpf: "52998224725",
      email: "contador@teste.com.br",
      telefone: "63999990000",
      cnpj: "11444777000161",
      cep: "77500000",
      logradouro: "Rua do Escritorio",
      numero: "1",
      complemento: null,
      bairro: "Centro",
      municipio_ibge: "1718204",
    },
    config: { perfil: "A", codigo_receita: "1112" },
    notas,
    sem_xml: [],
    icms_por_operacao: false,
    lancamentos_codigos: { "l-1": "MT020001" },
    municipios: {},
    geracoes: [],
    releitura_pendente: false,
  };

  // Apuração do ICMS do portal com as mesmas notas (como em public.dados_apuracao_icms)
  const entradas: NotaEntradaDados[] = notas
    .filter((n) => n.operacao === "entrada" && !n.cancelada)
    .map((n) => ({
      id: n.id,
      modelo: n.modelo,
      numero: n.numero,
      serie: n.serie,
      data: n.data_emissao,
      emitente: n.emitente_nome,
      emitente_documento: n.emitente_documento,
      emitente_uf: n.emitente_uf,
      propria: false,
      crt: n === simples ? "1" : "3",
      valor_total: n.valor_total,
      valor_produtos: n.valor_produtos,
      frete: 0,
      outros: 0,
      seguro: null,
      icms: n.tributos?.icms ?? null,
      leitura: 5,
      destinacao: null,
      itens: n.itens.map((i) => ({
        n: i.n,
        cfop: i.cfop,
        valor: i.valor,
        orig: i.tributos?.orig,
        cst: i.tributos?.cst_icms,
        csosn: i.tributos?.csosn,
        bc: i.tributos?.bc_icms,
        p_icms: i.tributos?.p_icms,
        icms: i.tributos?.icms,
        icms_st: i.tributos?.icms_st,
        cred_sn: i.tributos?.cred_icms_sn,
        destinacao: n === compra && i.n === 2 ? "uso_consumo" : null,
      })),
    }));
  const dadosIcms: DadosIcms = {
    competencia: COMP,
    empresa: { nome: "Teste", uf: "MT", regime: "lucro_real", contribuinte_icms: true, inscricao_estadual: true },
    gerenciar: true,
    detalhe: true,
    destinacao_padrao: "revenda",
    aliquota_interna: null,
    saidas: [{ cfop: "6102", notas: 1, valor: 5000, base: 5100, icms: 612 }],
    saidas_totais: { notas: 1, nfce: 0, icms_st: 0, fcp: 0, difal_destino: 0, fcp_destino: 0, vendas_outro_estado_consumidor: 0 },
    entradas,
    fornecedores: {},
    leitura_antiga: 0,
    lancamentos: [{ id: "l-1", tipo: "outro_credito", descricao: "CIAP 1/48", valor: 50, observacao: null }],
    apuracao: null,
    anterior: null,
    sped: null,
    releitura_pendente: false,
    vencimentos: [],
  };
  return { dados, icms: { dados: dadosIcms, resultado: calcularIcms(dadosIcms) } };
}

const OPCOES = { finalidade: 0 as const, vencimento: "2026-10-10", confirmadas: ["mes_aberto"] };
const registros = (conteudo: string, reg: string) =>
  conteudo
    .split("\r\n")
    .filter((l) => l.startsWith(`|${reg}|`))
    .map((l) => l.slice(1, -1).split("|"));

describe("EFD ICMS/IPI: formatação dos campos", () => {
  it("números com vírgula, datas ddmmaaaa e textos sem o separador", () => {
    expect(numeroCampo("1234.5")).toBe("1234,50");
    expect(numeroCampo("0.125", 2)).toBe("0,13");
    expect(numeroCampo("10", 5)).toBe("10,00000");
    expect(dataCampo("2026-09-30")).toBe("30092026");
    expect(textoCampo("Rua | Teste\r\n  2", 60)).toBe("Rua Teste 2");
    expect(paraLatin1("Açaí – “bom”")).toBe('Açaí - "bom"');
    expect(versaoLeiaute(2026)).toBe("020");
    expect(versaoLeiaute(2030)).toBeNull();
  });
  it("CST e CFOP de entrada sob o enfoque do declarante", () => {
    expect(cfopEntrada("6102", "revenda", false, "compra")).toBe("2102");
    expect(cfopEntrada("5102", "uso_consumo", false, "compra")).toBe("1556");
    expect(cfopEntrada("6102", "ativo", false, "compra")).toBe("2551");
    expect(cfopEntrada("5405", "revenda", true, "compra")).toBe("1403");
    expect(cfopEntrada("6202", "revenda", false, "devolucao")).toBe("2202");
    expect(cfopEntrada("5910", "nao_se_aplica", false, "outras")).toBe("1910");
    expect(cfopEntrada("5117", "revenda", false, "compra")).toBe("1117");
    expect(cstEntrada("00", null, false, true)).toBe("00");
    expect(cstEntrada("00", null, false, false)).toBe("90");
    expect(cstEntrada("10", null, true, false)).toBe("60");
    expect(cstEntrada(null, "101", false, true)).toBe("90");
    expect(cstEntrada("41", null, false, false)).toBe("41");
  });
});

describe("EFD ICMS/IPI: arquivo do mês", () => {
  const { dados, icms } = cenario();
  const r = gerarEfd(dados, icms, OPCOES);
  const arq = r.conteudo!;

  it("gera sem bloqueios e com o nome do CNPJ e do mês", () => {
    expect(r.pendencias.filter((p) => p.nivel === "bloqueio")).toEqual([]);
    expect(arq).toBeTruthy();
    expect(r.nomeArquivo).toBe(`EFD-ICMS-IPI_${CNPJ}_202609.txt`);
  });

  it("abre com o 0000 (leiaute 020, perfil A) e fecha com o 9999 contando as linhas", () => {
    const linhas = arq.split("\r\n").filter(Boolean);
    expect(arq.endsWith("\r\n")).toBe(true);
    expect(linhas.every((l) => l.startsWith("|") && l.endsWith("|"))).toBe(true);
    expect(registros(arq, "0000")[0]).toEqual(["0000", "020", "0", "01092026", "30092026", "VENDEDORA TESTE LTDA (FICTICIA)", CNPJ, "", "MT", "131234567", "5103403", "", "", "A", "1"]);
    expect(registros(arq, "9999")[0]).toEqual(["9999", String(linhas.length)]);
  });

  it("9900 confere com a quantidade de cada registro e os totais dos blocos batem", () => {
    const linhas = arq.split("\r\n").filter(Boolean);
    const contagem = new Map<string, number>();
    for (const l of linhas) contagem.set(l.split("|")[1], (contagem.get(l.split("|")[1]) ?? 0) + 1);
    for (const [, reg, qtd] of registros(arq, "9900")) expect(contagem.get(reg)).toBe(Number(qtd));
    expect(registros(arq, "9900").length).toBe(contagem.size);
    for (const bloco of ["0", "C", "D", "E", "1"]) {
      const fim = registros(arq, `${bloco}990`)[0];
      expect(Number(fim[1])).toBe(linhas.filter((l) => l[1] === bloco).length);
    }
    expect(Number(registros(arq, "9990")[0][1])).toBe(linhas.filter((l) => l[1] === "9").length);
  });

  it("cada registro tem a quantidade de campos do leiaute", () => {
    const campos: Record<string, number> = { "0000": 15, "0005": 10, "0100": 14, "0150": 13, "0190": 3, "0200": 13, C100: 29, C170: 38, C190: 12, D100: 25, D190: 9, E110: 15, E111: 4, E116: 10, "1010": 14 };
    for (const [reg, n] of Object.entries(campos)) {
      const linhas = registros(arq, reg);
      expect(linhas.length, reg).toBeGreaterThan(0);
      for (const l of linhas) expect(l.length, reg).toBe(n);
    }
  });

  it("compra de outro estado: crédito só no item de revenda; uso e consumo como 2.556 / CST 090 sem ICMS", () => {
    const c170 = registros(arq, "C170");
    const revenda = c170.find((l) => l[10] === "2102")!;
    expect(revenda).toBeTruthy();
    expect(revenda[9]).toBe("000");
    expect([revenda[12], revenda[13], revenda[14]]).toEqual(["1000,00", "12,00", "120,00"]);
    const uso = c170.find((l) => l[10] === "2556")!;
    expect(uso[9]).toBe("090");
    expect([uso[12], uso[13], uso[14]]).toEqual(["0,00", "0,00", "0,00"]);
    // Itens com o código formado pelo CNPJ do fornecedor e cadastrados no 0200 e no 0190
    expect(revenda[2]).toBe(`${GO.documento}-P1`);
    expect(registros(arq, "0200").map((l) => l[1])).toContain(revenda[2]);
    expect(registros(arq, "0190").map((l) => l[1])).toEqual(expect.arrayContaining(["SC", "UN"]));
    const tipoUso = registros(arq, "0200").find((l) => l[1] === `${GO.documento}-P2`)!;
    expect(tipoUso[6]).toBe("07");
  });

  it("compra com ICMS-ST: CST 060, CFOP 1.403 e o ST somado ao valor do item", () => {
    const st = registros(arq, "C170").find((l) => l[10] === "1403")!;
    expect(st[9]).toBe("060");
    expect(st[6]).toBe("550,00");
    expect(st[14]).toBe("0,00");
  });

  it("fornecedor do Simples com crédito (CSOSN 101): CST 090 com o crédito permitido", () => {
    const sn = registros(arq, "C170").find((l) => l[2].startsWith(SN.documento!))!;
    expect(sn[9]).toBe("090");
    expect(sn[10]).toBe("1102");
    expect([sn[13], sn[14]]).toEqual(["3,00", "30,00"]);
  });

  it("venda própria: só C100 e C190, débito com o frete na base e participante com município", () => {
    const vendas = registros(arq, "C100").filter((l) => l[1] === "1" && l[5] === "00");
    expect(vendas).toHaveLength(1);
    const v = vendas[0];
    expect(v[3]).toBe(CLIENTE.documento);
    expect(v[10]).toBe("11092026");
    expect(v[16]).toBe("0");
    expect([v[11], v[20], v[21]]).toEqual(["5100,00", "5100,00", "612,00"]);
    const c190 = registros(arq, "C190").find((l) => l[2] === "6102")!;
    expect(c190).toEqual(["C190", "000", "6102", "12,00", "5100,00", "5100,00", "612,00", "0,00", "0,00", "0,00", "0,00", ""]);
    const cli = registros(arq, "0150").find((l) => l[1] === CLIENTE.documento)!;
    expect([cli[3], cli[4], cli[7]]).toEqual(["01058", CLIENTE.documento, "3550308"]);
  });

  it("venda cancelada com os campos mínimos; compra cancelada fica de fora", () => {
    const canc = registros(arq, "C100").filter((l) => l[5] === "02");
    expect(canc).toHaveLength(1);
    expect(canc[0].slice(1, 8)).toEqual(["1", "0", "", "55", "02", "001", "105"]);
    expect(canc[0].slice(9).every((x) => x === "")).toBe(true);
    expect(registros(arq, "C100").filter((l) => l[2] === "1")).toHaveLength(3);
  });

  it("CT-e tomado: D100 com municípios e D190 1.353 com o crédito", () => {
    const d100 = registros(arq, "D100")[0];
    expect([d100[1], d100[2], d100[3], d100[16], d100[17]]).toEqual(["0", "1", TRANSP.documento, "1", "300,00"]);
    expect([d100[23], d100[24]]).toEqual(["5103403", "5108402"]);
    expect(registros(arq, "D190")[0]).toEqual(["D190", "000", "1353", "12,00", "300,00", "300,00", "36,00", "0,00", ""]);
  });

  it("apuração E110 a partir dos registros analíticos, com o ajuste (E111) e a guia (E116)", () => {
    // Débitos 612; créditos 120 + 30 + 36 = 186; outros créditos 50 → 376 a recolher
    expect(registros(arq, "E110")[0]).toEqual(["E110", "612,00", "0,00", "0,00", "0,00", "186,00", "0,00", "50,00", "0,00", "0,00", "376,00", "0,00", "376,00", "0,00", "0,00"]);
    expect(registros(arq, "E111")[0]).toEqual(["E111", "MT020001", "CIAP 1/48", "50,00"]);
    expect(registros(arq, "E116")[0]).toEqual(["E116", "000", "376,00", "10102026", "1112", "", "", "", "", "092026"]);
    expect(r.resumo?.apuracao.a_recolher).toBe("376.00");
    expect(r.pendencias.find((p) => p.id === "diferenca_apuracao")).toBeUndefined();
  });

  it("o leitor de SPED do portal lê o arquivo gerado", () => {
    const lido = lerSped(arq);
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;
    expect(lido.dados).toMatchObject({ tipo: "efd_icms_ipi", cnpj: CNPJ, uf: "MT", inicio: "2026-09-01", fim: "2026-09-30", perfil: "A" });
    expect(lido.dados.documentos).toHaveLength(5);
    expect(lido.dados.apuracao).toMatchObject({ debitos: "612.00", creditos: "186.00", a_recolher: "376.00" });
  });
});

describe("EFD ICMS/IPI: crédito presumido do transportador (MT)", () => {
  it("CT-e emitido interestadual: D195/D197 com 20% do ICMS, 0460 e o ajuste no E110", () => {
    const { dados, icms } = cenario();
    const emitido: NotaEfdDados = {
      ...dados.notas.find((n) => n.modelo === "57")!,
      id: "00000000-0000-0000-0000-0000000000ff",
      numero: "900",
      operacao: "saida",
      emitente_documento: CNPJ,
      destinatario_documento: CLIENTE.documento,
      destinatario_nome: CLIENTE.nome,
      valor_total: "1000.00",
      cfops: ["6353"],
      tributos: { icms: "120.00" },
      complemento: complemento(EMPRESA_P, CLIENTE, {
        mod_frete: null,
        cte: { toma: "3", tp_cte: "0", tp_serv: "0", cmun_ini: "5103403", uf_ini: "MT", cmun_fim: "3550308", uf_fim: "SP", cst: "00", bc_icms: "1000.00", p_icms: "12.00", icms: "120.00", p_red_bc: null, valor_prestacao: "1000.00", valor_receber: "1000.00", chave_substituida: null },
      }),
    };
    dados.notas.push(emitido);
    const dadosIcms = { ...icms.dados, saidas: [...icms.dados.saidas, { cfop: "6353", notas: 1, valor: 1000, base: 1000, icms: 120 }], credito_presumido_cte: { percentual: "20.00", codigo: "MT10001003", ctes: 1, icms: "120.00", valor: "24.00" } };
    const resultado = calcularIcms(dadosIcms);
    expect(resultado.propria?.creditoPresumido.toFixed(2)).toBe("24.00");
    const r = gerarEfd(dados, { dados: dadosIcms, resultado }, OPCOES);
    const arq = r.conteudo!;
    const linhas = arq.split("\r\n");
    const i = linhas.findIndex((l) => l.startsWith("|D100|1|0|"));
    expect(linhas.slice(i + 1, i + 4)).toEqual([
      "|D190|000|6353|12,00|1000,00|1000,00|120,00|0,00||",
      "|D195|000001||",
      "|D197|MT10001003|Crédito presumido de 20% do ICMS devido na prestação interestadual||120,00|20,00|24,00||",
    ]);
    expect(registros(arq, "0460")).toEqual([["0460", "000001", "Crédito presumido do prestador de serviço de transporte nas prestações interestaduais"]]);
    // Débitos 612 + 120; ajuste por documento 24. Optante do presumido não usa outros créditos
    // (Conv. ICMS 106/96): os 186 das compras e os 50 lançados ficam fora → 708 a recolher
    expect(registros(arq, "E110")[0].slice(1, 8)).toEqual(["732,00", "0,00", "0,00", "0,00", "0,00", "24,00", "0,00"]);
    expect(registros(arq, "E111")).toEqual([]);
    expect(registros(arq, "C190").filter((c) => c[2].startsWith("1") || c[2].startsWith("2")).every((c) => c[6] === "0,00")).toBe(true);
    expect(r.resumo.apuracao.a_recolher).toBe("708.00");
    expect(resultado.propria?.aRecolher.toFixed(2)).toBe("708.00");
    expect(resultado.propria?.creditos.toFixed(2)).toBe("0.00");
    expect(resultado.avisos.some((a) => a.includes("Outros créditos lançados (R$ 50,00) ficaram fora"))).toBe(true);
    expect(r.pendencias.find((p) => p.id === "outros_creditos_presumido")?.nivel).toBe("aviso");
    expect(r.pendencias.find((p) => p.id === "diferenca_apuracao")).toBeUndefined();
  });
  it("transportadora de MT sem o crédito configurado recebe o aviso", () => {
    const { dados, icms } = cenario();
    const cte = dados.notas.find((n) => n.modelo === "57")!;
    dados.notas.push({ ...cte, id: "00000000-0000-0000-0000-0000000000fe", operacao: "saida", emitente_documento: CNPJ, cfops: ["6353"], tributos: { icms: "36.00" }, complemento: { ...cte.complemento!, cte: { ...cte.complemento!.cte!, uf_fim: "GO" } } });
    expect(gerarEfd(dados, icms, OPCOES).pendencias.find((p) => p.id === "credito_presumido")?.nivel).toBe("aviso");
  });
});

describe("EFD ICMS/IPI: pendências", () => {
  it("bloqueia sem o CPF do contador, sem vencimento e com lançamento sem código", () => {
    const { dados, icms } = cenario();
    dados.contador.cpf = null;
    dados.lancamentos_codigos = {};
    const r = gerarEfd(dados, icms, { finalidade: 0, vencimento: null, confirmadas: ["mes_aberto"] });
    expect(r.conteudo).toBeNull();
    expect(r.pendencias.filter((p) => p.nivel === "bloqueio").map((p) => p.id)).toEqual(expect.arrayContaining(["contador", "vencimento", "codigos_ajuste"]));
  });
  it("pede confirmação quando não há vendas e quando há NF-e só em resumo", () => {
    const { dados, icms } = cenario();
    dados.notas = dados.notas.filter((n) => n.operacao === "entrada");
    dados.sem_xml = [{ chave: "5".repeat(44), emitente: "X", emitente_documento: "1", data: "2026-09-02", valor: 10 }];
    const sem = gerarEfd(dados, icms, { ...OPCOES });
    expect(sem.conteudo).toBeNull();
    expect(sem.pendencias.filter((p) => p.nivel === "confirmar").map((p) => p.id)).toEqual(expect.arrayContaining(["sem_saidas", "sem_xml"]));
    const com = gerarEfd(dados, icms, { ...OPCOES, confirmadas: ["mes_aberto", "sem_saidas", "sem_xml"] });
    expect(com.conteudo).toBeTruthy();
  });
  it("recusa código de receita que não é número (ex.: o nome do registro E116)", () => {
    const { dados, icms } = cenario();
    dados.config = { perfil: "A", codigo_receita: "E116" };
    const r = gerarEfd(dados, icms, OPCOES);
    expect(r.conteudo).toBeNull();
    expect(r.pendencias.find((p) => p.id === "codigo_receita")).toMatchObject({ nivel: "bloqueio", titulo: "Código de receita do ICMS inválido (E116)" });
  });
  it("pede a releitura das notas lidas antes do complemento da EFD", () => {
    const { dados, icms } = cenario();
    dados.notas[0].complemento = null;
    dados.notas[0].leitura = 4;
    const r = gerarEfd(dados, icms, OPCOES);
    expect(r.pendencias.find((p) => p.id === "releitura")).toMatchObject({ nivel: "bloqueio", acao: "reler" });
  });
  it("não gera para empresa do Simples nem com vendas com ICMS-ST retido", () => {
    const { dados, icms } = cenario();
    const simples = calcularIcms({ ...icms.dados, empresa: { ...icms.dados.empresa, regime: "simples_nacional" } });
    expect(gerarEfd(dados, { dados: icms.dados, resultado: simples }, OPCOES).pendencias[0].id).toBe("regime");
    // Com inscrição estadual, mas marcada como não contribuinte: indica a caixinha do perfil
    const naoContribuinte = calcularIcms({ ...icms.dados, empresa: { ...icms.dados.empresa, contribuinte_icms: false } });
    const p = gerarEfd(dados, { dados: icms.dados, resultado: naoContribuinte }, OPCOES).pendencias[0];
    expect(p).toMatchObject({ id: "regime", nivel: "bloqueio", titulo: "Empresa marcada como não contribuinte do ICMS" });
    expect(p.detalhe).toContain("“Contribuinte do ICMS” está desmarcada");
    const venda = dados.notas.find((n) => n.operacao === "saida" && !n.cancelada)!;
    venda.tributos = { icms_st: "10.00" };
    expect(gerarEfd(dados, icms, OPCOES).pendencias.find((p) => p.id === "st_substituto")?.nivel).toBe("bloqueio");
  });
});
