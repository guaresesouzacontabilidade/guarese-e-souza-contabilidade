import "server-only";
import net from "node:net";
import { envServidor } from "@/lib/env-servidor";

/**
 * Verificação opcional com ClamAV (clamd, protocolo INSTREAM).
 * Sem CLAMAV_HOST configurado retorna "nao_configurado" (nada é simulado).
 */
export type ResultadoAntivirus = { status: "limpo" } | { status: "infectado"; assinatura: string } | { status: "nao_configurado" } | { status: "erro"; erro: string };

export async function verificarAntivirus(bytes: Uint8Array): Promise<ResultadoAntivirus> {
  const cfg = envServidor.clamav();
  if (!cfg) return { status: "nao_configurado" };
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.porta });
    let resposta = "";
    const terminar = (r: ResultadoAntivirus) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(30_000, () => terminar({ status: "erro", erro: "Tempo esgotado na verificação antivírus." }));
    socket.on("error", (e) => terminar({ status: "erro", erro: e.message }));
    socket.on("data", (d) => (resposta += d.toString("utf8")));
    socket.on("end", () => {
      const r = resposta.replace(/\0/g, "").trim();
      if (/OK$/.test(r)) terminar({ status: "limpo" });
      else if (/FOUND$/.test(r)) terminar({ status: "infectado", assinatura: r.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else terminar({ status: "erro", erro: r || "Resposta vazia do antivírus." });
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const bloco = 64 * 1024;
      for (let i = 0; i < bytes.length; i += bloco) {
        const parte = bytes.subarray(i, i + bloco);
        const tamanho = Buffer.alloc(4);
        tamanho.writeUInt32BE(parte.length, 0);
        socket.write(tamanho);
        socket.write(parte);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
  });
}
