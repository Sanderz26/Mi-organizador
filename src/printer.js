// Impresora 3D (Klipper + Moonraker, p. ej. Creality SparkX i7) por la red de la casa.
// Estado en vivo, pausar/reanudar/cancelar, aviso al terminar e historial con costo real.
import { state, commit, upsert, find } from './store.js';
import { httpRequest, showNotification, isAndroid } from './platform.js';
import { sound } from './sound.js';
import { toast, toKey } from './util.js';

const PORT = 7125;
const LS = 'organizador-impresora';
export const printerIp = () => String(state.settings.printerIp || '').trim();
const base = (ip = printerIp()) => `http://${ip}:${PORT}`;

/** Acepta "192.168.1.10", "http://192.168.1.10:7125/..." o "impresora.local" */
export function normIp(v) {
  const s = String(v || '').trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  return /^[a-z0-9.-]+$/i.test(s) ? s : '';
}

async function mr(path, { method = 'GET', ip, timeout = 6000 } = {}) {
  let r;
  try { r = await httpRequest({ method, url: base(ip) + path, timeout }); }
  catch { throw new Error('No encuentro la impresora en la red. Revisa que esté prendida y en el mismo wifi.'); }
  if (r.status === 404) throw Object.assign(new Error('La impresora no tiene esta función.'), { code: 404 });
  if (r.status !== 200) throw new Error('La impresora respondió con un error (' + r.status + ').');
  try { return JSON.parse(r.text).result; } catch { throw new Error('La respuesta de la impresora no se entiende.'); }
}

/** Prueba una IP: devuelve el nombre de la máquina si responde */
export async function testPrinter(ip) {
  const info = await mr('/printer/info', { ip, timeout: 5000 });
  return info?.hostname || 'Impresora';
}

// ---------- Estado en vivo ----------
let live = { state: 'off' }; // off | offline | ok
const listeners = new Set();
export const onPrinter = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const printerLive = () => live;
const emit = (s) => { live = s; listeners.forEach((fn) => { try { fn(s); } catch { /* */ } }); };

const metaCache = new Map();
async function fileMeta(file) {
  if (!file) return null;
  if (metaCache.has(file)) return metaCache.get(file);
  let m = null;
  try { m = await mr('/server/files/metadata?filename=' + encodeURIComponent(file)); } catch { /* sin datos del laminador */ }
  metaCache.set(file, m);
  return m;
}

/** Gramos por milímetro de filamento: del laminador si lo trae; si no, PLA de 1,75 mm */
const gPerMm = (meta) => (meta?.filament_weight_total && meta?.filament_total ? meta.filament_weight_total / meta.filament_total : 0.00298);
export const prettyFile = (f) => String(f || 'Impresión').split('/').pop().replace(/\.(gcode|g|gco|3mf)$/i, '').replace(/[_]+/g, ' ').trim();

const memo = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const setMemo = (p) => { try { localStorage.setItem(LS, JSON.stringify({ ...memo(), ...p })); } catch { /* */ } };

let polling = null;
export async function pollPrinter() {
  if (!printerIp()) { emit({ state: 'off' }); return live; }
  if (polling) return polling;
  polling = (async () => {
    try {
      const q = await mr('/printer/objects/query?print_stats&virtual_sdcard&display_status&extruder&heater_bed');
      const s = q.status || {};
      const ps = s.print_stats || {};
      const file = ps.filename || '';
      const active = ps.state === 'printing' || ps.state === 'paused';
      const meta = active || ps.state === 'complete' ? await fileMeta(file) : null;
      const progress = Math.max(0, Math.min(1, Number(s.display_status?.progress || s.virtual_sdcard?.progress || 0)));
      const done = Number(ps.print_duration || 0);
      let left = null;
      if (active) {
        if (meta?.estimated_time) left = Math.max(0, meta.estimated_time - done);
        if (progress > 0.03 && (left === null || progress > 0.15)) left = Math.max(0, (done / progress) * (1 - progress)); // ya con avance real, es más confiable
      }
      const snap = {
        state: 'ok', at: Date.now(), ps: ps.state || 'standby', file, name: prettyFile(file), progress, printSecs: done, totalSecs: Number(ps.total_duration || 0),
        left, eta: left !== null && ps.state === 'printing' ? Date.now() + left * 1000 : null,
        layer: ps.info?.current_layer ?? null, layers: ps.info?.total_layer ?? null,
        ext: s.extruder?.temperature, extT: s.extruder?.target, bed: s.heater_bed?.temperature, bedT: s.heater_bed?.target,
        mm: Number(ps.filament_used || 0), grams: Number(ps.filament_used || 0) * gPerMm(meta), totalGrams: meta?.filament_weight_total || null,
        message: ps.message || '',
      };
      transitions(snap);
      emit(snap);
    } catch (e) {
      emit({ state: 'offline', message: e.message, at: Date.now() });
    } finally { polling = null; }
    return live;
  })();
  return polling;
}

