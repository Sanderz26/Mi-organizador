// Pantalla de Alarmas
import { state, commit, upsert, remove, find } from '../store.js';
import { icon } from '../icons.js';
import { esc, formModal, toast, emptyState, uid } from '../util.js';
import { sound } from '../sound.js';
import { nextTime, oneOffDate, repeatText, untilText, ringsHere, thisDevice, showRinging, BUILTIN_TONES, DEFAULT_TONE, myTones, toneName, previewTone, stopPreview } from '../alarms.js';
import { alarmMessage, alarmKind, KINDS } from '../alarmtalk.js';
import { saveAttachment } from '../platform.js';
import { isAndroid } from '../platform.js';
import { AriesNative, nativePermissions, openNativeSetting } from '../wakeword.js';

const WHERE = { tablet: 'Tableta', pc: 'PC', ambos: 'Tableta y PC' };
const DAY_OPTS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ v: String(d), l: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d] }));
const hm12 = (t) => { const [h, m] = t.split(':').map(Number); const d = new Date(); d.setHours(h, m); return d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }); };

export function render(el) {
  const list = state.alarms.slice().sort((a, b) => a.time.localeCompare(b.time));
  const next = list.filter((a) => a.enabled !== false && ringsHere(a)).map((a) => ({ a, t: nextTime(a) })).filter((x) => x.t).sort((x, y) => x.t - y.t)[0];
  el.innerHTML = `
    <div class="page-head"><div><h1>Alarmas</h1><p class="muted">${next ? `La próxima en este dispositivo suena ${untilText(next.t)} (${esc(next.a.label || hm12(next.a.time))}).` : 'Para levantarte o para lo que sea.'}</p></div>
      <button class="btn primary" data-anew>${icon('plus', 16)} Nueva alarma</button></div>
    ${isAndroid ? '<div data-aperm></div>' : '<div class="card small muted" style="margin-bottom:14px">En el PC, las alarmas suenan si la app está abierta o minimizada en la bandeja (no si el PC está apagado o suspendido).</div>'}
    ${list.length ? `<div class="grid g2">${list.map((a) => {
      const on = a.enabled !== false;
      const t = on ? nextTime(a) : 0;
      return `<div class="card click alarm-card ${on ? '' : 'off'}" data-alarm="${esc(a.id)}">
        <div class="split" style="align-items:flex-start">
          <div><div class="alarm-big num">${esc(hm12(a.time))}</div><div style="font-weight:500">${esc(a.label || 'Alarma')}</div></div>
          <label class="switch" data-stop><input type="checkbox" data-atoggle="${esc(a.id)}" ${on ? 'checked' : ''}><span></span></label>
        </div>
        <div class="small muted" style="margin-top:8px">${esc(repeatText(a))} · ${esc(WHERE[a.where || 'tablet'])}</div>
        <div class="tiny muted" style="margin-top:2px">${icon('volume', 12)} ${esc(toneName(a.tone || DEFAULT_TONE))} · ${a.volume ?? 80}% · ${esc(speechLabel(a))}</div>
        <div class="split" style="margin-top:6px"><span class="tiny ${t ? '' : 'faint'}">${on ? (t ? (ringsHere(a) ? `Suena ${untilText(t)}` : `Suena ${untilText(t)} en ${WHERE[a.where]}`) : 'Ya pasó') : 'Apagada'}</span>${ringsHere(a) ? `<button class="btn ghost sm" data-atry="${esc(a.id)}">${icon('player-play', 14)} Probar</button>` : ''}</div>
      </div>`;
    }).join('')}</div>` : `<div class="card">${emptyState('alarm', 'Todavía no tienes alarmas. También puedes decirle a Aries: "pon una alarma a las 6 de lunes a viernes".', `<button class="btn primary" data-anew>${icon('plus', 16)} Nueva alarma</button>`)}</div>`}
`;

  if (isAndroid) paintPerms(el);
  el.onclick = async (e) => {
    const tg = e.target.closest('[data-atoggle]');
    if (tg) { const a = find('alarms', tg.dataset.atoggle); if (a) { a.enabled = tg.checked; if (a.enabled && !(a.days || []).length && !nextTime(a)) a.date = oneOffDate(a.time); commit(); sound(a.enabled ? 'complete' : 'tap'); } return; }
    if (e.target.closest('[data-stop]')) return;
    const tr = e.target.closest('[data-atry]');
    if (tr) { const a = find('alarms', tr.dataset.atry); if (a) { if (AriesNative) AriesNative.testAlarm({ id: a.id }).catch(() => {}); else showRinging(a, {}); } return; }
    const t = e.target.closest('[data-anew],[data-alarm],[data-aperm-go]');
    if (!t) return;
    const d = t.dataset;
    if ('anew' in d) await alarmDialog();
    else if (d.alarm) await alarmDialog(find('alarms', d.alarm));
    else if (d.apermGo) openNativeSetting(d.apermGo);
  };
}

