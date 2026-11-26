// Componentes compartidos entre vistas
import { state, commit, upsert } from './store.js';
import { icon } from './icons.js';
import { levelInfo, xpOf, streakFor, areaList, award } from './xp.js';
import { esc, formModal, uid, toast, todayKey, confirmModal } from './util.js';
import { saveAttachment, attachmentUrl, openAttachment, deleteAttachment } from './platform.js';
import { sound } from './sound.js';

export function levelCard(area) {
  const info = levelInfo(xpOf(area.key));
  const st = streakFor(area.key);
  return `<div class="lvl" style="--c:${area.color}">
    <div class="lvl-top">${icon(area.icon, 18)}<span class="lvl-badge">Nv ${info.level}</span></div>
    <div class="lvl-name" title="${esc(area.name)}">${esc(area.name)}</div>
    <div class="lvl-rank">${esc(info.rank)}</div>
    <div class="bar"><i style="width:${info.pct}%"></i></div>
    <div class="lvl-foot"><span class="num">${info.into} / ${info.need} XP</span>${st.value ? `<span class="streak">${icon('flame', 13)}${st.value} ${st.unit}</span>` : ''}</div>
  </div>`;
}

export const levelGrid = (areas = areaList()) => `<div class="grid g-auto">${areas.map(levelCard).join('')}</div>`;

/** El usuario decide cuándo falló: resta XP y rompe la racha del día */
export async function failDialog(preset) {
  const areas = areaList();
  const v = await formModal({
    title: 'Registrar fallo',
    submitLabel: 'Restar XP',
    fields: [
      { name: 'area', label: 'Área', type: 'select', value: preset || areas[0]?.key, options: areas.map((a) => ({ v: a.key, l: a.name })) },
      { name: 'amount', label: 'XP a restar', type: 'number', value: 20, min: 1, required: true },
      { name: 'date', label: 'Fecha', type: 'date', value: todayKey() },
      { name: 'reason', label: 'Motivo', type: 'text', placeholder: 'No fui al gimnasio, me pasé de calorías…', full: true },
    ],
    extraHtml: '<p class="small muted">Registrar un fallo también rompe la racha de esa área en esa fecha.</p>',
  });
  if (!v || !v.amount) return;
  award(v.area, -Math.abs(v.amount), v.reason || 'Fallo registrado', null, { date: v.date || todayKey(), kind: 'fail' });
  commit();
}

/** Bonificación manual (por ejemplo, ganaste un parcial) */
export async function bonusDialog(preset) {
  const areas = areaList();
  const v = await formModal({
    title: 'Sumar XP manualmente',
    submitLabel: 'Sumar XP',
    fields: [
      { name: 'area', label: 'Área', type: 'select', value: preset || areas[0]?.key, options: areas.map((a) => ({ v: a.key, l: a.name })) },
      { name: 'amount', label: 'XP a sumar', type: 'number', value: 25, min: 1, required: true },
      { name: 'reason', label: 'Motivo', type: 'text', placeholder: 'Saqué 4,8 en el parcial', full: true },
    ],
  });
  if (!v || !v.amount) return;
  award(v.area, Math.abs(v.amount), v.reason || 'Bonificación', null, { kind: 'bonus' });
  commit();
}

// ---------- Adjuntos ----------
export async function addFiles(files, owner) {
  const ids = [];
  for (const f of files) {
    if (f.size > 60 * 1024 * 1024) { toast(`${f.name} supera 60 MB`); continue; }
    const meta = await saveAttachment(f, uid());
    state.files.push({ ...meta, owner });
    ids.push(meta.id);
  }
  if (ids.length) { sound('complete'); toast(ids.length === 1 ? 'Archivo agregado' : `${ids.length} archivos agregados`); }
  return ids;
}

export function thumbsHtml(ids = [], editable = true) {
  if (!ids.length) return '';
  return `<div class="thumbs">${ids.map((id) => {
    const f = state.files.find((x) => x.id === id);
    if (!f) return '';
    const img = f.mime.startsWith('image/');
    return `<div class="thumb" data-file="${esc(f.id)}" title="${esc(f.name)}">
      ${img ? `<img data-img="${esc(f.id)}" alt="${esc(f.name)}">` : `<div class="fi">${icon(f.mime.includes('pdf') ? 'file' : 'paperclip', 26)}</div>`}
      <div class="fn">${esc(f.name)}</div>
      ${editable ? `<button class="del" data-delfile="${esc(f.id)}" aria-label="Quitar archivo">${icon('x', 14)}</button>` : ''}
    </div>`;
  }).join('')}</div>`;
}

/** Carga miniaturas y activa abrir/eliminar. onRemove(id) quita la referencia del dueño. */
export function bindThumbs(root, onRemove) {
  root.querySelectorAll('img[data-img]').forEach(async (img) => {
    const f = state.files.find((x) => x.id === img.dataset.img);
    if (f) img.src = await attachmentUrl(f);
  });
  root.querySelectorAll('[data-file]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-delfile]');
      const f = state.files.find((x) => x.id === el.dataset.file);
      if (!f) return;
      if (del) {
        e.stopPropagation();
        if (!(await confirmModal(`¿Quitar "${f.name}"?`, 'Quitar'))) return;
        await deleteAttachment(f);
        state.files = state.files.filter((x) => x.id !== f.id);
        onRemove?.(f.id);
        sound('delete');
        commit();
        return;
      }
      try { await openAttachment(f); } catch { toast('No se pudo abrir el archivo'); }
    });
  });
}

export const subjectOptions = (withNone = true, noneLabel = 'Sin materia') => [
  ...(withNone ? [{ v: '', l: noneLabel }] : []),
  ...state.subjects.filter((s) => !s.archived).map((s) => ({ v: s.id, l: s.name })),
];

export const REMINDER_OPTIONS = [
  { v: '', l: 'Sin recordatorio' }, { v: 0, l: 'A la hora' }, { v: 5, l: '5 minutos antes' }, { v: 15, l: '15 minutos antes' },
  { v: 30, l: '30 minutos antes' }, { v: 60, l: '1 hora antes' }, { v: 120, l: '2 horas antes' }, { v: 1440, l: '1 día antes' },
  { v: 2880, l: '2 días antes' }, { v: 10080, l: '1 semana antes' },
];
export const parseReminder = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export { upsert };
