import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora } from "@/lib/formatos";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { STATUS_CONTA } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Contas da clínica" };

export default async function PaginaContas({ params, searchParams }: PageProps<"/e/[empresaId]/veterinaria/contas">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const status = sp.status === "fechada" || sp.status === "cancelada" ? sp.status : "aberta";
  const base = `/e/${empresaId}/veterinaria`;
  const { data: contas } = await ctx.supabase
    .from("vet_contas")
    .select("id, numero, status, desconto, created_at, tutor:vet_tutores(id, nome), paciente:vet_pacientes(nome)")
    .eq("empresa_id", empresaId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);
  const ids = (contas ?? []).map((c) => c.id);
  const [{ data: itens }, { data: pagos }] = ids.length
    ? await Promise.all([
        ctx.supabase.from("vet_conta_itens").select("conta_id, total").in("conta_id", ids).is("cancelado_em", null),
        ctx.supabase.from("vet_pagamentos").select("conta_id, valor").in("conta_id", ids).is("cancelado_em", null),
      ])
    : [{ data: [] }, { data: [] }];
  const total = new Map<string, number>();
  for (const i of itens ?? []) total.set(i.conta_id, (total.get(i.conta_id) ?? 0) + Number(i.total));
  const pago = new Map<string, number>();
  for (const x of pagos ?? []) pago.set(x.conta_id, (pago.get(x.conta_id) ?? 0) + Number(x.valor));

  return (
    <>
      <CabecalhoPagina
        titulo="Contas da clínica"
        descricao="Consultas, vacinas, exames e procedimentos cobrados. Cada pagamento vai para o Financeiro; o dinheiro entra no caixa aberto de quem recebeu."
        voltar={{ href: base, rotulo: "Painel da clínica" }}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {Object.entries(STATUS_CONTA).map(([v, s]) => (
          <Link key={v} href={`${base}/contas?status=${v}`} className={`rounded-full border px-3 py-1 ${v === status ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
            {s.rotulo}
          </Link>
        ))}
      </div>
      {contas?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Conta</Th>
                  <Th>Tutor e animal</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Falta</Th>
                </Tr>
              </THead>
              <TBody>
                {contas.map((c) => {
                  const t = c.tutor as unknown as { id: string; nome: string };
                  const tot = Math.max(0, (total.get(c.id) ?? 0) - Number(c.desconto));
                  const falta = tot - (pago.get(c.id) ?? 0);
                  return (
                    <Tr key={c.id}>
                      <Td>
                        <Link href={`${base}/contas/${c.id}`} className="font-medium text-primary hover:underline">
                          nº {c.numero}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{formatarDataHora(c.created_at)}</span>
                      </Td>
                      <Td>
                        {t.nome}
                        <span className="block text-xs text-muted-foreground">{(c.paciente as unknown as { nome: string } | null)?.nome ?? ""}</span>
                      </Td>
                      <Td className="numero text-right">{formatarMoeda(tot)}</Td>
                      <Td className="numero text-right">
                        {c.status === "aberta" ? (falta > 0 ? formatarMoeda(falta) : <Badge variante="sucesso">pago</Badge>) : "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={ReceiptText} titulo="Nenhuma conta" descricao="Abra a conta pelo botão “Cobrar” no atendimento, na ficha do animal ou do tutor." />
      )}
    </>
  );
}
