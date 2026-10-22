"use server";

import { z } from "zod";
import { obterContextoEmpresa, type ContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { credencialDaEmpresa } from "@/lib/nfse-emissao/emitir";
import { envServidor } from "@/lib/env-servidor";
import { fmt } from "@/lib/nfe-emissao/decimal";
import { calcularCte, type EntradaCte } from "./calculo";
import { CAMPOS_CCE_CTE } from "./rotulos";
import { lerNfeParaCte, type ParticipanteDaNfe } from "./nfe-origem";
import { AUTORIZADORES_CTE, autorizadorCteDaUf, statusServicoCte } from "./sefaz";

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

async function contexto(empresaId: string, permissao: "cte.emitir" | "cte.configurar") {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  return ctx.pode(permissao) ? ctx : null;
}

// -----------------------------------------------------------------------------
// Configuração do escritório
// -----------------------------------------------------------------------------

export async function salvarConfiguracaoCte(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "cte.configurar");
  if (!ctx) return falha("Somente a equipe do escritório configura a emissão de CT-e.");
  const serie = texto(fd, "serie") || "1";
  if (!/^\d{1,3}$/.test(serie)) return falha("Série inválida.", { serie: ["Série de 0 a 889."] });
  const proximos = { proximo_numero_homologacao: texto(fd, "proximo_numero_homologacao") || "1", proximo_numero_producao: texto(fd, "proximo_numero_producao") || "1" };
  for (const [k, v] of Object.entries(proximos)) if (!/^\d{1,9}$/.test(v) || Number(v) < 1) return falha("Próximo número inválido.", { [k]: ["De 1 a 999.999.999."] });
  const { error } = await ctx.supabase.rpc("cte_configurar", {
    p_empresa_id: empresaId,
    p_dados: {
      ativa: marcado(fd, "ativa"),
      ambiente: texto(fd, "ambiente") || "homologacao",
      crt: Number(texto(fd, "crt") || 3),
      emitente_id: texto(fd, "emitente_id"),
      serie: Number(serie),
      proximo_numero_homologacao: Number(proximos.proximo_numero_homologacao),
      proximo_numero_producao: Number(proximos.proximo_numero_producao),
      rntrc: texto(fd, "rntrc"),
      autorizar_escritorio_xml: marcado(fd, "autorizar_escritorio_xml"),
      informacoes_padrao: texto(fd, "informacoes_padrao"),
      autorizacao_texto: texto(fd, "autorizacao_texto"),
    } as never,
  });
  if (error) {
    const m = mensagemErro(error);
    return falha(m, /autorizou o portal/.test(m) ? { autorizacao_texto: [m] } : /RNTRC/.test(m) ? { rntrc: [m] } : undefined);
  }
  return sucesso("Configuração do CT-e salva.");
}

