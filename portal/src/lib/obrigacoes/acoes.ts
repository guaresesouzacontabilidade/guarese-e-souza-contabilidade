"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirAdmin, exigirEquipe } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { lerValorBR } from "@/lib/dinheiro";
import { REGIMES } from "@/lib/rotulos";
import { montarPrazo, problemaPrazo, type EstadoPrazo, type RegraPrazo } from "./regras";

const BASE = "/escritorio/obrigacoes";
const UUID = /^[0-9a-f-]{36}$/i;

function revalidar() {
  revalidatePath(BASE, "layout");
}

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

function marcado(fd: FormData, nome: string) {
  return fd.get(nome) === "on";
}

function uuidOuNull(v: string) {
  return UUID.test(v) ? v : null;
}

function resumoSincronizacao(dados: unknown) {
  const r = (dados ?? {}) as { tarefas_recalculadas?: number; tarefas_geradas?: number };
  const partes: string[] = [];
  if (r.tarefas_geradas) partes.push(`${r.tarefas_geradas} tarefa(s) gerada(s)`);
  if (r.tarefas_recalculadas) partes.push(`${r.tarefas_recalculadas} tarefa(s) ajustada(s)`);
  return partes.length ? ` ${partes.join(" e ")}.` : "";
}

async function sincronizar(supabase: Awaited<ReturnType<typeof exigirEquipe>>["supabase"], empresaId: string, motivo: string) {
  const { data } = await supabase.rpc("sincronizar_tarefas_empresa", { p_empresa_id: empresaId, p_motivo: motivo });
  return resumoSincronizacao(data);
}

// -----------------------------------------------------------------------------
// Empresa: cadastro operacional, regimes e calendário
// -----------------------------------------------------------------------------

export async function salvarDadosOperacionais(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const municipio = texto(fd, "municipio_ibge");
  if (municipio && !/^\d{7}$/.test(municipio)) return falha("Selecione o município na lista.");
  const { error } = await s.supabase
    .from("empresas")
    .update({
      municipio_ibge: municipio || null,
      contribuinte_icms: marcado(fd, "contribuinte_icms"),
      contribuinte_iss: marcado(fd, "contribuinte_iss"),
      tem_empregados: marcado(fd, "tem_empregados"),
      tem_pro_labore: marcado(fd, "tem_pro_labore"),
    })
    .eq("id", empresaId);
  if (error) return falha(mensagemErro(error));
  const resumo = await sincronizar(s.supabase, empresaId, "Cadastro operacional da empresa alterado.");
  revalidar();
  return sucesso(`Dados salvos.${resumo}`);
}

const esquemaRegime = z
  .object({
    regime: z.enum(Object.keys(REGIMES) as [string, ...string[]], { error: "Selecione o regime." }),
    inicio: z.string().refine((v) => lerCompetencia(v) !== null, "Informe a competência de início."),
    lucro_real_apuracao: z.enum(["", "trimestral", "anual"]),
    observacao: z.string().max(500),
  })
  .superRefine((d, ctx) => {
    if (d.regime === "lucro_real" && !d.lucro_real_apuracao) {
      ctx.addIssue({ code: "custom", path: ["lucro_real_apuracao"], message: "Informe se o Lucro Real é trimestral ou anual." });
    }
  });

export async function registrarRegime(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const d = esquemaRegime.safeParse({
    regime: texto(fd, "regime"),
    inicio: texto(fd, "inicio"),
    lucro_real_apuracao: texto(fd, "lucro_real_apuracao"),
    observacao: texto(fd, "observacao"),
  });
  if (!d.success) return falhaValidacao(d.error);
  const { error } = await s.supabase.rpc("registrar_regime", {
    p_empresa_id: empresaId,
    p_regime: d.data.regime,
    p_inicio: lerCompetencia(d.data.inicio)!,
    p_lucro_real_apuracao: d.data.lucro_real_apuracao || undefined,
    p_observacao: d.data.observacao || undefined,
  });
  if (error) return falha(mensagemErro(error));
  const resumo = await sincronizar(s.supabase, empresaId, "Regime tributário alterado.");
  revalidar();
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  return sucesso(`Regime registrado.${resumo}`);
}

