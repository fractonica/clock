/**
 * Offline verification of the sound-design decisions of the Sound module ("our ears", second pass).
 *
 *   node tools/checks/check-sound-design.mjs        (exit code 1 when a check fails)
 *
 * Each section measures one decision on the real engine, rendered with an OfflineAudioContext in headless
 * Chromium and analysed here, or on the tuning table directly:
 *   [1] 2nd harmonics left out where they would land within 120 cents of another sounding voice, and
 *       zeta (depth 6) an octave higher: Sethares dissonance of the default chord
 *   [2] the beats that came from those partials (and the 26 Hz delta-zeta pair) are gone from the render
 *   [3] AM cross-fade 25..32 Hz: voices that used to sit at 35-43 Hz rest at a steady mean loudness,
 *       the true 22.5 Hz heartbeat of xi stays
 *   [4] the valley bell is an octave below the peak bell for every depth (spectrum of the rendered bells)
 *   [5] bell density at the defaults (floor 0.5 s) and in the All preset
 *   [6] a saturated polyphony cap still rings every note of the biggest strum
 */
import { withApp } from '../browse.mjs';
import { spectrum, peakAt, dominant, db, decode, bandEnvelope, swingDb, dissonance } from './check-sound-dsp.mjs';
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';
import { buildTuning, frequencyOf, weightFor, clashingHarmonics, chimeFrequency, OCTAVES, CLASH_CENTS } from '../../src/audio/tuning.js';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const only = (levels) => Array.from({ length: 14 }, (_, L) => levels.includes(L));
const model = createModel();
const rows = buildTuning(model);
const freqs = rows.map((r) => frequencyOf(r, 110));
const LETTER = rows.map((r) => r.letter);

// ---------------------------------------------------------------------------------------------
console.log('\n[1] tuning: clashing 2nd harmonics and the register');
{
  const def = rows.map((_, L) => L < 12);
  const skip = clashingHarmonics(freqs, def);
  const cents = (a, b) => 1200 * Math.log2(a / b);
  const list = [];
  freqs.forEach((f, i) => {
    if (!def[i]) return;
    freqs.forEach((g, j) => {
      if (i !== j && def[j] && Math.abs(cents(2 * f, g)) < CLASH_CENTS) list.push(`2f(${LETTER[i]}) ${(2 * f).toFixed(1)} vs ${LETTER[j]} ${g.toFixed(1)}: ${cents(2 * f, g).toFixed(0)}¢ (${Math.abs(2 * f - g).toFixed(1)} Hz)`);
    });
  });
  console.log(list.map((x) => '   ' + x).join('\n'));
  console.log('   2nd harmonic left out for:', skip.map((s, L) => (s ? `${LETTER[L]}(${L + 1})` : null)).filter(Boolean).join(' '));
  check(JSON.stringify(skip.map((s, L) => (s ? L + 1 : 0)).filter(Boolean)) === '[1,2,3,6,8,9,10]', 'default chord: depths 1, 2, 3, 6, 8, 9, 10 lose their 2f (alpha beta gamma zeta theta iota kappa)');
  check(Math.abs(freqs[5] - 611.0) < 0.1 && Math.abs(freqs[3] - 279.3) < 0.1 && Math.abs(freqs[1] - 137.5) < 0.01, 'zeta 611.0 Hz (was 305.5), delta 279.3 Hz, beta stays 137.5 Hz');
  check(Math.max(...freqs) < 3000.5, 'highest voice about 3 kHz', `${Math.max(...freqs).toFixed(1)} Hz`);

  const partials = (octaves, harmonics) => {
    const f = rows.map((r, L) => 110 * Math.pow(2, (r.pcCents + 1200 * octaves[L]) / 1200));
    const sk = clashingHarmonics(f, def);
    const out = [];
    rows.forEach((_, L) => {
      if (!def[L]) return;
      const a = weightFor(f[L]);
      out.push({ f: f[L], a }, { f: f[L] + 0.15, a: 0.14 * a });
      if (harmonics === 'all' || (harmonics === 'safe' && !sk[L])) out.push({ f: 2 * f[L], a: 0.1 * a });
    });
    return dissonance(out);
  };
  const OLD = [0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4];
  const base = partials(OLD, 'all');
  const pct = (v) => (100 * (v / base - 1)).toFixed(1) + ' %';
  const a = partials(OLD, 'safe');
  const b = partials(OCTAVES, 'all');
  const ab = partials(OCTAVES, 'safe');
  const none = partials(OCTAVES, 'none');
  console.log(`   Sethares dissonance, default chord at full loudness: before ${base.toFixed(3)}; (a) only ${pct(a)}; zeta moved only ${pct(b)}; both ${pct(ab)}; no 2f at all ${pct(none)}`);
  check(ab < 0.68 * base && ab > 0.58 * base, 'both changes lower the roughness by about a third (audit: -37 %)', pct(ab));
  check(a < 0.93 * base, 'dropping the clashing partials alone helps (audit: -12 %)', pct(a));
  check(b < 0.78 * base, 'moving zeta alone helps (audit: -27 %)', pct(b));
}

