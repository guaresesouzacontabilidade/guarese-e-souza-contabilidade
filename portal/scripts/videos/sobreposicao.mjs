/**
 * Camada desenhada por cima do portal durante a gravação dos vídeos de
 * apresentação: legenda, vinheta de título, seta do mouse (o navegador sem
 * janela não desenha o cursor) e destaque de um trecho da tela. É instalada
 * em cada página com `addInitScript` e guarda o estado em sessionStorage para
 * continuar igual depois de uma navegação completa.
 */
export function instalarSobreposicao() {
  if (window.__video) return;
  const CHAVE = "__video_estado";
  const ler = () => {
    try {
      return JSON.parse(sessionStorage.getItem(CHAVE) ?? "{}");
    } catch {
      return {};
    }
  };
  const gravar = (parcial) => {
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify({ ...ler(), ...parcial }));
    } catch {
      /* sem sessionStorage: a legenda some na próxima navegação */
    }
  };

  const CSS = `
  #__video{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:"Inter Variable","Inter",system-ui,sans-serif}
  #__video .leg{position:absolute;left:50%;bottom:26px;transform:translate(-50%,8px);max-width:min(920px,calc(100% - 32px));padding:14px 22px 15px;border-radius:16px;
    background:rgba(9,12,24,.88);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px -12px rgba(0,0,0,.55);backdrop-filter:blur(10px);
    color:#fff;opacity:0;transition:opacity .35s ease,transform .35s ease}
  #__video .leg.on{opacity:1;transform:translate(-50%,0)}
  #__video .leg small{display:block;margin-bottom:3px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    background:linear-gradient(90deg,#a78bfa,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}
  #__video .leg span{display:block;font-size:21px;line-height:1.38;font-weight:500}
  #__video.celular .leg{bottom:84px;padding:11px 15px 12px;border-radius:14px}
  #__video.celular .leg span{font-size:16px}
  #__video.celular .leg small{font-size:10.5px}
  #__video .cursor{position:absolute;left:0;top:0;width:26px;height:26px;margin:-3px 0 0 -4px;transition:transform .08s linear;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
  #__video .cursor.baixo svg{transform:scale(.86);transform-origin:4px 3px}
  #__video .onda{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:999px;border:3px solid #8b5cf6;background:rgba(139,92,246,.18);
    animation:__onda .6s ease-out forwards}
  @keyframes __onda{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
  #__video .destaque{position:absolute;border-radius:14px;border:3px solid #8b5cf6;box-shadow:0 0 0 6px rgba(139,92,246,.22),0 0 34px rgba(34,211,238,.45);
    opacity:0;transition:opacity .35s ease}
  #__video .destaque.on{opacity:1}
  #__video .titulo{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;
    background:radial-gradient(900px 520px at 18% 12%,rgba(139,92,246,.42),transparent 62%),radial-gradient(900px 600px at 85% 90%,rgba(34,211,238,.28),transparent 60%),#070a12;
    color:#fff;opacity:1;transition:opacity .6s ease}
  #__video .titulo.sai{opacity:0}
  #__video .titulo .marca{font-size:14px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#c4b5fd}
  #__video .titulo h1{margin:0;font-family:"Space Grotesk Variable","Inter",system-ui,sans-serif;font-size:56px;line-height:1.05;font-weight:700;letter-spacing:-.02em;
    background:linear-gradient(90deg,#fff,#c4b5fd 55%,#67e8f9);-webkit-background-clip:text;background-clip:text;color:transparent;max-width:1000px}
  #__video .titulo p{margin:0;max-width:760px;font-size:22px;line-height:1.45;color:rgba(255,255,255,.82)}
  #__video .titulo .num{padding:6px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);font-size:14px;font-weight:600;color:#e9e5ff}
  #__video .titulo .rodape{position:absolute;bottom:26px;font-size:13px;color:rgba(255,255,255,.55)}
  #__video.celular .titulo h1{font-size:36px}
  #__video.celular .titulo p{font-size:17px}
  `;

  const SETA = `<svg viewBox="0 0 26 26" width="26" height="26"><path d="M4 2.5 L4 21 L9 16.6 L12.3 24 L15.6 22.5 L12.4 15.3 L19 15.3 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

  let raiz;
  let leg;
  let cursor;
  function montar() {
    if (raiz || !document.body) return;
    const estilo = document.createElement("style");
    estilo.textContent = CSS;
    document.head.appendChild(estilo);
    raiz = document.createElement("div");
    raiz.id = "__video";
    if (window.innerWidth < 600) raiz.classList.add("celular");
    leg = document.createElement("div");
    leg.className = "leg";
    leg.innerHTML = "<small></small><span></span>";
    cursor = document.createElement("div");
    cursor.className = "cursor";
    cursor.innerHTML = SETA;
    raiz.append(leg, cursor);
    document.body.appendChild(raiz);
    const e = ler();
    if (e.legenda) mostrarLegenda(e.legenda, e.capitulo, true);
    moverCursor(e.x ?? window.innerWidth * 0.62, e.y ?? window.innerHeight * 0.55);
    if (e.semCursor) cursor.style.display = "none";
  }

  function moverCursor(x, y) {
    if (!cursor) return;
    cursor.style.transform = `translate(${x}px,${y}px)`;
  }
  function mostrarLegenda(texto, capitulo, imediato) {
    if (!leg) return;
    const aplicar = () => {
      leg.querySelector("small").textContent = capitulo ?? "";
      leg.querySelector("small").style.display = capitulo ? "block" : "none";
      leg.querySelector("span").textContent = texto ?? "";
      leg.classList.toggle("on", Boolean(texto));
    };
    if (imediato || !leg.classList.contains("on")) aplicar();
    else {
      leg.classList.remove("on");
      setTimeout(aplicar, 280);
    }
  }

  window.addEventListener(
    "mousemove",
    (ev) => {
      moverCursor(ev.clientX, ev.clientY);
      gravar({ x: ev.clientX, y: ev.clientY });
    },
    true,
  );
  window.addEventListener(
    "pointerdown",
    (ev) => {
      if (!raiz) return;
      const onda = document.createElement("div");
      onda.className = "onda";
      onda.style.left = `${ev.clientX}px`;
      onda.style.top = `${ev.clientY}px`;
      raiz.appendChild(onda);
      setTimeout(() => onda.remove(), 700);
      cursor?.classList.add("baixo");
    },
    true,
  );
  window.addEventListener("pointerup", () => cursor?.classList.remove("baixo"), true);

  window.__video = {
    legenda(texto, capitulo) {
      gravar({ legenda: texto, capitulo });
      montar();
      mostrarLegenda(texto, capitulo, false);
    },
    titulo({ titulo, subtitulo, numero }) {
      montar();
      const t = document.createElement("div");
      t.className = "titulo";
      t.innerHTML = `<div class="marca">Portal Guarese's ON</div><h1></h1><p></p>${numero ? '<div class="num"></div>' : ""}<div class="rodape">Demonstração com dados fictícios</div>`;
      t.querySelector("h1").textContent = titulo;
      t.querySelector("p").textContent = subtitulo ?? "";
      if (numero) t.querySelector(".num").textContent = numero;
      raiz.appendChild(t);
    },
    tituloSair() {
      const t = raiz?.querySelector(".titulo");
      if (!t) return;
      t.classList.add("sai");
      setTimeout(() => t.remove(), 700);
    },
    destaque(x, y, w, h, ms) {
      montar();
      const d = document.createElement("div");
      d.className = "destaque";
      Object.assign(d.style, { left: `${x - 6}px`, top: `${y - 6}px`, width: `${w + 12}px`, height: `${h + 12}px` });
      raiz.appendChild(d);
      requestAnimationFrame(() => d.classList.add("on"));
      setTimeout(() => {
        d.classList.remove("on");
        setTimeout(() => d.remove(), 400);
      }, ms);
    },
    semCursor() {
      gravar({ semCursor: true });
      if (cursor) cursor.style.display = "none";
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
  else montar();
}