export async function editarPeriodoRegime(id: string, empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const regime = texto(fd, "regime");
  const lr = texto(fd, "lucro_real_apuracao");
  if (!REGIMES[regime]) return falha("Selecione o regime.");
  if (regime === "lucro_real" && !["trimestral", "anual"].includes(lr)) return falha("Informe se o Lucro Real é trimestral ou anual.");
  const fim = texto(fd, "fim");
  const { error } = await s.supabase
    .from("empresa_regimes")
    .update({
      regime,
      lucro_real_apuracao: regime === "lucro_real" ? lr : null,
      fim: fim ? lerCompetencia(fim) : null,
      observacao: texto(fd, "observacao") || null,
    })
    .eq("id", id)
    .eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  const resumo = await sincronizar(s.supabase, empresaId, "Histórico de regimes alterado.");
  revalidar();
  return sucesso(`Período atualizado.${resumo}`);
}

export async function excluirPeriodoRegime(id: string, empresaId: string): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const { count } = await s.supabase.from("empresa_regimes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if ((count ?? 0) <= 1) return falha("A empresa precisa ter ao menos um período de regime.");
  const { error } = await s.supabase.from("empresa_regimes").delete().eq("id", id).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  const resumo = await sincronizar(s.supabase, empresaId, "Histórico de regimes alterado.");
  revalidar();
  return sucesso(`Período removido.${resumo}`);
}

const esquemaConfig = z
  .object({
    obrigacao_id: z.string().regex(UUID, "Selecione a obrigação."),
    modo: z.enum(["automatico", "incluida", "excluida"]),
    vigencia_inicio: z.string().refine((v) => lerCompetencia(v) !== null, "Informe a competência inicial."),
    vigencia_fim: z.string().refine((v) => v === "" || lerCompetencia(v) !== null, "Competência final inválida."),
    responsavel_id: z.string(),
    revisor_id: z.string(),
    prazo_interno_dias_uteis: z.string().refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 30), "Use de 0 a 30 dias úteis."),
    motivo: z.string().max(500),
  })
  .superRefine((d, ctx) => {
    if (d.modo !== "automatico" && d.motivo.trim().length < 5) {
      ctx.addIssue({ code: "custom", path: ["motivo"], message: "Explique o motivo da inclusão ou exclusão." });
    }
    if (d.vigencia_fim && (lerCompetencia(d.vigencia_fim) ?? "") < (lerCompetencia(d.vigencia_inicio) ?? "")) {
      ctx.addIssue({ code: "custom", path: ["vigencia_fim"], message: "A competência final deve ser igual ou posterior à inicial." });
    }
  });

export async function salvarConfiguracao(empresaId: string, configId: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const d = esquemaConfig.safeParse({
    obrigacao_id: texto(fd, "obrigacao_id"),
    modo: texto(fd, "modo") || "automatico",
    vigencia_inicio: texto(fd, "vigencia_inicio"),
    vigencia_fim: texto(fd, "vigencia_fim"),
    responsavel_id: texto(fd, "responsavel_id"),
    revisor_id: texto(fd, "revisor_id"),
    prazo_interno_dias_uteis: texto(fd, "prazo_interno_dias_uteis"),
    motivo: texto(fd, "motivo"),
  });
  if (!d.success) return falhaValidacao(d.error);
  const registro = {
    empresa_id: empresaId,
    obrigacao_id: d.data.obrigacao_id,
    modo: d.data.modo,
    vigencia_inicio: lerCompetencia(d.data.vigencia_inicio)!,
    vigencia_fim: d.data.vigencia_fim ? lerCompetencia(d.data.vigencia_fim) : null,
    responsavel_id: uuidOuNull(d.data.responsavel_id),
    revisor_id: uuidOuNull(d.data.revisor_id),
    prazo_interno_dias_uteis: d.data.prazo_interno_dias_uteis === "" ? null : Number(d.data.prazo_interno_dias_uteis),
    motivo: d.data.motivo.trim() || null,
  };
  if (registro.responsavel_id && registro.responsavel_id === registro.revisor_id) {
    return falha("Quem revisa precisa ser outra pessoa da equipe.");
  }
  const { error } = configId
    ? await s.supabase.from("empresa_obrigacoes").update(registro).eq("id", configId).eq("empresa_id", empresaId)
    : await s.supabase.from("empresa_obrigacoes").insert(registro);
  if (error) return falha(mensagemErro(error));
  // Responsável e revisor definidos aqui passam a valer nas tarefas abertas da vigência
  if (registro.responsavel_id || registro.revisor_id) {
    let q = s.supabase
      .from("tarefas")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("obrigacao_id", registro.obrigacao_id)
      .in("status", ["pendente", "em_andamento", "aguardando_cliente"])
      .gte("competencia", registro.vigencia_inicio);
    if (registro.vigencia_fim) q = q.lte("competencia", registro.vigencia_fim);
    const { data: abertas } = await q;
    if (abertas?.length) {
      await s.supabase.rpc("atribuir_tarefas", {
        p_ids: abertas.map((t) => t.id),
        p_responsavel_id: registro.responsavel_id ?? undefined,
        p_revisor_id: registro.revisor_id ?? undefined,
      });
    }
  }
  const resumo = await sincronizar(s.supabase, empresaId, "Calendário de obrigações da empresa alterado.");
  revalidar();
  return sucesso(`Configuração salva.${resumo}`);
}

