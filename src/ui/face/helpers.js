/**
 * Pure helpers for the clock face (SPEC §8-§10): geometry of the 192 x 490 watch
 * screen, hit regions, glyph state wording, tooltip text and SVG fitting.
 *
 * Nothing here touches the DOM or the clock library, so it is unit-tested in
 * test/face.test.js. All lengths are logical screen pixels (1 design unit = 10 px).
 */

// ---- screen geometry (SPEC §8, §9.2) ------------------------------------------
export const SCREEN = Object.freeze({ w: 192, h: 490, r: 96, cx: 96, cy: 245 });
/** Pixels per design unit; 0.3 units of ink = 3 px (odd, so stems stay crisp). */
export const UNIT = 10;
export const INK = 0.3;
/** Extra viewBox margin around the screen that holds the bezel. */
export const BEZEL = 6;

export const MIN_TOP_DEPTH = 2;
export const MAX_TOP_DEPTH = 11;

/** Period pairs sit +-165 px from the centre, letters / labels +-90 px. */
export const PERIOD_DY = 165;
export const LABEL_DY = 90;
/** Distance between glyph stems: 80 px in period pairs, 64 px in the 3-glyph solar odometer. */
export const PERIOD_DX = 80;
export const SOLAR_DX = 64;
/**
 * A 2-stroke glyph frame is 90 px tall with its origin on row 24.5 (SPEC §9.2), so the
 * origin sits 20.5 px above the frame centre. Stems are shifted by half a pixel so that
 * a 3 px stroke covers whole pixel columns at integer device scales.
 */
export const FRAME_ORIGIN_DY = 20.5;
export const PIXEL_SHIFT = 0.5;

export const COUNTER_RADIUS = SCREEN.w / 2 - 10; // 86
export const COUNTER_STEP_DEG = 11.5;

/** Beyond this distance from the centre a tap belongs to the top / bottom region. */
export const REGION_HALF = 100;

export const ROWS = Object.freeze(['top', 'solar', 'bottom']);
const ROW_CENTER = Object.freeze({ top: SCREEN.cy - PERIOD_DY, solar: SCREEN.cy, bottom: SCREEN.cy + PERIOD_DY });
/** Hit / highlight plate of each glyph row (clipped by the pill outline when drawn). */
export const ROW_BOX = Object.freeze(
  Object.fromEntries(ROWS.map((k) => [k, Object.freeze({ x: 22, y: ROW_CENTER[k] - 46, w: 148, h: 92 })])),
);

/**
 * The visible plate of a row (hover / selected / focus) is inset from its hit box so its rounded
 * corners stay clear of the sibling-counter dots, which sit on the 86 px arcs next to the corners.
 */
