// Documentos: buscar, abrir y leer (archivos de tus apuntes y carpetas que elijas en el dispositivo).
import { state } from './store.js';
import { isWindows, readAttachmentB64, openAttachment } from './platform.js';
import { Dispositivo } from './launcher.js';
import { norm } from './util.js';

const LS = 'organizador-carpetas'; // PC: carpetas elegidas (cada dispositivo tiene las suyas)
const pcFolders = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };
const savePc = (l) => { try { localStorage.setItem(LS, JSON.stringify(l)); } catch { /* */ } };

export const docsSupported = () => !!Dispositivo || !!(isWindows && window.native?.searchDocs);

export async function listFolders() {
  if (Dispositivo) return ((await Dispositivo.listFolders().catch(() => ({ folders: [] }))).folders || []).map((f) => ({ id: f.uri, name: f.name }));
  return pcFolders().map((p) => ({ id: p, name: p.split(/[\\/]/).filter(Boolean).pop() || p, path: p }));
}

export async function addFolder() {
  if (Dispositivo) return Dispositivo.pickFolder();
  const p = await window.native.pickDocsFolder();
  if (!p) return null;
  const l = pcFolders();
  if (!l.includes(p)) { l.push(p); savePc(l); }
  return { id: p, name: p };
}

export async function removeFolder(id) {
  if (Dispositivo) return Dispositivo.removeFolder({ uri: id });
  savePc(pcFolders().filter((p) => p !== id));
}

/** Busca por nombre en los archivos de la app y en las carpetas elegidas */
export async function searchDocs(query, max = 12) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  const hit = (name) => { const n = norm(name); return words.every((w) => n.includes(w)); };
  const out = [];
  // 1) Adjuntos de tus apuntes
  for (const f of state.files) {
    if (f.owner?.type === 'tono') continue;
    const note = state.notes.find((n) => (n.fileIds || []).includes(f.id));
    if (hit(f.name) || (note && hit(note.title || ''))) out.push({ src: 'app', name: f.name, meta: f, where: note ? `Apunte: ${note.title || 'sin título'}` : 'Apuntes', mime: f.mime, modified: f.added || 0 });
  }
  // 2) Carpetas del dispositivo
  try {
    if (Dispositivo) {
      const r = await Dispositivo.search({ query, max: 20 });
      for (const f of r.files || []) out.push({ src: 'device', name: f.name, uri: f.uri, mime: f.mime, where: f.folder, modified: f.modified, size: f.size });
    } else if (isWindows && window.native?.searchDocs && pcFolders().length) {
      const r = await window.native.searchDocs({ folders: pcFolders(), query, max: 20 });
      for (const f of r || []) out.push({ src: 'device', name: f.name, path: f.path, mime: mimeOf(f.name), where: f.folder, modified: f.modified, size: f.size });
    }
  } catch { /* sin carpetas */ }
  return out.sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, max);
}

function mimeOf(name) {
  const e = (name.split('.').pop() || '').toLowerCase();
  return { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html' }[e] || 'application/octet-stream';
}

export async function openDoc(d) {
  if (d.src === 'app') return openAttachment(d.meta);
  if (Dispositivo) return Dispositivo.openFile({ uri: d.uri, mime: d.mime || mimeOf(d.name) });
  const err = await window.native.openDoc({ path: d.path, folders: pcFolders() });
  if (err) throw new Error(err);
}

async function bytesOf(d) {
  let b64;
  if (d.src === 'app') b64 = await readAttachmentB64(d.meta);
  else if (Dispositivo) b64 = (await Dispositivo.readFile({ uri: d.uri })).b64;
  else { const r = await window.native.readDoc({ path: d.path, folders: pcFolders() }); if (r.error) throw new Error(r.error); b64 = r.b64; }
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

const stripXml = (x) => x.replace(/<\/(w:p|a:p|row)>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

/** Texto de un documento (PDF, Word, PowerPoint, Excel o texto plano) */
export async function readDocText(d, maxChars = 12000) {
  const name = d.name.toLowerCase();
  const mime = d.mime || mimeOf(name);
  const u = await bytesOf(d);
  let text = '';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    // El lector corre dentro de la app (sin archivo "worker" aparte, que en la app instalada puede no cargar)
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')]);
    globalThis.pdfjsWorker = worker;
    const doc = await pdfjs.getDocument({ data: u }).promise;
    const parts = [];
    for (let p = 1; p <= doc.numPages && parts.join('').length < maxChars; p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      parts.push(c.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join(''));
    }
    text = parts.join('\n\n');
    if (!text.trim()) text = '(Este PDF parece escaneado: es una imagen y no tiene texto que leer.)';
  } else if (/\.(docx|pptx|xlsx)$/.test(name)) {
    const { unzipSync, strFromU8 } = await import('fflate');
    const z = unzipSync(u);
    if (name.endsWith('.docx')) text = stripXml(strFromU8(z['word/document.xml'] || new Uint8Array()));
    else if (name.endsWith('.pptx')) text = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/))).map((k, i) => `Diapositiva ${i + 1}:\n` + stripXml(strFromU8(z[k]))).join('\n\n');
    else text = stripXml(strFromU8(z['xl/sharedStrings.xml'] || new Uint8Array()));
  } else if (/^text\/|json|csv|markdown/.test(mime) || /\.(txt|md|csv|json|html?)$/.test(name)) {
    text = new TextDecoder().decode(u);
    if (/html?$/.test(name)) text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ');
  } else if (/^image\//.test(mime)) text = '(Es una imagen: no puedo leer su contenido.)';
  else text = '(No sé leer este tipo de archivo; puedo abrirlo con su app.)';
  return text.length > maxChars ? text.slice(0, maxChars) + '\n[… el documento sigue]' : text;
}
