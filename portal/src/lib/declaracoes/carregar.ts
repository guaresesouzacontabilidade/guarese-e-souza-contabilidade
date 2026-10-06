import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { logoEmbutida } from "@/lib/relatorios/cabecalho";
import { formatarCep, formatarTelefone } from "@/lib/formatos";
import { tipoImagem } from "@/lib/imagens";
import type { DeclaracaoPdf } from "./pdf";

type Cliente = ContextoEmpresa["supabase"];

const endereco = (e: { logradouro: string | null; numero: string | null; complemento?: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null }) =>
  [
    [e.logradouro, e.numero ? `nº ${e.numero}` : null, e.complemento].filter(Boolean).join(", "),
    e.bairro,
    [e.cidade, e.uf].filter(Boolean).join(" – "),
    e.cep ? `CEP ${formatarCep(e.cep)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

/** Logo do cliente (armazenamento privado), lida com as regras de acesso de quem pediu. */
async function logoCliente(supabase: Cliente, caminho: string | null): Promise<{ dados: string } | null> {
  if (!caminho) return null;
  const { data } = await supabase.storage.from("empresas-logos").download(caminho);
  if (!data || data.size > 2_000_000) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const tipo = tipoImagem(bytes);
  return tipo ? { dados: `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}` } : null;
}

/** Monta os dados do PDF de uma declaração (null quando a pessoa não pode vê-la). */
export async function carregarDeclaracaoPdf(supabase: Cliente, id: string): Promise<{ pdf: DeclaracaoPdf; empresaId: string; nomeEmpresa: string } | null> {
  const { data: d } = await supabase.from("declaracoes_faturamento").select("*").eq("id", id).maybeSingle();
  if (!d) return null;
  const [{ data: empresa }, escritorio] = await Promise.all([
    supabase.from("empresas").select("razao_social, nome_fantasia, documento, logradouro, numero, complemento, bairro, cidade, uf, cep, logo_path").eq("id", d.empresa_id).maybeSingle(),
    obterEscritorioPublico(),
  ]);
  if (!empresa) return null;
  const [logoEsc, logoCli] = await Promise.all([logoEmbutida(escritorio.logoUrl), logoCliente(supabase, empresa.logo_path)]);
  return {
    empresaId: d.empresa_id,
    nomeEmpresa: empresa.nome_fantasia ?? empresa.razao_social,
    pdf: {
      id: d.id,
      empresa: { razao: empresa.razao_social, documento: empresa.documento, endereco: endereco(empresa) },
      escritorio: {
        nome: escritorio.nome_fantasia,
        razao: escritorio.razao_social,
        cnpj: escritorio.cnpj,
        endereco: endereco(escritorio),
        email: escritorio.email,
        telefone: escritorio.telefone ? formatarTelefone(escritorio.telefone) : null,
      },
      logoEscritorio: logoEsc,
      logoCliente: logoCli,
      periodo: { inicio: d.periodo_inicio, fim: d.periodo_fim },
      meses: (d.meses as { competencia: string; valor: number | string }[]).map((m) => ({ competencia: m.competencia, valor: m.valor })),
      finalidade: d.finalidade,
      observacao: d.observacao,
      cidade: d.cidade,
      uf: d.uf,
      data: d.data_declaracao,
      representante: { nome: d.representante_nome, cpf: d.representante_cpf, cargo: d.representante_cargo },
      contador: { nome: d.contador_nome, crc: d.contador_crc },
      situacao: d.situacao as DeclaracaoPdf["situacao"],
      emitidaEm: d.criado_em,
    },
  };
}
