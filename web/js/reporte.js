/* Generación del reporte de análisis de un peaje (HTML autocontenido) */

import { money, moneyShort, pct, pctSigned, num, etiquetaLarga, etiquetaCorta, fechaHoy, mesCorto } from './format.js';
import { serieAnual } from './stats.js';

const isDark = () => false;

/** Gráfico SVG de serie real + pronóstico, embebido en el reporte. */
function anchoTexto(str, size = 9.5) { return String(str).length * size * 0.55; }

function svgSerie({ real, proy, desde, ancho = 700, alto = 230, titulo = '' }) {
  const m = { t: 16, r: 12, b: 28, l: 62 };
  const w = ancho - m.l - m.r;
  const h = alto - m.t - m.b;
  const n = real.length + (proy?.length ?? 0);
  const vals = [...real.filter((v) => v != null), ...(proy ?? []).filter((v) => v != null)];
  const max = Math.max(...vals, 1);
  const min = 0;
  const paso = niceStep(max);
  const yMax = Math.ceil(max / paso) * paso;
  let maxEtq = 0;
  for (let v = 0; v <= yMax + 1e-9; v += paso) maxEtq = Math.max(maxEtq, anchoTexto(moneyShort(v)));
  m.l = Math.max(46, Math.ceil(maxEtq + 14));
  const w2 = ancho - m.l - m.r;
  const x = (i) => m.l + (i / (n - 1)) * w2;
  const y = (v) => m.t + h - (v / (yMax || 1)) * h;
  let out = `<svg viewBox="0 0 ${ancho} ${alto}" width="100%" height="${alto}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">`;
  out += `<defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f5f8b" stop-opacity=".2"/><stop offset="1" stop-color="#1f5f8b" stop-opacity=".02"/></linearGradient></defs>`;
  for (let v = min; v <= yMax + 1e-9; v += paso) {
    const px = Math.round(y(v) * 10) / 10;
    out += `<line x1="${m.l}" x2="${m.l + w2}" y1="${px}" y2="${px}" stroke="#e5e9ef"/>`;
    out += `<text x="${m.l - 6}" y="${px + 3.5}" font-size="9.5" fill="#6b7785" text-anchor="end">${esc(moneyShort(v))}</text>`;
  }
  const anios = Math.max(2, Math.min(9, Math.floor(w2 / 74)));
  const anioPaso = Math.max(1, Math.ceil(Math.ceil(n / 12) / anios));
  for (let i = 0; i < n; i++) {
    const abs = desde + i;
    if (abs % 12 !== 0) continue;
    const anio = 2014 + Math.floor(abs / 12);
    if ((anio - 2014) % anioPaso !== 0) continue;
    out += `<text x="${x(i)}" y="${m.t + h + 16}" font-size="9.5" fill="#6b7785" text-anchor="middle">${anio}</text>`;
  }
  const pts = [];
  real.forEach((v, i) => { if (v != null) pts.push([x(i), y(v)]); });
  if (pts.length > 1) {
    out += `<path d="M${pts.map((p) => p.join(',')).join('L')}L${pts.at(-1)[0]},${y(0)}L${pts[0][0]},${y(0)}Z" fill="url(#rg)"/>`;
    out += `<path d="M${pts.map((p) => p.join(',')).join('L')}" fill="none" stroke="#1f5f8b" stroke-width="1.8"/>`;
  }
  if (proy?.length) {
    const pp = [];
    const ultimoIdx = real.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).at(-1);
    if (ultimoIdx != null && real[ultimoIdx] != null) pp.push([x(ultimoIdx), y(real[ultimoIdx])]);
    proy.forEach((v, k) => { if (v != null) pp.push([x(real.length + k), y(v)]); });
    out += `<path d="M${pp.map((p) => p.join(',')).join('L')}" fill="none" stroke="#e08d1b" stroke-width="2" stroke-dasharray="6 4"/>`;
    const xs = x(real.length - 0.5);
    out += `<line x1="${xs}" x2="${xs}" y1="${m.t}" y2="${m.t + h}" stroke="#e08d1b" stroke-width="1" stroke-dasharray="3 3"/>`;
    out += `<text x="${xs + 4}" y="${m.t + 10}" font-size="9" fill="#b4740c">pronóstico ▸</text>`;
  }
  if (titulo) out += `<text x="${m.l}" y="11" font-size="9.5" fill="#6b7785">${esc(titulo)}</text>`;
  return out + '</svg>';
}

