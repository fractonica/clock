/**
 * Rings view: concentric cycle dial + centre read-out + waveform inset.
 *
 * The dial (canvas) shows where we are in every cycle at once; the centre read-out (DOM) counts down
 * the selected cycle and lists its quarter thresholds; the inset plots the glyph value over the selected
 * cycle and lets the cursor be dragged to scrub time inside it. Geometry and cycle maths live in
 * ./rings/geometry.js, text formatting in ./rings/text.js, the two renderers in dial.js and wave.js.
 *
 * Pure mode (docs/design/80-pure.md): the same view in Fractonica terms only. Every sentence that would carry a
 * Gregorian date, a clock time, an Earth unit or a percentage is written again in ./rings/pure-text.js (cycle names,
 * coordinates on the unit ladder, countdowns in ι and λ, "→ the cycle that begins") and the percentage becomes a pair
 * of two-stroke glyphs. The mode is read on every frame, so switching is live in both directions.
 */
import { createDial } from './rings/dial.js';
import { createWave } from './rings/wave.js';
import {
  glyphExtreme,
  phaseWord,
  sectorOf,
  timeAtPhase,
  phaseLimit,
  childCycle,
  isBlur,
  scrubTime,
  dialIntent,
  thresholdJump,
  HOLD_MS,
  holdSlipped,
  isHorizontalDrag,
  normLevel,
  normRange,
  stepRangeDepths,
  widenRangeTo,
} from './rings/geometry.js';
import {
  YEAR,
  levelTag,
  cycleTag,
  whenParts,
  whenText,
  countdownBody,
  startPhrase,
  depthRangeNote,
  percentText,
  valueText,
} from './rings/text.js';
import * as PT from './rings/pure-text.js';

const PREF_KEY = 'fractonica-clock/rings';
/** Innermost depth of the range the dial opens with (the shared default of `store.state.maxDepth`) and the deepest there is. */
const OPENING_DEPTH = 10;
const FINEST_LEVEL = 13;
const STROKES = 2;
const M = glyphExtreme(STROKES);
const BOUNDARIES = ['begin', 'peak', 'node', 'valley', 'end'];
const PHASE_MARK = { Rising: '↗', Falling: '↘', Peak: '▲', Valley: '▼' };
/**
 * The centre read-out holds its full content when the hole is at least this big (css px radius): below it the
 * prev / next buttons would reach past the hole onto the innermost ring (measured: they fit from about 157 px).
 */
const FULL_READOUT_RADIUS = 158;

/** Stand-in reading of a ring too fast to draw a hand for: nothing exact is computed for it. */
const BLUR_STUB = Object.freeze({ phase: 0, local: 0, stub: true });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const compactText = (p) => (!p ? '—' : p.time ? `${p.date} ${p.time}` : p.date);

/** Toggles and the legend (closed: the dial is the first thing a visitor should see; the "How to read" button opens it). */
function loadPrefs() {
  const d = { sectors: true, quarters: true, funnels: true, help: false };
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    for (const k of Object.keys(d)) if (typeof raw[k] === 'boolean') d[k] = raw[k];
    d.firstVisit = typeof raw.help !== 'boolean';
  } catch {
    /* storage unavailable: defaults */
  }
  d.firstVisit = false;
  return d;
}
function savePrefs(p) {
  try {
    const { firstVisit, ...keep } = p;
    localStorage.setItem(PREF_KEY, JSON.stringify(keep));
  } catch {
    /* ignore */
  }
}

