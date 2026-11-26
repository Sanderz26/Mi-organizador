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
  try { return { key: '', region: '', voice: '', voices: [], ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { key: '', region: '', voice: '', voices: [] }; }
}
export function saveAzure(p) { try { localStorage.setItem(LS, JSON.stringify({ ...localAzure(), ...p })); } catch { /* */ } }

/** Configuración efectiva: lo de este dispositivo manda; lo compartido completa */
export function azureConfig() {
  const l = localAzure();
  const sh = state.settings.ttsShared || null;
  const key = l.key || sh?.key || '';
  const region = l.region || sh?.region || '';
  return { key, region, voice: l.voice || sh?.voice || '', voices: l.voices, shared: !!(sh?.key && sh.key === key) };
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
    .filter((v) => /^es-/i.test(v.Locale) || (/Multilingual/i.test(v.ShortName) && (v.SecondaryLocaleList || []).some((l) => /^es-/i.test(l))))
    .map((v) => ({ id: v.ShortName, name: v.LocalName || v.DisplayName, locale: v.Locale, country: countryOf(v.Locale, String(v.LocaleName || v.Locale).replace(/^.*\((.*)\).*$/, '$1')), gender: v.Gender === 'Female' ? 'mujer' : 'hombre', multi: /Multilingual/i.test(v.ShortName) }));
}

const COUNTRY = { CO: 'Colombia', MX: 'México', ES: 'España', US: 'EE. UU.', AR: 'Argentina', BO: 'Bolivia', CL: 'Chile', CR: 'Costa Rica', CU: 'Cuba', DO: 'Rep. Dominicana', EC: 'Ecuador', GQ: 'Guinea Ecuatorial', GT: 'Guatemala', HN: 'Honduras', NI: 'Nicaragua', PA: 'Panamá', PE: 'Perú', PR: 'Puerto Rico', PY: 'Paraguay', SV: 'El Salvador', UY: 'Uruguay', VE: 'Venezuela' };
const countryOf = (locale, fallback) => COUNTRY[String(locale).split('-')[1]] || fallback;

export function prettyAzure(v) {
  return `${v.name} · ${v.multi ? 'multilingüe' : v.country} · ${v.gender}`;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Convierte texto en audio MP3 (base64) */
export async function synthesize(text, { voice, rate = 1 } = {}) {
  const c = azureConfig();
  const v = voice || c.voice || 'es-CO-SalomeNeural';
  const t = String(text).slice(0, MAX_CHARS);
  const lang = v.split('-').slice(0, 2).join('-');
  const pct = Math.round((rate - 1) * 100);
  const body = `<prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${xml(t)}</prosody>`;
  // Las voces multilingües hablan español con acento latino si se les indica el idioma
  const inner = /Multilingual/i.test(v) ? `<lang xml:lang="es-MX">${body}</lang>` : body;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${xml(v)}">${inner}</voice></speak>`;
  const r = await httpRequest({
    method: 'POST',
    url: base(c.region) + '/v1',
    headers: { 'Ocp-Apim-Subscription-Key': c.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'Organizador' },
    body: ssml,
    binary: true,
  });
  if (r.status !== 200 || !r.b64) throw new Error(azureError(r.status));
  addUsage(t.length);
  return r.b64;
}
