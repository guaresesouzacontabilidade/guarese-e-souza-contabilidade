import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { ContextoTarefa, Job } from "@/lib/jobs/executor";
import { decodificarTexto } from "@/lib/extratos/comum";
import { VERSAO_LEITURA, lerXmlFiscal } from "./xml";

/**
 * Releitura de notas já registradas: abre o XML guardado (versão atual do
 * documento) e grava os campos que a leitura atual traz a mais. Usada pelo
 * auditor fiscal e pela apuração do ICMS.
 */
export async function relerNota(admin: ClienteAdmin, documento: string, n: { id: string; documento_id: string }) {
  const { data: doc } = await admin.from("documentos").select("versao_atual").eq("id", n.documento_id).maybeSingle();
  const { data: versao } = doc
    ? await admin.from("documento_versoes").select("storage_path").eq("documento_id", n.documento_id).eq("versao", doc.versao_atual).maybeSingle()
    : { data: null };
  let atualizada = false;
  if (versao?.storage_path) {
    const { data: arquivo } = await admin.storage.from("documentos").download(versao.storage_path);
    if (arquivo) {
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const cabecalho = new TextDecoder("latin1").decode(bytes.slice(0, 200));
      const texto = decodificarTexto(bytes, /encoding="(iso-8859-1|windows-1252)"/i.exec(cabecalho)?.[1]);
      const lido = lerXmlFiscal(texto, { documento });
      if (lido.sucesso && lido.dados.tipo === "nota") {
        const { error: e } = await admin.rpc("atualizar_leitura_xml_fiscal", { p_documento_fiscal_id: n.id, p_dados: lido.dados as never });
        atualizada = !e;
      }
    }
  }
  // Arquivo ausente ou ilegível: marca como relida para não tentar para sempre (fica com os dados antigos).
  if (!atualizada) await admin.from("documentos_fiscais").update({ leitura_versao: VERSAO_LEITURA }).eq("id", n.id);
  return atualizada;
}

const LOTE = 150;
const SIMULTANEAS = 6;

/**
 * Tarefa "reler_notas_mes": relê as NF-e/NFC-e de uma empresa e competência
 * gravadas com uma leitura anterior à atual (ex.: antes do frete por item e do
 * crédito do Simples, usados na apuração do ICMS). Continua numa nova tarefa
 * quando o tempo acaba.
 */
export async function executarReleituraMes(admin: ClienteAdmin, job: Job, contexto: ContextoTarefa) {
  const p = job.payload as { empresa_id?: string; competencia?: string; rodada?: number };
  if (!p?.empresa_id || !/^\d{4}-\d{2}-01$/.test(p.competencia ?? "")) return { ignorado: "tarefa sem empresa ou competência" };
  const { data: empresa } = await admin.from("empresas").select("documento").eq("id", p.empresa_id).maybeSingle();
  if (!empresa?.documento) return { ignorado: "empresa sem documento" };
  const filtro = () =>
    admin
      .from("documentos_fiscais")
      .select("id, documento_id", { count: "exact" })
      .eq("empresa_id", p.empresa_id!)
      .eq("competencia", p.competencia!)
      .in("modelo", ["55", "65"])
      .lt("leitura_versao", VERSAO_LEITURA);
  const { data: notas, error } = await filtro().limit(LOTE);
  if (error) throw new Error(`Falha ao listar as notas para releitura: ${error.message}`);
  let relidas = 0;
  const lista = notas ?? [];
  // Deixa folga para gravar a continuação antes do prazo da rodada
  const limite = Math.min(contexto.prazo - 5_000, Date.now() + 40_000);
  for (let i = 0; i < lista.length && Date.now() < limite; i += SIMULTANEAS) {
    const grupo = lista.slice(i, i + SIMULTANEAS);
    await Promise.all(grupo.map((n) => relerNota(admin, empresa.documento, n)));
    relidas += grupo.length;
  }
  const { count } = await filtro().limit(1);
  const pendentes = count ?? 0;
  if (pendentes > 0 && relidas > 0) {
    const rodada = (p.rodada ?? 0) + 1;
    await admin.from("jobs").insert({
      tipo: "reler_notas_mes",
      payload: { empresa_id: p.empresa_id, competencia: p.competencia, rodada },
      empresa_id: p.empresa_id,
      chave_idempotencia: `reler:${p.empresa_id}:${p.competencia}:${job.id}:${rodada}`,
      prioridade: 70,
    });
  }
  return { relidas, pendentes };
}
