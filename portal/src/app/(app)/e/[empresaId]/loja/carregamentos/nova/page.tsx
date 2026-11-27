import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { CarregamentosIndisponivel, NavegacaoCarregamentos } from "@/components/loja/navegacao-loja";
import { FormOrdem } from "@/components/loja/carregamentos";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { opcoesOrdem } from "@/lib/gestao/dados-carregamento";

export const metadata: Metadata = { title: "Nova ordem de carregamento" };

export default async function NovaOrdem({ params }: PageProps<"/e/[empresaId]/loja/carregamentos/nova">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.carrega) return <CarregamentosIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const opcoes = await opcoesOrdem(ctx.supabase, empresaId);
  return (
    <>
      <CabecalhoPagina
        titulo="Nova ordem de carregamento"
        descricao="Comprador, produto, quantidade e o caminhão que vai carregar. A pesagem é registrada depois, na balança."
        voltar={{
          href: `/e/${empresaId}/loja/carregamentos`,
          rotulo: "Ordens de carregamento",
        }}
      />
      <NavegacaoCarregamentos empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} cte={ctx.acesso.cte && ctx.pode("cte.emitir")} />
      {opcoes.produtos.length ? (
        <Card>
          <CardContent className="pt-5">
            <FormOrdem empresaId={empresaId} ordem={null} opcoes={opcoes} />
          </CardContent>
        </Card>
      ) : (
        <Alerta tom="alerta" titulo="Falta o cadastro dos produtos">
          A ordem usa os produtos da NF-e (soja, milho...). Peça ao escritório para cadastrá-los em{" "}
          <Link href={`/e/${empresaId}/notas-produto`} className="underline">
            Emitir nota de produto
          </Link>
          .
        </Alerta>
      )}
    </>
  );
}
