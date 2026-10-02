/** Comparação campo a campo dos dados de um registro de auditoria. */

export interface CampoAlterado {
  campo: string;
  antes: unknown;
  depois: unknown;
  /** "incluido" (só depois), "removido" (só antes), "alterado" ou "igual". */
  tipo: "incluido" | "removido" | "alterado" | "igual";
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Monta a lista de campos a partir de `dados_antes` e `dados_depois`.
 * Inclusões trazem só "depois", exclusões só "antes" e alterações apenas os
 * campos modificados (é o que o gatilho app.tg_auditoria grava).
 */
export function compararDados(antes: unknown, depois: unknown): CampoAlterado[] {
  const a = ehObjeto(antes) ? antes : null;
  const d = ehObjeto(depois) ? depois : null;
  const campos = [...new Set([...Object.keys(a ?? {}), ...Object.keys(d ?? {})])].sort((x, y) => x.localeCompare(y));
  return campos.map((campo) => {
    const temAntes = a !== null && campo in a;
    const temDepois = d !== null && campo in d;
    const va = temAntes ? a![campo] : undefined;
    const vd = temDepois ? d![campo] : undefined;
    let tipo: CampoAlterado["tipo"];
    if (temAntes && temDepois) tipo = igual(va, vd) ? "igual" : "alterado";
    else if (temDepois) tipo = a === null ? "incluido" : "alterado";
    else tipo = d === null ? "removido" : "alterado";
    return { campo, antes: va, depois: vd, tipo };
  });
}

/** Representação textual de um valor JSON para exibição. */
export function formatarValor(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "(vazio)";
  if (typeof v === "string") return v === "" ? "(texto vazio)" : v;
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v, null, 2);
}
