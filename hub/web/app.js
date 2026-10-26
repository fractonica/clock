// Fractonica Hub web UI: timeline, search, entry detail, devices and pairing. Plain ES modules, no build step.
import { markdown, plain } from './md.js';
import { qrSVG } from './qr.js';

// ---- the clock (the web app's own modules, served by the hub under /fx/) -------------------------------------------
let model = null;
let pure = null;
try {
  const [{ createModel }, { createPure }] = await Promise.all([import('/fx/model.js'), import('/fx/pure.js')]);
  model = createModel();
  pure = createPure(model, { now: () => Date.now() / 1000 });
} catch (e) {
  console.warn('Fractonica clock unavailable; grouping by Earth days', e);
}
// The printable diary's sky events (names, families, labels, symbols): `sky:<event>` tags show as their symbols.
let SKY = null;
try {
  SKY = (await import('/fx/astro/index.js')).EVENT_INFO;
} catch (e) {
  console.warn('Sky events unavailable; sky tags show as text', e);
}

// ---- state ---------------------------------------------------------------------------------------------------------
const LS = {
  get: (k, d = null) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};
const S = {
  token: LS.get('fxhub.token'),
  me: null,
  hub: null,
  clients: new Map(),
  kinds: [],
  filter: { kinds: new Set(JSON.parse(LS.get('fxhub.kinds', '[]'))), sources: new Set(JSON.parse(LS.get('fxhub.sources', '[]'))) },
  records: new Map(),
  cursor: null,
  more: true,
  loading: false,
  expanded: new Set(),
  fresh: new Set(),
  search: { q: '', mode: 'auto', ran: null, results: null, note: null, busy: false },
  worker: { connected: false },
  view: null,
};
const $ = (id) => document.getElementById(id);
const main = $('main');
const dlg = $('dlg');

// ---- DOM helpers ---------------------------------------------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const ICONS = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  device: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  service: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  worker: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'i');
  s.innerHTML = ICONS[name] ?? '';
  return s;
};
function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied');
}

// ---- formatting ----------------------------------------------------------------------------------------------------
const fmt = {
  time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }),
  day: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  dayYear: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
  full: new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};
const d = (t) => new Date(t * 1000);
/** A moment in the producer's zone ("… 13:55:59 GMT+2 · Europe/Kyiv"), or the browser's when it has none. */
function zoned(t, zone) {
  if (!zone) return fmt.full.format(d(t));
  try {
    const f = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: zone, timeZoneName: 'short' });
    return `${f.format(d(t))} · ${zone}`;
  } catch {
    return fmt.full.format(d(t));
  }
}
const earthTime = (t) => fmt.time.format(d(t));
const earthDay = (t) => fmt.day.format(d(t));
function ago(t) {
  if (!t) return 'never';
  const s = Date.now() / 1000 - t;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmt.dayYear.format(d(t));
}
function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
/** "4ι 23λ": the record's minor clock inside its Helion (the Helion is the group). */
const clockInHelion = (r) => (r.fx?.clock ? r.fx.clock.split(' ').slice(1).join(' ') : '');
const clientName = (id) => S.clients.get(id)?.name ?? S.kinds.flatMap((k) => k.sources).find((s) => s.id === id)?.name ?? id;
function kindHue(kind) {
  let x = 0;
  for (const c of kind) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
}
const prettyKind = (k) => (k === 'journal.entry' ? 'Journal' : k);

/** The searchable text of a record (hub/API.md): journal → markdown; else text, data.text, data.summary. */
function bodyText(r) {
  const x = r.data ?? {};
  if (r.kind === 'journal.entry') return x.markdown ?? '';
  return [r.text, x.text, x.summary].find((s) => typeof s === 'string' && s.trim()) ?? '';
}
function keyValues(r) {
  const skip = new Set(['emoji', 'title', 'text', 'summary', 'markdown']);
  return Object.entries(r.data ?? {})
    .filter(([k, v]) => !skip.has(k) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length < 80)))
    .slice(0, 6);
}

// ---- API -----------------------------------------------------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && S.token) {
    logout();
    throw new Error('This browser was signed out of the hub.');
  }
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? res.statusText), { status: res.status, data });
  return data;
}
const blobUrl = (hash, thumb) => `/v1/blobs/${hash}?${thumb ? `thumb=${thumb}&` : ''}token=${encodeURIComponent(S.token)}`;

function logout() {
  S.token = null;
  LS.set('fxhub.token', null);
  events?.close();
  route();
}

// ---- header: live clock, worker, theme -----------------------------------------------------------------------------
function tickClock() {
  const t = Date.now() / 1000;
  if (pure) {
    $('now-clock').textContent = pure.clockText(t, 'lambda');
    $('now-sub').textContent = `${pure.dateText(t, { letters: true, upTo: 'epsilon' })} · ${earthDay(t)} ${earthTime(t)}`;
    $('now').title = pure.stamp(t, 'nu');
  } else {
    $('now-clock').textContent = earthTime(t);
    $('now-sub').textContent = earthDay(t);
  }
}
function setWorker(connected) {
  S.worker.connected = connected;
  $('worker-dot').className = `dot${connected ? ' on' : ''}`;
  $('worker-text').textContent = connected ? 'semantic' : 'keyword';
  $('status').title = connected ? 'Embedding worker connected: search is semantic' : 'No embedding worker: search is by keyword';
}
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('theme');
  b.replaceChildren(icon(pref === 'auto' ? 'auto' : pref === 'light' ? 'sun' : 'moon'));
  b.title = `Theme: ${pref}`;
}
$('theme').addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(LS.get('fxhub.theme', 'auto')) + 1) % 3];
  LS.set('fxhub.theme', next);
  applyTheme(next);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(LS.get('fxhub.theme', 'auto')));
applyTheme(LS.get('fxhub.theme', 'auto'));
$('status').addEventListener('click', () => (location.hash = '#/devices'));

