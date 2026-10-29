import "server-only";
import type ExcelJS from "exceljs";
import type { Content, TableCell } from "pdfmake/interfaces";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { logosDaEmpresa } from "@/lib/marca/logos-relatorio";
import { montarCabecalho, nomeArquivo } from "@/lib/relatorios/cabecalho";
import { bufferPlanilha, cabecalhoPlanilha, novaPasta, type InfoPlanilha } from "@/lib/relatorios/excel";
import { COR, gerarPdf } from "@/lib/relatorios/pdf";
import { GUIAS_CORRECAO, comoSaiu, formatarNcm, sugestaoProduto, type ProdutoCorrecao } from "./correcoes";
import type { Referencia } from "./regras";
import { CONFIANCA, ROTULO_REGRA } from "./rotulos";

type Cliente = ContextoEmpresa["supabase"];

export interface AchadoRelatorio {
  id: string;
  regra: string;
  competencia: string;
  tipo: "oportunidade" | "risco" | "informativo";
  confianca: string;
  titulo: string;
  resumo: string;
  texto_cliente: string | null;
  valor_estimado: number | string | null;
  situacao: string;
  referencias: Referencia[];
  fontes: { titulo: string; url?: string | null }[];
  produtos: ProdutoCorrecao[];
}

export interface DadosRelatorioCorrecoes {
  achados: AchadoRelatorio[];
  economia: number;
  produtos: number;
  notas: number;
  periodo: string;
}

const ORDEM_TIPO = { oportunidade: 0, risco: 1, informativo: 2 } as const;
const ROTULO_TIPO = { oportunidade: "Possível economia", risco: "Risco a corrigir", informativo: "Para conhecimento" } as const;
const moeda = (v: number | string | null | undefined) => formatarMoeda(v ?? 0);
const nomeNota = (modelo: string) => (modelo === "65" ? "NFC-e" : modelo.startsWith("nfse") ? "NFS-e" : "NF-e");

/** Achados escolhidos (da empresa, não descartados) com os produtos e notas de cada um. */
export async function carregarRelatorioCorrecoes(supabase: Cliente, empresaId: string, ids: string[]): Promise<DadosRelatorioCorrecoes> {
  const [{ data, error }, { data: itens, error: erroItens }] = await Promise.all([
    supabase
      .from("auditor_achados")
      .select("id, regra, competencia, tipo, confianca, titulo, resumo, texto_cliente, valor_estimado, situacao, referencias, fontes")
      .eq("empresa_id", empresaId)
      .in("id", ids)
      .neq("situacao", "descartado"),
    supabase.rpc("auditor_relatorio_itens", { p_empresa_id: empresaId, p_ids: ids }),
  ]);
  if (error || erroItens) throw new Error(error?.message ?? erroItens?.message ?? "Falha ao carregar os achados.");
  const porAchado = new Map(((itens ?? []) as unknown as { id: string; produtos: ProdutoCorrecao[] }[]).map((x) => [x.id, x.produtos ?? []]));
  const lidos = (data ?? []).map((a) => ({ ...(a as unknown as Omit<AchadoRelatorio, "produtos">), produtos: porAchado.get(a.id) ?? [] }));
  // Pontos do mesmo tipo juntos (mês mais recente primeiro), começando pelos de maior economia
  const totalRegra = new Map<string, number>();
  for (const a of lidos) totalRegra.set(a.regra, (totalRegra.get(a.regra) ?? 0) + Number(a.valor_estimado ?? 0));
  const achados = lidos.sort(
    (a, b) =>
      ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo] ||
      totalRegra.get(b.regra)! - totalRegra.get(a.regra)! ||
      a.regra.localeCompare(b.regra) ||
      b.competencia.localeCompare(a.competencia),
  );
  const chavesProduto = new Set<string>();
  const notas = new Set<string>();
  for (const a of achados) {
    for (const p of a.produtos) {
      chavesProduto.add(`${p.codigo ?? ""}|${p.descricao ?? ""}|${p.ncm ?? ""}`);
      for (const n of p.lista) notas.add(`${n.modelo}|${n.numero}|${n.data}`);
    }
    if (!a.produtos.length) for (const r of a.referencias) notas.add(`${r.modelo}|${r.numero}|${r.data}`);
  }
  const meses = achados.map((a) => a.competencia).sort();
  const periodo = meses.length
    ? meses[0] === meses[meses.length - 1]
      ? formatarCompetencia(meses[0], true)
      : `${formatarCompetencia(meses[0], true)} a ${formatarCompetencia(meses[meses.length - 1], true)}`
    : "";
  return {
    achados,
    economia: achados.filter((a) => a.tipo === "oportunidade").reduce((t, a) => t + Number(a.valor_estimado ?? 0), 0),
    produtos: chavesProduto.size,
    notas: notas.size,
    periodo,
  };
}

