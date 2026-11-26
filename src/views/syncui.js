// Pantallas para conectar la sincronización con Google Drive
import { state, commit } from '../store.js';
import { icon } from '../icons.js';
import { esc, openModal, toast, confirmModal } from '../util.js';
import { appsScriptCode } from '../syncscript.js';
import { testConnection, syncNow, connectionCode, parseConnectionCode, syncConfigured, syncMode, lastSyncText, onSyncStatus } from '../sync.js';
import { googleAvailable, googleSignIn, googleSignOut, googleAccount } from '../google.js';
import { shareText, isAndroid } from '../platform.js';
import { sound } from '../sound.js';

function newKey() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 57]).join('');
}
function pendingKey() {
  let k = '';
  try { k = localStorage.getItem('clave-sync-pendiente') || ''; } catch { /* */ }
  if (!k) { k = newKey(); try { localStorage.setItem('clave-sync-pendiente', k); } catch { /* */ } }
  return k;
}

async function copy(text, okMsg = 'Copiado') {
  try { await navigator.clipboard.writeText(text); toast(okMsg, { icon: 'check' }); sound('complete'); return true; }
  catch { toast('No se pudo copiar; selecciona el texto y cópialo a mano'); return false; }
}

async function connect(url, key, ov, btn) {
  const err = ov.querySelector('[data-err]');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Probando…';
  try {
    await testConnection(url, key);
    state.settings.syncUrl = url;
    state.settings.syncKey = key;
    state.settings.syncMode = 'script';
    try { localStorage.removeItem('clave-sync-pendiente'); } catch { /* */ }
    commit();
    ov.close();
    sound('levelup');
    toast('Tus datos se van a sincronizar con tu Google Drive', { title: 'Conectado', icon: 'circle-check', ms: 4000 });
    await syncNow();
    showCodeDialog(true);
  } catch (e) {
    sound('error');
    err.textContent = e.message || 'No se pudo conectar';
    btn.disabled = false;
    btn.textContent = 'Conectar';
  }
}

/** Asistente para el primer dispositivo: crear el puente en Apps Script */
export function setupDialog() {
  const key = pendingKey();
  const code = appsScriptCode(key);
  const ov = openModal({
    title: 'Conectar con Google Drive',
    wide: true,
    body: `<p class="small muted">Se hace una sola vez. Crea un pequeño programa en tu cuenta de Google que guarda tus datos en tu Drive.</p>
    <ol class="steps">
      <li>Abre <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a> con tu cuenta de Google. Se crea un proyecto nuevo.</li>
      <li>Borra todo lo que aparece en el editor y pega este código:
        <div class="split" style="margin:8px 0"><button class="btn sm primary" data-copycode>${icon('download', 14)} Copiar código</button><span class="small muted">o selecciónalo abajo</span></div>
        <div class="code-box">${esc(code)}</div></li>
      <li>Toca <b>Implementar → Nueva implementación</b>. En el engranaje elige <b>Aplicación web</b>. En <b>Ejecutar como</b> elige <b>Yo</b> y en <b>Quién tiene acceso</b> elige <b>Cualquier persona</b>. Toca <b>Implementar</b>.</li>
      <li>Google te pide permiso: toca <b>Autorizar acceso</b>, elige tu cuenta y, si sale "Google no verificó esta app", toca <b>Configuración avanzada → Ir a … (no seguro)</b> y <b>Permitir</b>. Es seguro: el programa es tuyo.</li>
      <li>Copia la <b>URL de la aplicación web</b> (termina en <code>/exec</code>) y pégala aquí:
        <input type="text" data-url placeholder="https://script.google.com/macros/s/…/exec" style="margin-top:8px"></li>
    </ol>
    <div class="err" data-err></div>`,
    foot: `<button class="btn ghost" data-cancel>Cancelar</button><button class="btn primary" data-go>Conectar</button>`,
  });
  ov.querySelector('[data-copycode]').onclick = () => copy(code, 'Código copiado');
  ov.querySelector('[data-cancel]').onclick = () => ov.close();
  ov.querySelector('[data-go]').onclick = (e) => {
    const p = parseConnectionCode(ov.querySelector('[data-url]').value);
    if (!p) { ov.querySelector('[data-err]').textContent = 'Ese enlace no parece el de la aplicación web. Debe empezar por https://script.google.com/ y terminar en /exec (no uses el enlace del editor ni el ID de implementación).'; sound('error'); return; }
    connect(p.url, p.key || key, ov, e.currentTarget);
  };
}

/** Segundo dispositivo: pegar el código de conexión */
export function codeDialog() {
  const ov = openModal({
    title: 'Conectar con un código',
    body: `<p>En tu otro dispositivo ve a <b>Ajustes → Sincronización → Código para otro dispositivo</b>, cópialo y pégalo aquí.</p>
      <textarea data-code style="min-height:90px" placeholder="https://script.google.com/macros/s/…/exec#…"></textarea>
      <p class="small muted">Lo que ya tengas en este dispositivo se combina con lo que está en tu Drive; no se pierde nada.</p>
      <div class="err" data-err></div>`,
    foot: `<button class="btn ghost" data-cancel>Cancelar</button><button class="btn primary" data-go>Conectar</button>`,
  });
  ov.querySelector('[data-cancel]').onclick = () => ov.close();
  ov.querySelector('[data-go]').onclick = (e) => {
    const p = parseConnectionCode(ov.querySelector('[data-code]').value.replace(/\s+/g, ''));
    if (!p || !p.key) { ov.querySelector('[data-err]').textContent = 'El código no es válido. Debe empezar por https://script.google.com y tener una parte después del #.'; sound('error'); return; }
    connect(p.url, p.key, ov, e.currentTarget);
  };
}

