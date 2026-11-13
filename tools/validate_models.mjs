// Valida el motor JS contra los resultados de referencia de Python.
// Uso: node tools/validate_models.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODELOS, MODELO_POR_DEFECTO, backtest, crecimientoNacional, perfilSerie, pronosticarSistema,
} from '../web/js/forecast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/data.json'), 'utf8'));
const meses = data.meta.mesesISO;
const idx = (iso) => meses.indexOf(iso);
const fmt = (v) => (v / 1e12).toFixed(3) + ' B$';

const corte = idx('2023-12'); // primeros 10 años
const fin = meses.length - 1;

console.log(`Datos: ${data.meta.nPeajes} peajes · ${meses[0]} … ${meses.at(-1)}`);
console.log(`Entrenamiento: ${meses[0]} … ${meses[corte]} (${corte + 1} meses)`);
console.log(`Prueba:        ${meses[corte + 1]} … ${meses.at(-1)} (${fin - corte} meses)\n`);

const resultados = [];
for (const [key, mod] of Object.entries(MODELOS)) {
  const r = backtest(data.peajes, data.totales.recaudo, corte, fin, { modelo: key });
  const medMape = r.filas.map((f) => f.mape).filter((v) => v != null);
  medMape.sort((a, b) => a - b);
  const mediana = medMape[medMape.length >> 1];
  const wmape = r.filas.reduce((s, f) => s + f.mae, 0) / r.filas.reduce((s, f) => s + f.realTotal, 0);
  const errTot = r.total.metricas.sesgoTotal;
  resultados.push({ key, nombre: mod.nombre, mediana, wmape, errTot, n: r.filas.length });
  console.log(
    `${mod.nombre.padEnd(30)} n=${String(r.filas.length).padStart(3)} ` +
    `MAPE med=${(mediana * 100).toFixed(2)}%  WMAPE=${(wmape * 100).toFixed(2)}%  ` +
    `sesgo total=${(errTot * 100).toFixed(2)}%  R²=${(r.total.metricas.r2 ?? 0).toFixed(3)}`,
  );
}

const mejor = resultados.filter((r) => r.key !== 'holtwinters').sort((a, b) => a.mediana - b.mediana)[0];
console.log(`\nMejor modelo por MAPE mediano: ${mejor.nombre}`);
console.log(`Modelo por defecto en la app: ${MODELO_POR_DEFECTO}`);
if (mejor.key !== MODELO_POR_DEFECTO) {
  console.error(`⚠ El modelo por defecto (${MODELO_POR_DEFECTO}) no es el mejor (${mejor.key}).`);
}

const g = crecimientoNacional(data.totales.recaudo, corte);
console.log(`\nCrecimiento nacional estimado al corte: ${(g * 100).toFixed(2)}% anual`);

// Proyección a futuro con todo el histórico disponible
const corteHoy = meses.length - 1;
const sis = pronosticarSistema(data.peajes, data.totales.recaudo, corteHoy, 12);
console.log(`\nProyección 12 meses desde ${meses[corteHoy]}:`);
console.log(`  Total sistema: ${fmt(sis.total.reduce((s, v) => s + v, 0))}`);
console.log(`  Crecimiento nacional usado: ${(sis.gNacional * 100).toFixed(2)}%`);
const estados = {};
for (const d of sis.detalle) estados[d.estado] = (estados[d.estado] ?? 0) + 1;
console.log('  Estados:', estados);

// Comparación contra referencia Python (si existe)
const ref = path.join(__dirname, 'referencia_python.json');
if (fs.existsSync(ref)) {
  const esperado = JSON.parse(fs.readFileSync(ref, 'utf8'));
  const okG = Math.abs(esperado.gNacional - g) < 1e-9;
  const predTotal = sis.total.reduce((s, v) => s + v, 0);
  const errProy = Math.abs(esperado.proyeccion12 - predTotal) / esperado.proyeccion12;
  console.log(`\nReferencia Python: g=${esperado.gNacional.toFixed(6)} proy=${fmt(esperado.proyeccion12)}`);
  console.log(`  g coincide: ${okG ? 'SÍ' : 'NO'} · diferencia proyección: ${(errProy * 100).toFixed(4)}%`);
  if (!okG || errProy > 0.001) process.exitCode = 1;
}

// Perfil de la serie de un peaje de ejemplo
const ej = data.peajes.find((p) => p.nombre === 'ALVARADO');
if (ej) console.log('\nEjemplo ALVARADO:', perfilSerie(ej.recaudo));
