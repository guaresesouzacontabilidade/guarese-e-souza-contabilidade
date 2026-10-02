import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { ultimoDiaDoMes } from "@/lib/competencia";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { carregarDre } from "@/lib/relatorios/dados";

/**
 * Verificações automáticas de cada etapa do fechamento. Elas orientam a
 * equipe; quem conclui cada etapa continua sendo uma pessoa.
 */
export interface Verificacao {
  texto: string;
  ok: boolean | null; // null = informativo
  href?: string;
}
export type VerificacoesFechamento = Record<"coleta" | "conferencia" | "conciliacao" | "revisao" | "publicacao", Verificacao[]>;

export async function carregarVerificacoes(supabase: ContextoEmpresa["supabase"], empresaId: string, comp: string): Promise<VerificacoesFechamento> {
  const inicio = comp;
  const fim = ultimoDiaDoMes(comp);
  const mes = comp.slice(0, 7);
  const e = `/e/${empresaId}`;
  const contar = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);

  const [checklist, aguardando, correcao, aposFechamento, sugeridos, movPendentes, conferencia, semVinculo, semComprovante, dre, relatorio] = await Promise.all([
    supabase.rpc("resumo_checklist", { p_empresa_id: empresaId, p_competencia: comp }),
    contar(
      supabase
        .from("documentos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("competencia", comp)
        .eq("direcao", "cliente")
        .in("status", ["recebido", "em_analise"])
        .is("excluido_em", null),
    ),
    contar(
      supabase
        .from("documentos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("competencia", comp)
        .eq("status", "correcao")
        .is("excluido_em", null),
    ),
    contar(
      supabase
        .from("documentos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("competencia", comp)
        .eq("recebido_apos_fechamento", true)
        .is("apos_fechamento_avaliado_em", null)
        .is("excluido_em", null),
    ),
    contar(
      supabase
        .from("lancamentos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("status_revisao", "sugerido")
        .neq("situacao", "cancelado")
        .gte("data_competencia", inicio)
        .lte("data_competencia", fim),
    ),
    contar(
      supabase
        .from("movimentos_bancarios")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("status_conciliacao", "pendente")
        .gte("data", inicio)
        .lte("data", fim),
    ),
    supabase.rpc("conferencia_saldos", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }),
    supabase.rpc("documentos_sem_vinculo", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }).select("id"),
    supabase.rpc("movimentos_sem_comprovante", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: fim }).select("id"),
    carregarDre(supabase, empresaId, inicio, fim).catch(() => null),
    supabase
      .from("relatorios_publicados")
      .select("id, versao, situacao, publicado_em")
      .eq("empresa_id", empresaId)
      .eq("tipo", "pacote_mensal")
      .eq("competencia", comp)
      .eq("status", "publicado")
      .maybeSingle(),
  ]);

  const ck = (checklist.data ?? {}) as { obrigatorios?: number; percentual?: number | null; pendentes?: number; correcao?: number; nao_se_aplica_solicitado?: number };
  const coleta: Verificacao[] = [
    ck.obrigatorios
      ? {
          texto: `Documentos obrigatórios entregues: ${ck.percentual ?? 0}%${ck.pendentes ? ` — ${ck.pendentes} faltando` : ""}${ck.correcao ? `, ${ck.correcao} para corrigir` : ""}`,
          ok: (ck.percentual ?? 0) >= 100,
          href: `${e}/pendencias?competencia=${mes}`,
        }
      : { texto: "Não há checklist de documentos para este mês.", ok: null, href: `${e}/pendencias?competencia=${mes}` },
  ];
  if (ck.nao_se_aplica_solicitado) {
    coleta.push({ texto: `${ck.nao_se_aplica_solicitado} pedido(s) de “não se aplica” aguardando decisão`, ok: false, href: `${e}/pendencias?competencia=${mes}` });
  }

  const conferenciaEtapa: Verificacao[] = [
    { texto: aguardando ? `${aguardando} documento(s) aguardando conferência` : "Todos os documentos do mês foram conferidos", ok: aguardando === 0, href: `${e}/documentos?competencia=${mes}&conferir=1` },
    { texto: correcao ? `${correcao} documento(s) com correção pedida ao cliente` : "Nenhum documento com correção pendente", ok: correcao === 0, href: `${e}/documentos?competencia=${mes}&status=correcao` },
    { texto: sugeridos ? `${sugeridos} lançamento(s) sugerido(s) (XML/OCR) sem confirmação` : "Nenhum lançamento sugerido pendente", ok: sugeridos === 0, href: `${e}/financeiro/lancamentos?revisao=sugerido` },
  ];
  if (aposFechamento) conferenciaEtapa.push({ texto: `${aposFechamento} documento(s) recebido(s) após o fechamento para avaliar`, ok: false, href: `${e}/documentos?competencia=${mes}` });

  const conciliacao: Verificacao[] = [
    {
      texto: movPendentes ? `${movPendentes} movimentação(ões) bancária(s) do mês sem conciliar` : "Todas as movimentações bancárias do mês estão conciliadas",
      ok: movPendentes === 0,
      href: `/e/${empresaId}/conciliacao?aba=pendentes&inicio=${inicio}&fim=${fim}`,
    },
  ];
  for (const c of (conferencia.data ?? []).filter((x) => ["conta_corrente", "poupanca", "investimento"].includes(x.conta_tipo))) {
    if (c.saldo_extrato === null) conciliacao.push({ texto: `${c.conta_nome}: saldo do banco não informado para o mês`, ok: null, href: `/e/${empresaId}/conciliacao?aba=saldos&competencia=${mes}` });
    else {
      const dif = dec(c.diferenca ?? 0);
      conciliacao.push({
        texto: dif.isZero()
          ? `${c.conta_nome}: saldo conferido com o banco em ${formatarData(c.saldo_extrato_data)}`
          : `${c.conta_nome}: diferença de ${formatarMoeda(dif, { sinal: true })} com o banco em ${formatarData(c.saldo_extrato_data)}`,
        ok: dif.isZero(),
        href: `/e/${empresaId}/conciliacao?aba=saldos&competencia=${mes}`,
      });
    }
  }

  const revisao: Verificacao[] = [];
  if (dre) {
    revisao.push({
      texto: `Resultado do mês: receitas ${formatarMoeda(dre.totais.receita_bruta.total)}, ${dec(dre.totais.resultado_liquido.total).isNegative() ? "prejuízo" : "lucro"} de ${formatarMoeda(dec(dre.totais.resultado_liquido.total).abs())}`,
      ok: null,
      href: `${e}/relatorios/dre?periodo=${mes}`,
    });
  }
  const nSemVinculo = semVinculo.data?.length ?? 0;
  const nSemComprovante = semComprovante.data?.length ?? 0;
  revisao.push(
    { texto: nSemVinculo ? `${nSemVinculo} documento(s) financeiro(s) sem lançamento vinculado` : "Todos os documentos financeiros têm lançamento", ok: nSemVinculo === 0 ? true : null, href: `/e/${empresaId}/conciliacao?aba=saldos&competencia=${mes}` },
    { texto: nSemComprovante ? `${nSemComprovante} movimentação(ões) sem comprovante anexado` : "Todas as movimentações têm comprovante", ok: nSemComprovante === 0 ? true : null, href: `/e/${empresaId}/conciliacao?aba=saldos&competencia=${mes}` },
  );

  const rel = relatorio.data;
  const publicacao: Verificacao[] = [
    rel
      ? {
          texto: `Pacote do mês publicado (versão ${rel.versao}, ${rel.situacao === "revisado" ? "revisado" : "preliminar"}) em ${formatarData(rel.publicado_em)}`,
          ok: rel.situacao === "revisado",
          href: `${e}/relatorios/publicados/${rel.id}`,
        }
      : { texto: "Pacote de relatórios do mês ainda não publicado", ok: false, href: `${e}/relatorios/publicados/novo?periodo=${mes}` },
  ];

  return { coleta, conferencia: conferenciaEtapa, conciliacao, revisao, publicacao };
}
