import "server-only";
import type { Content, TableCell } from "pdfmake/interfaces";
import { COR } from "@/lib/relatorios/pdf";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCep, formatarCpf, formatarData, formatarDataHora, formatarDocumento, formatarTelefone, nomeMes } from "@/lib/formatos";
import { valorPorExtenso } from "@/lib/declaracoes/extenso";
import type { ReciboExtra, ReservaCompleta } from "./dados";
import type { RelatorioHotel } from "./relatorio";
import {
  FORMAS_PAGAMENTO_HOTEL,
  GENEROS,
  MEIOS_TRANSPORTE,
  MOTIVOS_VIAGEM,
  ORIGENS,
  SETORES,
  STATUS_RESERVA,
  TIPOS_DOCUMENTO,
  TIPOS_ITEM,
  diaMes,
  noites,
  quantidadeExtra,
  type FormaPagamentoHotel,
  type StatusReserva,
} from "./rotulos";

const moeda = (v: number | string | null | undefined) => formatarMoeda(v ?? 0);

/** Tons das linhas e do zebrado das tabelas (nos documentos do hotel, derivados da cor escolhida). */
export interface TonsTabela {
  linha: string;
  zebra: string;
  cinza: string;
  /** Valor em aberto (vermelho; no modelo econômico, preto). */
  alerta: string;
}
const TONS_PADRAO: TonsTabela = { linha: COR.begeForte, zebra: "#faf6f1", cinza: COR.cinza, alerta: COR.vermelho };

function tabela(cab: string[], linhas: TableCell[][], widths: (string | number)[], direita: number[] = [], tons: TonsTabela = TONS_PADRAO): Content {
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
      hLineColor: () => tons.linha,
      paddingTop: () => 3,
      paddingBottom: () => 3,
      fillColor: (i: number) => (i > 0 && i % 2 === 0 ? tons.zebra : null),
    },
    fontSize: 8.5,
    margin: [0, 0, 0, 8],
  };
}

/** Pares rótulo/valor em duas colunas. */
function campos(pares: [string, string | null | undefined][], tons: TonsTabela = TONS_PADRAO): Content {
  const linhas = pares.filter(([, v]) => v !== undefined).map(([r, v]) => [{ text: r, color: tons.cinza }, { text: v || "—", bold: true }] as TableCell[]);
  return { table: { widths: [130, "*"], body: linhas }, layout: "noBorders", fontSize: 9, margin: [0, 0, 0, 6] };
}

type Hospede = NonNullable<ReservaCompleta["reserva"]["hospede"]>;

function documentoDe(h: Pick<Hospede, "cpf" | "documento" | "documento_tipo">) {
  if (h.cpf) return `CPF ${formatarCpf(h.cpf)}`;
  if (h.documento) return `${TIPOS_DOCUMENTO[h.documento_tipo ?? "outro"] ?? "Documento"} ${h.documento}`;
  return null;
}

