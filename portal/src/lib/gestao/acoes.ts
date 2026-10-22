"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import type { Json } from "@/lib/supabase/database.types";
import type { FormaPagamento } from "./rotulos";
import { emitirNfeDaVenda, nfeNaVenda } from "./nfe-venda";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

/** Número digitado no padrão brasileiro ("1.234,5") → texto com ponto, ou null. */
function numero(v: string): string | null {
  if (!v) return null;
  const d = lerValorBR(v);
  return d ? d.toString() : null;
}

function revalidarLoja(empresaId: string) {
  revalidatePath(`/e/${empresaId}/loja`, "layout");
}

// -----------------------------------------------------------------------------
// Configuração (o escritório liga; o gerente ajusta as preferências)
// -----------------------------------------------------------------------------
export async function salvarConfiguracaoLoja(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "empresa.ver");
  if (!ctx.equipe && !ctx.pode("gestao.gerenciar")) return falha("Você não tem permissão para configurar a loja.");
  const dados: Record<string, unknown> = { mensagem_comprovante: texto(fd, "mensagem_comprovante").slice(0, 500) };
  // Preferências do caixa: só vêm no formulário da loja completa (na modalidade "notas" ficam como estão)
  if (fd.has("validade_orcamento_dias")) {
    dados.permitir_estoque_negativo = fd.get("permitir_estoque_negativo") === "on";
    dados.permitir_venda_prazo = fd.get("permitir_venda_prazo") === "on";
    dados.desconto_maximo_operador = numero(texto(fd, "desconto_maximo_operador"));
    dados.validade_orcamento_dias = Number(texto(fd, "validade_orcamento_dias")) || 15;
  }
  for (const c of ["conta_dinheiro_id", "conta_pix_id", "conta_cartao_id"]) {
    const v = texto(fd, c);
    if (v && !UUID.test(v)) return falha("Conta inválida.");
    if (v) dados[c] = v;
  }
  // NF-e na hora da venda (os campos só vêm quando a empresa tem a emissão de NF-e configurada)
  if (fd.has("nfe_operacao_id")) {
    for (const c of ["nfe_operacao_id", "nfe_emitente_id"]) {
      const v = texto(fd, c);
      if (v && !UUID.test(v)) return falha("Escolha inválida para a NF-e.");
      dados[c] = v;
    }
    if (fd.has("validade_orcamento_dias")) dados.nfe_marcada_padrao = fd.get("nfe_marcada_padrao") === "on";
  }
  if (ctx.equipe) {
    dados.ativa = fd.get("ativa") === "on";
    const perfil = texto(fd, "perfil_fiscal");
    if (perfil) dados.perfil_fiscal = perfil;
    const modalidade = texto(fd, "modalidade");
    if (modalidade === "loja" || modalidade === "notas") dados.modalidade = modalidade;
  }
  const { error } = await ctx.supabase.rpc("gestao_configurar", { p_empresa_id: empresaId, p_dados: dados as Json });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  revalidatePath(`/e/${empresaId}`, "layout");
  return sucesso(ctx.equipe && dados.ativa ? "Gestão da loja ligada e configurada." : "Configurações salvas.");
}

// -----------------------------------------------------------------------------
// Produtos e estoque
// -----------------------------------------------------------------------------
export async function salvarProdutoLoja(empresaId: string, produtoId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  if (!UUID.test(empresaId) || (produtoId && !UUID.test(produtoId))) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const erros: Record<string, string[]> = {};
  const descricao = texto(fd, "descricao");
  if (descricao.length < 2 || descricao.length > 120) erros.descricao = ["Descreva o produto (2 a 120 letras)."];
  const ncm = texto(fd, "ncm").replace(/\D/g, "");
  if (!/^\d{8}$/.test(ncm)) erros.ncm = ["O NCM tem 8 números. Na dúvida, peça ao escritório."];
  const unidade = texto(fd, "unidade").toUpperCase();
  if (!unidade || unidade.length > 6) erros.unidade = ["Escolha a unidade."];
  const preco = numero(texto(fd, "valor_unitario"));
  if (!preco) erros.valor_unitario = ["Informe o preço de venda."];
  const medidas = ["espessura_cm", "largura_cm", "comprimento_m"].map((c) => [c, numero(texto(fd, c))] as const);
  if (unidade === "M3" && Boolean(medidas[0][1]) !== Boolean(medidas[1][1])) {
    erros.largura_cm = ["Para a cubagem, informe a espessura e a largura da peça."];
  }
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const dados = {
    codigo: texto(fd, "codigo"),
    descricao,
    ncm,
    cest: texto(fd, "cest"),
    gtin: texto(fd, "gtin"),
    unidade,
    valor_unitario: preco,
    preco_custo: numero(texto(fd, "preco_custo")),
    grupo: texto(fd, "grupo"),
    controla_estoque: fd.get("controla_estoque") === "on",
    estoque_minimo: numero(texto(fd, "estoque_minimo")),
    ativo: fd.get("ativo") !== "off",
    ...Object.fromEntries(medidas),
  };
  const { data, error } = await ctx.supabase.rpc("gestao_produto_salvar", {
    p_empresa_id: empresaId,
    p_id: (produtoId ?? null) as unknown as string,
    p_dados: dados as Json,
  });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  return sucesso(produtoId ? "Produto atualizado." : "Produto cadastrado.", { id: data as string });
}

