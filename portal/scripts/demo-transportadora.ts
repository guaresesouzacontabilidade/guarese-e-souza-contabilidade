/**
 * Transportadora de DEMONSTRAÇÃO completa (dados FICTÍCIOS). Além da
 * rentabilidade da frota (demo-frota.ts), preenche as outras telas da
 * Transportes Rio das Araras para a apresentação ao cliente:
 *  - gestão em "notas e transporte", NF-e e CT-e configurados e DESLIGADOS
 *    (sem certificado digital: nada vai à SEFAZ; o CT-e abre em modo de
 *    conferência e nenhuma nota ou CT-e aparece como emitido);
 *  - ordens de carregamento dos próprios caminhões (uma pesada, duas
 *    aguardando o caminhão), feitas com a sessão do dono fictício;
 *  - contas e financeiro de três meses: fretes a receber de cada cliente e as
 *    despesas da frota, com extratos e conciliação — os valores saem das
 *    viagens e despesas lançadas na frota, para os números conversarem;
 *  - documentos enviados e conferidos, guias publicadas (agenda de
 *    pagamentos), conversa com o escritório e solicitações;
 *  - vencimentos (certificado, RNTRC, AET, cronotacógrafo, certidões);
 *  - receita dos últimos meses (painel, previsão de impostos com a presunção
 *    de 8% e 12% do transporte de cargas, declaração de faturamento) e os
 *    colaboradores;
 *  - logo fictícia.
 * Cada parte só é criada se ainda não existir (o seed pode rodar de novo).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviar, pdfFicticio, sessao } from "./demo-documentos";
import { semearFinanceiro, type ContraparteDemo, type Item, type ModeloFinanceiro, type Pagamento } from "./demo-financeiro";
import { semearAgenda } from "./demo-agenda";

function cnpjValido(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

function cpfValido(base9: string) {
  const calc = (b: string) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base9);
  return `${base9}${d1}${calc(base9 + d1)}`;
}

function ok<T>(nome: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Transportadora de demonstração (${nome}): ${r.error.message}`);
  return r.data;
}

/** Primeiro dia do mês deslocado (AAAA-MM-01). */
function competencia(deslocamentoMeses: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamentoMeses);
  return d.toISOString().slice(0, 8) + "01";
}
/** Data do dia `d` no mês deslocado `m`, limitada ao fim do mês (mesma regra do financeiro). */
function dia(m: number, d: number) {
  const hoje = new Date();
  const ultimo = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m, Math.min(d, ultimo))).toISOString().slice(0, 10);
}
const mesDe = (m: number) => competencia(m).slice(0, 7);
const mmaaaa = (m: number) => `${competencia(m).slice(5, 7)}/${competencia(m).slice(0, 4)}`;
const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const rotuloMes = (m: number) => `${NOMES_MES[Number(competencia(m).slice(5, 7)) - 1]} de ${competencia(m).slice(0, 4)}`;
const brData = (iso: string) => iso.split("-").reverse().join("/");
const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centavos = (v: number) => Math.round(v * 100) / 100;

