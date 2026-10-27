import "server-only";
import type { Content, TableCell } from "pdfmake/interfaces";
import { COR } from "@/lib/relatorios/pdf";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCep, formatarCpf, formatarData, formatarDataHora, formatarTelefone, nomeMes } from "@/lib/formatos";
import type { ReservaCompleta } from "./dados";
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
  type FormaPagamentoHotel,
  type StatusReserva,
} from "./rotulos";

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
    fontSize: 8.5,
    margin: [0, 0, 0, 8],
  };
}

/** Pares rótulo/valor em duas colunas. */
function campos(pares: [string, string | null | undefined][]): Content {
  const linhas = pares.filter(([, v]) => v !== undefined).map(([r, v]) => [{ text: r, color: COR.cinza }, { text: v || "—", bold: true }] as TableCell[]);
  return { table: { widths: [130, "*"], body: linhas }, layout: "noBorders", fontSize: 9, margin: [0, 0, 0, 6] };
}

type Hospede = NonNullable<ReservaCompleta["reserva"]["hospede"]>;

function documentoDe(h: Pick<Hospede, "cpf" | "documento" | "documento_tipo">) {
  if (h.cpf) return `CPF ${formatarCpf(h.cpf)}`;
  if (h.documento) return `${TIPOS_DOCUMENTO[h.documento_tipo ?? "outro"] ?? "Documento"} ${h.documento}`;
  return null;
}

/** Ficha de registro do hóspede (dados da FNRH), para conferência e assinatura. */
export function blocosFicha(c: ReservaCompleta): Content[] {
  const r = c.reserva;
  const h = r.hospede;
  if (!h) return [];
  const blocos: Content[] = [
    { text: "Hóspede", style: "secao" },
    campos([
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
    ]),
    { text: "Estadia", style: "secao" },
    campos([
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
    ]),
  ];
  if (c.acompanhantes.length) {
    blocos.push(
      { text: "Acompanhantes", style: "secao" },
      tabela(
        ["Nome", "Documento", "Nascimento"],
        c.acompanhantes.map((a) => [a.nome, documentoDe(a) ?? "—", a.nascimento ? formatarData(a.nascimento) : "—"]),
        ["*", 150, 80],
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
        { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.6 }] }, { text: "Assinatura do hóspede", fontSize: 8, color: COR.cinza, margin: [0, 3, 0, 0] }] },
        { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.6 }] }, { text: "Recepção", fontSize: 8, color: COR.cinza, margin: [0, 3, 0, 0] }] },
      ],
    },
    {
      text: "Dados pedidos na Ficha Nacional de Registro de Hóspedes (Lei nº 11.771/2008), usados só para o registro da hospedagem e guardados pelo hotel. O envio ao sistema do Ministério do Turismo é feito pelo próprio hotel, fora do portal.",
      style: "nota",
      margin: [0, 18, 0, 0],
    },
  );
  return blocos;
}

/** Confirmação da reserva (antes do check-in), extrato (hospedado) ou recibo (encerrada). */
export function blocosConta(c: ReservaCompleta, cfg: { hora_checkin: string; hora_checkout: string; cafe_incluso: boolean; politica: string | null } | null): Content[] {
  const r = c.reserva;
  const status = r.status as StatusReserva;
  const resumo = c.resumo;
  const aguardando = status === "pre_reserva" || status === "confirmada";
  const blocos: Content[] = [
    campos([
      ["Hóspede", r.hospede?.nome],
      ["Quarto", `${r.quarto?.numero ?? ""} — ${r.categoria?.nome ?? ""}`],
      ["Estadia", `${formatarData(r.entrada)} a ${formatarData(r.saida)} (${noites(r.entrada, r.saida)} noite${noites(r.entrada, r.saida) > 1 ? "s" : ""})`],
      ["Pessoas", `${r.adultos} adulto(s)${r.criancas ? ` e ${r.criancas} criança(s)` : ""}`],
      ["Origem", ORIGENS[r.origem] ?? r.origem],
      ...(r.faturar ? ([["Faturar para", r.faturar.nome]] as [string, string][]) : []),
    ]),
  ];
  if (aguardando) {
    blocos.push(
      { text: "Valores previstos", style: "secao" },
      campos([
        ["Diárias", `${resumo?.noites_previstas ?? 0} × ${r.diaria_acordada ? `${moeda(r.diaria_acordada)} (acordada)` : "tabela"} = ${moeda(resumo?.diarias_previstas)}`],
        ["Sinal recebido", moeda(resumo?.pago)],
        ["A pagar na estadia", moeda(Math.max((resumo?.total_previsto ?? 0) - (resumo?.pago ?? 0), 0))],
      ]),
    );
    if (cfg) {
      blocos.push(
        { text: "Informações", style: "secao" },
        campos([
          ["Check-in", `a partir das ${cfg.hora_checkin.slice(0, 5)}`],
          ["Check-out", `até as ${cfg.hora_checkout.slice(0, 5)}`],
          ["Café da manhã", cfg.cafe_incluso ? "incluso na diária" : "não incluso"],
        ]),
      );
      if (cfg.politica) blocos.push({ text: cfg.politica, fontSize: 8.5, margin: [0, 0, 0, 6] });
    }
    return blocos;
  }
  const itens = c.itens.filter((i) => !i.cancelado_em);
  const linhas: TableCell[][] = [];
  if (status === "hospedado" && resumo && resumo.noites > 0) {
    linhas.push([diaMes(r.entrada), `${resumo.noites} diária(s) até hoje — lançadas no check-out`, String(resumo.noites), moeda(resumo.diarias)]);
  }
  for (const i of itens) {
    linhas.push([
      diaMes(i.data),
      `${i.descricao}${i.tipo !== "diaria" ? ` (${TIPOS_ITEM[i.tipo]}${i.setor ? ` · ${SETORES[i.setor] ?? i.setor}` : ""})` : ""}`,
      Number(i.quantidade).toLocaleString("pt-BR"),
      moeda(i.total),
    ]);
  }
  if (status === "hospedado" && resumo && resumo.taxa_servico > 0) linhas.push(["", "Taxa de serviço sobre o consumo (lançada no check-out)", "", moeda(resumo.taxa_servico)]);
  linhas.push([
    { text: "", border: [false, false, false, false] },
    { text: status === "encerrada" ? "Total da conta" : "Total se sair hoje", bold: true },
    "",
    { text: moeda(resumo?.total), bold: true, alignment: "right" },
  ]);
  blocos.push({ text: "Lançamentos", style: "secao" }, tabela(["Data", "Descrição", "Qtd.", "Valor"], linhas, [40, "*", 40, 70], [2, 3]));
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
          [40, "*", 70],
          [2],
        )
      : { text: "Nenhum pagamento registrado.", color: COR.cinza, margin: [0, 0, 0, 8] },
    {
      text: [
        { text: (resumo?.saldo ?? 0) > 0 ? "Falta receber: " : (resumo?.saldo ?? 0) < 0 ? "Pago a mais: " : "Conta quitada. ", bold: true },
        (resumo?.saldo ?? 0) !== 0 ? { text: moeda(Math.abs(resumo?.saldo ?? 0)), bold: true, color: COR.vermelho } : { text: "" },
      ],
      fontSize: 11,
      margin: [0, 6, 0, 0],
    },
  );
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
