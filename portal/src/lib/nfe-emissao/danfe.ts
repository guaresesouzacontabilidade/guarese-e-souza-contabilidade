import "server-only";
import type { Content, ContentTable, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { XMLParser } from "fast-xml-parser";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { barrasDoCodigo } from "./codigo-barras";

/**
 * DANFE (Documento Auxiliar da NF-e), retrato, conforme o Anexo II do Manual
 * de Orientação do Contribuinte: canhoto, identificação do emitente e do
 * DANFE com o código de barras CODE-128C da chave, natureza e protocolo,
 * destinatário, fatura, cálculo do imposto, transportador e volumes,
 * produtos e dados adicionais. Só imprime o que está no XML da nota.
 * Nota de homologação leva "SEM VALOR FISCAL"; nota cancelada, a marca
 * d'água "CANCELADA".
 */

type Obj = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => ["det", "dup", "vol", "detPag", "NFref", "autXML"].includes(nome),
});

function no(o: unknown, ...caminho: string[]): Obj | null {
  let atual: unknown = o;
  for (const c of caminho) {
    if (!atual || typeof atual !== "object") return null;
    atual = (atual as Obj)[c];
  }
  return atual && typeof atual === "object" ? (atual as Obj) : null;
}
function val(o: unknown, ...caminho: string[]): string | null {
  let atual: unknown = o;
  for (const c of caminho) {
    if (!atual || typeof atual !== "object") return null;
    atual = (atual as Obj)[c];
  }
  if (atual == null) return null;
  if (typeof atual === "object") return ((atual as Obj)["#text"] as string) ?? null;
  return String(atual);
}

const documento = (d: string | null) => {
  if (!d) return "";
  if (/^[0-9A-Z]{14}$/.test(d)) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (/^\d{11}$/.test(d)) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
};
const cep = (c: string | null) => (c && /^\d{8}$/.test(c) ? `${c.slice(0, 5)}-${c.slice(5)}` : (c ?? ""));
const num = (v: string | null, casas = 2) =>
  v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const qtd = (v: string | null) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 }));
const unit = (v: string | null) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 10 }));
const data = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "");
const hora = (v: string | null) => (v && /T\d{2}:\d{2}:\d{2}/.test(v) ? v.slice(11, 19) : "");
const numeroNota = (n: string | null) => (n ? n.padStart(9, "0").replace(/^(\d{3})(\d{3})(\d{3})$/, "$1.$2.$3") : "");
const chaveFormatada = (c: string) => c.replace(/(.{4})/g, "$1 ").trim();

const MOD_FRETE: Record<string, string> = {
  "0": "0-Por conta do Remetente",
  "1": "1-Por conta do Destinatário",
  "2": "2-Por conta de Terceiros",
  "3": "3-Próprio por conta do Remetente",
  "4": "4-Próprio por conta do Destinatário",
  "9": "9-Sem Ocorrência de Transporte",
};

function campo(rotulo: string, valor: string | null | undefined, extra: Obj = {}): TableCell {
  const { alinhar, ...resto } = extra as { alinhar?: string } & Obj;
  return {
    stack: [
      { text: rotulo, fontSize: 5 },
      { text: valor == null || valor === "" ? " " : valor, fontSize: 7.5, bold: false, alignment: alinhar ?? "left" },
    ],
    ...resto,
  } as TableCell;
}
const vazio = (): TableCell => ({ text: "" });
const tituloBloco = (t: string): Content => ({ text: t, bold: true, fontSize: 6.5, margin: [0, 4, 0, 1] });

function grade(widths: (string | number)[], linhas: TableCell[][]): ContentTable {
  return {
    table: { widths, body: linhas, dontBreakRows: true },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 1, paddingBottom: () => 1 },
  };
}

