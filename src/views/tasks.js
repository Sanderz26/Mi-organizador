// Tareas y compromisos
import { state, commit, upsert, remove, find, subjectName } from '../store.js';
import { icon } from '../icons.js';
import { esc, todayKey, relDay, formModal, emptyState, addDays, toKey, matches } from '../util.js';
import { subjectOptions, REMINDER_OPTIONS, parseReminder } from '../components.js';
import { award, removeRef, RULES } from '../xp.js';
import { sound } from '../sound.js';

export const CATEGORIES = { general: 'General', estudio: 'Estudio', gimnasio: 'Gimnasio', dieta: 'Dieta', negocio: 'Negocio', personal: 'Personal' };
const PRIORITY = { alta: { l: 'Alta', c: 'bad' }, media: { l: 'Media', c: 'warn' }, baja: { l: 'Baja', c: '' } };
let filter = 'pendientes';
let cat = 'todas';
let q = '';
let bound = null;

export async function taskDialog(task = null, preset = {}) {
  const t = task || { category: preset.subjectId ? 'estudio' : 'general', priority: 'media', reminderMins: state.settings.defaultReminderMins, ...preset };
  const v = await formModal({
    title: task ? 'Editar tarea' : 'Nueva tarea',
    deleteLabel: task ? 'Eliminar' : null,
    fields: [
      { name: 'title', label: 'Qué tienes que hacer', type: 'text', value: t.title, required: true, full: true, placeholder: 'Entregar taller 3 de cálculo' },
      { name: 'due', label: 'Fecha', type: 'date', value: t.due || '' },
      { name: 'dueTime', label: 'Hora', type: 'time', value: t.dueTime || '' },
      { name: 'category', label: 'Categoría', type: 'select', value: t.category, options: Object.entries(CATEGORIES).map(([v, l]) => ({ v, l })) },
      { name: 'subjectId', label: 'Materia', type: 'select', value: t.subjectId || '', options: subjectOptions(true, 'Ninguna', t.subjectId) },
      { name: 'priority', label: 'Prioridad', type: 'select', value: t.priority, options: Object.entries(PRIORITY).map(([v, p]) => ({ v, l: p.l })) },
      { name: 'reminderMins', label: 'Recordatorio', type: 'select', value: t.reminderMins ?? '', options: REMINDER_OPTIONS },
      { name: 'repeat', label: 'Repetir', type: 'select', value: t.repeat || '', options: [{ v: '', l: 'No se repite' }, { v: 'daily', l: 'Cada día' }, { v: 'weekly', l: 'Cada semana' }, { v: 'monthly', l: 'Cada mes' }] },
      { name: 'subtasks', label: 'Subtareas (una por línea)', type: 'textarea', value: (t.subtasks || []).map((s) => (s.done ? '[x] ' : '') + s.text).join('\n'), placeholder: 'Punto 1\nPunto 2' },
      { name: 'notes', label: 'Notas', type: 'textarea', value: t.notes || '' },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('tasks', task.id); removeRef('task:' + task.id); sound('delete'); commit(); return; }
  const subtasks = v.subtasks.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => ({ done: s.startsWith('[x] '), text: s.replace(/^\[x\] /, '') }));
  if (v.subjectId && v.category === 'general') v.category = 'estudio';
  upsert('tasks', { ...(task || { done: false, created: todayKey() }), ...v, reminderMins: parseReminder(v.reminderMins), subtasks });
  sound('complete');
  commit();
}

export function toggleTask(id) {
  const t = find('tasks', id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? todayKey() : null;
  if (t.done) {
    sound('complete');
    if (t.subjectId) {
      const onTime = !t.due || todayKey() <= t.due;
      if (onTime) award('sub:' + t.subjectId, RULES.taskOnTime, `Tarea a tiempo: ${t.title}`, 'task:' + t.id);
    }
    if (t.repeat && t.due) {
      const d = new Date(t.due + 'T00:00');
      const next = t.repeat === 'daily' ? addDays(d, 1) : t.repeat === 'weekly' ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
      upsert('tasks', { ...t, id: undefined, done: false, doneAt: null, due: toKey(next), subtasks: (t.subtasks || []).map((s) => ({ ...s, done: false })) });
    }
  } else {
    removeRef('task:' + t.id);
  }
  commit();
}

function taskRow(t) {
  const today = todayKey();
  const p = PRIORITY[t.priority] || PRIORITY.media;
  const subDone = (t.subtasks || []).filter((s) => s.done).length;
  return `<div class="row ${t.done ? 'done' : ''}">
    <button class="chk ${t.done ? 'on' : ''}" data-toggle="${esc(t.id)}" aria-label="${t.done ? 'Marcar pendiente' : 'Completar'}">${icon('check', 14)}</button>
    <div class="grow" data-edit="${esc(t.id)}" style="cursor:pointer">
      <div class="title">${esc(t.title)}</div>
      <div class="meta">
        ${t.due ? `<span class="${!t.done && t.due < today ? 'down' : ''}">${icon('clock', 12)} ${esc(relDay(t.due))}${t.dueTime ? ' · ' + esc(t.dueTime) : ''}</span>` : ''}
        <span>${esc(CATEGORIES[t.category] || 'General')}</span>
        ${t.subjectId ? `<span>${esc(subjectName(t.subjectId))}</span>` : ''}
        ${t.subtasks?.length ? `<span>${subDone}/${t.subtasks.length} subtareas</span>` : ''}
        ${t.repeat ? `<span>${icon('repeat', 12)}</span>` : ''}
        ${t.reminderMins !== null && t.reminderMins !== undefined && !t.done ? `<span>${icon('bell', 12)}</span>` : ''}
      </div>
    </div>
    ${!t.done && t.priority !== 'baja' ? `<span class="pill ${p.c}">${p.l}</span>` : ''}
  </div>`;
}

export function render(el) {
  const today = todayKey();
  let list = state.tasks.slice();
  if (cat !== 'todas') list = list.filter((t) => t.category === cat);
  if (q) list = list.filter((t) => matches(q, t.title, t.notes, subjectName(t.subjectId), ...(t.subtasks || []).map((x) => x.text)));
  const groups = [];
  if (filter === 'completadas') {
    groups.push(['Completadas', list.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))]);
  } else {
    const open = list.filter((t) => !t.done);
    const sorted = (arr) => arr.sort((a, b) => ((a.due || '9999') + (a.dueTime || '')).localeCompare((b.due || '9999') + (b.dueTime || '')));
    groups.push(['Vencidas', sorted(open.filter((t) => t.due && t.due < today))]);
    groups.push(['Hoy', sorted(open.filter((t) => t.due === today))]);
    if (filter === 'pendientes') {
      groups.push(['Próximas', sorted(open.filter((t) => t.due && t.due > today))]);
      groups.push(['Sin fecha', open.filter((t) => !t.due)]);
    }
  }
  const counts = { pendientes: state.tasks.filter((t) => !t.done).length, hoy: state.tasks.filter((t) => !t.done && t.due && t.due <= today).length, completadas: state.tasks.filter((t) => t.done).length };

  el.innerHTML = `
  <div class="page-head"><div><div class="sub">${counts.pendientes} pendientes</div><h1>Tareas</h1></div>
    <div class="head-actions"><button class="btn primary" data-new>${icon('plus', 16)} Nueva tarea</button></div></div>
  <div class="split">
    <div class="tabs">${[['pendientes', 'Pendientes'], ['hoy', 'Hoy'], ['completadas', 'Completadas']].map(([k, l]) => `<button class="tab ${filter === k ? 'active' : ''}" data-f="${k}">${l} <span class="faint">${counts[k]}</span></button>`).join('')}</div>
    <input type="search" data-tq placeholder="Buscar tareas" value="${esc(q)}" style="max-width:260px">
    <select data-cat style="width:auto;min-width:160px"><option value="todas">Todas las categorías</option>${Object.entries(CATEGORIES).map(([k, l]) => `<option value="${k}" ${cat === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>
  ${groups.filter(([, arr]) => arr.length).map(([name, arr]) => `<div class="card"><div class="card-head"><h2>${esc(name)}</h2><span class="faint small">${arr.length}</span></div><div class="list">${arr.map(taskRow).join('')}</div></div>`).join('') || `<div class="card">${emptyState('circle-check', filter === 'completadas' ? 'Aún no has completado tareas.' : (q ? 'Ninguna tarea coincide con la búsqueda.' : 'No hay tareas aquí.'), `<button class="btn primary" data-new>${icon('plus', 16)} Nueva tarea</button>`)}</div>`}`;

  el.onclick = (e) => {
    const t = e.target.closest('[data-toggle],[data-edit],[data-new],[data-f]');
    if (!t) return;
    if (t.dataset.toggle) toggleTask(t.dataset.toggle);
    else if (t.dataset.edit) taskDialog(find('tasks', t.dataset.edit));
    else if ('new' in t.dataset) taskDialog();
    else if (t.dataset.f) { filter = t.dataset.f; render(el); }
  };
  el.onchange = (e) => { if (e.target.matches('[data-cat]')) { cat = e.target.value; render(el); } };
  el.oninput = (e) => {
    if (!e.target.matches('[data-tq]')) return;
    clearTimeout(bound);
    const v = e.target.value;
    bound = setTimeout(() => { q = v; render(el); const i = el.querySelector('[data-tq]'); i.focus(); i.setSelectionRange(v.length, v.length); }, 220);
  };
}
