// Capa de plataforma: Windows (Electron), Android (Capacitor) o navegador (pruebas)
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';

const native = window.native; // expuesto por electron/preload.cjs
export const isWindows = !!native;
export const isAndroid = !native && Capacitor.isNativePlatform();
export const platformName = isWindows ? 'windows' : isAndroid ? 'android' : 'web';

const DATA_FILE = 'organizador-data.json';
const LS_KEY = 'organizador-data';

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// ---------- Datos ----------
export async function readData() {
  if (isWindows) return native.readData();
  if (isAndroid) {
    try {
      const r = await Filesystem.readFile({ path: DATA_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      return r.data;
    } catch { return null; }
  }
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

export async function writeData(text) {
  if (isWindows) return native.writeData(text);
  if (isAndroid) {
    await Filesystem.writeFile({ path: DATA_FILE + '.tmp', data: text, directory: Directory.Data, encoding: Encoding.UTF8 });
    await Filesystem.rename({ from: DATA_FILE + '.tmp', to: DATA_FILE, directory: Directory.Data, toDirectory: Directory.Data });
    return;
  }
  try { localStorage.setItem(LS_KEY, text); } catch { /* sin espacio */ }
}

export function writeDataSync(text) {
  if (isWindows) native.writeDataSync(text);
  else if (!isAndroid) { try { localStorage.setItem(LS_KEY, text); } catch { /* */ } }
}

// ---------- Archivos adjuntos ----------
const webFiles = new Map();

/** Guarda un File y devuelve sus metadatos */
export async function saveAttachment(file, id) {
  const meta = { id, name: file.name || 'archivo', mime: file.type || 'application/octet-stream', size: file.size || 0, added: Date.now() };
  const b64 = await blobToBase64(file);
  if (isWindows) await native.saveFile(id, b64);
  else if (isAndroid) await Filesystem.writeFile({ path: `adjuntos/${id}`, data: b64, directory: Directory.Data, recursive: true });
  else { webFiles.set(id, `data:${meta.mime};base64,${b64}`); try { localStorage.setItem('adj-' + id, webFiles.get(id)); } catch { /* demasiado grande */ } }
  return meta;
}

/** URL para mostrar una imagen adjunta */
export async function attachmentUrl(meta) {
  try {
    if (isWindows) return `data:${meta.mime};base64,${await native.readFile(meta.id)}`;
    if (isAndroid) {
      const { uri } = await Filesystem.getUri({ path: `adjuntos/${meta.id}`, directory: Directory.Data });
      return Capacitor.convertFileSrc(uri);
    }
    return webFiles.get(meta.id) || localStorage.getItem('adj-' + meta.id) || '';
  } catch { return ''; }
}

/** Abre el adjunto con la app del sistema (Windows) o con el menú compartir (Android) */
export async function openAttachment(meta) {
  if (isWindows) return native.openFile(meta.id, meta.name);
  if (isAndroid) {
    const tmp = `compartir/${meta.name.replace(/[\\/:*?"<>|]/g, '_')}`;
    const r = await Filesystem.readFile({ path: `adjuntos/${meta.id}`, directory: Directory.Data });
    await Filesystem.writeFile({ path: tmp, data: r.data, directory: Directory.Cache, recursive: true });
    const { uri } = await Filesystem.getUri({ path: tmp, directory: Directory.Cache });
    return Share.share({ title: meta.name, files: [uri], dialogTitle: 'Abrir o enviar archivo' });
  }
  const url = await attachmentUrl(meta);
  const a = document.createElement('a');
  a.href = url; a.download = meta.name; a.click();
}

export async function deleteAttachment(meta) {
  try {
    if (isWindows) await native.deleteFile(meta.id);
    else if (isAndroid) await Filesystem.deleteFile({ path: `adjuntos/${meta.id}`, directory: Directory.Data });
    else { webFiles.delete(meta.id); localStorage.removeItem('adj-' + meta.id); }
  } catch { /* ya no existe */ }
}

/** Exporta texto como archivo: diálogo Guardar (Windows) o menú compartir (Android: Drive, WhatsApp, correo…) */
export async function exportText(filename, text, title = 'Exportar') {
  if (isWindows) return native.exportFile(filename, text);
  if (isAndroid) {
    await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title, files: [uri], dialogTitle: title });
    return true;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename; a.click();
  return true;
}

/** Comparte un texto corto (por ejemplo, un resumen) */
export async function shareText(title, text) {
  if (isAndroid) return Share.share({ title, text, dialogTitle: title });
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return false; }
}

export function pickFile(accept = '*/*', multiple = false) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}

// ---------- Notificaciones ----------
export async function ensureNotifyPermission() {
  if (isAndroid) {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    try {
      const ex = await LocalNotifications.checkExactNotificationSetting();
      if (ex?.exact_alarm && ex.exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting();
    } catch { /* versiones antiguas de Android */ }
    return p.display === 'granted';
  }
  if (isWindows) return true;
  if ('Notification' in window) return (await Notification.requestPermission()) === 'granted';
  return false;
}

/** Android: reprograma todas las notificaciones locales (llegan aunque la app esté cerrada) */
export async function scheduleAndroid(list) {
  if (!isAndroid) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    const now = Date.now();
    const items = list.filter((r) => r.at > now).slice(0, 200).map((r) => ({
      id: r.nid, title: r.title, body: r.body,
      schedule: { at: new Date(r.at), allowWhileIdle: true },
      smallIcon: 'ic_stat_notify', iconColor: '#1d5c74',
    }));
    if (items.length) await LocalNotifications.schedule({ notifications: items });
  } catch (e) { console.warn('No se pudieron programar notificaciones', e); }
}

/** Windows / navegador: muestra una notificación ya */
export function showNotification(title, body) {
  if (isWindows) return native.notify(title, body);
  if (isAndroid) return LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 1e9), title, body }] });
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
}

export function setAutostart(on) { if (isWindows) native.setAutostart(on); }

export function onAppPause(fn) {
  if (isAndroid) App.addListener('pause', fn);
  window.addEventListener('beforeunload', fn);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') fn(); });
}
export function onBackButton(fn) { if (isAndroid) App.addListener('backButton', fn); }
export function exitApp() { if (isAndroid) App.minimizeApp?.() ?? App.exitApp(); }
