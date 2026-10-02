import { Decimal, lerValorBR } from "@/lib/dinheiro";
import { lerData, type LinhaInvalida } from "@/lib/extratos/comum";
import type { CampoRelatorio, Modalidade, SituacaoVenda, TipoAdquirente } from "./rotulos";

/**
 * Leitura dos relatórios de vendas das adquirentes (CSV ou Excel).
 *
 * Cada adquirente usa colunas próprias. O portal procura a linha de cabeçalho,
 * sugere qual coluna é cada informação e, depois que alguém confere uma vez,
 * lembra o formato pela "assinatura" (os nomes das colunas) e passa a importar
 * sozinho os próximos relatórios iguais.
 */

export type MapeamentoMaquininha = { linhaCabecalho: number } & Record<CampoRelatorio, number | null>;

export interface VendaLida {
  data_venda: string;
  bandeira: string | null;
  modalidade: Modalidade;
  parcelas: number;
  valor_bruto: string;
  valor_taxa: string;
  valor_liquido: string | null;
  nsu: string | null;
  autorizacao: string | null;
  terminal: string | null;
  data_prevista: string | null;
  situacao: SituacaoVenda;
  linha: number;
  chave_unica: string;
}

export interface ResultadoLeitura {
  vendas: VendaLida[];
  invalidas: LinhaInvalida[];
  ignoradas: number;
}

/** Igual a app.maquininha_normalizar() no banco: sem acentos, maiúsculas, só letras e números. */
export function normalizarTexto(texto: string | null | undefined): string | null {
  const t = String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return t || null;
}

// ----------------------------------------------------------------- bandeiras
const SINONIMOS_BANDEIRA: [RegExp, string][] = [
  [/\bBEN VISA VALE\b|\bVISA VALE\b/, "BEN"],
  [/\bTICKET LOG\b|\bTICKETLOG\b/, "TICKET LOG"],
  [/\bMASTER ?CARD\b|\bMASTER\b|\bMAESTRO\b|\bMC\b/, "MASTERCARD"],
  [/\bVISA\b|\bELECTRON\b/, "VISA"],
  [/\bELO\b/, "ELO"],
  [/\bAMERICAN EXPRESS\b|\bAMEX\b/, "AMEX"],
  [/\bHIPER ?CARD\b/, "HIPERCARD"],
  [/\bHIPER\b/, "HIPER"],
  [/\bDINERS\b/, "DINERS"],
  [/\bDISCOVER\b/, "DISCOVER"],
  [/\bJCB\b/, "JCB"],
  [/\bCABAL\b/, "CABAL"],
  [/\bSOROCRED\b/, "SOROCRED"],
  [/\bBANESCARD\b/, "BANESCARD"],
  [/\bCREDSYSTEM\b/, "CREDSYSTEM"],
  [/\bCREDZ\b/, "CREDZ"],
  [/\bVERDE ?CARD\b/, "VERDECARD"],
  [/\bAURA\b/, "AURA"],
  [/\bSODEXO\b|\bPLUXEE\b/, "PLUXEE"],
  [/\bTICKET\b/, "TICKET"],
  [/\bALELO\b/, "ALELO"],
  [/\bVR\b/, "VR"],
  [/\bBEN\b/, "BEN"],
  [/\bVALE ?CARD\b/, "VALECARD"],
  [/\bGOOD ?CARD\b/, "GOODCARD"],
  [/\bPIX\b/, "PIX"],
];

/**
 * Bandeira em forma padrão (VISA, MASTERCARD...). Nomes desconhecidos ficam
 * como vieram (normalizados), salvo com `somenteConhecidas`.
 */
export function normalizarBandeira(texto: string | null | undefined, somenteConhecidas = false): string | null {
  const t = normalizarTexto(texto);
  if (!t) return null;
  for (const [re, nome] of SINONIMOS_BANDEIRA) if (re.test(t)) return nome;
  if (somenteConhecidas) return null;
  // Textos que não são bandeira (modalidade escrita na coluna da bandeira, traços)
  if (/^(DEBITO|CREDITO|A VISTA|PARCELADO|VOUCHER|PRE PAGO|OUTROS?|NAO INFORMAD[AO]|N A)$/.test(t)) return null;
  return t.length >= 2 ? t.slice(0, 40) : null;
}