export function showCodeDialog(afterSetup = false) {
  const code = connectionCode();
  const ov = openModal({
    title: afterSetup ? 'Listo. Ahora tu otro dispositivo' : 'Código para otro dispositivo',
    body: `<p>${afterSetup ? 'Este dispositivo ya está sincronizado. ' : ''}En tu otro dispositivo abre <b>Ajustes → Sincronización → Tengo un código</b> y pega este código:</p>
      <div class="code-box" style="white-space:pre-wrap;word-break:break-all">${esc(code)}</div>
      <p class="small muted">Envíatelo por WhatsApp o correo a ti mismo. No lo compartas con nadie más: con él se pueden ver tus datos.</p>`,
    foot: `${isAndroid ? `<button class="btn" data-share>${icon('share', 15)} Compartir</button>` : ''}<button class="btn primary" data-copy>${icon('check', 15)} Copiar código</button>`,
  });
  ov.querySelector('[data-copy]').onclick = () => copy(code, 'Código copiado');
  ov.querySelector('[data-share]')?.addEventListener('click', () => shareText('Código de sincronización', code));
}

export async function connectGoogle(btn) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = 'Abriendo Google…'; }
  try {
    const acc = await googleSignIn();
    state.settings.syncMode = 'google';
    commit();
    sound('levelup');
    toast(`Tus datos se guardan en la carpeta "Organizador" de tu Drive (${acc.email || 'tu cuenta'}).`, { title: 'Conectado con Google', icon: 'circle-check', ms: 5000 });
    await syncNow();
  } catch (e) {
    sound('error');
    openModal({ title: 'No se pudo conectar', body: `<p>${esc(e.message || 'Error desconocido')}</p><p class="small muted">Si se repite, mándale una captura de este mensaje a quien te instaló la app.</p>` });
  } finally {
    if (btn?.isConnected) { btn.disabled = false; btn.innerHTML = label; }
  }
}

export async function disconnect() {
  const google = syncMode() === 'google';
  if (!(await confirmModal('Este dispositivo dejará de sincronizarse. Tus datos se quedan aquí y en tu Drive.', 'Desconectar'))) return;
  if (google) await googleSignOut();
  state.settings.syncMode = '';
  state.settings.syncUrl = '';
  state.settings.syncKey = '';
  commit();
}

const googleBtn = (label = 'Conectar con Google') => `<button class="btn primary sm" data-google><svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg> ${label}</button>`;

export function syncCardHtml() {
  const mode = syncMode();
  const head = `<div class="card-head"><h2>${icon('repeat', 18)} Sincronización con Google Drive</h2>${mode ? '<span class="pill ok">Activa</span>' : ''}</div>`;
  if (!mode) {
    return `<div class="card">${head}
      <p class="small">Mantén tus dispositivos con los mismos datos. Todo se guarda en tu propio Google Drive, incluidos tus archivos.</p>
      <div class="split" style="margin-top:12px">${googleAvailable() ? googleBtn() : ''}
        <details style="flex-basis:100%"><summary class="small muted" style="cursor:pointer;margin-top:8px">${googleAvailable() ? 'Otra forma: con Apps Script (avanzado)' : 'Conectar con Apps Script'}</summary>
          <div class="split" style="margin-top:10px"><button class="btn sm" data-syncsetup>Configurar (primer dispositivo)</button><button class="btn sm" data-synccode>Tengo un código</button></div></details></div></div>`;
  }
  const acc = googleAccount();
  return `<div class="card">${head}
    <p class="small">${mode === 'google' ? `Conectado con <b>${esc(acc?.email || 'tu cuenta de Google')}</b> · carpeta "Organizador" de tu Drive` : 'Conectado con tu puente de Apps Script · carpeta "Organizador - sincronización"'}</p>
    <p class="small" data-syncmsg style="margin-top:4px">${esc(lastSyncText())}</p>
    <p class="small muted" style="margin:6px 0 12px">Se sincroniza al abrir la app, unos segundos después de cada cambio y cada 3 minutos.</p>
    <div class="split"><button class="btn primary sm" data-syncnow2>${icon('repeat', 15)} Sincronizar ahora</button>${mode === 'script' ? `<button class="btn sm" data-synccodeshow>Código para otro dispositivo</button>${googleAvailable() ? googleBtn('Cambiar a Conectar con Google') : ''}` : ''}<button class="btn ghost sm danger" data-syncoff>Desconectar</button></div>
    ${mode === 'script' && googleAvailable() ? '<p class="tiny faint" style="margin-top:8px">Si cambias a Google, haz el cambio en todos tus dispositivos: tus datos pasan a la carpeta "Organizador" sin perder nada.</p>' : ''}</div>`;
}

let liveMsg = null;
onSyncStatus(() => { if (liveMsg?.isConnected) liveMsg.textContent = lastSyncText(); });

export function bindSyncCard(el) {
  liveMsg = el.querySelector('[data-syncmsg]');
  el.querySelector('[data-google]')?.addEventListener('click', (e) => connectGoogle(e.currentTarget));
  el.querySelector('[data-syncsetup]')?.addEventListener('click', setupDialog);
  el.querySelector('[data-synccode]')?.addEventListener('click', codeDialog);
  el.querySelector('[data-synccodeshow]')?.addEventListener('click', () => showCodeDialog(false));
  el.querySelector('[data-syncoff]')?.addEventListener('click', disconnect);
  el.querySelector('[data-syncnow2]')?.addEventListener('click', async () => {
    const m = el.querySelector('[data-syncmsg]');
    if (m) m.textContent = 'Sincronizando…';
    await syncNow();
    if (m?.isConnected) m.textContent = lastSyncText();
  });
}
