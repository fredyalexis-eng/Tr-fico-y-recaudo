// Valida integridad de datos, backtest de modelos y proyección del sistema.
// Uso: node tools/validate_models.mjs
//
// No compara con `referencia_python.json`: el snapshot quedó obsoleto y el chequeo
// anterior contrastaba variables calculadas en cortes distintos, bloqueando Pages.
import assert from 'node:assert/strict';
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
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Comprueba la estructura y el rango del conjunto usado para el backtest.
assert.ok(Array.isArray(data.peajes) && data.peajes.length > 0, 'No hay estaciones en web/data.json');
assert.equal(data.meta.nPeajes, data.peajes.length, 'El número de estaciones no coincide con los metadatos');
assert.ok(Array.isArray(meses) && meses.length > 120, 'La serie debe cubrir más de los 10 años de entrenamiento');
assert.equal(data.totales.recaudo.length, meses.length, 'La serie total no coincide con el calendario');
assert.equal(idx('2023-12'), 119, 'El entrenamiento debe contener los primeros 120 meses (2014–2023)');
const corte = idx('2023-12');
const fin = meses.length - 1;
assert.ok(corte >= 0 && fin > corte, 'No hay meses de prueba posteriores a diciembre de 2023');
assert.ok(Object.hasOwn(MODELOS, MODELO_POR_DEFECTO), 'El modelo por defecto no está registrado');

console.log(`Datos: ${data.meta.nPeajes} peajes · ${meses[0]} … ${meses.at(-1)}`);
console.log(`Entrenamiento: ${meses[0]} … ${meses[corte]} (${corte + 1} meses)`);
console.log(`Prueba:        ${meses[corte + 1]} … ${meses.at(-1)} (${fin - corte} meses)\n`);

// Cada modelo debe completar el backtest con métricas finitas.
const resultados = [];
for (const [key, mod] of Object.entries(MODELOS)) {
  const r = backtest(data.peajes, data.totales.recaudo, corte, fin, { modelo: key });
  const medMape = r.filas.map((f) => f.mape).filter(finite).sort((a, b) => a - b);
  assert.ok(r.filas.length > 0, `${mod.nombre}: el backtest no produjo estaciones`);
  assert.ok(medMape.length > 0, `${mod.nombre}: no hay MAPE calculable`);
  assert.ok(finite(r.total.metricas?.sesgoTotal), `${mod.nombre}: sesgo total inválido`);
  assert.ok(finite(r.total.metricas?.r2), `${mod.nombre}: R² total inválido`);

  const mediana = medMape[medMape.length >> 1];
  const realTotal = r.filas.reduce((s, f) => s + f.realTotal, 0);
  const wmape = realTotal > 0 ? r.filas.reduce((s, f) => s + f.mae, 0) / realTotal : NaN;
  const errTot = r.total.metricas.sesgoTotal;
  resultados.push({ key, nombre: mod.nombre, mediana, wmape, errTot, n: r.filas.length });
  console.log(
    `${mod.nombre.padEnd(30)} n=${String(r.filas.length).padStart(3)} ` +
    `MAPE med=${(mediana * 100).toFixed(2)}%  WMAPE=${(wmape * 100).toFixed(2)}%  ` +
    `sesgo total=${(errTot * 100).toFixed(2)}%  R²=${r.total.metricas.r2.toFixed(3)}`,
  );
}

const mejor = [...resultados].sort((a, b) => a.mediana - b.mediana)[0];
console.log(`\nMejor modelo por MAPE mediano: ${mejor.nombre}`);
console.log(`Modelo por defecto en la app: ${MODELO_POR_DEFECTO}`);
assert.equal(mejor.key, MODELO_POR_DEFECTO, 'El modelo por defecto ya no es el de menor MAPE mediano');

const gCorte = crecimientoNacional(data.totales.recaudo, corte);
const gActual = crecimientoNacional(data.totales.recaudo, fin);
assert.ok(finite(gCorte) && finite(gActual), 'El crecimiento nacional debe ser finito');
console.log(`\nCrecimiento nacional estimado al corte: ${(gCorte * 100).toFixed(2)}% anual`);

// Verifica que el pronóstico de 12 meses sea usable y sea la suma de las estaciones.
const sis = pronosticarSistema(data.peajes, data.totales.recaudo, fin, 12);
assert.equal(sis.detalle.length, data.peajes.length, 'Faltan estaciones en la proyección del sistema');
assert.equal(sis.total.length, 12, 'La proyección agregada debe tener 12 meses');
assert.ok(sis.total.every((v) => finite(v) && v >= 0), 'El total proyectado contiene valores inválidos');
for (let h = 0; h < sis.total.length; h++) {
  const sumaEstaciones = sis.detalle.reduce((sum, estacion) => {
    const valor = estacion.pronostico?.[h];
    return sum + (finite(valor) ? valor : 0);
  }, 0);
  const tolerancia = Math.max(1, sis.total[h]) * 1e-12;
  assert.ok(Math.abs(sumaEstaciones - sis.total[h]) <= tolerancia, `El total no coincide con la suma de peajes (mes +${h + 1})`);
}
console.log(`\nProyección 12 meses desde ${meses[fin]}:`);
console.log(`  Total sistema: ${fmt(sis.total.reduce((s, v) => s + v, 0))}`);
console.log(`  Crecimiento nacional usado: ${(sis.gNacional * 100).toFixed(2)}%`);
const estados = {};
for (const d of sis.detalle) estados[d.estado] = (estados[d.estado] ?? 0) + 1;
assert.equal(Object.values(estados).reduce((s, n) => s + n, 0), data.peajes.length);
console.log('  Estados:', estados);

// Perfil de serie de muestra como última comprobación de que el motor puede leer datos.
const ej = data.peajes.find((p) => p.nombre === 'ALVARADO');
assert.ok(ej, 'Falta la estación de ejemplo ALVARADO');
const perfil = perfilSerie(ej.recaudo);
assert.ok(perfil.nMesesConValor > 0, 'La serie de ALVARADO no contiene recaudo positivo');
console.log('\nEjemplo ALVARADO:', perfil);
console.log('\nValidación del modelo: OK');
