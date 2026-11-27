import Link from "next/link";
import { notFound } from "next/navigation";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { hojeISO } from "@/lib/competencia";
import { formatarData, formatarDocumento } from "@/lib/formatos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { SITUACAO_LANCAMENTO } from "@/lib/rotulos";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;

type Resumo = {
  em_aberto: number;
  vencido: number;
  qtd_vencidos: number;
  liquidado: number;
  liquidado_com_encargos: number;
  qtd_titulos: number;
  maior_atraso_dias: number | null;
  ultimo_pagamento: string | null;
  atraso_medio_dias: number | null;
};

/** Histórico financeiro de um cliente ou fornecedor: em aberto, vencido, liquidado e os títulos. */
export async function PaginaContraparte({ ctx, empresaId, contraparteId, tipo }: { ctx: ContextoEmpresa; empresaId: string; contraparteId: string; tipo: "pagar" | "receber" }) {
  if (!UUID.test(contraparteId)) notFound();
  const hoje = hojeISO();
  const [{ data: cp }, { data: resumo }, { data: titulos }] = await Promise.all([
    ctx.supabase.from("contrapartes").select("id, nome, documento, email, telefone, papeis").eq("id", contraparteId).eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.rpc("financeiro_historico_contraparte", { p_empresa_id: empresaId, p_contraparte_id: contraparteId }),
    ctx.supabase
      .from("lancamentos")
      .select("id, tipo, descricao, data_vencimento, valor_previsto, valor_baixado, situacao, data_ultimo_pagamento")
      .eq("empresa_id", empresaId)
      .eq("contraparte_id", contraparteId)
      .eq("status_revisao", "confirmado")
      .neq("situacao", "cancelado")
      .order("data_vencimento", { ascending: false })
      .limit(200),
  ]);
  if (!cp) notFound();
  const r = (resumo ?? {}) as Partial<Record<"receber" | "pagar", Resumo>>;
  const base = `/e/${empresaId}/financeiro/${tipo}`;
  const blocos = (["receber", "pagar"] as const).filter((t) => r[t]);

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: base, rotulo: tipo === "pagar" ? "Contas a pagar" : "Contas a receber" }}
        titulo={cp.nome}
        descricao={[cp.documento ? formatarDocumento(cp.documento) : null, cp.telefone, cp.email].filter(Boolean).join(" · ") || "Cliente ou fornecedor"}
        acoes={
          <>
            {r.receber ? (
              <Button asChild variante="contorno">
                <Link href={`/e/${empresaId}/financeiro/receber?contraparte=${cp.id}&situacao=em_aberto`}>Contas a receber dele</Link>
              </Button>
            ) : null}
            {r.pagar ? (
              <Button asChild variante="contorno">
                <Link href={`/e/${empresaId}/financeiro/pagar?contraparte=${cp.id}&situacao=em_aberto`}>Contas a pagar a ele</Link>
              </Button>
            ) : null}
          </>
        }
      />
      {blocos.length ? (
        <div className="mb-5 space-y-4">
          {blocos.map((t) => {
            const x = r[t]!;
            return (
              <section key={t} aria-label={t === "receber" ? "A receber deste cliente" : "A pagar a este fornecedor"}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t === "receber" ? "Como cliente (a receber)" : "Como fornecedor (a pagar)"}</h2>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid={`historico-${t}`}>
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Em aberto</p>
                    <p className="text-lg font-bold numero">{formatarMoeda(x.em_aberto)}</p>
                  </div>
                  <div className={cn("rounded-xl border p-3", Number(x.vencido) > 0 ? "border-perigo/40 bg-perigo-bg" : "border-border bg-card")}>
                    <p className="text-xs text-muted-foreground">Vencido ({x.qtd_vencidos})</p>
                    <p className={cn("text-lg font-bold numero", Number(x.vencido) > 0 ? "text-perigo" : "")}>{formatarMoeda(x.vencido)}</p>
                    {x.maior_atraso_dias ? <p className="text-xs text-perigo">maior atraso: {x.maior_atraso_dias} dia(s)</p> : null}
                  </div>
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Liquidado ({x.qtd_titulos} título(s))</p>
                    <p className="text-lg font-semibold text-sucesso numero">{formatarMoeda(x.liquidado)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Último pagamento</p>
                    <p className="font-semibold">{x.ultimo_pagamento ? formatarData(x.ultimo_pagamento) : "—"}</p>
                    {x.atraso_medio_dias !== null && x.atraso_medio_dias !== undefined ? (
                      <p className="text-xs text-muted-foreground">
                        {Number(x.atraso_medio_dias) > 0 ? `paga em média ${x.atraso_medio_dias} dia(s) depois do vencimento` : "costuma pagar em dia"}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Títulos</CardTitle>
        </CardHeader>
        <CardContent>
          {titulos?.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Vencimento</Th>
                  <Th>Descrição</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Valor original</Th>
                  <Th className="text-right">Saldo</Th>
                </tr>
              </THead>
              <TBody>
                {titulos.map((t) => {
                  const aberto = t.situacao === "aberto" || t.situacao === "parcial";
                  const vencido = aberto && t.data_vencimento < hoje;
                  return (
                    <Tr key={t.id}>
                      <Td className="whitespace-nowrap text-sm">{formatarData(t.data_vencimento)}</Td>
                      <Td>
                        <Link href={`/e/${empresaId}/financeiro/${t.tipo}/${t.id}`} className="font-medium hover:underline">
                          {t.descricao}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{t.tipo === "receber" ? "A receber" : "A pagar"}</span>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <Badge variante={SITUACAO_LANCAMENTO[t.situacao]?.tom ?? "neutro"}>{SITUACAO_LANCAMENTO[t.situacao]?.rotulo ?? t.situacao}</Badge>
                          {vencido ? <Badge variante="perigo">Vencido</Badge> : null}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap text-right numero">{formatarMoeda(t.valor_previsto)}</Td>
                      <Td className="whitespace-nowrap text-right font-semibold numero">{aberto ? formatarMoeda(dec(t.valor_previsto).minus(dec(t.valor_baixado))) : "—"}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum título deste cadastro.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
