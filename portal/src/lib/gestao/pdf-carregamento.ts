import "server-only";
import type { Content, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import { logoHorizontalSvg } from "@/lib/marca/logo";
import { COR, carregarPdfMake } from "@/lib/relatorios/pdf";
import { formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { formatarQuantidade } from "./rotulos";
import { FRETE_POR_CONTA, formatarKg, mostrarPlaca, quantidadePelaPesagem } from "./carregamentos";

/**
 * Ordem de carregamento em PDF (A4), para o motorista, a balança e o armazém:
 * vendedor e local de carregamento, comprador e destino, produto e quantidade,
 * transporte (transportadora, motorista e placas), pesagem (preenchida ou em
 * branco para anotar) e assinaturas. Sem preço: a ordem circula fora da empresa.
 */

export interface OrdemPdf {
  numero: number;
  status: string;
  data_emissao: string;
  validade: string | null;
  local_carregamento: string | null;
  destinatario_nome: string;
  destinatario_documento: string | null;
  local_descarga: string | null;
  produto_descricao: string;
  unidade: string;
  quantidade: number;
  peso_previsto_kg: number | null;
  contrato: string | null;
  frete_por_conta: number;
  transportador_nome: string | null;
  transportador_documento: string | null;
  rntrc: string | null;
  motorista_nome: string | null;
  motorista_cpf: string | null;
  placa: string | null;
  placa_uf: string | null;
  placas_reboque: string[];
  observacoes: string | null;
  peso_bruto_kg: number | null;
  tara_kg: number | null;
  peso_liquido_kg: number | null;
  umidade: number | null;
  impureza: number | null;
  ticket_balanca: string | null;
  carregado_em: string | null;
  motivo_cancelamento: string | null;
}

export interface DadosPdfOrdem {
  ordem: OrdemPdf;
  pesoKgUnidade: number | null;
  vendedor: { razao: string; documento: string; inscricao: string | null };
  nota: { numero: number; serie: number } | null;
  mensagem: string | null;
  demonstracao: boolean;
  logo: { dados: string } | null;
  logoEscritorio: { dados: string } | null;
  geradoEm: string;
}

const vazio = (v: string | null | undefined) => (v && v.trim() ? v : "—");

export async function gerarPdfOrdem(d: DadosPdfOrdem): Promise<Buffer> {
  const pm = await carregarPdfMake();
  const o = d.ordem;
  const cancelada = o.status === "cancelada";

  const titulo = (t: string, colSpan: number): TableCell => ({
    text: t.toUpperCase(),
    bold: true,
    fontSize: 7.5,
    color: "#ffffff",
    fillColor: COR.marrom,
    characterSpacing: 0.5,
    margin: [2, 1, 2, 1],
    colSpan,
  });
  const campo = (rotulo: string, valor: string, extra?: Partial<Record<"bold" | "fontSize", unknown>>): Content => ({
    stack: [
      {
        text: rotulo.toUpperCase(),
        fontSize: 6,
        color: COR.cinza,
        bold: true,
        characterSpacing: 0.3,
      },
      {
        text: valor,
        fontSize: (extra?.fontSize as number) ?? 9.5,
        bold: Boolean(extra?.bold),
        margin: [0, 1, 0, 0],
      },
    ],
    margin: [2, 2, 2, 3],
  });
  const quadro = (nome: string, linhas: Content[][], larguras: (string | number)[]): Content => ({
    table: {
      widths: larguras,
      body: [[titulo(nome, larguras.length), ...larguras.slice(1).map((): TableCell => ({ text: "" }))], ...linhas.map((l) => l as TableCell[])],
    },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => COR.begeForte,
      vLineColor: () => COR.begeForte,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
    margin: [0, 0, 0, 8],
  });

  const pesado = o.peso_liquido_kg != null;
  const naUnidade = pesado ? quantidadePelaPesagem(o.peso_liquido_kg!, o.unidade, d.pesoKgUnidade) : null;
  const linhaEmBranco = "______________________";

  const conteudo: Content[] = [
    {
      // Logo do escritório à esquerda; a da empresa à direita, com a razão social e o CNPJ
      columns: [
        {
          width: "*",
          stack: [d.logoEscritorio ? { image: d.logoEscritorio.dados, fit: [140, 40] } : { svg: logoHorizontalSvg(COR.marrom), width: 132 }],
        },
        {
          width: "auto",
          alignment: "right",
          stack: [
            ...(d.logo
              ? [
                  {
                    image: d.logo.dados,
                    fit: [130, 34],
                    alignment: "right",
                    margin: [0, 0, 0, 2],
                  } as Content,
                ]
              : []),
            {
              text: d.vendedor.razao,
              bold: true,
              fontSize: d.logo ? 8 : 9,
              color: COR.marrom,
            },
            {
              text: `${formatarDocumento(d.vendedor.documento)}${d.vendedor.inscricao ? ` · IE ${d.vendedor.inscricao}` : ""}`,
              fontSize: 8,
              color: COR.cinza,
            },
          ],
        },
      ],
    },
    {
      canvas: [{ type: "rect", x: 0, y: 0, w: 515, h: 2.5, color: COR.marrom }],
      margin: [0, 8, 0, 8],
    },
    ...(d.demonstracao
      ? [
          {
            text: "DEMONSTRAÇÃO — DADOS FICTÍCIOS",
            alignment: "center",
            bold: true,
            fontSize: 9,
            color: COR.vermelho,
            margin: [0, 0, 0, 6],
          } as Content,
        ]
      : []),
    {
      columns: [
        {
          width: "*",
          text: "Ordem de carregamento",
          fontSize: 17,
          bold: true,
          color: COR.marrom,
        },
        {
          width: "auto",
          table: {
            body: [
              [
                {
                  text: `Nº ${String(o.numero).padStart(6, "0")}`,
                  fontSize: 15,
                  bold: true,
                  color: COR.marrom,
                  fillColor: COR.bege,
                  margin: [8, 2, 8, 2],
                },
              ],
            ],
          },
          layout: "noBorders",
        },
      ],
    },
    {
      text: `Emitida em ${formatarData(o.data_emissao)}${o.validade ? ` · válida até ${formatarData(o.validade)}` : ""}${d.nota ? ` · NF-e nº ${d.nota.numero} (série ${d.nota.serie})` : ""}`,
      fontSize: 8.5,
      color: COR.cinza,
      margin: [0, 2, 0, 8],
    },
    ...(cancelada
      ? [
          {
            text: `ORDEM CANCELADA${o.motivo_cancelamento ? ` — ${o.motivo_cancelamento}` : ""}. Não carregar.`,
            bold: true,
            color: COR.vermelho,
            fontSize: 10,
            margin: [0, 0, 0, 8],
          } as Content,
        ]
      : []),
    {
      columns: [
        quadro(
          "Carregar em (vendedor)",
          [[campo("Vendedor", d.vendedor.razao, { bold: true })], [campo("Local de carregamento", vazio(o.local_carregamento))]],
          ["*"],
        ),
        quadro(
          "Entregar para (comprador)",
          [
            [
              campo("Comprador", `${o.destinatario_nome}${o.destinatario_documento ? ` — ${formatarDocumento(o.destinatario_documento)}` : ""}`, {
                bold: true,
              }),
            ],
            [campo("Local de descarga", vazio(o.local_descarga))],
          ],
          ["*"],
        ),
      ],
      columnGap: 8,
    },
    quadro(
      "Produto",
      [
        [
          campo("Produto", o.produto_descricao, { bold: true, fontSize: 11 }),
          campo("Quantidade prevista", `${formatarQuantidade(o.quantidade)} ${o.unidade}`, { bold: true, fontSize: 11 }),
          campo("Peso previsto", o.peso_previsto_kg != null ? formatarKg(o.peso_previsto_kg) : "—"),
          campo("Contrato / pedido", vazio(o.contrato)),
        ],
      ],
      ["*", 110, 90, 90],
    ),
    quadro(
      "Transporte",
      [
        [
          campo("Frete", FRETE_POR_CONTA[o.frete_por_conta] ?? String(o.frete_por_conta)),
          campo("Transportadora", `${vazio(o.transportador_nome)}${o.transportador_documento ? ` — ${formatarDocumento(o.transportador_documento)}` : ""}`),
          campo("RNTRC (ANTT)", vazio(o.rntrc)),
        ],
        [
          campo("Motorista", vazio(o.motorista_nome), { bold: true }),
          campo("CPF do motorista", o.motorista_cpf ? formatarDocumento(o.motorista_cpf) : "—"),
          campo(
            "Placas",
            `${mostrarPlaca(o.placa)}${o.placa_uf ? `/${o.placa_uf}` : ""}${o.placas_reboque.length ? ` + ${o.placas_reboque.map(mostrarPlaca).join(", ")}` : ""}`,
            { bold: true },
          ),
        ],
      ],
      [110, "*", 150],
    ),
    quadro(
      pesado ? "Pesagem" : "Pesagem (preencher na balança)",
      [
        [
          campo("Peso bruto (carregado)", pesado ? formatarKg(o.peso_bruto_kg) : linhaEmBranco),
          campo("Tara (vazio)", pesado ? formatarKg(o.tara_kg) : linhaEmBranco),
          campo(
            "Peso líquido",
            pesado
              ? `${formatarKg(o.peso_liquido_kg)}${naUnidade && o.unidade.toUpperCase() !== "KG" ? ` = ${formatarQuantidade(naUnidade)} ${o.unidade}` : ""}`
              : linhaEmBranco,
            { bold: pesado },
          ),
        ],
        [
          campo("Umidade", o.umidade != null ? `${formatarQuantidade(o.umidade, 2)}%` : pesado ? "—" : "________ %"),
          campo("Impureza", o.impureza != null ? `${formatarQuantidade(o.impureza, 2)}%` : pesado ? "—" : "________ %"),
          campo("Ticket / data e hora", pesado ? `${vazio(o.ticket_balanca)}${o.carregado_em ? ` · ${formatarDataHora(o.carregado_em)}` : ""}` : linhaEmBranco),
        ],
      ],
      ["*", "*", "*"],
    ),
    ...(o.observacoes ? [quadro("Observações", [[{ text: o.observacoes, fontSize: 9, margin: [2, 3, 2, 3] }]], ["*"])] : []),
    {
      unbreakable: true,
      margin: [0, 34, 0, 0],
      columns: ["Liberado por (vendedor)", "Motorista", "Balança / armazém"].map((t) => ({
        stack: [
          {
            canvas: [{ type: "line", x1: 0, y1: 0, x2: 155, y2: 0, lineWidth: 0.7 }],
          },
          { text: t, fontSize: 8, color: COR.cinza, margin: [0, 3, 0, 0] },
        ],
      })),
      columnGap: 25,
    },
    {
      text: "Documento de controle do carregamento. Não substitui a NF-e nem os documentos do transporte (MDF-e ou CT-e, quando exigidos), que devem acompanhar a carga.",
      fontSize: 7,
      color: COR.cinza,
      italics: true,
      margin: [0, 14, 0, 0],
    },
    ...(d.mensagem ? [{ text: d.mensagem, fontSize: 8, margin: [0, 6, 0, 0] } as Content] : []),
  ];

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 36, 40, 40],
    info: {
      title: `Ordem de carregamento nº ${o.numero} — ${d.vendedor.razao}`,
      author: d.vendedor.razao,
      creator: "Portal Guarese's ON",
    },
    watermark: cancelada
      ? {
          text: "CANCELADA",
          opacity: 0.08,
          bold: true,
          fontSize: 90,
          color: COR.vermelho,
        }
      : undefined,
    footer: () => ({
      margin: [40, 10, 40, 0],
      text: `Gerada em ${formatarDataHora(d.geradoEm)} pelo Portal Guarese's ON`,
      fontSize: 6.5,
      color: COR.cinza,
    }),
    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
      lineHeight: 1.15,
      color: "#2b211b",
    },
    content: conteudo,
  };
  return pm.createPdf(doc).getBuffer();
}