/** Ficha de registro do hóspede (dados da FNRH), para conferência e assinatura. */
export function blocosFicha(c: ReservaCompleta, tons: TonsTabela = TONS_PADRAO): Content[] {
  const r = c.reserva;
  const h = r.hospede;
  if (!h) return [];
  const blocos: Content[] = [
    { text: "Hóspede", style: "secao" },
    campos(
      [
        ["Nome", h.nome],
        ["Documento", documentoDe(h)],
        ["Data de nascimento", h.nascimento ? formatarData(h.nascimento) : null],
        ["Gênero", h.genero ? GENEROS[h.genero] : null],
        ["Nacionalidade", h.nacionalidade],
        ["Profissão", h.profissao],
        ["Telefone", h.telefone ? formatarTelefone(h.telefone) : null],
        ["E-mail", h.email],
        ["Endereço", h.endereco],
        ["Cidade / UF / País", [h.cidade, h.uf, h.pais].filter(Boolean).join(" / ") || null],
        ["CEP", h.cep ? formatarCep(h.cep) : null],
      ],
      tons,
    ),
    { text: "Estadia", style: "secao" },
    campos(
      [
        ["Reserva", `nº ${r.numero} — ${STATUS_RESERVA[r.status as StatusReserva]}`],
        ["Quarto", `${r.quarto?.numero ?? ""} — ${r.categoria?.nome ?? ""}`],
        ["Entrada", r.checkin_em ? formatarDataHora(r.checkin_em) : formatarData(r.entrada)],
        ["Saída prevista", formatarData(r.saida_prevista ?? r.saida)],
        ["Pessoas", `${r.adultos} adulto(s)${r.criancas ? ` e ${r.criancas} criança(s)` : ""}`],
        ["Motivo da viagem", r.motivo_viagem ? MOTIVOS_VIAGEM[r.motivo_viagem] : null],
        ["Meio de transporte", r.meio_transporte ? MEIOS_TRANSPORTE[r.meio_transporte] : null],
        ["Placa do veículo", r.placa_veiculo],
        ["Última procedência", r.procedencia],
        ["Próximo destino", r.destino],
      ],
      tons,
    ),
  ];
  if (c.acompanhantes.length) {
    blocos.push(
      { text: "Acompanhantes", style: "secao" },
      tabela(
        ["Nome", "Documento", "Nascimento"],
        c.acompanhantes.map((a) => [a.nome, documentoDe(a) ?? "—", a.nascimento ? formatarData(a.nascimento) : "—"]),
        ["*", 150, 80],
        [],
        tons,
      ),
    );
  }
  blocos.push(
    {
      text: "Declaro que as informações acima são verdadeiras.",
      margin: [0, 24, 0, 30],
    },
    {
      columns: [
        { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.6 }] }, { text: "Assinatura do hóspede", fontSize: 8, color: tons.cinza, margin: [0, 3, 0, 0] }] },
        { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.6 }] }, { text: "Recepção", fontSize: 8, color: tons.cinza, margin: [0, 3, 0, 0] }] },
      ],
    },
    {
      text: "Dados pedidos na Ficha Nacional de Registro de Hóspedes (Lei nº 11.771/2008), usados só para o registro da hospedagem e guardados pelo hotel.",
      style: "nota",
      margin: [0, 18, 0, 0],
    },
  );
  return blocos;
}

/** Confirmação da reserva (antes do check-in), extrato (hospedado) ou recibo (encerrada). */
export function blocosConta(
  c: ReservaCompleta,
  cfg: { hora_checkin: string; hora_checkout: string; cafe_incluso: boolean; politica: string | null } | null,
  tons: TonsTabela = TONS_PADRAO,
): Content[] {
  const r = c.reserva;
  const status = r.status as StatusReserva;
  const resumo = c.resumo;
  const aguardando = status === "pre_reserva" || status === "confirmada";
  const blocos: Content[] = [
    campos(
      [
        ["Hóspede", r.hospede?.nome],
        ["Quarto", `${r.quarto?.numero ?? ""} — ${r.categoria?.nome ?? ""}`],
        ["Estadia", `${formatarData(r.entrada)} a ${formatarData(r.saida)} (${noites(r.entrada, r.saida)} noite${noites(r.entrada, r.saida) > 1 ? "s" : ""})`],
        ["Pessoas", `${r.adultos} adulto(s)${r.criancas ? ` e ${r.criancas} criança(s)` : ""}`],
        ["Origem", ORIGENS[r.origem] ?? r.origem],
        ...(r.faturar ? ([["Faturar para", r.faturar.nome]] as [string, string][]) : []),
      ],
      tons,
    ),
  ];
  if (aguardando) {
    blocos.push(
      { text: "Valores previstos", style: "secao" },
      campos(
        [
          ["Diárias", `${resumo?.noites_previstas ?? 0} × ${r.diaria_acordada ? `${moeda(r.diaria_acordada)} (acordada)` : "tabela"} = ${moeda(resumo?.diarias_previstas)}`],
          ["Sinal recebido", moeda(resumo?.pago)],
          ["A pagar na estadia", moeda(Math.max((resumo?.total_previsto ?? 0) - (resumo?.pago ?? 0), 0))],
        ],
        tons,
      ),
    );
    if (cfg) {
      blocos.push(
        { text: "Informações", style: "secao" },
        campos(
          [
            ["Check-in", `a partir das ${cfg.hora_checkin.slice(0, 5)}`],
            ["Check-out", `até as ${cfg.hora_checkout.slice(0, 5)}`],
            ["Café da manhã", cfg.cafe_incluso ? "incluso na diária" : "não incluso"],
          ],
          tons,
        ),
      );
      if (cfg.politica) blocos.push({ text: cfg.politica, fontSize: 8.5, margin: [0, 0, 0, 6] });
    }
    return blocos;
  }
  const itens = c.itens.filter((i) => !i.cancelado_em);
  const linhas: TableCell[][] = [];
  if (status === "hospedado" && resumo && resumo.noites > 0) {
    linhas.push([diaMes(r.entrada), `${resumo.noites} diária(s) até hoje — lançadas no check-out`, String(resumo.noites), "", moeda(resumo.diarias)]);
  }
  for (const i of itens) {
    const qtd = Number(i.quantidade);
    const detalhe = i.tipo === "diaria" ? "" : `${TIPOS_ITEM[i.tipo]}${i.setor ? ` · ${SETORES[i.setor] ?? i.setor}` : ""}`;
    linhas.push([
      diaMes(i.data),
      { text: [i.descricao, detalhe ? { text: `  ${detalhe}`, color: tons.cinza, fontSize: 7.5 } : ""] },
      qtd.toLocaleString("pt-BR", { maximumFractionDigits: 3 }),
      qtd === 1 || !Number(i.valor_unitario) ? "" : moeda(i.valor_unitario),
      moeda(i.total),
    ]);
  }
  if (status === "hospedado" && resumo && resumo.taxa_servico > 0) linhas.push(["", "Taxa de serviço sobre o consumo (lançada no check-out)", "", "", moeda(resumo.taxa_servico)]);
  linhas.push([
    { text: "", border: [false, false, false, false] },
    { text: status === "encerrada" ? "Total da conta" : "Total se sair hoje", bold: true },
    "",
    "",
    { text: moeda(resumo?.total), bold: true, alignment: "right" },
  ]);
  blocos.push({ text: "Lançamentos", style: "secao" }, tabela(["Data", "Descrição", "Qtd.", "Preço unit.", "Valor"], linhas, [36, "*", 38, 60, 66], [2, 3, 4], tons));
  const pagos = c.pagamentos.filter((p) => !p.cancelado_em);
  blocos.push(
    { text: "Pagamentos", style: "secao" },
    pagos.length
      ? tabela(
          ["Data", "Forma", "Valor"],
          pagos.map((p) => [
            diaMes(p.data),
            `${FORMAS_PAGAMENTO_HOTEL[p.forma as FormaPagamentoHotel] ?? p.forma}${p.adiantamento ? " (sinal)" : ""}${p.forma === "faturado" ? ` — ${p.contraparte?.nome ?? ""}, vence ${p.vencimento ? formatarData(p.vencimento) : ""}` : ""}`,
            moeda(p.valor),
          ]),
          [36, "*", 66],
          [2],
          tons,
        )
      : { text: "Nenhum pagamento registrado.", color: tons.cinza, margin: [0, 0, 0, 8] },
    {
      text: [
        { text: (resumo?.saldo ?? 0) > 0 ? "Falta receber: " : (resumo?.saldo ?? 0) < 0 ? "Pago a mais: " : "Conta quitada. ", bold: true },
        (resumo?.saldo ?? 0) !== 0 ? { text: moeda(Math.abs(resumo?.saldo ?? 0)), bold: true, color: tons.alerta } : { text: "" },
      ],
      fontSize: 11,
      margin: [0, 6, 0, 0],
    },
  );
  return blocos;
}

