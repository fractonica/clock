/**
 * Month calendar and year ribbon data (pure). A month grid is always 6 weeks × 7 days
 * (stable layout); every cell is a LOCAL day of the zone bound to the formatter, delimited
 * by real local midnights (never "+86400": DST days are 23 or 25 hours). Cycles of the
 * chosen overlay level are cut into per-day segments positioned by elapsed time.
 */
import { daysFromCivil, daysInMonth } from '../../core/format.js';
import { addDays, cycleLabel, dayStart, eclipseInWindow, safeSolarAt, syncRange } from './convert.js';

/** Overlay choices of the month band: cycle levels γ..η and the solar sync quarters. */
export const OVERLAYS = [
  { id: 2, level: 2, label: 'γ', title: 'Gamma · 1.1 years' },
  { id: 3, level: 3, label: 'δ', title: 'Delta · 81 days' },
  { id: 4, level: 4, label: 'ε', title: 'Epsilon · 16 days' },
  { id: 5, level: 5, label: 'ζ', title: 'Zeta · 2.3 days' },
  { id: 6, level: 6, label: 'η', title: 'Eta · 5 hours' },
  { id: 'sync', level: null, label: 'Solar sync', title: 'Solar sync · 19 η cycles ≈ 4 days' },
];
export const overlayById = (id) => OVERLAYS.find((o) => String(o.id) === String(id)) ?? OVERLAYS[2];

/** Years the month view can show (the catalogue runs 1613-05-19 … 2857-06-13). */
export const FIRST_YEAR = 1613;
export const LAST_YEAR = 2857;
/**
 * Normalise and clamp a (year, month) pair as one month index: month 0 is December of the year before,
 * month 13 January of the next, and the ends stay put (January 1613 is the first month, December 2857 the last).
 */
