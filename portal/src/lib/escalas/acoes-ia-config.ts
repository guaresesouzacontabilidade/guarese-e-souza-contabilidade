"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envServidor } from "@/lib/env-servidor";
import { MODELOS_IA, testarChave } from "./ia";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { cifrar, decifrar } from "@/lib/notas-automaticas/cripto";

/**
 * Configuração do assistente de IA das escalas (só o administrador do
 * escritório). A chave é testada, cifrada no servidor e guardada numa tabela
 * que o navegador não lê; a tela mostra só os 4 últimos caracteres.
 */

const CHAVE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

function revalidar() {
  revalidatePath("/escritorio/configuracoes");
}

export async function salvarChaveIa(_a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const chave = String(fd.get("chave") ?? "").trim();
  if (!CHAVE.test(chave)) return falha("A chave da Anthropic começa com “sk-ant-”. Copie a chave inteira do painel da Anthropic.", { chave: ["Chave inválida."] });
  if (!envServidor.certificadosChave()) return falha("Falta a chave de criptografia do servidor (CERTIFICADOS_CHAVE na hospedagem). Sem ela, a chave da IA não pode ser guardada.");
  const { data: cfg } = await s.supabase.from("escritorio_ia").select("modelo").eq("id", 1).maybeSingle();
  const modelo = cfg?.modelo ?? MODELOS_IA[0].id;
  const teste = await testarChave(chave, modelo);
  if (!teste.ok && /recusada/.test(teste.erro)) return falha(teste.erro);
  const { error } = await s.supabase.rpc("escritorio_ia_salvar_chave", { p_chave_cifrada: cifrar(chave), p_chave_final: chave.slice(-4).replace(/[^A-Za-z0-9_-]/g, "x") });
  if (error) return falha(mensagemErro(error));
  await s.supabase.rpc("escritorio_ia_registrar_teste", { p_ok: teste.ok, p_erro: teste.ok ? "" : teste.erro });
  revalidar();
  return teste.ok
    ? sucesso("Chave guardada e testada. Agora é só ligar o assistente.")
    : sucesso(`Chave guardada, mas o teste falhou: ${teste.erro}`);
}

export async function removerChaveIa(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { error } = await s.supabase.rpc("escritorio_ia_salvar_chave", { p_chave_cifrada: null as unknown as string, p_chave_final: null as unknown as string });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Chave removida. O assistente ficou desconectado.");
}

export async function configurarIa(_a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const modelo = String(fd.get("modelo") ?? "");
  if (!MODELOS_IA.some((m) => m.id === modelo)) return falha("Escolha o modelo.");
  const limite = Number(fd.get("limite_diario") ?? 30);
  if (!Number.isInteger(limite) || limite < 1 || limite > 500) return falha("Limite entre 1 e 500 pedidos por dia.", { limite_diario: ["Entre 1 e 500."] });
  const ativa = fd.get("ativa") === "on";
  const { error } = await s.supabase.rpc("escritorio_ia_configurar", { p_ativa: ativa, p_modelo: modelo, p_limite_diario: limite });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso(ativa ? "Assistente ligado." : "Configuração salva (assistente desligado).");
}

export async function testarIa(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const admin = criarClienteAdmin();
  const [{ data: cfg }, { data: seg }] = await Promise.all([
    admin.from("escritorio_ia").select("modelo").eq("id", 1).maybeSingle(),
    admin.from("escritorio_ia_segredo").select("chave_cifrada").eq("id", 1).maybeSingle(),
  ]);
  if (!seg?.chave_cifrada) return falha("Cadastre a chave antes de testar.");
  let chave: string;
  try {
    chave = decifrar(seg.chave_cifrada);
  } catch {
    return falha("Não foi possível abrir a chave guardada (a chave de criptografia do servidor mudou?). Cadastre a chave de novo.");
  }
  const teste = await testarChave(chave, cfg?.modelo ?? MODELOS_IA[0].id);
  await s.supabase.rpc("escritorio_ia_registrar_teste", { p_ok: teste.ok, p_erro: teste.ok ? "" : teste.erro });
  revalidar();
  return teste.ok ? sucesso("Conexão com a Anthropic funcionando.") : falha(teste.erro);
}
