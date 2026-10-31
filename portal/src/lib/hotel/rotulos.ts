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
  alimentacao: "Refeições",
  locacao: "Aluguel",
  outro: "Outro",
};

/** Serviços extras com preço fixo: o tipo separa a receita para a contabilidade. */
export type NaturezaExtra = "alimentacao" | "lavanderia" | "locacao" | "outro";
export const NATUREZAS_EXTRA: Record<NaturezaExtra, { rotulo: string; ajuda: string }> = {
  alimentacao: { rotulo: "Refeições e marmitas", ajuda: "Alimentação vendida a preço fixo (refeição, marmita, café avulso)." },
  lavanderia: { rotulo: "Lavanderia", ajuda: "Lavagem e passadoria (por peça, por kg ou por uso)." },
  locacao: { rotulo: "Aluguel (carro e outros)", ajuda: "Aluguel de carro, bicicleta ou equipamento, por dia ou hora." },
  outro: { rotulo: "Outros serviços", ajuda: "Transfer, estacionamento, passeio..." },
};

export type UnidadeExtra = "refeicao" | "marmita" | "unidade" | "peca" | "kg" | "uso" | "dia" | "hora";
export const UNIDADES_EXTRA: Record<UnidadeExtra, { um: string; varios: string }> = {
  refeicao: { um: "refeição", varios: "refeições" },
  marmita: { um: "marmita", varios: "marmitas" },
  unidade: { um: "unidade", varios: "unidades" },
  peca: { um: "peça", varios: "peças" },
  kg: { um: "kg", varios: "kg" },
  uso: { um: "uso", varios: "usos" },
  dia: { um: "dia", varios: "dias" },
  hora: { um: "hora", varios: "horas" },
};

/**
 * Sugestões para o primeiro cadastro (o preço o gerente informa). Fica aqui, e
 * não no componente de cliente, porque a página (servidor) percorre a lista.
 */
export const SUGESTOES_EXTRA: { nome: string; natureza: NaturezaExtra; unidade: UnidadeExtra }[] = [
  { nome: "Marmita", natureza: "alimentacao", unidade: "marmita" },
  { nome: "Refeição", natureza: "alimentacao", unidade: "refeicao" },
  { nome: "Lavanderia (por peça)", natureza: "lavanderia", unidade: "peca" },
  { nome: "Aluguel de carro", natureza: "locacao", unidade: "dia" },
];

/** "3 dias", "1 marmita", "2,5 kg". */
export function quantidadeExtra(qtd: number, unidade: string) {
  const u = UNIDADES_EXTRA[unidade as UnidadeExtra];
  const n = qtd.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return u ? `${n} ${qtd === 1 ? u.um : u.varios}` : n;
}

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

/** Documentos entregues ao hóspede (ficha, confirmação, extrato e recibo) com a identidade do hotel. */
export type ModeloDocumento = "classico" | "faixa" | "economico";
export const MODELOS_DOCUMENTO: Record<ModeloDocumento, { rotulo: string; descricao: string }> = {
  classico: { rotulo: "Clássico", descricao: "Logo à esquerda, contatos à direita e uma linha na cor do hotel." },
  faixa: { rotulo: "Faixa colorida", descricao: "Faixa na cor do hotel no topo, com a logo em destaque." },
  economico: { rotulo: "Econômico", descricao: "Centralizado, em preto e branco: gasta menos tinta." },
};
export const COR_PADRAO_DOCUMENTO = "#1f3b57";
export const CORES_DOCUMENTO: { cor: string; nome: string }[] = [
  { cor: "#1f3b57", nome: "Azul-marinho" },
  { cor: "#1f6f4a", nome: "Verde" },
  { cor: "#7a1f2b", nome: "Vinho" },
  { cor: "#4a2c1d", nome: "Marrom" },
  { cor: "#b45309", nome: "Terracota" },
  { cor: "#0e7490", nome: "Azul-petróleo" },
  { cor: "#5b3a8c", nome: "Roxo" },
  { cor: "#2b2b2b", nome: "Grafite" },
];
