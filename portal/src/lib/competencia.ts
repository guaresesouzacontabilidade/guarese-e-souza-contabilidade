import { FUSO, formatarCompetencia } from "./formatos";

/** Data de hoje (AAAA-MM-DD) no fuso do escritório. */
export function hojeISO(): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return partes; // en-CA já usa AAAA-MM-DD
}

export function competenciaDe(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

export function competenciaAtual(): string {
  return competenciaDe(hojeISO());
}

/** Aceita "2026-09", "2026-09-01" ou "09/2026". Retorna "AAAA-MM-01" ou null. */
export function lerCompetencia(v: string | null | undefined): string | null {
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(v.trim());
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}-01`;
  m = /^(\d{2})\/(\d{4})$/.exec(v.trim());
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]}-01`;
  return null;
}

export function somarMeses(comp: string, n: number): string {
  const [a, m] = comp.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

export function ultimoDiaDoMes(comp: string): string {
  const prox = somarMeses(comp, 1);
  const d = new Date(`${prox}T12:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  const a = new Date(`${de}T12:00:00Z`).getTime();
  const b = new Date(`${ate}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Lista de competências (mais recente primeiro) para seletores. */
export function listaCompetencias(quantidadeAnterior = 24, posteriores = 1): { valor: string; rotulo: string }[] {
  const atual = competenciaAtual();
  const lista: { valor: string; rotulo: string }[] = [];
  for (let i = posteriores; i >= -quantidadeAnterior; i--) {
    const c = somarMeses(atual, i);
    lista.push({ valor: c.slice(0, 7), rotulo: formatarCompetencia(c, true) });
  }
  return lista;
}

/** Período a partir de parâmetros de busca (padrão: mês atual). */
export function periodoDeParametros(params: { inicio?: string; fim?: string; competencia?: string }): { inicio: string; fim: string } {
  const comp = lerCompetencia(params.competencia);
  if (comp) return { inicio: comp, fim: ultimoDiaDoMes(comp) };
  const valido = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const inicio = valido(params.inicio) ?? competenciaAtual();
  const fim = valido(params.fim) ?? ultimoDiaDoMes(competenciaDe(inicio));
  return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
}
