// Asistente de IA: proveedores (Groq, Gemini, Claude), contexto de la app y acciones
import { state, activeSubjects, currentSemester, subjectName } from './store.js';
import { httpRequest } from './platform.js';
import { levelInfo, xpOf, streakFor, gymWeeks, dietStreak } from './xp.js';
import { agendaFor } from './agenda.js';
import { todayKey, toKey, addDays, parseKey, sum, weekKey, fmtMin, DAYS, MONTHS, nowHM, norm } from './util.js';

export const PROVIDERS = {
  groq: { name: 'Groq', note: 'Gratis con límites diarios · muy rápido', keyUrl: 'https://console.groq.com/keys', model: 'openai/gpt-oss-120b', budget: 9000 },
  gemini: { name: 'Google Gemini', note: 'Nivel gratuito con límites', keyUrl: 'https://aistudio.google.com/apikey', model: 'gemini-flash-latest', budget: 24000 },
  claude: { name: 'Claude (Anthropic)', note: 'De pago por uso · mejor calidad', keyUrl: 'https://console.anthropic.com/settings/keys', model: 'claude-haiku-5-5', budget: 24000 },
};

const LS = 'organizador-ia';
export function aiConfig() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(LS) || '{}'); } catch { /* */ }
  return { provider: c.provider || 'groq', keys: c.keys || {}, models: c.models || {} };
}
export function saveAiConfig(c) { try { localStorage.setItem(LS, JSON.stringify(c)); } catch { /* */ } }
export const aiReady = () => { const c = aiConfig(); return !!c.keys[c.provider]; };
const modelOf = (c) => c.models[c.provider] || PROVIDERS[c.provider].model;

function fail(status, text, provider) {
  let msg = '';
  try { const j = JSON.parse(text); msg = j.error?.message || j.error?.status || j.message || ''; } catch { /* */ }
  if (status === 401 || status === 403 || /api key|API_KEY_INVALID|invalid x-api-key|authentication/i.test(msg)) return new Error('La clave no es válida. Revísala en Ajustes → Asistente.');
  if (status === 429) return new Error(provider === 'claude' ? 'Llegaste a un límite de uso o se acabó tu saldo en la Consola.' : 'Llegaste al límite del plan gratis. Espera un minuto o cambia de proveedor en Ajustes.');
  if (status === 404 || /model/i.test(msg)) return new Error('El modelo no está disponible. En Ajustes → Asistente toca "Probar" y elige otro de la lista.');
  if (status === 400 && /credit|balance/i.test(msg)) return new Error('No tienes saldo en la Claude Console.');
  return new Error(`El proveedor respondió con un error (${status})${msg ? ': ' + msg.slice(0, 160) : ''}`);
}

/** Envía la conversación y devuelve el texto de la respuesta */
export async function complete({ system, messages, json = true, maxTokens = 1800, cfg = aiConfig() }) {
  const key = cfg.keys[cfg.provider];
  if (!key) throw new Error('Configura el asistente en Ajustes → Asistente.');
  const model = modelOf(cfg);
  if (cfg.provider === 'groq') {
    const body = { model, temperature: 0.3, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] };
    let r = await httpRequest({ method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(json ? { ...body, response_format: { type: 'json_object' } } : body) });
    if (r.status === 400 && json) r = await httpRequest({ method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  L.push('\n## Negocio de impresión 3D (este mes)');
  L.push(`Ventas: ${sum(sales, (x) => x.price)} COP en ${sales.length} pedidos. Gastos del mes: ${sum(state.expenses.filter((x) => x.date.startsWith(mk) && !x.investment), (x) => x.amount)} COP. Clientes registrados: ${state.clients.length}. Pedidos en producción: ${state.sales.filter((x) => x.status === 'produccion').map((x) => x.desc).join(', ') || 'ninguno'}. Entregados sin pagar: ${state.sales.filter((x) => x.status === 'entregado').map((x) => `${x.desc} ${x.price}`).join(', ') || 'ninguno'}.`);
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

export const SYSTEM = `Eres el asistente personal dentro de la app "Organizador" de un estudiante universitario en Colombia. Respondes siempre en español, de forma breve, clara y útil, usando sus datos reales (abajo). No inventes datos que no estén.
Puedes proponer acciones para que el usuario las confirme: crear tareas, eventos, exámenes o registrar comidas. Usa fechas en formato AAAA-MM-DD y horas HH:MM (24 h). Resuelve fechas relativas ("el viernes", "mañana") a partir de la fecha de hoy.
Para calorías y proteína da estimaciones razonables de porciones típicas colombianas.
Responde SIEMPRE con un objeto JSON válido con esta forma exacta:
{"respuesta": "texto para el usuario (puedes usar **negrita** y listas con - )", "acciones": [ ... ]}
Cada acción es uno de estos objetos (omite campos que no sepas):
{"tipo":"tarea","titulo":"...","fecha":"AAAA-MM-DD","hora":"HH:MM","materia":"nombre exacto de la materia","prioridad":"alta|media|baja","recordatorio_min":30}
{"tipo":"evento","subtipo":"evento|reunion|cumpleanos|fecha","titulo":"...","fecha":"AAAA-MM-DD","hora":"HH:MM","lugar":"...","recordatorio_min":60}
{"tipo":"examen","materia":"...","titulo":"Parcial 2","fecha":"AAAA-MM-DD","hora":"HH:MM","temas":["tema 1","tema 2"]}
{"tipo":"comida","comida":"Desayuno|Media mañana|Almuerzo|Algo|Cena|Snack","descripcion":"...","kcal":0,"proteina":0,"fecha":"AAAA-MM-DD"}
Si el usuario solo pregunta algo, "acciones" va vacío. No propongas acciones que no pidió.`;

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