function tabela(cab: string[], linhas: TableCell[][], widths: (string | number)[], direita: number[] = []): Content {
  const alinhar = (c: TableCell, i: number): TableCell => (typeof c === "string" ? { text: c, alignment: direita.includes(i) ? "right" : "left" } : c);
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
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
    margin: [0, 2, 0, 8],
  };
}

/** Rótulo junto da tabela: tabela curta não se separa do rótulo; a longa segue na página seguinte com o cabeçalho repetido. */
function comRotulo(rotulo: string, conteudo: Content, linhas: number): Content {
  return { stack: [{ text: rotulo, bold: true, color: COR.marrom, margin: [0, 2, 0, 0] }, conteudo], unbreakable: linhas <= 12 };
}

function listaNotas(p: ProdutoCorrecao): string {
  const texto = p.lista.map((n) => `${n.numero ?? "s/nº"}${n.data ? ` (${formatarData(n.data)})` : ""}`).join(", ");
  return p.notas > p.lista.length ? `${texto} e mais ${p.notas - p.lista.length}` : texto;
}

/** Conteúdo do PDF: resumo, recado do escritório e, por achado, explicação, como corrigir, produtos e notas. */
export function blocosRelatorioCorrecoes(d: DadosRelatorioCorrecoes, recado: string | null): Content[] {
  const blocos: Content[] = [
    {
      table: {
        widths: ["*", "*", "*", "*"],
        body: [
          [
            { text: "Possível economia", color: COR.cinza, fontSize: 8 },
            { text: "Pontos analisados", color: COR.cinza, fontSize: 8 },
            { text: "Produtos para corrigir", color: COR.cinza, fontSize: 8 },
            { text: "Notas envolvidas", color: COR.cinza, fontSize: 8 },
          ],
          [
            { text: moeda(d.economia), bold: true, fontSize: 13, color: COR.verde },
            { text: String(d.achados.length), bold: true, fontSize: 13, color: COR.marrom },
            { text: String(d.produtos), bold: true, fontSize: 13, color: COR.marrom },
            { text: String(d.notas), bold: true, fontSize: 13, color: COR.marrom },
          ],
        ],
      },
      layout: "noBorders",
      margin: [0, 4, 0, 6],
    },
    {
      text:
        "Este relatório mostra o que encontramos nas notas fiscais da empresa, por que vale corrigir e como fazer. Em cada ponto há a lista de produtos com o código " +
        "fiscal que deve ser usado nas próximas notas (coluna \"Corrigir para\") e as notas em que o problema apareceu. A planilha que acompanha o relatório traz a " +
        "mesma lista para ajustar o cadastro no sistema de vendas.",
      margin: [0, 0, 0, 4],
    },
  ];
  if (recado?.trim()) {
    blocos.push({ text: "Recado do escritório", style: "secao" }, ...recado.trim().split(/\n{2,}/).map((p) => ({ text: p.trim(), margin: [0, 0, 0, 4] }) as Content));
  }

  d.achados.forEach((a, i) => {
    const guia = GUIAS_CORRECAO[a.regra];
    blocos.push({
      unbreakable: true,
      stack: [
        { text: `${i + 1}. ${a.titulo}`, style: "secao" },
        {
          text: [
            { text: ROTULO_TIPO[a.tipo], bold: true, color: a.tipo === "oportunidade" ? COR.verde : a.tipo === "risco" ? COR.amarelo : COR.cinza },
            ` · ${formatarCompetencia(a.competencia, true)} · ${ROTULO_REGRA[a.regra] ?? a.regra} · ${CONFIANCA[a.confianca]?.rotulo ?? a.confianca}`,
          ],
          fontSize: 8,
          margin: [0, -2, 0, 6],
        },
        { text: "O que encontramos", bold: true, color: COR.marrom, margin: [0, 0, 0, 2] },
        { text: (a.texto_cliente?.trim() || a.resumo).trim(), margin: [0, 0, 0, 6] },
      ],
    });
    if (a.tipo === "oportunidade" && Number(a.valor_estimado ?? 0) > 0) {
      blocos.push({ text: [{ text: "Possível economia: ", bold: true }, { text: moeda(a.valor_estimado), bold: true, color: COR.verde }], margin: [0, 0, 0, 6] });
    }
    if (guia?.passos.length) {
      blocos.push({
        unbreakable: true,
        stack: [{ text: "Como corrigir", bold: true, color: COR.marrom, margin: [0, 0, 0, 2] }, { ol: guia.passos.map((p) => ({ text: p, margin: [0, 0, 0, 2] })), margin: [0, 0, 0, 6] }],
      });
    }
    if (a.produtos.length) {
      blocos.push(
        comRotulo(
          a.produtos[0].operacao === "entrada" ? "Produtos comprados" : "Produtos para corrigir no cadastro",
          tabela(
            ["Código", "Produto", "NCM", "Como saiu na nota", "Notas", "Valor", "Corrigir para"],
            a.produtos.map((p) => [p.codigo ?? "—", p.descricao ?? "—", formatarNcm(p.ncm), comoSaiu(p), String(p.notas), moeda(p.valor), { text: sugestaoProduto(a.regra, p), bold: true }]),
            [42, "*", 46, 82, 26, 52, 92],
            [4, 5],
          ),
          a.produtos.length,
        ),
        comRotulo(
          "Notas de cada produto",
          tabela(
            ["Produto", "Notas (número e data)"],
            a.produtos.map((p) => [`${p.codigo ? `${p.codigo} — ` : ""}${p.descricao ?? "—"}`, listaNotas(p)]),
            [150, "*"],
          ),
          a.produtos.length,
        ),
      );
    } else if (a.referencias.length) {
      blocos.push(
        comRotulo(
          "Notas",
          tabela(
            ["Nota", "Data", "Descrição", "Valor", "Motivo"],
            a.referencias.map((r) => [`${nomeNota(r.modelo)} ${r.numero ?? "s/nº"}`, r.data ? formatarData(r.data) : "—", r.descricao ?? "—", moeda(r.valor), r.motivo]),
            [62, 46, "*", 52, 120],
            [3],
          ),
          a.referencias.length,
        ),
      );
    }
    if (a.fontes.length) {
      blocos.push({ text: `Base legal: ${a.fontes.map((f) => f.titulo).join("; ")}.`, style: "nota", margin: [0, 0, 0, 4] });
    }
  });

  blocos.push({
    text:
      "Os valores são estimativas calculadas por regras fixas a partir das notas fiscais guardadas no portal, com a lei citada em cada ponto. " +
      "A recuperação de valores depende da conferência da apuração de cada mês pelo escritório. Nada foi enviado à Receita Federal, à SEFAZ ou ao município.",
    style: "nota",
    margin: [0, 12, 0, 0],
  });
  return blocos;
}

