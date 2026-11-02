import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { competenciaAtual, hojeISO, somarMeses } from "@/lib/competencia";
import { estudarEmpresa, type DadosEstudo } from "./estudar";

/**
 * Tarefa "estudo_tributario" da fila: estuda uma empresa (regime, Fator R,
 * imposto pago a mais e limite do Simples) com os dados que o portal já tem e
 * grava o resultado. Tudo é calculado aqui, no servidor, a partir do banco;
 * nenhum dado sai do portal.
 *  1. Lê os 24 meses anteriores ao último mês fechado e os achados do auditor.
 *  2. Faz as contas (estudar.ts).
 *  3. Grava; o banco avisa a equipe só quando há novidade ou o valor muda muito
 *     e pede o auditor quando a análise das notas está velha.
 */
interface Payload {
  empresa_id: string;
  execucao_id?: number;
  origem?: "noite" | "manual";
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function executarEstudoTributario(admin: ClienteAdmin, job: Job) {
  const p = (job.payload ?? {}) as unknown as Payload;
  if (!p.empresa_id || !UUID.test(p.empresa_id)) throw new Error("Tarefa sem empresa.");
  const origem = p.origem === "manual" ? "manual" : "noite";
  const execucaoId = typeof p.execucao_id === "number" ? p.execucao_id : null;
  // O mês atual ainda não acabou: o estudo vai até o mês anterior
  const ate = somarMeses(competenciaAtual(), -1);
  let etapa = "ler";
  try {
    const { data, error } = await admin.rpc("estudo_dados", { p_empresa_id: p.empresa_id, p_ate: ate });
    if (error) throw new Error(`Não foi possível ler os dados da empresa: ${error.message}`);
    etapa = "calcular";
    const resultado = estudarEmpresa(data as unknown as DadosEstudo, { empresaId: p.empresa_id, ate, hoje: hojeISO() });
    etapa = "gravar";
    const gravado = await admin.rpc("estudo_registrar", {
      p_empresa_id: p.empresa_id,
      p_execucao_id: execucaoId as number,
      p_origem: origem,
      p_estudos: resultado.estudos as never,
      p_pedir_auditor: resultado.pedirAuditor,
    });
    if (gravado.error) throw new Error(`Não foi possível gravar o estudo: ${gravado.error.message}`);
    return gravado.data;
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    // Falha no banco: a fila tenta de novo; o erro só aparece na tela na última tentativa.
    // Falha na conta: tentar de novo não resolve, então registra e encerra.
    const ultima = job.tentativas >= job.max_tentativas;
    if (etapa === "calcular" || ultima) {
      await admin.rpc("estudo_falhou", { p_empresa_id: p.empresa_id, p_execucao_id: execucaoId as number, p_origem: origem, p_erro: mensagem });
    }
    if (etapa === "calcular") return { erro: mensagem };
    throw e;
  }
}
