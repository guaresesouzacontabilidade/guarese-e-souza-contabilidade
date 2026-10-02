import { competenciaDe, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, nomeMes } from "@/lib/formatos";

/** Períodos dos relatórios: mês, trimestre, ano ou últimos 12 meses. */
export type TipoPeriodo = "mes" | "trimestre" | "ano" | "12m";

export interface Periodo {
  tipo: TipoPeriodo;
  /** Valor do seletor (ex.: "2026-09", "2026-T3", "2026", "12m-2026-09"). */
  chave: string;
  inicio: string;
  fim: string;
  rotulo: string;
  meses: string[]; // primeiro dia de cada mês do período
  anterior: { inicio: string; fim: string; rotulo: string };
}

const MES = /^(\d{4})-(\d{2})$/;
const TRI = /^(\d{4})-T([1-4])$/;
const ANO = /^(\d{4})$/;
const DOZE = /^12m-(\d{4})-(\d{2})$/;

function listaMeses(inicio: string, fim: string) {
  const r: string[] = [];
  for (let m = inicio.slice(0, 8) + "01"; m <= fim; m = somarMeses(m, 1)) r.push(m);
  return r;
}

function montar(tipo: TipoPeriodo, chave: string, inicio: string, fim: string, rotulo: string, anterior: Periodo["anterior"]): Periodo {
  return { tipo, chave, inicio, fim, rotulo, meses: listaMeses(inicio, fim), anterior };
}

export function periodoMes(comp: string): Periodo {
  const inicio = competenciaDe(comp);
  const ant = somarMeses(inicio, -1);
  return montar("mes", inicio.slice(0, 7), inicio, ultimoDiaDoMes(inicio), formatarCompetencia(inicio, true), {
    inicio: ant,
    fim: ultimoDiaDoMes(ant),
    rotulo: formatarCompetencia(ant, true),
  });
}

/**
 * Lê o período da URL (?periodo=...). Padrão: o mês anterior ao atual, que é o
 * último mês completo.
 */
export function lerPeriodo(valor: string | undefined | null, hoje: string): Periodo {
  const v = (valor ?? "").trim();
  let m = MES.exec(v);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return periodoMes(`${m[1]}-${m[2]}-01`);
  m = TRI.exec(v);
  if (m) {
    const ano = Number(m[1]);
    const t = Number(m[2]);
    const inicio = `${ano}-${String((t - 1) * 3 + 1).padStart(2, "0")}-01`;
    const fim = ultimoDiaDoMes(somarMeses(inicio, 2));
    const antInicio = somarMeses(inicio, -3);
    const antT = t === 1 ? 4 : t - 1;
    return montar("trimestre", v, inicio, fim, `${t}º trimestre de ${ano}`, {
      inicio: antInicio,
      fim: ultimoDiaDoMes(somarMeses(antInicio, 2)),
      rotulo: `${antT}º trimestre de ${t === 1 ? ano - 1 : ano}`,
    });
  }
  m = ANO.exec(v);
  if (m) {
    const ano = Number(m[1]);
    const anoAtual = Number(hoje.slice(0, 4));
    // Ano em curso: até o mês atual (comparado ao mesmo intervalo do ano anterior)
    const fim = ano === anoAtual ? ultimoDiaDoMes(hoje) : `${ano}-12-31`;
    const fimAnt = ano === anoAtual ? ultimoDiaDoMes(`${ano - 1}${hoje.slice(4, 8)}01`) : `${ano - 1}-12-31`;
    return montar("ano", v, `${ano}-01-01`, fim, ano === anoAtual ? `${ano} (até ${nomeMes(Number(hoje.slice(5, 7)))})` : String(ano), {
      inicio: `${ano - 1}-01-01`,
      fim: fimAnt,
      rotulo: ano === anoAtual ? `${ano - 1} (mesmo período)` : String(ano - 1),
    });
  }
  m = DOZE.exec(v);
  const ref = m ? `${m[1]}-${m[2]}-01` : somarMeses(competenciaDe(hoje), -1);
  if (m || v === "12m") {
    const inicio = somarMeses(ref, -11);
    const fim = ultimoDiaDoMes(ref);
    return montar("12m", `12m-${ref.slice(0, 7)}`, inicio, fim, `Últimos 12 meses (até ${formatarCompetencia(ref, true)})`, {
      inicio: somarMeses(inicio, -12),
      fim: ultimoDiaDoMes(somarMeses(ref, -12)),
      rotulo: "12 meses anteriores",
    });
  }
  return periodoMes(somarMeses(competenciaDe(hoje), -1));
}

/** Opções do seletor de período. */
export function opcoesPeriodo(hoje: string) {
  const atual = competenciaDe(hoje);
  const meses = Array.from({ length: 18 }, (_, i) => somarMeses(atual, -i)).map((c) => ({
    valor: c.slice(0, 7),
    rotulo: formatarCompetencia(c, true),
  }));
  const ano = Number(hoje.slice(0, 4));
  const triAtual = Math.floor((Number(hoje.slice(5, 7)) - 1) / 3) + 1;
  const trimestres: { valor: string; rotulo: string }[] = [];
  for (let i = 0, a = ano, t = triAtual; i < 6; i++) {
    trimestres.push({ valor: `${a}-T${t}`, rotulo: `${t}º trimestre de ${a}` });
    t--;
    if (t === 0) {
      t = 4;
      a--;
    }
  }
  return {
    meses,
    trimestres,
    anos: [ano, ano - 1, ano - 2].map((a) => ({ valor: String(a), rotulo: a === ano ? `${a} (até agora)` : String(a) })),
    doze: { valor: "12m", rotulo: "Últimos 12 meses" },
  };
}

/** Rótulo curto de um mês para colunas e gráficos (ex.: "set/26"). */
export function rotuloMesCurto(mes: string) {
  return `${nomeMes(Number(mes.slice(5, 7)), true)}/${mes.slice(2, 4)}`;
}
