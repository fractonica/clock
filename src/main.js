/**
 * App bootstrap: builds the shared context, mounts UI modules, runs the single
 * animation loop and owns the header (readout, transport, zone, link, sound).
 *
 * Module contract (see docs/ARCHITECTURE.md):
 *   export function mount(el, ctx) -> {
 *     render(frame, info),   // called every animation frame while the module is visible
 *     setActive?(bool),      // view became visible / hidden
 *     alwaysOn?: true,       // render even when hidden (side panels, sound engine)
 *     destroy?()
 *   }
 */
import { createModel, QUARTER_NAMES, MAX_LEVEL } from './core/model.js';
import { createStore } from './core/store.js';
import { createPure } from './core/pure.js';
import { createFormatter, SYSTEM_ZONE } from './core/format.js';
import * as theme from './core/theme.js';

const $ = (sel, root = document) => root.querySelector(sel);

// Very old browsers lack ResizeObserver: fall back to window resize so every module can rely on it.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.els = new Set();
      this.fire = () => this.cb([...this.els].map((target) => ({ target, contentRect: target.getBoundingClientRect() })), this);
    }
    observe(el) {
      if (!this.els.size) addEventListener('resize', this.fire);
      this.els.add(el);
      queueMicrotask(this.fire);
    }
    unobserve(el) {
      this.els.delete(el);
    }
    disconnect() {
      this.els.clear();
      removeEventListener('resize', this.fire);
    }
  };
}

// ---------- icons (16px stroke icons) ----------
const svg = (body, vb = '0 0 16 16') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const icons = {
  prev: svg('<path d="M3.5 3v10M13 3.2v9.6L6 8z"/>'),
  next: svg('<path d="M12.5 3v10M3 3.2v9.6L10 8z"/>'),
  play: svg('<path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/>'),
  pause: svg('<path d="M5 3v10M11 3v10" stroke-width="2.2"/>'),
  link: svg('<path d="M6.8 9.2a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.2 6.8a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/>'),
  soundOn: svg('<path d="M2.5 6v4h2.7L9 13V3L5.2 6zM11.5 5.5a3.5 3.5 0 0 1 0 5M13.3 3.7a6 6 0 0 1 0 8.6"/>'),
  soundOff: svg('<path d="M2.5 6v4h2.7L9 13V3L5.2 6zM11.5 6l3 4M14.5 6l-3 4"/>'),
  rings: svg('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.4"/><path d="M8 2v2"/>'),
  timeline: svg('<path d="M1.5 4h13M1.5 8h13M1.5 12h13M5 2.5v11M10.5 2.5v11"/>'),
  wave: svg('<path d="M1.5 8c1.5-5 3-5 4 0s2.5 5 4 0 2.5-5 4 0"/>'),
  calendar: svg('<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/>'),
  sound: svg('<path d="M2 8h1.5M5 5v6M8 2.5v11M11 5v6M14 8h-1.2"/>'),
  pure: svg('<path d="M8 1.5v13M8 3.5c0 0 0 1.5 2.5 1.5S13 3.5 13 3.5M8 8.5c0 0 0-1.5-2.5-1.5S3 8.5 3 8.5M6 13h4"/>'),
};

// ---------- shared context ----------
const model = createModel();
const store = createStore({ model });
const fmtBase = createFormatter(() => store.state.zone || SYSTEM_ZONE);
const pure = createPure(model, { now: () => store.t() });
const isPure = () => store.state.pure;
/**
 * The formatter every module uses. In pure mode every Gregorian / Earth-unit formatter answers in Fractonica terms
 * instead (cycle addresses, odometer counters, durations counted in Fractonica periods), so a module that forgets
 * to special-case pure mode still cannot print a date, a zone or "3 h 20 min". `parts`, `toUnix` and `zone` stay
 * available for calculations: never display their results in pure mode.
 */
