"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { falha, falhaValidacao, type ResultadoAcao } from "@/lib/acoes";
import { dadosRequisicao } from "@/lib/requisicao";
import { recusaSenha } from "@/lib/auth/erros-senha";

const esquema = z
  .object({
    senha: z
      .string()
      .min(10, "A senha precisa ter pelo menos 10 caracteres.")
      .regex(/[a-z]/, "Inclua ao menos uma letra minúscula.")
      .regex(/[A-Z]/, "Inclua ao menos uma letra maiúscula.")
      .regex(/\d/, "Inclua ao menos um número."),
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ["confirmacao"], message: "As senhas não conferem." });

/** Páginas que usam este formulário (para voltar a elas depois do código do aplicativo). */
const ORIGENS = new Set(["/redefinir-senha", "/definir-senha"]);

/** Define a senha após convite ou recuperação (sessão criada pelo link). */
export async function definirSenha(_anterior: ResultadoAcao, formData: FormData): Promise<ResultadoAcao> {
  const dados = esquema.safeParse({ senha: formData.get("senha"), confirmacao: formData.get("confirmacao") });
  if (!dados.success) return falhaValidacao(dados.error);
  const origem = String(formData.get("origem") ?? "");
  const supabase = await criarClienteServidor();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return falha("O link expirou. Solicite um novo link de acesso.");
  const { error } = await supabase.auth.updateUser({ password: dados.data.senha });
  if (error) {
    const recusa = recusaSenha(error as { code?: string; message?: string; reasons?: string[] });
    // Conta com verificação em duas etapas: o código do aplicativo vem antes da troca de senha
    if (recusa.tipo === "mfa") redirect(`/mfa?proximo=${ORIGENS.has(origem) ? origem : "/redefinir-senha"}`);
    if (recusa.tipo === "mensagem" && recusa.mensagem.startsWith("Não foi possível")) console.error("definirSenha", error.code, error.status);
    return falha(recusa.tipo === "mensagem" ? recusa.mensagem : "Não foi possível salvar a senha.");
  }
  const { ip, userAgent } = await dadosRequisicao();
  await supabase.rpc("registrar_evento", {
    p_acao: "senha_redefinida",
    p_entidade: "perfis",
    p_entidade_id: claims.claims.sub,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  await supabase.rpc("registrar_login", { p_ip: ip ?? undefined, p_user_agent: userAgent ?? undefined });
  redirect("/painel");
}
