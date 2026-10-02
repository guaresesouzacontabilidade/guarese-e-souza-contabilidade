import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { envServidor } from "@/lib/env-servidor";
import { decifrar } from "./cripto";
import { requisitar, type Credencial } from "./transporte";
import {
  ACAO_DISTRIBUICAO,
  ACAO_EVENTO,
  EVENTO_REGISTRADO,
  URLS_NFE,
  eventoCienciaAssinado,
  lerResumoEvento,
  lerResumoNfe,
  lerRetornoDistribuicao,
  lerRetornoEventos,
  montarDistribuicao,
  montarEnvioEventos,
  tipoConteudoSoap,
  tipoEventoDoProc,
  type Ambiente,
  type DocumentoDistribuido,
} from "./nfe";
import { URLS_NFSE, lerRetornoNfse, urlDistribuicaoNfse, type DocumentoNfse } from "./nfse";
import { importarXmlAutomatico } from "./importar";

/**
 * Busca automática de uma empresa (tarefa "notas_automaticas" da fila):
 *  1. NF-e: distribuição por NSU na SEFAZ (no máximo 10 consultas por vez);
 *     quando não há documentos novos ou chegou ao último NSU, a próxima
 *     consulta fica para 1 hora depois, como exige a SEFAZ;
 *  2. Ciência da emissão das NF-e recebidas só em resumo (se a empresa ativou);
 *  3. NFS-e: distribuição por NSU no Ambiente Nacional.
 * Tudo o que chega é real; nada é inventado quando o serviço falha — o erro
 * fica registrado e a busca tenta de novo mais tarde.
 */

const AMBIENTE: Ambiente = "producao";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const TEMPO_MAXIMO_MS = 25_000;
const MAX_CONSULTAS = 10;
const CANCELAMENTOS = ["110111", "110112"];

interface Contexto {
  admin: ClienteAdmin;
  empresaId: string;
  cnpj: string;
  uf: string;
  documentoEmpresa: string;
  credencial: Credencial;
  prazo: number;
  urls: { distribuicao: string; evento: string; nfse: string };
  ca?: string[];
}

/** Só para os testes automáticos (servidor local no lugar da SEFAZ); a fila nunca passa estas opções. */
export interface OpcoesTeste {
  urls?: { distribuicao: string; evento: string; nfse: string };
  ca?: string[];
}

interface ResultadoServico {
  erro: string | null;
  proxima: Date;
}

function mensagemDe(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 900);
}

async function registrarExecucao(
  c: Contexto,
  servico: "nfe" | "nfse" | "ciencia",
  iniciado: Date,
  r: { resultado: "novos" | "sem_novidades" | "limite" | "erro"; documentos?: number; resumos?: number; codigo?: string | null; mensagem?: string | null },
) {
  await c.admin.from("notas_automaticas_execucoes").insert({
    empresa_id: c.empresaId,
    servico,
    iniciado_em: iniciado.toISOString(),
    concluido_em: new Date().toISOString(),
    resultado: r.resultado,
    documentos: r.documentos ?? 0,
    resumos: r.resumos ?? 0,
    codigo: r.codigo?.slice(0, 40) ?? null,
    mensagem: r.mensagem?.slice(0, 1000) ?? null,
  });
}

async function nsuProcessado(c: Contexto, servico: "nfe" | "nfse", nsu: string) {
  const { data } = await c.admin.from("notas_automaticas_nsu").select("nsu").eq("empresa_id", c.empresaId).eq("servico", servico).eq("nsu", nsu).maybeSingle();
  return Boolean(data);
}

async function marcarNsu(c: Contexto, servico: "nfe" | "nfse", nsu: string, tipo: string, chave: string | null, documentoId: string | null) {
  await c.admin
    .from("notas_automaticas_nsu")
    .upsert({ empresa_id: c.empresaId, servico, nsu, tipo: tipo.slice(0, 60), chave: chave?.slice(0, 60) ?? null, documento_id: documentoId }, { onConflict: "empresa_id,servico,nsu", ignoreDuplicates: true });
}