/** Recibo de serviços extras lançados para uma empresa (pago na hora ou a prazo). */
export function blocosReciboExtra(r: ReciboExtra, hotel: string, tons: TonsTabela = TONS_PADRAO): Content[] {
  const cancelado = r.situacao === "cancelado";
  const pago = r.situacao === "pago";
  const empresa = `${r.empresa}${r.documento ? ` — ${r.documento.length === 14 ? "CNPJ" : "CPF"} ${formatarDocumento(r.documento)}` : ""}`;
  const formaPaga = r.forma ? (FORMAS_PAGAMENTO_HOTEL[r.forma as FormaPagamentoHotel] ?? r.forma) : null;
  const pagamento =
    r.pagamento === "na_hora"
      ? `Pago na hora — ${formaPaga}`
      : `A prazo — vencimento ${r.vencimento ? formatarData(r.vencimento) : ""}${
          pago ? ` (pago${r.pago_em ? ` em ${formatarData(r.pago_em)}` : ""})` : r.situacao === "vencido" ? " (vencido)" : r.situacao === "parcial" ? " (pago em parte)" : " (a receber)"
        }`;
  const blocos: Content[] = [];
  if (cancelado) {
    blocos.push({
      text: [{ text: "RECIBO CANCELADO", bold: true }, r.motivo_cancelamento ? `  —  ${r.motivo_cancelamento}` : ""],
      color: tons.alerta,
      fontSize: 11,
      margin: [0, 0, 0, 8],
    });
  }
  blocos.push(
    campos(
      [
        ["Empresa", empresa],
        ["Pedido por", r.solicitante ?? undefined],
        ["Data do serviço", formatarData(r.data)],
        ["Pagamento", pagamento],
        ["Lançado por", r.lancado_por ?? undefined],
      ],
      tons,
    ),
  );
  const linhas: TableCell[][] = r.itens.map((i) => [i.descricao, quantidadeExtra(i.quantidade, i.unidade), moeda(i.valor_unitario), moeda(i.total)]);
  linhas.push([{ text: "Total", bold: true }, "", "", { text: moeda(r.total), bold: true, alignment: "right" }]);
  blocos.push({ text: "Serviços", style: "secao" }, tabela(["Serviço", "Quantidade", "Preço unit.", "Valor"], linhas, ["*", 90, 70, 70], [2, 3], tons));
  if (!cancelado) {
    const declaracao = pago
      ? `Recebemos de ${r.empresa} a importância de ${moeda(r.total)} (${valorPorExtenso(r.total)}), referente aos serviços acima.`
      : `Serviços prestados a ${r.empresa} no valor de ${moeda(r.total)} (${valorPorExtenso(r.total)}), a pagar até ${r.vencimento ? formatarData(r.vencimento) : ""}.`;
    blocos.push(
      { text: declaracao, fontSize: 10, margin: [0, 8, 0, 36] },
      {
        columns: [
          { width: "*", text: "" },
          {
            width: 240,
            stack: [
              { canvas: [{ type: "line", x1: 0, y1: 0, x2: 240, y2: 0, lineWidth: 0.6, lineColor: tons.cinza }] },
              { text: hotel, alignment: "center", fontSize: 9, margin: [0, 4, 0, 0] },
            ],
          },
          { width: "*", text: "" },
        ],
      },
    );
  }
  return blocos;
}

