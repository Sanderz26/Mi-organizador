// Ajustes, respaldo y restauración
import { state, commit, applySettings, applyData, flush, unblockWrites } from '../store.js';
import { icon } from '../icons.js';
import { esc, toast, todayKey, confirmModal, fmtNum } from '../util.js';
import { exportText, pickFile, ensureNotifyPermission, showNotification, setAutostart, isWindows, isAndroid, platformName } from '../platform.js';
import { refreshReminders } from '../notify.js';
import { sound } from '../sound.js';
import { currentWeight, bmiInfo, energy, goalProgress, ACTIVITY, GOALS } from '../health.js';
import { upsert } from '../store.js';
import { syncCardHtml, bindSyncCard } from './syncui.js';
import { checkForUpdates, installUpdate, updateStatus, APP_VERSION } from '../updates.js';

const H = (hint) => (hint ? `<div class="hint">${esc(hint)}</div>` : '');
const F = (name, label, type = 'text', extra = '', hint = '') => {
  const v = state.settings[name];
  if (type === 'checkbox') return `<div class="field"><label class="checkline"><input type="checkbox" data-s="${name}" ${v ? 'checked' : ''}> ${esc(label)}</label>${H(hint)}</div>`;
  return `<div class="field"><label>${esc(label)}</label><input type="${type}" data-s="${name}" value="${esc(type === 'number' ? (v || '') : (v ?? ''))}" ${extra}>${H(hint)}</div>`;
};
const S = (name, label, opts, hint = '') => `<div class="field"><label>${esc(label)}</label><select data-s="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(state.settings[name]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${H(hint)}</div>`;

function bodyPanel() {
  const s = state.settings;
  const kg = currentWeight();
  const bmi = bmiInfo();
  const en = energy();
  const gp = goalProgress();
  const missing = [!kg && 'peso actual', !s.heightCm && 'estatura', !s.age && 'edad', !s.sex && 'sexo'].filter(Boolean);
  return `<div class="card" style="background:var(--surface-2);box-shadow:none;padding:14px 16px">
    ${bmi ? `<div class="kv"><span class="muted">IMC</span><span>${fmtNum(bmi.value)} · ${esc(bmi.cat)}</span></div>` : ''}
    ${en ? `<div class="kv"><span class="muted">Gasto diario estimado</span><span>${en.tdee.toLocaleString('es-CO')} kcal</span></div>
      <div class="kv"><span class="muted">Meta sugerida (${esc(GOALS[s.goal]?.toLowerCase() || '')})</span><span>${en.suggested.toLocaleString('es-CO')} kcal${en.suggested === Number(s.calorieGoal) ? ' ✓' : ` <button class="btn sm" data-usekcal="${en.suggested}" style="margin-left:6px">Usar</button>`}</span></div>
      <div class="kv"><span class="muted">Proteína sugerida</span><span>${en.protein} g${en.protein === Number(s.proteinGoal) ? ' ✓' : ` <button class="btn sm" data-useprot="${en.protein}" style="margin-left:6px">Usar</button>`}</span></div>` : ''}
    ${gp ? `<div class="kv"><span class="muted">Hacia tu peso meta</span><span>${gp.reached ? 'Meta alcanzada' : `${fmtNum(Math.abs(gp.remaining))} kg por ${gp.remaining > 0 ? 'bajar' : 'subir'} · ${gp.pct}%`}</span></div>` : ''}
    ${missing.length ? `<p class="small muted" style="margin-top:6px">Completa ${esc(missing.join(', '))} para calcular tu gasto diario y una meta de calorías sugerida.</p>` : '<p class="tiny faint" style="margin-top:6px">Cálculo con la fórmula Mifflin-St Jeor. Es una estimación; ajústala según cómo responda tu cuerpo.</p>'}
  </div>`;
}

function updMsg(s) {
  switch (s.state) {
    case 'checking': return 'Buscando actualizaciones…';
    case 'downloading': return `Descargando versión ${s.version || ''}${s.percent ? ` (${s.percent}%)` : ''}…`;
    case 'ready': return `La versión ${s.version} está lista para instalarse.`;
    case 'available': return `Hay una versión nueva: ${s.version}.`;
    case 'none': return 'Estás al día.';
    case 'error': return 'No se pudo revisar ahora (¿sin internet?). Se intentará más tarde.';
    case 'dev': return 'Las actualizaciones funcionan en la app instalada.';
    default: return '';
  }
}

