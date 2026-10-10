/**
 * The pure calendar (right half of the Calendar tab in pure mode): one δ (Atom) page as 5 rows (ε) x 7 columns (ζ).
 *
 * The page is a ruler. Every cell is a whole ζ cycle (Hadron) with its number 1..35; a band along the bottom shows the
 * 11 η cycles that run through it at their exact fractional position (labelled with their counter 0..10 inside the ζ),
 * the node mark of each η, and the solar sync quarters as gold diamonds. The corner of a cell names what is in it: the
 * eclipse (#22, numbered like the position; its mark sits at the fraction 0, ¼, ½ or ¾ of the cell where it falls) and
 * the number of a solar sync that begins there (S4821). The 256-state ε phase pair is in the tooltip and the
 * inspector. The shown moment is a cursor in its cell; the live clock marks its cell in red.
 * Header: ◀ ▶ over δ, γ (5 δ), β (13 γ) and α (5 β), the address strip α β γ δ, "Now", and under the page a ribbon of
 * the five δ of the γ with the ε rhythm (5 ε per δ).
 *
 * Notation (core/pure.js): X#n is an ordinal from 1 (δ#3, ζ#6, η#3), nX a count from 0 (the band's η counters, 9ι).
 * Geometry and data come from ./pure-conv.js (positions, exact integer tick maths); this file is DOM only. Nothing
 * here says a Gregorian date, a weekday, a month, a year or a percentage. Unit names (Atom, Hadron, Helion) are used in
 * tooltips and the legend, where a unit is explained; the compact text keeps the Greek letters.
 */
import { GOLD, levelColor } from '../../core/theme.js';
import { LEVEL_NAMES, UNITS } from '../../core/pure.js';
import { h, ICONS, esc, setText, setHtml, setStyle, setAttr, toggleClass, hasSound, hearMoment, loadPrefs, savePrefs } from './dom.js';
import { LETTERS, cycleLabel, pointOfCycle } from './convert.js';
import { CELLS_PER, ETA_PER_CELL, GRID, PAGES_PER, buildPureGrid, buildRibbon, cellFraction, cellOfTime, cellTime, clampView, countText, cycleStart, madeOf, overlayCycle, spanText, viewCount, viewFromPath, viewInfo, viewOfTime } from './pure-conv.js';

const PREFS_KEY = 'fractonica-clock/calendar/pure/v1';
/** The cycle level the band shows: δ ε ζ (a cycle is a whole number of cells) or η (11 cycles inside the cell). */
const OVERLAYS = [3, 4, 5, 6].map((level) => ({ level, sym: LETTERS[level], title: `${LEVEL_NAMES[level]} · ${UNITS[level].name} · depth ${level + 1}` }));
const overlayOf = (level) => OVERLAYS.find((o) => o.level === Number(level)) ?? OVERLAYS[3];
/** What the ◀ ▶ buttons step by, in δ pages: one δ, a γ (5 δ), a β (13 γ), an α (5 β). */
const STEPS = [
  { id: 'delta', sym: 'δ', pages: 1, name: 'δ', level: 3 },
  { id: 'gamma', sym: 'γ', pages: PAGES_PER.gamma, name: 'γ', level: 2 },
  { id: 'beta', sym: 'β', pages: PAGES_PER.beta, name: 'β', level: 1 },
  { id: 'alpha', sym: 'α', pages: PAGES_PER.alpha, name: 'α', level: 0 },
];
const pct = (x) => (x * 100).toFixed(3) + '%';

