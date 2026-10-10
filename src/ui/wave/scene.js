/**
 * Scene builder for the wave view: turns the library's arcs (clock.arc) and the model's
 * clock readings into the plain-number structures the renderer draws. No DOM here.
 *
 * Work is bounded: a scene holds the focus arc, at most `factor` children (<= 13) and
 * `factor * factor'` grandchildren (<= 143) plus four ancestors; the catalogue overview holds the
 * 35 level-0 arcs and their level-1 / level-2 children (about 2.5k arcs, drawn only when visible).
 * Per frame nothing here touches BigInt except the (cached) arcs two levels below the grandchildren.
 *
 * Frames
 *   A focus scene lives in the frame of its focus half-arc (centre 0,0 · radius 1, the library's
 *   `relativeTo` rebasing, so the maths stays precise at any depth). Every frame is related to
 *   the frame of its level-0 ancestor by a translate + uniform scale `toAlpha` (p_alpha = a + k p),
 *   which is what lets the renderer zoom smoothly between levels.
 */
import { childOf, focusArcLength, halfOf, levelMarkers, rowOffset, viewRotation } from './geometry.js';

const DEEPEST = 15; // deepest level we ever need a marker for (focus 13 + 2 grandchildren)
export const LAND = 0.001; // seconds past a half-arc start where navigation lands (so the reading is inside it)

