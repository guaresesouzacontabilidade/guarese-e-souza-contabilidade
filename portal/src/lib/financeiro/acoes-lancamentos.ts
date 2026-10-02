"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { booleano, dataObrigatoria, dataOpcional, textoOpcional, uuidOpcional, valorMonetario } from "@/lib/validacao";
import { formatarMoeda } from "@/lib/dinheiro";

const UUID = /^[0-9a-f-]{36}$/i;

async function contextoEdicao(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.editar")) throw new Error("Você não tem permissão para editar o financeiro desta empresa.");
  return ctx;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/financeiro`, "layout");
  revalidatePath(`/e/${empresaId}`);
}

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "");
}

// ------------------------------------------------------------------ lançamentos
const esquemaLancamento = z
  .object({
    id: uuidOpcional,
    tipo: z.enum(["receber", "pagar"], { message: "Escolha se é conta a receber ou a pagar." }),
    descricao: z.string().trim().min(2, "Descreva o lançamento.").max(300),
    categoria_id: z.string().regex(UUID, "Selecione a categoria."),
    contraparte_id: uuidOpcional,
    centro_custo_id: uuidOpcional,
    projeto_id: uuidOpcional,
    conta_financeira_id: uuidOpcional,
    data_competencia: dataObrigatoria("Informe a data de competência (quando a receita/despesa aconteceu)."),
    data_vencimento: dataObrigatoria("Informe o vencimento."),
    valor: valorMonetario({ obrigatorio: true, positivo: true }),
    numero_documento: textoOpcional,
    observacoes: textoOpcional,
    modo: z.enum(["unico", "parcelado", "recorrente"]).default("unico"),
    parcelas: z.coerce.number().int().min(2, "Mínimo de 2 parcelas.").max(360).optional(),
    competencia_por_parcela: z.boolean().default(false),
    frequencia: z.enum(["semanal", "quinzenal", "mensal", "bimestral", "trimestral", "semestral", "anual"]).optional(),
    data_fim: dataOpcional,
    ja_pago: z.boolean().default(false),
    data_pagamento: dataOpcional,
    conta_pagamento_id: uuidOpcional,
    documento_id: uuidOpcional,
  })
  .superRefine((d, ctx) => {
    if (d.modo === "parcelado" && !d.parcelas) ctx.addIssue({ code: "custom", path: ["parcelas"], message: "Informe o número de parcelas." });
    if (d.modo === "recorrente" && !d.frequencia) ctx.addIssue({ code: "custom", path: ["frequencia"], message: "Informe a frequência." });
    if (d.ja_pago && d.modo === "unico") {
      if (!d.data_pagamento) ctx.addIssue({ code: "custom", path: ["data_pagamento"], message: "Informe a data do pagamento." });
      if (!d.conta_pagamento_id) ctx.addIssue({ code: "custom", path: ["conta_pagamento_id"], message: "Informe a conta." });
    }
  });

export async function salvarLancamento(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const dados = esquemaLancamento.safeParse({
      id: texto(fd, "id"),
      tipo: fd.get("tipo"),
      descricao: texto(fd, "descricao"),
      categoria_id: texto(fd, "categoria_id"),
      contraparte_id: texto(fd, "contraparte_id"),
      centro_custo_id: texto(fd, "centro_custo_id"),
      projeto_id: texto(fd, "projeto_id"),
      conta_financeira_id: texto(fd, "conta_financeira_id"),
      data_competencia: texto(fd, "data_competencia"),
      data_vencimento: texto(fd, "data_vencimento"),
      valor: texto(fd, "valor"),
      numero_documento: texto(fd, "numero_documento"),
      observacoes: texto(fd, "observacoes"),
      modo: fd.get("modo") || "unico",
      parcelas: fd.get("parcelas") || undefined,
      competencia_por_parcela: booleano(fd, "competencia_por_parcela"),
      frequencia: fd.get("frequencia") || undefined,
      data_fim: texto(fd, "data_fim"),
      ja_pago: booleano(fd, "ja_pago"),
      data_pagamento: texto(fd, "data_pagamento"),
      conta_pagamento_id: texto(fd, "conta_pagamento_id"),
      documento_id: texto(fd, "documento_id"),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const d = dados.data;
    const base = {
      descricao: d.descricao,
      categoria_id: d.categoria_id,
      contraparte_id: d.contraparte_id ?? null,
      centro_custo_id: d.centro_custo_id ?? null,
      projeto_id: d.projeto_id ?? null,
      conta_financeira_id: d.conta_financeira_id ?? null,
      numero_documento: d.numero_documento ?? null,
      observacoes: d.observacoes ?? null,
    };

    // Edição de um lançamento existente
    if (d.id) {
      const { error } = await ctx.supabase
        .from("lancamentos")
        .update({ ...base, tipo: d.tipo, data_competencia: d.data_competencia, data_vencimento: d.data_vencimento, valor_previsto: Number(d.valor) })
        .eq("id", d.id)
        .eq("empresa_id", empresaId);
      if (error) return falha(mensagemErro(error));
      revalidar(empresaId);
      return sucesso("Lançamento atualizado.", { id: d.id });
    }

    let idCriado: string | null = null;
    if (d.modo === "parcelado") {
      const { data, error } = await ctx.supabase.rpc("criar_parcelamento", {
        p_empresa_id: empresaId,
        p_tipo: d.tipo,
        p_descricao: d.descricao,
        p_categoria_id: d.categoria_id,
        p_valor_total: Number(d.valor),
        p_parcelas: d.parcelas!,
        p_primeiro_vencimento: d.data_vencimento,
        p_data_competencia: d.data_competencia,
        p_competencia_por_parcela: d.competencia_por_parcela,
        p_contraparte_id: base.contraparte_id ?? undefined,
        p_centro_custo_id: base.centro_custo_id ?? undefined,
        p_projeto_id: base.projeto_id ?? undefined,
        p_conta_financeira_id: base.conta_financeira_id ?? undefined,
        p_numero_documento: base.numero_documento ?? undefined,
        p_observacoes: base.observacoes ?? undefined,
      });
      if (error) return falha(mensagemErro(error));
      const { data: primeira } = await ctx.supabase.from("lancamentos").select("id").eq("parcelamento_id", data as string).eq("parcela_numero", 1).single();
      idCriado = primeira?.id ?? null;
    } else if (d.modo === "recorrente") {
      const dia = Number(d.data_vencimento.slice(8, 10));
      const { data: rec, error } = await ctx.supabase
        .from("recorrencias")
        .insert({
          empresa_id: empresaId,
          tipo: d.tipo,
          descricao: d.descricao,
          categoria_id: d.categoria_id,
          contraparte_id: base.contraparte_id,
          centro_custo_id: base.centro_custo_id,
          projeto_id: base.projeto_id,
          conta_financeira_id: base.conta_financeira_id,
          valor: Number(d.valor),
          frequencia: d.frequencia!,
          dia_vencimento: ["semanal", "quinzenal"].includes(d.frequencia!) ? null : dia,
          data_inicio: d.data_vencimento,
          data_fim: d.data_fim ?? null,
        })
        .select("id")
        .single();
      if (error) return falha(mensagemErro(error));
      const { error: e2 } = await ctx.supabase.rpc("gerar_recorrencias_empresa", { p_empresa_id: empresaId });
      if (e2) return falha(mensagemErro(e2));
      const { data: primeiro } = await ctx.supabase.from("lancamentos").select("id").eq("recorrencia_id", rec.id).order("data_vencimento").limit(1).maybeSingle();
      idCriado = primeiro?.id ?? null;
    } else {
      const { data, error } = await ctx.supabase
        .from("lancamentos")
        .insert({
          ...base,
          empresa_id: empresaId,
          tipo: d.tipo,
          data_competencia: d.data_competencia,
          data_vencimento: d.data_vencimento,
          valor_previsto: Number(d.valor),
          status_revisao: "confirmado",
        })
        .select("id")
        .single();
      if (error) return falha(mensagemErro(error));
      idCriado = data.id;
      if (d.ja_pago) {
        // O tipo (pagar/receber) é copiado do lançamento pelo banco.
        const { error: eb } = await ctx.supabase.from("baixas").insert({
          empresa_id: empresaId,
          lancamento_id: data.id,
          data_pagamento: d.data_pagamento!,
          conta_financeira_id: d.conta_pagamento_id!,
          valor_principal: Number(d.valor),
        } as never);
        if (eb) return falha(`Lançamento criado, mas o pagamento não foi registrado: ${mensagemErro(eb)}`, undefined);
      }
    }

    if (idCriado && d.documento_id) {
      await ctx.supabase.from("lancamento_documentos").insert({ lancamento_id: idCriado, documento_id: d.documento_id, empresa_id: empresaId, tipo_vinculo: "comprovante" });
    }
    revalidar(empresaId);
    const msg = d.modo === "parcelado" ? `${d.parcelas} parcelas criadas.` : d.modo === "recorrente" ? "Recorrência criada e lançamentos gerados." : "Lançamento criado.";
    return sucesso(msg, idCriado ? { id: idCriado } : undefined);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function confirmarLancamentos(empresaId: string, ids: string[], categoriaId?: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const alvo = ids.filter((i) => UUID.test(i));
    if (!alvo.length) return falha("Selecione ao menos um lançamento.");
    const mudanca: { status_revisao: string; categoria_id?: string } = { status_revisao: "confirmado" };
    if (categoriaId && UUID.test(categoriaId)) mudanca.categoria_id = categoriaId;
    let ok = 0;
    const erros: string[] = [];
    for (const id of alvo) {
      const { error } = await ctx.supabase.from("lancamentos").update(mudanca).eq("id", id).eq("empresa_id", empresaId).eq("status_revisao", "sugerido");
      if (error) erros.push(error.code === "23514" ? "Defina a categoria antes de confirmar." : mensagemErro(error));
      else ok++;
    }
    revalidar(empresaId);
    if (!ok) return falha(erros[0] ?? "Nada foi confirmado.");
    return sucesso(`${ok} lançamento(s) confirmado(s). Agora eles entram nos relatórios.${erros.length ? ` ${erros.length} com pendência: ${erros[0]}` : ""}`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function cancelarLancamento(empresaId: string, id: string, motivo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    if (!motivo.trim()) return falha("Informe o motivo do cancelamento.");
    const { error } = await ctx.supabase.from("lancamentos").update({ situacao: "cancelado", motivo_cancelamento: motivo.trim() }).eq("id", id).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Lançamento cancelado. Ele continua no histórico, fora dos relatórios.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function reativarLancamento(empresaId: string, id: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { error } = await ctx.supabase.from("lancamentos").update({ situacao: "aberto" }).eq("id", id).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Lançamento reativado.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function excluirLancamento(empresaId: string, id: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { error } = await ctx.supabase.from("lancamentos").delete().eq("id", id).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Lançamento excluído.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ baixas
const esquemaBaixa = z.object({
  data_pagamento: dataObrigatoria("Informe a data do pagamento/recebimento."),
  conta_financeira_id: z.string().regex(UUID, "Selecione a conta."),
  valor_principal: valorMonetario({ obrigatorio: true, positivo: true }),
  juros: valorMonetario({ positivo: true, permitirZero: true }),
  multa: valorMonetario({ positivo: true, permitirZero: true }),
  desconto: valorMonetario({ positivo: true, permitirZero: true }),
  taxas: valorMonetario({ positivo: true, permitirZero: true }),
  forma_pagamento: z.enum(["pix", "boleto", "transferencia", "cartao_credito", "cartao_debito", "dinheiro", "cheque", "debito_automatico", "outro"]).optional(),
  observacao: textoOpcional,
});

export async function registrarBaixa(empresaId: string, lancamentoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const dados = esquemaBaixa.safeParse({
      data_pagamento: texto(fd, "data_pagamento"),
      conta_financeira_id: texto(fd, "conta_financeira_id"),
      valor_principal: texto(fd, "valor_principal"),
      juros: texto(fd, "juros"),
      multa: texto(fd, "multa"),
      desconto: texto(fd, "desconto"),
      taxas: texto(fd, "taxas"),
      forma_pagamento: fd.get("forma_pagamento") || undefined,
      observacao: texto(fd, "observacao"),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const b = dados.data;
    const { error } = await ctx.supabase.from("baixas").insert({
      empresa_id: empresaId,
      lancamento_id: lancamentoId,
      data_pagamento: b.data_pagamento,
      conta_financeira_id: b.conta_financeira_id,
      valor_principal: Number(b.valor_principal),
      juros: Number(b.juros ?? 0),
      multa: Number(b.multa ?? 0),
      desconto: Number(b.desconto ?? 0),
      taxas: Number(b.taxas ?? 0),
      forma_pagamento: b.forma_pagamento ?? null,
      observacao: b.observacao ?? null,
    } as never);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`Pagamento registrado: principal de ${formatarMoeda(b.valor_principal)}.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function estornarBaixa(empresaId: string, baixaId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { data: b } = await ctx.supabase.from("baixas").select("conciliacao_id").eq("id", baixaId).eq("empresa_id", empresaId).maybeSingle();
    if (!b) return falha("Pagamento não encontrado.");
    if (b.conciliacao_id) return falha("Este pagamento foi criado por uma conciliação bancária. Desfaça a conciliação para estorná-lo.");
    const { error } = await ctx.supabase.from("baixas").delete().eq("id", baixaId).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Pagamento/recebimento estornado. O lançamento voltou a ficar em aberto.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ documentos vinculados
export async function vincularDocumento(empresaId: string, lancamentoId: string, documentoId: string, tipo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    if (!UUID.test(documentoId)) return falha("Selecione o documento.");
    const tipoVinculo = ["nota_fiscal", "comprovante", "boleto", "contrato", "outro"].includes(tipo) ? tipo : "comprovante";
    const { error } = await ctx.supabase.from("lancamento_documentos").insert({ lancamento_id: lancamentoId, documento_id: documentoId, empresa_id: empresaId, tipo_vinculo: tipoVinculo });
    if (error) return falha(error.code === "23505" ? "Este documento já está vinculado." : mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Documento vinculado.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function desvincularDocumento(empresaId: string, lancamentoId: string, documentoId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { error } = await ctx.supabase.from("lancamento_documentos").delete().eq("lancamento_id", lancamentoId).eq("documento_id", documentoId).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Vínculo removido.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ transferências e operações especiais
const esquemaTransferencia = z
  .object({
    conta_origem_id: z.string().regex(UUID, "Selecione a conta de origem."),
    conta_destino_id: z.string().regex(UUID, "Selecione a conta de destino."),
    data: dataObrigatoria(),
    valor: valorMonetario({ obrigatorio: true, positivo: true }),
    tipo: z.enum(["transferencia", "pagamento_fatura_cartao", "aplicacao", "resgate", "repasse_adquirente"]),
    descricao: textoOpcional,
  })
  .refine((d) => d.conta_origem_id !== d.conta_destino_id, { path: ["conta_destino_id"], message: "As contas devem ser diferentes." });

export async function salvarTransferencia(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const dados = esquemaTransferencia.safeParse({
      conta_origem_id: texto(fd, "conta_origem_id"),
      conta_destino_id: texto(fd, "conta_destino_id"),
      data: texto(fd, "data"),
      valor: texto(fd, "valor"),
      tipo: fd.get("tipo") || "transferencia",
      descricao: texto(fd, "descricao"),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const t = dados.data;
    const { error } = await ctx.supabase.from("transferencias").insert({ ...t, valor: Number(t.valor), descricao: t.descricao ?? null, empresa_id: empresaId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Transferência registrada. Ela movimenta as contas, mas não é receita nem despesa.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function excluirTransferencia(empresaId: string, id: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { data: t } = await ctx.supabase.from("transferencias").select("conciliacao_id").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
    if (t?.conciliacao_id) return falha("Transferência criada por conciliação. Desfaça a conciliação para removê-la.");
    const { error } = await ctx.supabase.from("transferencias").delete().eq("id", id).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Transferência excluída.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function registrarCompraCartao(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const valor = valorMonetario({ obrigatorio: true, positivo: true }).safeParse(texto(fd, "valor"));
    if (!valor.success || !valor.data) return falha("Valor inválido.", { valor: ["Informe o valor."] });
    const { error } = await ctx.supabase.rpc("registrar_compra_cartao", {
      p_empresa_id: empresaId,
      p_conta_cartao_id: texto(fd, "conta_cartao_id"),
      p_descricao: texto(fd, "descricao"),
      p_data_compra: texto(fd, "data_compra"),
      p_valor: Number(valor.data),
      p_categoria_id: texto(fd, "categoria_id"),
      p_contraparte_id: texto(fd, "contraparte_id") || undefined,
      p_centro_custo_id: texto(fd, "centro_custo_id") || undefined,
      p_parcelas: Number(texto(fd, "parcelas") || 1),
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Compra no cartão registrada. A despesa conta na data da compra; o pagamento da fatura será uma transferência.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function registrarVendaMaquininha(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const bruto = valorMonetario({ obrigatorio: true, positivo: true }).safeParse(texto(fd, "valor_bruto"));
    const taxa = valorMonetario({ positivo: true, permitirZero: true }).safeParse(texto(fd, "taxa"));
    if (!bruto.success || !bruto.data) return falha("Informe o valor bruto.", { valor_bruto: ["Informe o valor bruto."] });
    if (!taxa.success) return falha("Taxa inválida.", { taxa: ["Valor inválido."] });
    const { error } = await ctx.supabase.rpc("registrar_venda_maquininha", {
      p_empresa_id: empresaId,
      p_descricao: texto(fd, "descricao") || "Vendas em cartão",
      p_data_venda: texto(fd, "data_venda"),
      p_data_recebimento: texto(fd, "data_recebimento") || texto(fd, "data_venda"),
      p_valor_bruto: Number(bruto.data),
      p_taxa: Number(taxa.data ?? 0),
      p_conta_recebimento_id: texto(fd, "conta_recebimento_id"),
      p_categoria_receita_id: texto(fd, "categoria_id"),
      p_recebido: booleano(fd, "recebido"),
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Venda registrada: receita bruta, taxa como despesa financeira e valor líquido na conta.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function registrarParcelaEmprestimo(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const principal = valorMonetario({ obrigatorio: true, positivo: true }).safeParse(texto(fd, "valor_principal"));
    const juros = valorMonetario({ positivo: true, permitirZero: true }).safeParse(texto(fd, "valor_juros"));
    if (!principal.success || !principal.data) return falha("Informe a amortização do principal.", { valor_principal: ["Informe o valor."] });
    if (!juros.success) return falha("Juros inválidos.", { valor_juros: ["Valor inválido."] });
    const { error } = await ctx.supabase.rpc("registrar_parcela_emprestimo", {
      p_empresa_id: empresaId,
      p_descricao: texto(fd, "descricao") || "Parcela de empréstimo",
      p_data_vencimento: texto(fd, "data_vencimento"),
      p_valor_principal: Number(principal.data),
      p_valor_juros: Number(juros.data ?? 0),
      p_conta_id: texto(fd, "conta_id"),
      p_contraparte_id: texto(fd, "contraparte_id") || undefined,
      p_pago_em: texto(fd, "pago_em") || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Parcela registrada: amortização fora do resultado e juros como despesa financeira.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ recorrências
export async function alterarRecorrencia(empresaId: string, id: string, ativa: boolean): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { error } = await ctx.supabase.from("recorrencias").update({ ativa }).eq("id", id).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(ativa ? "Recorrência reativada." : "Recorrência pausada. Os lançamentos já gerados foram mantidos.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function gerarRecorrencias(empresaId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { data, error } = await ctx.supabase.rpc("gerar_recorrencias_empresa", { p_empresa_id: empresaId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(data ? `${data} lançamento(s) gerado(s).` : "Recorrências já estavam em dia.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function registrarEstoque(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const comp = texto(fd, "competencia");
    const valor = valorMonetario({ obrigatorio: true, positivo: true, permitirZero: true }).safeParse(texto(fd, "valor"));
    if (!/^\d{4}-\d{2}$/.test(comp)) return falha("Informe a competência.");
    if (!valor.success || valor.data == null) return falha("Valor inválido.", { valor: ["Informe o valor do estoque."] });
    const { error } = await ctx.supabase
      .from("estoques")
      .upsert({ empresa_id: empresaId, competencia: `${comp}-01`, valor_estoque_final: Number(valor.data), fonte: texto(fd, "fonte") || null, observacao: texto(fd, "observacao") || null }, { onConflict: "empresa_id,competencia" });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Estoque final registrado.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
