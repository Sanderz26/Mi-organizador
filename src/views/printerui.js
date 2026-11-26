// Pestaña "Impresora" dentro de Negocio
import { state, commit, find, remove } from '../store.js';
import { icon } from '../icons.js';
import { esc, fmtMoney, fmtDate, formModal, confirmModal, emptyState, sum, monthKey, toast } from '../util.js';
import { sound } from '../sound.js';
import { printerIp, normIp, testPrinter, pollPrinter, printerLive, onPrinter, printerAction, importHistory, printCost, prettyFile, syncSaleFromPrints } from '../printer.js';

const PS = {
  printing: { l: 'Imprimiendo', c: 'acc' }, paused: { l: 'En pausa', c: 'warn' }, complete: { l: 'Terminó', c: 'ok' },
  cancelled: { l: 'Cancelada', c: '' }, error: { l: 'Con error', c: 'bad' }, standby: { l: 'Lista', c: 'ok' },
};
const HS = { completed: { l: 'Completa', c: 'ok' }, cancelled: { l: 'Cancelada', c: '' }, error: { l: 'Falló', c: 'bad' } };
const dur = (secs) => { const m = Math.round((Number(secs) || 0) / 60); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
const hm = (ms) => new Date(ms).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
const temp = (a, t) => `${Math.round(a || 0)}°${t ? ` <span class="faint">/ ${Math.round(t)}°</span>` : ''}`;

function liveHtml() {
  const s = printerLive();
  if (s.state === 'off' || !s.at) return `<div class="muted small">Conectando con la impresora…</div>`;
  if (s.state === 'offline') return `<div class="split"><div><b style="font-weight:600">${icon('alert-triangle', 16)} No responde</b><div class="small muted">${esc(s.message || '')}</div></div><button class="btn sm" data-prefresh>Reintentar</button></div>`;
  const P = PS[s.ps] || { l: s.ps, c: '' };
  const active = s.ps === 'printing' || s.ps === 'paused';
  return `
    <div class="split" style="align-items:flex-start">
      <div style="min-width:0"><span class="pill ${P.c}">${esc(P.l)}</span>${s.file ? `<div style="font-weight:600;margin-top:8px;word-break:break-word">${esc(s.name)}</div>` : '<div class="muted small" style="margin-top:8px">Sin trabajos en curso</div>'}</div>
      <div class="split" style="gap:6px">
        ${s.ps === 'printing' ? `<button class="btn sm" data-pact="pause">${icon('player-pause', 15)} Pausar</button>` : ''}
        ${s.ps === 'paused' ? `<button class="btn sm primary" data-pact="resume">${icon('player-play', 15)} Reanudar</button>` : ''}
        ${active ? `<button class="btn sm ghost danger" data-pact="cancel">${icon('player-stop', 15)} Cancelar</button>` : ''}
      </div>
    </div>
    ${active ? `
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:14px"><span style="font-size:32px;font-weight:600;letter-spacing:-.02em" class="num">${Math.round(s.progress * 100)}%</span>${s.layers ? `<span class="small muted">capa ${s.layer} de ${s.layers}</span>` : ''}</div>
    <div class="bar" style="height:10px"><i style="width:${(s.progress * 100).toFixed(1)}%"></i></div>
    <div class="grid g3" style="margin-top:10px">
      <div><div class="tiny muted">Lleva</div><div class="num">${dur(s.printSecs)}</div></div>
      <div><div class="tiny muted">Falta</div><div class="num">${s.left !== null ? '~' + dur(s.left) : '—'}</div></div>
      <div><div class="tiny muted">Termina</div><div class="num">${s.eta ? '~' + hm(s.eta) : s.ps === 'paused' ? 'en pausa' : '—'}</div></div>
    </div>` : ''}
    <div class="grid g3" style="margin-top:14px">
      <div><div class="tiny muted" style="display:flex;align-items:center;gap:3px">${icon("flame", 13)} Boquilla</div><div class="num">${temp(s.ext, s.extT)}</div></div>
      <div><div class="tiny muted" style="display:flex;align-items:center;gap:3px">${icon("flame", 13)} Cama</div><div class="num">${temp(s.bed, s.bedT)}</div></div>
      <div><div class="tiny muted">Filamento</div><div class="num">${active ? `${Math.round(s.grams)} g${s.totalGrams ? ` <span class="faint">/ ${Math.round(s.totalGrams)} g</span>` : ''}` : '—'}</div></div>
    </div>
    <div class="tiny faint" style="margin-top:10px">Actualizado a las ${hm(s.at)} · ${esc(printerIp())}</div>`;
}

export function printerTab() {
  if (!printerIp()) {
    return {
      html: `<div class="card">${emptyState('printer', 'Conecta tu impresora 3D para ver cómo va cada impresión, recibir un aviso al terminar y calcular el costo real de lo que imprimes.', `<button class="btn primary" data-pconfig>${icon('settings', 16)} Conectar impresora</button>`)}
        <p class="small muted" style="text-align:center;margin:0 0 6px">Funciona con impresoras Klipper (como la Creality SparkX i7) que estén en el mismo wifi que este dispositivo.</p></div>`,
      after: bind,
    };
  }
  const mk = monthKey(new Date());
  const sorted = state.prints.slice().sort((a, b) => (b.endAt || 0) - (a.endAt || 0));
  const all = sorted.filter((p) => !p.trashed);
  const trash = state.prints.filter((p) => p.trashed).sort((a, b) => b.trashed - a.trashed);
  if (showTrash && !trash.length) showTrash = false;
  const month = all.filter((p) => (p.date || '').startsWith(mk));
  const ok = month.filter((p) => p.status === 'completed');
  const failed = month.filter((p) => p.status !== 'completed');
  const html = `
    <div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-head"><h2>${icon('printer', 18)} Impresora</h2><button class="btn ghost sm" data-pconfig>${icon('settings', 15)} Configurar</button></div><div data-plive>${liveHtml()}</div></div>
      <div class="card"><div class="card-head"><h2>Este mes</h2></div>
        <div class="kv"><span class="muted">Impresiones completas</span><span>${ok.length}${failed.length ? ` <span class="faint">· ${failed.length} canceladas o fallidas</span>` : ''}</span></div>
        <div class="kv"><span class="muted">Horas imprimiendo</span><span>${dur(sum(month, (p) => p.seconds))}</span></div>
        <div class="kv"><span class="muted">Filamento usado</span><span>${Math.round(sum(month, (p) => p.grams))} g</span></div>
        <div class="kv"><span class="muted">Costo (filamento + luz)</span><span>${fmtMoney(sum(month, (p) => printCost(p).total))}</span></div>
        <div class="kv"><span class="muted">Perdido en fallas</span><span class="${failed.length ? 'down' : ''}">${fmtMoney(sum(failed, (p) => printCost(p).total))}</span></div>
        <div class="kv"><span class="muted">Sin asociar a un pedido</span><span>${ok.filter((p) => !p.saleId).length}</span></div>
      </div>
    </div>
    ${showTrash ? trashHtml(trash) : `
    <div class="card" style="padding:6px 8px;margin-top:16px">
      <div class="card-head" style="padding:8px 8px 0"><h2>Historial</h2><div class="split" style="gap:4px"><button class="btn ghost sm" data-phist>Traer de la impresora</button>${trash.length ? `<button class="btn ghost sm" data-ptrash>${icon('trash', 15)} Papelera (${trash.length})</button>` : ''}${all.length ? `<button class="btn ghost sm danger" data-pclear>Vaciar historial</button>` : ''}</div></div>
      ${all.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Fecha</th><th>Archivo</th><th>Estado</th><th class="n">Tiempo</th><th class="n">Filamento</th><th class="n">Costo</th><th>Pedido</th></tr></thead><tbody>
        ${all.slice(0, 100).map((p) => { const H = HS[p.status] || HS.completed; const sale = p.saleId ? find('sales', p.saleId) : null; return `<tr class="click" data-print="${esc(p.id)}"><td class="num">${esc(fmtDate(p.date))}<div class="tiny faint">${p.endAt ? hm(p.endAt) : ''}</div></td><td style="max-width:260px;word-break:break-word">${esc(p.name)}</td><td><span class="pill ${H.c}">${H.l}</span></td><td class="n">${dur(p.seconds)}</td><td class="n">${Math.round(p.grams || 0)} g</td><td class="n">${fmtMoney(printCost(p).total)}</td><td class="small">${sale ? esc(sale.desc) : p.status === 'completed' ? '<span style="color:var(--accent-ink);font-weight:500">Asociar</span>' : '—'}</td></tr>`; }).join('')}
        </tbody></table></div>` : `<p class="small muted" style="padding:6px 8px 12px">Cuando termine una impresión aparecerá aquí con su tiempo, filamento y costo. Toca "Traer de la impresora" para importar las anteriores.</p>`}
      <p class="tiny faint" style="padding:0 8px 10px;margin:0">Lo que borres aquí solo se quita de la app; en la impresora queda todo igual.</p>
    </div>`}`;
  return { html, after: bind };
}

let showTrash = false;

function trashHtml(trash) {
  return `<div class="card" style="padding:6px 8px;margin-top:16px">
    <div class="card-head" style="padding:8px 8px 0"><h2>${icon('trash', 18)} Papelera</h2><div class="split" style="gap:4px"><button class="btn ghost sm" data-ptrashback>${icon('arrow-left', 15)} Volver al historial</button><button class="btn ghost sm" data-prestoreall>Restaurar todo</button><button class="btn ghost sm danger" data-pempty>Vaciar papelera</button></div></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Fecha</th><th>Archivo</th><th class="n">Tiempo</th><th class="n">Filamento</th><th>Borrada</th><th></th></tr></thead><tbody>
      ${trash.map((p) => { const days = Math.max(0, 30 - Math.floor((Date.now() - p.trashed) / 86400000)); return `<tr><td class="num">${esc(fmtDate(p.date))}</td><td style="max-width:260px;word-break:break-word">${esc(p.name)}</td><td class="n">${dur(p.seconds)}</td><td class="n">${Math.round(p.grams || 0)} g</td><td class="small muted">${esc(fmtDate(new Date(p.trashed).toISOString().slice(0, 10)))}<div class="tiny faint">se borra en ${days} ${days === 1 ? 'día' : 'días'}</div></td><td class="n"><div class="split" style="gap:4px;justify-content:flex-end"><button class="btn sm" data-prestore="${esc(p.id)}">Restaurar</button><button class="btn ghost sm danger" data-pkill="${esc(p.id)}" aria-label="Borrar definitivamente">${icon('x', 15)}</button></div></td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="tiny faint" style="padding:0 8px 10px;margin:0">Lo que está en la papelera no cuenta en los costos ni en los pedidos. Después de 30 días se borra solo de la app (en la impresora nunca se borra nada).</p>
  </div>`;
}

/** Mueve impresiones a la papelera (solo en la app) */
function trashPrints(list) {
  const sales = new Set(list.map((p) => p.saleId).filter(Boolean));
  const now = Date.now();
  for (const p of list) p.trashed = now;
  for (const id of sales) syncSaleFromPrints(id);
  commit();
  sound('delete');
}
function restorePrints(list) {
  for (const p of list) delete p.trashed;
  const sales = new Set(list.map((p) => p.saleId).filter(Boolean));
  for (const id of sales) syncSaleFromPrints(id);
  commit();
  sound('complete');
}

let off = null, timer = null;
function bind(el) {
  off?.(); clearInterval(timer);
  if (!printerIp()) return;
  off = onPrinter(() => { const box = el.querySelector('[data-plive]'); if (box?.isConnected) box.innerHTML = liveHtml(); else { off?.(); clearInterval(timer); } });
  pollPrinter();
  // En pantalla se actualiza cada 4 s
  timer = setInterval(() => { if (!el.querySelector('[data-plive]')?.isConnected) { clearInterval(timer); off?.(); return; } pollPrinter(); }, 4000);
}

/** Clicks de la pestaña; devuelve true si los manejó */
export async function printerClick(t, rerender) {
  const d = t.dataset;
  if ('pconfig' in d) { if (await configDialog()) rerender(); return true; }
  if ('prefresh' in d) { pollPrinter(); return true; }
  if ('phist' in d) {
    t.disabled = true;
    const before = state.prints.length;
    const ok = await importHistory(true);
    t.disabled = false;
    toast(!ok ? 'Tu impresora no comparte su historial. Las impresiones se guardan solas al terminar mientras la app está abierta.' : state.prints.length > before ? `Se agregaron ${state.prints.length - before} impresiones.` : 'No hay impresiones nuevas.', { ms: 6000 });
    rerender();
    return true;
  }
  if (d.pact) {
    const msg = { pause: '¿Pausar la impresión?', resume: '¿Reanudar la impresión?', cancel: '¿Cancelar la impresión? No se puede retomar después.' }[d.pact];
    const label = { pause: 'Pausar', resume: 'Reanudar', cancel: 'Cancelar impresión' }[d.pact];
    if (!(await confirmModal(msg, label))) return true;
    try { await printerAction(d.pact); toast({ pause: 'Pausando…', resume: 'Reanudando…', cancel: 'Cancelando…' }[d.pact]); sound('click'); }
    catch (e) { toast(e.message, { ms: 6000 }); sound('error'); }
    return true;
  }
  if ('pclear' in d) {
    const list = state.prints.filter((p) => !p.trashed);
    if (await confirmModal(`¿Mover las ${list.length} impresiones a la papelera? En la impresora no se borra nada.`, 'Mover a la papelera')) { trashPrints(list); toast('Historial movido a la papelera.', { icon: 'trash' }); rerender(); }
    return true;
  }
  if ('ptrash' in d) { showTrash = true; rerender(); return true; }
  if ('ptrashback' in d) { showTrash = false; rerender(); return true; }
  if (d.prestore) { restorePrints([find('prints', d.prestore)].filter(Boolean)); toast('Impresión restaurada.'); rerender(); return true; }
  if ('prestoreall' in d) { restorePrints(state.prints.filter((p) => p.trashed)); toast('Todo restaurado.'); showTrash = false; rerender(); return true; }
  if (d.pkill) {
    const p = find('prints', d.pkill);
    if (p && (await confirmModal(`¿Borrar "${p.name}" definitivamente de la app? En la impresora sigue guardada, pero no se volverá a traer.`, 'Borrar definitivamente'))) { remove('prints', p.id); commit(); sound('delete'); rerender(); }
    return true;
  }
  if ('pempty' in d) {
    const list = state.prints.filter((p) => p.trashed);
    if (await confirmModal(`¿Borrar definitivamente las ${list.length} impresiones de la papelera? Solo se quitan de la app; no se volverán a traer de la impresora.`, 'Vaciar papelera')) { state.prints = state.prints.filter((p) => !p.trashed); commit(); sound('delete'); showTrash = false; rerender(); }
    return true;
  }
  if (d.print) { await printDialog(find('prints', d.print)); rerender(); return true; }
  return false;
}

async function configDialog() {
  const s = state.settings;
  const v = await formModal({
    title: 'Impresora 3D',
    submitLabel: 'Probar y guardar',
    deleteLabel: s.printerIp ? 'Desconectar' : null,
    fields: [
      { name: 'printerIp', label: 'IP de la impresora', type: 'text', value: s.printerIp || '', required: true, placeholder: '192.168.1.10', full: true, hint: 'En la pantalla de la impresora: Settings → Network. Conviene fijarla en el router para que no cambie.' },
      { type: 'section', label: 'Para calcular el costo de cada impresión' },
      { name: 'filamentCostKg', label: 'Costo del filamento por kg', type: 'number', value: s.filamentCostKg, min: 0, step: 100 },
      { name: 'printerWatts', label: 'Consumo de la impresora (W)', type: 'number', value: s.printerWatts, min: 0, step: 5, hint: 'Una i7 imprimiendo PLA gasta en promedio unos 100–150 W.' },
      { name: 'kwhCost', label: 'Precio del kWh de tu luz', type: 'number', value: s.kwhCost, min: 0, step: 10, hint: 'Sale en tu factura de energía.' },
    ],
  });
  if (!v) return false;
  if (v._action === 'delete') { s.printerIp = ''; commit(); toast('Impresora desconectada'); return true; }
  const ip = normIp(v.printerIp);
  if (!ip) { toast('Esa IP no parece válida. Debe verse como 192.168.1.10'); sound('error'); return false; }
  s.filamentCostKg = v.filamentCostKg; s.printerWatts = v.printerWatts; s.kwhCost = v.kwhCost;
  try {
    const name = await testPrinter(ip);
    s.printerIp = ip;
    commit();
    sound('complete');
    toast(`Conectado con ${name}`, { icon: 'printer' });
    importHistory(true).then((ok) => ok && commit());
    return true;
  } catch (e) {
    commit();
    toast(e.message, { ms: 7000 });
    sound('error');
    return true;
  }
}

async function printDialog(p) {
  if (!p) return;
  const { saleDialog } = await import('./business.js');
  const c = printCost(p);
  const sales = state.sales.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  const v = await formModal({
    title: 'Impresión',
    deleteLabel: 'Mover a la papelera',
    confirmDelete: false, // va a la papelera: se puede deshacer
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', value: p.name, full: true },
      { name: 'saleId', label: 'Pedido', type: 'select', value: p.saleId || '', full: true, options: [{ v: '', l: 'Sin pedido' }, { v: '__new', l: '+ Crear pedido con esta impresión' }, ...sales.map((x) => ({ v: x.id, l: `${fmtDate(x.date)} · ${x.desc}` }))], hint: 'Al asociarla, el pedido toma los gramos y horas de sus impresiones para calcular tu ganancia.' },
      { name: 'grams', label: 'Filamento (g)', type: 'number', value: p.grams, min: 0, step: 0.1 },
    ],
    extraHtml: `<div class="card" style="padding:12px 14px;background:var(--surface-2);box-shadow:none">
      <div class="kv"><span class="muted">Archivo</span><span class="small" style="word-break:break-all;text-align:right">${esc(p.file || '')}</span></div>
      <div class="kv"><span class="muted">Estado</span><span>${(HS[p.status] || HS.completed).l}</span></div>
      <div class="kv"><span class="muted">Tiempo imprimiendo</span><span>${dur(p.seconds)}</span></div>
      <div class="kv"><span class="muted">Terminó</span><span>${esc(fmtDate(p.date))}${p.endAt ? ' · ' + hm(p.endAt) : ''}</span></div>
      <div class="kv"><span class="muted">Filamento</span><span>${fmtMoney(c.mat)}</span></div>
      <div class="kv"><span class="muted">Luz</span><span>${fmtMoney(c.energy)}</span></div>
      <div class="kv"><span>Costo total</span><span>${fmtMoney(c.total)}</span></div></div>`,
  });
  if (!v) return;
  const oldSale = p.saleId;
  if (v._action === 'delete') { trashPrints([p]); toast('Movida a la papelera.', { icon: 'trash' }); return; }
  p.name = v.name || prettyFile(p.file);
  p.grams = Number(v.grams) || 0;
  let saleId = v.saleId;
  if (saleId === '__new') {
    commit();
    const created = await saleDialog(null, { desc: p.name, grams: Math.round(p.grams), hours: Math.round((p.seconds / 3600) * 10) / 10, date: p.date });
    saleId = created?.id || oldSale || '';
  }
  p.saleId = saleId;
  if (oldSale && oldSale !== saleId) syncSaleFromPrints(oldSale);
  if (saleId) { const s = syncSaleFromPrints(saleId); if (s && saleId !== oldSale) toast(`Pedido "${s.desc}" actualizado: ${s.grams} g y ${s.hours} h de impresión.`); }
  commit();
}
