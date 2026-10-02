/**
 * Publica o Portal Guarese's ON no Supabase (banco, login e arquivos — região
 * São Paulo) e na Vercel (o site — região São Paulo).
 *
 * Dois ambientes, sempre em projetos SEPARADOS (dados fictícios nunca convivem
 * com dados reais):
 *   - demonstração (padrão): site "portal-guareses-on" e banco
 *     "portal-guareses-on-demo", com dados FICTÍCIOS e faixa de aviso no topo;
 *   - produção (--producao): site e banco "portal-guareses-on-producao",
 *     vazio, para os dados reais; cria o primeiro administrador e mostra o
 *     link para ele definir a senha.
 *
 * O que o script faz (pode ser executado de novo com segurança — reaproveita
 * o que já existe):
 *   1. cria (ou encontra) o projeto no Supabase e aguarda ficar pronto;
 *   2. aplica as migrações (tabelas, regras de acesso RLS, funções, buckets);
 *   3. configura o login (cadastro público DESLIGADO, senhas fortes, 2FA,
 *      endereços permitidos e modelos de e-mail em português);
 *   4. cria (ou encontra) o projeto na Vercel, cadastra as variáveis e publica;
 *   5. agenda as rotinas (fila de tarefas a cada 5 min e rotina diária);
 *   6. demonstração: cria os dados fictícios; produção: cria o administrador;
 *   7. verifica o site.
 *
 * Requer: SUPABASE_ACCESS_TOKEN e VERCEL_TOKEN (variáveis de ambiente).
 * Uso:    NODE_USE_ENV_PROXY=1 npx tsx scripts/publicar.ts
 *         NODE_USE_ENV_PROXY=1 npx tsx scripts/publicar.ts --producao [--admin-email email] [--admin-nome "Nome"] [--dominio portal.exemplo.com.br]
 *
 * Segurança: nenhuma chave é gravada no repositório. O resumo (com a senha
 * dos usuários de demonstração) fica em .publicacao*.json, ignorado pelo Git.
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(__dirname, "..");
const SB = "https://api.supabase.com/v1";
const VC = "https://api.vercel.com";
const REGIAO_SUPABASE = "sa-east-1";

function argumento(nome: string, padrao: string) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}
const PRODUCAO = process.argv.includes("--producao");
const NOME = argumento("nome", PRODUCAO ? "portal-guareses-on-producao" : "portal-guareses-on");
const NOME_SUPABASE = argumento("nome-supabase", PRODUCAO ? "portal-guareses-on-producao" : "portal-guareses-on-demo");
const ADMIN_EMAIL = argumento("admin-email", "guaresesouzacontabilidade@gmail.com").trim().toLowerCase();
const ADMIN_NOME = argumento("admin-nome", "Administrador Guarese's ON");
// Domínio próprio (ex.: portal.guaresesoncontabilidade.com.br). O DNS precisa apontar para a Vercel.
const DOMINIO = argumento("dominio", "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

const tokenSupabase = process.env.SUPABASE_ACCESS_TOKEN;
const tokenVercel = process.env.VERCEL_TOKEN;

function passo(t: string) {
  console.log(`\n▶ ${t}`);
}
function ok(t: string) {
  console.log(`  ✔ ${t}`);
}
function aviso(t: string) {
  console.log(`  ⚠ ${t}`);
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamar<T>(base: string, token: string, caminho: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${base}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const texto = await r.text();
  let corpo: unknown = texto;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    /* resposta não-JSON */
  }
  if (!r.ok) {
    const msg = typeof corpo === "object" && corpo ? JSON.stringify(corpo).slice(0, 600) : String(texto).slice(0, 600);
    const e = new Error(`${init.method ?? "GET"} ${caminho} → ${r.status}: ${msg}`) as Error & { status: number };
    e.status = r.status;
    throw e;
  }
  return corpo as T;
}
const sb = <T>(c: string, i?: RequestInit) => chamar<T>(SB, tokenSupabase!, c, i);
let equipeVercel: string | null = null;
const vc = <T>(c: string, i?: RequestInit) => chamar<T>(VC, tokenVercel!, equipeVercel ? `${c}${c.includes("?") ? "&" : "?"}teamId=${equipeVercel}` : c, i);

async function sql<T = Record<string, unknown>[]>(ref: string, consulta: string): Promise<T> {
  return sb<T>(`/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query: consulta }) });
}
const literal = (t: string) => `'${t.replace(/'/g, "''")}'`;

