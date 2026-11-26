// Actualizaciones: Windows se actualiza solo; Android avisa y descarga el APK nuevo
import { Browser } from '@capacitor/browser';
import { isWindows, isAndroid } from './platform.js';
import { icon } from './icons.js';
import { esc, toast } from './util.js';
import { sound } from './sound.js';

const REPO = 'Sanderz26/Mi-organizador';
export const APP_VERSION = __APP_VERSION__;
let status = { state: 'idle' };
let listeners = new Set();
export const onUpdateStatus = (fn) => listeners.add(fn);
const emit = (s) => { status = s; listeners.forEach((fn) => fn(s)); drawBar(); };
export const updateStatus = () => status;

const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};

async function checkAndroid(manual) {
  try {
    emit({ state: 'checking' });
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rel = await r.json();
    const apk = (rel.assets || []).find((a) => a.name.endsWith('.apk'));
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (apk && newer(version, APP_VERSION)) {
      emit({ state: 'available', version, url: apk.browser_download_url, notes: rel.body || '' });
      if (manual) sound('xp');
    } else emit({ state: 'none' });
  } catch (e) {
    emit({ state: 'error', message: String(e.message || e) });
  }
  try { localStorage.setItem('ultima-revision-actualizacion', String(Date.now())); } catch { /* */ }
}

export async function checkForUpdates(manual = false) {
  if (isWindows) {
    const s = await window.native.checkUpdate();
    if (s?.state) emit(s);
    return status;
  }
  if (isAndroid) await checkAndroid(manual);
  else emit({ state: 'dev' });
  return status;
}

export async function installUpdate() {
  if (isWindows && status.state === 'ready') return window.native.installUpdate();
  if (isAndroid && status.url) {
    toast('Cuando termine la descarga, ábrela e instala encima. Tus datos se conservan.', { title: 'Descargando versión ' + status.version, icon: 'download', ms: 6000 });
    return Browser.open({ url: status.url });
  }
}

function drawBar() {
  const el = document.getElementById('updatebar');
  if (!el) return;
  const s = status;
  let html = '';
  if (s.state === 'ready') html = `${icon('download', 18)}<div class="grow"><b>Versión ${esc(s.version)} lista.</b> Se instalará al cerrar la app.</div><button class="btn sm" data-upd>Reiniciar y actualizar</button>`;
  else if (s.state === 'available') html = `${icon('download', 18)}<div class="grow"><b>Hay una versión nueva (${esc(s.version)}).</b> Tus datos se conservan al instalarla.</div><button class="btn sm" data-upd>Descargar</button><button class="btn ghost sm" data-later aria-label="Más tarde">${icon('x', 15)}</button>`;
  el.innerHTML = html ? `<div class="updatebar">${html}</div>` : '';
  el.querySelector('[data-upd]')?.addEventListener('click', installUpdate);
  el.querySelector('[data-later]')?.addEventListener('click', () => { el.innerHTML = ''; });
}

export function startUpdates() {
  if (isWindows) {
    window.native.onUpdate((u) => emit(u));
    window.native.updateStatus().then((u) => u?.state && emit(u));
  } else if (isAndroid) {
    const last = Number(localStorage.getItem('ultima-revision-actualizacion') || 0);
    if (Date.now() - last > 3 * 3600e3) setTimeout(() => checkAndroid(false), 4000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const l = Number(localStorage.getItem('ultima-revision-actualizacion') || 0);
      if (Date.now() - l > 3 * 3600e3) checkAndroid(false);
    });
  }
}
