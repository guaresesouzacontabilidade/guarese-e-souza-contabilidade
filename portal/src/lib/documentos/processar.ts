import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { verificarConteudo, extensaoDe, mimeDe } from "@/lib/arquivos/tipos";
import { verificarAntivirus } from "@/lib/arquivos/antivirus";
import { extrairZipSeguro, ErroZip } from "@/lib/arquivos/zip";
import { lerXmlFiscal, categoriaDoXml, type NotaLida, type EventoLido } from "@/lib/fiscal/xml";
import { lerOfx, ehOfx } from "@/lib/extratos/ofx";
import { ehSped } from "@/lib/sped/leitura";
import { lerArquivoPlanilha, sugerirMapeamento, aplicarMapeamento } from "@/lib/extratos/planilha";
import { decodificarTexto } from "@/lib/extratos/comum";
import { envServidor } from "@/lib/env-servidor";

/**
 * Processamento de um documento recebido (executado em segundo plano):
 *  1. confere a integridade (SHA-256), o tipo real do conteúdo e, se
 *     configurado, o antivírus — arquivos suspeitos são bloqueados;
 *  2. lê o conteúdo conforme o tipo: XML fiscal, ZIP de XMLs, OFX, planilha,
 *     PDF/imagem (OCR, quando disponível);
 *  3. registra sugestões de categoria/competência e dados extraídos, que
 *     ficam sujeitos à conferência humana.
 * Nenhum lançamento financeiro definitivo é criado aqui.
 */

const LOTE_ZIP = 150;
const TEMPO_MAX_MS = 40_000;

interface Payload {
  documento_id: string;
  versao_id?: string;
  reprocessar?: boolean;
  zip_inicio?: number;
}

type Documento = {
  id: string;
  empresa_id: string;
  direcao: string;
  competencia: string;
  categoria_codigo: string;
  nome_original: string;
  extensao: string | null;
  versao_atual: number;
  excluido_em: string | null;
  enviado_por: string | null;
  sha256: string | null;
};

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function competenciaDe(data: string | null | undefined) {
  return data && /^\d{4}-\d{2}/.test(data) ? `${data.slice(0, 7)}-01` : null;
}

