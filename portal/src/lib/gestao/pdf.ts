import "server-only";
import type { Content, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import { logoHorizontalSvg } from "@/lib/marca/logo";
import { COR, carregarPdfMake } from "@/lib/relatorios/pdf";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { FORMAS_PAGAMENTO, ORDEM_FORMAS, formatarQuantidade, hora, un } from "./rotulos";
import { FORMAS_COM_COMPROVANTE, totalCartao, valorDaForma, type RelatorioCaixa, type VendaDoCaixa } from "./dados";
import { FORMAS_PAGAMENTO_HOTEL, type FormaPagamentoHotel } from "@/lib/hotel/rotulos";

/**
 * Relatório do dia do caixa em PDF: resumo por forma de pagamento, conferência
 * do dinheiro da gaveta, cada venda com os itens e a forma de pagamento,
 * sangrias e suprimentos e o total vendido por produto.
 */

export interface DadosPdfCaixa {
  relatorio: RelatorioCaixa;
  empresa: { nome: string; razao: string; documento: string };
  /** Logo da empresa cliente (cadastro da empresa). */
  logo: { dados: string } | null;
  /** Logo enviada pelo escritório (sem ela, a logomarca oficial). */
  logoEscritorio: { dados: string } | null;
  geradoEm: string;
}

const R$ = (v: Parameters<typeof formatarMoeda>[0]) => formatarMoeda(v ?? 0);

function textoPagamento(p: VendaDoCaixa["pagamentos"][number]): string {
  let t = `${FORMAS_PAGAMENTO[p.forma]} ${R$(p.valor)}`;
  if (p.forma === "dinheiro" && p.valor_recebido && dec(p.valor_recebido).gt(dec(p.valor))) {
    t += ` (recebeu ${R$(p.valor_recebido)}, troco ${R$(dec(p.valor_recebido).minus(dec(p.valor)))})`;
  }
  if ((p.forma === "a_prazo" || p.forma === "cartao_credito") && p.parcelas > 1) t += ` em ${p.parcelas}x`;
  if (p.forma === "a_prazo" && p.primeiro_vencimento) t += `, 1º venc. ${formatarData(p.primeiro_vencimento)}`;
  return t;
}

function textoItem(i: VendaDoCaixa["itens"][number]): string {
  const medida = i.pecas ? `${formatarQuantidade(i.pecas, 3)} pç${i.comprimento_m ? ` × ${formatarQuantidade(i.comprimento_m, 3)} m` : ""} = ` : "";
  const desconto = dec(i.desconto).gt(0) ? ` (desc. ${R$(i.desconto)})` : "";
  return `${medida}${formatarQuantidade(i.quantidade)} ${un(i.unidade)} ${i.descricao} × ${R$(i.preco_unitario)}${desconto} = ${R$(i.total)}`;
}

export async function gerarPdfRelatorioCaixa(d: DadosPdfCaixa): Promise<Buffer> {
  const pm = await carregarPdfMake();
  const { sessao: s, resumo: r, vendas, movimentos, produtos, hotel } = d.relatorio;
  const hotelDinheiro = Number(r.hotel_por_forma?.dinheiro?.valor ?? 0);
  const fechado = s.status === "fechado";
  const concluidas = vendas.filter((v) => v.status === "concluida");
  const media = concluidas.length ? dec(r.vendas_total).div(concluidas.length) : dec(0);

  const cab = (textos: string[], direita: number[] = []): TableCell[] =>
    textos.map((t, i) => ({ text: t, bold: true, fontSize: 8, color: "#ffffff", fillColor: COR.marrom, alignment: direita.includes(i) ? "right" : "left" }));
  const layoutTabela = {
    hLineWidth: (i: number) => (i <= 1 ? 0 : 0.4),
    vLineWidth: () => 0,
    hLineColor: () => COR.begeForte,
    paddingTop: () => 3,
    paddingBottom: () => 3,
  };

  // Destaques do dia
  const destaques: [string, string, string?][] = [
    ["Total vendido", R$(r.vendas_total), `${r.vendas_quantidade} venda(s) · média de ${R$(media)} por venda`],
    ["Dinheiro", R$(valorDaForma(r, "dinheiro")), `${r.por_forma?.dinheiro?.vendas ?? 0} venda(s)`],
    ["PIX", R$(valorDaForma(r, "pix")), `${r.por_forma?.pix?.vendas ?? 0} venda(s)`],
    ["Cartão", R$(totalCartao(r)), `débito ${R$(valorDaForma(r, "cartao_debito"))} · crédito ${R$(valorDaForma(r, "cartao_credito"))}`],
    ["A prazo", R$(valorDaForma(r, "a_prazo")), `${r.por_forma?.a_prazo?.vendas ?? 0} venda(s) — vai para contas a receber`],
  ];
  const cartoes: Content = {
    columns: destaques.map(([rotulo, valor, detalhe]) => ({
      width: "*",
      table: {
        widths: ["*"],
        body: [
          [
            {
              stack: [
                { text: rotulo.toUpperCase(), fontSize: 6.5, color: COR.cinza, bold: true, characterSpacing: 0.4 },
                { text: valor, fontSize: 11.5, bold: true, color: COR.marrom, margin: [0, 2, 0, 1] },
                { text: detalhe ?? "", fontSize: 6.5, color: COR.cinza },
              ],
              fillColor: COR.bege,
              margin: [4, 3, 4, 3],
            },
          ],
        ],
      },
      layout: "noBorders",
    })),
    columnGap: 6,
    margin: [0, 4, 0, 0],
  };

  // Resumo por forma de pagamento
  const linhasFormas: TableCell[][] = ORDEM_FORMAS.filter((f) => r.por_forma?.[f]).map((f) => {
    const v = valorDaForma(r, f);
    const pct = dec(r.vendas_total).gt(0) ? v.div(r.vendas_total).times(100) : dec(0);
    return [FORMAS_PAGAMENTO[f], { text: String(r.por_forma?.[f]?.vendas ?? 0), alignment: "right" }, { text: `${pct.toFixed(1).replace(".", ",")}%`, alignment: "right" }, { text: R$(v), alignment: "right", noWrap: true }];
  });
  linhasFormas.push([
    { text: "Total", bold: true, fillColor: COR.bege },
    { text: String(r.vendas_quantidade), alignment: "right", bold: true, fillColor: COR.bege },
    { text: "100%", alignment: "right", bold: true, fillColor: COR.bege },
    { text: R$(r.vendas_total), alignment: "right", bold: true, fillColor: COR.bege, noWrap: true },
  ]);

  // Dinheiro da gaveta
  const diferenca = s.diferenca != null ? dec(s.diferenca) : null;
  const gaveta: TableCell[][] = [
    ["Troco inicial (abertura)", { text: R$(r.abertura), alignment: "right" }],
    ["+ Vendas em dinheiro (já descontado o troco)", { text: R$(valorDaForma(r, "dinheiro")), alignment: "right" }],
    ...(hotelDinheiro ? [["+ Hospedagens em dinheiro", { text: R$(hotelDinheiro), alignment: "right" }] as TableCell[]] : []),
    [`+ Suprimentos (${r.qtd_suprimentos})`, { text: R$(r.suprimentos), alignment: "right" }],
    [`− Sangrias (${r.qtd_sangrias})`, { text: R$(r.sangrias), alignment: "right" }],
    [{ text: "= Dinheiro que deve estar na gaveta", bold: true, fillColor: COR.bege }, { text: R$(r.dinheiro_esperado), alignment: "right", bold: true, fillColor: COR.bege }],
  ];
  if (fechado) {
    gaveta.push(["Dinheiro contado no fechamento", { text: R$(s.valor_contado), alignment: "right" }]);
    gaveta.push([
      { text: diferenca && !diferenca.isZero() ? (diferenca.gt(0) ? "Sobra" : "Falta") : "Diferença", bold: true },
      {
        text: diferenca && !diferenca.isZero() ? R$(diferenca.abs()) : "Conferiu certinho",
        alignment: "right",
        bold: true,
        color: diferenca && !diferenca.isZero() ? (diferenca.gt(0) ? COR.amarelo : COR.vermelho) : COR.verde,
      },
    ]);
  }

  // Vendas, uma por uma
  const linhasVendas: TableCell[][] = vendas.map((v) => {
    const cancelada = v.status === "cancelada";
    const cor = cancelada ? COR.cinza : undefined;
    const extras: string[] = [];
    if (dec(v.desconto).gt(0)) extras.push(`desconto ${R$(v.desconto)}`);
    if (dec(v.frete).gt(0)) extras.push(`frete ${R$(v.frete)}`);
    return [
      { text: String(v.numero), bold: true, color: cor },
      { text: hora(v.hora), color: cor },
      { text: v.cliente ?? "Consumidor", color: cor },
      {
        stack: [
          ...v.itens.map((i) => ({ text: textoItem(i), color: cor, decoration: cancelada ? ("lineThrough" as const) : undefined })),
          ...(extras.length ? [{ text: extras.join(" · "), color: COR.cinza, italics: true }] : []),
          ...(cancelada ? [{ text: `CANCELADA${v.motivo_cancelamento ? ` — ${v.motivo_cancelamento}` : ""}`, color: COR.vermelho, bold: true }] : []),
        ],
      },
      { stack: v.pagamentos.map((p) => ({ text: textoPagamento(p), color: cor })) },
      { text: R$(v.total), alignment: "right", bold: true, noWrap: true, color: cor, decoration: cancelada ? "lineThrough" : undefined },
    ];
  });

  const conteudo: Content[] = [
    {
      // Logo do escritório à esquerda; a da empresa à direita, com a razão social e o CNPJ
      columns: [
        { width: "*", stack: [d.logoEscritorio ? { image: d.logoEscritorio.dados, fit: [140, 40] } : { svg: logoHorizontalSvg(COR.marrom), width: 132 }] },
        {
          width: "auto",
          alignment: "right",
          stack: [
            ...(d.logo ? [{ image: d.logo.dados, fit: [130, 34], alignment: "right", margin: [0, 0, 0, 2] } as Content] : []),
            { text: d.empresa.razao, bold: true, fontSize: d.logo ? 8 : 9, color: COR.marrom },
            { text: formatarDocumento(d.empresa.documento), fontSize: 8, color: COR.cinza },
          ],
        },
      ],
    },
    { canvas: [{ type: "rect", x: 0, y: 0, w: 515, h: 2.5, color: COR.marrom }], margin: [0, 8, 0, 8] },
    { text: `Relatório do caixa — ${formatarData(s.data)}`, fontSize: 16, bold: true, color: COR.marrom },
    {
      text: [
        { text: `${s.caixa_nome} · operador(a): ${s.operador ?? "—"} · aberto em ${formatarDataHora(s.aberto_em)}` },
        fechado ? { text: ` · fechado em ${formatarDataHora(s.fechado_em)}${s.fechado_por && s.fechado_por !== s.operador ? ` por ${s.fechado_por}` : ""}` } : "",
      ],
      fontSize: 8.5,
      color: COR.cinza,
      margin: [0, 2, 0, 2],
    },
    {
      text: fechado ? "Caixa fechado" : "Caixa ainda aberto — relatório parcial até agora",
      bold: true,
      fontSize: 8.5,
      color: fechado ? COR.verde : COR.amarelo,
      margin: [0, 0, 0, 4],
    },
    cartoes,
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: "Resumo por forma de pagamento", fontSize: 11, bold: true, color: COR.marrom, margin: [0, 12, 0, 5] },
            linhasFormas.length > 1
              ? { table: { headerRows: 1, widths: ["*", 40, 40, 70], body: [cab(["Forma", "Vendas", "%", "Valor"], [1, 2, 3]), ...linhasFormas] }, layout: layoutTabela, fontSize: 8.5 }
              : { text: "Nenhuma venda neste caixa.", color: COR.cinza, fontSize: 8.5 },
            ...(r.canceladas_quantidade
              ? [{ text: `${r.canceladas_quantidade} venda(s) cancelada(s), somando ${R$(r.canceladas_total)} (fora do total).`, fontSize: 7.5, color: COR.cinza, margin: [0, 3, 0, 0] } as Content]
              : []),
            ...(dec(r.descontos).gt(0) ? [{ text: `Descontos dados nas vendas: ${R$(r.descontos)}.`, fontSize: 7.5, color: COR.cinza, margin: [0, 2, 0, 0] } as Content] : []),
          ],
        },
        {
          width: 230,
          stack: [
            { text: "Dinheiro da gaveta", fontSize: 11, bold: true, color: COR.marrom, margin: [0, 12, 0, 5] },
            { table: { widths: ["*", 70], body: gaveta }, layout: { ...layoutTabela, hLineWidth: () => 0.4 }, fontSize: 8.5 },
            ...(s.observacao_fechamento ? [{ text: `Observação do fechamento: ${s.observacao_fechamento}`, fontSize: 7.5, color: COR.cinza, margin: [0, 3, 0, 0] } as Content] : []),
          ],
        },
      ],
      columnGap: 16,
    },
    { text: "Vendas, uma por uma", fontSize: 11, bold: true, color: COR.marrom, margin: [0, 14, 0, 5] },
    linhasVendas.length
      ? {
          table: { headerRows: 1, dontBreakRows: true, widths: [22, 28, 80, "*", 130, 56], body: [cab(["Nº", "Hora", "Cliente", "O que foi vendido", "Pagamento", "Total"], [5]), ...linhasVendas] },
          layout: layoutTabela,
          fontSize: 7.5,
        }
      : { text: "Nenhuma venda neste caixa.", color: COR.cinza, fontSize: 8.5 },
    ...(hotel.length
      ? ([
          { text: "Recebimentos do hotel", fontSize: 11, bold: true, color: COR.marrom, margin: [0, 14, 0, 5] },
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              widths: [28, 70, "*", 80, 70, 56],
              body: [
                cab(["Hora", "Reserva", "Hóspede", "Forma", "Comprovante", "Valor"], [5]),
                ...hotel.map((h): TableCell[] => {
                  const cor = h.estornado ? COR.cinza : undefined;
                  const comprovante = h.estornado
                    ? { text: "Estornado", color: COR.vermelho, bold: true }
                    : h.comprovantes.length
                      ? { text: h.comprovantes.length > 1 ? `Sim (${h.comprovantes.length})` : "Sim", color: COR.verde }
                      : FORMAS_COM_COMPROVANTE.has(h.forma)
                        ? { text: "Sem comprovante", color: COR.amarelo, bold: true }
                        : { text: "—", color: COR.cinza };
                  return [
                    { text: hora(h.hora), color: cor },
                    { text: `Nº ${h.reserva_numero ?? "—"}${h.quarto ? ` · qto ${h.quarto}` : ""}`, color: cor },
                    { text: h.hospede ?? "", color: cor },
                    { text: `${FORMAS_PAGAMENTO_HOTEL[h.forma as FormaPagamentoHotel] ?? h.forma}${h.sinal ? " (sinal)" : ""}`, color: cor },
                    comprovante,
                    { text: R$(h.valor), alignment: "right", bold: true, noWrap: true, color: cor, decoration: h.estornado ? "lineThrough" : undefined },
                  ];
                }),
                [
                  { text: "Total recebido do hotel", bold: true, fillColor: COR.bege, colSpan: 5 },
                  {},
                  {},
                  {},
                  {},
                  { text: R$(r.hotel_total ?? 0), alignment: "right", bold: true, fillColor: COR.bege, noWrap: true },
                ],
              ],
            },
            layout: layoutTabela,
            fontSize: 7.5,
          },
        ] as Content[])
      : []),
    { text: "Sangrias e suprimentos", fontSize: 11, bold: true, color: COR.marrom, margin: [0, 14, 0, 5] },
    movimentos.length
      ? {
          table: {
            headerRows: 1,
            widths: [30, 60, "*", 110, 60],
            body: [
              cab(["Hora", "Tipo", "Motivo", "Conta / quem fez", "Valor"], [4]),
              ...movimentos.map((m): TableCell[] => [
                hora(m.hora),
                { text: m.tipo === "sangria" ? "Sangria" : "Suprimento", bold: true, color: m.tipo === "sangria" ? COR.vermelho : COR.verde },
                m.motivo,
                [m.conta, m.quem].filter(Boolean).join(" · ") || "—",
                { text: `${m.tipo === "sangria" ? "−" : "+"} ${R$(m.valor)}`, alignment: "right", noWrap: true },
              ]),
            ],
          },
          layout: layoutTabela,
          fontSize: 8,
        }
      : { text: "Nenhuma sangria ou suprimento.", color: COR.cinza, fontSize: 8.5 },
    ...(produtos.length
      ? [
          { text: "Produtos vendidos no dia", fontSize: 11, bold: true, color: COR.marrom, margin: [0, 14, 0, 5] } as Content,
          {
            table: {
              headerRows: 1,
              widths: ["*", 60, 90, 70],
              body: [
                cab(["Produto", "Peças", "Quantidade", "Total"], [1, 2, 3]),
                ...produtos.map((p): TableCell[] => [
                  p.descricao,
                  { text: p.pecas ? formatarQuantidade(p.pecas, 3) : "—", alignment: "right" },
                  { text: `${formatarQuantidade(p.quantidade)} ${un(p.unidade)}`, alignment: "right" },
                  { text: R$(p.total), alignment: "right", noWrap: true },
                ]),
              ],
            },
            layout: layoutTabela,
            fontSize: 8,
          } as Content,
        ]
      : []),
    {
      unbreakable: true,
      margin: [0, 36, 0, 0],
      columns: [
        {
          stack: [
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.7 }] },
            { text: `Operador(a) do caixa${s.operador ? ` — ${s.operador}` : ""}`, fontSize: 8, color: COR.cinza, margin: [0, 3, 0, 0] },
          ],
        },
        {
          stack: [
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.7 }] },
            { text: "Conferido por (gerente)", fontSize: 8, color: COR.cinza, margin: [0, 3, 0, 0] },
          ],
        },
      ],
      columnGap: 40,
    },
  ];

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 36, 40, 46],
    info: { title: `Relatório do caixa ${formatarData(s.data)} — ${d.empresa.nome}`, author: d.empresa.razao, creator: "Portal Guarese's ON" },
    watermark: fechado ? undefined : { text: "PARCIAL", opacity: 0.05, bold: true, fontSize: 90 },
    footer: (pagina: number, total: number) => ({
      margin: [40, 12, 40, 0],
      columns: [
        { text: `Gerado em ${formatarDataHora(d.geradoEm)} pelo Portal Guarese's ON · os valores entram automaticamente no Financeiro e na contabilidade`, fontSize: 6.5, color: COR.cinza, margin: [0, 3, 0, 0] },
        { text: `Página ${pagina} de ${total}`, alignment: "right", fontSize: 7, color: COR.cinza, width: 60, margin: [0, 3, 0, 0] },
      ],
    }),
    defaultStyle: { font: "Roboto", fontSize: 9, lineHeight: 1.2, color: "#2b211b" },
    content: conteudo,
  };
  return pm.createPdf(doc).getBuffer();
}
