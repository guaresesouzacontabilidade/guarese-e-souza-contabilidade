/**
 * Robô de planejamento tributário na DEMONSTRAÇÃO (dados fictícios): a clínica
 * veterinária fictícia recebe a configuração dos cálculos (serviços no Anexo V
 * com Fator R) e a receita e a folha informadas dos últimos meses. Com isso o
 * robô, rodando de verdade sobre esses números fictícios, encontra a
 * oportunidade do Fator R. Só mexe em empresa marcada como demonstração.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function competencia(deslocamentoMeses: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamentoMeses);
  return d.toISOString().slice(0, 8) + "01";
}

const OBS = "Valores fictícios de demonstração.";

export async function semearEstudos(admin: SupabaseClient): Promise<boolean> {
  const { data: clinica } = await admin
    .from("empresas")
    .select("id")
    .eq("demonstracao", true)
    .ilike("razao_social", "CLINICA VETERINARIA AMIGO FIEL%")
    .maybeSingle();
  if (!clinica) return false;
  const empresaId = clinica.id as string;

  // Serviços veterinários: Anexo V com Fator R (vão para o Anexo III com folha de 28% ou mais)
  const { error: eParam } = await admin.from("calculo_parametros").upsert(
    { empresa_id: empresaId, anexo_mercadorias: "I", anexo_servicos: "V", fator_r: true, aliquota_iss: 2, pro_labore: 4500, socios_pro_labore: 1, rat: 1, fap: 1, terceiros: 5.8 },
    { onConflict: "empresa_id", ignoreDuplicates: true },
  );
  if (eParam) throw new Error(`Falha ao configurar os cálculos da clínica de demonstração: ${eParam.message}`);

  // 26 meses: consultas e cirurgias (serviços), pet shop (mercadorias) e a folha com o pró-labore (Fator R ~14%)
  const servicos = [
    48200, 49100, 51800, 50300, 53600, 57900, 49800, 50700, 52900, 54100, 53300, 56800,
    52400, 53900, 55100, 54700, 57800, 62300, 53600, 54900, 57200, 58600, 57100, 60900, 59400, 61800,
  ];
  const petshop = [
    11800, 12100, 12900, 12400, 13300, 15800, 12000, 12300, 12800, 13100, 12900, 14200,
    12600, 13000, 13500, 13200, 14100, 16900, 13100, 13400, 13900, 14300, 13800, 15200, 14600, 15100,
  ];
  const linhas = servicos.map((s, i) => ({
    empresa_id: empresaId,
    competencia: competencia(i - servicos.length),
    receita_servicos: s,
    receita_mercadorias: petshop[i],
    folha_fator_r: 9800 + (i >= 12 ? 400 : 0),
    observacao: OBS,
  }));
  const { error } = await admin.from("calculo_meses").upsert(linhas, { onConflict: "empresa_id,competencia", ignoreDuplicates: true });
  if (error) throw new Error(`Falha ao criar a receita da clínica de demonstração: ${error.message}`);
  return true;
}
