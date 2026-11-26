// Dieta: comidas, calorías, cumplimiento diario y rachas
import { state, commit, upsert, remove, find } from '../store.js';
import { icon } from '../icons.js';
import { esc, todayKey, parseKey, toKey, addDays, fmtDateLong, fmtDate, formModal, emptyState, sum, openModal, relDay } from '../util.js';
import { levelCard, failDialog, bonusDialog } from '../components.js';
import { award, removeRef, RULES, dietStreak, dietBest } from '../xp.js';
import { chart, destroyCharts } from '../charts.js';
import { sound } from '../sound.js';

const TYPES = ['Desayuno', 'Media mañana', 'Almuerzo', 'Algo', 'Cena', 'Snack'];
let day = todayKey();

function guessType() {
  const h = new Date().getHours();
  return h < 10 ? 'Desayuno' : h < 12 ? 'Media mañana' : h < 15 ? 'Almuerzo' : h < 18 ? 'Algo' : 'Cena';
}

export function frequentFoods() {
  const m = {};
  for (const x of state.meals) {
    const k = x.desc.trim().toLowerCase();
    if (!k) continue;
    (m[k] ||= { desc: x.desc, kcal: x.kcal, protein: x.protein, n: 0 }).n++;
  }
  return Object.values(m).sort((a, b) => b.n - a.n);
}

export async function mealDialog(meal = null, preset = {}) {
  const v = await formModal({
    title: meal ? 'Editar comida' : 'Registrar comida',
    deleteLabel: meal ? 'Eliminar' : null,
    fields: [
      { name: 'type', label: 'Comida', type: 'select', value: meal?.type || preset.type || guessType(), options: TYPES },
      { name: 'date', label: 'Fecha', type: 'date', value: meal?.date || preset.date || todayKey() },
      { name: 'desc', label: 'Qué comiste', type: 'text', value: meal?.desc || '', required: true, full: true, placeholder: 'Arroz, pollo a la plancha y ensalada' },
      { name: 'kcal', label: 'Calorías (kcal)', type: 'number', value: meal?.kcal ?? '', required: true, min: 0, step: 1 },
      { name: 'protein', label: 'Proteína (g, opcional)', type: 'number', value: meal?.protein ?? '', min: 0, step: 1 },
      { name: 'time', label: 'Hora', type: 'time', value: meal?.time || '' },
    ],
    extraHtml: !meal && frequentFoods().length ? `<div><div class="small muted" style="margin-bottom:6px">Frecuentes (toca para llenar):</div><div class="split" data-freq>${frequentFoods().slice(0, 8).map((f, i) => `<button class="btn sm" type="button" data-fi="${i}">${esc(f.desc)} · ${f.kcal} kcal</button>`).join('')}</div></div>` : '',
  });
  if (!v) return;
  if (v._action === 'delete') { remove('meals', meal.id); sound('delete'); commit(); return; }
  upsert('meals', { ...(meal || {}), ...v, kcal: v.kcal || 0, protein: v.protein || 0 });
  sound('complete');
  commit();
}
// Rellena con comidas frecuentes
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fi]');
  if (!b) return;
  const f = frequentFoods()[Number(b.dataset.fi)];
  const form = b.closest('.modal').querySelector('form');
  form.elements.desc.value = f.desc;
  form.elements.kcal.value = f.kcal;
  if (f.protein) form.elements.protein.value = f.protein;
});

export function evaluateDay(key) {
  const s = state.settings;
  const total = sum(state.meals.filter((m) => m.date === key), (m) => m.kcal);
  const goal = Number(s.calorieGoal) || 0;
  const margin = goal * (Number(s.calorieMargin) || 0) / 100;
  const ok = s.dietMode === 'max' ? total > 0 && total <= goal : total >= goal - margin && total <= goal + margin;
  return { total, goal, margin, ok };
}

export function setDay(key, status) {
  if (status === 'ok') {
    const prevStreak = dietStreak(toKey(addDays(parseKey(key), -1)));
    state.dietDays[key] = 'ok';
    award('diet', RULES.dietDay + RULES.dietStreakBonus * Math.min(prevStreak, 10), prevStreak ? `Día cumplido · racha de ${prevStreak + 1}` : 'Día de dieta cumplido', 'diet:' + key, { date: key });
  } else if (status === 'fail') {
    state.dietDays[key] = 'fail';
    removeRef('diet:' + key);
    sound('fail');
  } else {
    delete state.dietDays[key];
    removeRef('diet:' + key);
  }
  commit();
}

