/**
 * Clock face module: the Zepp watch face of SPEC §8-§10 as inline SVG.
 *
 *   top period odometer (depth D, level D-1)   teal, 2 glyphs of 2 strokes
 *   solar sync odometer                        gold, 3 glyphs of 2 strokes
 *   bottom period odometer (depth D+1)         teal
 *   sibling counters on arcs, period letters and info labels in the gaps
 *
 * Web affordances on top of the spec: teaching tooltips, row selection (shared across
 * views), four buttons mirroring the gestures, a "how to read" popover and keyboard
 * control. All clock readings come from ctx.model; the DOM is only touched when a value
 * changed, so a still screen costs a handful of string compares per frame.
 */
import {
  LETTER_MS,
  INFO_MS,
  MIN_TOP_DEPTH,
  MAX_TOP_DEPTH,
  clampDepth,
  stepDepth,
  levelsFor,
  hitTest,
  stateInfo,
  overlayMode,
  middleTap,
  thresholdCaption,
  periodTooltip,
  solarTooltip,
  regionHint,
  rowAriaLabel,
  infoSpeech,
  layoutFit,
} from './face/helpers.js';
import { createGlyphBook } from './face/glyphs.js';
import { createScreen } from './face/screen.js';
import { createTooltip } from './face/tooltip.js';
import { buildHowTo, fillHowTo } from './face/howto.js';
import { pureInfoLabels, pureInfoSpeech, pureTooltipModel, pureRowAriaLabel, pureCaption, letterName, pureRange, PURE_SOLAR_NA, CAPTION_NOTE } from './face/pure.js';

let uidSeq = 0;
const OOR_LABEL = 'Fractonica clock face: outside the Saros 141 catalogue, no reading';
const SOLAR_NA_LABEL = 'Solar sync unavailable within three days of the catalogue ends';
/** Pointer movement below this keeps a gesture hint on screen. */
const HINT_JITTER_PX = 6;

const icon = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  longer: icon('<path d="M3.5 10.5L8 5.5l4.5 5"/>'),
  shorter: icon('<path d="M3.5 5.5L8 10.5l4.5-5"/>'),
  info: icon('<circle cx="8" cy="8" r="5.6"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5.1" r=".5" fill="currentColor"/>'),
  letters: '<span class="face-aa" aria-hidden="true">Aα</span>',
  help: icon('<circle cx="8" cy="8" r="5.6"/><path d="M6.3 6.4a1.8 1.8 0 1 1 2.5 1.7c-.5.3-.8.6-.8 1.3"/><circle cx="8" cy="11.3" r=".5" fill="currentColor"/>'),
};

