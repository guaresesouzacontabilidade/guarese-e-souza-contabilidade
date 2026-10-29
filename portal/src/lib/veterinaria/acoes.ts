"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import { validarCpf } from "@/lib/formatos";
import type { Json } from "@/lib/supabase/database.types";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { TIPOS_DOCUMENTO } from "./rotulos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
/** Fuso da clínica (o mesmo do escritório): sem horário de verão. */
const FUSO = "-03:00";

function texto(fd: FormData, nome: string, max = 1000) {
  return String(fd.get(nome) ?? "")
    .trim()
    .slice(0, max);
}

function digitos(fd: FormData, nome: string) {
  return texto(fd, nome, 40).replace(/\D/g, "");
}

/** Valor em reais digitado no padrão brasileiro ("1.234,50") → "1234.50"; vazio → "". */
function dinheiro(fd: FormData, nome: string): string | null {
  const v = texto(fd, nome, 30);
  if (!v) return "";
  const d = lerValorBR(v);
  return d ? d.toFixed(2) : null;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/veterinaria`, "layout");
}

/** Contexto com a permissão da clínica (o banco confere de novo a permissão, a modalidade e o veterinário). */
async function contexto(empresaId: string, gerente = false) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.loja || ctx.acesso.gestao_modalidade !== "veterinaria") throw new Error("A gestão da clínica veterinária não está ligada para esta empresa.");
  if (!ctx.pode(gerente ? "gestao.gerenciar" : "gestao.vender")) {
    throw new Error(gerente ? "Só o responsável pela clínica pode fazer isto." : "Você não tem acesso à clínica.");
  }
  return ctx;
}

async function executar<T>(fn: () => Promise<ResultadoAcao<T>>): Promise<ResultadoAcao<T>> {
  try {
    return await fn();
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível concluir a operação.");
  }
}

function idValido(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID.test(id);
}

// -----------------------------------------------------------------------------
// Configurações do responsável
// -----------------------------------------------------------------------------
export async function salvarConfiguracaoClinica(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const erros: Record<string, string[]> = {};
    const tel = digitos(fd, "telefone");
    if (tel && (tel.length < 10 || tel.length > 13)) erros.telefone = ["Telefone com DDD."];
    for (const c of ["horario_inicio", "horario_fim"]) if (texto(fd, c) && !HORA.test(texto(fd, c))) erros[c] = ["Hora inválida."];
    const dias = Number(texto(fd, "lembrete_dias_antes") || "7");
    if (!Number.isInteger(dias) || dias < 0 || dias > 60) erros.lembrete_dias_antes = ["De 0 a 60 dias."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("vet_configurar", {
      p_empresa_id: empresaId,
      p_dados: {
        nome_clinica: texto(fd, "nome_clinica", 120),
        registro_crmv: texto(fd, "registro_crmv", 30),
        telefone: tel,
        email: texto(fd, "email", 200),
        endereco: texto(fd, "endereco", 300),
        cidade_documentos: texto(fd, "cidade_documentos", 80),
        horario_inicio: texto(fd, "horario_inicio"),
        horario_fim: texto(fd, "horario_fim"),
        duracao_padrao_min: texto(fd, "duracao_padrao_min"),
        lembrete_dias_antes: dias,
        lembrete_email: fd.get("lembrete_email") === "on",
        mensagem_vacina: texto(fd, "mensagem_vacina", 600),
        mensagem_retorno: texto(fd, "mensagem_retorno", 600),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Configurações da clínica salvas.");
  });
}

export async function salvarVeterinario(empresaId: string, veterinarioId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (veterinarioId && !idValido(veterinarioId)) return falha("Veterinário inválido.");
    const ctx = await contexto(empresaId, true);
    const erros: Record<string, string[]> = {};
    if (texto(fd, "nome").length < 3) erros.nome = ["Informe o nome completo."];
    if (!/^[0-9A-Za-z./-]{1,15}$/.test(texto(fd, "crmv"))) erros.crmv = ["Número do CRMV."];
    if (!/^[A-Za-z]{2}$/.test(texto(fd, "crmv_uf"))) erros.crmv_uf = ["UF do CRMV."];
    const perfil = texto(fd, "perfil_id");
    if (perfil && !UUID.test(perfil)) erros.perfil_id = ["Escolha o usuário."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("vet_veterinario_salvar", {
      p_empresa_id: empresaId,
      p_id: veterinarioId as string,
      p_dados: {
        nome: texto(fd, "nome", 120),
        crmv: texto(fd, "crmv", 15),
        crmv_uf: texto(fd, "crmv_uf", 2).toUpperCase(),
        cadastro_mapa: texto(fd, "cadastro_mapa", 30),
        especialidade: texto(fd, "especialidade", 80),
        telefone: digitos(fd, "telefone"),
        email: texto(fd, "email", 200),
        perfil_id: perfil,
        responsavel_tecnico: fd.get("responsavel_tecnico") === "on",
        ativo: fd.has("ativo") ? fd.getAll("ativo").includes("on") : true,
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Veterinário salvo.");
  });
}

export async function salvarVacinaCatalogo(empresaId: string, vacinaId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (vacinaId && !idValido(vacinaId)) return falha("Vacina inválida.");
    const ctx = await contexto(empresaId, true);
    if (texto(fd, "nome").length < 2) return falha("Revise os campos destacados.", { nome: ["Informe o nome da vacina."] });
    const { error } = await ctx.supabase.rpc("vet_vacina_salvar", {
      p_empresa_id: empresaId,
      p_id: vacinaId as string,
      p_dados: {
        nome: texto(fd, "nome", 80),
        especie: texto(fd, "especie", 20),
        fabricante: texto(fd, "fabricante", 80),
        doses_iniciais: texto(fd, "doses_iniciais", 3),
        intervalo_doses_dias: texto(fd, "intervalo_doses_dias", 4),
        reforco_dias: texto(fd, "reforco_dias", 5),
        observacao: texto(fd, "observacao", 300),
        ativa: fd.has("ativa") ? fd.getAll("ativa").includes("on") : true,
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Vacina salva no catálogo.");
  });
}

export async function salvarServico(empresaId: string, servicoId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (servicoId && !idValido(servicoId)) return falha("Serviço inválido.");
    const ctx = await contexto(empresaId, true);
    const preco = dinheiro(fd, "preco");
    if (texto(fd, "nome").length < 2 || preco === null || preco === "") {
      return falha("Revise os campos destacados.", {
        ...(texto(fd, "nome").length < 2 ? { nome: ["Informe o nome do serviço."] } : {}),
        ...(preco === null || preco === "" ? { preco: ["Informe o preço (pode ser 0)."] } : {}),
      });
    }
    const { error } = await ctx.supabase.rpc("vet_servico_salvar", {
      p_empresa_id: empresaId,
      p_id: servicoId as string,
      p_dados: { nome: texto(fd, "nome", 80), categoria: texto(fd, "categoria", 20), preco, ativo: fd.has("ativo") ? fd.getAll("ativo").includes("on") : true },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Serviço salvo.");
  });
}

// -----------------------------------------------------------------------------
// Tutores e animais (recepção)
// -----------------------------------------------------------------------------
export async function salvarTutor(empresaId: string, tutorId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (tutorId && !idValido(tutorId)) return falha("Tutor inválido.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    if (texto(fd, "nome").length < 2) erros.nome = ["Informe o nome completo."];
    const cpf = digitos(fd, "cpf");
    if (cpf && !validarCpf(cpf)) erros.cpf = ["CPF inválido."];
    for (const c of ["telefone", "telefone2"]) {
      const t = digitos(fd, c);
      if (t && (t.length < 10 || t.length > 13)) erros[c] = ["Telefone com DDD."];
    }
    const email = texto(fd, "email", 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.email = ["E-mail inválido."];
    const cep = digitos(fd, "cep");
    if (cep && cep.length !== 8) erros.cep = ["CEP com 8 números."];
    const uf = texto(fd, "uf", 2).toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) erros.uf = ["UF com 2 letras."];
    if (fd.get("aceita_email") === "on" && !email) erros.email = ["Para lembretes por e-mail, informe o e-mail."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { data, error } = await ctx.supabase.rpc("vet_tutor_salvar", {
      p_empresa_id: empresaId,
      p_id: tutorId as string,
      p_dados: {
        nome: texto(fd, "nome", 120),
        cpf,
        telefone: digitos(fd, "telefone"),
        telefone2: digitos(fd, "telefone2"),
        email,
        cep,
        logradouro: texto(fd, "logradouro", 150),
        numero: texto(fd, "numero", 20),
        complemento: texto(fd, "complemento", 80),
        bairro: texto(fd, "bairro", 80),
        cidade: texto(fd, "cidade", 80),
        uf,
        autorizados: texto(fd, "autorizados", 500),
        observacoes: texto(fd, "observacoes", 1000),
        aceita_whatsapp: fd.get("aceita_whatsapp") === "on",
        aceita_email: fd.get("aceita_email") === "on",
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(tutorId ? "Cadastro do tutor salvo." : "Tutor cadastrado.", { id: data as string });
  });
}

export async function excluirTutor(empresaId: string, tutorId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(tutorId)) return falha("Tutor inválido.");
    const ctx = await contexto(empresaId, true);
    const { error } = await ctx.supabase.rpc("vet_tutor_excluir", { p_tutor_id: tutorId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Cadastro excluído.");
  });
}

export async function salvarPaciente(empresaId: string, pacienteId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (pacienteId && !idValido(pacienteId)) return falha("Animal inválido.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    if (!UUID.test(texto(fd, "tutor_id"))) erros.tutor_id = ["Escolha o tutor."];
    if (!texto(fd, "nome")) erros.nome = ["Informe o nome do animal."];
    if (!texto(fd, "especie")) erros.especie = ["Escolha a espécie."];
    if (texto(fd, "especie") === "outra" && !texto(fd, "especie_outra")) erros.especie_outra = ["Diga qual espécie."];
    const nasc = texto(fd, "nascimento");
    if (nasc && !DATA.test(nasc)) erros.nascimento = ["Data inválida."];
    const peso = texto(fd, "peso_kg", 12);
    if (peso && !/^\d{1,4}([.,]\d{1,3})?$/.test(peso)) erros.peso_kg = ["Peso em kg, ex.: 12,5."];
    const chip = texto(fd, "microchip", 30).replace(/\s/g, "");
    if (chip && !/^[0-9A-Za-z]{6,23}$/.test(chip)) erros.microchip = ["De 6 a 23 letras ou números."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { data, error } = await ctx.supabase.rpc("vet_paciente_salvar", {
      p_empresa_id: empresaId,
      p_id: pacienteId as string,
      p_dados: {
        tutor_id: texto(fd, "tutor_id"),
        nome: texto(fd, "nome", 80),
        especie: texto(fd, "especie", 20),
        especie_outra: texto(fd, "especie_outra", 60),
        raca: texto(fd, "raca", 80),
        sexo: texto(fd, "sexo", 20),
        castrado: fd.get("castrado") === "on",
        nascimento: nasc,
        nascimento_estimado: fd.get("nascimento_estimado") === "on",
        pelagem: texto(fd, "pelagem", 80),
        porte: texto(fd, "porte", 20),
        peso_kg: peso,
        microchip: chip,
        sinais_particulares: texto(fd, "sinais_particulares", 300),
        alergias: texto(fd, "alergias", 500),
        observacoes: texto(fd, "observacoes", 1000),
        ...(fd.has("ativo") ? { ativo: fd.getAll("ativo").includes("on") } : {}),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(pacienteId ? "Cadastro do animal salvo." : "Animal cadastrado.", { id: data as string });
  });
}

export async function excluirPaciente(empresaId: string, pacienteId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(pacienteId)) return falha("Animal inválido.");
    const ctx = await contexto(empresaId, true);
    const { error } = await ctx.supabase.rpc("vet_paciente_excluir", { p_paciente_id: pacienteId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Cadastro excluído.");
  });
}

// -----------------------------------------------------------------------------
// Agenda (recepção)
// -----------------------------------------------------------------------------
export async function salvarAgendamento(empresaId: string, agendaId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (agendaId && !idValido(agendaId)) return falha("Agendamento inválido.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    const dia = texto(fd, "dia");
    const hora = texto(fd, "hora");
    if (!DATA.test(dia)) erros.dia = ["Escolha o dia."];
    if (!HORA.test(hora)) erros.hora = ["Escolha a hora."];
    const paciente = texto(fd, "paciente_id");
    if (paciente && !UUID.test(paciente)) erros.paciente_id = ["Escolha o animal."];
    if (!paciente && texto(fd, "nome_avulso").length < 2) erros.nome_avulso = ["Escolha o animal ou escreva o nome de quem vai trazer."];
    const tel = digitos(fd, "telefone_avulso");
    if (!paciente && tel && (tel.length < 10 || tel.length > 13)) erros.telefone_avulso = ["Telefone com DDD."];
    const vet = texto(fd, "veterinario_id");
    if (vet && !UUID.test(vet)) erros.veterinario_id = ["Escolha o veterinário."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("vet_agenda_salvar", {
      p_empresa_id: empresaId,
      p_id: agendaId as string,
      p_dados: {
        inicio: `${dia}T${hora}:00${FUSO}`,
        duracao_min: texto(fd, "duracao_min", 4),
        tipo: texto(fd, "tipo", 20),
        paciente_id: paciente,
        nome_avulso: paciente ? "" : texto(fd, "nome_avulso", 120),
        telefone_avulso: paciente ? "" : tel,
        veterinario_id: vet,
        observacoes: texto(fd, "observacoes", 500),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(agendaId ? "Agendamento alterado." : "Agendado.");
  });
}

export async function mudarStatusAgenda(empresaId: string, agendaId: string, status: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(agendaId)) return falha("Agendamento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_agenda_status", { p_agenda_id: agendaId, p_status: status });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Agenda atualizada.");
  });
}

// -----------------------------------------------------------------------------
// Prontuário (veterinário)
// -----------------------------------------------------------------------------
export async function abrirAtendimento(empresaId: string, dados: { paciente_id?: string; agendamento_id?: string; tipo?: string }): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (dados.paciente_id && !idValido(dados.paciente_id)) return falha("Animal inválido.");
    if (dados.agendamento_id && !idValido(dados.agendamento_id)) return falha("Agendamento inválido.");
    const ctx = await contexto(empresaId);
    const { data, error } = await ctx.supabase.rpc("vet_atendimento_abrir", {
      p_empresa_id: empresaId,
      p_dados: { paciente_id: dados.paciente_id ?? "", agendamento_id: dados.agendamento_id ?? "", tipo: dados.tipo ?? "" },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Atendimento aberto.", { id: data as string });
  });
}

const CAMPOS_PRONTUARIO = [
  ["tipo", 20],
  ["local", 120],
  ["relato", 5000],
  ["anamnese", 10000],
  ["peso_kg", 12],
  ["temperatura", 6],
  ["frequencia_cardiaca", 4],
  ["frequencia_respiratoria", 4],
  ["tpc", 4],
  ["mucosas", 60],
  ["hidratacao", 60],
  ["estado_geral", 300],
  ["exame_fisico", 10000],
  ["diagnostico_presuntivo", 2000],
  ["diagnostico_conclusivo", 2000],
  ["procedimentos", 5000],
  ["tratamento", 5000],
  ["orientacoes", 5000],
  ["retorno_em", 10],
  ["retorno_motivo", 200],
] as const;

export async function salvarAtendimento(empresaId: string, atendimentoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(atendimentoId)) return falha("Atendimento inválido.");
    const ctx = await contexto(empresaId);
    const dados: Record<string, string> = {};
    for (const [c, max] of CAMPOS_PRONTUARIO) dados[c] = texto(fd, c, max);
    const erros: Record<string, string[]> = {};
    for (const c of ["peso_kg", "temperatura", "tpc"]) if (dados[c] && !/^\d{1,4}([.,]\d{1,3})?$/.test(dados[c])) erros[c] = ["Só números (ex.: 12,5)."];
    for (const c of ["frequencia_cardiaca", "frequencia_respiratoria"]) if (dados[c] && !/^\d{1,3}$/.test(dados[c])) erros[c] = ["Só números."];
    if (dados.retorno_em && !DATA.test(dados.retorno_em)) erros.retorno_em = ["Data inválida."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("vet_atendimento_salvar", { p_atendimento_id: atendimentoId, p_dados: dados });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Prontuário salvo.");
  });
}

export async function finalizarAtendimento(empresaId: string, atendimentoId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(atendimentoId)) return falha("Atendimento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_atendimento_finalizar", { p_atendimento_id: atendimentoId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Atendimento finalizado. A partir de agora, correções entram como adendo.");
  });
}

export async function cancelarAtendimento(empresaId: string, atendimentoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(atendimentoId)) return falha("Atendimento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_atendimento_cancelar", { p_atendimento_id: atendimentoId, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Atendimento cancelado.");
  });
}

export async function registrarAdendo(empresaId: string, atendimentoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(atendimentoId)) return falha("Atendimento inválido.");
    const ctx = await contexto(empresaId);
    const t = texto(fd, "texto", 5000);
    if (t.length < 3) return falha("Revise os campos destacados.", { texto: ["Escreva o adendo."] });
    const { error } = await ctx.supabase.rpc("vet_adendo_registrar", { p_atendimento_id: atendimentoId, p_texto: t });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Adendo registrado no prontuário.");
  });
}

// -----------------------------------------------------------------------------
// Receitas (veterinário)
// -----------------------------------------------------------------------------
interface ItemReceita {
  medicamento?: string;
  concentracao?: string;
  forma_farmaceutica?: string;
  quantidade?: string;
  via?: string;
  posologia?: string;
  duracao?: string;
  uso?: string;
}

export async function emitirReceita(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    const ctx = await contexto(empresaId);
    let itens: ItemReceita[] = [];
    try {
      const lidos = JSON.parse(texto(fd, "itens", 60000) || "[]") as unknown;
      if (Array.isArray(lidos)) itens = lidos.slice(0, 30) as ItemReceita[];
    } catch {
      return falha("Itens da receita inválidos.");
    }
    itens = itens.filter((i) => (i.medicamento ?? "").trim() || (i.posologia ?? "").trim());
    if (!itens.length) return falha("Inclua pelo menos um medicamento.");
    const paciente = texto(fd, "paciente_id");
    const atendimento = texto(fd, "atendimento_id");
    if (paciente && !UUID.test(paciente)) return falha("Animal inválido.");
    if (atendimento && !UUID.test(atendimento)) return falha("Atendimento inválido.");
    const { data, error } = await ctx.supabase.rpc("vet_receita_emitir", {
      p_empresa_id: empresaId,
      p_dados: {
        paciente_id: paciente,
        atendimento_id: atendimento,
        tipo: texto(fd, "tipo", 30),
        uso_continuo: fd.get("uso_continuo") === "on",
        observacoes: texto(fd, "observacoes", 2000),
        itens: itens.map((i) => ({
          medicamento: String(i.medicamento ?? "").slice(0, 300),
          concentracao: String(i.concentracao ?? "").slice(0, 120),
          forma_farmaceutica: String(i.forma_farmaceutica ?? "").slice(0, 80),
          quantidade: String(i.quantidade ?? "").slice(0, 80),
          via: String(i.via ?? "oral").slice(0, 20),
          posologia: String(i.posologia ?? "").slice(0, 1000),
          duracao: String(i.duracao ?? "").slice(0, 80),
          uso: String(i.uso ?? "veterinario").slice(0, 20),
        })) as unknown as Json,
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Receita emitida.", { id: data as string });
  });
}

export async function cancelarReceita(empresaId: string, receitaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(receitaId)) return falha("Receita inválida.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_receita_cancelar", { p_receita_id: receitaId, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Receita cancelada.");
  });
}

// -----------------------------------------------------------------------------
// Vacinas (veterinário; carteira anterior pela recepção) e lembretes
// -----------------------------------------------------------------------------
export async function registrarVacinacao(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    const origem = texto(fd, "origem") === "externa" ? "externa" : "clinica";
    const vacina = texto(fd, "vacina_id");
    if (vacina && !UUID.test(vacina)) erros.vacina_id = ["Escolha a vacina."];
    if (!vacina && texto(fd, "vacina_nome").length < 2) erros.vacina_id = ["Escolha a vacina do catálogo ou escreva o nome."];
    for (const c of ["aplicada_em", "fabricacao", "validade", "proxima_dose_em"]) if (texto(fd, c) && !DATA.test(texto(fd, c))) erros[c] = ["Data inválida."];
    if (origem === "clinica") {
      if (!texto(fd, "partida")) erros.partida = ["Informe a partida (lote) do frasco."];
      if (!texto(fd, "fabricacao")) erros.fabricacao = ["Informe a fabricação."];
      if (!texto(fd, "validade")) erros.validade = ["Informe a validade."];
    }
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("vet_vacinacao_registrar", {
      p_empresa_id: empresaId,
      p_dados: {
        paciente_id: texto(fd, "paciente_id"),
        atendimento_id: texto(fd, "atendimento_id"),
        vacina_id: vacina,
        vacina_nome: texto(fd, "vacina_nome", 80),
        fabricante: texto(fd, "fabricante", 80),
        partida: texto(fd, "partida", 40),
        fabricacao: texto(fd, "fabricacao"),
        validade: texto(fd, "validade"),
        dose: texto(fd, "dose", 10),
        aplicada_em: texto(fd, "aplicada_em"),
        origem,
        veterinario_externo: texto(fd, "veterinario_externo", 160),
        proxima_dose_em: texto(fd, "proxima_dose_em"),
        observacao: texto(fd, "observacao", 300),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(origem === "clinica" ? "Vacina registrada na carteira." : "Vacina anterior registrada na carteira.");
  });
}

export async function cancelarVacinacao(empresaId: string, vacinacaoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(vacinacaoId)) return falha("Registro inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_vacinacao_cancelar", { p_vacinacao_id: vacinacaoId, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Registro da vacina cancelado.");
  });
}

/** A recepção abriu o WhatsApp da clínica com o lembrete (ou ligou): fica no histórico. */
export async function registrarAviso(empresaId: string, dados: { tipo: "vacina" | "retorno"; referencia_id: string; canal: "whatsapp" | "telefone" }): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(dados.referencia_id)) return falha("Lembrete inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_aviso_registrar", { p_empresa_id: empresaId, p_dados: dados });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(dados.canal === "telefone" ? "Ligação registrada." : "Aviso pelo WhatsApp registrado.");
  });
}

// -----------------------------------------------------------------------------
// Atestados e termos (veterinário)
// -----------------------------------------------------------------------------
export async function emitirDocumento(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    const ctx = await contexto(empresaId);
    const tipo = texto(fd, "tipo", 40);
    const def = TIPOS_DOCUMENTO[tipo];
    if (!def) return falha("Escolha o documento.");
    const dados: Record<string, unknown> = {
      observacoes_veterinario: texto(fd, "observacoes_veterinario", 2000),
      observacoes_responsavel: texto(fd, "observacoes_responsavel", 2000),
    };
    const erros: Record<string, string[]> = {};
    for (const c of def.campos) {
      let v = texto(fd, c.nome, c.tipo === "area" ? 2000 : 200);
      if (c.tipo === "datahora" && v) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) erros[c.nome] = ["Dia e hora inválidos."];
        else v = `${v}:00${FUSO}`;
      }
      if (c.obrigatorio && !v) erros[c.nome] = ["Preencha este campo."];
      dados[c.nome] = v;
    }
    if (tipo === "atestado_vacinacao") {
      const ids = fd.getAll("vacinacao").map(String).filter((x) => UUID.test(x));
      if (!ids.length) erros.vacinacao = ["Escolha as vacinas do atestado."];
      dados.vacinacoes = ids;
    }
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { data, error } = await ctx.supabase.rpc("vet_documento_emitir", {
      p_empresa_id: empresaId,
      p_dados: { tipo, paciente_id: texto(fd, "paciente_id"), atendimento_id: texto(fd, "atendimento_id"), dados: dados as Json },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`${def.rotulo} emitido.`, { id: data as string });
  });
}

export async function cancelarDocumento(empresaId: string, documentoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(documentoId)) return falha("Documento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_documento_cancelar", { p_documento_id: documentoId, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Documento cancelado.");
  });
}

// -----------------------------------------------------------------------------
// Contas da clínica (recepção; estorno pelo responsável)
// -----------------------------------------------------------------------------
export async function abrirConta(empresaId: string, dados: { tutor_id?: string; paciente_id?: string; atendimento_id?: string }): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    for (const v of Object.values(dados)) if (v && !UUID.test(v)) return falha("Escolha inválida.");
    const ctx = await contexto(empresaId);
    const { data, error } = await ctx.supabase.rpc("vet_conta_abrir", {
      p_empresa_id: empresaId,
      p_dados: { tutor_id: dados.tutor_id ?? "", paciente_id: dados.paciente_id ?? "", atendimento_id: dados.atendimento_id ?? "" },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(undefined, { id: data as string });
  });
}

export async function lancarItemConta(empresaId: string, contaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(contaId)) return falha("Conta inválida.");
    const ctx = await contexto(empresaId);
    const servico = texto(fd, "servico_id");
    const valor = dinheiro(fd, "valor_unitario");
    const qtd = texto(fd, "quantidade", 10).replace(",", ".") || "1";
    const erros: Record<string, string[]> = {};
    if (servico && !UUID.test(servico)) erros.servico_id = ["Escolha o serviço."];
    if (!servico && (texto(fd, "descricao").length < 2 || !valor)) erros.descricao = ["Escolha o serviço ou escreva a descrição e o valor."];
    if (valor === null) erros.valor_unitario = ["Valor inválido."];
    if (!/^\d{1,4}(\.\d{1,3})?$/.test(qtd) || Number(qtd) <= 0) erros.quantidade = ["Quantidade inválida."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("vet_conta_item_lancar", {
      p_conta_id: contaId,
      p_dados: { servico_id: servico, descricao: texto(fd, "descricao", 120), valor_unitario: valor ?? "", quantidade: qtd },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Lançado na conta.");
  });
}

export async function cancelarItemConta(empresaId: string, itemId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(itemId)) return falha("Item inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_conta_item_cancelar", { p_item_id: itemId, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Item cancelado.");
  });
}

export async function aplicarDescontoConta(empresaId: string, contaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(contaId)) return falha("Conta inválida.");
    const ctx = await contexto(empresaId);
    const d = dinheiro(fd, "desconto");
    if (d === null) return falha("Revise os campos destacados.", { desconto: ["Valor inválido."] });
    const { error } = await ctx.supabase.rpc("vet_conta_desconto", { p_conta_id: contaId, p_desconto: Number(d || "0") });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Desconto aplicado.");
  });
}

export async function registrarPagamento(empresaId: string, contaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(contaId)) return falha("Conta inválida.");
    const ctx = await contexto(empresaId);
    const forma = texto(fd, "forma", 20);
    const valor = dinheiro(fd, "valor");
    const erros: Record<string, string[]> = {};
    if (!forma) erros.forma = ["Escolha a forma de pagamento."];
    if (!valor || Number(valor) <= 0) erros.valor = ["Informe o valor recebido."];
    const venc = texto(fd, "vencimento");
    if (forma === "a_receber" && !DATA.test(venc)) erros.vencimento = ["Informe o vencimento combinado."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("vet_pagamento_registrar", {
      p_conta_id: contaId,
      p_dados: { forma, valor: valor as string, vencimento: forma === "a_receber" ? venc : "", observacao: texto(fd, "observacao", 300) },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    revalidatePath(`/e/${empresaId}/loja/caixa`);
    return sucesso(forma === "a_receber" ? "Lançado em contas a receber." : "Pagamento recebido.");
  });
}

export async function estornarPagamento(empresaId: string, pagamentoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(pagamentoId)) return falha("Pagamento inválido.");
    const ctx = await contexto(empresaId, true);
    const { error } = await ctx.supabase.rpc("vet_pagamento_estornar", { p_pagamento_id: pagamentoId, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Pagamento estornado.");
  });
}

export async function fecharConta(empresaId: string, contaId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(contaId)) return falha("Conta inválida.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_conta_fechar", { p_conta_id: contaId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Conta fechada.");
  });
}

export async function cancelarConta(empresaId: string, contaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(contaId)) return falha("Conta inválida.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_conta_cancelar", { p_conta_id: contaId, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Conta cancelada.");
  });
}

// -----------------------------------------------------------------------------
// Anexos do prontuário (laudos e imagens): o arquivo vai do navegador direto ao
// armazenamento privado por uma URL temporária criada depois que o banco valida
// -----------------------------------------------------------------------------
export async function iniciarAnexo(
  empresaId: string,
  atendimentoId: string,
  arquivo: { nome: string; mime: string; tamanho: number; descricao?: string },
): Promise<ResultadoAcao<{ id: string; url: string }>> {
  return executar(async () => {
    if (!idValido(atendimentoId)) return falha("Atendimento inválido.");
    const ctx = await contexto(empresaId);
    const { data, error } = await ctx.supabase.rpc("vet_anexo_iniciar", {
      p_atendimento_id: atendimentoId,
      p_dados: { nome: arquivo.nome.slice(0, 200), mime: arquivo.mime, tamanho: arquivo.tamanho, descricao: (arquivo.descricao ?? "").slice(0, 200) },
    });
    if (error) return falha(mensagemErro(error));
    const r = data as { id: string; caminho: string };
    const { criarClienteAdmin } = await import("@/lib/supabase/admin");
    const { data: url, error: erroUrl } = await criarClienteAdmin().storage.from("vet-anexos").createSignedUploadUrl(r.caminho);
    if (erroUrl || !url) return falha("Não foi possível preparar o envio. Tente novamente.");
    return sucesso(undefined, { id: r.id, url: url.signedUrl });
  });
}

export async function confirmarAnexo(empresaId: string, anexoId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(anexoId)) return falha("Anexo inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("vet_anexo_confirmar", { p_anexo_id: anexoId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Anexo guardado no prontuário.");
  });
}

/** Processa os e-mails da fila depois de uma ação (lembretes enviados pela rotina diária já vão sozinhos). */
export async function dispararEnvios(): Promise<void> {
  processarFilaDepois({ tipos: ["enviar_envio"], limite: 20 });
}
