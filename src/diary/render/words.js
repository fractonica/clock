/**
 * What the diary says, in both modes: Gregorian strings (zone-aware through env.fmt), Fractonica strings (SPEC §15 via
 * env.pure), event names and symbols, the major thresholds in words. One context per plan and mode, with caches, so a
 * whole book renders in well under a second.
 *
 * Pure mode (env.pureMode): `greg` is false and nothing here returns Gregorian text; every word follows SPEC §15
 * (no month or weekday names, no clock times, no Earth units, no "Sun" – the scanner reads it as a weekday).
 */
import { MONTHS_SHORT, MONTHS_LONG, WEEKDAYS_SHORT } from '../../core/format.js';
import { palette } from './common.js';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Names and symbols of the astro events, mirroring src/diary/astro (its events carry their own `label`, `labelPure` and
 * `symbol`, which win; this table serves events from elsewhere, e.g. tests).
 */
const EVENTS = {
  'new-moon': ['New Moon', '●'],
  'first-quarter': ['First Quarter', '◐'],
  'full-moon': ['Full Moon', '○'],
  'last-quarter': ['Last Quarter', '◑'],
  perigee: ['Perigee', '■'],
  'post-perigee': ['Post-perigee', '◧'],
  apogee: ['Apogee', '□'],
  'post-apogee': ['Post-apogee', '◨'],
  'ascending-node': ['Ascending node', '☊'],
  'post-ascending': ['Post-ascending', '▲'],
  'descending-node': ['Descending node', '☋'],
  'post-descending': ['Post-descending', '▼'],
  'sidereal-0': ['Sidereal 0°', '★'],
  'sidereal-90': ['Sidereal 90°', '✦'],
  'sidereal-180': ['Sidereal 180°', '☆'],
  'sidereal-270': ['Sidereal 270°', '✧'],
  'march-equinox': ['March equinox', '⊖', 'Northward equinox'],
  'june-solstice': ['June solstice', '◒', 'Northern solstice'],
  'september-equinox': ['September equinox', '⊖', 'Southward equinox'],
  'december-solstice': ['December solstice', '◓', 'Southern solstice'],
  perihelion: ['Perihelion', '◉'],
  aphelion: ['Aphelion', '◎'],
};
export const eventSymbolOf = (name) => EVENTS[name]?.[1];
const FAMILY_SYMBOL = { synodic: '◐', anomalistic: '■', draconic: '☊', sidereal: '★', solar: '⊖', sync: '⊙', major: '◆' };

/** The quarter that runs after a threshold (SPEC §6.2: the Peak quarter ends at the peak). */
const NEXT_QUARTER = { peak: 'Node', node: 'Valley', valley: 'End' };
export const QUARTER_GLYPH = { peak: 4, node: 8, valley: 12, end: 0, begin: 0 };
export const QUARTER_WORD = { peak: 'Peak', node: 'Node', valley: 'Valley', end: 'End' };

/** "Delta Trifracton · Peak ends → Node", "Gamma Nonafracton begins", "Delta Trifracton ends". */
export function majorWords(m) {
  if (m.event === 'begin') return `${m.name} begins`;
  if (m.event === 'end') return `${m.name} ends`;
  return `${m.name} · ${m.quarter} ends → ${NEXT_QUARTER[m.event] ?? ''}`.trim();
}

const CACHE = new WeakMap();

/**
 * The rendering context of a plan in a mode: options, palette, frame helpers and every string the pages need.
 */
export function contextOf(plan, env) {
  const mode = env.pureMode ? 'pure' : 'normal';
  let per = CACHE.get(plan);
  if (!per) CACHE.set(plan, (per = {}));
  if (per[mode] && per[mode].env.pure === env.pure && per[mode].env.fmt === env.fmt) return per[mode];
  return (per[mode] = makeContext(plan, env));
}

