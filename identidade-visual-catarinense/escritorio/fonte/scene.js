// helpers shared by the individual mockup scenes
window.READY_FLAG = true;
const A = document.getElementById('A');
function put(html, x, y, w, h, rot = 0, cls = 'paper', z = 1, extra = {}) {
  const d = document.createElement('div'); d.className = 'it ' + cls;
  Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w ? w + 'px' : 'auto', height: h ? h + 'px' : 'auto', transform: `rotate(${rot}deg)`, zIndex: z }, extra);
  d.innerHTML = html; A.appendChild(d); return d;
}
const img = (src, r = 0) => `<img src="${src}" style="border-radius:${r}px">`;
function layer(html, z) { const d = document.createElement('div'); d.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;z-index:${z}`; d.innerHTML = html; A.appendChild(d); return d; }

const STUDIO = 'radial-gradient(ellipse 70% 60% at 50% 32%,#fdfcf9 0%,#efebe4 55%,#ddd7cb 100%)';
function stoneBG() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><filter id='s'><feTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='5' seed='11'/><feColorMatrix values='0 0 0 0 0.55  0 0 0 0 0.52  0 0 0 0 0.47  0 0 0 -1.4 0.9'/></filter><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='2'/><feColorMatrix values='0 0 0 0 0.4  0 0 0 0 0.38  0 0 0 0 0.35  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' fill='%23ece9e3'/><rect width='100%' height='100%' filter='url(%23s)' opacity='.35'/><rect width='100%' height='100%' filter='url(%23f)' opacity='.35'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/"/g, "'")}")`;
}

// side-view mug: body PNG already wrapped/lit by cyl.py
function mugSide({ src, R, b, H, bodyH, x, y, z = 5 }) {
  const W = 2 * R, k = R / 246, wall = 21 * k, ri = R - wall, bi = b * ri / R;
  const id = uid('mug');
  layer(`<div style="position:absolute;left:${x + R * .02}px;top:${y + bodyH - b * .2}px;width:${W * 1.08}px;height:${b * 2.6}px;border-radius:50%;background:rgba(60,45,25,.38);filter:blur(${14 * k}px)"></div>
   <div style="position:absolute;left:${x + R * .12}px;top:${y + bodyH + b * .35}px;width:${W * .8}px;height:${b * 1.1}px;border-radius:50%;background:rgba(40,30,15,.45);filter:blur(${5 * k}px)"></div>`, z - 1);
  layer(`<svg width="${W + 220 * k}" height="${H + 60}" viewBox="0 ${-b - 10} ${W + 220 * k} ${H + 60}" style="position:absolute;left:${x}px;top:${y - b - 10}px;overflow:visible">
   <defs>
    <linearGradient id="${id}h" x1="0" x2="1"><stop offset="0" stop-color="#a9a9a5"/><stop offset=".25" stop-color="#e4e4e1"/><stop offset=".5" stop-color="#ffffff"/><stop offset=".78" stop-color="#d9d9d5"/><stop offset="1" stop-color="#a3a39f"/></linearGradient><filter id="${id}s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="${6*k}" dy="${10*k}" stdDeviation="${7*k}" flood-color="#3c2d18" flood-opacity=".22"/></filter>
    <linearGradient id="${id}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f1"/><stop offset=".6" stop-color="#d9d9d5"/><stop offset="1" stop-color="#b8b8b4"/></linearGradient>
    <linearGradient id="${id}r" x1="0" x2="1"><stop offset="0" stop-color="#e2e2df"/><stop offset=".3" stop-color="#ffffff"/><stop offset="1" stop-color="#dcdcd8"/></linearGradient></defs>
   <path d="M${W - 14 * k} ${95 * k} C${W + 165 * k} ${70 * k} ${W + 188 * k} ${410 * k} ${W - 14 * k} ${400 * k} L${W - 14 * k} ${345 * k} C${W + 108 * k} ${340 * k} ${W + 102 * k} ${150 * k} ${W - 14 * k} ${150 * k} Z" fill="url(#${id}h)" stroke="#a8a8a4" stroke-width="1.4" filter="url(#${id}s)"/>
   <ellipse cx="${R}" cy="0" rx="${R - .5}" ry="${b}" fill="url(#${id}r)" stroke="#cfcfcb" stroke-width="1"/>
   <ellipse cx="${R}" cy="${.6 * k}" rx="${ri}" ry="${bi}" fill="url(#${id}i)"/>
   <ellipse cx="${R}" cy="${.6 * k}" rx="${ri}" ry="${bi}" fill="none" stroke="#bdbdb9" stroke-width="1"/>
  </svg>`, z);
  layer(`<img src="${src}" style="position:absolute;left:${x}px;top:${y}px;width:${W}px;height:${H}px">`, z + 1);
}

