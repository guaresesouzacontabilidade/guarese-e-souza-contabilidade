"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import { validarCpf } from "@/lib/formatos";
import type { Json } from "@/lib/supabase/database.types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

/** Valor digitado no padrão brasileiro ("1.234,5") → texto com ponto, ou null. */
function valor(v: string): string | null {
  if (!v) return null;
  const d = lerValorBR(v);
  return d ? d.toString() : null;
}

function revalidarHotel(empresaId: string) {
  revalidatePath(`/e/${empresaId}/hotel`, "layout");
}

/** Contexto com a permissão do hotel (o banco confere de novo a permissão e a modalidade). */
async function contexto(empresaId: string, gerente = false) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.loja || ctx.acesso.gestao_modalidade !== "hotel") throw new Error("A gestão do hotel não está ligada para esta empresa.");
  if (!ctx.pode(gerente ? "gestao.gerenciar" : "gestao.vender")) {
    throw new Error(gerente ? "Só o gerente do hotel pode fazer isto." : "Você não tem acesso à recepção do hotel.");
  }
  return ctx;
}

async function executar<T>(fn: () => Promise<ResultadoAcao<T>>): Promise<ResultadoAcao<T>> {
  try {
    return await fn();
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível concluir a operação.");
  }
}

// -----------------------------------------------------------------------------
// Configurações e cadastros do gerente
// -----------------------------------------------------------------------------
export async function salvarConfiguracaoHotel(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const taxa = texto(fd, "taxa_servico");
    const { error } = await ctx.supabase.rpc("hotel_configurar", {
      p_empresa_id: empresaId,
      p_dados: {
        hora_checkin: texto(fd, "hora_checkin"),
        hora_checkout: texto(fd, "hora_checkout"),
        taxa_servico: taxa ? (valor(taxa) ?? "x") : "",
        cafe_incluso: fd.get("cafe_incluso") === "on",
        politica: texto(fd, "politica").slice(0, 2000),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Configurações do hotel salvas.");
  });
}

export async function salvarCategoria(empresaId: string, categoriaId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (categoriaId && !UUID.test(categoriaId)) return falha("Categoria inválida.");
    const ctx = await contexto(empresaId, true);
    const erros: Record<string, string[]> = {};
    const nome = texto(fd, "nome");
    if (nome.length < 2 || nome.length > 60) erros.nome = ["Dê um nome (2 a 60 letras), ex.: Standard casal."];
    const diaria = valor(texto(fd, "diaria"));
    if (!diaria || Number(diaria) <= 0) erros.diaria = ["Informe a diária."];
    const capacidade = Number(texto(fd, "capacidade") || "2");
    const incluidas = Number(texto(fd, "pessoas_incluidas") || "2");
    if (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 20) erros.capacidade = ["De 1 a 20 pessoas."];
    if (!Number.isInteger(incluidas) || incluidas < 1 || incluidas > capacidade) erros.pessoas_incluidas = ["De 1 até a capacidade do quarto."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("hotel_categoria_salvar", {
      p_empresa_id: empresaId,
      p_id: categoriaId as string,
      p_dados: {
        nome,
        descricao: texto(fd, "descricao").slice(0, 500),
        capacidade,
        pessoas_incluidas: incluidas,
        diaria,
        adicional_pessoa: valor(texto(fd, "adicional_pessoa")) ?? "0",
        ativa: !fd.has("ativa_presente") || fd.get("ativa") === "on",
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso(categoriaId ? "Categoria atualizada." : "Categoria criada.");
  });
}

export async function salvarQuarto(empresaId: string, quartoId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (quartoId && !UUID.test(quartoId)) return falha("Quarto inválido.");
    const ctx = await contexto(empresaId, true);
    const numero = texto(fd, "numero").toUpperCase();
    const categoria = texto(fd, "categoria_id");
    const erros: Record<string, string[]> = {};
    if (!/^[0-9A-Z][0-9A-Z -]{0,9}$/.test(numero)) erros.numero = ["Número com até 10 letras ou números (ex.: 101, 2A)."];
    if (!UUID.test(categoria)) erros.categoria_id = ["Escolha a categoria."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("hotel_quarto_salvar", {
      p_empresa_id: empresaId,
      p_id: quartoId as string,
      p_dados: {
        numero,
        categoria_id: categoria,
        andar: texto(fd, "andar").slice(0, 20),
        camas: texto(fd, "camas").slice(0, 120),
        observacao: texto(fd, "observacao").slice(0, 500),
        ativo: !fd.has("ativo_presente") || fd.get("ativo") === "on",
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso(quartoId ? `Quarto ${numero} atualizado.` : `Quarto ${numero} cadastrado.`);
  });
}

/** Vários quartos de uma vez: faixa de números (ex.: 101 a 120), pulando os que não existem no hotel. */
export async function cadastrarQuartosEmLote(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const inicio = texto(fd, "inicio");
    const fim = texto(fd, "fim");
    const categoria = texto(fd, "categoria_id");
    const erros: Record<string, string[]> = {};
    if (!/^\d{1,5}$/.test(inicio)) erros.inicio = ["Só algarismos (ex.: 101)."];
    if (!/^\d{1,5}$/.test(fim)) erros.fim = ["Só algarismos (ex.: 120)."];
    else if (!erros.inicio && Number(fim) < Number(inicio)) erros.fim = ["Precisa ser maior ou igual ao primeiro."];
    else if (!erros.inicio && Number(fim) - Number(inicio) + 1 > 200) erros.fim = ["No máximo 200 quartos de cada vez."];
    if (!UUID.test(categoria)) erros.categoria_id = ["Escolha a categoria."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { data, error } = await ctx.supabase.rpc("hotel_quartos_lote", {
      p_empresa_id: empresaId,
      p_dados: { categoria_id: categoria, inicio, fim, pular: texto(fd, "pular").slice(0, 500), andar: texto(fd, "andar").slice(0, 20), camas: texto(fd, "camas").slice(0, 120) },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    const r = (data ?? {}) as { criados?: string[]; existentes?: string[] };
    const criados = r.criados ?? [];
    const existentes = r.existentes ?? [];
    const ja = existentes.length ? ` Já existiam e ficaram como estavam: ${existentes.join(", ")}.` : "";
    if (!criados.length) return falha(`Nenhum quarto novo.${ja}`);
    return sucesso(`${criados.length} ${criados.length === 1 ? "quarto cadastrado" : "quartos cadastrados"} (${criados[0]} a ${criados[criados.length - 1]}).${ja}`);
  });
}

export async function salvarTarifa(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const erros: Record<string, string[]> = {};
    const nome = texto(fd, "nome");
    const inicio = texto(fd, "inicio");
    const fim = texto(fd, "fim");
    const diaria = valor(texto(fd, "diaria"));
    if (nome.length < 2) erros.nome = ["Dê um nome, ex.: Temporada de praia, Réveillon."];
    if (!UUID.test(texto(fd, "categoria_id"))) erros.categoria_id = ["Escolha a categoria."];
    if (!DATA.test(inicio)) erros.inicio = ["Informe o início."];
    if (!DATA.test(fim)) erros.fim = ["Informe o fim."];
    else if (DATA.test(inicio) && fim < inicio) erros.fim = ["O fim não pode ser antes do início."];
    if (!diaria || Number(diaria) <= 0) erros.diaria = ["Informe a diária do período."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("hotel_tarifa_salvar", {
      p_empresa_id: empresaId,
      p_dados: { categoria_id: texto(fd, "categoria_id"), nome: nome.slice(0, 60), inicio, fim, diaria },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Tarifa do período criada.");
  });
}

export async function excluirTarifa(empresaId: string, tarifaId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(tarifaId)) return falha("Tarifa inválida.");
    const ctx = await contexto(empresaId, true);
    const { error } = await ctx.supabase.rpc("hotel_tarifa_excluir", { p_tarifa_id: tarifaId });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Tarifa excluída.");
  });
}

/** Governança: limpo, sujo, em limpeza (manutenção pede o motivo). */
export async function mudarLimpeza(empresaId: string, quartoId: string, limpeza: string, motivo?: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(quartoId) || !["limpo", "sujo", "em_limpeza", "manutencao"].includes(limpeza)) return falha("Situação inválida.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("hotel_quarto_limpeza", { p_quarto_id: quartoId, p_limpeza: limpeza, p_motivo: (motivo ?? "").slice(0, 300) });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso();
  });
}

export async function colocarEmManutencao(empresaId: string, quartoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const motivo = texto(fd, "motivo");
  if (motivo.length < 3) return falha("Explique o que está em manutenção.", { motivo: ["Ex.: ar-condicionado, chuveiro, pintura."] });
  const r = await mudarLimpeza(empresaId, quartoId, "manutencao", motivo);
  return r.ok ? sucesso("Quarto em manutenção (bloqueado para check-in).") : r;
}

// -----------------------------------------------------------------------------
// Hóspedes
// -----------------------------------------------------------------------------
function dadosHospede(fd: FormData, prefixo = "") {
  const t = (n: string) => texto(fd, `${prefixo}${n}`);
  return {
    nome: t("nome"),
    cpf: t("cpf"),
    documento_tipo: t("documento_tipo"),
    documento: t("documento"),
    nascimento: t("nascimento"),
    genero: t("genero"),
    nacionalidade: t("nacionalidade"),
    profissao: t("profissao"),
    telefone: t("telefone"),
    email: t("email"),
    cep: t("cep"),
    endereco: t("endereco"),
    cidade: t("cidade"),
    uf: t("uf"),
    pais: t("pais"),
    observacoes: t("observacoes"),
  };
}

function conferirHospede(d: ReturnType<typeof dadosHospede>, prefixo = "") {
  const erros: Record<string, string[]> = {};
  if (d.nome.length < 2 || d.nome.length > 120) erros[`${prefixo}nome`] = ["Informe o nome completo."];
  if (d.cpf && !validarCpf(d.cpf)) erros[`${prefixo}cpf`] = ["CPF inválido. Confira os números."];
  if (d.nascimento && !DATA.test(d.nascimento)) erros[`${prefixo}nascimento`] = ["Data inválida."];
  const tel = d.telefone.replace(/\D/g, "");
  if (tel && (tel.length < 10 || tel.length > 13)) erros[`${prefixo}telefone`] = ["Telefone com DDD."];
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) erros[`${prefixo}email`] = ["E-mail inválido."];
  if (d.uf && !/^[A-Za-z]{2}$/.test(d.uf)) erros[`${prefixo}uf`] = ["UF com 2 letras."];
  const cep = d.cep.replace(/\D/g, "");
  if (cep && cep.length !== 8) erros[`${prefixo}cep`] = ["CEP com 8 números."];
  return erros;
}

export async function salvarHospede(empresaId: string, hospedeId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (hospedeId && !UUID.test(hospedeId)) return falha("Hóspede inválido.");
    const ctx = await contexto(empresaId);
    const dados = dadosHospede(fd);
    const erros = conferirHospede(dados);
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { data, error } = await ctx.supabase.rpc("hotel_hospede_salvar", { p_empresa_id: empresaId, p_id: hospedeId as string, p_dados: dados });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso(hospedeId ? "Cadastro do hóspede atualizado." : "Hóspede cadastrado.", { id: data as string });
  });
}

