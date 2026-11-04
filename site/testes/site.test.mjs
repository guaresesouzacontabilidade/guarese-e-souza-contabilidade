// Testes do site: páginas, segurança, menu, tema e formulário.
// Uso: node --test site/testes/site.test.mjs   (precisa do Playwright instalado no ambiente)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { iniciarServidor } from "./servidor.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const API = "https://portal.onguaresescontabilidade.com.br/api/site/contato";
let srv, base, navegador;

before(async () => {
  ({ servidor: srv, base } = await iniciarServidor(RAIZ));
  navegador = await chromium.launch();
});
after(async () => {
  await navegador?.close();
  srv?.close();
});

async function abrir(opcoes = {}) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 }, ...opcoes });
  const pagina = await ctx.newPage();
  const erros = [];
  // Respostas 404/503 provocadas pelos testes aparecem no console como "Failed to load resource": não são erros do site
  pagina.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && erros.push(m.text()));
  pagina.on("pageerror", (e) => erros.push(e.message));
  return { ctx, pagina, erros };
}

test("página inicial: seções do briefing, SEO, segurança e nada inventado à mostra", async () => {
  const { ctx, pagina, erros } = await abrir();
  const r = await pagina.goto(base + "/", { waitUntil: "networkidle" });
  assert.equal(r.status(), 200);
  const csp = r.headers()["content-security-policy"];
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /connect-src 'self' https:\/\/portal\.onguaresescontabilidade\.com\.br/);
  assert.equal(await pagina.title(), "ON Guarese's Contabilidade | Contabilidade em Porto Nacional (TO)");
  assert.ok(await pagina.locator('meta[property="og:image"]').getAttribute("content"));
  // Primeira tela: o que, para quem e o próximo passo
  assert.match(await pagina.locator("h1").textContent(), /Contabilidade para médicos, produtores rurais e empresas de Porto Nacional/);
  assert.ok(await pagina.locator('.heroi a[href="#contato"]', { hasText: "Pedir uma proposta" }).isVisible());
  for (const id of ["inicio", "para-quem", "servicos", "portal", "quem-somos", "como-funciona", "duvidas", "contato"]) {
    assert.ok(await pagina.locator(`#${id}`).isVisible(), `seção ${id} visível`);
  }
  // Sem números e depoimentos reais, essas partes ficam escondidas
  assert.equal(await pagina.locator("#numeros").isVisible(), false);
  assert.equal(await pagina.locator("#depoimentos").isVisible(), false);
  assert.equal(await pagina.locator("#formulario-alternativa").isVisible(), false);
  assert.equal(await pagina.locator(".servico").count(), 5);
  assert.equal(await pagina.locator(".publico").count(), 3);
  assert.equal(await pagina.locator(".acordeao details").count(), 7);
  // Portal e WhatsApp
  assert.equal(await pagina.locator('a[href="https://portal.onguaresescontabilidade.com.br"]').first().getAttribute("href"), "https://portal.onguaresescontabilidade.com.br");
  assert.match(await pagina.locator(".whats-flutuante").getAttribute("href"), /^https:\/\/wa\.me\/5563992969763/);
  // Pergunta frequente abre
  await pagina.locator(".acordeao summary").first().click();
  assert.equal(await pagina.locator(".acordeao details").first().getAttribute("open"), "");
  assert.deepEqual(erros, []);
  await ctx.close();
});

