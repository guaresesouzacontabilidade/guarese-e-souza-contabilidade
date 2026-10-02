/** Rótulos e listas das maquininhas (servidor e navegador). */

export const TIPOS_ADQUIRENTE = ["cartao", "frota", "beneficio", "convenio"] as const;
export type TipoAdquirente = (typeof TIPOS_ADQUIRENTE)[number];

export const ROTULO_TIPO_ADQUIRENTE: Record<TipoAdquirente, string> = {
  cartao: "Cartões de crédito e débito",
  frota: "Frota e combustível",
  beneficio: "Benefícios (refeição e alimentação)",
  convenio: "Convênios",
};

export const MODALIDADES = ["debito", "credito_vista", "credito_parcelado", "pre_pago", "voucher", "frota", "pix", "outros"] as const;
export type Modalidade = (typeof MODALIDADES)[number];

export const ROTULO_MODALIDADE: Record<Modalidade, string> = {
  debito: "Débito",
  credito_vista: "Crédito à vista",
  credito_parcelado: "Crédito parcelado",
  pre_pago: "Pré-pago",
  voucher: "Voucher / benefício",
  frota: "Frota / combustível",
  pix: "Pix",
  outros: "Convênio / outros",
};

export type SituacaoVenda = "aprovada" | "cancelada" | "chargeback";

export const ROTULO_CONFERENCIA: Record<string, { rotulo: string; variante: "sucesso" | "alerta" | "perigo" | "neutro" | "info" }> = {
  pendente: { rotulo: "Aguardando conferência", variante: "neutro" },
  ok: { rotulo: "Conforme o contrato", variante: "sucesso" },
  acima: { rotulo: "Cobrada acima", variante: "perigo" },
  abaixo: { rotulo: "Cobrada abaixo", variante: "info" },
  sem_contrato: { rotulo: "Sem contrato cadastrado", variante: "alerta" },
  sem_taxa: { rotulo: "Sem taxa para este tipo de venda", variante: "alerta" },
  cancelada: { rotulo: "Cancelada", variante: "neutro" },
};

export const SITUACAO_IMPORTACAO: Record<string, { rotulo: string; variante: "sucesso" | "alerta" | "perigo" | "neutro" | "info" }> = {
  aguardando_mapeamento: { rotulo: "Conferir colunas", variante: "alerta" },
  na_fila: { rotulo: "Na fila", variante: "info" },
  importando: { rotulo: "Importando", variante: "info" },
  importada: { rotulo: "Importado", variante: "sucesso" },
  erro: { rotulo: "Erro na leitura", variante: "perigo" },
};

/** Bandeiras mais comuns (o relatório pode trazer outras; elas aparecem como vieram). */
export const BANDEIRAS_COMUNS = [
  "VISA",
  "MASTERCARD",
  "ELO",
  "AMEX",
  "HIPERCARD",
  "HIPER",
  "DINERS",
  "DISCOVER",
  "JCB",
  "CABAL",
  "SOROCRED",
  "BANESCARD",
  "CREDSYSTEM",
  "CREDZ",
  "VERDECARD",
  "AURA",
  "ALELO",
  "PLUXEE",
  "TICKET",
  "VR",
  "BEN",
  "TICKET LOG",
  "VALECARD",
  "GOODCARD",
] as const;

/** Campos do relatório que o portal precisa encontrar (colunas). */
export const CAMPOS_RELATORIO = [
  { chave: "data", rotulo: "Data da venda", obrigatorio: true, ajuda: "Dia em que a venda foi feita (não a data do pagamento)." },
  { chave: "bruto", rotulo: "Valor da venda (bruto)", obrigatorio: true, ajuda: "Valor cobrado do cliente, antes das taxas." },
  { chave: "liquido", rotulo: "Valor líquido", obrigatorio: false, ajuda: "O que a adquirente paga depois de descontar as taxas." },
  { chave: "taxa", rotulo: "Valor da taxa (R$)", obrigatorio: false, ajuda: "Usado quando o relatório não traz o valor líquido." },
  { chave: "taxa_percentual", rotulo: "Taxa (%)", obrigatorio: false, ajuda: "Usada quando não há valor líquido nem valor da taxa." },
  { chave: "bandeira", rotulo: "Bandeira", obrigatorio: false, ajuda: "Visa, Mastercard, Elo, Alelo..." },
  { chave: "modalidade", rotulo: "Modalidade / produto", obrigatorio: false, ajuda: "Débito, crédito, parcelado, voucher, frota, Pix..." },
  { chave: "parcelas", rotulo: "Parcelas", obrigatorio: false, ajuda: "Quantidade de parcelas (ex.: 3x ou 1/3)." },
  { chave: "nsu", rotulo: "NSU / código da venda", obrigatorio: false, ajuda: "Evita contar a mesma venda duas vezes." },
  { chave: "autorizacao", rotulo: "Código de autorização", obrigatorio: false, ajuda: "" },
  { chave: "terminal", rotulo: "Terminal / maquininha", obrigatorio: false, ajuda: "" },
  { chave: "previsao", rotulo: "Previsão de pagamento", obrigatorio: false, ajuda: "" },
  { chave: "situacao", rotulo: "Situação (aprovada, cancelada...)", obrigatorio: false, ajuda: "Vendas canceladas ficam fora da conta." },
] as const;

export type CampoRelatorio = (typeof CAMPOS_RELATORIO)[number]["chave"];

export function rotuloParcelas(modalidade: string, parcelas: number) {
  return modalidade === "credito_parcelado" ? `${parcelas}x` : "";
}

export function rotuloFaixaParcelas(de: number, ate: number) {
  if (de === ate) return de === 1 ? "1x" : `${de}x`;
  return `${de}x a ${ate}x`;
}
