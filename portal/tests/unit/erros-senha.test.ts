import { describe, expect, it } from "vitest";
import { recusaSenha } from "@/lib/auth/erros-senha";

describe("recusas do provedor ao definir a senha", () => {
  it("conta com verificação em duas etapas pede o código do aplicativo (não é senha fraca)", () => {
    expect(recusaSenha({ code: "insufficient_aal", message: "AAL2 session is required to update email or password when MFA is enabled." })).toEqual({ tipo: "mfa" });
  });

  it("senha vazada e senha fora das regras têm mensagens diferentes", () => {
    expect(recusaSenha({ code: "weak_password", reasons: ["pwned"] })).toMatchObject({ mensagem: expect.stringContaining("vazadas") });
    expect(recusaSenha({ code: "weak_password", reasons: ["characters"] })).toMatchObject({ mensagem: expect.stringContaining("10 caracteres") });
  });

  it("mesma senha, sessão vencida e erro desconhecido", () => {
    expect(recusaSenha({ code: "same_password" })).toMatchObject({ mensagem: "A nova senha deve ser diferente da anterior." });
    expect(recusaSenha({ code: "session_not_found" })).toMatchObject({ mensagem: expect.stringContaining("expirou") });
    expect(recusaSenha({ code: "outro", message: "password something" })).toMatchObject({ mensagem: "Não foi possível salvar a senha. Tente novamente." });
  });
});
