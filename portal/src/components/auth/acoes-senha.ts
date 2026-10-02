"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { falha, falhaValidacao, type ResultadoAcao } from "@/lib/acoes";
import { dadosRequisicao } from "@/lib/requisicao";
import { mensagemErroSenha, regraSenha } from "@/lib/auth/senha";

const esquema = z
  .object({
    senha: regraSenha,
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ["confirmacao"], message: "As senhas não conferem." });

/** Define a senha após convite ou recuperação (sessão criada pelo link). */
export async function definirSenha(_anterior: ResultadoAcao, formData: FormData): Promise<ResultadoAcao> {
  const dados = esquema.safeParse({ senha: formData.get("senha"), confirmacao: formData.get("confirmacao") });
  if (!dados.success) return falhaValidacao(dados.error);
  const supabase = await criarClienteServidor();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return falha("O link expirou. Solicite um novo link de acesso.");
  const { error } = await supabase.auth.updateUser({ password: dados.data.senha });
  if (error) return falha(mensagemErroSenha(error.message));
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
