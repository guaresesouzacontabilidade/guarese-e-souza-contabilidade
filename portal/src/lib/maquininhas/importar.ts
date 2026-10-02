import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { Decimal } from "@/lib/dinheiro";
import { lerArquivoPlanilha } from "@/lib/extratos/planilha";
import { amostraDoRelatorio, assinaturaCabecalho, detectarCabecalho, lerVendas, localizarCabecalho, type MapeamentoMaquininha } from "./leitura";
import type { TipoAdquirente } from "./rotulos";

/**
 * Relatórios de vendas das maquininhas.
 *  - registrarRelatorio: chamado pelo processador de documentos quando chega um
 *    CSV/Excel da categoria "Relatórios de maquininhas". Guarda o cabeçalho e
 *    algumas linhas de exemplo; se o formato já é conhecido, a importação entra
 *    na fila; se não, fica aguardando a conferência das colunas.
 *  - importarMaquininha (tarefa "importar_maquininha"): lê todas as vendas,
 *    grava sem duplicar e confere cada uma com a taxa do contrato.
 * Nada é enviado para fora do portal.
 */

const LOTE = 1000;

export async function registrarRelatorio(
  admin: ClienteAdmin,
  doc: { id: string },
  versao: number,
  bytes: Uint8Array,
  nome: string,
): Promise<{ importacao_id: string; situacao: string; linhas: number }> {
  const linhas = await lerArquivoPlanilha(bytes, nome);
  let linhaCabecalho = detectarCabecalho(linhas);
  // Cabeçalho com nomes que o portal não reconhece: a primeira linha com várias colunas preenchidas
  // (quem conferir as colunas diz o que é cada uma)
  if (linhaCabecalho < 0) linhaCabecalho = Math.max(0, linhas.findIndex((l) => l.filter((c) => String(c ?? "").trim()).length >= 3));
  const cabecalho = (linhas[linhaCabecalho] ?? []).slice(0, 60).map((c) => String(c ?? "").slice(0, 120));
  const assinatura = assinaturaCabecalho(cabecalho);
  const { data, error } = await admin.rpc("maquininha_registrar_relatorio", {
    p_documento_id: doc.id,
    p_versao: versao,
    p_nome: nome,
    p_assinatura: assinatura.length >= 3 ? assinatura : `sem-cabecalho:${cabecalho.length}`,
    p_cabecalho: cabecalho as never,
    p_amostra: amostraDoRelatorio(linhas, linhaCabecalho) as never,
    p_linhas: Math.max(0, linhas.length - linhaCabecalho - 1),
  });
  if (error) throw new Error(`Falha ao registrar o relatório da maquininha: ${error.message}`);
  const r = data as { importacao_id: string; situacao: string };
  return { ...r, linhas: linhas.length };
}

interface Importacao {
  id: string;
  empresa_id: string;
  documento_id: string | null;
  versao: number | null;
  nome_arquivo: string | null;
  situacao: string;
  tipo: string | null;
  adquirente_chave: string | null;
  assinatura: string | null;
  mapeamento: MapeamentoMaquininha | null;
}

async function falhar(admin: ClienteAdmin, id: string, erro: string) {
  await admin.from("maquininha_importacoes").update({ situacao: "erro", erro: erro.slice(0, 1000) }).eq("id", id);
  return { erro };
}

export async function importarMaquininha(admin: ClienteAdmin, job: Job) {
  const { importacao_id } = (job.payload ?? {}) as { importacao_id?: string };
  if (!importacao_id) return { ignorado: "sem relatório" };
  const { data: imp } = await admin
    .from("maquininha_importacoes")
    .select("id, empresa_id, documento_id, versao, nome_arquivo, situacao, tipo, adquirente_chave, assinatura, mapeamento")
    .eq("id", importacao_id)
    .maybeSingle<Importacao>();
  if (!imp) return { ignorado: "relatório excluído" };
  if (!["na_fila", "importando", "erro"].includes(imp.situacao)) return { ignorado: `situação ${imp.situacao}` };
  if (!imp.mapeamento || !imp.adquirente_chave) return falhar(admin, imp.id, "Confira as colunas e a adquirente do relatório antes de importar.");
  if (!imp.documento_id) return falhar(admin, imp.id, "O arquivo do relatório foi excluído.");
  const pronto = { ...imp, mapeamento: imp.mapeamento, documento_id: imp.documento_id };

  await admin.from("maquininha_importacoes").update({ situacao: "importando", erro: null }).eq("id", imp.id);
  try {
    return await importar(admin, pronto);
  } catch (e) {
    // Falha no meio: o relatório não fica preso em "importando"
    const mensagem = e instanceof Error ? e.message : String(e);
    const { data: ainda } = await admin.from("maquininha_importacoes").select("id").eq("id", imp.id).maybeSingle();
    if (!ainda) return { ignorado: "relatório excluído durante a importação" };
    const novaTentativa = job.tentativas < job.max_tentativas;
    await falhar(
      admin,
      imp.id,
      novaTentativa ? `Falha temporária (o portal tenta de novo em alguns minutos): ${mensagem}` : `Não foi possível importar: ${mensagem}. Use "Importar de novo".`,
    );
    throw e;
  }
}

