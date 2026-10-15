/**
 * The diary ephemeris (src/diary/astro): the series against Meeus' worked examples, the events against published
 * times, and the API contract of events(t0, t1, opts).
 *
 * Reference sources (each value below was checked against its source):
 *   [M]  J. Meeus, Astronomical Algorithms, 2nd ed. (1998), worked examples 21.c, 22.a, 25.b, 27.a, 47.a, 49.a, 50.a,
 *        51.a. The tables of moon.js / sun.js / nutation.js were also compared term by term with two independent
 *        transcriptions: astronomia (github.com/commenthol/astronomia, src/moonposition.js, tables 47.A/47.B) and pvlib
 *        (github.com/pvlib/pvlib-python, pvlib/spa.py: the NREL SPA uses Meeus' abridged VSOP87 L0–L5, B0–B1, R0–R4
 *        and the 63-term nutation table 22.A) – identical.
 *   [E1] F. Espenak, "Phases of the Moon 2001 to 2100", https://astropixels.com/ephemeris/phasescat/phases2001.html (UT)
 *   [E2] F. Espenak, "Earth at Perihelion and Aphelion 2001 to 2100", https://astropixels.com/ephemeris/perap2001.html
 *        (GMT, computed with JPL DE405)
 *   [E3] F. Espenak, "Solstices and Equinoxes 2001 to 2100", https://astropixels.com/ephemeris/soleq2001.html (GMT,
 *        Meeus' algorithms)
 *   [E4] F. Espenak, "Moon at Perigee and Apogee 2001 to 2100",
 *        https://astropixels.com/ephemeris/moon/moonperap2001.html (GMT). These times are a few minutes to ~15 min off
 *        JPL (e.g. the perigee of 2024-06-27: 11:45 here, 11:30 UT from JPL – below), so they get the design tolerance.
 *   [H]  JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api, DE441), geocentre (500@399). The instants below are
 *        the linear interpolation of the sign change in a 2-minute (10/20-minute for distances) tabulation, in TT:
 *        - phases / equinoxes: QUANTITIES=31 (ObsEcLon, apparent ecliptic longitude of date) of the Moon (301) and the
 *          Sun (10); the elongation is their difference;
 *        - nodes: ObsEcLat of the Moon;
 *        - sidereal 0°: EPHEM_TYPE=VECTORS, REF_PLANE=ECLIPTIC (ecliptic of J2000.0), VEC_CORR=NONE, Y = 0 with X > 0;
 *        - perigee / apogee / perihelion: VEC_TABLE=3, range-rate RR = 0 (range RG quoted).
 *   [N]  F. Espenak (NASA GSFC), Five Millennium Catalog of Solar Eclipses (SEcat5, SE1701–SE2200; TD of greatest
 *        eclipse, type, γ, magnitude) and Catalog of Lunar Eclipses (LEcat, 1701–2200; UT to the minute, type, umbral and
 *        penumbral magnitudes). Over the whole of 1701–2200 (checked offline, not in this file): solar – 1180 eclipses,
 *        all found, greatest eclipse within 0.3 min (rms 0.09), γ within 0.0044, 8 types differ (hybrid ↔ total /
 *        annular at the boundary; 2 annular-or-partial at |γ| ≈ 1), 3 extra partial eclipses of magnitude < 0.01 at
 *        |γ| ≈ 1.55; lunar – 1210 eclipses, all found, none extra, every type equal, greatest eclipse within 0.94 min of
 *        the catalogue's UT turned into TD with Espenak & Meeus' ΔT, magnitudes within 0.0024.
 *   [S]  Skyfield 1.53 with JPL DE440 (geocentre; apparent places of date): planets – oppositions and conjunctions
 *        (almanac.oppositions_conjunctions), greatest elongations (maxima of the separation from the Sun); the Moon's
 *        extreme declinations (radec(epoch='date')); the Sun's apparent ecliptic longitude of date for the
 *        cross-quarters. Instants in TT. Over 1620–1625, 1800–1803, 2024–2028, 2400–2403 and 2600–2604 (371 planetary
 *        events): Mercury within 0.9 min, Venus 2.0, Mars 3.0, Jupiter 0.9, Saturn 0.9; elongations within 1";
 *        lunistices within 0.8 min and 3" (1620–2602, 188 events); cross-quarters within 0.9 min.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { events, findEvents, EVENT_INFO, FAMILIES, FLAGS, elongation, siderealLongitude, GALACTIC_CENTRE } from '../src/diary/astro/index.js';
import { moon } from '../src/diary/astro/moon.js';
import { sun, earth, earthSunDistance } from '../src/diary/astro/sun.js';
import { nutation } from '../src/diary/astro/nutation.js';
import { precessEcliptic } from '../src/diary/astro/precession.js';
import { jdeFromUnix, unixFromJde, JD_UNIX_EPOCH } from '../src/diary/astro/time.js';
import { wrap180 } from '../src/diary/astro/search.js';

const ALL = { synodic: true, anomalistic: true, draconic: true, sidereal: true, quarters: true, solar: true };
/** Only the original lunar and solar families (the new ones off). */
const CLASSIC = { ...ALL, lunistices: false, crossQuarters: false, eclipses: false, planets: false };
/** The generic label of an event plus its specifics (see index.js). */
const KIND = { total: 'Total', annular: 'Annular', hybrid: 'Hybrid', partial: 'Partial', penumbral: 'Penumbral' };
const specificLabel = (e) => {
  const info = EVENT_INFO[e.name];
  if (e.family === 'lunistice') return `${info.label} ${Math.abs(e.dec).toFixed(1)}°`;
  if (e.family === 'eclipse') return `${KIND[e.kind]} ${e.name === 'solar-eclipse' ? 'solar' : 'lunar'} eclipse`;
  if (e.elongation !== undefined) return `${info.label} ${e.elongation.toFixed(1)}°`;
  return info.label;
};
const AS = 1 / 3600;
const MIN = 60;
/** ISO (UTC, no zone suffix needed) → Unix seconds. */
const U = (iso) => Date.parse(iso.endsWith('Z') ? iso : iso + 'Z') / 1000;
/** ISO in TT → JDE. */
const J = (iso) => U(iso) / 86400 + JD_UNIX_EPOCH;
/** The event `name` nearest to the reference (Unix s) in a list. */
const nearest = (list, name, t) =>
  list.filter((e) => e.name === name).reduce((b, e) => (b === null || Math.abs(e.t - t) < Math.abs(b.t - t) ? e : b), null);
