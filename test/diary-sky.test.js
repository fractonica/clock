/**
 * The local sky (src/diary/astro/sky.js): the helpers against Meeus' worked examples, the rise / transit / set times
 * against the USNO's published table, the sampled altitudes against the exact ones, and the API contract.
 *
 * Reference sources:
 *   [M] J. Meeus, Astronomical Algorithms, 2nd ed. (1998): examples 12.a / 12.b (sidereal time), 13.a (Pollux,
 *       ecliptic → equatorial), 13.b (Venus at the USNO, altitude), 40.a (Mars at Palomar, topocentric place).
 *   [U] US Naval Observatory, Astronomical Applications Dept., "Sun and Moon Data for One Day",
 *       https://aa.usno.navy.mil/api/rstt/oneday?date=YYYY-MM-DD&coords=LAT,LON&tz=0 (API v4.0.1, fetched 2026-10-15),
 *       times in UT rounded to the minute. USNO conventions: Sun rise/set at the centre's geometric altitude −0°50′;
 *       Moon rise/set when the topocentric upper limb is at −34′ – the same as sky.js. Over 45 place-days (Moscow,
 *       London, Sydney, Quito, Tromsø; Jan–Dec 2026) the largest difference was 0.52 min for both bodies (i.e. within
 *       the table's rounding); a subset is checked below.
 */
import test from "node:test";
import assert from "node:assert/strict";
import "../fractonica.js";
import {
  skyOf,
  equatorial,
  siderealTime,
  altitude,
  observer,
  topocentric,
  bodyAltitude,
} from "../src/diary/astro/sky.js";
import { nutation } from "../src/diary/astro/nutation.js";

const RAD = Math.PI / 180;
const dms = (d, m = 0, s = 0) => d + m / 60 + s / 3600;
const PLACES = {
  moscow: { lat: 55.7558, lon: 37.6173 },
  london: { lat: 51.5074, lon: -0.1278 },
  sydney: { lat: -33.8688, lon: 151.2093 },
  quito: { lat: -0.1807, lon: -78.4678 },
  tromso: { lat: 69.6492, lon: 18.9553 },
};
const unixOf = (date, hm = "00:00") => Date.parse(`${date}T${hm}:00Z`) / 1000;

test("[M] 12.a / 12.b: mean and apparent sidereal time at Greenwich", () => {
  const jd = 2446895.5; // 1987 April 10, 0h UT
  const n = nutation(jd);
  assert.ok(
    Math.abs(siderealTime(jd) / 15 - dms(13, 10, 46.3668)) * 3600 < 0.001
  );
  const app = siderealTime(jd, n.dpsi * Math.cos(n.eps * RAD)) / 15;
  assert.ok(Math.abs(app - dms(13, 10, 46.1351)) * 3600 < 0.001);
  assert.ok(
    Math.abs(siderealTime(2446896.30625) / 15 - dms(8, 34, 57.0896)) * 3600 <
      0.001
  );
});

test("[M] 13.a: ecliptic → equatorial (Pollux)", () => {
  const q = equatorial(113.21563, 6.68417, 23.4392911);
  assert.ok(Math.abs(q.ra - 116.328942) < 1e-6);
  assert.ok(Math.abs(q.dec - 28.026183) < 1e-6);
});

test("[M] 13.b: altitude of Venus at the USNO", () => {
  const H = dms(8, 34, 56.853) * 15 - dms(77, 3, 56) - dms(23, 9, 16.641) * 15; // lon west → minus
  assert.ok(
    Math.abs(altitude(H, -dms(6, 43, 11.61), dms(38, 55, 17)) - 15.1249) < 1e-4
  );
});

test("[M] 40.a: topocentric place of Mars from Palomar", () => {
  const o = observer(dms(33, 21, 22), 1706);
  assert.ok(Math.abs(o.rhoSin - 0.546861) < 1e-6);
  assert.ok(Math.abs(o.rhoCos - 0.836339) < 1e-6);
  const par = Math.asin(Math.sin((8.794 / 3600) * RAD) / 0.37276) / RAD;
  const t = topocentric(288.7958, -15.771083, par, o);
  // α′ − α = +1.29 s of time, δ′ = −15°46′30.0″
  assert.ok(Math.abs(288.7958 - (t.H + 360) - (1.29 / 3600) * 15) < 1e-4);
  assert.ok(Math.abs(t.dec + dms(15, 46, 30.0)) * 3600 < 0.2);
});

