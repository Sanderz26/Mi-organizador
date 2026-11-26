// Buscador general (Ctrl + K en el PC, lupa en la tableta)
import { state, find, subjectName } from './store.js';
import { icon } from './icons.js';
import { esc, openModal, fmtDate, fmtMoney, relDay } from './util.js';
import { taskDialog } from './views/tasks.js';
import { noteDialog } from './views/notes.js';
import { eventDialog } from './views/calendar.js';
import { topicDialog } from './views/study.js';
import { sessionDialog } from './views/gym.js';
import { mealDialog } from './views/diet.js';
import { saleDialog, clientDialog, expenseDialog, productDialog } from './views/business.js';

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const later = (fn) => setTimeout(fn, 60);

/** Construye la lista de cosas que se pueden buscar */
function index() {
  const items = [];
  const add = (group, ic, title, sub, text, open, date = '') => items.push({ group, ic, title, sub, hay: norm(title + ' ' + text), t: norm(title), open, date });
  for (const s of state.subjects) add('Materias', 'book', s.name, [state.semesters.find((x) => x.id === s.semesterId)?.name, s.teacher].filter(Boolean).join(' · '), s.teacher || '', () => window.go('estudio', s.id));
  for (const t of state.topics) add('Temas', 'list-details', t.name, subjectName(t.subjectId), t.notes || '', () => { window.go('estudio', t.subjectId); later(() => topicDialog(t.subjectId, find('topics', t.id))); });
  for (const t of state.tasks) add('Tareas', t.done ? 'circle-check' : 'checklist', t.title, [t.done ? 'Completada' : t.due ? relDay(t.due) : 'Sin fecha', t.subjectId ? subjectName(t.subjectId) : ''].filter(Boolean).join(' · '), `${t.notes || ''} ${(t.subtasks || []).map((x) => x.text).join(' ')}`, () => { window.go('tareas'); later(() => taskDialog(find('tasks', t.id))); }, t.due || '');
  for (const n of state.notes) {
    const files = (n.fileIds || []).map((id) => state.files.find((f) => f.id === id)?.name || '').join(' ');
    add('Apuntes', 'notes', n.title, [n.subjectId ? subjectName(n.subjectId) : 'General', fmtDate(n.updated || n.date)].join(' · '), `${n.body || ''} ${files}`, () => { window.go('notas'); later(() => noteDialog(find('notes', n.id))); }, n.updated || n.date);
  }
  for (const e of state.events) add(e.type === 'cumpleanos' ? 'Cumpleaños' : 'Eventos', e.type === 'cumpleanos' ? 'cake' : 'calendar-event', e.title, fmtDate(e.date) + (e.time ? ' · ' + e.time : ''), `${e.place || ''} ${e.notes || ''}`, () => { window.go('calendario'); later(() => eventDialog(find('events', e.id))); }, e.date);
  for (const c of state.clients) add('Clientes', 'user', c.name, c.phone || c.city || '', `${c.phone || ''} ${c.contact || ''} ${c.city || ''} ${c.notes || ''}`, () => { window.go('negocio'); later(() => clientDialog(find('clients', c.id))); });
  for (const x of state.sales) add('Pedidos', 'receipt', x.desc, `${fmtDate(x.date)} · ${find('clients', x.clientId)?.name || 'Sin cliente'} · ${fmtMoney(x.price)}`, `${find('clients', x.clientId)?.name || ''} ${x.material || ''} ${x.notes || ''}`, () => { window.go('negocio'); later(() => saleDialog(find('sales', x.id))); }, x.date);
  for (const x of state.expenses) add('Gastos', 'cash', x.concept, `${fmtDate(x.date)} · ${fmtMoney(x.amount)}`, x.category || '', () => { window.go('negocio'); later(() => expenseDialog(find('expenses', x.id))); }, x.date);
  for (const p of state.products) add('Productos', 'package', p.name, `${p.stock ?? 0} en stock`, p.notes || '', () => { window.go('negocio'); later(() => productDialog(find('products', p.id))); });
  for (const m of state.meals) add('Comidas', 'salad', m.desc, `${m.type} · ${fmtDate(m.date)} · ${m.kcal} kcal`, '', () => { window.go('dieta'); later(() => mealDialog(find('meals', m.id))); }, m.date);
  for (const g of state.gymSessions) add('Gimnasio', 'barbell', g.muscle || 'Entrenamiento', `${fmtDate(g.date)} · ${(g.exercises || []).map((e) => e.name).join(', ')}`, `${(g.exercises || []).map((e) => e.name).join(' ')} ${g.notes || ''}`, () => { window.go('gimnasio'); later(() => sessionDialog(find('gymSessions', g.id))); }, g.date);
  return items;
}

