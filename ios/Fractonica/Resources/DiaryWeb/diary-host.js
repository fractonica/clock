/**
 * The Diary feature's web host: the web app's diary renderer, driven from Swift (ios/Fractonica/Features/Diary).
 *
 * Nothing of the diary is ported: this page imports the web app's own modules from the bundle's web/ copy
 * (src/ui/diary/build.js plans the book exactly as the web Diary tab and tools/diary-pdf.mjs do, src/diary/render.js
 * draws its pages) and adds only what the native screen needs:
 *
 *   fxDiary.configure({token, delta, options, appZone, pureMode, page, layout})   plan the book (newest call wins)
 *   fxDiary.go(no, smooth) · fxDiary.step(dir) · fxDiary.setLayout('page' | 'spread') · fxDiary.setInsets({…})
 *   fxDiary.setShown(t | null)          mark the page that holds the displayed moment; returns its page or null
 *   fxDiary.printDocument()             the print document (src/diary/render.js printDocument) and what it prints on
 *   fxDiary.svg(no) · fxDiary.thumb(no, px)   one page as SVG markup, or as a PNG data URL `px` pixels wide
 *
 * The pages show as a horizontally paged strip (one page, or a spread of verso | recto when the view is wide enough),
 * drawn lazily around the visible one and released again far from it. Messages to Swift are JSON strings:
 *   {type:'ready'} · {type:'progress', token, phase} · {type:'plan', token, final, …summary} ·
 *   {type:'page', no, pair, spread, wide} · {type:'tap', no} · {type:'error', token, message}
 */
import { createModel } from './web/src/core/model.js';
import { createPure } from './web/src/core/pure.js';
import { paperSize } from './web/src/diary/options.js';
import { placeOf, zonePlace } from './web/src/diary/places.js';
import { buildDiary, createEventCache, createSkyCache, createEclipseCache } from './web/src/ui/diary/build.js';
import { printSheets, clampPage, spreadOf } from './web/src/ui/diary/logic.js';
import { renderPage, printDocument, pageTitle } from './web/src/diary/render.js';

const SPREAD_MIN = 560; // width (CSS px) from which two pages side by side stay legible
const KEEP = 4; // slots kept drawn on each side of the visible one
const CACHE = 48; // page SVGs memoised per plan
const ASTRO = new Set(['synodic', 'anomalistic', 'draconic', 'sidereal', 'solar']);

const send = (msg) => {
  try {
    window.webkit?.messageHandlers?.diary?.postMessage(JSON.stringify(msg));
  } catch (err) {
    console.warn('[diary-host] cannot post', err);
  }
};
addEventListener('error', (e) => send({ type: 'error', token: null, message: String(e.message ?? e) }));
addEventListener('unhandledrejection', (e) => send({ type: 'error', token: null, message: String(e.reason?.message ?? e.reason) }));

const model = createModel();
const pure = createPure(model);
const caches = { eventCache: createEventCache(), skyCache: createSkyCache(), eclipseCache: createEclipseCache() };

let built = null; // {opts, zone, plan, env, title}
let seq = 0;
let layout = 'spread'; // what the reader chose; a spread shows only when the view is wide enough
let wide = false;
let page = 1;
let shownPage = null;
const svgCache = new Map();

const track = document.getElementById('track');
let slots = []; // [{el, pages: [no | null, …]}]
let current = -1; // index of the visible slot

// ---- planning ---------------------------------------------------------------------------------------------------

// a timer, not requestAnimationFrame: a page out of sight gets no frames, and planning must still go on
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

async function configure(a) {
  const my = ++seq;
  layout = a.layout === 'page' ? 'page' : 'spread';
  send({ type: 'progress', token: a.token, phase: 'planning' });
  await nextFrame(); // let the native side show that we are busy before the long task
  if (my !== seq) return;
  const args = { model, pure, input: a.options ?? {}, delta: a.delta, appZone: a.appZone, pureMode: !!a.pureMode, ...caches };
  let b;
  try {
    b = buildDiary(args);
  } catch (err) {
    send({ type: 'error', token: a.token, message: String(err?.message ?? err) });
    return;
  }
  if (my !== seq) return;
  install(b, a.token, a.page ?? page, !b.pending);
  // eclipse paths and the world map load asynchronously: plan again once they are in (the same page stays)
  for (let i = 0; b.pending && i < 3; i++) {
    try {
      await b.pending;
    } catch {
      /* planned without them */
    }
    if (my !== seq) return;
    try {
      b = buildDiary(args);
    } catch (err) {
      send({ type: 'error', token: a.token, message: String(err?.message ?? err) });
      return;
    }
    if (my !== seq) return;
    install(b, a.token, page, !b.pending);
  }
}

