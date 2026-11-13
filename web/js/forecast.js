/*
 * Motor de pronóstico de recaudo — TollCast
 * =========================================
 * Funciones puras (sin DOM) para que el mismo código que corre en el navegador
 * pueda validarse desde Node (tools/validate_models.mjs).
 *
 * Modelo seleccionado tras validación (ver docs/MODELO.md):
 *   Regresión log-lineal robusta con tendencia + estacionalidad mensual,
 *   entrenada con los primeros 10 años (ene-2014 … dic-2023) y contrastada
 *   contra los últimos años (2024 … ago-2026).
 */

export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* ─────────────────────────── utilidades numéricas ─────────────────────────── */

export function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}

export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Desviación estándar muestral. */
export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Mínimos cuadrados (vía ecuaciones normales con eliminación gaussiana). */
function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) continue;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Regresión log-lineal robusta (IRLS con pesos de Huber).
 * modelo:  log(y) = a + b·t + Σ_k c_k·1[mes = k]
 * t = índice temporal centrado (efecto tendencia; b·12 ≈ crecimiento anual).
 */
export function fitLogLineal(idx, valores, { iters = 25, c = 1.345 } = {}) {
  const n = idx.length;
  if (n < 6) return null;
  const t = idx.map(Number);
  const tMean = mean(t);
  const y = valores.map((v) => Math.log(v));
  const cols = 2 + 11; // intercepto, t, 11 dummies de mes (base = enero)
  const design = (ti, mi) => {
    const row = new Array(cols).fill(0);
    row[0] = 1;
    row[1] = ti - tMean;
    if (mi > 0) row[1 + mi] = 1;
    return row;
  };
  const X = idx.map((i, k) => design(t[k], i % 12));

  let beta = new Array(cols).fill(0);
  const fitWLS = (w) => {
    const A = Array.from({ length: cols }, () => new Array(cols).fill(0));
    const rhs = new Array(cols).fill(0);
    for (let r = 0; r < n; r++) {
      const wr = w[r];
      for (let a = 0; a < cols; a++) {
        const xa = X[r][a];
        if (xa === 0) continue;
        rhs[a] += wr * xa * y[r];
        for (let b2 = 0; b2 < cols; b2++) A[a][b2] += wr * xa * X[r][b2];
      }
    }
    // pequeña regularización para estabilidad numérica
    for (let a = 0; a < cols; a++) A[a][a] += 1e-8;
    return solve(A, rhs);
  };

  let w = new Array(n).fill(1);
  beta = fitWLS(w);
  for (let it = 0; it < iters; it++) {
    const res = X.map((row, r) => y[r] - row.reduce((s, v, k) => s + v * beta[k], 0));
    const resMed = median(res);
    const s = 1.4826 * median(res.map((v) => Math.abs(v - resMed))) + 1e-12;
    let changed = 0;
    w = res.map((r) => {
      const u = Math.abs(r) / s;
      return u <= c ? 1 : c / u;
    });
    const prev = beta;
    beta = fitWLS(w);
    changed = beta.reduce((s, v, k) => s + Math.abs(v - prev[k]), 0);
    if (changed < 1e-10) break;
  }
  return { beta, tMean, design };
}

/* ─────────────────────── parámetros del modelo (validados) ────────────────── */

export const CONFIG = {
  aniosEntrenamiento: 10, // primeros 10 años → entrenamiento
  horizonteMax: 36,
  minMesesPropio: 18, // meses con dato positivo para modelo propio
  minMesesSenal: 6,
  mesesInactividad: 3, // sin datos al final ⇒ estación cerrada
  covid: ['2020-03', '2021-06'], // exclusión en el cálculo del crecimiento nacional
  ventanaCrecimiento: 48,
};

/** Etiqueta de mes "AAAA-MM" → índice 0-based desde ene-2014. */
export function isoToIdx(iso) {
  const [a, m] = iso.split('-').map(Number);
  return (a - 2014) * 12 + (m - 1);
}