/** Planilha: produtos a corrigir (para o cadastro do sistema de vendas) e as notas de cada um. */
export function planilhaCorrecoes(wb: ExcelJS.Workbook, info: InfoPlanilha, d: DadosRelatorioCorrecoes) {
  const ws = wb.addWorksheet("Produtos a corrigir");
  cabecalhoPlanilha(
    ws,
    info,
    ["Ponto", "Mês", "Código", "Produto", "NCM", "CFOP", "CSOSN/CST ICMS", "CST PIS", "CST Cofins", "Notas", "Valor", "Corrigir para", "Motivo"],
    [34, 10, 14, 40, 12, 8, 14, 9, 10, 8, 14, 34, 40],
  );
  d.achados.forEach((a, i) => {
    for (const p of a.produtos) {
      const r = ws.addRow([
        `${i + 1}. ${ROTULO_REGRA[a.regra] ?? a.regra}`,
        formatarCompetencia(a.competencia),
        p.codigo ?? "",
        p.descricao ?? "",
        formatarNcm(p.ncm),
        p.cfop ?? "",
        p.csosn ?? p.cst_icms ?? "",
        p.cst_pis ?? "",
        p.cst_cofins ?? "",
        p.notas,
        Number(p.valor ?? 0),
        sugestaoProduto(a.regra, p),
        p.motivo ?? "",
      ]);
      r.getCell(11).numFmt = '"R$" #,##0.00';
    }
  });

  const wn = wb.addWorksheet("Notas");
  cabecalhoPlanilha(wn, info, ["Ponto", "Código", "Produto", "Nota", "Tipo", "Data", "Valor do item"], [34, 14, 40, 12, 8, 12, 14]);
  d.achados.forEach((a, i) => {
    const ponto = `${i + 1}. ${ROTULO_REGRA[a.regra] ?? a.regra}`;
    if (a.produtos.length) {
      for (const p of a.produtos)
        for (const n of p.lista) {
          const r = wn.addRow([ponto, p.codigo ?? "", p.descricao ?? "", n.numero ?? "", nomeNota(n.modelo), n.data ? formatarData(n.data) : "", Number(n.valor ?? 0)]);
          r.getCell(7).numFmt = '"R$" #,##0.00';
        }
    } else {
      for (const n of a.referencias) {
        const r = wn.addRow([ponto, "", n.descricao ?? "", n.numero ?? "", nomeNota(n.modelo), n.data ? formatarData(n.data) : "", Number(n.valor ?? 0)]);
        r.getCell(7).numFmt = '"R$" #,##0.00';
      }
    }
  });
}

