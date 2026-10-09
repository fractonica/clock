/**
 * Cycle ladder: one row per depth (default 1..10) that says where the displayed time
 * sits inside every cycle of the hierarchy at once.
 *
 *   [η 7]  5 / 11                        2 h 14 min   ⌇  <- phase glyph
 *   ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱   44 %   (9 child segments: 4 complete, the 5th one 40 % filled)
 *
 * Selection (shared with rings / timeline / wave) is the row the listbox shows as
 * selected; the selected row expands to the cycle's quarter thresholds, its Gregorian
 * start / end, its Saros-position span and the facts the hover tooltip tells (so touch has them too).
 * Rows go "Just after" the end of their cycle with double-click / Enter, "Just before" it with Shift+Enter.
 *
 * Contract: export mount(el, ctx) -> { render, alwaysOn, destroy } (docs/ARCHITECTURE.md).
 */
import {
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH,
  MIN_DEPTH,
  clamp,
  countdownText,
  counterText,
  justAfterTime,
  justBeforeLead,
  justBeforeTime,
  leadText,
  letterOf,
  normDepth,
  normLevel,
  ordinal,
  pctText,
  pctTenthsText,
  pctWhole,
  positionSpan,
  quantize,
  remainingText,
  segmentState,
  whenFull,
  whenLabel,
} from './ladder/lib.js';
import { attrCell, classCell, createTip, esc, glyphFactory, icons, levelVars, reducedMotion, textCell } from './ladder/dom.js';

/** Cycles shorter than this (s) are too fast for a ticking countdown: the row shows the length instead. */
const STATIC_BELOW = 0.5;
/** Cycles shorter than this (s) update their percent only when their countdown digit does (about 10 times a second), not every frame. */
const PCT_STEADY_BELOW = 10;
/** Below this (s) a row's accessible name carries its percent in steps of 10, so it is not rewritten dozens of times a second. */
const LABEL_COARSE_BELOW = 120;
const FRAC_STEPS = 240;
const SEG_CLASS = ['ladder-seg', 'ladder-seg is-done', 'ladder-seg is-cur'];
const QUARTER_FRAC = ['¼', '½', '¾', '1'];
const ROW_ID = (L) => `ladder-opt-${L}`;
/** Two clicks closer than this (ms) on the same spot are one double-click, even when the layout moved in between. */
const DOUBLE_CLICK_MS = 450;

/** The child level a cycle's bar segments stand for, as "γ 3 " (the finest level has no named child). */
const childOf = (L) => (L < MAX_DEPTH - 1 ? `${letterOf(L + 1)} ${L + 2} ` : 'finer ');

/** "5th of 13 γ 3 sectors · 57 % through it": where the current segment of the bar is, and how full it is. */
// (no-break spaces after the dot: when the line wraps, it wraps before "· 33 % through it", never inside it)
const sectorText = (L, seg, factor) => `${ordinal(seg.index + 1)} of ${factor} ${childOf(L)}sectors ·\u00a0${Math.min(99, Math.floor(seg.frac * 100))}\u202f%\u00a0through\u00a0it`;