// -----------------------------------------------------------------------------
// NF-e
// -----------------------------------------------------------------------------
async function processarDocumentoNfe(c: Contexto, d: DocumentoDistribuido): Promise<{ documentos: number; resumos: number }> {
  const nsu = d.nsu.replace(/^0+(?=\d)/, "");
  if (await nsuProcessado(c, "nfe", nsu)) return { documentos: 0, resumos: 0 };
  let chave: string | null = null;
  let documentoId: string | null = null;
  let documentos = 0;
  let resumos = 0;
  if (d.tipo === "resNFe") {
    const r = lerResumoNfe(d.xml);
    if (r) {
      chave = r.chave;
      await c.admin.from("nfe_resumos").upsert(
        {
          empresa_id: c.empresaId,
          chave: r.chave,
          nsu,
          emitente_documento: r.emitenteDocumento?.slice(0, 14) ?? null,
          emitente_nome: r.emitenteNome?.slice(0, 300) ?? null,
          emitente_ie: r.emitenteIe?.slice(0, 20) ?? null,
          data_emissao: r.dataEmissao,
          // tpNF é do ponto de vista de quem emitiu: a saída do fornecedor é a entrada da empresa
          tipo_operacao: r.tipoNf === "1" ? "entrada" : r.tipoNf === "0" ? "saida" : null,
          // Texto decimal exato (o banco converte para numeric)
          valor: (r.valor && /^\d{1,13}(\.\d{1,2})?$/.test(r.valor) ? r.valor : null) as unknown as number | null,
          protocolo: r.protocolo?.slice(0, 20) ?? null,
          situacao: r.situacao,
        },
        { onConflict: "empresa_id,chave" },
      );
      resumos = 1;
      // XML completo já no portal (enviado pelo cliente, por exemplo): liga o resumo a ele
      const { data: fiscal } = await c.admin
        .from("documentos_fiscais")
        .select("documento_id")
        .eq("empresa_id", c.empresaId)
        .eq("chave_acesso", r.chave)
        .limit(1)
        .maybeSingle();
      if (fiscal?.documento_id) {
        await c.admin.from("nfe_resumos").update({ documento_id: fiscal.documento_id }).eq("empresa_id", c.empresaId).eq("chave", r.chave);
      }
    }
  } else if (d.tipo === "procNFe") {
    const imp = await importarXmlAutomatico(c.admin, {
      empresaId: c.empresaId,
      documentoEmpresa: c.documentoEmpresa,
      xml: d.xml,
      nome: `NFe-NSU-${nsu}.xml`,
      origem: "sefaz",
      categoriaPadrao: "nfe_entrada_xml",
    });
    chave = imp.chave;
    documentoId = imp.documentoId;
    if (imp.situacao === "importado") documentos = 1;
    if (chave && documentoId) await c.admin.from("nfe_resumos").update({ documento_id: documentoId }).eq("empresa_id", c.empresaId).eq("chave", chave);
  } else if (d.tipo === "resEvento") {
    const r = lerResumoEvento(d.xml);
    chave = r?.chave ?? null;
    if (r && CANCELAMENTOS.includes(r.tipoEvento)) {
      await c.admin.from("nfe_resumos").update({ situacao: "cancelada" }).eq("empresa_id", c.empresaId).eq("chave", r.chave);
    }
  } else if (d.tipo === "procEventoNFe") {
    const tipo = tipoEventoDoProc(d.xml);
    // As manifestações da própria empresa (ciência, confirmação...) não viram documento
    if (!tipo?.startsWith("2102")) {
      const imp = await importarXmlAutomatico(c.admin, {
        empresaId: c.empresaId,
        documentoEmpresa: c.documentoEmpresa,
        xml: d.xml,
        nome: `Evento-NFe-NSU-${nsu}.xml`,
        origem: "sefaz",
        categoriaPadrao: "eventos_fiscais",
      });
      chave = imp.chave;
      documentoId = imp.documentoId;
      if (imp.situacao === "importado") documentos = 1;
      if (chave && tipo && CANCELAMENTOS.includes(tipo)) {
        await c.admin.from("nfe_resumos").update({ situacao: "cancelada" }).eq("empresa_id", c.empresaId).eq("chave", chave);
      }
    }
  }
  await marcarNsu(c, "nfe", nsu, d.tipo, chave, documentoId);
  return { documentos, resumos };
}

