/**
 * The diary options form: every knob of DIARY_DEFAULTS in compact groups (<details>), bound by dotted paths.
 *
 *   const form = createForm({ onChange(path, value, {typing}), onReset(), onCopy(), onToggleGroup(key, open) });
 *   form.sync({ opts, pureMode, appZone, shape, plan })   // writes the values (never into the focused field)
 *
 * The form shows the EFFECTIVE options (sanitized for the current mode); edits go back to the caller by path and
 * the caller sanitizes. Lists (lock sheets, canvases) are rebuilt only when their shape changes, so typing in a row
 * keeps its focus. Pure mode hides every Gregorian control and words nothing in Earth units.
 */
import { PAGE_SIZES, CANVAS_TYPES, lockShape } from '../../diary/options.js';
import { zonePlace } from '../../diary/places.js';
import { h, ICONS, setText, setAttr } from './dom.js';
import { getIn, lockReadout, paperLabel, twoUpLabel, pairingWords, mm } from './logic.js';

const SIZES = [...Object.keys(PAGE_SIZES), 'custom'];
const CANVAS_LABEL = { grid: 'Square grid', dots: 'Scattered dots', 'dot-grid': 'Dot grid', lined: 'Lined', blank: 'Blank', 'nuclide-grid': 'Nuclide grid 7 × 11' };
const MAX_SHEETS = 8;
const MAX_CANVASES = 8;

let uid = 0;
/** 55.7558 -> "55.7558° N" */
const fmtDeg = (v, pos, neg) => `${Math.abs(v)}° ${v < 0 ? neg : pos}`;
const nextId = (p) => `dy-${p}-${++uid}`;