export function createPureMonth(ctx, { tip }) {
  const { model, store, pure } = ctx;
  const prefs = loadPrefs(PREFS_KEY, { step: 'delta', overlay: 6 });
  const V = {
    hv: -1,
    follow: true,
    pendingFollow: true,
    grid: null,
    cells: [],
    shownIdx: -1,
    liveIdx: -1,
    overlay: overlayOf(prefs.overlay).level,
    curSeg: '',
    hotSeg: '',
    lastRebuild: 0,
    lastLive: 0,
    focusZ: null,
    inspectKey: '',
    ribbonKey: '',
    ribbon: null,
    active: true,
    elapsedKey: '',
  };
  const total = () => viewCount(model);
  let step = STEPS.find((x) => x.id === prefs.step) ?? STEPS[0];

  // ------------------------------------------------------------------------------------------
  // static chrome
  // ------------------------------------------------------------------------------------------
  const iconBtn = (icon, label, fn, cls = '') => {
    const b = h('button.btn.btn-icon.btn-sm.cal-nb' + cls, { type: 'button', html: icon, title: label, 'aria-label': label });
    b.addEventListener('click', fn);
    return b;
  };
  const hPrev = iconBtn(ICONS.prev, 'Back one δ', () => stepView(-step.pages));
  const hNext = iconBtn(ICONS.next, 'Forward one δ', () => stepView(step.pages));
  const titleMain = h('div.cal-pm-tm');
  const titleSub = h('div.cal-pm-ts');
  const title = h('div.cal-pm-title', { 'aria-live': 'polite' }, titleMain, titleSub);
  const nowBtn = h('button.btn.btn-sm.cal-today', { type: 'button', text: 'Now', title: 'Show the page of the live clock' });
  const shownBtn = h('button.btn.btn-sm.cal-shown.is-away', { type: 'button', html: ICONS.target + '<span>Shown cell</span>', title: 'Return to the page of the shown moment' });
  // the address strip: α β γ δ (each a select; the page follows)
  const addrSels = [];
  const addrStrip = h('div.cal-pm-addr', { role: 'group', 'aria-label': 'Address of the page' });
  const addrSpec = [
    { key: 'alpha', sym: 'α', name: 'Alpha', level: 0, count: () => Number(model.clock.count(0)) },
    { key: 'beta', sym: 'β', name: 'Beta', level: 1, count: () => 5 },
    { key: 'gammaOrd', sym: 'γ', name: 'Gamma', level: 2, count: () => 13 },
    { key: 'delta', sym: 'δ', name: 'Delta', level: 3, count: () => PAGES_PER.gamma },
  ];
  for (const spec of addrSpec) {
    const sel = h('select.select.cal-pm-sel', { 'aria-label': `${spec.name} of the page`, style: `--lv:${levelColor(spec.level)}` });
    for (let n = 1; n <= spec.count(); n++) sel.append(h('option', { value: String(n), text: String(n) }));
    sel.addEventListener('change', () => {
      const cur = viewInfo(model, V.hv);
      const v = { alpha: cur.alpha, beta: cur.beta, gammaOrd: cur.gammaOrd, delta: cur.delta, [spec.key]: Number(sel.value) };
      setView(viewFromPath(model, v.alpha, v.beta, v.gammaOrd, v.delta));
    });
    addrSels.push({ spec, sel });
    addrStrip.append(h('label.cal-pm-addrf', { style: `--lv:${levelColor(spec.level)}` }, h('span.cal-pm-addrl', { text: `${spec.sym}#`, title: spec.name }), sel));
  }
  const stepSeg = h('div.seg.cal-pm-step', { role: 'group', 'aria-label': 'The arrows step by' });
  const stepBtns = STEPS.map((st) => {
    const b = h('button', { type: 'button', text: st.sym, 'aria-pressed': String(st === step), title: `Step by one ${st.name} (${st.pages === 1 ? 'one page' : st.pages + ' pages'})`, style: `--c:${levelColor(st.level)}` });
    b.addEventListener('click', () => {
      step = st;
      savePrefs(PREFS_KEY, { step: st.id });
      stepBtns.forEach(([s2, b2]) => b2.setAttribute('aria-pressed', String(s2 === st)));
      applyStepLabels();
    });
    stepSeg.append(b);
    return [st, b];
  });
  function applyStepLabels() {
    for (const [btn, dir] of [[hPrev, 'Back'], [hNext, 'Forward']]) {
      const label = `${dir} one ${step.name}`;
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
  }
  applyStepLabels();
  addrStrip.append(stepSeg);
  const legend = h('div.cal-legend.cal-pm-legend');
  const ovSeg = h('div.seg.cal-ovseg', { role: 'group', 'aria-label': 'Cycle band level' });
  const ovBtns = OVERLAYS.map((o) => {
    const b = h('button', { type: 'button', text: o.sym, title: o.title, 'aria-pressed': String(o.level === V.overlay) });
    b.style.setProperty('--c', levelColor(o.level));
    b.addEventListener('click', () => {
      setOverlay(o.level);
      ctx.select(o.level); // the band level is the app-wide selected level
    });
    ovSeg.append(b);
    return [o, b];
  });
  function setOverlay(level) {
    if (V.overlay === level) return;
    V.overlay = level;
    prefs.overlay = level;
    savePrefs(PREFS_KEY, { step: step.id, overlay: level });
    ovBtns.forEach(([o, b]) => b.setAttribute('aria-pressed', String(o.level === level)));
    V.grid = null;
    ctx.requestRender();
  }
  // selecting δ..η anywhere in the app (ladder, face, converter) puts that level in the band
  const unsubSel = store.subscribe((kind, patch) => {
    if (kind === 'settings' && patch && 'selectedLevel' in patch && patch.selectedLevel >= 3 && patch.selectedLevel <= 6) setOverlay(patch.selectedLevel);
  });
  const legendHtml = () => {
    const lv = V.overlay;
    const swatch = `<span class="cal-lg-sw" style="--c:${levelColor(lv)}"></span>`;
    const head = 'Rows <b>ε#</b>1–5 · columns <b>ζ#</b>1–7: a cell is one ζ (a Hadron). ';
    const tail = ` <span class="cal-pm-lgs"></span> a solar sync quarter · <b class="cal-pm-lgt">#22</b> an eclipse, marked where it falls in its cell · <b class="cal-pm-lgt">S4821</b> a sync that begins here. # numbers count from 1, counters from 0. Press ? for the glossary.`;
    if (lv === 6) return `${swatch}<span>${head}The band is the 11 <b>η</b> (Helions) of the cell with their counters 0–10; the tick in each is its node, <b>18ι</b> of 36;${tail}</span>`;
    const info = model.levelInfo(lv);
    const cells = CELLS_PER[lv];
    const n = Math.min(5, info.siblings);
    return `${swatch}<span>${head}The band is the <b>${LETTERS[lv]}</b> cycles: <b>${cycleLabel(lv, n)}</b> is the ${n}th ${LETTERS[lv]} inside its ${LETTERS[lv - 1]}; each lasts ${cells === 1 ? 'one cell' : cells + ' cells'}. A bold label marks where one begins, a paler one continues it;${tail}</span>`;
  };
  function paintLegend() {
    legend.innerHTML = legendHtml();
    el.style.setProperty('--cal-c', levelColor(V.overlay));
  }

  const gridEl = h('div.cal-pm-grid', { role: 'group', 'aria-label': 'ζ cells of the page' });
  const cursor = h('span.cal-cursor', { 'aria-hidden': 'true' });
  const inspector = h('div.cal-inspect', { 'aria-live': 'polite' });
  const hearBtn = h('button.btn.btn-sm.cal-hear.cal-hear-day', { type: 'button', html: ICONS.sound + '<span>Hear this moment</span>', title: 'Hear this moment: a short chord of the shown moment', hidden: true });
  hearBtn.addEventListener('click', () => hearMoment(ctx, store.t()));
  const inspectWrap = h('div.cal-inspwrap', null, inspector, hearBtn);

  const ribbonEl = h('div.cal-ribbon');
  const ribbonSum = h('p.cal-ysum');
  const ribCursor = h('span.cal-rcursor', { 'aria-hidden': 'true' });
  const ribTitle = h('span.cal-ytitle');

  const el = h(
    'section.card.cal-month.cal-pmonth',
    { 'aria-label': 'Calendar of cycles' },
    h('header.card-h', null, h('h2', { text: 'Calendar' }), h('span.spacer'), h('span.cal-pm-hsub.dim', { text: 'one δ = 5ε × 7ζ' })),
    h(
      'div.card-b.cal-month-body',
      null,
      h('div.cal-nav.cal-pm-nav', null, hPrev, title, hNext, h('span.spacer'), shownBtn, nowBtn),
      addrStrip,
      h('div.cal-ovrow', null, h('span.cal-lab', { text: 'Cycle band' }), ovSeg, legend),
      h('div.cal-gridwrap', null, gridEl),
      h('div.cal-year', null, h('div.cal-yh', null, ribTitle), ribbonEl, ribbonSum),
      inspectWrap,
    ),
  );

  // ------------------------------------------------------------------------------------------
  // navigation of the page
  // ------------------------------------------------------------------------------------------
  function setView(hv, { keepFollow = false } = {}) {
    hv = clampView(model, hv);
    if (hv === V.hv) {
      V.focusZ = null;
      return;
    }
    V.hv = hv;
    if (!keepFollow) V.follow = false;
    V.grid = null;
    ctx.requestRender();
  }
  const stepView = (d) => setView(V.hv + d);
  nowBtn.addEventListener('click', () => {
    const hv = viewOfTime(model, store.realNow());
    if (hv !== null) setView(hv);
    V.focusZ = null;
  });
  shownBtn.addEventListener('click', () => {
    V.follow = true;
    V.pendingFollow = true;
    ctx.requestRender();
  });
  const unsubTime = store.onTime((reason) => {
    if (reason === 'rate' || reason === 'pause' || reason === 'edge') return;
    V.follow = true;
    V.pendingFollow = true;
  });

  // ------------------------------------------------------------------------------------------
  // grid building
  // ------------------------------------------------------------------------------------------
  const cellStampText = (c) => `δ#${V.info.delta} · ε#${c.row + 1} · ζ#${c.col + 1}`;
  /** Where in its cell an eclipse falls: 0, ¼, ½, ¾ of the cell. */
  const ECL_WHERE = { 0: 'at the start of', 0.25: 'a quarter of the way into', 0.5: 'in the middle of', 0.75: 'three quarters of the way into' };
  const eclWhere = (c) => ECL_WHERE[c.eclipseFrac] ?? `at ${c.eclipseFrac.toFixed(2)} of`;
  function cellLabel(c) {
    const ecl = c.eclipse >= 0 ? `, eclipse number ${c.eclipse} ${eclWhere(c)} the cell` : '';
    const sync = c.syncs?.find((s) => s.q === 0);
    const syn = sync ? `, solar sync S${sync.sync} begins here` : '';
    if (!c.inRange) return `Cell ${c.ord}: ζ#${c.col + 1} of ε#${c.row + 1}, outside the catalogue`;
    return `Cell ${c.ord}: ζ#${c.col + 1} of ε#${c.row + 1}, ${pure.cycleName(5, c.z)}${ecl}${syn}`;
  }
  /** The corner of a cell: the eclipse inside it and the solar sync that begins in it (aria-hidden: the cell's label says it). */
  function tagsHtml(c) {
    const tags = [];
    if (c.eclipse >= 0) tags.push(`<b class="cal-pm-tag is-ecl">${esc(pure.eclipseName(c.eclipse))}</b>`);
    const sync = c.syncs.find((s) => s.q === 0);
    if (sync) tags.push(`<b class="cal-pm-tag is-sync">S${sync.sync}</b>`);
    return tags.length ? `<span class="cal-pm-tags${tags.length > 1 ? ' has-both' : ''}" aria-hidden="true">${tags.join('')}</span>` : '';
  }

  function bandHtml(c) {
    let s = '';
    if (V.overlay === 6) {
      // 11 η per cell, whole cycles: [j/11, (j+1)/11). The counter labels thin out with the width (CSS, data-estep).
      for (const e of c.etas) {
        s += `<i class="cal-pm-seg is-eta${e.odd ? ' is-odd' : ''} is-start${e.local % 2 === 0 ? ' k2' : ''}${e.local % 5 === 0 ? ' k5' : ''}${e.local > 9 ? ' is-wide' : ''}" data-lv="6" data-idx="${e.eta}" style="left:${pct(e.x0)};width:${pct(e.x1 - e.x0)}"><b>${e.local}</b></i>`;
      }
      for (const q of c.quarters) if (q.q === 2) s += `<u class="cal-pm-q q${q.q}" style="left:${pct(q.x)}"></u>`;
    } else {
      // δ ε ζ: a cycle is a whole number of cells, so the band is one segment per cell, labelled where the cycle begins
      // (and again at the start of every row it continues into)
      const cy = overlayCycle(model, c.z, V.overlay);
      const label = cy.startsHere || c.col === 0 ? cycleLabel(V.overlay, cy.local) : '';
      s += `<i class="cal-pm-seg is-wideseg${cy.idx & 1 ? ' is-odd' : ''}${cy.startsHere ? ' is-start' : ' is-cont'}" data-lv="${V.overlay}" data-idx="${cy.idx}" style="left:0;width:100%"><b>${label}</b></i>`;
    }
    for (const sy of c.syncs) s += `<s class="cal-pm-s${sy.q === 0 ? ' is-start' : ''}" data-sync="${sy.sync}" data-q="${sy.q}" style="left:${pct(sy.x)}"></s>`;
    return s;
  }
  /** The eclipse of a cell: a gold hairline through the band and the icon above it, both at the fraction where it falls. */
  function eclipseHtml(c) {
    if (c.eclipse < 0) return '';
    const at = c.eclipseFrac;
    const icon = at === 0 ? 'left:2px' : `left:${pct(at)};transform:translateX(-50%)`;
    return `<span class="cal-pm-ecl" aria-hidden="true" style="${icon}">${ICONS.eclipse}</span><span class="cal-pm-eline" aria-hidden="true" style="left:${pct(at)}"></span>`;
  }

  function rebuild() {
    const t0 = performance.now();
    const grid = buildPureGrid(model, V.hv);
    V.grid = grid;
    V.info = viewInfo(model, V.hv);
    gridEl.textContent = '';
    let html = '<div class="cal-pm-corner" aria-hidden="true"></div>';
    for (let c = 0; c < GRID.cols; c++) html += `<div class="cal-pm-ch${c === 0 ? ' is-first' : ''}" aria-hidden="true"><i>ζ#</i>${c + 1}</div>`;
    for (let r = 0; r < GRID.rows; r++) {
      html += `<div class="cal-pm-rh${r === 0 ? ' is-first' : ''}" aria-hidden="true"><i>ε#</i>${r + 1}</div>`;
      for (let c = 0; c < GRID.cols; c++) {
        const cell = grid.cells[r * GRID.cols + c];
        html +=
          `<div class="cal-pm-cell${cell.inRange ? '' : ' is-out'}${cell.partial ? ' is-partial' : ''}${cell.col === 6 ? ' is-last' : ''}" data-i="${cell.index}">` +
          `<button type="button" class="cal-pm-day" tabindex="-1"><span class="cal-pm-num">${cell.ord}</span></button>` +
          (cell.inRange ? tagsHtml(cell) : '') +
          eclipseHtml(cell) +
          (cell.inRange ? `<div class="cal-pm-band">${bandHtml(cell)}</div>` : '') +
          (cell.partial ? `<span class="cal-pm-cut" aria-hidden="true" style="left:${pct(cell.cut)}"></span>` : '') +
          `</div>`;
      }
    }
    gridEl.innerHTML = html;
    V.cells = [...gridEl.querySelectorAll('.cal-pm-cell')].map((ce, i) => ({ el: ce, day: ce.querySelector('.cal-pm-day'), band: ce.querySelector('.cal-pm-band'), data: grid.cells[i] }));
    V.cells.forEach((c) => c.day.setAttribute('aria-label', cellLabel(c.data)));
    V.shownIdx = -1;
    V.liveIdx = -1;
    V.curSeg = '';
    V.hotSeg = '';
    V.inspectKey = '';
    V.elapsedKey = '';
    // roving tabindex: the cell kept in focus, else the shown cell, the live cell, the first one
    const focus = V.focusZ !== null ? V.cells.findIndex((c) => c.data.z === V.focusZ) : -1;
    const at = (t) => {
      const i = cellOfTime(model, grid, t);
      return i >= 0 ? i : -1;
    };
    setRoving(focus >= 0 ? focus : [at(store.t()), at(store.realNow())].find((i) => i >= 0) ?? 0);
    if (focus >= 0) {
      V.cells[focus].day.focus({ preventScroll: true });
      V.focusZ = null;
    }
    // title and selects
    const info = V.info;
    setHtml(titleMain, `<span style="color:${levelColor(2)}">γ#${info.gammaOrd}</span> · <span style="color:${levelColor(3)}">δ#${info.delta}</span>`);
    setText(titleSub, pure.periodName(3, info.delta));
    setAttr(title, 'title', [pure.periodName(0, info.alpha), pure.periodName(1, info.beta), pure.periodName(2, info.gammaOrd), pure.periodName(3, info.delta)].join(' › '));
    for (const { spec, sel } of addrSels) sel.value = String(info[spec.key]);
    paintLegend();
    buildRibbon_();
    V.lastRebuild = performance.now();
    V.lastBuildMs = V.lastRebuild - t0;
    updateMarkers(true);
  }

  function setRoving(idx) {
    V.cells.forEach((c, i) => c.day.setAttribute('tabindex', i === idx ? '0' : '-1'));
  }

  // ------------------------------------------------------------------------------------------
  // interactions
  // ------------------------------------------------------------------------------------------
  const cellOf = (target) => {
    const ce = target.closest?.('.cal-pm-cell');
    return ce ? V.cells[Number(ce.dataset.i)] : null;
  };
  const segOf = (target) => {
    const ee = target.closest?.('.cal-pm-seg');
    return ee ? { el: ee, level: Number(ee.dataset.lv), idx: Number(ee.dataset.idx), key: `${ee.dataset.lv}:${ee.dataset.idx}`, cell: cellOf(ee) } : null;
  };
  const syncOf = (target) => {
    const se = target.closest?.('.cal-pm-s');
    return se ? { el: se, sync: Number(se.dataset.sync), q: Number(se.dataset.q), cell: cellOf(se) } : null;
  };

  /** Where the shown moment sits inside ITS cell (0..1): a click on another cell goes to the same offset. */
  function shownOffset() {
    const i = V.shownIdx;
    if (i >= 0 && V.cells[i]) return cellFraction(model, V.cells[i].data, store.t());
    return 0;
  }
  function gotoCell(c, mode) {
    if (!c.data.inRange) {
      ctx.toast(`Outside the catalogue (${pure.catalogueText()})`);
      return;
    }
    const x = mode === 'middle' ? 0.5 : mode === 'start' ? 0 : shownOffset();
    ctx.goto(model.clamp(cellTime(model, c.data, x)));
  }

  const coarseMq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  gridEl.addEventListener('click', (e) => {
    const seg = segOf(e.target);
    if (seg && seg.cell?.data.inRange) {
      // a thumb cannot aim at the thin band: on touch the first tap on another cell only selects that cell
      const touch = e.pointerType ? e.pointerType === 'touch' : !!coarseMq?.matches;
      if (touch && seg.cell.data.index !== V.shownIdx) {
        setRoving(seg.cell.data.index);
        gotoCell(seg.cell);
        return;
      }
      const t = cycleStart(model, seg.level, seg.idx);
      if (t !== null) ctx.goto(model.clamp(t));
      return;
    }
    const sy = syncOf(e.target);
    if (sy) {
      const s = model.solarSyncByNumber(sy.sync);
      if (s) ctx.goto(model.clamp(s.start + (sy.q / 4) * (s.end - s.start) + (sy.q ? 0.001 : 0.001)));
      return;
    }
    const c = cellOf(e.target);
    if (c && e.target.closest('.cal-pm-day, .cal-pm-ecl')) {
      setRoving(c.data.index);
      if (e.detail === 0) V.focusZ = c.data.z; // keyboard: keep the focus on this cell when the page is rebuilt
      gotoCell(c);
    }
  });
  gridEl.addEventListener('dblclick', (e) => {
    if (segOf(e.target) || syncOf(e.target)) return;
    const c = cellOf(e.target);
    if (c && e.target.closest('.cal-pm-day')) gotoCell(c, 'middle');
  });

  gridEl.addEventListener('pointerover', (e) => hover(e));
  gridEl.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || tip.el.hidden) return;
    hover(e);
  });
  function hover(e) {
    if (e.pointerType === 'touch') return;
    const sy = syncOf(e.target);
    if (sy) {
      setHot('');
      tip.show(syncTipHtml(sy.sync, sy.q), e.clientX, e.clientY);
      return;
    }
    const seg = segOf(e.target);
    if (seg && seg.cell?.data.inRange) {
      setHot(seg.key);
      tip.show(cycleTipHtml(seg.level, seg.idx), e.clientX, e.clientY);
      return;
    }
    setHot('');
    const c = cellOf(e.target);
    if (c && e.target.closest('.cal-pm-day, .cal-pm-ecl, .cal-pm-tags')) tip.show(cellTipHtml(c.data), e.clientX, e.clientY);
    else tip.hideSoon();
  }
  gridEl.addEventListener('pointerleave', () => {
    setHot('');
    tip.hideSoon();
  });
  gridEl.addEventListener('focusin', (e) => {
    const c = cellOf(e.target);
    if (c && e.target.classList.contains('cal-pm-day')) {
      setRoving(c.data.index);
      if (e.target.matches(':focus-visible')) {
        const r = e.target.getBoundingClientRect();
        tip.show(cellTipHtml(c.data), r.left + r.width * 0.6, r.top + r.height * 0.5);
      }
    }
  });
  gridEl.addEventListener('focusout', () => tip.hide());

  function setHot(key) {
    if (V.hotSeg === key) return;
    for (const b of gridEl.querySelectorAll('.cal-pm-seg.is-hot')) b.classList.remove('is-hot');
    V.hotSeg = key;
    if (key) {
      const [lv, idx] = key.split(':');
      for (const b of gridEl.querySelectorAll(`.cal-pm-seg[data-lv="${lv}"][data-idx="${idx}"]`)) b.classList.add('is-hot');
    }
  }

  gridEl.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.classList?.contains('cal-pm-day')) return;
    const c = cellOf(t);
    if (!c) return;
    const i = c.data.index;
    let delta = null;
    if (e.key === 'ArrowLeft') delta = -1;
    else if (e.key === 'ArrowRight') delta = 1;
    else if (e.key === 'ArrowUp') delta = -GRID.cols;
    else if (e.key === 'ArrowDown') delta = GRID.cols;
    else if (e.key === 'Home') delta = -(i % GRID.cols);
    else if (e.key === 'End') delta = GRID.cols - 1 - (i % GRID.cols);
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const dir = e.key === 'PageUp' ? -1 : 1;
      // the same cell of the neighbouring page (a γ further with Shift)
      const pages = e.shiftKey ? PAGES_PER.gamma : 1;
      V.focusZ = c.data.z + dir * pages * GRID.cells;
      setView(V.hv + dir * pages);
      return;
    }
    if (delta === null) return;
    e.preventDefault();
    const j = i + delta;
    if (j >= 0 && j < V.cells.length) {
      setRoving(j);
      V.cells[j].day.focus();
      return;
    }
    // leave the page: move the view and keep the focus on the same cell number
    V.focusZ = c.data.z + delta;
    setView(V.hv + (delta < 0 ? -1 : 1));
  });

  // ------------------------------------------------------------------------------------------
  // tooltips
  // ------------------------------------------------------------------------------------------
  const rel = (t) => {
    const T = store.t();
    if (Math.abs(t - T) < 0.0005) return 'at the shown moment';
    const text = spanText(model, pure, Math.min(T, t), Math.max(T, t));
    return t > T ? `in ${text}` : `${text} ago`;
  };
  function cellTipHtml(c) {
    let html = `<div class="cal-tt-h">${esc(cellStampText(c))}</div>`;
    if (!c.inRange) return html + `<div class="dim">Outside the catalogue<br>${esc(pure.catalogueText())}</div>`;
    html += `<div class="dim">cell ${c.ord} of 35 · ${esc(pure.cycleName(5, c.z))}</div>`;
    html += `<div class="mono cal-tt-addr">${esc(pure.stamp(c.start, 'zeta'))}</div>`;
    html += `<div class="cal-tt-pair">${pure.pairHTML(c.epsPhase, { label: 'ε phase' })}<span class="dim">ε phase at the start · <span class="mono">${esc(pure.pairText(c.epsPhase))}</span></span></div>`;
    html += `<div class="dim">starts ${esc(rel(c.start))} · pos ${c.pos0.toFixed(6)}</div>`;
    if (c.eclipse >= 0) html += `<div class="cal-tt-ecl">${ICONS.eclipse}<span>Saros 141 eclipse ${esc(pure.eclipseName(c.eclipse))} ${eclWhere(c)} this cell</span></div>`;
    for (const sy of c.syncs.filter((s) => s.q === 0)) html += `<div class="cal-tt-sync"><span class="cal-pm-lgs"></span><span>Solar sync ${sy.sync} begins in this cell</span></div>`;
    html += '<div class="dim cal-tt-hint">Click: this ζ at the shown offset.<br>Double-click: its middle.</div>';
    return html;
  }
  function cycleTipHtml(level, idx) {
    const col = levelColor(level);
    const info = model.levelInfo(level);
    const local = (idx % info.siblings) + 1;
    const path = model.cycleToPath(level, BigInt(idx));
    const times = [0, 1, 2, 3, 4].map((q) => pointOfCycle(model, level, idx, q / 4));
    const names = level === 6 ? ['starts', 'peak (9ι)', 'node (18ι)', 'valley (27ι)', 'ends'] : ['starts', 'peak', 'node', 'valley', 'ends'];
    const T = store.t();
    let next = -1;
    for (let i = 0; i < 5; i++) {
      if (times[i] !== null && times[i] > T) {
        next = i;
        break;
      }
    }
    // "starts 2ε 6ζ ago", then how far into the cycle each threshold lies ("+9ι"); the next one also says when it comes
    const len = 4 / info.prefixNum;
    const into = (i) => `+${pure.durationPos((len * i) / 4, { parts: level === 6 ? 1 : 2 })}`;
    const rows = times
      .map((t, i) => {
        if (t === null) return '';
        const text = i === 0 ? rel(t) : `${into(i)}${i === next ? ' · ' + rel(t) : ''}`;
        return `<dt>${i === next ? '▸ ' : ''}${names[i]}</dt><dd${i === next ? ' class="is-next"' : ''}>${esc(text)}</dd>`;
      })
      .join('');
    const cur = T >= (times[0] ?? Infinity) && T < (times[4] ?? Infinity);
    // the identity is the ordinal (η#3 · Eta Trifracton); an η also has the clock counter the header counts (2η: two completed)
    const head = cycleLabel(level, local);
    const counter = level === 6 ? `<div class="dim">clock counter ${esc(countText('η', local - 1))}: ${local - 1} η completed in its ζ when it begins</div>` : '';
    // the unit this cycle is one of, in words: "Helion · 11 per ζ, 36ι each"
    const made = madeOf(model, pure, level);
    const unit = `${pure.unitName(LETTERS[level])} · ${info.siblings} per ${LETTERS[level - 1]}${made ? `, lasts ${made}` : ''} · `;
    return (
      `<div class="cal-tt-h" style="color:${col}">${esc(head)}<span class="dim"> · ${esc(pure.cycleName(level, idx))}</span>${cur ? ' <span class="chip cal-chip is-info">shown</span>' : ''}</div>` +
      counter +
      `<div class="mono cal-tt-addr">${esc(path.map((n, L) => cycleLabel(L, n)).slice(3).join(' '))}</div>` +
      `<dl class="cal-tt-dl">${rows}</dl>` +
      `<div class="dim cal-tt-hint">${esc(unit)}global index ${idx} · click to go to its start</div>`
    );
  }
  function syncTipHtml(n, q) {
    const s = model.solarSyncByNumber(n);
    if (!s) return '';
    const len = s.end - s.start;
    const names = ['start', 'peak', 'node', 'valley'];
    const t = s.start + (q / 4) * len;
    return (
      `<div class="cal-tt-h" style="color:${GOLD}">Solar sync ${n} · ${names[q]}</div>` +
      `<div class="dim">quarter ${q + 1} of 4 begins here · ${esc(rel(t))}</div>` +
      `<dl class="cal-tt-dl"><dt>sync starts</dt><dd>${esc(rel(s.start))}</dd><dt>sync ends</dt><dd>${esc(rel(s.end))}</dd><dt>length</dt><dd>19η</dd></dl>` +
      `<div class="dim cal-tt-hint">Click to go to this quarter.</div>`
    );
  }

  // ------------------------------------------------------------------------------------------
  // per-frame markers
  // ------------------------------------------------------------------------------------------
  function updateMarkers(force = false) {
    if (!V.grid) return;
    const T = store.t();
    let idx = cellOfTime(model, V.grid, T);
    if (idx !== V.shownIdx || force) {
      const was = V.shownIdx;
      if (was >= 0 && V.cells[was]) V.cells[was].el.classList.remove('is-shown');
      V.shownIdx = idx;
      if (idx >= 0) {
        V.cells[idx].el.classList.add('is-shown');
        V.cells[idx].el.append(cursor);
        cursor.hidden = false;
      } else cursor.hidden = true;
      V.curSeg = '';
      V.inspectKey = '';
      if (was >= 0) applyAria(was);
      if (idx >= 0) applyAria(idx);
    }
    if (idx >= 0) {
      const c = V.cells[idx].data;
      const x = cellFraction(model, c, T);
      setStyle(cursor, 'left', (x * 100).toFixed(2) + '%');
      // the band cycle under the cursor
      let key;
      if (V.overlay === 6) key = `6:${c.z * ETA_PER_CELL + Math.min(ETA_PER_CELL - 1, Math.floor(x * ETA_PER_CELL))}`;
      else key = `${V.overlay}:${overlayCycle(model, c.z, V.overlay).idx}`;
      if (key !== V.curSeg) {
        for (const b of gridEl.querySelectorAll('.cal-pm-seg.is-current')) b.classList.remove('is-current');
        V.curSeg = key;
        const [lv, i2] = key.split(':');
        for (const b of gridEl.querySelectorAll(`.cal-pm-seg[data-lv="${lv}"][data-idx="${i2}"]`)) b.classList.add('is-current');
        markInspectorCurrent();
      }
    } else if (V.curSeg !== '') {
      for (const b of gridEl.querySelectorAll('.cal-pm-seg.is-current')) b.classList.remove('is-current');
      V.curSeg = '';
      markInspectorCurrent();
    }
    // the live clock's cell
    const nowMs = performance.now();
    if (force || nowMs - V.lastLive > 1000) {
      V.lastLive = nowMs;
      const li = cellOfTime(model, V.grid, store.realNow());
      if (li !== V.liveIdx) {
        const was = V.liveIdx;
        if (was >= 0 && V.cells[was]) V.cells[was].el.classList.remove('is-live');
        V.liveIdx = li;
        if (li >= 0) V.cells[li].el.classList.add('is-live');
        if (was >= 0) applyAria(was);
        if (li >= 0) applyAria(li);
      }
    }
  }
  function applyAria(i) {
    const c = V.cells[i];
    if (!c) return;
    setAttr(c.day, 'aria-label', cellLabel(c.data) + (i === V.liveIdx ? ', the live clock is here' : '') + (i === V.shownIdx ? ', the shown moment is here' : ''));
    setAttr(c.day, 'aria-current', i === V.liveIdx ? 'true' : null);
  }

  // ------------------------------------------------------------------------------------------
  // inspector: the shown cell
  // ------------------------------------------------------------------------------------------
  function markInspectorCurrent() {
    for (const li of inspector.querySelectorAll('.cal-ddr[data-key]')) toggleClass(li, 'is-current', li.dataset.key === V.curSeg);
  }
  /** "ζ#4 η#1": the η as an ordinal inside its ζ (its counter is that number minus one: 0η). */
  const etaChain = (e) => `${cycleLabel(5, Math.floor(e.eta / ETA_PER_CELL) % 7 + 1)} ${cycleLabel(6, e.local + 1)}`;
  function paintInspector() {
    const idx = V.shownIdx;
    const key = `${idx}|${V.hv}|${V.overlay}`;
    if (key !== V.inspectKey) {
      V.inspectKey = key;
      if (idx < 0) {
        const inRange = model.inRange(store.t());
        const msg = !inRange ? `<span class="dim">The shown moment is outside the catalogue ${esc(pure.catalogueText())}.</span>` : '<span class="dim">is on another page</span>';
        inspector.innerHTML = `<div class="cal-dd-h"><b>${inRange ? esc(pure.stamp(store.t(), 'zeta')) : 'Outside the catalogue'}</b>${msg}${inRange ? `<button type="button" class="btn btn-sm" data-act="shown">${ICONS.target}<span>Show the shown cell</span></button>` : ''}</div>`;
        V.elapsedEl = null;
        return;
      }
      const c = V.cells[idx].data;
      let html = `<div class="cal-dd-h"><b>${esc(cellStampText(c))}</b><span class="dim">cell ${c.ord} of 35 · ${esc(pure.cycleName(5, c.z))}</span>`;
      if (c.eclipse >= 0) html += `<span class="chip cal-chip is-gold" title="Greatest eclipse of Saros 141, ${esc(eclWhere(c))} this cell">${ICONS.eclipse}eclipse ${esc(pure.eclipseName(c.eclipse))}</span>`;
      html += `<span class="cal-pm-elapsed" title="How much of this ζ has passed"><span class="dim">elapsed</span><span class="cal-pm-el"></span></span></div>`;
      const eta = V.overlay === 6;
      html += `<ul class="cal-dd-list${eta ? ' is-grid' : ''}">`;
      const col = levelColor(V.overlay);
      const rowHtml = (level, idx, label, chain, cont) => {
        const t0 = cycleStart(model, level, idx);
        return (
          `<li class="cal-ddr" data-key="${level}:${idx}" style="--c:${col}"><span class="cal-ddl">${esc(label)}</span>` +
          `<span class="cal-ddt mono" data-cd="${t0 ?? ''}">${t0 === null || t0 >= model.tMax ? 'after the catalogue ends' : ''}</span><span class="cal-ddx dim">${esc(chain + (cont ? ' · began before this cell' : ''))}</span>` +
          `<button type="button" class="cal-go" data-lv="${level}" data-idx="${idx}" title="Go to the start of ${esc(label)}" aria-label="Go to the start of ${esc(label)}">${ICONS.go}</button></li>`
        );
      };
      if (eta) for (const e of c.etas) html += rowHtml(6, e.eta, countText('η', e.local), etaChain(e), false);
      else {
        const cy = overlayCycle(model, c.z, V.overlay);
        html += rowHtml(V.overlay, cy.idx, cycleLabel(V.overlay, cy.local), pure.cycleName(V.overlay, cy.idx), !cy.startsHere);
      }
      if (eta && c.syncs.length) html += '</ul><ul class="cal-dd-list is-grid is-syncs">';
      for (const s of c.syncs) {
        const names = ['start', 'peak', 'node', 'valley'];
        html +=
          `<li class="cal-ddr is-sync" style="--c:${GOLD}"><span class="cal-ddl">S${s.sync}</span>` +
          `<span class="cal-ddt mono" data-cd="${s.start}"></span><span class="cal-ddx dim">${names[s.q]}</span>` +
          `<button type="button" class="cal-go" data-sync="${s.sync}" data-q="${s.q}" title="Go to the ${names[s.q]} of sync ${s.sync}" aria-label="Go to the ${names[s.q]} of sync ${s.sync}">${ICONS.go}</button></li>`;
      }
      html += '</ul>';
      inspector.innerHTML = html;
      V.elapsedEl = inspector.querySelector('.cal-pm-el');
      V.elapsedKey = '';
      markInspectorCurrent();
    }
    // live parts: the elapsed pair and the countdowns
    if (idx >= 0 && V.elapsedEl) {
      const x = cellFraction(model, V.cells[idx].data, store.t());
      const k = pure.pair(x).index;
      if (k !== V.elapsedKey) {
        V.elapsedKey = k;
        V.elapsedEl.innerHTML = pure.pairHTML(x, { label: 'elapsed' });
      }
    }
    for (const sp of inspector.querySelectorAll('[data-cd]')) {
      const v = sp.dataset.cd;
      if (v !== '' && Number(v) < model.tMax) setText(sp, rel(Number(v)));
    }
    setAttr(inspector, 'aria-live', store.mode === 'live' || store.rate === 0 ? 'polite' : 'off');
  }
  inspector.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="shown"]')) {
      V.follow = true;
      V.pendingFollow = true;
      ctx.requestRender();
      return;
    }
    const b = e.target.closest('button[data-lv]');
    if (b) {
      const t = cycleStart(model, Number(b.dataset.lv), Number(b.dataset.idx));
      if (t !== null) ctx.goto(model.clamp(t));
      return;
    }
    const s = e.target.closest('button[data-sync]');
    if (s) {
      const info = model.solarSyncByNumber(Number(s.dataset.sync));
      const q = Number(s.dataset.q);
      if (info) ctx.goto(model.clamp(info.start + (q / 4) * (info.end - info.start) + 0.001));
    }
  });

  // ------------------------------------------------------------------------------------------
  // ribbon: the five δ of the γ
  // ------------------------------------------------------------------------------------------
  function buildRibbon_() {
    const info = V.info;
    const key = String(info.gamma);
    if (key === V.ribbonKey) {
      updateRibbonMarkers(true);
      return;
    }
    V.ribbonKey = key;
    const r = buildRibbon(model, info.gamma);
    V.ribbon = r;
    ribbonEl.textContent = '';
    const segs = h('div.cal-rmonths');
    for (const sg of r.segs) {
      const b = h(
        'button.cal-rm',
        {
          type: 'button',
          style: `left:${pct(sg.x0)};width:${pct(sg.x1 - sg.x0)}`,
          'data-hv': String(sg.hv),
          class: sg.inRange ? '' : 'is-out',
          'aria-label': `δ#${sg.delta} of γ#${r.path[2]}`,
          title: `δ#${sg.delta} of γ#${r.path[2]}`,
        },
        h('span', { text: `δ#${sg.delta}` }),
      );
      segs.append(b);
    }
    ribbonEl.append(segs);
    const ticks = h('div.cal-rticks', { 'aria-hidden': 'true' });
    for (const t of r.eps) ticks.append(h('i.cal-rt.is-eps', { style: `left:${pct(t.x)};--c:${levelColor(4)}` }));
    // the δ boundaries between the five pages
    for (const d of r.deltas) ticks.append(h('i.cal-rt.is-delta', { style: `left:${pct(d.x)};--c:${levelColor(3)}` }));
    ribbonEl.append(ticks);
    ribbonEl.append(ribCursor);
    setHtml(ribTitle, `γ#${r.path[2]} <span class="dim">· 5δ</span>`);
    setText(ribbonSum, `${pure.periodName(2, r.path[2])} holds 5δ = 25ε = 175ζ; it is the ${r.path[2]}${ordSuffix(r.path[2])} γ of ${pure.periodName(1, r.path[1])}.`);
    updateRibbonMarkers(true);
  }
  const ordSuffix = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]);
  ribbonEl.addEventListener('click', (e) => {
    const m = e.target.closest('.cal-rm');
    if (m) {
      V.focusZ = null;
      setView(Number(m.dataset.hv));
    }
  });
  ribbonEl.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const m = e.target.closest('.cal-rm');
    if (m) {
      const hv = Number(m.dataset.hv);
      const t = cycleStart(model, 3, hv) ?? model.tMax;
      tip.show(`<div class="cal-tt-h">δ#${(hv % PAGES_PER.gamma) + 1} of γ#${V.ribbon.path[2]}<span class="dim"> · ${esc(pure.cycleName(3, hv))}</span></div><div class="dim">${esc(pure.stamp(t, 'delta'))}</div><div class="dim">starts ${esc(rel(t))}</div><div class="dim cal-tt-hint">Click to show this page.</div>`, e.clientX, e.clientY);
    } else tip.hide();
  });
  ribbonEl.addEventListener('pointerleave', () => tip.hide());
  function updateRibbonMarkers(force = false) {
    const r = V.ribbon;
    if (!r) return;
    const T = store.t();
    const pos = model.positionOf(T);
    const g0 = (r.gamma * 4) / model.levelInfo(2).prefixNum;
    const g1 = ((r.gamma + 1) * 4) / model.levelInfo(2).prefixNum;
    const inG = pos !== null && pos >= g0 && pos < g1;
    if (ribCursor.hidden === inG) ribCursor.hidden = !inG;
    if (inG) setStyle(ribCursor, 'left', (((pos - g0) / (g1 - g0)) * 100).toFixed(3) + '%');
    const shownHv = inG ? viewOfTime(model, T) : -1;
    const sig = `${V.hv}|${shownHv}`;
    if (force || V.ribbonSig !== sig) {
      V.ribbonSig = sig;
      ribbonEl.querySelectorAll('.cal-rm').forEach((b) => {
        const hv = Number(b.dataset.hv);
        toggleClass(b, 'is-view', hv === V.hv);
        toggleClass(b, 'is-shown', hv === shownHv);
        setAttr(b, 'aria-current', hv === V.hv ? 'true' : null);
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // sticky card (same rule as the normal calendar): docks by its bottom edge when taller than the window
  // ------------------------------------------------------------------------------------------
  function updateStick() {
    const bar = document.querySelector('.topbar');
    const gap = 14;
    const want = (bar ? bar.getBoundingClientRect().height : 68) + gap;
    const top = Math.min(want, window.innerHeight - el.offsetHeight - gap);
    setStyle(el, '--cal-top', Math.round(top) + 'px');
  }
  let stickRO = null;
  if (typeof ResizeObserver !== 'undefined') {
    stickRO = new ResizeObserver(updateStick);
    stickRO.observe(el);
  }
  window.addEventListener('resize', updateStick);

  // ------------------------------------------------------------------------------------------
  // lifecycle
  // ------------------------------------------------------------------------------------------
  function followShown(T) {
    const hv = viewOfTime(model, T);
    if (hv !== null && hv !== V.hv) {
      V.hv = hv;
      V.grid = null;
    }
  }

  return {
    el,
    setActive(on) {
      V.active = on;
      if (on) {
        V.pendingFollow = V.follow;
        V.grid = null; // (repaint from scratch: the vocabulary or the catalogue range may have changed while hidden)
        V.ribbonKey = '';
        ctx.requestRender();
      } else tip.hide();
    },
    get view() {
      return { hv: V.hv, follow: V.follow, info: V.info ?? null };
    },
    get buildMs() {
      return V.lastBuildMs ?? 0;
    },
    render(frame) {
      const T = frame.t;
      if (V.hv < 0) {
        const hv = viewOfTime(model, T) ?? viewOfTime(model, store.realNow()) ?? 0;
        V.hv = hv;
      }
      if (V.follow && V.grid) {
        const shownOn = V.shownIdx >= 0;
        if (V.pendingFollow || (!shownOn && performance.now() - V.lastRebuild > 220)) followShown(T);
        V.pendingFollow = false;
      }
      toggleClass(shownBtn, 'is-away', V.follow);
      setAttr(title, 'aria-live', store.mode === 'live' || store.rate === 0 ? 'polite' : 'off'); // (not while a time-lapse flips pages)
      const atStart = V.hv <= 0;
      const atEnd = V.hv >= total() - 1;
      if (hPrev.disabled !== atStart) hPrev.disabled = atStart;
      if (hNext.disabled !== atEnd) hNext.disabled = atEnd;
      if (!V.grid) rebuild();
      updateMarkers();
      updateRibbonMarkers();
      paintInspector();
      const sound = hasSound(ctx);
      if (hearBtn.hidden === sound) hearBtn.hidden = !sound;
      if (hearBtn.disabled === frame.inRange) hearBtn.disabled = !frame.inRange;
    },
    focusGrid() {
      el.querySelector('.cal-pm-day[tabindex="0"]')?.focus();
    },
    destroy() {
      unsubTime();
      unsubSel();
      stickRO?.disconnect();
      window.removeEventListener('resize', updateStick);
      tip.hide();
      el.remove();
    },
  };
}
