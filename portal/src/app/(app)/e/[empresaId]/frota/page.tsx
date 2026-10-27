import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, Fuel, Gauge, Route, TrendingUp, Truck, Wallet } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { GraficoComposicao } from "@/components/relatorios/graficos";
import { GraficoCascata, GraficoConsumo, GraficoRanking } from "@/components/frota/graficos";
import { DialogoVeiculo, ExcluirLancamento, NovaDespesa, NovaViagem } from "@/components/frota/lancamentos";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { hojeISO } from "@/lib/competencia";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { formatarData, nomeMes } from "@/lib/formatos";
import { carregarFrota, mesMaisRecente } from "@/lib/frota/dados";
import { cadaCem, calcularFrota, fatorDoMes, GRUPOS_DESPESA, type ResultadoVeiculo } from "@/lib/frota/rentabilidade";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Rentabilidade da frota" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placa = (p: string) => `${p.slice(0, 3)}-${p.slice(3)}`;
const numero = (v: number | null | undefined, casas = 0) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const nomeDoMes = (mes: string) => `${nomeMes(Number(mes.slice(5, 7))).toLowerCase()} de ${mes.slice(0, 4)}`;
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
function deslocarMes(mes: string, d: number) {
  const t = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + d, 1));
  return t.toISOString().slice(0, 7);
}

const SEMAFORO = {
  verde: { cor: "bg-sucesso", texto: "Lucro bom", variante: "sucesso" as const },
  amarelo: { cor: "bg-alerta", texto: "Lucro apertado", variante: "alerta" as const },
  vermelho: { cor: "bg-perigo", texto: "Prejuízo", variante: "perigo" as const },
  parado: { cor: "bg-muted-foreground", texto: "Parado", variante: "neutro" as const },
};

const CORES_CEM: Record<string, string> = {
  combustivel: "bg-[var(--grafico-1)]",
  motorista: "bg-[var(--grafico-2)]",
  caminhao: "bg-[var(--grafico-3)]",
  impostos: "bg-[var(--grafico-5)]",
  escritorio: "bg-[var(--grafico-4)]",
  lucro: "bg-sucesso",
};

/** Frase do resultado, em português do dia a dia. */
function frase(r: Pick<ResultadoVeiculo, "faturamento" | "lucro" | "margem" | "km">, quem: string, viagens: number) {
  if (r.faturamento === 0) return `${quem} não teve frete no mês — só os custos fixos (${formatarMoeda(-r.lucro)}).`;
  const resultado = r.lucro >= 0 ? `deu lucro de verdade de ${formatarMoeda(r.lucro)}` : `deu prejuízo de ${formatarMoeda(-r.lucro)}`;
  const km = r.km.rodado ? `, rodou ${numero(r.km.rodado)} km` : "";
  return `${quem} fez ${viagens} viage${viagens === 1 ? "m" : "ns"}${km}, faturou ${formatarMoeda(r.faturamento)} e ${resultado} (${pct(r.margem)} do frete).`;
}