export async function excluirConfiguracao(configId: string, empresaId: string): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const { error } = await s.supabase.from("empresa_obrigacoes").delete().eq("id", configId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  const resumo = await sincronizar(s.supabase, empresaId, "Configuração da obrigação removida.");
  revalidar();
  return sucesso(`Configuração removida; vale a regra geral.${resumo}`);
}

// -----------------------------------------------------------------------------
// Tarefas
// -----------------------------------------------------------------------------

export async function gerarTarefas(competencia: string, empresaId?: string): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const comp = lerCompetencia(competencia);
  if (!comp) return falha("Competência inválida.");
  const { data, error } = await s.supabase.rpc("gerar_tarefas", { p_competencia: comp, p_empresa_id: empresaId });
  if (error) return falha(mensagemErro(error));
  revalidar();
  const n = Number(data ?? 0);
  return sucesso(n ? `${n} tarefa(s) gerada(s).` : "Nenhuma tarefa nova: as tarefas desta competência já existem ou não há regras validadas que se apliquem.");
}

export interface DadosTarefa {
  status?: string;
  comentario?: string;
  comprovanteId?: string;
  guiaId?: string;
  protocolo?: string;
  valor?: string;
  dispensaMotivo?: string;
  responsavelId?: string;
  revisorId?: string;
}

export async function atualizarTarefa(tarefaId: string, dados: DadosTarefa): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  if (!UUID.test(tarefaId)) return falha("Tarefa inválida.");
  let valor: number | undefined;
  if (dados.valor) {
    const v = lerValorBR(dados.valor);
    if (!v || v.isNegative()) return falha("Valor inválido.");
    valor = Number(v.toFixed(2));
  }
  if (dados.responsavelId && dados.revisorId && dados.responsavelId === dados.revisorId) {
    return falha("Quem revisa precisa ser outra pessoa da equipe.");
  }
  const { error } = await s.supabase.rpc("atualizar_tarefa", {
    p_tarefa_id: tarefaId,
    p_status: dados.status || undefined,
    p_comentario: dados.comentario?.trim() || undefined,
    p_comprovante_documento_id: dados.comprovanteId && UUID.test(dados.comprovanteId) ? dados.comprovanteId : undefined,
    p_guia_documento_id: dados.guiaId && UUID.test(dados.guiaId) ? dados.guiaId : undefined,
    p_protocolo: dados.protocolo?.trim() || undefined,
    p_valor: valor,
    p_dispensa_motivo: dados.dispensaMotivo?.trim() || undefined,
    p_responsavel_id: dados.responsavelId && UUID.test(dados.responsavelId) ? dados.responsavelId : undefined,
    p_revisor_id: dados.revisorId && UUID.test(dados.revisorId) ? dados.revisorId : undefined,
  });
  if (error) return falha(mensagemErro(error));
  revalidar();
  const mensagens: Record<string, string> = {
    em_andamento: "Tarefa em andamento.",
    aguardando_cliente: "Tarefa marcada como aguardando o cliente.",
    em_revisao: "Tarefa enviada para revisão.",
    concluida: "Tarefa concluída.",
    dispensada: "Tarefa dispensada.",
    pendente: "Tarefa reaberta.",
  };
  return sucesso(dados.status ? mensagens[dados.status] ?? "Tarefa atualizada." : "Tarefa atualizada.");
}

