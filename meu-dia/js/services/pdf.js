// Extrai o texto de um PDF no próprio aparelho (pdf.js), linha por linha.
import { itemsToLines } from '../core/statement.js';

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import('../vendor/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

export class PdfPasswordError extends Error {
  constructor(wrong) {
    super(wrong ? 'Senha incorreta.' : 'Este PDF tem senha.');
    this.wrong = wrong;
  }
}

export async function extractPdfText(file, password) {
  const { getDocument } = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data, password: password || undefined, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new PdfPasswordError(err.code === 2);
    throw new Error('Não foi possível abrir este PDF.');
  }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    pages.push(itemsToLines(items));
  }
  await task.destroy();
  const text = pages.join('\n');
  if (text.replace(/\s/g, '').length < 20) {
    throw new Error('Este PDF parece ser uma imagem (foto ou digitalização), sem texto para ler. Baixe o PDF original no app do banco ou use o arquivo OFX/CSV.');
  }
  return text;
}
