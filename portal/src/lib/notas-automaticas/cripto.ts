import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { envServidor } from "@/lib/env-servidor";

/**
 * Cifra do conteúdo do certificado (chave privada e certificados em PEM) com
 * AES-256-GCM e a chave CERTIFICADOS_CHAVE, que existe só no servidor. O banco
 * guarda apenas "v1:" + base64(iv | tag | texto cifrado); sem a chave, o
 * conteúdo não pode ser lido nem alterado (a tag de autenticação acusa).
 */
const VERSAO = "v1";

export class ErroChaveCertificados extends Error {}

function chave(): Buffer {
  const k = envServidor.certificadosChave();
  if (!k) throw new ErroChaveCertificados("A chave de criptografia dos certificados (CERTIFICADOS_CHAVE) não está configurada no servidor.");
  return k;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const corpo = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return `${VERSAO}:${Buffer.concat([iv, c.getAuthTag(), corpo]).toString("base64")}`;
}

export function decifrar(conteudo: string): string {
  const [versao, dados] = conteudo.split(":", 2);
  if (versao !== VERSAO || !dados) throw new ErroChaveCertificados("Formato do certificado guardado não reconhecido.");
  const b = Buffer.from(dados, "base64");
  if (b.length < 29) throw new ErroChaveCertificados("Conteúdo do certificado guardado incompleto.");
  try {
    const d = createDecipheriv("aes-256-gcm", chave(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    throw new ErroChaveCertificados("Não foi possível abrir o certificado guardado (a chave do servidor mudou?). Cadastre o certificado de novo.");
  }
}
