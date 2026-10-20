import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { Job } from "@/lib/jobs/executor";
import { envServidor } from "@/lib/env-servidor";
import { ErroConexao } from "@/lib/notas-automaticas/transporte";
import { importarXmlAutomatico } from "@/lib/notas-automaticas/importar";
import { credencialDaEmpresa } from "@/lib/nfse-emissao/emitir";
import { calcularNota, dataHoraUf, type EntradaNfe, type NotaCalculada } from "./calculo";
import { fmt } from "./decimal";
import { nfeAssinada } from "./nfe";
import { eventoCancelamento, eventoCartaCorrecao } from "./eventos";
import {
  AUTORIZADA,
  DENEGADA,
  DUPLICIDADE,
  EVENTO_ACEITO,
  consultarNota,
  consultarRecibo,
  enviarEvento,
  enviarLote,
  montarNfeProc,
  montarProcEvento,
  type ConexaoSefaz,
  type Protocolo,
} from "./sefaz";

/**
 * Tarefas da fila que falam com a SEFAZ (autorizador do estado do emitente):
 *  - emitir_nfe: monta e assina a NF-e, envia o lote e guarda a nota
 *    autorizada (nfeProc) ou o motivo da rejeição. Se uma tentativa anterior
 *    ficou sem resposta, consulta antes a chave (ou o recibo), para nunca
 *    emitir duas vezes; a nota reenviada é exatamente a mesma (mesma chave e
 *    data de emissão).
 *  - evento_nfe: cancelamento (110111) e carta de correção (110110).
 * Depois da autorização: guias da nota (ICMS da operação, do frete, DIFAL,
 * contribuições) com o valor calculado; em produção, a nota entra nos
 * documentos fiscais da empresa. Notas de homologação (teste) não entram.
 */

type Emissao = Database["public"]["Tables"]["nfe_emissoes"]["Row"];
type Evento = Database["public"]["Tables"]["nfe_eventos"]["Row"];
export interface OpcoesTeste {
  base?: string;
  ca?: string[];
}

const PORTAL = "PORTAL";

