"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { hojeISO, lerCompetencia } from "@/lib/competencia";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { validarCnpj, validarCpf } from "@/lib/formatos";
import { FORMAS_PAGAMENTO } from "@/lib/recibos/comum";
import { exigirHonorarios } from "./acesso";
import { SERVICOS_HONORARIOS, TIPOS_CATEGORIA_ESCRITORIO } from "./comum";
import { TIPOS_MENSAGEM, type TipoMensagem } from "./mensagens";
import { TIPOS_CHAVE_PIX, normalizarChavePix, textoPix, type TipoChavePix } from "./pix";
import { reciboDaCobranca } from "./recibo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const BASE = "/escritorio/honorarios";
const texto = (fd: FormData, campo: string, max = 500) => String(fd.get(campo) ?? "").trim().slice(0, max);
const marcado = (fd: FormData, campo: string) => fd.get(campo) === "on" || fd.get(campo) === "true";
const inteiro = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);

function revalidar() {
  revalidatePath(BASE, "layout");
}

// -----------------------------------------------------------------------------
// Ficha de honorários
// -----------------------------------------------------------------------------
export async function salvarFicha(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirHonorarios();
  const id = texto(fd, "id");
  const empresaId = texto(fd, "empresa_id");
  const valor = lerValorBR(texto(fd, "valor_mensal", 30));
  const dia = inteiro(texto(fd, "dia_vencimento", 2));
  const inicio = lerCompetencia(texto(fd, "inicio", 10));
  const fimTexto = texto(fd, "fim", 10);
  const fim = fimTexto ? lerCompetencia(fimTexto) : null;
  const email = texto(fd, "contato_email", 200).toLowerCase();
  const zap = texto(fd, "contato_whatsapp", 30).replace(/\D/g, "");
  const funcInclusos = texto(fd, "funcionarios_inclusos", 6);
  const valorFunc = texto(fd, "valor_funcionario_extra", 20);
  const notasInclusas = texto(fd, "notas_inclusas", 7);
  const valorNota = texto(fd, "valor_nota_extra", 20);
  const erros: Record<string, string[]> = {};

  if (!id && !UUID.test(empresaId)) erros.empresa_id = ["Escolha a empresa."];
  if (!valor || !valor.greaterThan(0)) erros.valor_mensal = ["Informe o valor mensal."];
  else if (valor.greaterThanOrEqualTo(1_000_000)) erros.valor_mensal = ["Valor alto demais."];
  if (!dia || dia < 1 || dia > 28) erros.dia_vencimento = ["Escolha um dia de 1 a 28."];
  if (!inicio) erros.inicio = ["Informe o mês do início."];
  if (fimTexto && !fim) erros.fim = ["Mês inválido."];
  if (inicio && fim && fim < inicio) erros.fim = ["O fim vem depois do início."];
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.contato_email = ["E-mail inválido."];
  if (zap && !/^(55)?\d{10,11}$/.test(zap)) erros.contato_whatsapp = ["WhatsApp com DDD, ex.: (63) 99999-0000."];
  if ((funcInclusos === "") !== (valorFunc === "")) erros.valor_funcionario_extra = ["Preencha o limite e o valor por funcionário a mais (ou deixe os dois em branco)."];
  if ((notasInclusas === "") !== (valorNota === "")) erros.valor_nota_extra = ["Preencha o limite e o valor por nota a mais (ou deixe os dois em branco)."];
  const vFunc = valorFunc ? lerValorBR(valorFunc) : null;
  const vNota = valorNota ? lerValorBR(valorNota) : null;
  if (valorFunc && (!vFunc || vFunc.lessThan(0))) erros.valor_funcionario_extra = ["Valor inválido."];
  if (valorNota && (!vNota || vNota.lessThan(0))) erros.valor_nota_extra = ["Valor inválido."];
  const servicos = fd.getAll("servicos").map(String).filter((x) => x in SERVICOS_HONORARIOS);
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const dados = {
    empresa_id: empresaId || null,
    situacao: texto(fd, "situacao", 20) || "ativa",
    valor_mensal: valor!.toFixed(2),
    dia_vencimento: dia,
    inicio,
    fim,
    servicos,
    funcionarios_inclusos: funcInclusos || null,
    valor_funcionario_extra: vFunc ? vFunc.toFixed(2) : null,
    notas_inclusas: notasInclusas || null,
    valor_nota_extra: vNota ? vNota.toFixed(2) : null,
    decimo_terceiro: marcado(fd, "decimo_terceiro"),
    decimo_terceiro_mes: inteiro(texto(fd, "decimo_terceiro_mes", 2)) ?? 12,
    reajuste_indice: texto(fd, "reajuste_indice", 10) || "nenhum",
    reajuste_mes: inteiro(texto(fd, "reajuste_mes", 2)),
    contato_nome: texto(fd, "contato_nome", 120) || null,
    contato_email: email || null,
    contato_whatsapp: zap || null,
    whatsapp_autorizado: marcado(fd, "whatsapp_autorizado"),
    canal_email: marcado(fd, "canal_email"),
    canal_whatsapp: marcado(fd, "canal_whatsapp"),
    robo_pausado_ate: DATA.test(texto(fd, "robo_pausado_ate", 10)) ? texto(fd, "robo_pausado_ate", 10) : null,
    observacao: texto(fd, "observacao", 1000) || null,
  };
  const { data: salvo, error } = await s.supabase.rpc("honorarios_ficha_salvar", { p_id: (id || null) as string, p_dados: dados });
  if (error || !salvo) return falha(mensagemErro(error));
  revalidar();
  redirect(`${BASE}/fichas?salvo=${salvo}`);
}

