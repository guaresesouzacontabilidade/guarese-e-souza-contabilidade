"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envServidor } from "@/lib/env-servidor";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { ErroCertificado, TAMANHO_MAXIMO_CERTIFICADO, lerCertificadoA1, mesmaEmpresa } from "./certificado";
import { cifrar } from "./cripto";
import { AUTORIZACAO_CLIENTE, AUTORIZACAO_ESCRITORIO } from "./rotulos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/notas-automaticas`);
  revalidatePath("/escritorio/notas-automaticas");
  revalidatePath(`/e/${empresaId}/vencimentos`);
}

// Cadastro e remoção não revalidam na própria resposta: o formulário some da
// tela quando o certificado entra ou sai, e a confirmação precisa aparecer antes
// (o formulário atualiza a página logo depois de mostrar a mensagem).

async function contexto(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  return ctx.pode("certificado.gerenciar") ? ctx : null;
}

/**
 * Cadastro do certificado A1: o arquivo é aberto aqui, com a senha, só para
 * conferir e extrair a chave e o certificado; a senha não é guardada. O que
 * vai ao banco segue cifrado com a chave do servidor.
 */
export async function cadastrarCertificado(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite cadastrar o certificado desta empresa.");
  if (!envServidor.certificadosChave()) {
    return falha("O cadastro de certificados ainda não foi ativado no servidor do portal (falta a chave de criptografia). Fale com o administrador.");
  }
  const arquivo = fd.get("arquivo");
  const senha = String(fd.get("senha") ?? "");
  const erros: Record<string, string[]> = {};
  if (!(arquivo instanceof File) || arquivo.size === 0) erros.arquivo = ["Escolha o arquivo do certificado (.pfx ou .p12)."];
  else if (!/\.(pfx|p12)$/i.test(arquivo.name)) erros.arquivo = ["O certificado A1 é um arquivo .pfx ou .p12."];
  else if (arquivo.size > TAMANHO_MAXIMO_CERTIFICADO) erros.arquivo = ["Arquivo grande demais para um certificado A1."];
  if (!senha) erros.senha = ["Informe a senha do certificado."];
  if (fd.get("autorizacao") !== "on") erros.autorizacao = ["Confirme a autorização para usar o certificado."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  let lido;
  try {
    lido = lerCertificadoA1(new Uint8Array(await (arquivo as File).arrayBuffer()), senha);
  } catch (e) {
    if (e instanceof ErroCertificado) return falha(e.message, e.message.includes("Senha") ? { senha: [e.message] } : { arquivo: [e.message] });
    return falha("Não foi possível ler o certificado.");
  }
  if (!lido.documento) return falha("Use o certificado e-CNPJ (A1) da empresa: este arquivo não traz um CNPJ.", { arquivo: ["Certificado sem CNPJ (e-CPF?)."] });
  const { data: empresa } = await ctx.supabase.from("empresas").select("documento").eq("id", empresaId).single();
  if (!mesmaEmpresa(lido.documento, empresa?.documento)) {
    return falha("Este certificado é de outro CNPJ. Use o certificado da própria empresa.", { arquivo: ["CNPJ do certificado diferente do da empresa."] });
  }

  const { error } = await ctx.supabase.rpc("registrar_certificado", {
    p_empresa_id: empresaId,
    p_titular: lido.titular,
    p_documento: lido.documento,
    p_emissor: lido.emissor,
    p_numero_serie: lido.numeroSerie,
    p_impressao_digital: lido.impressaoDigital,
    p_valido_de: lido.validoDe.toISOString(),
    p_valido_ate: lido.validoAte.toISOString(),
    p_autorizacao_texto: ctx.equipe ? AUTORIZACAO_ESCRITORIO : AUTORIZACAO_CLIENTE,
    p_conteudo_cifrado: cifrar(JSON.stringify({ chave: lido.chavePem, certificados: [lido.certificadoPem, ...lido.cadeiaPem] })),
  });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["notas_automaticas", "processar_documento"] });
  return sucesso("Certificado cadastrado. A primeira busca começa em instantes.");
}

export async function removerCertificado(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite remover o certificado desta empresa.");
  const motivo = String(fd.get("motivo") ?? "").trim().slice(0, 500);
  const { error } = await ctx.supabase.rpc("revogar_certificado", { p_empresa_id: empresaId, p_motivo: motivo || (null as unknown as string) });
  if (error) return falha(mensagemErro(error));
  return sucesso("Certificado removido. A busca automática foi desligada e o certificado guardado foi apagado.");
}

export async function salvarPreferenciasNotas(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite alterar a busca automática desta empresa.");
  const { error } = await ctx.supabase.rpc("salvar_notas_automaticas", {
    p_empresa_id: empresaId,
    p_nfe: fd.get("nfe") === "on",
    p_nfse: fd.get("nfse") === "on",
    p_ciencia: fd.get("ciencia") === "on",
    p_pausada: fd.get("pausada") === "on",
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Preferências salvas.");
}

export async function buscarNotasAgora(empresaId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite iniciar a busca.");
  const { error } = await ctx.supabase.rpc("buscar_notas_agora", { p_empresa_id: empresaId });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["notas_automaticas", "processar_documento"] });
  revalidar(empresaId);
  return sucesso("Busca iniciada. Os resultados aparecem no histórico em alguns instantes.");
}
