import "server-only";
import type { Content, ContentTable, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { LOGO_NFSE } from "./logo-nfse";
import { lerNfse, no, val } from "./sefin";

/**
 * DANFSe (Documento Auxiliar da NFS-e) conforme a NT 008 SE/CGNFS-e v1.02
 * (14/07/2026), que suspendeu a API de geração do DANFSe em 03/08/2026: o
 * documento passa a ser gerado pelos sistemas a partir do XML da NFS-e.
 *  - A4 retrato, uma página, borda de 1 ponto e linhas de 0,5 ponto;
 *  - cabeçalho com a logomarca da NFS-e, "DANFSe v2.0", o município e os
 *    ambientes; QR Code para a consulta pública pela chave de acesso;
 *  - blocos na ordem do modelo (Anexo I), em quatro colunas; blocos sem dados
 *    trazem a frase de supressão da nota técnica;
 *  - "NFS-e SEM VALIDADE JURÍDICA" em vermelho para nota de teste (tpAmb 2) e
 *    marca d'água "CANCELADA" para nota cancelada.
 * Só imprime o que está no XML da NFS-e. Fonte Helvetica (mesmas medidas da
 * Arial pedida pela nota técnica).
 */

type Obj = Record<string, unknown>;

export const URL_CONSULTA_PUBLICA = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

const CINZA = "#F2F2F2";
const OP_SIMPLES: Record<string, string> = {
  "1": "Não Optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
};
const REG_AP_SN: Record<string, string> = {
  "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "2": "Regime de apuração dos tributos federais pelo SN e o ISSQN pela NFS-e conforme legislação municipal",
  "3": "Regime de apuração dos tributos federais e municipal pela NFS-e conforme legislações federal e municipal",
};
const REG_ESP: Record<string, string> = {
  "0": "Nenhum",
  "1": "Ato Cooperado (Cooperativa)",
  "2": "Estimativa",
  "3": "Microempresa Municipal",
  "4": "Notário ou Registrador",
  "5": "Profissional Autônomo",
  "6": "Sociedade de Profissionais",
  "9": "Outros",
};
const TRIB_ISSQN: Record<string, string> = { "1": "Operação Tributável", "2": "Imunidade", "3": "Exportação de Serviço", "4": "Não Incidência" };
const RET_ISSQN: Record<string, string> = { "1": "Não Retido", "2": "Retido pelo Tomador", "3": "Retido pelo Intermediário" };
const EMITENTE: Record<string, string> = { "1": "Prestador", "2": "Tomador", "3": "Intermediário" };
const SITUACAO: Record<string, string> = {
  "100": "NFS-e Gerada",
  "101": "NFS-e de Substituição Gerada",
  "102": "NFS-e de Decisão Judicial",
  "103": "NFS-e Avulsa",
};
const FINALIDADE: Record<string, string> = { "0": "NFS-e regular", "1": "NFS-e de crédito", "2": "NFS-e de débito" };

function documento(d: string | null): string {
  if (!d) return "-";
  if (/^[0-9A-Z]{14}$/.test(d)) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (/^[0-9]{11}$/.test(d)) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}
const cep = (c: string | null) => (c && /^[0-9]{8}$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2, 5)}-${c.slice(5)}` : (c ?? "-"));
const moeda = (v: string | null) =>
  v == null || v === "" ? "-" : `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: string | null) => (v == null || v === "" ? "-" : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const data = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "-");
const dataHora = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? `${data(v)} ${v.slice(11, 19)}` : "-");
const corta = (t: string | null, max: number) => (!t ? "-" : t.length > max ? `${t.slice(0, max - 3)}...` : t);

