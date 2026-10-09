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
};

// ---------- shared context ----------
const model = createModel();
const store = createStore({ model });
const fmt = createFormatter(() => store.state.zone || SYSTEM_ZONE);
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
// ?t=<unix seconds | ISO with zone>  &view=rings|timeline|wave|calendar|sound  &zone=<IANA>  &rate=<n>
//   &depth=<top depth>  &sel=<selected depth>
function applyUrl() {
  const q = new URLSearchParams(location.search);
  const patch = {};
  const view = (q.get('view') || '').toLowerCase();
  if (TAB_IDS.includes(view)) patch.view = view;
  if (q.has('zone')) patch.zone = q.get('zone'); // invalid zones are ignored by the store
  if (q.has('depth')) patch.topDepth = Math.round(Number(q.get('depth')));
  if (q.has('sel')) patch.selectedLevel = Math.round(Number(q.get('sel'))) - 1;
  if (Object.keys(patch).length) store.set(patch);
  const tp = q.get('t');
  if (tp) {
    const asNum = Number(tp);
    const t = Number.isFinite(asNum) ? asNum : Date.parse(tp) / 1000;
    if (Number.isFinite(t)) store.setTime(t, 'url');
  }
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

function buildHeader() {
  $('#tp-prev').innerHTML = icons.prev;
  $('#tp-next').innerHTML = icons.next;
  $('#tp-play').innerHTML = icons.play;
  $('#btn-link').innerHTML = icons.link;
  $('#btn-sound').innerHTML = icons.soundOff;

  const rate = $('#tp-rate');
  rate.innerHTML =
    '<optgroup label="Forward">' +
    RATES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') +
    '</optgroup><optgroup label="Backward">' +
    RATES.slice(1).map(([v, l]) => `<option value="-${v}">−${l.replace('×', '×')}</option>`).join('') +
    '</optgroup>';
  syncRateSelect();

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
    if (store.live) toast('Showing the device clock');
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
    return toast(chosenRate > 0 ? 'Already at the end of the catalogue (2857)' : 'Already at the start of the catalogue (1613)');
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
    opt.textContent = `×${abs >= 100 ? Math.round(abs).toLocaleString('en') : Number(abs.toPrecision(3))} (custom${r < 0 ? ', backward' : ''})`;
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
  u.searchParams.set('t', store.t().toFixed(3));
  u.searchParams.set('view', store.state.view);
  if (store.state.zone) u.searchParams.set('zone', store.state.zone);
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
  setText('time', roEls.time, fmt.time(t, { seconds: true }));
  setText('date', roEls.date, fmt.long(t).split(',')[0]);
  setText('tz', roEls.tz, fmt.tag(t));
  setText('pos', roEls.pos, frame.inRange ? `pos ${frame.pos.toFixed(6)}` : 'outside catalogue');
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
  roEls.live.title = live ? 'Showing the device clock' : 'Return to the device clock (N)';
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
  if (e.repeat && (e.key === 'm' || e.key === 'M')) return;
  if (e.key === ' ' && tag !== 'BUTTON') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'n' || e.key === 'N') store.goLive();
  else if (e.key === '[') stepCycle(-1);
  else if (e.key === ']') stepCycle(+1);
  else if (e.key === 'm' || e.key === 'M') toggleSound();
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
  buildTabs();
  buildHeader();
  store.subscribe((kind, patch) => {
    requestRender();
    if (kind === 'time') syncRateSelect();
    if (kind === 'settings' && patch && 'view' in patch) showView(store.state.view);
    if (kind === 'settings' && patch && 'zone' in patch) syncZoneSelect();
  });
  store.onTime((reason) => {
    if (reason === 'edge') toast('Time-lapse stopped at the end of the catalogue');
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
