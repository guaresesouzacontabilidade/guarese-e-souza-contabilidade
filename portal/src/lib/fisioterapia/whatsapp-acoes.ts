"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envPublico } from "@/lib/env";
import { cifrar, decifrar, ErroChaveCertificados } from "@/lib/notas-automaticas/cripto";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { enviarModeloWhatsapp } from "@/lib/whatsapp/cloud-api";
import { parametrosConfirmacaoFisio } from "./rotulos";

/**
 * Confirmação do atendimento pelo WhatsApp da clínica: configuração (número
 * oficial da clínica, modelo aprovado, token cifrado, horário, modo teste),
 * envio de teste e envio na hora pela recepção. O banco confere as permissões.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (fd: FormData, nome: string, max = 200) =>
  String(fd.get(nome) ?? "")
    .trim()
    .slice(0, max);

async function contexto(empresaId: string) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.loja || ctx.acesso.gestao_modalidade !== "fisioterapia") throw new Error("A gestão da clínica de fisioterapia não está ligada para esta empresa.");
  return ctx;
}

async function executar<T>(fn: () => Promise<ResultadoAcao<T>>): Promise<ResultadoAcao<T>> {
  try {
    return await fn();
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível concluir a operação.");
  }
}

export async function configurarWhatsappFisio(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId);
    if (!ctx.pode("gestao.gerenciar")) return falha("Só o responsável pela clínica configura o WhatsApp.");
    const token = String(fd.get("whatsapp_token") ?? "").trim();
    if (token && (token.length < 20 || token.length > 1000 || /\s/.test(token))) {
      return falha("Revise os campos destacados.", { whatsapp_token: ["Cole o token de acesso completo (sem espaços)."] });
    }
    const hora = texto(fd, "whatsapp_hora_envio", 5);
    if (hora && !/^\d{2}:\d{2}$/.test(hora)) return falha("Revise os campos destacados.", { whatsapp_hora_envio: ["Horário inválido."] });
    const { error } = await ctx.supabase.rpc("fisio_configurar_whatsapp", {
      p_empresa_id: empresaId,
      p_dados: {
        whatsapp_ativo: fd.get("whatsapp_ativo") === "on",
        whatsapp_phone_number_id: texto(fd, "whatsapp_phone_number_id", 40),
        whatsapp_modelo: texto(fd, "whatsapp_modelo", 512),
        whatsapp_idioma: texto(fd, "whatsapp_idioma", 10) || "pt_BR",
        whatsapp_hora_envio: hora || "07:00",
        whatsapp_modo_teste: fd.get("whatsapp_modo_teste") === "on",
        whatsapp_numero_teste: texto(fd, "whatsapp_numero_teste", 20),
      },
    });
    if (error) return falha(mensagemErro(error));
    const admin = criarClienteAdmin();
    if (fd.get("remover_token") === "on") {
      await admin.from("fisio_whatsapp_segredo").delete().eq("empresa_id", empresaId);
    } else if (token) {
      let cifrado: string;
      try {
        cifrado = cifrar(token);
      } catch (e) {
        if (e instanceof ErroChaveCertificados) return falha("O servidor ainda não tem a chave para guardar tokens (CERTIFICADOS_CHAVE). Peça ao escritório.");
        throw e;
      }
      const { error: e2 } = await admin
        .from("fisio_whatsapp_segredo")
        .upsert({ empresa_id: empresaId, token_cifrado: cifrado, atualizado_por: ctx.sessao.usuarioId, updated_at: new Date().toISOString() });
      if (e2) return falha("Não foi possível guardar o token. Tente novamente.");
    }
    revalidatePath(`/e/${empresaId}/fisioterapia`, "layout");
    return sucesso("Configuração do WhatsApp salva.");
  });
}

/** Manda o modelo de confirmação, com dados de exemplo, para um celular de teste (mensagem real pelo número da clínica). */
export async function testarWhatsappFisio(empresaId: string, telefone: string): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId);
    if (!ctx.pode("gestao.gerenciar")) return falha("Só o responsável pela clínica faz o teste.");
    const numero = String(telefone ?? "").replace(/\D/g, "");
    if (numero.length < 10 || numero.length > 13) return falha("Informe o celular com DDD para o teste.");
    const admin = criarClienteAdmin();
    const [{ data: cfg }, { data: segredo }, { data: emp }] = await Promise.all([
      admin.from("fisio_config").select("whatsapp_phone_number_id, whatsapp_modelo, whatsapp_idioma, nome_clinica").eq("empresa_id", empresaId).maybeSingle(),
      admin.from("fisio_whatsapp_segredo").select("token_cifrado").eq("empresa_id", empresaId).maybeSingle(),
      admin.from("empresas").select("razao_social, nome_fantasia").eq("id", empresaId).maybeSingle(),
    ]);
    let token: string | null = null;
    if (segredo?.token_cifrado) {
      try {
        token = decifrar(segredo.token_cifrado);
      } catch {
        return falha("Não foi possível abrir o token guardado (a chave do servidor mudou?). Cole o token de novo.");
      }
    }
    const clinica = cfg?.nome_clinica || emp?.nome_fantasia || emp?.razao_social || "clínica";
    const r = await enviarModeloWhatsapp(
      { phoneNumberId: cfg?.whatsapp_phone_number_id ?? null, modelo: cfg?.whatsapp_modelo ?? null, idioma: cfg?.whatsapp_idioma ?? "pt_BR", token },
      numero,
      parametrosConfirmacaoFisio({ paciente: "Teste", hora: "14:00", clinica, link: `${envPublico.siteUrl()}/confirmar/teste` }),
    );
    if (r.enviado) return sucesso("Mensagem de teste enviada. Confira no celular.");
    if (r.motivo === "nao_configurado") return falha("O WhatsApp da clínica ainda está desconectado: falta o Phone Number ID, o modelo ou o token.");
    return falha(`A Meta recusou o envio: ${r.erro ?? "erro desconhecido"}.`);
  });
}

/** Recepção: manda agora o link de confirmação deste horário (no modo teste, vai para o número de teste). */
export async function enviarConfirmacaoFisio(empresaId: string, agendaId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(agendaId)) return falha("Agendamento inválido.");
    const ctx = await contexto(empresaId);
    const { data: a } = await ctx.supabase.from("fisio_agenda").select("empresa_id").eq("id", agendaId).maybeSingle();
    if (!a || a.empresa_id !== empresaId) return falha("Agendamento não encontrado.");
    const { error } = await ctx.supabase.rpc("fisio_confirmacao_enviar", { p_agenda_id: agendaId });
    if (error) return falha(mensagemErro(error));
    revalidatePath(`/e/${empresaId}/fisioterapia`, "layout");
    return sucesso("Confirmação na fila do WhatsApp: sai em instantes.");
  });
}