const fmt = {
  ...fmtBase,
  date: (t, ...a) => (isPure() ? pure.dateText(t) : fmtBase.date(t, ...a)),
  time: (t, ...a) => (isPure() ? pure.clockText(t) : fmtBase.time(t, ...a)),
  dateTime: (t, ...a) => (isPure() ? pure.stamp(t, 'lambda') : fmtBase.dateTime(t, ...a)),
  long: (t, ...a) => (isPure() ? pure.stamp(t, 'iota') : fmtBase.long(t, ...a)),
  short: (t, ...a) => (isPure() ? pure.stamp(t, 'eta') : fmtBase.short(t, ...a)),
  label: (t, ref) => (isPure() ? (pure.dateText(t) === pure.dateText(ref) ? pure.clockText(t) : pure.stamp(t, 'eta')) : fmtBase.label(t, ref)),
  tag: (t) => (isPure() ? '' : fmtBase.tag(t)),
  iso: (t) => (isPure() ? pure.stamp(t, 'lambda') : fmtBase.iso(t)),
  inputValue: (t) => (isPure() ? '' : fmtBase.inputValue(t)),
  parseInput: (v) => (isPure() ? null : fmtBase.parseInput(v)),
  duration: (sec, o) => (isPure() ? pure.duration(sec, { parts: o?.parts ?? 2 }) : fmtBase.duration(sec, o)),
  countdown: (sec) => (isPure() ? pure.countdown(sec) : fmtBase.countdown(sec)),
  relative: (t, ref) => (isPure() ? pure.countdown(t - ref, { at: ref }) : fmtBase.relative(t, ref)),
};
const instances = {};
let dirty = true;
const requestRender = () => {
  dirty = true;
};

function toast(message, ms = 2200) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

/** Navigate every view to time t (Unix seconds). */
function goto(t, reason) {
  store.setTime(t, reason);
}
/** Select a level (0-based) across views. */
function select(level) {
  store.set({ selectedLevel: Math.max(0, Math.min(MAX_LEVEL, level)) });
}

/**
 * Jump to the start of the previous / next cycle of `level`.
 * @param {number} dir  +1 next cycle, -1 previous (or start of the current one when >1 s into it)
 */
function stepCycle(dir, level = store.state.selectedLevel) {
  const t = store.t();
  const cur = model.levelAt(t, level);
  if (!cur) return;
  if (dir > 0) {
    if (cur.end < model.tMax) goto(cur.end + 0.001, 'cycle');
    else toast('End of the catalogue');
    return;
  }
  if (t - cur.start > 1) return goto(cur.start + 0.001, 'cycle');
  const prev = model.levelAt(cur.start - 0.002, level);
  if (prev) goto(prev.start + 0.001, 'cycle');
  else toast('Start of the catalogue');
}

const ctx = Object.freeze({
  F: model.F,
  model,
  store,
  fmt,
  pure,
  isPure,
  theme,
  icons,
  goto,
  select,
  stepCycle,
  toast,
  requestRender,
  QUARTER_NAMES,
  /** Sibling module instances by id (filled as modules mount), e.g. ctx.modules.sound */
  modules: instances,
});

// ---------- URL parameters ----------
// ?t=<unix seconds | ISO with zone> | ?pos=<Saros position>  &pure=1  &view=rings|timeline|wave|calendar|sound  &zone=<IANA>  &rate=<n>
//   &depth=<top depth>  &sel=<selected depth>
const flagParam = (v) => {
  const x = String(v ?? '').trim().toLowerCase();
  return x === '1' || x === 'true' ? true : x === '0' || x === 'false' ? false : null;
};
function applyUrl() {
  const q = new URLSearchParams(location.search);
  const patch = {};
  const view = (q.get('view') || '').toLowerCase();
  if (TAB_IDS.includes(view)) patch.view = view;
  if (q.has('zone')) patch.zone = q.get('zone'); // invalid zones are ignored by the store
  if (q.has('depth')) patch.topDepth = Math.round(Number(q.get('depth')));
  if (q.has('sel')) patch.selectedLevel = Math.round(Number(q.get('sel'))) - 1;
  const pureFlag = flagParam(q.get('pure'));
  if (pureFlag !== null) patch.pure = pureFlag;
  if (Object.keys(patch).length) store.set(patch);
  // a moment: ?pos=<Saros position> (pure links) or ?t=<unix seconds | ISO with zone>; in pure mode pos wins
  const decimal = /^\d+(\.\d+)?$/;
  const pp = q.get('pos');
  const posOk = pp !== null && decimal.test(pp) && Number(pp) <= model.extent;
  const tp = q.get('t');
  const timeFromT = () => {
    if (!tp) return false;
    const asNum = Number(tp);
    const t = Number.isFinite(asNum) ? asNum : Date.parse(tp) / 1000;
    if (!Number.isFinite(t)) return false;
    store.setTime(t, 'url');
    return true;
  };
  if (posOk && (store.state.pure || !tp)) store.setTime(model.timeOfPosition(Number(pp)), 'url');
  else timeFromT();
  const rp = q.get('rate');
  if (rp !== null && rp !== '' && Number.isFinite(Number(rp))) store.setRate(Number(rp), 'url');
}

