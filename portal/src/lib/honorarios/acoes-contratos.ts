"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { exigirSessao } from "@/lib/auth/sessao";
import { competenciaAtual, competenciaDe, hojeISO, lerCompetencia } from "@/lib/competencia";
import { emailConfigurado, enviarEmail } from "@/lib/email/enviar";
import { validarCpf } from "@/lib/formatos";
import { publicarPdfNosDocumentos } from "@/lib/guias/publicar-pdf";
import { dadosRequisicao } from "@/lib/requisicao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirHonorarios } from "./acesso";
import { clausulasAditivo, clausulasContrato, clausulasDistrato, mudancasDaFicha, type CondicoesContrato, type OpcoesContrato } from "./contrato";
import { baixarArquivoContrato, conteudoDaFicha, gerarArquivoEnvio, gerarViaFinal, nomeArquivoContrato, numeroContrato, partesDoContrato, TITULOS } from "./contratos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, campo: string, max = 500) => String(fd.get(campo) ?? "").trim().slice(0, max);
const BASE = "/escritorio/honorarios/contratos";

function lerOpcoes(fd: FormData, foroPadrao: string): OpcoesContrato {
  const aviso = Number(texto(fd, "aviso_previo_dias", 3));
  const dia = Number(texto(fd, "dia_documentos", 2));
  return {
    aviso_previo_dias: [30, 60, 90].includes(aviso) ? aviso : 30,
    dia_documentos: Number.isInteger(dia) && dia >= 1 && dia <= 20 ? dia : 5,
    foro: texto(fd, "foro", 80) || foroPadrao,
    adicional: texto(fd, "adicional", 4000) || null,
  };
}

async function salvarEGerar(s: Awaited<ReturnType<typeof exigirHonorarios>>, dados: Record<string, unknown>): Promise<ResultadoAcao> {
  const { data: id, error } = await s.supabase.rpc("honorarios_contrato_salvar", { p_id: null as unknown as string, p_dados: dados as never });
  if (error || !id) return falha(mensagemErro(error));
  const { data: linha } = await s.supabase.from("honorarios_contratos").select("*").eq("id", id).single();
  if (!linha) return falha("Contrato não encontrado.");
  const arq = await gerarArquivoEnvio(s.supabase, linha);
  revalidatePath(BASE, "layout");
  const aviso = "erro" in arq ? `&aviso=${encodeURIComponent(arq.erro)}` : arq.aviso ? `&aviso=${encodeURIComponent(arq.aviso)}` : "";
  redirect(`${BASE}/${id}?gerado=1${aviso}`);
}

/** Novo contrato pela ficha do cliente (o que ele contratou). */
export async function gerarContrato(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const s = await exigirHonorarios();
  const partes = await partesDoContrato(s.supabase, empresaId);
  const conteudo = await conteudoDaFicha(s.supabase, empresaId, lerOpcoes(fd, partes.cidadeEscritorio));
  if ("erro" in conteudo) return falha(conteudo.erro);
  return salvarEGerar(s, {
    tipo: "contrato",
    empresa_id: empresaId,
    titulo: TITULOS.contrato,
    conteudo: { ...conteudo, cidade: partes.cidadeEscritorio },
    clausulas: clausulasContrato(conteudo),
  });
}

/** Última versão assinada das condições (contrato ou aditivo mais recente). */
async function condicoesAssinadas(s: Awaited<ReturnType<typeof exigirHonorarios>>, empresaId: string, contratoId: string) {
  const { data } = await s.supabase
    .from("honorarios_contratos")
    .select("dados, tipo, aceite_em")
    .eq("empresa_id", empresaId)
    .eq("situacao", "assinado")
    .or(`id.eq.${contratoId},contrato_origem_id.eq.${contratoId}`)
    .in("tipo", ["contrato", "aditivo"])
    .order("aceite_em", { ascending: false })
    .limit(1);
  return ((data?.[0]?.dados ?? {}) as { condicoes?: CondicoesContrato }).condicoes ?? null;
}

