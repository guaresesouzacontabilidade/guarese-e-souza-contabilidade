import "server-only";
import https from "node:https";
import { gunzipSync } from "node:zlib";

/** Chave privada e certificados (PEM) da empresa, usados na conexão segura (TLS com certificado do cliente). */
export interface Credencial {
  chave: string;
  certificados: string[];
}

export interface RespostaHttp {
  status: number;
  corpo: string;
  tipo: string;
}

export class ErroConexao extends Error {
  constructor(
    mensagem: string,
    readonly codigo: string,
  ) {
    super(mensagem);
  }
}

const LIMITE_BYTES = 30 * 1024 * 1024;

/**
 * Requisição HTTPS com o certificado da empresa (exigido pela SEFAZ e pelo
 * Ambiente Nacional da NFS-e). A verificação do certificado do servidor é a
 * padrão do Node (nunca desligada); `ca` só é usado nos testes automáticos.
 */
export function requisitar(
  url: string,
  opcoes: { metodo: "GET" | "POST"; credencial: Credencial; corpo?: string; cabecalhos?: Record<string, string>; tempoLimiteMs?: number; ca?: string[] },
): Promise<RespostaHttp> {
  const destino = new URL(url);
  if (destino.protocol !== "https:") return Promise.reject(new ErroConexao("Endereço sem HTTPS.", "url"));
  const corpo = opcoes.corpo === undefined ? undefined : Buffer.from(opcoes.corpo, "utf8");
  return new Promise((resolve, reject) => {
    const req = https.request(
      destino,
      {
        method: opcoes.metodo,
        key: opcoes.credencial.chave,
        cert: opcoes.credencial.certificados.join("\n"),
        ca: opcoes.ca,
        minVersion: "TLSv1.2",
        timeout: opcoes.tempoLimiteMs ?? 30_000,
        headers: {
          "Accept-Encoding": "gzip",
          "User-Agent": "PortalGuaresesON/1.0",
          ...(corpo ? { "Content-Length": String(corpo.length) } : {}),
          ...opcoes.cabecalhos,
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        let total = 0;
        res.on("data", (b: Buffer) => {
          total += b.length;
          if (total > LIMITE_BYTES) {
            req.destroy(new ErroConexao("Resposta grande demais.", "tamanho"));
            return;
          }
          partes.push(b);
        });
        res.on("end", () => {
          try {
            let dados = Buffer.concat(partes);
            if (/gzip/i.test(String(res.headers["content-encoding"] ?? ""))) dados = gunzipSync(dados);
            resolve({ status: res.statusCode ?? 0, corpo: dados.toString("utf8"), tipo: String(res.headers["content-type"] ?? "") });
          } catch {
            reject(new ErroConexao("Resposta compactada inválida.", "resposta"));
          }
        });
        res.on("error", (e) => reject(traduzir(e)));
      },
    );
    req.on("timeout", () => req.destroy(new ErroConexao("O serviço demorou demais para responder.", "tempo")));
    req.on("error", (e) => reject(traduzir(e)));
    if (corpo) req.write(corpo);
    req.end();
  });
}

function traduzir(e: unknown): ErroConexao {
  if (e instanceof ErroConexao) return e;
  const err = e as NodeJS.ErrnoException;
  const codigo = err?.code ?? "rede";
  if (codigo === "ECONNRESET" || /alert|handshake|certificate/i.test(err?.message ?? "")) {
    return new ErroConexao("A conexão foi recusada pelo serviço (o certificado da empresa pode não ter sido aceito).", codigo);
  }
  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") return new ErroConexao("Serviço fora do ar ou sem acesso à internet.", codigo);
  if (codigo === "ETIMEDOUT") return new ErroConexao("O serviço demorou demais para responder.", codigo);
  return new ErroConexao(`Falha de conexão (${codigo}).`, codigo);
}
