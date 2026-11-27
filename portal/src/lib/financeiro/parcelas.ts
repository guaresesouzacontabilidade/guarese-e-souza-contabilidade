import { dec, lerValorBR, somar } from "@/lib/dinheiro";

export type Intervalo = "mensal" | "quinzenal" | "semanal";
export type ParcelaEditavel = { vencimento: string; valor: string };

/** Soma meses a uma data (AAAA-MM-DD). Dia 31 em mês curto vira o último dia do mês. */
export function somarMeses(iso: string, meses: number) {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Valor no formato da tela (1234,56), sem separador de milhar, para editar à mão. */
export function valorParaTela(v: ReturnType<typeof dec>) {
  return v.toFixed(2).replace(".", ",");
}

/** Divide um total em N parcelas iguais (a diferença de centavos fica na última). */
export function dividir(total: string, n: number) {
  const t = lerValorBR(total) ?? dec(0);
  const base = t.div(n).toDecimalPlaces(2, 1);
  return Array.from({ length: n }, (_, i) => valorParaTela(i === n - 1 ? t.minus(base.times(n - 1)) : base));
}

/** Gera as parcelas a partir do total, da quantidade, do 1º vencimento e do intervalo. */
export function gerarParcelas(total: string, n: number, primeiro: string, intervalo: Intervalo = "mensal"): ParcelaEditavel[] {
  const qtd = Math.min(360, Math.max(1, Math.trunc(n) || 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro)) return [];
  const vals = dividir(total, qtd);
  return vals.map((valor, i) => ({
    valor,
    vencimento: intervalo === "mensal" ? somarMeses(primeiro, i) : somarDias(primeiro, i * (intervalo === "quinzenal" ? 15 : 7)),
  }));
}

/**
 * Muda o valor de uma parcela. Se não for a última, a última absorve a
 * diferença para o total continuar igual (quando sobra valor para ela).
 */
export function mudarValorParcela(parcelas: ParcelaEditavel[], indice: number, valor: string, total: string): ParcelaEditavel[] {
  const novas = parcelas.map((p, i) => (i === indice ? { ...p, valor } : p));
  const ultima = novas.length - 1;
  const t = lerValorBR(total);
  if (indice === ultima || !t) return novas;
  const antes = somar(novas.slice(0, ultima).map((p) => lerValorBR(p.valor) ?? 0));
  const resto = t.minus(antes);
  if (resto.gt(0)) novas[ultima] = { ...novas[ultima], valor: valorParaTela(resto) };
  return novas;
}

export function somaParcelas(parcelas: ParcelaEditavel[]) {
  return somar(parcelas.map((p) => lerValorBR(p.valor) ?? 0));
}

/**
 * Confere as parcelas enviadas pelo formulário (JSON): de 2 a 360, cada uma com
 * vencimento e valor maior que zero, e a soma igual ao total. Devolve os valores
 * com ponto decimal (1234.56), prontos para o banco.
 */
export function validarParcelas(json: string, total: string | null): { ok: true; parcelas: { vencimento: string; valor: string }[] } | { ok: false; mensagem: string } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch {
    return { ok: false, mensagem: "As parcelas não vieram no formato esperado. Refaça as parcelas." };
  }
  if (!Array.isArray(bruto) || bruto.length < 2 || bruto.length > 360) return { ok: false, mensagem: "Informe de 2 a 360 parcelas." };
  const parcelas: { vencimento: string; valor: string }[] = [];
  for (const [i, p] of bruto.entries()) {
    const venc = typeof p?.vencimento === "string" ? p.vencimento : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || Number.isNaN(Date.parse(`${venc}T12:00:00Z`))) return { ok: false, mensagem: `Parcela ${i + 1}: informe o vencimento.` };
    const v = lerValorBR(typeof p?.valor === "string" ? p.valor : String(p?.valor ?? ""));
    if (!v || v.lte(0)) return { ok: false, mensagem: `Parcela ${i + 1}: o valor precisa ser maior que zero.` };
    parcelas.push({ vencimento: venc, valor: v.toDecimalPlaces(2).toFixed(2) });
  }
  const soma = somar(parcelas.map((p) => p.valor));
  if (total !== null && !soma.eq(dec(total))) {
    return { ok: false, mensagem: `A soma das parcelas (${soma.toFixed(2).replace(".", ",")}) precisa ser igual ao valor total (${dec(total).toFixed(2).replace(".", ",")}).` };
  }
  return { ok: true, parcelas };
}
