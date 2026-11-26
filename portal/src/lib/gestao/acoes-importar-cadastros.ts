"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerAbasPlanilha } from "@/lib/gestao/planilha-produtos";
import { analisarCadastros, CAMPOS_CADASTRO, type AnaliseCadastros, type CadastroParaImportar, type MapaColunas } from "@/lib/gestao/planilha-cadastros";
import { semAcento } from "@/lib/veterinaria/planilha-tutores";
import { buscarTudo } from "@/lib/supabase/paginar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// As ações do servidor aceitam até 2 MB por envio (next.config)
const LIMITE_BYTES = 1.9 * 1024 * 1024;
const CAMPOS = new Set<string>(CAMPOS_CADASTRO.map((c) => c.chave));

type Papel = "cliente" | "fornecedor";

/** Só quem gerencia a loja importa (o banco confere de novo). */
async function contextoGerente(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.loja || !ctx.pode("gestao.gerenciar")) return null;
  return ctx;
}

/**
 * Lê a planilha e mostra o que vai acontecer (nada é gravado aqui). A planilha
 * é lida na memória do servidor do portal e não é guardada.
 */
export async function conferirPlanilhaCadastros(empresaId: string, papel: Papel, fd: FormData): Promise<ResultadoAcao<AnaliseCadastros>> {
  const ctx = await contextoGerente(empresaId);
  if (!ctx || !["cliente", "fornecedor"].includes(papel)) return falha("Só quem gerencia a loja importa clientes e fornecedores.");
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha a planilha (Excel .xlsx ou .csv).");
  if (arquivo.size > LIMITE_BYTES) return falha("A planilha passa de 2 MB. Divida em partes (ou salve como .xlsx, que é menor).");
  if (!/\.(xlsx|csv|txt)$/i.test(arquivo.name)) {
    return falha(/\.xls$/i.test(arquivo.name) ? "O formato .xls (Excel antigo) não é aceito. Abra no Excel e salve como .xlsx." : "Envie a planilha em Excel (.xlsx) ou CSV.");
  }
  let mapa: MapaColunas = {};
  const mapaBruto = fd.get("mapa");
  if (typeof mapaBruto === "string" && mapaBruto) {
    try {
      const m = JSON.parse(mapaBruto) as unknown;
      if (m && typeof m === "object" && !Array.isArray(m)) {
        mapa = Object.fromEntries(
          Object.entries(m).filter(([k, v]) => k.length <= 300 && typeof v === "string" && (v === "ignorar" || CAMPOS.has(v))),
        ) as MapaColunas;
      }
    } catch {
      return falha("Correção das colunas inválida. Envie a planilha de novo.");
    }
  }
  const ddd = String(fd.get("ddd") ?? "").replace(/\D/g, "").slice(0, 2);

  let abas;
  try {
    abas = await lerAbasPlanilha(new Uint8Array(await arquivo.arrayBuffer()), arquivo.name);
  } catch (e) {
    return falha(`${arquivo.name}: ${e instanceof Error ? e.message : "não foi possível ler a planilha."}`);
  }

  const [cadastros, municipios, { data: empresa }] = await Promise.all([
    buscarTudo((de, ate) => ctx.supabase.from("contrapartes").select("nome, documento").eq("empresa_id", empresaId).order("id").range(de, ate)),
    buscarTudo((de, ate) => ctx.supabase.from("municipios").select("ibge, nome, uf").order("ibge").range(de, ate), 10_000),
    ctx.supabase.from("empresas").select("uf").eq("id", empresaId).maybeSingle(),
  ]);
  const documentos = new Map<string, string>();
  const nomes = new Set<string>();
  for (const c of cadastros) {
    if (c.documento) documentos.set(c.documento, c.nome);
    else nomes.add(semAcento(c.nome));
  }
  // Cidade + UF → código do IBGE (sem UF: a da empresa; depois, nome único no país)
  const porCidadeUf = new Map<string, string>();
  const porCidade = new Map<string, string | null>();
  for (const m of municipios) {
    const n = semAcento(m.nome);
    porCidadeUf.set(`${n}|${m.uf}`, m.ibge);
    porCidade.set(n, porCidade.has(n) ? null : m.ibge);
  }
  const ufEmpresa = empresa?.uf ?? null;
  const municipio = (cidade: string, uf: string | null) => {
    const n = semAcento(cidade.replace(/\s*[-/]\s*[A-Za-z]{2}$/, ""));
    if (uf) return porCidadeUf.get(`${n}|${uf}`) ?? null;
    return (ufEmpresa ? porCidadeUf.get(`${n}|${ufEmpresa}`) : null) ?? porCidade.get(n) ?? null;
  };

  const r = analisarCadastros(abas, { documentos, nomes }, { papel, mapa, ddd: ddd.length === 2 ? ddd : null, municipio });
  if (!r) return falha("Não encontramos a coluna do nome (ex.: Nome, Razão social, Cliente). Confira se a planilha tem a linha de títulos, ou use o modelo.");
  if (!r.linhas.length) return falha("A planilha não tem cadastros depois da linha de títulos.");
  if (r.linhas.length > 10_000) return falha("Envie até 10.000 cadastros por vez (divida a planilha).");
  return sucesso(undefined, r);
}

/** Grava um lote (tudo de uma vez: se algo inesperado falhar, nada do lote muda). */
export async function importarLoteCadastros(
  empresaId: string,
  papel: Papel,
  lote: CadastroParaImportar[],
): Promise<ResultadoAcao<{ novos: number; atualizados: number; ignorados: number }>> {
  const ctx = await contextoGerente(empresaId);
  if (!ctx || !["cliente", "fornecedor"].includes(papel)) return falha("Só quem gerencia a loja importa clientes e fornecedores.");
  if (!Array.isArray(lote) || !lote.length) return falha("Nenhum cadastro para importar.");
  if (lote.length > 500) return falha("Envie até 500 cadastros por vez.");
  const { data, error } = await ctx.supabase.rpc("gestao_importar_contrapartes", { p_empresa_id: empresaId, p_papel: papel, p_linhas: lote as never });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/e/${empresaId}/loja`, "layout");
  revalidatePath(`/e/${empresaId}/financeiro/cadastros`);
  return sucesso(undefined, data as { novos: number; atualizados: number; ignorados: number });
}
