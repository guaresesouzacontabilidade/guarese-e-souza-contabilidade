"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirEquipe } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { hojeISO, lerCompetencia } from "@/lib/competencia";
import { lerValorBR } from "@/lib/dinheiro";
import { validarCnpj, validarCpf } from "@/lib/formatos";
import { certificadoDoEscritorio, gerarArquivoRecibo } from "./arquivo";
import { publicarReciboNosDocumentos } from "./publicar";
import { carregarRecibo } from "./carregar";
import { FORMAS_PAGAMENTO, numeroRecibo } from "./comum";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROTA = "/escritorio/recibos";
const texto = (fd: FormData, campo: string, max = 500) => String(fd.get(campo) ?? "").trim().slice(0, max);

/** Emissão (equipe): pagador da carteira ou avulso, número do ano reservado no banco. */
export async function emitirRecibo(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const modo = texto(fd, "modo") === "avulso" ? "avulso" : "carteira";
  const empresaId = texto(fd, "empresa_id");
  const nome = texto(fd, "pagador_nome", 200);
  const documento = texto(fd, "pagador_documento", 30).replace(/\D/g, "");
  const valor = lerValorBR(texto(fd, "valor", 30));
  const competenciaTexto = texto(fd, "competencia", 10);
  const competencia = lerCompetencia(competenciaTexto);
  const data = texto(fd, "data_recibo", 10);
  const forma = texto(fd, "forma_pagamento", 20);
  const erros: Record<string, string[]> = {};

  if (modo === "carteira" && !UUID.test(empresaId)) erros.empresa_id = ["Escolha a empresa que pagou."];
  if (modo === "avulso") {
    if (nome.length < 2) erros.pagador_nome = ["Informe o nome de quem pagou."];
    if (documento && !(documento.length === 11 ? validarCpf(documento) : documento.length === 14 && validarCnpj(documento))) {
      erros.pagador_documento = ["CPF ou CNPJ inválido."];
    }
  }
  if (!valor || !valor.greaterThan(0)) erros.valor = ["Informe o valor recebido."];
  else if (valor.greaterThanOrEqualTo(10_000_000)) erros.valor = ["Valor alto demais."];
  if (competenciaTexto && !competencia) erros.competencia = ["Mês inválido."];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erros.data_recibo = ["Informe a data do recibo."];
  else if (data > hojeISO()) erros.data_recibo = ["A data não pode ser no futuro."];
  if (forma && !(forma in FORMAS_PAGAMENTO)) erros.forma_pagamento = ["Forma de pagamento inválida."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const { data: emitido, error } = await s.supabase.rpc("recibo_emitir", {
    p_dados: {
      empresa_id: modo === "carteira" ? empresaId : null,
      pagador_nome: modo === "avulso" ? nome : null,
      pagador_documento: modo === "avulso" ? documento || null : null,
      valor: valor!.toFixed(2),
      referencia: texto(fd, "referencia", 120) || "Honorários contábeis",
      competencia,
      descricao: texto(fd, "descricao", 500) || null,
      data_recibo: data,
      forma_pagamento: forma || null,
      nfse_numero: texto(fd, "nfse_numero", 30) || null,
      observacao: texto(fd, "observacao", 500) || null,
    },
  });
  const recibo = emitido?.[0];
  if (error || !recibo) return falha(mensagemErro(error));

  // Assina (com o certificado do escritório cadastrado) e guarda o arquivo
  const avisos: string[] = [];
  const carregado = await carregarRecibo(s.supabase, recibo.id);
  const arquivo = carregado ? await gerarArquivoRecibo(s.supabase, carregado.linha) : null;
  if (arquivo?.erro) avisos.push("assinatura");
  if (modo === "carteira" && fd.get("publicar") === "on") {
    const pub = await publicarReciboNosDocumentos(s.supabase, recibo.id, arquivo?.pdf);
    if ("erro" in pub) avisos.push("publicar");
  }
  revalidatePath(ROTA);
  redirect(`${ROTA}?emitido=${recibo.id}${avisos.map((a) => `&aviso=${a}`).join("")}`);
}

/** Publica depois (para o cliente ver em Documentos › Recibos). */
export async function publicarRecibo(reciboId: string): Promise<ResultadoAcao> {
  if (!UUID.test(reciboId)) return falha("Recibo inválido.");
  const s = await exigirEquipe();
  const pub = await publicarReciboNosDocumentos(s.supabase, reciboId);
  if ("erro" in pub) return falha(`Não foi possível publicar: ${pub.erro}`);
  revalidatePath(ROTA);
  return sucesso("Recibo publicado nos documentos da empresa (Recibos).");
}

/**
 * Assina um recibo emitido antes do certificado (ou quando a assinatura
 * falhou). Se ele já estava publicado, a versão assinada substitui a outra
 * nos documentos do cliente.
 */
export async function assinarRecibo(reciboId: string): Promise<ResultadoAcao> {
  if (!UUID.test(reciboId)) return falha("Recibo inválido.");
  const s = await exigirEquipe();
  if (!(await certificadoDoEscritorio(s.supabase))) return falha("Cadastre antes o certificado do escritório (Configurações › Integrações).");
  const r = await carregarRecibo(s.supabase, reciboId);
  if (!r) return falha("Recibo não encontrado.");
  if (r.linha.situacao !== "emitido") return falha("Este recibo foi cancelado.");
  const arquivo = await gerarArquivoRecibo(s.supabase, r.linha);
  if (!arquivo.assinado) return falha(`Não foi possível assinar: ${arquivo.erro ?? "certificado indisponível"}.`);
  let aviso = "";
  if (r.linha.documento_id) {
    const { error } = await s.supabase.rpc("excluir_documento", { p_documento_id: r.linha.documento_id, p_motivo: "Trocado pela versão assinada digitalmente" });
    const pub = error ? { erro: mensagemErro(error) } : await publicarReciboNosDocumentos(s.supabase, reciboId, arquivo.pdf);
    if ("erro" in pub) aviso = ` Atenção: a versão assinada não substituiu a publicada (${pub.erro}).`;
  }
  revalidatePath(ROTA);
  return sucesso(`Recibo nº ${numeroRecibo(r.linha)} assinado digitalmente.${aviso}`);
}

/** Cancelamento (equipe), com motivo: o número não volta e o PDF publicado sai dos documentos do cliente. */
export async function cancelarRecibo(reciboId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(reciboId)) return falha("Recibo inválido.");
  const s = await exigirEquipe();
  const motivo = texto(fd, "motivo", 300);
  if (motivo.length < 5) return falha("Informe o motivo.", { motivo: ["Informe o motivo (pelo menos 5 letras)."] });
  const { data: documentoId, error } = await s.supabase.rpc("recibo_cancelar", { p_recibo_id: reciboId, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  let aviso = "";
  if (documentoId) {
    const { error: e2 } = await s.supabase.rpc("excluir_documento", { p_documento_id: documentoId, p_motivo: `Recibo cancelado: ${motivo}` });
    if (e2) aviso = ` Atenção: o PDF publicado não saiu dos documentos da empresa (${mensagemErro(e2)}); exclua por lá.`;
  }
  revalidatePath(ROTA);
  return sucesso(`Recibo cancelado. Ele continua na lista, marcado como cancelado.${aviso}`);
}