function closeDayDialog(key) {
  const ev = evaluateDay(key);
  const s = state.settings;
  const range = s.dietMode === 'max' ? `máximo ${ev.goal.toLocaleString('es-CO')} kcal` : `${Math.round(ev.goal - ev.margin).toLocaleString('es-CO')} – ${Math.round(ev.goal + ev.margin).toLocaleString('es-CO')} kcal`;
  const ov = openModal({
    title: 'Cerrar el día',
    body: `<p>Consumiste <b>${ev.total.toLocaleString('es-CO')} kcal</b>. Tu objetivo es ${range}.</p>
      <p class="${ev.ok ? 'up' : 'down'}" style="font-weight:600">${ev.ok ? 'Según tus calorías, cumpliste.' : 'Según tus calorías, no cumpliste.'}</p>
      <p class="small muted">Tú decides: puedes marcarlo distinto si lo consideras.</p>`,
    foot: `<button class="btn" data-fail>${icon('x', 16)} No cumplí</button><button class="btn primary" data-ok>${icon('check', 16)} Cumplí</button>`,
  });
  ov.querySelector('[data-ok]').onclick = () => { ov.close(); setDay(key, 'ok'); };
  ov.querySelector('[data-fail]').onclick = () => { ov.close(); setDay(key, 'fail'); };
}

