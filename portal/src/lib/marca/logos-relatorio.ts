import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { tipoImagem } from "@/lib/imagens";

/**
 * As duas logos dos relatórios de uma empresa: a do escritório (enviada em
 * Configurações; sem ela, os relatórios usam a logomarca oficial) e a do
 * cliente (cadastro da empresa, armazenamento privado). As imagens vão
 * embutidas no arquivo (PDF ou planilha), sem depender de endereços externos.
 */

export interface ImagemEmbutida {
  /** data URL (PNG ou JPEG). */
  dados: string;
}

/** Qualquer cliente do Supabase serve (o do usuário, que segue as regras de acesso, ou o do servidor). */
type ComArmazenamento = Pick<SupabaseClient, "storage">;

/** Logo enviada pelo escritório (endereço público) como data URL para embutir. */
export async function logoEmbutida(url: string | null): Promise<ImagemEmbutida | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const tipo = r.headers.get("content-type") ?? "";
    if (!r.ok || !/image\/(png|jpe?g)/.test(tipo)) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > 2_000_000) return null;
    return { dados: `data:${tipo.split(";")[0]};base64,${bytes.toString("base64")}` };
  } catch {
    return null;
  }
}

/** Logo do cliente (armazenamento privado), lida com as regras de acesso de quem pediu. */
export async function logoDoCliente(supabase: ComArmazenamento, caminho: string | null | undefined): Promise<ImagemEmbutida | null> {
  if (!caminho) return null;
  try {
    const { data } = await supabase.storage.from("empresas-logos").download(caminho);
    if (!data || data.size > 2_000_000) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const tipo = tipoImagem(bytes);
    return tipo ? { dados: `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}` } : null;
  } catch {
    return null;
  }
}

/** Logo do escritório (a enviada) e a do cliente, prontas para embutir. */
export async function logosDaEmpresa(supabase: ComArmazenamento, logoPathCliente: string | null | undefined) {
  const escritorio = await obterEscritorioPublico();
  const [doEscritorio, doCliente] = await Promise.all([logoEmbutida(escritorio.logoUrl), logoDoCliente(supabase, logoPathCliente)]);
  return { escritorio: doEscritorio, cliente: doCliente };
}
