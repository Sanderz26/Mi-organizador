// Utilidades generales: fechas, formato, modales, avisos
import { icon } from './icons.js';
import { sound } from './sound.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => toKey(new Date());
export const parseKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const weekStart = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const weekKey = (d) => toKey(weekStart(d));
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dateTime = (key, hm) => { const d = parseKey(key); if (hm) { const [h, m] = hm.split(':').map(Number); d.setHours(h || 0, m || 0, 0, 0); } return d; };

export const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
export const fmtDate = (k) => { const d = parseKey(k); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
export const fmtDateY = (k) => { const d = parseKey(k); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtDateLong = (k) => { const d = parseKey(k); return `${DAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
const moneyF = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const numF = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
export const fmtMoney = (n) => moneyF.format(Math.round(Number(n) || 0));
export const fmtNum = (n) => numF.format(Number(n) || 0);
export const fmtMin = (min) => { min = Math.round(Number(min) || 0); const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${pad(m)}m` : `${m}m`; };
export const fmtSec = (s) => { s = Math.round(Number(s) || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
export const relDay = (k) => { const diff = Math.round((parseKey(k) - parseKey(todayKey())) / 864e5); if (diff === 0) return 'Hoy'; if (diff === 1) return 'Mañana'; if (diff === -1) return 'Ayer'; return fmtDate(k); };
export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + (Number(f(b)) || 0), 0);
export const byDate = (a, b) => (a.date + (a.time || a.start || '')).localeCompare(b.date + (b.time || b.start || ''));

// ---------- Avisos ----------
export function toast(msg, opts = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + (opts.kind || '');
  el.innerHTML = (opts.icon ? icon(opts.icon, 18) : '') + `<div>${opts.title ? `<div class="ttl">${esc(opts.title)}</div>` : ''}<div>${esc(msg)}</div></div>`;
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, opts.ms || 2600);
}

// ---------- Modales ----------
let modalStack = 0;
export function openModal({ title, body = '', foot = '', wide = false, onMount }) {
  const root = document.getElementById('modal-root');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon sm" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  root.appendChild(ov);
  modalStack++;
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === ov) { e.stopPropagation(); close(); } };
  const close = () => { if (!ov.isConnected) return; ov.remove(); modalStack--; document.removeEventListener('keydown', onKey, true); ov.dispatchEvent(new Event('closed')); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]').onclick = close;
  document.addEventListener('keydown', onKey, true);
  ov.close = close;
  if (onMount) onMount(ov, close);
  setTimeout(() => { const f = ov.querySelector('input:not([type=checkbox]):not([type=file]), select, textarea'); if (f && window.innerWidth > 860) f.focus(); }, 30);
  return ov;
}
export const hasModal = () => modalStack > 0;

export function checksInner(name, options, sel = new Set()) {
  if (!options.length) return '<span class="small muted">No hay opciones todavía.</span>';
  return options.map((o) => `<label class="checkline"><input type="checkbox" name="${esc(name)}" value="${esc(o.v)}" ${sel.has(String(o.v)) ? 'checked' : ''}> ${esc(o.l)}</label>`).join('');
}

function fieldHtml(f) {
  const id = 'f_' + f.name;
  const v = f.value ?? '';
  const req = f.required ? 'required' : '';
  const cls = f.full || f.type === 'textarea' ? 'field full' : 'field';
  if (f.type === 'checkbox') return `<div class="${cls} full"><label class="checkline"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
  if (f.type === 'checks') {
    const sel = new Set((v || []).map(String));
    return `<div class="field full"><label>${esc(f.label)}</label><div class="checks" id="${id}" data-checks="${f.name}">${checksInner(f.name, f.options || [], sel)}</div>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
  }
  if (f.type === 'section') return `<div class="full" style="margin-top:4px"><h3>${esc(f.label)}</h3>${f.hint ? `<div class="hint small muted">${esc(f.hint)}</div>` : ''}</div>`;
  let input;
  if (f.type === 'select') {
    const opt = (o) => { const ov = typeof o === 'object' ? o.v : o; const ol = typeof o === 'object' ? o.l : o; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`; };
    const opts = f.options || [];
    const groups = [...new Set(opts.map((o) => o?.g).filter(Boolean))];
    const inner = groups.length ? groups.map((g) => `<optgroup label="${esc(g)}">${opts.filter((o) => o.g === g).map(opt).join('')}</optgroup>`).join('') : opts.map(opt).join('');
    input = `<select id="${id}" name="${f.name}" ${req}>${inner}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}" ${req}>${esc(v)}</textarea>`;
  } else {
    const t = f.type || 'text';
    const extra = t === 'number' ? `step="${f.step ?? 'any'}" ${f.min !== undefined ? `min="${f.min}"` : ''} inputmode="decimal"` : '';
    input = `<input type="${t}" id="${id}" name="${f.name}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${extra} ${req} ${t === 'file' && f.multiple ? 'multiple' : ''} ${f.accept ? `accept="${esc(f.accept)}"` : ''}>`;
  }
  return `<div class="${cls}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}<div class="err" data-err="${f.name}"></div></div>`;
}

