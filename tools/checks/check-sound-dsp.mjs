/**
 * Small DSP helpers shared by the offline sound checks (tools/checks/check-sound-*.mjs): FFT, magnitude spectrum,
 * band-limited envelopes, Sethares dissonance. Pure functions, no browser.
 */

export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

/** Magnitude spectrum (linear amplitude of a full-scale sine = 1) of x[start, start+n), Hann window. */
export function spectrum(x, sr, start, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re[i] = (x[start + i] ?? 0) * w;
    wsum += w;
  }
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = (2 * Math.hypot(re[k], im[k])) / wsum;
  return { mag, df: sr / n };
}

/** Largest magnitude within +-tol Hz of f. */
export function peakAt(sp, f, tol = 3) {
  let m = 0;
  const lo = Math.max(1, Math.floor((f - tol) / sp.df));
  const hi = Math.ceil((f + tol) / sp.df);
  for (let k = lo; k <= hi; k++) m = Math.max(m, sp.mag[k] ?? 0);
  return m;
}

/** Frequency (Hz) of the strongest bin between lo and hi. */
export function dominant(sp, lo = 40, hi = 8000) {
  let best = 0;
  for (let k = Math.max(1, Math.floor(lo / sp.df)); k < Math.min(sp.mag.length, Math.ceil(hi / sp.df)); k++) if (sp.mag[k] > sp.mag[best]) best = k;
  return best * sp.df;
}

export const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
export const decode = (b64) => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};
export const percentile = (arr, p) => {
  const s = [...arr].sort((u, v) => u - v);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

/**
 * Envelope of x[a, b) band-limited to [lo, hi] Hz: Tukey window (flat in the middle), zero-phase FFT mask
 * on the positive frequencies, analytic-signal magnitude. Look at the middle of the result only.
 */
export function bandEnvelope(x, sr, lo, hi, a, b) {
  const m = b - a;
  const n = 1 << Math.ceil(Math.log2(m));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const r = Math.floor(m * 0.12);
  for (let i = 0; i < m; i++) {
    const w = i < r ? 0.5 - 0.5 * Math.cos((Math.PI * i) / r) : i >= m - r ? 0.5 - 0.5 * Math.cos((Math.PI * (m - 1 - i)) / r) : 1;
    re[i] = x[a + i] * w;
  }
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const f = k <= n / 2 ? (k * sr) / n : ((k - n) * sr) / n;
    const g = f >= lo && f <= hi ? 2 : 0;
    re[k] *= g;
    im[k] *= g;
  }
  fft(re, im, true);
  const env = new Float64Array(m);
  for (let i = 0; i < m; i++) env[i] = Math.hypot(re[i], im[i]);
  return env;
}

/** Peak-to-valley swing (dB, 2nd to 98th percentile) of the middle 70 % of an envelope. */
export function swingDb(env) {
  const q = Math.floor(env.length * 0.15);
  const mid = env.subarray(q, env.length - q);
  return db(percentile(mid, 0.98)) - db(percentile(mid, 0.02));
}

/** Sethares (1993) sensory dissonance of partials [{f, a}]: the Plomp-Levelt curve summed over all pairs. */
export function dissonance(partials) {
  let d = 0;
  for (let i = 0; i < partials.length; i++) {
    for (let j = i + 1; j < partials.length; j++) {
      const p = partials[i];
      const q = partials[j];
      const s = 0.24 / (0.021 * Math.min(p.f, q.f) + 19);
      const df = Math.abs(p.f - q.f);
      d += p.a * q.a * (Math.exp(-3.5 * s * df) - Math.exp(-5.75 * s * df));
    }
  }
  return d;
}
