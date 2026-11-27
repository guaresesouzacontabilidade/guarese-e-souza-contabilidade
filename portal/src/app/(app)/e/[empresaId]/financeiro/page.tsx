import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, CalendarClock, ClipboardCheck, FileUp, Landmark, Minus, Plus, TrendingDown, TrendingUp, UserRound } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { GraficoEntradasSaidas } from "@/components/relatorios/graficos";
import { PendenciasPainel, type Urgente } from "@/components/financeiro/pendencias-painel";
import { formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { TIPOS_CONTA } from "@/lib/rotulos";
import { parametro } from "@/lib/busca";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Financeiro" };

const UUID = /^[0-9a-f-]{36}$/i;

type Faixa = { total: number; qtd: number };
type Titulos = Record<"vencido" | "hoje" | "d7" | "d30" | "futuro" | "total", Faixa>;
type Painel = {
  hoje: string;
  gerado_em: string;
  saldo_disponivel: number;
  saldo_selecionado: number;
  contas: { id: string; nome: string; tipo: string; disponivel: boolean; saldo: number; extrato_data: string | null; extrato_saldo: number | null; pendentes: number }[];
  titulos: { receber: Titulos; pagar: Titulos };
  realizado: { recebido_hoje: number; pago_hoje: number; recebido_mes: number; pago_mes: number; qtd_hoje: number };
  projecao: { hoje: number; d7: number | null; d30: number | null; primeiro_negativo: string | null; com_vencidos_d30: number };
  serie: { data: string; entradas: number; saidas: number; saldo: number; previsto: boolean }[];
  urgentes: Urgente[];
  clientes_atraso: { contraparte_id: string | null; nome: string; total: number; qtd: number; mais_antigo: string }[];
  pendencias: { sugeridos: number; aprovacoes: number; aprovacoes_total: number; conciliar: number; conciliar_total: number; sem_categoria: number };
};

/** Um número do painel que abre a lista já filtrada. */
function Numero({
  rotulo,
  valor,
  qtd,
  href,
  tom,
  icone: Icone,
  ajuda,
  destaque,
}: {
  rotulo: string;
  valor: number;
  qtd?: number;
  href: string;
  tom?: "sucesso" | "perigo" | "alerta" | "info";
  icone?: typeof TrendingUp;
  ajuda?: string;
  destaque?: boolean;
}) {
  const cor = tom === "sucesso" ? "text-sucesso" : tom === "perigo" ? "text-perigo" : tom === "alerta" ? "text-alerta-fg" : "";
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col justify-between rounded-2xl border bg-card p-4 transition-colors hover:border-primary/50",
        destaque && tom === "perigo" && valor > 0 ? "border-perigo/40 bg-perigo-bg" : "border-border",
      )}
    >
      <span className="flex items-start justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
        {Icone ? <Icone className={cn("size-4", cor || "text-muted-foreground")} aria-hidden /> : null}
      </span>
      <span className={cn("mt-1 text-xl font-bold numero", valor === 0 ? "text-muted-foreground" : cor)}>{formatarMoeda(valor)}</span>
      <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{qtd !== undefined ? `${qtd} título(s)` : ajuda}</span>
        <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
    </Link>
  );
}

/**
 * Visão geral do financeiro: quanto dinheiro há agora, o que entra e sai hoje
 * e nos próximos dias, o que venceu, se o saldo aguenta os compromissos e o
 * que precisa de conferência. Cada número abre a lista já filtrada.
 */
