/**
 * Movimento financeiro FICTÍCIO para as empresas de demonstração: três meses de
 * vendas, despesas, pagamentos e extratos bancários. Usado por seed-demo.ts.
 *
 * Resultado esperado (mês atual = M):
 *  - M-2: tudo pago, extrato importado e conciliado (saldo conferido);
 *  - M-1: extrato importado com sugestões para revisar (inclusive uma diferença
 *    de juros), uma tarifa para classificar, um saque e o pagamento da fatura
 *    do cartão para conciliar como transferências, e um recebimento vencido;
 *  - M: contas do mês em aberto (aparecem nas projeções).
 * Só cria dados quando a empresa ainda não tem lançamentos (pode rodar de novo).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gerarSugestoes } from "../src/lib/conciliacao/motor";

export type PerfilDemo = "padaria" | "oficina";

interface Pagamento {
  dia: number; // dia do pagamento no mês
  juros?: number;
  registrar: boolean; // pagamento já registrado no sistema (baixa)
  extrato?: { descricao: string; valor?: number; documento?: string }; // linha no extrato do banco
}
interface Item {
  tipo: "receber" | "pagar";
  descricao: string;
  categoria: string; // código do plano de contas
  contraparte?: string;
  dia: number; // vencimento
  valor: number;
  numero?: string;
  pago?: Pagamento;
}
interface ContraparteDemo {
  chave: string;
  nome: string;
  documento?: string;
  papeis: string[];
}

function cnpj(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

/** Data ISO do dia `d` no mês deslocado `m` (relativo ao mês atual), limitada ao fim do mês. */
function dia(m: number, d: number) {
  const hoje = new Date();
  const ultimo = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + m, Math.min(d, ultimo))).toISOString().slice(0, 10);
}
const ultimoDia = (m: number) => dia(m, 31);
const rotuloMes = (m: number) => dia(m, 1).slice(0, 7);
const variar = (valor: number, m: number, fator: number) => Math.round(valor * (1 + fator * m) * 100) / 100;

