// Memoria de largo plazo del asistente: lo que el usuario le pide recordar.
// Guarda hasta 500 cosas, pero a la IA solo se le mandan las fijadas y las relacionadas con cada pregunta.
import { state, upsert, remove } from './store.js';
import { todayKey, norm } from './util.js';

export const MAX_MEMORIES = 500;
const STOP = new Set('para como cuando donde quien tengo tiene tienes estoy esta este esto esos esas unos unas sobre entre desde hasta porque pero mucho poco cada todo todos todas solo tambien siempre nunca mejor dime hazme puedes quiero'.split(' '));
const words = (t) => norm(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !STOP.has(w));

export function addMemory(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!t) throw new Error('No hay nada que recordar');
  const dup = state.memories.find((m) => norm(m.text) === norm(t));
  if (dup) return dup;
  if (state.memories.length >= MAX_MEMORIES) {
    // Se libera espacio quitando la más antigua que no esté fijada
    const old = state.memories.filter((m) => !m.pinned).sort((a, b) => (a.created || '').localeCompare(b.created || ''))[0];
    if (!old) throw new Error('La memoria está llena');
    remove('memories', old.id);
  }
  return upsert('memories', { text: t, created: todayKey(), pinned: false });
}

/** El recuerdo que mejor coincide con un texto (para "olvida que…") */
export function findMemory(text) {
  const q = words(text);
  if (!q.length) return null;
  let best = null, bestSc = 0;
  for (const m of state.memories) {
    const w = new Set(words(m.text));
    const sc = q.filter((x) => w.has(x)).length / Math.max(q.length, 1);
    if (sc > bestSc) { best = m; bestSc = sc; }
  }
  return bestSc >= 0.5 ? best : null;
}

/** Texto para el contexto de la IA: fijadas + más relacionadas con la pregunta + más recientes, hasta `room` caracteres */
export function memoryContext(question, room = 2000) {
  const all = state.memories;
  if (!all.length) return '';
  const q = new Set(words(question));
  const scored = all.map((m, i) => ({ m, sc: (m.pinned ? 100 : 0) + words(m.text).filter((w) => q.has(w)).length * 10 + i / all.length }));
  scored.sort((a, b) => b.sc - a.sc);
  const out = [];
  let len = 0;
  for (const { m } of scored) {
    const line = `- ${m.text}`;
    if (len + line.length > room) break;
    out.push(line);
    len += line.length + 1;
  }
  const note = out.length < all.length ? ` (aquí van ${out.length} de ${all.length}: las fijadas y las más relacionadas con la pregunta)` : '';
  return `\n## Lo que el usuario te pidió recordar${note}\n${out.join('\n')}`;
}
