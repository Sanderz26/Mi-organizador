// Copia en Google Drive con la API oficial (carpeta "Organizador" que crea la propia app)
import { googleToken, googleAccount } from './google.js';
import { httpRequest } from './platform.js';
import { toKey } from './util.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'Organizador';

async function call(method, url, { body = null, headers = {}, binary = false } = {}) {
  const token = await googleToken();
  const r = await httpRequest({ method, url, headers: { Authorization: 'Bearer ' + token, ...headers }, body, binary });
  if (r.status === 401) throw new Error('Google rechazó el acceso; vuelve a conectar tu cuenta.');
  if (r.status === 403) throw new Error('Google Drive no permitió la operación (revisa que la API de Drive esté habilitada).');
  if (r.status >= 400) throw new Error('Error de Google Drive (' + r.status + ')');
  return r;
}
const json = async (method, url, opts) => { const r = await call(method, url, opts); return r.text ? JSON.parse(r.text) : {}; };
const q = (s) => encodeURIComponent(s);
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const folderKey = () => 'organizador-drive-folder-' + (googleAccount()?.email || '');
async function folderId() {
  let id = localStorage.getItem(folderKey());
  if (id) return id;
  const r = await json('GET', `${API}/files?q=${q(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)&spaces=drive`);
  id = r.files?.[0]?.id;
  if (!id) id = (await json('POST', `${API}/files?fields=id`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) })).id;
  localStorage.setItem(folderKey(), id);
  return id;
}
async function findFile(name) {
  const fid = await folderId();
  const r = await json('GET', `${API}/files?q=${q(`name='${esc(name)}' and '${fid}' in parents and trashed=false`)}&fields=files(id,name,modifiedTime)&spaces=drive`);
  return r.files?.[0] || null;
}
async function listFiles(prefix) {
  const fid = await folderId();
  const out = [];
  let page = '';
  do {
    const r = await json('GET', `${API}/files?q=${q(`name contains '${esc(prefix)}' and '${fid}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name)&pageSize=1000&spaces=drive${page ? '&pageToken=' + q(page) : ''}`);
    out.push(...(r.files || []).filter((f) => f.name.startsWith(prefix)));
    page = r.nextPageToken || '';
  } while (page);
  return out;
}
function multipart(meta, contentType, data, base64) {
  const B = 'organizador' + Math.random().toString(36).slice(2);
  const body = `--${B}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${B}\r\nContent-Type: ${contentType}\r\n${base64 ? 'Content-Transfer-Encoding: base64\r\n' : ''}\r\n${data}\r\n--${B}--`;
  return { body, headers: { 'Content-Type': `multipart/related; boundary=${B}` } };
}
const rev = (f) => (f ? f.id + '@' + f.modifiedTime : null);

export const driveBackend = {
  async getData() {
    const f = await findFile('datos.json');
    if (!f) return { rev: null, data: null };
    const r = await call('GET', `${API}/files/${f.id}?alt=media`);
    return { rev: rev(f), data: r.text || null };
  },
  async putData(base, text) {
    const f = await findFile('datos.json');
    if (rev(f) !== base) return { ok: false, conflict: true };
    const create = async () => {
      const m = multipart({ name: 'datos.json', parents: [await folderId()] }, 'application/json; charset=UTF-8', text, false);
      await call('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, m);
    };
    if (!f) await create();
    else {
      try {
        await call('PATCH', `${UPLOAD}/files/${f.id}?uploadType=media`, { headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: text });
      } catch (e) {
        // Si el dispositivo no admite PATCH, se crea el archivo nuevo y se borra el anterior
        if (/Google rechazó|Drive no permitió/.test(e.message)) throw e;
        await create();
        await call('DELETE', `${API}/files/${f.id}`).catch(() => {});
      }
    }
    this.housekeeping(text).catch(() => {});
    return { ok: true };
  },
  async putFile(meta, b64) {
    const old = await findFile('adj-' + meta.id);
    if (old) await call('DELETE', `${API}/files/${old.id}`);
    const m = multipart({ name: 'adj-' + meta.id, description: meta.name, parents: [await folderId()] }, meta.mime || 'application/octet-stream', b64, true);
    await call('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, m);
    return { ok: true };
  },
  async getFile(id) {
    const f = await findFile('adj-' + id);
    if (!f) return null;
    return (await call('GET', `${API}/files/${f.id}?alt=media`, { binary: true })).b64;
  },
  /** Una vez al día: copia de seguridad y limpieza de adjuntos borrados */
  async housekeeping(text) {
    const day = toKey(new Date());
    const k = 'organizador-drive-mant-' + (googleAccount()?.email || '');
    if (localStorage.getItem(k) === day) return;
    localStorage.setItem(k, day);
    const name = `copia-${day}.json`;
    if (!(await findFile(name))) {
      const m = multipart({ name, parents: [await folderId()] }, 'application/json; charset=UTF-8', text, false);
      await call('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`, m);
      const copies = (await listFiles('copia-')).sort((a, b) => a.name.localeCompare(b.name));
      while (copies.length > 10) await call('DELETE', `${API}/files/${copies.shift().id}`);
    }
    let docs = {};
    try { docs = JSON.parse(text).docs || {}; } catch { return; }
    for (const f of await listFiles('adj-')) if (!docs['files/' + f.name.slice(4)]) await call('DELETE', `${API}/files/${f.id}`);
  },
};
