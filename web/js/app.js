/* TollCast — aplicación interactiva de estimación de recaudo por peaje */

import {
  MODELOS, MODELO_POR_DEFECTO, CONFIG, pronosticar, pronosticarSistema, crecimientoNacional,
  metricas, perfilSerie, tendenciaAjustada,
} from './forecast.js';
import {
  money, moneyShort, num, numShort, pct, pctSigned, etiquetaCorta, etiquetaLarga, mesCorto,
  descargar, toCSV, fechaHoy,
} from './format.js';
import { resumenEstadistico, serieAnual, estacionalidad, hhi, agregar } from './stats.js';
import { graficoSerie, barrasHorizontales, barras, barrasMensuales, dona, COL } from './charts.js';
import { construirReporte, documentoCompleto } from './reporte.js';

/* ────────────────────────────── estado ──────────────────────────────────── */

const S = {
  data: null,
  meses: [],
  mesesISO: [],
  totales: [],
  peaje: null,
  peajesFiltrados: [],
  stats: [],
  modelo: MODELO_POR_DEFECTO,
  horizonte: 12,
  corte: 119, // índice del último mes usado para estimar
  base: 'ultimo', // 'ultimo' = últimos datos · 'entrenamiento' = primeros 10 años
  CORTE_ENTRENAMIENTO: 119, // dic-2023 (10 años desde ene-2014)
  gNacionalAuto: 0.05,
  gNacional: 0.05,
  usarAuto: true,
  estimacion: null,
  comparacion: null,
  comparacionStats: null,
  sistema: null,
  ordenPeajes: { campo: 'suma', dir: 'desc' },
  ordenVal: null,
  ultimoReporte: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ─────────────────────────────── arranque ───────────────────────────────── */

async function iniciar() {
  let data;
  try {
    data = await cargarDatos();
  } catch (err) {
    document.querySelector('main').innerHTML = `
      <div class="card"><h2>No fue posible cargar los datos</h2>
      <p class="card-sub">El archivo <code>data.json</code> debe servirse por HTTP (no abriendo el HTML directamente).</p>
      <p class="nota">${String(err.message)}</p>
      <p class="card-sub">Ejecute <code>python3 serve.py</code> en la raíz del repositorio y abra
      <code>http://localhost:8000</code>, o <code>python3 -m http.server 8000</code> dentro de la carpeta <code>web</code>.</p></div>`;
    return;
  }

  S.data = data;
  S.meses = data.meta.meses;
  S.mesesISO = data.meta.mesesISO;
  S.totales = data.totales.recaudo;
  const ultimo = S.meses.length - 1;

  S.corte = S.meses.length - 1; // por defecto: todos los datos disponibles
  S.base = 'ultimo';
  S.modelo = MODELO_POR_DEFECTO;
  S.gNacionalAuto = crecimientoNacional(S.totales, S.corte);
  S.gNacional = S.gNacionalAuto;

  $("#fuente-corta").textContent = `ANI · ${data.meta.nPeajes} estaciones · ene 2014 – ${S.meses[ultimo]}`;

  prepararControles();
  conectarEventos();
  calcularEstadisticas();
  renderPanorama();
  renderPeajes();
  renderValidacion();

  S.peaje = S.data.peajes.find((p) => p.nombre === 'ALVARADO') ?? S.data.peajes[0];
  $("#sel-peaje").value = String(S.peaje.id);
  actualizarEstimacion();

  toast('Datos cargados: 163 estaciones y 152 meses');
}

/** Carga data.json y, si fetch no está disponible (file://), usa js/data.js. */
async function cargarDatos() {
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    const alt = await cargarDataJS();
    if (alt) return alt;
    throw err;
  }
}

