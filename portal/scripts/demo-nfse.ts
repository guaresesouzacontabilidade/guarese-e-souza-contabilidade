/**
 * Emissão de NFS-e na DEMONSTRAÇÃO (dados fictícios): a Oficina tem a emissão
 * configurada (município, numeração, tributos aproximados) e dois serviços
 * com os códigos da lista nacional, mas a emissão fica DESLIGADA — a
 * demonstração não tem certificado digital e nenhuma nota é enviada ao
 * Emissor Nacional. Serve para mostrar as telas de configuração e de pedido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function semearNfse(admin: SupabaseClient, oficinaId: string): Promise<boolean> {
  const { data: existente } = await admin.from("nfse_emissao_config").select("empresa_id").eq("empresa_id", oficinaId).maybeSingle();
  if (existente) return false;
  const { error } = await admin.from("nfse_emissao_config").insert({
    empresa_id: oficinaId,
    ativa: false,
    ambiente: "homologacao",
    codigo_municipio: "1718204",
    percentual_tributos_federais: 13.45,
    percentual_tributos_municipais: 5,
    enviar_email_tomador: false,
  });
  if (error) throw new Error(`Emissão de NFS-e (demonstração): ${error.message}`);
  const { error: e2 } = await admin.from("nfse_servicos").insert([
    {
      empresa_id: oficinaId,
      nome: "Revisão e manutenção de veículos",
      codigo_tributacao_nacional: "140101",
      descricao_padrao: "Revisão e manutenção do veículo (mão de obra).",
    },
    {
      empresa_id: oficinaId,
      nome: "Funilaria e pintura",
      codigo_tributacao_nacional: "140501",
      descricao_padrao: "Serviço de funilaria e pintura (mão de obra).",
    },
  ]);
  if (e2) throw new Error(`Serviços de NFS-e (demonstração): ${e2.message}`);
  return true;
}
