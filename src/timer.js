// Cronómetro de estudio (sigue contando aunque cierres la app)
import { state, commit, upsert, subjectName, topicName } from './store.js';
import { award, RULES } from './xp.js';
import { sound } from './sound.js';
import { toast, todayKey, toKey, pad, formModal, fmtMin } from './util.js';

export function timerElapsed(t = state.activeTimer) {
  if (!t) return 0;
  const end = t.pausedAt || Date.now();
  return Math.max(0, Math.floor((end - t.start - (t.pausedMs || 0)) / 1000));
}

export function startTimer(subjectId, topicId = '') {
  if (state.activeTimer) { toast('Ya hay un cronómetro en marcha'); return; }
  state.activeTimer = { subjectId, topicId, start: Date.now(), pausedMs: 0, pausedAt: null };
  sound('start');
  commit();
}

export function togglePause() {
  const t = state.activeTimer;
  if (!t) return;
  if (t.pausedAt) { t.pausedMs += Date.now() - t.pausedAt; t.pausedAt = null; sound('start'); }
  else { t.pausedAt = Date.now(); sound('stop'); }
  commit();
}

export async function stopTimer() {
  const t = state.activeTimer;
  if (!t) return;
  const secs = timerElapsed(t);
  const mins = Math.max(1, Math.round(secs / 60));
  const startD = new Date(t.start);
  const topics = state.topics.filter((x) => x.subjectId === t.subjectId);
  const v = await formModal({
    title: 'Terminar sesión de estudio',
    submitLabel: 'Guardar sesión',
    fields: [
      { name: 'minutes', label: 'Minutos estudiados', type: 'number', value: mins, min: 1, required: true },
      { name: 'topicId', label: 'Tema', type: 'select', value: t.topicId, options: [{ v: '', l: 'Sin tema específico' }, ...topics.map((x) => ({ v: x.id, l: x.name }))] },
      { name: 'note', label: 'Qué hiciste (opcional)', type: 'textarea', placeholder: 'Repasé integrales por partes y resolví 8 ejercicios' },
      { name: 'discard', label: 'Descartar esta sesión (no se guarda)', type: 'checkbox' },
    ],
  });
  if (!v) return;
  state.activeTimer = null;
  if (v.discard) { sound('stop'); commit(); return; }
  sound('complete');
  const session = upsert('studySessions', {
    subjectId: t.subjectId, topicId: v.topicId, date: toKey(startD),
    start: `${pad(startD.getHours())}:${pad(startD.getMinutes())}`, minutes: v.minutes, note: v.note,
  });
  awardStudy(session);
  commit();
}

export function awardStudy(s) {
  const xp = Math.round(s.minutes / RULES.studyPerMinutes);
  award('sub:' + s.subjectId, xp, `Estudio ${fmtMin(s.minutes)}${s.topicId ? ' · ' + topicName(s.topicId) : ''}`, 'study:' + s.id, { date: s.date || todayKey() });
}

export const timerLabel = () => {
  const t = state.activeTimer;
  if (!t) return '';
  return `${subjectName(t.subjectId)}${t.topicId ? ' · ' + topicName(t.topicId) : ''}`;
};
