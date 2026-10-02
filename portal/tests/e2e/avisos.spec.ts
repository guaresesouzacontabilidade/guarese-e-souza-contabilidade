import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * Avisos: o escritório vê na hora (sem recarregar) o arquivo enviado pelo
 * cliente; cada pessoa escolhe suas preferências e ativa os avisos no aparelho.
 * Usa os usuários fictícios criados por `npm run seed:demo`.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

test("escritório é avisado na hora quando o cliente envia um arquivo", async ({ page, browser }) => {
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio");

  const contextoCliente = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const cliente = await contextoCliente.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = cliente.url().match(/\/e\/[0-9a-f-]{36}/)![0];
  await cliente.goto(`${empresa}/enviar`);

  // Conteúdo único (o portal recusa arquivos idênticos já enviados).
  const pasta = mkdtempSync(join(tmpdir(), "avisos-"));
  const arquivo = join(pasta, `extrato-${Date.now()}.csv`);
  writeFileSync(arquivo, readFileSync("tests/fixtures/extrato-banco.csv", "utf8") + `\n# ${Date.now()}\n`);
  await cliente.setInputFiles('input[aria-label="Escolher arquivos"]', arquivo);
  await cliente.getByRole("button", { name: /Enviar \d+ arquivo/ }).click();

  const aviso = page.locator("[data-sonner-toast]").filter({ hasText: "Padaria" });
  await expect(aviso).toBeVisible({ timeout: 60_000 });
  await expect(aviso).toContainText(/Novo arquivo de Padaria|Padaria .* enviou \d+ arquivos/);
  await contextoCliente.close();
});

test("preferências de aviso e ativação dos avisos no aparelho", async ({ browser }) => {
  const contexto = await browser.newContext({ baseURL: BASE, locale: "pt-BR", permissions: ["notifications"] });
  // Nos testes não há serviço de notificação real: a inscrição do navegador é simulada.
  await contexto.addInitScript(() => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/teste-e2e";
    const chaves = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
    const criar = () => ({
      endpoint,
      options: { applicationServerKey: null, userVisibleOnly: true },
      toJSON: () => ({ endpoint, keys: chaves }),
      unsubscribe: async () => {
        localStorage.removeItem("teste-push");
        return true;
      },
    });
    PushManager.prototype.subscribe = async function () {
      localStorage.setItem("teste-push", "1");
      return criar() as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async function () {
      return (localStorage.getItem("teste-push") ? criar() : null) as unknown as PushSubscription | null;
    };
  });
  const page = await contexto.newPage();
  await entrar(page, `admin@${DOMINIO}`);
  await page.goto("/conta#avisos");
  const cartao = page.locator("#avisos");

  // Espera a verificação do aparelho terminar antes de decidir.
  await expect(cartao.getByRole("button", { name: /Ativar neste aparelho|Enviar aviso de teste/ })).toBeVisible({ timeout: 30_000 });
  const ativar = cartao.getByRole("button", { name: "Ativar neste aparelho" });
  if (await ativar.count()) {
    await ativar.click();
    await expect(page.getByText("Pronto! Este aparelho vai receber")).toBeVisible({ timeout: 30_000 });
  }
  await expect(cartao.getByText("este aparelho", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(cartao.getByRole("button", { name: "Enviar aviso de teste" })).toBeVisible();

  // Preferência por pessoa (e volta ao padrão)
  await page.selectOption("#pref-arquivos", "responsavel");
  await cartao.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Preferências salvas")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator("#pref-arquivos")).toHaveValue("responsavel");
  await page.selectOption("#pref-arquivos", "todas");
  await page.locator("#avisos").getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Preferências salvas").first()).toBeVisible({ timeout: 30_000 });

  // Desativar remove o aparelho da lista
  await page.locator("#avisos").getByRole("button", { name: "Desativar neste aparelho" }).click();
  await expect(page.locator("#avisos").getByRole("button", { name: "Ativar neste aparelho" })).toBeVisible({ timeout: 30_000 });
  await contexto.close();
});
