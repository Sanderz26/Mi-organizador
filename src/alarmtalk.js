// Qué dice Aries al apagar una alarma: lo deduce del nombre y usa tus datos (sin IA, no gasta nada).
import { state, activeSubjects } from './store.js';
import { norm, todayKey, toKey } from './util.js';
import { daySummary, nextTime } from './alarms.js';
import { upcomingExams, daysUntil } from './views/exams.js';
import { streakFor } from './xp.js';
import { printerLive, printerIp } from './printer.js';
import { agendaFor } from './agenda.js';

export const KINDS = [
  ['despertar', 'Levantarse: resumen del día', /levant|despert|madrug|buenos dias|arriba|wake|alistar/],
  ['agua', 'Tomar agua', /agua|hidrat/],
  ['comida', 'Comida: calorías del día', /desayun|almuerz|comer|comida|cena|merienda|onces|snack|lonch|algo de comer/],
  ['gimnasio', 'Gimnasio: qué entrenar', /gym|gimnas|entren|ejercicio|pesas|correr|cardio|rutina/],
  ['medicina', 'Medicina', /pastill|medic|remedio|vitamin|pildora|anticonceptiv|inyecc|suplement|creatina|proteina/],
  ['estudio', 'Estudio: exámenes y tareas', /estudi|repas|tarea|parcial|quiz|examen|clase|leer|taller|universidad|\bu\b/],
  ['dormir', 'Dormir: lo de mañana', /dormir|acost|sueno|cama|descans|apagar pantalla/],
  ['impresora', 'Impresora 3D', /impres|filamento/],
  ['negocio', 'Negocio: pedidos', /entreg|pedido|cliente|enviar|despach/],
];

/** Tipo de alarma según el nombre ('' si no se reconoce) */
export function alarmKind(label) {
  const t = norm(label || '');
  for (const [k, , re] of KINDS) if (re.test(t)) return k;
  return '';
}

const hora = () => new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }).replace(/\.$/, '');
const lower = (s) => (s || '').charAt(0).toLowerCase() + (s || '').slice(1);
const n0 = (x) => Math.round(Number(x) || 0).toLocaleString('es-CO');
const daysWord = (d) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);

/** Frase que dice Aries al apagar la alarma, o '' si no debe decir nada */
export function alarmMessage(a) {
  const mode = a.speech || (a.summary === false ? 'nada' : 'auto');
  if (mode === 'nada') return '';
  if (mode === 'mensaje') return (a.message || '').trim() || `Es hora de: ${a.label || 'tu alarma'}.`;
  if (mode === 'resumen') return daySummary();
  const label = a.label || '';
  switch (alarmKind(label)) {
    case 'despertar': return daySummary();
    case 'agua': return msgAgua(a);
    case 'comida': return msgComida(label);
    case 'gimnasio': return msgGym();
    case 'medicina': return `Son las ${hora()}. Es hora de ${lower(label)}. No lo dejes para después.`;
    case 'estudio': return msgEstudio(label);
    case 'dormir': return msgDormir();
    case 'impresora': return msgImpresora();
    case 'negocio': return msgNegocio();
    default: return label ? `Son las ${hora()}. Es hora de: ${lower(label)}.` : `Son las ${hora()}.`;
  }
}

function msgAgua(a) {
  // Si tienes varias alarmas de agua hoy, te dice cuál toma es
  const today = new Date().getDay();
  const water = state.alarms.filter((x) => x.enabled !== false && alarmKind(x.label) === 'agua' && (!(x.days || []).length ? x.date === todayKey() || x.id === a.id : x.days.includes(today))).sort((x, y) => x.time.localeCompare(y.time));
  const i = water.findIndex((x) => x.id === a.id);
  const which = water.length > 1 && i >= 0 ? ` Es la toma ${i + 1} de ${water.length} de hoy.` : '';
  return `Hora de tomar agua. Tómate un vaso ahora.${which}`;
}

function msgComida(label) {
  const t = norm(label);
  const meal = /desayun/.test(t) ? 'desayunar' : /almuerz/.test(t) ? 'almorzar' : /cena/.test(t) ? 'cenar' : /merienda|onces|snack/.test(t) ? 'comer algo' : 'comer';
  const goal = Number(state.settings.calorieGoal) || 0;
  const eaten = state.meals.filter((m) => m.date === todayKey()).reduce((s, m) => s + (Number(m.kcal) || 0), 0);
  let extra = '';
  if (goal) {
    const left = goal - eaten;
    extra = eaten ? ` Hoy llevas ${n0(eaten)} de ${n0(goal)} calorías; ${left > 0 ? `te quedan unas ${n0(left)}` : `ya pasaste tu meta por ${n0(-left)}`}.` : ` Tu meta de hoy es ${n0(goal)} calorías.`;
  }
  const streak = streakFor('diet').value;
  return `Hora de ${meal}.${extra}${streak >= 2 ? ` Vas ${streak} días seguidos cumpliendo la dieta, no la rompas.` : ''} Cuando comas, dime qué fue y lo anoto.`;
}