function install(b, token, at, final) {
  built = b;
  svgCache.clear();
  page = clampPage(at, b.plan.pages.length);
  send(summary(b, token, final));
  rebuild();
  reportPage(true);
}

function summary(b, token, final) {
  const p = b.plan;
  const o = b.opts;
  const title = (pg) => {
    try {
      return pageTitle(p, pg);
    } catch {
      return `${pg.no} · ${pg.kind}`;
    }
  };
  return {
    type: 'plan',
    token,
    final,
    title: b.title,
    zone: b.zone,
    delta: { idx: p.delta.idx, path: p.delta.path, t0: p.delta.t0, t1: p.delta.t1, name: p.delta.name, stamp: p.delta.stamp },
    pages: p.pages.map((pg) => ({ no: pg.no, kind: pg.kind, side: pg.side, title: title(pg) })),
    sections: p.sections.map((s) => ({ title: s.title, key: s.key, page: s.page })),
    shape: p.shape,
    inserts: p.inserts.length,
    eclipses: p.eclipses?.length ?? 0,
    events: p.events.filter((e) => ASTRO.has(e.family)).length,
    size: { width: o.page.width, height: o.page.height },
    paper: paperSize(o),
    sheets: printSheets(p.pages.length, o.print),
    place: o.sky.on ? placeOf(o, b.zone) : null,
    zoneCity: zonePlace(b.zone),
  };
}

// ---- pages --------------------------------------------------------------------------------------------------------

function svgOf(no) {
  if (svgCache.has(no)) {
    const v = svgCache.get(no);
    svgCache.delete(no);
    svgCache.set(no, v);
    return v;
  }
  const p = built.plan;
  let svg;
  try {
    svg = renderPage(p, p.pages[no - 1], built.env);
  } catch (err) {
    console.warn('[diary-host] page failed', no, err);
    const { width: W, height: H } = p.opts.page;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm"><rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="${H / 2}" font-size="5" text-anchor="middle" fill="#a33">Page ${no} could not be drawn</text></svg>`;
  }
  svgCache.set(no, svg);
  while (svgCache.size > CACHE) svgCache.delete(svgCache.keys().next().value);
  return svg;
}

const count = () => built?.plan.pages.length ?? 0;
const isSpread = () => layout === 'spread' && wide;
const slotOfPage = (no) => (isSpread() ? Math.floor(no / 2) : no - 1);
/** The page a slot stands for: the page itself, or in a spread its recto (its verso at the end of the book). */
const pageOfSlot = (i) => {
  const s = slots[i];
  if (!s) return 1;
  return s.pages[1] ?? s.pages[0] ?? 1;
};

function measure() {
  wide = track.clientWidth >= SPREAD_MIN;
}

function sizePapers() {
  if (!built) return;
  const { width: W, height: H } = built.plan.opts.page;
  const cs = getComputedStyle(document.documentElement);
  const padT = parseFloat(cs.getPropertyValue('--pad-t')) || 0;
  const padB = parseFloat(cs.getPropertyValue('--pad-b')) || 0;
  const padX = parseFloat(cs.getPropertyValue('--pad-x')) || 0;
  const n = isSpread() ? 2 : 1;
  const aw = track.clientWidth - 2 * padX;
  const ah = track.clientHeight - padT - padB;
  const pw = Math.max(40, Math.min(aw / n, (ah * W) / H));
  document.documentElement.style.setProperty('--pw', `${Math.floor(pw)}px`);
  document.documentElement.style.setProperty('--ph', `${Math.floor((pw * H) / W)}px`);
}

