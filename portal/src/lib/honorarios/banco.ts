import "server-only";
import { randomBytes } from "node:crypto";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { montarPixDinamico } from "./pix";
import { reciboDaCobranca } from "./recibo";
import { consultarCobv, criarCobv, listarPix, removerCobv, SICREDI_PRODUCAO, txidCobv, type CobvBanco, type ConexaoSicredi } from "./sicredi-api";

/**
 * Ligação das cobranças com o banco (API Pix do Sicredi): criar a cobrança
 * com vencimento, tirar do banco quando cancelada ou paga por fora, e dar
 * baixa sozinho quando o banco confirma o pagamento (consulta ao banco —
 * o aviso do banco só dispara a consulta).
 */

export interface CredenciaisBanco {
  clientId: string;
  clientSecret: string;
  certificado: string;
  chave: string;
}

export async function conexaoDoBanco(admin: ClienteAdmin): Promise<{ conexao: ConexaoSicredi; ativo: boolean; cfg: { pix_nome: string | null; pix_cidade: string | null; pix_chave: string | null } } | null> {
  const [{ data: cfg }, { data: segredo }] = await Promise.all([
    admin.from("honorarios_config").select("banco_pix, banco_ativo, banco_ambiente, banco_url_token, banco_url_api, pix_nome, pix_cidade, pix_chave").eq("id", 1).single(),
    admin.from("honorarios_banco_segredo").select("conteudo_cifrado").eq("id", 1).maybeSingle(),
  ]);
  if (!cfg?.banco_pix || !segredo) return null;
  const cred = JSON.parse(decifrar(segredo.conteudo_cifrado)) as CredenciaisBanco & { ca?: string };
  const producao = cfg.banco_ambiente === "producao";
  return {
    conexao: {
      urlToken: producao ? SICREDI_PRODUCAO.urlToken : (cfg.banco_url_token ?? ""),
      urlApi: producao ? SICREDI_PRODUCAO.urlApi : (cfg.banco_url_api ?? ""),
      clientId: cred.clientId,
      clientSecret: cred.clientSecret,
      certificado: cred.certificado,
      chave: cred.chave,
      ca: cred.ca,
    },
    ativo: cfg.banco_ativo,
    cfg: { pix_nome: cfg.pix_nome, pix_cidade: cfg.pix_cidade, pix_chave: cfg.pix_chave },
  };
}

const erroTexto = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Cria a cobrança com vencimento no banco e guarda o Pix dinâmico. */
export async function criarNoBanco(admin: ClienteAdmin, cobrancaId: string): Promise<{ ok: boolean; erro?: string }> {
  const ligacao = await conexaoDoBanco(admin);
  if (!ligacao?.ativo) return { ok: false, erro: "ligação com o banco desligada" };
  const { data: c } = await admin.from("honorarios_cobrancas").select("*").eq("id", cobrancaId).single();
  if (!c || c.situacao !== "aberta") return { ok: false, erro: "cobrança fora de aberto" };
  const registrar = (txid: string | null, pix: string | null, situacao: string, erro: string | null) =>
    admin.rpc("honorarios_banco_registrar_cobranca", { p_id: cobrancaId, p_txid: txid as string, p_pix: pix as string, p_situacao: situacao, p_erro: erro as string });
  if (!c.pagador_documento) {
    await registrar(null, null, "erro", "Sem CPF/CNPJ do cliente: o banco exige o documento de quem paga. Vale o Pix comum.");
    return { ok: false, erro: "sem documento" };
  }
  const chave = c.pix_chave ?? ligacao.cfg.pix_chave;
  if (!chave) {
    await registrar(null, null, "erro", "Sem chave Pix cadastrada.");
    return { ok: false, erro: "sem chave" };
  }
  const txid = txidCobv(c.ano, c.numero, randomBytes(8).toString("hex"));
  try {
    const r = await criarCobv(ligacao.conexao, {
      txid,
      vencimento: c.vencimento,
      valor: String(c.valor),
      devedor: { documento: c.pagador_documento, nome: c.pagador_nome },
      chave,
      descricao: `${c.descricao} (cobrança ${String(c.numero).padStart(4, "0")}/${c.ano})`,
      multaPercentual: Number(c.multa_percentual),
      jurosMesPercentual: Number(c.juros_mes_percentual),
      cobrarEncargos: c.cobrar_encargos,
    });
    const pix = r.pixCopiaECola ?? (r.location ? montarPixDinamico({ location: r.location, nome: c.pix_nome ?? ligacao.cfg.pix_nome ?? "", cidade: c.pix_cidade ?? ligacao.cfg.pix_cidade ?? "" }) : null);
    await registrar(txid, pix, "ativa", null);
    return { ok: true };
  } catch (e) {
    await registrar(null, null, "erro", erroTexto(e));
    return { ok: false, erro: erroTexto(e) };
  }
}

export async function removerDoBanco(admin: ClienteAdmin, cobrancaId: string, txid: string) {
  const ligacao = await conexaoDoBanco(admin);
  if (!ligacao) return;
  await removerCobv(ligacao.conexao, txid);
  const { data: c } = await admin.from("honorarios_cobrancas").select("banco_txid").eq("id", cobrancaId).single();
  if (c?.banco_txid === txid) await admin.rpc("honorarios_banco_registrar_cobranca", { p_id: cobrancaId, p_txid: txid, p_pix: null as unknown as string, p_situacao: "removida", p_erro: null as unknown as string });
}

