import Papa from "papaparse";
import { Decimal, lerValorBR } from "@/lib/dinheiro";

/**
 * Planilha de produtos e estoque da loja (Excel ou CSV): reconhece as colunas
 * pelo título, confere cada linha e diz o que vai acontecer (produto novo,
 * atualização ou erro) antes de gravar. Números de células do Excel são lidos
 * como números (sem confundir "1.234" com milhar); no CSV, no padrão brasileiro.
 */

export const CAMPOS_PLANILHA = [
  { chave: "codigo", titulo: "Código", ajuda: "Código do produto na loja. Igual a um código já cadastrado = atualiza; vazio = o portal numera." },
  { chave: "descricao", titulo: "Descrição", ajuda: "Nome do produto (2 a 120 letras). Obrigatório para produto novo." },
  { chave: "ncm", titulo: "NCM", ajuda: "8 números. Obrigatório para produto novo (vai na nota fiscal)." },
  { chave: "unidade", titulo: "Unidade", ajuda: "Ex.: UN, KG, M3, CX (até 6 letras). Obrigatório para produto novo." },
  { chave: "preco_venda", titulo: "Preço de venda", ajuda: "Preço de uma unidade. Obrigatório para produto novo." },
  { chave: "preco_custo", titulo: "Preço de custo", ajuda: "Custo de uma unidade (entra no custo médio do estoque)." },
  { chave: "estoque", titulo: "Estoque", ajuda: "Quantidade que tem hoje. O saldo do produto passa a ser este (fica no histórico)." },
  { chave: "estoque_minimo", titulo: "Estoque mínimo", ajuda: "Abaixo dele o produto aparece em “Abaixo do mínimo”." },
  { chave: "grupo", titulo: "Grupo", ajuda: "Categoria para organizar (ex.: Vigas, Tábuas)." },
  { chave: "gtin", titulo: "Código de barras (GTIN)", ajuda: "8, 12, 13 ou 14 números." },
  { chave: "cest", titulo: "CEST", ajuda: "7 números (produtos com substituição tributária)." },
] as const;

export type CampoPlanilha = (typeof CAMPOS_PLANILHA)[number]["chave"];
export type Celula = string | number | null;

export type LinhaProduto = { linha: number } & Record<CampoPlanilha, string | null>;

export interface LinhaAnalisada extends LinhaProduto {
  situacao: "novo" | "atualizar" | "erro";
  erros: string[];
}

/** Só os campos do produto (sem a conferência), para enviar ao servidor. */
export function dadosDaLinha(l: LinhaProduto): LinhaProduto {
  const r = { linha: l.linha } as LinhaProduto;
  for (const c of CAMPOS_PLANILHA) r[c.chave] = l[c.chave] ?? null;
  return r;
}

const ALIASES: Record<CampoPlanilha, RegExp> = {
  codigo: /^(cod|codigo|cod produto|codigo do produto|codigo produto|sku|referencia|ref)$/,
  descricao: /^(descricao|descricao do produto|produto|nome|nome do produto|item)$/,
  ncm: /^ncm/,
  unidade: /^(un|und|unid|unidade|unidade de medida|medida|um)$/,
  preco_venda: /^(preco|preco de venda|preco venda|valor|valor de venda|valor unitario|preco unitario|venda)$/,
  preco_custo: /^(custo|preco de custo|preco custo|valor de custo|custo unitario)$/,
  estoque: /^(estoque|estoque atual|saldo|saldo atual|quantidade|qtd|qtde|qt)$/,
  estoque_minimo: /^(estoque minimo|minimo|est minimo|qtd minima|quantidade minima)$/,
  grupo: /^(grupo|categoria|familia|departamento|secao)$/,
  gtin: /^(gtin|ean|codigo de barras|cod barras|codigo de barras gtin|gtin ean)$/,
  cest: /^cest/,
};

