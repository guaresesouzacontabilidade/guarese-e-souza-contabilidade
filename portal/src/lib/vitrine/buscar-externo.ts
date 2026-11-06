import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Busca na internet só endereços públicos (https), conferindo o endereço de
 * rede antes de cada pedido e de cada redirecionamento: nada de rede interna,
 * localhost ou endereços de metadados. Limita tempo e tamanho da resposta.
 */

function ipPrivado(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
    const v4 = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)?.[1];
    return v4 ? ipPrivado(v4) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function enderecoPublico(url: URL): Promise<boolean> {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return false;
  try {
    const enderecos = await lookup(host, { all: true });
    return enderecos.length > 0 && enderecos.every((e) => !ipPrivado(e.address));
  } catch {
    return false;
  }
}

export class ErroBusca extends Error {}

export async function buscarExterno(endereco: string, opcoes: { maxBytes: number; tempoMs?: number; aceitar?: (url: URL) => boolean }): Promise<{ bytes: Uint8Array; tipo: string; url: URL }> {
  let url = new URL(endereco);
  for (let saltos = 0; saltos < 4; saltos++) {
    if (!(await enderecoPublico(url)) || (opcoes.aceitar && !opcoes.aceitar(url))) throw new ErroBusca("Endereço não permitido.");
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), opcoes.tempoMs ?? 15_000);
    try {
      const r = await fetch(url, { redirect: "manual", signal: controle.signal, headers: { "user-agent": "PortalGuaresesON/1.0 (importacao de catalogo)", accept: "*/*" } });
      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get("location");
        if (!destino) throw new ErroBusca("Redirecionamento sem destino.");
        url = new URL(destino, url);
        continue;
      }
      if (!r.ok) throw new ErroBusca(`O endereço respondeu ${r.status}.`);
      const tamanho = Number(r.headers.get("content-length") ?? 0);
      if (tamanho > opcoes.maxBytes) throw new ErroBusca("Arquivo grande demais.");
      const leitor = r.body?.getReader();
      if (!leitor) throw new ErroBusca("Resposta vazia.");
      const partes: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        total += value.length;
        if (total > opcoes.maxBytes) {
          await leitor.cancel();
          throw new ErroBusca("Arquivo grande demais.");
        }
        partes.push(value);
      }
      const bytes = new Uint8Array(total);
      let pos = 0;
      for (const p of partes) {
        bytes.set(p, pos);
        pos += p.length;
      }
      return { bytes, tipo: r.headers.get("content-type") ?? "", url };
    } catch (e) {
      if (e instanceof ErroBusca) throw e;
      throw new ErroBusca(controle.signal.aborted ? "O endereço demorou demais para responder." : "Não foi possível acessar o endereço.");
    } finally {
      clearTimeout(t);
    }
  }
  throw new ErroBusca("Redirecionamentos demais.");
}

export async function buscarTexto(endereco: string, maxBytes = 3_000_000): Promise<string> {
  const { bytes } = await buscarExterno(endereco, { maxBytes });
  return new TextDecoder("utf-8").decode(bytes);
}
