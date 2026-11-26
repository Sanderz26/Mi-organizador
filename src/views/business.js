// Negocio de impresión 3D: pedidos, costos reales, clientes, gastos e inventario
import { state, commit, upsert, remove, find } from '../store.js';
import { icon } from '../icons.js';
import { esc, todayKey, fmtDate, fmtMoney, fmtNum, formModal, emptyState, sum, monthKey, MONTHS, cap, matches } from '../util.js';
import { chart, destroyCharts } from '../charts.js';
import { sound } from '../sound.js';

const STATUS = { cotizado: { l: 'Cotizado', c: '' }, produccion: { l: 'En producción', c: 'warn' }, entregado: { l: 'Entregado', c: 'acc' }, pagado: { l: 'Pagado', c: 'ok' } };
const MATERIALS = ['PLA', 'PETG', 'ABS', 'TPU', 'ASA', 'Resina', 'Nylon', 'Otro'];
const EXP_CATS = ['Filamento', 'Resina', 'Repuestos', 'Impresora o equipo', 'Herramientas', 'Publicidad', 'Envíos', 'Empaques', 'Software', 'Otro'];
let tab = 'resumen';
let month = monthKey(new Date());
let bq = '';
let bqTimer = null;

export function saleCost(x) {
  const s = state.settings;
  const mat = ((Number(x.grams) || 0) / 1000) * (Number(x.filamentCostKg ?? s.filamentCostKg) || 0);
  const energy = (Number(x.hours) || 0) * ((Number(x.watts ?? s.printerWatts) || 0) / 1000) * (Number(x.kwhCost ?? s.kwhCost) || 0);
  const prod = x.kind === 'producto' ? (Number(find('products', x.productId)?.cost) || 0) * (Number(x.qty) || 1) : 0;
  return { mat, energy, prod, extra: Number(x.extraCost) || 0, total: mat + energy + prod + (Number(x.extraCost) || 0) };
}
const counts = (x) => x.status !== 'cotizado';

export function monthSummary(d) {
  const mk = typeof d === 'string' ? d : monthKey(d);
  const sales = state.sales.filter((x) => x.date.startsWith(mk) && counts(x));
  const income = sum(sales, (x) => x.price);
  const costs = sum(sales, (x) => saleCost(x).total);
  const exp = state.expenses.filter((x) => x.date.startsWith(mk));
  const expenses = sum(exp.filter((x) => !x.investment), (x) => x.amount);
  const invest = sum(exp.filter((x) => x.investment), (x) => x.amount);
  const clients = new Set(sales.map((x) => x.clientId).filter(Boolean));
  return { income, costs, expenses, invest, profit: income - costs - expenses, orders: sales.length, clients: clients.size, ticket: sales.length ? income / sales.length : 0, grams: sum(sales, (x) => x.grams), hours: sum(sales, (x) => x.hours), pending: sum(state.sales.filter((x) => x.status === 'entregado'), (x) => x.price) };
}