// ---- live updates --------------------------------------------------------------------------------------------------
let events = null;
let pendingRender = false;
const playing = () => [...document.querySelectorAll('audio, video')].some((m) => !m.paused && !m.ended);
function scheduleRender() {
  if (S.view !== 'timeline') return;
  if (playing()) {
    pendingRender = true;
    return;
  }
  renderTimeline();
}
main.addEventListener('pause', () => pendingRender && !playing() && ((pendingRender = false), scheduleRender()), true);
main.addEventListener('ended', () => pendingRender && !playing() && ((pendingRender = false), scheduleRender()), true);

let kindsTimer = null;
function connectEvents() {
  events?.close();
  events = new EventSource(`/v1/events?token=${encodeURIComponent(S.token)}`);
  events.addEventListener('worker', (e) => setWorker(JSON.parse(e.data).connected));
  events.addEventListener('change', async (e) => {
    const c = JSON.parse(e.data);
    clearTimeout(kindsTimer);
    kindsTimer = setTimeout(async () => {
      await loadKinds();
      if (S.view === 'timeline') renderFilters();
    }, 400);
    if (c.deleted) {
      if (S.records.delete(c.id)) scheduleRender();
      return;
    }
    try {
      const r = await api('GET', `/v1/records/${encodeURIComponent(c.id)}`);
      const known = S.records.has(r.id);
      const oldest = Math.min(...[...S.records.values()].map((x) => x.time));
      if (!passes(r) || (!known && S.more && r.time < oldest)) return;
      if (!known) S.fresh.add(r.id);
      S.records.set(r.id, r);
      scheduleRender();
    } catch {}
  });
  events.addEventListener('clients', () => S.view === 'devices' && renderDevices());
  events.addEventListener('vector', () => S.view === 'devices' && refreshWorkerSoon());
}

// ---- routing -------------------------------------------------------------------------------------------------------
async function route() {
  const hash = location.hash;
  const setup = /^#setup=([\w-]+)/.exec(hash);
  if (setup) return redeemSetup(setup[1]);
  if (!S.token) return renderSetup();
  $('top').hidden = false;
  if (!S.me) {
    try {
      await boot();
    } catch (e) {
      if (!S.token) return;
      main.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'The hub did not answer'), String(e.message ?? e)));
      return;
    }
  }
  const m = /^#\/(devices|search\/(.*)|r\/(.+))?$/.exec(hash || '#/') ?? [];
  if (!m[3] && dlg.open) dlg.close();
  $('nav-timeline').toggleAttribute('aria-current', false);
  $('nav-devices').toggleAttribute('aria-current', false);
  if (m[1] === 'devices') {
    $('nav-devices').setAttribute('aria-current', 'page');
    S.view = 'devices';
    return renderDevices();
  }
  if (m[2] !== undefined) {
    const q = decodeURIComponent(m[2]);
    $('q').value = q;
    S.view = 'search';
    return runSearch(q);
  }
  $('nav-timeline').setAttribute('aria-current', 'page');
  if (S.view !== 'timeline') {
    S.view = 'timeline';
    $('q').value = '';
    renderTimeline();
    if (!S.records.size && S.more) loadMore();
  }
  if (m[3]) openDetail(decodeURIComponent(m[3]));
}
window.addEventListener('hashchange', route);

async function boot() {
  const [info, me] = await Promise.all([api('GET', '/v1'), api('GET', '/v1/me')]);
  S.hub = info.hub;
  S.me = me;
  setWorker(info.embedding.worker);
  await Promise.all([loadClients(), loadKinds()]);
  connectEvents();
  tickClock();
  setInterval(tickClock, 1000);
}
async function loadClients() {
  if (!S.me?.scopes.includes('admin')) return;
  const { clients } = await api('GET', '/v1/clients');
  S.clients = new Map(clients.map((c) => [c.id, c]));
}
async function loadKinds() {
  S.kinds = (await api('GET', '/v1/kinds')).kinds;
}

