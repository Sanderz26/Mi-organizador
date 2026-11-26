// Gimnasio: sesiones, ejercicios, récords y peso corporal
import { state, commit, upsert, remove, find } from '../store.js';
import { icon } from '../icons.js';
import { esc, todayKey, nowHM, fmtDate, fmtDateLong, openModal, formModal, confirmModal, emptyState, weekKey, parseKey, addDays, fmtNum } from '../util.js';
import { levelCard, failDialog, bonusDialog } from '../components.js';
import { award, removeRef, RULES, gymWeeks } from '../xp.js';
import { chart, destroyCharts } from '../charts.js';
import { sound } from '../sound.js';

const MUSCLES = ['Pecho', 'Espalda', 'Pierna', 'Hombro', 'Brazos', 'Glúteo', 'Core', 'Cardio', 'Cuerpo completo', 'Pecho y tríceps', 'Espalda y bíceps', 'Pierna y glúteo'];
const norm = (s) => String(s || '').trim().toLowerCase();

export function bestLifts(excludeSessionId) {
  const best = {};
  for (const s of state.gymSessions) {
    if (s.id === excludeSessionId) continue;
    for (const e of s.exercises || []) {
      const k = norm(e.name);
      if (!k || !e.weight) continue;
      if (!best[k] || e.weight > best[k].weight) best[k] = { name: e.name, weight: e.weight, reps: e.reps, date: s.date };
    }
  }
  return best;
}

function exRow(e = {}) {
  return `<div class="grid" data-exrow style="grid-template-columns:minmax(0,2.2fr) repeat(3,minmax(0,1fr)) 36px;gap:8px;align-items:end">
    <div class="field"><label>Ejercicio</label><input type="text" data-k="name" list="gym-names" value="${esc(e.name || '')}" placeholder="Sentadilla"></div>
    <div class="field"><label>Series</label><input type="number" data-k="sets" value="${esc(e.sets ?? '')}" inputmode="numeric" min="0"></div>
    <div class="field"><label>Reps</label><input type="number" data-k="reps" value="${esc(e.reps ?? '')}" inputmode="numeric" min="0"></div>
    <div class="field"><label>Peso kg</label><input type="number" data-k="weight" value="${esc(e.weight ?? '')}" inputmode="decimal" step="any" min="0"></div>
    <button class="btn ghost icon" data-rmrow aria-label="Quitar ejercicio">${icon('x', 16)}</button>
  </div>`;
}

