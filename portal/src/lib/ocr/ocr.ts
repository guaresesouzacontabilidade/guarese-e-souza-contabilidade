import "server-only";
import { envServidor } from "@/lib/env-servidor";

/**
 * Leitura de texto de PDFs e imagens.
 *  - PDF com camada de texto: extração direta (alta confiança).
 *  - Imagens (JPG, PNG, WEBP): OCR local com Tesseract (português).
 *  - PDF digitalizado: OCR da primeira página quando o renderizador de PDF
 *    (@napi-rs/canvas) estiver disponível; caso contrário, informa a limitação.
 * Nenhum documento é enviado a serviços externos. Apenas o modelo de idioma
 * do Tesseract é obtido (uma vez) do endereço configurado.
 */
export interface PalavraOcr {
  texto: string;
  confianca: number; // 0–100
}

export interface LeituraDocumento {
  metodo: "texto_pdf" | "ocr" | "indisponivel";
  texto: string | null;
  confiancaMedia: number | null;
  palavras: PalavraOcr[];
  aviso?: string;
}

async function ocrImagem(imagem: Uint8Array): Promise<{ texto: string; confianca: number; palavras: PalavraOcr[] }> {
  const Tesseract = (await import("tesseract.js")).default;
  const worker = await Tesseract.createWorker("por", 1, {
    langPath: envServidor.ocrCaminhoIdiomas(),
    cachePath: "/tmp/tesseract-cache",
  });
  try {
    const { data } = await worker.recognize(Buffer.from(imagem), {}, { text: true, blocks: true });
    const palavras: PalavraOcr[] = [];
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs ?? []) {
        for (const l of p.lines ?? []) {
          for (const w of l.words ?? []) palavras.push({ texto: w.text, confianca: w.confidence });
        }
      }
    }
    return { texto: data.text ?? "", confianca: data.confidence ?? 0, palavras };
  } finally {
    await worker.terminate();
  }
}

export async function extrairTextoDocumento(bytes: Uint8Array, ext: string): Promise<LeituraDocumento> {
  try {
    if (ext === "pdf") {
      const { extractText, getDocumentProxy, renderPageAsImage } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      const texto = (Array.isArray(text) ? text.join("\n") : text).trim();
      if (texto.replace(/\s/g, "").length >= 40) {
        return { metodo: "texto_pdf", texto, confiancaMedia: 100, palavras: [] };
      }
      // PDF digitalizado: tenta renderizar a primeira página para OCR
      try {
        const imagem = await renderPageAsImage(pdf, 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 });
        const r = await ocrImagem(new Uint8Array(imagem));
        return { metodo: "ocr", texto: r.texto, confiancaMedia: r.confianca, palavras: r.palavras, aviso: "Somente a primeira página do PDF digitalizado foi lida." };
      } catch {
        return {
          metodo: "indisponivel",
          texto: null,
          confiancaMedia: null,
          palavras: [],
          aviso: "PDF digitalizado (sem texto). A leitura automática requer o renderizador de PDF (@napi-rs/canvas) no servidor. Confira manualmente.",
        };
      }
    }
    const r = await ocrImagem(bytes);
    return { metodo: "ocr", texto: r.texto, confiancaMedia: r.confianca, palavras: r.palavras };
  } catch (e) {
    return {
      metodo: "indisponivel",
      texto: null,
      confiancaMedia: null,
      palavras: [],
      aviso: `Leitura automática indisponível: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
    };
  }
}
