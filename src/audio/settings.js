/**
 * Sound settings: defaults, sanitising, presets and persistence (pure except load/save, which
 * take the storage object so tests can inject one).
 */
import { DEFAULT_BASE_HZ, N_LEVELS } from './tuning.js';
import { DEFAULT_FLOOR } from './schedule.js';

export const STORAGE_KEY = 'fractonica-clock/sound/v1';
/**
 * Revision written with the stored settings. Revision 2 made 0.5 s the default chime floor; a floor of
 * exactly 0.12 s in settings saved before that (no revision) is the old default, not a choice, so it moves
 * to the new default once. Every other stored value is kept.
 */
export const SETTINGS_REV = 2;
const OLD_DEFAULT_FLOOR = 0.12;

export const DEFAULT_SETTINGS = Object.freeze({
  volumeDb: -18,
  reverb: 0.22,
  chord: true,
  chimes: true,
  physical: false,
  physShift: -1,
  baseHz: DEFAULT_BASE_HZ,
  floor: DEFAULT_FLOOR,
  /** which depths 1..14 sound (index = level) */
  levels: Array.from({ length: N_LEVELS }, (_, L) => L < 12),
  tempo: Object.freeze({ depth: 7, seconds: 4 }),
});

export const LIMITS = Object.freeze({
  volumeDb: [-48, -3],
  reverb: [0, 1],
  physShift: [-3, 3],
  baseHz: [55, 220],
  floor: [0.03, 2],
  tempoSeconds: [0.25, 600],
});

/** Depth ranges offered as presets: [first depth, last depth]. */
export const PRESETS = Object.freeze({
  slow: { label: 'Slow (1–7)', from: 1, to: 7 },
  default: { label: 'Default (1–12)', from: 1, to: 12 },
  all: { label: 'All (1–14)', from: 1, to: 14 },
});

export const FLOORS = Object.freeze([0.05, 0.12, 0.25, 0.5, 1]);

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Boolean level mask for a depth range preset. */
export function presetLevels(from, to) {
  return Array.from({ length: N_LEVELS }, (_, L) => L + 1 >= from && L + 1 <= to);
}

/** Which preset (if any) a level mask equals. */
export function matchPreset(levels) {
  for (const [key, p] of Object.entries(PRESETS)) {
    const want = presetLevels(p.from, p.to);
    if (want.every((v, i) => v === !!levels[i])) return key;
  }
  return null;
}

/** Coerce anything (e.g. parsed JSON from localStorage) into a complete, valid settings object. */
export function sanitize(raw) {
  const d = DEFAULT_SETTINGS;
  const s = raw && typeof raw === 'object' ? raw : {};
  const levels = Array.isArray(s.levels) && s.levels.length === N_LEVELS ? s.levels.map(Boolean) : [...d.levels];
  const t = s.tempo && typeof s.tempo === 'object' ? s.tempo : {};
  return {
    volumeDb: clamp(num(s.volumeDb, d.volumeDb), LIMITS.volumeDb),
    reverb: clamp(num(s.reverb, d.reverb), LIMITS.reverb),
    chord: typeof s.chord === 'boolean' ? s.chord : d.chord,
    chimes: typeof s.chimes === 'boolean' ? s.chimes : d.chimes,
    physical: typeof s.physical === 'boolean' ? s.physical : d.physical,
    physShift: Math.round(clamp(num(s.physShift, d.physShift), LIMITS.physShift)),
    baseHz: clamp(num(s.baseHz, d.baseHz), LIMITS.baseHz),
    floor: clamp(num(s.floor, d.floor), LIMITS.floor),
    levels,
    tempo: {
      depth: Math.round(clamp(num(t.depth, d.tempo.depth), [2, N_LEVELS])),
      seconds: clamp(num(t.seconds, d.tempo.seconds), LIMITS.tempoSeconds),
    },
  };
}

export function loadSettings(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object' && saved.rev !== SETTINGS_REV && saved.floor === OLD_DEFAULT_FLOOR) delete saved.floor;
    return sanitize(saved);
  } catch {
    return sanitize(null);
  }
}

export function saveSettings(settings, storage) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify({ ...settings, rev: SETTINGS_REV }));
    return true;
  } catch {
    return false; // private mode etc.: the panel works without persistence
  }
}

/** Decibels to linear gain. */
export const dbToGain = (db) => Math.pow(10, db / 20);
