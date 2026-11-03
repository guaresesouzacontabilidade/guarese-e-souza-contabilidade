import "server-only";
import type { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { envServidor } from "@/lib/env-servidor";
import { ErroConexao } from "@/lib/notas-automaticas/transporte";
import { credencialDaEmpresa } from "./emitir";
import { URLS_CONVENIO, consultarConvenio } from "./sefin";
import { avaliarEmissorNacional, type AvisoMunicipio, type ConsultaConvenio } from "./municipio";

type ClienteSessao = Awaited<ReturnType<typeof criarClienteServidor>>;

interface Mensagem {
  codigo?: string;
}

/**
 * Monta o aviso "a empresa pode emitir pelo Emissor Nacional na cidade dela?"
 * de Configurar emissão: consulta o convênio da prefeitura com o certificado
 * da empresa e junta o que o portal já viu (recusa E0039 da última nota e
 * outras empresas da cidade emitindo). As consultas ao banco usam a sessão de
 * quem abriu a tela (só a equipe abre Configurar emissão).
 */
export async function avisoDoMunicipio(
  supabase: ClienteSessao,
  p: { empresaId: string; codigoMunicipio: string; municipio: string | null; ambiente: "homologacao" | "producao"; regime: string },
): Promise<AvisoMunicipio | null> {
  const [{ data: ultima }, { data: outras }, consulta] = await Promise.all([
    // A nota concluída mais recente da empresa nesta cidade e neste ambiente
    supabase
      .from("nfse_emissoes")
      .select("situacao, mensagens, ultimo_envio_em, created_at")
      .eq("empresa_id", p.empresaId)
      .eq("ambiente", p.ambiente)
      .eq("codigo_municipio_emissor", p.codigoMunicipio)
      .in("situacao", ["autorizada", "rejeitada", "cancelando", "cancelada"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("nfse_emissoes")
      .select("empresa_id")
      .eq("ambiente", p.ambiente)
      .eq("codigo_municipio_emissor", p.codigoMunicipio)
      .in("situacao", ["autorizada", "cancelando", "cancelada"])
      .neq("empresa_id", p.empresaId)
      .limit(500),
    consultar(p.empresaId, p.codigoMunicipio, p.ambiente),
  ]);
  const mensagens = Array.isArray(ultima?.mensagens) ? (ultima.mensagens as Mensagem[]) : [];
  const recusaE0039 = ultima?.situacao === "rejeitada" && mensagens.some((m) => m?.codigo === "E0039") ? (ultima.ultimo_envio_em ?? ultima.created_at) : null;
  return avaliarEmissorNacional({
    municipio: p.municipio,
    ambiente: p.ambiente,
    regime: p.regime,
    consulta,
    recusaE0039,
    outrasEmpresasEmitindo: new Set((outras ?? []).map((o) => o.empresa_id)).size,
  });
}

async function consultar(empresaId: string, codigoMunicipio: string, ambiente: "homologacao" | "producao"): Promise<ConsultaConvenio> {
  if (envServidor.notasSemRede()) return { tipo: "desligada" };
  try {
    const cred = await credencialDaEmpresa(criarClienteAdmin(), empresaId);
    if ("erro" in cred) return { tipo: "sem_certificado" };
    const r = await consultarConvenio({ credencial: cred.credencial }, URLS_CONVENIO[ambiente], codigoMunicipio);
    return r === "nao_encontrado" ? { tipo: "nao_encontrado" } : { tipo: "ok", convenio: r };
  } catch (e) {
    const motivo = e instanceof ErroConexao ? e.message : "falha inesperada na consulta.";
    if (!(e instanceof ErroConexao)) console.error("[nfse] consulta do convênio:", e instanceof Error ? e.message : String(e));
    return { tipo: "erro", motivo };
  }
}
