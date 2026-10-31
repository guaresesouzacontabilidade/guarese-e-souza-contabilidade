import "server-only";
import type { ContextoHotel } from "./contexto";
import { ATIVAS, type Limpeza, type NaturezaExtra, type StatusReserva, type UnidadeExtra } from "./rotulos";

type Supa = ContextoHotel["supabase"];

export interface CategoriaHotel {
  id: string;
  nome: string;
  descricao: string | null;
  capacidade: number;
  pessoas_incluidas: number;
  diaria: number;
  adicional_pessoa: number;
  ativa: boolean;
  ordem: number;
}

export interface QuartoHotel {
  id: string;
  numero: string;
  andar: string | null;
  camas: string | null;
  observacao: string | null;
  limpeza: Limpeza;
  motivo_manutencao: string | null;
  limpeza_atualizada_em: string | null;
  ativo: boolean;
  ordem: number;
  categoria: { id: string; nome: string; diaria: number; capacidade: number };
}

export interface ReservaResumo {
  id: string;
  numero: number;
  status: StatusReserva;
  entrada: string;
  saida: string;
  adultos: number;
  criancas: number;
  origem: string;
  valor_previsto: number;
  quarto_id: string;
  quarto: string;
  categoria: string;
  hospede_id: string;
  hospede: string;
  telefone: string | null;
}

const CAMPOS_RESERVA =
  "id, numero, status, entrada, saida, adultos, criancas, origem, valor_previsto, quarto_id, hospede_id, quarto:hotel_quartos!hotel_reservas_empresa_id_quarto_id_fkey(numero), categoria:hotel_categorias!hotel_reservas_empresa_id_categoria_id_fkey(nome), hospede:hotel_hospedes!hotel_reservas_empresa_id_hospede_id_fkey(nome, telefone)" as const;

interface LinhaReserva {
  id: string;
  numero: number;
  status: string;
  entrada: string;
  saida: string;
  adultos: number;
  criancas: number;
  origem: string;
  valor_previsto: number;
  quarto_id: string;
  hospede_id: string;
  quarto: { numero: string } | null;
  categoria: { nome: string } | null;
  hospede: { nome: string; telefone: string | null } | null;
}

export function paraResumo(r: LinhaReserva): ReservaResumo {
  return {
    id: r.id,
    numero: r.numero,
    status: r.status as StatusReserva,
    entrada: r.entrada,
    saida: r.saida,
    adultos: r.adultos,
    criancas: r.criancas,
    origem: r.origem,
    valor_previsto: Number(r.valor_previsto),
    quarto_id: r.quarto_id,
    quarto: r.quarto?.numero ?? "—",
    categoria: r.categoria?.nome ?? "",
    hospede_id: r.hospede_id,
    hospede: r.hospede?.nome ?? "—",
    telefone: r.hospede?.telefone ?? null,
  };
}

export interface ExtraHotel {
  id: string;
  nome: string;
  natureza: NaturezaExtra;
  unidade: UnidadeExtra;
  preco: number;
  ativo: boolean;
}

/** Serviços extras com preço fixo (refeições, lavanderia, aluguel...). */
export async function carregarExtras(supabase: Supa, empresaId: string, apenasAtivos = false): Promise<ExtraHotel[]> {
  let q = supabase.from("hotel_extras").select("id, nome, natureza, unidade, preco, ativo, ordem").eq("empresa_id", empresaId);
  if (apenasAtivos) q = q.eq("ativo", true);
  const { data } = await q.order("ordem").order("nome");
  return (data ?? []).map((e) => ({ id: e.id, nome: e.nome, natureza: e.natureza as NaturezaExtra, unidade: e.unidade as UnidadeExtra, preco: Number(e.preco), ativo: e.ativo }));
}

/** Empresas (clientes do Financeiro, com CNPJ ou CPF) para os serviços extras lançados sem hóspede. */
export async function empresasClientesHotel(supabase: Supa, empresaId: string) {
  const { data } = await supabase
    .from("contrapartes")
    .select("id, nome, documento")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .contains("papeis", ["cliente"])
    .order("nome")
    .limit(1000);
  return data ?? [];
}

export type SituacaoRecibo = "pago" | "parcial" | "a_receber" | "vencido" | "cancelado";

export interface ReciboExtra {
  id: string;
  numero: number;
  data: string;
  total: number;
  pagamento: "na_hora" | "a_prazo";
  forma: string | null;
  vencimento: string | null;
  solicitante: string | null;
  observacao: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  empresa: string;
  documento: string | null;
  lancado_por: string | null;
  situacao: SituacaoRecibo;
  pago_em: string | null;
  itens: { descricao: string; unidade: string; quantidade: number; valor_unitario: number; total: number }[];
}

