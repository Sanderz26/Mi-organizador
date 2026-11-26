// Cálculos de salud a partir de los datos de Ajustes y los registros de peso
import { state } from './store.js';
import { parseKey, addDays, toKey } from './util.js';

export const ACTIVITY = {
  sedentario: { l: 'Sedentario (poco o nada de ejercicio)', f: 1.2 },
  ligero: { l: 'Ligero (1 a 3 días por semana)', f: 1.375 },
  moderado: { l: 'Moderado (3 a 5 días por semana)', f: 1.55 },
  alto: { l: 'Alto (6 a 7 días por semana)', f: 1.725 },
};
export const GOALS = { bajar: 'Bajar de peso', mantener: 'Mantener mi peso', subir: 'Subir de peso (ganar músculo)' };

export const weightsSorted = () => state.weights.slice().sort((a, b) => a.date.localeCompare(b.date));
export const currentWeight = () => weightsSorted().at(-1)?.kg || 0;

export function bmiInfo(kg = currentWeight(), cm = state.settings.heightCm) {
  if (!kg || !cm) return null;
  const v = kg / (cm / 100) ** 2;
  const cat = v < 18.5 ? 'Bajo peso' : v < 25 ? 'Peso saludable' : v < 30 ? 'Sobrepeso' : 'Obesidad';
  return { value: v, cat };
}

/** Gasto diario estimado (Mifflin-St Jeor × actividad) */
export function energy() {
  const s = state.settings;
  const kg = currentWeight();
  if (!kg || !s.heightCm || !s.age || !s.sex) return null;
  const bmr = 10 * kg + 6.25 * s.heightCm - 5 * s.age + (s.sex === 'mujer' ? -161 : 5);
  const tdee = bmr * (ACTIVITY[s.activity]?.f || 1.375);
  const floor = s.sex === 'mujer' ? 1200 : 1500;
  const delta = s.goal === 'bajar' ? -500 : s.goal === 'subir' ? 300 : 0;
  const suggested = Math.max(floor, Math.round((tdee + delta) / 50) * 50);
  const protein = Math.round(kg * (s.goal === 'mantener' ? 1.6 : s.goal === 'subir' ? 1.8 : 2.0));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), suggested, protein };
}

/** Tendencia de peso de las últimas 6 semanas en kg por semana (regresión lineal) */
export function weightTrend(days = 42) {
  const since = toKey(addDays(new Date(), -days));
  const pts = weightsSorted().filter((w) => w.date >= since);
  if (pts.length < 2) return null;
  const t0 = parseKey(pts[0].date).getTime();
  const xs = pts.map((p) => (parseKey(p.date).getTime() - t0) / (7 * 864e5)), ys = pts.map((p) => p.kg);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!den) return null;
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
}

/** Avance hacia el peso meta */
export function goalProgress() {
  const target = Number(state.settings.targetWeight) || 0;
  const ws = weightsSorted();
  if (!target || !ws.length) return null;
  const start = ws[0].kg, cur = ws.at(-1).kg;
  const total = start - target, done = start - cur;
  const pct = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 100;
  const remaining = cur - target;
  const rate = weightTrend();
  let eta = null;
  if (rate && Math.abs(remaining) > 0.05 && Math.sign(rate) === -Math.sign(remaining)) {
    const weeks = Math.abs(remaining / rate);
    if (weeks < 260) eta = toKey(addDays(new Date(), Math.round(weeks * 7)));
  }
  return { start, cur, target, remaining, pct, rate, eta, reached: Math.abs(remaining) < 0.3 };
}
