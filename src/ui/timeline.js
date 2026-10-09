/**
 * Timeline – zoomable, pannable multi-scale navigator (docs/design/40-timeline.md).
 *
 * One canvas draws, top to bottom: the catalogue overview strip, the zone-aware Gregorian axis,
 * one lane per depth with the cycles of that depth as blocks, and the Saros 141 eclipse lane.
 * This file owns the DOM, the window state (centre + span), animation, input and the tooltip;
 * pure maths lives in timeline/helpers.js, cached model queries in timeline/data.js and all
 * drawing in timeline/paint.js.
 */
import {
  PRESETS,
  clampWindow,
  zoomAtFraction,
  makeScale,
  fitWindow,
  centreOn,
  presetSpan,
  activePreset,
  interpolateWindow,
  easeOutCubic,
  computeLayout,
  stageHeight,
  regionAt,
  pickStep,
  nearestWithin,
  lastStartAtOrBefore,
  roundMs,
  validLevel,
  stepLevel,
  hitTest,
  formatCycleLength,
  cycleName,
  rowReadout,
  depthWords,
  fitTitle,
  LANE_SELECT_HINT,
  selectedDepthSentence,
} from './timeline/helpers.js';
import { createData } from './timeline/data.js';
import { paint } from './timeline/paint.js';

const ICON = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  out: ICON('<path d="M3 8h10"/>'),
  in: ICON('<path d="M3 8h10M8 3v10"/>'),
  fit: ICON('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  centre: ICON('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>'),
  follow: ICON('<path d="M2.5 8h7M6.5 4.5 10 8l-3.5 3.5M13 3v10"/>'),
};

let mountCount = 0; // unique ids for aria-describedby when several timelines are mounted (tests)
const DBL_MS = 300; // two clicks closer than this are a double-click; a single click waits this long
const LONG_PRESS_MS = 450; // touch: press and hold shows what hovering shows with a mouse
const TOUCH_TIP_MS = 5000; // ... and the tooltip stays this long after the finger lifts
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const DAY = 86400;