// thermal bottle: body PNG + stainless cap
function bottle({ src, R, b, H, x, y, capH = 230, z = 5 }) {
  const rc = R * .965, id = uid('bt');
  layer(`<div style="position:absolute;left:${x - R * .05}px;top:${y + H - b * 1.2}px;width:${R * 2.2}px;height:${b * 2.8}px;border-radius:50%;background:rgba(50,38,20,.4);filter:blur(12px)"></div>
   <div style="position:absolute;left:${x + R * .15}px;top:${y + H - b * .4}px;width:${R * 1.7}px;height:${b * 1.2}px;border-radius:50%;background:rgba(30,22,10,.5);filter:blur(4px)"></div>`, z - 1);
  layer(`<img src="${src}" style="position:absolute;left:${x}px;top:${y}px;width:${2 * R}px;height:${H}px">`, z);
  layer(`<svg width="${2 * R}" height="${capH + 2 * b + 4}" viewBox="0 ${-capH - b - 2} ${2 * R} ${capH + 2 * b + 4}" style="position:absolute;left:${x}px;top:${y - capH - b - 2}px;overflow:visible">
   <defs><linearGradient id="${id}m" x1="0" x2="1"><stop offset="0" stop-color="#6f7379"/><stop offset=".1" stop-color="#b9bdc2"/><stop offset=".26" stop-color="#f6f7f8"/><stop offset=".36" stop-color="#d4d7db"/><stop offset=".55" stop-color="#8e9399"/><stop offset=".78" stop-color="#c3c7cc"/><stop offset=".92" stop-color="#9da1a7"/><stop offset="1" stop-color="#62666c"/></linearGradient>
   <linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f5f6"/><stop offset=".6" stop-color="#c9ccd0"/><stop offset="1" stop-color="#9ea2a7"/></linearGradient></defs>
   <path d="M${R - rc} ${-capH} L${R - rc} 0 A${rc} ${b} 0 0 0 ${R + rc} 0 L${R + rc} ${-capH} Z" fill="url(#${id}m)"/>
   ${[18, 28, 38].map(o => `<path d="M${R - rc} ${-o} A${rc} ${b} 0 0 0 ${R + rc} ${-o}" fill="none" stroke="#5d6167" stroke-opacity=".35" stroke-width="1.6"/><path d="M${R - rc} ${-o + 2} A${rc} ${b} 0 0 0 ${R + rc} ${-o + 2}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1"/>`).join('')}
   <ellipse cx="${R}" cy="${-capH}" rx="${rc}" ry="${b * .96}" fill="url(#${id}t)" stroke="#8d9197" stroke-width="1"/>
   <ellipse cx="${R}" cy="${-capH}" rx="${rc * .7}" ry="${b * .67}" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.5"/>
   <path d="M${R - rc} 0 A${rc} ${b} 0 0 0 ${R + rc} 0" fill="none" stroke="#1b1b1b" stroke-opacity=".45" stroke-width="2.4"/>
  </svg>`, z + 1);
}
const shadowCSS = 'drop-shadow(0 2px 2px rgba(50,35,15,.25)) drop-shadow(0 12px 18px rgba(50,35,15,.18))';
