import { createHash, createPrivateKey, sign, X509Certificate } from "node:crypto";

/**
 * Texto e assinatura dos documentos fiscais em XML (DPS da NFS-e, NF-e e
 * eventos). O XML é gerado já na forma canônica (C14N inclusiva): sem espaços
 * entre os elementos, namespace declarado no elemento e texto com só &, < e >
 * escapados. Assim o resumo (digest) calculado aqui é o mesmo que o fisco
 * calcula ao conferir a assinatura (RSA-SHA1, padrão nacional dos documentos
 * fiscais eletrônicos).
 */

export const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";

/** Texto em forma canônica: só &, < e > escapados (aspas ficam como estão). */
export function textoXml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TROCAS: [RegExp, string][] = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[‐-―−]/g, "-"],
  [/…/g, "..."],
  [/[•●▪]/g, "-"],
  [/[  -   　]/g, " "],
  [/€/g, "EUR"],
];

/**
 * Texto aceito pelo leiaute: os campos de texto simples só aceitam
 * caracteres de "!" a "ÿ" (Latin-1), com espaços apenas entre palavras e
 * sem quebra de linha. Aspas e travessões "tipográficos" viram os comuns; o
 * que sobrar fora do Latin-1 (emojis, por exemplo) é retirado.
 */
export function textoLeiaute(v: string, max: number, opcoes: { quebras?: boolean } = {}): string {
  let t = v.normalize("NFC").replace(/\r\n?/g, "\n");
  for (const [de, para] of TROCAS) t = t.replace(de, para);
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "").replace(/[^\n\t -ÿ]/g, "");
  if (opcoes.quebras) {
    t = t
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    t = t.replace(/\s+/g, " ").trim();
  }
  return t.slice(0, max).trim();
}

export interface ChavesAssinatura {
  chavePem: string;
  certificadoPem: string;
}

/** Signature (XMLDSig, envelopada) do elemento canônico `canonico` com o Id `id`. */
export function assinatura(canonico: string, id: string, chaves: ChavesAssinatura): string {
  const digest = createHash("sha1").update(canonico, "utf8").digest("base64");
  const signedInfo =
    `<SignedInfo xmlns="${NS_DSIG}">` +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>' +
    `<Reference URI="#${id}"><Transforms>` +
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>' +
    '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform>' +
    "</Transforms>" +
    '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>' +
    `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const valor = sign("sha1", Buffer.from(signedInfo, "utf8"), createPrivateKey(chaves.chavePem)).toString("base64");
  const certificado = new X509Certificate(chaves.certificadoPem).raw.toString("base64");
  return (
    `<Signature xmlns="${NS_DSIG}">${signedInfo.replace(` xmlns="${NS_DSIG}"`, "")}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificado}</X509Certificate></X509Data></KeyInfo></Signature>`
  );
}
