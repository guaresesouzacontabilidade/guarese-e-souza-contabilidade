import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Suporte 24h (botão Ajuda), com o assistente de IA desligado (o normal até o
 * escritório ligar): a resposta vem da busca no guia, com os atalhos das telas
 * que a pessoa pode abrir, e "falar com o escritório" abre a solicitação já
 * com a dúvida escrita.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

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

test("cliente pergunta ao suporte, vai direto para a tela e manda a dúvida ao escritório", async ({ page }) => {
  test.setTimeout(180_000);
  // Só letras (números entrariam na busca do guia)
  const marca = `zq${Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;
  await servico!.from("escritorio_ia").update({ suporte_ativo: false }).eq("id", 1);
  const { data: emp } = await servico!.from("empresas").select("id").eq("razao_social", "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)").single();
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${emp!.id}/os`);

  await page.getByTestId("botao-suporte").click();
  const painel = page.getByTestId("painel-suporte");
  await expect(painel).toBeVisible();
  await expect(painel.getByText("Busca no guia")).toBeVisible();
  // Sugestões da tela das OS
  await expect(painel.getByRole("button", { name: "Como abro uma ordem de serviço?" })).toBeVisible();

  await painel.getByLabel("Sua dúvida").fill("como eu pauso uma OS por falta de material?");
  await painel.getByRole("button", { name: "Enviar dúvida" }).click();
  const resposta = painel.getByTestId("resposta-suporte").last();
  await expect(resposta).toContainText("Encontrei isto no guia do portal");
  await expect(resposta).toContainText("Pausar");
  await expect(resposta.getByRole("link", { name: /Ir para: Esteira de serviços/ })).toBeVisible();
  // "Isso ajudou?"
  await resposta.getByRole("button", { name: "Sim, ajudou" }).click();
  await expect(resposta.getByTestId("avaliado-suporte")).toContainText("Que bom que ajudou");

  // Pergunta do dia a dia ("boleto") leva à agenda de pagamentos
  await painel.getByLabel("Sua dúvida").fill("onde pago os boletos?");
  await painel.getByLabel("Sua dúvida").press("Enter");
  const boleto = painel.getByTestId("resposta-suporte").last();
  await expect(boleto.getByRole("link", { name: /Ir para: Agenda de pagamentos/ })).toBeVisible();
  await boleto.getByRole("link", { name: /Ir para: Agenda de pagamentos/ }).click();
  await page.waitForURL(/\/agenda/);
  await expect(painel).toBeHidden();

  // Sem resposta no guia: mandar a dúvida ao escritório (solicitação já escrita)
  await page.getByTestId("botao-suporte").click();
  await expect(painel.getByTestId("resposta-suporte")).toHaveCount(2); // a conversa continua na aba
  await painel.getByLabel("Sua dúvida").fill(`xyzw qwerty asdfgh ${marca} 88877766655`);
  await painel.getByRole("button", { name: "Enviar dúvida" }).click();
  const sem = painel.getByTestId("resposta-suporte").last();
  await expect(sem).toContainText("Não encontrei isso no guia");
  await expect(sem).toContainText("Guardamos esta dúvida");
  await sem.getByRole("link", { name: "Mandar esta dúvida ao escritório" }).click();
  await page.waitForURL(/\/solicitacoes\/nova/);
  await expect(page.locator("#sol-titulo")).toHaveValue(`xyzw qwerty asdfgh ${marca} 88877766655`);

  // O escritório vê a dúvida sem resposta (com o CPF mascarado) e marca como tratada
  const { data: reg } = await servico!.from("suporte_perguntas").select("pergunta, achou, util").like("pergunta", `%${marca}%`).single();
  expect(reg!.pergunta).toBe(`xyzw qwerty asdfgh ${marca} •••`);
  const { count: uteis } = await servico!.from("suporte_perguntas").select("id", { count: "exact", head: true }).eq("util", true);
  expect(uteis).toBeGreaterThan(0);
  await page.context().clearCookies();
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio/suporte");
  await expect(page.getByTestId("suporte-indicadores")).toContainText("Perguntas");
  const duvida = page.getByTestId("duvida-suporte").filter({ hasText: marca });
  await expect(duvida).toContainText(`${marca} •••`);
  await expect(duvida).toContainText("Sem resposta no guia");
  await duvida.getByRole("button", { name: "Tratada" }).click();
  await expect(page.getByTestId("duvida-suporte").filter({ hasText: marca })).toHaveCount(0);
  await servico!.from("suporte_perguntas").delete().like("pergunta", `%${marca}%`);
});

