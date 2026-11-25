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
