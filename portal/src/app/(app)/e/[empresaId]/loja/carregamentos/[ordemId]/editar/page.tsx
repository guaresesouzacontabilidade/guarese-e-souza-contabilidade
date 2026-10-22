import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { CarregamentosIndisponivel, NavegacaoCarregamentos } from "@/components/loja/navegacao-loja";
import { FormOrdem } from "@/components/loja/carregamentos";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { opcoesOrdem, ordemEditavel } from "@/lib/gestao/dados-carregamento";
import { notaVale } from "@/lib/gestao/carregamentos";

export const metadata: Metadata = { title: "Alterar ordem de carregamento" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditarOrdem({ params }: PageProps<"/e/[empresaId]/loja/carregamentos/[ordemId]/editar">) {
  const { empresaId, ordemId } = await params;
  if (!UUID.test(ordemId)) notFound();
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.carrega) return <CarregamentosIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const [{ data: o }, opcoes] = await Promise.all([
    ctx.supabase.from("ordens_carregamento").select("*, nota:nfe_emissoes(situacao)").eq("id", ordemId).eq("empresa_id", empresaId).maybeSingle(),
    opcoesOrdem(ctx.supabase, empresaId),
  ]);
  if (!o) notFound();
  const voltar = `/e/${empresaId}/loja/carregamentos/${ordemId}`;
  const notaAtiva = o.status === "faturada" && notaVale((o.nota as { situacao: string } | null)?.situacao);
  return (
    <>
      <CabecalhoPagina titulo={`Alterar a ordem nº ${o.numero}`} voltar={{ href: voltar, rotulo: `Ordem nº ${o.numero}` }} />
      <NavegacaoCarregamentos empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      {o.status === "cancelada" || notaAtiva ? (
        <Alerta tom="alerta">
          {o.status === "cancelada" ? "Esta ordem foi cancelada e não pode mais ser alterada." : "Esta ordem já tem NF-e e não pode mais ser alterada."}
        </Alerta>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <FormOrdem empresaId={empresaId} ordem={ordemEditavel(o)} opcoes={opcoes} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
