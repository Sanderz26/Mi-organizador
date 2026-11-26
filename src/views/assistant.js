// Chat con el asistente de IA
import { state, commit, upsert, activeSubjects, subjectName, SUBJECT_COLORS } from '../store.js';
import { icon } from '../icons.js';
import { esc, toast, todayKey, norm, weekKey, parseKey, fmtMoney } from '../util.js';
import { aiConfig, aiReady, complete, buildContext, SYSTEM, parseJsonReply, PROVIDERS, claimsDone } from '../ai.js';
import { award, RULES } from '../xp.js';
import { awardStudy } from '../timer.js';
import { toggleTask } from './tasks.js';
import { sound } from '../sound.js';

const LS = 'organizador-ia-chat';
let chat = (() => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } })();
let busy = false;
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
  } else if (a.tipo === 'comida') {
    const types = ['Desayuno', 'Media mañana', 'Almuerzo', 'Algo', 'Cena', 'Snack'];
    upsert('meals', { date: date || todayKey(), type: types.includes(a.comida) ? a.comida : 'Almuerzo', desc: a.descripcion || 'Comida', kcal: Math.round(Number(a.kcal) || 0), protein: Math.round(Number(a.proteina) || 0) });
  }
}

async function send(el, text) {
  if (busy || !text.trim()) return;
  busy = true;
  chat.push({ role: 'user', content: text.trim() });
  saveChat();
  draw(el);
  try {
    const cfg = aiConfig();
    const system = SYSTEM + '\n\n# Datos del usuario\n' + buildContext(text, PROVIDERS[cfg.provider].budget);
    const history = chat.slice(-9).map((m) => ({ role: m.role, content: m.role === 'assistant' ? JSON.stringify({ respuesta: m.content, acciones: [] }) : m.content }));
    let reply = parseJsonReply(await complete({ system, messages: history }));
    let actions = (Array.isArray(reply.acciones) ? reply.acciones : []).filter((a) => actionLabel(a));
    if (!actions.length && claimsDone(reply.respuesta)) {
      // El modelo dijo que lo hizo pero no mandó acciones: se le pide corregir una vez
      reply = parseJsonReply(await complete({ system, messages: [...history, { role: 'assistant', content: JSON.stringify(reply) }, { role: 'user', content: 'No incluiste ninguna acción en "acciones", así que no se creó nada en la app. Responde de nuevo con el mismo JSON pero incluyendo las acciones necesarias según los tipos disponibles, o explica que no es posible.' }] }));
      actions = (Array.isArray(reply.acciones) ? reply.acciones : []).filter((a) => actionLabel(a));
      if (!actions.length && claimsDone(reply.respuesta)) reply.respuesta = String(reply.respuesta) + '\n\n**Ojo:** no se agregó nada en la app. Intenta pedírmelo con más detalle.';
    }
    chat.push({ role: 'assistant', content: String(reply.respuesta || '').trim() || (actions.length ? 'Te propongo esto:' : 'No tengo una respuesta para eso.'), actions: actions.map((a) => ({ ...a, _id: Math.random().toString(36).slice(2), _done: false })) });
    sound('xp');
  } catch (e) {
    chat.push({ role: 'assistant', content: e.message || 'No se pudo responder.', error: true });
    sound('error');
  }
  busy = false;
  saveChat();
  draw(el);
}

function draw(el) {
  const box = el.querySelector('[data-msgs]');
  if (!box) return;
  box.innerHTML = chat.length ? chat.map((m, i) => m.role === 'user'
    ? `<div class="msg me">${esc(m.content)}</div>`
    : `<div class="msg ai ${m.error ? 'err' : ''}">${md(m.content)}${(m.actions || []).length ? `<div class="acts">${m.actions.map((a) => { const L = actionLabel(a); return `<div class="act">${icon(L.ic, 17)}<div class="grow"><div class="title">${esc(L.t)}</div>${L.s ? `<div class="meta">${esc(L.s)}</div>` : ''}</div>${a._done ? `<span class="pill ok">${icon('check', 12)} Agregado</span>` : `<button class="btn sm primary" data-act="${i}:${esc(a._id)}">Agregar</button>`}</div>`; }).join('')}${m.actions.filter((a) => !a._done).length > 1 ? `<button class="btn sm" data-actall="${i}" style="align-self:flex-start">Agregar todo</button>` : ''}</div>` : ''}</div>`).join('')
    + (busy ? `<div class="msg ai typing"><span></span><span></span><span></span></div>` : '')
    : `<div class="empty">${icon('sparkles', 30)}<div>Pregúntame por tu semana, pídeme que agende algo o cuéntame qué comiste.</div></div>`;
  box.scrollTop = box.scrollHeight;
  el.querySelector('[data-send]').disabled = busy;
}

export function render(el) {
  const cfg = aiConfig();
  if (!aiReady()) {
    el.innerHTML = `<div class="page-head"><div><div class="sub">Con inteligencia artificial</div><h1>Asistente</h1></div></div>
      <div class="card">${`<div class="empty">${icon('sparkles', 34)}<h2>Configura tu asistente</h2><p class="muted" style="max-width:520px">Elige un proveedor de IA y pega tu clave. Groq y Gemini tienen planes gratuitos; Claude se paga por uso. La clave se guarda solo en este dispositivo.</p><button class="btn primary" data-goset>Ir a Ajustes → Asistente</button></div>`}</div>`;
    el.onclick = (e) => { if (e.target.closest('[data-goset]')) { window.go('ajustes'); setTimeout(() => document.querySelector('[data-aicard]')?.scrollIntoView({ behavior: 'smooth' }), 150); } };
    return;
  }
  el.innerHTML = `<div class="page-head"><div><div class="sub">${esc(PROVIDERS[cfg.provider].name)} · conoce tus materias, tareas, agenda, dieta, gimnasio y negocio</div><h1>Asistente</h1></div>
    <div class="head-actions"><button class="btn ghost sm" data-clear>${icon('trash', 15)} Borrar chat</button></div></div>
    <div class="card chatcard">
      <div class="msgs" data-msgs></div>
      <div class="chips" data-sugg>${SUGGEST.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <form class="chatbar" data-form><textarea data-in rows="1" placeholder="Escribe o pide algo… (Enter para enviar)"></textarea><button class="btn primary icon" data-send aria-label="Enviar">${icon('send', 18)}</button></form>
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
    if (b.dataset.s) send(el, b.dataset.s);
    else if ('clear' in b.dataset) { chat = []; saveChat(); draw(el); }
    else if (b.dataset.act || b.dataset.actall) {
      const [mi, aid] = (b.dataset.act || b.dataset.actall + ':').split(':');
      const m = chat[Number(mi)];
      const list = aid ? m.actions.filter((a) => a._id === aid) : m.actions.filter((a) => !a._done);
      let ok = 0;
      for (const a of list) { try { runAction(a); a._done = true; ok++; } catch (err) { toast(`No se pudo: ${actionLabel(a)?.t || ''}${err?.message ? ' (' + err.message + ')' : ''}`); } }
      if (ok) { sound('complete'); toast(ok === 1 ? 'Agregado' : `${ok} elementos agregados`, { icon: 'check' }); }
      saveChat();
      commit();
    }
  };
  if (window.innerWidth > 860) input.focus();
}