/** The event `name` nearest to a TT instant (JDE), searched ±3 days around it. */
const nearestTT = (name, jde, o = ALL) => findEvents(jde - 3, jde + 3, o).filter((e) => e.name === name).sort((a, b) => Math.abs(a.jde - jde) - Math.abs(b.jde - jde))[0];
const minutes = (dDays) => dDays * 1440;

// ---------------------------------------------------------------------------------------------------------------------
// The series against Meeus' worked examples

test('Moon, Meeus 47.a: 1992-04-12 0h TD – the sums Σl Σb Σr to the last unit, λ β Δ', () => {
  const m = moon(2448724.5);
  assert.equal(Math.round(m.sl), -1127527);
  assert.equal(Math.round(m.sb), -3229126);
  assert.equal(Math.round(m.sr), -16590875);
  assert.ok(Math.abs(m.lambda - 133.162655) < 1e-6, `λ ${m.lambda}`);
  assert.ok(Math.abs(m.beta - -3.229126) < 1e-6, `β ${m.beta}`);
  assert.ok(Math.abs(m.dist - 368409.7) < 0.05, `Δ ${m.dist}`);
  // the partial evaluations agree with the full one, and dΔ/dt is the derivative of Δ
  assert.equal(moon(2448724.5, { lon: true }).lambda, m.lambda);
  assert.equal(moon(2448724.5, { lat: true }).beta, m.beta);
  assert.equal(moon(2448724.5, { dist: true }).dist, m.dist);
  const h = 1e-4;
  const num = (moon(2448724.5 + h, { dist: true }).dist - moon(2448724.5 - h, { dist: true }).dist) / (2 * h);
  assert.ok(Math.abs(m.dDist - num) < 0.05, `dΔ/dt ${m.dDist} vs ${num} km/day`);
});

test('nutation, Meeus 22.a: 1987-04-10 0h TD', () => {
  const n = nutation(2446895.5);
  assert.ok(Math.abs(n.dpsi / AS - -3.788) < 0.0005, `Δψ ${n.dpsi / AS}"`);
  assert.ok(Math.abs(n.deps / AS - 9.443) < 0.0005, `Δε ${n.deps / AS}"`);
  assert.ok(Math.abs((n.eps0 - 23 - 26 / 60) / AS - 27.407) < 0.0005, 'ε0 = 23°26′27.407″');
  assert.ok(Math.abs((n.eps - 23 - 26 / 60) / AS - 36.85) < 0.0005, 'ε = 23°26′36.850″');
});

test('Sun, Meeus 25.b: 1992-10-13 0h TD with the abridged VSOP87', () => {
  const e = earth(2448908.5);
  assert.ok(Math.abs(e.L - -43.63484796) < 5e-9, `L ${e.L}`);
  assert.ok(Math.abs(e.B - -0.00000312) < 5e-9, `B ${e.B}`);
  assert.ok(Math.abs(e.R - 0.99760775) < 5e-9, `R ${e.R}`);
  const s = sun(2448908.5);
  // Meeus: apparent λ = 199°54′21.818″ (geometric 199.907372° before the FK5 correction of −0.09033″)
  assert.ok(Math.abs((s.geo + 0.09033 * AS) - 199.907372) < 1e-6, `Θ ${s.geo}`);
  assert.ok(Math.abs((s.apparent - 199 - 54 / 60) / AS - 21.818) < 0.005, `λ ${s.apparent}`);
});

test('precession, Meeus 21.c: J2000.0 → −214 June 30.0 TD (and back)', () => {
  const p = precessEcliptic(149.48194, 1.76549, 2451545, 1643074.5);
  assert.ok(Math.abs(p.lambda - 118.704) < 0.0005, `λ ${p.lambda}`);
  assert.ok(Math.abs(p.beta - 1.615) < 0.0005, `β ${p.beta}`);
  // the reverse precession (polynomials in the other epoch) closes to well under 0.01″ over 22 centuries
  const back = precessEcliptic(p.lambda, p.beta, 1643074.5, 2451545);
  assert.ok(Math.abs(back.lambda - 149.48194) < 0.01 * AS && Math.abs(back.beta - 1.76549) < 0.01 * AS);
});