export async function atribuirTarefas(ids: string[], responsavelId: string, revisorId: string, semRevisor: boolean): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const validos = ids.filter((i) => UUID.test(i));
  if (!validos.length) return falha("Selecione ao menos uma tarefa.");
  if (!UUID.test(responsavelId) && !UUID.test(revisorId) && !semRevisor) return falha("Escolha o responsável ou o revisor.");
  if (UUID.test(responsavelId) && responsavelId === revisorId) return falha("Quem revisa precisa ser outra pessoa da equipe.");
  const { data, error } = await s.supabase.rpc("atribuir_tarefas", {
    p_ids: validos,
    p_responsavel_id: UUID.test(responsavelId) ? responsavelId : undefined,
    p_revisor_id: UUID.test(revisorId) ? revisorId : undefined,
    p_limpar_revisor: semRevisor,
  });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso(`${data ?? 0} tarefa(s) atualizada(s).`);
}

// -----------------------------------------------------------------------------
// Catálogo e atualizações normativas
// -----------------------------------------------------------------------------

const esquemaObrigacao = z.object({
  codigo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,40}$/, "Use letras maiúsculas, números e _ (ex.: ISS_PALMAS)."),
  nome: z.string().trim().min(3, "Informe o nome."),
  descricao: z.string().trim().max(2000),
  esfera: z.enum(["federal", "nacional", "estadual", "municipal"]),
  area: z.enum(["fiscal", "contabil", "pessoal", "societario"]),
  periodicidade: z.enum(["mensal", "trimestral", "anual"]),
  etapas: z.array(z.enum(["apuracao", "entrega", "pagamento"])).min(1, "Marque ao menos uma etapa."),
  tributos: z.array(z.string()),
  categorias: z.array(z.string()),
  observacao: z.string().trim().max(2000),
  ativa: z.boolean(),
});

export async function salvarObrigacao(id: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const d = esquemaObrigacao.safeParse({
    codigo: texto(fd, "codigo"),
    nome: texto(fd, "nome"),
    descricao: texto(fd, "descricao"),
    esfera: texto(fd, "esfera"),
    area: texto(fd, "area"),
    periodicidade: texto(fd, "periodicidade"),
    etapas: fd.getAll("etapas").map(String),
    tributos: fd.getAll("tributos").map(String),
    categorias: fd.getAll("categorias").map(String),
    observacao: texto(fd, "observacao"),
    ativa: id ? marcado(fd, "ativa") : true,
  });
  if (!d.success) return falhaValidacao(d.error);
  const comum = {
    nome: d.data.nome,
    descricao: d.data.descricao || null,
    tributos: d.data.tributos,
    categorias_documento: d.data.categorias,
    observacao: d.data.observacao || null,
  };
  if (id) {
    const { error } = await s.supabase.from("obrigacoes").update({ ...comum, ativa: d.data.ativa }).eq("id", id);
    if (error) return falha(mensagemErro(error));
    revalidar();
    return sucesso("Obrigação atualizada.");
  }
  const { data, error } = await s.supabase
    .from("obrigacoes")
    .insert({ ...comum, codigo: d.data.codigo, esfera: d.data.esfera, area: d.data.area, periodicidade: d.data.periodicidade, etapas: d.data.etapas })
    .select("id")
    .single();
  if (error) return falha(error.code === "23505" ? "Já existe uma obrigação com este código." : mensagemErro(error));
  revalidar();
  return sucesso("Obrigação cadastrada. Agora proponha a regra de prazo com a fonte oficial.", { id: data.id });
}