/** Aditivo: compara a ficha atual com o que foi assinado e escreve as mudanças. */
export async function gerarAditivo(contratoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(contratoId)) return falha("Contrato inválido.");
  const s = await exigirHonorarios();
  const { data: base } = await s.supabase.from("honorarios_contratos").select("*").eq("id", contratoId).single();
  if (!base || base.tipo !== "contrato" || base.situacao !== "assinado") return falha("O aditivo parte de um contrato assinado.");
  const antes = await condicoesAssinadas(s, base.empresa_id, contratoId);
  const partes = await partesDoContrato(s.supabase, base.empresa_id);
  const foro = (base.dados as { opcoes?: OpcoesContrato }).opcoes?.foro ?? partes.cidadeEscritorio;
  const atual = await conteudoDaFicha(s.supabase, base.empresa_id, lerOpcoes(fd, foro));
  if ("erro" in atual) return falha(atual.erro);
  if (!antes) return falha("Não encontrei as condições do contrato assinado.");
  const mudancas = mudancasDaFicha(antes, atual.condicoes);
  if (!mudancas.length) return falha("A ficha do cliente está igual ao contrato assinado: não há o que aditar. Mude a ficha primeiro.");
  const vigencia = lerCompetencia(texto(fd, "vigencia", 10)) ?? competenciaAtual();
  const { cidadeEscritorio, ...p } = partes;
  return salvarEGerar(s, {
    tipo: "aditivo",
    contrato_origem_id: contratoId,
    empresa_id: base.empresa_id,
    titulo: TITULOS.aditivo,
    conteudo: { partes: p, condicoes: atual.condicoes, mudancas, vigencia, cidade: cidadeEscritorio, opcoes: { foro } },
    clausulas: clausulasAditivo(numeroContrato(base), mudancas, vigencia, foro),
  });
}

/** Distrato (encerramento), conforme a Resolução CFC nº 1.590/2020. */
export async function gerarDistrato(contratoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(contratoId)) return falha("Contrato inválido.");
  const s = await exigirHonorarios();
  const { data: base } = await s.supabase.from("honorarios_contratos").select("*").eq("id", contratoId).single();
  if (!base || base.tipo !== "contrato" || base.situacao !== "assinado") return falha("O distrato parte de um contrato assinado.");
  const dataFim = texto(fd, "data_fim", 10);
  const ultima = lerCompetencia(texto(fd, "ultima_competencia", 10));
  const prazo = Number(texto(fd, "prazo_devolucao_dias", 3));
  const erros: Record<string, string[]> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) erros.data_fim = ["Informe a data do encerramento."];
  if (!ultima) erros.ultima_competencia = ["Informe a última competência sob responsabilidade do escritório."];
  if (!Number.isInteger(prazo) || prazo < 1 || prazo > 180) erros.prazo_devolucao_dias = ["De 1 a 180 dias."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const partes = await partesDoContrato(s.supabase, base.empresa_id);
  const foro = (base.dados as { opcoes?: OpcoesContrato }).opcoes?.foro ?? partes.cidadeEscritorio;
  const { cidadeEscritorio, ...p } = partes;
  const opcoes = { data_fim: dataFim, ultima_competencia: ultima!, prazo_devolucao_dias: prazo, foro };
  return salvarEGerar(s, {
    tipo: "distrato",
    contrato_origem_id: contratoId,
    empresa_id: base.empresa_id,
    titulo: TITULOS.distrato,
    conteudo: { partes: p, cidade: cidadeEscritorio, opcoes },
    clausulas: clausulasDistrato(numeroContrato(base), opcoes),
  });
}

export async function enviarContrato(id: string): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Contrato inválido.");
  const s = await exigirHonorarios();
  const { data, error } = await s.supabase.rpc("honorarios_contrato_enviar", { p_id: id });
  if (error) return falha(mensagemErro(error));
  revalidatePath(BASE, "layout");
  return data
    ? sucesso(`Enviado: ${data} sócio(s) titular(es) receberam o aviso para assinar no portal.`)
    : sucesso("Enviado, mas a empresa não tem sócio titular com acesso ao portal. Convide o titular para ele assinar.");
}

