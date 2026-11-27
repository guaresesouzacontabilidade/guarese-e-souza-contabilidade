"use server";

import { createPrivateKey, X509Certificate } from "node:crypto";
import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envPublico } from "@/lib/env";
import { cifrar } from "@/lib/notas-automaticas/cripto";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirHonorarios } from "./acesso";
import { conexaoDoBanco, conferirNoBanco, criarNoBanco } from "./banco";
import { registrarWebhook, testarConexao } from "./sicredi-api";

const BASE = "/escritorio/honorarios";
const texto = (fd: FormData, campo: string, max = 500) => String(fd.get(campo) ?? "").trim().slice(0, max);

async function lerArquivo(fd: FormData, campo: string): Promise<Buffer | null> {
  const f = fd.get(campo);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > 100_000) throw new Error("Arquivo grande demais para um certificado.");
  return Buffer.from(await f.arrayBuffer());
}

/**
 * Administrador: guarda as credenciais da API Pix do Sicredi (Client ID,
 * Client Secret, certificado assinado pelo Sicredi e chave privada), cifradas.
 * Confere se a chave combina com o certificado e a validade.
 */
export async function salvarCredenciaisSicredi(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  await exigirAdmin();
  const ambiente = texto(fd, "ambiente") === "homologacao" ? "homologacao" : "producao";
  const clientId = texto(fd, "client_id", 300);
  const clientSecret = texto(fd, "client_secret", 500);
  const urlToken = texto(fd, "url_token", 300);
  const urlApi = texto(fd, "url_api", 300);
  const erros: Record<string, string[]> = {};
  if (clientId.length < 4) erros.client_id = ["Informe o Client ID gerado no Portal do Desenvolvedor do Sicredi."];
  if (clientSecret.length < 4) erros.client_secret = ["Informe o Client Secret."];
  if (ambiente === "homologacao" && (!/^https:\/\//.test(urlToken) || !/^https:\/\//.test(urlApi))) erros.url_api = ["Na homologação, informe os endereços passados pelo Sicredi."];
  let certificado = "";
  let chave = "";
  let validade: Date | null = null;
  try {
    const certBuf = await lerArquivo(fd, "certificado");
    const chaveBuf = await lerArquivo(fd, "chave");
    if (!certBuf) erros.certificado = ["Envie o certificado baixado do Portal do Desenvolvedor (.cer, .crt ou .pem)."];
    if (!chaveBuf) erros.chave = ["Envie a chave privada (.key ou .pem) do mesmo certificado."];
    if (certBuf && chaveBuf) {
      const x509 = new X509Certificate(certBuf);
      const k = createPrivateKey(chaveBuf);
      if (!x509.checkPrivateKey(k)) erros.chave = ["A chave privada não é a deste certificado."];
      validade = new Date(x509.validTo);
      if (validade <= new Date()) erros.certificado = ["Este certificado venceu. Gere um novo no Portal do Desenvolvedor."];
      certificado = x509.toString();
      chave = k.export({ type: "pkcs8", format: "pem" }).toString();
    }
  } catch (e) {
    erros.certificado = [`Não foi possível ler o certificado ou a chave (${e instanceof Error ? e.message : "formato inválido"}).`];
  }
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const admin = criarClienteAdmin();
  const { error } = await admin.rpc("honorarios_banco_guardar", {
    p_conteudo: cifrar(JSON.stringify({ clientId, clientSecret, certificado, chave })),
    p_ambiente: ambiente,
    p_url_token: ambiente === "homologacao" ? urlToken : "",
    p_url_api: ambiente === "homologacao" ? urlApi : "",
    p_validade: validade!.toISOString(),
  });
  if (error) return falha(mensagemErro(error));
  revalidatePath(BASE, "layout");
  return sucesso("Credenciais guardadas (cifradas). Agora clique em Testar conexão.");
}

/** Testa o acesso (token com o certificado) e cadastra o aviso automático de pagamento (webhook). */
export async function testarSicredi(): Promise<ResultadoAcao> {
  await exigirAdmin();
  const admin = criarClienteAdmin();
  const ligacao = await conexaoDoBanco(admin);
  if (!ligacao) return falha("Cadastre antes as credenciais do Sicredi.");
  try {
    await testarConexao(ligacao.conexao);
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await admin.rpc("honorarios_banco_resultado_teste", { p_ok: false, p_erro: erro, p_webhook: false });
    revalidatePath(BASE, "layout");
    return falha(`O banco recusou: ${erro}`);
  }
  let aviso = "";
  let webhook = false;
  const { data: cfg } = await admin.from("honorarios_config").select("pix_chave, banco_webhook_segredo").eq("id", 1).single();
  const site = envPublico.siteUrl();
  if (cfg?.pix_chave && cfg.banco_webhook_segredo && site.startsWith("https://")) {
    try {
      await registrarWebhook(ligacao.conexao, cfg.pix_chave, `${site}/api/pix/sicredi/${cfg.banco_webhook_segredo}`);
      webhook = true;
    } catch (e) {
      aviso = ` O aviso automático não foi cadastrado (${e instanceof Error ? e.message : e}); o portal confere os pagamentos a cada 15 minutos.`;
    }
  } else {
    aviso = " O aviso automático fica para depois (falta a chave Pix ou o endereço público do portal); o portal confere os pagamentos a cada 15 minutos.";
  }
  await admin.rpc("honorarios_banco_resultado_teste", { p_ok: true, p_erro: null as unknown as string, p_webhook: webhook });
  revalidatePath(BASE, "layout");
  return sucesso(`Conexão com o Sicredi funcionando.${webhook ? " Aviso automático de pagamento cadastrado." : ""}${aviso}`);
}

export async function ligarSicredi(ligar: boolean): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { error } = await s.supabase.rpc("honorarios_banco_configurar", { p_dados: { banco_ativo: ligar } });
  if (error) return falha(mensagemErro(error));
  revalidatePath(BASE, "layout");
  return sucesso(ligar ? "Confirmação automática ligada: as próximas cobranças enviadas são criadas no Sicredi." : "Confirmação automática desligada: volta o Pix comum.");
}

export async function removerSicredi(): Promise<ResultadoAcao> {
  await exigirAdmin();
  const { error } = await criarClienteAdmin().rpc("honorarios_banco_remover");
  if (error) return falha(mensagemErro(error));
  revalidatePath(BASE, "layout");
  return sucesso("Credenciais do Sicredi apagadas.");
}

/** Na cobrança: confere agora no banco (ou cria no banco quando ainda não foi criada). */
export async function conferirCobrancaNoBanco(id: string): Promise<ResultadoAcao> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return falha("Cobrança inválida.");
  const s = await exigirHonorarios();
  const { data: c } = await s.supabase.from("honorarios_cobrancas").select("id, situacao, banco_txid").eq("id", id).single();
  if (!c || c.situacao !== "aberta") return falha("Só cobranças em aberto.");
  const admin = criarClienteAdmin();
  try {
    if (!c.banco_txid) {
      const r = await criarNoBanco(admin, id);
      revalidatePath(BASE, "layout");
      return r.ok ? sucesso("Cobrança criada no Sicredi. O Pix já é o do banco.") : falha(`Não foi possível criar no banco: ${r.erro}`);
    }
    const baixas = await conferirNoBanco(admin, [c.banco_txid]);
    revalidatePath(BASE, "layout");
    return baixas ? sucesso("Pagamento confirmado pelo banco: baixa feita e recibo emitido.") : sucesso("O banco ainda não registrou o pagamento desta cobrança.");
  } catch (e) {
    return falha(`Consulta ao banco: ${e instanceof Error ? e.message : e}`);
  }
}
