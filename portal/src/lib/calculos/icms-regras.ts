import type { Fonte } from "./tabelas";

/**
 * Regras estaduais usadas na apuração do ICMS, com a fonte de cada uma.
 * Hoje só o Tocantins (estado do escritório e de todas as empresas da
 * carteira) está cadastrado; para os demais estados a apuração própria
 * funciona, mas a complementação de alíquota e o diferencial de alíquotas
 * ficam para o escritório lançar.
 *
 * Alíquota interna: tabela "ICMS por estado" (public.icms_uf), conferida na
 * lei de cada estado. Alíquotas interestaduais: Resoluções do Senado nº
 * 22/1989 e nº 13/2012 (src/lib/fiscal/icms-estados.ts).
 */

export interface ReducaoAnual {
  /** Primeiro e último ano (inclusive). */
  de: number;
  ate: number;
  /** Redução da base de cálculo, em %. */
  percentual: number;
}

export interface RegrasIcmsUf {
  uf: string;
  /** Complementação de alíquota do Simples Nacional nas compras de outros estados para revenda/industrialização. */
  complementacao: {
    reducoes: ReducaoAnual[];
    fontes: Fonte[];
  };
  /** Diferencial de alíquotas nas compras de outros estados para uso e consumo ou ativo imobilizado. */
  difal: {
    /** "base_dupla": o imposto do destino integra a própria base ("por dentro"). */
    metodo: "base_dupla" | "base_unica";
    fontes: Fonte[];
  };
  /** Dia do mês seguinte em que vencem o ICMS apurado, a complementação e o diferencial. */
  vencimento: { dia: number; texto: string; fontes: Fonte[] };
}

const RICMS_TO: Fonte = {
  titulo: "RICMS/TO — Decreto nº 2.912/2006 (art. 35: diferencial de alíquotas; art. 508-B: complementação de alíquota do Simples Nacional)",
  url: "https://dtri.sefaz.to.gov.br/legislacao/ntributaria/decretos/Decreto2.912-06.htm",
};

export const REGRAS_ICMS: Record<string, RegrasIcmsUf> = {
  TO: {
    uf: "TO",
    complementacao: {
      // Lei nº 1.303/2002, art. 1º-A, I (ME/EPP) e II (MEI), redação da Lei nº 4.629, de 17/01/2025
      reducoes: [
        { de: 2022, ate: 2026, percentual: 75 },
        { de: 2027, ate: 2027, percentual: 50 },
        { de: 2028, ate: 2028, percentual: 25 },
      ],
      fontes: [
        RICMS_TO,
        {
          titulo: "Lei nº 1.303/2002 (TO), art. 1º-A — redução da base da complementação de alíquota: 75% de 2022 a 2026, 50% em 2027 e 25% em 2028 (Lei nº 4.629/2025)",
          url: "https://www.al.to.leg.br/arquivos/lei_1303-2002_65594.PDF",
        },
      ],
    },
    difal: {
      metodo: "base_dupla",
      fontes: [
        RICMS_TO,
        {
          titulo: "SEFAZ-TO, Consultas nº 65/2021 e nº 10/2023 — o diferencial integra a própria base de cálculo (base dupla)",
          url: "https://dtri.sefaz.to.gov.br/legislacao/consultas/2023/Consulta10.2023.htm",
        },
      ],
    },
    vencimento: {
      dia: 9,
      texto: "até o dia 9 do mês seguinte (calendário fiscal da SEFAZ-TO)",
      fontes: [
        {
          titulo: "SEFAZ-TO — calendário fiscal do ICMS (Portaria SEFAZ/GABSEC nº 61/2026) e Portaria SEFAZ nº 353/2012 (complementação de alíquota)",
          url: "https://www.to.gov.br/sefaz/simples-nacional/6yo6puq3o5qn",
        },
      ],
    },
  },
};

/** Redução da base da complementação no ano; `null` quando o ano não tem percentual cadastrado. */
export function reducaoComplementacao(regras: RegrasIcmsUf, ano: number): number | null {
  const r = regras.complementacao.reducoes.find((x) => ano >= x.de && ano <= x.ate);
  if (r) return r.percentual;
  const ultimo = Math.max(...regras.complementacao.reducoes.map((x) => x.ate));
  // Depois do último ano previsto na lei, não há redução (salvo nova lei)
  return ano > ultimo ? 0 : null;
}
