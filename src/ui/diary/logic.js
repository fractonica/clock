/**
 * Diary tab – DOM-free helpers (unit-tested in test/diary-ui.test.js).
 *
 *   spreads and page stepping · the Delta pickers (valid ordinals, clamping a path) · option paths (get / set) ·
 *   persistence of the options and of the tab's own state · readouts (lock shape, paper)
 */
import { DIARY_DEFAULTS, PAGE_SIZES, sanitizeDiaryOptions, paperSize } from '../../diary/options.js';

/** localStorage key of the diary options (the sanitized options object itself, also usable with `--options`). */
export const OPTIONS_KEY = 'fractonica.diary.v1';
/** localStorage key of the tab's own state (follow, chosen Delta, page, layout, open groups). */
export const UI_KEY = 'fractonica.diary.ui.v1';

// ---- pages and spreads -------------------------------------------------------------------------------

/** A page number clamped into 1..count (garbage → 1). */
export function clampPage(no, count) {
  const n = Math.round(Number(no));
  return Math.min(Math.max(1, Number.isFinite(n) ? n : 1), Math.max(1, count));
}
/**
 * The two pages that face each other around page `no` of a book of `count` pages: [verso | null, recto | null].
 * Page 1 is a recto on its own; an even last page is a verso on its own.
 */
export function spreadOf(no, count) {
  const p = clampPage(no, count);
  const left = p % 2 === 0 ? p : p - 1;
  const right = left + 1;
  return [left >= 1 ? left : null, right <= count ? right : null];
}
/** Turn one page (or one spread) forward (dir +1) or back (dir −1); stays put at the ends. */
export function stepPage(no, dir, count, spread = false) {
  const p = clampPage(no, count);
  if (!spread) return clampPage(p + Math.sign(dir), count);
  const [l, r] = spreadOf(p, count);
  if (dir > 0) {
    const to = (r ?? l) + 1;
    return to <= count ? to : p;
  }
  const to = (l ?? r) - 1;
  return to >= 1 ? to : p;
}
/** The section that holds page `no`: the last section starting at or before it (sections sorted by page), or null. */
export function sectionAt(sections, no) {
  let hit = null;
  for (const s of sections ?? []) if (s.page <= no && (!hit || s.page >= hit.page)) hit = s;
  return hit;
}

// ---- the Delta pickers ----------------------------------------------------------------------------------

/** Ordinals per parent below Alpha: β in α, γ in β, δ in γ (SPEC §3.1: 5, 13, 5). */
export const SIBLINGS = Object.freeze([null, 5, 13, 5]);
/** Global Delta index of ordinals [α, β, γ, δ] (1-based), without a range check (plan.js deltaFromPath adds one). */
export function rawDeltaIndex([a, b, g, d]) {
  return (((a - 1) * 5 + (b - 1)) * 13 + (g - 1)) * 5 + (d - 1);
}
/** Ordinals [α, β, γ, δ] of a global Delta index (the inverse of rawDeltaIndex). */
export function pathOfIndex(idx) {
  const i = Math.max(0, Math.floor(idx));
  return [Math.floor(i / 325) + 1, (Math.floor(i / 65) % 5) + 1, (Math.floor(i / 5) % 13) + 1, (i % 5) + 1];
}
/**
 * The ordinals a picker of level L (0 α … 3 δ) may offer, given the ordinals above it in `path`:
 * [{ord, ok}] where ok = some Delta under that choice lies inside `range` {first, last}.
 */
export function ordinalChoices(level, path, range) {
  const count = level === 0 ? pathOfIndex(range.last)[0] : SIBLINGS[level];
  const out = [];
  for (let ord = 1; ord <= count; ord++) {
    const lo = [...path.slice(0, level), ord, 1, 1, 1].slice(0, 4);
    const hi = [...path.slice(0, level), ord, ...SIBLINGS.slice(level + 1)].slice(0, 4);
    out.push({ ord, ok: rawDeltaIndex(hi) >= range.first && rawDeltaIndex(lo) <= range.last });
  }
  return out;
}
/** A path changed at one level: the nearest Delta inside the range (an impossible combination clamps to the range). */
export function clampDelta(path, range) {
  const idx = rawDeltaIndex(path.map((x) => Math.max(1, Math.round(Number(x)) || 1)));
  return Math.min(range.last, Math.max(range.first, idx));
}

// ---- options ----------------------------------------------------------------------------------------------

const clone = (o) => JSON.parse(JSON.stringify(o));
/** Read a dotted path ("page.margins.top", "canvases.1.cols") from an object. */
export function getIn(obj, path) {
  return String(path)
    .split('.')
    .reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}