// ---------------------------------------------------------------- modalidade
export function lerParcelas(texto: string | null | undefined): number | null {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return null;
  const limitar = (n: number) => (Number.isFinite(n) && n >= 1 && n <= 99 ? Math.trunc(n) : null);
  // "1/3", "1 de 3" (parcela atual de total): vale o total
  let m = /(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i.exec(bruto);
  if (m) return limitar(Number(m[2]));
  const t = normalizarTexto(bruto) ?? "";
  if (/\bA ?VISTA\b/.test(t)) return 1;
  m = /\b(\d{1,2}) ?X\b/.exec(t) ?? /\bEM (\d{1,2})\b/.exec(t);
  if (m) return limitar(Number(m[1]));
  m = /^0*(\d{1,2})$/.exec(t);
  if (m) return limitar(Number(m[1]));
  return null;
}

export function normalizarModalidade(texto: string | null | undefined, parcelas: number, tipo: TipoAdquirente | null): Modalidade {
  const t = normalizarTexto(texto) ?? "";
  if (/\bPIX\b/.test(t)) return "pix";
  if (tipo === "frota") return "frota";
  if (tipo === "beneficio") return "voucher";
  if (/PRE ?PAGO/.test(t)) return "pre_pago";
  if (/FROTA|COMBUST/.test(t)) return "frota";
  if (/VOUCHER|REFEICAO|ALIMENTACAO|BENEFICIO|\bVALE\b/.test(t)) return "voucher";
  if (/DEBITO|ELECTRON|MAESTRO/.test(t)) return "debito";
  // Parcelado pelo emissor (administradora): o lojista recebe e paga como crédito à vista
  if (/PARCELADO (EMISSOR|ADMINISTRADORA)|PARC (EMISSOR|ADM)/.test(t)) return "credito_vista";
  if (parcelas > 1) return "credito_parcelado";
  if (/PARCEL|\bPARC\b|LOJISTA/.test(t) && !/A ?VISTA|\b1 ?X\b/.test(t)) return "credito_parcelado";
  if (/CREDITO|A ?VISTA|ROTATIVO|\b1 ?X\b/.test(t)) return "credito_vista";
  return "outros";
}

export function lerSituacao(texto: string | null | undefined): SituacaoVenda {
  const t = normalizarTexto(texto) ?? "";
  if (/CHARGEBACK|CONTESTA/.test(t)) return "chargeback";
  if (/CANCEL|ESTORN|DESFEIT|NEGAD|RECUSAD|NAO AUTORIZ|NAO APROV|REPROVAD|DEVOLVID|EXPIRAD/.test(t)) return "cancelada";
  return "aprovada";
}

// ------------------------------------------------------------- cabeçalhos
type Padrao = { campo: CampoRelatorio; teste: (normal: string, original: string) => boolean };

const ehPercentual = (n: string, o: string) => o.includes("%") || /PERCENT|\bALIQ|\bPCT\b|TAXA EFETIVA/.test(n);
const PADROES: Padrao[] = [
  {
    campo: "previsao",
    teste: (n) => /PREVIS|VENCIMENTO|DATA D[AEO]S? (PAGAMENTO|PGTO|CREDITO|RECEBIMENTO|LIQUIDACAO|REPASSE)|DATA PREVISTA|DT (PAGTO|PGTO|CREDITO)/.test(n),
  },
  {
    campo: "data",
    teste: (n) =>
      (/^(DATA|DT)\b/.test(n) || /^DIA$/.test(n) || /DATA D[AEO] (VENDA|TRANSAC|CAPTURA|AUTORIZ|COMPRA|OPERAC)/.test(n)) &&
      !/PREVIS|PAGAMENTO|PGTO|PAGTO|CREDITO|RECEB|LIQUID|VENC|ANTECIP|REPASSE|CANCEL/.test(n),
  },
  {
    campo: "liquido",
    teste: (n) => /LIQUID|\bLIQ\b|A RECEBER|VALOR CREDITADO|VALOR RECEBIDO|VALOR (A )?PAGAR AO|LIQ\.?$/.test(n) && !/DATA|\bDT\b/.test(n),
  },
  {
    campo: "taxa_percentual",
    teste: (n, o) => /TAXA|TARIFA|MDR|DESCONTO|COMISSAO|ALIQ|PERCENT/.test(n) && ehPercentual(n, o),
  },
  {
    campo: "taxa",
    teste: (n, o) => /TAXA|TARIFA|\bMDR\b|DESCONTO|COMISSAO|CUSTO/.test(n) && !ehPercentual(n, o) && !/DATA|\bDT\b|ANTECIPACAO/.test(n),
  },
  {
    campo: "bruto",
    teste: (n) =>
      (/(VALOR|VLR|VL)( DA| DO)? (BRUTO|VENDA|TOTAL|ORIGINAL|TRANSAC|PARCELA|COMPRA|OPERAC)/.test(n) ||
        /^(BRUTO|VALOR BRUTO|VALOR( R)?|VLR( R)?|VALOR DA VENDA|VENDA BRUTA|TOTAL BRUTO)$/.test(n)) &&
      !/LIQUID|\bLIQ\b|TAXA|TARIFA|DESCONTO|MDR|ANTECIP|CANCEL|DATA|\bDT\b/.test(n),
  },
  { campo: "bandeira", teste: (n) => /BANDEIRA|\bBRAND\b|\bARRANJO\b/.test(n) },
  {
    campo: "modalidade",
    teste: (n) =>
      /MODALIDADE|FORMA D[EO] PAGAMENTO|MEIO D[EO] PAGAMENTO|\bPRODUTO\b|TIPO D[AEO] (TRANSAC|VENDA|PAGAMENTO|CARTAO|PRODUTO|OPERAC|CAPTURA)|^TIPO$|^PLANO$|^FORMA$|^MEIO$/.test(n),
  },
  { campo: "parcelas", teste: (n) => /PARCELAS?\b|\bPARC\b|QTD PARC|QTDE PARC|N PARC|NUM PARC/.test(n) && !/VALOR|VLR|\bVL\b|DATA|\bDT\b/.test(n) },
  {
    campo: "nsu",
    teste: (n) => /\bNSU\b|COD(IGO)? (DA )?(VENDA|TRANSAC)|ID (DA )?(VENDA|TRANSAC)|STONE ID|\bTID\b|NUMERO (DA )?(VENDA|TRANSAC)|\bCV\b|COMPROVANTE|\bDOC\b/.test(n),
  },
  { campo: "autorizacao", teste: (n) => /AUTORIZ|COD(IGO)? AUT|^AUT$/.test(n) && !/DATA|\bDT\b/.test(n) },
  { campo: "terminal", teste: (n) => /TERMINAL|MAQUIN|\bPOS\b|NUMERO LOGICO|\bSERIAL\b|NUMERO DE SERIE|\bLOGICO\b/.test(n) },
  { campo: "situacao", teste: (n) => /SITUACAO|STATUS|^ESTADO/.test(n) },
];

function camposDaCelula(celula: string): CampoRelatorio[] {
  const n = normalizarTexto(celula);
  if (!n || n.length > 80) return [];
  return PADROES.filter((p) => p.teste(n, celula)).map((p) => p.campo);
}

/** Linha de cabeçalho: a que mais se parece com nomes de colunas de relatório de vendas. */
export function detectarCabecalho(linhas: string[][]): number {
  let melhor = -1;
  let pontos = 2;
  for (let i = 0; i < Math.min(linhas.length, 40); i++) {
    const l = linhas[i] ?? [];
    const campos = new Set(l.flatMap((c) => camposDaCelula(c)));
    // Precisa parecer cabeçalho: data e algum valor
    const n = campos.size + (campos.has("data") ? 1 : 0) + (campos.has("bruto") || campos.has("liquido") ? 1 : 0);
    if (n > pontos) {
      melhor = i;
      pontos = n;
    }
  }
  return melhor;
}

/** Assinatura do formato: os nomes das colunas, normalizados. */
export function assinaturaCabecalho(cabecalho: string[]): string {
  const cel = cabecalho.map((c) => (normalizarTexto(c) ?? "").toLowerCase());
  while (cel.length && !cel[cel.length - 1]) cel.pop();
  return cel.join("|").slice(0, 2000);
}

/** Procura a linha de cabeçalho pela assinatura (os relatórios podem ter linhas de título antes). */
export function localizarCabecalho(linhas: string[][], assinatura: string | null | undefined): number {
  if (assinatura) {
    for (let i = 0; i < Math.min(linhas.length, 60); i++) if (assinaturaCabecalho(linhas[i] ?? []) === assinatura) return i;
  }
  return detectarCabecalho(linhas);
}

const MAPEAMENTO_VAZIO = {
  data: null,
  bruto: null,
  liquido: null,
  taxa: null,
  taxa_percentual: null,
  bandeira: null,
  modalidade: null,
  parcelas: null,
  nsu: null,
  autorizacao: null,
  terminal: null,
  previsao: null,
  situacao: null,
} satisfies Record<CampoRelatorio, null>;

export function sugerirMapeamento(cabecalho: string[], linhaCabecalho: number): MapeamentoMaquininha {
  const m: MapeamentoMaquininha = { linhaCabecalho, ...MAPEAMENTO_VAZIO };
  const usados = new Set<number>();
  // Ordem dos padrões define a prioridade (datas antes de valores; valores antes de códigos)
  for (const p of PADROES) {
    const candidatos = cabecalho
      .map((c, i) => ({ i, n: normalizarTexto(c), c }))
      .filter((x) => x.n && !usados.has(x.i) && x.n.length <= 80 && p.teste(x.n, x.c));
    if (!candidatos.length) continue;
    let escolhido = candidatos[0];
    if (p.campo === "data") escolhido = candidatos.find((x) => /VENDA|TRANSAC|CAPTURA|COMPRA/.test(x.n!)) ?? escolhido;
    if (p.campo === "bruto") escolhido = candidatos.find((x) => /BRUTO/.test(x.n!)) ?? escolhido;
    m[p.campo] = escolhido.i;
    usados.add(escolhido.i);
  }
  return m;
}

/** Sugere a adquirente pelo nome do arquivo ou pelo conteúdo do cabeçalho. */
export function sugerirAdquirente<T extends { codigo: string; nome: string }>(textos: string[], catalogo: T[]): T | null {
  const alvo = ` ${normalizarTexto(textos.join(" ")) ?? ""} `;
  const apelidos: Record<string, string[]> = {
    pagbank: ["PAGSEGURO", "PAGBANK", "MODERNINHA"],
    mercado_pago: ["MERCADO PAGO", "MERCADOPAGO"],
    pluxee: ["PLUXEE", "SODEXO"],
    ticket_log: ["TICKET LOG", "TICKETLOG"],
    ben: ["BEN VISA", "BEN BENEFICIOS"],
    caixa: ["AZULZINHA", "CAIXA PAGAMENTOS"],
    rede: ["USEREDE", "REDECARD", "REDE ITAU"],
    ifood_beneficios: ["IFOOD BENEFICIOS"],
    ifood_pago: ["IFOOD PAGO"],
  };
  let melhor: { item: T; tam: number } | null = null;
  for (const item of catalogo) {
    const nomes = apelidos[item.codigo] ?? [normalizarTexto(item.nome.replace(/\(.*?\)/g, ""))?.split(" / ")[0] ?? ""];
    for (const nome of nomes) {
      if (nome.length < 3) continue;
      if (alvo.includes(` ${nome} `) && (!melhor || nome.length > melhor.tam)) melhor = { item, tam: nome.length };
    }
  }
  return melhor?.item ?? null;
}

// ------------------------------------------------------------------ leitura
function lerValorCelula(texto: string): Decimal | null {
  return lerValorBR(String(texto ?? "").replace(/%/g, ""));
}

function textoCurto(v: string, max = 60): string | null {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : null;
}

/** Lê as vendas do relatório conforme as colunas indicadas. */
export function lerVendas(linhas: string[][], m: MapeamentoMaquininha, tipo: TipoAdquirente | null): ResultadoLeitura {
  const vendas: VendaLida[] = [];
  const invalidas: LinhaInvalida[] = [];
  let ignoradas = 0;
  const pegar = (l: string[], i: number | null) => (i === null || i < 0 ? "" : String(l[i] ?? "").trim());
  const contagem = new Map<string, number>();

  for (let i = Math.max(0, m.linhaCabecalho + 1); i < linhas.length; i++) {
    const l = linhas[i] ?? [];
    const preenchidas = l.filter((c) => String(c ?? "").trim());
    if (!preenchidas.length) continue;
    const primeira = normalizarTexto(preenchidas[0]) ?? "";
    if (/^(TOTAL|SUBTOTAL|SOMA|RESUMO|QUANTIDADE|QTDE)\b/.test(primeira)) {
      ignoradas++;
      continue;
    }
    const conteudo = l.join(" | ").slice(0, 200);
    const data = lerData(pegar(l, m.data));
    if (!data) {
      if (preenchidas.length <= 2) ignoradas++;
      else invalidas.push({ linha: i + 1, motivo: "Data da venda ausente ou inválida", conteudo });
      continue;
    }
    const brutoLido = lerValorCelula(pegar(l, m.bruto));
    if (!brutoLido || brutoLido.isZero()) {
      invalidas.push({ linha: i + 1, motivo: "Valor da venda ausente ou zero", conteudo });
      continue;
    }
    const bruto = brutoLido.abs();
    const liquidoLido = m.liquido !== null ? lerValorCelula(pegar(l, m.liquido)) : null;
    let taxa: Decimal | null = null;
    if (liquidoLido) taxa = bruto.minus(liquidoLido.abs());
    else if (m.taxa !== null && lerValorCelula(pegar(l, m.taxa))) taxa = lerValorCelula(pegar(l, m.taxa))!.abs();
    else if (m.taxa_percentual !== null && lerValorCelula(pegar(l, m.taxa_percentual))) {
      taxa = bruto.times(lerValorCelula(pegar(l, m.taxa_percentual))!.abs()).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }
    if (!taxa) {
      invalidas.push({ linha: i + 1, motivo: "Sem valor líquido nem valor da taxa", conteudo });
      continue;
    }
    if (taxa.isNegative()) {
      invalidas.push({ linha: i + 1, motivo: "Valor líquido maior que o valor da venda", conteudo });
      continue;
    }
    const textoModalidade = [pegar(l, m.modalidade), pegar(l, m.bandeira)].filter(Boolean).join(" ");
    const parcelas = lerParcelas(pegar(l, m.parcelas)) ?? lerParcelas(pegar(l, m.modalidade)) ?? 1;
    const modalidade = normalizarModalidade(textoModalidade, parcelas, tipo);
    let bandeira = normalizarBandeira(pegar(l, m.bandeira)) ?? normalizarBandeira(pegar(l, m.modalidade), true);
    if (bandeira === "PIX") bandeira = null;
    let situacao = lerSituacao(pegar(l, m.situacao));
    // Linha com valor negativo é estorno/cancelamento
    if (brutoLido.isNegative() && situacao === "aprovada") situacao = "cancelada";
    const nsu = textoCurto(pegar(l, m.nsu));
    const autorizacao = textoCurto(pegar(l, m.autorizacao));
    const terminal = textoCurto(pegar(l, m.terminal));
    const valor = bruto.toFixed(2);
    const base = nsu
      ? `${data}|N:${nsu}|${valor}`
      : autorizacao
        ? `${data}|A:${autorizacao}|${valor}`
        : `${data}|${valor}|${parcelas}|${bandeira ?? ""}|${modalidade}|${terminal ?? ""}`;
    const ocorrencia = (contagem.get(base) ?? 0) + 1;
    contagem.set(base, ocorrencia);
    vendas.push({
      data_venda: data,
      bandeira,
      modalidade,
      parcelas: modalidade === "credito_parcelado" ? Math.max(parcelas, 2) : 1,
      valor_bruto: valor,
      valor_taxa: taxa.toFixed(2),
      valor_liquido: bruto.minus(taxa).toFixed(2),
      nsu,
      autorizacao,
      terminal,
      data_prevista: lerData(pegar(l, m.previsao)),
      situacao,
      linha: i + 1,
      chave_unica: `${base}|${ocorrencia}`,
    });
  }
  return { vendas, invalidas, ignoradas };
}

/** Linhas de exemplo para a tela de conferência das colunas. */
export function amostraDoRelatorio(linhas: string[][], linhaCabecalho: number, quantidade = 5): string[][] {
  const amostra: string[][] = [];
  for (let i = linhaCabecalho + 1; i < linhas.length && amostra.length < quantidade; i++) {
    const l = linhas[i] ?? [];
    if (!l.some((c) => String(c ?? "").trim())) continue;
    amostra.push(l.slice(0, 40).map((c) => String(c ?? "").slice(0, 60)));
  }
  return amostra;
}
