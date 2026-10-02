import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import webpush from "web-push";
// Biblioteca de cifragem usada pelo próprio web-push (RFC 8188/8291), aqui para conferir a decifragem.
import ece from "http_ece";
import { ENDPOINT_PUSH, montarConteudo } from "@/lib/notificacoes/push";

const aviso = {
  id: "3f0c2a8e-6b1d-4c55-9a77-0d2e4b6c8a10",
  titulo: "Padaria Pão Dourado enviou 3 arquivos",
  corpo: "Último: extrato-setembro.pdf · Extratos bancários · competência 09/2026 · enviado por Maria",
  link: "/e/5b2c/documentos?status=recebido",
  created_at: "2026-10-02T13:00:00.000Z",
};

describe("notificações no aparelho (Web Push)", () => {
  it("monta o conteúdo com título, texto, página do portal e etiqueta do aviso", () => {
    const c = JSON.parse(montarConteudo(aviso));
    expect(c).toEqual({
      titulo: aviso.titulo,
      corpo: aviso.corpo,
      url: aviso.link,
      tag: `aviso-${aviso.id}`,
      quando: Date.parse(aviso.created_at),
    });
  });

  it("nunca envia ao aparelho um endereço fora do portal", () => {
    for (const link of ["https://golpe.example.com/x", "//golpe.example.com", "javascript:alert(1)", null]) {
      expect(JSON.parse(montarConteudo({ ...aviso, link })).url).toBe("/notificacoes");
    }
  });

  it("resume textos longos", () => {
    const c = JSON.parse(montarConteudo({ ...aviso, corpo: "x".repeat(1000) }));
    expect(c.corpo).toHaveLength(240);
    expect(c.corpo.endsWith("…")).toBe(true);
  });

  it("aceita só os serviços de notificação dos navegadores", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QOx",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(ENDPOINT_PUSH.test(ok), ok).toBe(true);
    }
    for (const ruim of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.golpe.com/x",
      "https://golpe.com/fcm.googleapis.com/x",
      "https://localhost/x",
      "https://169.254.169.254/latest",
    ]) {
      expect(ENDPOINT_PUSH.test(ruim), ruim).toBe(false);
    }
  });

  it("cifra o aviso de ponta a ponta: só o aparelho consegue ler", () => {
    const aparelho = createECDH("prime256v1");
    aparelho.generateKeys();
    const segredo = randomBytes(16);
    const vapid = webpush.generateVAPIDKeys();
    const conteudo = montarConteudo(aviso);
    const req = webpush.generateRequestDetails(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/teste",
        keys: { p256dh: aparelho.getPublicKey().toString("base64url"), auth: segredo.toString("base64url") },
      },
      conteudo,
      {
        vapidDetails: { subject: "https://portal.exemplo.com.br", publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: 86400,
        urgency: "high",
        topic: aviso.id.replace(/-/g, ""),
      },
    );
    expect(req.headers.Topic).toBe(aviso.id.replace(/-/g, ""));
    expect(req.headers.Urgency).toBe("high");
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    const corpo = req.body as Buffer;
    expect(corpo.includes(Buffer.from("Padaria"))).toBe(false);
    const aberto = ece.decrypt(corpo, { version: "aes128gcm", privateKey: aparelho, authSecret: segredo.toString("base64url") });
    expect(JSON.parse(aberto.toString("utf8")).titulo).toBe(aviso.titulo);
  });
});