// [U] place, UT date, Sun events, Moon events (UT, rounded to the minute) – every rise, set and upper transit of the day
// prettier-ignore
const USNO = [
  ['moscow', '2026-08-15', 'rise 02:01, transit 09:34, set 17:06', 'rise 05:35, transit 11:45, set 17:35'],
  ['moscow', '2026-10-01', 'rise 03:32, transit 09:19, set 15:05', 'transit 00:56, set 10:32, rise 16:18'],
  ['moscow', '2026-12-21', 'rise 05:57, transit 09:28, set 12:58', 'set 02:52, rise 10:08, transit 19:06'],
  ['moscow', '2026-06-21', 'rise 00:45, transit 09:31, set 18:18', 'rise 09:01, transit 15:16, set 21:12'],
  ['london', '2026-03-20', 'rise 06:03, transit 12:08, set 18:13', 'rise 06:17, transit 13:15, set 20:35'],
  ['london', '2026-12-21', 'rise 08:04, transit 11:59, set 15:53', 'set 05:07, rise 13:09, transit 21:43'],
  ['sydney', '2026-06-21', 'transit 01:57, set 06:54, rise 21:00', 'rise 01:25, transit 07:28, set 13:39'],
  ['sydney', '2026-09-05', 'transit 01:54, set 07:40, rise 20:07', 'set 00:57, rise 16:25, transit 21:13'],
  ['quito', '2026-01-10', 'rise 11:17, transit 17:21, set 23:25', 'rise 04:45, transit 10:55, set 17:05'],
  // midnight sun (no rise / set), the Moon up all day (transit only)
  ['tromso', '2026-06-21', 'transit 10:46', 'rise 10:18, transit 16:33, set 22:14'],
  ['tromso', '2026-08-15', 'rise 01:45, transit 10:49, set 19:49', 'rise 06:57, transit 13:02, set 18:32'],
  ['tromso', '2026-10-01', 'rise 04:59, transit 10:34, set 16:07', 'transit 02:14'],
  // polar night: no sunrise or sunset (USNO lists no solar transit either; sky.js reports it, below the horizon)
  ['tromso', '2026-12-21', '', 'transit 20:24'],
];
const TOL = { sun: 1, moon: 1.5 }; // minutes, including the table's ±0.5 min rounding

for (const [place, date, sunList, moonList] of USNO) {
  test(`[U] ${place} ${date}: rise / transit / set of the Sun and the Moon`, () => {
    const t0 = unixOf(date);
    const sky = skyOf(t0, t0 + 86400, PLACES[place]);
    for (const [body, list] of [
      ["sun", sunList],
      ["moon", moonList],
    ]) {
      const ref = list ? list.split(", ").map((s) => s.split(" ")) : [];
      const ours = sky.events.filter((e) => e.body === body);
      const polarNightTransit =
        place === "tromso" && date === "2026-12-21" && body === "sun";
      assert.equal(
        ours.length,
        ref.length + (polarNightTransit ? 1 : 0),
        `${body} event count`
      );
      for (const [name, hm] of ref) {
        const tr = unixOf(date, hm);
        const e = ours.find((x) => x.name === name);
        assert.ok(e, `${body} ${name} missing`);
        const d = (e.t - tr) / 60;
        assert.ok(
          Math.abs(d) <= TOL[body],
          `${body} ${name}: ${d.toFixed(2)} min off USNO ${hm}`
        );
      }
      if (polarNightTransit) {
        assert.equal(ours[0].name, "transit");
        // 90° − 69.65° − 23.44° = −3.09°
        assert.ok(
          Math.abs(ours[0].alt + 3.09) < 0.05,
          `noon altitude ${ours[0].alt}`
        );
      }
    }
  });
}

// the diary's default range (Delta Trifracton, 28 Jul – 17 Oct 2026)
const T0 = 1785254340;
const T1 = 1792253520;

test("the default Delta in Moscow: one sunrise and one sunset every local day; contract; speed", () => {
  const t = performance.now();
  const sky = skyOf(T0, T1, PLACES.moscow);
  const ms = performance.now() - t;
  assert.ok(ms < 1000, `skyOf took ${ms.toFixed(0)} ms`);

  assert.equal(sky.step, 120);
  assert.equal(sky.n, Math.ceil((T1 - T0) / 120) + 1);
  assert.ok(sky.sun instanceof Float32Array && sky.sun.length === sky.n);
  assert.ok(sky.moon instanceof Float32Array && sky.moon.length === sky.n);
  for (let i = 1; i < sky.events.length; i++)
    assert.ok(sky.events[i].t >= sky.events[i - 1].t, "sorted");
  for (const e of sky.events) {
    assert.ok(e.t >= T0 && e.t < T1);
    assert.ok(e.body === "sun" || e.body === "moon");
    assert.ok(["rise", "transit", "set"].includes(e.name));
    assert.equal("alt" in e, e.name === "transit");
  }

  // Moscow local days (UTC+3) fully inside the range
  const MSK = 3 * 3600;
  const first = Math.ceil((T0 + MSK) / 86400) * 86400 - MSK;
  let days = 0;
  for (let d = first; d + 86400 <= T1; d += 86400, days++) {
    const sun = sky.events.filter(
      (e) => e.body === "sun" && e.t >= d && e.t < d + 86400
    );
    assert.deepEqual(
      sun.map((e) => e.name),
      ["rise", "transit", "set"],
      new Date((d + MSK) * 1000).toISOString().slice(0, 10)
    );
    const moonTransits = sky.events.filter(
      (e) =>
        e.body === "moon" && e.name === "transit" && e.t >= d && e.t < d + 86400
    );
    assert.ok(moonTransits.length <= 1);
  }
  assert.equal(days, 80);
  // the Moon transits once per ~24.8 h
  const mt = sky.events.filter(
    (e) => e.body === "moon" && e.name === "transit"
  ).length;
  assert.ok(mt >= 77 && mt <= 79, `${mt} lunar transits`);
});