const ACTIVE = new Set(['printing', 'paused']);
function transitions(snap) {
  const m = memo();
  const was = m.ps, wasFile = m.file;
  if (ACTIVE.has(was) && !ACTIVE.has(snap.ps)) {
    const name = prettyFile(wasFile || snap.file);
    if (snap.ps === 'complete') {
      showNotification('Impresión terminada', `${name} está lista.`);
      toast(`${name} terminó de imprimirse.`, { title: 'Impresión terminada', icon: 'check', ms: 7000 });
      sound('complete');
    } else if (snap.ps === 'error') {
      showNotification('La impresión falló', `${name}: ${snap.message || 'revisa la impresora'}`);
      toast(snap.message || 'Revisa la impresora.', { title: 'La impresión falló', icon: 'alert-triangle', ms: 8000 });
      sound('error');
    }
    // Se registra en el historial (del de la impresora si existe; si no, con lo que se vio aquí)
    importHistory(true).then((ok) => { if (!ok && ['complete', 'cancelled', 'error'].includes(snap.ps)) logLocal(snap, m); });
  }
  setMemo({ ps: snap.ps, file: snap.file, printSecs: snap.printSecs, mm: snap.mm, grams: snap.grams });
  // Android: aviso programado para la hora estimada de fin (llega aunque cierres la app)
  const eta = snap.ps === 'printing' && snap.eta ? snap.eta : null;
  if (Math.abs((eta || 0) - (m.eta || 0)) > 3 * 60000 || (!eta && m.eta)) { setMemo({ eta, etaName: snap.name }); if (isAndroid) import('./notify.js').then((n) => n.refreshReminders()); }
}

/** Recordatorio de fin de impresión para el programador de Android */
export function printerReminders() {
  const m = memo();
  if (!m.eta || m.eta < Date.now()) return [];
  return [{ nid: 990001, at: m.eta, title: 'Tu impresión debería estar lista', body: `${m.etaName || 'La impresión'} debería terminar más o menos ahora.` }];
}

function logLocal(snap, m) {
  const end = Date.now();
  const secs = Number(m.printSecs || snap.printSecs || 0);
  if (secs < 60) return;
  const id = 'loc-' + Math.round((end - secs * 1000) / 300000); // mismo id en PC y tableta para la misma impresión
  if (find('prints', id) || state._sync?.del?.['prints/' + id]) return;
  upsert('prints', { id, file: m.file || snap.file, name: prettyFile(m.file || snap.file), date: toKey(new Date(end)), endAt: end, startAt: end - secs * 1000, seconds: Math.round(secs), mm: Math.round(m.mm || snap.mm || 0), grams: Math.round((m.grams || snap.grams || 0) * 10) / 10, status: snap.ps === 'complete' ? 'completed' : snap.ps === 'error' ? 'error' : 'cancelled', saleId: '' });
  commit();
}

const STATUS_MAP = { completed: 'completed', cancelled: 'cancelled', error: 'error', klippy_shutdown: 'error', klippy_disconnect: 'error', server_exit: 'error', interrupted: 'error' };
let lastHistory = 0;
/** Trae el historial de trabajos de la impresora. Devuelve false si la impresora no lo tiene. */
export async function importHistory(force = false) {
  if (!printerIp()) return false;
  if (!force && Date.now() - lastHistory < 5 * 60000) return true;
  lastHistory = Date.now();
  let jobs;
  try { jobs = (await mr('/server/history/list?limit=40&order=desc')).jobs || []; }
  catch (e) { if (e.code === 404) setMemo({ noHistory: true }); return false; }
  const since = Date.now() - 120 * 86400000;
  let added = 0;
  for (const j of jobs) {
    const st = STATUS_MAP[j.status];
    if (!st || !j.end_time || j.end_time * 1000 < since || Number(j.print_duration || 0) < 60) continue;
    const id = 'mr-' + j.job_id;
    if (find('prints', id) || state._sync?.del?.['prints/' + id]) continue;
    const meta = j.metadata || {};
    const g = Number(j.filament_used || 0) * gPerMm(meta);
    upsert('prints', { id, file: j.filename, name: prettyFile(j.filename), date: toKey(new Date(j.end_time * 1000)), startAt: Math.round(j.start_time * 1000), endAt: Math.round(j.end_time * 1000), seconds: Math.round(j.print_duration), mm: Math.round(j.filament_used || 0), grams: Math.round(g * 10) / 10, status: st, saleId: '' });
    added++;
  }
  if (added) commit();
  return true;
}

