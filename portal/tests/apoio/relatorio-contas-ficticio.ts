import { carregarPdfMake } from "@/lib/relatorios/pdf";

/**
 * Relatório de contas a pagar FICTÍCIO no mesmo leiaute do relatório impresso
 * por sistemas de gestão de lojas (título, quadro de resumo e tabela com
 * "Destinado à", CPF, CNPJ, Descrição, Data de vencimento, Situação, Valor e
 * Valor total, com o cabeçalho repetido em cada página). Dados inventados.
 */
export interface ContaFicticia {
  destinado?: string;
  cpf?: string;
  cnpj?: string;
  descricao: string;
  vencimento: string; // dd/mm/aaaa
  situacao?: string;
  valor: string; // "1.234,56"
}

const br = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Contas fictícias: parcelas de compras de madeira, despesas e reembolsos. */
export function contasFicticias(): ContaFicticia[] {
  const contas: ContaFicticia[] = [];
  const mes = (m: number, d: number) => `${String(d).padStart(2, "0")}/${String(((m - 1) % 12) + 1).padStart(2, "0")}/${2027 + Math.floor((m - 1) / 12)}`;
  for (let p = 1; p <= 6; p++) contas.push({ descricao: `TORAS DE PINUS FORNECEDOR TESTE (${p}/6)`, vencimento: mes(p, 25), valor: "8.450,00" });
  for (let p = 1; p <= 10; p++) contas.push({ descricao: `NOTEBOOK ESCRITORIO TESTE (${p}/10)`, vencimento: mes(p, 10), valor: p === 10 ? "250,05" : "250,00" });
  for (let p = 1; p <= 4; p++) contas.push({ descricao: `CONSERTO EMPILHADEIRA TESTE (${p}/4)`, vencimento: mes(p, 5), valor: "1.875,40" });
  contas.push({ destinado: "FUNCIONARIO FICTICIO DA SILVA", descricao: "SALARIO FUNCIONARIO FICTICIO", vencimento: mes(1, 5), valor: "2.100,00" });
  contas.push({ descricao: "FRETE COMPENSADO TESTE", vencimento: mes(1, 8), valor: "3.300,00" });
  contas.push({ descricao: "ALUGUEL GALPAO TESTE", vencimento: mes(1, 10), valor: "4.000,00" });
  contas.push({ descricao: "ENERGIA ELETRICA SERRARIA TESTE", vencimento: mes(1, 15), valor: "1.234,56" });
  contas.push({ descricao: "REEMBOLSO SOCIO TESTE - COMBUSTIVEL", vencimento: mes(1, 3), valor: "380,00" });
  contas.push({ cnpj: "11.222.333/0001-81", destinado: "TRANSPORTADORA FICTICIA LTDA", descricao: "FRETE TORAS TESTE", vencimento: mes(2, 12), valor: "5.600,00" });
  return contas;
}

export async function relatorioContasFicticio(opcoes: { contas?: ContaFicticia[]; tipo?: "pagar" | "receber"; totalErrado?: boolean; quantidadeErrada?: boolean } = {}): Promise<Buffer> {
  const contas = opcoes.contas ?? contasFicticias();
  const tipo = opcoes.tipo ?? "pagar";
  const soma = contas.reduce((s, c) => s + Number(c.valor.replace(/\./g, "").replace(",", ".")), 0);
  const total = opcoes.totalErrado ? soma + 10 : soma;
  const quantidade = opcoes.quantidadeErrada ? contas.length + 1 : contas.length;
  const pm = await carregarPdfMake();
  const cel = (texto: string) => ({ text: texto, alignment: "center" as const, fontSize: 7, color: "#444444" });
  const cab = ["Destinado à", "CPF", "CNPJ", "Descrição", "Data de vencimento", "Situação", "Valor", "Valor total"].map((t) => ({ text: t, bold: true, color: "#ffffff", fillColor: "#555555", alignment: "center" as const, fontSize: 7.5 }));
  const titulo = `Relatório de contas a ${tipo}`;
  const doc = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [30, 95, 30, 40],
    header: () => ({
      margin: [30, 20, 30, 0],
      stack: [
        { text: titulo, fontSize: 16 },
        { text: "Período: 01/01/2027 à 31/12/2027", fontSize: 9, margin: [0, 4, 0, 0] },
        { text: "Gerado em 26/11/2026 às 10:00:00 (DEMONSTRAÇÃO, dados fictícios)", fontSize: 9 },
      ],
    }),
    footer: (pagina: number, totalPaginas: number) => ({ text: `Página ${pagina} de ${totalPaginas}`, alignment: "right", margin: [30, 10, 30, 0], fontSize: 8 }),
    content: [
      {
        table: {
          widths: ["*", "*", "*"],
          body: [
            [
              { stack: [{ text: tipo === "pagar" ? "A pagar" : "A receber", fontSize: 8 }, { text: br(total), bold: true, fontSize: 11 }, { text: `total a ${tipo} no período`, fontSize: 6 }], alignment: "center" },
              { stack: [{ text: "Confirmado", fontSize: 8 }, { text: "0,00", bold: true, fontSize: 11 }, { text: "valores já confirmados", fontSize: 6 }], alignment: "center" },
              { stack: [{ text: "Total", fontSize: 8 }, { text: br(total), bold: true, fontSize: 11 }, { text: `${quantidade} cobranças no período`, fontSize: 6 }], alignment: "center" },
            ],
            [{ text: "Atrasados: 0,00", fontSize: 7, alignment: "center" }, { text: "Descontos / Juros: 0,00 / 0,00", fontSize: 7, alignment: "center" }, { text: "" }],
          ],
        },
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: [110, 45, 70, "*", 80, 55, 55, 55],
          body: [
            cab,
            ...contas.map((c) => [cel(c.destinado ?? ""), cel(c.cpf ?? ""), cel(c.cnpj ?? ""), cel(c.descricao), cel(c.vencimento), cel(c.situacao ?? "Em aberto"), cel(c.valor), cel(c.valor)]),
          ],
        },
        layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => "#dddddd", vLineColor: () => "#dddddd" },
      },
    ],
    defaultStyle: { font: "Roboto" },
  };
  return pm.createPdf(doc as never).getBuffer();
}
