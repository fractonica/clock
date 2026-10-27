/**
 * Diary tab: a printed diary of one Delta (docs/design/90-diary.md, "The Diary tab").
 *
 *   head      the Delta: fracton-name pickers α β γ δ, ◀ ▶, "Delta of the shown moment" (follows the displayed time),
 *             its span (Fractonica; Gregorian too outside pure mode), Export PDF / Open print view
 *   preview   the current page (a spread of verso + recto on wide screens), page navigation, sections, thumbnails,
 *             the plan's summary
 *   options   every knob of DIARY_DEFAULTS in groups, persisted in localStorage 'fractonica.diary.v1'
 *
 *   ./diary/logic.js    DOM-free helpers (spreads, picker ordinals, option paths, persistence, readouts)
 *   ./diary/build.js    options → plan → renderer env → title (shared with tools/diary-print.html)
 *   ./diary/picker.js   ./diary/form.js   ./diary/preview.js   ./diary/export.js
 *
 * Planning happens only when the Delta, the options, the mode or the zone change (debounced), never per frame, and
 * only while the tab is shown. Pure mode (SPEC §15): every Gregorian control is hidden, the options are sanitized
 * with {pure: true} (Gregorian off) and the tab says nothing in Earth units; the stored options keep their Gregorian
 * settings for normal mode.
 */
import { sanitizeDiaryOptions, lockShape } from '../diary/options.js';
import { deltaRange, deltaAt } from '../diary/plan.js';
import { createFormatter, SYSTEM_ZONE } from '../core/format.js';
import { h, ICONS, setText, storage, copyText } from './diary/dom.js';
import { loadOptions, saveOptions, loadUi, saveUi, setIn, defaultOptions, lockReadout, paperLabel, sheetsOf, pathOfIndex, printSheets, printLine, twoUpLabel, cliCommand } from './diary/logic.js';
import { buildDiary, createEventCache, createSkyCache, createEclipseCache, deltaSpan, resolveZone } from './diary/build.js';
import { createPicker } from './diary/picker.js';
import { createForm } from './diary/form.js';
import { createPreview } from './diary/preview.js';
import { printHtml, openHtml, inspectPrintDocument, currentFrame } from './diary/export.js';
import { leadHTML } from './pentad.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The page renderers load with the first plan (not at app start), and a renderer that fails to load leaves the tab
 * working: the options, the plan and its summary still show, the preview says what went wrong.
 */
let renderLoad = null;
const loadRenderer = () => (renderLoad ??= import('../diary/render.js'));
const FAILED = {
  renderPage() {
    throw new Error('the page renderer is not available');
  },
  pageTitle: (plan, page) => `${page.no} · ${page.kind}`,
};
const ASTRO = new Set(['synodic', 'anomalistic', 'draconic', 'sidereal', 'solar']);

