// Vector office objects (brand colours only: green #07431F, wine #8E0F16, white; chrome metal)
let _uid = 0;
const uid = p => `${p}${++_uid}`;

const CHROME = [[0, '#5c6066'], [.18, '#d9dde1'], [.3, '#ffffff'], [.46, '#aeb3b9'], [.7, '#4c5056'], [.88, '#9aa0a6'], [1, '#c9cdd2']];
const BARREL = {
  green: [[0, '#011a0b'], [.12, '#05391a'], [.3, '#2f6e4b'], [.38, '#5d9a77'], [.46, '#0b4d27'], [.8, '#04301a'], [1, '#011309']],
  white: [[0, '#a9aba7'], [.1, '#ecece9'], [.28, '#ffffff'], [.5, '#ffffff'], [.75, '#f0f0ed'], [.92, '#d3d4d0'], [1, '#9c9e9a']],
};
function lin(id, stops, x2 = 0, y2 = 1) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(s => `<stop offset="${s[0]}" stop-color="${s[1]}"/>`).join('')}</linearGradient>`;
}

// Pen seen from above, pointing left. Returns an <svg> string, size len x d.
function penSVG({ len = 1400, color = 'green', width }) {
  const D = 100, g = uid('pg'), c = uid('pc'), m = uid('pm'), sh = uid('ps');
  const print = color === 'green' ? '#ffffff' : '#07431f';
  const W = width || len;
  return `<svg viewBox="0 0 1400 ${D}" width="${W}" height="${W * D / 1400}" style="overflow:visible;display:block">
  <defs>${lin(g, BARREL[color])}${lin(c, CHROME)}
   <mask id="${m}" maskUnits="userSpaceOnUse" x="0" y="0" width="1400" height="100"><image href="a/word_tight.png" x="270" y="34" width="290" height="35.8" preserveAspectRatio="none"/></mask>
   <filter id="${sh}" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>
  <path d="M0 50 L20 46 L20 54 Z" fill="#2c2c2c"/>
  <path d="M18 45 C60 40 110 12 150 9 L150 91 C110 88 60 60 18 55 Z" fill="url(#${c})"/>
  <rect x="148" y="6" width="16" height="88" rx="3" fill="url(#${c})"/>
  <rect x="162" y="6" width="530" height="88" fill="url(#${g})"/>
  <rect x="270" y="0" width="290" height="100" fill="${print}" mask="url(#${m})"/>
  <rect x="688" y="3" width="26" height="94" rx="3" fill="url(#${c})"/>
  <rect x="712" y="4" width="610" height="92" fill="url(#${g})"/>
  <path d="M1320 4 L1362 6 C1392 12 1400 30 1400 50 C1400 70 1392 88 1362 94 L1320 96 Z" fill="url(#${c})"/>
  <path d="M790 54 L1335 58 L1335 42 L790 46 Z" fill="#000" opacity=".45" filter="url(#${sh})" transform="translate(4 7)"/>
  <path d="M780 42 C780 35 786 34 792 37 L1240 40 L1345 37 L1345 63 L1240 60 L792 63 C786 66 780 65 780 58 Z" fill="url(#${c})"/>
  <circle cx="786" cy="50" r="14" fill="url(#${c})"/>
  <rect x="1240" y="36" width="104" height="28" rx="4" fill="url(#${c})"/>
  </svg>`;
}

// Mug seen from above with coffee. r = outer radius in px; handle to the right.
function mugTopSVG({ r = 130 }) {
  const a = uid('ma'), b = uid('mb'), c = uid('mc'), h = uid('mh'), f = uid('mf');
  const W = r * 2.7, H = r * 2;
  return `<svg width="${W}" height="${H}" viewBox="${-r} ${-r} ${W} ${H}" style="overflow:visible;display:block">
  <defs>
   <radialGradient id="${a}" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".8" stop-color="#f3f3f1"/><stop offset="1" stop-color="#dadad6"/></radialGradient>
   <radialGradient id="${b}" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#e9e9e6"/><stop offset="1" stop-color="#c9c9c5"/></radialGradient>
   <radialGradient id="${c}" cx=".46" cy=".44" r=".58"><stop offset="0" stop-color="#2e190d"/><stop offset=".62" stop-color="#4a2a15"/><stop offset=".86" stop-color="#7a4b28"/><stop offset=".97" stop-color="#b0835a"/><stop offset="1" stop-color="#c79c72"/></radialGradient>
   <linearGradient id="${h}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#ecece9"/><stop offset="1" stop-color="#c4c4c0"/></linearGradient>
   <filter id="${f}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${r * .09}"/></filter></defs>
  <g opacity=".42" filter="url(#${f})" transform="translate(${r * .1} ${r * .14})"><circle r="${r}" fill="#3a2a18"/><rect x="${r * .8}" y="${-r * .17}" width="${r * .92}" height="${r * .34}" rx="${r * .17}" fill="#3a2a18"/></g>
  <rect x="${r * .82}" y="${-r * .165}" width="${r * .9}" height="${r * .33}" rx="${r * .165}" fill="url(#${h})" stroke="#cfcfcb" stroke-width="1"/>
  <rect x="${r * 1.0}" y="${-r * .075}" width="${r * .58}" height="${r * .15}" rx="${r * .075}" fill="#d6d6d2" opacity=".6"/>
  <circle r="${r}" fill="url(#${a})" stroke="#cdcdc9" stroke-width="1.2"/>
  <circle r="${r * .9}" fill="url(#${b})"/>
  <circle r="${r * .8}" fill="url(#${c})"/>
  <ellipse cx="${-r * .22}" cy="${-r * .26}" rx="${r * .3}" ry="${r * .12}" fill="#fff" opacity=".10" transform="rotate(-30 ${-r * .22} ${-r * .26})"/>
  <circle r="${r * .955}" fill="none" stroke="#ffffff" stroke-width="${r * .04}" opacity=".9"/>
  </svg>`;
}

// Lanyard strap along an SVG path (green with white edges and repeated white text)
function lanyardSVG({ d, w = 46, W = 2400, H = 1600, text = 'CATARINENSE · CATARINENSEGESTAO.COM.BR · ', size = 15 }) {
  const p = uid('lp');
  const rep = text.repeat(14);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;overflow:visible">
   <defs><path id="${p}" d="${d}"/></defs>
   <use href="#${p}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="${w + 6}" transform="translate(5 9)" style="filter:blur(5px)"/>
   <use href="#${p}" fill="none" stroke="#ffffff" stroke-width="${w}" stroke-linecap="butt"/>
   <use href="#${p}" fill="none" stroke="#07431f" stroke-width="${w - 7}" stroke-linecap="butt"/>
   <use href="#${p}" fill="none" stroke="#8e0f16" stroke-width="2" stroke-linecap="butt" transform="translate(0 0)" opacity="0"/>
   <text font-family="Montserrat" font-weight="600" font-size="${size}" letter-spacing="2.5" fill="#ffffff" dy="${size * .36}"><textPath href="#${p}">${rep}</textPath></text>
  </svg>`;
}

