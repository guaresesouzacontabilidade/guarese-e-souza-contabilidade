import "server-only";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { XMLParser } from "fast-xml-parser";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { barrasDoCodigo } from "@/lib/nfe-emissao/codigo-barras";
import { campo, cep, chaveFormatada, data, documento, grade, hora, num, tituloBloco, vazio } from "@/lib/nfe-emissao/danfe";
import { CST_ICMS_CTE, PAPEL_TOMADOR } from "./rotulos";

/**
 * DACTE (Documento Auxiliar do CT-e), retrato, modal rodoviário, com os
 * blocos do leiaute do Manual de Orientação do CT-e 4.00: identificação do
 * emitente e do DACTE com o código de barras CODE-128C da chave e o QR Code,
 * protocolo, CFOP e natureza, início e término da prestação, remetente,
 * destinatário e tomador, carga, componentes do valor da prestação, imposto,
 * documentos originários (NF-e), observações, RNTRC e o canhoto de entrega.
 * Só imprime o que está no XML. CT-e de homologação leva "SEM VALOR FISCAL";
 * cancelado, a marca d'água "CANCELADO".
 */

type Obj = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => ["Comp", "infNFe", "infQ", "autXML"].includes(nome),
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

const numeroCte = (n: string | null) => (n ? n.padStart(9, "0").replace(/^(\d{3})(\d{3})(\d{3})$/, "$1.$2.$3") : "");

/** Bloco de um participante (remetente, destinatário ou tomador). */
function participante(titulo: string, p: Obj | null, endereco: Obj | null, extra: Obj = {}): TableCell {
  const doc = val(p, "CNPJ") ?? val(p, "CPF");
  const linha = (rotulo: string, texto: string | null) => ({ text: [{ text: `${rotulo} `, fontSize: 5.5 }, { text: texto ?? "", fontSize: 7 }] });
  return {
    stack: [
      { text: titulo, bold: true, fontSize: 6 },
      linha("NOME", val(p, "xNome")),
      linha("ENDEREÇO", [val(endereco, "xLgr"), val(endereco, "nro"), val(endereco, "xCpl"), val(endereco, "xBairro")].filter(Boolean).join(", ")),
      { columns: [linha("MUNICÍPIO", `${val(endereco, "xMun") ?? ""} - ${val(endereco, "UF") ?? ""}`), { ...linha("CEP", cep(val(endereco, "CEP"))), width: 70 }] },
      { columns: [linha("CNPJ/CPF", documento(doc)), { ...linha("IE", val(p, "IE")), width: 100 }] },
      { columns: [linha("PAÍS", val(endereco, "xPais") ?? "BRASIL"), { ...linha("FONE", val(p, "fone")), width: 100 }] },
    ],
    ...extra,
  } as TableCell;
}

