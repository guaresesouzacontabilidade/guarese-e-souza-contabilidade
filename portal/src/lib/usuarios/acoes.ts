"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirAdmin, exigirSessao, obterContextoEmpresa } from "@/lib/auth/sessao";
import { emailConfigurado, enviarEmail } from "@/lib/email/enviar";
import { envPublico } from "@/lib/env";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { PERMISSOES_EXCLUSIVAS_EQUIPE, TODAS_PERMISSOES, type Permissao } from "@/lib/permissoes";
import { dadosRequisicao } from "@/lib/requisicao";

const esquemaConvite = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  nome: z.string().trim().min(2, "Informe o nome."),
  empresa_id: z.string().uuid().nullable(),
  papel: z.enum(["equipe", "cliente_titular", "cliente_colaborador"]).nullable(),
  tipo_usuario: z.enum(["admin", "equipe", "cliente"]),
  permissoes: z.array(z.enum(TODAS_PERMISSOES)),
});

export interface DadosConvite {
  link?: string;
  emailEnviado?: boolean;
  usuarioExistente?: boolean;
}

async function gerarLinkAcesso(email: string, nome?: string) {
  const admin = criarClienteAdmin();
  const site = envPublico.siteUrl();
  const convite = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: nome ? { nome } : undefined } });
  if (!convite.error && convite.data?.properties?.hashed_token) {
    return {
      userId: convite.data.user.id,
      link: `${site}/auth/confirm?token_hash=${encodeURIComponent(convite.data.properties.hashed_token)}&type=invite&next=/definir-senha`,
      tipo: "invite" as const,
    };
  }
  // Usuário já confirmado: envia link de redefinição de senha.
  const rec = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (rec.error || !rec.data?.properties?.hashed_token) throw new Error(rec.error?.message ?? convite.error?.message ?? "Falha ao gerar link.");
  return {
    userId: rec.data.user.id,
    link: `${site}/auth/confirm?token_hash=${encodeURIComponent(rec.data.properties.hashed_token)}&type=recovery&next=/redefinir-senha`,
    tipo: "recovery" as const,
  };
}

async function enviarConviteEmail(email: string, nome: string, link: string, empresaNome: string | null, convidante: string) {
  if (!emailConfigurado()) return { status: "email_nao_configurado" as const, erro: null };
  const r = await enviarEmail(email, "Convite para o Portal Guarese's ON", {
    titulo: `Olá, ${nome.split(" ")[0]}!`,
    paragrafos: [
      `${convidante} convidou você para acessar o Portal Guarese's ON${empresaNome ? ` da empresa ${empresaNome}` : ""}.`,
      "No portal você envia documentos, acompanha as pendências do mês e consulta os relatórios da sua empresa.",
      "Clique no botão abaixo para definir sua senha e ativar o acesso.",
    ],
    botao: { texto: "Ativar meu acesso", url: link },
    aviso: "Este link é pessoal e de uso único. Se você não esperava este convite, ignore esta mensagem.",
  });
  return r.enviado ? { status: "enviado" as const, erro: null } : { status: "falhou" as const, erro: r.motivo === "falhou" ? r.erro ?? null : null };
}

