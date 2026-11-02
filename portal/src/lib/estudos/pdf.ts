import "server-only";
import type { Content, ContentTable } from "pdfmake/interfaces";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { montarCabecalho, nomeArquivo } from "@/lib/relatorios/cabecalho";
import { COR, gerarPdf } from "@/lib/relatorios/pdf";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import type { Passo } from "./estudar";
import { NOME_TIPO, type TipoEstudo } from "./rotulos";

type Cliente = ContextoEmpresa["supabase"];

export interface EstudoPdf {
  id: string;
  empresa_id: string;
  tipo: TipoEstudo;
  estado: string;
  titulo: string;
  resumo: string;
  economia_anual: number | null;
  valor_unico: number | null;
  detalhes: { passos?: Passo[]; avisos?: string[] } | null;
  situacao: string;
  revisado_em: string | null;
  atualizado_em: string;
}

/** O que acontece depois, em linguagem simples, para o cliente. */
const PROXIMOS_PASSOS: Record<TipoEstudo, string[]> = {
  regime: [
    "A troca de regime só vale a partir de janeiro, com a opção feita no começo do ano (no Simples Nacional, até o último dia útil de janeiro).",
    "Antes de decidir, o escritório confere os números com você e avalia o que muda na rotina da empresa (obrigações, folha e notas).",
  ],
  fator_r: [
    "Ajustar o pró-labore dos sócios a partir do próximo mês, para que a folha dos últimos 12 meses fique em pelo menos 28% do faturamento.",
    "O escritório acompanha esse percentual todo mês, porque ele muda conforme o faturamento.",
  ],
  imposto_pago_a_mais: [
    "O escritório prepara a correção das apurações e o pedido de restituição ou compensação do valor pago a mais (prazo de 5 anos).",
    "Também orientamos o ajuste do cadastro dos produtos no sistema de vendas para o problema não se repetir.",
  ],
  limite_simples: [
    "Acompanhar o faturamento mês a mês. Acima de R$ 3,6 milhões no ano, o ICMS e o ISS deixam de ser pagos no DAS; acima de R$ 4,8 milhões, a empresa sai do Simples Nacional.",
    "Se o limite for ultrapassado em mais de 20%, a mudança vale já no mês seguinte. Vamos planejar juntos o próximo ano.",
  ],
};

function tabelaPassos(passos: Passo[]): ContentTable {
  return {
    table: {
      widths: ["*", "auto"],
      body: passos.map((p) => [
        { text: p.rotulo },
        { text: p.valor, alignment: "right", bold: true, noWrap: true },
      ]),
    },
    layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => COR.begeForte, paddingTop: () => 4, paddingBottom: () => 4 },
    fontSize: 9,
  } as ContentTable;
}

export function blocosEstudo(e: EstudoPdf, recado: string | null): Content[] {
  const valores: Content[][] = [[], []];
  if (e.economia_anual) {
    valores[0].push({ text: "Economia estimada por ano", color: COR.cinza, fontSize: 8 });
    valores[1].push({ text: formatarMoeda(e.economia_anual), bold: true, fontSize: 14, color: COR.verde });
  }
  if (e.valor_unico) {
    valores[0].push({ text: "Valor a recuperar", color: COR.cinza, fontSize: 8 });
    valores[1].push({ text: formatarMoeda(e.valor_unico), bold: true, fontSize: 14, color: COR.verde });
  }
  valores[0].push({ text: "Aprovado pelo escritório em", color: COR.cinza, fontSize: 8 });
  valores[1].push({ text: e.revisado_em ? formatarData(e.revisado_em.slice(0, 10)) : "—", bold: true, fontSize: 11, color: COR.marrom, margin: [0, 2, 0, 0] });

  const blocos: Content[] = [
    { table: { widths: valores[0].map(() => "*"), body: valores }, layout: "noBorders", margin: [0, 4, 0, 8] },
    { text: e.titulo, fontSize: 12, bold: true, color: COR.marrom, margin: [0, 0, 0, 4] },
    { text: e.resumo, margin: [0, 0, 0, 4] },
  ];
  if (recado?.trim()) {
    blocos.push({ text: "Recado do escritório", style: "secao" }, ...recado.trim().split(/\n{2,}/).map((p) => ({ text: p.trim(), margin: [0, 0, 0, 4] }) as Content));
  }
  if (e.detalhes?.passos?.length) blocos.push({ text: "Como calculamos", style: "secao" }, tabelaPassos(e.detalhes.passos));
  if (e.detalhes?.avisos?.length) {
    blocos.push({ text: "Premissas e cuidados", style: "secao" }, { ul: e.detalhes.avisos.map((a) => ({ text: a, margin: [0, 0, 0, 2] })), fontSize: 8.5 });
  }
  blocos.push({ text: "Próximos passos", style: "secao" }, { ol: PROXIMOS_PASSOS[e.tipo].map((p) => ({ text: p, margin: [0, 0, 0, 3] })) });
  return blocos;
}

/** PDF de um estudo aprovado, com as logos do escritório e do cliente. */
export async function gerarPdfEstudo(
  supabase: Cliente,
  empresa: { id: string; razao_social: string; nome_fantasia: string | null },
  e: EstudoPdf,
  recado: string | null,
): Promise<{ arquivo: Buffer; nome: string }> {
  const cab = await montarCabecalho(supabase, empresa.id, {
    titulo: "Estudo de planejamento tributário",
    subtitulo: NOME_TIPO[e.tipo] ?? e.tipo,
    situacao: "revisado",
    notaFinal:
      `Estimativa feita pelo escritório com os dados registrados no Portal Guarese's ON até ${formatarData(e.atualizado_em.slice(0, 10))}. ` +
      "Os valores podem mudar com novos dados e com mudanças na legislação. Nenhuma alteração deve ser feita sem a orientação do escritório.",
  });
  const nome = nomeArquivo(["estudo-tributario", NOME_TIPO[e.tipo]?.split(" (")[0], empresa.nome_fantasia || empresa.razao_social, new Date().toISOString().slice(0, 10)], "pdf");
  return { arquivo: await gerarPdf(cab, blocosEstudo(e, recado)), nome };
}
