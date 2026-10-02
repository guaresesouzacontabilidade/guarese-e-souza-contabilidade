import { z } from "zod";

/** Regras de senha do portal (espelham auth.password_requirements no Supabase). */
export const regraSenha = z
  .string()
  .min(10, "A senha precisa ter pelo menos 10 caracteres.")
  .regex(/[a-z]/, "Inclua ao menos uma letra minúscula.")
  .regex(/[A-Z]/, "Inclua ao menos uma letra maiúscula.")
  .regex(/\d/, "Inclua ao menos um número.");

export const AJUDA_SENHA = "Mínimo de 10 caracteres, com letras maiúsculas, minúsculas e números.";

/** Traduz erros do Supabase Auth ao gravar uma nova senha. */
export function mensagemErroSenha(mensagem: string, padrao = "Não foi possível definir a senha. Tente novamente.") {
  if (/should be different|same/i.test(mensagem)) return "A nova senha deve ser diferente da anterior.";
  if (/reauthenticat|nonce/i.test(mensagem)) return "Por segurança, saia e entre novamente no portal antes de trocar a senha.";
  if (/weak|pwned|password/i.test(mensagem)) return "Senha fraca ou já exposta em vazamentos conhecidos. Escolha outra.";
  return padrao;
}