async function buscarNfe(c: Contexto, ultInicial: string): Promise<ResultadoServico> {
  const iniciado = new Date();
  let ult = ultInicial;
  let max: string | null = null;
  let proxima = new Date(Date.now() + HORA);
  let documentos = 0;
  let resumos = 0;
  let codigo: string | null = null;
  let resultado: "novos" | "sem_novidades" | "limite" | "erro" = "sem_novidades";
  let mensagem: string | null = null;
  let erro: string | null = null;
  try {
    for (let consultas = 0; consultas < MAX_CONSULTAS && Date.now() < c.prazo; consultas++) {
      const resp = await requisitar(c.urls.distribuicao, {
        metodo: "POST",
        credencial: c.credencial,
        ca: c.ca,
        tempoLimiteMs: 20_000,
        corpo: montarDistribuicao({ cnpj: c.cnpj, uf: c.uf, ultNsu: ult, ambiente: AMBIENTE }),
        cabecalhos: { "Content-Type": tipoConteudoSoap(ACAO_DISTRIBUICAO) },
      });
      if (!resp.corpo.includes("retDistDFeInt")) {
        throw new Error(resp.status === 403 ? "A SEFAZ recusou o certificado da empresa (HTTP 403)." : `A SEFAZ respondeu sem o retorno esperado (HTTP ${resp.status}).`);
      }
      const r = lerRetornoDistribuicao(resp.corpo);
      codigo = r.cStat;
      mensagem = `${r.cStat} - ${r.xMotivo}`;
      if (r.cStat === "656") {
        // Consumo indevido: a SEFAZ bloqueia novas consultas por 1 hora
        resultado = "limite";
        proxima = new Date(Date.now() + HORA);
        break;
      }
      if (r.cStat === "137") {
        // Nenhum documento novo: a próxima consulta só depois de 1 hora
        if (r.ultNsu) ult = r.ultNsu;
        if (r.maxNsu) max = r.maxNsu;
        proxima = new Date(Date.now() + HORA);
        break;
      }
      if (r.cStat !== "138") {
        resultado = "erro";
        erro = `SEFAZ: ${mensagem}`;
        proxima = new Date(Date.now() + HORA);
        break;
      }
      for (const d of r.documentos) {
        const x = await processarDocumentoNfe(c, d);
        documentos += x.documentos;
        resumos += x.resumos;
      }
      resultado = "novos";
      if (r.ultNsu) ult = r.ultNsu;
      if (r.maxNsu) max = r.maxNsu;
      await c.admin.from("notas_automaticas").update({ nfe_ult_nsu: ult, nfe_max_nsu: max }).eq("empresa_id", c.empresaId);
      if (!max || ult >= max) {
        // Chegou ao último NSU: a SEFAZ pede 1 hora até a próxima consulta
        proxima = new Date(Date.now() + HORA);
        break;
      }
      // Ainda há documentos: continua logo na próxima execução
      proxima = new Date(Date.now() + MINUTO);
    }
  } catch (e) {
    resultado = "erro";
    erro = mensagemDe(e);
    mensagem = erro;
  }
  await c.admin.from("notas_automaticas").update({ nfe_ult_nsu: ult, nfe_max_nsu: max, nfe_proxima: proxima.toISOString() }).eq("empresa_id", c.empresaId);
  await registrarExecucao(c, "nfe", iniciado, { resultado, documentos, resumos, codigo, mensagem });
  return { erro, proxima };
}

