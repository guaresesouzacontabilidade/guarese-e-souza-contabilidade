import type { Metadata } from "next";
import Link from "next/link";
import { FileText, NotebookPen } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { AbrirCaixa } from "@/components/loja/formularios-caixa";
import { PontoDeVenda } from "@/components/loja/ponto-de-venda";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { nfeNaVenda } from "@/lib/gestao/nfe-venda";
import { carregarPdv } from "@/lib/gestao/pdv-dados";
import { formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Vender" };

export default async function PaginaVender({ params, searchParams }: PageProps<"/e/[empresaId]/loja/vender">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;

  const { data: abertos } = await ctx.supabase
    .from("caixa_sessoes")
    .select("id, caixa_nome, operador_id, aberto_em, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
    .eq("empresa_id", empresaId)
    .eq("status", "aberto")
    .order("aberto_em");
  const meu = (abertos ?? []).find((s) => s.operador_id === ctx.sessao.usuarioId);

  if (!meu) {
    const usados = new Set((abertos ?? []).map((s) => s.caixa_nome.toLowerCase()));
    let n = 1;
    while (usados.has(`caixa ${n}`)) n++;
    return (
      <>
        <CabecalhoPagina titulo="Vender" descricao="Para começar a vender, abra o caixa com o troco que está na gaveta." />
        <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Abrir o caixa</CardTitle>
            </CardHeader>
            <CardContent>
              <AbrirCaixa empresaId={empresaId} sugestaoNome={`Caixa ${n}`} />
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Só um orçamento?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">Para orçamento não precisa abrir o caixa. Depois é só imprimir ou mandar pelo WhatsApp.</p>
                <Button asChild variante="contorno" className="w-full">
                  <Link href={`/e/${empresaId}/loja/orcamento`}>
                    <NotebookPen /> Fazer orçamento
                  </Link>
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Caixas abertos agora</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(abertos ?? []).length ? (
                  (abertos ?? []).map((s) => (
                    <div key={s.id} className="rounded-lg border border-border p-2.5">
                      <p className="font-medium">{s.caixa_nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {(s.operador as { nome?: string } | null)?.nome ?? "—"} · desde {formatarDataHora(s.aberto_em)}
                      </p>
                      {ctx.gerente ? (
                        <Link href={`/e/${empresaId}/loja/caixa/${s.id}`} className="text-xs text-primary hover:underline">
                          Ver o caixa
                        </Link>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">Nenhum caixa aberto.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  const [dados, nfe] = await Promise.all([carregarPdv(ctx.supabase, empresaId, sp.orcamento), nfeNaVenda(ctx.supabase, empresaId, ctx.pode("nfe.emitir"))]);
  const { orcamento } = dados;

  return (
    <>
      <CabecalhoPagina
        titulo={orcamento ? `Vender o orçamento nº ${orcamento.numero}` : "Vender"}
        descricao={`${meu.caixa_nome} aberto desde ${formatarDataHora(meu.aberto_em)}. Cada venda já baixa o estoque e entra no Financeiro.`}
        acoes={
          <Button asChild variante="contorno">
            <Link href={`/e/${empresaId}/loja/caixa`}>
              <FileText /> Caixa do dia
            </Link>
          </Button>
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      {dados.orcamentoFechado ? (
        <Alerta tom="alerta" className="mb-4">
          Este orçamento não está mais em aberto (já virou venda ou foi cancelado).
        </Alerta>
      ) : null}
      {!dados.produtos.length ? (
        <Alerta tom="info" className="mb-4" titulo="Nenhum produto cadastrado">
          {ctx.gerente ? (
            <>
              Cadastre os produtos em <Link href={`/e/${empresaId}/loja/produtos`} className="underline">Produtos e estoque</Link> para começar a vender.
            </>
          ) : (
            "Peça ao gerente da loja para cadastrar os produtos."
          )}
        </Alerta>
      ) : null}
      <PontoDeVenda
        key={orcamento?.id ?? "nova"}
        empresaId={empresaId}
        sessaoId={meu.id}
        caixaNome={meu.caixa_nome}
        produtos={dados.produtos}
        clientes={dados.clientes}
        permitirPrazo={dados.permitirPrazo}
        orcamento={orcamento}
        nfe={nfe}
        etiqueta={dados.etiqueta}
        vendedores={dados.vendedores}
        vendedorObrigatorio={dados.vendedorObrigatorio}
      />
    </>
  );
}
