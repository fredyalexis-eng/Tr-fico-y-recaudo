// Pruebas de humo de la interfaz con jsdom.
// Requiere:  npm install jsdom esbuild
// Uso:       node tools/test_app.mjs
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');

const bundle = await esbuild.build({
  entryPoints: [path.join(WEB, 'js/app.js')],
  bundle: true, write: false, format: 'iife', target: 'es2020', logLevel: 'silent',
});
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
  .replace(/<script type="module".*?><\/script>/, '');

const errores = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errores.push(e.message));

const dom = new JSDOM(html, {
  url: 'http://localhost:8000/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
});
const { window } = dom;
window.fetch = async (u) => {
  const f = path.join(WEB, String(u).replace(/^\.?\//, ''));
  if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
  const txt = fs.readFileSync(f, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};
window.print = () => {};
const descargas = [];
window.HTMLAnchorElement.prototype.click = function () { if (this.download) descargas.push(this.download); };

window.eval(bundle.outputFiles[0].text);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
await esperar(400);

const d = window.document;
let fallos = 0;
const ok = (cond, msg) => {
  if (!cond) fallos++;
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
};
const txt = (sel) => (d.querySelector(sel)?.textContent ?? '').trim();
const nSvg = (sel) => d.querySelectorAll(`${sel} svg`).length;

console.log('PANORAMA');
ok(txt('#fuente-corta').includes('163'), 'cabecera con las 163 estaciones');
ok(d.querySelectorAll('#kpis-panorama .kpi').length === 4, '4 KPIs');
ok(nSvg('#chart-sistema') === 1, 'gráfico del sistema');
ok(nSvg('#chart-anual') === 1, 'gráfico anual');
ok(d.querySelectorAll('#top-peajes .hbar').length === 15, 'top 15 peajes');
ok(d.querySelectorAll('#top-departamentos .hbar').length === 23, '23 departamentos');
ok(nSvg('#card-mix') === 1, 'dona de categorías vehiculares');

console.log('ESTIMACIÓN');
ok(txt('#est-titulo').includes('ALVARADO'), 'peaje por defecto');
ok(d.querySelectorAll('#est-kpis .kpi').length === 4, '4 KPIs de la estimación');
ok(nSvg('#chart-estimacion') === 1, 'gráfico observado + pronóstico');
ok(d.querySelectorAll('#tabla-estimacion tbody tr').length === 12, '12 meses proyectados');
ok(nSvg('#chart-comparacion') === 1, 'gráfico del período de prueba');
ok(d.querySelectorAll('#est-stats div').length === 14, '14 estadísticos');
ok(nSvg('#chart-estacional') === 1, 'estacionalidad');
ok(d.querySelectorAll('#tabla-total tbody tr').length === 21, 'total del sistema + top 20');
ok(/^\$/.test(txt('#total-kpis .kpi-value')), 'total del sistema calculado');

console.log('PEAJES');
ok(d.querySelectorAll('#tabla-peajes tbody tr').length === 163, '163 filas');

console.log('VALIDACIÓN');
ok(d.querySelectorAll('#tabla-modelos tbody tr').length === 5, '5 modelos comparados');
ok(d.querySelectorAll('#tabla-val-peajes tbody tr').length === 25, '25 estaciones con mayor error');
ok(d.querySelectorAll('#calidad-datos tbody tr').length === 7, 'diagnóstico de calidad');
ok(nSvg('#chart-val-total') === 1, 'observado vs pronosticado');
ok(nSvg('#chart-val-error') === 1, 'error por año');

console.log('INTERACCIÓN');
const sel = d.querySelector('#sel-peaje');
sel.value = '63';
sel.dispatchEvent(new window.Event('change'));
await esperar(60);
ok(txt('#est-titulo').includes('ALTO PINO'), 'cambio de peaje');

const sh = d.querySelector('#sel-horizonte');
sh.value = '24';
sh.dispatchEvent(new window.Event('change'));
await esperar(60);
ok(d.querySelectorAll('#tabla-estimacion tbody tr').length === 24, 'horizonte de 24 meses');

const sm = d.querySelector('#sel-modelo');
sm.value = 'holtwinters';
sm.dispatchEvent(new window.Event('change'));
await esperar(60);
ok(d.querySelectorAll('#tabla-estimacion tbody tr').length === 24, 'cambio de modelo');
sm.value = 'loglineal';
sm.dispatchEvent(new window.Event('change'));
await esperar(40);

const sb = d.querySelector('#sel-base');
sb.value = 'entrenamiento';
sb.dispatchEvent(new window.Event('change'));
await esperar(80);
ok(txt('#hint-base').includes('2023'), 'base de entrenamiento (primeros 10 años)');
ok(d.querySelectorAll('#tabla-estimacion thead th').length === 4, 'columna de dato observado visible');
sb.value = 'ultimo';
sb.dispatchEvent(new window.Event('change'));
await esperar(60);
ok(d.querySelectorAll('#tabla-estimacion thead th').length === 3, 'sin columna observada con datos recientes');

const rg = d.querySelector('#rng-crec');
rg.value = '4';
rg.dispatchEvent(new window.Event('input'));
await esperar(60);
ok(txt('#out-crec').includes('4,0'), 'crecimiento manual');

console.log('REPORTE');
d.querySelector('#btn-reporte').click();
await esperar(120);
const rep = d.querySelector('#reporte');
ok(!d.querySelector('#modal-reporte').hidden, 'modal abierto');
ok(rep.innerHTML.length > 8000, `documento generado (${rep.innerHTML.length} caracteres)`);
ok(rep.querySelectorAll('h2').length === 8, '8 secciones');
ok(rep.querySelectorAll('table').length >= 4, 'tablas del reporte');
ok(rep.querySelectorAll('svg').length >= 4, 'gráficos del reporte');
d.querySelector('#btn-descargar-rep').click();
await esperar(60);
ok(descargas.some((n) => n.endsWith('.html')), 'descarga del reporte en HTML');

console.log('EXPORTACIONES');
d.querySelector('#btn-export-csv').click();
d.querySelector('#btn-csv-total').click();
d.querySelector('#btn-csv-peajes').click();
await esperar(60);
ok(descargas.filter((n) => n.endsWith('.csv')).length === 3, 'tres archivos CSV');

console.log('FILTROS');
const bus = d.querySelector('#buscar-peaje');
bus.value = 'bogot';
bus.dispatchEvent(new window.Event('input'));
await esperar(40);
ok(d.querySelectorAll('#tabla-peajes tbody tr').length === 13, 'búsqueda de texto');
bus.value = '';
bus.dispatchEvent(new window.Event('input'));
await esperar(30);

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`}`);
if (errores.length) console.log('Errores de ejecución:\n' + errores.join('\n'));
process.exitCode = fallos === 0 && errores.length === 0 ? 0 : 1;
