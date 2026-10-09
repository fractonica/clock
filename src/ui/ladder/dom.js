/**
 * Small DOM helpers shared by the ladder and upnext modules: write-only-on-change text
 * cells, the cached phase-glyph factory, a hover tooltip built on the shared `.tip`
 * class, icons and the reduced-motion check. Browser only.
 */

/** HTML-escape a string for innerHTML templates. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Lightness (%) of a level's colour when it is used for small text: the violet / blue levels need more than 64 % for 4.5:1. */
const TEXT_LIGHTNESS = [75, 77, 74, 68];

/** Inline CSS custom properties that tint an element with a level's hue (--c, --c-txt, --c-hi, --c-dim, --c-faint, --c-edge). */
export function levelVars(theme, L, extra = '') {
  return [
    `--c:${theme.levelColor(L)}`,
    `--c-txt:${theme.levelColor(L, 1, TEXT_LIGHTNESS[L] ?? 64)}`,
    `--c-hi:${theme.levelColor(L, 1, 82)}`,
    `--c-dim:${theme.levelColor(L, 0.5)}`,
    `--c-faint:${theme.levelColor(L, 0.17)}`,
    `--c-edge:${theme.levelColor(L, 0.45)}`,
    extra,
  ]
    .filter(Boolean)
    .join(';');
}

/** True when the user asked for less motion. */
export function reducedMotion() {
  try {
    return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Returns a setter that touches the DOM only when the text changed. */
export function textCell(el) {
  let last = null;
  const set = (s) => {
    if (s !== last) {
      el.textContent = s;
      last = s;
    }
  };
  set.reset = () => {
    last = null;
  };
  return set;
}

/** Same for an attribute. */
export function attrCell(el, name) {
  let last = null;
  return (v) => {
    if (v !== last) {
      if (v === null || v === undefined || v === false) el.removeAttribute(name);
      else el.setAttribute(name, v === true ? '' : String(v));
      last = v;
    }
  };
}

/** Toggle a class only when the state changed (cheap guard against redundant style work). */
export function classCell(el, name) {
  let last = null;
  return (on) => {
    on = !!on;
    if (on !== last) {
      el.classList.toggle(name, on);
      last = on;
    }
  };
}

/**
 * Factory of cached phase-glyph SVG elements for one row: index -> <svg>. Glyphs use
 * currentColor so CSS decides the ink. The library title/label is dropped (the row has
 * its own accessible name) and the element is marked decorative.
 */
export function glyphFactory(model, style) {
  const cache = new Map();
  const tpl = document.createElement('template');
  return (index) => {
    let svg = cache.get(index);
    if (!svg) {
      tpl.innerHTML = model.glyphSVG(index, { strokes: 2, ...style });
      svg = tpl.content.firstElementChild;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.removeAttribute('role');
      svg.removeAttribute('aria-label');
      svg.querySelector('title')?.remove();
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      cache.set(index, svg);
    }
    return svg;
  };
}

/**
 * One floating tooltip (shared `.tip` look). show(html, rect) places it left of `rect`
 * when there is room, else below / above it, always inside the viewport.
 */
export function createTip(extraClass = '') {
  const el = document.createElement('div');
  el.className = `tip ${extraClass}`.trim();
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.append(el);
  let html = '';
  return {
    el,
    get visible() {
      return !el.hidden;
    },
    setHtml(next) {
      if (next !== html) {
        el.innerHTML = next;
        html = next;
      }
    },
    show(next, rect) {
      this.setHtml(next);
      el.hidden = false;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = rect.left - 10 - w;
      let y = rect.top + rect.height / 2 - h / 2;
      if (x < 8) {
        // no room on the left: sit under (or above) the anchor
        x = rect.left + 12;
        y = rect.bottom + 8;
        if (y + h > vh - 8) y = rect.top - h - 8;
      }
      el.style.left = `${Math.round(Math.max(8, Math.min(x, vw - w - 8)))}px`;
      el.style.top = `${Math.round(Math.max(8, Math.min(y, vh - h - 8)))}px`;
    },
    hide() {
      el.hidden = true;
    },
    destroy() {
      el.remove();
    },
  };
}

const svg = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** 16px stroke icons used by these two modules (same drawing language as main.js). */
export const icons = {
  /** arrow running into a bar on its right: "Just before the moment" */
  before: svg('<path d="M2 8h7M6.2 4.8 9.4 8l-3.2 3.2M13 3.5v9"/>'),
  /** bar followed by an arrow: "Just after the moment" */
  after: svg('<path d="M3 3.5v9M6.5 8H14M11 4.8 14.2 8 11 11.2"/>'),
  /** arrow running into a bar on its left: "start of the cycle" */
  start: svg('<path d="M14 8H7M9.8 4.8 6.6 8l3.2 3.2M3 3.5v9"/>'),
  chevron: svg('<path d="M4 6.5 8 10.5l4-4"/>'),
};