export async function salvarOperacaoCte(empresaId: string, id: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "cte.configurar");
  if (!ctx) return falha("Somente a equipe do escritório cadastra as operações do frete.");
  const nums = {
    icms_aliquota: numero(fd, "icms_aliquota"),
    icms_reducao: numero(fd, "icms_reducao"),
    icms_credito_presumido: numero(fd, "icms_credito_presumido"),
    ibscbs_diferimento: numero(fd, "ibscbs_diferimento"),
  };
  for (const [k, v] of Object.entries(nums)) if (v === "invalido") return falha("Número inválido.", { [k]: ["Número inválido."] });
  const cst = texto(fd, "icms_cst");
  const { error } = await ctx.supabase.rpc("cte_operacao_salvar", {
    p_empresa_id: empresaId,
    p_id: id && UUID.test(id) ? id : (null as never),
    p_dados: {
      nome: texto(fd, "nome"),
      natureza: texto(fd, "natureza"),
      destino: texto(fd, "destino"),
      cfop: texto(fd, "cfop"),
      icms_cst: cst,
      icms_aliquota: ["00", "20", "60", "90"].includes(cst) ? nums.icms_aliquota : null,
      icms_reducao: cst === "20" ? nums.icms_reducao : null,
      icms_credito_presumido: ["60", "90"].includes(cst) ? nums.icms_credito_presumido : null,
      icms_beneficio: texto(fd, "icms_beneficio"),
      ibscbs_cclass_trib: texto(fd, "ibscbs_cclass_trib"),
      ibscbs_diferimento: nums.ibscbs_diferimento,
      excluir_icms_base_ibscbs: marcado(fd, "excluir_icms_base_ibscbs"),
      informacoes: texto(fd, "informacoes"),
      ativa: !marcado(fd, "inativa"),
    } as never,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso("Operação do frete salva.");
}

/** Pergunta ao autorizador do CT-e (SEFAZ) se o serviço está no ar, com o certificado da empresa. Consulta real: nada é simulado. */
export async function testarConexaoCte(empresaId: string): Promise<ResultadoAcao<{ cStat: string; xMotivo: string }>> {
  const ctx = await contexto(empresaId, "cte.configurar");
  if (!ctx) return falha("Somente a equipe do escritório testa a conexão.");
  if (envServidor.notasSemRede()) return falha("A conexão com a SEFAZ está desligada neste ambiente (demonstração).");
  const admin = criarClienteAdmin();
  const { data: cfg } = await admin.from("cte_config").select("ambiente, emitente:nfe_emitentes(municipio:municipios(uf))").eq("empresa_id", empresaId).maybeSingle();
  const uf = ((cfg?.emitente as { municipio?: { uf?: string } | null } | null)?.municipio ?? null)?.uf;
  if (!uf) return falha("Escolha e salve o estabelecimento que emite o CT-e antes de testar.");
  const cred = await credencialDaEmpresa(admin, empresaId);
  if ("erro" in cred) return falha(cred.erro);
  try {
    const r = await statusServicoCte({ uf, ambiente: (cfg?.ambiente ?? "homologacao") as "homologacao" | "producao", credencial: cred.credencial });
    const nome = AUTORIZADORES_CTE[autorizadorCteDaUf(uf)].nome;
    if (r.cStat === "107") return sucesso(`${nome} respondeu: serviço do CT-e em operação (o certificado foi aceito na conexão).`, { cStat: r.cStat, xMotivo: r.xMotivo });
    return falha(`${nome} respondeu ${r.cStat}: ${r.xMotivo}`);
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível falar com a SEFAZ.");
  }
}

// -----------------------------------------------------------------------------
// Participantes (remetente, destinatário e tomador) a partir da NF-e
// -----------------------------------------------------------------------------

type Supabase = ContextoEmpresa["supabase"];

async function participantePorDocumento(supabase: Supabase, empresaId: string, documento: string) {
  const { data } = await supabase.from("nfe_destinatarios").select("id, nome").eq("empresa_id", empresaId).eq("documento", documento).order("created_at").limit(1);
  return data?.[0] ?? null;
}

/** Cadastra (ou acha pelo documento) o participante lido da NF-e. */
async function garantirParticipante(supabase: Supabase, empresaId: string, p: ParticipanteDaNfe): Promise<{ id: string; novo: boolean } | { erro: string }> {
  const existente = await participantePorDocumento(supabase, empresaId, p.documento);
  if (existente) return { id: existente.id, novo: false };
  if (/HOMOLOGACAO/i.test(p.nome)) return { erro: `${p.documento}: a NF-e é de teste (homologação) e não traz o nome verdadeiro. Cadastre à mão.` };
  const digitos = (v: string | null) => (v ?? "").replace(/\D/g, "");
  const fone = digitos(p.telefone);
  const email = (p.email ?? "").trim();
  const { data, error } = await supabase.rpc("nfe_destinatario_salvar", {
    p_empresa_id: empresaId,
    p_id: null as never,
    p_dados: {
      tipo: p.tipo,
      documento: p.documento,
      nome: p.nome.slice(0, 60),
      indicador_ie: p.indicador_ie,
      inscricao_estadual: p.inscricao_estadual ?? "",
      logradouro: p.logradouro.slice(0, 60),
      numero: p.numero.slice(0, 60),
      complemento: (p.complemento ?? "").slice(0, 60),
      bairro: p.bairro.slice(0, 60),
      municipio_ibge: p.municipio_ibge,
      cep: digitos(p.cep).length === 8 ? digitos(p.cep) : "",
      telefone: fone.length >= 6 && fone.length <= 14 ? fone : "",
      email: email.length <= 60 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "",
    } as never,
  });
  if (error) return { erro: `${p.nome}: ${mensagemErro(error)}` };
  return { id: data as string, novo: true };
}

/** A própria empresa como participante (ex.: remetente da mercadoria que ela mesma vende e transporta), a partir do estabelecimento do CT-e. */
async function garantirPropriaEmpresa(supabase: Supabase, empresaId: string): Promise<{ id: string; novo: boolean } | { erro: string }> {
  const [{ data: emp }, { data: cfg }] = await Promise.all([
    supabase.from("empresas").select("razao_social, documento, tipo_pessoa").eq("id", empresaId).maybeSingle(),
    supabase.from("cte_config").select("emitente:nfe_emitentes(inscricao_estadual, logradouro, numero, complemento, bairro, municipio_ibge, cep, telefone, municipio:municipios(uf))").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  if (!emp) return { erro: "Empresa não encontrada." };
  const em = cfg?.emitente as {
    inscricao_estadual: string;
    logradouro: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    municipio_ibge: string;
    cep: string | null;
    telefone: string | null;
    municipio: { uf: string } | null;
  } | null;
  if (!em) return { erro: "O escritório ainda não escolheu o estabelecimento que emite o CT-e." };
  return garantirParticipante(supabase, empresaId, {
    tipo: emp.tipo_pessoa === "PF" ? "cpf" : "cnpj",
    documento: emp.documento,
    nome: emp.razao_social,
    indicador_ie: em.inscricao_estadual ? 1 : 9,
    inscricao_estadual: em.inscricao_estadual,
    logradouro: em.logradouro,
    numero: em.numero,
    complemento: em.complemento,
    bairro: em.bairro,
    municipio_ibge: em.municipio_ibge,
    uf: em.municipio?.uf ?? "",
    cep: em.cep,
    telefone: em.telefone,
    email: null,
  });
}

export async function usarPropriaEmpresa(empresaId: string): Promise<ResultadoAcao<{ id: string }>> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx) return falha("Sem permissão para emitir CT-e desta empresa.");
  const r = await garantirPropriaEmpresa(ctx.supabase, empresaId);
  if ("erro" in r) return falha(r.erro);
  return sucesso(r.novo ? "A empresa foi cadastrada como participante." : undefined, { id: r.id });
}

export interface PreenchimentoNfe {
  chave: string;
  remetente_id: string | null;
  destinatario_id: string | null;
  tomador: "remetente" | "destinatario" | null;
  carga: { produto: string | null; peso_kg: string | null; valor: string | null };
  avisos: string[];
}

/**
 * Preenche o CT-e pela chave de uma NF-e que está no portal: notas emitidas
 * pela própria empresa ou recebidas pela busca automática / enviadas pelo
 * cliente (XML). Cadastra o remetente e o destinatário que faltarem.
 */
export async function preencherPelaNfe(empresaId: string, chaveDigitada: string): Promise<ResultadoAcao<PreenchimentoNfe>> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx) return falha("Sem permissão para emitir CT-e desta empresa.");
  const chave = chaveDigitada.replace(/\D/g, "");
  if (!/^\d{44}$/.test(chave) || chave.slice(20, 22) !== "55") return falha("Chave de NF-e inválida: são 44 números de uma nota modelo 55.");
  const avisos: string[] = [];
  const tomadorDaModalidade = (m: number | null) => (m === 0 ? "remetente" : m === 1 ? "destinatario" : null);
  // Quem emite CT-e pode não ter acesso às notas e aos documentos: a busca usa a chave do servidor, sempre presa a esta empresa,
  // e devolve só o necessário para o CT-e
  const admin = criarClienteAdmin();

  // 1) NF-e emitida pela própria empresa no portal
  const { data: propria } = await admin
    .from("nfe_emissoes")
    .select("destinatario_id, valor_total, dados, totais, situacao")
    .eq("empresa_id", empresaId)
    .eq("chave", chave)
    .maybeSingle();
  if (propria) {
    if (!["autorizada", "cancelando"].includes(propria.situacao)) avisos.push("Esta NF-e não está autorizada. Confira antes de emitir o CT-e.");
    const rem = await garantirPropriaEmpresa(ctx.supabase, empresaId);
    if ("erro" in rem) avisos.push(rem.erro);
    const dados = propria.dados as { itens?: { descricao: string; quantidade: string; valorUnitario: string }[]; transporte?: { modalidade?: number } };
    const itens = [...(dados.itens ?? [])].sort((a, b) => Number(b.quantidade) * Number(b.valorUnitario) - Number(a.quantidade) * Number(a.valorUnitario));
    const peso = (propria.totais as { pesoKg?: string | null } | null)?.pesoKg ?? null;
    if (!peso) avisos.push("A NF-e não tem o peso: informe o peso da carga.");
    return sucesso("Dados preenchidos pela NF-e emitida no portal. Confira o valor do frete.", {
      chave,
      remetente_id: "erro" in rem ? null : rem.id,
      destinatario_id: propria.destinatario_id,
      tomador: tomadorDaModalidade(dados.transporte?.modalidade ?? null),
      carga: { produto: itens[0]?.descricao?.slice(0, 60) ?? null, peso_kg: peso, valor: String(propria.valor_total) },
      avisos,
    });
  }

  // 2) XML da NF-e nos documentos da empresa (busca automática ou enviado pelo cliente)
  const { data: fiscal } = await admin.from("documentos_fiscais").select("documento_id").eq("empresa_id", empresaId).eq("chave_acesso", chave).limit(1).maybeSingle();
  if (!fiscal) {
    return sucesso("A NF-e não está no portal: a chave entrou na lista; preencha o remetente, o destinatário e a carga à mão.", {
      chave,
      remetente_id: null,
      destinatario_id: null,
      tomador: null,
      carga: { produto: null, peso_kg: null, valor: null },
      avisos: ["Dica: a nota aparece aqui quando chega pela busca automática de notas ou quando o XML é enviado ao portal."],
    });
  }
  // O XML fica no armazenamento privado
  const { data: doc } = await admin.from("documentos").select("storage_path, empresa_id").eq("id", fiscal.documento_id).maybeSingle();
  if (!doc || doc.empresa_id !== empresaId || !doc.storage_path) return falha("Documento da NF-e não encontrado.");
  const { data: arquivo } = await admin.storage.from("documentos").download(doc.storage_path);
  const nfe = arquivo ? lerNfeParaCte(await arquivo.text()) : null;
  if (!nfe || nfe.chave !== chave) return falha("Não foi possível ler o XML desta NF-e. Preencha à mão.");
  const resolver = async (p: ParticipanteDaNfe | null, papel: string) => {
    if (!p) {
      avisos.push(`A NF-e não traz o ${papel} completo: escolha à mão.`);
      return null;
    }
    const r = await garantirParticipante(ctx.supabase, empresaId, p);
    if ("erro" in r) {
      avisos.push(r.erro);
      return null;
    }
    if (r.novo) avisos.push(`${p.nome} foi cadastrado como ${papel} com os dados da NF-e.`);
    return r.id;
  };
  const remetente = await resolver(nfe.remetente, "remetente");
  const destinatario = await resolver(nfe.destinatario, "destinatário");
  if (!nfe.pesoKg) avisos.push("A NF-e não tem o peso: informe o peso da carga.");
  return sucesso("Dados preenchidos pela NF-e. Confira o valor do frete.", {
    chave,
    remetente_id: remetente,
    destinatario_id: destinatario,
    tomador: tomadorDaModalidade(nfe.modalidadeFrete),
    carga: { produto: nfe.produto, peso_kg: nfe.pesoKg, valor: nfe.valor },
    avisos,
  });
}

