import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { enviarEmail } from "@/lib/email/enviar";
import { enviarModeloWhatsapp } from "@/lib/whatsapp/cloud-api";
import { envPublico } from "@/lib/env";
import { formatarCompetencia } from "@/lib/formatos";

/** Executa um envio registrado (e-mail ou WhatsApp) e grava o resultado no histórico. */
export async function executarEnvio(admin: ClienteAdmin, job: Job) {
  const envioId = (job.payload as { envio_id?: string })?.envio_id;
  if (!envioId) return { ignorado: "sem envio_id" };
  const { data: envio } = await admin.from("envios").select("*").eq("id", envioId).maybeSingle();
  if (!envio || envio.status === "enviado" || envio.status === "desativado") return { ignorado: true };

  const site = envPublico.siteUrl();
  let resultado: Awaited<ReturnType<typeof enviarEmail>>;

  if (envio.canal === "email") {
    let link: string | null = null;
    if (envio.referencia_tipo === "notificacao" && envio.referencia_id) {
      const { data: n } = await admin.from("notificacoes").select("link").eq("id", envio.referencia_id).maybeSingle();
      link = n?.link ?? null;
    }
    resultado = await enviarEmail(envio.destinatario, envio.assunto ?? "Portal Guarese's ON", {
      titulo: envio.assunto ?? "Portal Guarese's ON",
      paragrafos: [envio.conteudo ?? ""],
      botao: link ? { texto: "Abrir no portal", url: `${site}${link}` } : { texto: "Acessar o portal", url: `${site}/painel` },
    });
  } else {
    const { data: esc } = await admin
      .from("escritorio")
      .select("whatsapp_phone_number_id, whatsapp_template_lembrete, whatsapp_template_idioma, lembretes_whatsapp_ativo")
      .eq("id", 1)
      .single();
    if (!esc?.lembretes_whatsapp_ativo) {
      await admin.from("envios").update({ status: "desativado", erro: "Lembretes por WhatsApp desativados." }).eq("id", envio.id);
      return { status: "desativado" };
    }
    const { data: lembrete } = envio.referencia_tipo === "lembrete" && envio.referencia_id
      ? await admin.from("lembretes").select("competencia, itens, empresa_id").eq("id", envio.referencia_id).maybeSingle()
      : { data: null };
    const { data: emp } = envio.empresa_id
      ? await admin.from("empresas").select("razao_social, nome_fantasia").eq("id", envio.empresa_id).maybeSingle()
      : { data: null };
    resultado = await enviarModeloWhatsapp(
      { phoneNumberId: esc.whatsapp_phone_number_id, modelo: esc.whatsapp_template_lembrete, idioma: esc.whatsapp_template_idioma },
      envio.destinatario,
      [
        emp?.nome_fantasia ?? emp?.razao_social ?? "sua empresa",
        lembrete?.competencia ? formatarCompetencia(lembrete.competencia) : "",
        String(lembrete?.itens?.length ?? ""),
        envio.empresa_id ? `${site}/e/${envio.empresa_id}/pendencias` : `${site}/painel`,
      ],
    );
  }

  if (resultado.enviado) {
    await admin
      .from("envios")
      .update({ status: "enviado", enviado_em: new Date().toISOString(), provedor_id: resultado.id, erro: null, tentativas: envio.tentativas + 1 })
      .eq("id", envio.id);
    return { status: "enviado" };
  }
  if (resultado.motivo === "nao_configurado") {
    await admin
      .from("envios")
      .update({ status: "nao_configurado", erro: "Canal não configurado: nenhuma mensagem foi enviada.", tentativas: envio.tentativas + 1 })
      .eq("id", envio.id);
    return { status: "nao_configurado" };
  }
  await admin.from("envios").update({ status: "falhou", erro: resultado.erro ?? "Falha no envio", tentativas: envio.tentativas + 1 }).eq("id", envio.id);
  throw new Error(resultado.erro ?? "Falha no envio");
}
