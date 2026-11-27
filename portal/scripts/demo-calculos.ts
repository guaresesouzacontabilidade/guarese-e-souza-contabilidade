/**
 * Cálculos de DEMONSTRAÇÃO (dados fictícios): parâmetros de cada empresa,
 * receita informada dos últimos meses (para a receita de 12 meses do Simples
 * e o trimestre do Lucro Presumido) e colaboradores fictícios.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function competencia(deslocamentoMeses: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamentoMeses);
  return d.toISOString().slice(0, 8) + "01";
}

function data(deslocamentoMeses: number, dia: number) {
  return competencia(deslocamentoMeses).slice(0, 8) + String(dia).padStart(2, "0");
}

const OBS = "Valores fictícios de demonstração.";

export async function semearCalculos(admin: SupabaseClient, ids: { padaria: string; oficina: string }): Promise<boolean> {
  // Parâmetros e receita não sobrescrevem o que já existe (o seed pode rodar de novo)
  // Padaria: Simples Nacional, vendas no Anexo I, um sócio com pró-labore.
  // Oficina: Lucro Presumido, serviços (32%) e venda de peças (8%), ISS de 3%.
  const { error: eParam } = await admin.from("calculo_parametros").upsert(
    [
      { empresa_id: ids.padaria, anexo_mercadorias: "I", anexo_servicos: "III", aliquota_iss: null, pro_labore: 3000, socios_pro_labore: 1, rat: 2, fap: 1, terceiros: 5.8 },
      { empresa_id: ids.oficina, anexo_mercadorias: "I", anexo_servicos: "III", aliquota_iss: 3, pro_labore: 6000, socios_pro_labore: 2, rat: 3, fap: 1, terceiros: 5.8 },
    ],
    { onConflict: "empresa_id", ignoreDuplicates: true },
  );
  if (eParam) throw new Error(`Falha ao configurar os cálculos de demonstração: ${eParam.message}`);

  // Receita informada dos 26 meses anteriores (o último é o mês cujos impostos vencem agora;
  // o mês atual fica com as notas fiscais enviadas). O comparativo de regimes usa 24 meses:
  // os 12 do período e os 12 anteriores, para a alíquota do Simples de cada mês.
  const padaria = [
    38900, 39600, 41200, 42500, 46800, 55900, 39100, 37800, 40600, 42100, 41800, 43200,
    43600, 44800, 46100, 47900, 52300, 61800, 43900, 41200, 45600, 47300, 46900, 48800, 51200, 53400,
  ];
  const oficinaServicos = [
    31800, 32500, 34900, 36800, 35600, 40100, 31200, 33600, 35900, 38200, 35700, 38800,
    35400, 36200, 38900, 41500, 39800, 44700, 35100, 37600, 40200, 42800, 39900, 43400, 41100, 46800,
  ];
  const oficinaPecas = [
    10600, 10900, 12000, 14100, 12700, 15100, 10500, 11300, 12400, 13100, 11900, 13600,
    11900, 12100, 13400, 15800, 14200, 16900, 11800, 12600, 13900, 14700, 13300, 15200, 14100, 15600,
  ];
  const linhas = [];
  for (let i = 0; i < padaria.length; i++) {
    const comp = competencia(i - padaria.length);
    linhas.push({ empresa_id: ids.padaria, competencia: comp, receita_mercadorias: padaria[i], receita_servicos: 0, observacao: OBS });
    linhas.push({ empresa_id: ids.oficina, competencia: comp, receita_mercadorias: oficinaPecas[i], receita_servicos: oficinaServicos[i], observacao: OBS });
  }
  const { error } = await admin.from("calculo_meses").upsert(linhas, { onConflict: "empresa_id,competencia", ignoreDuplicates: true });
  if (error) throw new Error(`Falha ao criar a receita de demonstração: ${error.message}`);

  const { count } = await admin.from("colaboradores").select("id", { count: "exact", head: true }).in("empresa_id", [ids.padaria, ids.oficina]);
  if (count) return false;

  const padrao = { cargo: null, contrato: "indeterminado", fim_contrato: null, adicionais: 0, dependentes_ir: 0, ferias_vencidas: 0, saldo_fgts: null };
  const colaboradores = [
    { empresa_id: ids.padaria, nome: "Ana Souza (DEMO)", cargo: "Padeira", admissao: data(-41, 2), salario: 2350 },
    { empresa_id: ids.padaria, nome: "Bruno Lima (DEMO)", cargo: "Atendente", admissao: data(-14, 11), salario: 1800 },
    { empresa_id: ids.padaria, nome: "Carla Mendes (DEMO)", cargo: "Confeiteira", admissao: data(-66, 15), salario: 2700, adicionais: 270, ferias_vencidas: 1, saldo_fgts: 14800 },
    { empresa_id: ids.oficina, nome: "Diego Rocha (DEMO)", cargo: "Mecânico", admissao: data(-56, 10), salario: 3400, dependentes_ir: 2 },
    { empresa_id: ids.oficina, nome: "Eduardo Alves (DEMO)", cargo: "Auxiliar de mecânico", admissao: data(-2, 3), contrato: "experiencia", fim_contrato: data(1, 1), salario: 2100 },
  ].map((c) => ({ ...padrao, ...c }));
  const { error: eColab } = await admin.from("colaboradores").insert(colaboradores);
  if (eColab) throw new Error(`Falha ao criar os colaboradores de demonstração: ${eColab.message}`);
  return true;
}