/** Pagamento confirmado na consulta ao banco: baixa, DRE, recibo e agradecimento. */
export async function baixaPeloBanco(admin: ClienteAdmin, cobrancaId: string, cobv: CobvBanco): Promise<boolean> {
  if (cobv.status !== "CONCLUIDA" || !cobv.pix.length) return false;
  const valor = cobv.pix.reduce((t, p) => t + Number(p.valor), 0);
  const ultimo = cobv.pix.map((p) => p.horario).sort().at(-1)!;
  const data = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ultimo));
  const { data: r, error } = await admin.rpc("honorarios_banco_baixar", { p_id: cobrancaId, p_valor: Number(valor.toFixed(2)), p_data: data, p_e2e: cobv.pix.map((p) => p.endToEndId).join(", ").slice(0, 200) });
  if (error) throw new Error(error.message);
  if ((r as { ignorada?: boolean } | null)?.ignorada) return false;
  const { data: cfg } = await admin.from("honorarios_config").select("recibo_automatico").eq("id", 1).single();
  if (cfg?.recibo_automatico) {
    const rec = await reciboDaCobranca(admin, cobrancaId, { publicar: false, servico: true });
    if (!rec.reciboId) await admin.rpc("honorarios_banco_vincular_recibo", { p_id: cobrancaId, p_recibo_id: null as unknown as string });
  } else {
    await admin.rpc("honorarios_banco_vincular_recibo", { p_id: cobrancaId, p_recibo_id: null as unknown as string });
  }
  return true;
}

/** Confere no banco as cobranças destes txids (aviso do banco ou botão da tela). */
export async function conferirNoBanco(admin: ClienteAdmin, txids: string[]): Promise<number> {
  const ligacao = await conexaoDoBanco(admin);
  if (!ligacao?.ativo || !txids.length) return 0;
  const { data: cobrancas } = await admin.from("honorarios_cobrancas").select("id, banco_txid").in("banco_txid", txids.slice(0, 200)).eq("situacao", "aberta");
  let baixas = 0;
  for (const c of cobrancas ?? []) {
    const cobv = await consultarCobv(ligacao.conexao, c.banco_txid!);
    if (await baixaPeloBanco(admin, c.id, cobv)) baixas++;
  }
  return baixas;
}

/** Consulta periódica: os Pix recebidos desde a última conferência (segurança caso o aviso do banco falhe). */
export async function conferirJanela(admin: ClienteAdmin): Promise<number> {
  const ligacao = await conexaoDoBanco(admin);
  if (!ligacao?.ativo) return 0;
  const { data: cfg } = await admin.from("honorarios_config").select("banco_conferido_em").eq("id", 1).single();
  const fim = new Date();
  const inicio = new Date(Math.max(Date.parse(cfg?.banco_conferido_em ?? "") - 3_600_000 || 0, fim.getTime() - 3 * 86_400_000));
  const pix = await listarPix(ligacao.conexao, inicio, fim);
  const txids = [...new Set(pix.map((p) => p.txid).filter((t): t is string => Boolean(t)))];
  const baixas = await conferirNoBanco(admin, txids);
  await admin.from("honorarios_config").update({ banco_conferido_em: fim.toISOString() }).eq("id", 1);
  return baixas;
}

/** Tarefa da fila "pix_banco": criar, remover, trocar, conferir (txids) ou janela (consulta periódica). */
export async function executarPixBanco(admin: ClienteAdmin, job: { payload: unknown }) {
  const p = (job.payload ?? {}) as { acao?: string; cobranca_id?: string; txid?: string; txids?: string[] };
  switch (p.acao) {
    case "criar":
      return criarNoBanco(admin, p.cobranca_id!);
    case "remover":
      await removerDoBanco(admin, p.cobranca_id!, p.txid!);
      return { removida: p.txid };
    case "trocar":
      await removerDoBanco(admin, p.cobranca_id!, p.txid!).catch(() => undefined);
      return criarNoBanco(admin, p.cobranca_id!);
    case "conferir":
      return { baixas: await conferirNoBanco(admin, (p.txids ?? []).filter((t) => /^[A-Za-z0-9]{26,35}$/.test(t))) };
    case "janela":
      return { baixas: await conferirJanela(admin) };
    default:
      return { ignorado: "ação desconhecida" };
  }
}

/** Agenda a consulta periódica (no máximo uma a cada 15 minutos). */
export async function agendarConferenciaPeriodica(admin: ClienteAdmin) {
  const { data: cfg } = await admin.from("honorarios_config").select("banco_ativo, banco_conferido_em").eq("id", 1).single();
  if (!cfg?.banco_ativo) return;
  if (cfg.banco_conferido_em && Date.parse(cfg.banco_conferido_em) > Date.now() - 15 * 60_000) return;
  const faixa = Math.floor(Date.now() / (15 * 60_000));
  await admin.from("jobs").upsert({ tipo: "pix_banco", payload: { acao: "janela" }, chave_idempotencia: `pix_banco:janela:${faixa}`, prioridade: 70 }, { onConflict: "chave_idempotencia", ignoreDuplicates: true });
}