export async function lancarEstoque(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const produtoId = texto(fd, "produto_id");
  if (!UUID.test(produtoId)) return falha("Escolha o produto.");
  const tipo = texto(fd, "tipo");
  const quantidade = numero(texto(fd, "quantidade"));
  if (!quantidade) return falha("Informe a quantidade.", { quantidade: ["Informe a quantidade."] });
  const { error } = await ctx.supabase.rpc("gestao_estoque_lancar", {
    p_empresa_id: empresaId,
    p_dados: { tipo, produto_id: produtoId, quantidade, custo_unitario: numero(texto(fd, "custo_unitario")), observacao: texto(fd, "observacao") },
  });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  return sucesso(tipo === "entrada_manual" ? "Entrada registrada no estoque." : "Saída registrada no estoque.");
}

export async function registrarInventario(empresaId: string, itens: { produto_id: string; contado: string }[], observacao: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const lista = itens
    .filter((i) => UUID.test(i.produto_id) && i.contado.trim() !== "")
    .map((i) => ({ produto_id: i.produto_id, contado: numero(i.contado) }));
  if (lista.some((i) => i.contado === null)) return falha("Há uma contagem com número inválido.");
  const { data, error } = await ctx.supabase.rpc("gestao_inventario", { p_empresa_id: empresaId, p_itens: lista, p_observacao: observacao.slice(0, 300) });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  const n = Number(data ?? 0);
  return sucesso(n ? `Inventário registrado: ${n} produto(s) ajustado(s).` : "Inventário conferido: nenhum ajuste foi preciso.");
}

export async function darEntradaNota(
  empresaId: string,
  documentoFiscalId: string,
  itens: { produto_id: string; quantidade: string; custo_unitario: string }[],
): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(documentoFiscalId)) return falha("Nota inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  const lista = itens
    .filter((i) => UUID.test(i.produto_id))
    .map((i) => ({ produto_id: i.produto_id, quantidade: numero(i.quantidade), custo_unitario: numero(i.custo_unitario) }));
  const { data, error } = await ctx.supabase.rpc("gestao_entrada_nota", { p_empresa_id: empresaId, p_documento_fiscal_id: documentoFiscalId, p_itens: lista });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  return sucesso(`Entrada registrada: ${data} item(ns) da nota no estoque.`);
}

// -----------------------------------------------------------------------------
// Clientes, caixa e vendas
// -----------------------------------------------------------------------------
export async function salvarClienteLoja(empresaId: string, dados: { nome: string; documento?: string; telefone?: string; email?: string }): Promise<ResultadoAcao<{ id: string; nome: string }>> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  const { data, error } = await ctx.supabase.rpc("gestao_cliente_salvar", { p_empresa_id: empresaId, p_dados: dados });
  if (error) return falha(mensagemErro(error));
  return sucesso("Cliente cadastrado.", { id: data as string, nome: dados.nome.trim() });
}

export async function abrirCaixa(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  const valor = texto(fd, "valor_abertura") ? numero(texto(fd, "valor_abertura")) : "0";
  if (valor === null) return falha("Troco inicial inválido.", { valor_abertura: ["Use o formato 100,00."] });
  const { error } = await ctx.supabase.rpc("gestao_caixa_abrir", { p_empresa_id: empresaId, p_caixa_nome: texto(fd, "caixa_nome") || "Caixa 1", p_valor_abertura: Number(valor) });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  return sucesso("Caixa aberto. Boas vendas!");
}

