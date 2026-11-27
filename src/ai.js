// Asistente de IA: proveedores (Groq, Gemini, Claude), contexto de la app y acciones
import { state, activeSubjects, currentSemester, subjectName } from './store.js';
import { httpRequest } from './platform.js';
import { levelInfo, xpOf, streakFor, gymWeeks, dietStreak } from './xp.js';
import { agendaFor } from './agenda.js';
import { printerContext } from './printer.js';
import { memoryContext } from './memory.js';
import { todayKey, toKey, addDays, parseKey, sum, weekKey, fmtMin, DAYS, MONTHS, nowHM, norm } from './util.js';

export const PROVIDERS = {
  groq: { name: 'Groq', note: 'Gratis con límites diarios · muy rápido', keyUrl: 'https://console.groq.com/keys', model: 'openai/gpt-oss-120b', budget: 9000 },
  gemini: { name: 'Google Gemini', note: 'Nivel gratuito con límites', keyUrl: 'https://aistudio.google.com/apikey', model: 'gemini-flash-latest', budget: 24000 },
  claude: { name: 'Claude (Anthropic)', note: 'De pago por uso · mejor calidad', keyUrl: 'https://console.anthropic.com/settings/keys', model: 'claude-haiku-5-5', budget: 24000 },
};

const LS = 'organizador-ia';
/** Configuración guardada solo en este dispositivo */
export function localAiConfig() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(LS) || '{}'); } catch { /* */ }
  return { provider: c.provider || '', keys: c.keys || {}, models: c.models || {}, lists: c.lists || {} };
}
/** Configuración efectiva: lo local manda; lo compartido (sincronizado por Drive) completa lo que falte */
export function aiConfig() {
  const c = localAiConfig();
  const sh = state.settings.aiShared || null;
  const provider = c.provider || sh?.provider || 'groq';
  return { provider, keys: { ...(sh?.keys || {}), ...c.keys }, models: { ...(sh?.models || {}), ...c.models }, lists: c.lists, shared: !!sh?.keys?.[provider] };
}
export function saveAiConfig(c) {
  const { shared, ...rest } = c;
  void shared;
  try { localStorage.setItem(LS, JSON.stringify(rest)); } catch { /* */ }
}
/** Copia (o quita) la clave en los ajustes que se sincronizan con los otros dispositivos */
export function setAiShared(on) {
  const c = aiConfig();
  if (on) state.settings.aiShared = { provider: c.provider, keys: { ...(state.settings.aiShared?.keys || {}), [c.provider]: c.keys[c.provider] }, models: { ...(state.settings.aiShared?.models || {}), [c.provider]: c.models[c.provider] } };
  else if (state.settings.aiShared) {
    const keys = { ...state.settings.aiShared.keys };
    delete keys[c.provider];
    state.settings.aiShared = Object.keys(keys).length ? { ...state.settings.aiShared, keys } : null;
  }
}
export const aiReady = () => { const c = aiConfig(); return !!c.keys[c.provider]; };
const modelOf = (c) => c.models[c.provider] || PROVIDERS[c.provider].model;

function fail(status, text, provider) {
  let msg = '';
  try { const j = JSON.parse(text); msg = j.error?.message || j.error?.status || j.message || ''; } catch { /* */ }
  const detail = msg ? ` (detalle: ${msg.slice(0, 180)})` : '';
  let e;
  // Modelo que no sirve para esta clave: no existe, cambió de nombre o no está en el plan gratis
  const modelIssue = status === 404 || (status === 400 && /model|not found|not supported/i.test(msg)) || (status === 429 && /limit: 0|free_tier.*limit|not available|billing/i.test(msg)) || (status === 403 && /model|not available|billing/i.test(msg));
  if (modelIssue) e = new Error('Ese modelo no está disponible para tu clave' + detail);
  else if (status === 400 && /credit|balance/i.test(msg)) e = new Error('No tienes saldo en la Claude Console.');
  else if (status === 401 || status === 403 || /api key|API_KEY_INVALID|invalid x-api-key|authentication/i.test(msg)) e = new Error('La clave no es válida. Revísala en Ajustes → Asistente.' + detail);
  else if (status === 429) e = new Error((provider === 'claude' ? 'Llegaste a un límite de uso o se acabó tu saldo en la Consola.' : 'Llegaste al límite del plan gratis por ahora. Espera un minuto o cambia de proveedor.') + detail);
  else e = new Error(`El proveedor respondió con un error (${status})` + detail);
  e.modelIssue = modelIssue;
  return e;
}

