/**
 * Offline audio verification of the sonification engine ("our ears").
 *
 * Renders the real engine (src/audio/engine.js) with an OfflineAudioContext inside headless Chromium
 * and analyses the samples in Node: non-silence, NaN / clipping, spectral peaks at the tuned
 * frequencies, the amplitude-modulation rate of the fast levels, the chime strum of a known cycle end,
 * the chord of "hear this moment", clean jumps, the limiter on a dense mix.
 *
 *   node tools/checks/check-sound-audio.mjs        (exit code 1 when a check fails)
 */
import { withApp } from '../browse.mjs';

// ---------------------------------------------------------------------------------------------
// tiny DSP helpers
// ---------------------------------------------------------------------------------------------
function fft(re, im) {
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
    const ang = (-2 * Math.PI) / len;
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
}
/** Magnitude spectrum (linear amplitude of a full-scale sine = 1) of x[start, start+n), Hann window. */
function spectrum(x, sr, start, n) {
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
const peakAt = (sp, f, tol = 3) => {
  let m = 0;
  const lo = Math.max(1, Math.floor((f - tol) / sp.df));
  const hi = Math.ceil((f + tol) / sp.df);
  for (let k = lo; k <= hi; k++) m = Math.max(m, sp.mag[k] ?? 0);
  return m;
};
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const peakAbs = (x, a = 0, b = x.length) => {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
};
const decode = (b64) => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

// ---------------------------------------------------------------------------------------------
// renderer running inside the page
// ---------------------------------------------------------------------------------------------
async function renderInPage(page, job) {
  return page.evaluate(async (job) => {
    const { createEngine } = await import('/src/audio/engine.js');
    const w = window.__fractonica;
    const sr = 48000;
    const clk = { t0: job.t0, rate: job.rate };
    const log = [];
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * job.seconds), sr);
    const eng = createEngine({
      model: w.model,
      clock: { t: () => clk.t0, rate: () => clk.rate },
      createContext: () => ctx,
      settings: job.settings,
      log,
    });
    const jumps = (job.jumps ?? []).map((j) => ({
      at: j.at,
      apply: () => {
        if (j.t !== undefined) clk.t0 = j.t;
        if (j.rate !== undefined) clk.rate = j.rate;
      },
    }));
    const t0 = performance.now();
    const buf = await eng.renderOffline(job.seconds, { continuous: job.continuous !== false, momentAt: job.momentAt ?? null, jumps });
    const ms = performance.now() - t0;
    const enc = (f32) => {
      const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return {
      sr,
      ms,
      L: enc(buf.getChannelData(0)),
      R: enc(buf.getChannelData(1)),
      log,
      freqs: eng.tuning.map((r, L) => eng.frequency(L)),
    };
  }, job);
}

const VECTOR_A = 1791460800;
const ETA_END = 1791464172.428;
const only = (levels) => Array.from({ length: 14 }, (_, L) => levels.includes(L));

