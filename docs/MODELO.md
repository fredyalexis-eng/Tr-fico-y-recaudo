# TollCast — Estimación interactiva del recaudo por peaje

Aplicación web interactiva (HTML + JavaScript, sin dependencias externas) que estima el
recaudo mensual de **cada una de las 163 estaciones de peaje de Colombia** y del
**total del sistema**, entrena el modelo con los **primeros 10 años** de la serie, deja los
**últimos años como prueba** y genera un **reporte de análisis por peaje**.

Datos: *Resumen Mensual por estación de Peaje Tráfico y Recaudo 2014 a ago 2026* —
Agencia Nacional de Infraestructura (ANI), Operación Estadística de Tráfico y Recaudo (OETR).

---

## 1. Cómo ejecutarla

### Opción A — servidor local (recomendado)

```bash
python3 serve.py            # http://localhost:8000
python3 serve.py 8080       # otro puerto
```

### Opción B — abrir el archivo directamente

Abra `web/index.html` en el navegador. La aplicación detecta que `fetch()` está bloqueado
en `file://` y carga los datos desde `web/js/data.js`.

### Opción C — cualquier servidor estático

```bash
cd web && python3 -m http.server 8000
```

> Si se modifica el archivo de Excel, regenere los datos con
> `python3 tools/build_data.py` (requiere `pandas` y `openpyxl`).

---

## 2. Qué hace la aplicación

| Pestaña | Contenido |
|---|---|
| **Panorama** | KPIs del sistema, recaudo mensual 2014–2026 con tendencia ajustada, recaudo anual, top 15 peajes, recaudo por departamento, concentración (HHI), crecimiento y composición vehicular. |
| **Estimación** | Selección de peaje, horizonte (6–24 meses), modelo, crecimiento anual y base de estimación. Entrega pronóstico mensual, métricas de validación contra lo observado, resumen estadístico, estacionalidad y **estimación del total del sistema** con las 163 estaciones. Exporta CSV. |
| **Peajes** | Tabla ordenable y filtrable con el **resumen estadístico de las 163 estaciones** (meses, acumulado, promedio, CAGR, variación 12 meses, volatilidad, estado). Clic en una fila abre su análisis. Exporta CSV. |
| **Validación** | Entrenamiento con los primeros 10 años vs prueba 2024–2026: KPIs de error, observado vs pronosticado del sistema, error por año, **comparación de 5 modelos**, desempeño por estación y diagnóstico de calidad de datos. |
| **Reporte** | Botón *Generar reporte del peaje*: documento de 8 secciones con resumen ejecutivo, perfil, estadísticos, evolución, estacionalidad, estimación, validación y recomendaciones. Se puede **imprimir / guardar como PDF** o **descargar como HTML autónomo**. |

### Cálculo del recaudo total

El total del sistema es la **suma del pronóstico de cada estación** (no el pronóstico
agregado), de modo que el total y sus partes son consistentes.

### Estados especiales de las estaciones

| Estado | Tratamiento |
|---|---|
| Operación normal | Modelo completo |
| Serie corta (< 18 meses con dato) | Modelo estacional con crecimiento |
| Estación de conteo (*peaje sombra*) | Recaudo proyectado = 0 (registra tráfico, no cobra) |
| Cerrada / revertida (sin reportes recientes) | Recaudo proyectado = 0 |

---

## 3. Metodología del modelo

### 3.1 Datos

* 172 634 registros de detalle → **163 estaciones** × **152 meses** (ene-2014 … ago-2026).
* Serie mensual de recaudo total, tráfico total, evasores, exentos y tarifa por categoría.
* Agregación por `IdPeaje × mes` (se suman las 55 categorías tarifarias).

### 3.2 Entrenamiento y prueba

* **Entrenamiento:** ene-2014 … dic-2023 = **120 meses = los primeros 10 años**.
* **Prueba:** ene-2024 … ago-2026 = **32 meses = los últimos años**.

El corte es fijo para la validación; los gráficos del período de prueba muestran
observado vs pronosticado en el mismo eje para visualizar el error.

### 3.3 Modelo

