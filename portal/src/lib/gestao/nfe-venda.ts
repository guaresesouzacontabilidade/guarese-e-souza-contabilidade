import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { mensagemErro } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import type { DocumentoDisponivel, DocumentoFiscal, FormaPagamento, NotaNaVenda } from "./rotulos";

export type { NotaNaVenda };

type Cliente = ContextoEmpresa["supabase"];

const VAZIO: DocumentoDisponivel = { disponivel: false, motivo: null, ambiente: null };

/**
 * O que o caixa consegue emitir agora (NF-e e cupom fiscal), com o motivo
 * quando não dá, e a regra do escritório para o cartão. Vem de uma função do
 * banco que quem vende pode chamar sem ver as configurações fiscais.
 */
export async function notaNaVenda(supabase: Cliente, empresaId: string): Promise<NotaNaVenda> {
  const [{ data }, { data: dests }] = await Promise.all([
    supabase.rpc("gestao_documentos_fiscais", { p_empresa_id: empresaId }),
    supabase.from("nfe_destinatarios").select("documento").eq("empresa_id", empresaId).not("documento", "is", null).limit(10000),
  ]);
  const d = (data ?? {}) as {
    nfe?: DocumentoDisponivel;
    nfce?: DocumentoDisponivel;
    obrigatoria_formas?: FormaPagamento[];
    documento_padrao?: DocumentoFiscal;
    marcada_padrao?: boolean;
  };
  const nfe = d.nfe ? { disponivel: Boolean(d.nfe.disponivel), motivo: d.nfe.motivo ?? null, ambiente: d.nfe.ambiente ?? null } : VAZIO;
  const nfce = d.nfce ? { disponivel: Boolean(d.nfce.disponivel), motivo: d.nfce.motivo ?? null, ambiente: d.nfce.ambiente ?? null } : VAZIO;
  const obrigatoriaFormas = d.obrigatoria_formas ?? [];
  return {
    // A caixa da nota aparece quando alguma nota está ligada ou quando o escritório exige a nota no cartão
    configurada: nfe.disponivel || nfce.disponivel || obrigatoriaFormas.length > 0 || Boolean(nfe.ambiente),
    nfe,
    nfce,
    obrigatoriaFormas,
    documentoPadrao: d.documento_padrao === "nfce" ? "nfce" : "nfe",
    marcadaPadrao: Boolean(d.marcada_padrao),
    documentosComEndereco: (dests ?? []).map((x) => x.documento!).filter(Boolean),
  };
}

export interface ResultadoNotaVenda {
  ok: boolean;
  documento: DocumentoFiscal;
  id?: string;
  numero?: number;
  mensagem: string;
}

/**
 * Emite a nota (cupom ou NF-e) de uma venda concluída. O banco monta o pedido
 * com os itens, o desconto, o frete e os pagamentos da própria venda e a
 * inscrição e a operação escolhidas na loja; a venda já está gravada, então,
 * se a nota não sair agora, ela fica pendente para emitir de novo.
 */
export async function emitirNotaDaVendaCom(supabase: Cliente, vendaId: string, documento: DocumentoFiscal): Promise<ResultadoNotaVenda> {
  const { data, error } = await supabase.rpc("gestao_venda_emitir_nota", { p_venda_id: vendaId, p_documento: documento });
  if (error) return { ok: false, documento, mensagem: mensagemErro(error) };
  processarFilaDepois({ tipos: ["emitir_nfe"], limite: 5 });
  const r = data as { id: string; numero: number };
  const nome = documento === "nfce" ? "Cupom fiscal" : "NF-e";
  return { ok: true, documento, id: r.id, numero: Number(r.numero), mensagem: `${nome} nº ${r.numero} enviado à SEFAZ.` };
}

/** Situação da nota da venda, para quem vende (sem abrir a lista de notas da empresa). */
export interface SituacaoNotaVenda {
  documento: DocumentoFiscal | null;
  id: string | null;
  modelo: 55 | 65 | null;
  situacao: string | null;
  numero: number | null;
  serie: number | null;
  ambiente: "homologacao" | "producao" | null;
  chave: string | null;
  motivo: string | null;
}

export async function situacaoNotaDaVendaCom(supabase: Cliente, vendaId: string): Promise<SituacaoNotaVenda | null> {
  const { data, error } = await supabase.rpc("gestao_venda_nota", { p_venda_id: vendaId });
  if (error || !data) return null;
  const n = data as {
    documento: DocumentoFiscal | null;
    id?: string;
    modelo?: number;
    situacao: string | null;
    numero?: number;
    serie?: number;
    ambiente?: "homologacao" | "producao";
    chave?: string | null;
    mensagens?: { codigo?: string; descricao?: string }[] | null;
  };
  const ultima = Array.isArray(n.mensagens) ? n.mensagens.at(-1) : undefined;
  return {
    documento: n.documento ?? null,
    id: n.id ?? null,
    modelo: n.modelo === 65 ? 65 : n.modelo === 55 ? 55 : null,
    situacao: n.situacao ?? null,
    numero: n.numero != null ? Number(n.numero) : null,
    serie: n.serie ?? null,
    ambiente: n.ambiente ?? null,
    chave: n.chave ?? null,
    motivo: ultima?.descricao ? `${ultima.codigo ? `${ultima.codigo} — ` : ""}${ultima.descricao}` : null,
  };
}
