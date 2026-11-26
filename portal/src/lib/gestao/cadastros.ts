"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { consultarCnpjReceita, ErroConsultaCnpj } from "@/lib/empresas/receita";
import { validarCnpj, validarCpf } from "@/lib/formatos";

/**
 * Clientes e fornecedores pela loja. O cadastro é o mesmo do Financeiro; o
 * banco confere a permissão e a empresa de novo em cada operação.
 */

export type PapelCadastro = "cliente" | "fornecedor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(fd: FormData, campo: string, max = 200) {
  return String(fd.get(campo) ?? "").trim().slice(0, max);
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/loja`, "layout");
  revalidatePath(`/e/${empresaId}/financeiro/cadastros`);
}

export async function salvarCadastroLoja(
  empresaId: string,
  papel: PapelCadastro,
  id: string | null,
  _a: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao<{ id: string }>> {
  if (!UUID.test(empresaId) || (id && !UUID.test(id)) || !["cliente", "fornecedor"].includes(papel)) return falha("Cadastro inválido.");
  const ctx = await exigirPermissao(empresaId, papel === "fornecedor" || id ? "gestao.gerenciar" : "gestao.vender");
  const erros: Record<string, string[]> = {};
  const nome = texto(fd, "nome", 120);
  if (nome.length < 2) erros.nome = ["Informe o nome."];
  const documento = texto(fd, "documento", 20).replace(/\D/g, "");
  if (documento && !((documento.length === 11 && validarCpf(documento)) || (documento.length === 14 && validarCnpj(documento)))) {
    erros.documento = ["CPF ou CNPJ inválido. Confira os números."];
  }
  const telefone = texto(fd, "telefone", 30).replace(/\D/g, "");
  if (telefone && (telefone.length < 10 || telefone.length > 13)) erros.telefone = ["Informe o DDD e o número."];
  const email = texto(fd, "email", 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.email = ["E-mail inválido."];
  const cep = texto(fd, "cep", 10).replace(/\D/g, "");
  if (cep && cep.length !== 8) erros.cep = ["O CEP tem 8 números."];
  const prazo = texto(fd, "prazo_pagamento_dias", 4);
  if (prazo && !(/^\d+$/.test(prazo) && Number(prazo) <= 365)) erros.prazo_pagamento_dias = ["Dias de 0 a 365."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const { data, error } = await ctx.supabase.rpc("gestao_contraparte_salvar", {
    p_empresa_id: empresaId,
    p_id: (id ?? null) as unknown as string,
    p_dados: {
      papel,
      nome,
      documento,
      telefone,
      email,
      cep,
      logradouro: texto(fd, "logradouro", 60),
      numero: texto(fd, "numero", 60),
      complemento: texto(fd, "complemento", 60),
      bairro: texto(fd, "bairro", 60),
      municipio_ibge: texto(fd, "municipio_ibge", 7),
      inscricao_estadual: texto(fd, "inscricao_estadual", 20),
      contato: texto(fd, "contato", 80),
      prazo_pagamento_dias: prazo,
      observacoes: texto(fd, "observacoes", 1000),
      ativo: id ? fd.get("ativo") !== "off" : true,
    },
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  const quem = papel === "cliente" ? "Cliente" : "Fornecedor";
  return sucesso(id ? `${quem} atualizado.` : `${quem} cadastrado.`, { id: data as string });
}

export async function ativarCadastroLoja(empresaId: string, id: string, ativo: boolean): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(id)) return falha("Cadastro inválido.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const { error } = await ctx.supabase.rpc("gestao_contraparte_ativar", { p_empresa_id: empresaId, p_id: id, p_ativo: ativo });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(ativo ? "Cadastro reativado." : "Cadastro desativado. O histórico continua guardado.");
}

export async function trazerFornecedoresDasNotas(empresaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const { data, error } = await ctx.supabase.rpc("gestao_fornecedores_das_notas", { p_empresa_id: empresaId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  const n = Number(data ?? 0);
  return sucesso(
    n === 0
      ? "Nenhum fornecedor novo: os emitentes das notas de compra já estão no cadastro."
      : `${n} fornecedor${n > 1 ? "es" : ""} trazido${n > 1 ? "s" : ""} das notas de compra.`,
  );
}

export interface DadosCnpj {
  nome: string;
  email: string | null;
  telefone: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio_ibge: string | null;
  uf: string | null;
  cep: string | null;
}

/** Dados públicos do CNPJ (Receita Federal), para não digitar o endereço. */
export async function buscarCnpjCadastro(empresaId: string, cnpj: string): Promise<ResultadoAcao<DadosCnpj>> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  await exigirPermissao(empresaId, "gestao.vender");
  const doc = cnpj.replace(/\D/g, "");
  if (doc.length !== 14 || !validarCnpj(doc)) return falha("Informe um CNPJ válido (14 números).");
  try {
    const r = await consultarCnpjReceita(doc);
    return sucesso("Dados preenchidos pela Receita. Confira e informe a inscrição estadual, se tiver.", {
      nome: r.razaoSocial.slice(0, 120),
      email: r.email,
      telefone: r.telefones[0] ?? null,
      logradouro: r.endereco.logradouro,
      numero: r.endereco.numero,
      complemento: r.endereco.complemento,
      bairro: r.endereco.bairro,
      municipio_ibge: r.endereco.codigoIbge,
      uf: r.endereco.uf,
      cep: r.endereco.cep,
    });
  } catch (e) {
    return falha(e instanceof ErroConsultaCnpj ? e.message : "Não foi possível consultar a Receita agora. Preencha os dados à mão.");
  }
}

/** Municípios de uma UF (tabela do IBGE), para o endereço. */
export async function municipiosCadastro(empresaId: string, uf: string): Promise<{ ibge: string; nome: string }[]> {
  if (!UUID.test(empresaId) || !/^[A-Z]{2}$/.test(uf)) return [];
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  const { data } = await ctx.supabase.from("municipios").select("ibge, nome").eq("uf", uf).order("nome").limit(1000);
  return data ?? [];
}
