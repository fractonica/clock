/**
 * Month calendar (right half of the Calendar tab): a Gregorian month grid whose day cells carry
 * a band of Fractonica cycles at the chosen level, a day inspector, and the year ribbon.
 *
 * Data comes from ./month.js (pure). The grid is rebuilt only when month / overlay / zone /
 * week start change; per frame only the displayed-instant cursor, "today" and the highlighted
 * current cycle are touched (and only when they changed).
 */
import { MONTHS_SHORT, WEEKDAYS_SHORT } from '../../core/format.js';
import { GOLD, levelColor } from '../../core/theme.js';
import { h, ICONS, esc, setText, setStyle, setAttr, toggleClass, hasSound, hearMoment } from './dom.js';
import { FIRST_YEAR, LAST_YEAR, OVERLAYS, buildMonth, clampMonth, overlayById, yearRibbon, yearSummary } from './month.js';
import {
  LETTERS,
  LEVEL_NAMES,
  MONTHS_FULL,
  WEEKDAYS_LONG,
  addDays,
  addressText,
  catalogueRangeText,
  cycleLabel,
  gregorianInfo,
  landOn,
  ordinal,
  pathText,
  pointOfCycle,
  r3,
  spanLabel,
} from './convert.js';

const MONTHS_LONG_UI = MONTHS_FULL;

