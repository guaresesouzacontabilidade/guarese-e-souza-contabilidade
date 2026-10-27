import { NextResponse, type NextRequest } from "next/server";
import type { Content, TableCell } from "pdfmake/interfaces";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { hojeISO } from "@/lib/competencia";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { formatarData, nomeMes } from "@/lib/formatos";
import { carregarFrota, mesMaisRecente } from "@/lib/frota/dados";
import { cadaCem, calcularFrota, fatorDoMes, GRUPOS_DESPESA, type ResultadoVeiculo } from "@/lib/frota/rentabilidade";
import { montarCabecalho, nomeArquivo } from "@/lib/relatorios/cabecalho";
import { COR, gerarPdf } from "@/lib/relatorios/pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placa = (p: string) => `${p.slice(0, 3)}-${p.slice(3)}`;
const num = (v: number | null | undefined, casas = 0) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const moeda = (v: number | string | null | undefined) => formatarMoeda(v ?? 0);

function tabela(cab: string[], linhas: TableCell[][], widths: (string | number)[], direita: number[] = []): Content {
  const alinhar = (c: TableCell, i: number): TableCell => (typeof c === "string" ? { text: c, alignment: direita.includes(i) ? "right" : "left" } : c);
  return {
    table: {
      headerRows: 1,
      widths,
      body: [cab.map((t, i) => ({ text: t, style: "cabecalhoTabela", alignment: direita.includes(i) ? "right" : "left" })), ...linhas.map((l) => l.map(alinhar))],
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => COR.begeForte,
      paddingTop: () => 3,
      paddingBottom: () => 3,
      fillColor: (i: number) => (i > 0 && i % 2 === 0 ? "#faf6f1" : null),
    },
    fontSize: 7.5,
    margin: [0, 0, 0, 8],
  };
}

function frase(r: Pick<ResultadoVeiculo, "faturamento" | "lucro" | "margem" | "km">, quem: string, viagens: number) {
  if (r.faturamento === 0) return `${quem} não teve frete no mês — só os custos fixos (${moeda(-r.lucro)}).`;
  const resultado = r.lucro >= 0 ? `deu lucro de verdade de ${moeda(r.lucro)}` : `deu prejuízo de ${moeda(-r.lucro)}`;
  return `${quem} fez ${viagens} viage${viagens === 1 ? "m" : "ns"}${r.km.rodado ? `, rodou ${num(r.km.rodado)} km` : ""}, faturou ${moeda(r.faturamento)} e ${resultado} (${pct(r.margem)} do frete).`;
}

function resultadoLinhas(r: ResultadoVeiculo): TableCell[][] {
  const linhas: [string, number, boolean][] = [
    ["Frete das viagens", r.faturamento, true],
    ["(−) ICMS, quebra e descontos do frete", -r.deducoes.total, false],
    ["(−) Comissão do motorista", -r.comissao, false],
    ...Object.entries(r.porGrupo)
      .filter(([, v]) => v > 0)
      .map(([g, v]) => [`(−) ${GRUPOS_DESPESA[g as keyof typeof GRUPOS_DESPESA]}`, -v, false] as [string, number, boolean]),
    ["= Sobra das viagens (o \"lucro\" dos relatórios comuns)", r.sobraViagens, true],
    ["(−) Salário e encargos do motorista", -r.fixos.motorista, false],
    ["(−) Parcela do financiamento", -r.fixos.financiamento, false],
    ["(−) Depreciação", -r.fixos.depreciacao, false],
    ["(−) Seguro", -r.fixos.seguro, false],
    ["(−) Rastreador, IPVA e outros", -r.fixos.outros, false],
    ["(−) Despesas do escritório (rateio)", -r.rateio, false],
    [r.lucro >= 0 ? "= Lucro de verdade" : "= Prejuízo", r.lucro, true],
  ];
  return linhas
    .filter(([, v, d]) => d || v !== 0)
    .map(([rotulo, v, d]) => [
      { text: rotulo, bold: d },
      { text: moeda(v), bold: d, alignment: "right", color: d && rotulo.startsWith("= ") && rotulo !== "= Sobra das viagens (o \"lucro\" dos relatórios comuns)" ? (v >= 0 ? COR.verde : COR.vermelho) : undefined },
      { text: r.faturamento ? pct(Math.round((v / r.faturamento) * 1000) / 10) : "", alignment: "right", color: COR.cinza },
    ]);
}