// -----------------------------------------------------------------------------
// Emissão
// -----------------------------------------------------------------------------

const valor2 = z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido.");
const esquemaPedido = z.object({
  operacao_id: z.string().regex(UUID, "Escolha a operação do frete."),
  tomador: z.enum(["remetente", "destinatario", "outro"], { message: "Escolha quem paga o frete." }),
  tomador_id: z.string().regex(UUID).optional().or(z.literal("")).transform((v) => v || undefined),
  remetente_id: z.string().regex(UUID, "Escolha o remetente."),
  destinatario_id: z.string().regex(UUID, "Escolha o destinatário."),
  municipio_inicio: z.string().regex(/^\d{7}$/).optional().or(z.literal("")),
  municipio_fim: z.string().regex(/^\d{7}$/).optional().or(z.literal("")),
  valor_prestacao: valor2,
  valor_receber: valor2.optional().or(z.literal("")),
  componentes: z.array(z.object({ nome: z.string().trim().min(1).max(15), valor: valor2 })).max(30).default([]),
  carga: z.object({
    produto: z.string().trim().min(1, "Informe o produto da carga.").max(60),
    peso_kg: z.string().regex(/^\d+(\.\d{1,4})?$/, "Peso inválido (até 4 casas decimais)."),
    valor: valor2.optional().or(z.literal("")),
    outras: z.string().max(30).optional(),
  }),
  nfes: z.array(z.string().regex(/^\d{44}$/, "Chave de acesso com 44 números.")).min(1, "Informe ao menos uma NF-e da carga.").max(2000),
  observacoes: z.string().max(2000).optional(),
  origem: z.object({ ordem_id: z.string().regex(UUID), ordem_numero: z.number().int() }).optional(),
  confirmar_repetida: z.boolean().optional(),
});
export type PedidoCte = z.input<typeof esquemaPedido>;

