import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Hotel (hotel fictício da demonstração):
 *  - a recepção faz a reserva de um hóspede novo com check-in na hora, lança
 *    consumo do frigobar, recebe e faz o check-out (a conta fecha, o
 *    pagamento vai para o Financeiro e o quarto vai para a limpeza);
 *  - a recepção lança serviço extra (quantidade × preço do cadastro) e anota
 *    uma observação sobre o hóspede no check-out;
 *  - a ficha do hóspede sai em PDF com a identidade do hotel; a recepção não vê os relatórios;
 *  - o dono cadastra serviço extra e escolhe o modelo e a cor dos documentos;
 *  - sem serviço extra em uso, o dono vê as sugestões para o primeiro cadastro;
 *  - a recepção lança serviços extras para uma empresa (pago na hora e a
 *    prazo), cada um com recibo em PDF, e só o dono cancela o recibo;
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
let anexoId = "";

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

  // Serviço extra com preço fixo: 2 marmitas (a recepção só informa a quantidade)
  await page.locator('a[href*="/hotel/extras?reserva="]').click();
  await page.waitForURL(/\/hotel\/extras\?reserva=/);
  await page.getByRole("button", { name: "Mais Marmita", exact: true }).click();
  await page.getByRole("button", { name: "Mais Marmita", exact: true }).click();
  await expect(page.getByLabel(/Preço de Marmita/)).toHaveCount(0);
  await page.getByRole("button", { name: "Lançar na conta do quarto" }).click();
  await expect(page.getByText(/serviço\(s\) lançado\(s\) na conta do quarto/)).toBeVisible({ timeout: 30_000 });
  const { data: extras } = await servico!.from("hotel_conta_itens").select("descricao, setor, quantidade, valor_unitario, total").eq("reserva_id", reservaId).not("extra_id", "is", null);
  expect(extras).toEqual([{ descricao: "Marmita", setor: "alimentacao", quantidade: 2, valor_unitario: 22, total: 44 }]);
  await page.goto(`/e/${empresaId}/hotel/reservas/${reservaId}`);
  await expect(page.getByRole("cell", { name: /Marmita/ })).toBeVisible();

  // Check-out com saldo: o portal não deixa
  // (recebe o valor sugerido, que é o saldo da conta, e fecha)
  // (recebe o valor sugerido no PIX, com a foto do comprovante)
  await page.getByRole("button", { name: "Receber pagamento" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByLabel("Valor")).not.toHaveValue("");
  await dialogo.locator('input[aria-label="Escolher arquivo do comprovante"]').setInputFiles("scripts/arquivos-demo/comprovante-pix-demo.png");
  await expect(dialogo.getByText("comprovante-pix-demo.png")).toBeVisible();
  await dialogo.getByRole("button", { name: "Registrar" }).click();
  await expect(dialogo).toBeHidden({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Comprovante", exact: true })).toBeVisible();
  // Check-out com uma observação sobre o hóspede (fica no cadastro dele)
  await page.getByRole("button", { name: "Check-out" }).click();
  await page.getByRole("dialog").getByLabel("Observações sobre o hóspede").fill("Pediu a nota no nome da empresa. (teste automático)");
  await page.getByRole("button", { name: "Fazer check-out" }).click();
  await expect(page.getByText("Encerrada", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const { data: hosp } = await servico!.from("hotel_reservas").select("hospede:hotel_hospedes!hotel_reservas_empresa_id_hospede_id_fkey(observacoes)").eq("id", reservaId).single();
  expect((hosp as unknown as { hospede: { observacoes: string } }).hospede.observacoes).toBe("Pediu a nota no nome da empresa. (teste automático)");

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

  // O comprovante ficou guardado (confirmado, na pasta da empresa) e abre para a recepção
  const { data: pags } = await servico!.from("hotel_pagamentos").select("id").eq("reserva_id", reservaId);
  const { data: anexos } = await servico!
    .from("hotel_pagamento_anexos")
    .select("id, caminho, mime, confirmado_em")
    .in(
      "pagamento_id",
      (pags ?? []).map((p) => p.id),
    );
  expect(anexos!.length).toBe(1);
  expect(anexos![0].confirmado_em).not.toBeNull();
  expect(anexos![0].caminho.startsWith(`${empresaId}/`)).toBe(true);
  anexoId = anexos![0].id;
  const arquivo = await page.request.get(`/api/hotel/${empresaId}/comprovantes/${anexoId}`);
  expect(arquivo.status()).toBe(200);
  expect(arquivo.headers()["content-type"]).toContain("image/png");

  // No caixa da recepção: os recebimentos do hotel com o comprovante (e o aviso de quem está sem)
  await page.goto(`/e/${empresaId}/loja/caixa`);
  await expect(page.getByText("Recebimentos do hotel")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Comprovante/ }).first()).toBeVisible();
  await expect(page.getByText("Sem comprovante").first()).toBeVisible();

  // Ficha do hóspede em PDF; a recepção não vê os relatórios
  const ficha = await page.request.get(`/api/hotel/${empresaId}/reservas/${reservaId}?doc=ficha`);
  expect(ficha.status()).toBe(200);
  expect(ficha.headers()["content-type"]).toContain("application/pdf");
  // Documento do hotel (só a identidade do hotel), também na prévia de outro modelo e cor
  const recibo = await page.request.get(`/api/hotel/${empresaId}/reservas/${reservaId}?doc=conta&modelo=faixa&cor=%237a1f2b`);
  expect(recibo.status()).toBe(200);
  const bruto = (await recibo.body()).toString("latin1");
  expect(bruto).toContain("(Hotel Rio Tocantins \\(DEMO\\))");
  expect(bruto).not.toMatch(/Guarese/i);
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
  if (anexoId) expect((await page.request.get(`/api/hotel/${empresaId}/comprovantes/${anexoId}`, { maxRedirects: 0 })).status()).toBe(403);
});

test("dono: cadastra um serviço extra e escolhe o modelo e a cor dos documentos do hotel", async ({ page }) => {
  test.setTimeout(120_000);
  await servico!.from("hotel_extras").delete().eq("empresa_id", empresaId).like("nome", "Transfer teste %");
  const { data: antes } = await servico!.from("hotel_config").select("doc_modelo, doc_cor, doc_whatsapp").eq("empresa_id", empresaId).single();
  await entrar(page, `hotel@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel/extras`);
  await page.getByRole("button", { name: "Novo serviço" }).click();
  const dialogo = page.getByRole("dialog");
  const nome = `Transfer teste ${Date.now() % 100000}`;
  await dialogo.locator("#ex-nome").fill(nome);
  await dialogo.locator("#ex-natureza").selectOption("outro");
  await dialogo.locator("#ex-unidade").selectOption("uso");
  await dialogo.locator("#ex-preco").fill("50");
  await dialogo.getByRole("button", { name: "Salvar serviço" }).click();
  await expect(page.getByText(`${nome} cadastrado.`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: nome, exact: true })).toBeVisible();
  const { data: novo } = await servico!.from("hotel_extras").select("natureza, unidade, preco").eq("empresa_id", empresaId).eq("nome", nome).single();
  expect(novo).toEqual({ natureza: "outro", unidade: "uso", preco: 50 });

  await page.goto(`/e/${empresaId}/hotel/configuracoes`);
  await page.getByRole("button", { name: /Faixa colorida/ }).click();
  await page.getByRole("button", { name: "Cor Vinho" }).click();
  await page.locator("#doc-whatsapp").fill("(63) 98888-0000");
  await page.getByRole("button", { name: "Salvar documentos" }).click();
  await expect(page.getByText("Documentos do hotel atualizados.")).toBeVisible({ timeout: 30_000 });
  const { data: cfg } = await servico!.from("hotel_config").select("doc_modelo, doc_cor, doc_whatsapp").eq("empresa_id", empresaId).single();
  expect(cfg).toEqual({ doc_modelo: "faixa", doc_cor: "#7a1f2b", doc_whatsapp: "(63) 98888-0000" });

  // A demonstração volta como estava
  await servico!.from("hotel_config").update(antes!).eq("empresa_id", empresaId);
  await servico!.from("hotel_extras").delete().eq("empresa_id", empresaId).like("nome", "Transfer teste %");
});

