import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import { categoriaDoXml, lerXmlFiscal } from "@/lib/fiscal/xml";
import { registrarXml, resumoXml } from "@/lib/documentos/processar";
import { competenciaAtual } from "@/lib/competencia";

export type OrigemAutomatica = "sefaz" | "adn";

const ROTULO_ORIGEM: Record<OrigemAutomatica, string> = {
  sefaz: "Obtido automaticamente na SEFAZ (Ambiente Nacional da NF-e).",
  adn: "Obtido automaticamente no Ambiente de Dados Nacional da NFS-e.",
};

function competenciaDe(data: string | null | undefined) {
  return data && /^\d{4}-\d{2}/.test(data) ? `${data.slice(0, 7)}-01` : competenciaAtual();
}

/**
 * Guarda um XML obtido da SEFAZ ou do Ambiente Nacional como documento da
 * empresa (mesmo caminho dos XML enviados pelo cliente: leitura, registro
 * fiscal, sugestões) e devolve o documento. Se a nota ou o evento já estiver
 * no portal (enviado pelo cliente, por exemplo), não duplica. Nota ou evento
 * de mês anterior ao mês inicial da busca (`desde`, AAAA-MM-01) é ignorado:
 * nada é guardado.
 */
export async function importarXmlAutomatico(
  admin: ClienteAdmin,
  p: { empresaId: string; documentoEmpresa: string; xml: string; nome: string; origem: OrigemAutomatica; categoriaPadrao: string; desde?: string | null },
): Promise<{ situacao: "importado" | "ja_existia" | "ignorado"; documentoId: string | null; chave: string | null; competencia: string }> {
  const lido = lerXmlFiscal(p.xml, { documento: p.documentoEmpresa });
  const chave = lido.sucesso ? lido.dados.chave_acesso : null;
  const comp = competenciaDe(lido.sucesso ? (lido.dados.tipo === "evento" ? lido.dados.data_evento : lido.dados.data_emissao) : null);
  if (lido.sucesso) {
    const tabela = lido.dados.tipo === "evento" ? "documento_fiscal_eventos" : "documentos_fiscais";
    const { data: existente } = await admin
      .from(tabela)
      .select("documento_id")
      .eq("empresa_id", p.empresaId)
      .eq("identificador", lido.dados.identificador)
      .maybeSingle();
    if (existente) return { situacao: "ja_existia", documentoId: existente.documento_id ?? null, chave, competencia: comp };
    if (p.desde && comp < p.desde) return { situacao: "ignorado", documentoId: null, chave, competencia: comp };
  }

  const bytes = Buffer.from(p.xml, "utf8");
  const id = randomUUID();
  const nome = p.nome.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-120);
  const caminho = `${p.empresaId}/${comp.slice(0, 7)}/${id}/v1-${nome}`;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { error: erroUp } = await admin.storage.from("documentos").upload(caminho, bytes, { contentType: "application/xml", upsert: false });
  if (erroUp) throw new Error(`Falha ao gravar ${nome}: ${erroUp.message}`);
  const agora = new Date().toISOString();
  const { error: erroDoc } = await admin.from("documentos").insert({
    id,
    empresa_id: p.empresaId,
    direcao: "cliente",
    competencia: comp,
    categoria_codigo: (lido.sucesso ? categoriaDoXml(lido.dados) : null) ?? p.categoriaPadrao,
    nome_original: nome,
    extensao: "xml",
    mime: "application/xml",
    tamanho: bytes.length,
    sha256: hash,
    versao_atual: 1,
    storage_path: caminho,
    upload_status: "concluido",
    status: "recebido",
    origem: "automatica",
    verificacao_status: "ok",
    verificacao_detalhes: ROTULO_ORIGEM[p.origem],
    enviado_por: null,
    enviado_em: agora,
    processamento_status: "processando",
  });
  if (erroDoc) {
    await admin.storage.from("documentos").remove([caminho]);
    throw new Error(`Falha ao registrar ${nome}: ${erroDoc.message}`);
  }
  await admin.from("documento_versoes").insert({
    documento_id: id,
    empresa_id: p.empresaId,
    versao: 1,
    storage_path: caminho,
    nome_original: nome,
    mime: "application/xml",
    tamanho: bytes.length,
    sha256: hash,
    enviado_por: null,
    upload_concluido_em: agora,
    verificacao_status: "ok",
    verificacao_detalhes: ROTULO_ORIGEM[p.origem],
  });

  if (!lido.sucesso) {
    await admin
      .from("documentos")
      .update({ processamento_status: "concluido", processamento_detalhes: { leitura: lido.motivo, mensagem: lido.mensagem }, requer_conferencia: true })
      .eq("id", id);
    return { situacao: "importado", documentoId: id, chave: null, competencia: comp };
  }
  const registro = await registrarXml(admin, id, lido.dados);
  await admin
    .from("documentos")
    .update({
      processamento_status: "concluido",
      processamento_detalhes: { ...resumoXml(lido.dados), registro, origem: p.origem },
      requer_conferencia: registro.situacao.includes("duplicado") || (lido.dados.tipo === "nota" && !lido.dados.relacionado_empresa),
      duplicado_de: registro.documento_original_id && registro.documento_original_id !== id ? registro.documento_original_id : null,
    })
    .eq("id", id);
  return { situacao: "importado", documentoId: id, chave, competencia: comp };
}
