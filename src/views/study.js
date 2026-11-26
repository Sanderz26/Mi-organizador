// Estudio: materias, temas, horas, eficiencia en ejercicios, tareas y apuntes
import { state, commit, upsert, remove, find, SUBJECT_COLORS, topicName } from '../store.js';
import { icon } from '../icons.js';
import { esc, todayKey, fmtMin, fmtSec, fmtDate, formModal, openModal, emptyState, sum, weekKey, DAYS } from '../util.js';
import { levelCard, failDialog, bonusDialog } from '../components.js';
import { award, removeRef, RULES, studyStreak } from '../xp.js';
import { startTimer, awardStudy } from '../timer.js';
import { chart, destroyCharts } from '../charts.js';
import { sound } from '../sound.js';
import { taskDialog, toggleTask } from './tasks.js';
import { notesBlock, bindNotesBlock } from './notes.js';

const STATUS = { pendiente: { l: 'Pendiente', c: '' }, curso: { l: 'En curso', c: 'warn' }, dominado: { l: 'Dominado', c: 'ok' } };
const DAY_ALIASES = { do: 0, lu: 1, ma: 2, mi: 3, ju: 4, vi: 5, sa: 6 };
let tab = 'temas';
let effTopic = '';

// ---------- Horario ----------
const scheduleToText = (sch = []) => sch.map((c) => `${DAYS[c.day]} ${c.start}-${c.end}${c.room ? ' ' + c.room : ''}`).join('\n');
function parseSchedule(text) {
  const out = [], bad = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const norm = line.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const day = DAY_ALIASES[norm.slice(0, 2)];
    const m = norm.match(/(\d{1,2})[:.h]?(\d{2})?\s*(am|pm)?\s*(?:-|a|–|hasta)\s*(\d{1,2})[:.h]?(\d{2})?\s*(am|pm)?/);
    if (day === undefined || !m) { bad.push(line); continue; }
    const fix = (h, mm, ap) => { h = Number(h); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return `${String(h).padStart(2, '0')}:${mm || '00'}`; };
    const rest = line.slice(line.toLowerCase().lastIndexOf(m[0].split(/\s/).pop()) + m[0].split(/\s/).pop().length).trim();
    out.push({ day, start: fix(m[1], m[2], m[3]), end: fix(m[4], m[5], m[6] || m[3]), room: rest.replace(/^[-–,·]\s*/, '') });
  }
  return { out, bad };
}