export async function gerarDanfe(xml: string, opcoes: { cancelada?: boolean; logo?: string | null } = {}): Promise<Buffer> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML inválido.");
  const raiz = parser.parse(xml) as Obj;
  const nfe = no(raiz, "nfeProc", "NFe") ?? no(raiz, "NFe");
  const inf = no(nfe, "infNFe");
  if (!inf) throw new Error("XML de NF-e inválido.");
  const prot = no(raiz, "nfeProc", "protNFe", "infProt");
  const chave = String(inf["@_Id"] ?? "").replace(/^NFe/, "");
  const ide = no(inf, "ide");
  const emit = no(inf, "emit");
  const ee = no(emit, "enderEmit");
  const dest = no(inf, "dest");
  const ed = no(dest, "enderDest");
  const tot = no(inf, "total", "ICMSTot");
  const ibsTot = no(inf, "total", "IBSCBSTot");
  const transp = no(inf, "transp");
  const transporta = no(transp, "transporta");
  const veic = no(transp, "veicTransp");
  const vols = ((no(inf, "transp") as Obj | null)?.vol as Obj[] | undefined) ?? [];
  const dets = (inf.det as Obj[] | undefined) ?? [];
  const dups = ((no(inf, "cobr") as Obj | null)?.dup as Obj[] | undefined) ?? [];
  const homologacao = val(ide, "tpAmb") === "2";
  const nNF = numeroNota(val(ide, "nNF"));
  const serie = (val(ide, "serie") ?? "").padStart(3, "0");
  const docEmit = val(emit, "CNPJ") ?? val(emit, "CPF");
  const docDest = val(dest, "CNPJ") ?? val(dest, "CPF") ?? val(dest, "idEstrangeiro");

  // Canhoto
  const canhoto = grade(["*", "*", 90], [
    [
      {
        text:
          `RECEBEMOS DE ${val(emit, "xNome") ?? ""} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO. ` +
          `EMISSÃO: ${data(val(ide, "dhEmi"))} VALOR TOTAL: R$ ${num(val(tot, "vNF"))} DESTINATÁRIO: ${val(dest, "xNome") ?? ""}`,
        fontSize: 6,
        colSpan: 2,
      },
      vazio(),
      { stack: [{ text: "NF-e", bold: true, fontSize: 10, alignment: "center" }, { text: `Nº ${nNF}`, fontSize: 8, alignment: "center" }, { text: `Série ${serie}`, fontSize: 8, alignment: "center" }], rowSpan: 2 },
    ],
    [campo("DATA DE RECEBIMENTO", " ", { margin: [0, 0, 0, 8] }), campo("IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR", " "), vazio()],
  ]);

  // Identificação: emitente, DANFE e código de barras
  const barras = barrasDoCodigo(chave, 200, 30);
  const emitente: TableCell = {
    stack: [
      ...(opcoes.logo ? [{ image: opcoes.logo, fit: [80, 34], alignment: "center", margin: [0, 0, 0, 2] } as Content] : []),
      { text: val(emit, "xNome") ?? "", bold: true, fontSize: 9, alignment: "center" },
      {
        text: [
          [val(ee, "xLgr"), val(ee, "nro"), val(ee, "xCpl")].filter(Boolean).join(", "),
          `${val(ee, "xBairro") ?? ""} - ${cep(val(ee, "CEP"))}`,
          `${val(ee, "xMun") ?? ""} - ${val(ee, "UF") ?? ""}${val(ee, "fone") ? ` Fone: ${val(ee, "fone")}` : ""}`,
        ].join("\n"),
        fontSize: 7,
        alignment: "center",
      },
    ],
  } as TableCell;
  const quadroDanfe: TableCell = {
    stack: [
      { text: "DANFE", bold: true, fontSize: 12, alignment: "center" },
      { text: "Documento Auxiliar da Nota Fiscal Eletrônica", fontSize: 6.5, alignment: "center" },
      {
        columns: [
          { text: "0 - ENTRADA\n1 - SAÍDA", fontSize: 6.5, width: "*" },
          { table: { body: [[{ text: val(ide, "tpNF") ?? "1", bold: true, fontSize: 10, alignment: "center" }]] }, width: 16 },
        ],
        margin: [4, 3, 4, 3],
      },
      { text: `Nº ${nNF}`, bold: true, fontSize: 8.5, alignment: "center" },
      { text: `SÉRIE ${serie}`, bold: true, fontSize: 8.5, alignment: "center" },
    ],
  } as TableCell;
  const codigo: TableCell = {
    stack: [
      { canvas: barras.map((b) => ({ type: "rect", x: b.x, y: 0, w: b.w, h: b.h, color: "#000000" })), margin: [4, 2, 0, 3] },
      { text: "CHAVE DE ACESSO", fontSize: 5 },
      { text: chaveFormatada(chave), bold: true, fontSize: 7.5, alignment: "center" },
      { text: "Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora", fontSize: 6.5, alignment: "center", margin: [0, 2, 0, 0] },
    ],
  } as TableCell;
  const protocolo = prot
    ? `${val(prot, "nProt") ?? ""} - ${data(val(prot, "dhRecbto"))} ${hora(val(prot, "dhRecbto"))}`
    : homologacao
      ? "NOTA DE TESTE (HOMOLOGAÇÃO)"
      : "";
  const identificacao = grade([200, 95, "*"], [
    [emitente, quadroDanfe, codigo],
    [campo("NATUREZA DA OPERAÇÃO", val(ide, "natOp"), { colSpan: 2 }), vazio(), campo("PROTOCOLO DE AUTORIZAÇÃO DE USO", protocolo, { alinhar: "center" })],
  ]);
  const inscricoes = grade(["*", "*", "*"], [
    [campo("INSCRIÇÃO ESTADUAL", val(emit, "IE")), campo("INSCRIÇÃO ESTADUAL DO SUBST. TRIB.", val(emit, "IEST")), campo("CNPJ / CPF", documento(docEmit))],
  ]);

  // Destinatário
  const destinatario = grade(["*", 110, 70], [
    [campo("NOME / RAZÃO SOCIAL", val(dest, "xNome")), campo("CNPJ / CPF", documento(docDest)), campo("DATA DA EMISSÃO", data(val(ide, "dhEmi")))],
    [
      {
        table: {
          widths: ["*", 100, 60],
          body: [[campo("ENDEREÇO", [val(ed, "xLgr"), val(ed, "nro"), val(ed, "xCpl")].filter(Boolean).join(", ")), campo("BAIRRO / DISTRITO", val(ed, "xBairro")), campo("CEP", cep(val(ed, "CEP")))]],
        },
        layout: "noBorders",
        colSpan: 2,
      } as TableCell,
      vazio(),
      campo("DATA DA SAÍDA / ENTRADA", data(val(ide, "dhSaiEnt"))),
    ],
    [
      {
        table: {
          widths: ["*", 80, 25, 90],
          body: [[campo("MUNICÍPIO", val(ed, "xMun")), campo("FONE / FAX", val(ed, "fone")), campo("UF", val(ed, "UF")), campo("INSCRIÇÃO ESTADUAL", val(dest, "IE"))]],
        },
        layout: "noBorders",
        colSpan: 2,
      } as TableCell,
      vazio(),
      campo("HORA DA SAÍDA / ENTRADA", hora(val(ide, "dhSaiEnt"))),
    ],
  ]);

  const fatura: Content[] = dups.length
    ? [
        tituloBloco("FATURA / DUPLICATAS"),
        grade(
          dups.map(() => "*"),
          [dups.map((d) => campo(`Nº ${val(d, "nDup") ?? ""}`, `Venc. ${data(val(d, "dVenc"))}\nR$ ${num(val(d, "vDup"))}`))],
        ),
      ]
    : [];

  const imposto = grade(["*", "*", "*", "*", "*", "*", "*", "*", "*"], [
    [
      campo("BASE DE CÁLC. DO ICMS", num(val(tot, "vBC")), { alinhar: "right" }),
      campo("VALOR DO ICMS", num(val(tot, "vICMS")), { alinhar: "right" }),
      campo("BASE DE CÁLC. ICMS S.T.", num(val(tot, "vBCST")), { alinhar: "right" }),
      campo("VALOR DO ICMS SUBST.", num(val(tot, "vST")), { alinhar: "right" }),
      campo("V. IMP. IMPORTAÇÃO", num(val(tot, "vII")), { alinhar: "right" }),
      campo("V. ICMS UF REMET.", num(val(tot, "vICMSUFRemet") ?? "0"), { alinhar: "right" }),
      campo("V. FCP UF DEST.", num(val(tot, "vFCPUFDest") ?? "0"), { alinhar: "right" }),
      campo("VALOR DO PIS", num(val(tot, "vPIS")), { alinhar: "right" }),
      campo("V. TOTAL PRODUTOS", num(val(tot, "vProd")), { alinhar: "right" }),
    ],
    [
      campo("VALOR DO FRETE", num(val(tot, "vFrete")), { alinhar: "right" }),
      campo("VALOR DO SEGURO", num(val(tot, "vSeg")), { alinhar: "right" }),
      campo("DESCONTO", num(val(tot, "vDesc")), { alinhar: "right" }),
      campo("OUTRAS DESPESAS", num(val(tot, "vOutro")), { alinhar: "right" }),
      campo("VALOR TOTAL IPI", num(val(tot, "vIPI")), { alinhar: "right" }),
      campo("V. ICMS UF DEST.", num(val(tot, "vICMSUFDest") ?? "0"), { alinhar: "right" }),
      campo("V. TOT. TRIB.", num(val(tot, "vTotTrib") ?? "0"), { alinhar: "right" }),
      campo("VALOR DA COFINS", num(val(tot, "vCOFINS")), { alinhar: "right" }),
      campo("V. TOTAL DA NOTA", num(val(tot, "vNF")), { alinhar: "right", bold: true }),
    ],
  ]);

  const docTransp = val(transporta, "CNPJ") ?? val(transporta, "CPF");
  const vol = vols[0] ?? null;
  const transporte = grade(["*", 85, 55, 55, 22, 85], [
    [
      campo("NOME / RAZÃO SOCIAL", val(transporta, "xNome")),
      campo("FRETE POR CONTA", MOD_FRETE[val(transp, "modFrete") ?? ""] ?? val(transp, "modFrete")),
      campo("CÓDIGO ANTT", val(veic, "RNTC")),
      campo("PLACA DO VEÍCULO", val(veic, "placa")),
      campo("UF", val(veic, "UF")),
      campo("CNPJ / CPF", documento(docTransp)),
    ],
    [
      campo("ENDEREÇO", val(transporta, "xEnder"), { colSpan: 2 }),
      vazio(),
      campo("MUNICÍPIO", val(transporta, "xMun"), { colSpan: 2 }),
      vazio(),
      campo("UF", val(transporta, "UF")),
      campo("INSCRIÇÃO ESTADUAL", val(transporta, "IE")),
    ],
    [
      {
        table: {
          widths: [60, "*", "*", "*", 85, 85],
          body: [
            [
              campo("QUANTIDADE", val(vol, "qVol")),
              campo("ESPÉCIE", val(vol, "esp")),
              campo("MARCA", val(vol, "marca")),
              campo("NUMERAÇÃO", val(vol, "nVol")),
              campo("PESO BRUTO", num(val(vol, "pesoB"), 3), { alinhar: "right" }),
              campo("PESO LÍQUIDO", num(val(vol, "pesoL"), 3), { alinhar: "right" }),
            ],
          ],
        },
        layout: { hLineWidth: () => 0, vLineWidth: (i: number, n: { table: { widths?: unknown[] } }) => (i === 0 || i === (n.table.widths?.length ?? 0) ? 0 : 0.5), paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 0, paddingBottom: () => 0 },
        colSpan: 6,
        margin: [-2, -1, -2, -1],
      } as TableCell,
      vazio(),
      vazio(),
      vazio(),
      vazio(),
      vazio(),
    ],
  ]);

  // Produtos
  const cab = ["CÓDIGO", "DESCRIÇÃO DO PRODUTO / SERVIÇO", "NCM/SH", "O/CST", "CFOP", "UN", "QUANT.", "VALOR UNIT.", "VALOR TOTAL", "BC ICMS", "VALOR ICMS", "VALOR IPI", "ALÍQ. ICMS", "ALÍQ. IPI"].map(
    (t) => ({ text: t, fontSize: 5, bold: true, alignment: "center" }) as TableCell,
  );
  const linhasProdutos = dets.map((d) => {
    const prod = no(d, "prod");
    const icms = no(d, "imposto", "ICMS");
    const grupo = icms ? (Object.values(icms)[0] as Obj) : null;
    const cst = `${val(grupo, "orig") ?? ""}${val(grupo, "CST") ?? val(grupo, "CSOSN") ?? ""}`;
    const ipi = no(d, "imposto", "IPI", "IPITrib");
    const adicional = val(d, "infAdProd");
    const celula = (t: string | null, alinhar = "right") => ({ text: t ?? "", fontSize: 6.5, alignment: alinhar }) as TableCell;
    return [
      celula(val(prod, "cProd"), "left"),
      { text: [val(prod, "xProd") ?? "", adicional ? `\n${adicional}` : ""].join(""), fontSize: 6.5 } as TableCell,
      celula(val(prod, "NCM"), "center"),
      celula(cst, "center"),
      celula(val(prod, "CFOP"), "center"),
      celula(val(prod, "uCom"), "center"),
      celula(qtd(val(prod, "qCom"))),
      celula(unit(val(prod, "vUnCom"))),
      celula(num(val(prod, "vProd"))),
      celula(num(val(grupo, "vBC") ?? "0")),
      celula(num(val(grupo, "vICMS") ?? "0")),
      celula(num(val(ipi, "vIPI") ?? "0")),
      celula(num(val(grupo, "pICMS") ?? "0")),
      celula(num(val(ipi, "pIPI") ?? "0")),
    ];
  });
  const produtos: ContentTable = {
    table: { headerRows: 1, widths: [38, "*", 34, 20, 20, 16, 38, 38, 40, 38, 34, 26, 22, 20], body: [cab, ...linhasProdutos] },
    layout: { hLineWidth: (i: number) => (i <= 1 ? 0.5 : 0.25), vLineWidth: () => 0.5, paddingLeft: () => 1.5, paddingRight: () => 1.5, paddingTop: () => 1, paddingBottom: () => 1 },
  };

  // Dados adicionais (com os valores do IBS/CBS, enquanto o leiaute do DANFE para eles não sai)
  const ibs = ibsTot
    ? `IBS/CBS (LC 214/2025): base R$ ${num(val(ibsTot, "vBCIBSCBS"))}; IBS R$ ${num(val(ibsTot, "gIBS", "vIBS") ?? "0")}; CBS R$ ${num(val(ibsTot, "gCBS", "vCBS") ?? "0")}.`
    : null;
  const infCpl = [val(inf, "infAdic", "infCpl"), ibs].filter(Boolean).join("\n");
  const adicionais = grade(["*", 160], [
    [
      { stack: [{ text: "INFORMAÇÕES COMPLEMENTARES", fontSize: 5 }, { text: infCpl || " ", fontSize: 6.5 }], margin: [0, 0, 0, 20] } as TableCell,
      { stack: [{ text: "RESERVADO AO FISCO", fontSize: 5 }, { text: val(inf, "infAdic", "infAdFisco") ?? " ", fontSize: 6.5 }] } as TableCell,
    ],
  ]);

  const marca = opcoes.cancelada ? "CANCELADA" : homologacao ? "SEM VALOR FISCAL" : null;
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [14, 14, 14, 22],
    defaultStyle: { font: "Helvetica", fontSize: 7, lineHeight: 1.05 },
    info: { title: `DANFE ${nNF} - ${chave}`, author: "Portal Guarese's ON" },
    background: (_p, tamanho) =>
      (marca
        ? {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho.width}" height="${tamanho.height}"><text x="${tamanho.width / 2}" y="${tamanho.height / 2}" font-family="Helvetica" font-size="${marca.length > 10 ? 58 : 80}" fill="#B0B0B0" text-anchor="middle" transform="rotate(-40 ${tamanho.width / 2} ${tamanho.height / 2})">${marca}</text></svg>`,
            absolutePosition: { x: 0, y: 0 },
          }
        : null) as Content,
    footer: (pagina, total) => ({ text: `Folha ${pagina}/${total}`, alignment: "right", fontSize: 6, margin: [14, 4, 14, 0] }),
    content: [
      canhoto,
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 567, y2: 0, lineWidth: 0.5, dash: { length: 3 } }], margin: [0, 4, 0, 4] },
      ...(homologacao ? [{ text: "NF-e EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL", bold: true, color: "#CC0000", alignment: "center", margin: [0, 0, 0, 3] } as Content] : []),
      identificacao,
      inscricoes,
      tituloBloco("DESTINATÁRIO / REMETENTE"),
      destinatario,
      ...fatura,
      tituloBloco("CÁLCULO DO IMPOSTO"),
      imposto,
      tituloBloco("TRANSPORTADOR / VOLUMES TRANSPORTADOS"),
      transporte,
      tituloBloco("DADOS DOS PRODUTOS / SERVIÇOS"),
      produtos,
      tituloBloco("DADOS ADICIONAIS"),
      adicionais,
    ],
  };
  const pm = await carregarPdfMake();
  return pm.createPdf(doc).getBuffer();
}
