import "server-only";
import { obterContextoEmpresa, type ContextoEmpresa } from "@/lib/auth/sessao";
import type { Periodicidade, RegraTarefa, StatusTarefa } from "./rotulos";

type Cliente = ContextoEmpresa["supabase"];

/** Contexto da Gestão de RH (o banco confere de novo em cada operação). */
export async function obterContextoRh(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  const ligada = !ctx.acesso.ferramentas_desligadas.includes("escalas");
  const gestor = ligada && ctx.pode("rh.gerenciar");
  return {
    ...ctx,
    ligada,
    /** Cargos, modelos, atribuir e ver as tarefas de todos */
    gestor,
    /** Vê e conclui as tarefas atribuídas a ele */
    fazTarefas:
      ligada &&
      (gestor || (ctx.pode("rh.tarefas") && ctx.acesso.rh_funcionario)),
    /** Cadastro dos funcionários (quem monta escalas também mexe) */
    cadastro: ligada && (gestor || ctx.pode("escalas.gerenciar")),
    escalas:
      ligada && (ctx.pode("escalas.ver") || ctx.pode("escalas.gerenciar")),
  };
}

export interface TarefaCartao {
  id: string;
  titulo: string;
  periodicidade: Periodicidade;
  periodo_inicio: string;
  periodo_fim: string;
  prazo: string;
  status: StatusTarefa;
  ordem: number;
  responsavel_id: string | null;
  responsavel: string | null;
  cargo_id: string | null;
  cargo: string | null;
  regra: RegraTarefa;
  concluida_em: string | null;
  origem_conclusao: "manual" | "automatica" | null;
  conclusao_pendente: boolean;
  /** Tarefas de que esta depende e ainda não foram concluídas */
  dependencias_abertas: string[];
  sugestoes: number;
  /** Conciliação da semana: movimentos do extrato e quantos faltam */
  progresso: { total: number; pendentes: number } | null;
}

/**
 * Quadro: as tarefas abertas (de qualquer período) e as concluídas nos
 * últimos dias. Quem só faz as próprias tarefas recebe só as dele (o banco filtra).
 */
export async function carregarQuadro(
  supabase: Cliente,
  empresaId: string,
  diasConcluidas = 14,
): Promise<TarefaCartao[]> {
  const desde = new Date(Date.now() - diasConcluidas * 86400_000).toISOString();
  const campos =
    "id, titulo, periodicidade, periodo_inicio, periodo_fim, prazo, status, ordem, responsavel_id, concluida_em, origem_conclusao, conclusao_pendente, responsavel:escala_funcionarios(nome), modelo:rh_tarefa_modelos(regra, cargo_id, cargo:rh_cargos(nome))";
  const [abertas, concluidas] = await Promise.all([
    supabase
      .from("rh_tarefas")
      .select(campos)
      .eq("empresa_id", empresaId)
      .neq("status", "concluida")
      .order("prazo")
      .limit(500),
    supabase
      .from("rh_tarefas")
      .select(campos)
      .eq("empresa_id", empresaId)
      .eq("status", "concluida")
      .gte("concluida_em", desde)
      .order("concluida_em", { ascending: false })
      .limit(200),
  ]);
  type Linha = {
    id: string;
    titulo: string;
    periodicidade: Periodicidade;
    periodo_inicio: string;
    periodo_fim: string;
    prazo: string;
    status: StatusTarefa;
    ordem: number;
    responsavel_id: string | null;
    concluida_em: string | null;
    origem_conclusao: "manual" | "automatica" | null;
    conclusao_pendente: boolean;
    responsavel: { nome: string } | null;
    modelo: {
      regra: RegraTarefa;
      cargo_id: string | null;
      cargo: { nome: string } | null;
    } | null;
  };
  const linhas = [
    ...((abertas.data ?? []) as unknown as Linha[]),
    ...((concluidas.data ?? []) as unknown as Linha[]),
  ];
  const ids = linhas.map((t) => t.id);
  const abertasIds = linhas
    .filter((t) => t.status !== "concluida")
    .map((t) => t.id);
  const semanasConciliacao = [
    ...new Set(
      linhas
        .filter(
          (t) =>
            t.status !== "concluida" &&
            t.modelo?.regra === "conciliacao_semanal",
        )
        .map((t) => t.periodo_inicio),
    ),
  ];
  const [deps, sugestoes, progresso] = await Promise.all([
    abertasIds.length
      ? supabase
          .from("rh_tarefa_dependencias")
          .select("tarefa_id, depende_de_id")
          .in("tarefa_id", abertasIds)
      : Promise.resolve({
          data: [] as { tarefa_id: string; depende_de_id: string }[],
        }),
    ids.length
      ? supabase
          .from("rh_tarefa_vinculos")
          .select("tarefa_id")
          .eq("situacao", "sugerido")
          .in("tarefa_id", ids)
      : Promise.resolve({ data: [] as { tarefa_id: string }[] }),
    semanasConciliacao.length
      ? supabase.rpc("rh_conciliacao_progresso", {
          p_empresa_id: empresaId,
          p_semanas: semanasConciliacao,
        })
      : Promise.resolve({
          data: [] as { semana: string; total: number; pendentes: number }[],
        }),
  ]);
  // Tarefas de que dependem (algumas podem não estar na lista: busca as que faltam)
  const porId = new Map(linhas.map((t) => [t.id, t]));
  const faltam = [
    ...new Set(
      (deps.data ?? [])
        .map((d) => d.depende_de_id)
        .filter((id) => !porId.has(id)),
    ),
  ];
  const extras = faltam.length
    ? ((
        await supabase
          .from("rh_tarefas")
          .select("id, titulo, status, periodo_inicio")
          .in("id", faltam)
      ).data ?? [])
    : [];
  const info = new Map<string, { titulo: string; status: string }>([
    ...linhas.map(
      (t) => [t.id, { titulo: t.titulo, status: t.status }] as const,
    ),
    ...extras.map(
      (t) => [t.id, { titulo: t.titulo, status: t.status }] as const,
    ),
  ]);
  const abertasDe = new Map<string, string[]>();
  for (const d of deps.data ?? []) {
    const alvo = info.get(d.depende_de_id);
    // Dependência que esta pessoa não pode ver também segura a tarefa
    if (!alvo || alvo.status !== "concluida")
      abertasDe.set(d.tarefa_id, [
        ...(abertasDe.get(d.tarefa_id) ?? []),
        alvo?.titulo ?? "tarefa de outra pessoa",
      ]);
  }
  const nSugestoes = new Map<string, number>();
  for (const v of sugestoes.data ?? [])
    nSugestoes.set(v.tarefa_id, (nSugestoes.get(v.tarefa_id) ?? 0) + 1);
  const progressoDe = new Map(
    (progresso.data ?? []).map((p) => [
      p.semana,
      { total: p.total, pendentes: p.pendentes },
    ]),
  );
  return linhas.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    periodicidade: t.periodicidade,
    periodo_inicio: t.periodo_inicio,
    periodo_fim: t.periodo_fim,
    prazo: t.prazo,
    status: t.status,
    ordem: Number(t.ordem),
    responsavel_id: t.responsavel_id,
    responsavel: t.responsavel?.nome ?? null,
    cargo_id: t.modelo?.cargo_id ?? null,
    cargo: t.modelo?.cargo?.nome ?? null,
    regra: t.modelo?.regra ?? "manual",
    concluida_em: t.concluida_em,
    origem_conclusao: t.origem_conclusao,
    conclusao_pendente: t.conclusao_pendente,
    dependencias_abertas: abertasDe.get(t.id) ?? [],
    sugestoes: nSugestoes.get(t.id) ?? 0,
    progresso:
      t.modelo?.regra === "conciliacao_semanal" && t.status !== "concluida"
        ? (progressoDe.get(t.periodo_inicio) ?? null)
        : null,
  }));
}

