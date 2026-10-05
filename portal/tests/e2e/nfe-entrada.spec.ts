import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * NF-e de entrada: planilha do mês (empresa e carteira, com a coluna "XML
 * completo") e o pedido dos XML completos (ciência da emissão automática).
 * Os resumos e o certificado são fictícios e criados direto no banco local;
 * aqui as consultas fiscais ficam desligadas (NOTAS_AUTOMATICAS_SEM_REDE=1):
 * nada é enviado à SEFAZ.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const OFICINA = "44555666000181";
const PADARIA = "11222333000181";
// Chaves fictícias (UF 17, CNPJ do fornecedor 55.566.677/0001-88, modelo 55, série 1)
const CHAVE_PENDENTE = "17260955566677000188550010000081011000081010";
const CHAVE_RECUSADA = "17260955566677000188550010000081021000081020";
const CHAVE_PADARIA = "17260955566677000188550010000081031000081030";

/** Mês (AAAA-MM) somado de n meses ao mês de hoje, no fuso do escritório. */
function mes(n: number) {
  const [a, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date()).split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

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

/** Linhas da aba (sem o cabeçalho), como texto, por nome de coluna. */
async function lerPlanilha(conteudo: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(conteudo as unknown as ArrayBuffer);
  const aba = (nome: string) => {
    const ws = wb.getWorksheet(nome)!;
    const cab = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    const linhas: Record<string, string>[] = [];
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const v = (r.values as unknown[]).slice(1);
      linhas.push(Object.fromEntries(cab.map((c, i) => [c, v[i] instanceof Date ? (v[i] as Date).toISOString() : String(v[i] ?? "")])));
    });
    return linhas;
  };
  return { notas: aba("NF-e de entrada"), resumo: aba("Resumo por empresa") };
}

