import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Contratos (dados fictícios da demonstração, na Padaria): o administrador
 * gera o contrato pela ficha, confere e envia; o sócio titular lê e assina
 * (com o código do e-mail quando o e-mail está ligado); sai a via assinada;
 * o escritório publica nos documentos; o aditivo só sai quando a ficha muda.
 * O colaborador não assina.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const PADARIA = "11222333000181";

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
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

/** Código do e-mail na caixa de teste local (só quando o portal está com o e-mail de teste ligado). */
async function codigoDoEmail(): Promise<string | null> {
  try {
    const r = await fetch("http://127.0.0.1:54324/api/v1/messages");
    const d = (await r.json()) as { messages?: { Subject: string }[] };
    const m = (d.messages ?? []).map((x) => /Código para assinar: (\d{6})/.exec(x.Subject)).find(Boolean);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";

async function limpar() {
  const { data: docs } = await servico!.from("honorarios_contratos").select("documento_id").eq("empresa_id", empresaId);
  await servico!.from("honorarios_contratos").delete().eq("empresa_id", empresaId).neq("tipo", "contrato");
  await servico!.from("honorarios_contratos").delete().eq("empresa_id", empresaId);
  const ids = (docs ?? []).map((d) => d.documento_id).filter(Boolean) as string[];
  if (ids.length) await servico!.from("documentos").update({ excluido_em: new Date().toISOString() }).in("id", ids);
  await servico!.from("honorarios_fichas").delete().eq("empresa_id", empresaId);
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("documento", PADARIA).single();
  empresaId = data!.id;
  await limpar();
  await servico!.from("honorarios_fichas").insert({
    empresa_id: empresaId,
    valor_mensal: 850,
    dia_vencimento: 10,
    inicio: "2026-10-01",
    servicos: ["contabil", "fiscal", "folha"],
    funcionarios_inclusos: 2,
    valor_funcionario_extra: 35,
    contato_email: "financeiro@padaria.demo.test",
  });
});

test.afterAll(async () => {
  await limpar();
});

test("contrato pela ficha: gerar, enviar, titular assina, via assinada e aditivo", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await entrar(page, `admin@${DOMINIO}`);

  // 1. Gera pela ficha e confere o texto
  await page.goto("/escritorio/honorarios/contratos");
  await page.getByRole("button", { name: "Gerar contrato" }).first().click();
  await page.getByRole("button", { name: "Gerar e conferir" }).click();
  await expect(page).toHaveURL(/\/escritorio\/honorarios\/contratos\/[0-9a-f-]{36}\?gerado=1/, { timeout: 60_000 });
  const contratoUrl = page.url().split("?")[0];
  const contratoId = contratoUrl.split("/").pop()!;
  await expect(page.getByText("CLÁUSULA PRIMEIRA — DO OBJETO E DOS SERVIÇOS")).toBeVisible();
  await expect(page.getByText(/R\$ 850,00 \(oitocentos e cinquenta reais\)/).first()).toBeVisible();
  await expect(page.getByText(/^a\) Contabilidade/)).toBeVisible();
  await expect(page.getByText("Carta de Responsabilidade da Administração", { exact: false }).first()).toBeVisible();

  // 2. Envia ao cliente
  await page.getByRole("button", { name: "Enviar ao cliente" }).click();
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByText(/Enviado: \d sócio/).first()).toBeVisible({ timeout: 30_000 });

  // 3. O colaborador vê, mas não assina
  const ctxColab = await browser.newContext();
  const colab = await ctxColab.newPage();
  await entrar(colab, `colaborador@${DOMINIO}`);
  await colab.goto(`/e/${empresaId}/contratos/${contratoId}`);
  // Sem a permissão do financeiro, nem abre; com ela, lê mas não tem o botão de assinar
  await expect(colab.locator("main").getByText(/Página não encontrada|Só o sócio titular da empresa assina/)).toBeVisible();
  await expect(colab.getByRole("button", { name: "Assinar", exact: true })).toHaveCount(0);
  await ctxColab.close();

  // 4. O sócio titular lê e assina
  const ctxCliente = await browser.newContext();
  const cliente = await ctxCliente.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto(`/e/${empresaId}/contratos`);
  await cliente.getByRole("link", { name: /Contrato de prestação de serviços contábeis/ }).click();
  await cliente.getByLabel("Seu nome completo").fill("Cliente Demonstração Silva");
  await cliente.getByLabel("Seu CPF").fill("529.982.247-25");
  const comCodigo = await cliente.getByRole("button", { name: "Enviar código" }).isVisible();
  if (comCodigo) {
    await fetch("http://127.0.0.1:54324/api/v1/messages", { method: "DELETE" }).catch(() => undefined);
    await cliente.getByRole("button", { name: "Enviar código" }).click();
    await expect(cliente.getByText(/Enviamos o código/).first()).toBeVisible({ timeout: 30_000 });
    let codigo: string | null = null;
    for (let i = 0; i < 20 && !codigo; i++) {
      codigo = await codigoDoEmail();
      if (!codigo) await cliente.waitForTimeout(500);
    }
    expect(codigo).toMatch(/^\d{6}$/);
    await cliente.getByLabel("Código enviado ao seu e-mail").fill(codigo!);
  }
  await cliente.getByLabel(/Li o documento inteiro/).check();
  await cliente.getByRole("button", { name: "Assinar", exact: true }).click();
  await expect(cliente.getByText(/Documento assinado/).first()).toBeVisible({ timeout: 60_000 });
  const via = await cliente.request.get(`/api/honorarios/contratos/${contratoId}/pdf?via=final`);
  expect(via.status()).toBe(200);
  expect(via.headers()["content-type"]).toContain("application/pdf");
  expect(via.headers()["content-disposition"]).toContain("_assinado.pdf");
  await ctxCliente.close();
  const { data: assinado } = await servico!.from("honorarios_contratos").select("situacao, aceite_cpf, aceite_metodo, final_hash").eq("id", contratoId).single();
  expect(assinado).toMatchObject({ situacao: "assinado", aceite_cpf: "52998224725", aceite_metodo: comCodigo ? "codigo_email" : "sessao" });
  expect(assinado!.final_hash).toMatch(/^[0-9a-f]{64}$/);

  // 5. O escritório publica a via assinada nos documentos
  await page.goto(contratoUrl);
  await expect(page.getByText("CPF 529.982.247-25", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Publicar nos documentos do cliente" }).click();
  await expect(page.getByText("Via assinada publicada", { exact: false }).first()).toBeVisible({ timeout: 60_000 });

  // 6. Aditivo: sem mudança na ficha, não sai; com o valor novo, sai com o que mudou
  await page.getByRole("button", { name: "Gerar aditivo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Gerar aditivo" }).click();
  await expect(page.getByText(/não há o que aditar/).first()).toBeVisible({ timeout: 30_000 });
  await servico!.from("honorarios_fichas").update({ valor_mensal: 950 }).eq("empresa_id", empresaId);
  await page.getByRole("dialog").getByRole("button", { name: "Gerar aditivo" }).click();
  await expect(page).toHaveURL(/\/escritorio\/honorarios\/contratos\/[0-9a-f-]{36}\?gerado=1/, { timeout: 60_000 });
  await expect(page.getByText(/passam de R\$ 850,00 \(oitocentos e cinquenta reais\) para R\$ 950,00/)).toBeVisible();
});
