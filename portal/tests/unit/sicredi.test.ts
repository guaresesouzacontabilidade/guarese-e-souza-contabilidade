import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import forge from "node-forge";
import { consultarCobv, corpoCobv, criarCobv, ErroSicredi, listarPix, registrarWebhook, removerCobv, testarConexao, txidCobv, type ConexaoSicredi } from "@/lib/honorarios/sicredi-api";

/**
 * Servidor falso no papel da API Pix do Sicredi: exige certificado de cliente
 * assinado pela "autoridade" do teste (mTLS), confere o Basic do token e o
 * Bearer das chamadas, e responde no padrão do Banco Central.
 */
function chaves() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { priv: privateKey.export({ type: "pkcs1", format: "pem" }).toString(), pub: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

function certificado(cn: string, pubPem: string, emissor: { cn: string; priv: string } | null, privProprio: string, alt?: string) {
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(pubPem);
  c.serialNumber = String(Math.floor(Math.random() * 1e9));
  c.validity.notBefore = new Date(Date.now() - 60_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: "commonName", value: cn }]);
  c.setIssuer([{ name: "commonName", value: emissor?.cn ?? cn }]);
  const ext: object[] = [{ name: "basicConstraints", cA: !emissor }];
  if (alt) ext.push({ name: "subjectAltName", altNames: [{ type: 7, ip: alt }] });
  c.setExtensions(ext);
  c.sign(forge.pki.privateKeyFromPem(emissor?.priv ?? privProprio), forge.md.sha256.create());
  return forge.pki.certificateToPem(c);
}

let servidor: Server;
let conexao: ConexaoSicredi;
let intruso: ConexaoSicredi;
const cobrancas = new Map<string, Record<string, unknown>>();
let ultimoCorpo: Record<string, unknown> | null = null;