// -----------------------------------------------------------------------------
// Cobranças
// -----------------------------------------------------------------------------
export async function gerarCobrancasDoMes(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirHonorarios();
  const competencia = lerCompetencia(texto(fd, "competencia", 10));
  if (!competencia) return falha("Escolha o mês de referência.", { competencia: ["Escolha o mês."] });
  const { data, error } = await s.supabase.rpc("honorarios_gerar", { p_competencia: competencia });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return data
    ? sucesso(`${data} cobrança(s) gerada(s) para você conferir antes de enviar.`)
    : sucesso("Nenhuma cobrança nova: as fichas ativas já têm a cobrança deste mês, começam depois dele ou não há fichas ativas.");
}

interface ItemForm {
  descricao: string;
  categoria_id: string;
  quantidade: string;
  valor_unitario: string;
}

function lerItens(fd: FormData): { itens: { descricao: string; categoria_id: string; quantidade: string; valor_unitario: string }[] } | { erro: string } {
  let brutos: ItemForm[];
  try {
    brutos = JSON.parse(String(fd.get("itens") ?? "[]")) as ItemForm[];
  } catch {
    return { erro: "Itens inválidos." };
  }
  if (!Array.isArray(brutos) || !brutos.length) return { erro: "Inclua pelo menos um item." };
  const itens = [];
  for (const b of brutos.slice(0, 30)) {
    const descricao = String(b.descricao ?? "").trim().slice(0, 200);
    const valor = lerValorBR(String(b.valor_unitario ?? ""));
    const qtd = Number(String(b.quantidade ?? "1").replace(",", "."));
    if (descricao.length < 2) return { erro: "Escreva a descrição de cada item." };
    if (!UUID.test(String(b.categoria_id ?? ""))) return { erro: "Escolha a linha da DRE de cada item." };
    if (!valor || !valor.greaterThan(0)) return { erro: "Informe o valor de cada item." };
    if (!Number.isFinite(qtd) || qtd <= 0) return { erro: "Quantidade inválida." };
    itens.push({ descricao, categoria_id: b.categoria_id, quantidade: String(qtd), valor_unitario: valor.toFixed(2) });
  }
  return { itens };
}