// ---------- modules ----------
const MODULES = [
  { id: 'face', slot: '#slot-face', path: './ui/face.js' },
  { id: 'ladder', slot: '#slot-ladder', path: './ui/ladder.js' },
  { id: 'upnext', slot: '#slot-upnext', path: './ui/upnext.js' },
  { id: 'jump', slot: '#slot-jump', path: './ui/jump.js' },
  { id: 'rings', slot: '#view-rings', path: './ui/rings.js', tab: 'Rings', icon: 'rings' },
  { id: 'timeline', slot: '#view-timeline', path: './ui/timeline.js', tab: 'Timeline', icon: 'timeline' },
  { id: 'wave', slot: '#view-wave', path: './ui/wave.js', tab: 'Wave', icon: 'wave' },
  { id: 'calendar', slot: '#view-calendar', path: './ui/calendar.js', tab: 'Calendar', icon: 'calendar' },
  { id: 'sound', slot: '#view-sound', path: './ui/sound.js', tab: 'Sound', icon: 'sound' },
];
const TAB_IDS = MODULES.filter((m) => m.tab).map((m) => m.id);

async function mountModule(m) {
  const el = $(m.slot);
  try {
    const mod = await import(m.path);
    const inst = mod.mount(el, ctx) ?? {};
    instances[m.id] = inst;
    inst.__def = m;
    return inst;
  } catch (err) {
    console.error(`[${m.id}] failed to mount`, err);
    el.textContent = '';
    const box = document.createElement('div');
    box.className = 'module-error';
    const name = document.createElement('b');
    name.textContent = m.tab ?? m.id;
    const small = document.createElement('small');
    small.textContent = String(err?.message ?? err);
    box.append(name, ' could not be loaded.', document.createElement('br'), small);
    el.append(box);
    return null;
  }
}

function buildTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const m of MODULES.filter((x) => x.tab)) {
    const b = document.createElement('button');
    b.className = 'tab';
    b.type = 'button';
    b.role = 'tab';
    b.id = `tab-${m.id}`;
    b.setAttribute('aria-controls', `view-${m.id}`);
    b.innerHTML = `${icons[m.icon] ?? ''}<span>${m.tab}</span>`;
    b.addEventListener('click', () => store.set({ view: m.id }));
    b.addEventListener('keydown', (e) => {
      const i = TAB_IDS.indexOf(m.id);
      const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
      if (to === null) return;
      e.preventDefault();
      const id = TAB_IDS[(to + TAB_IDS.length) % TAB_IDS.length];
      store.set({ view: id });
      $(`#tab-${id}`).focus();
    });
    nav.append(b);
  }
}

