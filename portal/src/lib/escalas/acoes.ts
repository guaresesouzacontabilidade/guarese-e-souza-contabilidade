"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { conferirEscala } from "./conferencia";
import { feriadosNacionais } from "./feriados";
import { distribuirDeslocamentos, gerarGrade, historicoDaGrade } from "./gerador";
import { MODELO_POR_CHAVE } from "./modelos";
import { criarApelidos } from "./apelidos";
import { ajusteIaSchema, aplicarAjuste, aplicarSugestao, perguntaAjuste, perguntaSugestao, sugestaoIaSchema, type FuncionarioIa } from "./ia-prompt";
import { credencialIa, mensagemDeErro, perguntarIa } from "./ia";
import { configPadrao, configSchema, diasDoMes, gradeSchema, type ConfigEscala, type Grade, type Historico, type Pessoa } from "./tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const texto = (fd: FormData, nome: string, max = 120) => String(fd.get(nome) ?? "").trim().slice(0, max) || null;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/escalas`, "layout");
}

function mesAnterior(competencia: string) {
  const [a, m] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------- funcionários da escala

export async function salvarFuncionario(empresaId: string, funcionarioId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || (funcionarioId && !UUID.test(funcionarioId))) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "escalas.gerenciar");
  const erros: Record<string, string[]> = {};
  const nome = texto(fd, "nome");
  if (!nome || nome.length < 2) erros.nome = ["Informe o nome."];
  const jornada = Number(String(fd.get("jornada_semanal") ?? "44").replace(",", "."));
  if (!Number.isFinite(jornada) || jornada <= 0 || jornada > 44) erros.jornada_semanal = ["Entre 1 e 44 horas por semana."];
  const naoTrabalha = fd.getAll("nao_trabalha").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const dados = {
    empresa_id: empresaId,
    nome: nome!,
    cargo: texto(fd, "cargo", 80),
    setor: texto(fd, "setor", 60),
    jornada_semanal: Math.round(jornada * 10) / 10,
    nao_trabalha: [...new Set(naoTrabalha)].sort(),
    domingo_quinzenal: fd.get("domingo_quinzenal") === "on",
    menor_idade: fd.get("menor_idade") === "on",
    preferencias: texto(fd, "preferencias", 200),
    ativo: fd.get("ativo") !== "off",
  };
  const r = funcionarioId
    ? await ctx.supabase.from("escala_funcionarios").update(dados).eq("id", funcionarioId).eq("empresa_id", empresaId)
    : await ctx.supabase.from("escala_funcionarios").insert(dados);
  if (r.error) return falha(mensagemErro(r.error));
  revalidar(empresaId);
  return sucesso(funcionarioId ? "Funcionário atualizado." : "Funcionário cadastrado.");
}

export async function excluirFuncionario(empresaId: string, funcionarioId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(funcionarioId)) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "escalas.gerenciar");
  const { error } = await ctx.supabase.from("escala_funcionarios").delete().eq("id", funcionarioId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Funcionário removido do cadastro da escala. As escalas já montadas continuam com o nome dele.");
}

/** Traz nome e cargo do cadastro de colaboradores dos cálculos (só para quem vê esse cadastro). */
export async function importarColaboradores(empresaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "escalas.gerenciar");
  if (!ctx.pode("calculos.ver")) return falha("Você não tem acesso ao cadastro de colaboradores dos cálculos.");
  const hoje = new Date().toISOString().slice(0, 10);
  const [{ data: colaboradores, error }, { data: existentes }] = await Promise.all([
    ctx.supabase.from("colaboradores").select("nome, cargo, desligamento").eq("empresa_id", empresaId),
    ctx.supabase.from("escala_funcionarios").select("nome").eq("empresa_id", empresaId),
  ]);
  if (error) return falha(mensagemErro(error));
  const ja = new Set((existentes ?? []).map((e) => e.nome.trim().toLowerCase()));
  const novos = (colaboradores ?? [])
    .filter((c) => !c.desligamento || c.desligamento >= hoje)
    .filter((c) => !ja.has(c.nome.trim().toLowerCase()))
    .map((c) => ({ empresa_id: empresaId, nome: c.nome, cargo: c.cargo }));
  if (!novos.length) return sucesso("Nenhum colaborador novo para trazer.");
  const { error: e2 } = await ctx.supabase.from("escala_funcionarios").insert(novos);
  if (e2) return falha(mensagemErro(e2));
  revalidar(empresaId);
  return sucesso(`${novos.length} colaborador(es) trazido(s) do cadastro. Confira a jornada e as restrições de cada um.`);
}

