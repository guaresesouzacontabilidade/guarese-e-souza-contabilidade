"use server";

import { revalidatePath } from "next/cache";
import { EXTENSAO_IMAGEM, tipoImagem } from "@/lib/imagens";
import { z } from "zod";
import { exigirAdmin } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { emailConfigurado, enviarEmail } from "@/lib/email/enviar";
import { validarCnpj } from "@/lib/formatos";
import { booleano } from "@/lib/validacao";

const UUID = /^[0-9a-f-]{36}$/i;
const digitos = (v: string) => v.replace(/\D/g, "");
const opcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

function revalidarTudo() {
  revalidatePath("/", "layout");
}

const esquemaDados = z.object({
  nome_fantasia: z.string().trim().min(2, "Informe o nome fantasia.").max(120),
  razao_social: z.string().trim().min(2, "Informe a razão social.").max(160),
  cnpj: z
    .string()
    .transform(digitos)
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
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), "UF inválida."),
  cep: z
    .string()
    .transform(digitos)
    .refine((v) => v === "" || v.length === 8, "CEP inválido.")
    .transform((v) => v || null),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || z.email().safeParse(v).success, "E-mail inválido.")
    .transform((v) => v || null),
  telefone: z
    .string()
    .transform(digitos)
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Telefone inválido.")
    .transform((v) => v || null),
  whatsapp: z
    .string()
    .transform(digitos)
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "WhatsApp inválido.")
    .transform((v) => v || null),
  site: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Informe o endereço completo, começando com https://")
    .transform((v) => v || null),
  instagram: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, ""))
    .refine((v) => v === "" || /^[A-Za-z0-9._]{1,30}$/.test(v), "Informe só o usuário do Instagram (ex.: guaresesoncontabilidade).")
    .transform((v) => v || null),
  contador_nome: z.string().trim().max(200, "Nome longo demais.").transform((v) => (v === "" ? null : v)),
  contador_crc: z.string().trim().max(40, "CRC longo demais.").transform((v) => (v === "" ? null : v)),
  nome_sistema: z.string().trim().min(3, "Informe o nome do portal.").max(60),
  descricao_sistema: z.string().trim().min(3, "Informe uma descrição curta.").max(160),
  mensagem_login: z.string().trim().min(10, "Escreva a mensagem de boas-vindas.").max(400),
});

export async function salvarDadosEscritorio(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const bruto = Object.fromEntries(Object.keys(esquemaDados.shape).map((k) => [k, String(fd.get(k) ?? "")]));
  const d = esquemaDados.safeParse(bruto);
  if (!d.success) return falhaValidacao(d.error);
  const { error } = await s.supabase
    .from("escritorio")
    .update({ ...d.data, updated_by: s.usuarioId })
    .eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidarTudo();
  return sucesso("Dados do escritório atualizados. A tela de entrada já mostra as novas informações.");
}

const esquemaSeguranca = z.object({
  upload_tamanho_maximo_mb: z.coerce.number().int("Use um número inteiro.").min(1, "Mínimo 1 MB.").max(500, "Máximo 500 MB."),
  zip_max_arquivos: z.coerce.number().int("Use um número inteiro.").min(1).max(20000, "Máximo 20.000 arquivos."),
  zip_max_tamanho_mb: z.coerce.number().int("Use um número inteiro.").min(1).max(2000, "Máximo 2.000 MB."),
});

export async function salvarSeguranca(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const d = esquemaSeguranca.safeParse({
    upload_tamanho_maximo_mb: fd.get("upload_tamanho_maximo_mb"),
    zip_max_arquivos: fd.get("zip_max_arquivos"),
    zip_max_tamanho_mb: fd.get("zip_max_tamanho_mb"),
  });
  if (!d.success) return falhaValidacao(d.error);
  const exigirEquipe = booleano(fd, "exigir_2fa_equipe");
  const exigirClientes = booleano(fd, "exigir_2fa_clientes");
  const { error } = await s.supabase
    .from("escritorio")
    .update({ ...d.data, exigir_2fa_equipe: exigirEquipe, exigir_2fa_clientes: exigirClientes, updated_by: s.usuarioId })
    .eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidarTudo();
  const aviso = exigirEquipe && s.aal !== "aal2" ? " Como a verificação em duas etapas passou a ser obrigatória, você será levado ao cadastro dela agora." : "";
  return sucesso(`Configurações de segurança salvas.${aviso}`);
}