function msgGym() {
  const ses = state.gymSessions.slice().sort((a, b) => b.date.localeCompare(a.date));
  const parts = ['Hora del gimnasio.'];
  if (ses.length) {
    const last = ses[0];
    const d = -daysUntil(last.date);
    parts.push(`La última vez entrenaste ${last.muscle ? lower(last.muscle) : 'algo'}${d === 0 ? ' hoy' : d === 1 ? ' ayer' : ` hace ${d} días`}.`);
    // Lo que más tiempo llevas sin entrenar (de lo del último mes)
    const lastBy = {};
    for (const s of ses) if (s.muscle && -daysUntil(s.date) <= 35 && !lastBy[s.muscle]) lastBy[s.muscle] = s.date;
    const oldest = Object.entries(lastBy).sort((a, b) => a[1].localeCompare(b[1]))[0];
    if (oldest && oldest[0] !== last.muscle) parts.push(`Hace rato no le das a ${lower(oldest[0])}: puede ser hoy.`);
  }
  const st = streakFor('gym');
  if (st.value >= 1) parts.push(`Llevas ${st.value} ${st.unit} seguidas cumpliendo.`);
  return parts.join(' ');
}

function msgEstudio(label) {
  const t = norm(label);
  const pools = [activeSubjects(), state.subjects];
  let subj = null;
  for (const pool of pools) { subj = pool.find((s) => s.name && t.includes(norm(s.name))) || pool.find((s) => s.name && norm(s.name).split(/\s+/).some((w) => w.length > 3 && t.includes(w))); if (subj) break; }
  const exams = upcomingExams(21).filter((x) => !subj || x.subjectId === subj.id);
  const tasks = state.tasks.filter((x) => !x.done && (!subj || x.subjectId === subj.id) && (!x.due || x.due <= toKey(new Date(Date.now() + 7 * 864e5))));
  const parts = [subj ? `Hora de estudiar ${subj.name}.` : `Hora de ${lower(label) || 'estudiar'}.`];
  if (exams.length) { const e = exams[0]; parts.push(`${subj ? 'Tienes' : 'Tu próximo examen es'} ${lower(e.title)} ${daysWord(daysUntil(e.date))}${e.topics?.length ? `: ${e.topics.slice(0, 3).join(', ')}` : ''}.`); }
  if (tasks.length) parts.push(`Tienes ${tasks.length} ${tasks.length === 1 ? 'tarea pendiente' : 'tareas pendientes'}${subj ? ` de ${subj.name}` : ''} esta semana${tasks[0]?.title ? `, empieza por ${lower(tasks[0].title)}` : ''}.`);
  if (!exams.length && !tasks.length) parts.push('No tienes exámenes ni tareas cerca: buen momento para adelantar.');
  return parts.join(' ');
}

function msgDormir() {
  const tomorrow = toKey(new Date(Date.now() + 864e5));
  const items = agendaFor(tomorrow).filter((x) => x.kind !== 'holiday' && x.time).sort((a, b) => a.time.localeCompare(b.time));
  const wake = state.alarms.filter((x) => x.enabled !== false).map((x) => ({ x, t: nextTime(x) })).filter((o) => o.t && toKey(new Date(o.t)) === tomorrow && new Date(o.t).getHours() < 12).sort((a, b) => a.t - b.t)[0];
  const parts = ['Hora de dormir.'];
  if (items.length) parts.push(`Mañana empiezas con ${items[0].short || items[0].title} a las ${items[0].time}.`);
  if (wake) parts.push(`Tu alarma suena a las ${wake.x.time}.`);
  parts.push('Deja la tableta cargando. Que descanses.');
  return parts.join(' ');
}

function msgImpresora() {
  const s = printerLive();
  if (!printerIp() || s.state !== 'ok') return `Son las ${hora()}. Revisa la impresora: no la pude ver en la red.`;
  if (s.ps === 'printing') return `Revisa la impresora: ${s.name} va en ${Math.round(s.progress * 100)}%${s.left ? ` y le faltan unos ${Math.round(s.left / 60)} minutos` : ''}.`;
  if (s.ps === 'complete') return `La impresión de ${s.name} ya terminó. Puedes retirarla.`;
  return 'Revisa la impresora: está lista, sin imprimir.';
}

function msgNegocio() {
  const make = state.sales.filter((x) => x.status === 'produccion' || x.status === 'cotizado');
  const collect = state.sales.filter((x) => x.status === 'entregado');
  if (!make.length && !collect.length) return 'Revisa tus pedidos: no tienes pendientes.';
  const p = [];
  if (make.length) p.push(`${make.length} por entregar, empezando por ${make.sort((a, b) => a.date.localeCompare(b.date))[0].desc}`);
  if (collect.length) p.push(`${collect.length} entregado${collect.length === 1 ? '' : 's'} sin cobrar`);
  return `Revisa tus pedidos: tienes ${p.join(' y ')}.`;
}