export function sessionDialog(ses = null) {
  const s = ses || { date: todayKey(), start: nowHM(), end: '', muscle: '', exercises: [{}], notes: '' };
  const names = [...new Set(state.gymSessions.flatMap((g) => (g.exercises || []).map((e) => e.name)).filter(Boolean))];
  const ov = openModal({
    title: ses ? 'Editar entrenamiento' : 'Registrar entrenamiento',
    wide: true,
    body: `<div class="form-grid">
      <div class="field"><label>Fecha</label><input type="date" data-f="date" value="${esc(s.date)}"></div>
      <div class="field"><label>Qué entrenaste</label><input type="text" data-f="muscle" list="gym-muscles" value="${esc(s.muscle)}" placeholder="Pierna"></div>
      <div class="field"><label>Hora de entrada</label><input type="time" data-f="start" value="${esc(s.start || '')}"></div>
      <div class="field"><label>Hora de salida</label><input type="time" data-f="end" value="${esc(s.end || '')}"></div>
    </div>
    <datalist id="gym-muscles">${MUSCLES.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="gym-names">${names.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <div class="split"><h3 class="grow">Ejercicios</h3>${!ses ? `<button class="btn sm ghost" data-copy>${icon('repeat', 14)} Copiar último de este grupo</button>` : ''}</div>
    <div data-rows class="grid" style="gap:10px">${(s.exercises?.length ? s.exercises : [{}]).map(exRow).join('')}</div>
    <button class="btn sm" data-addrow style="width:fit-content">${icon('plus', 14)} Agregar ejercicio</button>
    <div class="field"><label>Notas</label><textarea data-f="notes" style="min-height:70px" placeholder="Cómo te sentiste, molestias…">${esc(s.notes || '')}</textarea></div>`,
    foot: `${ses ? `<button class="btn danger" data-del>${icon('trash', 16)} Eliminar</button><div class="spacer"></div>` : ''}<button class="btn ghost" data-cancel>Cancelar</button><button class="btn primary" data-save>${icon('check', 16)} Guardar</button>`,
  });
  const q = (x) => ov.querySelector(x);
  q('[data-addrow]').onclick = () => { q('[data-rows]').insertAdjacentHTML('beforeend', exRow()); q('[data-rows]').lastElementChild.querySelector('input').focus(); };
  q('[data-rows]').addEventListener('click', (e) => { const b = e.target.closest('[data-rmrow]'); if (b) b.closest('[data-exrow]').remove(); });
  q('[data-cancel]').onclick = () => ov.close();
  q('[data-copy]')?.addEventListener('click', () => {
    const m = norm(q('[data-f=muscle]').value);
    const last = state.gymSessions.filter((g) => !m || norm(g.muscle) === m).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!last) { sound('error'); return; }
    if (!m) q('[data-f=muscle]').value = last.muscle;
    q('[data-rows]').innerHTML = (last.exercises || []).map(exRow).join('');
  });
  if (ses) q('[data-del]').onclick = async () => {
    if (!(await confirmModal('¿Eliminar este entrenamiento?'))) return;
    remove('gymSessions', ses.id);
    removeRef('gym:' + ses.id);
    removeRef('gympr:' + ses.id);
    sound('delete'); ov.close(); commit();
  };
  q('[data-save]').onclick = () => {
    const val = (k) => q(`[data-f=${k}]`).value.trim();
    const exercises = [...ov.querySelectorAll('[data-exrow]')].map((r) => {
      const g = (k) => r.querySelector(`[data-k=${k}]`).value;
      return { name: g('name').trim(), sets: Number(g('sets')) || 0, reps: Number(g('reps')) || 0, weight: Number(g('weight')) || 0 };
    }).filter((e) => e.name);
    if (!val('date')) { sound('error'); return; }
    const before = bestLifts(ses?.id);
    const saved = upsert('gymSessions', { ...(ses || {}), date: val('date'), muscle: val('muscle'), start: val('start'), end: val('end'), notes: val('notes'), exercises });
    // XP: sesión + récords + meta semanal
    award('gym', RULES.gymSession, `Entreno ${saved.muscle || ''}`.trim(), 'gym:' + saved.id, { date: saved.date, quiet: !!ses });
    const prs = exercises.filter((e) => e.weight && (!before[norm(e.name)] || e.weight > before[norm(e.name)].weight) && before[norm(e.name)]);
    if (prs.length) award('gym', RULES.gymPR * Math.min(3, prs.length), `Récord: ${prs.map((p) => `${p.name} ${p.weight} kg`).join(', ')}`, 'gympr:' + saved.id, { date: saved.date });
    else removeRef('gympr:' + saved.id);
    const wk = weekKey(parseKey(saved.date));
    const count = state.gymSessions.filter((g) => weekKey(parseKey(g.date)) === wk).length;
    if (count >= state.settings.gymWeeklyGoal && !state.xpLog.some((x) => x.ref === 'gymweek:' + wk)) award('gym', RULES.gymWeekGoal, 'Meta semanal de gimnasio cumplida', 'gymweek:' + wk, { date: saved.date });
    if (ses) sound('complete');
    ov.close();
    commit();
  };
}

