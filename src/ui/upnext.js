/**
 * Up next: what turns over soon, and when.
 *
 * A turnover is the instant a cycle ends and the next one begins; when a coarse cycle ends
 * every finer cycle ends with it. The card lists the next turnovers whose coarsest rolling
 * level is within the chosen importance (α–γ … α–η), headed by a hero for the very next one.
 *
 *   hero   "Next major turnover"  [ε 5]  in 2 d 03 h 11 min   Sun 18 Oct 2026, 03:41:12   (Just before / Just after)
 *   strip  next quarter threshold of the level selected in the ladder
 *   list   the following turnovers, grouped by civil day
 *
 * Contract: export mount(el, ctx) -> { render, alwaysOn, destroy } (docs/ARCHITECTURE.md).
 */
import {
  DEFAULT_IMPORTANCE,
  DEFAULT_MAX_DEPTH,
  IMPORTANCE,
  advancedBy,
  buildEvents,
  countdownLong,
  countdownText,
  groupByDay,
  importanceById,
  isStale,
  justAfterTime,
  justBeforeEventTime,
  justBeforeLead,
  leadText,
  letterOf,
  normDepth,
  normLevel,
  pctWhole,
  quantize,
  turnoverSentence,
  whenFull,
  whenLabel,
} from './ladder/lib.js';
import { attrCell, classCell, createTip, esc, icons, levelVars, reducedMotion, textCell } from './ladder/dom.js';

const PREF_KEY = 'fractonica-clock/upnext/importance';
const COUNT = 8; // hero + 7 list rows

const readPref = () => {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
};
const writePref = (v) => {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* private mode: the choice just does not persist */
  }
};

