/**
 * Web Audio engine of the Fractonica sonification.
 *
 * Layers
 *   chord     one soft voice per sounding level at its just-intonation pitch (tuning.js). Its loudness is
 *             the glyph wave of that level's cycle (schedule.js: silent at the valley, full at the peak), so
 *             the balance of the chord tells where you are in every cycle at once. Fast levels (mu, nu, xi)
 *             keep their true amplitude modulation (0.64 Hz, 3.2 Hz, 22 Hz): the clock's audible heartbeat.
 *   chimes    a bell at the level's pitch whenever a quarter threshold is crossed. A cycle end is the end of
 *             every finer cycle, so it is a strummed chord of all of them: a major turnover rings big.
 *   physical  the true cycle rates (xi 22.5 Hz, omicron 247.7 Hz, pi 2.23 kHz, rho 8.92 kHz, times 2^shift)
 *             as triangle waves: the glyph wave played as a waveform.
 *   moment    `playMoment(t)`: a 3-4 s arpeggio of the chord of any instant, also while the engine is off.
 *
 * Time. Everything is scheduled ahead on the AudioContext clock from a linear map
 * `displayed time <-> audio time` (rate = store.rate: 0 pauses the bells and holds the drone, 2000 is a
 * time-lapse, negative runs backwards: events then sound in reversed order and a strum runs fine -> coarse).
 * Chime events are drawn from a high-water mark in displayed time, so they sound exactly once whatever the
 * timer jitter. A discontinuity (jump, rate change, drift) cancels what is pending, holds each voice at its
 * current gain and ramps it to the new phase in 40 ms: never a click.
 *
 * Second harmonics. Every drone voice adds a quiet partial at 2f for warmth, except where that partial would
 * land within ~120 cents of another sounding voice's note (tuning.clashingHarmonics, computed from the tuning
 * table and the set of sounding levels): a partial a few Hz off a neighbour is a beat that belongs to no
 * cycle. The skipped voices keep a silent 2f oscillator, so muting a neighbour brings the partial back.
 *
 * Polyphony. At most MAX_NOTES bells sound at once. Over the cap the least important sounding bell is
 * stolen (quietest at that instant, then finest, then oldest) and faded out in 20 ms, so the coarse notes of
 * a major boundary always ring; a newcomer that is itself the least important one is the one that is dropped.
 *
 * Loudness is sampled from the catalogue position, phase = frac(position * P / 4): the quantity
 * model.levelAt().phase reports exactly (test/sound.test.js pins the two within 2e-4 of a cycle). The exact
 * BigInt reading costs ~26 us a call and a fast voice needs hundreds of samples per second. Bell thresholds
 * come from model.cycleStartTime(level, i / 4) (quarter i of the level), cross-checked against
 * model.levelAt().thresholds and model.upcomingEnds() in the tests.
 *
 * Switching off. stop() fades the output fader to 0 in 100 ms; 80 ms later everything that still rings behind
 * it (drone tails, started bells, the reverb tail) is released and the fader is left at 0, so nothing can
 * come back as a blip. start() and playMoment() raise the fader themselves. A start() that is overtaken by a
 * stop() while the browser resumes the context gives up (startToken), so a double toggle never leaves a timer.
 *
 * The engine knows nothing about the DOM. `createContext` is injected so the same code renders offline
 * (OfflineAudioContext) for verification; the scheduler timer is injectable too.
 */
import { buildTuning, frequencyOf, chimeFrequency, clashingHarmonics, weightFor, physicalLevels, isAudible } from './tuning.js';
import {
  eventsInWindow,
  bellTaper,
  createClockMap,
  phaseOf,
  voiceLoudness,
  directionCue,
  directionWeight,
  cycleHz,
  loudness,
  triangle,
  isLessImportant,
  bellLoudAt,
} from './schedule.js';
import { sanitize, dbToGain } from './settings.js';

export const TICK_MS = 50;
export const LOOKAHEAD = 0.6;
export const LOOKAHEAD_HIDDEN = 2.5;
export const MAX_NOTES = 48;
const CHUNK = 0.2; // seconds of automation appended per voice at a time
const RAMP = 0.04; // seconds to blend into a new phase after a discontinuity
const STEAL_FADE = 0.02; // seconds a bell that loses its slot to a more important one takes to fade out

// Gain staging (linear, before the master volume): tuned by offline measurement (tools/check-sound.mjs)
export const VOICE_AMP = 0.16;
const CHORUS_GAIN = 0.14; // the quiet detuned partner of every voice ...
const CHORUS_HZ = 0.15; // ... beats against it this slowly at any register (below the heartbeat of mu, 0.64 Hz)
const H_BASE = 0.1; // second-harmonic level of a drone voice ...
const H_DEPTH = 0.08; // ... lifted on the rising branch, lowered on the falling one
const PHYS_AMP = 0.07;
const CHIME_AMP = 0.44;
const MOMENT_AMP = 0.48;
const SEND_SCALE = 2.2; // reverb slider 0..1 -> send gain (calibrated so 22 % is a clear but modest room)

