import { unzipSync } from "fflate";

/**
 * Extração segura de ZIP: limita a quantidade de arquivos, o tamanho total
 * descompactado, o tamanho de cada arquivo e a taxa de compressão (proteção
 * contra "zip bombs"); ignora pastas, arquivos ocultos, caminhos suspeitos e
 * ZIPs aninhados; aceita somente as extensões permitidas.
 */
export interface LimitesZip {
  maxArquivos: number;
  maxTotalBytes: number;
  maxArquivoBytes: number;
  maxRazaoCompressao: number;
  extensoes: string[];
}

export interface ResultadoZip {
  arquivos: { nome: string; caminho: string; bytes: Uint8Array }[];
  ignorados: { caminho: string; motivo: string }[];
}

export class ErroZip extends Error {}

export function extrairZipSeguro(dados: Uint8Array, limites: LimitesZip): ResultadoZip {
  const ignorados: ResultadoZip["ignorados"] = [];
  let quantidade = 0;
  let total = 0;
  const aceitos = new Set<string>();

  let resultado: Record<string, Uint8Array>;
  try {
    resultado = unzipSync(dados, {
      filter: (f) => {
        const caminho = f.name;
        const nome = caminho.split(/[\\/]/).pop() ?? "";
        if (caminho.endsWith("/") || !nome) return false;
        if (caminho.includes("..") || caminho.startsWith("/") || /^[A-Za-z]:/.test(caminho)) {
          ignorados.push({ caminho, motivo: "Caminho suspeito" });
          return false;
        }
        if (nome.startsWith(".") || caminho.startsWith("__MACOSX/") || nome === "Thumbs.db") return false;
        const ext = nome.split(".").pop()?.toLowerCase() ?? "";
        if (ext === "zip" || ext === "rar" || ext === "7z") {
          ignorados.push({ caminho, motivo: "Arquivos compactados dentro do ZIP não são extraídos" });
          return false;
        }
        if (!limites.extensoes.includes(ext)) {
          ignorados.push({ caminho, motivo: `Extensão .${ext} não permitida` });
          return false;
        }
        if (f.originalSize > limites.maxArquivoBytes) {
          ignorados.push({ caminho, motivo: "Arquivo muito grande" });
          return false;
        }
        if (f.size > 0 && f.originalSize / f.size > limites.maxRazaoCompressao && f.originalSize > 1_000_000) {
          throw new ErroZip(`Taxa de compressão suspeita em "${caminho}". O ZIP foi recusado por segurança.`);
        }
        quantidade++;
        total += f.originalSize;
        if (quantidade > limites.maxArquivos) throw new ErroZip(`O ZIP tem mais de ${limites.maxArquivos} arquivos permitidos.`);
        if (total > limites.maxTotalBytes) throw new ErroZip("O conteúdo descompactado do ZIP excede o limite permitido.");
        aceitos.add(caminho);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ErroZip) throw e;
    throw new ErroZip(`ZIP inválido ou corrompido: ${e instanceof Error ? e.message : String(e)}`);
  }

  const arquivos = Object.entries(resultado)
    .filter(([caminho]) => aceitos.has(caminho))
    .map(([caminho, bytes]) => ({ caminho, nome: caminho.split(/[\\/]/).pop() ?? caminho, bytes }));
  return { arquivos, ignorados };
}
