// Sincronización con Google Drive a través del puente de Apps Script del usuario
import { state, localCopy, applyMerged, onLocalChange, commit } from './store.js';
import { merge, sameDocs } from './syncmodel.js';
import { httpJson, attachmentExists, readAttachmentB64, writeAttachmentB64, onAppPause } from './platform.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { driveBackend } from './drive.js';
import { googleSignedIn, googleAccount } from './google.js';

const LS_LAST = 'organizador-ultima-sync';
let status = { state: 'off' };
let running = null;
let pendingAgain = false;
const listeners = new Set();
export const onSyncStatus = (fn) => listeners.add(fn);
export const syncStatus = () => status;
const setStatus = (s) => { status = { ...s, at: s.at || status.at }; listeners.forEach((fn) => fn(status)); drawChip(); };

const scriptConfigured = () => !!(state.settings.syncUrl && state.settings.syncKey);
/** 'google' (botón Conectar con Google), 'script' (puente Apps Script) o '' */
export const syncMode = () => (state.settings.syncMode === 'google' && googleSignedIn() ? 'google' : scriptConfigured() ? 'script' : '');
export const syncConfigured = () => !!syncMode();
export const connectionCode = () => (scriptConfigured() ? `${state.settings.syncUrl}#${state.settings.syncKey}` : '');
export function parseConnectionCode(code) {
  const c = String(code || '').replace(/\s+/g, '');
  // Acepta cuentas personales (/macros/s/…) y de universidad o empresa (/a/macros/dominio/s/…)
  const m = c.match(/(https:\/\/script\.google\.com\/(?:a\/macros\/[^/?#]+|macros)\/s\/[A-Za-z0-9_-]+\/exec)(?:\?[^#]*)?(?:#([A-Za-z0-9_-]{16,}))?/);
  return m ? { url: m[1], key: m[2] || '' } : null;
}

const get = (params) => httpJson('GET', `${state.settings.syncUrl}?k=${encodeURIComponent(state.settings.syncKey)}${params || ''}`);
const post = (body) => httpJson('POST', state.settings.syncUrl, { k: state.settings.syncKey, ...body });

/** Puente Apps Script con la misma interfaz que Drive */
const scriptBackend = {
  async getData() {
    const r = await get('');
    if (!r || r.ok !== true) throw new Error(r?.error === 'clave' ? 'La clave no coincide' : 'Respuesta inesperada del servidor');
    return { rev: r.rev, data: r.data };
  },
  async putData(base, text) {
    const w = await post({ a: 'put', base, data: text });
    if (w?.ok) return { ok: true };
    if (w?.error === 'conflicto') return { ok: false, conflict: true };
    throw new Error('No se pudo guardar en Drive');
  },
  async putFile(f, b64) { const r = await post({ a: 'archivo', id: f.id, name: f.name, mime: f.mime, b64 }); return { ok: !!r?.ok }; },
  async getFile(id) { const r = await get(`&a=archivo&id=${encodeURIComponent(id)}`); return r?.ok ? r.b64 : null; },
};
const backend = () => (syncMode() === 'google' ? driveBackend : scriptBackend);

/** Prueba la conexión: devuelve { ok, empty } */
export async function testConnection(url, key) {
  const r = await httpJson('GET', `${url}?k=${encodeURIComponent(key)}`);
  if (!r || r.ok !== true) throw new Error(r?.error === 'clave' ? 'La clave no coincide con la del código de Apps Script.' : 'El enlace no respondió como se esperaba.');
  return { ok: true, empty: !r.data };
}

async function doSync() {
  if (!syncConfigured()) { setStatus({ state: 'off' }); return; }
  setStatus({ state: 'syncing' });
  try {
    let uploaded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const be = backend();
      const r = await be.getData();
      const remote = r.data ? JSON.parse(r.data) : { docs: {}, meta: {}, del: {} };
      const mine = localCopy();
      let merged = merge(mine, remote);
      // si hubo cambios locales mientras llegaba la respuesta, también entran
      const mine2 = localCopy();
      merged = merge(mine2, merged);
      if (!sameDocs(merged, mine2)) applyMerged(merged);
      if (r.data && sameDocs(merged, remote)) { uploaded = true; break; }
      const w = await be.putData(r.rev, JSON.stringify({ v: 1, ...merged, savedAt: Date.now() }));
      if (w.ok) { uploaded = true; break; }
    }
    if (!uploaded) throw new Error('Otro dispositivo estaba guardando; se reintentará');
    await syncFiles();
    try { localStorage.setItem(LS_LAST, String(Date.now())); } catch { /* */ }
    setStatus({ state: 'ok', at: Date.now() });
  } catch (e) {
    setStatus({ state: 'error', message: String(e?.message || e) });
  }
}

/** Sube los adjuntos nuevos y descarga los que faltan en este dispositivo */
async function syncFiles() {
  // Cada archivo recuerda a qué nube se subió, para poder cambiar de método sin perder adjuntos
  const dest = syncMode() === 'google' ? 'g:' + (googleAccount()?.email || '') : 's:' + state.settings.syncUrl.slice(-16);
  const uploadedTo = (f) => f.cloudAt || (f.cloud && dest.startsWith('s:') ? dest : '');
  let marked = false, got = false;
  for (const f of state.files.slice()) {
    const here = await attachmentExists(f);
    if (here && uploadedTo(f) !== dest) {
      if (f.size > 45 * 1024 * 1024) continue;
      const b64 = await readAttachmentB64(f);
      const r = await backend().putFile(f, b64);
      if (r?.ok) { const cur = state.files.find((x) => x.id === f.id); if (cur) { cur.cloudAt = dest; cur.cloud = true; marked = true; } }
    } else if (!here && uploadedTo(f) === dest) {
      const b64 = await backend().getFile(f.id);
      if (b64) { await writeAttachmentB64(f, b64); got = true; }
    }
  }
  if (marked || got) commit();
}

export function syncNow() {
  if (running) { pendingAgain = true; return running; }
  running = doSync().finally(() => {
    running = null;
    if (pendingAgain) { pendingAgain = false; setTimeout(syncNow, 1500); }
  });
  return running;
}

let changeTimer = null;
export function startSync() {
  onLocalChange(() => {
    if (!syncConfigured()) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(syncNow, 12000);
  });
  setInterval(() => { if (syncConfigured() && document.visibilityState === 'visible') syncNow(); }, 3 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !syncConfigured()) return;
    const last = Number(localStorage.getItem(LS_LAST) || 0);
    if (Date.now() - last > 45000) syncNow();
  });
  onAppPause(() => { if (syncConfigured() && changeTimer) { clearTimeout(changeTimer); changeTimer = null; syncNow(); } });
  if (syncConfigured()) setTimeout(syncNow, 1500);
  else setStatus({ state: 'off' });
}

export function lastSyncText() {
  const s = status;
  if (s.state === 'off') return syncConfigured() ? 'Conectado; sincronizando en un momento…' : 'Sincronización desactivada';
  if (s.state === 'syncing') return 'Sincronizando…';
  if (s.state === 'error') return 'Sin sincronizar: ' + (s.message || 'error');
  const at = s.at || Number(localStorage.getItem(LS_LAST) || 0);
  if (!at) return 'Conectado a Google Drive';
  const min = Math.round((Date.now() - at) / 60000);
  return min < 1 ? 'Sincronizado ahora' : min < 60 ? `Sincronizado hace ${min} min` : `Sincronizado hace ${Math.round(min / 60)} h`;
}

function drawChip() {
  const el = document.getElementById('syncchip');
  if (!el) return;
  if (status.state === 'off') { el.innerHTML = ''; return; }
  const ic = status.state === 'error' ? 'alert-triangle' : status.state === 'syncing' ? 'repeat' : 'circle-check';
  el.innerHTML = `<button class="syncchip ${esc(status.state)}" data-syncnow title="${esc(lastSyncText())}">${icon(ic, 15)}<span>${esc(lastSyncText())}</span></button>`;
  el.querySelector('[data-syncnow]').onclick = () => syncNow();
}
setInterval(drawChip, 30000);
