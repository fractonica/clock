/**
 * The base map of the eclipse maps: Natural Earth land, lakes and country borders (public domain), simplified for print
 * and vendored as data/world.json (built by tools/build-diary-geo.mjs; see README.md).
 *
 * loadWorld() -> {land, lakes, borders}: arrays of rings / lines [[lon, lat]…] in degrees. Land rings (holes
 * included) are meant to be filled together with the even-odd rule; land and lake rings are open (the last point is
 * not repeated). Memoised.
 */
import { loadJson } from './load.js';

/** One delta-encoded line [x0, y0, dx1, dy1, …] (1/q degree) -> [[lon, lat]…]. */
function decodeLine(a, q) {
  const out = new Array(a.length / 2);
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length; i += 2) {
    x += a[i];
    y += a[i + 1];
    out[i / 2] = [x / q, y / q];
  }
  return out;
}

/** Decode the JSON of data/world.json. */
export function decodeWorld(json) {
  const q = json.q ?? 100;
  const layer = (k) => (json[k] ?? []).map((a) => decodeLine(a, q));
  return { land: layer('land'), lakes: layer('lakes'), borders: layer('borders'), source: json.source };
}

let world = null;
export function loadWorld() {
  if (!world) {
    world = loadJson('world.json').then(decodeWorld);
    world.catch(() => (world = null));
  }
  return world;
}