// Bell recipes: parts are [frequency ratio, amplitude, decay scale]
const RECIPES = {
  peak: { attack: 0.004, decay: 0.95, gain: 1.0, parts: [[1, 1, 1], [2.756, 0.34, 0.45], [5.404, 0.12, 0.22]] },
  node: { attack: 0.006, decay: 0.55, gain: 0.7, parts: [[1, 1, 1], [2, 0.14, 0.5]] },
  valley: { attack: 0.012, decay: 1.3, gain: 0.9, parts: [[1, 1, 1], [2, 0.22, 0.6]] },
  end: { attack: 0.003, decay: 1.5, gain: 1.0, parts: [[1, 1, 1], [2, 0.38, 0.6], [3, 0.2, 0.4]] },
  moment: { attack: 0.012, decay: 1.5, gain: 1.0, parts: [[1, 1, 1], [2, 0.16, 0.5]] },
};

/** Detune (cents) that puts the chorus partner CHORUS_HZ away from a voice at `f` Hz. */
const chorusCents = (f) => (1200 * Math.log2(1 + CHORUS_HZ / f));
const panOf = (level, spread = 0.45) => (level / 13 - 0.5) * 2 * spread;
const isOffline = (c) => typeof c.startRendering === 'function';
/** Resume a suspended real context (must happen inside the user gesture); offline contexts are never resumed. */
const resumeIfNeeded = (c) => (c.state === 'suspended' && !isOffline(c) && typeof c.resume === 'function' ? c.resume() : null);
/** resume() never settles when the browser refuses (no user gesture): give up with an explanation. */
const BLOCKED = 'The browser blocks audio until you click or press a key on this page';

/** Hold an AudioParam at its current value from time `a` on, dropping everything scheduled after. */
function holdParam(p, a) {
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(a);
  } else {
    const v = p.value;
    p.cancelScheduledValues(a);
    p.setValueAtTime(v, a);
  }
}

/**
 * Last line of defence behind the limiter: transparent up to 0.8, then a soft ceiling at 0.98, so the
 * output can never exceed full scale whatever the user does with the volume.
 */
export function safetyCurve(size = 2049) {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
  }
  return curve;
}

/** Deterministic noise so the reverb tail (and offline renders) are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A dark, smooth stereo room (RT60 about 2 s): decaying noise through a darkening one-pole filter, with a
 * short pre-delay and a fade over the last tenth so the tail ends without a step.
 */
export function makeImpulse(ctx, seconds = 2.4, rt60 = 2.0) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const rnd = mulberry32(9001 + ch * 77);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const u = (i - pre) / (len - pre);
      const env = Math.exp((-6.9078 * t) / rt60) * (u > 0.9 ? (1 - u) / 0.1 : 1);
      lp += (rnd() * 2 - 1 - lp) * (0.5 - 0.38 * Math.min(1, t / 1.5));
      data[i] = lp * env;
    }
  }
  return buf;
}

/**
 * @param {object} o
 * @param {object} o.model     ctx.model
 * @param {{t:()=>number, rate:()=>number}} o.clock  displayed time source (Unix s) and its rate
 * @param {()=>BaseAudioContext} o.createContext  called once, inside a user gesture for real contexts
 * @param {object} [o.settings]  initial settings (sanitised)
 * @param {()=>boolean} [o.hidden]  page hidden -> wider lookahead
 * @param {object[]} [o.log]  when given, every scheduled bell is recorded here (tests, tools)
 */