function blocoVeiculo(r: ResultadoVeiculo, primeiro: boolean): Content[] {
  const blocos: Content[] = [
    { text: `Caminhão ${placa(r.veiculo.placa)} — ${r.veiculo.descricao}`, style: "secao", ...(primeiro ? {} : { pageBreak: "before" as const }) },
    { text: frase(r, `O caminhão ${placa(r.veiculo.placa)}`, r.viagens.length), bold: true, fontSize: 10, color: r.lucro >= 0 ? COR.marrom : COR.vermelho, margin: [0, 0, 0, 6] },
    tabela(
      ["Km rodado", "Média", "Custo por km", "Frete por km", "Lucro por km"],
      [[num(r.km.rodado), r.mediaKmL === null ? "—" : `${num(r.mediaKmL, 2)} km/l`, r.custoKm === null ? "—" : moeda(r.custoKm), r.receitaKm === null ? "—" : moeda(r.receitaKm), r.lucroKm === null ? "—" : moeda(r.lucroKm)]],
      ["*", "*", "*", "*", "*"],
      [0, 1, 2, 3, 4],
    ),
    { text: "Resultado do mês, linha por linha", bold: true, color: COR.marrom, margin: [0, 2, 0, 3] },
    tabela(["Linha", "Valor", "% do frete"], resultadoLinhas(r), ["*", 90, 55], [1, 2]),
  ];
  if (r.alertas.length) {
    blocos.push({ text: "O que merece atenção", bold: true, color: COR.amarelo, margin: [0, 2, 0, 2] }, { ul: r.alertas, fontSize: 8, margin: [0, 0, 0, 6] });
  }
  if (r.viagens.length) {
    blocos.push(
      { text: `Viagens (${r.viagens.length})`, bold: true, color: COR.marrom, margin: [0, 2, 0, 3] },
      tabela(
        ["Data", "CT-e", "Rota", "Carga / motorista", "Frete", "Comissão", "Descontos"],
        r.viagens.map((v) => [
          formatarData(v.data),
          v.cte_numero ?? "—",
          `${v.origem ?? "—"} → ${v.destino ?? "—"}`,
          `${v.mercadoria ?? "—"}${v.motorista ? `\n${v.motorista}` : ""}`,
          moeda(v.valor_frete),
          moeda(v.comissao_motorista),
          moeda(Number(v.icms ?? 0) + Number(v.quebra ?? 0) + Number(v.outras_deducoes ?? 0)),
        ]),
        [44, 30, "*", 100, 56, 50, 48],
        [4, 5, 6],
      ),
    );
  }
  if (r.despesas.length) {
    blocos.push(
      { text: `Abastecimentos e despesas (${r.despesas.length})`, bold: true, color: COR.marrom, margin: [0, 2, 0, 3] },
      tabela(
        ["Data", "Despesa", "Litros", "Km", "Rodou", "Média", "Valor"],
        r.despesas.map((d) => {
          const cor = d.alerta ? COR.vermelho : undefined;
          return [
            formatarData(d.data),
            { text: `${GRUPOS_DESPESA[d.grupo]} — ${d.descricao}${d.fornecedor ? `\n${d.fornecedor}` : ""}${d.alerta ? `\n${d.alerta}` : ""}`, color: cor },
            d.litros ? num(Number(d.litros), 1) : "—",
            d.km !== null && d.km !== undefined && d.km !== "" ? num(Number(d.km)) : "—",
            d.rodado === null ? "—" : num(d.rodado),
            { text: d.media === null ? "—" : num(d.media, 2), alignment: "right", color: cor, bold: Boolean(d.alerta) },
            moeda(d.valor),
          ];
        }),
        [44, "*", 40, 48, 38, 34, 56],
        [2, 3, 4, 5, 6],
      ),
    );
  }
  return blocos;
}