test("recepção: lança serviços extras para uma empresa, com recibo; o dono cancela", async ({ page }) => {
  test.setTimeout(180_000);
  const CNPJ = "11222333000181";
  const nomeEmpresa = "EMPRESA TESTE AUTOMÁTICO LTDA";
  await entrar(page, `recepcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel/extras`);
  await page.getByRole("radio", { name: "Empresa" }).click();

  // Cadastro rápido da empresa (sem a consulta à Receita, que depende de rede)
  await page.getByRole("button", { name: "Cadastrar empresa" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#emp-doc").fill("11.222.333/0001-81");
  await dialogo.locator("#emp-nome").fill(nomeEmpresa);
  await dialogo.getByRole("button", { name: "Salvar empresa" }).click();
  await expect(page.getByText("Empresa cadastrada.")).toBeVisible({ timeout: 30_000 });
  const { data: contra } = await servico!.from("contrapartes").select("id").eq("empresa_id", empresaId).eq("documento", CNPJ).single();
  await expect(page.locator("#ex-empresa")).toHaveValue(contra!.id);

  // 1. Três marmitas pagas na hora no PIX
  await page.getByRole("button", { name: "Mais Marmita", exact: true }).click();
  await page.getByRole("button", { name: "Mais Marmita", exact: true }).click();
  await page.getByRole("button", { name: "Mais Marmita", exact: true }).click();
  await page.locator("#ex-solicitante").fill("Encarregado Teste");
  await page.locator("#ex-forma").selectOption("pix");
  await page.getByRole("button", { name: "Lançar e gerar recibo" }).click();
  await expect(page.getByText(/^Recibo nº \d+ gerado$/).first()).toBeVisible({ timeout: 30_000 });
  const { data: rec1 } = await servico!
    .from("hotel_extras_recibos")
    .select("id, numero, total, pagamento, forma, solicitante, lancamento:lancamentos!hotel_extras_recibos_empresa_id_lancamento_id_fkey(situacao)")
    .eq("contraparte_id", contra!.id)
    .order("numero", { ascending: false })
    .limit(1)
    .single();
  expect({ total: rec1!.total, pagamento: rec1!.pagamento, forma: rec1!.forma, solicitante: rec1!.solicitante }).toEqual({
    total: 66,
    pagamento: "na_hora",
    forma: "pix",
    solicitante: "Encarregado Teste",
  });
  expect((rec1!.lancamento as unknown as { situacao: string }).situacao).toBe("quitado");

  // O recibo sai em PDF com a identidade do hotel
  const href = await page.getByRole("link", { name: "Abrir o recibo (PDF)" }).getAttribute("href");
  expect(href).toBe(`/api/hotel/${empresaId}/recibos/${rec1!.id}`);
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).toString("latin1")).toContain("(Hotel Rio Tocantins \\(DEMO\\))");

  // 2. Lavanderia a prazo (conta a receber da empresa)
  await page.locator("#ex-empresa").selectOption(contra!.id);
  await page.getByRole("button", { name: "Mais Lavanderia (por peça)", exact: true }).click();
  await page.getByRole("radio", { name: "Vai pagar depois (a prazo)" }).check();
  await expect(page.locator("#ex-vencimento")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole("button", { name: "Lançar e gerar recibo" }).click();
  await expect(page.getByText(`Recibo nº ${Number(rec1!.numero) + 1} gerado`).first()).toBeVisible({ timeout: 30_000 });
  const { data: rec2 } = await servico!
    .from("hotel_extras_recibos")
    .select("id, numero, pagamento, vencimento, lancamento_id")
    .eq("contraparte_id", contra!.id)
    .eq("numero", Number(rec1!.numero) + 1)
    .single();
  expect(rec2!.pagamento).toBe("a_prazo");
  expect(rec2!.vencimento).not.toBeNull();

  // Na lista do mês: a recepção vê os dois, sem o botão de cancelar
  const linha2 = page.getByRole("row", { name: new RegExp(`Nº ${rec2!.numero}\\b`) });
  await expect(linha2).toContainText(nomeEmpresa);
  await expect(linha2).toContainText("A receber");
  await expect(page.getByRole("button", { name: `Cancelar o recibo nº ${rec2!.numero}` })).toHaveCount(0);

  // 3. O dono cancela o recibo a prazo: o Financeiro é cancelado junto
  await page.context().clearCookies();
  await entrar(page, `hotel@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel/extras`);
  await page.getByRole("button", { name: `Cancelar o recibo nº ${rec2!.numero}` }).click();
  await page.getByRole("dialog").locator(`#cr-${rec2!.id}`).fill("Lançado para a empresa errada (teste)");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar recibo" }).click();
  await expect(page.getByText("Recibo cancelado (o lançamento do Financeiro foi cancelado junto).")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("row", { name: new RegExp(`Nº ${rec2!.numero}\\b`) })).toContainText("Cancelado");
  const { data: lanc } = await servico!.from("lancamentos").select("situacao").eq("id", rec2!.lancamento_id!).single();
  expect(lanc!.situacao).toBe("cancelado");
});

test("dono: hotel sem serviço extra em uso vê as sugestões (a página abre)", async ({ page }) => {
  test.setTimeout(120_000);
  const { data: emUso } = await servico!.from("hotel_extras").select("id").eq("empresa_id", empresaId).eq("ativo", true);
  const ids = (emUso ?? []).map((e) => e.id);
  await servico!.from("hotel_extras").update({ ativo: false }).in("id", ids);
  try {
    await entrar(page, `hotel@${DOMINIO}`);
    await page.goto(`/e/${empresaId}/hotel/extras`);
    await expect(page.getByText(/Cadastre os serviços que o hotel cobra à parte/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Não foi possível carregar esta página")).toHaveCount(0);
    await page.getByRole("button", { name: "Lavanderia (por peça)", exact: true }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.locator("#ex-nome")).toHaveValue("Lavanderia (por peça)");
    await expect(dialogo.locator("#ex-natureza")).toHaveValue("lavanderia");
    await expect(dialogo.locator("#ex-unidade")).toHaveValue("peca");
  } finally {
    // A demonstração volta como estava
    await servico!.from("hotel_extras").update({ ativo: true }).in("id", ids);
  }
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

test("planilhas dos serviços extras do dia e do mês (conta do quarto e empresas)", async ({ page }) => {
  test.setTimeout(120_000);
  const ExcelJS = (await import("exceljs")).default;
  await entrar(page, `recepcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel/extras`);
  await expect(page.getByRole("button", { name: "Planilha do dia" })).toBeVisible();
  const ler = async (url: string) => {
    const r = await page.request.get(url);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.body()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Serviços extras")!;
    const origens = new Set<string>();
    ws.eachRow((row, n) => {
      if (n > 6) origens.add(String(row.getCell(3).value ?? ""));
    });
    return { origens, resumo: wb.getWorksheet("Resumo") };
  };
  const mes = hojeLocal().slice(0, 7);
  const doMes = await ler(`/api/hotel/${empresaId}/extras/planilha?mes=${mes}`);
  expect(doMes.origens.has("Empresa")).toBe(true);
  expect(doMes.origens.has("Conta do quarto")).toBe(true);
  expect(doMes.resumo).toBeTruthy();
  const doDia = await ler(`/api/hotel/${empresaId}/extras/planilha?dia=${hojeLocal()}`);
  expect(doDia.origens.size).toBeGreaterThan(0);
  expect((await page.request.get(`/api/hotel/${empresaId}/extras/planilha`)).status()).toBe(400);
});

test("caixa do turno: abre com o nome do turno, mostra o movimento, gera os relatórios e fecha", async ({ page }) => {
  test.setTimeout(180_000);
  const turno = `Turno teste ${Date.now() % 100000}`;
  await entrar(page, `hotel@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/hotel/caixa`);
  if (await page.getByRole("heading", { name: "Abrir o turno" }).isVisible()) {
    await page.locator("#caixa_nome").fill(turno);
    await page.locator("#valor_abertura").fill("100");
    await page.getByRole("button", { name: "Abrir o turno" }).click();
  }
  await expect(page.getByText("O que aconteceu no hotel durante o turno")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Dinheiro na gaveta (esperado)")).toBeVisible();

  // Um serviço extra para empresa, pago em dinheiro, entra no movimento e na gaveta do turno
  await page.goto(`/e/${empresaId}/hotel/extras`);
  await page.getByRole("radio", { name: "Empresa" }).click();
  const { data: empresa } = await servico!.from("contrapartes").select("id").eq("empresa_id", empresaId).ilike("nome", "CONSTRUTORA%").limit(1).single();
  await page.locator("#ex-empresa").selectOption(empresa!.id);
  await page.getByRole("button", { name: "Mais Marmita", exact: true }).click();
  await page.locator("#ex-forma").selectOption("dinheiro");
  await page.getByRole("button", { name: "Lançar e gerar recibo" }).click();
  await expect(page.getByText(/^Recibo nº \d+ gerado$/).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`/e/${empresaId}/hotel/caixa`);
  await expect(page.getByRole("cell", { name: /Recibo de empresa/ }).first()).toBeVisible();
  const { data: sessao } = await servico!
    .from("caixa_sessoes")
    .select("id, caixa_nome")
    .eq("empresa_id", empresaId)
    .eq("status", "aberto")
    .order("aberto_em", { ascending: false })
    .limit(1)
    .single();
  const pdf = await page.request.get(`/api/hotel/${empresaId}/turnos/${sessao!.id}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const dia = await page.request.get(`/api/hotel/${empresaId}/relatorio-dia?data=${hojeLocal()}`);
  expect(dia.status()).toBe(200);
  expect(dia.headers()["content-type"]).toContain("application/pdf");

  // Fecha o turno contando o dinheiro esperado (o que a tela mostra)
  const texto = await page.getByText("Dinheiro na gaveta (esperado)").locator("../..").innerText();
  const esperado = /R\$\s*([\d.]+,\d{2})/.exec(texto)![1].replace(/\./g, "");
  await page.getByRole("button", { name: "Fechar o caixa" }).click();
  await page.getByLabel("Dinheiro contado").fill(esperado);
  await page.getByRole("dialog").getByRole("button", { name: "Fechar o caixa" }).click();
  await expect(page.getByRole("heading", { name: "Abrir o turno" })).toBeVisible({ timeout: 30_000 });
  // O turno fechado aparece nos turnos de hoje (o nome pode ser de uma execução interrompida antes)
  await expect(page.getByRole("cell", { name: sessao!.caixa_nome })).toBeVisible();
});