export async function excluirHospede(empresaId: string, hospedeId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(hospedeId)) return falha("Hóspede inválido.");
    const ctx = await contexto(empresaId, true);
    const { error } = await ctx.supabase.rpc("hotel_hospede_excluir", { p_hospede_id: hospedeId });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Cadastro excluído.");
  });
}

// -----------------------------------------------------------------------------
// Reservas, check-in e check-out
// -----------------------------------------------------------------------------
export async function salvarReserva(empresaId: string, reservaId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (reservaId && !UUID.test(reservaId)) return falha("Reserva inválida.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    const entrada = texto(fd, "entrada");
    const saida = texto(fd, "saida");
    if (!DATA.test(entrada)) erros.entrada = ["Informe a entrada."];
    if (!DATA.test(saida)) erros.saida = ["Informe a saída."];
    else if (DATA.test(entrada) && saida <= entrada) erros.saida = ["A saída precisa ser depois da entrada (pelo menos uma noite)."];
    if (!UUID.test(texto(fd, "quarto_id"))) erros.quarto_id = ["Escolha o quarto."];
    const adultos = Number(texto(fd, "adultos") || "1");
    const criancas = Number(texto(fd, "criancas") || "0");
    if (!Number.isInteger(adultos) || adultos < 1) erros.adultos = ["Pelo menos 1 adulto."];
    if (!Number.isInteger(criancas) || criancas < 0) erros.criancas = ["Número inválido."];
    const acordada = texto(fd, "diaria_acordada");
    const diaria = acordada ? valor(acordada) : null;
    if (acordada && (!diaria || Number(diaria) <= 0)) erros.diaria_acordada = ["Diária inválida."];
    const placa = texto(fd, "placa_veiculo").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (placa && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) erros.placa_veiculo = ["Placa no formato ABC1D23 ou ABC1234."];

    // Hóspede: escolhido da lista ou cadastrado aqui mesmo
    let hospede = texto(fd, "hospede_id");
    const novo = dadosHospede(fd, "novo_");
    if (!UUID.test(hospede)) {
      if (!novo.nome) erros.hospede_id = ["Escolha o hóspede ou preencha o nome para cadastrar."];
      else Object.assign(erros, conferirHospede(novo, "novo_"));
    }
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

    if (!UUID.test(hospede)) {
      const { data, error } = await ctx.supabase.rpc("hotel_hospede_salvar", { p_empresa_id: empresaId, p_id: null as unknown as string, p_dados: novo });
      if (error) return falha(mensagemErro(error));
      hospede = data as string;
    }
    const acompanhantes = fd.getAll("acompanhantes").map(String).filter((x) => UUID.test(x) && x !== hospede);
    const dados: Record<string, unknown> = {
      hospede_id: hospede,
      quarto_id: texto(fd, "quarto_id"),
      entrada,
      saida,
      adultos,
      criancas,
      status: texto(fd, "status") || "confirmada",
      origem: texto(fd, "origem") || "balcao",
      diaria_acordada: diaria ?? "",
      empresa_faturar_id: texto(fd, "empresa_faturar_id"),
      observacoes: texto(fd, "observacoes").slice(0, 1000),
      motivo_viagem: texto(fd, "motivo_viagem"),
      meio_transporte: texto(fd, "meio_transporte"),
      placa_veiculo: placa,
      procedencia: texto(fd, "procedencia").slice(0, 120),
      destino: texto(fd, "destino").slice(0, 120),
    };
    if (fd.has("acompanhantes_presente")) dados.acompanhantes = acompanhantes;
    const { data, error } = await ctx.supabase.rpc("hotel_reserva_salvar", { p_empresa_id: empresaId, p_id: reservaId as string, p_dados: dados as Json });
    if (error) return falha(mensagemErro(error));
    const r = data as { id: string; numero: number };
    let mensagem = reservaId ? `Reserva nº ${r.numero} atualizada.` : `Reserva nº ${r.numero} criada.`;
    if (!reservaId && fd.get("checkin_agora") === "on") {
      const { error: e2 } = await ctx.supabase.rpc("hotel_checkin", { p_reserva_id: r.id, p_dados: {} });
      if (e2) mensagem += ` O check-in não foi feito: ${mensagemErro(e2)}`;
      else mensagem = `Reserva nº ${r.numero} criada e check-in feito.`;
    }
    revalidarHotel(empresaId);
    return sucesso(mensagem, { id: r.id });
  });
}