export default async function VisaoFinanceira({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const conta = UUID.test(parametro(sp, "conta")) ? parametro(sp, "conta") : "";
  const centro = UUID.test(parametro(sp, "centro")) ? parametro(sp, "centro") : "";
  const base = `/e/${empresaId}/financeiro`;
  const pagar = `${base}/pagar`;
  const receber = `${base}/receber`;
  const filtroCentro = centro ? `&centro=${centro}` : "";

  const [painelR, { data: contasLista }, { data: centros }] = await Promise.all([
    ctx.supabase.rpc("financeiro_painel", { p_empresa_id: empresaId, p_conta_id: conta || undefined, p_centro_custo_id: centro || undefined }),
    ctx.supabase.from("contas_financeiras").select("id, nome").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ctx.supabase.from("centros_custo").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
  ]);
  if (painelR.error || !painelR.data) return <Alerta tom="perigo">Não foi possível carregar o painel agora. Tente de novo em instantes.</Alerta>;
  const p = painelR.data as unknown as Painel;
  const r = p.titulos.receber;
  const g = p.titulos.pagar;
  const horario = new Date(p.gerado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const pend = p.pendencias;
  const conferir = pend.sugeridos + pend.aprovacoes + pend.conciliar + pend.sem_categoria;
  const contasDisponiveis = p.contas.filter((c) => c.disponivel || conta);
  const negativo = p.projecao.primeiro_negativo;
  // "Clientes em atraso" só com clientes do cadastro; o vencido sem cliente (balcão) vem à parte
  const clientesAtraso = p.clientes_atraso.filter((c) => c.contraparte_id);
  const semCliente = p.clientes_atraso.find((c) => !c.contraparte_id) ?? null;

  return (
    <>
      <CabecalhoPagina
        titulo="Financeiro"
        descricao={`Saldos em ${formatarData(p.hoje)} às ${horario}. Valores dos pagamentos, recebimentos e transferências registrados no portal.`}
        acoes={
          <>
            {ctx.pode("financeiro.editar") ? (
              <>
                <Button asChild variante="contorno" className="border-perigo/40">
                  <Link href={`${pagar}/novo`}>
                    <Minus className="text-perigo" /> Nova despesa
                  </Link>
                </Button>
                <Button asChild variante="contorno" className="border-sucesso/40">
                  <Link href={`${receber}/novo`}>
                    <Plus className="text-sucesso" /> Nova receita
                  </Link>
                </Button>
                <Button asChild variante="contorno">
                  <Link href={`${base}/caixa#operacoes`}>
                    <ArrowLeftRight /> Transferência
                  </Link>
                </Button>
              </>
            ) : null}
            {ctx.pode("financeiro.importar") ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/importar`}>
                  <FileUp /> Importar extrato
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" aria-label="Filtros do painel">
        <Select name="conta" defaultValue={conta} aria-label="Conta" className="w-auto min-w-48">
          <option value="">Todas as contas (saldo disponível)</option>
          {(contasLista ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
        {centros?.length ? (
          <Select name="centro" defaultValue={centro} aria-label="Centro de custo" className="w-auto min-w-48">
            <option value="">Todos os centros de custo</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        ) : null}
        <Button type="submit" variante="secundario" tamanho="sm">
          Aplicar
        </Button>
        {conta || centro ? (
          <Button asChild variante="fantasma" tamanho="sm">
            <Link href={base}>Limpar</Link>
          </Button>
        ) : null}
      </form>

      {/* Dinheiro agora e saldo projetado */}
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
              <Landmark className="size-4" /> {conta ? "Saldo da conta agora" : "Dinheiro disponível agora"}
            </CardDescription>
            <CardTitle className={cn("text-3xl numero", p.saldo_selecionado < 0 ? "text-perigo" : "")} data-testid="saldo-disponivel">
              {formatarMoeda(p.saldo_selecionado)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" aria-label="Saldo por conta">
              {contasDisponiveis.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate">{c.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {TIPOS_CONTA[c.tipo]}
                      {c.pendentes ? ` · ${c.pendentes} a conciliar` : ""}
                      {c.extrato_data ? ` · extrato até ${formatarData(c.extrato_data)}` : ""}
                    </span>
                  </span>
                  <span className={cn("numero shrink-0 whitespace-nowrap font-medium", c.saldo < 0 ? "text-perigo" : "")}>{formatarMoeda(c.saldo)}</span>
                </li>
              ))}
            </ul>
            <Link href={`${base}/caixa`} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Caixa e bancos <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
        <Card className={negativo ? "border-perigo/40" : undefined}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
              <CalendarClock className="size-4" /> Saldo projetado
            </CardDescription>
            <CardTitle className={cn("text-3xl numero", (p.projecao.d30 ?? 0) < 0 ? "text-perigo" : "")} data-testid="saldo-projetado">
              {formatarMoeda(p.projecao.d30 ?? p.projecao.hoje)}
            </CardTitle>
            <CardDescription>em 30 dias, pelo que vence (sem os vencidos)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Fim de hoje (com o que vence hoje)</span>
              <span className="numero shrink-0 whitespace-nowrap font-medium">{formatarMoeda(p.projecao.hoje)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Em 7 dias</span>
              <span className={cn("numero shrink-0 whitespace-nowrap font-medium", (p.projecao.d7 ?? 0) < 0 ? "text-perigo" : "")}>{formatarMoeda(p.projecao.d7 ?? 0)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Em 30 dias, se os vencidos forem pagos e recebidos</span>
              <span className="numero shrink-0 whitespace-nowrap font-medium">{formatarMoeda(p.projecao.com_vencidos_d30)}</span>
            </div>
            {negativo ? (
              <Alerta tom="perigo" titulo={`O saldo fica negativo em ${formatarData(negativo)}`}>
                Antecipe recebimentos, renegocie pagamentos ou transfira de outra conta antes dessa data.
              </Alerta>
            ) : (
              <p className="text-xs text-sucesso">O saldo projetado cobre os compromissos dos próximos 30 dias.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Hoje */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Hoje</h2>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero rotulo="A receber hoje" valor={r.hoje.total} qtd={r.hoje.qtd} href={`${receber}?prazo=hoje&revisao=confirmado${filtroCentro}`} tom="sucesso" icone={ArrowDownLeft} />
        <Numero rotulo="A pagar hoje" valor={g.hoje.total} qtd={g.hoje.qtd} href={`${pagar}?prazo=hoje&revisao=confirmado${filtroCentro}`} tom="alerta" icone={ArrowUpRight} />
        <Numero rotulo="Recebido hoje" valor={p.realizado.recebido_hoje} href={`${receber}?situacao=todos&por=vencimento`} ajuda={`no mês: ${formatarMoeda(p.realizado.recebido_mes)}`} tom="sucesso" icone={TrendingUp} />
        <Numero rotulo="Pago hoje" valor={p.realizado.pago_hoje} href={`${pagar}?situacao=todos&por=vencimento`} ajuda={`no mês: ${formatarMoeda(p.realizado.pago_mes)}`} icone={TrendingDown} />
      </div>

      {/* Vencidos e próximos dias */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="t-receber">
          <h2 id="t-receber" className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            A receber
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Numero rotulo="Recebimentos vencidos" valor={r.vencido.total} qtd={r.vencido.qtd} href={`${receber}?prazo=vencido&revisao=confirmado${filtroCentro}`} tom="perigo" icone={AlertTriangle} destaque />
            <Numero rotulo="Próximos 7 dias" valor={r.d7.total} qtd={r.d7.qtd} href={`${receber}?prazo=proximos7&revisao=confirmado${filtroCentro}`} tom="sucesso" />
            <Numero rotulo="Próximos 30 dias" valor={r.d30.total} qtd={r.d30.qtd} href={`${receber}?prazo=proximos30&revisao=confirmado${filtroCentro}`} tom="sucesso" />
            <Numero rotulo="Futuro (tudo a vencer)" valor={r.futuro.total} qtd={r.futuro.qtd} href={`${receber}?prazo=a_vencer&revisao=confirmado${filtroCentro}`} />
          </div>
        </section>
        <section aria-labelledby="t-pagar">
          <h2 id="t-pagar" className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            A pagar
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Numero rotulo="Pagamentos vencidos" valor={g.vencido.total} qtd={g.vencido.qtd} href={`${pagar}?prazo=vencido&revisao=confirmado${filtroCentro}`} tom="perigo" icone={AlertTriangle} destaque />
            <Numero rotulo="Próximos 7 dias" valor={g.d7.total} qtd={g.d7.qtd} href={`${pagar}?prazo=proximos7&revisao=confirmado${filtroCentro}`} tom="alerta" />
            <Numero rotulo="Próximos 30 dias" valor={g.d30.total} qtd={g.d30.qtd} href={`${pagar}?prazo=proximos30&revisao=confirmado${filtroCentro}`} tom="alerta" />
            <Numero rotulo="Futuro (tudo a vencer)" valor={g.futuro.total} qtd={g.futuro.qtd} href={`${pagar}?prazo=a_vencer&revisao=confirmado${filtroCentro}`} />
          </div>
        </section>
      </div>

      <div className="mb-5">
        <GraficoEntradasSaidas pontos={p.serie} hoje={p.hoje} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Pagamentos e recebimentos urgentes</CardTitle>
            <CardDescription>Vencidos e o que vence nos próximos 3 dias. Pague, receba ou aprove daqui mesmo.</CardDescription>
          </CardHeader>
          <CardContent>
            <PendenciasPainel
              empresaId={empresaId}
              itens={p.urgentes.slice(0, 6)}
              hoje={p.hoje}
              permissoes={{ baixar: ctx.pode("financeiro.baixar"), aprovar: ctx.pode("financeiro.aprovar") }}
              contas={contasLista ?? []}
            />
            {p.urgentes.length > 6 ? (
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-sm" data-testid="ver-todos-urgentes">
                <span className="text-muted-foreground">Mostrando os 6 mais urgentes de {p.urgentes.length}.</span>
                {g.vencido.qtd || g.hoje.qtd ? (
                  <Link href={`${pagar}?prazo=vencido&revisao=confirmado${filtroCentro}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    Ver todos a pagar <ArrowRight className="size-3.5" />
                  </Link>
                ) : null}
                {r.vencido.qtd || r.hoje.qtd ? (
                  <Link href={`${receber}?prazo=vencido&revisao=confirmado${filtroCentro}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    Ver todos a receber <ArrowRight className="size-3.5" />
                  </Link>
                ) : null}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-5" /> Precisa de conferência
              </CardTitle>
              <CardDescription>{conferir ? "Resolva para os números ficarem completos." : "Nada pendente de conferência."}</CardDescription>
            </CardHeader>
            {conferir ? (
              <CardContent>
                <ul className="space-y-1.5 text-sm" data-testid="conferencia-painel">
                  {pend.aprovacoes ? (
                    <li>
                      <Link className="flex justify-between gap-2 hover:underline" href={`${pagar}?aprovacao=pendente&situacao=em_aberto`}>
                        <span>Pagamentos aguardando aprovação ({pend.aprovacoes})</span>
                        <span className="numero">{formatarMoeda(pend.aprovacoes_total)}</span>
                      </Link>
                    </li>
                  ) : null}
                  {pend.conciliar ? (
                    <li>
                      <Link className="flex justify-between gap-2 hover:underline" href={`/e/${empresaId}/conciliacao`}>
                        <span>Movimentos do banco a conciliar ({pend.conciliar})</span>
                        <span className="numero">{formatarMoeda(pend.conciliar_total)}</span>
                      </Link>
                    </li>
                  ) : null}
                  {pend.sugeridos ? (
                    <li>
                      <Link className="hover:underline" href={`${pagar}?revisao=sugerido&situacao=todos`}>
                        Lançamentos sugeridos a conferir ({pend.sugeridos})
                      </Link>
                    </li>
                  ) : null}
                  {pend.sem_categoria ? (
                    <li>
                      <Link className="hover:underline" href={`${pagar}?revisao=sugerido&situacao=todos`}>
                        Sem categoria ({pend.sem_categoria})
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="size-5" /> Clientes em atraso
              </CardTitle>
            </CardHeader>
            <CardContent>
              {clientesAtraso.length ? (
                <ul className="divide-y divide-border text-sm" data-testid="clientes-atraso">
                  {clientesAtraso.map((c) => (
                    <li key={c.contraparte_id ?? "sem"} className="flex items-center justify-between gap-2 py-1.5">
                      {c.contraparte_id ? (
                        <Link href={`${receber}/contraparte/${c.contraparte_id}`} className="min-w-0 truncate hover:underline">
                          {c.nome}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate">{c.nome}</span>
                      )}
                      <span className="shrink-0 text-right">
                        <span className="block numero font-medium text-perigo">{formatarMoeda(c.total)}</span>
                        <span className="text-xs text-muted-foreground">desde {formatarData(c.mais_antigo)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum cliente com recebimento vencido.</p>
              )}
              {semCliente ? (
                <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  E mais{" "}
                  <Link href={`${receber}?prazo=vencido&revisao=confirmado`} className="numero font-medium text-perigo hover:underline">
                    {formatarMoeda(semCliente.total)}
                  </Link>{" "}
                  vencidos sem cliente no cadastro (vendas de balcão e outros).
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
