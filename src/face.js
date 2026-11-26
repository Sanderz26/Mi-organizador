// Pantalla de conversación con "Aries": una carita que escucha, piensa y habla.
import { speechLevel } from './voice.js';
import { icon } from './icons.js';
import { esc } from './util.js';

const IDLE_CLOSE = 30000; // se cierra sola tras 30 s sin actividad
let root = null, raf = 0, idleTimer = 0;
let st = 'sleep', micLevel = 0, opts = {};
let blinkAt = 0, followUps = 0;
const requestors = new Set();
/** El asistente se registra aquí para que la carita le pida escuchar */
export const onFaceRequest = (fn) => requestors.add(fn);
const request = (kind) => requestors.forEach((fn) => fn(kind));
export const faceOpen = () => !!root;

const STATUS = {
  sleep: 'Di “Aries” para hablarme',
  listening: 'Te escucho…',
  transcribing: 'Entendiendo…',
  thinking: 'Pensando…',
  speaking: '',
  idle: '¿Algo más? Di “Aries” o toca el micrófono',
  error: '',
};

/** Abre la carita. opts.locked: está encima de la pantalla de bloqueo (Android) */
export function openFace(o = {}) {
  opts = o;
  followUps = 0;
  if (root) { setLocked(); setState('listening'); return; }
  root = document.createElement('div');
  root.className = 'face-ov';
  root.innerHTML = `
    <div class="face-top">
      <button class="btn ghost sm" data-funlock ${opts.locked ? '' : 'hidden'}>${icon('key', 15)} Abrir la app</button>
      <div class="spacer"></div>
      <button class="btn ghost icon" data-fclose aria-label="Cerrar">${icon('x', 20)}</button>
    </div>
    <div class="face-mid">
      <div class="face-wrap"><div class="face-ring"></div>
        <svg viewBox="0 0 200 200" class="face-svg" aria-hidden="true">
          <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--face-a)"/><stop offset="1" stop-color="var(--face-b)"/></linearGradient></defs>
          <rect x="18" y="18" width="164" height="164" rx="52" fill="url(#fg)"/>
          <g data-eyes>
            <rect data-eye="l" x="58" y="70" width="20" height="34" rx="10" fill="var(--face-ink)"/>
            <rect data-eye="r" x="122" y="70" width="20" height="34" rx="10" fill="var(--face-ink)"/>
            <path data-lid="l" d="M56 90 q12 9 24 0" stroke="var(--face-ink)" stroke-width="5" stroke-linecap="round" fill="none"/>
            <path data-lid="r" d="M120 90 q12 9 24 0" stroke="var(--face-ink)" stroke-width="5" stroke-linecap="round" fill="none"/>
          </g>
          <path data-smile d="M84 134 q16 12 32 0" stroke="var(--face-ink)" stroke-width="5" stroke-linecap="round" fill="none"/>
          <ellipse data-mouth cx="100" cy="136" rx="17" ry="3" fill="var(--face-ink)"/>
          <g data-dots fill="var(--face-ink)"><circle cx="150" cy="44" r="4"/><circle cx="162" cy="34" r="5"/><circle cx="176" cy="22" r="6"/></g>
        </svg>
      </div>
      <div class="face-status" data-fstatus></div>
      <div class="face-said" data-fsaid></div>
      <div class="face-reply" data-freply></div>
    </div>
    <div class="face-bottom"><button class="btn primary face-mic" data-fmic aria-label="Hablar">${icon('microphone', 26)}</button></div>`;
  document.body.appendChild(root);
  document.body.classList.add('face-on');
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('fclose' in b.dataset) closeFace();
    else if ('fmic' in b.dataset) { followUps = 0; request('listen'); }
    else if ('funlock' in b.dataset) opts.onUnlock?.();
  });
  setState('listening');
  raf = requestAnimationFrame(frame);
}

function setLocked() { root?.querySelector('[data-funlock]')?.toggleAttribute('hidden', !opts.locked); }
/** Ya se desbloqueó: la carita sigue, pero sin el modo de bloqueo */
export function faceUnlocked() { opts.locked = false; setLocked(); }

