import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Ordens de serviço (madeireira de demonstração, dados fictícios):
 *  - o balcão abre a OS escolhendo os serviços: o tempo soma sozinho e a
 *    previsão aparece;
 *  - a OS anda pela esteira com os botões (iniciar pede quem vai fazer, pausa
 *    pede o motivo, entrega pede quem retirou) e também arrastando o cartão;
 *  - o cliente acompanha pelo link do QR Code, sem login;
 *  - o dono vê o relatório; o balcão não;
 *  - sinal pelo caixa da Loja, bancada (iniciar, foto, pronta) e entrega com
 *    assinatura na tela.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";
const CLIENTE = "Cliente E2E Marcenaria (fictício)";

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
let caixaCriado: string | null = null;
async function limpar() {
  if (!empresaId) return;
  const { data: ordens } = await servico!.from("os_ordens").select("id, assinatura_caminho").eq("empresa_id", empresaId).like("cliente_nome", "%E2E%");
  const ids = (ordens ?? []).map((o) => o.id);
  if (ids.length) {
    const { data: fotos } = await servico!.from("os_fotos").select("caminho").in("ordem_id", ids);
    const arquivos = [...(fotos ?? []).map((f) => f.caminho), ...(ordens ?? []).map((o) => o.assinatura_caminho).filter((c): c is string => Boolean(c))];
    if (arquivos.length) await servico!.storage.from("os-fotos").remove(arquivos);
    const { data: lancs } = await servico!.from("lancamentos").select("id").eq("empresa_id", empresaId).eq("origem", "os").in("origem_referencia", ids);
    const idsLanc = (lancs ?? []).map((l) => l.id);
    if (idsLanc.length) {
      await servico!.from("baixas").delete().in("lancamento_id", idsLanc);
      await servico!.from("lancamentos").delete().in("id", idsLanc);
    }
  }
  await servico!.from("os_ordens").delete().eq("empresa_id", empresaId).like("cliente_nome", "%E2E%");
  if (caixaCriado) {
    await servico!.from("caixa_sessoes").delete().eq("id", caixaCriado);
    caixaCriado = null;
  }
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
  await limpar();
});
test.afterAll(limpar);