export function mount(el, ctx) {
  const { model, store, fmt, theme } = ctx;
  const data = createData({ model, fmt });
  const lim = data.lim;
  const uid = ++mountCount;
  // a corrupt persisted setting must not stop the view from mounting
  const selLevel = () => validLevel(store.state.selectedLevel);

  // ---- DOM -------------------------------------------------------------------------------------
  el.innerHTML = `
    <div class="card tl-root">
      <div class="tl-toolbar" role="toolbar" aria-label="Timeline controls">
        <div class="seg tl-presets" role="group" aria-label="Zoom presets">
          ${PRESETS.map((p) => `<button type="button" data-preset="${p.id}" aria-pressed="false" title="Show ${p.id === 'all' ? 'the whole catalogue' : 'about one ' + p.id}">${p.label}</button>`).join('')}
        </div>
        <div class="tl-group">
          <button type="button" class="btn btn-icon" data-act="out" aria-label="Zoom out" title="Zoom out (-)">${ICONS.out}</button>
          <button type="button" class="btn btn-icon" data-act="in" aria-label="Zoom in" title="Zoom in (+)">${ICONS.in}</button>
        </div>
        <div class="tl-group">
          <button type="button" class="btn" data-act="fit" title="Zoom to the cycle of the selected depth at the cursor (F)">${ICONS.fit}<span class="tl-fit-label">Fit cycle</span></button>
          <button type="button" class="btn btn-icon" data-act="centre" aria-label="Centre on cursor" title="Centre the view on the time cursor (Home)">${ICONS.centre}</button>
          <button type="button" class="btn" data-act="follow" aria-pressed="false" aria-label="Follow the cursor" title="Keep the cursor at the middle of the view while time runs. Dragging turns it off.">${ICONS.follow}<span class="tl-btn-label">Follow</span></button>
        </div>
      </div>
      <div class="tl-stage" data-role="stage">
        <canvas class="tl-canvas" tabindex="0" role="application" aria-roledescription="timeline"
          aria-label="Fractonica timeline" aria-describedby="tl-sum-${uid} tl-keys-${uid}"></canvas>
        <div class="tip tl-tip" role="tooltip" hidden></div>
      </div>
      <div class="tl-foot">
        <span class="tl-win mono" data-role="win"></span>
        <span class="tl-hint dim" data-role="hint"></span>
      </div>
      <div class="sr-only" id="tl-sum-${uid}" data-role="summary"></div>
      <div class="sr-only" id="tl-keys-${uid}">Left and right arrows pan, plus and minus zoom, Home centres on the time cursor, F fits the cycle of the selected depth, Enter moves the cursor to the middle of the view, up and down select a depth.</div>
      <div class="sr-only" role="status" aria-live="polite" data-role="live"></div>
    </div>`;
  const $ = (sel) => el.querySelector(sel);
  const root = $('.tl-root');
  const stage = $('[data-role="stage"]');
  const canvas = $('.tl-canvas');
  const tip = $('.tl-tip');
  const winEl = $('[data-role="win"]');
  const hintEl = $('[data-role="hint"]');
  const liveEl = $('[data-role="live"]');
  const sumEl = $('[data-role="summary"]');
  const btnIn = $('[data-act="in"]');
  const btnOut = $('[data-act="out"]');
  const fitLabel = $('.tl-fit-label');
  const btnFollow = $('[data-act="follow"]');
  const btnFit = $('[data-act="fit"]');
  const presetBtns = [...el.querySelectorAll('[data-preset]')];
  const g = canvas.getContext('2d');

  const cssVar = (name, fallback) => {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    } catch {
      return fallback;
    }
  };
  const uiFamily = cssVar('--font-ui', 'system-ui, sans-serif');
  const monoFamily = cssVar('--font-mono', 'ui-monospace, Menlo, monospace');
  const fonts = {
    ui: (w, px) => `${w} ${px}px ${uiFamily}`,
    mono: (w, px) => `${w} ${px}px ${monoFamily}`,
  };

  const reduce = globalThis.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const coarse = globalThis.matchMedia ? matchMedia('(pointer: coarse)') : { matches: false };

  // ---- state (kept in the closure, not in localStorage) ------------------------------------------------
  let levels = [];
  let layout = null;
  let size = { w: 0, h: 0, dpr: 1, cw: 0, ch: 0 };
  let win = { c: store.t(), span: DAY };
  let anim = null; // { from, to, start, dur }
  let inertia = null; // { v } seconds of time per real second
  let follow = store.live || store.playing;
  let followOptOut = false; // the user switched Follow off with the button: do not switch it back on by itself
  let hover = null; // { x, y, cx, cy, t, lane, gutter, kind }
  let hoverEclipse = -1;
  let drag = null;
  let pinch = null;
  const pointers = new Map();
  let lastClick = null;
  let needsDraw = true;
  let tipDirty = false;
  let lastTipKey = '';
  let lastTipSec = 0;
  let pendingReveal = false;
  let lastNow = performance.now();
  let lastDraw = { c: NaN, span: NaN, t: NaN, now: NaN, dyn: '' };
  let lastLive = '';
  let lastSum = '';
  let lastSumAt = -1e9;
  let announceAt = 0; // when the user changed something: describe the view once it has settled
  let pendingClick = null; // { timer, t } a single click waiting to see whether it becomes a double-click
  let pressTimer = 0; // touch: waiting to see whether the finger stays down (long press)
  let touchTipTimer = 0; // touch: hides the long-press tooltip
  let hoverC = NaN; // window the hover time was derived from
  let hoverSpan = NaN;
  let tipMoved = false; // the window moved under a stationary pointer: refresh the tooltip, throttled
  let lastTipAt = 0;
  let initialised = false;

  const S = {
    g,
    regions: [],
    actions: {
      reveal: (t, side) => reveal(t, side),
      centreCursor: () => centreCursor(),
      centreNow: () => centreNow(),
    },
    fonts,
    theme,
    model,
    fmt,
    data,
    lim,
    catLabel: '',
  };

  // ---- levels / layout -----------------------------------------------------------------------------------
  function computeLevels() {
    const a = Math.max(1, Math.min(14, store.state.minDepth | 0));
    const b = Math.max(1, Math.min(14, store.state.maxDepth | 0));
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    levels = [];
    for (let d = lo; d <= hi; d++) levels.push(d - 1);
  }
  function relayout() {
    computeLevels();
    if (!size.w) return;
    const h = stageHeight({ lanes: levels.length, width: size.w, viewportH: globalThis.innerHeight || 900 });
    if (stage.style.height !== `${h}px`) stage.style.height = `${h}px`;
    resizeCanvas(size.w, h);
    layout = computeLayout({ width: size.w, height: h, lanes: levels.length });
    needsDraw = true;
  }
  function catLabel() {
    try {
      S.catLabel = `${fmt.parts(model.tMin).year}–${fmt.parts(model.tMax).year}`;
    } catch {
      S.catLabel = `${new Date(model.tMin * 1000).getUTCFullYear()}–${new Date(model.tMax * 1000).getUTCFullYear()}`; // unusable zone
    }
  }

  // ---- resize --------------------------------------------------------------------------------------------
  function resizeCanvas(w, h) {
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    if (w === size.cw && h === size.ch && dpr === size.dpr) return;
    size.cw = w;
    size.ch = h;
    size.h = h;
    size.dpr = dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function applyWidth(w) {
    if (w === size.w) return;
    size.w = w;
    relayout();
    if (!initialised) initWindow();
  }
  // (applied on the next frame: relayout() changes the stage height, which must not happen inside the observer)
  const ro = new ResizeObserver((entries) => {
    const w = Math.floor(entries[entries.length - 1].contentRect.width);
    if (w > 0 && w !== size.w) requestAnimationFrame(() => applyWidth(w));
  });
  ro.observe(stage);
  const onWindowResize = () => relayout();
  globalThis.addEventListener('resize', onWindowResize);

  function initWindow() {
    initialised = true;
    const sel = model.levelInfo(selLevel()).meanSeconds;
    const span = Math.min(100 * 365.25 * DAY, Math.max(3600, sel * 8)); // about eight cycles of the selected level
    win = clampWindow({ c: store.t(), span }, lim);
  }

  // ---- window geometry -------------------------------------------------------------------------------------
  const plotW = () => (layout ? layout.px1 - layout.px0 : 1);
  const scale = () => makeScale(win, layout.px0, plotW());
  const tAtX = (x) => scale().toT(x);
  const fracAtX = (x) => scale().frac(x);
  const ovTime = (x) => lim.d0 + ((x - layout.px0) / plotW()) * (lim.d1 - lim.d0);

  /** Jump straight to a window (cancels any running transition). */
  function setWindow(w) {
    win = clampWindow(w, lim);
    anim = null;
    inertia = null;
    needsDraw = true;
  }
  function animateTo(target, { dur = 250 } = {}) {
    const to = clampWindow(target, lim);
    inertia = null;
    if (reduce.matches || dur <= 0) {
      anim = null;
      win = to;
    } else anim = { from: { ...win }, to, start: performance.now(), dur };
    needsDraw = true;
  }
  const goalWindow = () => (anim ? anim.to : win);
  const cursorT = () => store.t();
  const cursorOk = () => model.inRange(cursorT());

  /** The user did something: the polite live region describes the view shortly after it has settled. */
  function userChanged() {
    announceAt = performance.now() + 650;
  }

  // ---- commands --------------------------------------------------------------------------------------------
  function setFollow(on) {
    if (follow === on) return;
    follow = on;
    syncToolbar();
    needsDraw = true;
  }
  function centreCursor() {
    if (!cursorOk()) return ctx.toast('The cursor is outside the catalogue');
    animateTo(centreOn(goalWindow(), cursorT(), lim));
  }
  function centreNow() {
    const t = store.realNow();
    if (!model.inRange(t)) return ctx.toast('The current time is outside the catalogue');
    setFollow(false);
    animateTo(centreOn(goalWindow(), t, lim));
  }
  /** Bring time t into view (about 80 % from the edge it lies beyond), keeping the cursor visible if it fits. */
  function reveal(t, side) {
    const w = goalWindow();
    const cur = cursorT();
    let c;
    if (cursorOk() && Math.abs(t - cur) < 0.72 * w.span) c = (t + cur) / 2;
    else c = side === 'left' ? t + 0.3 * w.span : t - 0.3 * w.span;
    setFollow(false);
    animateTo({ c, span: w.span });
  }
  /** Zoom about the middle of the view (about the cursor when it is pinned there by Follow). */
  function zoomBy(factor) {
    animateTo(zoomAtFraction(goalWindow(), factor, 0.5, lim), { dur: 160 });
  }
  /** Zoom factor about the cursor when following, else about the given screen fraction. */
  function zoomAnchored(factor, x) {
    if (follow && cursorOk()) {
      const w = goalWindow();
      const span = Math.min(lim.maxSpan, Math.max(lim.minSpan, w.span * factor));
      animateTo({ c: cursorT(), span }, { dur: 160 });
      return;
    }
    // anchor on what is under x *now*, then express the goal relative to that
    const frac = fracAtX(x);
    const p = tAtX(x);
    const w = goalWindow();
    const span = Math.min(lim.maxSpan, Math.max(lim.minSpan, w.span * factor));
    animateTo({ c: p - frac * span + span / 2, span }, { dur: 160 });
  }
  function setPreset(id) {
    const w = goalWindow();
    const span = presetSpan(id, lim);
    const t = cursorT();
    const cur = cursorOk();
    const t0 = w.c - w.span / 2;
    const visible = cur && t >= t0 && t <= t0 + w.span;
    let anchor = w.c;
    let frac = 0.5;
    if (follow && cur) anchor = t;
    else if (visible) {
      anchor = t;
      frac = (t - t0) / w.span;
    }
    animateTo({ c: anchor - frac * span + span / 2, span });
  }
  function fitSelected() {
    const t = cursorT();
    const L = selLevel();
    const cyc = data.cycleAt(L, t);
    if (!cyc) return ctx.toast('The cursor is outside the catalogue');
    setFollow(false);
    animateTo(fitWindow(cyc.start, cyc.end, lim, 0.06));
  }
  function fitCycle(level, t) {
    const cyc = data.cycleAt(level, t, false);
    if (!cyc) return;
    setFollow(false);
    animateTo(fitWindow(cyc.start, cyc.end, lim, 0.06));
  }
  /** Drag the cursor flag: the cursor follows the pointer; past the plot edge the view scrolls. */
  function scrubTo(x) {
    ctx.goto(model.clamp(tAtX(Math.min(layout.px1, Math.max(layout.px0, x))) + (drag?.grab ?? 0)), 'timeline');
  }
  function gotoTime(t) {
    if (!model.inRange(t)) return ctx.toast('Outside the Saros 141 catalogue');
    setFollow(false);
    ctx.goto(t, 'timeline');
  }

  // ---- toolbar ---------------------------------------------------------------------------------------------
  root.querySelector('.tl-toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    userChanged();
    if (b.dataset.preset) return setPreset(b.dataset.preset);
    switch (b.dataset.act) {
      case 'in':
        return zoomBy(0.5);
      case 'out':
        return zoomBy(2);
      case 'fit':
        return fitSelected();
      case 'centre':
        return centreCursor();
      case 'follow':
        followOptOut = follow; // switching it off by hand: do not switch it back on by itself later
        setFollow(!follow);
        if (follow) centreCursor();
        return;
    }
  });
  const setAttr = (node, name, v) => {
    if (node.getAttribute(name) !== v) node.setAttribute(name, v);
  };
  function syncToolbar() {
    const span = goalWindow().span;
    const ap = activePreset(span, lim);
    for (const b of presetBtns) setAttr(b, 'aria-pressed', String(b.dataset.preset === ap));
    setAttr(btnFollow, 'aria-pressed', String(follow));
    if (btnFollow.classList.contains('is-on') !== follow) btnFollow.classList.toggle('is-on', follow);
    // aria-disabled, not disabled: a button that is focused when it reaches the limit keeps the keyboard
    setAttr(btnIn, 'aria-disabled', String(span <= lim.minSpan * 1.001));
    setAttr(btnOut, 'aria-disabled', String(span >= lim.maxSpan * 0.999));
    const info = model.levelInfo(selLevel());
    const label = `Fit ${info.letter}`;
    if (fitLabel.textContent !== label) fitLabel.textContent = label;
    setAttr(btnFit, 'title', fitTitle(info));
    const hint = coarse.matches
      ? 'Drag to pan · pinch to zoom · tap to move the cursor · double-tap a cycle to fit it · press and hold for details'
      : 'Drag to pan · wheel to zoom · click to move the cursor · double-click a cycle to fit it · ← → + − Home';
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
  }

  // ---- hover / tooltip ----------------------------------------------------------------------------------------
  /** The instant under the pointer (and the eclipse marker next to it) for the window as it is now. */
  function deriveHover(h) {
    h.t = h.inPlot ? tAtX(h.x) : null;
    hoverEclipse = -1;
    // nearest eclipse marker within 9 px (eclipse lane only)
    if (h.kind === 'eclipse' && h.inPlot) hoverEclipse = nearestWithin(data.eclipses, h.t, 9 / (plotW() / win.span));
    hoverC = win.c;
    hoverSpan = win.span;
  }
  function setHover(x, y, clientX, clientY) {
    if (!layout) return;
    const r = regionAt(layout, x, y);
    const inPlot = x >= layout.px0 && x <= layout.px1;
    hover = { x, y, cx: clientX, cy: clientY, kind: r.kind, lane: r.kind === 'lane' ? r.lane : -1, gutter: r.gutter, t: null, inPlot };
    deriveHover(hover);
    const hit = chipAt(x, y);
    let cur = 'default';
    if (hit) cur = 'pointer';
    else if (scrubAt(x, y)) cur = 'ew-resize';
    else if (r.kind === 'overview' && !r.gutter) cur = 'grab';
    else if (r.gutter) cur = r.kind === 'lane' ? 'pointer' : 'default';
    else if (inPlot) cur = 'crosshair';
    if (drag?.moved) cur = 'grabbing';
    setCursor(cur);
    needsDraw = true;
    tipDirty = true;
  }
  function setCursor(cur) {
    if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
  }
  function cancelPress() {
    clearTimeout(pressTimer);
    clearTimeout(touchTipTimer);
    pressTimer = touchTipTimer = 0;
  }
  function clearHover() {
    if (!hover) return;
    hover = null;
    hoverEclipse = -1;
    tip.hidden = true;
    lastTipKey = '';
    setCursor('default');
    needsDraw = true;
  }
  /** Painted interactive rectangles under (x, y); fingers get `slop` extra pixels around each. */
  const hitRegion = (x, y, pred, slop = 0) => hitTest(S.regions, x, y, pred, slop);
  const chipAt = (x, y, slop = 0) => hitRegion(x, y, (r) => r.onClick, slop);
  const scrubAt = (x, y, slop = 0) => hitRegion(x, y, (r) => r.scrub, slop);

  const levelChip = (L, extra = '') => {
    const info = model.levelInfo(L);
    return `<span class="tl-tip-k" style="color:${theme.levelColor(L, 1, 72)}">${info.letter} ${info.depth}</span>${extra}`;
  };
  function tipHTML(h) {
    if (h.gutter) {
      if (h.kind === 'lane') {
        const L = levels[h.lane];
        if (L === undefined) return '';
        const info = model.levelInfo(L);
        const parent = L === 0 ? null : model.levelInfo(L - 1);
        const body =
          L === 0
            ? `One α cycle spans 4 Saros intervals ≈ ${formatCycleLength(info.meanSeconds)}; the catalogue holds ${data.alpha.length} (the last one is cut off).`
            : `${info.siblings} per ${parent.letter} cycle, each ≈ ${formatCycleLength(info.meanSeconds)}. Every ${parent.letter} cycle splits into ${parent.factor} of them.`;
        return `<div class="tl-tip-h"><span class="tl-tip-k" style="color:${theme.levelColor(L, 1, 72)}">${info.letter}</span> <span class="dim">· ${depthWords(info)}</span></div><div class="tl-tip-p">${esc(body)}</div><div class="tl-tip-p dim">${LANE_SELECT_HINT}</div>`;
      }
      if (h.kind === 'eclipse') return `<div class="tl-tip-h"><span class="tl-tip-k" style="color:${theme.TEAL}">Saros 141</span></div><div class="tl-tip-p">The ${model.catalogue.length} greatest-eclipse instants (${fmt.parts(model.tMin).year}–${fmt.parts(model.tMax).year}) are the time base of the clock. Every fourth one starts an α cycle.</div>`;
      if (h.kind === 'overview') return `<div class="tl-tip-h">Catalogue map</div><div class="tl-tip-p">The whole Saros 141 catalogue. The teal frame is what the timeline shows. Drag it, or click to jump there.</div>`;
      return '';
    }
    if (h.kind === 'overview') {
      const t = ovTime(h.x);
      return `<div class="tl-tip-h mono">${esc(fmt.date(t))}</div><div class="tl-tip-p dim">Click to centre the timeline here · drag the frame to scroll</div>`;
    }
    if (!h.inPlot || h.t === null) return '';
    const t = h.t;
    if (h.kind === 'eclipse' && hoverEclipse >= 0) {
      const i = hoverEclipse;
      const e = data.eclipses[i];
      return `<div class="tl-tip-h"><span class="tl-tip-k" style="color:${theme.TEAL}">Eclipse ${i + 1} of ${data.eclipses.length}</span></div>
        <div class="tl-tip-p mono">${esc(fmt.long(e))} <span class="dim">${esc(fmt.tag(e))}</span></div>
        <div class="tl-tip-p dim">Greatest eclipse of Saros 141 · position ${i}${i % 4 === 0 ? ' · starts α cycle ' + (i / 4 + 1) : ''}<br><span class="dim">vs now</span> ${esc(fmt.countdown(e - store.realNow()))} · click to move the cursor here</div>`;
    }
    const precise = win.span < 60;
    const tr = roundMs(t); // round once, so the seconds and the milliseconds can never disagree (…:00.1000)
    const head = `${fmt.long(tr, { seconds: true })}${precise ? '.' + String(fmt.parts(tr).ms).padStart(3, '0') : ''}`;
    if (!model.inRange(t)) {
      return `<div class="tl-tip-h mono">${esc(head)} <span class="dim">${esc(fmt.tag(t))}</span></div><div class="tl-tip-p">Outside the Saros 141 catalogue (${esc(fmt.date(model.tMin))} – ${esc(fmt.date(model.tMax))}). The clock is not extrapolated.</div>`;
    }
    const pos = model.positionOf(t);
    const real = store.realNow();
    let rel = `<span class="dim">vs now</span> ${fmt.countdown(t - real)}`;
    if (!store.live) rel += `<br><span class="dim">vs cursor</span> ${fmt.countdown(t - store.t())}`;
    let rows = '';
    let focus = '';
    levels.forEach((L, i) => {
      const r = model.levelAt(t, L);
      if (!r) return;
      const on = i === h.lane;
      const read = rowReadout(r); // the percentage is floored: a running cycle never reads 100 %
      rows += `<div class="tl-tip-row${on ? ' is-on' : ''}">${levelChip(L)}<span class="mono">${read.count}</span><span class="mono dim">${read.percent}</span></div>`;
      if (on) focus = { L, r };
    });
    let detail = '';
    if (focus) {
      const info = model.levelInfo(focus.L);
      const refY = fmt.parts(t).year;
      const f = focus.r;
      detail = `<div class="tl-tip-p tl-tip-detail">${levelChip(focus.L, ` <span class="mono">${esc(cycleName(info, f.local, f.siblings).split(' · ')[1])}</span>`)} <span class="dim">${esc(fmt.short(f.start, refY))} → ${esc(fmt.short(f.end, refY))} · ${esc(formatCycleLength(f.duration))}</span></div>`;
    }
    return `<div class="tl-tip-h mono">${esc(head)} <span class="dim">${esc(fmt.tag(t))}</span></div>
      <div class="tl-tip-p mono dim">pos ${pos.toFixed(6)} · Saros interval ${Math.floor(pos) + 1} of ${model.extent}</div>
      <div class="tl-tip-p">${rel}</div>${detail}<div class="tl-tip-grid">${rows}</div>`;
  }
  function updateTip() {
    if (!hover || drag?.moved || pointers.size > 1) {
      if (!tip.hidden) tip.hidden = true;
      lastTipKey = '';
      return;
    }
    const chip = chipAt(hover.x, hover.y) ?? scrubAt(hover.x, hover.y);
    const html = chip ? (chip.tip ? `<div class="tl-tip-p">${esc(chip.tip)}</div>` : '') : tipHTML(hover);
    if (!html) {
      if (!tip.hidden) tip.hidden = true;
      lastTipKey = '';
      return;
    }
    if (html !== lastTipKey) {
      tip.innerHTML = html;
      lastTipKey = html;
    }
    if (tip.hidden) tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = hover.cx + 16;
    let y = hover.cy + 18;
    if (x + w > innerWidth - 8) x = hover.cx - w - 16;
    if (y + h > innerHeight - 8) y = hover.cy - h - 14;
    if (hover.touch) {
      // above the finger, which would otherwise cover it
      x = Math.min(innerWidth - w - 8, hover.cx - w / 2);
      y = hover.cy - h - 34;
      if (y < 8) y = hover.cy + 40;
    }
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  // ---- pointer input ---------------------------------------------------------------------------------------------
  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!layout || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const { x, y } = localPos(e);
    pointers.set(e.pointerId, { x, y });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may not be capturable */
    }
    inertia = null; // a touch stops a coasting pan
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      cancelPress();
      if (drag?.long) clearHover();
      pinch = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2 };
      if (drag) drag.moved = true; // a pinch is never a click
      anim = null;
      setFollow(false);
      return;
    }
    if (pointers.size > 2) return;
    const r = regionAt(layout, x, y);
    const slop = e.pointerType === 'mouse' ? 0 : 10; // fingers are fatter than the 14 px flag and the 18 px chips
    const chip = chipAt(x, y, slop);
    drag = { id: e.pointerId, type: e.pointerType, sx: x, sy: y, startC: win.c, moved: false, chip, region: r, mode: 'plot', lastX: x, samples: [{ t: performance.now(), c: win.c }] };
    if (!chip && scrubAt(x, y, slop)) {
      drag.mode = 'scrub';
      drag.grab = cursorT() - tAtX(x); // keep the pointer where it grabbed the flag
    }
    if (!chip && drag.mode !== 'scrub' && r.kind === 'overview' && !r.gutter) {
      drag.mode = 'overview';
      const tt = ovTime(x);
      const rect = S.ovRect;
      const inside = rect && x >= rect.x && x <= rect.x + rect.w;
      drag.grab = inside ? tt - win.c : 0;
      anim = null;
      if (!inside) setWindow({ c: tt, span: win.span });
      setFollow(false);
      drag.moved = true;
      setCursor('grabbing');
    }
    hover = null;
    tip.hidden = true;
    needsDraw = true;
    cancelPress();
    if (e.pointerType !== 'mouse' && !chip && drag.mode === 'plot' && !(r.kind === 'overview' && !r.gutter)) {
      const id = e.pointerId;
      pressTimer = setTimeout(() => {
        pressTimer = 0;
        if (!drag || drag.id !== id || drag.moved || pinch) return;
        drag.long = true;
        setHover(x, y, e.clientX, e.clientY);
        hover.touch = true;
        setCursor('default');
      }, LONG_PRESS_MS);
    }
  });

  // a long press must not open the browser's context menu / callout
  canvas.addEventListener('contextmenu', (e) => {
    if (drag && drag.type !== 'mouse') e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = localPos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2;
      const span = Math.min(lim.maxSpan, Math.max(lim.minSpan, (win.span * pinch.dist) / dist));
      const p = tAtX(pinch.mx);
      const frac = fracAtX(mx);
      setWindow({ c: p - frac * span + span / 2, span });
      pinch.dist = dist;
      pinch.mx = mx;
      return;
    }
    if (drag && drag.id === e.pointerId) {
      const dx = x - drag.sx;
      const dy = y - drag.sy;
      const thresh = drag.type === 'mouse' ? 4 : 9;
      drag.lastX = x;
      if (!drag.moved && Math.hypot(dx, dy) > thresh) {
        // a mostly vertical touch gesture belongs to page scrolling, not to us
        drag.moved = true;
        cancelPress();
        if (drag.long) clearHover();
        if (drag.mode === 'scrub') {
          anim = null;
          setFollow(false);
          setCursor('ew-resize');
        } else if (drag.mode === 'plot') {
          // from here on the pointer owns the window. If it was still moving on its own (a transition,
          // or Follow tracking the clock) continue from where it is instead of jumping back.
          const kk = plotW() / win.span;
          if (anim || Math.abs(win.c - drag.startC) * kk > 1) drag.startC = win.c + dx / kk;
          anim = null;
          setFollow(false);
          setCursor('grabbing');
        }
      }
      if (drag.moved && drag.mode === 'plot') {
        const k = plotW() / win.span;
        win = clampWindow({ c: drag.startC - dx / k, span: win.span }, lim);
        const now = performance.now();
        drag.samples.push({ t: now, c: win.c });
        if (drag.samples.length > 8) drag.samples.shift();
        needsDraw = true;
      } else if (drag.moved && drag.mode === 'scrub') {
        scrubTo(x);
      } else if (drag.moved && drag.mode === 'overview') {
        win = clampWindow({ c: ovTime(x) - drag.grab, span: win.span }, lim);
        needsDraw = true;
      }
      return;
    }
    if (e.pointerType !== 'touch') setHover(x, y, e.clientX, e.clientY);
  });

  function endPointer(e, cancelled) {
    const had = pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (!had) return;
    if (pinch) {
      userChanged();
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        // carry on as a pan with the remaining finger
        const [id, p] = [...pointers.entries()][0];
        drag = { id, type: 'touch', sx: p.x, sy: p.y, startC: win.c, moved: true, mode: 'plot', region: null, chip: null, samples: [{ t: performance.now(), c: win.c }] };
      } else if (pointers.size === 0) drag = null;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    clearTimeout(pressTimer);
    pressTimer = 0;
    if (cancelled) {
      if (d.long) clearHover();
      return;
    }
    if (d.long) {
      // press and hold only shows the details: no click. They fade after a few seconds.
      touchTipTimer = setTimeout(clearHover, TOUCH_TIP_MS);
      return;
    }
    if (d.moved) {
      userChanged();
      if (d.mode === 'plot' && !reduce.matches) {
        const s = d.samples;
        const a = s[0];
        const b = s[s.length - 1];
        const dt = (b.t - a.t) / 1000;
        if (s.length > 2 && dt > 0.02 && performance.now() - b.t < 90) {
          const v = (b.c - a.c) / dt;
          if (Math.abs(v) * (plotW() / win.span) > 220) inertia = { v: Math.max(-win.span * 6, Math.min(win.span * 6, v)) };
        }
      }
      if (e.pointerType === 'mouse') {
        const { x, y } = localPos(e);
        setHover(x, y, e.clientX, e.clientY);
      }
      return;
    }
    onClick(d, e);
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e, false));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && !drag) clearHover();
  });

  function snapped(d, x, t) {
    const k = plotW() / win.span;
    const tol = 5 / k;
    const r = d.region;
    if (r.kind === 'lane') {
      const level = levels[r.lane];
      if (model.levelInfo(level).meanSeconds * k < 8) return t;
      const blocks = data.blocksFor(level, win.c - win.span / 2, win.c + win.span / 2);
      const i = lastStartAtOrBefore(blocks, t);
      let best = null;
      let bd = tol;
      for (const j of [i, i + 1]) {
        const b = blocks[j];
        if (b && Math.abs(b.start - t) <= bd) {
          bd = Math.abs(b.start - t);
          best = b.start;
        }
      }
      return best === null ? t : Math.min(model.tMax, best + 0.001); // +1 ms: the model rounds to ms and we want to land *in* the cycle
    }
    if (r.kind === 'axis') {
      const step = S.step ?? pickStep(k);
      const ticks = data.ticksFor(step, win.c - win.span / 2, win.c + win.span / 2);
      const i = nearestWithin(
        ticks.map((tk) => tk.t),
        t,
        tol,
      );
      return i >= 0 ? ticks[i].t : t;
    }
    if (r.kind === 'eclipse') {
      const i = nearestWithin(data.eclipses, t, 9 / k);
      return i >= 0 ? Math.min(model.tMax, data.eclipses[i] + 0.001) : t;
    }
    return t;
  }

  /** A single click on the plot moves the cursor, but only once it can no longer become a double-click. */
  function flushPendingClick(run) {
    if (!pendingClick) return;
    clearTimeout(pendingClick.timer);
    const { t } = pendingClick;
    pendingClick = null;
    if (run) gotoTime(t);
  }
  function onClick(d, e) {
    const { x, y } = localPos(e);
    const now = performance.now();
    const dbl = lastClick && now - lastClick.time < DBL_MS && Math.hypot(x - lastClick.x, y - lastClick.y) < (d.type === 'mouse' ? 8 : 26);
    lastClick = dbl ? null : { time: now, x, y };
    userChanged();
    // a double-click zooms: the cursor (and Live mode) must stay where they were. Anything else supersedes the waiting click.
    flushPendingClick(!dbl);
    if (d.chip) return d.chip.onClick();
    if (d.mode === 'scrub') return;
    const r = d.region;
    if (r.gutter) {
      if (r.kind === 'lane' && levels[r.lane] !== undefined) ctx.select(levels[r.lane]);
      return;
    }
    if (r.kind === 'overview' || r.kind === 'none') return;
    const t = tAtX(x);
    if (dbl) {
      if (r.kind === 'lane') return fitCycle(levels[r.lane], t);
      if (r.kind === 'eclipse') {
        const i = nearestWithin(data.eclipses, t, 9 / (plotW() / win.span));
        if (i >= 0) {
          setFollow(false);
          return animateTo({ c: data.eclipses[i], span: Math.min(goalWindow().span, 40 * 365.25 * DAY) });
        }
      }
      return zoomAnchored(0.35, x);
    }
    const target = snapped(d, x, t);
    pendingClick = { t: target, timer: setTimeout(() => flushPendingClick(true), DBL_MS) };
  }

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!layout) return;
      e.preventDefault();
      userChanged();
      const { x } = localPos(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      if (Math.abs(dx) > Math.abs(dy)) {
        const k = plotW() / win.span;
        setFollow(false);
        setWindow({ c: win.c + dx / k, span: win.span });
        return;
      }
      if (dy === 0) return;
      zoomAnchored(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0022)), x);
      if (hover) setHover(hover.x, hover.y, hover.cx, hover.cy);
    },
    { passive: false },
  );

  // ---- keyboard --------------------------------------------------------------------------------------------------
  // on the whole card, not just the canvas: the shortcuts keep working after a toolbar button was used
  root.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button')) return; // the button's own action
    const w = goalWindow();
    const pan = (frac) => {
      setFollow(false);
      animateTo({ c: w.c + frac * w.span, span: w.span }, { dur: 140 });
    };
    switch (e.key) {
      case '+':
      case '=':
        zoomBy(0.5);
        break;
      case '-':
      case '_':
        zoomBy(2);
        break;
      case 'ArrowLeft':
        pan(e.shiftKey ? -0.5 : -0.15);
        break;
      case 'ArrowRight':
        pan(e.shiftKey ? 0.5 : 0.15);
        break;
      case 'PageUp':
        pan(-0.9);
        break;
      case 'PageDown':
        pan(0.9);
        break;
      case 'Home':
        centreCursor();
        break;
      case 'f':
      case 'F':
        fitSelected();
        break;
      case 'Enter':
        gotoTime(w.c);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        // only the levels that have a lane: a selection nobody can see would just make the highlight vanish
        ctx.select(stepLevel(selLevel(), e.key === 'ArrowUp' ? -1 : 1, levels));
        break;
      default:
        return;
    }
    userChanged();
    e.preventDefault();
  });

  // ---- store events --------------------------------------------------------------------------------------------------
  const offStore = store.subscribe((kind, patch) => {
    if (kind !== 'settings') return;
    if (patch && 'zone' in patch) {
      data.invalidate();
      catLabel();
    }
    if (patch && ('minDepth' in patch || 'maxDepth' in patch)) relayout();
    if (patch && 'selectedLevel' in patch) userChanged();
    syncToolbar();
    needsDraw = true;
  });
  const offTime = store.onTime((reason) => {
    if (reason === 'timeline' || reason === 'pause' || reason === 'edge') return;
    needsDraw = true;
    userChanged();
    if (reason === 'rate') {
      // starting a time-lapse while the cursor is on screen: keep it in the middle of the view
      if (store.playing && !followOptOut && cursorOk() && !follow) {
        const t0 = win.c - win.span / 2;
        if (cursorT() >= t0 && cursorT() <= t0 + win.span) setFollow(true);
      }
      return;
    }
    if (reason === 'live') {
      followOptOut = false;
      setFollow(true);
    }
    pendingReveal = true;
  });

  // ---- per-frame work ------------------------------------------------------------------------------------------------------
  function flagLabel(t) {
    const span = win.span;
    t = roundMs(t);
    if (span <= 3 * DAY) return fmt.time(t, { seconds: true, ms: span < 40 });
    if (span <= 400 * DAY) return fmt.short(t, S.refYear);
    return fmt.date(t);
  }

  function stepAnimation(now, dt, t) {
    if (anim) {
      if (follow && model.inRange(t)) anim.to = clampWindow({ c: t, span: anim.to.span }, lim);
      const u = (now - anim.start) / anim.dur;
      if (u >= 1) {
        win = anim.to;
        anim = null;
      } else win = interpolateWindow(anim.from, anim.to, easeOutCubic(u));
      needsDraw = true;
      return;
    }
    if (drag?.mode === 'scrub' && drag.moved) {
      const over = drag.lastX > layout.px1 ? drag.lastX - layout.px1 : drag.lastX < layout.px0 ? drag.lastX - layout.px0 : 0;
      if (over) {
        const k = plotW() / win.span;
        win = clampWindow({ c: win.c + (Math.sign(over) * Math.min(Math.abs(over) * 10, 1600) * dt) / k, span: win.span }, lim);
        scrubTo(drag.lastX);
        needsDraw = true;
      }
    }
    if (inertia) {
      const before = win.c;
      win = clampWindow({ c: win.c + inertia.v * dt, span: win.span }, lim);
      inertia.v *= Math.exp(-dt * 4.5);
      const k = plotW() / win.span;
      if (win.c === before || Math.abs(inertia.v) * k < 6) inertia = null;
      needsDraw = true;
    }
  }

  function render(frame) {
    if (!layout || !initialised) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    if (Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1)) !== size.dpr && size.w) relayout();
    const t = frame.t;
    const inRange = frame.inRange;

    if (pendingReveal) {
      pendingReveal = false;
      if (inRange && !drag) {
        const w = goalWindow();
        const t0 = w.c - w.span / 2;
        const margin = w.span * 0.04;
        if (follow || t < t0 + margin || t > t0 + w.span - margin) animateTo(centreOn(w, t, lim));
      }
    }
    stepAnimation(now, dt, t);
    if (follow && inRange && !anim && !drag && !pinch) {
      const c = clampWindow({ c: t, span: win.span }, lim);
      if (c.c !== win.c) win = c; // the "moved" test below repaints once the glide amounts to a pixel
    }

    // the pointer rests while the window moves under it (Follow, a transition, inertia, the keys):
    // the instant under the crosshair changes with it, so the label and the tooltip must too
    if (hover && !drag && pointers.size < 2 && (win.c !== hoverC || win.span !== hoverSpan)) {
      const before = hoverEclipse;
      deriveHover(hover);
      if (hoverEclipse !== before) needsDraw = true;
      tipMoved = true;
    }

    // ---- scene -----------------------------------------------------------------------------------
    const k = plotW() / win.span;
    const t0 = win.c - win.span / 2;
    const t1 = t0 + win.span;
    const nowT = store.realNow();
    const nowShow = model.inRange(nowT);
    const refYear = fmt.parts(t).year;
    S.refYear = refYear;
    S.cursorLabel = inRange ? flagLabel(t) : '';
    S.nowLabel = nowShow ? flagLabel(nowT) : '';
    S.hoverLabel = hover && hover.inPlot ? flagLabel(hover.t) : '';
    const sel = selLevel();
    const selCycle = inRange ? data.cycleAt(sel, t) : null;
    let chipSig = '';
    if (selCycle) {
      const ex = layout.px0 + (selCycle.end - t0) * k;
      chipSig = ex > layout.px1 || ex < layout.px0 ? fmt.countdown(selCycle.end - t) : '';
    }
    const dyn = `${S.cursorLabel}|${S.nowLabel}|${S.hoverLabel}|${chipSig}`;
    const moved =
      Math.abs(win.c - lastDraw.c) * k > 0.2 ||
      win.span !== lastDraw.span ||
      Math.abs(t - lastDraw.t) * k > 0.2 ||
      Math.abs(nowT - lastDraw.now) * k > 0.2 ||
      dyn !== lastDraw.dyn;

    if (tipDirty || (hover && !drag)) {
      // the tooltip shows live countdowns: refresh it when the pointer moved or the second changes;
      // while the window slides under a resting pointer, at most ten times a second
      const sec = Math.floor(nowT);
      if (tipDirty || sec !== lastTipSec || (tipMoved && now - lastTipAt >= 100)) {
        updateTip();
        lastTipSec = sec;
        lastTipAt = now;
        tipDirty = false;
        tipMoved = false;
      }
    }

    // toolbar / readouts (text only when changed)
    if (moved || needsDraw) {
      const spanTxt = fmt.duration(win.span, { parts: 2 });
      const range = `${fmt.short(t0, refYear)} → ${fmt.short(t1, refYear)} · ${spanTxt} across · ${fmt.tag(win.c)}`;
      if (winEl.textContent !== range) winEl.textContent = range;
      syncToolbar();
    }
    // Text alternative of the canvas (aria-describedby; twice a second at most, only when it changed) ...
    if (now - lastSumAt >= 500) {
      lastSumAt = now;
      const sum = describeView(t, inRange);
      if (sum !== lastSum) {
        lastSum = sum;
        sumEl.textContent = sum;
      }
    }
    // ... and the polite announcement, only after the user changed something and the view has settled.
    // A running clock is never announced.
    if (announceAt && now >= announceAt && !drag && !pinch) {
      announceAt = 0;
      const live = describeView(t, inRange);
      if (live !== lastLive) {
        lastLive = live;
        liveEl.textContent = live;
      }
    }

    if (!needsDraw && !moved) return;
    needsDraw = false;
    lastDraw = { c: win.c, span: win.span, t, now: nowT, dyn };

    S.dpr = size.dpr;
    S.W = size.w;
    S.H = size.h;
    S.L = layout;
    S.levels = levels;
    S.selected = sel;
    S.t0 = t0;
    S.t1 = t1;
    S.span = win.span;
    S.k = k;
    S.X = makeScale(win, layout.px0, plotW()).toX;
    S.step = pickStep(k);
    S.hover = hover;
    S.hoverEclipse = hoverEclipse;
    S.cursorT = t;
    S.cursorIn = inRange;
    S.nowT = nowT;
    S.realT = nowT;
    S.nowShow = nowShow;
    S.live = store.live;
    S.selCycle = selCycle;
    S.chipYear = fmt.parts(win.c).year; // off-screen chips name their year relative to the view, not to the cursor
    paint(S);
  }

  /** One-sentence-per-fact description of the view, for screen readers (no seconds: it must not tick). */
  function describeView(t, inRange) {
    const t0 = win.c - win.span / 2;
    const out = [`Timeline shows ${fmt.date(t0)} to ${fmt.date(t0 + win.span)}, ${fmt.duration(win.span)} across.`];
    if (!inRange) {
      out.push('The cursor is outside the Saros 141 catalogue.');
      return out.join(' ');
    }
    out.push(`Cursor at ${fmt.long(t, { seconds: false })} ${fmt.tag(t)}${store.live ? ', live' : store.playing ? ', in time-lapse' : ''}.`);
    const L = selLevel();
    const info = model.levelInfo(L);
    const cyc = data.cycleAt(L, t);
    if (cyc) out.push(selectedDepthSentence(info, cyc.local, info.siblings ?? data.alpha.length, fmt.long(cyc.end, { seconds: false })));
    return out.join(' ');
  }

  function setActive(on) {
    if (on) {
      needsDraw = true;
      lastDraw = { c: NaN, span: NaN, t: NaN, now: NaN, dyn: '' };
      lastNow = performance.now();
    } else {
      clearHover();
      cancelPress();
      flushPendingClick(false);
      drag = null;
      pinch = null;
      pointers.clear();
    }
  }

  // ---- boot ----------------------------------------------------------------------------------------------------------------------
  computeLevels();
  catLabel();
  stage.style.height = `${stageHeight({ lanes: levels.length, width: 800, viewportH: globalThis.innerHeight || 900 })}px`;
  syncToolbar();

  return {
    render,
    setActive,
    /** Debug / test hooks: current window, animation target and a few commands. */
    api: {
      get window() {
        return { ...win };
      },
      get goal() {
        return { ...goalWindow() };
      },
      get follow() {
        return follow;
      },
      get layout() {
        return layout;
      },
      get levels() {
        return [...levels];
      },
      setWindow: (w) => setWindow(w),
      animateTo,
      /** Animate the view to show [start, end] (Unix seconds) with a little margin; turns Follow off. */
      showRange(start, end, margin = 0.08) {
        setFollow(false);
        animateTo(fitWindow(start, end, lim, margin));
      },
      setPreset,
      setFollow,
      fitSelected,
      centreCursor,
      zoomBy,
      reveal,
    },
    destroy() {
      flushPendingClick(false);
      cancelPress();
      offStore();
      offTime();
      ro.disconnect();
      globalThis.removeEventListener('resize', onWindowResize);
    },
  };
}
