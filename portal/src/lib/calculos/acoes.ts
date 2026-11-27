"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { lerValorBR } from "@/lib/dinheiro";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

function marcado(fd: FormData, nome: string) {
  return fd.get(nome) === "on";
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/calculos`, "layout");
}

/** Percentual digitado ("8", "8,5", "1,6") dentro do intervalo. */
function percentual(fd: FormData, nome: string, min: number, max: number): number | null {
  const v = lerValorBR(texto(fd, nome));
  if (!v || v.lt(min) || v.gt(max)) return null;
  return Number(v.toFixed(4));
}

// -----------------------------------------------------------------------------
// Parâmetros da empresa (somente equipe)
// -----------------------------------------------------------------------------
export async function salvarParametros(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const erros: Record<string, string[]> = {};
  const inicio = texto(fd, "inicio_atividade");
  if (inicio && !DATA.test(inicio)) erros.inicio_atividade = ["Data inválida."];
  const mei = texto(fd, "mei_atividade");
  if (mei && !["comercio_industria", "servicos", "comercio_servicos", "caminhoneiro"].includes(mei)) erros.mei_atividade = ["Atividade inválida."];
  const anexoMerc = texto(fd, "anexo_mercadorias") || "I";
  const anexoServ = texto(fd, "anexo_servicos") || "III";
  if (!["I", "II"].includes(anexoMerc)) erros.anexo_mercadorias = ["Escolha o Anexo I ou II."];
  if (!["III", "IV", "V"].includes(anexoServ)) erros.anexo_servicos = ["Escolha o Anexo III, IV ou V."];
  const pres: Record<string, number | null> = {};
  for (const c of ["presuncao_irpj_mercadorias", "presuncao_irpj_servicos", "presuncao_csll_mercadorias", "presuncao_csll_servicos"]) {
    pres[c] = percentual(fd, c, 0, 100);
    if (pres[c] === null) erros[c] = ["Informe um percentual entre 0 e 100."];
  }
  const issTexto = texto(fd, "aliquota_iss");
  const iss = issTexto ? percentual(fd, "aliquota_iss", 0, 5) : null;
  if (issTexto && iss === null) erros.aliquota_iss = ["A alíquota do ISS vai de 0% a 5%."];
  const rat = Number(texto(fd, "rat") || "2");
  if (![1, 2, 3].includes(rat)) erros.rat = ["O RAT é 1%, 2% ou 3%."];
  const fap = percentual(fd, "fap", 0.5, 2);
  if (fap === null) erros.fap = ["O FAP vai de 0,5000 a 2,0000."];
  const terceiros = percentual(fd, "terceiros", 0, 10);
  if (terceiros === null) erros.terceiros = ["Informe um percentual entre 0 e 10."];
  const proLabore = lerValorBR(texto(fd, "pro_labore") || "0");
  if (!proLabore || proLabore.lt(0)) erros.pro_labore = ["Valor inválido."];
  const socios = Number(texto(fd, "socios_pro_labore") || "1");
  if (!Number.isInteger(socios) || socios < 1 || socios > 50) erros.socios_pro_labore = ["Informe de 1 a 50 sócios."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const { error } = await ctx.supabase.from("calculo_parametros").upsert({
    empresa_id: empresaId,
    inicio_atividade: inicio || null,
    mei_atividade: (mei || null) as never,
    anexo_mercadorias: anexoMerc,
    anexo_servicos: anexoServ,
    fator_r: marcado(fd, "fator_r"),
    presuncao_irpj_mercadorias: pres.presuncao_irpj_mercadorias!,
    presuncao_irpj_servicos: pres.presuncao_irpj_servicos!,
    presuncao_csll_mercadorias: pres.presuncao_csll_mercadorias!,
    presuncao_csll_servicos: pres.presuncao_csll_servicos!,
    acrescimo_lc224: marcado(fd, "acrescimo_lc224"),
    creditos_pis_cofins: marcado(fd, "creditos_pis_cofins"),
    aliquota_iss: iss,
    calcular_icms: marcado(fd, "calcular_icms"),
    calcular_ipi: marcado(fd, "calcular_ipi"),
    rat,
    fap: fap!,
    terceiros: terceiros!,
    pro_labore: Number(proLabore!.toFixed(2)),
    socios_pro_labore: socios,
    atualizado_por: ctx.sessao.usuarioId,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Configuração dos cálculos salva.");
}

// -----------------------------------------------------------------------------
// Receita e folha informadas no mês
// -----------------------------------------------------------------------------
export async function salvarMes(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Competência inválida.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const valores: Record<string, number | null> = {};
  const erros: Record<string, string[]> = {};
  for (const c of ["receita_mercadorias", "receita_servicos", "folha_fator_r"]) {
    const t = texto(fd, c);
    if (!t) {
      valores[c] = null;
      continue;
    }
    const v = lerValorBR(t);
    if (!v || v.lt(0)) erros[c] = ["Valor inválido."];
    else valores[c] = Number(v.toFixed(2));
  }
  if (Object.keys(erros).length) return falha("Revise os valores.", erros);
  const observacao = texto(fd, "observacao").slice(0, 500) || null;
  if (Object.values(valores).every((v) => v === null)) {
    const { error } = await ctx.supabase.from("calculo_meses").delete().eq("empresa_id", empresaId).eq("competencia", comp);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Valores informados removidos: o mês volta a usar as notas fiscais.");
  }
  const { error } = await ctx.supabase.from("calculo_meses").upsert({
    empresa_id: empresaId,
    competencia: comp,
    receita_mercadorias: valores.receita_mercadorias,
    receita_servicos: valores.receita_servicos,
    folha_fator_r: valores.folha_fator_r,
    observacao,
    atualizado_por: ctx.sessao.usuarioId,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Valores do mês salvos.");
}

// -----------------------------------------------------------------------------
// Ajustes da previsão (valores lançados pelo escritório)
// -----------------------------------------------------------------------------
export async function adicionarAjuste(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Competência inválida.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const descricao = texto(fd, "descricao");
  const valor = lerValorBR(texto(fd, "valor"));
  const erros: Record<string, string[]> = {};
  if (descricao.length < 3 || descricao.length > 120) erros.descricao = ["Descreva o valor (3 a 120 caracteres)."];
  if (!valor || valor.isZero()) erros.valor = ["Informe o valor (negativo para reduzir)."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await ctx.supabase.from("calculo_ajustes").insert({
    empresa_id: empresaId,
    competencia: comp,
    descricao,
    valor: Number(valor!.toFixed(2)),
    observacao: texto(fd, "observacao").slice(0, 500) || null,
    criado_por: ctx.sessao.usuarioId,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Valor lançado na previsão.");
}

export async function removerAjuste(empresaId: string, ajusteId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(ajusteId)) return falha("Lançamento inválido.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const { error, count } = await ctx.supabase.from("calculo_ajustes").delete({ count: "exact" }).eq("id", ajusteId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Lançamento não encontrado.");
  revalidar(empresaId);
  return sucesso("Lançamento removido.");
}

// -----------------------------------------------------------------------------
// Colaboradores
// -----------------------------------------------------------------------------
export async function salvarColaborador(empresaId: string, colaboradorId: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || (colaboradorId && !UUID.test(colaboradorId))) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "colaboradores.gerenciar");
  const erros: Record<string, string[]> = {};
  const nome = texto(fd, "nome");
  if (nome.length < 2 || nome.length > 120) erros.nome = ["Informe o nome."];
  const cargo = texto(fd, "cargo").slice(0, 80) || null;
  const admissao = texto(fd, "admissao");
  if (!DATA.test(admissao)) erros.admissao = ["Informe a data de admissão."];
  const desligamento = texto(fd, "desligamento") || null;
  if (desligamento && (!DATA.test(desligamento) || desligamento < admissao)) erros.desligamento = ["A saída precisa ser depois da admissão."];
  const contrato = texto(fd, "contrato") || "indeterminado";
  if (!["indeterminado", "experiencia", "determinado"].includes(contrato)) erros.contrato = ["Tipo de contrato inválido."];
  const fim = texto(fd, "fim_contrato") || null;
  if (contrato !== "indeterminado" && (!fim || !DATA.test(fim) || fim < admissao)) erros.fim_contrato = ["Informe a data prevista para o fim do contrato."];
  const salario = lerValorBR(texto(fd, "salario"));
  if (!salario || salario.lte(0)) erros.salario = ["Informe o salário."];
  const adicionais = lerValorBR(texto(fd, "adicionais") || "0");
  if (!adicionais || adicionais.lt(0)) erros.adicionais = ["Valor inválido."];
  const dependentes = Number(texto(fd, "dependentes_ir") || "0");
  if (!Number.isInteger(dependentes) || dependentes < 0 || dependentes > 20) erros.dependentes_ir = ["De 0 a 20."];
  const ferias = Number(texto(fd, "ferias_vencidas") || "0");
  if (![0, 1, 2].includes(ferias)) erros.ferias_vencidas = ["De 0 a 2 períodos."];
  const saldoTexto = texto(fd, "saldo_fgts");
  const saldo = saldoTexto ? lerValorBR(saldoTexto) : null;
  if (saldoTexto && (!saldo || saldo.lt(0))) erros.saldo_fgts = ["Valor inválido."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const registro = {
    empresa_id: empresaId,
    nome,
    cargo,
    admissao,
    desligamento,
    contrato,
    fim_contrato: contrato === "indeterminado" ? null : fim,
    salario: Number(salario!.toFixed(2)),
    adicionais: Number(adicionais!.toFixed(2)),
    dependentes_ir: dependentes,
    ferias_vencidas: ferias,
    saldo_fgts: saldo ? Number(saldo.toFixed(2)) : null,
    observacao: texto(fd, "observacao").slice(0, 500) || null,
  };
  const { error } = colaboradorId
    ? await ctx.supabase.from("colaboradores").update(registro).eq("id", colaboradorId).eq("empresa_id", empresaId)
    : await ctx.supabase.from("colaboradores").insert({ ...registro, criado_por: ctx.sessao.usuarioId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(colaboradorId ? "Colaborador atualizado." : "Colaborador cadastrado.");
}

export async function excluirColaborador(empresaId: string, colaboradorId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(colaboradorId)) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "colaboradores.gerenciar");
  const { error, count } = await ctx.supabase.from("colaboradores").delete({ count: "exact" }).eq("id", colaboradorId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Colaborador não encontrado.");
  revalidar(empresaId);
  return sucesso("Colaborador excluído.");
}
