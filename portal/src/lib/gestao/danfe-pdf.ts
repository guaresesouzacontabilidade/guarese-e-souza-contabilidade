import "server-only";
import Decimal from "decimal.js";
import { lerValorBR } from "@/lib/dinheiro";
import { chaveValida, partesChave } from "@/lib/fiscal/chave";
import { validarCnpj, validarCpf } from "@/lib/formatos";

/**
 * Leitura do DANFE (o PDF da NF-e) para a entrada de mercadorias no estoque.
 *
 * O PDF não tem a estrutura do XML: o portal lê o texto com a posição de cada
 * trecho na página, remonta as linhas como aparecem impressas e reconhece:
 *  - a chave de acesso (44 números, com o dígito verificador conferido), de
 *    onde saem o CNPJ/CPF do fornecedor, a série e o número da nota;
 *  - o nome do fornecedor (canhoto "RECEBEMOS DE ..."), a data de emissão e
 *    os totais (dos produtos e da nota);
 *  - cada item do quadro "Dados dos produtos": código, descrição, NCM, CST,
 *    CFOP, unidade, quantidade, valor unitário, valor total e desconto.
 * A leitura é conferida (quantidade × valor unitário = total de cada item, e
 * a soma dos itens = total dos produtos). Se algo não bate, o portal não
 * lança e pede o XML. Tudo é lido no servidor do portal: nada vai para fora.
 */

export interface Trecho {
  pagina: number;
  x: number;
  /** Altura na página (cresce para cima, como no PDF). */
  y: number;
  largura: number;
  texto: string;
}

export interface ItemDanfe {
  numero_item: number;
  codigo: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  /** Números com ponto decimal (como no XML). */
  quantidade: string;
  valor_unitario: string | null;
  valor_total: string;
  valor_desconto: string | null;
}

export interface DanfeLido {
  chave: string;
  serie: string;
  numero: string;
  emitente_documento: string;
  emitente_nome: string | null;
  data_emissao: string | null;
  valor_produtos: string | null;
  valor_total: string | null;
  /** O CNPJ/CPF da empresa aparece no DANFE (fora da chave). */
  empresa_no_documento: boolean;
  itens: ItemDanfe[];
  /** O que não bateu na conferência (vazio = leitura confiável). */
  problemas: string[];
}

export class DanfeIlegivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "DanfeIlegivel";
  }
}

// -----------------------------------------------------------------------------
// Texto com posição
// -----------------------------------------------------------------------------
export async function trechosDoPdf(bytes: Uint8Array): Promise<Trecho[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const trechos: Trecho[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 30); p++) {
    const pagina = await pdf.getPage(p);
    const conteudo = await pagina.getTextContent();
    for (const it of conteudo.items as { str?: string; transform?: number[]; width?: number }[]) {
      const texto = (it.str ?? "").replace(/\s+/g, " ").trim();
      if (!texto || !it.transform) continue;
      trechos.push({ pagina: p, x: it.transform[4], y: it.transform[5], largura: it.width ?? 0, texto });
    }
  }
  return trechos;
}

interface Palavra {
  texto: string;
  x: number;
  fim: number;
  /** Trecho do PDF de onde veio (palavras do mesmo trecho estão na mesma caixa). */
  trecho: number;
}

interface Linha {
  pagina: number;
  y: number;
  trechos: Trecho[];
  palavras: Palavra[];
  texto: string;
}

