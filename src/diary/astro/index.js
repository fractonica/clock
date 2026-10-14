/**
 * Ephemeris for the diary: lunar and solar events in a time range (docs/design/90-diary.md, "Ephemeris").
 *
 * events(t0, t1, opts) -> [{ t, family, name, label, labelPure, symbol, jde, dist? }] sorted by t (Unix seconds, UTC)
 *   family 'synodic'      new-moon · first-quarter · full-moon · last-quarter
 *          'anomalistic'  perigee · post-perigee · apogee · post-apogee
 *          'draconic'     ascending-node · post-ascending · descending-node · post-descending
 *          'sidereal'     sidereal-0 · sidereal-90 · sidereal-180 · sidereal-270
 *          'solar'        march-equinox · june-solstice · september-equinox · december-solstice · perihelion · aphelion
 *   opts   { synodic, anomalistic, draconic, sidereal, quarters, solar } booleans (options.events; all default true;
 *          other keys are ignored). quarters: false drops the post-* events and sidereal-90 / sidereal-270.
 *   jde    the instant as a Julian Ephemeris Day (TT); dist: Earth–Moon distance in km (perigee, apogee) or Earth–Sun
 *          distance in AU (perihelion, aphelion).
 *
 * Definitions (all geocentric):
 *   synodic      apparent elongation of the Moon from the Sun (λ☾ − λ☉) = 0°, 90°, 180°, 270°
 *   anomalistic  perigee / apogee = minimum / maximum Earth–Moon distance (centre to centre); post-perigee = halfway in
 *                time between a perigee and the next apogee; post-apogee = halfway between an apogee and the next perigee
 *   draconic     the Moon's ecliptic latitude crosses 0 northward (ascending) / southward (descending); post-ascending =
 *                halfway between an ascending node and the next descending node; post-descending likewise
 *   sidereal     the Moon's ecliptic longitude referred to the fixed mean ecliptic and equinox of J2000.0 = 0°, 90°, …
 *   solar        the Sun's apparent longitude = 0° (March equinox), 90°, 180°, 270°; perihelion / aphelion = minimum /
 *                maximum distance of the Earth's centre from the Sun
 *
 * Maths: Meeus, Astronomical Algorithms (2nd ed.) – Moon ch. 47 (moon.js), Sun ch. 25 with the abridged VSOP87
 * (sun.js), nutation ch. 22 (nutation.js), precession ch. 21 (precession.js); events by bracketing and Brent's method
 * (search.js) in TT, converted to UTC with fractonica.js (time.js).
 */
import { moon } from './moon.js';
import { sun, earthDistance } from './sun.js';
import { toJ2000 } from './precession.js';
import { angleCrossings, signChanges } from './search.js';
import { jdeFromUnix, unixFromJde } from './time.js';

/** name → {family, label, labelPure, symbol}. Symbols are plain (non-emoji) Unicode marks found in system fonts. */
export const EVENT_INFO = Object.freeze(
  Object.fromEntries(
    [
      ['new-moon', 'synodic', 'New Moon', '●'],
      ['first-quarter', 'synodic', 'First Quarter', '◐'],
      ['full-moon', 'synodic', 'Full Moon', '○'],
      ['last-quarter', 'synodic', 'Last Quarter', '◑'],
      ['perigee', 'anomalistic', 'Perigee', '■'],
      ['post-perigee', 'anomalistic', 'Post-perigee', '◧'],
      ['apogee', 'anomalistic', 'Apogee', '□'],
      ['post-apogee', 'anomalistic', 'Post-apogee', '◨'],
      ['ascending-node', 'draconic', 'Ascending node', '☊'],
      ['post-ascending', 'draconic', 'Post-ascending', '▲'],
      ['descending-node', 'draconic', 'Descending node', '☋'],
      ['post-descending', 'draconic', 'Post-descending', '▼'],
      ['sidereal-0', 'sidereal', 'Sidereal 0°', '★'],
      ['sidereal-90', 'sidereal', 'Sidereal 90°', '✦'],
      ['sidereal-180', 'sidereal', 'Sidereal 180°', '☆'],
      ['sidereal-270', 'sidereal', 'Sidereal 270°', '✧'],
      ['march-equinox', 'solar', 'March equinox', '⊖', 'Northward equinox'],
      ['june-solstice', 'solar', 'June solstice', '◒', 'Northern solstice'],
      ['september-equinox', 'solar', 'September equinox', '⊖', 'Southward equinox'],
      ['december-solstice', 'solar', 'December solstice', '◓', 'Southern solstice'],
      ['perihelion', 'solar', 'Perihelion', '◉'],
      ['aphelion', 'solar', 'Aphelion', '◎'],
    ].map(([name, family, label, symbol, labelPure = label]) => [name, Object.freeze({ family, label, labelPure, symbol })]),
  ),
);

export const FAMILIES = Object.freeze(['synodic', 'anomalistic', 'draconic', 'sidereal', 'solar']);

const PHASES = ['new-moon', 'first-quarter', 'full-moon', 'last-quarter'];
const SEASONS = ['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice'];
const SIDEREAL = ['sidereal-0', 'sidereal-90', 'sidereal-180', 'sidereal-270'];