function mensagem(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Dados da nota (montados pelo banco no pedido) + número, série, código e data de emissão. */
export function entradaDaEmissao(e: Pick<Emissao, "dados" | "ambiente" | "serie" | "numero" | "codigo_numerico">, emitidaEm: Date): EntradaNfe {
  const d = e.dados as unknown as Omit<EntradaNfe, "ambiente" | "emitidaEm" | "serie" | "numero" | "codigoNumerico">;
  return {
    ...d,
    ambiente: e.ambiente as EntradaNfe["ambiente"],
    emitidaEm,
    serie: e.serie,
    numero: Number(e.numero),
    codigoNumerico: e.codigo_numerico,
  };
}

/** Resumo dos valores (lista, tela da nota e DANFE sem refazer o cálculo). */
export function resumoTotais(n: NotaCalculada) {
  const t = n.totais;
  const v = (x: bigint) => fmt(x, 2);
  return {
    vProd: v(t.vProd),
    vFrete: v(t.vFrete),
    vSeg: v(t.vSeg),
    vDesc: v(t.vDesc),
    vOutro: v(t.vOutro),
    vBC: v(t.vBC),
    vICMS: v(t.vICMS),
    vICMSUFDest: v(t.vICMSUFDest),
    vFCPUFDest: v(t.vFCPUFDest),
    vPIS: v(t.vPIS),
    vCOFINS: v(t.vCOFINS),
    vIBS: t.ibscbs ? v(t.ibscbs.vIBS) : null,
    vCBS: t.ibscbs ? v(t.ibscbs.vCBS) : null,
    vNF: v(t.vNF),
    icmsFrete: n.icmsFrete ? { base: v(n.icmsFrete.vBCRet), aliquota: fmt(n.icmsFrete.pICMSRet, 2), valor: v(n.icmsFrete.vICMSRet) } : null,
    funrural: n.funrural ? { percentual: fmt(n.funrural.percentual, 2), valor: v(n.funrural.valor), modo: n.funrural.modo } : null,
    contribuicoes: n.contribuicoes.map((c) => ({ nome: c.nome, valor: v(c.valor) })),
    pesoKg: n.pesoLiquidoKg != null ? fmt(n.pesoLiquidoKg, 3) : null,
  };
}

async function registrar(admin: ClienteAdmin, id: string, dados: Partial<Emissao>) {
  const { error } = await admin.from("nfe_emissoes").update(dados as never).eq("id", id);
  if (error) throw new Error(`Falha ao gravar a nota: ${error.message}`);
}

async function avisar(admin: ClienteAdmin, id: string) {
  await admin.rpc("nfe_avisar", { p_id: id });
}

const ultimaTentativa = (job: Job) => job.tentativas >= (job.max_tentativas ?? 5);
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Guias da nota autorizada, com o valor calculado e vencimento no dia da emissão (pagamento antes da saída). */
async function criarGuias(admin: ClienteAdmin, e: Emissao, nota: NotaCalculada, emitidaEm: Date) {
  if (!nota.guias.length) return;
  const codigos = ((e.dados as Record<string, unknown>).codigosReceita ?? {}) as Record<string, string | null>;
  const dia = dataHoraUf(emitidaEm, nota.entrada.emitente.endereco.uf).slice(0, 10);
  const linhas = nota.guias.map((g) => ({
    emissao_id: e.id,
    empresa_id: e.empresa_id,
    tipo: g.tipo,
    descricao: g.descricao,
    uf: g.uf,
    codigo_receita: g.codigoReceita ?? codigos[g.tipo] ?? null,
    valor: Number(fmt(g.valor, 2)),
    vencimento: dia,
  }));
  const { error } = await admin.from("nfe_guias").upsert(linhas, { onConflict: "emissao_id,tipo,descricao", ignoreDuplicates: true });
  if (error) console.error("[nfe] guias:", error.message);
}

async function concluirAutorizada(admin: ClienteAdmin, e: Emissao, emp: { documento: string }, xmlAssinado: string, p: Protocolo, emitidaEm: Date) {
  const proc = montarNfeProc(xmlAssinado, p.xml!);
  await registrar(admin, e.id, {
    situacao: "autorizada",
    protocolo: p.protocolo,
    autorizada_em: p.recebidaEm ? new Date(p.recebidaEm).toISOString() : new Date().toISOString(),
    xml_autorizado: proc,
    mensagens: null,
  });
  try {
    await criarGuias(admin, e, calcularNota(entradaDaEmissao(e, emitidaEm)), emitidaEm);
  } catch (err) {
    console.error("[nfe] cálculo das guias:", mensagem(err));
  }
  if (e.ambiente === "producao") {
    try {
      const r = await importarXmlAutomatico(admin, {
        empresaId: e.empresa_id,
        documentoEmpresa: emp.documento,
        xml: proc,
        nome: `NFe-${e.numero}-${p.chave}.xml`,
        origem: "emissao_nfe",
        categoriaPadrao: "nfe_saida_xml",
      });
      if (r.documentoId) await registrar(admin, e.id, { documento_id: r.documentoId });
    } catch (err) {
      // A nota já está autorizada e guardada; o registro nos documentos pode ser refeito pela busca automática
      console.error("[nfe] registro nos documentos:", mensagem(err));
    }
    try {
      const { enviarParaDestinatario } = await import("./email-destinatario");
      if (await enviarParaDestinatario(admin, e.id)) await registrar(admin, e.id, { email_destinatario_enviado_em: new Date().toISOString() });
    } catch (err) {
      console.error("[nfe] e-mail ao destinatário:", mensagem(err));
    }
  }
  await avisar(admin, e.id);
  return { situacao: "autorizada", chave: p.chave };
}

export async function emitirNfe(admin: ClienteAdmin, job: Job, teste: OpcoesTeste = {}) {
  const id = (job.payload as { emissao_id?: string } | null)?.emissao_id;
  if (!id) return { ignorado: "tarefa sem nota" };
  const { data: e } = await admin.from("nfe_emissoes").select("*").eq("id", id).maybeSingle();
  if (!e) return { ignorado: "nota não encontrada" };
  if (!["na_fila", "enviando", "falha", "aguardando"].includes(e.situacao)) return { ignorado: `nota ${e.situacao}` };
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

  // A nota já montada numa tentativa anterior é reenviada igual (mesma chave e data de emissão)
  let xml = e.xml_assinado;
  let chave = e.chave;
  let emitidaEm = e.emitida_em ? new Date(e.emitida_em) : null;
  if (!xml || !chave || !emitidaEm) {
    emitidaEm = new Date(Date.now() - 30_000);
    try {
      const m = nfeAssinada(entradaDaEmissao(e, emitidaEm), chaves);
      xml = m.xml;
      chave = m.chave;
      await registrar(admin, id, { chave, emitida_em: emitidaEm.toISOString(), xml_assinado: xml, totais: resumoTotais(m.nota) as never });
    } catch (err) {
      return rejeitar(PORTAL, mensagem(err));
    }
  }
  const uf = (e.dados as unknown as EntradaNfe).emitente.endereco.uf;
  const conexao: ConexaoSefaz = { uf, ambiente: e.ambiente as ConexaoSefaz["ambiente"], credencial: cred.credencial, base: teste.base, ca: teste.ca };
  const atualizada: Emissao = { ...e, chave, xml_assinado: xml, emitida_em: emitidaEm.toISOString() };

  const tratarProtocolo = async (p: Protocolo) => {
    if (AUTORIZADA.has(p.cStat)) return concluirAutorizada(admin, atualizada, emp, xml!, p, emitidaEm!);
    if (DENEGADA.has(p.cStat)) {
      await registrar(admin, id, {
        situacao: "denegada",
        protocolo: p.protocolo,
        xml_autorizado: p.xml ? montarNfeProc(xml!, p.xml) : null,
        mensagens: [{ codigo: p.cStat, descricao: p.xMotivo }] as never,
      });
      await avisar(admin, id);
      return { situacao: "denegada", motivo: p.xMotivo };
    }
    if (DUPLICIDADE.has(p.cStat)) {
      // A resposta de uma tentativa anterior pode ter se perdido: a nota pode já estar autorizada
      const s = await consultarNota(conexao, chave!);
      if (s.protocolo && AUTORIZADA.has(s.protocolo.cStat)) return concluirAutorizada(admin, atualizada, emp, xml!, s.protocolo, emitidaEm!);
    }
    return rejeitar(p.cStat, p.xMotivo);
  };

  await registrar(admin, id, { situacao: e.situacao === "aguardando" ? "aguardando" : "enviando", tentativas: e.tentativas + 1, ultimo_envio_em: new Date().toISOString() });
  try {
    // Tentativa anterior sem resposta: consulta o recibo ou a chave antes de enviar de novo
    if (e.situacao === "aguardando" && e.recibo) {
      const r = await consultarRecibo(conexao, e.recibo, chave);
      if (r.tipo === "protocolo") return tratarProtocolo(r.protocolo);
      if (r.tipo === "processando") throw new ErroConexao("A SEFAZ ainda está processando o lote. O portal consulta de novo em instantes.", "processando");
    }
    if (e.tentativas > 0) {
      const s = await consultarNota(conexao, chave);
      if (s.protocolo && (AUTORIZADA.has(s.protocolo.cStat) || DENEGADA.has(s.protocolo.cStat))) return tratarProtocolo(s.protocolo);
    }
    const r = await enviarLote(conexao, xml, chave, `${Date.now()}`.slice(-15));
    if (r.tipo === "protocolo") return tratarProtocolo(r.protocolo);
    if (r.tipo === "lote_rejeitado") {
      // 656: consumo indevido (muitas consultas seguidas): espera e tenta de novo
      if (r.cStat === "656") throw new ErroConexao(`${r.cStat}: ${r.xMotivo}`, "consumo_indevido");
      return rejeitar(r.cStat, r.xMotivo);
    }
    // Lote recebido (modo assíncrono): consulta o recibo algumas vezes antes de devolver à fila
    await registrar(admin, id, { situacao: "aguardando", recibo: r.recibo });
    for (let i = 0; i < 3; i++) {
      await esperar(Math.min(Math.max(r.tempoMedio, 1), 5) * 1000);
      const c = await consultarRecibo(conexao, r.recibo, chave);
      if (c.tipo === "protocolo") return tratarProtocolo(c.protocolo);
      if (c.tipo === "erro") return rejeitar(c.cStat, c.xMotivo);
    }
    throw new ErroConexao("A SEFAZ ainda está processando o lote. O portal consulta de novo em instantes.", "processando");
  } catch (err) {
    const erro = { codigo: err instanceof ErroConexao ? err.codigo : PORTAL, descricao: mensagem(err) };
    const { data: agora } = await admin.from("nfe_emissoes").select("situacao").eq("id", id).maybeSingle();
    await registrar(admin, id, { situacao: agora?.situacao === "aguardando" ? "aguardando" : "falha", mensagens: [erro] as never });
    // Certificado recusado não melhora tentando de novo
    if ((err instanceof ErroConexao && err.codigo === "certificado") || ultimaTentativa(job)) {
      await avisar(admin, id);
      return { situacao: "falha", motivo: erro.descricao };
    }
    throw err;
  }
}

export async function eventoNfe(admin: ClienteAdmin, job: Job, teste: OpcoesTeste = {}) {
  const id = (job.payload as { evento_id?: string } | null)?.evento_id;
  if (!id) return { ignorado: "tarefa sem evento" };
  const { data: ev } = await admin.from("nfe_eventos").select("*").eq("id", id).maybeSingle();
  if (!ev || !["na_fila", "enviando", "falha"].includes(ev.situacao)) return { ignorado: "nada a enviar" };
  const { data: e } = await admin.from("nfe_emissoes").select("*").eq("id", ev.emissao_id).maybeSingle();
  if (!e || !e.chave || !e.protocolo) return { ignorado: "nota sem autorização" };
  const cancelamento = ev.tipo === "cancelamento";

  const registrarEvento = async (dados: Partial<Evento>) => {
    const { error } = await admin.from("nfe_eventos").update(dados as never).eq("id", id);
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
  const dados = e.dados as unknown as EntradaNfe;
  const uf = dados.emitente.endereco.uf;
  const chaves = { chavePem: cred.credencial.chave, certificadoPem: cred.credencial.certificados[0] };
  let evento: { xml: string };
  try {
    const comum = { ambiente: e.ambiente as EntradaNfe["ambiente"], uf, chave: e.chave, documento: dados.emitente.documento, quando: new Date(Date.now() - 30_000) };
    evento = cancelamento
      ? eventoCancelamento({ ...comum, protocolo: e.protocolo, justificativa: ev.texto }, chaves)
      : eventoCartaCorrecao({ ...comum, sequencia: ev.sequencia, correcao: ev.texto }, chaves);
  } catch (err) {
    return recusar(PORTAL, mensagem(err));
  }

  await registrarEvento({ situacao: "enviando", tentativas: ev.tentativas + 1 });
  try {
    const conexao: ConexaoSefaz = { uf, ambiente: e.ambiente as ConexaoSefaz["ambiente"], credencial: cred.credencial, base: teste.base, ca: teste.ca };
    const r = await enviarEvento(conexao, evento.xml, `${Date.now()}`.slice(-15));
    // 573: o mesmo evento já estava registrado (resposta anterior perdida)
    if (!EVENTO_ACEITO.has(r.cStat) && r.cStat !== "573") return recusar(r.cStat, r.xMotivo);
    const proc = r.xml ? montarProcEvento(evento.xml, r.xml) : null;
    await registrarEvento({
      situacao: "registrado",
      protocolo: r.protocolo,
      registrado_em: r.registradoEm ? new Date(r.registradoEm).toISOString() : new Date().toISOString(),
      xml: proc,
      mensagens: null,
    });
    if (cancelamento) {
      await registrar(admin, e.id, { situacao: "cancelada", cancelada_em: new Date().toISOString(), mensagens: null });
      await admin
        .from("nfe_guias")
        .update({ situacao: "dispensada", observacao: "Nota cancelada." })
        .eq("emissao_id", e.id)
        .eq("situacao", "a_gerar");
      await avisar(admin, e.id);
    }
    if (e.ambiente === "producao" && proc) {
      try {
        const { data: emp } = await admin.from("empresas").select("documento").eq("id", e.empresa_id).maybeSingle();
        await importarXmlAutomatico(admin, {
          empresaId: e.empresa_id,
          documentoEmpresa: emp?.documento ?? dados.emitente.documento,
          xml: proc,
          nome: `${cancelamento ? "Cancelamento" : `CCe-${ev.sequencia}`}-NFe-${e.numero}-${e.chave}.xml`,
          origem: "emissao_nfe",
          categoriaPadrao: "eventos_fiscais",
        });
      } catch (err) {
        console.error("[nfe] registro do evento:", mensagem(err));
      }
    }
    return { situacao: "registrado", tipo: ev.tipo };
  } catch (err) {
    if (ultimaTentativa(job) || (err instanceof ErroConexao && err.codigo === "certificado")) {
      return recusar(err instanceof ErroConexao ? err.codigo : PORTAL, mensagem(err));
    }
    await registrarEvento({ situacao: "falha", mensagens: [{ codigo: err instanceof ErroConexao ? err.codigo : PORTAL, descricao: mensagem(err) }] as never });
    throw err;
  }
}
