"use server";

import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { emailConfigurado, enviarEmail } from "@/lib/email/enviar";
import { envPublico } from "@/lib/env";
import { falhaValidacao, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { dadosRequisicao } from "@/lib/requisicao";
import { chaveLimite, consumirLimite } from "@/lib/seguranca/limite";

const esquema = z.object({ email: z.string().trim().toLowerCase().email("Informe um e-mail válido.") });

const MENSAGEM =
  "Se o e-mail estiver cadastrado, você receberá em instantes um link para criar uma nova senha. Verifique também a caixa de spam.";

export async function solicitarRecuperacao(_anterior: ResultadoAcao, formData: FormData): Promise<ResultadoAcao> {
  const dados = esquema.safeParse({ email: formData.get("email") });
  if (!dados.success) return falhaValidacao(dados.error);
  const email = dados.data.email;
  const site = envPublico.siteUrl();

  // Contra robôs que disparam e-mails para alguém: até 3 por e-mail e 10 por
  // endereço de internet a cada hora. A resposta é sempre a mesma.
  const { ip } = await dadosRequisicao();
  const [porEmail, porIp] = await Promise.all([
    consumirLimite(chaveLimite("recuperar:email", email), 3, 3600),
    ip ? consumirLimite(chaveLimite("recuperar:ip", ip), 10, 3600) : true,
  ]);
  if (!porEmail || !porIp) return sucesso(MENSAGEM);

  try {
    if (emailConfigurado()) {
      // Link gerado pelo Supabase Auth e enviado pelo SMTP do escritório (modelo em português).
      const admin = criarClienteAdmin();
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
      if (!error && data?.properties?.hashed_token) {
        const url = `${site}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/redefinir-senha`;
        await enviarEmail(email, "Redefinição de senha — Catarinense Tech", {
          titulo: "Redefinição de senha",
          paragrafos: ["Recebemos um pedido para redefinir a senha do seu acesso ao Catarinense Tech."],
          botao: { texto: "Criar nova senha", url },
          aviso: "Se você não pediu a redefinição, ignore esta mensagem: sua senha continua a mesma. O link só pode ser usado uma vez.",
        });
      }
    } else {
      // Sem SMTP próprio: usa o envio de e-mails do Supabase Auth (modelos configurados no projeto).
      const supabase = await criarClienteServidor();
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${site}/auth/callback?next=/redefinir-senha` });
    }
  } catch {
    // Resposta sempre genérica: não revela se o e-mail existe.
  }
  return sucesso(MENSAGEM);
}
