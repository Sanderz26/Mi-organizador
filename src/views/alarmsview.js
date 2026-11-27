// Pantalla de Alarmas
import { state, commit, upsert, remove, find } from '../store.js';
import { icon } from '../icons.js';
import { esc, formModal, toast, emptyState } from '../util.js';
import { sound } from '../sound.js';
import { nextTime, oneOffDate, repeatText, untilText, ringsHere, thisDevice, showRinging, daySummary } from '../alarms.js';
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
        <div class="small muted" style="margin-top:8px">${esc(repeatText(a))} · ${esc(WHERE[a.where || 'tablet'])}${a.summary ? ' · con resumen del día' : ''}</div>
        <div class="tiny ${t ? '' : 'faint'}" style="margin-top:4px">${on ? (t ? (ringsHere(a) ? `Suena ${untilText(t)}` : `Suena ${untilText(t)} en ${WHERE[a.where]}`) : 'Ya pasó') : 'Apagada'}</div>
      </div>`;
    }).join('')}</div>` : `<div class="card">${emptyState('alarm', 'Todavía no tienes alarmas. También puedes decirle a Aries: "pon una alarma a las 6 de lunes a viernes".', `<button class="btn primary" data-anew>${icon('plus', 16)} Nueva alarma</button>`)}</div>`}
    ${list.length ? `<div class="split" style="margin-top:14px"><button class="btn ghost sm" data-atest>${icon('player-play', 15)} Probar cómo suena</button><button class="btn ghost sm" data-asay>${icon('volume', 15)} Escuchar el resumen del día</button></div>` : ''}`;

  if (isAndroid) paintPerms(el);
  el.onclick = async (e) => {
    const tg = e.target.closest('[data-atoggle]');
    if (tg) { const a = find('alarms', tg.dataset.atoggle); if (a) { a.enabled = tg.checked; if (a.enabled && !(a.days || []).length && !nextTime(a)) a.date = oneOffDate(a.time); commit(); sound(a.enabled ? 'complete' : 'tap'); } return; }
    if (e.target.closest('[data-stop]')) return;
    const t = e.target.closest('[data-anew],[data-alarm],[data-atest],[data-asay],[data-aperm-go]');
    if (!t) return;
    const d = t.dataset;
    if ('anew' in d) await alarmDialog();
    else if (d.alarm) await alarmDialog(find('alarms', d.alarm));
    else if ('atest' in d) showRinging({ id: 'prueba', label: 'Prueba de alarma', time: '', snooze: 10, summary: false }, {});
    else if ('asay' in d) { const { speak } = await import('../voice.js'); speak(daySummary()); }
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

export async function alarmDialog(a = null) {
  const x = a || { time: '06:00', days: [1, 2, 3, 4, 5], label: '', where: thisDevice(), snooze: 10, summary: true, enabled: true };
  const v = await formModal({
    title: a ? 'Editar alarma' : 'Nueva alarma',
    deleteLabel: a ? 'Eliminar' : null,
    fields: [
      { name: 'time', label: 'Hora', type: 'time', value: x.time, required: true },
      { name: 'label', label: 'Nombre', type: 'text', value: x.label, placeholder: 'Levantarme, tomar agua…' },
      { name: 'days', label: 'Repetir', type: 'checks', value: (x.days || []).map(String), options: DAY_OPTS, hint: 'Si no marcas ningún día, suena una sola vez.' },
      { name: 'where', label: 'Dónde suena', type: 'select', value: x.where || 'tablet', options: Object.entries(WHERE).map(([v, l]) => ({ v, l })) },
      { name: 'snooze', label: 'Posponer (minutos)', type: 'number', value: x.snooze ?? 10, min: 1, step: 1 },
      { name: 'summary', label: 'Al apagarla, Aries me dice el resumen del día', type: 'checkbox', value: !!x.summary, hint: 'Clases, eventos y tareas de hoy, en voz alta. No gasta IA.' },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('alarms', a.id); commit(); sound('delete'); return; }
  const days = (v.days || []).map(Number);
  const item = { ...(a || {}), time: v.time, label: v.label.trim(), days, where: v.where, snooze: Math.max(1, Number(v.snooze) || 10), summary: !!v.summary, enabled: true };
  item.date = days.length ? '' : oneOffDate(v.time);
  const saved = upsert('alarms', item);
  commit();
  sound('complete');
  const t = nextTime(saved);
  toast(`Alarma ${t ? 'para ' + untilText(t) : 'guardada'}${ringsHere(saved) ? '' : ` · sonará en ${WHERE[saved.where]}`}`, { icon: 'alarm' });
}
