/**
 * Calendar tab: the two-way Fractonica <-> Gregorian converter (left) and the annotated
 * month calendar with year ribbon (right). Under ~900 px of available width the two cards
 * stack behind a "Converter | Calendar" switch.
 *
 *   ./calendar/convert.js    pure converter maths (positions, addresses, glyph states, sync)
 *   ./calendar/parse.js      pure input parsing (shared with the header jump box)
 *   ./calendar/month.js      pure month grid / band / year ribbon data
 *   ./calendar/converter.js  converter UI          ./calendar/monthview.js  month UI
 *
 * Pure mode (SPEC §15, docs/design/80-pure.md, revision 3: major periods in words, minor units by counts) swaps the
 * content, not the frame: the Gregorian converter and month grid give way to
 *   ./calendar/pure-conv.js       dates <-> moments, counters, the Delta page geometry (pure maths)
 *   ./calendar/pure-parse.js      the pure jump grammar (all four date forms, counts, offsets over α β γ δ ε η ι λ ν)
 *   ./calendar/pure-converter.js  the converter between Fractonica forms (dates, counts, position, address, phases, sync)
 *   ./calendar/pure-month.js      the page of one Delta: 5 Nuclide rows x 7 columns of 11 Helions
 * Both sets live side by side; only the one for the current mode is shown and rendered. The normal views are given a
 * formatter that never turns pure (ctx.fmt answers in Fractonica terms in pure mode), so they cannot absorb pure text
 * and switching back leaves them exactly as they were.
 */
import { createFormatter, SYSTEM_ZONE } from '../core/format.js';
import { h, createTip, loadPrefs, savePrefs } from './calendar/dom.js';
import { createConverter } from './calendar/converter.js';
import { createMonthView } from './calendar/monthview.js';
import { createPureConverter } from './calendar/pure-converter.js';
import { createPureMonth } from './calendar/pure-month.js';

const KEY = 'fractonica-clock/calendar/v1';

export function mount(el, ctx) {
  const prefs = loadPrefs(KEY, { weekStart: 1, overlay: 4, pane: 'converter' });
  const setPref = (patch) => {
    Object.assign(prefs, patch);
    savePrefs(KEY, prefs);
  };
  const pane = prefs.pane === 'calendar' ? 'calendar' : 'converter';
  const root = h('div.cal-root', { 'data-pane': pane, 'data-active': '1' });
  const tip = createTip(root);
  // The normal views read the Gregorian formatter directly, whatever the mode is.
  const nctx = { ...ctx, fmt: createFormatter(() => ctx.store.state.zone || SYSTEM_ZONE) };
  const conv = createConverter(nctx, { tip });
  const month = createMonthView(nctx, { prefs, setPref, tip });
  let pconv = null;
  let pmonth = null;

  const sw = h('div.seg.cal-switch', { role: 'group', 'aria-label': 'Show' });
  const buttons = [
    ['converter', 'Converter'],
    ['calendar', 'Calendar'],
  ].map(([id, label]) => {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String(id === pane) });
    b.addEventListener('click', () => select(id));
    sw.append(b);
    return [id, b];
  });
  function select(id) {
    root.dataset.pane = id;
    for (const [bid, b] of buttons) b.setAttribute('aria-pressed', String(bid === id));
    setPref({ pane: id });
    ctx.requestRender();
  }

  // the converter holds ~90 tab stops before the month grid: one jump gets keyboard users across it
  const skip = h('button.btn.btn-sm.cal-skip', { type: 'button', text: 'Skip to the calendar grid' });
  skip.addEventListener('click', () => {
    if (getComputedStyle(sw).display !== 'none' && root.dataset.pane !== 'calendar') select('calendar'); // stacked layout
    (shownPure ? pmonth : month).focusGrid();
  });

  const normalCols = h('div.cal-cols.cal-cols-n', null, conv.el, month.el);
  const pureCols = h('div.cal-cols.cal-cols-p', { hidden: true });
  root.append(skip, sw, normalCols, pureCols);
  el.append(root);

  // ---- mode switching: the pure views are built the first time pure mode is shown
  let shownPure = false;
  let active = true;
  function ensurePure() {
    if (pconv) return;
    pconv = createPureConverter(ctx, { tip });
    pmonth = createPureMonth(ctx, { tip });
    pureCols.append(pconv.el, pmonth.el);
  }
  function applyMode(pure) {
    shownPure = pure;
    tip.hide();
    if (pure) ensurePure();
    root.dataset.pure = pure ? '1' : '';
    if (!pure) delete root.dataset.pure;
    normalCols.hidden = pure;
    pureCols.hidden = !pure;
    // the views that come up start from scratch; the ones that leave stop painting
    (pure ? conv : pconv)?.setActive(false);
    (pure ? month : pmonth)?.setActive(false);
    if (active) {
      (pure ? pconv : conv).setActive(true);
      (pure ? pmonth : month).setActive(true);
    }
    ctx.requestRender();
  }
  if (ctx.isPure()) applyMode(true);

  return {
    render(frame, info) {
      const pure = ctx.isPure();
      if (pure !== shownPure) applyMode(pure);
      if (pure) {
        pconv.render(frame, info);
        pmonth.render(frame, info);
      } else {
        conv.render(frame, info);
        month.render(frame, info);
      }
    },
    setActive(on) {
      active = on;
      root.dataset.active = on ? '1' : '0'; // (a hidden tab pauses the follow-dot pulse)
      if (shownPure) {
        pconv?.setActive(on);
        pmonth?.setActive(on);
      } else {
        conv.setActive(on);
        month.setActive(on);
      }
      if (!on) tip.hide();
    },
    /** For tests and other modules: what the converter and the month view currently show. */
    get converterTime() {
      return shownPure ? pconv.time : conv.time;
    },
    get monthView() {
      return shownPure ? pmonth.view : month.view;
    },
    destroy() {
      conv.destroy();
      month.destroy();
      pconv?.destroy();
      pmonth?.destroy();
      tip.destroy();
      root.remove();
    },
  };
}