let activeView = null;
function showView(id) {
  if (!TAB_IDS.includes(id)) id = TAB_IDS[0];
  if (activeView === id) return;
  for (const tid of TAB_IDS) {
    const on = tid === id;
    $(`#view-${tid}`).hidden = !on;
    const tab = $(`#tab-${tid}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    instances[tid]?.setActive?.(on);
  }
  activeView = id;
  document.body.dataset.view = id;
  const nav = $('#tabs');
  const tab = $(`#tab-${id}`);
  nav.scrollLeft = Math.max(0, tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2);
  requestRender();
}

// ---------- header ----------
const RATES = [
  ['1', '×1 real time'],
  ['10', '×10'],
  ['60', '×60 · 1 min/s'],
  ['600', '×600 · 10 min/s'],
  ['3600', '×3,600 · 1 h/s'],
  ['86400', '×86,400 · 1 d/s'],
  ['604800', '×604,800 · 1 wk/s'],
  ['2629800', '×2.63 M · 1 mo/s'],
  ['31557600', '×31.6 M · 1 y/s'],
];
let chosenRate = 3600; // the speed Play uses; mirrors store.rate whenever a time-lapse runs

/** Fill the speed select for the current mode (values are the same numeric rates; only the labels differ). */
function buildRateOptions() {
  const rate = $('#tp-rate');
  const fwd = isPure() ? pure.RATES.map((p) => [String(p.rate), p.label]) : RATES;
  const back = fwd.slice(1);
  rate.innerHTML =
    '<optgroup label="Forward">' +
    fwd.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') +
    '</optgroup><optgroup label="Backward">' +
    back.map(([v, l]) => `<option value="-${v}">${isPure() ? l + ' backward' : '−' + l}</option>`).join('') +
    '</optgroup>';
  syncRateSelect();
}

function buildHeader() {
  $('#tp-prev').innerHTML = icons.prev;
  $('#tp-next').innerHTML = icons.next;
  $('#tp-play').innerHTML = icons.play;
  $('#btn-link').innerHTML = icons.link;
  $('#btn-pure').innerHTML = icons.pure;
  $('#btn-sound').innerHTML = icons.soundOff;
  $('#btn-pure').addEventListener('click', togglePure);
  $('#btn-glossary').addEventListener('click', () => ($('#glossary').hidden ? openGlossary() : closeGlossary()));

  const rate = $('#tp-rate');
  buildRateOptions();

  const zone = $('#zone');
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC'];
  }
  if (!zones.includes('UTC')) zones.unshift('UTC');
  zone.innerHTML =
    `<option value="">System · ${SYSTEM_ZONE}</option><option value="UTC">UTC</option>` +
    zones.filter((z) => z !== 'UTC').map((z) => `<option value="${z}">${z.replace(/_/g, ' ')}</option>`).join('');
  syncZoneSelect();
  zone.addEventListener('change', () => store.set({ zone: zone.value || null }));

  $('#tp-prev').addEventListener('click', () => stepCycle(-1));
  $('#tp-next').addEventListener('click', () => stepCycle(+1));
  $('#tp-live').addEventListener('click', () => {
    if (store.live) toast('Showing the live clock');
    else store.goLive();
  });
  $('#tp-play').addEventListener('click', togglePlay);
  // choosing a speed starts the time-lapse at that speed (live mode shows "×1 real time" until then)
  rate.addEventListener('change', () => {
    const r = Number(rate.value);
    if (!Number.isFinite(r)) return;
    chosenRate = r;
    if (r === 1 && store.live) return;
    store.setRate(r);
  });
  $('#btn-link').addEventListener('click', copyLink);
  $('#btn-sound').addEventListener('click', toggleSound);
}

function togglePlay() {
  if (store.playing) return store.pause();
  const t = store.t();
  if ((chosenRate > 0 && t >= model.tMax - 1) || (chosenRate < 0 && t <= model.tMin + 1)) {
    return toast(isPure() ? (chosenRate > 0 ? 'Already at the end of the catalogue' : 'Already at the start of the catalogue') : chosenRate > 0 ? 'Already at the end of the catalogue (2857)' : 'Already at the start of the catalogue (1613)');
  }
  store.setRate(chosenRate);
}

/**
 * The speed select mirrors reality: "×1 real time" while live, the running rate during a time-lapse
 * (the Sound tab's tempo lock or a ?rate= link can set any value, shown as a custom option) and the speed
 * Play will use while paused.
 */
function syncRateSelect() {
  const sel = $('#tp-rate');
  if (!sel) return;
  if (store.playing && store.rate !== 0) chosenRate = store.rate;
  const r = store.live ? 1 : chosenRate;
  const v = String(r);
  let opt = [...sel.options].find((o) => o.value === v);
  if (!opt) {
    opt = sel.querySelector('option[data-custom]');
    if (!opt) {
      opt = document.createElement('option');
      opt.dataset.custom = '1';
      sel.prepend(opt);
    }
    opt.value = v;
    const abs = Math.abs(r);
    opt.textContent = isPure() ? pure.rateLabel(r) : `×${abs >= 100 ? Math.round(abs).toLocaleString('en') : Number(abs.toPrecision(3))} (custom${r < 0 ? ', backward' : ''})`;
  }
  sel.value = v;
}

/** The zone select lists the browser's zones; a valid zone it does not list (deep link) gets its own option. */
function syncZoneSelect() {
  const sel = $('#zone');
  const z = store.state.zone || '';
  if (z && ![...sel.options].some((o) => o.value === z)) {
    const opt = document.createElement('option');
    opt.value = z;
    opt.textContent = z.replace(/_/g, ' ');
    sel.append(opt);
  }
  sel.value = z;
}

/** The speed Play uses by default: one θ per Blink in pure mode (6 500×), one hour per real second otherwise. */
const PURE_PLAY_RATE = pure.RATES.find((p) => p.id === 'theta').rate;
function followModeSpeed() {
  if (isPure() && chosenRate === 3600) chosenRate = PURE_PLAY_RATE;
  else if (!isPure() && Math.abs(chosenRate - PURE_PLAY_RATE) < 1e-6) chosenRate = 3600;
}

/**
 * In pure mode the address bar must not carry a Unix time or a zone: an arrival link (?t=…&zone=…) becomes the same
 * moment as a Saros position (?pos=…). Live URLs without t/zone are left alone (a reload should stay live).
 */
function purifyUrl() {
  if (!store.state.pure) return;
  const u = new URL(location.href);
  const had = u.searchParams.has('t') || u.searchParams.has('zone');
  if (!had) return;
  const tp = u.searchParams.get('t');
  const t = tp !== null && Number.isFinite(Number(tp)) ? Number(tp) : tp ? Date.parse(tp) / 1000 : NaN;
  const pos = Number.isFinite(t) ? model.positionOf(t) : null;
  u.searchParams.delete('t');
  u.searchParams.delete('zone');
  if (pos !== null && !u.searchParams.has('pos')) u.searchParams.set('pos', pos.toFixed(12));
  try {
    history.replaceState(null, '', u);
  } catch {
    /* sandboxed frames may refuse; the address bar is cosmetic */
  }
}

function togglePure() {
  store.set({ pure: !store.state.pure });
  purifyUrl();
  toast(store.state.pure ? 'Pure mode: Fractonica terms only' : 'Pure mode off');
}

// ---------- pure-mode glossary ----------
function buildGlossary() {
  const el = $('#glossary');
  const row = (sym, text) => `<tr><th scope="row" class="mono">${sym}</th><td>${text}</td></tr>`;
  // one row per unit of the ladder: symbol, name, depth and how many of the next finer unit make one
  const units = pure.UNITS.filter((u) => u.named);
  const finer = (u) => {
    const next = pure.UNITS[pure.UNITS.indexOf(u) + 1];
    return next ? `1${u.sym} = ${Math.round(pure.unitPos(u) / pure.unitPos(next))}${next.sym}` : '';
  };
  const sun = (u) => (u.id === 'eta' ? ' · 19 of them make one solar sync' : u.id === 'nu' ? ' · the smallest unit, and one tick of real time' : '');
  el.innerHTML = `
    <div class="card-h"><h2>Pure mode glossary</h2><span class="spacer"></span><button class="btn btn-sm" type="button" id="glossary-close" aria-label="Close the glossary">Close</button></div>
    <div class="card-b glossary-b">
      <p>Everything here is counted in Fractonica periods. Each depth is one unit: a whole cycle of that depth.</p>
      <h3>Units</h3>
      <table class="glossary-t"><tbody>
        ${row('α β γ', 'one cycle of depth 1, 2, 3: Alpha, Beta, Gamma')}
        ${units.map((u) => row(u.sym, `<b>${u.name}</b> · one cycle of depth ${u.level + 1}${finer(u) ? ` · ${finer(u)}` : ''}${sun(u)}`)).join('')}
      </tbody></table>
      <p class="mono glossary-ratio">1γ = 5δ · 1δ = 5ε · 1ε = 7ζ · 1ζ = 11η · 1η = 9θ · 1θ = 4ι · 1ι = 5κ · 1κ = 13λ · 1λ = 5μ · 1μ = 5ν</p>
      <p class="mono glossary-ratio">The atomic steps: 1η = 36ι · 1ι = 65λ · 1λ = 25ν (Helion, Preon, Flavon, Blink).</p>
      <h3>Reading what you see</h3>
      <table class="glossary-t"><tbody>
        ${row('6ι 3κ', 'a span: six Preons and three Chromons. "in 6ι 3κ" counts down to a moment, "6ι 3κ ago" back from it. Finer than one Blink it is a decimal: 0.4ν.')}
        ${row('0η 29ι 21λ', 'where you are inside the current ζ cycle: completed η, ι, λ, counted from 0 (η in its ζ, ι in its η, λ in its ι; the timeline ruler continues with ν in its λ).')}
        ${row('ζ#5', 'the 5th ζ cycle inside its ε. A # number is an ordinal and counts from 1.')}
        ${row('Zeta Pentafracton', 'the same cycle by name. Monofracton is 1st, Difracton 2nd, Trifracton 3rd … Tridecafracton 13th.')}
        ${row('α#6 β#4 γ#9', 'an address: the 6th α, its 4th β, its 9th γ. δ#3 · ε#2 · ζ#5 continues it: its 3rd δ, 2nd ε, 5th ζ.')}
        ${row(`<span class="glossary-pair">${pure.pairHTML(0.8125 + 0.0156)}</span>`, 'phase through a cycle: two glyphs, 16 × 16 = 256 states. The left glyph is the coarse position, the right glyph the fine one; a dot marks the falling half.')}
        ${row('η per Blink', 'a speed: one η passes per Blink of real time. A Blink is one ν cycle; "real time" is one Blink per Blink.')}
        ${row('34 pB', 'cycles per Blink: how often something repeats in real time. 7 pB means seven cycles fit into one Blink.')}
        ${row('→ Eta Difracton begins', 'what starts the moment this cycle ends.')}
        ${row('sync #4820', 'the solar sync: 19 η cycles, counted from the anchor sync (#0). Its yellow glyphs are on the face.')}
        ${row('drift −623λ', 'how far this solar sync\'s start has slipped against the solar rhythm, counted in λ; a minus sign means earlier.')}
        ${row('#22', 'an eclipse of the catalogue, numbered like the position: #0 is the first, #69 the last (eclipse #22 sits at pos 22).')}
        ${row('pos 22.927850', 'the clock\'s own coordinate: how many Saros intervals have passed since the first eclipse of the catalogue.')}
      </tbody></table>
    </div>`;
  el.querySelector('#glossary-close').addEventListener('click', closeGlossary);
}
function openGlossary() {
  const el = $('#glossary');
  buildGlossary();
  el.hidden = false;
  $('#btn-glossary').setAttribute('aria-expanded', 'true');
  el.querySelector('#glossary-close').focus();
}
function closeGlossary() {
  const el = $('#glossary');
  if (el.hidden) return;
  el.hidden = true;
  $('#btn-glossary').setAttribute('aria-expanded', 'false');
}

async function toggleSound() {
  const s = instances.sound;
  if (!s?.toggle) return toast('Sound module not available');
  try {
    await s.toggle();
  } catch (err) {
    toast('Audio could not start: ' + (err?.message ?? err));
  }
}

async function copyLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  if (isPure()) {
    // pure links carry a Saros position, not a Unix time
    u.searchParams.set('pos', model.positionOf(store.t())?.toFixed(12) ?? '0');
    u.searchParams.set('pure', '1');
  } else {
    u.searchParams.set('t', store.t().toFixed(3));
  }
  u.searchParams.set('view', store.state.view);
  if (store.state.zone && !isPure()) u.searchParams.set('zone', store.state.zone);
  if (store.state.selectedLevel !== 6) u.searchParams.set('sel', String(store.state.selectedLevel + 1));
  if (store.state.topDepth !== 7) u.searchParams.set('depth', String(store.state.topDepth));
  if (store.playing) u.searchParams.set('rate', String(store.rate));
  const text = u.toString();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
  }
  if (ok) toast('Link to this moment copied');
  else prompt('Link to this moment', text);
}

