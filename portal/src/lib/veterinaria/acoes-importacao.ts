"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerAbasPlanilha } from "@/lib/gestao/planilha-produtos";
import { buscarTudo } from "@/lib/supabase/paginar";
import { analisarTutores, type CampoImportacao, type ResultadoAnalise, type TutorParaImportar } from "./planilha-tutores";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// As ações do servidor aceitam até 2 MB por envio (next.config)
const LIMITE_BYTES = 1.9 * 1024 * 1024;
/** Tutores por gravação (cada lote é gravado de uma vez no banco). */
export type LoteImportacao = TutorParaImportar[];

/** Só o responsável pela clínica importa (o banco confere de novo). */
async function contextoGerente(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.loja || ctx.acesso.gestao_modalidade !== "veterinaria" || !ctx.pode("gestao.gerenciar")) return null;
  return ctx;
}

/**
 * Lê a(s) planilha(s) enviada(s) e mostra o que vai acontecer (nada é gravado
 * aqui). A planilha é lida na memória do servidor do portal e não é guardada.
 */
export async function conferirPlanilhaTutores(empresaId: string, fd: FormData): Promise<ResultadoAcao<ResultadoAnalise>> {
  const ctx = await contextoGerente(empresaId);
  if (!ctx) return falha("Só o responsável pela clínica importa tutores e animais.");
  const arquivos = fd.getAll("arquivo").filter((a): a is File => a instanceof File && a.size > 0);
  if (!arquivos.length) return falha("Escolha a planilha (Excel .xlsx ou .csv).");
  if (arquivos.length > 5) return falha("Envie até 5 arquivos de uma vez.");
  if (arquivos.reduce((s, a) => s + a.size, 0) > LIMITE_BYTES) return falha("As planilhas passam de 2 MB. Divida em partes (ou salve como .xlsx, que é menor).");
  const ruim = arquivos.find((a) => !/\.(xlsx|csv|txt)$/i.test(a.name));
  if (ruim) return falha(/\.xls$/i.test(ruim.name) ? "O formato .xls (Excel antigo) não é aceito. Abra no Excel e salve como .xlsx." : "Envie a planilha em Excel (.xlsx) ou CSV.");

  let mapa: Record<string, CampoImportacao | "ignorar"> = {};
  const mapaBruto = fd.get("mapa");
  if (typeof mapaBruto === "string" && mapaBruto) {
    try {
      const m = JSON.parse(mapaBruto) as unknown;
      if (m && typeof m === "object" && !Array.isArray(m)) mapa = Object.fromEntries(Object.entries(m).filter(([k, v]) => k.length <= 300 && typeof v === "string")) as typeof mapa;
    } catch {
      return falha("Correção das colunas inválida. Envie a planilha de novo.");
    }
  }
  const ddd = String(fd.get("ddd") ?? "").replace(/\D/g, "").slice(0, 2);

  const abas: { arquivo: string; aba: string; linhas: Awaited<ReturnType<typeof lerAbasPlanilha>>[number]["linhas"] }[] = [];
  for (const arquivo of arquivos) {
    try {
      for (const aba of await lerAbasPlanilha(new Uint8Array(await arquivo.arrayBuffer()), arquivo.name)) abas.push({ arquivo: arquivo.name, aba: aba.nome, linhas: aba.linhas });
    } catch (e) {
      return falha(`${arquivo.name}: ${e instanceof Error ? e.message : "não foi possível ler a planilha."}`);
    }
  }

  const [tutores, animais] = await Promise.all([
    buscarTudo((de, ate) => ctx.supabase.from("vet_tutores").select("id, nome, cpf, telefone, telefone2").eq("empresa_id", empresaId).order("id").range(de, ate)),
    buscarTudo((de, ate) => ctx.supabase.from("vet_pacientes").select("tutor_id, nome, microchip").eq("empresa_id", empresaId).order("id").range(de, ate)),
  ]);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
  const r = analisarTutores(abas, { tutores, animais }, { ddd: ddd.length === 2 ? ddd : null, mapa, hoje });
  if (!r.abas.some((a) => a.tipo !== "ignorada")) {
    return falha("Não encontramos os títulos das colunas (ex.: Tutor, Telefone, Animal, Espécie). Confira se a primeira linha da planilha tem os títulos, ou use o modelo.");
  }
  if (!r.tutores.length && !r.linhasComErro.length) return falha("A planilha não tem tutores depois da linha de títulos.");
  if (r.tutores.length > 10000) return falha("Envie até 10.000 tutores por vez (divida a planilha).");
  return sucesso(undefined, r);
}

/** Grava um lote de tutores com os animais (tudo de uma vez: se uma linha falhar, nada do lote muda). */
export async function importarLoteTutores(
  empresaId: string,
  lote: LoteImportacao,
): Promise<ResultadoAcao<{ tutores_novos: number; tutores_existentes: number; animais_novos: number; animais_existentes: number }>> {
  const ctx = await contextoGerente(empresaId);
  if (!ctx) return falha("Só o responsável pela clínica importa tutores e animais.");
  if (!Array.isArray(lote) || !lote.length) return falha("Nenhum tutor para importar.");
  if (lote.length > 500) return falha("Envie até 500 tutores por vez.");
  const { data, error } = await ctx.supabase.rpc("vet_importar_tutores", { p_empresa_id: empresaId, p_tutores: lote as never });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/e/${empresaId}/veterinaria`, "layout");
  return sucesso(undefined, data as { tutores_novos: number; tutores_existentes: number; animais_novos: number; animais_existentes: number });
}
