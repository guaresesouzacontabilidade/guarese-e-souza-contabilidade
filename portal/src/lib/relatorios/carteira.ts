/**
 * Agregações da visão do escritório (várias empresas). Funções puras:
 * as consultas ficam nas páginas/rotas e já chegam filtradas pelo RLS.
 */
import { Decimal, dec, type ValorEntrada } from "@/lib/dinheiro";
import { competenciaDe, somarDias } from "@/lib/competencia";

const ZERO = new Decimal(0);

// -----------------------------------------------------------------------------
// Financeiro da carteira
// -----------------------------------------------------------------------------

export interface AbertoCarteira {
  empresa_id: string;
  tipo: string;
  data_vencimento: string;
  valor_previsto: ValorEntrada;
  valor_baixado: ValorEntrada;
  /** Compras no cartão de crédito são pagas pela fatura e ficam fora. */
  cartao?: boolean;
}

export interface ResumoFinanceiroEmpresa {
  receberAberto: Decimal;
  receberVencido: Decimal;
  pagarAberto: Decimal;
  pagarVencido: Decimal;
  pagar7: Decimal;
  receber7: Decimal;
  titulosVencidos: number;
  sugeridos: number;
}

export function resumoVazio(): ResumoFinanceiroEmpresa {
  return { receberAberto: ZERO, receberVencido: ZERO, pagarAberto: ZERO, pagarVencido: ZERO, pagar7: ZERO, receber7: ZERO, titulosVencidos: 0, sugeridos: 0 };
}

export function resumirCarteira(abertos: AbertoCarteira[], sugeridos: { empresa_id: string }[], hoje: string) {
  const em7 = somarDias(hoje, 7);
  const mapa = new Map<string, ResumoFinanceiroEmpresa>();
  const obter = (id: string) => {
    let r = mapa.get(id);
    if (!r) mapa.set(id, (r = resumoVazio()));
    return r;
  };
  for (const l of abertos) {
    if (l.cartao) continue;
    const aberto = dec(l.valor_previsto).minus(dec(l.valor_baixado));
    if (aberto.isZero() || aberto.isNegative()) continue;
    const r = obter(l.empresa_id);
    const vencido = l.data_vencimento < hoje;
    const proximo = !vencido && l.data_vencimento <= em7;
    if (l.tipo === "receber") {
      r.receberAberto = r.receberAberto.plus(aberto);
      if (vencido) r.receberVencido = r.receberVencido.plus(aberto);
      if (proximo) r.receber7 = r.receber7.plus(aberto);
    } else {
      r.pagarAberto = r.pagarAberto.plus(aberto);
      if (vencido) r.pagarVencido = r.pagarVencido.plus(aberto);
      if (proximo) r.pagar7 = r.pagar7.plus(aberto);
    }
    if (vencido) r.titulosVencidos++;
  }
  for (const s of sugeridos) obter(s.empresa_id).sugeridos++;
  return mapa;
}

// -----------------------------------------------------------------------------
// Relatórios operacionais do escritório
// -----------------------------------------------------------------------------

/** Quantidade de registros por empresa e mês (índice = posição em `meses`). */
export function contarPorEmpresaMes(linhas: { empresa_id: string; competencia: string }[], meses: string[]) {
  const idx = new Map(meses.map((m, i) => [m, i]));
  const mapa = new Map<string, number[]>();
  for (const l of linhas) {
    const i = idx.get(competenciaDe(l.competencia));
    if (i === undefined) continue;
    const v = mapa.get(l.empresa_id) ?? meses.map(() => 0);
    v[i]++;
    mapa.set(l.empresa_id, v);
  }
  return mapa;
}

export interface ItemChecklistResumo {
  empresa_id: string;
  competencia: string;
  status: string;
  obrigatorio: boolean;
  prazo: string;
}

export const STATUS_OK_CHECKLIST = ["concluido", "nao_se_aplica"];

/** Entrega do checklist (itens obrigatórios concluídos ou dispensados) por empresa e mês. */
export function entregaChecklist(itens: ItemChecklistResumo[], meses: string[]) {
  const idx = new Map(meses.map((m, i) => [m, i]));
  const porEmpresa = new Map<string, { total: number; ok: number }[]>();
  const porMes = meses.map(() => ({ total: 0, ok: 0, empresas: 0, completas: 0 }));
  for (const i of itens) {
    if (!i.obrigatorio) continue;
    const m = idx.get(competenciaDe(i.competencia));
    if (m === undefined) continue;
    const v = porEmpresa.get(i.empresa_id) ?? meses.map(() => ({ total: 0, ok: 0 }));
    v[m].total++;
    if (STATUS_OK_CHECKLIST.includes(i.status)) v[m].ok++;
    porEmpresa.set(i.empresa_id, v);
  }
  for (const v of porEmpresa.values()) {
    v.forEach((c, m) => {
      if (!c.total) return;
      porMes[m].total += c.total;
      porMes[m].ok += c.ok;
      porMes[m].empresas++;
      if (c.ok === c.total) porMes[m].completas++;
    });
  }
  return { porEmpresa, porMes };
}

export function percentualInteiro(ok: number, total: number): number | null {
  return total ? Math.round((100 * ok) / total) : null;
}

/** Pendências atuais por empresa a partir dos itens de checklist. */
export function pendenciasChecklist(itens: ItemChecklistResumo[], hoje: string) {
  const mapa = new Map<string, { atrasados: number; faltantes: number; correcao: number; naoAplicaRevisar: number }>();
  for (const i of itens) {
    const p = mapa.get(i.empresa_id) ?? { atrasados: 0, faltantes: 0, correcao: 0, naoAplicaRevisar: 0 };
    if (i.status === "pendente" || i.status === "correcao") {
      p.faltantes++;
      if (i.prazo < hoje) p.atrasados++;
    }
    if (i.status === "correcao") p.correcao++;
    if (i.status === "nao_se_aplica_solicitado") p.naoAplicaRevisar++;
    mapa.set(i.empresa_id, p);
  }
  return mapa;
}
