import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { Job } from "@/lib/jobs/executor";
import { envServidor } from "@/lib/env-servidor";
import { ErroConexao } from "@/lib/notas-automaticas/transporte";
import { importarXmlAutomatico } from "@/lib/notas-automaticas/importar";
import { credencialDaEmpresa } from "@/lib/nfse-emissao/emitir";
import { fmt } from "@/lib/nfe-emissao/decimal";
import type { CteCalculado, EntradaCte } from "./calculo";
import { cteAssinado } from "./cte";
import { eventoCancelamentoCte, eventoCartaCorrecaoCte, type CorrecaoCte } from "./eventos";
import {
  CTE_AUTORIZADO,
  CTE_DENEGADO,
  CTE_DUPLICIDADE,
  EVENTO_CTE_ACEITO,
  consultarCte,
  enviarCte,
  enviarEventoCte,
  eventoRegistrado,
  montarCteProc,
  montarProcEventoCte,
  type ConexaoSefazCte,
  type ProtocoloCte,
} from "./sefaz";

/**
 * Tarefas da fila que falam com a SEFAZ (autorizador do estado do emitente):
 *  - emitir_cte: monta e assina o CT-e, envia na recepção síncrona e guarda
 *    o CT-e autorizado (cteProc) ou o motivo da rejeição. Se uma tentativa
 *    anterior ficou sem resposta, consulta antes a chave, para nunca emitir
 *    duas vezes; o CT-e reenviado é exatamente o mesmo (mesma chave e data).
 *  - evento_cte: cancelamento (110111) e carta de correção (110110).
 * Em produção, o CT-e autorizado entra nos documentos fiscais da empresa. CT-e
 * de homologação (teste) não entra.
 */

type Emissao = Database["public"]["Tables"]["cte_emissoes"]["Row"];
type Evento = Database["public"]["Tables"]["cte_eventos"]["Row"];
export interface OpcoesTeste {
  base?: string;
  ca?: string[];
}

const PORTAL = "PORTAL";

