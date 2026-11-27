import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Gestão de RH e quadro de tarefas (dados fictícios da demonstração, Madeireira
 * Reflorestar), pelos fluxos normais do portal:
 *  1. os cadastros existentes continuam acessíveis pela Gestão de RH (e o
 *     endereço antigo do cadastro leva para o novo);
 *  2. o gestor liga um modelo de tarefa a um cargo e atribui a ocorrência a um funcionário;
 *  3. o funcionário confirma a conferência do estoque e o histórico mostra quem e quando;
 *  4. a organização do pátio só conclui com a foto, a área e a semana;
 *  5. o fechamento do caixa conclui só a tarefa do dia, mesmo processado de novo;
 *  6. a tarefa semanal gera a próxima semana sem mexer na conclusão da anterior.
 * No fim, a demonstração volta como estava.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";
// Foto PNG mínima (1×1) para a evidência
const FOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function carregarEnv() {
  if (existsSync(".env.local")) {
    for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
carregarEnv();
const URL_SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const servico: SupabaseClient | null =
  URL_SUPA && process.env.SUPABASE_SECRET_KEY ? createClient(URL_SUPA, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }) : null;

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

function hojeLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
}
function segunda(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1));
  return d.toISOString().slice(0, 10);
}

test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.describe.configure({ mode: "serial" });

const sufixo = String(randomInt(100000, 999999));
const CAIXA = `Caixa RH ${sufixo}`;
const inicio = new Date().toISOString();
let empresaId = "";
let tarefasAntes = new Set<string>();
const modelo: Record<string, { id: string; cargo_id: string | null; dias_semana: number[]; parametros: Record<string, unknown> }> = {};
let idBalconista = "";
let idPedro = "";
let idUsuarioBalcao = "";
let tPatio = "";
let tConferencia = "";
let cargoNovo = "";
let sessaoCaixa = "";

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = emp!.id;
  const { data: ms } = await servico!.from("rh_tarefa_modelos").select("id, chave_rotina, cargo_id, dias_semana, parametros").eq("empresa_id", empresaId);
  for (const m of ms ?? []) if (m.chave_rotina) modelo[m.chave_rotina] = { id: m.id, cargo_id: m.cargo_id, dias_semana: m.dias_semana, parametros: m.parametros as Record<string, unknown> };
  expect(Object.keys(modelo).sort()).toEqual(["conciliacao_semanal", "conferencia_estoque", "envio_extrato", "fechamento_caixa", "organizacao_patio"]);
  // Fechamento do caixa deste teste: todos os dias e só o caixa criado aqui (outros caixas da demonstração não interferem)
  await servico!.from("rh_tarefa_modelos").update({ dias_semana: [1, 2, 3, 4, 5, 6, 7], parametros: { caixa_nome: CAIXA } }).eq("id", modelo.fechamento_caixa.id);
  const { data: fs } = await servico!.from("escala_funcionarios").select("id, nome, usuario_id").eq("empresa_id", empresaId);
  idBalconista = fs!.find((f) => f.nome.startsWith("Balconista"))!.id;
  idUsuarioBalcao = fs!.find((f) => f.nome.startsWith("Balconista"))!.usuario_id!;
  idPedro = fs!.find((f) => f.nome.startsWith("Pedro"))!.id;
  const semana = segunda(hojeLocal());
  const { data: ts } = await servico!.from("rh_tarefas").select("id, modelo_id, periodo_inicio, status").eq("empresa_id", empresaId);
  tarefasAntes = new Set((ts ?? []).map((t) => t.id));
  tPatio = ts!.find((t) => t.modelo_id === modelo.organizacao_patio.id && t.periodo_inicio === semana)!.id;
  tConferencia = ts!.find((t) => t.modelo_id === modelo.conferencia_estoque.id && t.periodo_inicio === semana)!.id;
  expect(ts!.filter((t) => [tPatio, tConferencia].includes(t.id)).every((t) => t.status !== "concluida")).toBe(true);
});

