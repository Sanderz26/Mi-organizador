// Alarmas: para levantarse o para lo que sea. Suenan en la tableta (aunque la app esté cerrada)
// y/o en el PC (con la app abierta o en la bandeja).
import { state, commit, onChange, find } from './store.js';
import { isAndroid } from './platform.js';
import { AriesNative } from './wakeword.js';
import { icon } from './icons.js';
import { esc, todayKey, toKey, parseKey, DAYS } from './util.js';
import { agendaFor } from './agenda.js';
import { speak, stopSpeaking } from './voice.js';
import { alarmMessage } from './alarmtalk.js';
import { attachmentUrl } from './platform.js';

export const DAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const BUILTIN_TONES = [['suave', 'Suave (marimba)'], ['amanecer', 'Amanecer (campanas)'], ['clasica', 'Clásica (bip bip)'], ['digital', 'Digital']];
export const DEFAULT_TONE = { kind: 'builtin', id: 'suave' };
export const myTones = () => state.files.filter((f) => f.owner?.type === 'tono');
export function toneName(t) {
  if (!t || t.kind === 'default') return 'Tono de alarma de Android';
  if (t.kind === 'builtin') return (BUILTIN_TONES.find(([k]) => k === t.id) || [, 'Suave'])[1];
  if (t.kind === 'file') return `Mi tono: ${t.name || 'archivo'}`;
  return t.name || 'Tono de Android';
}
export const thisDevice = () => (isAndroid ? 'tablet' : 'pc');
export const ringsHere = (a) => a.where === 'ambos' || (a.where || 'tablet') === thisDevice();

/** Próxima vez que suena (ms) o 0 si ya no va a sonar */
export function nextTime(a, from = Date.now()) {
  if (!a?.time) return 0;
  const [h, m] = a.time.split(':').map(Number);
  const days = a.days || [];
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (!days.length) {
    if (a.date) { const t = parseKey(a.date); t.setHours(h, m, 0, 0); return t.getTime() > from ? t.getTime() : 0; }
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  for (let i = 0; i < 8; i++) {
    if (days.includes(d.getDay()) && d.getTime() > from) return d.getTime();
    d.setDate(d.getDate() + 1);
  }
  return 0;
}

/** Fecha de la próxima vez para una alarma de una sola vez */
export function oneOffDate(time, from = Date.now()) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return toKey(d);
}

export function repeatText(a) {
  const ds = (a.days || []).slice().sort();
  if (!ds.length) return a.date ? (a.date === todayKey() ? 'Hoy' : a.date === toKey(new Date(Date.now() + 86400000)) ? 'Mañana' : `Una vez · ${a.date}`) : 'Una vez';
  if (ds.length === 7) return 'Todos los días';
  if (ds.join() === '1,2,3,4,5') return 'Lunes a viernes';
  if (ds.join() === '0,6') return 'Fines de semana';
  return ds.map((d) => DAYS[d].slice(0, 3)).join(', ');
}

export function untilText(ms) {
  const min = Math.max(1, Math.round((ms - Date.now()) / 60000));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `en ${h} h${m ? ` ${m} min` : ''}` : `en ${m} min`;
}

/** Resumen del día para decirlo al apagar la alarma (sin IA, no gasta nada) */
export function daySummary() {
  const now = new Date();
  const h = now.getHours();
  const hi = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const name = state.settings.name ? `, ${state.settings.name.split(' ')[0]}` : '';
  const hora = now.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  const items = agendaFor(todayKey()).filter((x) => x.kind !== 'holiday').sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const hol = agendaFor(todayKey()).find((x) => x.kind === 'holiday');
  const parts = [`${hi}${name}. Son las ${hora.replace(/\.$/, '')}.`];
  if (hol) parts.push(`Hoy es festivo: ${hol.title}.`);
  if (items.length) {
    const fmt = (x) => `${x.short || x.title}${x.time ? ` a las ${x.time}` : ''}`;
    parts.push(`Hoy tienes ${items.length === 1 ? 'esto' : `${items.length} cosas`}: ${items.slice(0, 6).map(fmt).join(', ')}${items.length > 6 ? ', y más' : ''}.`);
  } else parts.push('Hoy no tienes nada en la agenda.');
  const due = state.tasks.filter((t) => !t.done && t.due && t.due <= todayKey());
  if (due.length) parts.push(`Tienes ${due.length} ${due.length === 1 ? 'tarea pendiente' : 'tareas pendientes'} para hoy${due.some((t) => t.due < todayKey()) ? ' o atrasadas' : ''}.`);
  return parts.join(' ');
}