function cargarDataJS() {
  return new Promise((resolve) => {
    if (window.__TOLLCAST_DATA__) { resolve(window.__TOLLCAST_DATA__); return; }
    const s = document.createElement('script');
    s.src = 'js/data.js';
    s.onload = () => resolve(window.__TOLLCAST_DATA__ ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

function prepararControles() {
  const sel = $("#sel-peaje");
  const porDep = new Map();
  for (const p of [...S.data.peajes].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
    if (!porDep.has(p.departamento)) porDep.set(p.departamento, []);
    porDep.get(p.departamento).push(p);
  }
  for (const dep of [...porDep.keys()].sort((a, b) => a.localeCompare(b, 'es'))) {
    const g = document.createElement('optgroup');
    g.label = dep;
    for (const p of porDep.get(dep)) {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = p.nombre;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }

  const selM = $("#sel-modelo");
  for (const [k, m] of Object.entries(MODELOS)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = m.nombre;
    selM.appendChild(o);
  }
  selM.value = S.modelo;

  $("#sel-base").value = S.base;

  const selDep = $("#filtro-dep");
  const deps = [...new Set(S.data.peajes.map((p) => p.departamento))].sort((a, b) => a.localeCompare(b, 'es'));
  selDep.innerHTML = '<option value="">Todos los departamentos</option>' +
    deps.map((d) => `<option value="${d}">${d}</option>`).join('');
}

function conectarEventos() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => { x.classList.remove('is-active'); x.setAttribute('aria-selected', 'false'); });
    $$('.panel').forEach((x) => x.classList.remove('is-active'));
    t.classList.add('is-active');
    t.setAttribute('aria-selected', 'true');
    $(`#tab-${t.dataset.tab}`).classList.add('is-active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // re-render para recalcular anchos de SVG
    if (t.dataset.tab === 'panorama') renderPanorama();
    if (t.dataset.tab === 'estimacion') actualizarEstimacion();
    if (t.dataset.tab === 'validacion') renderValidacion();
  }));

  $("#sel-peaje").addEventListener('change', (e) => {
    S.peaje = S.data.peajes.find((p) => String(p.id) === e.target.value);
    actualizarEstimacion();
  });
  $("#sel-horizonte").addEventListener('change', (e) => { S.horizonte = +e.target.value; actualizarEstimacion(); });
  $("#sel-modelo").addEventListener('change', (e) => { S.modelo = e.target.value; actualizarEstimacion(); });
  $("#rng-crec").addEventListener('input', (e) => {
    $("#chk-auto").checked = false;
    S.usarAuto = false;
    S.gNacional = +e.target.value / 100;
    $("#out-crec").textContent = `${(+e.target.value).toFixed(1).replace('.', ',')} %`;
    actualizarEstimacion();
  });
  $("#chk-auto").addEventListener('change', (e) => {
    S.usarAuto = e.target.checked;
    if (S.usarAuto) {
      S.gNacional = crecimientoNacional(S.totales, S.corte);
      $("#rng-crec").value = (S.gNacional * 100).toFixed(1);
      $("#out-crec").textContent = `${(S.gNacional * 100).toFixed(1).replace('.', ',')} %`;
    }
    actualizarEstimacion();
  });
  $("#sel-base").addEventListener('change', (e) => {
    S.base = e.target.value;
    S.corte = S.base === 'entrenamiento' ? S.CORTE_ENTRENAMIENTO : S.meses.length - 1;
    S.gNacionalAuto = crecimientoNacional(S.totales, S.corte);
    if (S.usarAuto) {
      S.gNacional = S.gNacionalAuto;
      $("#rng-crec").value = (S.gNacional * 100).toFixed(1);
      $("#out-crec").textContent = `${(S.gNacional * 100).toFixed(1).replace('.', ',')} %`;
    }
    actualizarEstimacion();
    toast(S.base === 'entrenamiento'
      ? 'Estimando con el modelo entrenado en los primeros 10 años'
      : 'Estimando con todos los datos disponibles');
  });
  $("#btn-estimar").addEventListener('click', () => {
    actualizarEstimacion();
    toast('Estimación recalculada');
  });
  $("#btn-export-csv").addEventListener('click', exportarEstimacionCSV);
  $("#btn-csv-total").addEventListener('click', exportarTotalCSV);
  $("#btn-csv-peajes").addEventListener('click', exportarPeajesCSV);
  $("#btn-reporte").addEventListener('click', abrirReporte);
  $("#btn-reporte-html").addEventListener('click', () => {
    if (!S.ultimoReporte) abrirReporte();
    descargarReporteHTML();
  });
  $("#btn-descargar-rep").addEventListener('click', descargarReporteHTML);
  $("#btn-imprimir").addEventListener('click', () => window.print());

  $("#btn-ayuda").addEventListener('click', () => { $("#modal-ayuda").hidden = false; });
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => { b.closest('.modal').hidden = true; }));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal').forEach((m) => { m.hidden = true; });
  });

  $("#buscar-peaje").addEventListener('input', renderPeajes);
  $("#filtro-dep").addEventListener('change', renderPeajes);
  $("#filtro-val").addEventListener('change', renderValidacionPeajes);

  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if ($('#tab-panorama').classList.contains('is-active')) renderPanorama();
      if ($('#tab-estimacion').classList.contains('is-active')) dibujarGraficosEstimacion();
    }, 220);
  });
}

/* ──────────────────────────── estadísticas base ─────────────────────────── */

function calcularEstadisticas() {
  const ultimo = S.meses.length - 1;
  S.stats = S.data.peajes.map((p) => ({
    peaje: p,
    ...resumenEstadistico(p.recaudo, S.mesesISO, ultimo),
    anual: serieAnual(p.recaudo, ultimo),
  }));
}

/* ─────────────────────────────── panorama ───────────────────────────────── */

function renderPanorama() {
  const ultimo = S.meses.length - 1;
  const totalPeriodo = S.totales.reduce((s, v) => s + v, 0);
  const ult12 = S.totales.slice(ultimo - 11).reduce((s, v) => s + v, 0);
  const prev12 = S.totales.slice(ultimo - 23, ultimo - 11).reduce((s, v) => s + v, 0);
  const yoy = prev12 > 0 ? ult12 / prev12 - 1 : null;
  const activos = S.data.peajes.filter((p) => {
    const perfil = perfilSerie(p.recaudo);
    return !perfil.cerrada && !perfil.sombra;
  }).length;
  const promMensual = totalPeriodo / S.totales.filter((v) => v > 0).length;

  const anios = serieAnual(S.totales, ultimo);
  const completos = anios.filter((a) => a.completo);
  const cagr = completos.length > 1
    ? (completos.at(-1).suma / completos[0].suma) ** (1 / (completos.at(-1).anio - completos[0].anio)) - 1
    : null;

  $("#kpis-panorama").innerHTML = [
    kpi('Recaudo acumulado 2014–2026', moneyShort(totalPeriodo),
      `${money(totalPeriodo)} · ${S.meses.length} meses`, ''),
    kpi('Últimos 12 meses', moneyShort(ult12),
      yoy != null ? `${pctSigned(yoy, 1)} frente a los 12 meses previos` : '—', yoy),
    kpi('Promedio mensual del sistema', moneyShort(promMensual), `Máximo: ${moneyShort(Math.max(...S.totales))}`, ''),
    kpi('Estaciones con recaudo activo', `${activos} de ${S.data.peajes.length}`,
      `${S.data.meta?.nProyectos ?? S.data.meta.nProyectos} proyectos · ${S.data.meta.nDepartamentos} departamentos`, ''),
  ].join('');

  graficoSerie($("#chart-sistema"), {
    real: S.totales,
    desde: 0,
    alto: 320,
    etiquetaY: moneyShort,
    marcas: [{ i: S.mesesISO.indexOf('2020-04'), label: 'COVID-19' }],
    tendencia: tendenciaAjustada(S.totales, ultimo),
  });

  const etiquetas = anios.map((a) => String(a.anio));
  barras($("#chart-anual"), {
    valores: anios.map((a) => a.suma),
    etiquetas,
    alto: 250,
    formato: moneyShort,
  });

  // top peajes
  const ranking = S.data.peajes.map((p) => ({
    etiqueta: p.nombre,
    valor: p.recaudo.reduce((s, v) => s + (v ?? 0), 0),
    id: p.id,
  })).sort((a, b) => b.valor - a.valor);
  barrasHorizontales($("#top-peajes"), {
    filas: ranking,
    max: 15,
    onClick: (d) => {
      S.peaje = S.data.peajes.find((p) => p.id === d.id);
      $("#sel-peaje").value = String(S.peaje.id);
      $$('.tab').find((t) => t.dataset.tab === 'estimacion').click();
      actualizarEstimacion();
    },
  });

  const deps = agregar(S.data.peajes, 0, ultimo).map((d) => ({ etiqueta: d.nombre, valor: d.total }));
  barrasHorizontales($("#top-departamentos"), { filas: deps, max: 23 });

  // HHI
  const shares = ranking.map((r) => r.valor);
  const indice = hhi(shares);
  const top5 = shares.slice(0, 5).reduce((s, v) => s + v, 0) / shares.reduce((s, v) => s + v, 0);
  $("#card-hhi").innerHTML = `
    <div class="kpi-value sm">${num(indice, 0)} <span class="muted" style="font-size:.8rem;font-weight:500">HHI</span></div>
    <p class="kpi-foot">${indice > 2500 ? 'Alta' : indice > 1500 ? 'Moderada' : 'Baja'} concentración del recaudo entre estaciones.</p>
    <p class="kpi-foot">Los 5 primeros peajes concentran <strong>${pct(top5, 1)}</strong> del recaudo total.</p>`;

  $("#card-crecimiento").innerHTML = `
    <div class="kpi-value sm">${pctSigned(cagr, 2)}</div>
    <p class="kpi-foot">Crecimiento anual compuesto ${completos[0]?.anio}–${completos.at(-1)?.anio} (años completos).</p>
    <p class="kpi-foot">Variación últimos 12 meses: <strong class="${yoy >= 0 ? 'pos' : 'neg'}">${pctSigned(yoy, 2)}</strong></p>`;

  // composición vehicular nacional (últimos 12 meses del reporte)
  const mix = S.data.mixNacional ?? [];
  if (mix.length) {
    dona($("#card-mix"), { partes: mix.map((m) => ({ etiqueta: m.label, valor: m.trafico })), alto: 190 });
  } else {
    $("#card-mix").innerHTML = '<p class="vacio">Sin desagregación por categoría en el archivo de datos.</p>';
  }
}