const ORDER = ['Materias', 'Temas', 'Tareas', 'Apuntes', 'Eventos', 'Cumpleaños', 'Clientes', 'Pedidos', 'Productos', 'Gastos', 'Gimnasio', 'Comidas'];

export function searchItems(q, limitPerGroup = 6) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = index().filter((it) => words.every((w) => it.hay.includes(w)));
  for (const h of hits) h.score = (h.t.startsWith(words[0]) ? 3 : 0) + (words.every((w) => h.t.includes(w)) ? 2 : 0);
  const groups = [];
  for (const g of ORDER) {
    const arr = hits.filter((h) => h.group === g).sort((a, b) => b.score - a.score || (b.date || '').localeCompare(a.date || ''));
    if (arr.length) groups.push({ group: g, items: arr.slice(0, limitPerGroup), total: arr.length });
  }
  return groups;
}

let openOv = null;
export function openSearch() {
  if (openOv?.isConnected) { openOv.querySelector('input').focus(); return; }
  let results = [], sel = 0;
  const ov = openModal({
    title: 'Buscar',
    wide: true,
    body: `<input type="search" data-q placeholder="Busca materias, tareas, apuntes, clientes, pedidos…" autocomplete="off" style="font-size:16px">
      <div data-res class="list" style="min-height:120px"></div>
      <p class="tiny faint">Consejo: en el PC abre el buscador con Ctrl + K. Usa las flechas y Enter para abrir.</p>`,
  });
  openOv = ov;
  ov.querySelector('.modal').style.alignSelf = 'flex-start';
  ov.querySelector('.modal').style.marginTop = '8vh';
  const input = ov.querySelector('[data-q]');
  const box = ov.querySelector('[data-res]');
  const draw = () => {
    const q = input.value.trim();
    const groups = searchItems(q);
    results = groups.flatMap((g) => g.items);
    if (sel >= results.length) sel = 0;
    if (!q) { box.innerHTML = '<p class="muted small" style="padding:18px 4px">Escribe lo que buscas. Se ignoran tildes y mayúsculas.</p>'; return; }
    if (!results.length) { box.innerHTML = `<p class="muted small" style="padding:18px 4px">No hay resultados para "${esc(q)}".</p>`; return; }
    let i = 0;
    box.innerHTML = groups.map((g) => `<div class="faint tiny" style="font-weight:600;margin:12px 2px 2px">${esc(g.group)}${g.total > g.items.length ? ` · ${g.total} resultados` : ''}</div>` +
      g.items.map((it) => { const k = i++; return `<div class="row click ${k === sel ? 'sel' : ''}" data-k="${k}">${icon(it.ic, 18)}<div class="grow"><div class="title">${esc(it.title)}</div>${it.sub ? `<div class="meta">${esc(it.sub)}</div>` : ''}</div>${icon('chevron-right', 16)}</div>`; }).join('')).join('');
  };
  const go = (k) => { const it = results[k]; if (!it) return; ov.close(); it.open(); };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); draw(); box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
  });
  box.addEventListener('click', (e) => { const r = e.target.closest('[data-k]'); if (r) go(Number(r.dataset.k)); });
  draw();
  setTimeout(() => input.focus(), 40);
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openSearch(); }
});
