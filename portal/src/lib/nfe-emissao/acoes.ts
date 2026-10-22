"use server";

import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { somenteDigitos } from "@/lib/formatos";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { ErroConsultaCnpj, consultarCnpjReceita } from "@/lib/empresas/receita";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { credencialDaEmpresa } from "@/lib/nfse-emissao/emitir";
import { envServidor } from "@/lib/env-servidor";
import { calcularNota, type EntradaNfe } from "./calculo";
import { resumoTotais } from "./emitir";
import { fmt } from "./decimal";
import { statusServico, AUTORIZADORES, autorizadorDaUf } from "./sefaz";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// As telas da emissão são dinâmicas e os formulários atualizam a página depois
// de mostrar a mensagem: as ações não revalidam.

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}
/** Número digitado no padrão brasileiro ("12,5", "1.234,56") no formato do banco ("12.5"); vazio = null. */
function numero(fd: FormData, nome: string): string | null {
  const t = texto(fd, nome).replace(/\s|R\$|%/g, "");
  if (!t) return null;
  const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^-?\d+(\.\d+)?$/.test(n) ? n : "invalido";
}
const marcado = (fd: FormData, nome: string) => fd.get(nome) === "on" || fd.get(nome) === "true";

async function contexto(empresaId: string, permissao: "nfe.emitir" | "nfe.configurar") {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  return ctx.pode(permissao) ? ctx : null;
}

function numerosValidos(campos: Record<string, string | null>): string | null {
  for (const [nome, v] of Object.entries(campos)) if (v === "invalido") return nome;
  return null;
}

// -----------------------------------------------------------------------------
// Configuração e cadastros do escritório
// -----------------------------------------------------------------------------

export async function salvarConfiguracao(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.configurar");
  if (!ctx) return falha("Somente a equipe do escritório configura a emissão de NF-e.");
  const funrural = numero(fd, "funrural_percentual");
  if (funrural === "invalido") return falha("Percentual do FUNRURAL inválido.", { funrural_percentual: ["Número inválido."] });
  const { error } = await ctx.supabase.rpc("nfe_configurar", {
    p_empresa_id: empresaId,
    p_dados: {
      ativa: marcado(fd, "ativa"),
      ambiente: texto(fd, "ambiente") || "homologacao",
      crt: Number(texto(fd, "crt") || 3),
      presenca: Number(texto(fd, "presenca") || 9),
      funrural_percentual: funrural,
      funrural_modo: texto(fd, "funrural_modo") || null,
      enviar_email_destinatario: marcado(fd, "enviar_email_destinatario"),
      autorizar_escritorio_xml: marcado(fd, "autorizar_escritorio_xml"),
      informacoes_padrao: texto(fd, "informacoes_padrao"),
      autorizacao_texto: texto(fd, "autorizacao_texto"),
    } as never,
  });
  if (error) {
    const m = mensagemErro(error);
    return falha(m, /autorizou o portal/.test(m) ? { autorizacao_texto: [m] } : undefined);
  }
  return sucesso("Configuração da NF-e salva.");
}

