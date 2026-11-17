"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envServidor } from "@/lib/env-servidor";
import { cifrar } from "@/lib/notas-automaticas/cripto";
import { ErroCertificado, TAMANHO_MAXIMO_CERTIFICADO, lerCertificadoA1 } from "@/lib/notas-automaticas/certificado";
import { assinarCms } from "./cms";

/**
 * Certificado A1 do escritório para assinar os recibos (só administrador).
 * O arquivo é aberto aqui, com a senha, só para conferir e extrair a chave e
 * o certificado; a senha não é guardada. O banco recebe o conteúdo já
 * cifrado com a chave do servidor e confere se é do escritório ou do contador.
 */
export async function cadastrarCertificadoEscritorio(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (!envServidor.certificadosChave()) {
    return falha("O cadastro de certificados ainda não foi ativado no servidor do portal (falta a chave de criptografia CERTIFICADOS_CHAVE).");
  }
  const arquivo = fd.get("arquivo");
  const senha = String(fd.get("senha") ?? "");
  const erros: Record<string, string[]> = {};
  if (!(arquivo instanceof File) || arquivo.size === 0) erros.arquivo = ["Escolha o arquivo do certificado (.pfx ou .p12)."];
  else if (!/\.(pfx|p12)$/i.test(arquivo.name)) erros.arquivo = ["O certificado A1 é um arquivo .pfx ou .p12 (o A3, em cartão ou token, não serve para assinar pelo portal)."];
  else if (arquivo.size > TAMANHO_MAXIMO_CERTIFICADO) erros.arquivo = ["Arquivo grande demais para um certificado A1."];
  if (!senha) erros.senha = ["Informe a senha do certificado."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  let lido;
  try {
    lido = lerCertificadoA1(new Uint8Array(await (arquivo as File).arrayBuffer()), senha);
  } catch (e) {
    if (e instanceof ErroCertificado) return falha(e.message, e.message.includes("Senha") ? { senha: [e.message] } : { arquivo: [e.message] });
    return falha("Não foi possível ler o certificado.");
  }
  if (!lido.documento) return falha("Este arquivo não traz CNPJ nem CPF. Use o e-CNPJ do escritório ou o e-CPF do contador.", { arquivo: ["Certificado sem CNPJ ou CPF."] });
  const credencial = { chave: lido.chavePem, certificados: [lido.certificadoPem, ...lido.cadeiaPem] };
  try {
    assinarCms(Buffer.from("teste de assinatura"), credencial); // confere que a chave assina no padrão exigido
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Este certificado não serve para assinar.", { arquivo: ["Certificado não serve para assinar."] });
  }

  const { error } = await s.supabase.rpc("escritorio_certificado_definir", {
    p_titular: lido.titular,
    p_documento: lido.documento,
    p_emissor: lido.emissor,
    p_numero_serie: lido.numeroSerie,
    p_impressao_digital: lido.impressaoDigital,
    p_valido_de: lido.validoDe.toISOString(),
    p_valido_ate: lido.validoAte.toISOString(),
    p_conteudo_cifrado: cifrar(JSON.stringify(credencial)),
  });
  if (error) return falha(mensagemErro(error), { arquivo: [mensagemErro(error)] });
  revalidatePath("/escritorio/configuracoes");
  revalidatePath("/escritorio/recibos");
  return sucesso("Certificado cadastrado. Os próximos recibos já saem assinados digitalmente.");
}

export async function removerCertificadoEscritorio(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { error } = await s.supabase.rpc("escritorio_certificado_remover");
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/configuracoes");
  revalidatePath("/escritorio/recibos");
  return sucesso("Certificado removido e apagado do portal. Os próximos recibos saem sem assinatura digital.");
}