export async function salvarLembretes(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const textoDias = String(fd.get("lembretes_dias") ?? "");
  const partes = textoDias
    .split(/[;,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const dias = [...new Set(partes.map((x) => Number(x.replace("+", ""))))].sort((a, b) => a - b);
  if (partes.length && dias.some((n) => !Number.isInteger(n) || n < -30 || n > 60)) {
    return falha("Revise os dias dos lembretes.", { lembretes_dias: ["Use números inteiros entre -30 e 60, separados por vírgula (ex.: -5, -2, 0, 2, 5)."] });
  }
  if (dias.length > 10) return falha("Revise os dias dos lembretes.", { lembretes_dias: ["Use no máximo 10 dias."] });
  const phone = String(fd.get("whatsapp_phone_number_id") ?? "").trim();
  const modelo = String(fd.get("whatsapp_template_lembrete") ?? "").trim();
  const idioma = String(fd.get("whatsapp_template_idioma") ?? "pt_BR").trim() || "pt_BR";
  const modeloAviso = String(fd.get("whatsapp_template_aviso") ?? "").trim();
  if (modeloAviso && !/^[a-z0-9_]{1,512}$/.test(modeloAviso)) return falha("Revise a integração do WhatsApp.", { whatsapp_template_aviso: ["Use o nome exato do modelo aprovado (letras minúsculas, números e _)."] });
  if (phone && !/^\d{5,30}$/.test(phone)) return falha("Revise a integração do WhatsApp.", { whatsapp_phone_number_id: ["O identificador do número tem apenas dígitos (Phone Number ID da Meta)."] });
  if (modelo && !/^[a-z0-9_]{1,512}$/.test(modelo)) return falha("Revise a integração do WhatsApp.", { whatsapp_template_lembrete: ["Use o nome exato do modelo aprovado (letras minúsculas, números e _)."] });
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)) return falha("Revise a integração do WhatsApp.", { whatsapp_template_idioma: ["Ex.: pt_BR"] });
  const { error } = await s.supabase
    .from("escritorio")
    .update({
      lembretes_dias: dias,
      lembretes_email_ativo: booleano(fd, "lembretes_email_ativo"),
      lembretes_whatsapp_ativo: booleano(fd, "lembretes_whatsapp_ativo"),
      whatsapp_phone_number_id: phone || null,
      whatsapp_template_lembrete: modelo || null,
      whatsapp_template_idioma: idioma,
      avisos_whatsapp_ativo: booleano(fd, "avisos_whatsapp_ativo"),
      whatsapp_template_aviso: modeloAviso || null,
      updated_by: s.usuarioId,
    })
    .eq("id", 1);
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/configuracoes");
  return sucesso("Lembretes e avisos salvos.");
}


/** Logomarca: PNG ou JPEG até 2 MB, conferindo o conteúdo real do arquivo. */
export async function enviarLogo(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const arquivo = fd.get("logo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha o arquivo da logomarca.", { logo: ["Escolha um arquivo PNG ou JPG."] });
  if (arquivo.size > 2 * 1024 * 1024) return falha("Arquivo grande demais.", { logo: ["A logomarca deve ter até 2 MB."] });
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = tipoImagem(bytes);
  if (!tipo) return falha("Formato não aceito.", { logo: ["Use PNG ou JPG (o arquivo enviado não é uma imagem nesses formatos)."] });
  const caminho = `logo-${Date.now()}.${EXTENSAO_IMAGEM[tipo]}`;
  const { error } = await s.supabase.storage.from("marca").upload(caminho, bytes, { contentType: tipo, cacheControl: "31536000", upsert: false });
  if (error) return falha(`Não foi possível enviar a logomarca: ${error.message}`);
  const { data: anterior } = await s.supabase.from("escritorio").select("logo_path").eq("id", 1).single();
  const { error: e2 } = await s.supabase.rpc("definir_logo_escritorio", { p_path: caminho });
  if (e2) return falha(mensagemErro(e2));
  if (anterior?.logo_path && anterior.logo_path !== caminho) await s.supabase.storage.from("marca").remove([anterior.logo_path]);
  revalidarTudo();
  return sucesso("Logomarca atualizada.");
}

export async function removerLogo(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const { data: anterior } = await s.supabase.from("escritorio").select("logo_path").eq("id", 1).single();
  const { error } = await s.supabase.rpc("definir_logo_escritorio", { p_path: "" });
  if (error) return falha(mensagemErro(error));
  if (anterior?.logo_path) await s.supabase.storage.from("marca").remove([anterior.logo_path]);
  revalidarTudo();
  return sucesso("Logomarca removida. O portal volta a usar a logomarca oficial padrão.");
}