export async function cancelarReserva(empresaId: string, reservaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Reserva inválida.");
    const ctx = await contexto(empresaId);
    const motivo = texto(fd, "motivo");
    if (motivo.length < 3) return falha("Explique o motivo.", { motivo: ["Ex.: cliente desistiu, mudou a data."] });
    const noShow = texto(fd, "tipo") === "no_show";
    const { error } = await ctx.supabase.rpc("hotel_reserva_cancelar", { p_reserva_id: reservaId, p_motivo: motivo, p_no_show: noShow });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso(noShow ? "Reserva marcada como não comparecimento." : "Reserva cancelada.");
  });
}

/**
 * Observações sobre o hóspede digitadas no check-in ou no check-out: o hóspede
 * vem da própria reserva (não do navegador) e só grava se o texto mudou.
 */
async function gravarObservacoesDaReserva(ctx: Awaited<ReturnType<typeof contexto>>, empresaId: string, reservaId: string, fd?: FormData): Promise<string | null> {
  if (!fd?.has("observacoes_hospede_presente")) return null;
  const novo = texto(fd, "observacoes_hospede");
  if (novo.length > 1000) return "As observações podem ter até 1.000 letras.";
  const { data: r } = await ctx.supabase
    .from("hotel_reservas")
    .select("hospede_id, hospede:hotel_hospedes!hotel_reservas_empresa_id_hospede_id_fkey(observacoes)")
    .eq("empresa_id", empresaId)
    .eq("id", reservaId)
    .maybeSingle();
  if (!r) return "Reserva não encontrada.";
  if ((r.hospede?.observacoes ?? "") === novo) return null;
  const { error } = await ctx.supabase.rpc("hotel_hospede_observacoes", { p_hospede_id: r.hospede_id, p_texto: novo });
  return error ? mensagemErro(error) : null;
}

