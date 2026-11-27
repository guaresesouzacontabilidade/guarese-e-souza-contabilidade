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

test("confirmação pelo WhatsApp da clínica no modo teste: fila do envio e resposta do paciente pelo link", async ({ browser }) => {
  test.setTimeout(180_000);
  const base = `/e/${empresaId}/fisioterapia`;
  const NUMERO_TESTE = "63988880000";
  const { data: antes } = await servico!.from("fisio_config").select("*").eq("empresa_id", empresaId).single();
  const { data: pac } = await servico!
    .from("fisio_pacientes")
    .insert({ empresa_id: empresaId, nome: `Paciente WhatsApp E2E ${Date.now().toString(36)} (fictício)`, telefone: "63977776666", aceita_whatsapp: true })
    .select("id")
    .single();
  const agora = Date.now();
  const fimDoDia = new Date(`${hoje()}T23:50:00-03:00`).getTime();
  const inicioHoje = new Date(Math.min(agora + 2 * 3600_000, Math.max(fimDoDia, agora + 5 * 60_000))).toISOString();
  const amanha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date(agora + 86400_000));
  const criados: string[] = [];
  try {
    // A dona liga a confirmação no modo teste, com o número de teste
    const dona = await browser.newPage();
    await entrar(dona, `fisioterapia@${DOMINIO}`);
    await dona.goto(`${base}/configuracoes`);
    await dona.getByLabel("Ligar a confirmação pelo WhatsApp").check();
    await dona.getByLabel("Phone Number ID").fill("123456789012345");
    await dona.getByLabel("Nome do modelo aprovado").fill("confirmacao_atendimento");
    await expect(dona.getByLabel(/Modo teste/)).toBeChecked();
    await dona.getByLabel("Número de teste (celular com DDD)").fill("(63) 98888-0000");
    await dona.getByRole("button", { name: "Salvar confirmação pelo WhatsApp" }).click();
    await expect(dona.getByText("Configuração do WhatsApp salva.").first()).toBeVisible({ timeout: 30_000 });
    await dona.reload();
    await expect(dona.getByTestId("situacao-whatsapp-clinica")).toContainText("Modo teste");

    // Atendimento de hoje: entra sozinho na fila, para o número de teste
    const { data: h } = await servico!.from("fisio_agenda").insert({ empresa_id: empresaId, inicio: inicioHoje, paciente_id: pac!.id }).select("id").single();
    criados.push(h!.id);
    const { data: env } = await servico!.from("envios").select("destinatario").eq("referencia_id", h!.id).single();
    expect(env!.destinatario).toBe(NUMERO_TESTE);
    await dona.goto(`${base}/agenda?dia=${hoje()}`);
    await expect(dona.getByTestId("situacao-confirmacao").filter({ hasText: "número de teste" }).first()).toBeVisible();

    // Atendimento de amanhã: a recepção manda na hora pelo botão (vai para o número de teste)
    const { data: a2 } = await servico!
      .from("fisio_agenda")
      .insert({ empresa_id: empresaId, inicio: new Date(`${amanha}T09:00:00-03:00`).toISOString(), paciente_id: pac!.id })
      .select("id")
      .single();
    criados.push(a2!.id);
    const recepcao = await browser.newPage();
    await entrar(recepcao, `recepcao.fisio@${DOMINIO}`);
    await recepcao.goto(`${base}/agenda?dia=${amanha}`);
    const linha = recepcao.locator("li").filter({ hasText: "Paciente WhatsApp E2E" });
    await linha.getByRole("button", { name: "Enviar confirmação (teste)" }).click();
    await expect(recepcao.getByText(/Confirmação na fila do WhatsApp/).first()).toBeVisible({ timeout: 30_000 });
    const { data: env2 } = await servico!.from("envios").select("destinatario").eq("referencia_id", a2!.id).single();
    expect(env2!.destinatario).toBe(NUMERO_TESTE);

    // O paciente abre o link (sem login): confirma hoje e desmarca amanhã
    const { data: cods } = await servico!.from("fisio_agenda").select("id, confirmacao_codigo").in("id", criados);
    const codigo = (id: string) => cods!.find((c) => c.id === id)!.confirmacao_codigo as string;
    const anonimo = await browser.newContext();
    const p = await anonimo.newPage();
    await p.goto(`/confirmar/${codigo(h!.id)}`);
    await expect(p.getByTestId("confirmacao-paciente")).toContainText("Olá, Paciente!");
    await expect(p.locator("body")).not.toContainText("97777");
    await p.getByRole("button", { name: "Confirmar presença" }).click();
    await expect(p.getByText("Presença confirmada. Até logo!")).toBeVisible();
    await p.goto(`/confirmar/${codigo(a2!.id)}`);
    await p.getByRole("button", { name: "Não vou poder ir" }).click();
    await p.getByLabel(/motivo/).fill("Consulta médica no mesmo horário");
    await p.getByRole("button", { name: "Desmarcar horário" }).click();
    await expect(p.getByText(/Este horário foi desmarcado/)).toBeVisible();
    await anonimo.close();

    // A agenda mostra a resposta; a recepção foi avisada de quem desmarcou
    await dona.goto(`${base}/agenda?dia=${hoje()}`);
    await expect(dona.getByTestId("confirmou-whatsapp").first()).toBeVisible();
    const { data: fim } = await servico!.from("fisio_agenda").select("id, status, confirmacao_resposta").in("id", criados);
    expect(fim!.find((f) => f.id === h!.id)).toMatchObject({ status: "confirmado", confirmacao_resposta: "confirmou" });
    expect(fim!.find((f) => f.id === a2!.id)).toMatchObject({ status: "cancelado", confirmacao_resposta: "desmarcou" });
    const { count } = await servico!.from("notificacoes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("tipo", "fisio_desmarcou");
    expect(count).toBeGreaterThan(0);
  } finally {
    // Limpa o que o teste criou e devolve a configuração da clínica
    if (criados.length) {
      const { data: envs } = await servico!.from("envios").select("id").in("referencia_id", criados);
      for (const e of envs ?? []) await servico!.from("jobs").delete().eq("chave_idempotencia", `envio:${e.id}`);
      await servico!.from("envios").delete().in("referencia_id", criados);
      await servico!.from("fisio_agenda").delete().in("id", criados);
    }
    await servico!.from("notificacoes").delete().eq("empresa_id", empresaId).eq("tipo", "fisio_desmarcou");
    if (pac) await servico!.from("fisio_pacientes").delete().eq("id", pac.id);
    await servico!
      .from("fisio_config")
      .update({
        whatsapp_ativo: antes!.whatsapp_ativo,
        whatsapp_phone_number_id: antes!.whatsapp_phone_number_id,
        whatsapp_modelo: antes!.whatsapp_modelo,
        whatsapp_modo_teste: antes!.whatsapp_modo_teste,
        whatsapp_numero_teste: antes!.whatsapp_numero_teste,
      })
      .eq("empresa_id", empresaId);
  }
});