test('time scales: TT − UTC from the library (leap seconds; NASA ΔT before 1972)', () => {
  const t = U('2024-01-01T00:00:00');
  assert.ok(Math.abs((jdeFromUnix(t) - JD_UNIX_EPOCH) * 86400 - t - 69.184) < 1e-3, 'TT − UTC = 37 s + 32.184 s');
  for (const x of [t, U('1650-03-02T11:00:00'), U('2800-03-16T14:00:00'), t + 0.123]) {
    assert.ok(Math.abs(unixFromJde(jdeFromUnix(x)) - x) < 1e-3, `round trip at ${x}`);
  }
  const dt1650 = (jdeFromUnix(U('1650-03-02T11:00:00')) - JD_UNIX_EPOCH) * 86400 - U('1650-03-02T11:00:00');
  assert.ok(dt1650 > 30 && dt1650 < 80, `ΔT(1650) ≈ 50 s, got ${dt1650}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The searches against Meeus' event examples (all in TD = TT)

test('Meeus 49.a: new Moon of 1977 Feb 18, 03:37:42 TD (JDE 2443192.65118)', () => {
  const e = nearestTT('new-moon', 2443192.65118);
  assert.ok(Math.abs(minutes(e.jde - 2443192.65118)) < 2, `${minutes(e.jde - 2443192.65118)} min`); // found: +4 s
});

test('Meeus 50.a: apogee of 1988 Oct 7, ≈ 20:30 TD (JDE 2447442.3543), parallax 3240.679″', () => {
  const e = nearestTT('apogee', 2447442.3543);
  assert.ok(Math.abs(minutes(e.jde - 2447442.3543)) < 30, `${minutes(e.jde - 2447442.3543)} min`); // found: +2 min
  const km = 6378.14 / Math.sin(3240.679 * AS * (Math.PI / 180));
  assert.ok(Math.abs(e.dist - km) < 20, `${e.dist} vs ${km} km`);
});

test('Meeus 51.a: ascending node of 1987 May 23 (JDE 2446938.76803); JPL: 06:25:35 TT', () => {
  const e = nearestTT('ascending-node', 2446938.76803);
  assert.ok(Math.abs(minutes(e.jde - 2446938.76803)) < 2, `${minutes(e.jde - 2446938.76803)} min`); // found: −59 s
  assert.ok(Math.abs(minutes(e.jde - J('1987-05-23T06:25:35'))) < 1.5, 'against [H]'); // found: −36 s
});

test('Meeus 27.a: June solstice of 1962 (JDE 2437837.39245)', () => {
  const e = nearestTT('june-solstice', 2437837.39245);
  assert.ok(Math.abs(minutes(e.jde - 2437837.39245)) < 2, `${minutes(e.jde - 2437837.39245)} min`); // found: −28 s
});

// ---------------------------------------------------------------------------------------------------------------------
// Published times

// [E1] 2024, UT, rounded to the minute.
const PHASES_2024 = {
  'new-moon': '01-11 11:57, 02-09 22:59, 03-10 09:00, 04-08 18:21, 05-08 03:22, 06-06 12:38, 07-05 22:57, 08-04 11:13, 09-03 01:56, 10-02 18:49, 11-01 12:47, 12-01 06:22, 12-30 22:27',
  'first-quarter': '01-18 03:53, 02-16 15:01, 03-17 04:11, 04-15 19:13, 05-15 11:48, 06-14 05:18, 07-13 22:49, 08-12 15:19, 09-11 06:06, 10-10 18:55, 11-09 05:56, 12-08 15:27',
  'full-moon': '01-25 17:54, 02-24 12:30, 03-25 07:00, 04-23 23:49, 05-23 13:53, 06-22 01:08, 07-21 10:17, 08-19 18:26, 09-18 02:34, 10-17 11:26, 11-15 21:29, 12-15 09:02',
  'last-quarter': '01-04 03:30, 02-02 23:18, 03-03 15:24, 04-02 03:15, 05-01 11:27, 05-30 17:13, 06-28 21:53, 07-28 02:51, 08-26 09:26, 09-24 18:50, 10-24 08:03, 11-23 01:28, 12-22 22:18',
};
// [E4] 2024, GMT.
const APSIDES_2024 = {
  perigee: '01-13 10:35, 02-10 18:49, 03-10 07:06, 04-07 17:53, 05-05 22:11, 06-02 07:23, 06-27 11:45, 07-24 05:43, 08-21 05:05, 09-18 13:26, 10-17 00:46, 11-14 11:18, 12-12 13:18',
  apogee: '01-01 15:28, 01-29 08:14, 02-25 15:00, 03-23 15:44, 04-20 02:09, 05-17 19:00, 06-14 13:36, 07-12 08:12, 08-09 01:32, 09-05 14:55, 10-02 19:40, 10-29 22:50, 11-26 11:56, 12-24 07:25',
};
const list2024 = (s) => s.split(', ').map((x) => U(`2024-${x.replace(' ', 'T')}`));
const year2024 = events(U('2023-12-20'), U('2025-01-10'));

test('2024 Moon phases within 1 min of the published times [E1]', () => {
  for (const [name, s] of Object.entries(PHASES_2024)) {
    for (const t of list2024(s)) {
      const e = nearest(year2024, name, t);
      assert.ok(Math.abs(e.t - t) < 1 * MIN, `${name} ${new Date(t * 1000).toISOString()}: ${(e.t - t) / MIN} min`); // found: ≤ 0.6
    }
  }
  assert.equal(year2024.filter((e) => e.name === 'new-moon' && e.t >= U('2024-01-01') && e.t < U('2025-01-01')).length, 13);
});

test('2024 perigees and apogees within 30 min of [E4], and within 5 min / 15 km of JPL [H]', () => {
  for (const [name, s] of Object.entries(APSIDES_2024)) {
    for (const t of list2024(s)) {
      const e = nearest(year2024, name, t);
      assert.ok(Math.abs(e.t - t) < 30 * MIN, `${name} ${new Date(t * 1000).toISOString()}: ${(e.t - t) / MIN} min`); // found: ≤ 13.6
    }
  }
  // [H] range-rate zero crossings (TT) and ranges
  for (const [name, iso, km] of [
    ['perigee', '2024-06-27T11:31:17', 369286.2], // [E4] 11:45 GMT, i.e. 11:46 TT – 15 min late
    ['perigee', '2024-10-17T00:52:09', 357174.5],
    ['apogee', '2024-10-02T19:40:14', 406515.6],
    ['perigee', '1650-03-21T14:32:43', 367101.7],
    ['perigee', '2800-03-06T15:17:24', 368142.3],
  ]) {
    const e = nearestTT(name, J(iso));
    assert.ok(Math.abs(minutes(e.jde - J(iso))) < 5, `${name} ${iso}: ${minutes(e.jde - J(iso))} min`); // found: ≤ 2.6
    assert.ok(Math.abs(e.dist - km) < 15, `${name} ${iso}: ${e.dist} km vs ${km}`); // found: ≤ 4
  }
});

test('equinoxes and solstices: 2024 within 30 s of JPL [H], 2025–2026 within 1.5 min of [E3]', () => {
  // [H] Sun's apparent longitude = 0°, 90°, 180°, 270° (TT); with TT − UTC = 69.184 s these are 03:06:25, 20:51:01,
  // 12:43:41, 09:20:35 UT ([E3] rounds them to 03:07, 20:51, 12:44, 09:20)
  for (const [name, iso] of [
    ['march-equinox', '2024-03-20T03:07:34.5'],
    ['june-solstice', '2024-06-20T20:52:10.2'],
    ['september-equinox', '2024-09-22T12:44:49.9'],
    ['december-solstice', '2024-12-21T09:21:44.5'],
    ['march-equinox', '1650-03-20T11:43:28.4'],
    ['march-equinox', '2800-03-20T05:48:27.9'],
  ]) {
    const e = nearestTT(name, J(iso));
    assert.ok(Math.abs(minutes(e.jde - J(iso))) < 0.5, `${name} ${iso}: ${minutes(e.jde - J(iso)) * 60} s`); // found: ≤ 9 s
  }
  const two = events(U('2025-01-01'), U('2027-01-01'), { synodic: false, anomalistic: false, draconic: false, sidereal: false });
  for (const [name, list] of Object.entries({
    'march-equinox': ['2025-03-20T09:02', '2026-03-20T14:46'],
    'june-solstice': ['2025-06-21T02:42', '2026-06-21T08:25'],
    'september-equinox': ['2025-09-22T18:20', '2026-09-23T00:06'],
    'december-solstice': ['2025-12-21T15:03', '2026-12-21T20:50'],
  })) {
    for (const iso of list) {
      const e = nearest(two, name, U(iso));
      assert.ok(Math.abs(e.t - U(iso)) < 1.5 * MIN, `${name} ${iso}: ${(e.t - U(iso)) / MIN} min`);
    }
  }
});

// [E2] DE405, GMT: perihelion and aphelion of each year 2001–2100 ("YYYY MMDD HHMM MMDD HHMM").
const PERAP = `
2001 0104 0852 0704 1337|2002 0102 1409 0706 0347|2003 0104 0502 0704 0540|2004 0104 1742 0705 1054|2005 0102 0035 0705 0458
2006 0104 1530 0703 2310|2007 0103 1943 0706 2353|2008 0102 2351 0704 0741|2009 0104 1530 0704 0140|2010 0103 0009 0706 1130
2011 0103 1832 0704 1454|2012 0105 0032 0705 0332|2013 0102 0438 0705 1444|2014 0104 1159 0704 0013|2015 0104 0636 0706 1940
2016 0102 2249 0704 1624|2017 0104 1418 0703 2011|2018 0103 0535 0706 1647|2019 0103 0520 0704 2211|2020 0105 0748 0704 1135
2021 0102 1351 0705 2227|2022 0104 0655 0704 0711|2023 0104 1617 0706 2007|2024 0103 0039 0705 0506|2025 0104 1328 0703 1955
2026 0103 1716 0706 1731|2027 0103 0233 0705 0506|2028 0105 1228 0703 2218|2029 0102 1813 0706 0512|2030 0103 1012 0704 1258
2031 0104 2048 0706 0710|2032 0103 0511 0705 1154|2033 0104 1151 0703 2052|2034 0104 0447 0706 1849|2035 0103 0054 0705 1822
2036 0105 1417 0703 2117|2037 0103 0400 0706 1205|2038 0103 0501 0704 1946|2039 0105 0641 0705 1325|2040 0103 1133 0705 1902
2041 0103 2152 0704 0138|2042 0104 0907 0706 1310|2043 0102 2215 0706 0225|2044 0105 1252 0703 1524|2045 0103 1456 0706 1251
2046 0103 0058 0705 0606|2047 0105 1144 0705 0632|2048 0103 1805 0706 0508|2049 0103 1027 0704 0906|2050 0104 1935 0706 0157
2051 0103 0532 0706 1024|2052 0105 0918 0703 1638|2053 0103 2218 0706 1230|2054 0102 1759 0705 1541|2055 0105 1224 0704 2052
2056 0104 0344 0706 0854|2057 0103 0311 0704 1641|2058 0105 0400 0705 1542|2059 0103 1044 0706 2125|2060 0104 2256 0703 2259
2061 0104 0733 0706 0720|2062 0102 2116 0705 2347|2063 0105 1341 0704 1521|2064 0104 1154 0706 1056|2065 0102 1510 0705 0137
2066 0105 0545 0705 0143|2067 0103 1705 0707 0313|2068 0104 1429 0704 0407|2069 0104 1825 0705 2315|2070 0103 0251 0706 1201
2071 0105 0944 0704 2040|2072 0104 2102 0706 1326|2073 0102 1441 0705 1053|2074 0105 1125 0704 1425|2075 0104 0214 0707 0643
2076 0103 2333 0704 1119|2077 0104 2053 0705 1010|2078 0103 0423 0706 1939|2079 0105 0015 0704 2126|2080 0105 0755 0706 0641
2081 0102 1856 0705 2126|2082 0105 1351 0704 1622|2083 0104 1128 0707 1514|2084 0103 1649 0704 2243|2085 0105 0433 0704 2134
2086 0103 1522 0707 0139|2087 0104 1638 0705 0206|2088 0105 1459 0705 2211|2089 0102 1701 0706 0715|2090 0105 0445 0704 1509
2091 0104 1922 0707 1255|2092 0103 1529 0705 0557|2093 0105 1016 0704 1321|2094 0104 0017 0707 1007|2095 0104 0356 0705 1309
2096 0105 2156 0705 1339|2097 0103 0052 0706 1604|2098 0105 0234 0704 1643|2099 0105 0618 0707 0808|2100 0103 1354 0706 1558`;

test('perihelion and aphelion 2001–2100 against JPL DE405 [E2]: max < 30 min, rms < 8 min; JPL [H] 1650, 2800', () => {
  const solar = events(U('2000-12-01'), U('2101-01-01'), { synodic: false, anomalistic: false, draconic: false, sidereal: false });
  const at = (y, md, hm) => U(`${y}-${md.slice(0, 2)}-${md.slice(2)}T${hm.slice(0, 2)}:${hm.slice(2)}`);
  const errs = [];
  for (const row of PERAP.trim().split(/[|\n]/)) {
    const [y, pd, ph, ad, ah] = row.split(' ');
    for (const [name, t] of [['perihelion', at(y, pd, ph)], ['aphelion', at(y, ad, ah)]]) {
      const e = nearest(solar, name, t);
      errs.push((e.t - t) / MIN);
      assert.ok(Math.abs(e.t - t) < 30 * MIN, `${name} ${y}: ${(e.t - t) / MIN} min`); // found: ≤ 15.6
    }
  }
  const rms = Math.sqrt(errs.reduce((s, x) => s + x * x, 0) / errs.length);
  assert.ok(rms < 8, `rms ${rms} min`); // found: ≈ 4.9
  assert.equal(solar.filter((e) => e.name === 'perihelion').length, 100);
  assert.equal(solar.filter((e) => e.name === 'aphelion').length, 100);
  // [H] range-rate of the Sun from the geocentre = 0 (TT), range in AU
  for (const [iso, au] of [['1650-12-29T12:01:22', 0.98314219], ['2800-01-17T18:53:12', 0.98367673]]) {
    const e = nearestTT('perihelion', J(iso));
    assert.ok(Math.abs(minutes(e.jde - J(iso))) < 15, `perihelion ${iso}: ${minutes(e.jde - J(iso))} min`); // found: ≤ 5.6
    assert.ok(Math.abs(e.dist - au) < 3e-6, `${e.dist} AU`);
  }
});

test('JPL [H] in 1650, 1987, 2024 and 2800: new Moons, nodes and sidereal 0° (TT)', () => {
  for (const [name, iso, tolMin] of [
    ['new-moon', '1650-03-02T11:40:25.6', 0.5], // found: −3 s
    ['new-moon', '2800-03-16T14:49:34.3', 0.5], // found: −1 s
    ['ascending-node', '1650-03-07T19:55:22.3', 1.5], // found: −33 s
    ['ascending-node', '2800-03-27T12:25:17.8', 1.5], // found: −47 s
  ]) {
    const e = nearestTT(name, J(iso));
    assert.ok(Math.abs(minutes(e.jde - J(iso))) < tolMin, `${name} ${iso}: ${minutes(e.jde - J(iso)) * 60} s`);
  }
  // the functions behind them are where they should be at the found instants
  const nm = nearestTT('new-moon', J('2024-01-11T11:58'));
  assert.ok(Math.abs(wrap180(elongation(nm.jde))) < 1e-6);
  // the sidereal longitude that the JPL check above validated (0° at 2024-03-11T00:52:18.8 TT) …
  assert.ok(Math.abs(wrap180(siderealLongitude(J('2024-03-11T00:52:18.8')))) < 0.005);
  // … is where the galactic-centre events sit: λ = 266.84° (Sgr A*), + 90°, + 180°, + 270°
  assert.ok(Math.abs(GALACTIC_CENTRE - 266.84) < 0.02, `${GALACTIC_CENTRE}`);
  ['galactic-centre', 'post-centre', 'galactic-anticentre', 'post-anticentre'].forEach((n, i) => {
    const e = findEvents(J('2024-03-20T00:00'), J('2024-04-20T00:00'), ALL).find((x) => x.name === n);
    assert.ok(Math.abs(wrap180(siderealLongitude(e.jde) - GALACTIC_CENTRE - 90 * i)) < 1e-6, n);
  });
  const asc = nearestTT('ascending-node', J('1987-05-23T06:25'));
  assert.ok(Math.abs(moon(asc.jde).beta) < 1e-6);
  assert.ok(earthSunDistance(nearestTT('perihelion', J('2024-01-03T00:40')).jde) < 0.98331);
});

// ---------------------------------------------------------------------------------------------------------------------
// Lunistices, cross-quarters, eclipses, planets

const NEW = { ...Object.fromEntries(Object.keys(ALL).map((k) => [k, false])), lunistices: true, crossQuarters: true, eclipses: true, planets: true };

test('lunistices and cross-quarters against DE440 [S] in 1620–1621, 2026 and 2601: within 2 min, declination within 10"', () => {
  // [name, TT, apparent declination of date (degrees)]
  const REF = [
    ['moon-north', '1620-01-16T21:07:53', 24.4716],
    ['moon-south', '1621-01-18T22:43:31', -22.7697],
    ['moon-north', '2026-01-02T08:11:58', 28.2664],
    ['moon-south', '2026-01-16T05:16:25', -28.3041],
    ['moon-north', '2026-02-25T23:15:52', 28.4283],
    ['moon-south', '2026-02-12T12:49:02', -28.4072],
    ['moon-north', '2601-02-06T03:03:23', 28.2174],
    ['moon-south', '2601-02-20T02:46:23', -28.3091],
    ['cross-quarter-315', '1621-02-03T12:44:57'],
    ['cross-quarter-135', '1621-08-07T14:24:34'],
    ['cross-quarter-315', '2026-02-03T20:03:17'],
    ['cross-quarter-45', '2026-05-05T11:49:52'],
    ['cross-quarter-135', '2026-08-07T11:43:53'],
    ['cross-quarter-225', '2026-11-07T09:53:13'],
    ['cross-quarter-45', '2601-05-05T14:35:44'],
    ['cross-quarter-225', '2601-11-07T19:05:20'],
  ];
  for (const [name, iso, dec] of REF) {
    const e = nearestTT(name, J(iso), NEW);
    assert.ok(e && Math.abs(minutes(e.jde - J(iso))) < 2, `${name} ${iso}: ${e && minutes(e.jde - J(iso)).toFixed(2)} min`);
    if (dec !== undefined) assert.ok(Math.abs(e.dec - dec) < 10 * AS, `${name} ${iso}: δ ${e.dec}`);
  }
  // the labels carry the declination; the cross-quarters their longitude
  const ev = events(U('2026-01-01'), U('2026-03-01'), NEW);
  assert.deepEqual(ev.filter((e) => e.family === 'lunistice').slice(0, 2).map((e) => e.label), ['Moon farthest north 28.3°', 'Moon farthest south 28.3°']);
  assert.deepEqual(ev.filter((e) => e.name.startsWith('cross')).map((e) => [e.label, e.labelPure]), [['Cross-quarter 315°', 'Cross-quarter 315°']]);
});

test('eclipses against the NASA catalogues [N]: type, greatest eclipse (solar TD within 1 min, lunar UT within 2 min), magnitude', () => {
  // solar: [TD of greatest eclipse, kind, magnitude]
  const SOLAR = [
    ['1715-05-03T09:36:30', 'total', 1.0632],
    ['2023-04-20T04:17:56', 'hybrid', 1.0132],
    ['2024-04-08T18:18:29', 'total', 1.0566],
    ['2025-03-29T10:48:36', 'partial', 0.9376],
    ['2026-02-17T12:13:06', 'annular', 0.963],
    ['2026-08-12T17:47:06', 'total', 1.0386],
    ['2027-08-02T10:07:50', 'total', 1.079],
    ['2028-01-26T15:08:59', 'annular', 0.9208], // Saros 141
    ['2031-11-14T21:07:31', 'hybrid', 1.0106],
    ['2186-07-16T15:14:54', 'total', 1.0805],
  ];
  for (const [iso, kind, mag] of SOLAR) {
    const e = nearestTT('solar-eclipse', J(iso), NEW);
    assert.ok(e, iso);
    assert.ok(Math.abs(minutes(e.jde - J(iso))) < 1, `${iso}: ${minutes(e.jde - J(iso)).toFixed(2)} min`);
    assert.equal(e.kind, kind, iso);
    assert.ok(Math.abs(e.magnitude - mag) < 0.01, `${iso}: magnitude ${e.magnitude}`);
  }
  // lunar: [UT of greatest eclipse, kind, magnitude (umbral; penumbral for a penumbral eclipse)]
  const LUNAR = [
    ['1703-01-03T06:58', 'partial', 0.627],
    ['2023-05-05T17:23', 'penumbral', 0.989],
    ['2024-03-25T07:13', 'penumbral', 0.982],
    ['2025-03-14T06:59', 'total', 1.183],
    ['2025-09-07T18:12', 'total', 1.368],
    ['2026-03-03T11:33', 'total', 1.156],
    ['2026-08-28T04:13', 'partial', 0.935],
  ];
  for (const [iso, kind, mag] of LUNAR) {
    const ev = events(U(iso) - 86400, U(iso) + 86400, NEW).filter((e) => e.name === 'lunar-eclipse');
    assert.equal(ev.length, 1, iso);
    const e = ev[0];
    assert.ok(Math.abs(e.t - U(iso)) < 2 * MIN, `${iso}: ${((e.t - U(iso)) / 60).toFixed(2)} min`);
    assert.equal(e.kind, kind, iso);
    assert.ok(Math.abs(e.magnitude - mag) < 0.01, `${iso}: magnitude ${e.magnitude}`);
    assert.equal(e.label, `${kind[0].toUpperCase()}${kind.slice(1)} lunar eclipse`);
  }
  // 2026: two solar and two lunar eclipses, nothing else
  const y = events(U('2026-01-01'), U('2027-01-01'), NEW).filter((e) => e.family === 'eclipse');
  assert.deepEqual(y.map((e) => e.label), ['Annular solar eclipse', 'Total lunar eclipse', 'Total solar eclipse', 'Partial lunar eclipse']);
});

test('planets against DE440 [S]: oppositions, conjunctions and greatest elongations within 5 min, elongations within 5"', () => {
  // [name, TT, elongation (degrees)]
  const REF = [
    ['mars-opposition', '2025-01-16T02:39:44'],
    ['jupiter-opposition', '2026-01-10T08:43:18'],
    ['saturn-opposition', '2025-09-21T05:46:47'],
    ['venus-inferior-conjunction', '2025-03-23T01:08:39'],
    ['mercury-elongation-east', '2026-02-19T17:42:17', 18.12],
    ['mercury-elongation-west', '2026-04-03T22:34:43', 27.82],
    ['mercury-elongation-east', '2026-06-15T20:01:00', 24.52],
    ['mercury-elongation-west', '2026-08-02T08:08:37', 19.47],
    ['mercury-elongation-east', '2026-10-12T10:04:27', 25.16],
    ['mercury-elongation-west', '2026-11-20T23:32:27', 19.62],
    ['jupiter-conjunction', '2026-07-29T12:19:01'],
    ['saturn-conjunction', '2027-04-07T17:19:25'],
    ['mars-conjunction', '2026-01-09T11:42:21'],
    ['venus-superior-conjunction', '2026-01-06T16:37:09'],
    ['mercury-superior-conjunction', '2026-01-21T15:50:02'],
    ['venus-elongation-east', '2026-08-15T06:32:42', 45.89],
    ['saturn-opposition', '1620-12-24T12:04:41'],
    ['mars-opposition', '1621-05-05T05:19:11'],
    ['mercury-inferior-conjunction', '1801-03-30T14:08:06'],
    ['mars-opposition', '1802-12-25T01:03:26'],
    ['jupiter-opposition', '2601-07-15T03:56:01'],
    ['venus-elongation-west', '2602-07-22T04:12:37', 45.72],
  ];
  for (const [name, iso, el] of REF) {
    const e = findEvents(J(iso) - 20, J(iso) + 20, NEW).filter((x) => x.name === name).sort((a, b) => Math.abs(a.jde - J(iso)) - Math.abs(b.jde - J(iso)))[0];
    assert.ok(e && Math.abs(minutes(e.jde - J(iso))) < 5, `${name} ${iso}: ${e && minutes(e.jde - J(iso)).toFixed(2)} min`);
    if (el !== undefined) assert.ok(Math.abs(e.elongation - el) < 0.006, `${name} ${iso}: ${e.elongation}`);
  }
  const ev = events(U('2026-10-01'), U('2026-12-01'), NEW).filter((e) => e.family === 'planet');
  assert.deepEqual(ev.map((e) => [e.label, e.symbol]), [
    ['Saturn opposition', '♄'],
    ['Mercury east elongation 25.2°', '☿'],
    ['Venus inferior conjunction', '♀'],
    ['Mercury inferior conjunction', '☿'],
    ['Mercury west elongation 19.6°', '☿'],
  ]);
});

test('pure labels of the new events pass the pure-mode scanner (no hard rule)', async () => {
  const { RULES } = await import('../tools/pure-scan.mjs');
  const hard = RULES.filter((r) => r[2] === 'hard');
  const labels = new Set(Object.values(EVENT_INFO).map((i) => i.labelPure));
  for (const y of [1650, 2026, 2800]) for (const e of events(U(`${y}-01-01`), U(`${y + 1}-01-01`), NEW)) labels.add(e.labelPure);
  assert.ok(labels.size > 40);
  for (const l of labels) for (const [id, re] of hard) assert.ok(!re.test(l), `${id}: ${l}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The API

test('events: shape, labels, symbols, sorting, range [t0, t1)', () => {
  const t0 = U('2024-03-01');
  const t1 = U('2024-05-21');
  const ev = events(t0, t1);
  assert.ok(ev.length > 40);
  for (const [i, e] of ev.entries()) {
    assert.ok(e.t >= t0 && e.t < t1, 'inside the range');
    if (i) assert.ok(ev[i - 1].t <= e.t, 'sorted');
    assert.ok(FAMILIES.includes(e.family));
    const info = EVENT_INFO[e.name];
    const specific = specificLabel(e);
    assert.deepEqual([e.family, e.label, e.labelPure, e.symbol], [info.family, specific, specific === info.label ? info.labelPure : specific, info.symbol]);
    assert.ok(Number.isFinite(e.jde));
  }
  const names = new Set(ev.map((e) => e.name));
  for (const [n, info] of Object.entries(EVENT_INFO)) if (!['solar', 'eclipse', 'planet'].includes(info.family)) assert.ok(names.has(n), `${n} occurs in 81 days`);
  // 2024-03-01 – 05-21: the penumbral lunar eclipse of 25 March and the total solar eclipse of 8 April
  assert.deepEqual(ev.filter((e) => e.family === 'eclipse').map((e) => e.label), ['Penumbral lunar eclipse', 'Total solar eclipse']);
  assert.ok(names.has('march-equinox'));
  assert.equal(EVENT_INFO['new-moon'].label, 'New Moon');
  assert.equal(EVENT_INFO['post-perigee'].label, 'Post-perigee');
  assert.equal(EVENT_INFO['post-anticentre'].label, 'Post-anticentre');
  assert.deepEqual(
    ['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice'].map((n) => [EVENT_INFO[n].label, EVENT_INFO[n].labelPure]),
    [['March equinox', 'Northward equinox'], ['June solstice', 'Northern solstice'], ['September equinox', 'Southward equinox'], ['December solstice', 'Southern solstice']],
  );
  const MONTHS = /January|February|March|April|May|June|July|August|September|October|November|December/;
  for (const [n, info] of Object.entries(EVENT_INFO)) {
    assert.ok(!MONTHS.test(info.labelPure), `${n}: no month in the pure label`);
    if (info.family === 'planet') assert.ok(/^[☿♀♂♃♄]$/u.test(info.symbol), `${n}: the planet's sign`);
    const cps = [...info.symbol];
    assert.equal(cps.length, 1, `${n}: one character`);
    const cp = cps[0].codePointAt(0);
    // Geometric Shapes, Misc Symbols, Dingbats or Math Operators – and none with a default emoji presentation
    assert.ok((cp >= 0x2200 && cp <= 0x22ff) || (cp >= 0x25a0 && cp <= 0x27bf), `${n}: ${info.symbol}`);
    assert.ok(![0x25aa, 0x25ab, 0x25b6, 0x25c0, 0x25fb, 0x25fc, 0x25fd, 0x25fe, 0x2600, 0x2728, 0x2733, 0x2734].includes(cp) && !(cp >= 0x2648 && cp <= 0x2653), `${n}: not an emoji`);
  }
  assert.deepEqual(events(t1, t0), []);
  assert.deepEqual(events(t0, t0), []);
  assert.deepEqual(events(NaN, t1), []);
});

test('events: family switches and quarters: false', () => {
  const t0 = U('2024-03-01');
  const t1 = U('2024-05-21');
  const all = events(t0, t1);
  const fam = (list) => new Set(list.map((e) => e.family));
  const none = Object.fromEntries(Object.keys(FLAGS).map((k) => [k, false]));
  assert.deepEqual([...fam(events(t0, t1, { ...none, synodic: true }))], ['synodic']);
  assert.deepEqual(events(t0, t1, none), []);
  assert.deepEqual(events(t0, t1, { ...none, quarters: true }), []);
  const noQ = events(t0, t1, { quarters: false, solarSync: true, majors: true });
  assert.ok(noQ.every((e) => !e.name.startsWith('post-') && e.name !== 'post-centre' && e.name !== 'post-anticentre'));
  // dropping quarters removes exactly those events and changes no other
  const kept = all.filter((e) => !e.name.startsWith('post-') && e.name !== 'post-centre' && e.name !== 'post-anticentre');
  assert.deepEqual(noQ.map((e) => [e.name, e.t]), kept.map((e) => [e.name, e.t]));
  // each flag alone gives the same events as within the full list
  const flagOf = (e) => (e.name.startsWith('cross-quarter') ? 'crossQuarters' : { lunistice: 'lunistices', eclipse: 'eclipses', planet: 'planets' }[e.family] ?? e.family);
  for (const f of Object.keys(FLAGS)) {
    if (f === 'quarters') continue;
    const only = events(t0, t1, { ...none, quarters: true, [f]: true });
    assert.ok(only.length, f);
    assert.deepEqual(only.map((e) => [e.name, e.t]), all.filter((e) => flagOf(e) === f).map((e) => [e.name, e.t]), f);
  }
});

test('events: adjacent ranges join without duplicates or gaps (post-* events included)', () => {
  const a = U('2024-02-01');
  const cuts = [U('2024-02-09T22:59'), U('2024-02-17T03:21'), U('2024-03-06'), U('2024-03-29T12:00')];
  const b = U('2024-04-30');
  const whole = events(a, b).map((e) => `${e.name}@${e.t.toFixed(3)}`);
  const edges = [a, ...cuts, b];
  const parts = [];
  for (let i = 0; i + 1 < edges.length; i++) parts.push(...events(edges[i], edges[i + 1]).map((e) => `${e.name}@${e.t.toFixed(3)}`));
  assert.deepEqual(parts, whole);
});

/** Structural checks of one stretch of events. */
function checkStructure(ev, label) {
  const by = (n) => ev.filter((e) => e.name === n);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1].t <= ev[i].t, `${label}: sorted`);
  // no duplicates: the same event never recurs within 5 days (solar: 300 days)
  for (const n of Object.keys(EVENT_INFO)) {
    const l = by(n);
    const gap = EVENT_INFO[n].family === 'solar' ? 300 : 5;
    for (let i = 1; i < l.length; i++) assert.ok(l[i].t - l[i - 1].t > gap * 86400, `${label}: ${n} repeated`);
  }
  // cycles: each family runs through its states in order
  const cycle = (names) => {
    const l = ev.filter((e) => names.includes(e.name));
    for (let i = 1; i < l.length; i++) {
      assert.equal(names.indexOf(l[i].name), (names.indexOf(l[i - 1].name) + 1) % names.length, `${label}: ${l[i - 1].name} → ${l[i].name}`);
    }
    return l;
  };
  cycle(['new-moon', 'first-quarter', 'full-moon', 'last-quarter']);
  const aps = cycle(['perigee', 'post-perigee', 'apogee', 'post-apogee']);
  const nodes = cycle(['ascending-node', 'post-ascending', 'descending-node', 'post-descending']);
  cycle(['galactic-centre', 'post-centre', 'galactic-anticentre', 'post-anticentre']);
  cycle(['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice']);
  cycle(['perihelion', 'aphelion']);
  // a post-* event lies exactly halfway between its neighbours
  for (const l of [aps, nodes]) {
    for (let i = 1; i + 1 < l.length; i++) {
      if (l[i].name.startsWith('post-')) assert.ok(Math.abs(l[i].t - (l[i - 1].t + l[i + 1].t) / 2) < 1, `${label}: ${l[i].name} halfway`);
    }
  }
  // spacing of the lunar months
  const spacing = (n, lo, hi) => {
    const l = by(n);
    for (let i = 1; i < l.length; i++) {
      const d = (l[i].t - l[i - 1].t) / 86400;
      assert.ok(d > lo && d < hi, `${label}: ${n} after ${d} days`);
    }
  };
  spacing('new-moon', 29.2, 29.9); // synodic month 29.53 d
  spacing('perigee', 24, 29); // anomalistic 27.55 d (perigees vary strongly)
  spacing('apogee', 26.9, 28.2);
  spacing('ascending-node', 26.5, 28); // draconic 27.21 d
  spacing('galactic-centre', 27, 27.7); // sidereal 27.32 d
}

test('sanity in 1650 and 2800: counts per year, order, alternation, spacing, no duplicates', () => {
  for (const y of [1650, 2800]) {
    const ev = events(U(`${y}-01-01`), U(`${y + 1}-01-01`));
    checkStructure(ev, String(y));
    const count = (n) => ev.filter((e) => e.name === n).length;
    for (const n of ['new-moon', 'first-quarter', 'full-moon', 'last-quarter']) assert.ok(count(n) >= 12 && count(n) <= 13, `${y} ${n} ${count(n)}`);
    for (const n of ['perigee', 'apogee', 'ascending-node', 'descending-node', 'galactic-centre', 'post-centre', 'galactic-anticentre', 'post-anticentre']) {
      assert.ok(count(n) >= 13 && count(n) <= 14, `${y} ${n} ${count(n)}`);
    }
    for (const n of ['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice', 'perihelion', 'aphelion']) assert.equal(count(n), 1, `${y} ${n}`);
    for (const n of ['cross-quarter-45', 'cross-quarter-135', 'cross-quarter-225', 'cross-quarter-315']) assert.equal(count(n), 1, `${y} ${n}`);
    for (const n of ['moon-north', 'moon-south']) assert.ok(count(n) >= 13 && count(n) <= 14, `${y} ${n} ${count(n)}`);
    // 4–7 eclipses a year, at least 2 of them solar
    const ecl = ev.filter((e) => e.family === 'eclipse');
    assert.ok(ecl.length >= 4 && ecl.length <= 7 && ecl.filter((e) => e.name === 'solar-eclipse').length >= 2, `${y} eclipses ${ecl.length}`);
    // planets: Mercury 3–4 greatest elongations each way, the outer planets one opposition at most
    assert.ok(count('mercury-elongation-east') >= 3 && count('mercury-elongation-east') <= 4, `${y} Mercury`);
    for (const p of ['mars', 'jupiter', 'saturn']) assert.ok(count(`${p}-opposition`) <= 1 && count(`${p}-opposition`) + count(`${p}-conjunction`) >= (p === 'mars' ? 0 : 1), `${y} ${p}`);
    // seasons in their months
    const month = (n) => new Date(ev.find((e) => e.name === n).t * 1000).getUTCMonth() + 1;
    assert.deepEqual([month('march-equinox'), month('june-solstice'), month('september-equinox'), month('december-solstice')], [3, 6, 9, 12]);
    // per month of ~30.4 days: 3–6 lunar events of each family
    for (let m = 0; m < 12; m++) {
      const a = U(`${y}-${String(m + 1).padStart(2, '0')}-01`);
      const b = m === 11 ? U(`${y + 1}-01-01`) : U(`${y}-${String(m + 2).padStart(2, '0')}-01`);
      for (const f of ['synodic', 'anomalistic', 'draconic', 'sidereal']) {
        const k = ev.filter((e) => e.family === f && e.t >= a && e.t < b).length;
        assert.ok(k >= 3 && k <= 6, `${y}-${m + 1} ${f}: ${k}`);
      }
    }
  }
});

test('a Delta of the catalogue (81 days) in under 150 ms, at both ends of 1613–2857', async () => {
  globalThis.Path2D ??= class {};
  const { createModel } = await import('../src/core/model.js');
  const { deltaRange, deltaAt } = await import('../src/diary/plan.js');
  const model = createModel();
  const { first, last } = deltaRange(model);
  for (const idx of [first, deltaAt(model, 1791460800), last]) {
    const D = model.cycleByIndex(3, idx);
    const t = performance.now();
    const ev = events(D.start, D.end);
    const ms = performance.now() - t;
    assert.ok(ms < 150, `Delta ${idx}: ${ms.toFixed(1)} ms`);
    assert.ok(ev.length >= 50 && ev.length <= 70, `Delta ${idx}: ${ev.length} events`);
    checkStructure(ev, `Delta ${idx}`);
  }
});

test('the plan places the ephemeris on Helions and pages', async () => {
  globalThis.Path2D ??= class {};
  const { createModel } = await import('../src/core/model.js');
  const { createPure } = await import('../src/core/pure.js');
  const { sanitizeDiaryOptions } = await import('../src/diary/options.js');
  const { planDiary, deltaAt } = await import('../src/diary/plan.js');
  const model = createModel();
  const opts = sanitizeDiaryOptions({});
  const delta = deltaAt(model, 1791460800);
  const D = model.cycleByIndex(3, delta);
  const ev = events(D.start, D.end, opts.events);
  const plan = planDiary({ model, pure: createPure(model), opts, delta, events: ev, zone: 'UTC' });
  const astro = plan.events.filter((e) => FAMILIES.includes(e.family));
  assert.equal(astro.length, ev.length, 'every event of the Delta is placed');
  for (const e of astro) assert.ok(e.page > 0 && e.frac >= 0 && e.frac < 1 && e.symbol && e.label);
  const rows = plan.pages.filter((p) => p.kind === 'ephemeris').flatMap((p) => p.rows);
  assert.equal(rows.length, ev.length);
});
