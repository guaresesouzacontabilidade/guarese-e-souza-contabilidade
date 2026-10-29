/* Board Posto Catarinense — dados compartilhados entre o painel e o posto em 3D. */
(() => {
  "use strict";

  // ---------- Cadastros fixos ----------
  // A cor segue o combustível (nunca a posição no ranking).
  const FUELS = [
    { k: "gc", n: "Gasolina comum", s: 1 },
    { k: "ga", n: "Gasolina aditivada", s: 2 },
    { k: "et", n: "Etanol", s: 3 },
    { k: "d10", n: "Diesel S10", s: 4 },
    { k: "d500", n: "Diesel S500", s: 5 },
    { k: "gp", n: "Gasolina premium", s: 6 },
    { k: "gnv", n: "GNV", s: 7, m3: true },
  ];
  const FUEL = Object.fromEntries(FUELS.map(f => [f.k, f]));
  const GROUPS = [
    { k: "comb", n: "Combustíveis", s: 1 },
    { k: "pista", n: "Lubrificantes e pista", s: 2 },
    { k: "conv", n: "Conveniência", s: 3 },
  ];
  const PAYS = [
    { k: "pix", n: "PIX" },
    { k: "deb", n: "Cartão de débito" },
    { k: "cre", n: "Cartão de crédito" },
    { k: "din", n: "Dinheiro" },
    { k: "prazo", n: "A prazo e frotas" },
    { k: "out", n: "Outros" },
  ];
  // Códigos tPag da NFC-e
  const TPAG = { "01": "din", "02": "out", "03": "cre", "04": "deb", "05": "prazo", "10": "out", "11": "out", "12": "out", "13": "prazo", "15": "prazo", "16": "pix", "17": "pix", "18": "pix", "19": "out", "90": "out", "99": "out" };
  const DAY = 86400000;
  const STORE_KEY = "board-posto-catarinense:v1";

  // Layout padrão do posto, até a pessoa informar o real.
  // Cada bomba tem dois lados (A e B) e cada lado atende um veículo por vez.
  const LAYOUT = {
    bombas: [
      { n: 1, tipo: "carro", lados: { A: [[1, "gc"], [2, "et"]], B: [[3, "ga"], [4, "gc"]] } },
      { n: 2, tipo: "carro", lados: { A: [[5, "gc"], [6, "et"]], B: [[7, "ga"], [8, "gc"]] } },
      { n: 3, tipo: "carro", lados: { A: [[9, "gc"], [10, "et"]], B: [[11, "gc"], [12, "d10"]] } },
      { n: 4, tipo: "diesel", lados: { A: [[13, "d10"], [14, "d500"]], B: [[15, "d10"], [16, "d500"]] } },
    ],
    tanques: [
      { n: 1, f: "gc", cap: 30000 },
      { n: 2, f: "ga", cap: 15000 },
      { n: 3, f: "et", cap: 15000 },
      { n: 4, f: "d10", cap: 30000 },
      { n: 5, f: "d500", cap: 15000 },
    ],
  };
  const SIDES = [];
  const BICOS = {};
  for (const b of LAYOUT.bombas) {
    for (const lado of ["A", "B"]) {
      const side = { id: b.n + lado, bomba: b.n, lado, tipo: b.tipo, bicos: b.lados[lado].map(([n, f]) => ({ n, f })) };
      SIDES.push(side);
      for (const bi of side.bicos) BICOS[bi.n] = { n: bi.n, f: bi.f, side };
    }
  }

  // ---------- Formatação ----------
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dec2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dec3 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
  const pct1 = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const money = v => (Math.abs(v) >= 10000 ? brl0 : brl).format(v);
  const compactBRL = v => {
    const a = Math.abs(v);
    if (a >= 1e6) return "R$ " + dec2.format(v / 1e6).replace(/,00$/, "") + " mi";
    if (a >= 1e3) return "R$ " + int.format(v / 1e3) + " mil";
    return "R$ " + int.format(v);
  };
  const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
  const fmtDay = t => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const fmtDate = t => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtWeekday = t => new Date(t).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const fmtTime = t => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const r2 = v => Math.round(v * 100) / 100;

  // ---------- Leitura de números e datas ----------
  function parseNum(s) {
    if (s == null) return null;
    let t = String(s).trim().replace(/[R$\s]/g, "");
    if (!t) return null;
    const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
    t = t.replace(/[()\-]/g, "");
    if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (t.includes(",")) t = t.replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    const v = Number(t);
    return isFinite(v) ? (neg ? -v : v) : null;
  }
  function parseDate(s, hourStr) {
    if (!s) return null;
    const t = String(s).trim();
    let m;
    if ((m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      let hh = m[4], mi = m[5], ss = m[6];
      if (!hh && hourStr) { const h = String(hourStr).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (h) { hh = h[1]; mi = h[2]; ss = h[3]; } }
      return new Date(y, Number(m[2]) - 1, Number(m[1]), Number(hh || 12), Number(mi || 0), Number(ss || 0)).getTime();
    }
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/))) {
      let hh = m[4], mi = m[5], ss = m[6];
      if (!hh && hourStr) { const h = String(hourStr).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (h) { hh = h[1]; mi = h[2]; ss = h[3]; } }
      // Horário local da nota (ignora o fuso: o posto e quem olha estão no mesmo lugar)
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(hh || 12), Number(mi || 0), Number(ss || 0)).getTime();
    }
    return null;
  }

  // ---------- Classificação de produtos ----------
  function fuelOf(name, anp) {
    const t = norm(name);
    if (/\bOLEO\b(?!.*DIESEL)|LUBRIF|ARLA|^ADITIVO|ADITIVO\s+(P\/|PARA|RADIADOR|ARREF)|FLUIDO|GLP|COZINHA|BOTIJ|\bP-?13\b|\b\d{1,2}W-?\d{2}\b|\b\d+\s?ML\b/.test(t)) return null;
    if (/\bGNV\b|GAS NATURAL/.test(t)) return "gnv";
    if (/DIESEL|\bS-?10\b|\bS-?500\b/.test(t)) return /S-?500/.test(t) ? "d500" : "d10";
    if (/ETANOL|ALCOOL|\bETH\b/.test(t)) return "et";
    if (/GASOLINA|\bGAS\b|\bGC\b|\bGA\b/.test(t)) {
      if (/PREMIUM|PODIUM|V-?POWER|GRID|OCTAPRO|SUPRA/.test(t)) return "gp";
      if (/ADIT|DT CLEAN|\bADT\b/.test(t)) return "ga";
      return "gc";
    }
    const a = String(anp || "");
    if (a === "320102002") return "ga";
    if (a === "320102003") return "gp";
    if (a.startsWith("3201")) return "gc";
    if (a.startsWith("8101")) return "et";
    if (a.startsWith("8201")) return "d10";
    if (a.startsWith("2201")) return "gnv";
    return null;
  }
  function groupOf(name, ncm) {
    const t = norm(name), n = String(ncm || "");
    if (/^(2710|3403|3811|3819|3820|31021010)/.test(n)) return "pista";
    if (/\bOLEO\b|LUBRIF|ARLA|ADITIVO|FLUIDO|ARREFEC|PALHETA|FILTRO|LAMPADA|\b\d{1,2}W-?\d{2}\b/.test(t)) return "pista";
    return "conv";
  }
  const isM3 = u => /M3|M³/.test(norm(u));

  // ---------- Dados de exemplo ----------
  // Gerados com semente fixa: os mesmos números a cada abertura.
  function makeSample() {
    let seed = 20261029;
    const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const pick = arr => { let r = rnd() * arr.reduce((a, x) => a + x[1], 0); for (const x of arr) { if ((r -= x[1]) <= 0) return x[0]; } return arr[0][0]; };
    const prices = { gc: 6.399, ga: 6.599, et: 4.899, d10: 6.199, d500: 6.099 };
    const costs = { gc: 5.89, ga: 6.04, et: 4.41, d10: 5.71, d500: 5.63 };
    const fuelMix = [["gc", 48], ["ga", 13], ["et", 15], ["d10", 20], ["d500", 4]];
    const hourW = [1, .6, .5, .5, .7, 1.6, 4, 7.5, 8, 6.5, 5.5, 6, 7, 6.5, 5.5, 5.5, 6.5, 8.5, 9, 7, 4.5, 3.2, 2.2, 1.5];
    const hourMix = hourW.map((w, h) => [h, w]);
    const shop = [
      ["Água mineral 500 ml", 3.5, 18, "conv"], ["Refrigerante lata 350 ml", 6, 14, "conv"], ["Café expresso", 5.5, 16, "conv"],
      ["Pão de queijo", 4.5, 13, "conv"], ["Salgado assado", 8.5, 9, "conv"], ["Energético 473 ml", 12.9, 7, "conv"],
      ["Chocolate ao leite 90 g", 7.9, 6, "conv"], ["Gelo 5 kg", 13, 4, "conv"], ["Sorvete picolé", 7, 4, "conv"],
      ["Óleo motor 5W30 1 L", 49.9, 2.2, "pista"], ["ARLA 32 balde 20 L", 89.9, 1.4, "pista"], ["Aditivo radiador 1 L", 29.9, 1, "pista"],
      ["Palheta limpador", 39.9, .5, "pista"],
    ];
    const shopMix = shop.map((p, i) => [i, p[2]]);
    const payFuel = [["pix", 34], ["deb", 22], ["cre", 26], ["din", 8], ["prazo", 10]];
    const payShop = [["pix", 40], ["deb", 22], ["cre", 20], ["din", 18]];
    const end = dayStart(Date.now());
    const sales = [];
    let n = 0;
    for (let d = 60; d >= 1; d--) {
      const day = addDays(end, -d);
      const wd = new Date(day).getDay();
      const dayF = (wd === 0 ? .72 : wd === 6 ? .9 : wd === 5 ? 1.12 : 1) * (0.92 + rnd() * .16);
      const nFuel = Math.round(230 * dayF), nShop = Math.round(160 * dayF);
      for (let i = 0; i < nFuel + nShop; i++) {
        const isFuel = i < nFuel;
        const h = pick(hourMix);
        const t = day + h * 3600000 + Math.floor(rnd() * 3600000);
        const items = [];
        if (isFuel) {
          const f = pick(fuelMix);
          let q;
          if (f === "d10" || f === "d500") q = rnd() < .3 ? 80 + rnd() * 200 : 25 + rnd() * 50;
          else q = rnd() < .35 ? Math.round(5 + rnd() * 9) * 10 / prices[f] : 12 + rnd() * 38;
          q = Math.round(q * 1000) / 1000;
          items.push({ p: FUEL[f].n, g: "comb", f, q, u: "L", v: r2(q * prices[f]) });
          if (rnd() < .07) { const s = shop[pick(shopMix)]; items.push({ p: s[0], g: s[3], q: 1, u: "UN", v: s[1] }); }
        } else {
          const k = 1 + (rnd() < .35 ? 1 : 0) + (rnd() < .1 ? 1 : 0);
          for (let j = 0; j < k; j++) { const s = shop[pick(shopMix)]; const q = s[3] === "conv" && rnd() < .2 ? 2 : 1; items.push({ p: s[0], g: s[3], q, u: "UN", v: r2(s[1] * q) }); }
        }
        const total = r2(items.reduce((a, x) => a + x.v, 0));
        sales.push({ k: "ex" + (n++), t, items, pays: { [pick(isFuel ? payFuel : payShop)]: total } });
      }
    }
    sales.sort((a, b) => a.t - b.t);

    // Entregas da distribuidora a cada 2 dias: gasolinas e etanol num dia, diesel no outro.
    const litersByFuel = {};
    for (const s of sales) for (const it of s.items) if (it.f) litersByFuel[it.f] = (litersByFuel[it.f] || 0) + it.q;
    const purchases = [];
    for (let d = 60; d >= 1; d--) {
      const day = addDays(end, -d);
      const fuels = d % 2 === 0 ? ["gc", "ga", "et"] : ["d10", "d500"];
      const items = fuels.map(f => {
        const q = Math.max(1000, Math.round(litersByFuel[f] / 60 * 2 / 500) * 500);
        return { f, q, v: r2(q * costs[f] * (0.99 + rnd() * .02)) };
      });
      purchases.push({ k: "exc" + d, t: day + (d % 2 === 0 ? 9.5 : 10.25) * 3600000, items });
    }

    return {
      mode: "sample", sales, purchases, cancelled: [], seen: [], cnpj: null,
      costs: { ...costs },
      stock: { gc: 14000, ga: 2900, et: 5200, d10: 6800, d500: 4500 },
    };
  }

  // ---------- Estado ----------
  const state = { db: null, saveFailed: false };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const v = JSON.parse(raw); if (v && Array.isArray(v.sales) && v.sales.length) state.db = v; }
  } catch (e) {}
  if (!state.db) state.db = makeSample();
  function save() {
    if (state.db.mode !== "real") return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.db)); state.saveFailed = false; }
    catch (e) { state.saveFailed = true; }
  }
  // Avisa o painel e o posto 3D que os dados mudaram.
  const changed = () => window.dispatchEvent(new Event("bpc:change"));

  // ---------- Cálculos ----------
  function salesIn(a, b) {
    // As vendas estão em ordem de horário: busca binária pelos limites.
    const s = state.db.sales;
    const lo = x => { let l = 0, h = s.length; while (l < h) { const m = (l + h) >> 1; if (s[m].t < x) l = m + 1; else h = m; } return l; };
    return s.slice(lo(a), lo(b));
  }
  function salesDays() {
    const out = [];
    let last = null;
    for (const s of state.db.sales) { const d = dayStart(s.t); if (d !== last) { out.push(d); last = d; } }
    return out;
  }
  function purchaseCost() {
    // Custo médio por litro nas notas de compra dos últimos 60 dias de dados.
    const db = state.db, out = {};
    if (!db.purchases.length) return out;
    const maxT = Math.max(...db.purchases.map(p => p.t));
    const acc = {};
    for (const p of db.purchases) {
      if (p.t < maxT - 60 * DAY) continue;
      for (const it of p.items) { const a = acc[it.f] || (acc[it.f] = { q: 0, v: 0 }); a.q += it.q; a.v += it.v; }
    }
    for (const f in acc) if (acc[f].q > 0) out[f] = acc[f].v / acc[f].q;
    return out;
  }
  function costFor(f, pc) {
    const db = state.db;
    if (db.costs && db.costs[f] != null) return { v: db.costs[f], src: db.mode === "sample" ? "exemplo" : "digitado" };
    if (pc[f] != null) return { v: pc[f], src: "notas de compra" };
    return null;
  }
  function summarize(list) {
    const m = { rev: 0, n: list.length, fuelSales: 0, liters: 0, groups: { comb: 0, pista: 0, conv: 0 }, fuels: {}, pays: {}, shop: {} };
    for (const s of list) {
      let hasFuel = false;
      for (const it of s.items) {
        m.rev += it.v;
        m.groups[it.g] += it.v;
        if (it.f) {
          hasFuel = true;
          const f = m.fuels[it.f] || (m.fuels[it.f] = { q: 0, v: 0 });
          f.q += it.q; f.v += it.v;
          if (!FUEL[it.f].m3) m.liters += it.q;
        } else {
          const p = m.shop[it.p] || (m.shop[it.p] = { q: 0, v: 0, g: it.g });
          p.q += it.q; p.v += it.v;
        }
      }
      if (hasFuel) m.fuelSales++;
      for (const k in s.pays) m.pays[k] = (m.pays[k] || 0) + s.pays[k];
    }
    const pc = purchaseCost();
    m.margin = 0; m.marginLiters = 0; m.fuelsWithCost = 0;
    for (const f in m.fuels) {
      const c = costFor(f, pc);
      if (c && m.fuels[f].q > 0) { m.margin += m.fuels[f].v - c.v * m.fuels[f].q; if (!FUEL[f].m3) m.marginLiters += m.fuels[f].q; m.fuelsWithCost++; }
    }
    return m;
  }
  // Estoque estimado de um combustível num instante: o estoque digitado vale para o fim dos dados;
  // voltando no tempo, soma o que foi vendido depois e tira o que chegou depois.
  function stockAt(f, t) {
    const db = state.db;
    if (!db.stock || db.stock[f] == null) return null;
    let v = db.stock[f];
    for (const s of db.sales) if (s.t > t) for (const it of s.items) if (it.f === f) v += it.q;
    for (const p of db.purchases) if (p.t > t) for (const it of p.items) if (it.f === f) v -= it.q;
    return v;
  }

  window.BPC = {
    FUELS, FUEL, GROUPS, PAYS, TPAG, DAY, STORE_KEY, LAYOUT, SIDES, BICOS,
    brl, brl0, int, dec1, dec2, dec3, pct, pct1, money, compactBRL,
    dayStart, addDays, fmtDay, fmtDate, fmtWeekday, fmtTime, norm, r2, parseNum, parseDate,
    fuelOf, groupOf, isM3, makeSample, state, save, changed,
    salesIn, salesDays, purchaseCost, costFor, summarize, stockAt,
  };
})();
