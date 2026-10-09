/**
 * Calendar tab: the two-way Fractonica <-> Gregorian converter (left) and the annotated
 * month calendar with year ribbon (right). Under ~900 px of available width the two cards
 * stack behind a "Converter | Calendar" switch.
 *
 *   ./calendar/convert.js    pure converter maths (positions, addresses, glyph states, sync)
 *   ./calendar/parse.js      pure input parsing (shared with the header jump box)
 *   ./calendar/month.js      pure month grid / band / year ribbon data
 *   ./calendar/converter.js  converter UI          ./calendar/monthview.js  month UI
 */
import { h, createTip, loadPrefs, savePrefs } from './calendar/dom.js';
import { createConverter } from './calendar/converter.js';
import { createMonthView } from './calendar/monthview.js';

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
  const conv = createConverter(ctx, { tip });
  const month = createMonthView(ctx, { prefs, setPref, tip });

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
    month.focusGrid();
  });

  root.append(skip, sw, h('div.cal-cols', null, conv.el, month.el));
  el.append(root);

  return {
    render(frame, info) {
      conv.render(frame, info);
      month.render(frame, info);
    },
    setActive(on) {
      root.dataset.active = on ? '1' : '0'; // (a hidden tab pauses the follow-dot pulse)
      conv.setActive(on);
      month.setActive(on);
      if (!on) tip.hide();
    },
    /** For tests and other modules: what the converter and the month view currently show. */
    get converterTime() {
      return conv.time;
    },
    get monthView() {
      return month.view;
    },
    destroy() {
      conv.destroy();
      month.destroy();
      tip.destroy();
      root.remove();
    },
  };
}
