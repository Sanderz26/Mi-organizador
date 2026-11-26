// Calendario: mes, agenda del día, eventos, cumpleaños, horario de la U y festivos
import { state, commit, upsert, remove, find } from '../store.js';
import { icon } from '../icons.js';
import { esc, toKey, todayKey, parseKey, addDays, weekStart, MONTHS, DAYS_SHORT, fmtDateLong, formModal, emptyState, cap } from '../util.js';
import { agendaFor, EVENT_TYPES } from '../agenda.js';
import { holidaysFor } from '../holidays.js';
import { REMINDER_OPTIONS, parseReminder } from '../components.js';
import { taskDialog } from './tasks.js';
import { sound } from '../sound.js';

let cursor = new Date();
let selected = todayKey();

export async function eventDialog(ev = null, preset = {}) {
  const e = ev || { type: 'evento', date: selected, reminderMins: state.settings.defaultReminderMins, repeat: '', ...preset };
  const isBday = (e.type || preset.type) === 'cumpleanos';
  const v = await formModal({
    title: ev ? 'Editar' : isBday ? 'Nuevo cumpleaños' : 'Nuevo evento',
    deleteLabel: ev ? 'Eliminar' : null,
    fields: [
      { name: 'type', label: 'Tipo', type: 'select', value: e.type, options: Object.entries(EVENT_TYPES).map(([v, t]) => ({ v, l: t.label })) },
      { name: 'title', label: isBday ? 'Nombre de la persona' : 'Título', type: 'text', value: e.title, required: true, placeholder: isBday ? 'Mamá' : 'Reunión con el grupo de proyecto' },
      { name: 'date', label: 'Fecha', type: 'date', value: e.date, required: true },
      { name: 'time', label: 'Hora (opcional)', type: 'time', value: e.time || '' },
      { name: 'endTime', label: 'Hasta (opcional)', type: 'time', value: e.endTime || '' },
      { name: 'repeat', label: 'Repetir', type: 'select', value: isBday && !ev ? 'yearly' : e.repeat || '', options: [{ v: '', l: 'No se repite' }, { v: 'weekly', l: 'Cada semana' }, { v: 'monthly', l: 'Cada mes' }, { v: 'yearly', l: 'Cada año' }] },
      { name: 'reminderMins', label: 'Avisarme', type: 'select', value: e.reminderMins ?? '', options: REMINDER_OPTIONS },
      { name: 'place', label: 'Lugar o enlace', type: 'text', value: e.place || '' },
      { name: 'birthYear', label: 'Año de nacimiento (cumpleaños, opcional)', type: 'number', value: e.birthYear || '', step: 1 },
      { name: 'notes', label: 'Notas', type: 'textarea', value: e.notes || '' },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('events', ev.id); sound('delete'); commit(); return; }
  upsert('events', { ...(ev || {}), ...v, reminderMins: parseReminder(v.reminderMins) });
  sound('complete');
  commit();
}

function monthGrid() {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = weekStart(new Date(y, m, 1));
  const today = todayKey();
  const hol = Object.fromEntries([...holidaysFor(y - 1), ...holidaysFor(y), ...holidaysFor(y + 1)].map((h) => [h.date, h.name]));
  const cells = [];
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const total = Math.ceil((offset + daysInMonth) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const d = addDays(first, i);
    const k = toKey(d);
    const items = agendaFor(k).filter((x) => x.kind !== 'holiday');
    const show = items.slice(0, 3);
    cells.push(`<div class="day ${d.getMonth() !== m ? 'other' : ''} ${k === today ? 'today' : ''} ${k === selected ? 'sel' : ''} ${hol[k] ? 'holi' : ''} ${items.length ? 'has' : ''}" data-day="${k}" title="${esc(hol[k] || '')}">
      <span class="dn">${d.getDate()}</span>
      ${hol[k] ? `<span class="ev" style="--c:var(--bad)">${esc(hol[k])}</span>` : ''}
      ${show.map((x) => `<span class="ev" style="--c:${x.color}" title="${esc((x.time ? x.time + ' ' : '') + x.title)}">${esc(x.short || x.title)}</span>`).join('')}
      ${items.length > 3 ? `<span class="more">+${items.length - 3} más</span>` : ''}
    </div>`);
  }
  return `<div class="cal">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="dow">${DAYS_SHORT[d]}</div>`).join('')}${cells.join('')}</div>`;
}

export function render(el) {
  const items = agendaFor(selected);
  const upcomingB = state.events.filter((e) => e.type === 'cumpleanos').map((e) => {
    const d = parseKey(e.date); const now = new Date();
    let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
    if (toKey(next) < todayKey()) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
    return { e, next: toKey(next) };
  }).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 5);

  el.innerHTML = `
  <div class="page-head"><div><div class="sub">Agenda</div><h1>${cap(MONTHS[cursor.getMonth()])} ${cursor.getFullYear()}</h1></div>
    <div class="head-actions">
      <button class="btn icon" data-nav="-1" aria-label="Mes anterior">${icon('chevron-left')}</button>
      <button class="btn" data-nav="0">Hoy</button>
      <button class="btn icon" data-nav="1" aria-label="Mes siguiente">${icon('chevron-right')}</button>
      <button class="btn primary" data-newev>${icon('plus', 16)} Evento</button>
    </div></div>
  <div class="grid g-main">
    <div class="card" style="padding:12px">${monthGrid()}</div>
    <div class="grid" style="align-content:start">
      <div class="card">
        <div class="card-head"><h2>${esc(fmtDateLong(selected))}</h2></div>
        ${items.length ? `<div class="list">${items.map((a) => `<div class="row ${a.kind === 'event' || a.kind === 'task' ? 'click' : ''} ${a.done ? 'done' : ''}" ${a.kind === 'event' ? `data-ev="${esc(a.id)}"` : a.kind === 'task' ? `data-task="${esc(a.id)}"` : ''}>
          <span class="time">${esc(a.time || '—')}</span><span class="dot" style="--c:${a.color}"></span>
          <div class="grow"><div class="title">${esc(a.title)}</div>${a.sub ? `<div class="meta">${esc(a.sub)}${a.end ? ' · hasta ' + esc(a.end) : ''}</div>` : ''}</div></div>`).join('')}</div>` : emptyState('calendar-event', 'Día libre.')}
        <div class="split" style="margin-top:12px">
          <button class="btn sm" data-newev>${icon('calendar-event', 15)} Evento</button>
          <button class="btn sm" data-newb>${icon('cake', 15)} Cumpleaños</button>
          <button class="btn sm" data-newt>${icon('checklist', 15)} Tarea</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('cake', 17)} Próximos cumpleaños</h2></div>
        ${upcomingB.length ? `<div class="list">${upcomingB.map(({ e, next }) => `<div class="row click" data-ev="${esc(e.id)}"><span class="dot" style="--c:#c2417a"></span><div class="grow"><div class="title">${esc(e.title)}</div><div class="meta">${esc(fmtDateLong(next))}</div></div></div>`).join('')}</div>` : '<p class="muted small">Agrega cumpleaños y te aviso con tiempo.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('flag', 17)} Festivos ${cursor.getFullYear()}</h2></div>
        <div class="list">${holidaysFor(cursor.getFullYear()).filter((h) => h.date >= toKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1))).slice(0, 6).map((h) => `<div class="row"><span class="time" style="width:70px">${esc(h.date.slice(8))} ${esc(MONTHS[Number(h.date.slice(5, 7)) - 1].slice(0, 3))}</span><div class="grow">${esc(h.name)}</div></div>`).join('') || '<p class="muted small">No quedan festivos este año.</p>'}</div>
      </div>
    </div>
  </div>`;

  el.onclick = (e) => {
    const t = e.target.closest('[data-day],[data-nav],[data-newev],[data-newb],[data-newt],[data-ev],[data-task]');
    if (!t) return;
    if (t.dataset.day) { selected = t.dataset.day; const d = parseKey(selected); if (d.getMonth() !== cursor.getMonth()) cursor = new Date(d.getFullYear(), d.getMonth(), 1); render(el); }
    else if (t.dataset.nav !== undefined) {
      const n = Number(t.dataset.nav);
      if (n === 0) { cursor = new Date(); selected = todayKey(); } else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
      render(el);
    } else if ('newev' in t.dataset) eventDialog(null, { date: selected });
    else if ('newb' in t.dataset) eventDialog(null, { date: selected, type: 'cumpleanos', reminderMins: 1440 });
    else if ('newt' in t.dataset) taskDialog(null, { due: selected });
    else if (t.dataset.ev) eventDialog(find('events', t.dataset.ev));
    else if (t.dataset.task) taskDialog(find('tasks', t.dataset.task));
  };
}