// ------------------------------------------------------------------ modelos
const PADARIA = {
  contrapartes: [
    { chave: "mercado", nome: "Mercado Bom Preço (DEMO)", documento: cnpj("556667770001"), papeis: ["cliente"] },
    { chave: "restaurante", nome: "Restaurante Sabor Local (DEMO)", documento: cnpj("667778880001"), papeis: ["cliente"] },
    { chave: "buffet", nome: "Buffet Festa Boa (DEMO)", papeis: ["cliente"] },
    { chave: "imobiliaria", nome: "Imobiliária Centro (DEMO)", papeis: ["fornecedor"] },
    { chave: "moinho", nome: "Moinho Trigo Bom (DEMO)", documento: cnpj("778889990001"), papeis: ["fornecedor"] },
    { chave: "laticinios", nome: "Laticínios Serra Azul (DEMO)", papeis: ["fornecedor"] },
    { chave: "energia", nome: "Companhia de Energia (DEMO)", papeis: ["fornecedor"] },
    { chave: "internet", nome: "Provedor Net Rápida (DEMO)", papeis: ["fornecedor"] },
    { chave: "contabil", nome: "Escritório de Contabilidade (DEMO)", papeis: ["fornecedor"] },
    { chave: "embalagens", nome: "Embalagens Rápidas (DEMO)", papeis: ["fornecedor"] },
  ] as ContraparteDemo[],
  itens(m: number, docs: Map<string, string | undefined>): Item[] {
    const pagoNoDia = (d: number, descricao: string, documento?: string): Pagamento | undefined =>
      m < 0 ? { dia: d, registrar: true, extrato: { descricao, documento } } : undefined;
    const vendas = [4850.3, 5120.8, 4760.45, 5310.9].map((v, i) => ({
      tipo: "receber" as const,
      descricao: `Vendas no balcão — semana ${i + 1}`,
      categoria: "1.01",
      dia: 7 * (i + 1),
      valor: variar(v, m, 0.03),
      pago: pagoNoDia(7 * (i + 1), "PIX RECEBIDO VENDAS BALCAO"),
    }));
    const lista: Item[] = [
      ...vendas,
      {
        tipo: "receber",
        descricao: "Fornecimento de pães — Mercado Bom Preço",
        categoria: "1.01",
        contraparte: "mercado",
        dia: 10,
        valor: 3200,
        numero: `NF ${rotuloMes(m).replace("-", "")}01`,
        // M-1: pago no banco mas ainda não registrado → sugestão de conciliação
        pago: m === -2 ? pagoNoDia(10, "PIX RECEBIDO MERCADO BOM PRECO", docs.get("mercado")) : m === -1 ? { dia: 11, registrar: false, extrato: { descricao: "PIX RECEBIDO MERCADO BOM PRECO", documento: docs.get("mercado") } } : undefined,
      },
      {
        tipo: "receber",
        descricao: "Fornecimento de pães — Restaurante Sabor Local",
        categoria: "1.01",
        contraparte: "restaurante",
        dia: 15,
        valor: 1850,
        numero: `NF ${rotuloMes(m).replace("-", "")}02`,
        // M-1: pago com 5 dias de atraso e juros → sugestão com diferença
        pago:
          m === -2
            ? pagoNoDia(15, "PIX RECEBIDO RESTAURANTE SABOR LOCAL", docs.get("restaurante"))
            : m === -1
              ? { dia: 20, registrar: false, extrato: { descricao: "PIX RECEBIDO RESTAURANTE SABOR LOCAL", valor: 1868.5, documento: docs.get("restaurante") } }
              : undefined,
      },
      { tipo: "pagar", descricao: "Aluguel da loja", categoria: "4.04", contraparte: "imobiliaria", dia: 5, valor: 2500, pago: pagoNoDia(5, "PAGTO BOLETO IMOBILIARIA CENTRO") },
      { tipo: "pagar", descricao: "Salários da equipe", categoria: "4.01", dia: 5, valor: 4200, pago: pagoNoDia(5, "PAGAMENTO SALARIOS") },
      {
        tipo: "pagar",
        descricao: "Farinha de trigo — Moinho Trigo Bom",
        categoria: "3.02",
        contraparte: "moinho",
        dia: 8,
        valor: variar(2150, m, 0.02),
        pago: pagoNoDia(8, "PAGTO BOLETO MOINHO TRIGO BOM", docs.get("moinho")),
      },
      { tipo: "pagar", descricao: "Honorários contábeis", categoria: "4.06", contraparte: "contabil", dia: 10, valor: 650, pago: pagoNoDia(10, "PAGTO BOLETO ESCRITORIO CONTABIL") },
      {
        tipo: "pagar",
        descricao: "Energia elétrica",
        categoria: "4.05",
        contraparte: "energia",
        dia: 12,
        valor: m === -2 ? 812.4 : m === -1 ? 856.1 : 830,
        // M-2: paga com 3 dias de atraso e juros (já registrado)
        pago: m === -2 ? { dia: 15, juros: 9.75, registrar: true, extrato: { descricao: "DEB AUTOMATICO ENERGIA" } } : pagoNoDia(12, "DEB AUTOMATICO ENERGIA"),
      },
      {
        tipo: "pagar",
        descricao: "Internet e telefone",
        categoria: "4.05",
        contraparte: "internet",
        dia: 15,
        valor: 129.9,
        pago: m === -1 ? { dia: 15, registrar: false, extrato: { descricao: "PAGTO BOLETO NET RAPIDA" } } : pagoNoDia(15, "PAGTO BOLETO NET RAPIDA"),
      },
      {
        tipo: "pagar",
        descricao: "Leite e derivados — Laticínios Serra Azul",
        categoria: "3.02",
        contraparte: "laticinios",
        dia: 18,
        valor: 960,
        pago: m === -1 ? { dia: 18, registrar: false, extrato: { descricao: "PIX ENVIADO LATICINIOS SERRA AZUL" } } : pagoNoDia(18, "PIX ENVIADO LATICINIOS SERRA AZUL"),
      },
      { tipo: "pagar", descricao: "Simples Nacional (DAS)", categoria: "2.01", dia: 20, valor: variar(1064, m, 0.03), pago: pagoNoDia(20, "PAGTO DAS SIMPLES NACIONAL") },
    ];
    // M-1: encomenda não recebida (fica vencida)
    if (m === -1) lista.push({ tipo: "receber", descricao: "Encomenda de festa — Buffet Festa Boa", categoria: "1.01", contraparte: "buffet", dia: 25, valor: 980 });
    return lista;
  },
  compras: [
    { dia: 10, descricao: "Embalagens para pães e bolos", categoria: "3.02", contraparte: "embalagens", valor: 734.56 },
    { dia: 20, descricao: "Manutenção do forno", categoria: "4.09", valor: 500 },
  ],
};

