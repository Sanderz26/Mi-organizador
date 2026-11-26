// Voz: dictado (Android nativo o Whisper de Groq) y lectura en voz alta (voz del sistema)
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { isAndroid, httpMultipart } from './platform.js';
import { aiConfig } from './ai.js';

const groqKey = () => aiConfig().keys.groq || '';
let nativeOk = null;

async function nativeRecognitionAvailable() {
  if (!isAndroid) return false;
  if (nativeOk !== null) return nativeOk;
  try { nativeOk = !!(await SpeechRecognition.available()).available; } catch { nativeOk = false; }
  return nativeOk;
}

/** ¿Se puede dictar en este dispositivo? */
export async function canDictate() {
  if (await nativeRecognitionAvailable()) return { ok: true };
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return { ok: false, why: 'Este dispositivo no permite grabar audio.' };
  if (!groqKey()) return { ok: false, why: 'Para dictar en este dispositivo necesitas una clave de Groq (gratis) en Ajustes → Asistente.' };
  return { ok: true };
}

const blobToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });

/** Transcribe audio con Whisper en Groq */
async function transcribe(blob) {
  const mime = blob.type || 'audio/webm';
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  const r = await httpMultipart({
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    headers: { Authorization: 'Bearer ' + groqKey() },
    fields: { model: 'whisper-large-v3-turbo', language: 'es', response_format: 'json', temperature: 0 },
    file: { field: 'file', name: `voz.${ext}`, mime: mime.split(';')[0], b64: await blobToB64(blob) },
  });
  if (r.status === 401) throw new Error('La clave de Groq no es válida.');
  if (r.status === 429) throw new Error('Llegaste al límite gratis de dictado por ahora. Espera un minuto.');
  if (r.status !== 200) throw new Error('No se pudo transcribir el audio (' + r.status + ').');
  return (JSON.parse(r.text).text || '').trim();
}

/**
 * Empieza a escuchar. Devuelve { done: Promise<texto>, stop() }.
 * Se detiene solo al detectar silencio, o con stop().
 */
export async function listen({ onLevel, onStopped } = {}) {
  if (await nativeRecognitionAvailable()) {
    const perm = await SpeechRecognition.requestPermissions().catch(() => null);
    if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') throw new Error('Permite el micrófono para dictar.');
    const done = SpeechRecognition.start({ language: 'es-CO', maxResults: 1, partialResults: false, popup: false })
      .then((r) => (r?.matches?.[0] || '').trim())
      .catch((e) => { if (/no match|didn't understand|7/i.test(String(e?.message || e))) return ''; throw new Error('No se pudo escuchar: ' + (e?.message || e)); });
    return { done, stop: () => SpeechRecognition.stop().catch(() => {}) };
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { throw new Error('No hay permiso para usar el micrófono. Revisa la configuración de privacidad del micrófono.'); }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  // Detección de silencio: termina 1,6 s después de que dejas de hablar (máximo 60 s)
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  let spoke = false, quietSince = 0, timer;
  try { await ctx.resume(); } catch { /* */ }
  // Si el medidor no arranca, no se puede detectar silencio: se graba hasta que toques de nuevo
  const meter = ctx.state === 'running';
  const started = Date.now();
  const stop = () => { if (rec.state !== 'inactive') rec.stop(); };
  timer = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    onLevel?.(Math.min(1, peak / 60));
    if (!meter) { spoke = true; if (Date.now() - started > 60000) stop(); return; }
    if (peak > 12) { spoke = true; quietSince = 0; } else if (spoke) { quietSince ||= Date.now(); if (Date.now() - quietSince > 1600) stop(); }
    if (Date.now() - started > 60000 || (!spoke && Date.now() - started > 9000)) stop();
  }, 100);
  const done = new Promise((resolve, reject) => {
    rec.onstop = async () => {
      clearInterval(timer);
      onStopped?.();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      const size = chunks.reduce((a, c) => a + c.size, 0);
      if ((!spoke && size < 6000) || !chunks.length) { resolve(''); return; }
      try { resolve(await transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))); } catch (e) { reject(e); }
    };
  });
  rec.start(250);
  return { done, stop };
}

