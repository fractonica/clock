/**
 * Diary options: every knob of the printed diary of one Delta, with defaults and validation.
 *
 * The diary (docs/design/90-diary.md):
 *   front matter   index · Gregorian index · ephemeris · reference sheet (period ladder | milestones) · planning ·
 *                  predictions
 *   per Nuclide    header page · 4 locks of 19 Helions, counted from the Nuclide's start: three 5-Helion sheets (3 lined
 *                  on the front, 2 canvases on the back) and a 4-Helion sheet (all canvases: 2 on each side). These
 *                  sheets are not the solar sync's Pentads (SPEC §7.5); every Helion's header names its true Pentad
 *                  · the 77th Helion on its own (a fine lined page + 2 canvas pages): the retrospection
 *   inserts        a Delta sheet before the lock that holds each Delta quarter threshold (Peak, Node, Valley)
 *   closing        retrospection / summary pages of the whole Delta
 * A "sheet" is one leaf: its front is a recto (odd page), its back the verso.
 */

/** Paper sizes in millimetres, portrait. */
export const PAGE_SIZES = Object.freeze({
  A6: [105, 148],
  A5: [148, 210],
  B5: [176, 250],
  A4: [210, 297],
  'Half Letter': [139.7, 215.9],
  Letter: [215.9, 279.4],
  Traveler: [110, 210],
});

/** What a canvas page can carry. */
export const CANVAS_TYPES = Object.freeze(['grid', 'dots', 'dot-grid', 'lined', 'blank', 'nuclide-grid']);