export function render(el) {
  destroyCharts();
  const s = state.settings;
  const meals = state.meals.filter((m) => m.date === day).sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || (a.time || '').localeCompare(b.time || ''));
  const ev = evaluateDay(day);
  const prot = sum(meals, (m) => m.protein);
  const pct = ev.goal ? Math.round((ev.total / ev.goal) * 100) : 0;
  const status = state.dietDays[day];
  const area = { key: 'diet', name: 'Dieta', color: 'var(--c-diet)', icon: 'salad' };
  const rest = ev.goal - ev.total;

  // mapa de constancia (últimas 15 semanas)
  const start = addDays(new Date(), -104);
  const cells = [];
  for (let i = 0; i < 105; i++) { const k = toKey(addDays(start, i)); const st = state.dietDays[k]; cells.push(`<i class="${st === 'ok' ? 'ok' : st === 'fail' ? 'bad' : ''}" title="${esc(fmtDate(k))}${st ? ' · ' + (st === 'ok' ? 'cumplido' : 'no cumplido') : ''}"></i>`); }
  const closed = Object.values(state.dietDays);
  const rate = closed.length ? Math.round((closed.filter((x) => x === 'ok').length / closed.length) * 100) : 0;

  // últimos 30 días
  const L = [], V = [];
  for (let i = 29; i >= 0; i--) { const k = toKey(addDays(new Date(), -i)); L.push(fmtDate(k)); V.push(sum(state.meals.filter((m) => m.date === k), (m) => m.kcal) || null); }

  const groups = TYPES.map((t) => [t, meals.filter((m) => m.type === t)]).filter(([, a]) => a.length);
  el.innerHTML = `
  <div class="page-head"><div><div class="sub">Meta diaria: ${Number(ev.goal).toLocaleString('es-CO')} kcal${s.dietMode === 'max' ? ' (máximo)' : ` (±${s.calorieMargin}%)`}</div><h1>Dieta</h1></div>
    <div class="head-actions"><button class="btn primary" data-add>${icon('plus', 16)} Comida</button></div></div>
  <div class="grid g-side">
    <div class="grid" style="align-content:start">${levelCard(area)}
      <div class="card" style="padding:14px 16px">
        <div class="kv"><span class="muted">Racha actual</span><span>${dietStreak()} ${dietStreak() === 1 ? 'día' : 'días'}</span></div>
        <div class="kv"><span class="muted">Mejor racha</span><span>${dietBest()} ${dietBest() === 1 ? 'día' : 'días'}</span></div>
        <div class="kv"><span class="muted">Días cumplidos</span><span>${rate}%</span></div>
      </div>
      <div class="split"><button class="btn sm" data-bonus>${icon('plus', 14)} XP</button><button class="btn sm danger" data-fail>${icon('minus', 14)} Registrar fallo</button></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card">
        <div class="card-head" style="flex-wrap:wrap">
          <div class="split"><button class="btn icon sm" data-prev aria-label="Día anterior">${icon('chevron-left', 16)}</button><h2>${esc(relDay(day) === fmtDate(day) ? fmtDateLong(day) : relDay(day) + ' · ' + fmtDateLong(day))}</h2><button class="btn icon sm" data-next aria-label="Día siguiente">${icon('chevron-right', 16)}</button></div>
          ${status ? `<div class="split"><span class="pill ${status === 'ok' ? 'ok' : 'bad'}">${status === 'ok' ? 'Cumplido' : 'No cumplido'}</span><button class="btn ghost sm" data-reopen>Reabrir</button></div>` : `<button class="btn sm primary" data-close>${icon('circle-check', 15)} Cerrar día</button>`}
        </div>
        <div class="split" style="gap:22px;align-items:center">
          <div class="ring" style="--p:${Math.min(100, pct)};--c:${pct > 100 + Number(s.calorieMargin) ? 'var(--bad)' : 'var(--c-diet)'}"><div><div><div class="num" style="font-size:22px;font-weight:600">${ev.total.toLocaleString('es-CO')}</div><div class="tiny muted">kcal</div></div></div></div>
          <div class="grow" style="min-width:180px">
            <div class="kv"><span class="muted">Meta</span><span>${Number(ev.goal).toLocaleString('es-CO')} kcal</span></div>
            <div class="kv"><span class="muted">${rest >= 0 ? 'Te quedan' : 'Te pasaste'}</span><span class="${rest < -ev.margin ? 'down' : ''}">${Math.abs(rest).toLocaleString('es-CO')} kcal</span></div>
            <div class="kv"><span class="muted">Proteína</span><span>${prot} g${s.proteinGoal ? ' / ' + s.proteinGoal + ' g' : ''}</span></div>
          </div>
        </div>
        <div style="margin-top:14px">${groups.length ? groups.map(([t, arr]) => `<div style="margin-top:8px"><div class="split"><h3 class="grow">${esc(t)}</h3><span class="num small muted">${sum(arr, (m) => m.kcal).toLocaleString('es-CO')} kcal</span></div><div class="list">${arr.map((m) => `<div class="row click" data-meal="${esc(m.id)}"><div class="grow"><div class="title">${esc(m.desc)}</div>${m.time || m.protein ? `<div class="meta">${m.time ? `<span>${esc(m.time)}</span>` : ''}${m.protein ? `<span>${m.protein} g proteína</span>` : ''}</div>` : ''}</div><span class="num">${Number(m.kcal).toLocaleString('es-CO')} kcal</span></div>`).join('')}</div></div>`).join('') : emptyState('salad', 'No has registrado comidas este día.', `<button class="btn primary" data-add>${icon('plus', 16)} Registrar comida</button>`)}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Últimos 30 días</h2></div><div class="chart sm"><canvas data-chart></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Constancia</h2><span class="small muted">Últimas 15 semanas</span></div><div class="heat">${cells.join('')}</div>
        <div class="split small muted" style="margin-top:10px"><span class="split" style="gap:5px"><i style="width:12px;height:12px;border-radius:3px;background:var(--c-diet);display:inline-block"></i>Cumplido</span><span class="split" style="gap:5px"><i style="width:12px;height:12px;border-radius:3px;background:color-mix(in srgb,var(--bad) 55%,transparent);display:inline-block"></i>No cumplido</span></div></div>
    </div>
  </div>`;

  chart(el.querySelector('[data-chart]'), { kind: 'bar', labels: L, series: [{ label: 'Calorías', data: V, color: 'var(--c-diet)' }, { label: 'Meta', data: L.map(() => ev.goal), color: 'var(--ink-3)', type: 'line', dashed: true }], legend: false, min: 0, yFmt: (v) => Number(v).toLocaleString('es-CO') });

  el.onclick = (e) => {
    const t = e.target.closest('button,[data-meal]');
    if (!t) return;
    const d = t.dataset;
    if ('add' in d) mealDialog(null, { date: day });
    else if (d.meal) mealDialog(find('meals', d.meal));
    else if ('prev' in d) { day = toKey(addDays(parseKey(day), -1)); render(el); }
    else if ('next' in d) { day = toKey(addDays(parseKey(day), 1)); render(el); }
    else if ('close' in d) closeDayDialog(day);
    else if ('reopen' in d) setDay(day, null);
    else if ('fail' in d) failDialog('diet');
    else if ('bonus' in d) bonusDialog('diet');
  };
}
