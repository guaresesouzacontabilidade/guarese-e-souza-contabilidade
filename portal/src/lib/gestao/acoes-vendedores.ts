"use server";

import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { atualizarTelasDaEmpresa } from "@/lib/atualizar-telas";
import { formatarMoeda } from "@/lib/dinheiro";

const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

async function contexto(empresaId: string, permissao: "gestao.gerenciar" | "gestao.vender") {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode(permissao)) throw new Error("Você não tem permissão para esta operação na loja.");
  return ctx;
}

const esquemaVendedor = z.object({
  id: z.string().regex(UUID).optional().or(z.literal("").transform(() => undefined)),
  nome: z.string().trim().min(2, "Informe o nome do vendedor.").max(80, "Nome muito longo."),
  comissao: z
    .string()
    .trim()
    .transform((v) => (v === "" ? "0" : v.replace(",", ".")))
    .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100, "Comissão entre 0 e 100%, com até 2 casas (ex.: 2,5)."),
  usuario_id: z.string().regex(UUID).optional().or(z.literal("").transform(() => undefined)),
  ativo: z.boolean(),
});

/** Cadastra ou altera um vendedor (nome, comissão em %, login ligado e ativo). */
export async function salvarVendedor(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "gestao.gerenciar");
    const d = esquemaVendedor.safeParse({
      id: String(fd.get("id") ?? ""),
      nome: String(fd.get("nome") ?? ""),
      comissao: String(fd.get("comissao") ?? ""),
      usuario_id: String(fd.get("usuario_id") ?? ""),
      ativo: fd.get("ativo") === "on" || fd.get("ativo") === "true",
    });
    if (!d.success) return falhaValidacao(d.error);
    const linha = { nome: d.data.nome, comissao_percentual: Number(d.data.comissao), usuario_id: d.data.usuario_id ?? null, ativo: d.data.ativo };
    const { error } = d.data.id
      ? await ctx.supabase.from("loja_vendedores").update(linha).eq("id", d.data.id).eq("empresa_id", empresaId)
      : await ctx.supabase.from("loja_vendedores").insert({ ...linha, empresa_id: empresaId });
    if (error) {
      if (error.code === "23505") return falha(error.message.includes("usuario") ? "Esse login já está ligado a outro vendedor." : "Já existe um vendedor com esse nome.");
      return falha(mensagemErro(error));
    }
    atualizarTelasDaEmpresa(empresaId);
    return sucesso(d.data.id ? "Vendedor atualizado." : "Vendedor cadastrado.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Exclui o vendedor que ainda não tem vendas; com vendas, só desativa (o histórico fica). */
export async function excluirVendedor(empresaId: string, vendedorId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "gestao.gerenciar");
    if (!UUID.test(vendedorId)) return falha("Vendedor inválido.");
    const { error } = await ctx.supabase.from("loja_vendedores").delete().eq("id", vendedorId).eq("empresa_id", empresaId);
    if (error) {
      if (error.code === "23503") {
        const { error: e2 } = await ctx.supabase.from("loja_vendedores").update({ ativo: false }).eq("id", vendedorId).eq("empresa_id", empresaId);
        if (e2) return falha(mensagemErro(e2));
        atualizarTelasDaEmpresa(empresaId);
        return sucesso("Este vendedor já tem vendas: ele foi desativado e o histórico continua.");
      }
      return falha(mensagemErro(error));
    }
    atualizarTelasDaEmpresa(empresaId);
    return sucesso("Vendedor excluído.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Liga ou desliga "exigir o vendedor em todo orçamento e venda". */
export async function definirVendedorObrigatorio(empresaId: string, obrigatorio: boolean): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "gestao.gerenciar");
    const { error } = await ctx.supabase.rpc("loja_vendedor_obrigatorio_definir", { p_empresa_id: empresaId, p_obrigatorio: obrigatorio });
    if (error) return falha(mensagemErro(error));
    atualizarTelasDaEmpresa(empresaId);
    return sucesso(obrigatorio ? "Agora todo orçamento e venda pede o vendedor." : "O vendedor passa a ser opcional.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Troca o vendedor de uma venda ou orçamento (quem gerencia a loja; com motivo, fica no histórico). */
export async function trocarVendedor(empresaId: string, vendaId: string, vendedorId: string, motivo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "gestao.gerenciar");
    if (!UUID.test(vendaId) || !UUID.test(vendedorId)) return falha("Escolha o vendedor.");
    if (motivo.trim().length < 3) return falha("Explique o motivo da troca.");
    const { error } = await ctx.supabase.rpc("loja_venda_trocar_vendedor", { p_venda_id: vendaId, p_vendedor_id: vendedorId, p_motivo: motivo.trim() });
    if (error) return falha(mensagemErro(error));
    atualizarTelasDaEmpresa(empresaId);
    return sucesso("Vendedor trocado. A troca ficou no histórico da venda.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Lança no Contas a pagar as comissões ainda não lançadas das vendas do período (um título por vendedor). */
export async function lancarComissoes(
  empresaId: string,
  dados: { inicio: string; fim: string; vencimento: string; categoria: string },
): Promise<ResultadoAcao<{ lancamentos: number; total: number }>> {
  try {
    const ctx = await contexto(empresaId, "gestao.gerenciar");
    if (!ctx.pode("financeiro.editar")) return falha("Para lançar no Contas a pagar, é preciso também poder editar o financeiro.");
    if (!DATA.test(dados.inicio) || !DATA.test(dados.fim) || !DATA.test(dados.vencimento)) return falha("Informe o período e o vencimento.");
    if (!UUID.test(dados.categoria)) return falha("Escolha a conta de despesa das comissões.");
    const { data, error } = await ctx.supabase.rpc("loja_comissoes_lancar", {
      p_empresa_id: empresaId,
      p_inicio: dados.inicio,
      p_fim: dados.fim,
      p_vencimento: dados.vencimento,
      p_categoria_id: dados.categoria,
    });
    if (error) return falha(mensagemErro(error));
    const r = data as { lancamentos: number; total: number };
    atualizarTelasDaEmpresa(empresaId);
    if (!r.lancamentos) return sucesso("Não havia comissão para lançar nesse período (ou já foi lançada).", { lancamentos: 0, total: 0 });
    return sucesso(`${r.lancamentos} conta(s) a pagar criada(s), somando ${formatarMoeda(r.total)}.`, { lancamentos: r.lancamentos, total: Number(r.total) });
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