function hojeMais(dias: number) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
  const [a, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
/** Dia útil anterior (ou o próprio dia), considerando fins de semana e feriados nacionais de data fixa. */
function diaUtilAnterior(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || FERIADOS_FIXOS.includes(d.toISOString().slice(5, 10))) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const formatarPlaca = (p: string) => `${p.slice(0, 3)}-${p.slice(3)}`;

// ------------------------------------------------------------------ números da frota

interface MesFrota {
  /** Frete por cliente (remetente). */
  fretes: Map<string, number>;
  icms: number;
  comissoes: number;
  combustivel: number;
  pedagio: number;
  /** Pneus, manutenção e licenciamento lançados na frota, um a um. */
  extras: { data: string; grupo: string; descricao: string; fornecedor: string | null; placa: string; valor: number }[];
}

async function numerosDaFrota(admin: SupabaseClient, empresaId: string): Promise<Map<string, MesFrota>> {
  const viagens = ok(
    "viagens da frota",
    await admin.from("frota_viagens").select("data, remetente, valor_frete, icms, comissao_motorista").eq("empresa_id", empresaId),
  ) as { data: string; remetente: string | null; valor_frete: number; icms: number; comissao_motorista: number }[];
  const despesas = ok(
    "despesas da frota",
    await admin.from("frota_despesas").select("data, grupo, descricao, fornecedor, valor, veiculo:frota_veiculos(placa)").eq("empresa_id", empresaId),
  ) as unknown as { data: string; grupo: string; descricao: string | null; fornecedor: string | null; valor: number; veiculo: { placa: string } | null }[];
  const meses = new Map<string, MesFrota>();
  const doMes = (data: string) => {
    const chave = data.slice(0, 7);
    if (!meses.has(chave)) meses.set(chave, { fretes: new Map(), icms: 0, comissoes: 0, combustivel: 0, pedagio: 0, extras: [] });
    return meses.get(chave)!;
  };
  for (const v of viagens) {
    const m = doMes(v.data);
    const cliente = v.remetente ?? "CLIENTE NÃO INFORMADO (FICTÍCIO)";
    m.fretes.set(cliente, centavos((m.fretes.get(cliente) ?? 0) + Number(v.valor_frete)));
    m.icms = centavos(m.icms + Number(v.icms));
    m.comissoes = centavos(m.comissoes + Number(v.comissao_motorista));
  }
  for (const d of despesas) {
    const m = doMes(d.data);
    if (d.grupo === "combustivel" || d.grupo === "arla") m.combustivel = centavos(m.combustivel + Number(d.valor));
    else if (d.grupo === "pedagio") m.pedagio = centavos(m.pedagio + Number(d.valor));
    else
      m.extras.push({
        data: d.data,
        grupo: d.grupo,
        descricao: d.descricao ?? "Despesa do veículo",
        fornecedor: d.fornecedor,
        placa: d.veiculo?.placa ?? "",
        valor: Number(d.valor),
      });
  }
  return meses;
}

/** Mês sem viagens lançadas na frota (o retrasado): estimado a partir do mês seguinte. */
function estimarMes(base: MesFrota, fator: number): MesFrota {
  return {
    fretes: new Map([...base.fretes].map(([k, v]) => [k, centavos(v * fator)])),
    icms: centavos(base.icms * fator),
    comissoes: centavos(base.comissoes * fator),
    combustivel: centavos(base.combustivel * fator),
    pedagio: base.pedagio,
    extras: [],
  };
}

const total = (m: MesFrota) => centavos([...m.fretes.values()].reduce((a, b) => a + b, 0));

// ------------------------------------------------------------------ financeiro

const CLIENTES: Record<string, { chave: string; curto: string; extrato: string; documento?: string }> = {
  "AGRÍCOLA SERRA DO CARMO EXEMPLO LTDA (FICTÍCIA)": { chave: "agricola", curto: "Agrícola Serra do Carmo", extrato: "TED RECEBIDA AGRICOLA SERRA DO CARMO", documento: cnpjValido("334455660001") },
  "FAZENDA BOA ESPERANÇA EXEMPLO (FICTÍCIA)": { chave: "boaesperanca", curto: "Fazenda Boa Esperança", extrato: "PIX RECEBIDO FAZENDA BOA ESPERANCA" },
  "COOPERATIVA DO CERRADO EXEMPLO (FICTÍCIA)": { chave: "cooperativa", curto: "Cooperativa do Cerrado", extrato: "TED RECEBIDA COOPERATIVA DO CERRADO", documento: cnpjValido("445566770001") },
  "FAZENDA SANTA LUZIA EXEMPLO (FICTÍCIA)": { chave: "santaluzia", curto: "Fazenda Santa Luzia", extrato: "PIX RECEBIDO FAZENDA SANTA LUZIA" },
};

/** Nome do fornecedor como aparece no extrato do banco (maiúsculas, sem acentos e sem "(fictícia)"). */
const nomeNoExtrato = (nome: string) =>
  nome
    .replace(/\s*\(.*\)\s*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .trim();

/** Fretes dos 24 meses antes do retrasado (sazonalidade da safra); os dois últimos meses saem da frota. */
const HISTORICO_FRETES = [
  218400, 205100, 196300, 172800, 158200, 190600, 236900, 262300, 271500, 255800, 241200, 232700, 226300, 214800, 203600, 181200, 166900, 199400, 248100, 276600, 286200,
  268900, 252400, 240100,
];

const FORNECEDORES: ContraparteDemo[] = [
  { chave: "postos", nome: "Rede de Postos Exemplo — convênio de abastecimento (fictícia)", documento: cnpjValido("556677880001"), papeis: ["fornecedor"] },
  { chave: "pedagio", nome: "Vale-Pedágio Exemplo (fictício)", papeis: ["fornecedor"] },
  { chave: "volvo", nome: "Banco Volvo Exemplo (fictício)", papeis: ["fornecedor"] },
  { chave: "mercedes", nome: "Banco Mercedes-Benz Exemplo (fictício)", papeis: ["fornecedor"] },
  { chave: "seguradora", nome: "Seguradora Estrada Exemplo (fictícia)", papeis: ["fornecedor"] },
  { chave: "rastreio", nome: "Rastreio Exemplo — monitoramento da frota (fictício)", papeis: ["fornecedor"] },
  { chave: "patio", nome: "Imobiliária Pátio Exemplo (fictícia)", papeis: ["fornecedor"] },
  { chave: "energia", nome: "Companhia de Energia (DEMO)", papeis: ["fornecedor"] },
  { chave: "contabil", nome: "Escritório de Contabilidade (DEMO)", papeis: ["fornecedor"] },
  { chave: "pecas", nome: "Auto Peças Exemplo (fictícia)", papeis: ["fornecedor"] },
];

/** IRPJ e CSLL do Lucro Presumido no trimestre (transporte de cargas: presunção de 8% e 12%). */
function irpjCsllTrimestre(receita: number) {
  const baseIrpj = receita * 0.08;
  const irpj = baseIrpj * 0.15 + Math.max(0, baseIrpj - 60000) * 0.1;
  const csll = receita * 0.12 * 0.09;
  return { irpj: centavos(irpj), csll: centavos(csll) };
}

/** Roteiro financeiro da transportadora, com os fretes e despesas da frota de cada mês. */
function modeloTransportadora(fat: Map<number, MesFrota>, irpjCsll: { irpj: number; csll: number }): ModeloFinanceiro {
  const contrapartes: ContraparteDemo[] = [
    ...Object.entries(CLIENTES).map(([nome, c]) => ({ chave: c.chave, nome, documento: c.documento, papeis: ["cliente"] })),
    ...FORNECEDORES,
  ];
  // Fornecedores das despesas lançadas na frota (pneus, oficinas, DETRAN)
  const extras = new Map<string, string>();
  for (const m of fat.values())
    for (const e of m.extras)
      if (e.fornecedor && !extras.has(e.fornecedor)) {
        const chave = `frota${extras.size + 1}`;
        extras.set(e.fornecedor, chave);
        contrapartes.push({ chave, nome: e.fornecedor, papeis: ["fornecedor"] });
      }

  return {
    contrapartes,
    compras: [
      { dia: 9, descricao: "Peças e filtros de reposição", categoria: "3.04", contraparte: "pecas", valor: 1284.5 },
      { dia: 22, descricao: "Material de escritório e EPI dos motoristas", categoria: "4.08", valor: 436.8 },
    ],
    itens(m, docs) {
      const mes = fat.get(m)!;
      const anterior = fat.get(m - 1) ?? estimarMes(mes, 0.97);
      const pagoNoDia = (d: number, descricao: string, documento?: string): Pagamento | undefined =>
        m < 0 ? { dia: d, registrar: true, extrato: { descricao, documento } } : undefined;
      const lista: Item[] = [];

      // Fretes: duas faturas por mês para cada cliente (1ª e 2ª quinzena)
      for (const [nome, valor] of mes.fretes) {
        const c = CLIENTES[nome] ?? { chave: "", curto: nome, extrato: "TED RECEBIDA FRETE" };
        const primeira = centavos(valor / 2);
        for (const [q, d, parte] of [
          [1, 15, primeira],
          [2, 30, centavos(valor - primeira)],
        ] as const) {
          let pago = pagoNoDia(d, c.extrato, docs.get(c.chave));
          if (m === -1 && q === 2) {
            // M-1: um cliente pagou e ainda não foi registrado (sugestão de conciliação) e um ficou em atraso
            if (c.chave === "agricola") pago = { dia: d, registrar: false, extrato: { descricao: c.extrato, documento: docs.get(c.chave) } };
            if (c.chave === "santaluzia") pago = undefined;
          }
          lista.push({
            tipo: "receber",
            descricao: `Fretes da ${q}ª quinzena — ${c.curto}`,
            categoria: "1.02",
            contraparte: c.chave || undefined,
            dia: d,
            valor: parte,
            numero: `FAT ${mesDe(m).replace("-", "")}${q}${Object.keys(CLIENTES).indexOf(nome) + 1}`,
            pago,
          });
        }
      }

      // Diesel e Arla do convênio, faturados por quinzena
      const diesel1 = centavos(mes.combustivel / 2);
      lista.push(
        {
          tipo: "pagar",
          descricao: "Diesel S10 e Arla 32 — convênio (1ª quinzena)",
          categoria: "3.04",
          contraparte: "postos",
          dia: 16,
          valor: diesel1,
          pago: pagoNoDia(16, "PAGTO BOLETO REDE POSTOS EXEMPLO", docs.get("postos")),
        },
        {
          tipo: "pagar",
          descricao: "Diesel S10 e Arla 32 — convênio (2ª quinzena)",
          categoria: "3.04",
          contraparte: "postos",
          dia: 30,
          valor: centavos(mes.combustivel - diesel1),
          pago: m === -1 ? { dia: 30, registrar: false, extrato: { descricao: "PAGTO BOLETO REDE POSTOS EXEMPLO", documento: docs.get("postos") } } : pagoNoDia(30, "PAGTO BOLETO REDE POSTOS EXEMPLO", docs.get("postos")),
        },
        { tipo: "pagar", descricao: "Vale-pedágio da frota", categoria: "3.04", contraparte: "pedagio", dia: 10, valor: mes.pedagio, pago: pagoNoDia(10, "DEB AUTOMATICO VALE PEDAGIO") },
      );

      // Pneus, manutenção e licenciamento: os mesmos lançados na frota
      for (const e of mes.extras) {
        const d = Number(e.data.slice(8, 10));
        lista.push({
          tipo: "pagar",
          descricao: `${e.descricao} — ${formatarPlaca(e.placa)}`,
          categoria: e.grupo === "impostos" ? "4.12" : "3.04",
          contraparte: e.fornecedor ? extras.get(e.fornecedor) : undefined,
          dia: d,
          valor: e.valor,
          pago: pagoNoDia(d, e.grupo === "impostos" ? "PAGTO TAXA DETRAN TO" : `PAGTO BOLETO ${nomeNoExtrato(e.fornecedor ?? "FORNECEDOR")}`),
        });
      }
      if (m === -2) {
        lista.push({ tipo: "pagar", descricao: "Revisão preventiva — RTA-7C55", categoria: "3.04", contraparte: "pecas", dia: 18, valor: 3180, pago: pagoNoDia(18, "PAGTO BOLETO AUTO PECAS EXEMPLO") });
      }

      // Pessoal: salários, comissões (11% do frete do mês anterior), encargos e pró-labore
      const salarios = 16380;
      const encargos = centavos((18000 + anterior.comissoes) * 0.362);
      lista.push(
        { tipo: "pagar", descricao: "Salários dos motoristas e do administrativo (líquido)", categoria: "4.01", dia: 5, valor: salarios, pago: pagoNoDia(5, "PAGAMENTO SALARIOS") },
        { tipo: "pagar", descricao: "Comissões dos motoristas sobre os fretes do mês anterior", categoria: "4.01", dia: 5, valor: anterior.comissoes, pago: pagoNoDia(5, "PAGAMENTO COMISSOES MOTORISTAS") },
        { tipo: "pagar", descricao: "INSS (DCTFWeb) e FGTS da folha", categoria: "4.01", dia: 20, valor: encargos, pago: pagoNoDia(20, "PAGTO DARF DCTFWEB E FGTS DIGITAL") },
        { tipo: "pagar", descricao: "Pró-labore dos sócios", categoria: "4.02", dia: 5, valor: 9000, pago: pagoNoDia(5, "PIX ENVIADO PRO LABORE SOCIOS") },
      );

      // Financiamentos dos cavalos mecânicos (parcela = amortização + juros)
      lista.push(
        { tipo: "pagar", descricao: "Financiamento Volvo FH 540 (RTA-4B21) — amortização", categoria: "8.03", contraparte: "volvo", dia: 10, valor: 11640, pago: pagoNoDia(10, "DEB FINANC VOLVO AMORTIZACAO") },
        { tipo: "pagar", descricao: "Financiamento Volvo FH 540 (RTA-4B21) — juros", categoria: "5.06", contraparte: "volvo", dia: 10, valor: 2860, pago: pagoNoDia(10, "DEB FINANC VOLVO JUROS") },
        { tipo: "pagar", descricao: "Financiamento Actros 2651 (SBX-2E08) — amortização", categoria: "8.03", contraparte: "mercedes", dia: 15, valor: 9720, pago: pagoNoDia(15, "DEB FINANC MERCEDES AMORTIZACAO") },
        { tipo: "pagar", descricao: "Financiamento Actros 2651 (SBX-2E08) — juros", categoria: "5.06", contraparte: "mercedes", dia: 15, valor: 2280, pago: pagoNoDia(15, "DEB FINANC MERCEDES JUROS") },
      );

      // Seguros, rastreamento e administrativo
      lista.push(
        { tipo: "pagar", descricao: "Seguro da frota (casco e RCF-V)", categoria: "3.04", contraparte: "seguradora", dia: 15, valor: 4850, pago: pagoNoDia(15, "PAGTO BOLETO SEGURADORA ESTRADA") },
        { tipo: "pagar", descricao: "Seguro das cargas (RCTR-C)", categoria: "3.04", contraparte: "seguradora", dia: 15, valor: centavos(total(mes) * 0.0012), pago: pagoNoDia(15, "PAGTO BOLETO SEGURADORA ESTRADA RCTRC") },
        { tipo: "pagar", descricao: "Rastreamento e monitoramento dos 4 caminhões", categoria: "4.11", contraparte: "rastreio", dia: 10, valor: 756, pago: pagoNoDia(10, "PAGTO BOLETO RASTREIO EXEMPLO") },
        { tipo: "pagar", descricao: "Aluguel do pátio e do escritório", categoria: "4.04", contraparte: "patio", dia: 5, valor: 3800, pago: pagoNoDia(5, "PAGTO BOLETO IMOBILIARIA PATIO") },
        {
          tipo: "pagar",
          descricao: "Energia elétrica e internet",
          categoria: "4.05",
          contraparte: "energia",
          dia: 12,
          valor: m === -2 ? 641.3 : m === -1 ? 655.9 : 648.2,
          pago: m === -1 ? { dia: 12, registrar: false, extrato: { descricao: "DEB AUTOMATICO ENERGIA" } } : pagoNoDia(12, "DEB AUTOMATICO ENERGIA"),
        },
        { tipo: "pagar", descricao: "Honorários contábeis", categoria: "4.06", contraparte: "contabil", dia: 10, valor: 2400, pago: pagoNoDia(10, "PAGTO BOLETO ESCRITORIO CONTABIL") },
      );

      // Tributos do mês anterior (PIS e Cofins cumulativos de 3,65% e ICMS do frete)
      lista.push(
        { tipo: "pagar", descricao: `PIS e Cofins — competência ${mmaaaa(m - 1)}`, categoria: "2.01", dia: 25, valor: centavos(total(anterior) * 0.0365), pago: pagoNoDia(25, "PAGTO DARF PIS COFINS") },
        { tipo: "pagar", descricao: `ICMS do frete — competência ${mmaaaa(m - 1)}`, categoria: "2.01", dia: 9, valor: anterior.icms, pago: pagoNoDia(9, "PAGTO DARE ICMS TOCANTINS") },
      );
      // IRPJ e CSLL do trimestre encerrado (vence no último dia útil do mês seguinte)
      if (m === 0 && Number(competencia(0).slice(5, 7)) % 3 === 1) {
        lista.push({ tipo: "pagar", descricao: "IRPJ e CSLL do trimestre (Lucro Presumido)", categoria: "7.01", dia: 30, valor: centavos(irpjCsll.irpj + irpjCsll.csll) });
      }
      return lista;
    },
  };
}

// ------------------------------------------------------------------ NF-e, CT-e e gestão

async function configurarFiscal(admin: SupabaseClient, comoAdmin: SupabaseClient, empresaId: string, documento: string): Promise<boolean> {
  let criou = false;
  const primeira = async (tabela: string, filtro?: [string, string]) => {
    let q = admin.from(tabela).select("id").eq("empresa_id", empresaId);
    if (filtro) q = q.eq(filtro[0], filtro[1]);
    const { data } = await q.order("created_at").limit(1).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };

  const { data: nfe } = await admin.from("nfe_config").select("empresa_id").eq("empresa_id", empresaId).maybeSingle();
  if (!nfe) {
    ok("NF-e: configuração", await admin.from("nfe_config").insert({ empresa_id: empresaId, ativa: false, ambiente: "homologacao", crt: 3, presenca: 9, enviar_email_destinatario: false }));
    criou = true;
  }
  let emitente = await primeira("nfe_emitentes");
  if (!emitente) {
    emitente = (
      ok(
        "NF-e: emitente",
        await admin
          .from("nfe_emitentes")
          .insert({
            empresa_id: empresaId,
            nome: "Transportes Rio das Araras (DEMO)",
            inscricao_estadual: "290000555",
            logradouro: "Rodovia TO-050, Km 3",
            numero: "S/N",
            bairro: "Setor Industrial",
            municipio_ibge: "1718204",
            cep: "77500000",
            serie: 1,
          })
          .select("id")
          .single(),
      ) as { id: string }
    ).id;
    criou = true;
  }
  if (!(await primeira("nfe_produtos"))) {
    ok(
      "NF-e: produtos",
      await admin.from("nfe_produtos").insert([
        { empresa_id: empresaId, codigo: "SOJA", descricao: "SOJA EM GRAOS", ncm: "12019000", unidade: "SC", peso_kg: 60, valor_unitario: 128.5 },
        { empresa_id: empresaId, codigo: "MILHO", descricao: "MILHO EM GRAOS", ncm: "10059010", unidade: "SC", peso_kg: 60, valor_unitario: 54 },
      ]),
    );
    criou = true;
  }
  const operacaoNfe = { natureza: "VENDA DE MERCADORIA", icms_cst: "00", icms_aliquota: 12, pis_cst: "01", pis_aliquota: 0.65, cofins_cst: "01", cofins_aliquota: 3, ibscbs_cclass_trib: "200036", informacoes: "Operação de DEMONSTRAÇÃO: regras fictícias, sem valor fiscal." };
  if (!(await primeira("nfe_operacoes"))) {
    ok(
      "NF-e: operações",
      await admin.from("nfe_operacoes").insert([
        { empresa_id: empresaId, nome: "Venda de grãos dentro do TO (DEMO)", destino: "interna", cfop: "5102", ...operacaoNfe },
        { empresa_id: empresaId, nome: "Venda de grãos para outro estado (DEMO)", destino: "interestadual", cfop: "6102", ...operacaoNfe },
      ]),
    );
    criou = true;
  }
  // Cadastros copiados da comercial de grãos (MT) na primeira configuração: nome do Tocantins
  await admin.from("nfe_operacoes").update({ nome: "Venda de grãos dentro do TO (DEMO)" }).eq("empresa_id", empresaId).eq("nome", "Venda de grãos dentro de MT (DEMO)");
  await admin.from("cte_operacoes").update({ nome: "Frete de grãos dentro do TO (DEMO)" }).eq("empresa_id", empresaId).eq("nome", "Frete de grãos dentro de MT (DEMO)");

  const destinatarios = [
    { nome: "TERMINAL DE GRAOS EXEMPLO S.A. (DEMONSTRACAO)", documento: cnpjValido("778800110001"), logradouro: "Avenida dos Portos (fictícia)", numero: "1000", bairro: "Itaqui", municipio_ibge: "2111300", cep: "65085370" },
    { nome: "TRADING DO NORTE EXEMPLO S.A. (DEMONSTRACAO)", documento: cnpjValido("889911220001"), logradouro: "Rodovia PA-481 (fictícia), km 2", numero: "S/N", bairro: "Vila do Conde", municipio_ibge: "1501303", cep: "68447000" },
    { nome: "TERMINAL MULTIMODAL EXEMPLO LTDA (DEMONSTRACAO)", documento: cnpjValido("990022330001"), logradouro: "Rodovia TO-255 (fictícia), km 8", numero: "S/N", bairro: "Zona Rural", municipio_ibge: "1718204", cep: "77500000" },
  ];
  for (const d of destinatarios) {
    if (await primeira("nfe_destinatarios", ["documento", d.documento])) continue;
    ok("NF-e: destinatário", await admin.from("nfe_destinatarios").insert({ empresa_id: empresaId, tipo: "cnpj", indicador_ie: 9, ...d }));
    criou = true;
  }
  if (!(await primeira("nfe_transportadores", ["documento", documento]))) {
    ok(
      "NF-e: a própria transportadora",
      await admin.from("nfe_transportadores").insert({
        empresa_id: empresaId,
        tipo: "cnpj",
        documento,
        nome: "TRANSPORTES RIO DAS ARARAS EXEMPLO LTDA (DEMONSTRACAO)",
        uf: "TO",
        municipio: "Porto Nacional",
        placa: "RTA4B21",
        placa_uf: "TO",
        rntc: "045678912",
      }),
    );
    criou = true;
  }

  const { data: cte } = await admin.from("cte_config").select("empresa_id").eq("empresa_id", empresaId).maybeSingle();
  if (!cte) {
    ok(
      "CT-e: configuração",
      await admin.from("cte_config").insert({
        empresa_id: empresaId,
        ativa: false,
        ambiente: "homologacao",
        crt: 3,
        emitente_id: emitente,
        serie: 1,
        rntrc: "45678912",
        informacoes_padrao: "CT-e de DEMONSTRAÇÃO: dados fictícios, sem valor fiscal.",
      }),
    );
    criou = true;
  }
  if (!(await primeira("cte_operacoes"))) {
    const base = { natureza: "PRESTACAO DE SERVICO DE TRANSPORTE", icms_cst: "00", icms_aliquota: 12, ibscbs_cclass_trib: "000001", informacoes: "Operação de DEMONSTRAÇÃO: regras fictícias, sem valor fiscal." };
    ok(
      "CT-e: operações do frete",
      await admin.from("cte_operacoes").insert([
        { empresa_id: empresaId, nome: "Frete de grãos para outro estado (DEMO)", destino: "interestadual", cfop: "6353", ...base },
        { empresa_id: empresaId, nome: "Frete de grãos dentro do TO (DEMO)", destino: "interna", cfop: "5353", ...base },
      ]),
    );
    criou = true;
  }

  // Gestão em "notas e transporte" (ordens de carregamento), com a inscrição e a operação padrão
  const { data: gestao } = await admin.from("gestao_config").select("ativa, modalidade, nfe_emitente_id").eq("empresa_id", empresaId).maybeSingle();
  if (!gestao?.ativa || gestao.modalidade !== "notas" || !gestao.nfe_emitente_id) {
    const interna = await primeira("nfe_operacoes", ["destino", "interna"]);
    ok(
      "ligar a gestão",
      await comoAdmin.rpc("gestao_configurar", {
        p_empresa_id: empresaId,
        p_dados: {
          ativa: true,
          modalidade: "notas",
          perfil_fiscal: "comercio",
          nfe_emitente_id: emitente,
          nfe_operacao_id: interna,
          mensagem_comprovante: "Pátio: seg a sáb, 6h às 19h. Carregar somente com a carga enlonada e o lacre conferido. Tráfego: (63) 99999-1111. (DEMONSTRAÇÃO)",
        },
      }),
    );
    criou = true;
  }
  return criou;
}

// ------------------------------------------------------------------ ordens de carregamento

async function semearOrdens(admin: SupabaseClient, dono: SupabaseClient, empresaId: string, documento: string): Promise<boolean> {
  const { count } = await admin.from("ordens_carregamento").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;
  const produto = async (codigo: string) =>
    (ok(`produto ${codigo}`, await admin.from("nfe_produtos").select("id").eq("empresa_id", empresaId).eq("codigo", codigo).limit(1).single()) as { id: string }).id;
  const destinatario = async (base12: string) =>
    (ok("destinatário", await admin.from("nfe_destinatarios").select("id").eq("empresa_id", empresaId).eq("documento", cnpjValido(base12)).limit(1).single()) as { id: string }).id;
  const transportador = (ok("transportador", await admin.from("nfe_transportadores").select("id").eq("empresa_id", empresaId).eq("documento", documento).limit(1).single()) as { id: string }).id;
  const salvar = async (nome: string, dados: Record<string, unknown>) =>
    (ok(nome, await dono.rpc("carregamento_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: { frete_por_conta: "0", transportador_id: transportador, placa_uf: "TO", ...dados } })) as { id: string }).id;

  // 1. Soja para o Porto do Itaqui: já pesada, pronta para o CT-e
  const pesada = await salvar("ordem da soja (Itaqui)", {
    produto_id: await produto("SOJA"),
    quantidade: "950",
    preco_unitario: "128.50",
    destinatario_id: await destinatario("778800110001"),
    contrato: "FRETE-DEMO-0315",
    local_carregamento: "Agrícola Serra do Carmo (fictícia) — Porto Nacional/TO",
    local_descarga: "Terminal de Grãos Exemplo — Porto do Itaqui, São Luís/MA (fictício)",
    validade: hojeMais(2),
    motorista_nome: "ANTONIO PEREIRA (FICTICIO)",
    motorista_cpf: cpfValido("135792468"),
    placa: "RTA4B21",
    placas_reboque: ["RTB1A21", "RTB1A22"],
    observacoes: "Conferir a lona e o lacre antes de liberar. (DEMONSTRAÇÃO)",
  });
  ok(
    "pesagem da soja",
    await dono.rpc("carregamento_pesagem", {
      p_id: pesada,
      p_dados: { peso_bruto_kg: "74620", tara_kg: "17620", umidade: "13.4", impureza: "0.8", ticket_balanca: "2031" },
    }),
  );

  // 2. Milho para Barcarena: aguardando o caminhão
  await salvar("ordem do milho (Barcarena)", {
    produto_id: await produto("MILHO"),
    quantidade: "815",
    preco_unitario: "54",
    destinatario_id: await destinatario("889911220001"),
    contrato: "FRETE-DEMO-0322",
    local_carregamento: "Fazenda Boa Esperança (fictícia) — Campos Lindos/TO",
    local_descarga: "Trading do Norte Exemplo — Barcarena/PA (fictícia)",
    validade: hojeMais(3),
    motorista_nome: "BENEDITO ALVES (FICTICIO)",
    motorista_cpf: cpfValido("246813579"),
    placa: "RTA7C55",
    placas_reboque: ["RTB2C55", "RTB2C56"],
  });

  // 3. Soja para o terminal ferroviário: aguardando o caminhão
  await salvar("ordem da soja (ferrovia)", {
    produto_id: await produto("SOJA"),
    quantidade: "950",
    preco_unitario: "128.50",
    destinatario_id: await destinatario("990022330001"),
    contrato: "FRETE-DEMO-0327",
    local_carregamento: "Agrícola Serra do Carmo (fictícia) — Pedro Afonso/TO",
    local_descarga: "Terminal Multimodal Exemplo — Porto Nacional/TO (fictício)",
    validade: hojeMais(1),
    motorista_nome: "CARLOS MENDES (FICTICIO)",
    motorista_cpf: cpfValido("975318642"),
    placa: "SBX2E08",
    placas_reboque: ["SBX3E08", "SBX3E09"],
  });
  return true;
}

// ------------------------------------------------------------------ documentos, guias e conversa

async function itemChecklist(admin: SupabaseClient, empresaId: string, comp: string, categoria: string) {
  const { data } = await admin.from("checklist_itens").select("id").eq("empresa_id", empresaId).eq("competencia", comp).eq("categoria_codigo", categoria).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function semearDocumentosTransportadora(
  admin: SupabaseClient,
  conexao: { url: string; publica: string },
  empresaId: string,
  emails: { dono: string; equipe: string },
  fat: Map<number, MesFrota>,
  irpjCsll: { irpj: number; csll: number },
): Promise<boolean> {
  const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;
  const { data: emp } = await admin.from("empresas").select("documento, nome_fantasia").eq("id", empresaId).single();
  const nomeEmpresa = `${emp?.nome_fantasia ?? "Transportes Rio das Araras (DEMO)"} — CNPJ ${emp?.documento ?? ""}`;
  const dono = await sessao(admin, conexao.url, conexao.publica, emails.dono);
  const equipe = await sessao(admin, conexao.url, conexao.publica, emails.equipe);
  try {
    // 1) Envios do dono e conferência do escritório
    const f2 = fat.get(-2)!;
    const f1 = fat.get(-1)!;
    const envios: { mes: number; categoria: string; nome: string; titulo: string; linhas: [string, string][]; status?: string; motivo?: string }[] = [
      {
        mes: -2,
        categoria: "extrato_bancario",
        nome: `Extrato Sicredi - ${rotuloMes(-2)}.pdf`,
        titulo: `Extrato da conta corrente — ${rotuloMes(-2)}`,
        linhas: [["Fretes recebidos", `R$ ${reais(total(f2))}`], ["Convênio de combustível", `- R$ ${reais(f2.combustivel)}`], ["Financiamentos (Volvo e Mercedes)", "- R$ 26.500,00"], ["Folha, encargos e pró-labore", "- R$ 59.700,00"]],
        status: "aprovado",
      },
      { mes: -2, categoria: "comprovante", nome: `Comprovantes de pagamentos - ${rotuloMes(-2)}.pdf`, titulo: `Comprovantes de pagamentos — ${rotuloMes(-2)}`, linhas: [["Aluguel do pátio", "R$ 3.800,00"], ["Seguro da frota", "R$ 4.850,00"], ["Revisão preventiva RTA-7C55", "R$ 3.180,00"]], status: "aprovado" },
      { mes: -2, categoria: "contrato_emprestimo", nome: "Contrato de financiamento - Volvo FH 540.pdf", titulo: "Contrato de financiamento — Volvo FH 540 (RTA-4B21)", linhas: [["Valor financiado", "R$ 690.000,00"], ["Parcelas", "60 × R$ 14.500,00"], ["Parcelas pagas", "17"]], status: "aprovado" },
      { mes: -2, categoria: "compras_vendas_despesas", nome: `Relatorio do convenio de abastecimento - ${rotuloMes(-2)}.pdf`, titulo: `Relatório do convênio de abastecimento — ${rotuloMes(-2)}`, linhas: [["Diesel S10 e Arla 32", `R$ ${reais(f2.combustivel)}`], ["Caminhões", "RTA-4B21, RTA-7C55, SBX-2E08, QWE-5F19"]], status: "aprovado" },
      { mes: -1, categoria: "extrato_bancario", nome: `Extrato Sicredi - ${rotuloMes(-1)}.pdf`, titulo: `Extrato da conta corrente — ${rotuloMes(-1)}`, linhas: [["Fretes recebidos", `R$ ${reais(total(f1))}`], ["Convênio de combustível", `- R$ ${reais(f1.combustivel)}`], ["Pneus e manutenção", "- R$ 7.660,00"]], status: "aprovado" },
      { mes: -1, categoria: "notas_pdf", nome: `CT-e emitidos - ${rotuloMes(-1)}.pdf`, titulo: `Relação dos CT-e do mês — ${rotuloMes(-1)}`, linhas: [["CT-e emitidos", String(42)], ["Valor dos fretes", `R$ ${reais(total(f1))}`], ["ICMS destacado", `R$ ${reais(f1.icms)}`]], status: "aprovado" },
      { mes: -1, categoria: "compras_vendas_despesas", nome: `Faturas de frete - ${rotuloMes(-1)}.pdf`, titulo: `Faturas de frete emitidas — ${rotuloMes(-1)}`, linhas: [...[...f1.fretes].map(([n, v]): [string, string] => [n, `R$ ${reais(v)}`])], status: "em_analise" },
      {
        mes: -1,
        categoria: "folha_pagamento",
        nome: `Diario de bordo dos motoristas - ${rotuloMes(-1)}.pdf`,
        titulo: `Diário de bordo e jornada dos motoristas — ${rotuloMes(-1)}`,
        linhas: [["Antônio Pereira (fictício)", "RTA-4B21"], ["Benedito Alves (fictício)", "RTA-7C55"], ["Dario Souza (fictício)", "QWE-5F19"]],
        status: "correcao",
        motivo: "Faltou o diário de bordo do motorista do caminhão SBX-2E08 (Carlos Mendes). Envie o arquivo completo, por favor.",
      },
      { mes: -1, categoria: "compras_vendas_despesas", nome: `Relatorio do convenio de abastecimento - ${rotuloMes(-1)}.pdf`, titulo: `Relatório do convênio de abastecimento — ${rotuloMes(-1)}`, linhas: [["Diesel S10 e Arla 32", `R$ ${reais(f1.combustivel)}`]] },
      { mes: 0, categoria: "compras_vendas_despesas", nome: `Abastecimentos 1a quinzena - ${rotuloMes(0)}.pdf`, titulo: `Abastecimentos da 1ª quinzena — ${rotuloMes(0)}`, linhas: [["Diesel S10 e Arla 32", `R$ ${reais(centavos(fat.get(0)!.combustivel / 2))}`]] },
    ];
    for (const e of envios) {
      const comp = competencia(e.mes);
      const id = await enviar(dono, admin, empresaId, {
        comp,
        categoria: e.categoria,
        nome: e.nome,
        mime: "application/pdf",
        bytes: await pdfFicticio(e.titulo, nomeEmpresa, e.linhas),
        itemId: await itemChecklist(admin, empresaId, comp, e.categoria),
      });
      if (e.status) ok(`conferência de ${e.nome}`, await equipe.rpc("alterar_status_documento", { p_documento_id: id, p_status: e.status, p_motivo: e.motivo ?? undefined }));
    }

    // 2) Guias e folha publicadas pelo escritório (aparecem na agenda de pagamentos)
    const publicacoes: { mes: number; categoria: string; nome: string; titulo: string; linhas: [string, string][]; vencimento?: string; valor?: number }[] = [];
    for (const m of [-2, -1]) {
      const pisCofins = centavos(total(fat.get(m)!) * 0.0365);
      const venc = diaUtilAnterior(dia(m + 1, 25));
      publicacoes.push({
        mes: m,
        categoria: "esc_guia",
        nome: `DARF PIS e Cofins - ${mmaaaa(m)}.pdf`,
        titulo: `DARF — PIS/Pasep e Cofins — ${mmaaaa(m)}`,
        linhas: [["Documento de arrecadação de receitas federais", `Competência ${mmaaaa(m)}`], ["Regime cumulativo (0,65% + 3%)", `Receita R$ ${reais(total(fat.get(m)!))}`], ["Vencimento", brData(venc)], ["Valor", `R$ ${reais(pisCofins)}`]],
        vencimento: venc,
        valor: pisCofins,
      });
      publicacoes.push({
        mes: m,
        categoria: "esc_folha",
        nome: `Folha de pagamento e holerites - ${mmaaaa(m)}.pdf`,
        titulo: `Folha de pagamento e holerites — ${mmaaaa(m)}`,
        linhas: [["Colaboradores", "5"], ["Salários", "R$ 18.000,00"], ["Comissões dos motoristas", `R$ ${reais(fat.get(m)!.comissoes)}`], ["Líquido a pagar", `R$ ${reais(centavos(16380 + fat.get(m)!.comissoes * 0.91))}`]],
      });
    }
    const encargos = centavos((18000 + f1.comissoes) * 0.362);
    const inss = centavos(encargos * 0.78);
    const vencFolha = diaUtilAnterior(dia(0, 20));
    publicacoes.push(
      { mes: -1, categoria: "esc_guia", nome: `DCTFWeb INSS - ${mmaaaa(-1)}.pdf`, titulo: `DARF — Contribuições previdenciárias (DCTFWeb) — ${mmaaaa(-1)}`, linhas: [["Competência", mmaaaa(-1)], ["Vencimento", brData(vencFolha)], ["Valor", `R$ ${reais(inss)}`]], vencimento: vencFolha, valor: inss },
      { mes: -1, categoria: "esc_guia", nome: `FGTS Digital - ${mmaaaa(-1)}.pdf`, titulo: `FGTS — ${mmaaaa(-1)}`, linhas: [["Guia do FGTS Digital", `Competência ${mmaaaa(-1)}`], ["Vencimento", brData(vencFolha)], ["Valor", `R$ ${reais(centavos(encargos - inss))}`]], vencimento: vencFolha, valor: centavos(encargos - inss) },
    );
    if (Number(competencia(0).slice(5, 7)) % 3 === 1) {
      const venc = diaUtilAnterior(dia(0, 31));
      publicacoes.push({
        mes: -1,
        categoria: "esc_guia",
        nome: `DARF IRPJ e CSLL - trimestre ate ${mmaaaa(-1)}.pdf`,
        titulo: `DARF — IRPJ e CSLL do trimestre encerrado em ${mmaaaa(-1)} (Lucro Presumido)`,
        linhas: [["IRPJ (presunção de 8% do frete)", `R$ ${reais(irpjCsll.irpj)}`], ["CSLL (presunção de 12% do frete)", `R$ ${reais(irpjCsll.csll)}`], ["Vencimento (quota única)", brData(venc)], ["Valor total", `R$ ${reais(centavos(irpjCsll.irpj + irpjCsll.csll))}`]],
        vencimento: venc,
        valor: centavos(irpjCsll.irpj + irpjCsll.csll),
      });
    }
    for (const p of publicacoes) {
      await enviar(equipe, admin, empresaId, {
        comp: competencia(p.mes),
        categoria: p.categoria,
        nome: p.nome,
        mime: "application/pdf",
        bytes: await pdfFicticio(p.titulo, nomeEmpresa, p.linhas),
        itemId: null,
        titulo: p.titulo,
        vencimento: p.vencimento,
        valor: p.valor === undefined ? undefined : reais(p.valor),
      });
    }

    // 3) Conversa sobre a rentabilidade da frota
    const conversa = ok(
      "conversa",
      await dono.rpc("criar_conversa", {
        p_empresa_id: empresaId,
        p_assunto: "Rentabilidade da frota — caminhão SBX-2E08",
        p_corpo: "Bom dia! Vi no relatório que o SBX-2E08 fechou o mês no negativo nas rotas curtas. Vocês conseguem simular quanto o frete por tonelada precisaria subir para ele empatar?",
        p_tipo: "mensagem",
      }),
    ) as string;
    ok(
      "resposta do escritório",
      await equipe.rpc("enviar_mensagem", {
        p_conversa_id: conversa,
        p_corpo:
          "Bom dia! Preparamos a simulação com os custos lançados no portal: considerando combustível, comissão, parcela, seguro e o rateio administrativo, o veículo precisa de aproximadamente R$ 9,00 a mais por tonelada nas rotas da ferrovia para alcançar o ponto de equilíbrio. Publicaremos o estudo completo em Documentos.",
        p_interna: false,
      }),
    );
  } finally {
    await dono.auth.signOut({ scope: "local" });
    await equipe.auth.signOut({ scope: "local" });
  }
  return true;
}

// ------------------------------------------------------------------ cálculos, colaboradores e vencimentos

async function semearCalculos(admin: SupabaseClient, empresaId: string, fat: Map<number, MesFrota>): Promise<boolean> {
  const { count } = await admin.from("calculo_meses").select("empresa_id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;
  // Transporte de cargas no Lucro Presumido: presunção de 8% (IRPJ) e 12% (CSLL); sem ISS
  // (o frete intermunicipal e interestadual paga ICMS, apurado à parte); FPAS 612 (SEST/SENAT).
  ok(
    "cálculos: parâmetros",
    await admin.from("calculo_parametros").upsert(
      {
        empresa_id: empresaId,
        presuncao_irpj_servicos: 8,
        presuncao_csll_servicos: 12,
        aliquota_iss: null,
        calcular_icms: false,
        pro_labore: 9000,
        socios_pro_labore: 2,
        rat: 3,
        fap: 1,
        terceiros: 5.2,
      },
      { onConflict: "empresa_id", ignoreDuplicates: true },
    ),
  );
  const receitas = [...HISTORICO_FRETES, total(fat.get(-2)!), total(fat.get(-1)!)];
  ok(
    "cálculos: receita informada",
    await admin.from("calculo_meses").upsert(
      receitas.map((v, i) => ({
        empresa_id: empresaId,
        competencia: competencia(i - receitas.length),
        receita_mercadorias: 0,
        receita_servicos: v,
        observacao: "Fretes — valores fictícios de demonstração.",
      })),
      { onConflict: "empresa_id,competencia", ignoreDuplicates: true },
    ),
  );

  const { count: colaboradores } = await admin.from("colaboradores").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (!colaboradores) {
    const data = (m: number, d: number) => `${competencia(m).slice(0, 8)}${String(d).padStart(2, "0")}`;
    const padrao = { contrato: "indeterminado", fim_contrato: null, adicionais: 0, dependentes_ir: 0, ferias_vencidas: 0, saldo_fgts: null };
    ok(
      "colaboradores",
      await admin.from("colaboradores").insert(
        [
          { nome: "Antônio Pereira (fictício)", cargo: "Motorista carreteiro — RTA-4B21", admissao: data(-52, 3), salario: 4200, dependentes_ir: 2, saldo_fgts: 21400 },
          { nome: "Benedito Alves (fictício)", cargo: "Motorista carreteiro — RTA-7C55", admissao: data(-38, 15), salario: 4100, ferias_vencidas: 1 },
          { nome: "Carlos Mendes (fictício)", cargo: "Motorista carreteiro — SBX-2E08", admissao: data(-19, 1), salario: 4150, dependentes_ir: 1 },
          { nome: "Dario Souza (fictício)", cargo: "Motorista de caminhão — QWE-5F19", admissao: data(-8, 10), salario: 3100 },
          { nome: "Elaine Rocha (fictícia)", cargo: "Auxiliar administrativo e de tráfego", admissao: data(-2, 1), salario: 2450, contrato: "experiencia", fim_contrato: data(1, 29) },
        ].map((c) => ({ ...padrao, ...c, empresa_id: empresaId })),
      ),
    );
  }
  return true;
}

async function semearVencimentos(admin: SupabaseClient, empresaId: string): Promise<boolean> {
  const { count } = await admin.from("vencimentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;
  const dias = (n: number) => hojeMais(n);
  const padrao = { numero: null, orgao: null, emissao: null, responsavel: "escritorio", observacao: null };
  const linhas = [
    { tipo: "certificado_digital", descricao: "Certificado digital A1 (e-CNPJ)", emissao: dias(-327), validade: dias(38), orgao: "Autoridade certificadora (DEMO)" },
    { tipo: "outro", descricao: "RNTRC — Registro Nacional de Transportadores Rodoviários de Cargas (ANTT)", numero: "045678912", validade: dias(412), orgao: "ANTT (DEMO)", responsavel: "cliente" },
    { tipo: "outro", descricao: "AET — Autorização Especial de Trânsito do rodotrem RTA-4B21", validade: dias(9), orgao: "DNIT (DEMO)", responsavel: "cliente", observacao: "Renovar antes da próxima viagem para o Itaqui." },
    { tipo: "outro", descricao: "Aferição do cronotacógrafo — SBX-2E08", validade: dias(-4), orgao: "Inmetro (DEMO)", responsavel: "cliente" },
    { tipo: "contrato", descricao: "Apólice do seguro de cargas (RCTR-C)", validade: dias(63), orgao: "Seguradora Estrada Exemplo (fictícia)", responsavel: "cliente" },
    { tipo: "alvara_funcionamento", descricao: "Alvará de funcionamento do pátio", validade: `${new Date().getUTCFullYear()}-12-31`, orgao: "Prefeitura de Porto Nacional", responsavel: "cliente" },
    { tipo: "cnd_federal", descricao: "CND Federal (Receita e PGFN)", emissao: dias(-150), validade: dias(30) },
    { tipo: "crf_fgts", descricao: "CRF do FGTS", emissao: dias(-25), validade: dias(5) },
    { tipo: "cndt", descricao: "CNDT (Justiça do Trabalho)", emissao: dias(-60), validade: dias(120) },
  ].map((v) => ({ ...padrao, ...v, empresa_id: empresaId }));
  ok("vencimentos", await admin.from("vencimentos").insert(linhas));
  await admin.rpc("rotina_vencimentos");
  return true;
}

async function semearSolicitacoesTransportadora(admin: SupabaseClient, conexao: { url: string; publica: string }, empresaId: string, emails: { dono: string; equipe: string }) {
  const titulo = "Contratar motorista para o 5º caminhão";
  const { count } = await admin.from("solicitacoes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("titulo", titulo);
  if (count) return false;
  const dono = await sessao(admin, conexao.url, conexao.publica, emails.dono);
  const equipe = await sessao(admin, conexao.url, conexao.publica, emails.equipe);
  try {
    const { data: eu } = await equipe.auth.getUser();
    const abrir = async (servico: string, t: string, descricao: string, prioridade = "normal") =>
      ok("solicitação", await dono.rpc("abrir_solicitacao", { p_empresa_id: empresaId, p_servico: servico, p_titulo: t, p_descricao: descricao, p_prioridade: prioridade })) as string;
    await abrir("admissao", titulo, "Motorista carreteiro com CNH E e curso MOPP, início em 1º de dezembro, salário de R$ 4.200,00 e comissão de 11% do frete. (DEMONSTRAÇÃO)");
    const declaracao = await abrir(
      "declaracao_faturamento",
      "Declaração de faturamento para financiar um cavalo mecânico",
      "O banco pediu o faturamento dos últimos 12 meses para o financiamento do quinto caminhão. (DEMONSTRAÇÃO)",
      "urgente",
    );
    ok("andamento da solicitação", await equipe.rpc("atualizar_solicitacao", { p_id: declaracao, p_status: "em_andamento", p_comentario: "Estamos conferindo os fretes de setembro para fechar os 12 meses.", p_responsavel: eu.user?.id ?? null }));
  } finally {
    await dono.auth.signOut({ scope: "local" });
    await equipe.auth.signOut({ scope: "local" });
  }
  return true;
}

async function semearLogo(admin: SupabaseClient, empresaId: string): Promise<boolean> {
  const { data: e } = await admin.from("empresas").select("logo_path").eq("id", empresaId).single();
  if (e?.logo_path) return false;
  const bytes = readFileSync(join(__dirname, "arquivos-demo", "logo-transportadora.png"));
  const caminho = `${empresaId}/logo-${Date.now()}.png`;
  ok("logo: envio", await admin.storage.from("empresas-logos").upload(caminho, bytes, { contentType: "image/png", upsert: false }));
  ok("logo: cadastro", await admin.from("empresas").update({ logo_path: caminho, logo_atualizado_em: new Date().toISOString() }).eq("id", empresaId));
  return true;
}

// ------------------------------------------------------------------ execução

/** Preenche as demais telas da transportadora fictícia. Devolve o que foi criado nesta execução. */
export async function semearTransportadoraCompleta(
  admin: SupabaseClient,
  comoAdmin: SupabaseClient,
  conexao: { url: string; publica: string },
  emails: { dono: string; equipe: string },
): Promise<string[]> {
  const documento = cnpjValido("667788990001");
  const { data: emp } = await admin.from("empresas").select("id").eq("documento", documento).eq("demonstracao", true).maybeSingle();
  if (!emp) return [];
  const empresaId = emp.id as string;
  const feito: string[] = [];

  // Cadastro operacional: contribuinte do ICMS (frete), com empregados e pró-labore
  await admin.from("empresas").update({ contribuinte_icms: true, contribuinte_iss: false, tem_empregados: true, tem_pro_labore: true }).eq("id", empresaId);
  if (await semearLogo(admin, empresaId)) feito.push("logo");
  if (await configurarFiscal(admin, comoAdmin, empresaId, documento)) feito.push("NF-e e CT-e configurados (desligados) e gestão em notas e transporte");

  const { count: contas } = await admin.from("contas_financeiras").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (!contas) {
    const inicio = `${new Date().getUTCFullYear() - 1}-12-31`;
    const banco = ok(
      "conta corrente",
      await admin
        .from("contas_financeiras")
        .insert({ empresa_id: empresaId, tipo: "conta_corrente", nome: "Sicredi — Conta corrente (DEMO)", banco_codigo: "748", banco_nome: "Sicredi", agencia: "0815", numero: "34567-8", saldo_inicial: 85000, saldo_inicial_data: inicio })
        .select("id")
        .single(),
    ) as { id: string };
    ok(
      "caixa e cartão",
      await admin.from("contas_financeiras").insert([
        { empresa_id: empresaId, tipo: "caixa", nome: "Caixa do escritório (DEMO)", saldo_inicial: 800, saldo_inicial_data: inicio },
        { empresa_id: empresaId, tipo: "cartao_credito", nome: "Cartão Visa empresarial (DEMO)", saldo_inicial: 0, saldo_inicial_data: inicio, cartao_dia_fechamento: 25, cartao_dia_vencimento: 5, cartao_conta_pagamento_id: banco.id },
      ]),
    );
    feito.push("contas");
  }

  const { count: checklist } = await admin.from("checklist_itens").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (!checklist) for (const d of [-2, -1, 0]) ok("checklist", await comoAdmin.rpc("gerar_checklist_competencia", { p_empresa_id: empresaId, p_competencia: competencia(d) }));

  // Números do financeiro, das guias e do painel saem da frota (o mês retrasado é estimado)
  const frota = await numerosDaFrota(admin, empresaId);
  const m1 = frota.get(mesDe(-1));
  const m0 = frota.get(mesDe(0));
  if (!m1 || !m0) return feito; // frota sem os dois meses: nada mais a fazer
  const fat = new Map<number, MesFrota>([
    [-2, estimarMes(m1, 0.964)],
    [-1, m1],
    [0, m0],
  ]);
  // Trimestre encerrado no mês passado: o mês anterior ao retrasado vem do histórico do painel
  const irpjCsll = irpjCsllTrimestre(HISTORICO_FRETES[HISTORICO_FRETES.length - 1] + total(fat.get(-2)!) + total(fat.get(-1)!));

  if (await semearFinanceiro(admin, comoAdmin, empresaId, modeloTransportadora(fat, irpjCsll))) feito.push("financeiro (fretes, despesas, extratos e conciliação)");
  if (await semearDocumentosTransportadora(admin, conexao, empresaId, emails, fat, irpjCsll)) feito.push("documentos, guias e conversa");
  const pagas = await semearAgenda(admin, [empresaId]);
  if (pagas) feito.push(`${pagas} guia(s) paga(s) na agenda`);
  if (await semearCalculos(admin, empresaId, fat)) feito.push("receita dos últimos meses e colaboradores");
  if (await semearVencimentos(admin, empresaId)) feito.push("vencimentos");
  const dono = await sessao(admin, conexao.url, conexao.publica, emails.dono);
  try {
    if (await semearOrdens(admin, dono, empresaId, documento)) feito.push("ordens de carregamento");
  } finally {
    await dono.auth.signOut({ scope: "local" });
  }
  if (await semearSolicitacoesTransportadora(admin, conexao, empresaId, emails)) feito.push("solicitações");
  const { count: tarefas } = await admin.from("tarefas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (!tarefas) {
    await admin.rpc("rotina_operacional");
    feito.push("obrigações e prazos do mês");
  }
  return feito;
}
