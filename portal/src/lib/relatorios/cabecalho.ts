import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { formatarCep, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { logoDoCliente, logoEmbutida } from "@/lib/marca/logos-relatorio";
import type { Cabecalho } from "./pdf";

type Cliente = ContextoEmpresa["supabase"];

/** Endereço em uma linha (logradouro, número, bairro, cidade – UF, CEP). */
export function enderecoEmLinha(e: { logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null }) {
  return [
    [e.logradouro, e.numero].filter(Boolean).join(", nº "),
    e.bairro,
    [e.cidade, e.uf].filter(Boolean).join(" – "),
    e.cep ? `CEP ${formatarCep(e.cep)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Cabeçalho dos PDFs da empresa. Por padrão o documento é da própria empresa
 * (só a marca dela, sem a do escritório); com marca "escritorio" (estudo
 * tributário, relatório do auditor), vai a logo do escritório e a do cliente.
 */
export async function montarCabecalho(
  supabase: Cliente,
  empresaId: string,
  dados: {
    titulo: string;
    subtitulo: string;
    situacao: Cabecalho["situacao"];
    geradoEm?: string;
    observacao?: string;
    notaFinal?: string | null;
    marca?: Cabecalho["marca"];
  },
): Promise<Cabecalho> {
  const marca = dados.marca ?? "empresa";
  const [{ data: empresa }, escritorio] = await Promise.all([
    supabase.from("empresas").select("razao_social, nome_fantasia, documento, logo_path, logradouro, numero, bairro, cidade, uf, cep, telefone, email").eq("id", empresaId).maybeSingle(),
    obterEscritorioPublico(),
  ]);
  const contato = [empresa?.telefone ? formatarTelefone(empresa.telefone) : null, empresa?.email].filter(Boolean).join(" · ") || null;
  return {
    titulo: dados.titulo,
    subtitulo: dados.subtitulo,
    empresa: {
      nome: empresa?.razao_social ?? "Empresa",
      documento: empresa ? formatarDocumento(empresa.documento) : "",
      endereco: empresa ? enderecoEmLinha(empresa) || null : null,
      contato,
    },
    escritorio: { nome: escritorio.nome_fantasia, razao: escritorio.razao_social, cnpj: escritorio.cnpj, email: escritorio.email, endereco: enderecoEmLinha(escritorio) },
    marca,
    logo: marca === "escritorio" ? await logoEmbutida(escritorio.logoUrl) : null,
    logoCliente: await logoDoCliente(supabase, empresa?.logo_path),
    situacao: dados.situacao,
    geradoEm: dados.geradoEm ?? new Date().toISOString(),
    observacao: dados.observacao,
    notaFinal: dados.notaFinal,
  };
}

/** "revisado" quando todas as competências do período estão fechadas. */
export async function situacaoPeriodo(supabase: Cliente, empresaId: string, inicio: string, fim: string): Promise<"revisado" | "preliminar"> {
  const { data } = await supabase
    .from("competencias")
    .select("competencia, status")
    .eq("empresa_id", empresaId)
    .gte("competencia", inicio.slice(0, 8) + "01")
    .lte("competencia", fim);
  const meses: string[] = [];
  for (let m = inicio.slice(0, 8) + "01"; m <= fim; ) {
    meses.push(m);
    const [a, mm] = m.split("-").map(Number);
    m = mm === 12 ? `${a + 1}-01-01` : `${a}-${String(mm + 1).padStart(2, "0")}-01`;
  }
  const fechadas = new Set((data ?? []).filter((c) => c.status === "fechada").map((c) => c.competencia));
  return meses.every((m) => fechadas.has(m)) ? "revisado" : "preliminar";
}

export function nomeArquivo(partes: (string | null | undefined)[], extensao: string) {
  const slug = partes
    .filter(Boolean)
    .join("-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 90);
  return `${slug || "relatorio"}.${extensao}`;
}