async function paintPerms(el) {
  const box = el.querySelector('[data-aperm]');
  const p = await nativePermissions().catch(() => null);
  if (!p || !box?.isConnected) return;
  const miss = [['notifications', 'Notificaciones', 'para que suene'], ['exactAlarm', 'Alarmas y recordatorios', 'para que suene a la hora exacta'], ['fullScreen', 'Notificaciones de pantalla completa', 'para que se prenda la pantalla']].filter(([k]) => !p[k]);
  if (!miss.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card" style="margin-bottom:14px;border-color:var(--warn)"><div style="font-weight:600;display:flex;gap:6px;align-items:center">${icon('alert-triangle', 16)} Falta un permiso para que las alarmas funcionen bien</div>
    ${miss.map(([k, t, why]) => `<div class="split" style="margin-top:8px"><span class="small">${esc(t)} <span class="muted">(${why})</span></span><button class="btn sm" data-aperm-go="${k}">Activar</button></div>`).join('')}</div>`;
  const onVis = () => { if (document.visibilityState === 'visible') { if (box.isConnected) paintPerms(el); else document.removeEventListener('visibilitychange', onVis); } };
  document.addEventListener('visibilitychange', onVis);
}

const SPEECH = [['auto', 'Automático según el nombre'], ['resumen', 'Resumen del día'], ['mensaje', 'Un mensaje mío'], ['nada', 'Nada']];
function speechLabel(a) {
  const m = a.speech || (a.summary === false ? 'nada' : 'auto');
  if (m !== 'auto') return { resumen: 'Resumen del día', mensaje: 'Tu mensaje', nada: 'Sin voz' }[m];
  const k = alarmKind(a.label);
  return k ? (KINDS.find(([x]) => x === k)?.[1] || 'Automático') : 'Dice la hora y el nombre';
}

const toneKey = (t) => (!t || t.kind === 'default' ? 'default' : t.kind === 'builtin' ? 'b:' + t.id : t.kind === 'file' ? 'f:' + t.fileId : 'a:' + t.uri);
let androidTones = null;

export async function alarmDialog(a = null) {
  const x = a || { time: '06:00', days: [1, 2, 3, 4, 5], label: '', where: thisDevice(), snooze: 10, enabled: true, volume: 80, ramp: true, vibrate: true, tone: DEFAULT_TONE, speech: 'auto', message: '' };
  if (AriesNative && !androidTones) androidTones = (await AriesNative.listTones().catch(() => ({ tones: [] }))).tones || [];
  // Opciones de tono
  const toneMap = new Map();
  const opts = [];
  const add = (t, l, g) => { const k = toneKey(t); if (toneMap.has(k)) return; toneMap.set(k, t); opts.push({ v: k, l, g }); };
  for (const [id, l] of BUILTIN_TONES) add({ kind: 'builtin', id }, l, 'De la app');
  for (const f of myTones()) add({ kind: 'file', fileId: f.id, name: f.name }, f.name, 'Mis tonos');
  if (AriesNative) {
    add({ kind: 'default' }, 'Predeterminado de Android', 'De la tableta');
    for (const t of androidTones || []) add({ kind: 'android', uri: t.uri, name: t.title }, `${t.title}${t.type === 'llamada' ? ' (llamada)' : ''}`, 'De la tableta');
  }
  const cur = x.tone || DEFAULT_TONE;
  if (!toneMap.has(toneKey(cur))) add(cur, toneName(cur), cur.kind === 'file' ? 'Mis tonos' : 'De la tableta');
  const speech0 = x.speech || (x.summary === false ? 'nada' : 'auto');
  let bound = false;
  let latest = null; // valores actuales del formulario (para los botones de escuchar)

  const v = await formModal({
    title: a ? 'Editar alarma' : 'Nueva alarma',
    deleteLabel: a ? 'Eliminar' : null,
    fields: [
      { name: 'time', label: 'Hora', type: 'time', value: x.time, required: true },
      { name: 'label', label: 'Nombre', type: 'text', value: x.label, placeholder: 'Levantarme, tomar agua, gimnasio…', hint: 'Del nombre depende lo que te dice Aries al apagarla.' },
      { name: 'days', label: 'Repetir', type: 'checks', value: (x.days || []).map(String), options: DAY_OPTS, hint: 'Si no marcas ningún día, suena una sola vez.' },
      { name: 'where', label: 'Dónde suena', type: 'select', value: x.where || 'tablet', options: Object.entries(WHERE).map(([v, l]) => ({ v, l })) },
      { name: 'snooze', label: 'Posponer (minutos)', type: 'number', value: x.snooze ?? 10, min: 1, step: 1 },
      { type: 'section', label: 'Sonido' },
      { name: 'tone', label: 'Tono', type: 'select', value: toneKey(cur), options: opts },
      { name: 'toneFile', label: 'Subir mi propio tono', type: 'file', accept: 'audio/*', hint: 'MP3, M4A, WAV u OGG (máx. 15 MB). Queda en "Mis tonos" y llega también al otro dispositivo.' },
      { name: 'volume', label: `Volumen: ${x.volume ?? 80}%`, type: 'range', value: x.volume ?? 80, full: true },
      { name: 'ramp', label: 'Empezar bajito y subir poco a poco (30 s)', type: 'checkbox', value: x.ramp !== false },
      ...(AriesNative ? [{ name: 'vibrate', label: 'Vibrar', type: 'checkbox', value: x.vibrate !== false }] : []),
      { type: 'section', label: 'Qué te dice Aries al apagarla' },
      { name: 'speech', label: 'Mensaje', type: 'select', value: speech0, options: SPEECH.map(([v, l]) => ({ v, l })) },
      { name: 'message', label: 'Tu mensaje', type: 'text', value: x.message || '', placeholder: 'Ej: Saca la ropa de la lavadora', hint: 'Solo si elegiste "Un mensaje mío".' },
    ],
    extraHtml: `<div class="card" style="margin-top:12px;padding:12px 14px;background:var(--surface-2);box-shadow:none">
      <div class="tiny muted">Aries dirá:</div><div class="small" data-apreview style="margin-top:4px"></div>
      <div class="split" style="margin-top:10px;gap:6px"><button type="button" class="btn sm" data-ptone>${icon('player-play', 14)} Escuchar tono</button><button type="button" class="btn ghost sm" data-psay>${icon('volume', 14)} Escuchar mensaje</button></div></div>`,
    onChange: (val, form) => {
      const modal = form.closest('.modal') || document;
      latest = () => { const cv = { ...val, tone: form.elements.tone.value }; return { ...x, ...cv, tone: toneMap.get(cv.tone) || DEFAULT_TONE, volume: Number(form.elements.volume.value), ramp: form.elements.ramp.checked, vibrate: form.elements.vibrate ? form.elements.vibrate.checked : true }; };
      const live = latest;
      const lab = form.querySelector('label[for="f_volume"]');
      if (lab) lab.textContent = `Volumen: ${val.volume}%`;
      form.elements.message.closest('.field').style.display = val.speech === 'mensaje' ? '' : 'none';
      const pv = modal.querySelector('[data-apreview]');
      if (pv) pv.textContent = alarmMessage(live()) || '(nada, solo deja de sonar)';
      // Subir un tono: se guarda de una y queda elegido
      const file = form.elements.toneFile?.files?.[0];
      if (file && !form.dataset.uploading) {
        if (file.size > 15 * 1024 * 1024) { toast('Ese archivo es muy grande (máx. 15 MB).'); form.elements.toneFile.value = ''; return; }
        form.dataset.uploading = '1';
        const id = uid();
        saveAttachment(file, id).then((meta) => {
          state.files.push({ ...meta, owner: { type: 'tono' } });
          commit();
          const t = { kind: 'file', fileId: id, name: meta.name };
          const k = toneKey(t);
          toneMap.set(k, t);
          const sel = form.elements.tone;
          let grp = [...sel.querySelectorAll('optgroup')].find((g) => g.label === 'Mis tonos');
          if (!grp) { grp = document.createElement('optgroup'); grp.label = 'Mis tonos'; sel.appendChild(grp); }
          const o = new Option(meta.name, k, true, true);
          grp.appendChild(o);
          sel.value = k;
          form.elements.toneFile.value = '';
          toast(`Tono "${meta.name}" guardado`, { icon: 'check' });
        }).catch(() => toast('No se pudo guardar el archivo.')).finally(() => { delete form.dataset.uploading; });
      }
      if (!bound) {
        bound = true;
        modal.querySelector('[data-ptone]')?.addEventListener('click', () => previewTone(latest()));
        modal.querySelector('[data-psay]')?.addEventListener('click', async () => { const { speak } = await import('../voice.js'); const m = alarmMessage(latest()); if (m) speak(m); });
      }
    },
  });
  stopPreview();
  if (!v) return;
  if (v._action === 'delete') { remove('alarms', a.id); commit(); sound('delete'); return; }
  const days = (v.days || []).map(Number);
  const item = { ...(a || {}), time: v.time, label: v.label.trim(), days, where: v.where, snooze: Math.max(1, Number(v.snooze) || 10), enabled: true,
    tone: toneMap.get(v.tone) || DEFAULT_TONE, volume: Math.max(0, Math.min(100, Number(v.volume) || 0)), ramp: !!v.ramp, vibrate: v.vibrate !== false, speech: v.speech, message: v.message.trim() };
  delete item.summary;
  item.date = days.length ? '' : oneOffDate(v.time);
  const saved = upsert('alarms', item);
  commit();
  sound('complete');
  const t = nextTime(saved);
  toast(`Alarma ${t ? 'para ' + untilText(t) : 'guardada'}${ringsHere(saved) ? '' : ` · sonará en ${WHERE[saved.where]}`}`, { icon: 'alarm' });
}