async function enviarCiencias(c: Contexto): Promise<{ erro: string | null }> {
  const { data: pendentes } = await c.admin
    .from("nfe_resumos")
    .select("chave")
    .eq("empresa_id", c.empresaId)
    .eq("situacao", "autorizada")
    .is("ciencia_em", null)
    .is("ciencia_retorno", null)
    .is("documento_id", null)
    .order("recebido_em")
    .limit(20);
  if (!pendentes?.length) return { erro: null };
  const iniciado = new Date();
  try {
    const quando = new Date(Date.now() - MINUTO);
    const eventos = pendentes.map((p) =>
      eventoCienciaAssinado({ chave: p.chave, cnpj: c.cnpj, ambiente: AMBIENTE, quando, chavePem: c.credencial.chave, certificadoPem: c.credencial.certificados[0] }),
    );
    const resp = await requisitar(c.urls.evento, {
      metodo: "POST",
      credencial: c.credencial,
      ca: c.ca,
        tempoLimiteMs: 20_000,
      corpo: montarEnvioEventos(eventos, String(Date.now()).slice(-15)),
      cabecalhos: { "Content-Type": tipoConteudoSoap(ACAO_EVENTO) },
    });
    if (!resp.corpo.includes("retEnvEvento")) throw new Error(`A SEFAZ respondeu sem o retorno do lote de eventos (HTTP ${resp.status}).`);
    const r = lerRetornoEventos(resp.corpo);
    if (r.cStat !== "128") throw new Error(`SEFAZ: ${r.cStat} - ${r.xMotivo}`);
    let registrados = 0;
    for (const ev of r.eventos) {
      if (!ev.chave) continue;
      const ok = EVENTO_REGISTRADO.has(ev.cStat);
      if (ok) registrados++;
      await c.admin
        .from("nfe_resumos")
        .update({ ...(ok ? { ciencia_em: new Date().toISOString() } : {}), ciencia_retorno: `${ev.cStat} - ${ev.xMotivo}`.slice(0, 300) })
        .eq("empresa_id", c.empresaId)
        .eq("chave", ev.chave);
    }
    await registrarExecucao(c, "ciencia", iniciado, {
      resultado: registrados ? "novos" : "sem_novidades",
      resumos: registrados,
      codigo: r.cStat,
      mensagem: `${registrados} de ${pendentes.length} ciência(s) registrada(s).`,
    });
    return { erro: null };
  } catch (e) {
    const erro = mensagemDe(e);
    await registrarExecucao(c, "ciencia", iniciado, { resultado: "erro", mensagem: erro });
    return { erro };
  }
}

// -----------------------------------------------------------------------------
// NFS-e
// -----------------------------------------------------------------------------
async function processarDocumentoNfse(c: Contexto, d: DocumentoNfse): Promise<number> {
  const nsu = String(d.nsu);
  if (await nsuProcessado(c, "nfse", nsu)) return 0;
  let documentoId: string | null = null;
  let chave = d.chave;
  let novos = 0;
  if (d.tipo === "NFSE" || d.tipo === "EVENTO") {
    const imp = await importarXmlAutomatico(c.admin, {
      empresaId: c.empresaId,
      documentoEmpresa: c.documentoEmpresa,
      xml: d.xml,
      nome: d.tipo === "NFSE" ? `NFSe-NSU-${nsu}.xml` : `Evento-NFSe-NSU-${nsu}.xml`,
      origem: "adn",
      categoriaPadrao: d.tipo === "NFSE" ? "nfse" : "eventos_fiscais",
    });
    documentoId = imp.documentoId;
    chave = imp.chave ?? chave;
    if (imp.situacao === "importado") novos = 1;
  }
  await marcarNsu(c, "nfse", nsu, d.tipo, chave, documentoId);
  return novos;
}