Para cada estación se ajusta, sobre los meses con recaudo positivo:

```
log(recaudo_t) = a + b·t + Σ_k c_k · 1[mes = k] + ε_t
```

* `t` = índice temporal → `exp(b·12) − 1` es la **tasa de crecimiento anual**.
* 11 variables dummy mensuales → **estacionalidad**.
* Estimación por **mínimos cuadrados reponderados (Huber, c = 1.345)**: los meses
  atípicos (paros, COVID-19, cierres) reciben menor peso.
* La forma logarítmica evita pronósticos negativos y estabiliza la varianza.

Estaciones con menos de 18 meses de datos usan un modelo **estacional + crecimiento**:
factores estacionales por media móvil centrada de 12 meses y crecimiento mezclado con
el crecimiento nacional.

### 3.4 Crecimiento nacional de referencia

Regresión log-lineal robusta sobre el recaudo total del sistema en una ventana de
48 meses, excluyendo mar-2020 … jun-2021 (choque COVID-19).

### 3.5 Selección del modelo (honesta)

Los cinco modelos se evalúan con **el mismo entrenamiento y el mismo período de prueba**;
se elige el de menor MAPE mediano por estación. Resultado con el corte 2023-12:

| Modelo | MAPE mediano | WMAPE | Sesgo del total | R² |
|---|---|---|---|---|
| **Regresión log-lineal robusta** (en uso) | **11,83 %** | 0,51 % | −3,85 % | 0,72 |
| Ingenuo estacional | 13,66 % | 0,52 % | −7,63 % | 0,42 |
| Estacional + crecimiento | 13,78 % | 0,54 % | −8,63 % | 0,27 |
| Media móvil anual | 20,83 % | 0,74 % | −15,76 % | — |
| Holt-Winters amortiguado | 21,64 % | 0,83 % | −19,54 % | — |

Métricas por estación: MAPE, WMAPE, MAE, RMSE, R² y sesgo acumulado.

### 3.6 Reproducibilidad

`tools/validate_models.mjs` re-ejecuta todo el *backtest* con el mismo motor que usa el
navegador y lo compara contra una referencia calculada en Python
(`tools/referencia_python.json`). La diferencia entre ambos es < 0,1 %.

```bash
node tools/validate_models.mjs
```

### 3.7 Limitaciones

* Pesos corrientes: no se deflactan (el crecimiento incluye inflación).
* Cambios tarifarios discrecionales, nuevas concesiones, reversiones de peajes u obras
  no se anticipan con la serie histórica.
* Las estaciones cerradas se proyectan en cero; si el cierre fuese temporal, el
  pronóstico subestimaría su potencial.
* Es un análisis estadístico: no constituye una proyección oficial de la ANI.

---

## 4. Estructura del proyecto

```
8. Resumen Mensual ... .xlsx      Fuente original (ANI)
serve.py                          Servidor local
tools/
  build_data.py                   Excel → web/data.json + web/js/data.js
  validate_models.mjs             Backtest reproducible del motor JS
  referencia_python.json          Referencia numérica (Python)
  test_app.mjs                    Pruebas de humo (jsdom) de la interfaz
web/
  index.html                      Interfaz
  css/styles.css                  Estilos (claro/oscuro, responsive, impresión)
  js/forecast.js                  Motor: ajuste robusto, modelos, métricas, backtest
  js/stats.js                     Estadística descriptiva y estacionalidad
  js/charts.js                    Gráficos SVG interactivos (sin librerías)
  js/reporte.js                   Generador del reporte de análisis
  js/format.js                    Formatos es-CO (pesos, porcentajes, fechas)
  js/app.js                       Lógica de la interfaz
  js/data.js                      Datos autocontenidos (uso con file://)
  data.json                       Datos de la aplicación (0,55 MB)
docs/MODELO.md                    Este documento
```

## 5. Pruebas

```bash
node tools/validate_models.mjs   # coherencia del motor y del backtest
node tools/test_app.mjs          # render de las 4 pestañas, interacciones y reporte
```

`tools/test_app.mjs` requiere `jsdom` (`npm install jsdom esbuild`).
