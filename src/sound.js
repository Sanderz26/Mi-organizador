// Efectos de sonido sintetizados (sin archivos externos), sutiles y cortos
export const soundConfig = { on: true, volume: 0.5 };
let ctx;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.18, slideTo } = {}) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const v = gain * soundConfig.volume;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  tap: () => tone(1500, 0, 0.035, { gain: 0.05 }),
  complete: () => { tone(880, 0, 0.12, { gain: 0.14 }); tone(1318.5, 0.08, 0.22, { gain: 0.12 }); },
  xp: () => { tone(1046.5, 0, 0.08, { gain: 0.09, type: 'triangle' }); tone(1568, 0.06, 0.14, { gain: 0.08, type: 'triangle' }); },
  levelup: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.32, { gain: 0.12, type: 'triangle' })); tone(1567.98, 0.38, 0.5, { gain: 0.07 }); },
  fail: () => { tone(330, 0, 0.22, { gain: 0.14, slideTo: 220, type: 'triangle' }); },
  leveldown: () => { tone(392, 0, 0.2, { gain: 0.12, type: 'triangle' }); tone(293.66, 0.16, 0.34, { gain: 0.12, type: 'triangle' }); },
  start: () => { tone(660, 0, 0.08, { gain: 0.1 }); tone(990, 0.07, 0.12, { gain: 0.1 }); },
  stop: () => { tone(990, 0, 0.08, { gain: 0.1 }); tone(660, 0.07, 0.14, { gain: 0.1 }); },
  alarm: () => { for (let i = 0; i < 3; i++) { tone(1046.5, i * 0.28, 0.12, { gain: 0.15 }); tone(1318.5, i * 0.28 + 0.12, 0.12, { gain: 0.13 }); } },
  error: () => tone(220, 0, 0.12, { gain: 0.08, type: 'square' }),
  delete: () => tone(520, 0, 0.12, { gain: 0.08, slideTo: 300 }),
};

export function sound(name) {
  if (!soundConfig.on) return;
  try { SOUNDS[name]?.(); } catch { /* sin audio disponible */ }
}

// Clic suave en cualquier botón
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('button, .nav-item, .row.click, tr.click, .cal .day')) sound('tap');
}, true);