test.afterAll(async () => {
  if (!empresaId) return;
  // Ocorrências criadas pelo teste saem; as que o teste concluiu voltam a "A fazer"
  const { data: ts } = await servico!.from("rh_tarefas").select("id").eq("empresa_id", empresaId);
  const novas = (ts ?? []).map((t) => t.id).filter((id) => !tarefasAntes.has(id));
  if (novas.length) await servico!.from("rh_tarefas").delete().in("id", novas);
  const { data: evs } = await servico!.from("rh_tarefa_evidencias").select("id, caminho").eq("empresa_id", empresaId).gte("created_at", inicio);
  if (evs?.length) {
    await servico!.storage.from("rh-evidencias").remove(evs.map((e) => e.caminho));
    await servico!.from("rh_tarefa_evidencias").delete().in("id", evs.map((e) => e.id));
  }
  await servico!.from("rh_tarefa_vinculos").delete().eq("empresa_id", empresaId).gte("criado_em", inicio);
  await servico!.from("rh_tarefa_eventos").delete().eq("empresa_id", empresaId).gte("em", inicio);
  await servico!.from("estoque_conferencias").delete().eq("empresa_id", empresaId).gte("conferido_em", inicio);
  await servico!
    .from("rh_tarefas")
    .update({ status: "a_fazer", concluida_em: null, concluida_por: null, origem_conclusao: null, area: null, semana_referencia: null, observacao: null, conclusao_pendente: false, iniciada_em: null })
    .eq("empresa_id", empresaId)
    .gte("concluida_em", inicio);
  if (tPatio) await servico!.from("rh_tarefas").update({ responsavel_id: idPedro }).eq("id", tPatio);
  for (const m of Object.values(modelo)) await servico!.from("rh_tarefa_modelos").update({ cargo_id: m.cargo_id, dias_semana: m.dias_semana, parametros: m.parametros }).eq("id", m.id);
  if (cargoNovo) await servico!.from("rh_cargos").delete().eq("id", cargoNovo);
});

