/**
 * Ephemeris for the diary: lunar, solar and planetary events in a time range (docs/design/90-diary.md, "Ephemeris").
 *
 * events(t0, t1, opts) -> [{ t, family, name, label, labelPure, symbol, jde, ... }] sorted by t (Unix seconds, UTC)
 *   family 'synodic'      new-moon · first-quarter · full-moon · last-quarter
 *          'anomalistic'  perigee · post-perigee · apogee · post-apogee
 *          'draconic'     ascending-node · post-ascending · descending-node · post-descending
 *          'sidereal'     galactic-centre · post-centre · galactic-anticentre · post-anticentre
 *          'lunistice'    moon-north · moon-south
 *          'solar'        march-equinox · june-solstice · september-equinox · december-solstice · perihelion · aphelion
 *                         · cross-quarter-45 · cross-quarter-135 · cross-quarter-225 · cross-quarter-315
 *          'eclipse'      solar-eclipse · lunar-eclipse
 *          'planet'       mercury- / venus-elongation-east · -elongation-west · -inferior-conjunction ·
 *                         -superior-conjunction; mars- / jupiter- / saturn-opposition · -conjunction
 *   opts   { synodic, anomalistic, draconic, sidereal, quarters, solar, lunistices, crossQuarters, eclipses, planets }
 *          booleans (options.events; all default true; other keys are ignored). quarters: false drops the post-*
 *          events and post-centre / post-anticentre. The cross-quarters (family 'solar') follow crossQuarters alone.
 *   jde    the instant as a Julian Ephemeris Day (TT); dist: Earth–Moon distance in km (perigee, apogee), Earth–Sun
 *          distance in AU (perihelion, aphelion) or Earth–planet distance in AU (planet events); dec: the Moon's
 *          apparent declination in degrees (lunistices); kind ('total' | 'annular' | 'hybrid' | 'partial' |
 *          'penumbral'), magnitude and gamma (eclipses, see eclipses.js); elongation: the angular distance from the
 *          Sun in degrees (greatest elongations).
 *   label / labelPure carry the specifics where there are some: "Total solar eclipse", "Moon farthest north 28.4°",
 *          "Mercury east elongation 18.4°"; EVENT_INFO has the generic name.
 *
 * Definitions (all geocentric):
 *   synodic      apparent elongation of the Moon from the Sun (λ☾ − λ☉) = 0°, 90°, 180°, 270°
 *   anomalistic  perigee / apogee = minimum / maximum Earth–Moon distance (centre to centre); post-perigee = halfway in
 *                time between a perigee and the next apogee; post-apogee = halfway between an apogee and the next perigee
 *   draconic     the Moon's ecliptic latitude crosses 0 northward (ascending) / southward (descending); post-ascending =
 *                halfway between an ascending node and the next descending node; post-descending likewise
 *   sidereal     the Moon's ecliptic longitude referred to the fixed mean ecliptic and equinox of J2000.0 equals that of the
 *                galactic centre (Sgr A*, λ = GALACTIC_CENTRE ≈ 266.84°): the Moon passes it; + 180°: the Moon opposes it
 *                (the anticentre); + 90° and + 270°: the states in between (post-centre, post-anticentre)
 *   solar        the Sun's apparent longitude = 0° (March equinox), 90°, 180°, 270°; perihelion / aphelion = minimum /
 *                maximum distance of the Earth's centre from the Sun; cross-quarters: apparent longitude 45°, 135°,
 *                225°, 315°
 *   lunistice    greatest northern / southern apparent declination of the Moon (λ + Δψ, β → δ with the true obliquity)
 *   eclipse      greatest eclipse of a solar or lunar eclipse, its type and magnitude (eclipses.js: Meeus ch. 54,
 *                refined on the series below)
 *   planet       planets.js: greatest elongations and conjunctions of Mercury and Venus, oppositions and conjunctions
 *                of Mars, Jupiter and Saturn (geocentric apparent ecliptic longitude against the Sun's)
 *
 * Maths: Meeus, Astronomical Algorithms (2nd ed.) – Moon ch. 47 (moon.js), Sun ch. 25 with the abridged VSOP87
 * (sun.js), nutation ch. 22 (nutation.js), precession ch. 21 (precession.js), eclipses ch. 54 (eclipses.js), the
 * planets from a truncated VSOP87D (planets.js, vsop87.js); events by bracketing and Brent's method (search.js) in TT,
 * converted to UTC with fractonica.js (time.js).
 */
