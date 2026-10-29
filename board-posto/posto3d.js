/* Board Posto Catarinense — o posto em 3D, montado a partir da foto do posto.
   Cada venda vira um veículo na bomba, no horário em que aconteceu. */
(() => {
  "use strict";
  const B = window.BPC;
  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
  const ORBIT_URL = "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js";
  const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
  const fuelColor = f => SERIES[((B.FUEL[f] && B.FUEL[f].s) || 1) - 1];
  const fuelName = f => (B.FUEL[f] ? B.FUEL[f].n : "Combustível");
  const SHORT = { gc: "Gasolina", ga: "Aditivada", gp: "Premium", et: "Etanol", d10: "Diesel S10", d10a: "S10 aditivado", d500: "Diesel S500", gnv: "GNV" };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 3600) % 24).padStart(2, "0") + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const hm = ms => hms(ms).slice(0, 5);
  const SEC = 1000, MIN = 60000, H = 3600000;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Planta do posto (metros), tirada da foto ----------
  // x corre ao longo da rua da frente; z cresce na direção da rua.
  // No fundo fica o prédio com a varanda de onde a foto foi tirada (a conveniência é de outro dono e não aparece).
  // Olhando da varanda para a rua, x positivo fica à esquerda (onde estão o muro e a cabine).
  const BOMBA = Object.fromEntries(B.LAYOUT.bombas.map(b => [b.n, b]));
  const WALL_X = 8.2;                                  // muro do vizinho, à esquerda
  const LOT = { x0: -34.6, x1: WALL_X, z0: -15.6, z1: 22 };
  const CANOPY = { x0: -9, x1: WALL_X, z0: -15.6, z1: 10.5, h: 6 };
  const BUILDING = { x0: -12, x1: WALL_X, z0: -24, z1: -15.6, h1: 3.8, h2: 7.4 };
  const KIOSK = { x0: 6, x1: WALL_X, z0: -10, z1: -4.5, h: 2.8 };
  const PAD = { x0: -31.5, x1: -21, z0: -8.6, z1: 2 };
  const TANK_Y = -1.6, TANK_R = 0.78, TANK_L = 8.6;
  const tankZ = i => PAD.z1 - 1.1 - i * 1.75;
  const TOTEM = { x: -11.5, z: 18.5 };
  const ROAD = { z0: 22, z1: 30, east: 24, west: 28 };
  // Colunas: uma por bomba (2 m antes do dispenser) e a da ilha sem bomba, ao lado da cabine.
  const EXTRA_ISLANDS = [{ x: 4.5, z: -4 }];
  const COLUMNS = [...B.LAYOUT.bombas.map(b => [b.x, b.z - 2]), ...EXTRA_ISLANDS.map(i => [i.x, i.z - 2])];
  const RED = "#cf2a1b", YELLOW = "#f6c400";
  const laneX = side => side.x + (side.lado === "A" ? -1 : 1) * 2.6;
  const CAMS = {
    geral: { label: "Geral", pos: [24, 34, 50], target: [-6, 0, -2] },
    varanda: { label: "Da varanda", pos: [-1.85, 5.1, -15.1], target: [-1.0, 0.6, -2] },
    pista: { label: "Pista", pos: [11, 10, 22], target: [-1, 1, 0] },
    diesel: { label: "Diesel", pos: [15, 6.5, 17], target: [4.5, 1.5, 6] },
    oleo: { label: "Troca de óleo", pos: [-1, 4.2, 5], target: [7, 1.2, -7] },
    tanques: { label: "Tanques", pos: [-14, 10, 12], target: [-26, -1, -3] },
  };

  // ---------- Caminhos dos veículos ----------
  // Todos entram pela pista da rua mais perto do posto (vindo da direita de quem olha da varanda)
  // e saem pela área aberta, do lado oposto ao muro.
  const ENTRY = [[95, ROAD.east], [34, ROAD.east]];
  const TAIL_BACK = [[-10, -12.4], [-14.5, -9.5], [-15.8, 2], [-16.5, 14], [-20, 20.5], [-26, ROAD.east], [-95, ROAD.east]];
  const TAIL_SIDE = [[-15.8, 4], [-16.5, 14], [-20, 20.5], [-26, ROAD.east], [-95, ROAD.east]];
  const enter = x => x > 5 ? [...ENTRY, [x + 4, 23], [x + 0.2, 18], [x, 13]] : [...ENTRY, [x + 6, 22.6], [x, 14]];
  function routePoints(kind, side) {
    const lx = laneX(side), zd = side.z;
    const stop = kind === "truck" ? zd + 2.2 : zd - 1.0;   // o bocal fica na altura do dispenser
    const wallLine = side.x > 0, far = zd > 0;
    const outer = wallLine ? side.lado === "B" : side.lado === "A";   // faixa de fora (longe do corredor do meio)
    const IN = [...enter(lx), [lx, stop + 4], [lx, stop]];
    if (far && wallLine && outer) return { in: IN, out: [[lx, stop], [lx, zd - 4.5], [2.4, -1], [0.2, -8], [-2, -11.8], ...TAIL_BACK] };
    if (far && wallLine) return { in: IN, out: [[lx, stop], [lx, zd - 6], [0.6, zd - 9], [0.6, -9], [-2, -11.8], ...TAIL_BACK] };
    if (far && !outer) return { in: IN, out: [[lx, stop], [lx, zd - 6], [-0.1, zd - 8.5], [-0.1, -9], [-2.2, -11.8], ...TAIL_BACK] };
    if (far) return { in: IN, out: [[lx, stop], [lx, zd - 4.5], [-10.5, zd - 8.5], [-14.5, zd - 7], ...TAIL_SIDE] };
    if (!wallLine && !outer) return { in: [...enter(0), [0, zd + 9], [lx, zd + 4.5], [lx, stop]], out: [[lx, stop], [lx, -9.5], [-4, -12], ...TAIL_BACK] };
    if (!wallLine) return { in: [...enter(-9.6), [-9.6, zd + 9], [lx, zd + 4.5], [lx, stop]], out: [[lx, stop], [lx, -9], [-10, -12], ...TAIL_BACK.slice(1)] };
    return { in: IN, out: [[lx, stop], [lx, -11], [lx - 3, -12.4], ...TAIL_BACK.filter(p => p[0] < lx - 3)] };
  }
  const DELIVERY_PTS = {
    in: [...ENTRY, [-8, 23.4], [-19.5, 15], [-19.5, 6], [-19.5, -1]],
    out: [[-19.5, -1], [-19.5, -9], [-23, -12.6], [-32.3, -10.6], [-33, 8], [-31, 18.6], [-36, 23.2], [-95, ROAD.east]],
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
.w-root { position: fixed; inset: 0; z-index: 20; overflow: hidden; background: var(--bg); color: var(--ink); font-family: var(--f-body); font-size: 14px; --w-foot: 64px; }
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
.w-ibtn:disabled { opacity: .4; cursor: default; }
.w-ibtn svg { width: 16px; height: 16px; }
.w-cams { display: flex; gap: 2px; padding: 4px; max-width: 100%; overflow-x: auto; }
.w-cams button { border: 0; background: none; padding: 6px 11px; border-radius: 9px; font-weight: 600; font-size: 13px; color: var(--ink-2); white-space: nowrap; cursor: pointer; }
.w-cams button:hover { background: var(--panel-2); color: var(--ink); }
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
        <p>Toque nas bombas, carros, tanques, troca de óleo, ARLA e totem para ver o que está acontecendo.</p>
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

  // Onde os clientes da troca de óleo param, no balcão da cabine, e por onde chegam
  const KIOSK_SPOTS = [[5.5, -6.1], [5.5, -5.2], [5.45, -7.0]];
  const KIOSK_PATH = [5.5, -11.5];

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
        // Só quem compra na troca de óleo aparece (lubrificantes, ARLA, aditivos)
        if (s.items.some(i => i.g === "pista")) {
          const spot = KIOSK_SPOTS[hash(String(s.k)) % KIOSK_SPOTS.length];
          sim.shop.push({ s, emit, appear: emit - 150 * SEC, gone: emit + 20 * SEC, spot, k: "c" + idx });
        }
        return;
      }
      const main = fuelItems.reduce((a, i) => (i.q > a.q ? i : a));
      const q = fuelItems.reduce((a, i) => a + i.q, 0);
      const v = fuelItems.reduce((a, i) => a + i.v, 0);
      const diesel = /^d/.test(main.f);
      const kind = diesel && q >= 80 ? "truck" : diesel ? "pickup" : "car";
      let side = null, bico = null, est = true;
      if (main.b && B.BICOS[main.b] && B.BICOS[main.b].f === main.f) { side = B.BICOS[main.b].side; bico = main.b; est = false; }
      const flow = kind === "truck" ? 1.2 : 0.55; // litros por segundo
      const fuelEnd = emit - 25 * SEC, fuelStart = fuelEnd - (q / flow) * SEC;
      const arrive = fuelStart - 50 * SEC, leave = emit + 35 * SEC;
      if (!side) {
        let cands = B.SIDES.filter(sd => sd.bicos.some(b => b.f === main.f) && (kind === "truck" ? sd.tipo === "diesel" : kind === "car" ? sd.tipo === "carro" : true));
        if (!cands.length) cands = B.SIDES.filter(sd => sd.bicos.some(b => b.f === main.f));
        if (!cands.length) cands = B.SIDES.filter(sd => sd.tipo === (kind === "truck" ? "diesel" : "carro"));
        if (!cands.length) cands = B.SIDES;
        const want = arrive - 40 * SEC;
        const okNow = cands.filter(sd => (free[sd.id] ?? -Infinity) <= want);
        const pool = okNow.length ? okNow : cands;
        side = okNow.length ? pool[hash(String(s.k)) % pool.length] : pool.reduce((a, sd) => ((free[sd.id] || 0) < (free[a.id] || 0) ? sd : a));
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

  // ---------- Mundo 3D ----------
  let world = null;
  let selected = null;     // { type, id }
  let hovered = null;
  let running = false, raf = 0, lastFrame = 0;

  const curveCache = new Map();
  const toCurve = pts => new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal");
  function vehicleCurves(v) {
    const key = (v.kind === "truck" ? "t" : "c") + v.side.id;
    if (!curveCache.has(key)) { const r = routePoints(v.kind, v.side); curveCache.set(key, { in: toCurve(r.in), out: toCurve(r.out) }); }
    return curveCache.get(key);
  }
  let deliveryCurves = null;
  const DELIVERY = () => deliveryCurves || (deliveryCurves = { in: toCurve(DELIVERY_PTS.in), out: toCurve(DELIVERY_PTS.out) });

  function vehiclePhase(v, t) {
    if (t < v.appear || t >= v.gone) return null;
    if (t < v.arrive) return { name: "chegando", curve: "in", u: 1 - Math.pow(1 - (t - v.appear) / (v.arrive - v.appear), 2) };
    if (t < v.leave) return { name: t < v.fuelStart ? "parado" : t < v.fuelEnd ? "abastecendo" : "pagando", curve: "in", u: 1 };
    return { name: "saindo", curve: "out", u: Math.pow((t - v.leave) / (v.gone - v.leave), 2) };
  }
  const PHASE_TXT = { chegando: "Chegando", parado: "Parado na bomba", abastecendo: "Abastecendo", pagando: "Pagando", saindo: "Saindo" };
  const KIND_TXT = { truck: "Caminhão", pickup: "Picape", car: "Carro" };
  function litersNow(v, t) {
    if (t <= v.fuelStart) return 0;
    if (t >= v.fuelEnd) return v.q;
    return v.q * (t - v.fuelStart) / (v.fuelEnd - v.fuelStart);
  }
  function lastOnSide(id, t) {
    let best = null;
    for (const v of sim.visits) if (v.side.id === id && v.fuelEnd <= t && (!best || v.fuelEnd > best.fuelEnd)) best = v;
    return best;
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
    scene.fog = new T.Fog("#a9cfe6", 120, 320);
    const camera = new T.PerspectiveCamera(45, 1, 0.3, 700);
    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.06; controls.minDistance = 4; controls.maxDistance = 170;
    controls.screenSpacePanning = false;

    // Luz
    const hemi = new T.HemisphereLight("#dbefff", "#6b6250", 0.7);
    scene.add(hemi);
    const sun = new T.DirectionalLight("#fff4e0", 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 45, bottom: -45, near: 10, far: 260 });
    sun.shadow.bias = -0.0006;
    sun.target.position.set(-12, 0, -2);
    scene.add(sun, sun.target);
    const nightLights = [
      new T.PointLight("#fff1d6", 0, 30, 1.6), new T.PointLight("#fff1d6", 0, 30, 1.6),
      new T.PointLight("#fff7e8", 0, 20, 1.6), new T.PointLight("#ffe8c4", 0, 34, 1.6),
    ];
    nightLights[0].position.set(2, 5.4, 5); nightLights[1].position.set(-2, 5.4, -6);
    nightLights[2].position.set(6.5, 3.2, -7); nightLights[3].position.set(-24, 7, 6);
    nightLights.forEach(l => scene.add(l));

    // Materiais
    const M = (color, extra) => new T.MeshLambertMaterial({ color, ...extra });
    const mat = {
      ground: M("#9a9f92"), asphalt: M("#4a4f52"), lot: M("#6d7173"), concrete: M("#c9cbc6"), sidewalk: M("#b9bbb6"),
      joint: M("#9b9e99"), line: M("#f2f2ee"), yellow: M(YELLOW), red: M(RED), white: M("#f3f4f1"), dark: M("#22272a"),
      wall: M("#ecebe6"), roof: M("#d5d9d7"), cream: M("#ebe3cf"), tire: M("#1b1d1f"),
      trunk: M("#6b4c35"), leaf: M("#4f7f3a"), leaf2: M("#5f9444"), pole: M("#8d9396"), blue: M("#2f7fc0"),
      soil: new T.MeshLambertMaterial({ color: "#5a4636", side: T.BackSide }),
      glass: new T.MeshPhongMaterial({ color: "#9fc4d6", transparent: true, opacity: 0.32, shininess: 90, depthWrite: false }),
      pad: new T.MeshPhongMaterial({ color: "#c7d7dc", transparent: true, opacity: 0.28, shininess: 60, depthWrite: false }),
      lamp: new T.MeshLambertMaterial({ color: "#fffbe8", emissive: "#fff2c4", emissiveIntensity: 0 }),
      canopyLight: new T.MeshLambertMaterial({ color: "#f7f7f2", emissive: "#fff6dc", emissiveIntensity: 0, transparent: true }),
      skin: M("#c99a74"), pants: M("#2b3236"),
      tankShell: new T.MeshPhongMaterial({ color: "#d9e2e4", transparent: true, opacity: 0.22, shininess: 80, depthWrite: false }),
    };
    const box = (w, h, d, m, x = 0, y = 0, z = 0, cast = true) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; return o; };
    const cyl = (r1, r2, h, m, seg = 16) => { const o = new T.Mesh(new T.CylinderGeometry(r1, r2, h, seg), m); o.castShadow = true; o.receiveShadow = true; return o; };
    const flat = (w, d, m, x, z, y = 0.01) => { const o = new T.Mesh(new T.PlaneGeometry(w, d), m); o.rotation.x = -Math.PI / 2; o.position.set(x, y, z); o.receiveShadow = true; return o; };
    const plane = (w, h, m, x, y, z, ry = 0) => { const o = new T.Mesh(new T.PlaneGeometry(w, h), m); o.position.set(x, y, z); o.rotation.y = ry; return o; };

    function canvasTex(w, h, draw) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); draw(g, w, h);
      const tex = new T.CanvasTexture(c); tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return { tex, c, g, draw: fn => { fn(g, w, h); tex.needsUpdate = true; } };
    }
    const signTex = (text, bg, fg, w = 1024, h = 128, size = 84, stripe) => canvasTex(w, h, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      if (stripe) { g.fillStyle = stripe; g.fillRect(0, h * 0.8, w, h * 0.2); }
      g.fillStyle = fg; g.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, (stripe ? h * 0.42 : h / 2) + 4);
    }).tex;
    const numTex = n => canvasTex(128, 128, g => {
      g.fillStyle = YELLOW; g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#1a1a1a"; g.font = '700 96px "Barlow Condensed", sans-serif'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 64, 70);
    }).tex;

    // Telhados: ficam transparentes quando a câmera está alta, para mostrar o que acontece embaixo.
    const roofs = [];
    let roofOpacity = 1;
    function roof(...meshes) {
      for (const m of meshes) {
        m.userData.roof = true;
        if (!m.userData.sharedRoof) { m.material = m.material.clone(); m.material.transparent = true; }
        m.userData.op0 = m.material.opacity;   // vidro continua vidro quando o telhado volta
        m.userData.shared = true; m.userData.noGlow = true;
        roofs.push(m);
      }
    }
    function fadeRoofs() {
      const o = 1 - 0.88 * smooth(6.8, 9.5, camera.position.y);
      if (Math.abs(o - roofOpacity) < 0.01) return;
      roofOpacity = o;
      for (const m of roofs) { m.material.opacity = m.userData.op0 * o; m.material.depthWrite = o > 0.9 && m.userData.op0 === 1; }
    }

    // Peças clicáveis
    const pickables = [];
    function pickable(obj, type, id) {
      obj.traverse(m => { if (m.isMesh) { m.userData.pick = { type, id }; if (m.material && !m.userData.shared) m.material = m.material.clone(); } });
      obj.userData.pick = { type, id };
      pickables.push(obj);
      return obj;
    }

    // ---------- Chão, rua e calçadas ----------
    const padHole = () => { const h = new T.Path(); h.moveTo(PAD.x0, -PAD.z0); h.lineTo(PAD.x0, -PAD.z1); h.lineTo(PAD.x1, -PAD.z1); h.lineTo(PAD.x1, -PAD.z0); h.lineTo(PAD.x0, -PAD.z0); return h; };
    const shapeRect = (x0, z0, x1, z1) => { const s = new T.Shape(); s.moveTo(x0, -z0); s.lineTo(x1, -z0); s.lineTo(x1, -z1); s.lineTo(x0, -z1); s.lineTo(x0, -z0); return s; };
    const groundShape = shapeRect(-260, -260, 260, 260); groundShape.holes.push(padHole());
    const ground = new T.Mesh(new T.ShapeGeometry(groundShape), mat.ground);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);
    const lotShape = shapeRect(LOT.x0, LOT.z0, LOT.x1, LOT.z1); lotShape.holes.push(padHole());
    const lot = new T.Mesh(new T.ShapeGeometry(lotShape), mat.lot);
    lot.rotation.x = -Math.PI / 2; lot.receiveShadow = true; scene.add(lot);
    // Piso de concreto sob a cobertura, com as juntas que aparecem na foto
    const cw = CANOPY.x1 - CANOPY.x0, cd = CANOPY.z1 - CANOPY.z0;
    scene.add(flat(cw, cd, mat.concrete, (CANOPY.x0 + CANOPY.x1) / 2, (CANOPY.z0 + CANOPY.z1) / 2, 0.012));
    for (let z = CANOPY.z0 + 4.4; z < CANOPY.z1; z += 4.4) scene.add(flat(cw, 0.05, mat.joint, (CANOPY.x0 + CANOPY.x1) / 2, z, 0.016));
    for (let x = CANOPY.x0 + 4.3; x < CANOPY.x1; x += 4.3) scene.add(flat(0.05, cd, mat.joint, x, (CANOPY.z0 + CANOPY.z1) / 2, 0.016));
    // Rua da frente e rua que sai em frente ao posto
    scene.add(flat(800, ROAD.z1 - ROAD.z0, mat.asphalt, 0, (ROAD.z0 + ROAD.z1) / 2, 0.005));
    scene.add(flat(8, 200, mat.asphalt, 3, ROAD.z1 + 100, 0.006));
    for (let x = -396; x < 400; x += 8) if (x < -3 || x > 9) scene.add(flat(3.2, 0.18, mat.line, x, (ROAD.z0 + ROAD.z1) / 2, 0.02));
    for (let z = ROAD.z1 + 6; z < 220; z += 8) scene.add(flat(0.18, 3.2, mat.line, 3, z, 0.02));
    for (let i = 0; i < 8; i++) scene.add(flat(5, 0.5, mat.line, 4.5, ROAD.z0 + 0.6 + i, 0.022)); // faixa de pedestres
    [[-400, LOT.x0], [LOT.x1 + 0.4, 400]].forEach(([a, b]) => scene.add(box(b - a, 0.16, 2, mat.sidewalk, (a + b) / 2, 0.08, 21, false)));
    [[-400, -1], [7, 400]].forEach(([a, b]) => scene.add(box(b - a, 0.16, 2, mat.sidewalk, (a + b) / 2, 0.08, ROAD.z1 + 1, false)));
    // Setas no chão
    const arrow = canvasTex(256, 256, g => { g.fillStyle = "#f2f2ee"; g.beginPath(); g.moveTo(128, 20); g.lineTo(220, 130); g.lineTo(160, 130); g.lineTo(160, 236); g.lineTo(96, 236); g.lineTo(96, 130); g.lineTo(36, 130); g.closePath(); g.fill(); });
    const arrowMat = new T.MeshLambertMaterial({ map: arrow.tex, transparent: true });
    const a1 = flat(2.2, 2.2, arrowMat, 1.9, 15, 0.03); a1.rotation.z = Math.PI; scene.add(a1);
    const a2 = flat(2.2, 2.2, arrowMat, -16.2, 9, 0.03); scene.add(a2);

    // ---------- Cobertura (forro claro, faixa amarela e vermelha) ----------
    {
      const g = new T.Group();
      const cx = (CANOPY.x0 + CANOPY.x1) / 2, cz = (CANOPY.z0 + CANOPY.z1) / 2, h = CANOPY.h;
      const slab = box(cw, 0.9, cd, mat.white, cx, h, cz); g.add(slab);
      const slats = canvasTex(256, 256, gg => { gg.fillStyle = "#efe9da"; gg.fillRect(0, 0, 256, 256); gg.fillStyle = "#d9d1bd"; for (let y = 0; y < 256; y += 16) gg.fillRect(0, y, 256, 2); });
      slats.tex.wrapS = slats.tex.wrapT = T.RepeatWrapping; slats.tex.repeat.set(cw / 4, cd / 4);
      // O forro só recebe luz de baixo; um pouco de brilho próprio deixa ele claro como na foto.
      const under = new T.Mesh(new T.PlaneGeometry(cw, cd), new T.MeshLambertMaterial({ map: slats.tex, emissive: "#77736a" }));
      under.rotation.x = Math.PI / 2; under.position.set(cx, h - 0.452, cz); g.add(under);
      const fascia = signTex("POSTO CATARINENSE", YELLOW, RED, 1024, 96, 56, RED);
      const fm = new T.MeshLambertMaterial({ map: fascia });
      const front = plane(cw, 0.9, fm, cx, h, CANOPY.z1 + 0.01); g.add(front);
      const open = box(0.02, 0.9, cd, M(YELLOW), CANOPY.x0 - 0.01, h, cz, false); g.add(open);   // lado da área aberta
      const ostripe = box(0.03, 0.18, cd, mat.red, CANOPY.x0 - 0.02, h - 0.36, cz, false); g.add(ostripe);
      roof(slab, under, front, open, ostripe);
      for (let x = CANOPY.x0 + 3; x < CANOPY.x1 - 1; x += 6) for (let z = CANOPY.z0 + 4; z < CANOPY.z1 - 1; z += 6) {
        const l = new T.Mesh(new T.PlaneGeometry(1.6, 0.5), mat.canopyLight); l.userData.sharedRoof = true;
        l.rotation.x = Math.PI / 2; l.position.set(x, h - 0.46, z); g.add(l); roof(l);
      }
      // Colunas brancas
      for (const [x, z] of COLUMNS) g.add(box(0.55, h - 0.45, 0.55, mat.white, x, (h - 0.45) / 2, z));
      // Faixa pendurada perto da bomba 3 (sem marca)
      // Duas faces de costas uma para a outra, para o texto não aparecer espelhado de nenhum lado.
      const banner = new T.MeshLambertMaterial({ map: signTex("COMBUSTÍVEL ADITIVADO", RED, "#ffffff", 1024, 160, 76, YELLOW) });
      const b3 = BOMBA[3] || B.LAYOUT.bombas[B.LAYOUT.bombas.length - 1];
      g.add(plane(3.9, 0.9, banner, b3.x - 2.2, h - 1.1, b3.z - 1.99));
      g.add(plane(3.9, 0.9, banner, b3.x - 2.2, h - 1.1, b3.z - 2.01, Math.PI));
      pickable(g, "pista", "carros");
      scene.add(g);
    }

    // ---------- Ilhas e bombas ----------
    const pumps = {};
    function island(x, z) {
      const g = new T.Group();
      g.add(box(1.5, 0.16, 5.2, mat.yellow, x, 0.08, z));
      g.add(box(1.3, 0.26, 5, mat.concrete, x, 0.2, z));
      return g;
    }
    for (const isl of EXTRA_ISLANDS) {
      const g = island(isl.x, isl.z);
      const ext = cyl(0.13, 0.13, 0.6, mat.red, 12); ext.position.set(isl.x + 0.4, 0.63, isl.z + 1.6); g.add(ext);
      const bin = cyl(0.25, 0.22, 0.75, mat.dark, 12); bin.position.set(isl.x - 0.3, 0.7, isl.z + 1.8); g.add(bin);
      scene.add(g);
    }
    for (const b of B.LAYOUT.bombas) {
      const g = island(0, 0);
      const H0 = 0.33;
      g.add(box(0.8, 2.5, 1.35, mat.white, 0, H0 + 1.25, 0.6));                 // corpo do dispenser
      g.add(box(0.84, 0.32, 1.39, M(YELLOW), 0, H0 + 0.5, 0.6));               // faixa amarela
      g.add(box(0.85, 0.12, 1.4, M(RED), 0, H0 + 0.72, 0.6));                  // faixa vermelha
      g.add(box(0.86, 0.42, 1.42, M(RED), 0, H0 + 2.68, 0.6));                 // topo vermelho
      g.add(box(0.87, 0.07, 1.43, M(YELLOW), 0, H0 + 2.45, 0.6));
      const displays = {}, nozzles = {};
      for (const lado of ["A", "B"]) {
        const sgn = lado === "A" ? -1 : 1;
        const disp = canvasTex(256, 128, () => {});
        const dp = new T.Mesh(new T.PlaneGeometry(0.68, 0.34), new T.MeshBasicMaterial({ map: disp.tex }));
        dp.position.set(sgn * 0.405, H0 + 1.95, 0.6); dp.rotation.y = sgn * Math.PI / 2; g.add(dp);
        displays[lado] = { disp, last: "" };
        const list = b.lados[lado];
        list.forEach(([n, f], j) => {
          const zz = 0.6 - 0.48 + (list.length > 1 ? j * 0.96 / (list.length - 1) : 0.48);
          g.add(box(0.12, 0.3, 0.1, M(fuelColor(f)), sgn * 0.47, H0 + 1.2, zz));
          nozzles[n] = new T.Vector3(b.x + sgn * 0.47, 1.4, b.z + zz);
        });
        // Placas amarelas com o número da posição, como nas colunas da foto
        const pm = new T.MeshLambertMaterial({ map: numTex(b.pos[lado]) });
        for (const face of [-1, 1]) g.add(plane(0.22, 0.22, pm, sgn * 0.14, 3.6, -2 + face * 0.281, face < 0 ? Math.PI : 0));
      }
      // Extintor e cavalete de segurança
      const ext = cyl(0.13, 0.13, 0.6, mat.red, 12); ext.position.set(0.42, 0.63, -0.9); g.add(ext);
      const board = plane(0.6, 0.8, new T.MeshLambertMaterial({ map: signTex("DESLIGUE O MOTOR", YELLOW, "#1a1a1a", 256, 340, 34), side: T.DoubleSide }), -0.2, 1.05, -1.0, Math.PI / 2);
      g.add(board);
      g.position.set(b.x, 0, b.z);
      pickable(g, "bomba", b.n);
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
    // ARLA 32 (galão azul) ao lado da bomba de diesel
    {
      const b1 = B.LAYOUT.bombas.find(b => b.tipo === "diesel") || B.LAYOUT.bombas[0];
      const g = new T.Group();
      const drum = cyl(0.3, 0.3, 1.0, mat.blue, 16); drum.position.set(b1.x + 0.3, 0.83, b1.z - 1.2); g.add(drum);
      const d2 = box(0.4, 1.3, 0.35, mat.blue, b1.x - 0.3, 0.98, b1.z - 1.25); g.add(d2);
      g.add(box(0.36, 0.2, 0.02, mat.dark, b1.x - 0.3, 1.4, b1.z - 1.06, false));
      pickable(g, "arla", 1);
      scene.add(g);
    }
    // Bandeirolas (sem marca)
    for (const b of B.LAYOUT.bombas.filter(x => x.tipo === "carro")) {
      const pole = cyl(0.03, 0.03, 3.6, mat.pole, 6); pole.position.set(b.x + 0.5, 1.8 + 0.33, b.z - 2.9); scene.add(pole);
      const fl = plane(0.5, 2.4, new T.MeshLambertMaterial({ map: signTex("", RED, RED, 64, 256, 10, YELLOW), side: T.DoubleSide }), b.x + 0.25, 2.5, b.z - 2.9, Math.PI / 2);
      scene.add(fl);
    }

    // ---------- Frentistas (uniforme vermelho, como na foto) ----------
    function person(shirt, cap) {
      const g = new T.Group();
      const legs = cyl(0.13, 0.13, 0.82, mat.pants, 8); legs.position.y = 0.41; legs.userData.shared = true; g.add(legs);
      const body = cyl(0.24, 0.21, 0.72, M(shirt), 10); body.position.y = 1.18; g.add(body);
      const head = new T.Mesh(new T.SphereGeometry(0.17, 12, 10), mat.skin); head.position.y = 1.7; head.castShadow = true; head.userData.shared = true; g.add(head);
      if (cap) { const c = cyl(0.19, 0.19, 0.1, M(cap), 10); c.position.y = 1.83; g.add(c); }
      return g;
    }
    const attendants = {};
    for (const b of B.LAYOUT.bombas) {
      const p = person(RED, RED);
      p.position.set(b.x, 0.33, b.z - 3.0);
      scene.add(p); attendants[b.n] = p;
    }

    // ---------- Muro e prédio do vizinho, à esquerda de quem olha da varanda ----------
    scene.add(box(0.4, 6.2, 42, mat.wall, WALL_X + 0.2, 3.1, -3));
    scene.add(box(11.4, 5.2, 42, M("#e3e1da"), WALL_X + 6.1, 2.6, -3));
    scene.add(box(11.6, 0.3, 42.2, M("#5b86a8"), WALL_X + 6.1, 5.35, -3));
    scene.add(box(0.05, 4, 4, M(YELLOW), WALL_X - 0.03, 3, 14, false));
    for (const z of [10, 11.2, 12.4]) { const c = new T.Mesh(new T.ConeGeometry(0.22, 0.6, 12), M("#ef6a1a")); c.position.set(WALL_X - 0.5, 0.3, z); c.castShadow = true; scene.add(c); }

    // ---------- Cabine de troca de óleo e lubrificantes ----------
    {
      const { x0, x1, z0, z1, h } = KIOSK, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      const g = new T.Group();
      g.add(box(w, h, d, mat.cream, cx, h / 2, cz));
      const top = box(w + 0.3, 0.18, d + 0.3, mat.dark, cx, h + 0.09, cz); g.add(top); roof(top);
      g.add(box(0.04, 2.0, 0.95, mat.dark, x0 - 0.02, 1.0, z0 + 0.9, false));                 // porta aberta
      g.add(box(0.05, 1.3, 1.9, M("#3d4a52"), x0 - 0.03, 1.45, z1 - 1.25, false));           // vitrine
      for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) g.add(box(0.06, 0.16, 0.12, M(j % 2 ? YELLOW : RED), x0 - 0.07, 1.0 + i * 0.38, z1 - 2.05 + j * 0.3, false));
      const sign = plane(1.9, 0.5, new T.MeshLambertMaterial({ map: signTex("LUBRIFICANTES", RED, YELLOW, 512, 128, 64) }), x0 - 0.06, 2.4, z1 - 1.25, -Math.PI / 2);
      g.add(sign);
      pickable(g, "oleo", 1);
      scene.add(g);
      // Moto do pessoal, galão de água (IBC) e caminhonete estacionada
      const moto = new T.Group();
      for (const zz of [-0.65, 0.65]) { const w2 = new T.Mesh(new T.TorusGeometry(0.3, 0.08, 8, 16), mat.tire); w2.rotation.y = Math.PI / 2; w2.position.set(0, 0.38, zz); moto.add(w2); }
      moto.add(box(0.3, 0.35, 1.0, M("#b51f1f"), 0, 0.72, 0)); moto.add(box(0.28, 0.12, 0.6, mat.dark, 0, 0.95, -0.2));
      moto.position.set(WALL_X - 1.3, 0, -12.4); scene.add(moto);
      const ibc = box(1.1, 1.0, 1.1, new T.MeshLambertMaterial({ color: "#e9ece6", transparent: true, opacity: 0.9 }), WALL_X - 0.75, 0.6, -14.5); scene.add(ibc);
      scene.add(box(1.2, 0.12, 1.2, mat.pole, WALL_X - 0.75, 0.06, -14.5));
    }

    // ---------- Prédio do fundo, com a varanda de onde a foto foi tirada ----------
    {
      const { x0, x1, z0, z1, h1, h2 } = BUILDING, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      const g = new T.Group();
      g.add(box(w, 0.2, d, mat.concrete, cx, 0.1, cz));
      g.add(box(w, h1, 0.3, mat.wall, cx, h1 / 2, z0 + 0.15));
      g.add(box(0.3, h1, d, mat.wall, x0 + 0.15, h1 / 2, cz));
      g.add(box(0.3, h1, d, mat.wall, x1 - 0.15, h1 / 2, cz));
      g.add(box(w, h1, 0.3, mat.wall, cx, h1 / 2, z1 - 0.15));                                      // fachada fechada
      for (const dx of [5, -1.5]) g.add(box(0.9, 2.1, 0.05, mat.dark, dx, 1.05, z1 + 0.01, false));  // portas
      for (const wx of [1.8, -4.5, -8]) g.add(box(1.6, 1.1, 0.05, M("#3d4a52"), wx, 1.7, z1 + 0.01, false)); // janelas
      // andar de cima, varanda com floreiras (é dali que a foto foi tirada)
      const upper = [
        box(w, 0.25, d, mat.roof, cx, h1 + 0.12, cz),
        box(w, h2 - h1, 0.3, mat.wall, cx, (h1 + h2) / 2, z0 + 0.15),
        box(0.3, h2 - h1, d, mat.wall, x0 + 0.15, (h1 + h2) / 2, cz),
        box(0.3, h2 - h1, d, mat.wall, x1 - 0.15, (h1 + h2) / 2, cz),
        box(w, 0.9, 0.3, mat.wall, cx, h1 + 0.7, z1 - 0.15),
        box(w, 0.3, d, mat.roof, cx, h2 + 0.15, cz),
        box(w, 0.2, 1.4, mat.concrete, cx, h1 + 0.1, z1 + 0.7),
        box(w, 0.9, 0.06, new T.MeshPhongMaterial({ color: "#bcd3dc", transparent: true, opacity: 0.4 }), cx, h1 + 0.65, z1 + 1.37, false),
      ];
      upper.forEach(m => g.add(m)); roof(...upper);
      for (const px of [1.2, -5.2, 6, -10]) {
        const pot = box(1.2, 0.45, 0.5, M("#8a6a50"), px, h1 + 0.42, z1 + 1.05); g.add(pot); roof(pot);
        const bush = new T.Mesh(new T.IcosahedronGeometry(0.55, 0), mat.leaf2); bush.position.set(px, h1 + 0.95, z1 + 1.05); g.add(bush); roof(bush);
      }
      scene.add(g);
      // muro do fundo, ao lado do prédio, e muro do lado da área aberta
      scene.add(box(x0 - LOT.x0, 2.4, 0.3, mat.wall, (x0 + LOT.x0) / 2, 1.2, z1 - 0.15));
      scene.add(box(0.3, 2.2, 42, mat.wall, LOT.x0 - 0.15, 1.1, -3));
    }

    // ---------- Totem de preços (amarelo e vermelho, sem marca) ----------
    const totemTex = canvasTex(256, 768, () => {});
    {
      const g = new T.Group();
      g.add(box(2.6, 0.5, 1.2, mat.concrete, TOTEM.x, 0.25, TOTEM.z));
      g.add(box(2.3, 7.4, 0.5, mat.dark, TOTEM.x, 4.4, TOTEM.z));
      g.add(plane(2.2, 6.6, new T.MeshBasicMaterial({ map: totemTex.tex }), TOTEM.x, 4.4, TOTEM.z + 0.26));
      g.add(plane(2.2, 6.6, new T.MeshBasicMaterial({ map: totemTex.tex }), TOTEM.x, 4.4, TOTEM.z - 0.26, Math.PI));
      pickable(g, "totem", 1);
      scene.add(g);
    }
    function drawTotem(prices) {
      totemTex.draw((g, w, h) => {
        g.fillStyle = "#0e1515"; g.fillRect(0, 0, w, h);
        g.fillStyle = YELLOW; g.fillRect(0, 0, w, 150);
        g.fillStyle = RED; g.fillRect(0, 138, w, 12);
        g.textAlign = "center"; g.textBaseline = "middle";
        g.font = '700 54px "Barlow Condensed", sans-serif'; g.fillText("POSTO", w / 2, 48);
        g.font = '700 40px "Barlow Condensed", sans-serif'; g.fillText("CATARINENSE", w / 2, 100);
        prices.slice(0, 6).forEach((r, i) => {
          const y = 168 + i * 98;
          g.fillStyle = r.color; g.fillRect(14, y, 10, 78);
          g.fillStyle = "#cfd8d7"; g.textAlign = "left"; g.font = '600 24px "Barlow Condensed", sans-serif';
          g.fillText(r.label.toUpperCase(), 36, y + 14);
          g.fillStyle = "#ffb21f"; g.font = '52px "Share Tech Mono", monospace'; g.textAlign = "right";
          const s = B.dec3.format(r.price);
          g.fillText(s.slice(0, -1), w - 40, y + 54);
          g.font = '30px "Share Tech Mono", monospace'; g.fillText(s.slice(-1), w - 14, y + 44);
        });
      });
    }

    // ---------- Tanques (embaixo de um piso transparente, na área aberta) ----------
    const tanks = {};
    {
      const cx = (PAD.x0 + PAD.x1) / 2, cz = (PAD.z0 + PAD.z1) / 2;
      const pit = new T.Mesh(new T.BoxGeometry(PAD.x1 - PAD.x0, 3.4, PAD.z1 - PAD.z0), mat.soil); pit.position.set(cx, -1.7, cz); scene.add(pit);
      const pad = flat(PAD.x1 - PAD.x0, PAD.z1 - PAD.z0, mat.pad, cx, cz, 0.0); pad.renderOrder = 2; scene.add(pad);
      const frame = [[PAD.x1 - PAD.x0 + 0.3, 0.3, cx, PAD.z0], [PAD.x1 - PAD.x0 + 0.3, 0.3, cx, PAD.z1], [0.3, PAD.z1 - PAD.z0, PAD.x0, cz], [0.3, PAD.z1 - PAD.z0, PAD.x1, cz]];
      frame.forEach(([w, d, x, z]) => scene.add(box(w, 0.08, d, mat.yellow, x, 0.04, z, false)));
      B.LAYOUT.tanques.forEach((tq, i) => {
        const z = tankZ(i);
        const g = new T.Group();
        const shell = new T.Mesh(new T.CylinderGeometry(TANK_R, TANK_R, TANK_L, 28, 1, false), mat.tankShell); shell.userData.shared = true;
        shell.rotation.z = Math.PI / 2; shell.position.set(cx, TANK_Y, z); shell.renderOrder = 1; g.add(shell);
        const clip = new T.Plane(new T.Vector3(0, -1, 0), TANK_Y);
        const liquid = new T.Mesh(new T.CylinderGeometry(TANK_R * 0.93, TANK_R * 0.93, TANK_L - 0.1, 28), new T.MeshLambertMaterial({ color: fuelColor(tq.f), side: T.DoubleSide }));
        liquid.rotation.z = Math.PI / 2; liquid.position.set(cx, TANK_Y, z); g.add(liquid);
        const cap = cyl(0.3, 0.3, 0.08, M(fuelColor(tq.f)), 18); cap.position.set(PAD.x1 - 0.8, 0.05, z); g.add(cap);
        const pipe = cyl(0.08, 0.08, 1.0, mat.pole, 8); pipe.position.set(PAD.x1 - 0.8, -0.5, z); g.add(pipe);
        pickable(g, "tanque", tq.n);
        liquid.material.clippingPlanes = [clip];
        scene.add(g);
        tanks[tq.n] = { g, clip, tq, z };
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

    // ---------- Arredores: casas e lojas do outro lado da rua ----------
    function tree(x, z, s = 1) {
      const g = new T.Group();
      const tr = cyl(0.18 * s, 0.24 * s, 2 * s, mat.trunk, 8); tr.position.y = s; g.add(tr);
      const c = new T.Mesh(new T.IcosahedronGeometry(1.6 * s, 0), (Math.round(x + z)) % 2 ? mat.leaf : mat.leaf2); c.position.y = 2.9 * s; c.castShadow = true; g.add(c);
      g.position.set(x, 0, z); return g;
    }
    const colors = ["#d9cbb8", "#c5d0d6", "#e3dccf", "#b8c4b5", "#d6c2b2", "#cfd6dc", "#e8d9a8", "#d4b8b0"];
    for (let i = 0; i < 16; i++) {
      const x0 = -110 + i * 14;
      if (x0 + 12 > -1 && x0 < 7) continue;                 // espaço da rua que sai em frente
      const w = 10 + (i * 37) % 3, h = 3.6 + (i * 53) % 5;
      scene.add(box(w, h, 10, M(colors[i % colors.length]), x0 + w / 2, h / 2, ROAD.z1 + 7.5));
      scene.add(box(w, 0.25, 1.4, M(i % 3 ? "#6d8fa6" : "#b8504a"), x0 + w / 2, 2.8, ROAD.z1 + 2.6, false));
    }
    for (let i = 0; i < 10; i++) {
      for (const sx of [-1, 1]) {
        const h = 4 + ((i * 7 + (sx > 0 ? 3 : 0)) % 6);
        scene.add(box(10, h, 11, M(colors[(i + (sx > 0 ? 3 : 0)) % colors.length]), 3 + sx * 10.5, h / 2, ROAD.z1 + 20 + i * 13));
      }
    }
    scene.add(plane(5, 0.9, new T.MeshLambertMaterial({ map: signTex("MOTO TÁXI", "#1f5fa8", "#ffffff", 512, 96, 64) }), -30, 4.1, ROAD.z1 + 2.4));
    scene.add(plane(4.4, 0.9, new T.MeshLambertMaterial({ map: signTex("LANCHES", "#ffffff", "#b8504a", 512, 96, 64) }), -12, 3.6, ROAD.z1 + 2.4));
    for (const x of [30, 18, -20, -38, -50]) scene.add(tree(x, ROAD.z1 + 1.6, 0.85));
    for (let z = -20; z <= 16; z += 7) scene.add(tree(LOT.x0 - 3, z, 0.95));
    for (let x = 14; x <= 32; x += 6) scene.add(tree(-x, LOT.z0 - 3, 0.9));
    for (const x of [24, -10, -28, -46]) {
      const p = cyl(0.1, 0.12, 7, mat.pole, 8); p.position.set(x, 3.5, ROAD.z1 + 0.6); scene.add(p);
      scene.add(box(0.12, 0.12, 1.6, mat.pole, x, 7, ROAD.z1 - 0.1));
      const head = box(0.5, 0.18, 0.8, mat.lamp, x, 6.92, ROAD.z1 - 0.8); head.userData.shared = true; scene.add(head);
    }

    // ---------- Veículos ----------
    const G = {
      body: new T.BoxGeometry(1.8, 0.62, 4.3), cabin: new T.BoxGeometry(1.6, 0.56, 2.2), cabinP: new T.BoxGeometry(1.62, 0.6, 1.7),
      roof: new T.BoxGeometry(1.5, 0.06, 2.0), roofP: new T.BoxGeometry(1.52, 0.06, 1.55), bed: new T.BoxGeometry(1.7, 0.3, 1.9),
      wheel: new T.CylinderGeometry(0.33, 0.33, 0.24, 14), wheelT: new T.CylinderGeometry(0.5, 0.5, 0.36, 14),
      light: new T.BoxGeometry(0.36, 0.12, 0.05),
      cab: new T.BoxGeometry(2.5, 2.6, 2.4), chassis: new T.BoxGeometry(2.3, 0.5, 10), cargo: new T.BoxGeometry(2.56, 3.0, 7.2),
      tank: new T.CylinderGeometry(1.15, 1.15, 7.6, 24), band: new T.CylinderGeometry(1.17, 1.17, 0.5, 24),
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
        const roofM = new T.Mesh(G.roofP, paint); roofM.position.set(0, 1.52, 0.55); g.add(roofM);
        const bed = new T.Mesh(G.bed, mat.dark); bed.position.set(0, 0.98, -1.15); bed.userData.shared = true; g.add(bed);
      } else {
        const cab = new T.Mesh(G.cabin, glassMat); cab.position.set(0, 1.18, -0.15); cab.userData.shared = true; g.add(cab);
        const roofM = new T.Mesh(G.roof, paint); roofM.position.set(0, 1.48, -0.15); g.add(roofM);
      }
      addWheels(g, G.wheel, [[0.86, 0.33, 1.35], [-0.86, 0.33, 1.35], [0.86, 0.33, -1.35], [-0.86, 0.33, -1.35]]);
      addLights(g, 2.16, -2.16, 0.68, [0.6, -0.6]);
      return g;
    }
    function makeTruck(color) {
      const g = new T.Group();
      const cab = new T.Mesh(G.cab, new T.MeshPhongMaterial({ color, shininess: 50 })); cab.position.set(0, 2.0, 3.7); cab.castShadow = true; g.add(cab);
      const ws = new T.Mesh(new T.PlaneGeometry(2.2, 1.0), glassMat); ws.position.set(0, 2.6, 4.91); ws.userData.shared = true; g.add(ws);
      const ch = new T.Mesh(G.chassis, mat.dark); ch.position.y = 0.85; ch.userData.shared = true; g.add(ch);
      const cargo = new T.Mesh(G.cargo, new T.MeshLambertMaterial({ color: "#eef0ee" })); cargo.position.set(0, 2.6, -1.4); cargo.castShadow = true; g.add(cargo);
      addWheels(g, G.wheelT, [[1.1, 0.5, 3.6], [-1.1, 0.5, 3.6], [1.1, 0.5, -2.6], [-1.1, 0.5, -2.6], [1.1, 0.5, -3.8], [-1.1, 0.5, -3.8]]);
      addLights(g, 4.92, -5.02, 1.0, [0.9, -0.9]);
      return g;
    }
    function makeTanker() {
      const g = new T.Group();
      const cab = new T.Mesh(G.cab, new T.MeshPhongMaterial({ color: "#f2f2f0", shininess: 50 })); cab.position.set(0, 2.0, 4.2); cab.castShadow = true; g.add(cab);
      const ws = new T.Mesh(new T.PlaneGeometry(2.2, 1.0), glassMat); ws.position.set(0, 2.6, 5.41); ws.userData.shared = true; g.add(ws);
      const ch = new T.Mesh(G.chassis, mat.dark); ch.position.y = 0.85; ch.userData.shared = true; g.add(ch);
      const tank = new T.Mesh(G.tank, new T.MeshPhongMaterial({ color: "#f4f5f4", shininess: 90 })); tank.rotation.x = Math.PI / 2; tank.position.set(0, 2.3, -1.2); tank.castShadow = true; g.add(tank);
      for (const z of [-3.6, -1.2, 1.2]) { const b = new T.Mesh(G.band, new T.MeshLambertMaterial({ color: RED })); b.rotation.x = Math.PI / 2; b.position.set(0, 2.3, z); g.add(b); }
      addWheels(g, G.wheelT, [[1.1, 0.5, 4.1], [-1.1, 0.5, 4.1], [1.1, 0.5, -2.6], [-1.1, 0.5, -2.6], [1.1, 0.5, -3.8], [-1.1, 0.5, -3.8]]);
      addLights(g, 5.42, -5.02, 1.0, [0.9, -0.9]);
      return g;
    }
    // A caminhonete branca estacionada perto da cabine, como na foto
    { const car = makeCar("#f4f4f2", true); car.position.set(2.6, 0, -10.5); car.rotation.y = Math.PI; scene.add(car); }

    // Trânsito da rua (só enfeite, sempre no ritmo real)
    const traffic = [];
    for (let i = 0; i < 7; i++) {
      const east = i % 2 === 0;
      const car = makeCar(CAR_COLORS[(i * 3) % CAR_COLORS.length], i === 3);
      car.rotation.y = east ? -Math.PI / 2 : Math.PI / 2;   // a pista de perto corre para x negativo
      scene.add(car);
      traffic.push({ car, east, speed: 9 + (i * 13) % 6, offset: i * 47 });
    }

    // ---------- Seleção ----------
    const ring = new T.Mesh(new T.RingGeometry(1, 1.25, 48), new T.MeshBasicMaterial({ color: "#2fd1c9", transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.visible = false; ring.renderOrder = 5; scene.add(ring);

    // Objetos que vêm e vão (veículos, clientes)
    const dyn = new Map();
    function removePick(obj) { const i = pickables.indexOf(obj); if (i >= 0) pickables.splice(i, 1); }
    function clearDynamic() {
      for (const [, d] of dyn) { scene.remove(d.obj); if (d.hose) { scene.remove(d.hose); d.hose.geometry.dispose(); } removePick(d.obj); }
      dyn.clear();
    }
    function addDyn(key, obj, type, id) {
      obj.traverse(m => { if (m.isMesh) m.userData.pick = { type, id }; });
      obj.userData.pick = { type, id };
      pickables.push(obj); scene.add(obj);
      const d = { obj, hose: null }; dyn.set(key, d); return d;
    }
    function hoseBetween(a, b) {
      const mid = a.clone().lerp(b, 0.5); mid.y = Math.min(a.y, b.y) - 0.35;
      const m = new T.Mesh(new T.TubeGeometry(new T.QuadraticBezierCurve3(a, mid, b), 16, 0.035, 6, false), mat.dark);
      m.userData.shared = true; return m;
    }

    // ---------- Etiquetas ----------
    const labelsBox = ui.$("w-labels");
    const labels = [];
    function addLabel(type, id, pos, text, near, far) {
      const el = document.createElement("button"); el.type = "button"; el.className = "w-label";
      const dot = document.createElement("i"); const span = document.createElement("span"); span.textContent = text;
      el.append(dot, span); labelsBox.append(el);
      const L = { type, id, near, far, pos: new T.Vector3(...pos), el, dot, span, set(cls, txt) { if (dot.className !== cls) dot.className = cls; if (span.textContent !== txt) span.textContent = txt; } };
      el.addEventListener("click", () => select({ type, id: L.id }));
      labels.push(L); return L;
    }
    for (const b of B.LAYOUT.bombas) addLabel("bomba", b.n, [b.x, 3.5, b.z + 0.6], `Bomba ${b.n}`);
    B.LAYOUT.tanques.forEach((tq, i) => addLabel("tanque", tq.n, [PAD.x1 + 0.4, 0.6, tankZ(i)], `T${tq.n}`, 30));
    const tanksLabel = addLabel("tanque", B.LAYOUT.tanques[0].n, [(PAD.x0 + PAD.x1) / 2, 1.2, PAD.z1 + 0.4], "Tanques", null, 30);
    addLabel("oleo", 1, [(KIOSK.x0 + KIOSK.x1) / 2, 3.4, (KIOSK.z0 + KIOSK.z1) / 2], "Troca de óleo");
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
      for (const h of ray.intersectObjects(pickables, true)) {
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
    let flight = null;
    // Com o celular em pé a tela é estreita: as vistas prontas ficam mais afastadas (menos a da varanda).
    function flyCam(key, instant) {
      const c = CAMS[key], k = camera.aspect < 0.8 && key !== "varanda" ? (key === "geral" ? 1.75 : 1.45) : 1;
      const pos = c.pos.map((v, i) => c.target[i] + (v - c.target[i]) * k);
      if (instant) { camera.position.set(...pos); controls.target.set(...c.target); controls.update(); return; }
      flyTo(pos, c.target);
    }
    function flyTo(pos, target) {
      flight = { p0: camera.position.clone(), p1: new T.Vector3(...pos), t0: controls.target.clone(), t1: new T.Vector3(...target), start: performance.now(), dur: reduceMotion ? 0 : 900 };
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
      sun.position.set(-12 + Math.cos(a) * 90, 20 + Math.sin(a) * 90, 48);
      sun.intensity = 0.95 * day;
      hemi.intensity = 0.28 + 0.5 * day;
      hemi.color.set(day > 0.3 ? "#dbefff" : "#8fa3c4");
      const night = 1 - day;
      nightLights.forEach((l, i) => { l.intensity = (i === 2 ? 0.9 : 1.25) * night; });
      mat.canopyLight.emissiveIntensity = 0.15 + 0.85 * night;
      mat.lamp.emissiveIntensity = night;
      headMat.emissiveIntensity = 0.2 + 0.8 * night;
      tailMat.emissiveIntensity = 0.2 + 0.6 * night;
    }

    // ---------- Tamanho da tela ----------
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
    let tankTimer = 0;
    const tankState = {};
    function refreshStatic() {
      const prices = [];
      const m = B.summarize(sim.sales);
      for (const f of B.FUELS) {
        const x = m.fuels[f.k];
        if (x && x.q > 0) prices.push({ label: SHORT[f.k] || f.n, price: x.v / x.q, color: fuelColor(f.k) });
      }
      drawTotem(prices);
      for (const p of Object.values(pumps)) for (const d of Object.values(p.displays)) d.last = "";
      tankTimer = 0;
    }
    function updateTanks(absT) {
      if (performance.now() - tankTimer < 1000) return;
      tankTimer = performance.now();
      for (const n in tanks) {
        const { clip, tq } = tanks[n];
        const same = B.LAYOUT.tanques.filter(x => x.f === tq.f);
        const capAll = same.reduce((a, x) => a + x.cap, 0);
        const st = B.stockAt(tq.f, absT);
        const level = st == null ? null : clamp(st, 0, capAll) * tq.cap / capAll;
        tankState[n] = { level, frac: level == null ? null : level / tq.cap };
        const hgt = level == null ? 0 : heightFor(level / tq.cap);
        clip.constant = TANK_Y - TANK_R * 0.93 + 2 * TANK_R * 0.93 * hgt;
      }
    }

    const state = { here: 0, sideNow: {} };
    function update(dtMs, wallMs) {
      const t = sim.t, absT = (sim.day ?? 0) + t;
      lighting(t / H);
      updateTanks(absT);
      const alive = new Set();
      const sideNow = {};
      // Veículos dos clientes
      for (const v of sim.visits) {
        const ph = vehiclePhase(v, t);
        if (!ph) continue;
        alive.add(v.k);
        let d = dyn.get(v.k);
        if (!d) {
          const hk = hash(String(v.s.k));
          const obj = v.kind === "truck" ? makeTruck(["#d03b3b", "#1f4f8f", "#f2f2f0", "#2f5d3a"][hk % 4]) : makeCar(CAR_COLORS[hk % CAR_COLORS.length], v.kind === "pickup");
          d = addDyn(v.k, obj, "veiculo", v.k);
        }
        const c = vehicleCurves(v)[ph.curve];
        const p = c.getPointAt(clamp(ph.u, 0, 1)), tg = c.getTangentAt(clamp(ph.u, 0.0001, 0.9999));
        d.obj.position.set(p.x, 0, p.z);
        d.obj.rotation.y = Math.atan2(tg.x, tg.z);
        if (ph.name !== "chegando" && ph.name !== "saindo") sideNow[v.side.id] = { v, ph };
        const fueling = ph.name === "abastecendo";
        if (fueling && !d.hose) {
          const noz = pumps[v.side.bomba].nozzles[v.bico] || new T.Vector3(v.side.x, 1.4, v.side.z);
          const sgn = v.side.lado === "A" ? 1 : -1;
          const door = new T.Vector3(d.obj.position.x + sgn * (v.kind === "truck" ? 1.3 : 0.92), v.kind === "truck" ? 1.0 : 0.85, v.side.z + 0.1);
          d.hose = hoseBetween(noz, door); scene.add(d.hose);
        } else if (!fueling && d.hose) { scene.remove(d.hose); d.hose.geometry.dispose(); d.hose = null; }
      }
      // Clientes da troca de óleo: chegam pelo fundo, param no balcão e voltam
      const lerp2 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      for (const c of sim.shop) {
        if (t < c.appear || t >= c.gone) continue;
        alive.add(c.k);
        let d = dyn.get(c.k);
        if (!d) d = addDyn(c.k, person(["#d03b3b", "#2a78d6", "#eda100", "#6250d6", "#f2f2f0", "#1baf7a", "#e87ba4"][hash(String(c.s.k)) % 7]), "cliente", c.k);
        let x, z;
        if (t < c.appear + 12 * SEC) [x, z] = lerp2(KIOSK_PATH, c.spot, (t - c.appear) / (12 * SEC));
        else if (t < c.emit + 5 * SEC) [x, z] = c.spot;
        else [x, z] = lerp2(c.spot, KIOSK_PATH, clamp((t - c.emit - 5 * SEC) / (15 * SEC), 0, 1));
        d.obj.position.set(x, 0, z);
        d.obj.rotation.y = t >= c.appear + 12 * SEC && t < c.emit + 5 * SEC ? Math.PI / 2 : (t < c.emit ? 0 : Math.PI);
      }
      // Caminhão da distribuidora
      for (const e of sim.deliveries) {
        if (t < e.appear || t >= e.gone) continue;
        alive.add(e.k);
        let d = dyn.get(e.k);
        if (!d) d = addDyn(e.k, makeTanker(), "entrega", e.k);
        const DC = DELIVERY();
        let c, u;
        if (t < e.arrive) { c = DC.in; u = 1 - Math.pow(1 - (t - e.appear) / (e.arrive - e.appear), 2); }
        else if (t < e.leave) { c = DC.in; u = 1; }
        else { c = DC.out; u = Math.pow((t - e.leave) / (e.gone - e.leave), 2); }
        const p = c.getPointAt(clamp(u, 0, 1)), tg = c.getTangentAt(clamp(u, 0.0001, 0.9999));
        d.obj.position.set(p.x, 0, p.z); d.obj.rotation.y = Math.atan2(tg.x, tg.z);
        const unloading = t >= e.arrive + 2 * MIN && t < e.leave - 2 * MIN;
        if (unloading && !d.hose) { d.hose = hoseBetween(new T.Vector3(-20.6, 1.0, 0.5), new T.Vector3(PAD.x1 - 0.8, 0.1, tankZ(0))); scene.add(d.hose); }
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
        const tx = b.x + (sgn ? sgn * 1.25 : 0), tz = b.z + (sgn ? 0.9 : -3.0);
        const k = 1 - Math.pow(0.002, dtMs / 1000);
        at.position.x += (tx - at.position.x) * k; at.position.z += (tz - at.position.z) * k;
        at.position.y = sgn ? 0 : 0.33;
        at.rotation.y = sgn ? (sgn > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI;
      }
      // Trânsito da rua
      const secs = wallMs / 1000;
      for (const tr of traffic) {
        const s = ((tr.offset + secs * tr.speed) % 340);
        tr.car.position.set(tr.east ? 170 - s : -170 + s, 0, tr.east ? ROAD.east : ROAD.west);
      }
      // Etiquetas
      for (const L of labels) {
        if (L.type === "bomba") {
          const busy = [sideNow[L.id + "A"], sideNow[L.id + "B"]].filter(Boolean);
          const fueling = busy.some(x => x.ph.name === "abastecendo");
          L.set(fueling ? "busy" : "", `Bomba ${L.id}` + (busy.length ? ` · ${busy.length === 2 ? "2 veículos" : fueling ? "abastecendo" : "ocupada"}` : ""));
        } else if (L === tanksLabel) {
          // Aponta para o tanque que acaba primeiro
          let worst = null, wd = Infinity, urgent = 0;
          for (const tq of B.LAYOUT.tanques) {
            const ts = tankState[tq.n]; const d = ts ? autonomy(tq.f, ts.level) : null;
            if (d != null && d < wd) { wd = d; worst = tq; }
            if (d != null && d < 2) urgent++;
          }
          if (worst) L.id = worst.n;
          L.set(urgent ? "bad" : wd < 4 ? "busy" : worst ? "" : "off", urgent ? `Tanques · ${urgent} para pedir hoje` : "Tanques");
        } else if (L.type === "tanque") {
          const ts = tankState[L.id], tq = tanks[L.id].tq;
          if (!ts || ts.frac == null) L.set("off", `T${L.id} · ${SHORT[tq.f] || fuelName(tq.f)}`);
          else { const d = autonomy(tq.f, ts.level); L.set(d != null && d < 2 ? "bad" : d != null && d < 4 ? "busy" : "", `T${L.id} · ${B.pct.format(ts.frac)}`); }
        } else if (L.type === "oleo") {
          const n = sim.shop.filter(c => t >= c.appear && t < c.gone).length;
          L.set(n ? "busy" : "", n ? `Troca de óleo · ${n} cliente${n > 1 ? "s" : ""}` : "Troca de óleo");
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

    function render() {
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

    return { camera, controls, update, render, clearDynamic, refreshStatic, findObj, glow, tankState, state, flyTo, flyCam };
  }

  function autonomy(f, level) {
    const avg = sim.avgDaily[f] || 0;
    return level != null && avg > 0 ? level / avg : null;
  }

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
  const itemList = items => `<ul class="w-list">${items.map(([n, x]) => `<li><span>${B.int.format(x.q)}×</span><span>${esc(n)}</span><span>${B.brl.format(x.v)}</span></li>`).join("")}</ul>`;
  const groupItems = items => { const top = {}; for (const i of items) { const x = top[i.p] || (top[i.p] = { q: 0, v: 0 }); x.q += i.q; x.v += i.v; } return Object.entries(top).sort((a, b) => b[1].v - a[1].v); };
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
      const b = BOMBA[p.id];
      const fuels = [...new Set([...b.lados.A, ...b.lados.B].map(x => x[1]))];
      const lados = ["A", "B"].sort((x, y) => b.pos[x] - b.pos[y]);
      eyebrow = `Posições ${b.pos[lados[0]]} e ${b.pos[lados[1]]}`;
      title = `Bomba ${b.n}`;
      sub = fuels.map(fuelName).join(", ");
      const sideNow = (world && world.state.sideNow) || {};
      for (const lado of lados) {
        const sn = sideNow[b.n + lado];
        if (sn) {
          const L = litersNow(sn.v, t), val = sn.v.v * (sn.v.q ? L / sn.v.q : 0);
          body += `<div class="w-side busy"><div class="w-side-h"><span>Posição ${b.pos[lado]} · ${PHASE_TXT[sn.ph.name]}</span><span>${KIND_TXT[sn.v.kind]}</span></div>
            <div class="w-led"><span><small>R$ </small>${B.dec2.format(val)}</span><span>${B.dec2.format(L)}<small> L</small></span></div>
            ${kv("Bico", `${sw(sn.v.f)} ${sn.v.bico} · ${esc(fuelName(sn.v.f))}${sn.v.est ? " (estimado)" : ""}`)}
            ${sn.ph.name === "abastecendo" ? `<div class="w-bar"><div style="width:${(L / sn.v.q * 100).toFixed(1)}%"></div></div>` : ""}</div>`;
        } else {
          const last = lastOnSide(b.n + lado, t);
          body += `<div class="w-side"><div class="w-side-h"><span>Posição ${b.pos[lado]} · Livre</span><span class="pill ok">Livre</span></div>
            ${last ? `<p class="w-note">Último: ${hm(last.emit)} · ${B.dec2.format(last.q)} L de ${esc(fuelName(last.f))} · ${B.brl.format(last.v)}</p>` : `<p class="w-note">Nenhum abastecimento ainda hoje.</p>`}</div>`;
        }
      }
      const rows = lados.flatMap(l => b.lados[l]).map(([n, f]) => {
        const vs = sim.visits.filter(v => v.bico === n && v.side.bomba === b.n && v.fuelEnd <= t);
        return { n, f, c: vs.length, q: vs.reduce((a, v) => a + v.q, 0), v: vs.reduce((a, v) => a + v.v, 0) };
      });
      body += `<div class="w-sec"><h3>Hoje até agora</h3><div class="tbl-wrap"><table><thead><tr><th>Bico</th><th class="r">Abast.</th><th class="r">Litros</th><th class="r">Valor</th></tr></thead><tbody>${
        rows.map(r => `<tr><td><span class="fuel-name">${sw(r.f)}${r.n} · ${esc(fuelName(r.f))}</span></td><td class="r">${B.int.format(r.c)}</td><td class="r">${B.int.format(r.q)}</td><td class="r">${B.money(r.v)}</td></tr>`).join("")
      }</tbody></table></div>`;
      body += `<p class="w-note">${real ? "Quando a nota não informa o bico, o Board escolhe um bico livre do mesmo combustível." : "Dados de exemplo."} Encerrantes e alarmes chegam com a ligação ao Meta Posto.</p></div>`;
    } else if (p.type === "veiculo") {
      const v = sim.visits.find(x => x.k === p.id);
      if (!v) { select(null); return; }
      const ph = vehiclePhase(v, t) || { name: "saindo" };
      const L = litersNow(v, t);
      eyebrow = KIND_TXT[v.kind];
      title = `Bomba ${v.side.bomba}, posição ${v.side.pos}`;
      sub = PHASE_TXT[ph.name];
      body += `<div class="w-led"><span><small>R$ </small>${B.dec2.format(v.v * (v.q ? L / v.q : 0))}</span><span>${B.dec2.format(L)}<small> L</small></span></div>`;
      if (ph.name === "abastecendo") body += `<div class="w-bar"><div style="width:${(L / v.q * 100).toFixed(1)}%"></div></div>`;
      body += `<div class="w-sec">${kv("Combustível", `${sw(v.f)} ${esc(fuelName(v.f))}`)}${kv("Bico", `${v.bico}${v.est ? " (estimado)" : ""}`)}${kv("Litros na nota", B.dec2.format(v.q) + " L")}${kv("Valor do combustível", B.brl.format(v.v))}${kv("Pagamento", esc(payName(v.s)))}${kv("Nota emitida", hm(v.emit))}</div>`;
      if (v.other.length) body += `<div class="w-sec"><h3>Levou também</h3>${itemList(v.other.map(i => [i.p, i]))}</div>`;
    } else if (p.type === "tanque") {
      const tq = B.LAYOUT.tanques.find(x => x.n === p.id);
      const ts = world ? world.tankState[p.id] : null;
      eyebrow = `Tanque ${tq.n}`; title = fuelName(tq.f); sub = `Capacidade de ${B.int.format(tq.cap)} litros`;
      const sold = sim.visits.filter(v => v.f === tq.f && v.fuelEnd <= t).reduce((a, v) => a + v.q, 0);
      const ins = sim.deliveries.flatMap(e => e.p.items.filter(i => i.f === tq.f).map(i => ({ ...i, at: e.p.t - sim.day }))).filter(i => i.at <= t);
      if (!ts || ts.level == null) body += `<p>Digite o estoque atual no Board, no cartão <b>Estoque dos tanques</b>, ou importe o SPED Fiscal com o LMC para ver o nível deste tanque.</p>`;
      else {
        const days = autonomy(tq.f, ts.level);
        const lvl = days == null ? "ok" : days < 2 ? "bad" : days < 4 ? "warn" : "ok";
        const word = { bad: "Pedir hoje", warn: "Pedir logo", ok: "Tranquilo" }[lvl];
        body += `<div class="w-big">${B.int.format(ts.level)} L<small>${B.pct.format(ts.frac)} cheio</small></div><div class="w-bar"><div style="width:${(ts.frac * 100).toFixed(1)}%;background:${fuelColor(tq.f)}"></div></div>`;
        body += `<div class="w-sec">${kv("Espaço livre", B.int.format(tq.cap - ts.level) + " L")}${days != null ? kv("Dura", `${B.dec1.format(days)} dias <span class="pill ${lvl}">${word}</span>`) : ""}</div>`;
      }
      body += `<div class="w-sec">${kv("Vendido hoje até agora", B.int.format(sold) + " L")}${ins.map(i => kv(`Entrada às ${hm(i.at)}`, B.int.format(i.q) + " L")).join("")}</div>`;
      body += `<p class="w-note">Nível estimado: estoque digitado no Board (ou a medição do LMC do SPED), menos o que foi vendido e mais o que entrou pelas notas de compra. A posição dos tanques no desenho é aproximada.</p>`;
    } else if (p.type === "cliente") {
      const c = sim.shop.find(x => x.k === p.id);
      if (!c) { select(null); return; }
      eyebrow = "Cliente da troca de óleo"; title = B.brl.format(c.s.items.reduce((a, i) => a + i.v, 0));
      sub = t < c.appear + 12 * SEC ? "Chegando" : t < c.emit + 5 * SEC ? "No balcão" : "Saindo";
      body += itemList(c.s.items.map(i => [i.p, i]));
      body += `<div class="w-sec">${kv("Pagamento", esc(payName(c.s)))}${kv("Nota emitida", hm(c.emit))}</div>`;
    } else if (p.type === "oleo") {
      const items = done(t).flatMap(s => s.items.filter(i => i.g === "pista"));
      const rev = items.reduce((a, i) => a + i.v, 0);
      eyebrow = "Cabine ao lado do muro"; title = "Troca de óleo"; sub = "Lubrificantes, ARLA e aditivos";
      body += `<div class="w-big">${B.money(rev)}<small>hoje até agora</small></div>`;
      const list = groupItems(items);
      body += list.length ? `<div class="w-sec"><h3>Vendido hoje</h3>${itemList(list)}</div>` : `<p class="w-note">Nada vendido ainda hoje.</p>`;
    } else if (p.type === "arla") {
      const items = done(t).flatMap(s => s.items.filter(i => /ARLA/i.test(i.p)));
      const rev = items.reduce((a, i) => a + i.v, 0);
      eyebrow = "Ao lado da bomba de diesel"; title = "ARLA 32"; sub = "Vendas de ARLA hoje";
      body += `<div class="w-big">${B.money(rev)}<small>${B.int.format(items.reduce((a, i) => a + i.q, 0))} unidades</small></div>`;
      body += items.length ? `<div class="w-sec"><h3>Vendido hoje</h3>${itemList(groupItems(items))}</div>` : `<p class="w-note">Nenhuma venda de ARLA ainda hoje.</p>`;
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
      eyebrow = "Pista"; title = "Cobertura das bombas"; sub = "Abastecimentos de hoje até agora";
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
      const dist = selected.type === "pista" ? 18 : 10;
      world.flyTo([c.x + dir.x * dist, Math.max(3.5, c.y + dir.y * dist), c.z + dir.z * dist], [c.x, Math.max(0, c.y), c.z]);
    });
  }

  // ---------- Placar do topo ----------
  let hudTimer = 0;
  function updateHud() {
    if (performance.now() - hudTimer < 250) return;
    hudTimer = performance.now();
    const $ = ui.$, t = sim.t;
    $("w-clock").textContent = hms(t);
    $("w-date").textContent = sim.day != null ? B.fmtWeekday(sim.day) : "";
    const m = B.summarize(done(t));
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
    world.render();
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
  window.addEventListener("bpc:change", () => {
    if (!world) return;
    const d = B.salesDays();
    planDay(d.includes(sim.day) ? sim.day : d[d.length - 1] ?? null);
    syncControls();
  });
  route();
})();