export interface PreviaCte {
  cfop: string;
  natureza: string;
  trajeto: string;
  tomador: string;
  vTPrest: string;
  vRec: string;
  icms: { cst: string; vBC: string; pICMS: string | null; vICMS: string; vCred: string | null };
  vIBS: string | null;
  vCBS: string | null;
  vTotTrib: string;
}

/** Confere os valores do CT-e antes de emitir: dados montados pelo banco (regras da operação) e o mesmo cálculo da emissão. */
export async function previaCte(empresaId: string, pedido: PedidoCte): Promise<ResultadoAcao<PreviaCte>> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx) return falha("Sem permissão para emitir CT-e desta empresa.");
  const p = esquemaPedido.safeParse(pedido);
  if (!p.success) return falhaValidacao(p.error);
  const { data, error } = await ctx.supabase.rpc("cte_previa", { p_empresa_id: empresaId, p_dados: p.data as never });
  if (error) return falha(mensagemErro(error));
  const { _resumo, ...dados } = data as unknown as Omit<EntradaCte, "ambiente" | "emitidoEm" | "serie" | "numero" | "codigoNumerico"> & { _resumo: { tomador_nome: string } };
  try {
    const c = calcularCte({ ...dados, ambiente: "homologacao", emitidoEm: new Date(), serie: 1, numero: 1, codigoNumerico: "10000000" });
    const v = (x: bigint) => fmt(x, 2);
    return sucesso(undefined, {
      cfop: dados.cfop,
      natureza: dados.natureza,
      trajeto: `${dados.inicio.municipio}/${dados.inicio.uf} → ${dados.fim.municipio}/${dados.fim.uf}`,
      tomador: _resumo.tomador_nome,
      vTPrest: v(c.vTPrest),
      vRec: v(c.vRec),
      icms: { cst: c.icms.grupo === "ICMSSN" ? "sn" : c.icms.cst, vBC: v(c.icms.vBC), pICMS: c.icms.pICMS != null ? fmt(c.icms.pICMS, 2) : null, vICMS: v(c.icms.vICMS), vCred: c.icms.vCred != null ? v(c.icms.vCred) : null },
      vIBS: c.ibscbs ? v(c.ibscbs.vIBS) : null,
      vCBS: c.ibscbs ? v(c.ibscbs.cbs.valor) : null,
      vTotTrib: v(c.vTotTrib),
    });
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível calcular o CT-e.");
  }
}