// ---- setup ---------------------------------------------------------------------------------------------------------
function deviceId() {
  let id = LS.get('fxhub.device');
  if (!id) LS.set('fxhub.device', (id = crypto.randomUUID?.() ?? String(Math.random()).slice(2)));
  return id;
}
function browserName() {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return { name: `${b}${os ? ` on ${os}` : ''}`, platform: os || null };
}
async function redeemSetup(code, errEl) {
  try {
    const { name, platform } = browserName();
    const r = await api('POST', '/v1/pair', { code, name, kind: 'browser', platform, device: deviceId() });
    S.token = r.token;
    LS.set('fxhub.token', r.token);
    history.replaceState(null, '', '#/');
    S.me = null;
    route();
  } catch (e) {
    history.replaceState(null, '', '#/');
    renderSetup(e.status === 429 ? 'Too many tries; wait a minute.' : e.status === 404 ? 'That code is unknown, used or expired.' : e.message);
  }
}
function renderSetup(error = '') {
  $('top').hidden = true;
  const input = h('input', { class: 'input', placeholder: 'XXXX-XXXX', maxlength: 9, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Setup code' });
  const err = h('div', { class: 'err' }, error);
  main.className = '';
  main.replaceChildren(
    h('form', { class: 'setup panel', onsubmit: (e) => (e.preventDefault(), input.value.trim() && redeemSetup(input.value.trim(), err)) },
      h('svg', { class: 'mark', viewBox: '-3 -3 6 12', html: '<g fill="none" stroke="currentColor" stroke-width=".42" stroke-linecap="round"><path d="M0 0V9M0 0C0 0 0 1 1 1C2 1 2 0 2 0M0 3C0 3 0 2 -1 2C-2 2 -2 3 -2 3M-1 6H1"/></g>' }),
      h('h1', null, 'Connect this browser'),
      h('p', null, 'Open the setup link the hub printed when it started, or enter a code. To make one: ', h('code', null, 'node hub/bin/hub.mjs pair --name Browser --kind browser')),
      input,
      err,
      h('div', { class: 'actions', style: { justifyContent: 'center', marginTop: '14px' } }, h('button', { class: 'btn primary', type: 'submit' }, 'Connect')),
    ),
  );
  input.focus();
}

// ---- timeline ------------------------------------------------------------------------------------------------------
function passes(r) {
  if (r.deleted) return false;
  if (S.filter.kinds.size && !S.filter.kinds.has(r.kind)) return false;
  if (S.filter.sources.size && !S.filter.sources.has(r.source)) return false;
  return true;
}
async function loadMore() {
  if (S.loading || !S.more) return;
  S.loading = true;
  renderSentinel();
  try {
    const p = new URLSearchParams({ limit: '60' });
    for (const k of S.filter.kinds) p.append('kind', k);
    for (const s of S.filter.sources) p.append('source', s);
    if (S.cursor) p.set('cursor', S.cursor);
    const r = await api('GET', `/v1/records?${p}`);
    for (const x of r.records) S.records.set(x.id, x);
    S.cursor = r.cursor;
    S.more = r.more;
  } catch (e) {
    toast(e.message);
    S.more = false;
  } finally {
    S.loading = false;
  }
  if (S.view === 'timeline') renderTimeline();
}
function resetTimeline() {
  S.records.clear();
  S.cursor = null;
  S.more = true;
  LS.set('fxhub.kinds', JSON.stringify([...S.filter.kinds]));
  LS.set('fxhub.sources', JSON.stringify([...S.filter.sources]));
  renderTimeline();
  loadMore();
}

let filtersEl = null;
function renderFilters() {
  const kinds = S.kinds;
  const sources = new Map();
  for (const k of kinds) for (const s of k.sources) sources.set(s.id, { id: s.id, name: s.name, count: (sources.get(s.id)?.count ?? 0) + s.count });
  const total = kinds.reduce((a, k) => a + k.count, 0);
  const toggle = (set, v) => () => {
    if (v === null) set.clear();
    else if (set.has(v)) set.delete(v);
    else set.add(v);
    resetTimeline();
  };
  const chip = (label, n, pressed, onclick, extra) =>
    h('button', { class: 'chip', 'aria-pressed': String(pressed), onclick, type: 'button' }, extra, label, n !== undefined ? h('span', { class: 'n' }, n) : null);
  const el = h('div', { class: 'filters' },
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'Kinds'), h('div', { class: 'chips' },
      chip('All', total, S.filter.kinds.size === 0, toggle(S.filter.kinds, null)),
      kinds.map((k) => chip(prettyKind(k.kind), k.count, S.filter.kinds.has(k.kind), toggle(S.filter.kinds, k.kind))),
    )),
    sources.size > 1
      ? h('div', { class: 'row' }, h('span', { class: 'label' }, 'From'), h('div', { class: 'chips' },
          chip('Everywhere', undefined, S.filter.sources.size === 0, toggle(S.filter.sources, null)),
          [...sources.values()].sort((a, b) => b.count - a.count).map((s) => chip(clientName(s.id), s.count, S.filter.sources.has(s.id), toggle(S.filter.sources, s.id))),
        ))
      : null,
  );
  if (filtersEl?.isConnected) filtersEl.replaceWith(el);
  filtersEl = el;
  return el;
}

/** Helion and Nuclide of a moment (or Earth day/month when the clock is unavailable). */
function placeOf(t) {
  const eta = model?.levelAt(t, 6);
  const eps = model?.levelAt(t, 4);
  if (eta && eps && pure) {
    return {
      nKey: `n${eps.cycle}`,
      nAddr: pure.dateText(t, { letters: true, upTo: 'epsilon' }),
      nWords: pure.majorText(t, 3),
      nStamp: pure.stamp(t, 'epsilon'),
      nSpan: [eps.start, eps.end],
      hKey: `h${eta.cycle}`,
      eta: pure.clock(t)?.eta,
      hSpan: [eta.start, eta.end],
    };
  }
  const day = new Date(t * 1000);
  return {
    nKey: `m${day.getFullYear()}-${day.getMonth()}`,
    nAddr: '',
    nWords: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(day),
    nSpan: null,
    hKey: `d${day.toDateString()}`,
    eta: null,
    hSpan: [t, t],
  };
}
function spanText([a, b]) {
  const da = earthDay(a);
  const db = earthDay(b);
  return da === db ? `${da}, ${earthTime(a)}–${earthTime(b)}` : `${da} ${earthTime(a)} – ${db} ${earthTime(b)}`;
}

let listEl = null;
let sentinel = null;
const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && loadMore(), { rootMargin: '800px' });
function renderSentinel() {
  if (!sentinel) return;
  sentinel.replaceChildren(S.loading ? h('div', { class: 'loading' }, 'Loading…') : S.more ? '' : S.records.size ? h('div', { class: 'loading' }, '·') : '');
}

function renderTimeline() {
  main.className = '';
  const recs = [...S.records.values()].filter(passes).sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
  listEl = h('div', { class: 'timeline' });
  if (!recs.length && !S.more && !S.loading) {
    listEl.append(
      h('div', { class: 'empty' },
        h('b', null, S.filter.kinds.size || S.filter.sources.size ? 'Nothing here with these filters' : 'No records yet'),
        S.filter.kinds.size || S.filter.sources.size ? 'Try “All”.' : h('span', null, 'Pair a device under ', h('a', { href: '#/devices' }, 'Devices'), ', or write one with ', h('code', null, 'curl'), ' (see the README).'),
      ),
    );
  }
  const groups = [];
  for (const r of recs) {
    const p = placeOf(r.time);
    let n = groups.at(-1);
    if (!n || n.key !== p.nKey) groups.push((n = { key: p.nKey, p, helions: [] }));
    let hh = n.helions.at(-1);
    if (!hh || hh.key !== p.hKey) n.helions.push((hh = { key: p.hKey, p, recs: [] }));
    hh.recs.push(r);
  }
  for (const { p, helions } of groups) {
    listEl.append(
      h('div', { class: 'nuclide', title: p.nStamp ?? '' },
        p.nAddr ? h('span', { class: 'addr' }, p.nAddr) : null,
        h('h2', null, p.nWords),
        p.nSpan ? h('span', { class: 'earth' }, `${fmt.dayYear.format(d(p.nSpan[0]))} – ${fmt.dayYear.format(d(p.nSpan[1]))}`) : null,
      ),
    );
    for (const hh of helions) {
      listEl.append(
        h('section', { class: 'helion' },
          h('div', { class: 'rail', title: hh.p.eta ? `Helion ${hh.p.eta} of the Nuclide` : '' },
            hh.p.eta ? h('div', { class: 'eta' }, String(hh.p.eta), h('small', null, 'η')) : h('div', { class: 'eta' }, earthDay(hh.recs[0].time)),
            h('span', { class: 'day' }, hh.p.eta ? spanText(hh.p.hSpan) : ''),
          ),
          itemsOf(hh),
        ),
      );
    }
  }
  sentinel = h('div', { class: 'sentinel' });
  main.replaceChildren(renderFilters(), listEl, sentinel);
  renderSentinel();
  io.disconnect();
  io.observe(sentinel);
  S.fresh.clear();
  fadeOverflow(listEl);
}
/** Fade the bottom of clamped text only when it really overflows. */
function fadeOverflow(root) {
  requestAnimationFrame(() => {
    for (const p of root.querySelectorAll('.prose.clamp')) p.classList.toggle('faded', p.scrollHeight > p.clientHeight + 2);
  });
}

