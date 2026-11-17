import "server-only";
import { assinarCms, ErroAssinatura, type Credencial } from "./cms";

/**
 * Assinatura digital de PDF (PAdES) no servidor.
 *
 * Acrescenta ao final do PDF uma atualização incremental com o campo de
 * assinatura (invisível; o texto da assinatura já sai na página) e o
 * dicionário /Sig com o espaço reservado; depois calcula o ByteRange, assina
 * as partes com o certificado (CMS no padrão AD-RB da ICP-Brasil) e grava a
 * assinatura no espaço reservado. Feito para os PDFs gerados pelo próprio
 * portal (pdfmake/pdfkit: tabela xref clássica, sem fluxos de objetos).
 */

const ESPACO_ASSINATURA = 24 * 1024; // bytes reservados para o CMS (o certificado e a cadeia cabem com folga)
const MARCA_BYTE_RANGE = "/ByteRange [0 /********** /********** /**********]";

/** Texto em UTF-16BE (com BOM), para acentos nos campos da assinatura. */
function textoPdf(s: string): string {
  const b = Buffer.from(s, "utf16le");
  for (let i = 0; i < b.length; i += 2) [b[i], b[i + 1]] = [b[i + 1], b[i]];
  return `<FEFF${b.toString("hex").toUpperCase()}>`;
}

function dataPdf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Dicionário do objeto n (conteúdo entre o primeiro "<<" e o ">>" correspondente). */
function dicionarioDoObjeto(pdf: string, n: number): { inicio: number; fim: number; texto: string } {
  const m = new RegExp(`(?:^|[\\r\\n])${n} 0 obj\\s*<<`).exec(pdf);
  if (!m) throw new ErroAssinatura(`Objeto ${n} não encontrado no PDF.`);
  // Pega a última definição do objeto (atualizações incrementais anteriores)
  let ultimo = m;
  const re = new RegExp(`(?:^|[\\r\\n])${n} 0 obj\\s*<<`, "g");
  for (let x = re.exec(pdf); x; x = re.exec(pdf)) ultimo = x;
  const inicio = ultimo.index + ultimo[0].length - 2;
  let nivel = 0;
  for (let i = inicio; i < pdf.length - 1; i++) {
    if (pdf[i] === "<" && pdf[i + 1] === "<") {
      nivel++;
      i++;
    } else if (pdf[i] === ">" && pdf[i + 1] === ">") {
      nivel--;
      i++;
      if (nivel === 0) return { inicio, fim: i + 1, texto: pdf.slice(inicio + 2, i - 1) };
    }
  }
  throw new ErroAssinatura(`Dicionário do objeto ${n} incompleto.`);
}

const referencia = (texto: string, chave: string) => {
  const m = new RegExp(`/${chave}\\s+(\\d+)\\s+0\\s+R`).exec(texto);
  return m ? Number(m[1]) : null;
};