test("balcão abre a OS e ela anda pela esteira até a entrega; o cliente acompanha", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/os`);
  await expect(page.getByRole("heading", { name: "Ordens de serviço" })).toBeVisible();
  // O balcão opera a esteira, mas não vê o relatório nem o cadastro dos serviços
  await expect(page.getByRole("link", { name: "Relatório das OS" })).toHaveCount(0);

  // Abrir a OS: corte de 3 chapas = 5 min fixos + 4 × 3
  await page.getByRole("button", { name: "Nova OS" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#os-cliente").fill(CLIENTE);
  await dialogo.locator("#os-telefone").fill("(63) 99999-0000");
  const linha = dialogo.getByTestId("linha-servico").first();
  await linha.locator("select").selectOption({ label: "Corte de chapa (MDF/compensado) (4 min/chapa + 5 min)" });
  await linha.getByLabel("Quantidade (chapa)").fill("3");
  await expect(dialogo.getByTestId("os-total-tempo")).toHaveText("17 min");
  await expect(dialogo.getByTestId("os-previsao")).toContainText(/às \d{2}:\d{2}/);
  await dialogo.getByRole("button", { name: "Abrir OS" }).click();
  await expect(dialogo).toBeHidden();
  const fila = page.getByTestId("coluna-fila");
  const cartao = page.getByTestId("cartao-os").filter({ hasText: CLIENTE });
  await expect(fila.getByTestId("cartao-os").filter({ hasText: CLIENTE })).toBeVisible();

  // Iniciar pede quem vai fazer
  await cartao.getByRole("button", { name: "Iniciar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "João (seccionadora)" }).click();
  await expect(page.getByTestId("coluna-execucao").getByTestId("cartao-os").filter({ hasText: CLIENTE })).toBeVisible();
  await expect(cartao).toContainText("João (seccionadora)");

  // Pausa com motivo e retomada
  await cartao.getByRole("button", { name: "Pausar" }).click();
  const pausa = page.getByRole("dialog");
  await pausa.getByRole("button", { name: "Falta de material" }).click();
  await pausa.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(cartao).toContainText("Pausada");
  await expect(cartao).toContainText("Motivo: Falta de material");
  await cartao.getByRole("button", { name: "Retomar" }).click();
  await expect(cartao).not.toContainText("Pausada");

  // Pronta → entregue (quem retirou)
  await cartao.getByRole("button", { name: "Pronta" }).click();
  await expect(page.getByTestId("coluna-pronta").getByTestId("cartao-os").filter({ hasText: CLIENTE })).toBeVisible();
  await expect(cartao.getByRole("link", { name: "Avisar" })).toHaveAttribute("href", /wa\.me\/5563999990000/);
  await cartao.getByRole("button", { name: "Entregar" }).click();
  await page.getByRole("dialog").getByLabel("Quem retirou?").fill("Fulano (fictício)");
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(page.getByTestId("coluna-entregue").getByTestId("cartao-os").filter({ hasText: CLIENTE })).toBeVisible();

  // A tela já mostra a entrega antes da resposta do servidor: espera o banco confirmar
  const lerOs = async () =>
    (await servico!.from("os_ordens").select("codigo_publico, numero, etapa, retirado_por").eq("empresa_id", empresaId).eq("cliente_nome", CLIENTE).single()).data!;
  await expect.poll(async () => (await lerOs()).retirado_por, { timeout: 15_000 }).toBe("Fulano (fictício)");
  const os = await lerOs();
  expect(os.etapa).toBe("entregue");

  // O cliente acompanha pelo QR Code (sem login): só o primeiro nome, a etapa e os serviços
  const anonimo = await browser.newContext();
  const pub = await anonimo.newPage();
  await pub.goto(`/acompanhar/${os.codigo_publico}`);
  await expect(pub.getByText(`Ordem de serviço nº ${os.numero}`)).toBeVisible();
  await expect(pub.getByText("Olá, Cliente!")).toBeVisible();
  await expect(pub.getByText(/Entregue em/)).toBeVisible();
  await expect(pub.locator("body")).not.toContainText("99999-0000");
  await anonimo.close();

  // Arrastar o cartão também move a OS
  await page.getByRole("button", { name: "Nova OS" }).click();
  await page.getByRole("dialog").locator("#os-cliente").fill(`${CLIENTE} 2`);
  await page.getByRole("dialog").getByRole("button", { name: "Abrir OS" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const segundo = page.getByTestId("cartao-os").filter({ hasText: `${CLIENTE} 2` });
  await segundo.dragTo(page.getByTestId("coluna-pronta"));
  await expect(page.getByTestId("coluna-pronta").getByTestId("cartao-os").filter({ hasText: `${CLIENTE} 2` })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("coluna-pronta").getByTestId("cartao-os").filter({ hasText: `${CLIENTE} 2` })).toBeVisible();
});

test("dono vê o relatório com os tempos e a sugestão de estimativa", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/os/relatorio`);
  await expect(page.getByRole("heading", { name: "Relatório das ordens de serviço" })).toBeVisible();
  await expect(page.getByTestId("os-indicadores")).toContainText("Concluídas");
  await expect(page.getByText("Tempo médio de cada etapa")).toBeVisible();
  await expect(page.getByRole("button", { name: /Ajustar para 6 min\/chapa/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "João (seccionadora)" })).toBeVisible();
});

