// Recordatorios: Android los programa en el sistema; Windows los revisa mientras la app está abierta o en la bandeja
import { upcomingReminders } from './agenda.js';
import { isAndroid, scheduleAndroid, showNotification } from './platform.js';
import { sound } from './sound.js';
import { toast } from './util.js';

let timer = null;
let resched = null;
const LS = 'organizador-last-reminder-check';

export function refreshReminders() {
  if (!isAndroid) return;
  clearTimeout(resched);
  resched = setTimeout(() => scheduleAndroid(upcomingReminders(45)), 800);
}

export function startReminderLoop() {
  if (isAndroid) { refreshReminders(); return; }
  if (timer) return;
  const check = () => {
    const now = Date.now();
    let last = Number(localStorage.getItem(LS) || 0);
    if (!last || now - last > 30 * 60000) last = now - 30 * 60000; // al abrir, muestra lo de la última media hora
    const due = upcomingReminders(3).filter((r) => r.at > last && r.at <= now);
    for (const r of due) {
      showNotification(r.title, r.body);
      toast(r.body, { title: r.title, icon: 'bell', ms: 6000 });
    }
    if (due.length) sound('alarm');
    try { localStorage.setItem(LS, String(now)); } catch { /* */ }
  };
  check();
  timer = setInterval(check, 20000);
}