export async function fazerCheckin(empresaId: string, reservaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Reserva inválida.");
    const ctx = await contexto(empresaId);
    const placa = texto(fd, "placa_veiculo").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (placa && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) return falha("Placa inválida.", { placa_veiculo: ["Placa no formato ABC1D23 ou ABC1234."] });
    const erroObs = await gravarObservacoesDaReserva(ctx, empresaId, reservaId, fd);
    if (erroObs) return falha(erroObs, { observacoes_hospede: [erroObs] });
    const { error } = await ctx.supabase.rpc("hotel_checkin", {
      p_reserva_id: reservaId,
      p_dados: {
        motivo_viagem: texto(fd, "motivo_viagem"),
        meio_transporte: texto(fd, "meio_transporte"),
        placa_veiculo: placa,
        procedencia: texto(fd, "procedencia").slice(0, 120),
        destino: texto(fd, "destino").slice(0, 120),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Check-in feito. Bem-vindo(a)!");
  });
}

export async function trocarQuarto(empresaId: string, reservaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Reserva inválida.");
    const quarto = texto(fd, "quarto_id");
    if (!UUID.test(quarto)) return falha("Escolha o novo quarto.", { quarto_id: ["Escolha o novo quarto."] });
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("hotel_trocar_quarto", { p_reserva_id: reservaId, p_quarto_id: quarto, p_motivo: texto(fd, "motivo").slice(0, 200) });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Quarto trocado.");
  });
}