// ---------------------------------------------------------------------------------------------
async function renderInPage(page, job) {
  return page.evaluate(async (job) => {
    const { createEngine } = await import('/src/audio/engine.js');
    const w = window.__fractonica;
    const sr = 48000;
    const clk = { t0: job.t0, rate: job.rate };
    const log = [];
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * job.seconds), sr);
    const eng = createEngine({ model: w.model, clock: { t: () => clk.t0, rate: () => clk.rate }, createContext: () => ctx, settings: job.settings, log });
    const buf = await eng.renderOffline(job.seconds, { continuous: job.continuous !== false });
    const f32 = buf.getChannelData(0);
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { sr, L: btoa(s), log, skipped: eng.skippedHarmonics(), freqs: eng.tuning.map((r, L) => eng.frequency(L)) };
  }, job);
}

await withApp(async ({ page, url, errors }) => {
  await page.goto(url('?t=1791460800&view=rings'));
  await page.waitForFunction(() => window.__fractonica?.model, null, { timeout: 15000 });

  // -------------------------------------------------------------------------------------------
  console.log('\n[2] the beats that belonged to no cycle are gone (default chord, chimes off, reverb 0, paused, 5 instants)');
  {
    const instants = [1791460800, 946684800, 2886085800, 1234567890, 3100000000];
    // each band holds at most one fundamental now; before, it also held a 2f partial or the 26 Hz delta-zeta partner
    // (measured on the previous engine at these instants: 5.9 2.0 11.8 1.8 17.5 dB for 270-315 Hz, 1.1 2.9 7.3 4.8 5.2 dB for 215-230 Hz,
    //  2.7 3.3 24.8 3.5 1.2 dB for 1880-1930 Hz, 4.9 1.3 5.5 4.6 1.7 dB for 2350-2410 Hz, 1.7 1.1 3.6 1.5 1.3 dB for 270-285 Hz)
    const bands = [
      ['delta 270-315 Hz (was delta + zeta 26 Hz apart)', 270, 315],
      ['alpha 2f / gamma 215-230 Hz (3.4 Hz beat)', 215, 230],
      ['beta 2f / delta 270-285 Hz (4.3 Hz beat)', 270, 285],
      ['iota 2f / lambda 1880-1930 Hz (29.5 Hz beat)', 1880, 1930],
      ['kappa 2f / mu 2350-2410 Hz (36.9 Hz beat)', 2350, 2410],
    ];
    const worst = new Map(bands.map((b) => [b[0], 0]));
    for (const t0 of instants) {
      const r = await renderInPage(page, { t0, rate: 0, seconds: 3, settings: { chimes: false, reverb: 0 } });
      const x = decode(r.L);
      for (const [name, lo, hi] of bands) worst.set(name, Math.max(worst.get(name), swingDb(bandEnvelope(x, r.sr, lo, hi, 48000, 48000 * 2.5))));
    }
    // a lone voice still swings up to 20 log10(1.14 / 0.86) = 2.45 dB: its chorus partner (0.14 amplitude, 0.15 Hz away)
    for (const [name, v] of worst) check(v < 2.5, `${name}: envelope swing ${v.toFixed(2)} dB at the worst of 5 instants`, 'at most the slow 0.15 Hz chorus swing of one voice (2.45 dB)');
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[3] AM cross-fade: a voice that used to buzz at 35-43 Hz is steady; the 22.5 Hz heartbeat stays');
  {
    const swing = async (L, rate, secs = 2) => {
      const r = await renderInPage(page, { t0: 1791460800, rate, seconds: secs, settings: { chimes: false, reverb: 0, volumeDb: -6, levels: only([L]) } });
      const x = decode(r.L);
      const f0 = r.freqs[L];
      return swingDb(bandEnvelope(x, r.sr, f0 - 120, f0 + 120, 24000, 24000 + 48000 * 1.4));
    };
    // (depth, preset rate): mu x60 38.6 Hz, kappa x3600 35.6 Hz, theta x86400 42.8 Hz (AM weights 0.83 / 0.89 / 0.74 with the
    // old 30..80 Hz cross-fade; measured then: envelope swings of 21.1, 24.7 and 15.5 dB, i.e. a rough ~90 % modulation)
    for (const [L, rate, hz] of [[11, 60, 38.6], [9, 3600, 35.6], [7, 86400, 42.8]]) {
      const v = await swing(L, rate);
      check(v < 1.0, `depth ${L + 1} at x${rate} (${hz} Hz in real time): steady, envelope swing ${v.toFixed(2)} dB`, 'was ~90 % modulation depth');
    }
    const xi = await swing(13, 1, 3);
    check(xi > 12, 'depth 14 at x1 keeps its true 22.5 Hz modulation', `${xi.toFixed(1)} dB swing`);
    const nu = await swing(12, 1, 3);
    check(nu > 12, 'depth 13 keeps its 3.2 Hz heartbeat', `${nu.toFixed(1)} dB swing`);
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[4] the valley bell is an octave below the peak bell, for every depth (spectrum of rendered bells)');
  {
    // each level alone, slowed so that its cycle lasts 1.2 s: a quarter (peak, node, valley, end) every 0.3 s
    for (let L = 0; L < 14; L++) {
      const mean = model.levelInfo(L).meanSeconds;
      const r = await renderInPage(page, { t0: 1791460800, rate: mean / 1.2, seconds: 4, settings: { chord: false, chimes: true, reverb: 0, volumeDb: -6, floor: 0.12, levels: only([L]) } });
      const x = decode(r.L);
      const peak = r.log.find((n) => n.kind === 'peak');
      const valley = r.log.find((n) => n.kind === 'valley');
      if (!peak || !valley) {
        check(false, `depth ${L + 1}: a peak and a valley bell in the render`, r.log.map((n) => n.kind).join(','));
        continue;
      }
      const want = chimeFrequency(r.freqs[L], 'peak');
      const exact = Math.abs(peak.f - want) < 1e-9 && Math.abs(valley.f - want / 2) < 1e-9;
      // the strongest spectral line right after the strike is the bell's fundamental
      const at = (b) => Math.round((b.when + 0.004) * r.sr);
      const dp = dominant(spectrum(x, r.sr, at(peak), 4096), 50, 8000);
      const dv = dominant(spectrum(x, r.sr, at(valley), 4096), 50, 8000);
      check(exact && Math.abs(dp - peak.f) < 0.02 * peak.f + 12 && Math.abs(dv - valley.f) < 0.02 * valley.f + 12, `${LETTER[L]} (depth ${L + 1}): peak ${peak.f.toFixed(0)} Hz (heard ${dp.toFixed(0)}), valley ${valley.f.toFixed(0)} Hz (heard ${dv.toFixed(0)})`, `octave ratio ${(dp / dv).toFixed(2)}`);
    }
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[5] bell density');
  {
    const run = async (settings, secs = 16) => {
      const r = await renderInPage(page, { t0: 1791460800, rate: 1, seconds: secs, settings: { chord: false, reverb: 0, ...settings } });
      return { bells: r.log.length, perSecond: r.log.length / secs, levels: new Set(r.log.map((n) => n.level)), maxF: Math.max(...r.log.map((n) => n.f)) };
    };
    const def = await run({});
    const dense = await run({ floor: 0.12 });
    const all = await run({ levels: only([...Array(14).keys()]) });
    console.log(`   defaults (levels 1-12, floor 0.5 s): ${def.perSecond.toFixed(2)} bells/s; floor 0.12 s: ${dense.perSecond.toFixed(2)} bells/s; All 1-14: ${all.perSecond.toFixed(2)} bells/s`);
    check(def.perSecond > 0.8 && def.perSecond < 1.7, 'defaults: a calm stream of about 1.2 bells a second (was ~3)', `${def.perSecond.toFixed(2)} /s`);
    check(dense.perSecond > 2 * def.perSecond, 'the dense 0.12 s floor stays selectable and is much busier', `${dense.perSecond.toFixed(2)} /s`);
    check(!all.levels.has(12) && !all.levels.has(13), 'the All preset no longer ticks nu (3 kHz every 311 ms)', [...all.levels].join(','));
    check(Math.abs(all.perSecond - def.perSecond) < 0.3, 'All 1-14 is as calm as the default', `${all.perSecond.toFixed(2)} /s`);
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n[6] a saturated polyphony cap keeps the whole strum of the biggest boundary');
  {
    const T = 2401484716.816; // the end of a depth-1 cycle: all 14 levels end together
    const settings = { chord: false, chimes: true, reverb: 0, volumeDb: -6, floor: 0.03, levels: only([...Array(14).keys()]) };
    const r = await renderInPage(page, { t0: T - 5, rate: 1, seconds: 8, settings });
    const x = decode(r.L);
    const strum = [...Array(14).keys()].map((L) => r.log.find((n) => n.kind === 'end' && n.level === L && Math.abs(n.when - (5 + L * 0.015)) < 0.003));
    check(strum.every(Boolean), 'all 14 notes of the strum are scheduled, coarse to fine', strum.map((n, L) => (n ? L + 1 : '-')).join(' '));
    const stolen = r.log.filter((n) => n.stolen).length;
    check(stolen > 20, `the cap was saturated: ${stolen} of ${r.log.length} bells made room for others`);
    const sp = spectrum(x, r.sr, Math.round(5.0 * r.sr), 16384);
    const lines = [0, 1, 2, 3, 4, 5].map((L) => ({ L, f: strum[L]?.f ?? 0, a: db(peakAt(sp, strum[L]?.f ?? 1, 3)) }));
    console.log('   coarse strum lines in the first 0.34 s:', lines.map((l) => `${LETTER[l.L]} ${l.f.toFixed(0)} Hz ${l.a.toFixed(0)} dB`).join(' | '));
    check(lines.every((l) => l.a > -85), 'the six coarsest notes are really in the rendered audio');
    // the output never exceeds full scale whatever the cap does
    let pk = 0;
    for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
    check(pk < 0.99, 'peak below 0 dBFS', `${db(pk).toFixed(1)} dBFS`);
  }

  const own = errors.filter((e) => /src\/(audio|ui\/sound)|sound\.js|engine\.js|schedule\.js|tuning\.js/.test(e));
  check(own.length === 0, 'no console errors from the sound files', own.join(' | '));
}, { viewport: { width: 1200, height: 800 } });

console.log(failures ? `\n${failures} check(s) failed` : '\nall sound design checks passed');
process.exit(failures ? 1 : 0);