function rebuild() {
  measure();
  const n = count();
  const groups = [];
  if (isSpread()) {
    for (let left = 0; left <= n; left += 2) groups.push([left >= 1 ? left : null, left + 1 <= n ? left + 1 : null]);
  } else {
    for (let no = 1; no <= n; no++) groups.push([no]);
  }
  const frag = document.createDocumentFragment();
  slots = groups.map((pages, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.i = String(i);
    const leaf = document.createElement('div');
    leaf.className = pages.length === 2 ? 'leaf two' : 'leaf';
    for (const no of pages) {
      const paper = document.createElement('div');
      paper.className = no ? 'paper blank' : 'paper gap';
      if (no) {
        paper.dataset.no = String(no);
        paper.setAttribute('role', 'img');
        paper.setAttribute('aria-label', `Page ${no}`);
      } else paper.setAttribute('aria-hidden', 'true');
      leaf.append(paper);
    }
    el.append(leaf);
    frag.append(el);
    return { el, pages, drawn: false };
  });
  track.replaceChildren(frag);
  sizePapers();
  current = -1;
  scrollToSlot(slotOfPage(page), false);
  markShown();
  sync();
}

function drawSlot(i) {
  const s = slots[i];
  if (!s || s.drawn) return;
  s.drawn = true;
  for (const paper of s.el.querySelectorAll('.paper[data-no]')) {
    const no = Number(paper.dataset.no);
    paper.innerHTML = svgOf(no);
    paper.classList.remove('blank');
    paper.setAttribute('aria-label', titleText(no));
  }
}
function releaseSlot(i) {
  const s = slots[i];
  if (!s || !s.drawn) return;
  s.drawn = false;
  for (const paper of s.el.querySelectorAll('.paper[data-no]')) {
    paper.replaceChildren();
    paper.classList.add('blank');
  }
}
const titleText = (no) => {
  try {
    return `Page ${pageTitle(built.plan, built.plan.pages[no - 1])}`;
  } catch {
    return `Page ${no}`;
  }
};

// The visible slot first, then its neighbours, one per task so a swipe never waits on drawing.
let pump = null;
function schedule() {
  if (pump) return;
  pump = setTimeout(runPump, 0);
}
function runPump() {
  pump = null;
  if (!slots.length) return;
  const i = current < 0 ? 0 : current;
  const order = [i, i + 1, i - 1, i + 2, i - 2, i + 3, i - 3];
  const next = order.find((k) => slots[k] && !slots[k].drawn);
  if (next !== undefined) {
    drawSlot(next);
    schedule();
    return;
  }
  slots.forEach((s, k) => Math.abs(k - i) > KEEP && releaseSlot(k));
}

function visibleSlot() {
  const w = track.clientWidth || 1;
  return Math.max(0, Math.min(slots.length - 1, Math.round(track.scrollLeft / w)));
}

function sync() {
  const i = visibleSlot();
  if (i !== current) {
    current = i;
    // a spread keeps the page asked for when it is one of its two
    if (!slots[i]?.pages.includes(page)) page = pageOfSlot(i);
    reportPage();
  }
  schedule();
}

let lastReport = '';
function reportPage(force = false) {
  if (!built) return;
  const s = slots[current] ?? slots[slotOfPage(page)];
  const pair = s ? s.pages : [page];
  const msg = { type: 'page', no: page, pair, spread: isSpread(), wide };
  const key = JSON.stringify(msg);
  if (!force && key === lastReport) return;
  lastReport = key;
  send(msg);
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function scrollToSlot(i, smooth) {
  if (reduceMotion.matches) smooth = false;
  const w = track.clientWidth;
  const left = Math.max(0, i) * w;
  if (smooth && Math.abs(track.scrollLeft - left) <= 3 * w) track.scrollTo({ left, behavior: 'smooth' });
  else track.scrollLeft = left;
  if (!smooth) sync();
}

function go(no, smooth = true) {
  if (!built) {
    page = Math.max(1, Math.round(Number(no)) || 1);
    return;
  }
  page = clampPage(no, count());
  const i = slotOfPage(page);
  scrollToSlot(i, smooth);
  if (i === current) reportPage();
}

function step(dir) {
  if (!built) return;
  const i = Math.max(0, Math.min(slots.length - 1, (current < 0 ? slotOfPage(page) : current) + Math.sign(dir)));
  scrollToSlot(i, true);
}

function markShown() {
  for (const el of track.querySelectorAll('.paper.shown')) el.classList.remove('shown');
  if (shownPage) track.querySelector(`.paper[data-no="${shownPage}"]`)?.classList.add('shown');
}

let scrollIdle = null;
track.addEventListener(
  'scroll',
  () => {
    sync();
    clearTimeout(scrollIdle);
    scrollIdle = setTimeout(sync, 120);
  },
  { passive: true },
);
let resizeFrame = null;
new ResizeObserver(() => {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (!built) return;
    const was = isSpread();
    measure();
    if (was !== isSpread()) rebuild();
    else {
      sizePapers();
      scrollToSlot(slotOfPage(page), false);
    }
  });
}).observe(track);