export async function gerarDacte(xml: string, opcoes: { cancelado?: boolean; logo?: string | null } = {}): Promise<Buffer> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML inválido.");
  const raiz = parser.parse(xml) as Obj;
  const cte = no(raiz, "cteProc", "CTe") ?? no(raiz, "CTe");
  const inf = no(cte, "infCte");
  if (!inf) throw new Error("XML de CT-e inválido.");
  const prot = no(raiz, "cteProc", "protCTe", "infProt");
  const chave = String(inf["@_Id"] ?? "").replace(/^CTe/, "");
  const qr = val(cte, "infCTeSupl", "qrCodCTe");
  const ide = no(inf, "ide");
  const emit = no(inf, "emit");
  const ee = no(emit, "enderEmit");
  const rem = no(inf, "rem");
  const dest = no(inf, "dest");
  const vPrest = no(inf, "vPrest");
  const imp = no(inf, "imp");
  const icms = no(imp, "ICMS");
  const grupoIcms = icms ? ((Object.values(icms)[0] as Obj | undefined) ?? null) : null;
  const nomeGrupo = icms ? (Object.keys(icms)[0] ?? "") : "";
  const ibscbs = no(imp, "IBSCBS");
  const norm = no(inf, "infCTeNorm");
  const carga = no(norm, "infCarga");
  const quantidades = (carga?.infQ as Obj[] | undefined) ?? [];
  const nfes = ((no(norm, "infDoc") as Obj | null)?.infNFe as Obj[] | undefined) ?? [];
  const comps = (vPrest?.Comp as Obj[] | undefined) ?? [];
  const homologacao = val(ide, "tpAmb") === "2";
  const nCT = numeroCte(val(ide, "nCT"));
  const serie = val(ide, "serie") ?? "";

  const toma4 = no(ide, "toma4");
  const papel = val(toma4, "toma") ?? val(ide, "toma3", "toma") ?? "";
  const tomador =
    papel === "4"
      ? participante("TOMADOR DO SERVIÇO", toma4, no(toma4, "enderToma"), { colSpan: 2 })
      : papel === "0"
        ? participante("TOMADOR DO SERVIÇO (REMETENTE)", rem, no(rem, "enderReme"), { colSpan: 2 })
        : participante("TOMADOR DO SERVIÇO (DESTINATÁRIO)", dest, no(dest, "enderDest"), { colSpan: 2 });

  // Identificação: emitente, DACTE, código de barras e QR Code
  const barras = barrasDoCodigo(chave, 180, 28);
  const emitente: TableCell = {
    stack: [
      ...(opcoes.logo ? [{ image: opcoes.logo, fit: [80, 34], alignment: "center", margin: [0, 0, 0, 2] } as Content] : []),
      { text: val(emit, "xNome") ?? "", bold: true, fontSize: 9, alignment: "center" },
      {
        text: [
          [val(ee, "xLgr"), val(ee, "nro"), val(ee, "xCpl")].filter(Boolean).join(", "),
          `${val(ee, "xBairro") ?? ""} - ${cep(val(ee, "CEP"))}`,
          `${val(ee, "xMun") ?? ""} - ${val(ee, "UF") ?? ""}${val(ee, "fone") ? ` Fone: ${val(ee, "fone")}` : ""}`,
          `CNPJ: ${documento(val(emit, "CNPJ") ?? val(emit, "CPF"))}   IE: ${val(emit, "IE") ?? ""}`,
        ].join("\n"),
        fontSize: 7,
        alignment: "center",
      },
    ],
  } as TableCell;
  const quadro: TableCell = {
    stack: [
      { text: "DACTE", bold: true, fontSize: 12, alignment: "center" },
      { text: "Documento Auxiliar do Conhecimento de Transporte Eletrônico", fontSize: 6, alignment: "center" },
      { text: "MODAL RODOVIÁRIO", bold: true, fontSize: 7.5, alignment: "center", margin: [0, 3, 0, 3] },
      {
        table: {
          widths: [26, 22, "*"],
          body: [
            [campo("MODELO", "57", { alinhar: "center" }), campo("SÉRIE", serie, { alinhar: "center" }), campo("NÚMERO", nCT, { alinhar: "center" })],
            [campo("EMISSÃO", `${data(val(ide, "dhEmi"))} ${hora(val(ide, "dhEmi"))}`, { colSpan: 3, alinhar: "center" }), vazio(), vazio()],
          ],
        },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => 1, paddingRight: () => 1, paddingTop: () => 0, paddingBottom: () => 0 },
      },
    ],
  } as TableCell;
  const codigo: TableCell = {
    columns: [
      {
        width: "*",
        stack: [
          { canvas: barras.map((b) => ({ type: "rect", x: b.x, y: 0, w: b.w, h: b.h, color: "#000000" })), margin: [0, 2, 0, 3] },
          { text: "CHAVE DE ACESSO", fontSize: 5 },
          { text: chaveFormatada(chave), bold: true, fontSize: 6.5 },
          { text: "Consulta em www.cte.fazenda.gov.br/portal ou no site da SEFAZ autorizadora", fontSize: 5.5, margin: [0, 2, 0, 0] },
        ],
      },
      ...(qr ? [{ width: 62, stack: [{ qr, fit: 60, alignment: "right" } as Content] }] : []),
    ],
    columnGap: 4,
  } as TableCell;
  const protocolo = prot ? `${val(prot, "nProt") ?? ""} - ${data(val(prot, "dhRecbto"))} ${hora(val(prot, "dhRecbto"))}` : homologacao ? "CT-e DE TESTE (HOMOLOGAÇÃO)" : "";
  const identificacao = grade([170, 120, "*"], [
    [emitente, quadro, codigo],
    [
      campo("TIPO DO CT-e", val(ide, "tpCTe") === "0" ? "Normal" : (val(ide, "tpCTe") ?? "")),
      campo("TIPO DO SERVIÇO", val(ide, "tpServ") === "0" ? "Normal" : (val(ide, "tpServ") ?? "")),
      campo("PROTOCOLO DE AUTORIZAÇÃO DE USO", protocolo, { alinhar: "center" }),
    ],
    [campo("CFOP - NATUREZA DA PRESTAÇÃO", `${val(ide, "CFOP") ?? ""} - ${val(ide, "natOp") ?? ""}`, { colSpan: 2 }), vazio(), campo("TOMADOR DO SERVIÇO", PAPEL_TOMADOR[papel] ?? papel)],
  ]);
  const trajeto = grade(["*", "*"], [
    [
      campo("INÍCIO DA PRESTAÇÃO", `${val(ide, "xMunIni") ?? ""} - ${val(ide, "UFIni") ?? ""}`),
      campo("TÉRMINO DA PRESTAÇÃO", `${val(ide, "xMunFim") ?? ""} - ${val(ide, "UFFim") ?? ""}`),
    ],
  ]);
  const partes = grade(["*", "*"], [
    [participante("REMETENTE", rem, no(rem, "enderReme")), participante("DESTINATÁRIO", dest, no(dest, "enderDest"))],
    [tomador, vazio()],
  ]);

  // Carga e quantidades
  const quant = quantidades.map((q) => `${val(q, "tpMed") ?? ""}: ${num(val(q, "qCarga"), 4)} ${val(q, "cUnid") === "01" ? "KG" : ""}`.trim()).join("\n");
  const blocoCarga = grade(["*", "*", 90, 130], [
    [
      campo("PRODUTO PREDOMINANTE", val(carga, "proPred")),
      campo("OUTRAS CARACTERÍSTICAS DA CARGA", val(carga, "xOutCat")),
      campo("VALOR TOTAL DA CARGA", num(val(carga, "vCarga")), { alinhar: "right" }),
      campo("QUANTIDADE", quant),
    ],
  ]);

  // Componentes do valor da prestação
  const pares = comps.map((c) => [val(c, "xNome") ?? "", num(val(c, "vComp"))]);
  while (pares.length % 2) pares.push(["", ""]);
  const linhasComp: TableCell[][] = [];
  for (let i = 0; i < pares.length; i += 2) {
    linhasComp.push([
      { text: pares[i][0], fontSize: 7 },
      { text: pares[i][1], fontSize: 7, alignment: "right" },
      { text: pares[i + 1][0], fontSize: 7 },
      { text: pares[i + 1][1], fontSize: 7, alignment: "right" },
      ...(i === 0
        ? [
            campo("VALOR TOTAL DO SERVIÇO", num(val(vPrest, "vTPrest")), { alinhar: "right", rowSpan: Math.max(1, pares.length / 2) }),
            campo("VALOR A RECEBER", num(val(vPrest, "vRec")), { alinhar: "right", rowSpan: Math.max(1, pares.length / 2) }),
          ]
        : [vazio(), vazio()]),
    ]);
  }
  if (!linhasComp.length) linhasComp.push([vazio(), vazio(), vazio(), vazio(), campo("VALOR TOTAL DO SERVIÇO", num(val(vPrest, "vTPrest")), { alinhar: "right" }), campo("VALOR A RECEBER", num(val(vPrest, "vRec")), { alinhar: "right" })]);
  const componentes = grade(["*", 60, "*", 60, 95, 95], linhasComp);

  // Imposto
  const cst = nomeGrupo === "ICMSSN" ? "sn" : (val(grupoIcms, "CST") ?? "");
  const st = nomeGrupo === "ICMS60";
  const imposto = grade(["*", 70, 50, 70, 50, 70], [
    [
      campo("SITUAÇÃO TRIBUTÁRIA", CST_ICMS_CTE[cst] ?? cst),
      campo("BASE DE CÁLCULO", num(val(grupoIcms, st ? "vBCSTRet" : "vBC") ?? "0"), { alinhar: "right" }),
      campo("ALÍQ. ICMS", num(val(grupoIcms, st ? "pICMSSTRet" : "pICMS") ?? "0"), { alinhar: "right" }),
      campo(st ? "VALOR ICMS ST" : "VALOR DO ICMS", num(val(grupoIcms, st ? "vICMSSTRet" : "vICMS") ?? "0"), { alinhar: "right" }),
      campo("% RED. BC", num(val(grupoIcms, "pRedBC") ?? "0"), { alinhar: "right" }),
      campo("CRÉDITO PRESUMIDO", num(val(grupoIcms, "vCred") ?? "0"), { alinhar: "right" }),
    ],
  ]);
  const gIbs = no(ibscbs, "gIBSCBS");
  const ibs = ibscbs
    ? `IBS/CBS (LC 214/2025): CST ${val(ibscbs, "CST") ?? ""}, classificação ${val(ibscbs, "cClassTrib") ?? ""}` +
      (gIbs ? `; base R$ ${num(val(gIbs, "vBC"))}; IBS R$ ${num(val(gIbs, "vIBS") ?? "0")}; CBS R$ ${num(val(gIbs, "gCBS", "vCBS") ?? "0")}` : "") +
      "."
    : null;

  // Documentos originários
  const docs = nfes.map((n) => [{ text: "NF-e", fontSize: 6.5 } as TableCell, { text: chaveFormatada(val(n, "chave") ?? ""), fontSize: 6.5 } as TableCell]);
  const metade = Math.ceil(docs.length / 2);
  const linhasDocs: TableCell[][] = [];
  for (let i = 0; i < metade; i++) linhasDocs.push([...docs[i], ...(docs[i + metade] ?? [vazio(), vazio()])]);
  const documentos = grade([30, "*", 30, "*"], [
    [{ text: "TIPO DOC", fontSize: 5, bold: true }, { text: "CHAVE DE ACESSO DA NF-e", fontSize: 5, bold: true }, { text: "TIPO DOC", fontSize: 5, bold: true }, { text: "CHAVE DE ACESSO DA NF-e", fontSize: 5, bold: true }],
    ...(linhasDocs.length ? linhasDocs : [[vazio(), vazio(), vazio(), vazio()]]),
  ]);

  const vTotTrib = val(imp, "vTotTrib");
  const observacoes = [
    val(inf, "compl", "xObs"),
    ibs,
    vTotTrib ? `Valor aproximado dos tributos: R$ ${num(vTotTrib)}.` : null,
    homologacao ? "CT-e EMITIDO EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL." : null,
  ]
    .filter(Boolean)
    .join("\n");
  const blocoObs = grade(["*"], [[{ text: observacoes || " ", fontSize: 6.5, margin: [0, 0, 0, 6] } as TableCell]]);
  const rodo = grade([120, "*"], [
    [
      campo("RNTRC DA EMPRESA", val(norm, "infModal", "rodo", "RNTRC")),
      { text: "ESTE CONHECIMENTO DE TRANSPORTE ATENDE À LEGISLAÇÃO DE TRANSPORTE RODOVIÁRIO EM VIGOR", fontSize: 6.5, alignment: "center", margin: [0, 3, 0, 0] } as TableCell,
    ],
  ]);

  // Canhoto (recebimento da carga pelo destinatário)
  const canhoto = grade(["*", 90, 90, 80], [
    [
      {
        text: "DECLARO QUE RECEBI OS VOLUMES DESTE CONHECIMENTO EM PERFEITO ESTADO PELO QUE DOU POR CUMPRIDO O PRESENTE CONTRATO DE TRANSPORTE",
        fontSize: 6,
        colSpan: 3,
      },
      vazio(),
      vazio(),
      { stack: [{ text: "CT-e", bold: true, fontSize: 9, alignment: "center" }, { text: `Nº ${nCT}`, fontSize: 7.5, alignment: "center" }, { text: `Série ${serie}`, fontSize: 7.5, alignment: "center" }], rowSpan: 2 },
    ],
    [campo("NOME / RG", " ", { margin: [0, 0, 0, 8] }), campo("CHEGADA - DATA / HORA", " "), campo("SAÍDA - DATA / HORA", " "), vazio()],
  ]);

  const marca = opcoes.cancelado ? "CANCELADO" : homologacao ? "SEM VALOR FISCAL" : null;
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [14, 14, 14, 22],
    defaultStyle: { font: "Helvetica", fontSize: 7, lineHeight: 1.05 },
    info: { title: `DACTE ${nCT} - ${chave}`, author: "Portal Guarese's ON" },
    background: (_p, tamanho) =>
      (marca
        ? {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho.width}" height="${tamanho.height}"><text x="${tamanho.width / 2}" y="${tamanho.height / 2}" font-family="Helvetica" font-size="${marca.length > 10 ? 58 : 80}" fill="#B0B0B0" text-anchor="middle" transform="rotate(-40 ${tamanho.width / 2} ${tamanho.height / 2})">${marca}</text></svg>`,
            absolutePosition: { x: 0, y: 0 },
          }
        : null) as Content,
    footer: (pagina, total) => ({ text: `Folha ${pagina}/${total}`, alignment: "right", fontSize: 6, margin: [14, 4, 14, 0] }),
    content: [
      ...(homologacao ? [{ text: "CT-e EMITIDO EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL", bold: true, color: "#CC0000", alignment: "center", margin: [0, 0, 0, 3] } as Content] : []),
      identificacao,
      trajeto,
      partes,
      tituloBloco("CARGA"),
      blocoCarga,
      tituloBloco("COMPONENTES DO VALOR DA PRESTAÇÃO DO SERVIÇO"),
      componentes,
      tituloBloco("INFORMAÇÕES RELATIVAS AO IMPOSTO"),
      imposto,
      tituloBloco("DOCUMENTOS ORIGINÁRIOS"),
      documentos,
      tituloBloco("OBSERVAÇÕES"),
      blocoObs,
      tituloBloco("INFORMAÇÕES ESPECÍFICAS DO MODAL RODOVIÁRIO"),
      rodo,
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 567, y2: 0, lineWidth: 0.5, dash: { length: 3 } }], margin: [0, 6, 0, 4] },
      canhoto,
    ],
  };
  const pm = await carregarPdfMake();
  return pm.createPdf(doc).getBuffer();
}