export async function movimentarCaixa(empresaId: string, sessaoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(sessaoId)) return falha("Caixa inválido.");
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  const tipo = texto(fd, "tipo");
  const valor = numero(texto(fd, "valor"));
  if (!valor) return falha("Informe o valor.", { valor: ["Informe o valor."] });
  const conta = texto(fd, "conta_id");
  if (conta && !UUID.test(conta)) return falha("Conta inválida.");
  const { error } = await ctx.supabase.rpc("gestao_caixa_movimento", {
    p_sessao_id: sessaoId,
    p_tipo: tipo,
    p_valor: Number(valor),
    p_motivo: texto(fd, "motivo"),
    p_conta_id: (conta || null) as unknown as string,
  });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  return sucesso(tipo === "sangria" ? "Sangria registrada." : "Suprimento registrado.");
}

export async function fecharCaixa(empresaId: string, sessaoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(sessaoId)) return falha("Caixa inválido.");
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  const contado = numero(texto(fd, "valor_contado"));
  if (contado === null) return falha("Informe quanto dinheiro tem na gaveta.", { valor_contado: ["Conte o dinheiro e informe o valor (pode ser zero)."] });
  const { data, error } = await ctx.supabase.rpc("gestao_caixa_fechar", { p_sessao_id: sessaoId, p_valor_contado: Number(contado), p_observacao: texto(fd, "observacao") });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  const dif = Number((data as { diferenca?: number } | null)?.diferenca ?? 0);
  return sucesso(dif === 0 ? "Caixa fechado. O dinheiro conferiu certinho." : dif > 0 ? "Caixa fechado com sobra de dinheiro." : "Caixa fechado com falta de dinheiro.");
}

export interface ItemVendaEntrada {
  produto_id: string;
  pecas?: string | null;
  comprimento_m?: string | null;
  quantidade?: string | null;
  preco_unitario: string;
  desconto?: string | null;
}

export interface PagamentoEntrada {
  forma: FormaPagamento;
  valor: string;
  valor_recebido?: string | null;
  parcelas?: number;
  primeiro_vencimento?: string | null;
  intervalo_dias?: number;
}

export interface VendaEntrada {
  sessao_id?: string;
  orcamento_id?: string | null;
  cliente_id?: string | null;
  cliente_nome?: string;
  cliente_documento?: string;
  cliente_telefone?: string;
  itens: ItemVendaEntrada[];
  desconto?: string;
  frete?: string;
  pagamentos?: PagamentoEntrada[];
  observacao?: string;
  entrega?: string;
  validade?: string;
}

function normalizarItens(itens: ItemVendaEntrada[]) {
  return itens.map((i) => ({
    produto_id: i.produto_id,
    pecas: i.pecas ? numero(i.pecas) : null,
    comprimento_m: i.comprimento_m ? numero(i.comprimento_m) : null,
    quantidade: i.quantidade ? numero(i.quantidade) : null,
    preco_unitario: numero(i.preco_unitario),
    desconto: i.desconto ? numero(i.desconto) : null,
  }));
}

export interface ResultadoNfeVenda {
  ok: boolean;
  id?: string;
  mensagem: string;
}

