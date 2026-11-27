import Decimal from "decimal.js";
import { centavos, dec, type ValorEntrada } from "@/lib/dinheiro";
import { avos13NoAno, inssEmpregado, irrf13, irrfMensal } from "./folha";
import { FOLHA, MEI, RESCISAO } from "./tabelas";

/**
 * Simulação de rescisão (estimativa do custo para a empresa). Segue a CLT
 * (arts. 477, 479, 484-A e 487), a Lei 12.506/2011 (aviso proporcional) e a
 * Lei 8.036/1990 (FGTS). Não substitui o cálculo do termo de rescisão feito
 * pelo escritório (médias, faltas, convenção coletiva etc.).
 */

export type TipoRescisao = "sem_justa_causa" | "pedido_demissao" | "acordo" | "justa_causa" | "fim_experiencia" | "antecipada_experiencia";
export type ModoAviso = "indenizado" | "trabalhado" | "descontado" | "dispensado";
export type TipoFolha = "simples" | "simples_iv" | "mei" | "geral";

export const TIPOS_RESCISAO: Record<TipoRescisao, { rotulo: string; descricao: string }> = {
  sem_justa_causa: { rotulo: "Dispensa sem justa causa", descricao: "A empresa encerra o contrato. Aviso prévio proporcional e multa de 40% do FGTS." },
  pedido_demissao: { rotulo: "Pedido de demissão", descricao: "O empregado pede para sair. Sem multa do FGTS; aviso de 30 dias a cumprir." },
  acordo: { rotulo: "Acordo entre as partes (art. 484-A)", descricao: "Metade do aviso indenizado e multa de 20% do FGTS; demais verbas integrais." },
  justa_causa: { rotulo: "Dispensa por justa causa", descricao: "Só saldo de salário e férias vencidas com 1/3." },
  fim_experiencia: { rotulo: "Fim do contrato de experiência ou prazo determinado", descricao: "Contrato termina na data prevista. Sem aviso e sem multa." },
  antecipada_experiencia: {
    rotulo: "Encerramento antecipado do contrato de experiência pela empresa",
    descricao: "Indenização de metade dos dias que faltavam (art. 479) e multa de 40% do FGTS.",
  },
};

export interface EntradaRescisao {
  salario: ValorEntrada;
  adicionais?: ValorEntrada | null;
  admissao: string;
  /** Último dia de trabalho (ou data em que o aviso é dado, quando indenizado). */
  desligamento: string;
  tipo: TipoRescisao;
  aviso: ModoAviso;
  /** Períodos de férias completos ainda não tirados (0 a 2). */
  feriasVencidas: number;
  /** Saldo do FGTS para fins rescisórios; sem ele, é estimado pelo salário. */
  saldoFgts?: ValorEntrada | null;
  /** Data prevista para o fim do contrato de experiência/prazo determinado. */
  fimContrato?: string | null;
  dependentes?: number;
  tipoFolha: TipoFolha;
  rat?: ValorEntrada;
  fap?: ValorEntrada;
  terceiros?: ValorEntrada;
}

export interface Verba {
  chave: string;
  descricao: string;
  valor: Decimal;
  detalhe?: string;
}

export interface ResultadoRescisao {
  valido: boolean;
  erro?: string;
  diasAviso: number;
  diasIndenizados: number;
  dataProjetada: string;
  proventos: Verba[];
  descontos: Verba[];
  totalProventos: Decimal;
  totalDescontos: Decimal;
  liquidoEmpregado: Decimal;
  fgtsMes: Decimal;
  saldoFgts: Decimal;
  saldoFgtsEstimado: boolean;
  multaFgts: Decimal;
  encargos: Decimal;
  encargosDetalhe: string;
  /** Total que sai do caixa da empresa (verbas, FGTS, multa e encargos). */
  custoTotal: Decimal;
  saqueFgts: string;
  observacoes: string[];
}

// -----------------------------------------------------------------------------
// Datas (AAAA-MM-DD, sem fuso)
// -----------------------------------------------------------------------------
function partes(d: string) {
  return { a: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) };
}

