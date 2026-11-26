// Ajustes del asistente: proveedor, clave y modelo (se guardan solo en este dispositivo)
import { icon } from '../icons.js';
import { esc, toast } from '../util.js';
import { PROVIDERS, aiConfig, localAiConfig, saveAiConfig, setAiShared, listModels, rankModels, complete } from '../ai.js';
import { commit, state } from '../store.js';
import { listVoices, voicePrefs, setVoicePrefs, speak, prettyVoice, canDictate, voiceEngine } from '../voice.js';
import { REGIONS, normRegion, azureConfig, localAzure, saveAzure, setAzureShared, fetchVoices, prettyAzure, usage, FREE_CHARS } from '../azuretts.js';
import { wakePrefs, setWakePrefs, startWake, stopWake, wakeStatus, onWakeStatus, deleteWakeModel, wakeSupportedHere, wakeWhereNote } from '../wakeword.js';
import { sound } from '../sound.js';

const pickModel = (provider, list) => rankModels(provider, list)[0] || PROVIDERS[provider].model;

function azVoiceOptions(az) {
  const list = az.voices || [];
  if (!list.length) return `<option value="">${az.key ? 'Toca "Probar y guardar" para ver las voces' : 'Primero guarda la clave'}</option>`;
  const cur = az.voice || 'es-CO-SalomeNeural';
  const groups = {};
  for (const v of list) (groups[v.multi ? 'Multilingües (hablan español)' : v.country] ||= []).push(v);
  const order = Object.keys(groups).sort((a, b) => (b === 'Colombia') - (a === 'Colombia') || (a.startsWith('Multi')) - (b.startsWith('Multi')) || a.localeCompare(b, 'es'));
  return order.map((g) => `<optgroup label="${esc(g)}">${groups[g].sort((a, b) => a.name.localeCompare(b.name)).map((v) => `<option value="${esc(v.id)}" ${v.id === cur ? 'selected' : ''}>${esc(prettyAzure(v))}</option>`).join('')}</optgroup>`).join('');
}