export async function subjectDialog(sub = null) {
  const s = sub || { color: SUBJECT_COLORS[state.subjects.length % SUBJECT_COLORS.length] };
  const v = await formModal({
    title: sub ? 'Editar materia' : 'Nueva materia',
    deleteLabel: sub ? 'Eliminar materia' : null,
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', value: s.name, required: true, placeholder: 'Cálculo integral' },
      { name: 'color', label: 'Color', type: 'color', value: s.color },
      { name: 'teacher', label: 'Profesor', type: 'text', value: s.teacher || '' },
      { name: 'credits', label: 'Créditos', type: 'number', value: s.credits || '', step: 1 },
      { name: 'schedule', label: 'Horario de clases (una clase por línea)', type: 'textarea', value: scheduleToText(s.schedule), placeholder: 'Lunes 7:00-9:00 Bloque 3 - 201\nMiércoles 7:00-9:00 Bloque 3 - 201', hint: 'Formato: día hora inicio-hora fin y, si quieres, el salón. Aparece en tu calendario cada semana.' },
      { name: 'semesterStart', label: 'Inicio del semestre', type: 'date', value: s.semesterStart || '' },
      { name: 'semesterEnd', label: 'Fin del semestre', type: 'date', value: s.semesterEnd || '' },
      { name: 'goalHours', label: 'Meta de estudio semanal (horas)', type: 'number', value: s.goalHours || '', step: 0.5 },
      { name: 'archived', label: 'Materia terminada (se oculta pero conserva su historial)', type: 'checkbox', value: s.archived },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') {
    remove('subjects', sub.id);
    state.topics = state.topics.filter((t) => t.subjectId !== sub.id);
    state.studySessions = state.studySessions.filter((t) => t.subjectId !== sub.id);
    state.exercises = state.exercises.filter((t) => t.subjectId !== sub.id);
    state.xpLog = state.xpLog.filter((e) => e.area !== 'sub:' + sub.id);
    sound('delete'); commit(); window.go('estudio'); return;
  }
  const { out, bad } = parseSchedule(v.schedule);
  if (bad.length) openModal({ title: 'Revisa el horario', body: `<p>No entendí estas líneas y no se guardaron:</p><p class="small muted">${bad.map(esc).join('<br>')}</p><p class="small">Usa por ejemplo: <b>Martes 14:00-16:00 Salón 302</b></p>` });
  const saved = upsert('subjects', { ...(sub || {}), ...v, schedule: out });
  sound('complete');
  commit();
  if (!sub) window.go('estudio', saved.id);
}

export async function topicDialog(subjectId, topic = null) {
  const v = await formModal({
    title: topic ? 'Editar tema' : 'Nuevo tema',
    deleteLabel: topic ? 'Eliminar tema' : null,
    fields: [
      { name: 'name', label: 'Tema', type: 'text', value: topic?.name, required: true, placeholder: 'Integración por partes', full: true },
      { name: 'status', label: 'Estado', type: 'select', value: topic?.status || 'pendiente', options: Object.entries(STATUS).map(([v, s]) => ({ v, l: s.l })) },
      { name: 'examDate', label: 'Fecha de examen (opcional)', type: 'date', value: topic?.examDate || '' },
      { name: 'notes', label: 'Notas', type: 'textarea', value: topic?.notes || '' },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('topics', topic.id); sound('delete'); commit(); return; }
  upsert('topics', { ...(topic || { subjectId, created: todayKey() }), ...v });
  sound('complete');
  commit();
}

/** Elige materia y tema y arranca el cronómetro */
export async function startDialog(subjectId = '') {
  const subs = state.subjects.filter((s) => !s.archived);
  if (!subs.length) { window.go('estudio'); subjectDialog(); return; }
  const sid = subjectId || subs[0].id;
  const v = await formModal({
    title: 'Iniciar estudio',
    submitLabel: 'Iniciar',
    fields: [
      { name: 'subjectId', label: 'Materia', type: 'select', value: sid, options: subs.map((s) => ({ v: s.id, l: s.name })) },
      { name: 'topicId', label: 'Tema', type: 'select', value: '', options: [{ v: '', l: 'Sin tema específico' }, ...state.topics.filter((t) => t.subjectId === sid).map((t) => ({ v: t.id, l: t.name }))] },
    ],
    onChange: (vals, form) => {
      const sel = form.elements.topicId;
      const opts = [{ v: '', l: 'Sin tema específico' }, ...state.topics.filter((t) => t.subjectId === vals.subjectId).map((t) => ({ v: t.id, l: t.name }))];
      if (sel.dataset.for !== vals.subjectId) { sel.innerHTML = opts.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(''); sel.dataset.for = vals.subjectId; }
    },
  });
  if (v) startTimer(v.subjectId, v.topicId);
}

async function sessionDialog(subjectId, ses = null) {
  const v = await formModal({
    title: ses ? 'Editar sesión' : 'Registrar sesión de estudio',
    deleteLabel: ses ? 'Eliminar' : null,
    fields: [
      { name: 'date', label: 'Fecha', type: 'date', value: ses?.date || todayKey(), required: true },
      { name: 'start', label: 'Hora de inicio', type: 'time', value: ses?.start || '' },
      { name: 'minutes', label: 'Minutos', type: 'number', value: ses?.minutes || 60, min: 1, required: true },
      { name: 'topicId', label: 'Tema', type: 'select', value: ses?.topicId || '', options: [{ v: '', l: 'Sin tema específico' }, ...state.topics.filter((t) => t.subjectId === subjectId).map((t) => ({ v: t.id, l: t.name }))] },
      { name: 'note', label: 'Qué hiciste', type: 'textarea', value: ses?.note || '' },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('studySessions', ses.id); removeRef('study:' + ses.id); sound('delete'); commit(); return; }
  const s = upsert('studySessions', { ...(ses || { subjectId }), ...v });
  awardStudy(s);
  commit();
}

// ---------- Eficiencia ----------
export function topicStats(topicId) {
  const ex = state.exercises.filter((e) => e.topicId === topicId).sort((a, b) => a.ts - b.ts);
  if (!ex.length) return { n: 0 };
  const avg = (arr) => sum(arr, (e) => e.seconds) / arr.length;
  const k = Math.min(5, Math.floor(ex.length / 2) || 1);
  const first = avg(ex.slice(0, k)), last = avg(ex.slice(-k));
  return { n: ex.length, avg: avg(ex), first, last, improve: ex.length >= 4 ? Math.round(((first - last) / first) * 100) : null, acc: Math.round((ex.filter((e) => e.correct).length / ex.length) * 100) };
}

function saveExercise(subjectId, data) {
  const prev = state.exercises.filter((e) => e.topicId === data.topicId && data.topicId);
  const prevAvg = prev.length >= 3 ? sum(prev, (e) => e.seconds) / prev.length : null;
  const ex = upsert('exercises', { subjectId, date: todayKey(), ts: Date.now(), ...data });
  let xp = RULES.exercise;
  let why = 'Ejercicio resuelto';
  if (data.correct && prevAvg && data.seconds < prevAvg) { xp += RULES.exerciseFaster; why = `Más rápido que tu promedio (${fmtSec(prevAvg)})`; }
  if (!data.correct) xp = Math.round(xp / 2);
  award('sub:' + subjectId, xp, why, 'ex:' + ex.id);
  return { ex, prevAvg };
}

/** Cronómetro por ejercicio: mide cuánto tardas y si te quedó bien */
export function exerciseTimer(subjectId, topicId = '') {
  const topics = state.topics.filter((t) => t.subjectId === subjectId);
  let start = null, elapsed = 0, tick = null, count = 0;
  const ov = openModal({
    title: 'Cronómetro de ejercicios',
    body: `<div class="field"><label>Tema</label><select data-topic>${[{ v: '', l: 'Sin tema específico' }, ...topics.map((t) => ({ v: t.id, l: t.name }))].map((o) => `<option value="${esc(o.v)}" ${o.v === topicId ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>
      <div class="field"><label>Dificultad</label><select data-diff><option value="1">Fácil</option><option value="2" selected>Media</option><option value="3">Difícil</option></select></div>
      <div style="text-align:center;padding:14px 0"><div class="num" data-clock style="font-size:54px;font-weight:600;letter-spacing:-.02em">0:00</div><div class="muted small" data-info>Presiona iniciar cuando empieces el ejercicio</div></div>
      <div class="split" style="justify-content:center" data-step1><button class="btn primary" data-go style="min-width:180px">${icon('player-play', 16)} Iniciar ejercicio</button></div>
      <div class="split hidden" style="justify-content:center" data-step2><button class="btn primary" data-ok>${icon('check', 16)} Me quedó bien</button><button class="btn" data-bad>${icon('x', 16)} Me equivoqué</button></div>
      <p class="small muted" data-count style="text-align:center"></p>`,
  });
  const q = (s) => ov.querySelector(s);
  const clock = () => { q('[data-clock]').textContent = fmtSec(elapsed + (start ? (Date.now() - start) / 1000 : 0)); };
  ov.addEventListener('closed', () => clearInterval(tick));
  q('[data-go]').onclick = () => {
    start = Date.now(); elapsed = 0; sound('start');
    tick = setInterval(clock, 250);
    q('[data-step1]').classList.add('hidden'); q('[data-step2]').classList.remove('hidden');
    q('[data-info]').textContent = 'Resolviendo… marca el resultado al terminar';
  };
  const finish = (correct) => {
    clearInterval(tick);
    const seconds = Math.max(1, Math.round((Date.now() - start) / 1000));
    start = null;
    const { prevAvg } = saveExercise(subjectId, { topicId: q('[data-topic]').value, seconds, correct, difficulty: Number(q('[data-diff]').value) });
    count++;
    q('[data-clock]').textContent = fmtSec(seconds);
    q('[data-info]').textContent = prevAvg ? (seconds < prevAvg ? `Mejoraste: tu promedio era ${fmtSec(prevAvg)}` : `Tu promedio en este tema es ${fmtSec(prevAvg)}`) : 'Guardado';
    q('[data-count]').textContent = `${count} ejercicio${count > 1 ? 's' : ''} en esta tanda`;
    q('[data-step2]').classList.add('hidden'); q('[data-step1]').classList.remove('hidden');
    q('[data-go]').innerHTML = `${icon('player-play', 16)} Siguiente ejercicio`;
    commit();
  };
  q('[data-ok]').onclick = () => finish(true);
  q('[data-bad]').onclick = () => finish(false);
}

async function exerciseManual(subjectId, ex = null) {
  const v = await formModal({
    title: ex ? 'Editar ejercicio' : 'Registrar ejercicio',
    deleteLabel: ex ? 'Eliminar' : null,
    fields: [
      { name: 'topicId', label: 'Tema', type: 'select', value: ex?.topicId || '', options: [{ v: '', l: 'Sin tema específico' }, ...state.topics.filter((t) => t.subjectId === subjectId).map((t) => ({ v: t.id, l: t.name }))] },
      { name: 'date', label: 'Fecha', type: 'date', value: ex?.date || todayKey() },
      { name: 'min', label: 'Minutos', type: 'number', value: ex ? Math.floor(ex.seconds / 60) : 5, min: 0, step: 1 },
      { name: 'sec', label: 'Segundos', type: 'number', value: ex ? ex.seconds % 60 : 0, min: 0, step: 1 },
      { name: 'difficulty', label: 'Dificultad', type: 'select', value: ex?.difficulty || 2, options: [{ v: 1, l: 'Fácil' }, { v: 2, l: 'Media' }, { v: 3, l: 'Difícil' }] },
      { name: 'correct', label: 'Me quedó bien', type: 'checkbox', value: ex ? ex.correct : true },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('exercises', ex.id); removeRef('ex:' + ex.id); sound('delete'); commit(); return; }
  const seconds = Math.max(1, (v.min || 0) * 60 + (v.sec || 0));
  if (ex) upsert('exercises', { ...ex, topicId: v.topicId, date: v.date, seconds, difficulty: Number(v.difficulty), correct: v.correct });
  else saveExercise(subjectId, { topicId: v.topicId, date: v.date, seconds, difficulty: Number(v.difficulty), correct: v.correct });
  sound('complete');
  commit();
}

// ---------- Vistas ----------
function subjectCard(s) {
  const mins = sum(state.studySessions.filter((x) => x.subjectId === s.id), (x) => x.minutes);
  const week = sum(state.studySessions.filter((x) => x.subjectId === s.id && weekKey(new Date(x.date + 'T00:00')) === weekKey(new Date())), (x) => x.minutes);
  const topics = state.topics.filter((t) => t.subjectId === s.id);
  const dom = topics.filter((t) => t.status === 'dominado').length;
  const pend = state.tasks.filter((t) => t.subjectId === s.id && !t.done).length;
  return `<div class="card" style="cursor:pointer" data-open="${esc(s.id)}">
    <div class="split"><span class="dot" style="--c:${esc(s.color)};width:12px;height:12px"></span><h2 class="grow">${esc(s.name)}</h2>${s.archived ? '<span class="pill">Terminada</span>' : ''}</div>
    <div class="grid g2" style="margin-top:12px;gap:8px">
      <div><div class="faint tiny">Total estudiado</div><div class="num" style="font-weight:600">${fmtMin(mins)}</div></div>
      <div><div class="faint tiny">Esta semana</div><div class="num" style="font-weight:600">${fmtMin(week)}${s.goalHours ? ` <span class="faint tiny">/ ${s.goalHours}h</span>` : ''}</div></div>
      <div><div class="faint tiny">Temas dominados</div><div class="num" style="font-weight:600">${dom} / ${topics.length}</div></div>
      <div><div class="faint tiny">Tareas pendientes</div><div class="num" style="font-weight:600">${pend}</div></div>
    </div>
    ${s.goalHours ? `<div class="bar" style="--c:${esc(s.color)}"><i style="width:${Math.min(100, Math.round((week / 60 / s.goalHours) * 100))}%"></i></div>` : ''}
  </div>`;
}

function renderList(el) {
  const active = state.subjects.filter((s) => !s.archived);
  const archived = state.subjects.filter((s) => s.archived);
  const weekMin = sum(state.studySessions.filter((x) => weekKey(new Date(x.date + 'T00:00')) === weekKey(new Date())), (x) => x.minutes);
  el.innerHTML = `
  <div class="page-head"><div><div class="sub">${fmtMin(weekMin)} estudiados esta semana</div><h1>Estudio</h1></div>
    <div class="head-actions"><button class="btn" data-start>${icon('player-play', 16)} Iniciar estudio</button><button class="btn primary" data-newsub>${icon('plus', 16)} Materia</button></div></div>
  ${active.length ? `<div class="grid g-auto" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${active.map(subjectCard).join('')}</div>` : `<div class="card">${emptyState('school', 'Agrega las materias que estás viendo este semestre.', `<button class="btn primary" data-newsub>${icon('plus', 16)} Agregar materia</button>`)}</div>`}
  ${archived.length ? `<h2 style="margin-top:8px">Materias terminadas</h2><div class="grid g-auto" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${archived.map(subjectCard).join('')}</div>` : ''}`;
  el.onclick = (e) => {
    const t = e.target.closest('[data-open],[data-newsub],[data-start]');
    if (!t) return;
    if (t.dataset.open) window.go('estudio', t.dataset.open);
    else if ('newsub' in t.dataset) subjectDialog();
    else startDialog();
  };
}

function renderSubject(el, s) {
  destroyCharts();
  const area = { key: 'sub:' + s.id, name: s.name, color: s.color, icon: 'book' };
  const sessions = state.studySessions.filter((x) => x.subjectId === s.id).sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')));
  const topics = state.topics.filter((t) => t.subjectId === s.id);
  const total = sum(sessions, (x) => x.minutes);
  const exs = state.exercises.filter((x) => x.subjectId === s.id);
  const tasks = state.tasks.filter((t) => t.subjectId === s.id).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9').localeCompare(b.due || '9'));
  const minsByTopic = (tid) => sum(sessions.filter((x) => x.topicId === tid), (x) => x.minutes);

  let body = '';
  if (tab === 'temas') {
    body = topics.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Tema</th><th>Estado</th><th class="n">Estudiado</th><th class="n">Ejercicios</th><th class="n">Promedio</th><th class="n">Mejora</th><th class="n">Acierto</th></tr></thead><tbody>
      ${topics.map((t) => { const st = topicStats(t.id); const S = STATUS[t.status] || STATUS.pendiente; return `<tr class="click" data-topic="${esc(t.id)}"><td><b style="font-weight:500">${esc(t.name)}</b>${t.examDate ? `<div class="tiny faint">Examen ${esc(fmtDate(t.examDate))}</div>` : ''}</td><td><button class="pill ${S.c}" data-cycle="${esc(t.id)}" style="border:0;cursor:pointer">${S.l}</button></td><td class="n">${fmtMin(minsByTopic(t.id))}</td><td class="n">${st.n || 0}</td><td class="n">${st.n ? fmtSec(st.avg) : '—'}</td><td class="n ${st.improve > 0 ? 'up' : st.improve < 0 ? 'down' : ''}">${st.improve === null || st.improve === undefined ? '—' : (st.improve > 0 ? '+' : '') + st.improve + '%'}</td><td class="n">${st.n ? st.acc + '%' : '—'}</td></tr>`; }).join('')}
      </tbody></table></div>` : emptyState('list-details', 'Agrega los temas que estás viendo en esta materia.', `<button class="btn primary" data-newtopic>${icon('plus', 16)} Tema</button>`);
  } else if (tab === 'sesiones') {
    body = sessions.length ? `<div class="list">${sessions.slice(0, 80).map((x) => `<div class="row click" data-ses="${esc(x.id)}"><span class="time" style="width:64px">${esc(fmtDate(x.date))}</span><div class="grow"><div class="title">${esc(topicName(x.topicId) || 'Estudio general')}</div>${x.note ? `<div class="meta">${esc(x.note)}</div>` : ''}</div><span class="num">${fmtMin(x.minutes)}</span></div>`).join('')}</div>` : emptyState('stopwatch', 'Aún no hay sesiones. Usa el cronómetro o regístralas a mano.');
  } else if (tab === 'eficiencia') {
    const withEx = topics.filter((t) => exs.some((x) => x.topicId === t.id));
    if (!effTopic || !withEx.some((t) => t.id === effTopic)) effTopic = withEx[0]?.id || '';
    body = exs.length ? `<div class="split"><select data-efftopic style="width:auto;min-width:220px">${withEx.map((t) => `<option value="${esc(t.id)}" ${t.id === effTopic ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}${exs.some((x) => !x.topicId) ? `<option value="" ${!effTopic ? 'selected' : ''}>Sin tema</option>` : ''}</select><span class="muted small">Tiempo por ejercicio (más bajo es mejor)</span></div>
      <div class="chart" style="margin-top:10px"><canvas data-effchart></canvas></div>
      <div class="list" style="margin-top:10px">${exs.filter((x) => (x.topicId || '') === effTopic).sort((a, b) => b.ts - a.ts).slice(0, 30).map((x) => `<div class="row click" data-exe="${esc(x.id)}"><span class="time" style="width:64px">${esc(fmtDate(x.date))}</span><div class="grow">${['', 'Fácil', 'Media', 'Difícil'][x.difficulty] || ''}</div><span class="pill ${x.correct ? 'ok' : 'bad'}">${x.correct ? 'Bien' : 'Error'}</span><span class="num" style="width:60px;text-align:right">${fmtSec(x.seconds)}</span></div>`).join('')}</div>`
      : emptyState('stopwatch', 'Mide cuánto tardas en cada ejercicio y verás cómo mejoras con la práctica.', `<button class="btn primary" data-extimer>${icon('stopwatch', 16)} Cronómetro de ejercicios</button>`);
  } else if (tab === 'tareas') {
    body = tasks.length ? `<div class="list">${tasks.map((t) => `<div class="row ${t.done ? 'done' : ''}"><button class="chk ${t.done ? 'on' : ''}" data-toggle="${esc(t.id)}">${icon('check', 14)}</button><div class="grow" data-edittask="${esc(t.id)}" style="cursor:pointer"><div class="title">${esc(t.title)}</div><div class="meta">${t.due ? esc(fmtDate(t.due)) + (t.dueTime ? ' · ' + esc(t.dueTime) : '') : 'Sin fecha'}</div></div></div>`).join('')}</div>` : emptyState('checklist', 'Sin tareas en esta materia.');
  } else {
    body = notesBlock(s.id);
  }

  el.innerHTML = `
  <div class="page-head"><div><button class="btn ghost sm" data-back style="margin-left:-10px">${icon('arrow-left', 16)} Materias</button><h1 style="display:flex;align-items:center;gap:10px"><span class="dot" style="--c:${esc(s.color)};width:14px;height:14px"></span>${esc(s.name)}</h1>${s.teacher ? `<div class="sub" style="margin-top:2px">${esc(s.teacher)}</div>` : ''}</div>
    <div class="head-actions"><button class="btn primary" data-timer>${icon('player-play', 16)} Estudiar</button><button class="btn" data-extimer>${icon('stopwatch', 16)} Ejercicios</button><button class="btn icon" data-editsub aria-label="Editar materia">${icon('edit')}</button></div></div>
  <div class="grid g-side">
    <div class="grid" style="align-content:start">${levelCard(area)}
      <div class="card" style="padding:14px 16px">
        <div class="kv"><span class="muted">Total estudiado</span><span>${fmtMin(total)}</span></div>
        <div class="kv"><span class="muted">Racha</span><span>${studyStreak(s.id)} ${studyStreak(s.id) === 1 ? 'día' : 'días'}</span></div>
        <div class="kv"><span class="muted">Ejercicios</span><span>${exs.length}</span></div>
        <div class="kv"><span class="muted">Acierto</span><span>${exs.length ? Math.round((exs.filter((x) => x.correct).length / exs.length) * 100) + '%' : '—'}</span></div>
        ${(s.schedule || []).length ? `<div style="margin-top:10px" class="small">${s.schedule.map((c) => `<div class="muted">${DAYS[c.day]} ${esc(c.start)}–${esc(c.end)}${c.room ? ' · ' + esc(c.room) : ''}</div>`).join('')}</div>` : ''}
      </div>
      <div class="split"><button class="btn sm" data-bonus>${icon('plus', 14)} XP</button><button class="btn sm danger" data-fail>${icon('minus', 14)} Registrar fallo</button></div>
    </div>
    <div class="card">
      <div class="card-head" style="flex-wrap:wrap"><div class="tabs">${[['temas', 'Temas'], ['sesiones', 'Sesiones'], ['eficiencia', 'Eficiencia'], ['tareas', 'Tareas'], ['apuntes', 'Apuntes']].map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="head-actions">${tab === 'temas' ? `<button class="btn sm" data-newtopic>${icon('plus', 14)} Tema</button>` : tab === 'sesiones' ? `<button class="btn sm" data-newses>${icon('plus', 14)} Sesión</button>` : tab === 'eficiencia' ? `<button class="btn sm" data-newex>${icon('plus', 14)} Manual</button>` : tab === 'tareas' ? `<button class="btn sm" data-newtask>${icon('plus', 14)} Tarea</button>` : ''}</div></div>
      ${body}
    </div>
  </div>`;

  if (tab === 'eficiencia' && exs.length) {
    const list = exs.filter((x) => (x.topicId || '') === effTopic).sort((a, b) => a.ts - b.ts);
    const moving = list.map((_, i) => { const w = list.slice(Math.max(0, i - 2), i + 1); return Math.round(sum(w, (x) => x.seconds) / w.length); });
    chart(el.querySelector('[data-effchart]'), {
      kind: 'line', labels: list.map((x, i) => `#${i + 1} · ${fmtDate(x.date)}`),
      series: [
        { label: 'Tiempo del ejercicio', data: list.map((x) => x.seconds), color: s.color },
        { label: 'Tendencia (promedio de 3)', data: moving, color: 'var(--ink-3)', dashed: true },
      ],
      yFmt: (v) => fmtSec(v), min: 0,
    });
  }
  if (tab === 'apuntes') bindNotesBlock(el, s.id);

  el.onclick = (e) => {
    const t = e.target.closest('button,[data-topic],[data-ses],[data-exe],[data-edittask]');
    if (!t) return;
    const d = t.dataset;
    if ('back' in d) window.go('estudio');
    else if ('timer' in d) startDialog(s.id);
    else if ('extimer' in d) exerciseTimer(s.id, effTopic);
    else if ('editsub' in d) subjectDialog(s);
    else if ('fail' in d) failDialog('sub:' + s.id);
    else if ('bonus' in d) bonusDialog('sub:' + s.id);
    else if (d.tab) { tab = d.tab; renderSubject(el, s); }
    else if ('newtopic' in d) topicDialog(s.id);
    else if ('newses' in d) sessionDialog(s.id);
    else if ('newex' in d) exerciseManual(s.id);
    else if ('newtask' in d) taskDialog(null, { subjectId: s.id, category: 'estudio' });
    else if (d.cycle) { const tp = find('topics', d.cycle); const order = ['pendiente', 'curso', 'dominado']; tp.status = order[(order.indexOf(tp.status || 'pendiente') + 1) % 3]; if (tp.status === 'dominado') sound('complete'); commit(); }
    else if (d.topic) topicDialog(s.id, find('topics', d.topic));
    else if (d.ses) sessionDialog(s.id, find('studySessions', d.ses));
    else if (d.exe) exerciseManual(s.id, find('exercises', d.exe));
    else if (d.toggle) toggleTask(d.toggle);
    else if (d.edittask) taskDialog(find('tasks', d.edittask));
  };
  el.onchange = (e) => { if (e.target.matches('[data-efftopic]')) { effTopic = e.target.value; renderSubject(el, s); } };
}

export function render(el, params) {
  const s = params[0] && find('subjects', params[0]);
  if (s) renderSubject(el, s);
  else { tab = 'temas'; renderList(el); }
}

