// Genera src/icons.js con los íconos Tabler (outline) que usa la app
import fs from 'fs';
const names = ['home','calendar','checklist','book','barbell','salad','printer','chart-line','notes','settings','plus','trash','edit','player-play','player-pause','player-stop','check','x','flame','clock','flag','paperclip','file','photo','download','upload','bell','alert-triangle','trophy','cake','users','coin','package','receipt','scale','target','arrow-left','chevron-left','chevron-right','dots','user','cash','stopwatch','repeat','star','device-floppy','school','briefcase','calendar-event','menu-2','trending-up','trending-down','share','volume','moon','sun','circle-check','circle','list-details','minus','bolt','search','heart'];
const out = {};
for (const n of names) {
  const svg = fs.readFileSync(`node_modules/@tabler/icons/icons/outline/${n}.svg`, 'utf8');
  out[n] = [...svg.matchAll(/<(path|circle|rect|line|polyline|ellipse)[^>]*\/>/g)].map(m => m[0]).filter(s => !s.includes('stroke="none"')).join('');
}
fs.writeFileSync('src/icons.js', '// Archivo generado por scripts/gen-icons.mjs (íconos Tabler, licencia MIT)\nconst P = ' + JSON.stringify(out) + ';\nexport function icon(name, size = 18) {\n  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || \'\'}</svg>`;\n}\n');
console.log('ok', Object.keys(out).length);