// ----------------------------------------------------------------------------- escalas

interface LinhaFuncionario {
  id: string;
  nome: string;
  cargo: string | null;
  jornada_semanal: number;
  nao_trabalha: number[];
  domingo_quinzenal: boolean;
  menor_idade: boolean;
}

function pessoaDoCadastro(f: LinhaFuncionario, anterior: Pessoa | undefined, turnoPadrao: string, turnos: Set<string>): Pessoa {
  const base: Pessoa = anterior
    ? { ...anterior, turnos: anterior.turnos.filter((t) => turnos.has(t)) }
    : {
        id: f.id,
        nome: f.nome,
        cargo: f.cargo,
        jornadaSemanal: Number(f.jornada_semanal),
        naoTrabalha: [],
        domingoQuinzenal: false,
        menorIdade: false,
        modelo: "6x1",
        turnos: [turnoPadrao],
        diasTrabalho: [1, 2, 3, 4, 5],
        folgasPreferidas: [],
        deslocamento: 0,
      };
  return {
    ...base,
    nome: f.nome,
    cargo: f.cargo,
    jornadaSemanal: Number(f.jornada_semanal),
    naoTrabalha: f.nao_trabalha ?? [],
    domingoQuinzenal: f.domingo_quinzenal,
    menorIdade: f.menor_idade,
    turnos: base.turnos.length ? base.turnos : [turnoPadrao],
  };
}

/** Grade do mês anterior (qualquer situação), para continuar as contagens. */
async function historicoDoMesAnterior(supabase: Awaited<ReturnType<typeof exigirPermissao>>["supabase"], empresaId: string, competencia: string): Promise<Historico> {
  const { data } = await supabase
    .from("escalas")
    .select("grade, updated_at")
    .eq("empresa_id", empresaId)
    .eq("competencia", mesAnterior(competencia))
    .order("status", { ascending: true }) // "publicada" antes de "rascunho"
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const g = gradeSchema.safeParse(data?.grade ?? {});
  return g.success ? historicoDaGrade(g.data) : {};
}

