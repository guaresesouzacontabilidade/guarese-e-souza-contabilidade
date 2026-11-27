import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ClinicaIndisponivel, DialogoMotivo } from "@/components/veterinaria/comuns";
import { BotaoFecharConta, DialogoDesconto, DialogoPagamento, FormularioItemConta } from "@/components/veterinaria/conta";
import { cancelarConta, cancelarItemConta, estornarPagamento } from "@/lib/veterinaria/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { hojeClinica, obterContextoClinica } from "@/lib/veterinaria/contexto";
import { FORMAS_PAGAMENTO_CLINICA, STATUS_CONTA } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Conta da clínica" };

export default async function PaginaConta({ params }: PageProps<"/e/[empresaId]/veterinaria/contas/[contaId]">) {
  const { empresaId, contaId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!/^[0-9a-f-]{36}$/i.test(contaId)) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const [{ data: c }, { data: itens }, { data: pagamentos }, { data: servicos }, { data: resumo }, { data: caixa }] = await Promise.all([
    ctx.supabase
      .from("vet_contas")
      .select("*, tutor:vet_tutores(id, nome), paciente:vet_pacientes(id, nome), atendimento:vet_atendimentos(id, numero)")
      .eq("id", contaId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("vet_conta_itens").select("*").eq("conta_id", contaId).order("created_at"),
    ctx.supabase.from("vet_pagamentos").select("*").eq("conta_id", contaId).order("created_at"),
    ctx.supabase.from("vet_servicos").select("id, nome, preco").eq("empresa_id", empresaId).eq("ativo", true).order("ordem"),
    ctx.supabase.rpc("vet_conta_resumo", { p_conta_id: contaId }),
    ctx.supabase.from("caixa_sessoes").select("id").eq("empresa_id", empresaId).eq("operador_id", ctx.sessao.usuarioId).eq("status", "aberto").maybeSingle(),
  ]);
  if (!c) notFound();
  const r = (resumo ?? { itens: 0, desconto: 0, total: 0, pago: 0, saldo: 0 }) as { itens: number; desconto: number; total: number; pago: number; saldo: number };
  const t = c.tutor as unknown as { id: string; nome: string };
  const p = c.paciente as unknown as { id: string; nome: string } | null;
  const at = c.atendimento as unknown as { id: string; numero: number } | null;
  const aberta = c.status === "aberta";
  const st = STATUS_CONTA[c.status];
  const temPagamento = (pagamentos ?? []).some((x) => !x.cancelado_em);

  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            Conta nº {c.numero} <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? c.status}</Badge>
          </span>
        }
        descricao={
          <>
            <Link href={`${base}/tutores/${t.id}`} className="hover:underline">
              {t.nome}
            </Link>
            {p ? (
              <>
                {" · "}
                <Link href={`${base}/pacientes/${p.id}`} className="hover:underline">
                  {p.nome}
                </Link>
              </>
            ) : null}
            {at ? (
              <>
                {" · "}
                <Link href={`${base}/atendimentos/${at.id}`} className="hover:underline">
                  atendimento nº {at.numero}
                </Link>
              </>
            ) : null}
            {` · aberta em ${formatarDataHora(c.created_at)}`}
          </>
        }
        voltar={{ href: `${base}/contas`, rotulo: "Contas da clínica" }}
        acoes={
          <>
            {aberta ? (
              <>
                <DialogoPagamento empresaId={empresaId} contaId={c.id} saldo={Number(r.saldo)} hoje={hojeClinica()} caixaAberto={Boolean(caixa)} />
                <BotaoFecharConta empresaId={empresaId} contaId={c.id} desabilitado={Number(r.saldo) !== 0} />
                {!temPagamento ? (
                  <DialogoMotivo acao={cancelarConta.bind(null, empresaId, c.id)} titulo="Cancelar a conta?" rotuloBotao="Cancelar conta" variante="fantasma" tamanho="md" />
                ) : null}
              </>
            ) : null}
            {c.status !== "cancelada" && Number(r.total) > 0 && ctx.pode("nfse.emitir") ? (
              <Button asChild variante="contorno">
                <Link href={`/e/${empresaId}/notas-servico/nova?conta=${c.id}`}>
                  <ReceiptText /> Emitir nota de serviço
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {c.status === "cancelada" ? (
        <Alerta tom="alerta" className="mb-4">
          Conta cancelada: {c.cancelada_motivo}
        </Alerta>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Serviços</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {itens?.length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Descrição</Th>
                      <Th className="text-right">Qtd.</Th>
                      <Th className="text-right">Valor</Th>
                      <Th className="text-right">Total</Th>
                      <Th />
                    </Tr>
                  </THead>
                  <TBody>
                    {itens.map((i) => (
                      <Tr key={i.id} className={i.cancelado_em ? "opacity-50" : undefined}>
                        <Td>
                          {i.descricao}
                          {i.cancelado_em ? <span className="block text-xs text-muted-foreground">cancelado: {i.cancelado_motivo}</span> : null}
                        </Td>
                        <Td className="numero text-right">{String(i.quantidade).replace(".", ",")}</Td>
                        <Td className="numero text-right">{formatarMoeda(i.valor_unitario)}</Td>
                        <Td className="numero text-right">{formatarMoeda(i.total)}</Td>
                        <Td className="text-right">
                          {aberta && !i.cancelado_em ? (
                            <DialogoMotivo acao={cancelarItemConta.bind(null, empresaId, i.id)} titulo="Cancelar este item?" rotuloBotao="Cancelar" />
                          ) : null}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum serviço lançado.</p>
              )}
              {aberta ? <FormularioItemConta empresaId={empresaId} contaId={c.id} servicos={servicos ?? []} /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pagamentos</CardTitle>
            </CardHeader>
            <CardContent>
              {pagamentos?.length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Data</Th>
                      <Th>Forma</Th>
                      <Th className="text-right">Valor</Th>
                      <Th />
                    </Tr>
                  </THead>
                  <TBody>
                    {pagamentos.map((x) => (
                      <Tr key={x.id} className={x.cancelado_em ? "opacity-50" : undefined}>
                        <Td className="numero">{formatarData(x.data)}</Td>
                        <Td>
                          {FORMAS_PAGAMENTO_CLINICA[x.forma] ?? x.forma}
                          {x.vencimento ? <span className="block text-xs text-muted-foreground">vence {formatarData(x.vencimento)}</span> : null}
                          {x.cancelado_em ? <span className="block text-xs text-muted-foreground">estornado: {x.cancelado_motivo}</span> : null}
                        </Td>
                        <Td className="numero text-right">{formatarMoeda(x.valor)}</Td>
                        <Td className="text-right">
                          {aberta && !x.cancelado_em && ctx.gerente ? (
                            <DialogoMotivo
                              acao={estornarPagamento.bind(null, empresaId, x.id)}
                              titulo="Estornar este pagamento?"
                              descricao="O lançamento é cancelado no Financeiro."
                              rotuloBotao="Estornar"
                            />
                          ) : null}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum pagamento.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>Resumo</CardTitle>
            {aberta ? <DialogoDesconto empresaId={empresaId} contaId={c.id} desconto={Number(r.desconto)} /> : null}
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt>Serviços</dt>
                <dd className="numero">{formatarMoeda(r.itens)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Desconto</dt>
                <dd className="numero">− {formatarMoeda(r.desconto)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <dt>Total</dt>
                <dd className="numero">{formatarMoeda(r.total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Recebido / a receber</dt>
                <dd className="numero">{formatarMoeda(r.pago)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Falta</dt>
                <dd className={`numero ${Number(r.saldo) > 0 ? "text-alerta" : "text-sucesso"}`}>{formatarMoeda(r.saldo)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
