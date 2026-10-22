import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import { enviarEmail } from "@/lib/email/enviar";
import { formatarMoeda } from "@/lib/dinheiro";
import { logoDoCliente } from "@/lib/marca/logos-relatorio";
import { gerarDanfe } from "./danfe";

/**
 * Manda ao comprador (e-mail do cadastro do cliente) o DANFE em PDF e o XML
 * da NF-e autorizada em produção, pelo e-mail do escritório, quando a
 * configuração da empresa pede. Sem e-mail configurado no portal, nada é
 * enviado (e não se finge o envio).
 */
export async function enviarParaDestinatario(admin: ClienteAdmin, emissaoId: string): Promise<boolean> {
  const { data: e } = await admin.from("nfe_emissoes").select("*").eq("id", emissaoId).maybeSingle();
  if (!e || e.ambiente !== "producao" || !e.xml_autorizado || !e.chave) return false;
  const { data: cfg } = await admin.from("nfe_config").select("enviar_email_destinatario").eq("empresa_id", e.empresa_id).maybeSingle();
  if (!cfg?.enviar_email_destinatario) return false;
  const email = ((e.dados as Record<string, unknown>)?.destinatario as { email?: string | null } | undefined)?.email;
  if (!email) return false;
  const { data: emp } = await admin.from("empresas").select("razao_social, nome_fantasia, logo_path").eq("id", e.empresa_id).maybeSingle();
  const emitente = emp?.nome_fantasia?.trim() || emp?.razao_social || "Emitente";
  const logo = await logoDoCliente(admin, emp?.logo_path);
  const pdf = await gerarDanfe(e.xml_autorizado, { logo: logo?.dados ?? null });
  const nome = `NFe-${e.numero}-${e.chave}`;
  const r = await enviarEmail(
    email,
    `Nota fiscal eletrônica nº ${e.numero} — ${emitente}`,
    {
      titulo: `NF-e de ${emitente}`,
      paragrafos: [
        `Olá, ${e.destinatario_nome}.`,
        `Segue a nota fiscal eletrônica nº ${e.numero} (série ${e.serie}), no valor de ${formatarMoeda(Number(e.valor_total))}, emitida por ${emitente}. O PDF (DANFE) e o arquivo XML estão anexados.`,
        `Chave de acesso: ${e.chave}. Você pode conferir a nota no Portal Nacional da NF-e (www.nfe.fazenda.gov.br).`,
      ],
      aviso: "Mensagem automática enviada pelo Portal Guarese's ON a pedido do emitente da nota.",
    },
    [
      { nome: `${nome}.pdf`, conteudo: pdf, tipo: "application/pdf" },
      { nome: `${nome}.xml`, conteudo: Buffer.from(e.xml_autorizado, "utf8"), tipo: "application/xml" },
    ],
  );
  return r.enviado;
}