function kpi(label, value, foot, tendencia) {
  const cls = tendencia == null ? '' : tendencia >= 0 ? 'pos' : 'neg';
  return `<div class="kpi">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot ${cls}">${foot ?? ''}</div>
  </div>`;
}

/* ─────────────────────────────── estimación ─────────────────────────────── */

function actualizarEstimacion() {
  const p = S.peaje;
  if (!p) return;
  const ultimo = S.meses.length - 1;
  const gNacional = S.usarAuto ? S.gNacionalAuto : S.gNacional;

  const est = pronosticar(p.recaudo, S.corte, S.horizonte, { modelo: S.modelo, gNacional });
  S.estimacion = est;

  $("#est-titulo").textContent = `${p.nombre} · estimación de recaudo`;
  $("#est-sub").textContent = `${p.municipio}, ${p.departamento} · ${p.proyecto}`;
  $("#hint-peaje").textContent =
    `Id ${p.id} · ${p.proyectos.length > 1 ? `${p.proyectos.length} proyectos en el histórico` : p.proyecto}`;

  const estadoMap = {
    ok: ['Modelo propio', 'pill-ok'],
    'senal-corta': ['Serie corta', 'pill-warn'],
    cerrado: ['Estación cerrada', 'pill-danger'],
    sombra: ['Peaje sombra', 'pill-warn'],
    'sin-datos': ['Sin datos', 'pill-danger'],
    insuficiente: ['Datos insuficientes', 'pill-danger'],
  };
  const [txt, cls] = estadoMap[est.estado] ?? [est.estado, 'pill'];
  $("#est-estado").textContent = txt;
  $("#est-estado").className = `pill ${cls}`;

  $("#hint-modelo").textContent = `${MODELOS[S.modelo].nombre} · crecimiento anual ${pct(gNacional, 2)}`;
  $("#out-crec").textContent = `${(gNacional * 100).toFixed(1).replace('.', ',')} %`;
  $("#hint-base").textContent = S.base === 'entrenamiento'
    ? `Modelo entrenado con ${etiquetaLarga(0)} – ${etiquetaLarga(S.corte)} (${S.corte + 1} meses). El pronóstico continúa desde ene 2024.`
    : `Modelo entrenado con ${etiquetaLarga(0)} – ${etiquetaLarga(S.corte)} (${S.corte + 1} meses). El pronóstico continúa después de ago 2026.`;

  const stats = S.stats.find((s) => s.peaje.id === p.id);
  const proyTotal = (est.pronostico ?? []).reduce((a, b) => a + (b ?? 0), 0);
  const base12 = p.recaudo.slice(Math.max(0, S.corte - 11), S.corte + 1).reduce((a, b) => a + (b ?? 0), 0);

  $("#est-kpis").innerHTML = [
    miniKpi(`Pronóstico ${S.horizonte} meses`, moneyShort(proyTotal),
      `${moneyShort(proyTotal / S.horizonte)} promedio mensual`),
    miniKpi(`Recaudo 12 meses hasta ${etiquetaCorta(S.corte)}`, base12 ? moneyShort(base12) : '—',
      `Último dato usado por el modelo`),
    miniKpi('Recaudo acumulado histórico', moneyShort(stats.suma), `${stats.n} meses reportados`),
    miniKpi('Crecimiento anual usado', pct(gNacional, 2), S.usarAuto ? 'Estimado de la serie' : 'Definido manualmente'),
  ].join('');

  dibujarGraficosEstimacion();

  // aviso cuando la estación no genera un pronóstico monetario
  const aviso = {
    sombra: 'Estación de conteo (<strong>peaje sombra</strong>): registra tráfico pero no cobra tarifa, por lo que su recaudo proyectado es cero por definición.',
    cerrado: 'La estación <strong>no registra reportes recientes</strong> (cierre, reversión o suspensión): su recaudo proyectado se asume cero.',
    'sin-datos': 'La estación no cuenta con registros en el período analizado.',
    insuficiente: 'La estación no tiene meses suficientes con recaudo para estimar un pronóstico.',
  }[est.estado];
  $("#est-aviso").innerHTML = aviso ? `<div class="aviso">${aviso}</div>` : '';
  $("#est-aviso").hidden = !aviso;

  // tabla mensual
  if (!est.pronostico) {
    $("#tabla-estimacion").innerHTML = `<tbody><tr><td class="vacio">Sin pronóstico monetario para esta estación.</td></tr></tbody>`;
  } else if (est.pronostico.every((v) => !v)) {
    const filas = est.pronostico.map((v, k) => `<tr><td>${etiquetaLarga(S.corte + 1 + k)}</td>
      <td class="num">$ 0</td><td class="num muted">$ 0</td></tr>`).join('');
    $("#tabla-estimacion").innerHTML = `
      <thead><tr><th>Mes proyectado</th><th>Estimación</th><th>Acumulado</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr class="fila-total"><td>Total ${S.horizonte} meses</td><td class="num">$ 0</td><td class="num">$ 0</td></tr></tfoot>`;
  } else {
    let acum = 0;
    const filas = est.pronostico.map((v, k) => {
      acum += v;
      const i = S.corte + 1 + k;
      const real = p.recaudo[i];
      return `<tr>
        <td>${etiquetaLarga(i)}</td>
        <td class="num">${money(v)}</td>
        <td class="num muted">${money(acum)}</td>
        ${S.base === 'entrenamiento' ? `<td class="num">${real != null ? money(real) : '<span class="muted">sin dato</span>'}</td>` : ''}
      </tr>`;
    }).join('');
    $("#tabla-estimacion").innerHTML = `
      <thead><tr><th>Mes proyectado</th><th>Estimación</th><th>Acumulado</th>
        ${S.base === 'entrenamiento' ? '<th>Observado (dato real)</th>' : ''}</tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr class="fila-total"><td>Total ${S.horizonte} meses</td><td class="num">${money(proyTotal)}</td>
      <td class="num">${money(proyTotal)}</td>${S.base === 'entrenamiento' ? '<td></td>' : ''}</tr></tfoot>`;
  }

  renderComparacion(stats);
  renderStatsPeaje(stats);
  renderTotalSistema();
  construirReporteActual();
}

