// Inicio: resumen del día
import { state, commit } from '../store.js';
import { icon } from '../icons.js';
import { esc, todayKey, fmtDateLong, fmtDate, fmtMin, fmtMoney, sum, relDay, emptyState } from '../util.js';
import { agendaFor } from '../agenda.js';
import { nextHoliday } from '../holidays.js';
import { levelGrid } from '../components.js';
import { toggleTask, taskDialog } from './tasks.js';
import { startDialog } from './study.js';
import { mealDialog } from './diet.js';
import { monthSummary } from './business.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export function render(el) {
  const today = todayKey();
  const s = state.settings;
  const agenda = agendaFor(today).filter((x) => x.kind !== 'task');
  const pending = state.tasks.filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 6);
  const kcal = sum(state.meals.filter((m) => m.date === today), (m) => m.kcal);
  const pct = s.calorieGoal ? Math.min(100, Math.round((kcal / s.calorieGoal) * 100)) : 0;
  const studyToday = sum(state.studySessions.filter((x) => x.date === today), (x) => x.minutes);
  const hol = nextHoliday(today);
  const biz = monthSummary(new Date());

  el.innerHTML = `
  <div class="page-head">
    <div><div class="sub">${esc(fmtDateLong(today))}</div><h1>${greeting()}${s.name ? ', ' + esc(s.name) : ''}</h1></div>
    <div class="head-actions">
      ${hol ? `<span class="pill">${icon('flag', 13)} Próximo festivo: ${esc(fmtDate(hol.date))} · ${esc(hol.name)}</span>` : ''}
    </div>
  </div>

  ${state.subjects.length ? '' : `<div class="card split"><div class="grow"><h2>Empieza por tus materias</h2><p class="muted small" style="margin-top:4px">Agrega las materias que estás viendo con su horario. Desde ahí registras temas, horas de estudio y tu eficiencia.</p></div><button class="btn primary" data-go="estudio">${icon('plus', 16)} Agregar materias</button></div>`}

  ${levelGrid()}

  <div class="grid g-main">
    <div class="card">
      <div class="card-head"><h2>${icon('calendar', 18)} Agenda de hoy</h2><button class="btn ghost sm" data-go="calendario">Ver calendario</button></div>
      ${agenda.length ? `<div class="list">${agenda.map((a) => `<div class="row"><span class="time">${esc(a.time || '—')}</span><span class="dot" style="--c:${a.color}"></span><div class="grow"><div class="title">${esc(a.title)}</div>${a.sub ? `<div class="meta">${esc(a.sub)}${a.end ? ` · hasta ${esc(a.end)}` : ''}</div>` : ''}</div></div>`).join('')}</div>` : emptyState('calendar', 'No tienes nada agendado para hoy.')}
    </div>
    <div class="grid" style="align-content:start">
      <div class="card">
        <div class="card-head"><h2>${icon('salad', 18)} Calorías</h2><button class="btn sm" data-meal>${icon('plus', 15)} Comida</button></div>
        <div class="split"><div class="grow"><div class="num" style="font-size:26px;font-weight:600">${kcal.toLocaleString('es-CO')}</div><div class="muted small">de ${Number(s.calorieGoal).toLocaleString('es-CO')} kcal</div></div><span class="pill ${state.dietDays[today] === 'ok' ? 'ok' : state.dietDays[today] === 'fail' ? 'bad' : ''}">${state.dietDays[today] === 'ok' ? 'Día cumplido' : state.dietDays[today] === 'fail' ? 'No cumplido' : 'Día abierto'}</span></div>
        <div class="bar" style="--c:var(--c-diet);height:8px"><i style="width:${pct}%"></i></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('stopwatch', 18)} Estudio hoy</h2>${state.activeTimer ? '<span class="pill acc">En curso</span>' : `<button class="btn primary sm" data-study>${icon('player-play', 15)} Iniciar</button>`}</div>
        <div class="num" style="font-size:26px;font-weight:600">${fmtMin(studyToday)}</div>
        <div class="muted small">${state.studySessions.filter((x) => x.date === today).length} sesiones registradas</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('printer', 18)} Negocio este mes</h2><button class="btn ghost sm" data-go="negocio">Abrir</button></div>
        <div class="num" style="font-size:24px;font-weight:600">${fmtMoney(biz.profit)}</div>
        <div class="muted small">Ganancia neta · ${biz.orders} pedidos · ${fmtMoney(biz.income)} en ventas</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>${icon('checklist', 18)} Tareas pendientes</h2><div class="head-actions"><button class="btn sm" data-addtask>${icon('plus', 15)} Tarea</button><button class="btn ghost sm" data-go="tareas">Ver todas</button></div></div>
    ${pending.length ? `<div class="list">${pending.map((t) => `<div class="row"><button class="chk" data-toggle="${esc(t.id)}" aria-label="Completar">${icon('check', 14)}</button><div class="grow"><div class="title">${esc(t.title)}</div><div class="meta">${t.due ? `<span class="${t.due < today ? 'down' : ''}">${esc(relDay(t.due))}${t.dueTime ? ' · ' + esc(t.dueTime) : ''}</span>` : '<span>Sin fecha</span>'}${t.subjectId ? `<span>${esc(state.subjects.find((x) => x.id === t.subjectId)?.name || '')}</span>` : ''}</div></div></div>`).join('')}</div>` : emptyState('circle-check', 'Sin tareas pendientes. Buen trabajo.')}
  </div>`;

  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.go) window.go(b.dataset.go);
    else if (b.dataset.toggle) toggleTask(b.dataset.toggle);
    else if ('addtask' in b.dataset) taskDialog();
    else if ('study' in b.dataset) startDialog();
    else if ('meal' in b.dataset) mealDialog();
  };
  void commit;
}