import { moon } from './moon.js';
import { sun, earthDistance } from './sun.js';
import { toJ2000 } from './precession.js';
import { nutation } from './nutation.js';
import { eclipseEvents } from './eclipses.js';
import { planetEvents } from './planets.js';
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
      ['galactic-centre', 'sidereal', 'Galactic centre', '★'],
      ['post-centre', 'sidereal', 'Post-centre', '✦'],
      ['galactic-anticentre', 'sidereal', 'Galactic anticentre', '☆'],
      ['post-anticentre', 'sidereal', 'Post-anticentre', '✧'],
      ['march-equinox', 'solar', 'March equinox', '⊖', 'Northward equinox'],
      ['june-solstice', 'solar', 'June solstice', '◒', 'Northern solstice'],
      ['september-equinox', 'solar', 'September equinox', '⊖', 'Southward equinox'],
      ['december-solstice', 'solar', 'December solstice', '◓', 'Southern solstice'],
      ['perihelion', 'solar', 'Perihelion', '◉'],
      ['aphelion', 'solar', 'Aphelion', '◎'],
      ['cross-quarter-45', 'solar', 'Cross-quarter 45°', '⊗'],
      ['cross-quarter-135', 'solar', 'Cross-quarter 135°', '⊗'],
      ['cross-quarter-225', 'solar', 'Cross-quarter 225°', '⊗'],
      ['cross-quarter-315', 'solar', 'Cross-quarter 315°', '⊗'],
      ['moon-north', 'lunistice', 'Moon farthest north', '△'],
      ['moon-south', 'lunistice', 'Moon farthest south', '▽'],
      ['solar-eclipse', 'eclipse', 'Solar eclipse', '◍'],
      ['lunar-eclipse', 'eclipse', 'Lunar eclipse', '◕'],
      ['mercury-elongation-east', 'planet', 'Mercury east elongation', '☿'],
      ['mercury-elongation-west', 'planet', 'Mercury west elongation', '☿'],
      ['mercury-inferior-conjunction', 'planet', 'Mercury inferior conjunction', '☿'],
      ['mercury-superior-conjunction', 'planet', 'Mercury superior conjunction', '☿'],
      ['venus-elongation-east', 'planet', 'Venus east elongation', '♀'],
      ['venus-elongation-west', 'planet', 'Venus west elongation', '♀'],
      ['venus-inferior-conjunction', 'planet', 'Venus inferior conjunction', '♀'],
      ['venus-superior-conjunction', 'planet', 'Venus superior conjunction', '♀'],
      ['mars-opposition', 'planet', 'Mars opposition', '♂'],
      ['mars-conjunction', 'planet', 'Mars conjunction', '♂'],
      ['jupiter-opposition', 'planet', 'Jupiter opposition', '♃'],
      ['jupiter-conjunction', 'planet', 'Jupiter conjunction', '♃'],
      ['saturn-opposition', 'planet', 'Saturn opposition', '♄'],
      ['saturn-conjunction', 'planet', 'Saturn conjunction', '♄'],
    ].map(([name, family, label, symbol, labelPure = label]) => [name, Object.freeze({ family, label, labelPure, symbol })]),
  ),
);

/** Families in their sort order (events at the same instant). */
export const FAMILIES = Object.freeze(['synodic', 'anomalistic', 'draconic', 'sidereal', 'lunistice', 'solar', 'eclipse', 'planet']);
/** The option flags of events(), with their defaults. */
export const FLAGS = Object.freeze({
  synodic: true,
  anomalistic: true,
  draconic: true,
  sidereal: true,
  quarters: true,
  solar: true,
  lunistices: true,
  crossQuarters: true,
  eclipses: true,
  planets: true,
});

const PHASES = ['new-moon', 'first-quarter', 'full-moon', 'last-quarter'];
const SEASONS = ['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice'];
const SIDEREAL = ['galactic-centre', 'post-centre', 'galactic-anticentre', 'post-anticentre'];
/**
 * The ecliptic longitude (J2000) of the galactic centre: Sgr A*, α 17h 45m 40.04s, δ −29° 00′ 28.1″ (ICRS), turned to
 * the ecliptic with the J2000 obliquity 23.4392911°. ≈ 266.84°.
 */
export const GALACTIC_CENTRE = (() => {
  const r = Math.PI / 180;
  const a = 266.41683 * r;
  const d = -29.00781 * r;
  const e = 23.4392911 * r;
  const l = Math.atan2(Math.sin(a) * Math.cos(e) + Math.tan(d) * Math.sin(e), Math.cos(a)) / r;
  return (l + 360) % 360;
})();
const CROSS = [45, 135, 225, 315];