/** Cobrança avulsa (nova) ou edição de rascunho/aberta. */
export async function salvarCobranca(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirHonorarios();
  const id = texto(fd, "id");
  const modo = texto(fd, "modo") === "avulso" ? "avulso" : "carteira";
  const empresaId = texto(fd, "empresa_id");
  const nome = texto(fd, "pagador_nome", 200);
  const documento = texto(fd, "pagador_documento", 30).replace(/\D/g, "");
  const vencimento = texto(fd, "vencimento", 10);
  const descricao = texto(fd, "descricao", 200);
  const email = texto(fd, "contato_email", 200).toLowerCase();
  const zap = texto(fd, "contato_whatsapp", 30).replace(/\D/g, "");
  const erros: Record<string, string[]> = {};
  if (!id && modo === "carteira" && !UUID.test(empresaId)) erros.empresa_id = ["Escolha a empresa."];
  if (!id && modo === "avulso") {
    if (nome.length < 2) erros.pagador_nome = ["Informe para quem é a cobrança."];
    if (documento && !(documento.length === 11 ? validarCpf(documento) : documento.length === 14 && validarCnpj(documento))) erros.pagador_documento = ["CPF ou CNPJ inválido."];
  }
  if (!DATA.test(vencimento)) erros.vencimento = ["Informe o vencimento."];
  if (descricao.length < 3) erros.descricao = ["Escreva o que está sendo cobrado."];
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.contato_email = ["E-mail inválido."];
  if (zap && !/^(55)?\d{10,11}$/.test(zap)) erros.contato_whatsapp = ["WhatsApp com DDD."];
  const lidos = lerItens(fd);
  if ("erro" in lidos) erros.itens = [lidos.erro];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const dados: Record<string, unknown> = {
    descricao,
    vencimento,
    itens: "itens" in lidos ? lidos.itens : [],
    contato_email: email || null,
    contato_whatsapp: zap || null,
    whatsapp_autorizado: marcado(fd, "whatsapp_autorizado"),
  };
  if (!id) {
    dados.empresa_id = modo === "carteira" ? empresaId : null;
    dados.pagador_nome = modo === "avulso" ? nome : null;
    dados.pagador_documento = modo === "avulso" ? documento || null : null;
    dados.competencia = lerCompetencia(texto(fd, "competencia", 10));
  }
  const { data: salvo, error } = await s.supabase.rpc("honorarios_cobranca_salvar", { p_id: (id || null) as string, p_dados: dados as never });
  if (error || !salvo) return falha(mensagemErro(error));
  if (!id && marcado(fd, "aprovar")) {
    const { error: e2 } = await s.supabase.rpc("honorarios_cobrancas_aprovar", { p_ids: [salvo] });
    if (e2) return falha(`A cobrança foi criada, mas não foi enviada: ${mensagemErro(e2)}`);
  }
  revalidar();
  redirect(`${BASE}/cobrancas/${salvo}?salvo=1`);
}

export async function aprovarCobrancas(ids: string[]): Promise<ResultadoAcao> {
  const validos = ids.filter((i) => UUID.test(i)).slice(0, 500);
  if (!validos.length) return falha("Escolha as cobranças.");
  const s = await exigirHonorarios();
  const { data, error } = await s.supabase.rpc("honorarios_cobrancas_aprovar", { p_ids: validos });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso(`${data ?? 0} cobrança(s) enviada(s) aos clientes.`);
}

export async function reenviarCobranca(id: string): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Cobrança inválida.");
  const s = await exigirHonorarios();
  const { data, error } = await s.supabase.rpc("honorarios_cobranca_reenviar", { p_id: id });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return data ? sucesso(`Reenvio agendado (${data} canal/canais).`) : falha("O cliente não tem e-mail nem WhatsApp autorizado cadastrado (ou os canais estão desligados).");
}

export async function alternarRoboCobranca(id: string, ativo: boolean): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Cobrança inválida.");
  const s = await exigirHonorarios();
  const { data: c } = await s.supabase.from("honorarios_cobrancas").select("vencimento").eq("id", id).single();
  if (!c) return falha("Cobrança não encontrada.");
  const { error } = await s.supabase.rpc("honorarios_cobranca_salvar", { p_id: id, p_dados: { vencimento: c.vencimento, robo_ativo: ativo } });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso(ativo ? "Lembretes automáticos ligados para esta cobrança." : "Lembretes automáticos pausados para esta cobrança.");
}