export function render(el) {
  const counts = `${state.subjects.length} materias · ${state.tasks.length} tareas · ${state.meals.length} comidas · ${state.gymSessions.length} entrenos · ${state.sales.length} pedidos · ${state.notes.length} notas`;
  el.innerHTML = `
  <div class="page-head"><div><div class="sub">Versión ${__APP_VERSION__} · ${platformName === 'windows' ? 'Windows' : platformName === 'android' ? 'Android' : 'Navegador'}</div><h1>Ajustes</h1></div></div>
  ${syncCardHtml()}
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>${icon('user', 18)} Perfil y apariencia</h2></div><div class="form-grid">
      ${F('name', '¿Cómo te llamo?', 'text', '', 'Aparece en el saludo de Inicio.')}
      ${S('theme', 'Tema', [['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Según el sistema']], 'Colores de toda la app.')}
      <div class="full">${F('sound', 'Efectos de sonido', 'checkbox', '', 'Sonidos al completar, subir de nivel y en los recordatorios.')}</div>
      <div class="field full"><label>Volumen</label><input type="range" min="0" max="1" step="0.05" data-s="volume" value="${state.settings.volume}"></div>
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('scale', 18)} Tu cuerpo y tu objetivo</h2></div><div class="form-grid">
      <div class="field"><label>Peso actual (kg)</label><input type="number" data-weight value="${currentWeight() || ''}" step="0.1" min="0"><div class="hint">Se guarda como un registro de peso de hoy y alimenta tu gráfica.</div></div>
      ${F('targetWeight', 'Peso meta (kg)', 'number', 'step="0.1" min="0"', 'Muestra cuánto te falta, tu avance y una fecha estimada en Gimnasio.')}
      ${F('heightCm', 'Estatura (cm)', 'number', 'step="1" min="0"', 'Para calcular tu IMC y tu gasto diario.')}
      ${F('age', 'Edad', 'number', 'step="1" min="10" max="99"', 'Para calcular tu gasto diario.')}
      ${S('sex', 'Sexo', [['', 'Elegir'], ['hombre', 'Hombre'], ['mujer', 'Mujer']], 'La fórmula de gasto diario cambia según el sexo.')}
      ${S('activity', 'Nivel de actividad', Object.entries(ACTIVITY).map(([k, a]) => [k, a.l]), 'Multiplica tu gasto en reposo.')}
      ${S('goal', 'Objetivo', Object.entries(GOALS), 'Define la meta de calorías y proteína que te sugiero.')}
      <div class="full">${bodyPanel()}</div>
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('salad', 18)} Dieta</h2></div><div class="form-grid">
      ${F('calorieGoal', 'Meta diaria de calorías', 'number', 'step="10" min="0"', 'Con ella se decide si cumpliste el día, tu XP y tus rachas.')}
      ${F('calorieMargin', 'Margen (%)', 'number', 'step="1" min="0" max="50"', 'Cuánto puedes quedarte por encima o por debajo y aun así cumplir.')}
      ${S('dietMode', 'El día se cumple si…', [['range', 'Quedo dentro del margen'], ['max', 'No me paso de la meta']], 'Elige si también cuenta quedarte corto de calorías.')}
      ${F('proteinGoal', 'Meta de proteína (g)', 'number', 'step="1" min="0"', 'Aparece como barra en Dieta y en Inicio.')}
      <div class="full">${F('proteinCounts', 'La proteína también cuenta para cumplir el día', 'checkbox', '', 'Si está activo, necesitas llegar a tu meta de proteína para que el día cuente como cumplido.')}</div>
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('barbell', 18)} Gimnasio</h2></div><div class="form-grid">
      ${F('gymWeeklyGoal', 'Entrenos por semana (meta)', 'number', 'step="1" min="1" max="7"', 'Define tu meta semanal, tu racha de semanas y el bono de XP.')}
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('bell', 18)} Recordatorios</h2></div><div class="form-grid">
      ${S('classReminderMins', 'Avisar antes de cada clase', [[0, 'No avisar'], [5, '5 minutos antes'], [10, '10 minutos antes'], [15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes']], 'Según el horario de tus materias del semestre actual.')}
      ${S('defaultReminderMins', 'Recordatorio por defecto', [[0, 'A la hora'], [15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes'], [1440, '1 día antes']], 'Se preselecciona al crear tareas y eventos nuevos.')}
      <div class="full split"><button class="btn sm" data-perm>${icon('bell', 15)} Activar notificaciones</button><button class="btn sm" data-test>Enviar prueba</button></div>
      ${isWindows ? `<div class="full">${F('closeToTray', 'Al cerrar, seguir en la bandeja para avisarme', 'checkbox', '', 'Si lo apagas, cerrar la ventana cierra la app y los recordatorios se detienen.')}</div><div class="full">${F('autostart', 'Abrir al iniciar Windows', 'checkbox', '', 'Arranca escondida en la bandeja para que no te pierdas avisos.')}</div>` : ''}
      ${isAndroid ? '<p class="full small muted">Los recordatorios llegan aunque la app esté cerrada. Si no llegan, revisa que la app tenga permiso de notificaciones y alarmas exactas.</p>' : ''}
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('printer', 18)} Negocio 3D</h2></div><div class="form-grid">
      ${F('filamentCostKg', 'Costo del filamento por kg', 'number', 'step="100"', 'Valor inicial en cada pedido nuevo para el costo de material.')}
      ${F('printerWatts', 'Consumo de la impresora (W)', 'number', 'step="5"', 'Con las horas de impresión calcula el costo de energía.')}
      ${F('kwhCost', 'Precio del kWh', 'number', 'step="10"', 'Míralo en tu factura de luz.')}
      <p class="full tiny faint">Los pedidos ya guardados conservan los costos con los que se registraron.</p>
    </div></div>
    <div class="card"><div class="card-head"><h2>${icon('download', 18)} Actualizaciones</h2></div>
      <p class="small">Tienes la versión <b>${APP_VERSION}</b>. ${isWindows ? 'La app busca versiones nuevas sola, las descarga en segundo plano y las instala al reiniciarse.' : isAndroid ? 'La app revisa si hay versiones nuevas y te avisa para descargarlas.' : ''}</p>
      <p class="small muted" data-updmsg style="margin:8px 0">${updMsg(updateStatus())}</p>
      <div class="split"><button class="btn sm" data-chkupd>${icon('repeat', 15)} Buscar actualizaciones</button>${['ready', 'available'].includes(updateStatus().state) ? `<button class="btn primary sm" data-instupd>${updateStatus().state === 'ready' ? 'Reiniciar y actualizar' : 'Descargar'}</button>` : ''}</div>
    </div>
    <div class="card"><div class="card-head"><h2>${icon('device-floppy', 18)} Respaldo</h2></div>
      <p class="small muted">${esc(counts)}</p>
      <p class="small" style="margin:10px 0">Exporta una copia completa de tus datos en un archivo. Útil como respaldo extra, además de la sincronización.</p>
      <div class="split"><button class="btn primary sm" data-export>${icon('upload', 15)} Exportar respaldo</button><button class="btn sm" data-import>${icon('download', 15)} Restaurar respaldo</button></div>
      <p class="tiny faint" style="margin-top:8px">Los archivos adjuntos no van en el respaldo; solo sus nombres.</p>
    </div>
  </div>`;

  bindSyncCard(el);
  el.onchange = (e) => {
    if (e.target.matches('[data-weight]')) {
      const kg = Number(e.target.value);
      if (!kg) return;
      const today = state.weights.find((w) => w.date === todayKey());
      upsert('weights', { ...(today || { date: todayKey() }), kg });
      sound('complete');
      commit();
      return;
    }
    const k = e.target.dataset.s;
    if (!k) return;
    const t = e.target;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? Number(t.value) : t.value;
    if (['classReminderMins', 'defaultReminderMins'].includes(k)) v = Number(v);
    if (t.type === 'number' && t.value === '') v = 0;
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
    if (b.dataset.usekcal) { state.settings.calorieGoal = Number(b.dataset.usekcal); sound('complete'); toast('Meta de calorías actualizada'); commit(); }
    else if (b.dataset.useprot) { state.settings.proteinGoal = Number(b.dataset.useprot); sound('complete'); toast('Meta de proteína actualizada'); commit(); }
    else if ('chkupd' in b.dataset) {
      el.querySelector('[data-updmsg]').textContent = 'Buscando…';
      const s = await checkForUpdates(true);
      if (el.querySelector('[data-updmsg]')) render(el);
      if (s.state === 'none') toast('Ya tienes la última versión');
    } else if ('instupd' in b.dataset) installUpdate();
    else if ('perm' in b.dataset) { const ok = await ensureNotifyPermission(); toast(ok ? 'Notificaciones activadas' : 'No se concedió el permiso'); refreshReminders(); }
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
