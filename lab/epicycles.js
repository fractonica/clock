/**
 * Epicycles lab: compose a ladder of period arms, set every arm's length and direction, and see the figure the pen
 * draws in one base cycle. The rules are the iOS face's (epicycles-figure.js); "Copy iOS arguments" shows the same
 * figure in the simulator. The configuration lives in the URL's hash, so a link keeps it.
 */
import { createModel } from '../src/core/model.js';
import { duration } from '../src/core/format.js';
import { levelColor, INK } from '../src/core/theme.js';
import { UNITS } from '../src/core/pure.js';
import * as fig from './epicycles-figure.js';

const model = createModel();
const factorOf = (level) => model.levelInfo(level).factor;
const letter = (level) => model.levelInfo(level).text;
const unitName = (level) => UNITS.find((u) => u.level === level)?.name ?? null;
const span = (level) => duration(model.levelInfo(level).meanSeconds);
const $ = (id) => document.getElementById(id);

const PRESETS = [
  { name: 'η → κ, the app’s default', config: fig.STANDARD },
  { name: 'η θ ι rose, from the carrier', config: { base: 6, top: 8, radii: { 6: 1, 7: 0.45, 8: 0.2 }, frame: 'carrier' } },
  { name: 'η → λ, Helion to Flavon', config: { base: 6, top: 10, radii: { 6: 1, 7: 0.35, 8: 0.15, 9: 0.08, 10: 0.04 } } },
  { name: 'η θ ι, θ turning back', config: { base: 6, top: 8, radii: { 6: 1, 7: 0.5, 8: 0.18 }, reversed: [7] } },
  { name: 'ε ζ η, the Nuclide', config: { base: 4, top: 6, radii: { 4: 1, 5: 0.5, 6: 0.12 } } },
  { name: 'δ → η, a Delta', config: { base: 3, top: 6, radii: { 3: 1, 4: 0.45, 5: 0.15, 6: 0.04 } } },
  { name: 'ι → ν, Preon to Blink', config: { base: 8, top: 12, radii: { 8: 1, 9: 0.3, 10: 0.1, 11: 0.04, 12: 0.015 } } },
  { name: 'η θ ι on ellipses', config: { base: 6, top: 8, radii: { 6: 1, 7: 0.45, 8: 0.12 }, ecc: { 6: 0.3, 7: 0.7, 8: 0.5 }, peri: { 6: 0, 7: 90, 8: 180 } } },
  { name: 'η → κ, a comet’s θ', config: { base: 6, top: 9, radii: { 6: 1, 7: 1.6, 8: 0.15, 9: 0.05 }, ecc: { 7: 0.85 }, peri: { 7: 40 } } },
];

// MARK: state

let config = fig.fromHash(location.hash) ?? fig.sanitize(fig.STANDARD);
const show = loadShow();
let phase = 0;
let playing = false;
let live = true; // the pen where the clock is now; the whole figure stands faint behind it
let loopSeconds = 20;

function loadShow() {
  const fallback = { tips: true, ghost: true, circles: true, scale: true };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem('epicycles-lab.show') ?? '{}') };
  } catch {
    return fallback;
  }
}
function saveShow() {
  try {
    localStorage.setItem('epicycles-lab.show', JSON.stringify(show));
  } catch {
    /* private window: the toggles last for the visit */
  }
}

// MARK: the figure as drawn: arms, the curve and its layers

const canvas = $('figure');
const wrap = $('canvas-wrap');
const ctx = canvas.getContext('2d');
let size = 0; // canvas pixels a side
let dpr = 1;
let figure = null; // { arms, detail, band, bandLevel, samples, tips }
let staticLayer = null;
let traceLayer = null;
let traced = -1; // the last sample index on the trace layer

/** The dial's proportions in its radius, as the iOS face's (EpicycleDial). */
const DIAL = { plate: 0.99, bezel: 0.955, quarters: 0.928, tickOuter: 0.905, tickMinor: 0.885, tickMajor: 0.866, reach: 0.8 };

function rebuildFigure() {
  const arms = fig.arms(config, factorOf);
  const d = fig.detailFor(arms, ((size / 2) * DIAL.reach) / dpr);
  const tips = fig.curve(arms, d.detail, d.samples);
  // the figure fills the reach: on ellipses the arms never all stand at their farthest at once
  let extent = 0;
  for (const tip of tips) for (let s = 0; s < tip.length; s += 2) extent = Math.max(extent, Math.hypot(tip[s], tip[s + 1]));
  figure = { arms, ...d, tips, fit: 1 / Math.max(1e-6, extent + d.band) };
  drawStatic();
  traced = -1;
}

