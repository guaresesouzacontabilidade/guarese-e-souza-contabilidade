import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * GTA no SIDAGO (dados fictícios da demonstração):
 *  - a equipe guarda o acesso do produtor ao SIDAGO (só o login mascarado volta à tela);
 *  - prepara o pedido de GTA com o destino, os animais por sexo e idade (o total
 *    soma sozinho) e o transporte;
 *  - fora do portal oficial o robô não acessa o SIDAGO e diz isso (nada é simulado);
 *  - a GTA emitida no SIDAGO é anotada e o pedido não muda mais.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const FAZENDA = "PRODUTOR RURAL EXEMPLO (DEMONSTRAÇÃO)";

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

let empresaId = "";
async function limpar() {
  if (!empresaId) return;
  await servico!.from("gta_pedidos").delete().eq("empresa_id", empresaId);
  await servico!.from("gta_sidago_acesso").delete().eq("empresa_id", empresaId);
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", FAZENDA).single();
  empresaId = data!.id;
  await limpar();
});
test.afterAll(limpar);

test("equipe guarda o acesso ao SIDAGO, prepara a GTA e anota a emitida", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-produto/gta`);
  await expect(page.getByRole("heading", { name: "GTA no SIDAGO (Goiás)" })).toBeVisible();
  await expect(page.getByText("o robô não acessa o SIDAGO")).toBeVisible();

  // Acesso: sem a autorização não guarda; com ela, só o login mascarado aparece
  await page.fill("#sidago-login", "042.082.851-68");
  await page.fill("#sidago-senha", "SenhaFicticia#1");
  await page.getByRole("button", { name: "Guardar acesso" }).click();
  await expect(page.getByText("Confirme a autorização do produtor.")).toBeVisible();
  await page.getByLabel(/O produtor autorizou o escritório/).check();
  await page.getByRole("button", { name: "Guardar acesso" }).click();
  await expect(page.getByText("042•••••168")).toBeVisible();
  await expect(page.getByText("Ainda não testado")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SenhaFicticia");

  // Pedido de GTA: destino, animais por sexo e idade (total soma sozinho), transporte
  await page.getByRole("button", { name: "Novo pedido de GTA" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#gta-destino").fill("FRIGORÍFICO EXEMPLO LTDA (DEMONSTRAÇÃO)");
  await dialogo.locator("#gta-destino-doc").fill("11.222.333/0001-81");
  await dialogo.getByLabel("Machos de 25 a 36 meses").fill("10");
  await dialogo.getByLabel("Fêmeas acima de 36 meses").fill("4");
  await expect(dialogo.getByText("Total: 14 animais")).toBeVisible();
  await dialogo.locator("#gta-placa").fill("abc1d23");
  await dialogo.locator("#gta-placa-uf").selectOption("GO");
  await dialogo.getByRole("button", { name: "Salvar pedido de GTA" }).click();
  await expect(dialogo).toBeHidden();
  const pedido = page.getByTestId("pedido-gta").first();
  await expect(pedido).toContainText("FRIGORÍFICO EXEMPLO LTDA (DEMONSTRAÇÃO)");
  await expect(pedido).toContainText("Rascunho");
  await expect(pedido).toContainText("14 bovinos");
  await expect(pedido).toContainText("placa ABC1D23/GO");

  // Fora do portal oficial o robô não entra no SIDAGO (e não finge que entrou)
  await pedido.getByRole("button", { name: "Conferir no SIDAGO" }).click();
  await expect(page.getByText(/só acessa o SIDAGO no portal oficial/)).toBeVisible();
  await expect(pedido).toContainText("Ainda não conferido");

  // GTA emitida no SIDAGO: anotada, e o pedido não muda mais
  await pedido.getByRole("button", { name: "Anotar GTA emitida" }).click();
  const anotar = page.getByRole("dialog");
  await anotar.getByLabel("Número da GTA").fill("123.456");
  await anotar.getByLabel("Série").fill("a");
  await anotar.getByRole("button", { name: "Anotar" }).click();
  await expect(pedido).toContainText("GTA emitida");
  await expect(pedido).toContainText("GTA nº 123456 série A");
  await expect(pedido.getByRole("button", { name: "Editar" })).toHaveCount(0);
});
