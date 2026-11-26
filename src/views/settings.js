// Ajustes, respaldo y restauración
import { state, commit, applySettings, applyData, flush, unblockWrites } from '../store.js';
import { icon } from '../icons.js';
import { esc, toast, todayKey, confirmModal } from '../util.js';
import { exportText, pickFile, ensureNotifyPermission, showNotification, setAutostart, isWindows, isAndroid, platformName } from '../platform.js';
import { refreshReminders } from '../notify.js';
import { sound } from '../sound.js';

const F = (name, label, type = 'text', extra = '') => {
  const v = state.settings[name];
  if (type === 'checkbox') return `<label class="checkline"><input type="checkbox" data-s="${name}" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
  return `<div class="field"><label>${esc(label)}</label><input type="${type}" data-s="${name}" value="${esc(v ?? '')}" ${extra}></div>`;
};
const S = (name, label, opts) => `<div class="field"><label>${esc(label)}</label><select data-s="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(state.settings[name]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;

export function render(el) {
  const counts = `${state.subjects.length} materias · ${state.tasks.length} tareas · ${state.meals.length} comidas · ${state.gymSessions.length} entrenos · ${state.sales.length} pedidos · ${state.notes.length} notas`;
  el.innerHTML = `
  <div class="page-head"><div><div class="sub">Versión ${__APP_VERSION__} · ${platformName === 'windows' ? 'Windows' : platformName === 'android' ? 'Android' : 'Navegador'}</div><h1>Ajustes</h1></div></div>
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>${icon('user', 18)} Perfil y apariencia</h2></div><div class="form-grid">
      ${F('name', '¿Cómo te llamo?')}
      ${S('theme', 'Tema', [['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Según el sistema']])}
      <div class="full">${F('sound', 'Efectos de sonido', 'checkbox')}</div>
      <div class="field full"><label>Volumen</label><input type="range" min="0" max="1" step="0.05" data-s="volume" value="${state.settings.volume}"></div>
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('salad', 18)} Dieta</h2></div><div class="form-grid">
      ${F('calorieGoal', 'Meta diaria de calorías', 'number', 'step="10" min="0"')}
      ${F('proteinGoal', 'Meta de proteína (g)', 'number', 'step="1" min="0"')}
      ${S('dietMode', 'El día se cumple si…', [['range', 'Quedo dentro del margen'], ['max', 'No me paso de la meta']])}
      ${F('calorieMargin', 'Margen (%)', 'number', 'step="1" min="0" max="50"')}
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('barbell', 18)} Gimnasio y cuerpo</h2></div><div class="form-grid">
      ${F('gymWeeklyGoal', 'Entrenos por semana (meta)', 'number', 'step="1" min="1" max="7"')}
      ${F('heightCm', 'Estatura (cm)', 'number', 'step="1"')}
      ${F('targetWeight', 'Peso meta (kg)', 'number', 'step="0.1"')}
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('bell', 18)} Recordatorios</h2></div><div class="form-grid">
      ${S('classReminderMins', 'Avisar antes de cada clase', [[0, 'No avisar'], [5, '5 minutos antes'], [10, '10 minutos antes'], [15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes']])}
      ${S('defaultReminderMins', 'Recordatorio por defecto', [[0, 'A la hora'], [15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes'], [1440, '1 día antes']])}
      <div class="full split"><button class="btn sm" data-perm>${icon('bell', 15)} Activar notificaciones</button><button class="btn sm" data-test>Enviar prueba</button></div>
      ${isWindows ? `<div class="full">${F('closeToTray', 'Al cerrar, seguir en la bandeja para avisarme', 'checkbox')}</div><div class="full">${F('autostart', 'Abrir al iniciar Windows', 'checkbox')}</div>` : ''}
      ${isAndroid ? '<p class="full small muted">Los recordatorios llegan aunque la app esté cerrada. Si no llegan, revisa que la app tenga permiso de notificaciones y alarmas exactas.</p>' : ''}
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('printer', 18)} Negocio 3D</h2></div><div class="form-grid">
      ${F('filamentCostKg', 'Costo del filamento por kg', 'number', 'step="100"')}
      ${F('printerWatts', 'Consumo de la impresora (W)', 'number', 'step="5"')}
      ${F('kwhCost', 'Precio del kWh', 'number', 'step="10"')}
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('device-floppy', 18)} Respaldo</h2></div>
      <p class="small muted">${esc(counts)}</p>
      <p class="small" style="margin:10px 0">Tus datos se guardan en este dispositivo. Exporta un respaldo y guárdalo en tu Google Drive; con él pasas tus datos entre el PC y la tableta.</p>
      <div class="split"><button class="btn primary sm" data-export>${icon('upload', 15)} Exportar respaldo</button><button class="btn sm" data-import>${icon('download', 15)} Restaurar respaldo</button></div>
      <p class="tiny faint" style="margin-top:8px">Los archivos adjuntos no van en el respaldo; solo sus nombres.</p>
    </div>
  </div>`;

  el.onchange = (e) => {
    const k = e.target.dataset.s;
    if (!k) return;
    const t = e.target;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? Number(t.value) : t.value;
    if (['classReminderMins', 'defaultReminderMins'].includes(k)) v = Number(v);
    state.settings[k] = v;
    if (k === 'autostart') setAutostart(v);
    if (isWindows && k === 'closeToTray') window.native.setCloseToTray(v);
    applySettings();
    refreshReminders();
    if (k === 'sound' && v) sound('complete');
    if (k === 'volume') sound('xp');
    commit();
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('perm' in b.dataset) { const ok = await ensureNotifyPermission(); toast(ok ? 'Notificaciones activadas' : 'No se concedió el permiso'); refreshReminders(); }
    else if ('test' in b.dataset) { await ensureNotifyPermission(); showNotification('Organizador', 'Así se verán tus recordatorios'); sound('alarm'); }
    else if ('export' in b.dataset) {
      await flush();
      const ok = await exportText(`respaldo-organizador-${todayKey()}.json`, JSON.stringify(state, null, 1), 'Guardar respaldo');
      if (ok) toast('Respaldo listo');
    } else if ('import' in b.dataset) {
      const [file] = await pickFile('application/json,.json');
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== 'object' || !data.settings) throw new Error('formato');
        if (!(await confirmModal('Esto reemplaza todos los datos de este dispositivo por los del respaldo. ¿Continuar?', 'Restaurar'))) return;
        unblockWrites();
        applyData(data);
        applySettings();
        await flush();
        sound('complete');
        toast('Respaldo restaurado');
        commit();
      } catch { sound('error'); toast('Ese archivo no es un respaldo válido'); }
    }
  };
}