track.addEventListener('click', (e) => {
  const paper = e.target.closest?.('.paper[data-no]');
  if (paper) send({ type: 'tap', no: Number(paper.dataset.no) });
});
track.addEventListener('keydown', (e) => {
  const map = { ArrowLeft: -1, ArrowRight: 1, PageUp: -1, PageDown: 1 };
  if (e.key in map) {
    e.preventDefault();
    step(map[e.key]);
  } else if (e.key === 'Home') {
    e.preventDefault();
    go(1);
  } else if (e.key === 'End') {
    e.preventDefault();
    go(count());
  }
});

// A mouse wheel (or a vertical swipe on a trackpad) turns one page per gesture: the strip only scrolls sideways, so
// vertical wheel motion would otherwise do nothing. A turn waits until the wheel has been still for a moment, so the
// momentum of one swipe never turns several pages. Sideways motion keeps scrolling the strip natively.
let wheelSum = 0;
let wheelQuietAt = 0;
track.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    const now = performance.now();
    const busy = now < wheelQuietAt;
    wheelQuietAt = now + 180;
    if (busy) return;
    wheelSum += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (Math.abs(wheelSum) < 24) {
      wheelQuietAt = 0;
      return;
    }
    step(Math.sign(wheelSum));
    wheelSum = 0;
  },
  { passive: false },
);

// ---- export -------------------------------------------------------------------------------------------------------

function printDoc() {
  if (!built) throw new Error('the diary is not planned yet');
  const { plan, env, title, opts } = built;
  const html = printDocument(plan, env, { title });
  return {
    html,
    title,
    pages: plan.pages.length,
    sheets: printSheets(plan.pages.length, opts.print),
    paper: paperSize(opts),
    twoUp: !!opts.print.twoUp,
    pairing: opts.print.pairing,
  };
}

async function thumb(no, px) {
  if (!built) return null;
  const n = clampPage(no, count());
  const { width: W, height: H } = built.plan.opts.page;
  const w = Math.max(16, Math.round(px));
  const h = Math.round((w * H) / W);
  const url = URL.createObjectURL(new Blob([svgOf(n)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

window.fxDiary = {
  configure,
  go,
  step,
  setLayout(l) {
    const next = l === 'page' ? 'page' : 'spread';
    if (next === layout) return;
    layout = next;
    if (built) rebuild();
  },
  setInsets({ top = 12, bottom = 12, x = 16 } = {}) {
    const r = document.documentElement.style;
    r.setProperty('--pad-t', `${top}px`);
    r.setProperty('--pad-b', `${bottom}px`);
    r.setProperty('--pad-x', `${x}px`);
    sizePapers();
  },
  setShown(t) {
    const p = built?.plan;
    const no = p && Number.isFinite(t) && t >= p.delta.t0 && t < p.delta.t1 ? p.pageOf(t) : null;
    if (no !== shownPage) {
      shownPage = no;
      markShown();
    }
    return no;
  },
  printDocument: printDoc,
  svg: (no) => (built ? svgOf(clampPage(no, count())) : null),
  thumb,
  spreadOf: (no) => spreadOf(no, count()),
  get state() {
    return { page, current, slots: slots.length, spread: isSpread(), wide, pages: count(), planned: !!built };
  },
};

send({ type: 'ready' });
