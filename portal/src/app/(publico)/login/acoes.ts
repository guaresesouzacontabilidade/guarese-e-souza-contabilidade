"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { falha, falhaValidacao, type ResultadoAcao } from "@/lib/acoes";
import { dadosRequisicao, destinoSeguro } from "@/lib/requisicao";
import { COOKIE_PRESENCA, PRESENCA_SEGUNDOS } from "@/lib/auth/presenca";
import { chaveLimite, consumirLimite, limiteEstourado, zerarLimite } from "@/lib/seguranca/limite";

const LIMITE_POR_EMAIL = 10;
const LIMITE_POR_IP = 50;
const JANELA_SEGUNDOS = 15 * 60;

const esquema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  senha: z.string().min(1, "Informe a senha."),
  proximo: z.string().optional(),
});

export async function entrar(_anterior: ResultadoAcao, formData: FormData): Promise<ResultadoAcao> {
  const dados = esquema.safeParse({
    email: formData.get("email"),
    senha: formData.get("senha"),
    proximo: formData.get("proximo") ?? undefined,
  });
  if (!dados.success) return falhaValidacao(dados.error);

  // Senha errada muitas vezes seguidas: espera 15 minutos (por e-mail e por endereço de internet)
  const { ip, userAgent } = await dadosRequisicao();
  const porEmail = chaveLimite("login:email", dados.data.email);
  const porIp = ip ? chaveLimite("login:ip", ip) : null;
  if ((await limiteEstourado(porEmail, LIMITE_POR_EMAIL)) || (porIp && (await limiteEstourado(porIp, LIMITE_POR_IP)))) {
    return falha("Muitas tentativas de entrada. Aguarde 15 minutos e tente de novo, ou use “Esqueci a senha”.");
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: dados.data.email, password: dados.data.senha });
  if (error) {
    if (/banned/i.test(error.message)) return falha("Este acesso está desativado. Fale com o escritório.");
    if (/rate limit|too many/i.test(error.message)) return falha("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    await Promise.all([consumirLimite(porEmail, LIMITE_POR_EMAIL, JANELA_SEGUNDOS), porIp ? consumirLimite(porIp, LIMITE_POR_IP, JANELA_SEGUNDOS) : null]);
    return falha("E-mail ou senha incorretos, ou acesso ainda não ativado pelo convite.");
  }
  await zerarLimite(porEmail);

  // Sinal de "portal aberto" (renovado depois pela própria aba)
  (await cookies()).set(COOKIE_PRESENCA, "1", { maxAge: PRESENCA_SEGUNDOS, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  const destino = destinoSeguro(dados.data.proximo);
  const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (nivel?.nextLevel === "aal2" && nivel.currentLevel !== "aal2") {
    redirect(`/mfa?proximo=${encodeURIComponent(destino)}`);
  }
  await supabase.rpc("registrar_login", { p_ip: ip ?? undefined, p_user_agent: userAgent ?? undefined });
  redirect(destino);
}
