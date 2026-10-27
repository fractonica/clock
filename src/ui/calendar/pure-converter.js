/**
 * The pure converter (left half of the Calendar tab in pure mode): Fractonica forms only (SPEC §15, revision 3).
 *
 * One moment T is the single source of truth, exactly like the normal converter. Editing any field (a date in words or
 * letters, a major period by its fracton name, the Nuclide or a count, the Saros position, a cycle address, a glyph pair,
 * a solar sync) parses it, pins the converter on the result and repaints every other field. Unpinned, T follows the shown
 * moment.
 *
 *   Moment  - the Helion reading (count, phase pair, Preons, Flavons, Blinks), the full date in words, the stamp field
 *             (reads every date form, counts and offsets), the four major periods by name with their quarter word, the
 *             Nuclide ε#1–5, the Helion 1–77 and the counts ι 0–35, λ 0–64, ν 0–24, the eclipses around it in ladder units
 *   Cycles  - position (ordinal + fraction + exact), cycle address (majors and the Nuclide by number, finer depths by
 *             where they start in their Nuclide), the phase at every depth (major periods: their quarter word; every
 *             other depth: its glyph PAIR, with a picker for "when does depth d show this pair"), the solar sync
 *
 * Major periods (α β γ δ) are said in words with a quarter word and never get a phase pair. Nothing here prints a
 * Gregorian date, a zone, an Earth unit or a percentage: spans are counted over α β γ δ ε η ι λ ν (src/core/pure.js),
 * phases are two 2-stroke glyphs, distances are exact position spans. Offsets typed into the stamp field may use any
 * unit, Blinks included (+2ε 5η, +4 Blinks, +0.5ν).
 *
 * Notation: X#n is an ordinal counted from 1 (δ#3, ε#2), nX a count of completed units counted from 0 (29ι 21λ 3ν), except
 * the Helion of a date, written 34η but numbered from 1 in its Nuclide (the 34th; 1–77).
 * Eclipses are named like positions, #22 for the one at position 22; the drift of a sync is pure.driftText.
 */
import { h, ICONS, esc, setText, setHtml, setStyle, setAttr, toggleClass, copyText, prefersReducedMotion, hasSound, hearMoment } from './dom.js';
import { pentadMarkHTML, leadHTML, leadText, pentadLookup, PENTAD_NAMES, DAY_TEXT, QUARTER_TEXT, OFFSET_TEXT } from '../pentad.js';
import { syncPentads } from './pentads.js';
import { levelColor, GOLD } from '../../core/theme.js';
import { LEVEL_NAMES, ORDINAL_NAMES, QUARTER_WORDS } from '../../core/pure.js';
import {
  LETTERS,
  MAX_DEPTH,
  an,
  POINTS,
  chainText,
  childCount,
  cycleLabel,
  cycleOfPath,
  levelRows,
  nominalCount,
  normalizePath,
  pathOfTime,
  pathText,
  pointTime,
  positionInfo,
  r3,
  safeSolarAt,
  stateMeaning,
  syncRange,
  timeOfPositionParts,
  timeOfPositionText,
} from './convert.js';
import { parsePure } from './pure-parse.js';
import { COUNTERS, LEVEL_OF, MAJORS, countersAt, firstMs, landCycleAt, landPath, madeOf, pureEclipseContext, pureShareQuery, pureSolarInfo, setCounter, shiftUnits, spanText } from './pure-conv.js';

const FOLLOW_MS = 100; // repaint interval while following a moving clock
const PURE_POINTS = POINTS.map((p) => (p.id === 'phase' ? { ...p, label: 'Same phase as this moment' } : p));

