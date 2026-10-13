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
 * Pure mode (docs/design/80-pure.md, SPEC §15, revision 3): the same ladder in Fractonica terms only.
 *   major rows (α β γ δ)  the fracton ordinal and the quarter word ("Trifracton Node": the chip completes "Delta"), a
 *                         four-pip quarter indicator instead of a phase (a major's phase is never drawn);
 *   minor rows            ε by its ordinal (ε#5), η ι λ ν by their count (33η, 29ι), the depths between them (ζ θ κ μ)
 *                         and ξ by the count that places them in their Nuclide (22η, 28ι, 3.43ν); the phase as one pair
 *                         of 2-stroke glyphs (256 states, pure.pairHTML), always the odometer at the displayed instant.
 * Time left is a span over α β γ δ ε η ι λ ν (6ι 43λ, 2.6ν), the end of a cycle is "→ Delta Tetrafracton begins" /
 * "→ 34η begins", real-time leads are counted in Blinks (6.43 Blinks). Notation as in src/core/pure.js: X#n ordinal
 * (δ#3, ε#5), nX count (33η 29ι), "η 7" only on chips; unit names (Nuclide, Helion …) only in tooltips that explain a
 * unit. The mode switches live: render() notices ctx.isPure() changing and rebuilds every label.
 *
 * Contract: export mount(el, ctx) -> { render, alwaysOn, destroy } (docs/ARCHITECTURE.md).
 */
import {
  DEFAULT_MAX_DEPTH,
  JUST_AFTER_S,
  JUST_BEFORE_S,
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
import {
  cycleAddress,
  cycleTitle,
  depthWords,
  endsText,
  leadBlinks,
  leftText,
  lengthText,
  levelSay,
  nextCycle,
  periodBlinks,
  phaseWords,
  quarterWhere,
  quarterWord,
  rowLabel,
  sectorName,
  unitSentence,
  unitWord,
} from './ladder/pure-text.js';
import { attrCell, classCell, createTip, esc, glyphFactory, icons, levelVars, pairCell, reducedMotion, textCell } from './ladder/dom.js';

/** Cycles shorter than this (s) are too fast for a ticking countdown: the row shows the length instead. */
const STATIC_BELOW = 0.5;
/** Cycles shorter than this (s) update their percent only when their countdown digit does (about 10 times a second), not every frame (normal mode; the pure pair is always exact). */
const PCT_STEADY_BELOW = 10;
/** Below this (s) a row's accessible name carries its percent in steps of 10, so it is not rewritten dozens of times a second. */
const LABEL_COARSE_BELOW = 120;
const FRAC_STEPS = 240;
const SEG_CLASS = ['ladder-seg', 'ladder-seg is-done', 'ladder-seg is-cur'];
const QUARTER_FRAC = ['¼', '½', '¾', '1'];
const ROW_ID = (L) => `ladder-opt-${L}`;
/** Two clicks closer than this (ms) on the same spot are one double-click, even when the layout moved in between. */
const DOUBLE_CLICK_MS = 450;

/** The caption under the title and the screen-reader hint, per mode (pure: glyph pair, Blinks, no Earth word). */
const CAPTION = { normal: '% through · time left · bars show the sub-cycles', pure: 'phase glyphs · time left · bars show the sub-cycles' };

/** The child level a cycle's bar segments stand for, as "γ 3 " (the finest level has no named child). */
const childOf = (L) => (L < MAX_DEPTH - 1 ? `${letterOf(L + 1)} ${L + 2} ` : 'finer ');
/** Pure mode never says "γ 3" in a sentence: a major child in words ("Beta "), a minor one by its letter ("θ "). */
const childWord = (pure, L) => (L < MAX_DEPTH - 1 ? `${levelSay(pure, L + 1)} ` : 'finer ');
/** The four-pip quarter indicator of a major period (pure mode: its phase is never drawn); `q` is the current quarter. */
const pipsHTML = (q) => `<span class="ladder-qpips" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i < q ? 'is-done' : i === q ? 'is-cur' : ''}"></i>`).join('')}</span>`;

/** "5th of 13 γ 3 sectors · 57 % through it": where the current segment of the bar is, and how full it is. */
// (no-break spaces after the dot: when the line wraps, it wraps before "· 33 % through it", never inside it)
const sectorText = (L, seg, factor) => `${ordinal(seg.index + 1)} of ${factor} ${childOf(L)}sectors ·\u00a0${Math.min(99, Math.floor(seg.frac * 100))}\u202f%\u00a0through\u00a0it`;

export function mount(el, ctx) {
  const { model, store, fmt, theme } = ctx;
  const QN = ctx.QUARTER_NAMES;
  const glyphStyle = theme.glyphStyle('currentColor', 3.05, { thickness: 0.34 });
  /** Pure vocabulary (ctx.pure) and the mode the DOM is currently built for (null until the first render). */
  const pure = ctx.pure;
  const wantPure = () => !!pure && !!ctx.isPure?.();
  let pureMode = null;

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
      <p class="ladder-cap"></p>
      <div class="ladder-note" hidden>
        <p class="ladder-note-t"></p>
        <button class="btn btn-sm ladder-edge" type="button"></button>
      </div>
      <div class="ladder-list" role="listbox" tabindex="0" aria-labelledby="ladder-title" aria-describedby="ladder-hint"></div>
      <p class="sr-only" id="ladder-hint"></p>
      <button class="ladder-more" type="button"></button>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const capEl = $('.ladder-cap');
  const hintEl = $('#ladder-hint');
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
      <span class="ladder-chip" role="img" aria-label="${pureMode ? esc(depthWords(pure, L)) : `${esc(info.letter)}, depth ${info.depth}`}"><b>${esc(info.letter)}</b><span class="mono">${info.depth}</span></span>
      <span class="ladder-count mono"></span>
      <span class="ladder-left mono"></span>
      <span class="ladder-glyph"${pureMode ? ' aria-hidden="true"' : ''}>${pureMode && pure.isMajor(L) ? pipsHTML(-1) : ''}</span>
      <div class="ladder-prog">
        <div class="ladder-bar">${segs}<span class="ladder-notches" aria-hidden="true"><i></i><i></i><i></i></span></div>
        <span class="ladder-pct mono"></span>
      </div>`;
    const q = (s) => row.querySelector(s);
    const major = !!pureMode && pure.isMajor(L);
    row.classList.toggle('is-major', major);
    const r = {
      L,
      info,
      major, // pure mode, α β γ δ: words and a quarter indicator, never a phase pair
      pips: major ? [...row.querySelectorAll('.ladder-qpips i')] : null,
      q: -1,
      labelFor: null, // cycle (and quarter) the row label was written for (pure)
      el: row,
      segs: [...row.querySelectorAll('.ladder-seg')],
      glyphCell: q('.ladder-glyph'),
      glyph: glyphFactory(model, glyphStyle),
      pair: pure && !major ? pairCell(pure, q('.ladder-glyph')) : null,
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
      nextFor: -1, // cycle whose own name and successor's name are cached in cycleName / nextName (pure mode)
      cycleName: '',
      nextName: null,
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
      <div><dt class="ladder-through-k">Through</dt><dd class="ladder-through mono"><span class="ladder-through-p"></span><span class="ladder-through-q" hidden></span><span class="ladder-through-t"></span></dd></div>
      <div><dt>Sector</dt><dd class="ladder-sector"><span class="ladder-sector-p"></span><span class="ladder-sector-t"></span></dd></div>
    </dl>
    <dl class="ladder-facts ladder-facts-span">
      <div class="ladder-pure-only"><dt>Cycle</dt><dd class="ladder-cyc"><span class="ladder-cyc-n"></span><span class="ladder-cyc-a mono dim"></span></dd></div>
      <div><dt>Started</dt><dd class="ladder-started"></dd></div>
      <div><dt>Length</dt><dd class="ladder-length mono"></dd></div>
      <div><dt class="ladder-saros-k">Saros span</dt><dd class="ladder-saros mono"></dd></div>
    </dl>
    <div class="ladder-actions">
      <button class="btn btn-sm" type="button" data-act="start" tabindex="-1" title="Start: jump to the start of this cycle">${icons.start}<span>Start</span></button>
      <button class="btn btn-sm" type="button" data-act="before" tabindex="-1">${icons.before}<span>Just before</span></button>
      <button class="btn btn-sm ladder-go" type="button" data-act="after" tabindex="-1">${icons.after}<span>Just after</span></button>
    </div>`;
  const D = {
    qList: detail.querySelector('.ladder-q'),
    endK: detail.querySelector('.ladder-end-k'),
    endV: detail.querySelector('.ladder-end-v'),
    endZ: detail.querySelector('.ladder-end-z'),
    throughK: detail.querySelector('.ladder-through-k'),
    throughT: detail.querySelector('.ladder-through-t'),
    throughP: detail.querySelector('.ladder-through-p'),
    throughQ: detail.querySelector('.ladder-through-q'),
    quarterQ: -2, // quarter the detail's pips show (majors)
    sectorT: detail.querySelector('.ladder-sector-t'),
    sectorP: detail.querySelector('.ladder-sector-p'),
    cycN: detail.querySelector('.ladder-cyc-n'),
    cycA: detail.querySelector('.ladder-cyc-a'),
    sarosK: detail.querySelector('.ladder-saros-k'),
    pairThrough: pure ? pairCell(pure, detail.querySelector('.ladder-through-p')) : null,
    pairSector: pure ? pairCell(pure, detail.querySelector('.ladder-sector-p')) : null,
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
  D.setThrough = textCell(D.throughT);
  D.setThroughK = textCell(D.throughK);
  D.setSector = textCell(D.sectorT);
  D.setCycN = textCell(D.cycN);
  D.setCycA = textCell(D.cycA);
  D.setBeforeTip = attrCell(D.beforeBtn, 'title');
  D.setBeforeName = attrCell(D.beforeBtn, 'aria-label');
  D.setAfterTip = attrCell(D.afterBtn, 'title');
  D.setAfterName = attrCell(D.afterBtn, 'aria-label');
  D.setThroughHidden = attrCell(D.throughT, 'aria-hidden'); // the pair next to it carries the name; its digits are not read twice
  D.setStarted = textCell(D.started);
  D.setLength = textCell(D.length);
  D.setLengthTip = attrCell(D.length, 'title'); // pure: which unit a whole cycle of this depth is
  D.setSaros = textCell(D.saros);
  D.q.forEach((q) => {
    q.setTime = textCell(q.time);
    q.setRel = textCell(q.rel);
    q.state = '';
  });
  /** Every write-only-on-change cell of the detail: a mode switch empties their memory so nothing stale survives. */
  const detailCells = [
    D.setEndK, D.setEndV, D.setEndZ, D.setThrough, D.setThroughK, D.setSector, D.setCycN, D.setCycA, D.setBeforeTip, D.setBeforeName,
    D.setAfterTip, D.setAfterName, D.setThroughHidden, D.setStarted, D.setLength, D.setLengthTip, D.setSaros, ...D.q.flatMap((q) => [q.setTime, q.setRel]),
  ];

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
    if (pureMode) return updateDetailPure(lv, t);
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

  /**
   * The detail in pure mode: the cycle that begins where this one ends instead of a date, the length in ladder
   * units (with a tooltip that says what the cycle is), "started" as a span ago, the quarters placed by two tokens of the
   * stamp (ε#2 19η, 33η 9ι) plus the time to go, the cycle's name and letter address. The phase is a glyph pair for a
   * minor cycle and the quarter word for a major one (never a pair); the sector is the child cycle, said the same way.
   * Texts that cannot change inside a cycle are written once per cycle.
   */
  function updateDetailPure(lv, t) {
    const key = `${lv.level}:${lv.cycle}:pure`;
    const info = model.levelInfo(lv.level);
    const major = pure.isMajor(lv.level);
    if (key !== D.key) {
      D.key = key;
      D.next = nextCycle(model, pure, lv.level, lv.cycleBig);
      D.setEndK(D.next ? 'Ends' : 'Catalogue ends');
      D.setEndZ('');
      D.setThroughK(major ? 'Quarter' : 'Phase');
      D.setCycN(cycleTitle(pure, lv.level, lv.cycleBig));
      D.setCycA(cycleAddress(model, pure, lv.level, lv.cycleBig));
      D.setLength(lengthText(model, pure, lv) + (lv.clipped ? ' · clipped' : ''));
      D.setLengthTip(unitSentence(model, pure, lv.level));
      const name = levelSay(pure, lv.level);
      const before = `Just before: jump to ${leadBlinks(pure, justBeforeLead(lv.duration))} before this ${name} cycle ends and watch it turn over (Shift+Enter)`;
      const after = `Just after: jump to ${leadBlinks(pure, JUST_AFTER_S)} into the next ${name} cycle (Enter, or double-click the row)`;
      D.setBeforeTip(before);
      D.setBeforeName(before);
      D.setAfterTip(after);
      D.setAfterName(after);
      const span = positionSpan(lv.cycleBig, info.prefix, model.extent, lv.clipped);
      D.setSaros(`${span.from} → ${span.to}`);
      for (let i = 0; i < 4; i++) {
        const when = lv.thresholds[i + 1]?.time;
        D.q[i].setTime(when == null ? '—' : quarterWhere(model, pure, when, lv.level));
      }
    }
    D.setEndV(D.next ? endsText(D.next) : `in ${leftText(model, pure, t, lv.end)}`);
    D.setStarted(`${leftText(model, pure, lv.start, t)} ago`);
    const still = detailRow.still;
    if (still) {
      D.pairThrough.clear();
      D.pairSector.clear();
      setDetailPips(-2);
      D.setThroughHidden(false);
      D.setThrough('too fast to follow');
      D.setSector('—');
    } else {
      const seg = segmentState(detailRow.pct, lv.factor);
      if (major) {
        // a major period's phase is its quarter word (the pips mark which of the four)
        D.pairThrough.clear();
        setDetailPips(lv.quarter);
        D.setThroughHidden(false);
        D.setThrough(`${quarterWord(pure, detailRow.pct)} · ${lv.quarter + 1} of 4`);
      } else {
        setDetailPips(-2);
        D.pairThrough.set(detailRow.pct, 'phase');
        D.setThroughHidden('true');
        D.setThrough(pure.pairText(detailRow.pct));
      }
      const sec = sectorName(pure, lv, seg.index, seg.frac);
      if (sec.major) D.pairSector.clear();
      else D.pairSector.set(seg.frac, 'sector phase');
      D.setSector(`${sec.name}${sec.quarter ? ` ${sec.quarter}` : ''} · ${seg.index + 1} of ${lv.factor}`);
    }
    for (let i = 0; i < 4; i++) {
      const q = D.q[i];
      const state = still ? 'later' : i < lv.quarter ? 'past' : i === lv.quarter ? 'next' : 'later';
      if (state !== q.state) {
        q.li.className = `ladder-qi is-${state}`;
        q.state = state;
      }
      const when = lv.thresholds[i + 1]?.time;
      if (still) q.setRel(when == null ? '—' : `+${periodBlinks(pure, when - lv.start)}`);
      else q.setRel(state === 'past' ? 'passed' : when == null ? 'after the end' : leftText(model, pure, t, when));
    }
  }
  /** The quarter pips of the detail (majors in pure mode); -2 hides them. Written only when the quarter changes. */
  function setDetailPips(q) {
    if (q === D.quarterQ) return;
    D.quarterQ = q;
    D.throughQ.hidden = q < -1;
    D.throughQ.innerHTML = q < -1 ? '' : pipsHTML(q);
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
      if (r.major) setPips(r, -1); // the indicator stays, all four pips blank
      else r.glyphCell.replaceChildren();
      r.glyphIdx = -2;
      r.pair?.reset();
      r.labelFor = null;
      r.setLabel(`${pureMode ? depthWords(pure, r.L) : `${r.info.letter}, depth ${r.info.depth}`}: outside the catalogue`);
      r.labelKey = '';
      if (r.cur >= 0) for (const s of r.segs) s.className = SEG_CLASS[0];
      r.cur = -1;
      r.fq = -1;
    }
  }

  /** The segmented bar: complete sectors, the current one filled by its exact sub-phase. */
  function updateBar(r, lv) {
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
  }

  /** The quarter indicator of a major row: pips before `q` done, `q` current (-1: none). */
  function setPips(r, q) {
    if (q === r.q) return;
    r.q = q;
    r.pips.forEach((p, i) => {
      p.className = i < q ? 'is-done' : i === q ? 'is-cur' : '';
    });
  }

  /**
   * A row in pure mode. Major rows (α β γ δ): the fracton ordinal and the quarter word ("Trifracton Node"), the time
   * left, the bar and a four-pip quarter indicator; their phase is never drawn. Minor rows: the ordinal of a Nuclide
   * (ε#5) or the count that places the cycle in its Nuclide (33η, 22η, 28ι), the time left (or, for cycles too fast to
   * count down, how long one lasts in Blinks), the bar and the phase as a pair of glyphs (the high digit is the glyph
   * normal mode shows). The pair is the odometer of the cycle at the displayed instant, always: it is rewritten whenever
   * its state changes (a time jump, a fast row), never only with the countdown's last digit.
   */
  function updateRowPure(r, lv, t) {
    setRowOff(r, false);
    // the label: a count is an exact BigInt placing, so it is worked out once per cycle (and per quarter for majors)
    const labelFor = r.major ? `${lv.cycle}:${lv.quarter}` : lv.cycle;
    if (labelFor !== r.labelFor) {
      r.labelFor = labelFor;
      r.setCount(rowLabel(pure, lv));
    }
    r.setClipped(lv.clipped);
    updateBar(r, lv);

    r.setLeft(r.still ? periodBlinks(pure, r.info.meanSeconds) : leftText(model, pure, t, lv.end));
    r.setPct('');

    r.pct = lv.phase;
    if (r.major) setPips(r, lv.quarter);
    else r.pair.set(lv.phase);

    // accessible name: the quarter for majors; the full pair for long minor cycles, the high digit for short ones, so it is rewritten rarely
    const ph = pure.pair(lv.phase);
    const coarse = r.info.meanSeconds < LABEL_COARSE_BELOW;
    const labelKey = `P${r.still ? 'still' : `${lv.cycle}:${r.major ? `q${lv.quarter}` : coarse ? ph.hi : ph.index}`}:${lv.clipped}`;
    if (labelKey !== r.labelKey) {
      r.labelKey = labelKey;
      const head = depthWords(pure, r.L);
      if (r.still) r.setLabel(`${head}: too fast to follow, one cycle lasts ${periodBlinks(pure, r.info.meanSeconds)}`);
      else {
        if (r.nextFor !== lv.cycle) {
          // the cycle's name and what begins at its end: once per cycle (exact BigInt placings, too dear to redo for every phase step of a fast row)
          r.nextFor = lv.cycle;
          r.cycleName = cycleTitle(pure, r.L, lv.cycleBig);
          r.nextName = nextCycle(model, pure, r.L, lv.cycleBig)?.name ?? null;
        }
        const phase = r.major ? `${quarterWord(pure, lv.phase)} quarter` : coarse ? `phase ${ph.hi} of 16` : phaseWords(pure, lv.phase).label;
        const clipped = lv.clipped ? ', clipped by the end of the catalogue' : '';
        r.setLabel(`${head}: ${r.cycleName}, ${lv.local + 1} of ${lv.siblings}, ${phase}, then ${r.nextName ? `${r.nextName} begins` : 'the catalogue ends'}${clipped}`);
      }
    }
  }

  function updateRow(r, lv, t) {
    if (pureMode) return updateRowPure(r, lv, t);
    setRowOff(r, false);
    r.setCount(counterText(r.L, lv.local, lv.siblings));
    r.setClipped(lv.clipped);
    updateBar(r, lv);

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
      const side = t < model.tMin ? 'the start' : 'the end';
      if (pureMode) {
        noteText.textContent = `Outside the catalogue (${pure.catalogueText()}).`;
        edgeBtn.textContent = `Go to ${side} (${pure.stamp(edge, 'beta')})`;
      } else {
        noteText.textContent = `Outside the Saros 141 catalogue (${fmt.parts(model.tMin).year}–${fmt.parts(model.tMax).year}).`;
        edgeBtn.textContent = `Go to ${side} (${fmt.date(edge)})`;
      }
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
    const name = pureMode ? levelSay(pure, lv.level) : lv.name;
    ctx.toast(lv.clipped ? `The last ${name} cycle is clipped by the end of the catalogue` : `This is the last ${name} cycle: the catalogue ends with it`);
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
  /**
   * The tooltip in pure mode: the cycle's name, its phase (a glyph pair for a minor cycle, the quarter word for a major
   * one), the sector it is in (said the same way), what begins at its end, the span left and what the cycle is.
   */
  function tipHtmlPure(L, lv, t) {
    const r = byLevel.get(L);
    if (!r) return '';
    const info = r.info;
    const major = pure.isMajor(L);
    const seg = segmentState(lv.phase, lv.factor);
    const parent = L === 0 ? 'the catalogue' : `its ${levelSay(pure, L - 1)}`;
    const color = theme.levelColor(L);
    const ends = endsText(nextCycle(model, pure, L, lv.cycleBig));
    const unit = unitWord(pure, L);
    const left = r.still
      ? `Too fast to count down: one cycle lasts ${periodBlinks(pure, info.meanSeconds)}.`
      : `${leftText(model, pure, t, lv.end)} left · cycle ${lengthText(model, pure, lv)}${unit ? ` (a ${unit})` : ''}${lv.clipped ? ' (clipped: the catalogue ends first)' : ''}`;
    let through = '';
    if (major) through = `<div class="ladder-tip-ph">${pipsHTML(lv.quarter)}<span>In its <b>${quarterWord(pure, lv.phase)}</b> quarter (${lv.quarter + 1} of 4)</span></div>`;
    else if (!r.still) through = `<div class="ladder-tip-ph">${pure.pairHTML(lv.phase)}<span><b>${pure.pairText(lv.phase)}</b> of 256 through this cycle</span></div>`;
    const sec = sectorName(pure, lv, seg.index, seg.frac);
    const secPhase = sec.major ? `in its ${sec.quarter} quarter` : `${pure.pairHTML(seg.frac, { label: 'sector phase' })} through it`;
    const sector = `The bar has one sector per ${childWord(pure, L)}cycle: now in <b>${esc(sec.name)}</b> (${seg.index + 1} of ${lv.factor}), ${secPhase}.`;
    return `<div class="ladder-tip-h"><b style="color:${color}">${esc(info.letter)} ${info.depth}</b><span>${esc(cycleTitle(pure, L, lv.cycleBig))} · ${lv.local + 1} of ${lv.siblings} in ${esc(parent)}</span></div>
      ${through}
      <div class="dim">${sector}</div>
      <div class="ladder-tip-end">${lv.clipped ? 'Catalogue ends' : 'Ends'} <b>${esc(ends)}</b></div>
      <div class="dim">${esc(left)}</div>
      <div class="ladder-tip-hint dim">Click to select · double-click for Just after</div>`;
  }
  function tipHtml(L, lv, t) {
    if (pureMode) return tipHtmlPure(L, lv, t);
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
  // normal <-> pure mode
  // ---------------------------------------------------------------------------
  /**
   * Switch the whole card to a mode: static labels, the facts' headings, the rows (rebuilt by the next
   * render, which then writes every text again) and every cell's memory, so nothing of the other mode survives.
   */
  function applyMode(next) {
    pureMode = next;
    el.classList.toggle('is-pure', next);
    capEl.textContent = next ? CAPTION.pure : CAPTION.normal;
    hintEl.textContent = next
      ? `Up and down arrows choose a depth. Enter is Just after the end of the selected cycle (${leadBlinks(pure, JUST_AFTER_S)} into the next one), Shift plus Enter is Just before it (${leadBlinks(pure, JUST_BEFORE_S)} ahead, or a quarter of a shorter cycle), and the open bracket key goes to its start. A Blink is the clock's real-time tick. Press ? for the glossary.`
      : 'Up and down arrows choose a depth. Enter is Just after the end of the selected cycle (1 ms into the next one), Shift plus Enter is Just before it (two seconds ahead, or a quarter of a shorter cycle), and the open bracket key goes to its start.';
    D.sarosK.textContent = next ? 'Position' : 'Saros span';
    for (const c of detailCells) c.reset();
    D.setThroughK(next ? 'Phase' : 'Through'); // pure majors say 'Quarter' (updateDetailPure)
    D.quarterQ = -2;
    D.throughQ.hidden = true;
    D.throughQ.replaceChildren();
    D.length.removeAttribute('title'); // the unit sentence of pure mode
    for (const [view, cell] of [[D.pairThrough, D.throughP], [D.pairSector, D.sectorP]]) {
      view?.reset();
      cell.replaceChildren();
    }
    D.throughT.removeAttribute('aria-hidden'); // set beside the pure pair only
    // the quarters are placed by two tokens of the stamp ("ε#2 19η", "33η 9ι"): said once, where they are listed
    if (next) D.qList.title = 'Where each quarter ends: ordinals (ε#2) count from 1, counts (19η) are completed units from 0. Press ? for the glossary.';
    else D.qList.removeAttribute('title');
    D.key = '';
    D.next = null;
    for (const q of D.q) q.state = '';
    rangeSig = ''; // render() rebuilds the rows in the new mode
    wasOff = null; // and writes the catalogue note again
    hideTip();
  }

  // ---------------------------------------------------------------------------
  // frame loop
  // ---------------------------------------------------------------------------
  function render(frame, info) {
    lastFrame = frame;
    const want = wantPure();
    if (want !== pureMode) applyMode(want);
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

    for (const r of rows) updateRow(r, frame.level(r.L), t);

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
