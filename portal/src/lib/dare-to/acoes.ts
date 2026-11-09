"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { carregarIcms } from "@/lib/calculos/icms-carregar";
import { lerCompetencia, somarMeses } from "@/lib/competencia";
import { dec } from "@/lib/dinheiro";
import { envPublico } from "@/lib/env";
import { validarCpf } from "@/lib/formatos";
import { publicarGuiaPdf } from "@/lib/guias/publicar-pdf";
import { cifrar, decifrar, ErroChaveCertificados } from "@/lib/notas-automaticas/cripto";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ErroDareTo, emitirDareTo, mascararLogin, RECEITA_COMPLEMENTACAO_TO, testarDareTo, type CredenciaisDareTo } from "./robo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** DARE abaixo de R$ 3,00 não pode ser emitido (Portaria SEFAZ nº 703/2026): o valor se acumula para o mês seguinte. */
const MINIMO_DARE = dec("3.00");
const texto = (fd: FormData, nome: string) => String(fd.get(nome) ?? "").trim();

const SO_NO_OFICIAL = "Fora do portal oficial o robô não acessa a SEFAZ-TO (a demonstração usa dados fictícios). No portal oficial, este botão funciona de verdade.";

async function credenciais(): Promise<CredenciaisDareTo | { erro: string }> {
  const { data, error } = await criarClienteAdmin().from("dare_to_acesso_segredo").select("conteudo_cifrado").eq("id", 1).maybeSingle();
  if (error) return { erro: mensagemErro(error) };
  if (!data) return { erro: "O acesso à SEFAZ-TO não está cadastrado. O administrador cadastra em Configurações → Integrações." };
  try {
    const c = JSON.parse(decifrar(data.conteudo_cifrado)) as CredenciaisDareTo;
    if (!c.login || !c.senha) throw new Error();
    return c;
  } catch (e) {
    return { erro: e instanceof ErroChaveCertificados && /não está configurada/.test(e.message) ? e.message : "Não foi possível abrir o acesso guardado. Cadastre o acesso à SEFAZ-TO de novo." };
  }
}

// -----------------------------------------------------------------------------
// Acesso do escritório (administrador)
// -----------------------------------------------------------------------------
export async function salvarAcessoDareTo(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (envPublico.ambiente() === "demonstracao") {
    return falha("Na demonstração não se cadastra o acesso real da SEFAZ-TO (os dados aqui são fictícios). Cadastre no portal oficial.");
  }
  const login = texto(fd, "login");
  const senha = String(fd.get("senha") ?? "");
  const ehEmail = login.includes("@");
  if (ehEmail ? !EMAIL.test(login) : !validarCpf(login)) {
    return falha("Informe o CPF ou o e-mail usado para entrar nos sistemas do governo do Tocantins.", { login: ["CPF ou e-mail inválido."] });
  }
  if (!senha || senha.length > 200) return falha("Informe a senha desse acesso.", { senha: ["Informe a senha."] });
  let cifrado: string;
  try {
    cifrado = cifrar(JSON.stringify({ login, senha }));
  } catch (e) {
    return falha(e instanceof Error ? e.message : "A chave de criptografia do servidor não está configurada.");
  }
  const { error } = await s.supabase.rpc("dare_to_salvar_acesso", { p_login_mascarado: mascararLogin(login), p_conteudo_cifrado: cifrado });
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/configuracoes");
  return sucesso("Acesso guardado (cifrado). Agora use “Testar conexão” para conferir.");
}

export async function removerAcessoDareTo(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { error } = await s.supabase.rpc("dare_to_remover_acesso");
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/configuracoes");
  return sucesso("Acesso à SEFAZ-TO removido. O robô do DARE fica desconectado.");
}