/** Convida um usuário (cliente ou equipe) e vincula à empresa, quando informada. */
export async function convidarUsuario(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<DadosConvite>> {
  const sessao = await exigirSessao();
  const empresaId = (fd.get("empresa_id") as string) || null;
  const dados = esquemaConvite.safeParse({
    email: fd.get("email") ?? "",
    nome: fd.get("nome") ?? "",
    empresa_id: empresaId,
    papel: (fd.get("papel") as string) || null,
    tipo_usuario: (fd.get("tipo_usuario") as string) || "cliente",
    permissoes: fd.getAll("permissoes").map(String),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const d = dados.data;
  let empresaNome: string | null = null;
  const whatsapp = String(fd.get("whatsapp") ?? "").replace(/\D/g, "");
  if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 13)) {
    return falha("Revise o WhatsApp.", { whatsapp: ["Use DDD + número (ex.: 63 99999-0000)."] });
  }

  // Autorização no servidor (o banco valida novamente).
  if (!d.empresa_id) {
    if (sessao.perfil.tipo !== "admin") return falha("Somente administradores convidam pessoas da equipe.");
    if (d.tipo_usuario === "cliente") return falha("Clientes devem ser convidados a partir da empresa.");
  } else {
    const ctx = await obterContextoEmpresa(d.empresa_id);
    if (!ctx.pode("usuarios.gerenciar")) return falha("Você não tem permissão para convidar usuários nesta empresa.");
    empresaNome = ctx.acesso.nome_fantasia ?? ctx.acesso.razao_social;
    if (!d.papel || d.papel === "equipe") return falha("Selecione o papel do cliente.");
    if (d.permissoes.some((p) => PERMISSOES_EXCLUSIVAS_EQUIPE.includes(p))) return falha("Permissões exclusivas da equipe não podem ser concedidas a clientes.");
    if (ctx.acesso.papel === "cliente_titular" && d.papel !== "cliente_colaborador") return falha("Você só pode convidar colaboradores.");
  }

  const admin = criarClienteAdmin();
  const { data: existente } = await admin.from("perfis").select("id, tipo, nome, ativo").ilike("email", d.email).maybeSingle();

  let usuarioId: string;
  let link: string | undefined;
  let envioStatus: "enviado" | "falhou" | "email_nao_configurado" | "link_copiado" = "enviado";
  let envioErro: string | null = null;

  if (existente) {
    if (d.empresa_id && existente.tipo !== "cliente") return falha("Este e-mail pertence a um usuário da equipe. Vincule-o em Equipe e permissões.");
    if (!d.empresa_id) return falha("Já existe um usuário com este e-mail.");
    if (!existente.ativo) return falha("Este usuário está desativado. Reative-o antes de conceder acesso.");
    usuarioId = existente.id;
  } else {
    try {
      const gerado = await gerarLinkAcesso(d.email, d.nome);
      usuarioId = gerado.userId;
      link = gerado.link;
    } catch (e) {
      return falha(`Não foi possível criar o convite: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (d.tipo_usuario !== "cliente") {
      await admin.auth.admin.updateUserById(usuarioId, { app_metadata: { tipo: d.tipo_usuario } });
      await admin.from("perfis").update({ tipo: d.tipo_usuario, nome: d.nome }).eq("id", usuarioId);
    } else {
      await admin.from("perfis").update({ nome: d.nome }).eq("id", usuarioId);
    }
  }

  if (d.empresa_id && d.papel) {
    const { error } = await sessao.supabase.rpc("vincular_membro", {
      p_empresa_id: d.empresa_id,
      p_user_id: usuarioId,
      p_papel: d.papel,
      p_permissoes: d.permissoes.length ? d.permissoes : undefined,
    });
    if (error) return falha(mensagemErro(error));
  }

  // WhatsApp para os avisos do portal, com a autorização registrada pelo escritório.
  let avisoWhatsapp = "";
  if (d.empresa_id && whatsapp) {
    const { error } = await sessao.supabase.rpc("definir_whatsapp_membro", {
      p_empresa_id: d.empresa_id,
      p_user_id: usuarioId,
      p_telefone: whatsapp,
      p_autorizado: fd.get("whatsapp_autorizado") === "on",
    });
    avisoWhatsapp = error ? ` O WhatsApp não foi salvo (${mensagemErro(error)}).` : "";
  }

  if (link) {
    const r = await enviarConviteEmail(d.email, d.nome, link, empresaNome, sessao.perfil.nome);
    envioStatus = r.status;
    envioErro = r.erro;
  } else if (existente && emailConfigurado()) {
    await enviarEmail(d.email, "Novo acesso liberado — Portal Guarese's ON", {
      titulo: "Novo acesso liberado",
      paragrafos: [`Você recebeu acesso à empresa ${empresaNome} no Portal Guarese's ON. Use o seletor de empresas no topo do portal.`],
      botao: { texto: "Abrir o portal", url: `${envPublico.siteUrl()}/painel` },
    });
  }

  await sessao.supabase.rpc("registrar_convite", {
    p_email: d.email,
    p_nome: d.nome,
    p_user_id: usuarioId,
    p_tipo_usuario: existente ? (existente.tipo as string) : d.tipo_usuario,
    p_empresa_id: d.empresa_id as unknown as string,
    p_papel: d.papel as unknown as string,
    p_permissoes: d.permissoes,
    p_envio_status: existente ? "enviado" : envioStatus,
    p_envio_erro: envioErro ?? undefined,
  });

  if (d.empresa_id) revalidatePath(`/escritorio/empresas/${d.empresa_id}`);
  revalidatePath("/escritorio/equipe");

  if (existente) return sucesso(`O usuário já tinha cadastro: o acesso à empresa foi liberado.${avisoWhatsapp}`, { usuarioExistente: true });
  if (envioStatus === "enviado") return sucesso(`Convite enviado para ${d.email}.${avisoWhatsapp}`, { link, emailEnviado: true });
  return sucesso(
    (envioStatus === "email_nao_configurado"
      ? "Convite criado. O envio de e-mail não está configurado: copie o link e envie ao convidado."
      : "Convite criado, mas o e-mail falhou. Copie o link e envie ao convidado.") + avisoWhatsapp,
    { link, emailEnviado: false },
  );
}

/** Gera um novo link de acesso (convite ou redefinição) para um usuário. */
export async function reenviarAcesso(usuarioId: string, empresaId: string | null): Promise<ResultadoAcao<DadosConvite>> {
  const sessao = await exigirSessao();
  if (empresaId) {
    const ctx = await obterContextoEmpresa(empresaId);
    if (!ctx.pode("usuarios.gerenciar")) return falha("Sem permissão.");
    const { data: membro } = await ctx.supabase.from("empresa_membros").select("id").eq("empresa_id", empresaId).eq("user_id", usuarioId).maybeSingle();
    if (!membro) return falha("Usuário não vinculado a esta empresa.");
  } else if (sessao.perfil.tipo !== "admin") {
    return falha("Sem permissão.");
  }
  const admin = criarClienteAdmin();
  const { data: perfil } = await admin.from("perfis").select("email, nome").eq("id", usuarioId).single();
  if (!perfil) return falha("Usuário não encontrado.");
  try {
    const gerado = await gerarLinkAcesso(perfil.email, perfil.nome);
    const r = await enviarConviteEmail(perfil.email, perfil.nome, gerado.link, null, sessao.perfil.nome);
    const { ip, userAgent } = await dadosRequisicao();
    await sessao.supabase.rpc("registrar_evento", {
      p_acao: "convite_reenviado",
      p_entidade: "perfis",
      p_entidade_id: usuarioId,
      p_empresa_id: empresaId ?? undefined,
      p_detalhes: { envio: r.status },
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
    });
    if (r.status === "enviado") return sucesso(`Novo link enviado para ${perfil.email}.`, { link: gerado.link, emailEnviado: true });
    return sucesso("Link gerado. Copie e envie ao usuário (e-mail não enviado).", { link: gerado.link, emailEnviado: false });
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Falha ao gerar o link.");
  }
}

export async function atualizarPermissoesMembro(
  empresaId: string,
  membroId: string,
  _anterior: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("usuarios.gerenciar")) return falha("Sem permissão.");
  const papel = String(fd.get("papel") ?? "");
  const permissoes = fd.getAll("permissoes").map(String) as Permissao[];
  const { error } = await ctx.supabase.rpc("atualizar_membro", { p_membro_id: membroId, p_papel: papel, p_permissoes: permissoes });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  revalidatePath(`/e/${empresaId}/configuracoes`);
  return sucesso("Permissões atualizadas.");
}