/** Envia um e-mail real de teste para o próprio administrador (somente com SMTP configurado). */
export async function testarEmail(): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (!emailConfigurado()) return falha("O envio de e-mail ainda não está configurado (servidor SMTP). Veja como ativar no guia de configuração.");
  const r = await enviarEmail(s.perfil.email, "Teste de envio — Portal Guarese's ON", {
    titulo: "Envio de e-mail funcionando",
    paragrafos: ["Este é um e-mail de teste enviado pelas configurações do portal.", "Se você recebeu esta mensagem, convites e lembretes por e-mail serão entregues normalmente."],
  });
  if (r.enviado) return sucesso(`E-mail de teste enviado para ${s.perfil.email}. Confira a caixa de entrada (e o spam).`);
  return falha(r.motivo === "falhou" ? `O servidor de e-mail recusou o envio: ${r.erro ?? "erro desconhecido"}` : "Envio de e-mail não configurado.");
}

const STATUS_PEDIDO = ["em_andamento", "concluida", "recusada"] as const;

export async function responderPedidoLgpd(pedidoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (!UUID.test(pedidoId)) return falha("Pedido inválido.");
  const d = z
    .object({
      status: z.enum(STATUS_PEDIDO, { message: "Escolha a situação." }),
      resposta: z.string().trim().min(5, "Escreva a resposta ao titular.").max(4000),
    })
    .safeParse({ status: fd.get("status"), resposta: fd.get("resposta") ?? "" });
  if (!d.success) return falhaValidacao(d.error);
  const { error } = await s.supabase.rpc("responder_solicitacao_titular", { p_id: pedidoId, p_status: d.data.status, p_resposta: d.data.resposta });
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/configuracoes");
  return sucesso("Resposta registrada. O titular foi avisado pelo portal.");
}

export async function salvarRetencao(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const padrao = Number(fd.get("retencao_padrao_anos"));
  if (!Number.isInteger(padrao) || padrao < 1 || padrao > 50) return falha("Revise o prazo padrão.", { retencao_padrao_anos: ["Use de 1 a 50 anos."] });
  const definir: { categoria_codigo: string; anos: number }[] = [];
  const remover: string[] = [];
  for (const [chave, valor] of fd.entries()) {
    if (!chave.startsWith("anos:")) continue;
    const codigo = chave.slice(5);
    if (!/^[a-z0-9_]{1,60}$/.test(codigo)) continue;
    const v = String(valor).trim();
    if (v === "") {
      remover.push(codigo);
      continue;
    }
    const anos = Number(v);
    if (!Number.isInteger(anos) || anos < 1 || anos > 50) return falha(`Prazo inválido em uma das categorias (use de 1 a 50 anos ou deixe em branco para usar o padrão).`);
    definir.push({ categoria_codigo: codigo, anos });
  }
  const { error } = await s.supabase.from("escritorio").update({ retencao_padrao_anos: padrao, updated_by: s.usuarioId }).eq("id", 1);
  if (error) return falha(mensagemErro(error));
  if (definir.length) {
    const { error: e2 } = await s.supabase.from("politicas_retencao").upsert(definir.map((x) => ({ ...x, updated_by: s.usuarioId })));
    if (e2) return falha(mensagemErro(e2));
  }
  if (remover.length) {
    const { error: e3 } = await s.supabase.from("politicas_retencao").delete().in("categoria_codigo", remover);
    if (e3) return falha(mensagemErro(e3));
  }
  revalidatePath("/escritorio/configuracoes");
  return sucesso("Prazos de guarda salvos.");
}

/** Eliminação definitiva de documentos cujo prazo de guarda venceu (mantém só o registro mínimo). */
export async function expurgarDocumentos(ids: string[], motivo: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const validos = [...new Set(ids)].filter((x) => UUID.test(x));
  if (!validos.length) return falha("Selecione os documentos.");
  if (validos.length > 500) return falha("Selecione no máximo 500 documentos por vez.");
  if (motivo.trim().length < 5) return falha("Informe o motivo da eliminação.");
  const { data, error } = await s.supabase.rpc("expurgar_documentos", { p_ids: validos, p_motivo: motivo.trim() });
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/configuracoes");
  return sucesso(`${data ?? 0} documento(s) eliminado(s). Os arquivos serão apagados do armazenamento em instantes.`);
}