/** Acrescenta o campo de assinatura com o espaço reservado (atualização incremental). */
export function prepararParaAssinatura(original: Buffer, info: { nome: string; motivo: string; local: string; contato: string; data: Date }): Buffer {
  // A assinatura ETSI.CAdES.detached (PAdES) é do PDF 1.7: o cabeçalho passa a
  // dizer 1.7 (mesmo tamanho, antes de assinar) e o catálogo declara a extensão ESIC.
  let pdf = original.toString("latin1");
  if (/^%PDF-1\.[0-6]/.test(pdf)) pdf = `%PDF-1.7${pdf.slice(8)}`;
  const posStartxref = pdf.lastIndexOf("startxref");
  if (posStartxref < 0) throw new ErroAssinatura("PDF sem startxref.");
  const xrefAnterior = Number(/startxref\s+(\d+)/.exec(pdf.slice(posStartxref))?.[1]);
  const posTrailer = pdf.lastIndexOf("trailer", posStartxref);
  if (posTrailer < 0 || !Number.isFinite(xrefAnterior)) throw new ErroAssinatura("Formato de PDF não suportado para assinatura (sem trailer clássico).");
  const trailer = pdf.slice(posTrailer, posStartxref);
  const tamanho = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1]);
  const raiz = referencia(trailer, "Root");
  if (!tamanho || !raiz) throw new ErroAssinatura("Trailer do PDF incompleto.");
  const infoRef = referencia(trailer, "Info");
  const id = /\/ID\s*(\[[^\]]*\])/.exec(trailer)?.[1];

  const catalogo = dicionarioDoObjeto(pdf, raiz);
  if (/\/AcroForm/.test(catalogo.texto)) throw new ErroAssinatura("O PDF já tem formulário; assinatura não suportada.");
  const paginasRef = referencia(catalogo.texto, "Pages");
  if (!paginasRef) throw new ErroAssinatura("PDF sem páginas.");
  const paginas = dicionarioDoObjeto(pdf, paginasRef);
  const primeira = /\/Kids\s*\[\s*(\d+)\s+0\s+R/.exec(paginas.texto)?.[1];
  if (!primeira) throw new ErroAssinatura("PDF sem páginas.");
  const paginaRef = Number(primeira);
  const pagina = dicionarioDoObjeto(pdf, paginaRef);

  const sigRef = tamanho;
  const campoRef = tamanho + 1;
  let paginaNova: string;
  if (/\/Annots\s*\[/.test(pagina.texto)) paginaNova = pagina.texto.replace(/\/Annots\s*\[/, `/Annots [${campoRef} 0 R `);
  else if (/\/Annots/.test(pagina.texto)) throw new ErroAssinatura("Anotações da página em formato não suportado.");
  else paginaNova = `${pagina.texto}\n/Annots [${campoRef} 0 R]`;

  const objetos: { n: number; corpo: string }[] = [
    {
      n: sigRef,
      corpo:
        `<<\n/Type /Sig\n/Filter /Adobe.PPKLite\n/SubFilter /ETSI.CAdES.detached\n${MARCA_BYTE_RANGE}\n` +
        `/Contents <${"0".repeat(ESPACO_ASSINATURA * 2)}>\n` +
        `/Name ${textoPdf(info.nome)}\n/Reason ${textoPdf(info.motivo)}\n/Location ${textoPdf(info.local)}\n/ContactInfo ${textoPdf(info.contato)}\n` +
        `/M (${dataPdf(info.data)})\n>>`,
    },
    {
      n: campoRef,
      corpo: `<<\n/Type /Annot\n/Subtype /Widget\n/FT /Sig\n/T ${textoPdf("Assinatura do escritório")}\n/V ${sigRef} 0 R\n/F 132\n/Rect [0 0 0 0]\n/P ${paginaRef} 0 R\n>>`,
    },
    { n: paginaRef, corpo: `<<${paginaNova}\n>>` },
    {
      n: raiz,
      corpo:
        `<<${catalogo.texto.replace(/\/Version\s*\/[0-9.]+/, "")}\n/Version /1.7\n` +
        (/\/Extensions/.test(catalogo.texto) ? "" : "/Extensions << /ESIC << /BaseVersion /1.7 /ExtensionLevel 2 >> >>\n") +
        `/AcroForm << /Fields [${campoRef} 0 R] /SigFlags 3 >>\n>>`,
    },
  ];

  let saida = pdf.endsWith("\n") ? pdf : `${pdf}\n`;
  const posicoes = new Map<number, number>();
  for (const o of objetos) {
    posicoes.set(o.n, Buffer.byteLength(saida, "latin1"));
    saida += `${o.n} 0 obj\n${o.corpo}\nendobj\n`;
  }
  const posXref = Buffer.byteLength(saida, "latin1");
  // Subseções da xref com números consecutivos
  const numeros = [...posicoes.keys()].sort((a, b) => a - b);
  let xref = "xref\n";
  for (let i = 0; i < numeros.length; ) {
    let j = i;
    while (j + 1 < numeros.length && numeros[j + 1] === numeros[j] + 1) j++;
    xref += `${numeros[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) xref += `${String(posicoes.get(numeros[k])).padStart(10, "0")} 00000 n \n`;
    i = j + 1;
  }
  saida +=
    xref +
    `trailer\n<<\n/Size ${tamanho + 2}\n/Root ${raiz} 0 R\n${infoRef ? `/Info ${infoRef} 0 R\n` : ""}${id ? `/ID ${id}\n` : ""}/Prev ${xrefAnterior}\n>>\n` +
    `startxref\n${posXref}\n%%EOF\n`;
  return Buffer.from(saida, "latin1");
}

/** Calcula o ByteRange, assina e grava a assinatura no espaço reservado. */
export function gravarAssinatura(preparado: Buffer, credencial: Credencial): Buffer {
  const texto = preparado.toString("latin1");
  const posMarca = texto.lastIndexOf(MARCA_BYTE_RANGE);
  const posContents = texto.indexOf("/Contents <", posMarca);
  if (posMarca < 0 || posContents < 0) throw new ErroAssinatura("Espaço da assinatura não encontrado.");
  const inicioHex = posContents + "/Contents ".length; // posição do "<"
  const fimHex = texto.indexOf(">", inicioHex) + 1; // logo depois do ">"
  const faixa = [0, inicioHex, fimHex, preparado.length - fimHex];
  const novaFaixa = `/ByteRange [${faixa.join(" ")}]`.padEnd(MARCA_BYTE_RANGE.length, " ");
  if (novaFaixa.length !== MARCA_BYTE_RANGE.length) throw new ErroAssinatura("PDF grande demais para o espaço do ByteRange.");
  const comFaixa = Buffer.from(texto.slice(0, posMarca) + novaFaixa + texto.slice(posMarca + MARCA_BYTE_RANGE.length), "latin1");

  const cms = assinarCms(Buffer.concat([comFaixa.subarray(0, inicioHex), comFaixa.subarray(fimHex)]), credencial);
  const hex = cms.toString("hex");
  const espaco = fimHex - inicioHex - 2;
  if (hex.length > espaco) throw new ErroAssinatura("A assinatura não coube no espaço reservado.");
  comFaixa.write(hex.padEnd(espaco, "0"), inicioHex + 1, "latin1");
  return comFaixa;
}

export function assinarPdf(pdf: Buffer, credencial: Credencial, info: { nome: string; motivo: string; local: string; contato: string; data: Date }): Buffer {
  return gravarAssinatura(prepararParaAssinatura(pdf, info), credencial);
}

export { ErroAssinatura, type Credencial };
