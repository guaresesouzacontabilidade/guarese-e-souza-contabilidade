/** Rótulos e cores do módulo de hotelaria (servidor e navegador). */

export type StatusReserva = "pre_reserva" | "confirmada" | "hospedado" | "encerrada" | "cancelada" | "no_show";
export type Limpeza = "limpo" | "sujo" | "em_limpeza" | "manutencao";
export type FormaPagamentoHotel = "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "transferencia" | "faturado" | "outro";

export const STATUS_RESERVA: Record<StatusReserva, string> = {
  pre_reserva: "Pré-reserva",
  confirmada: "Confirmada",
  hospedado: "Hospedado",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
  no_show: "Não compareceu",
};

export const VARIANTE_STATUS: Record<StatusReserva, "neutro" | "info" | "sucesso" | "alerta" | "perigo"> = {
  pre_reserva: "alerta",
  confirmada: "info",
  hospedado: "sucesso",
  encerrada: "neutro",
  cancelada: "perigo",
  no_show: "perigo",
};

/** Cor da barra no mapa de reservas. */
export const COR_STATUS: Record<StatusReserva, string> = {
  pre_reserva: "bg-alerta-bg text-alerta-fg border-alerta/40",
  confirmada: "bg-info-bg text-info-fg border-info/40",
  hospedado: "bg-sucesso-bg text-sucesso-fg border-sucesso/40",
  encerrada: "bg-muted text-muted-foreground border-border",
  cancelada: "bg-perigo-bg text-perigo-fg border-perigo/40",
  no_show: "bg-perigo-bg text-perigo-fg border-perigo/40",
};

export const LIMPEZA: Record<Limpeza, string> = {
  limpo: "Limpo",
  sujo: "Sujo",
  em_limpeza: "Em limpeza",
  manutencao: "Manutenção",
};

export const VARIANTE_LIMPEZA: Record<Limpeza, "sucesso" | "alerta" | "info" | "perigo"> = {
  limpo: "sucesso",
  sujo: "alerta",
  em_limpeza: "info",
  manutencao: "perigo",
};

export const ORIGENS: Record<string, string> = {
  balcao: "Balcão",
  telefone: "Telefone",
  whatsapp: "WhatsApp",
  site: "Site do hotel",
  booking: "Booking.com",
  expedia: "Expedia",
  airbnb: "Airbnb",
  decolar: "Decolar",
  agencia: "Agência de viagens",
  empresa: "Empresa conveniada",
  outro: "Outra",
};

export const FORMAS_PAGAMENTO_HOTEL: Record<FormaPagamentoHotel, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  transferencia: "Transferência",
  faturado: "Faturado para empresa",
  outro: "Outra",
};

export const SETORES: Record<string, string> = {
  restaurante: "Restaurante",
  bar: "Bar",
  frigobar: "Frigobar",
  lavanderia: "Lavanderia",
  recepcao: "Recepção",
  outro: "Outro",
};

export const TIPOS_ITEM: Record<string, string> = {
  diaria: "Diária",
  consumo: "Consumo",
  servico: "Serviço",
  taxa_servico: "Taxa de serviço",
  desconto: "Desconto",
};

/** Ficha Nacional de Registro de Hóspedes (FNRH): motivo da viagem e meio de transporte. */
export const MOTIVOS_VIAGEM: Record<string, string> = {
  lazer: "Lazer / férias",
  negocios: "Negócios",
  congresso: "Congresso / feira",
  parentes: "Visita a parentes e amigos",
  estudos: "Estudos / cursos",
  religiao: "Religião",
  saude: "Saúde",
  compras: "Compras",
  outro: "Outro",
};

export const MEIOS_TRANSPORTE: Record<string, string> = {
  automovel: "Automóvel",
  onibus: "Ônibus",
  aviao: "Avião",
  moto: "Moto",
  navio: "Navio / barco",
  trem: "Trem",
  outro: "Outro",
};

export const TIPOS_DOCUMENTO: Record<string, string> = {
  rg: "RG",
  passaporte: "Passaporte",
  cnh: "CNH",
  rne: "RNE / RNM (estrangeiro)",
  certidao: "Certidão de nascimento",
  outro: "Outro",
};

export const GENEROS: Record<string, string> = {
  feminino: "Feminino",
  masculino: "Masculino",
  outro: "Outro",
  nao_informado: "Prefere não informar",
};

/** Reserva que ainda ocupa (ou vai ocupar) o quarto. */
export const ATIVAS: StatusReserva[] = ["pre_reserva", "confirmada", "hospedado"];

/** Número de noites entre duas datas AAAA-MM-DD. */
export function noites(entrada: string, saida: string) {
  return Math.round((Date.parse(`${saida}T12:00:00Z`) - Date.parse(`${entrada}T12:00:00Z`)) / 86400000);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** "27/10" a partir de AAAA-MM-DD. */
export function diaMes(data: string) {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function diaDaSemana(data: string) {
  return SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()];
}