const roEls = {
  time: $('#ro-time'),
  date: $('#ro-date'),
  tz: $('#ro-tz'),
  pos: $('#ro-pos'),
  live: $('#tp-live'),
  play: $('#tp-play'),
  prev: $('#tp-prev'),
  next: $('#tp-next'),
  sound: $('#btn-sound'),
  pureBtn: $('#btn-pure'),
  brandSub: $('#brand-sub'),
};
const last = {};
const setText = (key, el, text) => {
  if (last[key] !== text) {
    el.textContent = text;
    last[key] = text;
  }
};
function setHtml(key, el, html) {
  if (last[key] !== html) {
    el.innerHTML = html;
    last[key] = html;
  }
}

function updateHeader(frame) {
  const t = frame.t;
  const pureMode = isPure();
  if (last.pure !== pureMode) {
    last.pure = pureMode;
    document.body.dataset.pure = pureMode ? '1' : '';
    if (!pureMode) delete document.body.dataset.pure;
    roEls.brandSub.textContent = pureMode ? 'Pure mode' : 'Saros 141 clock';
    roEls.pureBtn.setAttribute('aria-pressed', String(pureMode));
    $('#readout').title = pureMode ? 'η ι λ count completed units inside the current ζ cycle, from 0. # numbers and names count from 1. Press ? for the glossary.' : '';
    roEls.pureBtn.classList.toggle('is-on', pureMode);
    followModeSpeed();
    buildRateOptions();
    $('#btn-glossary').hidden = !pureMode;
    if (!pureMode) closeGlossary();
    // force the readout to repaint in the new vocabulary
    for (const k of ['time', 'date', 'tz', 'pos']) delete last[k];
  }
  if (pureMode) {
    const c = frame.inRange ? pure.clock(t) : null;
    setHtml(
      'time',
      roEls.time,
      c ? `<span class="pure-clock" role="text" aria-label="${c.eta} η, ${c.iota} ι, ${c.lambda} λ completed in the current ζ"><b>${c.eta}</b><i>η</i><b>${c.iota}</b><i>ι</i><b>${c.lambda}</b><i>λ</i></span>` : '—',
    );
    setText('date', roEls.date, frame.inRange ? pure.dateText(t) : 'outside the catalogue');
    setText('tz', roEls.tz, '');
    setText('pos', roEls.pos, frame.inRange ? `pos ${frame.pos.toFixed(6)}` : '');
  } else {
    setText('time', roEls.time, fmt.time(t, { seconds: true }));
    setText('date', roEls.date, fmt.long(t).split(',')[0]);
    setText('tz', roEls.tz, fmt.tag(t));
    setText('pos', roEls.pos, frame.inRange ? `pos ${frame.pos.toFixed(6)}` : 'outside catalogue');
  }
  const sel = store.state.selectedLevel;
  if (last.sel !== sel) {
    last.sel = sel;
    const info = model.levelInfo(sel);
    roEls.prev.title = `Previous ${info.letter} cycle (depth ${info.depth}) — the cycle selected in the ladder ([)`;
    roEls.next.title = `Next ${info.letter} cycle (depth ${info.depth}) — the cycle selected in the ladder (])`;
    roEls.prev.setAttribute('aria-label', `Previous depth-${info.depth} cycle`);
    roEls.next.setAttribute('aria-label', `Next depth-${info.depth} cycle`);
  }
  const live = store.live;
  document.body.dataset.mode = live ? 'live' : 'travel';
  roEls.live.className = 'btn pill ' + (live ? 'is-live' : 'is-travel');
  setHtml('live', roEls.live, live ? '<span class="dot"></span>LIVE' : '<span class="dot"></span>NOW ↩');
  roEls.live.title = live ? 'Showing the live clock' : 'Return to the live clock (N)';
  setHtml('play', roEls.play, store.playing ? icons.pause : icons.play);
  const s = instances.sound;
  const on = !!s?.enabled;
  setHtml('sound', roEls.sound, on ? icons.soundOn : icons.soundOff);
  roEls.sound.setAttribute('aria-pressed', String(on));
  roEls.sound.classList.toggle('is-on', on);
}

