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
import { skyOf } from '../../diary/astro/sky.js';
import { placeOf } from '../../diary/places.js';
import { solarDetail, solarLocal, lunarDetail, lunarVisibility, sarosOf } from '../../diary/astro/eclipse-detail.js';
import { findSolarRecord } from '../../diary/geo/saros-geo.js';
import { loadWorld } from '../../diary/geo/world.js';
import { createFormatter, SYSTEM_ZONE } from '../../core/format.js';

const DELTA = 3;
/** The option flags the ephemeris reads (solarSync and majors come from the clock itself, in planDiary). */
const ASTRO_KEYS = ['synodic', 'anomalistic', 'draconic', 'sidereal', 'quarters', 'solar', 'lunistices', 'crossQuarters', 'eclipses', 'planets'];

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

/**
 * The local sky of one Delta (src/diary/astro/sky.js) over a place, memoised on (Delta, place). Null when the sky is
 * off, the place unknown, or the computation fails (the diary prints without it).
 */
export function createSkyCache(size = 2) {
  const memo = new Map();
  return function skyFor(model, delta, place) {
    if (!place) return null;
    const key = `${delta}|${place.lat}|${place.lon}`;
    if (memo.has(key)) return memo.get(key);
    const span = deltaSpan(model, delta);
    let sky = null;
    if (span) {
      try {
        sky = { ...skyOf(span.t0, span.t1, { lat: place.lat, lon: place.lon }), place: place.place ?? null };
      } catch (err) {
        console.warn('[diary] sky failed; planning without it', err);
      }
    }
    memo.set(key, sky);
    while (memo.size > size) memo.delete(memo.keys().next().value);
    return sky;
  };
}

/**
 * The eclipses of a Delta with everything their sheets print: [{ev, detail, local, saros, geo}] and the world map.
 * Circumstances and the Saros series are computed at once; the path data (geo) and the map (world) load
 * asynchronously: until they arrive they are null and `pending` is a promise – build again when it settles.
 *   const ecl = createEclipseCache();  ecl(events, place) -> {list, world, pending}
 */
export function createEclipseCache() {
  const detail = new Map(); // round(t) -> {detail, saros}
  const local = new Map(); // `${round(t)}|lat|lon` -> local circumstances
  const geo = new Map(); // round(t) -> record | null (loaded) ; absent: not asked
  const loading = new Map(); // round(t) -> promise
  let world = null;
  let worldPromise = null;
  return function eclipsesFor(events, place) {
    const list = [];
    const waits = [];
    for (const ev of events) {
      if (ev.family !== 'eclipse') continue;
      const key = Math.round(ev.t);
      const solar = ev.name === 'solar-eclipse';
      let d = detail.get(key);
      if (!d) {
        try {
          d = { detail: solar ? solarDetail(ev) : lunarDetail(ev), saros: sarosOf(ev) };
        } catch (err) {
          console.warn('[diary] eclipse circumstances failed', err);
          d = { detail: null, saros: null };
        }
        detail.set(key, d);
      }
      let loc = null;
      if (place) {
        const lk = `${key}|${place.lat}|${place.lon}`;
        if (!local.has(lk)) {
          try {
            local.set(lk, solar ? solarLocal(ev, place) : lunarVisibility(ev, place));
          } catch (err) {
            console.warn('[diary] local eclipse circumstances failed', err);
            local.set(lk, null);
          }
        }
        loc = local.get(lk);
      }
      if (solar && !geo.has(key)) {
        if (!loading.has(key)) {
          loading.set(
            key,
            findSolarRecord(ev.t, d.saros?.saros)
              .then((r) => geo.set(key, r ?? null))
              .catch((err) => {
                console.warn('[diary] eclipse path data failed', err);
                geo.set(key, null);
              }),
          );
        }
        waits.push(loading.get(key));
      }
      list.push({ ev, ...d, local: loc, geo: geo.get(key) ?? null });
    }
    if (list.some((x) => x.ev.name === 'solar-eclipse') && !world) {
      worldPromise ??= loadWorld()
        .then((w) => (world = w))
        .catch((err) => console.warn('[diary] map data failed', err));
      waits.push(worldPromise);
    }
    return { list, world, pending: waits.length ? Promise.all(waits).then(() => undefined) : null };
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
 * @param {Function} [a.skyCache]    createSkyCache()
 * @param {Function} [a.eclipseCache] createEclipseCache()
 * @returns {{opts, zone, plan, env, title, pending: Promise|null}} `pending`: eclipse path or map data still loading –
 *   build again when it settles to get the maps
 */
export function buildDiary({ model, pure, F, input, delta, appZone, pureMode = false, eventCache, skyCache, eclipseCache }) {
  const opts = sanitizeDiaryOptions(input, { pure: !!pureMode });
  const zone = resolveZone(opts.gregorian.zone, appZone);
  const events = (eventCache ?? createEventCache())(model, delta, opts.events);
  const place = opts.sky.on ? placeOf(opts, zone) : null;
  const sky = place ? (skyCache ?? createSkyCache())(model, delta, place) : null;
  const ecl = opts.inserts.eclipses && opts.events.eclipses ? (eclipseCache ?? createEclipseCache())(events, place ?? placeOf(opts, zone)) : { list: [], world: null, pending: null };
  const plan = planDiary({ model, pure, opts, delta, events, zone, sky, eclipses: ecl.list, world: ecl.world });
  const env = makeEnv({ model, pure, F, zone, pureMode });
  return { opts, zone, plan, env, title: diaryTitle(plan), pending: ecl.pending };
}