export async function criarEscala(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "escalas.gerenciar");
  const mes = String(fd.get("mes") ?? "");
  if (!MES.test(mes)) return falha("Escolha o mês.", { mes: ["Escolha o mês."] });
  const competencia = `${mes}-01`;
  const nome = texto(fd, "nome", 80) ?? "Escala";
  const copiarDe = String(fd.get("copiar_de") ?? "");

  const [{ data: funcionarios }, anterior] = await Promise.all([
    ctx.supabase.from("escala_funcionarios").select("id, nome, cargo, jornada_semanal, nao_trabalha, domingo_quinzenal, menor_idade").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    UUID.test(copiarDe)
      ? ctx.supabase.from("escalas").select("config").eq("id", copiarDe).eq("empresa_id", empresaId).maybeSingle()
      : ctx.supabase.from("escalas").select("config").eq("empresa_id", empresaId).order("competencia", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const base = configSchema.safeParse(anterior.data?.config);
  const modelo: ConfigEscala = base.success ? base.data : configPadrao();
  const turnos = new Set(modelo.turnos.map((t) => t.id));
  const antes = new Map(modelo.pessoas.map((p) => [p.id, p]));
  const pessoas = (funcionarios ?? []).map((f) => pessoaDoCadastro(f as LinhaFuncionario, antes.get(f.id), modelo.turnos[0].id, turnos));
  const config: ConfigEscala = {
    ...modelo,
    feriados: feriadosNacionais(competencia),
    // Quem já estava na escala anterior mantém a posição no ciclo; quem é novo ganha uma posição própria
    pessoas: base.success ? pessoas.map((p, i) => (antes.has(p.id) ? p : { ...p, deslocamento: i % 60 })) : distribuirDeslocamentos(pessoas),
  };
  const historico = await historicoDoMesAnterior(ctx.supabase, empresaId, competencia);
  const grade = gerarGrade(config, competencia, { historico });
  const { data, error } = await ctx.supabase
    .from("escalas")
    .insert({ empresa_id: empresaId, nome, competencia, config, grade })
    .select("id")
    .single();
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  redirect(`/e/${empresaId}/escalas/${data.id}`);
}

async function carregar(empresaId: string, escalaId: string) {
  const ctx = await exigirPermissao(empresaId, "escalas.gerenciar");
  const { data, error } = await ctx.supabase.from("escalas").select("id, competencia, config, grade, status").eq("id", escalaId).eq("empresa_id", empresaId).maybeSingle();
  if (error || !data) throw new Error("Escala não encontrada.");
  const config = configSchema.parse(data.config);
  const g = gradeSchema.safeParse(data.grade);
  return { ctx, escala: data, config, grade: (g.success ? g.data : {}) as Grade };
}

function gradeDoTamanhoCerto(grade: Grade, config: ConfigEscala, competencia: string) {
  const n = diasDoMes(competencia).length;
  return config.pessoas.every((p) => grade[p.id]?.length === n);
}

/** Salva a configuração; com "gerar", monta a grade de novo (mantendo férias e afastamentos lançados). */
export async function salvarConfiguracao(empresaId: string, escalaId: string, configJson: string, gerar: boolean): Promise<ResultadoAcao<{ grade: Grade }>> {
  if (!UUID.test(empresaId) || !UUID.test(escalaId)) return falha("Registro inválido.");
  try {
    const { ctx, escala, grade: atual } = await carregar(empresaId, escalaId);
    const r = configSchema.safeParse(JSON.parse(configJson));
    if (!r.success) return falha(`Configuração inválida: ${r.error.issues[0]?.message ?? "revise os campos"}.`);
    const config = r.data;
    let grade: Grade;
    if (gerar) {
      const historico = await historicoDoMesAnterior(ctx.supabase, empresaId, escala.competencia);
      grade = gerarGrade(config, escala.competencia, { historico, manter: atual });
    } else {
      // Sem gerar: pessoas novas recebem a grade gerada; as que saíram somem
      const geradaParaNovos = gerarGrade(config, escala.competencia);
      grade = Object.fromEntries(config.pessoas.map((p) => [p.id, atual[p.id]?.length ? atual[p.id] : geradaParaNovos[p.id]]));
    }
    const { error } = await ctx.supabase.from("escalas").update({ config, grade }).eq("id", escalaId).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(gerar ? "Escala gerada de novo com a configuração." : "Configuração salva.", { grade });
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível salvar.");
  }
}

export async function salvarGrade(empresaId: string, escalaId: string, gradeJson: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(escalaId)) return falha("Registro inválido.");
  try {
    const { ctx, escala, config } = await carregar(empresaId, escalaId);
    const r = gradeSchema.safeParse(JSON.parse(gradeJson));
    if (!r.success || !gradeDoTamanhoCerto(r.data, config, escala.competencia)) return falha("Grade inválida: todos os dias de cada pessoa precisam estar preenchidos.");
    const turnos = new Set(config.turnos.map((t) => t.id));
    if (Object.values(r.data).flat().some((c) => c.startsWith("T") && !turnos.has(c))) return falha("Grade com turno que não existe na configuração.");
    const grade = Object.fromEntries(config.pessoas.map((p) => [p.id, r.data[p.id]]));
    const { error } = await ctx.supabase.from("escalas").update({ grade }).eq("id", escalaId).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Escala salva.");
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível salvar.");
  }
}

export async function renomearEscala(empresaId: string, escalaId: string, nome: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(escalaId)) return falha("Registro inválido.");
  const limpo = nome.trim().slice(0, 80);
  if (limpo.length < 2) return falha("Nome muito curto.");
  const ctx = await exigirPermissao(empresaId, "escalas.gerenciar");
  const { error } = await ctx.supabase.from("escalas").update({ nome: limpo }).eq("id", escalaId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Nome atualizado.");
}

/** Publica (quem tem "ver escalas" passa a ver) ou volta a rascunho. Com erros da CLT, pede confirmação. */
export async function publicarEscala(empresaId: string, escalaId: string, publicar: boolean, mesmoComErros = false): Promise<ResultadoAcao<{ erros: number }>> {
  if (!UUID.test(empresaId) || !UUID.test(escalaId)) return falha("Registro inválido.");
  try {
    const { ctx, escala, config, grade } = await carregar(empresaId, escalaId);
    if (publicar) {
      const historico = await historicoDoMesAnterior(ctx.supabase, empresaId, escala.competencia);
      const r = conferirEscala(config, escala.competencia, grade, historico);
      if (r.erros > 0 && !mesmoComErros) return { ok: false, mensagem: `A conferência encontrou ${r.erros} ponto(s) fora da CLT.`, dados: { erros: r.erros } };
    }
    const { error } = await ctx.supabase
      .from("escalas")
      .update({ status: publicar ? "publicada" : "rascunho" })
      .eq("id", escalaId)
      .eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(publicar ? "Escala publicada." : "A escala voltou para rascunho.");
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível publicar.");
  }
}

export async function excluirEscala(empresaId: string, escalaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(escalaId)) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "escalas.gerenciar");
  const { error } = await ctx.supabase.from("escalas").delete().eq("id", escalaId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  redirect(`/e/${empresaId}/escalas`);
}

