"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { lerValorBR } from "@/lib/dinheiro";
import { validarCpf } from "@/lib/formatos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "declaracoes";
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? "").trim();

/** Emissão (equipe): um valor para cada mês do período; o total é calculado no banco. */
export async function emitirDeclaracao(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("relatorios.publicar")) return falha("Só a equipe do escritório emite declarações.");

  const inicio = lerCompetencia(texto(fd, "periodo_inicio"));
  const fim = lerCompetencia(texto(fd, "periodo_fim"));
  const competencias = fd.getAll("competencia").map(String);
  const valores = fd.getAll("valor").map(String);
  const origens = fd.getAll("origem").map(String);
  const erros: Record<string, string[]> = {};
  const meses = competencias.map((c, i) => {
    const valor = lerValorBR(valores[i]);
    if (!valor || valor.isNegative()) erros[`valor_${i}`] = ["Informe o valor (zero ou mais)."];
    return { competencia: lerCompetencia(c), valor: valor ? valor.toFixed(2) : null, origem: origens[i] || "digitado" };
  });
  const cpf = texto(fd, "representante_cpf").replace(/\D/g, "");
  if (texto(fd, "representante_nome").length < 3) erros.representante_nome = ["Informe o nome do representante legal."];
  if (cpf && !validarCpf(cpf)) erros.representante_cpf = ["CPF inválido."];
  if (texto(fd, "contador_nome").length < 3) erros.contador_nome = ["Informe o nome do contador."];
  if (texto(fd, "contador_crc").length < 3) erros.contador_crc = ["Informe o CRC do contador."];
  if (texto(fd, "cidade").length < 2) erros.cidade = ["Informe a cidade."];
  const data = texto(fd, "data_declaracao");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erros.data_declaracao = ["Informe a data."];
  if (!inicio || !fim || !meses.length || meses.some((m) => !m.competencia)) return falha("Escolha o período da declaração.");
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const { data: id, error } = await ctx.supabase.rpc("emitir_declaracao_faturamento", {
    p_empresa_id: empresaId,
    p_dados: {
      periodo_inicio: inicio,
      periodo_fim: fim,
      meses,
      finalidade: texto(fd, "finalidade").slice(0, 300) || null,
      observacao: texto(fd, "observacao").slice(0, 1000) || null,
      cidade: texto(fd, "cidade").slice(0, 100),
      uf: texto(fd, "uf").slice(0, 2).toUpperCase() || null,
      data_declaracao: data,
      representante_nome: texto(fd, "representante_nome").slice(0, 200),
      representante_cpf: cpf || null,
      representante_cargo: texto(fd, "representante_cargo").slice(0, 100) || null,
      contador_nome: texto(fd, "contador_nome").slice(0, 200),
      contador_crc: texto(fd, "contador_crc").slice(0, 40),
    },
  });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/e/${empresaId}/declaracoes`);
  redirect(`/e/${empresaId}/declaracoes?emitida=${id}`);
}

/** PDF com assinatura digital embutida? (presença do campo de assinatura; a validade se confere no verificador do ITI) */
function temAssinaturaDigital(bytes: Uint8Array): boolean {
  const t = Buffer.from(bytes).toString("latin1");
  return t.includes("/ByteRange") && /\/Type\s*\/Sig\b|\/SubFilter\s*\/(adbe\.pkcs7|ETSI\.CAdES)/.test(t);
}

/** Versão assinada (PDF), enviada pela equipe ou pelo empresário. */
export async function enviarDeclaracaoAssinada(empresaId: string, declaracaoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(declaracaoId)) return falha("Declaração inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("relatorios.publicar") && !(ctx.pode("relatorios.ver") && ctx.pode("documentos.enviar"))) {
    return falha("Seu acesso não permite enviar a declaração assinada.");
  }
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha o PDF assinado.", { arquivo: ["Escolha o PDF assinado."] });
  if (arquivo.size > TAMANHO_MAXIMO) return falha("Arquivo grande demais.", { arquivo: ["O PDF deve ter até 10 MB."] });
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") return falha("Envie um arquivo PDF.", { arquivo: ["O arquivo enviado não é um PDF."] });

  const { data: atual } = await ctx.supabase.from("declaracoes_faturamento").select("assinada_path, situacao").eq("id", declaracaoId).eq("empresa_id", empresaId).maybeSingle();
  if (!atual) return falha("Declaração não encontrada.");
  if (atual.situacao === "cancelada") return falha("Esta declaração foi cancelada.");
  const caminho = `${empresaId}/${declaracaoId}/assinada-${Date.now()}.pdf`;
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(caminho, bytes, { contentType: "application/pdf", upsert: false });
  if (error) return falha(`Não foi possível enviar o PDF: ${error.message}`);
  const digital = temAssinaturaDigital(bytes);
  const { error: e2 } = await ctx.supabase.rpc("registrar_declaracao_assinada", { p_id: declaracaoId, p_path: caminho, p_assinatura_digital: digital });
  if (e2) {
    await ctx.supabase.storage.from(BUCKET).remove([caminho]);
    return falha(mensagemErro(e2));
  }
  if (atual.assinada_path && atual.assinada_path !== caminho) await ctx.supabase.storage.from(BUCKET).remove([atual.assinada_path]);
  revalidatePath(`/e/${empresaId}/declaracoes`);
  return sucesso(
    digital
      ? "Declaração assinada guardada. O PDF tem assinatura digital — para conferir a validade, use o verificador do ITI (validar.iti.gov.br)."
      : "Declaração assinada guardada. O PDF não tem assinatura digital embutida (por exemplo, assinado à mão e digitalizado).",
  );
}

/** Cancelamento (equipe), com motivo: a declaração continua no histórico, marcada como cancelada. */
export async function cancelarDeclaracao(empresaId: string, declaracaoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(declaracaoId)) return falha("Declaração inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("relatorios.publicar")) return falha("Só a equipe do escritório cancela declarações.");
  const motivo = texto(fd, "motivo");
  if (motivo.length < 5) return falha("Informe o motivo.", { motivo: ["Informe o motivo (pelo menos 5 letras)."] });
  const { error } = await ctx.supabase.rpc("cancelar_declaracao_faturamento", { p_id: declaracaoId, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/e/${empresaId}/declaracoes`);
  return sucesso("Declaração cancelada. Ela continua no histórico, marcada como cancelada.");
}