/** Orden de preferencia de modelos (los rápidos y gratuitos primero) */
export function rankModels(provider, list) {
  const score = (id) => {
    const s = id.toLowerCase();
    if (provider === 'gemini') {
      if (/pro|omni|ultra|image|tts|audio|live|embedding|robotics|computer|thinking|exp/.test(s)) return 9;
      if (/^gemini-[\d.]+-flash$/.test(s)) return 0;
      if (/^gemini-[\d.]+-flash-lite$/.test(s)) return 1;
      if (/flash-latest|flash-lite-latest/.test(s)) return 2;
      if (/flash/.test(s) && !/preview/.test(s)) return 3;
      if (/gemma/.test(s)) return 4;
      if (/flash/.test(s)) return 5;
      return 8;
    }
    if (provider === 'groq') return /gpt-oss-120b/.test(s) ? 0 : /llama-3\.3-70b/.test(s) ? 1 : /qwen|gpt-oss/.test(s) ? 2 : /llama/.test(s) ? 3 : 6;
    return /haiku/.test(s) ? 0 : /sonnet/.test(s) ? 1 : 3;
  };
  const ver = (id) => Number((id.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  return list.slice().sort((a, b) => score(a) - score(b) || ver(b) - ver(a));
}

/** Envía la conversación; si el modelo no sirve, prueba solo con los siguientes de la lista */
export async function complete(opts) {
  const cfg = opts.cfg || aiConfig();
  if (!cfg.keys[cfg.provider]) throw new Error('Configura el asistente en Ajustes → Asistente.');
  const first = modelOf(cfg);
  try {
    return await completeWith({ ...opts, cfg }, first);
  } catch (e) {
    if (!e.modelIssue) throw e;
    let list = cfg.lists[cfg.provider] || [];
    if (!list.length) { try { list = await listModels(cfg.provider, cfg.keys[cfg.provider]); } catch { throw e; } }
    for (const m of rankModels(cfg.provider, list).filter((x) => x !== first).slice(0, 6)) {
      try {
        const out = await completeWith({ ...opts, cfg }, m);
        const c = localAiConfig();
        c.models[cfg.provider] = m;
        c.lists[cfg.provider] = list;
        saveAiConfig(c);
        return out;
      } catch (e2) { if (!e2.modelIssue) throw e2; }
    }
    throw new Error('Ningún modelo de tu lista funcionó con esta clave. Si usas Gemini, revisa en aistudio.google.com que tu proyecto tenga el nivel gratuito activo, o prueba con Groq.' + (e.message.includes('detalle') ? ' ' + e.message.slice(e.message.indexOf('(')) : ''));
  }
}

async function completeWith({ system, messages, json = true, maxTokens = 1800, cfg }, model) {
  const key = cfg.keys[cfg.provider];
  if (cfg.provider === 'groq') {
    // Los modelos que razonan gastan tokens pensando: se les da más margen y razonamiento corto
    const reasoning = /gpt-oss|qwen3|deepseek-r1/i.test(model);
    const body = { model, temperature: 0.3, max_tokens: reasoning ? maxTokens + 3000 : maxTokens, messages: [{ role: 'system', content: system }, ...messages] };
    const extra = { ...(json ? { response_format: { type: 'json_object' } } : {}), ...(/gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {}) };
    const post = (b) => httpRequest({ method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    let r = await post({ ...body, ...extra });
    if (r.status === 400 && Object.keys(extra).length && !/model/i.test(r.text)) r = await post(body);
    if (r.status !== 200) throw fail(r.status, r.text, 'groq');
    return JSON.parse(r.text).choices?.[0]?.message?.content || '';
  }
  if (cfg.provider === 'gemini') {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens * 2, ...(json ? { responseMimeType: 'application/json' } : {}) },
    };
    const r = await httpRequest({ method: 'POST', url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 200) throw fail(r.status, r.text, 'gemini');
    const j = JSON.parse(r.text);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }
  const r = await httpRequest({
    method: 'POST', url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.3, system, messages }),
  });
  if (r.status !== 200) throw fail(r.status, r.text, 'claude');
  return (JSON.parse(r.text).content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

/** Lista los modelos disponibles para la clave (sirve también para probarla) */
export async function listModels(provider, key) {
  if (provider === 'groq') {
    const r = await httpRequest({ url: 'https://api.groq.com/openai/v1/models', headers: { Authorization: 'Bearer ' + key } });
    if (r.status !== 200) throw fail(r.status, r.text, provider);
    return JSON.parse(r.text).data.map((m) => m.id).filter((id) => !/whisper|tts|guard|orpheus|playai|distil/i.test(id)).sort();
  }
  if (provider === 'gemini') {
    const r = await httpRequest({ url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', headers: { 'x-goog-api-key': key } });
    if (r.status !== 200) throw fail(r.status, r.text, provider);
    return JSON.parse(r.text).models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/image|tts|audio|live|embedding/i.test(m.name)).map((m) => m.name.replace(/^models\//, ''));
  }
  const r = await httpRequest({ url: 'https://api.anthropic.com/v1/models?limit=50', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
  if (r.status !== 200) throw fail(r.status, r.text, provider);
  return JSON.parse(r.text).data.map((m) => m.id);
}

/** Saca el primer objeto JSON de la respuesta (aunque venga con texto alrededor) */
export function parseJsonReply(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* */ } }
  return { respuesta: t, acciones: [] };
}

// ---------- Contexto con los datos de la app ----------
const fechaLarga = (k) => { const d = parseKey(k); return `${DAYS[d.getDay()].toLowerCase()} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`; };

export function buildContext(question = '', budget = 9000) {
  const today = todayKey();
  const s = state.settings;
  const L = [];
  L.push(`Hoy es ${fechaLarga(today)}, son las ${nowHM()}. Usuario: ${s.name || 'sin nombre'}. Moneda: pesos colombianos (COP).`);
  const mem = memoryContext(question, Math.min(2500, Math.round(budget * 0.22)));
  if (mem) L.push(mem);
  const sem = currentSemester();
  const subs = activeSubjects();
  L.push(`\n## Estudio (semestre ${sem?.name || ''})`);
  for (const sub of subs) {
    const info = levelInfo(xpOf('sub:' + sub.id));
    const week = sum(state.studySessions.filter((x) => x.subjectId === sub.id && weekKey(parseKey(x.date)) === weekKey(new Date())), (x) => x.minutes);
    const total = sum(state.studySessions.filter((x) => x.subjectId === sub.id), (x) => x.minutes);
    const topics = state.topics.filter((t) => t.subjectId === sub.id).map((t) => `${t.name} [${t.status || 'pendiente'}]`).join('; ');
    const sched = (sub.schedule || []).map((c) => `${DAYS[c.day]} ${c.start}-${c.end}`).join(', ');
    L.push(`- ${sub.name}: nivel ${info.level}, ${fmtMin(week)} esta semana${sub.goalHours ? ` (meta ${sub.goalHours} h)` : ''}, ${fmtMin(total)} en total, racha ${streakFor('sub:' + sub.id).value} días. Clases: ${sched || 'sin horario'}. Temas: ${topics || 'ninguno'}.`);
  }
  if (!subs.length) L.push('- (sin materias registradas)');
  const exams = state.events.filter((e) => e.type === 'examen' && e.date >= toKey(addDays(new Date(), -30))).sort((a, b) => a.date.localeCompare(b.date));
  const topicExams = state.topics.filter((t) => t.examDate && t.examDate >= today);
  if (exams.length || topicExams.length) {
    L.push('\n## Exámenes');
    for (const e of exams) L.push(`- ${e.date}${e.time ? ' ' + e.time : ''}: ${e.title} (${subjectName(e.subjectId)})${(e.topicIds || []).length ? ', temas: ' + e.topicIds.map((id) => state.topics.find((t) => t.id === id)?.name).filter(Boolean).join(', ') : ''}${e.grade !== undefined && e.grade !== null && e.grade !== '' ? `, nota ${e.grade}/${e.maxGrade || 5}` : ''}`);
    for (const t of topicExams) L.push(`- ${t.examDate}: examen del tema ${t.name} (${subjectName(t.subjectId)})`);
  }
  const pend = state.tasks.filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 40);
  L.push('\n## Tareas pendientes');
  for (const t of pend) L.push(`- ${t.due ? `[${t.due}${t.dueTime ? ' ' + t.dueTime : ''}${t.due < today ? ' VENCIDA' : ''}] ` : '[sin fecha] '}${t.title}${t.subjectId ? ` (${subjectName(t.subjectId)})` : ''}${t.priority === 'alta' ? ' · prioridad alta' : ''}`);
  if (!pend.length) L.push('- (ninguna)');
  const doneWeek = state.tasks.filter((t) => t.done && t.doneAt && t.doneAt >= toKey(addDays(new Date(), -7))).length;
  L.push(`Tareas completadas en los últimos 7 días: ${doneWeek}.`);
  L.push('\n## Agenda de los próximos 14 días');
  for (let i = 0; i < 14; i++) {
    const k = toKey(addDays(new Date(), i));
    const items = agendaFor(k).filter((x) => x.kind !== 'task');
    if (items.length) L.push(`- ${fechaLarga(k)}: ${items.map((x) => `${x.time ? x.time + ' ' : ''}${x.title}`).join('; ')}`);
  }
  const meals = state.meals.filter((m) => m.date === today);
  L.push('\n## Dieta');
  L.push(`Meta: ${s.calorieGoal} kcal${s.dietMode === 'max' ? ' (máximo)' : ` (±${s.calorieMargin}%)`}${s.proteinGoal ? `, proteína ${s.proteinGoal} g` : ''}. Hoy: ${sum(meals, (m) => m.kcal)} kcal y ${sum(meals, (m) => m.protein)} g de proteína (${meals.map((m) => `${m.type}: ${m.desc} ${m.kcal} kcal`).join('; ') || 'nada registrado'}). Racha: ${dietStreak()} días.`);
  const last7 = [...Array(7)].map((_, i) => toKey(addDays(new Date(), -i - 1)));
  L.push(`Últimos 7 días: ${last7.map((k) => `${k.slice(5)} ${sum(state.meals.filter((m) => m.date === k), (m) => m.kcal)} kcal ${state.dietDays[k] === 'ok' ? '✓' : state.dietDays[k] === 'fail' ? '✗' : ''}`).join(', ')}.`);
  const gw = gymWeeks();
  const ws = state.weights.slice().sort((a, b) => a.date.localeCompare(b.date));
  L.push('\n## Gimnasio y cuerpo');
  L.push(`Meta ${gw.goal} entrenos por semana; esta semana ${gw.thisWeek}; racha ${gw.streak} semanas. Peso: ${ws.length ? ws.slice(-4).map((w) => `${w.date} ${w.kg} kg`).join(', ') : 'sin registros'}${s.targetWeight ? `; meta ${s.targetWeight} kg` : ''}. Objetivo: ${s.goal || 'mantener'}.`);
  for (const g of state.gymSessions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)) L.push(`- ${g.date} ${g.muscle || ''}: ${(g.exercises || []).map((e) => `${e.name} ${e.sets}x${e.reps} ${e.weight} kg`).join(', ')}`);
  const mk = today.slice(0, 7);
  const sales = state.sales.filter((x) => x.date.startsWith(mk) && x.status !== 'cotizado');
  if (state.alarms.length) {
    const dn = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    L.push('\n## Alarmas');
    L.push(state.alarms.map((a) => `- ${a.time} ${a.label || 'Alarma'} · ${(a.days || []).length ? a.days.map((d) => dn[d]).join(',') : 'una vez ' + (a.date || '')} · ${a.where || 'tablet'} · ${a.enabled === false ? 'apagada' : 'activa'}`).join('\n'));
  }
  L.push('\n## Negocio de impresión 3D (este mes)');
  L.push(`Ventas: ${sum(sales, (x) => x.price)} COP en ${sales.length} pedidos. Gastos del mes: ${sum(state.expenses.filter((x) => x.date.startsWith(mk) && !x.investment), (x) => x.amount)} COP. Clientes registrados: ${state.clients.length}. Pedidos en producción: ${state.sales.filter((x) => x.status === 'produccion').map((x) => x.desc).join(', ') || 'ninguno'}. Entregados sin pagar: ${state.sales.filter((x) => x.status === 'entregado').map((x) => `${x.desc} ${x.price}`).join(', ') || 'ninguno'}.`);
  const pc = printerContext();
  if (pc) L.push(pc);
  // Apuntes: títulos siempre; contenido solo de los que coinciden con la pregunta
  const words = norm(question).split(/\W+/).filter((w) => w.length > 3);
  const scored = state.notes.map((n) => ({ n, sc: words.filter((w) => norm(n.title + ' ' + n.body + ' ' + subjectName(n.subjectId)).includes(w)).length })).sort((a, b) => b.sc - a.sc);
  L.push('\n## Apuntes');
  L.push(state.notes.length ? state.notes.slice(-30).map((n) => `"${n.title}" (${n.subjectId ? subjectName(n.subjectId) : 'general'})`).join(', ') : '(ninguno)');
  let text = L.join('\n');
  for (const { n, sc } of scored.filter((x) => x.sc > 0).slice(0, 3)) {
    const room = budget - text.length - 200;
    if (room < 400) break;
    text += `\n\nContenido del apunte "${n.title}":\n${String(n.body || '').slice(0, Math.min(room, 3500))}`;
  }
  return text.length > budget ? text.slice(0, budget) + '\n(…recortado)' : text;
}

export const SYSTEM = `Eres el asistente personal dentro de la app "Organizador" de un estudiante universitario en Colombia. Respondes siempre en español, breve y claro, usando sus datos reales (abajo). No inventes datos.
MUY IMPORTANTE: tú NO puedes modificar la app directamente. Lo único que cambia la app son los objetos que pongas en "acciones"; el usuario los ve como tarjetas y los confirma con un botón. Por eso:
- Si el usuario pide crear, agregar, registrar, anotar o completar algo, SIEMPRE incluye la acción correspondiente en "acciones".
- En "respuesta" nunca digas que ya lo hiciste ("creé", "agregué", "listo, quedó"). Di "Te dejo esto para que lo confirmes" o similar.
- El usuario puede confirmar tus propuestas por voz o por chat diciendo "confirmo", "sí", "dale", etc. Por eso, cuando propones acciones, termina preguntando de forma corta si las confirma.
- Si no existe un tipo de acción para lo que pide, dilo con honestidad y explica dónde hacerlo en la app.
Usa fechas AAAA-MM-DD y horas HH:MM (24 h). Resuelve fechas relativas ("el viernes", "mañana") desde la fecha de hoy. Para "materia" usa el nombre exacto de una materia existente cuando aplique.
Para calorías y proteína da estimaciones razonables de porciones típicas colombianas.
Responde SIEMPRE con un objeto JSON válido con esta forma exacta:
{"respuesta": "texto para el usuario (puedes usar **negrita** y listas con - )", "acciones": [ ... ]}
Tipos de acción disponibles (omite los campos que no sepas):
{"tipo":"tarea","titulo":"...","fecha":"AAAA-MM-DD","hora":"HH:MM","materia":"...","prioridad":"alta|media|baja","recordatorio_min":30}
{"tipo":"completar_tarea","titulo":"título de una tarea pendiente existente"}
{"tipo":"evento","subtipo":"evento|reunion|cumpleanos|fecha","titulo":"...","fecha":"AAAA-MM-DD","hora":"HH:MM","lugar":"...","recordatorio_min":60}
{"tipo":"examen","materia":"...","titulo":"Parcial 2","fecha":"AAAA-MM-DD","hora":"HH:MM","temas":["tema 1"]}
{"tipo":"materia","nombre":"...","profesor":"...","creditos":3,"meta_horas":6,"horario":[{"dia":"lunes","inicio":"07:00","fin":"09:00","salon":"..."}]}
{"tipo":"tema","materia":"...","nombre":"...","fecha_examen":"AAAA-MM-DD"}
{"tipo":"estudio","materia":"...","tema":"...","minutos":60,"fecha":"AAAA-MM-DD"}
{"tipo":"nota","titulo":"...","contenido":"...","materia":"..."}
{"tipo":"comida","comida":"Desayuno|Media mañana|Almuerzo|Algo|Cena|Snack","descripcion":"...","kcal":0,"proteina":0,"fecha":"AAAA-MM-DD"}
{"tipo":"peso","kg":70.5,"fecha":"AAAA-MM-DD"}
{"tipo":"entrenamiento","fecha":"AAAA-MM-DD","grupo":"Pierna","ejercicios":[{"nombre":"Sentadilla","series":4,"reps":8,"peso":60}]}
{"tipo":"cliente","nombre":"...","telefono":"...","ciudad":"..."}
{"tipo":"pedido","cliente":"...","descripcion":"...","precio":45000,"cantidad":1,"material":"PLA","gramos":120,"horas":5,"estado":"cotizado|produccion|entregado|pagado","fecha":"AAAA-MM-DD"}
{"tipo":"gasto","concepto":"...","valor":80000,"categoria":"Filamento","inversion":false,"fecha":"AAAA-MM-DD"}
{"tipo":"alarma","hora":"HH:MM","titulo":"Levantarme","dias":["lunes","martes"],"fecha":"AAAA-MM-DD","dispositivo":"tablet|pc|ambos","mensaje":""}
{"tipo":"quitar_alarma","hora":"HH:MM","titulo":"nombre de una alarma existente"}
Alarmas: en "dias" pon los días en que se repite (vacío si es una sola vez; entonces usa "fecha"). "dispositivo" por defecto "tablet". El "titulo" decide qué dice la app al apagarla (levantarse → resumen del día, agua, comida, gimnasio, estudiar, dormir…), así que ponle un nombre claro. Usa "mensaje" solo si el usuario pide que diga algo específico.
Acciones que se hacen de inmediato, sin confirmación:
{"tipo":"abrir_app","app":"Spotify"}  (abre una app instalada por su nombre)
{"tipo":"abrir","destino":"youtube|spotify|maps|ruta|whatsapp|llamar|web","consulta":"lo que hay que buscar o el lugar","texto":"mensaje para WhatsApp","telefono":""}  ("ruta" = llévame a…; WhatsApp solo deja el mensaje listo, el usuario lo envía)
{"tipo":"abrir_documento","nombre":"palabras del nombre del archivo"}
Consultas (la app las hace y te devuelve los resultados para que respondas):
{"tipo":"calcular","expresion":"(2200-650)*0.3","modo":"calcular|derivar|resolver","variable":"x"}  (calcular: cuentas, porcentajes, potencias, raíces, trigonometría, unidades como "5 km to m"; derivar: derivada; resolver: ecuación lineal o cuadrática como "2x^2-3x-5=0")
{"tipo":"buscar_correos","consulta":"sintaxis de búsqueda de Gmail, ej. is:unread, from:juan, newer_than:2d, subject:parcial","cantidad":5,"completo":false}  (completo: true para leer el texto entero, ej. "léeme el último correo")
{"tipo":"buscar_documentos","nombre":"palabras del nombre"}
{"tipo":"leer_documento","nombre":"palabras del nombre"}  (trae el texto del documento para leerlo o resumirlo)
MATEMÁTICAS: nunca hagas cuentas de memoria, ni siquiera las fáciles. Si la respuesta necesita cualquier número calculado (sumas de calorías, precios, ganancias, porcentajes, promedios, conversiones, ejercicios de clase), usa primero "calcular" y responde con el resultado que te devuelva la app. Para ejercicios con varios pasos, puedes pedir varios "calcular" a la vez.
Cuando leas un correo o documento en voz alta, léelo de forma natural: quién lo envía, el asunto y lo importante; si es largo, resúmelo y ofrece leerlo completo.
{"tipo":"recordar","texto":"dato breve y claro, ej. 'Los jueves no puede ir al gimnasio'"}
{"tipo":"olvidar","texto":"el recuerdo que hay que borrar"}
Memoria: usa "recordar" cuando el usuario diga "recuerda que", "no olvides", "ten en cuenta que" o te pida guardar algo sobre él para el futuro. Escríbelo corto y en tercera persona. "recordar" se guarda solo, sin confirmación: en "respuesta" di algo como "Listo, lo tendré en cuenta". Usa "olvidar" si pide olvidar algo. Usa siempre lo que está en "Lo que el usuario te pidió recordar" para personalizar tus respuestas y planes.
Si el usuario solo pregunta algo, "acciones" va vacío.`;

/** ¿La respuesta afirma haber hecho algo sin traer acciones? */
export const claimsDone = (text) => /(?:^|[^a-záéíóúñ])(cre[eé]|he creado|agregu[eé]|he agregado|añad[ií]|he añadido|registr[eé]|he registrado|anot[eé]|guard[eé]|complet[eé]|marqu[eé]|qued[oó] (creada|creado|registrad[oa]|agregad[oa]|lista|listo)|ya (est[aá]|qued[oó]))(?![a-záéíóúñ])/i.test(String(text || ''));

/** Estima calorías y proteína de una comida descrita en texto */
export async function estimateMeal(desc) {
  const txt = await complete({
    system: 'Eres nutricionista. Estimas calorías y proteína de comidas con porciones típicas colombianas. Responde solo JSON: {"kcal": número, "proteina": número, "nota": "una frase corta con los supuestos de porción"}',
    messages: [{ role: 'user', content: `Comida: ${desc}` }],
    maxTokens: 300,
  });
  const j = parseJsonReply(txt);
  return { kcal: Math.round(Number(j.kcal) || 0), protein: Math.round(Number(j.proteina ?? j.protein) || 0), note: j.nota || j.note || '' };
}
