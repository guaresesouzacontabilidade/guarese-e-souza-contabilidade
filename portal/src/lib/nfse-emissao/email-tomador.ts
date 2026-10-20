import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import { enviarEmail } from "@/lib/email/enviar";
import { formatarMoeda } from "@/lib/dinheiro";
import { gerarDanfse, URL_CONSULTA_PUBLICA } from "./danfse";

/** Nomes dos municípios que aparecem no DANFSe (do endereço do tomador guardado com o pedido). */
export function municipiosDoPedido(endereco: unknown): Record<string, string> {
  const e = endereco as { codigo_municipio?: string | null; municipio?: string | null; uf?: string | null } | null;
  return e?.codigo_municipio && e.municipio ? { [e.codigo_municipio]: `${e.municipio}${e.uf ? ` / ${e.uf}` : ""}` } : {};
}

/**
 * Manda ao tomador (e-mail informado no pedido) o DANFSe em PDF e o XML da
 * nota autorizada em produção, pelo e-mail do escritório. Sem e-mail
 * configurado no portal, nada é enviado (e não se finge o envio).
 */
export async function enviarParaTomador(admin: ClienteAdmin, emissaoId: string): Promise<boolean> {
  const { data: e } = await admin.from("nfse_emissoes").select("*").eq("id", emissaoId).maybeSingle();
  if (!e || e.ambiente !== "producao" || !e.xml_nfse || !e.chave_acesso || !e.tomador_email) return false;
  const { data: emp } = await admin.from("empresas").select("razao_social, nome_fantasia").eq("id", e.empresa_id).maybeSingle();
  const prestador = emp?.nome_fantasia?.trim() || emp?.razao_social || "Prestador";
  const pdf = await gerarDanfse(e.xml_nfse, { municipios: municipiosDoPedido(e.tomador_endereco) });
  const nome = `NFSe-${e.numero_nfse ?? ""}-${e.chave_acesso}`;
  const r = await enviarEmail(
    e.tomador_email,
    `Nota fiscal de serviço nº ${e.numero_nfse ?? ""} — ${prestador}`,
    {
      titulo: `Nota fiscal de serviço de ${prestador}`,
      paragrafos: [
        `Olá${e.tomador_nome ? `, ${e.tomador_nome}` : ""}.`,
        `Segue a nota fiscal de serviço eletrônica nº ${e.numero_nfse ?? ""}, no valor de ${formatarMoeda(Number(e.valor))}, emitida por ${prestador} no Emissor Nacional da NFS-e. O PDF (DANFSe) e o arquivo XML estão anexados.`,
        `Você pode conferir a nota no portal nacional da NFS-e: ${URL_CONSULTA_PUBLICA}${e.chave_acesso}`,
      ],
      aviso: "Mensagem automática enviada pelo Portal Guarese's ON a pedido do prestador do serviço.",
    },
    [
      { nome: `${nome}.pdf`, conteudo: pdf, tipo: "application/pdf" },
      { nome: `${nome}.xml`, conteudo: Buffer.from(e.xml_nfse, "utf8"), tipo: "application/xml" },
    ],
  );
  return r.enviado;
}
