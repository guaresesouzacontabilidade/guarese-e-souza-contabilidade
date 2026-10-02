import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { enviarEmail } from "@/lib/email/enviar";
import { enviarModeloWhatsapp } from "@/lib/whatsapp/cloud-api";
import { envPublico } from "@/lib/env";
import { formatarCompetencia } from "@/lib/formatos";

/** Avisos do escritório ao cliente que também podem ir por WhatsApp (iguais aos do banco). */
const TIPOS_AVISO_WHATSAPP = [
  "documento_escritorio",
  "relatorio_publicado",
  "mensagem",
  "item_solicitado",
  "item_correcao",
  "documento_correcao",
  "pendencia_fechamento",
];

type Envio = NonNullable<Awaited<ReturnType<typeof buscarEnvio>>>;

async function buscarEnvio(admin: ClienteAdmin, id: string) {
  const { data } = await admin.from("envios").select("*").eq("id", id).maybeSingle();
  return data;
}

/** O WhatsApp aceita parâmetros sem quebras de linha e sem muitos espaços seguidos. */
function parametroWhatsapp(texto: string) {
  return texto.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 900);
}

/**
 * Parâmetros do modelo de aviso: {{1}} empresa, {{2}} o aviso (ou o resumo de
 * vários) e {{3}} o link. Só entram avisos ainda não vistos no portal.
 */
export function montarAvisoWhatsapp(avisos: { titulo: string; link: string | null; empresa: string | null }[], site: string) {
  if (!avisos.length) return null;
  const empresas = [...new Set(avisos.map((a) => a.empresa).filter((e): e is string => Boolean(e)))];
  const [maisRecente] = avisos;
  const texto = avisos.length === 1 ? maisRecente.titulo : `${avisos.length} novidades. A mais recente: ${maisRecente.titulo}`;
  const caminho = avisos.length === 1 && maisRecente.link?.startsWith("/") ? maisRecente.link : "/notificacoes";
  return [parametroWhatsapp(empresas.length === 1 ? empresas[0] : "sua empresa"), parametroWhatsapp(texto), `${site}${caminho}`];
}

async function prepararAvisoWhatsapp(admin: ClienteAdmin, envio: Envio, site: string) {
  const { data: esc } = await admin
    .from("escritorio")
    .select("avisos_whatsapp_ativo, whatsapp_phone_number_id, whatsapp_template_aviso, whatsapp_template_idioma")
    .eq("id", 1)
    .single();
  if (!esc?.avisos_whatsapp_ativo) return { dispensado: "Avisos por WhatsApp desativados pelo escritório." };
  if (!envio.user_id) return { dispensado: "Envio sem destinatário." };
  const { data: perfil } = await admin.from("perfis").select("ativo, telefone, preferencias").eq("id", envio.user_id).maybeSingle();
  const preferencias = (perfil?.preferencias ?? {}) as Record<string, unknown>;
  if (!perfil?.ativo || preferencias.whatsapp_avisos !== true || (perfil.telefone ?? "").replace(/\D/g, "") !== envio.destinatario) {
    return { dispensado: "O cliente não autoriza mais avisos por WhatsApp neste número." };
  }
  const desde = new Date(Date.parse(envio.created_at) - 5_000).toISOString();
  const { data: avisos } = await admin
    .from("notificacoes")
    .select("titulo, link, empresa:empresas(razao_social, nome_fantasia)")
    .eq("user_id", envio.user_id)
    .is("lida_em", null)
    .in("tipo", TIPOS_AVISO_WHATSAPP)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(50);
  const parametros = montarAvisoWhatsapp(
    (avisos ?? []).map((a) => {
      const e = a.empresa as unknown as { razao_social: string; nome_fantasia: string | null } | null;
      return { titulo: a.titulo, link: a.link, empresa: e ? (e.nome_fantasia ?? e.razao_social) : null };
    }),
    site,
  );
  if (!parametros) return { dispensado: "Os avisos já foram vistos no portal; WhatsApp dispensado." };
  return {
    cfg: { phoneNumberId: esc.whatsapp_phone_number_id, modelo: esc.whatsapp_template_aviso, idioma: esc.whatsapp_template_idioma },
    parametros,
  };
}

async function dispensar(admin: ClienteAdmin, envioId: string, motivo: string) {
  await admin.from("envios").update({ status: "desativado", erro: motivo }).eq("id", envioId);
  return { status: "desativado", motivo };
}

/** Executa um envio registrado (e-mail ou WhatsApp) e grava o resultado no histórico. */
export async function executarEnvio(admin: ClienteAdmin, job: Job) {
  const envioId = (job.payload as { envio_id?: string })?.envio_id;
  if (!envioId) return { ignorado: "sem envio_id" };
  const envio = await buscarEnvio(admin, envioId);
  if (!envio || envio.status === "enviado" || envio.status === "desativado") return { ignorado: true };

  const site = envPublico.siteUrl();
  let resultado: Awaited<ReturnType<typeof enviarEmail>>;

  if (envio.canal === "email") {
    let link: string | null = null;
    if (envio.referencia_tipo === "notificacao" && envio.referencia_id) {
      const { data: n } = await admin.from("notificacoes").select("link, tipo, lida_em").eq("id", envio.referencia_id).maybeSingle();
      // Mensagem já lida no portal (ex.: bate-papo ao vivo): o e-mail não é mais necessário.
      if (n?.tipo === "mensagem" && n.lida_em) return dispensar(admin, envio.id, "Mensagem já lida no portal; e-mail dispensado.");
      link = n?.link ?? null;
    }
    resultado = await enviarEmail(envio.destinatario, envio.assunto ?? "Portal Guarese's ON", {
      titulo: envio.assunto ?? "Portal Guarese's ON",
      paragrafos: [envio.conteudo ?? ""],
      botao: link ? { texto: "Abrir no portal", url: `${site}${link}` } : { texto: "Acessar o portal", url: `${site}/painel` },
    });
  } else if (envio.tipo === "aviso") {
    const aviso = await prepararAvisoWhatsapp(admin, envio, site);
    if ("dispensado" in aviso) return dispensar(admin, envio.id, aviso.dispensado ?? "Dispensado.");
    resultado = await enviarModeloWhatsapp(aviso.cfg, envio.destinatario, aviso.parametros);
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
