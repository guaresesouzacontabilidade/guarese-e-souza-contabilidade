import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, Info, Landmark, Plus, Sparkles } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { competenciaAtual, hojeISO, somarDias } from "@/lib/competencia";
import { formatarData } from "@/lib/formatos";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { TIPOS_CONTA } from "@/lib/rotulos";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Financeiro" };

interface SaldoConta {
  conta_id: string;
  nome: string;
  tipo: string;
  compoe_saldo_disponivel: boolean;
  saldo_sistema: number | null;
  saldo_extrato: number | null;
  saldo_extrato_data: string | null;
  ultimo_movimento_data: string | null;
  movimentos_pendentes: number;
  conciliado_ate: string | null;
}

export default async function VisaoFinanceira({ params }: PageProps<"/e/[empresaId]/financeiro">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const hoje = hojeISO();
  const em7 = somarDias(hoje, 7);
  const em30 = somarDias(hoje, 30);
  const base = `/e/${empresaId}/financeiro`;

  const [saldosR, abertos, sugeridos, projetadoR, qualidadeR] = await Promise.all([
    ctx.supabase.rpc("saldos_contas", { p_empresa_id: empresaId, p_data: hoje }),
    buscarTudo((de, ate) =>
      ctx.supabase
        .from("lancamentos")
        .select("id, tipo, descricao, valor_previsto, valor_baixado, data_vencimento, contraparte:contrapartes(nome), conta:contas_financeiras(tipo)")
        .eq("empresa_id", empresaId)
        .eq("status_revisao", "confirmado")
        .in("situacao", ["aberto", "parcial"])
        .order("data_vencimento")
        .range(de, ate),
    ),
    ctx.supabase.from("lancamentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("status_revisao", "sugerido").neq("situacao", "cancelado"),
    ctx.supabase.rpc("relatorio_fluxo_projetado", { p_empresa_id: empresaId, p_ate: em30 }),
    ctx.supabase.rpc("qualidade_dados", { p_empresa_id: empresaId, p_inicio: competenciaAtual(), p_fim: hoje }),
  ]);

  const saldos = (saldosR.data ?? []) as SaldoConta[];
  const disponiveis = saldos.filter((s) => s.compoe_saldo_disponivel);
  const semSaldo = disponiveis.filter((s) => s.saldo_sistema === null);
  const saldoDisponivel = disponiveis.length && !semSaldo.length ? somar(disponiveis.map((s) => s.saldo_sistema)) : null;

  // Lançamentos de cartão são pagos pela fatura (não entram como vencimento individual)
  const lista = abertos.filter((l) => (l.conta as { tipo: string } | null)?.tipo !== "cartao_credito");
  const aberto = (l: (typeof lista)[number]) => dec(l.valor_previsto).minus(dec(l.valor_baixado));
  const soma = (tipo: string, filtro: (l: (typeof lista)[number]) => boolean) => somar(lista.filter((l) => l.tipo === tipo && filtro(l)).map(aberto));
  const vencidoReceber = soma("receber", (l) => l.data_vencimento < hoje);
  const vencidoPagar = soma("pagar", (l) => l.data_vencimento < hoje);
  const receber7 = soma("receber", (l) => l.data_vencimento >= hoje && l.data_vencimento <= em7);
  const pagar7 = soma("pagar", (l) => l.data_vencimento >= hoje && l.data_vencimento <= em7);

  const projetado = (projetadoR.data ?? []) as { entrada: number; saida: number }[];
  const entradas30 = somar(projetado.map((p) => p.entrada));
  const saidas30 = somar(projetado.map((p) => p.saida));
  const saldoProjetado = saldoDisponivel ? saldoDisponivel.plus(entradas30).minus(saidas30) : null;

  const q = (qualidadeR.data ?? {}) as {
    movimentos?: { total: number; pendentes: number };
    contas_sem_extrato?: { id: string; nome: string }[];
    contas_extrato_incompleto?: { id: string; nome: string; ultimo_movimento: string | null }[];
  };
  const proximos = lista.filter((l) => l.data_vencimento <= em30).slice(0, 12);

  return (
    <>
      <CabecalhoPagina
        titulo="Financeiro"
        descricao="Saldos, contas a pagar e a receber e previsão de caixa. Valores vêm dos lançamentos confirmados, baixas e transferências registrados no portal."
        acoes={
          ctx.pode("financeiro.editar") ? (
            <Button asChild>
              <Link href={`${base}/lancamentos/novo`}>
                <Plus /> Novo lançamento
              </Link>
            </Button>
          ) : null
        }
      />

      {(sugeridos.count ?? 0) > 0 ? (
        <Alerta
          tom="info"
          className="mb-4"
          titulo={`${sugeridos.count} lançamento(s) sugerido(s) aguardando revisão`}
          acao={
            <Button asChild tamanho="sm" variante="secundario">
              <Link href={`${base}/lancamentos?revisao=sugerido`}>
                <Sparkles /> Revisar
              </Link>
            </Button>
          }
        >
          Lançamentos criados a partir de XMLs ou importações sem categoria só entram nos relatórios depois de confirmados.
        </Alerta>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Saldo disponível hoje"
          valor={saldoDisponivel ? formatarMoeda(saldoDisponivel) : "—"}
          detalhe={
            !disponiveis.length
              ? "Cadastre as contas bancárias"
              : semSaldo.length
                ? `Sem saldo inicial em ${semSaldo.map((s) => s.nome).join(", ")}`
                : "Contas bancárias e caixa (sem cartões e maquininhas)"
          }
          tom={saldoDisponivel ? (saldoDisponivel.lessThan(0) ? "perigo" : "neutro") : "neutro"}
          icone={Landmark}
          href={`${base}/contas`}
        />
        <Indicador
          rotulo="A receber vencido"
          valor={formatarMoeda(vencidoReceber)}
          detalhe={`Próximos 7 dias: ${formatarMoeda(receber7)}`}
          tom={vencidoReceber.greaterThan(0) ? "alerta" : "neutro"}
          icone={ArrowDownLeft}
          href={`${base}/lancamentos?tipo=receber&situacao=atrasado`}
        />
        <Indicador
          rotulo="A pagar vencido"
          valor={formatarMoeda(vencidoPagar)}
          detalhe={`Próximos 7 dias: ${formatarMoeda(pagar7)}`}
          tom={vencidoPagar.greaterThan(0) ? "perigo" : "neutro"}
          icone={ArrowUpRight}
          href={`${base}/lancamentos?tipo=pagar&situacao=atrasado`}
        />
        <Indicador
          rotulo="Saldo projetado em 30 dias"
          valor={saldoProjetado ? formatarMoeda(saldoProjetado) : "—"}
          detalhe={`Entradas ${formatarMoeda(entradas30)} · saídas ${formatarMoeda(saidas30)}`}
          tom={saldoProjetado?.lessThan(0) ? "perigo" : "neutro"}
        />
      </div>

      {(q.contas_sem_extrato?.length ?? 0) > 0 || (q.contas_extrato_incompleto?.length ?? 0) > 0 || (q.movimentos?.pendentes ?? 0) > 0 ? (
        <Alerta tom="alerta" className="mb-5" titulo="Dados possivelmente incompletos neste mês">
          <ul className="list-disc pl-5">
            {q.contas_sem_extrato?.length ? <li>Sem extrato importado: {q.contas_sem_extrato.map((c) => c.nome).join(", ")}.</li> : null}
            {q.contas_extrato_incompleto?.map((c) => (
              <li key={c.id}>
                {c.nome}: última movimentação importada em {formatarData(c.ultimo_movimento)}.
              </li>
            ))}
            {q.movimentos?.pendentes ? <li>{q.movimentos.pendentes} movimentação(ões) bancária(s) ainda não conciliada(s).</li> : null}
          </ul>
          Os saldos do sistema refletem somente o que foi registrado no portal.
        </Alerta>
      ) : null}

      <div className="grid gap-5 2xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Saldos por conta</CardTitle>
            <CardDescription>Saldo do sistema comparado ao último saldo informado no extrato.</CardDescription>
          </CardHeader>
          <CardContent>
            {saldos.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Conta</Th>
                    <Th className="text-right">Sistema</Th>
                    <Th className="text-right">Extrato</Th>
                    <Th className="text-right">Diferença</Th>
                  </tr>
                </THead>
                <TBody>
                  {saldos.map((s) => {
                    const dif = s.saldo_extrato != null && s.saldo_sistema != null ? dec(s.saldo_sistema).minus(dec(s.saldo_extrato)) : null;
                    return (
                      <Tr key={s.conta_id}>
                        <Td>
                          <span className="block font-medium">{s.nome}</span>
                          <span className="text-xs text-muted-foreground">
                            {TIPOS_CONTA[s.tipo] ?? s.tipo}
                            {s.movimentos_pendentes ? ` · ${s.movimentos_pendentes} a conciliar` : ""}
                          </span>
                        </Td>
                        <Td className="text-right numero">{s.saldo_sistema != null ? formatarMoeda(s.saldo_sistema) : "—"}</Td>
                        <Td className="text-right numero">
                          {s.saldo_extrato != null ? (
                            <>
                              {formatarMoeda(s.saldo_extrato)}
                              <span className="block text-xs text-muted-foreground">{formatarData(s.saldo_extrato_data)}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="text-right numero">
                          {dif == null ? (
                            "—"
                          ) : dif.isZero() ? (
                            <Badge variante="sucesso">OK</Badge>
                          ) : (
                            <span className="text-perigo">{formatarMoeda(dif)}</span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <EstadoVazio icone={Landmark} titulo="Nenhuma conta cadastrada" descricao="Cadastre as contas bancárias, caixa, cartões e maquininhas com o saldo inicial." />
            )}
            <p className="mt-3 flex gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" /> A comparação usa o saldo do extrato na data informada pelo banco; diferenças indicam movimentações não registradas
              ou não conciliadas.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Próximos 30 dias</CardTitle>
            <CardDescription>Contas a pagar e a receber em aberto (inclui vencidas).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {proximos.length ? (
              <ul className="divide-y divide-border text-sm">
                {proximos.map((l) => {
                  const atrasado = l.data_vencimento < hoje;
                  return (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <Link href={`${base}/lancamentos/${l.id}`} className="block truncate font-medium hover:underline">
                          {l.descricao}
                        </Link>
                        <span className={atrasado ? "text-xs text-perigo" : "text-xs text-muted-foreground"}>
                          {formatarData(l.data_vencimento)}
                          {atrasado ? " · vencido" : ""}
                          {(l.contraparte as { nome: string } | null)?.nome ? ` · ${(l.contraparte as { nome: string }).nome}` : ""}
                        </span>
                      </span>
                      <span className={l.tipo === "receber" ? "shrink-0 font-medium text-sucesso numero" : "shrink-0 font-medium text-perigo numero"}>
                        {l.tipo === "receber" ? "+" : "−"} {formatarMoeda(aberto(l))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma conta a pagar ou a receber nos próximos 30 dias.</p>
            )}
            <Link href={`${base}/lancamentos`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Ver lançamentos <ArrowRight className="size-4" />
            </Link>
            {saldoProjetado?.lessThan(0) ? (
              <p className="flex gap-1.5 text-sm text-perigo">
                <AlertTriangle className="size-4 shrink-0" /> Pela previsão, o caixa fica negativo em até 30 dias. Revise prazos e recebimentos.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
