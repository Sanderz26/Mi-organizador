// Chat con el asistente de IA
import { state, commit, upsert, activeSubjects, subjectName, SUBJECT_COLORS } from '../store.js';
import { icon } from '../icons.js';
import { esc, toast, todayKey, norm, weekKey, parseKey, fmtMoney } from '../util.js';
import { aiConfig, aiReady, complete, buildContext, SYSTEM, parseJsonReply, PROVIDERS, claimsDone } from '../ai.js';
import { award, RULES } from '../xp.js';
import { awardStudy } from '../timer.js';
import { toggleTask } from './tasks.js';
import { canDictate, listen, speak, stopSpeaking } from '../voice.js';
import { pauseWake, resumeWake } from '../wakeword.js';
import { printerIp, pollPrinter } from '../printer.js';
import { sound } from '../sound.js';
import { faceEvent, onFaceRequest, faceOpen, faceSession } from '../face.js';
import { addMemory, findMemory } from '../memory.js';

const LS = 'organizador-ia-chat';
let chat = (() => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } })();
let busy = false;
let mic = null; // grabación en curso
let micState = 'idle'; // idle | listening | transcribing
let voicePending = false;
/** Lo llama la palabra "Aries": abre el asistente y empieza a escuchar */
export function requestVoiceStart() { voicePending = true; }
let currentEl = null;
// La carita pide escuchar (botón de micrófono o seguir la conversación) o se cierra
onFaceRequest((kind) => {
  if (kind === 'listen' && currentEl?.isConnected && faceOpen()) { if (micState === 'idle' && !busy) toggleMic(currentEl, { fromWake: true }); }
  else if (kind === 'close') { if (micState !== 'idle') mic?.stop(); stopSpeaking(); }
});
// Si la app pasa al fondo o se apaga la pantalla (más de 2,5 s, no un parpadeo), nunca queda el micrófono abierto
let hiddenSince = 0, hideStop = 0;
document.addEventListener('visibilitychange', () => {
  clearTimeout(hideStop);
  if (document.visibilityState === 'hidden') {
    hiddenSince = Date.now();
    hideStop = setTimeout(() => { if (document.visibilityState === 'hidden') { if (micState !== 'idle') mic?.stop(); stopSpeaking(); } }, 2500);
  } else hiddenSince = 0;
});
const reallyHidden = () => document.visibilityState === 'hidden' && hiddenSince && Date.now() - hiddenSince > 2500;
/** Espera a que la app se vea (al despertar la tableta tarda un momento). false si no aparece. */
async function waitVisible(ms = 5000) {
  const t0 = Date.now();
  while (document.visibilityState === 'hidden' && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150));
  return document.visibilityState !== 'hidden';
}
const VOICE_LS = 'organizador-ia-voz';
const VOICE_MODES = { dictado: 'Voz al dictar', siempre: 'Voz siempre', apagada: 'Sin voz' };
let voiceMode = (() => { try { return localStorage.getItem(VOICE_LS) || 'dictado'; } catch { return 'dictado'; } })();
const saveChat = () => { try { localStorage.setItem(LS, JSON.stringify(chat.slice(-40))); } catch { /* */ } };

const SUGGEST = ['¿Qué tengo esta semana?', 'Hazme un plan de estudio para los próximos 3 días', '¿En qué materia voy más atrasado?', 'Almorcé arroz con pollo y ensalada, regístralo', '¿Cómo va el negocio este mes?'];

