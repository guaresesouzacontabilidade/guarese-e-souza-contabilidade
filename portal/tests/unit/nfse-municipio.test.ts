import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { consultarConvenio, lerConvenio, type ConvenioMunicipio } from "@/lib/nfse-emissao/sefin";
import { avaliarEmissorNacional, type EntradaAvisoMunicipio } from "@/lib/nfse-emissao/municipio";

/**
 * Aviso de Configurar emissão: a empresa pode emitir pelo Emissor Nacional na
 * cidade dela? (convênio da prefeitura no Sistema Nacional NFS-e + recusa
 * E0039 já vista pelo portal). Dados fictícios.
 */

describe("lerConvenio", () => {
  it("lê os campos dentro de um grupo, com 0/1", () => {
    expect(lerConvenio({ parametrosConvenio: { aderenteEmissorNacional: 1, situacaoEmissaoPadraoContribuintesRFB: 0 } })).toEqual({
      emissorNacional: true,
      todasHabilitadas: false,
    });
  });
  it("aceita texto, verdadeiro/falso e maiúsculas diferentes no nome", () => {
    expect(lerConvenio({ AderenteEmissorNacional: "0", situacaoemissaopadraocontribuintesrfb: true })).toEqual({ emissorNacional: false, todasHabilitadas: true });
    expect(lerConvenio({ convenio: { dados: { aderenteEmissorNacional: false } } })).toEqual({ emissorNacional: false, todasHabilitadas: null });
  });
  it("formato desconhecido vira null (o aviso não inventa resposta)", () => {
    expect(lerConvenio({ mensagem: "ok" })).toEqual({ emissorNacional: null, todasHabilitadas: null });
    expect(lerConvenio(null)).toEqual({ emissorNacional: null, todasHabilitadas: null });
    expect(lerConvenio({ aderenteEmissorNacional: 7 })).toEqual({ emissorNacional: null, todasHabilitadas: null });
  });
});

