import { test, expect, type Page } from "@playwright/test";
import forge from "node-forge";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/**
 * Notas automáticas: o empresário cadastra o certificado A1 (gerado na hora,
 * fictício, com o CNPJ da Padaria de demonstração), vê a situação e remove.
 * Neste ambiente as consultas fiscais ficam desligadas
 * (NOTAS_AUTOMATICAS_SEM_REDE=1): nada é enviado à SEFAZ.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";

/** Mês (AAAA-MM) somado de n meses ao mês de hoje, no fuso do escritório. */
function mes(n: number) {
  const [a, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date()).split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function clienteServico() {
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

function pfx(cn: string, senha: string) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs8", format: "pem" }).toString()) as forge.pki.rsa.PrivateKey;
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.setRsaPublicKey(chave.n, chave.e);
  c.serialNumber = "01" + randomBytes(6).toString("hex");
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  c.setSubject([{ name: "commonName", value: cn }]);
  c.setIssuer([{ name: "commonName", value: "AC DE TESTE (FICTICIA)" }]);
  c.sign(chave, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(chave, [c], senha, { algorithm: "3des" })).getBytes();
  return Buffer.from(der, "binary");
}

test("empresário cadastra o certificado A1, vê a situação e remove", async ({ page, browser }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = page.url().match(/\/e\/[0-9a-f-]{36}/)![0];
  await page.goto(`${empresa}/notas-automaticas`);
  await expect(page.getByRole("heading", { name: "Notas automáticas" })).toBeVisible();
  await expect(page.getByText("Consultas desligadas neste ambiente")).toBeVisible();
  // Sobra de uma execução interrompida: remove antes de começar
  if (await page.getByRole("button", { name: "Remover certificado" }).isVisible()) {
    await page.getByRole("button", { name: "Remover certificado" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remover certificado" }).click();
    await expect(page.getByText(/Certificado removido/)).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.getByText("Desconectada", { exact: true })).toBeVisible();

  const enviar = async (arquivo: Buffer, senha: string) => {
    await page.setInputFiles("#cert-arquivo", { name: "certificado.pfx", mimeType: "application/x-pkcs12", buffer: arquivo });
    await page.fill("#cert-senha", senha);
    await page.getByRole("button", { name: "Cadastrar certificado" }).click();
  };

  // O mês inicial vem marcado: o mês anterior, ou o que a empresa já tinha escolhido
  const servico = clienteServico();
  let mesAtualDaEmpresa = mes(-1);
  let empresaId = "";
  if (servico) {
    const { data: emp } = await servico.from("empresas").select("id").eq("documento", "11222333000181").single();
    empresaId = emp!.id;
    const { data: cfg } = await servico.from("notas_automaticas").select("buscar_desde").eq("empresa_id", empresaId).maybeSingle();
    if (cfg?.buscar_desde) mesAtualDaEmpresa = cfg.buscar_desde.slice(0, 7);
  }
  await expect(page.locator("#cert-desde")).toHaveValue(mesAtualDaEmpresa);

  // Sem autorização, senha errada e CNPJ de outra empresa são recusados
  const certo = pfx("PADARIA PAO DOURADO (DEMO):11222333000181", "senha-certa");
  await enviar(certo, "senha-certa");
  await expect(page.getByText("Confirme a autorização para usar o certificado.")).toBeVisible();
  await page.locator('input[name="autorizacao"]').check();
  await enviar(certo, "senha-errada");
  await expect(page.getByText("Senha do certificado incorreta.").first()).toBeVisible({ timeout: 30_000 });
  await page.locator('input[name="autorizacao"]').check();
  await enviar(pfx("OUTRA EMPRESA:98765432000110", "x"), "x");
  await expect(page.getByText("Este certificado é de outro CNPJ. Use o certificado da própria empresa.").first()).toBeVisible({ timeout: 30_000 });

  // Certificado da própria empresa
  await page.locator('input[name="autorizacao"]').check();
  await enviar(certo, "senha-certa");
  await expect(page.getByText("Certificado cadastrado. A primeira busca começa em instantes.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("PADARIA PAO DOURADO (DEMO):11222333000181")).toBeVisible();
  await expect(page.getByText(/autorizado pelo cliente no portal/)).toBeVisible();
  // Notas organizadas por mês, a partir do mês inicial; o empresário pode recuar o mês
  await expect(page.getByRole("heading", { name: "Notas por mês" })).toBeVisible();
  await expect(page.locator("#mes-inicial")).toHaveValue(mesAtualDaEmpresa);
  await page.selectOption("#mes-inicial", mesAtualDaEmpresa === mes(-4) ? mes(-5) : mes(-4));
  await page.getByRole("button", { name: "Salvar mês inicial" }).click();
  await expect(page.getByText(/A busca agora traz as notas emitidas a partir de/)).toBeVisible({ timeout: 30_000 });
  // A busca roda, mas aqui não consulta a SEFAZ (e diz isso)
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Nenhuma consulta foi feita/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  // O escritório vê a empresa no painel da carteira e o certificado em Vencimentos
  const ctx = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const escritorio = await ctx.newPage();
  await entrar(escritorio, `contador@${DOMINIO}`);
  await escritorio.goto("/escritorio/notas-automaticas");
  // A empresa na tabela da carteira (os lotes de XML também têm links com o nome)
  await expect(escritorio.locator('a[href$="/notas-automaticas"]').filter({ hasText: "Padaria Pão Dourado (DEMO)" })).toBeVisible();
  await escritorio.goto(`${empresa}/vencimentos`);
  await expect(escritorio.getByText("Certificado digital A1 (notas automáticas)").first()).toBeVisible();

  // Empresário remove: a busca é desligada
  await page.getByRole("button", { name: "Remover certificado" }).click();
  await page.fill("#cert-motivo", "Teste automático concluído.");
  await page.getByRole("dialog").getByRole("button", { name: "Remover certificado" }).click();
  await expect(page.getByText(/Certificado removido/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Desconectada", { exact: true })).toBeVisible();
  // Devolve o mês inicial que a empresa tinha
  if (servico && empresaId) await servico.from("notas_automaticas").update({ buscar_desde: `${mesAtualDaEmpresa}-01` }).eq("empresa_id", empresaId);

  // Limpeza: o escritório exclui o vencimento criado pelo teste
  await escritorio.reload();
  await escritorio.getByRole("button", { name: "Ações para Certificado digital A1 (notas automáticas)" }).first().click();
  await escritorio.getByRole("menuitem", { name: "Excluir" }).click();
  await escritorio.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await ctx.close();
});

test("administrador apaga as notas automáticas anteriores ao mês inicial (o cliente não)", async ({ page, browser }) => {
  const admin = clienteServico();
  test.skip(!admin, "Precisa do Supabase local (.env.local) para preparar os dados.");
  const { data: emp } = await admin!.from("empresas").select("id").eq("documento", "11222333000181").single();
  const empresaId = emp!.id as string;
  const { data: antes } = await admin!.from("notas_automaticas").select("buscar_desde").eq("empresa_id", empresaId).maybeSingle();
  const mesInicial = `${mes(-1)}-01`;
  await admin!.from("notas_automaticas").upsert({ empresa_id: empresaId, buscar_desde: mesInicial }, { onConflict: "empresa_id" });

  // Uma nota "trazida pela busca" de três meses atrás, com o arquivo no armazenamento
  const id = randomUUID();
  const comp = `${mes(-3)}-01`;
  const nome = `NFSe-NSU-E2E-${id.slice(0, 8)}.xml`;
  const caminho = `${empresaId}/${comp.slice(0, 7)}/${id}/v1-${nome}`;
  const xml = Buffer.from("<NFSe>teste e2e (ficticio)</NFSe>", "utf8");
  await admin!.storage.from("documentos").upload(caminho, xml, { contentType: "application/xml" });
  const hash = "e".repeat(64);
  const { error } = await admin!.from("documentos").insert({
    id, empresa_id: empresaId, direcao: "cliente", competencia: comp, categoria_codigo: "nfse", nome_original: nome, extensao: "xml",
    mime: "application/xml", tamanho: xml.length, sha256: hash, versao_atual: 1, storage_path: caminho, upload_status: "concluido",
    status: "recebido", origem: "automatica", verificacao_status: "ok", processamento_status: "concluido",
  });
  expect(error).toBeNull();
  await admin!.from("documento_versoes").insert({ documento_id: id, empresa_id: empresaId, versao: 1, storage_path: caminho, nome_original: nome,
    mime: "application/xml", tamanho: xml.length, sha256: hash, upload_concluido_em: new Date().toISOString() });

  try {
    // O cliente vê o aviso, mas não o botão
    await entrar(page, `cliente@${DOMINIO}`);
    await page.goto(`/e/${empresaId}/notas-automaticas`);
    await expect(page.getByText(/1 arquivo anterior a .* no portal/)).toBeVisible();
    await expect(page.getByText("Só o administrador do escritório pode apagá-los.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apagar notas anteriores" })).toHaveCount(0);

    // Lista de documentos: filtro só da busca automática
    const ctx = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
    const adm = await ctx.newPage();
    await entrar(adm, `admin@${DOMINIO}`);
    await adm.goto(`/e/${empresaId}/documentos?fonte=automatica&competencia=${comp.slice(0, 7)}`);
    await expect(adm.getByText(nome).first()).toBeVisible();

    await adm.goto(`/e/${empresaId}/notas-automaticas`);
    await adm.getByRole("button", { name: "Apagar notas anteriores" }).click();
    const dialogo = adm.getByRole("dialog");
    await dialogo.getByRole("button", { name: "Apagar de vez" }).click();
    await expect(dialogo.getByText("Informe o motivo (pelo menos 5 letras).")).toBeVisible();
    await dialogo.locator("#apagar-motivo").fill("Teste automático: começar no mês inicial");
    await dialogo.locator('input[name="confirmo"]').check();
    await dialogo.getByRole("button", { name: "Apagar de vez" }).click();
    await expect(adm.getByText(/Apagados: 1 arquivo\(s\)/)).toBeVisible({ timeout: 30_000 });

    const { count } = await admin!.from("documentos").select("id", { count: "exact", head: true }).eq("id", id);
    expect(count).toBe(0);
    // O arquivo sai do armazenamento pela fila, logo depois da resposta
    await expect(async () => {
      const { data } = await admin!.storage.from("documentos").list(`${empresaId}/${comp.slice(0, 7)}/${id}`);
      expect(data ?? []).toHaveLength(0);
    }).toPass({ timeout: 60_000 });
    await adm.goto(`/e/${empresaId}/documentos?fonte=automatica&competencia=${comp.slice(0, 7)}`);
    await expect(adm.getByText(nome)).toHaveCount(0);
    await ctx.close();
  } finally {
    await admin!.from("documentos").delete().eq("id", id);
    await admin!.storage.from("documentos").remove([caminho]);
    if (antes) await admin!.from("notas_automaticas").update({ buscar_desde: antes.buscar_desde }).eq("empresa_id", empresaId);
    else await admin!.from("notas_automaticas").delete().eq("empresa_id", empresaId);
  }
});