export function createPureConverter(ctx, { tip }) {
  const { model, store, pure } = ctx;
  const S = {
    pinned: false,
    T: r3(store.t()),
    depth: clampDepth(store.state.topDepth + 1),
    depthTouched: false,
    point: 'begin',
    addr: { fromEdit: false, path: [], phaseRef: 0 },
    sync: { fromEdit: false, n: null },
    pick: { level: null, index: null, index2: null },
    rejected: '',
    dirty: true,
    force: true,
    lastPaint: 0,
    active: true,
  };
  function clampDepth(d) {
    return Math.max(1, Math.min(MAX_DEPTH, Math.round(d) || 6));
  }

  // ------------------------------------------------------------------------------------------
  // small builders
  // ------------------------------------------------------------------------------------------
  let nextId = 0;
  const uid = (p) => `cal-pc-${p}-${++nextId}`;
  const catalogue = () => pure.catalogueText();
  /** "in 2ε 5η" / "5λ ago" between the converter's moment and t. */
  const relTo = (t) => {
    if (Math.abs(t - S.T) < 0.0005) return 'at this moment';
    const text = spanText(model, pure, Math.min(S.T, t), Math.max(S.T, t));
    return t > S.T ? `in ${text}` : `${text} ago`;
  };
  const stampOf = (t) => pure.stamp(t, 'nu');
  /** The Pentad of a moment, from cached spans (rows and readouts ask for many nearby moments). */
  const pentadAt = pentadLookup(model);

  function flash(btn) {
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
      if (!model.inRange(r3(t))) return ctx.toast(`Outside the catalogue (${catalogue()})`);
      ctx.goto(level === undefined ? Math.ceil(t * 1000) / 1000 : landCycleAt(model, t, level));
    });
    return b;
  }

  /** Labelled text input with live parsing, inline error and a copy button (same behaviour as the normal converter). */
  function field({ label, mono = true, placeholder = '', inputmode, copy, parse, apply, narrow = false, hint, long = false, multiline = false }) {
    const id = uid('f');
    // (a stamp is ~70 characters: it wraps over two lines instead of hiding its end)
    const input = multiline
      ? h('textarea.input.cal-in.cal-ta' + (mono ? '.mono' : ''), { id, rows: 2, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label })
      : h('input.input.cal-in' + (mono ? '.mono' : ''), { type: 'text', id, inputmode, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label });
    const err = h('div.cal-err', { role: 'alert', hidden: true });
    const copyBtn = copy ? copyButton(copy, label.toLowerCase()) : null;
    const wrap = h('div.cal-field' + (narrow ? '.is-narrow' : '') + (long ? '.is-long' : ''), null, h('label.cal-lab', { for: id, text: label }), h('div.cal-inwrap', null, input, copyBtn), hint ? h('div.cal-hint', { text: hint }) : null, err);
    let timer = 0;
    let shown = '';
    let dirty = false; // true only while the text differs from what the person typed last
    const showErr = (m) => {
      err.textContent = m || '';
      err.hidden = !m;
      input.classList.toggle('is-bad', !!m);
      setAttr(input, 'aria-invalid', m ? 'true' : null);
    };
    function commit(final) {
      clearTimeout(timer);
      if (input.value.trim() === '' && !final) {
        showErr('');
        return false;
      }
      const r = parse(input.value);
      let msg;
      if (r && !r.error) {
        if (final) S.forceFields = true; // the text is rewritten as the converter writes it (Enter, blur)
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
      }
    });
    return {
      el: wrap,
      input,
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
  function setT(t, from) {
    S.rejected = '';
    if (!Number.isFinite(t)) {
      S.rejected = 'Not a valid moment';
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

  // ---- stamp / name / offset field
  const fStamp = field({
    label: 'Stamp or name',
    placeholder: 'Delta Trifracton Node ε#2 21η · α#6 β#4 γ#9 δ#3 ε#5 34η · 5η 17ι',
    hint: 'A date in words or letters, counts such as 5η 17ι, or an offset such as +2ε 5η or +4 Blinks',
    copy: () => stampOf(S.T),
    multiline: true,
    parse: (txt) => {
      const r = parsePure(txt, { model, pure, now: S.T, real: store.realNow(), level: store.state.selectedLevel });
      const c = r.find((x) => x.time !== null && x.kind !== 'error');
      if (c) return { ok: true, t: c.time };
      return { error: r[0]?.error || 'Not understood' };
    },
    apply: ({ t }) => setT(t, 'stamp'),
  });

  /**
   * What a level is, in words (tooltips on the entries and the depth chips): "Helion · η: one whole cycle of depth 7, 77
   * in a Nuclide, lasts 36ι"; a depth between units: "ζ: depth 6, not a unit; one cycle is 11η".
   */
  const unitTip = (level) => {
    const sym = LETTERS[level];
    const u = pure.unitOf(level);
    if (!u) return `${sym}: depth ${level + 1}, not a unit; one cycle is ${pure.cycleLength(level)}`;
    const i = pure.UNITS.indexOf(u);
    const parent = pure.UNITS[i - 1];
    const per = parent ? `, ${Math.round(pure.unitPos(parent) / pure.unitPos(u))} in ${an(parent.name)} ${parent.name}` : '';
    const made = madeOf(model, pure, level);
    return `${u.name} · ${sym}: one whole cycle of depth ${level + 1}${per}${made ? `, lasts ${made}` : ''}`;
  };

  /** The word of a numbered level of the address: Alpha … Delta, then the Nuclide. */
  const stepWord = (L) => (L <= 3 ? LEVEL_NAMES[L] : 'Nuclide');

  // ---- the major periods by name, with their quarter word: Alpha … Delta
  function makeMajor(spec) {
    const name = LEVEL_NAMES[spec.level];
    const sel = h('select.select.cal-msel', { 'aria-label': `${name} of this moment, by its fracton name` });
    const count = spec.id === 'alpha' ? Number(model.clock.count(0)) : spec.max;
    for (let n = 1; n <= count; n++) sel.append(h('option', { value: String(n), text: ORDINAL_NAMES[n] ?? `#${n}` }));
    const quarter = h('span.cal-mq');
    const err = h('div.cal-serr', { role: 'alert', hidden: true });
    const lab = h('span.cal-sl', { text: name, title: unitTip(spec.level) });
    const el = h('div.cal-mstep', { style: `--lv:${levelColor(spec.level)}` }, lab, sel, quarter, err);
    const api = { spec, el, sel, quarter, value: 1 };
    api.msg = (m) => {
      err.textContent = m || '';
      err.hidden = !m;
    };
    sel.addEventListener('change', () => {
      api.msg('');
      const n = Number(sel.value);
      if (n === api.value) return;
      const r = setCounter(model, pure, S.T, spec.id, n);
      if (r.error) {
        sel.value = String(api.value);
        return api.msg(r.error);
      }
      setT(r.t, 'counter');
    });
    return api;
  }
  const majors = MAJORS.map(makeMajor);

  // ---- the Nuclide and the counts: ε# · η ι λ ν
  function makeCounter(spec) {
    const level = LEVEL_OF[spec.id];
    // the Nuclide is an ordinal ("ε#" + the number box, from 1); the Helion is numbered from 1 and the others are counts
    // from 0, both written number first ("34η", "29ι")
    const kind = spec.numbered ? 'number' : 'count';
    const word = pure.unitName(spec.sym);
    const input = h('input.cal-sv.mono', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${word} ${kind}, ${spec.min} to ${spec.max}`, size: 3 });
    const dec = h('button.cal-sb', { type: 'button', html: '−', title: `One ${word} back`, 'aria-label': `One ${word} back` });
    const inc = h('button.cal-sb', { type: 'button', html: '+', title: `One ${word} forward`, 'aria-label': `One ${word} forward` });
    const err = h('div.cal-serr', { role: 'alert', hidden: true });
    const range = h('span.cal-so', null, h('span.cal-sn', { text: `${spec.min}–${spec.max}` }));
    const lab = h('span.cal-sl', { text: spec.ordinal ? `${spec.sym}#` : spec.sym, title: unitTip(level), 'aria-hidden': 'true' });
    const box = h('div.cal-sbox', null, dec, input, inc);
    const el = h('div.cal-step.cal-cstep' + (spec.ordinal ? '.is-ord' : '.is-count'), { style: `--lv:${levelColor(level)}` }, ...(spec.ordinal ? [lab, box] : [box, lab]), range, err);
    const api = { spec, el, input, value: spec.min };
    const msg = (m) => {
      err.textContent = m || '';
      err.hidden = !m;
      input.classList.toggle('is-bad', !!m);
    };
    api.msg = msg;
    const nudge = (dir) => {
      msg('');
      const t = shiftUnits(model, pure, S.T, spec.id, dir);
      if (t === null) return ctx.toast(dir > 0 ? 'End of the catalogue' : 'Start of the catalogue');
      setT(t, 'counter');
    };
    dec.addEventListener('click', () => nudge(-1));
    inc.addEventListener('click', () => nudge(1));
    const commit = (final) => {
      const txt = input.value.trim();
      if (txt === '') return;
      const n = Number(txt);
      if (!/^\d+$/.test(txt) || !Number.isInteger(n)) return final && msg('Whole number');
      if (n < spec.min || n > spec.max) return (final || String(n).length >= String(spec.max).length) && msg(spec.ordinal ? `${spec.sym}# is numbered ${spec.min}–${spec.max}` : `${spec.sym} counts ${spec.min}–${spec.max}`);
      msg('');
      if (n === api.value) return;
      const r = setCounter(model, pure, S.T, spec.id, n);
      if (r.error) return msg(r.error);
      setT(r.t, 'counter');
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
  const counters = COUNTERS.map(makeCounter);
  const majorRow = h('div.cal-crow.cal-mrow', null, h('span.cal-clab', { text: 'Major periods · by name, with the quarter they are in' }), ...majors.map((m) => m.el));
  const clockRow = h('div.cal-crow', null, h('span.cal-clab', { text: 'Nuclide (# from 1), Helion (from 1), then Preons, Flavons, Blinks completed (from 0)' }), ...counters.map((c) => c.el));

  const readDate = h('div.cal-pc-date.mono');
  const readClock = h('div.cal-pc-clock');
  const readNames = h('div.cal-pc-names');
  const readout = h('div.cal-pc-read', null, readClock, readDate, readNames);
  const ctxBox = h('div.cal-eclipses');
  ctxBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const k = Number(b.dataset.k);
    ctx.goto(model.catalogue[k] + (k < model.extent ? 0.001 : 0));
  });

  // ---- position
  const fOrd = field({
    label: 'Eclipse number',
    placeholder: '–',
    inputmode: 'numeric',
    narrow: true,
    copy: () => String(positionInfo(model, S.T)?.k ?? ''),
    parse: (txt) => {
      const r = timeOfPositionParts(model, txt.trim(), fFrac.input.value.trim());
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
  const posChip = h('span.chip.cal-chip');
  const posOfChip = h('span.chip.cal-chip');
  const posNote = h('div.cal-meta', null, posChip, posOfChip);

  // ---- cycle address
  const depthBar = h('div.cal-depths', { role: 'group', 'aria-label': 'Address depth' });
  const depthBtns = [];
  for (let d = 1; d <= MAX_DEPTH; d++) {
    const b = h('button.cal-dchip', {
      type: 'button',
      'aria-pressed': 'false',
      title: `Depth ${d} · ${LEVEL_NAMES[d - 1]} · ${unitTip(d - 1)}`,
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
  // the numbered levels of an address are α β γ δ and the Nuclide; a finer cycle is placed by its counts in the Nuclide
  const steppers = [];
  for (let L = 0; L <= 4; L++) steppers.push(makeStepper(L));
  steppers.forEach((s) => chainBox.append(s.el));
  const placeLab = h('span.cal-sl', { 'aria-hidden': 'true' });
  const placeTxt = h('span.cal-placet.mono', { 'aria-live': 'polite' });
  const placeDec = h('button.cal-sb', { type: 'button', html: '−', title: 'The cycle before', 'aria-label': 'The cycle of this depth before' });
  const placeInc = h('button.cal-sb', { type: 'button', html: '+', title: 'The next cycle', 'aria-label': 'The next cycle of this depth' });
  const placeEl = h('div.cal-step.cal-place', { hidden: true }, placeLab, h('div.cal-sbox', null, placeDec, placeTxt, placeInc), h('span.cal-so', null, h('span.cal-sn', { text: 'where it starts in its Nuclide' })));
  placeDec.addEventListener('click', () => stepLevel(S.depth - 1, -1));
  placeInc.addEventListener('click', () => stepLevel(S.depth - 1, 1));
  chainBox.append(placeEl);

  function makeStepper(L) {
    const input = h('input.cal-sv.mono', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': `${stepWord(L)} number`, size: 3 });
    const dec = h('button.cal-sb', { type: 'button', html: '−', title: `Previous ${stepWord(L)}`, 'aria-label': `Previous ${stepWord(L)}` });
    const inc = h('button.cal-sb', { type: 'button', html: '+', title: `Next ${stepWord(L)}`, 'aria-label': `Next ${stepWord(L)}` });
    const ofTxt = h('span.cal-sn');
    const ofNote = h('span.cal-snote', { hidden: true });
    const of = h('span.cal-so', null, ofTxt, ofNote);
    const err = h('div.cal-serr', { role: 'alert', hidden: true });
    const el = h('div.cal-step', { style: `--lv:${levelColor(L)}`, hidden: true }, h('span.cal-sl', { text: `${LETTERS[L]}#`, title: stepWord(L), 'aria-hidden': 'true' }), h('div.cal-sbox', null, dec, input, inc), of, err);
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
          msg(L === 0 ? `Only ${api.max} Alphas exist in the catalogue` : `There are only ${api.max} ${stepWord(L)}s here (${cycleLabel(L, 1)} … ${cycleLabel(L, api.max)}${sooner})`);
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
  const currentPath = () => S.addr.path.slice(0, S.depth);
  function applyPath(path, from = 'addr') {
    const norm = normalizePath(model, path);
    if (norm.length !== path.length) return;
    const t0 = pointTime(model, norm, S.point, S.addr.phaseRef);
    if (t0 === null) {
      S.addr.path = norm;
      S.addr.fromEdit = true;
      S.dirty = true;
      S.force = true;
      ctx.requestRender();
      return;
    }
    const t = landPath(model, norm, S.point, S.addr.phaseRef);
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
    applyPath([...model.cycleToPath(L, next), ...p.slice(L + 1)]);
  }
  const pointSel = h('select.select.cal-point', { 'aria-label': 'Point in the cycle' });
  for (const p of PURE_POINTS) pointSel.append(h('option', { value: p.id, text: p.label }));
  pointSel.addEventListener('change', () => {
    S.point = pointSel.value;
    const p = currentPath();
    if (p.length) applyPath(p);
  });
  const addrResult = h('div.cal-result');
  let addrTimeNow = null;
  let addrTextNow = '';
  const addrCopy = copyButton(() => addrTextNow, 'cycle address');
  const addrGo = goButton(() => addrTimeNow, 'the addressed point');

  // ---- glyph pairs
  const glyphGrid = h('div.cal-glyphs.cal-pglyphs', { role: 'group', 'aria-label': 'Phase at every depth' });
  const glyphCells = [];
  for (let L = 0; L < MAX_DEPTH; L++) {
    const pairBox = h('span.cal-gpair', { 'aria-hidden': 'true' });
    const nm = h('span.cal-gname');
    const st = h('span.cal-gstate.mono');
    const mean = h('span.cal-gmean');
    const bar = h('span.cal-gbar', { 'aria-hidden': 'true' }, h('i'));
    const b = h('button.cal-gcell.cal-pgcell', { type: 'button', style: `--lv:${levelColor(L)}`, 'aria-haspopup': 'true', 'aria-expanded': 'false' }, pairBox, h('span.cal-gtxt', null, nm, st, mean), bar);
    b.addEventListener('click', () => {
      ctx.select(L);
      if (L > 3) openPicker(L); // (a major period has no glyph pair: its quarter word is all it shows)
    });
    if (L <= 3) b.removeAttribute('aria-haspopup');
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
    glyphCells.push({ el: b, pairBox, nm, st, mean, bar: bar.firstChild, sig: '' });
  }
  let lastRows = null;
  /** A major period: its name, its quarter and the thresholds that end the quarters, no phase. */
  function majorTipHtml(L) {
    const l = model.levelAt(S.T, L);
    if (!l) return '';
    const q = Math.min(3, Math.floor(l.phase * 4));
    const pts = [1, 2, 3, 4].map((k) => ({ k, t: pointOfCycle(model, L, l.cycle, k / 4) }));
    const rows = pts.map(({ k, t }) => `<dt>${QUARTER_WORDS[k - 1]} ends</dt><dd${k - 1 === q ? ' class="is-next"' : ''}>${t === null ? 'after the catalogue ends' : esc(relTo(t))}</dd>`).join('');
    return (
      `<div class="cal-tt-h" style="color:${levelColor(L)}">${esc(pure.majorText(S.T, L))}<span class="dim"> · depth ${L + 1}</span></div>` +
      `<div class="dim">${esc(unitTip(L))}</div>` +
      `<dl class="cal-tt-dl">${rows}</dl>` +
      `<div class="dim cal-tt-hint">A major period is read by its quarter (named by the threshold that ends it), not by glyphs.</div>`
    );
  }
  function showGlyphTip(L, x, y) {
    const r = lastRows?.[L];
    if (!r || !S.active) return;
    if (L <= 3) return tip.show(majorTipHtml(L), x, y);
    const m = stateMeaning(model, r.index);
    const od = model.odometerAt(S.T, L, { strokes: 2, digits: 2 });
    const trits = (r.trits ?? []).map((t) => (t > 0 ? '+' : t < 0 ? '−' : '0')).join(' ');
    const next = od?.nextTime ?? null;
    let html =
      `<div class="cal-tt-h" style="color:${levelColor(L)}">${LETTERS[L]} · depth ${L + 1}<span class="dim"> ${LEVEL_NAMES[L]}</span></div>` +
      `<div class="cal-tt-pair">${pure.pairHTML(r.phase, { label: `${LETTERS[L]} phase` })}<span class="mono">${esc(pure.pairText(r.phase))}</span></div>` +
      `<div>Coarse glyph: state <b>${r.index}</b> of ${r.states} · ${esc(m.text)} ${m.arrow}${r.dotted ? ' <span class="dim">(dot = falling branch)</span>' : ''}</div>` +
      `<div class="dim">${esc(pure.cycleName(L, r.cycle))} · ${esc(unitTip(L))}</div>` +
      `<dl class="cal-tt-dl"><dt>cycle</dt><dd>${leadHTML(model, r.start, esc(pure.stamp(r.start, pure.resolutionOf(L))))} → ${leadHTML(model, r.end, esc(pure.stamp(r.end, pure.resolutionOf(L))))}</dd>`;
    html += `<dt>trits</dt><dd class="mono">${esc(trits)} <span class="dim">(msb first)</span></dd>`;
    if (od) html += `<dt>odometer</dt><dd class="mono">[${od.digits.join(', ')}] <span class="dim">coarse · fine</span></dd>`;
    if (next) html += `<dt>pair changes</dt><dd>${esc(relTo(next))}</dd>`;
    html += `<dt>next ${esc(r.next.name)}</dt><dd>${r.next.time ? esc(relTo(r.next.time)) : '–'}</dd></dl>`;
    html += `<div class="dim cal-tt-hint">Click to see when depth ${L + 1} shows any other pair.</div>`;
    tip.show(html, x, y);
  }

  // The picker is built once (16 + 17 state buttons, a result block) and only repainted.
  const pickTitle = h('b');
  const pickClose = h('button.cal-pick-x', { type: 'button', 'aria-label': 'Close the state list', title: 'Close (Esc)', html: ICONS.close });
  const pickStates = [];
  const pickGrid = h('div.cal-states', { role: 'group', 'aria-label': 'Coarse glyph, pick one' });
  for (let i = 0; i < 16; i++) {
    const m = stateMeaning(model, i);
    const b = h('button.cal-state', { type: 'button', 'data-i': String(i), 'aria-pressed': 'false', 'aria-label': `Coarse glyph, state ${i}: ${m.text}`, html: model.glyphSVG(i, { strokes: 2, color: 'currentColor', scale: 3.2, padding: 0.25 }) + `<span class="mono">${i}</span>` });
    pickStates.push({ b, m });
    pickGrid.append(b);
  }
  const pickStates2 = [];
  const pickGrid2 = h('div.cal-states.cal-states2', { role: 'group', 'aria-label': 'Fine glyph, optional' });
  const anyBtn = h('button.cal-state.cal-any', { type: 'button', 'data-j': 'any', 'aria-pressed': 'true', 'aria-label': 'Fine glyph: any', html: '<span class="cal-any-t">any</span>' });
  pickGrid2.append(anyBtn);
  for (let j = 0; j < 16; j++) {
    const m = stateMeaning(model, j);
    const b = h('button.cal-state', { type: 'button', 'data-j': String(j), 'aria-pressed': 'false', 'aria-label': `Fine glyph, state ${j}: ${m.text}`, html: model.glyphSVG(j, { strokes: 2, color: 'currentColor', scale: 3.2, padding: 0.25 }) + `<span class="mono">${j}</span>` });
    pickStates2.push({ b, m });
    pickGrid2.append(b);
  }
  const pickRes = h('div.cal-pick-res');
  const picker = h(
    'div.cal-picker',
    { hidden: true, role: 'group', 'aria-label': 'When a glyph pair shows' },
    h('div.cal-pick-h', null, pickTitle, h('span.dim', { text: 'choose the coarse glyph, optionally the fine one' }), pickClose),
    h('div.cal-pick-l', { text: 'Coarse glyph' }),
    pickGrid,
    h('div.cal-pick-l', { text: 'Fine glyph (refines 16 states to 256)' }),
    pickGrid2,
    pickRes,
  );
  function openPicker(L) {
    if (L <= 3) return;
    if (S.pick.level === L && !picker.hidden) {
      S.pick = { level: null, index: null, index2: null };
      S.force = true;
      return ctx.requestRender();
    }
    S.pick = { level: L, index: null, index2: null };
    S.pinned = true;
    S.force = true;
    ctx.requestRender();
    requestAnimationFrame(() => picker.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  }
  function closePicker() {
    const L = S.pick.level;
    S.pick = { level: null, index: null, index2: null };
    S.force = true;
    ctx.requestRender();
    if (L !== null) glyphCells[L]?.el.focus({ preventScroll: true });
  }

  // ---- solar sync
  const syncInput = h('input.cal-sv.mono', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Solar sync number', size: 6, placeholder: '–' });
  const syncDec = h('button.cal-sb', { type: 'button', html: '−', title: 'Previous sync', 'aria-label': 'Previous sync' });
  const syncInc = h('button.cal-sb', { type: 'button', html: '+', title: 'Next sync', 'aria-label': 'Next sync' });
  const syncErr = h('div.cal-err', { role: 'alert', hidden: true });
  const syncBody = h('div.cal-syncbody');
  let syncShown = null;
  let syncRefs = null;
  function syncMsg(m) {
    syncErr.textContent = m || '';
    syncErr.hidden = !m;
    syncInput.classList.toggle('is-bad', !!m);
    S.syncErrFor = m ? S.T : undefined;
  }
  function gotoSync(n) {
    const info = pureSolarInfo(model, n);
    if (!info) {
      const r = syncRange(model);
      syncMsg(`Sync ${n} is not entirely inside the catalogue (syncs ${r.first} … ${r.last})`);
      return;
    }
    syncMsg('');
    S.sync = { fromEdit: true, n };
    setT(landCycleAt(model, info.start, 6), 'sync');
    S.sync = { fromEdit: true, n };
  }
  let syncDirty = false;
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
    syncMsg(p.error && /Too large/.test(p.error) ? p.error : '');
    if (!p.error && pureSolarInfo(model, p.n)) gotoSync(p.n);
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
  function stepSync(dir) {
    const cur = S.sync.n ?? syncShown;
    if (cur !== null && cur !== undefined) gotoSync(cur + dir);
  }
  syncDec.addEventListener('click', () => stepSync(-1));
  syncInc.addEventListener('click', () => stepSync(1));

  // ---- header controls
  const status = h('span.cal-status');
  const pinBtn = h('button.btn.btn-sm.cal-pin', { type: 'button', 'aria-pressed': 'false', html: ICONS.pin + '<span>Pin</span>', title: 'Freeze the converter on this moment so it can be studied' });
  pinBtn.addEventListener('click', () => {
    S.pinned = !S.pinned;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
  });
  const useBtn = h('button.btn.btn-sm', { type: 'button', html: ICONS.refresh + '<span>Use shown moment</span>', title: 'Load the shown moment into the converter' });
  useBtn.addEventListener('click', () => {
    S.T = r3(store.t());
    S.addr.fromEdit = false;
    S.sync.fromEdit = false;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
  });
  const applyBtn = h('button.btn.btn-sm.cal-apply', { type: 'button', html: ICONS.target + '<span>Apply</span>', title: 'Navigate the whole app to this moment' });
  applyBtn.addEventListener('click', () => {
    if (!model.inRange(S.T)) return ctx.toast(`Outside the catalogue (${catalogue()})`);
    ctx.goto(S.T);
    S.pinned = false;
    S.addr.fromEdit = false;
    S.sync.fromEdit = false;
    S.dirty = true;
    S.force = true;
    ctx.requestRender();
    ctx.toast('Applied: the app now shows ' + pure.stamp(S.T, 'eta'));
  });
  const linkBtn = h('button.btn.btn-sm.btn-icon', { type: 'button', html: ICONS.link, title: 'Copy a link to this moment', 'aria-label': 'Copy a link to this moment' });
  linkBtn.addEventListener('click', async () => {
    const u = new URL(location.href);
    u.search = pureShareQuery(model, S.T, { view: 'calendar' });
    u.hash = '';
    const ok = await copyText(u.toString());
    ctx.toast(ok ? 'Link to this moment copied' : u.toString());
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
  const momentPanel = h(
    'div.cal-panel.cal-greg.cal-pc-moment',
    null,
    h('h3.cal-ph', null, h('span', { text: 'Moment' }), h('span.cal-ph-sub', { text: 'in cycles' })),
    readout,
    fStamp.el,
    section('Date', null, h('p.cal-help', { text: 'Edit an entry: the moment moves by whole units of it, so what is finer keeps its place. A major period ends its Peak, Node, Valley and End quarters at its thresholds. Press ? for the glossary.' }), majorRow, clockRow),
    section('Saros 141 around this moment', null, ctxBox),
  );
  let syncCopyText = '';
  const syncCopy = copyButton(() => syncCopyText, 'solar sync summary');
  const glyphCopy = copyButton(() =>
    levelRows(model, S.T)
      .map((r, L) => (!r ? `depth ${L + 1} ${LETTERS[L]}: outside the catalogue` : L <= 3 ? `depth ${L + 1} ${LETTERS[L]}: ${pure.majorText(S.T, L)}` : `depth ${L + 1} ${LETTERS[L]}: pair ${pure.pairText(r.phase)} (coarse glyph ${r.index}/${r.states}, ${stateMeaning(model, r.index).text})`))
      .join('\n'),
  'the phase at every depth');
  const pointId = uid('pt');
  pointSel.id = pointId;
  const cyclesPanel = h(
    'div.cal-panel.cal-frac',
    null,
    h('h3.cal-ph', null, h('span', { text: 'Cycles' }), h('span.cal-ph-sub', { text: 'eclipse-anchored' })),
    oor,
    section('Position', null, h('div.cal-poscols', null, fOrd.el, h('span.cal-plus', { text: '+', 'aria-hidden': 'true' }), fFrac.el), fExact.el, posNote),
    section(
      'Cycle address',
      h('div.cal-rtools', null, addrCopy, addrGo),
      h('div.cal-lab', { text: 'Depth' }),
      depthBar,
      h('div.cal-hint', { text: 'Solid outline: the depth of this address · dashed: the level selected in the other views' }),
      h('div.cal-chainwrap', null, chainBox),
      h('div.cal-pointrow', null, h('label.cal-lab', { text: 'Point in the cycle', for: pointId }), pointSel),
      addrResult,
    ),
    section(
      'Phase at every depth',
      glyphCopy,
      h('p.cal-help', { text: 'Alpha, Beta, Gamma and Delta say the quarter they are in (Peak, Node, Valley, End). Every finer depth shows its phase as two glyphs, 16 × 16 = 256 states: click a pair to see when its depth shows any other.' }),
      glyphGrid,
      picker,
    ),
    section('Solar sync', syncCopy, h('div.cal-syncrow', null, h('span.cal-lab', { text: 'Sync number' }), h('div.cal-sbox', null, syncDec, syncInput, syncInc)), syncErr, syncBody),
  );

  const el = h(
    'section.card.cal-conv.cal-pconv',
    { 'aria-label': 'Converter between Fractonica forms' },
    h('header.card-h.cal-conv-h', null, h('h2', { text: 'Converter' }), status, h('span.spacer'), h('div.cal-actions', null, pinBtn, useBtn, applyBtn, hearBtn, linkBtn)),
    h('div.card-b.cal-conv-wrap', null, h('div.cal-conv-body', null, momentPanel, h('div.cal-bridge', { 'aria-hidden': 'true', html: ICONS.swap }), cyclesPanel)),
  );

  // ------------------------------------------------------------------------------------------
  // painting
  // ------------------------------------------------------------------------------------------
  /** The Helion reading: its number (from 1) and its phase pair, then the Preons, Flavons and Blinks (the basic reading, SPEC §15.3). */
  const clockHtml = (c, T) => {
    const helion = model.levelAt(T, 6);
    // the reading leads with its Pentad, like a weekday (SPEC §15.3): "⬠II 34η ‹pair› 29ι 21λ 3ν"
    const clock = `<span class="pure-clock"><b>${c.eta}</b><i>η</i>${helion ? pure.pairHTML(helion.phase, { label: 'Helion phase' }) : ''}<b>${c.iota}</b><i>ι</i><b>${c.lambda}</b><i>λ</i><b>${c.nu}</b><i>ν</i></span>`;
    return leadHTML(model, T, clock, { p: pentadAt(T), title: true });
  };

  function paint() {
    const T = S.T;
    const inRange = model.inRange(T);
    toggleClass(pinBtn, 'is-on', S.pinned);
    setAttr(pinBtn, 'aria-pressed', String(S.pinned));
    setHtml(pinBtn, ICONS.pin + `<span>${S.pinned ? 'Pinned' : 'Pin'}</span>`);
    useBtn.disabled = !S.pinned;
    applyBtn.disabled = !inRange;
    hearBtn.disabled = !inRange;
    paintStatus();

    const cs = inRange ? countersAt(pure, T) : null;
    // the readout
    setHtml(readClock, cs ? clockHtml(cs, T) : '<span class="dim">—</span>');
    setText(readDate, cs ? leadText(model, T, pure.dateText(T, { form: 'full', upTo: 'nu' }), { p: pentadAt(T) }) : '—');
    const ff = S.forceFields;
    S.forceFields = false;
    fStamp.set(cs ? stampOf(T) : '', ff);
    for (const c of counters) {
      c.value = cs ? cs[c.spec.key] : c.spec.min;
      if (document.activeElement !== c.input) {
        const v = cs ? String(c.value) : '';
        if (c.input.value !== v) c.input.value = v;
        c.msg('');
      }
      c.input.disabled = !cs;
    }
    for (const m of majors) {
      m.value = cs ? cs[m.spec.key] : 1;
      if (document.activeElement !== m.sel && cs && m.sel.value !== String(m.value)) m.sel.value = String(m.value);
      m.sel.disabled = !cs;
      setText(m.quarter, cs ? cs.quarter[m.spec.key] : '—');
      setAttr(m.quarter, 'title', cs ? `${pure.periodName(m.spec.level, m.value)} is in its ${cs.quarter[m.spec.key]} quarter (the one that ends at its ${cs.quarter[m.spec.key].toLowerCase()})` : null);
    }
    paintEclipses(T, inRange);

    toggleClass(cyclesPanel, 'is-out', !inRange);
    if (!inRange) {
      oor.hidden = false;
      const before = T < model.tMin;
      setHtml(oorText, `<b>Outside the Saros 141 catalogue.</b> This moment lies ${before ? 'before the first' : 'after the last'} cycle of ${esc(catalogue())}; nothing is extrapolated. `);
      oorBtn.__edge = before ? model.tMin : model.tMax;
      setText(oorBtn, `Use the ${before ? 'first' : 'last'} moment (${pure.shortName(0, before ? 1 : Number(model.clock.count(0)))})`);
      setHtml(readNames, '');
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
    fOrd.set(String(pos.k), ff);
    fFrac.set(pos.fraction, ff);
    fExact.set(pos.exact, ff);
    posNote.hidden = false;
    setText(posChip, `eclipse ${pure.eclipseName(pos.k)} + ${pos.fraction}`);
    setAttr(posChip, 'title', 'The eclipse at or just before this moment (numbered from 0, like the position) and how far past it the moment is');
    setText(posOfChip, `of ${pos.extent}`);
    setAttr(posOfChip, 'title', `${pos.extent} Saros intervals in the catalogue`);

    const rows = levelRows(model, T);
    lastRows = rows;
    paintNames(rows);
    paintAddress(rows);
    paintGlyphs(rows);
    paintSolar(T);
    pickerPaint(rows);
  }

  /** The major periods in words with their quarter, then the Nuclide (the minor part is the clock above). */
  function paintNames(rows) {
    const major = rows.slice(0, 4).map((r, L) => `<span class="cal-pc-name" style="--lv:${levelColor(L)}" title="${esc(unitTip(L))}"><i>${LETTERS[L]}</i>${esc(pure.majorText(S.T, L))}</span>`);
    const eps = rows[4] ? `<span class="cal-pc-name" style="--lv:${levelColor(4)}" title="${esc(unitTip(4))}"><i>ε</i>Nuclide ${esc(pure.cycleName(4, rows[4].cycle))}</span>` : '';
    setHtml(readNames, major.join('') + eps);
  }

  const clockMoves = () => store.mode === 'live' || store.playing;
  function paintStatus() {
    if (S.pinned) {
      const d = S.T - store.t();
      const rel = Math.abs(d) < 0.5 ? 'equals the shown moment' : `${spanText(model, pure, Math.min(S.T, store.t()), Math.max(S.T, store.t()))} ${d > 0 ? 'after' : 'before'} the shown moment`;
      setHtml(status, `<span class="cal-dot is-pin"></span>Pinned · ${esc(rel)}`);
    } else {
      setHtml(status, `<span class="cal-dot ${clockMoves() ? 'is-live' : 'is-still'}"></span>Following the shown moment`);
    }
    toggleClass(status, 'is-pin', S.pinned);
  }

  function paintEclipses(T, inRange) {
    if (!inRange) {
      setHtml(ctxBox, '<div class="cal-erow is-none"><span class="dim">Outside the catalogue</span></div>');
      return;
    }
    const c = pureEclipseContext(model, pure, T);
    const mk = (e, dir) => {
      if (!e) return `<div class="cal-erow is-none"><span class="dim">${dir > 0 ? 'No later eclipse in the catalogue' : 'No earlier eclipse in the catalogue'}</span></div>`;
      const lead = e.exact ? '<b>At</b>' : `<b>${esc(e.text)} ${dir > 0 ? 'before' : 'after'}</b>`;
      return (
        `<div class="cal-erow"><span class="cal-earrow" aria-hidden="true">${dir > 0 ? '▸' : '◂'}</span>` +
        `<span class="cal-etxt">${lead} eclipse <span class="mono">${esc(e.name)}</span></span>` +
        `<button type="button" class="cal-go" data-k="${e.k}" title="Go to eclipse ${esc(e.name)}" aria-label="Go to eclipse number ${e.k}">${ICONS.go}</button></div>`
      );
    };
    setHtml(ctxBox, mk(c.prev, -1) + mk(c.next, 1));
  }

  function paintAddress(rows) {
    for (let d = 1; d <= MAX_DEPTH; d++) {
      const b = depthBtns[d - 1];
      setAttr(b, 'aria-pressed', String(d === S.depth));
      toggleClass(b, 'is-sel', store.state.selectedLevel === d - 1);
    }
    pointSel.value = S.point;
    if (!rows) {
      for (const s of steppers) s.el.hidden = true;
      placeEl.hidden = true;
      setHtml(addrResult, '');
      addrTimeNow = null;
      addrTextNow = '';
      addrGo.disabled = true;
      addrCopy.disabled = true;
      return;
    }
    if (!S.addr.fromEdit || S.addr.path.length < S.depth) {
      S.addr.path = rows.slice(0, S.depth).map((r) => r.local);
      S.addr.fromEdit = false;
      S.addr.phaseRef = rows[S.depth - 1].phase;
    } else S.addr.path = S.addr.path.slice(0, S.depth);
    const path = S.addr.path;
    for (let L = 0; L < steppers.length; L++) {
      const s = steppers[L];
      s.el.hidden = L >= S.depth;
      if (L >= S.depth) continue;
      const max = childCount(model, path.slice(0, L));
      const nominal = nominalCount(model, path.slice(0, L));
      s.max = max;
      s.nominal = nominal;
      s.value = path[L];
      s.shown = String(path[L]);
      if (document.activeElement !== s.input && s.input.value !== s.shown) s.input.value = s.shown;
      setText(s.ofTxt, L <= 3 && ORDINAL_NAMES[path[L]] ? ORDINAL_NAMES[path[L]] : `/ ${nominal}`);
      const clipped = max < nominal;
      setText(s.ofNote, clipped ? `catalogue ends after ${max}` : '');
      if (s.ofNote.hidden === clipped) s.ofNote.hidden = !clipped;
      setAttr(s.of, 'title', clipped ? `The catalogue ends after ${max} of these ${nominal}` : `${path[L]} of ${nominal}`);
      if (document.activeElement !== s.input) s.msg('');
      setAttr(s.input, 'aria-label', `${stepWord(L)} number, 1 to ${max}${clipped ? ` of ${nominal}: the catalogue ends after ${max}` : ''}`);
    }
    const level = S.depth - 1;
    const cyc = cycleOfPath(model, path);
    // a cycle finer than the Nuclide: its place in the Nuclide ("34η 28ι"), stepped one cycle of its depth at a time
    placeEl.hidden = level < 5 || !cyc;
    if (level >= 5 && cyc) {
      setText(placeLab, `${LETTERS[level]}`);
      setAttr(placeLab, 'title', unitTip(level));
      setText(placeTxt, pure.cycleName(level, cyc.idx, { short: true }));
      setStyle(placeEl, '--lv', levelColor(level));
    }
    const pt = PURE_POINTS.find((p) => p.id === S.point);
    const t0 = cyc ? pointTime(model, path, S.point, S.addr.phaseRef) : null;
    addrTimeNow = t0 === null ? null : landPath(model, path, S.point, S.addr.phaseRef);
    // a major period has no phase to show: "the same point of its quarter" instead of a glyph pair
    const label = S.point === 'phase' ? (level <= 3 ? 'Same place in the cycle as this moment, of' : `Same phase (${esc(pure.pairText(S.addr.phaseRef))}) of`) : `${pt.label} of`;
    // letters for the numbered levels, then the place of a finer cycle in its Nuclide
    const chain = level >= 5 && cyc ? `${chainText(path.slice(0, 5))} › ${pure.cycleName(level, cyc.idx, { short: true })}` : chainText(path);
    const names = [...path.slice(0, 4).map((n, L) => pure.periodName(L, n)), ...(level >= 4 && cyc ? [pure.cycleName(level, cyc.idx)] : [])].join(' › ');
    if (t0 === null) {
      setHtml(addrResult, `<div class="cal-rline"><span class="cal-rlab">${label} ${esc(chain)}</span><span class="dim">lies beyond the end of the catalogue (clipped last cycle)</span></div>`);
      addrTextNow = '';
    } else {
      const pos = model.positionOf(addrTimeNow);
      const made = madeOf(model, pure, level);
      const lasts = made || cyc?.clipped ? `<span class="chip cal-chip" style="--lv:${levelColor(level)}">${level <= 3 ? LEVEL_NAMES[level] : LETTERS[level]} lasts ${esc(made || '1' + LETTERS[level])}${cyc?.clipped ? ' (clipped)' : ''}</span>` : '';
      const words = pure.dateText(addrTimeNow, { upTo: level <= 3 ? 'delta' : pure.resolutionOf(level) });
      setHtml(
        addrResult,
        `<div class="cal-rline"><span class="cal-rlab">${label} <b style="color:${levelColor(level)}">${esc(chain)}</b></span></div>` +
          `<div class="cal-rnames">${esc(names)}</div>` +
          `<div class="cal-rtime mono">${leadHTML(model, addrTimeNow, esc(stampOf(addrTimeNow)), { p: pentadAt(addrTimeNow) })}</div>` +
          `<div class="cal-rnames">${esc(leadText(model, addrTimeNow, words, { p: pentadAt(addrTimeNow) }))}</div>` +
          `<div class="cal-rpos mono dim">pos ${pos === null ? '–' : pos.toFixed(12)}</div>` +
          `<div class="cal-rmeta">${lasts}<span class="chip cal-chip" title="0-based index among all cycles of depth ${level + 1} in the catalogue (the jump box reads it as d${level + 1}#${cyc ? cyc.idx : ''})">global index ${cyc ? cyc.idx : '–'}</span></div>`,
      );
      addrTextNow = `${chain} ${pt.label.toLowerCase()} · ${leadText(model, addrTimeNow, stampOf(addrTimeNow), { p: pentadAt(addrTimeNow) })} · pos ${pos === null ? '–' : pos.toFixed(12)}`;
    }
    addrGo.disabled = addrTimeNow === null;
    addrCopy.disabled = addrTextNow === '';
  }

  function paintGlyphs(rows) {
    for (let L = 0; L < MAX_DEPTH; L++) {
      const c = glyphCells[L];
      const r = rows?.[L];
      toggleClass(c.el, 'is-sel', store.state.selectedLevel === L);
      toggleClass(c.el, 'is-open', S.pick.level === L);
      setAttr(c.el, 'aria-expanded', String(S.pick.level === L));
      if (!r) {
        setHtml(c.pairBox, '');
        setText(c.nm, `${LETTERS[L]} · depth ${L + 1}`);
        setText(c.st, '–');
        setText(c.mean, 'outside the catalogue');
        setStyle(c.bar.parentElement, '--p', '0%');
        continue;
      }
      if (L <= 3) {
        // a major period: its quarter word, never a phase (no pair, no bar)
        const q = Math.min(3, Math.floor(r.phase * 4));
        setHtml(c.pairBox, `<span class="cal-gq">${QUARTER_WORDS[q].slice(0, 1)}</span>`);
        setText(c.nm, `${LEVEL_NAMES[L]} · depth ${L + 1}`);
        setText(c.st, QUARTER_WORDS[q]);
        setText(c.mean, `${pure.periodName(L, r.local)}, quarter ${q + 1} of 4`);
        toggleClass(c.el, 'is-major', true);
        setAttr(c.el, 'aria-label', `Depth ${L + 1}: ${pure.majorText(S.T, L)}, the quarter that ends at its ${QUARTER_WORDS[q].toLowerCase()}`);
        continue;
      }
      const m = stateMeaning(model, r.index);
      setHtml(c.pairBox, pure.pairHTML(r.phase, { label: `${LETTERS[L]} phase` }));
      setText(c.nm, `${LETTERS[L]} · depth ${L + 1}`);
      setText(c.st, pure.pairText(r.phase));
      setText(c.mean, `${m.text} ${m.arrow}`);
      setStyle(c.bar.parentElement, '--p', (Math.min(0.999, r.phase) * 100).toFixed(2) + '%');
      setAttr(c.el, 'aria-label', `Depth ${L + 1}, ${LETTERS[L]}: glyph pair ${pure.pairText(r.phase)} of 256, coarse glyph ${m.text}. Opens a list of other moments this pair shows.`);
    }
  }

  /** Countdown spans (data-cd = target moment) follow the converter's moment without rewriting their row. */
  function tickCountdowns(root) {
    for (const sp of root.querySelectorAll('[data-cd]')) setText(sp, relTo(Number(sp.dataset.cd)) + (sp.dataset.sfx ?? ''));
  }
  // (a boundary's float time can sit a hair either side of it: the stamp is read at the first millisecond that shows it)
  const landedT = (t, level) => (level === undefined ? Math.ceil(t * 1000) / 1000 : landCycleAt(model, t, level));
  /** A row of a moment: its date led by its Pentad (the copy carries the Pentad's name, which the jump box reads past). */
  const timeRow = (kind, t, dur, { copyText: ct, goT, what, upTo = 'lambda', level, lead = true }) =>
    `<div class="cal-trow"><span class="cal-tk">${kind}</span><span class="cal-tt mono">${lead ? leadHTML(model, landedT(t, level), esc(pure.stamp(landedT(t, level), upTo)), { p: pentadAt(landedT(t, level)) }) : esc(pure.stamp(landedT(t, level), upTo))}</span>` +
    `<span class="cal-tx dim" data-cd="${t}"${dur ? ` data-sfx="${esc(' · lasts ' + dur)}"` : ''}></span>` +
    `<button type="button" class="cal-copy" data-c="${esc(leadText(model, goT, ct, { p: pentadAt(goT) }))}" title="Copy the date" aria-label="Copy ${esc(what)}">${ICONS.copy}</button>` +
    `<button type="button" class="cal-go" data-t="${goT}" title="Go there" aria-label="Go to ${esc(what)}">${ICONS.go}</button></div>`;

  function pickerResultsHtml(L, digits, cur) {
    const label = digits.join('·');
    const meaning = digits.length === 1 ? stateMeaning(model, digits[0]) : null;
    const showsNow = digits.length === 1 ? digits[0] === cur.index : model.odometerAt(S.T, L, { strokes: 2, digits: 2 })?.digits.join() === digits.join();
    const shows = (c) => model.odometerAt(c, L, { strokes: 2, digits: digits.length })?.digits.join() === digits.join();
    const tc = model.clamp(S.T);
    const find = (direction) => model.stateOccurrences(L, digits, tc, { strokes: 2, direction, count: 3 });
    const row = (o, kind) => {
      const t = firstMs(o.start, shows) ?? Math.ceil(o.start * 1000) / 1000;
      return timeRow(kind, t, pure.duration(o.end - o.start, { at: o.start }), { copyText: stampOf(t), goT: t, what: stampOf(t) });
    };
    const next = find(1);
    const prev = find(-1);
    let html = `<div class="cal-pick-t">${LETTERS[L]} shows <b class="mono">${esc(label)}</b>${digits.length === 1 ? ` of 16 · ${esc(meaning.text)} ${meaning.arrow}` : ' of 256'}${showsNow ? ' <span class="chip cal-chip is-info">showing now</span>' : ''}</div>`;
    html += '<div class="cal-pick-cols">';
    html += `<div><h5>Next 3</h5>${next.length ? next.map((o) => row(o, 'next')).join('') : '<div class="dim cal-none">none before the catalogue ends</div>'}</div>`;
    html += `<div><h5>Previous 3</h5>${prev.length ? prev.map((o) => row(o, 'prev')).join('') : '<div class="dim cal-none">none after the catalogue starts</div>'}</div>`;
    return html + '</div>';
  }

  function pickerPaint(rows) {
    const L = S.pick.level;
    if (L === null || !rows || !rows[L]) {
      picker.hidden = true;
      return;
    }
    const cur = rows[L];
    const od = model.odometerAt(S.T, L, { strokes: 2, digits: 2 });
    const first = S.pick.index ?? cur.index;
    const second = S.pick.index2;
    picker.hidden = false;
    setStyle(picker, '--lv', levelColor(L));
    setText(pickTitle, `${LETTERS[L]} · depth ${L + 1}`);
    for (let i = 0; i < 16; i++) {
      const { b, m } = pickStates[i];
      toggleClass(b, 'is-on', i === first);
      toggleClass(b, 'is-now', i === cur.index);
      setAttr(b, 'aria-pressed', String(i === first));
      setAttr(b, 'title', `Coarse glyph ${i}: ${m.text}${i === cur.index ? ' (showing now)' : ''}`);
    }
    toggleClass(anyBtn, 'is-on', second === null);
    setAttr(anyBtn, 'aria-pressed', String(second === null));
    for (let j = 0; j < 16; j++) {
      const { b, m } = pickStates2[j];
      toggleClass(b, 'is-on', second === j);
      toggleClass(b, 'is-now', !!od && od.digits[0] === first && od.digits[1] === j);
      setAttr(b, 'aria-pressed', String(second === j));
      setAttr(b, 'title', `Fine glyph ${j}: ${m.text}`);
    }
    const digits = second === null ? [first] : [first, second];
    const key = `${L}|${digits.join(',')}`;
    const nowMs = performance.now();
    if (pickRes.__key !== key || (S.T !== pickRes.__T && (S.pinned || nowMs - pickRes.__at >= 1000))) {
      pickRes.__key = key;
      pickRes.__T = S.T;
      pickRes.__at = nowMs;
      setHtml(pickRes, pickerResultsHtml(L, digits, cur));
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
      if (st.dataset.i !== undefined) S.pick.index = Number(st.dataset.i);
      else if (st.dataset.j !== undefined) S.pick.index2 = st.dataset.j === 'any' ? null : Number(st.dataset.j);
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

  /** The sync rows are static for one sync number: built once, only the countdowns and the phase pair tick. */
  function syncSkeleton(n, info) {
    const driftTxt = pure.driftText(info.sol);
    const row = (lab, t, level) => timeRow(lab, t, null, { copyText: pure.stamp(landedT(t, level), 'iota'), goT: landedT(t, level), what: `${lab} of sync ${n}`, upTo: 'iota', level });
    let html = '<div class="cal-phase cal-pphase" title="Where this moment sits inside the sync" hidden><i></i><span class="cal-pphase-pair"></span></div>';
    html += row('start', info.start, 6) + row('end', info.end, 6);
    html += `<div class="cal-kv"><span class="cal-k">Length</span><span class="mono">19η</span><span class="dim">19 Helions</span></div>`;
    html += `<div class="cal-kv"><span class="cal-k">Drift</span><span class="mono" style="color:var(--gold)">${esc(driftTxt)}</span><span class="dim">start against the solar rhythm</span></div>`;
    html += '<div class="cal-qh">Quarter thresholds</div>';
    for (const q of info.quarters) html += row(q.name, q.time, q.name === 'end' ? 6 : undefined);
    // the Pentads: the sync's 19 Helions as I, II, III (5η) and the Hypopentad (4η), each about a solar day (SPEC §7.5)
    const pents = syncPentads(model, n);
    html += `<div class="cal-qh">Pentads</div><p class="cal-help cal-pnote">The sun comes back to the same place in the sky every ${DAY_TEXT}, so each Pentad begins ${QUARTER_TEXT} later against the sun than the one before (${OFFSET_TEXT.join(', ')}); the Hypopentad, one Helion short, brings Pentad I back.</p>`;
    for (const p of pents) {
      const t = landedT(p.start, 6);
      html += `<div class="cal-prow-w" data-pq="${p.index}">` + timeRow(pentadMarkHTML(p.index), p.start, `${p.helions}η`, { copyText: pure.stamp(t, 'iota'), goT: t, what: `${PENTAD_NAMES[p.index]} of sync ${n}`, upTo: 'iota', level: 6, lead: false }) + '</div>';
    }
    return { html, copy: `Solar sync ${n}: ${pure.stamp(landedT(info.start, 6), 'iota')} → ${pure.stamp(landedT(info.end, 6), 'iota')}; drift ${driftTxt}; length 19η; Pentads ${pents.map((p) => `${PENTAD_NAMES[p.index]} ${p.helions}η`).join(', ')}` };
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
    if (S.syncErrFor !== undefined && S.syncErrFor !== T) syncMsg('');
    const at = safeSolarAt(model, T);
    let n;
    if (S.sync.fromEdit && S.sync.n !== null) n = S.sync.n;
    else n = at ? at.sync : null;
    if (n === null) {
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
        `<div class="cal-oor is-soft">This moment lies in the half-sync at the edge of the catalogue; solar syncs need a full run of 19η inside it.` +
          `<button type="button" class="btn btn-sm" data-sync="${first ? r.first : r.last}">Go to the ${first ? 'first' : 'last'} full sync (${first ? r.first : r.last})</button></div>`,
      );
      return;
    }
    syncShown = n;
    S.sync.n = S.sync.fromEdit ? S.sync.n : n;
    syncDec.disabled = syncInc.disabled = false;
    if (document.activeElement !== syncInput && syncInput.value !== String(n)) syncInput.value = String(n);
    const key = String(n);
    if (!syncBody.__sk || syncBody.__sk.key !== key) {
      const info = pureSolarInfo(model, n);
      syncBody.__sk = info ? { key, ...syncSkeleton(n, info) } : { key, html: '', copy: '' };
    }
    const sk = syncBody.__sk;
    syncCopyText = sk.copy;
    syncCopy.disabled = sk.copy === '';
    const wrote = syncBody.__html !== sk.html;
    setHtml(syncBody, sk.html);
    if (wrote || !syncRefs) {
      const ph = syncBody.querySelector('.cal-phase');
      syncRefs = ph ? { ph, pair: ph.querySelector('.cal-pphase-pair') } : {};
    }
    if (syncRefs.ph) {
      const phase = at && at.sync === n ? at.phase : null;
      if (syncRefs.ph.hidden !== (phase === null)) syncRefs.ph.hidden = phase === null;
      if (phase !== null) {
        setStyle(syncRefs.ph, '--p', (Math.min(0.999, phase) * 100).toFixed(2) + '%');
        setHtml(syncRefs.pair, pure.pairHTML(phase, { label: 'sync phase', color: GOLD }));
      }
    }
    const pn = pentadAt(T);
    const pq = pn && pn.sync === n ? String(pn.index) : '';
    for (const r of syncBody.querySelectorAll('.cal-prow-w')) toggleClass(r, 'is-now', r.dataset.pq === pq);
    tickCountdowns(syncBody);
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
      S.force = true; // (a converter that was hidden repaints from scratch when it is shown again)
    },
    get time() {
      return S.T;
    },
    render(frame) {
      const now = performance.now();
      if (hearBtn.hidden === hasSound(ctx)) hearBtn.hidden = !hasSound(ctx);
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
        paintStatus();
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
