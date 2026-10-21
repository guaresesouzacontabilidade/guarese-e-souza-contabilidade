/**
 * Grava os vídeos de apresentação do portal para clientes, com dados FICTÍCIOS
 * da demonstração (`npm run seed:demo`). Cada vídeo também é um teste: as
 * conferências de cada cena (o arquivo chegou, o pagamento foi registrado, a
 * resposta apareceu na hora...) vão para o relatório, e um vídeo cuja
 * conferência falhou fica marcado como reprovado.
 *
 * Uso (portal rodando, de preferência compilado com NEXT_PUBLIC_AMBIENTE=demonstracao
 * para a faixa do topo dizer "AMBIENTE DE DEMONSTRAÇÃO"):
 *   node scripts/videos/gravar.mjs <pasta-de-saída> [parte-do-nome-do-vídeo ...]
 *
 * Variáveis: PORTAL_URL (padrão http://localhost:3000), DEMO_SENHA e
 * PW_CHROMIUM (navegador a usar). Precisa do ffmpeg para gerar os MP4.
 * Nunca aponte para o portal oficial: as cenas criam envios, mensagens e
 * pagamentos e só podem rodar com os usuários fictícios da demonstração.
 */
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { instalarSobreposicao } from "./sobreposicao.mjs";
import { gerarArquivos } from "./arquivos.mjs";
import { CENAS } from "./cenas.mjs";

