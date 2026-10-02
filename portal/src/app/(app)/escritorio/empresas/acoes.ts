"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirAdmin, exigirEquipe, obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { somenteDigitos, validarCnpj, validarCpf } from "@/lib/formatos";
import { ErroConsultaCnpj, consultarCnpjReceita, funcaoDoSocio, regimeSugerido, DadosReceitaSchema, type DadosReceita } from "@/lib/empresas/receita";

/** Consulta o CNPJ nos dados abertos da Receita (só a equipe); a tela preenche o formulário com o resultado. */
export async function buscarDadosReceita(cnpj: string): Promise<ResultadoAcao<{ receita: DadosReceita; regime: string | null }>> {
  await exigirEquipe();
  try {
    const receita = await consultarCnpjReceita(cnpj);
    return sucesso("Dados da Receita preenchidos. Confira antes de salvar.", { receita, regime: regimeSugerido(receita) });
  } catch (e) {
    return falha(e instanceof ErroConsultaCnpj ? e.message : "Não foi possível consultar a Receita agora. Preencha os dados à mão.");
  }
}

/** Retrato da consulta enviado junto com o formulário (só vale se for do mesmo CNPJ). */
function lerDadosReceita(fd: FormData, documento: string): DadosReceita | null {
  const bruto = String(fd.get("dados_receita") ?? "");
  if (!bruto || bruto.length > 150_000) return null;
  try {
    const r = DadosReceitaSchema.safeParse(JSON.parse(bruto));
    return r.success && r.data.cnpj === somenteDigitos(documento) ? r.data : null;
  } catch {
    return null;
  }
}

/** Guarda o retrato da Receita e, se o município existir na tabela do IBGE, o código dele (prazos municipais). */
async function aplicarDadosReceita(supabase: Awaited<ReturnType<typeof obterContextoEmpresa>>["supabase"], empresaId: string, receita: DadosReceita) {
  const ibge = receita.endereco.codigoIbge;
  const { data: municipio } = ibge ? await supabase.from("municipios").select("ibge").eq("ibge", ibge).maybeSingle() : { data: null };
  await supabase
    .from("empresas")
    .update({ dados_receita: receita as never, dados_receita_em: receita.consultadoEm, ...(municipio ? { municipio_ibge: municipio.ibge } : {}) })
    .eq("id", empresaId);
}

const opcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const esquemaEmpresa = z
  .object({
    tipo_pessoa: z.enum(["PJ", "PF"]),
    documento: z.string().trim().min(11, "Informe o CNPJ ou CPF."),
    razao_social: z.string().trim().min(2, "Informe a razão social (ou nome completo)."),
    nome_fantasia: opcional,
    inscricao_estadual: opcional,
    inscricao_municipal: opcional,
    regime_tributario: z.enum(["mei", "simples_nacional", "lucro_presumido", "lucro_real", "lucro_arbitrado", "imune_isenta", "produtor_rural", "pessoa_fisica", "outro"], {
      error: "Selecione o regime tributário.",
    }),
    atividade_principal: opcional,
    cnae: opcional,
    logradouro: opcional,
    numero: opcional,
    complemento: opcional,
    bairro: opcional,
    cidade: opcional,
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional()
      .refine((v) => v == null || /^[A-Z]{2}$/.test(v), "UF inválida."),
    cep: opcional,
    email: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional()
      .refine((v) => v == null || z.email().safeParse(v).success, "E-mail inválido."),
    telefone: opcional,
    contador_responsavel_id: opcional,
    data_inicio_atendimento: opcional,
    servicos: z.array(z.enum(["contabil", "fiscal", "folha", "financeiro", "societario", "imposto_renda"])).min(1, "Selecione ao menos um serviço."),
    controla_estoque: z.boolean(),
    observacoes: opcional,
  })
  .superRefine((d, ctx) => {
    const doc = somenteDigitos(d.documento);
    const ok = d.tipo_pessoa === "PJ" ? validarCnpj(doc) : validarCpf(doc);
    if (!ok) ctx.addIssue({ code: "custom", path: ["documento"], message: d.tipo_pessoa === "PJ" ? "CNPJ inválido." : "CPF inválido." });
  });

function lerEmpresa(fd: FormData) {
  return esquemaEmpresa.safeParse({
    tipo_pessoa: fd.get("tipo_pessoa") ?? "PJ",
    documento: String(fd.get("documento") ?? ""),
    razao_social: fd.get("razao_social") ?? "",
    nome_fantasia: fd.get("nome_fantasia") ?? "",
    inscricao_estadual: fd.get("inscricao_estadual") ?? "",
    inscricao_municipal: fd.get("inscricao_municipal") ?? "",
    regime_tributario: fd.get("regime_tributario") ?? "",
    atividade_principal: fd.get("atividade_principal") ?? "",
    cnae: fd.get("cnae") ?? "",
    logradouro: fd.get("logradouro") ?? "",
    numero: fd.get("numero") ?? "",
    complemento: fd.get("complemento") ?? "",
    bairro: fd.get("bairro") ?? "",
    cidade: fd.get("cidade") ?? "",
    uf: fd.get("uf") ?? "",
    cep: fd.get("cep") ?? "",
    email: fd.get("email") ?? "",
    telefone: fd.get("telefone") ?? "",
    contador_responsavel_id: fd.get("contador_responsavel_id") ?? "",
    data_inicio_atendimento: fd.get("data_inicio_atendimento") ?? "",
    servicos: fd.getAll("servicos").map(String),
    controla_estoque: fd.get("controla_estoque") === "on",
    observacoes: fd.get("observacoes") ?? "",
  });
}