function lerPrazo(fd: FormData, prefixo: string): EstadoPrazo {
  return {
    tipo: (texto(fd, `${prefixo}_tipo`) as EstadoPrazo["tipo"]) || "",
    dia: texto(fd, `${prefixo}_dia`),
    meses: texto(fd, `${prefixo}_meses`),
    ajuste: texto(fd, `${prefixo}_ajuste`),
    calendario: texto(fd, `${prefixo}_calendario`),
    feriados: texto(fd, `${prefixo}_feriados`),
  };
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function lerProposta(fd: FormData): { ok: true; regra: Record<string, unknown>; fonte: { titulo: string; url: string; publicada: string | null; consultada: string }; titulo: string; resumo: string } | { ok: false; erro: ResultadoAcao } {
  const erros: Record<string, string[]> = {};
  const inicio = lerCompetencia(texto(fd, "vigencia_inicio"));
  const fimTexto = texto(fd, "vigencia_fim");
  const fim = fimTexto ? lerCompetencia(fimTexto) : null;
  if (!inicio) erros.vigencia_inicio = ["Informe a competência inicial da vigência."];
  if (fimTexto && !fim) erros.vigencia_fim = ["Competência final inválida."];
  if (inicio && fim && fim < inicio) erros.vigencia_fim = ["A competência final deve ser igual ou posterior à inicial."];
  const regimes = fd.getAll("regimes").map(String).filter((r) => REGIMES[r]);
  if (!regimes.length) erros.regimes = ["Marque ao menos um regime."];
  const abrangencia = texto(fd, "abrangencia");
  const uf = texto(fd, "uf").toUpperCase();
  const municipio = texto(fd, "municipio");
  if (abrangencia === "uf" && !/^[A-Z]{2}$/.test(uf)) erros.uf = ["Selecione o estado."];
  if (abrangencia === "municipio" && !/^\d{7}$/.test(municipio)) erros.municipio = ["Selecione o município."];
  const prazos: Record<string, RegraPrazo | null> = {};
  for (const p of ["entrega", "pagamento", "apuracao"]) {
    const e = lerPrazo(fd, p);
    const problema = problemaPrazo(e);
    if (problema) erros[`${p}_tipo`] = [problema];
    prazos[p] = montarPrazo(e);
  }
  const interno = texto(fd, "prazo_interno_dias_uteis");
  if (!/^\d+$/.test(interno) || Number(interno) > 30) erros.prazo_interno_dias_uteis = ["Use de 0 a 30 dias úteis."];
  const fonteTitulo = texto(fd, "fonte_titulo");
  const fonteUrl = texto(fd, "fonte_url");
  const consultada = texto(fd, "fonte_consultada_em");
  const publicada = texto(fd, "fonte_publicada_em");
  if (fonteTitulo.length < 4) erros.fonte_titulo = ["Informe a norma (ex.: Lei nº 9.430/1996, art. 5º)."];
  if (fonteUrl && !/^https?:\/\/\S+$/i.test(fonteUrl)) erros.fonte_url = ["Endereço inválido (comece com https://)."];
  if (!DATA.test(consultada)) erros.fonte_consultada_em = ["Informe a data em que a fonte foi consultada."];
  if (publicada && !DATA.test(publicada)) erros.fonte_publicada_em = ["Data inválida."];
  const titulo = texto(fd, "titulo");
  if (titulo.length < 4) erros.titulo = ["Dê um título à proposta (ex.: ISS de Palmas até o dia 10)."];
  if (Object.keys(erros).length) return { ok: false, erro: falha("Revise os campos destacados.", erros) };
  return {
    ok: true,
    titulo,
    resumo: texto(fd, "resumo"),
    fonte: { titulo: fonteTitulo, url: fonteUrl, publicada: publicada || null, consultada },
    regra: {
      vigencia_inicio: inicio,
      vigencia_fim: fim,
      regimes,
      ufs: abrangencia === "uf" ? [uf] : abrangencia === "municipio" && uf ? [uf] : [],
      municipios: abrangencia === "municipio" ? [municipio] : [],
      empresa_id: uuidOuNull(texto(fd, "empresa_id")),
      exige_empregados: marcado(fd, "exige_empregados"),
      exige_folha: marcado(fd, "exige_folha"),
      exige_icms: marcado(fd, "exige_icms"),
      exige_iss: marcado(fd, "exige_iss"),
      lucro_real_apuracao: texto(fd, "lucro_real_apuracao") || null,
      servico: texto(fd, "servico") || null,
      prazo_entrega: prazos.entrega,
      prazo_pagamento: prazos.pagamento,
      prazo_apuracao: prazos.apuracao,
      prazo_interno_dias_uteis: Number(interno),
      observacao: texto(fd, "observacao") || null,
    },
  };
}

export async function proporRegra(obrigacaoId: string, regraAnteriorId: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const p = lerProposta(fd);
  if (!p.ok) return p.erro;
  const { data, error } = await s.supabase.rpc("propor_regra", {
    p_obrigacao_id: obrigacaoId,
    p_titulo: p.titulo,
    p_resumo: p.resumo,
    p_regra: p.regra as never,
    p_fonte_titulo: p.fonte.titulo,
    p_fonte_url: p.fonte.url,
    p_fonte_publicada_em: p.fonte.publicada as unknown as string,
    p_fonte_consultada_em: p.fonte.consultada,
    p_regra_anterior_id: regraAnteriorId ?? undefined,
  });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Proposta registrada. Ela só passa a valer depois de validada e aplicada por um administrador.", { id: data });
}

export async function editarProposta(atualizacaoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const p = lerProposta(fd);
  if (!p.ok) return p.erro;
  const { error } = await s.supabase.rpc("editar_proposta_regra", {
    p_id: atualizacaoId,
    p_titulo: p.titulo,
    p_resumo: p.resumo,
    p_regra: p.regra as never,
    p_fonte_titulo: p.fonte.titulo,
    p_fonte_url: p.fonte.url,
    p_fonte_publicada_em: p.fonte.publicada as unknown as string,
    p_fonte_consultada_em: p.fonte.consultada,
  });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Proposta corrigida.");
}

export async function proporRevogacao(regraId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const vigencia = lerCompetencia(texto(fd, "vigencia_inicio"));
  const fonte = texto(fd, "fonte_titulo");
  const consultada = texto(fd, "fonte_consultada_em");
  const erros: Record<string, string[]> = {};
  if (!vigencia) erros.vigencia_inicio = ["Informe a partir de qual competência a regra deixa de valer."];
  if (fonte.length < 4) erros.fonte_titulo = ["Informe a norma que encerra a regra."];
  if (!DATA.test(consultada)) erros.fonte_consultada_em = ["Informe a data da consulta."];
  if (texto(fd, "titulo").length < 4) erros.titulo = ["Dê um título à proposta."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const publicada = texto(fd, "fonte_publicada_em");
  const { error } = await s.supabase.rpc("propor_revogacao", {
    p_regra_id: regraId,
    p_titulo: texto(fd, "titulo"),
    p_resumo: texto(fd, "resumo"),
    p_vigencia_inicio: vigencia!,
    p_fonte_titulo: fonte,
    p_fonte_url: texto(fd, "fonte_url"),
    p_fonte_publicada_em: (DATA.test(publicada) ? publicada : null) as unknown as string,
    p_fonte_consultada_em: consultada,
  });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Encerramento proposto. Depois de validado e aplicado, as tarefas abertas a partir da vigência são dispensadas com o motivo.");
}

export async function validarNorma(id: string, observacao = ""): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { error } = await s.supabase.rpc("validar_atualizacao_normativa", { p_id: id, p_observacao: observacao.trim() || undefined });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Fonte conferida e proposta validada. Agora aplique para passar a valer.");
}

export async function aplicarNorma(id: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { data, error } = await s.supabase.rpc("aplicar_atualizacao_normativa", { p_id: id });
  if (error) return falha(mensagemErro(error));
  revalidar();
  const r = (data ?? {}) as { tarefas_recalculadas?: number; tarefas_geradas?: number };
  return sucesso(`Regra aplicada. ${r.tarefas_geradas ?? 0} tarefa(s) gerada(s) e ${r.tarefas_recalculadas ?? 0} recalculada(s).`);
}

export async function validarEAplicarNormas(ids: string[], observacao: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  let ok = 0;
  const erros: string[] = [];
  for (const id of ids.filter((i) => UUID.test(i))) {
    const { data: a } = await s.supabase.from("atualizacoes_normativas").select("status, titulo").eq("id", id).single();
    if (!a) continue;
    if (a.status === "proposta") {
      const { error } = await s.supabase.rpc("validar_atualizacao_normativa", { p_id: id, p_observacao: observacao.trim() || undefined });
      if (error) {
        erros.push(`${a.titulo}: ${mensagemErro(error)}`);
        continue;
      }
    }
    const { error } = await s.supabase.rpc("aplicar_atualizacao_normativa", { p_id: id });
    if (error) erros.push(`${a.titulo}: ${mensagemErro(error)}`);
    else ok++;
  }
  revalidar();
  if (erros.length) return falha(`${ok} aplicada(s). Não foi possível aplicar: ${erros.join("; ")}`);
  return sucesso(`${ok} atualização(ões) validada(s) e aplicada(s).`);
}

export async function rejeitarNorma(id: string, motivo: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (motivo.trim().length < 5) return falha("Explique o motivo da rejeição.");
  const { error } = await s.supabase.rpc("rejeitar_atualizacao_normativa", { p_id: id, p_motivo: motivo.trim() });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Proposta rejeitada. Nada foi alterado no calendário.");
}

export interface LinhaSimulacao {
  competencia: string;
  prazo_apuracao: string | null;
  prazo_entrega: string | null;
  prazo_pagamento: string | null;
}

export async function simularRegra(
  prazos: { prazo_entrega: RegraPrazo | null; prazo_pagamento: RegraPrazo | null; prazo_apuracao: RegraPrazo | null },
  periodicidade: string,
  inicio: string,
  local: { uf?: string; municipio?: string; empresaId?: string },
): Promise<ResultadoAcao<LinhaSimulacao[]>> {
  const s = await exigirEquipe();
  const comp = lerCompetencia(inicio);
  if (!comp) return falha("Competência inválida.");
  const meses = periodicidade === "anual" ? 36 : periodicidade === "trimestral" ? 12 : 6;
  const { data, error } = await s.supabase.rpc("simular_regra", {
    p_regra: prazos as never,
    p_periodicidade: periodicidade,
    p_inicio: comp,
    p_meses: meses,
    p_empresa_id: local.empresaId && UUID.test(local.empresaId) ? local.empresaId : undefined,
    p_uf: local.uf || undefined,
    p_municipio: local.municipio || undefined,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso(undefined, (data ?? []) as LinhaSimulacao[]);
}

export async function listarMunicipios(uf: string): Promise<{ ibge: string; nome: string }[]> {
  const s = await exigirEquipe();
  if (!/^[A-Z]{2}$/.test(uf)) return [];
  const { data } = await s.supabase.from("municipios").select("ibge, nome").eq("uf", uf).order("nome").limit(1000);
  return data ?? [];
}

// -----------------------------------------------------------------------------
// Feriados (administrador)
// -----------------------------------------------------------------------------

export async function adicionarFeriado(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const data = texto(fd, "data");
  const nome = texto(fd, "nome");
  const abrangencia = texto(fd, "abrangencia");
  const uf = texto(fd, "uf").toUpperCase();
  const municipio = texto(fd, "municipio");
  const tipo = texto(fd, "tipo") || "feriado";
  const fonte = texto(fd, "fonte");
  const erros: Record<string, string[]> = {};
  if (!DATA.test(data)) erros.data = ["Informe a data."];
  if (nome.length < 2) erros.nome = ["Informe o nome do feriado."];
  if (!["nacional", "estadual", "municipal"].includes(abrangencia)) erros.abrangencia = ["Selecione a abrangência."];
  if (abrangencia === "estadual" && !/^[A-Z]{2}$/.test(uf)) erros.uf = ["Selecione o estado."];
  if (abrangencia === "municipal" && !/^\d{7}$/.test(municipio)) erros.municipio = ["Selecione o município."];
  if (fonte.length < 4) erros.fonte = ["Informe a fonte (lei, decreto ou portaria)."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await s.supabase.from("feriados").insert({
    data,
    nome,
    abrangencia,
    uf: abrangencia === "estadual" ? uf : abrangencia === "municipal" ? uf || null : null,
    municipio_ibge: abrangencia === "municipal" ? municipio : null,
    tipo,
    fonte,
  });
  if (error) return falha(error.code === "23505" ? "Este feriado já está cadastrado." : mensagemErro(error));
  const { data: n } = await s.supabase.rpc("recalcular_tarefas_abertas", { p_motivo: `Feriado cadastrado: ${nome} (${data}).` });
  revalidar();
  return sucesso(`Feriado cadastrado.${n ? ` ${n} tarefa(s) com prazo recalculado.` : ""}`);
}

export async function removerFeriado(id: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { data: f } = await s.supabase.from("feriados").select("nome, data").eq("id", id).single();
  const { error } = await s.supabase.from("feriados").delete().eq("id", id);
  if (error) return falha(mensagemErro(error));
  const { data: n } = await s.supabase.rpc("recalcular_tarefas_abertas", { p_motivo: f ? `Feriado removido: ${f.nome} (${f.data}).` : "Feriado removido." });
  revalidar();
  return sucesso(`Feriado removido.${n ? ` ${n} tarefa(s) com prazo recalculado.` : ""}`);
}
