/**
 * Maquininhas na DEMONSTRAÇÃO (dados fictícios): contratos da Padaria com a
 * Cielo (cartões) e a Alelo (vale-refeição), o formato do relatório da Cielo
 * já conhecido pelo escritório e dois relatórios do mês passado enviados pelo
 * cliente pelo caminho normal (Enviar documentos):
 *   - Cielo: a partir do dia 15, o crédito à vista Mastercard passou a ser
 *     cobrado a 3,49% (contrato: 2,99%) e três vendas no débito saíram a 1,59%
 *     (contrato: 1,19%) — o relatório entra sozinho e a conferência aponta;
 *   - Alelo: formato novo, aguardando a conferência das colunas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assinaturaCabecalho } from "../src/lib/maquininhas/leitura";
import { enviar, sessao } from "./demo-documentos";

const MARCA = "DEMO-MAQUININHA";

const CABECALHO_CIELO = [
  "Data da venda", "Hora", "Forma de pagamento", "Bandeira", "Parcelas", "Valor bruto", "Taxa", "Valor líquido", "NSU/DOC",
  "Código de autorização", "Número da máquina", "Status", "Data prevista de pagamento",
];
// Mesma assinatura que o portal calcula ao receber o relatório (nomes das colunas)
const ASSINATURA_CIELO = assinaturaCabecalho(CABECALHO_CIELO);
const MAPEAMENTO_CIELO = {
  linhaCabecalho: 3, data: 0, modalidade: 2, bandeira: 3, parcelas: 4, bruto: 5, taxa: 6, liquido: 7, nsu: 8, autorizacao: 9, terminal: 10,
  situacao: 11, previsao: 12, taxa_percentual: null,
};

function mesPassado() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

const br = (v: number) => v.toFixed(2).replace(".", ",");
const dataBr = (ano: number, mes: number, dia: number) => `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;

/** Números pseudoaleatórios fixos (a demonstração sai sempre igual). */
function sorteio(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function relatorioCielo(ano: number, mes: number) {
  const r = sorteio(20260915);
  const linhas: string[][] = [
    ["Relatório de vendas - Cielo (DEMONSTRAÇÃO - dados fictícios)"],
    ["Estabelecimento: 1020304050 - PADARIA PAO DOURADO (DEMO)"],
    [],
    CABECALHO_CIELO,
  ];
  let nsu = 801000;
  let debitosAcima = 0;
  for (let dia = 1; dia <= 28; dia++) {
    for (let k = 0; k < 3; k++) {
      const sorte = r();
      const bandeira = ["Visa", "Mastercard", "Elo"][Math.floor(r() * 3)];
      const parcelado = sorte > 0.85;
      const forma = sorte < 0.4 ? "Débito" : parcelado ? "Crédito parcelado loja" : "Crédito à vista";
      const parcelas = parcelado ? 2 + Math.floor(r() * 3) : 1;
      const bruto = Math.round((12 + r() * 368) * 100) / 100;
      let taxa = forma === "Débito" ? 1.19 : parcelado ? 4.49 : bandeira === "Visa" ? 2.79 : 2.99;
      if (forma === "Crédito à vista" && bandeira === "Mastercard" && dia >= 15) taxa = 3.49;
      if (forma === "Débito" && dia % 9 === 0 && debitosAcima < 3) {
        taxa = 1.59;
        debitosAcima++;
      }
      const valorTaxa = Math.round(bruto * taxa) / 100;
      const cancelada = dia === 20 && k === 1;
      nsu += 7;
      linhas.push([
        dataBr(ano, mes, dia),
        `${String(8 + k * 4).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}`,
        forma,
        bandeira,
        String(parcelas),
        br(bruto),
        br(valorTaxa),
        br(bruto - valorTaxa),
        String(nsu),
        `A${String(nsu * 3).slice(-5)}`,
        "PV-0001 (DEMO)",
        cancelada ? "Cancelada" : "Aprovada",
        forma === "Débito" ? dataBr(ano, mes, Math.min(dia + 1, 28)) : "",
      ]);
    }
  }
  linhas.push(["Total"]);
  return linhas.map((l) => l.join(";")).join("\r\n");
}

function relatorioAlelo(ano: number, mes: number) {
  const r = sorteio(4242);
  const linhas: string[][] = [
    ["ALELO - EXTRATO DE VENDAS (DEMONSTRAÇÃO - dados fictícios)"],
    ["Data", "Produto", "Nº Cartão", "Valor da Transação", "Valor da Taxa", "Valor a Receber", "Autorização"],
  ];
  for (let dia = 2; dia <= 28; dia += 2) {
    const bruto = Math.round((18 + r() * 60) * 100) / 100;
    // Contrato: 6,50%. Na segunda quinzena, 7,50%.
    const valorTaxa = Math.round(bruto * (dia > 15 ? 7.5 : 6.5)) / 100;
    linhas.push([
      dataBr(ano, mes, dia),
      r() > 0.5 ? "Alelo Refeição" : "Alelo Alimentação",
      `5067 **** **** ${String(1000 + Math.floor(r() * 8999))}`,
      br(bruto),
      br(valorTaxa),
      br(bruto - valorTaxa),
      String(300000 + dia * 17),
    ]);
  }
  return linhas.map((l) => l.join(";")).join("\r\n");
}

export async function semearMaquininhas(
  admin: SupabaseClient,
  conexao: { url: string; publica: string },
  padariaId: string,
  emailCliente: string,
): Promise<boolean> {
  const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", padariaId).like("nome_original", `${MARCA}%`);
  if (count) return false;
  const { ano, mes } = mesPassado();
  const inicio = new Date(Date.UTC(ano, mes - 7, 1)).toISOString().slice(0, 10);

  // Contratos da Padaria (cria só o que faltar)
  const { data: existentes } = await admin.from("maquininha_contratos").select("id, adquirente_codigo").eq("empresa_id", padariaId);
  const contrato = async (registro: Record<string, unknown>, taxas: Record<string, unknown>[]) => {
    if ((existentes ?? []).some((c) => c.adquirente_codigo === registro.adquirente_codigo)) return;
    const { data, error } = await admin
      .from("maquininha_contratos")
      .insert({ empresa_id: padariaId, vigencia_inicio: inicio, ...registro })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Falha ao criar o contrato de demonstração: ${error?.message}`);
    const { error: e2 } = await admin
      .from("maquininha_taxas")
      .insert(taxas.map((t) => ({ contrato_id: data.id, empresa_id: padariaId, bandeira: null, parcelas_de: 1, parcelas_ate: 1, prazo_dias: 30, ...t })));
    if (e2) throw new Error(`Falha ao criar as taxas de demonstração: ${e2.message}`);
  };
  await contrato({ adquirente_codigo: "cielo", adquirente_nome: "Cielo", tipo: "cartao", apelido: "Balcão (DEMO)", aluguel_mensal: 89.9 }, [
    { modalidade: "debito", taxa_percentual: 1.19, prazo_dias: 1 },
    { modalidade: "credito_vista", taxa_percentual: 2.99 },
    { modalidade: "credito_vista", bandeira: "VISA", taxa_percentual: 2.79 },
    { modalidade: "credito_parcelado", parcelas_de: 2, parcelas_ate: 6, taxa_percentual: 4.49 },
    { modalidade: "credito_parcelado", parcelas_de: 7, parcelas_ate: 12, taxa_percentual: 5.29 },
  ]);
  await contrato({ adquirente_codigo: "alelo", adquirente_nome: "Alelo", tipo: "beneficio" }, [{ modalidade: "voucher", taxa_percentual: 6.5 }]);

  // O escritório já conferiu o formato da Cielo antes (vale para todas as empresas)
  await admin.from("maquininha_layouts").upsert(
    { empresa_id: null, assinatura: ASSINATURA_CIELO, adquirente_codigo: "cielo", adquirente_nome: "Cielo", tipo: "cartao", mapeamento: MAPEAMENTO_CIELO },
    { onConflict: "empresa_id,assinatura" },
  );

  const cliente = await sessao(admin, conexao.url, conexao.publica, emailCliente);
  const comp = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const sufixo = `${ano}-${String(mes).padStart(2, "0")}`;
  await enviar(cliente, admin, padariaId, {
    comp,
    categoria: "relatorio_maquininha",
    nome: `${MARCA} vendas Cielo ${sufixo}.csv`,
    mime: "text/csv",
    bytes: Buffer.from(relatorioCielo(ano, mes), "utf8"),
    itemId: null,
  });
  await enviar(cliente, admin, padariaId, {
    comp,
    categoria: "relatorio_maquininha",
    nome: `${MARCA} extrato Alelo ${sufixo}.csv`,
    mime: "text/csv",
    bytes: Buffer.from(relatorioAlelo(ano, mes), "utf8"),
    itemId: null,
  });
  return true;
}
