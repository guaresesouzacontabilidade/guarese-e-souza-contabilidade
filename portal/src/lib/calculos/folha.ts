import Decimal from "decimal.js";
import { centavos, dec, type ValorEntrada } from "@/lib/dinheiro";
import { INSS_EMPREGADO, IRRF, vigente } from "./tabelas";

/** INSS do empregado: alíquotas progressivas por faixa, limitado ao teto. */
export function inssEmpregado(remuneracao: ValorEntrada, competencia: string): Decimal {
  const { dados } = vigente(INSS_EMPREGADO, competencia);
  const base = Decimal.min(dec(remuneracao), dec(dados.teto));
  let total = new Decimal(0);
  let anterior = new Decimal(0);
  for (const f of dados.faixas) {
    if (base.lte(anterior)) break;
    const ate = Decimal.min(base, dec(f.ate));
    total = total.plus(ate.minus(anterior).times(f.aliquota).div(100));
    anterior = dec(f.ate);
  }
  return centavos(total);
}

/** Imposto pela tabela progressiva mensal (sem a redução da Lei 15.270/2025). */
function impostoTabela(base: Decimal, competencia: string): Decimal {
  const { dados } = vigente(IRRF, competencia);
  if (base.lte(0)) return new Decimal(0);
  const faixa = dados.faixas.find((f) => f.ate === null || base.lte(f.ate)) ?? dados.faixas[dados.faixas.length - 1];
  return Decimal.max(0, base.times(faixa.aliquota).div(100).minus(faixa.deduzir));
}

/**
 * IRRF mensal sobre salário ou pró-labore: usa a dedução mais vantajosa
 * (INSS + dependentes ou desconto simplificado) e aplica a redução mensal da
 * Lei 15.270/2025 (zera o imposto até R$ 5.000 e reduz até R$ 7.350).
 */
export function irrfMensal(rendimento: ValorEntrada, inss: ValorEntrada, dependentes: number, competencia: string): Decimal {
  const { dados } = vigente(IRRF, competencia);
  const bruto = dec(rendimento);
  if (bruto.lte(0)) return new Decimal(0);
  const legais = dec(inss).plus(dec(dados.dependente).times(Math.max(0, dependentes)));
  const deducao = Decimal.max(legais, dec(dados.descontoSimplificado));
  const imposto = impostoTabela(bruto.minus(deducao), competencia);
  let reducao = new Decimal(0);
  const r = dados.reducao;
  if (r) {
    if (bruto.lte(r.isencaoAte)) reducao = Decimal.min(imposto, dec(r.reducaoMaxima));
    else if (bruto.lte(r.reducaoAte)) reducao = Decimal.max(0, dec(r.a).minus(dec(r.b).times(bruto)));
  }
  return centavos(Decimal.max(0, imposto.minus(reducao)));
}

/** IRRF do 13º salário (tributação exclusiva, sem a redução mensal). */
export function irrf13(valor: ValorEntrada, inss: ValorEntrada, dependentes: number, competencia: string): Decimal {
  const { dados } = vigente(IRRF, competencia);
  const bruto = dec(valor);
  if (bruto.lte(0)) return new Decimal(0);
  const legais = dec(inss).plus(dec(dados.dependente).times(Math.max(0, dependentes)));
  const deducao = Decimal.max(legais, dec(dados.descontoSimplificado));
  return centavos(impostoTabela(bruto.minus(deducao), competencia));
}

/** Dias do mês (base 30) em que o colaborador esteve contratado. */
export function diasTrabalhadosNoMes(competencia: string, admissao: string, desligamento: string | null): number {
  const inicioMes = competencia.slice(0, 7);
  if (admissao.slice(0, 7) > inicioMes) return 0;
  if (desligamento && desligamento.slice(0, 7) < inicioMes) return 0;
  const primeiro = admissao.slice(0, 7) === inicioMes ? Number(admissao.slice(8, 10)) : 1;
  const ultimo = desligamento && desligamento.slice(0, 7) === inicioMes ? Math.min(30, Number(desligamento.slice(8, 10))) : 30;
  return Math.max(0, Math.min(30, ultimo) - Math.min(30, primeiro) + 1);
}

/** Meses do ano (até o mês indicado) com 15 dias ou mais de trabalho — base do 13º proporcional. */
export function avos13NoAno(ano: number, ateMes: number, admissao: string, desligamento: string | null): number {
  let avos = 0;
  for (let m = 1; m <= ateMes; m++) {
    const comp = `${ano}-${String(m).padStart(2, "0")}-01`;
    const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
    const ini = admissao.slice(0, 7) === comp.slice(0, 7) ? Number(admissao.slice(8, 10)) : 1;
    const fim = desligamento && desligamento.slice(0, 7) === comp.slice(0, 7) ? Number(desligamento.slice(8, 10)) : ultimoDia;
    if (admissao.slice(0, 7) > comp.slice(0, 7)) continue;
    if (desligamento && desligamento.slice(0, 7) < comp.slice(0, 7)) continue;
    if (fim - ini + 1 >= 15) avos++;
  }
  return avos;
}