export function createEngine(model) {
  const clock = model.clock;
  const extent = model.extent;
  const factor = (l) => model.levelInfo(l).factor;
  const prefix = (l) => model.levelInfo(l).prefixNum;
  const counts = [];
  const halfCount = (l) => (counts[l] ??= Number(clock.count(l, 'half')));

  /** Fraction of a nominal half-arc inside the catalogue (the last arcs are clipped). */
  const fractionOf = (l, idx) => Math.min(1, Math.max(0, (extent * prefix(l) - 2 * idx) / 2));

  /** Unix time at progress p (0..1) of half-arc idx of level l (position-linear, as the arcs are). */
  const timeAt = (l, idx, p) => model.timeOfPosition(((idx + p) * 2) / prefix(l));

  /** Index of the level-`l` half-arc that contains half-arc (level, idx), l <= level. */
  function ancestorIndex(level, idx, l) {
    let i = idx;
    for (let k = level - 1; k >= l; k--) i = Math.floor(i / factor(k));
    return i;
  }

  /** Time facts of a half-arc. `end` is clipped at the catalogue end. */
  function halfSpan(l, idx) {
    const fraction = fractionOf(l, idx);
    const start = timeAt(l, idx, 0);
    const end = timeAt(l, idx, fraction);
    return { start, end, duration: end - start, fraction, clipped: fraction < 1 };
  }

  /**
   * Where the step buttons go from time `t`, which lies in half-arc (level, idx): the start of the
   * next half-arc (dir > 0), or the start of this one when we are more than a moment into it, else
   * the start of the previous one. Landing is LAND seconds after a start, so "a moment" has to be
   * measured in seconds as well: for the 22 ms half-arcs of the deepest level a share of the arc
   * (the old 2 %) is smaller than the landing offset itself and Prev would never move on.
   * @returns {{t:number} | {edge:'start'|'end'}}
   */
  function stepTarget(level, idx, t, dir) {
    if (dir > 0) return idx + 1 >= halfCount(level) ? { edge: 'end' } : { t: timeAt(level, idx + 1, 0) + LAND };
    const start = timeAt(level, idx, 0);
    if (t - start > Math.max(1.5 * LAND, 0.02 * halfSpan(level, idx).duration)) return { t: start + LAND };
    return idx === 0 ? { edge: 'start' } : { t: timeAt(level, idx - 1, 0) + LAND };
  }

  /**
   * Everything a label or tooltip needs to say about a half-arc.
   *
   * Two numberings of the same thing live here and must never be confused:
   *   n / of          the half-arc among the half-arcs of its PARENT HALF-ARC (the loop number the
   *                   picture shows, signed: +3 crest, −2 trough); `of` = factor(level - 1)
   *   cycleN / cycleOf  the CYCLE this half-arc is a half of, among the cycles of its parent CYCLE,
   *                   which is the "6 / 11" every other view shows (ladder, rings, timeline,
   *                   calendar); a cycle is two half-arcs, so a cycle's first half (crest) and
   *                   second half (trough) usually belong to different parent half-arcs.
   */
  function describe(level, idx) {
    const info = model.levelInfo(level);
    const par = level === 0 ? null : factor(level - 1);
    const n = (par === null ? idx : idx % par) + 1;
    const crest = idx % 2 === 0;
    const cycle = Math.floor(idx / 2);
    return {
      level,
      idx,
      letter: info.text,
      parent: level === 0 ? null : model.levelInfo(level - 1).text,
      depth: info.depth,
      crest,
      half: crest ? 'first' : 'second',
      n,
      of: par === null ? halfCount(0) : par,
      cycle,
      cycleN: (par === null ? cycle : cycle % par) + 1,
      cycleOf: par === null ? Math.ceil(halfCount(0) / 2) : par,
      signed: (crest ? '+' : '−') + n,
      apex: crest ? 'peak' : 'valley',
      marks: crest ? ['begin', 'peak', 'node'] : ['node', 'valley', 'end'],
      ...halfSpan(level, idx),
    };
  }

  /**
   * Half-arc readings of every level at one instant: [{idx, local, half}] for levels 0..15.
   * Levels 0..13 come from the model (exact); deeper ones descend from level 13 by float.
   * @returns {null | Array}
   */
  function readHalves(frame) {
    if (!frame.inRange) return null;
    const out = [];
    for (let L = 0; L <= 13; L++) {
      const r = frame.level(L);
      if (!r) return null;
      const h = halfOf(r.cycle, r.phase);
      // the very last instant of the catalogue belongs to the last half-arc (at its end)
      const last = halfCount(L) - 1;
      if (h.idx > last) {
        h.idx = last;
        h.local = 1;
        h.half = last % 2;
      }
      h.reading = r;
      out[L] = h;
    }
    for (let L = 14; L <= DEEPEST; L++) {
      const c = childOf(out[L - 1].idx, out[L - 1].local, factor(L - 1));
      out[L] = { idx: c.idx, local: c.local, half: c.idx % 2 };
    }
    return out;
  }

  /** Library arc of (level, idx) in the frame of the focus arc `ref` (an ancestor or itself). */
  const arcIn = (level, idx, ref) => clock.arc(level, BigInt(idx), { relativeTo: { level: ref.level, index: BigInt(ref.idx) } });

  /**
   * Build the scene focused on half-arc (level, idx): the arc itself, its children and
   * grandchildren, and the arcs of its closest ancestors expressed in the same frame.
   */
  function buildFocus(level, idx) {
    const ref = { level, idx };
    const focus = arcIn(level, idx, ref);
    const fraction = fractionOf(level, idx);
    const m = factor(level);
    const children = [];
    for (let j = 0; j < m; j++) {
      const ci = idx * m + j;
      if (ci >= halfCount(level + 1)) break;
      const arc = arcIn(level + 1, ci, ref);
      children.push({ level: level + 1, idx: ci, j, arc, fraction: fractionOf(level + 1, ci) });
    }
    const m2 = factor(level + 1);
    const grand = [];
    for (const c of children) {
      for (let k = 0; k < m2; k++) {
        const gi = c.idx * m2 + k;
        if (gi >= halfCount(level + 2)) break;
        grand.push({ level: level + 2, idx: gi, j: c.j, k, arc: arcIn(level + 2, gi, ref), fraction: fractionOf(level + 2, gi) });
      }
    }
    // ancestors (parent first): their circles seen from the focus frame
    const ancestors = [];
    for (let l = level - 1; l >= Math.max(0, level - 4); l--) {
      const ai = ancestorIndex(level, idx, l);
      const abs = clock.arc(l, BigInt(ai));
      const f = arcIn(level, idx, { level: l, idx: ai }); // the focus arc in the ancestor's frame
      const slotM = factor(l);
      const slotJ = ancestorIndex(level, idx, l + 1) % slotM; // which of its children we are inside
      ancestors.push({
        level: l,
        idx: ai,
        slotJ,
        slotM,
        fraction: fractionOf(l, ai),
        arc: {
          center: { x: -f.center.x / f.radius, y: -f.center.y / f.radius },
          radius: 1 / f.radius,
          start: abs.start,
          sweep: abs.sweep,
          level: l,
        },
      });
    }
    // fitting samples (flat x,y): focus, children and grandchildren
    const pts = [];
    const sample = (arc, fr, n) => {
      for (let i = 0; i <= n; i++) {
        const a = arc.start + arc.sweep * ((fr * i) / n);
        pts.push(arc.center.x + arc.radius * Math.cos(a), arc.center.y + arc.radius * Math.sin(a));
      }
    };
    sample(focus, fraction, 64);
    for (const c of children) sample(c.arc, c.fraction, 32);
    for (const g of grand) sample(g.arc, g.fraction, 12);
    // frame map to the level-0 ancestor's frame
    const r0 = ancestorIndex(level, idx, 0);
    let toAlpha = { x: 0, y: 0, k: 1 };
    if (level > 0) {
      const f0 = arcIn(level, idx, { level: 0, idx: r0 });
      toAlpha = { x: f0.center.x, y: f0.center.y, k: f0.radius };
    }
    return {
      kind: 'focus',
      key: level + ':' + idx,
      level,
      idx,
      r0,
      focus,
      fraction,
      children,
      grand,
      ancestors,
      samples: pts,
      deep: new Map(),
      rot: viewRotation(focus),
      toAlpha,
      desc: describe(level, idx),
    };
  }

  /**
   * How many pixels half-arc (level, idx) measures on a W x H stage when it is the focus (focusArcLength). The
   * half-arcs of one depth are not alike (their sweeps differ, so does the fit), so each is measured for itself, once
   * per size: a scene is built the first time and remembered.
   */
  const pxMemo = new Map();
  function arcPixels(level, idx, W, H, pad) {
    const key = `${W}x${H}|${level}|${idx}`;
    let px = pxMemo.get(key);
    if (px === undefined) {
      px = focusArcLength(buildFocus(level, idx), W, H, pad);
      if (pxMemo.size > 240) pxMemo.clear();
      pxMemo.set(key, px);
    }
    return px;
  }

  /** The arc of a level-`l` half-arc in the frame of `scene`, for markers deeper than the grandchildren. */
  function arcInScene(scene, l, idx) {
    return arcIn(l, idx, { level: scene.level, idx: scene.idx });
  }

  /**
   * One marker per level on its own arc, coarsest first: the ancestors we know, the focus
   * arc, then children, grandchildren and up to two further levels. `cur` = readHalves().
   * Each marker: {level, idx, local, arc, x, y} with (x,y) in the scene frame.
   * Empty when the displayed time is outside the scene's focus arc.
   */
  function markersFor(scene, cur, maxLevel = DEEPEST) {
    const L = scene.level;
    if (!cur || cur[L].idx !== scene.idx) return [];
    const list = [];
    const add = (level, idx, arc) => list.push({ level, idx, local: cur[level].local, arc });
    for (let i = scene.ancestors.length - 1; i >= 0; i--) {
      const a = scene.ancestors[i];
      if (cur[a.level].idx === a.idx) add(a.level, a.idx, a.arc);
    }
    add(L, scene.idx, scene.focus);
    const c = scene.children[cur[L + 1]?.idx - scene.idx * factor(L)];
    if (c && c.idx === cur[L + 1].idx) {
      add(c.level, c.idx, c.arc);
      const g = scene.grand.find((x) => x.idx === cur[L + 2]?.idx);
      if (g) add(g.level, g.idx, g.arc);
    }
    for (let l = L + 3; l <= Math.min(L + 4, maxLevel); l++) {
      // arcs below the grandchildren are cached per scene: they only change when the half-arc does
      const key = l + ':' + cur[l].idx;
      let arc = scene.deep.get(key);
      if (!arc) {
        arc = arcInScene(scene, l, cur[l].idx);
        if (scene.deep.size > 64) scene.deep.clear();
        scene.deep.set(key, arc);
      }
      add(l, cur[l].idx, arc);
    }
    return levelMarkers(list);
  }

  // --------------------------------------------------- catalogue overview
  let overviewArcs = null;
  /** Absolute arcs of levels 0..2 of the whole wave, grouped by level. */
  function overviewLevels() {
    if (overviewArcs) return overviewArcs;
    const levels = [[], [], []];
    for (let l = 0; l <= 2; l++) {
      const n = halfCount(l);
      for (let i = 0; i < n; i++) {
        levels[l].push({ level: l, idx: i, arc: clock.arc(l, BigInt(i)), fraction: fractionOf(l, i), r0: ancestorIndex(l, i, 0) });
      }
    }
    overviewArcs = levels;
    return levels;
  }

  /** The catalogue scene for a row layout: every arc shifted to its row. */
  function buildOverview(layout) {
    const levels = overviewLevels().map((arr) =>
      arr.map((e) => {
        const o = rowOffset(e.r0, layout);
        return {
          level: e.level,
          idx: e.idx,
          r0: e.r0,
          fraction: e.fraction,
          row: o.row,
          col: o.col,
          arc: {
            center: { x: e.arc.center.x + o.x, y: e.arc.center.y + o.y },
            radius: e.arc.radius,
            start: e.arc.start,
            sweep: e.arc.sweep,
            level: e.level,
          },
        };
      }),
    );
    return { kind: 'overview', key: 'O', layout, levels, rot: 0 };
  }

  return {
    model,
    clock,
    extent,
    factor,
    prefix,
    halfCount,
    fractionOf,
    timeAt,
    ancestorIndex,
    halfSpan,
    stepTarget,
    describe,
    readHalves,
    buildFocus,
    arcPixels,
    arcIn,
    arcInScene,
    markersFor,
    overviewLevels,
    buildOverview,
  };
}