async function baixar(admin: ClienteAdmin, caminho: string) {
  const { data, error } = await admin.storage.from("documentos").download(caminho);
  if (error || !data) throw new Error(`Não foi possível ler o arquivo no armazenamento: ${error?.message ?? "sem dados"}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function processarDocumento(admin: ClienteAdmin, job: Job) {
  const p = job.payload as unknown as Payload;
  const { data: doc } = await admin
    .from("documentos")
    .select("id, empresa_id, direcao, competencia, categoria_codigo, nome_original, extensao, versao_atual, excluido_em, enviado_por, sha256")
    .eq("id", p.documento_id)
    .maybeSingle<Documento>();
  if (!doc || doc.excluido_em) return { ignorado: "documento inexistente ou excluído" };

  const versaoQuery = admin.from("documento_versoes").select("id, versao, storage_path, nome_original, sha256, upload_concluido_em");
  const { data: versao } = p.versao_id
    ? await versaoQuery.eq("id", p.versao_id).maybeSingle()
    : await versaoQuery.eq("documento_id", doc.id).eq("versao", doc.versao_atual).maybeSingle();
  if (!versao?.upload_concluido_em) return { ignorado: "versão sem envio concluído" };
  if (versao.versao !== doc.versao_atual) return { ignorado: "versão substituída" };

  await admin.from("documentos").update({ processamento_status: "processando" }).eq("id", doc.id);
  const bytes = await baixar(admin, versao.storage_path);

  // ---------------------------------------------------------------- segurança
  if (!p.zip_inicio) {
    const hash = sha256(bytes);
    if (versao.sha256 && hash !== versao.sha256) {
      await admin.rpc("sistema_bloquear_documento", {
        p_documento_id: doc.id,
        p_versao_id: versao.id,
        p_motivo: "o conteúdo recebido não corresponde à assinatura (SHA-256) calculada no envio.",
      });
      return { bloqueado: "sha256" };
    }
    const verificacao = verificarConteudo(versao.nome_original, bytes);
    if (!verificacao.ok) {
      await admin.rpc("sistema_bloquear_documento", { p_documento_id: doc.id, p_versao_id: versao.id, p_motivo: verificacao.motivo ?? "conteúdo inválido." });
      return { bloqueado: verificacao.motivo };
    }
    const av = await verificarAntivirus(bytes);
    if (av.status === "infectado") {
      await admin.rpc("sistema_bloquear_documento", { p_documento_id: doc.id, p_versao_id: versao.id, p_motivo: `ameaça detectada pelo antivírus (${av.assinatura}).` });
      return { bloqueado: "antivirus" };
    }
    const detalheAv =
      av.status === "limpo" ? "Antivírus: nenhuma ameaça encontrada." : av.status === "nao_configurado" ? "Antivírus não configurado." : `Antivírus indisponível: ${av.erro}`;
    await admin.from("documento_versoes").update({ verificacao_status: "ok", verificacao_detalhes: detalheAv }).eq("id", versao.id);
    await admin.from("documentos").update({ verificacao_status: "ok", verificacao_detalhes: detalheAv }).eq("id", doc.id);
  }

  const ext = extensaoDe(versao.nome_original);
  const { data: empresa } = await admin.from("empresas").select("documento").eq("id", doc.empresa_id).single();
  const referencia = { documento: empresa?.documento ?? "" };

  try {
    if (ext === "zip") return await processarZip(admin, doc, bytes, referencia, p.zip_inicio ?? 0);
    if (ext === "xml") return await processarXml(admin, doc, bytes, referencia);
    if (ext === "txt" && (doc.categoria_codigo === "sped_fiscal" || ehSped(new TextDecoder("latin1").decode(bytes.slice(0, 20))))) {
      const { processarSped } = await import("@/lib/sped/processar");
      return await processarSped(admin, doc, versao.versao, bytes, versao.nome_original);
    }
    if (ext === "ofx" || (ext === "txt" && ehOfx(new TextDecoder("latin1").decode(bytes.slice(0, 2000))))) return await processarOfx(admin, doc, bytes);
    if (["csv", "xlsx"].includes(ext) && doc.categoria_codigo === "relatorio_maquininha") {
      return await processarRelatorioMaquininha(admin, doc, versao.versao, bytes, versao.nome_original);
    }
    if (["csv", "xlsx"].includes(ext) && ["extrato_bancario", "extrato_cartao"].includes(doc.categoria_codigo)) {
      return await processarPlanilha(admin, doc, bytes, versao.nome_original);
    }
    if (["pdf", "jpg", "jpeg", "png", "webp"].includes(ext)) return await processarImagemOuPdf(admin, doc, bytes, ext);
    await admin.from("documentos").update({ processamento_status: "nao_aplicavel" }).eq("id", doc.id);
    return { processado: "sem leitura automática para este formato" };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await admin
      .from("documentos")
      .update({ processamento_status: "erro", processamento_detalhes: { erro: mensagem }, requer_conferencia: true })
      .eq("id", doc.id);
    if (e instanceof ErroZip) return { erro: mensagem };
    throw e;
  }
}

export async function registrarXml(admin: ClienteAdmin, documentoId: string, dados: NotaLida | EventoLido) {
  const { data, error } = await admin.rpc("registrar_xml_fiscal", { p_documento_id: documentoId, p_dados: dados as never });
  if (error) throw new Error(`Falha ao registrar o XML: ${error.message}`);
  const registro = data as { situacao: string; documento_fiscal_id?: string; documento_original_id?: string; lancamentos_sugeridos?: number };
  // Códigos fiscais completos da nota (regime do emitente, GTIN, CEST...) para o auditor fiscal.
  // Se falhar, a nota fica na leitura antiga e o auditor a relê depois.
  if (dados.tipo === "nota" && registro.situacao === "registrado" && registro.documento_fiscal_id) {
    const { error: erroLeitura } = await admin.rpc("atualizar_leitura_xml_fiscal", {
      p_documento_fiscal_id: registro.documento_fiscal_id,
      p_dados: dados as never,
    });
    if (erroLeitura) console.error(`[xml] leitura completa não gravada (${registro.documento_fiscal_id}):`, erroLeitura.message);
  }
  return registro;
}

export function resumoXml(dados: NotaLida | EventoLido) {
  if (dados.tipo === "evento") {
    return {
      tipo: "evento",
      descricao: dados.descricao_evento,
      chave: dados.chave_acesso,
      tipo_evento: dados.tipo_evento,
      data: dados.data_evento,
      cstat: dados.cstat,
      avisos: dados.avisos,
    };
  }
  return {
    tipo: dados.tipo_documento,
    chave: dados.chave_acesso,
    numero: dados.numero,
    serie: dados.serie,
    data_emissao: dados.data_emissao,
    operacao: dados.operacao,
    emitente: dados.emitente_nome,
    destinatario: dados.destinatario_nome,
    valor_total: dados.valor_total,
    situacao_arquivo: dados.situacao_arquivo,
    relacionado_empresa: dados.relacionado_empresa,
    avisos: dados.avisos,
  };
}

async function processarXml(admin: ClienteAdmin, doc: Documento, bytes: Uint8Array, referencia: { documento: string }) {
  const texto = decodificarTexto(bytes, /encoding="(iso-8859-1|windows-1252)"/i.exec(new TextDecoder("latin1").decode(bytes.slice(0, 200)))?.[1]);
  const lido = lerXmlFiscal(texto, referencia);
  if (!lido.sucesso) {
    await admin
      .from("documentos")
      .update({
        processamento_status: "concluido",
        processamento_detalhes: { leitura: lido.motivo, mensagem: lido.mensagem, raiz: lido.raiz ?? null },
        requer_conferencia: true,
      })
      .eq("id", doc.id);
    return { leitura: lido.motivo };
  }
  const registro = await registrarXml(admin, doc.id, lido.dados);
  const categoria = categoriaDoXml(lido.dados);
  const comp = competenciaDe(lido.dados.tipo === "evento" ? lido.dados.data_evento : lido.dados.data_emissao);
  const sugestao: Record<string, unknown> = {};
  if (doc.direcao === "cliente" && categoria && categoria !== doc.categoria_codigo) sugestao.categoria = categoria;
  if (comp && comp !== doc.competencia) sugestao.competencia = comp;
  const nota = lido.dados.tipo === "nota" ? lido.dados : null;
  await admin
    .from("documentos")
    .update({
      processamento_status: "concluido",
      processamento_detalhes: { ...resumoXml(lido.dados), registro },
      sugestao: Object.keys(sugestao).length ? { ...sugestao, motivo: "Conforme o conteúdo do XML" } : null,
      requer_conferencia: Boolean(
        (nota && !nota.relacionado_empresa) || registro.situacao === "duplicado" || registro.situacao === "evento_duplicado" || Object.keys(sugestao).length,
      ),
      duplicado_de: registro.documento_original_id && registro.documento_original_id !== doc.id ? registro.documento_original_id : null,
    })
    .eq("id", doc.id);
  return { registro: registro.situacao };
}

async function processarZip(admin: ClienteAdmin, doc: Documento, bytes: Uint8Array, referencia: { documento: string }, inicio: number) {
  const { data: esc } = await admin.from("escritorio").select("zip_max_arquivos, zip_max_tamanho_mb, upload_tamanho_maximo_mb").eq("id", 1).single();
  const { arquivos, ignorados } = extrairZipSeguro(bytes, {
    maxArquivos: esc?.zip_max_arquivos ?? 2000,
    maxTotalBytes: (esc?.zip_max_tamanho_mb ?? 300) * 1024 * 1024,
    maxArquivoBytes: 10 * 1024 * 1024,
    maxRazaoCompressao: 200,
    extensoes: ["xml"],
  });
  arquivos.sort((a, b) => a.caminho.localeCompare(b.caminho));
  const t0 = Date.now();
  const contagem = { registrados: 0, duplicados: 0, invalidos: 0, nao_suportados: 0, ja_extraidos: 0 };
  let i = inicio;
  for (; i < arquivos.length; i++) {
    if (i - inicio >= LOTE_ZIP || Date.now() - t0 > TEMPO_MAX_MS) break;
    const a = arquivos[i];
    const { data: existente } = await admin.from("documentos").select("id").eq("zip_origem_id", doc.id).eq("zip_caminho", a.caminho).maybeSingle();
    if (existente) {
      contagem.ja_extraidos++;
      continue;
    }
    const texto = decodificarTexto(a.bytes);
    const lido = lerXmlFiscal(texto, referencia);
    // Sem indicação segura pelo conteúdo, o XML herda a categoria escolhida para o ZIP.
    const categoria = (lido.sucesso ? categoriaDoXml(lido.dados) : null) ?? doc.categoria_codigo;
    const comp =
      (lido.sucesso && competenciaDe(lido.dados.tipo === "evento" ? lido.dados.data_evento : lido.dados.data_emissao)) || doc.competencia;
    const filhoId = randomUUID();
    const caminho = `${doc.empresa_id}/${comp.slice(0, 7)}/${filhoId}/v1-${a.nome.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-100)}`;
    const hash = sha256(a.bytes);
    const { error: erroUp } = await admin.storage.from("documentos").upload(caminho, a.bytes, { contentType: mimeDe(a.nome), upsert: false });
    if (erroUp) throw new Error(`Falha ao gravar ${a.nome}: ${erroUp.message}`);
    const agora = new Date().toISOString();
    const { error: erroDoc } = await admin.from("documentos").insert({
      id: filhoId,
      empresa_id: doc.empresa_id,
      direcao: "cliente",
      competencia: comp,
      categoria_codigo: categoria,
      nome_original: a.nome.slice(0, 255),
      extensao: "xml",
      mime: "application/xml",
      tamanho: a.bytes.length,
      sha256: hash,
      versao_atual: 1,
      storage_path: caminho,
      upload_status: "concluido",
      status: "recebido",
      origem: "zip",
      zip_origem_id: doc.id,
      zip_caminho: a.caminho,
      verificacao_status: "ok",
      enviado_por: doc.enviado_por,
      enviado_em: agora,
      processamento_status: "processando",
    });
    if (erroDoc) {
      await admin.storage.from("documentos").remove([caminho]);
      if (erroDoc.code === "23505") {
        contagem.ja_extraidos++;
        continue;
      }
      throw new Error(`Falha ao registrar ${a.nome}: ${erroDoc.message}`);
    }
    await admin.from("documento_versoes").insert({
      documento_id: filhoId,
      empresa_id: doc.empresa_id,
      versao: 1,
      storage_path: caminho,
      nome_original: a.nome.slice(0, 255),
      mime: "application/xml",
      tamanho: a.bytes.length,
      sha256: hash,
      enviado_por: doc.enviado_por,
      upload_concluido_em: agora,
      verificacao_status: "ok",
      verificacao_detalhes: "Extraído de ZIP verificado.",
    });
    if (!lido.sucesso) {
      if (lido.motivo === "nao_suportado") contagem.nao_suportados++;
      else contagem.invalidos++;
      await admin
        .from("documentos")
        .update({ processamento_status: "concluido", processamento_detalhes: { leitura: lido.motivo, mensagem: lido.mensagem }, requer_conferencia: true })
        .eq("id", filhoId);
      continue;
    }
    const registro = await registrarXml(admin, filhoId, lido.dados);
    if (registro.situacao === "duplicado" || registro.situacao === "evento_duplicado") contagem.duplicados++;
    else contagem.registrados++;
    await admin
      .from("documentos")
      .update({
        processamento_status: "concluido",
        processamento_detalhes: { ...resumoXml(lido.dados), registro },
        requer_conferencia: registro.situacao.includes("duplicado") || (lido.dados.tipo === "nota" && !lido.dados.relacionado_empresa),
        duplicado_de: registro.documento_original_id && registro.documento_original_id !== filhoId ? registro.documento_original_id : null,
      })
      .eq("id", filhoId);
  }

  const { data: anterior } = await admin.from("documentos").select("processamento_detalhes").eq("id", doc.id).single();
  const acumulado = (anterior?.processamento_detalhes as Record<string, number> | null)?.zip_inicio ? (anterior?.processamento_detalhes as Record<string, number>) : null;
  const soma = (k: keyof typeof contagem) => (acumulado?.[k] ?? 0) + contagem[k];
  const detalhes = {
    tipo: "zip",
    total_xml: arquivos.length,
    processados: i,
    registrados: soma("registrados"),
    duplicados: soma("duplicados"),
    invalidos: soma("invalidos"),
    nao_suportados: soma("nao_suportados"),
    ja_extraidos: soma("ja_extraidos"),
    ignorados: ignorados.slice(0, 50),
    zip_inicio: i,
  };
  const terminou = i >= arquivos.length;
  await admin
    .from("documentos")
    .update({
      processamento_status: terminou ? "concluido" : "processando",
      processamento_detalhes: detalhes,
      requer_conferencia: detalhes.invalidos + detalhes.nao_suportados + detalhes.duplicados > 0,
    })
    .eq("id", doc.id);
  if (!terminou) {
    // Continua em uma nova tarefa (evita estourar o tempo de execução).
    await admin.from("jobs").insert({
      tipo: "processar_documento",
      payload: { documento_id: doc.id, zip_inicio: i },
      empresa_id: doc.empresa_id,
      chave_idempotencia: `zip:${doc.id}:${i}`,
      prioridade: 25,
    });
  } else if (doc.enviado_por) {
    await admin.rpc("sistema_notificar", {
      p_user_id: doc.enviado_por,
      p_empresa_id: doc.empresa_id,
      p_tipo: "zip_processado",
      p_titulo: `ZIP processado: ${doc.nome_original}`,
      p_corpo: `${detalhes.registrados} XML(s) registrado(s), ${detalhes.duplicados} duplicado(s), ${detalhes.invalidos + detalhes.nao_suportados} com problema.`,
      p_link: `/e/${doc.empresa_id}/documentos/${doc.id}`,
      p_email: false,
    });
  }
  return detalhes;
}

async function processarOfx(admin: ClienteAdmin, doc: Documento, bytes: Uint8Array) {
  const ofx = lerOfx(bytes);
  const { data: contas } = await admin.from("contas_financeiras").select("id, nome, numero, agencia, banco_codigo, tipo").eq("empresa_id", doc.empresa_id).eq("ativa", true);
  const soDig = (s: string | null) => (s ?? "").replace(/\D/g, "");
  const conta = (contas ?? []).find((c) => {
    const n = soDig(c.numero);
    const o = soDig(ofx.conta);
    return n && o && (o.endsWith(n) || n.endsWith(o));
  });
  const comp = competenciaDe(ofx.fim ?? ofx.inicio ?? ofx.transacoes.at(-1)?.data);
  await admin
    .from("documentos")
    .update({
      processamento_status: "concluido",
      processamento_detalhes: {
        tipo: "ofx",
        tipo_conta: ofx.tipoConta,
        banco: ofx.bancoId,
        agencia: ofx.agencia,
        conta: ofx.conta,
        inicio: ofx.inicio,
        fim: ofx.fim,
        transacoes: ofx.transacoes.length,
        invalidas: ofx.invalidas.length,
        saldo: ofx.saldo,
        conta_sugerida: conta ? { id: conta.id, nome: conta.nome } : null,
        avisos: ofx.avisos,
      },
      sugestao: comp && comp !== doc.competencia ? { competencia: comp, motivo: "Conforme o período do extrato" } : null,
    })
    .eq("id", doc.id);
  return { transacoes: ofx.transacoes.length };
}

async function processarPlanilha(admin: ClienteAdmin, doc: Documento, bytes: Uint8Array, nome: string) {
  const linhas = await lerArquivoPlanilha(bytes, nome);
  const m = sugerirMapeamento(linhas);
  const r = aplicarMapeamento(linhas, m);
  await admin
    .from("documentos")
    .update({
      processamento_status: "concluido",
      processamento_detalhes: {
        tipo: "planilha",
        linhas: linhas.length,
        transacoes_reconhecidas: r.transacoes.length,
        invalidas: r.invalidas.length,
        inicio: r.transacoes.map((t) => t.data).sort()[0] ?? null,
        fim: r.transacoes.map((t) => t.data).sort().at(-1) ?? null,
        mapeamento_sugerido: m as never,
      },
    })
    .eq("id", doc.id);
  return { transacoes: r.transacoes.length };
}

/** Relatório de vendas da maquininha: o módulo Maquininhas confere as taxas com o contrato. */
async function processarRelatorioMaquininha(admin: ClienteAdmin, doc: Documento, versao: number, bytes: Uint8Array, nome: string) {
  const { registrarRelatorio } = await import("@/lib/maquininhas/importar");
  const r = await registrarRelatorio(admin, doc, versao, bytes, nome);
  await admin
    .from("documentos")
    .update({
      processamento_status: "concluido",
      processamento_detalhes: { tipo: "maquininha", importacao_id: r.importacao_id, situacao: r.situacao, linhas: r.linhas },
    })
    .eq("id", doc.id);
  return { maquininha: r.situacao };
}

async function processarImagemOuPdf(admin: ClienteAdmin, doc: Documento, bytes: Uint8Array, ext: string) {
  if (!envServidor.ocrAtivo()) {
    await admin.from("documentos").update({ processamento_status: "nao_aplicavel", processamento_detalhes: { ocr: "desativado" } }).eq("id", doc.id);
    return { ocr: "desativado" };
  }
  const { extrairTextoDocumento } = await import("@/lib/ocr/ocr");
  const { extrairCampos } = await import("@/lib/ocr/campos");
  const leitura = await extrairTextoDocumento(bytes, ext);
  const campos = leitura.texto ? extrairCampos(leitura.texto, leitura.palavras) : null;
  const baixaConfianca = !leitura.texto || leitura.metodo === "indisponivel" || (campos?.campos.some((c) => c.confianca === "baixa") ?? true);
  await admin
    .from("documentos")
    .update({
      processamento_status: "concluido",
      extracao: {
        metodo: leitura.metodo,
        confianca_media: leitura.confiancaMedia,
        aviso: leitura.aviso ?? null,
        texto: leitura.texto?.slice(0, 6000) ?? null,
        campos: (campos?.campos ?? []) as never,
      },
      processamento_detalhes: { tipo: ext === "pdf" ? "pdf" : "imagem", leitura: leitura.metodo },
      requer_conferencia: baixaConfianca,
      sugestao:
        campos?.competenciaSugerida && campos.competenciaSugerida !== doc.competencia
          ? { competencia: campos.competenciaSugerida, motivo: "Data encontrada no documento (conferir)" }
          : null,
    })
    .eq("id", doc.id);
  return { ocr: leitura.metodo, campos: campos?.campos.length ?? 0 };
}

/** Remove arquivos do armazenamento (envios abandonados e expurgos de retenção). */
export async function removerArquivos(admin: ClienteAdmin, job: Job) {
  const caminhos = ((job.payload as { caminhos?: string[] })?.caminhos ?? []).filter((c) => typeof c === "string" && c.length > 0);
  let removidos = 0;
  for (let i = 0; i < caminhos.length; i += 100) {
    const lote = caminhos.slice(i, i + 100);
    const { data, error } = await admin.storage.from("documentos").remove(lote);
    if (error) throw new Error(error.message);
    removidos += data?.length ?? 0;
  }
  return { removidos };
}