function CadaCem({ fatias }: { fatias: ReturnType<typeof cadaCem> }) {
  if (!fatias.length) return null;
  const positivas = fatias.filter((f) => f.valor > 0);
  const prejuizo = fatias.find((f) => f.chave === "lucro" && f.valor < 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>De cada R$ 100 de frete, para onde foi o dinheiro</CardTitle>
        <CardDescription>A barra inteira é o frete. Cada cor é uma parte dele.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-9 w-full overflow-hidden rounded-full border border-border" role="img" aria-label="Divisão do frete">
          {positivas.map((f) => (
            <div key={f.chave} className={cn("h-full", CORES_CEM[f.chave])} style={{ width: `${Math.min(f.valor, 100)}%` }} title={`${f.rotulo}: R$ ${numero(f.valor, 2)}`} />
          ))}
        </div>
        <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {fatias.map((f) => (
            <li key={f.chave} className="flex items-center gap-2">
              <span className={cn("size-3 shrink-0 rounded-full", f.valor < 0 ? "bg-perigo" : CORES_CEM[f.chave])} aria-hidden />
              <span className="min-w-0 flex-1">{f.rotulo}</span>
              <span className={cn("numero font-semibold", f.chave === "lucro" && (f.valor < 0 ? "text-perigo" : "text-sucesso"))}>R$ {numero(Math.abs(f.valor), 2)}</span>
            </li>
          ))}
        </ul>
        {prejuizo ? (
          <Alerta tom="perigo">
            Os custos passaram do frete: para cada R$ 100 de frete faltaram R$ {numero(-prejuizo.valor, 2)}.
          </Alerta>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function PaginaFrota({ params, searchParams }: PageProps<"/e/[empresaId]/frota">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) notFound();
  const podeLancar = ctx.pode("financeiro.editar");
  const hoje = hojeISO();
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : await mesMaisRecente(ctx.supabase, empresaId, hoje);
  const rateioTexto = typeof sp.rateio === "string" ? sp.rateio : "";
  const rateioTotal = Math.max(Number(lerValorBR(rateioTexto)?.toString() ?? 0), 0);
  const dados = await carregarFrota(ctx.supabase, empresaId, mes);
  const fator = fatorDoMes(mes, hoje);
  const frota = calcularFrota(dados.veiculos, dados.viagens, dados.despesas, { kmAntes: dados.kmAntes, fatorFixos: fator, rateioTotal });
  const veiculoId = typeof sp.veiculo === "string" && UUID.test(sp.veiculo) ? sp.veiculo : null;
  const sel = veiculoId ? (frota.veiculos.find((v) => v.veiculo.id === veiculoId) ?? null) : null;
  const base = `/e/${empresaId}/frota`;
  const link = (alt: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const atual: Record<string, string | null> = { mes, veiculo: sel?.veiculo.id ?? null, rateio: rateioTexto || null, ...alt };
    for (const [k, v] of Object.entries(atual)) if (v) q.set(k, v);
    return `${base}?${q.toString()}`;
  };
  const opcoes = dados.todos.filter((v) => v.ativo).map((v) => ({ id: v.id, placa: v.placa, descricao: v.descricao }));
  const t = frota.total;
  const foco = sel ?? null;
  const alvo = foco ?? { ...t, km: t.km };
  const viagensFoco = foco ? foco.viagens.length : t.viagens;
  const pdf = `/api/frota/${empresaId}?mes=${mes}${rateioTexto ? `&rateio=${encodeURIComponent(rateioTexto)}` : ""}${sel ? `&veiculo=${sel.veiculo.id}` : ""}`;

  return (
    <>
      <CabecalhoPagina
        titulo="Rentabilidade da frota"
        descricao="Quanto cada caminhão deu de lucro de verdade no mês — com motorista, parcela, seguro e escritório na conta, e o km conferido."
        acoes={
          <>
            {podeLancar ? <NovaViagem empresaId={empresaId} veiculos={opcoes} veiculoPadrao={sel?.veiculo.id} hoje={hoje} /> : null}
            {podeLancar ? <NovaDespesa empresaId={empresaId} veiculos={opcoes} veiculoPadrao={sel?.veiculo.id} hoje={hoje} /> : null}
            <Button asChild variante="contorno">
              <Link href={`${base}/veiculos`}>
                <Truck /> Caminhões
              </Link>
            </Button>
            {dados.veiculos.length ? (
              <Button asChild variante="contorno">
                <a href={pdf}>
                  <Download /> Baixar PDF
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      {!dados.todos.length ? (
        <Card>
          <CardContent className="pt-5">
            <EstadoVazio
              icone={Truck}
              titulo="Nenhum caminhão cadastrado"
              descricao="Cadastre os caminhões com os custos fixos do mês (motorista, parcela, seguro) e lance as viagens e as despesas."
            />
            {podeLancar ? (
              <div className="mt-4 flex justify-center">
                <DialogoVeiculo empresaId={empresaId} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Mês, caminhão e rateio */}
          <Card>
            <CardContent className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <Button asChild variante="contorno" tamanho="iconeSm" aria-label="Mês anterior">
                  <Link href={link({ mes: deslocarMes(mes, -1) })}>
                    <ChevronLeft />
                  </Link>
                </Button>
                <p className="min-w-40 text-center font-titulo text-lg font-semibold text-titulo">{maiuscula(nomeDoMes(mes))}</p>
                <Button asChild variante="contorno" tamanho="iconeSm" aria-label="Próximo mês">
                  <Link href={link({ mes: deslocarMes(mes, 1) })}>
                    <ChevronRight />
                  </Link>
                </Button>
                {fator < 1 && fator > 0 ? <Badge variante="info">Mês em andamento</Badge> : null}
              </div>
              <form action={base} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="mes" value={mes} />
                {sel ? <input type="hidden" name="veiculo" value={sel.veiculo.id} /> : null}
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Despesas do escritório no mês (para dividir entre os caminhões)</span>
                  <Input name="rateio" defaultValue={rateioTexto} inputMode="decimal" placeholder="Ex.: 12.000,00" className="w-56" />
                </label>
                <Button type="submit" variante="contorno">
                  Aplicar
                </Button>
              </form>
            </CardContent>
            <CardContent className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Link
                href={link({ veiculo: null })}
                className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", !sel ? "border-primary bg-secondary text-primary" : "border-border hover:border-primary/40")}
              >
                Frota toda
              </Link>
              {frota.veiculos.map((r) => (
                <Link
                  key={r.veiculo.id}
                  href={link({ veiculo: r.veiculo.id })}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
                    sel?.veiculo.id === r.veiculo.id ? "border-primary bg-secondary text-primary" : "border-border hover:border-primary/40",
                  )}
                >
                  <span className={cn("size-2.5 rounded-full", SEMAFORO[r.semaforo].cor)} aria-hidden />
                  {placa(r.veiculo.placa)}
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* A frase do mês */}
          <Card className="overflow-hidden">
            <CardContent className="space-y-3 pt-5">
              {sel ? (
                <Link href={link({ veiculo: null })} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  <ArrowLeft className="size-4" /> Voltar para a frota toda
                </Link>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {sel ? <Badge variante={SEMAFORO[sel.semaforo].variante}>{SEMAFORO[sel.semaforo].texto}</Badge> : null}
                {sel ? <span className="text-sm text-muted-foreground">{sel.veiculo.descricao}</span> : null}
              </div>
              <p className="font-titulo text-xl font-semibold leading-snug text-titulo sm:text-2xl">
                {frase(alvo, sel ? `O caminhão ${placa(sel.veiculo.placa)}` : `Em ${nomeDoMes(mes)}, a frota`, viagensFoco)}
              </p>
              {alvo.faturamento > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sem contar o salário do motorista, a parcela, o seguro e o escritório — como fazem os relatórios comuns — pareceria um lucro de{" "}
                  <strong className="text-foreground">{formatarMoeda(alvo.sobraViagens)}</strong> ({pct(alvo.faturamento ? Math.round((alvo.sobraViagens / alvo.faturamento) * 1000) / 10 : null)}).
                  A diferença de <strong className="text-foreground">{formatarMoeda(alvo.sobraViagens - alvo.lucro)}</strong> é custo que esses relatórios não mostram.
                </p>
              ) : null}
              {fator < 1 && fator > 0 ? (
                <p className="text-xs text-muted-foreground">Mês em andamento: os custos fixos entram só pelos dias até hoje ({Math.round(fator * 100)}% do mês).</p>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Indicador rotulo="Faturamento (frete)" valor={formatarMoeda(alvo.faturamento)} icone={Wallet} detalhe={`${viagensFoco} viage${viagensFoco === 1 ? "m" : "ns"}`} />
            <Indicador
              rotulo="Lucro de verdade"
              valor={formatarMoeda(alvo.lucro)}
              tom={alvo.lucro >= 0 ? "sucesso" : "perigo"}
              icone={TrendingUp}
              detalhe={`${pct(alvo.margem)} do frete`}
            />
            <Indicador rotulo="Custo por km" valor={alvo.custoKm === null ? "—" : formatarMoeda(alvo.custoKm)} icone={Route} detalhe={alvo.receitaKm === null ? "Lance o km nos abastecimentos" : `Frete por km: ${formatarMoeda(alvo.receitaKm)}`} />
            <Indicador rotulo="Km rodado" valor={numero(alvo.km.rodado)} icone={Gauge} detalhe={`${numero(alvo.litros, 0)} litros de diesel`} />
            <Indicador
              rotulo="Média de consumo"
              valor={alvo.mediaKmL === null ? "—" : `${numero(alvo.mediaKmL, 2)} km/l`}
              icone={Fuel}
              tom={alvo.mediaKmL !== null && (alvo.mediaKmL < 1.2 || alvo.mediaKmL > 4.5) ? "alerta" : "neutro"}
            />
          </div>

          <CadaCem fatias={cadaCem(alvo)} />

          {!sel ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
                <GraficoRanking dados={frota.veiculos.map((r) => ({ placa: placa(r.veiculo.placa), lucro: r.lucro }))} />
                <Card>
                  <CardHeader>
                    <CardTitle>Caminhões do melhor para o pior</CardTitle>
                    <CardDescription>Clique num caminhão para ver as viagens, os abastecimentos e para onde foi o dinheiro.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {frota.veiculos.map((r, i) => (
                      <Link
                        key={r.veiculo.id}
                        href={link({ veiculo: r.veiculo.id })}
                        className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                      >
                        <span className="w-6 text-center font-titulo text-lg font-semibold text-muted-foreground">{i + 1}º</span>
                        <span className={cn("h-10 w-1.5 shrink-0 rounded-full", SEMAFORO[r.semaforo].cor)} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {placa(r.veiculo.placa)} <span className="font-normal text-muted-foreground">· {r.veiculo.descricao}</span>
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {r.viagens.length} viage{r.viagens.length === 1 ? "m" : "ns"} · {numero(r.km.rodado)} km · custo {r.custoKm === null ? "—" : formatarMoeda(r.custoKm)}/km
                            {r.alertas.length ? ` · ${r.alertas.length} alerta(s)` : ""}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className={cn("block numero font-semibold", r.lucro >= 0 ? "text-sucesso" : "text-perigo")}>{formatarMoeda(r.lucro)}</span>
                          <span className="block text-xs text-muted-foreground">{pct(r.margem)} do frete</span>
                        </span>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              </div>
              {frota.veiculos.some((r) => r.alertas.length) ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="size-5 text-alerta" /> O que merece atenção
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {frota.veiculos.flatMap((r) =>
                        r.alertas.map((a) => (
                          <li key={`${r.veiculo.id}-${a}`} className="flex gap-2">
                            <Link href={link({ veiculo: r.veiculo.id })} className="shrink-0 font-semibold text-primary hover:underline">
                              {placa(r.veiculo.placa)}
                            </Link>
                            <span>{a}</span>
                          </li>
                        )),
                      )}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : (
            <DetalheVeiculo r={sel} empresaId={empresaId} podeLancar={podeLancar} />
          )}
        </div>
      )}
    </>
  );
}

function DetalheVeiculo({ r, empresaId, podeLancar }: { r: ResultadoVeiculo; empresaId: string; podeLancar: boolean }) {
  const outrasDespesas = r.despesasVariaveis - r.porGrupo.combustivel - r.porGrupo.arla;
  const degraus = [
    { nome: "Frete", valor: r.faturamento, tipo: "inicio" as const },
    { nome: "Impostos", valor: r.deducoes.total, tipo: "saida" as const },
    { nome: "Motorista", valor: r.comissao + r.fixos.motorista, tipo: "saida" as const },
    { nome: "Combustível", valor: r.porGrupo.combustivel + r.porGrupo.arla, tipo: "saida" as const },
    { nome: "Caminhão", valor: outrasDespesas + r.fixos.total - r.fixos.motorista, tipo: "saida" as const },
    ...(r.rateio ? [{ nome: "Escritório", valor: r.rateio, tipo: "saida" as const }] : []),
    { nome: r.lucro >= 0 ? "Lucro" : "Prejuízo", valor: r.lucro, tipo: "fim" as const },
  ];
  const composicao = [
    ...Object.entries(r.porGrupo)
      .filter(([, v]) => v > 0)
      .map(([g, v]) => ({ nome: GRUPOS_DESPESA[g as keyof typeof GRUPOS_DESPESA], valor: v })),
    ...(r.comissao ? [{ nome: "Comissão do motorista", valor: r.comissao }] : []),
    ...(r.fixos.motorista ? [{ nome: "Salário e encargos do motorista", valor: r.fixos.motorista }] : []),
    ...(r.fixos.financiamento + r.fixos.depreciacao ? [{ nome: "Parcela e depreciação", valor: r.fixos.financiamento + r.fixos.depreciacao }] : []),
    ...(r.fixos.seguro + r.fixos.outros ? [{ nome: "Seguro, rastreador e IPVA", valor: r.fixos.seguro + r.fixos.outros }] : []),
  ].sort((a, b) => b.valor - a.valor);
  const consumo = r.despesas.filter((d) => d.media !== null).map((d) => ({ data: d.data, media: d.media! }));
  const linhas: { rotulo: string; valor: number; destaque?: boolean; ajuda?: string }[] = [
    { rotulo: "Frete das viagens", valor: r.faturamento, destaque: true },
    { rotulo: "(−) ICMS, quebra e descontos do frete", valor: -r.deducoes.total },
    { rotulo: "(−) Comissão do motorista", valor: -r.comissao },
    ...Object.entries(r.porGrupo)
      .filter(([, v]) => v > 0)
      .map(([g, v]) => ({ rotulo: `(−) ${GRUPOS_DESPESA[g as keyof typeof GRUPOS_DESPESA]}`, valor: -v })),
    { rotulo: "= Sobra das viagens", valor: r.sobraViagens, destaque: true, ajuda: "O que os relatórios comuns chamam de lucro." },
    { rotulo: "(−) Salário e encargos do motorista", valor: -r.fixos.motorista },
    { rotulo: "(−) Parcela do financiamento", valor: -r.fixos.financiamento },
    { rotulo: "(−) Depreciação", valor: -r.fixos.depreciacao },
    { rotulo: "(−) Seguro", valor: -r.fixos.seguro },
    { rotulo: "(−) Rastreador, IPVA e outros", valor: -r.fixos.outros },
    ...(r.rateio ? [{ rotulo: "(−) Despesas do escritório (rateio)", valor: -r.rateio }] : []),
    { rotulo: r.lucro >= 0 ? "= Lucro de verdade" : "= Prejuízo", valor: r.lucro, destaque: true },
  ].filter((l) => l.destaque || l.valor !== 0);

  return (
    <div className="space-y-5">
      {r.alertas.length ? (
        <Alerta tom="alerta" titulo="O que merece atenção neste caminhão">
          <ul className="list-disc pl-5">
            {r.alertas.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <GraficoCascata degraus={degraus} />
        <GraficoComposicao dados={composicao} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Resultado do mês, linha por linha</CardTitle>
            <CardDescription>Do frete ao lucro de verdade.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TBody>
                {linhas.map((l) => (
                  <Tr key={l.rotulo}>
                    <Td className={cn(l.destaque && "font-semibold")}>
                      {l.rotulo}
                      {l.ajuda ? <span className="block text-xs font-normal text-muted-foreground">{l.ajuda}</span> : null}
                    </Td>
                    <Td className={cn("whitespace-nowrap text-right numero", l.destaque && "font-semibold", l.destaque && l.valor < 0 && "text-perigo", l.rotulo.startsWith("= Lucro") && "text-sucesso")}>
                      {formatarMoeda(l.valor)}
                    </Td>
                    <Td className="w-16 text-right text-xs text-muted-foreground numero">{r.faturamento ? pct(Math.round((l.valor / r.faturamento) * 1000) / 10) : ""}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        {consumo.length >= 2 ? <GraficoConsumo pontos={consumo} minimo={1.2} maximo={4.5} /> : <Card><CardContent className="pt-5 text-sm text-muted-foreground">Lance o km do hodômetro nos abastecimentos para ver a média de consumo.</CardContent></Card>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Viagens do mês ({r.viagens.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {r.viagens.length ? (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Data</Th>
                    <Th>CT-e</Th>
                    <Th>Rota</Th>
                    <Th>Carga e motorista</Th>
                    <Th className="text-right">Frete</Th>
                    <Th className="text-right">Comissão</Th>
                    <Th className="text-right">ICMS e descontos</Th>
                    {podeLancar ? <Th /> : null}
                  </tr>
                </THead>
                <TBody>
                  {r.viagens.map((v) => (
                    <Tr key={v.id}>
                      <Td className="numero">{formatarData(v.data)}</Td>
                      <Td className="numero">{v.cte_numero ?? "—"}</Td>
                      <Td>
                        {v.origem ?? "—"} → {v.destino ?? "—"}
                        {v.remetente ? <span className="block text-xs text-muted-foreground">{v.remetente}</span> : null}
                      </Td>
                      <Td>
                        {v.mercadoria ?? "—"}
                        {v.peso_kg ? <span className="text-xs text-muted-foreground"> · {numero(Number(v.peso_kg) / 1000, 1)} t</span> : null}
                        {v.motorista ? <span className="block text-xs text-muted-foreground">{v.motorista}</span> : null}
                      </Td>
                      <Td className="whitespace-nowrap text-right numero font-medium">{formatarMoeda(v.valor_frete)}</Td>
                      <Td className="whitespace-nowrap text-right numero">{formatarMoeda(v.comissao_motorista)}</Td>
                      <Td className="whitespace-nowrap text-right numero">{formatarMoeda(Number(v.icms ?? 0) + Number(v.quebra ?? 0) + Number(v.outras_deducoes ?? 0))}</Td>
                      {podeLancar ? (
                        <Td className="text-right">
                          <ExcluirLancamento empresaId={empresaId} tipo="viagem" id={v.id} />
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma viagem lançada neste mês.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abastecimentos e despesas ({r.despesas.length})</CardTitle>
          <CardDescription>A média de cada abastecimento é o km rodado desde o anterior dividido pelos litros (tanque cheio).</CardDescription>
        </CardHeader>
        <CardContent>
          {r.despesas.length ? (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Despesa</Th>
                    <Th className="text-right">Litros</Th>
                    <Th className="text-right">Km</Th>
                    <Th className="text-right">Rodou</Th>
                    <Th className="text-right">Média</Th>
                    <Th className="text-right">Valor</Th>
                    {podeLancar ? <Th /> : null}
                  </tr>
                </THead>
                <TBody>
                  {r.despesas.map((d) => (
                    <Tr key={d.id} className={cn(d.alerta && "bg-alerta-bg/40")}>
                      <Td className="numero">{formatarData(d.data)}</Td>
                      <Td>
                        <Badge variante="neutro">{GRUPOS_DESPESA[d.grupo]}</Badge> {d.descricao}
                        {d.fornecedor ? <span className="block text-xs text-muted-foreground">{d.fornecedor}</span> : null}
                        {d.alerta ? <span className="block text-xs text-alerta">{d.alerta}</span> : null}
                      </Td>
                      <Td className="text-right numero">{d.litros ? numero(Number(d.litros), 1) : "—"}</Td>
                      <Td className="text-right numero">{d.km !== null && d.km !== undefined && d.km !== "" ? numero(Number(d.km)) : "—"}</Td>
                      <Td className="text-right numero">{d.rodado === null ? "—" : numero(d.rodado)}</Td>
                      <Td className={cn("text-right numero", d.alerta && "font-semibold text-alerta")}>{d.media === null ? "—" : `${numero(d.media, 2)}`}</Td>
                      <Td className="whitespace-nowrap text-right numero font-medium">{formatarMoeda(d.valor)}</Td>
                      {podeLancar ? (
                        <Td className="text-right">
                          <ExcluirLancamento empresaId={empresaId} tipo="despesa" id={d.id} />
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma despesa lançada neste mês.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