/** Agrupa os trechos em linhas (mesma altura) e as linhas em palavras com posição. */
function montarLinhas(trechos: Trecho[]): Linha[] {
  const ordenados = [...trechos].sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  const linhas: Linha[] = [];
  for (const t of ordenados) {
    const atual = linhas.at(-1);
    if (atual && atual.pagina === t.pagina && Math.abs(atual.y - t.y) <= 1.5) atual.trechos.push(t);
    else linhas.push({ pagina: t.pagina, y: t.y, trechos: [t], palavras: [], texto: "" });
  }
  for (const l of linhas) {
    l.trechos.sort((a, b) => a.x - b.x);
    // Trechos colados (o PDF às vezes parte um número em dois) viram uma palavra só
    const pedacos: Trecho[] = [];
    for (const t of l.trechos) {
      const ant = pedacos.at(-1);
      if (ant && t.x - (ant.x + ant.largura) < 0.8 && !/\s$/.test(ant.texto)) {
        pedacos[pedacos.length - 1] = { ...ant, texto: ant.texto + t.texto, largura: t.x + t.largura - ant.x };
      } else pedacos.push(t);
    }
    pedacos.forEach((t, n) => {
      const partes = t.texto.split(" ");
      const porLetra = t.largura / Math.max(t.texto.length, 1);
      let pos = 0;
      for (const p of partes) {
        if (p) l.palavras.push({ texto: p, x: t.x + pos * porLetra, fim: t.x + (pos + p.length) * porLetra, trecho: n });
        pos += p.length + 1;
      }
    });
    l.texto = l.palavras.map((p) => p.texto).join(" ");
  }
  return linhas;
}

// -----------------------------------------------------------------------------
// Peças do cabeçalho
// -----------------------------------------------------------------------------
function acharChave(linhas: Linha[]): string | null {
  const texto = linhas.map((l) => l.texto).join("\n");
  for (const m of texto.matchAll(/(?<![\d])(\d{4}[ .]?){10}\d{4}(?![\d])/g)) {
    const chave = m[0].replace(/\D/g, "");
    if (chave.length === 44 && chaveValida(chave) && chave.slice(20, 22) === "55") return chave;
  }
  // Chave sem espaços no meio de outro texto
  for (const m of texto.replace(/[ .]/g, "").matchAll(/\d{44,}/g)) {
    for (let i = 0; i + 44 <= m[0].length; i++) {
      const chave = m[0].slice(i, i + 44);
      if (chaveValida(chave) && chave.slice(20, 22) === "55") return chave;
    }
  }
  return null;
}

function documentoDoEmitente(chave: string): string {
  const doc = chave.slice(6, 20);
  if (validarCnpj(doc)) return doc;
  if (doc.startsWith("000") && validarCpf(doc.slice(3))) return doc.slice(3);
  return doc;
}