/** Texto simple a HTML seguro: **negrita**, listas con - y saltos de línea */
function md(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^\s*[-•*]\s+/.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${l.replace(/^\s*[-•*]\s+/, '')}</li>`; }
    else { if (inList) { html += '</ul>'; inList = false; } html += l.trim() ? `<p>${l}</p>` : ''; }
  }
  return html + (inList ? '</ul>' : '');
}

const findSubject = (name) => {
  if (!name) return '';
  const n = norm(name);
  const subs = activeSubjects().length ? activeSubjects() : state.subjects;
  return (subs.find((s) => norm(s.name) === n) || subs.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name))))?.id || '';
};

const DAYMAP = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const dayNum = (d) => (typeof d === 'number' ? d : DAYMAP[norm(d).replace(/[^a-z]/g, '')]);
const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
const isTime = (x) => /^\d{2}:\d{2}$/.test(x || '');
const findPendingTask = (title) => { const n = norm(title); const open = state.tasks.filter((t) => !t.done); return open.find((t) => norm(t.title) === n) || open.find((t) => norm(t.title).includes(n) || n.includes(norm(t.title))); };

function actionLabel(a) {
  const sub = a.materia ? (findSubject(a.materia) ? subjectName(findSubject(a.materia)) : a.materia + ' (nueva)') : '';
  const when = [a.fecha, a.hora].filter(Boolean).join(' ');
  switch (a.tipo) {
    case 'tarea': return { ic: 'checklist', t: `Tarea: ${a.titulo || ''}`, s: [when, sub].filter(Boolean).join(' · ') };
    case 'completar_tarea': { const t = findPendingTask(a.titulo || ''); return { ic: 'circle-check', t: `Completar: ${t?.title || a.titulo || ''}`, s: t ? 'Tarea pendiente' : 'No encontré esa tarea pendiente' }; }
    case 'evento': return { ic: a.subtipo === 'cumpleanos' ? 'cake' : 'calendar-event', t: `${a.subtipo === 'cumpleanos' ? 'Cumpleaños' : a.subtipo === 'reunion' ? 'Reunión' : 'Evento'}: ${a.titulo || ''}`, s: [when, a.lugar].filter(Boolean).join(' · ') };
    case 'examen': return { ic: 'school', t: `Examen: ${a.titulo || ''}`, s: [when, sub, (a.temas || []).join(', ')].filter(Boolean).join(' · ') };
    case 'materia': return { ic: 'book', t: `Materia: ${a.nombre || ''}`, s: [a.profesor, a.creditos ? a.creditos + ' créditos' : '', (a.horario || []).map((h) => `${h.dia} ${h.inicio}-${h.fin}`).join(', ')].filter(Boolean).join(' · ') };
    case 'tema': return { ic: 'list-details', t: `Tema: ${a.nombre || ''}`, s: [sub, a.fecha_examen ? 'examen ' + a.fecha_examen : ''].filter(Boolean).join(' · ') };
    case 'estudio': return { ic: 'stopwatch', t: `Sesión de estudio: ${Math.round(a.minutos || 0)} min`, s: [sub, a.tema, a.fecha].filter(Boolean).join(' · ') };
    case 'nota': return { ic: 'notes', t: `Apunte: ${a.titulo || ''}`, s: [sub, String(a.contenido || '').slice(0, 60)].filter(Boolean).join(' · ') };
    case 'comida': return { ic: 'salad', t: `${a.comida || 'Comida'}: ${a.descripcion || ''}`, s: `${Math.round(a.kcal || 0)} kcal${a.proteina ? ` · ${Math.round(a.proteina)} g proteína` : ''}${a.fecha && a.fecha !== todayKey() ? ' · ' + a.fecha : ''}` };
    case 'peso': return { ic: 'scale', t: `Peso: ${a.kg} kg`, s: a.fecha || 'Hoy' };
    case 'entrenamiento': return { ic: 'barbell', t: `Entrenamiento: ${a.grupo || ''}`, s: [(a.ejercicios || []).map((e) => `${e.nombre} ${e.series || ''}x${e.reps || ''}${e.peso ? ' ' + e.peso + ' kg' : ''}`).join(', '), a.fecha].filter(Boolean).join(' · ') };
    case 'cliente': return { ic: 'user', t: `Cliente: ${a.nombre || ''}`, s: [a.telefono, a.ciudad].filter(Boolean).join(' · ') };
    case 'pedido': return { ic: 'receipt', t: `Pedido: ${a.descripcion || ''}`, s: [a.cliente, a.precio ? fmtMoney(a.precio) : '', a.estado].filter(Boolean).join(' · ') };
    case 'recordar': return { ic: 'star', t: `Recordar: ${a.texto || ''}`, s: 'Memoria del asistente' };
    case 'olvidar': { const m = findMemory(a.texto || ''); return { ic: 'trash', t: `Olvidar: ${m?.text || a.texto || ''}`, s: m ? 'Se borra de la memoria del asistente' : 'No encontré ese recuerdo' }; }
    case 'gasto': return { ic: 'cash', t: `${a.inversion ? 'Inversión' : 'Gasto'}: ${a.concepto || ''}`, s: [a.valor ? fmtMoney(a.valor) : '', a.categoria].filter(Boolean).join(' · ') };
    default: return null;
  }
}

/** Ejecuta una acción propuesta por la IA (tras la confirmación del usuario) */
function runAction(a) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a.fecha || '') ? a.fecha : '';
  const time = /^\d{2}:\d{2}$/.test(a.hora || '') ? a.hora : '';
  if (a.tipo === 'tarea') {
    const subjectId = findSubject(a.materia);
    upsert('tasks', { title: a.titulo || 'Tarea', due: date, dueTime: time, subjectId, category: subjectId ? 'estudio' : 'general', priority: ['alta', 'media', 'baja'].includes(a.prioridad) ? a.prioridad : 'media', reminderMins: Number.isFinite(a.recordatorio_min) ? a.recordatorio_min : state.settings.defaultReminderMins, done: false, created: todayKey(), subtasks: [] });
  } else if (a.tipo === 'evento') {
    const type = ['evento', 'reunion', 'cumpleanos', 'fecha'].includes(a.subtipo) ? a.subtipo : 'evento';
    upsert('events', { type, title: a.titulo || 'Evento', date: date || todayKey(), time, place: a.lugar || '', repeat: type === 'cumpleanos' ? 'yearly' : '', reminderMins: Number.isFinite(a.recordatorio_min) ? a.recordatorio_min : type === 'cumpleanos' ? 1440 : state.settings.defaultReminderMins });
  } else if (a.tipo === 'examen') {
    const subjectId = findSubject(a.materia);
    const topicIds = [];
    for (const name of a.temas || []) {
      let t = state.topics.find((x) => x.subjectId === subjectId && norm(x.name) === norm(name));
      if (!t && subjectId) t = upsert('topics', { subjectId, name, status: 'pendiente', created: todayKey() });
      if (t) topicIds.push(t.id);
    }
    upsert('events', { type: 'examen', title: a.titulo || 'Examen', subjectId, date: date || todayKey(), time, topicIds, reminderMins: 1440, maxGrade: 5, repeat: '' });
  } else if (a.tipo === 'completar_tarea') {
    const t = findPendingTask(a.titulo || '');
    if (!t) throw new Error('No encontré la tarea');
    toggleTask(t.id);
  } else if (a.tipo === 'materia') {
    if (!a.nombre) throw new Error('Falta el nombre');
    const schedule = (a.horario || []).map((h) => ({ day: dayNum(h.dia), start: isTime(h.inicio) ? h.inicio : '', end: isTime(h.fin) ? h.fin : '', room: h.salon || '' })).filter((h) => h.day !== undefined && h.start);
    upsert('subjects', { name: a.nombre, teacher: a.profesor || '', credits: Number(a.creditos) || '', goalHours: Number(a.meta_horas) || '', color: SUBJECT_COLORS[state.subjects.length % SUBJECT_COLORS.length], semesterId: state.settings.currentSemester, schedule });
  } else if (a.tipo === 'tema') {
    const subjectId = findSubject(a.materia);
    if (!subjectId) throw new Error('Primero crea la materia');
    upsert('topics', { subjectId, name: a.nombre || 'Tema', status: 'pendiente', examDate: isDate(a.fecha_examen) ? a.fecha_examen : '', created: todayKey() });
  } else if (a.tipo === 'estudio') {
    const subjectId = findSubject(a.materia);
    if (!subjectId) throw new Error('No encontré la materia');
    const topic = a.tema ? state.topics.find((t) => t.subjectId === subjectId && norm(t.name) === norm(a.tema)) : null;
    const ses = upsert('studySessions', { subjectId, topicId: topic?.id || '', date: date || todayKey(), minutes: Math.max(1, Math.round(Number(a.minutos) || 0)), note: 'Registrado con el asistente' });
    awardStudy(ses);
  } else if (a.tipo === 'nota') {
    upsert('notes', { title: a.titulo || 'Apunte', body: a.contenido || '', subjectId: findSubject(a.materia), date: todayKey(), updated: todayKey(), fileIds: [] });
  } else if (a.tipo === 'peso') {
    const kg = Number(a.kg);
    if (!kg) throw new Error('Falta el peso');
    const d = date || todayKey();
    const same = state.weights.find((w) => w.date === d);
    upsert('weights', { ...(same || { date: d }), kg });
  } else if (a.tipo === 'entrenamiento') {
    const g = upsert('gymSessions', { date: date || todayKey(), muscle: a.grupo || '', start: '', end: '', notes: '', exercises: (a.ejercicios || []).map((e) => ({ name: e.nombre || '', sets: Number(e.series) || 0, reps: Number(e.reps) || 0, weight: Number(e.peso) || 0 })).filter((e) => e.name) });
    award('gym', RULES.gymSession, `Entreno ${g.muscle}`.trim(), 'gym:' + g.id, { date: g.date });
    const wk = weekKey(parseKey(g.date));
    if (state.gymSessions.filter((x) => weekKey(parseKey(x.date)) === wk).length >= state.settings.gymWeeklyGoal && !state.xpLog.some((x) => x.ref === 'gymweek:' + wk)) award('gym', RULES.gymWeekGoal, 'Meta semanal de gimnasio cumplida', 'gymweek:' + wk, { date: g.date });
  } else if (a.tipo === 'cliente') {
    upsert('clients', { name: a.nombre || 'Cliente', phone: a.telefono || '', city: a.ciudad || '', since: todayKey() });
  } else if (a.tipo === 'pedido') {
    let client = a.cliente ? state.clients.find((c) => norm(c.name) === norm(a.cliente)) || state.clients.find((c) => norm(c.name).includes(norm(a.cliente))) : null;
    if (!client && a.cliente) client = upsert('clients', { name: a.cliente, since: todayKey() });
    const st = state.settings;
    upsert('sales', { date: date || todayKey(), clientId: client?.id || '', kind: 'impresion', desc: a.descripcion || 'Pedido', qty: Number(a.cantidad) || 1, price: Number(a.precio) || 0, material: a.material || 'PLA', grams: Number(a.gramos) || 0, hours: Number(a.horas) || 0, filamentCostKg: st.filamentCostKg, watts: st.printerWatts, kwhCost: st.kwhCost, status: ['cotizado', 'produccion', 'entregado', 'pagado'].includes(a.estado) ? a.estado : 'produccion' });
  } else if (a.tipo === 'gasto') {
    upsert('expenses', { date: date || todayKey(), concept: a.concepto || 'Gasto', amount: Number(a.valor) || 0, category: a.categoria || 'Otro', investment: !!a.inversion });
  } else if (a.tipo === 'recordar') {
    addMemory(a.texto);
  } else if (a.tipo === 'olvidar') {
    const m = findMemory(a.texto || '');
    if (!m) throw new Error('No encontré ese recuerdo');
    state.memories = state.memories.filter((x) => x.id !== m.id);
  } else if (a.tipo === 'comida') {
    const types = ['Desayuno', 'Media mañana', 'Almuerzo', 'Algo', 'Cena', 'Snack'];
    upsert('meals', { date: date || todayKey(), type: types.includes(a.comida) ? a.comida : 'Almuerzo', desc: a.descripcion || 'Comida', kcal: Math.round(Number(a.kcal) || 0), protein: Math.round(Number(a.proteina) || 0) });
  }
}

// ---------- Confirmar por voz o chat ----------
const CONFIRM_WINDOW = 2 * 60000; // la confirmación vale para la propuesta de los últimos 2 minutos
const DANGER = new Set(['borrar', 'impresora']); // tipos que siempre piden una segunda confirmación
const YES = /^(si+|sip|sisas|claro|dale|de una|hazlo|hagale|hagalo|confirm\w*|ok|okay|listo|perfecto|adelante|vale|correcto|agregal\w*|agrega\w*|crealo\w*|guardal\w*|eso es|esta bien|todo bien|aprobado)\b/;
const NO = /^(no+|nop|nel|cancela\w*|dejalo|deja asi|olvidalo|olvida\w*|mejor no|ninguna?|descarta\w*|borra eso)\b/;
const PARTIAL = /\b(solo|solamente|menos|excepto|sin|primer\w*|segund\w*|tercer\w*|cuart\w*|ultim\w*|unicamente|cambia|pero)\b/;

/** Propuestas que siguen pendientes: las de la última respuesta del asistente, si es reciente */
function pendingProposal() {
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i];
    if (m.role !== 'assistant') continue;
    if (m.error || !(m.actions || []).length) return null;
    if (!m.at || Date.now() - m.at > CONFIRM_WINDOW) return null;
    const open = m.actions.filter((a) => !a._done && !a._dropped);
    return open.length ? { m, open } : null;
  }
  return null;
}

/** ¿Es una respuesta corta de sí o no? Devuelve 'yes', 'no' o null (si es otra cosa o elige solo algunas) */
function quickAnswer(text) {
  const t = norm(text).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 8 || PARTIAL.test(t)) return null;
  if (NO.test(t)) return 'no';
  if (YES.test(t)) return 'yes';
  return null;
}

const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs.at(-1));

/** Ejecuta propuestas; devuelve la frase de resumen */
function runProposals(list, { force = false } = {}) {
  const done = [], failed = [], risky = [];
  for (const a of list) {
    if (DANGER.has(a.tipo) && !force) { risky.push(a); continue; }
    try { runAction(a); a._done = true; done.push(actionLabel(a)?.t || a.tipo); }
    catch (err) { failed.push(`${actionLabel(a)?.t || a.tipo}${err?.message ? ' (' + err.message + ')' : ''}`); }
  }
  if (done.length) { sound('complete'); commit(); }
  const parts = [];
  if (done.length) parts.push(`Listo, ${done.length === 1 ? 'quedó agregado' : 'quedaron agregados'}: ${listJoin(done)}.`);
  if (failed.length) parts.push(`No pude con: ${listJoin(failed)}.`);
  if (risky.length) parts.push(`${listJoin(risky.map((a) => actionLabel(a)?.t || a.tipo))} necesita que lo confirmes con el botón, porque no se puede deshacer.`);
  return parts.join(' ') || 'No había nada pendiente por agregar.';
}

/** Respuesta local (sin IA) y lectura en voz alta si corresponde */
function localReply(el, content, spoken) {
  chat.push({ role: 'assistant', content, at: Date.now() });
  saveChat();
  draw(el);
  if (spoken) { faceEvent('speaking', { text: content }); pauseWake(); speak(content, () => { faceEvent('spoke'); resumeWake(); }); }
  else { faceEvent('idle', { text: content }); resumeWake(); }
}

async function send(el, text, { byVoice = false } = {}) {
  if (busy || !text.trim()) return;
  stopSpeaking();
  const pend = pendingProposal();
  const spokenNow = (byVoice && voiceMode !== 'apagada') || voiceMode === 'siempre';
  chat.push({ role: 'user', content: text.trim() });
  saveChat();
  faceEvent('heard', { text: text.trim() });
  // Atajo: "confirmo" / "no" sobre la propuesta pendiente, sin preguntarle a la IA
  const quick = pend ? quickAnswer(text) : null;
  if (quick === 'yes') { localReply(el, runProposals(pend.open), spokenNow); return; }
  if (quick === 'no') { for (const a of pend.open) a._dropped = true; localReply(el, pend.open.length === 1 ? 'Listo, la descarté.' : 'Listo, las descarté.', spokenNow); return; }
  busy = true;
  draw(el);
  faceEvent('thinking');
  try {
    const cfg = aiConfig();
    // Si pregunta por la impresora, se consulta en ese momento (máximo 3 s)
    if (/impres|impresora|printer/i.test(text) && printerIp()) await Promise.race([pollPrinter(), new Promise((r) => setTimeout(r, 3000))]);
    const spoken = (byVoice && voiceMode !== 'apagada') || voiceMode === 'siempre';
    const pendNote = pend ? `\n\n# Propuestas pendientes de confirmar\nEn tu respuesta anterior propusiste esto y el usuario aún no lo ha confirmado:\n${pend.open.map((a, i) => `${i + 1}. ${actionLabel(a)?.t}${actionLabel(a)?.s ? ' (' + actionLabel(a).s + ')' : ''}`).join('\n')}\nSi el usuario acepta o rechaza algunas (por ejemplo "solo la primera" o "todas menos el examen"), agrega al JSON "confirmar": [números] con las que acepta y "descartar": [números] con las que rechaza, y en "respuesta" dile en una frase qué se agregó. No las repitas en "acciones". Si pide cambiar algo de una propuesta, descártala y propón la versión corregida en "acciones".` : '';
    const system = SYSTEM + pendNote + (spoken ? '\n\n# Respuesta hablada\nEsta respuesta se va a leer en voz alta. Escribe "respuesta" como hablaría una persona: frases cortas y naturales, en tono cercano, sin listas, viñetas, negritas, emojis ni símbolos. Máximo 3 o 4 frases, salvo que te pidan más detalle.' : '') + '\n\n# Datos del usuario\n' + buildContext(text, PROVIDERS[cfg.provider].budget);
    const history = chat.slice(-9).map((m) => ({ role: m.role, content: m.role === 'assistant' ? JSON.stringify({ respuesta: m.content, acciones: [] }) : m.content }));
    let reply = parseJsonReply(await complete({ system, messages: history }));
    let actions = (Array.isArray(reply.acciones) ? reply.acciones : []).filter((a) => actionLabel(a));
    if (!actions.length && claimsDone(reply.respuesta)) {
      // El modelo dijo que lo hizo pero no mandó acciones: se le pide corregir una vez
      reply = parseJsonReply(await complete({ system, messages: [...history, { role: 'assistant', content: JSON.stringify(reply) }, { role: 'user', content: 'No incluiste ninguna acción en "acciones", así que no se creó nada en la app. Responde de nuevo con el mismo JSON pero incluyendo las acciones necesarias según los tipos disponibles, o explica que no es posible.' }] }));
      actions = (Array.isArray(reply.acciones) ? reply.acciones : []).filter((a) => actionLabel(a));
      if (!actions.length && claimsDone(reply.respuesta)) reply.respuesta = String(reply.respuesta) + '\n\n**Ojo:** no se agregó nada en la app. Intenta pedírmelo con más detalle.';
    }
    // Confirmaciones parciales que decidió la IA
    let extra = '';
    if (pend) {
      const pick = (arr) => (Array.isArray(arr) ? arr : []).map(Number).filter((n) => n >= 1 && n <= pend.open.length).map((n) => pend.open[n - 1]);
      const yes = pick(reply.confirmar), no = pick(reply.descartar);
      for (const a of no) a._dropped = true;
      if (yes.length) { const r = runProposals(yes); if (!/listo/i.test(String(reply.respuesta || ''))) extra = r; }
    }
    const content = [String(reply.respuesta || '').trim(), extra].filter(Boolean).join(' ') || (actions.length ? 'Te propongo esto:' : 'No tengo una respuesta para eso.');
    const acts = actions.map((a) => ({ ...a, _id: Math.random().toString(36).slice(2), _done: false }));
    // "recordar" se guarda solo (se puede borrar en Ajustes); lo demás espera confirmación
    let remembered = 0;
    for (const a of acts) if (a.tipo === 'recordar') { try { runAction(a); a._done = true; remembered++; } catch { /* */ } }
    if (remembered) commit();
    chat.push({ role: 'assistant', content, at: Date.now(), actions: acts });
    actions = acts.filter((a) => !a._done);
    if (spoken) {
      pauseWake();
      const say = content + (actions.length && !/confirm/i.test(content) ? ` ¿Lo confirmas?` : '');
      faceEvent('speaking', { text: content, pending: actions.length });
      speak(say, () => { faceEvent('spoke', { pending: actions.length }); resumeWake(); });
    } else { sound('xp'); faceEvent('idle', { text: content }); resumeWake(); }
  } catch (e) {
    chat.push({ role: 'assistant', content: e.message || 'No se pudo responder.', error: true });
    sound('error');
    faceEvent('error', { text: e.message || 'No se pudo responder.' });
  }
  busy = false;
  saveChat();
  draw(el);
}