describe("avaliarEmissorNacional", () => {
  const base: EntradaAvisoMunicipio = {
    municipio: "Porto Nacional / TO",
    ambiente: "producao",
    regime: "lucro_real",
    consulta: { tipo: "erro", motivo: "O serviço demorou demais para responder." },
    recusaE0039: null,
    outrasEmpresasEmitindo: 0,
  };
  const ok = (c: ConvenioMunicipio) => ({ tipo: "ok" as const, convenio: c });

  it("MEI emite sempre pelo Emissor Nacional", () => {
    expect(avaliarEmissorNacional({ ...base, regime: "mei", consulta: ok({ emissorNacional: false, todasHabilitadas: false }) })?.tom).toBe("sucesso");
  });

  it("prefeitura com sistema próprio: as notas saem pela prefeitura", () => {
    const a = avaliarEmissorNacional({ ...base, consulta: ok({ emissorNacional: false, todasHabilitadas: null }) })!;
    expect(a.tom).toBe("perigo");
    expect(a.titulo).toBe("A prefeitura de Porto Nacional / TO não usa o Emissor Nacional");
    expect(a.texto.join(" ")).toMatch(/sistema da prefeitura/);
  });

  it("autoriza empresa por empresa e já recusou esta (E0039): pede a autorização no CNC", () => {
    const a = avaliarEmissorNacional({
      ...base,
      consulta: ok({ emissorNacional: true, todasHabilitadas: false }),
      recusaE0039: "2026-11-03T13:20:00Z",
      outrasEmpresasEmitindo: 1,
    })!;
    expect(a.tom).toBe("perigo");
    expect(a.titulo).toBe("A prefeitura ainda não autorizou esta empresa");
    const texto = a.texto.join(" ");
    expect(texto).toMatch(/nota de 03\/11\/2026 \(código E0039\)/);
    expect(texto).toMatch(/Outra empresa de Porto Nacional \/ TO já emite pelo portal/);
    expect(texto).toMatch(/Cadastro Nacional de Contribuintes \(CNC\)/);
  });

  it("autoriza empresa por empresa, sem recusa ainda: alerta antes da primeira nota", () => {
    const a = avaliarEmissorNacional({ ...base, consulta: ok({ emissorNacional: true, todasHabilitadas: false }), outrasEmpresasEmitindo: 3 })!;
    expect(a.tom).toBe("alerta");
    expect(a.texto.join(" ")).toMatch(/Outras 3 empresas de Porto Nacional \/ TO já emitem pelo portal/);
  });

  it("libera todas as empresas: tudo certo", () => {
    const a = avaliarEmissorNacional({ ...base, consulta: ok({ emissorNacional: true, todasHabilitadas: true }) })!;
    expect(a.tom).toBe("sucesso");
    expect(a.titulo).toBe("A prefeitura de Porto Nacional / TO usa o Emissor Nacional");
  });

  it("libera todas, mas recusou esta empresa: bloqueio ou data de início adiante", () => {
    const a = avaliarEmissorNacional({ ...base, consulta: ok({ emissorNacional: true, todasHabilitadas: true }), recusaE0039: "2026-11-03T13:20:00Z" })!;
    expect(a.tom).toBe("perigo");
    expect(a.texto[0]).toMatch(/usa o Emissor Nacional, mas o governo recusou a nota de 03\/11\/2026/);
  });

  it("sem resposta da prefeitura, mas com a recusa E0039 e outras empresas emitindo (o caso do hotel)", () => {
    const a = avaliarEmissorNacional({ ...base, recusaE0039: "2026-11-03T13:20:00Z", outrasEmpresasEmitindo: 1 })!;
    expect(a.tom).toBe("perigo");
    expect(a.titulo).toBe("A prefeitura não liberou esta empresa no Emissor Nacional");
    const texto = a.texto.join(" ");
    expect(texto).toMatch(/autorize empresa por empresa/);
    expect(texto).toMatch(/Não foi possível consultar a prefeitura agora: o serviço demorou demais/);
  });

  it("sem resposta e sem recusa: só informa, sem alarme", () => {
    expect(avaliarEmissorNacional(base)?.tom).toBe("info");
    expect(avaliarEmissorNacional({ ...base, consulta: { tipo: "desligada" } })?.titulo).toBe("Consulta à prefeitura desligada neste ambiente");
    expect(avaliarEmissorNacional({ ...base, consulta: { tipo: "sem_certificado" } })).toBeNull();
    // Resposta sem os campos esperados
    expect(avaliarEmissorNacional({ ...base, consulta: ok({ emissorNacional: null, todasHabilitadas: null }) })?.tom).toBe("info");
  });

  it("cidade desconhecida no Sistema Nacional: confira o município", () => {
    const a = avaliarEmissorNacional({ ...base, consulta: { tipo: "nao_encontrado" } })!;
    expect(a.tom).toBe("alerta");
    expect(a.texto[0]).toMatch(/Confira se o município emissor está certo/);
  });

  it("no ambiente de teste, avisa que a produção pode ser diferente", () => {
    const a = avaliarEmissorNacional({ ...base, ambiente: "homologacao", consulta: ok({ emissorNacional: true, todasHabilitadas: true }) })!;
    expect(a.texto.join(" ")).toMatch(/ambiente de teste do governo/);
  });
});

// ---------------------------------------------------------------------------
// Consulta ao convênio: servidor local no papel da Sefin Nacional (TLS com certificado do cliente)
// ---------------------------------------------------------------------------
function par() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const k = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
  return { pem, k, pub: forge.pki.setRsaPublicKey(k.n, k.e) };
}
function cert(p: ReturnType<typeof par>, cn: string, emissor?: { p: ReturnType<typeof par>; c: forge.pki.Certificate }, dns?: string) {
  const c = forge.pki.createCertificate();
  c.publicKey = p.pub;
  c.serialNumber = "01" + randomBytes(6).toString("hex");
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 200 * 86_400_000);
  const sujeito = [{ name: "commonName", value: cn }];
  c.setSubject(sujeito);
  c.setIssuer(emissor ? emissor.c.subject.attributes : sujeito);
  c.setExtensions([{ name: "basicConstraints", cA: !emissor }, ...(dns ? [{ name: "subjectAltName", altNames: [{ type: 2, value: dns }] }] : [])]);
  c.sign(emissor?.p.k ?? p.k, forge.md.sha256.create());
  return { c, pem: forge.pki.certificateToPem(c) };
}