function iso(a: number, m: number, d: number) {
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function ultimoDia(a: number, m: number) {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function somarDiasData(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function somarMesesData(d: string, n: number): string {
  const p = partes(d);
  const total = p.a * 12 + (p.m - 1) + n;
  const a = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return iso(a, m, Math.min(p.d, ultimoDia(a, m)));
}

function diasEntre(de: string, ate: string) {
  return Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86400000);
}

export function anosCompletos(inicio: string, fim: string): number {
  const i = partes(inicio);
  const f = partes(fim);
  let anos = f.a - i.a;
  if (f.m < i.m || (f.m === i.m && f.d < i.d)) anos--;
  return Math.max(0, anos);
}

/** Avos (1/12) de inicio até fim: mês completo ou fração de 15 dias ou mais. */
export function avosEntre(inicio: string, fim: string): number {
  if (fim < inicio) return 0;
  let avos = 0;
  for (let k = 0; k < 600; k++) {
    const ini = somarMesesData(inicio, k);
    if (ini > fim) break;
    const fimSeg = somarDiasData(somarMesesData(inicio, k + 1), -1);
    if (fimSeg <= fim) avos++;
    else {
      if (diasEntre(ini, fim) + 1 >= 15) avos++;
      break;
    }
  }
  return avos;
}

/** Aviso prévio proporcional: 30 dias + 3 por ano completo, até 90 (Lei 12.506/2011). */
export function diasAvisoProporcional(admissao: string, desligamento: string): number {
  return Math.min(RESCISAO.avisoMaximo, RESCISAO.avisoBase + RESCISAO.avisoPorAno * anosCompletos(admissao, desligamento));
}

// -----------------------------------------------------------------------------
// Simulação
// -----------------------------------------------------------------------------
export function simularRescisao(e: EntradaRescisao): ResultadoRescisao {
  const zero = new Decimal(0);
  const vazio: ResultadoRescisao = {
    valido: false,
    diasAviso: 0,
    diasIndenizados: 0,
    dataProjetada: e.desligamento,
    proventos: [],
    descontos: [],
    totalProventos: zero,
    totalDescontos: zero,
    liquidoEmpregado: zero,
    fgtsMes: zero,
    saldoFgts: zero,
    saldoFgtsEstimado: false,
    multaFgts: zero,
    encargos: zero,
    encargosDetalhe: "",
    custoTotal: zero,
    saqueFgts: "",
    observacoes: [],
  };
  const data = /^\d{4}-\d{2}-\d{2}$/;
  if (!data.test(e.admissao) || !data.test(e.desligamento)) return { ...vazio, erro: "Informe as datas de admissão e de desligamento." };
  if (e.desligamento < e.admissao) return { ...vazio, erro: "A data de desligamento é anterior à admissão." };
  const rem = dec(e.salario).plus(dec(e.adicionais ?? 0));
  if (rem.lte(0)) return { ...vazio, erro: "Informe o salário." };
  const exp = e.tipo === "fim_experiencia" || e.tipo === "antecipada_experiencia";
  if (exp && (!e.fimContrato || !data.test(e.fimContrato))) return { ...vazio, erro: "Informe a data prevista para o fim do contrato." };

  const diario = rem.div(30);
  const proventos: Verba[] = [];
  const descontos: Verba[] = [];
  const obs: string[] = [];
  const add = (lista: Verba[], v: Verba) => {
    const valor = centavos(v.valor);
    if (valor.gt(0)) lista.push({ ...v, valor });
  };

  // Aviso prévio
  let diasAviso = 0;
  let diasIndenizados = 0;
  if (e.tipo === "sem_justa_causa" || e.tipo === "acordo") {
    diasAviso = diasAvisoProporcional(e.admissao, e.desligamento);
    if (e.aviso === "trabalhado") diasIndenizados = Math.max(0, diasAviso - 30);
    else diasIndenizados = e.tipo === "acordo" ? Math.floor(diasAviso / 2) : diasAviso;
  } else if (e.tipo === "pedido_demissao") {
    diasAviso = 30;
  }
  const dataProjetada = somarDiasData(e.desligamento, diasIndenizados);

  // 1. Saldo de salário
  const dd = Math.min(30, partes(e.desligamento).d);
  const saldoSalario = diario.times(dd);
  add(proventos, { chave: "saldo", descricao: `Saldo de salário (${dd} ${dd === 1 ? "dia" : "dias"})`, valor: saldoSalario });

  // 2. Aviso prévio indenizado (no acordo, metade do valor; a projeção usa os dias inteiros dessa metade)
  const avisoValor =
    e.tipo === "acordo" && e.aviso !== "trabalhado" ? diario.times(diasAviso).div(2) : diario.times(diasIndenizados);
  if (diasIndenizados > 0) {
    const det =
      e.tipo === "acordo" && e.aviso !== "trabalhado"
        ? `Metade de ${diasAviso} dias (acordo, art. 484-A)`
        : e.aviso === "trabalhado"
          ? `${diasIndenizados} dias além dos 30 trabalhados (aviso proporcional)`
          : `${diasAviso} dias (30 + 3 por ano completo)`;
    add(proventos, { chave: "aviso", descricao: "Aviso prévio indenizado", valor: avisoValor, detalhe: det });
  }

  // 3. Indenização do art. 479 (fim antecipado do contrato de experiência)
  let art479 = zero;
  if (e.tipo === "antecipada_experiencia" && e.fimContrato && e.fimContrato > e.desligamento) {
    const restantes = diasEntre(e.desligamento, e.fimContrato);
    art479 = diario.times(restantes).div(2);
    add(proventos, { chave: "art479", descricao: "Indenização do art. 479 da CLT", valor: art479, detalhe: `Metade de ${restantes} dias que faltavam para o fim do contrato` });
  }

  // 4. 13º salário proporcional (com a projeção do aviso indenizado)
  let decimo = zero;
  let adiantamento13 = zero;
  if (e.tipo !== "justa_causa") {
    const anoIni = partes(e.desligamento).a;
    const fimP = partes(dataProjetada);
    let avosTotal = 0;
    for (let ano = anoIni; ano <= fimP.a; ano++) {
      const ate = ano === fimP.a ? fimP.m : 12;
      const avos = avos13NoAno(ano, ate, e.admissao, ano === fimP.a ? dataProjetada : `${ano}-12-31`);
      avosTotal += avos;
      if (ano === anoIni && partes(e.desligamento).m === 12) {
        // A 1ª parcela do 13º (paga até 30/11) é descontada na rescisão de dezembro.
        adiantamento13 = adiantamento13.plus(rem.times(avos13NoAno(ano, 11, e.admissao, `${ano}-11-30`)).div(12).div(2));
      }
    }
    decimo = rem.times(avosTotal).div(12);
    add(proventos, { chave: "13", descricao: `13º salário proporcional (${avosTotal}/12)`, valor: decimo, detalhe: diasIndenizados > 0 ? "Inclui a projeção do aviso indenizado" : undefined });
  }

  // 5. Férias vencidas e proporcionais, com 1/3
  let feriasIndenizadas = zero;
  const vencidas = Math.max(0, Math.min(2, Math.floor(e.feriasVencidas || 0)));
  if (vencidas > 0) {
    const fatores = vencidas === 2 ? [2, 1] : [1];
    for (const [i, f] of fatores.entries()) {
      const v = rem.times(f);
      feriasIndenizadas = feriasIndenizadas.plus(v);
      add(proventos, {
        chave: `ferias_vencidas_${i}`,
        descricao: f === 2 ? "Férias vencidas em dobro (prazo de concessão passou)" : "Férias vencidas",
        valor: v,
      });
    }
  }
  if (e.tipo !== "justa_causa") {
    // Período aquisitivo em curso: último aniversário da admissão até o desligamento
    const anos = anosCompletos(e.admissao, e.desligamento);
    const inicioPeriodo = somarMesesData(e.admissao, anos * 12);
    let avos = avosEntre(inicioPeriodo, dataProjetada);
    if (avos >= 12) {
      // O período se completou durante a projeção do aviso: férias integrais + novo período.
      add(proventos, { chave: "ferias_integrais", descricao: "Férias integrais (período completado na projeção do aviso)", valor: rem });
      feriasIndenizadas = feriasIndenizadas.plus(rem);
      avos -= 12;
    }
    const prop = rem.times(avos).div(12);
    feriasIndenizadas = feriasIndenizadas.plus(prop);
    add(proventos, { chave: "ferias_prop", descricao: `Férias proporcionais (${avos}/12)`, valor: prop });
  }
  if (feriasIndenizadas.gt(0)) add(proventos, { chave: "terco", descricao: "1/3 constitucional sobre as férias", valor: feriasIndenizadas.div(3) });

  // Descontos do empregado
  if (e.tipo === "pedido_demissao" && e.aviso === "descontado") {
    add(descontos, { chave: "aviso_descontado", descricao: "Aviso prévio não cumprido (30 dias)", valor: diario.times(30) });
  }
  if (adiantamento13.gt(0)) add(descontos, { chave: "adiantamento13", descricao: "1ª parcela do 13º já paga", valor: adiantamento13 });
  const inssSaldo = inssEmpregado(saldoSalario, e.desligamento);
  const decimoLiquidoBase = Decimal.max(0, decimo);
  const inss13 = inssEmpregado(decimoLiquidoBase, e.desligamento);
  add(descontos, { chave: "inss", descricao: "INSS do empregado (saldo de salário)", valor: inssSaldo });
  add(descontos, { chave: "inss13", descricao: "INSS do empregado (13º salário)", valor: inss13 });
  add(descontos, { chave: "irrf", descricao: "IRRF (saldo de salário)", valor: irrfMensal(saldoSalario, inssSaldo, e.dependentes ?? 0, e.desligamento) });
  add(descontos, { chave: "irrf13", descricao: "IRRF (13º salário)", valor: irrf13(decimoLiquidoBase, inss13, e.dependentes ?? 0, e.desligamento) });

  const totalProventos = centavos(proventos.reduce((s, v) => s.plus(v.valor), zero));
  const totalDescontos = centavos(descontos.reduce((s, v) => s.plus(v.valor), zero));

  // FGTS do mês da rescisão: saldo de salário, aviso indenizado e 13º (não incide sobre férias indenizadas)
  const baseFgts = saldoSalario.plus(avisoValor).plus(Decimal.max(0, decimo.minus(adiantamento13)));
  const fgtsMes = centavos(baseFgts.times(FOLHA.fgts).div(100));

  // Multa do FGTS
  const percMulta = e.tipo === "sem_justa_causa" || e.tipo === "antecipada_experiencia" ? dec(RESCISAO.multaFgts) : e.tipo === "acordo" ? dec(RESCISAO.multaFgtsAcordo) : zero;
  let saldoFgts = zero;
  let estimado = false;
  if (e.saldoFgts != null && e.saldoFgts !== "") saldoFgts = dec(e.saldoFgts);
  else {
    const a = partes(e.admissao);
    const d = partes(e.desligamento);
    const meses = Math.max(0, (d.a - a.a) * 12 + (d.m - a.m));
    // Depósitos de 8% sobre salários, 13º e 1/3 de férias (sem a correção do FGTS)
    saldoFgts = rem.times(FOLHA.fgts).div(100).times(meses).times(new Decimal(1).plus(new Decimal(1).div(12)).plus(new Decimal(1).div(36)));
    estimado = true;
  }
  const multaFgts = centavos(saldoFgts.plus(fgtsMes).times(percMulta).div(100));

  // Encargos da empresa sobre saldo de salário e 13º
  const baseEncargos = saldoSalario.plus(decimo);
  let encargos = zero;
  let encargosDetalhe = "";
  if (e.tipoFolha === "geral" || e.tipoFolha === "simples_iv") {
    const ratFap = dec(e.rat ?? 2).times(dec(e.fap ?? 1));
    let perc = dec(FOLHA.cpp).plus(ratFap);
    if (e.tipoFolha === "geral") perc = perc.plus(dec(e.terceiros ?? "5.8"));
    encargos = baseEncargos.times(perc).div(100);
    encargosDetalhe = `${perc.toFixed(2).replace(".", ",")}% (INSS patronal, RAT${e.tipoFolha === "geral" ? " e terceiros" : ""}) sobre saldo de salário e 13º`;
  } else if (e.tipoFolha === "mei") {
    encargos = baseEncargos.times(MEI.cppEmpregado).div(100);
    encargosDetalhe = `${MEI.cppEmpregado}% (contribuição patronal do MEI) sobre saldo de salário e 13º`;
  } else {
    encargosDetalhe = "Simples Nacional: a contribuição patronal já está no DAS.";
  }
  encargos = centavos(encargos);

  const avisoDescontado = descontos.find((d) => d.chave === "aviso_descontado")?.valor ?? zero;
  const adiant = descontos.find((d) => d.chave === "adiantamento13")?.valor ?? zero;
  const custoTotal = centavos(totalProventos.minus(avisoDescontado).minus(adiant).plus(fgtsMes).plus(multaFgts).plus(encargos));

  const saqueFgts =
    e.tipo === "sem_justa_causa" || e.tipo === "antecipada_experiencia"
      ? "O empregado saca todo o FGTS e pode pedir o seguro-desemprego."
      : e.tipo === "acordo"
        ? "O empregado saca até 80% do FGTS e não tem direito ao seguro-desemprego."
        : e.tipo === "fim_experiencia"
          ? "O empregado saca o FGTS (sem multa) e não tem direito ao seguro-desemprego."
          : "O empregado não saca o FGTS nem recebe seguro-desemprego.";

  if (estimado && percMulta.gt(0)) obs.push("Saldo do FGTS estimado pelo salário atual (sem a correção do FGTS). Informe o saldo do extrato para um valor mais preciso.");
  if (e.tipo === "sem_justa_causa" && e.aviso === "trabalhado") obs.push("Aviso trabalhado: a jornada é reduzida em 2 horas por dia ou o empregado folga 7 dias corridos.");
  if (e.tipo === "pedido_demissao" && e.aviso === "dispensado") obs.push("Aviso dispensado pela empresa: não há desconto nem pagamento do aviso.");
  obs.push("Pagamento das verbas em até 10 dias após o término do contrato (art. 477 da CLT).");
  obs.push("Não considera médias de horas extras e comissões, faltas, banco de horas, nem regras da convenção coletiva.");

  return {
    valido: true,
    diasAviso,
    diasIndenizados,
    dataProjetada,
    proventos,
    descontos,
    totalProventos,
    totalDescontos,
    liquidoEmpregado: centavos(totalProventos.minus(totalDescontos)),
    fgtsMes,
    saldoFgts: centavos(saldoFgts),
    saldoFgtsEstimado: estimado,
    multaFgts,
    encargos,
    encargosDetalhe,
    custoTotal,
    saqueFgts,
    observacoes: obs,
  };
}
