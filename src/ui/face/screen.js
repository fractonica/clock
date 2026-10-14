/**
 * The watch screen as inline SVG (SPEC §8-§9): bezel, three glyph rows, sibling counters,
 * period letters, info labels and the out-of-catalogue state.
 *
 * The DOM is built once. Every setter compares with the last value it wrote and only then
 * touches the DOM, so the per-frame cost of an unchanged screen is a few string compares.
 * Logical units are screen pixels; the viewBox adds BEZEL px of rim on every side.
 */
import { SCREEN, BEZEL, ROWS, REGION_HALF, LABEL_DY, UNIT, INK, glyphOrigins, counterPositions, plateBox } from './helpers.js';

const NS = 'http://www.w3.org/2000/svg';
const MAX_COUNTER = 13; // largest sibling count in the harmonic sequence (SPEC §3.1)
/** A glyph fades in as a tick cue only after it has been still this long, and only briefly (SPEC §10: no blinking). */
const FLASH_CALM_MS = 1500;
const FLASH_MS = 160;

function node(name, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (kids.length) e.append(...kids);
  return e;
}
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * @param {{glyphBook: ReturnType<import('./glyphs.js').createGlyphBook>, uid: number}} opts
 */
export function createScreen({ glyphBook, uid }) {
  const id = (name) => `face-${name}-${uid}`;
  const VB = { x: -BEZEL, y: -BEZEL, w: SCREEN.w + 2 * BEZEL, h: SCREEN.h + 2 * BEZEL };

  // ---- defs ------------------------------------------------------------------------
  const defs = node(
    'defs',
    {},
    node('linearGradient', { id: id('rim'), x1: 0, y1: 0, x2: 1, y2: 1 }, ...[
      [0, '#3a4653'],
      [0.28, '#17202a'],
      [0.62, '#0b1015'],
      [1, '#2b3743'],
    ].map(([o, c]) => node('stop', { offset: o, 'stop-color': c }))),
    node('radialGradient', { id: id('glass'), cx: 0.5, cy: 0.5, r: 0.72 }, node('stop', { offset: 0, 'stop-color': '#080c10' }), node('stop', { offset: 1, 'stop-color': '#020304' })),
    node('linearGradient', { id: id('glare'), gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: SCREEN.w, y2: SCREEN.h }, ...[
      [0, 0.26],
      [0.22, 0.05],
      [0.55, 0],
      [0.9, 0.05],
      [1, 0.16],
    ].map(([o, a]) => node('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a }))),
    ...['top', 'bottom'].flatMap((side) =>
      [
        ['hover', '#ffffff', 0.075],
        ['pulse', '#4fd1c5', 0.3],
        ['block', '#ff6b6b', 0.26],
      ].map(([kind, color, a]) => {
        const y0 = side === 'top' ? 0 : SCREEN.h;
        const y1 = side === 'top' ? SCREEN.cy - REGION_HALF : SCREEN.cy + REGION_HALF;
        return node('linearGradient', { id: id(`${kind}-${side}`), gradientUnits: 'userSpaceOnUse', x1: 0, y1: y0, x2: 0, y2: y1 }, node('stop', { offset: 0, 'stop-color': color, 'stop-opacity': a }), node('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }));
      }),
    ),
    node('clipPath', { id: id('clip') }, node('rect', { x: 0, y: 0, width: SCREEN.w, height: SCREEN.h, rx: SCREEN.r })),
  );

  // ---- device (bezel + glass) -----------------------------------------------------
  const body = node('rect', { class: 'face-body', x: -5, y: -5, width: SCREEN.w + 10, height: SCREEN.h + 10, rx: SCREEN.r + 5, fill: `url(#${id('rim')})` });
  const well = node('rect', { class: 'face-well', x: -1.5, y: -1.5, width: SCREEN.w + 3, height: SCREEN.h + 3, rx: SCREEN.r + 1.5 });
  const glass = node('rect', { class: 'face-glass', x: 0, y: 0, width: SCREEN.w, height: SCREEN.h, rx: SCREEN.r, fill: `url(#${id('glass')})` });
  const glare = node('rect', {
    class: 'face-glare',
    x: 0.75,
    y: 0.75,
    width: SCREEN.w - 1.5,
    height: SCREEN.h - 1.5,
    rx: SCREEN.r - 0.75,
    fill: 'none',
    stroke: `url(#${id('glare')})`,
    'stroke-width': 1.5,
  });

  // ---- tap regions: hover wash, pressed pulse, refused (clamped) pulse ----------------------
  const regionRect = (side, cls) => {
    const top = side === 'top';
    return node('rect', {
      class: cls,
      'data-region': side,
      x: 0,
      y: top ? 0 : SCREEN.cy + REGION_HALF,
      width: SCREEN.w,
      height: top ? SCREEN.cy - REGION_HALF : SCREEN.h - SCREEN.cy - REGION_HALF,
      fill: `url(#${id(`${cls.replace('face-', '')}-${side}`)})`,
    });
  };
  const chevron = (side) => {
    const top = side === 'top';
    const y = top ? SCREEN.cy - REGION_HALF : SCREEN.cy + REGION_HALF;
    const d = top ? `M88 ${y - 8} L96 ${y - 16} L104 ${y - 8}` : `M88 ${y + 8} L96 ${y + 16} L104 ${y + 8}`;
    return node('path', { class: 'face-chevron', 'data-region': side, d });
  };
  const reg = {};
  for (const side of ['top', 'bottom']) {
    reg[side] = { hover: regionRect(side, 'face-hover'), pulse: regionRect(side, 'face-pulse'), block: regionRect(side, 'face-block'), chevron: chevron(side) };
  }
  const regions = {
    top: [reg.top.hover, reg.top.chevron],
    bottom: [reg.bottom.hover, reg.bottom.chevron],
    middle: [],
  };

  // ---- glyph rows --------------------------------------------------------------------
  const rows = {};
  for (const kind of ROWS) {
    const g = node('g', { class: `face-row face-row--${kind}`, 'data-row': kind, role: 'button', tabindex: 0 });
    const b = plateBox(kind);
    const plate = node('rect', { class: 'face-plate', x: b.x, y: b.y, width: b.w, height: b.h, rx: b.rx });
    const ink = node('g', { class: 'face-ink' });
    const glyphs = glyphOrigins(kind).map((o) => {
      const path = node('path', { d: glyphBook.get(0).d });
      const dot = node('circle', { cx: 0, cy: -1.75, r: 0.3, display: 'none' });
      const gg = node('g', { class: 'face-glyph', transform: `translate(${o.x} ${o.y}) scale(${UNIT})`, 'stroke-width': INK }, path, dot);
      ink.append(gg);
      return { g: gg, path, dot, index: -1, changedAt: -1e9, anim: null };
    });
    g.append(plate, ink);
    const row = { kind, g, plate, glyphs, sig: '', label: '', counter: null };
    if (kind !== 'solar') {
      const side = kind;
      const dots = Array.from({ length: MAX_COUNTER }, () => node('circle', { class: 'face-dot', r: 2.7, display: 'none' }));
      const cg = node('g', { class: 'face-counter' }, ...dots);
      g.append(cg);
      row.counter = { side, dots, n: -1, local: -2 };
    }
    rows[kind] = row;
  }

  // ---- letters & info labels ------------------------------------------------------------
  const cy = SCREEN.cy;
  const text = (cls, x, y, anchor = 'middle') => node('text', { class: cls, x, y, 'text-anchor': anchor });
  // pure mode adds the name of the running cycle ("Delta Trifracton", "ε#5 34η") on the side of the letter that faces the solar row
  const NAME_DY = 23;
  const letters = {
    top: { l: text('face-letter', SCREEN.cx, cy - LABEL_DY), d: text('face-letter-depth', SCREEN.cx + 15, cy - LABEL_DY + 5, 'start'), n: text('face-letter-name', SCREEN.cx, cy - LABEL_DY + NAME_DY), key: '' },
    bottom: { l: text('face-letter', SCREEN.cx, cy + LABEL_DY), d: text('face-letter-depth', SCREEN.cx + 15, cy + LABEL_DY + 5, 'start'), n: text('face-letter-name', SCREEN.cx, cy + LABEL_DY - NAME_DY), key: '' },
  };
  const lettersG = node('g', { class: 'face-overlay face-letters', 'aria-hidden': 'true' }, letters.top.l, letters.top.d, letters.top.n, letters.bottom.l, letters.bottom.d, letters.bottom.n);

  const info = {
    topCap: text('face-cap', SCREEN.cx, cy - LABEL_DY - 9),
    topVal: text('face-val face-val--teal', SCREEN.cx, cy - LABEL_DY + 7),
    solarCap: text('face-cap face-info-sol', SCREEN.cx, cy + LABEL_DY - 30),
    solarVal: text('face-val face-val--gold face-info-sol', SCREEN.cx, cy + LABEL_DY - 15),
    syncCap: text('face-cap face-info-sol', SCREEN.cx, cy + LABEL_DY + 5),
    syncVal: text('face-val face-val--gold-dim face-info-sol', SCREEN.cx, cy + LABEL_DY + 20),
  };
  const infoG = node('g', { class: 'face-overlay face-info', 'aria-hidden': 'true' }, ...Object.values(info));

  // ---- out of catalogue -------------------------------------------------------------------
  const oor = {
    l1: text('face-oor-t', SCREEN.cx, cy - 26),
    l2: text('face-oor-t', SCREEN.cx, cy - 8),
    l3: text('face-oor-r', SCREEN.cx, cy + 22),
    l4: text('face-oor-r', SCREEN.cx, cy + 38),
  };
  const oorG = node('g', { class: 'face-oor', 'aria-hidden': 'true' }, ...Object.values(oor));

  // ---- solar sync not defined next to the catalogue ends ----------------------------------------
  const na = {
    l1: text('face-cap', SCREEN.cx, cy - 7),
    l2: text('face-oor-r', SCREEN.cx, cy + 9),
    l3: text('face-oor-r', SCREEN.cx, cy + 23),
  };
  na.l1.textContent = 'SOLAR SYNC';
  const naG = node('g', { class: 'face-na', 'aria-hidden': 'true' }, ...Object.values(na));

  const content = node(
    'g',
    { 'clip-path': `url(#${id('clip')})` },
    node('g', { class: 'face-regions' }, ...['top', 'bottom'].flatMap((k) => [reg[k].hover, reg[k].pulse, reg[k].block, reg[k].chevron])),
    rows.top.g,
    rows.solar.g,
    rows.bottom.g,
    naG,
    lettersG,
    infoG,
    oorG,
  );

  const svg = node(
    'svg',
    {
      class: 'face-svg is-pending',
      xmlns: NS,
      viewBox: `${VB.x} ${VB.y} ${VB.w} ${VB.h}`,
      role: 'group',
      'aria-roledescription': 'clock face',
      'aria-label': 'Fractonica clock face',
      tabindex: 0,
      focusable: 'true',
      'data-overlay': 'none',
    },
    defs,
    node('g', { class: 'face-device' }, body, well, glass),
    content,
    glare,
  );

  // ---- setters (all idempotent) ---------------------------------------------------------------
  const cacheText = new WeakMap();
  function setText(el, value) {
    if (cacheText.get(el) !== value) {
      el.textContent = value;
      cacheText.set(el, value);
    }
  }
  /** Short tick cue on a glyph that changed after a long still period; never overlaps a previous one. */
  function flash(gl) {
    if (!gl.g.animate || reducedMotion()) return;
    gl.anim?.cancel();
    gl.anim = gl.g.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: FLASH_MS, easing: 'ease-out' });
  }

  /**
   * Update the glyphs of a row from odometer digits (coarse first). Returns true when any glyph changed.
   * `cue` = false suppresses the tick cue (time-lapse, where glyphs change faster than the cue lasts).
   */
  function setGlyphs(kind, digits, now = 0, cue = true) {
    const row = rows[kind];
    const sig = digits.join(',');
    if (row.sig === sig) return false;
    row.sig = sig;
    row.glyphs.forEach((gl, j) => {
      const index = digits[j];
      if (index === gl.index) return;
      const first = gl.index < 0;
      const calm = now - gl.changedAt > FLASH_CALM_MS;
      gl.index = index;
      gl.changedAt = now;
      const spec = glyphBook.get(index);
      gl.path.setAttribute('d', spec.d);
      if (spec.dot) gl.dot.removeAttribute('display');
      else gl.dot.setAttribute('display', 'none');
      if (!first && calm && cue) flash(gl);
      else if (gl.anim && !cue) gl.anim.cancel();
    });
    return true;
  }

  /** Light the sibling counter: `n` dots, lit through index `local`. n <= 0 hides it. */
  function setCounter(kind, n, local) {
    const c = rows[kind].counter;
    if (!c) return;
    if (c.n !== n) {
      const pos = counterPositions(Math.max(0, n), c.side);
      c.dots.forEach((dot, i) => {
        if (i < n) {
          dot.setAttribute('cx', pos[i].x.toFixed(2));
          dot.setAttribute('cy', pos[i].y.toFixed(2));
          dot.removeAttribute('display');
        } else dot.setAttribute('display', 'none');
      });
      c.n = n;
      c.local = -2;
    }
    if (c.local !== local) {
      c.dots.forEach((dot, i) => {
        if (i >= n) return;
        const lit = i <= local;
        const now = i === local;
        dot.classList.toggle('is-lit', lit);
        dot.classList.toggle('is-now', now);
        dot.setAttribute('r', now ? 4.1 : lit ? 3.3 : 2.7);
      });
      c.local = local;
    }
  }

  /** `name` (pure mode: "Delta Trifracton" or "ε#5 34η") is drawn under the letter; '' in normal mode. */
  function setLetters(top, bottom) {
    for (const [slot, v] of [
      ['top', top],
      ['bottom', bottom],
    ]) {
      const name = v.name ?? '';
      const key = `${v.letter}${v.depth}|${name}`;
      const L = letters[slot];
      if (L.key === key) continue;
      L.key = key;
      L.l.textContent = v.letter;
      L.d.textContent = String(v.depth);
      L.n.textContent = name;
    }
  }

  function setInfo(v) {
    setText(info.topCap, v.topCap);
    setText(info.topVal, v.topVal);
    setText(info.solarCap, v.solarCap);
    setText(info.solarVal, v.solarVal);
    setText(info.syncCap, v.syncCap ?? 'SYNC TIME');
    setText(info.syncVal, v.syncVal);
  }

  /**
   * Switch the wording of the static texts (normal / pure) and forget everything the other mode wrote: cached info
   * values, letter names. Called once at mount and whenever pure mode is toggled; nothing of the previous mode stays
   * in the DOM.
   */
  function setMode(pureOn, words) {
    const [o1, o2] = pureOn ? words.range.lines : ['outside Saros 141', 'catalogue'];
    setText(oor.l1, o1);
    setText(oor.l2, o2);
    const [n2, n3] = pureOn ? words.solarNa.lines : ['not defined within', '3 days of the edge'];
    setText(na.l2, n2);
    setText(na.l3, n3);
    for (const k of ['topCap', 'topVal', 'solarCap', 'solarVal', 'syncVal']) setText(info[k], '');
    setText(info.syncCap, pureOn ? 'SYNC' : 'SYNC TIME');
    for (const L of Object.values(letters)) {
      L.key = '';
      L.n.textContent = '';
    }
    if (pureOn) svg.dataset.pure = '1';
    else delete svg.dataset.pure;
    // the range lines are rewritten by the next setRange() call
    setText(oor.l3, '');
    setText(oor.l4, '');
  }

  let overlay = 'none';
  function setOverlay(mode) {
    if (overlay !== mode) {
      overlay = mode;
      svg.dataset.overlay = mode;
    }
  }

  let outOfRange = false;
  function setRange(out, from = '', to = '') {
    if (out !== outOfRange) {
      outOfRange = out;
      svg.classList.toggle('is-oor', out);
      for (const k of ROWS) rows[k].g.setAttribute('tabindex', out ? -1 : 0);
    }
    setText(oor.l3, from ? `from ${from}` : '');
    setText(oor.l4, to ? `to ${to}` : '');
  }

  /** Until the first real reading the screen shows no glyphs, so it never displays a plausible but wrong time. */
  let pending = true;
  function setPending(on) {
    if (on === pending) return;
    pending = on;
    svg.classList.toggle('is-pending', on);
  }

  let solarOk = true;
  function setSolarAvailable(ok) {
    if (ok === solarOk) return;
    solarOk = ok;
    rows.solar.g.classList.toggle('is-na', !ok);
    svg.classList.toggle('is-solar-na', !ok);
  }

  let selected = null;
  function setSelected(kind, fill = '', line = '') {
    const key = kind ? `${kind}|${fill}` : '';
    if (selected === key) return;
    selected = key;
    for (const k of ROWS) {
      const on = k === kind;
      rows[k].g.classList.toggle('is-selected', on);
      if (on) {
        rows[k].g.style.setProperty('--face-fill', fill);
        rows[k].g.style.setProperty('--face-line', line);
      } else {
        rows[k].g.style.removeProperty('--face-fill');
        rows[k].g.style.removeProperty('--face-line');
      }
    }
  }

  let hoverKey = '';
  function setHover(hit) {
    const key = hit ? `${hit.region}|${hit.row}` : '';
    if (key === hoverKey) return;
    hoverKey = key;
    for (const k of ROWS) rows[k].g.classList.toggle('is-hover', !!hit && hit.row === k);
    for (const [r, els] of Object.entries(regions)) for (const e of els) e.classList.toggle('is-hover', !!hit && hit.region === r);
  }

  /** Brief highlight of a tap region (pressed feedback); `blocked` = the step was refused. */
  function pulseRegion(region, blocked = false) {
    const r = reg[region];
    if (!r || reducedMotion()) return;
    const el = blocked ? r.block : r.pulse;
    el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: 'ease-out' });
  }

  /** Forget the shown glyphs of the two period rows (the level changed), so no tick flash plays. */
  function resetPeriodRows() {
    for (const k of ['top', 'bottom']) {
      rows[k].sig = '';
      for (const gl of rows[k].glyphs) gl.index = -1;
    }
  }

  function setRowLabel(kind, label) {
    const row = rows[kind];
    if (row.label !== label) {
      row.label = label;
      row.g.setAttribute('aria-label', label);
    }
  }
  let svgLabel = '';
  function setLabel(label) {
    if (svgLabel !== label) {
      svgLabel = label;
      svg.setAttribute('aria-label', label);
    }
  }

  return {
    svg,
    viewBox: VB,
    rows,
    setGlyphs,
    setCounter,
    setLetters,
    setInfo,
    setMode,
    setOverlay,
    setRange,
    setPending,
    setSolarAvailable,
    setSelected,
    setHover,
    pulseRegion,
    resetPeriodRows,
    setRowLabel,
    setLabel,
  };
}