/** Lo que necesita Android para programar y hacer sonar una alarma */
export const nativeAlarm = (a) => ({ id: a.id, time: a.time, days: a.days || [], date: a.days?.length ? '' : a.date || '', label: a.label || '', enabled: a.enabled !== false, snooze: Number(a.snooze) || 10, volume: a.volume ?? 80, ramp: a.ramp !== false, vibrate: a.vibrate !== false, tone: a.tone || DEFAULT_TONE });

// ---------- Sincronización con la tableta (las programa Android) ----------
let lastSig = '';
export function syncNative(force = false) {
  if (!AriesNative) return;
  const list = state.alarms.filter((a) => ringsHere(a)).map((a) => nativeAlarm(a));
  const sig = JSON.stringify(list);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  AriesNative.syncAlarms({ alarms: list }).catch(() => {});
}

/** Las de una sola vez que ya pasaron quedan apagadas */
function retireOld() {
  let changed = false;
  for (const a of state.alarms) {
    if (a.enabled !== false && !(a.days || []).length && a.date && !nextTime(a) && !snoozes[a.id]) { a.enabled = false; changed = true; }
  }
  if (changed) commit();
}

// ---------- Sonando ----------
let ringing = null; // { a, el, stopSound, opts }
const snoozes = {}; // PC: id → hora a la que vuelve a sonar

async function toneSrc(t) {
  if (t?.kind === 'file') { const f = state.files.find((x) => x.id === t.fileId); const u = f ? await attachmentUrl(f) : ''; if (u) return u; }
  const id = t?.kind === 'builtin' ? t.id : 'suave';
  return `tonos/${(BUILTIN_TONES.find(([k]) => k === id) || ['suave'])[0]}.wav`;
}

/** PC: suena el tono elegido en bucle, con su volumen y subiendo poco a poco (en la tableta suena Android) */
function startLoopSound(a, { preview = false } = {}) {
  if (isAndroid) return () => {};
  let alive = true, au = null, ramp = 0;
  const target = Math.max(0.05, Math.min(1, (a.volume ?? 80) / 100));
  toneSrc(a.tone || DEFAULT_TONE).then((src) => {
    if (!alive) return;
    au = new Audio(src);
    au.loop = true;
    const ramps = !preview && a.ramp !== false;
    au.volume = ramps ? target * 0.12 : target;
    au.play().catch(() => {});
    if (ramps) ramp = setInterval(() => { if (!au) return; au.volume = Math.min(target, au.volume + target * 0.03); if (au.volume >= target) clearInterval(ramp); }, 1000);
  });
  return () => { alive = false; clearInterval(ramp); if (au) { au.pause(); au.src = ''; au = null; } };
}

let previewStop = null;
/** Escuchar el tono unos segundos (desde el formulario) */
export function previewTone(a) {
  previewStop?.();
  if (isAndroid) { AriesNative?.previewTone({ alarm: nativeAlarm({ ...a, id: 'prueba', time: '00:00' }) }).catch(() => {}); previewStop = () => AriesNative?.stopPreview().catch(() => {}); return; }
  const stop = startLoopSound(a, { preview: true });
  const t = setTimeout(stop, 6000);
  previewStop = () => { clearTimeout(t); stop(); };
}
export const stopPreview = () => { previewStop?.(); previewStop = null; };