await withApp(async ({ page, url, errors }) => {
  await page.goto(url('?t=1791460800&view=rings'));
  await page.waitForFunction(() => window.__fractonica?.model, null, { timeout: 15000 });

  // -------------------------------------------------------------------------------------------
  console.log('\n[1] drone at vector A, paused: tuned pitches, loudness follows the phase');
  {
    const settings = { chimes: false, levels: only([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), reverb: 0, volumeDb: -18 };
    const r = await renderInPage(page, { t0: VECTOR_A, rate: 0, seconds: 4, settings });
    const L = decode(r.L);
    const R = decode(r.R);
    const nan = [...L, ...R].filter((v) => !Number.isFinite(v)).length;
    check(nan === 0, 'no NaN or Infinity in the render');
    const pk = Math.max(peakAbs(L), peakAbs(R));
    check(pk > 0.002 && pk < 0.7, 'audible but safe peak', `${db(pk).toFixed(1)} dBFS`);
    check(rms(L, 24000) > 0.001, 'not silent', `RMS ${db(rms(L, 24000)).toFixed(1)} dBFS`);
    const sp = spectrum(L, r.sr, 48000, 131072);
    const w = await page.evaluate(
      async (t) => {
        const m = window.__fractonica.model;
        const tri = (p) => (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4);
        return Array.from({ length: 12 }, (_, L) => tri(m.levelAt(t, L).phase));
      },
      VECTOR_A,
    );
    // peaks at each tuned frequency whose cycle is not near its valley; relative level follows loudness^
    let found = 0;
    const rows = [];
    for (let Lv = 0; Lv < 12; Lv++) {
      const f = r.freqs[Lv];
      const a = peakAt(sp, f, 2.5);
      const loud = ((Math.max(-1, Math.min(1, w[Lv])) + 1) / 2) ** 1.6;
      rows.push(`depth ${String(Lv + 1).padStart(2)}  ${f.toFixed(1).padStart(7)} Hz  x=${w[Lv].toFixed(2).padStart(5)}  loud=${loud.toFixed(3)}  spectrum ${db(a).toFixed(1)} dB`);
      if (loud > 0.05) {
        // a loud-enough voice must stand clearly above the spectral floor
        const floor = (() => {
          let s = 0;
          let n = 0;
          for (let k = 0; k < sp.mag.length; k++) {
            const hz = k * sp.df;
            if (hz > f * 1.06 && hz < f * 1.5) {
              s += sp.mag[k];
              n++;
            }
          }
          return s / Math.max(1, n);
        })();
        if (a > 5 * floor) found++;
        else console.log('   weak:', Lv + 1, db(a), db(floor));
      }
    }
    console.log(rows.map((x) => '   ' + x).join('\n'));
    const expectLoud = w.filter((x) => ((x + 1) / 2) ** 1.6 > 0.05).length;
    check(found === expectLoud, 'every audible voice shows a spectral peak at its tuned frequency', `${found}/${expectLoud}`);
    // the valley voice is much quieter than a peak-ish voice (loudness follows the glyph wave)
    const order = [...w.keys()].sort((a, b) => w[a] - w[b]);
    const quiet = order[0];
    const loudest = order.at(-1);
    const wq = ((w[quiet] + 1) / 2) ** 1.6 * 1;
    const wl = ((w[loudest] + 1) / 2) ** 1.6;
    console.log(`   quietest depth ${quiet + 1} (loud ${wq.toFixed(3)}), loudest depth ${loudest + 1} (loud ${wl.toFixed(3)})`);
    check(db(peakAt(sp, r.freqs[loudest], 3.5)) > db(peakAt(sp, r.freqs[quiet], 3.5)) + 20, 'the loudest cycle is far above the quietest (loudness follows the glyph wave)');
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[2] amplitude modulation at the true cycle rate of the fast levels');
  for (const [Lv, hz, secs] of [[13, 22.51, 2], [12, 3.216, 4], [11, 0.643, 6]]) {
    const settings = { chimes: false, levels: only([Lv]), reverb: 0, volumeDb: -6 };
    const r = await renderInPage(page, { t0: VECTOR_A, rate: 1, seconds: secs, settings });
    const x = decode(r.L);
    // envelope: rectify, average over ~2.5 carrier periods, remove DC
    const f0 = r.freqs[Lv];
    const win = Math.max(8, Math.round((2.5 * r.sr) / f0));
    const start = Math.round(0.3 * r.sr);
    const n = 1 << Math.floor(Math.log2(x.length - start - win));
    const env = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < win; i++) acc += Math.abs(x[start + i]);
    for (let i = 0; i < n; i++) {
      env[i] = acc / win;
      acc += Math.abs(x[start + i + win]) - Math.abs(x[start + i]);
    }
    let mean = 0;
    let eMin = Infinity;
    let eMax = -Infinity;
    for (let i = 0; i < n; i++) {
      mean += env[i] / n;
      eMin = Math.min(eMin, env[i]);
      eMax = Math.max(eMax, env[i]);
    }
    for (let i = 0; i < n; i++) env[i] -= mean;
    const sp = spectrum(env, r.sr, 0, n);
    let bestK = 0;
    for (let k = 2; k < Math.min(sp.mag.length, Math.floor(200 / sp.df)); k++) if (sp.mag[k] > sp.mag[bestK]) bestK = k;
    const found = bestK * sp.df;
    check(Math.abs(found - hz) < Math.max(0.12, hz * 0.04), `depth ${Lv + 1} AM rate`, `expected ${hz} Hz, measured ${found.toFixed(2)} Hz, depth ${((100 * (eMax - eMin)) / (eMax + eMin)).toFixed(0)} %`);
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[3] a cycle end is a strummed chord of every finer cycle');
  {
    const settings = { chord: false, chimes: true, levels: only([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), reverb: 0, volumeDb: -18 };
    const r = await renderInPage(page, { t0: ETA_END - 0.5, rate: 1, seconds: 4, settings });
    const x = decode(r.L);
    const end = r.log.filter((n) => n.kind === 'end' && Math.abs(n.when - 0.5) < 0.2);
    check(end.length === 6, 'depth-7 end strums depths 7..12', end.map((n) => n.level + 1).join(','));
    const onsets = end.map((n) => n.when);
    check(onsets.every((t, i) => i === 0 || Math.abs(t - onsets[i - 1] - 0.015) < 2e-3), 'notes are ~15 ms apart, coarse to fine');
    const before = rms(x, 0, Math.round(0.45 * r.sr));
    const during = rms(x, Math.round(0.52 * r.sr), Math.round(0.9 * r.sr));
    console.log(`   RMS before the end ${db(before).toFixed(1)} dBFS, during the strum ${db(during).toFixed(1)} dBFS`);
    const sp = spectrum(x, r.sr, Math.round(0.52 * r.sr), 32768);
    let hits = 0;
    for (const n of end) {
      const a = peakAt(sp, n.f, 3);
      if (db(a) > -80) hits++;
      console.log(`   depth ${n.level + 1}: bell at ${n.f.toFixed(1)} Hz, spectrum ${db(a).toFixed(1)} dB`);
    }
    check(hits === 6, 'every strummed note is in the spectrum', `${hits}/6`);
    check(during > 5 * before, 'the turnover is clearly louder than the quiet before it', `${(during / before).toFixed(1)}x`);
    // a lone bell (a peak of a minor level) is far smaller than a big chord
    const single = r.log.filter((n) => n.kind !== 'end');
    const big = r.log.filter((n) => n.kind === 'end').reduce((s, n) => s + n.amp, 0);
    console.log(`   scheduled bells: ${r.log.length}; sum of end amplitudes ${big.toFixed(3)}, a lone bell ${single.length ? single[0].amp.toFixed(3) : 'n/a'}`);
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[4] hear this moment: the chord of vector A as an arpeggio');
  {
    const settings = { chimes: true, chord: true, levels: only([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), reverb: 0.2, volumeDb: -18 };
    const r = await renderInPage(page, { t0: VECTOR_A, rate: 1, seconds: 5, settings, continuous: false, momentAt: VECTOR_A });
    const x = decode(r.L);
    const pk = peakAbs(x);
    check(pk > 0.002 && pk < 0.7, 'audible, below full scale', `${db(pk).toFixed(1)} dBFS`);
    check(rms(x, 0, Math.round(0.04 * r.sr)) < 1e-4, 'silent until the first note');
    const last = r.log.at(-1);
    const ring = rms(x, Math.round((last.when + 0.3) * r.sr), Math.round((last.when + 0.9) * r.sr));
    const end = rms(x, Math.round(4.8 * r.sr));
    check(ring > 0 && end < ring * 0.05, 'the last note rings out and the room tail fades', `${db(ring).toFixed(1)} dBFS -> ${db(end).toFixed(1)} dBFS`);
    check(r.log.length === 12 && r.log.every((n, i) => i === 0 || n.when > r.log[i - 1].when), 'twelve notes ascending in time (alpha -> mu)');
    const span = r.log.at(-1).when - r.log[0].when;
    check(span > 1.5 && span < 3.2, 'arpeggio spans a few seconds', `${span.toFixed(2)} s`);
    const tail = rms(x, Math.round(4.8 * r.sr));
    console.log(`   tail RMS at 4.8 s: ${db(tail).toFixed(1)} dBFS`);
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[5] a jump in time is click-free');
  {
    const settings = { chimes: false, levels: only([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), reverb: 0, volumeDb: -18 };
    const jump = await renderInPage(page, { t0: VECTOR_A, rate: 1, seconds: 3, settings, jumps: [{ at: 1.5, t: 946684800 }] });
    const still = await renderInPage(page, { t0: VECTOR_A, rate: 1, seconds: 3, settings });
    const maxStep = (x, a, b) => {
      let m = 0;
      for (let i = a + 2; i < b; i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]));
      return m;
    };
    const xj = decode(jump.L);
    const xs = decode(still.L);
    const around = [Math.round(1.45 * jump.sr), Math.round(1.7 * jump.sr)];
    const far = [Math.round(0.8 * jump.sr), Math.round(1.3 * jump.sr)];
    const jStep = maxStep(xj, ...around);
    const sStep = maxStep(xs, ...far);
    const differs = Math.abs(rms(xj, Math.round(2 * jump.sr)) - rms(xs, Math.round(2 * jump.sr))) > 1e-5;
    check(jStep < 2.5 * sStep + 1e-4, 'second difference around the jump stays within the normal range', `${jStep.toExponential(2)} vs ${sStep.toExponential(2)}`);
    check(differs, 'the chord really changed after the jump (new balance of voices)');
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[6] dense mix: all layers, all depths, x3600 time-lapse; the limiter keeps it below 0 dBFS');
  {
    const settings = { chord: true, chimes: true, physical: true, physShift: 0, levels: only([...Array(14).keys()]), floor: 0.03, reverb: 0.5, volumeDb: -3 };
    const r = await renderInPage(page, { t0: VECTOR_A, rate: 20000, seconds: 8, settings });
    const L = decode(r.L);
    const R = decode(r.R);
    const nan = [...L, ...R].filter((v) => !Number.isFinite(v)).length;
    const pk = Math.max(peakAbs(L), peakAbs(R));
    check(nan === 0, 'no NaN');
    check(pk < 0.99, 'peak below 0 dBFS even at the loudest setting', `${db(pk).toFixed(2)} dBFS, ${r.log.length} bells, rendered in ${r.ms.toFixed(0)} ms`);
    const quiet = await renderInPage(page, { t0: VECTOR_A, rate: 20000, seconds: 8, settings: { ...settings, volumeDb: -18, physical: false, reverb: 0.22 } });
    const q = decode(quiet.L);
    const qpk = peakAbs(q);
    console.log(`   default loudness: peak ${db(qpk).toFixed(1)} dBFS, RMS ${db(rms(q, 24000)).toFixed(1)} dBFS`);
    check(qpk < 0.5, 'default settings leave plenty of headroom', `${db(qpk).toFixed(1)} dBFS`);
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[7] physical register: true cycle rates as triangle waves');
  {
    const settings = { chord: false, chimes: false, physical: true, physShift: -1, reverb: 0, volumeDb: -6 };
    const r = await renderInPage(page, { t0: VECTOR_A, rate: 1, seconds: 3, settings });
    const x = decode(r.L);
    const sp = spectrum(x, r.sr, 48000, 65536);
    const want = [247.65 / 2, 2228.9 / 2, 8915.4 / 2];
    const names = ['omicron', 'pi', 'rho'];
    want.forEach((f, i) => check(db(peakAt(sp, f, 3)) > -70, `${names[i]} at ${f.toFixed(1)} Hz`, `${db(peakAt(sp, f, 3)).toFixed(1)} dB`));
  }

  const own = errors.filter((e) => /src\/(audio|ui\/sound)|sound\.js|engine\.js|schedule\.js|tuning\.js/.test(e));
  check(own.length === 0, 'no console errors from the sound files', own.join(' | '));
  const other = errors.filter((e) => !own.includes(e));
  if (other.length) console.log('(errors from other modules, ignored):', other.length);
}, { viewport: { width: 1200, height: 800 } });

console.log(failures ? `\n${failures} check(s) failed` : '\nall audio checks passed');
process.exit(failures ? 1 : 0);
