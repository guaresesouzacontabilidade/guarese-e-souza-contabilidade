"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { competenciaAtual, lerCompetencia } from "@/lib/competencia";
import { envServidor } from "@/lib/env-servidor";
import { formatarCompetencia } from "@/lib/formatos";
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

/** Mês inicial escolhido no formulário: "AAAA-MM" (até o mês atual) ou "tudo". */
function lerMesInicial(fd: FormData): { desde: string | null; semLimite: boolean } | "invalido" | null {
  const v = String(fd.get("buscar_desde") ?? "").trim();
  if (!v) return null;
  if (v === "tudo") return { desde: null, semLimite: true };
  const c = lerCompetencia(v);
  if (!c || c > competenciaAtual() || c < "2015-01-01") return "invalido";
  return { desde: c, semLimite: false };
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
  const mes = lerMesInicial(fd);
  if (mes === "invalido") erros.buscar_desde = ["Escolha o mês inicial da busca."];
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
    // Só no primeiro cadastro: na troca do certificado o mês inicial não muda
    p_buscar_desde: mes && mes !== "invalido" && mes.desde ? mes.desde : undefined,
    p_sem_limite: mes && mes !== "invalido" ? mes.semLimite : false,
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

/** Mês inicial da busca: notas emitidas antes dele não são trazidas. */
export async function definirMesInicial(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite alterar a busca automática desta empresa.");
  const mes = lerMesInicial(fd);
  if (!mes || mes === "invalido") return falha("Escolha o mês inicial.", { buscar_desde: ["Escolha o mês inicial."] });
  const { data, error } = await ctx.supabase.rpc("definir_inicio_notas", { p_empresa_id: empresaId, p_desde: mes.desde as string });
  if (error) return falha(mensagemErro(error));
  const r = (data ?? {}) as { nfse_rebuscar?: number; nfe_sem_volta?: number; anteriores_no_portal?: number };
  const partes = [
    mes.desde
      ? `A busca agora traz as notas emitidas a partir de ${formatarCompetencia(mes.desde, true)}.`
      : "A busca agora traz tudo o que os serviços oficiais ainda disponibilizam.",
  ];
  if (r.nfse_rebuscar) partes.push(`${r.nfse_rebuscar === 1 ? "1 NFS-e dos meses incluídos será buscada" : `${r.nfse_rebuscar} NFS-e dos meses incluídos serão buscadas`} de novo.`);
  if (r.nfe_sem_volta) {
    partes.push(
      `${r.nfe_sem_volta === 1 ? "1 NF-e desses meses não volta" : `${r.nfe_sem_volta} NF-e desses meses não voltam`} pela busca (a SEFAZ entrega cada nota uma única vez); se precisar, envie os XML em Documentos.`,
    );
  }
  if (r.anteriores_no_portal) {
    partes.push(
      r.anteriores_no_portal === 1
        ? "1 arquivo anterior a esse mês continua no portal."
        : `${r.anteriores_no_portal} arquivos anteriores a esse mês continuam no portal.`,
    );
  }
  if (r.nfse_rebuscar) processarFilaDepois({ tipos: ["notas_automaticas", "processar_documento"] });
  revalidar(empresaId);
  return sucesso(partes.join(" "));
}

/** Administrador: apaga de vez as notas automáticas anteriores ao mês inicial (e o que veio delas). */
export async function apagarNotasAnteriores(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const s = await exigirAdmin();
  const motivo = String(fd.get("motivo") ?? "").trim().slice(0, 500);
  const erros: Record<string, string[]> = {};
  if (motivo.length < 5) erros.motivo = ["Informe o motivo (pelo menos 5 letras)."];
  if (fd.get("confirmo") !== "on") erros.confirmo = ["Confirme que a exclusão é definitiva."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { data, error } = await s.supabase.rpc("apagar_notas_anteriores", { p_empresa_id: empresaId, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  const r = (data ?? {}) as { documentos?: number; notas?: number; lancamentos?: number; resumos?: number };
  processarFilaDepois({ tipos: ["remover_arquivos"] });
  revalidar(empresaId);
  revalidatePath(`/e/${empresaId}/documentos`);
  return sucesso(
    `Apagados: ${r.documentos ?? 0} arquivo(s), ${r.notas ?? 0} nota(s) lida(s), ${r.lancamentos ?? 0} lançamento(s) sugerido(s) e ${r.resumos ?? 0} resumo(s) de NF-e. A exclusão ficou registrada na auditoria.`,
  );
}