test("1 e 2: cadastros na Gestão de RH; o gestor liga a tarefa ao cargo e atribui a ocorrência", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  // Endereço antigo do cadastro leva à Gestão de RH, com os funcionários de antes
  await page.goto(`/e/${empresaId}/escalas/funcionarios`);
  await page.waitForURL(/\/rh\/funcionarios$/);
  await expect(page.getByRole("heading", { name: "Funcionários", level: 1 })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Balconista da Madeireira (DEMO)", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Pedro do Pátio (DEMO)", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation").getByText("Gestão de RH").first()).toBeVisible();

  // Cargo novo com a conferência do estoque como responsabilidade
  await page.goto(`/e/${empresaId}/rh/cargos`);
  await page.getByRole("button", { name: "Novo cargo" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Nome do cargo").fill(`Conferente E2E ${sufixo}`);
  await dialogo.getByLabel("Descrição do cargo").fill("Confere o estoque toda semana (teste automático).");
  await dialogo.getByRole("checkbox", { name: /Conferência de estoque/ }).check();
  await dialogo.getByRole("button", { name: "Cadastrar cargo" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  const { data: cargo } = await servico!.from("rh_cargos").select("id").eq("empresa_id", empresaId).eq("nome", `Conferente E2E ${sufixo}`).single();
  cargoNovo = cargo!.id;
  await expect
    .poll(async () => (await servico!.from("rh_tarefa_modelos").select("cargo_id").eq("id", modelo.conferencia_estoque.id).single()).data!.cargo_id, { timeout: 30_000 })
    .toBe(cargoNovo);
  await expect(page.getByTestId("cartao-cargo").filter({ hasText: `Conferente E2E ${sufixo}` })).toContainText("Conferência de estoque");

  // Atribui a organização do pátio desta semana ao balconista
  await page.goto(`/e/${empresaId}/rh/tarefas`);
  await expect(page.getByTestId("cartao-tarefa").first()).toBeVisible({ timeout: 60_000 });
  await page.goto(`/e/${empresaId}/rh/tarefas/${tPatio}`);
  await page.getByLabel("Responsável pela tarefa").selectOption(idBalconista);
  await expect
    .poll(async () => (await servico!.from("rh_tarefas").select("responsavel_id").eq("id", tPatio).single()).data!.responsavel_id, { timeout: 30_000 })
    .toBe(idBalconista);
  await page.reload();
  await expect(page.getByTestId("rh-historico")).toContainText("Responsável: Balconista da Madeireira (DEMO)");
});

test("3 e 4: o funcionário confirma a conferência e conclui o pátio só com foto, área e semana", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/rh/tarefas`);
  await expect(page.getByRole("heading", { name: "Minhas tarefas", level: 1 })).toBeVisible({ timeout: 60_000 });
  // Só as tarefas dele (o pátio agora é dele; nada do Pedro)
  await expect(page.getByTestId("cartao-tarefa").filter({ hasText: "Pedro do Pátio" })).toHaveCount(0);

  // 3. Conferência do estoque pelo botão
  const cartaoConf = page.getByTestId("cartao-tarefa").filter({ hasText: "Conferência de estoque" }).first();
  await cartaoConf.getByRole("button", { name: "Confirmar conferência" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirmar conferência" }).click();
  await expect(page.getByText(/Conferência confirmada/)).toBeVisible({ timeout: 30_000 });
  const { data: conf } = await servico!.from("rh_tarefas").select("status, origem_conclusao, concluida_por, concluida_em").eq("id", tConferencia).single();
  expect([conf!.status, conf!.origem_conclusao, conf!.concluida_por]).toEqual(["concluida", "automatica", idUsuarioBalcao]);
  await page.goto(`/e/${empresaId}/rh/tarefas/${tConferencia}`);
  const historico = page.getByTestId("rh-historico");
  await expect(historico).toContainText("Concluída · automática");
  await expect(historico).toContainText("Balconista da Madeireira (Demonstração)");
  await expect(historico).toContainText(/\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
  await expect(page.getByTestId("rh-conclusao")).toContainText("Balconista da Madeireira (Demonstração)");
  await expect(page.getByTestId("rh-registros")).toContainText("Conferência confirmada por Balconista da Madeireira (Demonstração)");

  // 4. Pátio: sem foto não conclui
  await page.goto(`/e/${empresaId}/rh/tarefas/${tPatio}`);
  await expect(page.getByText("Anexe a foto acima para concluir.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Concluir tarefa" })).toBeDisabled();
  await page.locator('input[aria-label="Escolher arquivo da evidência"]').setInputFiles({ name: "patio.png", mimeType: "image/png", buffer: FOTO });
  await expect(page.getByText("Arquivo anexado.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("rh-evidencias").getByRole("img")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Concluir tarefa" })).toBeEnabled();
  // Área e semana são obrigatórias
  await page.getByRole("button", { name: "Concluir tarefa" }).click();
  await expect(page.getByText("Informe a semana de referência.")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Semana de referência").selectOption(segunda(hojeLocal()));
  await page.getByRole("button", { name: "Concluir tarefa" }).click();
  await expect(page.getByText("Informe a área.")).toBeVisible({ timeout: 30_000 });
  expect((await servico!.from("rh_tarefas").select("status").eq("id", tPatio).single()).data!.status).not.toBe("concluida");
  // O que já foi preenchido continua no formulário depois do aviso
  await expect(page.getByLabel("Semana de referência")).toHaveValue(segunda(hojeLocal()));
  await page.getByLabel("Área").fill(`Pátio dos fundos (E2E ${sufixo})`);
  await page.getByRole("button", { name: "Concluir tarefa" }).click();
  // Concluída: o formulário dá lugar ao quadro "Conclusão" com a área e a semana
  const conclusao = page.getByTestId("rh-conclusao");
  await expect(conclusao).toContainText("Manual", { timeout: 30_000 });
  await expect(conclusao).toContainText(`Pátio dos fundos (E2E ${sufixo})`);
  await expect(conclusao).toContainText("Balconista da Madeireira (Demonstração)");
  const { data: patio } = await servico!.from("rh_tarefas").select("status, origem_conclusao, concluida_por, area, semana_referencia, concluida_em").eq("id", tPatio).single();
  expect([patio!.status, patio!.origem_conclusao, patio!.concluida_por, patio!.area, patio!.semana_referencia]).toEqual([
    "concluida",
    "manual",
    idUsuarioBalcao,
    `Pátio dos fundos (E2E ${sufixo})`,
    segunda(hojeLocal()),
  ]);
  expect(patio!.concluida_em).toBeTruthy();
});

test("5: o fechamento do caixa conclui só a tarefa do dia, mesmo processado de novo", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/vender`);
  await page.getByLabel("Nome do caixa").fill(CAIXA);
  await page.getByLabel("Troco inicial na gaveta").fill("100,00");
  await page.getByRole("button", { name: "Abrir o caixa" }).click();
  await expect(page.getByLabel("Buscar produto")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/e/${empresaId}/loja/caixa`);
  await page.getByRole("button", { name: "Fechar o caixa" }).click();
  const esperado = (await page.getByRole("dialog").getByText(/^R\$\s?[\d.]+,\d{2}$/).first().innerText()).replace(/R\$\s?/, "");
  await page.getByLabel("Dinheiro contado").fill(esperado);
  await page.getByRole("dialog").getByRole("button", { name: "Fechar o caixa" }).click();
  await expect(page.getByText("Você não está com um caixa aberto")).toBeVisible({ timeout: 30_000 });

  const hoje = hojeLocal();
  const { data: s } = await servico!.from("caixa_sessoes").select("id, data, status").eq("empresa_id", empresaId).eq("caixa_nome", CAIXA).single();
  sessaoCaixa = s!.id;
  expect(s!.status).toBe("fechado");
  const tarefasCaixa = async () =>
    (await servico!.from("rh_tarefas").select("id, periodo_inicio, status, origem_conclusao").eq("modelo_id", modelo.fechamento_caixa.id)).data ?? [];
  const doDia = (await tarefasCaixa()).find((t) => t.periodo_inicio === hoje)!;
  expect([doDia.status, doDia.origem_conclusao]).toEqual(["concluida", "automatica"]);
  // Outras tarefas de caixa (outros dias) seguem abertas
  expect((await tarefasCaixa()).filter((t) => t.periodo_inicio < hoje && !tarefasAntes.has(t.id) && t.status === "concluida")).toEqual([]);

  // Processa de novo (gestor): nada duplica
  const dono = createClient(URL_SUPA, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, { auth: { persistSession: false } });
  const { error: eLogin } = await dono.auth.signInWithPassword({ email: `madeireira@${DOMINIO}`, password: SENHA });
  expect(eLogin).toBeNull();
  const { error: eRe } = await dono.rpc("rh_reprocessar_caixa", { p_sessao_id: sessaoCaixa });
  expect(eRe).toBeNull();
  const { count: vinculos } = await servico!.from("rh_tarefa_vinculos").select("id", { count: "exact", head: true }).eq("registro_id", sessaoCaixa).eq("situacao", "confirmado");
  expect(vinculos).toBe(1);
  const { count: conclusoes } = await servico!.from("rh_tarefa_eventos").select("id", { count: "exact", head: true }).eq("tarefa_id", doDia.id).eq("tipo", "concluida");
  expect(conclusoes).toBe(1);

  // No quadro: concluída automaticamente, com o caixa ligado
  await page.goto(`/e/${empresaId}/rh/tarefas/${doDia.id}`);
  await expect(page.getByTestId("rh-conclusao")).toContainText("Automática (registro do sistema)");
  await expect(page.getByTestId("rh-registros")).toContainText(`${CAIXA} fechado em`);
});

test("6: a tarefa semanal gera a próxima semana sem mexer na conclusão da anterior", async ({ page }) => {
  test.setTimeout(240_000);
  const semana = segunda(hojeLocal());
  const proxima = new Date(`${semana}T12:00:00Z`);
  proxima.setUTCDate(proxima.getUTCDate() + 7);
  const proximaIso = proxima.toISOString().slice(0, 10);
  const { data: antes } = await servico!.from("rh_tarefas").select("status, concluida_em, area").eq("id", tPatio).single();
  // A rotina diária roda duas vezes: sem duplicar e sem mexer na semana concluída
  for (let i = 0; i < 2; i++) expect((await servico!.rpc("rotina_rh_tarefas")).error).toBeNull();
  const { data: patios } = await servico!.from("rh_tarefas").select("id, periodo_inicio, status, responsavel_id").eq("modelo_id", modelo.organizacao_patio.id).in("periodo_inicio", [semana, proximaIso]);
  expect(patios!.map((p) => [p.periodo_inicio, p.status]).sort()).toEqual([
    [semana, "concluida"],
    [proximaIso, "a_fazer"],
  ]);
  // A próxima vai para a pessoa do cargo (o Pedro, único auxiliar de pátio)
  expect(patios!.find((p) => p.periodo_inicio === proximaIso)!.responsavel_id).toBe(idPedro);
  const { data: depois } = await servico!.from("rh_tarefas").select("status, concluida_em, area").eq("id", tPatio).single();
  expect(depois).toEqual(antes);

  // No quadro do gestor: a semana seguinte em "A fazer" e a anterior em "Concluída"
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/rh/tarefas`);
  const [a, m, d] = proximaIso.split("-");
  await expect(page.locator('[data-coluna="a_fazer"]').getByTestId("cartao-tarefa").filter({ hasText: "Organização do pátio" }).filter({ hasText: `Semana de ${d}/${m}` })).toHaveCount(1, {
    timeout: 60_000,
  });
  expect(a).toBeTruthy();
  await expect(page.locator('[data-coluna="concluida"]').getByTestId("cartao-tarefa").filter({ hasText: "Organização do pátio" })).toHaveCount(1);
  // Filtro por periodicidade e por funcionário
  await page.getByLabel("Filtrar por periodicidade").selectOption("diaria");
  await expect(page.getByTestId("cartao-tarefa").filter({ hasText: "Organização do pátio" })).toHaveCount(0);
  await page.getByLabel("Filtrar por periodicidade").selectOption("semanal");
  await page.getByLabel("Filtrar por funcionário").selectOption(idPedro);
  await expect(page.locator('[data-coluna="a_fazer"]').getByTestId("cartao-tarefa").filter({ hasText: "Organização do pátio" })).toHaveCount(1);
});