export const PLATE_INSET = 8;
export const PLATE_RX = 22;
export const plateBox = (kind) => {
  const b = ROW_BOX[kind];
  return { x: b.x + PLATE_INSET, y: b.y, w: b.w - 2 * PLATE_INSET, h: b.h, rx: PLATE_RX };
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Top depth clamped to the watch range 2..11 (SPEC §10). Anything that is not a number (null, '', NaN, objects) falls back to 7. */
export function clampDepth(d) {
  const isNum = typeof d === 'number' || (typeof d === 'string' && d.trim() !== '');
  const n = isNum ? Math.round(Number(d)) : NaN;
  return Number.isFinite(n) ? clamp(n, MIN_TOP_DEPTH, MAX_TOP_DEPTH) : 7;
}
/** New top depth after pressing "longer" (dir -1) or "shorter" (dir +1). */
export const stepDepth = (depth, dir) => clampDepth(depth + dir);
/** 0-based levels shown by a top depth: depth D is level D-1 (top), depth D+1 is level D (bottom). */
export const levelsFor = (topDepth) => ({ top: clampDepth(topDepth) - 1, bottom: clampDepth(topDepth) });

/** Origins (glyph stem top, screen px) of the glyphs of a row, left = coarse. */
export function glyphOrigins(row) {
  const n = row === 'solar' ? 3 : 2;
  const dx = row === 'solar' ? SOLAR_DX : PERIOD_DX;
  const y = ROW_CENTER[row] - FRAME_ORIGIN_DY;
  return Array.from({ length: n }, (_, j) => ({ x: SCREEN.cx + PIXEL_SHIFT + (j - (n - 1) / 2) * dx, y }));
}

/**
 * Positions of the sibling-counter dots: `count` dots on an arc concentric with the
 * rounded screen end, centred on the vertical axis, read left to right.
 * @param {'top'|'bottom'} side
 */
export function counterPositions(count, side) {
  const cy = side === 'top' ? SCREEN.r : SCREEN.h - SCREEN.r;
  return Array.from({ length: count }, (_, i) => {
    const deg = (i - (count - 1) / 2) * COUNTER_STEP_DEG;
    const a = (deg * Math.PI) / 180;
    return {
      x: SCREEN.cx + COUNTER_RADIUS * Math.sin(a),
      y: side === 'top' ? cy - COUNTER_RADIUS * Math.cos(a) : cy + COUNTER_RADIUS * Math.cos(a),
      deg,
    };
  });
}

/** Is a logical point on the pill-shaped screen? */
export function insideScreen(x, y) {
  if (x < 0 || x > SCREEN.w || y < 0 || y > SCREEN.h) return false;
  const cyTop = SCREEN.r;
  const cyBottom = SCREEN.h - SCREEN.r;
  if (y < cyTop) return (x - SCREEN.cx) ** 2 + (y - cyTop) ** 2 <= SCREEN.r ** 2;
  if (y > cyBottom) return (x - SCREEN.cx) ** 2 + (y - cyBottom) ** 2 <= SCREEN.r ** 2;
  return true;
}

const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Inner radius of the band around the sibling counter arcs (dots sit at 86 px, +-12 px tolerance). */
export const RING_INNER = COUNTER_RADIUS - 12;
/** Which counter arc band a point is in: 'top' / 'bottom' / null. */
export function ringAt(x, y) {
  const yTop = SCREEN.r;
  const yBottom = SCREEN.h - SCREEN.r;
  if (y < yTop) {
    const d = Math.hypot(x - SCREEN.cx, y - yTop);
    return d >= RING_INNER && d <= SCREEN.r ? 'top' : null;
  }
  if (y > yBottom) {
    const d = Math.hypot(x - SCREEN.cx, y - yBottom);
    return d >= RING_INNER && d <= SCREEN.r ? 'bottom' : null;
  }
  return null;
}

/**
 * Which tap region and glyph row a logical screen point belongs to.
 * @returns {null | {region:'top'|'middle'|'bottom', row:'top'|'solar'|'bottom'|null, ring:'top'|'bottom'|null}}
 *   `ring` is set over the sibling-counter arcs (their tooltip is the period's). null when the
 *   point is outside the pill (bezel, margin).
 */
export function hitTest(x, y) {
  if (!insideScreen(x, y)) return null;
  const region = y < SCREEN.cy - REGION_HALF ? 'top' : y > SCREEN.cy + REGION_HALF ? 'bottom' : 'middle';
  const row = ROWS.find((k) => inBox(ROW_BOX[k], x, y)) ?? null;
  return { region, row, ring: ringAt(x, y) };
}

/** Client (CSS px) to logical SVG coordinates for an element box showing `viewBox` 1:1 (no letterboxing). */
export function clientToLogical(rect, clientX, clientY, viewBox) {
  return {
    x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w,
    y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h,
  };
}

// ---- glyph states (SPEC §4.1) ---------------------------------------------------
export const MINUS = '−';
/** "+3", "−3", "0" */
export const signed = (v) => (v > 0 ? `+${v}` : v < 0 ? `${MINUS}${-v}` : '0');
/** An integer with a true minus sign for negatives: "4820", "−32927". */
export const intText = (n) => (n < 0 ? `${MINUS}${-n}` : String(n));
/**
 * Phase as "35.8": floored to 0.1 %, like the rings text, so a running cycle never reads "100.0" and the same
 * instant reads the same number everywhere ("100.0" only once the phase has really reached 1). The epsilon keeps
 * exact tenths such as 0.29 from flooring one tenth too low.
 */
export function percentText(phase) {
  if (phase >= 1) return '100.0';
  if (!(phase > 0)) return '0.0';
  const tenths = Math.min(999, Math.max(0, Math.floor(phase * 1000 + 1e-7)));
  return (tenths / 10).toFixed(1);
}

/**
 * Value, direction and dot of glyph state `index` for a glyph of `strokes` strokes.
 * @returns {{index:number, states:number, M:number, value:number, derivative:-1|0|1,
 *   dotted:boolean, kind:'rising'|'peak'|'falling'|'valley'}}
 */
export function stateInfo(index, strokes = 2) {
  const M = (3 ** strokes - 1) / 2;
  const states = 4 * M;
  const i = ((Math.trunc(index) % states) + states) % states;
  let value;
  let derivative;
  if (i < M) [value, derivative] = [i, 1];
  else if (i === M) [value, derivative] = [M, 0];
  else if (i < 3 * M) [value, derivative] = [2 * M - i, -1];
  else if (i === 3 * M) [value, derivative] = [-M, 0];
  else [value, derivative] = [i - 4 * M, 1];
  const kind = derivative === 0 ? (value > 0 ? 'peak' : 'valley') : derivative > 0 ? 'rising' : 'falling';
  return { index: i, states, M, value, derivative, dotted: derivative < 0, kind };
}

/** "value −3, rising ↗" */
export function describeState(s) {
  switch (s.kind) {
    case 'rising':
      return `value ${signed(s.value)}, rising ↗`;
    case 'falling':
      return `value ${signed(s.value)}, falling ↘ (dot)`;
    case 'peak':
      return `peak, value ${signed(s.value)}`;
    default:
      return `valley, value ${signed(s.value)}`;
  }
}

// ---- overlays (letters / info labels, SPEC §8, §10) ------------------------------
export const LETTER_MS = 4000;
export const INFO_MS = 4000;
export const DOUBLE_TAP_MS = 400;

/** Which overlay to show: info labels replace the letters while they are visible. */
export function overlayMode({ now, infoUntil = 0, lettersUntil = 0, showLetters = false }) {
  if (now < infoUntil) return 'info';
  if (showLetters || now < lettersUntil) return 'letters';
  return 'none';
}

/**
 * Tap classifier: given the previous tap and this one, what should a middle tap do?
 * Two taps in the middle within 400 ms toggle the letters; one shows the info labels.
 */
export function middleTapAction(prev, now, windowMs = DOUBLE_TAP_MS) {
  return prev && prev.region === 'middle' && now - prev.time <= windowMs ? 'letters' : 'info';
}

/**
 * A middle tap with its bookkeeping: `action` as above, and `last` = the tap record to remember.
 * A double tap consumes the sequence (`last` = null), so a quick third tap starts a new one
 * instead of toggling the letters back.
 */
export function middleTap(prev, now, windowMs = DOUBLE_TAP_MS) {
  const action = middleTapAction(prev, now, windowMs);
  return { action, last: action === 'letters' ? null : { region: 'middle', time: now } };
}

/** Text of the quarter threshold caption, e.g. "NEXT PEAK". */
export const thresholdCaption = (name) => `NEXT ${String(name ?? '').toUpperCase()}`.trim();

// ---- tooltips ------------------------------------------------------------------------
/** Hint line of a period row: what a click (or Enter) does. `step` = -1 / +1 when the click also changes the depth. */
function rowHint(d) {
  if (d.by === 'key') return 'Enter: select this cycle in every view';
  const base = 'Click or tap: select this cycle in every view';
  if (d.step < 0) return `${base} and show longer periods`;
  if (d.step > 0) return `${base} and show shorter periods`;
  return base;
}

/**
 * Tooltip model of a period row.
 * @param {object} d  {letter, depth, meanSeconds, state(stateInfo), fineIndex, fineNext, majorNext,
 *   cycleEnd, local, siblings, parentLetter, now, step?: -1|0|1 (a click also steps the depth),
 *   by?: 'key' (opened by keyboard focus)}
 * @param {object} fmt  ctx.fmt (label, duration, countdown)
 */
export function periodTooltip(d, fmt) {
  const s = d.state;
  const lines = [`State ${s.index} of ${s.states}: ${describeState(s)}`];
  lines.push(`Right (fine) glyph: state ${d.fineIndex} of ${s.states}` + (d.fineNext != null ? `, changes at ${fmt.label(d.fineNext, d.now)}` : ''));
  if (d.majorNext != null) lines.push(`Next change ${fmt.label(d.majorNext, d.now)} (${fmt.countdown(d.majorNext - d.now)})`);
  if (d.siblings != null) {
    lines.push(
      `Cycle ${d.local + 1} of ${d.siblings}` + (d.parentLetter ? ` in its ${d.parentLetter}` : '') + (d.cycleEnd != null ? ` · ends ${fmt.label(d.cycleEnd, d.now)}` : ''),
    );
  }
  return {
    title: `${d.letter} · depth ${d.depth}`,
    aside: `≈ ${fmt.duration(d.meanSeconds)} per cycle`,
    lines,
    hint: rowHint(d),
  };
}

/** Tooltip model of the solar odometer ({sync, phase, drift, thresholdName, thresholdTime, start, now, by?: 'key'}). */
export function solarTooltip(d, fmt) {
  const drift = (d.drift > 0 ? '+' : '') + fmt.duration(d.drift);
  const lines = [
    `Phase ${percentText(d.phase)} % of this 4-day sync`,
    `Drift against civil days ${drift}`,
    `Next ${d.thresholdName} ${fmt.label(d.thresholdTime, d.now)}`,
    `Sync time ${fmt.label(d.start, d.now)}`,
  ];
  const hint = d.by === 'key' ? 'Enter: show the info labels · key l: keep the letters' : 'Click or tap: info labels · double tap: letters';
  return { title: `Solar sync #${intText(d.sync)}`, aside: '19 η cycles ≈ 4 days', lines, hint };
}

/** One-line hint for a tap region (shown after the pointer rests on it). */
export function regionHint(region, { topDepth, letters }) {
  const at = (d) => (letters?.[d] ? `${letters[d]}, depth ${d}` : `depth ${d}`);
  if (region === 'top') return topDepth <= MIN_TOP_DEPTH ? `Longest period shown: ${at(MIN_TOP_DEPTH)}` : `Click or tap: longer period, top becomes ${at(topDepth - 1)}`;
  if (region === 'bottom') return topDepth >= MAX_TOP_DEPTH ? `Shortest pair shown: ${at(MAX_TOP_DEPTH)} over ${at(MAX_TOP_DEPTH + 1)}` : `Click or tap: shorter period, top becomes ${at(topDepth + 1)}`;
  return 'Click or tap: info labels · double tap: period letters';
}

/** Accessible label of a glyph row. */
export function rowAriaLabel(kind, d) {
  if (kind === 'solar') return `Solar sync ${intText(d.sync)}, ${percentText(d.phase)} percent, glyphs ${d.digits.join(', ')}. Activate to show the info labels`;
  const plain = describeState(d.state).replace(/\s*[\u2197\u2198]/g, '');
  const cycle = d.siblings != null ? `, cycle ${d.local + 1} of ${d.siblings}` : '';
  return `${d.letter} depth ${d.depth}: state ${d.state.index} of ${d.state.states}, ${plain}${cycle}. Activate to select this depth`;
}

/**
 * What a screen reader hears when the info labels are shown. `m` is the label model
 * {topCap, topVal, solarCap, solarVal, syncVal, solarOk}; the dash placeholder reads "not defined".
 */
export function infoSpeech(m) {
  const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  const val = (v) => (v === '\u2014' ? 'not defined' : v);
  const top = `${sentence(m.topCap)} of the top period: ${val(m.topVal)}.`;
  if (!m.solarOk) return `${top} Solar sync: not defined within 3 days of the catalogue edge.`;
  return `${top} ${sentence(m.solarCap)} of the solar sync: ${val(m.solarVal)}. Sync time: ${val(m.syncVal)}.`;
}

// ---- fitting the SVG into its stage ----------------------------------------------------
/**
 * Size and position of the face SVG inside a stage of `width` x `height` CSS px.
 * The SVG's viewBox is the screen plus `margin` of bezel on every side. When the fit
 * scale is within `snapTolerance` of a whole number of device pixels per logical pixel,
 * that integer scale is used so 3 px strokes land on pixel columns (SPEC §9.2).
 */
export function layoutFit({ width, height, dpr = 1, margin = BEZEL, snap = true, snapTolerance = 0.9 }) {
  const lw = SCREEN.w + 2 * margin;
  const lh = SCREEN.h + 2 * margin;
  const fit = Math.min(width / lw, height / lh);
  if (!(fit > 0) || !Number.isFinite(fit)) return { scale: 0, width: 0, height: 0, left: 0, top: 0, snapped: false };
  let scale = fit;
  let snapped = false;
  if (snap && fit * dpr >= 1) {
    const s = Math.floor(fit * dpr) / dpr;
    if (s >= fit * snapTolerance) {
      scale = s;
      snapped = true;
    }
  }
  const w = lw * scale;
  const h = lh * scale;
  const round = (v) => (snapped ? Math.round(v * dpr) / dpr : v);
  return { scale, width: w, height: h, left: round((width - w) / 2), top: round((height - h) / 2), snapped };
}
