/**
 * Builds a diary from options: the effective options, the zone, the ephemeris, the plan, the renderer's env and the
 * document title. Shared by the Diary tab (src/ui/diary.js) and the command-line export (tools/diary-print.html,
 * driven by tools/diary-pdf.mjs), so both print exactly the same book.
 *
 *   const cache = createEventCache();
 *   const { opts, plan, env, title } = buildDiary({ model, pure, input, delta, appZone, pureMode, eventCache: cache });
 *   printDocument(plan, env, { title });
 */
import { sanitizeDiaryOptions } from '../../diary/options.js';
import { planDiary } from '../../diary/plan.js';
import { events as astroEvents } from '../../diary/astro/index.js';
import { createFormatter, SYSTEM_ZONE } from '../../core/format.js';

const DELTA = 3;
/** The option flags the ephemeris reads (solarSync and majors come from the clock itself, in planDiary). */
const ASTRO_KEYS = ['synodic', 'anomalistic', 'draconic', 'sidereal', 'quarters', 'solar'];

/** "Diary · Delta Trifracton (α#6 β#4 γ#9 δ#3)" */
export const diaryTitle = (plan) => `Diary · ${plan.delta.name} (${plan.delta.stamp})`;

/** Is `z` an IANA zone this runtime knows? */
export function knownZone(z) {
  if (typeof z !== 'string' || !z) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}
/** The zone of the Gregorian references: the diary's own zone, else the app's zone, else the system zone. */
export function resolveZone(optsZone, appZone) {
  if (knownZone(optsZone)) return optsZone;
  if (knownZone(appZone)) return appZone;
  return SYSTEM_ZONE;
}

/** Start and end (Unix s) of Delta `delta`. */
export function deltaSpan(model, delta) {
  const c = model.cycleByIndex(DELTA, delta);
  return c ? { t0: c.start, t1: c.end } : null;
}

/**
 * The ephemeris of one Delta, memoised on (Delta, event families): changing the paper or the lock pattern never
 * recomputes the Moon. `eventsFn` defaults to src/diary/astro events(t0, t1, opts).
 */
export function createEventCache(eventsFn = astroEvents, size = 4) {
  const memo = new Map();
  return function eventsOf(model, delta, families = {}) {
    const key = `${delta}|${ASTRO_KEYS.map((k) => (families[k] ? 1 : 0)).join('')}`;
    if (memo.has(key)) {
      const v = memo.get(key);
      memo.delete(key);
      memo.set(key, v);
      return v;
    }
    const span = deltaSpan(model, delta);
    let list = [];
    if (span) {
      try {
        list = eventsFn(span.t0, span.t1, families) ?? [];
      } catch (err) {
        console.warn('[diary] ephemeris failed; planning without events', err);
        list = [];
      }
    }
    memo.set(key, list);
    while (memo.size > size) memo.delete(memo.keys().next().value);
    return list;
  };
}

/** The renderer's environment (docs/design/90-diary.md): a Gregorian formatter bound to the plan's zone. */
export function makeEnv({ model, pure, F, zone, pureMode }) {
  return { model, pure, F: F ?? model.F, fmt: createFormatter(() => zone), pureMode: !!pureMode };
}

/**
 * Plan one diary.
 * @param {object} a
 * @param {object} a.model     src/core/model.js
 * @param {object} a.pure      src/core/pure.js helpers
 * @param {object} [a.F]       the library (defaults to model.F)
 * @param {object} a.input     options (any partial object; sanitized here for the mode)
 * @param {number} a.delta     global Delta index (deltaRange)
 * @param {string} [a.appZone] the app's zone (used when the options name none)
 * @param {boolean} [a.pureMode]
 * @param {Function} [a.eventCache]  createEventCache()
 */
export function buildDiary({ model, pure, F, input, delta, appZone, pureMode = false, eventCache }) {
  const opts = sanitizeDiaryOptions(input, { pure: !!pureMode });
  const zone = resolveZone(opts.gregorian.zone, appZone);
  const events = (eventCache ?? createEventCache())(model, delta, opts.events);
  const plan = planDiary({ model, pure, opts, delta, events, zone });
  const env = makeEnv({ model, pure, F, zone, pureMode });
  return { opts, zone, plan, env, title: diaryTitle(plan) };
}