export const DIARY_DEFAULTS = Object.freeze({
  /** Paper: a named size or 'custom' with width/height (mm). */
  page: { size: 'A5', width: 148, height: 210, margins: { top: 12, bottom: 12, inner: 16, outer: 20 } },
  /** The thumb index: references to the previous and next page of the same kind along the outer edge (a 6 mm strip). */
  nav: { on: true },
  /** Gregorian references (index, timestamps); forced off in pure mode. `zone` null = the app's zone. */
  gregorian: { on: true, zone: null, weekdays: true },
  /** `reference`: one sheet, the period ladder of 63 levels on its front, the milestones of Alpha, Beta, Gamma on its back. */
  front: { cover: false, index: true, gregorianIndex: true, ephemeris: true, reference: true, planning: 1, predictions: 1 },
  /** One lock = these sheets, [lined Helions on the front, canvas Helions on the back]; 19 Helions by default. */
  lock: { sheets: [[3, 2], [3, 2], [3, 2], [2, 2]] },
  lined: {
    /** Lines per Helion on a lined page (12 = one line per 3 Preons). */
    linesPerHelion: 12,
    /** Line labels at the inner edge: 'preon' (0ι 3ι …), 'both' (+ Gregorian time), 'none'. */
    labels: 'both',
    marginGlyphs: true,
    marginCurve: true,
  },
  /** Canvases of the back pages, in order (one per canvas Helion). */
  canvases: [
    { type: 'grid', cols: 19, rows: 13 },
    { type: 'blank' },
  ],
  /**
   * The 4-Helion sheet (the last of the default lock; option key `semi` kept for stored settings). With `allCanvas` both its sides are canvases,
   * 2 Helions each, in the order of `canvases`; otherwise it is laid out like any sheet.
   */
  semi: { allCanvas: true, canvases: [{ type: 'blank' }, { type: 'blank' }, { type: 'blank' }, { type: 'blank' }] },
  /**
   * The Helions left over after the locks (77 − 4·19 = 1): a fine lined page and its canvas pages. 'nuclide-grid' is the
   * 7 × 11 grid of the Nuclide's 77 Helions (one column per ζ of 11 Helions) to mark each Helion, with its ephemeris marks.
   */
  retro: {
    lines: 36,
    canvases: [
      { type: 'blank' },
      { type: 'nuclide-grid' },
    ],
  },
  /**
   * `eclipses`: a Helion that holds an eclipse gets 2 sheets before its own sheet: the eclipse (map or shadow diagram,
   * circumstances, its Saros series) | the Saros index; the Helion in detail (contacts on a Preon and Flavon timeline) |
   * a blank canvas. Needs events.eclipses.
   */
  inserts: { deltaQuarters: true, eclipses: true },
  events: {
    synodic: true,
    anomalistic: true,
    draconic: true,
    sidereal: true,
    /** Quarter events of the anomalistic, draconic and sidereal months (post-perigee …). */
    quarters: true,
    solar: true,
    /** Starts of the solar syncs (SPEC §7) as ticks. */
    solarSync: true,
    /** Thresholds of the major periods (Alpha … Delta quarters) as ticks. */
    majors: true,
    /** The Moon's greatest north and south declination (lunistices). */
    lunistices: true,
    /** The Sun at 45°, 135°, 225°, 315° of apparent longitude. */
    crossQuarters: true,
    /** Solar and lunar eclipses with their type. */
    eclipses: true,
    /** Greatest elongations and conjunctions of Mercury and Venus; oppositions and conjunctions of Mars, Jupiter, Saturn. */
    planets: true,
  },
  /**
   * The local sky: Sun and Moon altitude on the pages (a dot per line on lined pages, trajectories on canvases) and their
   * rise, culmination and set. `lat` / `lon` in degrees (north, east positive); null = the main city of the diary's zone
   * (src/diary/places.js). `place` is a free label. `dot`: the diameter (mm) of the Sun and Moon marks.
   */
  sky: { on: true, lat: null, lon: null, place: null, dot: 1.1 },
  closing: { summaryPages: 4 },
  style: { ink: 'color', font: 'sans' },
  /**
   * Printing: `twoUp` puts two diary pages side by side on one sheet of paper twice as wide (two A5 pages make one A4
   * landscape page exactly); `pairing` 'spreads' prints facing pages as an open book (·|1, 2|3, 4|5 …), 'sequential' 1|2, 3|4 …,
   * 'duplex' double-sided cut-and-stack: the odd PDF pages are the fronts of the sheets, the even ones their backs; cut
   * every sheet in half and lay the stack of left halves on the right halves, and the leaves are in order. `turn` says how
   * the printed stack goes back in for the backs: 'side' (over its short edge, like a book page) or 'top' (top over bottom:
   * the backs print upside down).
   */
  print: { twoUp: false, pairing: 'spreads', turn: 'side' },
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, lo, hi, int = false) => {
  let n = Number(v);
  if (!Number.isFinite(n)) n = d;
  if (int) n = Math.round(n);
  return Math.min(hi, Math.max(lo, n));
};
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

function canvas(c, d) {
  const type = CANVAS_TYPES.includes(c?.type) ? c.type : d.type;
  const out = { type };
  if (type === 'grid' || type === 'dot-grid') {
    out.cols = num(c?.cols, d.cols ?? 19, 1, 60, true);
    out.rows = num(c?.rows, d.rows ?? 7, 1, 60, true);
  } else if (type === 'dots') {
    out.count = num(c?.count, d.count ?? 240, 0, 4000, true);
  } else if (type === 'lined') {
    out.lines = num(c?.lines, d.lines ?? 18, 1, 80, true);
  }
  return out;
}
function canvases(list, defaults) {
  const src = Array.isArray(list) && list.length ? list.slice(0, 8) : defaults;
  return src.map((c, i) => canvas(c, defaults[i] ?? defaults.at(-1)));
}

/**
 * A complete, valid options object from any partial input (unknown keys dropped, numbers clamped).
 * `pure`: pure mode forces the Gregorian references off.
 */
export function sanitizeDiaryOptions(input = {}, { pure = false } = {}) {
  const d = DIARY_DEFAULTS;
  const o = isObj(input) ? input : {};
  const page = isObj(o.page) ? o.page : {};
  const size = page.size === 'custom' || PAGE_SIZES[page.size] ? page.size : d.page.size;
  const [w0, h0] = PAGE_SIZES[size] ?? [page.width, page.height];
  const m = isObj(page.margins) ? page.margins : {};
  const out = {
    page: {
      size,
      width: num(size === 'custom' ? page.width : w0, d.page.width, 80, 420),
      height: num(size === 'custom' ? page.height : h0, d.page.height, 100, 600),
      margins: {
        top: num(m.top, d.page.margins.top, 3, 40),
        bottom: num(m.bottom, d.page.margins.bottom, 3, 40),
        inner: num(m.inner, d.page.margins.inner, 3, 50),
        outer: num(m.outer, d.page.margins.outer, 3, 50),
      },
    },
    nav: { on: bool(o.nav?.on, d.nav.on) },
    gregorian: {
      on: pure ? false : bool(o.gregorian?.on, d.gregorian.on),
      zone: typeof o.gregorian?.zone === 'string' && o.gregorian.zone ? o.gregorian.zone : null,
      weekdays: bool(o.gregorian?.weekdays, d.gregorian.weekdays),
    },
    front: {
      cover: bool(o.front?.cover, d.front.cover),
      index: bool(o.front?.index, d.front.index),
      gregorianIndex: bool(o.front?.gregorianIndex, d.front.gregorianIndex),
      ephemeris: bool(o.front?.ephemeris, d.front.ephemeris),
      reference: bool(o.front?.reference, d.front.reference),
      planning: num(o.front?.planning, d.front.planning, 0, 12, true),
      predictions: num(o.front?.predictions, d.front.predictions, 0, 12, true),
    },
    lock: { sheets: lockSheets(o.lock?.sheets) },
    lined: {
      linesPerHelion: num(o.lined?.linesPerHelion, d.lined.linesPerHelion, 1, 72, true),
      labels: ['preon', 'both', 'none'].includes(o.lined?.labels) ? o.lined.labels : d.lined.labels,
      marginGlyphs: bool(o.lined?.marginGlyphs, d.lined.marginGlyphs),
      marginCurve: bool(o.lined?.marginCurve, d.lined.marginCurve),
    },
    canvases: canvases(o.canvases, d.canvases),
    semi: {
      allCanvas: bool(o.semi?.allCanvas, d.semi.allCanvas),
      canvases: canvases(o.semi?.canvases, d.semi.canvases),
    },
    retro: {
      lines: num(o.retro?.lines, d.retro.lines, 1, 144, true),
      canvases: canvases(o.retro?.canvases, d.retro.canvases),
    },
    inserts: { deltaQuarters: bool(o.inserts?.deltaQuarters, d.inserts.deltaQuarters), eclipses: bool(o.inserts?.eclipses, d.inserts.eclipses) },
    events: Object.fromEntries(Object.keys(d.events).map((k) => [k, bool(o.events?.[k], d.events[k])])),
    sky: {
      on: bool(o.sky?.on, d.sky.on),
      lat: Number.isFinite(Number(o.sky?.lat)) && o.sky?.lat !== null && o.sky?.lat !== '' ? num(o.sky.lat, 0, -90, 90) : null,
      lon: Number.isFinite(Number(o.sky?.lon)) && o.sky?.lon !== null && o.sky?.lon !== '' ? num(o.sky.lon, 0, -180, 180) : null,
      place: typeof o.sky?.place === 'string' && o.sky.place.trim() ? o.sky.place.trim().slice(0, 60) : null,
      dot: num(o.sky?.dot, d.sky.dot, 0.4, 3),
    },
    closing: { summaryPages: num(o.closing?.summaryPages, d.closing.summaryPages, 0, 16, true) },
    style: {
      ink: ['color', 'mono'].includes(o.style?.ink) ? o.style.ink : d.style.ink,
      font: ['sans', 'serif'].includes(o.style?.font) ? o.style.font : d.style.font,
    },
    print: {
      twoUp: bool(o.print?.twoUp, d.print.twoUp),
      pairing: ['spreads', 'sequential', 'duplex'].includes(o.print?.pairing) ? o.print.pairing : d.print.pairing,
      turn: ['side', 'top'].includes(o.print?.turn) ? o.print.turn : d.print.turn,
    },
  };
  if (pure) out.front.gregorianIndex = false;
  return out;
}

/** Lock sheets: 1..8 sheets of [front 1..4, back 0..4] Helions, at most 77 Helions in all. */
function lockSheets(list) {
  const d = DIARY_DEFAULTS.lock.sheets;
  if (!Array.isArray(list) || !list.length) return clone(d);
  const out = [];
  let sum = 0;
  for (const s of list.slice(0, 8)) {
    const front = num(Array.isArray(s) ? s[0] : NaN, 3, 1, 4, true);
    const back = num(Array.isArray(s) ? s[1] : NaN, 2, 0, 4, true);
    if (sum + front + back > 77) break;
    out.push([front, back]);
    sum += front + back;
  }
  return out.length ? out : clone(d);
}

/** Helions per lock and how a Nuclide (77 Helions) splits into locks and leftover (retrospection) Helions. */
export function lockShape(opts) {
  const perLock = opts.lock.sheets.reduce((s, [a, b]) => s + a + b, 0);
  const locks = Math.floor(77 / perLock);
  return { perLock, locks, retro: 77 - locks * perLock };
}

/** Landscape paper that holds two pages side by side exactly (ISO halves, US Letter); else twice the page width. */
const TWO_UP_PAPER = [
  ['A4', 297, 210],
  ['A5', 210, 148],
  ['A3', 420, 297],
  ['B4', 353, 250],
  ['Letter', 279.4, 215.9],
];
/**
 * The paper a print of these options needs: one page, or with `print.twoUp` two pages side by side. Two A5 pages
 * (148 mm wide each) sit on A4 landscape (297 × 210 mm); a page narrower than half the paper is centred in its half.
 * @returns {{width:number, height:number, name:string|null, twoUp:boolean, cell:number}} cell = the width of one half
 */
export function paperSize(opts) {
  const { width: W, height: H } = opts.page;
  if (!opts.print?.twoUp) return { width: W, height: H, name: null, twoUp: false, cell: W };
  const hit = TWO_UP_PAPER.find(([, w, h]) => Math.abs(h - H) < 1.01 && w >= 2 * W - 0.01 && w - 2 * W < 2.5);
  if (hit) return { width: hit[1], height: hit[2], name: hit[0], twoUp: true, cell: hit[1] / 2 };
  return { width: 2 * W, height: H, name: null, twoUp: true, cell: W };
}

/** Text rows that fit a page of the front matter (index, ephemeris): used by the planner and the renderer alike. */
export function rowsPerPage(opts, { rowHeight = 5.4, header = 22 } = {}) {
  const { height, margins } = opts.page;
  return Math.max(8, Math.floor((height - margins.top - margins.bottom - header) / rowHeight));
}
/** Month grids per page of the Gregorian index. */
export const monthsPerPage = (opts) => (opts.page.height >= 270 ? 3 : 2);
