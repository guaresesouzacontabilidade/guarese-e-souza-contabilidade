/**
 * Codificação e leitura mínimas de DER (ASN.1), só o necessário para montar a
 * assinatura CMS: os certificados entram byte a byte, sem decodificar e
 * recodificar (assim nada muda no que a autoridade certificadora assinou).
 */

function tamanho(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, ...partes: Buffer[]): Buffer {
  const conteudo = Buffer.concat(partes);
  return Buffer.concat([Buffer.from([tag]), tamanho(conteudo.length), conteudo]);
}

export const seq = (...partes: Buffer[]) => tlv(0x30, ...partes);
/** SET OF em DER: os elementos vão em ordem crescente da codificação. */
export const conjunto = (...partes: Buffer[]) => tlv(0x31, ...[...partes].sort(Buffer.compare));
/** [n] construído (explícito, ou implícito sobre SEQUENCE/SET). */
export const contexto = (n: number, ...partes: Buffer[]) => tlv(0xa0 | n, ...partes);
export const octetos = (b: Buffer) => tlv(0x04, b);
export const nulo = () => Buffer.from([0x05, 0x00]);
export const inteiro = (n: number) => tlv(0x02, Buffer.from([n]));
export const ia5 = (s: string) => tlv(0x16, Buffer.from(s, "ascii"));

export function oid(texto: string): Buffer {
  const arcos = texto.split(".").map(Number);
  const bytes = [40 * arcos[0] + arcos[1]];
  for (const arco of arcos.slice(2)) {
    const parte = [arco & 0x7f];
    for (let v = Math.floor(arco / 128); v > 0; v = Math.floor(v / 128)) parte.unshift((v & 0x7f) | 0x80);
    bytes.push(...parte);
  }
  return tlv(0x06, Buffer.from(bytes));
}

export interface NoDer {
  tag: number;
  inicio: number;
  conteudo: number;
  fim: number;
}

export function lerNo(buf: Buffer, pos: number): NoDer {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER com tamanho indefinido ou grande demais.");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i];
    p += n;
  }
  if (p + len > buf.length) throw new Error("DER truncado.");
  return { tag, inicio: pos, conteudo: p, fim: p + len };
}

export function filhos(buf: Buffer, no: NoDer): NoDer[] {
  const lista: NoDer[] = [];
  for (let p = no.conteudo; p < no.fim; ) {
    const f = lerNo(buf, p);
    lista.push(f);
    p = f.fim;
  }
  return lista;
}

export const bytesDo = (buf: Buffer, no: NoDer) => buf.subarray(no.inicio, no.fim);

/** Emissor (Name) e número de série do certificado, como estão no DER. */
export function emissorESerie(certificado: Buffer): { emissor: Buffer; serie: Buffer } {
  const tbs = filhos(certificado, lerNo(certificado, 0))[0];
  const campos = filhos(certificado, tbs);
  const i = campos[0].tag === 0xa0 ? 1 : 0; // [0] versão
  return { serie: bytesDo(certificado, campos[i]), emissor: bytesDo(certificado, campos[i + 2]) };
}

/** PEM → DER. */
export function pemParaDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
}
