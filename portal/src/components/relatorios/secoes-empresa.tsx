import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, FileBarChart, Info, Landmark, Scale, Wallet } from "lucide-react";
import { Indicador } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { GraficoBarras, GraficoLinhas } from "@/components/relatorios/graficos";
import { Decimal, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarPercentual } from "@/lib/formatos";
import { TIPOS_CONTA } from "@/lib/rotulos";
import { cn } from "@/lib/utils";
import { FAIXAS_AGING, percentual, type Aging, type Dre, type FluxoMensal } from "@/lib/relatorios/calculos";
import type { DadosSaldos } from "@/lib/relatorios/dados";

/** Seções da tela de relatórios de uma empresa (componentes do servidor). */

const n = (v: Decimal | null | undefined) => (v == null ? null : v.toDecimalPlaces(2).toNumber());
const tomValor = (v: Decimal | null | undefined) => (v == null || v.isZero() ? "neutro" : v.isNegative() ? "perigo" : "sucesso");
const mesCurto = (m: string) => formatarCompetencia(m);

function Nota({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex gap-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" /> <span>{children}</span>
    </p>
  );
}

// -----------------------------------------------------------------------------
// Fluxo de caixa
// -----------------------------------------------------------------------------

export function SecaoFluxo({ fluxo }: { fluxo: FluxoMensal }) {
  const t = fluxo.totais;
  const realizado = t.entradasRealizadas.minus(t.saidasRealizadas);
  const previsto = t.entradasPrevistas.minus(t.saidasPrevistas);
  const vazio = [t.entradasPrevistas, t.saidasPrevistas, t.entradasRealizadas, t.saidasRealizadas].every((v) => v.isZero());
  if (vazio) {
    return (
      <EstadoVazio
        icone={Wallet}
        titulo="Nenhuma movimentação no período"
        descricao="Registre lançamentos, baixas e transferências (ou importe os extratos) para acompanhar o fluxo de caixa."
      />
    );
  }
  const dados = fluxo.meses.map((m) => ({
    rotulo: mesCurto(m.mes),
    entradasPrevistas: n(m.entradasPrevistas),
    entradasRealizadas: n(m.entradasRealizadas),
    saidasPrevistas: n(m.saidasPrevistas),
    saidasRealizadas: n(m.saidasRealizadas),
  }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Entradas realizadas" valor={formatarMoeda(t.entradasRealizadas)} detalhe={`Previstas: ${formatarMoeda(t.entradasPrevistas)}`} icone={ArrowDownLeft} />
        <Indicador rotulo="Saídas realizadas" valor={formatarMoeda(t.saidasRealizadas)} detalhe={`Previstas: ${formatarMoeda(t.saidasPrevistas)}`} icone={ArrowUpRight} />
        <Indicador rotulo="Geração de caixa" valor={formatarMoeda(realizado)} detalhe="Entradas menos saídas realizadas" tom={tomValor(realizado)} icone={Scale} />
        <Indicador rotulo="Resultado previsto" valor={formatarMoeda(previsto)} detalhe="Pelos vencimentos do período" tom={tomValor(previsto)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entradas e saídas por mês</CardTitle>
          <CardDescription>Previsto (barras claras) pelos vencimentos; realizado pelos pagamentos e recebimentos efetivos.</CardDescription>
        </CardHeader>
        <CardContent>
          <GraficoBarras
            dados={dados}
            descricao="Gráfico de barras com entradas e saídas previstas e realizadas por mês"
            series={[
              { chave: "entradasPrevistas", rotulo: "Entradas previstas", cor: 3, clara: true },
              { chave: "entradasRealizadas", rotulo: "Entradas realizadas", cor: 3 },
              { chave: "saidasPrevistas", rotulo: "Saídas previstas", cor: 4, clara: true },
              { chave: "saidasRealizadas", rotulo: "Saídas realizadas", cor: 4 },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Fluxo mensal</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <tr>
                  <Th>Mês</Th>
                  <Th className="text-right">Entradas prev.</Th>
                  <Th className="text-right">Entradas real.</Th>
                  <Th className="text-right">Saídas prev.</Th>
                  <Th className="text-right">Saídas real.</Th>
                  <Th className="text-right">Saldo real.</Th>
                </tr>
              </THead>
              <TBody>
                {fluxo.meses.map((m) => {
                  const liq = m.entradasRealizadas.minus(m.saidasRealizadas);
                  return (
                    <Tr key={m.mes}>
                      <Td className="whitespace-nowrap">{formatarCompetencia(m.mes, true)}</Td>
                      <Td className="text-right numero text-muted-foreground">{formatarMoeda(m.entradasPrevistas)}</Td>
                      <Td className="text-right numero">{formatarMoeda(m.entradasRealizadas)}</Td>
                      <Td className="text-right numero text-muted-foreground">{formatarMoeda(m.saidasPrevistas)}</Td>
                      <Td className="text-right numero">{formatarMoeda(m.saidasRealizadas)}</Td>
                      <Td className={cn("text-right font-medium numero", liq.isNegative() && "text-perigo")}>{formatarMoeda(liq)}</Td>
                    </Tr>
                  );
                })}
              </TBody>
              <TFoot>
                <tr>
                  <Td>Total</Td>
                  <Td className="text-right numero">{formatarMoeda(t.entradasPrevistas)}</Td>
                  <Td className="text-right numero">{formatarMoeda(t.entradasRealizadas)}</Td>
                  <Td className="text-right numero">{formatarMoeda(t.saidasPrevistas)}</Td>
                  <Td className="text-right numero">{formatarMoeda(t.saidasRealizadas)}</Td>
                  <Td className={cn("text-right numero", realizado.isNegative() && "text-perigo")}>{formatarMoeda(realizado)}</Td>
                </tr>
              </TFoot>
            </Table>
            <Nota>
              Considera bancos e caixa (contas que compõem o saldo disponível). Transferências entre essas contas não entram; compras no cartão entram quando a
              fatura é paga.
            </Nota>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Realizado por natureza</CardTitle>
            <CardDescription>Origem das entradas e saídas de caixa.</CardDescription>
          </CardHeader>
          <CardContent>
            {fluxo.grupos.length ? (
              <ul className="divide-y divide-border text-sm">
                {fluxo.grupos.map((g) => {
                  const liq = g.entradas.minus(g.saidas);
                  return (
                    <li key={g.grupo} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{g.rotulo}</span>
                        <span className={cn("font-semibold numero", liq.isNegative() ? "text-perigo" : "text-sucesso")}>{formatarMoeda(liq, { sinal: true })}</span>
                      </div>
                      <p className="text-xs text-muted-foreground numero">
                        Entradas {formatarMoeda(g.entradas)} · saídas {formatarMoeda(g.saidas)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum pagamento ou recebimento realizado no período.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// DRE
// -----------------------------------------------------------------------------

export function SecaoDre({ dre, meses, base }: { dre: Dre; meses: string[]; base: string }) {
  const temDados = dre.linhas.some((l) => l.nivel === "categoria");
  if (!temDados) {
    return (
      <EstadoVazio
        icone={FileBarChart}
        titulo="Nenhum resultado no período"
        descricao="A DRE usa lançamentos confirmados pela data de competência. Confirme os lançamentos sugeridos e classifique as categorias."
        acao={
          <Link href={`${base}/financeiro/lancamentos?revisao=sugerido`} className="text-sm font-medium text-primary hover:underline">
            Ver lançamentos sugeridos
          </Link>
        }
      />
    );
  }
  const rb = dre.receitaBruta.total;
  const rl = dre.resultadoLiquido.total;
  const margem = percentual(rl, dre.receitaLiquida.total);
  const dados = meses.map((m, i) => ({
    rotulo: mesCurto(m),
    receitaLiquida: n(dre.receitaLiquida.valores[i]),
    resultado: n(dre.resultadoLiquido.valores[i]),
  }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Receita bruta" valor={formatarMoeda(rb)} icone={ArrowDownLeft} />
        <Indicador rotulo="Receita líquida" valor={formatarMoeda(dre.receitaLiquida.total)} detalhe="Receita bruta menos deduções" />
        <Indicador rotulo="Resultado líquido" valor={formatarMoeda(rl)} tom={tomValor(rl)} icone={Scale} />
        <Indicador rotulo="Margem líquida" valor={formatarPercentual(margem, 1)} detalhe="Resultado sobre a receita líquida" tom={margem == null ? "neutro" : margem < 0 ? "perigo" : "neutro"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receita líquida e resultado por mês</CardTitle>
        </CardHeader>
        <CardContent>
          <GraficoBarras
            dados={dados}
            descricao="Gráfico de barras com receita líquida e resultado líquido por mês"
            series={[
              { chave: "receitaLiquida", rotulo: "Receita líquida", cor: 1 },
              { chave: "resultado", rotulo: "Resultado líquido", cor: 2 },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demonstração do resultado</CardTitle>
          <CardDescription>Gerencial, por competência, a partir das categorias financeiras.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <tr>
                <Th className="sticky left-0 bg-muted">Linha</Th>
                {meses.map((m) => (
                  <Th key={m} className="text-right">
                    {mesCurto(m)}
                  </Th>
                ))}
                <Th className="text-right">Total</Th>
                <Th className="text-right">% RB</Th>
              </tr>
            </THead>
            <TBody>
              {dre.linhas.map((l) => {
                const destaque = l.nivel === "subtotal";
                const categoria = l.nivel === "categoria";
                return (
                  <Tr key={`${l.nivel}-${l.chave}`} className={cn(destaque && "bg-muted/50 font-semibold", l.nivel === "grupo" && "font-medium")}>
                    <Td className={cn("sticky left-0 whitespace-nowrap bg-card", destaque && "bg-muted", categoria && "pl-7 text-muted-foreground")}>{l.rotulo}</Td>
                    {l.valores.map((v, i) => (
                      <Td key={meses[i]} className={cn("text-right whitespace-nowrap numero", categoria && "text-muted-foreground", destaque && v.isNegative() && "text-perigo")}>
                        {v.isZero() && categoria ? "—" : formatarMoeda(v)}
                      </Td>
                    ))}
                    <Td className={cn("text-right whitespace-nowrap numero", destaque && l.total.isNegative() && "text-perigo")}>{formatarMoeda(l.total)}</Td>
                    <Td className="text-right whitespace-nowrap text-xs text-muted-foreground numero">{formatarPercentual(percentual(l.total, rb), 1)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Nota>
            Lançamentos confirmados pela data de competência; juros, multas, descontos e taxas na data do pagamento. Lançamentos sugeridos, aportes, retiradas,
            empréstimos e investimentos não entram no resultado.
          </Nota>
        </CardContent>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Contas a pagar e a receber
// -----------------------------------------------------------------------------

export function SecaoContas({ aging, hoje, base }: { aging: Aging & { sugeridos: number }; hoje: string; base: string }) {
  const r = aging.receber;
  const p = aging.pagar;
  const lanc = `${base}/financeiro/lancamentos`;
  const curtos: Record<string, string> = {
    vencer_mais_30: "Vence em +30d",
    vencer_30: "Vence em até 30d",
    vencido_30: "Vencido até 30d",
    vencido_60: "Vencido 31–60d",
    vencido_90: "Vencido 61–90d",
    vencido_mais_90: "Vencido +90d",
  };
  const dados = FAIXAS_AGING.map((f) => ({ rotulo: curtos[f.chave], receber: n(r.faixas[f.chave].valor), pagar: n(p.faixas[f.chave].valor) }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="A receber em aberto" valor={formatarMoeda(r.total)} icone={ArrowDownLeft} href={`${lanc}?tipo=receber&situacao=em_aberto`} />
        <Indicador rotulo="A receber vencido" valor={formatarMoeda(r.vencido)} tom={r.vencido.isZero() ? "neutro" : "alerta"} href={`${lanc}?tipo=receber&situacao=atrasado`} />
        <Indicador rotulo="A pagar em aberto" valor={formatarMoeda(p.total)} icone={ArrowUpRight} href={`${lanc}?tipo=pagar&situacao=em_aberto`} />
        <Indicador rotulo="A pagar vencido" valor={formatarMoeda(p.vencido)} tom={p.vencido.isZero() ? "neutro" : "perigo"} href={`${lanc}?tipo=pagar&situacao=atrasado`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Em aberto por vencimento</CardTitle>
          <CardDescription>Posição em {formatarData(hoje)} — independe do período selecionado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {r.total.isZero() && p.total.isZero() ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta a pagar ou a receber em aberto.</p>
          ) : (
            <GraficoBarras
              dados={dados}
              descricao="Gráfico de barras com valores a receber e a pagar por faixa de vencimento"
              series={[
                { chave: "receber", rotulo: "A receber", cor: 3 },
                { chave: "pagar", rotulo: "A pagar", cor: 4 },
              ]}
            />
          )}
          <Table>
            <THead>
              <tr>
                <Th>Faixa</Th>
                <Th className="text-right">A receber</Th>
                <Th className="text-right">A pagar</Th>
              </tr>
            </THead>
            <TBody>
              {FAIXAS_AGING.map((f) => (
                <Tr key={f.chave}>
                  <Td>
                    <span className="flex items-center gap-2">
                      {f.rotulo}
                      {f.chave === "vencido_mais_90" && (r.faixas[f.chave].quantidade || p.faixas[f.chave].quantidade) ? <Badge variante="perigo">Atenção</Badge> : null}
                    </span>
                  </Td>
                  <Td className="text-right numero">
                    {formatarMoeda(r.faixas[f.chave].valor)}
                    <span className="block text-xs text-muted-foreground">{r.faixas[f.chave].quantidade} título(s)</span>
                  </Td>
                  <Td className="text-right numero">
                    {formatarMoeda(p.faixas[f.chave].valor)}
                    <span className="block text-xs text-muted-foreground">{p.faixas[f.chave].quantidade} título(s)</span>
                  </Td>
                </Tr>
              ))}
            </TBody>
            <TFoot>
              <tr>
                <Td>Total em aberto</Td>
                <Td className="text-right numero">{formatarMoeda(r.total)}</Td>
                <Td className="text-right numero">{formatarMoeda(p.total)}</Td>
              </tr>
            </TFoot>
          </Table>
          <Nota>
            Valores ainda não pagos de lançamentos confirmados (inclui parcialmente pagos). Compras no cartão de crédito entram pela fatura.
            {aging.sugeridos ? ` Há ${aging.sugeridos} lançamento(s) sugerido(s) que ainda não entram nestes totais.` : ""}
          </Nota>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        {[
          { titulo: "Maiores valores a receber", lado: r, vazio: "Nada a receber em aberto." },
          { titulo: "Maiores valores a pagar", lado: p, vazio: "Nada a pagar em aberto." },
        ].map((b) => (
          <Card key={b.titulo}>
            <CardHeader>
              <CardTitle>{b.titulo}</CardTitle>
            </CardHeader>
            <CardContent>
              {b.lado.maiores.length ? (
                <ul className="divide-y divide-border text-sm">
                  {b.lado.maiores.map((c) => (
                    <li key={c.nome} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.nome}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.quantidade} título(s)
                          {c.vencido.isZero() ? "" : ` · vencido ${formatarMoeda(c.vencido)}`}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium numero">{formatarMoeda(c.valor)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{b.vazio}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Link href={lanc} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        Ver lançamentos <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Saldos
// -----------------------------------------------------------------------------

export function SecaoSaldos({ saldos, base }: { saldos: DadosSaldos; base: string }) {
  if (!saldos.contas.length) {
    return <EstadoVazio icone={Landmark} titulo="Nenhuma conta cadastrada" descricao="Cadastre as contas bancárias, caixa, cartões e maquininhas com o saldo inicial." />;
  }
  const ini = saldos.disponivelInicial.valor;
  const fim = saldos.disponivelFinal.valor;
  const variacao = ini && fim ? fim.minus(ini) : null;
  const dados = saldos.evolucao.map((e) => ({ rotulo: mesCurto(e.mes), saldo: n(e.valor) }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicador
          rotulo={`Disponível em ${formatarData(saldos.dataInicial)}`}
          valor={ini ? formatarMoeda(ini) : "—"}
          detalhe={saldos.disponivelInicial.incompleto ? "Há contas sem saldo inicial nesta data" : "Bancos e caixa"}
          icone={Landmark}
        />
        <Indicador
          rotulo={`Disponível em ${formatarData(saldos.dataFinal)}`}
          valor={fim ? formatarMoeda(fim) : "—"}
          detalhe={saldos.disponivelFinal.incompleto ? "Há contas sem saldo inicial nesta data" : "Bancos e caixa"}
          tom={fim?.isNegative() ? "perigo" : "neutro"}
          icone={Landmark}
          href={`${base}/financeiro/contas`}
        />
        <Indicador rotulo="Variação no período" valor={variacao ? formatarMoeda(variacao, { sinal: true }) : "—"} tom={tomValor(variacao)} icone={Scale} />
      </div>

      {dados.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Saldo disponível ao fim de cada mês</CardTitle>
            <CardDescription>No mês atual, o saldo de hoje.</CardDescription>
          </CardHeader>
          <CardContent>
            <GraficoLinhas dados={dados} descricao="Gráfico de linha com o saldo disponível ao fim de cada mês" series={[{ chave: "saldo", rotulo: "Saldo disponível", cor: 1 }]} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Saldos por conta</CardTitle>
          <CardDescription>Saldo do sistema no início e no fim do período, comparado ao último extrato informado.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <tr>
                <Th>Conta</Th>
                <Th className="text-right">{formatarData(saldos.dataInicial)}</Th>
                <Th className="text-right">{formatarData(saldos.dataFinal)}</Th>
                <Th className="text-right">Variação</Th>
                <Th className="text-right">Extrato</Th>
                <Th className="hidden md:table-cell">Conciliado até</Th>
              </tr>
            </THead>
            <TBody>
              {saldos.contas.map((c) => {
                const v = c.saldo_sistema && c.saldo_inicial_periodo ? c.saldo_sistema.minus(c.saldo_inicial_periodo) : null;
                const dif = c.saldo_extrato && c.saldo_sistema ? c.saldo_sistema.minus(c.saldo_extrato) : null;
                return (
                  <Tr key={c.conta_id}>
                    <Td>
                      <span className="block font-medium">{c.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {TIPOS_CONTA[c.tipo] ?? c.tipo}
                        {c.compoe_saldo_disponivel ? "" : " · fora do disponível"}
                        {c.movimentos_pendentes ? ` · ${c.movimentos_pendentes} a conciliar` : ""}
                      </span>
                    </Td>
                    <Td className="text-right numero">{formatarMoeda(c.saldo_inicial_periodo)}</Td>
                    <Td className={cn("text-right numero", c.saldo_sistema?.isNegative() && "text-perigo")}>{formatarMoeda(c.saldo_sistema)}</Td>
                    <Td className="text-right numero">{v ? formatarMoeda(v, { sinal: true }) : "—"}</Td>
                    <Td className="text-right numero">
                      {c.saldo_extrato ? (
                        <>
                          {formatarMoeda(c.saldo_extrato)}
                          <span className="block text-xs text-muted-foreground">
                            {formatarData(c.saldo_extrato_data)}
                            {dif && !dif.isZero() ? <span className="text-perigo"> · dif. {formatarMoeda(dif)}</span> : null}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="hidden text-sm md:table-cell">{formatarData(c.conciliado_ate)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Nota>“—” indica data anterior ao saldo inicial informado da conta. Os saldos refletem somente o que foi registrado no portal.</Nota>
        </CardContent>
      </Card>
    </div>
  );
}
