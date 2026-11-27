// Sem "server-only": também é usado pelo script de dados de demonstração.
// Recebe o cliente administrativo de quem chama (rotinas do servidor).
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { dec } from "@/lib/dinheiro";
import { buscarTudo } from "@/lib/supabase/paginar";
import { calcularSugestoes, type BaixaC, type LancamentoC, type MovimentoC } from "./sugestoes";

/**
 * Gera sugestões de conciliação para uma empresa. As sugestões ficam com
 * status "sugerida" e só têm efeito depois de confirmadas por uma pessoa.
 */
export async function gerarSugestoes(admin: ClienteAdmin, empresaId: string) {
  const [contas, movimentos, lancamentos, baixas, itensAtivos, itensSugeridos, rejeicoes] = await Promise.all([
    buscarTudo((de, ate) => admin.from("contas_financeiras").select("id, tipo").eq("empresa_id", empresaId).range(de, ate)),
    buscarTudo((de, ate) =>
      admin
        .from("movimentos_bancarios")
        .select("id, conta_financeira_id, data, valor, descricao, documento_contraparte")
        .eq("empresa_id", empresaId)
        .eq("status_conciliacao", "pendente")
        .order("data")
        .order("id")
        .range(de, ate),
    ),
    buscarTudo((de, ate) =>
      admin
        .from("lancamentos")
        .select("id, tipo, descricao, valor_previsto, valor_baixado, data_vencimento, conta_financeira_id, numero_documento, contrapartes(nome, documento)")
        .eq("empresa_id", empresaId)
        .eq("status_revisao", "confirmado")
        .in("situacao", ["aberto", "parcial"])
        .order("data_vencimento")
        .order("id")
        .range(de, ate),
    ),
    buscarTudo((de, ate) =>
      admin
        .from("baixas")
        .select("id, tipo, valor_total, data_pagamento, conta_financeira_id, lancamentos(descricao, contrapartes(nome, documento))")
        .eq("empresa_id", empresaId)
        .gte("data_pagamento", new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10))
        .order("data_pagamento")
        .order("id")
        .range(de, ate),
    ),
    buscarTudo((de, ate) =>
      admin.from("conciliacao_itens").select("baixa_id").eq("empresa_id", empresaId).eq("ativo", true).not("baixa_id", "is", null).range(de, ate),
    ),
    buscarTudo((de, ate) =>
      admin
        .from("conciliacao_itens")
        .select("movimento_id, lancamento_id, baixa_id, conciliacoes!inner(status)")
        .eq("empresa_id", empresaId)
        .eq("conciliacoes.status", "sugerida")
        .range(de, ate),
    ),
    buscarTudo((de, ate) => admin.from("conciliacao_rejeicoes").select("movimento_id, alvo_id").eq("empresa_id", empresaId).range(de, ate)),
  ]);

  const tipoConta = new Map(contas.map((c) => [c.id, c.tipo]));
  const baixasConciliadas = new Set(itensAtivos.map((i) => i.baixa_id));
  // Itens que já estão em uma sugestão aberta não recebem outra.
  const emSugestao = new Set<string>();
  for (const i of itensSugeridos) {
    for (const id of [i.movimento_id, i.lancamento_id, i.baixa_id]) if (id) emSugestao.add(id);
  }

  const movs: MovimentoC[] = movimentos
    .filter((m) => !emSugestao.has(m.id))
    .map((m) => ({
      id: m.id,
      conta_id: m.conta_financeira_id,
      conta_tipo: tipoConta.get(m.conta_financeira_id),
      data: m.data,
      valor: dec(m.valor).toFixed(2),
      descricao: m.descricao,
      documento: m.documento_contraparte,
    }));

  const lancs: LancamentoC[] = lancamentos
    .filter((l) => !emSugestao.has(l.id))
    .map((l) => {
      const contraparte = l.contrapartes as { nome: string; documento: string | null } | null;
      return {
        id: l.id,
        tipo: l.tipo as LancamentoC["tipo"],
        descricao: l.descricao,
        aberto: dec(l.valor_previsto).minus(dec(l.valor_baixado)).toFixed(2),
        vencimento: l.data_vencimento,
        conta_id: l.conta_financeira_id,
        contraparte_nome: contraparte?.nome ?? null,
        contraparte_documento: contraparte?.documento ?? null,
        numero_documento: l.numero_documento,
      };
    })
    .filter((l) => dec(l.aberto).greaterThan(0));

  const bxs: BaixaC[] = baixas
    .filter((b) => !baixasConciliadas.has(b.id) && !emSugestao.has(b.id) && b.valor_total !== null)
    .map((b) => {
      const lanc = b.lancamentos as { descricao: string; contrapartes: { nome: string; documento: string | null } | null } | null;
      return {
        id: b.id,
        tipo: b.tipo as BaixaC["tipo"],
        total: dec(b.valor_total).toFixed(2),
        data: b.data_pagamento,
        conta_id: b.conta_financeira_id,
        descricao: `${lanc?.descricao ?? ""} ${lanc?.contrapartes?.nome ?? ""}`.trim(),
        contraparte_documento: lanc?.contrapartes?.documento ?? null,
      };
    });

  const rejeitados = new Set(rejeicoes.map((r) => `${r.movimento_id}:${r.alvo_id}`));
  const sugestoes = calcularSugestoes(movs, lancs, bxs, rejeitados);
  if (!sugestoes.length) return { analisadas: movs.length, sugestoes: 0 };

  let registradas = 0;
  // Em lotes, para não montar uma chamada grande demais.
  for (let i = 0; i < sugestoes.length; i += 200) {
    const { data, error } = await admin.rpc("registrar_sugestoes_conciliacao", {
      p_empresa_id: empresaId,
      p_sugestoes: sugestoes.slice(i, i + 200) as never,
    });
    if (error) throw new Error(`Falha ao registrar sugestões: ${error.message}`);
    registradas += Number(data ?? 0);
  }
  return { analisadas: movs.length, sugestoes: registradas };
}

/** Tarefa da fila "sugerir_conciliacao" (criada após cada importação de extrato). */
export async function executarSugestoes(admin: ClienteAdmin, job: Job) {
  const payload = (job.payload ?? {}) as { empresa_id?: string };
  const empresaId = payload.empresa_id ?? job.empresa_id;
  if (!empresaId) throw new Error("Tarefa sem empresa.");
  return gerarSugestoes(admin, empresaId);
}