/** Emite (ou corrige e envia de novo, com o mesmo número, o CT-e rejeitado `corrigir`). */
export async function emitirConhecimento(empresaId: string, pedido: PedidoCte, corrigir?: string | null): Promise<ResultadoAcao<{ id?: string; repetida?: boolean }>> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx) return falha("Sem permissão para emitir CT-e desta empresa.");
  const p = esquemaPedido.safeParse(pedido);
  if (!p.success) return falhaValidacao(p.error);
  const { data, error } = await ctx.supabase.rpc("cte_emitir", {
    p_empresa_id: empresaId,
    p_dados: p.data as never,
    p_id: corrigir && UUID.test(corrigir) ? corrigir : (null as never),
  });
  if (error) {
    if ((error as { code?: string }).code === "P0002") return { ok: false, mensagem: mensagemErro(error), dados: { repetida: true } };
    return falha(mensagemErro(error));
  }
  processarFilaDepois({ tipos: ["emitir_cte"], limite: 5 });
  const r = data as { id: string; numero: number };
  return sucesso(`CT-e nº ${r.numero} enviado à SEFAZ.`, { id: r.id });
}

export async function tentarDeNovoCte(empresaId: string, id: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const { error } = await ctx.supabase.rpc("cte_tentar_de_novo", { p_id: id });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["emitir_cte"], limite: 5 });
  return sucesso("Consultando a SEFAZ de novo.");
}