/** Relatório de rentabilidade da frota em PDF (logo do escritório e da empresa). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId } = await params;
  if (!UUID.test(empresaId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("financeiro.ver")) return new NextResponse("Acesso negado.", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const hoje = hojeISO();
  const mes = /^\d{4}-\d{2}$/.test(sp.get("mes") ?? "") ? sp.get("mes")! : await mesMaisRecente(s.supabase, empresaId, hoje);
  const rateioTotal = Math.max(Number(lerValorBR(sp.get("rateio") ?? "")?.toString() ?? 0), 0);
  const veiculoId = UUID.test(sp.get("veiculo") ?? "") ? sp.get("veiculo") : null;

  try {
    const dados = await carregarFrota(s.supabase, empresaId, mes);
    const fator = fatorDoMes(mes, hoje);
    const frota = calcularFrota(dados.veiculos, dados.viagens, dados.despesas, { kmAntes: dados.kmAntes, fatorFixos: fator, rateioTotal });
    const nomeDoMes = `${nomeMes(Number(mes.slice(5, 7)))} de ${mes.slice(0, 4)}`;
    const t = frota.total;
    const selecionados = veiculoId ? frota.veiculos.filter((v) => v.veiculo.id === veiculoId) : frota.veiculos;
    const blocos: Content[] = [];
    if (!veiculoId) {
      blocos.push(
        { text: frase(t, `Em ${nomeDoMes.toLowerCase()}, a frota`, t.viagens), bold: true, fontSize: 11, color: t.lucro >= 0 ? COR.marrom : COR.vermelho, margin: [0, 2, 0, 4] },
        t.faturamento > 0
          ? {
              text: `Sem contar o salário do motorista, a parcela, o seguro e o escritório — como fazem os relatórios comuns — pareceria um lucro de ${moeda(t.sobraViagens)}. A diferença de ${moeda(t.sobraViagens - t.lucro)} é custo que esses relatórios não mostram.`,
              fontSize: 8.5,
              color: COR.cinza,
              margin: [0, 0, 0, 8],
            }
          : { text: "" },
        { text: "Resumo por caminhão (do melhor para o pior)", style: "secao" },
        tabela(
          ["Caminhão", "Viagens", "Km", "Frete", "Sobra das viagens", "Custos fixos", "Lucro de verdade", "% do frete", "Custo/km"],
          [
            ...frota.veiculos.map((r): TableCell[] => [
              { text: `${placa(r.veiculo.placa)}\n${r.veiculo.descricao}`, fontSize: 7 },
              String(r.viagens.length),
              num(r.km.rodado),
              moeda(r.faturamento),
              moeda(r.sobraViagens),
              moeda(r.fixos.total + r.rateio),
              { text: moeda(r.lucro), bold: true, alignment: "right", color: r.lucro >= 0 ? COR.verde : COR.vermelho },
              pct(r.margem),
              r.custoKm === null ? "—" : moeda(r.custoKm),
            ]),
            [
              { text: "Frota toda", bold: true },
              { text: String(t.viagens), bold: true, alignment: "right" },
              { text: num(t.km.rodado), bold: true, alignment: "right" },
              { text: moeda(t.faturamento), bold: true, alignment: "right" },
              { text: moeda(t.sobraViagens), bold: true, alignment: "right" },
              { text: moeda(t.fixos.total + t.rateio), bold: true, alignment: "right" },
              { text: moeda(t.lucro), bold: true, alignment: "right", color: t.lucro >= 0 ? COR.verde : COR.vermelho },
              { text: pct(t.margem), bold: true, alignment: "right" },
              { text: t.custoKm === null ? "—" : moeda(t.custoKm), bold: true, alignment: "right" },
            ],
          ],
          ["*", 34, 40, 58, 58, 52, 60, 38, 40],
          [1, 2, 3, 4, 5, 6, 7, 8],
        ),
        { text: "De cada R$ 100 de frete, para onde foi o dinheiro", style: "secao" },
        tabela(
          ["Parte", "De cada R$ 100"],
          cadaCem(t).map((f) => [f.rotulo, { text: `R$ ${num(f.valor, 2)}`, alignment: "right", bold: f.chave === "lucro", color: f.chave === "lucro" ? (f.valor >= 0 ? COR.verde : COR.vermelho) : undefined }]),
          ["*", 90],
          [1],
        ),
      );
      const alertas = frota.veiculos.flatMap((r) => r.alertas.map((a) => `${placa(r.veiculo.placa)}: ${a}`));
      if (alertas.length) blocos.push({ text: "O que merece atenção", style: "secao" }, { ul: alertas, fontSize: 8.5 });
    }
    selecionados.forEach((r, i) => blocos.push(...blocoVeiculo(r, Boolean(veiculoId) && i === 0)));

    const cab = await montarCabecalho(s.supabase, empresaId, {
      titulo: veiculoId && selecionados[0] ? `Rentabilidade do caminhão ${placa(selecionados[0].veiculo.placa)}` : "Rentabilidade da frota",
      subtitulo: `${nomeDoMes.charAt(0).toUpperCase()}${nomeDoMes.slice(1)}${fator > 0 && fator < 1 ? ` — mês em andamento (até ${formatarData(hoje)})` : ""}${rateioTotal ? ` — com ${moeda(rateioTotal)} de despesas do escritório rateadas` : ""}`,
      situacao: "preliminar",
      observacao:
        "Lucro de verdade = frete − ICMS, quebra e descontos − comissão − despesas do caminhão − custos fixos do mês (motorista, parcela, depreciação, seguro, outros) − rateio do escritório. Km pelo hodômetro dos abastecimentos; média pelo tanque cheio.",
    });
    const arquivo = await gerarPdf(cab, blocos);
    const nome = nomeArquivo(["rentabilidade-frota", acesso.nome_fantasia || acesso.razao_social, mes], "pdf");
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o PDF da frota", e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