export function mount(el, ctx) {
  const { model, store, fmt, theme } = ctx;
  const QN = ctx.QUARTER_NAMES;
  let importance = importanceById(readPref() ?? DEFAULT_IMPORTANCE);

  el.classList.add('upnext');
  el.innerHTML = `
    <div class="card-h upnext-head">
      <h2 id="upnext-title">Up next</h2>
      <span class="spacer"></span>
      <div class="seg upnext-imp" role="group" aria-label="Importance: the finest cycle whose turnover counts"></div>
    </div>
    <div class="card-b upnext-body">
      <p class="upnext-cap"></p>
      <section class="upnext-hero" aria-labelledby="upnext-kicker" hidden>
        <div class="upnext-kicker" id="upnext-kicker">Next major turnover</div>
        <div class="upnext-hero-main">
          <div class="upnext-badge" role="img"><b></b><span class="mono"></span></div>
          <div class="upnext-hero-t">
            <div class="upnext-count mono"><span class="upnext-in">in</span> <span class="upnext-count-v"></span></div>
            <div class="upnext-when"><span class="upnext-when-v"></span> <span class="dim mono upnext-zone"></span></div>
          </div>
        </div>
        <p class="upnext-sentence"></p>
        <div class="upnext-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
        <div class="upnext-prog-cap"><span class="upnext-since"></span><span class="mono upnext-pct"></span></div>
        <div class="upnext-actions">
          <button class="btn btn-sm" type="button" data-act="before">${icons.before}<span>Just before</span></button>
          <button class="btn btn-sm upnext-primary" type="button" data-act="after">${icons.after}<span>Just after</span></button>
        </div>
      </section>
      <button class="upnext-strip" type="button" hidden>
        <span class="upnext-chip" role="img"><b></b><span class="mono"></span></span>
        <span class="upnext-strip-t"><span class="upnext-strip-k">next</span> <b class="upnext-q"></b> <span class="mono upnext-strip-in"></span></span>
        <span class="upnext-strip-c mono"></span>
      </button>
      <ol class="upnext-list" aria-label="Following turnovers"></ol>
      <p class="upnext-empty" hidden></p>
      <p class="upnext-note">A turnover is the instant a cycle ends and the next one begins; every finer cycle ends with it. Click a row for Just after (1 ms into the next cycle), or its arrow for Just before (2 s ahead, then real time).</p>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const impEl = $('.upnext-imp');
  const hero = $('.upnext-hero');
  const strip = $('.upnext-strip');
  const listEl = $('.upnext-list');
  const emptyEl = $('.upnext-empty');
  const H = {
    badge: $('.upnext-badge'),
    badgeL: $('.upnext-badge b'),
    badgeD: $('.upnext-badge .mono'),
    count: textCell($('.upnext-count-v')),
    countBox: $('.upnext-count'),
    size: 0,
    when: textCell($('.upnext-when-v')),
    zone: textCell($('.upnext-zone')),
    sentence: textCell($('.upnext-sentence')),
    p: -1,
    prog: $('.upnext-prog'),
    progFill: $('.upnext-prog i'),
    since: textCell($('.upnext-since')),
    pct: textCell($('.upnext-pct')),
    now: attrCell($('.upnext-prog'), 'aria-valuenow'),
  };
  const S = {
    chipL: strip.querySelector('.upnext-chip b'),
    chipD: strip.querySelector('.upnext-chip .mono'),
    q: textCell(strip.querySelector('.upnext-q')),
    inEl: textCell(strip.querySelector('.upnext-strip-in')),
    clock: textCell(strip.querySelector('.upnext-strip-c')),
    none: classCell(strip, 'is-none'),
    title: attrCell(strip, 'title'),
    off: attrCell(strip, 'disabled'),
    chip: strip.querySelector('.upnext-chip'),
    sel: -1,
  };
  const tip = createTip('upnext-tip');
  const setCap = textCell($('.upnext-cap'));
  /** Finest level of the ladder's range (0-based): the hero sentence names the finer cycles down to it. */
  const maxLevel = () => normDepth(store.state.maxDepth, DEFAULT_MAX_DEPTH) - 1;

  // importance control ------------------------------------------------------
  for (const imp of IMPORTANCE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = imp.id;
    b.textContent = imp.label;
    b.title = `Turnovers of cycles down to ${imp.id}, depth ${imp.top + 1} (about ${fmt.duration(model.levelInfo(imp.top).meanSeconds)} each)`;
    b.addEventListener('click', () => {
      if (importance === imp) return;
      importance = imp;
      writePref(imp.id);
      stale = true;
      syncImportance();
      ctx.requestRender();
    });
    impEl.append(b);
  }
  function syncImportance() {
    for (const b of impEl.children) b.setAttribute('aria-pressed', String(b.dataset.id === importance.id));
    setCap(`Counting ${importance.label} turnovers · ${importance.id} cycles last about ${fmt.duration(model.levelInfo(importance.top).meanSeconds)}`);
    // coarse importances count in whole days / years, so their countdown column can be narrower and the date wider
    listEl.style.setProperty('--in-w', importance.top <= 4 ? '76px' : '84px');
  }
  syncImportance();

  // state --------------------------------------------------------------------
  let events = []; // full list incl. the hero, from lib.buildEvents
  let rows = new Map(); // key -> row
  let heroKey = null;
  let heroStart = 0;
  let heroEnd = 0;
  let validFrom = -Infinity;
  let validUntil = -Infinity;
  let sig = '';
  let stale = true;
  let off = null;
  let lastPassAnim = 0;
  const offTime = store.onTime(() => {
    stale = true;
  });

  // navigation ------------------------------------------------------------------
  /** "Just after": 1 ms into the cycle that follows the turnover. */
  function jumpAfter(time) {
    ctx.goto(justAfterTime(time));
  }
  /** "Just before": 2 s ahead of the turnover (a quarter of its cycle when that is shorter), then real time. */
  function jumpBefore(time, top) {
    ctx.goto(justBeforeEventTime(model, time, top));
    store.setRate(1); // so the turnover can actually be watched, whatever speed the clock was running at
  }
  /**
   * The turnover that is next when the button is pressed. In a fast time-lapse the card can be a frame behind
   * (hundreds of events per frame), and a stale event would send the clock backwards.
   */
  const heroBefore = hero.querySelector('[data-act="before"]');
  const heroAfter = hero.querySelector('[data-act="after"]');
  const nextTurnover = () => buildEvents(model, store.t(), { importance, maxLevel: maxLevel(), count: 1 })[0] ?? null;
  heroAfter.addEventListener('click', () => {
    const ev = nextTurnover();
    if (ev) jumpAfter(ev.time);
  });
  heroBefore.addEventListener('click', () => {
    const ev = nextTurnover();
    if (ev) jumpBefore(ev.time, ev.top);
  });
  strip.addEventListener('click', () => {
    const lv = model.levelAt(store.t(), normLevel(store.state.selectedLevel));
    if (lv?.next.time != null) jumpAfter(lv.next.time);
  });
  let lastFrame = null;

  // rows ---------------------------------------------------------------------------
  function makeItem(ev) {
    const info = model.levelInfo(ev.top);
    const li = document.createElement('li');
    li.className = 'upnext-item';
    li.style.cssText = levelVars(theme, ev.top);
    li.innerHTML = `
      <button class="upnext-go" type="button">
        <span class="upnext-chip" role="img" aria-label="${esc(depthName(ev.top))}"><b>${esc(info.letter)}</b><span class="mono">${info.depth}</span></span>
        <span class="upnext-in-s mono"></span>
        <span class="upnext-dt"><span class="upnext-day"></span><span class="upnext-clock mono"></span></span>
        <span class="upnext-fin"><span class="upnext-fin-n"></span><span class="upnext-fin-w"> finer</span></span>
      </button>
      <button class="upnext-pre" type="button">${icons.before}</button>`;
    const go = li.querySelector('.upnext-go');
    const pre = li.querySelector('.upnext-pre');
    const row = {
      key: ev.key,
      el: li,
      go,
      pre,
      ev,
      setIn: textCell(li.querySelector('.upnext-in-s')),
      setDay: textCell(li.querySelector('.upnext-day')),
      setClock: textCell(li.querySelector('.upnext-clock')),
      setFin: textCell(li.querySelector('.upnext-fin-n')),
      finEl: li.querySelector('.upnext-fin'),
      setSep: classCell(li, 'is-newday'),
    };
    go.addEventListener('click', () => jumpAfter(row.ev.time));
    pre.addEventListener('click', () => jumpBefore(row.ev.time, row.ev.top));
    return row;
  }

  /** "ζ, depth 6": the letter and the depth number a chip shows, spelled out. */
  const depthName = (top) => `${letterOf(top)}, depth ${top + 1}`;
  /** How far ahead "Just before" stops, as text ("2 s"); the cycles listed here are hours long, so it is always the full 2 s. */
  const leadOf = (top) => leadText(justBeforeLead(model.levelInfo(top).meanSeconds));

  function itemLabels(ev) {
    const name = depthName(ev.top);
    const when = `${whenFull(fmt, ev.time)} ${fmt.tag(ev.time)}`;
    const finer = ev.finer > 0 ? `, ${ev.finer} finer cycle${ev.finer === 1 ? '' : 's'} end with it` : '';
    return {
      go: `Just after: ${name} turns over ${when}${finer}. Jump to 1 ms into the next cycle.`,
      pre: `Just before: jump to ${leadOf(ev.top)} before the ${name} turnover on ${when} and play in real time.`,
    };
  }

  function reconcile(list, animate) {
    const first = animate ? new Map([...rows].map(([k, r]) => [k, r.el.getBoundingClientRect().top])) : null;
    const wanted = new Set(list.map((e) => e.key));
    // a row that has just been used passes and is removed: keep keyboard focus in the list instead of dropping it to <body>
    const focused = listEl.contains(document.activeElement) ? (document.activeElement.classList.contains('upnext-pre') ? '.upnext-pre' : '.upnext-go') : null;
    for (const [k, r] of rows) {
      if (!wanted.has(k)) {
        r.el.remove();
        rows.delete(k);
      }
    }
    const fresh = [];
    list.forEach((ev, i) => {
      let r = rows.get(ev.key);
      if (!r) {
        r = makeItem(ev);
        rows.set(ev.key, r);
        fresh.push(r);
      }
      r.ev = ev;
      r.setDay(ev.day ?? '');
      r.setClock(ev.clock);
      r.setFin(ev.finer > 0 ? `+${ev.finer}` : '');
      r.setSep(ev.newDay);
      const labels = itemLabels(ev);
      r.go.setAttribute('aria-label', labels.go);
      r.pre.setAttribute('aria-label', labels.pre);
      const at = listEl.children[i];
      if (at !== r.el) listEl.insertBefore(r.el, at ?? null);
    });
    if (focused && !listEl.contains(document.activeElement)) listEl.querySelector(`.upnext-item ${focused}`)?.focus({ preventScroll: true });
    if (animate && !reducedMotion()) {
      for (const [k, r] of rows) {
        const y0 = first.get(k);
        if (y0 === undefined) continue;
        const dy = y0 - r.el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          r.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      }
      for (const r of fresh) r.el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' });
    }
  }

  function setHero(ev, frame, animate) {
    heroKey = ev.key;
    const info = model.levelInfo(ev.top);
    hero.style.cssText = levelVars(theme, ev.top);
    H.badgeL.textContent = info.letter;
    H.badgeD.textContent = String(info.depth);
    H.badge.setAttribute('aria-label', depthName(ev.top));
    H.badge.title = depthName(ev.top);
    const lead = leadOf(ev.top);
    const name = `${letterOf(ev.top)} ${ev.top + 1}`;
    const before = `Just before: jump to ${lead} before the ${name} turnover and watch it happen in real time`;
    const after = `Just after: jump to 1 ms into the next ${name} cycle, after the turnover`;
    for (const [btn, text] of [[heroBefore, before], [heroAfter, after]]) {
      btn.title = text;
      btn.setAttribute('aria-label', text);
    }
    H.when(whenFull(fmt, ev.time));
    H.zone(fmt.tag(ev.time));
    H.sentence(turnoverSentence(ev.top, maxLevel()));
    const cur = frame.level(ev.top);
    heroStart = cur ? cur.start : ev.time;
    heroEnd = ev.time;
    H.since(`since ${whenLabel(fmt, heroStart, frame.t, Math.max(1, heroEnd - heroStart))}`);
    H.prog.setAttribute('aria-label', `Progress through the current ${info.letter} ${info.depth} cycle`);
    if (animate && !reducedMotion()) {
      hero.animate(
        [
          { boxShadow: `0 0 0 3px ${theme.levelColor(ev.top, 0.55)}, 0 0 28px ${theme.levelColor(ev.top, 0.35)}` },
          { boxShadow: `0 0 0 0 ${theme.levelColor(ev.top, 0)}, 0 0 0 ${theme.levelColor(ev.top, 0)}` },
        ],
        { duration: 1100, easing: 'ease-out' },
      );
    }
  }

  // frame -----------------------------------------------------------------------------
  function recompute(frame, now) {
    const t = frame.t;
    const prevKeys = events.length ? events : [];
    const built = buildEvents(model, t, { importance, maxLevel: maxLevel(), count: COUNT });
    const grouped = groupByDay(built.slice(1), fmt, t);
    const fin = frame.level(importance.top);
    validFrom = fin ? fin.start : -Infinity;
    validUntil = built.length ? built[0].time : Infinity;
    stale = false;

    const steps = advancedBy(prevKeys, built);
    const animate = steps > 0 && steps <= 2 && now - lastPassAnim > 600;
    if (animate) lastPassAnim = now;
    events = built;

    if (!built.length) {
      heroKey = null;
      hero.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = `No further turnovers of this size before the catalogue ends (${fmt.date(model.tMax)}).`;
      reconcile([], false);
      return;
    }
    emptyEl.hidden = true;
    hero.hidden = false;
    if (built[0].key !== heroKey) setHero(built[0], frame, steps > 0 && animate);
    reconcile(grouped, animate);
  }

  function render(frame, info) {
    lastFrame = frame;
    // nothing moved since the last frame (paused clock, no setting changed): nothing to recompute or write
    if (info?.dirty === false && off !== null && !stale && !tip.visible) return;
    const t = frame.t;
    const now = performance.now();
    if (!frame.inRange) {
      if (off !== true) {
        events = [];
        reconcile([], false);
        heroKey = null;
        hero.hidden = true;
        strip.hidden = true;
        listEl.hidden = true;
        emptyEl.hidden = false;
        emptyEl.textContent = `Outside the Saros 141 catalogue (${fmt.date(model.tMin)} to ${fmt.date(model.tMax)}): there are no turnovers to count down to.`;
        off = true;
        stale = true;
      }
      return;
    }
    if (off !== false) {
      off = false;
      strip.hidden = false;
      listEl.hidden = false;
      stale = true;
    }

    const s = `${importance.id}|${fmt.zone()}|${store.state.maxDepth}`;
    if (s !== sig) {
      sig = s;
      heroKey = null;
      for (const r of rows.values()) r.el.remove();
      rows.clear();
      events = [];
      recompute(frame, now);
    } else if (stale || isStale(t, validFrom, validUntil)) {
      // every frame when turnovers pass faster than that (a time-lapse of a month per second): the list is
      // exact model data and costs ~0.1 ms, whereas a throttled one shows turnovers that already happened
      recompute(frame, now);
    }
    // live text ---------------------------------------------------------------
    if (events.length) {
      const ev = events[0];
      const text = countdownLong(fmt, ev.time - t);
      H.count(text);
      const size = text.length > 17 ? 2 : text.length > 15 ? 1 : 0; // long strings step the type size down
      if (size !== H.size) {
        H.size = size;
        H.countBox.dataset.size = String(size);
      }
      const span = heroEnd - heroStart;
      const p = span > 0 ? Math.min(1, Math.max(0, (t - heroStart) / span)) : 0;
      const pq = quantize(p, 1000);
      if (pq !== H.p) {
        H.progFill.style.transform = `scaleX(${pq})`;
        H.p = pq;
      }
      H.pct(`${pctWhole(p)}\u202f% of this cycle`);
      H.now(String(pctWhole(p)));
      for (const r of rows.values()) r.setIn(countdownText(fmt, r.ev.time - t));
    }

    // next quarter threshold of the selected level --------------------------------
    const sel = normLevel(store.state.selectedLevel);
    const lv = frame.level(sel);
    if (sel !== S.sel) {
      S.sel = sel;
      const info = model.levelInfo(sel);
      strip.style.cssText = levelVars(theme, sel);
      S.chipL.textContent = info.letter;
      S.chipD.textContent = String(info.depth);
      S.chip.setAttribute('aria-label', depthName(sel));
    }
    if (lv && lv.next.time != null) {
      S.none(false);
      S.q(QN[lv.quarter]);
      S.inEl(`in ${countdownText(fmt, lv.next.time - t)}`);
      S.clock(whenLabel(fmt, lv.next.time, t, lv.duration));
      S.off(false);
      S.title(`Just after: jump to 1 ms past the next ${QN[lv.quarter]} of ${letterOf(sel)} ${sel + 1}`);
    } else {
      S.none(true);
      S.q('');
      S.inEl('No further threshold before the catalogue ends');
      S.clock('');
      S.off(true);
      S.title('No further quarter threshold before the catalogue ends');
    }

    if (tip.visible && hoverKey) {
      const r = rows.get(hoverKey);
      if (r) tip.setHtml(tipHtml(r.ev, t));
      else hideTip(); // the turnover under the pointer has passed
    }
  }

  // tooltip for list rows ------------------------------------------------------------
  let hoverKey = null;
  function tipHtml(ev, t) {
    const info = model.levelInfo(ev.top);
    const color = theme.levelColor(ev.top);
    return `<div class="upnext-tip-h"><b style="color:${color}">${esc(info.letter)} ${info.depth}</b><span class="upnext-tip-d dim">depth ${info.depth}</span><span>${esc(countdownLong(fmt, ev.time - t))}</span></div>
      <div><b>${esc(whenFull(fmt, ev.time))}</b> <span class="dim">${esc(fmt.tag(ev.time))}</span></div>
      <div class="dim">${esc(turnoverSentence(ev.top, maxLevel()))}</div>
      <div class="upnext-tip-hint dim">Click: Just after · arrow button: Just before (${leadOf(ev.top)} ahead, then real time)</div>`;
  }
  listEl.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const li = e.target.closest('.upnext-item');
    if (!li) return;
    const row = [...rows.values()].find((r) => r.el === li);
    if (!row || hoverKey === row.key) return;
    hoverKey = row.key;
    tip.show(tipHtml(row.ev, lastFrame?.t ?? store.t()), li.getBoundingClientRect());
  });
  const hideTip = () => {
    hoverKey = null;
    tip.hide();
  };
  listEl.addEventListener('pointerleave', hideTip);
  const onScroll = () => hoverKey && hideTip();
  window.addEventListener('scroll', onScroll, { passive: true });

  function destroy() {
    offTime();
    window.removeEventListener('scroll', onScroll);
    tip.destroy();
    el.classList.remove('upnext');
    el.replaceChildren();
  }

  return {
    alwaysOn: true,
    render,
    destroy,
    /** Current event list (hero first). */
    get events() {
      return events.map((e) => ({ ...e }));
    },
    get importance() {
      return importance.id;
    },
    setImportance(id) {
      importance = importanceById(id);
      writePref(importance.id);
      syncImportance();
      stale = true;
      ctx.requestRender();
    },
  };
}
