"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirAdmin } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { somenteDigitos, validarCnpj } from "@/lib/formatos";

const ROTA = "/escritorio/configuracoes";

const opcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const texto = (fd: FormData, nome: string) => String(fd.get(nome) ?? "");
const marcado = (fd: FormData, nome: string) => fd.get(nome) === "on";

// -----------------------------------------------------------------------------
// Dados do escritório
// -----------------------------------------------------------------------------
const esquemaDados = z.object({
  nome_fantasia: z.string().trim().min(2, "Informe o nome fantasia."),
  razao_social: z.string().trim().min(2, "Informe a razão social."),
  cnpj: z
    .string()
    .trim()
    .transform((v) => somenteDigitos(v))
    .refine((v) => validarCnpj(v), "CNPJ inválido."),
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
    .refine((v) => v == null || /^[A-Z]{2}$/.test(v), "UF inválida."),
  cep: z
    .string()
    .trim()
    .transform((v) => somenteDigitos(v) || null)
    .refine((v) => v == null || v.length === 8, "CEP inválido."),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v == null || z.email().safeParse(v).success, "E-mail inválido."),
  telefone: opcional,
  whatsapp: z
    .string()
    .trim()
    .transform((v) => somenteDigitos(v) || null)
    .refine((v) => v == null || (v.length >= 10 && v.length <= 13), "WhatsApp inválido (informe DDD e número)."),
  site: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v == null || /^https?:\/\/\S+\.\S+/.test(v), "Informe o endereço completo, começando com https://."),
  instagram: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.replace(/^@/, "")))
    .nullable(),
});