function miniKpi(label, value, foot) {
  return `<div class="kpi">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value sm">${value}</div>
    ${foot ? `<div class="kpi-foot">${foot}</div>` : ''}
  </div>`;
}

function dibujarGraficosEstimacion() {
  if (!S.peaje || !S.estimacion) return;
  const desde = Math.max(0, S.corte - 59 + 1);
  graficoSerie($("#chart-estimacion"), {
    real: S.peaje.recaudo.slice(desde, S.corte + 1),
    proy: S.estimacion.pronostico,
    desde,
    alto: 300,
    etiquetaY: moneyShort,
    tendencia: tendenciaAjustada(S.peaje.recaudo, S.corte),
  });
  if (S.comparacion) {
    graficoSerie($("#chart-comparacion"), {
      real: S.comparacion.realObs,
      proy: S.comparacion.pred,
      desde: S.comparacion.corte + 1,
      alto: 240,
      etiquetaY: moneyShort,
      superpuesto: true,
    });
  }
}

/** Compara el pronóstico entrenado con 10 años contra lo observado después del corte. */
function renderComparacion(stats) {
  const p = S.peaje;
  const fin = S.meses.length - 1;
  const corte = S.CORTE_ENTRENAMIENTO; // la validación siempre usa los primeros 10 años
  if (fin <= corte) {
    $("#est-metricas").innerHTML = '<p class="vacio">No hay meses de prueba disponibles.</p>';
    $("#chart-comparacion").innerHTML = '';
    S.comparacion = null;
    return;
  }
  const hz = fin - corte;
  const g = crecimientoNacional(S.totales, corte);
  const est = pronosticar(p.recaudo, corte, hz, { modelo: S.modelo, gNacional: g });
  const realObs = p.recaudo.slice(corte + 1, fin + 1);
  const pred = est.pronostico;
  const m = metricas(realObs, pred);
  S.comparacion = {
    realObs, pred: pred ? pred.slice(0, realObs.length) : null, metricas: m, horizonte: hz, corte,
    pares: realObs.map((r, k) => ({
      abs: corte + 1 + k,
      real: r,
      pred: pred ? pred[k] : null,
      errPct: r != null && r > 0 && pred?.[k] != null ? Math.abs(pred[k] / r - 1) : null,
    })),
  };
  if (!m) {
    $("#est-metricas").innerHTML = '<p class="vacio">No hay meses observados suficientes para medir el error.</p>';
    $("#chart-comparacion").innerHTML = '';
    return;
  }
  $("#est-metricas").innerHTML = [
    miniKpi('MAPE (error medio)', m.mape != null ? pct(m.mape, 2) : '—', `${m.n} meses de prueba (2024–2026)`),
    miniKpi('Sesgo acumulado', pctSigned(m.sesgoTotal, 2), m.sesgoTotal < 0 ? 'Subestima' : 'Sobreestima'),
    miniKpi('MAE', moneyShort(m.mae), 'Error absoluto medio'),
    miniKpi('R²', m.r2 != null ? m.r2.toFixed(2) : '—', 'Bondad de ajuste'),
  ].join('');
  graficoSerie($("#chart-comparacion"), {
    real: realObs,
    proy: S.comparacion.pred,
    desde: corte + 1,
    alto: 240,
    etiquetaY: moneyShort,
    superpuesto: true,
  });
  void stats;
}

function renderStatsPeaje(stats) {
  $("#est-stats-sub").textContent = `${etiquetaLarga(stats.desde)} – ${etiquetaLarga(stats.hasta)} · ${stats.n} meses con reporte`;
  const filas = [
    ['Recaudo acumulado', money(stats.suma)],
    ['Promedio mensual', money(stats.promedio)],
    ['Mediana mensual', money(stats.mediana)],
    ['Desviación estándar', money(stats.desv)],
    ['Coeficiente de variación', pct(stats.cv, 1)],
    ['Mínimo mensual', money(stats.min)],
    ['Máximo mensual', money(stats.max)],
    ['Primer cuartil (Q1)', money(stats.q1)],
    ['Tercer cuartil (Q3)', money(stats.q3)],
    ['Meses atípicos', num(stats.atipicos)],
    ['Crecimiento anual compuesto', pct(stats.cagr, 2)],
    ['Variación últimos 12 meses', pct(stats.yoy, 2)],
    ['Tendencia últimos 36 meses', stats.tendencia ? `${moneyShort(stats.tendencia.anual)}/año` : '—'],
    ['Mes de mayor recaudo', stats.iMax >= 0 ? etiquetaCorta(stats.iMax) : '—'],
  ];
  $("#est-stats").innerHTML = filas.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  const est = estacionalidad(S.peaje.recaudo, stats.hasta);
  barrasMensuales($("#chart-estacional"), {
    valores: est.map((e) => e.factor),
    alto: 180,
    formato: (v) => v.toFixed(2).replace('.', ','),
  });
  barras($("#chart-peaje-anual"), {
    valores: stats.anual.map((a) => a.suma),
    etiquetas: stats.anual.map((a) => String(a.anio)),
    alto: 190,
    formato: moneyShort,
  });
}