export async function lancarConsumo(
  empresaId: string,
  reservaId: string,
  setor: string,
  itens: { produto_id: string; quantidade: string }[],
): Promise<ResultadoAcao<{ total: number }>> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Escolha o quarto (hóspede).");
    if (!itens.length) return falha("Escolha pelo menos um produto.");
    if (itens.some((i) => !UUID.test(i.produto_id) || !lerValorBR(i.quantidade)?.gt(0))) return falha("Confira as quantidades.");
    const ctx = await contexto(empresaId);
    const { data, error } = await ctx.supabase.rpc("hotel_consumo_lancar", {
      p_reserva_id: reservaId,
      p_dados: { setor, itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: lerValorBR(i.quantidade)!.toString() })) },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    revalidatePath(`/e/${empresaId}/loja`, "layout");
    const r = data as { itens: number; total: number };
    return sucesso(`${r.itens} item(ns) lançado(s) na conta do quarto.`, { total: Number(r.total) });
  });
}

// -----------------------------------------------------------------------------
// Serviços extras com preço fixo (refeições e marmitas, lavanderia, aluguel de carro...)
// -----------------------------------------------------------------------------
export async function salvarExtra(empresaId: string, extraId: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (extraId && !UUID.test(extraId)) return falha("Serviço inválido.");
    const ctx = await contexto(empresaId, true);
    const nome = texto(fd, "nome");
    const preco = valor(texto(fd, "preco"));
    const erros: Record<string, string[]> = {};
    if (nome.length < 2 || nome.length > 80) erros.nome = ["Dê um nome (2 a 80 letras), ex.: Marmita, Lavanderia por peça, Aluguel de carro."];
    if (!preco) erros.preco = ["Informe o preço."];
    if (!texto(fd, "natureza")) erros.natureza = ["Escolha o tipo."];
    if (!texto(fd, "unidade")) erros.unidade = ["Escolha como é contado."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("hotel_extra_salvar", {
      p_empresa_id: empresaId,
      p_id: extraId as string,
      p_dados: {
        nome,
        natureza: texto(fd, "natureza"),
        unidade: texto(fd, "unidade"),
        preco,
        ativo: !fd.has("ativo_presente") || fd.get("ativo") === "on",
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso(extraId ? `${nome} atualizado.` : `${nome} cadastrado.`);
  });
}

/** Lança os serviços extras na conta do hóspede: quantidade × preço (preço diferente do cadastro só o gerente). */
export async function lancarExtras(
  empresaId: string,
  reservaId: string,
  itens: { extra_id: string; quantidade: string; valor_unitario?: string | null }[],
  data?: string | null,
): Promise<ResultadoAcao<{ itens: number }>> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Escolha o quarto (hóspede).");
    if (!itens.length) return falha("Escolha pelo menos um serviço.");
    if (itens.some((i) => !UUID.test(i.extra_id) || !lerValorBR(i.quantidade)?.gt(0))) return falha("Confira as quantidades.");
    if (itens.some((i) => i.valor_unitario != null && i.valor_unitario !== "" && !valor(i.valor_unitario))) return falha("Confira os preços.");
    if (data && !DATA.test(data)) return falha("Data inválida.");
    const ctx = await contexto(empresaId);
    const { data: n, error } = await ctx.supabase.rpc("hotel_extras_lancar", {
      p_reserva_id: reservaId,
      p_dados: {
        data: data || null,
        itens: itens.map((i) => ({ extra_id: i.extra_id, quantidade: lerValorBR(i.quantidade)!.toString(), valor_unitario: i.valor_unitario ? valor(i.valor_unitario) : null })),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso(`${n} serviço(s) lançado(s) na conta do quarto.`, { itens: Number(n) });
  });
}

/** Observações sobre o hóspede (preferências, alergias, cuidados): a recepção atualiza. */
export async function salvarObservacoesHospede(empresaId: string, hospedeId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(hospedeId)) return falha("Hóspede inválido.");
    const ctx = await contexto(empresaId);
    const texto_ = texto(fd, "observacoes");
    if (texto_.length > 1000) return falha("As observações podem ter até 1.000 letras.", { observacoes: ["Até 1.000 letras."] });
    const { error } = await ctx.supabase.rpc("hotel_hospede_observacoes", { p_hospede_id: hospedeId, p_texto: texto_ });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Observações salvas.");
  });
}