/** Relatório mensal do hotel. */
export function blocosRelatorio(rel: RelatorioHotel, mes: string): Content[] {
  const i = rel.indicadores;
  const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const nome = `${nomeMes(Number(mes.slice(5, 7)))} de ${mes.slice(0, 4)}`;
  return [
    {
      text: `Em ${nome}, o hotel teve ${pct(i.ocupacao)} de ocupação (${i.noitesVendidas} de ${i.quartosNoite} quartos-noite), diária média de ${moeda(i.diariaMedia)} e RevPAR de ${moeda(i.revpar)}.`,
      bold: true,
      fontSize: 11,
      color: COR.marrom,
      margin: [0, 2, 0, 8],
    },
    tabela(
      ["Indicador", "Valor"],
      [
        ["Quartos em uso", String(i.quartos)],
        ["Hospedagens no mês", String(i.hospedagens)],
        ["Noites ocupadas", String(i.noitesVendidas)],
        ["Taxa de ocupação", pct(i.ocupacao)],
        ["Receita de diárias", moeda(i.receitaDiarias)],
        ["Diária média (receita ÷ diárias cobradas)", moeda(i.diariaMedia)],
        ["RevPAR (receita de diárias ÷ quartos-noite)", moeda(i.revpar)],
        ["Consumo (restaurante, bar, frigobar) e taxa de serviço", moeda(i.receitaConsumo)],
        ["Serviços e descontos", moeda(i.receitaServicos)],
        ...i.porServico.map((sv) => [{ text: `   ${SETORES[sv.setor] ?? sv.setor}`, color: COR.cinza } as TableCell, moeda(sv.total)]),
        ["Cancelamentos / não comparecimentos", `${i.canceladas} / ${i.noShow}`],
        ["Recebido (Financeiro)", moeda(rel.recebidoTotal)],
        ["Faturado para empresas (a receber)", moeda(rel.aReceber)],
      ],
      ["*", 120],
      [1],
    ),
    { text: "Origem das reservas", style: "secao" },
    tabela(
      ["Origem", "Reservas", "Noites"],
      i.porOrigem.map((o) => [ORIGENS[o.origem] ?? o.origem, String(o.reservas), String(o.noites)]),
      ["*", 60, 60],
      [1, 2],
    ),
    { text: "Por categoria de quarto", style: "secao" },
    tabela(
      ["Categoria", "Noites", "Receita de diárias"],
      i.porCategoria.map((c) => [c.categoria, String(c.noites), moeda(c.receita)]),
      ["*", 60, 100],
      [1, 2],
    ),
    { text: "Recebimentos por forma de pagamento", style: "secao" },
    tabela(
      ["Forma", "Quantidade", "Valor"],
      rel.recebido.map((r) => [FORMAS_PAGAMENTO_HOTEL[r.forma as FormaPagamentoHotel] ?? r.forma, String(r.quantidade), moeda(r.valor)]),
      ["*", 60, 100],
      [1, 2],
    ),
  ];
}
