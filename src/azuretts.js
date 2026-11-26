// Voz premium con Azure (voces neuronales). Clave y región: en este dispositivo o compartidas por Drive.
import { state } from './store.js';
import { httpRequest } from './platform.js';

const LS = 'organizador-azure';
const USE = 'organizador-azure-uso';
export const FREE_CHARS = 500000; // cupo gratis (nivel F0) al mes
export const MAX_CHARS = 1500; // tope por respuesta leída, para cuidar el cupo

export const REGIONS = [
  ['eastus', 'East US (Este de EE. UU.)'], ['eastus2', 'East US 2'], ['westus', 'West US'], ['westus2', 'West US 2'], ['westus3', 'West US 3'],
  ['centralus', 'Central US'], ['southcentralus', 'South Central US'], ['northcentralus', 'North Central US'], ['westcentralus', 'West Central US'],
  ['canadacentral', 'Canada Central'], ['brazilsouth', 'Brazil South'], ['mexicocentral', 'Mexico Central'],
  ['westeurope', 'West Europe'], ['northeurope', 'North Europe'], ['uksouth', 'UK South'], ['francecentral', 'France Central'],
  ['germanywestcentral', 'Germany West Central'], ['swedencentral', 'Sweden Central'], ['switzerlandnorth', 'Switzerland North'],
  ['eastasia', 'East Asia'], ['southeastasia', 'Southeast Asia'], ['japaneast', 'Japan East'], ['koreacentral', 'Korea Central'],
  ['centralindia', 'Central India'], ['australiaeast', 'Australia East'],
];

/** Acepta "eastus", "East US" o una URL del portal ("https://eastus.api.cognitive.microsoft.com/") */
export function normRegion(v) {
  const s = String(v || '').trim().toLowerCase();
  const m = s.match(/^https?:\/\/([a-z0-9]+)\./);
  return (m ? m[1] : s).replace(/[^a-z0-9]/g, '');
}

