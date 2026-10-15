/**
 * One eclipse in detail (src/diary/astro/eclipse-detail.js): global and local circumstances of solar eclipses, the
 * contacts of lunar eclipses, the Saros series.
 *
 * Reference sources (F. Espenak's predictions; values copied from the pages, times compared in TD = TT so that the
 * different ΔT do not enter, longitudes corrected for the ΔT difference where the catalogue states its ΔT):
 *   [SC] NASA GSFC, Five Millennium Catalog of Solar Eclipses, 1701–2200 pages (SEcat5, archived 2008-02-28 at
 *        web.archive.org/web/20080311001653/http://sunearth.gsfc.nasa.gov/eclipse/SEcat5/catalog.html): TD of greatest
 *        eclipse, ΔT, lunation number, Saros, γ, point of greatest eclipse (0.1°), Sun altitude / azimuth (1°), path width
 *        (km), central duration (s).
 *   [LC] NASA GSFC, Catalog of Lunar Eclipses 1701–2200 (LEcat, archived 2008): UT of greatest eclipse, Saros, the
 *        semi-durations of the partial and total phases (minutes, rounded). Same shadow model as here (Chauvenet).
 *   [EP] eclipsewise.com "SEprime" pages (Espenak; fetched 2026-10-15): global contacts P1, U1, U4, P4 to 0.1 s TD, path
 *        width (0.1 km) and central duration (0.01 s) at greatest eclipse – 2017-08-21, 2024-04-08, 2025-03-29,
 *        2028-01-26.
 *   [EL] eclipsewise.com local circumstances (SEcirc / SEgmapx pages): C1…C4 to the second (UT) and the Sun's altitude,
 *        for six places (2017-08-21 Orlando; 2024-04-08 Daytona, Ohio, Bermuda; 2024-10-02 Patagonia; 2023-04-20).
 *   [NS] NASA GSFC Saros pages eclipse.gsfc.nasa.gov/SEsaros/SEsaros{N}.html and LEsaros/LEsaros{N}.html (fetched
 *        2026-10-15): series length, first and last eclipse (Julian calendar before 1582; converted here), member.
 *   [SG] saros-geo (pentalunex/gnomonicube/src/saros-geo/data/{101…173}.bin): NASA's solar eclipses of Saros 101–173
 *        within 1585–2500 with the series' "b" (begins) / "e" (ends) marks.
 *
 * Results (offline over the whole catalogues; the optional tests at the end repeat them when the files are present):
 *   solar [SC], 1180 eclipses 1701–2200: Saros number exact for all; point of greatest eclipse within 0.21° in
 *   latitude and 0.23° (× cos lat) in longitude, rms 0.065° / 0.047° (the worst are grazing, |γ| > 0.95, or partial
 *   eclipses, whose point lies on the limb); Sun altitude within 0.6°, azimuth 0.9°; of the 743 with a path width,
 *   width within 21 km (rms 1.4 km; > 2 % only for 1985-11-12, γ −0.98: 3 %), central duration within 0.76 s (rms
 *   0.31 s); width null exactly where NASA gives none ("n" / "s" eclipses: one path limit missing).
 *   global contacts [EP]: within 4 s (TD) for the central eclipses; 2025-03-29 (partial, γ 1.04): P1 18 s, P4 6 s –
 *   the engine's greatest eclipse is 12 s off there.  Local contacts [EL]: within 12 s, Sun altitude within 0.1°.
 *   lunar [LC], 1210 eclipses: Saros number exact for all; partial / total semi-durations within 0.31 min rms of the
 *   rounded values (max 2.3 min, for umbral magnitudes 0.003 where the duration is √-sensitive).
 *   Saros membership: [SG] all 2189 solar eclipses of 101–173 in 1585–2500 found in their series, none extra, every
 *   "b"/"e" mark at our first/last member; [LC] all 34 lunar "b"/"e" marks of 1701–2200 likewise. Whole series
 *   against [NS]: solar 126 (72), 139 (71), 141 (70), 145 (77), lunar 133 (71) exact in length and ends; lunar 123: NASA
 *   72 members ending 2367-10-08, the engine adds a 73rd (2385-10-19, penumbral magnitude 0.016 – the engine's
 *   Chauvenet shadow, as [LC], admits penumbral eclipses down to magnitude 0.007).
 *   NASA's newer lunar pages (Danjon's shadow) give contacts up to ~1.8 min (P1/P4) and ~0.6 min (U1–U4) different.
 *
 * Speed (Node, Apple M-series): solarDetail ≈ 1 ms, solarLocal 1–3 ms, lunarDetail 0.3 ms, sarosOf ≤ 27 ms.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import '../fractonica.js';
import { events } from '../src/diary/astro/index.js';
import { eclipseEvents } from '../src/diary/astro/eclipses.js';
import { solarDetail, solarLocal, lunarDetail, lunarVisibility, sarosOf, sarosNumber, penumbraTouches } from '../src/diary/astro/eclipse-detail.js';
import { jdeFromUnix, unixFromJde, JD_UNIX_EPOCH } from '../src/diary/astro/time.js';
import { equatorial, siderealTime, topocentric, observer, altitude } from '../src/diary/astro/sky.js';
import { moon } from '../src/diary/astro/moon.js';
import { sun } from '../src/diary/astro/sun.js';
import { nutation } from '../src/diary/astro/nutation.js';

const RAD = Math.PI / 180;
/** ISO (UTC or TD, as the source) → Unix seconds / JD on that scale. */
const U = (iso) => Date.parse(`${iso}Z`) / 1000;
const J = (iso) => U(iso) / 86400 + JD_UNIX_EPOCH;
const ONLY = { synodic: false, anomalistic: false, draconic: false, sidereal: false, solar: false, lunistices: false, crossQuarters: false, planets: false };
/** The engine's eclipse with greatest eclipse near TD `iso`. */
const solarAt = (iso) => eclipseEvents(J(iso) - 0.1, J(iso) + 0.1).find((e) => e.name === 'solar-eclipse');
const lunarAtUT = (iso) => {
  const j = jdeFromUnix(U(iso));
  return eclipseEvents(j - 0.1, j + 0.1).find((e) => e.name === 'lunar-eclipse');
};
/** ΔT (s) of time.js at a JDE. */
const dTOf = (jde) => (jde - (unixFromJde(jde) / 86400 + JD_UNIX_EPOCH)) * 86400;
const wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
const sec = (days) => days * 86400;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tolerance ${tol})`);

test('solar global circumstances against [SC]: Saros, greatest point, Sun altitude/azimuth, width, duration', () => {
  // [TD, ΔT, lunation, Saros, lat, lon, alt, az, width (km | null), duration (s | null)]
  const REF = [
    ['1715-05-03T09:36:30', 10, -3521, 114, 59.4, 17.9, 44, 157, 295, 254],
    ['1737-03-01T14:35:17', 11, -3251, 116, 36.0, -50.1, 45, 160, 378, 484],
    ['1764-04-01T10:17:15', 15, -2916, 135, 44.2, -2.5, 43, 138, 361, 380],
    ['1806-06-16T16:24:27', 12, -2394, 124, 42.2, -64.6, 71, 184, 210, 295],
    ['1878-07-29T21:47:18', -5, -1502, 124, 53.8, -124.0, 51, 213, 191, 191],
    ['1919-05-29T13:08:55', 21, -997, 136, 4.4, -16.7, 73, 356, 244, 411],
    ['1955-06-20T04:10:42', 31, -551, 136, 14.8, 117.0, 81, 5, 254, 428],
    ['1999-08-11T11:04:09', 64, -5, 145, 45.1, 24.3, 59, 197, 112, 143],
    ['2003-05-31T04:09:22', 64, 42, 147, 66.6, -24.5, 3, 35, null, 217],
    ['2009-07-22T02:36:25', 66, 118, 136, 24.2, 144.1, 86, 198, 258, 399],
    ['2010-01-15T07:07:39', 67, 124, 141, 1.6, 69.3, 66, 165, 333, 668],
    ['2023-04-20T04:17:56', 73, 288, 129, -9.6, 125.8, 67, 334, 49, 76],
    ['2024-04-08T18:18:29', 74, 300, 139, 25.3, -104.1, 70, 149, 198, 268],
    ['2025-03-29T10:48:36', 75, 312, 149, 61.1, -77.1, 0, 83, null, null],
    ['2026-08-12T17:47:06', 75, 329, 126, 65.2, -25.2, 26, 248, 294, 138],
    ['2027-08-02T10:07:50', 76, 341, 136, 25.5, 33.2, 82, 202, 258, 383],
    ['2028-01-26T15:08:59', 76, 347, 141, 3.0, -51.5, 67, 161, 323, 627],
    ['2132-06-13T16:46:24', 282, 1638, 139, 22.3, -70.1, 89, 350, 255, 415],
    ['2186-07-16T15:14:54', 409, 2307, 139, 7.4, -46.5, 76, 4, 267, 449],
  ];
  for (const [iso, dT, k, saros, lat, lon, alt, az, width, dur] of REF) {
    const ev = solarAt(iso);
    assert.ok(ev, iso);
    assert.equal(sarosNumber(k, true), saros, `${iso} Saros from k`);
    assert.equal(sarosOf(ev).saros, saros, `${iso} Saros`);
    const d = solarDetail(ev);
    const g = d.greatest;
    near(g.lat, lat, 0.2, `${iso} lat`);
    // the longitude with NASA's ΔT: the Earth turned (ΔT_here − ΔT_NASA) · 360.9856°/day less
    const lonNasa = g.lon - ((dTOf(ev.jde) - dT) * 360.9856) / 86400;
    near(wrap(lonNasa - lon) * Math.cos(lat * RAD), 0, 0.2, `${iso} lon`);
    near(g.sunAlt, alt, 1, `${iso} Sun altitude`);
    if (alt > 1 && alt < 85) near(wrap(g.sunAz - az), 0, 1.2, `${iso} Sun azimuth`);
    if (width === null) assert.equal(g.width, null, `${iso} width`);
    else near(g.width, width, Math.max(2, 0.02 * width), `${iso} width`);
    if (dur === null) assert.equal(g.duration, null, `${iso} duration`);
    else near(g.duration, dur, 1.5, `${iso} duration`);
    // the semidiameters
    assert.ok(d.sun.semidiameter > 0.26 && d.sun.semidiameter < 0.273, iso);
    assert.ok(d.moon.semidiameter > 0.24 && d.moon.semidiameter < 0.284, iso);
    if (d.kind !== 'partial' && Math.abs(d.magnitude - 1) > 0.03) assert.equal(d.moon.semidiameter > d.sun.semidiameter, d.magnitude > 1, `${iso} Moon vs Sun size`);
  }
});

test('solar global contacts against [EP] within 20 s (TD), width and duration', () => {
  // [TD greatest, kind, {contact: TD}, width km, duration s]
  const REF = [
    ['2017-08-21T18:26:40', 'total', { P1: '15:47:59.9', U1: '16:49:44.5', U4: '20:03:42.8', P4: '21:05:31.9' }, 114.7, 160.12],
    ['2024-04-08T18:18:29', 'total', { P1: '15:43:23.3', U1: '16:40:00.7', U4: '19:56:45.7', P4: '20:53:30.4' }, 197.5, 268.13],
    ['2025-03-29T10:48:36', 'partial', { P1: '08:51:52.5', P4: '12:44:54.0' }, null, null],
    ['2028-01-26T15:08:59', 'annular', { P1: '12:07:52.6', U1: '13:16:03.3', U4: '17:01:45.1', P4: '18:10:00.6' }, 323.0, 627.09],
  ];
  for (const [iso, kind, contacts, width, dur] of REF) {
    const d = solarDetail(solarAt(iso));
    assert.equal(d.kind, kind, iso);
    const names = Object.keys(contacts);
    assert.deepEqual(
      d.contacts.map((c) => c.name),
      [names[0], ...(names.length > 2 ? [names[1]] : []), 'max', ...(names.length > 2 ? [names[2]] : []), names.at(-1)],
      iso,
    );
    for (const [name, td] of Object.entries(contacts)) {
      const c = d.contacts.find((x) => x.name === name);
      near(sec(c.jde - J(`${iso.slice(0, 10)}T${td}`)), 0, 20, `${iso} ${name}`);
      near(c.t, unixFromJde(c.jde), 1e-3, `${iso} ${name} t`);
      assert.ok(c.label.length > 0);
    }
    const max = d.contacts.find((c) => c.name === 'max');
    assert.equal(max.t, d.t);
    assert.equal(max.label, 'Greatest eclipse');
    for (let i = 1; i < d.contacts.length; i++) assert.ok(d.contacts[i].t > d.contacts[i - 1].t, `${iso} contacts in order`);
    if (width === null) assert.equal(d.greatest.width, null);
    else {
      near(d.greatest.width, width, 0.01 * width, `${iso} width`);
      near(d.greatest.duration, dur, 1, `${iso} duration`);
    }
  }
  // labels
  const d = solarDetail(solarAt('2024-04-08T18:18:29'));
  assert.deepEqual(d.contacts.map((c) => c.label), ['Partial eclipse begins', 'Total eclipse begins', 'Greatest eclipse', 'Total eclipse ends', 'Partial eclipse ends']);
  // an event from events() works the same as one from eclipseEvents (t from the event)
  const ev = events(U('2024-04-08T00:00:00'), U('2024-04-09T00:00:00'), ONLY)[0];
  assert.equal(solarDetail(ev).t, ev.t);
  assert.deepEqual(solarDetail(ev).greatest, d.greatest);
});

test('solar local circumstances against [EL]: contacts within 15 s, Sun altitude within 0.2°', () => {
  // [lat, lon, kind, [[contact, UT, Sun altitude]]]
  const REF = [
    [28.55316, -81.36451, 'partial', [['C1', '2017-08-21T17:19:28', 73], ['max', '2017-08-21T18:51:17', 64], ['C4', '2017-08-21T20:14:57', 48]]],
    [29.0181, -80.9481, 'partial', [['C1', '2024-04-08T17:48:08', 67.9], ['max', '2024-04-08T19:04:48', 58.3], ['C4', '2024-04-08T20:18:34', 44.0]]],
    [41.0341, -83.6523, 'total', [['C1', '2024-04-08T17:55:52', 56.3], ['C2', '2024-04-08T19:10:42', 50.5], ['max', '2024-04-08T19:12:34', 50.3], ['C3', '2024-04-08T19:14:27', 50.1], ['C4', '2024-04-08T20:26:37', 39.6]]],
    [32.3066, -64.7503, 'partial', [['C1', '2024-04-08T18:26:16', 51.8], ['max', '2024-04-08T19:34:26', 38.8], ['C4', '2024-04-08T20:37:34', 25.8]]],
    [-48.2051, -70.6549, 'annular', [['C1', '2024-10-02T19:00:27', 35.6], ['C2', '2024-10-02T20:22:16', 24.1], ['max', '2024-10-02T20:25:26', 23.6], ['C3', '2024-10-02T20:28:35', 23.1], ['C4', '2024-10-02T21:42:37', 11.2]]],
    [4.6622, 170.8101, 'partial', [['C1', '2023-04-20T04:42:21', 28.7], ['max', '2023-04-20T05:54:27', 11.0], ['C4', '2023-04-20T06:57:32', -4.4]]],
  ];
  for (const [lat, lon, kind, contacts] of REF) {
    const day = contacts[0][1].slice(0, 10);
    const ev = events(U(`${day}T00:00:00`), U(`${day}T00:00:00`) + 86400, ONLY).find((e) => e.name === 'solar-eclipse');
    const L = solarLocal(ev, { lat, lon });
    const where = `${day} ${lat},${lon}`;
    assert.equal(L.kind, kind, where);
    assert.equal(L.visible, true, where);
    assert.deepEqual(L.contacts.map((c) => c.name), contacts.map((c) => c[0]), where);
    for (const [name, ut, alt] of contacts) {
      const c = L.contacts.find((x) => x.name === name);
      near(c.t, U(ut), 15, `${where} ${name}`);
      near(c.sunAlt, alt, Number.isInteger(alt) ? 0.6 : 0.2, `${where} ${name} altitude`);
    }
    // at(): the discs touch at C1 / C4, are concentric-ish at a central maximum, and agree with the magnitude
    for (const c of L.contacts) {
      const a = L.at(c.t);
      const s = Math.hypot(a.x, a.y);
      assert.equal(a.rSun, 1);
      near(a.sunAlt, c.sunAlt, 1e-6, `${where} at().sunAlt`);
      if (c.name === 'C1' || c.name === 'C4') near(s, 1 + a.rMoon, 2e-3, `${where} ${c.name} discs touch`);
      if (c.name === 'max' && kind === 'partial') near((1 + a.rMoon - s) / 2, L.magnitude, 2e-3, `${where} magnitude`);
    }
    assert.ok(L.obscuration > 0 && L.obscuration <= 1, where);
    if (kind === 'total') assert.equal(L.obscuration, 1);
  }
  // outside the penumbra in daylight: Buenos Aires
  const ev = events(U('2024-04-08T00:00:00'), U('2024-04-09T00:00:00'), ONLY)[0];
  const none = solarLocal(ev, { lat: -34.6, lon: -58.4 });
  assert.equal(none.kind, 'none');
  assert.equal(none.visible, false);
  assert.deepEqual(none.contacts, []);
  // the night side: the geometry (topocentric, through the Earth) can still give an "eclipse", all with the Sun down
  for (const place of [{ lat: -33.87, lon: 151.21 }, { lat: 64.0, lon: 100.0 }]) {
    const night = solarLocal(ev, place);
    assert.ok(night.contacts.every((c) => c.sunAlt < -10), `${place.lat} Sun down`);
    assert.equal(night.visible, false);
  }
});

/**
 * Topocentric altitude / azimuth (degrees, azimuth from north through east) of 'sun' | 'moon' at Unix t, from the
 * Meeus helpers of sky.js (spherical formulas 40.2–40.3, 13.5–13.6) – code independent of eclipse-detail.js' vectors.
 */
function horizontal(body, t, { lat, lon }) {
  const jde = jdeFromUnix(t);
  const nut = nutation(jde);
  let q;
  let par;
  if (body === 'sun') {
    const s = sun(jde, { nut });
    q = equatorial(s.apparent, s.beta, nut.eps);
    par = 8.794 / 3600 / s.R;
  } else {
    const m = moon(jde);
    q = equatorial(m.lambda + nut.dpsi, m.beta, nut.eps);
    par = Math.asin(6378.14 / m.dist) / RAD;
  }
  const H = siderealTime(t / 86400 + JD_UNIX_EPOCH, nut.dpsi * Math.cos(nut.eps * RAD)) + lon - q.ra;
  const tp = topocentric(H, q.dec, par, observer(lat));
  const h = tp.H * RAD;
  const p = lat * RAD;
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(p) - Math.tan(tp.dec * RAD) * Math.cos(p)) / RAD + 180;
  return { alt: altitude(tp.H, tp.dec, lat), az };
}

test('solarLocal at(): x along the horizon to the right (increasing azimuth), y towards the zenith', () => {
  const ev = events(U('2024-04-08T00:00:00'), U('2024-04-09T00:00:00'), ONLY)[0];
  for (const place of [{ lat: 29.0181, lon: -80.9481 }, { lat: 41.0341, lon: -83.6523 }, { lat: 32.3066, lon: -64.7503 }, { lat: -20, lon: -120 }]) {
    const L = solarLocal(ev, place);
    assert.ok(L.contacts.length >= 3, `${place.lat}`);
    for (const c of L.contacts) {
      const a = L.at(c.t);
      const S = horizontal('sun', c.t, place);
      const M = horizontal('moon', c.t, place);
      const sd = solarDetail(ev).sun.semidiameter;
      // small-offset approximation of the tangent plane: x = Δaz cos(alt), y = Δalt (second-order terms < 0.05 radii)
      near(a.sunAlt, S.alt, 0.01, `${place.lat} ${c.name} Sun altitude`);
      near(wrap(a.sunAz - S.az), 0, 0.02 / Math.cos(S.alt * RAD), `${place.lat} ${c.name} Sun azimuth`);
      near(a.y, (M.alt - S.alt) / sd, 0.05, `${place.lat} ${c.name} y`);
      near(a.x, (wrap(M.az - S.az) * Math.cos(S.alt * RAD)) / sd, 0.05, `${place.lat} ${c.name} x`);
    }
  }
});

test('lunar contacts against [LC] semi-durations (±1 min), shadow radii, at()', () => {
  // [UT greatest, Saros, kind, semi-duration partial, total (minutes; null = no such phase)]
  const REF = [
    ['1703-01-03T06:58', 110, 'partial', 88, null],
    ['1761-05-18T22:12', 117, 'total', 115, 47],
    ['1848-03-19T21:12', 120, 'total', 116, 51],
    ['1910-05-24T05:34', 129, 'total', 108, 25],
    ['1950-04-02T20:44', 131, 'total', 95, 15],
    ['2000-07-16T13:56', 129, 'total', 118, 54],
    ['2018-07-27T20:22', 129, 'total', 118, 52],
    ['2022-11-08T10:59', 136, 'total', 110, 43],
    ['2023-05-05T17:23', 141, 'penumbral', null, null],
    ['2024-03-25T07:13', 113, 'penumbral', null, null],
    ['2025-03-14T06:59', 123, 'total', 109, 33],
    ['2025-09-07T18:12', 128, 'total', 105, 41],
    ['2026-03-03T11:33', 133, 'total', 104, 30],
    ['2026-08-28T04:13', 138, 'partial', 99, null],
    ['2029-06-26T03:22', 130, 'total', 110, 51],
    ['2134-05-08T10:06', 133, 'total', 110, 50],
  ];
  for (const [iso, saros, kind, part, tot] of REF) {
    const ev = lunarAtUT(iso);
    assert.ok(ev, iso);
    assert.equal(sarosOf(ev).saros, saros, `${iso} Saros`);
    const d = lunarDetail(ev);
    assert.equal(d.kind, kind, iso);
    const c = Object.fromEntries(d.contacts.map((x) => [x.name, x]));
    const expected = ['P1', ...(part ? ['U1'] : []), ...(tot ? ['U2'] : []), 'max', ...(tot ? ['U3'] : []), ...(part ? ['U4'] : []), 'P4'];
    assert.deepEqual(d.contacts.map((x) => x.name), expected, iso);
    if (part) near((c.U4.t - c.U1.t) / 120, part, 1, `${iso} partial semi-duration`);
    if (tot) near((c.U3.t - c.U2.t) / 120, tot, 1, `${iso} total semi-duration`);
    // symmetric about greatest eclipse within a few minutes, penumbral phase ≤ 6.5 h
    near(c.P1.t + c.P4.t - 2 * d.t, 0, 600, `${iso} symmetry`);
    assert.ok(c.P4.t - c.P1.t < 6.5 * 3600, iso);
    // magnitudes as the event's, shadow radii and the Moon's place at the contacts
    near(kind === 'penumbral' ? d.penumbral : d.umbral, ev.magnitude, 1e-9, `${iso} magnitude`);
    assert.ok(d.shadow.umbra > 0.6 && d.shadow.umbra < 0.8 && d.shadow.penumbra > 1.1 && d.shadow.penumbra < 1.35, iso);
    for (const x of d.contacts) {
      const a = d.at(x.t);
      const r = Math.hypot(a.x, a.y);
      const target = { P1: a.penumbra + a.moon, P4: a.penumbra + a.moon, U1: a.umbra + a.moon, U4: a.umbra + a.moon, U2: a.umbra - a.moon, U3: a.umbra - a.moon }[x.name];
      if (target) near(r, target, 1e-5, `${iso} ${x.name} at()`);
    }
    // the Moon moves eastwards through the shadow: x increases
    assert.ok(d.at(c.P4.t).x > d.at(c.P1.t).x, `${iso} eastward`);
    // γ > 0: the Moon passes north of the axis
    assert.equal(Math.sign(d.at(d.t).y), Math.sign(d.gamma), `${iso} north/south`);
  }
  const d = lunarDetail(lunarAtUT('2025-03-14T06:59'));
  assert.deepEqual(d.contacts.map((c) => c.label), [
    'Penumbral eclipse begins',
    'Partial eclipse begins',
    'Total eclipse begins',
    'Greatest eclipse',
    'Total eclipse ends',
    'Partial eclipse ends',
    'Penumbral eclipse ends',
  ]);
});

test('lunarVisibility: the Moon up or down at the contacts', () => {
  const ev = lunarAtUT('2025-03-14T06:59'); // greatest 06:59 UT: night in the Americas, day in Asia
  const ny = lunarVisibility(ev, { lat: 40.71, lon: -74.01 });
  const det = lunarDetail(ev);
  assert.equal(ny.moonAlt.length, det.contacts.length);
  assert.ok(ny.moonAlt.every((a) => a > 0), 'New York sees it all');
  assert.equal(ny.visible, true);
  assert.equal(ny.visibleUmbral, true);
  const delhi = lunarVisibility(ev, { lat: 28.61, lon: 77.21 });
  assert.ok(delhi.moonAlt.every((a) => a < 0), 'New Delhi: the Moon is down');
  assert.equal(delhi.visible, false);
  // London: the Moon sets during the eclipse (about 06:3x UT on 2025-03-14)
  const london = lunarVisibility(ev, { lat: 51.48, lon: 0 });
  assert.equal(london.visible, true);
  assert.ok(london.moonAlt[0] > 0 && london.moonAlt.at(-1) < 0);
  assert.deepEqual(london.contacts.map((c) => c.name), det.contacts.map((c) => c.name));
});

test('sarosOf: series number, membership and length against [NS]; performance', () => {
  // [kind, TD/UT of greatest, Saros, member, count, first (Gregorian), last]
  const REF = [
    ['solar', '2024-04-08T18:18:29', 139, 30, 71, '1501-05-27', '2763-07-03'],
    ['solar', '2026-08-12T17:47:06', 126, 48, 72, '1179-03-17', '2459-05-03'],
    ['solar', '2028-01-26T15:08:59', 141, 24, 70, '1613-05-19', '2857-06-13'],
    ['solar', '2017-08-21T18:26:40', 145, 22, 77, '1639-01-04', '3009-04-17'],
    ['solar', '2027-08-02T10:07:50', 136, null, null, null, null],
    ['lunar', '2026-03-03T11:33', 133, 27, 71, '1557-05-23', '2819-06-29'],
    ['lunar', '2025-09-07T18:12', 128, null, null, null, null],
  ];
  for (const [kind, iso, saros, member, count, first, last] of REF) {
    const ev = kind === 'solar' ? solarAt(iso) : lunarAtUT(iso);
    const t0 = performance.now();
    const s = sarosOf(ev);
    const ms = performance.now() - t0;
    assert.ok(ms < 150, `${iso}: sarosOf took ${ms.toFixed(1)} ms`);
    assert.equal(s.saros, saros, iso);
    assert.equal(s.count, s.members.length);
    assert.equal(s.members[s.member - 1].jde, ev.jde, `${iso} is its own member`);
    assert.deepEqual(s.prev, s.members[s.member - 2] ?? null);
    assert.deepEqual(s.next, s.members[s.member] ?? null);
    for (let i = 1; i < s.members.length; i++) {
      assert.equal(s.members[i].member, i + 1);
      near(s.members[i].jde - s.members[i - 1].jde, 6585.32, 0.5, `${iso} Saros spacing`);
    }
    if (member !== null) {
      assert.equal(s.member, member, `${iso} member`);
      assert.equal(s.count, count, `${iso} count`);
      // the first and last members are partial / penumbral
      assert.ok(['partial', 'penumbral'].includes(s.members[0].kind) && ['partial', 'penumbral'].includes(s.members.at(-1).kind), iso);
      // dates (UT) of the ends; NASA's are TD, ΔT under ~2 h in these centuries
      const date = (m) => new Date(m.t * 1000).toISOString().slice(0, 10);
      assert.equal(date(s.members[0]), first, `${iso} first`);
      assert.equal(date(s.members.at(-1)), last, `${iso} last`);
    }
  }
  // lunar 123 (2025-03-14): member 53 as NASA; NASA ends the series with member 72 on 2367-10-08, the engine's
  // Chauvenet shadow adds a 73rd of penumbral magnitude < 0.03
  const s = sarosOf(lunarAtUT('2025-03-14T06:59'));
  assert.equal(s.saros, 123);
  assert.equal(s.member, 53);
  assert.equal(new Date(s.members[71].t * 1000).toISOString().slice(0, 10), '2367-10-08');
  assert.equal(s.count, 73);
  assert.ok(s.members[72].magnitude < 0.03);
  // reliability flags: 1500–2500
  assert.ok(s.members.some((m) => !m.reliable) && s.members.find((m) => m.member === 53).reliable);
  // grazing partials of eclipses.js' sphere that NASA does not list are not members ([SC] 1701–2200)
  for (const iso of ['1718-03-31T23:58', '1761-10-27T22:20', '1787-07-14T22:48']) {
    const ev = solarAt(iso);
    assert.ok(ev && ev.magnitude < 0.01, iso);
    assert.equal(penumbraTouches(ev.jde), false, iso);
  }
  assert.equal(penumbraTouches(solarAt('1639-01-04T04:56:19').jde), true, 'NASA: 1639-01-04, magnitude 0.0009');
});

test('the whole API is fast: one eclipse well under 200 ms', () => {
  const ev = solarAt('2024-04-08T18:18:29');
  const lev = lunarAtUT('2025-03-14T06:59');
  const t0 = performance.now();
  solarDetail(ev);
  solarLocal(ev, { lat: 41.0341, lon: -83.6523 });
  sarosOf(ev);
  lunarDetail(lev);
  lunarVisibility(lev, { lat: 51.48, lon: 0 });
  sarosOf(lev);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `${ms.toFixed(1)} ms`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Optional: the whole catalogues, when the reference files are on this machine.

const CAT = `${process.env.HOME}/projects/astronomy/generate/eclipse/`;
const SG = `${process.env.HOME}/projects/pentalunex/gnomonicube/src/saros-geo/`;
const MON = 'JanFebMarAprMayJunJulAugSepOctNovDec';

test('[SC] / [LC] whole catalogues 1701–2200: Saros numbers, greatest point, width, duration, semi-durations', { skip: !existsSync(`${CAT}se2001.html`) && 'catalogue files not present' }, () => {
  const rs = /^<a[^>]*>\d+<\/a>\s+(\d{4}) (\w{3}) (\d\d)\s+(\d\d):(\d\d):(\d\d)\s+(-?\d+)\s+(-?\d+)\s+<a[^>]*>(\d+)<\/a>\s+(\S+)\s+\S+\s+\S+\s+([\d.]+)([NS])\s+([\d.]+)([EW])\s+(\d+)\s+(\d+)(?:\s+(\S+)\s+(\S+))?/;
  let n = 0;
  for (const y of [1701, 1801, 1901, 2001, 2101]) {
    for (const line of readFileSync(`${CAT}se${y}.html`, 'utf8').split('\n')) {
      const m = rs.exec(line);
      if (!m) continue;
      n++;
      const iso = `${m[1]}-${String(MON.indexOf(m[2]) / 3 + 1).padStart(2, '0')}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      const ev = solarAt(iso);
      assert.ok(ev, iso);
      assert.equal(sarosNumber(+m[8], true), +m[9], iso);
      const g = solarDetail(ev).greatest;
      const lat = (m[12] === 'S' ? -1 : 1) * +m[11];
      const lon = (m[14] === 'W' ? -1 : 1) * +m[13];
      near(g.lat, lat, 0.25, `${iso} lat`);
      const lonNasa = g.lon - ((dTOf(ev.jde) - +m[7]) * 360.9856) / 86400;
      near(wrap(lonNasa - lon) * Math.cos(lat * RAD), 0, 0.25, `${iso} lon`);
      if ((m[17] ?? '-') === '-') assert.equal(g.width, null, `${iso} width`);
      else near(g.width, +m[17], Math.max(2, 0.035 * +m[17]), `${iso} width`);
      const dm = /(\d+)m(\d+)s/.exec(m[18] ?? '-');
      if (dm) near(g.duration, +dm[1] * 60 + +dm[2], 1.5, `${iso} duration`);
      else assert.equal(g.duration, null, `${iso} duration`);
    }
  }
  assert.equal(n, 1180);
  const rl = /^  (\d{4}) (\w{3}) (\d\d)\s+(\d\d):(\d\d)\s+(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(\d+m|-)\s+(\d+m|-)/;
  let nl = 0;
  for (const y of [1701, 1801, 1901, 2001, 2101]) {
    for (const line of readFileSync(`${CAT}le${y}.html`, 'utf8').split('\n')) {
      const m = rl.exec(line);
      if (!m) continue;
      nl++;
      const iso = `${m[1]}-${String(MON.indexOf(m[2]) / 3 + 1).padStart(2, '0')}-${m[3]}T${m[4]}:${m[5]}`;
      const ev = lunarAtUT(iso);
      assert.ok(ev, iso);
      const k = Math.round((ev.jde - 2451550.09766) / 29.530588861 - 0.5) + 0.5;
      assert.equal(sarosNumber(k, false), +m[7], iso);
      const c = Object.fromEntries(lunarDetail(ev).contacts.map((x) => [x.name, x.t]));
      if (m[8] !== '-') near((c.U4 - c.U1) / 120, parseInt(m[8]), 2.5, `${iso} partial`);
      else assert.equal(c.U1, undefined, iso);
      if (m[9] !== '-') near((c.U3 - c.U2) / 120, parseInt(m[9]), 1.5, `${iso} total`);
      else assert.equal(c.U2, undefined, iso);
      if (/[be]$/.test(m[6])) {
        const s = sarosOf(ev);
        assert.equal(m[6].endsWith('b') ? s.member : s.count - s.member + 1, 1, `${iso} series ${m[6]}`);
      }
    }
  }
  assert.equal(nl, 1210);
});