/** Documentos do hotel (ficha, confirmação, extrato e recibo): modelo, cor e os dados do cabeçalho. */
export async function salvarDocumentosHotel(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const email = texto(fd, "email");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return falha("Confira o e-mail.", { email: ["E-mail inválido."] });
    const { error } = await ctx.supabase.rpc("hotel_documentos_configurar", {
      p_empresa_id: empresaId,
      p_dados: {
        modelo: texto(fd, "modelo"),
        cor: texto(fd, "cor"),
        nome: texto(fd, "nome").slice(0, 120),
        endereco: texto(fd, "endereco").slice(0, 300),
        telefone: texto(fd, "telefone").slice(0, 40),
        whatsapp: texto(fd, "whatsapp").slice(0, 40),
        email: email.slice(0, 200),
        site: texto(fd, "site").slice(0, 200),
        cadastur: texto(fd, "cadastur").slice(0, 40),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Documentos do hotel atualizados.");
  });
}

export async function lancarServico(empresaId: string, reservaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Reserva inválida.");
    const tipo = texto(fd, "tipo") === "desconto" ? "desconto" : "servico";
    const ctx = await contexto(empresaId, tipo === "desconto");
    const descricao = texto(fd, "descricao");
    const v = valor(texto(fd, "valor"));
    const erros: Record<string, string[]> = {};
    if (descricao.length < 2) erros.descricao = ["Descreva o lançamento."];
    if (!v || Number(v) <= 0) erros.valor = ["Informe o valor."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { error } = await ctx.supabase.rpc("hotel_servico_lancar", {
      p_reserva_id: reservaId,
      p_dados: { tipo, descricao: descricao.slice(0, 160), valor: v, setor: texto(fd, "setor") },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso(tipo === "desconto" ? "Desconto lançado." : "Serviço lançado na conta.");
  });
}

export async function cancelarItemConta(empresaId: string, itemId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(itemId)) return falha("Lançamento inválido.");
    const ctx = await contexto(empresaId, true);
    const motivo = texto(fd, "motivo");
    if (motivo.length < 3) return falha("Explique o motivo.", { motivo: ["Ex.: lançado no quarto errado."] });
    const { error } = await ctx.supabase.rpc("hotel_item_cancelar", { p_item_id: itemId, p_motivo: motivo });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Lançamento cancelado.");
  });
}