const BASE = (process.env.PORTAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const DESKTOP = { width: 1280, height: 720 };
const CELULAR = { width: 390, height: 844 };

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

if (/onguaresescontabilidade\.com\.br/.test(BASE)) {
  console.error("Recusado: os vídeos só podem ser gravados no ambiente de demonstração ou local.");
  process.exit(1);
}

/** Entra no portal (parte cortada do vídeo) e aceita os termos, se pedidos. */
async function entrar(p, usuario, { aceitarTermos = true } = {}) {
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', `${usuario}@${DOMINIO}`);
  await p.fill('input[name="senha"]', SENHA);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta)/.test(u.pathname), { timeout: 90_000 });
  if (p.url().includes("/aceite") && aceitarTermos) {
    for (const b of await p.locator('input[type="checkbox"]').all()) await b.check();
    await p.click('button[type="submit"]');
    await p.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

/** Ferramentas que cada cena usa para conduzir a tela como uma pessoa faria. */
class Diretor {
  constructor({ browser, p, celular, nome, relatorio, arquivos }) {
    Object.assign(this, { browser, p, celular, nome, relatorio, arquivos });
    this.mouse = celular ? null : { x: DESKTOP.width * 0.62, y: DESKTOP.height * 0.55 };
    this.extras = [];
  }

  get empresa() {
    return this._empresa;
  }

  async legenda(texto, { capitulo, ler = true } = {}) {
    await this.p.evaluate(([t, c]) => window.__video?.legenda(t, c), [texto, capitulo ?? this.capitulo ?? null]);
    if (ler && texto) await esperar(1100 + texto.length * 42);
  }

  esperar(ms) {
    return esperar(ms);
  }

  async ir(caminho) {
    await this.p.goto(caminho.startsWith("http") ? caminho : `${BASE}${caminho}`, { waitUntil: "load" });
    await this.p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await esperar(700);
  }

  /** Deixa o alvo visível acima da legenda e abaixo do cabeçalho fixo. */
  async enquadrar(alvo) {
    await alvo.scrollIntoViewIfNeeded();
    const caixa = await alvo.boundingBox();
    const altura = this.p.viewportSize().height;
    if (!caixa) return null;
    const fixo = await alvo.evaluate((el) => Boolean(el.closest("aside, header, [role=dialog], [data-radix-popper-content-wrapper]")));
    if (fixo) return caixa;
    if (caixa.y < 80 || caixa.y + Math.min(caixa.height, 200) > altura - 150) {
      await this.p.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), caixa.y + Math.min(caixa.height, 200) / 2 - altura * 0.4);
      await esperar(750);
      return alvo.boundingBox();
    }
    return caixa;
  }

  async moverPara(alvo) {
    if (this.celular) return;
    const caixa = await this.enquadrar(alvo);
    if (!caixa) return;
    const x = caixa.x + caixa.width / 2;
    const y = caixa.y + caixa.height / 2;
    const dist = Math.hypot(x - this.mouse.x, y - this.mouse.y);
    await this.p.mouse.move(x, y, { steps: Math.max(12, Math.min(45, Math.round(dist / 14))) });
    this.mouse = { x, y };
    await esperar(260);
  }

  async clicar(alvo, { depois = 700 } = {}) {
    await expect(alvo).toBeVisible({ timeout: 30_000 });
    if (this.celular) {
      await alvo.scrollIntoViewIfNeeded();
      await esperar(300);
      await alvo.tap();
    } else {
      await this.moverPara(alvo);
      await alvo.click();
    }
    await esperar(depois);
  }

  async digitar(alvo, texto, { atraso = 55 } = {}) {
    await this.clicar(alvo, { depois: 200 });
    await alvo.pressSequentially(texto, { delay: atraso });
    await esperar(350);
  }

  async escolher(alvo, valor) {
    await this.moverPara(alvo);
    await alvo.selectOption(valor);
    await esperar(600);
  }

  async rolar(px, { passos = 1 } = {}) {
    for (let i = 0; i < passos; i++) {
      await this.p.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), px / passos);
      await esperar(650);
    }
  }

  async rolarAte(alvo, { bloco = "center" } = {}) {
    await alvo.evaluate((el, b) => {
      const r = el.getBoundingClientRect();
      const destino = b === "start" ? r.top - 92 : r.top + r.height / 2 - window.innerHeight * 0.4;
      window.scrollBy({ top: destino, behavior: "smooth" });
    }, bloco);
    await esperar(900);
  }

  async topo() {
    await this.p.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await esperar(800);
  }

  async destacar(alvo, ms = 2200) {
    const caixa = await alvo.boundingBox();
    if (!caixa) return;
    await this.p.evaluate(([x, y, w, h, t]) => window.__video?.destaque(x, y, w, h, t), [caixa.x, caixa.y, caixa.width, caixa.height, ms]);
    await esperar(Math.min(ms, 1600));
  }

  /** Conferência que entra no relatório; se falhar, a cena para. */
  async conferir(descricao, fn) {
    try {
      await fn();
      this.relatorio.push({ video: this.nome, conferencia: descricao, ok: true });
    } catch (e) {
      this.relatorio.push({ video: this.nome, conferencia: descricao, ok: false, erro: String(e?.message ?? e).split("\n")[0].slice(0, 300) });
      throw e;
    }
  }

  /** Abre o portal com outro usuário fictício, fora da gravação. */
  async abrirSemGravar(usuario) {
    const ctx = await this.browser.newContext({ viewport: DESKTOP, locale: "pt-BR", timezoneId: "America/Araguaina", acceptDownloads: true });
    this.extras.push(ctx);
    const p = await ctx.newPage();
    await entrar(p, usuario);
    return p;
  }

  async fechar() {
    for (const c of this.extras) await c.close().catch(() => {});
  }
}

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${r.stderr}`);
}

/** Moldura de celular sobre fundo da marca, no formato 1280x720. */
async function fundoCelular(browser, caminho, titulo) {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const p = await ctx.newPage();
  const fonte = (pacote, arquivo) => pathToFileURL(resolve("node_modules/@fontsource-variable", pacote, "files", arquivo)).href;
  const html = caminho.replace(/\.png$/, ".html");
  await writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:"Inter V";src:url("${fonte("inter", "inter-latin-wght-normal.woff2")}") format("woff2");font-weight:100 900}
    @font-face{font-family:"Space Grotesk V";src:url("${fonte("space-grotesk", "space-grotesk-latin-wght-normal.woff2")}") format("woff2");font-weight:300 700}
  </style></head><body style="margin:0;width:1280px;height:720px;overflow:hidden;font-family:'Inter V',system-ui,sans-serif;
    background:radial-gradient(800px 500px at 15% 15%,rgba(139,92,246,.45),transparent 62%),radial-gradient(800px 560px at 90% 95%,rgba(34,211,238,.32),transparent 60%),#070a12;color:#fff">
    <div style="position:absolute;left:90px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;gap:18px">
      <div style="font-size:14px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#c4b5fd">Portal Guarese's ON</div>
      <div style="font-family:'Space Grotesk V',sans-serif;font-size:56px;line-height:1.05;font-weight:700;letter-spacing:-.02em">${titulo}</div>
      <div style="font-size:21px;line-height:1.5;color:rgba(255,255,255,.8)">O portal funciona no navegador do celular, sem instalar nada. Dá para fotografar o documento e enviar na hora.</div>
      <div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:8px">Demonstração com dados fictícios</div>
    </div>
    <div style="position:absolute;left:806px;top:24px;width:320px;height:672px;border-radius:44px;background:#0b0f1c;border:2px solid rgba(255,255,255,.18);box-shadow:0 30px 80px rgba(0,0,0,.6)"></div>
  </body></html>`);
  await p.goto(pathToFileURL(html).href);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: caminho });
  await ctx.close();
}