// ---------- Lectura en voz alta ----------
const PREF = 'organizador-voz';
export function voicePrefs() { try { return { name: '', rate: 1, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { name: '', rate: 1 }; } }
export function setVoicePrefs(p) { try { localStorage.setItem(PREF, JSON.stringify({ ...voicePrefs(), ...p })); } catch { /* */ } }

/** Voces disponibles en este dispositivo: las de español primero */
export async function listVoices() {
  let list = [];
  if (isAndroid) {
    try { list = ((await TextToSpeech.getSupportedVoices()).voices || []).map((v, i) => ({ id: v.voiceURI || v.name, name: v.name, lang: v.lang, index: i })); } catch { list = []; }
  } else if (window.speechSynthesis) {
    let v = window.speechSynthesis.getVoices();
    if (!v.length) { await new Promise((r) => { window.speechSynthesis.onvoiceschanged = r; setTimeout(r, 1000); }); v = window.speechSynthesis.getVoices(); }
    list = v.map((x, i) => ({ id: x.voiceURI || x.name, name: x.name, lang: x.lang, index: i }));
  }
  const es = list.filter((v) => /^es/i.test(v.lang)).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  return { es, others: list.filter((v) => !/^es/i.test(v.lang)) };
}
const prettyVoice = (v) => {
  const country = { 'es-CO': 'Colombia', 'es-MX': 'México', 'es-ES': 'España', 'es-US': 'EE. UU.', 'es-AR': 'Argentina', 'es-CL': 'Chile', 'es-PE': 'Perú', 'es-VE': 'Venezuela', 'es-419': 'Latinoamérica' }[String(v.lang).replace('_', '-')] || v.lang;
  const name = String(v.name).replace(/^Microsoft\s+/i, '').replace(/\s*-\s*Spanish.*$/i, '').replace(/\s*Online \(Natural\)/i, ' (natural)').replace(/Desktop/i, '').trim();
  return `${name || v.lang} · ${country}`;
};
export { prettyVoice };
const clean = (t) => String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[-•*]\s+/gm, '').replace(/[#_`>]/g, '').replace(/https?:\/\/\S+/g, 'el enlace').replace(/\n{2,}/g, '. ').replace(/\n/g, '. ').trim();
let speaking = false;
export const isSpeaking = () => speaking;

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const es = voices.filter((v) => /^es/i.test(v.lang));
  const pref = ['es-CO', 'es-MX', 'es-US', 'es-419', 'es-ES'];
  return es.sort((a, b) => (pref.indexOf(a.lang) + 99) % 99 - (pref.indexOf(b.lang) + 99) % 99 || (/natural|online|neural/i.test(b.name) ? 1 : 0) - (/natural|online|neural/i.test(a.name) ? 1 : 0))[0] || null;
}

export async function speak(text, onEnd) {
  const t = clean(text);
  if (!t) return;
  await stopSpeaking();
  speaking = true;
  const finish = () => { speaking = false; onEnd?.(); };
  const pref = voicePrefs();
  if (isAndroid) {
    let voice;
    if (pref.name) { try { const vs = (await TextToSpeech.getSupportedVoices()).voices || []; const i = vs.findIndex((v) => (v.voiceURI || v.name) === pref.name); if (i >= 0) voice = i; } catch { /* */ } }
    try { await TextToSpeech.speak({ text: t, lang: 'es-CO', rate: pref.rate || 1, pitch: 1.0, volume: 1.0, ...(voice !== undefined ? { voice } : {}) }); }
    catch { try { await TextToSpeech.speak({ text: t, lang: 'es-ES', rate: pref.rate || 1 }); } catch { /* sin voz */ } }
    finish();
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) { finish(); return; }
  if (!synth.getVoices().length) await new Promise((r) => { synth.onvoiceschanged = r; setTimeout(r, 800); });
  const u = new SpeechSynthesisUtterance(t);
  const v = (pref.name && synth.getVoices().find((x) => (x.voiceURI || x.name) === pref.name)) || pickVoice();
  u.lang = v?.lang || 'es-ES';
  try { if (v) u.voice = v; } catch { /* voz no válida: se usa la del idioma */ }
  u.rate = pref.rate || 1;
  u.onend = finish;
  u.onerror = finish;
  synth.speak(u);
}

export async function stopSpeaking() {
  speaking = false;
  if (isAndroid) { try { await TextToSpeech.stop(); } catch { /* */ } return; }
  window.speechSynthesis?.cancel();
}