// ----------------------------------------------------------------------------- assistente de IA

export interface PropostaIaTela {
  tipo: "sugestao" | "ajuste";
  resumo: string;
  alertas: string[];
  alternativas: { modelo: string; nome: string; motivo: string }[];
  ignorados: string[];
  config: ConfigEscala;
  grade: Grade;
  erros: number;
  alertasClt: number;
  alteradas?: number;
}

async function funcionariosParaIa(supabase: Awaited<ReturnType<typeof exigirPermissao>>["supabase"], empresaId: string, config: ConfigEscala): Promise<FuncionarioIa[]> {
  const { data } = await supabase.from("escala_funcionarios").select("id, preferencias").eq("empresa_id", empresaId);
  const prefs = new Map((data ?? []).map((f) => [f.id, f.preferencias]));
  return config.pessoas.map((p) => ({ id: p.id, nome: p.nome, preferencias: prefs.get(p.id) ?? null }));
}

/**
 * Pede ao assistente uma proposta (modelos, turnos e cobertura) ou um ajuste na
 * grade. Nada é gravado: a proposta volta para a tela, conferida, e só vira a
 * escala se a pessoa clicar em "Aplicar".
 */
export async function pedirAssistente(
  empresaId: string,
  escalaId: string,
  tipo: "sugestao" | "ajuste",
  pedido: string,
): Promise<ResultadoAcao<PropostaIaTela>> {
  if (!UUID.test(empresaId) || !UUID.test(escalaId)) return falha("Registro inválido.");
  const texto = pedido.trim().slice(0, 1500);
  if (tipo === "ajuste" && texto.length < 5) return falha("Escreva o que você quer mudar na escala.");
  let carregado;
  try {
    carregado = await carregar(empresaId, escalaId);
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Escala não encontrada.");
  }
  const { ctx, escala, config, grade } = carregado;
  if (!config.pessoas.length) return falha("Inclua os funcionários na escala antes de pedir ajuda ao assistente.");

  // Reserva o uso (confere permissão, se está ligado e o limite do dia)
  const { data: reserva, error: eReserva } = await ctx.supabase.rpc("escala_ia_reservar", { p_empresa_id: empresaId, p_tipo: tipo === "sugestao" ? "sugerir" : "ajustar" });
  if (eReserva) return falha(mensagemErro(eReserva));
  const usoId = reserva?.[0]?.uso_id;
  const concluir = (ok: boolean, entrada: number | null, saida: number | null, erro: string | null) =>
    usoId ? ctx.supabase.rpc("escala_ia_concluir", { p_uso_id: usoId, p_ok: ok, p_tokens_entrada: entrada ?? 0, p_tokens_saida: saida ?? 0, p_erro: erro ?? "" }) : null;

  try {
    const credencial = await credencialIa();
    if (!credencial) {
      await concluir(false, null, null, "desconectado");
      return falha("O assistente de IA está desconectado. O administrador do escritório precisa cadastrar a chave em Configurações → Integrações.");
    }
    const historico = await historicoDoMesAnterior(ctx.supabase, empresaId, escala.competencia);
    const funcionarios = await funcionariosParaIa(ctx.supabase, empresaId, config);
    const apelidos = criarApelidos(config.pessoas);

    if (tipo === "sugestao") {
      const pergunta = perguntaSugestao(config, escala.competencia, texto, funcionarios, apelidos);
      const r = await perguntarIa(credencial, pergunta, sugestaoIaSchema);
      const proposta = aplicarSugestao(config, r.dados, apelidos);
      const novaConfig = { ...proposta.config, pessoas: distribuirDeslocamentos(proposta.config.pessoas) };
      const novaGrade = gerarGrade(novaConfig, escala.competencia, { historico, manter: grade });
      const conf = conferirEscala(novaConfig, escala.competencia, novaGrade, historico);
      await concluir(true, r.tokensEntrada, r.tokensSaida, null);
      return sucesso("Proposta pronta. Confira antes de aplicar.", {
        tipo,
        resumo: proposta.resumo,
        alertas: proposta.alertas,
        alternativas: proposta.alternativas.map((a) => ({ ...a, nome: MODELO_POR_CHAVE[a.modelo as keyof typeof MODELO_POR_CHAVE]?.nome ?? a.modelo })),
        ignorados: proposta.ignorados,
        config: novaConfig,
        grade: novaGrade,
        erros: conf.erros,
        alertasClt: conf.alertas,
      });
    }

    const confAtual = conferirEscala(config, escala.competencia, grade, historico);
    const pergunta = perguntaAjuste(config, escala.competencia, grade, confAtual, texto, funcionarios, apelidos);
    const r = await perguntarIa(credencial, pergunta, ajusteIaSchema);
    const ajuste = aplicarAjuste(config, escala.competencia, grade, r.dados, apelidos);
    const conf = conferirEscala(config, escala.competencia, ajuste.grade, historico);
    await concluir(true, r.tokensEntrada, r.tokensSaida, null);
    return sucesso(ajuste.alteradas ? `${ajuste.alteradas} dia(s) alterado(s). Confira antes de aplicar.` : "O assistente não alterou nenhum dia.", {
      tipo,
      resumo: ajuste.resumo,
      alertas: ajuste.alertas,
      alternativas: [],
      ignorados: ajuste.ignorados,
      config,
      grade: ajuste.grade,
      erros: conf.erros,
      alertasClt: conf.alertas,
      alteradas: ajuste.alteradas,
    });
  } catch (e) {
    const msg = mensagemDeErro(e);
    console.error("[escalas] assistente de IA", e instanceof Error ? e.name : typeof e);
    await concluir(false, null, null, msg);
    return falha(msg);
  }
}