/** Canvas pixels to a reach unit of the figure. */
const unit = () => (size / 2) * DIAL.reach * (figure?.fit ?? 1);

function layer() {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Points in canvas pixels. */
const X = (x) => size / 2 + x * unit();
const Y = (y) => size / 2 + y * unit();

function strokeCurve(g, tip, from, to) {
  g.beginPath();
  g.moveTo(X(tip[2 * from]), Y(tip[2 * from + 1]));
  for (let s = from + 1; s <= to; s++) g.lineTo(X(tip[2 * s]), Y(tip[2 * s + 1]));
  g.stroke();
}

function drawStatic() {
  staticLayer = layer();
  const g = staticLayer.getContext('2d');
  const R = size / 2;
  const c = R;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // the plate and its bezel
  g.strokeStyle = 'rgb(43 58 74 / 0.9)';
  g.lineWidth = 1.5 * dpr;
  g.beginPath();
  g.arc(c, c, R * DIAL.plate - g.lineWidth, 0, 2 * Math.PI);
  g.stroke();
  g.strokeStyle = 'rgb(31 42 54 / 0.9)';
  g.lineWidth = dpr;
  g.beginPath();
  g.arc(c, c, R * DIAL.bezel, 0, 2 * Math.PI);
  g.stroke();
  // the base cycle's scale: its children long, theirs short; its quarters in its colour
  if (show.scale) {
    const majors = factorOf(config.base);
    const minors = majors * factorOf(config.base + 1);
    const tick = (turn, r0, r1) => {
      const a = 2 * Math.PI * turn;
      g.moveTo(c + Math.sin(a) * R * r0, c - Math.cos(a) * R * r0);
      g.lineTo(c + Math.sin(a) * R * r1, c - Math.cos(a) * R * r1);
    };
    if (minors <= 400) {
      g.strokeStyle = 'rgb(163 177 191 / 0.35)';
      g.lineWidth = dpr;
      g.beginPath();
      for (let k = 0; k < minors; k++) if (k % factorOf(config.base + 1)) tick(k / minors, DIAL.tickMinor, DIAL.tickOuter);
      g.stroke();
    }
    g.strokeStyle = 'rgb(231 237 243 / 0.7)';
    g.lineWidth = 1.6 * dpr;
    g.beginPath();
    for (let k = 0; k < majors; k++) tick(k / majors, DIAL.tickMajor, DIAL.tickOuter);
    g.stroke();
    g.fillStyle = levelColor(config.base, 0.9);
    for (const q of [0, 0.25, 0.5, 0.75]) {
      const a = 2 * Math.PI * q;
      const r = R * DIAL.quarters;
      const w = 4 * dpr;
      g.save();
      g.translate(c + Math.sin(a) * r, c - Math.cos(a) * r);
      g.rotate(a);
      g.beginPath();
      g.moveTo(0, w);
      g.lineTo(-w * 0.8, -w * 0.6);
      g.lineTo(w * 0.8, -w * 0.6);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
  const { arms, detail, band, bandLevel, samples, tips } = figure;
  const pen = tips[detail];
  // the arms folded into a band: the width they sweep along the drawn path
  if (band > 0) {
    g.strokeStyle = levelColor(bandLevel, 0.1);
    g.lineWidth = Math.max(dpr, 2 * band * unit());
    strokeCurve(g, pen, 0, samples);
  }
  // the other tips' paths, faint in their levels' colours
  if (show.tips) {
    g.lineWidth = dpr;
    for (let i = 0; i < detail; i++) {
      if (arms[i].length === 0) continue;
      g.strokeStyle = levelColor(arms[i].level, 0.32);
      strokeCurve(g, tips[i], 0, samples);
    }
  }
  // the whole figure, a ghost of what the pen draws
  if (show.ghost) {
    g.strokeStyle = 'rgb(231 237 243 / 0.2)';
    g.lineWidth = dpr;
    strokeCurve(g, pen, 0, samples);
  }
  traceLayer = layer();
}

/** The pen's path from the cycle's start up to `phase`, drawn onto the trace layer as it grows. */
function drawTrace() {
  const { detail, band, bandLevel, samples, tips } = figure;
  const pen = tips[detail];
  const k = Math.min(samples, Math.floor(phase * samples));
  const g = traceLayer.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  let from = traced;
  if (k < traced || traced < 0) {
    g.clearRect(0, 0, size, size);
    from = 0;
  }
  if (k > from) {
    if (band > 0) {
      g.strokeStyle = levelColor(bandLevel, 0.22);
      g.lineWidth = Math.max(dpr, 2 * band * unit());
      strokeCurve(g, pen, from, k);
    }
    g.strokeStyle = 'rgb(231 237 243 / 0.85)';
    g.lineWidth = 1.1 * dpr;
    strokeCurve(g, pen, from, k);
  }
  traced = k;
}

function draw() {
  if (!figure) return;
  drawTrace();
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(staticLayer, 0, 0);
  ctx.drawImage(traceLayer, 0, 0);
  const { arms } = figure;
  const { joints, frames } = fig.pose(arms, phase);
  const reachPx = unit();
  ctx.lineCap = 'round';
  // each arm's orbit, its pivot at a focus, a dot at its periapsis
  if (show.circles) {
    ctx.lineWidth = dpr;
    arms.forEach((arm, i) => {
      const a = arm.length * reachPx;
      if (arm.length === 0 || a < 2 * dpr) return;
      const turn = 2 * Math.PI * (frames[i] + arm.peri);
      const u = [Math.sin(turn), -Math.cos(turn)]; // towards periapsis, canvas axes
      const fx = X(joints[i][0]);
      const fy = Y(joints[i][1]);
      ctx.strokeStyle = levelColor(arm.level, 0.28);
      ctx.beginPath();
      ctx.ellipse(fx - u[0] * a * arm.ecc, fy - u[1] * a * arm.ecc, a, a * Math.sqrt(1 - arm.ecc * arm.ecc), turn - Math.PI / 2, 0, 2 * Math.PI);
      ctx.stroke();
      if (arm.ecc > 0) {
        ctx.fillStyle = levelColor(arm.level, 0.6);
        ctx.beginPath();
        ctx.arc(fx + u[0] * a * (1 - arm.ecc), fy + u[1] * a * (1 - arm.ecc), 1.8 * dpr, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }
  // the arms, in their levels' colours, thinner as they go
  arms.forEach((arm, i) => {
    if (arm.length === 0) return;
    ctx.strokeStyle = levelColor(arm.level, 0.95);
    ctx.lineWidth = Math.max(1.2, 3 - i * 0.35) * dpr;
    ctx.beginPath();
    ctx.moveTo(X(joints[i][0]), Y(joints[i][1]));
    ctx.lineTo(X(joints[i + 1][0]), Y(joints[i + 1][1]));
    ctx.stroke();
  });
  // the hub, the joints, the pen
  ctx.fillStyle = 'rgb(231 237 243 / 0.85)';
  ctx.beginPath();
  ctx.arc(X(0), Y(0), 3.5 * dpr, 0, 2 * Math.PI);
  ctx.fill();
  for (let i = 1; i < joints.length - 1; i++) {
    if (arms[i - 1].length === 0) continue;
    ctx.fillStyle = levelColor(arms[i - 1].level, 1);
    ctx.beginPath();
    ctx.arc(X(joints[i][0]), Y(joints[i][1]), 2.2 * dpr, 0, 2 * Math.PI);
    ctx.fill();
  }
  const pen = joints[joints.length - 1];
  ctx.fillStyle = INK;
  ctx.shadowColor = 'rgb(231 237 243 / 0.8)';
  ctx.shadowBlur = 8 * dpr;
  ctx.beginPath();
  ctx.arc(X(pen[0]), Y(pen[1]), 3.2 * dpr, 0, 2 * Math.PI);
  ctx.fill();
  ctx.shadowBlur = 0;
  readout();
}

function readout() {
  const ladder = figure.arms.filter((a) => a.length > 0).map((a) => letter(a.level)).join(' ');
  const lines = [`${ladder} · ${config.frame === 'dial' ? 'from the top' : 'from the carrier'}`];
  if (live) {
    const r = model.levelAt(Date.now() / 1000, config.base);
    lines.push(r ? `live · restarts in ${duration(r.remaining)}` : 'live · outside the catalogue');
  }
  $('readout').textContent = lines.join('\n');
  $('phase').value = String(phase);
  $('phase-text').textContent = phase.toFixed(4);
}

// MARK: size

function resize() {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const px = Math.round(wrap.clientWidth * dpr);
  if (px === size || px <= 0) return;
  size = px;
  canvas.width = size;
  canvas.height = size;
  rebuildFigure();
  draw();
}
new ResizeObserver(resize).observe(wrap);

// MARK: motion

let lastFrame = 0;
let running = false;
function tick(now) {
  if (!playing && !live) {
    running = false;
    return;
  }
  if (live) {
    const r = model.levelAt(Date.now() / 1000, config.base);
    if (r) phase = r.phase;
  } else if (lastFrame) {
    phase = (phase + (now - lastFrame) / 1000 / loopSeconds) % 1;
  }
  lastFrame = now;
  draw();
  requestAnimationFrame(tick);
}
function setMotion({ play = false, follow = false }) {
  playing = play;
  live = follow;
  $('play').textContent = playing ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('live').setAttribute('aria-pressed', String(live));
  lastFrame = 0;
  if ((playing || live) && !running) {
    running = true;
    requestAnimationFrame(tick);
  }
  draw();
}

// MARK: controls

function levelOption(level) {
  const name = unitName(level);
  return `${letter(level)}${name ? ` ${name}` : ''} · ${span(level)}`;
}

function renderLadder() {
  const base = $('base');
  base.innerHTML = '';
  for (let l = 0; l <= fig.DEEPEST - 1; l++) base.add(new Option(levelOption(l), String(l), false, l === config.base));
  const top = $('top');
  top.innerHTML = '';
  const tops = fig.topsFor(config.base);
  for (let l = tops.min; l <= tops.max; l++) top.add(new Option(levelOption(l), String(l), false, l === config.top));
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-checked', String(b.dataset.frame === config.frame));
  $('frame-note').textContent =
    config.frame === 'dial'
      ? 'Each arm is a hand of its own period: up as its cycle begins, right at the peak, down at the node, left at the valley.'
      : 'Each arm continues the arm that carries it, so each of the base’s children draws one lobe.';
}

const toSlider = (r) => Math.log(r / fig.RADIUS_MIN) / Math.log(fig.RADIUS_MAX / fig.RADIUS_MIN);
const fromSlider = (v) => fig.RADIUS_MIN * (fig.RADIUS_MAX / fig.RADIUS_MIN) ** v;

function renderArms() {
  const list = $('arms');
  list.innerHTML = '';
  const arms = fig.arms(config, factorOf);
  const on = arms.filter((a) => a.length > 0).length;
  $('arms-note').textContent = `${on} of ${arms.length} on`;
  for (const arm of arms) {
    const { level } = arm;
    const isBase = level === config.base;
    const isTop = level === config.top;
    const off = config.off.includes(level);
    const r = fig.radiusOf(config, level);
    const e = fig.eccOf(config, level);
    const w = fig.periOf(config, level);
    const li = document.createElement('li');
    li.className = 'arm' + (off ? ' off' : '');
    const name = unitName(level) ?? `depth ${level + 1}`;
    const per = isBase ? 'once a cycle' : `×${arm.cycles.toLocaleString('en')} a ${letter(config.base)}`;
    li.innerHTML = `
      <span class="letter" style="color:${levelColor(level)}">${letter(level)}</span>
      <span class="name">${name} <small>· ${per} · ${span(level)}</small></span>
      <span class="tools">
        <button type="button" class="rev" aria-pressed="${arm.sign < 0}" title="Turn anticlockwise" aria-label="${letter(level)} turns anticlockwise">↺</button>
        <input type="checkbox" class="on" ${off ? '' : 'checked'} ${isTop ? 'disabled title="The pen’s arm stays on"' : 'title="On"'} aria-label="${letter(level)} on">
      </span>
      <div class="knob">
        <span>length</span>
        <input type="range" class="len" min="0" max="1" step="0.001" value="${toSlider(r)}" aria-label="${letter(level)} length">
        <input type="number" class="len-n mono" min="${fig.RADIUS_MIN}" max="${fig.RADIUS_MAX}" step="0.001" value="${+r.toPrecision(3)}" aria-label="${letter(level)} length">
      </div>
      <div class="knob">
        <span>eccentricity</span>
        <input type="range" class="ecc" min="0" max="${fig.ECC_MAX}" step="0.01" value="${e}" aria-label="${letter(level)} eccentricity">
        <input type="number" class="ecc-n mono" min="0" max="${fig.ECC_MAX}" step="0.01" value="${e}" aria-label="${letter(level)} eccentricity">
      </div>
      <div class="knob${e > 0 ? '' : ' idle'}">
        <span>periapsis</span>
        <input type="range" class="peri" min="0" max="359" step="1" value="${Math.round(w)}" aria-label="${letter(level)} periapsis direction, degrees">
        <input type="number" class="peri-n mono" min="0" max="359" step="1" value="${Math.round(w)}" aria-label="${letter(level)} periapsis direction, degrees">
      </div>`;
    li.querySelector('.len').addEventListener('input', (e) => {
      const v = fromSlider(+e.target.value);
      li.querySelector('.len-n').value = String(+v.toPrecision(3));
      change((c) => { c.radii[level] = v; }, { arms: false });
    });
    li.querySelector('.len-n').addEventListener('change', (e) => {
      const v = +e.target.value;
      if (!Number.isFinite(v)) return;
      change((c) => { c.radii[level] = v; });
    });
    // a slider and its number box set the same value; the box applies on Return or leaving it
    const pair = (cls, set, show = (v) => String(v)) => {
      li.querySelector(`.${cls}`).addEventListener('input', (ev) => {
        const v = +ev.target.value;
        li.querySelector(`.${cls}-n`).value = show(v);
        li.querySelector(`.${cls}`).closest('.knob').nextElementSibling?.classList.toggle('idle', cls === 'ecc' && v === 0);
        change((c) => set(c, v), { arms: false });
      });
      li.querySelector(`.${cls}-n`).addEventListener('change', (ev) => {
        const v = +ev.target.value;
        if (Number.isFinite(v)) change((c) => set(c, v));
      });
    };
    pair('ecc', (c, v) => { c.ecc[level] = v; });
    pair('peri', (c, v) => { c.peri[level] = v; });
    li.querySelector('.rev').addEventListener('click', () =>
      change((c) => { c.reversed = c.reversed.includes(level) ? c.reversed.filter((l) => l !== level) : [...c.reversed, level]; }));
    li.querySelector('.on').addEventListener('change', (e) =>
      change((c) => { c.off = e.target.checked ? c.off.filter((l) => l !== level) : [...c.off, level]; }));
    if (isBase && arms.length === 1) li.querySelector('.on').disabled = true;
    list.append(li);
  }
}

function renderExport() {
  if (!figure) return;
  $('ios-args').textContent = fig.launchArguments(config);
  const notes = [];
  if (fig.hasEllipses(config)) notes.push('The iOS face draws circles: the eccentricities and periapsides stay here.');
  const radii = [];
  for (let l = config.base; l <= config.top; l++) radii.push(fig.radiusOf(config, l));
  if (Math.min(...radii) / Math.max(...radii) < fig.IOS_RADIUS_MIN) notes.push('iOS keeps every arm at least 1% of the longest.');
  $('ios-note').textContent = notes.join(' ');
  $('ios-note').hidden = !notes.length;
  const { arms, detail, samples, bandLevel } = figure;
  const fastest = arms.slice(0, detail + 1).reduce((m, a) => Math.max(m, Math.abs(a.turns)), 1);
  const parts = [`The fastest arm drawn turns ${fastest.toLocaleString('en')} times a cycle, ${samples.toLocaleString('en')} samples.`];
  if (bandLevel !== null) {
    const folded = arms.slice(detail + 1).filter((a) => a.length > 0).map((a) => letter(a.level)).join(' ');
    parts.push(`${folded} ${folded.includes(' ') ? 'are' : 'is'} too fine to draw at this size: shown as the band it sweeps.`);
  }
  $('stats').textContent = parts.join(' ');
  $('preset').value = String(PRESETS.findIndex((p) => fig.toHash(fig.sanitize(p.config)) === fig.toHash(config)));
}

let pending = 0;
/** Applies a change to the configuration, then redraws (on the next frame: a slider sends many). */
function change(edit, { arms = true } = {}) {
  const next = structuredClone(config);
  edit(next);
  config = fig.sanitize(next);
  history.replaceState(null, '', '#' + fig.toHash(config));
  if (!pending) {
    pending = requestAnimationFrame(() => {
      pending = 0;
      rebuildFigure();
      renderLadder();
      if (arms) renderArms();
      else $('arms-note').textContent = `${figure.arms.filter((a) => a.length > 0).length} of ${figure.arms.length} on`;
      renderExport();
      draw();
    });
  }
}

function setBase(b) {
  change((c) => {
    const count = c.top - c.base;
    c.base = b;
    const tops = fig.topsFor(b);
    if (c.top < tops.min || c.top > tops.max) c.top = Math.min(tops.max, Math.max(tops.min, b + count));
  });
}

// MARK: export

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast('Copying is not allowed here: select the text instead');
  }
}
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function fileName(ext) {
  return `epicycles-${config.base}-${config.top}${config.frame === 'carrier' ? '-carrier' : ''}.${ext}`;
}
/** The whole figure as vector paths: the other tips' paths in their colours, the pen's in ink, on the dark plate. */
function svg() {
  const { arms, detail, samples, tips } = figure;
  const path = (tip) => {
    let d = `M${tip[0].toFixed(4)} ${tip[1].toFixed(4)}`;
    for (let s = 1; s <= samples; s++) d += `L${tip[2 * s].toFixed(4)} ${tip[2 * s + 1].toFixed(4)}`;
    return d;
  };
  const v = 1.1 / figure.fit; // the figure's extent, with a margin
  const w = (1.2 / 900) * (v / 1.1);
  const others = show.tips
    ? arms.slice(0, detail).filter((a) => a.length > 0)
        .map((a) => `<path d="${path(tips[arms.indexOf(a)])}" stroke="${levelColor(a.level, 0.5)}" stroke-width="${w}"/>`)
    : [];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-v} ${-v} ${2 * v} ${2 * v}" width="1200" height="1200">
<rect x="${-v}" y="${-v}" width="${2 * v}" height="${2 * v}" fill="#07090d"/>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
${others.join('\n')}
<path d="${path(tips[detail])}" stroke="${INK}" stroke-width="${w * 1.4}"/>
</g>
</svg>`;
}

// MARK: wiring

function init() {
  for (const [i, p] of PRESETS.entries()) $('preset').add(new Option(p.name, String(i)));
  $('preset').add(new Option('Your own', '-1'));
  $('preset').addEventListener('change', (e) => {
    const p = PRESETS[+e.target.value];
    if (p) change((c) => Object.assign(c, { radii: {}, ecc: {}, peri: {}, off: [], reversed: [], frame: 'dial', tips: true }, structuredClone(p.config)));
  });
  $('base').addEventListener('change', (e) => setBase(+e.target.value));
  $('top').addEventListener('change', (e) => change((c) => { c.top = +e.target.value; }));
  for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => change((c) => { c.frame = b.dataset.frame; }));
  for (const key of ['tips', 'ghost', 'circles', 'scale']) {
    const box = $(`show-${key}`);
    box.checked = show[key];
    box.addEventListener('change', () => {
      show[key] = box.checked;
      saveShow();
      rebuildFigure();
      draw();
    });
  }
  $('phase').addEventListener('input', (e) => {
    phase = +e.target.value;
    setMotion({});
  });
  $('play').addEventListener('click', () => setMotion({ play: !playing }));
  $('live').addEventListener('click', () => setMotion({ follow: !live }));
  $('loop').addEventListener('change', (e) => { loopSeconds = +e.target.value; });
  $('reset').addEventListener('click', () => change((c) => Object.assign(c, structuredClone(fig.STANDARD))));
  $('copy-link').addEventListener('click', () => copy(location.href, 'Link'));
  $('copy-ios').addEventListener('click', () => copy(fig.launchArguments(config), 'iOS arguments'));
  $('save-svg').addEventListener('click', () => download(fileName('svg'), new Blob([svg()], { type: 'image/svg+xml' })));
  $('save-png').addEventListener('click', () => canvas.toBlob((b) => b && download(fileName('png'), b)));
  window.addEventListener('hashchange', () => {
    const next = fig.fromHash(location.hash);
    if (next && fig.toHash(next) !== fig.toHash(config)) change((c) => Object.assign(c, next));
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      setMotion({ play: !playing });
    }
  });

  history.replaceState(null, '', '#' + fig.toHash(config));
  renderLadder();
  renderArms();
  resize();
  renderExport();
  setMotion({ follow: live });
}

init();