async function buscarNfse(c: Contexto, ultInicial: number): Promise<ResultadoServico> {
  const iniciado = new Date();
  let ult = ultInicial;
  let proxima = new Date(Date.now() + HORA);
  let documentos = 0;
  let codigo: string | null = null;
  let resultado: "novos" | "sem_novidades" | "limite" | "erro" = "sem_novidades";
  let mensagem: string | null = null;
  let erro: string | null = null;
  try {
    for (let consultas = 0; consultas < MAX_CONSULTAS && Date.now() < c.prazo; consultas++) {
      const resp = await requisitar(urlDistribuicaoNfse(ult + 1, AMBIENTE, c.urls.nfse), {
        metodo: "GET",
        credencial: c.credencial,
        ca: c.ca,
        tempoLimiteMs: 20_000,
        cabecalhos: { Accept: "application/json" },
      });
      codigo = `HTTP ${resp.status}`;
      const r = lerRetornoNfse(resp.corpo, resp.status);
      if (r.situacao === "erro") {
        resultado = "erro";
        erro = r.mensagem;
        mensagem = r.mensagem;
        break;
      }
      if (r.situacao === "nenhum") break;
      for (const d of r.documentos) {
        if (d.nsu <= ult) continue;
        documentos += await processarDocumentoNfse(c, d);
        ult = Math.max(ult, d.nsu);
      }
      resultado = "novos";
      await c.admin.from("notas_automaticas").update({ nfse_ult_nsu: ult }).eq("empresa_id", c.empresaId);
      if (r.documentos.length < 50) break;
      proxima = new Date(Date.now() + MINUTO);
    }
  } catch (e) {
    resultado = "erro";
    erro = mensagemDe(e);
    mensagem = erro;
  }
  await c.admin.from("notas_automaticas").update({ nfse_ult_nsu: ult, nfse_proxima: proxima.toISOString() }).eq("empresa_id", c.empresaId);
  await registrarExecucao(c, "nfse", iniciado, { resultado, documentos, codigo, mensagem });
  return { erro, proxima };
}

// -----------------------------------------------------------------------------
// Tarefa da fila
// -----------------------------------------------------------------------------
const vencida = (quando: string | null) => !quando || new Date(quando).getTime() <= Date.now() + 5_000;

