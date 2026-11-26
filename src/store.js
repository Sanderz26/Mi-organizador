// Estado de la app, guardado local y utilidades de datos
import { readData, writeData, writeDataSync, readBackups } from './platform.js';
import { soundConfig } from './sound.js';
import { uid } from './util.js';

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
  autostart: false,
  heightCm: 0,
  targetWeight: 0,
};

const DEFAULTS = () => ({
  version: 1,
  savedAt: 0,
  settings: { ...DEFAULT_SETTINGS },
  subjects: [], topics: [], studySessions: [], exercises: [],
  notes: [], files: [],
  tasks: [], events: [],
  meals: [], dietDays: {},
  gymSessions: [], weights: [],
  clients: [], sales: [], expenses: [], products: [],
  xpLog: [],
  activeTimer: null,
  holidaysCache: {},
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
  applySettings();
}

export function applyData(d) {
  const base = DEFAULTS();
  for (const k of Object.keys(base)) state[k] = d[k] ?? base[k];
  state.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
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

/** Guarda y vuelve a dibujar la vista actual */
export function commit() {
  save();
  listeners.forEach((fn) => fn());
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