export async function revogarMembro(empresaId: string, membroId: string, motivo: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("usuarios.gerenciar")) return falha("Sem permissão.");
  const { error } = await ctx.supabase.rpc("revogar_membro", { p_membro_id: membroId, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  revalidatePath(`/e/${empresaId}/configuracoes`);
  return sucesso("Acesso revogado. O usuário perdeu o acesso imediatamente.");
}

export async function vincularMembroExistente(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  await exigirAdmin();
  const sessao = await exigirSessao();
  const empresaId = String(fd.get("empresa_id") ?? "");
  const usuarioId = String(fd.get("user_id") ?? "");
  const papel = String(fd.get("papel") ?? "equipe");
  if (!empresaId || !usuarioId) return falha("Selecione a empresa e o usuário.");
  const { error } = await sessao.supabase.rpc("vincular_membro", { p_empresa_id: empresaId, p_user_id: usuarioId, p_papel: papel });
  if (error) return falha(mensagemErro(error));
  revalidatePath("/escritorio/equipe");
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  return sucesso("Vínculo criado.");
}

/** Administrador: altera tipo/ativação de um usuário (e bloqueia o login quando inativo). */
export async function administrarUsuario(usuarioId: string, tipo: "admin" | "equipe" | "cliente", ativo: boolean, cargo?: string): Promise<ResultadoAcao> {
  const sessao = await exigirAdmin();
  const { error } = await sessao.supabase.rpc("administrar_usuario", { p_user_id: usuarioId, p_tipo: tipo, p_ativo: ativo, p_cargo: cargo });
  if (error) return falha(mensagemErro(error));
  const admin = criarClienteAdmin();
  await admin.auth.admin.updateUserById(usuarioId, {
    app_metadata: { tipo },
    ban_duration: ativo ? "none" : "876000h",
  });
  revalidatePath("/escritorio/equipe");
  return sucesso(ativo ? "Usuário atualizado." : "Usuário desativado: o acesso e as sessões foram encerrados.");
}

export async function encerrarSessoesUsuario(usuarioId: string): Promise<ResultadoAcao> {
  const sessao = await exigirSessao();
  if (sessao.perfil.tipo !== "admin" && usuarioId !== sessao.usuarioId) return falha("Sem permissão.");
  const { data, error } = await sessao.supabase.rpc("encerrar_sessoes_usuario", { p_user_id: usuarioId });
  if (error) return falha(mensagemErro(error));
  return sucesso(`${data ?? 0} sessão(ões) encerrada(s).`);
}

const UUID = /^[0-9a-f-]{36}$/i;

async function revalidarEquipe(usuarioId: string) {
  revalidatePath("/escritorio/equipe");
  revalidatePath(`/escritorio/equipe/${usuarioId}`);
}

/** Administrador: altera o perfil (administrador/equipe) e o cargo de um usuário. */
export async function editarUsuario(usuarioId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const d = z
    .object({ tipo: z.enum(["admin", "equipe", "cliente"]), cargo: z.string().trim().max(80, "Use até 80 caracteres.") })
    .safeParse({ tipo: fd.get("tipo"), cargo: fd.get("cargo") ?? "" });
  if (!d.success) return falhaValidacao(d.error);
  const { data: atual } = await s.supabase.from("perfis").select("ativo, tipo").eq("id", usuarioId).maybeSingle();
  if (!atual) return falha("Usuário não encontrado.");
  if ((atual.tipo === "cliente") !== (d.data.tipo === "cliente")) return falha("Não é possível transformar cliente em equipe (ou o contrário). Convide a pessoa com o perfil correto.");
  const r = await administrarUsuario(usuarioId, d.data.tipo, atual.ativo, d.data.cargo);
  if (!r.ok) return r;
  await revalidarEquipe(usuarioId);
  return sucesso("Dados atualizados.");
}

/** Administrador: desativa (bloqueia login e encerra sessões) ou reativa um usuário. */
export async function alterarSituacaoUsuario(usuarioId: string, ativo: boolean): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (!UUID.test(usuarioId)) return falha("Usuário inválido.");
  const { data: atual } = await s.supabase.from("perfis").select("tipo, cargo, anonimizado_em").eq("id", usuarioId).maybeSingle();
  if (!atual) return falha("Usuário não encontrado.");
  if (ativo && atual.anonimizado_em) return falha("Usuário anonimizado não pode ser reativado.");
  const r = await administrarUsuario(usuarioId, atual.tipo as "admin" | "equipe" | "cliente", ativo, atual.cargo ?? undefined);
  if (!r.ok) return r;
  await revalidarEquipe(usuarioId);
  return sucesso(ativo ? "Acesso reativado. Se a pessoa não lembrar a senha, gere um novo link de acesso." : "Usuário desativado: o login foi bloqueado e as sessões foram encerradas.");
}