export async function salvarDadosEscritorio(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dados = esquemaDados.safeParse({
    nome_fantasia: texto(fd, "nome_fantasia"),
    razao_social: texto(fd, "razao_social"),
    cnpj: texto(fd, "cnpj"),
    logradouro: texto(fd, "logradouro"),
    numero: texto(fd, "numero"),
    complemento: texto(fd, "complemento"),
    bairro: texto(fd, "bairro"),
    cidade: texto(fd, "cidade"),
    uf: texto(fd, "uf"),
    cep: texto(fd, "cep"),
    email: texto(fd, "email"),
    telefone: texto(fd, "telefone"),
    whatsapp: texto(fd, "whatsapp"),
    site: texto(fd, "site"),
    instagram: texto(fd, "instagram"),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const { error } = await s.supabase.from("escritorio").update({ ...dados.data, updated_by: s.usuarioId }).eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidatePath("/", "layout");
  return sucesso("Dados do escritório atualizados.");
}

// -----------------------------------------------------------------------------
// Identidade do portal (textos e logomarca)
// -----------------------------------------------------------------------------
const esquemaPortal = z.object({
  nome_sistema: z.string().trim().min(2, "Informe o nome do portal.").max(80, "Use no máximo 80 caracteres."),
  descricao_sistema: z.string().trim().min(2, "Informe a descrição.").max(200, "Use no máximo 200 caracteres."),
  mensagem_login: z.string().trim().min(2, "Informe a mensagem de boas-vindas.").max(600, "Use no máximo 600 caracteres."),
});

export async function salvarPortal(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dados = esquemaPortal.safeParse({
    nome_sistema: texto(fd, "nome_sistema"),
    descricao_sistema: texto(fd, "descricao_sistema"),
    mensagem_login: texto(fd, "mensagem_login"),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const { error } = await s.supabase.from("escritorio").update({ ...dados.data, updated_by: s.usuarioId }).eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidatePath("/", "layout");
  return sucesso("Textos do portal atualizados.");
}

const TIPOS_LOGO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const LOGO_MAX = 2 * 1024 * 1024; // limite do bucket "marca"

/** Envia a logomarca ao bucket público "marca" (políticas: somente administrador). */
export async function enviarLogo(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const arquivo = fd.get("logo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Selecione o arquivo da logomarca.", { logo: ["Selecione um arquivo."] });
  const ext = TIPOS_LOGO[arquivo.type];
  if (!ext) return falha("Formato não aceito. Envie PNG, JPG, WEBP ou SVG.", { logo: ["Formato não aceito."] });
  if (arquivo.size > LOGO_MAX) return falha("A logomarca deve ter no máximo 2 MB.", { logo: ["Arquivo maior que 2 MB."] });

  const { data: atual } = await s.supabase.from("escritorio").select("logo_path").eq("id", 1).single();
  const caminho = `logo-${Date.now()}.${ext}`;
  const { error: erroEnvio } = await s.supabase.storage.from("marca").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false, cacheControl: "3600" });
  if (erroEnvio) return falha(`Não foi possível enviar a logomarca: ${erroEnvio.message}`);
  const { error } = await s.supabase.rpc("definir_logo_escritorio", { p_path: caminho });
  if (error) {
    await s.supabase.storage.from("marca").remove([caminho]);
    return falha(mensagemErro(error));
  }
  if (atual?.logo_path && atual.logo_path !== caminho) await s.supabase.storage.from("marca").remove([atual.logo_path]);
  revalidatePath("/", "layout");
  return sucesso("Logomarca atualizada.");
}

export async function removerLogo(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { data: atual } = await s.supabase.from("escritorio").select("logo_path").eq("id", 1).single();
  const { error } = await s.supabase.rpc("definir_logo_escritorio", { p_path: "" });
  if (error) return falha(mensagemErro(error));
  if (atual?.logo_path) await s.supabase.storage.from("marca").remove([atual.logo_path]);
  revalidatePath("/", "layout");
  return sucesso("Logomarca removida. O portal volta a usar a logomarca provisória.");
}

// -----------------------------------------------------------------------------
// Segurança e limites de envio
// -----------------------------------------------------------------------------
const inteiro = (min: number, max: number, rotulo: string) =>
  z.coerce.number({ error: `Informe ${rotulo}.` }).int(`Use um número inteiro para ${rotulo}.`).min(min, `O mínimo para ${rotulo} é ${min}.`).max(max, `O máximo para ${rotulo} é ${max}.`);

const esquemaSeguranca = z.object({
  exigir_2fa_equipe: z.boolean(),
  exigir_2fa_clientes: z.boolean(),
  upload_tamanho_maximo_mb: inteiro(1, 500, "o tamanho máximo por arquivo"),
  zip_max_arquivos: inteiro(1, 20000, "a quantidade de arquivos por ZIP"),
  zip_max_tamanho_mb: inteiro(1, 2000, "o tamanho máximo do ZIP"),
});

export async function salvarSeguranca(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dados = esquemaSeguranca.safeParse({
    exigir_2fa_equipe: marcado(fd, "exigir_2fa_equipe"),
    exigir_2fa_clientes: marcado(fd, "exigir_2fa_clientes"),
    upload_tamanho_maximo_mb: texto(fd, "upload_tamanho_maximo_mb"),
    zip_max_arquivos: texto(fd, "zip_max_arquivos"),
    zip_max_tamanho_mb: texto(fd, "zip_max_tamanho_mb"),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  if (dados.data.exigir_2fa_equipe && s.aal !== "aal2") {
    return falha("Ative a verificação em duas etapas no seu próprio usuário antes de exigi-la da equipe, para não perder o acesso.");
  }
  const { error } = await s.supabase.from("escritorio").update({ ...dados.data, updated_by: s.usuarioId }).eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidatePath(ROTA);
  return sucesso("Configurações de segurança atualizadas.");
}

// -----------------------------------------------------------------------------
// Lembretes e WhatsApp
// -----------------------------------------------------------------------------
const esquemaLembretes = z.object({
  lembretes_dias: z
    .array(z.number().int().min(-30, "Use dias entre -30 e 30.").max(30, "Use dias entre -30 e 30."))
    .max(10, "Informe no máximo 10 dias."),
  lembretes_email_ativo: z.boolean(),
  lembretes_whatsapp_ativo: z.boolean(),
  whatsapp_phone_number_id: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v == null || /^\d{5,30}$/.test(v), "O Phone Number ID tem somente números."),
  whatsapp_template_lembrete: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v == null || /^[a-z0-9_]{1,512}$/.test(v), "O nome do modelo usa letras minúsculas, números e _."),
  whatsapp_template_idioma: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Idioma inválido (ex.: pt_BR)."),
});

/** Lê "-5, -2, 0, 2, 5" (ou "D-5 D+2") como lista de dias. */
function lerDias(v: string): number[] | null {
  const partes = v
    .split(/[,;\s]+/)
    .map((p) => p.trim().replace(/^d/i, ""))
    .filter(Boolean);
  const nums = partes.map((p) => (/^[+-]?\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

export async function salvarLembretes(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dias = lerDias(texto(fd, "lembretes_dias"));
  if (!dias) return falha("Revise os campos destacados.", { lembretes_dias: ["Use números separados por vírgula, por exemplo: -5, -2, 0, 2, 5."] });
  const dados = esquemaLembretes.safeParse({
    lembretes_dias: dias,
    lembretes_email_ativo: marcado(fd, "lembretes_email_ativo"),
    lembretes_whatsapp_ativo: marcado(fd, "lembretes_whatsapp_ativo"),
    whatsapp_phone_number_id: texto(fd, "whatsapp_phone_number_id"),
    whatsapp_template_lembrete: texto(fd, "whatsapp_template_lembrete"),
    whatsapp_template_idioma: texto(fd, "whatsapp_template_idioma") || "pt_BR",
  });
  if (!dados.success) return falhaValidacao(dados.error);
  if (dados.data.lembretes_whatsapp_ativo && (!dados.data.whatsapp_phone_number_id || !dados.data.whatsapp_template_lembrete)) {
    return falha("Para ativar os lembretes por WhatsApp, informe o Phone Number ID e o nome do modelo aprovado.");
  }
  const { error } = await s.supabase.from("escritorio").update({ ...dados.data, updated_by: s.usuarioId }).eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidatePath(ROTA);
  return sucesso("Configurações de lembretes atualizadas.");
}

// -----------------------------------------------------------------------------
// Privacidade (LGPD) e retenção
// -----------------------------------------------------------------------------
export async function salvarRetencaoPadrao(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dados = z.object({ retencao_padrao_anos: inteiro(1, 50, "o prazo de retenção") }).safeParse({ retencao_padrao_anos: texto(fd, "retencao_padrao_anos") });
  if (!dados.success) return falhaValidacao(dados.error);
  const { error } = await s.supabase.from("escritorio").update({ ...dados.data, updated_by: s.usuarioId }).eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidatePath(ROTA);
  return sucesso("Prazo padrão de retenção atualizado.");
}

const esquemaPolitica = z.object({
  categoria_codigo: z.string().trim().min(1, "Selecione a categoria."),
  anos: inteiro(1, 50, "o prazo em anos"),
  observacao: opcional,
});

export async function salvarPoliticaRetencao(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dados = esquemaPolitica.safeParse({
    categoria_codigo: texto(fd, "categoria_codigo"),
    anos: texto(fd, "anos"),
    observacao: texto(fd, "observacao"),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const { error } = await s.supabase
    .from("politicas_retencao")
    .upsert({ ...dados.data, updated_at: new Date().toISOString(), updated_by: s.usuarioId }, { onConflict: "categoria_codigo" });
  if (error) return falha(mensagemErro(error));
  revalidatePath(ROTA);
  return sucesso("Política de retenção salva.");
}

export async function excluirPoliticaRetencao(categoria: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { error } = await s.supabase.from("politicas_retencao").delete().eq("categoria_codigo", categoria);
  if (error) return falha(mensagemErro(error));
  revalidatePath(ROTA);
  return sucesso("Política removida. A categoria passa a usar o prazo padrão.");
}

const esquemaResposta = z.object({
  id: z.uuid("Solicitação inválida."),
  status: z.enum(["em_andamento", "concluida", "recusada"], { error: "Selecione a situação." }),
  resposta: z.string().trim().min(5, "Escreva a resposta ao titular (mínimo de 5 caracteres).").max(4000, "Use no máximo 4.000 caracteres."),
});

export async function responderSolicitacao(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const dados = esquemaResposta.safeParse({ id: texto(fd, "id"), status: texto(fd, "status"), resposta: texto(fd, "resposta") });
  if (!dados.success) return falhaValidacao(dados.error);
  const { error } = await s.supabase.rpc("responder_solicitacao_titular", {
    p_id: dados.data.id,
    p_status: dados.data.status,
    p_resposta: dados.data.resposta,
  });
  if (error) return falha(mensagemErro(error));
  revalidatePath(ROTA);
  return sucesso("Resposta registrada. O titular foi notificado.");
}
