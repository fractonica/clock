/**
 * One shared teaching tooltip for the Sound panel (uses the app-wide `.tip` look).
 *
 * Elements opt in with `bind(el, () => html)`. The tip shows
 *   - on mouse hover (follows the pointer),
 *   - on keyboard focus (anchored below the element),
 *   - on a tap on touch screens (anchored, stays until the next tap elsewhere),
 * and its text is also the accessible description of the control (`aria-describedby`), so screen-reader
 * users get the same teaching text without hovering. `refresh()` re-renders an open tip, which keeps
 * live rows ("Now: 45 % through its cycle") current.
 */
export function createTooltip() {
  const tip = document.createElement('div');
  tip.className = 'tip snd-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  // hidden text nodes that aria-describedby points at (a hidden node is still used when referenced directly)
  const bank = document.createElement('div');
  bank.hidden = true;
  document.body.append(tip, bank);
  let owner = null;
  let cur = null; // {el, html, x, y, anchor}
  let seq = 0;

  const textOf = (html) => (typeof html === 'function' ? html() : html);

  function place() {
    if (!cur) return;
    const { x, y, anchor } = cur;
    const pad = 10;
    const r = tip.getBoundingClientRect();
    let left = x + 14;
    let top = y + 16;
    let a = null;
    if (anchor) {
      a = anchor.getBoundingClientRect();
      left = a.left + 12;
      top = a.bottom + 8;
    }
    if (left + r.width > innerWidth - pad) left = Math.max(pad, innerWidth - pad - r.width);
    if (top + r.height > innerHeight - pad) top = Math.max(pad, (a ? a.top : y) - r.height - 10);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  /** @param {HTMLElement} el owner  @param {string|(()=>string)} html  @param {{x?:number,y?:number,anchor?:Element}} [at] */
  function show(el, html, at = {}) {
    owner = el;
    cur = { el, html, x: at.x ?? 0, y: at.y ?? 0, anchor: at.anchor ?? null };
    const h = textOf(html);
    if (tip.__h !== h) {
      tip.innerHTML = h;
      tip.__h = h;
    }
    tip.hidden = false;
    place();
  }
  function hide(el) {
    if (el && owner !== el) return;
    owner = null;
    cur = null;
    tip.hidden = true;
  }
  /** Re-render the open tip (its text has live rows). */
  function refresh() {
    if (!cur) return;
    const html = textOf(cur.html);
    if (tip.__h !== html) {
      tip.innerHTML = html;
      tip.__h = html;
    }
    place();
  }

  // a tap (or press) anywhere outside the owner closes a tip that a tap opened
  const onOutside = (e) => {
    if (cur && !cur.el.contains(e.target)) hide();
  };
  // scrolling moves anchored elements: keep the tip with its element (a pointer tip is dropped by the
  // pointerleave the browser sends when the page moves under a resting mouse)
  const onScroll = () => {
    if (cur?.anchor) place();
  };
  document.addEventListener('pointerdown', onOutside, true);
  addEventListener('scroll', onScroll, { capture: true, passive: true });

  const focusable = 'button, input, select, textarea, [tabindex]';

  /**
   * @param {HTMLElement} el
   * @param {string|(()=>string)} html  content, built when the tip opens
   * @param {object} [opts]
   * @param {boolean|string} [opts.touch=true]  false: no tap tooltip; a selector: only taps inside it
   * @param {string} [opts.describe]  selector of the focusable parts that get aria-describedby (default: all)
   */
  function bind(el, html, { touch = true, describe = focusable } = {}) {
    const desc = document.createElement('span');
    desc.id = `snd-desc-${++seq}`;
    bank.append(desc);
    const targets = () => (el.matches(describe) ? [el] : [...el.querySelectorAll(describe)]);
    for (const t of targets()) t.setAttribute('aria-describedby', desc.id);
    const describeNow = () => {
      const h = textOf(html);
      if (desc.__h !== h) {
        desc.innerHTML = h;
        desc.__h = h;
      }
    };
    let ptype = 'mouse';
    el.addEventListener('pointerenter', (e) => {
      describeNow();
      if (e.pointerType === 'touch') return;
      show(el, html, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener('pointermove', (e) => {
      if (owner === el && !cur.anchor) {
        cur.x = e.clientX;
        cur.y = e.clientY;
        place();
      }
    });
    // a finger lifting also "leaves" the element: a tap-opened tip stays until the next tap elsewhere
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') hide(el);
    });
    // keyboard focus shows the tip; a mouse click (which also focuses) must not leave it stuck open
    el.addEventListener('focusin', () => {
      describeNow();
      if (el.matches(':focus-visible') || el.querySelector(':focus-visible')) show(el, html, { anchor: el });
    });
    el.addEventListener('focusout', () => hide(el));
    el.addEventListener('pointerdown', (e) => {
      ptype = e.pointerType;
      if (e.pointerType !== 'touch') hide(el);
    });
    el.addEventListener('click', (e) => {
      if (ptype !== 'touch' || touch === false) return;
      if (typeof touch === 'string') {
        const hit = e.target.closest(touch);
        if (!hit || !el.contains(hit)) return;
        e.preventDefault(); // a caption inside a <label> must not also activate its control
      }
      if (owner === el) hide(el);
      else {
        describeNow();
        show(el, html, { anchor: el });
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide(el);
    });
  }

  function destroy() {
    document.removeEventListener('pointerdown', onOutside, true);
    removeEventListener('scroll', onScroll, { capture: true });
    tip.remove();
    bank.remove();
  }

  return { bind, show, hide, refresh, destroy };
}
