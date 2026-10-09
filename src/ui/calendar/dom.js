/**
 * Small DOM helpers shared by the calendar and jump modules: element builder, icons,
 * clipboard, a tooltip and "write only when changed" setters.
 */

/** h('div.a.b', {attr: v, on: {click}}, ...children) -> HTMLElement */
export function h(spec, props, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** 16 px stroke icons (same style as the shell's). */
export const ICONS = {
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.2V3.1A1.6 1.6 0 0 0 8.9 1.5H3.6A1.6 1.6 0 0 0 2 3.1v5.3a1.6 1.6 0 0 0 1.6 1.6h.1"/>'),
  check: svg('<path d="M3 8.5l3.2 3.2L13 4.8"/>'),
  go: svg('<path d="M3 8h9.5M8.6 4l4 4-4 4"/>'),
  pin: svg('<path d="M9.8 2.2l4 4-1.4.5-2.2 2.2.4 3-1 1-2.5-2.5L3 14.2l-.2-.2 3.3-4.7L3.6 6.8l1-1 3 .4 2.2-2.2z"/>'),
  swap: svg('<path d="M2.5 5.5h10M10 3l2.7 2.5L10 8M13.5 10.5h-10M6 8l-2.7 2.5L6 13"/>'),
  prev: svg('<path d="M10 3L5 8l5 5"/>'),
  next: svg('<path d="M6 3l5 5-5 5"/>'),
  prev2: svg('<path d="M8.5 3L3.5 8l5 5M13 3L8 8l5 5"/>'),
  next2: svg('<path d="M7.5 3l5 5-5 5M3 3l5 5-5 5"/>'),
  refresh: svg('<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.7h-2.7"/>'),
  target: svg('<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>'),
  link: svg('<path d="M6.8 9.2a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.2 6.8a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/>'),
  search: svg('<circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4L14 14"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  clock: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>'),
  eclipse: svg('<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2 3.4 5.6 0 0 0 0-11.2z" fill="currentColor"/>'),
  sound: svg('<path d="M2.5 6v4h2.7L9 13V3L5.2 6zM11.5 5.5a3.5 3.5 0 0 1 0 5M13.3 3.7a6 6 0 0 1 0 8.6"/>'),
};

/** textContent only when it changed. */
export function setText(el, text) {
  if (el.__text !== text) {
    el.textContent = text;
    el.__text = text;
  }
}
/** innerHTML only when it changed. */
export function setHtml(el, html) {
  if (el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}
/** Inline style property only when it changed. */
export function setStyle(el, prop, value) {
  const key = '__s_' + prop;
  if (el[key] !== value) {
    el.style.setProperty(prop, value);
    el[key] = value;
  }
}
/** Attribute only when it changed (null removes). */
export function setAttr(el, name, value) {
  const key = '__a_' + name;
  if (el[key] !== value) {
    if (value === null || value === undefined || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : value);
    el[key] = value;
  }
}
export function toggleClass(el, name, on) {
  const key = '__c_' + name;
  if (el[key] !== !!on) {
    el.classList.toggle(name, !!on);
    el[key] = !!on;
  }
}

/** Copy text to the clipboard (with a textarea fallback); resolves to success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * A tooltip positioned next to a point, kept inside the viewport. Uses the shared `.tip` look.
 * show(html, clientX, clientY) / hide().
 */
export function createTip(parent) {
  const el = h('div.tip.cal-tip', { role: 'tooltip', hidden: true });
  parent.append(el);
  let shown = false;
  let timer = 0;
  const api = {
    el,
    show(html, x, y) {
      clearTimeout(timer);
      if (el.__html !== html) {
        el.innerHTML = html;
        el.__html = html;
      }
      el.hidden = false;
      shown = true;
      const pad = 10;
      const w = el.offsetWidth;
      const hgt = el.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      let left = x + 14;
      if (left + w > vw - pad) left = Math.max(pad, x - w - 14);
      let top = y + 16;
      if (top + hgt > vh - pad) top = Math.max(pad, y - hgt - 14);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    },
    hide() {
      clearTimeout(timer);
      if (shown) {
        el.hidden = true;
        shown = false;
      }
    },
    /** Hide after a moment unless show() comes first: the pointer crossing a gap between cells must not flicker. */
    hideSoon(ms = 90) {
      clearTimeout(timer);
      if (shown) timer = setTimeout(api.hide, ms);
    },
    destroy() {
      clearTimeout(timer);
      el.remove();
    },
  };
  return api;
}

/** True when the sound module is mounted and can play a moment (it mounts in parallel with the calendar). */
export function hasSound(ctx) {
  return typeof ctx.modules?.sound?.playMoment === 'function';
}

/**
 * "Hear this moment": the sound module's short arpeggio of the chord at instant t. Needs a user gesture;
 * when the browser blocks audio or the instant has no chord, the person gets a toast instead of silence.
 */
export async function hearMoment(ctx, t) {
  if (!hasSound(ctx)) return false;
  try {
    const m = await ctx.modules.sound.playMoment(t);
    if (!m) ctx.toast('Outside the Saros 141 catalogue: no chord to play');
    return !!m;
  } catch (err) {
    ctx.toast('Audio could not start: ' + (err?.message ?? err));
    return false;
  }
}

/** Per-viewer convenience storage (never required for correctness). */
export function loadPrefs(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}
export function savePrefs(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the page works without it */
  }
}

export const prefersReducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