function mensagem(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Dados do CT-e (montados pelo banco no pedido) + número, série, código e data de emissão. */
export function entradaDaEmissaoCte(e: Pick<Emissao, "dados" | "ambiente" | "serie" | "numero" | "codigo_numerico">, emitidoEm: Date): EntradaCte {
  const d = e.dados as unknown as Omit<EntradaCte, "ambiente" | "emitidoEm" | "serie" | "numero" | "codigoNumerico">;
  return {
    ...d,
    ambiente: e.ambiente as EntradaCte["ambiente"],
    emitidoEm,
    serie: e.serie,
    numero: Number(e.numero),
    codigoNumerico: e.codigo_numerico,
  };
}

/** Resumo dos valores (lista, tela do CT-e e DACTE sem refazer o cálculo). */
export function resumoTotaisCte(c: CteCalculado) {
  const v = (x: bigint) => fmt(x, 2);
  return {
    vTPrest: v(c.vTPrest),
    vRec: v(c.vRec),
    icms: { grupo: c.icms.grupo, cst: c.icms.cst, vBC: v(c.icms.vBC), pICMS: c.icms.pICMS != null ? fmt(c.icms.pICMS, 2) : null, vICMS: v(c.icms.vICMS), vCred: c.icms.vCred != null ? v(c.icms.vCred) : null },
    vIBS: c.ibscbs ? v(c.ibscbs.vIBS) : null,
    vCBS: c.ibscbs ? v(c.ibscbs.cbs.valor) : null,
    vTotDFe: v(c.vTotDFe),
    vTotTrib: v(c.vTotTrib),
  };
}

async function registrar(admin: ClienteAdmin, id: string, dados: Partial<Emissao>) {
  const { error } = await admin.from("cte_emissoes").update(dados as never).eq("id", id);
  if (error) throw new Error(`Falha ao gravar o CT-e: ${error.message}`);
}

async function avisar(admin: ClienteAdmin, id: string) {
  await admin.rpc("cte_avisar", { p_id: id });
}

const ultimaTentativa = (job: Job) => job.tentativas >= (job.max_tentativas ?? 5);

async function guardarNosDocumentos(admin: ClienteAdmin, empresaId: string, documento: string, xml: string, nome: string) {
  const r = await importarXmlAutomatico(admin, { empresaId, documentoEmpresa: documento, xml, nome, origem: "emissao_cte", categoriaPadrao: "cte_xml" });
  return r.documentoId;
}

async function concluirAutorizado(admin: ClienteAdmin, e: Emissao, emp: { documento: string }, xmlAssinado: string, p: ProtocoloCte) {
  const proc = montarCteProc(xmlAssinado, p.xml!);
  await registrar(admin, e.id, {
    situacao: "autorizada",
    protocolo: p.protocolo,
    autorizada_em: p.recebidaEm ? new Date(p.recebidaEm).toISOString() : new Date().toISOString(),
    xml_autorizado: proc,
    mensagens: null,
  });
  if (e.ambiente === "producao") {
    try {
      const documentoId = await guardarNosDocumentos(admin, e.empresa_id, emp.documento, proc, `CTe-${e.numero}-${p.chave}.xml`);
      if (documentoId) await registrar(admin, e.id, { documento_id: documentoId });
    } catch (err) {
      // O CT-e já está autorizado e guardado; o registro nos documentos pode ser refeito pela busca automática
      console.error("[cte] registro nos documentos:", mensagem(err));
    }
  }
  await avisar(admin, e.id);
  return { situacao: "autorizada", chave: p.chave };
}

export async function emitirCte(admin: ClienteAdmin, job: Job, teste: OpcoesTeste = {}) {
  const id = (job.payload as { emissao_id?: string } | null)?.emissao_id;
  if (!id) return { ignorado: "tarefa sem CT-e" };
  const { data: e } = await admin.from("cte_emissoes").select("*").eq("id", id).maybeSingle();
  if (!e) return { ignorado: "CT-e não encontrado" };
  if (!["na_fila", "enviando", "falha", "aguardando"].includes(e.situacao)) return { ignorado: `CT-e ${e.situacao}` };
  const { data: emp } = await admin.from("empresas").select("documento").eq("id", e.empresa_id).maybeSingle();
  if (!emp) return { ignorado: "empresa não encontrada" };

  const falhaDefinitiva = async (descricao: string, codigo = PORTAL) => {
    await registrar(admin, id, { situacao: "falha", mensagens: [{ codigo, descricao }] as never });
    await avisar(admin, id);
    return { situacao: "falha", motivo: descricao };
  };
  const rejeitar = async (codigo: string, descricao: string) => {
    await registrar(admin, id, { situacao: "rejeitada", mensagens: [{ codigo, descricao }] as never });
    await avisar(admin, id);
    return { situacao: "rejeitada", motivo: `${codigo}: ${descricao}` };
  };
  if (!teste.base && envServidor.notasSemRede()) {
    return falhaDefinitiva("Emissão desligada neste ambiente (demonstração ou teste): nada foi enviado à SEFAZ.");
  }
  const cred = await credencialDaEmpresa(admin, e.empresa_id);
  if ("erro" in cred) return falhaDefinitiva(cred.erro);
  const chaves = { chavePem: cred.credencial.chave, certificadoPem: cred.credencial.certificados[0] };

  // O CT-e já montado numa tentativa anterior é reenviado igual (mesma chave e data de emissão)
  let xml = e.xml_assinado;
  let chave = e.chave;
  let emitidoEm = e.emitida_em ? new Date(e.emitida_em) : null;
  if (!xml || !chave || !emitidoEm) {
    emitidoEm = new Date(Date.now() - 30_000);
    try {
      const m = cteAssinado(entradaDaEmissaoCte(e, emitidoEm), chaves);
      xml = m.xml;
      chave = m.chave;
      await registrar(admin, id, { chave, emitida_em: emitidoEm.toISOString(), xml_assinado: xml, totais: resumoTotaisCte(m.calculado) as never });
    } catch (err) {
      return rejeitar(PORTAL, mensagem(err));
    }
  }
  const uf = (e.dados as unknown as EntradaCte).emitente.endereco.uf;
  const conexao: ConexaoSefazCte = { uf, ambiente: e.ambiente as ConexaoSefazCte["ambiente"], credencial: cred.credencial, base: teste.base, ca: teste.ca };
  const atualizada: Emissao = { ...e, chave, xml_assinado: xml, emitida_em: emitidoEm.toISOString() };

  const tratarProtocolo = async (p: ProtocoloCte) => {
    if (CTE_AUTORIZADO.has(p.cStat)) return concluirAutorizado(admin, atualizada, emp, xml!, p);
    if (CTE_DENEGADO.has(p.cStat)) {
      await registrar(admin, id, {
        situacao: "denegada",
        protocolo: p.protocolo,
        xml_autorizado: p.xml ? montarCteProc(xml!, p.xml) : null,
        mensagens: [{ codigo: p.cStat, descricao: p.xMotivo }] as never,
      });
      await avisar(admin, id);
      return { situacao: "denegada", motivo: p.xMotivo };
    }
    if (CTE_DUPLICIDADE.has(p.cStat)) {
      // A resposta de uma tentativa anterior pode ter se perdido: o CT-e pode já estar autorizado
      const s = await consultarCte(conexao, chave!);
      if (s.protocolo && CTE_AUTORIZADO.has(s.protocolo.cStat)) return concluirAutorizado(admin, atualizada, emp, xml!, s.protocolo);
    }
    return rejeitar(p.cStat, p.xMotivo);
  };

  await registrar(admin, id, { situacao: "enviando", tentativas: e.tentativas + 1, ultimo_envio_em: new Date().toISOString() });
  try {
    // Tentativa anterior sem resposta: consulta a chave antes de enviar de novo
    if (e.tentativas > 0) {
      const s = await consultarCte(conexao, chave);
      if (s.protocolo && (CTE_AUTORIZADO.has(s.protocolo.cStat) || CTE_DENEGADO.has(s.protocolo.cStat))) return tratarProtocolo(s.protocolo);
    }
    const r = await enviarCte(conexao, xml, chave);
    if (r.tipo === "protocolo") return tratarProtocolo(r.protocolo);
    return rejeitar(r.cStat, r.xMotivo);
  } catch (err) {
    const erro = { codigo: err instanceof ErroConexao ? err.codigo : PORTAL, descricao: mensagem(err) };
    await registrar(admin, id, { situacao: "falha", mensagens: [erro] as never });
    // Certificado recusado não melhora tentando de novo
    if ((err instanceof ErroConexao && err.codigo === "certificado") || ultimaTentativa(job)) {
      await avisar(admin, id);
      return { situacao: "falha", motivo: erro.descricao };
    }
    throw err;
  }
}

export async function eventoCte(admin: ClienteAdmin, job: Job, teste: OpcoesTeste = {}) {
  const id = (job.payload as { evento_id?: string } | null)?.evento_id;
  if (!id) return { ignorado: "tarefa sem evento" };
  const { data: ev } = await admin.from("cte_eventos").select("*").eq("id", id).maybeSingle();
  if (!ev || !["na_fila", "enviando", "falha"].includes(ev.situacao)) return { ignorado: "nada a enviar" };
  const { data: e } = await admin.from("cte_emissoes").select("*").eq("id", ev.emissao_id).maybeSingle();
  if (!e || !e.chave || !e.protocolo) return { ignorado: "CT-e sem autorização" };
  const cancelamento = ev.tipo === "cancelamento";
  const tpEvento = cancelamento ? "110111" : "110110";
  const sequencia = cancelamento ? 1 : ev.sequencia;

  const registrarEvento = async (dados: Partial<Evento>) => {
    const { error } = await admin.from("cte_eventos").update(dados as never).eq("id", id);
    if (error) throw new Error(`Falha ao gravar o evento: ${error.message}`);
  };
  const recusar = async (codigo: string, descricao: string) => {
    await registrarEvento({ situacao: "rejeitado", mensagens: [{ codigo, descricao }] as never });
    if (cancelamento) {
      await registrar(admin, e.id, { situacao: "autorizada", mensagens: [{ codigo, descricao }] as never });
      await avisar(admin, e.id);
    }
    return { situacao: "evento_rejeitado", motivo: `${codigo}: ${descricao}` };
  };
  if (!teste.base && envServidor.notasSemRede()) return recusar(PORTAL, "Envio desligado neste ambiente (demonstração ou teste): nada foi enviado à SEFAZ.");
  const cred = await credencialDaEmpresa(admin, e.empresa_id);
  if ("erro" in cred) return recusar(PORTAL, cred.erro);
  const dados = e.dados as unknown as EntradaCte;
  const uf = dados.emitente.endereco.uf;
  const chaves = { chavePem: cred.credencial.chave, certificadoPem: cred.credencial.certificados[0] };
  let evento: { xml: string };
  try {
    const comum = { ambiente: e.ambiente as EntradaCte["ambiente"], uf, chave: e.chave, documento: dados.emitente.documento, quando: new Date(Date.now() - 30_000) };
    evento = cancelamento
      ? eventoCancelamentoCte({ ...comum, protocolo: e.protocolo, justificativa: ev.texto }, chaves)
      : eventoCartaCorrecaoCte({ ...comum, sequencia, correcoes: (ev.correcoes ?? []) as unknown as CorrecaoCte[] }, chaves);
  } catch (err) {
    return recusar(PORTAL, mensagem(err));
  }

  const concluir = async (proc: string | null, protocolo: string | null, registradoEm: string | null) => {
    await registrarEvento({
      situacao: "registrado",
      protocolo,
      registrado_em: registradoEm ? new Date(registradoEm).toISOString() : new Date().toISOString(),
      xml: proc,
      mensagens: null,
    });
    if (cancelamento) {
      await registrar(admin, e.id, { situacao: "cancelada", cancelada_em: new Date().toISOString(), mensagens: null });
      await avisar(admin, e.id);
    }
    if (e.ambiente === "producao" && proc) {
      try {
        const { data: emp } = await admin.from("empresas").select("documento").eq("id", e.empresa_id).maybeSingle();
        const nome = `${cancelamento ? "Cancelamento" : `CCe-${ev.sequencia}`}-CTe-${e.numero}-${e.chave}.xml`;
        await guardarNosDocumentos(admin, e.empresa_id, emp?.documento ?? dados.emitente.documento, proc, nome);
      } catch (err) {
        console.error("[cte] registro do evento:", mensagem(err));
      }
    }
    return { situacao: "registrado", tipo: ev.tipo };
  };

  await registrarEvento({ situacao: "enviando", tentativas: ev.tentativas + 1 });
  try {
    const conexao: ConexaoSefazCte = { uf, ambiente: e.ambiente as ConexaoSefazCte["ambiente"], credencial: cred.credencial, base: teste.base, ca: teste.ca };
    const r = await enviarEventoCte(conexao, evento.xml);
    if (EVENTO_CTE_ACEITO.has(r.cStat)) return concluir(r.xml ? montarProcEventoCte(evento.xml, r.xml) : null, r.protocolo, r.registradoEm);
    // Recusado: se o mesmo evento já estava registrado (resposta anterior perdida), a consulta do CT-e mostra
    const s = await consultarCte(conexao, e.chave);
    const ja = eventoRegistrado(s.eventos, tpEvento, sequencia);
    if (ja) return concluir(ja.proc, ja.retorno.protocolo, ja.retorno.registradoEm);
    return recusar(r.cStat, r.xMotivo);
  } catch (err) {
    if (ultimaTentativa(job) || (err instanceof ErroConexao && err.codigo === "certificado")) {
      return recusar(err instanceof ErroConexao ? err.codigo : PORTAL, mensagem(err));
    }
    await registrarEvento({ situacao: "falha", mensagens: [{ codigo: err instanceof ErroConexao ? err.codigo : PORTAL, descricao: mensagem(err) }] as never });
    throw err;
  }
}
