/**
 * Dados FICTÍCIOS para o ambiente de DEMONSTRAÇÃO (ou desenvolvimento local).
 *
 * Uso:
 *   npm run seed:demo -- --confirmar [--senha "SenhaDemo123!"] [--manter-senhas]
 *
 * Regras de segurança:
 *  - Recusa executar quando NEXT_PUBLIC_AMBIENTE=producao.
 *  - Todas as empresas criadas ficam marcadas como "demonstração" e os nomes
 *    trazem "(DEMONSTRAÇÃO)". Os e-mails usam o domínio reservado ".test".
 *  - Use um projeto Supabase separado para a demonstração: os dados reais do
 *    escritório nunca devem conviver com dados fictícios.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { carregarEnv } from "./util-env";
import { semearFinanceiro } from "./demo-financeiro";
import { semearDocumentos } from "./demo-documentos";
import { semearObrigacoes } from "./demo-obrigacoes";
import { semearCalculos } from "./demo-calculos";
import { semearVencimentos } from "./demo-vencimentos";
import { semearAgenda } from "./demo-agenda";
import { semearSolicitacoes } from "./demo-solicitacoes";
import { semearAuditor } from "./demo-auditor";

carregarEnv();

const DOMINIO = "demo.guareses.test";

function argumento(nome: string) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function cnpjValido(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

function competencia(deslocamentoMeses: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamentoMeses);
  return d.toISOString().slice(0, 8) + "01";
}

const MANTER_SENHAS = process.argv.includes("--manter-senhas");

async function garantirUsuario(admin: SupabaseClient, email: string, nome: string, tipo: "admin" | "equipe" | "cliente", senha: string) {
  const { data: existente } = await admin.from("perfis").select("id").eq("email", email).maybeSingle();
  if (existente) {
    await admin.auth.admin.updateUserById(existente.id, MANTER_SENHAS ? { app_metadata: { tipo } } : { password: senha, app_metadata: { tipo } });
    await admin.from("perfis").update({ tipo, nome, ativo: true }).eq("id", existente.id);
    return existente.id as string;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome }, app_metadata: { tipo } });
  if (error) throw new Error(`Falha ao criar ${email}: ${error.message}`);
  await admin.from("perfis").update({ tipo, nome }).eq("id", data.user.id);
  return data.user.id;
}

async function main() {
  const ambiente = process.env.NEXT_PUBLIC_AMBIENTE ?? "desenvolvimento";
  if (ambiente === "producao") {
    console.error("Recusado: este script só pode ser usado em ambiente de demonstração ou desenvolvimento (NEXT_PUBLIC_AMBIENTE).");
    process.exit(1);
  }
  if (!process.argv.includes("--confirmar")) {
    console.error("Este script cria dados FICTÍCIOS. Execute com --confirmar.");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secreta = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publica = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !secreta || !publica) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY.");
  const senha = argumento("senha") ?? `Demo-${randomBytes(6).toString("base64url")}9!`;

  const admin = createClient(url, secreta, { auth: { persistSession: false } });

  // Usuários fictícios
  await garantirUsuario(admin, `admin@${DOMINIO}`, "Administrador Demonstração", "admin", senha);
  const idEquipe = await garantirUsuario(admin, `contador@${DOMINIO}`, "Contadora Demonstração", "equipe", senha);
  const idCliente = await garantirUsuario(admin, `cliente@${DOMINIO}`, "Cliente da Padaria (Demonstração)", "cliente", senha);
  const idCliente2 = await garantirUsuario(admin, `cliente2@${DOMINIO}`, "Cliente da Oficina (Demonstração)", "cliente", senha);
  const idColab = await garantirUsuario(admin, `colaborador@${DOMINIO}`, "Colaborador da Padaria (Demonstração)", "cliente", senha);

  // As empresas são criadas pelas mesmas funções usadas no portal (como administrador)
  // Sessão do administrador fictício por link de uso único (não depende de conhecer a senha atual)
  const comoAdmin = createClient(url, publica, { auth: { persistSession: false } });
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: `admin@${DOMINIO}` });
  if (eLink || !link.properties?.hashed_token) throw new Error(`Falha ao preparar o acesso do administrador de demonstração: ${eLink?.message ?? "sem token"}`);
  const { error: eLogin } = await comoAdmin.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (eLogin) throw new Error(`Falha ao entrar como administrador de demonstração: ${eLogin.message}`);

  const empresas = [
    {
      razao_social: "PADARIA PAO DOURADO LTDA (DEMONSTRAÇÃO)",
      nome_fantasia: "Padaria Pão Dourado (DEMO)",
      documento: cnpjValido("112223330001"),
      regime_tributario: "simples_nacional",
      atividade_principal: "Fabricação e comércio de produtos de panificação",
      cnae: "1091-1/02",
      servicos: ["contabil", "fiscal", "folha", "financeiro"],
      controla_estoque: true,
    },
    {
      razao_social: "OFICINA MECANICA EXEMPLO LTDA (DEMONSTRAÇÃO)",
      nome_fantasia: "Oficina Exemplo (DEMO)",
      documento: cnpjValido("445556660001"),
      regime_tributario: "lucro_presumido",
      atividade_principal: "Serviços de manutenção e reparação de veículos",
      cnae: "4520-0/01",
      servicos: ["contabil", "fiscal", "financeiro"],
      controla_estoque: false,
    },
  ];

  const ids: string[] = [];
  for (const e of empresas) {
    const { data: existente } = await admin.from("empresas").select("id").eq("documento", e.documento).maybeSingle();
    if (existente) {
      ids.push(existente.id);
      continue;
    }
    const { data, error } = await comoAdmin.rpc("criar_empresa", {
      p_dados: {
        ...e,
        tipo_pessoa: "PJ",
        logradouro: "Rua Fictícia",
        numero: "100",
        bairro: "Centro",
        cidade: "Porto Nacional",
        uf: "TO",
        cep: "77500000",
        email: `contato@${DOMINIO}`,
        contador_responsavel_id: idEquipe,
        data_inicio_atendimento: competencia(-12),
        demonstracao: true,
      },
    });
    if (error) throw new Error(`Falha ao criar empresa ${e.nome_fantasia}: ${error.message}`);
    ids.push(data as string);
  }

  // Vínculos dos clientes fictícios
  const titular = [
    "empresa.ver", "usuarios.gerenciar", "documentos.ver", "documentos.enviar", "documentos.baixar", "financeiro.ver", "financeiro.editar",
    "financeiro.importar", "relatorios.ver", "mensagens.usar", "calculos.ver", "colaboradores.gerenciar", "certificado.gerenciar", "auditor.ver",
  ];
  const colaborador = ["empresa.ver", "documentos.ver", "documentos.enviar", "mensagens.usar"];
  // Cada cliente fictício acessa SOMENTE a própria empresa (demonstra o isolamento dos dados).
  const [padaria, oficina] = ids;
  await admin.from("empresa_membros").upsert({ empresa_id: padaria, user_id: idCliente, papel: "cliente_titular", permissoes: titular, ativo: true }, { onConflict: "empresa_id,user_id" });
  await admin.from("empresa_membros").upsert({ empresa_id: padaria, user_id: idColab, papel: "cliente_colaborador", permissoes: colaborador, ativo: true }, { onConflict: "empresa_id,user_id" });
  await admin.from("empresa_membros").upsert({ empresa_id: oficina, user_id: idCliente2, papel: "cliente_titular", permissoes: titular, ativo: true }, { onConflict: "empresa_id,user_id" });
  // Versões anteriores deste script davam ao primeiro cliente acesso às duas empresas: remove.
  await admin.from("empresa_membros").delete().eq("empresa_id", oficina).eq("user_id", idCliente);

  // Contas financeiras fictícias (somente se a empresa ainda não tiver contas)
  const inicio = `${new Date().getUTCFullYear() - 1}-12-31`;
  for (const empresaId of ids) {
    const { count } = await admin.from("contas_financeiras").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
    if (count) continue;
    const { data: banco } = await admin
      .from("contas_financeiras")
      .insert({ empresa_id: empresaId, tipo: "conta_corrente", nome: "Banco do Brasil — Conta corrente (DEMO)", banco_codigo: "001", banco_nome: "Banco do Brasil", agencia: "1234-5", numero: "98765-4", saldo_inicial: 15000, saldo_inicial_data: inicio })
      .select("id")
      .single();
    await admin.from("contas_financeiras").insert([
      { empresa_id: empresaId, tipo: "caixa", nome: "Caixa da loja (DEMO)", saldo_inicial: 500, saldo_inicial_data: inicio },
      { empresa_id: empresaId, tipo: "cartao_credito", nome: "Cartão Visa empresarial (DEMO)", saldo_inicial: 0, saldo_inicial_data: inicio, cartao_dia_fechamento: 25, cartao_dia_vencimento: 5, cartao_conta_pagamento_id: banco?.id ?? null },
      { empresa_id: empresaId, tipo: "adquirente", nome: "Maquininha Stone (DEMO)", saldo_inicial: 0, saldo_inicial_data: inicio },
    ]);
  }

  // Checklist das últimas competências
  for (const empresaId of ids) {
    for (const d of [-2, -1, 0]) await comoAdmin.rpc("gerar_checklist_competencia", { p_empresa_id: empresaId, p_competencia: competencia(d) });
  }

  // Movimento financeiro fictício (vendas, despesas, extratos e conciliações)
  for (const [i, empresaId] of ids.entries()) {
    const criado = await semearFinanceiro(admin, comoAdmin, empresaId, i === 0 ? "padaria" : "oficina");
    if (criado) console.log(`  Financeiro de demonstração criado: ${empresas[i].nome_fantasia}`);
  }

  // Documentos, conversas e fechamento fictícios
  for (const [i, empresaId] of ids.entries()) {
    const criado = await semearDocumentos(admin, { url, publica }, empresaId, i === 0 ? "padaria" : "oficina", {
      cliente: i === 0 ? `cliente@${DOMINIO}` : `cliente2@${DOMINIO}`,
      equipe: `contador@${DOMINIO}`,
    });
    if (criado) console.log(`  Documentos de demonstração criados: ${empresas[i].nome_fantasia}`);
  }

  // Camada operacional: regimes, regras do catálogo aplicadas pelo administrador fictício e tarefas
  const criadasObrigacoes = await semearObrigacoes({
    admin,
    conexao: { url, publica },
    padaria: ids[0],
    oficina: ids[1],
    emails: { admin: `admin@${DOMINIO}`, equipe: `contador@${DOMINIO}`, cliente: `cliente@${DOMINIO}`, cliente2: `cliente2@${DOMINIO}` },
  });
  if (criadasObrigacoes) console.log("  Obrigações e tarefas de demonstração criadas");

  // Cálculos: parâmetros, receita informada e colaboradores fictícios
  if (await semearCalculos(admin, { padaria: ids[0], oficina: ids[1] })) console.log("  Cálculos e colaboradores de demonstração criados");
  if (await semearVencimentos(admin, { padaria: ids[0], oficina: ids[1] })) console.log("  Vencimentos de demonstração criados");
  const pagas = await semearAgenda(admin, ids);
  if (pagas) console.log(`  Agenda de pagamentos: ${pagas} guia(s) de demonstração marcada(s) como paga(s)`);
  const solicitacoes = await semearSolicitacoes(admin, { url, publica }, { padaria: ids[0], oficina: ids[1] }, {
    cliente: `cliente@${DOMINIO}`,
    cliente2: `cliente2@${DOMINIO}`,
    equipe: `contador@${DOMINIO}`,
  });
  if (solicitacoes) console.log("  Solicitações de serviço de demonstração criadas");
  const auditor = await semearAuditor(admin, { url, publica }, { padaria: ids[0], oficina: ids[1] }, {
    cliente: `cliente@${DOMINIO}`,
    cliente2: `cliente2@${DOMINIO}`,
  });
  if (auditor) console.log("  Notas de demonstração do auditor fiscal enviadas (a análise roda na fila)");

  console.log("\nDados de DEMONSTRAÇÃO prontos (todos fictícios):");
  console.log(`  Administrador:  admin@${DOMINIO}`);
  console.log(`  Equipe:         contador@${DOMINIO}`);
  console.log(`  Cliente 1:      cliente@${DOMINIO}  (somente Padaria)`);
  console.log(`  Cliente 2:      cliente2@${DOMINIO} (somente Oficina)`);
  console.log(`  Colaborador:    colaborador@${DOMINIO} (Padaria, acesso restrito)`);
  console.log(MANTER_SENHAS ? "  Senhas: mantidas (não foram alteradas)" : `  Senha de todos: ${senha}`);
  console.log(`  Empresas:       ${empresas.map((e) => e.nome_fantasia).join(", ")}\n`);
}

main().catch((e) => {
  console.error("Erro:", e instanceof Error ? e.message : e);
  process.exit(1);
});
