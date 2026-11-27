import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import { decodificarTexto } from "@/lib/extratos/comum";
import { lerSped } from "./leitura";

/**
 * Arquivo do SPED recebido em Documentos: lê a EFD ICMS/IPI, guarda as notas
 * escrituradas (C100) e confere com os XML do portal. A EFD-Contribuições é
 * reconhecida e guardada para a leitura futura. Nada é transmitido.
 */

const LOTE = 2000;

type Doc = { id: string; empresa_id: string; direcao: string; competencia: string; categoria_codigo: string };

function competenciaDe(data: string) {
  return `${data.slice(0, 7)}-01`;
}

export async function processarSped(admin: ClienteAdmin, doc: Doc, versao: number, bytes: Uint8Array, nome: string) {
  const texto = decodificarTexto(bytes);
  const lido = lerSped(texto);
  const sugestao: Record<string, unknown> = {};
  if (doc.direcao === "cliente" && doc.categoria_codigo !== "sped_fiscal") sugestao.categoria = "sped_fiscal";

  if (!lido.ok) {
    let arquivoId: string | null = null;
    if (lido.cabecalho) {
      const { data, error } = await admin.rpc("sped_registrar_arquivo", {
        p_documento_id: doc.id,
        p_versao: versao,
        p_nome: nome,
        p_cabecalho: lido.cabecalho as never,
        p_situacao: "nao_suportado",
        p_erro: lido.mensagem,
      });
      if (error) throw new Error(`Falha ao registrar o arquivo do SPED: ${error.message}`);
      arquivoId = data as string;
      const comp = competenciaDe(lido.cabecalho.inicio);
      if (comp !== doc.competencia) sugestao.competencia = comp;
    }
    await admin
      .from("documentos")
      .update({
        processamento_status: "concluido",
        processamento_detalhes: { tipo: "sped", leitura: lido.motivo, mensagem: lido.mensagem, arquivo_id: arquivoId },
        sugestao: Object.keys(sugestao).length ? { ...sugestao, motivo: "Conforme o conteúdo do arquivo do SPED" } : null,
        requer_conferencia: lido.motivo === "nao_e_sped" || Object.keys(sugestao).length > 0,
      })
      .eq("id", doc.id);
    return { sped: lido.motivo };
  }

  const dados = lido.dados;
  const { documentos, analitico, apuracao, registros, avisos, ...cabecalho } = dados;
  const { data: empresa } = await admin.from("empresas").select("documento").eq("id", doc.empresa_id).single();
  const cnpjEmpresa = (empresa?.documento ?? "").replace(/\D/g, "");
  const outroCnpj = Boolean(dados.cnpj && cnpjEmpresa && dados.cnpj.slice(0, 8) !== cnpjEmpresa.slice(0, 8));
  const { data: id, error } = await admin.rpc("sped_registrar_arquivo", {
    p_documento_id: doc.id,
    p_versao: versao,
    p_nome: nome,
    p_cabecalho: cabecalho as never,
    p_situacao: outroCnpj ? "erro" : "processando",
    p_erro: outroCnpj ? `O arquivo é do CNPJ ${dados.cnpj}, de outra empresa. Envie o SPED na empresa certa.` : undefined,
  });
  if (error || !id) throw new Error(`Falha ao registrar o arquivo do SPED: ${error?.message}`);
  const comp = competenciaDe(dados.inicio);
  if (comp !== doc.competencia) sugestao.competencia = comp;

  if (outroCnpj) {
    await admin
      .from("documentos")
      .update({
        processamento_status: "concluido",
        processamento_detalhes: { tipo: "sped", leitura: "outra_empresa", arquivo_id: id, cnpj: dados.cnpj },
        requer_conferencia: true,
      })
      .eq("id", doc.id);
    return { sped: "outra_empresa" };
  }

  for (let i = 0; i < documentos.length; i += LOTE) {
    const { error: e2 } = await admin.rpc("sped_gravar_documentos", { p_arquivo_id: id as string, p_documentos: documentos.slice(i, i + LOTE) as never });
    if (e2) throw new Error(`Falha ao gravar as notas do SPED: ${e2.message}`);
  }
  const { data: resumo, error: e3 } = await admin.rpc("sped_concluir", {
    p_arquivo_id: id as string,
    p_totais: { registros, analitico, apuracao } as never,
    p_avisos: avisos as never,
  });
  if (e3) throw new Error(`Falha ao conferir o SPED: ${e3.message}`);

  await admin
    .from("documentos")
    .update({
      processamento_status: "concluido",
      processamento_detalhes: {
        tipo: "sped",
        leitura: "efd_icms_ipi",
        arquivo_id: id,
        periodo: `${dados.inicio} a ${dados.fim}`,
        notas: documentos.length,
      },
      sugestao: Object.keys(sugestao).length ? { ...sugestao, motivo: "Conforme o conteúdo do arquivo do SPED" } : null,
      requer_conferencia: Object.keys(sugestao).length > 0,
    })
    .eq("id", doc.id);
  return { sped: "conferido", notas: documentos.length, resumo };
}