export async function salvarEmitente(empresaId: string, id: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.configurar");
  if (!ctx) return falha("Somente a equipe do escritório cadastra as inscrições.");
  const serie = texto(fd, "serie");
  if (!/^\d{1,3}$/.test(serie)) return falha("Informe a série (número).", { serie: ["Série inválida."] });
  if (!/^\d{7}$/.test(texto(fd, "municipio_ibge"))) return falha("Escolha o município.", { municipio_ibge: ["Escolha o município."] });
  const { error } = await ctx.supabase.rpc("nfe_emitente_salvar", {
    p_empresa_id: empresaId,
    p_id: id && UUID.test(id) ? id : (null as never),
    p_dados: {
      nome: texto(fd, "nome"),
      inscricao_estadual: texto(fd, "inscricao_estadual"),
      logradouro: texto(fd, "logradouro"),
      numero: texto(fd, "numero"),
      complemento: texto(fd, "complemento"),
      bairro: texto(fd, "bairro"),
      municipio_ibge: texto(fd, "municipio_ibge"),
      cep: texto(fd, "cep"),
      telefone: texto(fd, "telefone"),
      serie: Number(serie),
      proximo_numero_homologacao: Number(texto(fd, "proximo_numero_homologacao") || 1),
      proximo_numero_producao: Number(texto(fd, "proximo_numero_producao") || 1),
      ativo: !marcado(fd, "inativo"),
    } as never,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso("Inscrição salva.");
}

export async function salvarProduto(empresaId: string, id: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.configurar");
  if (!ctx) return falha("Somente a equipe do escritório cadastra os produtos.");
  const peso = numero(fd, "peso_kg");
  const valor = numero(fd, "valor_unitario");
  const ruim = numerosValidos({ peso_kg: peso, valor_unitario: valor });
  if (ruim) return falha("Número inválido.", { [ruim]: ["Número inválido."] });
  if (!/^\d{8}$/.test(somenteDigitos(texto(fd, "ncm")))) return falha("O NCM tem 8 números.", { ncm: ["O NCM tem 8 números."] });
  const { error } = await ctx.supabase.rpc("nfe_produto_salvar", {
    p_empresa_id: empresaId,
    p_id: id && UUID.test(id) ? id : (null as never),
    p_dados: {
      codigo: texto(fd, "codigo"),
      descricao: texto(fd, "descricao"),
      ncm: texto(fd, "ncm"),
      cest: texto(fd, "cest"),
      gtin: texto(fd, "gtin"),
      unidade: texto(fd, "unidade"),
      peso_kg: peso,
      valor_unitario: valor,
      origem: Number(texto(fd, "origem") || 0),
      ativo: !marcado(fd, "inativo"),
    } as never,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso("Produto salvo.");
}

const esquemaContribuicao = z.object({
  nome: z.string().trim().min(2).max(60),
  tipo: z.enum(["upf_por_tonelada", "valor_por_tonelada", "percentual_valor"]),
  valor: z.coerce.number().positive(),
  valorUpf: z.coerce.number().positive().nullable().optional(),
  ncms: z.array(z.string().max(8)).max(20).default([]),
  codigoReceita: z.string().max(20).nullable().optional(),
});

export async function salvarOperacao(empresaId: string, id: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.configurar");
  if (!ctx) return falha("Somente a equipe do escritório cadastra as operações (regras fiscais).");
  const nums = {
    icms_aliquota: numero(fd, "icms_aliquota"),
    icms_reducao: numero(fd, "icms_reducao"),
    icms_diferimento: numero(fd, "icms_diferimento"),
    icms_credito_sn: numero(fd, "icms_credito_sn"),
    pis_aliquota: numero(fd, "pis_aliquota"),
    cofins_aliquota: numero(fd, "cofins_aliquota"),
    ibscbs_diferimento: numero(fd, "ibscbs_diferimento"),
    frete_aliquota: numero(fd, "frete_aliquota"),
    frete_reducao: numero(fd, "frete_reducao"),
  };
  const ruim = numerosValidos(nums);
  if (ruim) return falha("Número inválido.", { [ruim]: ["Número inválido."] });
  let contribuicoes: z.infer<typeof esquemaContribuicao>[] = [];
  try {
    const bruto = JSON.parse(texto(fd, "contribuicoes") || "[]");
    const r = z.array(esquemaContribuicao).max(10).safeParse(bruto);
    if (!r.success) return falha("Revise as contribuições estaduais (nome, tipo e valor).");
    contribuicoes = r.data;
  } catch {
    return falha("Revise as contribuições estaduais.");
  }
  const { error } = await ctx.supabase.rpc("nfe_operacao_salvar", {
    p_empresa_id: empresaId,
    p_id: id && UUID.test(id) ? id : (null as never),
    p_dados: {
      nome: texto(fd, "nome"),
      natureza: texto(fd, "natureza"),
      finalidade: Number(texto(fd, "finalidade") || 1),
      destino: texto(fd, "destino"),
      consumidor_final: marcado(fd, "consumidor_final"),
      cfop: texto(fd, "cfop"),
      icms_cst: texto(fd, "icms_cst"),
      icms_beneficio: texto(fd, "icms_beneficio"),
      pis_cst: texto(fd, "pis_cst"),
      cofins_cst: texto(fd, "cofins_cst"),
      excluir_icms_pis_cofins: marcado(fd, "excluir_icms_pis_cofins"),
      ibscbs_cclass_trib: texto(fd, "ibscbs_cclass_trib"),
      difal_metodo: texto(fd, "difal_metodo"),
      difal_codigo_receita: texto(fd, "difal_codigo_receita"),
      icms_por_operacao: marcado(fd, "icms_por_operacao"),
      icms_codigo_receita: texto(fd, "icms_codigo_receita"),
      frete_icms_retido: marcado(fd, "frete_icms_retido"),
      frete_cfop: texto(fd, "frete_cfop"),
      frete_codigo_receita: texto(fd, "frete_codigo_receita"),
      incide_funrural: marcado(fd, "incide_funrural"),
      contribuicoes,
      informacoes: texto(fd, "informacoes"),
      ativa: !marcado(fd, "inativa"),
      ...nums,
    } as never,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso("Operação salva.");
}

// -----------------------------------------------------------------------------
// Clientes e transportadores (quem emite também cadastra)
// -----------------------------------------------------------------------------

export interface CnpjReceita {
  nome: string;
  email: string | null;
  telefone: string | null;
  endereco: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; codigo_municipio: string | null; municipio: string | null; uf: string | null; cep: string | null };
}

/** Nome e endereço de um CNPJ nos dados abertos da Receita (a inscrição estadual não vem: é preciso pedir ao cliente). */
export async function buscarCnpj(empresaId: string, cnpj: string): Promise<ResultadoAcao<CnpjReceita>> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx) return falha("Sem permissão para emitir notas desta empresa.");
  try {
    const r = await consultarCnpjReceita(cnpj);
    return sucesso("Dados preenchidos pela Receita. Confira e informe a inscrição estadual.", {
      nome: r.razaoSocial.slice(0, 60),
      email: r.email,
      telefone: r.telefones[0] ?? null,
      endereco: {
        logradouro: r.endereco.logradouro,
        numero: r.endereco.numero,
        complemento: r.endereco.complemento,
        bairro: r.endereco.bairro,
        codigo_municipio: r.endereco.codigoIbge,
        municipio: r.endereco.municipio,
        uf: r.endereco.uf,
        cep: r.endereco.cep,
      },
    });
  } catch (e) {
    return falha(e instanceof ErroConsultaCnpj ? e.message : "Não foi possível consultar a Receita agora. Preencha os dados à mão.");
  }
}

/** Municípios de uma UF (tabela do IBGE), para o endereço do cliente. */
export async function municipiosDaUf(empresaId: string, uf: string): Promise<{ ibge: string; nome: string }[]> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx || !/^[A-Z]{2}$/.test(uf)) return [];
  const { data } = await ctx.supabase.from("municipios").select("ibge, nome").eq("uf", uf).order("nome").limit(1000);
  return data ?? [];
}

export async function salvarDestinatario(empresaId: string, id: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx) return falha("Sem permissão para cadastrar clientes desta empresa.");
  const { data, error } = await ctx.supabase.rpc("nfe_destinatario_salvar", {
    p_empresa_id: empresaId,
    p_id: id && UUID.test(id) ? id : (null as never),
    p_dados: {
      tipo: texto(fd, "tipo"),
      documento: texto(fd, "documento"),
      nome: texto(fd, "nome"),
      indicador_ie: Number(texto(fd, "indicador_ie") || 9),
      inscricao_estadual: texto(fd, "inscricao_estadual"),
      logradouro: texto(fd, "logradouro"),
      numero: texto(fd, "numero"),
      complemento: texto(fd, "complemento"),
      bairro: texto(fd, "bairro"),
      municipio_ibge: texto(fd, "municipio_ibge"),
      codigo_pais: texto(fd, "codigo_pais"),
      pais: texto(fd, "pais"),
      cidade_exterior: texto(fd, "cidade_exterior"),
      cep: texto(fd, "cep"),
      telefone: texto(fd, "telefone"),
      email: texto(fd, "email"),
    } as never,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso("Cliente salvo.", { id: data as string });
}

export async function salvarTransportador(empresaId: string, id: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx) return falha("Sem permissão para cadastrar transportadores desta empresa.");
  const { data, error } = await ctx.supabase.rpc("nfe_transportador_salvar", {
    p_empresa_id: empresaId,
    p_id: id && UUID.test(id) ? id : (null as never),
    p_dados: {
      tipo: texto(fd, "tipo"),
      documento: texto(fd, "documento"),
      nome: texto(fd, "nome"),
      inscricao_estadual: texto(fd, "inscricao_estadual"),
      endereco: texto(fd, "endereco"),
      municipio: texto(fd, "municipio"),
      uf: texto(fd, "uf"),
      placa: texto(fd, "placa"),
      placa_uf: texto(fd, "placa_uf"),
      rntc: texto(fd, "rntc"),
    } as never,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso("Transportador salvo.", { id: data as string });
}

// -----------------------------------------------------------------------------
// Emissão
// -----------------------------------------------------------------------------

const esquemaPedido = z.object({
  emitente_id: z.string().regex(UUID, "Escolha quem emite."),
  operacao_id: z.string().regex(UUID, "Escolha a operação."),
  destinatario_id: z.string().regex(UUID, "Escolha o cliente."),
  itens: z
    .array(
      z.object({
        produto_id: z.string().regex(UUID, "Escolha o produto."),
        quantidade: z.string().regex(/^\d+(\.\d{1,4})?$/, "Quantidade inválida (até 4 casas decimais)."),
        valor_unitario: z.string().regex(/^\d+(\.\d{1,10})?$/, "Preço inválido."),
        descricao: z.string().max(120).optional(),
        informacoes: z.string().max(500).optional(),
      }),
    )
    .min(1, "Inclua ao menos um produto.")
    .max(990),
  frete: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().or(z.literal("")),
  seguro: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().or(z.literal("")),
  outras: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().or(z.literal("")),
  desconto: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().or(z.literal("")),
  transporte: z.object({
    modalidade: z.coerce.number().int(),
    transportador_id: z.string().regex(UUID).optional().or(z.literal("")).transform((v) => v || undefined),
    placa: z.string().max(10).optional(),
    placa_uf: z.string().max(2).optional(),
    rntc: z.string().max(20).optional(),
    volumes_quantidade: z.string().regex(/^\d{0,15}$/).optional(),
    especie: z.string().max(60).optional(),
    marca: z.string().max(60).optional(),
    frete_servico: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().or(z.literal("")),
  }),
  pagamento: z.object({
    forma: z.string().regex(/^\d{2}$/),
    descricao: z.string().max(60).optional(),
    a_prazo: z.boolean().default(false),
    parcelas: z.array(z.object({ vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valor: z.string().regex(/^\d+(\.\d{1,2})?$/) })).max(120).default([]),
  }),
  referencias: z.array(z.string().regex(/^\d{44}$/, "Chave de acesso com 44 números.")).max(20).default([]),
  informacoes: z.string().max(2000).optional(),
  pedido_compra: z.string().max(15).optional(),
  confirmar_repetida: z.boolean().optional(),
});
export type PedidoNfe = z.input<typeof esquemaPedido>;

export interface PreviaNfe {
  totais: ReturnType<typeof resumoTotais>;
  itens: { descricao: string; quantidade: string; unidade: string; valor: string; cfop: string; icms: string; vICMS: string }[];
  guias: { tipo: string; descricao: string; uf: string; valor: string }[];
  textos: string[];
  idDest: number;
}

/** Confere os valores da nota antes de emitir: dados montados pelo banco (regras da operação) e o mesmo cálculo da emissão. */
export async function previaNota(empresaId: string, pedido: PedidoNfe): Promise<ResultadoAcao<PreviaNfe>> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx) return falha("Sem permissão para emitir notas desta empresa.");
  const p = esquemaPedido.safeParse(pedido);
  if (!p.success) return falhaValidacao(p.error);
  const { data, error } = await ctx.supabase.rpc("nfe_previa", { p_empresa_id: empresaId, p_dados: p.data as never });
  if (error) return falha(mensagemErro(error));
  const dados = data as unknown as Omit<EntradaNfe, "ambiente" | "emitidaEm" | "serie" | "numero" | "codigoNumerico">;
  try {
    const n = calcularNota({ ...dados, ambiente: "homologacao", emitidaEm: new Date(), serie: 1, numero: 1, codigoNumerico: "10000000" });
    return sucesso(undefined, {
      totais: resumoTotais(n),
      itens: n.itens.map((i) => ({
        descricao: i.entrada.descricao,
        quantidade: fmt(i.quantidade, 4),
        unidade: i.entrada.unidade,
        valor: fmt(i.vProd, 2),
        cfop: i.entrada.cfop,
        icms: `${i.entrada.origem}${i.icms.cst}${i.icms.pICMS != null ? ` ${fmt(i.icms.pICMS, 2).replace(".", ",")}%` : ""}`,
        vICMS: fmt(i.icms.vICMS, 2),
      })),
      guias: n.guias.map((g) => ({ tipo: g.tipo, descricao: g.descricao, uf: g.uf, valor: fmt(g.valor, 2) })),
      textos: n.textosAutomaticos,
      idDest: n.idDest,
    });
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível calcular a nota.");
  }
}

/** Emite (ou corrige e envia de novo, com o mesmo número, a nota rejeitada `corrigir`). */
export async function emitirNota(
  empresaId: string,
  pedido: PedidoNfe,
  corrigir?: string | null,
  vendaId?: string | null,
): Promise<ResultadoAcao<{ id?: string; repetida?: boolean }>> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx) return falha("Sem permissão para emitir notas desta empresa.");
  const p = esquemaPedido.safeParse(pedido);
  if (!p.success) return falhaValidacao(p.error);
  const { data, error } = await ctx.supabase.rpc("nfe_emitir", {
    p_empresa_id: empresaId,
    p_dados: p.data as never,
    p_id: corrigir && UUID.test(corrigir) ? corrigir : (null as never),
  });
  if (error) {
    if ((error as { code?: string }).code === "P0002") return { ok: false, mensagem: mensagemErro(error), dados: { repetida: true } };
    return falha(mensagemErro(error));
  }
  processarFilaDepois({ tipos: ["emitir_nfe"], limite: 5 });
  const r = data as { id: string; numero: number };
  // Nota feita a partir de uma venda da loja: a venda fica ligada à nota
  if (vendaId && UUID.test(vendaId)) {
    const { error: eVinculo } = await ctx.supabase.rpc("gestao_venda_vincular_nfe", { p_venda_id: vendaId, p_nfe_id: r.id });
    if (eVinculo) return sucesso(`Nota nº ${r.numero} enviada à SEFAZ. Não foi possível ligá-la à venda: ${mensagemErro(eVinculo)}`, { id: r.id });
  }
  return sucesso(`Nota nº ${r.numero} enviada à SEFAZ.`, { id: r.id });
}

