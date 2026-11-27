import "server-only";
import { ACOES_SEGURANCA } from "./rotulos";

/** Filtros do registro de atividades (lidos da URL e validados). */
export interface FiltrosAuditoria {
  inicio: string;
  fim: string;
  usuario: string | null;
  empresa: string | null;
  grupo: GrupoEvento | null;
}

export const GRUPOS_EVENTO = {
  seguranca: "Segurança (entradas, senhas, sessões, convites)",
  cadastros: "Cadastros e permissões",
  documentos: "Documentos e checklist",
  financeiro: "Financeiro e conciliação",
  fechamento: "Fechamento e relatórios",
  obrigacoes: "Obrigações, prazos e normas",
} as const;
export type GrupoEvento = keyof typeof GRUPOS_EVENTO;

const ENTIDADES: Record<Exclude<GrupoEvento, "seguranca">, string[]> = {
  cadastros: ["empresas", "empresa_contatos", "empresa_membros", "perfis", "escritorio", "convites"],
  documentos: ["documentos", "checklist_itens", "checklist_modelos"],
  financeiro: ["lancamentos", "baixas", "categorias_financeiras", "contas_financeiras", "transferencias", "conciliacoes", "importacoes", "estoques"],
  fechamento: ["competencias", "relatorios", "relatorios_publicados"],
  obrigacoes: ["tarefas", "obrigacoes", "obrigacao_regras", "empresa_obrigacoes", "empresa_regimes", "feriados", "atualizacoes_normativas"],
};

const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function somarDiasISO(data: string, n: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function lerFiltrosAuditoria(sp: Record<string, string | string[] | undefined>, hoje: string): FiltrosAuditoria {
  const t = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  let inicio = DATA.test(t("inicio")) ? t("inicio") : somarDiasISO(hoje, -30);
  let fim = DATA.test(t("fim")) ? t("fim") : hoje;
  if (inicio > fim) [inicio, fim] = [fim, inicio];
  const grupo = t("grupo") in GRUPOS_EVENTO ? (t("grupo") as GrupoEvento) : null;
  return { inicio, fim, usuario: UUID.test(t("usuario")) ? t("usuario") : null, empresa: UUID.test(t("empresa")) ? t("empresa") : null, grupo };
}

/** Limites do período no fuso do escritório (UTC−3). */
export function limitesPeriodo(f: Pick<FiltrosAuditoria, "inicio" | "fim">) {
  return { de: `${f.inicio}T00:00:00-03:00`, ate: `${somarDiasISO(f.fim, 1)}T00:00:00-03:00` };
}

interface ConsultaFiltravel<Q> {
  gte(coluna: string, valor: string): Q;
  lt(coluna: string, valor: string): Q;
  eq(coluna: string, valor: string): Q;
  in(coluna: string, valores: readonly string[]): Q;
  not(coluna: string, operador: string, valor: string): Q;
}

export function aplicarFiltrosAuditoria<Q extends ConsultaFiltravel<Q>>(q: Q, f: FiltrosAuditoria): Q {
  const { de, ate } = limitesPeriodo(f);
  let r = q.gte("ocorrido_em", de).lt("ocorrido_em", ate);
  if (f.usuario) r = r.eq("user_id", f.usuario);
  if (f.empresa) r = r.eq("empresa_id", f.empresa);
  if (f.grupo === "seguranca") r = r.in("acao", ACOES_SEGURANCA);
  else if (f.grupo) {
    r = r.in("entidade", ENTIDADES[f.grupo]);
    if (f.grupo === "cadastros") r = r.not("acao", "in", `(${ACOES_SEGURANCA.join(",")})`);
  }
  return r;
}

const CAMPOS_OCULTOS = new Set(["id", "empresa_id", "created_at", "updated_at", "created_by", "updated_by", "criado_em", "criado_por", "search", "busca"]);

function valorLegivel(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "nenhum";
  if (typeof v === "object") return JSON.stringify(v);
  const t = String(v);
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

/** Lista "campo: antes → depois" (alterações) ou "campo: valor" (criação, exclusão e eventos). */
export function detalharEvento(e: { acao: string; dados_antes: unknown; dados_depois: unknown; detalhes: unknown }): string[] {
  const antes = (e.dados_antes ?? {}) as Record<string, unknown>;
  const depois = (e.dados_depois ?? {}) as Record<string, unknown>;
  const campo = (k: string) => k.replace(/_/g, " ");
  if (e.acao === "alterar") {
    return Object.keys(depois)
      .filter((k) => !CAMPOS_OCULTOS.has(k))
      .map((k) => `${campo(k)}: ${valorLegivel(antes[k])} → ${valorLegivel(depois[k])}`);
  }
  const fonte = e.acao === "inserir" ? depois : e.acao === "excluir" ? antes : ((e.detalhes ?? {}) as Record<string, unknown>);
  return Object.entries(fonte)
    .filter(([k, v]) => !CAMPOS_OCULTOS.has(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .slice(0, 12)
    .map(([k, v]) => `${campo(k)}: ${valorLegivel(v)}`);
}
