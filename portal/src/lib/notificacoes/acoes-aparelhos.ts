"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";

const UUID = /^[0-9a-f-]{36}$/i;

const esquemaAparelho = z.object({
  endpoint: z.string().trim().max(1000).startsWith("https://", "Endereço de notificação inválido."),
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}={0,2}$/, "Chave do aparelho inválida."),
  auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}={0,2}$/, "Chave do aparelho inválida."),
  descricao: z.string().trim().max(120).optional(),
});

/** Ativa (ou renova) as notificações no aparelho atual para a pessoa logada. */
export async function registrarAparelho(dados: z.input<typeof esquemaAparelho>): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    const d = esquemaAparelho.safeParse(dados);
    if (!d.success) return falhaValidacao(d.error);
    const { error } = await s.supabase.rpc("registrar_aparelho_push", {
      p_endpoint: d.data.endpoint,
      p_p256dh: d.data.p256dh,
      p_auth: d.data.auth,
      p_descricao: d.data.descricao || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidatePath("/conta");
    return sucesso("Avisos ativados neste aparelho.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Desativa um aparelho da própria pessoa (pela lista ou pelo próprio navegador). */
export async function removerAparelho(alvo: { id?: string; endpoint?: string }): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    if (alvo.id && !UUID.test(alvo.id)) return falha("Aparelho inválido.");
    if (!alvo.id && !alvo.endpoint) return falha("Aparelho inválido.");
    const { error } = await s.supabase.rpc("remover_aparelho_push", {
      p_id: alvo.id || undefined,
      p_endpoint: alvo.endpoint?.slice(0, 1000) || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidatePath("/conta");
    return sucesso("Avisos desativados neste aparelho.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Cria um aviso de teste para a própria pessoa e o entrega nos aparelhos ativados. */
export async function enviarAvisoTeste(): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    const { error } = await s.supabase.rpc("enviar_aviso_teste");
    if (error) return falha(mensagemErro(error));
    processarFilaDepois({ tipos: ["enviar_push"] });
    revalidatePath("/", "layout");
    return sucesso("Aviso de teste enviado. Ele deve aparecer em alguns segundos.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
