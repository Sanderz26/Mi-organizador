// Gráficas con Chart.js, con colores que siguen el tema claro u oscuro
import { Chart, LineController, BarController, LineElement, BarElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(LineController, BarController, LineElement, BarElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

const live = new Set();
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Convierte "var(--x)" en el color real */
export const resolveColor = (c) => (c && c.startsWith('var(') ? cssVar(c.slice(4, -1)) : c);

export function destroyCharts() {
  live.forEach((c) => c.destroy());
  live.clear();
}

/**
 * kind: 'line' | 'bar'
 * series: [{ label, data, color, fill, type, dashed, yAxisID }]
 */
const hiddenKey = (k) => 'grafica-oculta-' + k;
function loadHidden(key, series, defaultVisible) {
  try {
    const raw = localStorage.getItem(hiddenKey(key));
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* */ }
  return new Set(series.slice(defaultVisible).map((s) => s.label));
}
function saveHidden(key, set) { try { localStorage.setItem(hiddenKey(key), JSON.stringify([...set])); } catch { /* */ } }

/**
 * pick: clave para recordar qué series ve el usuario; muestra botones para elegirlas.
 * defaultVisible: cuántas series se ven la primera vez (el resto queda oculto).
 */
export function chart(canvas, { kind = 'line', labels, series, stacked = false, yFmt, legend = series.length > 1, min, max, y2, pick, defaultVisible = 4 } = {}) {
  if (!canvas) return null;
  let hidden = null;
  if (pick && series.length > 1) {
    hidden = loadHidden(pick, series, defaultVisible);
    legend = false;
  }
  const ink2 = cssVar('--ink-2'), line = cssVar('--line');
  const datasets = series.map((s) => {
    const c = resolveColor(s.color || 'var(--accent)');
    const t = s.type || kind;
    return {
      type: t, label: s.label, data: s.data, yAxisID: s.yAxisID || 'y',
      borderColor: c, backgroundColor: t === 'bar' ? c + 'd9' : c + '22',
      fill: !!s.fill, tension: 0.3, cubicInterpolationMode: 'monotone', borderWidth: t === 'bar' ? 0 : 2,
      pointRadius: s.data.length > 40 ? 0 : 2.5, pointHoverRadius: 4, borderRadius: 5, maxBarThickness: 34,
      borderDash: s.dashed ? [5, 4] : undefined, spanGaps: true, stack: stacked ? 'a' : undefined,
      hidden: hidden ? hidden.has(s.label) : false,
    };
  });
  const scales = {
    x: { stacked, grid: { display: false }, ticks: { color: ink2, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 11 } }, border: { color: line } },
    y: { stacked, min, max, grid: { color: line }, border: { display: false }, ticks: { color: ink2, font: { size: 11 }, maxTicksLimit: 6, callback: yFmt ? (v) => yFmt(v) : undefined } },
  };
  if (y2) scales.y2 = { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: ink2, font: { size: 11 }, maxTicksLimit: 6 } };
  const c = new Chart(canvas, {
    type: kind,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: legend, position: 'bottom', labels: { color: ink2, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 } } },
        tooltip: { callbacks: yFmt ? { label: (ctx) => `${ctx.dataset.label}: ${yFmt(ctx.parsed.y)}` } : {} },
      },
      scales,
    },
  });
  live.add(c);
  if (hidden) chipBar(canvas, c, series, hidden, pick);
  return c;
}

function chipBar(canvas, c, series, hidden, key) {
  const box = canvas.closest('.chart') || canvas.parentElement;
  box.parentElement.querySelector(`.chips[data-for="${key}"]`)?.remove();
  const bar = document.createElement('div');
  bar.className = 'chips';
  bar.dataset.for = key;
  const draw = () => {
    const all = series.every((s) => !hidden.has(s.label));
    bar.innerHTML = (series.length > 3 ? `<button class="chip ${all ? 'on' : ''}" data-all>${all ? 'Ocultar todas' : 'Ver todas'}</button>` : '') +
      series.map((s, i) => `<button class="chip ${hidden.has(s.label) ? 'off' : 'on'}" data-i="${i}" aria-pressed="${!hidden.has(s.label)}"><i style="background:${resolveColor(s.color || 'var(--accent)')}"></i>${escapeHtml(s.label)}</button>`).join('');
  };
  draw();
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('all' in b.dataset) {
      const show = !series.every((s) => !hidden.has(s.label));
      hidden.clear();
      if (show) series.forEach((s) => hidden.add(s.label));
    } else {
      const s = series[Number(b.dataset.i)];
      if (hidden.has(s.label)) hidden.delete(s.label); else hidden.add(s.label);
    }
    series.forEach((s, i) => c.setDatasetVisibility(i, !hidden.has(s.label)));
    c.update();
    saveHidden(key, hidden);
    draw();
  });
  box.before(bar);
}
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