export function mount(el, ctx) {
  const { model, store, fmt, theme, icons } = ctx;
  const P = ctx.pure;
  const isPure = () => !!ctx.isPure?.();
  let pureNow = isPure();
  const prefs = loadPrefs();
  const reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = !!reduceQuery?.matches;
  let active = false;
  let own = true; // something of ours changed (size, hover, toggles, ...)

  // ------------------------------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------------------------------
  const rangeNote = () => depthRangeNote(fmt, model.levelInfo(OPENING_DEPTH - 1), model.levelInfo(FINEST_LEVEL));
  /** Inner HTML of the "How to read" list: the Gregorian wording, or the pure one (rebuilt whenever the mode changes). */
  const helpHTML = (pureMode) =>
    pureMode
      ? PT.helpHTML(P, model.levelInfo(OPENING_DEPTH - 1), model.levelInfo(FINEST_LEVEL))
      : `
        <div><dt>Labels</dt><dd><b>η 7 · 1/11</b> reads: cycle η, depth 7, the 1st of the 11 η cycles inside its parent cycle. The pill under the name says what the glyph is doing now (rising, peak, falling, valley) and which threshold comes next.</dd></div>
        <div><dt>Rings</dt><dd>Every ring is one cycle. The outermost, α, lasts about 72 years; each ring inside it is the next harmonic, 4 to 13 times shorter. ${rangeNote()}</dd></div>
        <div><dt>Arc and dot</dt><dd>The arc grows clockwise from 12 o’clock as the cycle runs; the dot is the hand, exactly where we are in that cycle. Rings too fast to follow dissolve into a glow.</dd></div>
        <div><dt>Sectors</dt><dd>A ring is cut into the child cycles it contains. The tinted sector is the one running now, and the funnel shows it opening up into the whole next ring.</dd></div>
        <div><dt>Quarters</dt><dd>Beads at 3, 6 and 9 o’clock mark peak, node and valley; they fill in as they are passed. The selected ring is labelled.</dd></div>
        <div><dt>Centre</dt><dd>Countdown to the end of the selected cycle, its Gregorian end time in your zone, and its four thresholds. The wave shows what the glyph does over the same cycle.</dd></div>
        <div><dt>Navigate</dt><dd>Click a sector to jump to the start of that child cycle, a label to select a ring, drag the wave cursor to scrub inside the cycle. On a touch screen, tap a ring or sector (or touch and hold it) to see what it is, and tap the same sector again to jump. The thresholds in the centre jump to that moment of the selected cycle, passed ones included.</dd></div>
      `;
  el.innerHTML = `
  <div class="rings" data-compact="0">
    <div class="sr-only rings-live" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="rings-toolbar" role="toolbar" aria-label="Rings options">
      <div class="rings-range" role="group" aria-label="Depth range shown on the dial">
        <span class="rings-tb-label">Depth</span>
        <span class="rings-step">
          <button type="button" class="btn btn-icon" data-step="min:-1" aria-label="Show one more outer ring" title="Show one more outer (shallower) ring">${minusIcon()}</button>
          <output class="rings-step-val mono" data-out="min"></output>
          <button type="button" class="btn btn-icon" data-step="min:1" aria-label="Show one less outer ring" title="Hide the outermost ring">${plusIcon()}</button>
        </span>
        <span class="rings-tb-sep" aria-hidden="true">to</span>
        <span class="rings-step">
          <button type="button" class="btn btn-icon" data-step="max:-1" aria-label="Show one less inner ring" title="Hide the innermost ring">${minusIcon()}</button>
          <output class="rings-step-val mono" data-out="max"></output>
          <button type="button" class="btn btn-icon" data-step="max:1" aria-label="Show one more inner ring" title="Show one more inner (faster) ring">${plusIcon()}</button>
        </span>
      </div>
      <button type="button" class="btn btn-sm rings-offdial" hidden></button>
      <div class="seg rings-toggles" role="group" aria-label="Dial layers">
        <button type="button" data-toggle="sectors" title="Divide every ring into its child cycles and tint the running one">Sectors</button>
        <button type="button" data-toggle="quarters" title="Quarter marks: begin, peak, node, valley">Quarters</button>
        <button type="button" data-toggle="funnels" title="Funnels: how a running sector opens up into the next ring">Funnels</button>
      </div>
      <span class="rings-hint dim"><span class="rings-hint-mouse"><span class="kbd">←</span> <span class="kbd">→</span> ring · click a sector to jump</span><span class="rings-hint-touch">tap or hold a ring for details · tap a sector again to jump</span></span>
      <button type="button" class="btn btn-sm rings-help-btn" aria-expanded="false" aria-controls="rings-help-panel">${helpIcon()}How to read</button>
    </div>
    <section class="card rings-help" id="rings-help-panel" aria-label="How to read the rings" hidden>
      <dl class="rings-help-list"></dl>
    </section>

    <div class="rings-body">
      <div class="rings-stage">
        <div class="card rings-dialcard">
          <div class="rings-dialwrap" tabindex="0" role="group" aria-label="Concentric cycle dial">
            <canvas class="rings-canvas rings-layer-base" aria-hidden="true"></canvas>
            <canvas class="rings-canvas rings-layer-live" aria-hidden="true"></canvas>
            <canvas class="rings-canvas rings-layer-over" aria-hidden="true"></canvas>
            <div class="rings-centre">
              <div class="rings-cn">
                <div class="rings-cn-name mono"></div>
                <div class="rings-cn-phase"></div>
              </div>
              <div class="rings-eyebrow"></div>
              <div class="rings-count mono"></div>
              <div class="rings-more">
                <div class="rings-fullname mono"></div>
                <div class="rings-end"></div>
                <div class="rings-chips" role="group" aria-label="Quarter thresholds of the selected cycle"></div>
                <div class="rings-btns">
                  <button type="button" class="btn rings-b-prev" aria-label="Previous cycle">${icons.prev}</button>
                  <button type="button" class="btn rings-b-thr" title="Jump just past the next quarter threshold of the selected cycle">Next threshold <span aria-hidden="true">›</span></button>
                  <button type="button" class="btn rings-b-next" aria-label="Next cycle">${icons.next}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="card rings-detail" hidden>
          <div class="rings-picker" role="group" aria-label="Choose a ring"></div>
        </div>
      </div>

      <aside class="rings-side">
        <section class="card rings-inset" aria-label="Waveform of the selected cycle">
          <div class="card-h">
            <h3>Cycle phase</h3>
            <span class="spacer"></span>
            <span class="chip rings-inset-chip mono"></span>
          </div>
          <div class="card-b">
            <div class="rings-wavehead">
              <div class="rings-glyph" aria-hidden="true"></div>
              <div class="rings-wh-text">
                <div class="rings-wh-name mono"></div>
                <div class="rings-wh-sub"></div>
              </div>
              <div class="rings-wh-pctbox">
                <div class="rings-wh-pct mono"></div>
                <div class="rings-wh-pctl"></div>
              </div>
            </div>
            <div class="rings-wavebox">
              <canvas class="rings-wave-base" aria-hidden="true"></canvas>
              <span class="rings-wave-in mono" aria-hidden="true" hidden></span>
              <canvas class="rings-wave" tabindex="0" role="slider" aria-orientation="horizontal"
                aria-label="Position inside the selected cycle" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></canvas>
            </div>
            <p class="rings-wave-hint dim">Drag the cursor to scrub time inside the cycle · <span class="kbd">←</span> <span class="kbd">→</span> one glyph state · <span class="kbd">PgUp</span> <span class="kbd">PgDn</span> one quarter</p>
            <dl class="rings-facts">
              <div><dt>Started</dt><dd class="rings-f-start"></dd></div>
              <div><dt>Ends</dt><dd class="rings-f-end"></dd></div>
              <div><dt>Length</dt><dd class="rings-f-len"></dd></div>
              <div><dt>Glyph</dt><dd class="rings-f-glyph"></dd></div>
              <div class="rings-f-wide"><dt>Address</dt><dd class="rings-f-addr"></dd></div>
            </dl>
          </div>
        </section>
      </aside>
    </div>
  </div>`;

  const $ = (sel) => el.querySelector(sel);
  const root = $('.rings');
  const wrap = $('.rings-dialwrap');
  const canvas = $('.rings-layer-live');
  const centre = $('.rings-centre');
  const more = $('.rings-more');
  const detail = $('.rings-detail');
  const chipsBox = $('.rings-chips');
  const picker = $('.rings-picker');
  const offDial = $('.rings-offdial');
  const liveNote = $('.rings-live');
  // the tooltip lives on <body>: `position: fixed` then never depends on the containment of this view
  const tip = document.createElement('div');
  tip.className = 'tip rings-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  const waveCanvas = $('.rings-wave');
  const waveIn = $('.rings-wave-in');
  const helpBtn = $('.rings-help-btn');
  const helpPanel = $('.rings-help');
  const helpList = $('.rings-help-list');
  const nodes = {
    name: $('.rings-cn-name'),
    phase: $('.rings-cn-phase'),
    eyebrow: $('.rings-eyebrow'),
    count: $('.rings-count'),
    end: $('.rings-end'),
    prev: $('.rings-b-prev'),
    thr: $('.rings-b-thr'),
    next: $('.rings-b-next'),
    glyph: $('.rings-glyph'),
    fullName: $('.rings-fullname'),
    whName: $('.rings-wh-name'),
    whSub: $('.rings-wh-sub'),
    whPct: $('.rings-wh-pct'),
    whPctL: $('.rings-wh-pctl'),
    chip: $('.rings-inset-chip'),
    fStart: $('.rings-f-start'),
    fEnd: $('.rings-f-end'),
    fLen: $('.rings-f-len'),
    fGlyph: $('.rings-f-glyph'),
    fAddr: $('.rings-f-addr'),
    outMin: $('[data-out="min"]'),
    outMax: $('[data-out="max"]'),
  };
  // four quarter chips
  chipsBox.innerHTML = ctx.QUARTER_NAMES.map(
    (name, k) =>
      `<button type="button" class="rings-chip" data-q="${k}"><span class="rings-chip-name">${name}</span><span class="rings-chip-in mono"></span><span class="rings-chip-time mono"></span></button>`,
  ).join('');
  const chips = [...chipsBox.querySelectorAll('.rings-chip')].map((b) => ({
    b,
    time: b.querySelector('.rings-chip-time'),
    in: b.querySelector('.rings-chip-in'),
  }));

  // text/attribute writes only when the value changed. Text and HTML share one content slot: switching a node from
  // markup back to the same plain text it showed before (pure mode and back) must still rewrite it.
  const memo = new WeakMap();
  const memoOf = (node) => {
    let m = memo.get(node);
    if (!m) memo.set(node, (m = {}));
    return m;
  };
  const setText = (node, text) => {
    const m = memoOf(node);
    if (m.c !== `t:${text}`) {
      node.textContent = text;
      m.c = `t:${text}`;
    }
  };
  const setHTML = (node, html) => {
    const m = memoOf(node);
    if (m.c !== `h:${html}`) {
      node.innerHTML = html;
      m.c = `h:${html}`;
    }
  };
  const setAttr = (node, name, value) => {
    const m = memoOf(node);
    const key = `a:${name}`;
    if (m[key] !== value) {
      if (value === null || value === false) node.removeAttribute(name);
      else node.setAttribute(name, value === true ? '' : value);
      m[key] = value;
    }
  };
  const setClass = (node, cls, on) => {
    const m = memoOf(node);
    const key = `c:${cls}`;
    if (m[key] !== on) {
      node.classList.toggle(cls, on);
      m[key] = on;
    }
  };

  const dial = createDial(canvas, theme, { base: $('.rings-layer-base'), over: $('.rings-layer-over') });
  const wave = createWave(waveCanvas, theme, $('.rings-wave-base'));

  // ------------------------------------------------------------------------------------------
  // state shared between render and the event handlers
  // ------------------------------------------------------------------------------------------
  let view = {
    frame: null,
    speed: 1,
    inRange: false,
    levels: [],
    infos: [],
    readings: [],
    sel: normLevel(store.state.selectedLevel),
    selLv: null,
    selInfo: model.levelInfo(normLevel(store.state.selectedLevel)),
  };
  let hover = null; // {ring, sector, label}
  let hoverPointer = null; // {x, y} client coords for the tooltip
  let tipAt = 0;
  let waveHover = null; // phase 0..1 under the pointer
  let scrubbing = false;
  let scrubCycle = null;
  let waveFocused = false;
  let cache = { key: '', times: [], parts: [], chip: [], refYear: 0 };
  let compactNow = false;
  let epoch = 0; // discontinuities of the displayed time (frozen hands under reduced motion move on these only)
  let announceSel = false; // tell screen readers about the next selection
  let lastTextKey = '';
  let lastTextAt = 0;
  const prof = { on: false, frames: 0, dial: 0, text: 0, wave: 0, read: 0, t0: 0 };

  // ------------------------------------------------------------------------------------------
  // size handling
  // ------------------------------------------------------------------------------------------
  const dpr = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  let lastDpr = dpr();

  function syncDialSize() {
    const size = wrap.clientWidth;
    if (size < 40) return;
    const changed = dial.resize(size, dpr());
    const n = shownLevels().length;
    const hadLayout = dial.layout;
    const lay = dial.ensureLayout(n);
    if (changed || !hadLayout || hadLayout !== lay) {
      centre.style.setProperty('--rings-rh', `${lay.rHole.toFixed(1)}px`);
      setCompact(lay.rHole < (compactNow ? FULL_READOUT_RADIUS + 8 : FULL_READOUT_RADIUS)); // hysteresis: a scrollbar must not flip it back and forth
      own = true;
    }
  }
  function syncWaveSize() {
    const w = waveCanvas.clientWidth;
    const h = waveCanvas.clientHeight;
    if (w < 60 || h < 60) return;
    if (wave.resize(w, h, dpr())) own = true;
  }
  /** Compact dials keep only the countdown in the centre; the rest sits in a card below the dial. */
  function setCompact(on) {
    if (on === compactNow) return;
    compactNow = on;
    root.dataset.compact = on ? '1' : '0';
    if (on) {
      detail.hidden = false;
      detail.append(more);
    } else {
      detail.hidden = true;
      centre.append(more);
    }
  }

  const roWrap = new ResizeObserver(() => syncDialSize());
  roWrap.observe(wrap);
  const roWave = new ResizeObserver(() => syncWaveSize());
  roWave.observe(waveCanvas);

  // ------------------------------------------------------------------------------------------
  // range, selection
  // ------------------------------------------------------------------------------------------
  function range() {
    const st = store.state;
    return normRange(st.minDepth, st.maxDepth);
  }
  function shownLevels() {
    const { minL, maxL } = range();
    const out = [];
    for (let L = minL; L <= maxL; L++) out.push(L);
    return out;
  }
  function stepRange(which, d) {
    // start from the range the dial really shows, not from raw (possibly inverted or garbage) settings
    const next = stepRangeDepths(range(), which, d);
    store.set(next);
    const sel = store.state.selectedLevel;
    const inside = clamp(normLevel(sel), next.minDepth - 1, next.maxDepth - 1);
    if (inside !== sel) ctx.select(inside);
    own = true;
  }
  function selectRelative(d) {
    const { minL, maxL } = range();
    const sel = normLevel(store.state.selectedLevel);
    const next = sel < minL ? minL : sel > maxL ? maxL : clamp(sel + d, minL, maxL);
    if (next !== sel) ctx.select(next);
  }

  const stepBtns = [...el.querySelectorAll('[data-step]')];
  const toggleBtns = [...el.querySelectorAll('[data-toggle]')];
  for (const b of stepBtns) {
    b.addEventListener('click', () => {
      const [which, d] = b.dataset.step.split(':');
      stepRange(which, Number(d));
    });
  }
  for (const b of toggleBtns) {
    b.addEventListener('click', () => {
      const k = b.dataset.toggle;
      prefs[k] = !prefs[k];
      savePrefs(prefs);
      own = true;
    });
  }

  function applyHelp() {
    helpPanel.hidden = !prefs.help;
    helpBtn.setAttribute('aria-expanded', String(!!prefs.help));
    helpBtn.classList.toggle('is-on', !!prefs.help);
  }
  applyHelp();
  if (prefs.firstVisit) {
    prefs.firstVisit = false;
    savePrefs({ ...prefs, help: false }); // shown open this once; the next visit starts with it closed
  }
  helpBtn.addEventListener('click', () => {
    prefs.help = !prefs.help;
    savePrefs(prefs);
    applyHelp();
    own = true;
  });

  // ------------------------------------------------------------------------------------------
  // cached per-cycle strings (Gregorian times of the thresholds; pure mode: their coordinates on the ladder)
  // ------------------------------------------------------------------------------------------
  function cycleStrings(frame, lv) {
    const pm = pureNow;
    const key = `${lv.level}:${lv.cycleBig}:${pm ? 'pure' : fmt.zone()}`;
    if (cache.key === key) return cache;
    const times = lv.thresholds.map((e) => e.time);
    if (pm) {
      // a coordinate per threshold (ordinals written once, then only where they change), with a shorter one for narrow plots
      const labels = PT.boundaryLabels(P, model, lv.level, times);
      cache = { key, times, parts: labels, alt: labels.map((l) => l && l.alt), chip: labels, facts: PT.factParts(P, model, lv.level, lv), refYear: 0 };
      return cache;
    }
    const refYear = fmt.parts(frame.t).year;
    const parts = times.map((t) => (t === null ? null : whenParts(fmt, t, lv.duration, { compact: true, refYear })));
    // chips: a short cycle that stays inside one civil day needs only the time of day
    const day = fmt.date(lv.start);
    const chip = times.map((t, i) => {
      if (t === null) return { date: '—', time: '' };
      if (lv.duration < 86400 && parts[i].time && fmt.date(t) === day) return { date: '', time: parts[i].time };
      return { date: parts[i].date, time: parts[i].time };
    });
    cache = { key, times, parts, alt: null, chip, facts: null, refYear };
    return cache;
  }

  // ------------------------------------------------------------------------------------------
  // centre read-out + wave header
  // ------------------------------------------------------------------------------------------
  function updateReadout(frame) {
    const { sel, selLv: lv, selInfo: info } = view;
    const accent = theme.levelColor(sel, 1, 70);
    if (memo.get(centre)?.accent !== accent) {
      root.style.setProperty('--rings-accent', accent);
      root.style.setProperty('--rings-accent-soft', theme.levelColor(sel, 0.16));
      memo.set(centre, { ...(memo.get(centre) || {}), accent });
    }
    const pm = pureNow;
    if (!frame.inRange || !lv) {
      setText(nodes.name, 'Outside the catalogue');
      setText(nodes.phase, '');
      setText(nodes.fullName, '');
      setText(nodes.eyebrow, 'Saros 141 covers');
      // pure mode: the catalogue is α#1 – α#18 and spans positions 0 → 69, never years
      setText(nodes.count, pm ? P.catalogueText() : `${fmt.parts(model.tMin).year}–${fmt.parts(model.tMax).year}`);
      setText(nodes.end, pm ? `pos 0 → ${model.extent}` : `${fmt.date(model.tMin)} → ${fmt.date(model.tMax)}`);
      if (!chipsBox.hidden) chipsBox.hidden = true;
      setHTML(nodes.prev, `${icons.prev}<span class="rings-b-text">Start</span>`);
      setHTML(nodes.next, `<span class="rings-b-text">End</span>${icons.next}`);
      if (!nodes.thr.hidden) nodes.thr.hidden = true;
      setAttr(nodes.prev, 'aria-label', 'Go to the start of the catalogue');
      setAttr(nodes.next, 'aria-label', 'Go to the end of the catalogue');
      setClass(root, 'is-out', true);
      return;
    }
    setClass(root, 'is-out', false);
    if (chipsBox.hidden) chipsBox.hidden = false;
    if (nodes.thr.hidden) nodes.thr.hidden = false;
    setHTML(nodes.prev, icons.prev);
    setHTML(nodes.next, icons.next);
    setAttr(nodes.prev, 'aria-label', 'Previous cycle');
    setAttr(nodes.next, 'aria-label', 'Next cycle');

    const strings = cycleStrings(frame, lv);
    const pw = phaseWord(lv.index, lv.derivative, M);
    const toNext = lv.next.time !== null ? ` · to ${lv.next.name}` : '';
    const pillCore = `${PHASE_MARK[pw.word]} ${pw.word}${toNext}`;
    if (pm) {
      // the big name is the cycle's own (Eta Monofracton); a small hole keeps the short tag and leaves the name to the card below
      const name = PT.cycleName(P, sel, lv);
      setText(nodes.name, compactNow ? cycleTag(info, lv) : name);
      setText(nodes.phase, compactNow ? pillCore : `${cycleTag(info, lv)} · ${pillCore}`);
      setText(nodes.fullName, name);
    } else {
      setText(nodes.name, cycleTag(info, lv));
      setText(nodes.phase, pillCore);
      setText(nodes.fullName, '');
    }
    setText(nodes.eyebrow, lv.clipped ? 'catalogue ends in' : 'ends in');
    if (pm) {
      // two units like everywhere else; a roomy dial adds a third one while it is steady (never finer than λ, as in Up next)
      setText(nodes.count, PT.centreSpan(P, model, frame.t, lv.end, { compact: compactNow }));
      setText(nodes.end, PT.endLine(P, model, sel, lv));
    } else {
      setText(nodes.count, countdownBody(fmt, lv.remaining));
      const endLabel = whenText(fmt, lv.end, lv.duration);
      setText(nodes.end, `${endLabel}${lv.duration < YEAR * 0.9 ? ' · ' + fmt.tag(lv.end) : ''}`);
    }

    // chips: peak / node / valley / end
    ctx.QUARTER_NAMES.forEach((name, k) => {
      const t = strings.times[k + 1];
      const chip = chips[k];
      const passed = lv.quarter > k;
      const isNext = lv.quarter === k && t !== null;
      setClass(chip.b, 'is-passed', passed);
      setClass(chip.b, 'is-next', isNext);
      setClass(chip.b, 'is-void', t === null);
      setAttr(chip.b, 'disabled', t === null);
      if (pm) {
        // every chip counts to (or from) its threshold and says where it sits on the clock of the header
        const c = PT.chipText(P, model, sel, lv, k, t, frame.t, strings.chip[k + 1]);
        setHTML(chip.time, `${c.date ? `<span>${esc(c.date)}</span>` : ''}${c.time ? `<span>${esc(c.time)}</span>` : ''}`);
        setText(chip.in, c.count);
        setAttr(chip.b, 'title', c.title);
        setAttr(chip.b, 'aria-label', c.label);
        return;
      }
      setAttr(chip.b, 'aria-label', null);
      const c = strings.chip[k + 1];
      // date and time are separate spans: when both do not fit on one line the time wraps, nothing is cut off
      setHTML(chip.time, `${c.date ? `<span>${esc(c.date)}</span>` : ''}${c.time ? `<span>${esc(c.time)}</span>` : ''}`);
      setText(chip.in, isNext ? countdownBody(fmt, t - frame.t) : '');
      setAttr(
        chip.b,
        'title',
        t === null
          ? `${name}: beyond the end of the catalogue`
          : passed
            ? `Jump back to the ${name} of this cycle (${whenText(fmt, t, lv.duration)})`
            : `Jump just past the ${name} (${whenText(fmt, t, lv.duration)})`,
      );
    });
    setAttr(nodes.thr, 'disabled', lv.next.time === null);
  }

  function updateInset(frame) {
    const { sel, selLv: lv, selInfo: info } = view;
    const pm = pureNow;
    if (!frame.inRange || !lv) {
      setText(nodes.whName, '—');
      setText(nodes.whSub, 'Outside the catalogue');
      setText(nodes.whPct, '');
      setText(nodes.whPctL, '');
      setText(nodes.chip, `${levelTag(info)}`);
      setHTML(nodes.glyph, '');
      memoOf(nodes.glyph).g = null; // the glyph is redrawn when a cycle is back in view, whatever it was before
      memoOf(nodes.fAddr).k = null;
      for (const n of [nodes.fStart, nodes.fEnd, nodes.fLen, nodes.fGlyph, nodes.fAddr]) setText(n, '—');
      setAttr(waveCanvas, 'aria-valuemax', pm ? '255' : '100');
      setAttr(waveCanvas, 'aria-valuenow', '0');
      setAttr(waveCanvas, 'aria-valuetext', 'Outside the catalogue');
      return;
    }
    const pw = phaseWord(lv.index, lv.derivative, M);
    setText(nodes.chip, `${levelTag(info)}`);
    setText(nodes.whName, pm ? PT.cycleName(P, sel, lv) : cycleTag(info, lv));
    setAttr(nodes.whName, 'title', `${levelTag(info)}: cycle ${lv.local + 1} of ${lv.siblings}${info.siblings === null ? ' in the catalogue' : ' inside its parent cycle'}`);
    setText(nodes.whSub, `${pw.word} · value ${valueText(lv.value)}`);
    if (pm) {
      // two glyphs (16 x 16 = 256 states) instead of a percentage; the first one is the glyph the cycle shows now
      setHTML(nodes.whPct, P.pairHTML(lv.phase, { label: 'phase' }));
      setText(nodes.whPctL, `phase ${P.pairText(lv.phase)}`);
      setAttr(nodes.whPctL, 'aria-hidden', 'true'); // "13·4" would be read as a number; the pair says "phase 13 and 4 of 256"
    } else {
      setText(nodes.whPct, percentText(lv.phase));
      setText(nodes.whPctL, 'through this cycle');
      setAttr(nodes.whPctL, 'aria-hidden', null);
    }
    const glyphKey = `${lv.index}|${sel}`;
    if (memoOf(nodes.glyph).g !== glyphKey) {
      nodes.glyph.innerHTML = model.glyphSVG(lv.index, { strokes: STROKES, ...theme.glyphStyle(theme.levelColor(sel, 1, 74), 4.6) });
      memoOf(nodes.glyph).g = glyphKey;
      memoOf(nodes.glyph).c = null;
    }
    // facts
    if (pm) {
      // coordinates and spans on the ladder; the cycle that begins when this one ends takes the place of the end date
      // (everything but the distances is worked out once per cycle)
      const f = cycleStrings(frame, lv).facts;
      const when = (p) => `<span class="mono">${esc(p.date)}</span>${p.time ? `<span class="mono">${esc(p.time)}</span>` : ''}`;
      setHTML(nodes.fStart, `${when(f.start)}<span class="dim">${esc(PT.inText(P, frame.t, lv.start))}</span>`);
      setHTML(nodes.fEnd, `${when(f.end)}<span class="mono">${esc(f.endLine)}</span><span class="dim">${esc(PT.inText(P, frame.t, lv.end))}</span>`);
      setText(nodes.fLen, `${f.length}${lv.clipped ? ' (clipped by the catalogue)' : ''}`);
      setHTML(nodes.fGlyph, `<span>${esc(PT.stateText(P, lv.phase))}</span><span>value ${valueText(lv.value)}${lv.dotted ? ' · dotted' : ''}</span>`);
    } else {
      const rel = (t) => countdownBody(fmt, t - frame.t);
      const startRel = frame.t >= lv.start ? `${rel(lv.start)} ago` : `in ${rel(lv.start)}`;
      // date, time and the relative phrase each own a line: the block keeps its height as the numbers change
      const when = (t) => {
        const p = whenParts(fmt, t, lv.duration);
        return `<span class="mono">${esc(p.date)}</span>${p.time ? `<span class="mono">${esc(p.time)}</span>` : ''}`;
      };
      setHTML(nodes.fStart, `${when(lv.start)}<span class="dim">${esc(startRel)}</span>`);
      setHTML(nodes.fEnd, `${when(lv.end)}${lv.clipped ? '<span class="dim">end of the catalogue</span>' : ''}<span class="dim">in ${esc(rel(lv.end))}</span>`);
      setText(nodes.fLen, `${fmt.duration(lv.duration)}${lv.clipped ? ' (clipped by the catalogue)' : ''}`);
      setHTML(nodes.fGlyph, `<span>state ${lv.index} of 0–${4 * M - 1}</span><span>value ${valueText(lv.value)}${lv.dotted ? ' · dotted' : ''}</span>`);
    }
    const addrKey = `${sel}:${lv.cycleBig}:${pm ? 'p' : 'n'}`;
    if (memoOf(nodes.fAddr).k !== addrKey) {
      const path = model.cycleToPath(sel, lv.cycleBig);
      // pure mode writes an address chain with ordinals (α#6 › β#4 …); the Gregorian-side view keeps the depth chips
      nodes.fAddr.innerHTML = path
        .map((n, l) => `<span class="rings-addr" style="--c:${theme.levelColor(l, 1, 72)}">${esc(pm ? P.shortName(l, n) : `${model.levelInfo(l).letter} ${n}`)}</span>`)
        .join('<span class="rings-addr-sep" aria-hidden="true">›</span>');
      memoOf(nodes.fAddr).k = addrKey;
      memoOf(nodes.fAddr).c = null;
    }
    // slider semantics
    if (pm) {
      setAttr(waveCanvas, 'aria-valuemax', '255');
      setAttr(waveCanvas, 'aria-valuenow', String(P.pair(lv.phase).index));
      setAttr(waveCanvas, 'aria-valuetext', PT.sliderText(P, pw.word, lv.phase, PT.cycleName(P, sel, lv)));
    } else {
      const pct = Math.round(lv.phase * 100);
      setAttr(waveCanvas, 'aria-valuemax', '100');
      setAttr(waveCanvas, 'aria-valuenow', String(pct));
      setAttr(waveCanvas, 'aria-valuetext', `${pw.word}, ${percentText(lv.phase)} through ${cycleTag(info, lv)}`);
    }
  }

  /** The countdown to the next boundary is DOM text over the canvas: cheap to change every frame. */
  function updateWaveCountdown(ws) {
    const slot = ws.inRange ? wave.nextSlot : null;
    const text = slot ? ws.labels[slot.i].in : '';
    if (!slot || !text) {
      if (!waveIn.hidden) waveIn.hidden = true;
      return;
    }
    if (waveIn.hidden) waveIn.hidden = false;
    setText(waveIn, text);
    // keep the text inside the canvas whatever its length (10 px monospace: about 6.1 px per character)
    const w = text.length * 6.1;
    const x =
      slot.align === 'right'
        ? clamp(slot.anchor, slot.lo + w, slot.hi)
        : slot.align === 'center'
          ? clamp(slot.anchor, slot.lo + w / 2, slot.hi - w / 2)
          : clamp(slot.anchor, slot.lo, slot.hi - w);
    const pos = `${x.toFixed(1)}|${slot.y.toFixed(1)}|${slot.align}`;
    if (memo.get(waveIn)?.pos !== pos) {
      waveIn.style.left = `${x.toFixed(1)}px`;
      waveIn.style.top = `${(slot.y - 9.5).toFixed(1)}px`;
      waveIn.style.transform = slot.align === 'right' ? 'translateX(-100%)' : slot.align === 'center' ? 'translateX(-50%)' : 'none';
      memo.set(waveIn, { ...(memo.get(waveIn) || {}), pos });
    }
  }

  function waveState(frame) {
    const { sel, selLv: lv } = view;
    if (!frame.inRange || !lv) return { inRange: false, level: sel, M, phase: 0, index: 0, quarter: 0, limit: 1, key: 'out', labels: [], hover: null };
    if (isBlur(view.selInfo, view.speed)) return { inRange: true, blur: true, level: sel, M, phase: 0, index: 0, quarter: 0, limit: 1, key: 'blur', labels: [], hover: null };
    const pm = pureNow;
    const strings = cycleStrings(frame, lv);
    const limit = phaseLimit(model, sel, lv.cycle);
    // the first boundary still ahead that exists in the catalogue
    let nextIdx = -1;
    for (let i = lv.quarter + 1; i <= 4; i++) {
      if (strings.times[i] !== null) {
        nextIdx = i;
        break;
      }
    }
    const labels = BOUNDARIES.map((name, i) => {
      const p = strings.parts[i];
      return {
        name,
        date: p ? p.date : '—',
        time: p ? p.time : '',
        // pure mode: a shorter coordinate for plots too narrow for five long ones
        alt: pm && p ? strings.alt[i] : undefined,
        passed: strings.times[i] !== null && i <= lv.quarter,
        next: i === nextIdx,
        in: i === nextIdx ? (pm ? PT.inText(P, frame.t, strings.times[i]) : fmt.countdown(strings.times[i] - frame.t)) : '',
      };
    });
    let hoverState = null;
    if (waveHover !== null && !scrubbing) {
      const t = timeAtPhase(model, sel, lv.cycle, Math.min(waveHover, limit));
      const text = pm ? (t === null ? '—' : PT.pointerText(P, model, sel, t)) : compactText(t === null ? null : whenParts(fmt, t, lv.duration, { compact: true, refYear: strings.refYear }));
      hoverState = { phase: Math.min(waveHover, limit), text };
    }
    return {
      inRange: true,
      level: sel,
      M,
      phase: lv.phase,
      index: lv.index,
      quarter: lv.quarter,
      limit,
      key: `${strings.key}`,
      labels,
      hover: hoverState,
      scrubbing,
      focused: waveFocused,
    };
  }

  // ------------------------------------------------------------------------------------------
  // tooltip
  // ------------------------------------------------------------------------------------------
  function tipHTML() {
    if (!hover || !view.inRange) return '';
    const i = hover.ring;
    const L = view.levels[i];
    const info = view.infos[i];
    const lv = view.readings[i];
    if (L === undefined || !lv) return '';
    const frame = view.frame;
    const pm = pureNow;
    const color = theme.levelColor(L, 1, 72);
    const touch = !!hoverPointer?.touch;
    const click = touch ? 'Tap' : 'Click';
    if (lv.stub) {
      return `<div class="rings-tip-h"><b style="color:${color}">${esc(levelTag(info))}</b><span class="dim">about ${esc(pm ? PT.aboutTurn(P, info) : fmt.duration(info.meanSeconds))} per cycle</span></div><div class="rings-tip-row dim">Too fast to follow at this speed: drawn as a glow</div><div class="rings-tip-hint">${click} to select this ring</div>`;
    }
    const head = pm
      ? `<div class="rings-tip-h"><b style="color:${color}">${esc(PT.cycleName(P, L, lv))}</b><span class="dim">${esc(cycleTag(info, lv))}</span></div><div class="rings-tip-row rings-tip-phase"><span aria-hidden="true">phase</span> ${P.pairHTML(lv.phase, { label: 'phase' })}</div>`
      : `<div class="rings-tip-h"><b style="color:${color}">${esc(cycleTag(info, lv))}</b><span class="dim">${esc(percentText(lv.phase))} through this cycle</span></div>`;
    const ends = `<div class="rings-tip-row dim">${lv.clipped ? 'catalogue ends' : 'ends'} in ${esc(pm ? PT.between(P, frame.t, lv.end) : countdownBody(fmt, lv.remaining))}</div>`;
    if (hover.label) {
      return `${head}${ends}<div class="rings-tip-hint">${click} to select this ring</div>`;
    }
    const j = hover.sector;
    const ch = j === null || j === undefined ? null : childCycle(model, L, lv.cycle, j);
    const cInfo = model.levelInfo(Math.min(13, L + 1));
    let body = '';
    if (ch) {
      const span = ch.duration;
      const running = frame.t >= ch.start && frame.t < ch.end;
      const hint = `<div class="rings-tip-hint">${touch ? (running ? 'Tap again to jump back to its start' : 'Tap again to jump to its start') : running ? (L === view.sel ? 'Click to jump back to its start' : 'Click to select this ring') : 'Click to jump to its start'}</div>`;
      if (pm) {
        // the child is named, then what follows it; spans and distances are counted on the ladder
        const follower = PT.followerName(P, model, ch.level, { cycle: ch.index, clipped: ch.clipped, end: ch.end });
        body =
          `<div class="rings-tip-sep"></div>` +
          `<div class="rings-tip-h"><b style="color:${theme.levelColor(L + 1, 1, 72)}">${esc(P.cycleName(ch.level, ch.index))}</b><span class="dim">child · ${esc(cInfo.letter)} ${cInfo.depth} · ${j + 1}/${info.factor}</span></div>` +
          `<div class="rings-tip-row mono">${esc(follower ? `ends → ${follower} begins` : 'the catalogue ends here')}</div>` +
          `<div class="rings-tip-row dim">lasts ${esc(PT.lengthText(P, ch.level, ch))} · ${esc(PT.startPhrase(P, ch.start, ch.end, frame.t))}</div>` +
          hint;
      } else {
        body =
          `<div class="rings-tip-sep"></div>` +
          `<div class="rings-tip-h"><b style="color:${theme.levelColor(L + 1, 1, 72)}">${esc(cInfo.letter)} ${cInfo.depth} · ${j + 1}/${info.factor}</b><span class="dim">child cycle</span></div>` +
          `<div class="rings-tip-row mono">${esc(whenText(fmt, ch.start, span))}</div>` +
          `<div class="rings-tip-row mono">→ ${esc(whenText(fmt, ch.end, span))}${ch.clipped ? ' (catalogue end)' : ''}</div>` +
          `<div class="rings-tip-row dim">lasts ${esc(fmt.duration(span))} · ${esc(startPhrase(fmt, ch.start, ch.end, frame.t))}</div>` +
          hint;
      }
    } else if (j !== null && j !== undefined) {
      body = `<div class="rings-tip-sep"></div><div class="rings-tip-row dim">${L >= 13 ? 'Finer than the dial shows' : 'Beyond the end of the catalogue'}</div><div class="rings-tip-hint">${click} to select this ring</div>`;
    }
    return head + ends + body;
  }
  function placeTip() {
    if (!hoverPointer || tip.hidden) return;
    const pad = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = hoverPointer.x + pad;
    let y = hoverPointer.y + pad + 4;
    if (hoverPointer.touch) {
      // a finger covers what is below it: show the tip above the touch point
      x = clamp(hoverPointer.x - w / 2, 8, window.innerWidth - w - 8);
      y = hoverPointer.y - h - 28;
      if (y < 8) y = hoverPointer.y + 36;
    } else {
      if (x + w > window.innerWidth - 8) x = hoverPointer.x - w - pad;
      if (y + h > window.innerHeight - 8) y = hoverPointer.y - h - pad;
    }
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  function refreshTip(force) {
    const html = tipHTML();
    if (!html) {
      if (!tip.hidden) tip.hidden = true;
      return;
    }
    if (force || memo.get(tip)?.h !== html) {
      tip.innerHTML = html;
      memo.set(tip, { h: html });
    }
    if (tip.hidden) tip.hidden = false;
    placeTip();
  }

  // ------------------------------------------------------------------------------------------
  // dial pointer interaction
  // ------------------------------------------------------------------------------------------
  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    const k = r.width ? dial.size / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }
  function resolveHit(e) {
    const { x, y } = localXY(e);
    const h = dial.pick(x, y);
    if (!h || h.zone !== 'ring' || !view.inRange) return null;
    const info = view.infos[h.ring];
    if (!info) return null;
    const sector = h.label || view.readings[h.ring]?.stub ? null : sectorOf(h.phase, info.factor);
    return { ring: h.ring, sector, label: !!h.label };
  }
  function sameHover(a, b) {
    return (!a && !b) || (a && b && a.ring === b.ring && a.sector === b.sector && a.label === b.label);
  }
  function childFor(h) {
    if (!h || h.sector === null) return null;
    const lv = view.readings[h.ring];
    if (!lv || lv.stub) return null;
    return childCycle(model, view.levels[h.ring], lv.cycle, h.sector);
  }
  function setCursor(h) {
    let c = 'default';
    if (h) c = h.label || childFor(h) ? 'pointer' : 'default';
    if (canvas.style.cursor !== c) canvas.style.cursor = c;
  }

  // Touch has no hover: the first tap on a sector selects its ring and shows what a second tap would do
  // (the same tooltip the mouse gets); only that second tap jumps. A tap elsewhere, a scroll or time dismisses it.
  let pointerKind = 'mouse';
  let preview = null; // {ring, sector} shown by a touch tap
  let previewAt = 0;
  function clearPreview() {
    if (!preview) return;
    preview = null;
    hover = null;
    tip.hidden = true;
    own = true;
  }
  /** Show what is under a touch (select its ring, open the tooltip above the finger); a second tap on a sector then jumps. */
  function openPreview(h, clientX, clientY) {
    preview = { ring: h.ring, sector: h.sector };
    previewAt = performance.now();
    hover = h;
    hoverPointer = { x: clientX, y: clientY, touch: true };
    if (view.levels[h.ring] !== view.sel) ctx.select(view.levels[h.ring]);
    own = true;
    refreshTip(true);
  }
  // Tap and hold: the tooltip without a second tap, and without the jump a second tap would make.
  let hold = null; // {id, x, y, timer} a touch that may still turn into a hold
  let held = false; // the touch in progress has become a hold: the click that ends it is not a tap
  function cancelHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    pointerKind = e.pointerType || 'mouse';
    held = false;
    cancelHold();
    if (pointerKind !== 'touch' || !e.isPrimary) return;
    const h0 = { id: e.pointerId, x: e.clientX, y: e.clientY };
    hold = {
      ...h0,
      timer: setTimeout(() => {
        hold = null;
        const h = resolveHit({ clientX: h0.x, clientY: h0.y });
        if (!h) return;
        held = true;
        openPreview(h, h0.x, h0.y);
      }, HOLD_MS),
    };
  });
  canvas.addEventListener('pointerup', cancelHold);
  canvas.addEventListener('pointercancel', cancelHold);
  // a long press would otherwise open the system's context menu over the tooltip
  canvas.addEventListener('contextmenu', (e) => {
    if (pointerKind === 'touch') e.preventDefault();
  });
  const onDocPointerDown = (e) => {
    if (preview && !canvas.contains(e.target) && !tip.contains(e.target)) clearPreview();
  };
  document.addEventListener('pointerdown', onDocPointerDown, true);
  window.addEventListener('scroll', clearPreview, { passive: true });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (hold && hold.id === e.pointerId && holdSlipped(e.clientX - hold.x, e.clientY - hold.y)) cancelHold();
      return;
    }
    const h = resolveHit(e);
    hoverPointer = { x: e.clientX, y: e.clientY };
    if (!sameHover(h, hover)) {
      hover = h;
      own = true;
      setCursor(h);
      refreshTip(true);
    } else if (hover) {
      placeTip();
    }
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return; // a lifted finger "leaves": the preview stays until dismissed
    if (hover) {
      hover = null;
      own = true;
      setCursor(null);
    }
    tip.hidden = true;
  });
  canvas.addEventListener('click', (e) => {
    if (held) {
      held = false;
      return;
    }
    const h = resolveHit(e);
    if (!h) return clearPreview();
    const L = view.levels[h.ring];
    const ch = h.label ? null : childFor(h);
    const lv = view.readings[h.ring];
    const intent = dialIntent({
      label: h.label,
      hasChild: !!ch,
      running: !!lv && !lv.stub && sectorOf(lv.phase, view.infos[h.ring].factor) === h.sector,
      ringSelected: L === view.sel,
      touch: pointerKind === 'touch',
      previewed: !!preview && preview.ring === h.ring && preview.sector === h.sector,
    });
    if (intent === 'preview') {
      openPreview(h, e.clientX, e.clientY);
      return;
    }
    clearPreview();
    if (L !== view.sel) ctx.select(L);
    if (intent === 'goto' || intent === 'select+goto') ctx.goto(ch.start + 0.001, 'ring');
  });

  // keyboard on the dial: arrows change the ring while the view is in use
  function onDocKey(e) {
    if (!active || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && t !== document.body && !el.contains(t)) return;
    if (t?.closest?.('[role="tab"], [role="slider"], input, select, textarea, [contenteditable="true"]')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (e.key === 'ArrowUp' && t !== wrap) return;
      selectRelative(-1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (e.key === 'ArrowDown' && t !== wrap) return;
      selectRelative(+1);
      e.preventDefault();
    } else if (t === wrap && e.key === 'Home') {
      ctx.select(range().minL);
      e.preventDefault();
    } else if (t === wrap && e.key === 'End') {
      ctx.select(range().maxL);
      e.preventDefault();
    } else if (t === wrap && (e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Enter')) {
      jumpChild(e.key === 'Enter' ? 0 : e.key === 'PageUp' ? 1 : -1);
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onDocKey);

  // buttons
  nodes.prev.addEventListener('click', () => {
    if (!view.inRange) return ctx.goto(model.tMin + 0.001, 'edge');
    ctx.stepCycle(-1);
  });
  nodes.next.addEventListener('click', () => {
    if (!view.inRange) return ctx.goto(model.tMax - 0.001, 'edge');
    ctx.stepCycle(+1);
  });
  /**
   * Go just past a threshold instant of the selected cycle, forwards or (a passed quarter) back to it. Only the
   * catalogue's closing instant is a dead end: say so there, and nowhere else.
   */
  function goPast(t) {
    const jump = thresholdJump(model, t, store.t());
    if (jump.kind === 'end') return ctx.toast('End of the catalogue');
    if (jump.time !== null) ctx.goto(jump.time, 'threshold');
  }
  nodes.thr.addEventListener('click', () => {
    const lv = view.selLv;
    if (lv && lv.next.time !== null) goPast(lv.next.time);
  });
  chipsBox.addEventListener('click', (e) => {
    const b = e.target.closest('.rings-chip');
    const lv = view.selLv;
    if (!b || !lv) return;
    const t = lv.thresholds[Number(b.dataset.q) + 1]?.time;
    if (t !== null && t !== undefined) goPast(t);
  });

  // ring picker (compact dials: the rings are too thin to hit and too small to read, so each gets a real button)
  let pickerKey = '';
  function syncPicker(levels, sel) {
    const key = levels.join(',');
    if (key !== pickerKey) {
      pickerKey = key;
      picker.innerHTML = levels
        .map((L) => {
          const inf = model.levelInfo(L);
          return `<button type="button" class="rings-pick" data-level="${L}" style="--c:${theme.levelColor(L, 1, 70)}" aria-label="Select ring ${esc(levelTag(inf))}"><i aria-hidden="true"></i>${esc(inf.letter)}<span class="mono">${inf.depth}</span></button>`;
        })
        .join('');
    }
    for (const b of picker.children) setAttr(b, 'aria-pressed', String(Number(b.dataset.level) === sel));
  }
  picker.addEventListener('click', (e) => {
    const b = e.target.closest('.rings-pick');
    if (b) ctx.select(Number(b.dataset.level));
  });
  offDial.addEventListener('click', () => {
    store.set(widenRangeTo(range(), normLevel(store.state.selectedLevel)));
    own = true;
  });

  /** Keyboard route to the sectors: Enter restarts the running child cycle of the selected ring, PgUp / PgDn step it. */
  function jumpChild(dir) {
    const L = view.sel;
    const lv = view.selLv;
    if (!view.inRange || !lv || L >= 13) return;
    if (dir === 0) {
      const ch = childCycle(model, L, lv.cycle, sectorOf(lv.phase, view.selInfo.factor));
      if (ch) ctx.goto(ch.start + 0.001, 'ring');
    } else {
      ctx.stepCycle(dir, L + 1);
    }
    const now = model.levelAt(store.t(), L + 1);
    if (now && store.t() - now.start < 0.01) {
      announce(
        pureNow
          ? `Jumped to the start of ${PT.cycleName(P, L + 1, now)}, ${cycleTag(model.levelInfo(L + 1), now)}`
          : `Jumped to the start of ${cycleTag(model.levelInfo(L + 1), now)}, ${fmt.long(now.start)}`,
      );
    }
  }
  /** Screen-reader note (polite live region). */
  function announce(text) {
    liveNote.textContent = '';
    liveNote.textContent = text;
  }

  // ------------------------------------------------------------------------------------------
  // waveform interaction: scrub time inside the selected cycle
  // ------------------------------------------------------------------------------------------
  function waveX(e) {
    const r = waveCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function scrubTo(phase, { snap = false } = {}) {
    const lv = view.selLv;
    if (!lv) return;
    const t = scrubTime(model, view.sel, scrubCycle ?? lv.cycle, phase, { snap });
    if (t !== null) ctx.goto(t, 'scrub');
  }
  const waveBlurred = () => isBlur(view.selInfo, view.speed);
  function beginScrub(e, x) {
    waveCanvas.focus({ preventScroll: true });
    try {
      waveCanvas.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    scrubbing = true;
    scrubCycle = view.selLv.cycle;
    waveHover = null;
    scrubTo(wave.phaseAtX(x));
    own = true;
  }
  // A touch on the wave is ambiguous: it may be the start of a page scroll (the wave is full width on a phone).
  // So a finger scrubs only once it has moved sideways; a vertical swipe is left to the browser (it cancels the
  // pointer) and a touch that lifts without moving is a tap that sets the time once.
  let touchStart = null; // {id, cx, cy, x}
  waveCanvas.addEventListener('pointerdown', (e) => {
    if (!view.selLv || e.button > 0 || waveBlurred()) return;
    const { x, y } = waveX(e);
    if (!wave.inPlot(x, y)) return;
    if (e.pointerType === 'touch') {
      touchStart = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x };
      return;
    }
    e.preventDefault();
    beginScrub(e, x);
  });
  waveCanvas.addEventListener('pointermove', (e) => {
    const { x, y } = waveX(e);
    if (touchStart && touchStart.id === e.pointerId) {
      const dx = e.clientX - touchStart.cx;
      const dy = e.clientY - touchStart.cy;
      if (isHorizontalDrag(dx, dy) && view.selLv) {
        touchStart = null;
        beginScrub(e, x);
      }
      return;
    }
    if (scrubbing) {
      scrubTo(wave.phaseAtX(x));
      return;
    }
    const h = e.pointerType !== 'touch' && !waveBlurred() && wave.inPlot(x, y) ? wave.phaseAtX(x) : null;
    if (h !== waveHover) {
      waveHover = h;
      own = true;
    }
    const c = h === null ? 'default' : 'ew-resize';
    if (waveCanvas.style.cursor !== c) waveCanvas.style.cursor = c;
  });
  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    scrubCycle = null;
    try {
      waveCanvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    own = true;
  };
  waveCanvas.addEventListener('pointerup', (e) => {
    if (touchStart && touchStart.id === e.pointerId) {
      const { x } = touchStart;
      touchStart = null;
      if (view.selLv && !waveBlurred()) {
        waveCanvas.focus({ preventScroll: true });
        scrubCycle = view.selLv.cycle;
        scrubTo(wave.phaseAtX(x));
        scrubCycle = null;
        own = true;
      }
      return;
    }
    endScrub(e);
  });
  waveCanvas.addEventListener('pointercancel', (e) => {
    if (touchStart && touchStart.id === e.pointerId) touchStart = null; // the browser took it for a scroll
    endScrub(e);
  });
  waveCanvas.addEventListener('pointerleave', () => {
    if (waveHover !== null) {
      waveHover = null;
      own = true;
    }
  });
  waveCanvas.addEventListener('focus', () => {
    waveFocused = true;
    own = true;
  });
  waveCanvas.addEventListener('blur', () => {
    waveFocused = false;
    own = true;
  });
  waveCanvas.addEventListener('keydown', (e) => {
    if (!view.selLv || waveBlurred() || e.metaKey || e.ctrlKey || e.altKey) return;
    // read the clock now: key repeats can arrive between two frames
    const lv = model.levelAt(store.t(), view.sel) ?? view.selLv;
    const states = 4 * M;
    const quarterPrev = () => (lv.phase - lv.quarter * 0.25 > 0.004 ? lv.quarter : lv.quarter - 1) * 0.25;
    const quarterNext = () => (lv.quarter + 1) * 0.25;
    let target;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        target = e.shiftKey ? quarterPrev() : (lv.index - 1) / states;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        target = e.shiftKey ? quarterNext() : (lv.index + 1) / states;
        break;
      case 'PageDown':
        target = quarterPrev();
        break;
      case 'PageUp':
        target = quarterNext();
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    scrubTo(target, { snap: true });
  });

  // ------------------------------------------------------------------------------------------
  // reduced motion
  // ------------------------------------------------------------------------------------------
  const onReduce = (e) => {
    reduced = e.matches;
    own = true;
    dial.invalidate();
  };
  reduceQuery?.addEventListener?.('change', onReduce);

  // ------------------------------------------------------------------------------------------
  // frame
  // ------------------------------------------------------------------------------------------
  /**
   * The mode changed (header button, key P, ?pure=1): rebuild every static text, drop every cached string and
   * everything that was said in the other vocabulary, so nothing stale is left behind in either direction.
   */
  function applyMode(pureMode) {
    root.dataset.pure = pureMode ? '1' : '';
    if (!pureMode) delete root.dataset.pure;
    helpList.innerHTML = helpHTML(pureMode);
    cache = { key: '', times: [], parts: [], alt: null, chip: [], facts: null, refYear: 0 };
    lastTextKey = '';
    clearPreview();
    hover = null;
    waveHover = null;
    tip.hidden = true;
    memo.delete(tip);
    liveNote.textContent = '';
    dial.invalidate();
    wave.invalidate();
    own = true;
  }
  applyMode(pureNow);

  function render(frame, info) {
    const pm = isPure();
    if (pm !== pureNow) {
      pureNow = pm;
      applyMode(pm);
    }
    // pixel ratio changes (zoom, moving between screens)
    const d = dpr();
    if (d !== lastDpr) {
      lastDpr = d;
      syncDialSize();
      syncWaveSize();
    }
    if (!wave.layout) syncWaveSize();
    if (preview && performance.now() - previewAt > 8000) clearPreview();

    const dirty = info.dirty || own;
    if (!dirty && !scrubbing) return;
    own = false;

    if (prof.on) prof.t0 = performance.now();
    const st = store.state;
    const levels = shownLevels();
    const inRange = frame.inRange;
    // exactly at the catalogue end the model reports the (non-existent) next cycle for levels that tile it:
    // read the last instant of the last cycle instead
    const src = inRange && frame.t >= model.tMax ? model.frame(model.tMax - 0.001) : frame;
    const infos = levels.map((L) => model.levelInfo(L));
    const sel = normLevel(st.selectedLevel);
    // rings that would only strobe get a glow, so their exact (BigInt) reading is not even requested
    const speed = store.live ? 1 : store.playing ? Math.abs(store.rate) : 0; // displayed s per real s
    const blur = infos.map((inf) => isBlur(inf, speed));
    const readings = levels.map((L, i) => (!inRange ? null : blur[i] && L !== sel ? BLUR_STUB : src.level(L)));
    view = {
      frame,
      speed,
      inRange,
      levels,
      infos,
      readings,
      sel,
      selLv: inRange ? src.level(sel) : null,
      selInfo: model.levelInfo(sel),
    };

    // toolbar
    const { minL, maxL } = range();
    setText(nodes.outMin, `${model.levelInfo(minL).letter} ${minL + 1}`);
    setText(nodes.outMax, `${model.levelInfo(maxL).letter} ${maxL + 1}`);
    for (const b of stepBtns) {
      const [which, dd] = b.dataset.step.split(':');
      const off = which === 'min' ? (dd === '-1' ? minL <= 0 : minL >= maxL) : dd === '-1' ? maxL <= minL : maxL >= 13;
      setAttr(b, 'disabled', off);
    }
    for (const b of toggleBtns) setAttr(b, 'aria-pressed', String(!!prefs[b.dataset.toggle]));
    // the selection is shared with the other views and may lie outside the rings shown: say so, and offer to show it
    const offDialNow = sel < minL || sel > maxL;
    setAttr(offDial, 'hidden', !offDialNow);
    if (offDialNow) setText(offDial, `${levelTag(view.selInfo)} is not on the dial · show it`);
    syncPicker(levels, offDialNow ? -1 : sel);

    const p0 = prof.on ? performance.now() : 0;
    if (!dial.layout || dial.layout.count !== levels.length) syncDialSize();
    dial.draw({
      levels,
      infos,
      readings,
      inRange,
      selected: sel,
      show: prefs,
      hover: hover && hover.ring < levels.length ? { ring: hover.ring, sector: hover.label ? null : hover.sector } : null,
      reduced,
      speed,
      blur,
      epoch,
      nowMs: performance.now(),
    });

    const p1 = prof.on ? performance.now() : 0;
    // a selected cycle too fast to follow would make the large digits strobe: refresh them at 4 Hz and dim them
    const selBlur = inRange && isBlur(view.selInfo, speed);
    const textKey = `${sel}|${inRange}|${pm ? `pure${compactNow ? 'c' : ''}` : fmt.zone()}|${selBlur}`;
    const nowT = performance.now();
    if (!selBlur || textKey !== lastTextKey || nowT - lastTextAt >= 250) {
      lastTextKey = textKey;
      lastTextAt = nowT;
      updateReadout(frame);
      updateInset(frame);
    }
    setClass(root, 'is-fast', selBlur);
    if (announceSel) {
      announceSel = false;
      const slv = view.selLv;
      if (slv) {
        const pwd = phaseWord(slv.index, slv.derivative, M).word.toLowerCase();
        announce(
          pm
            ? `Selected ${PT.cycleName(P, sel, slv)}, ${cycleTag(view.selInfo, slv)}, ${pwd}, ${slv.clipped ? 'the catalogue ends' : 'ends'} in ${PT.between(P, frame.t, slv.end)}`
            : `Selected ${cycleTag(view.selInfo, slv)}, ${pwd}, ${slv.clipped ? 'the catalogue ends' : 'ends'} in ${countdownBody(fmt, slv.remaining)}`,
        );
      }
    }
    const p2 = prof.on ? performance.now() : 0;
    const ws = waveState(frame);
    wave.draw(ws);
    updateWaveCountdown(ws);
    if (prof.on) {
      const p3 = performance.now();
      prof.frames++;
      prof.dial += p1 - p0;
      prof.text += p2 - p1;
      prof.wave += p3 - p2;
      prof.read += p0 - prof.t0;
    }

    if (hover) {
      const now = performance.now();
      if (now - tipAt > 250) {
        tipAt = now;
        refreshTip(false);
      }
    }
    setAttr(
      wrap,
      'aria-label',
      `Concentric cycle dial, rings ${levelTag(model.levelInfo(minL))} to ${levelTag(model.levelInfo(maxL))}. Selected ${levelTag(view.selInfo)}${pm && view.selLv ? `, ${PT.cycleName(P, sel, view.selLv)}` : ''}. Left and right arrow keys change the ring; Page Up and Page Down jump to the next or previous child cycle, Enter to the start of the running one.`,
    );
  }

  // ------------------------------------------------------------------------------------------
  const unsub = store.subscribe((kind, patch) => {
    own = true;
    if (kind === 'time') epoch++;
    else if (patch && 'selectedLevel' in patch) announceSel = active;
  });

  return {
    render,
    setActive(on) {
      active = !!on;
      announceSel = false;
      if (on) {
        dial.invalidate();
        wave.invalidate();
        own = true;
        ctx.requestRender();
      } else {
        tip.hidden = true;
        hover = null;
        preview = null;
      }
    },
    destroy() {
      roWrap.disconnect();
      roWave.disconnect();
      unsub();
      cancelHold();
      document.removeEventListener('keydown', onDocKey);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      window.removeEventListener('scroll', clearPreview);
      reduceQuery?.removeEventListener?.('change', onReduce);
      tip.remove();
    },
    /** Debug hook: accumulate per-part render costs (ms) while `on`. */
    profile(on) {
      if (on) Object.assign(prof, { on: true, frames: 0, dial: 0, text: 0, wave: 0, read: 0 });
      else prof.on = false;
      return { ...prof, dialMs: prof.dial, dial: { ...dial.stats } };
    },
    /** Debug / test hook: the state the last frame was drawn from. */
    inspect() {
      return {
        selected: view.sel,
        levels: view.levels,
        compact: compactNow,
        hover,
        scrubbing,
        prefs: { ...prefs },
        layout: dial.layout && {
          size: dial.layout.size,
          cx: dial.layout.cx,
          cy: dial.layout.cy,
          rOuter: dial.layout.rOuter,
          rHole: dial.layout.rHole,
          band: dial.layout.band,
          rings: dial.layout.rings.map((r) => ({ ...r })),
        },
        wave: wave.layout && { x0: wave.layout.x0, x1: wave.layout.x1, y0: wave.layout.y0, y1: wave.layout.y1 },
        phases: view.readings.map((r) => (r ? r.phase : null)),
        shown: dial.shown,
        reduced,
      };
    },
  };
}

function helpIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3M8 11.3v.1"/></svg>';
}
function minusIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h8"/></svg>';
}
function plusIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h8M8 4v8"/></svg>';
}