export interface FuncionarioRh {
  id: string;
  nome: string;
  cargo_id: string | null;
  cargo: string | null;
  usuario_id: string | null;
  ativo: boolean;
}

export async function carregarFuncionarios(
  supabase: Cliente,
  empresaId: string,
): Promise<FuncionarioRh[]> {
  const { data } = await supabase
    .from("escala_funcionarios")
    .select("id, nome, cargo_id, cargo, usuario_id, ativo")
    .eq("empresa_id", empresaId)
    .order("ativo", { ascending: false })
    .order("nome");
  return (data ?? []) as FuncionarioRh[];
}

export interface CargoRh {
  id: string;
  nome: string;
  descricao: string | null;
}

export async function carregarCargos(
  supabase: Cliente,
  empresaId: string,
): Promise<CargoRh[]> {
  const { data } = await supabase
    .from("rh_cargos")
    .select("id, nome, descricao")
    .eq("empresa_id", empresaId)
    .order("nome");
  return (data ?? []) as CargoRh[];
}

export interface ModeloRh {
  id: string;
  titulo: string;
  descricao: string | null;
  cargo_id: string | null;
  responsavel_id: string | null;
  periodicidade: Periodicidade;
  dias_semana: number[];
  dia_semana: number;
  dia_mes: number;
  hora_limite: string;
  regra: RegraTarefa;
  exige_foto: boolean;
  exige_area: boolean;
  exige_semana: boolean;
  parametros: { caixa_nome?: string; conta_financeira_id?: string };
  depende_de_id: string | null;
  chave_rotina: string | null;
  ativo: boolean;
}

export async function carregarModelos(
  supabase: Cliente,
  empresaId: string,
): Promise<ModeloRh[]> {
  const { data } = await supabase
    .from("rh_tarefa_modelos")
    .select(
      "id, titulo, descricao, cargo_id, responsavel_id, periodicidade, dias_semana, dia_semana, dia_mes, hora_limite, regra, exige_foto, exige_area, exige_semana, parametros, depende_de_id, chave_rotina, ativo",
    )
    .eq("empresa_id", empresaId)
    .order("ativo", { ascending: false })
    .order("titulo");
  return (data ?? []) as unknown as ModeloRh[];
}

/** Acessos da empresa para ligar ao cadastro do funcionário (titulares e colaboradores). */
export async function carregarAcessos(supabase: Cliente, empresaId: string) {
  const { data } = await supabase
    .from("empresa_membros")
    .select(
      "user_id, papel, perfil:perfis!empresa_membros_user_id_fkey(nome, email)",
    )
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .neq("papel", "equipe");
  return (
    (data ?? []) as unknown as {
      user_id: string;
      papel: string;
      perfil: { nome: string | null; email: string } | null;
    }[]
  )
    .map((m) => ({
      id: m.user_id,
      nome: m.perfil?.nome || m.perfil?.email || "Acesso",
      email: m.perfil?.email ?? "",
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** A IA do escritório está ligada (para mostrar "Perguntar à IA"; a chave nunca sai do servidor). */
export async function iaLigada() {
  const { criarClienteAdmin } = await import("@/lib/supabase/admin");
  const admin = criarClienteAdmin();
  const [{ data: cfg }, { count }] = await Promise.all([
    admin.from("escritorio_ia").select("ativa").eq("id", 1).maybeSingle(),
    admin
      .from("escritorio_ia_segredo")
      .select("id", { count: "exact", head: true }),
  ]);
  return Boolean(cfg?.ativa && count);
}
