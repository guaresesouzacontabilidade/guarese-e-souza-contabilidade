"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";
import { lerXmlFiscal } from "@/lib/fiscal/xml";
import { decodificarTexto } from "@/lib/extratos/comum";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { importarXmlAutomatico } from "@/lib/notas-automaticas/importar";
import { DanfeIlegivel, lerDanfePdf } from "./danfe-pdf";
import type { Json } from "@/lib/supabase/database.types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// O limite das ações do servidor é 2 MB (o XML de uma nota tem poucos KB; o DANFE, algumas centenas)
const TAMANHO_MAXIMO = 1_900_000;

export interface ProdutoImportado {
  produto_id: string;
  produto: string;
  item: string;
  /** Como o item foi ligado ao produto: vínculo do fornecedor, código de barras, mesma descrição ou produto novo. */
  modo: "vinculo" | "gtin" | "descricao" | "novo";
  quantidade: number;
  unidade: string;
  custo: number;
  preco_venda: number | null;
  controla_estoque: boolean;
}

export interface ResultadoImportacao {
  situacao: "lancada" | "ja_lancada" | "conferir";
  origem: "xml" | "pdf";
  numero: string | null;
  fornecedor: string | null;
  itens?: number;
  produtos_novos?: number;
  produtos?: ProdutoImportado[];
  motivos?: string[];
  /** Nota registrada pelo XML (para abrir a conferência item a item). */
  documento_fiscal_id: string | null;
}

function documentoLimpo(d: string | null | undefined) {
  return (d ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * Entrada de mercadorias pela nota de compra: recebe o XML ou o PDF (DANFE),
 * lê a nota e lança todos os itens no estoque de uma vez (o banco escolhe o
 * produto de cada item ou cria o produto novo, tudo ou nada). O XML também
 * fica guardado nos documentos da empresa, como se tivesse sido enviado em
 * "Enviar documentos" — o escritório recebe a nota. O PDF é lido aqui mesmo,
 * no servidor do portal, e não é guardado.
 */
export async function importarNotaEstoque(empresaId: string, fd: FormData): Promise<ResultadoAcao<ResultadoImportacao>> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
  if (!ctx.acesso.loja) return falha("A gestão da loja não está ligada para esta empresa. Fale com o escritório.");
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha o arquivo da nota (XML ou PDF).");
  if (arquivo.size > TAMANHO_MAXIMO) return falha("Arquivo grande demais (até 1,9 MB). Se for o PDF, tente enviar o XML da nota, que é bem menor.");
  const textoMargem = String(fd.get("margem") ?? "").replace("%", "").trim();
  let margem: string | null = null;
  if (textoMargem) {
    const d = lerValorBR(textoMargem);
    if (!d || d.lt(0) || d.gt(1000)) return falha("Margem de lucro inválida (de 0 a 1.000%).", { margem: ["Use de 0 a 1.000%."] });
    margem = d.toString();
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const inicio = new TextDecoder("latin1").decode(bytes.slice(0, 400));
  const ehPdf = inicio.startsWith("%PDF");
  const ehXml = !ehPdf && /^(\xEF\xBB\xBF)?\s*</.test(inicio);
  if (!ehPdf && !ehXml) return falha("Envie o XML ou o PDF (DANFE) da nota de compra.");
  const documentoEmpresa = documentoLimpo(ctx.acesso.documento);
  const admin = criarClienteAdmin();
  let documentoFiscalId: string | null = null;
  let pdf: Json | null = null;

  if (ehXml) {
    const texto = decodificarTexto(bytes, /encoding="(iso-8859-1|windows-1252)"/i.exec(inicio)?.[1]);
    const lido = lerXmlFiscal(texto, { documento: documentoEmpresa });
    if (!lido.sucesso) return falha(`Não consegui ler este XML: ${lido.mensagem}`);
    const n = lido.dados;
    if (n.tipo !== "nota" || !["55", "65"].includes(n.modelo)) return falha("Este XML não é de uma NF-e de compra. Envie o XML da nota do fornecedor.");
    if (!n.relacionado_empresa) {
      return falha(`Esta nota não é desta empresa (destinatário: ${n.destinatario_nome ?? formatarDocumento(n.destinatario_documento) ?? "outro"}).`);
    }
    if (n.operacao !== "entrada") return falha("Esta é uma nota emitida pela empresa (venda), não uma nota de compra. Envie a nota do fornecedor.");
    await importarXmlAutomatico(admin, {
      empresaId,
      documentoEmpresa,
      xml: texto,
      nome: arquivo.name || "nota.xml",
      origem: "estoque",
      categoriaPadrao: "nfe_entrada_xml",
      enviadoPor: ctx.sessao.usuarioId,
    });
    const { data: registro } = await admin
      .from("documentos_fiscais")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("identificador", n.identificador)
      .maybeSingle();
    if (!registro) return falha("Não consegui registrar esta nota. Tente de novo ou envie o arquivo em Enviar documentos.");
    documentoFiscalId = registro.id;
  } else {
    let lido;
    try {
      lido = await lerDanfePdf(bytes, { documentoEmpresa });
    } catch (e) {
      if (e instanceof DanfeIlegivel) return falha(e.message);
      throw e;
    }
    if (lido.emitente_documento === documentoEmpresa) {
      return falha("Esta nota foi emitida pela própria empresa. Para dar entrada, envie o XML da nota.");
    }
    if (!lido.empresa_no_documento) {
      return falha("O CNPJ desta empresa não aparece no PDF: a nota parece ser de outra empresa. Confira o arquivo.");
    }
    if (lido.problemas.length) {
      // Se o XML desta nota (com os itens) já está no portal, ele é usado e a leitura do PDF não importa
      const { data: noPortal } = await admin
        .from("documentos_fiscais")
        .select("id, documento_fiscal_itens!inner(id)")
        .eq("empresa_id", empresaId)
        .eq("chave_acesso", lido.chave)
        .eq("modelo", "55")
        .limit(1);
      if (!noPortal?.length) {
        return falha(
          `Não consegui ler esta nota com segurança pelo PDF: ${lido.problemas.slice(0, 3).join("; ")}. Para não lançar errado, nada foi gravado — envie o XML da nota.`,
        );
      }
    }
    pdf = {
      chave: lido.chave,
      numero: lido.numero,
      serie: lido.serie,
      emitente_documento: lido.emitente_documento,
      emitente_nome: lido.emitente_nome,
      data_emissao: lido.data_emissao,
      valor_total: lido.valor_total,
      itens: lido.itens.map((i) => ({ ...i })),
    } as unknown as Json;
  }

  const { data, error } = await ctx.supabase.rpc("gestao_importar_nota", {
    p_empresa_id: empresaId,
    p_documento_fiscal_id: documentoFiscalId as unknown as string,
    p_pdf: pdf as Json,
    p_margem: margem as unknown as number,
  });
  if (error) return falha(mensagemErro(error));
  const r = data as unknown as ResultadoImportacao;
  revalidatePath(`/e/${empresaId}/loja`, "layout");
  const nota = `Nota ${r.numero ?? ""}${r.fornecedor ? ` de ${r.fornecedor}` : ""}`;
  if (r.situacao === "ja_lancada") return sucesso(`${nota} já tinha dado entrada no estoque. Nada foi lançado de novo.`, r);
  if (r.situacao === "conferir") return sucesso(`${nota}: falta informação para lançar sozinho. Nada foi gravado.`, r);
  return sucesso(`${nota}: ${r.itens} item(ns) lançado(s) no estoque${r.produtos_novos ? `, ${r.produtos_novos} produto(s) novo(s) cadastrado(s)` : ""}.`, r);
}
