// Efeitos: confete de corações e sons curtos gerados pelo próprio app (sem arquivos de áudio).
import { getPrefs } from '../data/store.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function confetti({ count = 90 } = {}) {
  if (reduced()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth;
  const H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#ff8ab0', '#d93a76', '#ffd166', '#8b5cf6', '#3ccf8e', '#6aa5ff', '#ffffff'];
  const parts = Array.from({ length: count }, (_, i) => ({
    x: W / 2 + (Math.random() - 0.5) * 80,
    y: H * 0.42,
    vx: (Math.random() - 0.5) * 13,
    vy: -Math.random() * 13 - 5,
    size: 7 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[i % colors.length],
    heart: i % 3 === 0,
  }));
  const heart = (s) => {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.3);
    ctx.bezierCurveTo(0, 0, -s * 0.5, 0, -s * 0.5, s * 0.3);
    ctx.bezierCurveTo(-s * 0.5, s * 0.6, 0, s * 0.8, 0, s);
    ctx.bezierCurveTo(0, s * 0.8, s * 0.5, s * 0.6, s * 0.5, s * 0.3);
    ctx.bezierCurveTo(s * 0.5, 0, 0, 0, 0, s * 0.3);
    ctx.fill();
  };
  const start = performance.now();
  const frame = (t) => {
    const age = t - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 2600);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.heart) heart(p.size * 1.5);
      else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (age < 2700) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

let audio = null;
function ctx() {
  if (!getPrefs().sound) return null;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.06 } = {}) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sounds = {
  flip: () => tone(660, { dur: 0.08, type: 'triangle', gain: 0.035 }),
  again: () => tone(220, { dur: 0.14, type: 'sine', gain: 0.05 }),
  good: () => {
    tone(784, { dur: 0.1, gain: 0.04 });
    tone(1046, { at: 0.06, dur: 0.12, gain: 0.035 });
  },
  done: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.28, type: 'triangle', gain: 0.05 })),
};

export function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iPhone não vibra pela web */
  }
}
