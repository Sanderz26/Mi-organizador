// Exámenes: ligados a una materia y sus temas, con nota, XP y cuenta regresiva
import { state, commit, upsert, remove, find, subjectName, activeSubjects } from '../store.js';
import { esc, todayKey, parseKey, formModal, checksInner } from '../util.js';
import { REMINDER_OPTIONS, parseReminder, subjectOptions } from '../components.js';
import { award, removeRef } from '../xp.js';
import { sound } from '../sound.js';

const topicOpts = (sid) => state.topics.filter((t) => t.subjectId === sid).map((t) => ({ v: t.id, l: t.name }));

export async function examDialog(ex = null, preset = {}) {
  const e = ex || { date: preset.date || todayKey(), subjectId: preset.subjectId || activeSubjects()[0]?.id || '', reminderMins: 1440, maxGrade: 5, topicIds: [] };
  const sid0 = e.subjectId;
  const v = await formModal({
    title: ex ? 'Editar examen' : 'Nuevo examen',
    deleteLabel: ex ? 'Eliminar' : null,
    fields: [
      { name: 'subjectId', label: 'Materia', type: 'select', value: sid0, options: subjectOptions(true, 'Sin materia', sid0) },
      { name: 'title', label: 'Nombre', type: 'text', value: e.title || '', placeholder: 'Parcial 2' },
      { name: 'date', label: 'Fecha', type: 'date', value: e.date, required: true },
      { name: 'time', label: 'Hora', type: 'time', value: e.time || '' },
      { name: 'place', label: 'Salón (opcional)', type: 'text', value: e.place || '' },
      { name: 'reminderMins', label: 'Avisarme', type: 'select', value: e.reminderMins ?? '', options: REMINDER_OPTIONS },
      { name: 'topicIds', label: 'Temas que entran', type: 'checks', value: e.topicIds || [], options: topicOpts(sid0), hint: 'Agrega temas desde la materia si no aparecen.' },
      { type: 'section', label: 'Resultado', hint: 'Llénalo cuando tengas la nota: una buena nota suma XP a la materia.' },
      { name: 'grade', label: 'Nota', type: 'number', value: e.grade ?? '', step: 0.1, min: 0 },
      { name: 'maxGrade', label: 'Nota máxima', type: 'number', value: e.maxGrade ?? 5, step: 0.1, min: 1 },
      { name: 'weight', label: 'Porcentaje de la materia (opcional)', type: 'number', value: e.weight ?? '', step: 1, min: 0 },
      { name: 'notes', label: 'Notas', type: 'textarea', value: e.notes || '' },
    ],
    onChange: (vals, form) => {
      const box = form.querySelector('[data-checks="topicIds"]');
      if (box && box.dataset.for !== vals.subjectId) {
        const keep = new Set(vals.subjectId === sid0 ? vals.topicIds : []);
        box.innerHTML = checksInner('topicIds', topicOpts(vals.subjectId), keep);
        box.dataset.for = vals.subjectId;
      }
    },
  });
  if (!v) return;
  if (v._action === 'delete') { remove('events', ex.id); removeRef('exam:' + ex.id); sound('delete'); commit(); return; }
  const saved = upsert('events', {
    ...(ex || {}), type: 'examen', title: v.title || `Examen de ${subjectName(v.subjectId)}`, subjectId: v.subjectId, date: v.date, time: v.time,
    place: v.place, reminderMins: parseReminder(v.reminderMins), topicIds: v.topicIds, grade: v.grade, maxGrade: v.maxGrade || 5, weight: v.weight, notes: v.notes, repeat: '',
  });
  if (saved.subjectId && saved.grade !== null && saved.grade !== undefined && saved.grade !== '') {
    const pct = Math.max(0, Math.min(1, saved.grade / (saved.maxGrade || 5)));
    award('sub:' + saved.subjectId, Math.round(pct * 50), `Nota ${saved.grade}/${saved.maxGrade} en ${saved.title}`, 'exam:' + saved.id, { date: saved.date });
  } else {
    removeRef('exam:' + saved.id);
    sound('complete');
  }
  commit();
}

/** Exámenes (eventos de tipo examen y fechas de examen de los temas) */
export function allExams() {
  const out = [];
  for (const e of state.events) if (e.type === 'examen') out.push({ kind: 'exam', id: e.id, title: e.title, subjectId: e.subjectId || '', date: e.date, time: e.time || '', grade: e.grade, maxGrade: e.maxGrade || 5, topics: (e.topicIds || []).map((id) => find('topics', id)?.name).filter(Boolean), ref: e });
  for (const t of state.topics) if (t.examDate) out.push({ kind: 'topic', id: t.id, title: `Examen: ${t.name}`, subjectId: t.subjectId, date: t.examDate, time: '', topics: [t.name], ref: t });
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
export const daysUntil = (k) => Math.round((parseKey(k) - parseKey(todayKey())) / 864e5);
export const countdown = (k) => { const d = daysUntil(k); return d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : d < 0 ? `Hace ${-d} días` : `En ${d} días`; };
export const upcomingExams = (days = 30) => allExams().filter((x) => { const d = daysUntil(x.date); return d >= 0 && d <= days; });

export function subjectAverage(sid) {
  const g = state.events.filter((e) => e.type === 'examen' && e.subjectId === sid && e.grade !== null && e.grade !== undefined && e.grade !== '');
  if (!g.length) return null;
  const withW = g.filter((e) => Number(e.weight) > 0);
  if (withW.length === g.length) {
    const w = withW.reduce((a, e) => a + Number(e.weight), 0);
    return { value: withW.reduce((a, e) => a + (e.grade / (e.maxGrade || 5)) * 5 * Number(e.weight), 0) / w, weighted: true, covered: w };
  }
  return { value: g.reduce((a, e) => a + (e.grade / (e.maxGrade || 5)) * 5, 0) / g.length, weighted: false };
}

export function examRow(x, showSubject = true) {
  const past = daysUntil(x.date) < 0;
  const graded = x.grade !== null && x.grade !== undefined && x.grade !== '';
  const pill = graded ? `<span class="pill ${x.grade / x.maxGrade >= 0.6 ? 'ok' : 'bad'}">${x.grade} / ${x.maxGrade}</span>` : `<span class="pill ${past ? '' : daysUntil(x.date) <= 3 ? 'bad' : 'warn'}">${esc(countdown(x.date))}</span>`;
  return `<div class="row click" data-exam="${esc(x.kind)}:${esc(x.id)}"><span class="dot" style="--c:var(--bad)"></span><div class="grow"><div class="title">${esc(x.title)}</div><div class="meta">${showSubject && x.subjectId ? `<span>${esc(subjectName(x.subjectId))}</span>` : ''}<span>${esc(x.date.slice(8))}/${esc(x.date.slice(5, 7))}${x.time ? ' · ' + esc(x.time) : ''}</span>${x.topics.length ? `<span>${esc(x.topics.slice(0, 3).join(', '))}${x.topics.length > 3 ? '…' : ''}</span>` : ''}</div></div>${pill}</div>`;
}