export function mount(el, ctx) {
  const { model, pure, store } = ctx;
  const st = storage();
  const range = deltaRange(model);
  const ui = loadUi(st);
  let raw = loadOptions(st); // complete, valid, mode-independent (Gregorian settings kept)
  let pureMode = ctx.isPure();
  let eff = sanitizeDiaryOptions(raw, { pure: pureMode });
  let follow = ui.follow;
  const clampDeltaIdx = (d) => Math.min(range.last, Math.max(range.first, d));
  let delta = clampDeltaIdx(follow || ui.delta === null ? deltaAt(model, store.t()) : ui.delta);
  let span = deltaSpan(model, delta);
  let built = null; // {opts, zone, plan, env, title}
  let builtKey = '';
  let version = 0; // bumps on every option change
  let timer = null;
  let active = false;
  let stale = true;
  let lastShownT = NaN;
  const eventCache = createEventCache();
  const skyCache = createSkyCache();
  const eclipseCache = createEclipseCache();
  const appZone = () => store.state.zone || SYSTEM_ZONE;
  // resolveZone builds an Intl formatter to validate: memoise it, render() asks every frame
  let zoneMemo = { a: undefined, b: undefined, z: null };
  const planZone = () => {
    const a = eff.gregorian.zone;
    const b = appZone();
    if (zoneMemo.a !== a || zoneMemo.b !== b) zoneMemo = { a, b, z: resolveZone(a, b) };
    return zoneMemo.z;
  };
  const wantKey = () => `${delta}|${pureMode ? 1 : 0}|${version}|${planZone()}`;

  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC'];
  }

  // ---- DOM ------------------------------------------------------------------------------------------------
  const picker = createPicker({
    pure,
    range,
    onPick: (idx) => {
      follow = false;
      setDelta(idx);
    },
    onFollow: () => {
      follow = !follow;
      if (follow) setDelta(deltaAt(model, store.t()));
      else syncHead();
      persistUi();
    },
  });
  const title = h('h3.dy-name');
  const stamp = h('span.chip.dy-stamp.mono');
  const shownChip = h('span.chip.dy-shown', { text: 'holds the shown moment', hidden: true });
  const words = h('p.dy-words');
  const fspan = h('p.dy-span');
  const gspan = h('p.dy-gspan');
  const exportBtn = h('button.btn.dy-export', { type: 'button', html: `${ICONS.print}<span>Export PDF</span>` });
  const openBtn = h('button.btn', { type: 'button', html: `${ICONS.open}<span>Open print view</span>` });
  const status = h('span.dy-status', { role: 'status', 'aria-live': 'polite' });
  const paperLine = h('p.dy-paper');
  const cli = h('code', { text: 'node tools/diary-pdf.mjs' });
  const cliNote = h('span');
  const how = h('p.dy-how', null, 'Export PDF opens the print dialog: the browser’s “Save as PDF” makes the PDF; ', cli, ' writes one directly', cliNote, '.');
  const head = h(
    'section.card.dy-head',
    { 'aria-label': 'The Delta of the diary' },
    h('div.card-h', null, h('h2', { text: 'Diary of one Delta' })),
    h(
      'div.card-b.dy-headb',
      null,
      picker.el,
      h(
        'div.dy-delta',
        null,
        h('div.dy-titlerow', null, title, stamp, shownChip),
        words,
        fspan,
        gspan,
        h('div.dy-exportrow', null, exportBtn, openBtn, status),
        paperLine,
        how,
      ),
    ),
  );

  const summary = h('div.dy-summary', { 'aria-label': 'Summary of the diary' });
  const preview = createPreview({
    layout: ui.layout,
    onPage: (no) => {
      ui.page = no;
      persistUi();
    },
    onLayout: (l) => {
      ui.layout = l;
      persistUi();
    },
    onShownPage: () => {
      const no = shownPage(store.t());
      if (!no) return;
      preview.setPage(no);
      persistUi();
    },
  });
  preview.setPage(ui.page);
  const pcard = h('section.card.dy-pcard', { 'aria-label': 'Preview' }, h('div.card-b', null, preview.el, summary));

  const form = createForm({
    pure,
    zones,
    open: ui.open,
    onChange: (path, value, { typing = false } = {}) => {
      raw = sanitizeDiaryOptions(setIn(raw, path, value));
      setEffective();
      schedule(typing ? 350 : 120);
    },
    onReset: () => {
      raw = defaultOptions();
      setEffective();
      schedule(0);
      ctx.toast('Diary options reset to the defaults');
    },
    onCopy: async () => {
      const ok = await copyText(JSON.stringify(raw, null, 2));
      ctx.toast(ok ? 'Options copied: save them as a file for node tools/diary-pdf.mjs --options' : 'Could not copy the options');
    },
    onToggleGroup: (key, open) => {
      ui.open = open ? [...new Set([...ui.open, key])] : ui.open.filter((k) => k !== key);
      persistUi();
    },
  });
  const ocard = h('section.card.dy-ocard', { 'aria-label': 'Options' }, h('div.card-h', null, h('h2', { text: 'Options' })), h('div.card-b', null, form.el));

  const root = h('div.dy', { 'data-active': '0' }, head, h('div.dy-body', null, pcard, ocard));
  el.append(root);

  exportBtn.addEventListener('click', () => exportPdf());
  openBtn.addEventListener('click', () => openPrintView());

  // ---- state changes ----------------------------------------------------------------------------------------
  function persistUi() {
    saveUi(st, { follow, delta, page: preview.page, layout: ui.layout, open: ui.open });
  }
  function setEffective() {
    eff = sanitizeDiaryOptions(raw, { pure: pureMode });
    version++;
    saveOptions(st, raw);
    form.sync({ opts: eff, pureMode, appZone: appZone(), shape: lockShape(eff) });
    syncExport();
  }
  function setDelta(idx) {
    const d = clampDeltaIdx(idx);
    if (d !== delta) {
      delta = d;
      span = deltaSpan(model, delta);
      // a fast time-lapse can pass several Deltas per second: plan the one it settles on
      schedule(store.playing ? 300 : 30);
    }
    syncHead();
    persistUi();
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (active) replan();
      else stale = true;
    }, ms);
  }
  let renderer = null; // src/diary/render.js once loaded
  let rendererFailed = false;
  function replan() {
    clearTimeout(timer);
    timer = null;
    stale = false;
    if (!renderer && !rendererFailed) {
      loadRenderer().then(
        (m) => {
          renderer = m;
          builtKey = '';
          if (active) replan();
          else stale = true;
        },
        (err) => {
          rendererFailed = true;
          console.error('[diary] the page renderer could not be loaded', err);
          setText(status, 'The page renderer could not be loaded: no preview or export.');
          builtKey = '';
          if (active) replan();
        },
      );
      return;
    }
    const key = wantKey();
    if (key === builtKey && built) return;
    try {
      built = buildDiary({ model, pure, F: ctx.F, input: raw, delta, appZone: appZone(), pureMode, eventCache, skyCache, eclipseCache });
      builtKey = key;
      // eclipse paths and the map arrive later: plan again (same key) once they are here
      built.pending?.then(() => {
        if (builtKey !== key) return;
        builtKey = '';
        if (active) replan();
        else stale = true;
      });
    } catch (err) {
      console.warn('[diary] planning failed', err);
      setText(status, 'This Delta could not be planned');
      return;
    }
    preview.setPlan(built.plan, built.env, renderer ?? FAILED);
    ui.page = preview.page;
    lastShownT = NaN;
    syncHead();
    syncSummary();
    form.sync({ opts: eff, pureMode, appZone: appZone(), shape: built.plan.shape });
  }

  // ---- texts ------------------------------------------------------------------------------------------------------
  function syncHead() {
    picker.sync({ delta, follow });
    syncExport();
    const path = pathOfIndex(delta);
    setText(title, pure.periodName(3, path[3]));
    setText(stamp, `α#${path[0]} β#${path[1]} γ#${path[2]} δ#${path[3]}`);
    setText(words, [0, 1, 2].map((L) => pure.periodName(L, path[L])).join(' · ') + ' · 5 Nuclides, 385 Helions');
    // each end of the Delta as a date, led by its Pentad (SPEC §7.5) like a weekday
    const start = pure.dateText(span.t0 + 1e-3);
    const endText = pure.dateText(span.t1 + 1e-3);
    const lead = (t, text) => leadHTML(model, t, esc(text), { cls: 'is-gold', title: true });
    const html = `${lead(span.t0 + 1e-3, start)} → ${endText === '—' ? 'the end of the catalogue' : lead(span.t1 + 1e-3, endText)}`;
    if (fspan.dataset.html !== html) {
      fspan.innerHTML = html;
      fspan.dataset.html = html;
    }
    gspan.hidden = pureMode;
    if (!pureMode) {
      const z = planZone();
      const g = createFormatter(() => z);
      setText(gspan, `${g.long(span.t0, { seconds: false })} → ${g.long(span.t1, { seconds: false })} · ${z.replace(/_/g, ' ')}`);
    }
  }
  /** The command line for this diary, and the PDF an export makes (pages of which paper). */
  function syncExport() {
    const cmd = cliCommand(pathOfIndex(delta), raw, { pureMode });
    setText(cli, cmd);
    setText(cliNote, cmd.includes('--options') ? ' (“Copy options” gives the options file)' : '');
    const pages = built && builtKey === wantKey() ? built.plan.pages.length : null;
    setText(paperLine, pages ? printLine(eff, pages, pureMode) : '');
  }
  function syncSummary() {
    const p = built.plan;
    const o = built.opts;
    const astro = p.events.filter((e) => ASTRO.has(e.family)).length;
    const chips = [
      `${p.pages.length} pages · ${sheetsOf(p.pages.length)} sheets`,
      paperLabel(o.page.size, o.page, pureMode),
      o.print.twoUp ? `printed ${twoUpLabel(o, pureMode)}` : null,
      lockReadout(p.shape),
      p.inserts.length ? `${p.inserts.length} Delta ${p.inserts.length === 1 ? 'sheet' : 'sheets'}` : null,
      `${astro} ephemeris ${astro === 1 ? 'event' : 'events'}`,
    ].filter(Boolean);
    summary.replaceChildren(...chips.map((c) => h('span.chip.dy-chip', { text: c })));
  }
  const shownPage = (t) => (built && t >= built.plan.delta.t0 && t < built.plan.delta.t1 ? built.plan.pageOf(t) : null);

  // ---- export -----------------------------------------------------------------------------------------------------
  function printDoc() {
    if (!renderer) return null;
    if (!built || builtKey !== wantKey()) replan();
    if (!built) return null;
    return renderer.printDocument(built.plan, built.env, { title: built.title });
  }
  let lastExport = null;
  /** What was exported: the document's @page and title, the diary's pages and the PDF pages they print on. */
  const exportInfo = (html) => {
    const doc = inspectPrintDocument(html);
    const pages = built.plan.pages.length;
    return { ...doc, svgs: doc.pages, pages, sheets: printSheets(pages, built.opts.print), twoUp: built.opts.print.twoUp, at: Date.now() };
  };
  async function exportPdf() {
    exportBtn.disabled = true;
    setText(status, `Preparing ${built?.plan.pages.length ?? ''} pages …`);
    await new Promise((r) => setTimeout(r, 30)); // let the status paint
    try {
      const html = printDoc();
      if (!html) {
        setText(status, 'The page renderer is not available yet.');
        return;
      }
      lastExport = { ...exportInfo(html), via: 'print' };
      await printHtml(html);
      lastExport.printed = true;
      setText(status, 'Print dialog opened: choose “Save as PDF”.');
    } catch (err) {
      console.warn('[diary] export failed', err);
      setText(status, 'The print document could not be opened');
    } finally {
      exportBtn.disabled = false;
    }
  }
  function openPrintView() {
    const html = printDoc();
    if (!html) {
      setText(status, 'The page renderer is not available yet.');
      return;
    }
    lastExport = { ...exportInfo(html), via: 'tab' };
    setText(status, openHtml(html) ? 'Print view opened in a new tab.' : 'The browser blocked the new tab; allow pop-ups for this page.');
  }

  // ---- mode ------------------------------------------------------------------------------------------------------
  function applyMode() {
    pureMode = ctx.isPure();
    root.dataset.pure = pureMode ? '1' : '';
    eff = sanitizeDiaryOptions(raw, { pure: pureMode });
    version++;
    form.sync({ opts: eff, pureMode, appZone: appZone(), shape: lockShape(eff) });
    syncHead();
    schedule(0);
  }
  form.sync({ opts: eff, pureMode, appZone: appZone(), shape: lockShape(eff) });
  root.dataset.pure = pureMode ? '1' : '';
  syncHead();

  return {
    render(frame, info) {
      if (ctx.isPure() !== pureMode) applyMode();
      if (follow && frame.inRange && (frame.t < span.t0 || frame.t >= span.t1)) setDelta(deltaAt(model, frame.t));
      if (stale && !timer) replan();
      else if (built && !timer && builtKey !== wantKey()) schedule(60); // the app's zone changed
      if (built && (info.dirty || frame.t !== lastShownT)) {
        lastShownT = frame.t;
        const no = shownPage(frame.t);
        preview.setShown(no);
        shownChip.hidden = !(frame.inRange && frame.t >= span.t0 && frame.t < span.t1);
      }
    },
    setActive(on) {
      active = on;
      root.dataset.active = on ? '1' : '0';
      preview.setActive(on);
      if (on && (stale || builtKey !== wantKey())) replan();
    },
    destroy() {
      clearTimeout(timer);
      preview.destroy();
      root.remove();
    },
    // ---- for tests and other modules --------------------------------------------------------------------
    get plan() {
      return built?.plan ?? null;
    },
    get options() {
      return eff;
    },
    get state() {
      return { delta, follow, page: preview.page, spread: preview.spread, pure: pureMode, planned: builtKey === wantKey(), zone: built?.zone ?? null };
    },
    get lastExport() {
      return lastExport;
    },
    /** Merge options by dotted paths ({'page.size': 'A4'}) as the form would, and plan at once. */
    setOptions(patch) {
      for (const [k, v] of Object.entries(patch)) raw = sanitizeDiaryOptions(setIn(raw, k, v));
      setEffective();
      replan();
    },
    setDelta(idx) {
      follow = false;
      setDelta(idx);
      replan();
    },
    goPage: (no) => preview.setPage(no),
    printDocument: printDoc,
    printFrame: currentFrame,
    preview,
    form,
  };
}
