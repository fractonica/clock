/**
 * The solar dial: a strip between the read-out and the stage that shows the solar sync at every depth, also where
 * the focused arc is too short (or too long) to carry its ripple. A mini wave of one sync with its four quarter
 * points (peak, node, valley, end), the dot at the present phase, the sync number, the phase (a percentage in
 * normal mode, a pair of glyphs in pure mode), the next quarter and, where the ripple is not drawn, a hint of the
 * depths that carry it. Click or drag the wave to travel within the sync (arrow keys, Page and Home / End do the same
 * from the keyboard; a click focuses the slider, and focus by key shows the tooltip with the drift and the definition).
 * The DOM is written only when something changed.
 */
import { dialShape, dialState } from './solar.js';

const W = 220;
const H = 30;

/**
 * @param stage the stage element: the dial is inserted just before it
 * @param o {{words:object, onScrub:(phase:number)=>void, onHover:(on:boolean, e:PointerEvent)=>void,
 *            onFocus?:(on:boolean)=>void}}  onFocus: the slider has (or lost) keyboard focus
 */
export function createSunDial(stage, { words, onScrub, onHover, onFocus = () => {} }) {
  const shape = dialShape(W, H);
  const el = document.createElement('div');
  el.className = 'wave-sun';
  el.hidden = true;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Solar sync');
  const q = shape.quarters
    .map((p) => `<circle class="wave-sun-q" data-k="${p.k}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2.2"/>`)
    .join('');
  el.innerHTML =
    `<div class="wave-sun-h"><i class="wave-sun-dot" aria-hidden="true"></i><span class="wave-sun-t">Solar sync</span><b class="wave-sun-n mono"></b></div>` +
    `<svg class="wave-sun-svg" viewBox="0 0 ${W} ${H}" role="slider" tabindex="0" aria-label="Phase of the solar sync: arrow keys travel within it" aria-description="${words.sunKeys()}" aria-valuemin="0" aria-valuemax="255" aria-valuenow="0">` +
    `<line class="wave-sun-axis" x1="${shape.padX}" x2="${W - shape.padX}" y1="${shape.cy}" y2="${shape.cy}"/>` +
    `<path class="wave-sun-base" d="${shape.path}"/>` +
    `<path class="wave-sun-done" d="${shape.path}" pathLength="1" stroke-dasharray="0 1"/>` +
    q +
    `<g class="wave-sun-mark"><circle class="wave-sun-ring" r="6"/><circle class="wave-sun-pt" r="3.6"/></g>` +
    `</svg>` +
    `<div class="wave-sun-ph"></div><div class="wave-sun-nx mono"></div><div class="wave-sun-hint"></div>`;
  stage.before(el);

  const $ = (s) => el.querySelector(s);
  const svg = $('.wave-sun-svg');
  const done = $('.wave-sun-done');
  const mark = $('.wave-sun-mark');
  const qs = [...el.querySelectorAll('.wave-sun-q')];
  const R = { n: $('.wave-sun-n'), ph: $('.wave-sun-ph'), nx: $('.wave-sun-nx'), hint: $('.wave-sun-hint') };
  const last = {};
  const setText = (key, node, str) => {
    if (last[key] !== str) {
      node.textContent = str;
      last[key] = str;
    }
  };
  const setHTML = (key, node, html) => {
    if (last[key] !== html) {
      node.innerHTML = html;
      last[key] = html;
    }
  };
  const setAttr = (key, node, name, v) => {
    if (last[key] !== v) {
      node.setAttribute(name, v);
      last[key] = v;
    }
  };

  // ---- travel within the sync: click or drag along the wave
  let dragging = false;
  let pointerAt = -Infinity; // when a pointer last pressed the dial: a focus right after it is not "by keyboard"
  const phaseOf = (e) => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return null;
    const x = ((e.clientX - r.left) / r.width) * W;
    return Math.min(1, Math.max(0, (x - shape.padX) / shape.W));
  };
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointerAt = performance.now();
    // preventDefault below would keep the browser from focusing the slider, and then the arrow keys would do nothing
    svg.focus({ preventScroll: true });
    if (!last.live) return;
    dragging = true;
    svg.setPointerCapture?.(e.pointerId);
    const p = phaseOf(e);
    if (p !== null) onScrub(p);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = phaseOf(e);
    if (p !== null) onScrub(p);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      svg.releasePointerCapture?.(e.pointerId);
    } catch {
      /* capture already gone */
    }
  };
  // keyboard: arrows travel by 1/32 of the sync, Page keys by a quarter, Home / End to its start / end
  svg.addEventListener('keydown', (e) => {
    if (!last.live || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = { ArrowRight: 1 / 32, ArrowUp: 1 / 32, ArrowLeft: -1 / 32, ArrowDown: -1 / 32, PageUp: 1 / 4, PageDown: -1 / 4 }[e.key];
    let p;
    if (step !== undefined) p = Math.min(1, Math.max(0, last.phase + step));
    else if (e.key === 'Home') p = 0;
    else if (e.key === 'End') p = 1;
    else return;
    e.preventDefault();
    onFocus(true); // a key press shows what the tooltip shows on hover: sync, phase, next quarter, drift
    onScrub(p);
  });
  svg.addEventListener('focus', () => onFocus(performance.now() - pointerAt > 400));
  svg.addEventListener('blur', () => onFocus(false));
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  el.addEventListener('pointerenter', (e) => onHover(true, e));
  el.addEventListener('pointermove', (e) => onHover(true, e));
  el.addEventListener('pointerleave', (e) => onHover(false, e));

  return {
    el,
    get visible() {
      return !el.hidden;
    },
    setVisible(on) {
      if (el.hidden !== !on) el.hidden = !on;
    },
    /** Forget every cached text (the mode changed). */
    reset() {
      for (const k of Object.keys(last)) delete last[k];
    },
    /** One-line hint under the dial ('' hides it). */
    setHint(text) {
      setText('hint', R.hint, text);
      R.hint.hidden = !text;
    },
    /**
     * Show a reading. `sun` = model.solarAt(t) (or null near the catalogue edges); the dot and the bright part of the
     * wave move on every call, the texts only when they change.
     */
    update(sun, t) {
      last.live = !!sun;
      last.phase = sun ? sun.phase : 0;
      if (!sun) {
        setText('n', R.n, '—');
        setHTML('ph', R.ph, '');
        setText('nx', R.nx, words.sunEdge());
        mark.style.display = 'none';
        done.setAttribute('stroke-dasharray', '0 1');
        el.dataset.state = 'edge';
        setAttr('aria', el, 'aria-label', words.sunAria(null, t));
        setAttr('aria-d', svg, 'aria-disabled', 'true');
        // no phase to report: a value left from the last live reading would be spoken as the current one
        for (const [key, name] of [['aria-n', 'aria-valuenow'], ['aria-t', 'aria-valuetext']]) {
          svg.removeAttribute(name);
          delete last[key];
        }
        return;
      }
      el.dataset.state = 'live';
      const st = dialState(shape, sun);
      mark.style.display = '';
      const tr = `translate(${st.x.toFixed(2)} ${st.y.toFixed(2)})`;
      if (last.tr !== tr) {
        mark.setAttribute('transform', tr);
        last.tr = tr;
      }
      const dash = `${st.dash} 1`;
      if (last.dash !== dash) {
        done.setAttribute('stroke-dasharray', dash);
        last.dash = dash;
      }
      setText('n', R.n, words.sunNumber(sun));
      setHTML('ph', R.ph, words.share(sun.phase, 'sync phase'));
      setText('nx', R.nx, words.sunNext(sun, t));
      // the quarters already passed are filled, the coming one is ringed
      const state = `${sun.quarter}:${sun.threshold.name}`;
      if (last.q !== state) {
        last.q = state;
        qs.forEach((c, i) => {
          const q = st.quarters[i];
          c.classList.toggle('is-past', q.past);
          c.classList.toggle('is-next', q.next);
          c.setAttribute('r', String(q.r));
        });
      }
      setAttr('aria', el, 'aria-label', words.sunAria(sun, t));
      setAttr('aria-d', svg, 'aria-disabled', 'false');
      setAttr('aria-n', svg, 'aria-valuenow', String(st.valuenow));
      setAttr('aria-t', svg, 'aria-valuetext', words.sunPhaseText(sun));
    },
    destroy() {
      el.remove();
    },
  };
}