/** A Helion's records as cards; a run of 4+ generic records of one kind from one source folds into a stack. */
function itemsOf(hh) {
  const box = h('div', { class: 'items' });
  const recs = hh.recs;
  for (let i = 0; i < recs.length; ) {
    const r = recs[i];
    if (r.kind !== 'journal.entry') {
      let j = i;
      while (j < recs.length && recs[j].kind === r.kind && recs[j].source === r.source) j++;
      const run = recs.slice(i, j);
      if (run.length >= 4) {
        const key = `${hh.key}:${r.kind}:${r.source}:${run.at(-1).id}`;
        const open = S.expanded.has(key);
        box.append(
          h('div', { class: 'stack' },
            (open ? run : run.slice(0, 3)).map((x) => genericRow(x)),
            h('button', { class: 'btn sm ghost more', type: 'button', onclick: () => (open ? S.expanded.delete(key) : S.expanded.add(key), renderTimeline()) },
              open ? 'Show fewer' : `+${run.length - 3} more ${prettyKind(r.kind)}`),
          ),
        );
        i = j;
        continue;
      }
    }
    box.append(cardOf(r));
    i++;
  }
  return box;
}

// Entries captured on a clock moment carry data.capture (hub/API.md): their rarity follows from the level.
const RARITY_OF_LEVEL = { helion: 'rare', nuclide: 'rare', delta: 'epic', gamma: 'legendary', beta: 'mythic', alpha: 'cosmic' };
const RARITIES = ['rare', 'epic', 'legendary', 'mythic', 'cosmic'];
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : '');
/** The capture of a journal entry, as { rarity, label }, or null for a common entry. */
function captureOf(r) {
  const c = r.data?.capture;
  if (!c || typeof c !== 'object' || typeof c.at !== 'number') return null;
  const rarity = RARITIES.includes(c.rarity) ? c.rarity : RARITY_OF_LEVEL[c.level] ?? 'rare';
  return { rarity, label: [cap(c.level), c.boundary].filter(Boolean).join(' ') };
}

