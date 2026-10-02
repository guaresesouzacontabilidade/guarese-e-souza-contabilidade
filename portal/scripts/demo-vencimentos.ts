/**
 * Vencimentos de DEMONSTRAÇÃO (dados fictícios): certificados, alvarás,
 * licenças e certidões em situações variadas (vencido, vencendo e em dia).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function dia(deslocamento: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + deslocamento);
  return d.toISOString().slice(0, 10);
}

export async function semearVencimentos(admin: SupabaseClient, ids: { padaria: string; oficina: string }): Promise<boolean> {
  const { count } = await admin.from("vencimentos").select("id", { count: "exact", head: true }).in("empresa_id", [ids.padaria, ids.oficina]);
  if (count) return false;
  const padrao = { numero: null, orgao: null, emissao: null, responsavel: "escritorio", observacao: null };
  const linhas = [
    { empresa_id: ids.padaria, tipo: "certificado_digital", descricao: "Certificado digital A1 (e-CNPJ)", emissao: dia(-353), validade: dia(12), orgao: "Autoridade certificadora (DEMO)" },
    { empresa_id: ids.padaria, tipo: "alvara_funcionamento", descricao: "Alvará de funcionamento", validade: `${new Date().getUTCFullYear()}-12-31`, orgao: "Prefeitura de Porto Nacional", responsavel: "cliente" },
    { empresa_id: ids.padaria, tipo: "licenca_sanitaria", descricao: "Licença da Vigilância Sanitária", validade: dia(25), orgao: "Vigilância Sanitária Municipal", responsavel: "cliente" },
    { empresa_id: ids.padaria, tipo: "cnd_federal", descricao: "CND Federal (Receita e PGFN)", emissao: dia(-183), validade: dia(-3) },
    { empresa_id: ids.padaria, tipo: "crf_fgts", descricao: "CRF do FGTS", emissao: dia(-10), validade: dia(20) },
    { empresa_id: ids.oficina, tipo: "certificado_digital", descricao: "Certificado digital A1 (e-CNPJ)", emissao: dia(-165), validade: dia(200) },
    { empresa_id: ids.oficina, tipo: "licenca_ambiental", descricao: "Licença ambiental de operação", validade: dia(45), orgao: "Naturatins (DEMO)", responsavel: "cliente" },
    { empresa_id: ids.oficina, tipo: "cndt", descricao: "CNDT (Justiça do Trabalho)", emissao: dia(-90), validade: dia(90) },
  ].map((v) => ({ ...padrao, ...v }));
  const { error } = await admin.from("vencimentos").insert(linhas);
  if (error) throw new Error(`Falha ao criar os vencimentos de demonstração: ${error.message}`);
  // Avisos imediatos (a rotina diária faria o mesmo na manhã seguinte)
  await admin.rpc("rotina_vencimentos");
  return true;
}