// Scan steps (days): the Moon's elongation and longitude advance ≤ 16° a day, its latitude and distance change sign
// about every 13.7 days; the Sun advances ≈ 1° a day and dR/dt changes sign twice a year.
const MOON_STEP = 1;
const SUN_STEP = 10;
// Margin (days) around the range so that the neighbours of a post-* event are found: over 1613–2857 consecutive
// apsides are 11.7–16.1 days apart, consecutive nodes 12.4–14.7 days.
const MARGIN = 20;

const LON = { lon: true };
const LAT = { lat: true };
const POS = { lon: true, lat: true };
const DIST = { dist: true };

/** Apparent elongation in longitude of the Moon from the Sun, λ☾ − λ☉ (degrees); nutation cancels and is left out. */
export const elongation = (jde) => moon(jde, LON).lambda - sun(jde, { withNutation: false }).apparent;
/** The Moon's ecliptic longitude referred to the mean ecliptic and equinox of J2000.0 (degrees). */
export function siderealLongitude(jde) {
  const m = moon(jde, POS);
  return toJ2000(m.lambda, m.beta, jde).lambda;
}
/** The Sun's apparent longitude (degrees). */
export const solarLongitude = (jde) => sun(jde).apparent;

/** Halfway (in time) events between consecutive alternating extremes. */
function midpoints(list, first, second, nameAfterFirst, nameAfterSecond) {
  const out = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (a.name === first && b.name === second) out.push({ name: nameAfterFirst, jde: (a.jde + b.jde) / 2 });
    else if (a.name === second && b.name === first) out.push({ name: nameAfterSecond, jde: (a.jde + b.jde) / 2 });
  }
  return out;
}

/** Raw events of every enabled family in the TT window [a, b) (JDE), unsorted: [{name, jde, dist?}]. */
export function findEvents(a, b, o) {
  const found = [];
  const push = (list) => {
    for (const e of list) if (e.jde >= a && e.jde < b) found.push(e);
  };
  if (o.synodic) {
    push(angleCrossings(elongation, a, b, MOON_STEP, [0, 90, 180, 270]).map((c) => ({ name: PHASES[c.target / 90], jde: c.jde })));
  }
  if (o.sidereal) {
    const targets = o.quarters ? [0, 90, 180, 270] : [0, 180];
    push(angleCrossings(siderealLongitude, a, b, MOON_STEP, targets).map((c) => ({ name: SIDEREAL[c.target / 90], jde: c.jde })));
  }
  if (o.anomalistic) {
    const ext = signChanges((t) => moon(t, DIST).dDist, a - MARGIN, b + MARGIN, MOON_STEP).map((c) => ({
      name: c.rising ? 'perigee' : 'apogee',
      jde: c.jde,
      dist: moon(c.jde, DIST).dist,
    }));
    push(ext);
    if (o.quarters) push(midpoints(ext, 'perigee', 'apogee', 'post-perigee', 'post-apogee'));
  }
  if (o.draconic) {
    const nodes = signChanges((t) => moon(t, LAT).beta, a - MARGIN, b + MARGIN, MOON_STEP).map((c) => ({
      name: c.rising ? 'ascending-node' : 'descending-node',
      jde: c.jde,
    }));
    push(nodes);
    if (o.quarters) push(midpoints(nodes, 'ascending-node', 'descending-node', 'post-ascending', 'post-descending'));
  }
  if (o.solar) {
    push(angleCrossings(solarLongitude, a, b, SUN_STEP, [0, 90, 180, 270]).map((c) => ({ name: SEASONS[c.target / 90], jde: c.jde })));
    push(
      signChanges((t) => earthDistance(t).dR, a, b, SUN_STEP).map((c) => ({
        name: c.rising ? 'perihelion' : 'aphelion',
        jde: c.jde,
        dist: earthDistance(c.jde).R,
      })),
    );
  }
  return found;
}

/**
 * Astronomical events in [t0, t1) (Unix seconds, UTC), sorted by time.
 * @param {number} t0
 * @param {number} t1
 * @param {{synodic?: boolean, anomalistic?: boolean, draconic?: boolean, sidereal?: boolean, quarters?: boolean, solar?: boolean}} [opts]
 */
export function events(t0, t1, opts = {}) {
  if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0)) return [];
  const o = { synodic: true, anomalistic: true, draconic: true, sidereal: true, quarters: true, solar: true };
  for (const k of Object.keys(o)) if (opts?.[k] !== undefined) o[k] = !!opts[k];
  // TT window with a little slack: the exact [t0, t1) test is made in UTC after conversion
  const slack = 0.01;
  const raw = findEvents(jdeFromUnix(t0) - slack, jdeFromUnix(t1) + slack, o);
  const out = [];
  for (const e of raw) {
    const t = unixFromJde(e.jde);
    if (!(t >= t0 && t < t1)) continue;
    const info = EVENT_INFO[e.name];
    const ev = { t, family: info.family, name: e.name, label: info.label, labelPure: info.labelPure, symbol: info.symbol, jde: e.jde };
    if (e.dist !== undefined) ev.dist = e.dist;
    out.push(ev);
  }
  const order = (e) => FAMILIES.indexOf(e.family);
  out.sort((x, y) => x.t - y.t || order(x) - order(y));
  return out;
}