// Scan steps (days): the Moon's elongation and longitude advance ≤ 16° a day, its latitude and distance change sign
// about every 13.7 days; the Sun advances ≈ 1° a day and dR/dt changes sign twice a year.
const MOON_STEP = 1;
const SUN_STEP = 10;
// Margin (days) around the range so that the neighbours of a post-* event are found: over 1613–2857 consecutive
// apsides are 11.7–16.1 days apart, consecutive nodes 12.4–14.7 days.
const MARGIN = 20;

const RAD = Math.PI / 180;
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
/** The Moon's apparent declination (degrees): apparent longitude λ + Δψ, latitude β, true obliquity ε. */
export function moonDeclination(jde) {
  const m = moon(jde, POS);
  const n = nutation(jde);
  const l = (m.lambda + n.dpsi) * RAD;
  const b = m.beta * RAD;
  const e = n.eps * RAD;
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) / RAD;
}
/** Rate of the declination (degrees per day, central difference over ±0.01 day). */
const decRate = (t) => (moonDeclination(t + 0.01) - moonDeclination(t - 0.01)) / 0.02;
const ECLIPSE_WORDS = { total: 'Total', annular: 'Annular', hybrid: 'Hybrid', partial: 'Partial', penumbral: 'Penumbral' };
const deg = (x) => `${Math.abs(x).toFixed(1)}°`;

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
    const steps = o.quarters ? [0, 90, 180, 270] : [0, 180];
    const targets = steps.map((s) => (GALACTIC_CENTRE + s) % 360);
    push(angleCrossings(siderealLongitude, a, b, MOON_STEP, targets).map((c) => ({ name: SIDEREAL[steps[targets.indexOf(c.target)] / 90], jde: c.jde })));
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
  if (o.crossQuarters) {
    push(angleCrossings(solarLongitude, a, b, SUN_STEP, CROSS).map((c) => ({ name: `cross-quarter-${c.target}`, jde: c.jde })));
  }
  if (o.lunistices) {
    // the declination's extremes are 13.6 days apart
    push(
      signChanges(decRate, a, b, MOON_STEP).map((c) => {
        const dec = moonDeclination(c.jde);
        const north = !c.rising;
        const label = `Moon farthest ${north ? 'north' : 'south'} ${deg(dec)}`;
        return { name: north ? 'moon-north' : 'moon-south', jde: c.jde, dec, label, labelPure: label };
      }),
    );
  }
  if (o.eclipses) {
    push(
      eclipseEvents(a, b).map((e) => {
        const label = `${ECLIPSE_WORDS[e.kind]} ${e.name === 'solar-eclipse' ? 'solar' : 'lunar'} eclipse`;
        return { ...e, label, labelPure: label };
      }),
    );
  }
  if (o.planets) {
    push(
      planetEvents(a, b).map((e) => {
        if (e.elongation === undefined) return e;
        const label = `${EVENT_INFO[e.name].label} ${deg(e.elongation)}`;
        return { ...e, label, labelPure: label };
      }),
    );
  }
  return found;
}

/** Event fields beyond the common shape. */
const EXTRA = ['dist', 'dec', 'kind', 'magnitude', 'gamma', 'elongation'];

/**
 * Astronomical events in [t0, t1) (Unix seconds, UTC), sorted by time.
 * @param {number} t0
 * @param {number} t1
 * @param {{synodic?: boolean, anomalistic?: boolean, draconic?: boolean, sidereal?: boolean, quarters?: boolean,
 *   solar?: boolean, lunistices?: boolean, crossQuarters?: boolean, eclipses?: boolean, planets?: boolean}} [opts]
 */
export function events(t0, t1, opts = {}) {
  if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0)) return [];
  const o = { ...FLAGS };
  for (const k of Object.keys(o)) if (opts?.[k] !== undefined) o[k] = !!opts[k];
  // TT window with a little slack: the exact [t0, t1) test is made in UTC after conversion
  const slack = 0.01;
  const raw = findEvents(jdeFromUnix(t0) - slack, jdeFromUnix(t1) + slack, o);
  const out = [];
  for (const e of raw) {
    const t = unixFromJde(e.jde);
    if (!(t >= t0 && t < t1)) continue;
    const info = EVENT_INFO[e.name];
    const ev = { t, family: info.family, name: e.name, label: e.label ?? info.label, labelPure: e.labelPure ?? info.labelPure, symbol: info.symbol, jde: e.jde };
    for (const k of EXTRA) if (e[k] !== undefined) ev[k] = e[k];
    out.push(ev);
  }
  const order = (e) => FAMILIES.indexOf(e.family);
  out.sort((x, y) => x.t - y.t || order(x) - order(y));
  return out;
}
