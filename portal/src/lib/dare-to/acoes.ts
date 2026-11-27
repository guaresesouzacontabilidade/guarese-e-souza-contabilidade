"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { carregarIcms } from "@/lib/calculos/icms-carregar";
import { lerCompetencia, somarMeses } from "@/lib/competencia";
import { dec } from "@/lib/dinheiro";
import { envPublico } from "@/lib/env";
import { publicarGuiaPdf } from "@/lib/guias/publicar-pdf";
import { ErroDareTo, emitirDareTo, RECEITA_COMPLEMENTACAO_TO } from "./robo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** DARE abaixo de R$ 3,00 não pode ser emitido (Portaria SEFAZ nº 703/2026): o valor se acumula para o mês seguinte. */
const MINIMO_DARE = dec("3.00");
const texto = (fd: FormData, nome: string) => String(fd.get(nome) ?? "").trim();
const SO_NO_OFICIAL = "Fora do portal oficial o robô não acessa a SEFAZ-TO (a demonstração usa dados fictícios). No portal oficial, este botão funciona de verdade.";

export interface DareEmitidoResumo {
  numero: string;
  total: string;
  vencimento: string;
  documentoId: string | null;
}

/**
 * Emite o DARE da complementação de alíquota no DARE avulso da SEFAZ-TO (site
 * público, sem login) com o valor da apuração conferida e o vencimento do dia
 * 9, e publica o PDF oficial como guia da empresa.
 */
async function emitir(empresaId: string, competencia: string, novamente: boolean): Promise<ResultadoAcao<DareEmitidoResumo>> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");

  const { data: bruto, error: erroDados } = await ctx.supabase.rpc("dados_dare_to", { p_empresa_id: empresaId, p_competencia: comp });
  if (erroDados || !bruto) return falha(mensagemErro(erroDados));
  const d = bruto as unknown as {
    empresa: { uf: string; inscricao_estadual: string | null; documento: string; municipio_ibge: string | null; demonstracao: boolean };
    hoje: string;
    emissoes: { numero: string; total: number; vencimento: string }[];
  };
  if (d.empresa.uf !== "TO") return falha("O robô do DARE é da SEFAZ-TO: esta empresa não é do Tocantins.");
  if (envPublico.ambiente() !== "producao" || d.empresa.demonstracao) return falha(SO_NO_OFICIAL);
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

  const [ano, mes] = comp.split("-");
  let dare: Awaited<ReturnType<typeof emitirDareTo>>;
  try {
    dare = await emitirDareTo({
      inscricaoEstadual: ie,
      documento: d.empresa.documento,
      municipioIbge: d.empresa.municipio_ibge,
      receita: RECEITA_COMPLEMENTACAO_TO,
      periodo: `${ano}-${mes}`,
      vencimento,
      valor,
      observacao: `ICMS complementação de alíquota - Simples Nacional - competência ${mes}/${ano}`,
    });
  } catch (e) {
    return falha(e instanceof ErroDareTo ? e.message : "Não foi possível emitir o DARE na SEFAZ-TO. Tente de novo ou emita pelo site.");
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
  if ("erro" in pub) return falha(`${aviso} ${pub.erro}. Emita a 2ª via pelo site da SEFAZ-TO e anexe.`);
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