export function createMonthView(ctx, { prefs, setPref, tip }) {
  const { model, store } = ctx;
  const fmt = ctx.fmt; // app zone formatter: the calendar always shows the app zone
  const V = {
    year: 0,
    month: 0,
    follow: true,
    weekStart: prefs.weekStart === 0 ? 0 : 1,
    overlay: overlayById(prefs.overlay).id,
    grid: null,
    zone: '',
    cells: [], // {el, day, band, segs[], data}
    segInfo: [],
    needFit: false,
    segByKey: new Map(),
    shownIdx: -1,
    todayIdx: -1,
    curKey: '',
    hotKey: '',
    lastRebuild: 0,
    lastToday: 0,
    focusKey: null,
    inspectKey: '',
    ribbon: null,
    active: true,
    pendingFollow: true,
  };

  // ------------------------------------------------------------------------------------------
  // static chrome
  // ------------------------------------------------------------------------------------------
  const iconBtn = (icon, label, fn, cls = '') => {
    const b = h('button.btn.btn-icon.btn-sm.cal-nb' + cls, { type: 'button', html: icon, title: label, 'aria-label': label });
    b.addEventListener('click', fn);
    return b;
  };
  const monthSel = h('select.select.cal-msel', { 'aria-label': 'Month' });
  MONTHS_LONG_UI.forEach((m, i) => monthSel.append(h('option', { value: String(i + 1), text: m })));
  const yearSel = h('select.select.cal-ysel', { 'aria-label': 'Year' });
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) yearSel.append(h('option', { value: String(y), text: String(y) }));
  const todayBtn = h('button.btn.btn-sm.cal-today', { type: 'button', text: 'Today', title: 'Show the month of the device clock' });
  // (kept in the layout while it is not needed, only invisible: the nav row must not reflow when it appears)
  const shownBtn = h('button.btn.btn-sm.cal-shown.is-away', { type: 'button', html: ICONS.target + '<span>Displayed day</span>', title: 'Return to the month of the displayed time' });
  const prevBtn = iconBtn(ICONS.prev, 'Previous month', () => stepMonth(-1));
  const nextBtn = iconBtn(ICONS.next, 'Next month', () => stepMonth(1));
  const wkSeg = h('div.seg.cal-wkseg', { role: 'group', 'aria-label': 'Week starts on' });
  const wkBtns = [
    [1, 'Mon'],
    [0, 'Sun'],
  ].map(([v, label]) => {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String(V.weekStart === v), title: `Weeks start on ${v ? 'Monday' : 'Sunday'}` });
    b.addEventListener('click', () => {
      V.weekStart = v;
      setPref({ weekStart: v });
      wkBtns.forEach(([bv, bb]) => bb.setAttribute('aria-pressed', String(bv === v)));
      V.grid = null;
      ctx.requestRender();
    });
    wkSeg.append(b);
    return [v, b];
  });
  const ovSeg = h('div.seg.cal-ovseg', { role: 'group', 'aria-label': 'Cycle band level' });
  const ovBtns = OVERLAYS.map((o) => {
    const b = h('button', { type: 'button', text: o.label, title: o.title, 'aria-pressed': String(o.id === V.overlay) });
    b.style.setProperty('--c', o.level !== null ? levelColor(o.level) : GOLD);
    b.addEventListener('click', () => {
      setOverlay(o.id);
      if (o.level !== null) ctx.select(o.level); // the band level is the app-wide selected level
    });
    ovSeg.append(b);
    return [o, b];
  });
  function setOverlay(id) {
    if (V.overlay === id) return;
    V.overlay = id;
    setPref({ overlay: id });
    ovBtns.forEach(([ov, bb]) => bb.setAttribute('aria-pressed', String(ov.id === id)));
    V.grid = null;
    ctx.requestRender();
  }
  // selecting γ..η anywhere in the app (ladder, face, converter) puts that level in the band
  const unsubSel = store.subscribe((kind, patch) => {
    if (kind === 'settings' && patch && 'selectedLevel' in patch && patch.selectedLevel >= 2 && patch.selectedLevel <= 6) setOverlay(patch.selectedLevel);
  });
  const legend = h('div.cal-legend');

  const wdRow = h('div.cal-wdrow', { 'aria-hidden': 'true' });
  const gridEl = h('div.cal-grid', { role: 'group', 'aria-label': 'Days of the month' });
  const cursor = h('span.cal-cursor', { 'aria-hidden': 'true' });
  const inspector = h('div.cal-inspect', { 'aria-live': 'polite' });
  const hearBtn = h('button.btn.btn-sm.cal-hear.cal-hear-day', { type: 'button', html: ICONS.sound + '<span>Hear this moment</span>', title: 'Hear this moment: a short chord of the displayed time', hidden: true });
  hearBtn.addEventListener('click', () => hearMoment(ctx, store.t()));
  const inspectWrap = h('div.cal-inspwrap', null, inspector, hearBtn);

  const ribbonEl = h('div.cal-ribbon');
  const ribbonSum = h('p.cal-ysum');
  const ribCursor = h('span.cal-rcursor', { 'aria-hidden': 'true' });
  const yearTitle = h('span.cal-ytitle');
  const decPrev = iconBtn(ICONS.prev2, 'Back ten years', () => stepYear(-10));
  const yPrev = iconBtn(ICONS.prev, 'Previous year', () => stepYear(-1));
  const yNext = iconBtn(ICONS.next, 'Next year', () => stepYear(1));
  const decNext = iconBtn(ICONS.next2, 'Forward ten years', () => stepYear(10));
  const yearSel2 = h('select.select.cal-ysel', { 'aria-label': 'Jump to a year' });
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) yearSel2.append(h('option', { value: String(y), text: String(y) }));

  const el = h(
    'section.card.cal-month',
    { 'aria-label': 'Gregorian calendar with Fractonica cycles' },
    h('header.card-h', null, h('h2', { text: 'Calendar' }), h('span.spacer'), h('div.cal-wk', null, h('span.cal-wk-l', { text: 'Week starts' }), wkSeg)),
    h(
      'div.card-b.cal-month-body',
      null,
      h('div.cal-nav', null, prevBtn, monthSel, yearSel, nextBtn, h('span.spacer'), shownBtn, todayBtn),
      h('div.cal-ovrow', null, h('span.cal-lab', { text: 'Cycle band' }), ovSeg, legend),
      h('div.cal-gridwrap', null, wdRow, gridEl),
      // the year ribbon sits right under the grid and the inspector (whose height follows the number of
      // cycles on the day) below it: nothing above moves when the displayed day changes
      h(
        'div.cal-year',
        null,
        h('div.cal-yh', null, yearTitle, h('span.spacer'), decPrev, yPrev, yearSel2, yNext, decNext),
        ribbonEl,
        ribbonSum,
      ),
      inspectWrap,
    ),
  );
  // ------------------------------------------------------------------------------------------
  // navigation of the view month
  // ------------------------------------------------------------------------------------------
  function setView(year, month, { keepFollow = false } = {}) {
    // the month index is clamped as a whole: "previous" at January 1613 stays at January 1613
    ({ year, month } = clampMonth(year, month));
    if (year === V.year && month === V.month) {
      V.focusKey = null; // nothing moved: a pending "keep the focus on this date" must not leak into a later rebuild
      return;
    }
    V.year = year;
    V.month = month;
    if (!keepFollow) V.follow = false;
    V.grid = null;
    ctx.requestRender();
  }
  const stepMonth = (d) => setView(V.year, V.month + d);
  const stepYear = (d) => setView(V.year + d, V.month);
  monthSel.addEventListener('change', () => setView(V.year, Number(monthSel.value)));
  yearSel.addEventListener('change', () => setView(Number(yearSel.value), V.month));
  yearSel2.addEventListener('change', () => setView(Number(yearSel2.value), V.month));
  todayBtn.addEventListener('click', () => {
    const p = fmt.parts(store.realNow());
    setView(p.year, p.month);
    V.focusKey = null;
  });
  shownBtn.addEventListener('click', () => {
    V.follow = true;
    V.pendingFollow = true;
    ctx.requestRender();
  });
  const unsubTime = store.onTime((reason) => {
    // play / pause / speed changes do not move the displayed time: they must not pull the month being browsed back
    if (reason === 'rate' || reason === 'pause' || reason === 'edge') return;
    V.follow = true;
    V.pendingFollow = true;
  });

  // ------------------------------------------------------------------------------------------
  // grid building
  // ------------------------------------------------------------------------------------------
  function weekdayOrder() {
    return V.weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  }
  function dayLabel(c) {
    return `${WEEKDAYS_LONG[c.dow]} ${c.day} ${MONTHS_LONG_UI[c.month - 1]} ${c.year}`;
  }
  /** What a screen reader hears after the date: eclipse and the cycles of the band (today / displayed are added live). */
  function dayRest(c) {
    if (c.skipped) return ', this date does not exist: the clocks of this zone skipped it';
    if (!c.inRange) return ', outside the catalogue';
    let a = '';
    if (c.eclipse >= 0) a += `, Saros 141 eclipse number ${c.eclipse} at ${fmt.time(r3(model.catalogue[c.eclipse]))}`;
    if (c.segments.length) {
      const ov = V.grid.overlay;
      a += `, ${ov.level === null ? 'solar sync quarters' : LEVEL_NAMES[ov.level] + ' cycles'}: `;
      a += c.segments.map((s) => (s.startsHere ? `${s.label} from ${fmt.time(r3(s.start), { seconds: false })}` : `${s.label} continuing`)).join(', ');
    }
    return a;
  }
  function applyLabel(i) {
    const c = V.cells[i];
    if (!c) return;
    setAttr(c.day, 'aria-label', c.lead + (i === V.todayIdx ? ', today' : '') + (i === V.shownIdx ? ', displayed time' : '') + c.rest);
    setAttr(c.day, 'aria-current', i === V.todayIdx ? 'date' : null);
  }

  function rebuild() {
    const t0 = performance.now();
    V.zone = fmt.zone();
    const g = buildMonth(model, fmt, { year: V.year, month: V.month, weekStart: V.weekStart, overlay: V.overlay });
    V.grid = g;
    const ov = g.overlay;
    const color = ov.level === null ? GOLD : levelColor(ov.level);
    el.style.setProperty('--cal-c', color);
    gridEl.textContent = '';
    wdRow.textContent = '';
    for (const d of weekdayOrder()) wdRow.append(h('div.cal-wd' + (d === 0 || d === 6 ? '.is-we' : ''), { text: WEEKDAYS_SHORT[d] }));
    V.cells = [];
    V.segInfo = [];
    V.segByKey = new Map();
    V.curKey = '';
    V.hotKey = '';
    V.shownIdx = -1;
    V.todayIdx = -1;
    for (const c of g.cells) {
      const day = h('button.cal-day', { type: 'button', tabindex: '-1' }, h('span.cal-dnum', { text: String(c.day) }));
      const band = h('div.cal-band');
      const segs = [];
      const cellEl = h(
        'div.cal-cell' + (c.inMonth ? '' : '.is-adj') + (c.inRange ? '' : '.is-out') + (c.skipped ? '.is-skipped' : '') + (c.dow === 0 || c.dow === 6 ? '.is-we' : '') + (c.day === 1 ? '.is-first' : ''),
        { 'data-i': String(c.index) },
        day,
        c.eclipse >= 0 ? h('span.cal-ecl', { html: ICONS.eclipse, 'aria-hidden': 'true', 'data-k': String(c.eclipse) }) : null,
        band,
      );
      if (c.day === 1 && c.inMonth) cellEl.append(h('span.cal-mon', { text: MONTHS_SHORT[c.month - 1] }));
      c.segments.forEach((s, i) => {
        const w = s.x1 - s.x0;
        const span = h('span');
        const b = h(
          'button.cal-seg' + (s.parity ? '.is-odd' : '') + (!s.startsHere ? '.is-cont' : '') + (s.startsHere ? '.is-start' : '') + (s.endsHere ? '.is-end' : ''),
          {
            type: 'button',
            tabindex: '-1',
            'aria-hidden': 'true',
            'data-key': s.key,
            style: `left:${(s.x0 * 100).toFixed(3)}%;width:${(w * 100).toFixed(3)}%`,
          },
          span,
        );
        band.append(b);
        segs.push(b);
        const list = V.segByKey.get(s.key) ?? [];
        list.push(b);
        V.segByKey.set(s.key, list);
        const variants =
          s.kind === 'sync'
            ? s.q === 0
              ? [`S${s.sync} · start`, `S${s.sync}`]
              : [`S${s.sync} · ${s.name}`, s.name]
            : [s.label, s.short, String(s.local + 1)];
        V.segInfo.push({ span, key: s.key, variants, w, cont: !s.startsHere, first: i === 0, rowStart: c.index % 7 === 0 || c.day === 1 });
      });
      gridEl.append(cellEl);
      V.cells.push({ el: cellEl, day, band, segs, data: c, lead: dayLabel(c), rest: dayRest(c) });
    }
    V.cells.forEach((_, i) => applyLabel(i));
    // roving tabindex
    // Tab enters the grid on the day that matters: the one kept in focus, else the displayed day, today, the 1st
    const focus = V.focusKey ? V.cells.findIndex((c) => c.data.key === V.focusKey) : -1;
    const inMonthAt = (t) => {
      const i = locate(t);
      return i >= 0 && V.cells[i].data.inMonth ? i : -1;
    };
    const startIdx = focus >= 0 ? focus : [inMonthAt(store.t()), inMonthAt(store.realNow())].find((i) => i >= 0) ?? Math.max(0, V.cells.findIndex((c) => c.data.inMonth));
    setRoving(startIdx);
    if (focus >= 0) {
      V.cells[focus].day.focus({ preventScroll: true });
      V.focusKey = null;
    }
    monthSel.value = String(V.month);
    yearSel.value = String(V.year);
    legend.innerHTML = legendHtml(ov);
    const ms = performance.now() - t0;
    V.lastRebuild = performance.now();
    V.lastBuildMs = ms;
    V.inspectKey = '';
    buildRibbon();
    updateMarkers(true);
    fitLabels();
  }

  function legendHtml(ov) {
    if (ov.id === 'sync') {
      return `<span class="cal-lg-sw" style="--c:${GOLD}"></span><span>Solar sync: four quarters of ≈ 1 day (<b>start · peak · node · valley</b>), labelled by the threshold that begins them.</span>`;
    }
    const info = model.levelInfo(ov.level);
    // "ε#5" = the 5th ε inside its δ; a bare "ε 5" is the depth chip the other views print
    const n = Math.min(5, info.siblings ?? 5);
    return (
      `<span class="cal-lg-sw" style="--c:${levelColor(ov.level)}"></span><span><b>${LETTERS[ov.level]} ${LEVEL_NAMES[ov.level]}</b> · depth ${ov.level + 1} · ≈ ${fmt.duration(info.meanSeconds, { parts: 2 })} per cycle. ` +
      `<b>${cycleLabel(ov.level, n)}</b> is the ${ordinal(n)} ${LETTERS[ov.level]} inside its ${LETTERS[ov.level - 1]} (${info.siblings} per ${LETTERS[ov.level - 1]}); ` +
      `a bold label marks where a cycle begins, a paler one continues it.</span>`
    );
  }

  function setRoving(idx) {
    V.cells.forEach((c, i) => c.day.setAttribute('tabindex', i === idx ? '0' : '-1'));
  }


  // ------------------------------------------------------------------------------------------
  // band labels: every cycle is named once, where its label fits (full -> short -> number)
  // ------------------------------------------------------------------------------------------
  let resizeObs = null;
  const measureCtx = document.createElement('canvas').getContext('2d');
  const widthCache = new Map();
  function fitLabels() {
    if (!V.segInfo.length || !V.cells.length) return;
    const cellW = V.cells[0].el.clientWidth;
    if (!cellW) {
      V.needFit = true;
      return;
    }
    V.needFit = false;
    const cs = getComputedStyle(V.cells[0].segs[0] ?? V.cells[0].el);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    measureCtx.font = font;
    const measure = (text) => {
      const k = font + '|' + text;
      let v = widthCache.get(k);
      if (v === undefined) {
        v = measureCtx.measureText(text).width;
        widthCache.set(k, v);
      }
      return v;
    };
    const seen = new Set();
    for (const s of V.segInfo) {
      const avail = s.w * cellW - 9;
      const want = !seen.has(s.key) || (s.cont && s.first && s.rowStart);
      let text = '';
      if (want) text = s.variants.find((v) => measure(v) <= avail) ?? '';
      if (text) seen.add(s.key);
      setText(s.span, text);
    }
  }
  if (typeof ResizeObserver !== 'undefined') {
    let raf = 0;
    let lastW = 0;
    resizeObs = new ResizeObserver(() => {
      const w = gridEl.clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fitLabels);
    });
    resizeObs.observe(gridEl);
  }

  // ------------------------------------------------------------------------------------------
  // interactions
  // ------------------------------------------------------------------------------------------
  const cellOf = (target) => {
    const ce = target.closest?.('.cal-cell');
    return ce ? V.cells[Number(ce.dataset.i)] : null;
  };
  const segOf = (target) => {
    const be = target.closest?.('.cal-seg');
    if (!be) return null;
    const c = cellOf(be);
    if (!c) return null;
    const i = c.segs.indexOf(be);
    return i >= 0 ? { cell: c, seg: c.data.segments[i], el: be } : null;
  };

  function timeOnDay(cellData, hour) {
    const p = fmt.parts(store.t());
    return fmt.toUnix({
      year: cellData.year,
      month: cellData.month,
      day: cellData.day,
      hour: hour ?? p.hour,
      minute: hour === undefined ? p.minute : 0,
      second: hour === undefined ? p.second : 0,
      ms: hour === undefined ? p.ms : 0,
    });
  }
  function gotoDay(c, noon) {
    if (c.data.skipped) {
      ctx.toast(`The clocks of this zone skipped ${c.data.key}`);
      return;
    }
    if (!c.data.inRange) {
      ctx.toast(`Outside the catalogue (${catalogueRangeText(model)})`);
      return;
    }
    const t = model.clamp(timeOnDay(c.data, noon ? 12 : undefined));
    ctx.goto(t);
  }

  const coarseMq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  gridEl.addEventListener('click', (e) => {
    const s = segOf(e.target);
    if (s) {
      // A thumb cannot aim at the thin band: on touch the first tap on another day only selects that day
      // (the inspector then lists its cycles with go buttons); tapping the band again goes to the cycle.
      const touch = e.pointerType ? e.pointerType === 'touch' : !!coarseMq?.matches;
      if (touch && s.cell.data.index !== V.shownIdx) {
        setRoving(s.cell.data.index);
        gotoDay(s.cell, false);
        return;
      }
      const level = s.seg.kind === 'cycle' ? s.seg.level : 6;
      ctx.goto(landOn(model, s.seg.start, s.seg.q === 0 || s.seg.kind === 'cycle' ? level : undefined));
      return;
    }
    const c = cellOf(e.target);
    if (c && e.target.closest('.cal-day, .cal-ecl, .cal-mon')) {
      setRoving(c.data.index);
      if (e.detail === 0) V.focusKey = c.data.key; // keyboard: keep the focus on this date when the grid is rebuilt
      gotoDay(c, false);
    }
  });
  gridEl.addEventListener('dblclick', (e) => {
    if (segOf(e.target)) return;
    const c = cellOf(e.target);
    if (c && e.target.closest('.cal-day')) gotoDay(c, true);
  });

  // hover: highlight the whole cycle and show a tooltip
  gridEl.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const s = segOf(e.target);
    if (s) {
      setHot(s.seg.key);
      tip.show(segTipHtml(s.seg, s.cell.data), e.clientX, e.clientY);
      return;
    }
    setHot('');
    const c = cellOf(e.target);
    if (c && e.target.closest('.cal-day, .cal-ecl')) tip.show(dayTipHtml(c.data), e.clientX, e.clientY);
    else tip.hideSoon(); // the gaps between cells must not make the tooltip flicker
  });
  gridEl.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (!tip.el.hidden) {
      const s = segOf(e.target);
      const c = cellOf(e.target);
      if (s) tip.show(segTipHtml(s.seg, s.cell.data), e.clientX, e.clientY);
      else if (c && e.target.closest('.cal-day, .cal-ecl')) tip.show(dayTipHtml(c.data), e.clientX, e.clientY);
      else tip.hideSoon();
    }
  });
  gridEl.addEventListener('pointerleave', () => {
    setHot('');
    tip.hideSoon();
  });
  gridEl.addEventListener('focusin', (e) => {
    const c = cellOf(e.target);
    if (c && e.target.classList.contains('cal-day')) {
      setRoving(c.data.index);
      const r = e.target.getBoundingClientRect();
      if (e.target.matches(':focus-visible')) tip.show(dayTipHtml(c.data), r.left + r.width * 0.6, r.top + r.height * 0.5);
    }
  });
  gridEl.addEventListener('focusout', () => tip.hide());

  function setHot(key) {
    if (V.hotKey === key) return;
    for (const b of V.segByKey.get(V.hotKey) ?? []) b.classList.remove('is-hot');
    V.hotKey = key;
    for (const b of V.segByKey.get(key) ?? []) b.classList.add('is-hot');
  }

  gridEl.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.classList?.contains('cal-day')) return;
    const c = cellOf(t);
    if (!c) return;
    const i = c.data.index;
    let delta = null;
    if (e.key === 'ArrowLeft') delta = -1;
    else if (e.key === 'ArrowRight') delta = 1;
    else if (e.key === 'ArrowUp') delta = -7;
    else if (e.key === 'ArrowDown') delta = 7;
    else if (e.key === 'Home') delta = -(i % 7);
    else if (e.key === 'End') delta = 6 - (i % 7);
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const dir = e.key === 'PageUp' ? -1 : 1;
      const d = c.data;
      const nm = e.shiftKey ? [d.year + dir, d.month] : [d.year, d.month + dir];
      const dim = new Date(Date.UTC(nm[0], nm[1], 0)).getUTCDate();
      const target = new Date(Date.UTC(nm[0], nm[1] - 1, Math.min(d.day, dim)));
      V.focusKey = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
      setView(target.getUTCFullYear(), target.getUTCMonth() + 1);
      return;
    }
    if (delta === null) return;
    e.preventDefault();
    const j = i + delta;
    if (j >= 0 && j < V.cells.length && V.cells[j].data.inMonth) {
      setRoving(j);
      V.cells[j].day.focus();
      return;
    }
    // leave the month: move the view and keep the focus on the same date
    const tgt = addDays(c.data.year, c.data.month, c.data.day, delta);
    V.focusKey = `${tgt.year}-${String(tgt.month).padStart(2, '0')}-${String(tgt.day).padStart(2, '0')}`;
    setView(tgt.year, tgt.month);
  });

  // ------------------------------------------------------------------------------------------
  // tooltips
  // ------------------------------------------------------------------------------------------
  const stamp = (t) => `${fmt.long(r3(t))}`;
  function dayTipHtml(c) {
    const g = gregorianInfo(fmt, c.start + 1);
    let html = `<div class="cal-tt-h">${esc(WEEKDAYS_LONG[c.dow])} ${c.day} ${esc(MONTHS_LONG_UI[c.month - 1])} ${c.year}</div>`;
    if (c.skipped) return html + `<div class="dim">This date does not exist in ${esc(fmt.zone().replace(/_/g, ' '))}:<br>the clocks skipped it.</div>`;
    if (!c.inRange) {
      return html + `<div class="dim">Outside the catalogue<br>${esc(catalogueRangeText(model))} (UTC)</div>`;
    }
    html += `<div class="dim">day ${g.dayOfYear} of ${g.daysInYear} · ${esc(c.length === 86400 ? '24 h' : c.length / 3600 + ' h (clock change)')} · ${esc(g.tag)}</div>`;
    const t = Math.max(c.start, model.tMin);
    const addr = addressText(model, t);
    if (addr) html += `<div class="mono cal-tt-addr">${esc(addr)}<span class="dim"> at ${esc(fmt.time(r3(t), { seconds: false }))}</span></div>`;
    if (c.eclipse >= 0) html += `<div class="cal-tt-ecl">${ICONS.eclipse}<span>Saros 141 eclipse #${c.eclipse} · greatest at ${esc(fmt.time(r3(model.catalogue[c.eclipse])))}</span></div>`;
    html += '<div class="dim cal-tt-hint">Click: show this day at the displayed time of day.<br>Double-click: noon.</div>';
    return html;
  }

  function segTipHtml(s, cell) {
    const T = store.t();
    if (s.kind === 'sync') {
      const col = GOLD;
      const q = s.q + 1;
      const drift = s.drift;
      return (
        `<div class="cal-tt-h" style="color:${col}">Solar sync ${s.sync} · quarter ${q} of 4</div>` +
        `<div class="dim">${esc(s.name)} → ${esc(s.endName)}</div>` +
        `<dl class="cal-tt-dl"><dt>from</dt><dd>${esc(stamp(s.start))}</dd><dt>to</dt><dd>${esc(stamp(s.end))}</dd>` +
        `<dt>sync starts</dt><dd>${esc(stamp(s.syncStart))}</dd><dt>sync ends</dt><dd>${esc(stamp(s.syncEnd))}</dd>` +
        `<dt>drift</dt><dd>${drift < 0 ? '−' : '+'}${esc(fmt.duration(Math.abs(drift), { parts: 3 }))} vs the civil grid <span class="dim">(grid ${esc(fmt.date(r3(s.nominalStart)))} ${esc(fmt.time(r3(s.nominalStart), { seconds: false }))})</span></dd></dl>` +
        `<div class="dim cal-tt-hint">Click to go to this quarter's start.</div>`
      );
    }
    const info = model.levelInfo(s.level);
    const col = levelColor(s.level);
    const path = model.cycleToPath(s.level, BigInt(s.idx));
    const cur = T >= s.start && T < s.end;
    // quarter thresholds
    let next = -1;
    const times = [1, 2, 3, 4].map((q) => pointOfCycle(model, s.level, s.idx, q / 4));
    for (let i = 0; i < 4; i++) {
      if (times[i] !== null && times[i] > T) {
        next = i;
        break;
      }
    }
    const names = ['peak', 'node', 'valley', 'end'];
    const rows = times
      .map((t, i) => (t === null ? '' : `<dt>${i === next ? '▸ ' : ''}${names[i]}</dt><dd${i === next ? ' class="is-next"' : ''}>${esc(stamp(t))}</dd>`))
      .join('');
    return (
      `<div class="cal-tt-h" style="color:${col}">${cycleLabel(s.level, s.local + 1)}<span class="dim"> · ${s.local + 1} / ${s.siblings ?? Number(model.clock.count(0))}${s.level ? ' in ' + cycleLabel(s.level - 1, path[s.level - 1]) : ''}</span>${cur ? ' <span class="chip cal-chip is-info">displayed</span>' : ''}</div>` +
      `<div class="mono cal-tt-addr">${esc(pathText(path))}</div>` +
      `<dl class="cal-tt-dl"><dt>starts</dt><dd>${esc(stamp(s.start))}</dd><dt>ends</dt><dd>${esc(s.clipped ? 'catalogue end ' + stamp(model.tMax) : stamp(s.end))}</dd><dt>length</dt><dd>${esc(fmt.duration(s.end - s.start))}${s.clipped ? ' (clipped)' : ''}</dd>${rows}</dl>` +
      `<div class="dim cal-tt-hint">global index ${s.idx} at depth ${s.level + 1} (jump box: d${s.level + 1}#${s.idx}) · click to go to its start</div>`
    );
  }

  // ------------------------------------------------------------------------------------------
  // per-frame markers
  // ------------------------------------------------------------------------------------------
  function locate(t) {
    for (let i = 0; i < V.cells.length; i++) {
      const d = V.cells[i].data;
      if (t >= d.start && t < d.end) return i;
    }
    return -1;
  }

  function updateMarkers(force = false) {
    if (!V.grid) return;
    const T = store.t();
    // displayed day
    let idx = V.shownIdx;
    if (force || idx < 0 || !(T >= V.cells[idx].data.start && T < V.cells[idx].data.end)) idx = locate(T);
    if (idx !== V.shownIdx || force) {
      const was = V.shownIdx;
      if (was >= 0 && V.cells[was]) V.cells[was].el.classList.remove('is-shown');
      V.shownIdx = idx;
      if (idx >= 0) {
        V.cells[idx].el.classList.add('is-shown');
        V.cells[idx].el.append(cursor);
        cursor.hidden = false;
      } else cursor.hidden = true;
      V.curKey = '';
      V.inspectKey = '';
      applyLabel(was);
      applyLabel(idx);
    }
    if (idx >= 0) {
      const d = V.cells[idx].data;
      const x = Math.min(1, Math.max(0, (T - d.start) / d.length));
      setStyle(cursor, 'left', (x * 100).toFixed(2) + '%');
      // the cycle under the cursor
      let key = '';
      for (const s of d.segments) if (T >= s.start && T < s.end) key = s.key;
      if (key !== V.curKey) {
        for (const b of V.segByKey.get(V.curKey) ?? []) b.classList.remove('is-current');
        V.curKey = key;
        for (const b of V.segByKey.get(key) ?? []) b.classList.add('is-current');
        markInspectorCurrent();
      }
    } else if (V.curKey) {
      for (const b of V.segByKey.get(V.curKey) ?? []) b.classList.remove('is-current');
      V.curKey = '';
      markInspectorCurrent();
    }
    // real today
    const nowMs = performance.now();
    if (force || nowMs - V.lastToday > 2000) {
      V.lastToday = nowMs;
      const ti = locate(store.realNow());
      if (ti !== V.todayIdx) {
        const was = V.todayIdx;
        if (was >= 0 && V.cells[was]) V.cells[was].el.classList.remove('is-today');
        V.todayIdx = ti;
        if (ti >= 0) V.cells[ti].el.classList.add('is-today');
        applyLabel(was);
        applyLabel(ti);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // day inspector
  // ------------------------------------------------------------------------------------------
  /** The row of the cycle that contains the displayed time (the band's own highlight, mirrored). */
  function markInspectorCurrent() {
    for (const li of inspector.querySelectorAll('.cal-ddr')) toggleClass(li, 'is-current', V.curKey !== '' && li.dataset.key === V.curKey);
  }
  function paintInspector() {
    // announced politely, but not while a time-lapse flips through days every second
    setAttr(inspector, 'aria-live', store.mode === 'live' || store.rate === 0 ? 'polite' : 'off');
    const idx = V.shownIdx;
    const key = `${idx}|${V.overlay}|${V.zone}|${V.grid?.start}`;
    if (key === V.inspectKey) return;
    V.inspectKey = key;
    if (idx < 0) {
      const T = store.t();
      let why = `<span class="dim">is not in this month</span>`;
      if (V.grid && V.grid.end <= model.tMin) why = `<span class="dim">This month is before the catalogue starts (${esc(catalogueRangeText(model).split(' … ')[0])} UTC), so it has no cycles.</span>`;
      else if (V.grid && V.grid.start > model.tMax) why = `<span class="dim">This month is after the catalogue ends (${esc(catalogueRangeText(model).split(' … ')[1])} UTC), so it has no cycles.</span>`;
      inspector.innerHTML = `<div class="cal-dd-h"><b>${esc(fmt.long(r3(T)).split(',')[0])}</b>${why}<button type="button" class="btn btn-sm" data-act="shown">${ICONS.target}<span>Show displayed day</span></button></div>`;
      return;
    }
    const d = V.cells[idx].data;
    const g = gregorianInfo(fmt, d.start + 1);
    let html = `<div class="cal-dd-h"><b>${esc(WEEKDAYS_LONG[d.dow])} ${d.day} ${esc(MONTHS_LONG_UI[d.month - 1])} ${d.year}</b>` +
      `<span class="dim">day ${g.dayOfYear} of ${g.daysInYear} · ${esc(d.length === 86400 ? '24 h' : d.length / 3600 + ' h')} · ${esc(g.tag)}</span>` +
      (d.eclipse >= 0 ? `<span class="chip cal-chip is-gold" title="Greatest eclipse of Saros 141 on this day">${ICONS.eclipse}eclipse #${d.eclipse} · ${esc(fmt.time(r3(model.catalogue[d.eclipse])))}</span>` : '') +
      '</div>';
    if (!d.segments.length) {
      const why = d.skipped
        ? 'The clocks of this zone skipped this date.'
        : !d.inRange
          ? 'No cycles: this day is outside the catalogue.'
          : V.overlay === 'sync'
            ? 'No complete solar sync covers this day: the first and last ≈ 2.5 days of the catalogue belong to half-syncs.'
            : 'No cycles on this day.';
      html += `<div class="dim cal-dd-none">${why}</div>`;
    } else {
      html += `<ul class="cal-dd-list${V.overlay === 'sync' ? ' is-sync' : ''}">`;
      d.segments.forEach((s, i) => {
        const col = s.kind === 'sync' ? GOLD : levelColor(s.level);
        const lab = s.kind === 'sync' ? s.label : cycleLabel(s.level, s.local + 1);
        // cycles longer than a year (γ) carry their years: "Feb 16 → Mar 28" would be ambiguous
        const a = spanLabel(fmt, s.start, d.start + 1, s.start, s.end);
        const b = spanLabel(fmt, s.end, d.start + 1, s.start, s.end);
        const len = fmt.duration(s.end - s.start);
        html +=
          `<li class="cal-ddr" data-key="${esc(s.key)}" style="--c:${col}"><span class="cal-ddl">${esc(lab)}</span>` +
          `<span class="cal-ddt mono">${esc(a)} → ${esc(b)}</span><span class="cal-ddx dim">${esc(len)}</span>` +
          `<button type="button" class="cal-go" data-i="${i}" title="Go to the start of ${esc(lab)}" aria-label="Go to the start of ${esc(lab)}">${ICONS.go}</button></li>`;
      });
      html += '</ul>';
    }
    inspector.innerHTML = html;
    markInspectorCurrent();
  }
  inspector.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="shown"]')) {
      V.follow = true;
      V.pendingFollow = true;
      ctx.requestRender();
      return;
    }
    const b = e.target.closest('button[data-i]');
    if (!b || V.shownIdx < 0) return;
    const s = V.cells[V.shownIdx].data.segments[Number(b.dataset.i)];
    if (!s) return;
    ctx.goto(landOn(model, s.start, s.kind === 'cycle' ? s.level : s.q === 0 ? 6 : undefined));
  });

  // ------------------------------------------------------------------------------------------
  // year ribbon
  // ------------------------------------------------------------------------------------------
  let ribbonSig = '';
  function buildRibbon() {
    const sig = `${V.year}|${fmt.zone()}`;
    if (sig === ribbonSig) return; // the markers are kept up to date by updateRibbonMarkers()
    ribbonSig = sig;
    const r = yearRibbon(model, fmt, V.year);
    V.ribbon = r;
    const sum = yearSummary(model, fmt, V.year);
    ribbonEl.textContent = '';
    const months = h('div.cal-rmonths');
    for (const m of r.months) {
      const b = h(
        'button.cal-rm',
        {
          type: 'button',
          style: `left:${(m.x0 * 100).toFixed(4)}%;width:${((m.x1 - m.x0) * 100).toFixed(4)}%`,
          'data-m': String(m.month),
          class: m.inRange ? '' : 'is-out',
          'aria-label': `${MONTHS_LONG_UI[m.month - 1]} ${V.year}`,
          title: `${MONTHS_LONG_UI[m.month - 1]} ${V.year}`,
        },
        h('span', { text: MONTHS_SHORT[m.month - 1] }),
      );
      months.append(b);
    }
    ribbonEl.append(months);
    const ticks = h('div.cal-rticks', { 'aria-hidden': 'true' });
    for (const t of r.eps) {
      ticks.append(h('button.cal-rt.is-eps', { type: 'button', tabindex: '-1', style: `left:${(t.x * 100).toFixed(4)}%;--c:${levelColor(4)}`, 'data-lv': '4', 'data-idx': String(t.idx) }));
    }
    for (const t of r.delta) {
      ticks.append(
        h('button.cal-rt.is-delta', { type: 'button', tabindex: '-1', style: `left:${(t.x * 100).toFixed(4)}%;--c:${levelColor(3)}`, 'data-lv': '3', 'data-idx': String(t.idx) }, h('span', { text: t.label })),
      );
    }
    ribbonEl.append(ticks);
    ribbonEl.append(ribCursor);
    setText(yearTitle, String(V.year));
    setText(ribbonSum, sum.text + '.');
    yearSel2.value = String(V.year);
    updateRibbonMarkers(true);
  }
  ribbonEl.addEventListener('click', (e) => {
    const t = e.target.closest('.cal-rt');
    if (t) {
      const lv = Number(t.dataset.lv);
      ctx.goto(landOn(model, model.cycleStartTime(lv, Number(t.dataset.idx)), lv));
      return;
    }
    const m = e.target.closest('.cal-rm');
    if (m) {
      setView(V.year, Number(m.dataset.m));
      V.focusKey = null;
    }
  });
  ribbonEl.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest('.cal-rt');
    if (t) {
      const lv = Number(t.dataset.lv);
      const idx = Number(t.dataset.idx);
      const st = model.cycleStartTime(lv, idx);
      const path = model.cycleToPath(lv, BigInt(idx));
      tip.show(
        `<div class="cal-tt-h" style="color:${levelColor(lv)}">${cycleLabel(lv, path[lv])}<span class="dim"> starts</span></div><div class="mono cal-tt-addr">${esc(pathText(path))}</div><div>${esc(stamp(st))}</div><div class="dim cal-tt-hint">Click to go there.</div>`,
        e.clientX,
        e.clientY,
      );
      return;
    }
    const m = e.target.closest('.cal-rm');
    if (m) tip.show(`<div class="cal-tt-h">${MONTHS_LONG_UI[Number(m.dataset.m) - 1]} ${V.year}</div><div class="dim cal-tt-hint">Click to show this month.</div>`, e.clientX, e.clientY);
    else tip.hide();
  });
  ribbonEl.addEventListener('pointerleave', () => tip.hide());

  function updateRibbonMarkers(force = false) {
    if (!V.ribbon) return;
    const T = store.t();
    const r = V.ribbon;
    const inYear = T >= r.start && T < r.end;
    if (ribCursor.hidden === inYear) ribCursor.hidden = !inYear;
    if (inYear) setStyle(ribCursor, 'left', (((T - r.start) / (r.end - r.start)) * 100).toFixed(3) + '%');
    const sd = V.shownIdx >= 0 ? V.cells[V.shownIdx].data : null;
    const shownMonth = inYear && sd && sd.year === V.year ? sd.month : 0;
    if (force || V.lastRibbonMonth !== V.month || V.lastRibbonShown !== shownMonth) {
      V.lastRibbonMonth = V.month;
      V.lastRibbonShown = shownMonth;
      ribbonEl.querySelectorAll('.cal-rm').forEach((b) => {
        const m = Number(b.dataset.m);
        toggleClass(b, 'is-view', m === V.month);
        toggleClass(b, 'is-shown', m === shownMonth);
        setAttr(b, 'aria-current', m === V.month ? 'true' : null);
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // sticky card: when it is taller than the window it docks by its bottom edge, so all of it is reachable
  // by scrolling the page (no scroll trap, no inner scrollbar)
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
  function followMonth(T) {
    if (!(T >= model.tMin - 86400 * 400 && T <= model.tMax + 86400 * 400)) return;
    const p = fmt.parts(T);
    if (p.year !== V.year || p.month !== V.month) {
      V.year = p.year;
      V.month = p.month;
      V.grid = null;
    }
  }

  return {
    el,
    setActive(on) {
      V.active = on;
      if (on) {
        V.pendingFollow = V.follow;
        ctx.requestRender();
      } else tip.hide();
    },
    /** the month being shown (for tests / other modules) */
    get view() {
      return { year: V.year, month: V.month, follow: V.follow, overlay: V.overlay, weekStart: V.weekStart };
    },
    get buildMs() {
      return V.lastBuildMs ?? 0;
    },
    render(frame) {
      const T = frame.t;
      if (V.year === 0) {
        followMonth(T);
        if (V.year === 0) {
          const p = fmt.parts(store.realNow());
          V.year = p.year;
          V.month = p.month;
        }
      }
      if (fmt.zone() !== V.zone) V.grid = null;
      if (V.follow && V.grid) {
        // follow the displayed time into its month (throttled: a time-lapse crosses months quickly)
        const shown = V.shownIdx >= 0 ? V.cells[V.shownIdx].data : null;
        const away = !shown || !shown.inMonth;
        if (V.pendingFollow || (away && performance.now() - V.lastRebuild > 220)) {
          const was = `${V.year}-${V.month}`;
          followMonth(T);
          if (`${V.year}-${V.month}` !== was) V.grid = null;
        }
        V.pendingFollow = false;
      }
      toggleClass(shownBtn, 'is-away', V.follow);
      const atStart = V.year === FIRST_YEAR && V.month === 1;
      const atEnd = V.year === LAST_YEAR && V.month === 12;
      if (prevBtn.disabled !== atStart) prevBtn.disabled = atStart;
      if (nextBtn.disabled !== atEnd) nextBtn.disabled = atEnd;
      if (!V.grid) rebuild();
      else buildRibbon();
      if (V.needFit) fitLabels();
      updateMarkers();
      updateRibbonMarkers();
      paintInspector();
      const sound = hasSound(ctx); // the sound module mounts in parallel with this one
      if (hearBtn.hidden === sound) hearBtn.hidden = !sound;
      if (hearBtn.disabled === frame.inRange) hearBtn.disabled = !frame.inRange;
    },
    /** Move the keyboard focus into the grid (the day Tab would enter on). */
    focusGrid() {
      el.querySelector('.cal-day[tabindex="0"]')?.focus();
    },
    destroy() {
      unsubSel();
      unsubTime();
      resizeObs?.disconnect();
      stickRO?.disconnect();
      window.removeEventListener('resize', updateStick);
      tip.hide();
      el.remove();
    },
  };
}