export async function tentarDeNovo(empresaId: string, id: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const { error } = await ctx.supabase.rpc("nfe_tentar_de_novo", { p_id: id });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["emitir_nfe"], limite: 5 });
  return sucesso("Consultando a SEFAZ de novo.");
}

export async function descartarNota(empresaId: string, id: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const { error } = await ctx.supabase.rpc("nfe_descartar", { p_id: id });
  if (error) return falha(mensagemErro(error));
  return sucesso("Nota descartada. O número precisa ser inutilizado na SEFAZ.");
}

export async function cancelarNota(empresaId: string, id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const just = texto(fd, "justificativa");
  if (just.length < 15) return falha("Explique o motivo (ao menos 15 caracteres).", { justificativa: ["Ao menos 15 caracteres."] });
  const { error } = await ctx.supabase.rpc("nfe_cancelar", { p_id: id, p_justificativa: just });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["evento_nfe"], limite: 5 });
  return sucesso("Pedido de cancelamento enviado à SEFAZ.");
}

export async function cartaCorrecao(empresaId: string, id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const correcao = texto(fd, "correcao");
  if (correcao.length < 15) return falha("Descreva a correção (ao menos 15 caracteres).", { correcao: ["Ao menos 15 caracteres."] });
  const { error } = await ctx.supabase.rpc("nfe_carta_correcao", { p_id: id, p_texto: correcao });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["evento_nfe"], limite: 5 });
  return sucesso("Carta de correção enviada à SEFAZ.");
}

