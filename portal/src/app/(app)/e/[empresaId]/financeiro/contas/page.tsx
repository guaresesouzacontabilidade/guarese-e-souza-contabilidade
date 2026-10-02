import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ListaContas, type ContaFinanceira } from "@/components/financeiro/contas";
import { hojeISO } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { TIPOS_CONTA } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Contas e saldos" };

export default async function PaginaContas({ params }: PageProps<"/e/[empresaId]/financeiro/contas">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const hoje = hojeISO();
  const [{ data: contas }, { data: saldos }, { data: estoques }] = await Promise.all([
    ctx.supabase.from("contas_financeiras").select("*").eq("empresa_id", empresaId).order("ativa", { ascending: false }).order("nome"),
    ctx.supabase.rpc("saldos_contas", { p_empresa_id: empresaId, p_data: hoje }),
    ctx.supabase.from("estoques").select("id, competencia, valor_estoque_final, fonte").eq("empresa_id", empresaId).order("competencia", { ascending: false }).limit(12),
  ]);
  const lista = (saldos ?? []) as { conta_id: string; nome: string; tipo: string; saldo_sistema: number | null; saldo_extrato: number | null; saldo_extrato_data: string | null; ultimo_movimento_data: string | null; movimentos_pendentes: number; conciliado_ate: string | null }[];
  return (
    <>
      <CabecalhoPagina titulo="Contas e saldos" descricao="Bancos, caixa, cartões e maquininhas com saldo inicial e posição atual." />
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Posição em {formatarData(hoje)}</CardTitle>
          <CardDescription>Saldo calculado pelo sistema (saldo inicial + baixas + transferências) e o último saldo informado pelo banco.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <tr>
                <Th>Conta</Th>
                <Th className="text-right">Saldo no sistema</Th>
                <Th className="text-right">Último saldo do extrato</Th>
                <Th>Extrato até</Th>
                <Th>Conciliado até</Th>
                <Th className="text-right">A conciliar</Th>
              </tr>
            </THead>
            <TBody>
              {lista.map((s) => (
                <Tr key={s.conta_id}>
                  <Td>
                    <span className="block font-medium">{s.nome}</span>
                    <span className="text-xs text-muted-foreground">{TIPOS_CONTA[s.tipo]}</span>
                  </Td>
                  <Td className="text-right numero">{s.saldo_sistema != null ? formatarMoeda(s.saldo_sistema) : "—"}</Td>
                  <Td className="text-right numero">
                    {s.saldo_extrato != null ? formatarMoeda(s.saldo_extrato) : "—"}
                    {s.saldo_extrato_data ? <span className="block text-xs text-muted-foreground">em {formatarData(s.saldo_extrato_data)}</span> : null}
                  </Td>
                  <Td className="text-sm">{formatarData(s.ultimo_movimento_data)}</Td>
                  <Td className="text-sm">{formatarData(s.conciliado_ate)}</Td>
                  <Td className="text-right numero">{s.movimentos_pendentes || "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <ListaContas empresaId={empresaId} contas={(contas ?? []) as ContaFinanceira[]} podeEditar={ctx.pode("financeiro.editar")} />
      {estoques?.length ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Estoque final informado</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {estoques.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {formatarCompetencia(e.competencia, true)}
                    {e.fonte ? <span className="block text-xs text-muted-foreground">{e.fonte}</span> : null}
                  </span>
                  <span className="numero">{formatarMoeda(e.valor_estoque_final)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
