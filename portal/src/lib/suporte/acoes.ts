"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirSessao, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { gruposEmpresa, gruposEscritorio } from "@/components/layout/navegacao";
import { mensagemDeErro } from "@/lib/escalas/ia";
import base from "./base-guia.json";
import { atalhosParaPergunta, IndiceGuia, resumo, type Atalho } from "./busca";
import type { EntradaGuia, Publico } from "./guia";
import { credencialSuporte, responderComIa } from "./ia";

let indice: IndiceGuia | null = null;
const obterIndice = () => (indice ??= new IndiceGuia(base as EntradaGuia[]));

export interface RespostaSuporte {
  modo: "ia" | "guia";
  /** Texto escrito pelo assistente (só no modo IA) */
  resposta: string | null;
  trechos: { titulo: string; texto: string }[];
  atalhos: { rotulo: string; href: string }[];
  /** A pergunta parece pedir alguém do escritório (ou não achou no guia) */
  falarComEscritorio: boolean;
  /** Aviso quando a IA estava ligada mas não respondeu (a resposta veio do guia) */
  aviso: string | null;
  /** Número do registro da pergunta (para o "Isso ajudou?") */
  registro: number | null;
  /** A dúvida ficou guardada (sem números) para o escritório completar o guia */
  guardada: boolean;
}

/** Registra a pergunta sem o texto (o texto só quando o guia não respondeu, já mascarado no banco). */
async function registrar(
  supabase: Awaited<ReturnType<typeof exigirSessao>>["supabase"],
  dados: { empresaId: string | null; tela: string; modo: "guia" | "ia"; achou: boolean; trechos: string[]; atalhos: number; pergunta: string },
): Promise<number | null> {
  try {
    const { data } = await supabase.rpc("suporte_registrar", {
      p_dados: {
        empresa_id: dados.empresaId ?? "",
        tela: dados.tela,
        modo: dados.modo,
        achou: dados.achou,
        trechos: dados.trechos.slice(0, 6),
        atalhos: dados.atalhos,
        pergunta: dados.achou ? "" : dados.pergunta,
      },
    });
    return typeof data === "number" ? data : null;
  } catch {
    return null;
  }
}

const RE_EMPRESA = /^\/e\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** As telas que a pessoa pode abrir agora (o mesmo menu que ela vê). */
async function atalhosDaPessoa(caminho: string) {
  const s = await exigirSessao();
  const equipe = s.perfil.tipo !== "cliente";
  const empresas = await obterEmpresasDoUsuario();
  const id = RE_EMPRESA.exec(caminho)?.[1] ?? null;
  const e = (id ? empresas.find((x) => x.id === id) : null) ?? (!equipe ? empresas[0] : null) ?? null;
  const atalhos: Atalho[] = [];
  if (e) {
    const grupos = gruposEmpresa(
      {
        id: e.id,
        nome: e.nome_fantasia ?? e.razao_social,
        documento: e.documento,
        papel: e.papel,
        permissoes: [...e.permissoes],
        demonstracao: e.demonstracao,
        loja: e.loja,
        modalidade: e.gestao_modalidade,
        cte: e.cte,
        frota: e.frota,
        rhFuncionario: e.rh_funcionario,
        logo: null,
        desligadas: e.ferramentas_desligadas,
      },
      equipe,
    );
    for (const g of grupos) for (const i of g.itens) atalhos.push({ rotulo: i.rotulo, href: i.href, grupo: g.rotulo });
  }
  if (equipe) {
    const { count } = await s.supabase.from("honorarios_config").select("id", { count: "exact", head: true });
    for (const g of gruposEscritorio(s.perfil.tipo === "admin", (count ?? 0) > 0)) for (const i of g.itens) atalhos.push({ rotulo: i.rotulo, href: i.href, grupo: g.rotulo });
  }
  return { sessao: s, equipe, empresa: e, atalhos };
}

/**
 * Responde à dúvida: busca no guia (sempre) e, com o assistente ligado no
 * suporte, a resposta escrita pela IA. Só vão à IA a pergunta, os trechos do
 * guia e os nomes das telas; nada é guardado do texto da conversa.
 */