function journalCard(r, { score, detail } = {}) {
  const x = r.data ?? {};
  const capture = captureOf(r);
  const photos = r.blobs.filter((b) => b.role === 'photo' || (b.role === 'file' && b.type.startsWith('image/')));
  const videos = r.blobs.filter((b) => b.role === 'video');
  const audios = r.blobs.filter((b) => b.role === 'audio');
  const files = r.blobs.filter((b) => !['photo', 'video', 'audio', 'poster'].includes(b.role) && !photos.includes(b));
  const title = x.title || (x.markdown ? '' : audios.length ? 'Voice note' : photos.length ? 'Photo' : videos.length ? 'Video' : '');
  const card = h('article', { class: `card${S.fresh.has(r.id) ? ' flash' : ''}${capture ? ` rarity r-${capture.rarity}` : ''}`, dataset: { id: r.id } },
    h('div', { class: 'card-h' },
      h('div', { class: 'emoji', 'aria-hidden': 'true' }, x.emoji || '·'),
      h('div', { class: 'ttl' },
        title ? h('h3', null, title) : null,
        h('div', { class: 'meta' },
          detail ? h('span', { class: 'stamp' }, r.fx?.stamp ?? '') : h('span', { class: 'fx' }, clockInHelion(r)),
          detail ? null : h('span', null, earthTime(r.time)),
          h('span', { class: 'sep' }, '·'),
          h('span', null, clientName(r.source)),
          r.editor && r.editor !== r.source ? h('span', null, `edited on ${clientName(r.editor)}`) : null,
        ),
      ),
      score !== undefined ? h('span', { class: 'score', title: 'score' }, score.toFixed(2)) : null,
      capture ? h('span', { class: 'badge-r', title: `Captured on a ${capture.label}` }, capture.rarity) : null,
    ),
    x.markdown ? h('div', { class: `prose${detail ? '' : ' clamp'}`, html: markdown(x.markdown) }) : null,
    photos.length ? mediaGrid(photos, detail) : null,
    videos.map((v) => videoEl(v, r)),
    audios.map((a) => audioEl(a)),
    x.transcript && (detail || !x.markdown) ? h('div', { class: 'transcript' }, `“${x.transcript}”`) : null,
    files.length ? h('div', { class: 'files' }, files.map((f) => h('a', { class: 'file', href: blobUrl(f.hash), target: '_blank', onclick: (e) => e.stopPropagation() }, icon('file'), f.name ?? f.type, h('span', { class: 'dim' }, bytes(f.size))))) : null,
    tagsOf(r, detail),
  );
  if (!detail) card.addEventListener('click', (e) => !e.target.closest('a, audio, video, button') && (location.hash = `#/r/${encodeURIComponent(r.id)}`));
  return card;
}
// A moment captured several times names its photos back@-1, front@-1, back@0 … (hub/API.md): the offset from the
// moment in Flavons. They show capture by capture, each the back photo with the front one inset (as the app does).
/** The camera and offset of a capture's photo name ("front@-1"), or null. */
function captureName(name) {
  const m = /^(.+)@(-?\d+)$/.exec(name ?? '');
  return m ? { camera: m[1], offset: Number(m[2]) } : null;
}
const captureTag = (k) => (k === 0 ? '0' : k < 0 ? `−${-k}λ` : `+${k}λ`);
const captureWords = (k) => (k === 0 ? 'at the moment' : k < 0 ? `${-k} Flavon${k < -1 ? 's' : ''} before` : `${k} Flavon${k > 1 ? 's' : ''} after`);
/** Photos grouped by capture, earliest first ([{ offset, main, inset }]), or null unless every name is a capture's. */
function captureGroups(photos) {
  const groups = new Map();
  for (const p of photos) {
    const c = captureName(p.name);
    if (!c) return null;
    if (!groups.has(c.offset)) groups.set(c.offset, []);
    groups.get(c.offset).push({ ...c, blob: p });
  }
  if (!groups.size) return null;
  return [...groups.keys()].sort((a, b) => a - b).map((offset) => {
    const list = groups.get(offset);
    const main = list.find((x) => x.camera === 'back') ?? list[0];
    const inset = list.find((x) => x !== main);
    return { offset, main: main.blob, inset: inset?.blob };
  });
}
function captureGrid(groups, detail) {
  return h('div', { class: `media captures n${Math.min(groups.length, 3)}` },
    groups.map((g) =>
      h('div', { class: 'ph', title: `${cap(captureWords(g.offset))}: back and front cameras` },
        h('a', { class: 'main', href: blobUrl(g.main.hash, 2048), target: '_blank', onclick: (e) => !detail && e.preventDefault() },
          h('img', { src: blobUrl(g.main.hash, detail ? 1280 : 480), alt: `${g.main.name}: ${captureWords(g.offset)}`, loading: 'lazy', decoding: 'async', width: g.main.width, height: g.main.height }),
        ),
        g.inset
          ? h('a', { class: 'inset', href: blobUrl(g.inset.hash, 2048), target: '_blank', onclick: (e) => !detail && e.preventDefault() },
              h('img', { src: blobUrl(g.inset.hash, 320), alt: `${g.inset.name}: ${captureWords(g.offset)}`, loading: 'lazy', decoding: 'async' }),
            )
          : null,
        h('span', { class: 'cap' }, captureTag(g.offset)),
      ),
    ),
  );
}
// Tags: the writer's own as #chips; sky events (hub/API.md `sky:<event>`) as the diary's symbols in their family's
// colour — on a card the symbols beside each other, in the detail with their names.
function tagsOf(r, detail) {
  const tags = r.tags ?? [];
  const sky = [];
  const own = [];
  for (const t of tags) {
    const info = t.startsWith('sky:') ? SKY?.[t.slice(4)] : null;
    if (info) sky.push(info);
    else own.push(t);
  }
  if (!sky.length && !own.length) return null;
  const chip = (i) =>
    h('span', { class: `sky fam-${i.family}${detail ? '' : ' bare'}`, title: i.label, 'aria-label': i.label },
      h('span', { class: 'sym', 'aria-hidden': 'true' }, `${i.symbol}\uFE0E`),
      detail ? h('span', null, i.label) : null,
    );
  return h('div', { class: `tags${detail ? '' : ' compact'}` },
    sky.length ? h('span', { class: 'sky-run', role: 'list', 'aria-label': 'In the sky' }, sky.map(chip)) : null,
    own.map((t) => h('span', { class: 'tag' }, `#${t}`)),
  );
}
function mediaGrid(photos, detail) {
  const groups = captureGroups(photos);
  if (groups) return captureGrid(groups, detail);
  const n = photos.length;
  const shown = detail ? photos : photos.slice(0, 6);
  return h('div', { class: `media n${Math.min(n, 4) === 3 || n > 4 ? 3 : Math.min(n, 4)}` },
    shown.map((p) =>
      h('a', { class: 'ph', href: blobUrl(p.hash, 2048), target: '_blank', onclick: (e) => !detail && (e.preventDefault()) },
        h('img', { src: blobUrl(p.hash, detail || n === 1 ? 1280 : 480), alt: p.name ?? 'photo', loading: 'lazy', decoding: 'async', width: p.width, height: p.height }),
      ),
    ),
  );
}
function videoEl(v) {
  const poster = v.poster ? blobUrl(v.poster, 960) : blobUrl(v.hash, 960);
  return h('div', { class: 'video', onclick: (e) => e.stopPropagation() },
    h('video', { src: blobUrl(v.hash), poster, controls: true, preload: 'none', playsinline: true, width: v.width, height: v.height }),
  );
}
function audioEl(a) {
  return h('div', { class: 'audio', onclick: (e) => e.stopPropagation() },
    icon('audio'),
    h('audio', { src: blobUrl(a.hash), controls: true, preload: 'none' }),
    a.duration ? h('span', { class: 'dim mono', style: { fontSize: '12px' } }, dur(a.duration)) : null,
  );
}
function genericRow(r, { score } = {}) {
  const x = r.data ?? {};
  const hue = kindHue(r.kind);
  const text = plain(bodyText(r));
  const kv = keyValues(r);
  const row = h('div', { class: 'row-g', dataset: { id: r.id } },
    h('div', { class: 'ic' }, x.emoji ? x.emoji : h('div', { class: 'kd', style: { background: `hsl(${hue} 60% 58%)` } })),
    h('div', { class: 'body' },
      // a title the text already says (computer usage: "Xcode — File.swift") gives way to the kind
      h('div', { class: 't1' }, h('b', null, x.title && !text.includes(x.title) ? x.title : r.kind), text ? h('span', null, text) : null),
      kv.length || r.blobs.length
        ? h('div', { class: 'kv' },
            kv.flatMap(([k, v], i) => [i ? ' · ' : '', `${k} `, h('i', null, typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v))]),
            r.blobs.length ? `${kv.length ? ' · ' : ''}${r.blobs.length} attachment${r.blobs.length > 1 ? 's' : ''}` : '',
          )
        : x.title && r.kind !== x.title ? h('div', { class: 'kv' }, r.kind) : null,
    ),
    h('div', { class: 'tm' }, score !== undefined ? h('span', { class: 'score' }, score.toFixed(2)) : h('span', { class: 'fx' }, clockInHelion(r)), score !== undefined ? null : earthTime(r.time)),
  );
  row.addEventListener('click', () => (location.hash = `#/r/${encodeURIComponent(r.id)}`));
  return row;
}
const cardOf = (r, o) => (r.kind === 'journal.entry' ? journalCard(r, o) : genericRow(r, o));

