/**
 * Shared app state: the displayed time (live / time travel / time-lapse) and
 * the small set of settings every view shares.
 *
 * Time model
 *   mode 'live'    displayed time = the device clock.
 *   mode 'travel'  displayed time = anchor.t + rate * (realNow - anchor.real)
 *                  rate 0 = paused at a chosen time, rate 1 = real speed from an
 *                  offset time, any other rate = time-lapse (virtual s per real s).
 *
 * Views read `store.t()` once per frame; they never keep their own clock.
 * Discontinuities (user jumps, rate changes, goLive) emit a `time` event so
 * audio can cancel scheduled sounds, etc. Continuous playback emits nothing.
 */

const STORAGE_KEY = 'fractonica-clock/v1';

const DEFAULTS = {
  zone: null, // IANA zone, null = system zone
  view: 'rings', // active main tab
  topDepth: 7, // depth of the upper period on the clock face (SPEC §10: 2..11)
  selectedLevel: 6, // level highlighted across views (depth 7)
  minDepth: 1, // shared depth range for ring / ladder / timeline lanes
  maxDepth: 10,
  showLetters: false, // SPEC §8 period letters shown permanently
  faceMode: 'journal', // the clock face: 'journal' (units as the diary writes them) or 'watch' (SPEC §8–10)
  journalUnit: 5, // the journal face's first unit: 0 α … 3 δ, 4 ε, 5 η, 6 ι (src/ui/face/journal.js)
  pure: false, // pure mode: Fractonica terms only (no Gregorian dates, Earth time units or percentages)
};

/** localStorage, or null when the browser blocks site data (reading the property can throw). */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Is `z` an IANA zone the browser knows (or null = system zone)? */
export function validZone(z) {
  if (z === null) return true;
  if (typeof z !== 'string' || !z) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
/** Per-setting validators: an invalid value is ignored and never persisted. */
const VALID = {
  zone: validZone,
  view: (v) => typeof v === 'string' && v.length > 0 && v.length < 24,
  topDepth: (v) => isInt(v, 2, 11),
  selectedLevel: (v) => isInt(v, 0, 13),
  minDepth: (v) => isInt(v, 1, 14),
  maxDepth: (v) => isInt(v, 1, 14),
  showLetters: (v) => typeof v === 'boolean',
  faceMode: (v) => v === 'journal' || v === 'watch',
  journalUnit: (v) => isInt(v, 0, 6),
  pure: (v) => typeof v === 'boolean',
};
/** Keep only valid keys/values of a persisted or incoming object; keep minDepth <= maxDepth. */
function sanitize(obj, base = DEFAULTS) {
  const out = { ...base };
  if (obj && typeof obj === 'object') for (const k of Object.keys(DEFAULTS)) if (k in obj && VALID[k](obj[k])) out[k] = obj[k];
  if (out.minDepth > out.maxDepth) {
    out.minDepth = base.minDepth <= out.maxDepth ? base.minDepth : out.maxDepth;
  }
  return out;
}

export function createStore({ model, realNow = () => Date.now() / 1000, storage } = {}) {
  if (storage === undefined) storage = defaultStorage();
  const listeners = new Set();
  const timeListeners = new Set();
  const persisted = load(storage);
  const state = sanitize(persisted);
  let mode = 'live';
  let rate = 1;
  let anchor = { t: realNow(), real: realNow() };

  function load(s) {
    try {
      const raw = s?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode etc. – the app works without persistence */
    }
  }

  const clamp = (t) => (model ? model.clamp(t) : t);

  /** The displayed time (Unix seconds). Cheap: call it every frame. */
  function t() {
    if (mode === 'live') return realNow();
    const now = realNow();
    const v = anchor.t + rate * (now - anchor.real);
    if (model && rate !== 0 && (v < model.tMin || v > model.tMax)) {
      // time-lapse ran off the catalogue: stop at the edge instead of extrapolating
      anchor = { t: clamp(v), real: now };
      rate = 0;
      emitTime('edge');
      return anchor.t;
    }
    return v;
  }

  function emitTime(reason) {
    for (const f of timeListeners) f(reason);
    for (const f of listeners) f('time');
  }

  const api = {
    state,
    get mode() {
      return mode;
    },
    get rate() {
      return rate;
    },
    get playing() {
      return mode === 'travel' && rate !== 0;
    },
    get live() {
      return mode === 'live';
    },
    t,
    realNow,
    /** Jump to a time and stay there (keeps the current rate when travelling, else pauses). */
    setTime(time, reason = 'jump') {
      const keep = mode === 'travel' ? rate : 0;
      anchor = { t: clamp(time), real: realNow() };
      mode = 'travel';
      rate = keep;
      emitTime(reason);
    },
    /** Move by dt seconds of displayed time. */
    shift(dt, reason = 'shift') {
      api.setTime(t() + dt, reason);
    },
    /** Time-lapse: displayed seconds per real second (0 pauses, 1 = real speed, negative = backwards). */
    setRate(r, reason = 'rate') {
      const cur = t();
      anchor = { t: cur, real: realNow() };
      mode = 'travel';
      rate = r;
      emitTime(reason);
    },
    pause() {
      api.setRate(0, 'pause');
    },
    goLive() {
      mode = 'live';
      rate = 1;
      anchor = { t: realNow(), real: realNow() };
      emitTime('live');
    },
    /** Update shared settings; `patch` keys must exist in DEFAULTS. */
    set(patch) {
      for (const k of Object.keys(patch)) if (!(k in DEFAULTS)) throw new Error('unknown setting ' + k);
      // invalid values (bad zone, out-of-range depth, non-integer level…) are ignored, never stored
      const next = sanitize(patch, state);
      const applied = {};
      for (const k of Object.keys(DEFAULTS)) if (next[k] !== state[k]) applied[k] = next[k];
      if (!Object.keys(applied).length) return;
      Object.assign(state, applied);
      save();
      for (const f of listeners) f('settings', applied);
    },
    /** Subscribe to any state change; callback(kind: 'time'|'settings', patch?). Returns unsubscribe. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Subscribe to time discontinuities only; callback(reason). Returns unsubscribe. */
    onTime(fn) {
      timeListeners.add(fn);
      return () => timeListeners.delete(fn);
    },
  };
  return api;
}