async function weightDialog(w = null) {
  const v = await formModal({
    title: w ? 'Editar peso' : 'Registrar peso',
    deleteLabel: w ? 'Eliminar' : null,
    fields: [
      { name: 'date', label: 'Fecha', type: 'date', value: w?.date || todayKey(), required: true },
      { name: 'kg', label: 'Peso (kg)', type: 'number', value: w?.kg || '', required: true, step: 0.1 },
      { name: 'fat', label: '% grasa (opcional)', type: 'number', value: w?.fat || '', step: 0.1 },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('weights', w.id); sound('delete'); commit(); return; }
  upsert('weights', { ...(w || {}), ...v });
  sound('complete');
  commit();
}

export function render(el) {
  destroyCharts();
  const sessions = state.gymSessions.slice().sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')));
  const weights = state.weights.slice().sort((a, b) => a.date.localeCompare(b.date));
  const wk = gymWeeks();
  const lastW = weights.at(-1), firstW = weights[0];
  const best = Object.values(bestLifts()).sort((a, b) => b.weight - a.weight).slice(0, 8);
  const area = { key: 'gym', name: 'Gimnasio', color: 'var(--c-gym)', icon: 'barbell' };
  const s = state.settings;
  const bmi = lastW && s.heightCm ? lastW.kg / (s.heightCm / 100) ** 2 : null;

  // sesiones por semana (últimas 12)
  const weeksL = [], weeksV = [];
  for (let i = 11; i >= 0; i--) { const d = addDays(new Date(), -7 * i); const k = weekKey(d); weeksL.push(fmtDate(k)); weeksV.push(state.gymSessions.filter((g) => weekKey(parseKey(g.date)) === k).length); }

  el.innerHTML = `
  <div class="page-head"><div><div class="sub">${wk.thisWeek} de ${wk.goal} entrenos esta semana</div><h1>Gimnasio</h1></div>
    <div class="head-actions"><button class="btn" data-weight>${icon('scale', 16)} Peso</button><button class="btn primary" data-new>${icon('plus', 16)} Entrenamiento</button></div></div>
  <div class="grid g-side">
    <div class="grid" style="align-content:start">${levelCard(area)}
      <div class="card" style="padding:14px 16px">
        <div class="kv"><span class="muted">Esta semana</span><span>${wk.thisWeek} / ${wk.goal}</span></div>
        <div class="bar" style="--c:var(--c-gym)"><i style="width:${Math.min(100, Math.round((wk.thisWeek / wk.goal) * 100))}%"></i></div>
        <div class="kv"><span class="muted">Racha</span><span>${wk.streak} ${wk.streak === 1 ? 'semana' : 'semanas'}</span></div>
        <div class="kv"><span class="muted">Peso actual</span><span>${lastW ? fmtNum(lastW.kg) + ' kg' : '—'}</span></div>
        <div class="kv"><span class="muted">Cambio total</span><span class="${lastW && firstW && lastW.kg < firstW.kg ? 'down' : ''}">${lastW && firstW && weights.length > 1 ? (lastW.kg - firstW.kg > 0 ? '+' : '') + fmtNum(lastW.kg - firstW.kg) + ' kg' : '—'}</span></div>
        ${bmi ? `<div class="kv"><span class="muted">IMC</span><span>${fmtNum(bmi)}</span></div>` : ''}
        ${s.targetWeight ? `<div class="kv"><span class="muted">Meta</span><span>${fmtNum(s.targetWeight)} kg</span></div>` : ''}
      </div>
      <div class="split"><button class="btn sm" data-bonus>${icon('plus', 14)} XP</button><button class="btn sm danger" data-fail>${icon('minus', 14)} Registrar fallo</button></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="grid g2">
        <div class="card"><div class="card-head"><h2>Peso corporal</h2><button class="btn ghost sm" data-weight>${icon('plus', 14)}</button></div>${weights.length > 1 ? '<div class="chart sm"><canvas data-wchart></canvas></div>' : `<p class="muted small">${weights.length ? 'Registra otro peso para ver la gráfica.' : 'Registra tu peso para seguir tu progreso.'}</p>`}${weights.length ? `<div class="list" style="margin-top:8px">${weights.slice(-3).reverse().map((w) => `<div class="row click" data-w="${esc(w.id)}"><div class="grow small muted">${esc(fmtDate(w.date))}</div><span class="num small">${fmtNum(w.kg)} kg</span></div>`).join('')}</div>` : ''}</div>
        <div class="card"><div class="card-head"><h2>Entrenos por semana</h2></div><div class="chart sm"><canvas data-schart></canvas></div></div>
      </div>
      <div class="card"><div class="card-head"><h2>${icon('trophy', 17)} Récords personales</h2></div>
        ${best.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Ejercicio</th><th class="n">Peso</th><th class="n">Reps</th><th class="n">Fecha</th></tr></thead><tbody>${best.map((b) => `<tr><td>${esc(b.name)}</td><td class="n">${fmtNum(b.weight)} kg</td><td class="n">${b.reps || '—'}</td><td class="n">${esc(fmtDate(b.date))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Tus mejores levantamientos aparecerán aquí.</p>'}
      </div>
      <div class="card"><div class="card-head"><h2>Historial</h2></div>
        ${sessions.length ? `<div class="list">${sessions.slice(0, 40).map((g) => `<div class="row click" data-ses="${esc(g.id)}"><span class="dot" style="--c:var(--c-gym)"></span><div class="grow"><div class="title">${esc(g.muscle || 'Entrenamiento')}</div><div class="meta"><span>${esc(fmtDateLong(g.date))}</span>${g.start ? `<span>${esc(g.start)}${g.end ? '–' + esc(g.end) : ''}</span>` : ''}<span>${(g.exercises || []).length} ejercicios</span></div></div></div>`).join('')}</div>` : emptyState('barbell', 'Registra tu primer entrenamiento.')}
      </div>
    </div>
  </div>`;

  if (weights.length > 1) chart(el.querySelector('[data-wchart]'), { kind: 'line', labels: weights.map((w) => fmtDate(w.date)), series: [{ label: 'Peso', data: weights.map((w) => w.kg), color: 'var(--c-gym)', fill: true }], yFmt: (v) => fmtNum(v) + ' kg' });
  chart(el.querySelector('[data-schart]'), { kind: 'bar', labels: weeksL, series: [{ label: 'Entrenos', data: weeksV, color: 'var(--c-gym)' }, { label: 'Meta', data: weeksV.map(() => wk.goal), color: 'var(--ink-3)', type: 'line', dashed: true }], legend: false, min: 0 });

  el.onclick = (e) => {
    const t = e.target.closest('[data-new],[data-weight],[data-ses],[data-fail],[data-bonus],[data-w]');
    if (!t) return;
    if ('new' in t.dataset) sessionDialog();
    else if ('weight' in t.dataset) weightDialog();
    else if (t.dataset.w) weightDialog(find('weights', t.dataset.w));
    else if (t.dataset.ses) sessionDialog(find('gymSessions', t.dataset.ses));
    else if ('fail' in t.dataset) failDialog('gym');
    else if ('bonus' in t.dataset) bonusDialog('gym');
  };
}
