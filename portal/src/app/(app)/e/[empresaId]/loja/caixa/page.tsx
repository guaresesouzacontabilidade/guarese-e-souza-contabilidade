import type { Metadata } from "next";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { PainelCaixa } from "@/components/loja/painel-caixa";
import { contasParaSangria, obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarRelatorioCaixa } from "@/lib/gestao/dados";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Caixa do dia" };

export default async function PaginaCaixa({ params }: PageProps<"/e/[empresaId]/loja/caixa">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} />;

  const [{ data: abertos }, { data: historico }] = await Promise.all([
    ctx.supabase
      .from("caixa_sessoes")
      .select("id, caixa_nome, operador_id, aberto_em, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("status", "aberto")
      .order("aberto_em"),
    ctx.supabase
      .from("caixa_sessoes")
      .select("id, caixa_nome, data, fechado_em, diferenca, resumo, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("status", "fechado")
      .order("fechado_em", { ascending: false })
      .limit(60),
  ]);
  const meu = (abertos ?? []).find((s) => s.operador_id === ctx.sessao.usuarioId);
  const outros = (abertos ?? []).filter((s) => s.id !== meu?.id);
  const [relatorio, contas] = await Promise.all([
    meu ? carregarRelatorioCaixa(ctx.supabase, meu.id) : Promise.resolve(null),
    meu ? contasParaSangria(ctx.supabase, empresaId) : Promise.resolve([]),
  ]);

  return (
    <>
      <CabecalhoPagina
        titulo="Caixa do dia"
        descricao="Vendas por forma de pagamento, dinheiro da gaveta, sangrias, fechamento e o relatório do dia."
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      <div className="space-y-6">
        {relatorio ? (
          <PainelCaixa empresaId={empresaId} relatorio={relatorio} podeOperar contas={contas} />
        ) : (
          <EstadoVazio
            icone={Banknote}
            titulo="Você não está com um caixa aberto"
            descricao="Abra o caixa para começar a vender. No fim do dia, feche o caixa contando o dinheiro da gaveta."
            acao={
              <Button asChild>
                <Link href={`/e/${empresaId}/loja/vender`}>Abrir o caixa</Link>
              </Button>
            }
          />
        )}

        {outros.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Outros caixas abertos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {outros.map((s) => (
                <Button key={s.id} asChild variante="contorno" tamanho="sm">
                  <Link href={`/e/${empresaId}/loja/caixa/${s.id}`}>
                    {s.caixa_nome} · {(s.operador as { nome?: string } | null)?.nome ?? "—"}
                  </Link>
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Caixas fechados</CardTitle>
          </CardHeader>
          <CardContent>
            {(historico ?? []).length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Dia</Th>
                    <Th>Caixa</Th>
                    <Th className="text-right">Vendas</Th>
                    <Th className="text-right">Total vendido</Th>
                    <Th className="text-right">Gaveta</Th>
                    <Th />
                  </tr>
                </THead>
                <TBody>
                  {(historico ?? []).map((s) => {
                    const r = (s.resumo ?? {}) as { vendas_quantidade?: number; vendas_total?: number };
                    const dif = dec(s.diferenca ?? 0);
                    return (
                      <Tr key={s.id}>
                        <Td className="numero">{formatarData(s.data)}</Td>
                        <Td>
                          {s.caixa_nome}
                          <span className="block text-xs text-muted-foreground">{(s.operador as { nome?: string } | null)?.nome ?? "—"}</span>
                        </Td>
                        <Td className="text-right numero">{r.vendas_quantidade ?? 0}</Td>
                        <Td className="text-right numero">{formatarMoeda(r.vendas_total ?? 0)}</Td>
                        <Td className="text-right">
                          {dif.isZero() ? (
                            <Badge variante="sucesso">Conferiu</Badge>
                          ) : (
                            <Badge variante={dif.gt(0) ? "alerta" : "perigo"}>
                              {dif.gt(0) ? "Sobra" : "Falta"} {formatarMoeda(dif.abs())}
                            </Badge>
                          )}
                        </Td>
                        <Td className="text-right">
                          <Link href={`/e/${empresaId}/loja/caixa/${s.id}`} className="text-sm text-primary hover:underline">
                            Ver
                          </Link>
                          {" · "}
                          <a href={`/api/loja/caixa/${s.id}/relatorio?ver=1`} target="_blank" rel="noopener" className="text-sm text-primary hover:underline">
                            PDF
                          </a>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum caixa fechado ainda.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