export function clampMonth(year, month) {
  const idx = Math.max(FIRST_YEAR * 12, Math.min(LAST_YEAR * 12 + 11, year * 12 + (month - 1)));
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Day of week (0 = Sunday) of a civil date. */
export function weekdayOf(y, m, d) {
  return ((daysFromCivil(y, m, d) % 7) + 11) % 7;
}
export const pad2 = (n) => String(n).padStart(2, '0');
export const dayKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

// ---------------------------------------------------------------------------------------------
// cycles in a window
// ---------------------------------------------------------------------------------------------
/**
 * Cycles of `level` that overlap [t0, t1) inside the catalogue, ordered, each with its full
 * extent: {level, idx, local (0-based), siblings, start, end, clipped}.
 */
export function cyclesInWindow(model, level, t0, t1) {
  const lo = Math.max(t0, model.tMin);
  const hi = Math.min(t1, model.tMax);
  if (!(hi > lo)) return [];
  const info = model.levelInfo(level);
  const total = Number(model.clock.count(level));
  const P = info.prefixNum;
  let i = Math.max(0, Math.min(total - 1, Math.floor((model.positionOf(lo) * P) / 4)));
  while (i > 0 && model.cycleStartTime(level, i) > lo) i--;
  while (i + 1 < total) {
    const nx = model.cycleStartTime(level, i + 1);
    if (nx !== null && nx <= lo) i++;
    else break;
  }
  const out = [];
  for (; i < total; i++) {
    const start = model.cycleStartTime(level, i);
    if (start === null || start >= hi) break;
    const nx = model.cycleStartTime(level, i + 1);
    out.push({
      level,
      idx: i,
      local: info.siblings === null ? i : i % info.siblings,
      siblings: info.siblings,
      start,
      end: nx === null ? model.tMax : nx,
      clipped: nx === null,
    });
  }
  return out;
}

const QUARTER_START_NAMES = ['start', 'peak', 'node', 'valley'];
const QUARTER_END_NAMES = ['peak', 'node', 'valley', 'end'];

/**
 * Solar syncs overlapping [t0, t1) as quarter segments:
 * {sync, q (0..3), name (threshold at the quarter's start), endName, start, end,
 *  syncStart, syncEnd, nominalStart, drift}
 */
export function syncQuartersInWindow(model, t0, t1) {
  const range = syncRange(model);
  const lo = Math.max(t0, model.tMin);
  const hi = Math.min(t1, model.tMax);
  if (!(hi > lo)) return [];
  const probe = Math.min(Math.max(lo, model.tMin + 8 * 86400), model.tMax - 8 * 86400);
  let n = safeSolarAt(model, probe)?.sync ?? range.first;
  n = Math.min(Math.max(n, range.first), range.last);
  while (n > range.first) {
    const prev = model.solarSyncByNumber(n - 1);
    if (prev && prev.end > lo) n--;
    else break;
  }
  const out = [];
  for (; n <= range.last; n++) {
    const s = model.solarSyncByNumber(n);
    if (!s) continue;
    if (s.end <= lo) continue;
    if (s.start >= hi) break;
    const len = s.end - s.start;
    for (let q = 0; q < 4; q++) {
      out.push({
        sync: n,
        q,
        name: QUARTER_START_NAMES[q],
        endName: QUARTER_END_NAMES[q],
        start: s.start + (q / 4) * len,
        end: s.start + ((q + 1) / 4) * len,
        syncStart: s.start,
        syncEnd: s.end,
        nominalStart: s.nominalStart,
        drift: s.drift,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// month grid
// ---------------------------------------------------------------------------------------------
/**
 * The 42 local days of the month view. weekStart: 1 = Monday, 0 = Sunday.
 * @returns {{year:number, month:number, weekStart:number, cells:object[], start:number, end:number}}
 */
export function monthGrid(f, year, month, weekStart = 1) {
  const zone = f.zone();
  const lead = (weekdayOf(year, month, 1) - weekStart + 7) % 7;
  const first = addDays(year, month, 1, -lead);
  const days = [];
  for (let i = 0; i <= 42; i++) days.push(addDays(first.year, first.month, first.day, i));
  const starts = days.map((d) => dayStart(zone, d.year, d.month, d.day));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = days[i];
    cells.push({
      index: i,
      year: d.year,
      month: d.month,
      day: d.day,
      key: dayKey(d.year, d.month, d.day),
      inMonth: d.month === month && d.year === year,
      dow: weekdayOf(d.year, d.month, d.day),
      start: starts[i],
      end: starts[i + 1],
      length: starts[i + 1] - starts[i],
      // a date the zone skipped altogether (Pacific/Apia 2011-12-30) has no instants: length 0, no band
      skipped: starts[i + 1] <= starts[i],
      segments: [],
    });
  }
  return { year, month, weekStart, cells, start: starts[0], end: starts[42] };
}

/**
 * Month grid with the overlay band filled in.
 * @param {{year:number, month:number, weekStart?:number, overlay?:number|string}} opts
 */
export function buildMonth(model, f, { year, month, weekStart = 1, overlay = 4 }) {
  const grid = monthGrid(f, year, month, weekStart);
  const ov = overlayById(overlay);
  const items =
    ov.id === 'sync' ? syncQuartersInWindow(model, grid.start, grid.end) : cyclesInWindow(model, ov.level, grid.start, grid.end);
  let j = 0;
  for (const cell of grid.cells) {
    cell.inRange = !cell.skipped && cell.end > model.tMin && cell.start <= model.tMax;
    cell.eclipse = cell.inRange ? eclipseInWindow(model, cell.start, cell.end) : -1;
    if (!cell.inRange) continue;
    while (j < items.length && items[j].end <= cell.start) j++;
    for (let k = j; k < items.length && items[k].start < cell.end; k++) {
      const it = items[k];
      const x0 = Math.max(0, (it.start - cell.start) / cell.length);
      const x1 = Math.min(1, (it.end - cell.start) / cell.length);
      const seg =
        ov.id === 'sync'
          ? {
              kind: 'sync',
              key: `S${it.sync}:${it.q}`,
              sync: it.sync,
              q: it.q,
              name: it.name,
              endName: it.endName,
              label: `S${it.sync} · ${it.name}`,
              short: it.q === 0 ? `S${it.sync}` : it.name,
              parity: it.q % 2,
              syncStart: it.syncStart,
              syncEnd: it.syncEnd,
              nominalStart: it.nominalStart,
              drift: it.drift,
            }
          : {
              kind: 'cycle',
              key: `${it.level}:${it.idx}`,
              level: it.level,
              idx: it.idx,
              local: it.local,
              siblings: it.siblings,
              clipped: it.clipped,
              // "ε#5": the 5th ε inside its δ (a bare "ε 5" is the depth chip of the other views)
              label: cycleLabel(it.level, it.local + 1),
              short: `#${it.local + 1}`,
              parity: it.idx % 2,
            };
      seg.start = it.start;
      seg.end = it.end;
      seg.x0 = x0;
      seg.x1 = x1;
      seg.startsHere = it.start >= cell.start;
      seg.endsHere = it.end < cell.end;
      cell.segments.push(seg);
    }
  }
  return { ...grid, overlay: ov, items };
}

// ---------------------------------------------------------------------------------------------
// year ribbon
// ---------------------------------------------------------------------------------------------
/**
 * Months of `year` as fractions of the year plus the δ and ε cycle starts inside it.
 */
export function yearRibbon(model, f, year) {
  const zone = f.zone();
  const starts = [];
  for (let m = 1; m <= 13; m++) starts.push(dayStart(zone, m === 13 ? year + 1 : year, m === 13 ? 1 : m, 1));
  const y0 = starts[0];
  const y1 = starts[12];
  const len = y1 - y0;
  const months = [];
  for (let m = 0; m < 12; m++) {
    months.push({
      month: m + 1,
      start: starts[m],
      end: starts[m + 1],
      x0: (starts[m] - y0) / len,
      x1: (starts[m + 1] - y0) / len,
      days: daysInMonth(year, m + 1),
      inRange: starts[m + 1] > model.tMin && starts[m] <= model.tMax,
    });
  }
  const ticks = (level) =>
    cyclesInWindow(model, level, y0, y1)
      .filter((c) => c.start >= y0 && c.start < y1)
      .map((c) => ({ level, idx: c.idx, local: c.local, start: c.start, x: (c.start - y0) / len, label: cycleLabel(level, c.local + 1) }));
  return { year, start: y0, end: y1, months, delta: ticks(3), eps: ticks(4) };
}

/** Compact address of a cycle: "γ#9·δ#3". */
export function shortPath(model, level, idx) {
  const path = model.cycleToPath(level, BigInt(idx));
  if (level === 0) return cycleLabel(0, path[0]);
  return `${cycleLabel(level - 1, path[level - 1])}·${cycleLabel(level, path[level])}`;
}

/**
 * How much of each level a year covers, e.g. "2026 covers 4.5 δ cycles (γ#9·δ#3 … γ#10·δ#2) and
 * 22.5 ε cycles". Coverage sums each cycle's overlapping fraction.
 */
export function yearSummary(model, f, year) {
  const zone = f.zone();
  const y0 = dayStart(zone, year, 1, 1);
  const y1 = dayStart(zone, year + 1, 1, 1);
  const per = (level) => {
    const cs = cyclesInWindow(model, level, y0, y1);
    if (!cs.length) return null;
    let cover = 0;
    const mean = model.levelInfo(level).meanSeconds;
    for (const c of cs) {
      const len = c.clipped ? mean : c.end - c.start;
      cover += (Math.min(c.end, y1) - Math.max(c.start, y0)) / len;
    }
    const first = cs[0];
    const last = cs[cs.length - 1];
    return { level, cover, count: cs.length, first: shortPath(model, level, first.idx), last: shortPath(model, level, last.idx) };
  };
  const delta = per(3);
  const eps = per(4);
  let text;
  if (!delta) text = `${year} lies outside the catalogue`;
  else {
    const n1 = delta.cover.toFixed(1);
    const n2 = eps.cover.toFixed(1);
    text = `${year} covers ${n1} δ cycles (${delta.first}${delta.count > 1 ? ' … ' + delta.last : ''}) and ${n2} ε cycles`;
  }
  return { year, delta, eps, text };
}