export function localAzure() {
  const d = { key: '', region: '', voice: '', voices: [], styles: {} };
  try { return { ...d, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return d; }
}
export function saveAzure(p) { try { localStorage.setItem(LS, JSON.stringify({ ...localAzure(), ...p })); } catch { /* */ } }

/** Configuración efectiva: lo de este dispositivo manda; lo compartido completa */
export function azureConfig() {
  const l = localAzure();
  const sh = state.settings.ttsShared || null;
  const key = l.key || sh?.key || '';
  const region = l.region || sh?.region || '';
  return { key, region, voice: l.voice || sh?.voice || '', voices: l.voices, styles: l.styles || {}, shared: !!(sh?.key && sh.key === key) };
}
export const azureReady = () => { const c = azureConfig(); return !!(c.key && c.region); };
export function setAzureShared(on) {
  const c = azureConfig();
  state.settings.ttsShared = on && c.key ? { key: c.key, region: c.region, voice: c.voice } : null;
}

// Consumo aproximado del mes (lo que lee este dispositivo)
const month = () => new Date().toISOString().slice(0, 7);
export function usage() { try { const u = JSON.parse(localStorage.getItem(USE) || '{}'); return u.month === month() ? u.chars || 0 : 0; } catch { return 0; } }
function addUsage(n) { try { localStorage.setItem(USE, JSON.stringify({ month: month(), chars: usage() + n })); } catch { /* */ } }

function azureError(status) {
  if (status === 401 || status === 403) return 'La clave o la región de Azure no coinciden. Revisa ambas en el portal (Claves y punto de conexión).';
  if (status === 429) return 'Azure está limitando las peticiones o se acabó el cupo gratis del mes.';
  if (status === 400) return 'Azure no aceptó el texto o la voz elegida.';
  return 'Azure respondió con un error (' + status + ').';
}

const base = (region) => `https://${region}.tts.speech.microsoft.com/cognitiveservices`;

/** Lista las voces que sirven en español: las de países hispanohablantes y las multilingües */
export async function fetchVoices(key, region) {
  const r = await httpRequest({ method: 'GET', url: base(region) + '/voices/list', headers: { 'Ocp-Apim-Subscription-Key': key } });
  if (r.status !== 200) throw new Error(azureError(r.status));
  let list;
  try { list = JSON.parse(r.text); } catch { throw new Error('Azure devolvió una respuesta que no se entiende. Revisa la región.'); }
  return list
    .filter((v) => /^es-/i.test(v.Locale) || /DragonHD(?!Flash)/i.test(v.ShortName) || (/Multilingual/i.test(v.ShortName) && (v.SecondaryLocaleList || []).some((l) => /^es-/i.test(l))))
    .map((v) => ({ id: v.ShortName, name: v.LocalName || v.DisplayName, locale: v.Locale, country: countryOf(v.Locale, String(v.LocaleName || v.Locale).replace(/^.*\((.*)\).*$/, '$1')), gender: v.Gender === 'Female' ? 'mujer' : 'hombre', multi: /Multilingual|DragonHD/i.test(v.ShortName), hd: /DragonHD/i.test(v.ShortName), styles: (v.StyleList || []).filter((x) => x && x !== 'general') }));
}

const COUNTRY = { CO: 'Colombia', MX: 'México', ES: 'España', US: 'EE. UU.', AR: 'Argentina', BO: 'Bolivia', CL: 'Chile', CR: 'Costa Rica', CU: 'Cuba', DO: 'Rep. Dominicana', EC: 'Ecuador', GQ: 'Guinea Ecuatorial', GT: 'Guatemala', HN: 'Honduras', NI: 'Nicaragua', PA: 'Panamá', PE: 'Perú', PR: 'Puerto Rico', PY: 'Paraguay', SV: 'El Salvador', UY: 'Uruguay', VE: 'Venezuela' };
const countryOf = (locale, fallback) => COUNTRY[String(locale).split('-')[1]] || fallback;

/** Estilo elegido para una voz ('' = normal) */
export const styleFor = (voice) => azureConfig().styles[voice] || '';
export function setStyleFor(voice, style) { const st = { ...localAzure().styles }; if (style) st[voice] = style; else delete st[voice]; saveAzure({ styles: st }); }
export const voiceInfo = (id) => (azureConfig().voices || []).find((v) => v.id === id) || null;

const STYLE_ES = { cheerful: 'Alegre', excited: 'Emocionada/o', friendly: 'Amigable', hopeful: 'Esperanzada/o', sad: 'Triste', angry: 'Enojada/o', whispering: 'Susurrando', shouting: 'Gritando', terrified: 'Aterrada/o', unfriendly: 'Antipática/o', empathetic: 'Empática/o', calm: 'Calmada/o', chat: 'Conversación', assistant: 'Asistente', newscast: 'Noticiero', 'newscast-casual': 'Noticiero informal', 'newscast-formal': 'Noticiero formal', customerservice: 'Servicio al cliente', gentle: 'Suave', serious: 'Seria/o', affectionate: 'Cariñosa/o', embarrassed: 'Avergonzada/o', fearful: 'Con miedo', disgruntled: 'Molesta/o', depressed: 'Deprimida/o', envious: 'Envidiosa/o', lyrical: 'Lírica/o', 'poetry-reading': 'Leyendo poesía', 'narration-professional': 'Narración', 'narration-relaxed': 'Narración relajada', 'documentary-narration': 'Documental', sports_commentary: 'Comentarista deportivo', sports_commentary_excited: 'Comentarista emocionado', advertisement_upbeat: 'Comercial animado', livecommercial: 'Comercial en vivo', story: 'Cuento', funny: 'Graciosa/o', curious: 'Curiosa/o', surprised: 'Sorprendida/o', relieved: 'Aliviada/o', confused: 'Confundida/o', 'chat-casual': 'Conversación relajada', 'whisper': 'Susurrando', 'sorry': 'Apenada/o' };
export const styleName = (s) => STYLE_ES[s] || s.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function prettyAzure(v) {
  return `${v.name} · ${v.hd ? 'HD' : v.multi ? 'multilingüe' : v.country} · ${v.gender}`;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Convierte texto en audio MP3 (base64) */
export async function synthesize(text, { voice, rate = 1, pitch = 1, style } = {}) {
  const c = azureConfig();
  const v = voice || c.voice || 'es-CO-SalomeNeural';
  const t = String(text).slice(0, MAX_CHARS);
  const st = style === undefined ? styleFor(v) : style;
  const send = async (withStyle) => {
    const r = await httpRequest({
      method: 'POST',
      url: base(c.region) + '/v1',
      headers: { 'Ocp-Apim-Subscription-Key': c.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'Organizador' },
      body: buildSsml(t, v, { rate, pitch, style: withStyle }),
      binary: true,
    });
    return r;
  };
  let r = await send(st);
  // Si la voz no acepta el estilo, se intenta sin él
  if (r.status === 400 && st) r = await send('');
  if (r.status !== 200 || !r.b64) throw new Error(azureError(r.status));
  addUsage(t.length);
  return r.b64;
}

const pct = (x) => { const n = Math.round((x - 1) * 100); return `${n >= 0 ? '+' : ''}${n}%`; };

export function buildSsml(t, v, { rate = 1, pitch = 1, style = '' } = {}) {
  const hd = /DragonHD/i.test(v);
  const lang = v.split('-').slice(0, 2).join('-');
  // Las voces HD detectan solas el idioma y la entonación: se les manda el texto tal cual
  let body = hd ? xml(t) : `<prosody rate="${pct(rate)}" pitch="${pct(pitch)}">${xml(t)}</prosody>`;
  // Las voces multilingües hablan español con acento latino si se les indica el idioma
  if (/Multilingual/i.test(v)) body = `<lang xml:lang="es-MX">${body}</lang>`;
  if (style && !hd) body = `<mstts:express-as style="${xml(style)}">${body}</mstts:express-as>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${hd ? 'es-MX' : lang}"><voice name="${xml(v)}">${body}</voice></speak>`;
}