/* ────────────────────────────── total sistema ───────────────────────────── */

function renderTotalSistema() {
  const g = S.usarAuto ? S.gNacionalAuto : S.gNacional;
  const sis = pronosticarSistema(S.data.peajes, S.totales, S.corte, S.horizonte, { modelo: S.modelo, gNacional: g });
  S.sistema = sis;
  const totalProy = sis.total.reduce((a, b) => a + b, 0);
  const baseTotal = S.totales.slice(Math.max(0, S.corte - 11), S.corte + 1).reduce((a, b) => a + b, 0);
  const nProyectados = sis.detalle.filter((d) => d.pronostico && d.pronostico.some((v) => v > 0)).length;

  $("#total-kpis").innerHTML = [
    miniKpi(`Total estimado ${S.horizonte} meses`, moneyShort(totalProy), `${money(totalProy)}`),
    miniKpi('Promedio mensual proyectado', moneyShort(totalProy / S.horizonte),
      baseTotal ? `${pctSigned(totalProy / S.horizonte / (baseTotal / 12) - 1, 1)} vs base 12m` : ''),
    miniKpi('Estaciones con recaudo proyectado', `${nProyectados}`, `de ${S.data.peajes.length} (resto cerradas o de conteo)`),
    miniKpi('Crecimiento del sistema', pct(g, 2), 'Crecimiento anual aplicado'),
  ].join('');

  const desdeTotal = Math.max(0, S.corte - 47);
  graficoSerie($("#chart-total-sistema"), {
    real: S.totales.slice(desdeTotal, S.corte + 1),
    proy: sis.total,
    desde: desdeTotal,
    alto: 290,
    etiquetaY: moneyShort,
  });

  const top = sis.detalle
    .filter((d) => d.pronostico)
    .map((d) => ({ ...d, total: d.pronostico.reduce((a, b) => a + (b ?? 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  $("#tabla-total").innerHTML = `
    <thead><tr><th>Estación</th><th>Estado</th><th>Estimación ${S.horizonte} meses</th><th>Participación</th></tr></thead>
    <tbody>
      <tr class="fila-total"><td>Total del sistema</td><td>—</td><td class="num" title="${money(totalProy)}">${money(totalProy)}</td><td class="num">100,0 %</td></tr>
      ${top.map((d) => `<tr><td>${d.nombre}</td><td class="muted">${d.estado === 'ok' ? 'modelo propio' : d.estado}</td>
        <td class="num">${money(d.total)}</td><td class="num">${pct(totalProy ? d.total / totalProy : null, 1)}</td></tr>`).join('')}
    </tbody>`;
}

/* ──────────────────────────────── peajes ───────────────────────────────── */

function renderPeajes() {
  const q = $("#buscar-peaje").value.trim().toLowerCase();
  const dep = $("#filtro-dep").value;
  let filas = S.stats.filter((s) => {
    const p = s.peaje;
    if (dep && p.departamento !== dep) return false;
    if (!q) return true;
    return `${p.nombre} ${p.municipio} ${p.proyecto} ${p.departamento}`.toLowerCase().includes(q);
  });

  const { campo, dir } = S.ordenPeajes;
  const val = (s) => {
    switch (campo) {
      case 'nombre': return s.peaje.nombre;
      case 'departamento': return s.peaje.departamento;
      case 'suma': return s.suma ?? -1;
      case 'promedio': return s.promedio ?? -1;
      case 'cagr': return s.cagr ?? -99;
      case 'yoy': return s.yoy ?? -99;
      case 'cv': return s.cv ?? 99;
      case 'n': return s.n;
      case 'estado': return estadoOrden(s);
      default: return s.suma ?? -1;
    }
  };
  filas.sort((a, b) => {
    const va = val(a); const vb = val(b);
    if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb, 'es') : vb.localeCompare(va, 'es');
    return dir === 'asc' ? va - vb : vb - va;
  });
  S.peajesFiltrados = filas;

  const th = (campo2, label, num2 = false) =>
    `<th data-campo="${campo2}" class="${num2 ? 'num' : ''}"${campo === campo2 ? ` data-dir="${dir}"` : ''}>${label}</th>`;

  $("#tabla-peajes").innerHTML = `
    <thead><tr>
      ${th('nombre', 'Estación')}
      ${th('departamento', 'Departamento')}
      ${th('n', 'Meses', true)}
      ${th('suma', 'Recaudo acumulado', true)}
      ${th('promedio', 'Promedio mensual', true)}
      ${th('cagr', 'Crec. anual (CAGR)', true)}
      ${th('yoy', 'Var. 12 meses', true)}
      ${th('cv', 'Volatilidad', true)}
      ${th('estado', 'Estado')}
    </tr></thead>
    <tbody>
    ${filas.map((s) => {
      const p = s.peaje;
      return `<tr class="clic" data-id="${p.id}">
        <td data-label="Estación"><strong>${p.nombre}</strong><span class="muted" style="font-size:.72rem"> · ${p.municipio}</span></td>
        <td data-label="Departamento">${p.departamento}</td>
        <td class="num" data-label="Meses con reporte">${s.n}</td>
        <td class="num" data-label="Recaudo acumulado" title="${money(s.suma)}">${moneyShort(s.suma)}</td>
        <td class="num" data-label="Promedio mensual" title="${money(s.promedio)}">${moneyShort(s.promedio)}</td>
        <td class="num ${s.cagr != null ? (s.cagr >= 0 ? 'pos' : 'neg') : ''}" data-label="Crecimiento anual">${pctSigned(s.cagr, 2)}</td>
        <td class="num ${s.yoy != null ? (s.yoy >= 0 ? 'pos' : 'neg') : ''}" data-label="Var. 12 meses">${pctSigned(s.yoy, 2)}</td>
        <td class="num" data-label="Volatilidad" title="Coeficiente de variación">${pct(s.cv, 1)}</td>
        <td data-label="Estado">${etiquetaEstado(s)}</td>
      </tr>`;
    }).join('')}
    </tbody>`;

  $$('#tabla-peajes tbody tr').forEach((tr) => tr.addEventListener('click', () => {
    S.peaje = S.data.peajes.find((p) => String(p.id) === tr.dataset.id);
    $("#sel-peaje").value = String(S.peaje.id);
    $$('.tab').find((t) => t.dataset.tab === 'estimacion').click();
    actualizarEstimacion();
  }));
  $$('#tabla-peajes th[data-campo]').forEach((h) => h.addEventListener('click', () => {
    const c = h.dataset.campo;
    if (S.ordenPeajes.campo === c) S.ordenPeajes.dir = S.ordenPeajes.dir === 'asc' ? 'desc' : 'asc';
    else S.ordenPeajes = { campo: c, dir: c === 'nombre' || c === 'departamento' || c === 'estado' ? 'asc' : 'desc' };
    renderPeajes();
  }));
}

function estadoOrden(s) {
  if (s.perfil.sombra) return 'sombra';
  if (s.perfil.cerrada) return 'cerrada';
  return 'activa';
}

function etiquetaEstado(s) {
  if (s.perfil.sombra) return '<span class="pill pill-warn">Conteo</span>';
  if (s.perfil.cerrada) return '<span class="pill pill-danger">Cerrada</span>';
  if (s.perfil.huecos > 0) return `<span class="pill pill-suave">Activa · ${s.perfil.huecos} huecos</span>`;
  return '<span class="pill pill-ok">Activa</span>';
}

/* ─────────────────────────────── validación ─────────────────────────────── */

function renderValidacion() {
  const fin = S.meses.length - 1;
  const corte = 119;
  const hz = fin - corte;
  const g = crecimientoNacional(S.totales, corte);
  $("#val-sub").textContent =
    `Entrenamiento: ${etiquetaLarga(0)} – ${etiquetaLarga(corte)} (${corte + 1} meses = primeros 10 años) · ` +
    `Prueba: ${etiquetaLarga(corte + 1)} – ${etiquetaLarga(fin)} (${hz} meses de los últimos años)`;

  // por modelo
  const filas = [];
  for (const [k, m] of Object.entries(MODELOS)) filas.push({ key: k, nombre: m.nombre, ...evaluarModelo(k, corte, fin, g) });

  const realTotal = new Array(hz).fill(0);
  for (let i = corte + 1; i <= fin; i++) realTotal[i - corte - 1] = S.totales[i];

  const mejor = filas.filter((f) => f.key !== 'holtwinters').sort((a, b) => (a.mapeMediana ?? 9) - (b.mapeMediana ?? 9))[0];
  const principal = filas.find((f) => f.key === S.modelo) ?? mejor;

  $("#val-kpis").innerHTML = [
    kpi('Modelo seleccionado', MODELOS[S.modelo].nombre,
      'Elegido por menor error mediano fuera de muestra', ''),
    kpi('Error mediano por estación (MAPE)', principal.mapeMediana != null ? pct(principal.mapeMediana, 1) : '—',
      'Promedio de los errores mensuales absolutos', ''),
    kpi('Error del total del sistema', principal.wmape != null ? pct(principal.wmape, 1) : '—',
      `Sesgo acumulado ${pctSigned(principal.sesgoTotal, 2)}`, principal.sesgoTotal ?? 0),
    kpi('Estaciones evaluadas', `${principal.nEstaciones}`,
      `de ${S.data.peajes.length} (excluye sin datos y cerradas)`, ''),
  ].join('');

  // total observado vs pronosticado en el período de prueba
  const sis = pronosticarSistema(S.data.peajes, S.totales, corte, hz, { modelo: S.modelo, gNacional: g });
  graficoSerie($("#chart-val-total"), {
    real: realTotal,
    proy: sis.total,
    desde: corte + 1,
    alto: 250,
    etiquetaY: moneyShort,
    superpuesto: true,
  });

  // error por año de prueba
  const porAnio = new Map();
  realTotal.forEach((r, k) => {
    const a = 2014 + Math.floor((corte + 1 + k) / 12);
    if (!porAnio.has(a)) porAnio.set(a, { real: 0, pred: 0 });
    const o = porAnio.get(a);
    o.real += r;
    o.pred += sis.total[k];
  });
  const anios = [...porAnio.entries()];
  barras($("#chart-val-error"), {
    valores: anios.map(([, o]) => (o.real > 0 ? (o.pred / o.real - 1) : 0)),
    etiquetas: anios.map(([a]) => String(a)),
    alto: 250,
    formato: (v) => pctSigned(v, 1),
  });

  // tabla de modelos
  $("#tabla-modelos").innerHTML = `
    <thead><tr>
      <th>Modelo</th><th>MAPE mediano</th><th>MAPE del total (WMAPE)</th><th>Sesgo del total</th>
      <th>R² del total</th><th>MAE mediano</th><th>Estaciones evaluadas</th>
    </tr></thead>
    <tbody>
    ${filas.map((f) => `<tr>
      <td><strong>${f.nombre}</strong>${f.key === S.modelo ? ' <span class="pill pill-accent">en uso</span>' : ''}</td>
      <td class="num">${f.mapeMediana != null ? pct(f.mapeMediana, 2) : '—'}</td>
      <td class="num">${f.wmape != null ? pct(f.wmape, 2) : '—'}</td>
      <td class="num ${f.sesgoTotal >= 0 ? 'pos' : 'neg'}">${pctSigned(f.sesgoTotal, 2)}</td>
      <td class="num">${f.r2 != null ? f.r2.toFixed(3) : '—'}</td>
      <td class="num">${f.maeMediano != null ? moneyShort(f.maeMediano) : '—'}</td>
      <td class="num">${f.nEstaciones}</td>
    </tr>`).join('')}
    </tbody>`;

  $("#nota-modelo").innerHTML =
    `El modelo <strong>${mejor.nombre}</strong> obtuvo el menor error mediano (${pct(mejor.mapeMediana, 2)}) al entrenarse con los primeros
     10 años y predecir los ${hz} meses siguientes. La aplicación lo usa por defecto; puede cambiarse en la pestaña
     <em>Estimación</em> para comparar. Los errores se calculan mes a mes por estación y luego se resume la mediana, de modo
     que unas pocas estaciones muy volátiles no oculten el desempeño general.`;

  S.validacion = { filas, corte, fin, hz, sis, realTotal, g };
  renderValidacionPeajes();
  renderCalidad();
}

function evaluarModelo(key, corte, fin, g) {
  const hz = fin - corte;
  const filas = [];
  const reales = new Array(hz).fill(0);
  const preds = new Array(hz).fill(0);
  for (const p of S.data.peajes) {
    const perfil = perfilSerie(p.recaudo.slice(0, corte + 1));
    if (perfil.nObservados === 0) continue;
    const real = p.recaudo.slice(corte + 1, fin + 1);
    if (real.every((v) => v == null)) continue;
    const r = pronosticar(p.recaudo, corte, hz, { modelo: key, gNacional: g });
    const m = metricas(real, r.pronostico);
    if (!m) continue;
    // Los meses sin reporte se tratan como recaudo cero en ambos lados para no
    // castigar a las estaciones que empezaron a reportar a mitad del período.
    const realCmp = real.map((v) => v ?? 0);
    const predCmp = r.pronostico ? r.pronostico.map((v) => v ?? 0) : null;
    filas.push({
      id: p.id,
      nombre: p.nombre,
      ...m,
      estado: r.estado,
      realTotal: realCmp.reduce((s, v) => s + v, 0),
      predTotal: predCmp ? predCmp.reduce((s, v) => s + v, 0) : 0,
    });
    realCmp.forEach((v, k) => {
      reales[k] += v;
      if (predCmp) preds[k] += predCmp[k];
    });
  }
  const mT = metricas(reales, preds);
  const mapes = filas.map((f) => f.mape).filter((v) => v != null).sort((a, b) => a - b);
  const maes = filas.map((f) => f.mae).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return {
    filas,
    mapeMediana: mapes.length ? mapes[mapes.length >> 1] : null,
    maeMediano: maes.length ? maes[maes.length >> 1] : null,
    wmape: mT?.wmape ?? null,
    sesgoTotal: mT?.sesgoTotal ?? 0,
    r2: mT?.r2 ?? null,
    nEstaciones: filas.length,
  };
}

function renderValidacionPeajes() {
  const modo = $("#filtro-val").value;
  const filas = S.validacion.filas.find((f) => f.key === S.modelo)?.filas ?? [];
  let lista = filas.filter((f) => f.mape != null && f.realTotal > 0);
  lista.sort((a, b) => b.mape - a.mape);
  if (modo === 'peores') lista = lista.slice(0, 25);
  else if (modo === 'mejores') lista = lista.slice(-25).reverse();

  $("#tabla-val-peajes").innerHTML = `
    <thead><tr>
      <th>Estación</th><th>Estado</th><th>MAPE</th><th>MAE mensual</th>
      <th>Real del período</th><th>Pronosticado</th><th>Desviación</th>
    </tr></thead>
    <tbody>
    ${lista.map((f) => `<tr class="clic" data-id="${f.id}">
      <td data-label="Estación">${f.nombre}</td>
      <td class="muted" data-label="Estado">${f.estado}</td>
      <td class="num" data-label="MAPE">${pct(f.mape, 2)}</td>
      <td class="num" data-label="MAE mensual">${moneyShort(f.mae)}</td>
      <td class="num" data-label="Real del período" title="${money(f.realTotal)}">${moneyShort(f.realTotal)}</td>
      <td class="num" data-label="Pronosticado" title="${money(f.predTotal)}">${moneyShort(f.predTotal)}</td>
      <td class="num ${f.sesgoTotal >= 0 ? 'pos' : 'neg'}" data-label="Desviación">${pctSigned(f.sesgoTotal, 2)}</td>
    </tr>`).join('')}
    </tbody>`;
  $$('#tabla-val-peajes tbody tr').forEach((tr) => tr.addEventListener('click', () => {
    S.peaje = S.data.peajes.find((p) => String(p.id) === tr.dataset.id);
    $("#sel-peaje").value = String(S.peaje.id);
    $$('.tab').find((t) => t.dataset.tab === 'estimacion').click();
    actualizarEstimacion();
  }));
}

function renderCalidad() {
  const total = S.data.peajes.length;
  const sombra = S.stats.filter((s) => s.perfil.sombra).length;
  const cerradas = S.stats.filter((s) => !s.perfil.sombra && s.perfil.cerrada).length;
  const activas = total - sombra - cerradas;
  const conHuecos = S.stats.filter((s) => s.perfil.huecos > 0).length;
  const huecos = S.stats.reduce((s, x) => s + x.perfil.huecos, 0);
  const cortas = S.stats.filter((s) => s.n < 24).length;
  const ceros = S.stats.reduce((s, x) => s + x.ceros, 0);
  const filas = [
    ['Estaciones en el archivo', num(total), 'Peajes y estaciones de conteo reportadas por la ANI.'],
    ['Con recaudo activo', num(activas), 'Serie con reportes recientes y recaudo positivo.'],
    ['Estaciones de conteo (peaje sombra)', num(sombra), 'Registran tráfico pero no recaudo; se proyectan en cero.'],
    ['Cerradas o con reversión', num(cerradas), 'Dejaron de reportar antes del último mes; se proyectan en cero.'],
    ['Series cortas (< 24 meses)', num(cortas), 'Usan un modelo estacional simplificado.'],
    ['Estaciones con huecos internos', num(conHuecos), `Total de ${num(huecos)} meses sin reporte dentro de la serie.`],
    ['Meses con recaudo cero', num(ceros), 'Suspensiones del cobro o novedades operativas con tráfico registrado.'],
  ];
  $("#calidad-datos").innerHTML = `<table class="tabla">
    <thead><tr><th>Indicador</th><th>Valor</th><th>Descripción</th></tr></thead>
    <tbody>${filas.map(([a, b, c]) => `<tr><td>${a}</td><td class="num">${b}</td><td class="texto" style="text-align:left;white-space:normal">${c}</td></tr>`).join('')}</tbody>
  </table>`;
}

/* ──────────────────────────────── reporte ───────────────────────────────── */

/** Construye el HTML del reporte de la estación seleccionada (sin abrir el modal). */
function construirReporteActual() {
  const p = S.peaje;
  if (!p) return null;
  const fin = S.meses.length - 1;
  const corteVal = S.CORTE_ENTRENAMIENTO; // validación: primeros 10 años
  const corteEst = S.corte; // base elegida para la estimación
  const stats = S.stats.find((s) => s.peaje.id === p.id);
  const g = S.usarAuto ? S.gNacionalAuto : S.gNacional;
  const est = pronosticar(p.recaudo, corteEst, S.horizonte, { modelo: S.modelo, gNacional: g });

  const hz = fin - corteVal;
  let comparacion = null;
  let metricasComp = null;
  if (hz > 0) {
    const estComp = pronosticar(p.recaudo, corteVal, hz, { modelo: S.modelo, gNacional: crecimientoNacional(S.totales, corteVal) });
    const realObs = p.recaudo.slice(corteVal + 1, fin + 1);
    const pred = estComp.pronostico;
    metricasComp = metricas(realObs, pred);
    comparacion = {
      realObs,
      pred,
      pares: realObs.map((r, k) => ({ abs: corteVal + 1 + k, real: r, pred: pred?.[k], errPct: r > 0 && pred?.[k] != null ? Math.abs(pred[k] / r - 1) : null })),
    };
  }

  const ranking = (() => {
    const totales = S.data.peajes
      .map((x) => ({ id: x.id, v: x.recaudo.reduce((s, q) => s + (q ?? 0), 0) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    const totalSistema = totales.reduce((s, x) => s + x.v, 0);
    const idx = totales.findIndex((x) => x.id === p.id);
    if (idx < 0 || totalSistema <= 0) return null;
    return { posicion: idx + 1, total: totales.length, participacion: totales[idx].v / totalSistema };
  })();

  return construirReporte({
    peaje: { ...p, mix: p.mix },
    mesCorte: corteEst,
    mesFinal: fin,
    config: { inicioPrueba: corteVal + 1, corteValidacion: corteVal },
    stats,
    anuales: stats.anual,
    estacional: estacionalidad(p.recaudo, stats.hasta),
    estimacion: est,
    comparacion,
    metricasComp,
    ranking,
    totalSistema: S.totales.reduce((s, v) => s + v, 0),
    gNacional: g,
    modeloNombre: MODELOS[S.modelo].nombre,
    datosMeta: S.data.meta,
    baseEntrenamiento: S.base === 'entrenamiento',
  });
}

function abrirReporte() {
  const html = construirReporteActual();
  if (!html) return;
  S.ultimoReporte = { html, titulo: `Reporte de recaudo · ${S.peaje.nombre}` };
  $("#reporte").innerHTML = html;
  $("#modal-reporte").hidden = false;
  $("#modal-reporte .modal-body").scrollTop = 0;
  toast('Reporte generado');
}

function descargarReporteHTML() {
  if (!S.ultimoReporte) { toast('Genere primero el reporte'); return; }
  const doc = documentoCompleto(S.ultimoReporte.titulo, S.ultimoReporte.html);
  const nombre = `reporte-${S.peaje.slug}-${fechaHoy().replace(/\s/g, '-')}.html`;
  descargar(nombre, doc, 'text/html;charset=utf-8');
  toast('Reporte descargado');
}

/* ─────────────────────────────── exportaciones ──────────────────────────── */

function exportarEstimacionCSV() {
  if (!S.estimacion?.pronostico) { toast('No hay estimación para exportar'); return; }
  const filas = [['Peaje', 'IdPeaje', 'Base', 'Mes', 'Estimacion', 'Observado']];
  S.estimacion.pronostico.forEach((v, k) => {
    const i = S.corte + 1 + k;
    filas.push([S.peaje.nombre, S.peaje.id, S.base, etiquetaCorta(i), Math.round(v), p_i(S.peaje.recaudo[i])]);
  });
  descargar(`estimacion-${S.peaje.slug}.csv`, '\ufeff' + toCSV(filas), 'text/csv;charset=utf-8');
  toast('CSV de estimación descargado');
}

function p_i(v) {
  return v == null ? '' : v;
}

function exportarTotalCSV() {
  if (!S.sistema) { toast('No hay estimación del sistema'); return; }
  const filas = [['Peaje', 'IdPeaje', 'Departamento', 'Estado', ...Array.from({ length: S.horizonte }, (_, k) => etiquetaCorta(S.corte + 1 + k)), 'Total']];
  for (const d of S.sistema.detalle) {
    const peaje = S.data.peajes.find((x) => x.id === d.id);
    const vals = d.pronostico ? d.pronostico.map((v) => Math.round(v)) : new Array(S.horizonte).fill(0);
    filas.push([d.nombre, d.id, peaje?.departamento ?? '', d.estado, ...vals, vals.reduce((a, b) => a + b, 0)]);
  }
  const tot = new Array(S.horizonte).fill(0);
  S.sistema.total.forEach((v, k) => { tot[k] = Math.round(v); });
  filas.push(['TOTAL SISTEMA', '', '', '', ...tot, tot.reduce((a, b) => a + b, 0)]);
  descargar('estimacion-total-sistema.csv', '\ufeff' + toCSV(filas), 'text/csv;charset=utf-8');
  toast('CSV del total descargado');
}

function exportarPeajesCSV() {
  const filas = [[
    'IdPeaje', 'Peaje', 'Departamento', 'Municipio', 'Proyecto', 'Meses con reporte', 'Recaudo acumulado',
    'Promedio mensual', 'Mediana', 'Desviacion estandar', 'CV', 'Minimo', 'Maximo', 'CAGR', 'Var 12 meses', 'Estado',
  ]];
  for (const s of S.peajesFiltrados) {
    const p = s.peaje;
    filas.push([
      p.id, p.nombre, p.departamento, p.municipio, p.proyecto, s.n, Math.round(s.suma ?? 0),
      Math.round(s.promedio ?? 0), Math.round(s.mediana ?? 0), Math.round(s.desv ?? 0),
      s.cv != null ? (s.cv * 100).toFixed(2) : '', Math.round(s.min ?? 0), Math.round(s.max ?? 0),
      s.cagr != null ? (s.cagr * 100).toFixed(2) : '', s.yoy != null ? (s.yoy * 100).toFixed(2) : '',
      estadoOrden(s),
    ]);
  }
  descargar('resumen-estadistico-peajes.csv', '\ufeff' + toCSV(filas), 'text/csv;charset=utf-8');
  toast(`${S.peajesFiltrados.length} estaciones exportadas`);
}

/* ──────────────────────────────── utilidades ────────────────────────────── */

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

document.addEventListener('DOMContentLoaded', iniciar);