// -----------------------------------------------------------------------------
// Guias e conexão
// -----------------------------------------------------------------------------

export async function vincularGuia(empresaId: string, guiaId: string, documentoId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.configurar");
  if (!ctx || !UUID.test(guiaId) || !UUID.test(documentoId)) return falha("Somente a equipe do escritório anexa as guias.");
  const { error } = await ctx.supabase.rpc("nfe_guia_atualizar", { p_id: guiaId, p_situacao: "gerada", p_documento_id: documentoId, p_observacao: null as never });
  if (error) return falha(mensagemErro(error));
  return sucesso("Guia anexada: ela já aparece na agenda de pagamentos do cliente.");
}

export async function dispensarGuia(empresaId: string, guiaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfe.configurar");
  if (!ctx || !UUID.test(guiaId)) return falha("Somente a equipe do escritório altera as guias.");
  const situacao = texto(fd, "situacao") === "a_gerar" ? "a_gerar" : "dispensada";
  const { error } = await ctx.supabase.rpc("nfe_guia_atualizar", {
    p_id: guiaId,
    p_situacao: situacao,
    p_documento_id: null as never,
    p_observacao: texto(fd, "observacao") || (null as never),
  });
  if (error) return falha(mensagemErro(error));
  return sucesso(situacao === "dispensada" ? "Guia marcada como não aplicável." : "Guia voltou para “a gerar”.");
}

