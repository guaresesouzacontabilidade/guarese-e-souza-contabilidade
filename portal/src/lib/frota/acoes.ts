"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import { GRUPOS_DESPESA } from "./rentabilidade";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const texto = (fd: FormData, nome: string, max = 120) => String(fd.get(nome) ?? "").trim().slice(0, max) || null;
/** Valor digitado no padrão brasileiro → texto com ponto (null quando vazio). */
function valor(fd: FormData, nome: string): string | null | undefined {
  const t = String(fd.get(nome) ?? "").trim();
  if (!t) return null;
  const d = lerValorBR(t);
  return d && d.gte(0) ? d.toString() : undefined;
}
/** Km digitado ("344.057" ou "344057") → número inteiro. */
function km(fd: FormData, nome: string): number | null | undefined {
  const t = String(fd.get(nome) ?? "").replace(/[.\s]/g, "").trim();
  if (!t) return null;
  return /^\d{1,9}$/.test(t) ? Number(t) : undefined;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/frota`, "layout");
}

export async function salvarVeiculo(empresaId: string, veiculoId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || (veiculoId && !UUID.test(veiculoId))) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "financeiro.editar");
  const placa = String(fd.get("placa") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const erros: Record<string, string[]> = {};
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) erros.placa = ["Placa no formato ABC1D23 ou ABC1234."];
  const descricao = texto(fd, "descricao");
  if (!descricao || descricao.length < 2) erros.descricao = ["Descreva o veículo (ex.: Volvo FH 540 — bitrem)."];
  const campos = ["custo_motorista_mensal", "depreciacao_mensal", "financiamento_mensal", "seguro_mensal", "outros_fixos_mensal"] as const;
  const fixos: Record<string, string> = {};
  for (const c of campos) {
    const v = valor(fd, c);
    if (v === undefined) erros[c] = ["Valor inválido."];
    else fixos[c] = v ?? "0";
  }
  const kmInicial = km(fd, "km_inicial");
  if (kmInicial === undefined) erros.km_inicial = ["Digite só os números do hodômetro."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const dados = {
    empresa_id: empresaId,
    placa,
    descricao: descricao!,
    tipo: String(fd.get("tipo") ?? "cavalo"),
    km_inicial: kmInicial ?? null,
    ativo: fd.get("ativo") !== "off",
    ...fixos,
  };
  const r = veiculoId
    ? await ctx.supabase.from("frota_veiculos").update(dados as never).eq("id", veiculoId).eq("empresa_id", empresaId)
    : await ctx.supabase.from("frota_veiculos").insert(dados as never);
  if (r.error) return falha(r.error.code === "23505" ? "Já existe um veículo com esta placa." : mensagemErro(r.error));
  revalidar(empresaId);
  return sucesso(veiculoId ? "Veículo atualizado." : "Veículo cadastrado.");
}

export async function lancarViagem(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "financeiro.editar");
  const erros: Record<string, string[]> = {};
  const veiculo = String(fd.get("veiculo_id") ?? "");
  if (!UUID.test(veiculo)) erros.veiculo_id = ["Escolha o caminhão."];
  const data = String(fd.get("data") ?? "");
  if (!DATA.test(data)) erros.data = ["Informe a data."];
  const frete = valor(fd, "valor_frete");
  if (!frete) erros.valor_frete = ["Informe o valor do frete."];
  const numeros: Record<string, string | null> = {};
  for (const c of ["icms", "comissao_motorista", "quebra", "outras_deducoes", "peso_kg"]) {
    const v = valor(fd, c);
    if (v === undefined) erros[c] = ["Valor inválido."];
    else numeros[c] = v;
  }
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await ctx.supabase.from("frota_viagens").insert({
    empresa_id: empresaId,
    veiculo_id: veiculo,
    data,
    cte_numero: texto(fd, "cte_numero", 20),
    remetente: texto(fd, "remetente"),
    origem: texto(fd, "origem", 80),
    destinatario: texto(fd, "destinatario"),
    destino: texto(fd, "destino", 80),
    mercadoria: texto(fd, "mercadoria", 80),
    motorista: texto(fd, "motorista"),
    valor_frete: frete,
    icms: numeros.icms ?? "0",
    comissao_motorista: numeros.comissao_motorista ?? "0",
    quebra: numeros.quebra ?? "0",
    outras_deducoes: numeros.outras_deducoes ?? "0",
    peso_kg: numeros.peso_kg,
  } as never);
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Viagem lançada.");
}

export async function lancarDespesa(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "financeiro.editar");
  const erros: Record<string, string[]> = {};
  const veiculo = String(fd.get("veiculo_id") ?? "");
  if (!UUID.test(veiculo)) erros.veiculo_id = ["Escolha o caminhão."];
  const data = String(fd.get("data") ?? "");
  if (!DATA.test(data)) erros.data = ["Informe a data."];
  const grupo = String(fd.get("grupo") ?? "");
  if (!(grupo in GRUPOS_DESPESA)) erros.grupo = ["Escolha o tipo da despesa."];
  const total = valor(fd, "valor");
  if (!total) erros.valor = ["Informe o valor."];
  const litros = valor(fd, "litros");
  if (litros === undefined) erros.litros = ["Quantidade inválida."];
  const hodometro = km(fd, "km");
  if (hodometro === undefined) erros.km = ["Digite só os números do hodômetro."];
  if (grupo === "combustivel" && !litros) erros.litros = ["Informe os litros (para a média km/l)."];
  if (grupo === "combustivel" && hodometro === null) erros.km = ["Informe o km do hodômetro (para o km rodado e a média)."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const descricao = texto(fd, "descricao") ?? GRUPOS_DESPESA[grupo as keyof typeof GRUPOS_DESPESA];
  const { error } = await ctx.supabase.from("frota_despesas").insert({
    empresa_id: empresaId,
    veiculo_id: veiculo,
    data,
    grupo,
    fornecedor: texto(fd, "fornecedor"),
    documento: texto(fd, "documento", 30),
    descricao,
    litros: litros ?? null,
    km: hodometro ?? null,
    valor: total,
  } as never);
  if (error) return falha(mensagemErro(error), /hodômetro|km/i.test(error.message) ? { km: [mensagemErro(error)] } : undefined);
  revalidar(empresaId);
  return sucesso("Despesa lançada.");
}

export async function excluirLancamentoFrota(empresaId: string, tipo: "viagem" | "despesa", id: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(id)) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "financeiro.editar");
  const tabela = tipo === "viagem" ? "frota_viagens" : "frota_despesas";
  const { error, count } = await ctx.supabase.from(tabela).delete({ count: "exact" }).eq("id", id).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Lançamento não encontrado.");
  revalidar(empresaId);
  return sucesso(tipo === "viagem" ? "Viagem excluída." : "Despesa excluída.");
}