export function createEngine({ model, clock, createContext, settings: initial = {}, hidden, timers, log = null } = {}) {
  const T = timers ?? {
    setInterval: (f, ms) => globalThis.setInterval(f, ms),
    clearInterval: (h) => globalThis.clearInterval(h),
    setTimeout: (f, ms) => globalThis.setTimeout(f, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h),
  };
  const isHidden = hidden ?? (() => globalThis.document?.hidden === true);

  let settings = sanitize(initial);
  const tuning = buildTuning(model);
  const map = createClockMap();

  let ctx = null;
  let g = null; // graph nodes
  let enabled = false;
  let timer = null;
  let hw = 0; // chime high-water mark (displayed time)
  let lastResyncAt = 0;
  let resyncTimer = null;
  let idleTimer = null;
  let stopTimer = null;
  let stopWaiters = []; // resolvers of playMoment() calls that wait for a fade-out to finish
  let startToken = 0; // bumped by every start() / stop() / destroy(): a start() that was overtaken gives up
  let silenced = false; // the fader is parked at 0 after a stop; whoever makes sound next raises it
  let moment = null;
  let resyncs = 0;
  let ticks = 0;
  const voices = new Map(); // level -> chord voice
  const physVoices = new Map(); // level -> physical voice
  let notes = []; // sounding / scheduled bells: {start, end, amp, level, attack, decay, oscs, gains, entry}
  let pending = []; // the same bells while they may still be cancelled (they carry `when` and `kill()`)

  const withTimeout = (promise, ms = 2500) =>
    new Promise((resolve, reject) => {
      const h = T.setTimeout(() => reject(new Error(BLOCKED)), ms);
      promise.then(
        (v) => {
          T.clearTimeout(h);
          resolve(v);
        },
        (e) => {
          T.clearTimeout(h);
          reject(e);
        },
      );
    });

  // -------------------------------------------------------------------------------------------
  // Graph
  // -------------------------------------------------------------------------------------------
  function buildGraph(c) {
    const gain = (v) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    const n = {
      chordBus: gain(1),
      chimeBus: gain(settings.chimes ? 1 : 0),
      physBus: gain(1),
      momentBus: gain(1),
      mix: gain(1),
      send: gain(settings.reverb * SEND_SCALE),
      wet: gain(1),
      master: gain(dbToGain(settings.volumeDb)),
      fader: gain(1),
      convolver: c.createConvolver(),
      comp: c.createDynamicsCompressor(),
      safety: c.createWaveShaper(),
      analyser: c.createAnalyser(),
    };
    n.impulse = makeImpulse(c);
    n.convolver.buffer = n.impulse;
    n.comp.threshold.value = -14;
    n.comp.knee.value = 10;
    n.comp.ratio.value = 12;
    n.comp.attack.value = 0.003;
    n.comp.release.value = 0.25;
    n.safety.curve = safetyCurve();
    n.safety.oversample = '2x';
    n.analyser.fftSize = 8192;
    n.analyser.smoothingTimeConstant = 0.82;
    n.analyser.minDecibels = -100;
    n.analyser.maxDecibels = -10;
    for (const bus of [n.chordBus, n.chimeBus, n.physBus, n.momentBus]) bus.connect(n.mix);
    n.mix.connect(n.master);
    n.mix.connect(n.send);
    n.send.connect(n.convolver);
    n.convolver.connect(n.wet);
    n.wet.connect(n.master);
    n.master.connect(n.fader);
    n.fader.connect(n.comp);
    n.comp.connect(n.safety);
    n.safety.connect(n.analyser);
    n.safety.connect(c.destination);
    return n;
  }

  /**
   * The context and its graph exist together or not at all: a graph that cannot be built (an unsupported
   * node, a browser out of audio resources) closes the fresh context and leaves the engine as it was, so the
   * next click starts from scratch instead of finding a context without a graph.
   */
  function ensureContext() {
    if (ctx) return ctx;
    const c = createContext();
    try {
      g = buildGraph(c);
    } catch (err) {
      g = null;
      try {
        c.close?.()?.catch?.(() => {});
      } catch {
        /* nothing to close */
      }
      throw err;
    }
    ctx = c;
    return ctx;
  }

  const latency = () => (ctx ? Math.min(0.15, Math.max(0, ctx.outputLatency || 0)) : 0);
  const soundingLevels = () => (settings.levels.map((on, L) => (on ? L : -1)).filter((L) => L >= 0));
  const freqOf = (level) => frequencyOf(tuning[level], settings.baseHz);

  // -------------------------------------------------------------------------------------------
  // Chord voices
  // -------------------------------------------------------------------------------------------
  /** Gain and brightness of a voice at audio time `a` (null phase when outside the catalogue). */
  function sampleVoice(v, a) {
    const info = model.levelInfo(v.level);
    const hz = cycleHz(info.meanSeconds, map.rate);
    const pos = model.positionOf(map.tAt(a));
    if (pos === null) return [0, v.noH ? 0 : H_BASE];
    const ph = phaseOf(pos, info.prefixNum);
    return [VOICE_AMP * weightFor(v.f) * voiceLoudness(ph, hz), v.noH ? 0 : H_BASE + H_DEPTH * directionWeight(hz) * directionCue(ph)];
  }

  /** Per level: true = its 2nd harmonic is left out because it would beat against another sounding voice. */
  function harmonicSkips(want) {
    const freqs = tuning.map((_, L) => freqOf(L));
    return clashingHarmonics(freqs, freqs.map((_, L) => want.has(L)));
  }

  function createVoice(level, noH = false) {
    const f = freqOf(level);
    const mk = (type, freq, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      return o;
    };
    // a quiet partner a fixed few hundredths of a Hz away: warmth without a register-dependent tremolo
    const oscA = mk('sine', f);
    const oscB = mk('sine', f, chorusCents(f));
    const oscH = mk('sine', f * 2);
    const bGain = ctx.createGain();
    const hGain = ctx.createGain();
    const cycle = ctx.createGain();
    const mute = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    bGain.gain.value = CHORUS_GAIN;
    hGain.gain.value = noH ? 0 : H_BASE;
    cycle.gain.value = 0;
    mute.gain.value = 0;
    oscA.connect(cycle);
    oscB.connect(bGain);
    bGain.connect(cycle);
    oscH.connect(hGain);
    hGain.connect(cycle);
    cycle.connect(mute);
    if (pan) {
      pan.pan.value = panOf(level);
      mute.connect(pan);
      pan.connect(g.chordBus);
    } else mute.connect(g.chordBus);
    const v = { level, f, oscs: [oscA, oscB, oscH], bGain, hGain, cycle, mute, pan, next: 0, noH };
    const a = ctx.currentTime + 0.01;
    const [gv, hv] = sampleVoice(v, a);
    cycle.gain.setValueAtTime(gv, a);
    hGain.gain.setValueAtTime(hv, a);
    mute.gain.setValueAtTime(0, a);
    mute.gain.setTargetAtTime(1, a, 0.05);
    for (const o of v.oscs) o.start(a);
    v.next = a;
    return v;
  }

  function disposeNodes(nodes) {
    for (const n of nodes) {
      try {
        n?.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  function removeVoice(v) {
    const now = ctx.currentTime;
    holdParam(v.mute.gain, now);
    v.mute.gain.setTargetAtTime(0, now, 0.03);
    for (const o of v.oscs) o.stop(now + 0.3);
    v.oscs[0].onended = () => disposeNodes([...v.oscs, v.bGain, v.hGain, v.cycle, v.mute, v.pan]);
  }

  function ensureVoices() {
    if (!ctx) return;
    const want = new Set(enabled && settings.chord ? soundingLevels() : []);
    for (const [L, v] of voices) {
      if (!want.has(L)) {
        removeVoice(v);
        voices.delete(L);
      }
    }
    const skip = harmonicSkips(want);
    for (const L of want) if (!voices.has(L)) voices.set(L, createVoice(L, skip[L]));
    // a voice kept from before whose neighbour was muted or unmuted: its 2nd harmonic comes or goes in 40 ms
    for (const [L, v] of voices) {
      if (v.noH === skip[L]) continue;
      v.noH = skip[L];
      if (enabled) resetVoice(v, ctx.currentTime);
    }
  }

  function scheduleVoice(v, horizonA) {
    const info = model.levelInfo(v.level);
    const hz = cycleHz(info.meanSeconds, map.rate);
    const perSecond = Math.min(480, Math.max(12, hz * 12));
    const n = Math.max(2, Math.ceil(CHUNK * perSecond));
    while (v.next < horizonA) {
      for (let j = 1; j <= n; j++) {
        const a = v.next + (CHUNK * j) / n;
        const [gv, hv] = sampleVoice(v, a);
        v.cycle.gain.linearRampToValueAtTime(gv, a);
        v.hGain.gain.linearRampToValueAtTime(hv, a);
      }
      v.next += CHUNK;
    }
  }

  /** Hold at the current gain, then blend into the new phase over RAMP seconds. */
  function resetVoice(v, now) {
    const a = now + 0.008;
    holdParam(v.cycle.gain, a);
    holdParam(v.hGain.gain, a);
    const aEnd = a + RAMP;
    const [gv, hv] = sampleVoice(v, aEnd);
    v.cycle.gain.linearRampToValueAtTime(gv, aEnd);
    v.hGain.gain.linearRampToValueAtTime(hv, aEnd);
    v.next = aEnd;
  }

  // -------------------------------------------------------------------------------------------
  // Physical voices: true cycle rates as triangle waves
  // -------------------------------------------------------------------------------------------
  function ensurePhysical() {
    if (!ctx) return;
    const want = new Map();
    if (enabled && settings.physical) for (const p of physicalLevels(model, settings.physShift)) want.set(p.level, p);
    const now = ctx.currentTime;
    for (const [L, v] of physVoices) {
      const w = want.get(L);
      if (!w || Math.abs(w.hz - v.hz) > 1e-6) {
        holdParam(v.gain.gain, now);
        v.gain.gain.setTargetAtTime(0, now, 0.03);
        v.osc.stop(now + 0.3);
        v.osc.onended = () => disposeNodes([v.osc, v.gain]);
        physVoices.delete(L);
      }
    }
    for (const [L, w] of want) {
      if (physVoices.has(L) || !isAudible(w.hz)) continue;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = w.hz;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(g.physBus);
      osc.start(now + 0.01);
      gain.gain.setValueAtTime(0, now + 0.01);
      gain.gain.setTargetAtTime(PHYS_AMP * weightFor(w.hz), now + 0.01, 0.08);
      physVoices.set(L, { level: L, hz: w.hz, osc, gain });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Bells
  // -------------------------------------------------------------------------------------------
  /** The first instant in [when, end) at which one more bell would put the number of simultaneous bells over the cap. */
  function overloadAt(when, end) {
    const at = [when];
    for (const x of notes) if (x.start > when && x.start < end) at.push(x.start);
    at.sort((a, b) => a - b);
    for (const p of at) {
      let n = 1;
      for (const x of notes) if (x.start <= p && x.end > p) n++;
      if (n > MAX_NOTES) return p;
    }
    return null;
  }

  /**
   * Make room for a bell: while it would exceed the cap, the least important bell sounding at the first
   * overloaded instant is stolen, unless that is the newcomer itself. Returns false when the newcomer is dropped.
   */
  function admit(cand) {
    for (let guard = 0; guard <= MAX_NOTES; guard++) {
      const p = overloadAt(cand.start, cand.end);
      if (p === null) return true;
      let victim = null;
      for (const x of notes) if (x.start <= p && x.end > p && (!victim || isLessImportant(x, victim, p))) victim = x;
      if (!victim || !isLessImportant(victim, cand, p)) return false;
      steal(victim, cand.start);
    }
    return false;
  }

  /**
   * Take a bell out: it never starts when it was still to come, else it is faded out over STEAL_FADE from
   * `at`. It stays in `notes`, cut short, so the count of bells sounding before `at` stays right for the
   * bells that are admitted later but start earlier.
   */
  function steal(n, at) {
    n.end = Math.max(at, n.start);
    const entry = n.entry;
    if (n.start >= at) {
      for (const o of n.oscs) {
        try {
          o.stop(0);
        } catch {
          /* not started */
        }
      }
      if (entry) entry.end = entry.when; // it never sounds
    } else {
      const to = at + STEAL_FADE;
      for (const e of n.gains) {
        holdParam(e.gain, at);
        e.gain.linearRampToValueAtTime(0, to);
      }
      for (const o of n.oscs) o.stop(to + 0.005);
      if (entry) entry.end = to;
    }
    if (entry) {
      entry.stolen = true;
      entry.stolenAt = n.end; // from here on it no longer counts against the cap
      entry.cutLoud = n.start >= at ? 0 : bellLoudAt(n, at); // how loud it still was when it was cut (diagnostics)
    }
  }

  /**
   * One bell: a few sine partials with their own decays, panned. Returns false when the polyphony cap
   * drops it (every bell it would displace is more important).
   */
  function playNote({ f, when, amp, kind, decay, pan, bus, level = -1 }) {
    const rec = RECIPES[kind];
    if (!Number.isFinite(when) || amp < 2e-4) return false;
    const end = when + rec.attack + decay;
    const note = { start: when, end, amp, level, attack: rec.attack, decay, oscs: [], gains: [], entry: null };
    if (!admit(note)) return false;
    const out = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let dest = bus;
    if (out) {
      out.pan.value = pan;
      out.connect(bus);
      dest = out;
    }
    const { oscs, gains } = note;
    let alive = 0;
    for (const [ratio, a, ds] of rec.parts) {
      const fr = f * ratio;
      const peak = amp * a;
      if (fr > 12000 || peak < 1.5e-4) continue;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const e = ctx.createGain();
      const stopAt = when + rec.attack + decay * ds;
      e.gain.setValueAtTime(0, when);
      e.gain.linearRampToValueAtTime(peak, when + rec.attack);
      e.gain.exponentialRampToValueAtTime(1e-4, stopAt);
      o.connect(e);
      e.connect(dest);
      o.start(when);
      o.stop(stopAt + 0.02);
      alive++;
      o.onended = () => {
        disposeNodes([o, e]);
        if (--alive === 0) disposeNodes([out]);
      };
      oscs.push(o);
      gains.push(e);
    }
    if (!oscs.length) return false;
    note.when = when;
    note.kill = () => {
      for (const o of oscs) {
        try {
          o.stop(0);
        } catch {
          /* not started */
        }
      }
      notes = notes.filter((x) => x !== note);
    };
    notes.push(note);
    pending.push(note);
    if (log) {
      note.entry = { when, f, amp, kind, level, decay, parts: oscs.length, end };
      log.push(note.entry);
    }
    return true;
  }

  /** A chime event: the parts (coincident thresholds) are strummed coarse -> fine (fine -> coarse backwards). */
  function playEvent(ev, when, reverse) {
    const parts = reverse ? [...ev.parts].reverse() : ev.parts;
    const n = parts.length;
    const spacing = Math.min(0.015, 0.24 / Math.max(1, n));
    const grow = 1 + 0.28 * Math.log(Math.max(1, ev.ends));
    parts.forEach((part, i) => {
      const f = chimeFrequency(freqOf(part.level), part.kind);
      const rec = RECIPES[part.kind];
      const amp = CHIME_AMP * rec.gain * ev.strength * Math.pow(n, -0.35) * bellTaper(part.level) * weightFor(f);
      playNote({
        f,
        when: when + i * spacing,
        amp,
        kind: part.kind,
        decay: rec.decay * grow * (f < 300 ? 1.2 : 1),
        pan: panOf(part.level),
        bus: g.chimeBus,
        level: part.level,
      });
    });
  }

  function killPending(now) {
    const keep = [];
    for (const p of pending) {
      if (p.when > now + 0.004) p.kill();
      else if (p.when > now - 3) keep.push(p);
    }
    pending = keep;
  }

  /** Silence every bell, also those already ringing (only once the fader has hidden them). */
  function killAllNotes() {
    for (const p of pending) p.kill();
    pending = [];
    notes = [];
  }

  /**
   * Empty the reverb: a convolver keeps ringing its tail whatever is fed to it, and that tail must not
   * come back when the fader is raised again. A fresh node with the same impulse starts silent.
   */
  function flushReverb() {
    if (!g?.send) return;
    const old = g.convolver;
    const next = ctx.createConvolver();
    next.buffer = g.impulse;
    g.send.connect(next);
    next.connect(g.wet);
    g.convolver = next;
    try {
      g.send.disconnect(old);
    } catch {
      /* already disconnected */
    }
    disposeNodes([old]);
  }

  function scheduleChimes(now, horizonA) {
    const rate = map.rate;
    const tH = map.tAt(horizonA);
    if (rate === 0 || !enabled) {
      hw = tH;
      return;
    }
    if (!settings.chimes) {
      hw = tH;
      return;
    }
    const opts = { levels: soundingLevels(), rate, floor: settings.floor };
    const evs = rate > 0 ? eventsInWindow(model, hw, tH, opts) : eventsInWindow(model, tH, hw, opts).reverse();
    hw = tH;
    const comp = latency();
    for (const ev of evs) {
      let when = map.aAt(ev.time) - comp;
      if (when < now) {
        if (now - when > 0.1) continue; // a late tick: skip what is already history
        when = now + 0.003;
      }
      playEvent(ev, when, rate < 0);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------------------------------
  function tick() {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    ticks++;
    const now = ctx.currentTime;
    const rate = map.rate;
    if (rate !== 0 && Math.abs(clock.t() - map.tAt(now)) / Math.abs(rate) > 0.05) {
      requestResync();
      return;
    }
    const horizon = now + (isHidden() ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    if (settings.chord) for (const v of voices.values()) scheduleVoice(v, horizon);
    scheduleChimes(now, horizon);
    if (pending.length > 64 || notes.length > 64) {
      pending = pending.filter((p) => p.when > now - 3);
      notes = notes.filter((x) => x.end > now - 0.1);
    }
  }

  function resync() {
    if (!ctx || !enabled) return;
    resyncs++;
    const now = ctx.currentTime;
    killPending(now);
    map.set(now, clock.t(), clock.rate());
    hw = map.t0;
    for (const v of voices.values()) resetVoice(v, now);
  }

  /** Debounced resync: a scrub that fires setTime every frame costs one resync per ~30 ms. */
  function requestResync() {
    if (!enabled) return;
    const since = Date.now() - lastResyncAt;
    if (since >= 30) {
      lastResyncAt = Date.now();
      resync();
    } else if (!resyncTimer) {
      resyncTimer = T.setTimeout(() => {
        resyncTimer = null;
        lastResyncAt = Date.now();
        resync();
      }, 30 - since);
    }
  }

  function onVisibility() {
    if (enabled) tick(); // widen the schedule before the timer is throttled
  }

  // -------------------------------------------------------------------------------------------
  // Public control
  // -------------------------------------------------------------------------------------------
  /** Start the continuous layers. Must be called inside a user gesture (creates / resumes the context). */
  async function start() {
    if (enabled) return true;
    const fading = stopTimer !== null; // a fade-out is still running: continue from where it is
    if (stopTimer) {
      T.clearTimeout(stopTimer);
      stopTimer = null;
      settleStop();
    }
    if (idleTimer) {
      T.clearTimeout(idleTimer);
      idleTimer = null;
    }
    const c = ensureContext();
    const resuming = resumeIfNeeded(c);
    const token = ++startToken;
    enabled = true;
    if (resuming) {
      try {
        await withTimeout(resuming);
      } catch (err) {
        if (token !== startToken) return enabled; // overtaken by a stop() / start(): that call decides
        enabled = false;
        scheduleIdle();
        throw err;
      }
      if (token !== startToken || ctx !== c) return enabled; // stopped (or destroyed) while the context resumed
    }
    if (!isOffline(c)) {
      // an interrupted context (phone call, device switch) that comes back must re-anchor to the clock
      c.onstatechange = () => {
        if (ctx && ctx.state === 'running' && enabled) requestResync();
      };
    }
    const now = c.currentTime;
    const from = fading ? g.fader.gain.value : 0;
    silenced = false;
    g.fader.gain.cancelScheduledValues(now);
    g.fader.gain.setValueAtTime(from, now);
    g.fader.gain.linearRampToValueAtTime(1, now + 0.12);
    map.set(now, clock.t(), clock.rate());
    hw = map.t0;
    const existing = [...voices.values()]; // kept alive by a quick off/on: re-anchor them to the new map
    ensureVoices();
    ensurePhysical();
    for (const v of existing) if (voices.get(v.level) === v) resetVoice(v, now);
    tick();
    if (timer) T.clearInterval(timer);
    timer = T.setInterval(tick, TICK_MS);
    globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
    return true;
  }

  const settleStop = () => {
    const waiting = stopWaiters;
    stopWaiters = [];
    for (const resolve of waiting) resolve();
  };

  /** The fade-out is over (the fader sits at 0): release everything that was still sounding behind it. */
  function finishStop() {
    stopTimer = null;
    if (!enabled && ctx) {
      for (const v of voices.values()) removeVoice(v);
      voices.clear();
      for (const v of physVoices.values()) {
        v.osc.stop();
        disposeNodes([v.osc, v.gain]);
      }
      physVoices.clear();
      killAllNotes();
      flushReverb();
      // The fader stays at 0 from here on. Raising it now would let whatever still decays behind it (drone
      // tails, bells, the reverb) come back as an audible blip; start() and playMoment() raise it themselves.
      silenced = true;
      scheduleIdle();
    }
    settleStop();
  }

  /** Fade out and release the continuous layers (the context stays for `playMoment`). */
  async function stop() {
    if (!enabled) return false;
    enabled = false;
    startToken++;
    if (timer) T.clearInterval(timer);
    timer = null;
    if (resyncTimer) T.clearTimeout(resyncTimer);
    resyncTimer = null;
    globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
    if (!ctx) return false;
    const now = ctx.currentTime;
    killPending(now);
    g.fader.gain.cancelScheduledValues(now);
    g.fader.gain.setValueAtTime(g.fader.gain.value, now);
    g.fader.gain.linearRampToValueAtTime(0, now + 0.1);
    stopTimer = T.setTimeout(finishStop, 180);
    return false;
  }

  function scheduleIdle() {
    if (idleTimer) T.clearTimeout(idleTimer);
    idleTimer = T.setTimeout(() => {
      idleTimer = null;
      if (enabled || !ctx || ctx.state !== 'running' || isOffline(ctx) || typeof ctx.suspend !== 'function') return;
      if (moment && moment.end > ctx.currentTime) return scheduleIdle(); // a moment is still ringing
      ctx.suspend().catch(() => {});
    }, 1500);
  }

  async function toggle() {
    return enabled ? stop() : start();
  }

  /**
   * Hear a moment: a short arpeggio of the chord at displayed time `t` (alpha -> deepest sounding level),
   * each note as loud as its cycle's glyph is high. Works while the engine is off (needs a user gesture).
   * @returns {Promise<null | {t:number, end:number, notes:{level:number, at:number, gain:number}[]}>}
   */
  async function playMoment(t = clock.t()) {
    const c = ensureContext();
    const resuming = resumeIfNeeded(c);
    const frame = model.frame(t);
    if (!frame.inRange) return null;
    if (resuming) await withTimeout(resuming);
    if (stopTimer) await new Promise((resolve) => stopWaiters.push(resolve)); // let a fade-out finish first
    if (ctx !== c) return null; // destroyed while waiting
    if (idleTimer) {
      T.clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (silenced) {
      // the fader was parked at 0 by a stop: bring it back before the first note
      const now = c.currentTime;
      silenced = false;
      g.fader.gain.cancelScheduledValues(now);
      g.fader.gain.setValueAtTime(0, now);
      g.fader.gain.linearRampToValueAtTime(1, now + 0.02);
    }
    let levels = soundingLevels();
    if (!levels.length) levels = tuning.map((r) => r.level);
    const step = Math.min(0.4, Math.max(0.12, 2.2 / levels.length));
    const start0 = c.currentTime + 0.05;
    const out = [];
    levels.forEach((L, i) => {
      const l = frame.level(L);
      if (!l) return;
      const lv = 0.06 + 0.94 * loudness(triangle(l.phase));
      const f = freqOf(L);
      const rec = RECIPES.moment;
      const when = start0 + i * step;
      playNote({
        f,
        when,
        amp: MOMENT_AMP * lv * weightFor(f),
        kind: 'moment',
        decay: rec.decay,
        pan: levels.length > 1 ? (i / (levels.length - 1) - 0.5) * 1.2 : 0,
        bus: g.momentBus,
        level: L,
      });
      out.push({ level: L, at: when, gain: lv });
    });
    const end = start0 + (levels.length - 1) * step + RECIPES.moment.decay + 0.2;
    moment = { t, start: start0, end, notes: out };
    if (!enabled) scheduleIdle();
    return moment;
  }

  /** Merge a settings patch; applies it without glitches while sound is playing. Returns the new settings. */
  function update(patch) {
    const prev = settings;
    settings = sanitize({ ...prev, ...patch, tempo: { ...prev.tempo, ...(patch?.tempo ?? {}) } });
    if (!ctx) return settings;
    const now = ctx.currentTime;
    if (settings.volumeDb !== prev.volumeDb) g.master.gain.setTargetAtTime(dbToGain(settings.volumeDb), now, 0.03);
    if (settings.reverb !== prev.reverb) g.send.gain.setTargetAtTime(settings.reverb * SEND_SCALE, now, 0.05);
    if (settings.chimes !== prev.chimes) {
      g.chimeBus.gain.setTargetAtTime(settings.chimes ? 1 : 0, now, 0.02);
      if (!settings.chimes) killPending(now);
    }
    if (settings.baseHz !== prev.baseHz) {
      for (const v of voices.values()) {
        v.f = freqOf(v.level);
        v.oscs[0].frequency.setTargetAtTime(v.f, now, 0.05);
        v.oscs[1].frequency.setTargetAtTime(v.f, now, 0.05);
        v.oscs[1].detune.setTargetAtTime(chorusCents(v.f), now, 0.05); // keep the partner CHORUS_HZ away
        v.oscs[2].frequency.setTargetAtTime(v.f * 2, now, 0.05);
      }
    }
    if (enabled) {
      ensureVoices();
      ensurePhysical();
    }
    return settings;
  }

  /**
   * Offline render for verification: schedules the continuous layers (and optionally a moment) for
   * `seconds` of audio from the clock's current time/rate and renders with an OfflineAudioContext.
   * `jumps` = [{at, apply}]: at audio second `at` the context is suspended, `apply()` moves the clock
   * (a jump or a rate change) and the engine re-anchors exactly as it does live.
   */
  async function renderOffline(seconds, { continuous = true, momentAt = null, jumps = [] } = {}) {
    const c = ensureContext();
    map.set(0, clock.t(), clock.rate());
    hw = map.t0;
    if (continuous) {
      enabled = true;
      ensureVoices();
      ensurePhysical();
      for (const v of voices.values()) scheduleVoice(v, seconds + CHUNK);
      scheduleChimes(0, seconds);
      for (const j of jumps) {
        c.suspend(j.at).then(() => {
          j.apply?.();
          resync();
          for (const v of voices.values()) scheduleVoice(v, seconds + CHUNK);
          scheduleChimes(c.currentTime, seconds);
          c.resume();
        });
      }
    }
    if (momentAt !== null) await playMoment(momentAt);
    const buffer = await c.startRendering();
    enabled = false;
    return buffer;
  }

  function destroy() {
    enabled = false;
    startToken++;
    if (timer) T.clearInterval(timer);
    if (resyncTimer) T.clearTimeout(resyncTimer);
    if (idleTimer) T.clearTimeout(idleTimer);
    if (stopTimer) T.clearTimeout(stopTimer);
    timer = resyncTimer = idleTimer = stopTimer = null;
    globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
    pending.forEach((p) => p.kill());
    pending = [];
    notes = [];
    settleStop();
    if (ctx) {
      for (const v of voices.values()) {
        for (const o of v.oscs) {
          try {
            o.stop();
          } catch {
            /* already stopped */
          }
        }
      }
      for (const v of physVoices.values()) {
        try {
          v.osc.stop();
        } catch {
          /* already stopped */
        }
      }
      voices.clear();
      physVoices.clear();
      const c = ctx;
      ctx = null;
      g = null;
      if (typeof c.close === 'function') c.close().catch(() => {});
    }
  }

  return {
    tuning,
    get settings() {
      return settings;
    },
    get enabled() {
      return enabled;
    },
    get context() {
      return ctx;
    },
    get analyser() {
      return g?.analyser ?? null;
    },
    get moment() {
      return moment;
    },
    /** Live numbers for the status line. */
    stats() {
      const now = ctx?.currentTime ?? 0;
      return {
        state: ctx ? ctx.state : 'closed',
        sampleRate: ctx?.sampleRate ?? 0,
        voices: voices.size + physVoices.size,
        chordVoices: voices.size,
        physicalVoices: physVoices.size,
        bells: notes.filter((x) => x.start <= now && x.end > now).length,
        latency: ctx ? (ctx.outputLatency || ctx.baseLatency || 0) : 0,
        resyncs,
        ticks,
      };
    },
    /** Frequency (Hz) of the chord voice of a level under the current base pitch. */
    frequency: freqOf,
    voiceLevels: () => [...voices.keys()],
    /** Levels whose 2nd harmonic is currently left out (it would beat against another sounding voice). */
    skippedHarmonics: () => [...voices.values()].filter((v) => v.noH).map((v) => v.level).sort((a, b) => a - b),
    physicalVoices: () => [...physVoices.values()].map((v) => ({ level: v.level, hz: v.hz })),
    start,
    stop,
    toggle,
    setEnabled: (on) => (on ? start() : stop()),
    playMoment,
    update,
    resync: requestResync,
    tick,
    renderOffline,
    destroy,
  };
}