/** Entra no sistema de DARE e procura o formulário, sem emitir nada. */
export async function testarAcessoDareTo(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (envPublico.ambiente() !== "producao") return falha(SO_NO_OFICIAL);
  const cred = await credenciais();
  if ("erro" in cred) return falha(cred.erro);
  let ok = false;
  let mensagem: string;
  let mapeamento: unknown = null;
  try {
    const r = await testarDareTo(cred);
    ok = r.ok;
    mensagem = r.mensagem;
    mapeamento = r.mapeamento;
  } catch (e) {
    mensagem = e instanceof ErroDareTo ? e.message : "Não foi possível testar a conexão com a SEFAZ-TO.";
  }
  const { error } = await s.supabase.rpc("dare_to_registrar_teste", { p_ok: ok, p_mensagem: mensagem, p_mapeamento: mapeamento as never });
  revalidatePath("/escritorio/configuracoes");
  if (error) return falha(mensagemErro(error));
  return ok ? sucesso(mensagem) : falha(mensagem);
}

// -----------------------------------------------------------------------------
// Emissão do DARE da complementação de alíquota
// -----------------------------------------------------------------------------
export interface DareEmitidoResumo {
  numero: string;
  total: string;
  vencimento: string;
  documentoId: string | null;
}

async function emitir(empresaId: string, competencia: string, novamente: boolean): Promise<ResultadoAcao<DareEmitidoResumo>> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");

  const { data: bruto, error: erroDados } = await ctx.supabase.rpc("dados_dare_to", { p_empresa_id: empresaId, p_competencia: comp });
  if (erroDados || !bruto) return falha(mensagemErro(erroDados));
  const d = bruto as unknown as {
    empresa: { uf: string; inscricao_estadual: string | null; documento: string; demonstracao: boolean };
    acesso: { situacao: string } | null;
    hoje: string;
    emissoes: { numero: string; total: number; vencimento: string }[];
  };
  if (d.empresa.uf !== "TO") return falha("O robô do DARE é da SEFAZ-TO: esta empresa não é do Tocantins.");
  if (envPublico.ambiente() !== "producao" || d.empresa.demonstracao) return falha(SO_NO_OFICIAL);
  if (!d.acesso) return falha("O robô do DARE está desconectado: o administrador cadastra o acesso à SEFAZ-TO em Configurações → Integrações.");
  if (d.acesso.situacao !== "conectado") return falha("O acesso à SEFAZ-TO ainda não passou no teste. O administrador usa “Testar conexão” em Configurações → Integrações.");
  const ie = (d.empresa.inscricao_estadual ?? "").replace(/\D/g, "");
  if (ie.length < 8) return falha("Cadastre a inscrição estadual da empresa antes de emitir o DARE.");

  // Valor e vencimento da apuração conferida pelo escritório
  const r = await carregarIcms(ctx.supabase, empresaId, comp);
  if ("erro" in r) return falha(r.erro);
  if (r.resultado.modo !== "simples") return falha("O DARE da complementação de alíquota é para empresa do Simples Nacional ou MEI.");
  const conferida = r.dados.apuracao?.conferida_em ? r.dados.apuracao.resultado : null;
  if (!conferida) return falha("Confira a apuração do ICMS do mês antes de emitir o DARE (botão “Conferir” nesta tela).");
  const atual = r.resultado.linhas.find((l) => l.chave === "complementacao");
  const guardada = conferida.linhas.find((l) => l.chave === "complementacao");
  if (!guardada || dec(guardada.valor).lte(0)) return falha("Não há complementação de alíquota a pagar neste mês.");
  if (!atual || !dec(atual.valor).toDecimalPlaces(2).eq(dec(guardada.valor))) {
    return falha("A apuração mudou depois da conferência (notas ou destinação). Confira de novo antes de emitir o DARE.");
  }
  const valor = dec(guardada.valor).toDecimalPlaces(2);
  if (valor.lt(MINIMO_DARE)) return falha("Valor abaixo de R$ 3,00: a SEFAZ-TO não emite DARE abaixo desse valor; ele se acumula para o mês seguinte (Portaria SEFAZ nº 703/2026).");
  const vencimento = guardada.vencimento ?? `${somarMeses(comp, 1).slice(0, 7)}-09`;
  if (vencimento < d.hoje) {
    return falha(`O vencimento (${vencimento.split("-").reverse().join("/")}) já passou: emita o DARE pelo site da SEFAZ-TO, que calcula a multa e os juros.`);
  }
  const vigente = d.emissoes.find((e) => dec(e.total).eq(valor) && e.vencimento >= d.hoje);
  if (vigente && !novamente) return falha(`Já existe o DARE nº ${vigente.numero} deste mês com este valor. Para emitir outro, marque “Emitir outro DARE”.`);

  const cred = await credenciais();
  if ("erro" in cred) return falha(cred.erro);
  const [ano, mes] = comp.split("-");
  let dare: Awaited<ReturnType<typeof emitirDareTo>>;
  try {
    dare = await emitirDareTo(cred, {
      inscricaoEstadual: ie,
      documento: d.empresa.documento,
      receita: RECEITA_COMPLEMENTACAO_TO,
      periodo: `${ano}-${mes}`,
      vencimento,
      valor,
      informacao: `Complementacao de aliquota - Simples Nacional - referencia ${mes}/${ano}`,
    });
  } catch (e) {
    const msg = e instanceof ErroDareTo ? e.message : "Não foi possível emitir o DARE na SEFAZ-TO. Tente de novo ou emita pelo site.";
    if (e instanceof ErroDareTo && (e.etapa === "login" || e.etapa === "formulario")) {
      await ctx.supabase.rpc("dare_to_registrar_teste", { p_ok: false, p_mensagem: msg });
    }
    return falha(msg);
  }

  const total = valor.toFixed(2);
  const aviso = `O DARE nº ${dare.numero} foi emitido na SEFAZ-TO (R$ ${total.replace(".", ",")}), mas`;
  const { data: id, error } = await ctx.supabase.rpc("dar_registrar_emissao", {
    p_empresa_id: empresaId,
    p_dados: {
      competencia: comp,
      uf: "TO",
      receita: RECEITA_COMPLEMENTACAO_TO,
      numero: dare.numero,
      principal: total,
      total,
      vencimento_imposto: vencimento,
      vencimento,
      linha_digitavel: dare.linhaDigitavel,
      origem: "apuracao",
    } as never,
  });
  if (error || !id) return falha(`${aviso} não foi registrado no portal: ${mensagemErro(error)}`);

  const pub = await publicarGuiaPdf(ctx.supabase, {
    empresaId,
    competencia: comp,
    nomeArquivo: `DARE-TO-105-${ano}-${mes}-${dare.numero}.pdf`,
    titulo: `ICMS complementação de alíquota ${mes}/${ano} — DARE SEFAZ-TO`,
    vencimento,
    valor: total,
    pdf: dare.pdf,
  });
  if ("erro" in pub) return falha(`${aviso} ${pub.erro}. Baixe o DARE pelo site da SEFAZ-TO e anexe.`);
  await ctx.supabase.rpc("dar_vincular_documento", { p_id: id as unknown as string, p_documento_id: pub.documentoId });
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath("/escritorio/icms");
  return sucesso(`DARE nº ${dare.numero} emitido na SEFAZ-TO e publicado na agenda de pagamentos da empresa.`, {
    numero: dare.numero,
    total,
    vencimento,
    documentoId: pub.documentoId,
  });
}

/** Botão da apuração do ICMS da empresa. */
export async function emitirDareComplementacao(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<DareEmitidoResumo>> {
  return emitir(empresaId, competencia, texto(fd, "novamente") === "1");
}

/** Emissão em lote (tela da carteira): uma empresa por chamada, conduzida pela página. */
export async function emitirDareComplementacaoEmpresa(empresaId: string, competencia: string): Promise<ResultadoAcao<DareEmitidoResumo>> {
  return emitir(empresaId, competencia, false);
}