/** Título de coluna sem acentos, pontuação e espaços repetidos. */
export function normalizarTitulo(t: string) {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Linhas da planilha (a primeira aba com dados do Excel, ou o CSV). */
export async function lerPlanilhaProdutos(bytes: Uint8Array, nome: string): Promise<Celula[][]> {
  const abas = await lerAbasPlanilha(bytes, nome);
  return (abas.find((a) => a.linhas.length > 0) ?? abas[0])?.linhas ?? [];
}

/** Todas as abas do Excel (só as que têm dados) ou o CSV como uma aba só. Até 20.000 linhas por aba. */
export async function lerAbasPlanilha(bytes: Uint8Array, nome: string): Promise<{ nome: string; linhas: Celula[][] }[]> {
  const ext = nome.toLowerCase().split(".").pop();
  if (ext === "xls") throw new Error("O formato .xls (Excel 97-2003) não é aceito. Abra o arquivo e salve como .xlsx ou .csv.");
  if (ext === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const abas = wb.worksheets.filter((w) => w.actualRowCount > 0).map((ws) => ({ nome: ws.name, linhas: linhasDaAba(ws) }));
    return abas.length ? abas : wb.worksheets.slice(0, 1).map((ws) => ({ nome: ws.name, linhas: [] }));
  }
  const texto = new TextDecoder(ehUtf8(bytes) ? "utf-8" : "windows-1252").decode(bytes);
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const delimitador = primeira.includes(";") ? ";" : primeira.includes("\t") ? "\t" : ",";
  const r = Papa.parse<string[]>(texto, { skipEmptyLines: false, delimiter: delimitador });
  const linhas = (r.data as string[][]).map((l) => l.map((c) => (String(c ?? "").trim() === "" ? null : String(c).trim()))).slice(0, 20000);
  return [{ nome: nome.replace(/\.[^.]+$/, ""), linhas }];
}

type AbaExcel = import("exceljs").Worksheet;

function linhasDaAba(ws: AbaExcel): Celula[][] {
  const linhas: Celula[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > 20000) return;
    const valores: Celula[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value as unknown;
      if (v === null || v === undefined) valores.push(null);
      else if (typeof v === "number") valores.push(v);
      else if (v instanceof Date) valores.push(v.toISOString().slice(0, 10));
      else if (typeof v === "object" && "result" in (v as object)) {
        const r = (v as { result: unknown }).result;
        valores.push(typeof r === "number" ? r : r instanceof Date ? r.toISOString().slice(0, 10) : r == null ? null : String(r));
      } else if (typeof v === "object" && "richText" in (v as object)) valores.push((v as { richText: { text: string }[] }).richText.map((r) => r.text).join(""));
      else if (typeof v === "object" && "text" in (v as object)) valores.push(String((v as { text: unknown }).text ?? ""));
      else valores.push(String(v));
    }
    linhas[n - 1] = valores;
  });
  return Array.from(linhas, (l) => l ?? []);
}

function ehUtf8(bytes: Uint8Array) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Primeira linha que tem pelo menos duas colunas reconhecidas (descrição, código, NCM...). */
export function acharCabecalho(linhas: Celula[][]): { indice: number; colunas: Partial<Record<CampoPlanilha, number>> } | null {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const colunas: Partial<Record<CampoPlanilha, number>> = {};
    (linhas[i] ?? []).forEach((c, j) => {
      if (c == null) return;
      const t = normalizarTitulo(String(c));
      for (const campo of Object.keys(ALIASES) as CampoPlanilha[]) {
        if (colunas[campo] === undefined && ALIASES[campo].test(t)) {
          colunas[campo] = j;
          break;
        }
      }
    });
    if (Object.keys(colunas).length >= 2) return { indice: i, colunas };
  }
  return null;
}

function textoCelula(c: Celula | undefined): string | null {
  if (c == null) return null;
  const t = typeof c === "number" ? new Decimal(c.toString()).toString() : String(c).trim();
  return t === "" ? null : t;
}

/** Número da célula: número do Excel como está; texto no padrão brasileiro ("1.234,5"). */
function numeroCelula(c: Celula | undefined): Decimal | null | "invalido" {
  if (c == null || (typeof c === "string" && c.trim() === "")) return null;
  if (typeof c === "number") return Number.isFinite(c) ? new Decimal(c.toString()) : "invalido";
  const d = lerValorBR(c);
  return d ?? "invalido";
}