async function importar(admin: ClienteAdmin, imp: Importacao & { mapeamento: MapeamentoMaquininha; documento_id: string }) {
  const { data: versao } = await admin
    .from("documento_versoes")
    .select("storage_path, nome_original, upload_concluido_em")
    .eq("documento_id", imp.documento_id)
    .eq("versao", imp.versao ?? 1)
    .maybeSingle();
  if (!versao?.upload_concluido_em) return falhar(admin, imp.id, "O arquivo do relatório não está disponível.");
  const { data: arquivo, error: erroArquivo } = await admin.storage.from("documentos").download(versao.storage_path);
  if (erroArquivo || !arquivo) throw new Error(`Não foi possível ler o relatório no armazenamento: ${erroArquivo?.message ?? "sem dados"}`);

  let linhas: string[][];
  try {
    linhas = await lerArquivoPlanilha(new Uint8Array(await arquivo.arrayBuffer()), versao.nome_original);
  } catch (e) {
    return falhar(admin, imp.id, e instanceof Error ? e.message : String(e));
  }
  const linhaCabecalho = localizarCabecalho(linhas, imp.assinatura);
  const mapeamento: MapeamentoMaquininha = { ...imp.mapeamento, linhaCabecalho: linhaCabecalho >= 0 ? linhaCabecalho : imp.mapeamento.linhaCabecalho };
  const lido = lerVendas(linhas, mapeamento, (imp.tipo as TipoAdquirente | null) ?? null);
  if (!lido.vendas.length) {
    const motivo = lido.invalidas[0]?.motivo;
    return falhar(admin, imp.id, `Nenhuma venda reconhecida no relatório${motivo ? ` (exemplo: linha ${lido.invalidas[0].linha} — ${motivo})` : ""}. Confira as colunas.`);
  }

  // Leitura anterior deste mesmo relatório (colunas corrigidas): começa do zero
  await admin.from("maquininha_vendas").delete().eq("importacao_id", imp.id);
  let novas = 0;
  let atualizadas = 0;
  for (let i = 0; i < lido.vendas.length; i += LOTE) {
    const { data, error } = await admin.rpc("maquininha_gravar_vendas", { p_importacao_id: imp.id, p_vendas: lido.vendas.slice(i, i + LOTE) as never });
    if (error) throw new Error(`Falha ao gravar as vendas: ${error.message}`);
    const r = data as { novas: number; atualizadas: number };
    novas += r.novas;
    atualizadas += r.atualizadas;
  }

  const aprovadas = lido.vendas.filter((v) => v.situacao === "aprovada");
  const datas = lido.vendas.map((v) => v.data_venda).sort();
  const soma = (campo: "valor_bruto" | "valor_taxa") => aprovadas.reduce((s, v) => s.plus(v[campo]), new Decimal(0)).toFixed(2);
  const { data: conclusao, error } = await admin.rpc("maquininha_concluir_importacao", {
    p_importacao_id: imp.id,
    p_resumo: {
      periodo_inicio: datas[0],
      periodo_fim: datas[datas.length - 1],
      vendas: aprovadas.length,
      duplicadas: atualizadas,
      canceladas: lido.vendas.length - aprovadas.length,
      invalidas: lido.invalidas.length,
      total_bruto: soma("valor_bruto"),
      total_taxas: soma("valor_taxa"),
      erros: lido.invalidas.slice(0, 50),
    } as never,
  });
  if (error) throw new Error(`Falha ao concluir a importação: ${error.message}`);
  return { vendas: lido.vendas.length, novas, atualizadas, invalidas: lido.invalidas.length, conferencia: conclusao };
}
