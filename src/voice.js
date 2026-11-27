// Voz: dictado (Android nativo o Whisper de Groq) y lectura en voz alta (voz del sistema)
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { isAndroid, httpMultipart } from './platform.js';
import { aiConfig } from './ai.js';
import { azureReady, synthesize } from './azuretts.js';
import { toast } from './util.js';

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

/** Transcribe un WAV en base64 (grabado por la tableta) */
export async function transcribeB64(b64) {
  if (!groqKey()) throw new Error('Para escucharte sobre otras apps necesito la clave de Groq.');
  const r = await httpMultipart({
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    headers: { Authorization: 'Bearer ' + groqKey() },
    fields: { model: 'whisper-large-v3-turbo', language: 'es', response_format: 'json', temperature: 0 },
    file: { field: 'file', name: 'voz.wav', mime: 'audio/wav', b64 },
  });
  if (r.status !== 200) throw new Error('No se pudo transcribir el audio (' + r.status + ').');
  return (JSON.parse(r.text).text || '').trim();
}

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
    let stopped = false;
    const once = () => SpeechRecognition.start({ language: 'es-CO', maxResults: 1, partialResults: false, popup: false })
      .then((r) => ({ text: (r?.matches?.[0] || '').trim() }), (err) => ({ text: '', err }));
    // Si el dictado se corta casi al instante (micrófono aún ocupado, ruido del pitido), se reintenta solo
    const done = (async () => {
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        const r = await once();
        if (r.text || stopped) return r.text;
        const msg = String(r.err?.message || r.err || '');
        if (Date.now() - t0 < 2500 && i < 2) { await new Promise((ok) => setTimeout(ok, 500)); if (stopped) return ''; continue; }
        if (!r.err || /no match|didn't understand|timeout|busy|\b[5678]\b/i.test(msg)) return '';
        throw new Error('No se pudo escuchar: ' + msg);
      }
      return '';
    })();
    return { done, stop: () => { stopped = true; return SpeechRecognition.stop().catch(() => {}); } };
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
export function voicePrefs() { const d = { name: '', rate: 1, pitch: 1, engine: '' }; try { return { ...d, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return d; } }
/** 'azure' si hay clave de Azure y no se eligió la voz del dispositivo */
export function voiceEngine() { const e = voicePrefs().engine; return e === 'sistema' ? 'sistema' : azureReady() ? 'azure' : 'sistema'; }
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
/** Deja el texto listo para leerlo en voz alta: sin formato, emojis ni símbolos que suenan raro */
const clean = (t) => String(t || '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
  .replace(/https?:\/\/\S+/g, 'el enlace')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
  .replace(/\s*(→|->|=>)\s*/g, ': ').replace(/\s+[–—]\s+/g, ', ').replace(/\s+\/\s+/g, ' o ').replace(/([a-záéíóúñ])\/([a-záéíóúñ])/gi, '$1 por $2')
  .replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '')
  .replace(/[_`>|#]/g, '')
  .replace(/\(([^)]{1,40})\)/g, ', $1,')
  .split(/\n+/).map((l) => l.trim()).filter(Boolean)
  .map((l) => (/[.!?:;,]$/.test(l) ? l : l + '.')).join(' ')
  .replace(/:\./g, ':').replace(/\s+([,.])/g, '$1').replace(/,\s*([.,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
let speaking = false;
export const isSpeaking = () => speaking;

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const es = voices.filter((v) => /^es/i.test(v.lang));
  const pref = ['es-CO', 'es-MX', 'es-US', 'es-419', 'es-ES'];
  return es.sort((a, b) => (pref.indexOf(a.lang) + 99) % 99 - (pref.indexOf(b.lang) + 99) % 99 || (/natural|online|neural/i.test(b.name) ? 1 : 0) - (/natural|online|neural/i.test(a.name) ? 1 : 0))[0] || null;
}

// Nivel de la voz para mover la boca de la carita (0 a 1)
let actx = null, analyser = null, abuf = null, realLevel = false;
function tapAudio(a) {
  realLevel = false;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state !== 'running') { actx.resume().catch(() => {}); if (actx.state !== 'running') return; } // sin contexto activo se deja sonar directo
    const src = actx.createMediaElementSource(a);
    analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    abuf = new Uint8Array(analyser.fftSize);
    src.connect(analyser);
    analyser.connect(actx.destination);
    realLevel = true;
  } catch { realLevel = false; }
}
/** Qué tan fuerte suena la voz en este instante (real con Azure; aproximado con la voz del sistema) */
export function speechLevel() {
  if (!speaking) return 0;
  if (realLevel && analyser && audio) {
    analyser.getByteTimeDomainData(abuf);
    let sum = 0;
    for (const v of abuf) sum += (v - 128) * (v - 128);
    return Math.min(1, Math.sqrt(sum / abuf.length) / 28);
  }
  const t = performance.now() / 1000;
  const syll = Math.abs(Math.sin(t * 11)) * (0.55 + 0.45 * Math.sin(t * 2.3)); // sílabas aproximadas
  return Math.max(0, Math.min(1, 0.15 + syll * 0.75));
}

let audio = null;
let gen = 0;
// Con la app en segundo plano (carita chiquita) la voz de Azure la reproduce Android
let audioSink = null;
export const setAudioSink = (sink) => { audioSink = sink; }; // cada lectura nueva invalida las anteriores
let azureWarned = false;

/** Lee con Azure. Devuelve false si no se pudo (para usar la voz del dispositivo). */
async function speakAzure(t, pref, finish, opts) {
  const my = gen;
  let b64;
  try { b64 = await synthesize(t, { rate: pref.rate || 1, pitch: pref.pitch || 1, voice: opts.azureVoice, style: opts.style }); }
  catch (e) {
    if (opts.strict) throw e;
    if (!azureWarned) { azureWarned = true; toast('Voz de Azure no disponible: ' + e.message + ' Uso la voz del dispositivo.', { ms: 6000 }); }
    return false;
  }
  if (my !== gen) { finish(); return true; } // se canceló mientras llegaba el audio
  if (audioSink) { try { await audioSink.play(b64); } catch { /* */ } if (my === gen) finish(); return true; }
  const a = new Audio('data:audio/mpeg;base64,' + b64);
  audio = a;
  tapAudio(a);
  const done = () => { if (audio === a) audio = null; finish(); };
  a.onended = done;
  a.onerror = done;
  try { await a.play(); } catch { done(); }
  return true;
}

/**
 * Lee un texto en voz alta. onEnd se llama al terminar.
 * opts.azureVoice: probar una voz de Azure concreta; opts.strict: lanzar el error en vez de cambiar de voz.
 */
export async function speak(text, onEnd, opts = {}) {
  const t = clean(text);
  if (!t) return;
  await stopSpeaking();
  const myGen = gen;
  speaking = true;
  let ended = false;
  const finish = () => { if (ended) return; ended = true; if (myGen === gen) speaking = false; onEnd?.(); };
  const pref = voicePrefs();
  if (opts.azureVoice || voiceEngine() === 'azure') {
    try { if (await speakAzure(t, pref, finish, opts)) return; }
    catch (e) { finish(); throw e; }
    if (myGen !== gen) return;
  }
  if (isAndroid) {
    let voice;
    if (pref.name) { try { const vs = (await TextToSpeech.getSupportedVoices()).voices || []; const i = vs.findIndex((v) => (v.voiceURI || v.name) === pref.name); if (i >= 0) voice = i; } catch { /* */ } }
    try { await TextToSpeech.speak({ text: t, lang: 'es-CO', rate: pref.rate || 1, pitch: pref.pitch || 1, volume: 1.0, ...(voice !== undefined ? { voice } : {}) }); }
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
  u.pitch = pref.pitch || 1;
  u.onend = finish;
  u.onerror = finish;
  synth.speak(u);
}

export async function stopSpeaking() {
  if (audioSink && speaking) audioSink.stop();
  gen++;
  speaking = false;
  if (audio) { const a = audio; audio = null; try { a.pause(); } catch { /* */ } a.onended?.(); }
  if (isAndroid) { try { await TextToSpeech.stop(); } catch { /* */ } return; }
  window.speechSynthesis?.cancel();
}