describe("consultarConvenio", () => {
  const TITULAR = "HOTEL FICTICIO (DEMO):11222333000181";
  const pAc = par();
  const ac = cert(pAc, "AC Teste");
  const pCli = par();
  const cCli = cert(pCli, TITULAR, { p: pAc, c: ac.c });
  const pSrv = par();
  const cSrv = cert(pSrv, "localhost", { p: pAc, c: ac.c }, "localhost");
  const credencial = { chave: pCli.pem, certificados: [cCli.pem] };
  const pedidos: string[] = [];
  let servidor: https.Server;
  let base = "";

  beforeAll(async () => {
    servidor = https.createServer({ key: pSrv.pem, cert: cSrv.pem, ca: [ac.pem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      pedidos.push(`${req.method} ${req.url}`);
      const cn = (req.socket as import("node:tls").TLSSocket).getPeerCertificate().subject?.CN;
      const responder = (status: number, corpo: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(corpo));
      };
      if (cn !== TITULAR) return responder(403, { mensagem: "certificado" });
      if (req.url === "/SefinNacional/parametros_municipais/1718204/convenio") {
        return responder(200, { parametrosConvenio: { tipoConvenio: 1, aderenteEmissorNacional: 1, situacaoEmissaoPadraoContribuintesRFB: 0 } });
      }
      if (req.url === "/SefinNacional/parametros_municipais/3550308/convenio") {
        return responder(200, { parametrosConvenio: { aderenteEmissorNacional: 0, situacaoEmissaoPadraoContribuintesRFB: 1 } });
      }
      if (req.url === "/SefinNacional/parametros_municipais/9999999/convenio") return responder(500, { mensagem: "instabilidade" });
      return responder(404, { erros: [{ Codigo: "E404", Descricao: "Município não encontrado" }] });
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    base = `https://localhost:${(servidor.address() as AddressInfo).port}/SefinNacional`;
  });
  afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

  it("pergunta o convênio com o certificado da empresa e lê a resposta", async () => {
    expect(await consultarConvenio({ base, credencial, ca: [ac.pem] }, "1718204")).toEqual({ emissorNacional: true, todasHabilitadas: false });
    expect(pedidos).toContain("GET /SefinNacional/parametros_municipais/1718204/convenio");
    expect(await consultarConvenio({ base, credencial, ca: [ac.pem] }, "3550308")).toEqual({ emissorNacional: false, todasHabilitadas: true });
  });

  it("cidade desconhecida (HTTP 404) e falhas do serviço", async () => {
    expect(await consultarConvenio({ base, credencial, ca: [ac.pem] }, "1234567")).toBe("nao_encontrado");
    await expect(consultarConvenio({ base, credencial, ca: [ac.pem] }, "9999999")).rejects.toThrow(/HTTP 500/);
    await expect(consultarConvenio({ base, credencial, ca: [ac.pem] }, "17182")).rejects.toThrow(/inválido/);
  });

  it("certificado de outra empresa recusado (HTTP 403)", async () => {
    const pOutro = par();
    const outro = { chave: pOutro.pem, certificados: [cert(pOutro, "OUTRA:99888777000166", { p: pAc, c: ac.c }).pem] };
    await expect(consultarConvenio({ base, credencial: outro, ca: [ac.pem] }, "1718204")).rejects.toThrow(/recusou o certificado/);
  });
});
