import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { PainelCaixa } from "@/components/loja/painel-caixa";
import { contasParaSangria, obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarRelatorioCaixa } from "@/lib/gestao/dados";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Caixa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaSessaoCaixa({ params }: PageProps<"/e/[empresaId]/loja/caixa/[sessaoId]">) {
  const { empresaId, sessaoId } = await params;
  if (!UUID.test(sessaoId)) notFound();
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} />;
  const relatorio = await carregarRelatorioCaixa(ctx.supabase, sessaoId);
  if (!relatorio || relatorio.sessao.empresa_id !== empresaId) notFound();
  const podeOperar = relatorio.sessao.status === "aberto" && (relatorio.sessao.operador_id === ctx.sessao.usuarioId || ctx.gerente);
  const contas = podeOperar ? await contasParaSangria(ctx.supabase, empresaId) : [];
  return (
    <>
      <CabecalhoPagina
        titulo={`${relatorio.sessao.caixa_nome} — ${formatarData(relatorio.sessao.data)}`}
        voltar={{ href: `/e/${empresaId}/loja/caixa`, rotulo: "Caixa do dia" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <PainelCaixa empresaId={empresaId} relatorio={relatorio} podeOperar={podeOperar} contas={contas} />
    </>
  );
}