// Spiral notebook seen from above (front cover image already trimmed to w x h ratio 148:210 with 15/770 bleed)
function notebookHTML({ cover, w = 474, spiral = 'black', elastic = 'black' }) {
  const h = w * 210 / 148, s = w / 640;
  const metals = { black: { out: '#000', base: '#2b2b2d', hi: '#77787c', bout: '#000', bbase: '#1a1a1a' },
    silver: { out: '#4a4c50', base: '#b4b8bd', hi: '#f4f6f8', bout: '#2e3033', bbase: '#7d8186' } };
  const bands = { black: ['#050505', '#1e1e1f', '#4a4a4c'], green: ['#03230f', '#0a4a25', '#1d6e3e'] };
  const m = metals[spiral], b = bands[elastic];
  const N = 32, top0 = 15 * s, pitch = (h - 2 * top0) / (N - 1), HX = 20 * s, R = 17 * s, K = .42, WIRE = 4.6 * s;
  const arc = (y0, t0, t1) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = t0 + (t1 - t0) * i / 24, x = (HX - R) + R * Math.cos(t), z = R * Math.sin(t);
      pts.push(`${(x + 30 * s).toFixed(2)} ${(y0 + pitch * (t / (2 * Math.PI)) - K * z).toFixed(2)}`);
    }
    return 'M' + pts.join(' L');
  };
  let back = '', front = '', holes = '', shadow = '';
  for (let i = 0; i < N; i++) {
    const y0 = top0 + i * pitch;
    if (i < N - 1) { const d = arc(y0, Math.PI, 2 * Math.PI); back += `<path d="${d}" stroke="${m.bout}" stroke-width="${WIRE + 1.4 * s}"/><path d="${d}" stroke="${m.bbase}" stroke-width="${WIRE - .4 * s}"/>`; }
    holes += `<rect x="${30 * s + HX - 5 * s}" y="${y0 - 4.2 * s}" width="${10 * s}" height="${8.4 * s}" rx="${3.6 * s}" fill="#1d1d1d"/>`;
    const d = arc(y0, .08, Math.PI);
    shadow += `<path d="${arc(y0, 0, Math.PI)}" stroke="#000" stroke-width="${WIRE + s}"/>`;
    front += `<path d="${d}" stroke="${m.out}" stroke-width="${WIRE + 1.6 * s}"/><path d="${d}" stroke="${m.base}" stroke-width="${WIRE}"/><path d="${d}" stroke="${m.hi}" stroke-width="${WIRE * .34}" opacity=".9" transform="translate(${-.6 * s} ${-1.1 * s})"/>`;
  }
  const bleed = 15 * w / 740, f = uid('nf');
  const EX = Math.round(w * .922) + 30 * s;
  return `<div style="position:relative;width:${w + 40 * s}px;height:${h + 10 * s}px">
   <div style="position:absolute;left:${30 * s}px;top:${7 * s}px;width:${w + 7 * s}px;height:${h}px;border-radius:0 ${14 * s}px ${14 * s}px 0;background:#2a2a2a"></div>
   <div style="position:absolute;left:${30 * s}px;top:${2 * s}px;width:${w + 4 * s}px;height:${h + 3 * s}px;border-radius:0 ${13 * s}px ${13 * s}px 0;background:#f3f3f0;box-shadow:1px 1px 0 #d9d9d5,2px 2px 0 #f6f6f3,3px 3px 0 #d2d2ce"></div>
   <svg width="${w + 40 * s}" height="${h + 10 * s}" style="position:absolute;left:0;top:0;overflow:visible" fill="none" stroke-linecap="round" stroke-linejoin="round">${back}</svg>
   <div style="position:absolute;left:${30 * s}px;top:0;width:${w}px;height:${h}px;overflow:hidden;border-radius:0 ${13 * s}px ${13 * s}px 0">
     <img src="${cover}" style="position:absolute;left:${-bleed}px;top:${-bleed}px;width:${w * 770 / 740}px;height:${h * 1080 / 1050}px">
     <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.16) 0,rgba(0,0,0,.05) ${34 * s}px,rgba(0,0,0,0) ${70 * s}px)"></div>
     <div style="position:absolute;inset:0;border-radius:0 ${13 * s}px ${13 * s}px 0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)"></div></div>
   <div style="position:absolute;left:${EX}px;top:${-5 * s}px;width:${14 * s}px;height:${h + 13 * s}px;border-radius:${3 * s}px;background:linear-gradient(90deg,${b[0]} 0%,${b[1]} 22%,${b[2]} 50%,${b[1]} 78%,${b[0]} 100%);box-shadow:${3 * s}px 0 ${5 * s}px rgba(0,0,0,.3)"></div>
   <svg width="${w + 40 * s}" height="${h + 10 * s}" style="position:absolute;left:0;top:0;overflow:visible" fill="none" stroke-linecap="round" stroke-linejoin="round">
     <defs><filter id="${f}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${2.2 * s}"/></filter></defs>
     ${holes}<g filter="url(#${f})" opacity=".4" transform="translate(${3.5 * s} ${4.5 * s})">${shadow}</g>${front}</svg>
  </div>`;
}

// Light oak table texture as a CSS background (SVG turbulence)
function woodBG(seed = 3) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='2400' height='1600'><filter id='w'><feTurbulence type='fractalNoise' baseFrequency='0.0018 0.055' numOctaves='4' seed='${seed}'/><feColorMatrix values='0 0 0 0 0.86  0 0 0 0 0.74  0 0 0 0 0.57  0 0 0 -2.2 1.55'/></filter><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.004 0.6' numOctaves='2' seed='${seed + 4}'/><feColorMatrix values='0 0 0 0 0.55  0 0 0 0 0.4  0 0 0 0 0.25  0 0 0 -1.6 0.95'/></filter><rect width='100%' height='100%' fill='%23eadbc2'/><rect width='100%' height='100%' filter='url(%23w)'/><rect width='100%' height='100%' filter='url(%23g)' opacity='.35'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23').replace(/"/g, "'")}")`;
}