function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function mount(el, ctx) {
  const { model, store, fmt, theme } = ctx;
  const pure = ctx.pure;
  /** Pure mode: Fractonica terms only (docs/design/80-pure.md). Read live, so an event between two frames already speaks the new mode. */
  const isPure = () => !!pure && !!store.state.pure;
  const uid = ++uidSeq;
  const glyphBook = createGlyphBook(ctx.F);
  const screen = createScreen({ glyphBook, uid });
  const svg = screen.svg;

  // ---- DOM ------------------------------------------------------------------------------
  el.textContent = '';
  el.classList.add('face-root');
  const wrap = h('div', 'face-wrap');
  const stage = h('div', 'face-stage');
  stage.append(svg);

  const caption = h('div', 'face-caption mono');
  caption.setAttribute('aria-hidden', 'true');

  const controls = h('div', 'face-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Face controls');
  const btn = (act, label, ic, title) => {
    const b = h('button', 'btn face-btn');
    b.type = 'button';
    b.dataset.act = act;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = `${ic}<span>${label}</span>`;
    return b;
  };
  const bLonger = btn('longer', 'Longer', ICONS.longer, 'Longer period (↑)');
  const bShorter = btn('shorter', 'Shorter', ICONS.shorter, 'Shorter period (↓)');
  const bInfo = btn('info', 'Info', ICONS.info, 'Show info labels (i)');
  const bLetters = btn('letters', 'Letters', ICONS.letters, 'Keep period letters on screen (l)');
  bLetters.setAttribute('aria-pressed', 'false');
  controls.append(bLonger, bShorter, bInfo, bLetters);

  const foot = h('div', 'face-foot');
  const bHelp = h('button', 'btn btn-sm face-help');
  bHelp.type = 'button';
  bHelp.innerHTML = `${ICONS.help}<span>How to read</span>`;
  bHelp.setAttribute('aria-label', 'How to read the clock face'); // distinct from the Rings panel's own "How to read"
  bHelp.setAttribute('aria-expanded', 'false');
  const depths = h('span', 'face-depths mono dim');
  foot.append(bHelp, depths);

  const pop = buildHowTo({ glyphBook, id: `face-pop-${uid}`, pure: isPure(), pairHTML: pure?.pairHTML });
  bHelp.setAttribute('aria-controls', pop.id);
  const status = h('div', 'sr-only');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  wrap.append(stage, caption, controls, foot, pop, status);
  el.append(wrap);
  const tooltip = createTooltip(wrap, { id: `face-tip-${uid}` });

  // ---- state ----------------------------------------------------------------------------
  const ui = {
    depth: null,
    infoUntil: 0,
    lettersUntil: performance.now() + LETTER_MS, // a short orientation on load
    lastTap: null,
    dirty: true,
    mode: '',
    tip: null, // {row, at:{x,y}|{rect}, stamp, kind: 'hover'|'focus'|'touch'}
    hint: null, // {region, x, y}: the gesture hint pending or shown for a resting pointer
    tipEl: null, // the row element a focus tooltip describes (aria-describedby)
    regionTimer: 0, // delay before a resting pointer shows its region hint
    holdTimer: 0, // touch: press-and-hold detection
    tipTimer: 0, // touch: auto-hide of a held tooltip
    labelKey: '',
    selKey: '',
    caption: '',
    dpr: 0,
    pure: null, // the mode the DOM was last written for (null = never)
    live: null,
    letters: null,
    lastFrame: null,
    inRange: true,
    solarOk: true,
    cycleKey: '',
  };
  const levels = () => levelsFor(store.state.topDepth);
  const say = (msg) => {
    status.textContent = '';
    requestAnimationFrame(() => (status.textContent = msg));
  };
  const letterOf = (level) => model.levelInfo(level).letter;
  /** The solar reading, or null within ~3 days of the catalogue ends where the sync cycle would leave the data. */
  const solarOf = (frame) => {
    try {
      return frame.solar();
    } catch {
      return null;
    }
  };
  const depthWords = (d) => `depth ${d} ${letterOf(d - 1)}`;

  // ---- actions ---------------------------------------------------------------------------
  /** Step the top depth; returns false (after a hint) when already at the end of the range. */
  function changeDepth(dir) {
    const cur = clampDepth(store.state.topDepth);
    const next = stepDepth(cur, dir);
    if (next === cur) return false;
    store.set({ topDepth: next });
    ui.lettersUntil = performance.now() + LETTER_MS;
    ui.dirty = true;
    // a gesture hint ("top becomes depth 6") describes the old state; row tooltips refresh themselves
    if (tooltip.visible && !ui.tip) hideTip();
    ctx.requestRender();
    return true;
  }
  const blockedMessage = (dir) =>
    dir < 0 ? `Depth ${MIN_TOP_DEPTH} (${letterOf(MIN_TOP_DEPTH - 1)}) is the longest period the face shows` : `Depth ${MAX_TOP_DEPTH} over ${MAX_TOP_DEPTH + 1} is the shortest pair the face shows`;
  function stepOrHint(dir) {
    const ok = changeDepth(dir);
    if (!ok) ctx.toast(blockedMessage(dir));
    return ok;
  }
  function showInfo() {
    ui.infoUntil = performance.now() + INFO_MS;
    ui.dirty = true;
    ctx.requestRender();
    // the labels are aria-hidden SVG text: say the same content for screen readers
    const f = ui.lastFrame ?? model.frame(store.t());
    const lTop = f?.inRange ? f.level(levels().top) : null;
    if (lTop) {
      const m = infoLabels(f, lTop, solarOf(f));
      say(m.pure ? pureInfoSpeech(m) : infoSpeech(m));
    }
  }
  function toggleLetters() {
    ui.infoUntil = 0;
    store.set({ showLetters: !store.state.showLetters });
    ui.dirty = true;
    ctx.requestRender();
  }
  function selectRow(row) {
    const lv = levels();
    const level = row === 'top' ? lv.top : lv.bottom;
    ctx.select(level);
    say(`Selected ${depthWords(level + 1)}`);
  }
  /** Enter / Space / a plain click event (assistive technology) on a glyph row. */
  const activateRow = (row) => (row === 'solar' ? showInfo() : selectRow(row));

  // ---- tooltips ----------------------------------------------------------------------------
  function tooltipModel(row, frame, kind) {
    if (!frame?.inRange) return null;
    if (isPure()) return pureTooltipModel({ model, pure, frame, row, topDepth: store.state.topDepth, by: kind === 'focus' ? 'key' : 'pointer' });
    const t = frame.t;
    if (row === 'solar') {
      const s = solarOf(frame);
      if (!s) return { title: 'Solar sync', aside: '', lines: ['The 4-day sync around this instant runs past the Saros 141 catalogue, so it is not defined here.'], hint: '' };
      return solarTooltip({ sync: s.sync, phase: s.phase, drift: s.drift, thresholdName: s.threshold.name, thresholdTime: s.threshold.time, start: s.start, now: t, by: kind === 'focus' ? 'key' : 'pointer' }, fmt);
    }
    const level = row === 'top' ? levels().top : levels().bottom;
    const info = model.levelInfo(level);
    const lv = frame.level(level);
    const od = frame.odometer(level);
    if (!lv || !od) return null;
    const major = model.odometerAt(t, level, { digits: 1 });
    // a pointer click on a row also steps the depth (SPEC §10: the row lies inside the top / bottom tap region)
    const dir = row === 'top' ? -1 : 1;
    const cur = clampDepth(store.state.topDepth);
    return periodTooltip(
      {
        letter: info.letter,
        depth: info.depth,
        meanSeconds: info.meanSeconds,
        state: stateInfo(od.digits[0]),
        fineIndex: od.digits[1],
        fineNext: od.nextTime,
        majorNext: major?.nextTime ?? null,
        cycleEnd: lv.end,
        local: lv.local,
        siblings: lv.siblings,
        parentLetter: level > 0 ? letterOf(level - 1) : null,
        now: t,
        by: kind === 'focus' ? 'key' : 'pointer',
        step: stepDepth(cur, dir) === cur ? 0 : dir,
      },
      fmt,
    );
  }
  const accentOf = (row) => (row === 'solar' ? 'var(--gold)' : theme.levelColor(row === 'top' ? levels().top : levels().bottom));

  /** kind: 'hover' (mouse), 'focus' (keyboard) or 'touch' (press and hold). */
  function showRowTip(row, at, kind = ui.tip?.kind ?? 'hover') {
    const m = ui.lastFrame && tooltipModel(row, ui.lastFrame, kind);
    if (!m) return hideTip();
    ui.tip = { row, at, stamp: performance.now(), kind };
    ui.hint = null;
    tooltip.show(m, at, accentOf(row));
    // keyboard users get the tooltip text as the focused row's description
    const el = kind === 'focus' ? screen.rows[row]?.g : null;
    if (ui.tipEl && ui.tipEl !== el) ui.tipEl.removeAttribute('aria-describedby');
    ui.tipEl = el ?? null;
    el?.setAttribute('aria-describedby', tooltip.id);
  }
  function showHint(region, at) {
    const letters = {};
    for (let d = 1; d <= 14; d++) letters[d] = letterOf(d - 1);
    const text = regionHint(region, { topDepth: store.state.topDepth, letters });
    ui.tip = null;
    tooltip.show({ title: text, aside: '', lines: [], hint: '', swatch: false }, at, region === 'middle' ? 'var(--gold)' : 'var(--teal)');
  }
  function hideTip() {
    clearTimeout(ui.regionTimer);
    clearTimeout(ui.tipTimer);
    ui.tip = null;
    ui.hint = null;
    if (ui.tipEl) {
      ui.tipEl.removeAttribute('aria-describedby');
      ui.tipEl = null;
    }
    tooltip.hide();
  }
  /** Touch tooltips close by themselves shortly after the finger lifts. */
  const hideTipSoon = (ms) => {
    clearTimeout(ui.tipTimer);
    ui.tipTimer = setTimeout(hideTip, ms);
  };

  // ---- pointer ---------------------------------------------------------------------------------
  function toLogical(e) {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  const hitAt = (e) => {
    const p = toLogical(e);
    return p ? hitTest(p.x, p.y) : null;
  };

  function updateHover(e) {
    const hit = hitAt(e);
    screen.setHover(hit);
    svg.classList.toggle('is-over', !!hit);
    const at = { x: e.clientX, y: e.clientY };
    const tipRow = hit?.row ?? hit?.ring;
    if (tipRow) {
      clearTimeout(ui.regionTimer);
      ui.hint = null;
      showRowTip(tipRow, at, 'hover');
    } else if (hit) {
      if (ui.tip) hideTip();
      // a pointer resting in the same region (a few px of jitter) keeps its pending or visible hint
      const h = ui.hint;
      if (h && h.region === hit.region && Math.hypot(at.x - h.x, at.y - h.y) < HINT_JITTER_PX) return;
      clearTimeout(ui.regionTimer);
      if (tooltip.visible) tooltip.hide();
      ui.hint = { region: hit.region, x: at.x, y: at.y };
      ui.regionTimer = setTimeout(() => showHint(hit.region, at), 450);
    } else hideTip();
  }
  function clearHover() {
    screen.setHover(null);
    svg.classList.remove('is-over');
    hideTip();
  }

  let press = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, long: false };
    if (e.pointerType !== 'mouse') {
      // touch / pen: the next touch dismisses a held tooltip; press and hold shows one instead of tapping
      if (tooltip.visible) hideTip();
      clearTimeout(ui.holdTimer);
      ui.holdTimer = setTimeout(() => {
        if (!press || press.moved) return;
        const hit = hitAt({ clientX: press.x, clientY: press.y });
        const tipRow = hit?.row ?? hit?.ring;
        if (tipRow) {
          press.long = true;
          showRowTip(tipRow, { x: press.x, y: press.y, above: true }, 'touch');
        }
      }, 450);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
      press.moved = true;
      clearTimeout(ui.holdTimer);
    }
    if (e.pointerType === 'mouse') updateHover(e);
  });
  svg.addEventListener('pointerup', (e) => {
    clearTimeout(ui.holdTimer);
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (p.long) {
      hideTipSoon(2600);
      return;
    }
    if (p.moved) return;
    const hit = hitAt(e);
    if (hit) onTap(hit);
  });
  svg.addEventListener('pointercancel', () => {
    // the browser took the gesture over (a scroll): a held tooltip would stay pinned to the viewport
    const held = press?.long || ui.tip?.kind === 'touch';
    press = null;
    clearTimeout(ui.holdTimer);
    if (held) hideTip();
  });
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    press = null; // only a press that starts and ends on the face is a tap
    clearHover();
  });
  // the tooltip is fixed to the viewport: a touch tooltip must not outlive a scroll
  const onScroll = () => {
    if (ui.tip?.kind === 'touch') hideTip();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  svg.addEventListener('contextmenu', (e) => {
    if (press?.long) e.preventDefault();
  });

  /** SPEC §10: top = longer period, bottom = shorter, middle = info (double tap: letters). */
  function onTap(hit) {
    const now = performance.now();
    if (hit.region === 'middle') {
      const { action, last } = middleTap(ui.lastTap, now);
      ui.lastTap = last;
      if (action === 'letters') toggleLetters();
      else showInfo();
      return;
    }
    ui.lastTap = { region: hit.region, time: now };
    const dir = hit.region === 'top' ? -1 : 1;
    // tapping a glyph row also selects its cycle level; the cycle stays on screen after the step
    if (hit.row === 'top' || hit.row === 'bottom') selectRow(hit.row);
    const moved = changeDepth(dir);
    screen.pulseRegion(hit.region, !moved && !hit.row);
    if (!moved && !hit.row) ctx.toast(blockedMessage(dir));
    if (tooltip.visible) hideTip();
  }

  // ---- keyboard ---------------------------------------------------------------------------------
  svg.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const rowEl = e.target?.closest?.('[data-row]');
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        screen.pulseRegion('top');
        stepOrHint(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        screen.pulseRegion('bottom');
        stepOrHint(1);
        break;
      case 'i':
      case 'I':
        showInfo();
        break;
      case 'l':
      case 'L':
        toggleLetters();
        break;
      case 'Enter':
      case ' ':
        if (!rowEl) return;
        e.preventDefault();
        e.stopPropagation(); // Space must not also toggle the time-lapse
        activateRow(rowEl.dataset.row);
        break;
      case 'Escape':
        hideTip();
        break;
      default:
    }
  });
  svg.addEventListener('focusin', (e) => {
    const rowEl = e.target?.closest?.('[data-row]');
    if (!rowEl || !e.target.matches(':focus-visible')) return;
    const r = rowEl.getBoundingClientRect();
    showRowTip(rowEl.dataset.row, { rect: r }, 'focus');
  });
  // only a tooltip that keyboard focus opened closes with focus (touch taps move focus around)
  svg.addEventListener('focusout', () => {
    if (ui.tip?.kind === 'focus') hideTip();
  });
  // a click event with no pointer behind it (detail 0) comes from assistive technology or a script:
  // real mouse / touch clicks are handled through the pointer events above
  svg.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const rowEl = e.target?.closest?.('[data-row]');
    if (rowEl) activateRow(rowEl.dataset.row);
  });

  // ---- buttons ----------------------------------------------------------------------------------
  controls.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'longer':
        screen.pulseRegion('top');
        stepOrHint(-1);
        break;
      case 'shorter':
        screen.pulseRegion('bottom');
        stepOrHint(1);
        break;
      case 'info':
        showInfo();
        break;
      default:
        toggleLetters();
    }
  });

  // ---- how-to popover ---------------------------------------------------------------------------
  const onDocDown = (e) => {
    if (!pop.contains(e.target) && !bHelp.contains(e.target)) closePop(false);
  };
  const onDocKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePop(true);
    }
  };
  function openPop() {
    hideTip();
    pop.hidden = false;
    bHelp.setAttribute('aria-expanded', 'true');
    bHelp.classList.add('is-on');
    pop.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
  }
  function closePop(restoreFocus = true) {
    if (pop.hidden) return;
    pop.hidden = true;
    bHelp.setAttribute('aria-expanded', 'false');
    bHelp.classList.remove('is-on');
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
    if (restoreFocus) bHelp.focus({ preventScroll: true });
  }
  // keys typed in the dialog (Space to scroll, digits, brackets ...) must not reach the global shortcuts; "?" is the
  // exception in pure mode, because the dialog itself ends with "Press ? for the glossary."
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === '?' && isPure())) return;
    e.stopPropagation();
  });
  bHelp.addEventListener('click', () => (pop.hidden ? openPop() : closePop(true)));
  pop.querySelector('.face-pop-close').addEventListener('click', () => closePop(true));

  // ---- fitting ---------------------------------------------------------------------------------
  function fit() {
    const w = stage.clientWidth;
    const hgt = stage.clientHeight;
    if (!w || !hgt) return;
    const dpr = window.devicePixelRatio || 1;
    const L = layoutFit({ width: w, height: hgt, dpr });
    const s = svg.style;
    s.width = `${L.width}px`;
    s.height = `${L.height}px`;
    s.left = `${L.left}px`;
    s.top = `${L.top}px`;
    ui.dpr = dpr;
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(stage);
  fit();

  // ---- small DOM caches -------------------------------------------------------------------------
  const cached = new Map();
  const setText = (key, node, text) => {
    if (cached.get(key) !== text) {
      cached.set(key, text);
      node.textContent = text;
    }
  };
  const setAttr = (key, node, name, value) => {
    if (cached.get(key) !== value) {
      cached.set(key, value);
      node.setAttribute(name, value);
    }
  };

  function syncControls(depth) {
    const atMin = depth <= MIN_TOP_DEPTH;
    const atMax = depth >= MAX_TOP_DEPTH;
    setAttr('b-longer', bLonger, 'aria-disabled', String(atMin));
    setAttr('b-shorter', bShorter, 'aria-disabled', String(atMax));
    setAttr('b-letters', bLetters, 'aria-pressed', String(!!store.state.showLetters));
    const lv = levelsFor(depth);
    setText('depths', depths, `${letterOf(lv.top)} ${lv.top + 1} · ${letterOf(lv.bottom)} ${lv.bottom + 1}`);
    const longer = atMin ? 'Longest period reached' : `Longer period: depth ${depth - 1} on top (↑)`;
    const shorter = atMax ? 'Shortest pair reached' : `Shorter period: depth ${depth + 1} on top (↓)`;
    setAttr('t-longer', bLonger, 'title', longer);
    setAttr('a-longer', bLonger, 'aria-label', longer);
    setAttr('t-shorter', bShorter, 'title', shorter);
    setAttr('a-shorter', bShorter, 'aria-label', shorter);
  }

  // ---- info labels ---------------------------------------------------------------------------------
  /** Text of the three info labels (SPEC §8): next threshold of the top period, next solar threshold, sync time. */
  function infoLabels(frame, lTop, sol) {
    if (isPure()) return pureInfoLabels(pure, frame.t, lTop, sol);
    const next = lTop.next;
    return {
      topCap: thresholdCaption(next.name),
      topVal: next.time != null ? fmt.label(next.time, frame.t) : '\u2014',
      solarCap: sol ? thresholdCaption(sol.threshold.name) : 'SOLAR SYNC',
      solarVal: sol ? fmt.label(sol.threshold.time, frame.t) : '\u2014',
      syncCap: 'SYNC TIME',
      syncVal: sol ? fmt.label(sol.start, frame.t) : '\u2014',
      solarOk: !!sol,
    };
  }

  // ---- pure mode ---------------------------------------------------------------------------------
  /**
   * Rewrite everything that is text for the mode (normal / pure): the static labels of the screen, the how-to lines,
   * and forget what the other mode wrote (info values, letter names, the open tooltip, cached labels), so nothing
   * of the previous vocabulary stays on screen or in the accessibility tree. Runs at mount and on every toggle.
   */
  function applyMode(on) {
    ui.pure = on;
    if (on) el.dataset.pure = '1';
    else delete el.dataset.pure;
    hideTip();
    tooltip.clear();
    status.textContent = ''; // the last announcement belongs to the other mode
    if (on) caption.title = CAPTION_NOTE; // which of the caption's numbers count from 0 and which from 1
    else caption.removeAttribute('title');
    screen.setMode(on, on ? { range: pureRange(pure), solarNa: PURE_SOLAR_NA } : null);
    fillHowTo(pop, { pure: on, pairHTML: pure?.pairHTML });
    ui.labelKey = ''; // aria labels of the rows and of the screen are derived again
    ui.cycleKey = '';
    ui.dirty = true;
  }
  /** Letter, depth and (pure mode) the name of the running cycle for the two period rows. */
  function letterSpecs(frame, lv) {
    const spec = (level) => ({ letter: letterOf(level), depth: level + 1, name: '' });
    const top = spec(lv.top);
    const bottom = spec(lv.bottom);
    if (isPure() && frame.inRange) {
      const a = frame.level(lv.top);
      const b = frame.level(lv.bottom);
      if (a) top.name = letterName(pure, lv.top, a.local);
      if (b) bottom.name = letterName(pure, lv.bottom, b.local);
    }
    return [top, bottom];
  }

  // ---- render ------------------------------------------------------------------------------------
  function render(frame, info) {
    const now = performance.now();
    ui.lastFrame = frame;
    const st = store.state;
    const depth = clampDepth(st.topDepth);
    const lv = levelsFor(depth);
    const pureOn = isPure();
    if (pureOn !== ui.pure) applyMode(pureOn);

    if (depth !== ui.depth) {
      if (ui.depth !== null) {
        ui.lettersUntil = now + LETTER_MS;
        say(`${depthWords(lv.top + 1)} over ${depthWords(lv.bottom + 1)}`);
      }
      ui.depth = depth;
      ui.dirty = true;
      screen.resetPeriodRows();
      screen.setLetters(...letterSpecs(frame, lv));
      syncControls(depth);
    }
    const mode = overlayMode({ now, infoUntil: ui.infoUntil, lettersUntil: ui.lettersUntil, showLetters: st.showLetters });
    if (mode !== ui.mode) {
      ui.mode = mode;
      ui.dirty = true;
    }
    if (window.devicePixelRatio !== ui.dpr) fit();
    if (ui.live !== store.live || ui.showLetters !== st.showLetters) {
      ui.live = store.live;
      ui.showLetters = st.showLetters;
      ui.dirty = true;
      syncControls(depth);
    }

    if (ui.inRange !== frame.inRange) {
      ui.inRange = frame.inRange;
      ui.dirty = true;
    }
    const tipDue = tooltip.visible && ui.tip && now - ui.tip.stamp >= 250;
    if (!info.dirty && !ui.dirty && !tipDue) return;
    ui.dirty = false;

    // ---- out of catalogue
    if (!frame.inRange) {
      const range = pureOn ? pureRange(pure) : null;
      screen.setRange(true, range ? range.from : fmt.date(model.tMin), range ? range.to : fmt.date(model.tMax));
      screen.setOverlay('none');
      screen.setSelected(null);
      // forget what the screen showed, so the accent and the labels are redrawn when time is back in range
      ui.selKey = '';
      ui.labelKey = '';
      screen.setLabel(range ? range.label : OOR_LABEL);
      screen.setPending(false);
      setText('caption', caption, '');
      hideTip();
      return;
    }
    screen.setRange(false);

    const top = frame.odometer(lv.top);
    const bot = frame.odometer(lv.bottom);
    const sol = solarOf(frame);
    const lTop = frame.level(lv.top);
    const lBot = frame.level(lv.bottom);
    if (!top || !bot || !lTop || !lBot) return;

    // the tick cue is for calm moments: in time-lapse glyphs change faster than it lasts
    const cue = !(store.playing && Math.abs(store.rate) > 1);
    const topChanged = screen.setGlyphs('top', top.digits, now, cue);
    const botChanged = screen.setGlyphs('bottom', bot.digits, now, cue);
    screen.setSolarAvailable(!!sol);
    const solChanged = sol ? screen.setGlyphs('solar', sol.digits3, now, cue) : false;
    screen.setPending(false);
    screen.setCounter('top', lTop.siblings, lTop.local);
    screen.setCounter('bottom', lBot.siblings, lBot.local);

    const cycleKey = `${lTop.local}|${lBot.local}`;
    if (topChanged || botChanged || cycleKey !== ui.cycleKey || ui.labelKey === '') {
      ui.cycleKey = cycleKey;
      const mk = (level, odo, lvl) => ({ letter: letterOf(level), depth: level + 1, state: stateInfo(odo.digits[0]), local: lvl.local, siblings: lvl.siblings, name: pureOn ? letterName(pure, level, lvl.local) : '' });
      const label = pureOn ? (kind, d) => pureRowAriaLabel(kind, d, pure) : rowAriaLabel;
      screen.setRowLabel('top', label('top', mk(lv.top, top, lTop)));
      screen.setRowLabel('bottom', label('bottom', mk(lv.bottom, bot, lBot)));
    }
    if (solChanged || ui.solarOk !== !!sol || ui.labelKey === '') {
      ui.solarOk = !!sol;
      const solar = { sync: sol?.sync, phase: sol?.phase, digits: sol?.digits3 };
      screen.setRowLabel('solar', sol ? (pureOn ? pureRowAriaLabel('solar', solar, pure) : rowAriaLabel('solar', solar)) : pureOn ? PURE_SOLAR_NA.label : SOLAR_NA_LABEL);
    }
    const labelKey = `${depth}|${sol ? sol.sync : 'n/a'}`;
    if (labelKey !== ui.labelKey) {
      ui.labelKey = labelKey;
      screen.setLabel(`Clock face: ${depthWords(lv.top + 1)} over ${depthWords(lv.bottom + 1)}` + (sol ? `, solar sync ${sol.sync}` : ''));
    }

    // ---- overlays
    screen.setLetters(...letterSpecs(frame, lv));
    screen.setOverlay(mode);
    if (mode === 'info') screen.setInfo(infoLabels(frame, lTop, sol));

    // ---- selected level accent
    const sel = st.selectedLevel;
    const selRow = sel === lv.top ? 'top' : sel === lv.bottom ? 'bottom' : null;
    const selKey = `${selRow}|${sel}`;
    if (selKey !== ui.selKey) {
      ui.selKey = selKey;
      screen.setSelected(selRow, selRow ? theme.levelColor(sel, 0.06) : '', selRow ? theme.levelColor(sel, 0.28) : '');
    }

    // ---- caption (only when not live)
    setText('caption', caption, store.live ? '' : pureOn ? pureCaption(pure, frame.t) : `${fmt.dateTime(frame.t)} ${fmt.tag(frame.t)}`);

    // ---- tooltip countdowns stay fresh while it is open
    if (tipDue) showRowTip(ui.tip.row, ui.tip.at);
  }

  applyMode(isPure());

  function destroy() {
    ro?.disconnect();
    window.removeEventListener('scroll', onScroll);
    clearTimeout(ui.holdTimer);
    hideTip();
    tooltip.destroy();
    closePop(false);
    el.classList.remove('face-root');
    el.textContent = '';
  }

  return {
    alwaysOn: true,
    render,
    destroy,
    // small surface for tests and other modules
    changeDepth,
    showInfo,
    toggleLetters,
    toggleHelp: () => (pop.hidden ? openPop() : closePop(true)),
    get overlay() {
      return ui.mode;
    },
    get levels() {
      return levels();
    },
    svg,
  };
}