// ---- search --------------------------------------------------------------------------------------------------------
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/';
});
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('q').value = '';
    $('q').blur();
    if (S.view === 'search') location.hash = '#/';
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName) && !dlg.open) {
    e.preventDefault();
    $('q').focus();
  }
});
async function runSearch(q, mode = S.search.mode) {
  S.search = { ...S.search, q, mode, busy: true, note: null, showWeak: false };
  renderSearch();
  try {
    const body = { query: q, mode, limit: 50 };
    if (S.filter.kinds.size) body.kinds = [...S.filter.kinds];
    let r;
    try {
      r = await api('POST', '/v1/search', body);
    } catch (e) {
      if (e.status !== 503) throw e;
      S.search.note = 'No embedding worker answered, so this is a keyword search.';
      r = await api('POST', '/v1/search', { ...body, mode: 'keyword' });
    }
    if (S.search.q !== q) return;
    S.search.results = r.results;
    S.search.ran = r.mode;
  } catch (e) {
    S.search.results = [];
    S.search.note = e.message;
  }
  S.search.busy = false;
  if (S.view === 'search') renderSearch();
}
function renderSearch() {
  main.className = '';
  const s = S.search;
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Search mode' },
    ['auto', 'semantic', 'keyword'].map((m) => h('button', { type: 'button', 'aria-pressed': String(s.mode === m), onclick: () => runSearch(s.q, m) }, m[0].toUpperCase() + m.slice(1))),
  );
  // semantic search ranks everything; matches far below the best one are folded away
  const all = s.results ?? [];
  const top = all[0]?.score ?? 0;
  const strong = s.ran === 'semantic' && !s.showWeak ? all.filter((x) => x.score >= top - 0.06) : all;
  const weak = all.length - strong.length;
  const head = h('div', { class: 'results-h' },
    h('span', { class: 'h1' }, s.busy ? 'Searching…' : `${strong.length} result${strong.length === 1 ? '' : 's'}`),
    s.ran && !s.busy ? h('span', { class: `tag ${s.ran === 'semantic' ? 'teal' : ''}`, title: s.ran === 'semantic' ? 'Ranked by meaning (cosine similarity)' : 'Ranked by matching words and recency' }, s.ran) : null,
    h('span', { style: { flex: '1' } }),
    seg,
  );
  const list = h('div', { class: 'results' },
    s.note ? h('div', { class: 'sub' }, s.note) : null,
    strong.map((x) =>
      h('div', null,
        h('div', { class: 'result-when' }, [x.record.fx?.stamp, fmt.full.format(d(x.record.time)), x.part && x.part !== 'record' ? 'matched an attachment' : null].filter(Boolean).join(' · ')),
        cardOf(x.record, { score: x.score }),
      ),
    ),
    weak > 0 ? h('button', { class: 'btn sm ghost', type: 'button', style: { alignSelf: 'center' }, onclick: () => ((S.search.showWeak = true), renderSearch()) }, `Show ${weak} weaker match${weak === 1 ? '' : 'es'}`) : null,
    !s.busy && s.results && !s.results.length ? h('div', { class: 'empty' }, h('b', null, 'Nothing found'), s.ran === 'keyword' ? 'Keyword search matches words; try fewer or different ones.' : 'Try other words.') : null,
  );
  main.replaceChildren(head, list);
  fadeOverflow(list);
}

// ---- detail --------------------------------------------------------------------------------------------------------
dlg.addEventListener('close', () => {
  if (/^#\/r\//.test(location.hash)) history.replaceState(null, '', S.view === 'search' ? `#/search/${encodeURIComponent(S.search.q)}` : '#/');
  dlg.replaceChildren();
});
dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
async function openDetail(id) {
  let r;
  try {
    r = await api('GET', `/v1/records/${encodeURIComponent(id)}`);
  } catch (e) {
    toast(e.message);
    return;
  }
  const x = r.data ?? {};
  const isJournal = r.kind === 'journal.entry';
  const body = isJournal
    ? journalCard(r, { detail: true })
    : h('div', { class: 'card', style: { cursor: 'default' } },
        h('div', { class: 'card-h' },
          h('div', { class: 'emoji' }, x.emoji || h('div', { class: 'kd', style: { width: '12px', height: '12px', borderRadius: '4px', background: `hsl(${kindHue(r.kind)} 60% 58%)` } })),
          h('div', { class: 'ttl' }, h('h3', null, x.title || r.kind), h('div', { class: 'meta' }, h('span', { class: 'stamp' }, r.fx?.stamp ?? ''), h('span', { class: 'sep' }, '·'), clientName(r.source))),
        ),
        bodyText(r) ? h('div', { class: 'prose', html: markdown(bodyText(r)) }) : null,
        keyValues(r).length ? h('dl', { class: 'facts' }, keyValues(r).flatMap(([k, v]) => [h('dt', null, k), h('dd', { class: 'mono' }, String(v))])) : null,
        mediaGrid(r.blobs.filter((b) => b.type.startsWith('image/') && b.role !== 'poster'), true),
        r.blobs.filter((b) => b.role === 'video').map((v) => videoEl(v)),
        r.blobs.filter((b) => b.role === 'audio').map((a) => audioEl(a)),
      );
  body.classList.add('detail');
  const facts = h('dl', { class: 'facts' },
    [
      ['When', zoned(r.time, r.zone)],
      r.end ? ['Until', fmt.full.format(d(r.end))] : null,
      ['Fractonica', r.fx?.stamp ? `${r.fx.stamp} · ${r.fx.clock}` : '—', true],
      ['Kind', r.kind, true],
      ['From', clientName(r.source)],
      r.editor !== r.source ? ['Edited on', clientName(r.editor)] : null,
      ['Written', `${fmt.full.format(d(r.created))}; updated ${ago(r.updated)}`],
      ['Id', r.id, true],
      ['Rev', String(r.rev), true],
      r.blobs.length ? ['Files', r.blobs.map((b) => `${b.role} · ${b.type} · ${bytes(b.size)}${b.duration ? ` · ${dur(b.duration)}` : ''}${b.width ? ` · ${b.width}×${b.height}` : ''}`).join('\n')] : null,
    ]
      .filter(Boolean)
      .flatMap(([k, v, mono]) => [h('dt', null, k), h('dd', { class: mono ? 'mono' : '', style: { whiteSpace: 'pre-line' } }, v)]),
  );
  const canDelete = S.me.scopes.includes('admin') || (S.me.scopes.includes('write') && (r.source === S.me.id || r.kind.startsWith('journal.')));
  dlg.className = '';
  dlg.replaceChildren(
    h('div', { class: 'dlg-h' },
      h('div', { class: 't dim', style: { fontWeight: '500', fontSize: '13.5px' } }, `${fmt.full.format(d(r.time))}`),
      canDelete
        ? h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
            if (!confirm('Delete this record on every device?')) return;
            try {
              await api('DELETE', `/v1/records/${encodeURIComponent(r.id)}`);
              S.records.delete(r.id);
              dlg.close();
              scheduleRender();
              toast('Deleted');
            } catch (e) {
              toast(e.message);
            }
          } }, icon('trash'), 'Delete')
        : null,
      h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close')),
    ),
    h('div', { class: 'dlg-b' },
      body,
      facts,
      h('details', { class: 'raw' }, h('summary', null, 'Raw record'), h('pre', null, JSON.stringify(r, null, 2))),
    ),
  );
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

