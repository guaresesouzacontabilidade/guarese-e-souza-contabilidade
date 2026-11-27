/**
 * Demonstração da rentabilidade da frota (dados FICTÍCIOS): uma transportadora
 * de grãos do Tocantins com quatro caminhões e as viagens e despesas de dois
 * meses. Os números foram montados para a conversa com o cliente:
 *  - o rodotrem financiado em rota longa dá lucro bom;
 *  - o bitrem quitado dá o melhor resultado;
 *  - o rodotrem nas rotas curtas e de frete baixo dá prejuízo depois dos
 *    custos fixos (os relatórios comuns mostrariam "lucro");
 *  - o truck passa por manutenção pesada no mês;
 *  - um abastecimento tem os litros digitados errado (o portal aponta a média
 *    fora do normal). O km dos abastecimentos segue o hodômetro sem saltos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function cnpjValido(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

function ok<T>(nome: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Frota de demonstração (${nome}): ${r.error.message}`);
  return r.data;
}

function hoje() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
}

/** Data AAAA-MM-DD a partir do mês (deslocado de hoje) e do dia. */
function dataMes(deslocamento: number, dia: number) {
  const [a, m] = hoje().split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + deslocamento, 1));
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString().slice(0, 10);
}

interface Rota {
  origem: string;
  destino: string;
  km: number;
  remetente: string;
  destinatario: string;
  mercadoria: string;
  /** Frete por tonelada. */
  porTonelada: number;
  pedagio: number;
  icms: boolean;
}

const ROTAS: Record<string, Rota> = {
  itaqui: {
    origem: "Porto Nacional/TO",
    destino: "São Luís/MA (Porto do Itaqui)",
    km: 1080,
    remetente: "AGRÍCOLA SERRA DO CARMO EXEMPLO LTDA (FICTÍCIA)",
    destinatario: "TERMINAL DE GRÃOS EXEMPLO S.A. (FICTÍCIA)",
    mercadoria: "Soja em grãos (exportação)",
    porTonelada: 310,
    pedagio: 186,
    icms: false,
  },
  barcarena: {
    origem: "Campos Lindos/TO",
    destino: "Barcarena/PA",
    km: 1210,
    remetente: "FAZENDA BOA ESPERANÇA EXEMPLO (FICTÍCIA)",
    destinatario: "TRADING DO NORTE EXEMPLO S.A. (FICTÍCIA)",
    mercadoria: "Milho em grãos (exportação)",
    porTonelada: 335,
    pedagio: 142,
    icms: false,
  },
  ferrovia: {
    origem: "Pedro Afonso/TO",
    destino: "Porto Nacional/TO (terminal ferroviário)",
    km: 245,
    remetente: "AGRÍCOLA SERRA DO CARMO EXEMPLO LTDA (FICTÍCIA)",
    destinatario: "TERMINAL MULTIMODAL EXEMPLO LTDA (FICTÍCIA)",
    mercadoria: "Soja em grãos",
    porTonelada: 72,
    pedagio: 0,
    icms: true,
  },
  armazem: {
    origem: "Silvanópolis/TO",
    destino: "Porto Nacional/TO",
    km: 95,
    remetente: "COOPERATIVA DO CERRADO EXEMPLO (FICTÍCIA)",
    destinatario: "ARMAZÉNS GERAIS EXEMPLO LTDA (FICTÍCIA)",
    mercadoria: "Milho em grãos",
    porTonelada: 38,
    pedagio: 0,
    icms: true,
  },
  lavoura: {
    origem: "Fazenda Santa Luzia — Silvanópolis/TO",
    destino: "Porto Nacional/TO (armazém)",
    km: 95,
    remetente: "FAZENDA SANTA LUZIA EXEMPLO (FICTÍCIA)",
    destinatario: "ARMAZÉNS GERAIS EXEMPLO LTDA (FICTÍCIA)",
    mercadoria: "Soja em grãos",
    porTonelada: 62,
    pedagio: 0,
    icms: true,
  },
};