export async function executarNotasAutomaticas(admin: ClienteAdmin, job: Job, teste: OpcoesTeste = {}) {
  const empresaId = (job.payload as { empresa_id?: string } | null)?.empresa_id;
  if (!empresaId) return { ignorado: "tarefa sem empresa" };
  const [{ data: cfg }, { data: cert }, { data: emp }] = await Promise.all([
    admin.from("notas_automaticas").select("*").eq("empresa_id", empresaId).maybeSingle(),
    admin.from("certificados_digitais").select("id, valido_ate").eq("empresa_id", empresaId).is("revogado_em", null).maybeSingle(),
    admin.from("empresas").select("documento, uf").eq("id", empresaId).maybeSingle(),
  ]);
  if (!cfg || !cert || !emp) return { ignorado: "desconectada (sem certificado)" };
  if (cfg.pausada || (!cfg.nfe_ativa && !cfg.nfse_ativa)) return { ignorado: "busca pausada" };
  if (new Date(cert.valido_ate).getTime() <= Date.now()) {
    await admin
      .from("notas_automaticas")
      .update({ ultima_execucao: new Date().toISOString(), ultimo_erro: "O certificado digital venceu. Cadastre o certificado renovado." })
      .eq("empresa_id", empresaId);
    return { ignorado: "certificado vencido" };
  }
  if (!teste.urls && envServidor.notasSemRede()) {
    // Demonstração ou teste: nenhuma consulta fiscal sai deste ambiente
    await admin
      .from("notas_automaticas")
      .update({
        ultima_execucao: new Date().toISOString(),
        ultimo_erro: "Consultas aos serviços oficiais desligadas neste ambiente (demonstração ou teste). Nenhuma consulta foi feita.",
        erros_seguidos: 1,
      })
      .eq("empresa_id", empresaId);
    return { ignorado: "consultas desligadas neste ambiente" };
  }
  const { data: reservado } = await admin.rpc("notas_reservar", { p_empresa_id: empresaId, p_segundos: 120 });
  if (!reservado) {
    await admin.rpc("notas_agendar", { p_empresa_id: empresaId, p_quando: new Date(Date.now() + 2 * MINUTO).toISOString() });
    return { ignorado: "outra busca em andamento" };
  }

  const erros: string[] = [];
  let proximas: Date[] = [];
  try {
    const { data: segredo } = await admin.from("certificados_segredos").select("conteudo_cifrado").eq("certificado_id", cert.id).maybeSingle();
    if (!segredo) throw new Error("O certificado guardado não foi encontrado. Cadastre o certificado de novo.");
    const credencial = JSON.parse(decifrar(segredo.conteudo_cifrado)) as Credencial;
    const c: Contexto = {
      admin,
      empresaId,
      cnpj: (emp.documento ?? "").toUpperCase().replace(/[^0-9A-Z]/g, ""),
      uf: emp.uf ?? "",
      documentoEmpresa: emp.documento ?? "",
      credencial,
      prazo: Date.now() + TEMPO_MAXIMO_MS,
      urls: teste.urls ?? { distribuicao: URLS_NFE.distribuicao[AMBIENTE], evento: URLS_NFE.evento[AMBIENTE], nfse: URLS_NFSE[AMBIENTE] },
      ca: teste.ca,
    };
    if (cfg.nfe_ativa) {
      if (vencida(cfg.nfe_proxima)) {
        const r = await buscarNfe(c, cfg.nfe_ult_nsu);
        if (r.erro) erros.push(r.erro);
        proximas.push(r.proxima);
      } else proximas.push(new Date(cfg.nfe_proxima!));
      if (cfg.ciencia_automatica && Date.now() < c.prazo) {
        const r = await enviarCiencias(c);
        if (r.erro) erros.push(`Ciência: ${r.erro}`);
      }
    }
    if (cfg.nfse_ativa) {
      if (vencida(cfg.nfse_proxima) && Date.now() < c.prazo) {
        const r = await buscarNfse(c, Number(cfg.nfse_ult_nsu));
        if (r.erro) erros.push(r.erro);
        proximas.push(r.proxima);
      } else proximas.push(cfg.nfse_proxima ? new Date(cfg.nfse_proxima) : new Date(Date.now() + MINUTO));
    }
  } catch (e) {
    erros.push(mensagemDe(e));
    proximas = [];
  }

  // Erros seguidos espaçam as tentativas (15 min, 30 min, 1 h... até 6 h)
  const errosSeguidos = erros.length ? (cfg.erros_seguidos ?? 0) + 1 : 0;
  const espera = erros.length ? Math.min(6 * HORA, 15 * MINUTO * 2 ** Math.min(errosSeguidos - 1, 5)) : 0;
  const proxima = new Date(Math.max(Date.now() + MINUTO, ...(proximas.length ? [Math.min(...proximas.map((d) => d.getTime()))] : [Date.now() + espera]), Date.now() + espera));
  await admin
    .from("notas_automaticas")
    .update({
      ultima_execucao: new Date().toISOString(),
      ...(erros.length ? {} : { ultimo_sucesso: new Date().toISOString() }),
      ultimo_erro: erros.length ? erros.join(" | ").slice(0, 1000) : null,
      erros_seguidos: errosSeguidos,
      executando_ate: null,
    })
    .eq("empresa_id", empresaId);
  await admin.rpc("notas_agendar", { p_empresa_id: empresaId, p_quando: proxima.toISOString() });
  return { erros, proxima: proxima.toISOString() };
}
