import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { enviarModeloWhatsapp } from "@/lib/whatsapp/cloud-api";
import { parametrosConfirmacaoFisio } from "./rotulos";

/**
 * Confirmação do atendimento pelo WhatsApp oficial da clínica (Cloud API da
 * Meta). Vai só o necessário para o modelo aprovado: o primeiro nome do
 * paciente, o horário, o nome da clínica e o link de confirmação — nada do
 * prontuário. No modo teste, vai para o número de teste da clínica.
 */

interface EnvioFisio {
  id: string;
  empresa_id: string | null;
  referencia_id: string | null;
  destinatario: string;
  tentativas: number;
}

async function resultado(admin: ClienteAdmin, envio: EnvioFisio, situacao: "enviado" | "falhou" | "nao_configurado" | "dispensado", erro: string | null, provedor?: string | null) {
  await admin
    .from("envios")
    .update({
      status: situacao === "dispensado" ? "desativado" : situacao,
      erro: situacao === "enviado" ? null : (erro ?? (situacao === "nao_configurado" ? "WhatsApp da clínica não configurado: nenhuma mensagem foi enviada." : null)),
      enviado_em: situacao === "enviado" ? new Date().toISOString() : null,
      provedor_id: provedor ?? null,
      tentativas: envio.tentativas + (situacao === "dispensado" ? 0 : 1),
    })
    .eq("id", envio.id);
  if (envio.referencia_id) await admin.rpc("fisio_confirmacao_resultado", { p_agenda_id: envio.referencia_id, p_situacao: situacao, p_erro: erro ?? "" });
}

const horaLocal = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Araguaina" }).format(new Date(iso));

export async function executarConfirmacaoFisio(admin: ClienteAdmin, envio: EnvioFisio, site: string) {
  if (!envio.referencia_id || !envio.empresa_id) return { ignorado: "envio sem agendamento" };
  const [{ data: a }, { data: cfg }, { data: emp }, { data: segredo }] = await Promise.all([
    admin
      .from("fisio_agenda")
      .select("id, empresa_id, inicio, status, confirmacao_codigo, confirmacao_destino, nome_avulso, telefone_avulso, paciente:fisio_pacientes(nome, nome_social, telefone, aceita_whatsapp, ativo)")
      .eq("id", envio.referencia_id)
      .maybeSingle(),
    admin
      .from("fisio_config")
      .select("whatsapp_ativo, whatsapp_phone_number_id, whatsapp_modelo, whatsapp_idioma, whatsapp_modo_teste, whatsapp_numero_teste, nome_clinica")
      .eq("empresa_id", envio.empresa_id)
      .maybeSingle(),
    admin.from("empresas").select("razao_social, nome_fantasia").eq("id", envio.empresa_id).maybeSingle(),
    admin.from("fisio_whatsapp_segredo").select("token_cifrado").eq("empresa_id", envio.empresa_id).maybeSingle(),
  ]);
  if (!a || a.empresa_id !== envio.empresa_id || !a.confirmacao_codigo) {
    await resultado(admin, envio, "dispensado", "Agendamento não encontrado.");
    return { status: "desativado" };
  }
  // Cancelado, já confirmado pela recepção, remarcado ou já passou da hora
  if (a.status !== "agendado" || new Date(a.inicio).getTime() <= Date.now()) {
    await resultado(admin, envio, "dispensado", a.status !== "agendado" ? `o horário está como "${a.status}"` : "o horário já passou");
    return { status: "desativado" };
  }
  if (!cfg?.whatsapp_ativo) {
    await resultado(admin, envio, "dispensado", "confirmação pelo WhatsApp desligada");
    return { status: "desativado" };
  }
  const paciente = a.paciente as unknown as { nome: string; nome_social: string | null; telefone: string | null; aceita_whatsapp: boolean; ativo: boolean } | null;
  // Confere de novo o destino (o modo teste ou a autorização podem ter mudado)
  const destino = cfg.whatsapp_modo_teste ? cfg.whatsapp_numero_teste : paciente ? (paciente.aceita_whatsapp && paciente.ativo ? paciente.telefone : null) : a.telefone_avulso;
  if (!destino || (cfg.whatsapp_modo_teste ? "teste" : "paciente") !== a.confirmacao_destino || destino.replace(/\D/g, "") !== envio.destinatario.replace(/\D/g, "")) {
    await resultado(admin, envio, "dispensado", "o destino mudou (modo teste, telefone ou autorização do paciente)");
    return { status: "desativado" };
  }
  let token: string | null = null;
  if (segredo?.token_cifrado) {
    try {
      token = decifrar(segredo.token_cifrado);
    } catch {
      token = null;
    }
  }
  const r = await enviarModeloWhatsapp(
    { phoneNumberId: cfg.whatsapp_phone_number_id, modelo: cfg.whatsapp_modelo, idioma: cfg.whatsapp_idioma, token },
    destino,
    parametrosConfirmacaoFisio({
      paciente: paciente?.nome_social || paciente?.nome || a.nome_avulso || "paciente",
      hora: horaLocal(a.inicio),
      clinica: cfg.nome_clinica || emp?.nome_fantasia || emp?.razao_social || "clínica",
      link: `${site}/confirmar/${a.confirmacao_codigo}`,
    }),
  );
  if (r.enviado) {
    await resultado(admin, envio, "enviado", null, r.id);
    return { status: "enviado" };
  }
  if (r.motivo === "nao_configurado") {
    await resultado(admin, envio, "nao_configurado", null);
    return { status: "nao_configurado" };
  }
  await resultado(admin, envio, "falhou", r.erro ?? "Falha no envio");
  throw new Error(r.erro ?? "Falha no envio da confirmação");
}
