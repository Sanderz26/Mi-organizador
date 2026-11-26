// Sistema de experiencia, niveles y rachas
import { state, activeSubjects } from './store.js';
import { sound } from './sound.js';
import { toast, uid, todayKey, toKey, addDays, parseKey, weekKey, weekStart } from './util.js';

export const RANKS = [
  [1, 'Principiante'], [3, 'Aprendiz'], [6, 'Competente'], [10, 'Avanzado'], [15, 'Experto'], [20, 'Maestro'], [30, 'Élite'],
];
export const rankFor = (lvl) => RANKS.reduce((r, [min, name]) => (lvl >= min ? name : r), RANKS[0][1]);

/** XP necesaria para pasar del nivel L al L+1 */
export const needFor = (L) => 100 + (L - 1) * 50;

export function levelInfo(xp) {
  xp = Math.max(0, Math.round(xp));
  let L = 1, rest = xp;
  while (rest >= needFor(L)) { rest -= needFor(L); L++; }
  return { level: L, into: rest, need: needFor(L), pct: Math.round((rest / needFor(L)) * 100), total: xp, rank: rankFor(L) };
}

export const xpOf = (area) => Math.max(0, state.xpLog.filter((e) => e.area === area).reduce((a, e) => a + e.amount, 0));

export function areaList() {
  return [
    ...activeSubjects().map((s) => ({ key: 'sub:' + s.id, name: s.name, color: s.color, icon: 'book', kind: 'subject' })),
    { key: 'gym', name: 'Gimnasio', color: 'var(--c-gym)', icon: 'barbell', kind: 'gym' },
    { key: 'diet', name: 'Dieta', color: 'var(--c-diet)', icon: 'salad', kind: 'diet' },
  ];
}
export const areaName = (key) => areaList().find((a) => a.key === key)?.name || (key.startsWith('sub:') ? state.subjects.find((s) => 'sub:' + s.id === key)?.name || 'Materia' : key);

/** Suma o resta XP. ref permite reemplazar o quitar la XP ligada a un registro. */
export function award(area, amount, reason, ref = null, { quiet = false, date = todayKey(), kind } = {}) {
  amount = Math.round(amount);
  const before = levelInfo(xpOf(area)).level;
  if (ref) state.xpLog = state.xpLog.filter((e) => e.ref !== ref);
  if (amount !== 0) state.xpLog.push({ id: uid(), area, amount, reason, ref, date, ts: Date.now(), kind: kind || (amount < 0 ? 'fail' : 'gain') });
  const after = levelInfo(xpOf(area));
  if (quiet) return after;
  if (after.level > before) {
    sound('levelup');
    toast(`${areaName(area)} · nivel ${after.level} · ${after.rank}`, { title: 'Subiste de nivel', kind: 'level levelup-big', icon: 'trophy', ms: 4200 });
  } else if (after.level < before) {
    sound('leveldown');
    toast(`${areaName(area)} bajó al nivel ${after.level}`, { title: 'Bajaste de nivel', icon: 'trending-down', ms: 3600 });
  } else if (amount > 0) {
    sound('xp');
    toast(`+${amount} XP · ${areaName(area)}`, { icon: 'star', ms: 1800 });
  } else if (amount < 0) {
    sound('fail');
    toast(`${amount} XP · ${areaName(area)}`, { icon: 'trending-down', ms: 2200 });
  }
  return after;
}

export function removeRef(ref) {
  state.xpLog = state.xpLog.filter((e) => e.ref !== ref);
}

const failDays = (area) => new Set(state.xpLog.filter((e) => e.area === area && e.kind === 'fail').map((e) => e.date));

// ---------- Rachas ----------
/** Dieta: días seguidos cumplidos (si hoy no está cerrado, cuenta desde ayer) */
export function dietStreak(upTo = todayKey()) {
  const days = state.dietDays;
  const fails = failDays('diet');
  let d = parseKey(upTo);
  if (!days[upTo]) d = addDays(d, -1);
  let n = 0;
  for (;;) {
    const k = toKey(d);
    if (days[k] !== 'ok' || fails.has(k)) break;
    n++; d = addDays(d, -1);
  }
  return n;
}
export function dietBest() {
  const keys = Object.keys(state.dietDays).sort();
  let best = 0, cur = 0, prev = null;
  const fails = failDays('diet');
  for (const k of keys) {
    const okDay = state.dietDays[k] === 'ok' && !fails.has(k);
    if (okDay && prev && toKey(addDays(parseKey(prev), 1)) === k) cur++;
    else cur = okDay ? 1 : 0;
    best = Math.max(best, cur);
    prev = k;
  }
  return best;
}

/** Gimnasio: semanas seguidas cumpliendo la meta semanal */
export function gymWeeks() {
  const goal = Math.max(1, state.settings.gymWeeklyGoal || 1);
  const count = {};
  for (const s of state.gymSessions) count[weekKey(parseKey(s.date))] = (count[weekKey(parseKey(s.date))] || 0) + 1;
  const failWeeks = new Set([...failDays('gym')].map((k) => weekKey(parseKey(k))));
  const met = (wk) => (count[wk] || 0) >= goal && !failWeeks.has(wk);
  let w = weekStart(new Date());
  if (!met(toKey(w))) w = addDays(w, -7);
  let n = 0;
  while (met(toKey(w))) { n++; w = addDays(w, -7); }
  return { streak: n, thisWeek: count[weekKey(new Date())] || 0, goal };
}

/** Materia: días seguidos estudiando */
export function studyStreak(subjectId) {
  const days = new Set(state.studySessions.filter((s) => s.subjectId === subjectId).map((s) => s.date));
  const fails = failDays('sub:' + subjectId);
  let d = new Date();
  if (!days.has(toKey(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(toKey(d)) && !fails.has(toKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

export function streakFor(area) {
  const d = (n) => ({ value: n, unit: n === 1 ? 'día' : 'días' });
  if (area === 'diet') return d(dietStreak());
  if (area === 'gym') { const n = gymWeeks().streak; return { value: n, unit: n === 1 ? 'semana' : 'semanas' }; }
  if (area.startsWith('sub:')) return d(studyStreak(area.slice(4)));
  return { value: 0, unit: '' };
}

/** Historial acumulado de XP por día para gráficas */
export function xpSeries(area, days = 90) {
  const start = addDays(new Date(), -days + 1);
  const entries = state.xpLog.filter((e) => e.area === area).sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  let acc = 0;
  const before = entries.filter((e) => e.date < toKey(start));
  for (const e of before) acc = Math.max(0, acc + e.amount);
  const labels = [], values = [];
  for (let i = 0; i < days; i++) {
    const k = toKey(addDays(start, i));
    for (const e of entries.filter((x) => x.date === k)) acc = Math.max(0, acc + e.amount);
    labels.push(k); values.push(acc);
  }
  return { labels, values };
}

// ---------- Reglas de experiencia ----------
export const RULES = {
  studyPerMinutes: 3, // 1 XP cada 3 minutos estudiados (20 XP por hora)
  exercise: 5,
  exerciseFaster: 10,
  taskOnTime: 15,
  dietDay: 20,
  dietStreakBonus: 5, // por cada día de racha, hasta 10
  gymSession: 25,
  gymPR: 10,
  gymWeekGoal: 50,
};
