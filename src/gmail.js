// Gmail (solo lectura): buscar y leer correos para que Aries te los resuma o lea en voz alta.
import { httpRequest } from './platform.js';
import { googleToken, googleHasGmail, googleSignedIn } from './google.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const gmailReady = () => googleSignedIn() && googleHasGmail();

async function get(path) {
  if (!gmailReady()) throw new Error('Primero conecta Gmail en Ajustes → Asistente de IA → Correos.');
  const r = await httpRequest({ method: 'GET', url: API + path, headers: { Authorization: 'Bearer ' + (await googleToken()) }, timeout: 20000 });
  if (r.status === 403) throw new Error(/insufficient|scope/i.test(r.text) ? 'Falta el permiso de Gmail: vuelve a conectar Gmail en Ajustes.' : 'Gmail no está activado en tu proyecto de Google (activa la "Gmail API").');
  if (r.status === 401) throw new Error('Tu sesión de Google expiró: vuelve a conectar en Ajustes.');
  if (r.status !== 200) throw new Error('Gmail respondió con un error (' + r.status + ').');
  return JSON.parse(r.text);
}

const b64url = (s) => { try { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))); } catch { return ''; } };
const header = (m, n) => (m.payload?.headers || []).find((h) => h.name.toLowerCase() === n)?.value || '';

function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return b64url(part.body.data);
  if (part.parts) { for (const p of part.parts) { const t = bodyText(p); if (t) return t; } }
  if (part.mimeType === 'text/html' && part.body?.data) return b64url(part.body.data).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return '';
}

const fromName = (f) => (f.match(/^"?([^"<]+?)"?\s*</) || [, f])[1].trim();

/** Busca correos (consulta con la sintaxis de Gmail, ej. "is:unread", "from:universidad newer_than:2d") */
export async function searchMail(query = 'in:inbox', max = 5, { full = false } = {}) {
  const list = await get(`/messages?maxResults=${Math.min(10, max)}&q=${encodeURIComponent(query || 'in:inbox')}`);
  const out = [];
  for (const { id } of list.messages || []) {
    const m = await get(`/messages/${id}?format=${full ? 'full' : 'metadata'}&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const body = full ? bodyText(m.payload).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim() : '';
    out.push({ id, from: fromName(header(m, 'from')), subject: header(m, 'subject') || '(sin asunto)', date: header(m, 'date'), unread: (m.labelIds || []).includes('UNREAD'), snippet: (m.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'), body: body.length > 3500 ? body.slice(0, 3500) + ' […]' : body });
  }
  return out;
}