// ---- devices -------------------------------------------------------------------------------------------------------
let workerTimer = null;
function refreshWorkerSoon() {
  clearTimeout(workerTimer);
  workerTimer = setTimeout(() => S.view === 'devices' && renderWorker(), 600);
}
let workerEl = null;
async function renderWorker() {
  if (!S.me.scopes.includes('admin')) return null;
  let w;
  try {
    w = await api('GET', '/v1/worker');
  } catch {
    return null;
  }
  const el = h('section', { class: 'panel worker' },
    h('div', { class: 'worker-h' },
      h('i', { class: `dot${w.connected ? ' on' : ''}` }),
      h('b', null, w.connected ? 'Embedding worker connected' : 'No embedding worker'),
      h('span', { class: 'dim', style: { fontSize: '13px' } }, w.connected ? [w.device, w.dtype, (w.modalities ?? []).join(' · '), w.version ? `worker ${w.version}` : null].filter(Boolean).join(' · ') : w.lastSeen ? `last seen ${ago(w.lastSeen)}` : 'search falls back to keywords'),
      h('span', { style: { flex: '1' } }),
      w.queue.parked ? h('button', { class: 'btn sm', type: 'button', onclick: async () => (await api('POST', '/v1/worker/retry', {}), renderWorker()) }, icon('refresh'), 'Retry parked') : null,
    ),
    h('div', { class: 'sub', style: { marginTop: '4px' } }, h('span', { class: 'mono' }, w.model), w.dim ? ` · ${w.dim} dimensions` : '', ' · see ', h('code', null, 'hub/worker/README.md')),
    h('div', { class: 'stats' },
      [
        [w.records, 'records embedded'],
        [w.queue.queued + w.queue.leased, 'in the queue'],
        [w.queue.queries, 'queries waiting'],
        [w.queue.parked, 'parked'],
      ].map(([v, k]) => h('div', { class: 'stat' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'k' }, k))),
    ),
    w.parked.length
      ? h('ul', { class: 'parked' }, w.parked.slice(0, 8).map((p) => h('li', null, h('a', { href: `#/r/${encodeURIComponent(p.record)}` }, h('code', null, p.record)), ` (${p.kind ?? '?'}): ${p.error ?? 'failed'} · ${p.attempts} attempts`)))
      : null,
  );
  if (workerEl?.isConnected) workerEl.replaceWith(el);
  workerEl = el;
  return el;
}
async function renderDevices() {
  main.className = 'wide';
  if (!S.me.scopes.includes('admin')) {
    main.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'Devices need the admin scope'), 'This browser can read the timeline but not manage clients.'));
    return;
  }
  if (!main.querySelector('.clients')) main.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  await loadClients();
  const w = await renderWorker();
  const all = [...S.clients.values()];
  const live = all.filter((c) => !c.revoked).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const revoked = all.filter((c) => c.revoked);
  if (S.view !== 'devices') return;
  main.replaceChildren(
    w ?? '',
    h('div', { class: 'section-h' },
      h('h2', null, `Clients · ${live.length}`),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', type: 'button', onclick: openPair }, icon('plus'), 'Pair a device'),
    ),
    h('div', { class: 'clients' }, live.map(clientCard)),
    revoked.length ? h('div', { class: 'section-h', style: { marginTop: '30px' } }, h('h2', null, `Revoked · ${revoked.length}`)) : null,
    revoked.length ? h('div', { class: 'clients' }, revoked.map(clientCard)) : null,
  );
}
function clientCard(c) {
  const self = c.id === S.me.id;
  const nameEl = h('b', { title: 'Rename' }, c.name);
  const rename = () => {
    const input = h('input', { class: 'input', value: c.name, 'aria-label': 'Name' });
    const done = async (save) => {
      if (save && input.value.trim() && input.value.trim() !== c.name) {
        try {
          await api('PATCH', `/v1/clients/${c.id}`, { name: input.value.trim() });
        } catch (e) {
          toast(e.message);
        }
      }
      renderDevices();
    };
    input.addEventListener('keydown', (e) => (e.key === 'Enter' ? done(true) : e.key === 'Escape' ? done(false) : null));
    input.addEventListener('blur', () => done(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  };
  return h('div', { class: `panel client${c.revoked ? ' revoked' : ''}` },
    h('div', { class: 'client-h' },
      h('div', { class: 'ico' }, icon(c.kind)),
      h('div', { class: 'nm' }, nameEl, h('small', null, [c.kind, c.platform, self ? 'this browser' : null].filter(Boolean).join(' · '))),
      c.lastSeen && Date.now() / 1000 - c.lastSeen < 120 && !c.revoked ? h('i', { class: 'dot on', title: 'Active' }) : null,
    ),
    h('dl', { class: 'kv' },
      h('dt', null, 'Records'), h('dd', null, String(c.records)),
      h('dt', null, 'Seen'), h('dd', null, c.revoked ? `revoked ${ago(c.revoked)}` : ago(c.lastSeen)),
      h('dt', null, 'Scopes'), h('dd', null, h('span', { class: 'chips', style: { gap: '4px' } }, c.scopes.map((s) => h('span', { class: `tag${s === 'admin' ? ' warn' : ''}` }, s)))),
      h('dt', null, 'Kinds'), h('dd', { class: 'mono', style: { fontSize: '12px' } }, c.kinds.join(', ')),
      h('dt', null, 'Paired'), h('dd', null, fmt.dayYear.format(d(c.created))),
    ),
    c.revoked
      ? null
      : h('div', { class: 'foot' },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: rename }, icon('edit'), 'Rename'),
          self
            ? null
            : h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
                if (!confirm(`Revoke “${c.name}”? Its token stops working; its records stay.`)) return;
                await api('DELETE', `/v1/clients/${c.id}`);
                renderDevices();
              } }, 'Revoke'),
        ),
  );
}

