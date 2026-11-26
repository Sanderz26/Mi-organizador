// Ajustes del asistente: proveedor, clave y modelo (se guardan solo en este dispositivo)
import { icon } from '../icons.js';
import { esc, toast } from '../util.js';
import { PROVIDERS, aiConfig, saveAiConfig, listModels, rankModels, complete } from '../ai.js';
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
      <div class="full split"><button class="btn primary sm" data-aitest>${icon('check', 15)} Probar y guardar</button>${key ? `<button class="btn ghost sm danger" data-aidel>Quitar clave</button>` : ''}<span class="small muted" data-aimsg></span></div>
      <p class="full tiny faint">La clave se guarda solo en este dispositivo: no va al código ni a la sincronización. Al usar el asistente, tu pregunta y un resumen de tus datos se envían al proveedor elegido.</p>
    </div></div>`;
}

export function bindAiCard(el, rerender) {
  const card = el.querySelector('[data-aicard]');
  if (!card) return;
  const q = (s) => card.querySelector(s);
  q('[data-aiprov]').addEventListener('change', (e) => { const c = aiConfig(); c.provider = e.target.value; saveAiConfig(c); rerender(); });
  q('[data-aidel]')?.addEventListener('click', () => { const c = aiConfig(); delete c.keys[c.provider]; saveAiConfig(c); toast('Clave quitada'); rerender(); });
  q('[data-aitest]').addEventListener('click', async () => {
    const c = aiConfig();
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
      q('[data-aimodel]').innerHTML = list.map((m) => `<option value="${esc(m)}" ${m === chosen ? 'selected' : ''}>${esc(m)}</option>`).join('');
      msg.textContent = `Funciona con ${chosen}.`;
      sound('complete');
      toast('Asistente listo', { icon: 'sparkles' });
    } catch (e) { msg.textContent = e.message; sound('error'); }
  });
  q('[data-aimodel]').addEventListener('change', (e) => { const c = aiConfig(); c.models[c.provider] = e.target.value; saveAiConfig(c); toast('Modelo actualizado'); });
}
