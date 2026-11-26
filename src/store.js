// Estado de la app, guardado local y utilidades de datos
import { readData, writeData, writeDataSync, readBackups } from './platform.js';
import { soundConfig } from './sound.js';
import { uid } from './util.js';
import { flatten, unflatten, stamp } from './syncmodel.js';

export const DEFAULT_SETTINGS = {
  name: '',
  theme: 'light', // light | dark | system
  sound: true,
  volume: 0.5,
  calorieGoal: 2200,
  calorieMargin: 10, // %
  dietMode: 'range', // range = dentro de ±margen; max = no pasarse de la meta
  proteinGoal: 0,
  gymWeeklyGoal: 4,
  classReminderMins: 15,
  defaultReminderMins: 30,
  filamentCostKg: 80000,
  printerWatts: 120,
  kwhCost: 850,
  closeToTray: true,
  syncMode: '',
  syncUrl: '',
  syncKey: '',
  autostart: false,
  currentSemester: '',
  heightCm: 0,
  targetWeight: 0,
  sex: '',
  age: 0,
  activity: 'ligero',
  goal: 'mantener',
  proteinCounts: false,
};

const DEFAULTS = () => ({
  version: 1,
  savedAt: 0,
  settings: { ...DEFAULT_SETTINGS },
  semesters: [], subjects: [], topics: [], studySessions: [], exercises: [],
  notes: [], files: [],
  tasks: [], events: [],
  meals: [], dietDays: {},
  gymSessions: [], weights: [],
  clients: [], sales: [], expenses: [], products: [],
  xpLog: [],
  activeTimer: null,
  holidaysCache: {},
  _sync: { meta: {}, del: {} },
});

export const state = DEFAULTS();
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

export async function loadState() {
  let raw = null;
  try { raw = await readData(); } catch (e) { console.error('No se pudieron leer los datos', e); }
  if (raw) {
    try { applyData(JSON.parse(raw)); }
    catch (e) {
      console.error('Archivo de datos dañado', e);
      let ok = false;
      const backups = (await readBackups()).map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter(Boolean);
      backups.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      if (backups[0]) { applyData(backups[0]); ok = true; }
      if (!ok) writeBlocked = true; // no sobrescribir datos que quizá se puedan recuperar
    }
  }
  ensureSemesters();
  initShadow();
  applySettings();
}

/** Nombre sugerido según la fecha: 2026-1 (ene–jun) o 2026-2 (jul–dic) */
export const guessSemesterName = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() < 6 ? 1 : 2}`;

/** Garantiza que exista un semestre actual y que toda materia tenga semestre */
export function ensureSemesters() {
  if (!state.semesters.length) {
    const withDates = state.subjects.find((s) => s.semesterStart || s.semesterEnd);
    state.semesters.push({ id: uid(), name: guessSemesterName(), start: withDates?.semesterStart || '', end: withDates?.semesterEnd || '' });
  }
  if (!state.semesters.some((x) => x.id === state.settings.currentSemester)) {
    state.settings.currentSemester = state.semesters[state.semesters.length - 1].id;
  }
  for (const s of state.subjects) if (!s.semesterId || !state.semesters.some((x) => x.id === s.semesterId)) s.semesterId = state.settings.currentSemester;
}
export const currentSemester = () => state.semesters.find((x) => x.id === state.settings.currentSemester) || state.semesters[0];
export const semesterOf = (s) => state.semesters.find((x) => x.id === s?.semesterId);
/** Materias del semestre actual que no están canceladas */
export const activeSubjects = () => state.subjects.filter((s) => !s.archived && s.semesterId === state.settings.currentSemester);
/** ¿La materia tiene clases en esa fecha según las fechas de su semestre? */
export function subjectRunsOn(s, key) {
  if (s.archived) return false;
  const sem = semesterOf(s);
  if (!sem) return true;
  if (sem.start && key < sem.start) return false;
  if (sem.end && key > sem.end) return false;
  if (!sem.start && !sem.end) return sem.id === state.settings.currentSemester;
  return true;
}
export const semesterSort = (a, b) => (b.start || b.name).localeCompare(a.start || a.name);

export function applyData(d) {
  const base = DEFAULTS();
  for (const k of Object.keys(base)) state[k] = d[k] ?? base[k];
  state.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  ensureSemesters();
  initShadow();
}

export function applySettings() {
  const s = state.settings;
  soundConfig.on = !!s.sound;
  soundConfig.volume = Number(s.volume ?? 0.5);
  const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#15171b' : '#f6f7f9');
}

let saveTimer = null;
let writeBlocked = false;
export const isWriteBlocked = () => writeBlocked;
export const unblockWrites = () => { writeBlocked = false; };
let saving = Promise.resolve();
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (writeBlocked) return saving;
  state.savedAt = Date.now();
  const text = JSON.stringify(state);
  saving = saving.then(() => writeData(text)).catch((e) => console.error('Error al guardar', e));
  return saving;
}
export function flushSync() {
  if (saveTimer && !writeBlocked) { clearTimeout(saveTimer); saveTimer = null; writeDataSync(JSON.stringify(state)); }
}

// ---------- Sincronización: marcas de cambio por registro ----------
let shadow = {};
function initShadow() {
  if (!state._sync || typeof state._sync !== 'object') state._sync = { meta: {}, del: {} };
  state._sync.meta ||= {};
  state._sync.del ||= {};
  shadow = {};
  stamp(flatten(state), { shadow, meta: state._sync.meta, del: state._sync.del }, 1);
}
/** Marca lo que cambió desde la última vez (se llama en cada commit) */
export function stampLocal() {
  return stamp(flatten(state), { shadow, meta: state._sync.meta, del: state._sync.del });
}
export function localCopy() {
  stampLocal();
  return { docs: flatten(state), meta: { ...state._sync.meta }, del: { ...state._sync.del } };
}
/** Reemplaza el estado con la copia fusionada que llegó de la nube */
export function applyMerged(m) {
  const parts = unflatten(m.docs, state.settings);
  for (const [k, v] of Object.entries(parts)) state[k] = v;
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  state._sync = { meta: { ...m.meta }, del: { ...m.del } };
  shadow = {};
  for (const [k, v] of Object.entries(m.docs)) shadow[k] = JSON.stringify(v);
  ensureSemesters();
  applySettings();
  save();
  listeners.forEach((fn) => fn());
}

const changeListeners = new Set();
export const onLocalChange = (fn) => changeListeners.add(fn);

/** Guarda y vuelve a dibujar la vista actual */
export function commit() {
  const changed = stampLocal();
  save();
  listeners.forEach((fn) => fn());
  if (changed) changeListeners.forEach((fn) => fn());
}

// ---------- Ayudas de colecciones ----------
export function upsert(list, item) {
  if (!item.id) item.id = uid();
  const i = state[list].findIndex((x) => x.id === item.id);
  if (i >= 0) state[list][i] = { ...state[list][i], ...item };
  else state[list].push(item);
  return item;
}
export function remove(list, id) {
  state[list] = state[list].filter((x) => x.id !== id);
}
export const find = (list, id) => state[list].find((x) => x.id === id);

export const SUBJECT_COLORS = ['#6c63d4', '#2f7fcf', '#14866a', '#c2417a', '#a36a0b', '#d2603a', '#5a9222', '#7a5bc4', '#1d5c74', '#8a6d3b'];
export const subjectColor = (id) => find('subjects', id)?.color || '#6c63d4';
export const subjectName = (id) => find('subjects', id)?.name || 'Sin materia';
export const topicName = (id) => find('topics', id)?.name || '';
