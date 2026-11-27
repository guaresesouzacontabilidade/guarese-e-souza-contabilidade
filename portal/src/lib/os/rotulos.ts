/** Rótulos e contas de tempo das ordens de serviço (usados nas telas e nos testes). */

export const ETAPAS_ESTEIRA = ["fila", "execucao", "pronta", "entregue"] as const;
export type EtapaOs = (typeof ETAPAS_ESTEIRA)[number] | "cancelada";

export const ETAPA: Record<EtapaOs, { rotulo: string; curto: string; variante: "neutro" | "info" | "alerta" | "sucesso" | "perigo" }> = {
  fila: { rotulo: "Chegou", curto: "Na fila", variante: "neutro" },
  execucao: { rotulo: "Em execução", curto: "Em execução", variante: "info" },
  pronta: { rotulo: "Pronta para entrega", curto: "Pronta", variante: "sucesso" },
  entregue: { rotulo: "Entregue", curto: "Entregue", variante: "neutro" },
  cancelada: { rotulo: "Cancelada", curto: "Cancelada", variante: "perigo" },
};

export const PRIORIDADE: Record<string, { rotulo: string; variante: "neutro" | "alerta" | "perigo"; peso: number }> = {
  urgente: { rotulo: "Urgente", variante: "perigo", peso: 0 },
  alta: { rotulo: "Alta", variante: "alerta", peso: 1 },
  normal: { rotulo: "Normal", variante: "neutro", peso: 2 },
};

export const DIAS_SEMANA = [
  { valor: 1, rotulo: "Seg" },
  { valor: 2, rotulo: "Ter" },
  { valor: 3, rotulo: "Qua" },
  { valor: 4, rotulo: "Qui" },
  { valor: 5, rotulo: "Sex" },
  { valor: 6, rotulo: "Sáb" },
  { valor: 7, rotulo: "Dom" },
];

/** O que a tela precisa de uma OS para as contas de tempo. */
export interface TempoOs {
  etapa: string;
  minutos_estimados: number | string;
  minutos_execucao: number | string;
  minutos_pausa: number | string;
  execucao_desde: string | null;
  pausada: boolean;
  pausada_em: string | null;
  aberta_em: string;
  iniciada_em: string | null;
  pronta_em: string | null;
  entregue_em: string | null;
  prazo: string | null;
  previsao: string | null;
}

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const minutosEntre = (de: string | null, ate: number) => (de ? Math.max((ate - new Date(de).getTime()) / 60000, 0) : 0);

/** 76 → "1h 16min"; 45 → "45 min"; 0,4 → "menos de 1 min". */
export function formatarMinutos(min: number | string | null | undefined): string {
  const m = Math.round(n(min));
  if (n(min) > 0 && m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 100) {
    const d = Math.floor(h / 24);
    const hr = h % 24;
    return `${d}d${hr ? ` ${hr}h` : ""}`;
  }
  return r ? `${h}h ${r}min` : `${h}h`;
}

/** Tempo de execução até agora (sem as pausas). */
export function execucaoAgora(o: TempoOs, agora = Date.now()): number {
  return n(o.minutos_execucao) + (o.etapa === "execucao" && !o.pausada ? minutosEntre(o.execucao_desde, agora) : 0);
}

/** Tempo de pausa até agora. */
export function pausaAgora(o: TempoOs, agora = Date.now()): number {
  return n(o.minutos_pausa) + (o.pausada ? minutosEntre(o.pausada_em, agora) : 0);
}

/** Há quanto tempo a OS está na etapa atual (para o relógio do cartão). */
export function tempoNaEtapa(o: TempoOs, agora = Date.now()): number {
  switch (o.etapa) {
    case "fila":
      return minutosEntre(o.aberta_em, agora);
    case "execucao":
      return execucaoAgora(o, agora);
    case "pronta":
      return minutosEntre(o.pronta_em, agora);
    case "entregue":
      return o.entregue_em && o.pronta_em ? Math.max((new Date(o.entregue_em).getTime() - new Date(o.pronta_em).getTime()) / 60000, 0) : 0;
    default:
      return 0;
  }
}

/** Andamento do tempo de execução em relação ao estimado. */
export function andamento(o: TempoOs, agora = Date.now()): { percentual: number; situacao: "ok" | "perto" | "estourou" } {
  const est = n(o.minutos_estimados);
  const real = execucaoAgora(o, agora);
  if (est <= 0) return { percentual: 0, situacao: "ok" };
  const p = (real / est) * 100;
  return { percentual: Math.round(p), situacao: p > 100 ? "estourou" : p >= 80 ? "perto" : "ok" };
}

/** Data de entrega que vale (o prazo combinado ou, sem ele, a previsão). */
export function entregaPrevista(o: Pick<TempoOs, "prazo" | "previsao">): string | null {
  return o.prazo ?? o.previsao;
}

/** Atrasada: passou do prazo combinado (ou da previsão) e ainda não ficou pronta. */
export function atrasada(o: TempoOs, agora = Date.now()): boolean {
  const limite = entregaPrevista(o);
  if (!limite) return false;
  if (o.etapa === "fila" || o.etapa === "execucao") return new Date(limite).getTime() < agora;
  if ((o.etapa === "pronta" || o.etapa === "entregue") && o.pronta_em) return new Date(o.pronta_em).getTime() > new Date(limite).getTime();
  return false;
}

