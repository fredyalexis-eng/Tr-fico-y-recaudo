/* Gráficos SVG sin dependencias externas */

import { moneyShort, money, numShort, pct, etiquetaCorta, mesCorto } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
/** Paleta activa; se refresca desde las variables CSS para respetar el tema. */
function leerTema() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, alt) => (cs.getPropertyValue(name) || '').trim() || alt;
  return {
    real: v('--chart-real', '#1f5f8b'),
    proy: v('--chart-proy', '#e08d1b'),
    banda: v('--chart-band', 'rgba(224,141,27,.16)'),
    grid: v('--chart-grid', '#e5e9ef'),
    axis: v('--chart-axis', '#6b7785'),
    text: v('--chart-ink', '#22303d'),
    accent: v('--chart-accent', '#0f766e'),
    danger: v('--chart-danger', '#b4442c'),
    tend: v('--chart-tend', '#6b46c1'),
  };
}

const COL = leerTema();

let uid = 0;

/** Ancho aproximado de un texto en px para una fuente sans de 11px. */
function anchoTexto(str, size = 11) {
  return String(str).length * size * 0.54;
}

/** Margen izquierdo necesario para las etiquetas del eje Y. */
function margenIzq(etiquetas, size = 11, base = 14) {
  const max = Math.max(...etiquetas.map((e) => anchoTexto(e, size)));
  return Math.max(34, Math.ceil(max + base));
}

function refrescarTema() {
  Object.assign(COL, leerTema());
}

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
}

function text(parent, x, y, str, attrs = {}) {
  const t = el('text', {
    x, y,
    fill: attrs.fill ?? COL.axis,
    'font-size': attrs.size ?? 11,
    'font-family': 'inherit',
    'text-anchor': attrs.anchor ?? 'middle',
    'font-weight': attrs.weight ?? 400,
    ...attrs.extra,
  }, parent);
  t.textContent = str;
  return t;
}

function niceScale(min, max, ticks = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, paso: 1 };
  if (min === max) { max = min + (min || 1) * 0.2; }
  const span = max - min;
  const raw = span / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const paso = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(min / paso) * paso, max: Math.ceil(max / paso) * paso, paso };
}

/* ─────────────────────────── gráfico de líneas ───────────────────────────── */

/**
 * Serie real + pronóstico (con banda de incertidumbre).
 * data: { real: number[], proy: number[], desde, banda: number[] }
 */
/**
 * Gráfico de líneas: serie observada + pronóstico.
 * `real` debe venir YA recortada al tramo visible; `proy` continúa justo después.
 * `desde` es el índice absoluto (mes global) del primer elemento de `real` y se
 * usa para rotular el eje X y para alinear las series auxiliares (`tendencia`).
 */