interface Caminhao {
  placa: string;
  descricao: string;
  tipo: string;
  kmInicial: number;
  toneladas: number;
  media: number;
  motorista: string;
  fixos: { motorista: number; financiamento: number; depreciacao: number; seguro: number; outros: number };
  /** Viagens de cada mês: rotas em rodízio, quantas e de quantos em quantos dias. */
  plano: { rotas: (keyof typeof ROTAS)[]; viagens: number; passo: number };
  extras: { mes: number; dia: number; grupo: string; descricao: string; fornecedor: string; valor: number }[];
}

const CAMINHOES: Caminhao[] = [
  {
    placa: "RTA4B21",
    descricao: "Volvo FH 540 — rodotrem graneleiro",
    tipo: "cavalo",
    kmInicial: 412300,
    toneladas: 57,
    media: 2.05,
    motorista: "Antônio Pereira (fictício)",
    fixos: { motorista: 7800, financiamento: 14500, depreciacao: 0, seguro: 1450, outros: 380 },
    plano: { rotas: ["itaqui", "barcarena"], viagens: 6, passo: 4.5 },
    extras: [
      { mes: -1, dia: 20, grupo: "pneus", descricao: "Recapagem de 6 pneus", fornecedor: "Recapadora Exemplo (fictícia)", valor: 3480 },
      { mes: 0, dia: 12, grupo: "manutencao", descricao: "Revisão dos 420 mil km (óleo e filtros)", fornecedor: "Concessionária Exemplo (fictícia)", valor: 2850 },
    ],
  },
  {
    placa: "RTA7C55",
    descricao: "Scania R 450 — bitrem graneleiro (quitado)",
    tipo: "cavalo",
    kmInicial: 655800,
    toneladas: 49,
    media: 2.35,
    motorista: "Benedito Alves (fictício)",
    fixos: { motorista: 7500, financiamento: 0, depreciacao: 6000, seguro: 1300, outros: 350 },
    plano: { rotas: ["barcarena", "itaqui"], viagens: 6, passo: 4.5 },
    extras: [{ mes: 0, dia: 5, grupo: "impostos", descricao: "Licenciamento anual (DETRAN-TO)", fornecedor: "DETRAN-TO", valor: 214.09 }],
  },
  {
    placa: "SBX2E08",
    descricao: "Mercedes Actros 2651 — rodotrem (financiado)",
    tipo: "cavalo",
    kmInicial: 198400,
    toneladas: 57,
    media: 1.85,
    motorista: "Carlos Mendes (fictício)",
    fixos: { motorista: 7600, financiamento: 12000, depreciacao: 0, seguro: 1500, outros: 400 },
    plano: { rotas: ["ferrovia", "ferrovia", "armazem"], viagens: 14, passo: 1.9 },
    extras: [{ mes: -1, dia: 14, grupo: "pneus", descricao: "2 pneus novos 295/80", fornecedor: "Pneus Exemplo (fictícia)", valor: 4180 }],
  },
  {
    placa: "QWE5F19",
    descricao: "VW Constellation 24.280 — truck graneleiro",
    tipo: "truck",
    kmInicial: 301250,
    toneladas: 16,
    media: 3.4,
    motorista: "Dario Souza (fictício)",
    fixos: { motorista: 4200, financiamento: 0, depreciacao: 1800, seguro: 600, outros: 220 },
    plano: { rotas: ["lavoura"], viagens: 18, passo: 1.45 },
    extras: [{ mes: 0, dia: 8, grupo: "manutencao", descricao: "Troca da embreagem e do volante do motor", fornecedor: "Oficina Diesel Exemplo (fictícia)", valor: 9800 }],
  },
];

const POSTOS = ["Posto Serra Azul Exemplo (fictício)", "Auto Posto Rodovia Exemplo (fictício)", "Posto Trevo Exemplo (fictício)"];