async function baixar(page: Page) {
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar planilha" }).click()]);
  expect(arquivo.suggestedFilename()).toMatch(/^nfe-entrada-.+\.xlsx$/);
  return { nome: arquivo.suggestedFilename(), ...(await lerPlanilha(readFileSync((await arquivo.path())!))) };
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let oficinaId = "";
let padariaId = "";
const competencia = mes(-1); // o mês que a planilha traz marcado

async function limpar() {
  if (!servico) return;
  await servico.from("nfe_resumos").delete().in("chave", [CHAVE_PENDENTE, CHAVE_RECUSADA, CHAVE_PADARIA]);
  await servico.from("notas_automaticas").delete().eq("empresa_id", oficinaId);
  await servico.from("certificados_digitais").delete().eq("empresa_id", oficinaId);
  await servico.from("jobs").delete().eq("empresa_id", oficinaId).eq("tipo", "notas_automaticas");
}

test.beforeAll(async () => {
  const { data: empresas } = await servico!.from("empresas").select("id, documento").in("documento", [OFICINA, PADARIA]);
  oficinaId = empresas!.find((e) => e.documento === OFICINA)!.id;
  padariaId = empresas!.find((e) => e.documento === PADARIA)!.id;
  const { data: cfg } = await servico!.from("notas_automaticas").select("empresa_id").eq("empresa_id", oficinaId).maybeSingle();
  if (cfg) throw new Error("A Oficina de demonstração já tem a busca automática: o teste não mexe nela.");
  await limpar();
  // Oficina: certificado válido (fictício), busca ativa e ciência automática desligada
  const validoAte = new Date(Date.now() + 200 * 86_400_000).toISOString();
  const { error: e1 } = await servico!.from("certificados_digitais").insert({
    empresa_id: oficinaId,
    titular: `OFICINA (DEMO):${OFICINA}`,
    documento: OFICINA,
    impressao_digital: "B".repeat(64),
    valido_de: new Date(Date.now() - 86_400_000).toISOString(),
    valido_ate: validoAte,
    autorizacao: "autorizacao_escrita",
    autorizacao_texto: "Teste automático (NF-e de entrada).",
  });
  if (e1) throw e1;
  const { error: e2 } = await servico!
    .from("notas_automaticas")
    .insert({ empresa_id: oficinaId, ciencia_automatica: false, certificado_valido_ate: validoAte, buscar_desde: `${competencia}-01` });
  if (e2) throw e2;
  const emissao = `${competencia}-12T10:00:00-03:00`;
  const base = { emitente_documento: "55566677000188", emitente_nome: "FORNECEDOR RESUMO (FICTICIO)", data_emissao: emissao, tipo_operacao: "entrada" };
  const { error: e3 } = await servico!.from("nfe_resumos").insert([
    { ...base, empresa_id: oficinaId, chave: CHAVE_PENDENTE, valor: 150.25 },
    { ...base, empresa_id: oficinaId, chave: CHAVE_RECUSADA, valor: 80, ciencia_retorno: "596 - Rejeição: evento apresentado fora do prazo (teste)" },
    { ...base, empresa_id: padariaId, chave: CHAVE_PADARIA, valor: 99.9 },
  ]);
  if (e3) throw e3;
});

test.afterAll(async () => {
  await limpar();
});

test("escritório baixa a planilha da carteira e pede os XML completos de todas as empresas", async ({ page }) => {
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio/notas-automaticas");
  const cartao = page.locator("#nfe-entrada");
  await expect(cartao.getByText("NF-e de entrada da carteira")).toBeVisible();
  await expect(cartao.getByText("2 NF-e esperando o XML completo")).toBeVisible();
  await expect(cartao.getByText(/Ciência automática desligada em 1 empresa com certificado válido/)).toBeVisible();
  await expect(cartao.getByText(/1 NF-e é de empresa com a busca pausada ou sem certificado válido/)).toBeVisible();
  await expect(page.locator("#entradas-competencia-carteira")).toHaveValue(competencia);

  // Planilha da carteira: resumos e notas com XML das duas empresas, sem repetir
  const p = await baixar(page);
  expect(p.nome).toBe(`nfe-entrada-carteira-${competencia}.xlsx`);
  const porChave = new Map(p.notas.map((l) => [l["Chave de acesso"], l]));
  expect(porChave.get(CHAVE_PENDENTE)).toMatchObject({
    Empresa: "Oficina Exemplo (DEMO)",
    "XML completo no portal": "Não (só resumo)",
    "Ciência da emissão": "Não registrada",
    "Fornecedor / outra parte": "FORNECEDOR RESUMO (FICTICIO)",
    "Valor (R$)": "150.25",
    Número: "8101",
    Situação: "Autorizada",
  });
  expect(porChave.get(CHAVE_RECUSADA)?.["Ciência da emissão"]).toMatch(/^Recusada \(596/);
  expect(porChave.get(CHAVE_PADARIA)?.Empresa).toBe("Padaria Pão Dourado (DEMO)");
  // As notas com o XML no portal (as de demonstração, quando são deste mês) entram com "Sim"
  const { count: comXml } = await servico!
    .from("documentos_fiscais")
    .select("id", { count: "exact", head: true })
    .in("empresa_id", [oficinaId, padariaId])
    .eq("operacao", "entrada")
    .eq("modelo", "55")
    .eq("competencia", `${competencia}-01`);
  expect(p.notas.filter((l) => l["XML completo no portal"] === "Sim").length).toBe(comXml ?? 0);
  const chaves = p.notas.map((l) => l["Chave de acesso"]).filter(Boolean);
  expect(new Set(chaves).size).toBe(chaves.length);
  const resumoOficina = p.resumo.find((l) => l.Empresa === "Oficina Exemplo (DEMO)");
  expect(resumoOficina?.["Só resumo"]).toBe("2");
  expect(p.resumo.some((l) => l.Empresa === "Padaria Pão Dourado (DEMO)")).toBe(true);

  // Pedir os XML completos: liga a ciência na empresa com certificado válido
  await cartao.getByRole("button", { name: "Pedir os XML de todas as empresas" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("não confirma nem recusa a operação");
  await page.getByRole("alertdialog").getByRole("button", { name: "Pedir para todas" }).click();
  await expect(page.getByText(/Ciência automática ligada em 1 empresa\./)).toBeVisible({ timeout: 30_000 });
  const { data: cfg } = await servico!.from("notas_automaticas").select("ciencia_automatica, nfe_ativa, pausada").eq("empresa_id", oficinaId).single();
  expect(cfg).toEqual({ ciencia_automatica: true, nfe_ativa: true, pausada: false });
  await expect(cartao.getByText(/Ciência automática desligada/)).toHaveCount(0);
  await expect(cartao.getByText(/com a ciência automática ligada: o XML chega nas próximas/)).toBeVisible();
});

test("cliente pede os XML da própria empresa e só baixa as notas dela", async ({ page }) => {
  await servico!.from("notas_automaticas").update({ ciencia_automatica: false, pausada: true }).eq("empresa_id", oficinaId);
  await entrar(page, `cliente2@${DOMINIO}`);
  await page.goto(`/e/${oficinaId}/notas-automaticas`);
  const cartao = page.locator("#nfe-recebidas");
  await expect(cartao.getByText("1 NF-e esperando o XML completo")).toBeVisible();
  await expect(cartao.getByText(/1 NF-e teve a ciência recusada pela SEFAZ/)).toBeVisible();
  await expect(cartao.getByText("596 - Rejeição: evento apresentado fora do prazo (teste)")).toBeVisible();

  // Planilha da empresa: só as notas dela
  const p = await baixar(page);
  expect(p.nome).toBe(`nfe-entrada-Oficina-Exemplo-DEMO-${competencia}.xlsx`);
  expect(new Set(p.notas.map((l) => l.Empresa))).toEqual(new Set(["Oficina Exemplo (DEMO)"]));
  expect(p.notas.map((l) => l["Chave de acesso"])).toEqual(expect.arrayContaining([CHAVE_PENDENTE, CHAVE_RECUSADA]));
  expect(p.resumo.map((l) => l.Empresa).filter((e) => e && !e.startsWith("NF-e de entrada"))).toEqual(["Oficina Exemplo (DEMO)"]);

  // O acesso é conferido no servidor: a planilha da outra empresa é recusada e a "da carteira" traz só a dela
  expect((await page.request.get(`/api/notas-entrada?competencia=${competencia}&empresa=${padariaId}`)).status()).toBe(403);
  const todas = await page.request.get(`/api/notas-entrada?competencia=${competencia}`);
  expect(todas.status()).toBe(200);
  const p2 = await lerPlanilha(Buffer.from(await todas.body()));
  expect(p2.notas.some((l) => l["Chave de acesso"] === CHAVE_PADARIA)).toBe(false);
  expect(new Set(p2.notas.map((l) => l.Empresa))).toEqual(new Set(["Oficina Exemplo (DEMO)"]));

  // Pedir os XML completos: liga a ciência e retoma a busca pausada
  await cartao.getByRole("button", { name: "Pedir os XML completos" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("A busca, que está pausada, volta a funcionar.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Pedir os XML" }).click();
  await expect(page.getByText(/Ciência automática ligada\. A ciência da emissão/)).toBeVisible({ timeout: 30_000 });
  const { data: cfg } = await servico!.from("notas_automaticas").select("ciencia_automatica, nfe_ativa, pausada").eq("empresa_id", oficinaId).single();
  expect(cfg).toEqual({ ciencia_automatica: true, nfe_ativa: true, pausada: false });
  await expect(cartao.getByText(/A ciência automática está ligada: o portal registra a ciência/)).toBeVisible();
  await expect(cartao.getByRole("button", { name: "Pedir os XML completos" })).toHaveCount(0);
});
