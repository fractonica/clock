/**
 * Teaching tooltip for the face. Reuses the shared `.tip` look from app.css; content is a
 * small model {title, aside, lines[], hint, swatch?} so it can be built by pure helpers
 * (`swatch: false` drops the colour dot, used for plain gesture hints).
 */
import { clamp } from './helpers.js';

const div = (cls, text) => {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
};

export function createTooltip(parent, { id = '' } = {}) {
  const root = div('tip face-tip');
  root.setAttribute('role', 'tooltip');
  if (id) root.id = id;
  root.hidden = true;
  const swatch = document.createElement('span');
  swatch.className = 'face-tip-sw';
  const title = document.createElement('b');
  const aside = document.createElement('span');
  aside.className = 'dim';
  const head = div('face-tip-h');
  head.append(swatch, title, aside);
  const body = div('face-tip-b');
  const hint = div('face-tip-hint dim');
  root.append(head, body, hint);
  parent.append(root);

  let sig = '';
  let visible = false;

  function fill(model, accent) {
    const next = JSON.stringify([model.title, model.aside, model.lines, model.hint, accent, model.swatch]);
    if (next === sig) return;
    sig = next;
    title.textContent = model.title;
    aside.textContent = model.aside ?? '';
    swatch.style.background = accent || 'var(--teal)';
    swatch.hidden = model.swatch === false; // plain gesture hints carry no colour dot
    body.replaceChildren(...model.lines.map((l) => div('face-tip-l', l)));
    hint.textContent = model.hint ?? '';
    hint.hidden = !model.hint;
  }

  /** Position next to a pointer ({x, y}) or beside an element rect ({rect}). */
  function place(at) {
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let x;
    let y;
    if (at.rect) {
      x = at.rect.right + 10;
      y = at.rect.top;
      if (x + w > vw - 8) x = at.rect.left - w - 10;
    } else if (at.above) {
      // touch: keep the finger's own row visible, show the tooltip above it
      x = at.x - w / 2;
      y = at.y - h - 28;
      if (y < 8) y = at.y + 40;
    } else {
      x = at.x + 16;
      y = at.y + 18;
      if (x + w > vw - 8) x = at.x - w - 16;
      if (y + h > vh - 8) y = at.y - h - 14;
    }
    root.style.left = `${clamp(x, 8, Math.max(8, vw - w - 8))}px`;
    root.style.top = `${clamp(y, 8, Math.max(8, vh - h - 8))}px`;
  }

  return {
    node: root,
    id: root.id,
    get visible() {
      return visible;
    },
    show(model, at, accent) {
      root.hidden = false;
      visible = true;
      fill(model, accent);
      place(at);
    },
    hide() {
      if (!visible) return;
      visible = false;
      root.hidden = true;
    },
    destroy() {
      root.remove();
    },
  };
}