/** Monta a mensagem do WhatsApp com as variáveis {cliente}, {numero}, {link} e {loja}. */
export function montarMensagem(modelo: string | null | undefined, v: { cliente: string; numero: number | string; link: string; loja: string }): string {
  const base = modelo?.trim() || "Olá, {cliente}! Sua ordem de serviço nº {numero} está pronta para retirada. Acompanhe: {link}";
  return base
    .replaceAll("{cliente}", v.cliente.trim().split(/\s+/)[0] ?? v.cliente)
    .replaceAll("{numero}", String(v.numero))
    .replaceAll("{link}", v.link)
    .replaceAll("{loja}", v.loja);
}

/** Link do WhatsApp (wa.me) para o telefone com DDD (Brasil). */
export function linkWhatsApp(telefone: string | null | undefined, texto: string): string | null {
  const d = (telefone ?? "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return null;
  const comPais = d.length >= 12 && d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${comPais}?text=${encodeURIComponent(texto)}`;
}

/** "qui, 26/11 às 15:20" no horário de Brasília. */
export function formatarEntrega(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Araguaina" }).replace(".", "");
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Araguaina" });
  return `${dia} às ${hora}`;
}

/** Tempo estimado de um item: fixo + por unidade × quantidade. */
export function minutosDoItem(servico: { minutos_fixos: number | string; minutos_por_unidade: number | string } | null, quantidade: number, minutosAvulso = 0): number {
  if (!servico) return Math.max(minutosAvulso, 0);
  return Math.round((n(servico.minutos_fixos) + n(servico.minutos_por_unidade) * quantidade) * 100) / 100;
}

// -----------------------------------------------------------------------------
// Recebimentos, aviso automático e assinatura
// -----------------------------------------------------------------------------
export const FORMAS_PAGAMENTO_OS = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "pix", rotulo: "PIX" },
  { valor: "cartao_debito", rotulo: "Débito" },
  { valor: "cartao_credito", rotulo: "Crédito" },
  { valor: "transferencia", rotulo: "Transferência" },
  { valor: "a_receber", rotulo: "A receber" },
  { valor: "outro", rotulo: "Outra" },
] as const;

export const ROTULO_FORMA_OS: Record<string, string> = Object.fromEntries(FORMAS_PAGAMENTO_OS.map((f) => [f.valor, f.rotulo]));

export interface ValoresOs {
  valor_total: number | string;
  valor_recebido: number | string;
  valor_a_receber: number | string;
}

/** Quanto falta receber (o "a receber" já combinado com o cliente não conta como falta). */
export function faltaReceber(o: ValoresOs): number {
  return Math.max(Math.round((n(o.valor_total) - n(o.valor_recebido) - n(o.valor_a_receber)) * 100) / 100, 0);
}

/** Situação do pagamento para o cartão da esteira. */
export function situacaoPagamento(o: ValoresOs): "sem_valor" | "pago" | "a_receber" | "parcial" | "aberto" {
  if (n(o.valor_total) <= 0) return "sem_valor";
  const falta = faltaReceber(o);
  if (falta <= 0) return n(o.valor_a_receber) > 0 ? "a_receber" : "pago";
  return n(o.valor_recebido) + n(o.valor_a_receber) > 0 ? "parcial" : "aberto";
}

export const AVISO_WHATSAPP: Record<string, { rotulo: string; tom: "info" | "sucesso" | "alerta" | "perigo" | "neutro" }> = {
  pendente: { rotulo: "Aviso pelo WhatsApp na fila", tom: "info" },
  enviado: { rotulo: "Cliente avisado pelo WhatsApp", tom: "sucesso" },
  falhou: { rotulo: "O aviso pelo WhatsApp falhou", tom: "perigo" },
  nao_configurado: { rotulo: "WhatsApp da loja desconectado: avise pelo botão", tom: "alerta" },
  dispensado: { rotulo: "Aviso pelo WhatsApp dispensado", tom: "neutro" },
};

/**
 * Parâmetros do modelo aprovado na Meta para "OS pronta":
 * {{1}} primeiro nome do cliente, {{2}} número da OS, {{3}} loja, {{4}} link de acompanhamento.
 */
export function parametrosAvisoOs(v: { cliente: string; numero: number | string; loja: string; link: string }): string[] {
  const limpo = (t: string) => t.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 300);
  return [limpo(v.cliente.trim().split(/\s+/)[0] || v.cliente), String(v.numero), limpo(v.loja), v.link];
}

export const MODELO_AVISO_SUGERIDO =
  "Olá, {{1}}! Sua ordem de serviço nº {{2}} na {{3}} está pronta para retirada. Acompanhe pelo link: {{4}}";

export const MOMENTOS_FOTO = [
  { valor: "entrada", rotulo: "Material recebido" },
  { valor: "execucao", rotulo: "Durante o serviço" },
  { valor: "pronta", rotulo: "Serviço pronto" },
  { valor: "retirada", rotulo: "Retirada" },
  { valor: "outro", rotulo: "Outra" },
] as const;

/** Assinatura desenhada na tela: PNG em data URL (até ~300 KB). */
export function assinaturaValida(dataUrl: string | null | undefined): boolean {
  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) return false;
  const b64 = dataUrl.slice("data:image/png;base64,".length);
  return /^[A-Za-z0-9+/]+={0,2}$/.test(b64) && b64.length > 200 && b64.length <= 400_000;
}
