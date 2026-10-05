"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirEquipe, obterContextoEmpresa } from "@/lib/auth/sessao";
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

const TEXTO_XML_A_CAMINHO =
  "A ciência da emissão das NF-e recebidas só em resumo é registrada na SEFAZ nas próximas buscas (até 100 notas por busca), e a SEFAZ libera o XML completo logo depois — normalmente em algumas horas. Os XML aparecem em Documentos e passam a entrar no XML do mês em lote. A SEFAZ só aceita a ciência até 10 dias depois da emissão: para notas mais antigas, peça o XML ao fornecedor e envie em Documentos.";

type Cliente = Awaited<ReturnType<typeof exigirEquipe>>["supabase"];

/** NF-e da empresa recebidas só em resumo que ainda podem receber a ciência (nem registrada nem recusada pela SEFAZ). */
async function temNfeSoEmResumo(supabase: Cliente, empresaId: string) {
  const { count } = await supabase
    .from("nfe_resumos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("situacao", "autorizada")
    .is("documento_id", null)
    .is("ciencia_em", null)
    .is("ciencia_retorno", null);
  return count ?? 0;
}

/**
 * Liga a ciência da emissão (e a busca da NF-e, sem a qual a ciência não é
 * enviada), mantendo a NFS-e como está. Só retoma uma busca pausada quando
 * `retomar` (pedido feito na própria empresa).
 */
async function ligarCiencia(
  supabase: Cliente,
  empresaId: string,
  cfg: { nfe_ativa: boolean; nfse_ativa: boolean; pausada: boolean; ciencia_automatica: boolean },
  retomar: boolean,
) {
  const pausada = cfg.pausada && !retomar;
  if (cfg.ciencia_automatica && cfg.nfe_ativa && cfg.pausada === pausada) return { error: null, mudou: false };
  const { error } = await supabase.rpc("salvar_notas_automaticas", { p_empresa_id: empresaId, p_nfe: true, p_nfse: cfg.nfse_ativa, p_ciencia: true, p_pausada: pausada });
  return { error, mudou: true };
}

/** Empresa: pede o XML completo das NF-e recebidas só em resumo (ciência da emissão automática). */
export async function pedirXmlCompletos(empresaId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite alterar a busca automática desta empresa.");
  const { data: cfg } = await ctx.supabase.from("notas_automaticas").select("nfe_ativa, nfse_ativa, pausada, ciencia_automatica, certificado_valido_ate").eq("empresa_id", empresaId).maybeSingle();
  if (!cfg?.certificado_valido_ate || new Date(cfg.certificado_valido_ate).getTime() <= Date.now()) {
    return falha("Cadastre um certificado digital válido da empresa: a ciência da emissão é registrada na SEFAZ com ele.");
  }
  const { error, mudou } = await ligarCiencia(ctx.supabase, empresaId, cfg, true);
  if (error) return falha(mensagemErro(error));
  // Já estava tudo ligado: a próxima busca começa agora (a ciência vai em toda busca)
  if (!mudou) {
    const { error: e2 } = await ctx.supabase.rpc("buscar_notas_agora", { p_empresa_id: empresaId });
    if (e2) return falha(mensagemErro(e2));
  }
  processarFilaDepois({ tipos: ["notas_automaticas", "processar_documento"] });
  revalidar(empresaId);
  return sucesso(`${mudou ? "Ciência automática ligada." : "A ciência automática já estava ligada; a busca começou agora."} ${TEXTO_XML_A_CAMINHO}`);
}

/**
 * Escritório: liga a ciência automática em todas as empresas com certificado
 * válido que ainda não a têm (e nas que têm NF-e só em resumo com a busca da
 * NF-e desligada). Empresas com a busca pausada continuam pausadas.
 */
export async function pedirXmlCompletosCarteira(): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const { data: configs, error } = await s.supabase
    .from("notas_automaticas")
    .select("empresa_id, nfe_ativa, nfse_ativa, pausada, ciencia_automatica, certificado_valido_ate")
    .gt("certificado_valido_ate", new Date().toISOString());
  if (error) return falha(mensagemErro(error));
  let ligadas = 0;
  let pausadas = 0;
  const falhas: string[] = [];
  for (const cfg of configs ?? []) {
    if (cfg.ciencia_automatica && cfg.nfe_ativa) {
      if (cfg.pausada && (await temNfeSoEmResumo(s.supabase, cfg.empresa_id))) pausadas++;
      continue;
    }
    // NF-e desligada de propósito e nada esperando o XML: fica como está
    if (!cfg.nfe_ativa && !(await temNfeSoEmResumo(s.supabase, cfg.empresa_id))) continue;
    const { error: e } = await ligarCiencia(s.supabase, cfg.empresa_id, cfg, false);
    if (e) {
      falhas.push(mensagemErro(e));
      continue;
    }
    ligadas++;
    if (cfg.pausada) pausadas++;
    revalidatePath(`/e/${cfg.empresa_id}/notas-automaticas`);
  }
  if (ligadas) processarFilaDepois({ tipos: ["notas_automaticas", "processar_documento"] });
  revalidatePath("/escritorio/notas-automaticas");
  if (!ligadas && falhas.length) return falha(falhas[0]);
  const partes = [
    ligadas
      ? `Ciência automática ligada em ${ligadas === 1 ? "1 empresa" : `${ligadas} empresas`}.`
      : "A ciência automática já estava ligada em todas as empresas com certificado válido.",
  ];
  if (falhas.length) partes.push(`${falhas.length === 1 ? "1 empresa não pôde ser alterada" : `${falhas.length} empresas não puderam ser alteradas`}: ${falhas[0]}`);
  if (pausadas) {
    partes.push(
      `${pausadas === 1 ? "1 empresa está com a busca pausada" : `${pausadas} empresas estão com a busca pausada`}: a ciência só é registrada quando a busca for retomada na página da empresa.`,
    );
  }
  partes.push(TEXTO_XML_A_CAMINHO);
  return sucesso(partes.join(" "));
}
