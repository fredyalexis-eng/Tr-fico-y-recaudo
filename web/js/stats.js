/* Estadística descriptiva y analítica por estación de peaje */

import { mean, median, stdev, quantile, perfilSerie } from './forecast.js';

/**
 * Resumen estadístico de la serie mensual de recaudo de un peaje.
 * @param serie      arreglo mensual de recaudo (null = sin dato)
 * @param mesesISO   etiquetas ISO de los meses
 * @param hastaIdx   último índice a considerar
 */
export function resumenEstadistico(serie, mesesISO, hastaIdx = serie.length - 1) {
  const tramo = serie.slice(0, hastaIdx + 1);
  const perfil = perfilSerie(tramo);
  const valores = [];
  const idx = [];
  tramo.forEach((v, i) => { if (v != null) { valores.push(v); idx.push(i); } });

  if (!valores.length) {
    return { vacio: true, perfil };
  }

  const conValor = valores.filter((v) => v > 0);
  const n = valores.length;
  const suma = valores.reduce((s, v) => s + v, 0);
  const promedio = suma / n;
  const orden = [...valores].sort((a, b) => a - b);
  const mediana = median(valores);
  const desv = stdev(valores);
  const cv = promedio > 0 ? desv / promedio : null;
  const min = orden[0];
  const max = orden[orden.length - 1];
  const q1 = quantile(valores, 0.25);
  const q3 = quantile(valores, 0.75);
  const iqr = q3 - q1;
  const atipicos = valores.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;

  // crecimiento anual compuesto entre el primer y el último mes con dato
  const iFirst = idx[0];
  const iLast = idx[idx.length - 1];
  const anios = (iLast - iFirst) / 12;
  let cagr = null;
  const primero = tramo[iFirst];
  const ultimo = tramo[iLast];
  if (anios >= 0.9 && primero > 0 && ultimo > 0) cagr = (ultimo / primero) ** (1 / anios) - 1;

  // crecimiento interanual de los últimos 12 meses vs los 12 anteriores
  let yoy = null;
  if (iLast >= 23) {
    const cur = sumar(tramo, iLast - 11, iLast);
    const prev = sumar(tramo, iLast - 23, iLast - 12);
    if (cur != null && prev > 0) yoy = cur / prev - 1;
  }

  // promedios móviles de 12 meses
  const mm12 = [];
  for (let i = 11; i <= hastaIdx; i++) {
    const v = sumar(tramo, i - 11, i);
    if (v != null) mm12.push({ i, v });
  }

  // récord
  let iMax = -1;
  let iMin = -1;
  tramo.forEach((v, i) => {
    if (v == null) return;
    if (iMax < 0 || v > tramo[iMax]) iMax = i;
    if (iMin < 0 || (v > 0 && (tramo[iMin] === 0 || v < tramo[iMin]))) iMin = i;
  });

  // tendencia (pendiente de regresión sobre los últimos 36 meses con dato)
  const tendencia = pendiente(tramo, 36);

  // meses sin reporte y ceros (estaciones sombra / suspensión)
  const ceros = valores.filter((v) => v === 0).length;

  return {
    vacio: false,
    perfil,
    n,
    desde: iFirst,
    hasta: iLast,
    mesesISO,
    suma,
    promedio,
    mediana,
    desv,
    cv,
    min,
    max,
    q1,
    q3,
    iqr,
    atipicos,
    cagr,
    yoy,
    iMax,
    iMin,
    tendencia,
    ceros,
    mm12,
    valores,
    idx,
  };
}

function sumar(tramo, desde, hasta) {
  let s = 0;
  let cnt = 0;
  for (let i = Math.max(0, desde); i <= hasta && i < tramo.length; i++) {
    const v = tramo[i];
    if (v == null) continue;
    s += v;
    cnt++;
  }
  return cnt === (hasta - desde + 1) ? s : null;
}

