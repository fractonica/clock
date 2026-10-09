/**
 * Glyph path cache. Composes the library's own geometry (CBT.geometry) so the face draws
 * exactly the paths of SPEC §9.1: one path string per state in design units, plus the
 * falling-branch dot. Paths are built lazily, once per state.
 */
export function createGlyphBook(F, { strokes = 2, scale = 10, thickness = 0.3 } = {}) {
  const states = 4 * ((3 ** strokes - 1) / 2);
  const cache = new Array(states);

  /** @returns {{index:number, d:string, dot:{x:number,y:number,r:number}|null, bounds:object}} */
  function get(index) {
    const i = ((Math.trunc(index) % states) + states) % states;
    let g = cache[i];
    if (!g) {
      const geo = F.CBT.geometry(F.CBT.fromIndex(i, { depth: strokes }), { scale, thickness });
      g = Object.freeze({
        index: i,
        d: geo.path,
        dot: geo.dot ? Object.freeze({ x: geo.dot.x, y: geo.dot.y, r: geo.dot.radius }) : null,
        bounds: geo.bounds,
      });
      cache[i] = g;
    }
    return g;
  }
  return { strokes, states, get, thickness };
}