export function createForm({ onChange, onReset, onCopy, onToggleGroup, open = [], pure, zones = [] }) {
  let opts = null;
  let pureMode = false;
  let appZone = 'UTC';
  const dyn = []; // () => void: dynamic texts refreshed on every sync
  const modeHooks = []; // (pureMode) => void: mode-dependent labels and visibility

  const root = h('div.dy-form');
  const groups = h('div.dy-groups');
  root.append(groups);

  // ---------------------------------------------------------------------------------------------
  // controls
  // ---------------------------------------------------------------------------------------------
  const bindAttrs = (el, path) => {
    el.dataset.path = path;
    return el;
  };
  function field(label, control, { hint, cls = '' } = {}) {
    const id = control.id || (control.id = nextId('f'));
    const lab = h('label.dy-lbl', { for: id, text: label });
    const wrap = h(`div.dy-field${cls ? '.' + cls : ''}`, null, lab, control);
    if (hint) wrap.append(hint);
    return wrap;
  }
  function checkbox(path, label, { hint } = {}) {
    const input = bindAttrs(h('input', { type: 'checkbox', dataset: { kind: 'check' } }), path);
    input.addEventListener('change', () => onChange(path, input.checked));
    const text = h('span.dy-ctext', { text: typeof label === 'function' ? '' : label });
    if (typeof label === 'function') modeHooks.push((p) => (text.textContent = label(p)));
    const row = h('label.dy-check', null, input, h('span.dy-cbody', null, text, hint ? h('small.dy-hint', { text: '' }) : null));
    if (hint) {
      const small = row.querySelector('.dy-hint');
      if (typeof hint === 'function') modeHooks.push((p) => (small.textContent = hint(p)));
      else small.textContent = hint;
    }
    return row;
  }
  function number(path, label, { min, max, step = 1, hint, unit } = {}) {
    const input = bindAttrs(
      h('input.input.dy-num', { type: 'number', min, max, step, inputmode: step < 1 ? 'decimal' : 'numeric', dataset: { kind: 'number' } }),
      path,
    );
    const read = () => {
      const v = input.valueAsNumber;
      return Number.isFinite(v) ? v : null;
    };
    input.addEventListener('input', () => {
      const v = read();
      if (v !== null) onChange(path, v, { typing: true });
    });
    input.addEventListener('change', () => {
      const v = read();
      onChange(path, v ?? getIn(opts, path));
      input.value = String(getIn(opts, path)); // show the clamped value
    });
    const f = field(unit ? `${label} (${unit})` : label, input, { hint });
    if (unit) {
      const box = h('span.dy-unit');
      input.replaceWith(box);
      box.append(input, h('span.dy-u', { text: unit, 'aria-hidden': 'true' }));
      f.querySelector('label').textContent = label;
      input.setAttribute('aria-label', `${label} in ${unit === 'mm' ? 'millimetres' : unit}`);
    }
    return f;
  }
  function select(path, label, options, { hint } = {}) {
    const sel = bindAttrs(h('select.select.dy-sel', { dataset: { kind: 'select' } }), path);
    const fill = (p) => {
      const list = typeof options === 'function' ? options(p) : options;
      sel.textContent = '';
      for (const [v, text] of list) sel.append(h('option', { value: v, text }));
      if (opts) sel.value = displayValue(path, getIn(opts, path));
    };
    if (typeof options === 'function') modeHooks.push(fill);
    else fill(false);
    sel.addEventListener('change', () => onChange(path, parseSelect(path, sel.value)));
    sel.__fill = fill;
    return field(label, sel, { hint });
  }
  function seg(path, label, options) {
    const id = nextId('s');
    const box = h('div.seg.dy-seg', { role: 'group', 'aria-labelledby': id, dataset: { path, kind: 'seg' } });
    for (const [v, text] of options) {
      const b = h('button', { type: 'button', text, 'aria-pressed': 'false', dataset: { v } });
      b.addEventListener('click', () => onChange(path, v));
      box.append(b);
    }
    return h('div.dy-field', null, h('span.dy-lbl', { id, text: label }), box);
  }
  const hintEl = (fn) => {
    const el = h('small.dy-hint');
    dyn.push(() => setText(el, fn()));
    return el;
  };
  /** Pure mode shows the Preon labels for 'both' (it has no Gregorian time to add). */
  const displayValue = (path, v) => (path === 'lined.labels' && pureMode && v === 'both' ? 'preon' : v === null ? '' : String(v));
  const parseSelect = (path, v) => (path === 'gregorian.zone' ? v || null : v);

  function group(key, title, ...children) {
    const sum = h('span.dy-sumv');
    const det = h('details.dy-grp', { dataset: { key } }, h('summary', null, h('span.dy-gt', { text: title }), sum), h('div.dy-gb', null, ...children));
    if (open.includes(key)) det.open = true;
    det.addEventListener('toggle', () => onToggleGroup?.(key, det.open));
    groups.append(det);
    det.__sum = sum;
    return det;
  }
  const summaries = {};

  // ---------------------------------------------------------------------------------------------
  // groups
  // ---------------------------------------------------------------------------------------------
  // Paper ----------------------------------------------------------------------------------------------
  const sizeSel = select('page.size', 'Paper size', (p) => SIZES.map((s) => [s, paperLabel(s, opts?.page, p)]));
  const custom = h('div.dy-row2', null, number('page.width', 'Width', { min: 80, max: 420, step: 0.1, unit: 'mm' }), number('page.height', 'Height', { min: 100, max: 600, step: 0.1, unit: 'mm' }));
  const margins = h(
    'div.dy-row2',
    null,
    number('page.margins.top', 'Top margin', { min: 3, max: 40, step: 0.5, unit: 'mm' }),
    number('page.margins.bottom', 'Bottom margin', { min: 3, max: 40, step: 0.5, unit: 'mm' }),
    number('page.margins.inner', 'Inner margin', { min: 3, max: 50, step: 0.5, unit: 'mm' }),
    number('page.margins.outer', 'Outer margin', { min: 3, max: 50, step: 0.5, unit: 'mm' }),
  );
  const gPaper = group('paper', 'Paper', sizeSel, custom, margins, h('small.dy-note', { text: 'The inner margin is at the binding; the outer margin carries the time ticks.' }));
  summaries.paper = () => paperLabel(opts.page.size, opts.page, pureMode);

  // Gregorian (normal mode only) ---------------------------------------------------------------------
  const zoneSel = select('gregorian.zone', 'Zone', () => [['', `App zone · ${appZone.replace(/_/g, ' ')}`], ['UTC', 'UTC'], ...zones.filter((z) => z !== 'UTC').map((z) => [z, z.replace(/_/g, ' ')])]);
  zoneSel.querySelector('select').classList.add('dy-zone');
  const gGreg = group(
    'gregorian',
    'Gregorian',
    checkbox('gregorian.on', 'Gregorian dates and times', { hint: 'Index, timestamps, the date range of every page' }),
    zoneSel,
    checkbox('gregorian.weekdays', 'Weekday names'),
  );
  summaries.gregorian = () => (opts.gregorian.on ? `On · ${(opts.gregorian.zone ?? appZone).replace(/_/g, ' ')}` : 'Off');

  // Front matter ----------------------------------------------------------------------------------------
  const gIndexRow = checkbox('front.gregorianIndex', 'Gregorian index', { hint: 'Month grids with the page of every day' });
  const gFront = group(
    'front',
    'Front matter',
    checkbox('front.cover', 'Cover page'),
    checkbox('front.index', 'Index', { hint: 'Major thresholds, Nuclides, locks, sections with their pages' }),
    gIndexRow,
    checkbox('front.ephemeris', 'Ephemeris', { hint: 'Every lunar and solar event of the Delta with its page' }),
    checkbox('front.reference', 'Reference sheet', { hint: 'The period ladder of 63 levels; the milestones of Alpha, Beta and Gamma with their eclipses' }),
    h('div.dy-row2', null, number('front.planning', 'Planning pages', { min: 0, max: 12 }), number('front.predictions', 'Prediction pages', { min: 0, max: 12 })),
  );
  summaries.front = () => {
    const f = opts.front;
    const on = [f.cover && 'cover', f.index && 'index', !pureMode && opts.gregorian.on && f.gregorianIndex && 'Gregorian', f.ephemeris && 'ephemeris', f.reference && 'reference'].filter(Boolean);
    const n = f.planning + f.predictions;
    return [on.join(', '), n ? `${n} writing ${n === 1 ? 'page' : 'pages'}` : ''].filter(Boolean).join(' · ') || 'none';
  };

  // Lock pattern -------------------------------------------------------------------------------------------
  const sheetList = h('ol.dy-list.dy-sheets', { 'aria-label': 'Sheets of one lock' });
  const addSheet = h('button.btn.btn-sm.dy-add', { type: 'button', html: `${ICONS.plus}<span>Add sheet</span>` });
  addSheet.addEventListener('click', () => onChange('lock.sheets', [...opts.lock.sheets, [3, 2]]));
  const lockDefault = h('button.btn.btn-sm', { type: 'button', text: 'Default pattern' });
  lockDefault.addEventListener('click', () => onChange('lock.sheets', [[3, 2], [3, 2], [3, 2], [2, 2]]));
  const lockRead = h('p.dy-readout', { 'aria-live': 'polite' });
  const lockSub = h('small.dy-hint');
  const gLock = group(
    'lock',
    'Lock pattern',
    h('p.dy-note', { text: 'A sheet is one leaf: lined Helions on the front, canvas Helions on the back. A solar lock is these sheets (by default three sheets of 5 Helions and a 4-Helion sheet: 19 Helions), counted from the start of the Nuclide; the Helions of a Nuclide (77) that no whole lock takes are its retrospection. Every Helion is also printed with its Pentad, which follows the solar sync instead.' }),
    sheetList,
    h('div.dy-btns', null, addSheet, lockDefault),
    lockRead,
    lockSub,
  );
  summaries.lock = () => opts.lock.sheets.map(([a, b]) => `${a}+${b}`).join(' · ');
  function sheetRow([front, back], i, count) {
    const del = h('button.btn.btn-sm.btn-icon.dy-del', { type: 'button', 'aria-label': `Remove sheet ${i + 1}`, title: `Remove sheet ${i + 1}`, html: ICONS.close });
    if (count <= 1) del.disabled = true;
    del.addEventListener('click', () => onChange('lock.sheets', opts.lock.sheets.filter((_, k) => k !== i)));
    const n = (side, v, max, lbl) => {
      const input = h('input.input.dy-num.dy-mini', { type: 'number', min: side ? 0 : 1, max, step: 1, inputmode: 'numeric', value: String(v), 'aria-label': `Sheet ${i + 1}: ${lbl}`, dataset: { path: `lock.sheets.${i}.${side}`, kind: 'number' } });
      const commit = (typing) => {
        const x = input.valueAsNumber;
        if (!Number.isFinite(x)) return;
        const sheets = opts.lock.sheets.map((s) => [...s]);
        sheets[i][side] = x;
        onChange('lock.sheets', sheets, { typing });
      };
      input.addEventListener('input', () => commit(true));
      input.addEventListener('change', () => {
        commit(false);
        input.value = String(opts.lock.sheets[i]?.[side] ?? v);
      });
      return input;
    };
    return h(
      'li.dy-item',
      null,
      h('span.dy-iname', { text: `Sheet ${i + 1}` }),
      h('span.dy-pair', null, n(0, front, 4, 'lined Helions on the front'), h('span.dy-small', { text: 'front' }), n(1, back, 4, 'canvas Helions on the back'), h('span.dy-small', { text: 'back' })),
      del,
    );
  }

  // Lined pages ---------------------------------------------------------------------------------------------
  const perLine = (lines) => {
    const span = pure.durationPos(pure.cyclePos(6) / lines);
    return `one line per ${span}`;
  };
  const gLined = group(
    'lined',
    'Lined pages',
    number('lined.linesPerHelion', 'Lines per Helion', { min: 1, max: 72, hint: hintEl(() => perLine(opts.lined.linesPerHelion)) }),
    select('lined.labels', 'Line labels', (p) => [['preon', 'Preon counts (0ι 3ι 6ι …)'], ...(p ? [] : [['both', 'Preon counts and Gregorian time']]), ['none', 'None']]),
    checkbox('lined.marginGlyphs', 'Quarter glyphs in the outer margin', { hint: 'Peak, node, valley and end of each Helion' }),
    checkbox('lined.marginCurve', 'Wave curve in the outer margin', { hint: 'The direction of the Helion’s cycle' }),
  );
  summaries.lined = () => `${opts.lined.linesPerHelion} lines per Helion`;

  // Canvases ------------------------------------------------------------------------------------------------
  const canvasList = h('ol.dy-list.dy-canvases', { 'aria-label': 'Canvases of the back pages' });
  const addCanvas = h('button.btn.btn-sm.dy-add', { type: 'button', html: `${ICONS.plus}<span>Add canvas</span>` });
  addCanvas.addEventListener('click', () => onChange('canvases', [...opts.canvases, { ...opts.canvases.at(-1) }]));
  const gCanvas = group('canvases', 'Canvases', h('p.dy-note', { text: 'Used in turn for the canvas Helions of every lock.' }), canvasList, h('div.dy-btns', null, addCanvas));
  summaries.canvases = () => opts.canvases.map(canvasText).join(' · ');

  // the lock's 4-Helion sheet (the options keep their old key, `semi`) ---------------------------------------
  const semiList = h('ol.dy-list.dy-canvases', { 'aria-label': 'Canvases of the 4-Helion sheet' });
  const gSemi = group(
    'semi',
    '4-Helion sheet',
    checkbox('semi.allCanvas', 'All canvases', { hint: 'Its 4 Helions as canvases, 2 on each side, instead of lined front and canvas back' }),
    semiList,
  );
  summaries.semi = () => (opts.semi.allCanvas ? `4 canvases: ${opts.semi.canvases.map(canvasText).join(' · ')}` : 'like the other sheets');

  // Retrospection Helion ---------------------------------------------------------------------------------
  const retroList = h('ol.dy-list.dy-canvases', { 'aria-label': 'Canvas pages of the retrospection Helion' });
  const addRetro = h('button.btn.btn-sm.dy-add', { type: 'button', html: `${ICONS.plus}<span>Add canvas page</span>` });
  addRetro.addEventListener('click', () => onChange('retro.canvases', [...opts.retro.canvases, { ...opts.retro.canvases.at(-1) }]));
  const gRetro = group(
    'retro',
    'Retrospection Helion',
    h('p.dy-note', { text: 'The Helions left over after the locks: one finely lined page each, then one page per canvas.' }),
    number('retro.lines', 'Lines on its page', { min: 1, max: 144, hint: hintEl(() => perLine(opts.retro.lines)) }),
    retroList,
    h('div.dy-btns', null, addRetro),
  );
  summaries.retro = () => `${opts.retro.lines} lines · ${opts.retro.canvases.length} canvas ${opts.retro.canvases.length === 1 ? 'page' : 'pages'}`;

  function canvasText(c) {
    if (c.type === 'grid' || c.type === 'dot-grid') return `${c.type === 'grid' ? 'grid' : 'dot grid'} ${c.cols} × ${c.rows}`;
    if (c.type === 'dots') return `${c.count} dots`;
    if (c.type === 'lined') return `${c.lines} lines`;
    if (c.type === 'nuclide-grid') return 'Nuclide grid';
    return 'blank';
  }
  function canvasRow(base, list, c, i) {
    const name = base === 'canvases' ? `Canvas ${i + 1}` : base === 'semi.canvases' ? `Helion ${i + 1}` : `Page ${i + 1}`;
    const type = h('select.select.dy-sel.dy-ctype', { 'aria-label': `${name}: type`, dataset: { path: `${base}.${i}.type`, kind: 'select' } });
    for (const t of CANVAS_TYPES) type.append(h('option', { value: t, text: CANVAS_LABEL[t] ?? t }));
    type.value = c.type;
    type.addEventListener('change', () => {
      const next = list().map((x) => ({ ...x }));
      next[i] = { type: type.value };
      onChange(base, next);
    });
    const num = (key, lbl, min, max) => {
      const input = h('input.input.dy-num.dy-mini', { type: 'number', min, max, step: 1, inputmode: 'numeric', value: String(c[key]), 'aria-label': `${name}: ${lbl}`, dataset: { path: `${base}.${i}.${key}`, kind: 'number' } });
      const commit = (typing) => {
        const x = input.valueAsNumber;
        if (!Number.isFinite(x)) return;
        const next = list().map((y) => ({ ...y }));
        next[i][key] = x;
        onChange(base, next, { typing });
      };
      input.addEventListener('input', () => commit(true));
      input.addEventListener('change', () => {
        commit(false);
        input.value = String(list()[i]?.[key] ?? c[key]);
      });
      return h('span.dy-numl', null, input, h('span.dy-small', { text: lbl }));
    };
    const params = h('span.dy-params');
    if (c.type === 'grid' || c.type === 'dot-grid') params.append(num('cols', 'columns', 1, 60), num('rows', 'rows', 1, 60));
    else if (c.type === 'dots') params.append(num('count', 'dots', 0, 4000));
    else if (c.type === 'lined') params.append(num('lines', 'lines', 1, 80));
    const del = h('button.btn.btn-sm.btn-icon.dy-del', { type: 'button', 'aria-label': `Remove ${name.toLowerCase()}`, title: `Remove ${name.toLowerCase()}`, html: ICONS.close });
    if (list().length <= 1 || base === 'semi.canvases') del.disabled = true;
    del.addEventListener('click', () => onChange(base, list().filter((_, k) => k !== i)));
    return h('li.dy-item.dy-citem', null, h('span.dy-iname', { text: name }), type, params, del);
  }

  // Inserts and closing ----------------------------------------------------------------------------------
  const gInserts = group(
    'inserts',
    'Inserts and closing',
    checkbox('inserts.deltaQuarters', 'Delta sheets', { hint: 'A sheet before the lock that holds each Delta quarter threshold (Peak, Node, Valley)' }),
    checkbox('inserts.eclipses', 'Eclipse sheets', { hint: 'Two sheets before the Helion of each eclipse: the path map or shadow diagram with its Saros series, then the Helion in detail and a canvas' }),
    number('closing.summaryPages', 'Retrospection and summary pages', { min: 0, max: 16 }),
  );
  summaries.inserts = () => `${opts.inserts.deltaQuarters ? 'Delta sheets' : 'no Delta sheets'} · ${opts.inserts.eclipses ? 'eclipse sheets' : 'no eclipse sheets'} · ${opts.closing.summaryPages} summary ${opts.closing.summaryPages === 1 ? 'page' : 'pages'}`;

  // Events ---------------------------------------------------------------------------------------------------
  const month = (p) => (p ? '' : ' month');
  const EVENT_KEYS = ['synodic', 'anomalistic', 'draconic', 'sidereal', 'quarters', 'solar', 'lunistices', 'crossQuarters', 'eclipses', 'planets', 'solarSync', 'majors'];
  const gEvents = group(
    'events',
    'Events',
    checkbox('events.synodic', (p) => `Lunar phases (synodic${month(p)})`, { hint: 'New moon, first quarter, full moon, last quarter' }),
    checkbox('events.anomalistic', (p) => `Perigee and apogee (anomalistic${month(p)})`),
    checkbox('events.draconic', (p) => `Lunar nodes (draconic${month(p)})`, { hint: 'The Moon crosses the ecliptic northward or southward' }),
    checkbox('events.sidereal', (p) => `Galactic centre (sidereal${month(p)})`, { hint: 'The Moon passes the galactic centre, then its opposite, the anticentre' }),
    checkbox('events.quarters', 'Quarter events', { hint: 'Halfway points: post-perigee, post-apogee, post-node, post-centre, post-anticentre' }),
    checkbox('events.solar', 'Equinoxes, solstices, perihelion, aphelion'),
    checkbox('events.lunistices', 'Lunistices', { hint: 'The Moon farthest north and farthest south' }),
    checkbox('events.crossQuarters', (p) => (p ? 'Cross-quarter points' : 'Cross-quarter days'), { hint: 'Halfway between equinoxes and solstices: 45°, 135°, 225°, 315°' }),
    checkbox('events.eclipses', 'Eclipses', { hint: 'Solar and lunar, with their type' }),
    checkbox('events.planets', 'Planets', { hint: 'Mercury and Venus elongations and conjunctions; Mars, Jupiter, Saturn oppositions and conjunctions' }),
    checkbox('events.solarSync', 'Solar syncs', { hint: 'The start of each sync (19 Helions) as a tick' }),
    checkbox('events.majors', 'Major thresholds', { hint: 'Quarter thresholds of Alpha … Delta as ticks' }),
  );
  summaries.events = () => {
    const n = EVENT_KEYS.filter((k) => opts.events[k]).length;
    return n === EVENT_KEYS.length ? 'all' : n ? `${n} of ${EVENT_KEYS.length}` : 'none';
  };

  // Sky -------------------------------------------------------------------------------------------------------
  const placeInput = bindAttrs(h('input.input.dy-text', { type: 'text', maxlength: 60, placeholder: 'Name (optional)', dataset: { kind: 'text' } }), 'sky.place');
  placeInput.addEventListener('change', () => onChange('sky.place', placeInput.value.trim() || null));
  const zoneCity = () => zonePlace(opts.gregorian.zone ?? appZone);
  const where = hintEl(() => {
    const s = opts.sky;
    if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) return `${s.place ? s.place + ' · ' : ''}${fmtDeg(s.lat, 'N', 'S')}, ${fmtDeg(s.lon, 'E', 'W')}`;
    const z = zoneCity();
    return z ? `${z.place} (the zone’s city) · ${fmtDeg(z.lat, 'N', 'S')}, ${fmtDeg(z.lon, 'E', 'W')}` : 'No place: enter coordinates to draw the sky';
  });
  const locate = h('button.btn.btn-sm', { type: 'button', text: 'Use my location' });
  locate.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    locate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        locate.disabled = false;
        onChange('sky', { ...opts.sky, lat: Math.round(p.coords.latitude * 1e4) / 1e4, lon: Math.round(p.coords.longitude * 1e4) / 1e4, place: opts.sky.place ?? 'Here' });
      },
      () => (locate.disabled = false),
      { timeout: 15000 },
    );
  });
  const zoneBtn = h('button.btn.btn-sm', { type: 'button', text: 'Zone’s city' });
  zoneBtn.addEventListener('click', () => onChange('sky', { ...opts.sky, lat: null, lon: null, place: null }));
  const gSky = group(
    'sky',
    'Sky over the place',
    checkbox('sky.on', 'Solar and lunar altitude', { hint: 'Lined pages: a solar dot on odd lines, a lunar ring on even ones, left below the horizon, right above; rises and sets on the horizon, culminations as squares. Canvases: their paths in the inner margin.' }),
    field('Place', placeInput, { hint: where }),
    h('div.dy-row2', null, number('sky.lat', 'Latitude', { min: -90, max: 90, step: 0.0001, unit: '°N' }), number('sky.lon', 'Longitude', { min: -180, max: 180, step: 0.0001, unit: '°E' })),
    h('div.dy-btns', null, locate, zoneBtn),
    number('sky.dot', 'Mark size', { min: 0.4, max: 3, step: 0.1, unit: 'mm', hint: hintEl(() => 'The diameter of the solar dot and the lunar ring') }),
  );
  summaries.sky = () => {
    if (!opts.sky.on) return 'off';
    const z = Number.isFinite(opts.sky.lat) ? { place: opts.sky.place ?? 'custom place' } : zoneCity();
    return z ? z.place : 'no place';
  };

  // Edge references -----------------------------------------------------------------------------------------
  const gNav = group(
    'nav',
    'Edge references',
    checkbox('nav.on', 'Thumb index on the outer edge', { hint: 'Each page points to the previous and next page of its kind: the same Helion one Nuclide away, 4-Helion sheets, solar locks, Nuclides, the 77th Helion, Delta sheets' }),
  );
  summaries.nav = () => (opts.nav.on ? 'on' : 'off');

  // Style ----------------------------------------------------------------------------------------------------
  const gStyle = group(
    'style',
    'Ink and type',
    seg('style.ink', 'Ink', [
      ['color', 'Colour'],
      ['mono', 'Black'],
    ]),
    seg('style.font', 'Typeface', [
      ['sans', 'Sans'],
      ['serif', 'Serif'],
    ]),
  );
  summaries.style = () => `${opts.style.ink === 'color' ? 'colour' : 'black'} · ${opts.style.font}`;

  // Print ---------------------------------------------------------------------------------------------------
  const twoUpRow = checkbox('print.twoUp', 'Two pages per sheet of paper', { hint: ' ' });
  const twoUpHint = twoUpRow.querySelector('.dy-hint');
  dyn.push(() => setText(twoUpHint, twoUpLabel(opts, pureMode)));
  const pairing = select('print.pairing', 'Pairing', [
    ['spreads', 'Facing pages, as an open book (–|1, 2|3 …)'],
    ['sequential', 'In order (1|2, 3|4 …)'],
    ['duplex', 'Double-sided, cut and stack'],
  ]);
  const turn = select('print.turn', 'Backs', [
    ['side', 'Stack turned over sideways (flip on short edge)'],
    ['top', 'Stack turned top over bottom (flip on long edge)'],
  ]);
  const printNote = h('small.dy-note');
  dyn.push(() =>
    setText(
      printNote,
      opts.print.pairing === 'duplex'
        ? 'Print the odd pages, put the printed stack back in, print the even pages on the other side. Cut every sheet in half along the marks and lay the left halves on the right halves: the pages are in order.'
        : 'Facing pages print each spread on one sheet; cut or fold the sheets to bind them.',
    ),
  );
  const gPrint = group('print', 'Print', twoUpRow, pairing, turn, printNote);
  groups.insertBefore(gPrint, gGreg); // next to the paper it prints on
  summaries.print = () => (opts.print.twoUp ? `2 per sheet · ${pairingWords(opts.print)}` : 'one page per sheet');

  const allGroups = { paper: gPaper, gregorian: gGreg, front: gFront, lock: gLock, lined: gLined, canvases: gCanvas, semi: gSemi, retro: gRetro, inserts: gInserts, events: gEvents, sky: gSky, nav: gNav, style: gStyle, print: gPrint };

  // Footer ------------------------------------------------------------------------------------------------------
  const reset = h('button.btn.btn-sm.dy-reset', { type: 'button', html: `${ICONS.reset}<span>Reset to defaults</span>` });
  reset.addEventListener('click', () => onReset());
  const copy = h('button.btn.btn-sm', { type: 'button', html: `${ICONS.copy}<span>Copy options</span>`, title: 'Copy the options as JSON (for node tools/diary-pdf.mjs --options file.json)' });
  copy.addEventListener('click', () => onCopy());
  root.append(h('div.dy-foot', null, reset, copy));

  // ---------------------------------------------------------------------------------------------
  // sync
  // ---------------------------------------------------------------------------------------------
  let sheetSig = '';
  let sizeSig = '';
  let canvasSig = '';
  let retroSig = '';
  let semiSig = '';
  function rebuildList(listEl, rows) {
    const active = document.activeElement;
    const path = listEl.contains(active) ? active.dataset.path : null;
    listEl.replaceChildren(...rows);
    if (path) listEl.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus();
  }
  function writeValues() {
    for (const el of root.querySelectorAll('[data-path]')) {
      const path = el.dataset.path;
      const kind = el.dataset.kind;
      const v = getIn(opts, path);
      if (kind === 'seg') {
        for (const b of el.querySelectorAll('button')) setAttr(b, 'aria-pressed', String(b.dataset.v === v));
        continue;
      }
      if (el === document.activeElement && kind === 'number') continue;
      if (kind === 'check') el.checked = !!v;
      else if (kind === 'number' || kind === 'text') {
        const s = v === null || v === undefined ? '' : String(v);
        if (el.value !== s) el.value = s;
      } else if (kind === 'select') {
        const want = displayValue(path, v);
        if (path === 'gregorian.zone' && want && ![...el.options].some((o) => o.value === want)) el.append(h('option', { value: want, text: want.replace(/_/g, ' ') }));
        if (el.value !== want) el.value = want;
      }
    }
  }

  return {
    el: root,
    groups: allGroups,
    /** Write the options into the form. */
    sync(next) {
      opts = next.opts;
      const modeChanged = next.pureMode !== pureMode || !root.__synced;
      const zoneChanged = next.appZone !== appZone;
      pureMode = !!next.pureMode;
      appZone = next.appZone ?? appZone;
      if (modeChanged) {
        for (const f of modeHooks) f(pureMode);
        gGreg.hidden = pureMode;
        gIndexRow.hidden = pureMode;
      } else {
        const sizeKey = `${opts.page.width}x${opts.page.height}`;
        if (sizeKey !== sizeSig) sizeSel.querySelector('select').__fill(pureMode); // the custom size label shows its dimensions
        if (zoneChanged) zoneSel.querySelector('select').__fill(pureMode);
      }
      sizeSig = `${opts.page.width}x${opts.page.height}`;
      root.__synced = true;
      // lists: rebuilt when their shape changes
      const sSig = JSON.stringify(opts.lock.sheets.length);
      if (sSig !== sheetSig) {
        sheetSig = sSig;
        rebuildList(sheetList, opts.lock.sheets.map((s, i) => sheetRow(s, i, opts.lock.sheets.length)));
      }
      const cSig = JSON.stringify(opts.canvases.map((c) => c.type));
      if (cSig !== canvasSig) {
        canvasSig = cSig;
        rebuildList(canvasList, opts.canvases.map((c, i) => canvasRow('canvases', () => opts.canvases, c, i)));
      }
      const smSig = JSON.stringify(opts.semi.canvases.map((c) => c.type));
      if (smSig !== semiSig) {
        semiSig = smSig;
        rebuildList(semiList, opts.semi.canvases.map((c, i) => canvasRow('semi.canvases', () => opts.semi.canvases, c, i)));
      }
      const rSig = JSON.stringify(opts.retro.canvases.map((c) => c.type));
      if (rSig !== retroSig) {
        retroSig = rSig;
        rebuildList(retroList, opts.retro.canvases.map((c, i) => canvasRow('retro.canvases', () => opts.retro.canvases, c, i)));
      }
      writeValues();
      // dependent state
      const isCustom = opts.page.size === 'custom';
      for (const inp of custom.querySelectorAll('input')) inp.disabled = !isCustom;
      custom.classList.toggle('is-off', !isCustom);
      const gOn = opts.gregorian.on;
      zoneSel.querySelector('select').disabled = !gOn;
      gGreg.querySelector('[data-path="gregorian.weekdays"]').disabled = !gOn;
      gIndexRow.querySelector('input').disabled = !gOn;
      pairing.querySelector('select').disabled = !opts.print.twoUp;
      turn.querySelector('select').disabled = !opts.print.twoUp || opts.print.pairing !== 'duplex';
      const shape = next.shape ?? lockShape(opts);
      setText(lockRead, lockReadout(shape));
      setText(lockSub, `in each Nuclide of 77 Helions${shape.retro ? '' : ': every Helion is in a lock'}`);
      addSheet.disabled = opts.lock.sheets.length >= MAX_SHEETS || shape.perLock + 1 > 77;
      addCanvas.disabled = opts.canvases.length >= MAX_CANVASES;
      addRetro.disabled = opts.retro.canvases.length >= MAX_CANVASES;
      for (const el of semiList.querySelectorAll('select, input')) el.disabled = !opts.semi.allCanvas;
      for (const el of gSky.querySelectorAll('input:not([data-path="sky.on"]), button')) el.disabled = !opts.sky.on;
      if (!navigator.geolocation) locate.disabled = true;
      for (const f of dyn) f();
      for (const [key, det] of Object.entries(allGroups)) setText(det.__sum, summaries[key]());
    },
    /** For tests: the <details> of a group. */
    group: (key) => allGroups[key],
    mm,
  };
}