/** Recibos de serviços extras para empresas no período, com a situação do Financeiro. */
export async function listarRecibosExtras(supabase: Supa, empresaId: string, de: string, ate: string): Promise<ReciboExtra[]> {
  const { data, error } = await supabase.rpc("hotel_extras_recibos_listar", { p_empresa_id: empresaId, p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ReciboExtra[]).map((r) => ({
    ...r,
    total: Number(r.total),
    itens: (r.itens ?? []).map((i) => ({ ...i, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario), total: Number(i.total) })),
  }));
}

/** Uma linha de serviço extra do período: na conta do quarto (hóspede) ou no recibo de uma empresa. */
export interface ExtraDoPeriodo {
  data: string;
  hora: string;
  origem: "hospede" | "empresa";
  reserva_numero: number | null;
  quarto: string | null;
  cliente: string;
  documento: string | null;
  solicitante: string | null;
  recibo_numero: number | null;
  servico: string;
  natureza: string | null;
  unidade: string | null;
  quantidade: number;
  valor_unitario: number;
  total: number;
  pagamento: string;
  forma?: string | null;
  situacao: string;
  lancado_por: string | null;
  cancelado: boolean;
  motivo_cancelamento: string | null;
}

/** Todos os serviços extras do período (dia ou mês), base das planilhas. */
export async function extrasDoPeriodo(supabase: Supa, empresaId: string, de: string, ate: string): Promise<ExtraDoPeriodo[]> {
  const { data, error } = await supabase.rpc("hotel_extras_periodo", { p_empresa_id: empresaId, p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ExtraDoPeriodo[]).map((x) => ({
    ...x,
    quantidade: Number(x.quantidade),
    valor_unitario: Number(x.valor_unitario),
    total: Number(x.total),
  }));
}

export type TipoMovimento =
  | "reserva"
  | "checkin"
  | "checkout"
  | "cancelamento"
  | "no_show"
  | "pagamento"
  | "estorno"
  | "consumo"
  | "servico"
  | "desconto"
  | "item_cancelado"
  | "recibo"
  | "recibo_cancelado";

/** O que aconteceu no hotel: uma linha por acontecimento, com quem fez. */
export interface MovimentoHotel {
  quando: string;
  tipo: TipoMovimento;
  reserva_id?: string;
  reserva_numero?: number;
  quarto?: string;
  hospede?: string;
  recibo_id?: string;
  recibo_numero?: number;
  empresa?: string;
  detalhe: string | null;
  forma?: string | null;
  valor?: number | null;
  sessao_id?: string | null;
  quem: string | null;
}

/** Movimento do hotel num intervalo de horário (o turno da recepção ou o dia). */
export async function movimentoHotel(supabase: Supa, empresaId: string, de: string, ate: string): Promise<MovimentoHotel[]> {
  const { data, error } = await supabase.rpc("hotel_movimento", { p_empresa_id: empresaId, p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as MovimentoHotel[]).map((m) => ({ ...m, valor: m.valor == null ? null : Number(m.valor) }));
}

export async function carregarCategorias(supabase: Supa, empresaId: string): Promise<CategoriaHotel[]> {
  const { data } = await supabase
    .from("hotel_categorias")
    .select("id, nome, descricao, capacidade, pessoas_incluidas, diaria, adicional_pessoa, ativa, ordem")
    .eq("empresa_id", empresaId)
    .order("ordem")
    .order("nome");
  return (data ?? []).map((c) => ({ ...c, diaria: Number(c.diaria), adicional_pessoa: Number(c.adicional_pessoa) }));
}

export async function carregarQuartos(supabase: Supa, empresaId: string, apenasAtivos = false): Promise<QuartoHotel[]> {
  let q = supabase
    .from("hotel_quartos")
    .select(
      "id, numero, andar, camas, observacao, limpeza, motivo_manutencao, limpeza_atualizada_em, ativo, ordem, categoria:hotel_categorias!hotel_quartos_empresa_id_categoria_id_fkey(id, nome, diaria, capacidade)",
    )
    .eq("empresa_id", empresaId);
  if (apenasAtivos) q = q.eq("ativo", true);
  const { data } = await q.order("ordem").order("numero");
  return (data ?? [])
    .map((x) => ({
      ...x,
      limpeza: x.limpeza as Limpeza,
      categoria: { id: x.categoria?.id ?? "", nome: x.categoria?.nome ?? "", diaria: Number(x.categoria?.diaria ?? 0), capacidade: x.categoria?.capacidade ?? 1 },
    }))
    .sort((a, b) => a.ordem - b.ordem || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
}

/** Reservas que cruzam o período [de, ate) (ativas e encerradas). */
export async function reservasNoPeriodo(supabase: Supa, empresaId: string, de: string, ate: string): Promise<ReservaResumo[]> {
  const { data } = await supabase
    .from("hotel_reservas")
    .select(CAMPOS_RESERVA)
    .eq("empresa_id", empresaId)
    .in("status", [...ATIVAS, "encerrada"])
    .lt("entrada", ate)
    .gt("saida", de)
    .order("entrada");
  return ((data ?? []) as unknown as LinhaReserva[]).map(paraResumo);
}

export async function reservasPorStatus(supabase: Supa, empresaId: string, status: StatusReserva[]): Promise<ReservaResumo[]> {
  const { data } = await supabase.from("hotel_reservas").select(CAMPOS_RESERVA).eq("empresa_id", empresaId).in("status", status).order("entrada").limit(500);
  return ((data ?? []) as unknown as LinhaReserva[]).map(paraResumo);
}

/** Lista de reservas com filtros (situação, período de entrada, busca pelo hóspede). */
export async function listarReservas(
  supabase: Supa,
  empresaId: string,
  filtro: { status?: string; de?: string; ate?: string; busca?: string; pagina: number; porPagina: number },
): Promise<{ reservas: ReservaResumo[]; total: number }> {
  let ids: string[] | null = null;
  if (filtro.busca) {
    const termo = filtro.busca.replace(/[%,()]/g, " ").trim();
    const { data: hs } = await supabase.from("hotel_hospedes").select("id").eq("empresa_id", empresaId).ilike("nome", `%${termo}%`).limit(200);
    ids = (hs ?? []).map((h) => h.id);
    if (!ids.length) return { reservas: [], total: 0 };
  }
  let q = supabase.from("hotel_reservas").select(CAMPOS_RESERVA, { count: "exact" }).eq("empresa_id", empresaId);
  if (filtro.status === "ativas") q = q.in("status", ATIVAS);
  else if (filtro.status) q = q.eq("status", filtro.status);
  if (filtro.de) q = q.gte("entrada", filtro.de);
  if (filtro.ate) q = q.lte("entrada", filtro.ate);
  if (ids) q = q.in("hospede_id", ids);
  const inicio = (filtro.pagina - 1) * filtro.porPagina;
  const { data, count } = await q.order("entrada", { ascending: false }).order("numero", { ascending: false }).range(inicio, inicio + filtro.porPagina - 1);
  return { reservas: ((data ?? []) as unknown as LinhaReserva[]).map(paraResumo), total: count ?? 0 };
}

export interface ResumoConta {
  status: StatusReserva;
  noites: number;
  diarias: number;
  noites_previstas: number;
  diarias_previstas: number;
  consumo: number;
  servicos: number;
  descontos: number;
  taxa_servico: number;
  taxa_servico_percentual: number | null;
  total: number;
  total_previsto: number;
  pago: number;
  adiantamentos: number;
  saldo: number;
  saldo_previsto: number;
}

export function lerResumo(r: unknown): ResumoConta | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const n = (k: string) => Number(o[k] ?? 0);
  return {
    status: o.status as StatusReserva,
    noites: n("noites"),
    diarias: n("diarias"),
    noites_previstas: n("noites_previstas"),
    diarias_previstas: n("diarias_previstas"),
    consumo: n("consumo"),
    servicos: n("servicos"),
    descontos: n("descontos"),
    taxa_servico: n("taxa_servico"),
    taxa_servico_percentual: o.taxa_servico_percentual == null ? null : Number(o.taxa_servico_percentual),
    total: n("total"),
    total_previsto: n("total_previsto"),
    pago: n("pago"),
    adiantamentos: n("adiantamentos"),
    saldo: n("saldo"),
    saldo_previsto: n("saldo_previsto"),
  };
}

/** Reserva completa: hóspede, acompanhantes, quarto, conta, pagamentos e resumo. */
export async function carregarReserva(supabase: Supa, empresaId: string, reservaId: string) {
  const { data: r } = await supabase
    .from("hotel_reservas")
    .select(
      "*, quarto:hotel_quartos!hotel_reservas_empresa_id_quarto_id_fkey(id, numero, andar, limpeza, camas), categoria:hotel_categorias!hotel_reservas_empresa_id_categoria_id_fkey(id, nome, diaria, capacidade, pessoas_incluidas, adicional_pessoa), hospede:hotel_hospedes!hotel_reservas_empresa_id_hospede_id_fkey(*), faturar:contrapartes!hotel_reservas_empresa_id_empresa_faturar_id_fkey(id, nome, documento)",
    )
    .eq("empresa_id", empresaId)
    .eq("id", reservaId)
    .maybeSingle();
  if (!r) return null;
  const [{ data: itens }, { data: pagamentos }, { data: acomp }, { data: resumo }] = await Promise.all([
    supabase.from("hotel_conta_itens").select("*").eq("reserva_id", reservaId).order("data").order("created_at"),
    supabase
      .from("hotel_pagamentos")
      .select(
        "*, contraparte:contrapartes!hotel_pagamentos_empresa_id_contraparte_id_fkey(nome), sessao:caixa_sessoes!hotel_pagamentos_empresa_id_sessao_id_fkey(status), anexos:hotel_pagamento_anexos!hotel_pagamento_anexos_empresa_id_pagamento_id_fkey(id, nome, mime, enviado_por, confirmado_em, created_at)",
      )
      .eq("reserva_id", reservaId)
      .order("created_at"),
    supabase.from("hotel_reserva_hospedes").select("hospede:hotel_hospedes!hotel_reserva_hospedes_empresa_id_hospede_id_fkey(*)").eq("reserva_id", reservaId),
    supabase.rpc("hotel_conta_resumo", { p_reserva_id: reservaId }),
  ]);
  return {
    reserva: r,
    itens: itens ?? [],
    pagamentos: pagamentos ?? [],
    acompanhantes: (acomp ?? []).flatMap((a) => (a.hospede ? [a.hospede] : [])),
    resumo: lerResumo(resumo),
  };
}

export type ReservaCompleta = NonNullable<Awaited<ReturnType<typeof carregarReserva>>>;

export interface HospedeOpcao {
  id: string;
  nome: string;
  cpf: string | null;
  documento: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
}

export async function opcoesHospedes(supabase: Supa, empresaId: string): Promise<HospedeOpcao[]> {
  const { data } = await supabase
    .from("hotel_hospedes")
    .select("id, nome, cpf, documento, telefone, cidade, uf")
    .eq("empresa_id", empresaId)
    .order("nome")
    .limit(2000);
  return data ?? [];
}

/** Empresas (clientes do Financeiro) que podem receber a fatura da hospedagem. */
export async function empresasParaFaturar(supabase: Supa, empresaId: string) {
  const { data } = await supabase
    .from("contrapartes")
    .select("id, nome, documento")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .contains("papeis", ["cliente"])
    .order("nome")
    .limit(500);
  return (data ?? []).filter((c) => (c.documento ?? "").length === 14);
}

/** Tudo o que o formulário da reserva precisa: quartos, preços, ocupação, hóspedes e empresas. */
export async function dadosFormReserva(supabase: Supa, empresaId: string, hoje: string) {
  const [quartos, categorias, { data: tarifas }, ativas, hospedes, empresas] = await Promise.all([
    carregarQuartos(supabase, empresaId, true),
    carregarCategorias(supabase, empresaId),
    supabase.from("hotel_tarifas").select("categoria_id, inicio, fim, diaria, created_at").eq("empresa_id", empresaId).gte("fim", hoje),
    supabase
      .from("hotel_reservas")
      .select("id, numero, quarto_id, entrada, saida, hospede:hotel_hospedes!hotel_reservas_empresa_id_hospede_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .in("status", ATIVAS)
      .gte("saida", hoje),
    opcoesHospedes(supabase, empresaId),
    empresasParaFaturar(supabase, empresaId),
  ]);
  return {
    quartos: quartos.map((q) => ({ id: q.id, numero: q.numero, categoria_id: q.categoria.id, categoria: q.categoria.nome, capacidade: q.categoria.capacidade, limpeza: q.limpeza })),
    categorias: categorias.map((c) => ({ id: c.id, nome: c.nome, diaria: c.diaria, pessoas_incluidas: c.pessoas_incluidas, adicional_pessoa: c.adicional_pessoa })),
    tarifas: (tarifas ?? []).map((t) => ({ ...t, diaria: Number(t.diaria) })),
    ocupacoes: (ativas.data ?? []).map((r) => ({ reserva_id: r.id, quarto_id: r.quarto_id, entrada: r.entrada, saida: r.saida, numero: r.numero, hospede: r.hospede?.nome ?? "" })),
    hospedes,
    empresas: empresas.map((e) => ({ id: e.id, nome: e.nome })),
  };
}