export async function saleDialog(sale = null) {
  const s = state.settings;
  const x = sale || { date: todayKey(), kind: 'impresion', qty: 1, status: 'produccion', material: 'PLA', filamentCostKg: s.filamentCostKg };
  const v = await formModal({
    title: sale ? 'Editar pedido' : 'Nuevo pedido',
    wide: true,
    deleteLabel: sale ? 'Eliminar' : null,
    fields: [
      { name: 'date', label: 'Fecha', type: 'date', value: x.date, required: true },
      { name: 'status', label: 'Estado', type: 'select', value: x.status, options: Object.entries(STATUS).map(([v, t]) => ({ v, l: t.l })) },
      { name: 'clientId', label: 'Cliente', type: 'select', value: x.clientId || '', options: [{ v: '', l: 'Sin cliente' }, { v: '__new', l: '+ Cliente nuevo' }, ...state.clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ v: c.id, l: c.name }))] },
      { name: 'newClient', label: 'Nombre del cliente nuevo', type: 'text', value: '', placeholder: 'Solo si elegiste cliente nuevo' },
      { name: 'kind', label: 'Tipo', type: 'select', value: x.kind, options: [{ v: 'impresion', l: 'Impresión por encargo' }, { v: 'producto', l: 'Producto del inventario' }] },
      { name: 'productId', label: 'Producto (si es del inventario)', type: 'select', value: x.productId || '', options: [{ v: '', l: '—' }, ...state.products.map((p) => ({ v: p.id, l: `${p.name} (${p.stock ?? 0} en stock)` }))] },
      { name: 'desc', label: 'Descripción', type: 'text', value: x.desc || '', required: true, full: true, placeholder: 'Soporte para celular personalizado' },
      { name: 'qty', label: 'Cantidad', type: 'number', value: x.qty, min: 1, step: 1 },
      { name: 'price', label: 'Precio cobrado (total)', type: 'number', value: x.price ?? '', required: true, min: 0, step: 100 },
      { type: 'section', label: 'Costos de impresión', hint: 'Se usan para calcular tu ganancia real.' },
      { name: 'material', label: 'Material', type: 'select', value: x.material, options: MATERIALS },
      { name: 'grams', label: 'Filamento usado (g)', type: 'number', value: x.grams ?? '', min: 0, step: 1 },
      { name: 'hours', label: 'Horas de impresión', type: 'number', value: x.hours ?? '', min: 0, step: 0.1 },
      { name: 'filamentCostKg', label: 'Costo del filamento por kg', type: 'number', value: x.filamentCostKg ?? s.filamentCostKg, min: 0, step: 100 },
      { name: 'extraCost', label: 'Otros costos (pintura, envío, empaque)', type: 'number', value: x.extraCost ?? '', min: 0, step: 100 },
      { name: 'notes', label: 'Notas', type: 'textarea', value: x.notes || '' },
    ],
    extraHtml: '<div class="card" style="padding:12px 14px;background:var(--surface-2);box-shadow:none" data-costprev></div>',
    onChange: (vals, form) => {
      const c = saleCost({ ...vals, watts: s.printerWatts, kwhCost: s.kwhCost });
      const profit = (vals.price || 0) - c.total;
      form.closest('.modal').querySelector('[data-costprev]').innerHTML = `<div class="kv"><span class="muted">Material</span><span>${fmtMoney(c.mat)}</span></div><div class="kv"><span class="muted">Energía</span><span>${fmtMoney(c.energy)}</span></div>${c.prod ? `<div class="kv"><span class="muted">Costo producto</span><span>${fmtMoney(c.prod)}</span></div>` : ''}<div class="kv"><span class="muted">Costo total</span><span>${fmtMoney(c.total)}</span></div><div class="kv"><span>Ganancia</span><span class="${profit >= 0 ? 'up' : 'down'}">${fmtMoney(profit)}${vals.price ? ` · ${Math.round((profit / vals.price) * 100)}%` : ''}</span></div>`;
    },
  });
  if (!v) return;
  if (v._action === 'delete') {
    if (sale.kind === 'producto' && sale.productId) { const p = find('products', sale.productId); if (p) p.stock = (Number(p.stock) || 0) + (Number(sale.qty) || 0); }
    remove('sales', sale.id); sound('delete'); commit(); return;
  }
  let clientId = v.clientId;
  if (clientId === '__new') clientId = v.newClient ? upsert('clients', { name: v.newClient, since: v.date }).id : '';
  if (sale?.kind === 'producto' && sale.productId) { const p = find('products', sale.productId); if (p) p.stock = (Number(p.stock) || 0) + (Number(sale.qty) || 0); }
  if (v.kind === 'producto' && v.productId) { const p = find('products', v.productId); if (p) p.stock = (Number(p.stock) || 0) - (Number(v.qty) || 0); }
  delete v.newClient;
  upsert('sales', { ...(sale || {}), ...v, clientId, watts: s.printerWatts, kwhCost: s.kwhCost });
  sound(v.status === 'pagado' ? 'xp' : 'complete');
  commit();
}

