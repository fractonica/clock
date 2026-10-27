/**
 * The two-way converter (left half of the Calendar tab).
 *
 * One instant T is the single source of truth. Editing any field on either side
 * (Gregorian date / time / Unix / ISO, Saros position, cycle address, solar sync) parses it,
 * pins the converter on the result and repaints every other field. Unpinned, T follows the
 * displayed time (a live readout). "Apply" navigates the whole app to T.
 *
 * Pure maths lives in ./convert.js and ./parse.js; this file is DOM only.
 */
import { createFormatter } from '../../core/format.js';
import { h, ICONS, esc, setText, setHtml, setStyle, setAttr, toggleClass, copyText, prefersReducedMotion, hasSound, hearMoment } from './dom.js';
import { levelColor } from '../../core/theme.js';
import { pentadMarkHTML, leadHTML, leadText, pentadLookup, PENTAD_NAMES } from '../pentad.js';
import { syncPentads } from './pentads.js';
import {
  LETTERS,
  LEVEL_NAMES,
  MAX_DEPTH,
  POINTS,
  catalogueRangeText,
  chainText,
  childCount,
  cycleLabel,
  cycleOfPath,
  eclipseContext,
  gregorianInfo,
  isoWithMs,
  landOn,
  levelRows,
  localToUnix,
  nominalCount,
  normalizePath,
  pathOfTime,
  pathText,
  pctFloor,
  pointTime,
  positionInfo,
  r3,
  safeSolarAt,
  shareQuery,
  solarInfo,
  spanLabel,
  stateMeaning,
  stateTimes,
  syncRange,
  timeOfPositionParts,
  timeOfPositionText,
  rangeProblem,
  wallTimeNote,
} from './convert.js';
import { parseDateText, parseGregorian, parseTimeText } from './parse.js';

const MIN_T = -30610224000; // 1000-01-01
const MAX_T = 253402300799; // 9999-12-31
const FOLLOW_MS = 100; // repaint interval while following a moving clock

