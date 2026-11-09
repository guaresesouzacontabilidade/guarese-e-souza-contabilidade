// Sons curtos gerados na hora (sem arquivos de áudio): discretos, só para dar resposta ao toque.
let ctx = null;
let out = null;
let noiseBuffer = null;

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      // iPhone: respeita a chave de silencioso e não interrompe a música que estiver tocando.
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch {
      /* sem controle de sessão de áudio */
    }
    ctx = new AC({ latencyHint: 'interactive' });
    // Compressor evita estalos quando dois sons se sobrepõem.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    out = ctx.createGain();
    out.gain.value = 1;
    out.connect(comp);
    comp.connect(ctx.destination);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') ctx.suspend().catch(() => {});
    });
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Uma nota com ataque rápido e queda suave.
function tone(c, { type = 'sine', freq, to, start = 0, dur = 0.08, gain = 0.05, attack = 0.004 }) {
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

// Sopro filtrado (o "swish" da troca de tela).
function swish(c, { start = 0, dur = 0.14, gain = 0.03, from = 700, to = 2400, q = 1.1 }) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.4), c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + start;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + dur + 0.03);
}

const SOUNDS = {
  // Clique de vidro, bem curto.
  tap: (c) => {
    tone(c, { type: 'triangle', freq: 1400, to: 900, dur: 0.04, gain: 0.03, attack: 0.002 });
  },
  nav: (c) => {
    swish(c, { dur: 0.15, gain: 0.028 });
    tone(c, { freq: 1180, to: 1480, dur: 0.07, gain: 0.014, start: 0.03 });
  },
  on: (c) => {
    tone(c, { freq: 880, dur: 0.05, gain: 0.03 });
    tone(c, { freq: 1320, dur: 0.08, gain: 0.03, start: 0.05 });
  },
  off: (c) => {
    tone(c, { freq: 1320, dur: 0.05, gain: 0.026 });
    tone(c, { freq: 880, dur: 0.08, gain: 0.026, start: 0.05 });
  },
  // Duas notas (dó e sol): "registrado".
  save: (c) => {
    tone(c, { freq: 1046.5, dur: 0.18, gain: 0.035 });
    tone(c, { freq: 1568, dur: 0.26, gain: 0.03, start: 0.07 });
  },
  // Arpejo de dó maior: conta paga, importação feita.
  success: (c) => {
    [1046.5, 1318.5, 1568, 2093].forEach((freq, i) => {
      tone(c, { freq, dur: 0.32, gain: 0.034 - i * 0.004, start: i * 0.06 });
      tone(c, { freq: freq * 2.003, dur: 0.18, gain: 0.006, start: i * 0.06 });
    });
  },
  // "Pop" + brilho: tarefa concluída.
  complete: (c) => {
    tone(c, { freq: 480, to: 980, dur: 0.07, gain: 0.04 });
    tone(c, { freq: 1568, dur: 0.22, gain: 0.026, start: 0.07 });
    tone(c, { freq: 2093, dur: 0.28, gain: 0.02, start: 0.12 });
  },
  undo: (c) => {
    tone(c, { freq: 900, to: 560, dur: 0.09, gain: 0.03 });
  },
  warning: (c) => {
    tone(c, { type: 'triangle', freq: 587, dur: 0.12, gain: 0.04 });
    tone(c, { type: 'triangle', freq: 440, dur: 0.2, gain: 0.04, start: 0.12 });
  },
  delete: (c) => {
    swish(c, { dur: 0.18, gain: 0.03, from: 2200, to: 320, q: 0.8 });
    tone(c, { freq: 420, to: 190, dur: 0.14, gain: 0.026 });
  },
};

export function playSound(name) {
  const fn = SOUNDS[name];
  if (!fn) return;
  try {
    const c = audio();
    if (c) fn(c);
  } catch {
    /* som indisponível: segue em silêncio */
  }
}

export const soundSupported = () => Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