// ------------------------------------------------------------------- Supabase
interface ProjetoSb {
  id: string;
  ref?: string;
  name: string;
  status: string;
  region: string;
  organization_id: string;
}

async function projetoSupabase(): Promise<{ ref: string; novo: boolean; senhaBanco: string | null }> {
  passo("Supabase: projeto (banco de dados, login e arquivos)");
  const projetos = await sb<ProjetoSb[]>("/projects");
  const existente = projetos.find((p) => p.name === NOME_SUPABASE);
  if (existente) {
    ok(`Projeto já existe: ${existente.name} (${existente.id}), região ${existente.region}`);
    return { ref: existente.id, novo: false, senhaBanco: null };
  }
  const orgs = await sb<{ id: string; name: string }[]>("/organizations");
  // alguns tokens não listam organizações; usa SUPABASE_ORG_ID ou a organização de um projeto existente
  const idOrg = process.env.SUPABASE_ORG_ID ?? projetos[0]?.organization_id;
  const org = orgs.find((o) => o.id === idOrg) ?? orgs[0] ?? (idOrg ? { id: idOrg, name: idOrg } : null);
  if (!org) throw new Error("Nenhuma organização encontrada na conta do Supabase (defina SUPABASE_ORG_ID).");
  const senhaBanco = randomBytes(18).toString("base64url");
  const criado = await sb<ProjetoSb>("/projects", {
    method: "POST",
    body: JSON.stringify({ name: NOME_SUPABASE, organization_id: org.id, region: REGIAO_SUPABASE, db_pass: senhaBanco }),
  });
  ok(`Projeto criado na organização “${org.name}”: ${criado.id} (região ${REGIAO_SUPABASE}, plano gratuito)`);
  return { ref: criado.id, novo: true, senhaBanco };
}

