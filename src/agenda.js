// Agenda unificada: eventos, cumpleaños, clases, tareas, gimnasio y festivos
import { state, subjectRunsOn } from './store.js';
import { holidayMap } from './holidays.js';
import { parseKey, toKey, addDays, dateTime } from './util.js';

export const EVENT_TYPES = {
  evento: { label: 'Evento', color: 'var(--c-cal)', icon: 'calendar-event' },
  reunion: { label: 'Reunión', color: 'var(--accent)', icon: 'users' },
  cumpleanos: { label: 'Cumpleaños', color: '#c2417a', icon: 'cake' },
  fecha: { label: 'Fecha importante', color: 'var(--warn)', icon: 'star' },
  examen: { label: 'Examen', color: 'var(--bad)', icon: 'school' },
};

/** ¿El evento ocurre en esa fecha? (repetición: none, weekly, monthly, yearly) */
export function occursOn(ev, key) {
  if (key < ev.date && ev.repeat !== 'yearly') return false;
  if (ev.until && key > ev.until) return false;
  const d = parseKey(key), s = parseKey(ev.date);
  switch (ev.repeat) {
    case 'weekly': return d.getDay() === s.getDay() && key >= ev.date;
    case 'monthly': return d.getDate() === s.getDate() && key >= ev.date;
    case 'yearly': return d.getDate() === s.getDate() && d.getMonth() === s.getMonth() && d.getFullYear() >= s.getFullYear();
    default: return key === ev.date;
  }
}

/** Todo lo que pasa en un día, ordenado por hora */
export function agendaFor(key, { includeClasses = true } = {}) {
  const d = parseKey(key);
  const items = [];
  const hol = holidayMap(d.getFullYear())[key];
  if (hol) items.push({ kind: 'holiday', title: hol, time: '', color: 'var(--bad)', icon: 'flag' });
  for (const ev of state.events) {
    if (!occursOn(ev, key)) continue;
    const t = EVENT_TYPES[ev.type] || EVENT_TYPES.evento;
    let title = ev.title;
    if (ev.type === 'cumpleanos') {
      const age = ev.birthYear ? d.getFullYear() - Number(ev.birthYear) : null;
      title = `Cumpleaños de ${ev.title}${age && age > 0 ? ` (${age})` : ''}`;
    }
    items.push({ kind: 'event', id: ev.id, title, short: ev.type === 'cumpleanos' ? ev.title : title, time: ev.time || '', end: ev.endTime || '', color: t.color, icon: t.icon, sub: ev.place || t.label, ref: ev });
  }
  if (includeClasses && !hol) {
    for (const s of state.subjects) {
      if (!subjectRunsOn(s, key)) continue;
      for (const c of s.schedule || []) {
        if (Number(c.day) === d.getDay()) items.push({ kind: 'class', id: s.id, title: `Clase · ${s.name}`, short: s.name, time: c.start, end: c.end, color: s.color, icon: 'school', sub: c.room || '' });
      }
    }
  }
  for (const t of state.tasks) {
    if (t.due === key) items.push({ kind: 'task', id: t.id, title: t.title, time: t.dueTime || '', color: t.done ? 'var(--ink-3)' : 'var(--accent)', icon: 'checklist', done: t.done, sub: t.done ? 'Completada' : 'Tarea', ref: t });
  }
  for (const g of state.gymSessions) {
    if (g.date === key) items.push({ kind: 'gym', id: g.id, title: `Gimnasio · ${g.muscle || 'Entreno'}`, short: `Gym · ${g.muscle || ''}`, time: g.start || '', end: g.end || '', color: 'var(--c-gym)', icon: 'barbell', sub: `${(g.exercises || []).length} ejercicios` });
  }
  return items.sort((a, b) => (a.kind === 'holiday' ? -1 : b.kind === 'holiday' ? 1 : (a.time || '99').localeCompare(b.time || '99')));
}

/** Recordatorios de los próximos días (para notificaciones) */
export function upcomingReminders(days = 45) {
  const out = [];
  const now = new Date();
  const s = state.settings;
  for (const t of state.tasks) {
    if (t.done || !t.due || t.reminderMins === null || t.reminderMins === undefined || t.reminderMins < 0) continue;
    const at = dateTime(t.due, t.dueTime || '08:00').getTime() - t.reminderMins * 60000;
    out.push({ key: 'task:' + t.id + ':' + at, at, title: t.title, body: t.dueTime ? `Tarea para las ${t.dueTime}` : 'Tarea para hoy' });
  }
  for (let i = 0; i < days; i++) {
    const key = toKey(addDays(now, i));
    const hol = holidayMap(Number(key.slice(0, 4)))[key];
    if (hol && i < 8) out.push({ key: 'hol:' + key, at: dateTime(key, '08:00').getTime() - 24 * 3600e3, title: 'Mañana es festivo', body: hol });
    for (const ev of state.events) {
      if (!occursOn(ev, key) || ev.reminderMins === null || ev.reminderMins === undefined || ev.reminderMins < 0) continue;
      const base = dateTime(key, ev.time || '08:00').getTime();
      const t = EVENT_TYPES[ev.type] || EVENT_TYPES.evento;
      const title = ev.type === 'cumpleanos' ? `Cumpleaños de ${ev.title}` : ev.title;
      out.push({ key: 'ev:' + ev.id + ':' + key, at: base - ev.reminderMins * 60000, title, body: `${t.label}${ev.time ? ' · ' + ev.time : ''}${ev.place ? ' · ' + ev.place : ''}` });
    }
    if (s.classReminderMins > 0 && !hol && i < 14) {
      const wd = addDays(now, i).getDay();
      for (const sub of state.subjects) {
        if (!subjectRunsOn(sub, key)) continue;
        for (const c of sub.schedule || []) {
          if (Number(c.day) !== wd || !c.start) continue;
          out.push({ key: `cls:${sub.id}:${key}:${c.start}`, at: dateTime(key, c.start).getTime() - s.classReminderMins * 60000, title: `Clase de ${sub.name}`, body: `A las ${c.start}${c.room ? ' · ' + c.room : ''}` });
        }
      }
    }
  }
  return out.map((r) => ({ ...r, nid: hash(r.key) })).sort((a, b) => a.at - b.at);
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000 + 1;
}
