/**
 * Mensagem em português para cada recusa do provedor de autenticação ao
 * definir ou trocar a senha (pelo código do erro, não pelo texto em inglês).
 */
export interface ErroSenha {
  code?: string;
  message?: string;
  reasons?: string[];
}

export type RecusaSenha = { tipo: "mfa" } | { tipo: "mensagem"; mensagem: string };

export function recusaSenha(erro: ErroSenha): RecusaSenha {
  const codigo = erro.code ?? "";
  if (codigo === "insufficient_aal") return { tipo: "mfa" };
  if (codigo === "same_password") return { tipo: "mensagem", mensagem: "A nova senha deve ser diferente da anterior." };
  if (codigo === "weak_password") {
    const motivos = erro.reasons ?? [];
    if (motivos.includes("pwned")) {
      return { tipo: "mensagem", mensagem: "Essa senha aparece em listas de senhas vazadas na internet. Escolha outra que você não use em outros sites." };
    }
    return { tipo: "mensagem", mensagem: "A senha precisa ter pelo menos 10 caracteres, com letras maiúsculas, minúsculas e números." };
  }
  if (codigo === "reauthentication_needed") return { tipo: "mensagem", mensagem: "Por segurança, saia e entre novamente antes de trocar a senha." };
  if (codigo === "session_not_found" || codigo === "session_expired") return { tipo: "mensagem", mensagem: "O link expirou. Peça um novo link de redefinição de senha." };
  return { tipo: "mensagem", mensagem: "Não foi possível salvar a senha. Tente novamente." };
}
