// Activación por voz con la palabra "Aries".
// La detección es 100 % local (modelo Vosk en español): el audio no sale del dispositivo
// hasta que se reconoce la palabra; ahí empieza el dictado normal del asistente.
import { registerPlugin } from '@capacitor/core';
import { isWindows, isAndroid } from './platform.js';

// En la tableta, "Aries" lo escucha un servicio nativo de Android (funciona con la app cerrada y la pantalla apagada)
export const AriesNative = isAndroid ? registerPlugin('Aries') : null;
let nativeBound = false;

const LS = 'organizador-aries';
const MODEL_URL = 'https://raw.githubusercontent.com/ccoreilly/vosk-browser/gh-pages/models/vosk-model-small-es-0.3.tar.gz';
const DB = 'organizador-voz', STORE = 'modelos', KEY = 'vosk-es-0.3';

const WDEF = { on: false, sens: 0.8, mode: 'siempre', from: '07:00', to: '23:00' };
export function wakePrefs() { try { return { ...WDEF, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { ...WDEF }; } }
export function setWakePrefs(p) {
  try { localStorage.setItem(LS, JSON.stringify({ ...wakePrefs(), ...p })); } catch { /* */ }
  if (AriesNative && wakePrefs().on && ('sens' in p || 'mode' in p || 'from' in p || 'to' in p)) { const w = wakePrefs(); AriesNative.configure({ sens: w.sens, mode: w.mode, from: w.from, to: w.to }).catch(() => {}); }
}

let status = { state: 'off' }; // off | downloading | loading | listening | paused | error
const listeners = new Set();
export const onWakeStatus = (fn) => listeners.add(fn);
export const wakeStatus = () => status;
const set = (s) => { status = s; listeners.forEach((fn) => fn(s)); };

// ---------- Modelo guardado en el dispositivo (IndexedDB) ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet() { const db = await idb(); return new Promise((res) => { const t = db.transaction(STORE).objectStore(STORE).get(KEY); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); }
async function idbPut(blob) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(blob, KEY); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
export async function deleteWakeModel() { const db = await idb(); return new Promise((res) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(KEY); t.oncomplete = res; t.onerror = res; }); }

async function getModelBlob() {
  const cached = await idbGet();
  if (cached && cached.size > 1e6) return cached;
  set({ state: 'downloading', pct: 0 });
  const r = await fetch(MODEL_URL);
  if (!r.ok || !r.body) throw new Error('No se pudo descargar el modelo de voz (' + r.status + ').');
  const total = Number(r.headers.get('content-length')) || 34455485;
  const reader = r.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    set({ state: 'downloading', pct: Math.min(99, Math.round((got / total) * 100)) });
  }
  const blob = new Blob(parts, { type: 'application/gzip' });
  await idbPut(blob);
  return blob;
}

// ---------- Escucha continua ----------
let model = null, stream = null, ctx = null, proc = null, rec = null;
let onWake = null;
let lastWake = 0;
let wantRunning = false;

async function ensureModel() {
  if (model) return model;
  const blob = await getModelBlob();
  set({ state: 'loading' });
  const Vosk = await import('vosk-browser');
  const url = URL.createObjectURL(blob);
  model = await (Vosk.createModel || Vosk.default.createModel)(url);
  return model;
}

async function startMic() {
  if (stream) return;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
  catch { throw new Error('No hay permiso para usar el micrófono.'); }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  try { await ctx.resume(); } catch { /* */ }
  rec = new model.KaldiRecognizer(ctx.sampleRate, JSON.stringify(['aries', '[unk]']));
  rec.setWords(true);
  rec.on('result', (m) => {
    const words = m?.result?.result || [];
    const hit = words.find((w) => w.word === 'aries' && (w.conf ?? 1) >= wakePrefs().sens);
    if (hit && Date.now() - lastWake > 3000) { lastWake = Date.now(); onWake?.(); }
  });
  const src = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => { try { rec.acceptWaveform(e.inputBuffer); } catch { /* */ } };
  src.connect(proc);
  proc.connect(ctx.destination);
  set({ state: 'listening' });
}

function stopMic(next = 'paused') {
  try { proc?.disconnect(); } catch { /* */ }
  try { rec?.remove?.(); } catch { /* */ }
  stream?.getTracks().forEach((t) => t.stop());
  const closing = ctx?.close().catch(() => {}) || Promise.resolve();
  stream = ctx = proc = rec = null;
  set({ state: next });
  return closing;
}

function bindNative() {
  if (nativeBound) return;
  nativeBound = true;
  AriesNative.addListener('wake', (d) => onWake?.(d || {}));
  AriesNative.addListener('status', (s) => set({ state: s.state, pct: s.pct, message: s.reason }));
}

/** Enciende la escucha (descarga el modelo la primera vez) */
export async function startWake(handler) {
  if (handler) onWake = handler;
  wantRunning = true;
  if (AriesNative) {
    bindNative();
    const w = wakePrefs();
    try {
      const st = await AriesNative.start({ sens: w.sens, mode: w.mode, from: w.from, to: w.to });
      set({ state: st.state === 'off' ? 'loading' : st.state, pct: st.pct, message: st.reason });
      deleteWakeModel().catch(() => {}); // el modelo de la versión web ya no se usa en la tableta
    } catch (e) { set({ state: 'error', message: e.message || 'No se pudo activar' }); }
    return;
  }
  try {
    await ensureModel();
    if (!wantRunning) return;
    if (isAndroid && document.visibilityState !== 'visible') { set({ state: 'paused' }); return; }
    await startMic();
  } catch (e) {
    set({ state: 'error', message: e.message || 'No se pudo activar' });
  }
}
export function stopWake() { wantRunning = false; if (AriesNative) { AriesNative.stop().catch(() => {}); set({ state: 'off' }); return; } stopMic('off'); }
/** Libera el micrófono mientras se dicta o se habla */
export async function pauseWake() {
  if (AriesNative) {
    if (!wakePrefs().on) return;
    await AriesNative.hold().catch(() => {});
    await new Promise((r) => setTimeout(r, 450)); // que Android suelte el micrófono
    return;
  }
  if (!stream) return;
  await stopMic('paused');
  // En Android el micrófono tarda un momento en quedar libre para el dictado del sistema
  if (isAndroid) await new Promise((r) => setTimeout(r, 600));
}
export function resumeWake() { if (AriesNative) { if (wakePrefs().on) AriesNative.release().catch(() => {}); return; } if (wantRunning && model && !stream && (!isAndroid || document.visibilityState === 'visible')) startMic().catch((e) => set({ state: 'error', message: e.message })); }

// Navegador: solo con la app en pantalla (en Android lo maneja el servicio nativo)
document.addEventListener('visibilitychange', () => {
  if (!wantRunning || !isAndroid || AriesNative) return;
  if (document.visibilityState === 'visible') resumeWake(); else pauseWake();
});

export const wakeSupportedHere = () => !!AriesNative || !!(navigator.mediaDevices?.getUserMedia && window.indexedDB && (window.AudioContext || window.webkitAudioContext));
export const wakeWhereNote = () => (isWindows ? 'En el PC funciona con la app abierta, minimizada o en la bandeja.' : isAndroid ? 'En la tableta escucha aunque la app esté cerrada o la pantalla apagada; Android muestra un aviso fijo mientras tanto.' : '');

// ---------- Permisos y estado del servicio nativo (tableta) ----------
export const nativePermissions = () => (AriesNative ? AriesNative.permissions() : Promise.resolve(null));
export const openNativeSetting = (which) => AriesNative?.openSetting({ which });
