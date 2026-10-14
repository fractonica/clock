/** Small DOM helpers of the Diary tab: element builder, icons, "write only when changed" setters. */

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
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICONS = {
  prev: svg('<path d="M10 3L5 8l5 5"/>'),
  next: svg('<path d="M6 3l5 5-5 5"/>'),
  target: svg('<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>'),
  print: svg('<path d="M4.5 6V2h7v4M4.5 11.5h-2v-5h11v5h-2"/><rect x="4.5" y="9.5" width="7" height="4.5" rx=".6"/>'),
  open: svg('<path d="M9.5 2.5h4v4M13.5 2.5L8 8M6.5 3.5h-3v9h9v-3"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  reset: svg('<path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.8v2.7h2.7"/>'),
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.2V3.1A1.6 1.6 0 0 0 8.9 1.5H3.6A1.6 1.6 0 0 0 2 3.1v5.3a1.6 1.6 0 0 0 1.6 1.6h.1"/>'),
};

/** textContent only when it changed. */
export function setText(el, text) {
  if (el.__text !== text) {
    el.textContent = text;
    el.__text = text;
  }
}
/** Attribute only when it changed (null / false removes). */
export function setAttr(el, name, value) {
  const key = '__a_' + name;
  if (el[key] !== value) {
    if (value === null || value === undefined || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : value);
    el[key] = value;
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

/** localStorage, or null when the browser blocks site data (reading the property can throw). */
export function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