/** A copy of `obj` with the dotted `path` set to `value` (intermediate objects are created). */
export function setIn(obj, path, value) {
  const out = clone(obj ?? {});
  const keys = String(path).split('.');
  let o = out;
  for (const k of keys.slice(0, -1)) {
    if (o[k] === null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
  return out;
}

/** Defaults as a fresh, complete options object. */
export const defaultOptions = () => sanitizeDiaryOptions(clone(DIARY_DEFAULTS));

/** The stored options (always complete and valid; Gregorian settings kept, whatever the mode). */
export function loadOptions(storage) {
  try {
    const raw = storage?.getItem(OPTIONS_KEY);
    return sanitizeDiaryOptions(raw ? JSON.parse(raw) : {});
  } catch {
    return defaultOptions();
  }
}
export function saveOptions(storage, opts) {
  if (!storage) return false;
  try {
    storage.setItem(OPTIONS_KEY, JSON.stringify(opts));
    return true;
  } catch {
    return false;
  }
}

const UI_DEFAULTS = Object.freeze({ follow: true, delta: null, page: 1, layout: 'spread', open: ['paper', 'lock'] });
/** The tab's own state, validated field by field. */
export function loadUi(storage) {
  let o = {};
  try {
    const raw = storage?.getItem(UI_KEY);
    o = raw ? JSON.parse(raw) : {};
  } catch {
    o = {};
  }
  if (!o || typeof o !== 'object') o = {};
  return {
    follow: typeof o.follow === 'boolean' ? o.follow : UI_DEFAULTS.follow,
    delta: Number.isInteger(o.delta) && o.delta >= 0 ? o.delta : null,
    page: Number.isInteger(o.page) && o.page >= 1 ? o.page : 1,
    layout: o.layout === 'page' ? 'page' : 'spread',
    open: Array.isArray(o.open) ? o.open.filter((x) => typeof x === 'string').slice(0, 20) : [...UI_DEFAULTS.open],
  };
}
export function saveUi(storage, ui) {
  if (!storage) return false;
  try {
    storage.setItem(UI_KEY, JSON.stringify(ui));
    return true;
  } catch {
    return false;
  }
}

// ---- readouts -----------------------------------------------------------------------------------------------

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** "19 Helions per lock · 4 locks + 1 retrospection Helion" from lockShape(opts). */
export function lockReadout({ perLock, locks, retro }) {
  const tail = retro ? `+ ${plural(retro, 'retrospection Helion')}` : '· no retrospection Helion';
  return `${plural(perLock, 'Helion')} per lock · ${plural(locks, 'lock')} ${tail}`;
}
/** Millimetres for display: 148 → "148", 139.7 → "139.7". */
export const mm = (v) => String(Math.round(Number(v) * 10) / 10);
/**
 * The paper as a label: "A5 · 148 × 210 mm". In pure mode the ISO names are left out (a bare "A5" reads like a note
 * name there): "148 × 210 mm · A series".
 */
export function paperLabel(size, page, pureMode = false) {
  const dims = size === 'custom' || !PAGE_SIZES[size] ? [page?.width, page?.height] : PAGE_SIZES[size];
  const d = `${mm(dims[0])} × ${mm(dims[1])} mm`;
  if (size === 'custom') return `Custom · ${d}`;
  const series = /^([AB])\d$/.exec(size);
  if (series) return pureMode ? `${d} · ${series[1]} series` : `${size} · ${d}`;
  return `${size} · ${d}`;
}
/** Sheets (leaves) of a book of `pages` pages. */
export const sheetsOf = (pages) => Math.ceil(pages / 2);

// ---- printing ---------------------------------------------------------------------------------------------

/**
 * Pages of the PDF for a diary of `pages` pages: one per page, or with two-up printing two per sheet of paper —
 * facing pages as an open book ('spreads': page 1 alone on the right, then 2|3 …) or in order ('sequential': 1|2 …).
 */
export function printSheets(pages, print) {
  if (!print?.twoUp) return pages;
  return print.pairing === 'sequential' ? Math.ceil(pages / 2) : Math.ceil((pages + 1) / 2);
}
const orient = (w, h) => (w > h ? 'landscape' : 'portrait');
/**
 * What two-up printing makes of these options' pages: "2 × A5 on A4 landscape (297 × 210 mm)". In pure mode the ISO
 * names are left out (they read like note names there): "2 pages on 297 × 210 mm, landscape".
 */
export function twoUpLabel(opts, pureMode = false) {
  const p = paperSize({ ...opts, print: { ...opts.print, twoUp: true } });
  const dims = `${mm(p.width)} × ${mm(p.height)} mm`;
  if (!pureMode && p.name && opts.page.size !== 'custom') return `2 × ${opts.page.size} on ${p.name} ${orient(p.width, p.height)} (${dims})`;
  return `2 pages on ${dims}, ${orient(p.width, p.height)}`;
}
/** The PDF an export makes: "PDF: 101 pages of A4 landscape · 297 × 210 mm, two diary pages each (facing pages)". */
export function printLine(opts, pages, pureMode = false) {
  const p = paperSize(opts);
  const n = printSheets(pages, opts.print);
  const dims = `${mm(p.width)} × ${mm(p.height)} mm`;
  if (!p.twoUp) {
    const named = !pureMode && opts.page.size !== 'custom' ? `${opts.page.size} · ` : '';
    return `PDF: ${n} pages of ${named}${dims}`;
  }
  const paper = !pureMode && p.name ? `${p.name} ${orient(p.width, p.height)} · ${dims}` : `${dims} ${orient(p.width, p.height)}`;
  return `PDF: ${n} pages of ${paper}, two diary pages each (${opts.print.pairing === 'sequential' ? 'in order' : 'facing pages'})`;
}
/** Do these options differ from the defaults outside the print group (then the command line needs --options)? */
export function customOptions(opts) {
  const strip = (o) => JSON.stringify({ ...sanitizeDiaryOptions(o), print: null });
  return strip(opts) !== strip({});
}
/** The command that writes this diary directly: "node tools/diary-pdf.mjs --path 6,4,9,3 --two-up --pure". */
export function cliCommand(path, opts, { pureMode = false } = {}) {
  const a = ['node tools/diary-pdf.mjs', `--path ${path.join(',')}`];
  if (customOptions(opts)) a.push('--options diary-options.json');
  if (opts.print?.twoUp) a.push('--two-up');
  if (opts.print?.twoUp && opts.print.pairing === 'sequential') a.push('--pairing sequential');
  if (pureMode) a.push('--pure');
  return a.join(' ');
}
