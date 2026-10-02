"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { criarClienteServidor } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/requisicao";

const TIPOS: EmailOtpType[] = ["invite", "recovery", "email", "email_change", "signup", "magiclink"];

export async function confirmarLink(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const tipo = String(formData.get("type") ?? "") as EmailOtpType;
  const proximo = destinoSeguro(String(formData.get("next") ?? ""), "/painel");
  if (!tokenHash || !TIPOS.includes(tipo)) redirect("/login?erro=link");
  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
  if (error) redirect("/login?erro=link");
  redirect(proximo);
}
