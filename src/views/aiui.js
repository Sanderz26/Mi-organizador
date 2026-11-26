// Ajustes del asistente: proveedor, clave y modelo (se guardan solo en este dispositivo)
import { icon } from '../icons.js';
import { esc, toast } from '../util.js';
import { PROVIDERS, aiConfig, localAiConfig, saveAiConfig, setAiShared, listModels, rankModels, complete } from '../ai.js';
import { commit } from '../store.js';
import { listVoices, voicePrefs, setVoicePrefs, speak, prettyVoice } from '../voice.js';
import { sound } from '../sound.js';

const pickModel = (provider, list) => rankModels(provider, list)[0] || PROVIDERS[provider].model;

export function aiCardHtml() {
  const c = aiConfig();
  const p = c.provider;
  const key = c.keys[p] || '';
  const model = c.models[p] || PROVIDERS[p].model;
  return `<div class="card" data-aicard><div class="card-head"><h2>${icon('sparkles', 18)} Asistente de IA</h2>${key ? '<span class="pill ok">Configurado</span>' : ''}</div>
    <div class="form-grid">
      <div class="field"><label>Proveedor</label><select data-aiprov>${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === p ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select><div class="hint">${esc(PROVIDERS[p].note)}</div></div>
      <div class="field"><label>Clave de la API</label><input type="password" data-aikey value="${esc(key)}" placeholder="Pega aquí tu clave" autocomplete="off"><div class="hint"><a href="${PROVIDERS[p].keyUrl}" target="_blank" rel="noopener">Obtener una clave de ${esc(PROVIDERS[p].name)}</a></div></div>
      <div class="field full"><label>Modelo</label><select data-aimodel><option value="${esc(model)}">${esc(model)}</option></select><div class="hint">Toca "Probar" para ver los modelos disponibles con tu clave.</div></div>
      <div class="full field"><label class="checkline"><input type="checkbox" data-aishare ${c.shared ? 'checked' : ''}> Usar esta clave en mis otros dispositivos</label><div class="hint">Se guarda en tu copia sincronizada de Google Drive. Así no tienes que pegarla en cada dispositivo.</div></div>
      <div class="full split"><button class="btn primary sm" data-aitest>${icon('check', 15)} Probar y guardar</button>${key ? `<button class="btn ghost sm danger" data-aidel>Quitar clave</button>` : ''}<span class="small muted" data-aimsg></span></div>
      <div class="full" style="margin-top:6px"><h3 style="display:flex;align-items:center;gap:8px">${icon("volume", 16)} Voz de las respuestas</h3></div>
      <div class="field"><label>Voz</label><select data-voice><option value="">Cargando voces…</option></select><div class="hint">Las voces son las que trae este dispositivo; cada uno guarda su elección.</div></div>
      <div class="field"><label>Velocidad: <span data-ratev>${voicePrefs().rate.toFixed(2)}</span>×</label><input type="range" data-rate min="0.7" max="1.5" step="0.05" value="${voicePrefs().rate}"><div class="hint">El micrófono está en el chat del asistente.</div></div>
      <div class="full split"><button class="btn sm" data-voicetest>${icon('player-play', 15)} Escuchar ejemplo</button></div>
      <p class="full tiny faint">La clave nunca va al código de la app. Si no marcas la casilla, queda solo en este dispositivo. Al usar el asistente, tu pregunta y un resumen de tus datos se envían al proveedor elegido.</p>
    </div></div>`;
}

export function bindAiCard(el, rerender) {
  const card = el.querySelector('[data-aicard]');
  if (!card) return;
  const q = (s) => card.querySelector(s);
  // Voces del dispositivo
  listVoices().then(({ es, others }) => {
    const sel = q('[data-voice]');
    if (!sel) return;
    const cur = voicePrefs().name;
    const opt = (v) => `<option value="${esc(v.id)}" ${v.id === cur ? 'selected' : ''}>${esc(prettyVoice(v))}</option>`;
    sel.innerHTML = `<option value="" ${!cur ? 'selected' : ''}>Automática (español)</option>` + (es.length ? `<optgroup label="Español">${es.map(opt).join('')}</optgroup>` : '') + (others.length ? `<optgroup label="Otros idiomas">${others.map(opt).join('')}</optgroup>` : '');
    if (!es.length) sel.insertAdjacentHTML('afterend', '<div class="hint">Este dispositivo no tiene voces en español instaladas. En Windows: Configuración → Hora e idioma → Voz → Agregar voces.</div>');
  });
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
