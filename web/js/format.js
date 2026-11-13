/* Utilidades de formato — locale es-CO */

export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : d === 1 ? nf1.format(v) : d === 2 ? nf2.format(v) : nf0.format(v));

/** Pesos colombianos completos: $ 3.390.595.400 */
export const money = (v) => (v == null || !Number.isFinite(v) ? '—' : `$ ${nf0.format(Math.round(v))}`);

/** Pesos abreviados: $3,39 B / $339,1 mil M / $12,4 M */
export function moneyShort(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return `${s}$${nf2.format(a / 1e12)} B`;
  if (a >= 1e9) return `${s}$${nf1.format(a / 1e9)} mil M`;
  if (a >= 1e6) return `${s}$${nf1.format(a / 1e6)} M`;
  if (a >= 1e3) return `${s}$${nf0.format(a / 1e3)} mil`;
  return `${s}$${nf0.format(a)}`;
}

/** Número abreviado genérico: 1,2 M · 340 mil */
export function numShort(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf2.format(v / 1e9)} mil M`;
  if (a >= 1e6) return `${nf2.format(v / 1e6)} M`;
  if (a >= 1e3) return `${nf1.format(v / 1e3)} mil`;
  return nf0.format(v);
}

export const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${d === 1 ? nf1.format(v * 100) : nf2.format(v * 100)} %`);
export const pctSigned = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d).replace('.', ',')} %`);

export const mesCorto = (idx) => MESES_CORTOS[idx % 12];
export const mesLargo = (idx) => MESES_LARGOS[idx % 12];

/** índice global → "mar 2021" */
export const etiquetaCorta = (i) => `${mesCorto(i)} ${2014 + Math.floor(i / 12)}`;
/** índice global → "marzo de 2021" */
export const etiquetaLarga = (i) => `${mesLargo(i)} de ${2014 + Math.floor(i / 12)}`;
/** índice global → "2021-03" */
export const isoDe = (i) => `${2014 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
/** índice global → año */
export const anioDe = (i) => 2014 + Math.floor(i / 12);

export function fechaHoy() {
  return new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Descarga un archivo de texto desde el navegador. */
export function descargar(nombre, contenido, tipo = 'text/plain;charset=utf-8') {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(filas) {
  return filas
    .map((f) => f.map((c) => {
      const s = c == null ? '' : String(c);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';'))
    .join('\n');
}