export async function finalizarVenda(
  empresaId: string,
  venda: VendaEntrada,
  opcoes: { emitirNfe?: boolean } = {},
): Promise<ResultadoAcao<{ id: string; numero: number; troco: number; total: number; nfe?: ResultadoNfeVenda }>> {
  if (!UUID.test(empresaId) || !venda.sessao_id || !UUID.test(venda.sessao_id)) return falha("Abra o caixa antes de vender.");
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  if (venda.pagamentos?.some((p) => p.primeiro_vencimento && !DATA.test(p.primeiro_vencimento))) return falha("Vencimento inválido.");
  const dados = {
    sessao_id: venda.sessao_id,
    orcamento_id: venda.orcamento_id && UUID.test(venda.orcamento_id) ? venda.orcamento_id : null,
    cliente_id: venda.cliente_id && UUID.test(venda.cliente_id) ? venda.cliente_id : null,
    cliente_nome: venda.cliente_nome?.slice(0, 120),
    cliente_documento: venda.cliente_documento,
    cliente_telefone: venda.cliente_telefone,
    itens: normalizarItens(venda.itens),
    desconto: venda.desconto ? numero(venda.desconto) : null,
    frete: venda.frete ? numero(venda.frete) : null,
    pagamentos: (venda.pagamentos ?? []).map((p) => ({
      forma: p.forma,
      valor: numero(p.valor),
      valor_recebido: p.valor_recebido ? numero(p.valor_recebido) : null,
      parcelas: p.parcelas ?? 1,
      primeiro_vencimento: p.primeiro_vencimento || null,
      intervalo_dias: p.intervalo_dias ?? 30,
    })),
    observacao: venda.observacao?.slice(0, 1000),
    entrega: venda.entrega?.slice(0, 300),
  };
  const { data, error } = await ctx.supabase.rpc("gestao_venda_finalizar", { p_empresa_id: empresaId, p_dados: dados as Json });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  const r = data as { id: string; numero: number; troco: number; total: number };
  // NF-e na hora da venda: a venda já está gravada; se a nota não sair, a venda continua valendo
  if (opcoes.emitirNfe) {
    try {
      const nfe = await nfeNaVenda(ctx.supabase, empresaId, ctx.pode("nfe.emitir"));
      const resultado = nfe.configurada ? await emitirNfeDaVenda(ctx.supabase, empresaId, r.id, nfe) : { ok: false, mensagem: "Seu acesso não inclui a emissão de NF-e desta empresa." };
      return sucesso(`Venda nº ${r.numero} concluída.`, { ...r, nfe: resultado });
    } catch (e) {
      console.error("Falha ao emitir a NF-e da venda", e);
      return sucesso(`Venda nº ${r.numero} concluída.`, { ...r, nfe: { ok: false, mensagem: "A venda foi concluída, mas a NF-e não pôde ser enviada agora. Emita pela venda." } });
    }
  }
  return sucesso(`Venda nº ${r.numero} concluída.`, r);
}

export async function salvarOrcamento(empresaId: string, orcamentoId: string | null, venda: VendaEntrada): Promise<ResultadoAcao<{ id: string; numero: number }>> {
  if (!UUID.test(empresaId) || (orcamentoId && !UUID.test(orcamentoId))) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  if (venda.validade && !DATA.test(venda.validade)) return falha("Validade inválida.");
  const dados = {
    cliente_id: venda.cliente_id && UUID.test(venda.cliente_id) ? venda.cliente_id : null,
    cliente_nome: venda.cliente_nome?.slice(0, 120),
    cliente_documento: venda.cliente_documento,
    cliente_telefone: venda.cliente_telefone,
    itens: normalizarItens(venda.itens),
    desconto: venda.desconto ? numero(venda.desconto) : null,
    frete: venda.frete ? numero(venda.frete) : null,
    observacao: venda.observacao?.slice(0, 1000),
    entrega: venda.entrega?.slice(0, 300),
    validade: venda.validade || null,
  };
  const { data, error } = await ctx.supabase.rpc("gestao_orcamento_salvar", { p_empresa_id: empresaId, p_id: (orcamentoId ?? null) as unknown as string, p_dados: dados as Json });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  const r = data as { id: string; numero: number };
  return sucesso(`Orçamento nº ${r.numero} salvo.`, r);
}

export async function cancelarVenda(empresaId: string, vendaId: string, motivo: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(vendaId)) return falha("Venda inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  const { error } = await ctx.supabase.rpc("gestao_venda_cancelar", { p_venda_id: vendaId, p_motivo: motivo.trim() });
  if (error) return falha(mensagemErro(error));
  revalidarLoja(empresaId);
  return sucesso("Cancelado.");
}

/** Situação da NF-e emitida na hora da venda (para o caixa acompanhar até a autorização). */
export async function situacaoNfeDaVenda(
  empresaId: string,
  nfeId: string,
): Promise<{ situacao: string; numero: number; serie: number; motivo: string | null } | null> {
  if (!UUID.test(empresaId) || !UUID.test(nfeId)) return null;
  const ctx = await exigirPermissao(empresaId, "gestao.vender");
  const { data } = await ctx.supabase.from("nfe_emissoes").select("situacao, numero, serie, mensagens").eq("id", nfeId).eq("empresa_id", empresaId).maybeSingle();
  if (!data) return null;
  const msgs = (Array.isArray(data.mensagens) ? data.mensagens : []) as { codigo?: string; descricao?: string }[];
  const ultima = msgs.at(-1);
  return { situacao: data.situacao, numero: Number(data.numero), serie: data.serie, motivo: ultima?.descricao ? `${ultima.codigo ? `${ultima.codigo} — ` : ""}${ultima.descricao}` : null };
}
