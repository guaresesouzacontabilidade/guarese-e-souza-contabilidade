/**
 * Emissão de NF-e na DEMONSTRAÇÃO (dados fictícios): um produtor rural
 * (pessoa física, MT) com a emissão configurada — propriedade com série 920,
 * milho e soja, operação de venda de milho para outro estado com ICMS pago
 * por nota e FUNRURAL, um comprador e um transportador — mas DESLIGADA: a
 * demonstração não tem certificado digital e nenhuma nota é enviada à SEFAZ.
 * Serve para mostrar as telas de configuração, de emissão e a conferência
 * dos impostos e das guias antes de emitir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function cpfValido(base9: string) {
  const calc = (b: string) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base9);
  return `${base9}${d1}${calc(base9 + d1)}`;
}

function cnpjValido(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

export async function semearNfe(
  admin: SupabaseClient,
  comoAdmin: SupabaseClient,
  opcoes: { dominio: string; contadorId: string; inicioAtendimento: string },
): Promise<boolean> {
  const documento = cpfValido("987654321");
  const { data: existente } = await admin.from("empresas").select("id").eq("documento", documento).maybeSingle();
  if (existente) return false;

  const { data: id, error } = await comoAdmin.rpc("criar_empresa", {
    p_dados: {
      razao_social: "PRODUTOR RURAL EXEMPLO (DEMONSTRAÇÃO)",
      nome_fantasia: "Fazenda Exemplo (DEMO)",
      tipo_pessoa: "PF",
      documento,
      regime_tributario: "produtor_rural",
      atividade_principal: "Cultivo de soja e milho",
      cnae: "0115-6/00",
      servicos: ["fiscal"],
      controla_estoque: false,
      logradouro: "Rodovia Fictícia, km 10",
      numero: "S/N",
      bairro: "Zona Rural",
      cidade: "Sorriso",
      uf: "MT",
      cep: "78890000",
      email: `fazenda@${opcoes.dominio}`,
      contador_responsavel_id: opcoes.contadorId,
      data_inicio_atendimento: opcoes.inicioAtendimento,
      demonstracao: true,
    },
  });
  if (error) throw new Error(`Produtor rural (demonstração): ${error.message}`);
  const empresaId = id as string;

  const passos: { nome: string; erro: { message: string } | null }[] = [];
  const registrar = (nome: string, r: { error: { message: string } | null }) => passos.push({ nome, erro: r.error });

  registrar(
    "configuração",
    await admin.from("nfe_config").insert({
      empresa_id: empresaId,
      ativa: false,
      ambiente: "homologacao",
      crt: 3,
      presenca: 9,
      funrural_percentual: 1.5,
      funrural_modo: "retido_adquirente",
      enviar_email_destinatario: false,
    }),
  );
  registrar(
    "propriedade",
    await admin.from("nfe_emitentes").insert({
      empresa_id: empresaId,
      nome: "Fazenda Boa Esperança (DEMO)",
      inscricao_estadual: "13999999990",
      logradouro: "Rodovia Fictícia, km 10",
      numero: "S/N",
      bairro: "Zona Rural",
      municipio_ibge: "5107925",
      cep: "78890000",
      serie: 920,
    }),
  );
  registrar(
    "produtos",
    await admin.from("nfe_produtos").insert([
      { empresa_id: empresaId, codigo: "MILHO", descricao: "MILHO EM GRAOS", ncm: "10059010", unidade: "SC", peso_kg: 60, valor_unitario: 55 },
      { empresa_id: empresaId, codigo: "SOJA", descricao: "SOJA EM GRAOS", ncm: "12019000", unidade: "SC", peso_kg: 60, valor_unitario: 120 },
    ]),
  );
  registrar(
    "operação",
    await admin.from("nfe_operacoes").insert({
      empresa_id: empresaId,
      nome: "Venda de milho para outro estado (DEMO)",
      natureza: "VENDA DE PRODUCAO RURAL",
      destino: "interestadual",
      cfop: "6101",
      icms_cst: "00",
      icms_aliquota: 12,
      icms_por_operacao: true,
      pis_cst: "08",
      cofins_cst: "08",
      ibscbs_cclass_trib: "200036",
      incide_funrural: true,
      informacoes: "Operação de DEMONSTRAÇÃO: regras fictícias, sem valor fiscal.",
    }),
  );
  registrar(
    "comprador",
    await admin.from("nfe_destinatarios").insert({
      empresa_id: empresaId,
      tipo: "cnpj",
      documento: cnpjValido("778889990001"),
      nome: "CEREALISTA EXEMPLO LTDA (DEMONSTRACAO)",
      indicador_ie: 1,
      inscricao_estadual: "109999999",
      logradouro: "Avenida Fictícia",
      numero: "500",
      bairro: "Distrito Industrial",
      municipio_ibge: "5218805",
      cep: "75900000",
      email: `cerealista@${opcoes.dominio}`,
    }),
  );
  registrar(
    "transportador",
    await admin.from("nfe_transportadores").insert({
      empresa_id: empresaId,
      tipo: "cpf",
      documento: cpfValido("123123123"),
      nome: "CAMINHONEIRO EXEMPLO (DEMONSTRACAO)",
      uf: "MT",
      municipio: "Sorriso",
      placa: "ABC1D23",
      placa_uf: "MT",
    }),
  );
  const falha = passos.find((p) => p.erro);
  if (falha) throw new Error(`NF-e de demonstração (${falha.nome}): ${falha.erro!.message}`);
  return true;
}
