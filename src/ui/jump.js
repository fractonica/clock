/**
 * Header jump box: one input that understands dates, Unix times, offsets, Saros positions,
 * cycle addresses, solar syncs, "next ε" style boundaries and odometer states.
 * The parsing lives in ./calendar/parse.js (pure, unit-tested); this file is the UI:
 * a combobox with live interpretations, keyboard navigation and a short history.
 *
 * Notation: "ε#5" is the 5th ε inside its parent; a bare "ε 5" is the depth chip of the ladder, Up next and
 * rings, which the box reads as a second candidate ("the running ε") next to the ordinal.
 * Keys: "/" (or Ctrl/Cmd+K) focuses the box · ↑/↓ choose · Enter jumps · Esc clears. Touch devices get no key hints.
 * Input is capped at MAX_INPUT characters (maxlength and in parseJump), so a huge paste cannot freeze the page.
 */
import { h, ICONS, loadPrefs, savePrefs } from './calendar/dom.js';
import { MAX_INPUT, dayFirstOfLocale, parseJump } from './calendar/parse.js';

const KEY = 'fractonica-clock/jump/v1';
const MAX_HISTORY = 8;
const KIND_LABEL = {
  date: 'Date',
  unix: 'Unix',
  relative: 'Offset',
  position: 'Position',
  cycle: 'Cycle',
  sync: 'Sync',
  boundary: 'Boundary',
  state: 'State',
  error: 'Check',
};

export const PLACEHOLDER = 'Jump to…  2031-06-01 · +3d · α#6 β#3 γ#11 · pos 24.5 · sync 4820';

/** Does this device's locale write the day before the month in 06/01/2031? (undefined when unknown) */
const localeDayFirst = () => dayFirstOfLocale(typeof navigator !== 'undefined' ? navigator.language : undefined);
/** Examples offered while the box is empty and there is no history. The slash date shows how the locale reads it. */
export function examples(dayFirst) {
  return [
    ['2031-06-01 14:30', 'a date and time in the app zone'],
    ['2031-06-01 14:30 Tokyo', 'the same in another zone (a city, an IANA name or +09:00)'],
    [dayFirst === false ? '06/01/2031' : '01/06/2031', dayFirst === false ? 'slashes read month/day here: 1 Jun 2031 (day/month is the second choice)' : 'slashes read day/month here: 1 Jun 2031 (month/day is the second choice)'],
    ['+3d', 'three days after the displayed time'],
    ['next ε', 'the next epsilon boundary'],
    ['α#6 β#3 γ#11', 'start of a cycle by its address (#6 = the 6th inside its parent)'],
    ['pos 24.5', 'Saros position'],
    ['sync 4820', 'start of a solar sync'],
    ['d7 13,0', 'next time depth 7 shows [13, 0]'],
  ];
}

/** Stored history is untrusted (old versions, hand edits, other tools): keep only well-formed entries. */
export function sanitizeHistory(stored) {
  return (Array.isArray(stored) ? stored : [])
    .filter((x) => x && typeof x.text === 'string' && x.text.trim() !== '')
    .map((x) => ({ text: x.text.slice(0, MAX_INPUT), label: typeof x.label === 'string' ? x.label.slice(0, 300) : '', kind: typeof x.kind === 'string' ? x.kind : '' }))
    .slice(0, MAX_HISTORY);
}

