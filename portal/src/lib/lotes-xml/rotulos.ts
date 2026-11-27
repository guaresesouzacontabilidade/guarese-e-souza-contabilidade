/** XML em lote por competência: tipos de arquivo, situações e nomes. */
import { somarMeses } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";

export const TIPOS_LOTE = ["nfe_entrada", "nfe_saida", "nfce", "cte", "nfse_prestada", "nfse_tomada", "eventos"] as const;
export type TipoLote = (typeof TIPOS_LOTE)[number];

export const ROTULO_TIPO_LOTE: Record<TipoLote, string> = {
  nfe_entrada: "NF-e de entrada",
  nfe_saida: "NF-e de saída",
  nfce: "NFC-e",
  cte: "CT-e",
  nfse_prestada: "NFS-e prestadas",
  nfse_tomada: "NFS-e tomadas",
  eventos: "Eventos",
};

export const AJUDA_TIPO_LOTE: Record<TipoLote, string> = {
  nfe_entrada: "compras e outras entradas",
  nfe_saida: "vendas e outras saídas",
  nfce: "vendas no caixa",
  cte: "fretes",
  nfse_prestada: "serviços vendidos",
  nfse_tomada: "serviços contratados",
  eventos: "cancelamentos e cartas de correção",
};

export type SituacaoLote = "pendente" | "gerando" | "pronto" | "vazio" | "erro" | "expirado";

export const SITUACAO_LOTE: Record<SituacaoLote, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  pendente: { rotulo: "Na fila", tom: "info" },
  gerando: { rotulo: "Gerando", tom: "info" },
  pronto: { rotulo: "Pronto", tom: "sucesso" },
  vazio: { rotulo: "Sem notas", tom: "neutro" },
  erro: { rotulo: "Erro", tom: "perigo" },
  expirado: { rotulo: "Expirado", tom: "neutro" },
};

export interface ParteLote {
  numero: number;
  caminho: string;
  nome: string;
  arquivos: number;
  bytes: number;
}

/** "xml-2026-09-padaria-pao-dourado.zip" (ou "...-parte-1-de-3.zip"). */
export function nomeArquivoLote(empresa: string, competencia: string, numero: number, total: number) {
  const slug = empresa
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `xml-${competencia.slice(0, 7)}-${slug || "empresa"}${total > 1 ? `-parte-${numero}-de-${total}` : ""}.zip`;
}

export function tiposValidos(valores: unknown[]): TipoLote[] {
  return TIPOS_LOTE.filter((t) => valores.includes(t));
}

/** Meses que podem ser pedidos (do atual para trás, 5 anos), com o mês anterior como padrão. */
export function mesesDoLote(atual: string, quantidade = 60) {
  const meses = Array.from({ length: quantidade }, (_, i) => {
    const valor = somarMeses(atual, -i).slice(0, 7);
    const rotulo = formatarCompetencia(valor, true);
    return { valor, rotulo: rotulo.charAt(0).toUpperCase() + rotulo.slice(1) };
  });
  return { meses, padrao: somarMeses(atual, -1).slice(0, 7) };
}
