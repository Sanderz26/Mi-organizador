// Calculadora exacta para Aries (la IA no hace cuentas de memoria: se las pasa a la app).
let mathP = null;
const math = () => (mathP ||= import('mathjs').then((m) => m.create(m.all, { number: 'number', precision: 64 })));

const fmt = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('es-CO') : Number(v.toPrecision(12)).toLocaleString('es-CO', { maximumFractionDigits: 10 });
  return String(v);
};

/**
 * Resuelve una cuenta. tipo: 'calcular' (expresión, también unidades: "5 km to m"),
 * 'derivar' (expresión + variable), 'resolver' (ecuación lineal o cuadrática en una variable)
 */
export async function calculate({ expresion = '', variable = 'x', modo = 'calcular' }) {
  const m = await math();
  const expr = String(expresion).replace(/×/g, '*').replace(/÷/g, '/').replace(/√/g, 'sqrt').replace(/,(?=\d{3}\b)/g, '').trim();
  if (!expr) throw new Error('No hay nada que calcular');
  if (modo === 'derivar') return `d/d${variable} de ${expr} = ${m.simplify(m.derivative(expr, variable)).toString()}`;
  if (modo === 'resolver') {
    // ax² + bx + c = 0 (o lineal): se pasa todo a un lado y se sacan los coeficientes
    const [l, r = '0'] = expr.split('=');
    const f = m.simplify(`(${l}) - (${r})`);
    const at = (x) => f.evaluate({ [variable]: x });
    const c = at(0), a = (at(1) + at(-1)) / 2 - c, b = (at(1) - at(-1)) / 2;
    if (Math.abs(at(2) - (4 * a + 2 * b + c)) > 1e-9) return `No pude resolver ${expr} de forma exacta (no es lineal ni cuadrática).`;
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? (Math.abs(c) < 1e-12 ? 'Cualquier valor sirve.' : 'No tiene solución.') : `${variable} = ${fmt(-c / b)}`;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return `No tiene soluciones reales (discriminante ${fmt(disc)}).`;
    const x1 = (-b + Math.sqrt(disc)) / (2 * a), x2 = (-b - Math.sqrt(disc)) / (2 * a);
    return disc === 0 ? `${variable} = ${fmt(x1)}` : `${variable} = ${fmt(x1)} o ${variable} = ${fmt(x2)}`;
  }
  const v = m.evaluate(expr);
  return `${expr} = ${fmt(typeof v === 'object' && v?.toString ? v.toString() : v)}`;
}
