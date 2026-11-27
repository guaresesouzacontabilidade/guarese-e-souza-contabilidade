"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envPublico } from "@/lib/env";
import { cifrar, decifrar, ErroChaveCertificados } from "@/lib/notas-automaticas/cripto";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { FAIXAS_GTA } from "./rotulos";
import { conferirNoSidago, ErroSidago, type AnimalGta } from "./sidago";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SO_NO_OFICIAL =
  "O robô só acessa o SIDAGO no portal oficial, com empresa real. Na demonstração e nos testes nenhuma consulta é feita ao sistema da Agrodefesa.";

const texto = (fd: FormData, nome: string, max = 200) =>
  String(fd.get(nome) ?? "")
    .trim()
    .slice(0, max);

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/notas-produto/gta`, "layout");
}

async function contexto(empresaId: string, configurar = false) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (configurar ? !ctx.pode("nfe.configurar") : !(ctx.pode("nfe.emitir") || ctx.pode("nfe.configurar"))) {
    throw new Error(configurar ? "Só quem configura a NF-e da empresa guarda o acesso ao SIDAGO." : "Você não tem acesso à GTA desta empresa.");
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

/** 04208285168 → 042•••••168 (o que a tela mostra do login). */
function mascarar(login: string) {
  if (login.length <= 4) return `${login.slice(0, 1)}•••`;
  return `${login.slice(0, 3)}${"•".repeat(Math.max(login.length - 6, 3))}${login.slice(-3)}`;
}

/** Municípios de uma UF para o destino da GTA. */
export async function municipiosGta(empresaId: string, uf: string): Promise<{ ibge: string; nome: string }[]> {
  if (!/^[A-Z]{2}$/.test(uf)) return [];
  const ctx = await contexto(empresaId).catch(() => null);
  if (!ctx) return [];
  const { data } = await ctx.supabase.from("municipios").select("ibge, nome").eq("uf", uf).order("nome").limit(1000);
  return data ?? [];
}

// -----------------------------------------------------------------------------
// Acesso ao SIDAGO
// -----------------------------------------------------------------------------
export async function salvarAcessoSidago(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const login = texto(fd, "login", 80).replace(/[^a-z0-9]/gi, "").toLowerCase();
    const senha = String(fd.get("senha") ?? "");
    const erros: Record<string, string[]> = {};
    if (login.length < 3) erros.login = ["Informe o usuário do SIDAGO (o CPF do produtor, só números)."];
    if (senha.length < 3 || senha.length > 200) erros.senha = ["Informe a senha do SIDAGO."];
    if (fd.get("autorizacao") !== "on") erros.autorizacao = ["Confirme a autorização do produtor."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    let cifrado: string;
    try {
      cifrado = cifrar(JSON.stringify({ login, senha }));
    } catch (e) {
      return falha(e instanceof ErroChaveCertificados ? e.message : "Não foi possível guardar o acesso.");
    }
    const { error } = await ctx.supabase.rpc("gta_sidago_salvar_acesso", { p_empresa_id: empresaId, p_login_mascarado: mascarar(login), p_conteudo_cifrado: cifrado });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Acesso ao SIDAGO guardado (cifrado, só o servidor usa).");
  });
}

export async function removerAcessoSidago(empresaId: string): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const { error } = await ctx.supabase.rpc("gta_sidago_remover_acesso", { p_empresa_id: empresaId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Acesso ao SIDAGO removido do portal.");
  });
}

// -----------------------------------------------------------------------------
// Pedido de GTA
// -----------------------------------------------------------------------------
export async function salvarPedidoGta(empresaId: string, id: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (id && !UUID.test(id)) return falha("Pedido inválido.");
    const ctx = await contexto(empresaId);
    const animais: AnimalGta[] = [];
    for (const sexo of ["macho", "femea"] as const) {
      for (const faixa of FAIXAS_GTA) {
        const q = Number(texto(fd, `animais_${sexo}_${faixa}`, 6) || "0");
        if (Number.isInteger(q) && q > 0) animais.push({ sexo, faixa, quantidade: q });
      }
    }
    const erros: Record<string, string[]> = {};
    if (texto(fd, "destino_nome").length < 2) erros.destino_nome = ["Informe o destino."];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(fd, "data_saida", 10))) erros.data_saida = ["Informe a data de saída."];
    if (!animais.length) erros.animais = ["Informe quantos animais vão, por sexo e idade."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const dados: Record<string, Json> = {
      emitente_id: texto(fd, "emitente_id", 40),
      nfe_emissao_id: texto(fd, "nfe_emissao_id", 40),
      nf_numero: texto(fd, "nf_numero", 9).replace(/\D/g, ""),
      nf_serie: texto(fd, "nf_serie", 3).replace(/\D/g, ""),
      destino_nome: texto(fd, "destino_nome", 120),
      destino_documento: texto(fd, "destino_documento", 20),
      destino_ie: texto(fd, "destino_ie", 20),
      destino_municipio_ibge: texto(fd, "destino_municipio_ibge", 7),
      destino_codigo: texto(fd, "destino_codigo", 30),
      finalidade: texto(fd, "finalidade", 20),
      especie: texto(fd, "especie", 20) || "bovina",
      animais: animais as unknown as Json,
      transporte: texto(fd, "transporte", 20) || "rodoviario",
      placa: texto(fd, "placa", 10),
      placa_uf: texto(fd, "placa_uf", 2),
      transportador_nome: texto(fd, "transportador_nome", 120),
      transportador_documento: texto(fd, "transportador_documento", 20),
      data_saida: texto(fd, "data_saida", 10),
      observacoes: texto(fd, "observacoes", 500),
    };
    const { data, error } = await ctx.supabase.rpc("gta_pedido_salvar", { p_empresa_id: empresaId, p_id: id as string, p_dados: dados });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "Pedido de GTA atualizado." : "Pedido de GTA criado.", { id: data as string });
  });
}

export async function excluirPedidoGta(empresaId: string, id: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("Pedido inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("gta_pedido_excluir", { p_id: id });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Pedido de GTA apagado.");
  });
}

export async function registrarEmissaoGta(empresaId: string, id: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("Pedido inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("gta_pedido_registrar_emissao", { p_id: id, p_numero: texto(fd, "gta_numero", 30), p_serie: texto(fd, "gta_serie", 10) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("GTA emitida anotada no pedido.");
  });
}

// -----------------------------------------------------------------------------
// Conferência no SIDAGO (modo conferência: nada é emitido)
// -----------------------------------------------------------------------------
export async function conferirPedidoGta(empresaId: string, id: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("Pedido inválido.");
    const ctx = await contexto(empresaId);
    const { data: p } = await ctx.supabase
      .from("gta_pedidos")
      .select("*, emitente:nfe_emitentes(nome, inscricao_estadual), municipio:municipios(nome, uf), empresa:empresas(demonstracao)")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!p) return falha("Pedido de GTA não encontrado.");
    if (envPublico.ambiente() !== "producao" || (p.empresa as unknown as { demonstracao: boolean } | null)?.demonstracao) return falha(SO_NO_OFICIAL);

    const admin = criarClienteAdmin();
    const { data: segredo } = await admin.from("gta_sidago_segredo").select("conteudo_cifrado").eq("empresa_id", empresaId).maybeSingle();
    if (!segredo) return falha("Cadastre o acesso ao SIDAGO do produtor (usuário e senha) antes de conferir.");
    let acesso: { login: string; senha: string };
    try {
      acesso = JSON.parse(decifrar(segredo.conteudo_cifrado));
    } catch (e) {
      return falha(e instanceof ErroChaveCertificados ? e.message : "Não foi possível abrir o acesso guardado. Cadastre de novo.");
    }
    const emitente = p.emitente as unknown as { nome: string; inscricao_estadual: string } | null;
    const municipio = p.municipio as unknown as { nome: string; uf: string } | null;
    try {
      const r = await conferirNoSidago(acesso, {
        origemIe: emitente?.inscricao_estadual ?? null,
        origemNome: emitente?.nome ?? null,
        destinoNome: p.destino_nome,
        destinoDocumento: p.destino_documento,
        destinoIe: p.destino_ie,
        destinoMunicipio: municipio ? `${municipio.nome}/${municipio.uf}` : null,
        destinoCodigo: p.destino_codigo,
        finalidade: p.finalidade,
        especie: p.especie,
        animais: p.animais as unknown as AnimalGta[],
        totalAnimais: p.total_animais,
        transporte: p.transporte,
        placa: p.placa,
        placaUf: p.placa_uf,
        transportadorNome: p.transportador_nome,
        transportadorDocumento: p.transportador_documento,
        dataSaida: p.data_saida,
        nfNumero: p.nf_numero,
        nfSerie: p.nf_serie,
        nfChave: p.nf_chave,
      });
      const achou = Boolean(r.formulario);
      const mensagem = achou
        ? `Formulário da GTA encontrado no SIDAGO (${r.formulario!.campos.length} campos). Modo conferência: nada foi enviado nem emitido.`
        : "Entrou no SIDAGO, mas não achou o formulário da GTA pelos links do menu. O mapa das páginas abertas ficou guardado para ajustar o robô.";
      const { error } = await admin.rpc("gta_conferencia_registrar", {
        p_pedido_id: id,
        p_ok: achou,
        p_mensagem: mensagem,
        p_mapeamento: r as unknown as Json,
        p_usuario: ctx.sessao.usuarioId,
      });
      if (error) return falha(mensagemErro(error));
      revalidar(empresaId);
      return achou ? sucesso(mensagem) : falha(mensagem);
    } catch (e) {
      const mensagem = e instanceof ErroSidago ? e.message : "Não foi possível conferir no SIDAGO. Tente de novo em alguns minutos.";
      await admin.rpc("gta_conferencia_registrar", {
        p_pedido_id: id,
        p_ok: false,
        p_mensagem: mensagem,
        p_mapeamento: { login: e instanceof ErroSidago && e.etapa === "login" ? "erro" : "sem_resposta", etapa: e instanceof ErroSidago ? e.etapa : "conexao" },
        p_usuario: ctx.sessao.usuarioId,
      });
      revalidar(empresaId);
      return falha(mensagem);
    }
  });
}
