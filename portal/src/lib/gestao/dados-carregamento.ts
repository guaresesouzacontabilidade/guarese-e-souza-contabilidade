import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import type { OpcoesOrdem, OrdemEditavel } from "@/components/loja/carregamentos";

type Cliente = ContextoEmpresa["supabase"];

/** Cadastros da NF-e usados na ordem de carregamento (produtos, compradores, transportadoras, inscrições e operações). */
export async function opcoesOrdem(supabase: Cliente, empresaId: string): Promise<OpcoesOrdem> {
  const [{ data: produtos }, { data: compradores }, { data: transportadores }, { data: emitentes }, { data: operacoes }] = await Promise.all([
    supabase.from("nfe_produtos").select("id, descricao, unidade, peso_kg, valor_unitario").eq("empresa_id", empresaId).eq("ativo", true).order("descricao"),
    supabase.from("nfe_destinatarios").select("id, nome, documento").eq("empresa_id", empresaId).order("nome").limit(2000),
    supabase.from("nfe_transportadores").select("id, nome, documento, placa, placa_uf, rntc").eq("empresa_id", empresaId).order("nome").limit(1000),
    supabase.from("nfe_emitentes").select("id, nome, inscricao_estadual").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    supabase.from("nfe_operacoes").select("id, nome, cfop").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
  ]);
  return {
    produtos: (produtos ?? []).map((p) => ({
      id: p.id,
      descricao: p.descricao,
      unidade: p.unidade,
      peso_kg: p.peso_kg == null ? null : Number(p.peso_kg),
      valor_unitario: p.valor_unitario == null ? null : Number(p.valor_unitario),
    })),
    compradores: compradores ?? [],
    transportadores: transportadores ?? [],
    emitentes: (emitentes ?? []).map((e) => ({
      id: e.id,
      nome: e.nome,
      inscricao: e.inscricao_estadual,
    })),
    operacoes: operacoes ?? [],
  };
}

/** Ordem salva → valores do formulário de edição. */
export function ordemEditavel(o: {
  id: string;
  produto_id: string;
  quantidade: number;
  peso_previsto_kg: number | null;
  preco_unitario: number | null;
  contrato: string | null;
  destinatario_id: string | null;
  destinatario_nome: string;
  destinatario_documento: string | null;
  local_carregamento: string | null;
  local_descarga: string | null;
  emitente_id: string | null;
  operacao_id: string | null;
  validade: string | null;
  frete_por_conta: number;
  transportador_id: string | null;
  transportador_nome: string | null;
  rntrc: string | null;
  motorista_nome: string | null;
  motorista_cpf: string | null;
  placa: string | null;
  placa_uf: string | null;
  placas_reboque: string[];
  observacoes: string | null;
}): OrdemEditavel {
  const t = (v: number | null) => (v == null ? null : String(v));
  return {
    ...o,
    quantidade: String(o.quantidade),
    peso_previsto_kg: t(o.peso_previsto_kg),
    preco_unitario: t(o.preco_unitario),
  };
}
