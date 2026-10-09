/** Number formatting for the Sound panel (pure). */

/** Digit grouping exactly as the app header writes it (Intl, en-GB): 1819 -> "1,819". */
const GROUPING = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** Frequency with the unit that reads best, from nHz (alpha's cycle) to kHz; never exponent notation. */
export function fmtHz(hz) {
  if (!(hz > 0)) return '—';
  if (hz >= 999.95) return `${(hz / 1000).toFixed(hz >= 9995 ? 1 : 2)} kHz`;
  if (hz >= 99.995) return `${hz.toFixed(1)} Hz`;
  if (hz >= 0.9995) return `${hz.toFixed(2)} Hz`;
  for (const [k, unit] of [[1e3, 'mHz'], [1e6, 'µHz'], [1e9, 'nHz']]) {
    const v = hz * k; // the first unit in which the number is at least 1 (rounded): 1.00 .. 999
    if (v >= 0.9995 || unit === 'nHz') return `${v.toPrecision(3)} ${unit}`;
  }
}

/** Group digits with commas, like the header: 4547 -> "4,547". */
export const fmtInt = (n) => GROUPING.format(Math.round(n));

/** "4.50" -> "4.5", "2.00" -> "2": drop trailing zeros of a fixed-point string. */
const trim = (str) => (str.includes('.') ? str.replace(/0+$/, '').replace(/\.$/, '') : str);

/**
 * Time-lapse rate as the header shows it: "×1", "×4,547", "×2.63 M", "×1.82 G", "−×60" for backwards.
 * Slow motion keeps two significant digits ("×0.011"), so a locked tempo never reads "×0.0".
 */
export function fmtRate(rate) {
  if (rate === 0) return 'paused';
  const a = Math.abs(rate);
  const sign = rate < 0 ? '−' : '';
  let body;
  if (a >= 9.995e8) body = `${(a / 1e9).toFixed(a >= 9.995e9 ? 1 : 2)} G`;
  else if (a >= 1e6) body = `${(a / 1e6).toFixed(a >= 9.995e6 ? 1 : 2)} M`;
  else if (a >= 100) body = fmtInt(a);
  else if (a >= 10) body = a.toFixed(0);
  else if (a >= 1) body = trim(a.toFixed(1));
  else body = trim(a.toFixed(Math.min(12, 1 - Math.floor(Math.log10(a)))));
  return `${sign}×${body}`;
}

/**
 * Length of a cycle in the one unit that fits, rounded to three digits: "72.1 y", "16.2 d", "33.7 min",
 * "1.68 min", "311 ms". (core/format duration() with one part floors: 1 min 41 s would read "1 min".)
 */
export function fmtPeriod(s) {
  if (!(s > 0) || !Number.isFinite(s)) return '—';
  const three = (v, unit) => `${+v.toPrecision(3)} ${unit}`;
  if (s < 0.9995) return `${Math.round(s * 1000)} ms`;
  if (s < 60) return three(s, 's');
  if (s < 3600) return three(s / 60, 'min');
  if (s < 86400) return three(s / 3600, 'h');
  if (s < 31557600) return three(s / 86400, 'd');
  return three(s / 31557600, 'y');
}

/** Real seconds as "4.00 s", "0.44 s", "120 ms", "2.0 min". */
export function fmtSeconds(s) {
  if (!Number.isFinite(s)) return '—';
  if (s < 0.1) return `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)} ms`;
  if (s < 10) return `${s.toFixed(2)} s`;
  if (s < 100) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

/** Like fmtSeconds without the trailing zeros: "4 s", "0.5 s", "10 s", "2 min", "44 ms". */
export const fmtSecondsShort = (s) => fmtSeconds(s).replace(/\.0+(?= )/, '').replace(/(\.\d)0(?= )/, '$1');

/** "−18 dB" with a true minus sign. */
export const fmtDb = (db) => `${db < 0 ? '−' : db > 0 ? '+' : ''}${Math.abs(Math.round(db))} dB`;

/** Signed octave shift: "−1 oct", "+2 oct", "0 oct". */
export const fmtOct = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n)} oct`;
