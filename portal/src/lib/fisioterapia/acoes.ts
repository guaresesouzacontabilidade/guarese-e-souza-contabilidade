"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import { validarCpf } from "@/lib/formatos";
import type { Json } from "@/lib/supabase/database.types";

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

/** Valor em reais digitado no padrão brasileiro ("1.234,50") → "1234.50"; vazio → ""; inválido → null. */
function dinheiro(fd: FormData, nome: string): string | null {
  const v = texto(fd, nome, 30);
  if (!v) return "";
  const d = lerValorBR(v);
  return d ? d.toFixed(2) : null;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/fisioterapia`, "layout");
}

function idValido(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID.test(id);
}

/** Contexto com a clínica de fisioterapia ligada (o banco confere de novo a permissão e o fisioterapeuta). */
async function contexto(empresaId: string) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.loja || ctx.acesso.gestao_modalidade !== "fisioterapia") throw new Error("A gestão da clínica de fisioterapia não está ligada para esta empresa.");
  return ctx;
}

async function executar<T>(fn: () => Promise<ResultadoAcao<T>>): Promise<ResultadoAcao<T>> {
  try {
    return await fn();
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível concluir a operação.");
  }
}

// -----------------------------------------------------------------------------
// Configurações e fisioterapeutas (responsável)
// -----------------------------------------------------------------------------
export async function salvarConfiguracaoFisio(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    const tel = digitos(fd, "telefone");
    if (tel && (tel.length < 10 || tel.length > 13)) erros.telefone = ["Telefone com DDD."];
    for (const c of ["horario_inicio", "horario_fim"]) if (texto(fd, c) && !HORA.test(texto(fd, c))) erros[c] = ["Hora inválida."];
    const valor = dinheiro(fd, "valor_sessao");
    if (valor === null) erros.valor_sessao = ["Valor inválido."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("fisio_configurar", {
      p_empresa_id: empresaId,
      p_dados: {
        nome_clinica: texto(fd, "nome_clinica", 120),
        registro_crefito: texto(fd, "registro_crefito", 30),
        telefone: tel,
        email: texto(fd, "email", 200),
        endereco: texto(fd, "endereco", 300),
        cidade_documentos: texto(fd, "cidade_documentos", 80),
        horario_inicio: texto(fd, "horario_inicio", 5),
        horario_fim: texto(fd, "horario_fim", 5),
        duracao_padrao_min: texto(fd, "duracao_padrao_min", 4),
        valor_sessao: valor,
        falta_desconta_sessao: fd.get("falta_desconta_sessao") === "on",
        mensagem_confirmacao: texto(fd, "mensagem_confirmacao", 600),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Configurações salvas.");
  });
}

export async function salvarProfissional(empresaId: string, id: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (id && !idValido(id)) return falha("Fisioterapeuta inválido.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    if (texto(fd, "nome").length < 3) erros.nome = ["Informe o nome."];
    if (!texto(fd, "crefito")) erros.crefito = ["Informe o CREFITO."];
    const regiao = Number(texto(fd, "crefito_regiao"));
    if (!Number.isInteger(regiao) || regiao < 1 || regiao > 30) erros.crefito_regiao = ["Região de 1 a 30."];
    const perfil = texto(fd, "perfil_id");
    if (perfil && !UUID.test(perfil)) erros.perfil_id = ["Escolha o usuário."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("fisio_profissional_salvar", {
      p_empresa_id: empresaId,
      p_id: id as string,
      p_dados: {
        nome: texto(fd, "nome", 120),
        crefito: texto(fd, "crefito", 15),
        crefito_regiao: String(regiao),
        especialidade: texto(fd, "especialidade", 80),
        telefone: digitos(fd, "telefone"),
        email: texto(fd, "email", 200),
        cor: texto(fd, "cor", 7),
        repasse_percentual: texto(fd, "repasse_percentual", 6).replace(",", "."),
        perfil_id: perfil,
        responsavel_tecnico: fd.get("responsavel_tecnico") === "on",
        ativo: fd.get("ativo") !== null ? fd.get("ativo") === "on" : true,
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Fisioterapeuta salvo.");
  });
}

// -----------------------------------------------------------------------------
// Pacientes, pacotes e recebimentos (recepção)
// -----------------------------------------------------------------------------
const CAMPOS_PACIENTE = [
  ["nome", 120],
  ["nome_social", 120],
  ["nascimento", 10],
  ["genero", 20],
  ["estado_civil", 20],
  ["naturalidade", 80],
  ["profissao", 80],
  ["email", 200],
  ["logradouro", 150],
  ["numero", 20],
  ["complemento", 80],
  ["bairro", 80],
  ["cidade", 80],
  ["uf", 2],
  ["responsavel", 120],
  ["contato_emergencia", 160],
  ["convenio", 80],
  ["carteirinha", 40],
  ["medico_encaminhador", 120],
  ["observacoes", 1000],
] as const;

export async function salvarPaciente(empresaId: string, id: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (id && !idValido(id)) return falha("Paciente inválido.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    if (texto(fd, "nome").length < 3) erros.nome = ["Informe o nome completo."];
    const cpf = digitos(fd, "cpf");
    if (cpf && !validarCpf(cpf)) erros.cpf = ["CPF inválido."];
    const tel = digitos(fd, "telefone");
    if (tel && (tel.length < 10 || tel.length > 13)) erros.telefone = ["Telefone com DDD."];
    const nasc = texto(fd, "nascimento");
    if (nasc && !DATA.test(nasc)) erros.nascimento = ["Data inválida."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const dados: Record<string, Json> = {
      cpf,
      telefone: tel,
      cep: digitos(fd, "cep"),
      aceita_whatsapp: fd.get("aceita_whatsapp") === "on",
      consentimento: fd.get("consentimento") === "on",
    };
    for (const [c, max] of CAMPOS_PACIENTE) dados[c] = texto(fd, c, max);
    const { data, error } = await ctx.supabase.rpc("fisio_paciente_salvar", { p_empresa_id: empresaId, p_id: id as string, p_dados: dados });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "Paciente atualizado." : "Paciente cadastrado.", { id: data as string });
  });
}

export async function salvarPacote(empresaId: string, pacienteId: string, id: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(pacienteId) || (id && !idValido(id))) return falha("Pacote inválido.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    const sessoes = Number(texto(fd, "sessoes"));
    if (!Number.isInteger(sessoes) || sessoes < 1 || sessoes > 200) erros.sessoes = ["De 1 a 200 sessões."];
    const valor = dinheiro(fd, "valor_total");
    if (valor === null) erros.valor_total = ["Valor inválido."];
    for (const c of ["inicio", "validade"]) if (texto(fd, c) && !DATA.test(texto(fd, c))) erros[c] = ["Data inválida."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("fisio_pacote_salvar", {
      p_empresa_id: empresaId,
      p_id: id as string,
      p_dados: {
        paciente_id: pacienteId,
        descricao: texto(fd, "descricao", 120),
        sessoes: String(sessoes),
        valor_total: valor,
        inicio: texto(fd, "inicio", 10),
        validade: texto(fd, "validade", 10),
        convenio: texto(fd, "convenio", 80),
        guia: texto(fd, "guia", 40),
        status: texto(fd, "status", 12) || "ativo",
        observacao: texto(fd, "observacao", 300),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "Pacote atualizado." : "Pacote criado.");
  });
}

export async function registrarRecebimento(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    const paciente = texto(fd, "paciente_id");
    if (!UUID.test(paciente)) erros.paciente_id = ["Escolha o paciente."];
    const pacote = texto(fd, "pacote_id");
    if (pacote && !UUID.test(pacote)) erros.pacote_id = ["Pacote inválido."];
    const valor = dinheiro(fd, "valor");
    if (!valor) erros.valor = ["Informe o valor."];
    const forma = texto(fd, "forma", 20);
    if (!forma) erros.forma = ["Escolha a forma."];
    const venc = texto(fd, "vencimento");
    if (forma === "a_receber" && !DATA.test(venc)) erros.vencimento = ["Informe o vencimento."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("fisio_recebimento_registrar", {
      p_empresa_id: empresaId,
      p_dados: {
        paciente_id: paciente,
        pacote_id: pacote,
        descricao: texto(fd, "descricao", 120),
        forma,
        valor,
        vencimento: forma === "a_receber" ? venc : "",
        observacao: texto(fd, "observacao", 300),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(forma === "a_receber" ? "Lançado a receber no Financeiro." : "Recebimento registrado e lançado no Financeiro.");
  });
}

export async function estornarRecebimento(empresaId: string, id: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(id)) return falha("Recebimento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("fisio_recebimento_estornar", { p_recebimento_id: id, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Recebimento estornado.");
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
    if (paciente && !UUID.test(paciente)) erros.paciente_id = ["Escolha o paciente."];
    if (!paciente && texto(fd, "nome_avulso").length < 2) erros.nome_avulso = ["Escolha o paciente ou escreva o nome de quem vem."];
    const tel = digitos(fd, "telefone_avulso");
    if (!paciente && tel && (tel.length < 10 || tel.length > 13)) erros.telefone_avulso = ["Telefone com DDD."];
    const prof = texto(fd, "profissional_id");
    if (!UUID.test(prof)) erros.profissional_id = ["Escolha o fisioterapeuta."];
    const dias = fd
      .getAll("dias_semana")
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    const semanas = Number(texto(fd, "semanas") || "1");
    if (!Number.isInteger(semanas) || semanas < 1 || semanas > 12) erros.semanas = ["De 1 a 12 semanas."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { data, error } = await ctx.supabase.rpc("fisio_agenda_salvar", {
      p_empresa_id: empresaId,
      p_id: agendaId as string,
      p_dados: {
        inicio: `${dia}T${hora}:00${FUSO}`,
        duracao_min: texto(fd, "duracao_min", 4),
        tipo: texto(fd, "tipo", 20),
        paciente_id: paciente,
        nome_avulso: paciente ? "" : texto(fd, "nome_avulso", 120),
        telefone_avulso: paciente ? "" : tel,
        profissional_id: prof,
        sala: texto(fd, "sala", 40),
        observacoes: texto(fd, "observacoes", 500),
        ...(agendaId ? {} : { dias_semana: dias, semanas: String(semanas) }),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    const n = Number(data ?? 1);
    return sucesso(agendaId ? "Agendamento alterado." : n > 1 ? `${n} horários agendados.` : "Agendado.");
  });
}

export async function mudarStatusAgenda(empresaId: string, agendaId: string, status: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(agendaId)) return falha("Agendamento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("fisio_agenda_status", { p_agenda_id: agendaId, p_status: status });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(status === "confirmado" ? "Presença confirmada." : status === "faltou" ? "Falta registrada." : "Agenda atualizada.");
  });
}

export async function cancelarAgendamento(empresaId: string, agendaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(agendaId)) return falha("Agendamento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("fisio_agenda_status", {
      p_agenda_id: agendaId,
      p_status: "cancelado",
      p_motivo: texto(fd, "motivo", 300),
      p_toda_serie: fd.get("toda_serie") === "on",
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Horário cancelado.");
  });
}

// -----------------------------------------------------------------------------
// Prontuário (fisioterapeuta)
// -----------------------------------------------------------------------------
export async function abrirAvaliacao(empresaId: string, dados: { paciente_id?: string; agendamento_id?: string; tipo?: string }): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if ((dados.paciente_id && !idValido(dados.paciente_id)) || (dados.agendamento_id && !idValido(dados.agendamento_id))) return falha("Dados inválidos.");
    const ctx = await contexto(empresaId);
    const { data, error } = await ctx.supabase.rpc("fisio_avaliacao_abrir", {
      p_empresa_id: empresaId,
      p_dados: { paciente_id: dados.paciente_id ?? "", agendamento_id: dados.agendamento_id ?? "", tipo: dados.tipo ?? "" },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Avaliação aberta.", { id: data as string });
  });
}

export async function abrirEvolucao(empresaId: string, dados: { paciente_id?: string; agendamento_id?: string; tipo?: string }): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if ((dados.paciente_id && !idValido(dados.paciente_id)) || (dados.agendamento_id && !idValido(dados.agendamento_id))) return falha("Dados inválidos.");
    const ctx = await contexto(empresaId);
    const { data, error } = await ctx.supabase.rpc("fisio_evolucao_abrir", {
      p_empresa_id: empresaId,
      p_dados: { paciente_id: dados.paciente_id ?? "", agendamento_id: dados.agendamento_id ?? "", tipo: dados.tipo ?? "" },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(dados.tipo === "alta" ? "Registro de alta aberto." : "Evolução aberta.", { id: data as string });
  });
}

const CAMPOS_AVALIACAO = [
  ["queixa_principal", 2000],
  ["historia_atual", 5000],
  ["historia_pregressa", 5000],
  ["antecedentes", 3000],
  ["habitos", 2000],
  ["medicamentos", 2000],
  ["tratamentos_anteriores", 2000],
  ["dor_eva", 2],
  ["dor_local", 300],
  ["exame_fisico", 10000],
  ["amplitude_movimento", 3000],
  ["forca_muscular", 3000],
  ["testes_especiais", 3000],
  ["exames_complementares", 3000],
  ["diagnostico", 3000],
  ["cid", 8],
  ["prognostico", 2000],
  ["objetivos", 3000],
  ["condutas", 5000],
  ["frequencia_semanal", 2],
  ["sessoes_previstas", 3],
] as const;

/** Salva a avaliação; com "finalizar" marcado, finaliza em seguida (depois disso, só adendos). */
export async function salvarAvaliacao(empresaId: string, id: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(id)) return falha("Avaliação inválida.");
    const ctx = await contexto(empresaId);
    const dados: Record<string, Json> = {};
    for (const [c, max] of CAMPOS_AVALIACAO) dados[c] = texto(fd, c, max);
    const { error } = await ctx.supabase.rpc("fisio_avaliacao_salvar", { p_avaliacao_id: id, p_dados: dados });
    if (error) return falha(mensagemErro(error));
    if (fd.get("finalizar") === "1") {
      const { error: e2 } = await ctx.supabase.rpc("fisio_avaliacao_finalizar", { p_avaliacao_id: id });
      if (e2) {
        revalidar(empresaId);
        return falha(`Salvo, mas não finalizado: ${mensagemErro(e2)}`);
      }
    }
    revalidar(empresaId);
    return sucesso(fd.get("finalizar") === "1" ? "Avaliação finalizada e assinada." : "Avaliação salva.");
  });
}

/** Salva a evolução (SOAP); com "finalizar", finaliza em seguida (a sessão vira "realizada"). */
export async function salvarEvolucao(empresaId: string, id: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(id)) return falha("Evolução inválida.");
    const ctx = await contexto(empresaId);
    const condutas = [
      ...fd.getAll("condutas").map((c) => String(c).trim()),
      ...texto(fd, "outras_condutas", 300)
        .split(/[,;\n]/)
        .map((c) => c.trim()),
    ]
      .filter(Boolean)
      .slice(0, 30);
    const { error } = await ctx.supabase.rpc("fisio_evolucao_salvar", {
      p_evolucao_id: id,
      p_dados: {
        subjetivo: texto(fd, "subjetivo", 5000),
        objetivo: texto(fd, "objetivo", 5000),
        analise: texto(fd, "analise", 5000),
        plano: texto(fd, "plano", 5000),
        condutas,
        dor_antes: texto(fd, "dor_antes", 2),
        dor_depois: texto(fd, "dor_depois", 2),
        intercorrencias: texto(fd, "intercorrencias", 3000),
        orientacoes: texto(fd, "orientacoes", 3000),
        alta_motivo: texto(fd, "alta_motivo", 30),
      },
    });
    if (error) return falha(mensagemErro(error));
    if (fd.get("finalizar") === "1") {
      const { error: e2 } = await ctx.supabase.rpc("fisio_evolucao_finalizar", { p_evolucao_id: id });
      if (e2) {
        revalidar(empresaId);
        return falha(`Salvo, mas não finalizado: ${mensagemErro(e2)}`);
      }
    }
    revalidar(empresaId);
    return sucesso(fd.get("finalizar") === "1" ? "Evolução finalizada e assinada." : "Evolução salva.");
  });
}

export async function cancelarRegistro(empresaId: string, tipo: "avaliacao" | "evolucao", id: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(id)) return falha("Registro inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("fisio_registro_cancelar", { p_tipo: tipo, p_id: id, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Registro cancelado.");
  });
}

export async function registrarAdendo(empresaId: string, tipo: "avaliacao" | "evolucao", id: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(id)) return falha("Registro inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("fisio_adendo_registrar", { p_tipo: tipo, p_id: id, p_texto: texto(fd, "texto", 5000) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Adendo registrado.");
  });
}

export async function emitirDocumento(empresaId: string, pacienteId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (!idValido(pacienteId)) return falha("Paciente inválido.");
    const ctx = await contexto(empresaId);
    const { data, error } = await ctx.supabase.rpc("fisio_documento_emitir", {
      p_empresa_id: empresaId,
      p_dados: { paciente_id: pacienteId, tipo: texto(fd, "tipo", 20), titulo: texto(fd, "titulo", 120), texto: texto(fd, "texto", 10000) },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Documento emitido.", { id: data as string });
  });
}

export async function cancelarDocumento(empresaId: string, id: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!idValido(id)) return falha("Documento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("fisio_documento_cancelar", { p_documento_id: id, p_motivo: texto(fd, "motivo", 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Documento cancelado.");
  });
}
