"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { dec, lerValorBR } from "@/lib/dinheiro";
import { envPublico } from "@/lib/env";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { carregarDadosDar } from "./carregar";
import { calcularEncargos, mesesEntre, type EncargosDar } from "./encargos";
import { ErroDarMt, emitirDarMt } from "./robo";
import { buscarSelicMensal } from "./selic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const RECEITA_ICMS = "1112";
const REGIMES_NORMAIS = new Set(["lucro_presumido", "lucro_real", "lucro_arbitrado"]);
const texto = (fd: FormData, nome: string) => String(fd.get(nome) ?? "").trim();

export interface PreviaDar {
  principal: string;
  vencimentoImposto: string;
  pagamento: string;
  diasAtraso: number;
  multaPercentual: string;
  multa: string;
  mesesSelic: string[];
  jurosPercentual: string;
  juros: string;
  total: string;
}

function previa(e: EncargosDar, vencimentoImposto: string, pagamento: string): PreviaDar {
  return {
    principal: e.principal.toFixed(2),
    vencimentoImposto,
    pagamento,
    diasAtraso: e.diasAtraso,
    multaPercentual: e.multaPercentual.toFixed(3),
    multa: e.multa.toFixed(2),
    mesesSelic: e.mesesSelic,
    jurosPercentual: e.jurosPercentual.toFixed(2),
    juros: e.juros.toFixed(2),
    total: e.total.toFixed(2),
  };
}

/** Confere os dados do formulário e calcula multa e juros (com a SELIC do Banco Central). */
async function preparar(empresaId: string, competencia: string, fd: FormData) {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return { erro: falha("Dados inválidos.") } as const;
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const principal = lerValorBR(texto(fd, "valor"));
  if (!principal || principal.lte(0)) return { erro: falha("Informe o valor do ICMS a recolher.", { valor: ["Informe um valor maior que zero."] }) } as const;
  const vencimento = texto(fd, "vencimento");
  if (!DATA.test(vencimento)) return { erro: falha("Informe o vencimento do ICMS.", { vencimento: ["Use uma data válida."] }) } as const;
  const pagamento = texto(fd, "pagamento");
  if (!DATA.test(pagamento)) return { erro: falha("Informe até quando a empresa vai pagar.", { pagamento: ["Use uma data válida."] }) } as const;

  const carregado = await carregarDadosDar(ctx.supabase, empresaId, comp, vencimento);
  if ("erro" in carregado) return { erro: falha(carregado.erro) } as const;
  const d = carregado.dados;
  if (d.empresa.uf !== "MT") return { erro: falha("O robô do DAR é da SEFAZ-MT: esta empresa não é de Mato Grosso.") } as const;
  if (!d.empresa.contribuinte_icms || !REGIMES_NORMAIS.has(d.empresa.regime)) {
    return { erro: falha("O DAR do ICMS normal (receita 1112) é para contribuinte do ICMS no regime normal (Lucro Presumido ou Real).") } as const;
  }
  const ie = (d.empresa.inscricao_estadual ?? "").replace(/\D/g, "");
  if (ie.length !== 9) return { erro: falha("Cadastre a inscrição estadual de MT (9 dígitos) da empresa antes de gerar o DAR.") } as const;
  if (pagamento < d.hoje) return { erro: falha("A data do pagamento não pode ser antes de hoje.", { pagamento: ["Use hoje ou uma data futura."] }) } as const;
  if (pagamento.slice(0, 7) !== d.hoje.slice(0, 7)) {
    return { erro: falha("O DAR com multa e juros vale até o fim do mês em que é gerado: escolha uma data deste mês.", { pagamento: ["Escolha uma data deste mês."] }) } as const;
  }
  const vencimentoImposto = d.vencimento_util ?? vencimento;

  let encargos: EncargosDar;
  try {
    const meses = pagamento.slice(0, 7) > vencimentoImposto.slice(0, 7) ? mesesEntre(vencimentoImposto, pagamento) : [];
    const selic = await buscarSelicMensal(meses);
    encargos = calcularEncargos({ principal, vencimento: vencimentoImposto, pagamento, selic });
  } catch (e) {
    return { erro: falha(e instanceof Error ? e.message : "Não foi possível calcular os juros.") } as const;
  }
  const efdIgual = d.efd?.a_recolher != null && dec(d.efd.a_recolher).eq(encargos.principal);
  return { ctx, comp, d, ie, pagamento, vencimentoImposto, encargos, efdId: efdIgual ? d.efd!.id : null } as const;
}

