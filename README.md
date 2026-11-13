# TollCast — Estimación interactiva del recaudo por peaje

Aplicación **HTML + JavaScript** (sin dependencias ni build) para **estimar el recaudo de cada
estación de peaje de Colombia y el total del sistema**, usando los datos mensuales de la
Agencia Nacional de Infraestructura (ANI), Operación Estadística de Tráfico y Recaudo (OETR).

* **Entrenamiento:** los **primeros 10 años** (ene-2014 → dic-2023, 120 meses).
* **Prueba:** los **últimos años** (ene-2024 → ago-2026, 32 meses).
* **Resumen estadístico** de las 163 estaciones (acumulado, promedio, mediana, cuartiles,
  volatilidad, CAGR, estacionalidad, valores atípicos…).
* **Botón de reporte** que genera un documento de análisis para el peaje seleccionado,
  imprimible como PDF o descargable como HTML.

## Inicio rápido

```bash
# 1) servidor local (recomendado)
python3 serve.py                # abre http://localhost:8000

# 2) o simplemente abra web/index.html en el navegador
```

Si actualiza el archivo de Excel, regenere los datos (requiere `pandas` y `openpyxl`):

```bash
pip install --break-system-packages pandas openpyxl
python3 tools/build_data.py
```

## Contenido

| Pestaña | Qué encuentra |
|---|---|
| **Panorama** | KPIs del sistema, serie mensual 2014–2026 con tendencia ajustada, recaudo anual, top 15 peajes, recaudo por departamento, concentración (HHI) y composición vehicular. |
| **Estimación** | Selección de peaje, horizonte (6–24 meses), modelo, crecimiento y base de estimación. Pronóstico mensual, validación contra lo observado, resumen estadístico, estacionalidad y **estimación del total del sistema**. |
| **Peajes** | Tabla ordenable/filtrable con el **resumen estadístico de las 163 estaciones**. |
| **Validación** | Entrenamiento con 10 años vs prueba 2024–2026, comparación de 5 modelos, error por año, desempeño por estación y calidad de datos. |
| **Reporte** | Botón *Generar reporte del peaje*: 8 secciones con resumen ejecutivo, perfil, estadísticos, evolución, estacionalidad, estimación, validación y recomendaciones. |

## Modelo

Regresión **log-lineal robusta** (mínimos cuadrados reponderados de Huber) por estación:

```
log(recaudo_t) = a + b·t + Σ c_k·1[mes = k]
```

Seleccionada por menor error mediano fuera de muestra frente a otros cuatro modelos.
En el período de prueba: **MAPE mediano 11,8 %**, **WMAPE 0,5 %** y **R² 0,72** para el total
del sistema. Detalle metodológico completo en [`docs/MODELO.md`](docs/MODELO.md).

## Pruebas

```bash
node tools/validate_models.mjs   # coherencia del motor y del backtest
npm install jsdom esbuild
node tools/test_app.mjs          # interfaz: 4 pestañas, interacciones y reporte
```

## Estructura

```
serve.py                Servidor local
tools/build_data.py     Excel → web/data.json + web/js/data.js
tools/validate_models.mjs  Backtest reproducible (Node)
tools/test_app.mjs      Pruebas de la interfaz (jsdom)
web/index.html          Interfaz
web/css/styles.css      Estilos (claro/oscuro, responsive, impresión)
web/js/forecast.js      Motor estadístico y modelos
web/js/stats.js         Estadística descriptiva y estacionalidad
web/js/charts.js        Gráficos SVG interactivos
web/js/reporte.js       Generador del reporte
web/js/app.js           Lógica de la interfaz
docs/MODELO.md          Metodología y resultados
```

> Los pronósticos son estimaciones estadísticas en pesos corrientes; no constituyen
> proyecciones oficiales de la ANI.
