// Inicio de sesión con Google (OAuth con PKCE) y manejo del token de acceso
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { GOOGLE } from './googleconfig.js';
import { isWindows, isAndroid, httpRequest } from './platform.js';

const LS = 'organizador-google';
const SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
let access = { token: '', exp: 0 };

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function randomString(n = 64) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a).slice(0, n);
}
async function challenge(verifier) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(d));
}

const client = () => (isWindows ? { id: GOOGLE.desktopClientId, secret: GOOGLE.desktopClientSecret } : isAndroid ? { id: GOOGLE.androidClientId, secret: '' } : { id: '', secret: '' });
export const googleAvailable = () => !!client().id;

function saved() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } }
function save(v) { try { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS); } catch { /* */ } }
export const googleAccount = () => saved();
export const googleSignedIn = () => !!saved()?.refresh;

const form = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

async function tokenRequest(params) {
  const r = await httpRequest({ method: 'POST', url: 'https://oauth2.googleapis.com/token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(params) });
  let j = {};
  try { j = JSON.parse(r.text); } catch { /* */ }
  if (r.status !== 200) {
    const e = new Error(j.error_description || j.error || 'Google rechazó la solicitud (' + r.status + ')');
    e.code = j.error;
    throw e;
  }
  return j;
}

function emailFromIdToken(idt) {
  try { return JSON.parse(atob(idt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { return ''; }
}

/** Android: espera a que Google devuelva la app con el código */
function waitForAndroidRedirect(state) {
  return new Promise((resolve) => {
    let handle;
    const timer = setTimeout(() => { handle?.remove?.(); resolve({ error: 'tiempo' }); }, 5 * 60000);
    App.addListener('appUrlOpen', ({ url }) => {
      if (!url || !url.startsWith(GOOGLE.androidRedirect)) return;
      clearTimeout(timer);
      handle?.remove?.();
      Browser.close().catch(() => {});
      const q = new URL(url.replace(GOOGLE.androidRedirect, 'https://x/cb')).searchParams;
      if (q.get('state') !== state) resolve({ error: 'estado' });
      else resolve(q.get('code') ? { code: q.get('code'), redirectUri: GOOGLE.androidRedirect } : { error: q.get('error') || 'cancelado' });
    }).then((h) => { handle = h; });
  });
}

/** Abre la ventana de Google para elegir la cuenta y dar permiso */
export async function googleSignIn() {
  const c = client();
  if (!c.id) throw new Error('La conexión con Google aún no está configurada en esta versión.');
  const verifier = randomString(64);
  const state = randomString(24);
  const base = 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
    client_id: c.id, response_type: 'code', scope: SCOPES, code_challenge: await challenge(verifier), code_challenge_method: 'S256',
    state, access_type: 'offline', prompt: 'consent select_account',
  });
  let res;
  if (isWindows) res = await window.native.googleAuth(base);
  else if (isAndroid) {
    const wait = waitForAndroidRedirect(state);
    await Browser.open({ url: base + '&redirect_uri=' + encodeURIComponent(GOOGLE.androidRedirect) });
    res = await wait;
  } else throw new Error('Disponible en la app instalada.');
  if (!res || res.error) throw new Error(res?.error === 'access_denied' || res?.error === 'cancelado' ? 'Cancelaste el inicio de sesión.' : res?.error === 'tiempo' ? 'Se acabó el tiempo para iniciar sesión.' : 'No se pudo iniciar sesión (' + (res?.error || 'error') + ').');
  if (isWindows && res.state !== state) throw new Error('La respuesta de Google no coincide; intenta de nuevo.');
  const t = await tokenRequest({ grant_type: 'authorization_code', code: res.code, client_id: c.id, client_secret: c.secret || undefined, redirect_uri: res.redirectUri, code_verifier: verifier });
  if (!t.refresh_token) throw new Error('Google no entregó un permiso permanente; intenta de nuevo.');
  access = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  const account = { refresh: t.refresh_token, email: emailFromIdToken(t.id_token), clientId: c.id };
  save(account);
  return account;
}

/** Token de acceso vigente (lo renueva solo) */
export async function googleToken() {
  if (access.token && Date.now() < access.exp) return access.token;
  const acc = saved();
  if (!acc?.refresh) throw new Error('No has iniciado sesión con Google.');
  const c = client();
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: acc.refresh, client_id: acc.clientId || c.id, client_secret: c.secret || undefined });
    access = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    return access.token;
  } catch (e) {
    if (e.code === 'invalid_grant') { save(null); throw new Error('Tu sesión de Google expiró. Vuelve a conectar en Ajustes.'); }
    throw e;
  }
}

export async function googleSignOut() {
  const acc = saved();
  save(null);
  access = { token: '', exp: 0 };
  if (acc?.refresh) { try { await httpRequest({ method: 'POST', url: 'https://oauth2.googleapis.com/revoke', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: acc.refresh }) }); } catch { /* */ } }
}
