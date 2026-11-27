"use server";

import { createClient } from "@supabase/supabase-js";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envPublico } from "@/lib/env";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { chaveLimite, consumirLimite, limiteEstourado, zerarLimite } from "@/lib/seguranca/limite";
import { atualizarTelasDaEmpresa } from "@/lib/atualizar-telas";

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_ERROS = 5;
const JANELA_SEGUNDOS = 10 * 60;

/**
 * Cancela a venda ou o orçamento com a autorização de quem pode cancelar:
 * a pessoa escolhe o próprio nome e digita a senha do login do portal. A senha
 * é conferida pelo provedor de login (sem afetar a sessão de ninguém e sem ser
 * guardada); depois o servidor grava uma autorização de uso único para esta
 * venda e este pedido, e o banco só cancela com ela.
 */
export async function cancelarComAutorizacao(
  empresaId: string,
  vendaId: string,
  motivo: string,
  autorizadorId: string,
  senha: string,
): Promise<ResultadoAcao> {
  try {
    if (!UUID.test(empresaId) || !UUID.test(vendaId)) return falha("Venda inválida.");
    if (motivo.trim().length < 3) return falha("Explique o motivo do cancelamento.");
    if (!UUID.test(autorizadorId)) return falha("Escolha quem autoriza.");
    if (!senha) return falha("Digite a senha de quem autoriza.");
    const ctx = await exigirPermissao(empresaId, "gestao.vender");

    const chave = chaveLimite("cancelar-venda", `${empresaId}:${autorizadorId}`);
    if (await limiteEstourado(chave, MAX_ERROS)) return falha("Muitas tentativas com a senha errada. Espere alguns minutos e tente de novo.");

    // Só quem tem a permissão nesta empresa aparece e pode autorizar
    const { data: autorizadores, error: eLista } = await ctx.supabase.rpc("loja_autorizadores_cancelamento", { p_empresa_id: empresaId });
    if (eLista) return falha(mensagemErro(eLista));
    if (!(autorizadores ?? []).some((a) => a.id === autorizadorId)) return falha("Essa pessoa não pode autorizar cancelamentos nesta empresa.");

    const admin = criarClienteAdmin();
    const { data: usuario } = await admin.auth.admin.getUserById(autorizadorId);
    const email = usuario?.user?.email;
    if (!email) return falha("Não foi possível conferir a senha de quem autoriza.");

    const verificador = createClient(envPublico.supabaseUrl(), envPublico.supabaseChavePublica(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: entrada, error: eSenha } = await verificador.auth.signInWithPassword({ email, password: senha });
    // Encerra só a sessão criada para a conferência (o padrão "global" derrubaria todas as dele)
    if (entrada?.session) await verificador.auth.signOut({ scope: "local" });
    if (eSenha || entrada?.user?.id !== autorizadorId) {
      await consumirLimite(chave, MAX_ERROS, JANELA_SEGUNDOS);
      return falha("Senha incorreta.");
    }
    await zerarLimite(chave);

    const { error: eAut } = await admin.from("venda_cancelamento_autorizacoes").insert({
      empresa_id: empresaId,
      venda_id: vendaId,
      autorizado_por: autorizadorId,
      solicitado_por: ctx.sessao.usuarioId,
    });
    if (eAut) return falha(mensagemErro(eAut));

    const { error } = await ctx.supabase.rpc("gestao_venda_cancelar", { p_venda_id: vendaId, p_motivo: motivo.trim() });
    if (error) return falha(mensagemErro(error));
    atualizarTelasDaEmpresa(empresaId);
    return sucesso("Cancelado com a autorização.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
