/**
 * "How to read" popover: five short lines and a mini example of one glyph at its
 * three characteristic states (rising / peak / falling).
 */
import { stateInfo, signed } from './helpers.js';
import { pureHowToLines } from './pure.js';

const NS = 'http://www.w3.org/2000/svg';

function miniGlyph(spec, caption) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-2.7 -2.8 5.4 9.6');
  svg.setAttribute('class', 'face-mini-svg');
  svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'face-glyph');
  g.setAttribute('stroke-width', '0.3');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', spec.d);
  g.append(path);
  if (spec.dot) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', spec.dot.x);
    c.setAttribute('cy', spec.dot.y);
    c.setAttribute('r', spec.dot.r);
    g.append(c);
  }
  svg.append(g);
  const fig = document.createElement('figure');
  fig.className = 'face-mini';
  const cap = document.createElement('figcaption');
  cap.innerHTML = caption;
  fig.append(svg, cap);
  return fig;
}

/** The five explanatory lines, normal wording. */
const NORMAL_LINES = [
  ['teal', '<b>Glyph = phase.</b> It shows where a cycle is: the value climbs to +4, falls to −4 and returns – 16 states per cycle.'],
  ['dot', '<b>Dot = falling.</b> A dot above the stem marks the falling half; rising and the two turning points have none.'],
  ['pair', '<b>Pair = odometer.</b> The left glyph is the coarse step, the right one the fine step inside it.'],
  ['count', '<b>Counter dots</b> are the cycles of the parent period; lit up to the one you are in.'],
  ['gold', '<b>Yellow</b> is the solar sync: 19 η cycles ≈ 4 civil days, landing ~10 s earlier each time.'],
];

/**
 * (Re)write the lines for the current mode (five in normal mode, six in pure mode, which also ends with the glossary
 * pointer). `pairHTML` (ctx.pure.pairHTML) draws the example glyph pair of pure mode. Safe to call at any time: the
 * popover keeps its open / closed state.
 * @param {HTMLElement} root  the element buildHowTo() returned
 */
export function fillHowTo(root, { pure = false, pairHTML = null } = {}) {
  const list = root.querySelector('.face-pop-list');
  const lines = pure ? pureHowToLines(pairHTML ? pairHTML(13 / 16 + 4 / 256 + 1e-4, { label: 'phase' }) : '') : NORMAL_LINES;
  const items = lines.map(([kind, html]) => {
    const li = document.createElement('li');
    li.className = `face-pop-${kind}`;
    li.innerHTML = html;
    return li;
  });
  list.replaceChildren(...items);
  // the glossary pointer exists in pure mode only (the glossary is a pure-mode panel): nothing of it waits in the DOM otherwise
  const glossary = root.querySelector('.face-pop-glossary');
  glossary.hidden = !pure;
  if (pure) glossary.innerHTML = 'Press <span class="kbd">?</span> for the glossary.';
  else glossary.replaceChildren();
  if (pure) root.dataset.pure = '1';
  else delete root.dataset.pure;
}

/**
 * @param {{glyphBook: object, id: string, pure?: boolean, pairHTML?: Function}} opts
 * @returns {HTMLElement}
 */
export function buildHowTo({ glyphBook, id, pure = false, pairHTML = null }) {
  const root = document.createElement('div');
  root.className = 'face-pop card';
  root.id = id;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'How to read the clock face');
  root.tabIndex = -1;
  root.hidden = true;

  const M = (3 ** glyphBook.strokes - 1) / 2;
  const examples = [
    { index: 2, label: 'rising \u2197' },
    { index: M, label: 'peak' },
    { index: 2 * M - 2, label: 'falling \u2198' },
  ].map((e) => ({ ...e, info: stateInfo(e.index, glyphBook.strokes) }));

  const minis = document.createElement('div');
  minis.className = 'face-minis';
  for (const e of examples) {
    minis.append(miniGlyph(glyphBook.get(e.index), `<b>${e.label}</b><span class="mono dim">${signed(e.info.value)}</span>`));
  }

  const list = document.createElement('ol');
  list.className = 'face-pop-list';

  const gestures = document.createElement('p');
  gestures.className = 'face-pop-keys dim';
  gestures.innerHTML =
    'Tap above / below: longer / shorter period · middle: info · double tap: letters · hover or press and hold a row: details · keys <span class="kbd">↑</span><span class="kbd">↓</span> <span class="kbd">i</span> <span class="kbd">l</span>';

  // pure mode only (fillHowTo writes and shows it): the last thing the dialog says
  const glossary = document.createElement('p');
  glossary.className = 'face-pop-keys face-pop-glossary dim';
  glossary.hidden = true;

  const head = document.createElement('div');
  head.className = 'card-h';
  head.innerHTML = '<h3>How to read</h3><span class="spacer"></span>';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-sm btn-icon face-pop-close';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  head.append(close);

  const body = document.createElement('div');
  body.className = 'card-b';
  body.append(minis, list, gestures, glossary);
  root.append(head, body);
  fillHowTo(root, { pure, pairHTML });
  return root;
}
