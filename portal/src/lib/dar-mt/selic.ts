/**
 * Taxa SELIC acumulada no mês (série 4390 do Sistema Gerenciador de Séries
 * Temporais do Banco Central — dados abertos, sem cadastro). O servidor só
 * pede o intervalo de datas; nenhum dado da empresa é enviado.
 */
export const URL_SELIC = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados";

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

/** Taxas (em %) dos meses pedidos (AAAA-MM). Mês ainda sem taxa publicada fica de fora. */
export async function buscarSelicMensal(meses: string[], buscar: Buscar = fetch): Promise<Record<string, string>> {
  if (!meses.length) return {};
  const ordenados = [...meses].sort();
  const [ai, mi] = ordenados[0].split("-");
  const [af, mf] = ordenados[ordenados.length - 1].split("-");
  const url = `${URL_SELIC}?formato=json&dataInicial=01/${mi}/${ai}&dataFinal=28/${mf}/${af}`;
  const resp = await buscar(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!resp.ok) throw new Error(`O Banco Central não respondeu a consulta da SELIC (HTTP ${resp.status}). Tente de novo em alguns minutos.`);
  const lista = (await resp.json()) as { data?: string; valor?: string }[];
  const taxas: Record<string, string> = {};
  for (const item of Array.isArray(lista) ? lista : []) {
    const m = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(item.data ?? "");
    if (m && /^\d+(\.\d+)?$/.test(item.valor ?? "")) taxas[`${m[2]}-${m[1]}`] = item.valor!;
  }
  return taxas;
}