/** Cria a transportadora fictícia com caminhões, viagens e despesas (só na primeira vez). */
export async function semearFrota(
  admin: SupabaseClient,
  comoAdmin: SupabaseClient,
  opcoes: {
    dominio: string;
    contadorId: string;
    inicioAtendimento: string;
    garantirUsuario: (email: string, nome: string) => Promise<string>;
    permissoesTitular: string[];
  },
): Promise<boolean> {
  const documento = cnpjValido("667788990001");
  const { data: existente } = await admin.from("empresas").select("id").eq("documento", documento).maybeSingle();
  if (existente) {
    // Empresa já criada: só recria os caminhões se a frota estiver vazia
    const { count } = await admin.from("frota_veiculos").select("id", { count: "exact", head: true }).eq("empresa_id", existente.id);
    if (count) return false;
    await semearCaminhoes(admin, existente.id);
    return true;
  }

  const empresaId = ok(
    "empresa",
    await comoAdmin.rpc("criar_empresa", {
      p_dados: {
        razao_social: "TRANSPORTES RIO DAS ARARAS EXEMPLO LTDA (DEMONSTRAÇÃO)",
        nome_fantasia: "Transportes Rio das Araras (DEMO)",
        tipo_pessoa: "PJ",
        documento,
        regime_tributario: "lucro_presumido",
        atividade_principal: "Transporte rodoviário de cargas (grãos) intermunicipal e interestadual",
        cnae: "4930-2/02",
        servicos: ["contabil", "fiscal", "financeiro"],
        logradouro: "Rodovia TO-050, Km 3",
        numero: "SN",
        bairro: "Setor Industrial",
        cidade: "Porto Nacional",
        uf: "TO",
        cep: "77500000",
        telefone: "63999991111",
        email: `transportadora@${opcoes.dominio}`,
        contador_responsavel_id: opcoes.contadorId,
        data_inicio_atendimento: opcoes.inicioAtendimento,
        demonstracao: true,
      },
    }),
  ) as string;
  const idDono = await opcoes.garantirUsuario(`transportadora@${opcoes.dominio}`, "Dono da Transportadora (Demonstração)");
  ok(
    "acesso do dono",
    await admin
      .from("empresa_membros")
      .upsert({ empresa_id: empresaId, user_id: idDono, papel: "cliente_titular", permissoes: opcoes.permissoesTitular, ativo: true }, { onConflict: "empresa_id,user_id" }),
  );
  await admin.from("empresas").update({ ferramentas_desligadas: ["nfse"] }).eq("id", empresaId);
  await semearCaminhoes(admin, empresaId);
  return true;
}