export function graficoSerie(host, {
  real, proy = null, banda = null, desde = 0, alto = 300,
  etiquetaY = (v) => moneyShort(v), marcas = [], tendencia = null, superpuesto = false,
}) {
  refrescarTema();
  host.innerHTML = '';
  const ancho = Math.max(320, host.clientWidth || 640);
  const n = real.length + (superpuesto ? 0 : (proy?.length ?? 0));
  if (!n) return;

  const todos = [...real.filter((v) => v != null), ...(proy ?? []).filter((v) => v != null),
    ...(banda ?? []).filter((v) => v != null)];
  const { min, max, paso } = niceScale(Math.min(0, ...todos), Math.max(...todos));
  const etiquetasY = [];
  for (let v = min; v <= max + paso / 2; v += paso) etiquetasY.push(etiquetaY(v));
  const m = { t: 18, r: 16, b: 34, l: margenIzq(etiquetasY) };
  const w = ancho - m.l - m.r;
  const h = alto - m.t - m.b;

  const svg = el('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: '100%', height: alto, role: 'img' }, host);
  const x = (i) => m.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v) => m.t + h - ((v - min) / (max - min || 1)) * h;

  // rejilla horizontal
  let k = 0;
  for (let v = min; v <= max + paso / 2; v += paso) {
    el('line', { x1: m.l, x2: m.l + w, y1: y(v), y2: y(v), stroke: COL.grid, 'stroke-width': 1 }, svg);
    text(svg, m.l - 8, y(v) + 4, etiquetasY[k++] ?? etiquetaY(v), { anchor: 'end' });
  }

  // eje X: una etiqueta cada N años, alineada con el inicio de cada año
  const nEtiquetas = Math.max(3, Math.min(11, Math.floor(w / 64)));
  const anioPaso = Math.max(1, Math.ceil(Math.ceil(n / 12) / nEtiquetas));
  for (let i = 0; i < n; i++) {
    const abs = desde + i;
    if (abs % 12 !== 0) continue;
    const anio = 2014 + Math.floor(abs / 12);
    if ((anio - 2014) % anioPaso !== 0) continue;
    text(svg, x(i), m.t + h + 18, `${anio}`, { size: 10.5 });
  }

  // separador entrenamiento / prueba
  if (proy?.length && !superpuesto) {
    const xs = x(real.length - 0.5);
    el('line', { x1: xs, x2: xs, y1: m.t, y2: m.t + h, stroke: COL.proy, 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }, svg);
  }
  marcas.forEach((mk) => {
    const i = mk.i - desde;
    if (i < 0 || i >= n) return;
    el('line', { x1: x(i), x2: x(i), y1: m.t, y2: m.t + h, stroke: mk.color ?? COL.danger, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.7 }, svg);
    if (mk.label) text(svg, x(i), m.t - 4, mk.label, { size: 9.5, fill: mk.color ?? COL.danger });
  });

  // banda de incertidumbre
  if (banda?.length) {
    const pts = [];
    banda.forEach((v, k) => { if (v != null) pts.push([x(real.length + k), y(v)]); });
    for (let k = banda.length - 1; k >= 0; k--) {
      if (banda[k] != null) pts.push([x(real.length + k), y(Math.max(min, 2 * (proy?.[k] ?? 0) - banda[k]))]);
    }
    if (pts.length > 2) {
      el('path', {
        d: `M${pts.map((p) => p.join(',')).join('L')}Z`,
        fill: COL.banda, stroke: 'none',
      }, svg);
    }
  }

  // área + línea real
  const realPts = [];
  real.forEach((v, i) => { if (v != null) realPts.push([x(i), y(v)]); });
  if (realPts.length > 1) {
    const area = `M${realPts.map((p) => p.join(',')).join('L')}L${realPts.at(-1)[0]},${y(Math.max(min, 0))}L${realPts[0][0]},${y(Math.max(min, 0))}Z`;
    const gid = `grad-${++uid}`;
    const defs = el('defs', {}, svg);
    const lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': COL.real, 'stop-opacity': 0.22 }, lg);
    el('stop', { offset: '100%', 'stop-color': COL.real, 'stop-opacity': 0.01 }, lg);
    el('path', { d: area, fill: `url(#${gid})` }, svg);
    el('path', { d: `M${realPts.map((p) => p.join(',')).join('L')}`, fill: 'none', stroke: COL.real, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
  }

  // línea de pronóstico (continúa la serie o se superpone a ella)
  if (proy?.length) {
    const pts = [];
    if (!superpuesto && real.length) {
      const lastReal = [...real].reverse().find((v) => v != null);
      const lastIdx = real.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).at(-1);
      if (lastReal != null) pts.push([x(lastIdx), y(lastReal)]);
    }
    proy.forEach((v, k) => {
      if (v == null) return;
      const idx = superpuesto ? k : real.length + k;
      pts.push([x(idx), y(v)]);
    });
    el('path', {
      d: `M${pts.map((p) => p.join(',')).join('L')}`,
      fill: 'none', stroke: COL.proy, 'stroke-width': 2.2, 'stroke-dasharray': '6 4', 'stroke-linejoin': 'round',
    }, svg);
    if (!superpuesto && pts.length) {
      const last = pts.at(-1);
      el('circle', { cx: last[0], cy: last[1], r: 3.6, fill: COL.proy }, svg);
    }
  }

  // línea de tendencia (regresión) sobre la parte observada
  if (tendencia && tendencia.length) {
    const pts = [];
    tendencia.forEach((p) => {
      if (p.v != null && p.i >= desde && p.i - desde < n) pts.push([x(p.i - desde), y(p.v)]);
    });
    if (pts.length > 1) {
      el('path', {
        d: `M${pts.map((p) => p.join(',')).join('L')}`,
        fill: 'none', stroke: COL.tend, 'stroke-width': 1.8, 'stroke-dasharray': '7 5', opacity: 0.85,
      }, svg);
    }
  }

  // tooltip interactivo
  const focus = el('line', { y1: m.t, y2: m.t + h, stroke: '#94a3b8', 'stroke-width': 1, opacity: 0 }, svg);
  const dot = el('circle', { r: 4, fill: COL.real, stroke: '#fff', 'stroke-width': 1.5, opacity: 0 }, svg);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  host.appendChild(tip);
  svg.addEventListener('mousemove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * ancho;
    let i = Math.round(((px - m.l) / w) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const abs = desde + i;
    const esProy = !superpuesto && i >= real.length;
    const v = esProy ? proy[i - real.length] : real[i];
    const vProy = superpuesto && proy?.[i] != null ? proy[i] : null;
    focus.setAttribute('x1', x(i));
    focus.setAttribute('x2', x(i));
    focus.setAttribute('opacity', 0.55);
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(v ?? min));
    dot.setAttribute('fill', esProy ? COL.proy : COL.real);
    dot.setAttribute('opacity', v == null ? 0 : 1);
    tip.innerHTML = `<strong>${etiquetaCorta(abs)}</strong><br>${v == null ? 'Sin dato' : money(v)}${esProy ? '<br><em>Pronóstico</em>' : ''}${vProy != null ? `<br><em>Estimado:</em> ${money(vProy)}` : ''}`;
    tip.style.opacity = 1;
    const relX = (x(i) / ancho) * 100;
    tip.style.left = `${Math.min(78, Math.max(2, relX))}%`;
  });
  svg.addEventListener('mouseleave', () => {
    tip.style.opacity = 0;
    focus.setAttribute('opacity', 0);
    dot.setAttribute('opacity', 0);
  });
}

