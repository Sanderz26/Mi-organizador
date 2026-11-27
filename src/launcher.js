// Abrir otras apps y acciones rápidas (YouTube, Spotify, Maps, WhatsApp, llamar, buscar en la web).
import { registerPlugin } from '@capacitor/core';
import { isAndroid, isWindows } from './platform.js';
import { norm } from './util.js';

export const Dispositivo = isAndroid ? registerPlugin('Dispositivo') : null;

// Nombres comunes → cómo se llama la app
const ALIASES = {
  wasap: 'whatsapp', guasap: 'whatsapp', whats: 'whatsapp', insta: 'instagram', ig: 'instagram', face: 'facebook', yt: 'youtube',
  correo: 'gmail', mail: 'gmail', musica: 'spotify', mapas: 'maps', mapa: 'maps', 'google maps': 'maps', camara: 'camara', fotos: 'fotos',
  calculadora: 'calculadora', reloj: 'reloj', navegador: 'chrome', internet: 'chrome', tiktok: 'tiktok', x: 'x', twitter: 'x',
  creality: 'creality', 'creality print': 'creality', word: 'word', excel: 'excel', powerpoint: 'powerpoint', teams: 'teams', discord: 'discord',
};

let appsCache = null, appsAt = 0;
async function apps() {
  if (appsCache && Date.now() - appsAt < 10 * 60000) return appsCache;
  if (Dispositivo) appsCache = (await Dispositivo.listApps().catch(() => ({ apps: [] }))).apps || [];
  else if (isWindows && window.native?.listApps) appsCache = await window.native.listApps().catch(() => []);
  else appsCache = [];
  appsAt = Date.now();
  return appsCache;
}

/** La app instalada que mejor coincide con el nombre */
export async function findApp(name) {
  let q = norm(name).replace(/^(la app de |la aplicacion de |app de |la |el )/, '').trim();
  q = ALIASES[q] || q;
  const list = await apps();
  const score = (a) => {
    const l = norm(a.label);
    if (l === q) return 100;
    if (l.startsWith(q)) return 80;
    if (l.split(/\s+/).includes(q)) return 70;
    if (l.includes(q)) return 50;
    if (q.includes(l) && l.length > 3) return 40;
    return 0;
  };
  return list.map((a) => ({ a, s: score(a) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || x.a.label.length - y.a.label.length)[0]?.a || null;
}

export async function openApp(name) {
  if (!Dispositivo && !(isWindows && window.native?.openApp)) throw new Error('Abrir apps funciona en la app instalada (tableta o PC).');
  const a = await findApp(name);
  if (!a) throw new Error(`No encontré la app "${name}" en este dispositivo.`);
  if (Dispositivo) await Dispositivo.openApp({ pkg: a.pkg });
  else { const err = await window.native.openApp(a.path); if (err) throw new Error(err); }
  return a.label;
}

const enc = encodeURIComponent;
async function openUrl(url, pkg) {
  if (Dispositivo) return Dispositivo.openUri({ uri: url, pkg });
  if (isWindows && window.native?.openExternal) return window.native.openExternal(url);
  window.open(url, '_blank');
}

/** Acciones rápidas: destino = youtube | spotify | maps | ruta | whatsapp | llamar | web */
export async function quickOpen({ destino, consulta = '', texto = '', telefono = '' }) {
  const q = String(consulta || '').trim();
  switch (norm(destino)) {
    case 'youtube': await openUrl(q ? `https://www.youtube.com/results?search_query=${enc(q)}` : 'https://www.youtube.com/', 'com.google.android.youtube'); return q ? `Busqué "${q}" en YouTube.` : 'Abrí YouTube.';
    case 'spotify':
      if (Dispositivo) await openUrl(q ? `spotify:search:${enc(q)}` : 'spotify:', 'com.spotify.music').catch(() => openUrl(`https://open.spotify.com/search/${enc(q)}`));
      else await openUrl(q ? `spotify:search:${enc(q)}` : 'spotify:').catch(() => openUrl(`https://open.spotify.com/search/${enc(q)}`));
      return q ? `Busqué "${q}" en Spotify.` : 'Abrí Spotify.';
    case 'maps': case 'mapa': await openUrl(Dispositivo ? `geo:0,0?q=${enc(q)}` : `https://www.google.com/maps/search/?api=1&query=${enc(q)}`, 'com.google.android.apps.maps'); return `Busqué "${q}" en el mapa.`;
    case 'ruta': case 'navegar': await openUrl(Dispositivo ? `google.navigation:q=${enc(q)}` : `https://www.google.com/maps/dir/?api=1&destination=${enc(q)}`, 'com.google.android.apps.maps'); return `Te abrí la ruta a ${q}.`;
    case 'whatsapp': {
      const tel = String(telefono || '').replace(/[^\d]/g, '');
      if (tel) await openUrl(`https://wa.me/${tel.length === 10 ? '57' + tel : tel}?text=${enc(texto)}`, 'com.whatsapp');
      else if (Dispositivo) await Dispositivo.shareText({ text: texto, pkg: 'com.whatsapp' });
      else await openUrl(`https://web.whatsapp.com/send?text=${enc(texto)}`);
      return tel ? 'Te dejé el mensaje listo en WhatsApp, solo dale enviar.' : 'Te dejé el mensaje listo en WhatsApp: elige el contacto y dale enviar.';
    }
    case 'llamar': {
      if (!Dispositivo) throw new Error('Las llamadas solo se pueden abrir desde la tableta.');
      await Dispositivo.dial({ number: String(telefono || '').replace(/[^\d+]/g, '') });
      return 'Te dejé el número marcado, solo dale llamar.';
    }
    default: await openUrl(`https://www.google.com/search?q=${enc(q)}`); return `Busqué "${q}" en internet.`;
  }
}