const DEFAULT_SCOPES = { device: ['read', 'write', 'search'], service: ['write'], worker: ['worker'], browser: ['read', 'write', 'search', 'admin'] };
function openPair() {
  const name = h('input', { class: 'input', placeholder: 'iPhone, Studio thermometer…', required: true });
  let kind = 'device';
  const scopeBoxes = ['read', 'write', 'search', 'worker', 'admin'].map((s) => h('input', { type: 'checkbox', value: s }));
  const setScopes = () => scopeBoxes.forEach((b) => (b.checked = DEFAULT_SCOPES[kind].includes(b.value)));
  setScopes();
  const kinds = h('input', { class: 'input mono', value: '*', placeholder: '* or journal.*, sensor.*' });
  const seg = h('div', { class: 'seg' },
    Object.keys(DEFAULT_SCOPES).map((k) =>
      h('button', { type: 'button', 'aria-pressed': String(k === kind), onclick: (e) => {
        kind = k;
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        setScopes();
      } }, k[0].toUpperCase() + k.slice(1)),
    ),
  );
  const err = h('div', { class: 'err' });
  const form = h('form', { class: 'dlg-b', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const scopes = scopeBoxes.filter((b) => b.checked).map((b) => b.value);
      const ks = kinds.value.split(',').map((s) => s.trim()).filter(Boolean);
      const p = await api('POST', '/v1/pairings', { name: name.value.trim(), kind, scopes, kinds: ks.length ? ks : ['*'] });
      showCode(p, kind, name.value.trim());
    } catch (x) {
      err.textContent = x.message;
    }
  } },
    h('label', { class: 'field' }, h('span', null, 'Name'), name),
    h('div', { class: 'field' }, h('span', null, 'Kind'), seg),
    h('div', { class: 'field' }, h('span', null, 'Scopes'), h('div', { class: 'checks' }, scopeBoxes.map((b) => h('label', null, b, b.value)))),
    h('label', { class: 'field' }, h('span', null, 'Kinds of records it may read and write'), kinds),
    err,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Make a code')),
  );
  dlg.className = 'narrow';
  dlg.replaceChildren(h('div', { class: 'dlg-h' }, h('div', { class: 't' }, 'Pair a device'), h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))), form);
  dlg.showModal();
  name.focus();
}
function showCode(p, kind, name) {
  const base = new URL(p.link).searchParams.get('hub') ?? location.origin;
  const link = kind === 'browser' ? `${base}/#setup=${p.code}` : p.link;
  const left = h('span', { class: 'mono' });
  const tick = () => {
    const s = Math.max(0, Math.round(p.expires - Date.now() / 1000));
    left.textContent = s ? `expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'expired';
    if (!dlg.open) clearInterval(timer);
  };
  const timer = setInterval(tick, 1000);
  tick();
  const hint =
    kind === 'device'
      ? 'Scan it with the iPhone camera, or type the code into the Fractonica app’s hub settings.'
      : kind === 'browser'
        ? 'Open the link in the other browser (or scan it with a phone).'
        : 'Redeem it from the script or worker:';
  dlg.className = 'narrow';
  dlg.replaceChildren(
    h('div', { class: 'dlg-h' }, h('div', { class: 't' }, `Pair “${name}”`), h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    h('div', { class: 'dlg-b' },
      h('div', { class: 'pair' },
        h('div', { class: 'qr', html: qrSVG(link, { fg: '#000', bg: '#fff' }) }),
        h('div', null,
          h('div', { class: 'code' }, p.code),
          h('div', { class: 'sub', style: { marginTop: '6px' } }, left, ' · single use'),
          h('p', { class: 'sub', style: { marginTop: '10px' } }, hint),
        ),
      ),
      h('div', { class: 'linkbox' }, h('span', { title: link }, link), h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': 'Copy link', onclick: () => copy(link) }, icon('copy'))),
      kind === 'service' || kind === 'worker'
        ? h('div', { class: 'snippet' }, `curl -X POST ${base}/v1/pair -H 'Content-Type: application/json' \\\n  -d '{"code":"${p.code}","name":${JSON.stringify(name)},"kind":"${kind}"}'`)
        : null,
      h('div', { class: 'actions', style: { marginTop: '18px' } }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Done')),
    ),
  );
  dlg.addEventListener('close', () => (clearInterval(timer), S.view === 'devices' && renderDevices()), { once: true });
}

route();