test("o botão de ajuda pode ser arrastado para outro lugar e fica lá depois de recarregar", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  const botao = page.getByTestId("botao-suporte");
  await expect(botao).toBeVisible();
  await expect(botao).toHaveAttribute("data-lado", "direita");
  const antes = (await botao.boundingBox())!;
  const tela = page.viewportSize()!;

  // Arrasta para a esquerda e um pouco para cima: gruda no lado esquerdo
  await page.mouse.move(antes.x + antes.width / 2, antes.y + antes.height / 2);
  await page.mouse.down();
  await page.mouse.move(120, antes.y - 150, { steps: 12 });
  await page.mouse.up();
  await expect(botao).toHaveAttribute("data-lado", "esquerda");
  await expect(page.getByTestId("painel-suporte")).toHaveCount(0); // arrastar não abre a ajuda
  const depois = (await botao.boundingBox())!;
  expect(depois.x).toBeLessThan(tela.width / 2);
  expect(depois.y).toBeLessThan(antes.y - 100);

  // Depois de recarregar, continua no mesmo lugar; o clique abre a ajuda
  await page.reload();
  await expect(botao).toHaveAttribute("data-lado", "esquerda");
  expect(Math.abs((await botao.boundingBox())!.y - depois.y)).toBeLessThan(4);
  await botao.click();
  const painel = page.getByTestId("painel-suporte");
  await expect(painel).toBeVisible();
  // A janela abre colada no botão, sem cobri-lo
  const p = (await painel.boundingBox())!;
  const b = (await botao.boundingBox())!;
  expect(p.y + p.height <= b.y || b.y + b.height <= p.y).toBe(true);
  expect(p.x).toBeLessThan(tela.width / 2);

  // Sem arrastar: os botões do painel mudam o lado e voltam ao lugar padrão
  await page.getByRole("button", { name: "passar para a direita" }).click();
  await expect(botao).toHaveAttribute("data-lado", "direita");
  await page.getByRole("button", { name: "lugar padrão" }).click();
  await expect(page.getByRole("button", { name: "lugar padrão" })).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar a ajuda" }).click();
  await expect(painel).toHaveCount(0);
  expect(Math.abs((await botao.boundingBox())!.y - antes.y)).toBeLessThan(4);
  expect(await page.evaluate(() => localStorage.getItem("suporte-posicao"))).toBeNull();
});

test.describe("no celular", () => {
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true });

  test("arrastar o botão com o dedo e depois tocar nele abre a ajuda", async ({ page, context }) => {
    await entrar(page, `cliente@${DOMINIO}`);
    await page.waitForLoadState("networkidle");
    const botao = page.getByTestId("botao-suporte");
    const a = (await botao.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x0 = a.x + a.width / 2;
    const y0 = a.y + a.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 15; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 - i * 20, y: y0 - i * 18 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(botao).toHaveAttribute("data-lado", "esquerda");
    await expect(page.getByTestId("painel-suporte")).toHaveCount(0);

    // O toque seguinte abre a ajuda (antes, o portal engolia esse toque)
    await botao.tap();
    await expect(page.getByTestId("painel-suporte")).toBeVisible();
    await page.getByRole("button", { name: "Fechar a ajuda" }).tap();
    await expect(page.getByTestId("painel-suporte")).toHaveCount(0);
  });
});