test("sinal pelo caixa, bancada com foto e entrega com assinatura na tela", async ({ page }) => {
  test.setTimeout(180_000);
  // O dono recebe pelo próprio caixa aberto
  const { data: dono } = await servico!.from("perfis").select("id").eq("email", `madeireira@${DOMINIO}`).single();
  const { data: cx } = await servico!.from("caixa_sessoes").select("id").eq("empresa_id", empresaId).eq("operador_id", dono!.id).eq("status", "aberto").maybeSingle();
  if (!cx) {
    const { data } = await servico!.from("caixa_sessoes").insert({ empresa_id: empresaId, caixa_nome: "Caixa E2E", operador_id: dono!.id, valor_abertura: 0 }).select("id").single();
    caixaCriado = data!.id;
  }
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/os`);
  await expect(page.getByTestId("fila-setores")).toContainText("Seccionadora");

  // Nova OS com sinal: 5 chapas (R$ 30), sinal de R$ 10 no PIX
  await page.getByRole("button", { name: "Nova OS" }).click();
  const nova = page.getByRole("dialog");
  await nova.locator("#os-cliente").fill(`${CLIENTE} 3`);
  await nova.locator("#os-telefone").fill("(63) 99999-0003");
  await nova.locator("#os-qtd-1").fill("5");
  await nova.getByLabel(/Receber um sinal/).check();
  await nova.getByRole("button", { name: "Abrir OS" }).click();
  const receber = page.getByRole("dialog", { name: /Receber — OS nº/ });
  await expect(receber).toBeVisible();
  await expect(receber.getByTestId("os-valores")).toContainText("R$ 30,00");
  await receber.locator("#os-receber-valor").fill("10,00");
  await receber.getByRole("button", { name: "Receber", exact: true }).click();
  await expect(receber).toBeHidden();
  const cartao = page.getByTestId("cartao-os").filter({ hasText: `${CLIENTE} 3` });
  await expect(cartao.getByTestId("cartao-pagamento")).toContainText("Falta R$ 20,00");
  const { data: os } = await servico!.from("os_ordens").select("id, valor_recebido").eq("empresa_id", empresaId).eq("cliente_nome", `${CLIENTE} 3`).single();
  expect(Number(os!.valor_recebido)).toBe(10);
  const { data: pg } = await servico!.from("os_pagamentos").select("forma, sinal, sessao_id").eq("ordem_id", os!.id).single();
  expect(pg).toMatchObject({ forma: "pix", sinal: true });
  expect(pg!.sessao_id).toBeTruthy();

  // Bancada (QR Code da OS impressa): iniciar, fotografar e marcar pronta
  await page.goto(`/e/${empresaId}/os/${os!.id}/bancada`);
  await page.getByRole("button", { name: "Iniciar" }).click();
  await page.getByRole("button", { name: "João (seccionadora)" }).click();
  await expect(page.getByRole("button", { name: "Pronta" })).toBeVisible();
  const foto = await page.screenshot({ type: "jpeg", quality: 60, clip: { x: 0, y: 0, width: 64, height: 64 } });
  await page.getByLabel("Escolher fotos da OS").setInputFiles({ name: "material.jpg", mimeType: "image/jpeg", buffer: foto });
  await expect(page.getByTestId("os-fotos").locator("img")).toHaveCount(1);
  await page.getByRole("button", { name: "Pronta" }).click();

  // Entrega: falta R$ 20, quem retirou e a assinatura na tela
  await page.getByRole("button", { name: "Entregar ao cliente" }).click();
  const entregar = page.getByRole("dialog");
  await expect(entregar.getByTestId("os-valores")).toContainText("R$ 20,00");
  await entregar.getByLabel("Quem retirou?").fill("Fulano E2E (fictício)");
  await entregar.getByRole("button", { name: /Pegar a assinatura/ }).click();
  const quadro = entregar.getByRole("img", { name: /Quadro para assinar/ });
  const area = (await quadro.boundingBox())!;
  await page.mouse.move(area.x + 30, area.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(area.x + 30 + i * 20, area.y + 80 + (i % 2 ? -25 : 25), { steps: 3 });
  await page.mouse.up();
  await entregar.getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(page.getByText("Esta OS está entregue.")).toBeVisible();
  const { data: fim } = await servico!.from("os_ordens").select("etapa, retirado_por, assinatura_caminho").eq("id", os!.id).single();
  expect(fim!.etapa).toBe("entregue");
  expect(fim!.retirado_por).toBe("Fulano E2E (fictício)");
  expect(fim!.assinatura_caminho).toMatch(/assinatura-.*\.png$/);

  // A página da OS mostra o sinal, a foto e a assinatura
  await page.goto(`/e/${empresaId}/os/${os!.id}`);
  await expect(page.getByTestId("os-recebimentos")).toContainText("Sinal");
  await expect(page.getByTestId("os-assinatura")).toBeVisible();
  await expect(page.getByTestId("os-fotos").locator("img")).toHaveCount(1);
});
