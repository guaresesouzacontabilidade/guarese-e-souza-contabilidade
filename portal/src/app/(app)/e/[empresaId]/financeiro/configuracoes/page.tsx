import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { ListaContrapartes, ListaSimples, PlanoContas, type Categoria, type Contraparte } from "@/components/financeiro/cadastros";
import { parametro } from "@/lib/busca";
import { carregarModeloDre } from "@/lib/relatorios/dados";
import { linhaDaConta, modeloPadrao, ordenarLinhas } from "@/lib/relatorios/modelo-dre";
import { TIPOS_DRE } from "@/lib/financeiro/plano-contas";
import { TabelaRecorrencias } from "@/components/financeiro/tabela-recorrencias";
import { FaixasAprovacao } from "@/components/financeiro/faixas-aprovacao";

export const metadata: Metadata = { title: "Configurações do financeiro" };

export default async function ConfiguracoesFinanceiro({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/configuracoes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const aba = parametro(sp, "aba", ["categorias", "contrapartes", "centros", "projetos", "recorrencias", "aprovacao"]) || "categorias";
  const podeEditar = ctx.pode("financeiro.editar");
  const base = `/e/${empresaId}/financeiro/configuracoes`;

  let conteudo: React.ReactNode;
  if (aba === "recorrencias") {
    conteudo = <TabelaRecorrencias ctx={ctx} empresaId={empresaId} />;
  } else if (aba === "aprovacao") {
    const [{ data: faixas }, { count: pendentes }] = await Promise.all([
      ctx.supabase.from("financeiro_aprovacao_faixas").select("valor_minimo, aprovacoes").eq("empresa_id", empresaId).order("valor_minimo"),
      ctx.supabase.from("lancamentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("aprovacao_status", "pendente").in("situacao", ["aberto", "parcial"]),
    ]);
    conteudo = (
      <FaixasAprovacao
        empresaId={empresaId}
        faixas={(faixas ?? []).map((f) => ({ valor_minimo: Number(f.valor_minimo), aprovacoes: f.aprovacoes }))}
        podeEditar={ctx.pode("financeiro.aprovar") && ctx.pode("financeiro.editar")}
        pendentes={pendentes ?? 0}
      />
    );
  } else if (aba === "contrapartes") {
    const { data } = await ctx.supabase.from("contrapartes").select("id, nome, documento, papeis, email, telefone, observacoes, ativo").eq("empresa_id", empresaId).order("nome").limit(5000);
    conteudo = <ListaContrapartes empresaId={empresaId} contrapartes={(data ?? []) as Contraparte[]} podeEditar={podeEditar} />;
  } else if (aba === "centros") {
    const { data } = await ctx.supabase.from("centros_custo").select("id, nome, codigo, ativo").eq("empresa_id", empresaId).order("nome");
    conteudo = <ListaSimples empresaId={empresaId} itens={data ?? []} tipo="centro" podeEditar={podeEditar} />;
  } else if (aba === "projetos") {
    const { data } = await ctx.supabase.from("projetos").select("id, nome, codigo, ativo, inicio, fim").eq("empresa_id", empresaId).order("nome");
    conteudo = <ListaSimples empresaId={empresaId} itens={data ?? []} tipo="projeto" podeEditar={podeEditar} />;
  } else {
    const [{ data }, modeloEmpresa] = await Promise.all([
      ctx.supabase.from("categorias_financeiras").select("id, codigo, nome, tipo, pai_id, sintetica, codigo_sistema, ativa, dre_linha_id").eq("empresa_id", empresaId).order("codigo"),
      carregarModeloDre(ctx.supabase, empresaId),
    ]);
    const categorias = (data ?? []) as (Categoria & { dre_linha_id: string | null })[];
    // Linha do DRE em que cada conta aparece (modelo da empresa ou padrão)
    const modelo = modeloEmpresa ?? { linhas: modeloPadrao(), categorias };
    const linhaDre: Record<string, string> = {};
    for (const c of categorias) {
      const linha = c.sintetica ? modelo.linhas.find((l) => l.id === c.dre_linha_id) : linhaDaConta(modelo, c.id, c.tipo);
      if (linha) linhaDre[c.id] = linha.rotulo;
    }
    const linhaPorTipo: Record<string, string> = {};
    for (const t of TIPOS_DRE) {
      const l = ordenarLinhas(modelo.linhas).find((x) => x.tipo === "grupo" && x.tipos.includes(t));
      if (l) linhaPorTipo[t] = l.rotulo;
    }
    conteudo = <PlanoContas empresaId={empresaId} categorias={categorias} podeEditar={podeEditar} linhaDre={linhaDre} linhaPorTipo={linhaPorTipo} />;
  }

  return (
    <>
      <CabecalhoPagina titulo="Configurações do financeiro" descricao="Plano de contas, clientes e fornecedores, centros de custo, projetos, recorrências e aprovação de pagamentos." />
      <AbasLink
        ativa={aba}
        abas={[
          { valor: "categorias", rotulo: "Plano de contas", href: base },
          { valor: "contrapartes", rotulo: "Clientes e fornecedores", href: urlCom(base, {}, { aba: "contrapartes" }) },
          { valor: "centros", rotulo: "Centros de custo", href: urlCom(base, {}, { aba: "centros" }) },
          { valor: "projetos", rotulo: "Projetos", href: urlCom(base, {}, { aba: "projetos" }) },
          { valor: "recorrencias", rotulo: "Recorrências", href: urlCom(base, {}, { aba: "recorrencias" }) },
          { valor: "aprovacao", rotulo: "Aprovação de pagamentos", href: urlCom(base, {}, { aba: "aprovacao" }) },
        ]}
      />
      {conteudo}
    </>
  );
}
