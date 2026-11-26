// Componentes compartidos entre vistas
import { state, commit, upsert } from './store.js';
import { icon } from './icons.js';
import { levelInfo, xpOf, streakFor, areaList, award, areaName } from './xp.js';
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

const areaOptions = () => areaList().map((a) => ({ v: a.key, l: a.name, g: a.kind === 'subject' ? 'Materias' : 'Hábitos' }));

/**
 * El usuario decide cuándo falló: resta XP y rompe la racha.
 * Con un área dada (desde una materia, Gimnasio o Dieta) no se muestra selector.
 */
export async function failDialog(area) {
  const name = area ? areaName(area) : '';
  const v = await formModal({
    title: area ? `Registrar fallo en ${name}` : 'Registrar fallo',
    submitLabel: 'Restar XP',
    fields: [
      ...(area ? [] : [{ name: 'area', label: 'Área', type: 'select', value: areaList()[0]?.key, options: areaOptions(), full: true }]),
      { name: 'amount', label: 'XP a restar', type: 'number', value: 20, min: 1, required: true },
      { name: 'date', label: 'Fecha', type: 'date', value: todayKey() },
      { name: 'reason', label: 'Motivo', type: 'text', placeholder: area === 'gym' ? 'No fui a entrenar' : area === 'diet' ? 'Me pasé de calorías' : area ? 'No estudié lo que tenía planeado' : 'Qué pasó', full: true },
    ],
    extraHtml: '<p class="small muted">Registrar un fallo también rompe la racha en esa fecha.</p>',
  });
  if (!v || !v.amount) return;
  award(area || v.area, -Math.abs(v.amount), v.reason || 'Fallo registrado', null, { date: v.date || todayKey(), kind: 'fail' });
  commit();
}

/** Bonificación manual (por ejemplo, ganaste un parcial) */
export async function bonusDialog(area) {
  const name = area ? areaName(area) : '';
  const v = await formModal({
    title: area ? `Sumar XP a ${name}` : 'Sumar XP manualmente',
    submitLabel: 'Sumar XP',
    fields: [
      ...(area ? [] : [{ name: 'area', label: 'Área', type: 'select', value: areaList()[0]?.key, options: areaOptions(), full: true }]),
      { name: 'amount', label: 'XP a sumar', type: 'number', value: 25, min: 1, required: true },
      { name: 'reason', label: 'Motivo', type: 'text', placeholder: area === 'gym' ? 'Entreno extra de cardio' : area === 'diet' ? 'Semana perfecta' : 'Saqué 4,8 en el parcial', full: true },
    ],
  });
  if (!v || !v.amount) return;
  award(area || v.area, Math.abs(v.amount), v.reason || 'Bonificación', null, { kind: 'bonus' });
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

/** Materias del semestre actual primero; las de otros semestres llevan su nombre de semestre */
export const subjectOptions = (withNone = true, noneLabel = 'Sin materia', keepId = '') => {
  const cur = state.settings.currentSemester;
  const semName = (id) => state.semesters.find((x) => x.id === id)?.name || '';
  const now = state.subjects.filter((s) => s.semesterId === cur && !s.archived);
  const others = state.subjects.filter((s) => (s.semesterId !== cur || s.archived) && s.id === keepId);
  return [
    ...(withNone ? [{ v: '', l: noneLabel }] : []),
    ...now.map((s) => ({ v: s.id, l: s.name })),
    ...others.map((s) => ({ v: s.id, l: `${s.name} · ${semName(s.semesterId)}` })),
  ];
};

export const REMINDER_OPTIONS = [
  { v: '', l: 'Sin recordatorio' }, { v: 0, l: 'A la hora' }, { v: 5, l: '5 minutos antes' }, { v: 15, l: '15 minutos antes' },
  { v: 30, l: '30 minutos antes' }, { v: 60, l: '1 hora antes' }, { v: 120, l: '2 horas antes' }, { v: 1440, l: '1 día antes' },
  { v: 2880, l: '2 días antes' }, { v: 10080, l: '1 semana antes' },
];
export const parseReminder = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export { upsert };
