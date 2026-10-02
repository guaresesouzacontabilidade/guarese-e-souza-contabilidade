import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { ListaContrapartes, ListaSimples, PlanoContas, type Categoria, type Contraparte } from "@/components/financeiro/cadastros";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Cadastros financeiros" };

export default async function Cadastros({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/cadastros">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const aba = parametro(sp, "aba", ["categorias", "contrapartes", "centros", "projetos"]) || "categorias";
  const podeEditar = ctx.pode("financeiro.editar");
  const base = `/e/${empresaId}/financeiro/cadastros`;

  let conteudo: React.ReactNode;
  if (aba === "contrapartes") {
    const { data } = await ctx.supabase.from("contrapartes").select("id, nome, documento, papeis, email, telefone, observacoes, ativo").eq("empresa_id", empresaId).order("nome").limit(5000);
    conteudo = <ListaContrapartes empresaId={empresaId} contrapartes={(data ?? []) as Contraparte[]} podeEditar={podeEditar} />;
  } else if (aba === "centros") {
    const { data } = await ctx.supabase.from("centros_custo").select("id, nome, codigo, ativo").eq("empresa_id", empresaId).order("nome");
    conteudo = <ListaSimples empresaId={empresaId} itens={data ?? []} tipo="centro" podeEditar={podeEditar} />;
  } else if (aba === "projetos") {
    const { data } = await ctx.supabase.from("projetos").select("id, nome, codigo, ativo, inicio, fim").eq("empresa_id", empresaId).order("nome");
    conteudo = <ListaSimples empresaId={empresaId} itens={data ?? []} tipo="projeto" podeEditar={podeEditar} />;
  } else {
    const { data } = await ctx.supabase.from("categorias_financeiras").select("id, codigo, nome, tipo, pai_id, sintetica, codigo_sistema, ativa").eq("empresa_id", empresaId).order("codigo");
    conteudo = <PlanoContas empresaId={empresaId} categorias={(data ?? []) as Categoria[]} podeEditar={podeEditar} />;
  }

  return (
    <>
      <CabecalhoPagina titulo="Cadastros financeiros" descricao="Plano de contas gerencial, clientes e fornecedores, centros de custo e projetos." />
      <AbasLink
        ativa={aba}
        abas={[
          { valor: "categorias", rotulo: "Plano de contas", href: base },
          { valor: "contrapartes", rotulo: "Clientes e fornecedores", href: urlCom(base, {}, { aba: "contrapartes" }) },
          { valor: "centros", rotulo: "Centros de custo", href: urlCom(base, {}, { aba: "centros" }) },
          { valor: "projetos", rotulo: "Projetos", href: urlCom(base, {}, { aba: "projetos" }) },
        ]}
      />
      {conteudo}
    </>
  );
}
