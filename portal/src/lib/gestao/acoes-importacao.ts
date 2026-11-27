"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { buscarTudo } from "@/lib/supabase/paginar";
import { analisarProdutos, dadosDaLinha, lerPlanilhaProdutos, type CampoPlanilha, type LinhaAnalisada, type LinhaProduto } from "./planilha-produtos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// As ações do servidor aceitam até 2 MB por envio (next.config)
const LIMITE_BYTES = 1.9 * 1024 * 1024;

export interface PreviaPlanilha {
  linhas: LinhaAnalisada[];
  colunas: CampoPlanilha[];
}

/** Lê a planilha enviada e mostra o que vai acontecer (nada é gravado aqui). */
export async function conferirPlanilhaProdutos(empresaId: string, fd: FormData): Promise<ResultadoAcao<PreviaPlanilha>> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha a planilha (Excel .xlsx ou .csv).");
  if (arquivo.size > LIMITE_BYTES) return falha("A planilha passa de 2 MB. Divida em partes (ou salve como .xlsx, que é menor).");
  if (!/\.(xlsx|csv|txt)$/i.test(arquivo.name)) return falha("Envie a planilha em Excel (.xlsx) ou CSV.");
  let celulas;
  try {
    celulas = await lerPlanilhaProdutos(new Uint8Array(await arquivo.arrayBuffer()), arquivo.name);
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
  }
  const existentes = await buscarTudo((de, ate) => ctx.supabase.from("nfe_produtos").select("codigo").eq("empresa_id", empresaId).range(de, ate));
  const r = analisarProdutos(celulas, new Set(existentes.map((p) => p.codigo)));
  if (r.erroGeral) return falha(r.erroGeral);
  if (!r.linhas.length) return falha("A planilha não tem produtos depois da linha de títulos.");
  if (r.linhas.length > 5000) return falha("Envie até 5.000 produtos por planilha.");
  return sucesso(undefined, { linhas: r.linhas, colunas: r.colunas });
}

/** Grava os produtos conferidos (tudo de uma vez: se uma linha falhar, nada muda). */
export async function importarPlanilhaProdutos(empresaId: string, linhas: LinhaProduto[], atualizarEstoque: boolean): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  if (!Array.isArray(linhas) || !linhas.length) return falha("Nenhum produto para importar.");
  if (linhas.length > 5000) return falha("Envie até 5.000 produtos por planilha.");
  const dados = linhas.map((l) => ({ ...dadosDaLinha(l), estoque: atualizarEstoque ? l.estoque : null }));
  const { data, error } = await ctx.supabase.rpc("gestao_importar_produtos", { p_empresa_id: empresaId, p_linhas: dados as never });
  if (error) return falha(mensagemErro(error));
  const r = data as { novos: number; atualizados: number; estoque: number };
  revalidatePath(`/e/${empresaId}/loja`, "layout");
  return sucesso(
    `Planilha importada: ${r.novos} produto(s) novo(s), ${r.atualizados} atualizado(s)${atualizarEstoque ? ` e o estoque de ${r.estoque} acertado` : ""}.`,
  );
}