/** Prévia: multa, juros e total do DAR para pagar até a data escolhida. */
export async function calcularDarIcms(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<PreviaDar>> {
  const p = await preparar(empresaId, competencia, fd);
  if ("erro" in p) return p.erro!;
  return sucesso(undefined, previa(p.encargos, p.vencimentoImposto, p.pagamento));
}

/**
 * Gera o DAR na SEFAZ-MT pelo robô, guarda o PDF oficial e publica como guia
 * da empresa (agenda de pagamentos do cliente). Só no portal oficial: na
 * demonstração e no computador de desenvolvimento o robô não acessa a SEFAZ.
 */
export async function gerarDarIcms(
  empresaId: string,
  competencia: string,
  _anterior: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao<{ numero: string; total: string; linhaDigitavel: string | null; documentoId: string | null }>> {
  const p = await preparar(empresaId, competencia, fd);
  if ("erro" in p) return p.erro!;
  const { ctx, comp, d, ie, pagamento, vencimentoImposto, encargos } = p;
  if (envPublico.ambiente() !== "producao" || d.empresa.demonstracao) {
    return falha("Na demonstração o robô não acessa a SEFAZ-MT (os dados são fictícios). No portal oficial, este botão gera o DAR de verdade.");
  }
  const vigente = d.emissoes.find((e) => e.vencimento >= d.hoje);
  if (vigente && texto(fd, "novamente") !== "1") {
    return falha(`Já existe o DAR nº ${vigente.numero} deste mês, válido até ${vigente.vencimento.split("-").reverse().join("/")}. Para emitir outro, marque “Gerar outro DAR”.`);
  }

  const [ano, mes] = comp.split("-");
  let dar: Awaited<ReturnType<typeof emitirDarMt>>;
  try {
    dar = await emitirDarMt({
      inscricaoEstadual: ie,
      periodo: `${ano}-${mes}`,
      receita: RECEITA_ICMS,
      vencimentoDar: pagamento,
      principal: encargos.principal,
      diasAtraso: encargos.diasAtraso,
      multa: encargos.multa,
      juros: encargos.juros,
      informacao: `ICMS NORMAL - REFERENCIA ${mes}/${ano}`,
    });
  } catch (e) {
    return falha(e instanceof ErroDarMt ? e.message : "Não foi possível gerar o DAR na SEFAZ-MT. Tente de novo ou gere pelo site.");
  }

  const { data: id, error } = await ctx.supabase.rpc("dar_registrar_emissao", {
    p_empresa_id: empresaId,
    p_dados: {
      competencia: comp,
      uf: "MT",
      receita: RECEITA_ICMS,
      numero: dar.numero,
      principal: encargos.principal.toFixed(2),
      multa: encargos.multa.toFixed(2),
      juros: encargos.juros.toFixed(2),
      total: encargos.total.toFixed(2),
      vencimento_imposto: vencimentoImposto,
      vencimento: pagamento,
      dias_atraso: encargos.diasAtraso,
      multa_percentual: encargos.multaPercentual.toFixed(3),
      juros_percentual: encargos.jurosPercentual.toFixed(4),
      meses_selic: encargos.mesesSelic,
      linha_digitavel: dar.linhaDigitavel,
      origem: p.efdId ? "efd" : "informado",
      efd_geracao_id: p.efdId,
    } as never,
  });
  const avisoPdf = `O DAR nº ${dar.numero} foi gerado na SEFAZ-MT (R$ ${encargos.total.toFixed(2).replace(".", ",")}), mas`;
  if (error || !id) return falha(`${avisoPdf} não foi registrado no portal: ${mensagemErro(error)}`);

  // Guia publicada à empresa: mesmo caminho do envio de documentos (o banco confere permissão e formato)
  const sha256 = createHash("sha256").update(dar.pdf).digest("hex");
  const comEncargos = encargos.multa.gt(0) || encargos.juros.gt(0);
  const { data: criado, error: erroDoc } = await ctx.supabase.rpc("criar_documento", {
    p_empresa_id: empresaId,
    p_competencia: comp,
    p_categoria: "esc_guia",
    p_nome_arquivo: `DAR-ICMS-${ano}-${mes}-${dar.numero}.pdf`,
    p_mime: "application/pdf",
    p_tamanho: dar.pdf.length,
    p_sha256: sha256,
    p_titulo: `ICMS ${mes}/${ano} — DAR SEFAZ-MT${comEncargos ? " (com multa e juros)" : ""}`,
    p_vencimento: pagamento,
    p_valor: encargos.total.toFixed(2) as unknown as number,
  });
  const r = criado as unknown as { situacao: string; versao_id?: string; storage_path?: string; documento_id?: string; duplicado?: { id: string } } | null;
  if (erroDoc || !r) return falha(`${avisoPdf} a guia não entrou nos documentos: ${mensagemErro(erroDoc)}`);
  let documentoId: string | null = r.situacao === "duplicado" ? (r.duplicado?.id ?? null) : null;
  if (!documentoId) {
    const admin = criarClienteAdmin();
    const { error: erroUp } = await admin.storage.from("documentos").upload(r.storage_path!, dar.pdf, { contentType: "application/pdf", upsert: false });
    if (erroUp) return falha(`${avisoPdf} o PDF não foi guardado. Baixe o DAR pelo site da SEFAZ-MT e anexe.`);
    const { data: conf, error: erroConf } = await ctx.supabase.rpc("confirmar_upload", { p_versao_id: r.versao_id! });
    if (erroConf) return falha(`${avisoPdf} a guia não foi publicada: ${mensagemErro(erroConf)}`);
    documentoId = (conf as unknown as { documento_id: string }).documento_id;
  }
  await ctx.supabase.rpc("dar_vincular_documento", { p_id: id as unknown as string, p_documento_id: documentoId });
  processarFilaDepois({ tipos: ["processar_documento", "enviar_envio"] });
  revalidatePath(`/e/${empresaId}`, "layout");
  return sucesso(`DAR nº ${dar.numero} gerado na SEFAZ-MT e publicado na agenda de pagamentos da empresa.`, {
    numero: dar.numero,
    total: encargos.total.toFixed(2),
    linhaDigitavel: dar.linhaDigitavel,
    documentoId,
  });
}

/** Um formulário, duas etapas: "calcular" (prévia) e "gerar" (robô na SEFAZ-MT). */
export async function acaoDarIcms(
  empresaId: string,
  competencia: string,
  anterior: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao<({ etapa: "previa" } & PreviaDar) | { etapa: "gerado"; numero: string; total: string; linhaDigitavel: string | null; documentoId: string | null }>> {
  if (texto(fd, "etapa") === "gerar") {
    const r = await gerarDarIcms(empresaId, competencia, anterior, fd);
    return r.ok && r.dados ? { ...r, dados: { etapa: "gerado", ...r.dados } } : (r as ResultadoAcao<never>);
  }
  const r = await calcularDarIcms(empresaId, competencia, anterior, fd);
  return r.ok && r.dados ? { ...r, dados: { etapa: "previa", ...r.dados } } : (r as ResultadoAcao<never>);
}