// ---------- keyboard ----------
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
  if (e.key === 'Escape') return closeGlossary();
  if (e.repeat && /^[mMpP]$/.test(e.key)) return;
  if (e.key === ' ' && tag !== 'BUTTON') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'n' || e.key === 'N') store.goLive();
  else if (e.key === '[') stepCycle(-1);
  else if (e.key === ']') stepCycle(+1);
  else if (e.key === 'm' || e.key === 'M') toggleSound();
  else if (e.key === 'p' || e.key === 'P') togglePure();
  else if (e.key === '?' && isPure()) ($('#glossary').hidden ? openGlossary() : closeGlossary());
  else if (/^[1-5]$/.test(e.key)) store.set({ view: TAB_IDS[Number(e.key) - 1] });
}

// ---------- main loop ----------
let lastT = NaN;
let lastReal = performance.now();
function frameLoop(nowMs) {
  try {
    const dt = Math.min(0.25, (nowMs - lastReal) / 1000);
    lastReal = nowMs;
    const t = store.t();
    const frame = model.frame(t);
    const info = { dt, t, real: store.realNow(), dirty: dirty || t !== lastT, view: activeView };
    try {
      updateHeader(frame);
    } catch (err) {
      if (!updateHeader.failed) console.error('header update failed', err);
      updateHeader.failed = true;
    }
    for (const [id, inst] of Object.entries(instances)) {
      if (!inst?.render) continue;
      const visible = inst.alwaysOn || !inst.__def?.tab || id === activeView;
      if (!visible) continue;
      try {
        inst.render(frame, info);
      } catch (err) {
        if (!inst.__failed) console.error(`[${id}] render error`, err);
        inst.__failed = true;
      }
    }
    dirty = false;
    lastT = t;
  } finally {
    requestAnimationFrame(frameLoop);
  }
}

