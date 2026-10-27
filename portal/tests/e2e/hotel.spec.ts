import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Hotel (hotel fictício da demonstração):
 *  - a recepção faz a reserva de um hóspede novo com check-in na hora, lança
 *    consumo do frigobar, recebe e faz o check-out (a conta fecha, o
 *    pagamento vai para o Financeiro e o quarto vai para a limpeza);
 *  - a ficha do hóspede sai em PDF; a recepção não vê os relatórios;
 *  - cliente de outra empresa não vê o hotel.
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
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    // Primeiro acesso: aceita os termos depois que a página termina de carregar
    await page.waitForLoadState("networkidle");
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

function cpfAleatorio() {
  const base = String(Math.floor(100000000 + Math.random() * 800000000));
  const calc = (b: string) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base);
  return `${base}${d1}${calc(base + d1)}`;
}

const hojeLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
const amanha = () => {
  const d = new Date(`${hojeLocal()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.describe.configure({ mode: "serial" });

let empresaId = "";
let reservaId = "";

let quartoUsado = "";

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").ilike("razao_social", "HOTEL RIO TOCANTINS%").eq("demonstracao", true).single();
  empresaId = data!.id;
  // Quartos 9xx de execuções anteriores do teste de cadastro em lote
  await servico!.from("hotel_quartos").delete().eq("empresa_id", empresaId).like("numero", "9__");
  // Sobras de execuções interrompidas deste teste: libera os quartos
  const { data: teste } = await servico!.from("hotel_hospedes").select("id").eq("empresa_id", empresaId).like("nome", "Hóspede Teste %");
  const ids = (teste ?? []).map((h) => h.id);
  if (ids.length) {
    const { data: sobras } = await servico!
      .from("hotel_reservas")
      .update({ status: "cancelada", cancelada_em: new Date().toISOString(), motivo_cancelamento: "Sobra de teste automático" })
      .in("hospede_id", ids)
      .in("status", ["pre_reserva", "confirmada", "hospedado"])
      .select("quarto_id");
    if (sobras?.length) await servico!.from("hotel_quartos").update({ limpeza: "limpo" }).in("id", sobras.map((s) => s.quarto_id));
  }
});

// O quarto usado volta a ficar limpo e o hotel continua na modalidade hotel (a demonstração segue igual)
test.afterAll(async () => {
  if (quartoUsado) await servico!.from("hotel_quartos").update({ limpeza: "limpo" }).eq("id", quartoUsado);
  if (empresaId) await servico!.from("gestao_config").update({ modalidade: "hotel", ativa: true }).eq("empresa_id", empresaId);
  if (empresaId) await servico!.from("hotel_quartos").delete().eq("empresa_id", empresaId).like("numero", "9__");
});

test("escritório: liga a gestão do hotel pela tela (a modalidade escolhida é gravada)", async ({ page }) => {
  test.setTimeout(120_000);
  // Começa como se a empresa estivesse na loja comum
  await servico!.from("gestao_config").update({ modalidade: "loja" }).eq("empresa_id", empresaId);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/configuracoes`);
  await page.locator("#modalidade").selectOption("hotel");
  await page.locator('input[name="ativa"]').check();
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Gestão do hotel ligada e configurada.")).toBeVisible({ timeout: 30_000 });
  const { data } = await servico!.from("gestao_config").select("ativa, modalidade").eq("empresa_id", empresaId).single();
  expect(data).toEqual({ ativa: true, modalidade: "hotel" });
  await page.goto(`/e/${empresaId}/hotel`);
  await expect(page.getByRole("heading", { name: "Painel do hotel" })).toBeVisible();
});

