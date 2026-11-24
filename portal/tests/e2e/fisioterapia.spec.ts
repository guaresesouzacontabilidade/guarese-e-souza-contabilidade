import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Clínica de fisioterapia (dados fictícios da demonstração, Clínica Movimento):
 *  - a recepção cadastra o paciente (com o consentimento LGPD), agenda a sessão
 *    com repetição e registra o recebimento (que vai para o Financeiro), mas
 *    não vê o prontuário;
 *  - a fisioterapeuta abre a evolução pela agenda, preenche o SOAP e finaliza:
 *    o registro sai assinado com o nome e o CREFITO e a sessão vira realizada;
 *  - a equipe do escritório não lê o prontuário.
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
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
let pacienteId = "";
const NOME = `Paciente E2E ${Date.now().toString(36)} (fictício)`;

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").ilike("razao_social", "CLINICA MOVIMENTO%").single();
  empresaId = data!.id;
});

// O prontuário não se apaga: o paciente de teste fica inativo e os horários dele, cancelados
test.afterAll(async () => {
  if (!pacienteId) return;
  await servico!.from("fisio_agenda").update({ status: "cancelado", motivo: "Teste automático (E2E)" }).eq("paciente_id", pacienteId);
  await servico!.from("fisio_pacientes").update({ ativo: false }).eq("id", pacienteId);
});

test("recepção cadastra e agenda; fisioterapeuta evolui e assina; prontuário sigiloso", async ({ browser }) => {
  test.setTimeout(240_000);
  const base = `/e/${empresaId}/fisioterapia`;

  // 1. Recepção: cadastro com consentimento, agenda com repetição e recebimento
  const recepcao = await browser.newPage();
  await entrar(recepcao, `recepcao.fisio@${DOMINIO}`);
  await recepcao.goto(`${base}/pacientes`);
  await recepcao.getByRole("button", { name: "Novo paciente" }).click();
  const cad = recepcao.getByRole("dialog");
  await cad.getByLabel("Nome completo").fill(NOME);
  await cad.getByLabel("Telefone (WhatsApp)").fill("(63) 99999-0101");
  await cad.getByLabel(/autorizou o uso dos dados de saúde/).check();
  await cad.getByRole("button", { name: "Cadastrar" }).click();
  await recepcao.waitForURL(/\/fisioterapia\/pacientes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  pacienteId = recepcao.url().split("/").pop()!;
  await expect(recepcao.getByText("Prontuário sigiloso: só os fisioterapeutas da clínica leem.")).toBeVisible();

  await recepcao.getByRole("button", { name: "Agendar" }).first().click();
  const ag = recepcao.getByRole("dialog");
  await ag.getByLabel("Fisioterapeuta").selectOption({ label: "Camila Rocha Veloso (fictícia)" });
  await ag.getByLabel("Tipo").selectOption("sessao");
  await ag.getByLabel("Primeiro dia").fill(hoje());
  await ag.getByLabel("Hora").fill("06:00");
  await ag.getByRole("button", { name: "Agendar" }).click();
  await expect(recepcao.getByText(/Agendado\.|horários agendados/).first()).toBeVisible({ timeout: 30_000 });
  const { data: agenda } = await servico!.from("fisio_agenda").select("id, status").eq("paciente_id", pacienteId);
  expect(agenda?.length).toBe(1);

  await recepcao.getByRole("button", { name: "Receber" }).click();
  const rec = recepcao.getByRole("dialog");
  await rec.getByLabel("Valor (R$)").fill("120,00");
  await rec.getByRole("button", { name: "Registrar" }).click();
  await expect(recepcao.getByText("Recebimento registrado e lançado no Financeiro.").first()).toBeVisible({ timeout: 30_000 });
  const { data: recebido } = await servico!.from("fisio_recebimentos").select("valor, lancamento:lancamentos(origem)").eq("paciente_id", pacienteId).single();
  expect(Number(recebido!.valor)).toBe(120);
  expect((recebido!.lancamento as unknown as { origem: string }).origem).toBe("fisioterapia");

  // 2. Fisioterapeuta: evolução pela agenda, finalizada com nome e CREFITO
  const fisio = await browser.newPage();
  await entrar(fisio, `fisioterapia@${DOMINIO}`);
  await fisio.goto(`${base}/agenda?dia=${hoje()}`);
  const linha = fisio.locator("li", { hasText: NOME });
  await linha.getByRole("button", { name: "Evoluir" }).click();
  await fisio.waitForURL(/\/fisioterapia\/evolucoes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await fisio.getByLabel("Dor antes da sessão").fill("6");
  await fisio.getByLabel("Dor depois da sessão").fill("3");
  await fisio.getByLabel(/S — Subjetivo/).fill("Relata dor ao subir escadas (E2E).");
  await fisio.getByLabel(/O — Objetivo/).fill("Flexão do joelho 110° (E2E).");
  await fisio.getByLabel(/A — Avaliação/).fill("Boa resposta à conduta (E2E).");
  await fisio.getByLabel(/P — Plano/).fill("Progredir o fortalecimento (E2E).");
  await fisio.getByLabel("TENS", { exact: true }).check();
  await fisio.getByRole("button", { name: "Finalizar e assinar" }).click();
  await expect(fisio.getByText(/Finalizado em .* CREFITO-11 nº DEMO-201-F/)).toBeVisible({ timeout: 30_000 });
  const { data: ev } = await servico!.from("fisio_evolucoes").select("status, dor_antes, dor_depois, condutas").eq("paciente_id", pacienteId).single();
  expect(ev).toMatchObject({ status: "finalizada", dor_antes: 6, dor_depois: 3, condutas: ["TENS"] });
  const { data: sessao } = await servico!.from("fisio_agenda").select("status").eq("paciente_id", pacienteId).single();
  expect(sessao!.status).toBe("realizado");
  // Na ficha, o gráfico e o prontuário aparecem para a fisioterapeuta
  await fisio.goto(`${base}/pacientes/${pacienteId}`);
  await expect(fisio.getByRole("link", { name: /Evolução nº \d+/ })).toBeVisible();

  // 3. A recepção continua sem ler o prontuário (nem pelo endereço da evolução)
  await recepcao.goto(`${base}/pacientes/${pacienteId}`);
  await expect(recepcao.getByText("Relata dor ao subir escadas (E2E).")).toHaveCount(0);
  const { data: evId } = await servico!.from("fisio_evolucoes").select("id").eq("paciente_id", pacienteId).single();
  await recepcao.goto(`${base}/evolucoes/${evId!.id}`);
  await expect(recepcao.getByText("Prontuário sigiloso")).toBeVisible();
  await expect(recepcao.getByText("Relata dor ao subir escadas (E2E).")).toHaveCount(0);

  // 4. A equipe do escritório não lê o prontuário
  const contador = await browser.newPage();
  await entrar(contador, `contador@${DOMINIO}`);
  await contador.goto(`${base}/pacientes/${pacienteId}`);
  await expect(contador.getByText("Relata dor ao subir escadas (E2E).")).toHaveCount(0);
});
