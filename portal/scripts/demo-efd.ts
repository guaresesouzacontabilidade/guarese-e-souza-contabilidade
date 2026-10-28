/**
 * EFD ICMS/IPI na DEMONSTRAÇÃO (dados fictícios): o que o gerador precisa e
 * que o cadastro de demonstração não tinha — inscrição estadual da Oficina
 * (Lucro Presumido, TO) e o contador fictício do escritório de demonstração
 * (nome, CRC e um CPF de teste). O código de receita do ICMS não é preenchido:
 * a tela pede, como numa empresa real. Só completa o que está vazio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** CPF de teste (dígitos válidos, de uso comum em exemplos): só na demonstração. */
const CPF_CONTADOR_DEMO = "52998224725";

export async function semearEfd(admin: SupabaseClient, oficinaId: string): Promise<boolean> {
  const { data: oficina } = await admin.from("empresas").select("demonstracao, inscricao_estadual").eq("id", oficinaId).single();
  if (!oficina?.demonstracao) throw new Error("A EFD de demonstração só completa empresas de demonstração.");
  let mudou = false;
  if (!oficina.inscricao_estadual) {
    const { error } = await admin.from("empresas").update({ inscricao_estadual: "290000019" }).eq("id", oficinaId);
    if (error) throw new Error(`Falha ao completar a Oficina: ${error.message}`);
    mudou = true;
  }
  const { data: esc } = await admin.from("escritorio").select("contador_nome, contador_crc").eq("id", 1).single();
  if (!esc?.contador_nome || !esc?.contador_crc) {
    const { error } = await admin
      .from("escritorio")
      .update({ contador_nome: esc?.contador_nome || "CONTADORA DE DEMONSTRAÇÃO", contador_crc: esc?.contador_crc || "TO-000000/O-0" })
      .eq("id", 1);
    if (error) throw new Error(`Falha ao completar o contador de demonstração: ${error.message}`);
    mudou = true;
  }
  const { data: contador } = await admin.from("escritorio_contador").select("cpf").eq("id", 1).maybeSingle();
  if (!contador?.cpf) {
    const { error } = await admin.from("escritorio_contador").upsert({ id: 1, cpf: CPF_CONTADOR_DEMO });
    if (error) throw new Error(`Falha ao gravar o CPF do contador de demonstração: ${error.message}`);
    mudou = true;
  }
  return mudou;
}