/* ───────────────────────── crecimiento nacional ───────────────────────────── */

/**
 * Crecimiento anual del recaudo del sistema, estimado con regresión log-lineal
 * robusta sobre la ventana reciente (excluye el choque COVID).
 */
export function crecimientoNacional(totales, endIdx, { ventana = CONFIG.ventanaCrecimiento } = {}) {
  const idx = [];
  for (let i = Math.max(0, endIdx - ventana + 1); i <= endIdx; i++) {
    const iso = `${2014 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    if (totales[i] > 0 && !(iso >= CONFIG.covid[0] && iso <= CONFIG.covid[1])) idx.push(i);
  }
  if (idx.length < 18) return 0.05;
  const fit = fitLogLineal(idx, idx.map((i) => totales[i]));
  if (!fit) return 0.05;
  const g = Math.expm1(fit.beta[1] * 12);
  return Math.min(0.2, Math.max(-0.05, g));
}

/* ─────────────────────────── estado de una serie ─────────────────────────── */

/** Resume observaciones, cierres, sombras y datos faltantes de un peaje. */
export function perfilSerie(serie) {
  const n = serie.length;
  const obs = [];
  for (let i = 0; i < n; i++) if (serie[i] != null) obs.push(i);
  const conValor = obs.filter((i) => serie[i] > 0);
  const ultimo = obs.length ? obs[obs.length - 1] : null;
  const primero = obs.length ? obs[0] : null;
  const cerrada = ultimo == null || n - 1 - ultimo > CONFIG.mesesInactividad;
  const sombra = obs.length > 0 && serie.slice(0, (ultimo ?? 0) + 1).every((v) => !v);
  // huecos internos = meses sin reporte entre el primero y el último
  let huecos = 0;
  if (primero != null && ultimo != null) {
    for (let i = primero; i <= ultimo; i++) if (serie[i] == null) huecos++;
  }
  return {
    primero,
    ultimo,
    nObservados: obs.length,
    nMesesConValor: conValor.length,
    cerrada,
    sombra,
    huecos,
    inactividadFinal: ultimo == null ? n : n - 1 - ultimo,
  };
}

/* ───────────────────────────── modelos candidatos ────────────────────────── */

/** Factores estacionales clásicos (media móvil centrada de 12 meses). */
function factoresEstacionales(idx, valores) {
  const f = new Array(12).fill(NaN);
  const s = new Map(idx.map((i, k) => [i, valores[k]]));
  const ratios = new Array(12).fill(null).map(() => []);
  for (const i of idx) {
    if (i - 6 < idx[0] || i + 5 > idx[idx.length - 1]) continue;
    let suma = 0;
    let cnt = 0;
    for (let j = i - 6; j <= i + 5; j++) {
      const v = s.get(j);
      if (v == null) { cnt = -1; break; }
      suma += v; cnt++;
    }
    if (cnt === 12 && suma > 0) ratios[i % 12].push(s.get(i) / (suma / 12));
  }
  for (let k = 0; k < 12; k++) f[k] = ratios[k].length ? median(ratios[k]) : 1;
  const mu = mean(f.filter((v) => Number.isFinite(v)));
  return f.map((v) => (Number.isFinite(v) && mu > 0 ? v / mu : 1));
}

function _modeloLogLineal(ctx) {
  const { idx, valores, horizonte } = ctx;
  const fit = fitLogLineal(idx, valores);
  if (!fit) return null;
  const ultimo = idx[idx.length - 1];
  const out = [];
  for (let h = 1; h <= horizonte; h++) {
    const i = ultimo + h;
    const row = fit.design(i, i % 12);
    const lp = row.reduce((s, v, k) => s + v * fit.beta[k], 0);
    out.push(Math.exp(lp));
  }
  return out;
}

function _modeloEstacionalCrecimiento(ctx) {
  const { idx, valores, horizonte, gNacional, pesoPropio } = ctx;
  const f = factoresEstacionales(idx, valores);
  const ultimo = idx[idx.length - 1];
  // nivel desestacionalizado de los últimos 12 meses
  const ult12 = idx.slice(-12);
  const lvl = mean(ult12.map((i) => valores[idx.indexOf(i)] / f[i % 12]));
  let gs = null;
  if (idx.length >= 24) {
    const last = idx.length - 1;
    const cur = idx.slice(last - 11).reduce((s, i) => s + valores[idx.indexOf(i)], 0);
    const prev = idx.slice(last - 23, last - 11).reduce((s, i) => s + valores[idx.indexOf(i)], 0);
    if (prev > 0) gs = cur / prev - 1;
  }
  const g = Math.min(0.25, Math.max(-0.05, gs != null ? pesoPropio * gs + (1 - pesoPropio) * gNacional : gNacional));
  const out = [];
  for (let h = 1; h <= horizonte; h++) {
    const i = ultimo + h;
    out.push(lvl * f[i % 12] * (1 + g) ** (h / 12));
  }
  return out;
}

function _modeloIngenuoEstacional(ctx) {
  const { idx, valores, horizonte, gNacional } = ctx;
  const ultimo = idx[idx.length - 1];
  if (ultimo < 11) return null;
  const g = Math.min(0.15, Math.max(-0.05, gNacional));
  const mapa = new Map(idx.map((i, k) => [i, valores[k]]));
  const base = [];
  for (let i = ultimo - 11; i <= ultimo; i++) {
    const v = mapa.get(i);
    if (v == null) return null;
    base.push(v);
  }
  const out = [];
  for (let h = 1; h <= horizonte; h++) out.push(base[(h - 1) % 12] * (1 + g) ** (h / 12));
  return out;
}

function _modeloMediaMovilAnual(ctx) {
  const { idx, valores, horizonte, gNacional } = ctx;
  const ultimo = idx[idx.length - 1];
  if (idx.length < 24) return null;
  const last = idx.length - 1;
  const cur = mean(valores.slice(last - 11));
  const prev = mean(valores.slice(last - 23, last - 11));
  const g = Math.min(0.15, Math.max(-0.05, prev > 0 ? (cur / prev) ** (1 / 1) - 1 : gNacional));
  const out = [];
  for (let h = 1; h <= horizonte; h++) out.push(cur * (1 + g) ** (h / 12));
  return out;
}

function _modeloHoltWinters(ctx) {
  const { idx, valores, horizonte } = ctx;
  if (valores.length < 36) return null;
  const alpha = 0.4, beta = 0.03, gamma = 0.3, phi = 0.95;
  const L = 12;
  let lvl = mean(valores.slice(0, L));
  let tr = (mean(valores.slice(L, 2 * L)) - lvl) / L;
  const seas = valores.slice(0, L).map((v) => v / lvl);
  for (let i = L; i < valores.length; i++) {
    const s = seas[i % L];
    const ln = alpha * (valores[i] / s) + (1 - alpha) * (lvl + phi * tr);
    tr = beta * (ln - lvl) + (1 - beta) * phi * tr;
    seas[i % L] = gamma * (valores[i] / ln) + (1 - gamma) * s;
    lvl = ln;
  }
  const out = [];
  let cum = 0;
  for (let h = 1; h <= horizonte; h++) {
    cum += phi ** h;
    out.push(Math.max(lvl + cum * tr, 0) * seas[(valores.length + h - 1) % L]);
  }
  void idx;
  return out;
}

export const MODELOS = {
  loglineal: { nombre: 'Regresión log-lineal robusta', fn: _modeloLogLineal, requiere: 18 },
  estacional: { nombre: 'Estacional + crecimiento', fn: _modeloEstacionalCrecimiento, requiere: 18 },
  ingenuo: { nombre: 'Ingenuo estacional', fn: _modeloIngenuoEstacional, requiere: 12 },
  movil: { nombre: 'Media móvil anual', fn: _modeloMediaMovilAnual, requiere: 24 },
  holtwinters: { nombre: 'Holt-Winters amortiguado', fn: _modeloHoltWinters, requiere: 36 },
};

export const MODELO_POR_DEFECTO = 'loglineal';

/* ───────────────────────────── pronóstico ────────────────────────────────── */

/**
 * Pronóstico mensual de recaudo de un peaje.
 * @param serie   arreglo completo de recaudo mensual (null = sin dato)
 * @param corte   índice del último mes de entrenamiento
 * @param horizonte nº de meses a proyectar
 */
export function pronosticar(serie, corte, horizonte, {
  modelo = MODELO_POR_DEFECTO,
  gNacional = 0.05,
  pesoPropio = 0.2,
} = {}) {
  horizonte = Math.min(CONFIG.horizonteMax, Math.max(1, horizonte | 0));
  const base = { modelo, horizonte, gNacional, estado: 'ok', pronostico: new Array(horizonte).fill(null) };
  const tramo = serie.slice(0, corte + 1);
  const perfil = perfilSerie(tramo);

  if (perfil.nObservados === 0) return { ...base, estado: 'sin-datos' };
  if (perfil.cerrada) return { ...base, estado: 'cerrado' };
  if (perfil.sombra || perfil.nMesesConValor === 0) return { ...base, estado: 'sombra' };
  if (perfil.nMesesConValor < CONFIG.minMesesPropio) {
    const idx = [];
    const val = [];
    tramo.forEach((v, i) => { if (v != null && v > 0) { idx.push(i); val.push(v); } });
    const modeloSenal = MODELOS.estacional;
    const pr = modeloSenal.fn({ idx, valores: val, horizonte, gNacional, pesoPropio });
    return { ...base, estado: 'senal-corta', pronostico: pr, mesesDatos: perfil.nMesesConValor };
  }

  const idx = [];
  const val = [];
  tramo.forEach((v, i) => { if (v != null && v > 0) { idx.push(i); val.push(v); } });
  let pr = MODELOS[modelo]?.fn({ idx, valores: val, horizonte, gNacional, pesoPropio });
  let usado = modelo;
  if (!pr || !pr.every((v) => Number.isFinite(v) && v >= 0)) {
    usado = 'estacional';
    pr = MODELOS.estacional.fn({ idx, valores: val, horizonte, gNacional, pesoPropio });
  }
  if (!pr) return { ...base, estado: 'insuficiente', pronostico: null };
  return { ...base, modelo: usado, pronostico: pr, estado: 'ok', mesesDatos: perfil.nMesesConValor };
}

/** Pronóstico de todos los peajes + total del sistema. */
export function pronosticarSistema(peajes, totales, corte, horizonte, opciones = {}) {
  const gNacional = opciones.gNacional ?? crecimientoNacional(totales, corte);
  const detalle = peajes.map((p) => {
    const r = pronosticar(p.recaudo, corte, horizonte, { ...opciones, gNacional });
    return { id: p.id, nombre: p.nombre, ...r };
  });
  const total = new Array(horizonte).fill(0);
  for (const d of detalle) {
    if (!d.pronostico) continue;
    d.pronostico.forEach((v, i) => { if (v != null) total[i] += v; });
  }
  return { gNacional, detalle, total };
}

/**
 * Ajuste log-lineal con estacionalidad: devuelve una serie suavizada (tendencia
 * + estacionalidad) útil para visualizar la dirección de la serie.
 */
export function tendenciaAjustada(serie, corte) {
  const idx = [];
  const val = [];
  for (let i = 0; i <= corte && i < serie.length; i++) {
    if (serie[i] != null && serie[i] > 0) { idx.push(i); val.push(serie[i]); }
  }
  if (idx.length < 12) return null;
  const fit = fitLogLineal(idx, val);
  if (!fit) return null;
  const out = new Array(serie.length).fill(null);
  for (let i = 0; i < serie.length; i++) {
    const row = fit.design(i, i % 12);
    out[i] = Math.exp(row.reduce((s, v, k) => s + v * fit.beta[k], 0));
  }
  return out.map((v, i) => ({ i, v }));
}

/* ─────────────────────────── métricas de error ───────────────────────────── */

export function metricas(real, pred) {
  const pares = [];
  for (let i = 0; i < Math.min(real.length, pred.length); i++) {
    if (real[i] != null && pred[i] != null && Number.isFinite(pred[i])) pares.push([real[i], pred[i]]);
  }
  if (!pares.length) return null;
  const n = pares.length;
  const err = pares.map(([a, p]) => p - a);
  const abs = err.map(Math.abs);
  const mae = mean(abs);
  const rmse = Math.sqrt(mean(err.map((e) => e * e)));
  const conBase = pares.filter(([a]) => a > 0);
  const mape = conBase.length ? mean(conBase.map(([a, p]) => Math.abs((p - a) / a))) : null;
  const realArr = pares.map(([a]) => a);
  const mReal = mean(realArr);
  const sst = realArr.reduce((s, v) => s + (v - mReal) ** 2, 0);
  const sse = err.reduce((s, e) => s + e * e, 0);
  const r2 = sst > 0 ? 1 - sse / sst : null;
  const sumaReal = realArr.reduce((s, v) => s + v, 0);
  const sumaPred = pares.map(([, p]) => p).reduce((s, v) => s + v, 0);
  return {
    n,
    mae,
    rmse,
    mape,
    r2,
    sesgo: mae ? mean(err) / mean(realArr) : 0,
    sesgoTotal: sumaReal > 0 ? sumaPred / sumaReal - 1 : null,
    sumaReal,
    sumaPred,
    wmape: sumaReal > 0 ? abs.reduce((s, v) => s + v, 0) / sumaReal : null,
  };
}

/** Valida un modelo entrenando con `corte` y comparando contra lo observado. */
export function backtest(peajes, totales, corte, fin, opciones = {}) {
  const horizonte = fin - corte;
  const gNacional = opciones.gNacional ?? crecimientoNacional(totales, corte);
  const filas = [];
  for (const p of peajes) {
    const tramo = p.recaudo.slice(0, corte + 1);
    const perfil = perfilSerie(tramo);
    const real = p.recaudo.slice(corte + 1, fin + 1);
    if (perfil.nObservados === 0) continue;
    if (real.every((v) => v == null)) continue;
    const r = pronosticar(p.recaudo, corte, horizonte, { ...opciones, gNacional });
    const realFill = real.map((v) => (v == null ? null : v));
    const m = metricas(realFill, r.pronostico);
    if (!m) continue;
    filas.push({
      id: p.id,
      nombre: p.nombre,
      estado: r.estado,
      ...m,
      realTotal: realFill.reduce((s, v) => s + (v ?? 0), 0),
      predTotal: r.pronostico ? r.pronostico.reduce((s, v) => s + (v ?? 0), 0) : 0,
    });
  }
  const reales = new Array(horizonte).fill(0);
  const preds = new Array(horizonte).fill(0);
  for (const p of peajes) {
    for (let h = 0; h < horizonte; h++) {
      const rv = p.recaudo[corte + 1 + h];
      if (rv != null) reales[h] += rv;
      const pr = filas.find((f) => f.id === p.id);
      if (pr && pr.predTotal && pr.estado !== 'cerrado' && pr.estado !== 'sombra') {
        // recomputa el vector para el agregado
      }
    }
  }
  // agregado exacto: reutiliza pronosticarSistema
  const sis = pronosticarSistema(peajes, totales, corte, horizonte, { ...opciones, gNacional });
  for (let h = 0; h < horizonte; h++) preds[h] = sis.total[h];
  const mTotal = metricas(reales, preds);
  return { horizonte, gNacional, filas, total: { real: reales, pred: preds, metricas: mTotal } };
}
