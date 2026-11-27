// Modelo de sincronización: convierte el estado en registros con marca de tiempo y los fusiona.
// Cada registro gana por su cambio más reciente; lo borrado queda marcado para no "revivir".

export const LISTS = ['semesters', 'subjects', 'topics', 'studySessions', 'exercises', 'notes', 'files', 'tasks', 'events', 'meals', 'gymSessions', 'weights', 'clients', 'sales', 'expenses', 'products', 'prints', 'xpLog', 'memories', 'alarms'];
export const LOCAL_SETTINGS = ['closeToTray', 'autostart', 'syncMode', 'syncUrl', 'syncKey'];
const TOMB_DAYS = 120;

/** Estado → mapa plano clave → valor */
export function flatten(st) {
  const out = {};
  for (const l of LISTS) for (const r of st[l] || []) if (r && r.id) out[`${l}/${r.id}`] = r;
  for (const [k, v] of Object.entries(st.dietDays || {})) out[`dietDays/${k}`] = { s: v };
  const settings = { ...(st.settings || {}) };
  for (const k of LOCAL_SETTINGS) delete settings[k];
  out.settings = settings;
  out.activeTimer = { t: st.activeTimer || null };
  return out;
}

/** Mapa plano → partes del estado (listas, dietDays, settings, activeTimer) */
export function unflatten(flat, localSettings = {}) {
  const st = {};
  for (const l of LISTS) st[l] = [];
  st.dietDays = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k === 'settings') st.settings = { ...v };
    else if (k === 'activeTimer') st.activeTimer = v?.t || null;
    else {
      const i = k.indexOf('/');
      const kind = k.slice(0, i), id = k.slice(i + 1);
      if (kind === 'dietDays') st.dietDays[id] = v.s;
      else if (st[kind]) st[kind].push(v);
    }
  }
  st.settings = { ...(st.settings || {}) };
  for (const k of LOCAL_SETTINGS) if (k in localSettings) st.settings[k] = localSettings[k];
  return st;
}

const stable = (v) => JSON.stringify(v);

/**
 * Marca con la hora actual los registros que cambiaron desde la última vez.
 * shadow: clave → JSON conocido; meta: clave → ms del último cambio; del: clave → ms del borrado.
 */
export function stamp(flat, sync, now = Date.now()) {
  let changed = false;
  for (const [k, v] of Object.entries(flat)) {
    const j = stable(v);
    if (sync.shadow[k] !== j) {
      sync.shadow[k] = j;
      sync.meta[k] = now;
      delete sync.del[k];
      changed = true;
    } else if (!sync.meta[k]) sync.meta[k] = 1;
  }
  for (const k of Object.keys(sync.shadow)) {
    if (!(k in flat)) {
      delete sync.shadow[k];
      delete sync.meta[k];
      sync.del[k] = now;
      changed = true;
    }
  }
  return changed;
}

/** Fusiona dos copias {docs, meta, del}. Devuelve la copia fusionada. */
export function merge(a, b, now = Date.now()) {
  const keys = new Set([...Object.keys(a.docs), ...Object.keys(b.docs), ...Object.keys(a.del), ...Object.keys(b.del)]);
  const docs = {}, meta = {}, del = {};
  const order = [...Object.keys(a.docs), ...Object.keys(b.docs).filter((k) => !(k in a.docs))];
  const pick = {};
  for (const k of keys) {
    const cands = [];
    if (k in a.docs) cands.push({ t: a.meta[k] || 1, v: a.docs[k] });
    if (k in b.docs) cands.push({ t: b.meta[k] || 1, v: b.docs[k] });
    if (a.del[k]) cands.push({ t: a.del[k], gone: true });
    if (b.del[k]) cands.push({ t: b.del[k], gone: true });
    cands.sort((x, y) => y.t - x.t || (x.gone ? -1 : y.gone ? 1 : stable(y.v).localeCompare(stable(x.v))));
    pick[k] = cands[0];
  }
  for (const k of order) {
    const c = pick[k];
    if (c && !c.gone) { docs[k] = c.v; meta[k] = c.t; }
  }
  const limit = now - TOMB_DAYS * 864e5;
  for (const [k, c] of Object.entries(pick)) if (c.gone && c.t > limit) del[k] = c.t;
  return { docs, meta, del };
}

/** ¿Dos copias tienen el mismo contenido? */
export function sameDocs(a, b) {
  const ka = Object.keys(a.docs), kb = Object.keys(b.docs);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!(k in b.docs) || stable(a.docs[k]) !== stable(b.docs[k]) || (a.meta[k] || 1) !== (b.meta[k] || 1)) return false;
  const da = Object.keys(a.del), db = Object.keys(b.del);
  return da.length === db.length && da.every((k) => b.del[k] === a.del[k]);
}
