"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { VERSAO_LEITURA } from "@/lib/fiscal/xml";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { carregarEfd } from "./carregar";
import { gerarEfd } from "./gerar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, nome: string) => String(fd.get(nome) ?? "").trim();

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/calculos`, "layout");
}

/**
 * Gera o arquivo da EFD ICMS/IPI do mês e guarda no armazenamento privado. A
 * equipe baixa, valida e assina no PVA da Receita: o portal não transmite.
 */
export async function gerarArquivoEfd(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const finalidade = texto(fd, "finalidade") === "1" ? 1 : 0;
  const vencimento = texto(fd, "vencimento");
  if (vencimento && !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return falha("Data de vencimento inválida.", { vencimento: ["Use uma data válida."] });
  const confirmadas = fd.getAll("confirmar").map(String).filter((x) => /^[a-z_]{2,40}$/.test(x));
  const carregado = await carregarEfd(ctx.supabase, empresaId, comp);
  if ("erro" in carregado) return falha(carregado.erro);
  const r = gerarEfd(carregado.dados, carregado.icms, { finalidade, vencimento: vencimento || null, confirmadas });
  if (!r.conteudo) {
    const pendentes = r.pendencias.filter((p) => p.nivel === "bloqueio" || (p.nivel === "confirmar" && !confirmadas.includes(p.id)));
    return falha(
      pendentes.length === 1 ? `Antes de gerar: ${pendentes[0].titulo}.` : `Antes de gerar, resolva ou confirme ${pendentes.length} pendências (veja a lista acima).`,
    );
  }
  const bytes = Buffer.from(r.conteudo, "latin1");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: registro, error } = await ctx.supabase.rpc("efd_registrar_geracao", {
    p_empresa_id: empresaId,
    p_competencia: comp,
    p_dados: {
      finalidade,
      nome_arquivo: r.nomeArquivo,
      sha256,
      tamanho: bytes.length,
      linhas: r.resumo.linhas,
      resumo: r.resumo,
      avisos: r.pendencias.filter((p) => p.nivel !== "bloqueio").map((p) => ({ id: p.id, titulo: p.titulo })),
    } as never,
  });
  if (error || !registro) return falha(mensagemErro(error));
  const { id, caminho } = registro as { id: string; caminho: string };
  // O banco já conferiu a permissão e definiu o caminho: o servidor grava o arquivo no armazenamento privado
  const admin = criarClienteAdmin();
  const { error: erroEnvio } = await admin.storage.from("efd").upload(caminho, bytes, { contentType: "text/plain", upsert: false });
  if (erroEnvio) {
    await admin.from("efd_geracoes").delete().eq("id", id);
    return falha(`Não foi possível guardar o arquivo: ${erroEnvio.message}`);
  }
  revalidar(empresaId);
  return sucesso(`Arquivo gerado: ${r.resumo.linhas} linhas. Baixe, valide e assine no PVA da EFD ICMS/IPI antes de transmitir.`, { id });
}

/** Perfil e código de receita do ICMS (E116), guardados por empresa. */
export async function salvarConfiguracaoEfd(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const perfil = texto(fd, "perfil").toUpperCase() || "A";
  const codigo = texto(fd, "codigo_receita");
  const pctTexto = texto(fd, "credito_presumido_cte").replace(",", ".");
  const ajuste = texto(fd, "credito_presumido_codigo").toUpperCase().replace(/[\s.\-]/g, "");
  if (!["A", "B", "C"].includes(perfil)) return falha("Perfil inválido.", { perfil: ["Escolha o perfil."] });
  if (codigo && !/^\d[\d.\-]{0,19}$/.test(codigo)) {
    return falha("Código de receita inválido.", { codigo_receita: ["Use só números: o código da guia do ICMS no estado (ex.: 1112). “E116” é o nome do registro, não o código."] });
  }
  const pct = pctTexto ? Number(pctTexto) : null;
  if (pctTexto && (!Number.isFinite(pct) || pct! <= 0 || pct! > 100)) {
    return falha("Percentual inválido.", { credito_presumido_cte: ["Informe de 0,01 a 100 (ex.: 20)."] });
  }
  if (ajuste && !/^[A-Z]{2}\d{8}$/.test(ajuste)) return falha("Código do ajuste inválido.", { credito_presumido_codigo: ["10 caracteres: UF + 8 números (ex.: MT10001003)."] });
  if (Boolean(pct) !== Boolean(ajuste)) {
    return falha("Informe o percentual e o código do ajuste (ou deixe os dois vazios).", { credito_presumido_codigo: ["Preencha os dois campos ou nenhum."] });
  }
  const { error } = await ctx.supabase.rpc("efd_salvar_configuracao", {
    p_empresa_id: empresaId,
    p_dados: { perfil, codigo_receita: codigo || null, credito_presumido_cte: pct, credito_presumido_codigo: ajuste || null } as never,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Configuração da EFD salva.");
}

/** Código de ajuste da tabela 5.1.1 (registro E111) de um lançamento da apuração. */
export async function definirCodigoAjuste(empresaId: string, lancamentoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(lancamentoId)) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const codigo = texto(fd, "codigo").toUpperCase().replace(/[\s.\-]/g, "");
  if (codigo && !/^[A-Z]{2}0[0-5]\d{4}$/.test(codigo)) {
    return falha("Código de ajuste inválido.", { codigo: ["8 caracteres: UF + 0 + tipo + 4 números (ex.: MT020001)."] });
  }
  const { error } = await ctx.supabase.rpc("icms_definir_codigo_ajuste", { p_lancamento_id: lancamentoId, p_codigo: codigo || (null as never) });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(codigo ? `Código ${codigo} gravado.` : "Código removido.");
}

/** Relê os XML do mês para gravar o que a EFD precisa (endereços, municípios, frete, CT-e). */
export async function relerNotasEfd(empresaId: string, competencia: string): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const { data, error } = await ctx.supabase.rpc("efd_reler_notas", { p_empresa_id: empresaId, p_competencia: comp, p_versao_leitura: VERSAO_LEITURA });
  if (error) return falha(mensagemErro(error));
  if (!data) return sucesso("Todas as notas do mês já estão com a leitura atual.");
  processarFilaDepois({ tipos: ["reler_notas_mes"] });
  revalidar(empresaId);
  return sucesso(`Releitura de ${data} ${data === 1 ? "nota" : "notas"} iniciada. Em instantes, atualize a página.`);
}