export function mount(el, ctx) {
  const { model, store, fmt } = ctx;
  let history = sanitizeHistory(loadPrefs(KEY, { items: [] }).items);

  const input = h('input.input.jump-input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Jump to a time',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'jump-list',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    maxlength: String(MAX_INPUT),
    placeholder: PLACEHOLDER,
  });
  const kbd = h('kbd.kbd.jump-kbd', { 'aria-hidden': 'true', text: '/' });
  const list = h('ul.jump-list', { id: 'jump-list', role: 'listbox', 'aria-label': 'Interpretations' });
  const foot = h('div.jump-foot', { 'aria-hidden': 'true' });
  const pop = h('div.jump-pop', { hidden: true }, list, foot);
  const box = h('div.jump-box', null, h('span.jump-ico', { html: ICONS.search }), input, kbd);
  const root = h('div.jump-root', null, box, pop);
  el.append(root);

  /** @type {{label:string,time:number|null,kind:string,detail:string,error?:string,text?:string}[]} */
  let items = [];
  let active = 0;
  let mode = 'closed'; // 'closed' | 'results' | 'recent'

  const dayFirst = localeDayFirst();
  const options = () => ({ now: store.t(), real: store.realNow(), zone: fmt.zone(), model, fmt, dayFirst, level: store.state.selectedLevel });
  const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const selectable = (c) => c && c.time !== null && c.kind !== 'error';

  function render() {
    list.textContent = '';
    items.forEach((c, i) => {
      const li = h(
        'li.jump-item',
        {
          id: 'jump-opt-' + i,
          role: 'option',
          'aria-selected': String(i === active && selectable(c)),
          'aria-disabled': selectable(c) ? null : 'true',
          class: (i === active && selectable(c) ? 'is-active ' : '') + (c.kind === 'error' ? 'is-error' : ''),
        },
        h('span.jump-kind.jump-k-' + c.kind, { text: c.recent ? 'Recent' : c.example ? 'Try' : KIND_LABEL[c.kind] ?? c.kind }),
        h('span.jump-main', null, h('b.jump-label', { text: c.label }), c.detail ? h('span.jump-detail', { text: c.detail }) : null),
        selectable(c) && !c.example ? h('span.jump-go', { html: ICONS.go, 'aria-hidden': 'true' }) : null,
      );
      li.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('click', () => choose(i));
      li.addEventListener('pointermove', () => {
        if (active !== i && selectable(c)) setActive(i, false);
      });
      list.append(li);
    });
    const open = mode !== 'closed' && items.length > 0;
    pop.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (open && selectable(items[active])) input.setAttribute('aria-activedescendant', 'jump-opt-' + active);
    else input.removeAttribute('aria-activedescendant');
    foot.textContent = open ? footerText() : '';
    foot.hidden = foot.textContent === '';
    kbd.hidden = document.activeElement === input || input.value !== '';
  }

  /**
   * The key hint under the list, only where it helps: none on touch devices, none when nothing can be chosen,
   * and "↑↓ choose" only when there is a choice to make.
   */
  function footerText() {
    const choices = items.filter(selectable).length + (mode === 'recent' ? items.length : 0);
    if (mode === 'recent') {
      const what = items[0]?.example ? 'Examples' : 'Recent jumps';
      if (touch()) return items[0]?.example ? `${what} · tap one to try it` : `${what} · tap one to go`;
      return `${what} · ↑↓ choose · ${items[0]?.example ? 'Enter to try one' : 'Enter go'}`;
    }
    if (touch() || !items.some(selectable)) return '';
    return `${choices > 1 ? '↑↓ choose · ' : ''}Enter go · Esc clear`;
  }

  function setActive(i, scroll = true) {
    if (!items.length) return;
    active = i;
    for (const li of list.children) {
      const idx = Number(li.id.slice(9));
      const on = idx === active && selectable(items[idx]);
      li.classList.toggle('is-active', on);
      li.setAttribute('aria-selected', String(on));
    }
    if (selectable(items[active])) input.setAttribute('aria-activedescendant', 'jump-opt-' + active);
    if (scroll) list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function firstSelectable() {
    const i = items.findIndex(selectable);
    return i < 0 ? 0 : i;
  }

  function refresh() {
    const text = input.value;
    input.removeAttribute('aria-invalid');
    input.classList.remove('is-bad');
    if (text.trim() === '') {
      if (document.activeElement !== input) {
        mode = 'closed';
        items = [];
      } else if (history.length) {
        mode = 'recent';
        items = history.map((x) => ({ kind: 'recent', recent: true, label: x.text, detail: x.label || '', time: 0, text: x.text, saved: x }));
      } else {
        mode = 'recent';
        items = examples(dayFirst).map(([t, d]) => ({ kind: 'example', label: t, detail: d, time: 0, text: t, example: true }));
      }
      active = 0;
      render();
      return;
    }
    mode = 'results';
    items = parseJump(text, options());
    active = firstSelectable();
    render();
  }

  function remember(text, label, kind) {
    history = [{ text, label, kind }, ...history.filter((x) => x.text !== text)].slice(0, MAX_HISTORY);
    savePrefs(KEY, { items: history });
  }

  function close(clear = false) {
    mode = 'closed';
    items = [];
    if (clear) input.value = '';
    input.classList.remove('is-bad');
    input.removeAttribute('aria-invalid');
    render();
  }

  function go(c, text) {
    if (c.live) {
      store.goLive(); // "now" is the device clock: the app follows it again instead of freezing on this instant
      ctx.toast('Back to the device clock');
    } else {
      ctx.goto(c.time);
      ctx.toast(`Jumped to ${fmt.long(c.time)}`);
    }
    remember(text, c.label, c.kind);
    close(true);
    input.blur();
  }

  function choose(i) {
    const c = items[i];
    if (!c) return;
    if (c.example || c.recent) {
      // history / examples are inputs: run them (relative inputs are re-evaluated now)
      input.value = c.text;
      const res = parseJump(c.text, options());
      // replay the interpretation that was chosen then (03/04/2031 read month/day stays month/day)
      const best = (c.saved && res.find((x) => selectable(x) && x.kind === c.saved.kind && x.label === c.saved.label)) || res.find(selectable);
      if (c.example || !best) {
        refresh();
        input.focus();
        return;
      }
      go(best, c.text);
      return;
    }
    if (!selectable(c)) return;
    // re-parse with a fresh "now" so offsets are relative to this instant
    const text = input.value;
    const fresh = parseJump(text, options());
    const same = fresh.find((x) => selectable(x) && x.kind === c.kind && x.label === c.label) ?? c;
    go(same, text.trim());
  }

  function enter() {
    if (!input.value.trim()) {
      if (mode === 'recent' && items[active]) choose(active); // a recent jump runs, an example is copied into the box
      return;
    }
    items = parseJump(input.value, options());
    if (!selectable(items[active])) active = firstSelectable();
    if (selectable(items[active])) choose(active);
    else {
      input.classList.remove('is-bad');
      void input.offsetWidth; // restart the shake
      input.classList.add('is-bad');
      input.setAttribute('aria-invalid', 'true');
      mode = 'results';
      render();
    }
  }

  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => {
    refresh();
    input.select();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!root.contains(document.activeElement)) close(false);
      kbd.hidden = input.value !== '';
    }, 0);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) {
        refresh();
        return;
      }
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let i = active;
      for (let n = 0; n < items.length; n++) {
        i = (i + dir + items.length) % items.length;
        if (selectable(items[i])) break;
      }
      setActive(i);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      enter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value !== '' || mode !== 'closed') close(true);
      else input.blur();
    }
  });

  const onDocKey = (e) => {
    if (e.defaultPrevented) return;
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
    const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
    const k = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey;
    if (slash || k) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  };
  document.addEventListener('keydown', onDocKey);
  const unsub = store.subscribe((kind) => {
    if (kind === 'settings' && mode === 'results') refresh();
  });

  render();
  return {
    alwaysOn: true,
    render() {},
    /** focus the box (also used by other modules) */
    focus() {
      input.focus();
    },
    destroy() {
      document.removeEventListener('keydown', onDocKey);
      unsub();
      root.remove();
    },
  };
}