export function mount(el, ctx) {
  const { model, store, fmt, theme } = ctx;
  const QN = ctx.QUARTER_NAMES;
  const glyphStyle = theme.glyphStyle('currentColor', 3.05, { thickness: 0.34 });

  el.classList.add('ladder');
  el.innerHTML = `
    <div class="card-h ladder-head">
      <h2 id="ladder-title">Cycle ladder</h2>
      <span class="spacer"></span>
      <div class="ladder-range" role="group" aria-label="Depth range shown here and in the rings and timeline">
        <select class="select ladder-sel" data-k="min" aria-label="Coarsest depth shown" title="Coarsest depth shown"></select>
        <span class="ladder-dash" aria-hidden="true">–</span>
        <select class="select ladder-sel" data-k="max" aria-label="Finest depth shown" title="Finest depth shown"></select>
      </div>
    </div>
    <div class="card-b ladder-body">
      <p class="ladder-cap">% through · time left · bars show the sub-cycles</p>
      <div class="ladder-note" hidden>
        <p class="ladder-note-t"></p>
        <button class="btn btn-sm ladder-edge" type="button"></button>
      </div>
      <div class="ladder-list" role="listbox" tabindex="0" aria-labelledby="ladder-title" aria-describedby="ladder-hint"></div>
      <p class="sr-only" id="ladder-hint">Up and down arrows choose a depth. Enter is Just after the end of the selected cycle (1 ms into the next one), Shift plus Enter is Just before it (two seconds ahead, or a quarter of a shorter cycle), and the open bracket key goes to its start.</p>
      <button class="ladder-more" type="button"></button>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const list = $('.ladder-list');
  const note = $('.ladder-note');
  const noteText = $('.ladder-note-t');
  const edgeBtn = $('.ladder-edge');
  const moreBtn = $('.ladder-more');
  const minSel = $('.ladder-sel[data-k="min"]');
  const maxSel = $('.ladder-sel[data-k="max"]');

  for (let d = MIN_DEPTH; d <= MAX_DEPTH; d++) {
    const label = `${letterOf(d - 1)} ${d}`;
    minSel.append(new Option(label, d));
    maxSel.append(new Option(label, d));
  }

  const tip = createTip('ladder-tip');
  const setMore = textCell(moreBtn);

  /** @type {Array<ReturnType<typeof makeRow>>} */
  let rows = [];
  const byLevel = new Map();
  let built = { min: 0, max: 0 };
  let selLevel = -1;
  let wasOff = null;
  let lastFrame = null;
  let hoverL = -1;
  let tipAt = 0;
  let detailRow = null;
  let rangeSig = '';
  let firstClick = null; // {L, at, x, y}: the row selected by the latest plain click (first half of a double-click)
  let dblDoneAt = -Infinity;

  // ---------------------------------------------------------------------------
  // rows
  // ---------------------------------------------------------------------------
  function makeRow(L) {
    const info = model.levelInfo(L);
    const row = document.createElement('div');
    row.className = 'ladder-row';
    row.id = ROW_ID(L);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.dataset.level = String(L);
    row.style.cssText = levelVars(theme, L, `--n:${info.factor}`);
    let segs = '';
    for (let i = 0; i < info.factor; i++) segs += '<i class="ladder-seg"></i>';
    row.innerHTML = `
      <span class="ladder-chip" role="img" aria-label="${esc(info.letter)}, depth ${info.depth}"><b>${esc(info.letter)}</b><span class="mono">${info.depth}</span></span>
      <span class="ladder-count mono"></span>
      <span class="ladder-left mono"></span>
      <span class="ladder-glyph"></span>
      <div class="ladder-prog">
        <div class="ladder-bar">${segs}<span class="ladder-notches" aria-hidden="true"><i></i><i></i><i></i></span></div>
        <span class="ladder-pct mono"></span>
      </div>`;
    const q = (s) => row.querySelector(s);
    const r = {
      L,
      info,
      el: row,
      segs: [...row.querySelectorAll('.ladder-seg')],
      glyphCell: q('.ladder-glyph'),
      glyph: glyphFactory(model, glyphStyle),
      glyphIdx: -2,
      setCount: textCell(q('.ladder-count')),
      setLeft: textCell(q('.ladder-left')),
      setPct: textCell(q('.ladder-pct')),
      setLabel: attrCell(row, 'aria-label'),
      setClipped: classCell(row, 'is-clipped'),
      leftEl: q('.ladder-left'),
      labelKey: '',
      cur: -1,
      fq: -1,
      still: info.meanSeconds < STATIC_BELOW,
      steady: info.meanSeconds < PCT_STEADY_BELOW,
      leftText: null,
      pct: 0, // phase the percent was last written for (rows that update about 10 times a second)
      off: null,
    };
    r.leftEl.classList.toggle('is-still', r.still);
    return r;
  }

  function rebuild() {
    const st = store.state;
    const min = normDepth(st.minDepth, MIN_DEPTH);
    const max = Math.max(min, normDepth(st.maxDepth, DEFAULT_MAX_DEPTH));
    built = { min, max };
    hideTip(); // the hovered row may be gone
    rows = [];
    byLevel.clear();
    const frag = document.createDocumentFragment();
    for (let d = min; d <= max; d++) {
      const r = makeRow(d - 1);
      rows.push(r);
      byLevel.set(r.L, r);
      frag.append(r.el);
    }
    list.replaceChildren(frag);
    detailRow = null;
    selLevel = -1; // force applySelection
    wasOff = null;
    minSel.value = String(min);
    maxSel.value = String(max);
    updateMore();
    ctx.requestRender();
  }

  function updateMore() {
    const max = built.max;
    if (max < MAX_DEPTH) {
      const hidden = [];
      for (let d = max + 1; d <= MAX_DEPTH; d++) hidden.push(letterOf(d - 1));
      setMore(`+ ${hidden.length} finer depth${hidden.length === 1 ? '' : 's'} (${hidden.join(' ')})`);
      moreBtn.dataset.mode = 'more';
      moreBtn.setAttribute('aria-expanded', 'false');
    } else {
      const hidden = [];
      for (let d = DEFAULT_MAX_DEPTH + 1; d <= MAX_DEPTH; d++) hidden.push(letterOf(d - 1));
      setMore(`Fewer depths (hide ${hidden.join(' ')})`);
      moreBtn.dataset.mode = 'less';
      moreBtn.setAttribute('aria-expanded', 'true');
    }
  }

  // ---------------------------------------------------------------------------
  // selected row details (one element that moves to the selected row)
  // ---------------------------------------------------------------------------
  const detail = document.createElement('div');
  detail.className = 'ladder-detail';
  detail.innerHTML = `
    <div class="ladder-end"><span class="ladder-k ladder-end-k">Ends</span><span class="ladder-end-w"><span class="ladder-end-v"></span> <span class="ladder-end-z dim mono"></span></span></div>
    <ol class="ladder-q" aria-label="Quarter thresholds of this cycle">
      ${QN.map(
        (n, i) => `<li class="ladder-qi">
          <span class="ladder-q-mark" aria-hidden="true"></span>
          <span class="ladder-q-name">${n}</span><span class="ladder-q-frac dim">${QUARTER_FRAC[i]}</span>
          <span class="ladder-q-time mono"></span><span class="ladder-q-rel mono"></span></li>`,
      ).join('')}
    </ol>
    <dl class="ladder-facts ladder-facts-now">
      <div><dt>Through</dt><dd class="ladder-through mono"></dd></div>
      <div><dt>Sector</dt><dd class="ladder-sector"></dd></div>
    </dl>
    <dl class="ladder-facts ladder-facts-span">
      <div><dt>Started</dt><dd class="ladder-started"></dd></div>
      <div><dt>Length</dt><dd class="ladder-length mono"></dd></div>
      <div><dt>Saros span</dt><dd class="ladder-saros mono"></dd></div>
    </dl>
    <div class="ladder-actions">
      <button class="btn btn-sm" type="button" data-act="start" tabindex="-1" title="Start: jump to the start of this cycle">${icons.start}<span>Start</span></button>
      <button class="btn btn-sm" type="button" data-act="before" tabindex="-1">${icons.before}<span>Just before</span></button>
      <button class="btn btn-sm ladder-go" type="button" data-act="after" tabindex="-1">${icons.after}<span>Just after</span></button>
    </div>`;
  const D = {
    endK: detail.querySelector('.ladder-end-k'),
    endV: detail.querySelector('.ladder-end-v'),
    endZ: detail.querySelector('.ladder-end-z'),
    through: detail.querySelector('.ladder-through'),
    sector: detail.querySelector('.ladder-sector'),
    beforeBtn: detail.querySelector('[data-act="before"]'),
    afterBtn: detail.querySelector('[data-act="after"]'),
    started: detail.querySelector('.ladder-started'),
    length: detail.querySelector('.ladder-length'),
    saros: detail.querySelector('.ladder-saros'),
    q: [...detail.querySelectorAll('.ladder-qi')].map((li) => ({
      li,
      time: li.querySelector('.ladder-q-time'),
      rel: li.querySelector('.ladder-q-rel'),
    })),
    key: '',
  };
  D.setEndK = textCell(D.endK);
  D.setEndV = textCell(D.endV);
  D.setEndZ = textCell(D.endZ);
  D.setThrough = textCell(D.through);
  D.setSector = textCell(D.sector);
  D.setBeforeTip = attrCell(D.beforeBtn, 'title');
  D.setBeforeName = attrCell(D.beforeBtn, 'aria-label');
  D.setAfterTip = attrCell(D.afterBtn, 'title');
  D.setAfterName = attrCell(D.afterBtn, 'aria-label');
  D.setStarted = textCell(D.started);
  D.setLength = textCell(D.length);
  D.setSaros = textCell(D.saros);
  D.q.forEach((q) => {
    q.setTime = textCell(q.time);
    q.setRel = textCell(q.rel);
    q.state = '';
  });

  function applySelection(sel) {
    selLevel = sel;
    for (const r of rows) {
      const on = r.L === sel;
      r.el.classList.toggle('is-selected', on);
      r.el.setAttribute('aria-selected', String(on));
    }
    const r = byLevel.get(sel) ?? null;
    if (r) {
      list.setAttribute('aria-activedescendant', r.el.id);
      if (detailRow !== r) {
        hideTip(); // the rows move: a tooltip anchored to the old geometry would float loose
        r.el.append(detail);
        D.key = '';
        if (detailRow !== null && !reducedMotion()) {
          detail.animate(
            [
              { opacity: 0, transform: 'translateY(-4px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 160, easing: 'ease-out' },
          );
        }
      }
    } else {
      list.removeAttribute('aria-activedescendant');
      detail.remove();
    }
    detailRow = r;
  }

  function updateDetail(lv, t) {
    const zone = fmt.zone();
    const key = `${lv.level}:${lv.cycle}:${zone}`;
    if (key !== D.key) {
      D.key = key;
      const precise = lv.duration < 10;
      const info = model.levelInfo(lv.level);
      D.setEndK(lv.clipped ? 'Catalogue ends' : 'Ends');
      D.setEndV(whenFull(fmt, lv.end, { precise }));
      D.setEndZ(fmt.tag(lv.end));
      D.setStarted(whenFull(fmt, lv.start, { precise }));
      D.setLength(fmt.duration(lv.duration) + (lv.clipped ? ' · clipped' : ''));
      const name = `${info.letter} ${info.depth}`;
      const before = `Just before: jump to ${leadText(justBeforeLead(lv.duration))} before this ${name} cycle ends and watch it turn over (Shift+Enter)`;
      const after = `Just after: jump to 1 ms into the next ${name} cycle (Enter, or double-click the row)`;
      D.setBeforeTip(before);
      D.setBeforeName(before);
      D.setAfterTip(after);
      D.setAfterName(after);
      const span = positionSpan(lv.cycleBig, info.prefix, model.extent, lv.clipped);
      D.setSaros(`${span.from} → ${span.to}`);
      for (let i = 0; i < 4; i++) {
        const when = lv.thresholds[i + 1]?.time;
        D.q[i].setTime(when == null ? '—' : whenLabel(fmt, when, lv.start, lv.duration));
      }
    }
    // cycles too fast to follow (nu, xi) show where each quarter falls inside the cycle instead of a
    // countdown that is 0.0 s everywhere, and keep the highlight still (it would flash at 20+ Hz)
    const still = detailRow.still;
    // the facts the hover tooltip tells, so touch and keyboard have them too (rows that tick ~10 times a second share the row's phase)
    if (still) {
      D.setThrough('too fast to follow');
      D.setSector('—');
    } else {
      const seg = segmentState(detailRow.pct, lv.factor);
      D.setThrough(`${pctTenthsText(detailRow.pct)} of this cycle`);
      D.setSector(sectorText(lv.level, seg, lv.factor));
    }
    for (let i = 0; i < 4; i++) {
      const q = D.q[i];
      const state = still ? 'later' : i < lv.quarter ? 'past' : i === lv.quarter ? 'next' : 'later';
      if (state !== q.state) {
        q.li.className = `ladder-qi is-${state}`;
        q.state = state;
      }
      const when = lv.thresholds[i + 1]?.time;
      if (still) q.setRel(when == null ? '—' : `+${Math.round((when - lv.start) * 1000)} ms`);
      else q.setRel(state === 'past' ? 'passed' : when == null ? 'after the end' : countdownText(fmt, when - t));
    }
  }

  // ---------------------------------------------------------------------------
  // per-frame row update
  // ---------------------------------------------------------------------------
  function setRowOff(r, off) {
    if (r.off === off) return;
    r.off = off;
    r.el.classList.toggle('is-off', off);
    r.el.setAttribute('aria-disabled', String(off));
    if (off) {
      r.setCount('—');
      r.setLeft('—');
      r.setPct('—');
      r.leftText = null;
      r.setClipped(false);
      r.glyphCell.replaceChildren();
      r.glyphIdx = -2;
      r.setLabel(`${r.info.letter}, depth ${r.info.depth}: outside the catalogue`);
      r.labelKey = '';
      if (r.cur >= 0) for (const s of r.segs) s.className = SEG_CLASS[0];
      r.cur = -1;
      r.fq = -1;
    }
  }

  function updateRow(r, lv) {
    setRowOff(r, false);
    r.setCount(counterText(r.L, lv.local, lv.siblings));
    r.setClipped(lv.clipped);

    // segmented bar
    const { index, frac } = segmentState(lv.phase, lv.factor);
    if (index !== r.cur) {
      for (let i = 0; i < r.segs.length; i++) r.segs[i].className = SEG_CLASS[i < index ? 1 : i === index ? 2 : 0];
      r.cur = index;
      r.fq = -1;
    }
    const fq = quantize(frac, FRAC_STEPS);
    if (fq !== r.fq) {
      r.segs[index].style.setProperty('--f', fq);
      r.fq = fq;
    }

    // time left (or the length, for cycles too fast to count down)
    const leftText = r.still ? `every ${fmt.duration(r.info.meanSeconds)}` : remainingText(fmt, lv.remaining);
    const leftChanged = leftText !== r.leftText;
    r.leftText = leftText;
    r.setLeft(leftText);

    // percent through the cycle: floored; on cycles of a few seconds it moves with the countdown's digit, not every frame
    if (r.still) r.setPct('—');
    else if (!r.steady || leftChanged) {
      r.pct = lv.phase;
      r.setPct(pctText(lv.phase));
    }

    // phase glyph, re-inserted only when the state changes
    if (lv.index !== r.glyphIdx) {
      r.glyphCell.replaceChildren(r.glyph(lv.index));
      r.glyphIdx = lv.index;
    }

    // accessible name: whole percent for long cycles, steps of 10 for short ones, so it is rewritten rarely
    const whole = pctWhole(lv.phase);
    const pct = r.info.meanSeconds >= LABEL_COARSE_BELOW ? whole : Math.floor(whole / 10) * 10;
    const labelKey = `${r.still ? 'still' : `${lv.cycle}:${pct}`}:${fmt.zone()}:${lv.clipped}`;
    if (labelKey !== r.labelKey) {
      r.labelKey = labelKey;
      const head = `${r.info.letter}, depth ${r.info.depth}`;
      if (r.still) r.setLabel(`${head}: too fast to follow, one cycle lasts ${fmt.duration(r.info.meanSeconds)}`);
      else {
        const clipped = lv.clipped ? ', clipped by the end of the catalogue' : '';
        r.setLabel(`${head}: ${counterText(r.L, lv.local, lv.siblings).replace('/', 'of')}, ${pct} percent through this cycle, ends ${whenFull(fmt, lv.end)}${clipped}`);
      }
    }
  }

  function setOff(off, t) {
    if (off === wasOff) return;
    wasOff = off;
    list.classList.toggle('is-off', off);
    note.hidden = !off;
    if (off) {
      const edge = t < model.tMin ? model.tMin : model.tMax;
      noteText.textContent = `Outside the Saros 141 catalogue (${fmt.parts(model.tMin).year}–${fmt.parts(model.tMax).year}).`;
      edgeBtn.textContent = `Go to ${t < model.tMin ? 'the start' : 'the end'} (${fmt.date(edge)})`;
      edgeBtn.dataset.t = String(edge);
      detail.remove();
      detailRow = null;
      selLevel = -1;
      hideTip();
    }
    for (const r of rows) if (off) setRowOff(r, true);
  }

  // ---------------------------------------------------------------------------
  // navigation
  // ---------------------------------------------------------------------------
  const selectedLevel = () => normLevel(store.state.selectedLevel);
  function readLevel(L) {
    return model.levelAt(store.t(), L);
  }
  /** The final cycle of a level has no turnover to travel to: the catalogue stops there. */
  function isLast(lv) {
    if (lv.end < model.tMax - 0.002) return false;
    ctx.toast(lv.clipped ? `The last ${lv.name} cycle is clipped by the end of the catalogue` : `This is the last ${lv.name} cycle: the catalogue ends with it`);
    return true;
  }
  /** "Just after": 1 ms into the cycle that follows this one. */
  function goAfter(L = selectedLevel()) {
    const lv = readLevel(L);
    if (!lv || isLast(lv)) return;
    ctx.goto(justAfterTime(lv.end));
  }
  function goStart(L = selectedLevel()) {
    const lv = readLevel(L);
    if (lv) ctx.goto(lv.start + 0.001);
  }
  /** "Just before": 2 s (a quarter of the cycle when that is shorter) ahead of the end, then real time. */
  function goBefore(L = selectedLevel()) {
    const lv = readLevel(L);
    if (!lv || isLast(lv)) return;
    ctx.goto(justBeforeTime(lv.end, lv.duration));
    store.setRate(1); // watch it turn over in real time, whatever speed the clock was running at
  }

  /** Keyboard actions work on the selected row; if the range hides it, bring the selection into view first. */
  function actOnSelection(act) {
    const sel = selectedLevel();
    if (!byLevel.has(sel)) return moveSelection(0, sel < built.min - 1 ? 'first' : 'last');
    act(sel);
  }

  function moveSelection(delta, abs) {
    const levels = rows.map((r) => r.L);
    if (!levels.length) return;
    let i = levels.indexOf(selectedLevel());
    if (abs === 'first') i = 0;
    else if (abs === 'last') i = levels.length - 1;
    else if (i < 0) i = delta > 0 ? 0 : levels.length - 1;
    else i = Math.min(levels.length - 1, Math.max(0, i + delta));
    ctx.select(levels[i]);
    byLevel.get(levels[i])?.el.scrollIntoView({ block: 'nearest' });
  }

  list.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('button')) return;
    switch (e.key) {
      case 'ArrowDown':
        moveSelection(+1);
        break;
      case 'ArrowUp':
        moveSelection(-1);
        break;
      case 'Home':
        moveSelection(0, 'first');
        break;
      case 'End':
        moveSelection(0, 'last');
        break;
      case 'Enter':
        actOnSelection(e.shiftKey ? goBefore : goAfter);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // The first click of a double-click selects the row, which collapses the previous details and opens
  // these ones, so the row slides up to ~240 px under a stationary pointer. The second click then lands
  // on whatever is under the pointer now (a detail button, another row). So the pair is recognised here,
  // by time and position, and acts on the row the first click chose.
  list.addEventListener('click', (e) => {
    const now = performance.now();
    const first = firstClick;
    firstClick = null;
    if (first && now - first.at < DOUBLE_CLICK_MS && (e.detail >= 2 || Math.hypot(e.clientX - first.x, e.clientY - first.y) < 6)) {
      dblDoneAt = now;
      window.getSelection?.()?.removeAllRanges();
      goAfter(first.L);
      return;
    }
    const btn = e.target.closest('button[data-act]');
    const row = e.target.closest('.ladder-row');
    if (!row) return;
    const L = Number(row.dataset.level);
    if (btn) {
      e.stopPropagation();
      ({ start: goStart, before: goBefore, after: goAfter })[btn.dataset.act]?.(L);
      list.focus({ preventScroll: true });
      return;
    }
    firstClick = { L, at: now, x: e.clientX, y: e.clientY };
    list.focus({ preventScroll: true });
    ctx.select(L);
  });
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.ladder-row');
    if (!row || e.target.closest('.ladder-detail') || performance.now() - dblDoneAt < 600) return; // the click handler already jumped
    window.getSelection?.()?.removeAllRanges();
    goAfter(Number(row.dataset.level));
  });

  // hover tooltip (mouse only; on touch and keyboard the selected row's open details tell the same facts)
  function tipHtml(L, lv, t) {
    const r = byLevel.get(L);
    if (!r) return '';
    const info = r.info;
    const seg = segmentState(lv.phase, lv.factor);
    const parent = L === 0 ? 'the Saros 141 catalogue' : `${letterOf(L - 1)} ${L}`;
    const color = theme.levelColor(L);
    const ends = whenFull(fmt, lv.end, { precise: lv.duration < 10 });
    const left = r.still
      ? `Too fast to count down: one cycle lasts ${fmt.duration(info.meanSeconds)}.`
      : `${countdownText(fmt, lv.remaining)} left · cycle ${fmt.duration(lv.duration)}${lv.clipped ? ' (clipped: the catalogue ends first)' : ''}`;
    const through = r.still ? '' : `<div><b>${pctText(lv.phase)}</b> through this cycle</div>`;
    const sector = `The bar has one sector per ${childOf(L)}cycle: now in the <b>${ordinal(seg.index + 1)}</b> of ${lv.factor}, ${Math.min(99, Math.floor(seg.frac * 100))}\u202f% through that sector.`;
    return `<div class="ladder-tip-h"><b style="color:${color}">${esc(info.letter)} ${info.depth}</b><span>depth ${info.depth} · ${counterText(L, lv.local, lv.siblings).replace('/', 'of')} in ${esc(parent)}</span></div>
      ${through}
      <div class="dim">${sector}</div>
      <div class="ladder-tip-end">${lv.clipped ? 'Catalogue ends' : 'Ends'} <b>${esc(ends)}</b> <span class="dim">${esc(fmt.tag(lv.end))}</span></div>
      <div class="dim">${esc(left)}</div>
      <div class="ladder-tip-hint dim">Click to select · double-click for Just after</div>`;
  }
  function showTip(L) {
    const r = byLevel.get(L);
    const lv = lastFrame?.inRange ? lastFrame.level(L) : null;
    if (!r || !lv) return hideTip();
    hoverL = L;
    tip.show(tipHtml(L, lv, lastFrame.t), r.el.getBoundingClientRect());
    tipAt = performance.now();
  }
  function hideTip() {
    hoverL = -1;
    tip.hide();
  }
  list.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const row = e.target.closest('.ladder-row');
    // the open details already say everything the tooltip would, and their buttons have their own hints
    if (!row || e.target.closest('.ladder-detail')) return hideTip();
    const L = Number(row.dataset.level);
    if (L !== hoverL) showTip(L);
  });
  list.addEventListener('pointerleave', hideTip);
  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') hideTip();
  });
  const onScroll = () => hoverL >= 0 && hideTip();
  window.addEventListener('scroll', onScroll, { passive: true });

  // header + footer controls
  /** Change the shared depth range and keep the shared selection inside it (as the rings do). */
  function setRange(patch) {
    store.set(patch);
    const min = normDepth(store.state.minDepth, MIN_DEPTH);
    const max = Math.max(min, normDepth(store.state.maxDepth, DEFAULT_MAX_DEPTH));
    const sel = selectedLevel();
    const inside = clamp(sel, min - 1, max - 1);
    if (inside !== sel) ctx.select(inside);
  }
  minSel.addEventListener('change', () => {
    const v = Number(minSel.value);
    setRange(v > built.max ? { minDepth: v, maxDepth: v } : { minDepth: v });
  });
  maxSel.addEventListener('change', () => {
    const v = Number(maxSel.value);
    setRange(v < built.min ? { maxDepth: v, minDepth: v } : { maxDepth: v });
  });
  moreBtn.addEventListener('click', () => {
    if (moreBtn.dataset.mode === 'more') setRange({ maxDepth: MAX_DEPTH });
    else setRange({ maxDepth: Math.max(DEFAULT_MAX_DEPTH, built.min) });
  });
  edgeBtn.addEventListener('click', () => ctx.goto(Number(edgeBtn.dataset.t)));

  // ---------------------------------------------------------------------------
  // frame loop
  // ---------------------------------------------------------------------------
  function render(frame, info) {
    lastFrame = frame;
    const st = store.state;
    const sig = `${st.minDepth}:${st.maxDepth}`;
    if (sig !== rangeSig || !rows.length) {
      rangeSig = sig;
      rebuild();
    }
    if (!info.dirty && hoverL < 0 && wasOff !== null) return;

    const t = frame.t;
    const off = !frame.inRange;
    setOff(off, t);
    if (off) return;

    for (const r of rows) updateRow(r, frame.level(r.L));

    const sel = selectedLevel();
    if (sel !== selLevel || (detailRow === null && byLevel.has(sel))) applySelection(sel);
    if (detailRow) updateDetail(frame.level(selLevel), t);

    // keep the header controls in step with the shared range (rings / timeline can change it too)
    if (minSel.value !== String(built.min)) minSel.value = String(built.min);
    if (maxSel.value !== String(built.max)) maxSel.value = String(built.max);

    if (hoverL >= 0 && !byLevel.has(hoverL)) hideTip();
    if (hoverL >= 0 && performance.now() - tipAt > 400) {
      const lv = frame.level(hoverL);
      if (lv) {
        tip.setHtml(tipHtml(hoverL, lv, t));
        tipAt = performance.now();
      }
    }
  }

  function destroy() {
    window.removeEventListener('scroll', onScroll);
    tip.destroy();
    el.classList.remove('ladder');
    el.replaceChildren();
  }

  return {
    alwaysOn: true,
    render,
    destroy,
    /** Levels currently listed (0-based). */
    get levels() {
      return rows.map((r) => r.L);
    },
    goAfter,
    goStart,
    goBefore,
  };
}
