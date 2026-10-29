/* Board Posto Catarinense — o posto em 3D. Cada venda vira um carro na bomba, no horário em que aconteceu. */
(() => {
  "use strict";
  const B = window.BPC;
  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
  const ORBIT_URL = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js";
  const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
  const fuelColor = f => SERIES[((B.FUEL[f] && B.FUEL[f].s) || 1) - 1];
  const fuelName = f => (B.FUEL[f] ? B.FUEL[f].n : "Combustível");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 3600) % 24).padStart(2, "0") + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const hm = ms => hms(ms).slice(0, 5);
  const SEC = 1000, MIN = 60000, H = 3600000;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Planta do posto (metros) ----------
  // x corre ao longo da rua; z cresce na direção da rua (a rua fica em z 24 a 32).
  const PUMP_X = { 1: -12, 2: 0, 3: 12, 4: 30 };
  const PUMP_Z = 1;
  const STORE = { x0: -36, x1: -16, z0: -30, z1: -20 };
  const OIL = { x0: -12, x1: 0, z0: -30, z1: -20 };
  const PAD = { x0: 16, x1: 26, z0: 10, z1: 20 };
  const TANK_Z = [11.4, 13.2, 15, 16.8, 18.6];
  const TANK_Y = -1.6, TANK_R = 0.8, TANK_L = 8;
  const TOTEM = { x: -40, z: 19.5 };
  const laneX = side => PUMP_X[side.bomba] + (side.lado === "A" ? -1 : 1) * (side.tipo === "diesel" ? 2.9 : 2.6);
  const CAMS = {
    geral: { label: "Geral", pos: [-16, 46, 66], target: [2, 0, -4] },
    pista: { label: "Pista", pos: [-6, 13, 25], target: [0, 1, 1] },
    diesel: { label: "Diesel", pos: [46, 12, 22], target: [30, 1.5, 1] },
    loja: { label: "Loja", pos: [-13, 11, -1], target: [-24, 1.5, -25] },
    tanques: { label: "Tanques", pos: [31, 10, 31], target: [21, -1, 15] },
  };

  // ---------- Carregar o Three.js só quando abrir o 3D ----------
  let loading = null;
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.append(s); });
  function ensureThree() {
    if (window.THREE && THREE.OrbitControls) return Promise.resolve();
    if (!loading) loading = loadScript(THREE_URL).then(() => loadScript(ORBIT_URL)).catch(e => { loading = null; throw e; });
    return loading;
  }

  // ---------- Interface por cima da cena ----------
  const CSS = `
.w-root { position: fixed; inset: 0; z-index: 20; overflow: hidden; background: var(--bg); color: var(--ink); font-family: var(--f-body); font-size: 14px; }
.w-canvas { position: absolute; inset: 0; }
.w-canvas canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
.w-glass { background: var(--panel); background: color-mix(in srgb, var(--panel) 90%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 6px 24px rgba(0, 0, 0, .18); }
.w-top { position: absolute; top: 0; left: 0; right: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; justify-content: space-between; pointer-events: none;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) max(12px, env(safe-area-inset-right, 0px)) 0 max(12px, env(safe-area-inset-left, 0px)); }
.w-top > * { pointer-events: auto; }
.w-id { display: flex; align-items: center; gap: 10px; padding: 7px 12px 7px 7px; min-width: 0; }
.w-id h1 { font-size: 19px; line-height: 1.05; text-transform: uppercase; letter-spacing: .03em; font-weight: 700; }
.w-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
.w-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: var(--panel-2); color: var(--ink-2); white-space: nowrap; }
.w-chip i { width: 7px; height: 7px; border-radius: 50%; background: var(--bad); }
.w-chip.live i { animation: w-pulse 1.4s ease-in-out infinite; }
.w-chip.sample i { background: var(--warn); animation: none; }
@keyframes w-pulse { 50% { opacity: .25; } }
.w-ibtn { border: 1px solid var(--line); background: var(--panel); border-radius: 10px; height: 36px; min-width: 36px; padding: 0 10px; display: inline-grid; grid-auto-flow: column; gap: 6px; place-items: center; font-weight: 600; font-size: 14px; color: var(--ink); text-decoration: none; cursor: pointer; }
.w-ibtn:hover { border-color: var(--axis); }
.w-ibtn svg { width: 16px; height: 16px; }
.w-cams { display: flex; gap: 2px; padding: 4px; max-width: 100%; overflow-x: auto; }
.w-cams button { border: 0; background: none; padding: 6px 11px; border-radius: 9px; font-weight: 600; font-size: 13px; color: var(--ink-2); white-space: nowrap; cursor: pointer; }
.w-cams button:hover { background: var(--panel-2); color: var(--ink); }
.w-root { --w-foot: 64px; }
.w-hud { position: absolute; left: max(12px, env(safe-area-inset-left, 0px)); top: calc(env(safe-area-inset-top, 0px) + 78px); padding: 10px 12px; display: grid; gap: 8px; width: 230px; }
.w-clock { background: var(--totem-bg); color: var(--totem-fg); border-radius: 10px; padding: 6px 10px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.w-clock b { font-family: var(--f-led); font-weight: 400; font-size: 30px; line-height: 1; letter-spacing: .02em; text-shadow: 0 0 12px rgba(255, 178, 31, .3); }
.w-clock span { color: var(--totem-label); font-size: 12px; text-transform: capitalize; }
.w-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.w-stat { display: flex; flex-direction: column; min-width: 0; }
.w-stat span { color: var(--muted); font-size: 12px; }
.w-stat b { font-family: var(--f-display); font-weight: 600; font-size: 19px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.w-panel { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); top: calc(env(safe-area-inset-top, 0px) + 78px); bottom: calc(env(safe-area-inset-bottom, 0px) + var(--w-foot) + 24px); width: min(380px, calc(100% - 24px)); display: flex; flex-direction: column; overflow: hidden; }
.w-panel-h { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 14px 14px 10px 16px; }
.w-eyebrow { font-family: var(--f-display); font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); display: flex; align-items: center; gap: 6px; }
.w-panel-h h2 { font-size: 22px; margin-top: 1px; }
.w-panel-h p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
.w-panel-b { overflow: auto; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.w-sec { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line); padding-top: 10px; }
.w-sec h3 { font-size: 15px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
.w-kv { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.w-kv span:first-child { color: var(--ink-2); }
.w-kv span:last-child { font-variant-numeric: tabular-nums; text-align: right; font-weight: 500; }
.w-big { font-family: var(--f-display); font-size: 30px; font-weight: 600; line-height: 1.05; }
.w-big small { font-size: 16px; color: var(--muted); font-weight: 500; margin-left: 4px; }
.w-bar { height: 8px; border-radius: 4px; background: var(--grid); overflow: hidden; }
.w-bar div { height: 100%; border-radius: 4px; background: var(--accent-bar); }
.w-side { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.w-side.busy { border-color: var(--warn); }
.w-side-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 600; }
.w-led { font-family: var(--f-led); background: var(--totem-bg); color: var(--totem-fg); border-radius: 8px; padding: 6px 10px; display: flex; justify-content: space-between; gap: 10px; font-size: 20px; }
.w-led small { color: var(--totem-label); font-size: 12px; font-family: var(--f-body); }
.w-note { color: var(--muted); font-size: 12px; margin: 0; }
.w-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.w-list li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; font-size: 13px; }
.w-list li span:nth-child(1) { color: var(--muted); font-variant-numeric: tabular-nums; }
.w-list li span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w-list li span:nth-child(3) { font-variant-numeric: tabular-nums; font-weight: 600; }
.w-panel table { font-size: 13px; }
.w-panel td, .w-panel th { padding: 6px 6px; }
.w-time { position: absolute; left: max(12px, env(safe-area-inset-left, 0px)); right: max(12px, env(safe-area-inset-right, 0px)); bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); padding: 8px 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.w-play { width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; cursor: pointer; flex: none; }
.w-play svg { width: 18px; height: 18px; }
.w-slider { position: relative; flex: 1 1 280px; min-width: 0; height: 40px; }
.w-slider svg { position: absolute; left: 0; right: 0; top: 2px; width: 100%; height: 22px; pointer-events: none; }
.w-slider input { position: absolute; left: 0; right: 0; top: 4px; width: 100%; margin: 0; accent-color: var(--accent); background: transparent; }
.w-ticks { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); pointer-events: none; }
.w-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; padding: 2px; background: var(--panel); }
.w-seg button { border: 0; background: none; padding: 5px 9px; border-radius: 8px; font-weight: 600; font-size: 13px; color: var(--ink-2); cursor: pointer; }
.w-seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); }
.w-day { display: inline-flex; align-items: center; gap: 4px; }
.w-day span { font-weight: 600; font-size: 13px; min-width: 76px; text-align: center; text-transform: capitalize; }
.w-now.on { border-color: var(--bad); color: var(--bad-ink); }
.w-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.w-label { position: absolute; left: 0; top: 0; pointer-events: auto; border: 0; cursor: pointer; font: 600 12px var(--f-body); padding: 3px 9px 3px 7px; border-radius: 999px; color: var(--ink);
  background: var(--panel); background: color-mix(in srgb, var(--panel) 92%, transparent); box-shadow: 0 2px 8px rgba(0, 0, 0, .2); white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; will-change: transform; }
.w-label i { width: 8px; height: 8px; border-radius: 50%; background: var(--good); flex: none; }
.w-label i.busy { background: var(--warn); }
.w-label i.bad { background: var(--bad); }
.w-label i.off { background: var(--muted); }
.w-hint { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + var(--w-foot) + 24px); padding: 10px 12px 10px 14px; display: flex; gap: 10px; align-items: center; width: max-content; max-width: calc(100% - 24px); }
.w-hint p { margin: 0; }
.w-msg { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; background: var(--bg); text-align: center; }
.w-msg div { display: flex; flex-direction: column; gap: 12px; align-items: center; max-width: 42ch; }
.w-msg h2 { font-size: 24px; }
.w-msg p { margin: 0; color: var(--ink-2); }
@media (max-width: 760px) {
  .w-id h1 { font-size: 16px; }
  .w-cams { order: 3; width: 100%; }
  .w-hud { top: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + var(--w-foot) + 20px); width: auto; right: max(12px, env(safe-area-inset-right, 0px)); grid-template-columns: auto 1fr; align-items: center; padding: 8px 10px; }
  .w-clock { flex-direction: column; align-items: flex-start; gap: 2px; }
  .w-clock b { font-size: 24px; }
  .w-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px 8px; }
  .w-stat b { font-size: 15px; }
  .w-stat span { font-size: 11px; }
  .w-panel { top: auto; left: max(12px, env(safe-area-inset-left, 0px)); right: max(12px, env(safe-area-inset-right, 0px)); width: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + var(--w-foot) + 20px); max-height: 52%; }
  .w-root.has-panel .w-hud { display: none; }
  .w-hint { bottom: calc(env(safe-area-inset-bottom, 0px) + var(--w-foot) + 120px); }
  .w-slider { flex-basis: 100%; order: -1; }
}
@media (max-width: 420px) {
  .w-stats { grid-template-columns: 1fr 1fr; }
}`;

  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  };

  let ui = null;
  function buildUI() {
    const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
    const root = document.createElement("div");
    root.className = "w-root"; root.id = "world"; root.hidden = true;
    root.innerHTML = `
      <div class="w-canvas" id="w-canvas"></div>
      <div class="w-labels" id="w-labels"></div>
      <header class="w-top">
        <div class="w-id w-glass">
          <a class="w-ibtn" href="#" id="w-back" aria-label="Voltar ao Board">${ICON.back}<span>Board</span></a>
          <div>
            <h1>Posto Catarinense</h1>
            <div class="w-chips"><span class="w-chip live" id="w-mode"><i></i>Ao vivo</span><span class="w-chip sample" id="w-sample" hidden><i></i>Dados de exemplo</span></div>
          </div>
        </div>
        <nav class="w-cams w-glass" aria-label="Câmera">${Object.entries(CAMS).map(([k, c]) => `<button type="button" data-cam="${k}">${c.label}</button>`).join("")}</nav>
      </header>
      <section class="w-hud w-glass" aria-label="Resumo do dia até agora">
        <div class="w-clock"><b id="w-clock">--:--:--</b><span id="w-date"></span></div>
        <div class="w-stats">
          <div class="w-stat"><span>Faturamento</span><b id="w-rev">—</b></div>
          <div class="w-stat"><span>Litros</span><b id="w-lit">—</b></div>
          <div class="w-stat"><span>Abastecimentos</span><b id="w-n">—</b></div>
          <div class="w-stat"><span>No posto agora</span><b id="w-here">—</b></div>
        </div>
      </section>
      <aside class="w-panel w-glass" id="w-panel" hidden aria-live="polite">
        <div class="w-panel-h">
          <div><div class="w-eyebrow" id="w-p-eyebrow"></div><h2 id="w-p-title"></h2><p id="w-p-sub"></p></div>
          <button type="button" class="w-ibtn" id="w-p-close" aria-label="Fechar">${ICON.x}</button>
        </div>
        <div class="w-panel-b" id="w-p-body"></div>
      </aside>
      <div class="w-hint w-glass" id="w-hint">
        <p>Toque nas bombas, carros, tanques, loja, troca de óleo e totem para ver o que está acontecendo.</p>
        <button type="button" class="w-ibtn" id="w-hint-x" aria-label="Fechar dica">${ICON.x}</button>
      </div>
      <footer class="w-time w-glass">
        <button type="button" class="w-play" id="w-play" aria-label="Pausar">${ICON.pause}</button>
        <div class="w-slider">
          <svg id="w-activity" viewBox="0 0 96 22" preserveAspectRatio="none" aria-hidden="true"></svg>
          <input type="range" id="w-range" min="0" max="86340" step="60" value="0" aria-label="Horário do dia">
          <div class="w-ticks"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
        </div>
        <div class="w-seg" role="group" aria-label="Velocidade">
          <button type="button" data-speed="1" aria-pressed="true">1×</button>
          <button type="button" data-speed="10" aria-pressed="false">10×</button>
          <button type="button" data-speed="60" aria-pressed="false">60×</button>
          <button type="button" data-speed="300" aria-pressed="false">300×</button>
        </div>
        <button type="button" class="w-ibtn w-now" id="w-now">Agora</button>
        <div class="w-day">
          <button type="button" class="w-ibtn" id="w-prev" aria-label="Dia anterior">${ICON.prev}</button>
          <span id="w-day"></span>
          <button type="button" class="w-ibtn" id="w-next" aria-label="Próximo dia">${ICON.next}</button>
        </div>
      </footer>
      <div class="w-msg" id="w-msg"><div><h2>Montando o posto…</h2><p>Carregando o 3D.</p></div></div>`;
    document.body.append(root);
    const $ = id => root.querySelector("#" + id);
    ui = { root, $ };
    const foot = root.querySelector(".w-time");
    new ResizeObserver(() => root.style.setProperty("--w-foot", foot.offsetHeight + "px")).observe(foot);
    $("w-back").addEventListener("click", e => { e.preventDefault(); location.hash = ""; });
    $("w-p-close").addEventListener("click", () => select(null));
    $("w-hint-x").addEventListener("click", () => { $("w-hint").hidden = true; });
    root.querySelectorAll("[data-cam]").forEach(b => b.addEventListener("click", () => { if (world) world.flyCam(b.dataset.cam); }));
    $("w-play").addEventListener("click", () => { sim.playing = !sim.playing; if (!sim.playing) sim.live = false; syncControls(); });
    $("w-range").addEventListener("input", e => { sim.live = false; sim.t = Number(e.target.value) * SEC; syncControls(); });
    root.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => { sim.speed = Number(b.dataset.speed); sim.live = false; sim.playing = true; syncControls(); }));
    $("w-now").addEventListener("click", goLive);
    $("w-prev").addEventListener("click", () => shiftDay(-1));
    $("w-next").addEventListener("click", () => shiftDay(1));
    document.addEventListener("keydown", e => { if (!root.hidden && e.key === "Escape" && selected) select(null); });
  }
  function showMsg(title, text, retry) {
    const m = ui.$("w-msg"); m.hidden = false; m.textContent = "";
    const box = document.createElement("div");
    const h = document.createElement("h2"); h.textContent = title;
    const p = document.createElement("p"); p.textContent = text;
    box.append(h, p);
    if (retry) { const b = document.createElement("button"); b.type = "button"; b.className = "w-ibtn"; b.textContent = "Tentar de novo"; b.addEventListener("click", open); box.append(b); }
    const back = document.createElement("a"); back.className = "w-ibtn"; back.href = "#"; back.textContent = "Voltar ao Board";
    back.addEventListener("click", e => { e.preventDefault(); location.hash = ""; });
    box.append(back); m.append(box);
  }

  // ---------- Simulação do dia ----------
  const sim = { day: null, t: 0, playing: true, speed: 1, live: true, visits: [], shop: [], deliveries: [], sales: [], avgDaily: {} };
  function lastDay() { const d = B.salesDays(); return d.length ? d[d.length - 1] : null; }
  function goLive() { sim.live = true; sim.speed = 1; sim.playing = true; const d = lastDay(); if (d !== sim.day) planDay(d); syncControls(); }
  function shiftDay(dir) {
    const days = B.salesDays(), i = days.indexOf(sim.day);
    const j = clamp(i + dir, 0, days.length - 1);
    if (days[j] == null || j === i) return;
    sim.live = false; planDay(days[j]); syncControls();
  }

  // Monta a agenda do dia: cada venda de combustível vira um veículo num lado de bomba.
  function planDay(day) {
    sim.day = day; sim.visits = []; sim.shop = []; sim.deliveries = []; sim.sales = []; sim.avgDaily = {};
    if (day == null) return;
    {
      const days = B.salesDays(), start = B.addDays(day, -6), end = B.addDays(day, 1);
      const m = B.summarize(B.salesIn(start, end));
      const nDays = days.filter(d => d >= start && d < end).length || 1;
      for (const f in m.fuels) sim.avgDaily[f] = m.fuels[f].q / nDays;
    }
    const next = B.addDays(day, 1);
    sim.sales = B.salesIn(day, next);
    const free = {};
    const real = B.state.db.mode === "real";
    sim.sales.forEach((s, idx) => {
      const fuelItems = s.items.filter(i => i.f);
      const emit = s.t - day;
      if (!fuelItems.length) {
        const spot = STORE_SPOTS[hash(String(s.k)) % STORE_SPOTS.length];
        sim.shop.push({ s, emit, appear: emit - 200 * SEC, counter: emit - 35 * SEC, gone: emit + 25 * SEC, spot, k: "c" + idx });
        return;
      }
      const main = fuelItems.reduce((a, i) => (i.q > a.q ? i : a));
      const q = fuelItems.reduce((a, i) => a + i.q, 0);
      const v = fuelItems.reduce((a, i) => a + i.v, 0);
      const diesel = main.f === "d10" || main.f === "d500";
      const kind = diesel && q >= 80 ? "truck" : diesel ? "pickup" : "car";
      let side = null, bico = null, est = true;
      if (main.b && B.BICOS[main.b] && B.BICOS[main.b].f === main.f) { side = B.BICOS[main.b].side; bico = main.b; est = false; }
      const flow = kind === "truck" ? 1.2 : 0.55; // litros por segundo
      const fuelEnd = emit - 25 * SEC, fuelStart = fuelEnd - (q / flow) * SEC;
      const arrive = fuelStart - 50 * SEC, leave = emit + 35 * SEC;
      if (!side) {
        let cands = B.SIDES.filter(sd => sd.bicos.some(b => b.f === main.f) && (kind === "truck" ? sd.tipo === "diesel" : kind === "car" ? sd.tipo === "carro" : true));
        if (!cands.length) cands = B.SIDES.filter(sd => sd.tipo === (kind === "truck" ? "diesel" : "carro"));
        const want = arrive - 40 * SEC;
        const okNow = cands.filter(sd => (free[sd.id] || -Infinity) <= want);
        const pool = okNow.length ? okNow : cands;
        const start = hash(String(s.k)) % pool.length;
        side = okNow.length ? pool[start] : pool.reduce((a, sd) => ((free[sd.id] || 0) < (free[a.id] || 0) ? sd : a));
        const bi = side.bicos.find(b => b.f === main.f) || side.bicos[0];
        bico = bi.n;
      }
      const vis = { s, idx, k: "v" + idx, side, bico, est: est && real, kind, f: main.f, q, v, emit, fuelStart, fuelEnd, arrive, leave, other: s.items.filter(i => !i.f) };
      const c = vehicleCurves(vis);
      const speedIn = kind === "truck" ? 6 : 8, speedOut = kind === "truck" ? 6 : 9;
      vis.appear = arrive - (c.in.getLength() / speedIn) * SEC;
      vis.gone = leave + (c.out.getLength() / speedOut) * SEC;
      free[side.id] = vis.gone;
      sim.visits.push(vis);
    });
    for (const p of B.state.db.purchases) {
      if (p.t < day || p.t >= next) continue;
      const at = p.t - day;
      const d = { p, k: "e" + p.k, arrive: at - 25 * MIN, leave: at + 20 * MIN };
      d.appear = d.arrive - 22 * SEC; d.gone = d.leave + 18 * SEC;
      sim.deliveries.push(d);
    }
    drawActivity();
    if (world) { world.clearDynamic(); world.refreshStatic(); }
  }

  function drawActivity() {
    const svg = ui.$("w-activity"); svg.textContent = "";
    const bins = Array(96).fill(0);
    for (const s of sim.sales) bins[clamp(Math.floor((s.t - sim.day) / (15 * MIN)), 0, 95)]++;
    const max = Math.max(1, ...bins);
    const ns = "http://www.w3.org/2000/svg";
    bins.forEach((n, i) => {
      if (!n) return;
      const h = n / max * 20;
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", i + 0.12); r.setAttribute("width", 0.76); r.setAttribute("y", 22 - h); r.setAttribute("height", h);
      r.setAttribute("fill", "var(--accent-bar)"); r.setAttribute("opacity", ".35");
      svg.append(r);
    });
  }

  function syncControls() {
    if (!ui) return;
    const $ = ui.$;
    $("w-play").innerHTML = sim.playing ? ICON.pause : ICON.play;
    $("w-play").setAttribute("aria-label", sim.playing ? "Pausar" : "Tocar");
    ui.root.querySelectorAll("[data-speed]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === sim.speed)));
    $("w-now").classList.toggle("on", sim.live);
    const days = B.salesDays(), i = days.indexOf(sim.day);
    $("w-prev").disabled = i <= 0; $("w-next").disabled = i < 0 || i >= days.length - 1;
    $("w-day").textContent = sim.day != null ? B.fmtWeekday(sim.day) : "sem dados";
    const mode = $("w-mode");
    mode.className = "w-chip" + (sim.live ? " live" : "");
    mode.lastChild.textContent = sim.live ? `Ao vivo · vendas de ${sim.day != null ? B.fmtDay(sim.day) : "—"}` : `Replay · ${sim.speed}×`;
    $("w-sample").hidden = B.state.db.mode !== "sample";
  }

  // Lugares dentro da loja onde os clientes param
  const STORE_SPOTS = [[-33, -27.5], [-31, -24], [-29, -27.6], [-27, -24.2], [-25, -27.5], [-23.5, -24], [-21.5, -27.4], [-33.5, -22.4], [-30, -22.6], [-26, -22.4]];
  const COUNTER = [-19.2, -23.2];
  const STORE_DOOR = [-18, -19.6];

  // ---------- Mundo 3D ----------
  let world = null;
  let selected = null;     // { type, id }
  let hovered = null;
  let running = false, raf = 0, lastFrame = 0;
  let flight = null;

  function vehicleCurves(v) {
    const x = laneX(v.side);
    const key = v.kind + v.side.id;
    if (!curveCache.has(key)) {
      const V = (pts) => new THREE.CatmullRomCurve3(pts.map(([px, pz]) => new THREE.Vector3(px, 0, pz)), false, "centripetal");
      let c;
      if (v.kind === "truck") {
        c = {
          in: V([[85, 29.8], [48, 29.8], [42, 25], [x, 15], [x, 8], [x, PUMP_Z]]),
          out: V([[x, PUMP_Z], [x, -9], [x + 2, -13.5], [40, -13.5], [43, -10], [43, 20], [45.5, 25], [50, 26.2], [85, 26.2]]),
        };
      } else {
        c = {
          in: V([[-85, 26.2], [-38, 26.2], [-31, 22.5], [-29, 18], [x, 12], [x, 7], [x, PUMP_Z]]),
          out: V([[x, PUMP_Z], [x, -7], [x + 2.2, -11.5], [35, -11.5], [38.5, -8], [38.5, 19], [41, 24.5], [45, 26.2], [85, 26.2]]),
        };
      }
      curveCache.set(key, c);
    }
    return curveCache.get(key);
  }
  const curveCache = new Map();
  const DELIVERY = () => ({
    in: new THREE.CatmullRomCurve3([[-85, 26.2], [-34, 26.2], [-27, 21.5], [6, 20.8], [21, 20.8]].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal"),
    out: new THREE.CatmullRomCurve3([[21, 20.8], [33, 20.8], [40.5, 24.4], [46, 26.2], [85, 26.2]].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal"),
  });

  function vehiclePhase(v, t) {
    if (t < v.appear || t >= v.gone) return null;
    if (t < v.arrive) return { name: "chegando", curve: "in", u: 1 - Math.pow(1 - (t - v.appear) / (v.arrive - v.appear), 2) };
    if (t < v.leave) return { name: t < v.fuelStart ? "parado" : t < v.fuelEnd ? "abastecendo" : "pagando", curve: "in", u: 1 };
    return { name: "saindo", curve: "out", u: Math.pow((t - v.leave) / (v.gone - v.leave), 2) };
  }
  const PHASE_TXT = { chegando: "Chegando", parado: "Parado na bomba", abastecendo: "Abastecendo", pagando: "Pagando", saindo: "Saindo" };
  function litersNow(v, t) {
    if (t <= v.fuelStart) return 0;
    if (t >= v.fuelEnd) return v.q;
    return v.q * (t - v.fuelStart) / (v.fuelEnd - v.fuelStart);
  }

  function createWorld(container) {
    const T = THREE;
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    container.append(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Posto em 3D. Toque nas coisas para ver detalhes.");

    const scene = new T.Scene();
    scene.background = new T.Color("#a9cfe6");
    scene.fog = new T.Fog("#a9cfe6", 110, 300);
    const camera = new T.PerspectiveCamera(45, 1, 0.3, 600);
    camera.position.set(...CAMS.geral.pos);
    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMS.geral.target);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.06; controls.minDistance = 5; controls.maxDistance = 170;
    controls.screenSpacePanning = false;
    controls.update();

    // Luz
    const hemi = new T.HemisphereLight("#dbefff", "#6b6250", 0.7);
    scene.add(hemi);
    const sun = new T.DirectionalLight("#fff4e0", 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 60, bottom: -60, near: 10, far: 260 });
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    const nightLights = [
      new T.PointLight("#fff1d6", 0, 34, 1.6), new T.PointLight("#fff1d6", 0, 34, 1.6),
      new T.PointLight("#fff1d6", 0, 30, 1.6), new T.PointLight("#fff7e8", 0, 22, 1.6),
    ];
    nightLights[0].position.set(-8, 5, 1); nightLights[1].position.set(8, 5, 1); nightLights[2].position.set(30, 5.6, 1); nightLights[3].position.set(-26, 3.6, -25);
    nightLights.forEach(l => scene.add(l));

    // Materiais
    const M = (color, extra) => new T.MeshLambertMaterial({ color, ...extra });
    const mat = {
      grass: M("#7fa65a"), asphalt: M("#4a4f52"), lot: M("#5b6164"), concrete: M("#c9ccc8"), sidewalk: M("#b9bbb6"),
      curb: M("#d8d8d2"), line: M("#f2f2ee"), yellow: M("#e6b000"), white: M("#f3f5f4"), dark: M("#22272a"),
      wall: M("#e9ece9"), roof: M("#d5d9d7"), accent: M("#0b6e6e"), accent2: M("#0e8a87"), tire: M("#1b1d1f"),
      trunk: M("#6b4c35"), leaf: M("#4f7f3a"), leaf2: M("#5f9444"), pole: M("#8d9396"), soil: new T.MeshLambertMaterial({ color: "#5a4636", side: T.BackSide }),
      glass: new T.MeshPhongMaterial({ color: "#9fc4d6", transparent: true, opacity: 0.32, shininess: 90, depthWrite: false }),
      pad: new T.MeshPhongMaterial({ color: "#c7d7dc", transparent: true, opacity: 0.28, shininess: 60, depthWrite: false }),
      lamp: new T.MeshLambertMaterial({ color: "#fffbe8", emissive: "#fff2c4", emissiveIntensity: 0 }),
      canopyLight: new T.MeshLambertMaterial({ color: "#f7f7f2", emissive: "#fff6dc", emissiveIntensity: 0, transparent: true }),
      skin: M("#c99a74"), uniform: M("#0b6e6e"), pants: M("#2b3236"),
      tankShell: new T.MeshPhongMaterial({ color: "#d9e2e4", transparent: true, opacity: 0.22, shininess: 80, depthWrite: false }),
    };
    const box = (w, h, d, m, x = 0, y = 0, z = 0, cast = true) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; return o; };
    const cyl = (r1, r2, h, m, seg = 16) => { const o = new T.Mesh(new T.CylinderGeometry(r1, r2, h, seg), m); o.castShadow = true; o.receiveShadow = true; return o; };
    const flat = (w, d, m, x, z, y = 0.01) => { const o = new T.Mesh(new T.PlaneGeometry(w, d), m); o.rotation.x = -Math.PI / 2; o.position.set(x, y, z); o.receiveShadow = true; return o; };

    function canvasTex(w, h, draw) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); draw(g, w, h);
      const tex = new T.CanvasTexture(c); tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return { tex, c, g, draw: fn => { fn(g, w, h); tex.needsUpdate = true; } };
    }
    const signTex = (text, bg, fg, w = 1024, h = 128, size = 84) => canvasTex(w, h, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 4);
    }).tex;

    // Telhados: ficam transparentes quando a câmera está alta, para mostrar o que acontece embaixo.
    const roofs = [];
    let roofOpacity = 1;
    function roof(...meshes) {
      for (const m of meshes) {
        m.userData.roof = true;
        m.material = m.material.clone(); m.material.transparent = true; m.userData.shared = true; m.userData.noGlow = true;
        roofs.push(m);
      }
    }
    function fadeRoofs() {
      const o = 1 - 0.88 * smooth(7, 12, camera.position.y);
      if (Math.abs(o - roofOpacity) < 0.01) return;
      roofOpacity = o;
      for (const m of roofs) { m.material.opacity = o; m.material.depthWrite = o > 0.9; }
    }

    // Peças clicáveis
    const pickables = [];
    function pickable(obj, type, id, label) {
      obj.traverse(m => { if (m.isMesh) { m.userData.pick = { type, id }; if (m.material && !m.userData.shared) m.material = m.material.clone(); } });
      obj.userData.pick = { type, id }; obj.userData.label = label;
      pickables.push(obj);
      return obj;
    }

    // ---------- Chão, rua e calçada ----------
    const padHole = () => { const h = new T.Path(); h.moveTo(PAD.x0, -PAD.z0); h.lineTo(PAD.x0, -PAD.z1); h.lineTo(PAD.x1, -PAD.z1); h.lineTo(PAD.x1, -PAD.z0); h.lineTo(PAD.x0, -PAD.z0); return h; };
    const grassShape = new T.Shape();
    grassShape.moveTo(-250, 250); grassShape.lineTo(250, 250); grassShape.lineTo(250, -250); grassShape.lineTo(-250, -250); grassShape.lineTo(-250, 250);
    grassShape.holes.push(padHole());
    const grass = new T.Mesh(new T.ShapeGeometry(grassShape), mat.grass);
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.03; grass.receiveShadow = true; scene.add(grass);
    const lotShape = new T.Shape();
    lotShape.moveTo(-42, 32); lotShape.lineTo(46, 32); lotShape.lineTo(46, -22); lotShape.lineTo(-42, -22); lotShape.lineTo(-42, 32);
    lotShape.holes.push(padHole());
    const lot = new T.Mesh(new T.ShapeGeometry(lotShape), mat.lot);
    lot.rotation.x = -Math.PI / 2; lot.receiveShadow = true; scene.add(lot);
    scene.add(flat(36, 15, mat.concrete, 0, 1, 0.012));
    scene.add(flat(9.5, 19, mat.concrete, 30, 1, 0.012));
    scene.add(flat(400, 8, mat.asphalt, 0, 28, 0.005));
    for (let x = -196; x < 200; x += 8) scene.add(flat(3.2, 0.18, mat.line, x, 28, 0.02));
    // Calçada com as entradas abertas
    [[-200, -36], [-24, 38], [46, 200]].forEach(([a, b]) => {
      scene.add(box(b - a, 0.16, 2, mat.sidewalk, (a + b) / 2, 0.08, 23, false));
    });
    // Faixas da pista e vagas
    for (const x of [-14.6, -9.4, -2.6, 2.6, 9.4, 14.6]) { scene.add(flat(0.12, 6, mat.line, x - 1.35, PUMP_Z, 0.02)); scene.add(flat(0.12, 6, mat.line, x + 1.35, PUMP_Z, 0.02)); }
    for (let i = 0; i < 6; i++) scene.add(flat(0.12, 4.8, mat.line, -35 + i * 3, -16.5, 0.02));
    for (let i = 0; i < 5; i++) scene.add(flat(0.12, 4.8, mat.line, -11 + i * 3, -16.5, 0.02));
    // Setas de entrada e saída
    const arrow = canvasTex(256, 256, g => { g.fillStyle = "#f2f2ee"; g.beginPath(); g.moveTo(128, 20); g.lineTo(220, 130); g.lineTo(160, 130); g.lineTo(160, 236); g.lineTo(96, 236); g.lineTo(96, 130); g.lineTo(36, 130); g.closePath(); g.fill(); });
    const arrowMat = new T.MeshLambertMaterial({ map: arrow.tex, transparent: true });
    const a1 = flat(2.4, 2.4, arrowMat, -30, 19, 0.03); a1.rotation.z = Math.PI; scene.add(a1);
    const a2 = flat(2.4, 2.4, arrowMat, 41, 17, 0.03); scene.add(a2);

    // ---------- Coberturas ----------
    const fascia = signTex("POSTO CATARINENSE", "#0b6e6e", "#ffffff", 1024, 96, 64);
    function canopy(x, z, w, d, h, label) {
      const g = new T.Group();
      const slab = box(w, 0.9, d, mat.white, 0, h, 0); g.add(slab);
      const fm = new T.MeshLambertMaterial({ map: fascia });
      const front = new T.Mesh(new T.PlaneGeometry(w, 0.9), fm); front.position.set(0, h, d / 2 + 0.01); g.add(front);
      const back = new T.Mesh(new T.PlaneGeometry(w, 0.9), fm); back.rotation.y = Math.PI; back.position.set(0, h, -d / 2 - 0.01); g.add(back);
      const side = box(0.02, 0.9, d, mat.accent, w / 2 + 0.01, h, 0, false); g.add(side);
      const side2 = box(0.02, 0.9, d, mat.accent, -w / 2 - 0.01, h, 0, false); g.add(side2);
      roof(slab, front, back, side, side2);
      for (let i = 0; i < Math.floor(w / 6); i++) for (let j = 0; j < 2; j++) {
        const l = new T.Mesh(new T.PlaneGeometry(2.2, 0.6), mat.canopyLight); l.userData.shared = true;
        l.rotation.x = Math.PI / 2; l.position.set(-w / 2 + 3 + i * 6, h - 0.46, (j ? 1 : -1) * d / 4); g.add(l); l.userData.roof = true; roofs.push(l);
      }
      g.position.set(x, 0, z);
      return pickable(g, "pista", label);
    }
    scene.add(canopy(0, PUMP_Z, 36, 15, 5.6, "carros"));
    scene.add(canopy(30, PUMP_Z, 9.5, 19, 6.6, "diesel"));

    // ---------- Bombas ----------
    const pumps = {};
    for (const b of B.LAYOUT.bombas) {
      const diesel = b.tipo === "diesel";
      const g = new T.Group();
      const len = diesel ? 9 : 7.4, h = diesel ? 6.6 : 5.6;
      g.add(box(1.7, 0.18, len + 0.2, mat.yellow, 0, 0.09, 0));
      g.add(box(1.5, 0.26, len, mat.concrete, 0, 0.2, 0));
      for (const z of [-len / 2 + 0.6, len / 2 - 0.6]) { const c = cyl(0.2, 0.2, h - 0.33, mat.white); c.position.set(0, 0.33 + (h - 0.33) / 2, z); g.add(c); }
      const body = box(0.85, 2.3, 1.6, mat.white, 0, 0.33 + 1.15, 0); g.add(body);
      g.add(box(0.9, 0.5, 1.66, mat.accent, 0, 0.33 + 2.55, 0));
      const numTex = signTex(String(b.n), "#0b6e6e", "#ffffff", 128, 128, 96);
      for (const sgn of [-1, 1]) { const p = new T.Mesh(new T.PlaneGeometry(0.42, 0.42), new T.MeshLambertMaterial({ map: numTex })); p.position.set(sgn * 0.452, 0.33 + 2.55, 0); p.rotation.y = sgn * Math.PI / 2; g.add(p); }
      const displays = {};
      const nozzles = {};
      for (const lado of ["A", "B"]) {
        const sgn = lado === "A" ? -1 : 1;
        const disp = canvasTex(256, 128, () => {});
        const plane = new T.Mesh(new T.PlaneGeometry(0.7, 0.35), new T.MeshBasicMaterial({ map: disp.tex }));
        plane.position.set(sgn * 0.43, 0.33 + 1.8, 0); plane.rotation.y = sgn * Math.PI / 2; g.add(plane);
        displays[lado] = { disp, last: "" };
        b.lados[lado].forEach(([n, f], j) => {
          const nz = box(0.14, 0.34, 0.14, M(fuelColor(f)), sgn * 0.5, 0.33 + 1.05, -0.4 + j * 0.8); g.add(nz);
          const tag = box(0.03, 0.16, 0.42, M(fuelColor(f)), sgn * 0.43, 0.33 + 1.38, -0.4 + j * 0.8, false); g.add(tag);
          nozzles[n] = new T.Vector3(PUMP_X[b.n] + sgn * 0.5, 1.4, PUMP_Z - 0.4 + j * 0.8);
        });
      }
      g.position.set(PUMP_X[b.n], 0, PUMP_Z);
      pickable(g, "bomba", b.n, `Bomba ${b.n}`);
      scene.add(g);
      pumps[b.n] = { g, displays, nozzles };
    }
    function drawDisplay(d, liters, value, active) {
      const key = `${active ? 1 : 0}|${liters.toFixed(2)}|${value.toFixed(2)}`;
      if (d.last === key) return;
      d.last = key;
      d.disp.draw((g, w, h) => {
        g.fillStyle = "#0e1515"; g.fillRect(0, 0, w, h);
        g.fillStyle = active ? "#ffb21f" : "#a67614";
        g.font = '44px "Share Tech Mono", monospace'; g.textAlign = "right"; g.textBaseline = "middle";
        g.fillText(B.dec2.format(value), w - 14, 36);
        g.fillText(B.dec2.format(liters), w - 14, 92);
        g.fillStyle = "#cfd8d7"; g.font = '600 22px "Barlow", sans-serif'; g.textAlign = "left";
        g.fillText("R$", 12, 38); g.fillText("L", 12, 94);
      });
    }

    // ---------- Frentistas ----------
    function person(shirt) {
      const g = new T.Group();
      const legs = cyl(0.13, 0.13, 0.82, mat.pants, 8); legs.position.y = 0.41; legs.userData.shared = true; g.add(legs);
      const body = cyl(0.24, 0.21, 0.72, M(shirt), 10); body.position.y = 1.18; g.add(body);
      const head = new T.Mesh(new T.SphereGeometry(0.17, 12, 10), mat.skin); head.position.y = 1.7; head.castShadow = true; head.userData.shared = true; g.add(head);
      return g;
    }
    const attendants = {};
    for (const b of B.LAYOUT.bombas) {
      const p = person("#0b6e6e"); const cap = cyl(0.19, 0.19, 0.1, mat.accent, 10); cap.position.y = 1.83; p.add(cap);
      p.position.set(PUMP_X[b.n] - 1.1, 0.33, PUMP_Z + 2.6);
      scene.add(p); attendants[b.n] = p;
    }

    // ---------- Loja de conveniência ----------
    {
      const { x0, x1, z0, z1 } = STORE, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      const g = new T.Group();
      g.add(box(w, 0.2, d, mat.concrete, cx, 0.1, cz));
      g.add(box(w, 4, 0.3, mat.wall, cx, 2, z0 + 0.15));
      g.add(box(0.3, 4, d, mat.wall, x0 + 0.15, 2, cz));
      g.add(box(0.3, 4, d, mat.wall, x1 - 0.15, 2, cz));
      const sroof = box(w + 0.6, 0.5, d + 0.8, mat.roof, cx, 4.25, cz + 0.2); g.add(sroof); roof(sroof);
      g.add(box(w + 0.62, 0.9, 0.2, mat.accent, cx, 4.0, z1 + 0.62));
      const sign = new T.Mesh(new T.PlaneGeometry(9, 0.8), new T.MeshLambertMaterial({ map: signTex("CONVENIÊNCIA", "#0b6e6e", "#ffffff", 1024, 96, 70) }));
      sign.position.set(cx, 4.0, z1 + 0.73); g.add(sign);
      const glass = new T.Mesh(new T.PlaneGeometry(w - 0.6, 3.6), mat.glass); glass.position.set(cx, 2, z1 - 0.1); glass.userData.shared = true; g.add(glass);
      for (let i = 0; i <= 5; i++) g.add(box(0.12, 3.6, 0.14, mat.dark, x0 + 0.3 + i * (w - 0.6) / 5, 2, z1 - 0.1));
      g.add(box(w - 0.6, 0.14, 0.16, mat.dark, cx, 3.8, z1 - 0.1));
      for (let i = 0; i < 3; i++) for (const zz of [-26, -28.6]) g.add(box(3.2, 1.6, 0.6, M(i % 2 ? "#e1d6c4" : "#d9c9b0"), -32 + i * 5, 0.8, zz));
      const fridge = box(5, 2.2, 0.8, new T.MeshLambertMaterial({ color: "#dfe9ee", emissive: "#9ccde0", emissiveIntensity: 0.35 }), -26, 1.1, z0 + 0.7); g.add(fridge);
      g.add(box(1.0, 1.05, 3.2, mat.accent2, -19.2, 0.62, -24.6));
      g.add(box(0.5, 0.35, 0.4, mat.dark, -19.2, 1.32, -24.0));
      const ceiling = new T.Mesh(new T.PlaneGeometry(w - 2, d - 2), mat.canopyLight); ceiling.userData.shared = true;
      ceiling.rotation.x = Math.PI / 2; ceiling.position.set(cx, 3.95, cz); g.add(ceiling); ceiling.userData.roof = true; roofs.push(ceiling);
      pickable(g, "loja", 1, "Loja");
      scene.add(g);
    }
    // ---------- Troca de óleo ----------
    {
      const { x0, x1, z0, z1 } = OIL, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      const g = new T.Group();
      g.add(box(w, 0.2, d, mat.concrete, cx, 0.1, cz));
      g.add(box(w, 4.4, 0.3, mat.wall, cx, 2.2, z0 + 0.15));
      g.add(box(0.3, 4.4, d, mat.wall, x0 + 0.15, 2.2, cz));
      g.add(box(0.3, 4.4, d, mat.wall, x1 - 0.15, 2.2, cz));
      const oroof = box(w + 0.4, 0.4, d + 0.4, mat.roof, cx, 4.6, cz); g.add(oroof); roof(oroof);
      const sign = new T.Mesh(new T.PlaneGeometry(w - 1, 0.9), new T.MeshLambertMaterial({ map: signTex("TROCA DE ÓLEO", "#eb6834", "#ffffff", 1024, 96, 70) }));
      sign.position.set(cx, 3.9, z1 + 0.02); g.add(sign);
      g.add(box(w - 0.6, 0.55, 0.3, M("#eb6834"), cx, 3.9, z1 - 0.1, false));
      g.add(box(0.5, 1.1, 4.6, mat.yellow, cx - 1.6, 0.75, cz)); g.add(box(0.5, 1.1, 4.6, mat.yellow, cx + 1.6, 0.75, cz));
      for (let i = 0; i < 4; i++) { const dr = cyl(0.32, 0.32, 0.9, M(i % 2 ? "#2a78d6" : "#d03b3b"), 14); dr.position.set(x0 + 0.8 + i * 0.75, 0.65, z0 + 0.8); g.add(dr); }
      g.add(box(2.6, 1.8, 0.5, M("#9aa5a9"), x1 - 1.8, 1.1, z0 + 0.6));
      pickable(g, "oleo", 1, "Troca de óleo");
      scene.add(g);
    }

    // ---------- Totem de preços ----------
    const totemTex = canvasTex(256, 768, () => {});
    {
      const g = new T.Group();
      g.add(box(2.6, 0.5, 1.2, mat.concrete, TOTEM.x, 0.25, TOTEM.z));
      const panel = box(2.3, 7.4, 0.5, mat.dark, TOTEM.x, 4.4, TOTEM.z); g.add(panel);
      const face = new T.Mesh(new T.PlaneGeometry(2.2, 6.6), new T.MeshBasicMaterial({ map: totemTex.tex })); face.position.set(TOTEM.x, 4.4, TOTEM.z + 0.26); g.add(face);
      const back = face.clone(); back.rotation.y = Math.PI; back.position.z = TOTEM.z - 0.26; g.add(back);
      pickable(g, "totem", 1, "Totem");
      scene.add(g);
    }
    function drawTotem(prices) {
      totemTex.draw((g, w, h) => {
        g.fillStyle = "#0e1515"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#0b6e6e"; g.fillRect(0, 0, w, 150);
        g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = '700 54px "Barlow Condensed", sans-serif'; g.fillText("POSTO", w / 2, 50);
        g.font = '700 40px "Barlow Condensed", sans-serif'; g.fillText("CATARINENSE", w / 2, 104);
        const rows = prices.slice(0, 5);
        rows.forEach((r, i) => {
          const y = 190 + i * 118;
          g.fillStyle = r.color; g.fillRect(14, y, 10, 84);
          g.fillStyle = "#cfd8d7"; g.textAlign = "left"; g.font = '600 26px "Barlow Condensed", sans-serif';
          g.fillText(r.label.toUpperCase(), 36, y + 16);
          g.fillStyle = "#ffb21f"; g.font = '58px "Share Tech Mono", monospace'; g.textAlign = "right";
          const s = B.dec3.format(r.price);
          g.fillText(s.slice(0, -1), w - 40, y + 60);
          g.font = '34px "Share Tech Mono", monospace'; g.fillText(s.slice(-1), w - 14, y + 48);
        });
      });
    }

    // ---------- Tanques (com o chão transparente por cima) ----------
    const tanks = {};
    {
      const cx = (PAD.x0 + PAD.x1) / 2, cz = (PAD.z0 + PAD.z1) / 2;
      const pit = new T.Mesh(new T.BoxGeometry(PAD.x1 - PAD.x0, 3.4, PAD.z1 - PAD.z0), mat.soil); pit.position.set(cx, -1.7, cz); scene.add(pit);
      const pad = flat(PAD.x1 - PAD.x0, PAD.z1 - PAD.z0, mat.pad, cx, cz, 0.0); pad.renderOrder = 2; scene.add(pad);
      const frame = [[PAD.x1 - PAD.x0 + 0.3, 0.3, cx, PAD.z0], [PAD.x1 - PAD.x0 + 0.3, 0.3, cx, PAD.z1], [0.3, PAD.z1 - PAD.z0, PAD.x0, cz], [0.3, PAD.z1 - PAD.z0, PAD.x1, cz]];
      frame.forEach(([w, d, x, z]) => scene.add(box(w, 0.08, d, mat.yellow, x, 0.04, z, false)));
      B.LAYOUT.tanques.forEach((tq, i) => {
        const z = TANK_Z[i] ?? (PAD.z0 + 1.4 + i * 1.8);
        const g = new T.Group();
        const shell = new T.Mesh(new T.CylinderGeometry(TANK_R, TANK_R, TANK_L, 28, 1, false), mat.tankShell); shell.userData.shared = true;
        shell.rotation.z = Math.PI / 2; shell.position.set(cx, TANK_Y, z); shell.renderOrder = 1; g.add(shell);
        const plane = new T.Plane(new T.Vector3(0, -1, 0), TANK_Y);
        const liquid = new T.Mesh(new T.CylinderGeometry(TANK_R * 0.93, TANK_R * 0.93, TANK_L - 0.1, 28), new T.MeshLambertMaterial({ color: fuelColor(tq.f), clippingPlanes: [plane], side: T.DoubleSide }));
        liquid.rotation.z = Math.PI / 2; liquid.position.set(cx, TANK_Y, z); g.add(liquid);
        const capMat = M(fuelColor(tq.f));
        const cap = cyl(0.3, 0.3, 0.08, capMat, 18); cap.position.set(PAD.x1 - 1, 0.05, z); g.add(cap);
        const pipe = cyl(0.08, 0.08, 1.0, mat.pole, 8); pipe.position.set(PAD.x1 - 1, -0.5, z); g.add(pipe);
        pickable(g, "tanque", tq.n, `Tanque ${tq.n}`);
        g.traverse(m => { if (m === liquid) m.material.clippingPlanes = [plane]; });
        scene.add(g);
        tanks[tq.n] = { g, plane, tq, z };
      });
    }
    // Volume de um tanque deitado: acha a altura do líquido para a fração cheia.
    function heightFor(frac) {
      if (frac <= 0) return 0; if (frac >= 1) return 1;
      let lo = 0, hi = 1;
      for (let i = 0; i < 22; i++) {
        const h = (lo + hi) / 2, th = 2 * Math.acos(1 - 2 * h);
        if ((th - Math.sin(th)) / (2 * Math.PI) < frac) lo = h; else hi = h;
      }
      return (lo + hi) / 2;
    }

    // ---------- Arredores ----------
    function tree(x, z, s = 1) {
      const g = new T.Group();
      const tr = cyl(0.18 * s, 0.24 * s, 2 * s, mat.trunk, 8); tr.position.y = s; g.add(tr);
      const c = new T.Mesh(new T.IcosahedronGeometry(1.6 * s, 0), (x + z) % 2 ? mat.leaf : mat.leaf2); c.position.y = 2.9 * s; c.castShadow = true; g.add(c);
      g.position.set(x, 0, z); return g;
    }
    for (let x = -40; x <= 44; x += 7) scene.add(tree(x + (x % 3), -36, 0.9 + ((x * 7) % 5) / 10));
    for (let z = -28; z <= 14; z += 7) { scene.add(tree(-47, z, 1)); scene.add(tree(51, z + 3, 0.95)); }
    const buildingColors = ["#d9cbb8", "#c5d0d6", "#e3dccf", "#b8c4b5", "#d6c2b2", "#cfd6dc"];
    for (let i = 0; i < 12; i++) {
      const w = 10 + (i * 37) % 9, h = 4 + (i * 53) % 10, x = -105 + i * 19;
      scene.add(box(w, h, 9, M(buildingColors[i % buildingColors.length]), x, h / 2, 44 + (i % 3) * 2));
    }
    const lamps = [];
    for (const x of [-30, -6, 18, 42]) {
      const p = cyl(0.1, 0.12, 7, mat.pole, 8); p.position.set(x, 3.5, 22.6); scene.add(p);
      const arm = box(0.12, 0.12, 1.6, mat.pole, x, 7, 23.2); scene.add(arm);
      const head = box(0.5, 0.18, 0.8, mat.lamp, x, 6.92, 23.9); head.userData.shared = true; scene.add(head); lamps.push(head);
    }
    // Carros decorativos estacionados na loja
    const parked = [];

    // ---------- Veículos ----------
    const G = {
      body: new T.BoxGeometry(1.8, 0.62, 4.3), cabin: new T.BoxGeometry(1.6, 0.56, 2.2), cabinP: new T.BoxGeometry(1.62, 0.6, 1.7),
      roof: new T.BoxGeometry(1.5, 0.06, 2.0), bed: new T.BoxGeometry(1.7, 0.3, 1.9),
      wheel: new T.CylinderGeometry(0.33, 0.33, 0.24, 14), wheelT: new T.CylinderGeometry(0.5, 0.5, 0.36, 14),
      light: new T.BoxGeometry(0.36, 0.12, 0.05),
      cab: new T.BoxGeometry(2.5, 2.6, 2.4), chassis: new T.BoxGeometry(2.3, 0.5, 10), cargo: new T.BoxGeometry(2.56, 3.0, 7.2),
      tank: new T.CylinderGeometry(1.15, 1.15, 7.6, 24), band: new T.CylinderGeometry(1.17, 1.17, 0.5, 24),
      hose: null,
    };
    const glassMat = new T.MeshPhongMaterial({ color: "#1d2a33", shininess: 90 });
    const headMat = new T.MeshLambertMaterial({ color: "#fffbe8", emissive: "#fff4cc", emissiveIntensity: 0 });
    const tailMat = new T.MeshLambertMaterial({ color: "#a61d1d", emissive: "#ff2a2a", emissiveIntensity: 0 });
    const CAR_COLORS = ["#f2f2f0", "#b9bec2", "#2b2f33", "#7a8085", "#a32424", "#1f4f8f", "#2f5d3a", "#d8d1c4", "#f2f2f0", "#b9bec2"];
    function addWheels(g, geo, list) { list.forEach(([x, y, z]) => { const w = new T.Mesh(geo, mat.tire); w.rotation.z = Math.PI / 2; w.position.set(x, y, z); w.castShadow = true; w.userData.shared = true; g.add(w); }); }
    function addLights(g, zf, zb, y, xs) {
      for (const x of xs) {
        const hl = new T.Mesh(G.light, headMat); hl.position.set(x, y, zf); hl.userData.shared = true; hl.userData.noGlow = true; g.add(hl);
        const tl = new T.Mesh(G.light, tailMat); tl.position.set(x, y, zb); tl.userData.shared = true; tl.userData.noGlow = true; g.add(tl);
      }
    }
    function makeCar(color, pickup) {
      const g = new T.Group();
      const paint = new T.MeshPhongMaterial({ color, shininess: 70 });
      const body = new T.Mesh(G.body, paint); body.position.y = 0.6; body.castShadow = true; g.add(body);
      if (pickup) {
        const cab = new T.Mesh(G.cabinP, glassMat); cab.position.set(0, 1.2, 0.55); cab.userData.shared = true; g.add(cab);
        const roof = new T.Mesh(new T.BoxGeometry(1.52, 0.06, 1.55), paint); roof.position.set(0, 1.52, 0.55); g.add(roof);
        const bed = new T.Mesh(G.bed, mat.dark); bed.position.set(0, 0.98, -1.15); bed.userData.shared = true; g.add(bed);
      } else {
        const cab = new T.Mesh(G.cabin, glassMat); cab.position.set(0, 1.18, -0.15); cab.userData.shared = true; g.add(cab);
        const roof = new T.Mesh(G.roof, paint); roof.position.set(0, 1.48, -0.15); g.add(roof);
      }
      addWheels(g, G.wheel, [[0.86, 0.33, 1.35], [-0.86, 0.33, 1.35], [0.86, 0.33, -1.35], [-0.86, 0.33, -1.35]]);
      addLights(g, 2.16, -2.16, 0.68, [0.6, -0.6]);
      return g;
    }
    function makeTruck(color) {
      const g = new T.Group();
      const paint = new T.MeshPhongMaterial({ color, shininess: 50 });
      const cab = new T.Mesh(G.cab, paint); cab.position.set(0, 2.0, 3.7); cab.castShadow = true; g.add(cab);
      const ws = new T.Mesh(new T.PlaneGeometry(2.2, 1.0), glassMat); ws.position.set(0, 2.6, 4.91); ws.userData.shared = true; g.add(ws);
      const ch = new T.Mesh(G.chassis, mat.dark); ch.position.y = 0.85; ch.userData.shared = true; g.add(ch);
      const cargo = new T.Mesh(G.cargo, new T.MeshLambertMaterial({ color: "#eef0ee" })); cargo.position.set(0, 2.6, -1.4); cargo.castShadow = true; g.add(cargo);
      addWheels(g, G.wheelT, [[1.1, 0.5, 3.6], [-1.1, 0.5, 3.6], [1.1, 0.5, -2.6], [-1.1, 0.5, -2.6], [1.1, 0.5, -3.8], [-1.1, 0.5, -3.8]]);
      addLights(g, 4.92, -5.02, 1.0, [0.9, -0.9]);
      return g;
    }
    function makeTanker() {
      const g = new T.Group();
      const cab = new T.Mesh(G.cab, new T.MeshPhongMaterial({ color: "#eb6834", shininess: 50 })); cab.position.set(0, 2.0, 4.2); cab.castShadow = true; g.add(cab);
      const ws = new T.Mesh(new T.PlaneGeometry(2.2, 1.0), glassMat); ws.position.set(0, 2.6, 5.41); ws.userData.shared = true; g.add(ws);
      const ch = new T.Mesh(G.chassis, mat.dark); ch.position.y = 0.85; ch.userData.shared = true; g.add(ch);
      const tank = new T.Mesh(G.tank, new T.MeshPhongMaterial({ color: "#f4f5f4", shininess: 90 })); tank.rotation.x = Math.PI / 2; tank.position.set(0, 2.3, -1.2); tank.castShadow = true; g.add(tank);
      for (const z of [-3.6, -1.2, 1.2]) { const b = new T.Mesh(G.band, new T.MeshLambertMaterial({ color: "#eb6834" })); b.rotation.x = Math.PI / 2; b.position.set(0, 2.3, z); g.add(b); }
      addWheels(g, G.wheelT, [[1.1, 0.5, 4.1], [-1.1, 0.5, 4.1], [1.1, 0.5, -2.6], [-1.1, 0.5, -2.6], [1.1, 0.5, -3.8], [-1.1, 0.5, -3.8]]);
      addLights(g, 5.42, -5.02, 1.0, [0.9, -0.9]);
      return g;
    }
    for (const [x, c] of [[-29, "#7a8085"], [-20, "#f2f2f0"]]) { const car = makeCar(c, false); car.position.set(x, 0, -16.5); car.rotation.y = Math.PI; scene.add(car); parked.push(car); }

    // Trânsito da rua (só enfeite, sempre no ritmo real)
    const traffic = [];
    for (let i = 0; i < 7; i++) {
      const east = i % 2 === 0;
      const car = makeCar(CAR_COLORS[(i * 3) % CAR_COLORS.length], i === 3);
      car.position.y = 0; car.rotation.y = east ? Math.PI / 2 : -Math.PI / 2;
      scene.add(car);
      traffic.push({ car, east, speed: 9 + (i * 13) % 6, offset: i * 47 });
    }

    // ---------- Seleção ----------
    const ring = new T.Mesh(new T.RingGeometry(1, 1.25, 48), new T.MeshBasicMaterial({ color: "#2fd1c9", transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.visible = false; ring.renderOrder = 5; scene.add(ring);

    // Objetos que vêm e vão (veículos, clientes)
    const dyn = new Map(); // key -> { obj, kind, hose }
    function clearDynamic() {
      for (const [, d] of dyn) { scene.remove(d.obj); if (d.hose) { scene.remove(d.hose); d.hose.geometry.dispose(); } removePick(d.obj); }
      dyn.clear();
    }
    function removePick(obj) { const i = pickables.indexOf(obj); if (i >= 0) pickables.splice(i, 1); }
    function addDyn(key, obj, type, id, label) {
      obj.traverse(m => { if (m.isMesh) m.userData.pick = { type, id }; });
      obj.userData.pick = { type, id }; obj.userData.label = label;
      pickables.push(obj); scene.add(obj);
      const d = { obj, hose: null }; dyn.set(key, d); return d;
    }
    function hoseBetween(a, b) {
      const mid = a.clone().lerp(b, 0.5); mid.y = Math.min(a.y, b.y) - 0.35;
      const curve = new T.QuadraticBezierCurve3(a, mid, b);
      const m = new T.Mesh(new T.TubeGeometry(curve, 16, 0.035, 6, false), mat.dark);
      m.userData.shared = true; return m;
    }

    // ---------- Etiquetas ----------
    const labelsBox = ui.$("w-labels");
    const labels = [];
    function addLabel(type, id, pos, text, near, far) {
      const el = document.createElement("button"); el.type = "button"; el.className = "w-label";
      const dot = document.createElement("i"); const span = document.createElement("span"); span.textContent = text;
      el.append(dot, span); labelsBox.append(el);
      el.addEventListener("click", () => select({ type, id }));
      const L = { type, id, near, far, pos: new T.Vector3(...pos), el, dot, span, set(cls, txt) { if (dot.className !== cls) dot.className = cls; if (span.textContent !== txt) span.textContent = txt; } }; labels.push(L); return L;
    }
    for (const b of B.LAYOUT.bombas) addLabel("bomba", b.n, [PUMP_X[b.n], b.tipo === "diesel" ? 3.9 : 3.6, PUMP_Z], `Bomba ${b.n}`);
    B.LAYOUT.tanques.forEach((tq, i) => addLabel("tanque", tq.n, [PAD.x1 + 0.4, 0.6, TANK_Z[i] ?? PAD.z0 + 1.4 + i * 1.8], `T${tq.n}`, 34));
    const tanksLabel = addLabel("tanque", B.LAYOUT.tanques[0].n, [(PAD.x0 + PAD.x1) / 2, 1.2, PAD.z0 - 0.5], "Tanques", null, 34);
    addLabel("loja", 1, [-26, 5.2, -20], "Loja");
    addLabel("oleo", 1, [-6, 5.4, -20], "Troca de óleo");
    addLabel("totem", 1, [TOTEM.x, 8.6, TOTEM.z], "Totem");
    const v3 = new T.Vector3();
    function placeLabels(w, h) {
      for (const L of labels) {
        const dist = (L.near || L.far) ? camera.position.distanceTo(L.pos) : 0;
        v3.copy(L.pos).project(camera);
        const off = (L.near && dist > L.near) || (L.far && dist <= L.far) || v3.z > 1 || v3.x < -1.1 || v3.x > 1.1 || v3.y < -1.1 || v3.y > 1.1;
        if (off) { if (!L.el.hidden) L.el.hidden = true; continue; }
        if (L.el.hidden) L.el.hidden = false;
        L.el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px, ${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      }
    }

    // ---------- Interação ----------
    const ray = new T.Raycaster();
    const ndc = new T.Vector2();
    function pickAt(cx, cy) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(pickables, true);
      for (const h of hits) {
        if (h.object.userData.roof && roofOpacity < 0.6) continue;
        if (h.object.userData.pick) return h.object.userData.pick;
      }
      return null;
    }
    let down = null;
    renderer.domElement.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    renderer.domElement.addEventListener("pointerup", e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      down = null;
      if (moved > 7 || dt > 600) return;
      select(pickAt(e.clientX, e.clientY));
    });
    let hoverXY = null;
    renderer.domElement.addEventListener("pointermove", e => { if (e.pointerType === "mouse") hoverXY = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerleave", () => { hoverXY = null; setHover(null); });
    function findObj(p) {
      if (!p) return null;
      for (const o of pickables) if (o.userData.pick.type === p.type && o.userData.pick.id === p.id) return o;
      return null;
    }
    function glow(obj, on) {
      if (!obj) return;
      obj.traverse(m => {
        if (!m.isMesh || m.userData.shared || m.userData.noGlow || !m.material || !m.material.emissive) return;
        if (m.userData.e0 == null) m.userData.e0 = m.material.emissive.getHex();
        m.material.emissive.setHex(on ? 0x24504e : m.userData.e0);
      });
    }
    function setHover(p) {
      const same = (a, b) => a && b && a.type === b.type && a.id === b.id;
      if (same(p, hovered) || (!p && !hovered)) return;
      if (hovered && !same(hovered, selected)) glow(findObj(hovered), false);
      hovered = p;
      if (p) glow(findObj(p), true);
      renderer.domElement.style.cursor = p ? "pointer" : "";
    }

    // ---------- Câmera ----------
    // Com o celular em pé a tela é estreita: as vistas prontas ficam mais afastadas.
    function flyCam(key, instant) {
      const c = CAMS[key], k = camera.aspect < 0.8 ? (key === "geral" ? 1.75 : 1.45) : 1;
      const pos = c.pos.map((v, i) => c.target[i] + (v - c.target[i]) * k);
      if (instant) { camera.position.set(...pos); controls.target.set(...c.target); controls.update(); return; }
      flyTo(pos, c.target);
    }
    function flyTo(pos, target) {
      const dur = reduceMotion ? 0 : 900;
      flight = { p0: camera.position.clone(), p1: new T.Vector3(...pos), t0: controls.target.clone(), t1: new T.Vector3(...target), start: performance.now(), dur };
    }

    // ---------- Dia e noite ----------
    const skyDay = new T.Color("#a9cfe6"), skyDusk = new T.Color("#e9a173"), skyNight = new T.Color("#0c1524"), sky = new T.Color();
    function lighting(hour) {
      const rise = 5.75, set = 19.0;
      const day = smooth(rise - 0.5, rise + 0.75, hour) * (1 - smooth(set - 0.75, set + 0.5, hour));
      const dusk = Math.max(0, 1 - Math.abs(hour - set) / 0.9) + Math.max(0, 1 - Math.abs(hour - rise) / 0.9);
      sky.copy(skyNight).lerp(skyDay, day).lerp(skyDusk, clamp(dusk, 0, 1) * 0.55);
      scene.background.copy(sky); scene.fog.color.copy(sky);
      const a = clamp((hour - rise) / (set - rise), 0, 1) * Math.PI;
      sun.position.set(Math.cos(a) * 90, 20 + Math.sin(a) * 90, 50);
      sun.intensity = 0.95 * day;
      hemi.intensity = 0.28 + 0.5 * day;
      hemi.color.set(day > 0.3 ? "#dbefff" : "#8fa3c4");
      const night = 1 - day;
      nightLights.forEach((l, i) => { l.intensity = (i === 3 ? 0.9 : 1.25) * night; });
      mat.canopyLight.emissiveIntensity = 0.15 + 0.85 * night;
      mat.lamp.emissiveIntensity = night;
      headMat.emissiveIntensity = 0.2 + 0.8 * night;
      tailMat.emissiveIntensity = 0.2 + 0.6 * night;
    }

    // ---------- Resize ----------
    function resize() {
      const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w < h ? 58 : 45;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize); ro.observe(container); resize();
    flyCam("geral", true);

    // ---------- Estado de tudo num instante ----------
    function refreshStatic() {
      // Totem: preço médio do dia (ou do último dia com venda daquele combustível)
      const prices = [];
      const m = B.summarize(sim.sales);
      for (const f of B.FUELS) {
        const x = m.fuels[f.k];
        if (x && x.q > 0) prices.push({ label: f.n.replace("Gasolina ", "Gas. "), price: x.v / x.q, color: fuelColor(f.k) });
      }
      drawTotem(prices);
      for (const p of Object.values(pumps)) for (const d of Object.values(p.displays)) d.last = "";
      tankTimer = 0;
    }
    let tankTimer = 0;
    const tankState = {};
    function updateTanks(absT, force) {
      if (!force && performance.now() - tankTimer < 1000) return;
      tankTimer = performance.now();
      for (const n in tanks) {
        const { plane, tq } = tanks[n];
        const same = B.LAYOUT.tanques.filter(x => x.f === tq.f);
        const capAll = same.reduce((a, x) => a + x.cap, 0);
        const st = B.stockAt(tq.f, absT);
        const level = st == null ? null : clamp(st, 0, capAll) * tq.cap / capAll;
        tankState[n] = { level, frac: level == null ? null : level / tq.cap };
        const hgt = level == null ? 0 : heightFor(level / tq.cap);
        plane.constant = TANK_Y - TANK_R * 0.93 + 2 * TANK_R * 0.93 * hgt;
      }
    }

    const state = { here: 0 };
    function update(dtMs, wallMs) {
      const t = sim.t, absT = (sim.day ?? 0) + t;
      lighting(t / H);
      updateTanks(absT);
      // Veículos dos clientes
      const alive = new Set();
      const sideNow = {};
      for (const v of sim.visits) {
        const ph = vehiclePhase(v, t);
        if (!ph) continue;
        alive.add(v.k);
        let d = dyn.get(v.k);
        if (!d) {
          const color = CAR_COLORS[hash(String(v.s.k)) % CAR_COLORS.length];
          const obj = v.kind === "truck" ? makeTruck(["#d03b3b", "#1f4f8f", "#f2f2f0", "#2f5d3a"][hash(String(v.s.k)) % 4]) : makeCar(color, v.kind === "pickup");
          d = addDyn(v.k, obj, "veiculo", v.k, "Veículo");
        }
        const c = vehicleCurves(v)[ph.curve];
        const p = c.getPointAt(clamp(ph.u, 0, 1)), tg = c.getTangentAt(clamp(ph.u, 0.0001, 0.9999));
        d.obj.position.set(p.x, 0, p.z);
        d.obj.rotation.y = Math.atan2(tg.x, tg.z);
        if (ph.name !== "chegando" && ph.name !== "saindo") sideNow[v.side.id] = { v, ph };
        const fueling = ph.name === "abastecendo";
        if (fueling && !d.hose) {
          const noz = pumps[v.side.bomba].nozzles[v.bico] || new T.Vector3(PUMP_X[v.side.bomba], 1.4, PUMP_Z);
          const sgn = v.side.lado === "A" ? 1 : -1;
          const door = new T.Vector3(d.obj.position.x + sgn * (v.kind === "truck" ? 1.3 : 0.92), v.kind === "truck" ? 1.0 : 0.85, PUMP_Z + (v.kind === "truck" ? -1.5 : 1.2));
          d.hose = hoseBetween(noz, door); scene.add(d.hose);
        } else if (!fueling && d.hose) { scene.remove(d.hose); d.hose.geometry.dispose(); d.hose = null; }
      }
      // Clientes da loja
      for (const c of sim.shop) {
        if (t < c.appear || t >= c.gone) continue;
        alive.add(c.k);
        let d = dyn.get(c.k);
        if (!d) d = addDyn(c.k, person(["#d03b3b", "#2a78d6", "#eda100", "#6250d6", "#f2f2f0", "#1baf7a", "#e87ba4"][hash(String(c.s.k)) % 7]), "cliente", c.k, "Cliente");
        let x, z;
        if (t < c.appear + 15 * SEC) { const u = (t - c.appear) / (15 * SEC); x = STORE_DOOR[0] + (c.spot[0] - STORE_DOOR[0]) * u; z = STORE_DOOR[1] + (c.spot[1] - STORE_DOOR[1]) * u; }
        else if (t < c.counter) { x = c.spot[0]; z = c.spot[1]; }
        else if (t < c.counter + 8 * SEC) { const u = (t - c.counter) / (8 * SEC); x = c.spot[0] + (COUNTER[0] - 0.9 - c.spot[0]) * u; z = c.spot[1] + (COUNTER[1] - c.spot[1]) * u; }
        else if (t < c.emit + 5 * SEC) { x = COUNTER[0] - 0.9; z = COUNTER[1]; }
        else { const u = clamp((t - c.emit - 5 * SEC) / (20 * SEC), 0, 1); x = COUNTER[0] - 0.9 + (STORE_DOOR[0] - COUNTER[0] + 0.9) * u; z = COUNTER[1] + (STORE_DOOR[1] + 3 - COUNTER[1]) * u; }
        d.obj.position.set(x, 0.2, z);
      }
      // Caminhão da distribuidora
      for (const e of sim.deliveries) {
        if (t < e.appear || t >= e.gone) continue;
        alive.add(e.k);
        let d = dyn.get(e.k);
        if (!d) d = addDyn(e.k, makeTanker(), "entrega", e.k, "Caminhão-tanque");
        world.deliveryCurve = world.deliveryCurve || DELIVERY();
        let c, u;
        if (t < e.arrive) { c = world.deliveryCurve.in; u = 1 - Math.pow(1 - (t - e.appear) / (e.arrive - e.appear), 2); }
        else if (t < e.leave) { c = world.deliveryCurve.in; u = 1; }
        else { c = world.deliveryCurve.out; u = Math.pow((t - e.leave) / (e.gone - e.leave), 2); }
        const p = c.getPointAt(clamp(u, 0, 1)), tg = c.getTangentAt(clamp(u, 0.0001, 0.9999));
        d.obj.position.set(p.x, 0, p.z); d.obj.rotation.y = Math.atan2(tg.x, tg.z);
        const unloading = t >= e.arrive + 2 * MIN && t < e.leave - 2 * MIN;
        if (unloading && !d.hose) { d.hose = hoseBetween(new T.Vector3(19.2, 1.0, 19.6), new T.Vector3(PAD.x1 - 1, 0.1, TANK_Z[2])); scene.add(d.hose); }
        else if (!unloading && d.hose) { scene.remove(d.hose); d.hose.geometry.dispose(); d.hose = null; }
      }
      for (const [k, d] of dyn) {
        if (alive.has(k)) continue;
        scene.remove(d.obj); if (d.hose) { scene.remove(d.hose); d.hose.geometry.dispose(); }
        removePick(d.obj); dyn.delete(k);
        if (selected && selected.id === k) select(null);
      }
      state.here = [...alive].filter(k => k[0] === "v" || k[0] === "c").length;
      state.sideNow = sideNow;
      // Mostradores das bombas e frentistas
      for (const b of B.LAYOUT.bombas) {
        let busySide = null;
        for (const lado of ["A", "B"]) {
          const sn = sideNow[b.n + lado];
          const disp = pumps[b.n].displays[lado];
          if (sn) {
            const L = litersNow(sn.v, t);
            drawDisplay(disp, L, sn.v.v * (sn.v.q ? L / sn.v.q : 0), sn.ph.name === "abastecendo");
            if (sn.ph.name === "abastecendo" || !busySide) busySide = lado;
          } else {
            const last = lastOnSide(b.n + lado, t);
            drawDisplay(disp, last ? last.q : 0, last ? last.v : 0, false);
          }
        }
        const at = attendants[b.n];
        const sgn = busySide === "A" ? -1 : busySide === "B" ? 1 : 0;
        const tx = PUMP_X[b.n] + (sgn ? sgn * 1.25 : -1.1), tz = PUMP_Z + (sgn ? -2.2 : 2.6);
        const k = 1 - Math.pow(0.002, dtMs / 1000);
        at.position.x += (tx - at.position.x) * k; at.position.z += (tz - at.position.z) * k;
        at.rotation.y = sgn ? (sgn > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
      }
      // Trânsito da rua
      const secs = wallMs / 1000;
      for (const tr of traffic) {
        const s = ((tr.offset + secs * tr.speed) % 340);
        tr.car.position.set(tr.east ? -170 + s : 170 - s, 0, tr.east ? 26.2 : 29.8);
      }
      // Etiquetas
      for (const L of labels) {
        if (L.type === "bomba") {
          const a = sideNow[L.id + "A"], b2 = sideNow[L.id + "B"];
          const busy = [a, b2].filter(Boolean);
          const fueling = busy.some(x => x.ph.name === "abastecendo");
          L.set(fueling ? "busy" : "", `Bomba ${L.id}` + (busy.length ? ` · ${busy.length === 2 ? "2 veículos" : fueling ? "abastecendo" : "ocupada"}` : ""));
        } else if (L.type === "tanque" && L !== tanksLabel) {
          const ts = tankState[L.id];
          const tq = tanks[L.id].tq;
          if (!ts || ts.frac == null) L.set("off", `T${L.id} · ${fuelName(tq.f)}`);
          else {
            const days = autonomy(tq.f, ts.level);
            L.set(days != null && days < 2 ? "bad" : days != null && days < 4 ? "busy" : "", `T${L.id} · ${B.pct.format(ts.frac)}`);
          }
        } else if (L === tanksLabel) {
          // Aponta para o tanque que acaba primeiro
          let worst = null, wd = Infinity;
          for (const tq of B.LAYOUT.tanques) { const ts = tankState[tq.n]; const d = ts ? autonomy(tq.f, ts.level) : null; if (d != null && d < wd) { wd = d; worst = tq; } }
          if (worst) L.id = worst.n;
          const urgent = B.LAYOUT.tanques.filter(tq => { const ts = tankState[tq.n]; const d = ts ? autonomy(tq.f, ts.level) : null; return d != null && d < 2; }).length;
          L.set(urgent ? "bad" : wd < 4 ? "busy" : worst ? "" : "off", urgent ? `Tanques · ${urgent} para pedir hoje` : "Tanques");
        } else if (L.type === "loja") {
          const n = sim.shop.filter(c => t >= c.appear && t < c.gone).length;
          L.set(n ? "busy" : "", n ? `Loja · ${n} cliente${n > 1 ? "s" : ""}` : "Loja");
        }
      }
      // Anel de seleção
      const so = findObj(selected);
      if (so) {
        const bbox = new T.Box3().setFromObject(so);
        const c = bbox.getCenter(v3), size = bbox.getSize(new T.Vector3());
        const r = clamp(Math.max(size.x, size.z) * 0.45, 1.2, 6);
        ring.visible = true; ring.position.set(c.x, selected.type === "tanque" ? 0.08 : 0.06, c.z);
        ring.scale.setScalar(r * (1 + 0.04 * Math.sin(wallMs / 220)));
      } else ring.visible = false;
    }
    function lastOnSide(id, t) {
      let best = null;
      for (const v of sim.visits) if (v.side.id === id && v.fuelEnd <= t && (!best || v.fuelEnd > best.fuelEnd)) best = v;
      return best;
    }

    function render(wallMs) {
      if (flight) {
        const u = flight.dur ? clamp((performance.now() - flight.start) / flight.dur, 0, 1) : 1;
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        camera.position.lerpVectors(flight.p0, flight.p1, e);
        controls.target.lerpVectors(flight.t0, flight.t1, e);
        if (u >= 1) flight = null;
      }
      controls.update();
      fadeRoofs();
      if (hoverXY) setHover(pickAt(hoverXY[0], hoverXY[1]));
      renderer.render(scene, camera);
      placeLabels(container.clientWidth, container.clientHeight);
    }

    return { renderer, scene, camera, controls, update, render, clearDynamic, refreshStatic, findObj, glow, tankState, state, flyTo, flyCam, dispose: () => ro.disconnect(), updateTanks };
  }

  function autonomy(f, level) {
    const avg = sim.avgDaily[f] || 0;
    return level != null && avg > 0 ? level / avg : null;
  }

  function flyTo(pos, target) { if (world) world.flyTo(pos, target); }

  // ---------- Painel de detalhes ----------
  let panelTimer = 0;
  function select(p) {
    if (world) {
      const prev = selected && world.findObj(selected);
      if (prev) world.glow(prev, false);
      if (p) world.glow(world.findObj(p), true);
    }
    selected = p;
    const panel = ui.$("w-panel");
    ui.root.classList.toggle("has-panel", !!p);
    if (!p) { panel.hidden = true; return; }
    ui.$("w-hint").hidden = true;
    panel.hidden = false;
    renderPanel(true);
  }
  const kv = (k, v) => `<div class="w-kv"><span>${esc(k)}</span><span>${v}</span></div>`;
  const sw = f => `<i class="sw" style="background:${fuelColor(f)}"></i>`;
  const payName = s => { const k = Object.keys(s.pays || {}).sort((a, b) => s.pays[b] - s.pays[a])[0]; const p = B.PAYS.find(x => x.k === k); return p ? p.n : "Não informado"; };
  function done(t) { return sim.sales.filter(s => s.t - sim.day <= t); }

  function renderPanel(force) {
    if (!selected || !ui) return;
    if (!force && performance.now() - panelTimer < 400) return;
    panelTimer = performance.now();
    const t = sim.t, p = selected;
    const $ = ui.$;
    let eyebrow = "", title = "", sub = "", body = "";
    const real = B.state.db.mode === "real";
    if (p.type === "bomba") {
      const b = B.LAYOUT.bombas.find(x => x.n === p.id);
      const fuels = [...new Set([...b.lados.A, ...b.lados.B].map(x => x[1]))];
      eyebrow = b.tipo === "diesel" ? "Ilha de diesel" : `Ilha ${b.n}`;
      title = `Bomba ${b.n}`;
      sub = fuels.map(fuelName).join(", ");
      const sideNow = (world && world.state.sideNow) || {};
      for (const lado of ["A", "B"]) {
        const sn = sideNow[b.n + lado];
        if (sn) {
          const L = litersNow(sn.v, t), val = sn.v.v * (sn.v.q ? L / sn.v.q : 0);
          const veh = sn.v.kind === "truck" ? "Caminhão" : sn.v.kind === "pickup" ? "Picape" : "Carro";
          body += `<div class="w-side busy"><div class="w-side-h"><span>Lado ${lado} · ${PHASE_TXT[sn.ph.name]}</span><span>${veh}</span></div>
            <div class="w-led"><span><small>R$ </small>${B.dec2.format(val)}</span><span>${B.dec2.format(L)}<small> L</small></span></div>
            ${kv("Bico", `${sw(sn.v.f)} ${sn.v.bico} · ${esc(fuelName(sn.v.f))}${sn.v.est ? " (estimado)" : ""}`)}
            ${sn.ph.name === "abastecendo" ? `<div class="w-bar"><div style="width:${(L / sn.v.q * 100).toFixed(1)}%"></div></div>` : ""}</div>`;
        } else {
          const last = (world && lastOnSideG(b.n + lado, t));
          body += `<div class="w-side"><div class="w-side-h"><span>Lado ${lado} · Livre</span><span class="pill ok">Livre</span></div>
            ${last ? `<p class="w-note">Último: ${hm(last.emit)} · ${B.dec2.format(last.q)} L de ${esc(fuelName(last.f))} · ${B.brl.format(last.v)}</p>` : `<p class="w-note">Nenhum abastecimento ainda hoje.</p>`}</div>`;
        }
      }
      const rows = [...b.lados.A, ...b.lados.B].map(([n, f]) => {
        const vs = sim.visits.filter(v => v.bico === n && v.side.bomba === b.n && v.fuelEnd <= t);
        return { n, f, c: vs.length, q: vs.reduce((a, v) => a + v.q, 0), v: vs.reduce((a, v) => a + v.v, 0) };
      });
      body += `<div class="w-sec"><h3>Hoje até agora</h3><div class="tbl-wrap"><table><thead><tr><th>Bico</th><th class="r">Abast.</th><th class="r">Litros</th><th class="r">Valor</th></tr></thead><tbody>${
        rows.map(r => `<tr><td><span class="fuel-name">${sw(r.f)}${r.n} · ${esc(fuelName(r.f))}</span></td><td class="r">${B.int.format(r.c)}</td><td class="r">${B.int.format(r.q)}</td><td class="r">${B.money(r.v)}</td></tr>`).join("")
      }</tbody></table></div>`;
      body += `<p class="w-note">${real ? "Quando a nota não informa o bico, o Board escolhe um bico livre do mesmo combustível." : "Dados de exemplo."} Encerrantes e alarmes da bomba chegam com a ligação ao Meta Posto.</p></div>`;
    } else if (p.type === "veiculo") {
      const v = sim.visits.find(x => x.k === p.id);
      if (!v) { select(null); return; }
      const ph = vehiclePhase(v, t) || { name: "saindo" };
      const L = litersNow(v, t);
      eyebrow = v.kind === "truck" ? "Caminhão" : v.kind === "pickup" ? "Picape" : "Carro";
      title = `Na bomba ${v.side.bomba}, lado ${v.side.lado}`;
      sub = PHASE_TXT[ph.name];
      body += `<div class="w-led"><span><small>R$ </small>${B.dec2.format(v.v * (v.q ? L / v.q : 0))}</span><span>${B.dec2.format(L)}<small> L</small></span></div>`;
      if (ph.name === "abastecendo") body += `<div class="w-bar"><div style="width:${(L / v.q * 100).toFixed(1)}%"></div></div>`;
      body += `<div class="w-sec">${kv("Combustível", `${sw(v.f)} ${esc(fuelName(v.f))}`)}${kv("Bico", `${v.bico}${v.est ? " (estimado)" : ""}`)}${kv("Litros na nota", B.dec2.format(v.q) + " L")}${kv("Valor do combustível", B.brl.format(v.v))}${kv("Pagamento", esc(payName(v.s)))}${kv("Nota emitida", hm(v.emit))}</div>`;
      if (v.other.length) body += `<div class="w-sec"><h3>Levou também</h3><ul class="w-list">${v.other.map(i => `<li><span>${B.int.format(i.q)}×</span><span>${esc(i.p)}</span><span>${B.brl.format(i.v)}</span></li>`).join("")}</ul></div>`;
    } else if (p.type === "tanque") {
      const tq = B.LAYOUT.tanques.find(x => x.n === p.id);
      const ts = world ? world.tankState[p.id] : null;
      eyebrow = `Tanque ${tq.n}`; title = fuelName(tq.f); sub = `Capacidade de ${B.int.format(tq.cap)} litros`;
      if (!ts || ts.level == null) body += `<p>Digite o estoque atual no Board, no cartão <b>Estoque dos tanques</b>, para ver o nível deste tanque.</p>`;
      else {
        const days = autonomy(tq.f, ts.level);
        const lvl = days == null ? "ok" : days < 2 ? "bad" : days < 4 ? "warn" : "ok";
        const word = { bad: "Pedir hoje", warn: "Pedir logo", ok: "Tranquilo" }[lvl];
        body += `<div class="w-big">${B.int.format(ts.level)} L<small>${B.pct.format(ts.frac)} cheio</small></div><div class="w-bar"><div style="width:${(ts.frac * 100).toFixed(1)}%;background:${fuelColor(tq.f)}"></div></div>`;
        body += `<div class="w-sec">${kv("Espaço livre", B.int.format(tq.cap - ts.level) + " L")}${days != null ? kv("Dura", `${B.dec1.format(days)} dias <span class="pill ${lvl}">${word}</span>`) : ""}`;
      }
      const sold = sim.visits.filter(v => v.f === tq.f && v.fuelEnd <= t).reduce((a, v) => a + v.q, 0);
      const ins = sim.deliveries.flatMap(e => e.p.items.filter(i => i.f === tq.f).map(i => ({ ...i, at: e.p.t - sim.day }))).filter(i => i.at <= t);
      body += `${ts && ts.level != null ? "" : "<div class=\"w-sec\">"}${kv("Vendido hoje até agora", B.int.format(sold) + " L")}${ins.map(i => kv(`Entrada às ${hm(i.at)}`, B.int.format(i.q) + " L")).join("")}</div>`;
      body += `<p class="w-note">Nível estimado: estoque digitado no Board, menos o que foi vendido e mais o que entrou pelas notas de compra. A medição do tanque chega com a ligação ao Meta Posto.</p>`;
    } else if (p.type === "loja") {
      const list = done(t).filter(s => s.items.some(i => i.g === "conv"));
      const items = list.flatMap(s => s.items.filter(i => i.g === "conv"));
      const rev = items.reduce((a, i) => a + i.v, 0);
      const inside = sim.shop.filter(c => t >= c.appear && t < c.gone).length;
      eyebrow = "Conveniência"; title = "Loja"; sub = `${inside} cliente${inside === 1 ? "" : "s"} agora`;
      body += `<div class="w-big">${B.money(rev)}<small>hoje até agora</small></div>`;
      body += `<div class="w-sec">${kv("Vendas", B.int.format(list.length))}${kv("Ticket médio", list.length ? B.brl.format(rev / list.length) : "—")}</div>`;
      const top = {};
      for (const i of items) { const x = top[i.p] || (top[i.p] = { q: 0, v: 0 }); x.q += i.q; x.v += i.v; }
      const topList = Object.entries(top).sort((a, b) => b[1].v - a[1].v).slice(0, 5);
      if (topList.length) body += `<div class="w-sec"><h3>Mais vendidos hoje</h3><ul class="w-list">${topList.map(([n, x]) => `<li><span>${B.int.format(x.q)}×</span><span>${esc(n)}</span><span>${B.brl.format(x.v)}</span></li>`).join("")}</ul></div>`;
      const last = list.slice(-5).reverse();
      if (last.length) body += `<div class="w-sec"><h3>Últimas vendas</h3><ul class="w-list">${last.map(s => `<li><span>${hm(s.t - sim.day)}</span><span>${esc(s.items.filter(i => i.g === "conv").map(i => i.p).join(", "))}</span><span>${B.brl.format(s.items.filter(i => i.g === "conv").reduce((a, i) => a + i.v, 0))}</span></li>`).join("")}</ul></div>`;
      const pays = {}; for (const s of list) for (const k in s.pays) pays[k] = (pays[k] || 0) + s.pays[k];
      const tot = Object.values(pays).reduce((a, v) => a + v, 0);
      if (tot) body += `<div class="w-sec"><h3>Formas de pagamento no caixa</h3>${B.PAYS.filter(x => pays[x.k]).map(x => kv(x.n, B.pct.format(pays[x.k] / tot))).join("")}</div>`;
    } else if (p.type === "cliente") {
      const c = sim.shop.find(x => x.k === p.id);
      if (!c) { select(null); return; }
      eyebrow = "Cliente da loja"; title = B.brl.format(c.s.items.reduce((a, i) => a + i.v, 0));
      sub = t < c.counter ? "Escolhendo" : t < c.emit + 5 * SEC ? "No caixa" : "Saindo";
      body += `<ul class="w-list">${c.s.items.map(i => `<li><span>${B.int.format(i.q)}×</span><span>${esc(i.p)}</span><span>${B.brl.format(i.v)}</span></li>`).join("")}</ul>`;
      body += `<div class="w-sec">${kv("Pagamento", esc(payName(c.s)))}${kv("Nota emitida", hm(c.emit))}</div>`;
    } else if (p.type === "oleo") {
      const items = done(t).flatMap(s => s.items.filter(i => i.g === "pista"));
      const rev = items.reduce((a, i) => a + i.v, 0);
      eyebrow = "Pista"; title = "Troca de óleo"; sub = "Lubrificantes, ARLA e aditivos";
      body += `<div class="w-big">${B.money(rev)}<small>hoje até agora</small></div>`;
      const top = {};
      for (const i of items) { const x = top[i.p] || (top[i.p] = { q: 0, v: 0 }); x.q += i.q; x.v += i.v; }
      const list = Object.entries(top).sort((a, b) => b[1].v - a[1].v);
      body += list.length ? `<div class="w-sec"><h3>Vendido hoje</h3><ul class="w-list">${list.map(([n, x]) => `<li><span>${B.int.format(x.q)}×</span><span>${esc(n)}</span><span>${B.brl.format(x.v)}</span></li>`).join("")}</ul></div>` : `<p class="w-note">Nada vendido ainda hoje.</p>`;
    } else if (p.type === "totem") {
      const m = B.summarize(done(t).length ? done(t) : sim.sales);
      const pc = B.purchaseCost();
      eyebrow = "Totem de preços"; title = "Preços de hoje"; sub = "Preço médio por litro nas vendas do dia";
      body += `<div class="tbl-wrap"><table><thead><tr><th>Combustível</th><th class="r">Preço</th><th class="r">Custo</th><th class="r">Margem</th></tr></thead><tbody>${
        B.FUELS.filter(f => m.fuels[f.k] && m.fuels[f.k].q > 0).map(f => {
          const pr = m.fuels[f.k].v / m.fuels[f.k].q, c = B.costFor(f.k, pc);
          return `<tr><td><span class="fuel-name">${sw(f.k)}${esc(f.n)}</span></td><td class="r">${B.dec3.format(pr)}</td><td class="r">${c ? B.dec3.format(c.v) : "—"}</td><td class="r">${c ? B.brl.format(pr - c.v) : "—"}</td></tr>`;
        }).join("")
      }</tbody></table></div><p class="w-note">Margem por litro. O custo vem das notas de compra ou do que foi digitado no Board.</p>`;
    } else if (p.type === "entrega") {
      const e = sim.deliveries.find(x => x.k === p.id);
      if (!e) { select(null); return; }
      eyebrow = "Caminhão-tanque"; title = "Entrega da distribuidora";
      sub = t < e.arrive ? "Chegando" : t < e.leave ? "Descarregando nos tanques" : "Saindo";
      body += `<div class="w-sec">${kv("Nota de compra", hm(e.p.t - sim.day))}${e.p.items.map(i => kv(fuelName(i.f), `${B.int.format(i.q)} L · ${B.brl.format(i.v / i.q)}/L`)).join("")}${kv("Total", B.money(e.p.items.reduce((a, i) => a + i.v, 0)))}</div>`;
    } else if (p.type === "pista") {
      const list = done(t).filter(s => s.items.some(i => i.f));
      const m = B.summarize(list);
      eyebrow = "Pista"; title = p.id === "diesel" ? "Cobertura do diesel" : "Cobertura das bombas"; sub = "Abastecimentos de hoje até agora";
      body += `<div class="w-big">${B.int.format(m.liters)} L<small>${B.int.format(list.length)} abastecimentos</small></div>`;
      body += `<div class="w-sec">${B.FUELS.filter(f => m.fuels[f.k]).map(f => kv(f.n, `${B.int.format(m.fuels[f.k].q)} L · ${B.money(m.fuels[f.k].v)}`)).join("")}</div>`;
    }
    $("w-p-eyebrow").textContent = eyebrow;
    $("w-p-title").textContent = title;
    $("w-p-sub").textContent = sub;
    const bodyEl = $("w-p-body");
    const top = bodyEl.scrollTop;
    bodyEl.innerHTML = body + (["veiculo", "cliente", "entrega"].includes(p.type) ? "" : `<button type="button" class="w-ibtn" id="w-p-fly">Aproximar</button>`);
    bodyEl.scrollTop = top;
    const fly = bodyEl.querySelector("#w-p-fly");
    if (fly) fly.addEventListener("click", () => {
      const o = world && world.findObj(selected);
      if (!o) return;
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const dir = world.camera.position.clone().sub(world.controls.target).normalize();
      const dist = selected.type === "loja" || selected.type === "oleo" ? 18 : 11;
      flyTo([c.x + dir.x * dist, Math.max(4, c.y + dir.y * dist), c.z + dir.z * dist], [c.x, Math.max(0, c.y), c.z]);
    });
  }
  function lastOnSideG(id, t) {
    let best = null;
    for (const v of sim.visits) if (v.side.id === id && v.fuelEnd <= t && (!best || v.fuelEnd > best.fuelEnd)) best = v;
    return best;
  }

  // ---------- Placar do topo ----------
  let hudTimer = 0;
  function updateHud() {
    if (performance.now() - hudTimer < 250) return;
    hudTimer = performance.now();
    const $ = ui.$, t = sim.t;
    $("w-clock").textContent = hms(t);
    $("w-date").textContent = sim.day != null ? B.fmtWeekday(sim.day) : "";
    const list = done(t);
    const m = B.summarize(list);
    $("w-rev").textContent = B.money(m.rev);
    $("w-lit").textContent = B.int.format(m.liters) + " L";
    $("w-n").textContent = B.int.format(m.fuelSales);
    $("w-here").textContent = world ? String(world.state.here) : "—";
    const r = $("w-range");
    if (document.activeElement !== r) r.value = String(Math.floor(t / 60000) * 60);
  }

  // ---------- Laço ----------
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(100, now - (lastFrame || now));
    lastFrame = now;
    if (sim.live) {
      const d = new Date();
      sim.t = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * SEC + d.getMilliseconds();
    } else if (sim.playing) {
      sim.t += dt * sim.speed;
      if (sim.t >= 24 * H - SEC) { sim.t = 24 * H - SEC; sim.playing = false; syncControls(); }
    }
    world.update(dt, now);
    world.render(now);
    updateHud();
    renderPanel(false);
  }

  async function open() {
    if (!ui) buildUI();
    document.body.style.overflow = "hidden";
    ui.root.hidden = false;
    if (running) return;
    try {
      await ensureThree();
      if (document.fonts && document.fonts.load) await Promise.all([document.fonts.load('700 40px "Barlow Condensed"'), document.fonts.load('40px "Share Tech Mono"')]).catch(() => {});
    } catch (e) {
      showMsg("Não deu para carregar o 3D", "Confira a internet e tente de novo.", true);
      return;
    }
    if (location.hash !== "#posto-3d") return;
    if (!world) {
      try { world = createWorld(ui.$("w-canvas")); }
      catch (e) { showMsg("Este aparelho não abriu o 3D", "O navegador não liberou o WebGL. Tente em outro navegador ou no computador.", false); return; }
      goLive();
    } else syncControls();
    ui.$("w-msg").hidden = true;
    running = true; lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }
  function close() {
    if (!ui) return;
    running = false; cancelAnimationFrame(raf);
    ui.root.hidden = true;
    document.body.style.overflow = "";
  }
  function route() {
    const on = location.hash === "#posto-3d";
    const board = document.getElementById("board-view");
    if (board) board.hidden = on;
    if (on) open(); else close();
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("bpc:change", () => { if (world) { curveCache.clear(); const d = B.salesDays(); planDay(d.includes(sim.day) ? sim.day : d[d.length - 1] ?? null); syncControls(); } });
  route();
})();