/** Administrador: vincula uma pessoa da equipe a uma ou mais empresas. */
export async function vincularEquipeEmpresas(usuarioId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  const empresas = [...new Set(fd.getAll("empresas").map(String))].filter((x) => UUID.test(x));
  const validas = new Set<string>(TODAS_PERMISSOES);
  const permissoes = fd.getAll("permissoes").map(String).filter((p) => validas.has(p)) as Permissao[];
  if (!empresas.length) return falha("Selecione ao menos uma empresa.");
  if (!permissoes.length) return falha("Selecione as permissões.");
  const { data: alvo } = await s.supabase.from("perfis").select("tipo, ativo").eq("id", usuarioId).maybeSingle();
  if (!alvo) return falha("Usuário não encontrado.");
  if (alvo.tipo === "admin") return falha("Administradores já acessam todas as empresas.");
  if (alvo.tipo !== "equipe") return falha("Clientes são convidados pela página da empresa.");
  if (!alvo.ativo) return falha("Reative o usuário antes de vincular empresas.");
  let feitos = 0;
  for (const empresaId of empresas) {
    const { error } = await s.supabase.rpc("vincular_membro", { p_empresa_id: empresaId, p_user_id: usuarioId, p_papel: "equipe", p_permissoes: permissoes });
    if (error) {
      await revalidarEquipe(usuarioId);
      return falha(`${feitos ? `${feitos} empresa(s) vinculada(s) antes do erro. ` : ""}${mensagemErro(error)}`);
    }
    feitos++;
  }
  await revalidarEquipe(usuarioId);
  return sucesso(feitos === 1 ? "Empresa vinculada." : `${feitos} empresas vinculadas.`);
}

