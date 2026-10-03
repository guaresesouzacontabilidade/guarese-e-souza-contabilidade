import type { Metadata } from "next";
import Link from "next/link";
import Decimal from "decimal.js";
import { ExternalLink, Scale, Settings } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Campo, Input, Select } from "@/components/ui/form";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { compararRegimes, textoPercentual, TRIBUTOS_COMPARADOS, type ResultadoRegime, type TributoComparado } from "@/lib/calculos/comparativo";
import type { DadosPrevisao } from "@/lib/calculos/previsao";
import { competenciaDosCalculos } from "@/lib/calculos/competencias";
import { PRIMEIRA_COMPETENCIA } from "@/lib/calculos/tabelas";
import { carregarDre } from "@/lib/relatorios/dados";
import { competenciaAtual, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";
import { parametro } from "@/lib/busca";
import { SITUACAO_ALIQUOTA, textoAliquota, type SituacaoAliquota } from "@/lib/fiscal/icms-estados";

export const metadata: Metadata = { title: "Comparativo de regimes" };

/** Número digitado com vírgula ou ponto (ex.: "12,5"), dentro dos limites. */
function lerNumero(v: string, min: number, max: number): Decimal | null {
  const t = v.replace(/[\s%]/g, "").replace(",", ".");
  if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = new Decimal(t);
  return n.gte(min) && n.lte(max) ? n : null;
}

const textoNumero = (n: Decimal | null) => (n ? n.toString().replace(".", ",") : "");

function maiuscula(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "a, b e c" */
function juntar(itens: string[]) {
  return itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function Celula({ t }: { t: TributoComparado }) {
  if (t.situacao === "calculado") {
    return (
      <span className="numero" title={t.detalhe ?? undefined}>
        {formatarMoeda(t.valor)}
      </span>
    );
  }
  if (t.situacao === "no_das") return <span className="text-xs text-muted-foreground">no DAS</span>;
  if (t.situacao === "falta") return <Badge variante="alerta">falta premissa</Badge>;
  return <span className="text-muted-foreground">—</span>;
}

export default async function ComparativoRegimes({ params, searchParams }: PageProps<"/e/[empresaId]/calculos/comparativo">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.gerenciar")) return <Alerta tom="alerta">Somente a equipe do escritório usa o comparativo de regimes.</Alerta>;
  const base = `/e/${empresaId}`;

  const opcoes: { valor: string; rotulo: string }[] = [];
  for (let c = competenciaAtual(); c.slice(0, 7) >= PRIMEIRA_COMPETENCIA && opcoes.length < 36; c = somarMeses(c, -1)) {
    opcoes.push({ valor: c.slice(0, 7), rotulo: `${formatarCompetencia(somarMeses(c, -11))} a ${formatarCompetencia(c)} (12 meses)` });
  }
  const ate = competenciaDosCalculos(parametro(sp, "ate"));
  const margem = lerNumero(parametro(sp, "margem"), -100, 100);
  const aliquotaIcms = lerNumero(parametro(sp, "icms"), 0, 40);
  const aliquotaIss = lerNumero(parametro(sp, "iss"), 0, 5);
  const creditos = parametro(sp, "creditos", ["sim", "nao"]) !== "nao";
  const invalidos = [
    parametro(sp, "margem") && !margem ? "margem de lucro (entre −100 e 100)" : null,
    parametro(sp, "icms") && !aliquotaIcms ? "ICMS (entre 0 e 40)" : null,
    parametro(sp, "iss") && !aliquotaIss ? "ISS (entre 0 e 5)" : null,
  ].filter(Boolean);

  const cabecalho = (
    <CabecalhoPagina
      titulo="Comparativo de regimes"
      descricao="Quanto a empresa teria pago de tributos no Simples Nacional, no Lucro Presumido e no Lucro Real em 12 meses, com as notas, a receita e a folha do portal. É uma estimativa para apoiar o planejamento; a decisão depende da análise do escritório."
      acoes={
        <Button asChild variante="contorno">
          <Link href={`${base}/calculos/configuracao`}>
            <Settings /> Configuração
          </Link>
        </Button>
      }
    />
  );

  const { data, error } = await ctx.supabase.rpc("dados_previsao_impostos", { p_empresa_id: empresaId, p_competencia: ate, p_meses: 24 });
  if (error || !data) {
    return (
      <>
        {cabecalho}
        <Alerta tom="perigo">{mensagemErro(error)}</Alerta>
      </>
    );
  }
  const dados = data as unknown as DadosPrevisao;
  if (!dados.parametros) {
    return (
      <>
        {cabecalho}
        <EstadoVazio
          icone={Scale}
          titulo="Configure os cálculos desta empresa"
          descricao="O comparativo usa os anexos do Simples, os percentuais de presunção, a alíquota do ISS, o RAT/FAP e o pró-labore da configuração."
          acao={
            <Button asChild>
              <Link href={`${base}/calculos/configuracao`}>
                <Settings /> Configurar agora
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const c = compararRegimes(dados, ate, { margemLucro: margem, aliquotaIcms, aliquotaIss, creditosPisCofins: creditos });
  const fim = c.meses[c.meses.length - 1];

  // Referência: alíquota interna geral do estado da empresa (Obrigações > ICMS por estado)
  let referenciaIcms = "";
  if (c.aplicaIcms) {
    const { data: emp } = await ctx.supabase.from("empresas").select("uf").eq("id", empresaId).maybeSingle();
    const uf = emp?.uf?.trim().toUpperCase();
    if (uf) {
      const { data: est } = await ctx.supabase.from("icms_uf").select("aliquota_interna, fcp, aliquota_situacao").eq("uf", uf).maybeSingle();
      if (est?.aliquota_interna != null) {
        const situacao = SITUACAO_ALIQUOTA[est.aliquota_situacao as SituacaoAliquota]?.rotulo.toLowerCase() ?? "";
        referenciaIcms = ` Interna geral de ${uf}: ${textoAliquota(est.aliquota_interna)}${est.fcp ? ` + ${textoAliquota(est.fcp)} de fundo de pobreza` : ""} (${situacao}); a média efetiva costuma ser menor por causa de reduções e da substituição tributária.`;
      }
    }
  }

  // Sugestão de margem: resultado do Financeiro no mesmo período (quando a empresa usa o Financeiro)
  let margemFinanceiro: Decimal | null = null;
  if (ctx.pode("relatorios.ver") || ctx.pode("financeiro.ver")) {
    try {
      const dre = await carregarDre(ctx.supabase, empresaId, c.meses[0], ultimoDiaDoMes(fim));
      const receita = dec(dre.totais.receita_bruta?.total);
      if (receita.gt(0)) margemFinanceiro = dec(dre.totais.resultado_antes_impostos?.total).div(receita).times(100).toDecimalPlaces(1);
    } catch {
      margemFinanceiro = null;
    }
  }

  const porRegime = new Map(c.regimes.map((r) => [r.regime, r]));
  const melhor = c.melhor ? porRegime.get(c.melhor)! : null;
  const atual = c.regimes.find((r) => r.regime === c.regimeAtual) ?? null;
  const linhas = TRIBUTOS_COMPARADOS.filter(({ chave }) => c.regimes.some((r) => r.tributos[chave].situacao !== "nao_se_aplica"));
  const media = (r: ResultadoRegime) => formatarMoeda(r.total.div(12).toDecimalPlaces(2));
  const destaque = (r: ResultadoRegime) => (c.melhor === r.regime ? "border-sucesso ring-1 ring-sucesso/40" : "");
  // Incompletos que ainda podem sair mais baratos que o melhor (o que falta só aumenta o total)
  const pendentes = c.regimes.filter((r) => !r.impedimento && r.faltando.length > 0 && !r.jaMaisCaro);
  const urlMargem = (m: Decimal) => urlCom(`${base}/calculos/comparativo`, sp, { margem: m.toString().replace(".", ",") });

  return (
    <>
      {cabecalho}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Premissas</CardTitle>
          <CardDescription>O que as notas e o cadastro não informam. Sem uma premissa, o regime que depende dela fica incompleto e não entra na escolha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Período" htmlFor="cmp-ate">
              <Select id="cmp-ate" name="ate" defaultValue={ate.slice(0, 7)}>
                {opcoes.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Margem de lucro no Lucro Real (%)" htmlFor="cmp-margem" ajuda="Lucro antes do IRPJ e da CSLL, em % da receita (pode ser negativa).">
              <Input id="cmp-margem" name="margem" inputMode="decimal" defaultValue={textoNumero(margem)} placeholder="Ex.: 12,5" />
            </Campo>
            {c.aplicaIcms ? (
              <Campo
                rotulo="ICMS nas vendas, fora do Simples (%)"
                htmlFor="cmp-icms"
                ajuda={
                  (c.sugestaoIcms ? `Média do ICMS destacado nas notas: ${textoPercentual(c.sugestaoIcms)} (usada se ficar em branco).` : "Alíquota média sobre as vendas tributadas; os créditos vêm das notas de entrada.") +
                  referenciaIcms
                }
              >
                <Input id="cmp-icms" name="icms" inputMode="decimal" defaultValue={textoNumero(aliquotaIcms)} placeholder={c.sugestaoIcms ? textoNumero(c.sugestaoIcms) : ""} />
              </Campo>
            ) : null}
            {c.aplicaIss ? (
              <Campo
                rotulo="ISS do município (%)"
                htmlFor="cmp-iss"
                ajuda={dados.parametros.aliquota_iss != null ? `Configuração: ${textoPercentual(dec(dados.parametros.aliquota_iss))} (usada se ficar em branco).` : "Entre 2% e 5%, conforme o município e o serviço."}
              >
                <Input
                  id="cmp-iss"
                  name="iss"
                  inputMode="decimal"
                  defaultValue={textoNumero(aliquotaIss)}
                  placeholder={dados.parametros.aliquota_iss != null ? textoNumero(dec(dados.parametros.aliquota_iss)) : ""}
                />
              </Campo>
            ) : null}
            <Campo rotulo="Créditos de PIS/Cofins no Lucro Real" htmlFor="cmp-creditos" ajuda="Sobre as compras das notas de entrada.">
              <Select id="cmp-creditos" name="creditos" defaultValue={creditos ? "sim" : "nao"}>
                <option value="sim">Sim, sobre as compras</option>
                <option value="nao">Não considerar</option>
              </Select>
            </Campo>
            <div className="flex items-end sm:pt-6">
              <Button type="submit">Recalcular</Button>
            </div>
          </form>
          {margemFinanceiro && !margem ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No Financeiro, o resultado antes do IRPJ e da CSLL no período foi de {textoPercentual(margemFinanceiro, 1)} da receita (com os tributos do regime atual).{" "}
              <Link href={urlMargem(margemFinanceiro)} className="font-medium text-primary hover:underline">
                Usar como margem
              </Link>
            </p>
          ) : null}
          {invalidos.length ? (
            <Alerta tom="alerta" className="mt-3">
              Valor fora do esperado, desconsiderado: {invalidos.join("; ")}.
            </Alerta>
          ) : null}
        </CardContent>
      </Card>

      {c.receita.total.isZero() ? (
        <EstadoVazio
          icone={Scale}
          titulo="Sem receita no período"
          descricao="Envie as notas fiscais de saída ou informe a receita de cada mês em Cálculos → Configuração para comparar os regimes."
          acao={
            <Button asChild variante="contorno">
              <Link href={`${base}/calculos/configuracao?competencia=${fim.slice(0, 7)}`}>Informar a receita</Link>
            </Button>
          }
        />
      ) : (
        <>
          {melhor && c.economia && c.economia.gt(0) && atual ? (
            <Alerta tom="sucesso" className="mb-4" titulo={`${melhor.rotulo}: economia estimada de ${formatarMoeda(c.economia)} em 12 meses`}>
              Em relação ao regime atual ({atual.rotulo}), cerca de {formatarMoeda(c.economia.div(12).toDecimalPlaces(2))} por mês. Antes de mudar, confira as premissas e
              os avisos abaixo.
              {pendentes.length ? ` Ainda falta comparar com ${juntar(pendentes.map((r) => `o ${r.rotulo}`))} (complete as premissas).` : ""}
            </Alerta>
          ) : melhor && atual && melhor.regime === atual.regime ? (
            <Alerta
              tom="info"
              className="mb-4"
              titulo={pendentes.length ? `O regime atual (${atual.rotulo}) é o de menor custo entre os que já dá para comparar` : `O regime atual (${atual.rotulo}) é o de menor custo estimado`}
            >
              {pendentes.length
                ? `Para comparar também com ${juntar(pendentes.map((r) => `o ${r.rotulo}`))}, informe ${juntar([...new Set(pendentes.flatMap((r) => r.faltando))])} em Premissas.`
                : "Com as premissas informadas, nenhum outro regime sairia mais barato no período."}
            </Alerta>
          ) : melhor ? (
            <Alerta tom="info" className="mb-4" titulo={`Menor custo estimado: ${melhor.rotulo}`}>
              Regime atual: {c.regimeAtualRotulo}.{atual?.impedimento ? ` ${atual.impedimento}` : ""}
              {atual && atual.faltando.length && !atual.jaMaisCaro ? ` Para comparar com ele, falta informar ${juntar(atual.faltando)}.` : ""}
              {pendentes.some((r) => r.regime !== atual?.regime)
                ? ` Ainda falta comparar com ${juntar(pendentes.filter((r) => r.regime !== atual?.regime).map((r) => `o ${r.rotulo}`))}.`
                : ""}
            </Alerta>
          ) : (
            <Alerta tom="alerta" className="mb-4" titulo="Complete as premissas para comparar">
              Nenhum regime tem todas as informações necessárias.
            </Alerta>
          )}
          {c.regimeAtual === "mei" ? (
            <Alerta tom="info" className="mb-4">
              A empresa é MEI: o comparativo mostra quanto ela pagaria em cada regime se saísse do MEI (por exemplo, ao passar do limite de faturamento).
            </Alerta>
          ) : null}

          <div className="mb-4 grid gap-3 md:grid-cols-3 [&>*]:min-w-0">
            {c.regimes.map((r) => (
              <Card key={r.regime} className={destaque(r)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{r.rotulo}</CardTitle>
                  <div className="flex flex-wrap gap-1">
                    {r.regime === c.regimeAtual ? <Badge variante="primario">Regime atual</Badge> : null}
                    {r.regime === c.melhor ? <Badge variante="sucesso">Menor custo estimado</Badge> : null}
                    {r.impedimento ? <Badge variante="perigo">Não pode optar</Badge> : null}
                    {r.faltando.length ? <Badge variante="alerta">Incompleto</Badge> : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  {r.faltando.length ? <p className="text-xs text-muted-foreground">Pelo menos</p> : null}
                  <p className="numero text-2xl font-bold text-titulo">{formatarMoeda(r.total)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.carga ? `${textoPercentual(r.carga.times(100), 1)} da receita · ` : ""}média de {media(r)} por mês
                  </p>
                  {r.impedimento ? <p className="text-sm text-perigo">{r.impedimento}</p> : null}
                  {r.faltando.length ? (
                    <p className="text-sm text-alerta-fg">
                      Falta informar {juntar(r.faltando)} (em Premissas).
                      {r.jaMaisCaro && melhor ? ` Mesmo sem isso, já custaria ${formatarMoeda(r.total.minus(melhor.total))} a mais que o ${melhor.rotulo}.` : ""}
                    </p>
                  ) : null}
                  {melhor && r.regime !== melhor.regime && !r.impedimento && !r.faltando.length ? (
                    <p className="text-xs text-muted-foreground">
                      {formatarMoeda(r.total.minus(melhor.total))} a mais que o {melhor.rotulo}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Tributos por regime</CardTitle>
              <CardDescription>
                Receita de {formatarMoeda(c.receita.total)} de {formatarCompetencia(c.meses[0])} a {formatarCompetencia(fim)}. O cálculo de cada valor está logo abaixo da
                tabela.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Tributo</Th>
                    {c.regimes.map((r) => (
                      <Th key={r.regime} className="text-right">
                        {r.rotulo}
                      </Th>
                    ))}
                  </Tr>
                </THead>
                <TBody>
                  {linhas.map(({ chave, rotulo }) => (
                    <Tr key={chave}>
                      <Td className="text-sm">{rotulo}</Td>
                      {c.regimes.map((r) => (
                        <Td key={r.regime} className="text-right">
                          <Celula t={r.tributos[chave]} />
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </TBody>
                <TFoot>
                  <Tr>
                    <Td className="font-semibold">Total</Td>
                    {c.regimes.map((r) => (
                      <Td key={r.regime} className="numero text-right font-bold text-titulo">
                        {formatarMoeda(r.total)}
                        {r.faltando.length ? <span className="block text-xs font-normal text-alerta-fg">parcial</span> : null}
                      </Td>
                    ))}
                  </Tr>
                  <Tr>
                    <Td className="text-xs text-muted-foreground">% da receita</Td>
                    {c.regimes.map((r) => (
                      <Td key={r.regime} className="numero text-right text-xs text-muted-foreground">
                        {r.carga ? textoPercentual(r.carga.times(100), 1) : "—"}
                      </Td>
                    ))}
                  </Tr>
                </TFoot>
              </Table>
              <details className="mt-3 px-4 sm:px-6">
                <summary className="cursor-pointer text-sm font-medium text-primary">Como cada valor foi calculado</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  {c.regimes.map((r) => (
                    <div key={r.regime}>
                      <p className="text-sm font-medium">{r.rotulo}</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                        {linhas
                          .filter(({ chave }) => r.tributos[chave].detalhe)
                          .map(({ chave, rotulo }) => (
                            <li key={chave}>
                              {rotulo}: {r.tributos[chave].detalhe}
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Mês a mês</CardTitle>
              <CardDescription>IRPJ e CSLL trimestrais ou anuais distribuídos pelos meses conforme a receita.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Mês</Th>
                    <Th className="text-right">Receita</Th>
                    {c.regimes.map((r) => (
                      <Th key={r.regime} className="hidden text-right sm:table-cell">
                        {r.rotulo}
                      </Th>
                    ))}
                  </Tr>
                </THead>
                <TBody>
                  {c.meses.map((m, i) => (
                    <Tr key={m}>
                      <Td className="text-sm">
                        {maiuscula(formatarCompetencia(m, true))}
                        {c.receita.mesesSemDados.includes(m) ? <span className="block text-xs text-alerta-fg">sem notas nem receita informada</span> : null}
                        <span className="block text-xs text-muted-foreground sm:hidden">
                          {c.regimes.map((r) => `${r.rotulo}: ${formatarMoeda(r.porMes[i])}`).join(" · ")}
                        </span>
                      </Td>
                      <Td className="numero text-right">{formatarMoeda(c.receita.porMes[i])}</Td>
                      {c.regimes.map((r) => (
                        <Td key={r.regime} className="numero hidden text-right sm:table-cell">
                          {formatarMoeda(r.porMes[i])}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle>Dados e premissas usados</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {c.memoria.map((m) => (
                    <div key={m.rotulo}>
                      <dt className="font-medium">{m.rotulo}</dt>
                      <dd className="text-muted-foreground">{m.valor}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Avisos e fontes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  {c.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <ul className="space-y-1 text-sm">
                  {c.fontes.map((f) => (
                    <li key={f.titulo}>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {f.titulo} <ExternalLink className="inline size-3" aria-hidden />
                        </a>
                      ) : (
                        f.titulo
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