// ---------- Controles ----------
export async function printerAction(kind) {
  const path = { pause: '/printer/print/pause', resume: '/printer/print/resume', cancel: '/printer/print/cancel' }[kind];
  await mr(path, { method: 'POST', timeout: 10000 });
  setTimeout(pollPrinter, 1500);
}

// ---------- Costos ----------
export function printCost(p) {
  const s = state.settings;
  const mat = ((Number(p.grams) || 0) / 1000) * (Number(s.filamentCostKg) || 0);
  const energy = ((Number(p.seconds) || 0) / 3600) * ((Number(s.printerWatts) || 0) / 1000) * (Number(s.kwhCost) || 0);
  return { mat, energy, total: mat + energy };
}

/** Recalcula gramos y horas de un pedido con las impresiones asociadas */
export function syncSaleFromPrints(saleId) {
  const sale = find('sales', saleId);
  if (!sale) return null;
  const ps = state.prints.filter((p) => p.saleId === saleId && !p.trashed);
  if (!ps.length) return sale;
  sale.grams = Math.round(ps.reduce((a, p) => a + (Number(p.grams) || 0), 0));
  sale.hours = Math.round((ps.reduce((a, p) => a + (Number(p.seconds) || 0), 0) / 3600) * 10) / 10;
  return sale;
}

// ---------- Para el asistente ----------
export function printerContext() {
  if (!printerIp()) return '';
  const L = [];
  const s = live;
  if (s.state === 'ok') {
    const st = { printing: 'imprimiendo', paused: 'en pausa', complete: 'terminó la última impresión', cancelled: 'la última impresión se canceló', error: 'con error', standby: 'lista, sin imprimir' }[s.ps] || s.ps;
    L.push(`Impresora 3D (Creality, IP ${printerIp()}): ${st}${s.file && ACTIVE.has(s.ps) ? `. Archivo: ${s.name}, avance ${Math.round(s.progress * 100)}%, lleva ${Math.round(s.printSecs / 60)} min${s.left !== null ? `, faltan unos ${Math.round(s.left / 60)} min (termina hacia las ${new Date(s.eta || Date.now() + s.left * 1000).toTimeString().slice(0, 5)})` : ''}${s.layers ? `, capa ${s.layer} de ${s.layers}` : ''}` : ''}. Boquilla ${Math.round(s.ext || 0)}/${Math.round(s.extT || 0)} °C, cama ${Math.round(s.bed || 0)}/${Math.round(s.bedT || 0)} °C.${s.message ? ' Mensaje: ' + s.message : ''}`);
  } else if (s.state === 'offline') L.push('Impresora 3D: no responde (apagada o fuera del wifi).');
  const recent = state.prints.filter((p) => !p.trashed).sort((a, b) => (b.endAt || 0) - (a.endAt || 0)).slice(0, 5);
  if (recent.length) L.push('Últimas impresiones: ' + recent.map((p) => `${p.date} ${p.name} (${Math.round(p.seconds / 60)} min, ${p.grams} g, ${p.status === 'completed' ? 'ok' : p.status})`).join('; ') + '.');
  return L.join('\n');
}

// ---------- Revisión en segundo plano ----------
let loop = null;
/** Impresiones en la papelera hace más de 30 días se borran solas (solo en la app) */
export function purgeTrash() {
  const old = state.prints.filter((p) => p.trashed && Date.now() - p.trashed > 30 * 86400000);
  if (!old.length) return;
  state.prints = state.prints.filter((p) => !old.includes(p));
  commit();
}

export function startPrinterLoop() {
  if (loop) return;
  setTimeout(purgeTrash, 8000);
  const tick = () => { if (!printerIp()) return; if (isAndroid && document.visibilityState !== 'visible') return; pollPrinter().then(() => importHistory()); };
  setTimeout(tick, 5000);
  // Más seguido mientras imprime, para avisar a tiempo
  loop = setInterval(() => { const fast = ACTIVE.has(live.ps); if (fast || Date.now() - (live.at || 0) > 55000) tick(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
}