async function semearCaminhoes(admin: SupabaseClient, empresaId: string) {
  let posto = 0;
  for (const c of CAMINHOES) {
    const veiculo = ok(
      `caminhão ${c.placa}`,
      await admin
        .from("frota_veiculos")
        .insert({
          empresa_id: empresaId,
          placa: c.placa,
          descricao: c.descricao,
          tipo: c.tipo,
          km_inicial: c.kmInicial,
          custo_motorista_mensal: c.fixos.motorista,
          financiamento_mensal: c.fixos.financiamento,
          depreciacao_mensal: c.fixos.depreciacao,
          seguro_mensal: c.fixos.seguro,
          outros_fixos_mensal: c.fixos.outros,
        })
        .select("id")
        .single(),
    ) as { id: string };
    let km = c.kmInicial;
    let cte = 1000 + CAMINHOES.indexOf(c) * 300;
    const despesas: Record<string, unknown>[] = [];
    const viagens: Record<string, unknown>[] = [];
    const ultimoDia = hoje();
    // Setembro com uma viagem a menos nas rotas curtas e frete 5% mais barato (os meses não ficam iguais)
    const programadas = [-1, 0].flatMap((mes) => {
      const quantas = mes === -1 && c.plano.passo < 3 ? c.plano.viagens - 1 : c.plano.viagens;
      const passo = mes === -1 && c.plano.passo < 3 ? c.plano.passo * 1.05 : c.plano.passo;
      return Array.from({ length: quantas }, (_, i) => [mes, 1 + Math.round(i * passo), c.plano.rotas[i % c.plano.rotas.length], i] as const);
    });
    for (const [mes, dia, chave, ordem] of programadas) {
      const data = dataMes(mes, dia);
      if (data > ultimoDia) continue;
      const rota = ROTAS[chave];
      const toneladas = c.toneladas - ((dia * 7) % 3) * 0.4;
      const frete = Math.round(toneladas * rota.porTonelada * (mes === -1 ? 0.95 : 1) * 100) / 100;
      cte += 1;
      viagens.push({
        empresa_id: empresaId,
        veiculo_id: veiculo.id,
        data,
        cte_numero: String(cte),
        remetente: rota.remetente,
        origem: rota.origem,
        destinatario: rota.destinatario,
        destino: rota.destino,
        mercadoria: rota.mercadoria,
        motorista: c.motorista,
        peso_kg: Math.round(toneladas * 1000),
        valor_frete: frete,
        icms: rota.icms ? Math.round(frete * 0.12 * 100) / 100 : 0,
        comissao_motorista: Math.round(frete * 0.11 * 100) / 100,
        quebra: rota.km > 500 ? Math.round(toneladas * 6.5 * 100) / 100 : 0,
        outras_deducoes: rota.km > 500 ? 180 : 0,
      });
      // Ida carregado e volta vazio: abastece a cada ~750 km
      const total = rota.km * 2;
      const paradas = Math.max(1, Math.round(total / 750));
      for (let p = 0; p < paradas; p++) {
        const trecho = Math.round(total / paradas);
        km += trecho;
        const variacao = 1 + (((dia + p) % 5) - 2) * 0.03;
        let litros = Math.round((trecho / (c.media * variacao)) * 10) / 10;
        // Litros digitados errado (faltou um número): a média sai fora do normal
        if (c.placa === "RTA7C55" && mes === 0 && ordem === 2 && p === 1) litros = Math.round(litros / 3);
        const preco = 6.19 + ((dia + p) % 4) * 0.06;
        const dataAbastecimento = dataMes(mes, Math.min(dia + p + (rota.km > 500 ? p : 0), 28));
        if (dataAbastecimento > ultimoDia) continue;
        despesas.push({
          empresa_id: empresaId,
          veiculo_id: veiculo.id,
          data: dataAbastecimento,
          grupo: "combustivel",
          fornecedor: POSTOS[posto++ % POSTOS.length],
          documento: String(50000 + despesas.length * 7 + dia),
          descricao: "Óleo diesel S10",
          litros,
          km,
          valor: Math.round(litros * preco * 100) / 100,
        });
        if (p === 0 && c.tipo === "cavalo") {
          const arla = Math.round(litros * 0.05);
          despesas.push({
            empresa_id: empresaId,
            veiculo_id: veiculo.id,
            data: dataMes(mes, Math.min(dia + p, 28)),
            grupo: "arla",
            fornecedor: POSTOS[posto % POSTOS.length],
            descricao: "Arla 32",
            litros: arla,
            valor: Math.round(arla * 3.89 * 100) / 100,
          });
        }
      }
      if (rota.pedagio) {
        despesas.push({ empresa_id: empresaId, veiculo_id: veiculo.id, data, grupo: "pedagio", descricao: `Pedágio ida e volta — ${rota.destino}`, valor: rota.pedagio * 2 });
      }
    }
    for (const e of c.extras) {
      const data = dataMes(e.mes, e.dia);
      if (data > ultimoDia) continue;
      despesas.push({ empresa_id: empresaId, veiculo_id: veiculo.id, data, grupo: e.grupo, descricao: e.descricao, fornecedor: e.fornecedor, valor: e.valor });
    }
    ok(`viagens ${c.placa}`, await admin.from("frota_viagens").insert(viagens));
    // Em ordem de data e km (o banco confere o hodômetro lançamento a lançamento)
    despesas.sort((a, b) => String(a.data).localeCompare(String(b.data)) || Number(a.km ?? 0) - Number(b.km ?? 0));
    for (const d of despesas) ok(`despesa ${c.placa} ${d.data}`, await admin.from("frota_despesas").insert(d));
  }
}
