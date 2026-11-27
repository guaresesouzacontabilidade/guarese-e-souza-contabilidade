import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { Vendedores, type VendedorLinha } from "@/components/loja/vendedores";
import { obterContextoLoja } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Vendedores" };

/** Cadastro dos vendedores da loja (comissão em %, login ligado) e "exigir o vendedor". */
export default async function PaginaVendedores({ params }: PageProps<"/e/[empresaId]/loja/vendedores">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende && !ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;

  const [{ data: vendedores }, { data: membros }, { data: cfg }] = await Promise.all([
    ctx.supabase.from("loja_vendedores").select("id, nome, comissao_percentual, ativo, usuario_id").eq("empresa_id", empresaId).order("ativo", { ascending: false }).order("nome"),
    ctx.gerente
      ? ctx.supabase.from("empresa_membros").select("user_id, papel, perfil:perfis!empresa_membros_user_id_fkey(nome)").eq("empresa_id", empresaId).eq("ativo", true).like("papel", "cliente%")
      : Promise.resolve({ data: [] }),
    ctx.supabase.from("gestao_config").select("vendedor_obrigatorio").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  const acessos = (membros ?? [])
    .map((m) => ({ id: m.user_id as string, nome: ((m.perfil as { nome: string | null } | null)?.nome ?? "Sem nome") as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const nomes = new Map(acessos.map((a) => [a.id, a.nome]));
  const linhas: VendedorLinha[] = (vendedores ?? []).map((v) => ({
    id: v.id,
    nome: v.nome,
    comissao: Number(v.comissao_percentual),
    ativo: v.ativo,
    usuarioId: v.usuario_id,
    usuarioNome: v.usuario_id ? (nomes.get(v.usuario_id) ?? "Acesso da empresa") : null,
  }));

  return (
    <>
      <CabecalhoPagina titulo="Vendedores" descricao="Quem vende e a comissão de cada um. O vendedor é escolhido no orçamento e no caixa; as comissões ficam em Comissões." />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      {ctx.gerente ? (
        <Vendedores empresaId={empresaId} vendedores={linhas} acessos={acessos} obrigatorio={Boolean(cfg?.vendedor_obrigatorio)} />
      ) : (
        <Alerta tom="info">Só quem gerencia a loja cadastra os vendedores. Suas comissões estão na aba Comissões.</Alerta>
      )}
    </>
  );
}