/** Abre un formulario. Resuelve con los valores, {_action} o null si se cancela. */
export function formModal({ title, fields, submitLabel = 'Guardar', deleteLabel, extraHtml = '', wide, onChange, confirmDelete = true }) {
  return new Promise((resolve) => {
    let done = false;
    const ov = openModal({
      title, wide,
      body: `<form class="form-grid" novalidate>${fields.map(fieldHtml).join('')}</form>${extraHtml}`,
      foot: `${deleteLabel ? `<button class="btn danger" data-del>${icon('trash', 16)} ${esc(deleteLabel)}</button><div class="spacer"></div>` : ''}<button class="btn ghost" data-cancel>Cancelar</button><button class="btn primary" data-ok>${icon('check', 16)} ${esc(submitLabel)}</button>`,
    });
    const form = ov.querySelector('form');
    const read = () => {
      const out = {};
      for (const f of fields) {
        if (!f.name || f.type === 'section') continue;
        if (f.type === 'checks') { out[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((x) => x.value); continue; }
        const el = form.elements[f.name];
        if (!el) continue;
        if (f.type === 'checkbox') out[f.name] = el.checked;
        else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
        else if (f.type === 'file') out[f.name] = [...(el.files || [])];
        else out[f.name] = el.value.trim();
      }
      return out;
    };
    const finish = (v) => { if (done) return; done = true; resolve(v); ov.close(); };
    ov.addEventListener('closed', () => { if (!done) { done = true; resolve(null); } });
    ov.querySelector('[data-cancel]').onclick = () => finish(null);
    const del = ov.querySelector('[data-del]');
    if (del) del.onclick = async () => { if (!confirmDelete || (await confirmModal('¿Eliminar este elemento? Esta acción no se puede deshacer.'))) finish({ _action: 'delete' }); };
    if (onChange) { form.addEventListener('input', () => onChange(read(), form)); form.addEventListener('change', () => onChange(read(), form)); onChange(read(), form); }
    const submit = (e) => {
      e?.preventDefault();
      const v = read();
      let ok = true;
      for (const f of fields) {
        const errEl = ov.querySelector(`[data-err="${f.name}"]`);
        if (errEl) errEl.textContent = '';
        if (f.required && (v[f.name] === '' || v[f.name] === null)) { ok = false; if (errEl) errEl.textContent = 'Este campo es obligatorio'; }
      }
      if (!ok) { sound('error'); return; }
      finish(v);
    };
    form.addEventListener('submit', submit);
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') submit(e); });
    ov.querySelector('[data-ok]').onclick = submit;
  });
}

export function confirmModal(text, okLabel = 'Eliminar') {
  return new Promise((resolve) => {
    let done = false;
    const ov = openModal({ title: 'Confirmar', body: `<p>${esc(text)}</p>`, foot: `<button class="btn ghost" data-no>Cancelar</button><button class="btn primary" data-yes>${esc(okLabel)}</button>` });
    const fin = (v) => { if (done) return; done = true; resolve(v); ov.close(); };
    ov.addEventListener('closed', () => { if (!done) { done = true; resolve(false); } });
    ov.querySelector('[data-no]').onclick = () => fin(false);
    ov.querySelector('[data-yes]').onclick = () => fin(true);
  });
}

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const matches = (q, ...fields) => { const w = norm(q).split(/\s+/).filter(Boolean); const hay = norm(fields.join(' ')); return w.every((x) => hay.includes(x)); };
export const emptyState = (ic, text, btn = '') => `<div class="empty">${icon(ic, 30)}<div>${esc(text)}</div>${btn}</div>`;