test("altAt interpolates the samples within 0.05° (Sun) / 0.2° (Moon) of the exact altitude", () => {
  for (const place of ["moscow", "tromso", "sydney"]) {
    const loc = PLACES[place];
    const sky = skyOf(T0, T1, loc);
    let worst = { sun: 0, moon: 0 };
    for (let t = T0 + 37; t < T1; t += 49999) {
      for (const body of ["sun", "moon"]) {
        worst[body] = Math.max(
          worst[body],
          Math.abs(sky.altAt(body, t) - bodyAltitude(body, t, loc))
        );
      }
    }
    assert.ok(worst.sun < 0.05, `${place} sun ${worst.sun}`);
    assert.ok(worst.moon < 0.2, `${place} moon ${worst.moon}`);
    // samples are the altitudes at the grid points
    for (const i of [0, 1000, sky.n - 1]) {
      const t = T0 + i * sky.step;
      assert.ok(Math.abs(sky.sun[i] - bodyAltitude("sun", t, loc)) < 0.01);
      assert.ok(Math.abs(sky.moon[i] - bodyAltitude("moon", t, loc)) < 0.01);
    }
    assert.ok(Number.isNaN(sky.altAt("sun", T0 - 1)));
    assert.ok(Number.isNaN(sky.altAt("moon", T1 + 1)));
    assert.ok(Number.isNaN(sky.altAt("venus", T0)));
    assert.equal(sky.altAt("sun", T0), sky.sun[0]);
  }
});

test("events: transit altitude is the local maximum; rise/set sit on the threshold", () => {
  const loc = PLACES.london;
  const t0 = unixOf("2026-08-15");
  const sky = skyOf(t0, t0 + 86400, loc);
  for (const e of sky.events) {
    const a = bodyAltitude(e.body, e.t, loc);
    if (e.name === "transit") {
      assert.ok(Math.abs(e.alt - a) < 0.01);
      assert.ok(
        a > bodyAltitude(e.body, e.t - 3600, loc) &&
          a > bodyAltitude(e.body, e.t + 3600, loc)
      );
    } else if (e.body === "sun") {
      assert.ok(Math.abs(a + 0.8333) < 0.01, `${e.name} at ${a}`);
    } else {
      // −34′ − semidiameter (≈ 15′–17′) for the topocentric centre
      assert.ok(a < -0.8 && a > -0.86, `moon ${e.name} at ${a}`);
    }
  }
});

test("polar latitudes and edge cases do not throw", () => {
  for (const lat of [90, -90, 89.99, -78, 78]) {
    const sky = skyOf(T0, T0 + 30 * 86400, { lat, lon: 0 });
    assert.ok(
      sky.sun.every(Number.isFinite) && sky.moon.every(Number.isFinite)
    );
  }
  // midnight sun at the North Pole in summer: no solar rise or set
  const np = skyOf(unixOf("2026-06-01"), unixOf("2026-06-11"), {
    lat: 90,
    lon: 0,
  });
  assert.equal(
    np.events.filter((e) => e.body === "sun" && e.name !== "transit").length,
    0
  );
  // Tromsø: the midnight-sun weeks have no sunrise or sunset, the polar-night weeks neither
  const tr = PLACES.tromso;
  const summer = skyOf(unixOf("2026-06-10"), unixOf("2026-06-30"), tr);
  assert.equal(
    summer.events.filter((e) => e.body === "sun" && e.name !== "transit")
      .length,
    0
  );
  assert.ok(summer.sun.every((a) => a > 0));
  const winter = skyOf(unixOf("2026-12-10"), unixOf("2026-12-30"), tr);
  assert.equal(
    winter.events.filter((e) => e.body === "sun" && e.name !== "transit")
      .length,
    0
  );
  assert.equal(
    winter.events.filter((e) => e.body === "sun" && e.name === "transit")
      .length,
    20
  );
  assert.ok(
    winter.events.every(
      (e) => e.name !== "transit" || e.body !== "sun" || e.alt < 0
    )
  );
  // a zero-length range, an odd step, height
  const z = skyOf(T0, T0, { ...PLACES.moscow, height: 2000, step: 77 });
  assert.equal(z.n, 1);
  assert.equal(z.events.length, 0);
  assert.equal(z.altAt("sun", T0), z.sun[0]);
  assert.throws(() => skyOf(T0, T0 + 10, {}), RangeError);
});
