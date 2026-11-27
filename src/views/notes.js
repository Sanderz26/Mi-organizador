// Notas y apuntes con archivos (PDF, imágenes, documentos)
import { state, commit, upsert, remove, find, subjectName, subjectColor } from '../store.js';
import { icon } from '../icons.js';
import { esc, todayKey, fmtDate, openModal, emptyState, confirmModal } from '../util.js';
import { addFiles, thumbsHtml, bindThumbs, subjectOptions } from '../components.js';
import { deleteAttachment } from '../platform.js';
import { sound } from '../sound.js';

let filterSub = 'todas';
let query = '';

export function noteDialog(note = null, preset = {}) {
  const n = note || { subjectId: '', title: '', body: '', fileIds: [], ...preset };
  let fileIds = [...(n.fileIds || [])];
  const pendingNew = [];
  const ov = openModal({
    title: note ? 'Editar nota' : 'Nueva nota',
    wide: true,
    body: `<div class="form-grid">
      <div class="field"><label for="n_t">Título</label><input id="n_t" type="text" value="${esc(n.title)}" placeholder="Resumen capítulo 4"></div>
      <div class="field"><label for="n_s">Materia</label><select id="n_s">${subjectOptions(true, 'Nota general', n.subjectId).map((o) => `<option value="${esc(o.v)}" ${o.v === n.subjectId ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>
      <div class="field full"><label for="n_b">Contenido</label><textarea id="n_b" style="min-height:220px" placeholder="Escribe tus apuntes…">${esc(n.body)}</textarea></div>
      <div class="field full"><label>Archivos</label><div data-thumbs></div>
        <label class="btn sm" style="width:fit-content;cursor:pointer">${icon('paperclip', 15)} Adjuntar archivos<input type="file" multiple hidden data-files></label>
        <div class="hint">PDF, imágenes, Word, Excel… Se guardan dentro de la app.</div></div>
    </div>`,
    foot: `${note ? `<button class="btn danger" data-del>${icon('trash', 16)} Eliminar</button><div class="spacer"></div>` : ''}<button class="btn ghost" data-cancel>Cancelar</button><button class="btn primary" data-save>${icon('check', 16)} Guardar</button>`,
  });
  const q = (s) => ov.querySelector(s);
  const drawThumbs = () => {
    q('[data-thumbs]').innerHTML = thumbsHtml(fileIds) + (pendingNew.length ? `<p class="small muted" style="margin-top:6px">${pendingNew.length} archivo(s) se agregarán al guardar: ${pendingNew.map((f) => esc(f.name)).join(', ')}</p>` : '');
    bindThumbs(q('[data-thumbs]'), (id) => { fileIds = fileIds.filter((x) => x !== id); if (note) { note.fileIds = fileIds; } drawThumbs(); });
  };
  drawThumbs();
  q('[data-files]').onchange = (e) => { pendingNew.push(...e.target.files); e.target.value = ''; drawThumbs(); };
  q('[data-cancel]').onclick = () => ov.close();
  if (note) q('[data-del]').onclick = async () => {
    if (!(await confirmModal('¿Eliminar esta nota y sus archivos?'))) return;
    for (const id of note.fileIds || []) { const f = state.files.find((x) => x.id === id); if (f) await deleteAttachment(f); }
    state.files = state.files.filter((f) => !(note.fileIds || []).includes(f.id));
    remove('notes', note.id); sound('delete'); ov.close(); commit();
  };
  q('[data-save]').onclick = async () => {
    const title = q('#n_t').value.trim(), body = q('#n_b').value;
    if (!title && !body.trim() && !fileIds.length && !pendingNew.length) { ov.close(); return; }
    q('[data-save]').disabled = true;
    const saved = upsert('notes', { ...(note || { date: todayKey() }), title: title || 'Sin título', body, subjectId: q('#n_s').value, fileIds, updated: todayKey() });
    if (pendingNew.length) {
      const ids = await addFiles(pendingNew, 'note:' + saved.id);
      saved.fileIds = [...fileIds, ...ids];
    } else sound('complete');
    ov.close();
    commit();
  };
}

function noteCard(n) {
  const imgs = (n.fileIds || []).length;
  return `<div class="card" style="cursor:pointer;padding:14px 16px" data-note="${esc(n.id)}">
    <div class="split"><h3 class="grow">${esc(n.title)}</h3>${imgs ? `<span class="pill">${icon('paperclip', 12)} ${imgs}</span>` : ''}</div>
    ${n.body ? `<p class="small muted" style="margin-top:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line">${esc(n.body)}</p>` : ''}
    <div class="meta tiny faint" style="margin-top:8px;display:flex;gap:8px">${n.subjectId ? `<span class="subject-chip"><span class="dot" style="--c:${esc(subjectColor(n.subjectId))};width:7px;height:7px"></span>${esc(subjectName(n.subjectId))}</span>` : '<span>General</span>'}<span>${esc(fmtDate(n.updated || n.date))}</span></div>
  </div>`;
}

/** Bloque de apuntes dentro de una materia */
export function notesBlock(subjectId) {
  const list = state.notes.filter((n) => n.subjectId === subjectId).sort((a, b) => (b.updated || b.date).localeCompare(a.updated || a.date));
  return `<div class="split" style="margin-bottom:12px"><button class="btn sm primary" data-newnote>${icon('plus', 14)} Apunte</button><span class="muted small">Notas, PDF, fotos del tablero, documentos…</span></div>
    ${list.length ? `<div class="grid g-auto">${list.map(noteCard).join('')}</div>` : emptyState('notes', 'Aún no hay apuntes en esta materia.')}`;
}
export function bindNotesBlock(el, subjectId) {
  el.querySelectorAll('[data-newnote]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); noteDialog(null, { subjectId }); }));
  el.querySelectorAll('[data-note]').forEach((c) => c.addEventListener('click', (e) => { e.stopPropagation(); noteDialog(find('notes', c.dataset.note)); }));
}

export function render(el) {
  let list = state.notes.slice().sort((a, b) => (b.updated || b.date).localeCompare(a.updated || a.date));
  if (filterSub === 'general') list = list.filter((n) => !n.subjectId);
  else if (filterSub !== 'todas') list = list.filter((n) => n.subjectId === filterSub);
  if (query) { const q = query.toLowerCase(); list = list.filter((n) => (n.title + ' ' + n.body).toLowerCase().includes(q)); }
  el.innerHTML = `
  <div class="page-head"><div><div class="sub">${state.notes.length} notas · ${state.files.filter((f) => f.owner?.type !== 'tono').length} archivos</div><h1>Notas y apuntes</h1></div>
    <div class="head-actions"><button class="btn primary" data-newnote>${icon('plus', 16)} Nueva nota</button></div></div>
  <div class="split">
    <input type="search" data-q placeholder="Buscar en tus notas" value="${esc(query)}" style="max-width:320px">
    <select data-sub style="width:auto;min-width:180px"><option value="todas">Todas</option><option value="general" ${filterSub === 'general' ? 'selected' : ''}>Generales</option>${state.subjects.map((s) => `<option value="${esc(s.id)}" ${filterSub === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
  </div>
  ${list.length ? `<div class="grid g-auto" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${list.map(noteCard).join('')}</div>` : `<div class="card">${emptyState('notes', query ? 'No hay notas que coincidan.' : 'Escribe tu primera nota o sube apuntes.', `<button class="btn primary" data-newnote>${icon('plus', 16)} Nueva nota</button>`)}</div>`}`;
  el.onclick = (e) => {
    const t = e.target.closest('[data-note],[data-newnote]');
    if (!t) return;
    if (t.dataset.note) noteDialog(find('notes', t.dataset.note));
    else noteDialog(null, { subjectId: filterSub !== 'todas' && filterSub !== 'general' ? filterSub : '' });
  };
  el.onchange = (e) => { if (e.target.matches('[data-sub]')) { filterSub = e.target.value; render(el); } };
  let tmr;
  el.oninput = (e) => {
    if (!e.target.matches('[data-q]')) return;
    clearTimeout(tmr);
    tmr = setTimeout(() => { query = e.target.value; render(el); const i = el.querySelector('[data-q]'); i.focus(); i.setSelectionRange(query.length, query.length); }, 250);
  };
}
