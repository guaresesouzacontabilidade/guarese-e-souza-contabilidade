import Papa from "papaparse";
import { Decimal, lerValorBR } from "@/lib/dinheiro";
import { decodificarTexto, ehLinhaDeSaldo, extrairDocumento, lerData, numerarOcorrencias, type LinhaInvalida, type TransacaoExtrato } from "./comum";

/** Leitura de extratos e planilhas (CSV, XLSX) com mapeamento de colunas. */

export interface Mapeamento {
  linhaCabecalho: number; // índice (0-based) da linha de cabeçalho; -1 = sem cabeçalho
  data: number | null;
  descricao: number | null;
  complemento: number | null;
  documento: number | null;
  valor: number | null; // coluna única com sinal (ou com D/C)
  debito: number | null; // colunas separadas
  credito: number | null;
  tipo: number | null; // coluna "D"/"C"
  saldo: number | null;
  inverterSinal: boolean;
}

export interface ResultadoPlanilha {
  linhas: string[][];
  cabecalho: string[];
  mapeamento: Mapeamento;
}

export async function lerArquivoPlanilha(bytes: Uint8Array, nome: string): Promise<string[][]> {
  const ext = nome.toLowerCase().split(".").pop();
  if (ext === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
    if (!ws) return [];
    const linhas: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const valores: string[] = [];
      const n = row.cellCount;
      for (let c = 1; c <= n; c++) {
        const cel = row.getCell(c);
        const v = cel.value as unknown;
        if (v === null || v === undefined) valores.push("");
        else if (v instanceof Date) valores.push(v.toISOString().slice(0, 10));
        else if (typeof v === "object" && v && "result" in (v as object)) valores.push(String((v as { result: unknown }).result ?? ""));
        else if (typeof v === "object" && v && "richText" in (v as object))
          valores.push(((v as { richText: { text: string }[] }).richText ?? []).map((r) => r.text).join(""));
        else if (typeof v === "object" && v && "text" in (v as object)) valores.push(String((v as { text: unknown }).text ?? ""));
        else if (typeof v === "number") valores.push(cel.numFmt && /[dmy]/i.test(cel.numFmt) ? String(v) : numeroParaTexto(v));
        else valores.push(String(v));
      }
      linhas.push(valores.map((x) => x.trim()));
    });
    return linhas.slice(0, 50000);
  }
  if (ext === "xls") {
    throw new Error("O formato .xls (Excel 97-2003) não é suportado. Abra o arquivo e salve como .xlsx ou .csv.");
  }
  const texto = decodificarTexto(bytes);
  const r = Papa.parse<string[]>(texto, { skipEmptyLines: "greedy", delimiter: "" });
  return (r.data as string[][]).map((l) => l.map((c) => String(c ?? "").trim())).slice(0, 50000);
}

function numeroParaTexto(v: number) {
  // Mantém a representação decimal exata para valores monetários de planilhas
  return new Decimal(v.toString()).toString();
}

const PADROES: Record<keyof Omit<Mapeamento, "linhaCabecalho" | "inverterSinal">, RegExp> = {
  data: /^(data|dt|data\s*(mov|lan[cç]|opera|transa)|date|dia)/i,
  descricao: /(hist[oó]rico|descri[cç][aã]o|lan[cç]amento|estabelecimento|memo|detalhe|transa[cç][aã]o|description)/i,
  complemento: /(complemento|observa|detalhes?$)/i,
  documento: /(documento|doc\.?|n[ºo°]?\s*doc|cpf|cnpj|refer[eê]ncia)/i,
  valor: /^(valor|vlr|value|amount|montante|quantia)(\s*\(r\$\))?$/i,
  debito: /(d[eé]bito|sa[ií]da|debit)/i,
  credito: /(cr[eé]dito|entrada|credit)/i,
  tipo: /^(tipo|d\/c|c\/d|natureza|sinal)$/i,
  saldo: /(saldo|balance)/i,
};

export function detectarCabecalho(linhas: string[][]): number {
  for (let i = 0; i < Math.min(linhas.length, 30); i++) {
    const l = linhas[i];
    const acertos = l.filter((c) => c && Object.values(PADROES).some((p) => p.test(c))).length;
    if (acertos >= 2) return i;
  }
  return -1;
}

export function sugerirMapeamento(linhas: string[][]): Mapeamento {
  const linhaCabecalho = detectarCabecalho(linhas);
  const cab = linhaCabecalho >= 0 ? linhas[linhaCabecalho] : [];
  const achar = (p: RegExp, excluir: number[] = []) => {
    const i = cab.findIndex((c, idx) => !excluir.includes(idx) && p.test(c ?? ""));
    return i >= 0 ? i : null;
  };
  const m: Mapeamento = {
    linhaCabecalho,
    data: achar(PADROES.data),
    descricao: null,
    complemento: null,
    documento: null,
    valor: null,
    debito: null,
    credito: null,
    tipo: null,
    saldo: achar(PADROES.saldo),
    inverterSinal: false,
  };
  const usados = [m.data, m.saldo].filter((x): x is number => x !== null);
  m.descricao = achar(PADROES.descricao, usados);
  if (m.descricao !== null) usados.push(m.descricao);
  m.debito = achar(PADROES.debito, usados);
  if (m.debito !== null) usados.push(m.debito);
  m.credito = achar(PADROES.credito, usados);
  if (m.credito !== null) usados.push(m.credito);
  m.valor = m.debito !== null || m.credito !== null ? null : achar(PADROES.valor, usados) ?? achar(/valor/i, usados);
  if (m.valor !== null) usados.push(m.valor);
  m.documento = achar(PADROES.documento, usados);
  if (m.documento !== null) usados.push(m.documento);
  m.tipo = achar(PADROES.tipo, usados);
  m.complemento = achar(PADROES.complemento, usados);

  // Sem cabeçalho: tenta deduzir pelo conteúdo da primeira linha de dados
  if (linhaCabecalho < 0 && linhas[0]) {
    const l = linhas[0];
    m.data = l.findIndex((c) => lerData(c) !== null);
    if (m.data < 0) m.data = null;
    const idxValor = [...l.keys()].reverse().find((i) => i !== m.data && lerValorBR(l[i]) !== null && /[\d]/.test(l[i]));
    m.valor = idxValor ?? null;
    const idxDesc = l.findIndex((c, i) => i !== m.data && i !== m.valor && /[A-Za-z]{3,}/.test(c));
    m.descricao = idxDesc >= 0 ? idxDesc : null;
  }
  return m;
}