export const TITULO_RELATORIO_CORRECOES = "Relatório de correções fiscais";

/** Gera o relatório (PDF com as duas logos ou planilha) dos achados escolhidos. */
export async function gerarRelatorioCorrecoes(
  supabase: Cliente,
  empresa: { id: string; razao_social: string; nome_fantasia: string | null; logo_path: string | null },
  ids: string[],
  recado: string | null,
  formato: "pdf" | "xlsx",
): Promise<{ arquivo: Buffer; nome: string; tipo: string; dados: DadosRelatorioCorrecoes }> {
  const dados = await carregarRelatorioCorrecoes(supabase, empresa.id, ids);
  if (!dados.achados.length) throw new Error("Nenhum achado escolhido (os descartados ficam de fora).");
  const nome = nomeArquivo(["correcoes-fiscais", empresa.nome_fantasia || empresa.razao_social, new Date().toISOString().slice(0, 10)], formato);
  if (formato === "pdf") {
    const cab = await montarCabecalho(supabase, empresa.id, {
      titulo: TITULO_RELATORIO_CORRECOES,
      subtitulo: `Auditor fiscal — ${dados.periodo}`,
      situacao: "documento",
    });
    return { arquivo: await gerarPdf(cab, blocosRelatorioCorrecoes(dados, recado)), nome, tipo: "application/pdf", dados };
  }
  const wb = novaPasta();
  planilhaCorrecoes(
    wb,
    {
      titulo: TITULO_RELATORIO_CORRECOES,
      empresa: empresa.razao_social,
      periodo: dados.periodo,
      situacao: "Achados do auditor fiscal do portal",
      geradoEm: formatarDataHora(new Date().toISOString()),
      logos: await logosDaEmpresa(supabase, empresa.logo_path),
    },
    dados,
  );
  return { arquivo: Buffer.from(await bufferPlanilha(wb)), nome, tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", dados };
}