function campo(rotulo: string, valor: string | null | undefined, extra: Partial<TableCell & object> = {}): TableCell {
  return {
    stack: [
      { text: rotulo, bold: true, fontSize: 6 },
      { text: valor == null || valor === "" ? "-" : valor, fontSize: 7 },
    ],
    ...extra,
  } as TableCell;
}
const titulo = (t: string, extra: Partial<TableCell & object> = {}): TableCell => ({ text: t, bold: true, fontSize: 7, fillColor: CINZA, ...extra }) as TableCell;
// Objetos novos a cada uso: o pdfmake altera os nós ao montar o documento
const vazio = (): TableCell => ({ text: "" });

function bloco(linhas: TableCell[][]): ContentTable {
  return {
    table: { widths: ["25%", "25%", "25%", "25%"], body: linhas, dontBreakRows: true },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 0 : 0),
      vLineWidth: () => 0,
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 1.5,
      paddingBottom: () => 1.5,
    },
  };
}
const linha = (): Content => ({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 571, y2: 0, lineWidth: 0.5 }], margin: [0, 1, 0, 1] });

function endereco(e: unknown): string | null {
  if (!e) return null;
  const partes = [val(e, "xLgr"), val(e, "nro"), val(e, "xCpl"), val(e, "xBairro")].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

export async function gerarDanfse(xml: string, opcoes: { cancelada?: boolean; municipios?: Record<string, string> } = {}): Promise<Buffer> {
  const nfse = lerNfse(xml);
  const inf = nfse.inf;
  const dps = nfse.dps;
  if (!inf || !dps || !nfse.chave) throw new Error("XML de NFS-e inválido.");
  const nomeMun = (c: string | null) => (c ? (opcoes.municipios?.[c] ?? c) : null);

  const emit = no(inf, "emit");
  const enderEmit = no(emit, "enderNac");
  const prest = no(dps, "prest");
  const regTrib = no(prest, "regTrib");
  const toma = no(dps, "toma");
  const interm = no(dps, "interm");
  const serv = no(dps, "serv");
  const cServ = no(serv, "cServ");
  const valoresDps = no(dps, "valores");
  const trib = no(valoresDps, "trib");
  const tribMun = no(trib, "tribMun");
  const tribFed = no(trib, "tribFed");
  const totTrib = no(trib, "totTrib");
  const valoresNfse = no(inf, "valores");
  const teste = val(dps, "tpAmb") === "2";
  const municipioUf = `${val(inf, "xLocEmi") ?? "-"}${val(enderEmit, "UF") ? ` - ${val(enderEmit, "UF")}` : ""}`;

  // Cabeçalho
  const cabecalho: ContentTable = {
    table: {
      widths: ["25%", "50%", "25%"],
      body: [
        [
          { image: LOGO_NFSE, fit: [113, 24], margin: [2, 2, 0, 2] },
          {
            stack: [
              { text: "DANFSe v2.0", bold: true, fontSize: 9 },
              { text: "Documento Auxiliar da NFS-e", bold: true, fontSize: 9 },
              ...(teste ? [{ text: "NFS-e SEM VALIDADE JURÍDICA", bold: true, fontSize: 9, color: "#FF0000" }] : []),
            ],
            alignment: "center",
          },
          {
            stack: [
              { text: `Município: ${municipioUf}`, fontSize: 8 },
              { text: `Ambiente Gerador: ${val(inf, "ambGer") === "1" ? "Prefeitura" : "Sistema Nacional NFS-e"}`, fontSize: 6 },
              { text: `Tipo de Ambiente: ${teste ? "Homologação (produção restrita)" : "Produção"}`, fontSize: 6 },
            ],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => CINZA, paddingTop: () => 3, paddingBottom: () => 3 },
  };

  const qr: TableCell = {
    rowSpan: 4,
    stack: [
      { qr: `${URL_CONSULTA_PUBLICA}${nfse.chave}`, fit: 58, alignment: "center", margin: [0, 2, 0, 2] },
      {
        text: "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e",
        fontSize: 6,
      },
    ],
  } as TableCell;
  const ident = bloco([
    [campo("CHAVE DE ACESSO DA NFS-E", nfse.chave, { colSpan: 3 }), vazio(), vazio(), qr],
    [campo("NÚMERO DA NFS-E", nfse.numero), campo("COMPETÊNCIA DA NFS-E", data(val(dps, "dCompet"))), campo("DATA E HORA DA EMISSÃO DA NFS-E", dataHora(nfse.processadaEm)), vazio()],
    [campo("NÚMERO DA DPS", val(dps, "nDPS")), campo("SÉRIE DA DPS", val(dps, "serie")), campo("DATA E HORA DA EMISSÃO DA DPS", dataHora(val(dps, "dhEmi"))), vazio()],
    [
      campo("EMITENTE DA NFS-E", EMITENTE[val(dps, "tpEmit") ?? ""] ?? "-", { fillColor: CINZA }),
      campo("SITUAÇÃO DA NFS-E", opcoes.cancelada ? "NFS-e Cancelada" : (SITUACAO[val(inf, "cStat") ?? ""] ?? val(inf, "cStat"))),
      campo("FINALIDADE", FINALIDADE[val(dps, "IBSCBS", "finNFSe") ?? "0"] ?? "NFS-e regular"),
      vazio(),
    ],
  ]);

  // Prestador (o emitente traz nome e endereço quando a DPS não traz)
  const docPrest = val(prest, "CNPJ") ?? val(prest, "CPF") ?? val(emit, "CNPJ") ?? val(emit, "CPF");
  const endPrest = no(prest, "end");
  const munPrest = val(endPrest, "endNac", "cMun") ?? val(enderEmit, "cMun");
  const prestador = bloco([
    [titulo("PRESTADOR / FORNECEDOR"), campo("CNPJ / CPF / NIF", documento(docPrest)), campo("Indicador Municipal (Inscrição)", val(prest, "IM") ?? val(emit, "IM")), campo("Telefone", val(prest, "fone") ?? val(emit, "fone"))],
    [
      campo("Nome / Nome Empresarial", corta(val(prest, "xNome") ?? val(emit, "xNome"), 80), { colSpan: 2 }),
      vazio(),
      campo("Município / Sigla UF", endPrest ? nomeMun(munPrest) : `${val(inf, "xLocEmi") ?? "-"}${val(enderEmit, "UF") ? ` / ${val(enderEmit, "UF")}` : ""}`),
      campo("Código IBGE / CEP", `${munPrest ?? "-"} / ${cep(val(endPrest, "endNac", "CEP") ?? val(enderEmit, "CEP"))}`),
    ],
    [campo("Endereço", corta(endereco(endPrest) ?? endereco(enderEmit), 80), { colSpan: 2 }), vazio(), campo("E-mail", val(prest, "email") ?? val(emit, "email"), { colSpan: 2 }), vazio()],
    [
      campo("Simples Nacional na Data de Competência", OP_SIMPLES[val(regTrib, "opSimpNac") ?? ""] ?? "-"),
      campo("Regime de Apuração Tributária pelo SN", REG_AP_SN[val(regTrib, "regApTribSN") ?? ""] ?? "-", { colSpan: 3 }),
      vazio(),
      vazio(),
    ],
  ]);

  const pessoa = (t: string, p: Obj | null, naoIdentificado: string): ContentTable => {
    if (!p) return bloco([[titulo(naoIdentificado, { colSpan: 4 }), vazio(), vazio(), vazio()]]);
    const e = no(p, "end");
    const mun = val(e, "endNac", "cMun");
    return bloco([
      [titulo(t), campo("CNPJ / CPF / NIF", documento(val(p, "CNPJ") ?? val(p, "CPF") ?? val(p, "NIF"))), campo("Indicador Municipal (Inscrição)", val(p, "IM")), campo("Telefone", val(p, "fone"))],
      [campo("Nome / Nome Empresarial", corta(val(p, "xNome"), 80), { colSpan: 2 }), vazio(), campo("Município / Sigla UF", nomeMun(mun)), campo("Código IBGE / CEP", e ? `${mun ?? "-"} / ${cep(val(e, "endNac", "CEP"))}` : "-")],
      [campo("Endereço", corta(endereco(e), 80), { colSpan: 2 }), vazio(), campo("E-mail", val(p, "email"), { colSpan: 2 }), vazio()],
    ]);
  };
  const servico = bloco([
    [
      titulo("SERVIÇO PRESTADO"),
      campo("Código de Tributação Nacional / Municipal", `${val(cServ, "cTribNac") ?? "-"}${val(cServ, "cTribMun") ? ` / ${val(cServ, "cTribMun")}` : ""}`),
      campo("Código da NBS", val(cServ, "cNBS")),
      campo("Local da Prestação / Sigla UF / País", val(inf, "xLocPrestacao") ?? val(serv, "locPrest", "cLocPrestacao")),
    ],
    [campo("Descrição do Código de Tributação Nacional / Municipal", corta(val(inf, "xTribMun") ?? val(inf, "xTribNac"), 250), { colSpan: 4 }), vazio(), vazio(), vazio()],
    [campo("Descrição do Serviço", val(cServ, "xDescServ"), { colSpan: 4 }), vazio(), vazio(), vazio()],
  ]);

  const tributavel = !!tribMun && val(tribMun, "tribISSQN") !== "4";
  const issqn = tributavel
    ? bloco([
        [
          titulo("TRIBUTAÇÃO MUNICIPAL (ISSQN)"),
          campo("Tipo de Tributação do ISSQN", TRIB_ISSQN[val(tribMun, "tribISSQN") ?? ""] ?? "-"),
          campo("Município / Sigla UF / País de Incidência do ISSQN", val(inf, "xLocIncid") ?? "-", { colSpan: 2 }),
          vazio(),
        ],
        [
          campo("Regime Especial de Tributação do ISSQN", REG_ESP[val(regTrib, "regEspTrib") ?? "0"] ?? "-"),
          campo("Tipo de Imunidade do ISSQN", val(tribMun, "tpImunidade")),
          campo("Suspensão da Exigibilidade do ISSQN", val(tribMun, "exigSusp", "tpSusp") ? "Sim" : "Não"),
          campo("Número Processo Suspensão", val(tribMun, "exigSusp", "nProcesso")),
        ],
        [
          campo("BC ISSQN", moeda(val(valoresNfse, "vBC"))),
          campo("Alíquota Aplicada", pct(val(valoresNfse, "pAliqAplic"))),
          campo("Retenção do ISSQN", RET_ISSQN[val(tribMun, "tpRetISSQN") ?? ""] ?? "-"),
          campo("ISSQN Apurado", moeda(val(valoresNfse, "vISSQN"))),
        ],
      ])
    : bloco([[titulo("TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN", { colSpan: 4 }), vazio(), vazio(), vazio()]]);

  const federal = bloco([
    [
      titulo("TRIBUTAÇÃO FEDERAL (EXCETO CBS)"),
      campo("IRRF", moeda(val(tribFed, "vRetIRRF"))),
      campo("Contribuição Previdenciária - Retida", moeda(val(tribFed, "vRetCP"))),
      campo("Contribuições Sociais - Retidas", moeda(val(tribFed, "vRetCSLL"))),
    ],
  ]);

  const ibscbs = bloco([
    [titulo("TRIBUTAÇÃO IBS / CBS"), campo("CST / cClassTrib", null), campo("Indicador de Operação / Município de Incidência", null, { colSpan: 2 }), vazio()],
  ]);

  const desconto = no(valoresDps, "vDescCondIncond");
  const totais = bloco([
    [
      titulo("VALOR TOTAL DA NFS-E"),
      campo("VALOR DA OPERAÇÃO / SERVIÇO", moeda(val(valoresDps, "vServPrest", "vServ"))),
      campo("Desconto Incondicionado", moeda(val(desconto, "vDescIncond"))),
      campo("Desconto Condicionado", moeda(val(desconto, "vDescCond"))),
    ],
    [
      campo("Total das Retenções (ISSQN / Federais)", moeda(val(valoresNfse, "vTotalRet"))),
      campo("VALOR LÍQUIDO DA NFS-E", moeda(val(valoresNfse, "vLiq"))),
      campo("Total do IBS/CBS", moeda(null)),
      campo("VALOR LÍQUIDO DA NFS-E + IBS/CBS", moeda(val(valoresNfse, "vLiq")), { fillColor: CINZA }),
    ],
  ]);

  // Tributos aproximados (Lei 12.741/2012)
  const pSn = val(totTrib, "pTotTribSN");
  const pFed = val(totTrib, "pTotTrib", "pTotTribFed");
  const vFed = val(totTrib, "vTotTrib", "vTotTribFed");
  const aproximados = pSn
    ? `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${pct(pSn)} (Simples Nacional)`
    : pFed
      ? `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: ${pct(pFed)}; Estaduais: ${pct(val(totTrib, "pTotTrib", "pTotTribEst"))}; Municipais: ${pct(val(totTrib, "pTotTrib", "pTotTribMun"))}`
      : vFed
        ? `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: ${moeda(vFed)}; Estaduais: ${moeda(val(totTrib, "vTotTrib", "vTotTribEst"))}; Municipais: ${moeda(val(totTrib, "vTotTrib", "vTotTribMun"))}`
        : null;
  const infCompl = [val(serv, "infoCompl", "xInfComp"), val(inf, "xOutInf"), aproximados].filter(Boolean).join("\n");
  const complementares = bloco([[{ stack: [{ text: "INFORMAÇÕES COMPLEMENTARES", bold: true, fontSize: 7 }, { text: infCompl || "-", fontSize: 7 }], colSpan: 4 } as TableCell, vazio(), vazio(), vazio()]]);

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [12, 12, 12, 12],
    defaultStyle: { font: "Helvetica", fontSize: 7, lineHeight: 1.05 },
    info: { title: `DANFSe ${nfse.numero ?? ""} - ${nfse.chave}`, author: "Portal Guarese's ON" },
    background: (_p, tamanho) =>
      [
        { canvas: [{ type: "rect", x: 10, y: 10, w: tamanho.width - 20, h: tamanho.height - 20, lineWidth: 1 }] },
        // Marca d'água na diagonal (NT 008, 2.5.1): cinza, ao menos 50 pontos
        ...(opcoes.cancelada
          ? [
              {
                svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho.width}" height="${tamanho.height}"><text x="${tamanho.width / 2}" y="${tamanho.height / 2}" font-family="Helvetica" font-size="80" fill="#A6A6A6" text-anchor="middle" transform="rotate(-40 ${tamanho.width / 2} ${tamanho.height / 2})">CANCELADA</text></svg>`,
                absolutePosition: { x: 0, y: 0 },
              } as Content,
            ]
          : []),
      ] as Content,
    content: [
      cabecalho,
      linha(),
      ident,
      linha(),
      prestador,
      linha(),
      pessoa("TOMADOR / ADQUIRENTE", toma, "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e"),
      linha(),
      bloco([[titulo(toma ? "O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO" : "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", { colSpan: 4 }), vazio(), vazio(), vazio()]]),
      linha(),
      pessoa("INTERMEDIÁRIO DA OPERAÇÃO", interm, "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e"),
      linha(),
      servico,
      linha(),
      issqn,
      linha(),
      federal,
      linha(),
      ibscbs,
      linha(),
      totais,
      linha(),
      complementares,
    ],
  };
  const pm = await carregarPdfMake();
  return pm.createPdf(doc).getBuffer();
}