function setMic(el, st, level = 0) {
  micState = st;
  const b = el.querySelector('[data-mic]');
  const input = el.querySelector('[data-in]');
  if (!b) return;
  b.className = `btn icon mic ${st}`;
  b.style.setProperty('--lvl', level);
  if (input) input.placeholder = st === 'listening' ? 'Escuchando… habla y haz una pausa al terminar' : st === 'transcribing' ? 'Entendiendo lo que dijiste…' : 'Escribe o toca el micrófono para hablar';
}

async function toggleMic(el, { fromWake = false } = {}) {
  if (micState === 'listening') { mic?.stop(); return; }
  if (micState === 'transcribing' || busy) return;
  const ok = await canDictate();
  if (!ok.ok) { toast(ok.why, { ms: 5000 }); sound('error'); resumeWake(); return; }
  stopSpeaking();
  const fromFace = faceOpen();
  const sess = faceSession();
  const faceGone = () => fromFace && (!faceOpen() || faceSession() !== sess);
  await pauseWake();
  // Al despertar la tableta la app tarda un momento en verse: se espera antes de escuchar
  const visibleNow = await waitVisible();
  // La carita se cerró mientras se preparaba el micrófono, o la pantalla sigue apagada: no se empieza a escuchar
  if (faceGone() || !visibleNow) { resumeWake(); return; }
  try {
    if (!fromWake) sound('start'); // con "Aries" ya sonó al activarse
    mic = await listen({ onLevel: (l) => { if (micState === 'listening') { setMic(el, 'listening', l); faceEvent('listening', { level: l }); } }, onStopped: () => { setMic(el, 'transcribing'); faceEvent('transcribing'); } });
    if (faceGone()) { mic.stop(); }
    setMic(el, 'listening');
    faceEvent('listening', { level: 0 });
    mic.done.then(() => {}, () => {});
    // Vigilante: se cierra el micrófono si cambia la pantalla, se cerró la carita o pasa el tiempo máximo
    const started = Date.now();
    const maxMs = fromFace ? 25000 : 65000;
    const watch = setInterval(() => { if (micState === 'listening' && (!el.isConnected || faceGone() || reallyHidden() || Date.now() - started > maxMs)) mic?.stop(); }, 500);
    const doneP = mic.done;
    // cuando termina de grabar (silencio o toque), pasa a transcribir
    let hung = false;
    const text = await Promise.race([doneP, new Promise((r) => setTimeout(() => { hung = true; r(''); }, maxMs + 8000))]).finally(() => clearInterval(watch));
    if (hung) mic?.stop(); // el reconocedor no respondió: se apaga a la fuerza
    if (faceGone()) { setMic(el, 'idle'); mic = null; resumeWake(); return; }
    setMic(el, 'idle');
    mic = null;
    if (!text) { if (faceOpen()) faceEvent('nothing'); else toast('No te escuché. Intenta de nuevo.'); resumeWake(); return; }
    const input = el.querySelector('[data-in]');
    if (input) input.value = '';
    send(el, text, { byVoice: true });
  } catch (e) {
    setMic(el, 'idle');
    mic = null;
    resumeWake();
    toast(e.message || 'No se pudo usar el micrófono', { ms: 5000 });
    faceEvent('error', { text: e.message || 'No se pudo usar el micrófono' });
    sound('error');
  }
}