const OFICINA = {
  contrapartes: [
    { chave: "transportadora", nome: "Transportadora Rota Norte (DEMO)", documento: cnpj("889990000001"), papeis: ["cliente"] },
    { chave: "locadora", nome: "Locadora Estrada Livre (DEMO)", papeis: ["cliente"] },
    { chave: "galpao", nome: "Galpão Industrial Aluguéis (DEMO)", papeis: ["fornecedor"] },
    { chave: "pecas", nome: "Auto Peças Exemplo (DEMO)", documento: cnpj("990001110001"), papeis: ["fornecedor"] },
    { chave: "lubrificantes", nome: "Distribuidora de Lubrificantes (DEMO)", papeis: ["fornecedor"] },
    { chave: "energia", nome: "Companhia de Energia (DEMO)", papeis: ["fornecedor"] },
    { chave: "contabil", nome: "Escritório de Contabilidade (DEMO)", papeis: ["fornecedor"] },
    { chave: "ferramentas", nome: "Ferramentas Pro (DEMO)", papeis: ["fornecedor"] },
  ] as ContraparteDemo[],
  itens(m: number, docs: Map<string, string | undefined>): Item[] {
    const pagoNoDia = (d: number, descricao: string, documento?: string): Pagamento | undefined =>
      m < 0 ? { dia: d, registrar: true, extrato: { descricao, documento } } : undefined;
    const avulsos = [2310.0, 1980.5, 2645.0, 2150.75].map((v, i) => ({
      tipo: "receber" as const,
      descricao: `Serviços avulsos — semana ${i + 1}`,
      categoria: "1.02",
      dia: 7 * (i + 1),
      valor: variar(v, m, 0.04),
      pago: pagoNoDia(7 * (i + 1), "PIX RECEBIDO SERVICOS OFICINA"),
    }));
    const lista: Item[] = [
      ...avulsos,
      {
        tipo: "receber",
        descricao: "Manutenção da frota — Transportadora Rota Norte",
        categoria: "1.02",
        contraparte: "transportadora",
        dia: 10,
        valor: 6500,
        numero: `NFS-e ${rotuloMes(m).replace("-", "")}11`,
        pago:
          m === -2
            ? pagoNoDia(10, "TED RECEBIDA TRANSPORTADORA ROTA NORTE", docs.get("transportadora"))
            : m === -1
              ? { dia: 12, registrar: false, extrato: { descricao: "TED RECEBIDA TRANSPORTADORA ROTA NORTE", documento: docs.get("transportadora") } }
              : undefined,
      },
      { tipo: "pagar", descricao: "Aluguel do galpão", categoria: "4.04", contraparte: "galpao", dia: 5, valor: 3200, pago: pagoNoDia(5, "PAGTO BOLETO GALPAO INDUSTRIAL") },
      { tipo: "pagar", descricao: "Salários dos mecânicos", categoria: "4.01", dia: 5, valor: 7800, pago: pagoNoDia(5, "PAGAMENTO SALARIOS") },
      {
        tipo: "pagar",
        descricao: "Peças — Auto Peças Exemplo",
        categoria: "3.04",
        contraparte: "pecas",
        dia: 12,
        valor: variar(4350, m, 0.05),
        pago: m === -1 ? { dia: 12, registrar: false, extrato: { descricao: "PAGTO BOLETO AUTO PECAS EXEMPLO", documento: docs.get("pecas") } } : pagoNoDia(12, "PAGTO BOLETO AUTO PECAS EXEMPLO", docs.get("pecas")),
      },
      { tipo: "pagar", descricao: "Lubrificantes e fluidos", categoria: "3.04", contraparte: "lubrificantes", dia: 18, valor: 1120, pago: pagoNoDia(18, "PAGTO BOLETO DISTRIB LUBRIFICANTES") },
      { tipo: "pagar", descricao: "Energia elétrica", categoria: "4.05", contraparte: "energia", dia: 12, valor: m === -2 ? 1430.2 : m === -1 ? 1388.9 : 1410, pago: pagoNoDia(12, "DEB AUTOMATICO ENERGIA") },
      { tipo: "pagar", descricao: "Honorários contábeis", categoria: "4.06", contraparte: "contabil", dia: 10, valor: 900, pago: pagoNoDia(10, "PAGTO BOLETO ESCRITORIO CONTABIL") },
      { tipo: "pagar", descricao: "ISS, PIS e COFINS do mês", categoria: "2.01", dia: 20, valor: variar(1650, m, 0.03), pago: pagoNoDia(20, "PAGTO DARF E GUIA ISS") },
    ];
    if (m === -1) lista.push({ tipo: "receber", descricao: "Revisão de frota — Locadora Estrada Livre", categoria: "1.02", contraparte: "locadora", dia: 20, valor: 3900 });
    return lista;
  },
  compras: [
    { dia: 9, descricao: "Jogo de chaves e ferramentas", categoria: "4.09", contraparte: "ferramentas", valor: 890.4 },
    { dia: 21, descricao: "Material de limpeza e EPI", categoria: "4.08", valor: 344.16 },
  ],
};

