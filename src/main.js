// Punto de entrada: estructura, navegación y arranque
import { state, loadState, onChange, flush, flushSync, applySettings } from './store.js';
import { icon } from './icons.js';
import { esc, hasModal, fmtSec, openModal } from './util.js';
import { destroyCharts } from './charts.js';
import { timerElapsed, timerLabel, togglePause, stopTimer } from './timer.js';
import { startReminderLoop, refreshReminders } from './notify.js';
import { syncHolidaysOnline } from './holidays.js';
import { onAppPause, onBackButton, exitApp } from './platform.js';

import * as home from './views/home.js';
import * as calendar from './views/calendar.js';
import * as tasks from './views/tasks.js';
import * as study from './views/study.js';
import * as gym from './views/gym.js';
import * as diet from './views/diet.js';
import * as business from './views/business.js';
import * as progress from './views/progress.js';
import * as notes from './views/notes.js';
import * as settings from './views/settings.js';

const ROUTES = {
  inicio: { label: 'Inicio', icon: 'home', view: home },
  calendario: { label: 'Calendario', icon: 'calendar', view: calendar },
  tareas: { label: 'Tareas', icon: 'checklist', view: tasks },
  estudio: { label: 'Estudio', icon: 'book', view: study },
  gimnasio: { label: 'Gimnasio', icon: 'barbell', view: gym },
  dieta: { label: 'Dieta', icon: 'salad', view: diet },
  negocio: { label: 'Negocio 3D', icon: 'printer', view: business },
  progreso: { label: 'Progreso', icon: 'chart-line', view: progress },
  notas: { label: 'Notas', icon: 'notes', view: notes },
  ajustes: { label: 'Ajustes', icon: 'settings', view: settings },
};
const SIDE = ['inicio', 'calendario', 'tareas', 'estudio', 'gimnasio', 'dieta', 'negocio', 'progreso', 'notas'];
const BOTTOM = ['inicio', 'calendario', 'tareas', 'estudio'];

const app = document.getElementById('app');
let current = null;

function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  const [route, ...rest] = raw.split('/');
  return { route: ROUTES[route] ? route : 'inicio', params: rest };
}
export function go(route, ...params) {
  location.hash = [route, ...params].map(encodeURIComponent).join('/');
}
window.go = go;

function shell() {
  app.innerHTML = `<div class="app">
    <aside class="sidebar" aria-label="Menú principal">
      <div class="brand"><span class="brand-mark">${icon('target', 18)}</span>Organizador</div>
      ${SIDE.map((r) => navItem(r)).join('')}
      <div class="sidebar-foot"><div class="nav-sep"></div>${navItem('ajustes')}</div>
    </aside>
    <main class="main" id="main">
      <div id="timerbar"></div>
      <div id="view" class="view"></div>
    </main>
    <nav class="bottomnav" aria-label="Menú">
      ${BOTTOM.map((r) => navItem(r)).join('')}
      <button class="nav-item" data-more>${icon('menu-2', 20)}<span>Más</span></button>
    </nav>
  </div>`;
  app.querySelectorAll('[data-route]').forEach((el) => el.addEventListener('click', () => go(el.dataset.route)));
  app.querySelector('[data-more]').addEventListener('click', openMore);
}
const navItem = (r) => `<button class="nav-item" data-route="${r}">${icon(ROUTES[r].icon, 19)}<span>${ROUTES[r].label}</span></button>`;

function openMore() {
  const ov = openModal({
    title: 'Secciones',
    body: `<div class="list">${Object.keys(ROUTES).map((r) => `<button class="nav-item" data-r="${r}" style="padding:12px 10px">${icon(ROUTES[r].icon, 20)}<span>${ROUTES[r].label}</span></button>`).join('')}</div>`,
  });
  ov.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { ov.close(); go(b.dataset.r); }));
}

function render() {
  const { route, params } = parseHash();
  const main = document.getElementById('main');
  const keepScroll = current === route + params.join('/') ? main.scrollTop : 0;
  current = route + params.join('/');
  app.querySelectorAll('[data-route]').forEach((el) => el.classList.toggle('active', el.dataset.route === route));
  destroyCharts();
  const view = document.getElementById('view');
  view.onclick = null; view.onchange = null; view.oninput = null;
  try {
    ROUTES[route].view.render(view, params);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><h2>Algo salió mal en esta sección</h2><p class="muted small" style="margin-top:6px">${esc(e.message)}</p></div>`;
  }
  renderTimer();
  main.scrollTop = keepScroll;
}

function renderTimer() {
  const el = document.getElementById('timerbar');
  const t = state.activeTimer;
  if (!t) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="timerbar">${icon('stopwatch', 20)}<div class="grow"><div class="small" style="opacity:.85">${t.pausedAt ? 'En pausa' : 'Estudiando'} · ${esc(timerLabel())}</div><div class="t" id="tclock">${fmtSec(timerElapsed())}</div></div>
    <button class="btn sm" data-tp>${icon(t.pausedAt ? 'player-play' : 'player-pause', 16)} ${t.pausedAt ? 'Seguir' : 'Pausar'}</button>
    <button class="btn sm" data-ts>${icon('player-stop', 16)} Terminar</button></div>`;
  el.querySelector('[data-tp]').onclick = togglePause;
  el.querySelector('[data-ts]').onclick = stopTimer;
}
setInterval(() => {
  const c = document.getElementById('tclock');
  if (c && state.activeTimer) c.textContent = fmtSec(timerElapsed());
}, 1000);

async function boot() {
  await loadState();
  shell();
  window.addEventListener('hashchange', render);
  onChange(() => { render(); refreshReminders(); });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applySettings(); render(); });
  onAppPause(() => { flushSync(); flush(); });
  onBackButton(() => {
    const ov = document.querySelector('.overlay');
    if (ov) { ov.close?.(); return; }
    if (parseHash().route !== 'inicio') { go('inicio'); return; }
    exitApp();
  });
  render();
  startReminderLoop();
  syncHolidaysOnline().then((changed) => { if (changed && !hasModal()) render(); });
}
boot();