function draw(el) {
  const box = el.querySelector('[data-msgs]');
  if (!box) return;
  box.innerHTML = chat.length ? chat.map((m, i) => m.role === 'user'
    ? `<div class="msg me">${esc(m.content)}</div>`
    : `<div class="msg ai ${m.error ? 'err' : ''}">${md(m.content)}${(m.actions || []).length ? `<div class="acts">${m.actions.map((a) => { const L = actionLabel(a); return `<div class="act">${icon(L.ic, 17)}<div class="grow"><div class="title">${esc(L.t)}</div>${L.s ? `<div class="meta">${esc(L.s)}</div>` : ''}</div>${a._done ? `<span class="pill ok">${icon('check', 12)} ${a.tipo === 'recordar' ? 'Recordado' : 'Agregado'}</span>` : a._dropped ? '<span class="pill">Descartado</span>' : `<button class="btn sm primary" data-act="${i}:${esc(a._id)}">Agregar</button>`}</div>`; }).join('')}${m.actions.filter((a) => !a._done && !a._dropped).length > 1 ? `<button class="btn sm" data-actall="${i}" style="align-self:flex-start">Agregar todo</button>` : ''}</div>` : ''}</div>`).join('')
    + (busy ? `<div class="msg ai typing"><span></span><span></span><span></span></div>` : '')
    : `<div class="empty">${icon('sparkles', 30)}<div>Pregúntame por tu semana, pídeme que agende algo o cuéntame qué comiste.</div></div>`;
  box.scrollTop = box.scrollHeight;
  el.querySelector('[data-send]').disabled = busy;
}

