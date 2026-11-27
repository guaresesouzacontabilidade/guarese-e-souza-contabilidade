"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirEquipe } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { hojeISO } from "@/lib/competencia";

const CAMINHO = "/escritorio/obrigacoes/icms";
const UF = /^[A-Z]{2}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const URL_OK = /^https?:\/\/\S+$/i;

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

/** Número em formato brasileiro ("20,5") ou com ponto; vazio vira null. */
function numero(fd: FormData, nome: string): number | null | "invalido" {
  const v = texto(fd, nome).replace("%", "").replace(",", ".").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : "invalido";
}

/** Atualiza a alíquota, o FCP e o prazo de um estado (administrador), sempre com a fonte. */
export async function salvarIcmsUf(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const uf = texto(fd, "uf").toUpperCase();
  if (!UF.test(uf)) return falha("Estado inválido.");

  const erros: Record<string, string[]> = {};
  const aliquotaSituacao = texto(fd, "aliquota_situacao");
  const aliquota = numero(fd, "aliquota_interna");
  const fcp = numero(fd, "fcp");
  const aliquotaBase = texto(fd, "aliquota_base_legal");
  const aliquotaUrl = texto(fd, "aliquota_fonte_url");
  const aliquotaVigencia = texto(fd, "aliquota_vigencia");
  const vencSituacao = texto(fd, "vencimento_situacao");
  const dia = numero(fd, "vencimento_dia");
  const ajuste = texto(fd, "vencimento_ajuste");
  const vencBase = texto(fd, "vencimento_base_legal");
  const vencUrl = texto(fd, "vencimento_fonte_url");
  const conferidoEm = texto(fd, "conferido_em");

  if (!["conferida", "informada", "a_conferir"].includes(aliquotaSituacao)) erros.aliquota_situacao = ["Selecione a situação da alíquota."];
  if (aliquota === "invalido" || (aliquota !== null && (aliquota < 0 || aliquota > 40))) erros.aliquota_interna = ["Informe a alíquota entre 0 e 40."];
  else if (aliquotaSituacao !== "a_conferir" && aliquota === null) erros.aliquota_interna = ["Informe a alíquota interna geral."];
  if (fcp === "invalido" || (fcp !== null && (fcp < 0 || fcp > 5))) erros.fcp = ["Informe o adicional entre 0 e 5 (ou deixe em branco)."];
  if (aliquotaSituacao !== "a_conferir" && aliquotaBase.length < 4) erros.aliquota_base_legal = ["Informe a lei e o artigo da alíquota."];
  if (aliquotaUrl && !URL_OK.test(aliquotaUrl)) erros.aliquota_fonte_url = ["Endereço inválido (comece com https://)."];
  if (aliquotaVigencia && !DATA.test(aliquotaVigencia)) erros.aliquota_vigencia = ["Data inválida."];

  if (!["conferido", "calendario", "a_conferir"].includes(vencSituacao)) erros.vencimento_situacao = ["Selecione a situação do prazo."];
  if (vencSituacao === "conferido") {
    if (dia === null || dia === "invalido" || !Number.isInteger(dia) || dia < 1 || dia > 31) erros.vencimento_dia = ["Informe o dia (1 a 31)."];
    if (!["postergar", "antecipar", "manter"].includes(ajuste)) erros.vencimento_ajuste = ["Selecione o que acontece sem expediente bancário."];
    if (vencBase.length < 4) erros.vencimento_base_legal = ["Informe o regulamento e o artigo do prazo."];
  }
  if (vencUrl && !URL_OK.test(vencUrl)) erros.vencimento_fonte_url = ["Endereço inválido (comece com https://)."];
  if (!DATA.test(conferidoEm) || conferidoEm > hojeISO()) erros.conferido_em = ["Informe a data em que a fonte foi conferida (até hoje)."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const conferido = vencSituacao === "conferido";
  const { data, error } = await s.supabase
    .from("icms_uf")
    .update({
      aliquota_interna: aliquota as number | null,
      fcp: (fcp as number | null) || null,
      fcp_observacao: texto(fd, "fcp_observacao") || null,
      aliquota_situacao: aliquotaSituacao,
      aliquota_vigencia: aliquotaVigencia || null,
      aliquota_base_legal: aliquotaBase || null,
      aliquota_fonte_url: aliquotaUrl || null,
      aliquota_observacao: texto(fd, "aliquota_observacao") || null,
      vencimento_situacao: vencSituacao,
      vencimento_dia: conferido ? (dia as number) : null,
      vencimento_ajuste: conferido ? ajuste : null,
      vencimento_base_legal: vencBase || null,
      vencimento_fonte_url: vencUrl || null,
      vencimento_observacao: texto(fd, "vencimento_observacao") || null,
      conferido_em: conferidoEm,
    })
    .eq("uf", uf)
    .select("uf");
  if (error) return falha(mensagemErro(error));
  if (!data?.length) return falha("Seu acesso não permite alterar esta tabela.");
  revalidatePath(CAMINHO);
  return sucesso(`Dados de ${uf} salvos.`);
}

/** Transforma o prazo conferido do estado em proposta de regra do catálogo (validada pelo administrador). */
export async function proporRegraIcms(uf: string): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  if (!UF.test(uf)) return falha("Estado inválido.");
  const { error } = await s.supabase.rpc("icms_uf_propor_regra", { p_uf: uf });
  if (error) return falha(mensagemErro(error));
  revalidatePath(CAMINHO);
  revalidatePath("/escritorio/obrigacoes/normas");
  return sucesso(`Regra do ICMS de ${uf} proposta. O administrador valida em Atualizações normativas.`);
}
