import { describe, expect, it } from "vitest";
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import forge from "node-forge";
import { assinarPdf } from "@/lib/assinatura/pdf";
import { POLITICA_AD_RB, type Credencial } from "@/lib/assinatura/cms";
import { filhos, lerNo, oid } from "@/lib/assinatura/der";
import { carregarPdfMake } from "@/lib/relatorios/pdf";

/** Certificado de teste autoassinado (fictício), só para conferir a mecânica da assinatura. */
function credencialDeTeste(): Credencial {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chavePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
  cert.serialNumber = "0a1b2c3d";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nome = [
    { name: "commonName", value: "ESCRITORIO TESTE FICTICIO:62935399000150" },
    { name: "organizationName", value: "ICP-Brasil (teste)" },
    { name: "countryName", value: "BR" },
  ];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(forge.pki.privateKeyFromPem(chavePem), forge.md.sha256.create());
  return { chave: chavePem, certificados: [forge.pki.certificateToPem(cert)] };
}

async function pdfSimples(texto: string): Promise<Buffer> {
  const pm = await carregarPdfMake();
  return pm.createPdf({ content: [{ text: texto }], defaultStyle: { font: "Helvetica" } }).getBuffer();
}

/** Lê o PDF assinado e confere a assinatura como um verificador faria. */
function conferir(pdf: Buffer, credencial: Credencial) {
  const texto = pdf.toString("latin1");
  const m = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(texto);
  expect(m).not.toBeNull();
  const [a, b, c, d] = m!.slice(1).map(Number);
  expect(a).toBe(0);
  expect(c + d).toBe(pdf.length); // cobre o arquivo inteiro, menos a própria assinatura
  const conteudo = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  const hex = texto.slice(b + 1, c - 1).replace(/0+$/, "");
  const cms = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");

  const signedData = filhos(cms, filhos(cms, lerNo(cms, 0))[1])[0];
  const partes = filhos(cms, signedData);
  const signerInfo = filhos(cms, partes[partes.length - 1])[0];
  const [, , , atributos, , assinatura] = filhos(cms, signerInfo);
  expect(atributos.tag).toBe(0xa0);
  // A assinatura vale sobre os atributos com a marca de SET (0x31)
  const assinados = Buffer.concat([Buffer.from([0x31]), cms.subarray(atributos.inicio + 1, atributos.fim)]);
  const chavePublica = createPublicKey(credencial.certificados[0]);
  const valor = cms.subarray(assinatura.conteudo, assinatura.fim);
  return {
    valida: verify("sha256", assinados, chavePublica, valor),
    digestConfere: assinados.includes(createHash("sha256").update(conteudo).digest()),
    temPolitica: assinados.includes(oid(POLITICA_AD_RB.oid)) && assinados.includes(Buffer.from(POLITICA_AD_RB.hashSha256, "hex")),
    temCertificadoV2: assinados.includes(oid("1.2.840.113549.1.9.16.2.47")),
    semHorarioNoCms: !assinados.includes(oid("1.2.840.113549.1.9.5")),
  };
}

describe("assinatura digital de PDF (PAdES, política AD-RB da ICP-Brasil)", () => {
  const credencial = credencialDeTeste();
  const info = { nome: "ESCRITÓRIO TESTE", motivo: "Recibo de honorários", local: "Porto Nacional/TO", contato: "contato@exemplo.com.br", data: new Date("2026-11-17T20:00:00Z") };

  it("assina o arquivo inteiro com os atributos exigidos pela política", async () => {
    const original = await pdfSimples("Recibo de teste");
    const assinado = assinarPdf(original, credencial, info);
    if (process.env.ASSINATURA_AMOSTRA) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${process.env.ASSINATURA_AMOSTRA}.pdf`, assinado);
      writeFileSync(`${process.env.ASSINATURA_AMOSTRA}.pem`, credencial.certificados[0]);
    }
    // Atualização incremental: o original fica intacto (só o cabeçalho passa a PDF 1.7)
    expect(assinado.subarray(0, 8).toString("latin1")).toBe("%PDF-1.7");
    expect(assinado.subarray(8, original.length).equals(original.subarray(8))).toBe(true);
    const r = conferir(assinado, credencial);
    expect(r).toEqual({ valida: true, digestConfere: true, temPolitica: true, temCertificadoV2: true, semHorarioNoCms: true });
    const texto = assinado.toString("latin1");
    expect(texto).toContain("/SubFilter /ETSI.CAdES.detached");
    expect(texto).toContain("/AcroForm << /Fields");
    expect(texto).toContain("/Extensions << /ESIC << /BaseVersion /1.7 /ExtensionLevel 2 >> >>");
    expect(POLITICA_AD_RB.oid).toBe("2.16.76.1.7.1.11.1.3");
    expect(texto).toContain("/M (D:20261117200000Z)");
  });

  it("qualquer alteração depois de assinado invalida a assinatura", async () => {
    const assinado = assinarPdf(await pdfSimples("Valor: R$ 810,00"), credencial, info);
    const adulterado = Buffer.from(assinado);
    const pos = adulterado.indexOf("/Type /Page");
    adulterado.write("/Type /Pagf", pos, "latin1");
    const r = conferir(adulterado, credencial);
    expect(r.valida).toBe(true); // a assinatura em si continua íntegra...
    expect(r.digestConfere).toBe(false); // ...mas o conteúdo não bate mais com o que foi assinado
  });

  it("o PDF assinado continua legível", async () => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const assinado = assinarPdf(await pdfSimples("Recibo legível"), credencial, info);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(assinado)), { mergePages: true });
    expect(text).toContain("Recibo legível");
  });

  it("recusa chave menor que 2048 bits", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const fraca = { ...credencial, chave: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    expect(() => assinarPdf(Buffer.from("%PDF-1.3\n"), fraca, info)).toThrow();
    const pdf = await pdfSimples("x");
    expect(() => assinarPdf(pdf, fraca, info)).toThrow(/2048/);
  });
});