function makeContext(plan, env) {
  const opts = plan.opts;
  const pure = env.pure;
  const fmt = env.fmt;
  const pureMode = !!env.pureMode;
  const greg = !pureMode && !!opts.gregorian.on && !!fmt;
  const weekdays = opts.gregorian.weekdays !== false;
  const F = env.F ?? globalThis.Fractonica;

  // ---- Gregorian (rounded to the minute: what the page prints) ----------------------------------------------
  const partsCache = new Map();
  const gp = (t) => {
    const r = Math.round(t / 60) * 60;
    let p = partsCache.get(r);
    if (!p) partsCache.set(r, (p = fmt.parts(r)));
    return p;
  };
  const gTime = (t) => {
    const p = gp(t);
    return `${pad(p.hour)}:${pad(p.minute)}`;
  };
  /** "Mon 3 Nov" (+ year) */
  const gDay = (t, { year = false, weekday = weekdays } = {}) => {
    const p = gp(t);
    return `${weekday ? WEEKDAYS_SHORT[p.weekday] + ' ' : ''}${p.day} ${MONTHS_SHORT[p.month - 1]}${year ? ' ' + p.year : ''}`;
  };
  const gDayTime = (t, o) => `${gDay(t, o)} ${gTime(t)}`;
  const sameDay = (a, b) => {
    const p = gp(a);
    const q = gp(b);
    return p.year === q.year && p.month === q.month && p.day === q.day;
  };
  /** "Mon 3 Nov 14:02–19:05" or "Mon 3 Nov 22:10 – Tue 4 Nov 03:13" */
  const gRange = (t0, t1) => (sameDay(t0, t1) ? `${gDayTime(t0)}–${gTime(t1)}` : `${gDayTime(t0)} – ${gDayTime(t1)}`);
  /** "Mon 3 Nov – Wed 19 Nov" (days only) */
  const gDays = (t0, t1, o) => (sameDay(t0, t1) ? gDay(t0, o) : `${gDay(t0, o)} – ${gDay(t1, o)}`);
  /** "Mon 3 Nov 2026, 14:02": local time of the diary's zone, which the pages never name */
  const gLong = (t) => `${gDay(t, { year: true })}, ${gTime(t)}`;
  const monthName = (m) => MONTHS_LONG[m - 1];

  // ---- Fractonica (a hair after the instant: a boundary reads as what begins) ------------------------------
  const EPS = 0.01;
  const memo = (f) => {
    const c = new Map();
    return (t, ...a) => {
      const k = a.length ? `${t}|${a.join('|')}` : t;
      let v = c.get(k);
      if (v === undefined) c.set(k, (v = f(t, ...a)));
      return v;
    };
  };
  /** "33η 29ι 21λ" */
  const fClock = memo((t, upTo = 'lambda') => pure.clockText(t + EPS, upTo));
  /** "δ#3 ε#2 33η 29ι" (short letters) */
  const fShort = memo((t, upTo = 'iota') => pure.dateText(t + EPS, { letters: true, upTo }));
  /** "α#6 β#4 γ#9 δ#3 ε#2 33η 29ι" */
  const fStamp = memo((t, upTo = 'iota') => pure.stamp(t + EPS, upTo));
  /** "Delta Trifracton Node ε#2 33η 29ι" */
  const fWords = memo((t, upTo = 'iota') => pure.dateText(t + EPS, { upTo }));
  /** "Delta Trifracton Node" */
  const deltaQuarter = memo((t) => pure.majorText(t + EPS, 3));
  /** The name of the Delta that follows this one ("Delta Tetrafracton"), or null at the catalogue end. */
  const nextDelta = (() => {
    let v;
    return () => (v === undefined ? (v = pure.nameAt(plan.delta.t1 + 1, 3)) : v);
  })();

  // ---- events ---------------------------------------------------------------------------------------------
  const eventSymbol = (e) => {
    if (e.family === 'major') return FAMILY_SYMBOL.major;
    if (e.family === 'sync') return FAMILY_SYMBOL.sync;
    return e.symbol || EVENTS[e.name]?.[1] || FAMILY_SYMBOL[e.family] || '•';
  };
  const titleCase = (s) => String(s).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  /** The event's name: the engine's label (labelPure in pure mode), else the table. */
  const eventName = (e) => {
    if (e.family === 'major') return majorWords(e.major);
    if (e.family === 'sync') return `Sync ${e.sync}`;
    const known = EVENTS[e.name];
    if (pureMode) return e.labelPure || known?.[2] || known?.[0] || titleCase(e.name);
    return e.label || known?.[0] || titleCase(e.name);
  };
  const eventLabel = eventName;
  const driftText = (e) => {
    try {
      return pure.driftText({ start: e.t, nominalStart: e.nominalStart, drift: e.drift });
    } catch {
      return '';
    }
  };

  const pal = palette(opts);
  const familyColor = (e) => (e.family === 'major' ? pal.level(e.major.level) : pal.family(e.family));

  // ---- page furniture data ------------------------------------------------------------------------------------
  const helion = (d) => plan.helions[d];
  const lockOrdinal = (k) => k + 1;
  const helionRange = (ds) => {
    const a = plan.helions[ds[0]].num;
    const b = plan.helions[ds.at(-1)].num;
    return a === b ? `${a}η` : `${a}η–${b}η`;
  };

  return {
    plan,
    env,
    opts,
    pure,
    F,
    pureMode,
    greg,
    weekdays,
    pal,
    font: opts.style.font,
    gp,
    gTime,
    gDay,
    gDayTime,
    gRange,
    gDays,
    gLong,
    sameDay,
    monthName,
    fClock,
    fShort,
    fStamp,
    fWords,
    deltaQuarter,
    nextDelta,
    eventSymbol,
    eventName,
    eventLabel,
    driftText,
    familyColor,
    helion,
    lockOrdinal,
    helionRange,
    majorWords,
  };
}
