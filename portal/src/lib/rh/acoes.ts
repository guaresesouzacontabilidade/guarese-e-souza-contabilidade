"use server";

import { revalidatePath } from "next/cache";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import type { Json } from "@/lib/supabase/database.types";
import { credencialIa, mensagemDeErro, perguntarIa } from "@/lib/escalas/ia";
import { obterContextoRh } from "./dados";
import { SISTEMA_RH, montarPedidoRh, respostaRh } from "./ia";
import {
  STATUS,
  formatarDataHoraRh,
  formatarPrazo,
  rotuloPeriodo,
  type Periodicidade,
  type StatusTarefa,
} from "./rotulos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const texto = (fd: FormData, nome: string, max = 200) =>
  String(fd.get(nome) ?? "")
    .trim()
    .slice(0, max);

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/rh`, "layout");
}

async function gestor(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoRh(empresaId);
  return ctx.gestor ? ctx : null;
}

async function quemFaz(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoRh(empresaId);
  return ctx.fazTarefas || ctx.gestor ? ctx : null;
}

const SEM_ACESSO = "Você não tem acesso à Gestão de RH desta empresa.";

// ----------------------------------------------------------------------------- cargos

export async function salvarCargo(
  empresaId: string,
  cargoId: string | null,
  _a: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao> {
  const ctx = await gestor(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (cargoId && !UUID.test(cargoId)) return falha("Cargo inválido.");
  const nome = texto(fd, "nome", 80);
  if (nome.length < 2)
    return falha("Revise os campos destacados.", {
      nome: ["Informe o nome do cargo."],
    });
  const modelos = fd
    .getAll("modelos")
    .map(String)
    .filter((id) => UUID.test(id));
  const { error } = await ctx.supabase.rpc("rh_cargo_salvar", {
    p_empresa_id: empresaId,
    p_id: (cargoId ?? null) as unknown as string,
    p_dados: { nome, descricao: texto(fd, "descricao", 2000), modelos },
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(cargoId ? "Cargo atualizado." : "Cargo cadastrado.");
}

export async function excluirCargo(
  empresaId: string,
  cargoId: string,
): Promise<ResultadoAcao> {
  const ctx = await gestor(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (!UUID.test(cargoId)) return falha("Cargo inválido.");
  const { error } = await ctx.supabase.rpc("rh_cargo_excluir", {
    p_cargo_id: cargoId,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(
    "Cargo excluído. Os funcionários continuam com o nome do cargo escrito no cadastro.",
  );
}

// ----------------------------------------------------------------------------- modelos

export async function salvarModelo(
  empresaId: string,
  modeloId: string | null,
  _a: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao> {
  const ctx = await gestor(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (modeloId && !UUID.test(modeloId)) return falha("Modelo inválido.");
  const titulo = texto(fd, "titulo", 120);
  const erros: Record<string, string[]> = {};
  if (titulo.length < 2) erros.titulo = ["Informe o título da tarefa."];
  const periodicidade = texto(fd, "periodicidade", 20);
  if (!["diaria", "semanal", "quinzenal", "mensal"].includes(periodicidade))
    erros.periodicidade = ["Escolha a periodicidade."];
  const dias = fd
    .getAll("dias_semana")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  if (periodicidade === "diaria" && !dias.length)
    erros.dias_semana = ["Escolha os dias da semana."];
  const hora = texto(fd, "hora_limite", 5);
  if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora))
    erros.hora_limite = ["Hora no formato 18:00."];
  if (Object.keys(erros).length)
    return falha("Revise os campos destacados.", erros);
  const uuid = (nome: string) =>
    UUID.test(texto(fd, nome, 40)) ? texto(fd, nome, 40) : null;
  const { error } = await ctx.supabase.rpc("rh_modelo_salvar", {
    p_empresa_id: empresaId,
    p_id: (modeloId ?? null) as unknown as string,
    p_dados: {
      titulo,
      descricao: texto(fd, "descricao", 2000),
      periodicidade,
      dias_semana: dias,
      dia_semana: Number(texto(fd, "dia_semana", 2)) || 5,
      dia_mes: Number(texto(fd, "dia_mes", 2)) || 5,
      hora_limite: hora || "18:00",
      regra: texto(fd, "regra", 30) || "manual",
      cargo_id: uuid("cargo_id"),
      responsavel_id: uuid("responsavel_id"),
      depende_de_id: uuid("depende_de_id"),
      exige_foto: fd.get("exige_foto") === "on",
      exige_area: fd.get("exige_area") === "on",
      exige_semana: fd.get("exige_semana") === "on",
      ativo: fd.get("ativo") !== "off",
      parametros: {
        caixa_nome: texto(fd, "caixa_nome", 40),
        conta_financeira_id: uuid("conta_financeira_id"),
      },
    } as Json,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(
    modeloId
      ? "Tarefa atualizada."
      : "Tarefa criada. A do período atual já está no quadro.",
  );
}

export async function criarRotinasIniciais(
  empresaId: string,
  chaves: string[],
): Promise<ResultadoAcao<{ criadas: number }>> {
  const ctx = await gestor(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  const validas = chaves.filter((c) =>
    [
      "conferencia_estoque",
      "envio_extrato",
      "conciliacao_semanal",
      "organizacao_patio",
      "fechamento_caixa",
    ].includes(c),
  );
  if (!validas.length) return falha("Escolha ao menos uma rotina.");
  const { data, error } = await ctx.supabase.rpc("rh_criar_rotinas_iniciais", {
    p_empresa_id: empresaId,
    p_chaves: validas,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  const criadas = Number(data ?? 0);
  return sucesso(
    criadas
      ? `${criadas} rotina(s) criada(s). Defina o cargo ou o responsável de cada uma.`
      : "Essas rotinas já existiam.",
    { criadas },
  );
}

// ----------------------------------------------------------------------------- quadro

export async function moverTarefa(
  empresaId: string,
  tarefaId: string,
  status: StatusTarefa,
  ordem: number | null,
): Promise<ResultadoAcao> {
  const ctx = await quemFaz(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (!UUID.test(tarefaId) || !(status in STATUS))
    return falha("Tarefa inválida.");
  const { error } = await ctx.supabase.rpc("rh_tarefa_mover", {
    p_tarefa_id: tarefaId,
    p_status: status,
    p_ordem: (ordem ?? null) as unknown as number,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso();
}

export async function atribuirTarefa(
  empresaId: string,
  tarefaId: string,
  funcionarioId: string | null,
): Promise<ResultadoAcao> {
  const ctx = await gestor(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (!UUID.test(tarefaId) || (funcionarioId && !UUID.test(funcionarioId)))
    return falha("Tarefa inválida.");
  const { error } = await ctx.supabase.rpc("rh_tarefa_atribuir", {
    p_tarefa_id: tarefaId,
    p_funcionario_id: (funcionarioId ?? null) as unknown as string,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(
    funcionarioId ? "Responsável definido." : "Tarefa sem responsável.",
  );
}

export async function ligarDependencia(
  empresaId: string,
  tarefaId: string,
  dependeDeId: string,
  ligar: boolean,
): Promise<ResultadoAcao> {
  const ctx = await gestor(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (!UUID.test(tarefaId) || !UUID.test(dependeDeId))
    return falha("Tarefa inválida.");
  const { error } = await ctx.supabase.rpc("rh_tarefa_dependencia", {
    p_tarefa_id: tarefaId,
    p_depende_de_id: dependeDeId,
    p_ligar: ligar,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(
    ligar
      ? "Dependência ligada: esta tarefa só conclui depois da outra."
      : "Dependência removida.",
  );
}

export async function concluirTarefa(
  empresaId: string,
  tarefaId: string,
  _a: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao> {
  const ctx = await quemFaz(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (!UUID.test(tarefaId)) return falha("Tarefa inválida.");
  const semana = texto(fd, "semana", 10);
  const documento = texto(fd, "documento_id", 40);
  const { error } = await ctx.supabase.rpc("rh_tarefa_concluir", {
    p_tarefa_id: tarefaId,
    p_dados: {
      area: texto(fd, "area", 120),
      semana: DATA.test(semana) ? semana : "",
      observacao: texto(fd, "observacao", 1000),
      documento_id: UUID.test(documento) ? documento : "",
    },
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(
    "Tarefa concluída. A data, a hora e quem concluiu ficam no histórico.",
  );
}

export async function confirmarConferencia(
  empresaId: string,
  observacao: string,
): Promise<ResultadoAcao<{ situacao: string }>> {
  if (!UUID.test(empresaId)) return falha(SEM_ACESSO);
  const ctx = await obterContextoRh(empresaId);
  // Quem pode de fato (gestor, quem gerencia a loja ou o responsável da tarefa) o banco confere
  if (
    !ctx.ligada ||
    !(ctx.gestor || ctx.pode("rh.tarefas") || ctx.pode("gestao.gerenciar"))
  )
    return falha(SEM_ACESSO);
  const supabase = ctx.supabase;
  const { data, error } = await supabase.rpc(
    "rh_confirmar_conferencia_estoque",
    { p_empresa_id: empresaId, p_observacao: observacao.slice(0, 500) },
  );
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  revalidatePath(`/e/${empresaId}/loja/produtos`);
  const situacao = String(
    (data as { situacao?: string } | null)?.situacao ?? "",
  );
  const mensagem: Record<string, string> = {
    concluida:
      "Conferência confirmada. A tarefa do quadro foi concluída com o seu nome, a data e a hora.",
    aguardando:
      "Conferência registrada. A tarefa conclui quando a etapa anterior for concluída.",
    ja_concluida:
      "Conferência registrada. A tarefa deste período já estava concluída.",
    sugerida:
      "Conferência registrada. Hoje não há tarefa de conferência; confirme no quadro a qual tarefa atrasada ela pertence.",
    sem_tarefa:
      "Conferência registrada (não há tarefa de conferência no quadro).",
  };
  return sucesso(mensagem[situacao] ?? "Conferência registrada.", { situacao });
}

export async function decidirSugestao(
  empresaId: string,
  vinculoId: string,
  confirmar: boolean,
): Promise<ResultadoAcao> {
  const ctx = await quemFaz(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (!UUID.test(vinculoId)) return falha("Sugestão inválida.");
  const { error } = confirmar
    ? await ctx.supabase.rpc("rh_vinculo_confirmar", {
        p_vinculo_id: vinculoId,
      })
    : await ctx.supabase.rpc("rh_vinculo_recusar", { p_vinculo_id: vinculoId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(
    confirmar
      ? "Registro confirmado e tarefa concluída."
      : "Sugestão recusada.",
  );
}

/** Pede à IA qual das tarefas sugeridas é a do registro (não conclui nada; uma pessoa confirma). */
export async function pedirSugestaoIa(
  empresaId: string,
  vinculoId: string,
): Promise<ResultadoAcao<{ explicacao: string }>> {
  const ctx = await quemFaz(empresaId);
  if (!ctx) return falha(SEM_ACESSO);
  if (!UUID.test(vinculoId)) return falha("Sugestão inválida.");
  const { data: v } = await ctx.supabase
    .from("rh_tarefa_vinculos")
    .select("tipo, registro_id, detalhe, criado_em, situacao")
    .eq("id", vinculoId)
    .maybeSingle();
  if (!v || v.situacao !== "sugerido" || !v.registro_id)
    return falha("Sugestão não encontrada.");
  const { data: irmas } = await ctx.supabase
    .from("rh_tarefa_vinculos")
    .select(
      "id, tarefa:rh_tarefas(titulo, periodicidade, periodo_inicio, periodo_fim, prazo, status)",
    )
    .eq("tipo", v.tipo)
    .eq("registro_id", v.registro_id)
    .eq("situacao", "sugerido")
    .order("criado_em");
  type Irma = {
    id: string;
    tarefa: {
      titulo: string;
      periodicidade: Periodicidade;
      periodo_inicio: string;
      periodo_fim: string;
      prazo: string;
      status: StatusTarefa;
    } | null;
  };
  const candidatas = ((irmas ?? []) as unknown as Irma[]).filter(
    (i) => i.tarefa,
  );
  if (!candidatas.length) return falha("Sugestão não encontrada.");
  const credencial = await credencialIa();
  if (!credencial)
    return falha(
      "A IA está desligada. O administrador do escritório liga em Configurações → Integrações. Enquanto isso, escolha a tarefa certa você mesmo.",
    );
  const { data: reserva, error: e1 } = await ctx.supabase.rpc(
    "rh_ia_reservar",
    { p_empresa_id: empresaId },
  );
  if (e1) return falha(mensagemErro(e1));
  const uso = (reserva as { uso_id: number; modelo: string }[] | null)?.[0];
  if (!uso) return falha("Não foi possível pedir à IA agora.");
  const detalhe = (v.detalhe ?? {}) as { data?: string; caixa?: string };
  const pedido = montarPedidoRh(
    {
      tipo: v.tipo === "caixa_sessao" ? "caixa_sessao" : "estoque_conferencia",
      quando: formatarDataHoraRh(v.criado_em),
      caixa: detalhe.caixa ?? null,
      dataDoCaixa: detalhe.data
        ? `${detalhe.data.slice(8, 10)}/${detalhe.data.slice(5, 7)}/${detalhe.data.slice(0, 4)}`
        : null,
    },
    candidatas.map((c) => ({
      titulo: c.tarefa!.titulo,
      periodo: rotuloPeriodo(
        c.tarefa!.periodicidade,
        c.tarefa!.periodo_inicio,
        c.tarefa!.periodo_fim,
      ),
      prazo: formatarPrazo(c.tarefa!.prazo),
      status: STATUS[c.tarefa!.status].rotulo,
    })),
  );
  try {
    const r = await perguntarIa(
      { chave: credencial.chave, modelo: uso.modelo },
      pedido,
      respostaRh,
      { sistema: SISTEMA_RH, esforco: "low", maxTokens: 2000 },
    );
    await ctx.supabase.rpc("escala_ia_concluir", {
      p_uso_id: uso.uso_id,
      p_ok: true,
      p_tokens_entrada: r.tokensEntrada,
      p_tokens_saida: r.tokensSaida,
      p_erro: "",
    });
    const escolhida = r.dados.indice ? candidatas[r.dados.indice - 1] : null;
    if (!escolhida)
      return sucesso(`A IA não achou uma tarefa certa: ${r.dados.explicacao}`, {
        explicacao: r.dados.explicacao,
      });
    const { error } = await ctx.supabase.rpc("rh_vinculo_ia_registrar", {
      p_vinculo_id: escolhida.id,
      p_explicacao: r.dados.explicacao,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("A IA indicou a tarefa mais provável. Confira e confirme.", {
      explicacao: r.dados.explicacao,
    });
  } catch (e) {
    const erro = mensagemDeErro(e);
    await ctx.supabase.rpc("escala_ia_concluir", {
      p_uso_id: uso.uso_id,
      p_ok: false,
      p_tokens_entrada: 0,
      p_tokens_saida: 0,
      p_erro: erro.slice(0, 300),
    });
    return falha(erro);
  }
}
