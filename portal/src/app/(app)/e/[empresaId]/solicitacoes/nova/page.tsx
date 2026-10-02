import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { FormNovaSolicitacao, type ServicoCatalogo } from "@/components/solicitacoes/solicitacoes";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Nova solicitação" };

export default async function NovaSolicitacao({ params, searchParams }: PageProps<"/e/[empresaId]/solicitacoes/nova">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("mensagens.usar")) return <Alerta tom="alerta">Seu acesso não inclui as solicitações desta empresa.</Alerta>;
  const { data } = await ctx.supabase
    .from("servicos_catalogo")
    .select("codigo, nome, descricao, area, prazo_dias, documentos_necessarios")
    .eq("ativo", true)
    .order("ordem");
  return (
    <>
      <CabecalhoPagina
        titulo="Nova solicitação"
        descricao="Escolha o serviço e descreva o que precisa. O escritório confirma o prazo e acompanha com você."
        voltar={{ href: `/e/${empresaId}/solicitacoes`, rotulo: "Solicitações" }}
      />
      <Card className="max-w-5xl">
        <CardContent className="pt-6">
          <FormNovaSolicitacao empresaId={empresaId} servicos={(data ?? []) as ServicoCatalogo[]} inicial={parametro(sp, "servico")} />
        </CardContent>
      </Card>
    </>
  );
}