export async function cancelarContrato(id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Contrato inválido.");
  const s = await exigirHonorarios();
  const motivo = texto(fd, "motivo", 300);
  if (motivo.length < 5) return falha("Informe o motivo.", { motivo: ["Informe o motivo (pelo menos 5 letras)."] });
  const { error } = await s.supabase.rpc("honorarios_contrato_cancelar", { p_id: id, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidatePath(BASE, "layout");
  return sucesso("Cancelado.");
}

/** Publica a via final assinada nos documentos da empresa (Documentos › Contratos). */
export async function publicarViaFinal(id: string): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Contrato inválido.");
  const s = await exigirHonorarios();
  const { data: c } = await s.supabase.from("honorarios_contratos").select("*").eq("id", id).single();
  if (!c || c.situacao !== "assinado") return falha("Só a via assinada é publicada.");
  if (!c.final_path) {
    const r = await gerarViaFinal(id);
    if ("erro" in r) return falha(r.erro);
  }
  const { data: atual } = await s.supabase.from("honorarios_contratos").select("final_path").eq("id", id).single();
  const pdf = atual?.final_path ? await baixarArquivoContrato(atual.final_path) : null;
  if (!pdf) return falha("A via final não foi encontrada.");
  const pub = await publicarPdfNosDocumentos(s.supabase, {
    empresaId: c.empresa_id,
    competencia: competenciaDe((c.aceite_em ?? hojeISO()).slice(0, 10)),
    categoria: "esc_contrato",
    nomeArquivo: nomeArquivoContrato(c, true),
    titulo: `${c.titulo} nº ${numeroContrato(c)} (assinado)`,
    valor: null,
    pdf,
    rotulo: { nome: "o contrato", publicado: "publicado" },
  });
  if ("erro" in pub) return falha(pub.erro);
  await criarClienteAdmin().rpc("honorarios_contrato_registrar_final", { p_id: id, p_path: atual!.final_path!, p_hash: null as unknown as string, p_documento_id: pub.documentoId });
  revalidatePath(BASE, "layout");
  return sucesso("Via assinada publicada nos documentos da empresa (Contratos).");
}

// -----------------------------------------------------------------------------
// Cliente: assinar
// -----------------------------------------------------------------------------
async function contratoDoTitular(id: string) {
  const s = await exigirSessao();
  const { data: c } = await s.supabase.from("honorarios_contratos").select("*").eq("id", id).maybeSingle();
  if (!c || c.situacao !== "enviado") return { erro: "Este documento não está aguardando assinatura." } as const;
  const { data: m } = await s.supabase.from("empresa_membros").select("papel").eq("empresa_id", c.empresa_id).eq("user_id", s.usuarioId).eq("ativo", true).maybeSingle();
  if (m?.papel !== "cliente_titular") return { erro: "Só o sócio titular da empresa assina." } as const;
  return { s, c } as const;
}

/** Envia o código de 6 números ao e-mail de quem vai assinar (o código não fica guardado em texto). */
export async function pedirCodigoContrato(id: string): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Documento inválido.");
  const r = await contratoDoTitular(id);
  if ("erro" in r) return falha(r.erro ?? "Sem acesso.");
  if (!emailConfigurado()) return falha("O e-mail do portal está desconectado: assine confirmando seus dados (sem código).");
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const admin = criarClienteAdmin();
  const { error } = await admin.rpc("honorarios_contrato_registrar_codigo", { p_contrato_id: id, p_user_id: r.s.usuarioId, p_codigo: codigo });
  if (error) return falha(mensagemErro(error));
  const envio = await enviarEmail(r.s.perfil.email, `Código para assinar: ${codigo}`, {
    titulo: "Código para assinar o documento",
    paragrafos: [
      `Use o código ${codigo} para assinar "${r.c.titulo} nº ${numeroContrato(r.c)}" no portal.`,
      "Ele vale por 15 minutos. Se não foi você que pediu, ignore este e-mail.",
    ],
  });
  if (!envio.enviado) return falha("Não foi possível enviar o código por e-mail. Tente de novo em alguns minutos.");
  return sucesso(`Enviamos o código para ${r.s.perfil.email.replace(/^(.{2}).*(@.*)$/, "$1***$2")}.`);
}

export async function assinarContrato(id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Documento inválido.");
  const r = await contratoDoTitular(id);
  if ("erro" in r) return falha(r.erro ?? "Sem acesso.");
  const nome = texto(fd, "nome", 150);
  const cpf = texto(fd, "cpf", 20).replace(/\D/g, "");
  const codigo = texto(fd, "codigo", 10).replace(/\D/g, "");
  const erros: Record<string, string[]> = {};
  if (nome.split(/\s+/).length < 2) erros.nome = ["Escreva o nome completo."];
  if (!validarCpf(cpf)) erros.cpf = ["CPF inválido."];
  const comCodigo = emailConfigurado();
  if (comCodigo && !/^\d{6}$/.test(codigo)) erros.codigo = ["Digite o código de 6 números enviado ao seu e-mail."];
  if (fd.get("li") !== "on") erros.li = ["Confirme que leu o documento."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { ip, userAgent } = await dadosRequisicao();
  const { error } = await criarClienteAdmin().rpc("honorarios_contrato_aceitar", {
    p_contrato_id: id,
    p_user_id: r.s.usuarioId,
    p_codigo: (comCodigo ? codigo : null) as string,
    p_nome: nome,
    p_cpf: cpf,
    p_ip: ip ?? "",
    p_user_agent: userAgent ?? "",
    p_hash: texto(fd, "hash", 64),
  });
  if (error) return falha(mensagemErro(error));
  await gerarViaFinal(id);
  revalidatePath(`/e/${r.c.empresa_id}/contratos`, "layout");
  return sucesso("Documento assinado. A via final, com o registro das assinaturas, está disponível para baixar.");
}
