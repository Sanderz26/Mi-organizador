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
export function chart(canvas, { kind = 'line', labels, series, stacked = false, yFmt, legend = series.length > 1, min, max, y2 } = {}) {
  if (!canvas) return null;
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
  return c;
}