interface Linha {
  data: string;
  valor: number;
  descricao: string;
  documento?: string;
  ocorrencia?: number;
}

/** Cria o movimento financeiro fictício. `usuario` é um cliente autenticado como administrador de demonstração. */
export async function semearFinanceiro(admin: SupabaseClient, usuario: SupabaseClient, empresaId: string, perfil: PerfilDemo) {
  const { count } = await admin.from("lancamentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;
  const modelo = perfil === "padaria" ? PADARIA : OFICINA;

  const { data: contas } = await admin.from("contas_financeiras").select("id, tipo, saldo_inicial").eq("empresa_id", empresaId);
  const banco = contas?.find((c) => c.tipo === "conta_corrente");
  const caixa = contas?.find((c) => c.tipo === "caixa");
  const cartao = contas?.find((c) => c.tipo === "cartao_credito");
  if (!banco || !caixa || !cartao) throw new Error("Contas de demonstração não encontradas.");
  const { data: cats } = await admin.from("categorias_financeiras").select("id, codigo, codigo_sistema").eq("empresa_id", empresaId);
  const categoria = (codigo: string) => {
    const c = cats?.find((x) => x.codigo === codigo || x.codigo_sistema === codigo);
    if (!c) throw new Error(`Categoria ${codigo} não encontrada.`);
    return c.id as string;
  };

  const contra = new Map<string, string>();
  const docs = new Map<string, string | undefined>();
  for (const c of modelo.contrapartes) {
    const { data, error } = await admin
      .from("contrapartes")
      .insert({ empresa_id: empresaId, nome: c.nome, documento: c.documento ?? null, tipo_pessoa: "PJ", papeis: c.papeis })
      .select("id")
      .single();
    if (error) throw new Error(`Contraparte ${c.nome}: ${error.message}`);
    contra.set(c.chave, data.id);
    docs.set(c.chave, c.documento);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const extratos = new Map<number, Linha[]>([
    [-2, []],
    [-1, []],
  ]);
  for (const m of [-2, -1, 0]) {
    for (const item of modelo.itens(m, docs)) {
      const vencimento = dia(m, item.dia);
      const { data: lanc, error } = await admin
        .from("lancamentos")
        .insert({
          empresa_id: empresaId,
          tipo: item.tipo,
          descricao: item.descricao,
          categoria_id: categoria(item.categoria),
          contraparte_id: item.contraparte ? contra.get(item.contraparte) : null,
          conta_financeira_id: banco.id,
          data_competencia: vencimento,
          data_vencimento: vencimento,
          valor_previsto: item.valor,
          numero_documento: item.numero ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Lançamento ${item.descricao}: ${error.message}`);
      // Mês atual: o que já venceu foi pago (o extrato do mês ainda não foi importado).
      const p = item.pago ?? (m === 0 && vencimento <= hoje ? { dia: item.dia, registrar: true } : undefined);
      if (!p) continue;
      const total = Math.round((item.valor + (p.juros ?? 0)) * 100) / 100;
      if (p.registrar) {
        const { error: eB } = await admin.from("baixas").insert({
          empresa_id: empresaId,
          lancamento_id: lanc.id,
          data_pagamento: dia(m, p.dia),
          conta_financeira_id: banco.id,
          valor_principal: item.valor,
          juros: p.juros ?? 0,
          forma_pagamento: item.tipo === "receber" ? "pix" : "boleto",
        });
        if (eB) throw new Error(`Pagamento ${item.descricao}: ${eB.message}`);
      }
      if (p.extrato && m < 0) {
        const valor = p.extrato.valor ?? total;
        extratos.get(m)!.push({ data: dia(m, p.dia), valor: item.tipo === "receber" ? valor : -valor, descricao: p.extrato.descricao, documento: p.extrato.documento });
      }
    }
  }

  // Compras no cartão de crédito em M-2 (a fatura é paga pelo banco em M-1)
  let fatura = 0;
  for (const c of modelo.compras) {
    const { error } = await usuario.rpc("registrar_compra_cartao", {
      p_empresa_id: empresaId,
      p_conta_cartao_id: cartao.id,
      p_descricao: c.descricao,
      p_data_compra: dia(-2, c.dia),
      p_valor: c.valor,
      p_categoria_id: categoria(c.categoria),
      p_contraparte_id: "contraparte" in c && c.contraparte ? contra.get(c.contraparte) : undefined,
    });
    if (error) throw new Error(`Compra no cartão ${c.descricao}: ${error.message}`);
    fatura += c.valor;
  }

  // Linhas do extrato sem lançamento correspondente
  extratos.get(-2)!.push(
    { data: dia(-2, 16), valor: -300, descricao: "SAQUE CAIXA ELETRONICO" },
    { data: ultimoDia(-2), valor: -54.9, descricao: "TARIFA PACOTE SERVICOS" },
  );
  extratos.get(-1)!.push(
    { data: dia(-1, 5), valor: -Math.round(fatura * 100) / 100, descricao: "PAGTO FATURA CARTAO VISA" },
    { data: dia(-1, 16), valor: -300, descricao: "SAQUE CAIXA ELETRONICO" },
    { data: ultimoDia(-1), valor: -54.9, descricao: "TARIFA PACOTE SERVICOS" },
  );

  // Importa os extratos (como faria o assistente de importação)
  let saldo = Number(banco.saldo_inicial ?? 0);
  for (const m of [-2, -1]) {
    const linhas = extratos.get(m)!.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao));
    const vistos = new Map<string, number>();
    for (const l of linhas) {
      const k = `${l.data}|${l.valor.toFixed(2)}|${l.descricao}`;
      vistos.set(k, (vistos.get(k) ?? 0) + 1);
      l.ocorrencia = vistos.get(k);
      saldo = Math.round((saldo + l.valor) * 100) / 100;
    }
    const { error } = await usuario.rpc("importar_extrato", {
      p_empresa_id: empresaId,
      p_conta_id: banco.id,
      p_tipo: "extrato_ofx",
      p_chave_idempotencia: `demo-extrato-${empresaId}-${rotuloMes(m)}`,
      p_arquivo_nome: `extrato-banco-${rotuloMes(m)}-DEMO.ofx`,
      p_arquivo_sha256: createHash("sha256").update(`${empresaId}|${rotuloMes(m)}`).digest("hex"),
      p_documento_id: null as unknown as string,
      p_mapeamento: {},
      p_linhas: linhas as never,
      p_saldo_final: saldo,
      p_data_saldo_final: ultimoDia(m),
    });
    if (error) throw new Error(`Extrato ${rotuloMes(m)}: ${error.message}`);
  }

  // Sugestões automáticas e conciliação completa de M-2 (o que um contador faria)
  await gerarSugestoes(admin as never, empresaId);
  const inicioM1 = dia(-1, 1);
  const { data: sugestoes } = await admin
    .from("conciliacoes")
    .select("id, itens:conciliacao_itens(movimento:movimentos_bancarios(data))")
    .eq("empresa_id", empresaId)
    .eq("status", "sugerida");
  for (const s of (sugestoes ?? []) as unknown as { id: string; itens: { movimento: { data: string } | null }[] }[]) {
    const datas = s.itens.flatMap((i) => (i.movimento ? [i.movimento.data] : []));
    if (datas.length && datas.every((d) => d < inicioM1)) {
      const { error } = await usuario.rpc("confirmar_conciliacao", { p_conciliacao_id: s.id });
      if (error) throw new Error(`Confirmação de sugestão: ${error.message}`);
    }
  }
  const { data: pendM2 } = await admin
    .from("movimentos_bancarios")
    .select("id, descricao")
    .eq("empresa_id", empresaId)
    .eq("status_conciliacao", "pendente")
    .lt("data", inicioM1);
  for (const mov of pendM2 ?? []) {
    if (mov.descricao.startsWith("TARIFA")) {
      const { error } = await usuario.rpc("classificar_movimento", {
        p_movimento_id: mov.id,
        p_categoria_id: categoria("TARIFAS_BANCARIAS"),
        p_descricao: "Tarifa do pacote de serviços bancários",
      });
      if (error) throw new Error(`Classificação da tarifa: ${error.message}`);
    } else if (mov.descricao.startsWith("SAQUE")) {
      const { error } = await usuario.rpc("conciliar_manual", {
        p_empresa_id: empresaId,
        p_movimentos: [mov.id],
        p_tipo: "transferencia",
        p_conta_contrapartida: caixa.id,
        p_observacao: "Saque para o caixa da loja",
      });
      if (error) throw new Error(`Conciliação do saque: ${error.message}`);
    }
  }
  return true;
}
