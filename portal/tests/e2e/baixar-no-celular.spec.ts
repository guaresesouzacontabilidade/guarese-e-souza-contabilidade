import { test, expect, devices, type Browser, type Page } from "@playwright/test";

/**
 * Baixar no celular: o link de um arquivo do portal (/api/...) não leva a outra
 * tela — o arquivo é preparado pela própria página. Android: vai para
 * Downloads. iPhone: abre a folha de compartilhar (Salvar em Arquivos,
 * WhatsApp...). Em ambos o portal continua na mesma tela, sem precisar
 * "voltar"; se o arquivo não vier, aparece o aviso e a tela também fica.
 *
 * Aqui o arquivo é o "Baixar meus dados" da conta (sai do próprio portal). Os
 * documentos guardados no armazenamento passam pelo mesmo caminho; neste
 * ambiente local o armazenamento é http e a política de segurança da página
 * exige https, por isso eles só são conferidos com o armazenamento em https.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";
const NOME_MEUS_DADOS = "meus-dados-portal-guareses-on.json";

async function entrar(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', `cliente@${DOMINIO}`);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

async function abrirConta(browser: Browser, aparelho: keyof typeof devices, preparar?: (p: Page) => Promise<void>) {
  const ctx = await browser.newContext({ ...devices[aparelho], baseURL: BASE, locale: "pt-BR", acceptDownloads: true });
  const page = await ctx.newPage();
  if (preparar) await preparar(page);
  await entrar(page);
  await page.goto("/conta");
  await expect(page.getByRole("link", { name: /Baixar meus dados/ })).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches)).toBe(true);
  return { ctx, page };
}

test("Android: o arquivo vai para os Downloads e o portal fica na mesma tela", async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await abrirConta(browser, "Pixel 7");
  const antes = page.url();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Baixar meus dados/ }).click()]);
  expect(download.suggestedFilename()).toBe(NOME_MEUS_DADOS);
  await expect(page.getByText(`Arquivo baixado: ${NOME_MEUS_DADOS}`)).toBeVisible();
  expect(page.url()).toBe(antes);
  await ctx.close();
});

test("iPhone: o arquivo abre a folha de compartilhar e o portal fica na mesma tela", async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await abrirConta(browser, "iPhone 13", async (p) => {
    // Folha de compartilhar do iPhone simulada: guarda o que foi compartilhado
    await p.addInitScript(() => {
      const w = window as unknown as { __compartilhados: string[] };
      w.__compartilhados = [];
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
      Object.defineProperty(navigator, "share", {
        value: async (d: { files?: File[] }) => {
          w.__compartilhados.push(...(d.files ?? []).map((f) => `${f.name}|${f.size}`));
        },
        configurable: true,
      });
    });
  });
  const antes = page.url();
  await page.getByRole("link", { name: /Baixar meus dados/ }).click();
  const dialogo = page.getByRole("dialog", { name: "Arquivo pronto" });
  await expect(dialogo).toBeVisible({ timeout: 30_000 });
  await expect(dialogo.getByText(NOME_MEUS_DADOS)).toBeVisible();
  await dialogo.getByRole("button", { name: "Salvar ou compartilhar" }).click();
  await expect(dialogo).toBeHidden();
  const compartilhados = await page.evaluate(() => (window as unknown as { __compartilhados: string[] }).__compartilhados);
  expect(compartilhados).toHaveLength(1);
  const [nome, tamanho] = compartilhados[0].split("|");
  expect(nome).toBe(NOME_MEUS_DADOS);
  expect(Number(tamanho)).toBeGreaterThan(0);
  expect(page.url()).toBe(antes);
  await ctx.close();
});

test("celular: arquivo que não vem mostra o aviso e o portal fica na mesma tela", async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await abrirConta(browser, "Pixel 7");
  const antes = page.url();
  // Nota que não existe (como um link antigo): o servidor responde com o motivo
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "/api/nfse/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000001?formato=pdf";
    a.id = "link-quebrado";
    a.textContent = "nota";
    a.style.cssText = "position:fixed;left:20px;bottom:90px;z-index:99999;background:#fff;padding:8px";
    document.body.appendChild(a);
  });
  await page.click("#link-quebrado");
  await expect(page.getByText("Acesso negado.")).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toBe(antes);
  await ctx.close();
});