export function closeFace() {
  if (!root) return;
  cancelAnimationFrame(raf);
  clearTimeout(idleTimer);
  root.classList.add('closing');
  const r = root;
  root = null;
  document.body.classList.remove('face-on');
  setTimeout(() => r.remove(), 220);
  request('close');
  opts.onClose?.();
}

function setState(s, text) {
  st = s;
  if (!root) return;
  root.dataset.state = s;
  root.querySelector('[data-fstatus]').textContent = s === 'error' ? text || 'Algo salió mal' : STATUS[s] ?? '';
  clearTimeout(idleTimer);
  if (s === 'idle' || s === 'sleep' || s === 'error') idleTimer = setTimeout(closeFace, IDLE_CLOSE);
}

/** Eventos del asistente: listening | transcribing | heard | thinking | speaking | spoke | idle | nothing | error */
export function faceEvent(type, data = {}) {
  if (!root) return;
  const said = root.querySelector('[data-fsaid]'), reply = root.querySelector('[data-freply]');
  switch (type) {
    case 'listening': micLevel = data.level || 0; if (st !== 'listening') setState('listening'); break;
    case 'transcribing': setState('transcribing'); break;
    case 'heard': said.textContent = data.text ? `“${data.text}”` : ''; reply.textContent = ''; break;
    case 'thinking': setState('thinking'); break;
    case 'speaking': reply.innerHTML = esc(data.text || ''); setState('speaking'); break;
    case 'spoke':
      // Sigue la conversación: escucha una vez más (para "confirmo", "sí", etc.)
      if (followUps < 1 || data.pending) { followUps++; setState('listening'); setTimeout(() => request('listen'), 350); }
      else setState('idle');
      break;
    case 'idle': if (data.text) reply.innerHTML = esc(data.text); setState('idle'); break;
    case 'nothing': setState('idle'); break;
    case 'error': setState('error', data.text); break;
  }
}

// ---------- Animación ----------
let mouth = 0, ring = 0, look = 0;
function frame(t) {
  if (!root) return;
  const svg = root.querySelector('.face-svg');
  const speak = st === 'speaking' ? speechLevel() : 0;
  mouth += (speak - mouth) * 0.35;
  ring += ((st === 'listening' ? 0.25 + micLevel * 0.9 : 0) - ring) * 0.2;
  look += ((st === 'thinking' || st === 'transcribing' ? 1 : 0) - look) * 0.08;
  // Parpadeo cada 3–5 s
  if (!blinkAt) blinkAt = t + 2500;
  if (t >= blinkAt + 150) blinkAt = t + 3000 + Math.random() * 2500;
  const blinking = t >= blinkAt && t < blinkAt + 150;
  const asleep = st === 'sleep';
  const eyeH = asleep ? 0 : blinking ? 4 : st === 'listening' ? 38 : 34;
  for (const side of ['l', 'r']) {
    const e = svg.querySelector(`[data-eye="${side}"]`);
    const baseX = side === 'l' ? 58 : 122;
    e.setAttribute('height', eyeH);
    e.setAttribute('y', 87 - eyeH / 2 - look * 6);
    e.setAttribute('x', baseX + look * 7);
    e.style.opacity = eyeH ? 1 : 0;
    svg.querySelector(`[data-lid="${side}"]`).style.opacity = asleep ? 1 : 0;
  }
  const open = st === 'speaking';
  const m = svg.querySelector('[data-mouth]');
  m.setAttribute('ry', 3 + mouth * 15);
  m.setAttribute('rx', 15 + mouth * 5);
  m.style.opacity = open ? 1 : 0;
  svg.querySelector('[data-smile]').style.opacity = open ? 0 : 1;
  svg.querySelector('[data-dots]').style.opacity = st === 'thinking' || st === 'transcribing' ? 0.35 + 0.35 * Math.sin(t / 220) : 0;
  const wrap = root.querySelector('.face-wrap');
  wrap.style.setProperty('--ring', ring.toFixed(3));
  wrap.style.setProperty('--bob', asleep ? Math.sin(t / 900).toFixed(3) : (Math.sin(t / 1400) * 0.4).toFixed(3));
  raf = requestAnimationFrame(frame);
}