test("recepção: reserva com check-in na hora, consumo, pagamento e check-out", async ({ page }) => {
  test.setTimeout(240_000);
  // Um quarto limpo, sem hóspede (nem o que sai hoje e ainda não fez o check-out) e sem reserva para hoje
  const hoje = hojeLocal();
  const [{ data: quartos }, { data: ativas }] = await Promise.all([
    servico!.from("hotel_quartos").select("id, numero").eq("empresa_id", empresaId).eq("ativo", true).eq("limpeza", "limpo").order("numero"),
    servico!.from("hotel_reservas").select("quarto_id").eq("empresa_id", empresaId).in("status", ["pre_reserva", "confirmada", "hospedado"]).lt("entrada", amanha()).gt("saida", hoje),
  ]);
  const { data: ocupados } = await servico!.from("hotel_reservas").select("quarto_id").eq("empresa_id", empresaId).eq("status", "hospedado");
  const livre = (quartos ?? []).find((q) => ![...(ativas ?? []), ...(ocupados ?? [])].some((a) => a.quarto_id === q.id));
  expect(livre, "precisa de um quarto livre e limpo hoje").toBeTruthy();
  quartoUsado = livre!.id;

  await entrar(page, `recepcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel`);
  await expect(page.getByRole("heading", { name: "Painel do hotel" })).toBeVisible();
  await expect(page.getByText("Ocupação hoje")).toBeVisible();

  // Nova reserva com hóspede novo e check-in agora
  await page.goto(`/e/${empresaId}/hotel/reservas/nova`);
  await page.getByRole("button", { name: /Novo hóspede/ }).click();
  const nome = `Hóspede Teste ${Date.now() % 100000}`;
  await page.locator("#hs-novo_nome").fill(nome);
  await page.locator("#hs-novo_cpf").fill(cpfAleatorio());
  await page.locator("#r-adultos").fill("1");
  await page.locator("#r-quarto").selectOption({ value: livre!.id });
  await page.getByText(/Diárias previstas: R\$/).waitFor();
  await page.locator('input[name="checkin_agora"]').check();
  await page.getByRole("button", { name: "Criar reserva" }).click();
  await page.waitForURL(/\/hotel\/reservas\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  reservaId = page.url().split("/").pop()!;
  await expect(page.getByText("Hospedado", { exact: true }).first()).toBeVisible();

  // Consumo do frigobar na conta do quarto
  await page.getByRole("link", { name: "Lançar consumo", exact: true }).click();
  await page.waitForURL(/\/hotel\/consumo\?reserva=/);
  await page.getByRole("button", { name: /Água mineral 500 ml/ }).click();
  await page.getByRole("button", { name: /Água mineral 500 ml/ }).click();
  await page.getByRole("button", { name: "Lançar na conta do quarto" }).click();
  await expect(page.getByText(/lançado\(s\) na conta do quarto/)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/e/${empresaId}/hotel/reservas/${reservaId}`);
  await expect(page.getByRole("cell", { name: /Água mineral 500 ml/ })).toBeVisible();

  // Check-out com saldo: o portal não deixa
  // (recebe o valor sugerido, que é o saldo da conta, e fecha)
  await page.getByRole("button", { name: "Receber pagamento" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByLabel("Valor")).not.toHaveValue("");
  await dialogo.getByRole("button", { name: "Registrar" }).click();
  await expect(dialogo).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Check-out" }).click();
  await page.getByRole("button", { name: "Fazer check-out" }).click();
  await expect(page.getByText("Encerrada", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const { data: r } = await servico!.from("hotel_reservas").select("status, quarto_id").eq("id", reservaId).single();
  expect(r!.status).toBe("encerrada");
  const { data: q } = await servico!.from("hotel_quartos").select("limpeza").eq("id", r!.quarto_id).single();
  expect(q!.limpeza).toBe("sujo");
  const { data: lancs } = await servico!.from("lancamentos").select("valor_previsto, situacao").eq("origem", "hotel").eq("origem_referencia", reservaId);
  expect(lancs!.length).toBe(1);
  expect(lancs![0].situacao).toBe("quitado");
  const { data: itens } = await servico!.from("hotel_conta_itens").select("tipo, total").eq("reserva_id", reservaId).is("cancelado_em", null);
  const total = (itens ?? []).reduce((s, i) => s + Number(i.total), 0);
  expect(Number(lancs![0].valor_previsto)).toBeCloseTo(total, 2);

  // Ficha do hóspede em PDF; a recepção não vê os relatórios
  const ficha = await page.request.get(`/api/hotel/${empresaId}/reservas/${reservaId}?doc=ficha`);
  expect(ficha.status()).toBe(200);
  expect(ficha.headers()["content-type"]).toContain("application/pdf");
  expect((await page.request.get(`/api/hotel/${empresaId}/relatorio`)).status()).toBe(403);
  await page.goto(`/e/${empresaId}/hotel/relatorios`);
  await expect(page.getByText("Você não tem acesso ao hotel")).toBeVisible();
});

test("o dono vê os relatórios; cliente de outra empresa não vê o hotel", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `hotel@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel/relatorios`);
  await expect(page.getByRole("heading", { name: "Relatórios do hotel" })).toBeVisible();
  await expect(page.getByText("Taxa de ocupação")).toBeVisible();
  const pdf = await page.request.get(`/api/hotel/${empresaId}/relatorio`);
  expect(pdf.status()).toBe(200);
  await page.goto(`/e/${empresaId}/hotel/mapa`);
  await expect(page.getByRole("heading", { name: "Mapa de reservas" })).toBeVisible();

  await page.context().clearCookies();
  await entrar(page, `cliente@${DOMINIO}`);
  const resposta = await page.goto(`/e/${empresaId}/hotel`);
  expect(resposta?.status()).toBe(404);
  expect((await page.request.get(`/api/hotel/${empresaId}/reservas/${reservaId}?doc=conta`)).status()).toBe(403);
});

test("dono: cadastra vários quartos de uma vez (faixa, pulando um número)", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `hotel@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel/quartos`);
  await page.getByRole("button", { name: "Cadastrar vários quartos" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#ql-inicio").fill("901");
  await dialogo.locator("#ql-fim").fill("905");
  await dialogo.locator("#ql-pular").fill("903");
  await dialogo.locator("#ql-cat").selectOption({ index: 1 });
  await dialogo.locator("#ql-andar").fill("9º andar");
  await expect(dialogo.getByText("Vai cadastrar 4 quartos: 901, 902, 904, 905")).toBeVisible();
  await dialogo.getByRole("button", { name: "Cadastrar quartos" }).click();
  await expect(page.getByText("4 quartos cadastrados (901 a 905).")).toBeVisible({ timeout: 30_000 });
  const { data } = await servico!.from("hotel_quartos").select("numero, andar, limpeza").eq("empresa_id", empresaId).like("numero", "9__").order("numero");
  expect(data).toEqual(["901", "902", "904", "905"].map((numero) => ({ numero, andar: "9º andar", limpeza: "limpo" })));
});
