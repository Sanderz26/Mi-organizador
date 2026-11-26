// Festivos de Colombia: se consultan en línea y, sin conexión, se calculan (Ley 51 de 1983, "Ley Emiliani")
import { state, save } from './store.js';
import { toKey, addDays } from './util.js';

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const nextMonday = (d) => { const wd = d.getDay(); return wd === 1 ? d : addDays(d, (8 - wd) % 7); };

export function computeHolidays(y) {
  const list = [];
  const add = (d, name) => list.push({ date: toKey(d), name });
  add(new Date(y, 0, 1), 'Año Nuevo');
  add(nextMonday(new Date(y, 0, 6)), 'Reyes Magos');
  add(nextMonday(new Date(y, 2, 19)), 'San José');
  const e = easter(y);
  add(addDays(e, -3), 'Jueves Santo');
  add(addDays(e, -2), 'Viernes Santo');
  add(new Date(y, 4, 1), 'Día del Trabajo');
  add(nextMonday(addDays(e, 39)), 'Ascensión del Señor');
  add(nextMonday(addDays(e, 60)), 'Corpus Christi');
  add(nextMonday(addDays(e, 68)), 'Sagrado Corazón');
  add(nextMonday(new Date(y, 5, 29)), 'San Pedro y San Pablo');
  add(new Date(y, 6, 20), 'Día de la Independencia');
  add(new Date(y, 7, 7), 'Batalla de Boyacá');
  add(nextMonday(new Date(y, 7, 15)), 'Asunción de la Virgen');
  add(nextMonday(new Date(y, 9, 12)), 'Día de la Raza');
  add(nextMonday(new Date(y, 10, 1)), 'Todos los Santos');
  add(nextMonday(new Date(y, 10, 11)), 'Independencia de Cartagena');
  add(new Date(y, 11, 8), 'Inmaculada Concepción');
  add(new Date(y, 11, 25), 'Navidad');
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

const memo = {};
export function holidaysFor(y) {
  if (memo[y]) return memo[y];
  const cached = state.holidaysCache?.[y];
  memo[y] = cached?.length ? cached : computeHolidays(y);
  return memo[y];
}
export function holidayMap(y) {
  const m = {};
  for (const h of holidaysFor(y)) m[h.date] = h.name;
  return m;
}
export function nextHoliday(fromKey) {
  const y = Number(fromKey.slice(0, 4));
  return [...holidaysFor(y), ...holidaysFor(y + 1)].find((h) => h.date >= fromKey);
}

/** Consulta en línea (Nager.Date) y guarda en caché; si falla, se usan los calculados */
export async function syncHolidaysOnline() {
  const y = new Date().getFullYear();
  let changed = false;
  for (const year of [y, y + 1]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/CO`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const data = await r.json();
      const local = computeHolidays(year);
      const names = Object.fromEntries(local.map((h) => [h.date, h.name]));
      const list = data.map((h) => ({ date: h.date, name: names[h.date] || h.localName || h.name })).sort((a, b) => a.date.localeCompare(b.date));
      if (list.length >= 15) { state.holidaysCache[year] = list; delete memo[year]; changed = true; }
    } catch { /* sin internet: se usan los calculados */ }
  }
  if (changed) save();
  return changed;
}