// ---------- boot ----------
async function boot() {
  applyUrl();
  if (store.state.pure) {
    document.body.dataset.pure = '1';
    $('#btn-glossary').hidden = false;
  }
  $('#brand-sub').textContent = store.state.pure ? 'Pure mode' : 'Saros 141 clock';
  purifyUrl();
  buildTabs();
  buildHeader();
  store.subscribe((kind, patch) => {
    requestRender();
    if (kind === 'time') syncRateSelect();
    if (kind === 'settings' && patch && 'view' in patch) showView(store.state.view);
    if (kind === 'settings' && patch && 'zone' in patch) syncZoneSelect();
  });
  store.onTime((reason) => {
    if (reason === 'edge') toast(store.t() <= model.tMin + 1 ? 'Time-lapse stopped at the start of the catalogue' : 'Time-lapse stopped at the end of the catalogue');
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', requestRender);
  const bar = $('#topbar');
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-measured', `${Math.ceil(bar.getBoundingClientRect().height)}px`)).observe(bar);
  }
  window.__fractonica = { ctx, model, store, fmt, instances };

  // mount all modules in parallel; failures are isolated per module
  await Promise.all(MODULES.map(mountModule));
  showView(store.state.view);
  requestAnimationFrame(frameLoop);
}

boot();