export function createConverter(ctx, { tip }) {
  const { model, store } = ctx;
  const S = {
    pinned: false,
    T: r3(store.t()),
    zoneMode: 'app', // 'app' | 'utc' | IANA name
    depth: clampDepth(store.state.topDepth + 1),
    depthTouched: false,
    point: 'begin',
    addr: { fromEdit: false, path: [], phaseRef: 0 },
    sync: { fromEdit: false, n: null },
    pick: { level: null, index: null },
    dirty: true,
    force: true,
    lastPaint: 0,
    lastZone: '',
    active: true,
  };
  function clampDepth(d) {
    return Math.max(1, Math.min(MAX_DEPTH, Math.round(d) || 6));
  }
  const zoneName = () => (S.zoneMode === 'app' ? ctx.fmt.zone() : S.zoneMode === 'utc' ? 'UTC' : S.zoneMode);
  const cf = createFormatter(zoneName);

  // ------------------------------------------------------------------------------------------
  // small builders
  // ------------------------------------------------------------------------------------------
  let nextId = 0;
  const uid = (p) => `cal-${p}-${++nextId}`;

  function flash(btn) {
    // the original icon is remembered once: a second click within the flash must not capture the check mark
    btn.__orig ??= btn.innerHTML;
    clearTimeout(btn.__flash);
    btn.classList.add('is-done');
    btn.innerHTML = ICONS.check;
    btn.__flash = setTimeout(() => {
      btn.classList.remove('is-done');
      btn.innerHTML = btn.__orig;
    }, 900);
  }
  function copyButton(getText, what) {
    const b = h('button.cal-copy', { type: 'button', title: `Copy ${what}`, 'aria-label': `Copy ${what}`, html: ICONS.copy });
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = getText();
      if (text === '' || text === null || text === undefined) return;
      const ok = await copyText(text);
      if (ok) flash(b);
      ctx.toast(ok ? `Copied ${what}` : 'Copy is not available in this browser');
    });
    return b;
  }
  function goButton(getTime, what, level) {
    const b = h('button.cal-go', { type: 'button', title: `Go there: ${what}`, 'aria-label': `Go to ${what}`, html: ICONS.go });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = getTime();
      if (t === null || t === undefined || !Number.isFinite(t)) return;
      if (!model.inRange(r3(t))) return ctx.toast(`Outside the catalogue (${catalogueRangeText(model)})`);
      ctx.goto(landOn(model, t, level));
    });
    return b;
  }

  /** Labelled text input with live parsing, inline error and a copy button. */
  function field({ label, mono = true, placeholder = '', inputmode, copy, parse, apply, onKey, narrow = false, hint, long = false }) {
    const id = uid('f');
    const input = h('input.input.cal-in' + (mono ? '.mono' : ''), {
      type: 'text',
      id,
      inputmode,
      placeholder,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-label': label,
    });
    const err = h('div.cal-err', { role: 'alert', hidden: true });
    const copyBtn = copy ? copyButton(copy, label.toLowerCase()) : null;
    const wrap = h(
      'div.cal-field' + (narrow ? '.is-narrow' : '') + (long ? '.is-long' : ''),
      null,
      h('label.cal-lab', { for: id, text: label }),
      h('div.cal-inwrap', null, input, copyBtn),
      hint ? h('div.cal-hint', { text: hint }) : null,
      err,
    );
    let timer = 0;
    let shown = '';
    // true only while the text differs from what the person typed last: blurring an untouched field
    // (the model keeps ticking underneath it) must never re-parse stale text and pin the converter
    let dirty = false;
    const showErr = (m) => {
      err.textContent = m || '';
      err.hidden = !m;
      input.classList.toggle('is-bad', !!m);
      setAttr(input, 'aria-invalid', m ? 'true' : null);
    };
    function commit(final) {
      clearTimeout(timer);
      // an emptied field is "not finished yet", never the value 0
      if (input.value.trim() === '' && !final) {
        showErr('');
        return false;
      }
      const r = parse(input.value);
      let msg;
      if (r && !r.error) {
        const ok = apply(r, final);
        if (ok !== false) {
          dirty = false;
          showErr('');
          return true;
        }
        msg = S.rejected || 'Out of range';
      } else msg = r?.error || 'Not understood';
      if (final) showErr(msg);
      else timer = setTimeout(() => showErr(msg), 650);
      return false;
    }
    input.addEventListener('input', () => {
      dirty = true;
      commit(false);
    });
    input.addEventListener('blur', () => {
      clearTimeout(timer);
      if (dirty && input.value.trim() !== '') commit(true);
      else if (input.value !== shown || input.value.trim() === '') {
        // untouched, or emptied and abandoned: show the model's value again
        dirty = false;
        input.value = shown;
        showErr('');
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(true);
      } else if (e.key === 'Escape') {
        clearTimeout(timer);
        dirty = false;
        input.value = shown;
        showErr('');
      } else if (onKey) onKey(e);
    });
    return {
      el: wrap,
      input,
      /** model -> field (skipped while the person is typing in it) */
      set(v, force = false) {
        shown = v;
        if (document.activeElement === input && !force) return;
        if (input.value !== v) input.value = v;
        dirty = false;
        if (err.hidden === false) showErr('');
      },
      error: showErr,
    };
  }

  function section(title, tools, ...children) {
    return h('section.cal-sec', null, h('div.cal-sh', null, h('h4', { text: title }), tools), ...children);
  }

  // ------------------------------------------------------------------------------------------
  // edits: everything funnels through setT()
  // ------------------------------------------------------------------------------------------
  const YEARS_ONLY = 'Years 1000 to 9999 only';
  function setT(t, from) {
    S.rejected = '';
    S.wall = null; // (a note explains the instant it was raised for; callers that have one set it again)
    if (!Number.isFinite(t)) {
      S.rejected = 'Not a valid time';
      return false;
    }
    if (t < MIN_T || t > MAX_T) {
      S.rejected = YEARS_ONLY; // the field shows it inline; keyboard nudges toast it
      return false;
    }
    S.T = r3(t);
    S.pinned = true;
    if (from !== 'addr') S.addr.fromEdit = false;
    if (from !== 'sync') S.sync.fromEdit = false;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
    return true;
  }

  // ---- Gregorian fields
  const fZone = h('select.select.cal-zone', { 'aria-label': 'Zone for this converter' });
  fillZones();
  fZone.addEventListener('change', () => {
    S.zoneMode = fZone.value;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
  });
  const swapBtn = h('button.btn.btn-sm.cal-swap', { type: 'button', html: ICONS.swap + '<span>UTC ⇄ app</span>', title: 'Switch between UTC and the app zone' });
  swapBtn.addEventListener('click', () => {
    S.zoneMode = S.zoneMode === 'utc' ? 'app' : 'utc';
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
  });
  function fillZones() {
    let zones = [];
    try {
      zones = Intl.supportedValuesOf('timeZone');
    } catch {
      zones = [];
    }
    fZone.innerHTML =
      `<option value="app">App zone</option><option value="utc">UTC</option>` +
      zones.filter((z) => z !== 'UTC').map((z) => `<option value="${esc(z)}">${esc(z.replace(/_/g, ' '))}</option>`).join('');
  }

  const parts0 = () => cf.parts(S.T);
  /** local fields of the converter's zone -> instant (a skipped local time moves ahead, a repeated one is the first) */
  const toUnix = (fields) => localToUnix(fields, zoneName());
  /**
   * A wall time the zone does not have exactly once (a clock change skipped it, or repeats it) is moved ahead / read as
   * the first, as the jump box does. Say so under the fields (same sentence as the jump box) and rewrite the fields to
   * the time that was really converted, instead of leaving "02:30" next to a result of 03:30.
   */
  function noteWall(fields, final = true) {
    const zone = zoneName();
    const note = wallTimeNote(fields, zone, S.T, cf, 'in ' + zone.replace(/_/g, ' '));
    S.wall = note ? { note, T: S.T, zone } : null;
    // the fields are rewritten once the person is done (Enter, blur, an arrow key), not under their fingers while typing
    if (note && final) S.forceFields = true;
  }
  function setLocal(fields, from, final = true) {
    const ok = setT(toUnix(fields), from);
    if (ok) noteWall(fields, final);
    return ok;
  }
  const fDate = field({
    label: 'Date',
    placeholder: 'YYYY-MM-DD',
    inputmode: 'numeric',
    copy: () => cf.date(S.T),
    parse: (txt) => {
      const r = parseDateText(txt);
      return r.error ? r : { ok: true, r };
    },
    apply: ({ r }, final) => {
      const p = r.time ?? parts0();
      return setLocal({ year: r.year, month: r.month, day: r.day, hour: p.hour, minute: p.minute, second: p.second, ms: p.ms }, 'date', final);
    },
    onKey: (e) => stepKeys(e, { ArrowUp: ['d', 1], ArrowDown: ['d', -1], PageUp: ['M', 1], PageDown: ['M', -1] }),
  });
  const fTime = field({
    label: 'Time (HH:MM:SS.mmm)',
    placeholder: 'HH:MM:SS.mmm',
    inputmode: 'numeric',
    copy: () => cf.time(S.T, { seconds: true, ms: true }),
    parse: (txt) => {
      const r = parseTimeText(txt);
      return r.error ? r : { ok: true, r };
    },
    apply: ({ r }, final) => {
      const p = parts0();
      return setLocal({ year: p.year, month: p.month, day: p.day, hour: r.hour, minute: r.minute, second: r.second, ms: r.ms }, 'time', final);
    },
    onKey: (e) => stepKeys(e, { ArrowUp: ['m', 1], ArrowDown: ['m', -1], PageUp: ['h', 1], PageDown: ['h', -1] }),
  });
  /** Arrow / Page keys nudge the instant by a calendar unit. */
  function stepKeys(e, map) {
    const hit = map[e.key];
    if (!hit || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const [unit, dir] = hit;
    const p = parts0();
    let { year, month, day, hour, minute } = p;
    const big = e.shiftKey ? (unit === 'd' ? 'M' : unit === 'M' ? 'y' : unit === 'm' ? 'h' : 'd') : unit;
    if (big === 'y') year += dir;
    else if (big === 'M') month += dir;
    else if (big === 'd') day += dir;
    else if (big === 'h') hour += dir;
    else if (big === 'm') minute += dir;
    if (big === 'M' || big === 'y') day = Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate());
    S.forceFields = true;
    if (!setLocal({ year, month, day, hour, minute, second: p.second, ms: p.ms }, 'step')) ctx.toast(S.rejected);
  }
  const fUnix = field({
    label: 'Unix seconds',
    placeholder: '1791460800.000',
    inputmode: 'decimal',
    copy: () => r3(S.T).toFixed(3),
    parse: (txt) => {
      const v = Number(String(txt).trim().replace(',', '.'));
      if (!String(txt).trim() || !Number.isFinite(v)) return { error: 'Type Unix seconds, e.g. 1791460800.000' };
      return { ok: true, v };
    },
    apply: ({ v }) => setT(v, 'unix'),
  });
  const fIso = field({
    label: 'ISO 8601',
    long: true,
    placeholder: '2026-10-08T12:00:00.000+00:00',
    copy: () => gregorianInfo(cf, S.T).iso,
    parse: (txt) => {
      const r = parseGregorian(txt, { zone: zoneName() });
      if (!r) return { error: 'Write an ISO string like 2026-10-08T12:00:00+03:00' };
      if (r.error) return r;
      return { ok: true, t: r.results[0].t, x: r.results[0] };
    },
    apply: ({ t, x }, final) => {
      const ok = setT(t, 'iso');
      // without an offset the text is a wall time of the converter's zone, which may not exist or happen twice
      if (ok && x.offset === null && x.hasTime) noteWall(x.fields, final);
      return ok;
    },
  });

  const wallNote = h('div.cal-note', { role: 'status', hidden: true });
  const gregMeta = h('div.cal-meta');
  const ctxBox = h('div.cal-eclipses');

  // ---- position
  const fOrd = field({
    label: 'Eclipse ordinal',
    placeholder: '–',
    inputmode: 'numeric',
    narrow: true,
    copy: () => String(positionInfo(model, S.T)?.k ?? ''),
    parse: (txt) => {
      const frac = fFrac.input.value;
      const r = timeOfPositionParts(model, txt.trim(), frac.trim());
      return r.error ? r : { ok: true, t: r.t };
    },
    apply: ({ t }) => setT(t, 'pos'),
  });
  const fFrac = field({
    label: 'Fraction',
    placeholder: '–',
    inputmode: 'decimal',
    copy: () => positionInfo(model, S.T)?.fraction ?? '',
    parse: (txt) => {
      if (txt.trim() === '') return { error: 'Type the fraction, e.g. 0.9278' };
      const r = timeOfPositionParts(model, fOrd.input.value.trim(), txt.trim());
      return r.error ? r : { ok: true, t: r.t };
    },
    apply: ({ t }) => setT(t, 'pos'),
  });
  const fExact = field({
    label: 'Exact position (Saros units)',
    placeholder: '–',
    inputmode: 'decimal',
    copy: () => positionInfo(model, S.T)?.exact ?? '',
    parse: (txt) => {
      const r = timeOfPositionText(model, txt);
      return r.error ? r : { ok: true, t: r.t };
    },
    apply: ({ t }) => setT(t, 'pos'),
  });
  const posNote = h('div.cal-meta');
  const posChip = h('span.chip.cal-chip');
  const posOfChip = h('span.chip.cal-chip');
  posNote.append(posChip, posOfChip);

  // ---- address
  const depthBar = h('div.cal-depths', { role: 'group', 'aria-label': 'Address depth' });
  const depthBtns = [];
  for (let d = 1; d <= MAX_DEPTH; d++) {
    const b = h('button.cal-dchip', {
      type: 'button',
      'aria-pressed': 'false',
      title: `Depth ${d} · ${LEVEL_NAMES[d - 1]} · a cycle lasts about ${ctx.fmt.duration(model.levelInfo(d - 1).meanSeconds)}`,
      'aria-label': `Depth ${d}, ${LEVEL_NAMES[d - 1]} ${LETTERS[d - 1]}`,
      style: `--lv:${levelColor(d - 1)}`,
    });
    b.append(h('span.cal-dl', { text: LETTERS[d - 1] }), h('span.cal-dn', { text: String(d) }));
    b.addEventListener('click', () => {
      S.depth = d;
      S.depthTouched = true;
      S.addr.fromEdit = false;
      const l = model.levelAt(S.T, d - 1);
      if (l) {
        S.addr.phaseRef = l.phase;
        S.addr.path = pathOfTime(model, S.T, d) ?? [];
      }
      S.dirty = true;
      S.force = true;
      ctx.requestRender();
    });
    depthBtns.push(b);
    depthBar.append(b);
  }
  const chainBox = h('div.cal-chain');
  const steppers = [];
  for (let L = 0; L < MAX_DEPTH; L++) steppers.push(makeStepper(L));
  steppers.forEach((s) => chainBox.append(s.el));

  function makeStepper(L) {
    const input = h('input.cal-sv.mono', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${LEVEL_NAMES[L]} number`, size: 3 });
    const dec = h('button.cal-sb', { type: 'button', html: '−', title: `Previous ${LEVEL_NAMES[L]}`, 'aria-label': `Previous ${LEVEL_NAMES[L]}` });
    const inc = h('button.cal-sb', { type: 'button', html: '+', title: `Next ${LEVEL_NAMES[L]}`, 'aria-label': `Next ${LEVEL_NAMES[L]}` });
    // "/ 5" is the nominal count every other view prints ("2 / 5"); the note appears where the catalogue ends sooner
    const ofTxt = h('span.cal-sn');
    const ofNote = h('span.cal-snote', { hidden: true });
    const of = h('span.cal-so', null, ofTxt, ofNote);
    const err = h('div.cal-serr', { role: 'alert', hidden: true });
    const el = h(
      'div.cal-step',
      { style: `--lv:${levelColor(L)}`, hidden: true },
      h('span.cal-sl', { text: LETTERS[L], title: LEVEL_NAMES[L] }),
      h('div.cal-sbox', null, dec, input, inc),
      of,
      err,
    );
    const api = { el, input, of, ofTxt, ofNote, err, L, max: 1, nominal: 1, value: 1, shown: '' };
    const msg = (m) => {
      err.textContent = m || '';
      err.hidden = !m;
      input.classList.toggle('is-bad', !!m);
    };
    api.msg = msg;
    const nudge = (dir) => {
      msg('');
      stepLevel(L, dir);
    };
    dec.addEventListener('click', () => nudge(-1));
    inc.addEventListener('click', () => nudge(1));
    const commit = (final) => {
      const txt = input.value.trim();
      if (txt === '') return;
      const n = Number(txt);
      if (!Number.isInteger(n) || n < 1) return final && msg('Whole number from 1');
      if (n > api.max) {
        if (final || String(n).length >= String(api.max).length) {
          const sooner = api.max < api.nominal ? `, the catalogue ends after ${cycleLabel(L, api.max)}` : '';
          msg(L === 0 ? `Only ${api.max} Alpha cycles exist in the catalogue` : `${LEVEL_NAMES[L]} has only ${api.max} cycles here (${cycleLabel(L, 1)} … ${cycleLabel(L, api.max)}${sooner})`);
        }
        return;
      }
      msg('');
      if (n !== api.value) setPathEntry(L, n);
    };
    input.addEventListener('input', () => commit(false));
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        nudge(e.key === 'ArrowUp' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit(true);
      } else if (e.key === 'Escape') {
        input.value = String(api.value);
        msg('');
      }
    });
    return api;
  }

  /** Current path shown by the steppers (from T unless the person is editing the address). */
  function currentPath() {
    return S.addr.path.slice(0, S.depth);
  }
  function applyPath(path, from = 'addr') {
    const norm = normalizePath(model, path);
    if (norm.length !== path.length) return;
    const t0 = pointTime(model, norm, S.point, S.addr.phaseRef);
    if (t0 === null) {
      // beyond the catalogue (clipped last cycle): keep the address, the result line explains
      S.addr.path = norm;
      S.addr.fromEdit = true;
      S.dirty = true;
      S.force = true;
      ctx.requestRender();
      return;
    }
    const level = norm.length - 1;
    const t = S.point === 'begin' ? landOn(model, t0, level) : landOn(model, t0);
    S.addr.path = norm;
    setT(t, from);
    S.addr.fromEdit = true;
  }
  function setPathEntry(L, n) {
    const p = currentPath();
    p[L] = n;
    applyPath(p);
  }
  /** ± one cycle at level L with carry into the parent (odometer style). */
  function stepLevel(L, dir) {
    const p = currentPath();
    const idx = model.pathToCycle(p.slice(0, L + 1));
    if (idx === null) return;
    const next = idx + BigInt(dir);
    if (next < 0n || next >= model.clock.count(L)) {
      ctx.toast(dir > 0 ? 'End of the catalogue' : 'Start of the catalogue');
      return;
    }
    const np = model.cycleToPath(L, next);
    applyPath([...np, ...p.slice(L + 1)]);
  }

  const pointSel = h('select.select.cal-point', { 'aria-label': 'Point in the cycle' });
  for (const p of POINTS) pointSel.append(h('option', { value: p.id, text: p.label }));
  pointSel.addEventListener('change', () => {
    S.point = pointSel.value;
    const p = currentPath();
    if (p.length) applyPath(p);
  });
  const addrNote = h('div.cal-err', { role: 'alert', hidden: true });
  const addrResult = h('div.cal-result');
  let addrTimeNow = null;
  let addrTextNow = '';
  const addrCopy = copyButton(() => addrTextNow, 'cycle address');
  const addrGo = goButton(() => addrTimeNow, 'the addressed point');

  // ---- glyph states
  const glyphGrid = h('div.cal-glyphs', { role: 'group', 'aria-label': 'Glyph state at every depth' });
  const glyphCells = [];
  for (let L = 0; L < MAX_DEPTH; L++) {
    const svgBox = h('span.cal-gsvg', { 'aria-hidden': 'true' });
    const nm = h('span.cal-gname');
    const st = h('span.cal-gstate.mono');
    const mean = h('span.cal-gmean');
    const bar = h('span.cal-gbar', { 'aria-hidden': 'true' }, h('i'));
    const b = h(
      'button.cal-gcell',
      { type: 'button', style: `--lv:${levelColor(L)}`, 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      svgBox,
      h('span.cal-gtxt', null, nm, st, mean),
      bar,
    );
    b.addEventListener('click', () => {
      ctx.select(L);
      openPicker(L);
    });
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') showGlyphTip(L, e.clientX, e.clientY);
    });
    b.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' && !tip.el.hidden) showGlyphTip(L, e.clientX, e.clientY);
    });
    b.addEventListener('pointerleave', () => tip.hideSoon());
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible')) {
        const r = b.getBoundingClientRect();
        showGlyphTip(L, r.left + r.width * 0.5, r.top + r.height * 0.5);
      }
    });
    b.addEventListener('blur', () => tip.hide());
    glyphGrid.append(b);
    glyphCells.push({ el: b, svgBox, nm, st, mean, bar: bar.firstChild, sig: '' });
  }
  let lastRows = null;
  function showGlyphTip(L, x, y) {
    const r = lastRows?.[L];
    if (!r) return;
    const m = stateMeaning(model, r.index);
    const od = model.odometerAt(S.T, L, { strokes: 2, digits: 1 });
    const od2 = model.odometerAt(S.T, L, { strokes: 2, digits: 2 });
    const trits = (r.trits ?? []).map((t) => (t > 0 ? '+' : t < 0 ? '−' : '0')).join(' ');
    const col = levelColor(L);
    const next = od?.nextTime ?? null;
    let html =
      `<div class="cal-tt-h" style="color:${col}">${LETTERS[L]} · depth ${L + 1}<span class="dim"> ${LEVEL_NAMES[L]}</span></div>` +
      `<div>State <b>${r.index}</b> of ${r.states} · ${esc(m.text)} ${m.arrow}${r.dotted ? ' <span class="dim">(dot = falling branch)</span>' : ''}</div>` +
      `<div class="dim">${pctFloor(r.phase, 2)} % through ${cycleLabel(L, r.local)} · ${r.local} / ${r.siblings}${L ? ' in ' + cycleLabel(L - 1, lastRows[L - 1]?.local ?? '') : ''}</div>` +
      `<dl class="cal-tt-dl"><dt>cycle</dt><dd>${esc(spanLabel(cf, r.start, S.T, r.start, r.end))} → ${esc(spanLabel(cf, r.end, S.T, r.start, r.end))} (${esc(cf.duration(r.duration))})</dd>`;
    html += `<dt>trits</dt><dd class="mono">${esc(trits)} <span class="dim">(msb first)</span></dd>`;
    if (od2) html += `<dt>odometer</dt><dd class="mono">[${od2.digits.join(', ')}] <span class="dim">coarse, sub glyph</span></dd>`;
    if (next) html += `<dt>glyph changes</dt><dd>${esc(cf.label(next, S.T))} · ${esc(cf.countdown(next - S.T))}</dd>`;
    html += `<dt>next ${esc(r.next.name)}</dt><dd>${r.next.time ? esc(cf.label(r.next.time, S.T)) : '–'}</dd></dl>`;
    html += '<div class="dim cal-tt-hint">Click to see when depth ' + (L + 1) + ' shows any other state.</div>';
    tip.show(html, x, y);
  }
  // The picker is built once (16 state buttons, a result block) and only repainted: rebuilding it would
  // drop the keyboard focus and swallow clicks that straddle a repaint while the clock runs.
  const pickTitle = h('b');
  const pickClose = h('button.cal-pick-x', { type: 'button', 'aria-label': 'Close the state list', title: 'Close (Esc)', html: ICONS.close });
  const pickStates = [];
  const pickGrid = h('div.cal-states', { role: 'group', 'aria-label': 'Glyph states, pick one' });
  for (let i = 0; i < 16; i++) {
    const m = stateMeaning(model, i);
    const b = h('button.cal-state', {
      type: 'button',
      'data-i': String(i),
      'aria-pressed': 'false',
      'aria-label': `State ${i}: ${m.text}`,
      html: model.glyphSVG(i, { strokes: 2, color: 'currentColor', scale: 3.2, padding: 0.25 }) + `<span class="mono">${i}</span>`,
    });
    pickStates.push({ b, m });
    pickGrid.append(b);
  }
  const pickRes = h('div.cal-pick-res');
  const picker = h(
    'div.cal-picker',
    { hidden: true, role: 'group', 'aria-label': 'When a glyph state shows' },
    h('div.cal-pick-h', null, pickTitle, h('span.dim', { text: 'choose a state, then see when it shows' }), pickClose),
    pickGrid,
    pickRes,
  );
  function openPicker(L, index) {
    if (S.pick.level === L && index === undefined && !picker.hidden) {
      S.pick = { level: null, index: null };
      S.force = true;
      return ctx.requestRender();
    }
    S.pick = { level: L, index: index ?? null };
    S.pinned = true;
    S.force = true;
    ctx.requestRender();
    if (index === undefined) requestAnimationFrame(() => picker.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  }
  function closePicker() {
    const L = S.pick.level;
    S.pick = { level: null, index: null };
    S.force = true;
    ctx.requestRender();
    if (L !== null) glyphCells[L]?.el.focus({ preventScroll: true }); // keyboard users land where they came from
  }

  // ---- solar sync
  const syncInput = h('input.cal-sv.mono', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Solar sync number', size: 6, placeholder: '–' });
  const syncDec = h('button.cal-sb', { type: 'button', html: '−', title: 'Previous sync', 'aria-label': 'Previous sync' });
  const syncInc = h('button.cal-sb', { type: 'button', html: '+', title: 'Next sync', 'aria-label': 'Next sync' });
  const syncErr = h('div.cal-err', { role: 'alert', hidden: true });
  const syncBody = h('div.cal-syncbody');
  let syncShown = null; // the sync number on show; null in the half-sync at a catalogue edge
  let syncRefs = null;
  function syncMsg(m) {
    syncErr.textContent = m || '';
    syncErr.hidden = !m;
    syncInput.classList.toggle('is-bad', !!m);
    S.syncErrFor = m ? S.T : undefined; // an error belongs to the instant it was raised at
  }
  function gotoSync(n) {
    const info = solarInfo(model, cf, n);
    if (!info) {
      const r = syncRange(model);
      syncMsg(`Sync ${n} is not entirely inside the catalogue (syncs ${r.first} … ${r.last})`);
      return;
    }
    syncMsg('');
    S.sync = { fromEdit: true, n };
    setT(landOn(model, info.start, 6), 'sync');
    S.sync = { fromEdit: true, n };
  }
  let syncDirty = false; // typed into since the last sync was shown (an untouched box must not re-parse stale text)
  /** The box text as a sync number: {n} or {error}. 309+ digits are Infinity to Number(), which the library cannot take. */
  function parseSyncText(txt) {
    const t = txt.trim();
    if (!/^-?\d+$/.test(t)) return { error: 'Type a whole number, e.g. 4820' };
    const n = Number(t);
    if (!Number.isSafeInteger(n)) {
      const r = syncRange(model);
      return { error: `Too large: the catalogue holds syncs ${r.first} … ${r.last}` };
    }
    return { n };
  }
  syncInput.addEventListener('input', () => {
    syncDirty = true;
    const p = parseSyncText(syncInput.value);
    // a number nothing can reach is flagged at once; a half-typed "-" or "" is not an error yet, and an older message is stale
    syncMsg(p.error && /Too large/.test(p.error) ? p.error : '');
    if (!p.error && solarInfo(model, cf, p.n)) gotoSync(p.n);
  });
  syncInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const p = parseSyncText(syncInput.value);
      if (p.error) syncMsg(p.error);
      else gotoSync(p.n);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepSync(e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === 'Escape') {
      syncInput.value = syncShown === null ? '' : String(syncShown);
      syncMsg('');
    }
  });
  syncInput.addEventListener('blur', () => {
    const p = parseSyncText(syncInput.value);
    if (syncDirty && syncInput.value.trim() !== '' && p.n !== syncShown) {
      if (p.error) syncMsg(p.error);
      else gotoSync(p.n);
    } else {
      syncInput.value = syncShown === null ? '' : String(syncShown);
      syncMsg('');
    }
    syncDirty = false;
  });
  /** ± one sync; there is no "current" sync in the half-sync at a catalogue edge */
  function stepSync(dir) {
    const cur = S.sync.n ?? syncShown;
    if (cur !== null && cur !== undefined) gotoSync(cur + dir);
  }
  syncDec.addEventListener('click', () => stepSync(-1));
  syncInc.addEventListener('click', () => stepSync(1));

  // ---- header controls
  const status = h('span.cal-status');
  const pinBtn = h('button.btn.btn-sm.cal-pin', { type: 'button', 'aria-pressed': 'false', html: ICONS.pin + '<span>Pin</span>', title: 'Freeze the converter on this instant so it can be studied' });
  pinBtn.addEventListener('click', () => {
    S.pinned = !S.pinned;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
  });
  const useBtn = h('button.btn.btn-sm', { type: 'button', html: ICONS.refresh + '<span>Use displayed time</span>', title: 'Load the displayed time into the converter' });
  useBtn.addEventListener('click', () => {
    S.T = r3(store.t());
    S.addr.fromEdit = false;
    S.sync.fromEdit = false;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
  });
  const applyBtn = h('button.btn.btn-sm.cal-apply', { type: 'button', html: ICONS.target + '<span>Apply</span>', title: 'Navigate the whole app to this instant' });
  applyBtn.addEventListener('click', () => {
    if (!model.inRange(S.T)) return ctx.toast(`Outside the catalogue (${catalogueRangeText(model)})`);
    ctx.goto(S.T);
    S.pinned = false;
    S.addr.fromEdit = false;
    S.sync.fromEdit = false;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
    ctx.toast('Applied: the app now shows ' + cf.long(S.T));
  });
  const linkBtn = h('button.btn.btn-sm.btn-icon', { type: 'button', html: ICONS.link, title: 'Copy a link to this instant', 'aria-label': 'Copy a link to this instant' });
  linkBtn.addEventListener('click', async () => {
    const u = new URL(location.href);
    u.search = shareQuery(S.T, { view: 'calendar', zone: ctx.store.state.zone });
    u.hash = '';
    const ok = await copyText(u.toString());
    ctx.toast(ok ? 'Link to this instant copied' : u.toString());
  });

  const hearBtn = h('button.btn.btn-sm.btn-icon.cal-hear', { type: 'button', html: ICONS.sound, title: 'Hear this moment: a short chord of its cycles', 'aria-label': 'Hear this moment', hidden: true });
  hearBtn.addEventListener('click', () => hearMoment(ctx, S.T));

  const oor = h('div.cal-oor', { hidden: true });
  const oorText = h('span');
  const oorBtn = h('button.btn.btn-sm', { type: 'button' });
  oorBtn.addEventListener('click', () => setT(oorBtn.__edge, 'edge'));
  oor.append(oorText, oorBtn);

  // ------------------------------------------------------------------------------------------
  // layout
  // ------------------------------------------------------------------------------------------
  const gregPanel = h(
    'div.cal-panel.cal-greg',
    null,
    h('h3.cal-ph', null, h('span', { text: 'Gregorian' }), h('span.cal-ph-sub', { text: 'civil time' })),
    h('div.cal-zonebar', null, fZone, swapBtn),
    h('div.cal-two', null, fDate.el, fTime.el),
    wallNote,
    gregMeta,
    fUnix.el,
    fIso.el,
    section('Saros 141 around this instant', null, ctxBox),
  );
  let syncCopyText = '';
  const syncCopy = copyButton(() => syncCopyText, 'solar sync summary');
  const glyphCopy = copyButton(() => {
    const rows = levelRows(model, S.T);
    return rows
      .map((r, L) => (r ? `depth ${L + 1} ${LETTERS[L]}: state ${r.index}/${r.states} (${stateMeaning(model, r.index).text})` : `depth ${L + 1} ${LETTERS[L]}: outside the catalogue`))
      .join('\n');
  }, 'all glyph states');
  const pointId = uid('pt');
  pointSel.id = pointId;
  const fracPanel = h(
    'div.cal-panel.cal-frac',
    null,
    h('h3.cal-ph', null, h('span', { text: 'Fractonica' }), h('span.cal-ph-sub', { text: 'eclipse-anchored cycles' })),
    oor,
    section(
      'Position',
      null,
      h('div.cal-poscols', null, fOrd.el, h('span.cal-plus', { text: '+', 'aria-hidden': 'true' }), fFrac.el),
      fExact.el,
      posNote,
    ),
    section(
      'Cycle address',
      h('div.cal-rtools', null, addrCopy, addrGo),
      h('div.cal-lab', { text: 'Depth' }),
      depthBar,
      h('div.cal-hint', { text: 'Solid outline: the depth of this address · dashed: the level selected in the other views' }),
      h('div.cal-chainwrap', null, chainBox),
      h('div.cal-pointrow', null, h('label.cal-lab', { text: 'Point in the cycle', for: pointId }), pointSel),
      addrResult,
      addrNote,
    ),
    section(
      'Glyph state at every depth',
      glyphCopy,
      h('p.cal-help', { text: 'Each depth shows one glyph for the phase of its cycle. Click a glyph to see when its depth shows any other state.' }),
      glyphGrid,
      picker,
    ),
    section(
      'Solar sync',
      syncCopy,
      h('div.cal-syncrow', null, h('span.cal-lab', { text: 'Sync number' }), h('div.cal-sbox', null, syncDec, syncInput, syncInc)),
      syncErr,
      syncBody,
    ),
  );

  const el = h(
    'section.card.cal-conv',
    { 'aria-label': 'Fractonica and Gregorian converter' },
    h(
      'header.card-h.cal-conv-h',
      null,
      h('h2', { text: 'Converter' }),
      status,
      h('span.spacer'),
      h('div.cal-actions', null, pinBtn, useBtn, applyBtn, hearBtn, linkBtn),
    ),
    h('div.card-b.cal-conv-wrap', null, h('div.cal-conv-body', null, gregPanel, h('div.cal-bridge', { 'aria-hidden': 'true', html: ICONS.swap }), fracPanel)),
  );

  // ------------------------------------------------------------------------------------------
  // painting
  // ------------------------------------------------------------------------------------------
  const longStamp = (t) => `${cf.long(r3(t))}`;
  const pentadAt = pentadLookup(model);
  /** A stamp led by its Pentad, as HTML (SPEC §15.3: a date leads with its Pentad like a weekday). */
  const leadStamp = (t, text) => leadHTML(model, r3(t), esc(text), { p: pentadAt(r3(t)) });
  /** deep cycles last less than a second: their start needs the milliseconds to be told apart */
  const stampFor = (t, dur) => (dur !== null && dur < 2 ? `${cf.long(r3(t))}.${String(cf.parts(r3(t)).ms).padStart(3, '0')}` : longStamp(t));
  const msStamp = (t) => `${cf.date(r3(t))} ${cf.time(r3(t), { seconds: true, ms: true })} ${cf.tag(r3(t))}`;

  /** "[⬠II] Pentad II · 2nd Helion": the Pentad of the instant, the way the weekday chip names its day. */
  function pentadChip(T) {
    const p = model.inRange(T) ? pentadAt(r3(T)) : null;
    if (!p) return '';
    const tip = `${PENTAD_NAMES[p.index]} of solar sync ${p.sync}, its Helion ${p.helion} of ${p.helions}: a solar day is 4¾ Helions, so the sync's 19 Helions run as Pentads I, II, III (5 each) and the Hypopentad (4), each about a day`;
    return `<span class="chip cal-chip cal-pchip" title="${esc(tip)}">${pentadMarkHTML(p.index)}<span>${PENTAD_NAMES[p.index]} · Helion ${p.helion} of ${p.helions}</span></span>`;
  }

  function paint() {
    const T = S.T;
    const inRange = model.inRange(T);
    const g = gregorianInfo(cf, T);

    // header
    toggleClass(pinBtn, 'is-on', S.pinned);
    setAttr(pinBtn, 'aria-pressed', String(S.pinned));
    setHtml(pinBtn, ICONS.pin + `<span>${S.pinned ? 'Pinned' : 'Pin'}</span>`);
    useBtn.disabled = !S.pinned;
    applyBtn.disabled = !inRange;
    hearBtn.disabled = !inRange;
    paintStatus();

    // Gregorian
    setText(fZone.options[0], 'App zone · ' + ctx.fmt.zone().replace(/_/g, ' '));
    fZone.value = S.zoneMode;
    swapBtn.querySelector('span').textContent = S.zoneMode === 'utc' ? 'UTC → app zone' : 'App zone → UTC';
    const ff = S.forceFields;
    S.forceFields = false;
    fDate.set(g.date, ff);
    fTime.set(g.time, ff);
    if (S.wall && (S.wall.T !== T || S.wall.zone !== zoneName())) S.wall = null; // the note belongs to the instant it explains
    setText(wallNote, S.wall ? S.wall.note : '');
    if (wallNote.hidden !== !S.wall) wallNote.hidden = !S.wall;
    fUnix.set(g.unix);
    fIso.set(g.iso);
    const dayLen = g.dayLength / 3600;
    const dst = Math.abs(dayLen - 24) > 0.01 ? `<span class="chip cal-chip is-warn" title="This local day is not 24 hours long because of a daylight-saving change">${dayLen} h day</span>` : '';
    setHtml(
      gregMeta,
      pentadChip(T) +
        `<span class="chip cal-chip">${esc(g.weekdayName)}</span><span class="chip cal-chip">day ${g.dayOfYear} of ${g.daysInYear}</span>` +
        `<span class="chip cal-chip" title="UTC offset in force at this instant">${esc(g.tag)}</span>${dst}` +
        (zoneName() !== ctx.fmt.zone() ? `<span class="chip cal-chip is-info" title="This converter uses its own zone">${esc(zoneName().replace(/_/g, ' '))}</span>` : ''),
    );

    // eclipses
    paintEclipses(T);

    // Fractonica
    toggleClass(fracPanel, 'is-out', !inRange);
    if (!inRange) {
      oor.hidden = false;
      const why = rangeProblem(model, T);
      setHtml(
        oorText,
        `<b>Outside the Saros 141 catalogue.</b> This instant is ${esc(why)}. The clock is only defined from ${esc(catalogueRangeText(model))} (UTC); nothing is extrapolated. `,
      );
      oorBtn.__edge = T < model.tMin ? model.tMin : model.tMax;
      setText(oorBtn, `Use the ${T < model.tMin ? 'first' : 'last'} instant (${cf.date(oorBtn.__edge)})`);
      fOrd.set('');
      fFrac.set('');
      fExact.set('');
      posNote.hidden = true;
      lastRows = null;
      paintAddress(null);
      paintGlyphs(null);
      paintSolar(null);
      pickerPaint(null);
      return;
    }
    oor.hidden = true;

    const pos = positionInfo(model, T);
    fOrd.set(String(pos.k));
    fFrac.set(pos.fraction);
    fExact.set(pos.exact);
    posNote.hidden = false;
    setText(posChip, `eclipse #${pos.k} + ${pos.fraction}`);
    setText(posOfChip, `of ${pos.extent}`);
    setAttr(posOfChip, 'title', `${pos.extent} Saros intervals in the catalogue`);

    const rows = levelRows(model, T);
    lastRows = rows;
    paintAddress(rows);
    paintGlyphs(rows);
    paintSolar(T);
    pickerPaint(rows);
  }

  const clockMoves = () => store.mode === 'live' || store.playing;
  function paintStatus() {
    if (S.pinned) {
      const d = S.T - store.t();
      const rel = Math.abs(d) < 0.5 ? 'equals the displayed time' : `${cf.duration(Math.abs(d))} ${d > 0 ? 'after' : 'before'} the displayed time`;
      setHtml(status, `<span class="cal-dot is-pin"></span>Pinned · ${esc(rel)}`);
    } else {
      // the dot only pulses while the followed clock really moves; a paused clock keeps a still dot (and costs nothing)
      setHtml(status, `<span class="cal-dot ${clockMoves() ? 'is-live' : 'is-still'}"></span>Following the displayed time`);
    }
    toggleClass(status, 'is-pin', S.pinned);
  }

  function paintEclipses(T) {
    const c = eclipseContext(model, T);
    const mk = (e, dir) => {
      if (!e) return `<div class="cal-erow is-none"><span class="dim">${dir > 0 ? 'No later eclipse in the catalogue' : 'No earlier eclipse in the catalogue'}</span></div>`;
      const dt = e.time - T;
      const yrs = Math.abs(dt) / 31557600;
      const dist = yrs >= 1 ? `${yrs.toFixed(yrs >= 10 ? 1 : 2)} y` : cf.duration(Math.abs(dt));
      return (
        `<div class="cal-erow"><span class="cal-earrow" aria-hidden="true">${dir > 0 ? '▸' : '◂'}</span>` +
        `<span class="cal-etxt"><b>${dist} ${dt > 0 ? 'before' : 'after'}</b> eclipse <span class="mono">#${e.k}</span> <span class="dim">(${esc(cf.date(r3(e.time)))})</span></span>` +
        `<button type="button" class="cal-go" data-k="${e.k}" title="Go to eclipse #${e.k}" aria-label="Go to eclipse number ${e.k}">${ICONS.go}</button></div>`
      );
    };
    setHtml(ctxBox, mk(c.prev, -1) + mk(c.next, 1));
  }
  ctxBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const k = Number(b.dataset.k);
    ctx.goto(model.catalogue[k] + (k < model.extent ? 0.001 : 0));
  });

  function paintAddress(rows) {
    for (let d = 1; d <= MAX_DEPTH; d++) {
      const b = depthBtns[d - 1];
      setAttr(b, 'aria-pressed', String(d === S.depth));
      toggleClass(b, 'is-sel', store.state.selectedLevel === d - 1);
    }
    pointSel.value = S.point;
    if (!rows) {
      for (const s of steppers) s.el.hidden = true;
      setHtml(addrResult, ''); // (not textContent: setHtml remembers what it wrote and would skip an identical repaint)
      addrNote.hidden = true;
      addrTimeNow = null;
      addrTextNow = '';
      addrGo.disabled = true;
      addrCopy.disabled = true;
      return;
    }
    // path from T unless the person is editing the address
    if (!S.addr.fromEdit || S.addr.path.length < S.depth) {
      S.addr.path = rows.slice(0, S.depth).map((r) => r.local);
      S.addr.fromEdit = false;
      S.addr.phaseRef = rows[S.depth - 1].phase;
    } else {
      S.addr.path = S.addr.path.slice(0, S.depth);
    }
    const path = S.addr.path;
    for (let L = 0; L < MAX_DEPTH; L++) {
      const s = steppers[L];
      s.el.hidden = L >= S.depth;
      if (L >= S.depth) continue;
      // the stepper only reaches cycles that exist (max); the count shown is the nominal one, like the ladder's "2 / 5"
      const max = childCount(model, path.slice(0, L));
      const nominal = nominalCount(model, path.slice(0, L));
      s.max = max;
      s.nominal = nominal;
      s.value = path[L];
      s.shown = String(path[L]);
      if (document.activeElement !== s.input && s.input.value !== s.shown) s.input.value = s.shown;
      setText(s.ofTxt, `/ ${nominal}`);
      const clipped = max < nominal;
      setText(s.ofNote, clipped ? `catalogue ends after ${max}` : '');
      if (s.ofNote.hidden === clipped) s.ofNote.hidden = !clipped;
      setAttr(s.of, 'title', clipped ? `The catalogue ends after ${max} of these ${nominal} cycles` : null);
      if (document.activeElement !== s.input) s.msg('');
      setAttr(s.input, 'aria-label', `${LEVEL_NAMES[L]} number, 1 to ${max}${clipped ? ` of ${nominal}: the catalogue ends after ${max}` : ''}`);
    }
    const level = S.depth - 1;
    const cyc = cycleOfPath(model, path);
    const pt = POINTS.find((p) => p.id === S.point);
    const t0 = cyc ? pointTime(model, path, S.point, S.addr.phaseRef) : null;
    addrTimeNow = t0 === null ? null : S.point === 'begin' ? landOn(model, t0, level) : landOn(model, t0);
    const label = S.point === 'phase' ? `Same phase (${pctFloor(S.addr.phaseRef, 2)} %) of` : `${pt.label} of`;
    if (t0 === null) {
      setHtml(addrResult, `<div class="cal-rline"><span class="cal-rlab">${esc(label)} ${esc(chainText(path))}</span><span class="dim">lies beyond the end of the catalogue (clipped last cycle)</span></div>`);
      addrTextNow = '';
    } else {
      const dur = cyc ? cf.duration(cyc.duration) : '';
      setHtml(
        addrResult,
        `<div class="cal-rline"><span class="cal-rlab">${esc(label)} <b style="color:${levelColor(level)}">${esc(chainText(path))}</b></span></div>` +
          `<div class="cal-rtime mono">${leadStamp(t0, stampFor(t0, cyc?.duration ?? 1e9))} <span class="dim">${esc(cf.tag(t0))}</span></div>` +
          `<div class="cal-rmeta"><span class="chip cal-chip" style="--lv:${levelColor(level)}">${LETTERS[level]} lasts ${esc(dur)}${cyc?.clipped ? ' (clipped)' : ''}</span>` +
          `<span class="chip cal-chip" title="0-based index among all ${LETTERS[level]} cycles of the catalogue (the jump box reads it as d${level + 1}#${cyc ? cyc.idx : ''})">global index ${cyc ? cyc.idx : '–'}</span></div>`,
      );
      addrTextNow = `${pathText(path)} ${pt.label.toLowerCase()} · ${leadText(model, r3(t0), msStamp(t0), { p: pentadAt(r3(t0)) })}`;
    }
    addrGo.disabled = addrTimeNow === null;
    addrCopy.disabled = addrTextNow === '';
    addrNote.hidden = true;
  }

  function paintGlyphs(rows) {
    for (let L = 0; L < MAX_DEPTH; L++) {
      const c = glyphCells[L];
      const r = rows?.[L];
      toggleClass(c.el, 'is-sel', store.state.selectedLevel === L);
      toggleClass(c.el, 'is-open', S.pick.level === L);
      setAttr(c.el, 'aria-expanded', String(S.pick.level === L));
      if (!r) {
        setHtml(c.svgBox, '');
        c.sig = '';
        setText(c.nm, `${LETTERS[L]} · depth ${L + 1}`);
        setText(c.st, '–');
        setText(c.mean, 'outside the catalogue');
        setStyle(c.bar.parentElement, '--p', '0%');
        continue;
      }
      const sig = String(r.index);
      if (c.sig !== sig) {
        c.sig = sig;
        c.svgBox.innerHTML = model.glyphSVG(r.index, { strokes: 2, color: 'currentColor', scale: 4.2, padding: 0.3, thickness: 0.3 });
        const m = stateMeaning(model, r.index);
        c.meaning = m;
      }
      const m = c.meaning ?? stateMeaning(model, r.index);
      setText(c.nm, `${LETTERS[L]} · depth ${L + 1}`);
      setText(c.st, `${r.index}/${r.states}`);
      setText(c.mean, `${m.text} ${m.arrow}`);
      setStyle(c.bar.parentElement, '--p', pctFloor(r.phase, 1) + '%');
      setAttr(c.el, 'aria-label', `Depth ${L + 1}, ${LEVEL_NAMES[L]}: glyph state ${r.index} of ${r.states}, ${m.text}. ${pctFloor(r.phase, 1)} percent through its cycle. Opens a list of other times this state shows.`);
    }
  }

  /** Countdown spans (data-cd = target instant) follow the converter's instant without rewriting their row. */
  function tickCountdowns(root) {
    for (const sp of root.querySelectorAll('[data-cd]')) setText(sp, cf.countdown(Number(sp.dataset.cd) - S.T) + (sp.dataset.sfx ?? ''));
  }
  // the reading leads with the Pentad of the instant the row goes to (a boundary belongs to what begins there); a row
  // that is itself a Pentad (`lead: false`) has its mark in the kind column already
  const timeRow = (kind, t, dur, { copyIso, goT, what, lead = true }) =>
    `<div class="cal-trow"><span class="cal-tk">${kind}</span><span class="cal-tt mono">${lead ? leadStamp(goT ?? t, stampFor(t, dur)) : esc(stampFor(t, dur))}</span>` +
    `<span class="cal-tx dim" data-cd="${t}"${dur !== null ? ` data-sfx="${esc(' · lasts ' + cf.duration(dur))}"` : ''}></span>` +
    `<button type="button" class="cal-copy" data-c="${esc(copyIso)}" title="Copy as ISO 8601" aria-label="Copy ${esc(what)}">${ICONS.copy}</button>` +
    `<button type="button" class="cal-go" data-t="${goT}" title="Go there" aria-label="Go to ${esc(what)}">${ICONS.go}</button></div>`;

  function pickerResultsHtml(L, sel, cur) {
    const m = stateMeaning(model, sel);
    const shows = (c) => model.levelAt(c, L)?.index === sel;
    const times = stateTimes(model, L, sel, S.T, 3);
    const row = (o, kind) => {
      const t = landOn(model, o.start, undefined, shows);
      return timeRow(kind, t, o.end - o.start, { copyIso: isoWithMs(cf, t), goT: t, what: longStamp(t) });
    };
    let html = `<div class="cal-pick-t">State <b class="mono">${sel}</b> of 16 · ${esc(m.text)} ${m.arrow}${sel === cur.index ? ' <span class="chip cal-chip is-info">showing now</span>' : ''}</div>`;
    html += '<div class="cal-pick-cols">';
    html += `<div><h5>Next 3</h5>${times.next.length ? times.next.map((o) => row(o, 'next')).join('') : '<div class="dim cal-none">none before the catalogue ends</div>'}</div>`;
    html += `<div><h5>Previous 3</h5>${times.prev.length ? times.prev.map((o) => row(o, 'prev')).join('') : '<div class="dim cal-none">none after the catalogue starts</div>'}</div>`;
    return html + '</div>';
  }

  function pickerPaint(rows) {
    const L = S.pick.level;
    if (L === null || !rows || !rows[L]) {
      picker.hidden = true;
      return;
    }
    const cur = rows[L];
    const sel = S.pick.index ?? cur.index;
    picker.hidden = false;
    setStyle(picker, '--lv', levelColor(L));
    setText(pickTitle, `${LETTERS[L]} · depth ${L + 1}`);
    for (let i = 0; i < 16; i++) {
      const { b, m } = pickStates[i];
      toggleClass(b, 'is-on', i === sel);
      toggleClass(b, 'is-now', i === cur.index);
      setAttr(b, 'aria-pressed', String(i === sel));
      setAttr(b, 'title', `State ${i}: ${m.text}${i === cur.index ? ' (showing now)' : ''}`);
    }
    // the occurrences are exact BigInt computations: redo them when the choice changes, when the converter
    // was moved, or at most once a second while it follows the clock
    const key = `${L}|${sel}|${sel === cur.index}|${zoneName()}`;
    const nowMs = performance.now();
    if (pickRes.__key !== key || (S.T !== pickRes.__T && (S.pinned || nowMs - pickRes.__at >= 1000))) {
      pickRes.__key = key;
      pickRes.__T = S.T;
      pickRes.__at = nowMs;
      setHtml(pickRes, pickerResultsHtml(L, sel, cur)); // identical lists are not written again
    }
    tickCountdowns(pickRes);
  }
  async function copyFromRow(e) {
    const b = e.target.closest('button[data-c]');
    if (!b) return false;
    const ok = await copyText(b.dataset.c);
    if (ok) flash(b);
    ctx.toast(ok ? 'Copied ' + b.dataset.c : 'Copy is not available in this browser');
    return true;
  }
  picker.addEventListener('click', (e) => {
    if (e.target.closest('button[data-c]')) {
      copyFromRow(e);
      return;
    }
    if (e.target.closest('.cal-pick-x')) return closePicker();
    const st = e.target.closest('.cal-state');
    if (st) {
      S.pick.index = Number(st.dataset.i);
      S.force = true;
      return ctx.requestRender();
    }
    const go = e.target.closest('button[data-t]');
    if (go) ctx.goto(Number(go.dataset.t));
  });
  picker.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
    }
  });

  /** The sync rows are static for one (sync number, zone): built once, only the countdowns and the phase bar tick. */
  function syncSkeleton(n, info) {
    const gold = 'var(--gold)';
    const driftTxt = `${info.drift < 0 ? '−' : '+'}${cf.duration(Math.abs(info.drift), { parts: 3 })}`;
    const row = (lab, t, level) => timeRow(lab, t, null, { copyIso: isoWithMs(cf, t), goT: landOn(model, t, level), what: `${lab} of sync ${n}` });
    let html = '<div class="cal-phase" title="Where this instant sits inside the sync" hidden><i></i><span class="mono"></span></div>';
    html += row('start', info.start, 6) + row('end', info.end, 6);
    html += `<div class="cal-kv"><span class="cal-k">Sync time of day</span><span class="mono" style="color:${gold}">${esc(info.startClock)}</span><span class="dim">${esc(cf.tag(info.start))} · moves ≈ 10 s earlier per sync</span></div>`;
    html += `<div class="cal-kv"><span class="cal-k">Civil 4-day grid</span><span class="mono">${esc(cf.date(r3(info.nominalStart)))} ${esc(info.nominalClock)}</span><span class="dim">drift ${esc(driftTxt)}</span></div>`;
    html += `<div class="cal-kv"><span class="cal-k">Length</span><span class="mono">${esc(cf.duration(info.length, { parts: 3 }))}</span><span class="dim">19 η cycles</span></div>`;
    html += '<div class="cal-qh">Quarter thresholds</div>';
    for (const q of info.quarters) html += row(q.name, q.time, q.name === 'end' ? 6 : undefined);
    // the Pentads: the sync's 19 Helions as I, II, III (5η) and the Hypopentad (4η), each about a day (SPEC §7.5)
    const pents = syncPentads(model, n);
    const helion = model.levelInfo(6).meanSeconds;
    html += `<div class="cal-qh">Pentads</div><p class="cal-help cal-pnote">A solar day is 4¾η (≈ 24 h), so each Pentad begins ¼η (≈ ${esc(cf.duration(helion / 4))}) later in the day than the one before; the Hypopentad, one Helion short, brings Pentad I back.</p>`;
    for (const p of pents) {
      html += `<div class="cal-prow-w" data-pq="${p.index}">` + timeRow(pentadMarkHTML(p.index), p.start, p.end - p.start, { copyIso: isoWithMs(cf, p.start), goT: landOn(model, p.start, 6), what: `${PENTAD_NAMES[p.index]} of sync ${n}`, lead: false }) + '</div>';
    }
    const pentCopy = pents.map((p) => `${PENTAD_NAMES[p.index]} ${cf.time(r3(p.start), { seconds: false })}`).join(', ');
    return {
      html,
      copy: `Solar sync ${n}: ${msStamp(info.start)} → ${msStamp(info.end)}; time of day ${info.startClock}; drift ${driftTxt} vs the civil grid; Pentads ${pentCopy}`,
    };
  }

  function paintSolar(T) {
    if (T === null) {
      setHtml(syncBody, '');
      syncRefs = null;
      syncCopyText = '';
      syncShown = null;
      syncCopy.disabled = syncDec.disabled = syncInc.disabled = true;
      if (document.activeElement !== syncInput) syncInput.value = '';
      return;
    }
    if (S.syncErrFor !== undefined && S.syncErrFor !== T) syncMsg(''); // a message about another instant is stale
    const at = safeSolarAt(model, T);
    let n;
    if (S.sync.fromEdit && S.sync.n !== null) n = S.sync.n;
    else n = at ? at.sync : null;
    if (n === null) {
      // the half-sync at an edge: no sync is defined here, so nothing to step from (or to copy)
      S.sync.n = null;
      syncShown = null;
      syncCopyText = '';
      syncCopy.disabled = syncDec.disabled = syncInc.disabled = true;
      if (document.activeElement !== syncInput) syncInput.value = '';
      const r = syncRange(model);
      const first = T < (model.tMin + model.tMax) / 2;
      syncRefs = null;
      setHtml(
        syncBody,
        `<div class="cal-oor is-soft">This instant lies in the half-sync at the edge of the catalogue; solar syncs need a full 4-day run inside it.` +
          `<button type="button" class="btn btn-sm" data-sync="${first ? r.first : r.last}">Go to the ${first ? 'first' : 'last'} full sync (${first ? r.first : r.last})</button></div>`,
      );
      return;
    }
    syncShown = n;
    S.sync.n = S.sync.fromEdit ? S.sync.n : n;
    syncDec.disabled = syncInc.disabled = false;
    if (document.activeElement !== syncInput && syncInput.value !== String(n)) syncInput.value = String(n);
    const key = `${n}|${zoneName()}`;
    if (!syncBody.__sk || syncBody.__sk.key !== key) {
      const info = solarInfo(model, cf, n);
      syncBody.__sk = info ? { key, ...syncSkeleton(n, info) } : { key, html: '', copy: '' };
    }
    const sk = syncBody.__sk;
    syncCopyText = sk.copy;
    syncCopy.disabled = sk.copy === '';
    const wrote = syncBody.__html !== sk.html;
    setHtml(syncBody, sk.html);
    if (wrote || !syncRefs) {
      const ph = syncBody.querySelector('.cal-phase');
      syncRefs = ph ? { ph, txt: ph.lastChild } : {};
    }
    if (syncRefs.ph) {
      const phase = at && at.sync === n ? at.phase : null;
      if (syncRefs.ph.hidden !== (phase === null)) syncRefs.ph.hidden = phase === null;
      if (phase !== null) {
        setStyle(syncRefs.ph, '--p', pctFloor(phase, 3) + '%');
        setText(syncRefs.txt, pctFloor(phase, 6) + ' %');
      }
    }
    markSyncPentad(syncBody, n, T);
    tickCountdowns(syncBody);
  }
  /** The Pentad holding the instant, among the sync's four rows. */
  function markSyncPentad(body, n, T) {
    const p = pentadAt(r3(T));
    const q = p && p.sync === n ? String(p.index) : '';
    for (const r of body.querySelectorAll('.cal-prow-w')) toggleClass(r, 'is-now', r.dataset.pq === q);
  }
  syncBody.addEventListener('click', (e) => {
    if (e.target.closest('button[data-c]')) {
      copyFromRow(e);
      return;
    }
    const to = e.target.closest('button[data-sync]');
    if (to) return gotoSync(Number(to.dataset.sync));
    const go = e.target.closest('button[data-t]');
    if (go) ctx.goto(Number(go.dataset.t));
  });
  // ------------------------------------------------------------------------------------------
  // lifecycle
  // ------------------------------------------------------------------------------------------
  const unsubTime = store.onTime(() => {
    S.force = true;
  });

  return {
    el,
    setActive(on) {
      S.active = on;
      if (on) S.force = true;
    },
    /** instant currently shown (for other parts of the calendar tab) */
    get time() {
      return S.T;
    },
    render(frame, info) {
      const now = performance.now();
      if (hearBtn.hidden === hasSound(ctx)) hearBtn.hidden = !hasSound(ctx); // the sound module mounts in parallel with this one
      const zn = zoneName();
      if (zn !== S.lastZone) {
        S.lastZone = zn;
        S.dirty = true;
        S.force = true;
      }
      if (!S.depthTouched) {
        const d = clampDepth(store.state.topDepth + 1);
        if (d !== S.depth) {
          S.depth = d;
          S.addr.fromEdit = false;
          S.dirty = true;
          S.force = true;
        }
      }
      if (store.state.selectedLevel !== S.lastSel) {
        S.lastSel = store.state.selectedLevel;
        S.dirty = true;
        S.force = true;
      }
      if (!S.pinned) {
        // following: every field is derived from the displayed time
        if (S.addr.fromEdit || S.sync.fromEdit) {
          S.addr.fromEdit = false;
          S.sync.fromEdit = false;
          S.dirty = true;
        }
        const t = r3(frame.t);
        if (t !== S.T) {
          S.T = t;
          S.dirty = true;
        }
      }
      if (!S.pinned && S.moving !== clockMoves()) {
        S.moving = clockMoves();
        paintStatus(); // play / pause changes the dot without moving the time
      }
      if (S.pinned && !S.dirty && !S.force && now - (S.lastStatus ?? 0) > 400) {
        S.lastStatus = now;
        paintStatus();
      }
      if (!S.dirty && !S.force) return;
      if (!S.force && now - S.lastPaint < FOLLOW_MS) return;
      S.dirty = false;
      S.force = false;
      S.lastPaint = now;
      paint();
    },
    destroy() {
      unsubTime();
      el.remove();
    },
  };
}