async function gravarCena(browser, cena, ordem, total, pastas, relatorio, arquivos) {
  const celular = Boolean(cena.celular);
  const viewport = celular ? CELULAR : DESKTOP;
  const ctx = await browser.newContext({
    viewport,
    ...(celular ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    recordVideo: { dir: pastas.brutos, size: viewport },
    locale: "pt-BR",
    timezoneId: "America/Araguaina",
    acceptDownloads: true,
  });
  await ctx.addInitScript(instalarSobreposicao);
  await ctx.addInitScript((tema) => {
    try {
      localStorage.setItem("theme", tema);
    } catch {
      /* sem armazenamento local */
    }
  }, cena.tema ?? "light");
  const p = await ctx.newPage();
  const t0 = Date.now();
  const v = new Diretor({ browser, p, celular, nome: cena.id, relatorio, arquivos });
  v.capitulo = cena.titulo;
  let ok = true;
  let marca = 0;
  try {
    if (cena.entrar !== false) {
      await entrar(p, cena.usuario ?? "cliente");
      await p.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
    }
    v._empresa = p.url().match(/\/e\/[0-9a-f-]{36}/)?.[0] ?? null;
    // Preparação feita pelo escritório (ou pelo próprio cliente) fora do trecho que aparece no vídeo
    if (cena.preparar) await cena.preparar(v);
    const inicio = typeof cena.inicio === "function" ? cena.inicio(v) : cena.inicio;
    if (inicio) await v.ir(inicio);
    if (celular) await p.evaluate(() => window.__video?.semCursor());
    await p.evaluate((d) => window.__video?.titulo(d), { titulo: cena.titulo, subtitulo: cena.subtitulo, numero: `Vídeo ${ordem} de ${total}` });
    await esperar(250);
    marca = (Date.now() - t0) / 1000;
    await esperar(3200);
    await p.evaluate(() => window.__video?.tituloSair());
    await esperar(800);
    await cena.rodar(v);
    await esperar(1600);
  } catch (e) {
    ok = false;
    if (!relatorio.some((r) => r.video === cena.id && !r.ok)) {
      relatorio.push({ video: cena.id, conferencia: "cena completa", ok: false, erro: String(e?.message ?? e).split("\n")[0].slice(0, 300) });
    }
    await p.screenshot({ path: join(pastas.saida, `${cena.id}-ERRO.png`) }).catch(() => {});
  }
  const duracao = (Date.now() - t0) / 1000 - marca;
  const video = p.video();
  await v.fechar();
  await ctx.close();
  const bruto = await video.path();
  const final = join(pastas.saida, `${cena.id}.mp4`);
  const fade = `fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, duracao - 0.8).toFixed(2)}:d=0.8`;
  if (celular) {
    const fundo = join(pastas.brutos, `${cena.id}-fundo.png`);
    await fundoCelular(browser, fundo, cena.tituloMoldura ?? cena.titulo);
    ffmpeg([
      "-loop", "1", "-i", fundo, "-ss", marca.toFixed(2), "-i", bruto, "-t", duracao.toFixed(2),
      "-filter_complex", `[1:v]scale=300:-2[c];[0:v][c]overlay=816:34:shortest=1,${fade},format=yuv420p`,
      "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-r", "25", "-movflags", "+faststart", "-an", final,
    ]);
  } else {
    ffmpeg(["-ss", marca.toFixed(2), "-i", bruto, "-t", duracao.toFixed(2), "-vf", `${fade},format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-r", "25", "-movflags", "+faststart", "-an", final]);
  }
  ffmpeg(["-ss", "1.2", "-i", final, "-frames:v", "1", "-q:v", "3", join(pastas.saida, `${cena.id}.jpg`)]);
  return { id: cena.id, titulo: cena.titulo, subtitulo: cena.subtitulo, arquivo: `${cena.id}.mp4`, capa: `${cena.id}.jpg`, segundos: Math.round(duracao), ok };
}

async function principal() {
  const [saidaArg, ...filtros] = process.argv.slice(2);
  if (!saidaArg) {
    console.error("Uso: node scripts/videos/gravar.mjs <pasta-de-saída> [parte-do-nome-do-vídeo ...]");
    process.exit(1);
  }
  const saida = resolve(saidaArg);
  const pastas = { saida, brutos: join(saida, ".brutos") };
  await mkdir(pastas.brutos, { recursive: true });
  // Idioma do navegador em português: campos de data no formato dd/mm/aaaa
  const browser = await chromium.launch({
    args: ["--lang=pt-BR"],
    env: { ...process.env, LANG: "pt_BR.UTF-8", LANGUAGE: "pt_BR:pt", LC_ALL: "pt_BR.UTF-8" },
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  });
  const arquivos = await gerarArquivos(browser, join(saida, "arquivos-ficticios"));
  const escolhidas = filtros.length ? CENAS.filter((c) => filtros.some((f) => c.id.includes(f))) : CENAS;
  const relatorio = [];
  const videos = [];
  for (const cena of escolhidas) {
    const ordem = CENAS.indexOf(cena) + 1;
    process.stdout.write(`▶ ${cena.id} ... `);
    const r = await gravarCena(browser, cena, ordem, CENAS.length, pastas, relatorio, arquivos);
    videos.push(r);
    console.log(r.ok ? `ok (${r.segundos}s)` : "REPROVADO");
  }
  await browser.close();
  await rm(pastas.brutos, { recursive: true, force: true });
  await writeFile(join(saida, "relatorio.json"), JSON.stringify({ gravadoEm: new Date().toISOString(), portal: BASE, videos, conferencias: relatorio }, null, 2));
  const falhas = relatorio.filter((r) => !r.ok);
  console.log(`\nConferências: ${relatorio.length - falhas.length} ok, ${falhas.length} com falha.`);
  for (const f of falhas) console.log(`  ✗ ${f.video}: ${f.conferencia} — ${f.erro}`);
  process.exit(falhas.length ? 1 : 0);
}

principal();