function niceStep(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function plural(n, sing, plur) {
  return `${n} ${n === 1 ? sing : plur}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function svgAnual({ anios, ancho = 700, alto = 190 }) {
  const m = { t: 12, r: 10, b: 26, l: 62 };
  const h = alto - m.t - m.b;
  const max = Math.max(...anios.map((a) => a.suma), 1);
  const paso = niceStep(max);
  const yMax = Math.ceil(max / paso) * paso;
  let maxEtq = 0;
  for (let v = 0; v <= yMax + 1e-9; v += paso) maxEtq = Math.max(maxEtq, anchoTexto(moneyShort(v)));
  m.l = Math.max(46, Math.ceil(maxEtq + 14));
  const w = ancho - m.l - m.r;
  let out = `<svg viewBox="0 0 ${ancho} ${alto}" width="100%" height="${alto}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">`;
  for (let v = 0; v <= yMax + 1e-9; v += paso) {
    const yy = Math.round((m.t + h - (v / yMax) * h) * 10) / 10;
    out += `<line x1="${m.l}" x2="${m.l + w}" y1="${yy}" y2="${yy}" stroke="#e5e9ef"/>`;
    out += `<text x="${m.l - 6}" y="${yy + 3.5}" font-size="9.5" fill="#6b7785" text-anchor="end">${esc(moneyShort(v))}</text>`;
  }
  const bw = w / anios.length;
  anios.forEach((a, i) => {
    const hh = (a.suma / yMax) * h;
    out += `<rect x="${m.l + i * bw + bw * 0.2}" y="${m.t + h - hh}" width="${bw * 0.6}" height="${Math.max(1, hh)}" fill="${a.completo ? '#2f8f9d' : '#a9c2d1'}" rx="2"/>`;
    out += `<text x="${m.l + i * bw + bw / 2}" y="${m.t + h + 15}" font-size="9" fill="#6b7785" text-anchor="middle">${a.anio}</text>`;
  });
  return out + '</svg>';
}

function svgEstacional({ factores, ancho = 340, alto = 170 }) {
  const m = { t: 12, r: 8, b: 24, l: 34 };
  const w = ancho - m.l - m.r;
  const h = alto - m.t - m.b;
  const max = Math.max(...factores.map((f) => f.factor), 1.2);
  const paso = 0.2;
  const yMax = Math.ceil(max / paso) * paso;
  let out = `<svg viewBox="0 0 ${ancho} ${alto}" width="100%" height="${alto}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">`;
  [0, 0.5, 1, 1.5, 2].filter((v) => v <= yMax).forEach((v) => {
    const yy = m.t + h - (v / yMax) * h;
    out += `<line x1="${m.l}" x2="${m.l + w}" y1="${yy}" y2="${yy}" stroke="${v === 1 ? '#c3cedb' : '#eef2f7'}"/>`;
    out += `<text x="${m.l - 4}" y="${yy + 3}" font-size="8.5" fill="#6b7785" text-anchor="end">${v.toFixed(1)}</text>`;
  });
  const bw = w / 12;
  factores.forEach((f, i) => {
    const hh = (f.factor / yMax) * h;
    out += `<rect x="${m.l + i * bw + bw * 0.15}" y="${m.t + h - hh}" width="${bw * 0.7}" height="${Math.max(1, hh)}" fill="${f.factor >= 1 ? '#0f766e' : '#8fb8b3'}" rx="1.5"/>`;
    out += `<text x="${m.l + i * bw + bw / 2}" y="${m.t + h + 13}" font-size="8.5" fill="#6b7785" text-anchor="middle">${mesCorto(i)}</text>`;
  });
  return out + '</svg>';
}

/**
 * Construye el documento HTML del reporte de un peaje.
 * @param ctx objeto con todos los cálculos ya realizados por app.js
 */
export function construirReporte(ctx) {
  const {
    peaje, mesCorte, mesFinal, config, stats, anuales, estacional, estimacion,
    comparacion, metricasComp, ranking, totalSistema, gNacional, modeloNombre, datosMeta,
    baseEntrenamiento = false,
  } = ctx;

  const periodo = `${etiquetaLarga(stats.desde)} – ${etiquetaLarga(stats.hasta)}`;
  const esSombra = estimacion.estado === 'sombra';
  const esCerrada = estimacion.estado === 'cerrado';
  const traf = (() => {
    const vals = [];
    for (let i = stats.desde; i <= stats.hasta; i++) {
      const v = peaje.trafico?.[i];
      if (v != null && v > 0) vals.push(v);
    }
    if (!vals.length) return null;
    return {
      suma: vals.reduce((a, b) => a + b, 0),
      promedio: vals.reduce((a, b) => a + b, 0) / vals.length,
      n: vals.length,
      max: Math.max(...vals),
      min: Math.min(...vals),
    };
  })();
  const ult12 = (() => {
    const s = peaje.recaudo.slice(Math.max(0, stats.hasta - 11), stats.hasta + 1).filter((v) => v != null);
    return s.reduce((a, b) => a + b, 0);
  })();
  const proyTotal = estimacion.pronostico?.reduce((a, b) => a + (b ?? 0), 0) ?? 0;
  const estadoTxt = {
    ok: 'Operación normal', 'senal-corta': 'Serie corta (estimación con estacionalidad)',
    cerrado: 'Estación cerrada o sin reporte reciente', sombra: 'Estación de conteo (peaje sombra)',
    'sin-datos': 'Sin datos', insuficiente: 'Datos insuficientes',
  }[estimacion.estado] ?? estimacion.estado;

  const mejorPeor = (() => {
    if (!comparacion) return null;
    const pares = comparacion.pares.filter((p) => p.real > 0 && p.pred != null);
    if (!pares.length) return null;
    return { max: pares.reduce((a, b) => (b.errPct > a.errPct ? b : a)), min: pares.reduce((a, b) => (b.errPct < a.errPct ? b : a)) };
  })();

  const confianza = (() => {
    const m = metricasComp;
    if (!m) return { txt: 'No evaluable', cls: 'warn' };
    const e = m.mape;
    if (e == null) return { txt: 'No evaluable', cls: 'warn' };
    if (e < 0.10) return { txt: 'Alta', cls: 'ok' };
    if (e < 0.20) return { txt: 'Media', cls: 'ok' };
    if (e < 0.35) return { txt: 'Baja', cls: 'warn' };
    return { txt: 'Muy baja', cls: 'danger' };
  })();

  const filasRanking = ranking && !esSombra
    ? `<p>Entre las <strong>${ranking.total} estaciones con recaudo</strong> del sistema, ${esc(peaje.nombre)} ocupa la
       posición <strong>${ranking.posicion}</strong> por recaudo acumulado en el período analizado
       (${pct(ranking.participacion, 2)} del total).</p>`
    : '';

  const html = `
<div class="rep-head">
  <div>
    <h1>Reporte de análisis de recaudo</h1>
    <p style="color:#4b5b6b;font-size:12px">Estación de peaje <strong>${esc(peaje.nombre)}</strong> · ${esc(peaje.municipio)}, ${esc(peaje.departamento)}</p>
  </div>
  <div class="rep-meta">
    Generado: ${esc(fechaHoy())}<br>
    Fuente: ANI · OETR<br>
    Serie: ${esc(datosMeta.primerMes)} – ${esc(datosMeta.ultimoMes)}
  </div>
</div>

<div class="rep-ficha">
  <div><span>Id de la estación</span><strong>${peaje.id}</strong></div>
  <div><span>Proyecto de concesión</span><strong>${esc(peaje.proyecto)}</strong></div>
  <div><span>Municipio (DIVIPOLA)</span><strong>${esc(peaje.municipio)} · ${peaje.divipola}</strong></div>
  <div><span>Primer mes reportado</span><strong>${etiquetaLarga(stats.desde)}</strong></div>
  <div><span>Último mes reportado</span><strong>${etiquetaLarga(stats.hasta)}</strong></div>
  <div><span>Estado de la serie</span><strong><span class="rep-badge ${estimacion.estado === 'ok' ? 'ok' : 'warn'}">${esc(estadoTxt)}</span></strong></div>
</div>

<h2>1. Resumen ejecutivo</h2>
${esSombra ? `<p>La estación <strong>${esc(peaje.nombre)}</strong> es una <strong>estación de conteo (peaje sombra)</strong>:
no aplica cobro de tarifa, por lo que su recaudo es cero por definición. Su interés analítico está en el
<strong>tráfico</strong>: entre ${periodo} registró ${traf ? `<strong>${num(Math.round(traf.suma))} vehículos</strong>` : 'información de aforo'},
${traf ? `con un promedio de <strong>${num(Math.round(traf.promedio))} vehículos por mes</strong> (máximo ${num(Math.round(traf.max))}, mínimo ${num(Math.round(traf.min))}).` : ''}
La estimación monetaria se mantiene en cero y no se calcula un pronóstico de recaudo.</p>`
: `<p>La estación <strong>${esc(peaje.nombre)}</strong> reportó un recaudo acumulado de <strong>${money(stats.suma)}</strong>
entre ${periodo}, con un promedio mensual de <strong>${money(stats.promedio)}</strong> y una mediana de
<strong>${money(stats.mediana)}</strong>. ${stats.cagr != null
    ? `La tasa de crecimiento anual compuesta del período fue <strong>${pct(stats.cagr, 2)}</strong>${stats.cagr < 0 ? ' (tendencia decreciente)' : ''}.`
    : ''}
${stats.yoy != null ? `En los últimos doce meses el recaudo ${stats.yoy >= 0 ? 'creció' : 'cayó'} <strong>${pct(Math.abs(stats.yoy), 2)}</strong> frente a los doce meses anteriores.` : ''}</p>`}
${esSombra || esCerrada ? `<p>${esSombra ? 'Al no existir recaudo, no se aplica un modelo de pronóstico monetario.' : 'La estación no registra reportes recientes: el modelo proyecta recaudo cero hacia adelante.'}
Su serie se excluye de las comparaciones de desempeño entre estaciones.</p>`
: `<p>Con el modelo de <strong>${esc(modeloNombre)}</strong> entrenado hasta <strong>${etiquetaLarga(mesCorte)}</strong>${baseEntrenamiento ? ' (primeros 10 años)' : ' (todos los datos disponibles)'}
y un crecimiento anual de referencia de ${pct(gNacional, 2)}, el recaudo esperado para los próximos
<strong>${estimacion.horizonte} meses</strong> es de <strong>${money(proyTotal)}</strong>, equivalente a
<strong>${money(proyTotal / estimacion.horizonte)}</strong> en promedio mensual.`}
${comparacion && metricasComp?.mape != null ? `Al contrastar el modelo entrenado con los primeros 10 años contra los datos observados de ${etiquetaLarga(config.inicioPrueba)} a
${etiquetaLarga(mesFinal)}, el error absoluto porcentual medio (MAPE) fue de
<strong>${pct(metricasComp.mape, 2)}</strong>, lo que sugiere una confiabilidad
<strong>${confianza.txt.toLowerCase()}</strong> del pronóstico para esta estación.` : ''}</p>

<div class="rep-kpis">
  ${esSombra ? `
  <div><span>Recaudo</span><strong>$ 0 (conteo)</strong></div>
  <div><span>Tráfico acumulado</span><strong>${traf ? num(Math.round(traf.suma)) : '—'}</strong></div>
  <div><span>Tráfico mensual promedio</span><strong>${traf ? num(Math.round(traf.promedio)) : '—'}</strong></div>
  <div><span>Meses con aforo</span><strong>${traf ? num(traf.n) : '—'}</strong></div>` : `
  <div><span>Recaudo acumulado</span><strong>${moneyShort(stats.suma)}</strong></div>
  <div><span>Promedio mensual</span><strong>${moneyShort(stats.promedio)}</strong></div>
  <div><span>Últimos 12 meses</span><strong>${moneyShort(ult12)}</strong></div>
  <div><span>Pronóstico ${estimacion.horizonte} meses</span><strong>${moneyShort(proyTotal)}</strong></div>`}
</div>

<h2>2. Perfil de la estación</h2>
<ul>
  <li><strong>Departamento / municipio:</strong> ${esc(peaje.departamento)} · ${esc(peaje.municipio)}.</li>
  <li><strong>Proyecto de concesión:</strong> ${esc(peaje.proyecto)}${peaje.proyectos.length > 1 ? ` (histórico: ${peaje.proyectos.map(esc).join(' / ')})` : ''}.</li>
  <li><strong>Meses con reporte:</strong> ${stats.n} meses con dato, de ${stats.perfil.nObservados} meses de registros entre el primer y el último reporte (huecos internos: ${stats.perfil.huecos}).</li>
  <li><strong>Participación en el sistema:</strong> ${pct(ranking?.participacion ?? null, 2)} del recaudo acumulado de las 163 estaciones.</li>
</ul>
${filasRanking}
<h3>Composición vehicular (últimos 12 meses)</h3>
<table>
  <thead><tr><th>Categoría tarifaria</th><th>Tráfico (vehículos)</th><th>Participación</th></tr></thead>
  <tbody>
${(peaje.mix ?? []).map((c) => `<tr><td>${esc(c.label)}</td><td>${num(c.trafico)}</td><td>${pct(c.share, 1)}</td></tr>`).join('') ||
  '<tr><td colspan="3">Sin información de categorías para el período.</td></tr>'}
  </tbody>
</table>

<h2>3. Resumen estadístico del recaudo mensual</h2>
<p>Estadísticos calculados sobre los ${stats.n} meses con reporte entre ${periodo}. Cifras en pesos corrientes.</p>
<table>
  <thead><tr><th>Indicador</th><th>Valor</th><th>Indicador</th><th>Valor</th></tr></thead>
  <tbody>
    <tr><td>Meses observados</td><td>${num(stats.n)}</td><td>Desviación estándar</td><td>${money(stats.desv)}</td></tr>
    <tr><td>Recaudo acumulado</td><td>${money(stats.suma)}</td><td>Coeficiente de variación</td><td>${pct(stats.cv, 2)}</td></tr>
    <tr><td>Promedio mensual</td><td>${money(stats.promedio)}</td><td>Mínimo mensual</td><td>${money(stats.min)}</td></tr>
    <tr><td>Mediana mensual</td><td>${money(stats.mediana)}</td><td>Máximo mensual</td><td>${money(stats.max)}</td></tr>
    <tr><td>Primer cuartil (Q1)</td><td>${money(stats.q1)}</td><td>Rango intercuartílico</td><td>${money(stats.iqr)}</td></tr>
    <tr><td>Tercer cuartil (Q3)</td><td>${money(stats.q3)}</td><td>Meses atípicos (1,5·RIQ)</td><td>${num(stats.atipicos)}</td></tr>
    <tr><td>Mes de mayor recaudo</td><td>${stats.iMax >= 0 ? etiquetaCorta(stats.iMax) : '—'}</td>
        <td>${stats.ceros > 0 ? 'Meses con recaudo cero' : 'Mes de menor recaudo'}</td>
        <td>${stats.ceros > 0 ? num(stats.ceros) : (stats.iMin >= 0 ? etiquetaCorta(stats.iMin) : '—')}</td></tr>
    <tr><td>Crecimiento anual compuesto</td><td>${pct(stats.cagr, 2)}</td><td>Variación últimos 12 meses</td><td>${pct(stats.yoy, 2)}</td></tr>
    <tr><td>Tendencia (últimos 36 meses)</td><td>${stats.tendencia ? `${stats.tendencia.anual >= 0 ? '+' : '−'}${money(Math.abs(stats.tendencia.anual))} por año` : '—'}</td><td>Meses con recaudo cero</td><td>${num(stats.ceros)}</td></tr>
  </tbody>
</table>

<h2>4. Evolución histórica</h2>
${svgSerie({ real: peaje.recaudo.slice(Math.max(0, mesFinal - 119), mesFinal + 1), desde: Math.max(0, mesFinal - 119), titulo: 'Recaudo mensual · últimos 120 meses (pesos corrientes)' })}
${svgAnual({ anios: anuales })}

<h2>5. Estacionalidad</h2>
<p>Índice estacional por mes del calendario (base 1,00 = mes promedio). Valores superiores a 1 indican meses con recaudo
por encima del promedio anual; se calculan sobre la proporción de cada mes frente a su media móvil de doce meses.</p>
${svgEstacional({ factores: estacional })}
<p>Meses por encima del promedio: <strong>${estacional.filter((f) => f.factor > 1).map((f) => mesCorto(f.mes)).join(', ') || 'ninguno'}</strong>.
Máximo estacional: <strong>${mesCorto(estacional.reduce((a, b) => (b.factor > a.factor ? b : a)).mes)}</strong>
(${pct(estacional.reduce((a, b) => (b.factor > a.factor ? b : a)).factor - 1, 1)} frente al promedio).
Mínimo: <strong>${mesCorto(estacional.reduce((a, b) => (b.factor < a.factor ? b : a)).mes)}</strong>
(${pct(estacional.reduce((a, b) => (b.factor < a.factor ? b : a)).factor - 1, 1)}).</p>

<h2>6. ${esSombra ? 'Estimación del recaudo (no aplica)' : 'Estimación del recaudo'}</h2>
<p>Entrenamiento: <strong>${etiquetaLarga(0)} – ${etiquetaLarga(mesCorte)}</strong> (${mesCorte + 1} meses${baseEntrenamiento ? ', los primeros 10 años de la serie' : ', todos los datos disponibles'}).
Modelo: ${esc(modeloNombre)}${estimacion.modelo !== 'loglineal' ? ' (sustituto por datos insuficientes)' : ''}.
Horizonte: <strong>${estimacion.horizonte} meses</strong>, desde ${etiquetaLarga(mesCorte + 1)} hasta ${etiquetaLarga(mesCorte + estimacion.horizonte)}.</p>
<table>
  <thead><tr><th>Mes</th><th>Recaudo estimado</th><th>Acumulado</th></tr></thead>
  <tbody>
${esSombra ? '<p>Esta estación registra tráfico pero no recaudo, por lo que el pronóstico monetario es cero en todos los meses del horizonte y no se reporta una tabla de estimación.</p>' : ''}
${(estimacion.pronostico ?? []).map((v, k) => {
    const acum = (estimacion.pronostico ?? []).slice(0, k + 1).reduce((a, b) => a + (b ?? 0), 0);
    return `<tr><td>${etiquetaLarga(mesCorte + 1 + k)}</td><td>${money(v)}</td><td>${money(acum)}</td></tr>`;
  }).join('') || '<tr><td colspan="3">No fue posible generar el pronóstico.</td></tr>'}
  </tbody>
  <tfoot><tr><td><strong>Total ${estimacion.horizonte} meses</strong></td><td><strong>${money(proyTotal)}</strong></td><td><strong>${money(proyTotal)}</strong></td></tr></tfoot>
</table>
${svgSerie({ real: peaje.recaudo.slice(0, mesCorte + 1), proy: estimacion.pronostico, desde: Math.max(0, mesCorte - 71), titulo: 'Últimos 72 meses observados y pronóstico' })}

<h2>7. Validación del modelo</h2>
${comparacion ? `
<p>El modelo se entrenó con los <strong>primeros diez años</strong> (${etiquetaLarga(0)} – ${etiquetaLarga(config.corteValidacion)})
y se contrastó contra los meses observados de ${etiquetaLarga(config.inicioPrueba)} a ${etiquetaLarga(mesFinal)}
(${comparacion.pares.length} meses), es decir, con información que el modelo no vio durante el ajuste.
La confiabilidad estimada es <span class="rep-badge ${confianza.cls}">${confianza.txt}</span>.</p>
<table>
  <thead><tr><th>Métrica</th><th>Valor</th><th>Interpretación</th></tr></thead>
  <tbody>
    <tr><td>MAPE</td><td>${metricasComp?.mape != null ? pct(metricasComp.mape, 2) : '—'}</td><td>Error porcentual medio por mes</td></tr>
    <tr><td>WMAPE</td><td>${metricasComp?.wmape != null ? pct(metricasComp.wmape, 2) : '—'}</td><td>Error ponderado por el tamaño del recaudo</td></tr>
    <tr><td>MAE</td><td>${metricasComp ? money(metricasComp.mae) : '—'}</td><td>Error absoluto medio mensual</td></tr>
    <tr><td>RMSE</td><td>${metricasComp ? money(metricasComp.rmse) : '—'}</td><td>Raíz del error cuadrático medio</td></tr>
    <tr><td>R²</td><td>${metricasComp?.r2 != null ? metricasComp.r2.toFixed(3) : '—'}</td><td>Bondad de ajuste en el período de prueba</td></tr>
    <tr><td>Sesgo acumulado</td><td>${metricasComp?.sesgoTotal != null ? pctSigned(metricasComp.sesgoTotal, 2) : '—'}</td><td>Diferencia entre lo pronosticado y lo observado</td></tr>
  </tbody>
</table>
${mejorPeor ? `<p>El error más bajo se registró en <strong>${etiquetaCorta(mejorPeor.min.abs)}</strong>
(${pct(mejorPeor.min.errPct, 2)}) y el más alto en <strong>${etiquetaCorta(mejorPeor.max.abs)}</strong>
(${pct(mejorPeor.max.errPct, 2)}).</p>` : ''}
${svgSerie({ real: comparacion.realObs, proy: comparacion.pred, desde: config.inicioPrueba, titulo: 'Período de prueba: observado vs pronosticado' })}
` : '<p>La estación no cuenta con meses suficientes en el período de prueba para calcular métricas de error.</p>'}

<h2>8. Diagnóstico y recomendaciones</h2>
<ul>
  ${diagnostico(ctx, { confianza, ult12, proyTotal })}
</ul>

<p class="rep-nota"><strong>Nota metodológica.</strong> Serie construida a partir del reporte mensual por estación de peaje de la
Agencia Nacional de Infraestructura (Operación Estadística de Tráfico y Recaudo – OETR). Los valores están en pesos
colombianos corrientes y no se deflactan. El modelo es una regresión log-lineal robusta con tendencia y estacionalidad
mensual; las estaciones con menos de 18 meses de datos usan un modelo estacional con crecimiento y las estaciones cerradas o
de conteo se proyectan en cero. Este reporte es un análisis estadístico y no constituye una proyección oficial de la entidad.</p>
`;

  return html;
}

function diagnostico(ctx, { confianza, ult12, proyTotal }) {
  const { stats, estimacion, metricasComp, comparacion, peaje, gNacional } = ctx;
  const items = [];
  const cv = stats.cv;
  if (cv != null) {
    if (cv > 0.45) items.push(`La serie es <strong>muy volátil</strong> (coeficiente de variación ${pct(cv, 1)}): el recaudo mensual cambia con fuerza, por lo que el pronóstico debe interpretarse como un rango y no como un valor puntual.`);
    else if (cv > 0.25) items.push(`La serie presenta <strong>volatilidad moderada</strong> (coeficiente de variación ${pct(cv, 1)}).`);
    else items.push(`La serie es <strong>estable</strong> (coeficiente de variación ${pct(cv, 1)}), lo que favorece la precisión del pronóstico.`);
  }
  if (stats.cagr != null) {
    if (stats.cagr > 0.03) items.push(`Tendencia de crecimiento sostenido: el recaudo crece a una tasa anual compuesta de ${pct(stats.cagr, 2)} en pesos corrientes, impulsado por la indexación tarifaria y la dinámica de tráfico.`);
    else if (stats.cagr < -0.01) items.push(`Tendencia decreciente: el recaudo cae a una tasa anual compuesta de ${pct(stats.cagr, 2)}; conviene revisar cambios de aforo, desvíos de tráfico o suspensiones del cobro.`);
    else items.push(`El recaudo se mantiene prácticamente estable en términos nominales (${pct(stats.cagr, 2)} anual), lo que implica una pérdida real frente a la inflación.`);
  }
  if (stats.atipicos > 0) {
    items.push(`Se identificaron <strong>${plural(stats.atipicos, 'mes atípico', 'meses atípicos')}</strong> (fuera de 1,5 veces el rango intercuartílico); el modelo robusto les asigna menor peso para evitar distorsiones.`);
  }
  if (stats.perfil.cerrada) items.push('La estación <strong>no registra reportes recientes</strong>: se asume recaudo cero en el pronóstico. Si el cierre es temporal, la estimación subestima el potencial de la estación.');
  if (stats.perfil.sombra) items.push('Corresponde a una <strong>estación de conteo (peaje sombra)</strong>: registra tráfico pero no recaudo, por lo que el pronóstico monetario es cero por definición.');
  if (stats.ceros > 0 && !stats.perfil.sombra) items.push(`Hay <strong>${plural(stats.ceros, 'mes', 'meses')} con recaudo cero</strong> pese a tener tráfico registrado, lo que sugiere suspensiones del cobro o novedades operativas.`);
  if (metricasComp?.mape != null) {
    if (metricasComp.mape < 0.15) items.push(`El desempeño fuera de muestra es <strong>sólido</strong> (MAPE ${pct(metricasComp.mape, 2)} en ${comparacion.pares.length} meses de prueba).`);
    else if (metricasComp.mape < 0.3) items.push(`El desempeño fuera de muestra es <strong>aceptable</strong> (MAPE ${pct(metricasComp.mape, 2)}); se recomienda revisar el pronóstico si se esperan cambios tarifarios.`);
    else items.push(`El error fuera de muestra es <strong>alto</strong> (MAPE ${pct(metricasComp.mape, 2)}): la estación cambió de nivel durante el período de prueba y el pronóstico debe usarse con cautela.`);
  }
  if (metricasComp?.sesgoTotal != null && Math.abs(metricasComp.sesgoTotal) > 0.1) {
    items.push(`El modelo ${metricasComp.sesgoTotal < 0 ? 'subestima' : 'sobreestima'} el recaudo del período de prueba en ${pct(Math.abs(metricasComp.sesgoTotal), 1)}; la proyección hacia adelante incorpora un crecimiento anual de ${pct(gNacional, 2)}.`);
  }
  items.push(`Recaudo esperado para los próximos ${estimacion.horizonte} meses: <strong>${money(proyTotal)}</strong>, equivalente a ${money(proyTotal / Math.max(1, estimacion.horizonte))} mensuales. Confiabilidad estimada: <strong>${confianza.txt.toLowerCase()}</strong>.`);
  if (ult12 > 0 && proyTotal > 0) {
    const anualProy = (proyTotal / estimacion.horizonte) * 12;
    items.push(`La proyección anualizada (${moneyShort(anualProy)}) representa ${pctSigned(anualProy / ult12 - 1, 2)} frente a los últimos doce meses observados (${moneyShort(ult12)}).`);
  }
  items.push(`<strong>Recomendación:</strong> ${(metricasComp?.mape ?? 1) < 0.2
    ? 'usar el pronóstico puntual para fines de planeación y presupuesto, revisándolo cada trimestre con los nuevos reportes de la ANI.'
    : 'utilizar el pronóstico como escenario de referencia y complementarlo con información operativa (tarifas, obras, cierres) antes de comprometer cifras.'}`);
  void peaje;
  return items.map((i) => `<li>${i}</li>`).join('');
}

/** Envuelve el reporte en un documento HTML autónomo (para descargar). */
export function documentoCompleto(titulo, interior) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>
  body { margin: 0; background: #eef2f7; font-family: -apple-system, "Segoe UI", system-ui, Arial, sans-serif; }
  .hoja { max-width: 880px; margin: 24px auto; background: #fff; padding: 38px 44px; box-shadow: 0 6px 24px -12px rgba(16,35,56,.35); font-size: 12.6px; line-height: 1.55; color: #1b2733; }
  h1 { font-size: 20px; margin: 0 0 2px; color: #123c5c; }
  h2 { font-size: 13.8px; margin: 24px 0 8px; color: #123c5c; padding-bottom: 4px; border-bottom: 1.6px solid #dbe5ee; }
  h3 { font-size: 12.6px; margin: 14px 0 5px; }
  p { margin: 0 0 8px; }
  ul { margin: 0 0 10px 18px; padding: 0; }
  li { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 11.5px; }
  th, td { border: 1px solid #dde5ee; padding: 5px 7px; text-align: right; }
  th { background: #f2f6fa; font-weight: 650; color: #33475b; }
  th:first-child, td:first-child { text-align: left; }
  th:last-child, td:last-child { text-align: left; }
  .rep-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 3px solid #123c5c; padding-bottom: 12px; }
  .rep-meta { font-size: 11px; color: #5d6f7f; text-align: right; line-height: 1.7; }
  .rep-ficha { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 4px; }
  .rep-ficha div { background: #f5f9fc; border: 1px solid #e2eaf2; border-radius: 6px; padding: 7px 9px; }
  .rep-ficha span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #6c7d8d; }
  .rep-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 14px; }
  .rep-kpis div { border: 1px solid #e2eaf2; border-left: 3px solid #1f5f8b; border-radius: 5px; padding: 8px 10px; background: #fafcfe; }
  .rep-kpis span { display: block; font-size: 9.8px; text-transform: uppercase; letter-spacing: .04em; color: #6c7d8d; }
  .rep-kpis strong { font-size: 13px; color: #123c5c; }
  .rep-nota { font-size: 10.6px; color: #5d6f7f; border-top: 1px solid #e2eaf2; padding-top: 8px; margin-top: 16px; }
  .rep-badge { display: inline-block; padding: 2px 7px; border-radius: 99px; font-size: 10px; font-weight: 650; }
  .rep-badge.ok { background: #e5f4ec; color: #1f6a45; }
  .rep-badge.warn { background: #fdf2df; color: #8a5a0a; }
  .rep-badge.danger { background: #fbe9e4; color: #93341f; }
  @media print { body { background: #fff; } .hoja { box-shadow: none; margin: 0; padding: 0; max-width: none; } }
</style>
</head>
<body><div class="hoja">${interior}</div></body>
</html>`;
}

export { svgSerie, svgAnual, svgEstacional, serieAnual };