/** Pergunta ao autorizador (SEFAZ) se o serviço está no ar, com o certificado da empresa. Consulta real: nada é simulado. */
export async function testarConexao(empresaId: string): Promise<ResultadoAcao<{ cStat: string; xMotivo: string }>> {
  const ctx = await contexto(empresaId, "nfe.configurar");
  if (!ctx) return falha("Somente a equipe do escritório testa a conexão.");
  if (envServidor.notasSemRede()) return falha("A conexão com a SEFAZ está desligada neste ambiente (demonstração).");
  const admin = criarClienteAdmin();
  const [{ data: cfg }, { data: emit }] = await Promise.all([
    admin.from("nfe_config").select("ambiente").eq("empresa_id", empresaId).maybeSingle(),
    admin.from("nfe_emitentes").select("municipio:municipios(uf)").eq("empresa_id", empresaId).eq("ativo", true).limit(1).maybeSingle(),
  ]);
  const uf = (emit?.municipio as { uf?: string } | null)?.uf;
  if (!uf) return falha("Cadastre a inscrição estadual de quem emite (com o município) antes de testar.");
  const cred = await credencialDaEmpresa(admin, empresaId);
  if ("erro" in cred) return falha(cred.erro);
  try {
    const r = await statusServico({ uf, ambiente: (cfg?.ambiente ?? "homologacao") as "homologacao" | "producao", credencial: cred.credencial });
    const nome = AUTORIZADORES[autorizadorDaUf(uf)].nome;
    if (r.cStat === "107") return sucesso(`${nome} respondeu: serviço em operação (o certificado foi aceito na conexão).`, { cStat: r.cStat, xMotivo: r.xMotivo });
    return falha(`${nome} respondeu ${r.cStat}: ${r.xMotivo}`);
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível falar com a SEFAZ.");
  }
}
