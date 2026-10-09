/**
 * Wave view: the library's circular harmonic geometry as a "you are here" map.
 *
 * Every half-cycle of a level is an arc (crest = +, trough = −); its next-level half-cycles are
 * the loops that hug it, exactly like epicycles. The view focuses on the half-arc of the chosen
 * level that contains the displayed time, shows its children and grandchildren, and puts one
 * marker per level on its own arc (the point at its progress), joined by thin tethers. The
 * "Catalogue" stop shows the whole Saros 141 wave. Geometry comes from `clock.arc`, clock
 * readings from `ctx.model`; src/ui/wave/* holds the pure geometry, scene building, drawing and
 * tooltip text.
 */
import { createEngine } from './wave/scene.js';
import * as G from './wave/geometry.js';
import { createPainter, drawFocus, drawOverview } from './wave/draw.js';
import { followableLevel, MAX_LEVEL, OUT_OF_RANGE_HINT, sanitizeLevel, throughOf, zoomEnabled, zoomPlan } from './wave/nav.js';
import { cycleText, floorPercent, loopHint, loopText, nextLines, roundMs, spanText, tipHTML, whenText } from './wave/tooltip.js';

const STORE_KEY = 'fractonica-clock/wave';
const MIN_FADE_GAP = 500; // ms: neighbour half-arcs that change faster than this swap instantly