/** Confere cada linha: o que é produto novo, o que atualiza um código existente e o que tem erro. */
export function analisarProdutos(linhas: Celula[][], codigosExistentes: Set<string>): { linhas: LinhaAnalisada[]; colunas: CampoPlanilha[]; erroGeral?: string } {
  const cab = acharCabecalho(linhas);
  if (!cab) return { linhas: [], colunas: [], erroGeral: "Não encontramos os títulos das colunas (ex.: Código, Descrição, NCM, Unidade, Preço de venda). Use o modelo." };
  if (cab.colunas.descricao === undefined && cab.colunas.codigo === undefined) {
    return { linhas: [], colunas: Object.keys(cab.colunas) as CampoPlanilha[], erroGeral: "A planilha precisa da coluna Código ou da coluna Descrição." };
  }
  const vistos = new Map<string, number>();
  const resultado: LinhaAnalisada[] = [];
  for (let i = cab.indice + 1; i < linhas.length; i++) {
    const l = linhas[i] ?? [];
    if (!l.some((c) => c != null && String(c).trim() !== "")) continue;
    const pega = (campo: CampoPlanilha) => (cab.colunas[campo] === undefined ? undefined : l[cab.colunas[campo]!]);
    const erros: string[] = [];
    const linha: LinhaProduto = { linha: i + 1 } as LinhaProduto;
    for (const { chave } of CAMPOS_PLANILHA) linha[chave] = null;

    linha.codigo = textoCelula(pega("codigo"));
    if (linha.codigo && linha.codigo.length > 60) erros.push("código com mais de 60 letras");
    linha.descricao = textoCelula(pega("descricao"));
    if (linha.descricao && (linha.descricao.length < 2 || linha.descricao.length > 120)) erros.push("descrição precisa de 2 a 120 letras");
    const ncm = textoCelula(pega("ncm"));
    if (ncm) {
      linha.ncm = ncm.replace(/\D/g, "");
      if (!/^\d{8}$/.test(linha.ncm)) erros.push("NCM precisa de 8 números");
    }
    const un = textoCelula(pega("unidade"));
    if (un) {
      linha.unidade = un.toUpperCase();
      if (linha.unidade.length > 6) erros.push("unidade com mais de 6 letras");
    }
    for (const [campo, rotulo, casas] of [
      ["preco_venda", "preço de venda", 10],
      ["preco_custo", "preço de custo", 4],
      ["estoque", "estoque", 4],
      ["estoque_minimo", "estoque mínimo", 4],
    ] as const) {
      const bruto = pega(campo);
      let n = numeroCelula(bruto);
      // Número calculado no Excel pode vir com resíduo (0,30000000000000004): arredonda às casas aceitas
      if (n instanceof Decimal && typeof bruto === "number") n = n.toDecimalPlaces(casas);
      if (n === "invalido") erros.push(`${rotulo} não é um número`);
      else if (n !== null) {
        if (n.isNegative()) erros.push(`${rotulo} negativo`);
        else if (n.decimalPlaces() > casas) erros.push(`${rotulo} com mais de ${casas} casas decimais`);
        else linha[campo] = n.toString();
      }
    }
    linha.grupo = textoCelula(pega("grupo"))?.slice(0, 60) ?? null;
    const gtin = textoCelula(pega("gtin"));
    if (gtin) {
      linha.gtin = gtin.replace(/\D/g, "");
      if (!/^(\d{8}|\d{12,14})$/.test(linha.gtin)) erros.push("código de barras precisa de 8, 12, 13 ou 14 números");
    }
    const cest = textoCelula(pega("cest"));
    if (cest) {
      linha.cest = cest.replace(/\D/g, "");
      if (!/^\d{7}$/.test(linha.cest)) erros.push("CEST precisa de 7 números");
    }

    const existe = linha.codigo !== null && codigosExistentes.has(linha.codigo);
    if (!existe) {
      const faltam = [!linha.descricao && "descrição", !linha.ncm && "NCM", !linha.unidade && "unidade", !linha.preco_venda && "preço de venda"].filter(Boolean);
      if (faltam.length) erros.push(`produto novo precisa de ${faltam.join(", ")}`);
    }
    if (linha.codigo) {
      const anterior = vistos.get(linha.codigo);
      if (anterior) erros.push(`código repetido (também na linha ${anterior})`);
      else vistos.set(linha.codigo, linha.linha);
    }
    resultado.push({ ...linha, situacao: erros.length ? "erro" : existe ? "atualizar" : "novo", erros });
  }
  return { linhas: resultado, colunas: Object.keys(cab.colunas) as CampoPlanilha[] };
}