/** Normaliza para comparar rótulos (sem acento, maiúsculo, sem pontuação). */
function rotulo(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const NUMERO_BR = /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/;

/** Número no padrão do DANFE ("1.234,5600") → texto com ponto ("1234.56"). */
function numeroBR(s: string | null | undefined): string | null {
  if (!s || !NUMERO_BR.test(s)) return null;
  const d = lerValorBR(s);
  return d ? d.toString() : null;
}

/**
 * Valor impresso logo abaixo de um rótulo (cada campo do DANFE é uma caixa
 * com o rótulo em cima e o valor embaixo). Procura até a próxima caixa à direita.
 */
function valorAbaixo(linhas: Linha[], padrao: RegExp, filtro: (s: string) => boolean): string | null {
  for (const l of linhas) {
    for (const t of l.trechos) {
      if (!padrao.test(rotulo(t.texto))) continue;
      const direita = l.trechos.filter((o) => o.x > t.x + t.largura + 1).map((o) => o.x);
      const limite = direita.length ? Math.min(...direita) : t.x + t.largura + 120;
      const candidatos = linhas
        .filter((o) => o.pagina === l.pagina && o.y < l.y && l.y - o.y <= 16)
        .flatMap((o) => o.trechos.map((tr) => ({ tr, dist: l.y - o.y })))
        .filter(({ tr }) => tr.x >= t.x - 4 && tr.x < limite - 1 && filtro(tr.texto))
        .sort((a, b) => a.dist - b.dist);
      if (candidatos.length) return candidatos[0].tr.texto;
    }
  }
  return null;
}

function dataISO(s: string | null): string | null {
  const m = s ? /(\d{2})\/(\d{2})\/(\d{4})/.exec(s) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function acharEmitente(linhas: Linha[]): string | null {
  const texto = linhas
    .filter((l) => l.pagina === 1)
    .map((l) => l.texto)
    .join(" ");
  const m = /RECEBEMOS DE\s+(.+?)\s+OS (PRODUTOS|SERVI)/i.exec(texto);
  const nome = m?.[1]?.trim();
  return nome && nome.length >= 2 ? nome.slice(0, 120) : null;
}

// -----------------------------------------------------------------------------
// Quadro dos produtos
// -----------------------------------------------------------------------------
type Coluna = "codigo" | "descricao" | "ncm" | "cst" | "cfop" | "unidade" | "quantidade" | "unitario" | "total" | "desconto" | "outra";

interface Cabecalho {
  pagina: number;
  y: number;
  /** Faixa de cada coluna numérica depois da unidade (os rótulos são centralizados e os números, alinhados à direita). */
  numericas: { coluna: Coluna; de: number; ate: number }[];
  inicioNcm: number;
}

/** Cada coluna do cabeçalho pode ter o rótulo em duas ou três linhas ("VALOR" / "UNIT."). */
function colunasDoCabecalho(linhas: Linha[], i: number): { texto: string; x: number; fim: number }[] {
  const base = linhas[i];
  const faixa = linhas.filter((l) => l === base || (l.pagina === base.pagina && Math.abs(l.y - base.y) <= 9 && !linhaDeItem(l)));
  const trechos = faixa.flatMap((l) => l.trechos).sort((a, b) => a.x - b.x);
  const grupos: { texto: string[]; x: number; fim: number; ys: number[] }[] = [];
  for (const t of trechos) {
    const g = grupos.find((o) => t.x < o.fim - 0.5 && t.x + t.largura > o.x + 0.5);
    if (g) {
      g.texto.push(t.texto);
      g.ys.push(t.y);
      g.x = Math.min(g.x, t.x);
      g.fim = Math.max(g.fim, t.x + t.largura);
    } else grupos.push({ texto: [t.texto], x: t.x, fim: t.x + t.largura, ys: [t.y] });
  }
  return grupos.map((g) => {
    const ordem = g.texto.map((tx, k) => ({ tx, y: g.ys[k] })).sort((a, b) => b.y - a.y);
    return { texto: rotulo(ordem.map((o) => o.tx).join(" ")), x: g.x, fim: g.fim };
  });
}

function tipoDaColuna(t: string): Coluna {
  if (/^NCM/.test(t)) return "ncm";
  if (/CFOP/.test(t)) return "cfop";
  if (/CST|CSOSN/.test(t)) return "cst";
  if (/^(UN|UNID|UNIDADE|UND|UNID COM|UN COM)$/.test(t)) return "unidade";
  if (/^(QUANT|QTD|QTDE|QUANTIDADE)/.test(t)) return "quantidade";
  if (/UNIT/.test(t)) return "unitario";
  if (/DESC/.test(t) && !/DESCRI/.test(t)) return "desconto";
  if (/DESCRI/.test(t)) return "descricao";
  if (/^(COD|CODIGO)/.test(t)) return "codigo";
  if (/^(V|VL|VLR|VALOR) ?(TOTAL|TOT)\b/.test(t) || /^TOTAL$/.test(t) || /LIQ/.test(t)) return "total";
  return "outra";
}

function acharCabecalhos(linhas: Linha[]): Cabecalho[] {
  const cabecalhos: Cabecalho[] = [];
  linhas.forEach((l, i) => {
    const r = rotulo(l.texto);
    if (!/\bNCM\b/.test(r) || !/\bCFOP\b/.test(r)) return;
    if (cabecalhos.some((c) => c.pagina === l.pagina && Math.abs(c.y - l.y) <= 9)) return;
    const colunas = colunasDoCabecalho(linhas, i).map((c) => ({ ...c, coluna: tipoDaColuna(c.texto) }));
    const ncm = colunas.find((c) => c.coluna === "ncm");
    if (!ncm) return;
    const unidade = colunas.find((c) => c.coluna === "unidade");
    const depois = colunas.filter((c) => c.x > (unidade?.fim ?? ncm.fim));
    cabecalhos.push({
      pagina: l.pagina,
      y: l.y,
      numericas: depois.map((c, k) => ({
        coluna: c.coluna,
        de: k === 0 ? -Infinity : (depois[k - 1].fim + c.x) / 2,
        ate: k === depois.length - 1 ? Infinity : (c.fim + depois[k + 1].x) / 2,
      })),
      inicioNcm: ncm.x,
    });
  });
  return cabecalhos;
}

const NCM = /^\d{8}$/;
const CST = /^\d{2,4}$/;
const CFOP = /^[1-7]\d{3}$/;
const UNIDADE = /^(?=.*[A-Za-zÀ-ú])[A-Za-zÀ-ú0-9.\/²³-]{1,6}$/;

interface Bruto {
  pagina: number;
  y: number;
  cab: Cabecalho;
  /** Altura da última linha do item (a descrição pode continuar embaixo). */
  ultimaY: number;
  xDescricao: number | null;
  codigo: string | null;
  descricao: string[];
  ncm: string;
  cst: string;
  cfop: string;
  unidade: string;
  numeros: { texto: string; centro: number }[];
}

/** Linha de item: ... NCM [CST] CFOP UN quantidade unitário total ... (o CST pode vir em branco). */
function linhaDeItem(l: Linha): { inicio: number; bruto: Omit<Bruto, "pagina" | "y" | "cab" | "ultimaY" | "xDescricao" | "codigo" | "descricao"> } | null {
  const p = l.palavras;
  for (let i = 0; i + 5 < p.length; i++) {
    if (!NCM.test(p[i].texto)) continue;
    for (const comCst of [true, false]) {
      const j = i + (comCst ? 2 : 1);
      if (comCst && !CST.test(p[i + 1].texto)) continue;
      if (!CFOP.test(p[j]?.texto ?? "") || !UNIDADE.test(p[j + 1]?.texto ?? "")) continue;
      const numeros = p.slice(j + 2).filter((w) => NUMERO_BR.test(w.texto));
      if (numeros.length < 3 || !NUMERO_BR.test(p[j + 2]?.texto ?? "")) continue;
      return {
        inicio: i,
        bruto: {
          ncm: p[i].texto,
          cst: comCst ? p[i + 1].texto : "",
          cfop: p[j].texto,
          unidade: p[j + 1].texto.toUpperCase(),
          numeros: numeros.map((w) => ({ texto: w.texto, centro: (w.x + w.fim) / 2 })),
        },
      };
    }
  }
  return null;
}

const FIM_DO_QUADRO = /^(CALCULO DO ISSQN|DADOS ADICIONAIS|INFORMACOES COMPLEMENTARES|RESERVADO AO FISCO)/;

function itensDoQuadro(linhas: Linha[], cabecalhos: Cabecalho[]): Bruto[] {
  const brutos: Bruto[] = [];
  let atual: Bruto | null = null;
  let dentro = false;
  let cab: Cabecalho | null = null;
  let pagina = 0;
  for (const l of linhas) {
    if (l.pagina !== pagina) {
      pagina = l.pagina;
      atual = null;
      // Sem o cabeçalho repetido na página seguinte, os itens continuam nas mesmas colunas
      if (cabecalhos.some((c) => c.pagina === pagina)) dentro = false;
    }
    const item = linhaDeItem(l);
    const novoCab = item ? null : cabecalhos.find((c) => c.pagina === l.pagina && Math.abs(c.y - l.y) <= 9);
    if (novoCab) {
      cab = novoCab;
      dentro = true;
      atual = null;
      continue;
    }
    if (!dentro || !cab) continue;
    if (FIM_DO_QUADRO.test(rotulo(l.texto))) {
      dentro = false;
      atual = null;
      continue;
    }
    if (item) {
      const antes = l.palavras.slice(0, item.inicio);
      // O código e a descrição ficam em caixas separadas: o código termina no primeiro
      // espaço entre trechos do PDF; sem essa separação, o código é a primeira palavra.
      let corte = antes.findIndex((w, k) => k > 0 && w.trecho !== antes[k - 1].trecho && w.x - antes[k - 1].fim >= 2);
      if (corte < 0) corte = Math.min(1, antes.length);
      const codigo = antes.slice(0, corte).map((w) => w.texto).join(" ") || null;
      const doTexto = antes.slice(corte);
      atual = {
        pagina: l.pagina,
        y: l.y,
        cab,
        ultimaY: l.y,
        xDescricao: doTexto[0]?.x ?? null,
        codigo,
        descricao: doTexto.length ? [doTexto.map((w) => w.texto).join(" ")] : [],
        ...item.bruto,
      };
      brutos.push(atual);
    } else if (atual && atual.xDescricao !== null && atual.ultimaY - l.y <= 12) {
      // Continuação da descrição: linha logo abaixo, só na coluna da descrição
      const primeira = l.palavras[0];
      const limiteNcm = cab.inicioNcm - 1;
      const naColuna = l.palavras.every((w) => w.fim < limiteNcm);
      if (primeira && naColuna && Math.abs(primeira.x - atual.xDescricao) <= 3) {
        atual.descricao.push(l.texto);
        atual.ultimaY = l.y;
      }
    }
  }
  return brutos;
}

/** Distribui os números da linha nas colunas pelo centro de cada uma (ou pela ordem padrão). */
function numerosDoItem(b: Bruto) {
  const porColuna: Partial<Record<Coluna, string>> = {};
  const numericas = b.cab.numericas;
  if (numericas.some((c) => c.coluna === "quantidade") && numericas.some((c) => c.coluna === "total")) {
    for (const n of b.numeros) {
      const coluna = numericas.find((c) => n.centro >= c.de && n.centro < c.ate)?.coluna;
      if (coluna && !porColuna[coluna]) porColuna[coluna] = n.texto;
    }
  } else {
    [porColuna.quantidade, porColuna.unitario, porColuna.total] = b.numeros.map((n) => n.texto);
  }
  return porColuna;
}

// -----------------------------------------------------------------------------
// Leitura completa
// -----------------------------------------------------------------------------
export function lerDanfeTrechos(trechos: Trecho[], opcoes: { documentoEmpresa: string }): DanfeLido {
  if (trechos.map((t) => t.texto).join("").replace(/\s/g, "").length < 40) {
    throw new DanfeIlegivel(
      "Este PDF não tem texto (é uma imagem ou foto digitalizada). Envie o XML da nota ou o PDF original gerado pelo sistema do fornecedor.",
    );
  }
  const linhas = montarLinhas(trechos);
  const chave = acharChave(linhas);
  if (!chave) {
    throw new DanfeIlegivel("Não encontrei a chave de acesso da NF-e neste PDF. Confira se é o DANFE de uma nota de compra ou envie o XML da nota.");
  }
  const partes = partesChave(chave)!;
  const problemas: string[] = [];

  const empresa = opcoes.documentoEmpresa.replace(/\D/g, "");
  const semChave = linhas
    .map((l) => l.texto)
    .join(" ")
    .replace(/(\d{4}[ .]?){10}\d{4}/g, " ");
  const digitos = semChave.replace(/[^\d]/g, " ");
  const formatos = empresa.length === 14 ? [empresa, empresa.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")] : [empresa, empresa.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")];
  const empresaNoDocumento = Boolean(empresa) && (formatos.some((f) => semChave.includes(f)) || digitos.split(/\s+/).includes(empresa));

  const valorProdutos = numeroBR(valorAbaixo(linhas, /^(V|VL|VALOR) ?(TOTAL|TOT) ?(DOS )?PRODUTOS/, (s) => NUMERO_BR.test(s)));
  const valorTotal = numeroBR(valorAbaixo(linhas, /^(V|VL|VALOR) ?(TOTAL|TOT) ?(DA )?NOTA/, (s) => NUMERO_BR.test(s)));
  let dataEmissao = dataISO(valorAbaixo(linhas, /^DATA (DA |DE )?EMISSAO/, (s) => /\d{2}\/\d{2}\/\d{4}/.test(s)));
  if (!dataEmissao) {
    // Primeira data do mesmo mês/ano da chave
    const aamm = partes.anoMes;
    for (const m of semChave.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) {
      if (m[3].slice(2) === aamm.slice(0, 2) && m[2] === aamm.slice(2)) {
        dataEmissao = `${m[3]}-${m[2]}-${m[1]}`;
        break;
      }
    }
  }

  const cabecalhos = acharCabecalhos(linhas);
  if (!cabecalhos.length) problemas.push("não encontrei o quadro “Dados dos produtos” (com as colunas NCM e CFOP)");
  const brutos = cabecalhos.length ? itensDoQuadro(linhas, cabecalhos) : [];
  const itens: ItemDanfe[] = [];
  brutos.forEach((b, k) => {
    const n = numerosDoItem(b);
    const rotuloItem = `item ${k + 1}`;
    const quantidade = numeroBR(n.quantidade);
    const unitario = numeroBR(n.unitario);
    const total = numeroBR(n.total);
    const desconto = numeroBR(n.desconto);
    const descricao = b.descricao.join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!quantidade || !total) {
      problemas.push(`${rotuloItem}: não consegui ler a quantidade e o valor`);
      return;
    }
    if (new Decimal(quantidade).lte(0)) problemas.push(`${rotuloItem}: quantidade zerada`);
    if (descricao.length < 2) problemas.push(`${rotuloItem}: não consegui ler a descrição`);
    if (unitario) {
      // O DANFE arredonda o valor unitário: tolera meio centavo por unidade
      const diferenca = new Decimal(quantidade).times(unitario).minus(total).abs();
      const tolerancia = Decimal.max(new Decimal("0.02"), new Decimal(quantidade).times("0.0051"));
      if (diferenca.gt(tolerancia)) problemas.push(`${rotuloItem} (${descricao || "sem descrição"}): quantidade × valor unitário não bate com o total`);
    }
    itens.push({
      numero_item: k + 1,
      codigo: b.codigo ? b.codigo.slice(0, 60) : null,
      descricao,
      ncm: b.ncm,
      cfop: b.cfop,
      unidade: b.unidade.slice(0, 6),
      quantidade,
      valor_unitario: unitario,
      valor_total: total,
      valor_desconto: desconto && new Decimal(desconto).gt(0) ? desconto : null,
    });
  });
  if (cabecalhos.length && !itens.length) problemas.push("não encontrei nenhum item no quadro dos produtos");
  if (itens.length) {
    const soma = itens.reduce((s, i) => s.plus(i.valor_total), new Decimal(0));
    if (!valorProdutos) problemas.push("não encontrei o “valor total dos produtos” para conferir a soma dos itens");
    else if (soma.minus(valorProdutos).abs().gt("0.05")) {
      problemas.push(
        `a soma dos itens lidos (R$ ${soma.toFixed(2).replace(".", ",")}) não bate com o total dos produtos da nota (R$ ${new Decimal(valorProdutos).toFixed(2).replace(".", ",")})`,
      );
    }
  }

  return {
    chave,
    serie: partes.serie,
    numero: partes.numero,
    emitente_documento: documentoDoEmitente(chave),
    emitente_nome: acharEmitente(linhas),
    data_emissao: dataEmissao,
    valor_produtos: valorProdutos,
    valor_total: valorTotal,
    empresa_no_documento: empresaNoDocumento,
    itens,
    problemas,
  };
}

export async function lerDanfePdf(bytes: Uint8Array, opcoes: { documentoEmpresa: string }): Promise<DanfeLido> {
  let trechos: Trecho[];
  try {
    trechos = await trechosDoPdf(bytes);
  } catch {
    throw new DanfeIlegivel("Não consegui abrir este PDF. Confira se o arquivo está inteiro (ou protegido por senha) ou envie o XML da nota.");
  }
  return lerDanfeTrechos(trechos, opcoes);
}