export function showRinging(a, opts = {}) {
  if (!a) return;
  if (ringing?.a.id === a.id) { ringing.opts = { ...ringing.opts, ...opts }; return; }
  if (ringing) closeRinging(false);
  window.native?.showWindow?.();
  const el = document.createElement('div');
  el.className = 'face-ov alarm-ov';
  const now = new Date();
  el.innerHTML = `
    <div class="face-mid">
      <div class="alarm-ic">${icon('alarm', 44)}</div>
      <div class="alarm-time num">${esc(now.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }))}</div>
      <div class="alarm-label">${esc(a.label || 'Alarma')}</div>
      <div class="face-reply" data-asum></div>
    </div>
    <div class="alarm-btns">
      <button class="btn lg" data-asnooze>${icon('zzz', 20)} Posponer ${Number(a.snooze) || 10} min</button>
      <button class="btn primary lg" data-aoff>${icon('alarm-off', 20) || icon('x', 20)} Apagar</button>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('face-on');
  ringing = { a, el, stopSound: startLoopSound(a), opts };
  el.querySelector('[data-aoff]').onclick = () => dismiss();
  el.querySelector('[data-asnooze]').onclick = () => snooze();
  // Si nadie la apaga en 10 minutos, se calla sola (como en Android)
  ringing.auto = setTimeout(() => closeRinging(true), 10 * 60000);
}

function closeRinging(finish = true) {
  if (!ringing) return;
  const r = ringing;
  ringing = null;
  clearTimeout(r.auto);
  r.stopSound();
  r.el.classList.add('closing');
  setTimeout(() => r.el.remove(), 220);
  if (!document.querySelector('.face-ov:not(.closing)')) document.body.classList.remove('face-on');
  if (finish && AriesNative) AriesNative.finish({ background: !!r.opts.launched }).catch(() => {});
}

function dismiss() {
  if (!ringing) return;
  const r = ringing;
  AriesNative?.stopAlarm({ id: r.a.id }).catch(() => {});
  r.stopSound();
  r.stopSound = () => {};
  delete snoozes[r.a.id];
  r.dismissed = true;
  if (!(r.a.days || []).length) { const a = find('alarms', r.a.id); if (a) { a.enabled = false; commit(); } }
  const text = alarmMessage(r.a);
  if (text) {
    r.el.querySelector('[data-asum]').textContent = text;
    r.el.querySelector('.alarm-btns').innerHTML = `<button class="btn lg" data-aclose>${icon('check', 18)} Listo</button>`;
    r.el.querySelector('[data-aclose]').onclick = () => { stopSpeaking(); closeRinging(true); };
    speak(text, () => setTimeout(() => { if (ringing === r) closeRinging(true); }, 15000));
  } else closeRinging(true);
}

function snooze() {
  if (!ringing) return;
  const r = ringing;
  const min = Number(r.a.snooze) || 10;
  if (AriesNative) AriesNative.snoozeAlarm({ id: r.a.id, min }).catch(() => {});
  else snoozes[r.a.id] = Date.now() + min * 60000;
  closeRinging(true);
}

// ---------- Arranque ----------
let started = false;
export function startAlarms() {
  if (started) return;
  started = true;
  retireOld();
  if (AriesNative) {
    AriesNative.addListener('alarm', (d) => { const a = find('alarms', d.id) || { id: d.id, label: 'Alarma', time: '' }; showRinging(a, { launched: d.launched, locked: d.locked }); });
    AriesNative.addListener('alarmStopped', (d) => { if (ringing?.a.id === d.id && !ringing.dismissed) closeRinging(true); });
    syncNative(true);
    onChange(() => syncNative());
    return;
  }
  // PC: revisa cada 10 s (la app sigue corriendo en la bandeja)
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    for (const a of state.alarms) {
      if (a.enabled === false || !ringsHere(a)) continue;
      const t = nextTime(a, last - 1);
      if (t && t <= now && now - t < 5 * 60000) showRinging(a);
    }
    for (const [id, t] of Object.entries(snoozes)) if (t <= now) { delete snoozes[id]; showRinging(find('alarms', id)); }
    last = now;
    retireOld();
  }, 10000);
}