export async function criarEmpresa(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dados = lerEmpresa(fd);
  if (!dados.success) return falhaValidacao(dados.error);
  const { data: id, error } = await s.supabase.rpc("criar_empresa", {
    p_dados: { ...dados.data, documento: somenteDigitos(dados.data.documento), cep: somenteDigitos(dados.data.cep ?? "") },
  });
  if (error) return falha(mensagemErro(error));
  const receita = lerDadosReceita(fd, dados.data.documento);
  if (receita) {
    await aplicarDadosReceita(s.supabase, id as string, receita);
    // Sócios do quadro societário da Receita como contatos (sem e-mail nem telefone; não recebem lembretes)
    if (fd.get("cadastrar_socios") === "on" && receita.socios.length) {
      await s.supabase.from("empresa_contatos").insert(
        receita.socios.slice(0, 30).map((socio) => ({
          empresa_id: id as string,
          nome: socio.nome.slice(0, 200),
          funcao: funcaoDoSocio(socio.qualificacao),
          principal: false,
          recebe_lembretes: false,
          observacoes: `Do quadro de sócios da Receita${socio.qualificacao ? ` (${socio.qualificacao})` : ""}${socio.desde ? `, desde ${socio.desde.split("-").reverse().join("/")}` : ""}.`,
        })),
      );
    }
  }
  revalidatePath("/escritorio/empresas");
  redirect(`/escritorio/empresas/${id}?criada=1`);
}

export async function atualizarEmpresa(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("empresa.editar")) return falha("Você não tem permissão para editar esta empresa.");
  const dados = lerEmpresa(fd);
  if (!dados.success) return falhaValidacao(dados.error);
  const { documento: _doc, tipo_pessoa: _tp, ...campos } = dados.data;
  void _doc;
  void _tp;
  const { error } = await ctx.supabase
    .from("empresas")
    .update({ ...campos, cep: somenteDigitos(campos.cep ?? "") || null })
    .eq("id", empresaId);
  if (error) return falha(mensagemErro(error));
  const receita = lerDadosReceita(fd, dados.data.documento);
  if (receita) await aplicarDadosReceita(ctx.supabase, empresaId, receita);
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  return sucesso("Dados da empresa atualizados.");
}

export async function alterarSituacaoEmpresa(empresaId: string, ativa: boolean): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("empresa.editar")) return falha("Sem permissão.");
  const { error } = await ctx.supabase.from("empresas").update({ ativa }).eq("id", empresaId);
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  return sucesso(ativa ? "Empresa reativada." : "Empresa desativada. Os dados e documentos foram preservados.");
}

const esquemaContato = z.object({
  id: opcional,
  nome: z.string().trim().min(2, "Informe o nome."),
  funcao: z.enum(["socio_administrador", "socio", "financeiro", "rh", "fiscal", "outro"]),
  email: opcional,
  telefone: opcional,
  whatsapp: opcional,
  principal: z.boolean(),
  recebe_lembretes: z.boolean(),
  observacoes: opcional,
});

export async function salvarContato(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("empresa.editar")) return falha("Você não tem permissão para editar os contatos.");
  const dados = esquemaContato.safeParse({
    id: fd.get("id") ?? "",
    nome: fd.get("nome") ?? "",
    funcao: fd.get("funcao") ?? "outro",
    email: fd.get("email") ?? "",
    telefone: fd.get("telefone") ?? "",
    whatsapp: fd.get("whatsapp") ?? "",
    principal: fd.get("principal") === "on",
    recebe_lembretes: fd.get("recebe_lembretes") === "on",
    observacoes: fd.get("observacoes") ?? "",
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const { id, ...campos } = dados.data;
  const registro = { ...campos, whatsapp: campos.whatsapp ? somenteDigitos(campos.whatsapp) : null };
  const { error } = id
    ? await ctx.supabase.from("empresa_contatos").update(registro).eq("id", id).eq("empresa_id", empresaId)
    : await ctx.supabase.from("empresa_contatos").insert({ ...registro, empresa_id: empresaId });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  return sucesso(id ? "Contato atualizado." : "Contato adicionado.");
}

export async function excluirContato(empresaId: string, contatoId: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("empresa.editar")) return falha("Sem permissão.");
  const { error } = await ctx.supabase.from("empresa_contatos").delete().eq("id", contatoId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  return sucesso("Contato removido.");
}
