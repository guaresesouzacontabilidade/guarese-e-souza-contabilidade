import { Decimal, dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

/**
 * Indicadores de saúde financeira com regras fixas e explicação em linguagem
 * simples. Nenhum serviço externo ou inteligência artificial é usado: os textos
 * são montados a partir dos números do próprio portal.
 */
export type StatusIndicador = "bom" | "atencao" | "critico" | "sem_dados";

export interface Indicador {
  chave: string;
  titulo: string;
  valor: string;
  status: StatusIndicador;
  explicacao: string;
  detalhe?: string;
}

export interface DadosSaude {
  periodoRotulo: string;
  anteriorRotulo: string;
  receitaBruta: string;
  receitaBrutaAnterior: string;
  resultado: string;
  resultadoAnterior: string;
  saldoDisponivel: string | null;
  mediaSaidasMensais: string | null;
  aReceber30: string;
  aPagar30: string;
  receberVencido: string;
  pagarVencido: string;
  receitaTresMeses: string;
  maioresDespesas: { nome: string; valor: number }[];
  menorSaldoProjetado: { data: string; valor: string } | null;
  saldoProjetado30: string | null;
  qualidade: {
    competenciasFechadas: boolean;
    movimentosPendentes: number;
    contasSemExtrato: number;
    lancamentosSugeridos: number;
    checklistPercentual: number | null;
  };
}

const pct = (v: Decimal, casas = 0) => `${v.toFixed(casas).replace(".", ",")}%`;

function variacao(atual: Decimal, anterior: Decimal) {
  if (anterior.isZero()) return null;
  return atual.minus(anterior).dividedBy(anterior.abs()).times(100);
}

export function calcularIndicadores(d: DadosSaude): Indicador[] {
  const r: Indicador[] = [];
  const receita = dec(d.receitaBruta);
  const resultado = dec(d.resultado);

  // 1) Resultado e margem
  if (receita.isZero() && resultado.isZero()) {
    r.push({ chave: "resultado", titulo: "Resultado do período", valor: "—", status: "sem_dados", explicacao: "Ainda não há receitas ou despesas confirmadas neste período." });
  } else {
    const margem = receita.isZero() ? null : resultado.dividedBy(receita).times(100);
    const status: StatusIndicador = resultado.isNegative() ? "critico" : margem && margem.greaterThanOrEqualTo(10) ? "bom" : "atencao";
    r.push({
      chave: "resultado",
      titulo: resultado.isNegative() ? "Prejuízo do período" : "Lucro do período",
      valor: formatarMoeda(resultado),
      status,
      detalhe: margem ? `Margem de ${pct(margem, 1)}` : undefined,
      explicacao: resultado.isNegative()
        ? `As despesas superaram as receitas em ${formatarMoeda(resultado.abs())}.`
        : margem
          ? `De cada R$ 100,00 vendidos, sobraram ${formatarMoeda(margem)} depois de custos, despesas e impostos.`
          : "Resultado positivo sem receita de vendas no período.",
    });
  }

  // 2) Fôlego de caixa
  if (d.saldoDisponivel === null) {
    r.push({ chave: "folego", titulo: "Fôlego de caixa", valor: "—", status: "sem_dados", explicacao: "Informe o saldo inicial das contas para calcular o caixa disponível." });
  } else {
    const saldo = dec(d.saldoDisponivel);
    const media = d.mediaSaidasMensais ? dec(d.mediaSaidasMensais) : null;
    if (!media || media.isZero()) {
      r.push({ chave: "folego", titulo: "Fôlego de caixa", valor: formatarMoeda(saldo), status: saldo.isNegative() ? "critico" : "sem_dados", explicacao: "Ainda não há pagamentos suficientes para estimar quantos meses o caixa cobre." });
    } else {
      const meses = saldo.dividedBy(media);
      const status: StatusIndicador = meses.greaterThanOrEqualTo(3) ? "bom" : meses.greaterThanOrEqualTo(1) ? "atencao" : "critico";
      r.push({
        chave: "folego",
        titulo: "Fôlego de caixa",
        valor: saldo.isNegative() ? "Caixa negativo" : `${meses.toFixed(1).replace(".", ",")} ${meses.greaterThanOrEqualTo(1.95) || meses.lessThan(1) ? "meses" : "mês"}`,
        status: saldo.isNegative() ? "critico" : status,
        detalhe: `Saldo disponível ${formatarMoeda(saldo)}`,
        explicacao: saldo.isNegative()
          ? "O saldo disponível está negativo: a empresa depende de limite bancário ou de novas entradas."
          : `Com o dinheiro disponível hoje, a empresa pagaria cerca de ${meses.toFixed(1).replace(".", ",")} mês(es) de despesas (média de ${formatarMoeda(media)} por mês) sem novas entradas.`,
      });
    }
  }

  // 3) Capacidade de pagamento nos próximos 30 dias
  const pagar30 = dec(d.aPagar30);
  if (d.saldoDisponivel !== null) {
    const recursos = dec(d.saldoDisponivel).plus(d.aReceber30);
    if (pagar30.isZero()) {
      r.push({ chave: "liquidez", titulo: "Contas dos próximos 30 dias", valor: "Sem contas", status: "bom", explicacao: "Não há contas a pagar registradas para os próximos 30 dias." });
    } else {
      const indice = recursos.dividedBy(pagar30);
      const status: StatusIndicador = indice.greaterThanOrEqualTo(1.2) ? "bom" : indice.greaterThanOrEqualTo(1) ? "atencao" : "critico";
      r.push({
        chave: "liquidez",
        titulo: "Contas dos próximos 30 dias",
        valor: `${formatarMoeda(indice, { semSimbolo: true })} para cada R$ 1`,
        status,
        detalhe: `A pagar ${formatarMoeda(pagar30)} · saldo + a receber ${formatarMoeda(recursos)}`,
        explicacao:
          status === "critico"
            ? "O saldo atual somado ao que há para receber não cobre as contas dos próximos 30 dias."
            : `Para cada R$ 1,00 a pagar nos próximos 30 dias, a empresa tem ${formatarMoeda(indice)} entre saldo e valores a receber.`,
      });
    }
  }

  // 4) Inadimplência de clientes
  const vencido = dec(d.receberVencido);
  const base = dec(d.receitaTresMeses);
  if (vencido.isZero()) {
    r.push({ chave: "inadimplencia", titulo: "Clientes em atraso", valor: "Nenhum", status: "bom", explicacao: "Não há valores a receber vencidos." });
  } else {
    const taxa = base.isZero() ? null : vencido.dividedBy(base).times(100);
    const status: StatusIndicador = !taxa || taxa.greaterThan(15) ? "critico" : taxa.greaterThan(5) ? "atencao" : "bom";
    r.push({
      chave: "inadimplencia",
      titulo: "Clientes em atraso",
      valor: formatarMoeda(vencido),
      status,
      detalhe: taxa ? `${pct(taxa, 1)} do faturamento dos últimos 3 meses` : undefined,
      explicacao: "Valores de vendas já vencidos e ainda não recebidos. Quanto maior, mais dinheiro parado fora do caixa.",
    });
  }

  // 5) Contas a pagar vencidas
  const pagarVencido = dec(d.pagarVencido);
  r.push(
    pagarVencido.isZero()
      ? { chave: "atrasos", titulo: "Contas a pagar vencidas", valor: "Nenhuma", status: "bom", explicacao: "Todas as contas a pagar estão em dia." }
      : {
          chave: "atrasos",
          titulo: "Contas a pagar vencidas",
          valor: formatarMoeda(pagarVencido),
          status: pagarVencido.greaterThan(dec(d.saldoDisponivel ?? 0)) ? "critico" : "atencao",
          explicacao: "Contas vencidas geram juros e multas. Confira se já foram pagas e se o pagamento foi registrado.",
        },
  );

  // 6) Confiabilidade dos dados
  const q = d.qualidade;
  const faltas: string[] = [];
  if (q.movimentosPendentes) faltas.push(`${q.movimentosPendentes} movimentação(ões) bancária(s) sem conciliar`);
  if (q.contasSemExtrato) faltas.push(`${q.contasSemExtrato} conta(s) sem extrato no período`);
  if (q.lancamentosSugeridos) faltas.push(`${q.lancamentosSugeridos} lançamento(s) sugerido(s) aguardando confirmação`);
  if (q.checklistPercentual !== null && q.checklistPercentual < 100) faltas.push(`documentos do mês ${q.checklistPercentual}% completos`);
  r.push({
    chave: "dados",
    titulo: "Confiabilidade dos números",
    valor: q.competenciasFechadas ? "Mês fechado" : faltas.length ? "Preliminar" : "Em dia",
    status: q.competenciasFechadas ? "bom" : faltas.length ? "atencao" : "bom",
    explicacao: q.competenciasFechadas
      ? "O período foi conferido e fechado pelo escritório."
      : faltas.length
        ? `Os números ainda podem mudar: ${faltas.join("; ")}.`
        : "Os dados estão completos, mas o período ainda não foi fechado pelo escritório.",
  });
  return r;
}

/** Resumo executivo em texto simples, montado a partir dos números. */
export function resumoExecutivo(d: DadosSaude): string[] {
  const p: string[] = [];
  const receita = dec(d.receitaBruta);
  const receitaAnt = dec(d.receitaBrutaAnterior);
  const resultado = dec(d.resultado);
  const v = variacao(receita, receitaAnt);
  if (receita.isZero()) p.push(`Em ${d.periodoRotulo}, não houve receitas confirmadas.`);
  else {
    const comp = v === null ? "" : v.abs().lessThan(1) ? `, praticamente igual a ${d.anteriorRotulo}` : `, ${pct(v.abs())} ${v.isPositive() ? "acima" : "abaixo"} de ${d.anteriorRotulo}`;
    p.push(`Em ${d.periodoRotulo}, a receita bruta foi de ${formatarMoeda(receita)}${comp}.`);
  }
  if (!receita.isZero() || !resultado.isZero()) {
    const margem = receita.isZero() ? null : resultado.dividedBy(receita).times(100);
    p.push(
      resultado.isNegative()
        ? `O período terminou com prejuízo de ${formatarMoeda(resultado.abs())}.`
        : `O resultado foi um lucro de ${formatarMoeda(resultado)}${margem ? ` (margem de ${pct(margem, 1)})` : ""}.`,
    );
  }
  if (d.maioresDespesas.length) {
    const lista = d.maioresDespesas.filter((x) => x.nome !== "Outras").slice(0, 3).map((x) => `${x.nome.toLowerCase()} (${formatarMoeda(x.valor)})`);
    if (lista.length) p.push(`Os maiores gastos foram com ${lista.length > 1 ? `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}` : lista[0]}.`);
  }
  if (d.saldoDisponivel !== null) {
    const saldo = dec(d.saldoDisponivel);
    const media = d.mediaSaidasMensais ? dec(d.mediaSaidasMensais) : null;
    p.push(
      saldo.isNegative()
        ? `O saldo disponível hoje está negativo em ${formatarMoeda(saldo.abs())}.`
        : `O saldo disponível hoje é de ${formatarMoeda(saldo)}${media && !media.isZero() ? `, suficiente para cerca de ${saldo.dividedBy(media).toFixed(1).replace(".", ",")} mês(es) de despesas` : ""}.`,
    );
  }
  const receber = dec(d.aReceber30);
  const pagar = dec(d.aPagar30);
  if (!receber.isZero() || !pagar.isZero()) {
    let t = `Nos próximos 30 dias estão previstos ${formatarMoeda(receber)} a receber e ${formatarMoeda(pagar)} a pagar`;
    if (d.saldoProjetado30 !== null) t += `; o saldo projetado é de ${formatarMoeda(d.saldoProjetado30)}`;
    p.push(`${t}.`);
  }
  if (d.menorSaldoProjetado && dec(d.menorSaldoProjetado.valor).isNegative()) {
    p.push(`Atenção: pela previsão, o caixa pode ficar negativo em ${formatarData(d.menorSaldoProjetado.data)} (${formatarMoeda(d.menorSaldoProjetado.valor)}). Vale antecipar recebimentos ou renegociar vencimentos.`);
  }
  if (!dec(d.receberVencido).isZero()) p.push(`Há ${formatarMoeda(d.receberVencido)} a receber em atraso.`);
  if (!dec(d.pagarVencido).isZero()) p.push(`Há ${formatarMoeda(d.pagarVencido)} em contas a pagar vencidas.`);
  if (!d.qualidade.competenciasFechadas) p.push("Estes números são preliminares: o período ainda não foi fechado e revisado pelo escritório.");
  return p;
}
