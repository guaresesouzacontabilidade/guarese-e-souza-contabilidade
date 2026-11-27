/**
 * Textos do robô de cobrança. O escritório pode editar o assunto e o texto
 * de cada tipo (Configurações dos honorários); sem edição, vale o padrão.
 * Variáveis entre chaves são trocadas na hora do envio.
 */

export type TipoMensagem = "emissao" | "antes" | "no_dia" | "atraso" | "formal" | "pagamento";

export const TIPOS_MENSAGEM: Record<TipoMensagem, string> = {
  emissao: "Cobrança nova",
  antes: "Lembrete antes do vencimento",
  no_dia: "No dia do vencimento",
  atraso: "Em atraso (até 29 dias)",
  formal: "Aviso formal (30 dias ou mais)",
  pagamento: "Pagamento recebido",
};

export const VARIAVEIS_MENSAGEM: Record<string, string> = {
  cliente: "nome do cliente",
  descricao: "o que está sendo cobrado",
  valor: "valor da cobrança",
  vencimento: "data de vencimento",
  dias: "dias até o vencimento ou de atraso",
  valor_atualizado: "valor com multa e juros até hoje",
  valor_pago: "valor recebido",
  data_pagamento: "data do pagamento",
  escritorio: "nome do escritório",
};

export interface TextoMensagem {
  assunto: string;
  texto: string;
}

export const MENSAGENS_PADRAO: Record<TipoMensagem, TextoMensagem> = {
  emissao: {
    assunto: "{descricao} — vence em {vencimento}",
    texto:
      "Olá, {cliente}!\n\nA cobrança de {descricao}, no valor de {valor}, já está disponível, com vencimento em {vencimento}.\n\nPara pagar, aponte a câmera do aplicativo do seu banco para o QR code ou use o Pix copia e cola abaixo.",
  },
  antes: {
    assunto: "Lembrete: {descricao} vence em {vencimento}",
    texto:
      "Olá, {cliente}!\n\nPassando para lembrar que a cobrança de {descricao}, no valor de {valor}, vence em {vencimento} (daqui a {dias} dias).\n\nO Pix para pagamento está abaixo. Se já pagou, desconsidere esta mensagem.",
  },
  no_dia: {
    assunto: "Vence hoje: {descricao}",
    texto: "Olá, {cliente}!\n\nA cobrança de {descricao}, no valor de {valor}, vence hoje.\n\nO Pix está logo abaixo. Se já pagou, obrigado e desconsidere esta mensagem.",
  },
  atraso: {
    assunto: "Em aberto: {descricao}",
    texto:
      "Olá, {cliente}!\n\nAinda não identificamos o pagamento de {descricao}, que venceu em {vencimento} (há {dias} dias). Com multa e juros, o valor até hoje é {valor_atualizado}.\n\nO Pix abaixo já está com o valor atualizado. Se já pagou, envie o comprovante pela central de mensagens do portal.",
  },
  formal: {
    assunto: "Aviso de débito em aberto: {descricao}",
    texto:
      "Prezado(a) {cliente},\n\nConsta em aberto o pagamento de {descricao}, vencido em {vencimento}, há {dias} dias. O valor atualizado é {valor_atualizado}.\n\nPedimos a regularização o quanto antes. Se precisar negociar, fale com o escritório. Se o pagamento já foi feito, desconsidere este aviso e envie o comprovante pela central de mensagens do portal.",
  },
  pagamento: {
    assunto: "Pagamento recebido: {descricao}",
    texto: "Olá, {cliente}!\n\nRecebemos o pagamento de {descricao}, no valor de {valor_pago}, em {data_pagamento}. Muito obrigado!\n\nO recibo segue anexo e também fica no portal.",
  },
};

/** Tipo de texto conforme o motivo do envio e os dias em relação ao vencimento. */
export function tipoDaMensagem(motivo: string, dias: number | null): TipoMensagem {
  if (motivo === "pagamento") return "pagamento";
  if (motivo !== "lembrete" || dias === null) return "emissao";
  if (dias < 0) return "antes";
  if (dias === 0) return "no_dia";
  return dias < 30 ? "atraso" : "formal";
}

export function textoDaMensagem(tipo: TipoMensagem, editadas: unknown): TextoMensagem {
  const e = (editadas && typeof editadas === "object" ? (editadas as Record<string, Partial<TextoMensagem>>)[tipo] : null) ?? null;
  return {
    assunto: e?.assunto?.trim() || MENSAGENS_PADRAO[tipo].assunto,
    texto: e?.texto?.trim() || MENSAGENS_PADRAO[tipo].texto,
  };
}

/** Troca {variavel} pelo valor (variável desconhecida fica como está). */
export function preencher(modelo: string, variaveis: Record<string, string>) {
  return modelo.replace(/\{([a-z_]+)\}/g, (inteiro, nome: string) => (nome in variaveis ? variaveis[nome] : inteiro));
}

/**
 * Frase curta do WhatsApp (parâmetro {{2}} do modelo aprovado na Meta), sem
 * quebras de linha.
 */
export function resumoWhatsapp(tipo: TipoMensagem, v: Record<string, string>) {
  const textos: Record<TipoMensagem, string> = {
    emissao: "A cobrança de {descricao} ({valor}) está disponível, com vencimento em {vencimento}.",
    antes: "Lembrete: {descricao} ({valor}) vence em {vencimento}.",
    no_dia: "{descricao} ({valor}) vence hoje.",
    atraso: "{descricao} venceu em {vencimento}. Valor atualizado até hoje: {valor_atualizado}.",
    formal: "Consta em aberto {descricao}, vencida em {vencimento}. Valor atualizado: {valor_atualizado}. Se precisar negociar, fale com o escritório.",
    pagamento: "Recebemos o pagamento de {descricao}. Obrigado!",
  };
  return preencher(textos[tipo], v);
}