export async function descartarCte(empresaId: string, id: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const { error } = await ctx.supabase.rpc("cte_descartar", { p_id: id });
  if (error) return falha(mensagemErro(error));
  return sucesso("CT-e descartado. O número precisa ser inutilizado na SEFAZ.");
}

export async function cancelarCte(empresaId: string, id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const just = texto(fd, "justificativa");
  if (just.length < 15) return falha("Explique o motivo (ao menos 15 caracteres).", { justificativa: ["Ao menos 15 caracteres."] });
  const { error } = await ctx.supabase.rpc("cte_cancelar", { p_id: id, p_justificativa: just });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["evento_cte"], limite: 5 });
  return sucesso("Pedido de cancelamento enviado à SEFAZ.");
}

const esquemaCorrecoes = z
  .array(z.object({ grupo: z.string(), campo: z.string(), valor: z.string().trim().min(1, "Informe o valor certo.").max(500) }))
  .min(1, "Informe ao menos uma correção.")
  .max(20);

export async function cartaCorrecaoCte(empresaId: string, id: string, correcoes: { grupo: string; campo: string; valor: string }[]): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "cte.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão.");
  const p = esquemaCorrecoes.safeParse(correcoes);
  if (!p.success) return falhaValidacao(p.error);
  if (p.data.some((c) => !CAMPOS_CCE_CTE.some((x) => x.grupo === c.grupo && x.campo === c.campo))) return falha("Campo não corrigível pelo portal.");
  const { error } = await ctx.supabase.rpc("cte_carta_correcao", { p_id: id, p_correcoes: p.data as never });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["evento_cte"], limite: 5 });
  return sucesso("Carta de correção enviada à SEFAZ.");
}
