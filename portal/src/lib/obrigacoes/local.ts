import "server-only";
import type { Sessao } from "@/lib/auth/sessao";

/** Local do escritório (UF, município do IBGE e lista de municípios da UF) para simulações e formulários. */
export async function carregarLocalEscritorio(supabase: Sessao["supabase"]) {
  const { data: escritorio } = await supabase.from("escritorio").select("cidade, uf").eq("id", 1).maybeSingle();
  const uf = escritorio?.uf?.trim().toUpperCase() || null;
  if (!uf) return { uf: null, municipio: null, municipios: [] as { ibge: string; nome: string }[] };
  const { data: municipios } = await supabase.from("municipios").select("ibge, nome").eq("uf", uf).order("nome");
  const cidade = escritorio?.cidade?.trim() ?? "";
  const municipio = (municipios ?? []).find((m) => m.nome.localeCompare(cidade, "pt-BR", { sensitivity: "base" }) === 0)?.ibge ?? null;
  return { uf, municipio, municipios: municipios ?? [] };
}
