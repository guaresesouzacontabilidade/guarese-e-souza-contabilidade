/**
 * Robô de planejamento tributário: os estudos de uma empresa a partir dos
 * dados do portal (mesmos dados e contas da previsão de impostos, do
 * comparativo de regimes e do auditor fiscal). Sem acesso ao banco: recebe os
 * dados e devolve os estudos prontos para gravar. Cada estudo diz o que falta
 * quando os dados não bastam, em vez de chutar.
 */
import Decimal from "decimal.js";
import { compararRegimes, REGIMES_COMPARADOS, textoPercentual } from "@/lib/calculos/comparativo";
import { dasSimples, fatorR12Meses, receitaBruta12Meses, receitaDoMes, type DadosPrevisao, type ParametrosCalculo } from "@/lib/calculos/previsao";
import { SIMPLES } from "@/lib/calculos/tabelas";
import { diasEntre, somarMeses } from "@/lib/competencia";
import { centavos, dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";

import type { EstadoEstudo, TipoEstudo } from "./rotulos";
export type { EstadoEstudo, TipoEstudo } from "./rotulos";
export { TIPOS_ESTUDO } from "./rotulos";

export interface Passo {
  rotulo: string;
  valor: string;
}

export interface Estudo {
  tipo: TipoEstudo;
  estado: EstadoEstudo;
  titulo: string;
  resumo: string;
  /** Economia estimada por ano (texto decimal, ex.: "1234.56"). */
  economia_anual: string | null;
  /** Valor a recuperar de uma vez (imposto pago a mais). */
  valor_unico: string | null;
  detalhes: { passos: Passo[]; avisos: string[]; links: { rotulo: string; href: string }[] };
  faltando: string[];
}

export interface AchadoAuditor {
  regra: string;
  titulo: string;
  competencia: string;
  valor: string | number | null;
  situacao: string;
  confianca: string;
}

export interface DadosEstudo {
  previsao: DadosPrevisao;
  auditor: { ultima_execucao: string | null; tem_notas: boolean; achados: AchadoAuditor[] };
}

/** Abaixo disso por ano, a diferença não vira oportunidade (fica como "nada a fazer"). */
export const MINIMO_ANUAL = new Decimal(1200);
/** Contribuição do sócio ao INSS sobre o pró-labore (contribuinte individual). */
const INSS_PRO_LABORE = new Decimal("0.11");
const CEM = new Decimal(100);

const moeda = (v: Decimal) => formatarMoeda(centavos(v));
const txt = (v: Decimal | null) => (v === null ? null : centavos(v).toFixed(2));
const juntar = (l: string[]) => (l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`);
const unicos = (l: string[]) => [...new Set(l)];

function estudo(tipo: TipoEstudo, estado: EstadoEstudo, titulo: string, resumo: string, extra: Partial<Estudo> = {}): Estudo {
  return {
    tipo,
    estado,
    titulo,
    resumo,
    economia_anual: null,
    valor_unico: null,
    faltando: [],
    ...extra,
    detalhes: { passos: [], avisos: [], links: [], ...(extra.detalhes ?? {}) },
  };
}

function mesesAte(ate: string, n = 12) {
  return Array.from({ length: n }, (_, i) => somarMeses(ate, i - (n - 1)));
}

function receitaPorMes(d: DadosPrevisao) {
  const porMes = new Map(d.meses.map((m) => [`${String(m.competencia).slice(0, 7)}-01`, m]));
  return (c: string) => receitaDoMes(porMes.get(c));
}

// -----------------------------------------------------------------------------
// 1. Regime mais barato
// -----------------------------------------------------------------------------
function estudoRegime(d: DadosPrevisao, ate: string, base: string): Estudo {
  const links = [
    { rotulo: "Abrir o comparativo de regimes", href: `${base}/calculos/comparativo?ate=${ate.slice(0, 7)}` },
    { rotulo: "Configuração dos cálculos", href: `${base}/calculos/configuracao` },
  ];
  const p = d.parametros;
  if (!p) {
    return estudo("regime", "faltam_dados", "Falta a configuração dos cálculos", "Para comparar Simples, Presumido e Real, o robô precisa da configuração dos cálculos desta empresa.", {
      faltando: ["configuração dos cálculos (anexos do Simples, presunção, ISS, RAT/FAP e pró-labore)"],
      detalhes: { passos: [], avisos: [], links },
    });
  }
  const atualCodigo = d.empresa.regime;
  if (!atualCodigo || !(REGIMES_COMPARADOS as readonly string[]).includes(atualCodigo)) {
    return estudo(
      "regime",
      "nada_a_fazer",
      "Regime atual fora do comparativo",
      `O regime atual (${atualCodigo ? (REGIMES[atualCodigo] ?? atualCodigo) : "não informado"}) não entra no comparativo automático (Simples, Presumido e Real).`,
      { detalhes: { passos: [], avisos: [], links } },
    );
  }
  const c = compararRegimes(d, ate, {
    margemLucro: p.margem_lucro != null ? dec(p.margem_lucro) : null,
    aliquotaIcms: p.aliquota_icms_media != null ? dec(p.aliquota_icms_media) : null,
    aliquotaIss: null,
    creditosPisCofins: p.creditos_pis_cofins,
  });
  if (c.receita.total.lte(0)) {
    return estudo("regime", "faltam_dados", "Falta a receita dos últimos 12 meses", "Sem notas de venda ou de serviço (nem receita informada) nos últimos 12 meses, não há como comparar os regimes.", {
      faltando: ["receita dos últimos 12 meses (notas de venda e de serviço, ou receita informada mês a mês)"],
      detalhes: { passos: [], avisos: c.avisos, links },
    });
  }
  const atual = c.regimes.find((r) => r.regime === atualCodigo)!;
  const passos: Passo[] = [
    { rotulo: "Período", valor: `${formatarCompetencia(c.meses[0])} a ${formatarCompetencia(c.meses[c.meses.length - 1])}` },
    { rotulo: "Receita no período", valor: moeda(c.receita.total) },
    ...c.regimes.map((r) => ({
      rotulo: `${r.rotulo}${r.regime === atualCodigo ? " (atual)" : ""}`,
      valor: r.impedimento
        ? `não pode: ${r.impedimento}`
        : r.faltando.length && !r.jaMaisCaro
          ? `incompleto: falta ${juntar(r.faltando)}`
          : `${moeda(r.total)} em 12 meses${r.carga ? ` (${textoPercentual(r.carga.times(CEM))} da receita)` : ""}${r.jaMaisCaro ? " — já passa do melhor regime" : ""}`,
    })),
  ];
  if (p.margem_lucro != null) passos.push({ rotulo: "Margem de lucro usada (Lucro Real)", valor: textoPercentual(dec(p.margem_lucro)) });
  if (p.aliquota_icms_media != null) passos.push({ rotulo: "ICMS médio usado (fora do Simples)", valor: textoPercentual(dec(p.aliquota_icms_media)) });
  const faltando = unicos(c.regimes.filter((r) => !r.impedimento && !r.jaMaisCaro).flatMap((r) => r.faltando.map((f) => `${f} (${r.rotulo})`)));
  const detalhes = { passos, avisos: c.avisos, links };

  const melhor = c.melhor ? c.regimes.find((r) => r.regime === c.melhor)! : null;
  if (melhor && c.economia && c.economia.gte(MINIMO_ANUAL)) {
    return estudo(
      "regime",
      "oportunidade",
      `Trocar para o ${melhor.rotulo} pode economizar ${moeda(c.economia)} por ano`,
      `Nos últimos 12 meses, a empresa pagou cerca de ${moeda(atual.total)} no ${atual.rotulo}; no ${melhor.rotulo} seriam ${moeda(melhor.total)}. ` +
        "A troca de regime vale para o ano seguinte e precisa ser feita no começo do ano (em janeiro). Confira as premissas antes de decidir." +
        (faltando.length ? ` Ainda não comparado por falta de dados: ${juntar(faltando)}.` : ""),
      { economia_anual: txt(c.economia), faltando, detalhes },
    );
  }
  if (atual.faltando.length || faltando.length) {
    return estudo(
      "regime",
      "faltam_dados",
      "Faltam dados para comparar todos os regimes",
      `Com o que já dá para calcular, o ${atual.rotulo} (atual) ${melhor && melhor.regime !== atual.regime ? `sairia mais caro que o ${melhor.rotulo}, mas a diferença ainda não é conclusiva` : "é o mais barato"}. Para fechar a comparação, falta: ${juntar(faltando.length ? faltando : atual.faltando)}.`,
      { faltando: faltando.length ? faltando : atual.faltando, detalhes },
    );
  }
  const dif = melhor && melhor.regime !== atual.regime && c.economia ? ` A diferença para o ${melhor.rotulo} é pequena (${moeda(c.economia)} por ano).` : "";
  return estudo("regime", "nada_a_fazer", `O ${atual.rotulo} é o regime mais barato`, `Nos últimos 12 meses, o regime atual saiu mais barato (ou quase igual) aos outros.${dif}`, {
    detalhes,
  });
}

// -----------------------------------------------------------------------------
// 2. Fator R
// -----------------------------------------------------------------------------
function estudoFatorR(d: DadosPrevisao, ate: string, base: string): Estudo {
  const links = [
    { rotulo: "Configuração (pró-labore e folha por mês)", href: `${base}/calculos/configuracao` },
    { rotulo: "Colaboradores", href: `${base}/calculos/colaboradores` },
  ];
  const regime = d.empresa.regime;
  if (regime !== "simples_nacional") {
    return estudo("fator_r", "nada_a_fazer", "Fator R não se aplica", `A empresa está no ${regime ? (REGIMES[regime] ?? regime) : "regime não informado"}; o Fator R só vale no Simples Nacional.`);
  }
  const p = d.parametros;
  if (!p) {
    return estudo("fator_r", "faltam_dados", "Falta a configuração dos cálculos", "Para estudar o Fator R, o robô precisa saber o anexo dos serviços e o pró-labore.", {
      faltando: ["configuração dos cálculos (anexo dos serviços, Fator R e pró-labore)"],
      detalhes: { passos: [], avisos: [], links },
    });
  }
  const receita = receitaPorMes(d);
  const meses = mesesAte(ate);
  const servicos12 = meses.reduce((s, m) => s.plus(receita(m).servicos), new Decimal(0));
  if (servicos12.lte(0)) {
    return estudo("fator_r", "nada_a_fazer", "Sem receita de serviços", "A empresa não teve receita de serviços nos últimos 12 meses; o Fator R não muda o imposto.");
  }
  if (p.anexo_servicos === "IV") {
    return estudo("fator_r", "nada_a_fazer", "Serviços do Anexo IV", "Os serviços do Anexo IV não usam o Fator R.");
  }
  if (!(p.anexo_servicos === "V" && p.fator_r)) {
    return estudo(
      "fator_r",
      "nada_a_fazer",
      `Serviços no Anexo ${p.anexo_servicos} sem Fator R`,
      "Pela configuração, os serviços da empresa não dependem do Fator R. Se a atividade for do Anexo V sujeita ao Fator R, marque essa opção na configuração.",
      { detalhes: { passos: [], avisos: [], links } },
    );
  }
  const f = fatorR12Meses(d, somarMeses(ate, 1));
  if (f.rbt12.lte(0)) {
    return estudo("fator_r", "faltam_dados", "Falta a receita dos últimos 12 meses", "Sem receita nos últimos 12 meses, não dá para calcular o Fator R.", {
      faltando: ["receita dos últimos 12 meses"],
      detalhes: { passos: [], avisos: [], links },
    });
  }
  if (f.folha12.lte(0)) {
    return estudo("fator_r", "faltam_dados", "Falta a folha e o pró-labore", "O Fator R compara a folha (salários e pró-labore) dos últimos 12 meses com a receita. Sem a folha, o robô não consegue calcular.", {
      faltando: ["folha de salários e pró-labore dos últimos 12 meses (colaboradores, pró-labore na configuração ou folha informada mês a mês)"],
      detalhes: { passos: [], avisos: [], links },
    });
  }
  const limite = dec(SIMPLES.fatorR).div(CEM);
  const r = f.folha12.div(f.rbt12);
  // DAS dos 12 meses com os serviços no Anexo V e no Anexo III (mesma conta da previsão)
  const comAnexo = (anexo: "III" | "V") => ({ ...d, parametros: { ...(p as ParametrosCalculo), anexo_servicos: anexo, fator_r: false } as ParametrosCalculo });
  const dasV = meses.reduce((s, m) => s.plus(dasSimples(comAnexo("V"), m).valor), new Decimal(0));
  const dasIII = meses.reduce((s, m) => s.plus(dasSimples(comAnexo("III"), m).valor), new Decimal(0));
  const diferenca = centavos(Decimal.max(0, dasV.minus(dasIII)));
  const passos: Passo[] = [
    { rotulo: "Receita bruta de 12 meses (RBT12)", valor: moeda(f.rbt12) },
    { rotulo: `Folha de 12 meses (salários com encargos e pró-labore)${f.folhaEstimada ? " — estimada" : ""}`, valor: moeda(f.folha12) },
    { rotulo: "Fator R (folha ÷ receita)", valor: `${textoPercentual(r.times(CEM), 1)} (mínimo para o Anexo III: ${SIMPLES.fatorR}%)` },
    { rotulo: "Receita de serviços em 12 meses", valor: moeda(servicos12) },
    { rotulo: "DAS de 12 meses com os serviços no Anexo V", valor: moeda(dasV) },
    { rotulo: "DAS de 12 meses com os serviços no Anexo III", valor: moeda(dasIII) },
  ];
  const avisos = f.folhaEstimada ? ["A folha foi estimada pelos colaboradores e pelo pró-labore cadastrados; informar a folha de cada mês deixa o cálculo mais preciso."] : [];
  if (r.gte(limite)) {
    if (r.lt(new Decimal("0.30"))) {
      return estudo(
        "fator_r",
        "alerta",
        `Fator R em ${textoPercentual(r.times(CEM), 1)}: perto do limite de 28%`,
        `Os serviços estão no Anexo III. Se a folha cair ou o faturamento subir, o Fator R pode ficar abaixo de 28% e os serviços vão para o Anexo V: seriam cerca de ${moeda(diferenca)} a mais por ano.`,
        { detalhes: { passos, avisos, links } },
      );
    }
    return estudo("fator_r", "nada_a_fazer", `Fator R em ${textoPercentual(r.times(CEM), 1)}: serviços no Anexo III`, "A folha já passa de 28% da receita; os serviços ficam no Anexo III, o mais barato.", {
      detalhes: { passos, avisos, links },
    });
  }
  const extraAnual = centavos(limite.times(f.rbt12).minus(f.folha12));
  const extraMensal = centavos(extraAnual.div(12));
  const custoInss = centavos(extraAnual.times(INSS_PRO_LABORE));
  const liquido = centavos(diferenca.minus(custoInss));
  passos.push(
    { rotulo: "Pró-labore a mais para chegar a 28% (por ano)", valor: moeda(extraAnual) },
    { rotulo: "Pró-labore a mais por mês", valor: moeda(extraMensal) },
    { rotulo: "INSS do sócio sobre o pró-labore a mais (11%)", valor: moeda(custoInss) },
    { rotulo: "Economia líquida por ano", valor: moeda(liquido) },
  );
  avisos.push("O pró-labore a mais também pode ter IRPF retido na fonte, conforme a tabela; confira com o sócio. Por segurança, vale ficar um pouco acima de 28%.");
  if (liquido.gte(MINIMO_ANUAL)) {
    return estudo(
      "fator_r",
      "oportunidade",
      `Aumentar o pró-labore em ${moeda(extraMensal)} por mês pode economizar ${moeda(liquido)} por ano`,
      `Hoje o Fator R está em ${textoPercentual(r.times(CEM), 1)} e os serviços ficam no Anexo V. Com a folha em 28% da receita, iriam para o Anexo III: o DAS cairia cerca de ${moeda(diferenca)} por ano, e o INSS do pró-labore a mais custaria ${moeda(custoInss)}.`,
      { economia_anual: txt(liquido), detalhes: { passos, avisos, links } },
    );
  }
  return estudo(
    "fator_r",
    "nada_a_fazer",
    "Aumentar o pró-labore não compensa agora",
    `O Fator R está em ${textoPercentual(r.times(CEM), 1)}. Chegar a 28% economizaria ${moeda(diferenca)} de DAS por ano, mas o INSS do pró-labore a mais (${moeda(custoInss)}) come quase tudo.`,
    { detalhes: { passos, avisos, links } },
  );
}

// -----------------------------------------------------------------------------
// 3. Imposto pago a mais (achados do auditor fiscal)
// -----------------------------------------------------------------------------
function estudoAuditor(a: DadosEstudo["auditor"], ate: string, hoje: string, base: string): { estudo: Estudo; pedirAuditor: boolean } {
  const links = [{ rotulo: "Abrir o auditor fiscal", href: `${base}/auditor-fiscal` }];
  const dias = a.ultima_execucao ? diasEntre(a.ultima_execucao.slice(0, 10), hoje) : null;
  const pedirAuditor = a.tem_notas && (dias === null || dias > 35);
  if (!a.tem_notas) {
    return {
      pedirAuditor,
      estudo: estudo("imposto_pago_a_mais", "faltam_dados", "Faltam as notas fiscais", "O auditor fiscal procura imposto pago a mais nas notas (XML) dos últimos 5 anos; a empresa ainda não tem notas no portal.", {
        faltando: ["notas fiscais (XML) de venda e de compra"],
        detalhes: { passos: [], avisos: [], links },
      }),
    };
  }
  if (!a.ultima_execucao) {
    return {
      pedirAuditor,
      estudo: estudo("imposto_pago_a_mais", "faltam_dados", "O auditor fiscal ainda não analisou as notas", "O robô já pediu a análise das notas; o resultado aparece aqui depois que o auditor terminar.", {
        faltando: ["análise do auditor fiscal (pedida automaticamente)"],
        detalhes: { passos: [], avisos: [], links },
      }),
    };
  }
  const inicio12 = somarMeses(ate, -11);
  const achados = a.achados.map((x) => ({ ...x, valor: dec(x.valor ?? 0) })).filter((x) => x.valor.gt(0));
  const total = achados.reduce((s, x) => s.plus(x.valor), new Decimal(0));
  const ano = achados.filter((x) => String(x.competencia).slice(0, 10) >= inicio12).reduce((s, x) => s.plus(x.valor), new Decimal(0));
  const quando = `Última análise em ${formatarData(a.ultima_execucao.slice(0, 10))}.`;
  if (total.lt(50)) {
    return {
      pedirAuditor,
      estudo: estudo("imposto_pago_a_mais", "nada_a_fazer", "Nenhum imposto pago a mais encontrado", `O auditor fiscal não encontrou imposto pago a mais nas notas da empresa. ${quando}`, {
        detalhes: { passos: [], avisos: [], links },
      }),
    };
  }
  const porTitulo = new Map<string, Decimal>();
  for (const x of achados) porTitulo.set(x.titulo, (porTitulo.get(x.titulo) ?? new Decimal(0)).plus(x.valor));
  const passos: Passo[] = [...porTitulo.entries()].sort((x, y) => y[1].comparedTo(x[1])).map(([t, v]) => ({ rotulo: t, valor: moeda(v) }));
  passos.push({ rotulo: "Total para recuperar (até 5 anos)", valor: moeda(total) }, { rotulo: "Desse total, nos últimos 12 meses", valor: moeda(ano) });
  const confirmados = achados.filter((x) => x.situacao === "confirmado" || x.situacao === "publicado").length;
  return {
    pedirAuditor,
    estudo: estudo(
      "imposto_pago_a_mais",
      "oportunidade",
      `Imposto pago a mais: ${moeda(total)} para recuperar`,
      `O auditor fiscal encontrou ${achados.length} ${achados.length === 1 ? "ponto" : "pontos"} de imposto pago a mais (ex.: produtos monofásicos ou com ST tributados de novo no DAS)` +
        `${confirmados ? `, ${confirmados} já ${confirmados === 1 ? "confirmado" : "confirmados"} pela equipe` : ""}. Nos últimos 12 meses foram ${moeda(ano)}; corrigindo, a economia continua nos próximos meses. ${quando}`,
      { valor_unico: txt(total), economia_anual: ano.gt(0) ? txt(ano) : null, detalhes: { passos, avisos: [], links } },
    ),
  };
}

// -----------------------------------------------------------------------------
// 4. Limite do Simples Nacional
// -----------------------------------------------------------------------------
function estudoLimite(d: DadosPrevisao, ate: string, base: string): Estudo {
  const links = [{ rotulo: "Previsão de impostos", href: `${base}/calculos` }];
  if (d.empresa.regime !== "simples_nacional") {
    return estudo("limite_simples", "nada_a_fazer", "Limite do Simples não se aplica", "A empresa não está no Simples Nacional.");
  }
  const receita = receitaPorMes(d);
  const ano = ate.slice(0, 4);
  const mesesAno = mesesAte(ate, Number(ate.slice(5, 7)));
  const acumulado = mesesAno.reduce((s, m) => s.plus(receita(m).total), new Decimal(0));
  const media = acumulado.div(mesesAno.length);
  const restantes = 12 - mesesAno.length;
  const projecao = acumulado.plus(media.times(restantes));
  const rbt12 = receitaBruta12Meses(d, somarMeses(ate, 1)).rbt12;
  if (acumulado.lte(0) && rbt12.lte(0)) {
    return estudo("limite_simples", "faltam_dados", "Falta a receita", "Sem receita registrada, não dá para acompanhar o limite do Simples.", {
      faltando: ["receita do ano (notas de venda e de serviço, ou receita informada)"],
      detalhes: { passos: [], avisos: [], links },
    });
  }
  const sub = dec(SIMPLES.sublimite);
  const teto = dec(SIMPLES.limite);
  const mesQuePassa = (limite: Decimal) => {
    if (acumulado.gt(limite)) return null;
    if (media.lte(0)) return null;
    for (let k = 1; k <= restantes; k++) if (acumulado.plus(media.times(k)).gt(limite)) return somarMeses(ate, k);
    return null;
  };
  const passos: Passo[] = [
    { rotulo: `Receita de janeiro a ${formatarCompetencia(ate)}`, valor: moeda(acumulado) },
    { rotulo: "Média por mês", valor: moeda(media) },
    { rotulo: `Projeção para ${ano} (mantido o ritmo)`, valor: moeda(projecao) },
    { rotulo: "Receita dos últimos 12 meses (RBT12)", valor: moeda(rbt12) },
    { rotulo: "Sublimite (ICMS e ISS saem do DAS)", valor: moeda(sub) },
    { rotulo: "Limite do Simples Nacional", valor: moeda(teto) },
  ];
  const regra = "Passando do limite no ano, a empresa sai do Simples no ano seguinte (ou já no mês seguinte, se passar mais de 20%). Passando do sublimite, o ICMS e o ISS passam a ser pagos fora do DAS.";
  const detalhes = { passos, avisos: [regra], links };
  if (acumulado.gt(teto)) {
    return estudo("limite_simples", "alerta", "Passou do limite do Simples neste ano", `A receita de ${ano} já soma ${moeda(acumulado)}, acima de ${moeda(teto)}. Planeje a saída do Simples com o cliente. ${regra}`, { detalhes });
  }
  const mesTeto = mesQuePassa(teto);
  if (mesTeto) {
    return estudo(
      "limite_simples",
      "alerta",
      `Pode passar do limite do Simples em ${formatarCompetencia(mesTeto, true).toLowerCase()}`,
      `Mantido o ritmo de ${moeda(media)} por mês, a receita de ${ano} chega a ${moeda(projecao)}, acima de ${moeda(teto)}. Vale planejar com o cliente (ex.: o regime do ano que vem). ${regra}`,
      { detalhes },
    );
  }
  if (acumulado.gt(sub) || projecao.gt(sub)) {
    const mesSub = mesQuePassa(sub);
    return estudo(
      "limite_simples",
      "alerta",
      acumulado.gt(sub) ? "Passou do sublimite de R$ 3,6 milhões" : `Pode passar do sublimite em ${mesSub ? formatarCompetencia(mesSub, true).toLowerCase() : "breve"}`,
      `A receita de ${ano} ${acumulado.gt(sub) ? `já soma ${moeda(acumulado)}` : `deve chegar a ${moeda(projecao)}`}, acima do sublimite de ${moeda(sub)}: o ICMS e o ISS passam a ser pagos fora do DAS.`,
      { detalhes },
    );
  }
  if (projecao.gte(sub.times("0.85"))) {
    return estudo(
      "limite_simples",
      "alerta",
      "Perto do sublimite de R$ 3,6 milhões",
      `A projeção de ${ano} (${moeda(projecao)}) está em ${textoPercentual(projecao.div(sub).times(CEM), 0)} do sublimite. Acompanhe mês a mês.`,
      { detalhes },
    );
  }
  return estudo(
    "limite_simples",
    "nada_a_fazer",
    "Longe do limite do Simples",
    `A projeção de ${ano} (${moeda(projecao)}) está em ${textoPercentual(projecao.div(sub).times(CEM), 0)} do sublimite de ${moeda(sub)}.`,
    { detalhes },
  );
}

/** Os estudos de uma empresa. `ate` = último mês completo (AAAA-MM-01); `hoje` = AAAA-MM-DD. */
export function estudarEmpresa(dados: DadosEstudo, opcoes: { empresaId: string; ate: string; hoje: string }): { estudos: Estudo[]; pedirAuditor: boolean } {
  const base = `/e/${opcoes.empresaId}`;
  const d = dados.previsao;
  const auditor = estudoAuditor(dados.auditor, opcoes.ate, opcoes.hoje, base);
  return {
    estudos: [estudoRegime(d, opcoes.ate, base), estudoFatorR(d, opcoes.ate, base), auditor.estudo, estudoLimite(d, opcoes.ate, base)],
    pedirAuditor: auditor.pedirAuditor,
  };
}
