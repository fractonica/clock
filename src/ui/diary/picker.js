/**
 * The Delta picker: four fracton-name selects (Alpha … Delta), previous / next Delta and "the Delta of the shown
 * moment" (a toggle: while it is on, the diary follows the displayed time).
 *
 *   const pk = createPicker({ pure, range, onPick(idx), onFollow() });
 *   pk.sync({ delta, follow })
 */
import { h, ICONS } from './dom.js';
import { ordinalChoices, clampDelta, pathOfIndex } from './logic.js';

const LEVELS = [
  ['α', 'Alpha'],
  ['β', 'Beta'],
  ['γ', 'Gamma'],
  ['δ', 'Delta'],
];

export function createPicker({ pure, range, onPick, onFollow }) {
  let path = null;
  let delta = null;
  const selects = LEVELS.map(([sym, name], L) => {
    const sel = h('select.select.dy-pick', { id: `dy-pick-${L}`, 'aria-label': name });
    sel.addEventListener('change', () => {
      const p = [...path];
      p[L] = Number(sel.value);
      // a coarser choice keeps the finer ordinals where they exist, else the nearest Delta of the catalogue
      onPick(clampDelta(p, range));
    });
    const lab = h('label.dy-plbl', { for: sel.id }, h('b', { text: sym }), ` ${name}`);
    return { sel, box: h('div.dy-pfield', null, lab, sel) };
  });
  const prev = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Previous Delta', title: 'Previous Delta', html: ICONS.prev });
  const next = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Next Delta', title: 'Next Delta', html: ICONS.next });
  const follow = h('button.btn.dy-follow', { type: 'button', 'aria-pressed': 'false', html: `${ICONS.target}<span>Delta of the shown moment</span>`, title: 'Follow the displayed time: the diary shows the Delta that holds it' });
  prev.addEventListener('click', () => delta > range.first && onPick(delta - 1));
  next.addEventListener('click', () => delta < range.last && onPick(delta + 1));
  follow.addEventListener('click', () => onFollow());

  const el = h('div.dy-picker', null, h('div.dy-pfields', null, ...selects.map((s) => s.box)), h('div.dy-pbtns', null, prev, next, follow));

  function fill(L) {
    const { sel } = selects[L];
    const choices = ordinalChoices(L, path, range);
    const key = choices.map((c) => (c.ok ? 1 : 0)).join('');
    if (sel.__key !== key) {
      sel.__key = key;
      sel.replaceChildren(...choices.map((c) => h('option', { value: String(c.ord), text: pure.periodName(L, c.ord), disabled: c.ok ? null : true })));
    }
    sel.value = String(path[L]);
  }

  return {
    el,
    sync({ delta: d, follow: f }) {
      if (d !== delta) {
        delta = d;
        path = pathOfIndex(d);
        for (let L = 0; L < 4; L++) fill(L);
        prev.disabled = d <= range.first;
        next.disabled = d >= range.last;
      }
      follow.setAttribute('aria-pressed', String(!!f));
    },
  };
}