export interface ResultadoMapeamento {
  transacoes: TransacaoExtrato[];
  invalidas: LinhaInvalida[];
  ignoradas: LinhaInvalida[];
  saldoFinal: { valor: string; data: string } | null;
}

export function aplicarMapeamento(linhas: string[][], m: Mapeamento): ResultadoMapeamento {
  const transacoes: TransacaoExtrato[] = [];
  const invalidas: LinhaInvalida[] = [];
  const ignoradas: LinhaInvalida[] = [];
  const saldos: { valor: string; data: string; ordem: number }[] = [];
  const inicio = m.linhaCabecalho + 1;
  const pegar = (l: string[], i: number | null) => (i === null || i < 0 ? "" : (l[i] ?? "").trim());

  for (let i = inicio; i < linhas.length; i++) {
    const l = linhas[i];
    const numeroLinha = i + 1;
    if (!l || l.every((c) => !c)) continue;
    const descricaoBase = pegar(l, m.descricao);
    const complemento = pegar(l, m.complemento);
    const descricao = [descricaoBase, complemento].filter(Boolean).join(" - ").replace(/\s+/g, " ").trim();
    const data = lerData(pegar(l, m.data));

    if (descricao && ehLinhaDeSaldo(descricao)) {
      const sv = lerValorBR(pegar(l, m.saldo) || pegar(l, m.valor));
      if (sv && data) saldos.push({ valor: sv.toFixed(2), data, ordem: i });
      ignoradas.push({ linha: numeroLinha, motivo: "Linha de saldo (não é movimentação)", conteudo: descricao });
      continue;
    }
    if (!data) {
      invalidas.push({ linha: numeroLinha, motivo: "Data ausente ou inválida", conteudo: l.join(" | ").slice(0, 200) });
      continue;
    }

    let valor: Decimal | null = null;
    if (m.debito !== null || m.credito !== null) {
      const deb = lerValorBR(pegar(l, m.debito));
      const cred = lerValorBR(pegar(l, m.credito));
      if (deb && !deb.isZero()) valor = deb.abs().negated();
      else if (cred && !cred.isZero()) valor = cred.abs();
    } else {
      valor = lerValorBR(pegar(l, m.valor));
      const tipo = pegar(l, m.tipo).toUpperCase();
      if (valor && tipo) {
        if (/^D|DEB|SAI/.test(tipo)) valor = valor.abs().negated();
        else if (/^C|CRED|ENT/.test(tipo)) valor = valor.abs();
      }
    }
    if (!valor || valor.isZero()) {
      invalidas.push({ linha: numeroLinha, motivo: "Valor ausente, zero ou inválido", conteudo: l.join(" | ").slice(0, 200) });
      continue;
    }
    if (m.inverterSinal) valor = valor.negated();
    const saldoLinha = lerValorBR(pegar(l, m.saldo));
    if (saldoLinha) saldos.push({ valor: saldoLinha.toFixed(2), data, ordem: i });

    const docColuna = pegar(l, m.documento).replace(/\D/g, "");
    transacoes.push({
      data,
      valor: valor.toFixed(2),
      descricao: descricao || "Sem descrição",
      documento: (docColuna.length === 11 || docColuna.length === 14 ? extrairDocumento(docColuna) : null) ?? extrairDocumento(descricao),
      fitid: null,
      tipo: null,
      numero: m.documento !== null && docColuna && docColuna.length < 11 ? pegar(l, m.documento) : null,
      ocorrencia: 1,
      linha: numeroLinha,
    });
  }
  // Saldo final = saldo informado na data mais recente (extratos podem vir em ordem crescente ou decrescente)
  let saldoFinal: { valor: string; data: string } | null = null;
  if (saldos.length) {
    const crescente = transacoes.length < 2 || transacoes[0].data <= transacoes[transacoes.length - 1].data;
    const ordenados = [...saldos].sort((a, b) => (a.data === b.data ? (crescente ? a.ordem - b.ordem : b.ordem - a.ordem) : a.data.localeCompare(b.data)));
    const ultimo = ordenados[ordenados.length - 1];
    saldoFinal = { valor: ultimo.valor, data: ultimo.data };
  }
  return { transacoes: numerarOcorrencias(transacoes), invalidas, ignoradas, saldoFinal };
}