/**
 * Administrador: anonimiza os dados pessoais de um usuário (LGPD). O histórico
 * contábil é preservado; nome, e-mail e telefone são removidos e o login é bloqueado.
 */
export async function anonimizarUsuario(usuarioId: string, motivo: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (!UUID.test(usuarioId)) return falha("Usuário inválido.");
  if (motivo.trim().length < 5) return falha("Informe o motivo (por exemplo, o pedido de exclusão recebido).");
  const { error } = await s.supabase.rpc("anonimizar_usuario", { p_user_id: usuarioId, p_motivo: motivo.trim() });
  if (error) return falha(mensagemErro(error));
  const admin = criarClienteAdmin();
  const { data: p } = await admin.from("perfis").select("email").eq("id", usuarioId).single();
  const { error: erroAuth } = await admin.auth.admin.updateUserById(usuarioId, {
    email: p?.email,
    email_confirm: true,
    user_metadata: { nome: "Usuário anonimizado" },
    ban_duration: "876000h",
  });
  await revalidarEquipe(usuarioId);
  if (erroAuth) return sucesso("Dados anonimizados no portal. Atenção: não foi possível atualizar o cadastro de login; o acesso continua bloqueado.");
  return sucesso("Dados pessoais anonimizados e acesso bloqueado definitivamente.");
}

/** Administrador: remove a verificação em duas etapas de quem perdeu o celular (e encerra as sessões). */
export async function redefinirDuasEtapas(usuarioId: string): Promise<ResultadoAcao> {
  const s = await exigirAdmin();
  if (!UUID.test(usuarioId)) return falha("Usuário inválido.");
  if (usuarioId === s.usuarioId) return falha("Para o seu próprio usuário, use Minha conta.");
  const admin = criarClienteAdmin();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: usuarioId });
  if (error) return falha("Não foi possível consultar a verificação em duas etapas desta pessoa.");
  const fatores = data?.factors ?? [];
  if (!fatores.length) return falha("Esta pessoa não tem verificação em duas etapas cadastrada.");
  for (const f of fatores) {
    const { error: e } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: usuarioId });
    if (e) return falha("Não foi possível remover a verificação em duas etapas. Tente novamente.");
  }
  await s.supabase.rpc("encerrar_sessoes_usuario", { p_user_id: usuarioId });
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "mfa_redefinido",
    p_entidade: "perfis",
    p_entidade_id: usuarioId,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  await revalidarEquipe(usuarioId);
  return sucesso("Verificação em duas etapas removida e sessões encerradas. No próximo acesso a pessoa cadastra o autenticador de novo.");
}

/** Cadastra (ou remove) o WhatsApp de um cliente da empresa e a autorização para avisos. */
export async function definirWhatsappMembro(empresaId: string, usuarioId: string, telefone: string, autorizado: boolean): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("usuarios.gerenciar")) return falha("Você não tem permissão para alterar os usuários desta empresa.");
  if (!UUID.test(usuarioId)) return falha("Usuário inválido.");
  const numero = telefone.replace(/\D/g, "");
  if (numero && (numero.length < 10 || numero.length > 13)) return falha("WhatsApp inválido. Use DDD + número.");
  const { error } = await ctx.supabase.rpc("definir_whatsapp_membro", {
    p_empresa_id: empresaId,
    p_user_id: usuarioId,
    p_telefone: numero,
    p_autorizado: autorizado,
  });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  revalidatePath(`/e/${empresaId}/configuracoes`);
  return sucesso(autorizado && numero ? "WhatsApp salvo: o cliente passa a receber os avisos por lá." : "WhatsApp atualizado.");
}