export function mount(el, ctx) {
  const { model, store, fmt, theme } = ctx;
  const eng = createEngine(model);
  const reducedQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = !!reducedQuery?.matches;
  const onReduced = (e) => (reduced = e.matches);
  reducedQuery?.addEventListener?.('change', onReduced);

  const levelOf = (n) => sanitizeLevel(n);
  const infos = Array.from({ length: MAX_LEVEL + 1 }, (_, l) => model.levelInfo(l));

  // ------------------------------------------------------------------ DOM
  const chipHTML = infos
    .map(
      (i) =>
        `<button class="wave-lv" type="button" role="radio" aria-checked="false" tabindex="-1" data-level="${i.level}" style="--c:var(--lv-${i.level})" ` +
        `aria-label="Depth ${i.depth}, ${i.text}, cycle about ${fmt.duration(i.meanSeconds)}" title="${i.text} · depth ${i.depth} · cycle ≈ ${fmt.duration(i.meanSeconds)} · ${i.factor} child half-arcs per half-arc">` +
        `<span class="wave-lv-g">${i.text}</span><span class="wave-lv-n">${i.depth}</span><i class="wave-lv-bar"><b></b></i></button>`,
    )
    .join('');
  el.innerHTML = `
<section class="card wave-card" aria-label="Wave view">
  <div class="card-h wave-head">
    <h2>Wave</h2>
    <span class="wave-sub dim">circular harmonic geometry</span>
    <span class="spacer"></span>
    <div class="wave-steps" role="group" aria-label="Step by half-arc">
      <button class="btn btn-sm" type="button" data-step="-1" aria-label="Previous half-arc" title="Previous half-arc (← key on the wave)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg><span>Prev</span></button>
      <button class="btn btn-sm" type="button" data-step="1" aria-label="Next half-arc" title="Next half-arc (→ key on the wave)"><span>Next</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></button>
    </div>
  </div>
  <div class="wave-ctl">
    <span class="wave-lbl" aria-hidden="true">Focus depth</span>
    <span class="wave-hint dim"><span class="wave-hint-fine">Drag along the bright arc to travel in time · click a loop to jump to it · Ctrl + scroll or +/− change the depth</span><span class="wave-hint-touch">Drag the arc to travel in time · tap a loop to jump · pinch to change depth</span></span>
  </div>
  <div class="wave-levels" role="radiogroup" aria-label="Focus depth">
    <button class="wave-lv wave-lv-all" type="button" role="radio" aria-checked="false" tabindex="-1" data-level="all" aria-label="Whole catalogue" title="Catalogue: the whole Saros 141 wave, 35 α half-arcs from 1613 to 2857">
      <span class="wave-lv-g">∿</span><span class="wave-lv-n">all</span></button>
    <span class="wave-lv-sep" aria-hidden="true"></span>
    ${chipHTML}
  </div>
  <div class="wave-read">
    <div class="wave-read-grid">
      <div class="wave-r-main">
        <span class="wave-r-badge" aria-hidden="true">α</span>
        <div class="wave-r-txt">
          <div class="wave-r-title"></div>
          <div class="wave-r-span mono"></div>
          <div class="wave-r-loop"></div>
          <div class="wave-r-cyc"></div>
        </div>
      </div>
      <div class="wave-r-side">
        <div class="wave-r-pct"><b class="mono"></b><span class="wave-r-what dim"></span><span class="wave-r-bar" aria-hidden="true"><i></i></span></div>
        <div class="wave-r-pct2 mono"></div>
        <div class="wave-r-next mono"><div class="wave-r-n1"></div><div class="wave-r-n2"></div></div>
      </div>
      <div class="wave-r-glyph" aria-hidden="true"></div>
      <div class="wave-r-oor" hidden>
        <p></p>
        <div class="wave-r-acts">
          <button class="btn btn-sm" type="button" data-edge="first">Go to the first eclipse</button>
          <button class="btn btn-sm" type="button" data-edge="last">Go to the last eclipse</button>
        </div>
      </div>
    </div>
  </div>
  <div class="wave-stage">
    <canvas class="wave-canvas" tabindex="0" role="application" aria-roledescription="wave map"></canvas>
    <div class="wave-zoom" role="group" aria-label="Zoom">
      <button class="btn btn-icon btn-sm" type="button" data-zoom="1" aria-label="Zoom in to the next depth" title="Zoom in: next depth (↑ or + on the wave, Ctrl + scroll)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></button>
      <button class="btn btn-icon btn-sm" type="button" data-zoom="-1" aria-label="Zoom out to the previous depth" title="Zoom out: previous depth (↓ or − on the wave, Ctrl + scroll)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 8h10"/></svg></button>
    </div>
    <div class="tip wave-tip" role="tooltip" hidden></div>
    <div class="sr-only wave-live" aria-live="polite" aria-atomic="true"></div>
  </div>
  <div class="wave-foot">
    <p class="wave-caption">Every half-cycle is an arc, a crest (+) or a trough (−); the numbered loops along it are its next-depth half-cycles, and the dot on each depth shows how far the displayed time has travelled through its arc.</p>
    <ul class="wave-legend" aria-label="Legend">
      <li><i class="wave-key wave-key-dot"></i>displayed time, one dot per depth</li>
      <li><i class="wave-key wave-key-on"></i>travelled</li>
      <li><i class="wave-key wave-key-off"></i>remaining</li>
      <li data-for="focus"><span class="wave-key-n mono">+3</span> crest · <span class="wave-key-n mono">−2</span> trough: the n-th loop in the parent half-arc</li>
      <li data-for="focus"><i class="wave-key wave-key-tick"></i>begin · peak or valley · node or end</li>
      <li data-for="focus"><i class="wave-key wave-key-tether"></i>tether to the next depth's dot; a lettered circle on the edge is a dot that is off-screen</li>
      <li data-for="all"><i class="wave-key wave-key-eclipse"></i>an eclipse of the series, with its year; the thin loops are β and γ</li>
      <li><span class="wave-key-n mono">+ −</span> and the bar on each depth button: crest or trough, and progress through its current half-arc</li>
    </ul>
  </div>
</section>`;

  const $ = (sel) => el.querySelector(sel);
  const card = $('.wave-card');
  const canvas = $('.wave-canvas');
  const stage = $('.wave-stage');
  const zoomEl = $('.wave-zoom');
  const stepBtns = [...el.querySelectorAll('[data-step]')];
  const zoomBtns = [...el.querySelectorAll('[data-zoom]')];
  const tip = $('.wave-tip');
  const liveRegion = $('.wave-live');
  const chipsEl = $('.wave-levels');
  const chips = [...chipsEl.querySelectorAll('.wave-lv')];
  const chipAll = chips[0];
  const chipByLevel = chips.slice(1);
  const R = {
    badge: $('.wave-r-badge'),
    title: $('.wave-r-title'),
    span: $('.wave-r-span'),
    pct: $('.wave-r-pct b'),
    what: $('.wave-r-what'),
    pct2: $('.wave-r-pct2'),
    loop: $('.wave-r-loop'),
    cyc: $('.wave-r-cyc'),
    bar: $('.wave-r-bar i'),
    n1: $('.wave-r-n1'),
    n2: $('.wave-r-n2'),
    glyph: $('.wave-r-glyph'),
    oor: $('.wave-r-oor'),
    oorText: $('.wave-r-oor p'),
    main: $('.wave-r-main'),
    side: $('.wave-r-side'),
  };

  R.cyc.title = 'A cycle is a crest followed by a trough. This is the cycle numbering of the ladder, rings, timeline and calendar.';
  const cs = getComputedStyle(el);
  const uiFont = cs.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif';
  const monoFont = cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
  const painter = createPainter(canvas, {
    theme,
    fonts: {
      label: `600 11px ${uiFont}`,
      labelBold: `700 12px ${uiFont}`,
      small: `500 10px ${monoFont}`,
    },
  });

  // ---------------------------------------------------------------- state
  const saved = (() => {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) ?? '{}') || {};
    } catch {
      return {};
    }
  })();
  const S = {
    w: 0,
    h: 0,
    dpr: 1,
    active: false,
    overview: !!saved.overview && !new URLSearchParams(globalThis.location?.search).has('sel'), // a deep link with ?sel= focuses that level
    lastSel: levelOf(store.state.selectedLevel),
    level: levelOf(store.state.selectedLevel), // the shared selection
    eff: levelOf(store.state.selectedLevel), // the level actually focused (slower when the selection is too fast to follow)
    scene: null, // scene on screen (or being zoomed to)
    cam: null, // its camera, in its own frame
    anim: null,
    ov: null,
    ovKey: '',
    cur: null,
    curT: NaN, // time S.cur was read at
    inRange: true,
    hits: { arcs: [], markers: [] },
    hover: null,
    pointer: { x: 0, y: 0, inside: false, type: 'mouse' },
    down: null,
    pending: null, // scrub target time, applied once per frame
    lastSwitch: 0,
    years: [],
    yearsZone: null,
    endYear: '',
    wheelAcc: 0,
    wheelLast: 0, // last wheel event (the accumulator forgets after a pause)
    wheelAt: 0, // last wheel zoom (a short lock-out keeps one flick from running through several levels)
    avoid: null, // rectangle of the zoom buttons, which edge badges keep clear of
    drawKey: '', // what the last frame drawn looked like (a live clock redraws only when this changes)
    mkFor: null, // scene / readings / camera the cached markers belong to
    mkCur: null,
    mkCam: null,
    mk: null,
    userAt: -Infinity, // last time the user acted on the view (decides whether a change is announced)
    snap: true,
    dirty: true,
    tipKey: '',
    tipAt: 0,
    readAt: 0,
    readNow: true,
    last: {},
    cursor: '',
    label: '',
    barP: [],
    labeled: -1, // the level button that carries the live "now in half-arc ..." label
  };

  /** Show the catalogue or the focus level; remembered between visits. */
  function setOv(on) {
    on = !!on;
    if (S.overview === on) return;
    S.overview = on;
    try {
      globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify({ overview: on }));
    } catch {
      /* private mode: the view works without it */
    }
  }

  const setText = (key, node, str) => {
    if (S.last[key] !== str) {
      node.textContent = str;
      S.last[key] = str;
    }
  };
  const setTitle = (key, node, str) => {
    if (S.last[key] !== str) {
      node.title = str;
      S.last[key] = str;
    }
  };
  const setHTML = (key, node, html) => {
    if (S.last[key] !== html) {
      node.innerHTML = html;
      S.last[key] = html;
    }
  };

  const touched = () => (S.userAt = performance.now());
  let announceTimer = 0;
  let announceText = '';
  /**
   * Tell screen readers where the view moved. The newest message wins and is spoken after a short
   * quiet period, so a run of quick keyboard steps ends in one message about where it stopped. A
   * running clock (live or time-lapse) announces only what the user just did, never its own progress.
   */
  function announce(text) {
    if ((store.live || store.playing) && performance.now() - S.userAt > 1500) return;
    announceText = text;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      announceTimer = 0;
      if (liveRegion.textContent !== announceText) liveRegion.textContent = announceText;
    }, 300);
  }

  // ------------------------------------------------------- level control
  function updateChips(sel, overview) {
    const key = overview ? 'all' : sel;
    if (S.last.chip !== key) {
      S.last.chip = key;
      card.style.setProperty('--wave-hue', `var(--lv-${overview ? 0 : sel})`); // legend swatches in the colour of the arcs

      chipAll.setAttribute('aria-checked', String(overview));
      chipAll.tabIndex = overview ? 0 : -1;
      chipByLevel.forEach((c, l) => {
        const on = !overview && l === sel;
        c.setAttribute('aria-checked', String(on));
        c.tabIndex = on ? 0 : -1;
      });
      if (!chips.some((c) => c.tabIndex === 0)) chipAll.tabIndex = 0;
      const act = overview ? chipAll : chipByLevel[sel];
      // keep the active chip in view when the row scrolls (narrow screens)
      const box = chipsEl.getBoundingClientRect();
      const r = act.getBoundingClientRect();
      if (box.width && (r.left < box.left || r.right > box.right)) {
        chipsEl.scrollTo({ left: chipsEl.scrollLeft + (r.left - box.left) - (box.width - r.width) / 2, behavior: reduced ? 'auto' : 'smooth' });
      }
    }
  }

  /** Fade the ends of the level row that still have chips scrolled out of sight (narrow screens). */
  function updateChipsFade() {
    const max = chipsEl.scrollWidth - chipsEl.clientWidth;
    const more = max <= 1 ? 'none' : chipsEl.scrollLeft <= 1 ? 'right' : chipsEl.scrollLeft >= max - 1 ? 'left' : 'both';
    if (chipsEl.dataset.more !== more) chipsEl.dataset.more = more;
  }
  chipsEl.addEventListener('scroll', updateChipsFade, { passive: true });

  function focusChip(node) {
    node.focus();
    node.click();
  }
  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.wave-lv');
    if (!b) return;
    touched();
    if (b.dataset.level === 'all') showOverview(true);
    else {
      setOv(false);
      ctx.select(Number(b.dataset.level));
      if (S.lastSel === Number(b.dataset.level)) ctx.requestRender();
    }
    ctx.requestRender();
  });
  // radio-group keys: right / down = next, left / up = previous (up and down would otherwise scroll the page)
  const CHIP_STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  chipsEl.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!(k in CHIP_STEP) && k !== 'Home' && k !== 'End') return;
    e.preventDefault();
    const i = chips.indexOf(document.activeElement);
    const next = k === 'Home' ? 0 : k === 'End' ? chips.length - 1 : Math.min(chips.length - 1, Math.max(0, i + CHIP_STEP[k]));
    focusChip(chips[next]);
  });

  function showOverview(on) {
    touched();
    setOv(on);
    ctx.requestRender();
  }
  /** Zoom one level in (dir > 0) or out; `quiet` = a wheel or pinch gesture, which never toasts a limit. */
  function zoom(dir, quiet = false) {
    touched();
    const plan = zoomPlan({ inRange: S.inRange, overview: S.overview, level: S.level, eff: S.eff }, dir);
    if (plan.kind === 'focus') {
      setOv(false);
      ctx.select(plan.level);
    } else if (plan.kind === 'select') ctx.select(plan.level);
    else if (plan.kind === 'overview') setOv(true);
    else if (!quiet) ctx.toast(plan.msg);
    ctx.requestRender();
  }
  function stepHalf(dir) {
    touched();
    if (!S.cur) return S.inRange ? undefined : ctx.toast(OUT_OF_RANGE_HINT);
    const L = S.overview ? 0 : S.eff;
    const step = eng.stepTarget(L, S.cur[L].idx, S.lastT, dir);
    if (step.edge) ctx.toast(step.edge === 'end' ? 'End of the catalogue' : 'Start of the catalogue');
    else ctx.goto(step.t, 'cycle');
  }
  /** Buttons that cannot act now say so (aria-disabled keeps them focusable; pressing one explains why). */
  function updateControls() {
    const z = zoomEnabled({ inRange: S.inRange, overview: S.overview, level: S.level });
    const mark = (btn, off) => {
      if (btn.hasAttribute('aria-disabled') !== off) off ? btn.setAttribute('aria-disabled', 'true') : btn.removeAttribute('aria-disabled');
    };
    for (const b of zoomBtns) mark(b, !(Number(b.dataset.zoom) > 0 ? z.in : z.out));
    for (const b of stepBtns) mark(b, !S.inRange);
  }
  $('.wave-steps').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) stepHalf(Number(b.dataset.step));
  });
  $('.wave-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (b) zoom(Number(b.dataset.zoom));
  });
  $('.wave-r-acts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-edge]');
    if (!b) return;
    ctx.goto(b.dataset.edge === 'first' ? model.tMin + 0.001 : model.tMax - 0.001, 'jump');
  });

  // --------------------------------------------------------------- layout
  const padFocus = () => ({ l: 46, r: 46, t: 44, b: 40 });
  // the right edge keeps clear of the zoom buttons (wider on a phone, where they are 40 px)
  const padOverview = () => ({ l: 24, r: Math.max(48, S.avoid ? S.w - S.avoid.x0 : 0), t: 30, b: 18 });
  /** The zoom buttons' rectangle in stage pixels: edge badges slide along the border to stay off it. */
  function measureAvoid() {
    const z = zoomEl.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    if (z.width && s.width) S.avoid = { x0: z.left - s.left - 6, y0: 0, x1: S.w, y1: z.bottom - s.top + 6 };
  }

  function camFor(scene) {
    if (scene.kind === 'overview') return G.overviewCamera(scene.layout, S.w, S.h, padOverview());
    return G.fitCamera(scene.samples, scene.rot, S.w, S.h, padFocus());
  }
  function overviewScene() {
    const key = `${S.w}x${S.h}`;
    if (!S.ov || S.ovKey !== key) {
      const layout = G.layoutRows(eng.halfCount(0), S.w, S.h, { pad: padOverview() });
      S.ov = eng.buildOverview(layout);
      S.ovKey = key;
    }
    return S.ov;
  }

  function onResize(w, h) {
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    if (w < 2 || h < 2) return;
    if (w === S.w && h === S.h && dpr === S.dpr) return;
    S.w = w;
    S.h = h;
    S.dpr = dpr;
    measureAvoid();
    painter.resize(w, h, dpr);
    S.anim = null;
    S.ov = null;
    if (S.scene) {
      if (S.scene.kind === 'overview') S.scene = overviewScene();
      S.cam = camFor(S.scene);
    }
    S.dirty = true;
    ctx.requestRender();
  }
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      if (e.target === stage) onResize(Math.round(e.contentRect.width), Math.round(e.contentRect.height));
    }
    updateChipsFade();
  });
  ro.observe(stage);
  ro.observe(chipsEl);

  // ------------------------------------------------------------ transitions
  /** p_to = m.x,m.y + m.k * p_from, or null when the two frames are not related. */
  function relate(from, to) {
    if (from.kind === 'overview' && to.kind === 'overview') return null;
    const r0 = from.kind === 'focus' ? from.r0 : to.r0;
    if (from.kind === 'focus' && to.kind === 'focus' && from.r0 !== to.r0) return null;
    const toAlpha = (sc) => {
      if (sc.kind === 'focus') return sc.toAlpha;
      const c = sc.levels[0][r0].arc.center;
      return { x: -c.x, y: -c.y, k: 1 };
    };
    const A = toAlpha(from);
    const B = toAlpha(to);
    return { x: (A.x - B.x) / B.k, y: (A.y - B.y) / B.k, k: A.k / B.k };
  }

  function setScene(next, { snap = false } = {}) {
    const prev = S.scene;
    const now = performance.now();
    const nextCam = camFor(next);
    const fromScene = S.anim ? S.anim.to : prev;
    const sameLevel = !!fromScene && fromScene.kind === 'focus' && next.kind === 'focus' && fromScene.level === next.level;
    // neighbouring half-arcs of one level that follow each other quickly swap without a fade
    const quick = sameLevel && now - S.lastSwitch < MIN_FADE_GAP;
    S.lastSwitch = now;
    if (!prev || snap || reduced || !S.active || quick) {
      S.scene = next;
      S.cam = nextCam;
      S.anim = null;
      return;
    }
    const fromCam = S.anim ? animCamera(S.anim, now).to : S.cam;
    const map = sameLevel ? null : relate(fromScene, next);
    if (map) {
      const gap = fromScene.kind === 'overview' || next.kind === 'overview' ? 3 : Math.abs(fromScene.level - next.level);
      S.anim = {
        mode: 'zoom',
        from: fromScene,
        to: next,
        map,
        camFrom: G.cameraToFrame(fromCam, map, map.k),
        camTo: nextCam,
        t0: now,
        dur: Math.min(950, 420 + 90 * Math.max(0, gap - 1)),
      };
    } else {
      S.anim = { mode: 'fade', from: fromScene, to: next, camFrom: fromCam, camTo: nextCam, t0: now, dur: 240 };
    }
    S.scene = next;
    S.cam = nextCam;
  }

  /** Camera(s) of an animation at `now`: {e, to, from} (to: in the target frame, from: in the old frame). */
  function animCamera(a, now) {
    const e = G.easeOutCubic((now - a.t0) / a.dur);
    if (a.mode === 'zoom') {
      const camTo = G.lerpCamera(a.camFrom, a.camTo, e);
      return { e, to: camTo, from: G.cameraFromFrame(camTo, a.map, a.map.k) };
    }
    return { e, to: a.camTo, from: a.camFrom };
  }

  /** The level to focus: the selected one, or a coarser one while its half-arcs are too fast to follow. */
  const followable = (level) => followableLevel(level, { rate: store.live ? 1 : store.playing ? Math.abs(store.rate) : 0, reduced }, (l) => infos[l].meanSeconds);

  // -------------------------------------------------------------- frames
  function ovMarkers(ov, cur, k) {
    const out = [];
    for (let l = 0; l <= 2; l++) {
      if (ov.levels[l][0].arc.radius * k < 2.6) break;
      const h = cur[l];
      const e = ov.levels[l][h.idx];
      if (!e) break;
      const a = e.arc.start + e.arc.sweep * h.local;
      out.push({ level: l, idx: h.idx, local: h.local, arc: e.arc, x: e.arc.center.x + e.arc.radius * Math.cos(a), y: e.arc.center.y + e.arc.radius * Math.sin(a) });
    }
    return out;
  }

  function refreshYears() {
    const zone = fmt.zone();
    if (S.yearsZone === zone && S.years.length) return;
    S.yearsZone = zone;
    S.years = [];
    for (let i = 0; i < eng.halfCount(0); i++) S.years.push(String(fmt.parts(model.catalogue[2 * i]).year));
    S.endYear = String(fmt.parts(model.tMax).year);
  }

  /** The markers of a scene seen through `view`; kept for the frame on screen (`steady`), which both the draw and the redraw test need. */
  function markersOf(scene, view, steady) {
    const make = () => (scene.kind === 'focus' ? eng.markersFor(scene, S.cur) : S.cur ? ovMarkers(scene, S.cur, view.k) : []);
    if (!steady) return make();
    if (S.mkFor !== scene || S.mkCur !== S.cur || S.mkCam !== S.cam) {
      S.mk = make();
      S.mkFor = scene;
      S.mkCur = S.cur;
      S.mkCam = S.cam;
    }
    return S.mk;
  }
  /** The displayed time written next to the focus marker (empty when the scene is not the one the time is in). */
  function nowLabelFor(scene) {
    if (!S.inRange) return '';
    if (scene.kind === 'overview') return fmt.date(S.lastT);
    return scene.idx === S.cur?.[scene.level]?.idx ? markLabel(scene.desc) : '';
  }

  function drawScene(scene, cam, alpha, interactive, quiet = false) {
    const view = G.makeView(cam, S.w, S.h);
    const grey = !S.inRange;
    if (scene.kind === 'focus') {
      drawFocus(painter, scene, view, {
        alpha,
        cur: S.cur,
        markers: markersOf(scene, view, interactive),
        hover: interactive ? S.hover : null,
        hits: interactive ? S.hits : null,
        grey,
        eventLabels: scene.desc.marks,
        letters,
        quiet,
        avoid: S.avoid ?? { x0: S.w - 56, y0: 0, x1: S.w, y1: 88 }, // the zoom buttons
        nowLabel: nowLabelFor(scene),
      });
    } else {
      drawOverview(painter, scene, view, {
        alpha,
        cur: S.cur,
        markers: markersOf(scene, view, interactive),
        hover: interactive ? S.hover : null,
        hits: interactive ? S.hits : null,
        grey,
        years: S.years,
        endYear: S.endYear,
        quiet,
        nowLabel: nowLabelFor(scene),
        edge: !S.inRange && interactive ? { before: S.lastT < model.tMin } : undefined, // where the displayed time lies beyond
      });
    }
    return view;
  }
  const letters = infos.map((i) => i.text);
  /** The displayed time as a short label next to the focus marker (time only for short arcs, date for long ones). */
  function markLabel(d) {
    const t = S.lastT;
    if (d.duration >= 2 * 365.25 * 86400) return fmt.date(t);
    if (d.duration >= 86400) return fmt.dateTime(t, { seconds: false });
    return fmt.time(d.duration < 10 ? roundMs(t) : t, { seconds: true, ms: d.duration < 10 });
  }
  /**
   * What the frame on screen looks like, boiled down: the scene, where each marker sits to half a
   * pixel, which child is current and the label. A running clock redraws only when this changes
   * (a catalogue dot moves a pixel per decade, so the live catalogue needs almost no frames).
   */
  function visualKey() {
    const sc = S.scene;
    if (!sc) return '';
    let k = `${sc.key}|${S.inRange}|${S.yearsZone}|${nowLabelFor(sc)}`;
    if (S.cur) {
      const view = G.makeView(S.cam, S.w, S.h);
      const near = sc.kind === 'focus' ? sc.level + 2 : 2; // deeper half-arcs change faster than they move
      if (sc.kind === 'overview') k += `|${S.cur[0].idx},${S.cur[1].idx},${S.cur[2].idx}`;
      for (const m of markersOf(sc, view, true)) {
        const p = view.point(m.x, m.y, tmpPt);
        k += `|${m.level}${m.level <= near ? ':' + m.idx : ''}@${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
      }
    }
    return k;
  }
  const tmpPt = {};
  const pt = (arc, t) => {
    const p = G.pointOnArc(arc, t);
    return [p.x, p.y];
  };

  // -------------------------------------------------------------- picking
  function pick(px, py, touch) {
    const tolM = touch ? 18 : 10;
    const tolA = touch ? 22 : 12;
    let best = null;
    for (const m of S.hits.markers) {
      const d = Math.hypot(px - m.x, py - m.y);
      if (d <= tolM && (!best || d < best.dist - 0.5 || (Math.abs(d - best.dist) <= 0.5 && m.level > best.level))) {
        best = { kind: 'marker', level: m.level, idx: m.idx, local: m.local, dist: d, x: m.x, y: m.y };
      }
    }
    if (best) return best;
    for (const a of S.hits.arcs) {
      const n = G.nearestOnArc(a.sa, px, py, a.fraction);
      const bias = a.kind === 'child' ? 0.75 : 0; // the focused arc wins ties: it is the one you drag along
      if (n.dist <= tolA && (!best || n.dist + bias < best.dist)) {
        best = { kind: a.kind, level: a.level, idx: a.idx, t: n.t, dist: n.dist + bias, j: a.j };
      }
    }
    return best;
  }

  /** Time under the pointer while dragging along the focused arc (or along the catalogue wave). */
  function scrubTime(px, py) {
    let best = null;
    for (const a of S.hits.arcs) {
      if (S.overview || !S.inRange ? a.kind !== 'alpha' : a.kind !== 'focus') continue;
      const n = G.nearestOnArc(a.sa, px, py, a.fraction);
      if (!best || n.dist < best.dist) best = { ...n, a };
    }
    if (!best) return null;
    const t = eng.timeAt(best.a.level, best.a.idx, best.t);
    const span = eng.halfSpan(best.a.level, best.a.idx);
    return Math.min(span.end - 0.001, Math.max(span.start + 0.001, t));
  }

  // ----------------------------------------------------------- pointer I/O
  const rel = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointermove', (e) => {
    if (trackTouch(e, false)) return;
    const p = rel(e);
    S.pointer = { x: p.x, y: p.y, inside: true, type: e.pointerType, cx: e.clientX, cy: e.clientY };
    const d = S.down;
    // a finger that landed on the arc scrubs once it really drags; until then it may still be a tap
    if (d && d.finger && d.target && !d.scrub && Math.hypot(p.x - d.x, p.y - d.y) > 6) d.scrub = true;
    if (d?.scrub) {
      const t = scrubTime(p.x, p.y);
      if (t !== null) S.pending = t;
    }
    S.dirty = true;
    ctx.requestRender();
  });
  canvas.addEventListener('pointerleave', () => {
    if (S.down) return;
    S.pointer.inside = false;
    S.hover = null;
    S.dirty = true;
    hideTip();
    ctx.requestRender();
  });
  // two fingers: pinch to change level (apart = deeper), like the wheel
  const touches = new Map();
  let pinch = null;
  const pinchDist = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  function trackTouch(e, down) {
    if (e.pointerType !== 'touch') return false;
    if (down) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    else if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      if (!pinch) {
        pinch = { d0: pinchDist(), at: 0 };
        S.down = null;
        S.hover = null;
        S.pending = null;
        hideTip();
      } else {
        const ratio = pinchDist() / Math.max(1, pinch.d0);
        const now = performance.now();
        if ((ratio > 1.32 || ratio < 0.76) && now - pinch.at > 380) {
          zoom(ratio > 1 ? 1 : -1, true);
          pinch.d0 = pinchDist();
          pinch.at = now;
        }
      }
      return true;
    }
    return false;
  }
  const untrackTouch = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (trackTouch(e, true)) return;
    const p = rel(e);
    S.pointer = { x: p.x, y: p.y, inside: true, type: e.pointerType, cx: e.clientX, cy: e.clientY };
    touched();
    S.hover = S.anim ? null : pick(p.x, p.y, e.pointerType === 'touch');
    const h = S.hover;
    // A mouse scrubs the moment it presses the arc. A finger first has to show whether it means to
    // drag along the arc or just tap it: the page must never see the clock jump because a finger
    // that landed near the arc was about to scroll (the touchstart handler below keeps the page still).
    const target = !!h && (h.kind === 'focus' || h.kind === 'alpha');
    const finger = e.pointerType !== 'mouse';
    S.down = { x: p.x, y: p.y, hover: h, target, finger, scrub: target && !finger };
    if (S.down.scrub) {
      canvas.setPointerCapture?.(e.pointerId);
      const t = scrubTime(p.x, p.y);
      if (t !== null) S.pending = t;
    } else if (h) canvas.setPointerCapture?.(e.pointerId);
    S.dirty = true;
    ctx.requestRender();
  });
  const endDown = (e, cancelled) => {
    const d = S.down;
    S.down = null;
    if (!d) return;
    try {
      canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      /* capture already gone */
    }
    if (!cancelled && d.finger && d.target && !d.scrub) {
      const t = scrubTime(d.x, d.y); // a tap on the arc: travel to that point
      if (t !== null) S.pending = t;
    } else if (!cancelled && d.hover && !d.scrub) {
      const p = rel(e);
      const moved = Math.hypot(p.x - d.x, p.y - d.y);
      if (moved < 7) {
        const h = d.hover;
        if (h.kind === 'child') {
          const span = eng.halfSpan(h.level, h.idx);
          ctx.goto(Math.min(span.end - 0.0005, span.start + 0.001), 'jump');
        } else if (h.kind === 'marker') {
          setOv(false);
          ctx.select(h.level);
        }
      }
    }
    if (e.pointerType === 'touch') {
      S.pointer.inside = false;
      S.hover = null;
      hideTip();
    }
    S.dirty = true;
    ctx.requestRender();
  };
  canvas.addEventListener('pointerup', (e) => {
    const wasPinch = !!pinch;
    untrackTouch(e);
    if (!wasPinch) endDown(e, false);
  });
  canvas.addEventListener('pointercancel', (e) => {
    untrackTouch(e);
    endDown(e, true);
  });
  // The page scrolls with a finger (touch-action: pan-y), except where the finger lands on the arc it
  // would scrub along: there the page stays still, whichever way the arc runs, and a second finger is
  // a pinch. Pointer events are unaffected by this.
  canvas.addEventListener(
    'touchstart',
    (e) => {
      if (!e.cancelable) return;
      if (e.touches.length > 1) return e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const h = S.anim ? null : pick(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top, true);
      if (h && (h.kind === 'focus' || h.kind === 'alpha')) e.preventDefault();
    },
    { passive: false },
  );
  // Ctrl / Cmd + wheel (a trackpad pinch arrives as ctrl + wheel) changes the level; a plain wheel
  // scrolls the page, so the stage is never a scroll trap and never changes the shared selection by accident.
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const now = performance.now();
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // small deltas (trackpads, free-spinning wheels) add up; a pause or a change of direction starts over
      if (now - S.wheelLast > 260 || Math.sign(d) !== Math.sign(S.wheelAcc)) S.wheelAcc = 0;
      S.wheelLast = now;
      S.wheelAcc += d;
      if (Math.abs(S.wheelAcc) >= 48 && now - S.wheelAt > 230) {
        zoom(S.wheelAcc < 0 ? 1 : -1, true);
        S.wheelAcc = 0;
        S.wheelAt = now;
      }
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowLeft') stepHalf(-1);
    else if (k === 'ArrowRight') stepHalf(1);
    else if (k === 'ArrowUp' || k === '+' || k === '=') zoom(1);
    else if (k === 'ArrowDown' || k === '-' || k === '−') zoom(-1);
    else if (k === 'Home') showOverview(true);
    else return;
    e.preventDefault();
  });

  // --------------------------------------------------------------- tooltip
  function hideTip() {
    if (!tip.hidden) tip.hidden = true;
    S.tipKey = '';
  }
  function placeTip() {
    const p = S.pointer;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = p.cx + 16;
    let y = p.cy + 18;
    if (x + w > innerWidth - 8) x = p.cx - w - 16;
    if (y + h > innerHeight - 8) y = p.cy - h - 14;
    tip.style.transform = `translate(${Math.max(8, Math.round(x))}px, ${Math.max(8, Math.round(y))}px)`;
  }
  function updateTip(now, tNow) {
    const h = S.hover;
    if (!h || !S.pointer.inside || S.anim) return hideTip();
    const L = h.level;
    const key = `${h.kind}|${L}|${h.idx}|${h.kind === 'marker' ? '' : Math.round((h.t ?? 0) * 200)}`;
    if (key !== S.tipKey || now - S.tipAt > 180) {
      const d = eng.describe(L, h.idx);
      const marker = h.kind === 'marker';
      const p = marker ? h.local : h.t;
      const at = marker ? null : eng.timeAt(L, h.idx, p);
      let action = 'Click to jump here';
      if (h.kind === 'child') action = 'Click to jump to the start of this half-arc';
      if (h.kind === 'alpha') action = 'Click or drag to travel along the wave';
      if (h.kind === 'focus') action = 'Click or drag to travel along this arc';
      if (marker) action = L === S.eff && !S.overview ? '' : 'Click to focus this depth';
      setHTML('tip', tip, tipHTML({ d, p, at, now: tNow, fmt, model, theme, marker, action }));
      S.tipKey = key;
      S.tipAt = now;
    }
    if (tip.hidden) tip.hidden = false;
    placeTip();
  }

  // --------------------------------------------------------------- readout
  function updateChipBars(cur) {
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const p = cur ? cur[l].local : 0;
      const q = Math.round(p * 48) / 48;
      if (S.barP[l] !== q) {
        S.barP[l] = q;
        chipByLevel[l].style.setProperty('--p', q);
        chipByLevel[l].dataset.crest = cur ? (cur[l].idx % 2 === 0 ? '+' : '−') : '';
      }
    }
  }

  /** hidden = on, written only when it changes (assigning the value it already has still queues a mutation). */
  function setHidden(node, on) {
    if (node.hidden !== on) node.hidden = on;
  }

  /** The checked level button also says where its level is now (a screen reader cannot see the bar under it). */
  const baseLabel = chipByLevel.map((c) => c.getAttribute('aria-label'));
  function updateChipLabel(cur) {
    const chk = !S.overview && cur ? S.level : -1;
    if (S.labeled !== chk && S.labeled >= 0) {
      chipByLevel[S.labeled].setAttribute('aria-label', baseLabel[S.labeled]);
      S.last.chipLabel = '';
    }
    S.labeled = chk;
    if (chk < 0) return;
    const h = cur[chk];
    const d = eng.describe(chk, h.idx);
    const text = `${baseLabel[chk]}. Now in half-arc ${d.signed}, ${d.crest ? 'crest' : 'trough'}, ${loopText(d)}, ${Math.floor(h.local * 20) * 5} % through this half-arc. ${cap(cycleText(d))}.`;
    if (S.last.chipLabel !== text) {
      S.last.chipLabel = text;
      chipByLevel[chk].setAttribute('aria-label', text);
    }
  }

  const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
  /** A date and its time stay together ("2026-10-09 11:40"), so a span that has to wrap breaks at its arrow. */
  const glue = (str) => str.replace(/(\d) (?=\d)/g, '$1\u00a0');
  /** "13.5 % of this η cycle": a second share, floored; the label stays put in a fixed column while the digits change. */
  const pctRow = (frac, decimals, what) => `<b>${floorPercent(frac, decimals)} %</b><span class="dim">${what}</span>`;

  function glyphMarkup(level, index) {
    return model.glyphSVG(index, { strokes: 2, color: theme.levelColor(level, 1, 70), scale: 6, thickness: 0.3, padding: 0.3 });
  }

  function updateReadout(frame, now) {
    const t = frame.t;
    setHidden(R.oor, S.inRange);
    setHidden(R.main, !S.inRange);
    setHidden(R.side, !S.inRange);
    updateControls();
    if (!S.inRange) {
      const before = t < model.tMin;
      const gap = before ? model.tMin - t : t - model.tMax;
      setText(
        'oor',
        R.oorText,
        `Outside the Saros 141 catalogue. The wave exists only between the first eclipse (${fmt.date(model.tMin)}) and the last (${fmt.date(model.tMax)}); the displayed time is ${fmt.duration(gap)} ${before ? 'before the first' : 'after the last'}, so the catalogue is shown greyed.`,
      );
      setHTML('glyph', R.glyph, '');
      return;
    }
    const cur = S.cur;
    if (S.overview) {
      const h = cur[0];
      const d = eng.describe(0, h.idx);
      R.badge.style.setProperty('--c', theme.levelColor(0, 1, 64));
      setText('badge', R.badge, '∿');
      setHTML('title', R.title, `<b>Saros 141</b> <span class="dim">· ${eng.halfCount(0)} α half-arcs · ${model.extent} intervals</span>`);
      setText('span', R.span, glue(spanText(fmt, model.tMin, model.tMax)));
      setHidden(R.loop, true);
      setText('cyc', R.cyc, `Now in the ${cycleText(d)}`);
      const pos = frame.pos / model.extent;
      setText('pct', R.pct, `${floorPercent(pos, 1)} %`);
      setText('what', R.what, 'of the catalogue');
      R.bar.style.transform = `scaleX(${pos})`;
      setHTML('pct2', R.pct2, pctRow(throughOf(d, h.local, t, model.tMax), 0, 'of this α half-arc'));
      setHTML('n1', R.n1, `<span class="dim">now in</span> α half-arc ${d.signed} <span class="dim">${d.crest ? 'crest' : 'trough'}</span>`);
      setHTML('n2', R.n2, `${fmt.date(d.start)} \u2192 ${fmt.date(d.end)}`);
      setHTML('glyph', R.glyph, glyphMarkup(0, cur[0].reading.index));
      return;
    }
    const L = S.eff;
    const h = cur[L];
    const d = eng.describe(L, h.idx);
    R.badge.style.setProperty('--c', theme.levelColor(L, 1, 64));
    setText('badge', R.badge, d.letter);
    setHTML(
      'title',
      R.title,
      `<b>half-arc ${d.signed}</b> <span class="wave-r-sign">${d.crest ? 'crest' : 'trough'}</span>${S.level > L ? ` <span class="wave-r-fast" title="${infos[S.level].text} half-arcs last ${fmt.duration(infos[S.level].meanSeconds / 2)}: too short to follow, so the view stays on ${d.letter}; the finer depths are its loops">${infos[S.level].text} is too fast to follow</span>` : ''}`,
    );
    setText('span', R.span, glue(spanText(fmt, d.start, d.end) + (d.clipped ? '  (clipped)' : '')));
    // two numberings of one thing, side by side: the loop number of the picture (inside the parent HALF-ARC)
    // and the cycle number every other view shows (inside the parent CYCLE)
    setHidden(R.loop, false);
    setText('loop', R.loop, loopText(d));
    setTitle('loopT', R.loop, loopHint(d));
    setText('cyc', R.cyc, cap(cycleText(d)));
    // progress through the part of the half-arc that lies inside the catalogue, and through the whole cycle (as every other view counts it)
    const through = throughOf(d, h.local, t, model.tMax);
    setText('pct', R.pct, `${floorPercent(through)} %`);
    setText('what', R.what, 'of this half-arc');
    R.bar.style.transform = `scaleX(${through})`;
    setHTML('pct2', R.pct2, pctRow(h.reading.phase, 1, `of this ${d.letter} cycle`));
    const [l1, l2] = nextLines(fmt, eng, d, h, t);
    setHTML('n1', R.n1, `<span class="dim">${l1.dim}</span>${l1.text ? ' ' + l1.text : ''}`);
    setHTML('n2', R.n2, `<span class="dim">${l2.dim}</span>${l2.text ? ' ' + l2.text : ''}`);
    setHTML('glyph', R.glyph, glyphMarkup(L, h.reading.index));
  }

  function updateLabel(frame) {
    let label;
    if (!S.inRange) label = 'Wave view. The displayed time is outside the Saros 141 catalogue.';
    else if (S.overview) {
      const d = eng.describe(0, S.cur[0].idx);
      label = `Wave view of the whole catalogue. Now in α half-arc ${d.signed}: ${cycleText(d)}.`;
    } else {
      const d = eng.describe(S.eff, S.cur[S.eff].idx);
      label = `Wave view focused on ${d.letter} half-arc ${d.signed} (${cycleText(d)}), now in the ${S.cur[S.eff].local < 0.5 ? 'first' : 'second'} half of this half-arc.`;
    }
    if (label !== S.label) {
      S.label = label;
      canvas.setAttribute('aria-label', label + ' Arrow keys: left and right step by half-arc, up and down change the depth, Home shows the catalogue.');
    }
  }

  // ---------------------------------------------------------------- render
  function render(frame, info) {
    if (!S.w) return;
    const now = performance.now();
    if (Math.min(3, globalThis.devicePixelRatio || 1) !== S.dpr) onResize(S.w, S.h); // the window moved to another display
    S.lastT = frame.t;
    // shared selection changed elsewhere -> focus it here
    const sel = levelOf(store.state.selectedLevel);
    if (sel !== S.lastSel) {
      S.lastSel = sel;
      setOv(false);
      S.dirty = true;
    }
    S.level = sel;
    S.eff = followable(sel);
    if (S.pending !== null) {
      const t = S.pending;
      S.pending = null;
      ctx.goto(t, 'scrub');
      return; // the next frame renders the new time
    }
    S.inRange = frame.inRange;
    if (frame.t !== S.curT) {
      // the exact readings are BigInt work: only when the time has moved
      S.cur = eng.readHalves(frame);
      S.curT = frame.t;
    }
    refreshYears();

    // which scene should be on screen?
    const wantOv = S.overview || !S.inRange;
    let key;
    if (wantOv) key = 'O';
    else key = `${S.eff}:${S.cur[S.eff].idx}`;
    let switched = false;
    if (!S.scene || S.scene.key !== key) {
      switched = true;
      const next = wantOv ? overviewScene() : eng.buildFocus(S.eff, S.cur[S.eff].idx);
      setScene(next, { snap: S.snap });
      S.snap = false;
      S.dirty = true;
      if (S.active) {
        if (wantOv) announce(S.inRange ? 'Showing the whole catalogue.' : 'The displayed time is outside the catalogue.');
        else {
          const d = eng.describe(S.eff, S.cur[S.eff].idx);
          announce(`${d.letter} half-arc ${d.signed}, ${d.crest ? 'crest' : 'trough'}, ${loopText(d)}. ${cap(cycleText(d))}. ${cap(whenText(fmt, d, frame.t))}.`);
        }
      }
    }
    updateChips(S.level, wantOv && S.overview);
    const mode = wantOv ? 'all' : 'focus';
    if (card.dataset.mode !== mode) card.dataset.mode = mode; // the legend lists what the picture shows
    if (S.anim && now - S.anim.t0 >= S.anim.dur) {
      S.anim = null;
      S.dirty = true;
    }
    const moving = !!S.anim;
    // a running clock redraws only when the picture would actually differ (see visualKey)
    const needDraw = S.dirty || moving || (info.dirty && visualKey() !== S.drawKey);

    if (needDraw) {
      painter.begin();
      S.hits.arcs.length = 0;
      S.hits.markers.length = 0;
      if (S.anim) {
        const a = S.anim;
        const c = animCamera(a, now);
        if (a.mode === 'zoom') {
          drawScene(a.from, c.from, Math.max(0, 1 - c.e * 1.15), false, true);
          drawScene(a.to, c.to, Math.min(1, 0.3 + c.e), false);
        } else {
          drawScene(a.from, c.from, 1 - c.e, false, true);
          drawScene(a.to, c.to, c.e, false);
        }
        S.hover = null;
      } else {
        drawScene(S.scene, S.cam, 1, true);
        if (S.pointer.inside && (S.pointer.type !== 'touch' || S.down)) {
          const h = pick(S.pointer.x, S.pointer.y, S.pointer.type === 'touch');
          const changed = (h?.kind ?? '') + (h?.level ?? '') + (h?.idx ?? '') !== (S.hover?.kind ?? '') + (S.hover?.level ?? '') + (S.hover?.idx ?? '');
          S.hover = h;
          if (changed) {
            // redraw once with the hover highlight
            painter.begin();
            S.hits.arcs.length = 0;
            S.hits.markers.length = 0;
            drawScene(S.scene, S.cam, 1, true);
          }
        } else S.hover = null;
      }
      S.dirty = painter.settling; // a label still gliding wants the next frame as well
      S.drawKey = moving ? '' : visualKey();
    }
    const cursor = S.hover || S.down?.scrub ? (S.down?.scrub ? 'grabbing' : 'pointer') : 'default';
    if (cursor !== S.cursor) {
      S.cursor = cursor;
      canvas.style.cursor = cursor;
    }
    updateTip(now, frame.t);
    if (switched || S.readNow || (now - S.readAt > 90 && (info.dirty || needDraw))) {
      S.readNow = false;
      S.readAt = now;
      updateReadout(frame, now);
      updateChipBars(S.inRange ? S.cur : null);
      updateChipLabel(S.inRange ? S.cur : null);
      updateLabel(frame);
    }
  }

  return {
    render,
    setActive(on) {
      S.active = !!on;
      if (on) {
        S.snap = true;
        S.scene = null;
        S.anim = null;
        S.dirty = true;
        ctx.requestRender();
      } else {
        clearTimeout(announceTimer); // nothing is announced for a tab that is no longer shown
        hideTip();
      }
    },
    destroy() {
      clearTimeout(announceTimer);
      ro.disconnect();
      reducedQuery?.removeEventListener?.('change', onReduced);
      el.innerHTML = '';
    },
    // --- public surface (also used by tests and deep links)
    /** Show the whole catalogue (true) or return to the shared focus level (false). */
    showOverview,
    /** Zoom one level in (+1) or out (-1); out of level 1 (α) leads to the catalogue. */
    zoom,
    /** Step to the previous (-1) / next (+1) half-arc of the focus level. */
    stepHalf,
    /** Snapshot of the view state. */
    getState: () => ({
      overview: S.overview || !S.inRange,
      level: S.level,
      focus: S.eff,
      scene: S.scene?.key ?? null,
      animating: !!S.anim,
      hover: S.hover ? { kind: S.hover.kind, level: S.hover.level, idx: S.hover.idx } : null,
      size: [S.w, S.h],
      inRange: S.inRange,
      cursor: S.pointer.inside ? { x: S.pointer.x, y: S.pointer.y } : null,
    }),
    /** Hit targets of the last frame (pixels), for tests. */
    getHits: () => ({
      arcs: S.hits.arcs.map((a) => ({ kind: a.kind, level: a.level, idx: a.idx, sa: { ...a.sa }, fraction: a.fraction })),
      markers: S.hits.markers.map((m) => ({ ...m })),
    }),
    get active() {
      return S.active;
    },
  };
}