async function aguardarProjeto(ref: string) {
  passo("Supabase: aguardando o projeto ficar pronto (pode levar alguns minutos)");
  for (let i = 0; i < 90; i++) {
    const p = await sb<ProjetoSb>(`/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") {
      // o banco pode levar mais alguns segundos para aceitar consultas
      for (let j = 0; j < 30; j++) {
        try {
          await sql(ref, "select 1 as ok");
          ok("Projeto pronto.");
          return;
        } catch {
          await esperar(5000);
        }
      }
    }
    await esperar(10000);
  }
  throw new Error("O projeto do Supabase não ficou pronto a tempo. Execute o script novamente em alguns minutos.");
}

async function chavesSupabase(ref: string) {
  const chaves = await sb<{ name: string; api_key: string; type?: string }[]>(`/projects/${ref}/api-keys?reveal=true`);
  const publica = chaves.find((c) => c.type === "publishable") ?? chaves.find((c) => c.name === "anon");
  const secreta = chaves.find((c) => c.type === "secret") ?? chaves.find((c) => c.name === "service_role");
  if (!publica?.api_key || !secreta?.api_key) throw new Error("Não foi possível obter as chaves de API do projeto.");
  return { url: `https://${ref}.supabase.co`, publica: publica.api_key, secreta: secreta.api_key };
}

async function aplicarMigracoes(ref: string) {
  passo("Supabase: aplicando migrações (tabelas, regras de acesso e funções)");
  await sql(
    ref,
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`,
  );
  const aplicadas = new Set((await sql<{ version: string }[]>(ref, "select version from supabase_migrations.schema_migrations")).map((r) => r.version));
  const pasta = join(RAIZ, "supabase", "migrations");
  const arquivos = readdirSync(pasta).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const arq of arquivos) {
    const [versao, ...resto] = arq.replace(/\.sql$/, "").split("_");
    if (aplicadas.has(versao)) {
      ok(`${arq} (já aplicada)`);
      continue;
    }
    const conteudo = readFileSync(join(pasta, arq), "utf8");
    await sql(ref, conteudo);
    await sql(ref, `insert into supabase_migrations.schema_migrations (version, name) values (${literal(versao)}, ${literal(resto.join("_"))}) on conflict do nothing`);
    ok(arq);
  }
}

async function configurarLogin(ref: string, site: string) {
  passo("Supabase: configurando o login");
  const modelo = (arq: string) => readFileSync(join(RAIZ, "supabase", "templates", arq), "utf8");
  const essenciais = {
    site_url: site,
    uri_allow_list: `${site}/**`,
    disable_signup: true, // ninguém cria conta sozinho: só por convite do escritório
    external_email_enabled: true,
    external_anonymous_users_enabled: false,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    mailer_otp_exp: 86400,
    password_min_length: 10,
    password_required_characters: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    jwt_exp: 3600,
  };
  await sb(`/projects/${ref}/config/auth`, { method: "PATCH", body: JSON.stringify(essenciais) });
  ok("Cadastro público desligado, senha mínima de 10 caracteres, 2FA habilitado, endereços do site permitidos.");
  try {
    await sb(`/projects/${ref}/config/auth`, {
      method: "PATCH",
      body: JSON.stringify({
        mailer_subjects_invite: "Convite para o Portal Guarese's ON",
        mailer_templates_invite_content: modelo("convite.html"),
        mailer_subjects_recovery: "Redefinição de senha — Portal Guarese's ON",
        mailer_templates_recovery_content: modelo("recuperacao.html"),
        mailer_subjects_magic_link: "Seu link de acesso — Portal Guarese's ON",
        mailer_templates_magic_link_content: modelo("link_acesso.html"),
        mailer_subjects_email_change: "Confirme seu novo e-mail — Portal Guarese's ON",
        mailer_templates_email_change_content: modelo("alteracao_email.html"),
        mailer_subjects_confirmation: "Confirme seu e-mail — Portal Guarese's ON",
        mailer_templates_confirmation_content: modelo("confirmacao.html"),
      }),
    });
    ok("Modelos de e-mail em português aplicados.");
  } catch (e) {
    aviso(`Modelos de e-mail não aplicados (${(e as Error).message.slice(0, 160)}). O portal funciona; ajuste depois em Authentication → Emails.`);
  }
  try {
    await sb(`/projects/${ref}/config/auth`, { method: "PATCH", body: JSON.stringify({ sessions_timebox: 86400, sessions_inactivity_timeout: 28800 }) });
    ok("Limite de sessão (24 h) e de inatividade (8 h) aplicados.");
  } catch {
    aviso("Limites de duração de sessão são recurso de planos pagos do Supabase — mantidos os padrões no plano gratuito.");
  }
}

async function agendarRotinas(ref: string, site: string, segredoCron: string) {
  passo("Supabase: agendando as rotinas automáticas");
  await sql(ref, "create extension if not exists pg_cron with schema pg_catalog; create extension if not exists pg_net with schema extensions;");
  await sql(
    ref,
    `do $$
     begin
       if exists (select 1 from vault.secrets where name = 'portal_cron_secret') then
         perform vault.update_secret((select id from vault.secrets where name = 'portal_cron_secret'), ${literal(segredoCron)});
       else
         perform vault.create_secret(${literal(segredoCron)}, 'portal_cron_secret', 'Segredo das rotas /api/cron do portal');
       end if;
     end $$;`,
  );
  const chamada = (rota: string) =>
    `select net.http_post(url := ${literal(`${site}${rota}`)}, headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'portal_cron_secret')), timeout_milliseconds := 60000);`;
  await sql(ref, `select cron.schedule('portal-fila', '*/5 * * * *', ${literal(chamada("/api/cron/processar"))});`);
  // 09:05 UTC = 06:05 em Brasília
  await sql(ref, `select cron.schedule('portal-rotina-diaria', '5 9 * * *', ${literal(chamada("/api/cron/diario"))});`);
  ok("Fila de tarefas a cada 5 minutos e rotina diária às 6h05 (Brasília).");
}

// ------------------------------------------------------------------- Vercel
async function projetoVercel() {
  passo("Vercel: projeto do site");
  const eu = await vc<{ user: { id: string; username: string; defaultTeamId?: string | null } }>("/v2/user");
  equipeVercel = eu.user.defaultTeamId ?? null;
  let projeto: { id: string; name: string } | null = null;
  try {
    projeto = await vc<{ id: string; name: string }>(`/v9/projects/${encodeURIComponent(NOME)}`);
    ok(`Projeto já existe: ${projeto.name}`);
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  if (!projeto) {
    projeto = await vc<{ id: string; name: string }>("/v11/projects", { method: "POST", body: JSON.stringify({ name: NOME, framework: "nextjs" }) });
    ok(`Projeto criado: ${projeto.name}`);
  }
  return { projeto, usuario: eu.user };
}

async function definirVariaveis(projetoId: string, vars: Record<string, { valor: string; segredo?: boolean }>) {
  passo("Vercel: variáveis de ambiente");
  const existentes = await vc<{ envs: { id: string; key: string }[] }>(`/v10/projects/${projetoId}/env`);
  for (const [chave, { valor, segredo }] of Object.entries(vars)) {
    for (const e of existentes.envs.filter((x) => x.key === chave)) await vc(`/v9/projects/${projetoId}/env/${e.id}`, { method: "DELETE" });
    await vc(`/v10/projects/${projetoId}/env`, {
      method: "POST",
      body: JSON.stringify({ key: chave, value: valor, type: segredo ? "sensitive" : "plain", target: ["production", "preview"] }),
    });
    ok(`${chave}${segredo ? " (protegida)" : ""}`);
  }
}

function publicarVercel(projetoId: string, orgId: string): string {
  passo("Vercel: publicando o site (compilação na nuvem, alguns minutos)");
  mkdirSync(join(RAIZ, ".vercel"), { recursive: true });
  writeFileSync(join(RAIZ, ".vercel", "project.json"), JSON.stringify({ projectId: projetoId, orgId }));
  const saida = execFileSync("npx", ["--yes", "vercel@latest", "deploy", "--prod", "--yes", `--token=${tokenVercel}`], {
    cwd: RAIZ,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 50 * 1024 * 1024,
  });
  const url = saida.trim().split(/\s+/).reverse().find((t) => /^https:\/\/\S+\.vercel\.app/.test(t));
  if (!url) throw new Error(`Não foi possível identificar o endereço publicado. Saída: ${saida.slice(-500)}`);
  ok(`Publicado: ${url}`);
  return url;
}

async function adicionarDominio(projetoId: string, dominio: string) {
  passo(`Vercel: domínio próprio ${dominio}`);
  try {
    await vc(`/v10/projects/${projetoId}/domains`, { method: "POST", body: JSON.stringify({ name: dominio }) });
    ok("Domínio adicionado ao projeto.");
  } catch (e) {
    if ((e as { status?: number }).status === 409) ok("Domínio já estava no projeto.");
    else throw e;
  }
  try {
    const cfg = await vc<{ misconfigured?: boolean }>(`/v6/domains/${encodeURIComponent(dominio)}/config`);
    if (cfg.misconfigured) {
      aviso(`O DNS de ${dominio} ainda não aponta para a Vercel. No Registro.br (ou onde o domínio foi registrado), crie um registro CNAME para "cname.vercel-dns.com" (ou A para 76.76.21.21 no domínio raiz). Pode levar algumas horas.`);
    } else ok("DNS configurado corretamente.");
  } catch {
    aviso("Não foi possível conferir o DNS agora; confira em Vercel → Project → Settings → Domains.");
  }
}

async function dominioProducao(projetoId: string, padrao: string) {
  if (DOMINIO) return `https://${DOMINIO}`;
  try {
    const d = await vc<{ domains: { name: string }[] }>(`/v9/projects/${projetoId}/domains`);
    const nome = d.domains.map((x) => x.name).find((n) => n.endsWith(".vercel.app")) ?? d.domains[0]?.name;
    return nome ? `https://${nome}` : padrao;
  } catch {
    return padrao;
  }
}

// ------------------------------------------------------------------- execução
async function main() {
  if (!tokenSupabase || !tokenVercel) {
    console.error("Faltam SUPABASE_ACCESS_TOKEN e/ou VERCEL_TOKEN nas variáveis de ambiente.");
    process.exit(1);
  }
  const estadoArq = join(RAIZ, PRODUCAO ? ".publicacao-producao.json" : ".publicacao.json");
  const estado = existsSync(estadoArq) ? (JSON.parse(readFileSync(estadoArq, "utf8")) as Record<string, string>) : {};

  const { ref } = await projetoSupabase();
  await aguardarProjeto(ref);
  await aplicarMigracoes(ref);
  const chaves = await chavesSupabase(ref);
  ok(`Endereço do Supabase: ${chaves.url}`);

  const { projeto, usuario } = await projetoVercel();
  if (DOMINIO) await adicionarDominio(projeto.id, DOMINIO);
  const siteInicial = DOMINIO ? `https://${DOMINIO}` : (estado.site ?? `https://${NOME}.vercel.app`);
  const segredoCron = estado.segredoCron ?? randomBytes(32).toString("hex");
  const variaveis = (site: string) => ({
    NEXT_PUBLIC_SUPABASE_URL: { valor: chaves.url },
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: { valor: chaves.publica },
    SUPABASE_SECRET_KEY: { valor: chaves.secreta, segredo: true },
    NEXT_PUBLIC_SITE_URL: { valor: site },
    NEXT_PUBLIC_AMBIENTE: { valor: PRODUCAO ? "producao" : "demonstracao" },
    CRON_SECRET: { valor: segredoCron, segredo: true },
    OCR_ATIVO: { valor: "true" },
  });
  await definirVariaveis(projeto.id, variaveis(siteInicial));
  await configurarLogin(ref, siteInicial);
  publicarVercel(projeto.id, equipeVercel ?? usuario.id);
  let site = await dominioProducao(projeto.id, siteInicial);
  if (site !== siteInicial) {
    aviso(`O endereço definitivo é ${site}. Atualizando configurações e publicando novamente...`);
    await definirVariaveis(projeto.id, variaveis(site));
    await configurarLogin(ref, site);
    publicarVercel(projeto.id, equipeVercel ?? usuario.id);
    site = await dominioProducao(projeto.id, site);
  }
  await agendarRotinas(ref, site, segredoCron);

  let senhaDemo: string | null = null;
  let linkAdmin: string | null = null;
  const ambienteScripts = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: chaves.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: chaves.publica,
    SUPABASE_SECRET_KEY: chaves.secreta,
    NEXT_PUBLIC_SITE_URL: site,
    NEXT_PUBLIC_AMBIENTE: PRODUCAO ? "producao" : "demonstracao",
  };
  if (PRODUCAO) {
    passo("Primeiro administrador do escritório");
    const saida = execFileSync("npx", ["tsx", "scripts/criar-admin.ts", "--email", ADMIN_EMAIL, "--nome", ADMIN_NOME], {
      cwd: RAIZ,
      encoding: "utf8",
      env: ambienteScripts,
    });
    linkAdmin = /https:\/\/\S+\/auth\/confirm\S+/.exec(saida)?.[0] ?? null;
    ok(linkAdmin ? `Administrador ${ADMIN_EMAIL} convidado.` : saida.trim());
  } else {
    passo("Dados fictícios de demonstração");
    senhaDemo = argumento("senha-demo", "") || process.env.DEMO_SENHA || estado.senhaDemo || null;
    const [{ n: usuariosDemo }] = await sql<{ n: number }[]>(ref, "select count(*)::int as n from public.perfis where email like '%@demo.guareses.test'");
    if (senhaDemo) {
      execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/seed-demo.ts", "--confirmar", "--senha", senhaDemo], { cwd: RAIZ, stdio: "inherit", env: ambienteScripts });
    } else if (usuariosDemo > 0) {
      // Usuários de demonstração já existem: as senhas atuais são mantidas.
      execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/seed-demo.ts", "--confirmar", "--manter-senhas"], { cwd: RAIZ, stdio: "inherit", env: ambienteScripts });
      ok("Senhas dos usuários de demonstração mantidas (as mesmas informadas na publicação anterior).");
    } else {
      senhaDemo = `Demo-${randomBytes(5).toString("base64url")}9!`;
      execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/seed-demo.ts", "--confirmar", "--senha", senhaDemo], { cwd: RAIZ, stdio: "inherit", env: ambienteScripts });
    }
  }

  passo("Verificação do site");
  const saude = await fetch(`${site}/api/saude`).then((r) => r.json()).catch(() => null);
  if (saude?.ok) ok("Site no ar e conectado ao banco de dados.");
  else aviso(`Verificação de saúde não respondeu como esperado: ${JSON.stringify(saude)}`);

  writeFileSync(
    estadoArq,
    JSON.stringify({ site, supabaseRef: ref, segredoCron, ...(senhaDemo ? { senhaDemo } : {}), ambiente: PRODUCAO ? "producao" : "demonstracao", publicadoEm: new Date().toISOString() }, null, 2),
  );
  console.log(`\n=====================================================================`);
  if (PRODUCAO) {
    console.log(` Portal publicado (PRODUÇÃO — dados reais): ${site}`);
    console.log(` Supabase: projeto ${ref} (região São Paulo)`);
    if (linkAdmin) console.log(` Link para o administrador definir a senha (uso único, vale 24 h):\n ${linkAdmin}`);
    console.log(` Próximos passos: ative a verificação em duas etapas, configure o e-mail (SMTP) e cadastre as empresas.`);
  } else {
    console.log(` Portal publicado (DEMONSTRAÇÃO, dados fictícios): ${site}`);
    console.log(` Supabase: projeto ${ref} (região São Paulo, plano gratuito)`);
    console.log(` Usuários de teste: admin@, contador@, cliente@, cliente2@, colaborador@ demo.guareses.test`);
    console.log(senhaDemo ? ` Senha de teste: ${senhaDemo}` : " Senha de teste: a mesma da publicação anterior (mantida).");
  }
  console.log(`=====================================================================\n`);
}

main().catch((e) => {
  console.error(`\n✖ Falha na publicação: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
