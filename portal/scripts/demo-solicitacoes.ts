/**
 * Solicitações de serviço de DEMONSTRAÇÃO (dados fictícios), abertas e
 * conduzidas pelas mesmas funções do portal (como cliente e como equipe).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessao } from "./demo-documentos";

const TITULO_MARCADOR = "Mudança de endereço da padaria";

export async function semearSolicitacoes(
  admin: SupabaseClient,
  conexao: { url: string; publica: string },
  ids: { padaria: string; oficina: string },
  emails: { cliente: string; cliente2: string; equipe: string },
): Promise<boolean> {
  // Só a primeira vez (testes automáticos também abrem solicitações nestas empresas).
  const { count } = await admin
    .from("solicitacoes")
    .select("id", { count: "exact", head: true })
    .in("empresa_id", [ids.padaria, ids.oficina])
    .eq("titulo", TITULO_MARCADOR);
  if (count) return false;
  const cliente = await sessao(admin, conexao.url, conexao.publica, emails.cliente);
  const cliente2 = await sessao(admin, conexao.url, conexao.publica, emails.cliente2);
  const equipe = await sessao(admin, conexao.url, conexao.publica, emails.equipe);
  const { data: eu } = await equipe.auth.getUser();

  const abrir = async (c: SupabaseClient, empresa: string, servico: string, titulo: string, descricao: string, prioridade = "normal") => {
    const { data, error } = await c.rpc("abrir_solicitacao", { p_empresa_id: empresa, p_servico: servico, p_titulo: titulo, p_descricao: descricao, p_prioridade: prioridade });
    if (error) throw new Error(`Falha ao abrir solicitação de demonstração: ${error.message}`);
    return data as string;
  };
  const atualizar = async (id: string, status: string, comentario: string | null) => {
    const { error } = await equipe.rpc("atualizar_solicitacao", { p_id: id, p_status: status, p_comentario: comentario, p_responsavel: eu.user?.id ?? null });
    if (error) throw new Error(`Falha ao atualizar solicitação de demonstração: ${error.message}`);
  };

  await abrir(cliente, ids.padaria, "admissao", "Contratar auxiliar de padeiro", "Início previsto para o dia 1º do próximo mês, salário de R$ 1.900,00, jornada de 44 horas.");
  const alteracao = await abrir(cliente, ids.padaria, "alteracao_contratual", TITULO_MARCADOR, "Vamos mudar para a Av. Principal, 200 (DEMO).", "urgente");
  await atualizar(alteracao, "aguardando_cliente", "Envie o contrato de locação do novo endereço e o IPTU do imóvel, por favor.");
  const declaracao = await abrir(cliente2, ids.oficina, "declaracao_faturamento", "Declaração de faturamento para o banco", "Últimos 12 meses, para financiamento de equipamento.");
  await atualizar(declaracao, "em_andamento", null);
  await atualizar(declaracao, "concluida", "Declaração publicada em Documentos (fictícia).");
  return true;
}