export async function cancelarCobranca(id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Cobrança inválida.");
  const s = await exigirHonorarios();
  const motivo = texto(fd, "motivo", 300);
  if (motivo.length < 5) return falha("Informe o motivo.", { motivo: ["Informe o motivo (pelo menos 5 letras)."] });
  const { error } = await s.supabase.rpc("honorarios_cobranca_cancelar", { p_id: id, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Cobrança cancelada. Os lembretes que estavam na fila não saem mais.");
}

/** Baixa: pagamento recebido. Gera os lançamentos da DRE e, se ligado, o recibo assinado e publicado. */
export async function baixarCobranca(id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Cobrança inválida.");
  const s = await exigirHonorarios();
  const pagoEm = texto(fd, "pago_em", 10);
  const valor = lerValorBR(texto(fd, "valor_pago", 30));
  const descontoTexto = texto(fd, "desconto", 30);
  const desconto = descontoTexto ? lerValorBR(descontoTexto) : null;
  const forma = texto(fd, "forma_pagamento", 20) || "pix";
  const erros: Record<string, string[]> = {};
  if (!DATA.test(pagoEm)) erros.pago_em = ["Informe a data do pagamento."];
  else if (pagoEm > hojeISO()) erros.pago_em = ["A data não pode ser no futuro."];
  if (!valor || !valor.greaterThan(0)) erros.valor_pago = ["Informe o valor recebido."];
  if (descontoTexto && (!desconto || desconto.lessThan(0))) erros.desconto = ["Desconto inválido."];
  if (!(forma in FORMAS_PAGAMENTO)) erros.forma_pagamento = ["Forma de pagamento inválida."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const { data: r, error } = await s.supabase.rpc("honorarios_cobranca_baixar", {
    p_id: id,
    p_dados: { pago_em: pagoEm, valor_pago: valor!.toFixed(2), desconto: desconto ? desconto.toFixed(2) : "0", forma_pagamento: forma, observacao: texto(fd, "observacao", 300) || null },
  });
  if (error) return falha(mensagemErro(error));
  const partes = r as { multa: number; juros: number; desconto: number } | null;

  const { data: cfg } = await s.supabase.from("honorarios_config").select("recibo_automatico, recibo_publicar").single();
  let avisoRecibo = "";
  if (cfg?.recibo_automatico) {
    const rec = await reciboDaCobranca(s.supabase, id, { publicar: cfg.recibo_publicar });
    avisoRecibo = rec.reciboId ? " Recibo emitido" + (cfg.recibo_publicar ? " e publicado ao cliente." : ".") : "";
    if (rec.avisos.length) avisoRecibo += ` Atenção: ${rec.avisos.join("; ")}.`;
  }
  revalidar();
  const encargos = Number(partes?.multa ?? 0) + Number(partes?.juros ?? 0);
  return sucesso(
    `Pagamento registrado${encargos > 0 ? ` (com ${formatarMoeda(encargos)} de multa e juros, lançados à parte na DRE)` : ""}.${avisoRecibo}`,
  );
}

/** Desfaz a baixa lançada por engano: tira os lançamentos e cancela o recibo emitido por ela. */
export async function estornarCobranca(id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Cobrança inválida.");
  const s = await exigirHonorarios();
  const motivo = texto(fd, "motivo", 300);
  if (motivo.length < 5) return falha("Informe o motivo.", { motivo: ["Informe o motivo (pelo menos 5 letras)."] });
  const { data: reciboId, error } = await s.supabase.rpc("honorarios_cobranca_estornar", { p_id: id, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  let aviso = "";
  if (reciboId) {
    const { data: documentoId, error: e1 } = await s.supabase.rpc("recibo_cancelar", { p_recibo_id: reciboId, p_motivo: `Pagamento desfeito: ${motivo}`.slice(0, 300) });
    if (e1) aviso = ` Atenção: cancele o recibo em Recibos de honorários (${mensagemErro(e1)}).`;
    else if (documentoId) {
      const { error: e2 } = await s.supabase.rpc("excluir_documento", { p_documento_id: documentoId, p_motivo: `Recibo cancelado: ${motivo}`.slice(0, 300) });
      if (e2) aviso = ` Atenção: o PDF do recibo continua nos documentos da empresa (${mensagemErro(e2)}).`;
    }
  }
  revalidar();
  return sucesso(`Pagamento desfeito: a cobrança voltou a ficar em aberto.${reciboId && !aviso ? " O recibo foi cancelado." : ""}${aviso}`);
}

// -----------------------------------------------------------------------------
// Lançamentos do escritório (DRE)
// -----------------------------------------------------------------------------
export async function salvarLancamento(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirHonorarios();
  const id = texto(fd, "id");
  const natureza = texto(fd, "natureza") === "receita" ? "receita" : "despesa";
  const data = texto(fd, "data", 10);
  const descricao = texto(fd, "descricao", 300);
  const valor = lerValorBR(texto(fd, "valor", 30));
  const categoria = texto(fd, "categoria_id");
  const competencia = lerCompetencia(texto(fd, "competencia", 10));
  const erros: Record<string, string[]> = {};
  if (!DATA.test(data)) erros.data = ["Informe a data."];
  if (descricao.length < 3) erros.descricao = ["Escreva a descrição (ela aparece na DRE)."];
  if (!id && (!valor || !valor.greaterThan(0))) erros.valor = ["Informe o valor."];
  if (categoria && !UUID.test(categoria)) erros.categoria_id = ["Linha inválida."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await s.supabase.rpc("escritorio_lancamento_salvar", {
    p_id: (id || null) as string,
    p_dados: {
      natureza,
      data,
      competencia,
      descricao,
      valor: valor ? valor.toFixed(2) : null,
      categoria_id: categoria || null,
      empresa_id: UUID.test(texto(fd, "empresa_id")) ? texto(fd, "empresa_id") : null,
      forma_pagamento: texto(fd, "forma_pagamento", 20) || null,
      observacao: texto(fd, "observacao", 500) || null,
    },
  });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso(categoria ? "Lançamento salvo na DRE." : "Lançamento salvo em “A classificar”: escolha a linha da DRE para ele entrar no resultado.");
}

export async function excluirLancamento(id: string): Promise<ResultadoAcao> {
  if (!UUID.test(id)) return falha("Lançamento inválido.");
  const s = await exigirHonorarios();
  const { error } = await s.supabase.rpc("escritorio_lancamento_excluir", { p_id: id });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Lançamento excluído.");
}

export async function salvarCategoria(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirHonorarios();
  const id = texto(fd, "id");
  const nome = texto(fd, "nome", 120);
  const codigo = texto(fd, "codigo", 12);
  const tipo = texto(fd, "tipo", 30);
  const erros: Record<string, string[]> = {};
  if (nome.length < 2) erros.nome = ["Informe o nome da linha."];
  if (!id && !/^\d{1,2}(\.\d{1,3}){0,2}$/.test(codigo)) erros.codigo = ["Código como 4.09."];
  if (!id && !(tipo in TIPOS_CATEGORIA_ESCRITORIO)) erros.tipo = ["Escolha o grupo da DRE."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await s.supabase.rpc("escritorio_categoria_salvar", {
    p_id: (id || null) as string,
    p_dados: { nome, codigo, tipo, ativa: fd.has("ativa") ? marcado(fd, "ativa") : true },
  });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Linha da DRE salva.");
}

// -----------------------------------------------------------------------------
// Configuração
// -----------------------------------------------------------------------------
export async function salvarConfiguracaoHonorarios(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirHonorarios();
  const parte = texto(fd, "parte", 20);
  const erros: Record<string, string[]> = {};
  const dados: Record<string, unknown> = {};

  if (parte === "pix") {
    const tipo = texto(fd, "pix_tipo", 20) as TipoChavePix;
    const chaveTexto = texto(fd, "pix_chave", 100);
    if (chaveTexto) {
      if (!(tipo in TIPOS_CHAVE_PIX)) erros.pix_tipo = ["Escolha o tipo da chave."];
      const chave = tipo in TIPOS_CHAVE_PIX ? normalizarChavePix(tipo, chaveTexto) : null;
      if (!chave) erros.pix_chave = ["Chave inválida para o tipo escolhido."];
      const nome = textoPix(texto(fd, "pix_nome", 60), 25);
      const cidade = textoPix(texto(fd, "pix_cidade", 40), 15);
      if (!nome) erros.pix_nome = ["Informe o nome de quem recebe (como no banco)."];
      if (!cidade) erros.pix_cidade = ["Informe a cidade."];
      Object.assign(dados, { pix_tipo: tipo, pix_chave: chave, pix_nome: nome, pix_cidade: cidade });
    } else {
      Object.assign(dados, { pix_tipo: null, pix_chave: null, pix_nome: null, pix_cidade: null });
    }
  } else if (parte === "geracao") {
    const dia = inteiro(texto(fd, "dia_geracao", 2));
    if (!dia || dia < 1 || dia > 28) erros.dia_geracao = ["Escolha um dia de 1 a 28."];
    const multa = Number(texto(fd, "multa_percentual", 6).replace(",", "."));
    const juros = Number(texto(fd, "juros_mes_percentual", 6).replace(",", "."));
    if (!Number.isFinite(multa) || multa < 0 || multa > 20) erros.multa_percentual = ["De 0 a 20%."];
    if (!Number.isFinite(juros) || juros < 0 || juros > 10) erros.juros_mes_percentual = ["De 0 a 10% ao mês."];
    Object.assign(dados, {
      geracao_automatica: marcado(fd, "geracao_automatica"),
      dia_geracao: dia,
      aprovacao_automatica: marcado(fd, "aprovacao_automatica"),
      competencia_referencia: texto(fd, "competencia_referencia") === "mes_atual" ? "mes_atual" : "mes_anterior",
      cobrar_encargos: marcado(fd, "cobrar_encargos"),
      multa_percentual: multa,
      juros_mes_percentual: juros,
      recibo_automatico: marcado(fd, "recibo_automatico"),
      recibo_publicar: marcado(fd, "recibo_publicar"),
    });
  } else if (parte === "robo") {
    const regua = texto(fd, "regua", 200)
      .split(/[;,\s]+/)
      .filter(Boolean)
      .map((x) => Number(x.replace("+", "")));
    if (regua.some((d) => !Number.isInteger(d) || d < -60 || d > 180)) erros.regua = ["Use números inteiros de -60 a 180, separados por vírgula (ex.: -5, 0, 3, 10, 30)."];
    if (regua.length > 12) erros.regua = ["No máximo 12 lembretes."];
    const modelo = texto(fd, "whatsapp_template", 512);
    if (modelo && !/^[a-z0-9_]+$/.test(modelo)) erros.whatsapp_template = ["O nome do modelo do WhatsApp usa letras minúsculas, números e _."];
    Object.assign(dados, {
      robo_ativo: marcado(fd, "robo_ativo"),
      regua,
      email_ativo: marcado(fd, "email_ativo"),
      whatsapp_ativo: marcado(fd, "whatsapp_ativo"),
      whatsapp_template: modelo || null,
    });
  } else if (parte === "mensagens") {
    const mensagens: Record<string, { assunto: string; texto: string }> = {};
    for (const tipo of Object.keys(TIPOS_MENSAGEM) as TipoMensagem[]) {
      const assunto = texto(fd, `${tipo}_assunto`, 200);
      const corpo = texto(fd, `${tipo}_texto`, 2000);
      if (assunto || corpo) mensagens[tipo] = { assunto, texto: corpo };
    }
    dados.mensagens = mensagens;
  } else {
    return falha("Parte da configuração inválida.");
  }
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await s.supabase.rpc("honorarios_config_salvar", { p_dados: dados as never });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Configuração salva.");
}

/** Administrador: quem da equipe mexe no financeiro do escritório. */
export async function definirAcessoHonorarios(userId: string, ativo: boolean): Promise<ResultadoAcao> {
  if (!UUID.test(userId)) return falha("Pessoa inválida.");
  const s = await exigirAdmin();
  const { error } = await s.supabase.rpc("honorarios_acesso_definir", { p_user_id: userId, p_ativo: ativo });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso(ativo ? "Acesso ao financeiro do escritório liberado." : "Acesso ao financeiro do escritório retirado.");
}