export function render(el) {
  currentEl = el;
  const cfg = aiConfig();
  if (!aiReady()) {
    if (voicePending) { voicePending = false; faceEvent('error', { text: 'Primero configura el asistente en Ajustes → Asistente de IA.' }); }
    el.innerHTML = `<div class="page-head"><div><div class="sub">Con inteligencia artificial</div><h1>Asistente</h1></div></div>
      <div class="card">${`<div class="empty">${icon('sparkles', 34)}<h2>Configura tu asistente</h2><p class="muted" style="max-width:520px">Elige un proveedor de IA y pega tu clave. Groq y Gemini tienen planes gratuitos; Claude se paga por uso. La clave se guarda solo en este dispositivo.</p><button class="btn primary" data-goset>Ir a Ajustes → Asistente</button></div>`}</div>`;
    el.onclick = (e) => { if (e.target.closest('[data-goset]')) { window.go('ajustes'); setTimeout(() => document.querySelector('[data-aicard]')?.scrollIntoView({ behavior: 'smooth' }), 150); } };
    return;
  }
  el.innerHTML = `<div class="page-head"><div><div class="sub">${esc(PROVIDERS[cfg.provider].name)} · conoce tus materias, tareas, agenda, dieta, gimnasio y negocio</div><h1>Asistente</h1></div>
    <div class="head-actions"><button class="btn ghost sm" data-vmode title="Cuándo leer las respuestas en voz alta">${icon(voiceMode === 'apagada' ? 'volume-off' : 'volume', 15)} ${VOICE_MODES[voiceMode]}</button><button class="btn ghost sm" data-clear>${icon('trash', 15)} Borrar chat</button></div></div>
    <div class="card chatcard">
      <div class="msgs" data-msgs></div>
      <div class="chips" data-sugg>${SUGGEST.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <form class="chatbar" data-form><button type="button" class="btn icon mic ${micState}" data-mic aria-label="Hablar">${icon('microphone', 20)}</button><textarea data-in rows="1" placeholder="Escribe o toca el micrófono para hablar"></textarea><button class="btn primary icon" data-send aria-label="Enviar">${icon('send', 18)}</button></form>
      <p class="tiny faint">Lo que preguntes se envía a ${esc(PROVIDERS[cfg.provider].name)} junto con un resumen de tus datos para poder responder. Revisa las acciones antes de agregarlas.</p>
    </div>`;
  draw(el);
  const input = el.querySelector('[data-in]');
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = input.value; input.value = ''; input.style.height = 'auto'; send(el, v); } });
  el.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; send(el, v); });
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('mic' in b.dataset) toggleMic(el);
    else if ('vmode' in b.dataset) {
      const order = ['dictado', 'siempre', 'apagada'];
      voiceMode = order[(order.indexOf(voiceMode) + 1) % 3];
      try { localStorage.setItem(VOICE_LS, voiceMode); } catch { /* */ }
      if (voiceMode === 'apagada') stopSpeaking();
      b.innerHTML = `${icon(voiceMode === 'apagada' ? 'volume-off' : 'volume', 15)} ${VOICE_MODES[voiceMode]}`;
      toast(voiceMode === 'dictado' ? 'Responderé en voz alta cuando me hables' : voiceMode === 'siempre' ? 'Leeré todas las respuestas en voz alta' : 'Respuestas solo en texto');
    }
    else if (b.dataset.s) send(el, b.dataset.s);
    else if ('clear' in b.dataset) { chat = []; saveChat(); draw(el); }
    else if (b.dataset.act || b.dataset.actall) {
      const [mi, aid] = (b.dataset.act || b.dataset.actall + ':').split(':');
      const m = chat[Number(mi)];
      const list = aid ? m.actions.filter((a) => a._id === aid) : m.actions.filter((a) => !a._done && !a._dropped);
      let ok = 0;
      for (const a of list) { try { runAction(a); a._done = true; delete a._dropped; ok++; } catch (err) { toast(`No se pudo: ${actionLabel(a)?.t || ''}${err?.message ? ' (' + err.message + ')' : ''}`); } }
      if (ok) { sound('complete'); toast(ok === 1 ? 'Agregado' : `${ok} elementos agregados`, { icon: 'check' }); }
      saveChat();
      commit();
    }
  };
  if (voicePending) { voicePending = false; setTimeout(() => toggleMic(el, { fromWake: true }), 250); }
  else if (window.innerWidth > 860) input.focus();
}