export async function clientDialog(c = null) {
  const v = await formModal({
    title: c ? 'Editar cliente' : 'Nuevo cliente',
    deleteLabel: c ? 'Eliminar' : null,
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', value: c?.name, required: true },
      { name: 'phone', label: 'Teléfono o WhatsApp', type: 'text', value: c?.phone || '' },
      { name: 'contact', label: 'Correo o red social', type: 'text', value: c?.contact || '' },
      { name: 'city', label: 'Ciudad o barrio', type: 'text', value: c?.city || '' },
      { name: 'notes', label: 'Notas', type: 'textarea', value: c?.notes || '' },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('clients', c.id); sound('delete'); commit(); return; }
  upsert('clients', { ...(c || { since: todayKey() }), ...v });
  sound('complete'); commit();
}

export async function expenseDialog(x = null) {
  const v = await formModal({
    title: x ? 'Editar gasto' : 'Registrar gasto o inversión',
    deleteLabel: x ? 'Eliminar' : null,
    fields: [
      { name: 'date', label: 'Fecha', type: 'date', value: x?.date || todayKey(), required: true },
      { name: 'category', label: 'Categoría', type: 'select', value: x?.category || 'Filamento', options: EXP_CATS },
      { name: 'concept', label: 'Concepto', type: 'text', value: x?.concept || '', required: true, full: true, placeholder: '2 kg PLA negro' },
      { name: 'amount', label: 'Valor', type: 'number', value: x?.amount ?? '', required: true, min: 0, step: 100 },
      { name: 'investment', label: 'Es inversión (equipo o mejora que dura), no gasto del mes', type: 'checkbox', value: x?.investment },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('expenses', x.id); sound('delete'); commit(); return; }
  upsert('expenses', { ...(x || {}), ...v });
  sound('complete'); commit();
}

export async function productDialog(p = null) {
  const v = await formModal({
    title: p ? 'Editar producto' : 'Nuevo producto',
    deleteLabel: p ? 'Eliminar' : null,
    fields: [
      { name: 'name', label: 'Producto', type: 'text', value: p?.name, required: true, full: true, placeholder: 'Matera geométrica mediana' },
      { name: 'price', label: 'Precio de venta', type: 'number', value: p?.price ?? '', min: 0, step: 100 },
      { name: 'cost', label: 'Costo por unidad', type: 'number', value: p?.cost ?? '', min: 0, step: 100 },
      { name: 'stock', label: 'Unidades en stock', type: 'number', value: p?.stock ?? 0, step: 1 },
      { name: 'minStock', label: 'Avisar cuando queden', type: 'number', value: p?.minStock ?? 2, step: 1 },
      { name: 'notes', label: 'Notas (material, gramos, horas…)', type: 'textarea', value: p?.notes || '' },
    ],
  });
  if (!v) return;
  if (v._action === 'delete') { remove('products', p.id); sound('delete'); commit(); return; }
  upsert('products', { ...(p || {}), ...v });
  sound('complete'); commit();
}

const clientName = (id) => find('clients', id)?.name || '—';

function resumen() {
  const m = monthSummary(month);
  const [y, mm] = month.split('-').map(Number);
  const prev = monthSummary(monthKey(new Date(y, mm - 2, 1)));
  const delta = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
  const d = delta(m.profit, prev.profit);
  const top = Object.entries(state.sales.filter((x) => counts(x) && x.clientId).reduce((acc, x) => { acc[x.clientId] = (acc[x.clientId] || 0) + Number(x.price || 0); return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(monthKey(new Date(y, mm - 1 - i, 1)));
  const low = state.products.filter((p) => (Number(p.stock) || 0) <= (Number(p.minStock) || 0));
  const allClients = new Set(state.sales.filter(counts).map((x) => x.clientId).filter(Boolean));
  const repeat = [...allClients].filter((id) => state.sales.filter((x) => x.clientId === id && counts(x)).length > 1).length;
  return {
    html: `
    <div class="split"><button class="btn icon sm" data-m="-1" aria-label="Mes anterior">${icon('chevron-left', 16)}</button><h2>${cap(MONTHS[mm - 1])} ${y}</h2><button class="btn icon sm" data-m="1" aria-label="Mes siguiente">${icon('chevron-right', 16)}</button></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="stat"><div class="lbl">Ventas</div><div class="val">${fmtMoney(m.income)}</div><div class="delta muted">${m.orders} pedidos</div></div>
      <div class="stat"><div class="lbl">Costos de producción</div><div class="val">${fmtMoney(m.costs)}</div><div class="delta muted">${fmtNum(m.grams / 1000)} kg · ${fmtNum(m.hours)} h</div></div>
      <div class="stat"><div class="lbl">Gastos del mes</div><div class="val">${fmtMoney(m.expenses)}</div><div class="delta muted">Inversión: ${fmtMoney(m.invest)}</div></div>
      <div class="stat"><div class="lbl">Ganancia neta</div><div class="val ${m.profit >= 0 ? '' : 'down'}">${fmtMoney(m.profit)}</div><div class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'muted'}">${d === null ? 'Sin mes anterior' : `${d > 0 ? '+' : ''}${d}% vs mes anterior`}</div></div>
      <div class="stat"><div class="lbl">Clientes este mes</div><div class="val">${m.clients}</div><div class="delta muted">Ticket promedio ${fmtMoney(m.ticket)}</div></div>
      <div class="stat"><div class="lbl">Por cobrar</div><div class="val">${fmtMoney(m.pending)}</div><div class="delta muted">Entregados sin pagar</div></div>
    </div>
    <div class="grid g-main">
      <div class="card"><div class="card-head"><h2>Últimos 6 meses</h2></div><div class="chart"><canvas data-bchart></canvas></div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="card-head"><h2>Mejores clientes</h2><span class="small muted">${allClients.size} clientes · ${repeat} repiten</span></div>${top.length ? `<div class="list">${top.map(([id, v]) => `<div class="row"><div class="grow">${esc(clientName(id))}</div><span class="num">${fmtMoney(v)}</span></div>`).join('')}</div>` : '<p class="muted small">Aún no hay ventas con cliente.</p>'}</div>
        ${low.length ? `<div class="card"><div class="card-head"><h2>${icon('alert-triangle', 17)} Stock bajo</h2></div><div class="list">${low.map((p) => `<div class="row"><div class="grow">${esc(p.name)}</div><span class="pill warn">${p.stock ?? 0} und</span></div>`).join('')}</div></div>` : ''}
      </div>
    </div>`,
    after: (el) => {
      const sums = months.map((k) => monthSummary(k));
      chart(el.querySelector('[data-bchart]'), {
        kind: 'bar', labels: months.map((k) => cap(MONTHS[Number(k.slice(5)) - 1].slice(0, 3))),
        series: [
          { label: 'Ventas', data: sums.map((x) => x.income), color: 'var(--c-biz)' },
          { label: 'Costos y gastos', data: sums.map((x) => x.costs + x.expenses), color: 'var(--ink-3)' },
          { label: 'Ganancia', data: sums.map((x) => x.profit), color: 'var(--accent)', type: 'line' },
        ],
        yFmt: (v) => fmtMoney(v), pick: 'negocio-meses', defaultVisible: 3,
      });
    },
  };
}

export function render(el) {
  destroyCharts();
  let body = '', after = null, addBtn = '';
  if (tab === 'resumen') { const r = resumen(); body = r.html; after = r.after; addBtn = `<button class="btn primary" data-newsale>${icon('plus', 16)} Pedido</button>`; }
  else if (tab === 'pedidos') {
    addBtn = `<button class="btn primary" data-newsale>${icon('plus', 16)} Pedido</button>`;
    const list = state.sales.slice().sort((a, b) => b.date.localeCompare(a.date)).filter((x) => !bq || matches(bq, x.desc, clientName(x.clientId), x.material, x.notes, STATUS[x.status]?.l));
    body = list.length ? `<div class="card" style="padding:6px 8px"><div class="tablewrap"><table class="t"><thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Estado</th><th class="n">Precio</th><th class="n">Costo</th><th class="n">Ganancia</th></tr></thead><tbody>
      ${list.map((x) => { const c = saleCost(x); const p = (x.price || 0) - c.total; const S = STATUS[x.status] || STATUS.produccion; return `<tr class="click" data-sale="${esc(x.id)}"><td class="num">${esc(fmtDate(x.date))}</td><td>${esc(x.desc)}${x.qty > 1 ? ` <span class="faint">×${x.qty}</span>` : ''}<div class="tiny faint">${esc(x.material || '')}${x.grams ? ' · ' + x.grams + ' g' : ''}${x.hours ? ' · ' + fmtNum(x.hours) + ' h' : ''}</div></td><td>${esc(clientName(x.clientId))}</td><td><span class="pill ${S.c}">${S.l}</span></td><td class="n">${fmtMoney(x.price)}</td><td class="n">${fmtMoney(c.total)}</td><td class="n ${p >= 0 ? 'up' : 'down'}">${fmtMoney(p)}</td></tr>`; }).join('')}
      </tbody></table></div></div>` : `<div class="card">${emptyState('receipt', 'Registra tu primer pedido de impresión.', `<button class="btn primary" data-newsale>${icon('plus', 16)} Pedido</button>`)}</div>`;
  } else if (tab === 'clientes') {
    addBtn = `<button class="btn primary" data-newclient>${icon('plus', 16)} Cliente</button>`;
    const rows = state.clients.filter((c) => !bq || matches(bq, c.name, c.phone, c.contact, c.city, c.notes)).map((c) => { const s = state.sales.filter((x) => x.clientId === c.id && counts(x)); return { c, total: sum(s, (x) => x.price), n: s.length, last: s.map((x) => x.date).sort().at(-1) }; }).sort((a, b) => b.total - a.total);
    body = rows.length ? `<div class="card" style="padding:6px 8px"><div class="tablewrap"><table class="t"><thead><tr><th>Cliente</th><th>Contacto</th><th class="n">Pedidos</th><th class="n">Total comprado</th><th class="n">Último</th></tr></thead><tbody>
      ${rows.map(({ c, total, n, last }) => `<tr class="click" data-client="${esc(c.id)}"><td><b style="font-weight:500">${esc(c.name)}</b>${c.city ? `<div class="tiny faint">${esc(c.city)}</div>` : ''}</td><td class="small">${esc(c.phone || c.contact || '—')}</td><td class="n">${n}</td><td class="n">${fmtMoney(total)}</td><td class="n">${last ? esc(fmtDate(last)) : '—'}</td></tr>`).join('')}
      </tbody></table></div></div>` : `<div class="card">${emptyState('users', 'Agrega a tus clientes para saber quién te compra y cuánto.', `<button class="btn primary" data-newclient>${icon('plus', 16)} Cliente</button>`)}</div>`;
  } else if (tab === 'gastos') {
    addBtn = `<button class="btn primary" data-newexp>${icon('plus', 16)} Gasto o inversión</button>`;
    const list = state.expenses.slice().sort((a, b) => b.date.localeCompare(a.date)).filter((x) => !bq || matches(bq, x.concept, x.category));
    const totInv = sum(state.expenses.filter((x) => x.investment), (x) => x.amount);
    body = `<div class="grid g3"><div class="stat"><div class="lbl">Inversión total</div><div class="val">${fmtMoney(totInv)}</div></div><div class="stat"><div class="lbl">Gastos totales</div><div class="val">${fmtMoney(sum(state.expenses.filter((x) => !x.investment), (x) => x.amount))}</div></div><div class="stat"><div class="lbl">Ventas totales</div><div class="val">${fmtMoney(sum(state.sales.filter(counts), (x) => x.price))}</div></div></div>
      ${list.length ? `<div class="card" style="padding:6px 8px"><div class="tablewrap"><table class="t"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Tipo</th><th class="n">Valor</th></tr></thead><tbody>${list.map((x) => `<tr class="click" data-exp="${esc(x.id)}"><td class="num">${esc(fmtDate(x.date))}</td><td>${esc(x.concept)}</td><td class="small">${esc(x.category)}</td><td><span class="pill ${x.investment ? 'acc' : ''}">${x.investment ? 'Inversión' : 'Gasto'}</span></td><td class="n">${fmtMoney(x.amount)}</td></tr>`).join('')}</tbody></table></div></div>` : `<div class="card">${emptyState('cash', 'Registra lo que gastas e inviertes en el negocio.')}</div>`}`;
  } else {
    addBtn = `<button class="btn primary" data-newprod>${icon('plus', 16)} Producto</button>`;
    const prods = state.products.filter((p) => !bq || matches(bq, p.name, p.notes));
    body = prods.length ? `<div class="card" style="padding:6px 8px"><div class="tablewrap"><table class="t"><thead><tr><th>Producto</th><th class="n">Stock</th><th class="n">Costo</th><th class="n">Precio</th><th class="n">Margen</th><th class="n">Vendidos</th></tr></thead><tbody>
      ${prods.map((p) => { const sold = sum(state.sales.filter((x) => x.productId === p.id && counts(x)), (x) => x.qty); const mg = p.price ? Math.round(((p.price - (p.cost || 0)) / p.price) * 100) : null; return `<tr class="click" data-prod="${esc(p.id)}"><td>${esc(p.name)}</td><td class="n"><span class="pill ${(Number(p.stock) || 0) <= (Number(p.minStock) || 0) ? 'warn' : ''}">${p.stock ?? 0}</span></td><td class="n">${fmtMoney(p.cost)}</td><td class="n">${fmtMoney(p.price)}</td><td class="n">${mg === null ? '—' : mg + '%'}</td><td class="n">${sold}</td></tr>`; }).join('')}
      </tbody></table></div></div>` : `<div class="card">${emptyState('package', 'Cuando empieces a vender productos impresos, lleva aquí tu inventario.', `<button class="btn primary" data-newprod>${icon('plus', 16)} Producto</button>`)}</div>`;
  }

  el.innerHTML = `
  <div class="page-head"><div><div class="sub">Impresión 3D</div><h1>Negocio</h1></div><div class="head-actions">${addBtn}</div></div>
  <div class="split"><div class="tabs">${[['resumen', 'Resumen'], ['pedidos', 'Pedidos'], ['clientes', 'Clientes'], ['gastos', 'Gastos e inversión'], ['inventario', 'Inventario']].map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>${tab !== 'resumen' ? `<input type="search" data-bq placeholder="Buscar en ${tab}" value="${esc(bq)}" style="max-width:240px">` : ''}</div>
  ${body}`;
  after?.(el);

  el.oninput = (e) => {
    if (!e.target.matches('[data-bq]')) return;
    clearTimeout(bqTimer);
    const v = e.target.value;
    bqTimer = setTimeout(() => { bq = v; render(el); const i = el.querySelector('[data-bq]'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 220);
  };
  el.onclick = (e) => {
    const t = e.target.closest('button,[data-sale],[data-client],[data-exp],[data-prod]');
    if (!t) return;
    const d = t.dataset;
    if (d.tab) { tab = d.tab; bq = ''; render(el); }
    else if (d.m) { const [y, m] = month.split('-').map(Number); month = monthKey(new Date(y, m - 1 + Number(d.m), 1)); render(el); }
    else if ('newsale' in d) saleDialog();
    else if ('newclient' in d) clientDialog();
    else if ('newexp' in d) expenseDialog();
    else if ('newprod' in d) productDialog();
    else if (d.sale) saleDialog(find('sales', d.sale));
    else if (d.client) clientDialog(find('clients', d.client));
    else if (d.exp) expenseDialog(find('expenses', d.exp));
    else if (d.prod) productDialog(find('products', d.prod));
  };
}
