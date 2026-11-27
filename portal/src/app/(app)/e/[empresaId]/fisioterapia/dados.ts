import "server-only";
import type { ContextoFisio } from "@/lib/fisioterapia/contexto";
import { diaLocal, horaLocal, limitesDoDia } from "@/lib/veterinaria/rotulos";
import { formatarData } from "@/lib/formatos";
import { linkWhatsapp, mensagemConfirmacao } from "@/lib/fisioterapia/rotulos";

export interface LinhaAgenda {
  id: string;
  inicio: string;
  duracao_min: number;
  tipo: string;
  status: string;
  sala: string | null;
  observacoes: string | null;
  nome_avulso: string | null;
  telefone_avulso: string | null;
  serie_id: string | null;
  profissional_id: string | null;
  pacote_id: string | null;
  motivo: string | null;
  confirmacao_envio: string | null;
  confirmacao_destino: string | null;
  confirmacao_resposta: string | null;
  confirmacao_erro: string | null;
  paciente: { id: string; nome: string; telefone: string | null; aceita_whatsapp: boolean; convenio: string | null } | null;
  profissional: { nome: string; cor: string } | null;
}

/** Agenda de um período, com o link de confirmação pelo WhatsApp e o registro do prontuário já aberto (para o fisioterapeuta). */
export async function carregarAgenda(ctx: ContextoFisio, empresaId: string, de: string, ate: string, profissionalId?: string | null) {
  let q = ctx.supabase
    .from("fisio_agenda")
    .select(
      "id, inicio, duracao_min, tipo, status, sala, observacoes, nome_avulso, telefone_avulso, serie_id, profissional_id, pacote_id, motivo, confirmacao_envio, confirmacao_destino, confirmacao_resposta, confirmacao_erro, paciente:fisio_pacientes(id, nome, telefone, aceita_whatsapp, convenio), profissional:fisio_profissionais(nome, cor)",
    )
    .eq("empresa_id", empresaId)
    .gte("inicio", limitesDoDia(de).inicio)
    .lte("inicio", limitesDoDia(ate).fim)
    .order("inicio");
  if (profissionalId) q = q.eq("profissional_id", profissionalId);
  const [{ data }, { data: cfg }, { data: empresa }] = await Promise.all([
    q,
    ctx.supabase.from("fisio_config").select("mensagem_confirmacao, nome_clinica, duracao_padrao_min, whatsapp_ativo, whatsapp_modo_teste").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("empresas").select("razao_social, nome_fantasia").eq("id", empresaId).maybeSingle(),
  ]);
  const linhas = (data ?? []) as unknown as LinhaAgenda[];
  // Registros do prontuário abertos para estes horários (só o fisioterapeuta lê)
  const registros = new Map<string, { tipo: "avaliacao" | "evolucao"; id: string }>();
  if (ctx.profissional && linhas.length) {
    const ids = linhas.map((l) => l.id);
    const [{ data: av }, { data: ev }] = await Promise.all([
      ctx.supabase.from("fisio_avaliacoes").select("id, agendamento_id").in("agendamento_id", ids).neq("status", "cancelada"),
      ctx.supabase.from("fisio_evolucoes").select("id, agendamento_id").in("agendamento_id", ids).neq("status", "cancelada"),
    ]);
    for (const a of av ?? []) if (a.agendamento_id) registros.set(a.agendamento_id, { tipo: "avaliacao", id: a.id });
    for (const e of ev ?? []) if (e.agendamento_id) registros.set(e.agendamento_id, { tipo: "evolucao", id: e.id });
  }
  const clinica = cfg?.nome_clinica || empresa?.nome_fantasia || empresa?.razao_social || "clínica";
  const modelo = cfg?.mensagem_confirmacao ?? "Olá, {paciente}! Confirmando a sua sessão em {data} às {hora}.";
  return {
    duracaoPadrao: cfg?.duracao_padrao_min ?? 50,
    /** Confirmação automática pelo WhatsApp da clínica ligada (e se está no modo teste) */
    confirmacao: { ativa: Boolean(cfg?.whatsapp_ativo), teste: Boolean(cfg?.whatsapp_modo_teste) },
    linhas: linhas.map((l) => {
      const telefone = l.paciente ? (l.paciente.aceita_whatsapp ? l.paciente.telefone : null) : l.telefone_avulso;
      const texto = mensagemConfirmacao(modelo, {
        paciente: l.paciente?.nome ?? l.nome_avulso ?? "",
        clinica,
        data: formatarData(diaLocal(l.inicio)),
        hora: horaLocal(l.inicio),
        profissional: l.profissional?.nome ?? "a equipe",
      });
      return { ...l, whatsapp: linkWhatsapp(telefone, texto), registro: registros.get(l.id) ?? null };
    }),
  };
}

export async function opcoesClinica(ctx: ContextoFisio, empresaId: string) {
  const [{ data: profissionais }, { data: pacientes }] = await Promise.all([
    ctx.supabase.from("fisio_profissionais").select("id, nome, cor").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("fisio_pacientes").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome").limit(2000),
  ]);
  return { profissionais: profissionais ?? [], pacientes: pacientes ?? [] };
}
