// Progreso: niveles, experiencia en el tiempo y gráficas de todas las áreas
import { state, commit, subjectName, topicName } from '../store.js';
import { icon } from '../icons.js';
import { esc, fmtDate, sum, addDays, weekKey, parseKey, emptyState, confirmModal } from '../util.js';
import { levelGrid, failDialog, bonusDialog } from '../components.js';
import { areaList, xpSeries, areaName, levelInfo, xpOf } from '../xp.js';
import { chart, destroyCharts } from '../charts.js';
import { topicStats } from './study.js';
import { sound } from '../sound.js';

let range = 90;

export function render(el) {
  destroyCharts();
  const areas = areaList().sort((a, b) => xpOf(b.key) - xpOf(a.key));
  const totalXp = sum(areas, (a) => xpOf(a.key));
  const log = state.xpLog.slice().sort((a, b) => b.ts - a.ts).slice(0, 40);

  // horas de estudio por semana y materia (12 semanas)
  const weeks = [];
  for (let i = 11; i >= 0; i--) weeks.push(weekKey(addDays(new Date(), -7 * i)));
  const subs = state.subjects.filter((s) => !s.archived);

  // eficiencia por tema
  const eff = state.topics.map((t) => ({ t, st: topicStats(t.id) })).filter((x) => x.st.n >= 4).sort((a, b) => b.st.improve - a.st.improve).slice(0, 10);

  // tareas completadas por semana
  const tasksDone = weeks.map((w) => state.tasks.filter((t) => t.done && t.doneAt && weekKey(parseKey(t.doneAt)) === w).length);

  el.innerHTML = `
  <div class="page-head"><div><div class="sub">${totalXp.toLocaleString('es-CO')} XP en total</div><h1>Progreso</h1></div>
    <div class="head-actions"><button class="btn" data-bonus>${icon('plus', 16)} Sumar XP</button><button class="btn danger" data-fail>${icon('minus', 16)} Registrar fallo</button></div></div>
  ${levelGrid()}
  <div class="card">
    <div class="card-head" style="flex-wrap:wrap"><h2>Experiencia acumulada</h2><div class="tabs">${[[30, '30 días'], [90, '3 meses'], [365, '1 año']].map(([d, l]) => `<button class="tab ${range === d ? 'active' : ''}" data-range="${d}">${l}</button>`).join('')}</div></div>
    <div class="chart"><canvas data-xp></canvas></div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>Horas de estudio por semana</h2></div>${subs.length ? '<div class="chart"><canvas data-study></canvas></div>' : '<p class="muted small">Agrega materias para ver tus horas.</p>'}</div>
    <div class="card"><div class="card-head"><h2>Mejora de eficiencia por tema</h2></div>${eff.length ? '<div class="chart"><canvas data-eff></canvas></div><p class="tiny faint" style="margin-top:6px">Cuánto bajó tu tiempo por ejercicio entre tus primeros y tus últimos intentos.</p>' : '<p class="muted small">Registra al menos 4 ejercicios en un tema para ver tu mejora.</p>'}</div>
    <div class="card"><div class="card-head"><h2>Tareas completadas por semana</h2></div><div class="chart sm"><canvas data-tasks></canvas></div></div>
    <div class="card"><div class="card-head"><h2>Nivel por área</h2></div><div class="chart sm"><canvas data-levels></canvas></div></div>
  </div>
  <div class="card"><div class="card-head"><h2>Historial de experiencia</h2></div>
    ${log.length ? `<div class="list">${log.map((e) => `<div class="row"><span class="time" style="width:64px">${esc(fmtDate(e.date))}</span><div class="grow"><div class="title">${esc(e.reason || '')}</div><div class="meta">${esc(areaName(e.area))}</div></div><span class="num ${e.amount >= 0 ? 'up' : 'down'}" style="font-weight:600">${e.amount > 0 ? '+' : ''}${e.amount} XP</span>${!e.ref ? `<button class="btn ghost icon sm" data-undo="${esc(e.id)}" aria-label="Deshacer">${icon('x', 14)}</button>` : ''}</div>`).join('')}</div>` : emptyState('star', 'Tu experiencia aparecerá aquí cuando empieces a registrar actividades.')}
  </div>`;

  // XP en el tiempo
  const series = areas.map((a) => ({ a, s: xpSeries(a.key, range) }));
  let from = series.length ? Math.min(...series.map(({ s }) => { const i = s.values.findIndex((v) => v > 0); return i < 0 ? Infinity : i; })) : 0;
  from = Number.isFinite(from) ? Math.max(0, Math.min(from - 1, series[0].s.labels.length - 7)) : 0;
  if (series.length) chart(el.querySelector('[data-xp]'), {
    kind: 'line', labels: series[0].s.labels.slice(from).map(fmtDate),
    series: series.map(({ a, s }) => ({ label: a.name, data: s.values.slice(from), color: a.color })),
    min: 0, pick: 'xp',
  });
  if (subs.length) chart(el.querySelector('[data-study]'), {
    kind: 'bar', stacked: true, labels: weeks.map(fmtDate),
    series: subs.map((s) => ({ label: s.name, color: s.color, data: weeks.map((w) => Math.round((sum(state.studySessions.filter((x) => x.subjectId === s.id && weekKey(parseKey(x.date)) === w), (x) => x.minutes) / 60) * 10) / 10) })),
    yFmt: (v) => v + ' h', pick: 'horas-estudio',
  });
  if (eff.length) chart(el.querySelector('[data-eff]'), {
    kind: 'bar', labels: eff.map((x) => `${topicName(x.t.id)} · ${subjectName(x.t.subjectId)}`.slice(0, 28)),
    series: [{ label: 'Mejora', data: eff.map((x) => x.st.improve), color: 'var(--c-study)' }],
    yFmt: (v) => v + '%', legend: false,
  });
  chart(el.querySelector('[data-tasks]'), { kind: 'bar', labels: weeks.map(fmtDate), series: [{ label: 'Tareas', data: tasksDone, color: 'var(--accent)' }], legend: false, min: 0 });
  chart(el.querySelector('[data-levels]'), { kind: 'bar', labels: areas.map((a) => a.name.slice(0, 16)), series: areas.map((a) => ({ label: a.name, data: areas.map((b) => (b.key === a.key ? levelInfo(xpOf(a.key)).level : null)), color: a.color })), stacked: true, min: 0, pick: 'niveles', defaultVisible: 8 });

  el.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.range) { range = Number(t.dataset.range); render(el); }
    else if ('fail' in t.dataset) failDialog();
    else if ('bonus' in t.dataset) bonusDialog();
    else if (t.dataset.undo) {
      if (!(await confirmModal('¿Deshacer este movimiento de experiencia?', 'Deshacer'))) return;
      state.xpLog = state.xpLog.filter((x) => x.id !== t.dataset.undo);
      sound('delete'); commit();
    }
  };
}