export function aiCardHtml() {
  const c = aiConfig();
  const p = c.provider;
  const key = c.keys[p] || '';
  const model = c.models[p] || PROVIDERS[p].model;
  const az = azureConfig();
  const pe = voicePrefs().engine;
  const eng = pe === 'azure' || (pe !== 'sistema' && az.key) ? 'azure' : 'sistema';
  const used = usage();
  return `<div class="card" data-aicard><div class="card-head"><h2>${icon('sparkles', 18)} Asistente de IA</h2>${key ? '<span class="pill ok">Configurado</span>' : ''}</div>
    <div class="form-grid">
      <div class="field"><label>Proveedor</label><select data-aiprov>${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === p ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select><div class="hint">${esc(PROVIDERS[p].note)}</div></div>
      <div class="field"><label>Clave de la API</label><input type="password" data-aikey value="${esc(key)}" placeholder="Pega aquí tu clave" autocomplete="off"><div class="hint"><a href="${PROVIDERS[p].keyUrl}" target="_blank" rel="noopener">Obtener una clave de ${esc(PROVIDERS[p].name)}</a></div></div>
      <div class="field full"><label>Modelo</label><select data-aimodel><option value="${esc(model)}">${esc(model)}</option></select><div class="hint">Toca "Probar" para ver los modelos disponibles con tu clave.</div></div>
      <div class="full field"><label class="checkline"><input type="checkbox" data-aishare ${c.shared ? 'checked' : ''}> Usar esta clave en mis otros dispositivos</label><div class="hint">Se guarda en tu copia sincronizada de Google Drive. Así no tienes que pegarla en cada dispositivo.</div></div>
      <div class="full split"><button class="btn primary sm" data-aitest>${icon('check', 15)} Probar y guardar</button>${key ? `<button class="btn ghost sm danger" data-aidel>Quitar clave</button>` : ''}<span class="small muted" data-aimsg></span></div>
      <div class="full" style="margin-top:6px"><h3 style="display:flex;align-items:center;gap:8px">${icon("volume", 16)} Voz de las respuestas</h3></div>
      <div class="full field"><label>Tipo de voz</label><select data-engine>
        <option value="sistema" ${eng === 'sistema' ? 'selected' : ''}>Voz del dispositivo (gratis, funciona sin internet)</option>
        <option value="azure" ${eng === 'azure' ? 'selected' : ''}>Azure: voces neuronales, más naturales (clave propia)</option></select></div>
      <div class="full form-grid" data-azure ${eng === 'azure' ? '' : 'hidden'} style="gap:12px">
        <div class="field"><label>Clave de Azure (Speech)</label><input type="password" data-azkey value="${esc(az.key)}" placeholder="Clave 1 o Clave 2" autocomplete="off"><div class="hint"><a href="https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices" target="_blank" rel="noopener">Crear el recurso de voz en Azure</a></div></div>
        <div class="field"><label>Región</label><select data-azregion><option value="">Elige la región del recurso</option>${REGIONS.map(([k, n]) => `<option value="${k}" ${k === az.region ? 'selected' : ''}>${esc(n)}</option>`).join('')}${az.region && !REGIONS.some(([k]) => k === az.region) ? `<option value="${esc(az.region)}" selected>${esc(az.region)}</option>` : ''}</select><div class="hint">Sale en el portal, junto a la clave ("Ubicación/Región").</div></div>
        <div class="full field"><label class="checkline"><input type="checkbox" data-azshare ${az.shared ? 'checked' : ''}> Usar esta clave en mis otros dispositivos</label></div>
        <div class="full split"><button class="btn primary sm" data-aztest>${icon('check', 15)} Probar y guardar</button>${az.key ? '<button class="btn ghost sm danger" data-azdel>Quitar clave</button>' : ''}<span class="small muted" data-azmsg></span></div>
        <div class="field"><label>Voz de Azure</label><select data-azvoice>${azVoiceOptions(az)}</select><div class="hint">Al elegir una, la escuchas.</div></div>
        <div class="field"><label>Uso este mes (este dispositivo)</label><div class="small" style="min-height:40px;display:flex;flex-direction:column;justify-content:center;gap:6px"><span>${used.toLocaleString('es-CO')} de ${FREE_CHARS.toLocaleString('es-CO')} caracteres gratis</span><div class="bar"><i style="width:${Math.min(100, (used / FREE_CHARS) * 100).toFixed(1)}%"></i></div></div><div class="hint">Si se acaba el cupo o falla internet, se usa la voz del dispositivo.</div></div>
      </div>
      <div class="field" data-sysvoice ${eng === 'azure' ? 'hidden' : ''}><label>Voz</label><select data-voice><option value="">Cargando voces…</option></select><div class="hint">Las voces son las que trae este dispositivo; cada uno guarda su elección.</div></div>
      <div class="field"><label>Velocidad: <span data-ratev>${voicePrefs().rate.toFixed(2)}</span>×</label><input type="range" data-rate min="0.7" max="1.5" step="0.05" value="${voicePrefs().rate}"><div class="hint">El micrófono está en el chat del asistente.</div></div>
      <div class="full split"><button class="btn sm" data-voicetest>${icon('player-play', 15)} Escuchar ejemplo</button></div>
      <div class="full" style="margin-top:6px"><h3 style="display:flex;align-items:center;gap:8px">${icon('microphone', 16)} Activar con la palabra "Aries"</h3></div>
      <div class="full field"><label class="checkline"><input type="checkbox" data-wake ${wakePrefs().on ? 'checked' : ''} ${wakeSupportedHere() ? '' : 'disabled'}> Escuchar "Aries" para abrir el asistente y empezar a hablar</label>
        <div class="hint">La palabra se detecta dentro del dispositivo: tu audio no sale de aquí hasta que dices "Aries". La primera vez descarga un modelo de voz en español (34 MB). ${esc(wakeWhereNote())}</div></div>
      <div class="field"><label>Sensibilidad</label><select data-wakesens>${[[0.9, 'Baja (menos activaciones por error)'], [0.8, 'Normal'], [0.7, 'Alta (te entiende de más lejos)']].map(([v, l]) => `<option value="${v}" ${Number(wakePrefs().sens) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Estado</label><div class="small" data-wakestate style="min-height:40px;display:flex;align-items:center"></div></div>
      <div class="full split"><button class="btn ghost sm" data-wakedel>Borrar modelo descargado</button></div>
      <p class="full tiny faint">La clave nunca va al código de la app. Si no marcas la casilla, queda solo en este dispositivo. Al usar el asistente, tu pregunta y un resumen de tus datos se envían al proveedor elegido.</p>
    </div></div>`;
}

export function bindAiCard(el, rerender) {
  const card = el.querySelector('[data-aicard]');
  if (!card) return;
  const q = (s) => card.querySelector(s);
  // Activación por voz
  const wakeText = (s) => ({ off: 'Apagado', downloading: `Descargando modelo… ${s.pct || 0}%`, loading: 'Preparando…', listening: 'Escuchando: di "Aries"', paused: 'En pausa (vuelve a escuchar al abrir la app)', error: s.message || 'Error' }[s.state] || '');
  const paintWake = (s) => { const w = card.querySelector('[data-wakestate]'); if (w?.isConnected) { w.textContent = wakeText(s); w.className = 'small ' + (s.state === 'listening' ? 'up' : s.state === 'error' ? 'down' : ''); } };
  paintWake(wakeStatus());
  onWakeStatus(paintWake);
  q('[data-wake]').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const d = await canDictate();
      if (!d.ok) toast('Ojo: ' + d.why, { ms: 6000 });
      setWakePrefs({ on: true });
      startWake(window.onAries);
    } else { setWakePrefs({ on: false }); stopWake(); }
  });
  q('[data-wakesens]').addEventListener('change', (e) => { setWakePrefs({ sens: Number(e.target.value) }); toast('Sensibilidad guardada'); });
  q('[data-wakedel]').addEventListener('click', async () => { setWakePrefs({ on: false }); stopWake(); await deleteWakeModel(); toast('Modelo borrado (se descarga de nuevo si lo activas)'); rerender(); });
  // Voces del dispositivo
  listVoices().then(({ es, others }) => {
    const sel = q('[data-voice]');
    if (!sel) return;
    const cur = voicePrefs().name;
    const opt = (v) => `<option value="${esc(v.id)}" ${v.id === cur ? 'selected' : ''}>${esc(prettyVoice(v))}</option>`;
    sel.innerHTML = `<option value="" ${!cur ? 'selected' : ''}>Automática (español)</option>` + (es.length ? `<optgroup label="Español">${es.map(opt).join('')}</optgroup>` : '') + (others.length ? `<optgroup label="Otros idiomas">${others.map(opt).join('')}</optgroup>` : '');
    if (!es.length) sel.insertAdjacentHTML('afterend', '<div class="hint">Este dispositivo no tiene voces en español instaladas. En Windows: Configuración → Hora e idioma → Voz → Agregar voces.</div>');
  });
  // Voz premium (Azure)
  q('[data-engine]').addEventListener('change', (e) => {
    setVoicePrefs({ engine: e.target.value });
    q('[data-azure]').hidden = e.target.value !== 'azure';
    q('[data-sysvoice]').hidden = e.target.value === 'azure';
    if (e.target.value === 'sistema' || voiceEngine() === 'azure') speak('Hola, así sonarán mis respuestas.');
  });
  const azMsg = (t) => { const m = q('[data-azmsg]'); if (m) m.textContent = t; };
  const shareAz = () => { if (q('[data-azshare]').checked) { setAzureShared(true); commit(); } };
  q('[data-aztest]').addEventListener('click', async () => {
    const key = q('[data-azkey]').value.trim();
    const region = normRegion(q('[data-azregion]').value);
    if (!key || !region) { azMsg('Pega la clave y elige la región.'); sound('error'); return; }
    azMsg('Probando…');
    try {
      const voices = await fetchVoices(key, region);
      const cur = azureConfig().voice;
      saveAzure({ key, region, voices, voice: voices.some((v) => v.id === cur) ? cur : (voices.find((v) => v.id === 'es-CO-SalomeNeural') || voices[0])?.id || '' });
      setVoicePrefs({ engine: 'azure' });
      azMsg('Clave válida. Probando la voz…');
      await speak('Listo. Desde ahora te respondo con esta voz.', null, { azureVoice: azureConfig().voice, strict: true });
      if (q('[data-azshare]').checked) setAzureShared(true);
      commit();
      sound('complete');
      toast(`Azure conectado: ${voices.length} voces en español`, { icon: 'volume' });
      rerender();
    } catch (e) { azMsg(e.message); sound('error'); }
  });
  q('[data-azdel]')?.addEventListener('click', () => { saveAzure({ key: '', region: '', voices: [] }); if (azureConfig().shared || state.settings.ttsShared) { setAzureShared(false); commit(); } toast('Clave de Azure quitada'); rerender(); });
  q('[data-azshare]').addEventListener('change', (e) => {
    if (!azureConfig().key) return; // se aplica al probar y guardar
    if (!e.target.checked) { const c = azureConfig(); saveAzure({ key: c.key, region: c.region, voice: c.voice }); }
    setAzureShared(e.target.checked);
    commit();
    toast(e.target.checked ? 'La clave llegará a tus otros dispositivos al sincronizar' : 'La clave de Azure ya no se comparte');
  });
  q('[data-azvoice]').addEventListener('change', (e) => {
    saveAzure({ voice: e.target.value });
    if (azureConfig().shared) shareAz();
    speak('Hola, así sonarán mis respuestas.', null, { azureVoice: e.target.value, strict: true }).catch((err) => { toast(err.message, { ms: 6000 }); sound('error'); });
  });
  // Con la clave compartida desde otro dispositivo, la lista de voces se baja sola
  { const az = azureConfig(); if (az.key && az.region && !(az.voices || []).length) fetchVoices(az.key, az.region).then((voices) => { saveAzure({ voices }); const sel = q('[data-azvoice]'); if (sel?.isConnected) sel.innerHTML = azVoiceOptions(azureConfig()); }).catch(() => {}); }
  q('[data-voice]').addEventListener('change', (e) => { setVoicePrefs({ name: e.target.value }); speak('Hola, así sonarán mis respuestas.'); });
  q('[data-rate]').addEventListener('input', (e) => { q('[data-ratev]').textContent = Number(e.target.value).toFixed(2); });
  q('[data-rate]').addEventListener('change', (e) => { setVoicePrefs({ rate: Number(e.target.value) }); speak('Así de rápido voy a hablar.'); });
  q('[data-voicetest]').addEventListener('click', () => speak('Hola. Esta semana tienes dos clases de Cálculo y un parcial el miércoles. Te dejé una tarea para que la confirmes.'));
  q('[data-aiprov]').addEventListener('change', (e) => { const c = localAiConfig(); c.provider = e.target.value; saveAiConfig(c); rerender(); });
  q('[data-aidel]')?.addEventListener('click', () => { const c = localAiConfig(); const p = aiConfig().provider; delete c.keys[p]; saveAiConfig(c); if (aiConfig().shared) { setAiShared(false); commit(); } toast('Clave quitada'); rerender(); });
  q('[data-aishare]').addEventListener('change', (e) => {
    if (!aiConfig().keys[aiConfig().provider]) return; // se aplicará al tocar "Probar y guardar"
    if (!e.target.checked) { const eff = aiConfig(); const loc = localAiConfig(); loc.provider = eff.provider; loc.keys[eff.provider] = eff.keys[eff.provider]; loc.models[eff.provider] = eff.models[eff.provider]; saveAiConfig(loc); }
    setAiShared(e.target.checked);
    commit();
    toast(e.target.checked ? 'La clave llegará a tus otros dispositivos al sincronizar' : 'La clave ya no se comparte');
  });
  q('[data-aitest]').addEventListener('click', async () => {
    const c = { ...localAiConfig(), provider: aiConfig().provider };
    const key = q('[data-aikey]').value.trim();
    const msg = q('[data-aimsg]');
    if (!key) { msg.textContent = 'Pega tu clave primero.'; sound('error'); return; }
    msg.textContent = 'Probando…';
    try {
      const list = rankModels(c.provider, await listModels(c.provider, key));
      c.keys[c.provider] = key;
      c.models[c.provider] = pickModel(c.provider, list);
      c.lists[c.provider] = list;
      saveAiConfig(c);
      msg.textContent = 'Clave válida. Probando una respuesta…';
      // Prueba real: si el primer modelo no responde, complete() busca otro y lo guarda
      await complete({ system: 'Responde solo JSON: {"ok": true}', messages: [{ role: 'user', content: 'ping' }], maxTokens: 20 });
      const chosen = aiConfig().models[c.provider];
      if (q('[data-aishare]').checked) { setAiShared(true); commit(); }
      q('[data-aimodel]').innerHTML = list.map((m) => `<option value="${esc(m)}" ${m === chosen ? 'selected' : ''}>${esc(m)}</option>`).join('');
      msg.textContent = `Funciona con ${chosen}.`;
      sound('complete');
      toast('Asistente listo', { icon: 'sparkles' });
    } catch (e) { msg.textContent = e.message; sound('error'); }
  });
  q('[data-aimodel]').addEventListener('change', (e) => { const c = localAiConfig(); const p = aiConfig().provider; c.models[p] = e.target.value; saveAiConfig(c); if (aiConfig().shared) { setAiShared(true); commit(); } toast('Modelo actualizado'); });
}