/* ─────────────────────────── barras horizontales ─────────────────────────── */

export function barrasHorizontales(host, { filas, formato = moneyShort, max = 14, onClick = null }) {
  host.innerHTML = '';
  const datos = filas.slice(0, max);
  if (!datos.length) { host.innerHTML = '<p class="vacio">Sin datos para el período.</p>'; return; }
  const top = Math.max(...datos.map((d) => d.valor));
  const cont = document.createElement('div');
  cont.className = 'hbars';
  datos.forEach((d, k) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hbar';
    row.innerHTML = `
      <span class="hbar-rank">${k + 1}</span>
      <span class="hbar-name" title="${d.etiqueta}">${d.etiqueta}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${top > 0 ? (d.valor / top) * 100 : 0}%"></span></span>
      <span class="hbar-val">${formato(d.valor)}</span>`;
    if (onClick) row.addEventListener('click', () => onClick(d));
    else row.disabled = true;
    cont.appendChild(row);
  });
  host.appendChild(cont);
}

/* ─────────────────────────────── barras ──────────────────────────────────── */

export function barras(host, { valores, etiquetas, alto = 220, formato = moneyShort, color = null }) {
  refrescarTema();
  const cBarras = color ?? COL.real;
  host.innerHTML = '';
  const ancho = Math.max(320, host.clientWidth || 640);
  const { min, max, paso } = niceScale(Math.min(0, ...valores), Math.max(...valores), 4);
  const etiquetasY = [];
  for (let v = min; v <= max + paso / 2; v += paso) etiquetasY.push(formato(v));
  const m = { t: 16, r: 8, b: 30, l: margenIzq(etiquetasY, 10) };
  const w = ancho - m.l - m.r;
  const h = alto - m.t - m.b;
  const svg = el('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: '100%', height: alto }, host);
  let ci = 0;
  for (let v = min; v <= max + paso / 2; v += paso) {
    const yy = m.t + h - ((v - min) / (max - min || 1)) * h;
    el('line', { x1: m.l, x2: m.l + w, y1: yy, y2: yy, stroke: COL.grid }, svg);
    text(svg, m.l - 6, yy + 4, etiquetasY[ci++] ?? formato(v), { anchor: 'end', size: 10 });
  }
  const bw = w / valores.length;
  const y0 = m.t + h - ((0 - min) / (max - min || 1)) * h;
  valores.forEach((v, i) => {
    const yy = m.t + h - ((v - min) / (max - min || 1)) * h;
    const bar = el('rect', {
      x: m.l + i * bw + bw * 0.16, y: Math.min(yy, y0),
      width: bw * 0.68, height: Math.max(1, Math.abs(y0 - yy)),
      fill: v < 0 ? COL.danger : cBarras, rx: 3,
    }, svg);
    bar.setAttribute('opacity', 0.9);
    const t = el('title', {}, bar);
    t.textContent = `${etiquetas[i]}: ${money(v)}`;
    if (valores.length <= 16) text(svg, m.l + i * bw + bw / 2, m.t + h + 16, etiquetas[i], { size: 10 });
  });
}

/* ─────────────────────────── barras por mes (12) ─────────────────────────── */

export function barrasMensuales(host, { valores, alto = 200, formato = moneyShort }) {
  refrescarTema();
  host.innerHTML = '';
  const ancho = Math.max(300, host.clientWidth || 520);
  const { min, max, paso } = niceScale(Math.min(0, ...valores), Math.max(...valores), 4);
  const etiquetasY = [];
  for (let v = min; v <= max + paso / 2; v += paso) etiquetasY.push(formato(v));
  const m = { t: 14, r: 8, b: 26, l: margenIzq(etiquetasY, 10) };
  const w = ancho - m.l - m.r;
  const h = alto - m.t - m.b;
  const svg = el('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: '100%', height: alto }, host);
  let ci = 0;
  for (let v = min; v <= max + paso / 2; v += paso) {
    const yy = m.t + h - ((v - min) / (max - min || 1)) * h;
    el('line', { x1: m.l, x2: m.l + w, y1: yy, y2: yy, stroke: COL.grid }, svg);
    text(svg, m.l - 6, yy + 4, etiquetasY[ci++] ?? formato(v), { anchor: 'end', size: 10 });
  }
  const bw = w / 12;
  valores.forEach((v, i) => {
    const yy = m.t + h - ((v - min) / (max - min || 1)) * h;
    const y0 = m.t + h - ((0 - min) / (max - min || 1)) * h;
    const r = el('rect', {
      x: m.l + i * bw + bw * 0.18, y: Math.min(yy, y0), width: bw * 0.64,
      height: Math.max(1, Math.abs(y0 - yy)), fill: COL.accent, rx: 3, opacity: 0.85,
    }, svg);
    const t = el('title', {}, r);
    t.textContent = `${mesCorto(i)}: ${money(v)}`;
    text(svg, m.l + i * bw + bw / 2, m.t + h + 16, mesCorto(i), { size: 9.5 });
  });
}

/* ───────────────────────── pastel / dona de categorías ───────────────────── */

const PALETA = ['#1f5f8b', '#2f8f9d', '#7fa650', '#e0a91b', '#c9752c', '#a4563e', '#7d5ba6', '#4a7c8c'];

export function dona(host, { partes, alto = 210, formato = (v) => pct(v, 1) }) {
  refrescarTema();
  host.innerHTML = '';
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (!total) { host.innerHTML = '<p class="vacio">Sin información de categorías.</p>'; return; }
  const size = Math.min(alto, 210);
  const ancho = Math.max(300, host.clientWidth || 460);
  const svg = el('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: '100%', height: alto }, host);
  const cx = size / 2 + 8;
  const cy = alto / 2;
  const R = size * 0.38;
  const r = R * 0.6;
  let ang = -Math.PI / 2;
  partes.forEach((p, k) => {
    const frac = p.valor / total;
    const a2 = ang + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const p1 = [cx + R * Math.cos(ang), cy + R * Math.sin(ang)];
    const p2 = [cx + R * Math.cos(a2), cy + R * Math.sin(a2)];
    const q1 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
    const q2 = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    const d = `M${p1} A${R},${R} 0 ${large} 1 ${p2} L${q1} A${r},${r} 0 ${large} 0 ${q2}Z`;
    const path = el('path', { d, fill: PALETA[k % PALETA.length], stroke: '#fff', 'stroke-width': 1.5 }, svg);
    const t = el('title', {}, path);
    t.textContent = `${p.etiqueta}: ${formato(frac)}`;
    ang = a2;
  });
  text(svg, cx, cy - 2, numShort(total), { size: 13, weight: 600, fill: COL.text });
  text(svg, cx, cy + 15, 'vehículos', { size: 10 });

  const lx = size + 26;
  let ly = 26;
  partes.slice(0, 8).forEach((p, k) => {
    el('rect', { x: lx, y: ly - 8, width: 10, height: 10, rx: 2, fill: PALETA[k % PALETA.length] }, svg);
    text(svg, lx + 16, ly + 1, p.etiqueta, { anchor: 'start', size: 10.5, fill: COL.text });
    text(svg, ancho - 6, ly + 1, formato(p.valor / total), { anchor: 'end', size: 10.5, fill: COL.axis });
    ly += 20;
  });
}

export { COL };