/** Grava a proposta do assistente que a pessoa conferiu e aceitou. */
export async function aplicarProposta(
  empresaId: string,
  escalaId: string,
  tipo: "sugestao" | "ajuste",
  configJson: string,
  gradeJson: string,
  resumo: string,
): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(escalaId)) return falha("Registro inválido.");
  try {
    const { ctx, escala, config: atual, grade: gradeAtual } = await carregar(empresaId, escalaId);
    let config = atual;
    let grade: Grade;
    if (tipo === "sugestao") {
      const r = configSchema.safeParse(JSON.parse(configJson));
      if (!r.success) return falha("Proposta inválida.");
      // As pessoas da escala não mudam pela proposta (só modelo, turnos e dias)
      const ids = new Set(atual.pessoas.map((p) => p.id));
      if (r.data.pessoas.length !== atual.pessoas.length || r.data.pessoas.some((p) => !ids.has(p.id))) return falha("A lista de pessoas mudou. Peça a proposta de novo.");
      config = r.data;
      const historico = await historicoDoMesAnterior(ctx.supabase, empresaId, escala.competencia);
      grade = gerarGrade(config, escala.competencia, { historico, manter: gradeAtual });
    } else {
      const r = gradeSchema.safeParse(JSON.parse(gradeJson));
      if (!r.success || !gradeDoTamanhoCerto(r.data, atual, escala.competencia)) return falha("Proposta inválida.");
      const turnos = new Set(atual.turnos.map((t) => t.id));
      if (Object.values(r.data).flat().some((c) => c.startsWith("T") && !turnos.has(c))) return falha("Proposta com turno inexistente.");
      grade = Object.fromEntries(atual.pessoas.map((p) => [p.id, r.data[p.id]]));
    }
    const { error } = await ctx.supabase
      .from("escalas")
      .update({ config, grade, ia_resumo: resumo.trim().slice(0, 4000) || null })
      .eq("id", escalaId)
      .eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Proposta do assistente aplicada na escala.");
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível aplicar.");
  }
}