export async function registrarPagamento(empresaId: string, reservaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Reserva inválida.");
    const ctx = await contexto(empresaId);
    const forma = texto(fd, "forma");
    const v = valor(texto(fd, "valor"));
    const erros: Record<string, string[]> = {};
    if (!forma) erros.forma = ["Escolha a forma de pagamento."];
    if (!v || Number(v) <= 0) erros.valor = ["Informe o valor recebido."];
    if (forma === "faturado") {
      if (!UUID.test(texto(fd, "contraparte_id"))) erros.contraparte_id = ["Escolha a empresa que paga a fatura."];
      if (!DATA.test(texto(fd, "vencimento"))) erros.vencimento = ["Informe o vencimento da fatura."];
    }
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const { data: id, error } = await ctx.supabase.rpc("hotel_pagamento_registrar", {
      p_reserva_id: reservaId,
      p_dados: { forma, valor: v, contraparte_id: texto(fd, "contraparte_id"), vencimento: texto(fd, "vencimento"), observacao: texto(fd, "observacao").slice(0, 300) },
    });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    revalidatePath(`/e/${empresaId}/loja`, "layout");
    // O id volta para a tela enviar o comprovante (foto do PIX, do cartão) junto
    return sucesso(forma === "faturado" ? "Fatura lançada no Financeiro (a receber)." : "Pagamento registrado e lançado no Financeiro.", { id });
  });
}

export async function estornarPagamento(empresaId: string, pagamentoId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(pagamentoId)) return falha("Pagamento inválido.");
    const ctx = await contexto(empresaId, true);
    const motivo = texto(fd, "motivo");
    if (motivo.length < 3) return falha("Explique o motivo.", { motivo: ["Ex.: valor digitado errado, devolvido ao cliente."] });
    const { error } = await ctx.supabase.rpc("hotel_pagamento_estornar", { p_pagamento_id: pagamentoId, p_motivo: motivo });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Pagamento estornado (o lançamento do Financeiro foi cancelado).");
  });
}

export async function fazerCheckout(empresaId: string, reservaId: string, _a?: ResultadoAcao, fd?: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(reservaId)) return falha("Reserva inválida.");
    const ctx = await contexto(empresaId);
    const erroObs = await gravarObservacoesDaReserva(ctx, empresaId, reservaId, fd);
    if (erroObs) return falha(erroObs, { observacoes_hospede: [erroObs] });
    const { error } = await ctx.supabase.rpc("hotel_checkout", { p_reserva_id: reservaId });
    if (error) return falha(mensagemErro(error));
    revalidarHotel(empresaId);
    return sucesso("Check-out feito. O quarto foi para a limpeza.");
  });
}