/** Pendiente mensual (regresión simple) usando los últimos `ventana` meses con dato. */
export function pendiente(tramo, ventana = 36) {
  const pares = [];
  for (let i = 0; i < tramo.length; i++) if (tramo[i] != null) pares.push([i, tramo[i]]);
  if (pares.length < 6) return null;
  const usados = pares.slice(-ventana);
  const n = usados.length;
  const mt = mean(usados.map(([t]) => t));
  const my = mean(usados.map(([, v]) => v));
  let num = 0;
  let den = 0;
  for (const [t, v] of usados) {
    num += (t - mt) * (v - my);
    den += (t - mt) ** 2;
  }
  if (!den) return null;
  const b = num / den;
  return { b, mensual: b, anual: b * 12, n, desde: usados[0][0], hasta: usados[usados.length - 1][0] };
}

/** Serie anual (suma por año calendario), omitiendo años incompletos al final. */
export function serieAnual(serie, hastaIdx = serie.length - 1) {
  const anios = new Map();
  for (let i = 0; i <= hastaIdx && i < serie.length; i++) {
    const v = serie[i];
    const a = 2014 + Math.floor(i / 12);
    if (!anios.has(a)) anios.set(a, { anio: a, suma: 0, meses: 0, valores: [] });
    const o = anios.get(a);
    if (v != null) {
      o.suma += v;
      o.meses += 1;
      o.valores.push(v);
    }
  }
  return [...anios.values()].map((o) => ({ ...o, completo: o.meses === 12 }));
}

/** Estacionalidad: índice de cada mes frente al promedio anual (base 100). */
export function estacionalidad(serie, hastaIdx = serie.length - 1) {
  const porMes = Array.from({ length: 12 }, () => []);
  for (let i = 0; i <= hastaIdx && i < serie.length; i++) {
    const v = serie[i];
    if (v == null || v <= 0) continue;
    porMes[i % 12].push(v);
  }
  // normaliza contra la media móvil de 12 meses para aislar la estacionalidad
  const ratios = Array.from({ length: 12 }, () => []);
  for (let i = 6; i + 5 <= hastaIdx && i + 5 < serie.length; i++) {
    let s = 0;
    let ok = true;
    for (let j = i - 6; j <= i + 5; j++) {
      if (serie[j] == null) { ok = false; break; }
      s += serie[j];
    }
    if (!ok || s <= 0) continue;
    ratios[i % 12].push(serie[i] / (s / 12));
  }
  const base = ratios.map((r) => (r.length ? median(r) : NaN));
  const mu = mean(base.filter((v) => Number.isFinite(v)));
  return base.map((v, k) => ({
    mes: k,
    factor: Number.isFinite(v) && mu > 0 ? v / mu : 1,
    n: porMes[k].length,
  }));
}

/** Contribución de cada mes del calendario al recaudo anual (últimos 12 meses). */
export function concentracionMensual(serie, hastaIdx) {
  const vals = [];
  for (let i = Math.max(0, hastaIdx - 11); i <= hastaIdx; i++) if (serie[i] != null) vals.push({ i, v: serie[i] });
  const tot = vals.reduce((s, o) => s + o.v, 0);
  return vals.map((o) => ({ ...o, share: tot > 0 ? o.v / tot : null }));
}

/** Agrupa peajes por departamento / proyecto con totales del período. */
export function agregar(peajes, desde, hasta, campo = 'recaudo') {
  const map = new Map();
  for (const p of peajes) {
    let s = 0;
    let n = 0;
    for (let i = desde; i <= hasta; i++) {
      const v = p[campo][i];
      if (v != null) { s += v; n++; }
    }
    if (!map.has(p.departamento)) map.set(p.departamento, { nombre: p.departamento, total: 0, meses: 0, peajes: 0 });
    const o = map.get(p.departamento);
    o.total += s;
    o.meses += n;
    o.peajes += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Índice de concentración de mercado (HHI, base 10 000) sobre los totales del período. */
export function hhi(totales) {
  const suma = totales.reduce((s, v) => s + v, 0);
  if (!suma) return null;
  return totales.reduce((s, v) => s + (v / suma) ** 2, 0) * 10000;
}
