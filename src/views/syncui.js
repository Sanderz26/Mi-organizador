// Pantallas para conectar la sincronización con Google Drive
import { state, commit } from '../store.js';
import { icon } from '../icons.js';
import { esc, openModal, toast, confirmModal } from '../util.js';
import { appsScriptCode } from '../syncscript.js';
import { testConnection, syncNow, connectionCode, parseConnectionCode, syncConfigured, lastSyncText } from '../sync.js';
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

export async function disconnect() {
  if (!(await confirmModal('Este dispositivo dejará de sincronizarse. Tus datos se quedan aquí y en tu Drive.', 'Desconectar'))) return;
  state.settings.syncUrl = '';
  state.settings.syncKey = '';
  commit();
}

export function syncCardHtml() {
  if (!syncConfigured()) {
    return `<div class="card"><div class="card-head"><h2>${icon('repeat', 18)} Sincronización con Google Drive</h2></div>
      <p class="small">Mantén el PC y la tableta con los mismos datos. Todo se guarda en tu propio Google Drive, incluidos tus archivos.</p>
      <div class="split" style="margin-top:12px"><button class="btn primary sm" data-syncsetup>Configurar (primer dispositivo)</button><button class="btn sm" data-synccode>Tengo un código</button></div></div>`;
  }
  return `<div class="card"><div class="card-head"><h2>${icon('repeat', 18)} Sincronización con Google Drive</h2><span class="pill ok">Activa</span></div>
    <p class="small" data-syncmsg>${esc(lastSyncText())}</p>
    <p class="small muted" style="margin:6px 0 12px">Se sincroniza al abrir la app, unos segundos después de cada cambio y cada 3 minutos.</p>
    <div class="split"><button class="btn primary sm" data-syncnow2>${icon('repeat', 15)} Sincronizar ahora</button><button class="btn sm" data-synccodeshow>Código para otro dispositivo</button><button class="btn ghost sm danger" data-syncoff>Desconectar</button></div></div>`;
}

export function bindSyncCard(el) {
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