test("celular: menu abre e fecha; tema claro fica guardado", async () => {
  const { ctx, pagina, erros } = await abrir({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pagina.goto(base + "/", { waitUntil: "networkidle" });
  // Sem rolagem horizontal no celular
  assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
  const botao = pagina.locator("#abrir-menu");
  await botao.click();
  assert.equal(await botao.getAttribute("aria-expanded"), "true");
  // O botão do portal no menu tem texto legível (cor do botão, não a dos links)
  const cores = await pagina.locator("#menu .menu-portal").evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
  assert.notEqual(cores[0], cores[1]);
  assert.equal(cores[0], "rgb(26, 17, 11)"); // --botao-texto (marrom escuro) sobre o dourado
  await pagina.locator("#menu a", { hasText: "Serviços" }).click();
  assert.equal(await botao.getAttribute("aria-expanded"), "false");
  await pagina.locator("#alternar-tema").click();
  assert.match(await pagina.locator("html").getAttribute("class"), /claro/);
  await pagina.reload({ waitUntil: "networkidle" });
  assert.match(await pagina.locator("html").getAttribute("class"), /claro/);
  assert.deepEqual(erros, []);
  await ctx.close();
});

async function preencher(pagina) {
  await pagina.fill('input[name="nome"]', "Maria Souza");
  await pagina.fill('input[name="email"]', "maria@empresa.com.br");
  await pagina.fill('input[name="telefone"]', "(63) 99999-0000");
  await pagina.fill('textarea[name="mensagem"]', "Quero uma proposta para a minha loja.");
}

test("formulário: confere os campos e o consentimento antes de enviar", async () => {
  const { ctx, pagina } = await abrir();
  let chamadas = 0;
  await pagina.route(API, (rota) => {
    chamadas++;
    return rota.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await pagina.goto(base + "/#contato", { waitUntil: "networkidle" });
  await pagina.locator('#formulario-contato button[type="submit"]').click();
  assert.match(await pagina.locator("#formulario-status").textContent(), /Preencha nome/);
  await preencher(pagina);
  await pagina.locator('#formulario-contato button[type="submit"]').click();
  assert.match(await pagina.locator("#formulario-status").textContent(), /Marque a concordância/);
  assert.equal(chamadas, 0);
  await ctx.close();
});

test("formulário: envio certo mostra a confirmação; sem envio, oferece WhatsApp e e-mail com a mensagem pronta", async () => {
  const { ctx, pagina, erros } = await abrir();
  let corpo = null;
  let resposta = { status: 200, body: '{"ok":true}' };
  await pagina.route(API, (rota) => {
    corpo = JSON.parse(rota.request().postData());
    return rota.fulfill({ status: resposta.status, contentType: "application/json", body: resposta.body, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await pagina.goto(base + "/#contato", { waitUntil: "networkidle" });
  await pagina.waitForTimeout(2600);
  await preencher(pagina);
  await pagina.check('input[name="consentimento"]');
  await pagina.locator('#formulario-contato button[type="submit"]').click();
  await pagina.locator("#formulario-status.ok").waitFor();
  assert.match(await pagina.locator("#formulario-status").textContent(), /Mensagem enviada/);
  assert.equal(corpo.nome, "Maria Souza");
  assert.equal(corpo.consentimento, true);
  assert.equal(corpo.site, "");
  assert.ok(corpo.tempo >= 2500);
  assert.equal(await pagina.inputValue('input[name="nome"]'), "");

  resposta = { status: 503, body: '{"ok":false,"mensagem":"O envio pelo formulário ainda não está ligado."}' };
  await preencher(pagina);
  await pagina.check('input[name="consentimento"]');
  await pagina.locator('#formulario-contato button[type="submit"]').click();
  await pagina.locator("#formulario-status.erro").waitFor();
  assert.match(await pagina.locator("#formulario-status").textContent(), /ainda não está ligado/);
  assert.ok(await pagina.locator("#formulario-alternativa").isVisible());
  const whats = decodeURIComponent(await pagina.locator("#alternativa-whats").getAttribute("href"));
  assert.match(whats, /^https:\/\/wa\.me\/5563992969763\?text=/);
  assert.match(whats, /Quero uma proposta para a minha loja\./);
  assert.match(await pagina.locator("#alternativa-email").getAttribute("href"), /^mailto:onguaresescontato@gmail\.com\?subject=/);
  assert.deepEqual(erros, []);
  await ctx.close();
});

test("privacidade e página não encontrada", async () => {
  const { ctx, pagina, erros } = await abrir();
  const p = await pagina.goto(base + "/privacidade", { waitUntil: "networkidle" });
  assert.equal(p.status(), 200);
  assert.match(await pagina.locator("h1").textContent(), /Política de privacidade/);
  assert.match(await pagina.content(), /não os usamos para treinar inteligência artificial/);
  const n = await pagina.goto(base + "/nao-existe", { waitUntil: "networkidle" });
  assert.equal(n.status(), 404);
  assert.match(await pagina.locator("h1").textContent(), /Página não encontrada/);
  assert.deepEqual(erros, []);
  await ctx.close();
});
