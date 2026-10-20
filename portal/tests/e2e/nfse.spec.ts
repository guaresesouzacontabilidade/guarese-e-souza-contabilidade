import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Emissão de NFS-e pelo portal (dados fictícios da demonstração, Oficina):
 *  - a equipe vê a emissão desligada (sem certificado), cadastra um serviço e
 *    não consegue ligar a emissão sem o certificado;
 *  - o empresário vê a emissão desconectada e não configura nada;
 *  - com a emissão ligada (certificado fictício gravado pelo teste), o
 *    empresário pede a nota pela tela; neste ambiente nenhuma consulta fiscal
 *    sai (NOTAS_AUTOMATICAS_SEM_REDE), então a nota fica "Sem resposta" com o
 *    aviso de que nada foi enviado ao Emissor Nacional — nada é simulado.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const OFICINA = "44555666000181";

function clienteServico(): SupabaseClient | null {
  if (existsSync(".env.local")) {
    for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const chave = process.env.SUPABASE_SECRET_KEY ?? "";
  return url && chave ? createClient(url, chave, { auth: { persistSession: false } }) : null;
}

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.skip(process.env.NOTAS_AUTOMATICAS_SEM_REDE !== "1", "Só roda com as consultas fiscais desligadas neste ambiente.");

let empresaId = "";

async function limpar() {
  if (!empresaId) return;
  await servico!.from("nfse_emissoes").delete().eq("empresa_id", empresaId);
  await servico!.from("nfse_servicos").delete().eq("empresa_id", empresaId).like("nome", "%(E2E)%");
  await servico!.from("nfse_emissao_config").update({ ativa: false }).eq("empresa_id", empresaId);
  await servico!.from("certificados_digitais").delete().eq("empresa_id", empresaId).eq("titular", "CERTIFICADO FICTICIO (E2E)");
  await servico!.from("jobs").delete().eq("empresa_id", empresaId).in("tipo", ["emitir_nfse", "cancelar_nfse"]);
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("documento", OFICINA).single();
  empresaId = data!.id;
  await limpar();
});
test.afterAll(limpar);

test("equipe: emissão desligada sem certificado, cadastro de serviço e bloqueio ao ligar", async ({ page }) => {
  test.setTimeout(300_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-servico`);
  await expect(page.getByRole("heading", { name: "Notas de serviço", level: 1 })).toBeVisible();
  await expect(page.getByText("Emissão desconectada")).toBeVisible();
  await expect(page.getByRole("link", { name: "Emitir nota", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: /Configurar emissão/ }).first().click();
  await page.waitForURL(/\/notas-servico\/configuracao/);
  await expect(page.getByText("Sem certificado digital válido")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Revisão e manutenção de veículos", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Novo serviço" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#sv-nome").fill("Consultoria automotiva (E2E)");
  await dialogo.locator("#sv-nacional").fill("17.01.01");
  await dialogo.getByRole("button", { name: "Cadastrar serviço" }).click();
  await expect(page.getByText("Serviço cadastrado.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: "Consultoria automotiva (E2E)", exact: true })).toBeVisible();

  await page.getByLabel(/Emissão ligada/).check();
  await page.fill("#autorizacao_texto", "Autorização fictícia do teste automático (E2E).");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByText(/Cadastre o certificado digital A1 da empresa/)).toBeVisible({ timeout: 30_000 });
  const { data: cfg } = await servico!.from("nfse_emissao_config").select("ativa").eq("empresa_id", empresaId).single();
  expect(cfg!.ativa).toBe(false);
});

test("empresário: emissão desconectada sem configurar; com a emissão ligada pede a nota e vê que nada saiu deste ambiente", async ({ page }) => {
  test.setTimeout(300_000);
  await entrar(page, `cliente2@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-servico`);
  await expect(page.getByText("Emissão desconectada")).toBeVisible();
  await expect(page.getByText(/O escritório ainda não ligou a emissão/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Configurar emissão/ })).toHaveCount(0);
  await page.goto(`/e/${empresaId}/notas-servico/configuracao`);
  await expect(page.getByText("Somente a equipe do escritório configura a emissão de notas.")).toBeVisible();

  // Liga a emissão pelo banco com um certificado FICTÍCIO (o teste não tem certificado real)
  await servico!.from("certificados_digitais").insert({
    empresa_id: empresaId,
    titular: "CERTIFICADO FICTICIO (E2E)",
    documento: OFICINA,
    impressao_digital: "C".repeat(64),
    valido_de: new Date(Date.now() - 86_400_000).toISOString(),
    valido_ate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autorizacao: "autorizacao_escrita",
    autorizacao_texto: "Teste automático (E2E).",
  });
  await servico!
    .from("nfse_emissao_config")
    .update({ ativa: true, autorizacao_texto: "Teste automático (E2E).", autorizado_em: new Date().toISOString() })
    .eq("empresa_id", empresaId);

  await page.goto(`/e/${empresaId}/notas-servico`);
  await expect(page.getByText("Emissão em teste")).toBeVisible();
  await page.getByRole("link", { name: "Emitir nota", exact: true }).click();
  await page.waitForURL(/\/notas-servico\/nova/);
  await page.selectOption("#servico_id", { label: "Revisão e manutenção de veículos (140101)" });
  await page.getByLabel("Pessoa física (CPF)").check();
  await page.fill("#tomador_documento", "529.982.247-25");
  await page.fill("#tomador_nome", "Fulano de Tal (fictício)");
  await page.fill("#valor", "350,00");
  await page.fill("#descricao", "Troca de óleo e revisão (teste automático E2E)");
  await page.getByRole("button", { name: "Emitir nota" }).click();
  const confirmacao = page.getByRole("dialog");
  await expect(confirmacao.getByText("Teste — nota sem validade jurídica")).toBeVisible();
  await expect(confirmacao.getByText("R$ 350,00")).toBeVisible();
  await confirmacao.getByRole("button", { name: "Emitir agora" }).click();

  await page.waitForURL(/\/notas-servico\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText(/nada foi enviado ao Emissor Nacional/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Sem resposta").first()).toBeVisible();
  const { data: notas } = await servico!.from("nfse_emissoes").select("situacao, chave_acesso, valor").eq("empresa_id", empresaId);
  expect(notas).toEqual([expect.objectContaining({ situacao: "falha", chave_acesso: null, valor: 350 })]);
});

test("colaborador sem a permissão não vê a emissão", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `colaborador@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await expect(page.getByRole("link", { name: "Emitir nota fiscal" })).toHaveCount(0);
  const padaria = page.url().match(/\/e\/([0-9a-f-]{36})/)![1];
  await page.goto(`/e/${padaria}/notas-servico`);
  await expect(page.getByText("Seu acesso não inclui a emissão de notas desta empresa.")).toBeVisible();
});
