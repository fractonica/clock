/**
 * The pure calendar (right half of the Calendar tab in pure mode): one Delta per page (SPEC §15, revision 3).
 *
 * The page is a ruler of one Delta: 5 rows, its Nuclides ε#1–5, and 7 columns of 11 Helions each (the ζ cycles, which are
 * no unit: the columns are labelled by their first Helion 1η 12η 23η … 67η, Helions being numbered from 1 to 77 in their
 * Nuclide). Every cell holds 11 Helions; a band along its foot shows them at their exact
 * fractional position (their numbers in the Nuclide, every fifth labelled where there is room), the
 * node mark of each Helion, and the solar sync quarters as gold diamonds. The Delta is a major period: it is said in words
 * with its quarter (Peak Node Valley End, the quarter named by the threshold that ends it), never with a phase pair. A
 * quarter bar above the grid shows the four quarters and the five Nuclides; in the grid a line in the Delta colour marks
 * where a quarter begins (at 1¼, 2½ and 3¾ Nuclides). The corner of a cell names what is in it: the eclipse (#22,
 * numbered like the position; its mark sits at the fraction 0, ¼, ½ or ¾ of the cell where it falls) and the number of a
 * solar sync that begins there (S4821). The shown moment is a cursor in its cell; the live clock marks its cell in red.
 * Header: ◀ ▶ over Delta, Gamma (5 Deltas), Beta (13 Gammas) and Alpha (5 Betas), the page in words ("Gamma Nonafracton
 * · Delta Trifracton") and letters, the address strip of fracton names, "Now", and under the page a ribbon of the five
 * Deltas of the Gamma with their Nuclides.
 *
 * Notation: X#n is an ordinal from 1 (δ#3, ε#2), nX a count from 0 (9ι, spans), except the Helion of a date: 34η is the
 * 34th Helion of its Nuclide (numbered from 1). Geometry and data come from ./pure-conv.js
 * (positions, exact integer tick maths); this file is DOM only. Nothing here says a Gregorian date, a weekday, a month,
 * a year or a percentage.
 */
import { GOLD, levelColor } from '../../core/theme.js';
import { ORDINAL_NAMES, QUARTER_WORDS } from '../../core/pure.js';
import { h, ICONS, esc, setText, setHtml, setStyle, setAttr, toggleClass, hasSound, hearMoment, loadPrefs, savePrefs } from './dom.js';
import { LETTERS, pointOfCycle } from './convert.js';
import { pentadMarkHTML, leadHTML, pentadLookup, PENTAD_NAMES } from '../pentad.js';
import { pagePentadRuns } from './pentads.js';
import { COLUMN_ETA, ETA_PER_CELL, GRID, PAGES_PER, buildPureGrid, buildRibbon, cellFraction, cellOfTime, cellTime, clampView, cycleStart, landPoint, madeOf, overlayCycle, spanText, viewCount, viewFromPath, viewInfo, viewOfTime } from './pure-conv.js';