export async function perguntarSuporte(pergunta: string, caminho: string): Promise<ResultadoAcao<RespostaSuporte>> {
  const texto = String(pergunta ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (texto.length < 2) return falha("Escreva a sua dúvida.");
  const tela = String(caminho ?? "").slice(0, 300);
  const { sessao, equipe, empresa, atalhos } = await atalhosDaPessoa(tela);
  const publicos: Publico[] = equipe ? ["todos", "cliente", "equipe"] : ["todos", "cliente"];
  const achados = obterIndice().buscar(texto, publicos, 6);
  const trechos = achados.map((a) => a.entrada);
  const melhores = trechos.slice(0, 3).map((t) => ({ titulo: t.titulo, texto: resumo(t.texto) }));
  const sugeridos = atalhosParaPergunta(texto, atalhos, trechos);
  const semResposta = !achados.length || achados[0].pontos < 2;
  const reg = (modo: "guia" | "ia", n: number) =>
    registrar(sessao.supabase, { empresaId: empresa?.id ?? null, tela, modo, achou: !semResposta, trechos: melhores.map((t) => t.titulo), atalhos: n, pergunta: texto });
  const guia = async (aviso: string | null): Promise<RespostaSuporte> => ({
    modo: "guia",
    resposta: null,
    trechos: melhores,
    atalhos: sugeridos.map(({ rotulo, href }) => ({ rotulo, href })),
    falarComEscritorio: semResposta,
    aviso,
    registro: await reg("guia", sugeridos.length),
    guardada: semResposta,
  });

  // Assistente de IA (só se o administrador ligou no suporte)
  let credencial: Awaited<ReturnType<typeof credencialSuporte>> = null;
  try {
    credencial = await credencialSuporte();
  } catch {
    credencial = null;
  }
  if (!credencial) return sucesso(undefined, await guia(null));
  const { data: reserva, error: erroReserva } = await sessao.supabase.rpc("suporte_ia_reservar", { p_empresa_id: (empresa?.id ?? null) as string });
  const uso = (reserva as { uso_id: number }[] | null)?.[0]?.uso_id;
  if (erroReserva || !uso) return sucesso(undefined, await guia(erroReserva ? mensagemErro(erroReserva) : null));
  try {
    const r = await responderComIa(credencial, texto, trechos, atalhos);
    await sessao.supabase.rpc("suporte_ia_concluir", { p_uso_id: uso, p_ok: true, p_tokens_entrada: r.tokensEntrada, p_tokens_saida: r.tokensSaida, p_erro: "" });
    const porHref = new Map(atalhos.map((a) => [a.href, a]));
    const escolhidos = r.dados.atalhos.map((h) => porHref.get(h)).filter((a): a is Atalho => Boolean(a));
    const finais = escolhidos.length ? escolhidos : sugeridos;
    return sucesso(undefined, {
      modo: "ia",
      resposta: r.dados.resposta,
      trechos: melhores,
      atalhos: finais.map(({ rotulo, href }) => ({ rotulo, href })),
      falarComEscritorio: r.dados.falar_com_escritorio,
      aviso: null,
      registro: await reg("ia", finais.length),
      guardada: semResposta,
    });
  } catch (e) {
    const msg = mensagemDeErro(e);
    await sessao.supabase.rpc("suporte_ia_concluir", { p_uso_id: uso, p_ok: false, p_tokens_entrada: 0, p_tokens_saida: 0, p_erro: msg });
    return sucesso(undefined, await guia(`O assistente de IA não respondeu agora (${msg}). Veja o que o guia diz:`));
  }
}

/** Dados para o painel: se o assistente está ligado e o contato do escritório. */
export async function infoSuporte(): Promise<{ ia: boolean; whatsapp: string | null; email: string | null }> {
  await exigirSessao();
  const [cred, esc] = await Promise.all([credencialSuporte().catch(() => null), obterEscritorioPublico()]);
  return { ia: Boolean(cred), whatsapp: esc.whatsapp ?? null, email: esc.email ?? null };
}

/** O administrador liga ou desliga o assistente no suporte. */
export async function configurarSuporteIa(_a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const limite = Number(fd.get("suporte_limite_usuario") ?? 30);
  if (!Number.isInteger(limite) || limite < 1 || limite > 500) return falha("Limite entre 1 e 500 perguntas por pessoa por dia.", { suporte_limite_usuario: ["Entre 1 e 500."] });
  const ativo = fd.get("suporte_ativo") === "on";
  const { error } = await s.supabase.rpc("escritorio_ia_suporte", { p_ativo: ativo, p_limite_usuario: limite });
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/configuracoes");
  return sucesso(ativo ? "Assistente ligado no suporte 24h." : "Assistente desligado no suporte (as respostas vêm da busca no guia).");
}

/** "Isso ajudou?": no "não ajudou", a dúvida vai (com os números mascarados) para o escritório completar o guia. */
export async function avaliarSuporte(registro: number, util: boolean, pergunta: string): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  if (!Number.isInteger(registro) || registro <= 0) return falha("Pergunta inválida.");
  const { error } = await s.supabase.rpc("suporte_avaliar", { p_id: registro, p_util: Boolean(util), p_pergunta: util ? "" : String(pergunta ?? "").slice(0, 500) });
  if (error) return falha(mensagemErro(error));
  return sucesso(util ? "Que bom que ajudou!" : "Obrigado! A dúvida foi para o escritório melhorar o guia.");
}

/** O escritório marca a dúvida como tratada (ex.: completou o guia) ou reabre. */
export async function tratarDuvidaSuporte(id: number, tratada: boolean): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  if (!Number.isInteger(id) || id <= 0) return falha("Dúvida inválida.");
  const { error } = await s.supabase.rpc("suporte_tratar", { p_id: id, p_tratada: Boolean(tratada) });
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/suporte");
  return sucesso(tratada ? "Marcada como tratada." : "Reaberta.");
}
