// Código del puente en Google Apps Script. Se pega en script.google.com y guarda tus datos en tu Google Drive.
export function appsScriptCode(clave) {
  return `/**
 * Organizador · Puente de sincronización con Google Drive
 * Guarda tus datos en la carpeta "Organizador - sincronización" de TU Drive.
 * La clave de abajo es la que protege tus datos: no compartas este código.
 */
const CLAVE = '${clave}';
const CARPETA = 'Organizador - sincronización';

function carpeta_() {
  const it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}
function archivo_(f, nombre) {
  const it = f.getFilesByName(nombre);
  return it.hasNext() ? it.next() : null;
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.k !== CLAVE) return json_({ ok: false, error: 'clave' });
  const f = carpeta_();
  if (p.a === 'archivo') {
    const a = archivo_(f, 'adj-' + p.id);
    if (!a) return json_({ ok: false, error: 'no-existe' });
    return json_({ ok: true, b64: Utilities.base64Encode(a.getBlob().getBytes()), mime: a.getMimeType() });
  }
  if (p.a === 'archivos') {
    const ids = [];
    const it = f.getFiles();
    while (it.hasNext()) { const n = it.next().getName(); if (n.indexOf('adj-') === 0) ids.push(n.slice(4)); }
    return json_({ ok: true, ids: ids });
  }
  const d = archivo_(f, 'datos.json');
  const rev = Number(PropertiesService.getScriptProperties().getProperty('rev') || 0);
  return json_({ ok: true, rev: rev, data: d ? d.getBlob().getDataAsString('UTF-8') : null });
}

function doPost(e) {
  const b = JSON.parse(e.postData.contents);
  if (b.k !== CLAVE) return json_({ ok: false, error: 'clave' });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const f = carpeta_();
    const props = PropertiesService.getScriptProperties();
    if (b.a === 'archivo') {
      const viejo = archivo_(f, 'adj-' + b.id);
      if (viejo) viejo.setTrashed(true);
      const blob = Utilities.newBlob(Utilities.base64Decode(b.b64), b.mime || 'application/octet-stream', 'adj-' + b.id);
      f.createFile(blob).setDescription(b.name || '');
      return json_({ ok: true });
    }
    const rev = Number(props.getProperty('rev') || 0);
    if (Number(b.base) !== rev) return json_({ ok: false, error: 'conflicto', rev: rev });
    const d = archivo_(f, 'datos.json');
    if (d) d.setContent(b.data); else f.createFile('datos.json', b.data, 'application/json');
    props.setProperty('rev', String(rev + 1));
    copiaDiaria_(f, b.data);
    limpiarArchivos_(f, b.data);
    return json_({ ok: true, rev: rev + 1 });
  } finally {
    lock.releaseLock();
  }
}

// Una copia por día de los últimos 10 días, por si algo sale mal
function copiaDiaria_(f, data) {
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nombre = 'copia-' + hoy + '.json';
  if (archivo_(f, nombre)) return;
  f.createFile(nombre, data, 'application/json');
  const copias = [];
  const it = f.getFiles();
  while (it.hasNext()) { const a = it.next(); if (a.getName().indexOf('copia-') === 0) copias.push(a); }
  copias.sort(function (x, y) { return x.getName() < y.getName() ? -1 : 1; });
  while (copias.length > 10) copias.shift().setTrashed(true);
}

// Manda a la papelera los archivos adjuntos que ya borraste en la app
function limpiarArchivos_(f, data) {
  let docs;
  try { docs = JSON.parse(data).docs || {}; } catch (err) { return; }
  const it = f.getFiles();
  while (it.hasNext()) {
    const a = it.next();
    const n = a.getName();
    if (n.indexOf('adj-') === 0 && !docs['files/' + n.slice(4)]) a.setTrashed(true);
  }
}
`;
}