const PREFS_KEY = 'fractonica-clock/calendar/pure/v1';
/** What the band shows: the Delta's quarters, the Nuclides (one per row) or the Helions (11 in a cell). */
const OVERLAYS = [
  { level: 3, sym: 'δ', title: 'Delta · its quarters Peak, Node, Valley, End' },
  { level: 4, sym: 'ε', title: 'Nuclide · depth 5, one per row' },
  { level: 6, sym: 'η', title: 'Helion · depth 7, 11 in a cell' },
];
const overlayOf = (level) => OVERLAYS.find((o) => o.level === Number(level)) ?? OVERLAYS[2];
/** What the ◀ ▶ buttons step by, in pages: one Delta, a Gamma (5 Deltas), a Beta (13 Gammas), an Alpha (5 Betas). */
const STEPS = [
  { id: 'delta', name: 'Delta', pages: 1, level: 3 },
  { id: 'gamma', name: 'Gamma', pages: PAGES_PER.gamma, level: 2 },
  { id: 'beta', name: 'Beta', pages: PAGES_PER.beta, level: 1 },
  { id: 'alpha', name: 'Alpha', pages: PAGES_PER.alpha, level: 0 },
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
    qbarKey: '',
  };
  const total = () => viewCount(model);
  /** The Pentad of an instant, from cached spans; a reading led by its Pentad (SPEC §15.3) as HTML. */
  const pentadAt = pentadLookup(model);
  const lead = (t, text) => leadHTML(model, t, esc(text), { p: pentadAt(t) });
  let step = STEPS.find((x) => x.id === prefs.step) ?? STEPS[0];
  const deltaName = (hv) => pure.cycleName(3, hv);

  // ------------------------------------------------------------------------------------------
  // static chrome
  // ------------------------------------------------------------------------------------------
  const iconBtn = (icon, label, fn, cls = '') => {
    const b = h('button.btn.btn-icon.btn-sm.cal-nb' + cls, { type: 'button', html: icon, title: label, 'aria-label': label });
    b.addEventListener('click', fn);
    return b;
  };
  const hPrev = iconBtn(ICONS.prev, 'Back one Delta', () => stepView(-step.pages));
  const hNext = iconBtn(ICONS.next, 'Forward one Delta', () => stepView(step.pages));
  const titleMain = h('div.cal-pm-tm');
  const titleSub = h('div.cal-pm-ts');
  const title = h('div.cal-pm-title', { 'aria-live': 'polite' }, titleMain, titleSub);
  const nowBtn = h('button.btn.btn-sm.cal-today', { type: 'button', text: 'Now', title: 'Show the page of the live clock' });
  const shownBtn = h('button.btn.btn-sm.cal-shown.is-away', { type: 'button', html: ICONS.target + '<span>Shown cell</span>', title: 'Return to the page of the shown moment' });
  // the address strip: Alpha Beta Gamma Delta by their fracton names (each a select; the page follows)
  const addrSels = [];
  const addrStrip = h('div.cal-pm-addr', { role: 'group', 'aria-label': 'Address of the page' });
  const addrSpec = [
    { key: 'alpha', name: 'Alpha', level: 0, count: () => Number(model.clock.count(0)) },
    { key: 'beta', name: 'Beta', level: 1, count: () => model.levelInfo(1).siblings },
    { key: 'gammaOrd', name: 'Gamma', level: 2, count: () => model.levelInfo(2).siblings },
    { key: 'delta', name: 'Delta', level: 3, count: () => PAGES_PER.gamma },
  ];
  for (const spec of addrSpec) {
    const sel = h('select.select.cal-pm-sel', { 'aria-label': `${spec.name} of the page`, style: `--lv:${levelColor(spec.level)}` });
    for (let n = 1; n <= spec.count(); n++) sel.append(h('option', { value: String(n), text: ORDINAL_NAMES[n] ?? `#${n}` }));
    sel.addEventListener('change', () => {
      const cur = viewInfo(model, V.hv);
      const v = { alpha: cur.alpha, beta: cur.beta, gammaOrd: cur.gammaOrd, delta: cur.delta, [spec.key]: Number(sel.value) };
      setView(viewFromPath(model, v.alpha, v.beta, v.gammaOrd, v.delta));
    });
    addrSels.push({ spec, sel });
    addrStrip.append(h('label.cal-pm-addrf', { style: `--lv:${levelColor(spec.level)}` }, h('span.cal-pm-addrl', { text: spec.name }), sel));
  }
  const stepSeg = h('div.seg.cal-pm-step', { role: 'group', 'aria-label': 'The arrows step by' });
  const stepBtns = STEPS.map((st) => {
    const b = h('button', { type: 'button', text: st.name, 'aria-pressed': String(st === step), title: `Step by one ${st.name} (${st.pages === 1 ? 'one page' : st.pages + ' pages'})`, style: `--c:${levelColor(st.level)}` });
    b.addEventListener('click', () => {
      step = st;
      savePrefs(PREFS_KEY, { step: st.id, overlay: V.overlay });
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
  // selecting δ, ε or η anywhere in the app (ladder, face, converter) puts that level in the band
  const unsubSel = store.subscribe((kind, patch) => {
    if (kind === 'settings' && patch && 'selectedLevel' in patch && OVERLAYS.some((o) => o.level === patch.selectedLevel)) setOverlay(patch.selectedLevel);
  });
  const legendHtml = () => {
    const lv = V.overlay;
    const swatch = `<span class="cal-lg-sw" style="--c:${levelColor(lv)}"></span>`;
    const head = 'Rows: the 5 Nuclides <b>ε#1–5</b> of the Delta; columns: 11 Helions each, from <b>1η</b>, <b>12η</b> … <b>67η</b>. ';
    const tail = ` <span class="cal-pm-lgs"></span> a solar sync quarter · <span class="cal-pm-lgp"></span> the Pentads under the band, ${pentadMarkHTML(0)} ${pentadMarkHTML(1)} ${pentadMarkHTML(2)} of 5η and the hatched Hypopentad ${pentadMarkHTML(3)} of 4η (the sun comes back every 4¾η, so each Pentad begins ¼η later against it and the Hypopentad brings Pentad I back) · <b class="cal-pm-lgt">#22</b> an eclipse, marked where it falls · <b class="cal-pm-lgt">S4821</b> a sync that begins here. # numbers and Helions count from 1, counts from 0. Press ? for the glossary.`;
    if (lv === 6) return `${swatch}<span>${head}The band is the Helions of each cell, numbered in the Nuclide (every fifth labelled where there is room), a tick at each node (<b>18ι</b> of 36); the Delta's quarters begin at the lines in its colour;${tail}</span>`;
    if (lv === 4) return `${swatch}<span>${head}The band is the Nuclides, one per row (a Nuclide is 77 Helions); the Delta's quarters begin at the lines in its colour;${tail}</span>`;
    return `${swatch}<span>${head}The band is the Delta's quarters <b>Peak</b>, <b>Node</b>, <b>Valley</b>, <b>End</b> (each named by the threshold that ends it, 1¼ Nuclides long);${tail}</span>`;
  };
  function paintLegend() {
    legend.innerHTML = legendHtml();
    el.style.setProperty('--cal-c', levelColor(V.overlay));
  }

  // the quarter bar: the page's Delta as one strip, its four quarters and its five Nuclides
  const qbar = h('div.cal-pm-qbar', { role: 'group', 'aria-label': 'Quarters of the Delta' });
  const qCursor = h('span.cal-pm-qcur', { 'aria-hidden': 'true' });

  const gridEl = h('div.cal-pm-grid', { role: 'group', 'aria-label': 'Cells of the page: Nuclides by blocks of 11 Helions' });
  const cursor = h('span.cal-cursor', { 'aria-hidden': 'true' });
  const inspector = h('div.cal-inspect', { 'aria-live': 'polite' });
  const hearBtn = h('button.btn.btn-sm.cal-hear.cal-hear-day', { type: 'button', html: ICONS.sound + '<span>Hear this moment</span>', title: 'Hear this moment: a short chord of the shown moment', hidden: true });
  hearBtn.addEventListener('click', () => hearMoment(ctx, store.t()));
  const inspectWrap = h('div.cal-inspwrap', null, inspector, hearBtn);

  const ribbonEl = h('div.cal-ribbon.cal-pribbon');
  const ribbonSum = h('p.cal-ysum');
  const ribCursor = h('span.cal-rcursor', { 'aria-hidden': 'true' });
  const ribTitle = h('span.cal-ytitle');

  const el = h(
    'section.card.cal-month.cal-pmonth',
    { 'aria-label': 'Calendar of the Delta' },
    h('header.card-h', null, h('h2', { text: 'Calendar' }), h('span.spacer'), h('span.cal-pm-hsub.dim', { text: 'one Delta = 5 Nuclides × 77 Helions' })),
    h(
      'div.card-b.cal-month-body',
      null,
      h('div.cal-nav.cal-pm-nav', null, hPrev, title, hNext, h('span.spacer'), shownBtn, nowBtn),
      addrStrip,
      h('div.cal-pm-steprow', null, h('span.cal-lab', { text: 'Arrows step by' }), stepSeg),
      h('div.cal-ovrow', null, h('span.cal-lab', { text: 'Cycle band' }), ovSeg, legend),
      qbar,
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
  /** "ε#2 34η–44η": a cell is a Nuclide and a block of 11 Helions (numbered from 1 in the Nuclide). */
  const cellRange = (c) => `${c.eta0}η–${c.eta0 + ETA_PER_CELL - 1}η`;
  const cellStampText = (c) => `ε#${c.epsilon} · ${cellRange(c)}`;
  /** The Delta quarter(s) a cell lies in, in words: "Delta Trifracton Peak" or "Delta Trifracton Peak → Node". */
  const cellQuarterText = (c) => `${deltaName(V.hv)} ${c.dq.map((q) => QUARTER_WORDS[q.q]).join(' → ')}`;
  /** Where in its cell an eclipse falls: 0, ¼, ½, ¾ of the cell. */
  const ECL_WHERE = { 0: 'at the start of', 0.25: 'a quarter of the way into', 0.5: 'in the middle of', 0.75: 'three quarters of the way into' };
  const eclWhere = (c) => ECL_WHERE[c.eclipseFrac] ?? `at ${c.eclipseFrac.toFixed(2)} of`;
  function cellLabel(c) {
    if (!c.inRange) return `ε#${c.epsilon}, ${c.eta0}η to ${c.eta0 + 10}η, outside the catalogue`;
    const ecl = c.eclipse >= 0 ? `, eclipse number ${c.eclipse} ${eclWhere(c)} the cell` : '';
    const sync = c.syncs?.find((s) => s.q === 0);
    const syn = sync ? `, solar sync S${sync.sync} begins here` : '';
    const starts = c.dq.filter((q) => q.startsHere && q.q > 0).map((q) => `, the ${QUARTER_WORDS[q.q]} quarter of the Delta begins here`).join('');
    const pents = (c.pentads ?? []).filter((r) => r.startsHere).map((r) => `, ${PENTAD_NAMES[r.index]} begins at ${runFrom(c, r)}η`).join('');
    return `ε#${c.epsilon}, ${c.eta0}η to ${c.eta0 + 10}η, in ${cellQuarterText(c)}${pents}${starts}${ecl}${syn}`;
  }
  /** The corner of a cell: the eclipse inside it and the solar sync that begins in it (aria-hidden: the cell's label says it). */
  function tagsHtml(c) {
    const tags = [];
    if (c.eclipse >= 0) tags.push(`<b class="cal-pm-tag is-ecl">${esc(pure.eclipseName(c.eclipse))}</b>`);
    const sync = c.syncs.find((s) => s.q === 0);
    if (sync) tags.push(`<b class="cal-pm-tag is-sync">S${sync.sync}</b>`);
    return tags.length ? `<span class="cal-pm-tags${tags.length > 1 ? ' has-both' : ''}" aria-hidden="true">${tags.join('')}</span>` : '';
  }
  /** Where a quarter of the Delta begins inside a cell: a line in the Delta colour (its word is in the label and the tooltip). */
  function quarterMarkHtml(c) {
    let s = '';
    for (const q of c.dq) if (q.startsHere && q.q > 0) s += `<span class="cal-pm-qline" aria-hidden="true" data-word="${QUARTER_WORDS[q.q]}" style="left:${pct(q.x0)}"></span>`;
    return s;
  }

  function bandHtml(c) {
    let s = '';
    if (V.overlay === 6) {
      // 11 Helions per cell, whole cycles: [j/11, (j+1)/11), labelled by their number in the Nuclide (every fifth one
      // where the cell is narrow: CSS)
      for (const e of c.etas) {
        s += `<i class="cal-pm-seg is-eta${e.odd ? ' is-odd' : ''} is-start${e.count % 5 === 0 ? ' k5' : ''}${e.local === ETA_PER_CELL - 1 ? ' is-endeta' : e.local === ETA_PER_CELL - 2 ? ' is-tail' : ''}" data-lv="6" data-idx="${e.eta}" style="left:${pct(e.x0)};width:${pct(e.x1 - e.x0)}"><b>${e.count}</b></i>`;
      }
      for (const q of c.quarters) if (q.q === 2) s += `<u class="cal-pm-q q${q.q}" style="left:${pct(q.x)}"></u>`;
    } else if (V.overlay === 4) {
      // a Nuclide is a row: one segment per cell, labelled where the row begins
      const cy = overlayCycle(model, c.z, 4);
      s += `<i class="cal-pm-seg is-wideseg${cy.idx & 1 ? ' is-odd' : ''}${cy.startsHere ? ' is-start' : ' is-cont'}" data-lv="4" data-idx="${cy.idx}" style="left:0;width:100%"><b>${cy.startsHere ? `ε#${cy.local}` : ''}</b></i>`;
    } else {
      // the Delta's quarters: a quarter is 8¾ cells, so a cell holds one or two of them
      for (const q of c.dq) {
        const label = q.startsHere || (c.col === 0 && q.x0 === 0) ? QUARTER_WORDS[q.q] : '';
        s += `<i class="cal-pm-seg is-wideseg is-dq${q.q & 1 ? ' is-odd' : ''}${q.startsHere ? ' is-start' : ' is-cont'}" data-lv="q" data-idx="${V.hv * 4 + q.q}" style="left:${pct(q.x0)};width:${pct(q.x1 - q.x0)}"><b>${label}</b></i>`;
      }
    }
    for (const sy of c.syncs) s += `<s class="cal-pm-s${sy.q === 0 ? ' is-start' : ''}" data-sync="${sy.sync}" data-q="${sy.q}" style="left:${pct(sy.x)}"></s>`;
    return s;
  }
  /** The Helion numbers (in the Nuclide) of a Pentad run inside a cell: from and to. */
  const runFrom = (c, r) => c.eta0 + Math.round(r.x0 * ETA_PER_CELL);
  /** A Pentad's whole range in its Nuclide's numbers, also where a cell holds only part of it: "33η–37η" (or "76η–3η"). */
  const etaNo = (n) => ((((n - 1) % 77) + 77) % 77) + 1;
  const pentadRange = (c, r) => {
    const first = etaNo(runFrom(c, r) - r.place + 1);
    return `${first}η–${etaNo(first + (r.index === 3 ? 4 : 5) - 1)}η`;
  };
  /**
   * The Pentads of a cell as a bar along the foot of its band: the Helions group into Pentads the way days group into
   * weeks (five, five, five and the hatched Hypopentad's four), with a notch where each begins. The tooltip and the
   * inspector name them; the one holding the shown moment is brighter.
   */
  function pentadStripHtml(c) {
    if (!c.pentads?.length) return '';
    let s = '';
    for (const r of c.pentads) {
      const x1 = Math.min(r.x1, c.partial ? c.cut : 1);
      if (x1 <= r.x0) continue;
      const cls = `cal-pm-pr${r.index % 2 ? ' is-odd' : ''}${r.index === 3 ? ' is-hypo' : ''}${r.startsHere ? ' is-start' : ''}`;
      s += `<i class="${cls}" data-p="${r.sync * 4 + r.index}" style="left:${pct(r.x0)};width:${pct(x1 - r.x0)}"></i>`;
    }
    return `<div class="cal-pm-prow" aria-hidden="true">${s}</div>`;
  }
  /** Brighten the Pentad of the shown moment (its bar may run over two cells). */
  function markPentad(T) {
    const p = model.inRange(T) ? pentadAt(T) : null;
    const key = p ? String(p.sync * 4 + p.index) : '';
    if (key === V.pentKey) return;
    for (const b of gridEl.querySelectorAll('.cal-pm-pr.is-cur')) b.classList.remove('is-cur');
    V.pentKey = key;
    if (key) for (const b of gridEl.querySelectorAll(`.cal-pm-pr[data-p="${key}"]`)) b.classList.add('is-cur');
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
    // the Pentads of the page's Helions (pure arithmetic on the Helion index, as model.pentadAt counts them)
    const runs = pagePentadRuns(model, grid.cells.map((c) => ({ etaFirst: c.z * ETA_PER_CELL, n: ETA_PER_CELL, inRange: c.inRange })));
    grid.cells.forEach((c, i) => (c.pentads = runs[i]));
    V.info = viewInfo(model, V.hv);
    gridEl.textContent = '';
    let html = '<div class="cal-pm-corner" aria-hidden="true"></div>';
    for (let c = 0; c < GRID.cols; c++) html += `<div class="cal-pm-ch${c === 0 ? ' is-first' : ''}" aria-hidden="true">${COLUMN_ETA[c]}<i>η</i></div>`;
    for (let r = 0; r < GRID.rows; r++) {
      html += `<div class="cal-pm-rh${r === 0 ? ' is-first' : ''}" aria-hidden="true"><i>ε#</i>${r + 1}</div>`;
      for (let c = 0; c < GRID.cols; c++) {
        const cell = grid.cells[r * GRID.cols + c];
        html +=
          `<div class="cal-pm-cell${cell.inRange ? '' : ' is-out'}${cell.partial ? ' is-partial' : ''}${cell.col === 6 ? ' is-last' : ''}" data-i="${cell.index}">` +
          `<button type="button" class="cal-pm-day" tabindex="-1"><span class="cal-pm-num">${cell.eta0}<i>η</i></span></button>` +
          (cell.inRange ? tagsHtml(cell) + quarterMarkHtml(cell) : '') +
          eclipseHtml(cell) +
          (cell.inRange ? `<div class="cal-pm-band">${bandHtml(cell)}</div>` + pentadStripHtml(cell) : '') +
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
    // title in words (and letters) and the selects
    const info = V.info;
    setHtml(titleMain, `<span style="color:${levelColor(2)}">${esc(pure.periodName(2, info.gammaOrd))}&nbsp;·</span> <span style="color:${levelColor(3)}">${esc(pure.periodName(3, info.delta))}</span>`);
    setText(titleSub, `α#${info.alpha} β#${info.beta} γ#${info.gammaOrd} δ#${info.delta}`);
    setAttr(title, 'title', [pure.periodName(0, info.alpha), pure.periodName(1, info.beta), pure.periodName(2, info.gammaOrd), pure.periodName(3, info.delta)].join(', '));
    for (const { spec, sel } of addrSels) sel.value = String(info[spec.key]);
    paintLegend();
    buildQbar();
    buildRibbon_();
    V.lastRebuild = performance.now();
    V.lastBuildMs = V.lastRebuild - t0;
    updateMarkers(true);
  }

  function setRoving(idx) {
    V.cells.forEach((c, i) => c.day.setAttribute('tabindex', i === idx ? '0' : '-1'));
  }

  // ------------------------------------------------------------------------------------------
  // the quarter bar
  // ------------------------------------------------------------------------------------------
  function buildQbar() {
    const key = String(V.hv);
    if (V.qbarKey === key) return;
    V.qbarKey = key;
    qbar.textContent = '';
    const segs = h('div.cal-pm-qsegs');
    for (let q = 0; q < 4; q++) {
      const b = h('button.cal-pm-qseg', { type: 'button', 'data-q': String(q), style: `left:${q * 25}%;width:25%`, 'aria-label': `${deltaName(V.hv)} ${QUARTER_WORDS[q]}: go to where it begins` }, h('span', { text: QUARTER_WORDS[q] }));
      segs.append(b);
    }
    const ticks = h('div.cal-pm-qticks', { 'aria-hidden': 'true' });
    for (let i = 0; i < GRID.rows; i++) {
      if (i > 0) ticks.append(h('i.cal-pm-qtick', { style: `left:${i * 20}%` }));
      ticks.append(h('span.cal-pm-qeps', { style: `left:${i * 20 + 10}%`, text: `ε#${i + 1}` }));
    }
    qbar.append(segs, ticks, qCursor);
  }
  qbar.addEventListener('click', (e) => {
    const b = e.target.closest('.cal-pm-qseg');
    if (!b) return;
    const t = landPoint(model, 3, V.hv, Number(b.dataset.q) / 4);
    if (t !== null) ctx.goto(model.clamp(t));
  });
  qbar.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const b = e.target.closest('.cal-pm-qseg');
    if (b) tip.show(quarterTipHtml(V.hv * 4 + Number(b.dataset.q)), e.clientX, e.clientY);
    else tip.hideSoon();
  });
  qbar.addEventListener('pointerleave', () => tip.hideSoon());
  function updateQbar() {
    const T = store.t();
    const l = model.inRange(T) ? model.levelAt(T, 3) : null;
    const on = !!l && l.cycle === V.hv;
    if (qCursor.hidden === on) qCursor.hidden = !on;
    if (on) setStyle(qCursor, 'left', (l.phase * 100).toFixed(3) + '%');
    const q = on ? Math.min(3, Math.floor(l.phase * 4)) : -1;
    for (const b of qbar.querySelectorAll('.cal-pm-qseg')) {
      const cur = Number(b.dataset.q) === q;
      toggleClass(b, 'is-cur', cur);
      setAttr(b, 'aria-current', cur ? 'true' : null);
    }
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
    return ee ? { el: ee, level: ee.dataset.lv === 'q' ? 'q' : Number(ee.dataset.lv), idx: Number(ee.dataset.idx), key: `${ee.dataset.lv}:${ee.dataset.idx}`, cell: cellOf(ee) } : null;
  };
  const syncOf = (target) => {
    const se = target.closest?.('.cal-pm-s');
    return se ? { el: se, sync: Number(se.dataset.sync), q: Number(se.dataset.q), cell: cellOf(se) } : null;
  };
  /** The first millisecond of a band segment: a cycle's start, or where a Delta quarter begins. */
  const segStart = (seg) => (seg.level === 'q' ? landPoint(model, 3, Math.floor(seg.idx / 4), (seg.idx % 4) / 4) : cycleStart(model, seg.level, seg.idx));

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
      const t = segStart(seg);
      if (t !== null) ctx.goto(model.clamp(t));
      return;
    }
    const sy = syncOf(e.target);
    if (sy) {
      const s = model.solarSyncByNumber(sy.sync);
      if (s) ctx.goto(model.clamp(s.start + (sy.q / 4) * (s.end - s.start) + 0.001));
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
      tip.show(seg.level === 'q' ? quarterTipHtml(seg.idx) : cycleTipHtml(seg.level, seg.idx), e.clientX, e.clientY);
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
      // the same cell of the neighbouring page (a Gamma further with Shift)
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
    // leave the page: move the view and keep the focus on the same cell
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
    html += `<div class="dim">11 Helions · ${esc(cellQuarterText(c))}</div>`;
    html += `<div class="mono cal-tt-addr">${lead(c.start, pure.stamp(c.start, 'eta'))}</div>`;
    if (c.pentads?.length) {
      const parts = c.pentads.map((r) => `<span class="cal-tt-prun">${pentadMarkHTML(r.index)}<span class="mono">${pentadRange(c, r)}</span></span>`);
      html += `<div class="cal-tt-pent is-runs">${parts.join('')}</div>`;
    }
    html += `<div class="cal-tt-pair">${pure.pairHTML(c.epsPhase, { label: 'Nuclide phase' })}<span class="dim">Nuclide phase at the start · <span class="mono">${esc(pure.pairText(c.epsPhase))}</span></span></div>`;
    html += `<div class="dim">starts ${esc(rel(c.start))} · pos ${c.pos0.toFixed(6)}</div>`;
    for (const q of c.dq.filter((x) => x.startsHere && x.q > 0)) html += `<div class="cal-tt-q">${esc(deltaName(V.hv))}: the ${QUARTER_WORDS[q.q]} quarter begins here</div>`;
    if (c.eclipse >= 0) html += `<div class="cal-tt-ecl">${ICONS.eclipse}<span>Saros 141 eclipse ${esc(pure.eclipseName(c.eclipse))} ${eclWhere(c)} this cell</span></div>`;
    for (const sy of c.syncs.filter((s) => s.q === 0)) html += `<div class="cal-tt-sync"><span class="cal-pm-lgs"></span><span>Solar sync ${sy.sync} begins in this cell</span></div>`;
    html += '<div class="dim cal-tt-hint">Click: this cell at the shown offset.<br>Double-click: its middle.</div>';
    return html;
  }
  /** Threshold rows of a cycle: starts, peak, node, valley, ends, each as an offset into it and the next one as a countdown. */
  function thresholdRows(level, idx, names) {
    const info = model.levelInfo(level);
    const times = [0, 1, 2, 3, 4].map((q) => pointOfCycle(model, level, idx, q / 4));
    const T = store.t();
    let next = -1;
    for (let i = 0; i < 5; i++) {
      if (times[i] !== null && times[i] > T) {
        next = i;
        break;
      }
    }
    const len = 4 / info.prefixNum;
    const into = (i) => `+${pure.durationPos((len * i) / 4, { parts: 2 })}`;
    const rows = times
      .map((t, i) => {
        if (t === null) return '';
        const text = i === 0 ? rel(t) : `${into(i)}${i === next ? ' · ' + rel(t) : ''}`;
        return `<dt>${i === next ? '▸ ' : ''}${names[i]}</dt><dd${i === next ? ' class="is-next"' : ''}>${esc(text)}</dd>`;
      })
      .join('');
    return { rows, cur: T >= (times[0] ?? Infinity) && T < (times[4] ?? Infinity) };
  }
  function cycleTipHtml(level, idx) {
    const col = levelColor(level);
    const info = model.levelInfo(level);
    const names = level === 6 ? ['starts', 'peak (9ι)', 'node (18ι)', 'valley (27ι)', 'ends'] : ['starts', 'peak', 'node', 'valley', 'ends'];
    const { rows, cur } = thresholdRows(level, idx, names);
    // a minor cycle is named by where it starts in its Nuclide: "34η" (ε#5 34η)
    const head = pure.cycleShort(level, idx);
    const full = pure.cycleName(level, idx);
    const nth = Number(head.replace('η', ''));
    const counter = level === 6 ? `<div class="dim">${esc(head)}: the ${nth}${ordSuffix(nth)} Helion of its Nuclide (${nth - 1} completed when it begins)</div>` : '';
    const made = madeOf(model, pure, level);
    const unit = `${pure.unitName(LETTERS[level])} · ${info.siblings * (level === 6 ? 7 : 1)} in a ${level === 6 ? 'Nuclide' : 'Delta'}${made ? `, lasts ${made}` : ''} · `;
    return (
      `<div class="cal-tt-h" style="color:${col}">${esc(head)}${full !== head ? `<span class="dim"> · ${esc(full)}</span>` : ''}${cur ? ' <span class="chip cal-chip is-info">shown</span>' : ''}</div>` +
      counter +
      `<dl class="cal-tt-dl">${rows}</dl>` +
      `<div class="dim cal-tt-hint">${esc(unit)}global index ${idx} · click to go to its start</div>`
    );
  }
  /** A quarter of a Delta, `gq` = 4 x the Delta index + the quarter (0 Peak … 3 End). */
  function quarterTipHtml(gq) {
    const d = Math.floor(gq / 4);
    const q = gq % 4;
    const from = pointOfCycle(model, 3, d, q / 4);
    const to = pointOfCycle(model, 3, d, (q + 1) / 4);
    const T = store.t();
    const cur = from !== null && to !== null && T >= from && T < to;
    const into = (k) => pure.durationPos((4 / model.levelInfo(3).prefixNum) * (k / 4), { parts: 2 });
    const begins = q === 0 ? 'where the Delta begins' : `at its ${['', 'peak', 'node', 'valley'][q]}, ${into(q)} in`;
    return (
      `<div class="cal-tt-h" style="color:${levelColor(3)}">${esc(deltaName(d))} ${QUARTER_WORDS[q]}${cur ? ' <span class="chip cal-chip is-info">shown</span>' : ''}</div>` +
      `<div class="dim">the quarter that ends at its ${QUARTER_WORDS[q].toLowerCase()}; it begins ${esc(begins)}</div>` +
      `<dl class="cal-tt-dl">${from !== null ? `<dt>begins</dt><dd>${esc(rel(from))}</dd>` : ''}${to !== null ? `<dt>ends</dt><dd>${esc(rel(to))}</dd>` : ''}<dt>length</dt><dd>${esc(into(1))}</dd></dl>` +
      `<div class="dim cal-tt-hint">A Delta has no phase glyphs: its quarter says where it is. Click to go to where this quarter begins.</div>`
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
  /** The band segment under the moment `T` in cell `c` (the same key as data-lv:data-idx). */
  function segKeyAt(c, T) {
    const x = cellFraction(model, c, T);
    if (V.overlay === 6) return `6:${c.z * ETA_PER_CELL + Math.min(ETA_PER_CELL - 1, Math.floor(x * ETA_PER_CELL))}`;
    if (V.overlay === 4) return `4:${overlayCycle(model, c.z, 4).idx}`;
    const q = model.inRange(T) ? Math.min(3, Math.floor(model.levelAt(T, 3).phase * 4)) : 0;
    return `q:${V.hv * 4 + q}`;
  }
  function updateMarkers(force = false) {
    if (!V.grid) return;
    const T = store.t();
    const idx = cellOfTime(model, V.grid, T);
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
      setStyle(cursor, 'left', (cellFraction(model, c, T) * 100).toFixed(2) + '%');
      const key = segKeyAt(c, T);
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
    updateQbar();
    if (force) V.pentKey = null;
    markPentad(T);
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
  function paintInspector() {
    const idx = V.shownIdx;
    const key = `${idx}|${V.hv}|${V.overlay}`;
    if (key !== V.inspectKey) {
      V.inspectKey = key;
      if (idx < 0) {
        const inRange = model.inRange(store.t());
        const msg = !inRange ? `<span class="dim">The shown moment is outside the catalogue ${esc(pure.catalogueText())}.</span>` : '<span class="dim">is on another page</span>';
        inspector.innerHTML = `<div class="cal-dd-h"><b>${inRange ? lead(store.t(), pure.dateText(store.t(), { upTo: 'eta' })) : 'Outside the catalogue'}</b>${msg}${inRange ? `<button type="button" class="btn btn-sm" data-act="shown">${ICONS.target}<span>Show the shown cell</span></button>` : ''}</div>`;
        V.elapsedEl = null;
        return;
      }
      const c = V.cells[idx].data;
      let html = `<div class="cal-dd-h"><b>${esc(cellStampText(c))}</b><span class="dim">11 Helions · ${esc(cellQuarterText(c))}</span>`;
      if (c.eclipse >= 0) html += `<span class="chip cal-chip is-gold" title="Greatest eclipse of Saros 141, ${esc(eclWhere(c))} this cell">${ICONS.eclipse}eclipse ${esc(pure.eclipseName(c.eclipse))}</span>`;
      html += `<span class="cal-pm-elapsed" title="How much of these 11 Helions has passed"><span class="dim">elapsed</span><span class="cal-pm-el"></span></span></div>`;
      const grid = V.overlay === 6;
      html += `<ul class="cal-dd-list${grid ? ' is-grid' : ''}">`;
      const col = levelColor(V.overlay);
      const rowHtml = (dataKey, label, t0, chain, cont, go) => {
        return (
          `<li class="cal-ddr" data-key="${dataKey}" style="--c:${col}"><span class="cal-ddl">${esc(label)}</span>` +
          `<span class="cal-ddt mono" data-cd="${t0 ?? ''}">${t0 === null || t0 >= model.tMax ? 'after the catalogue ends' : ''}</span><span class="cal-ddx dim">${esc(chain + (cont ? ' · began before this cell' : ''))}</span>` +
          `<button type="button" class="cal-go" ${go} title="Go to the start of ${esc(label)}" aria-label="Go to the start of ${esc(label)}">${ICONS.go}</button></li>`
        );
      };
      if (V.overlay === 6) for (const e of c.etas) html += rowHtml(`6:${e.eta}`, `${e.count}η`, cycleStart(model, 6, e.eta), pure.cycleName(6, e.eta), false, `data-lv="6" data-idx="${e.eta}"`);
      else if (V.overlay === 4) {
        const cy = overlayCycle(model, c.z, 4);
        html += rowHtml(`4:${cy.idx}`, `ε#${cy.local}`, cycleStart(model, 4, cy.idx), `Nuclide ${cy.local} of 5 in ${deltaName(V.hv)}`, !cy.startsHere, `data-lv="4" data-idx="${cy.idx}"`);
      } else {
        for (const q of c.dq) {
          const gq = V.hv * 4 + q.q;
          html += rowHtml(`q:${gq}`, QUARTER_WORDS[q.q], landPoint(model, 3, V.hv, q.q / 4), `${deltaName(V.hv)} ${QUARTER_WORDS[q.q]}`, !q.startsHere, `data-q="${gq}"`);
        }
      }
      if (grid && c.syncs.length) html += '</ul><ul class="cal-dd-list is-grid is-syncs">';
      for (const s of c.syncs) {
        const names = ['start', 'peak', 'node', 'valley'];
        html +=
          `<li class="cal-ddr is-sync" style="--c:${GOLD}"><span class="cal-ddl">S${s.sync}</span>` +
          `<span class="cal-ddt mono" data-cd="${s.start}"></span><span class="cal-ddx dim">${names[s.q]}</span>` +
          `<button type="button" class="cal-go" data-sync="${s.sync}" data-sq="${s.q}" title="Go to the ${names[s.q]} of sync ${s.sync}" aria-label="Go to the ${names[s.q]} of sync ${s.sync}">${ICONS.go}</button></li>`;
      }
      html += '</ul>';
      // the Pentads of the cell, like the weeks of a month: where each runs in the cell, and a go to where it begins
      V.cellPentads = c.pentads ?? [];
      if (V.cellPentads.length) {
        html += '<ul class="cal-dd-list is-grid is-pentads" aria-label="Pentads of this cell">';
        V.cellPentads.forEach((r, i) => {
          const name = PENTAD_NAMES[r.index];
          html +=
            `<li class="cal-ddr is-pentad" style="--c:${GOLD}"><span class="cal-ddl">${pentadMarkHTML(r.index)}</span>` +
            `<span class="cal-ddt mono">${pentadRange(c, r)}</span><span class="cal-ddx dim">${r.index === 3 ? 4 : 5}η</span>` +
            `<button type="button" class="cal-go" data-pent="${i}" title="Go to where ${name} begins" aria-label="Go to where ${name} of sync ${r.sync} begins">${ICONS.go}</button>` +
            '</li>';
        });
        html += '</ul>';
      }
      inspector.innerHTML = html;
      V.elapsedEl = inspector.querySelector('.cal-pm-el');
      V.elapsedKey = '';
      markInspectorCurrent();
    }
    // live parts: the elapsed pair (of the 11-Helion block, a depth between units: a pair is fine) and the countdowns
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
    const pb = e.target.closest('button[data-pent]');
    if (pb) {
      const r = V.cellPentads?.[Number(pb.dataset.pent)];
      // a Pentad begins with its first Helion: land on that Helion's first millisecond
      const t = r ? cycleStart(model, 6, r.from - r.place + 1) : null;
      if (t !== null) ctx.goto(model.clamp(t));
      return;
    }
    const b = e.target.closest('button[data-lv]');
    if (b) {
      const t = cycleStart(model, Number(b.dataset.lv), Number(b.dataset.idx));
      if (t !== null) ctx.goto(model.clamp(t));
      return;
    }
    const qb = e.target.closest('button[data-q]');
    if (qb) {
      const gq = Number(qb.dataset.q);
      const t = landPoint(model, 3, Math.floor(gq / 4), (gq % 4) / 4);
      if (t !== null) ctx.goto(model.clamp(t));
      return;
    }
    const s = e.target.closest('button[data-sync]');
    if (s) {
      const info = model.solarSyncByNumber(Number(s.dataset.sync));
      const q = Number(s.dataset.sq);
      if (info) ctx.goto(model.clamp(info.start + (q / 4) * (info.end - info.start) + 0.001));
    }
  });

  // ------------------------------------------------------------------------------------------
  // ribbon: the five Deltas of the Gamma
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
      const name = pure.periodName(3, sg.delta);
      const b = h(
        'button.cal-rm',
        {
          type: 'button',
          style: `left:${pct(sg.x0)};width:${pct(sg.x1 - sg.x0)}`,
          'data-hv': String(sg.hv),
          class: sg.inRange ? '' : 'is-out',
          'aria-label': `${name} of ${pure.periodName(2, r.path[2])}`,
        },
        h('span', null, h('b.cal-rm-w', { text: ORDINAL_NAMES[sg.delta] }), h('b.cal-rm-l', { text: `δ#${sg.delta}` })),
      );
      segs.append(b);
    }
    ribbonEl.append(segs);
    const ticks = h('div.cal-rticks', { 'aria-hidden': 'true' });
    for (const t of r.eps) ticks.append(h('i.cal-rt.is-eps', { style: `left:${pct(t.x)};--c:${levelColor(4)}` }));
    // the Delta boundaries between the five pages
    for (const d of r.deltas) ticks.append(h('i.cal-rt.is-delta', { style: `left:${pct(d.x)};--c:${levelColor(3)}` }));
    ribbonEl.append(ticks);
    ribbonEl.append(ribCursor);
    setHtml(ribTitle, `${esc(pure.periodName(2, r.path[2]))} <span class="dim">· 5 Deltas of 5 Nuclides</span>`);
    const helions = pure.groupDigits(Math.round(pure.unitPos(pure.unitOf('gamma')) / pure.unitPos(pure.unitOf('eta'))));
    setText(ribbonSum, `${pure.periodName(2, r.path[2])} holds 5 Deltas = 25 Nuclides = ${helions} Helions; it is the ${r.path[2]}${ordSuffix(r.path[2])} Gamma of ${pure.periodName(1, r.path[1])}.`);
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
      tip.show(`<div class="cal-tt-h">${esc(deltaName(hv))}<span class="dim"> · δ#${(hv % PAGES_PER.gamma) + 1} of ${esc(pure.periodName(2, V.ribbon.path[2]))}</span></div><div class="dim mono">${esc(pure.stamp(t, 'delta'))}</div><div class="dim">starts ${esc(rel(t))}</div><div class="dim cal-tt-hint">Click to show this page.</div>`, e.clientX, e.clientY);
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
        V.qbarKey = '';
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
