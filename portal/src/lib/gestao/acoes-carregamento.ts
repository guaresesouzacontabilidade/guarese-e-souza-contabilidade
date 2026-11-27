"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import type { Json } from "@/lib/supabase/database.types";
import { limparPlaca, placaValida } from "./carregamentos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

/** Número digitado no padrão brasileiro ("36.020,5") → texto com ponto, ou "" quando vazio. */
function numero(fd: FormData, nome: string): string | null {
  const v = texto(fd, nome);
  if (!v) return "";
  const d = lerValorBR(v);
  return d ? d.toString() : null;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/loja/carregamentos`, "layout");
}

/** Cria ou altera a ordem de carregamento (o banco confere a empresa, os cadastros e a situação). */
export async function salvarOrdem(empresaId: string, ordemId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  if (!UUID.test(empresaId) || (ordemId && !UUID.test(ordemId))) return falha("Ordem inválida.");
  const ctx = await exigirPermissao(empresaId, "nfe.emitir");
  const erros: Record<string, string[]> = {};

  const produto = texto(fd, "produto_id");
  if (!UUID.test(produto)) erros.produto_id = ["Escolha o produto."];
  const quantidade = numero(fd, "quantidade");
  if (!quantidade || Number(quantidade) <= 0) erros.quantidade = ["Informe a quantidade prevista."];
  const destinatario = texto(fd, "destinatario_id");
  if (destinatario && !UUID.test(destinatario)) erros.destinatario_id = ["Comprador inválido."];
  if (!destinatario && texto(fd, "destinatario_nome").length < 2) erros.destinatario_id = ["Escolha o comprador."];
  const placa = limparPlaca(texto(fd, "placa"));
  if (placa && !placaValida(placa)) erros.placa = ["Placa inválida (ABC1D23 ou ABC-1234)."];
  const reboques = ["reboque_1", "reboque_2", "reboque_3"].map((c) => limparPlaca(texto(fd, c))).filter((p): p is string => Boolean(p));
  if (reboques.some((p) => !placaValida(p))) erros.reboque_1 = ["Placa de carreta inválida."];
  const cpf = texto(fd, "motorista_cpf").replace(/\D/g, "");
  if (cpf && cpf.length !== 11) erros.motorista_cpf = ["O CPF tem 11 números."];
  const peso = numero(fd, "peso_previsto_kg");
  if (peso === null) erros.peso_previsto_kg = ["Peso inválido."];
  const preco = numero(fd, "preco_unitario");
  if (preco === null) erros.preco_unitario = ["Preço inválido."];
  const validade = texto(fd, "validade");
  if (validade && !DATA.test(validade)) erros.validade = ["Data inválida."];
  const frete = texto(fd, "frete_por_conta") || "9";
  if (!["0", "1", "2", "3", "4", "9"].includes(frete)) erros.frete_por_conta = ["Escolha quem paga o frete."];
  for (const c of ["emitente_id", "operacao_id", "transportador_id"]) {
    const v = texto(fd, c);
    if (v && !UUID.test(v)) erros[c] = ["Escolha inválida."];
  }
  if (Object.keys(erros).length) return falha("Confira os campos destacados.", erros);

  const dados = {
    produto_id: produto,
    quantidade,
    peso_previsto_kg: peso,
    preco_unitario: preco,
    destinatario_id: destinatario,
    destinatario_nome: texto(fd, "destinatario_nome").slice(0, 120),
    destinatario_documento: texto(fd, "destinatario_documento"),
    emitente_id: texto(fd, "emitente_id"),
    operacao_id: texto(fd, "operacao_id"),
    local_carregamento: texto(fd, "local_carregamento").slice(0, 300),
    local_descarga: texto(fd, "local_descarga").slice(0, 300),
    contrato: texto(fd, "contrato").slice(0, 60),
    validade,
    frete_por_conta: frete,
    transportador_id: texto(fd, "transportador_id"),
    transportador_nome: texto(fd, "transportador_nome").slice(0, 60),
    rntrc: texto(fd, "rntrc").slice(0, 20),
    motorista_nome: texto(fd, "motorista_nome").slice(0, 60),
    motorista_cpf: cpf,
    placa: placa ?? "",
    placa_uf: texto(fd, "placa_uf").toUpperCase().slice(0, 2),
    placas_reboque: reboques,
    observacoes: texto(fd, "observacoes").slice(0, 1000),
  };
  const { data, error } = await ctx.supabase.rpc("carregamento_salvar", {
    p_empresa_id: empresaId,
    p_id: (ordemId ?? null) as unknown as string,
    p_dados: dados as Json,
  });
  if (error) return falha(mensagemErro(error));
  const r = data as { id: string; numero: number };
  revalidar(empresaId);
  return sucesso(ordemId ? "Ordem atualizada." : `Ordem de carregamento nº ${r.numero} criada.`, { id: r.id });
}

/** Pesagem na balança (bruto e tara) e a classificação do grão. */
export async function registrarPesagem(empresaId: string, ordemId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(ordemId)) return falha("Ordem inválida.");
  const ctx = await exigirPermissao(empresaId, "nfe.emitir");
  const erros: Record<string, string[]> = {};
  const bruto = numero(fd, "peso_bruto_kg");
  const tara = numero(fd, "tara_kg");
  if (!bruto) erros.peso_bruto_kg = ["Informe o peso bruto (caminhão carregado)."];
  if (!tara) erros.tara_kg = ["Informe a tara (caminhão vazio)."];
  if (bruto && tara && Number(bruto) <= Number(tara)) erros.peso_bruto_kg = ["O peso bruto precisa ser maior que a tara."];
  const umidade = numero(fd, "umidade");
  const impureza = numero(fd, "impureza");
  if (umidade === null || (umidade && Number(umidade) > 100)) erros.umidade = ["Umidade inválida (0 a 100%)."];
  if (impureza === null || (impureza && Number(impureza) > 100)) erros.impureza = ["Impureza inválida (0 a 100%)."];
  if (Object.keys(erros).length) return falha("Confira os campos destacados.", erros);
  const { data, error } = await ctx.supabase.rpc("carregamento_pesagem", {
    p_id: ordemId,
    p_dados: {
      peso_bruto_kg: bruto,
      tara_kg: tara,
      umidade,
      impureza,
      ticket_balanca: texto(fd, "ticket_balanca").slice(0, 30),
    } as Json,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(`Pesagem registrada: ${Number(data).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg líquidos.`);
}

export async function cancelarOrdem(empresaId: string, ordemId: string, motivo: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(ordemId)) return falha("Ordem inválida.");
  const ctx = await exigirPermissao(empresaId, "nfe.emitir");
  const { error } = await ctx.supabase.rpc("carregamento_cancelar", {
    p_id: ordemId,
    p_motivo: motivo.trim(),
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Ordem cancelada.");
}