beforeAll(async () => {
  const ca = chaves();
  const caCert = certificado("CA Teste", ca.pub, null, ca.priv);
  const srv = chaves();
  const srvCert = certificado("127.0.0.1", srv.pub, { cn: "CA Teste", priv: ca.priv }, srv.priv, "127.0.0.1");
  const cli = chaves();
  const cliCert = certificado("cliente", cli.pub, { cn: "CA Teste", priv: ca.priv }, cli.priv);
  const outro = chaves();
  const outroCert = certificado("intruso", outro.pub, null, outro.priv);

  servidor = createServer({ key: srv.priv, cert: srvCert, ca: caCert, requestCert: true, rejectUnauthorized: true }, (req, res) => {
    let corpo = "";
    req.on("data", (p) => (corpo += p));
    req.on("end", () => {
      const json = (status: number, o: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(o === undefined ? "" : JSON.stringify(o));
      };
      const url = new URL(req.url ?? "/", "https://x");
      if (url.pathname === "/oauth/token") {
        const ok = req.headers.authorization === `Basic ${Buffer.from("id-teste:segredo-teste").toString("base64")}`;
        if (!ok) return json(401, { error: "invalid_client" });
        if (!new URLSearchParams(corpo).get("scope")?.includes("cobv.write")) return json(400, { error: "invalid_scope" });
        return json(200, { access_token: "tk-1", token_type: "Bearer", expires_in: 300 });
      }
      if (req.headers.authorization !== "Bearer tk-1") return json(401, { title: "Não autorizado" });
      const m = /^\/api\/v2\/cobv\/([A-Za-z0-9]+)$/.exec(url.pathname);
      if (m && req.method === "PUT") {
        ultimoCorpo = JSON.parse(corpo);
        const c = { ...ultimoCorpo, txid: m[1], status: "ATIVA", pixCopiaECola: `00020101021226dinamico${m[1]}`, loc: { location: `pix.sicredi.com.br/qr/v2/cobv/${m[1]}` } };
        cobrancas.set(m[1], c);
        return json(201, c);
      }
      if (m && req.method === "GET") return cobrancas.has(m[1]) ? json(200, cobrancas.get(m[1])) : json(404, { title: "Cobrança não encontrada" });
      if (m && req.method === "PATCH") {
        const c = cobrancas.get(m[1]);
        if (!c) return json(404, { title: "Cobrança não encontrada" });
        c.status = JSON.parse(corpo).status;
        return json(200, c);
      }
      if (url.pathname === "/api/v2/pix" && req.method === "GET") {
        if (!url.searchParams.get("inicio") || !url.searchParams.get("fim")) return json(400, { title: "Parâmetros obrigatórios" });
        return json(200, { parametros: { paginacao: { paginaAtual: 0, quantidadeDePaginas: 1 } }, pix: [{ endToEndId: "E1", txid: "T".repeat(26), valor: "850.00", horario: "2026-11-23T13:00:00Z" }] });
      }
      if (url.pathname.startsWith("/api/v2/webhook/") && req.method === "PUT") return json(204, undefined);
      return json(404, { title: "Rota inexistente" });
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = (servidor.address() as AddressInfo).port;
  conexao = { urlToken: `https://127.0.0.1:${porta}/oauth/token`, urlApi: `https://127.0.0.1:${porta}/api/v2`, clientId: "id-teste", clientSecret: "segredo-teste", certificado: cliCert, chave: cli.priv, ca: caCert };
  intruso = { ...conexao, clientId: "id-intruso", certificado: outroCert, chave: outro.priv };
}, 60_000);

afterAll(() => {
  servidor?.close();
});

describe("API Pix do Sicredi (servidor de teste com mTLS)", () => {
  it("token com o certificado certo e as credenciais certas", async () => {
    await expect(testarConexao(conexao)).resolves.toBeUndefined();
  });

  it("certificado que não é do banco é recusado", async () => {
    await expect(testarConexao(intruso)).rejects.toBeInstanceOf(ErroSicredi);
  });

  it("Client Secret errado é recusado com mensagem clara", async () => {
    await expect(testarConexao({ ...conexao, clientId: "id-teste", clientSecret: "errado" })).rejects.toThrow("Client ID ou Client Secret recusados");
  });

  it("cria a cobrança com vencimento (multa e juros), consulta, remove e lista os Pix", async () => {
    const txid = txidCobv(2026, 7, "abc123def4567");
    expect(txid).toMatch(/^[A-Z0-9]{26,35}$/);
    const criada = await criarCobv(conexao, {
      txid,
      vencimento: "2026-12-10",
      valor: "850",
      devedor: { documento: "11.222.333/0001-81", nome: "PADARIA EXEMPLO" },
      chave: "62935399000150",
      descricao: "Honorários contábeis — outubro/2026",
      multaPercentual: 2,
      jurosMesPercentual: 1,
      cobrarEncargos: true,
    });
    expect(criada.status).toBe("ATIVA");
    expect(criada.pixCopiaECola).toContain(txid);
    expect(ultimoCorpo).toMatchObject({
      calendario: { dataDeVencimento: "2026-12-10" },
      devedor: { cnpj: "11222333000181", nome: "PADARIA EXEMPLO" },
      valor: { original: "850.00", multa: { modalidade: "2", valorPerc: "2.00" }, juros: { modalidade: "3", valorPerc: "1.00" } },
      chave: "62935399000150",
    });
    expect((await consultarCobv(conexao, txid)).status).toBe("ATIVA");
    await removerCobv(conexao, txid);
    expect((await consultarCobv(conexao, txid)).status).toBe("REMOVIDA_PELO_USUARIO_RECEBEDOR");
    const pix = await listarPix(conexao, new Date(Date.now() - 3_600_000), new Date());
    expect(pix[0]).toMatchObject({ endToEndId: "E1", valor: "850.00" });
    await expect(registrarWebhook(conexao, "62935399000150", "https://portal.exemplo/api/pix/sicredi/x")).resolves.toBeUndefined();
  });

  it("CPF vai como cpf e sem encargos não manda multa e juros", () => {
    const c = corpoCobv({ txid: "X".repeat(26), vencimento: "2026-12-10", valor: "100", devedor: { documento: "529.982.247-25", nome: "Fulano" }, chave: "a@b.com", descricao: "IR", multaPercentual: 2, jurosMesPercentual: 1, cobrarEncargos: false });
    expect(c.devedor).toEqual({ cpf: "52998224725", nome: "Fulano" });
    expect(c.valor).toEqual({ original: "100.00" });
  });
});
