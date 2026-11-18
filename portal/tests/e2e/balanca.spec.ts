import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Pesagem no caixa (dados fictícios da demonstração, na Madeireira, com um
 * produto de teste "por quilo"): a balança simulada responde no protocolo
 * Toledo; o caixa conecta, o produto entra com o peso lido, desconta o peso
 * do prato e calcula o valor; peso instável avisa; a etiqueta da balança
 * (código que começa com 2) põe o produto com o preço impresso; a venda
 * grava o peso com 3 casas.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";
const CODIGO = "9901";

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
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

/** EAN-13 com o dígito verificador. */
function ean13(doze: string) {
  const soma = [...doze].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return `${doze}${(10 - (soma % 10)) % 10}`;
}

/**
 * Balança simulada no navegador (Web Serial): ao receber ENQ (0x05),
 * responde STX + peso + ETX, como uma Toledo. O peso vem de window.__peso.
 */
const BALANCA_SIMULADA = () => {
  const w = window as unknown as { __peso: string };
  w.__peso = "00802";
  const criarPorta = () => {
    let controle: ReadableStreamDefaultController<Uint8Array> | null = null;
    let fluxo: ReadableStream<Uint8Array> | null = null;
    const novoFluxo = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          controle = c;
        },
        cancel() {
          fluxo = null;
        },
      });
    return {
      open: async () => undefined,
      close: async () => undefined,
      get readable() {
        if (!fluxo) fluxo = novoFluxo();
        return fluxo;
      },
      writable: new WritableStream<Uint8Array>({
        write(pedaco) {
          if (pedaco[0] === 0x05) controle?.enqueue(new TextEncoder().encode(`\u0002${w.__peso}\u0003`));
        },
      }),
    };
  };
  let porta: ReturnType<typeof criarPorta> | null = null;
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: {
      requestPort: async () => (porta ??= criarPorta()),
      getPorts: async () => (porta ? [porta] : []),
    },
  });
};

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
let produtoId = "";
let configAntes: { balanca_etiqueta: string | null; balanca_digitos_codigo: number } | null = null;

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
  const { data: cfg } = await servico!.from("gestao_config").select("balanca_etiqueta, balanca_digitos_codigo").eq("empresa_id", empresaId).single();
  configAntes = cfg;
  await servico!.from("gestao_config").update({ balanca_etiqueta: "preco", balanca_digitos_codigo: 4 }).eq("empresa_id", empresaId);
  // Reaproveita o produto de teste de uma rodada anterior (ele fica no histórico por ter venda)
  const dados = { empresa_id: empresaId, codigo: CODIGO, descricao: "Refeição por quilo (teste)", ncm: "21069090", unidade: "KG", valor_unitario: 69.9, controla_estoque: false, tara_kg: 0.35, ativo: true };
  const { data: p, error } = await servico!.from("nfe_produtos").upsert(dados, { onConflict: "empresa_id,codigo" }).select("id").single();
  if (error) throw error;
  produtoId = p!.id;
});

test.afterAll(async () => {
  if (configAntes) await servico!.from("gestao_config").update(configAntes).eq("empresa_id", empresaId);
  // A venda do teste fica no histórico da demonstração; o produto é desativado (tem venda)
  if (produtoId) await servico!.from("nfe_produtos").update({ ativo: false }).eq("id", produtoId);
});

test("caixa pesa na balança, desconta o prato, lê a etiqueta e grava o peso na venda", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(BALANCA_SIMULADA);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/vender`);
  const abrir = page.getByRole("button", { name: "Abrir o caixa" });
  if (await abrir.isVisible().catch(() => false)) {
    await page.getByLabel("Nome do caixa").fill("Caixa balança");
    await page.getByLabel("Troco inicial na gaveta").fill("100,00");
    await abrir.click();
  }
  await expect(page.getByLabel("Buscar produto")).toBeVisible({ timeout: 30_000 });

  // 1. Conectar a balança
  await expect(page.getByText("desconectada", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Conectar balança" }).click();
  await expect(page.getByText("conectada", { exact: true })).toBeVisible();

  // 2. Produto por quilo: entra com o peso lido (0,802), desconta o prato (0,350) = 0,452 kg × R$ 69,90 = R$ 31,59
  await page.getByLabel("Buscar produto").fill("Refeição por quilo");
  await page.getByRole("button", { name: /Refeição por quilo \(teste\)/ }).click();
  const peso = page.getByLabel("Peso na balança (kg)");
  await expect(peso).toHaveValue("0,802");
  await expect(page.getByText("− prato 0,350 kg = 0,452 kg cobrados")).toBeVisible();
  const itens = page.getByRole("list", { name: "Itens da venda" });
  await expect(itens.getByText("R$ 31,59")).toBeVisible();

  // 3. Peso mexendo: avisa e não muda o valor
  await page.evaluate(() => ((window as unknown as { __peso: string }).__peso = "IIIII"));
  await page.getByRole("button", { name: /Ler a balança para Refeição/ }).click();
  await expect(page.getByText("O peso ainda está mexendo", { exact: false })).toBeVisible();
  await expect(peso).toHaveValue("0,802");

  // 4. Digitar o peso também funciona: 1,000 − 0,350 = 0,650 kg = R$ 45,44
  await peso.fill("1,000");
  await expect(page.getByText("= 0,650 kg cobrados")).toBeVisible();
  await expect(itens.getByText("R$ 45,44")).toBeVisible();

  // 5. Etiqueta da balança com preço: produto 9901, R$ 23,45 → o total bate com o impresso
  await page.getByLabel("Buscar produto").fill(ean13(`2${CODIGO}0002345`));
  await page.getByLabel("Buscar produto").press("Enter");
  await expect(page.getByText("peso da etiqueta da balança")).toBeVisible();
  await expect(itens.getByText("R$ 23,45")).toBeVisible();

  // 6. Concluir em dinheiro: R$ 45,44 + R$ 23,45 = R$ 68,89
  await page.getByLabel("Nome do cliente (sem cadastro)").fill("Cliente E2E balança");
  await page.getByRole("group", { name: "Formas de pagamento" }).getByRole("button", { name: /Dinheiro/ }).click();
  await page.getByRole("button", { name: "Concluir venda" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toContainText("concluída", { timeout: 30_000 });
  await expect(dialogo).toContainText("R$ 68,89");
  const vendaId = (await dialogo.getByRole("link", { name: "Ver a venda" }).getAttribute("href"))!.split("/").pop()!;
  const { data: itensVenda } = await servico!.from("venda_itens").select("quantidade, total").eq("venda_id", vendaId).order("ordem");
  expect(itensVenda!.map((i) => [Number(i.quantidade), Number(i.total)])).toEqual([
    [0.65, 45.44],
    [0.336, 23.45],
  ]);
  await dialogo.getByRole("button", { name: "Nova venda" }).click();

  // 7. O gerente muda o peso do prato no cadastro do produto
  await page.goto(`/e/${empresaId}/loja/produtos/${produtoId}`);
  await page.getByRole("button", { name: "Editar" }).click();
  const tara = page.getByLabel("Peso do prato ou da embalagem (kg)");
  await expect(tara).toHaveValue("0,350");
  await tara.fill("0,400");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Produto atualizado.")).toBeVisible({ timeout: 30_000 });
  const { data: salvo } = await servico!.from("nfe_produtos").select("tara_kg").eq("id", produtoId).single();
  expect(Number(salvo!.tara_kg)).toBe(0.4);
});