test('[SG] solar Saros 101–173 within 1585–2500: every member, the series ends', { skip: !existsSync(`${SG}data/139.bin`) && 'saros-geo data not present' }, async () => {
  const { decodeSeries } = await import(`${SG}saros_geo.js`);
  const KIND = { P: 'partial', A: 'annular', T: 'total', H: 'hybrid' };
  let n = 0;
  let kinds = 0;
  for (let S = 101; S <= 173; S++) {
    const recs = decodeSeries(readFileSync(`${SG}data/${S}.bin`)); // datetime_utc holds the TD of greatest eclipse
    const td = (r) => J(r.datetime_utc.replace(' ', 'T'));
    const mid = recs[Math.floor(recs.length / 2)];
    const s = sarosOf(solarAt(mid.datetime_utc.replace(' ', 'T')));
    assert.equal(s.saros, S);
    const inWindow = s.members.filter((m) => m.jde > td(recs[0]) - 1 && m.jde < td(recs.at(-1)) + 1);
    assert.equal(inWindow.length, recs.length, `Saros ${S}: members in 1585–2500`);
    recs.forEach((r, i) => {
      near(sec(inWindow[i].jde - td(r)) / 60, 0, 1, `Saros ${S} ${r.datetime_utc}`);
      if (KIND[r.type[0]] !== inWindow[i].kind) kinds++;
      n++;
    });
    if (recs[0].type.endsWith('b')) assert.equal(inWindow[0].member, 1, `Saros ${S} begins`);
    else assert.ok(s.members[0].jde < td(recs[0]) - 1, `Saros ${S} began earlier`);
    if (recs.at(-1).type.endsWith('e')) assert.equal(inWindow.at(-1).member, s.count, `Saros ${S} ends`);
    else assert.ok(s.members.at(-1).jde > td(recs.at(-1)) + 1, `Saros ${S} ends later`);
  }
  assert.equal(n, 2189);
  // types differ only at the hybrid / partial boundaries (eclipses.js: Meeus' criteria)
  assert.ok(kinds <= 10, `${kinds} types differ`);
});
