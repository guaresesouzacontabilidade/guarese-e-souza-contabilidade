import { competenciaAtual, lerCompetencia, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, nomeMes } from "@/lib/formatos";
import { PRIMEIRA_COMPETENCIA } from "./tabelas";

function maiuscula(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Competência exibida por padrão: o mês anterior (os impostos dele vencem no mês atual). */
export function competenciaDosCalculos(valor: string | null | undefined): string {
  const c = lerCompetencia(valor);
  const padrao = somarMeses(competenciaAtual(), -1);
  if (!c || c.slice(0, 7) < PRIMEIRA_COMPETENCIA || c > competenciaAtual()) return padrao.slice(0, 7) < PRIMEIRA_COMPETENCIA ? `${PRIMEIRA_COMPETENCIA}-01` : padrao;
  return c;
}

/** Opções do seletor: do mês atual até a primeira competência com tabelas. */
export function opcoesCompetencia(): { valor: string; rotulo: string }[] {
  const lista: { valor: string; rotulo: string }[] = [];
  for (let c = competenciaAtual(); c.slice(0, 7) >= PRIMEIRA_COMPETENCIA && lista.length < 36; c = somarMeses(c, -1)) {
    const seguinte = somarMeses(c, 1);
    lista.push({ valor: c.slice(0, 7), rotulo: `${maiuscula(formatarCompetencia(c, true))} (pagamento em ${nomeMes(Number(seguinte.slice(5, 7)))})` });
  }
  return lista;
}
