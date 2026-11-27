/** Formatação no padrão brasileiro (datas, documentos, tamanhos). */

export const FUSO = "America/Araguaina";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function nomeMes(mes: number, curto = false) {
  return (curto ? MESES_CURTOS : MESES)[mes - 1] ?? "";
}

/** Data "AAAA-MM-DD" (sem fuso) → "DD/MM/AAAA". */
export function formatarData(data: string | null | undefined): string {
  if (!data) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  if (!m) return data;
  // Datas com horário (timestamptz) são convertidas para o fuso do escritório
  if (data.length > 10 && /T|\s\d{2}:/.test(data)) {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(data));
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatarDataHora(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

export function formatarRelativo(ts: string | null | undefined): string {
  if (!ts) return "—";
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} dia(s)`;
  return formatarData(ts);
}

/** "2026-09-01" → "09/2026" ou "setembro de 2026". */
export function formatarCompetencia(comp: string | null | undefined, longo = false): string {
  if (!comp) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(comp);
  if (!m) return comp;
  const mes = Number(m[2]);
  return longo ? `${nomeMes(mes)} de ${m[1]}` : `${m[2]}/${m[1]}`;
}

export function somenteDigitos(v: string | null | undefined) {
  return (v ?? "").replace(/\D/g, "");
}

export function formatarCnpj(v: string | null | undefined) {
  const d = somenteDigitos(v);
  if (d.length !== 14) return v ?? "—";
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function formatarCpf(v: string | null | undefined) {
  const d = somenteDigitos(v);
  if (d.length !== 11) return v ?? "—";
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

export function formatarDocumento(v: string | null | undefined) {
  const d = somenteDigitos(v);
  if (d.length === 14) return formatarCnpj(d);
  if (d.length === 11) return formatarCpf(d);
  return v ?? "—";
}

export function formatarCep(v: string | null | undefined) {
  const d = somenteDigitos(v);
  if (d.length !== 8) return v ?? "—";
  return d.replace(/^(\d{2})(\d{3})(\d{3})$/, "$1.$2-$3");
}

export function formatarTelefone(v: string | null | undefined) {
  const d = somenteDigitos(v);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return v ?? "—";
}

export function formatarTamanho(bytes: number | null | undefined) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace(".", ",")} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

export function formatarPercentual(v: number | null | undefined, casas = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(casas).replace(".", ",")}%`;
}

export function validarCnpj(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((s, c, i) => s + Number(c) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
}

export function validarCpf(valor: string): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv1 === Number(d[9]) && dv2 === Number(d[10]);
}
