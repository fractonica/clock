/**
 * Text for the wave view: Gregorian spans, countdowns and the tooltip body. Pure functions of
 * (descriptor, times, formatter); the only markup produced is the tooltip HTML string.
 */
import { glyphIndexAt } from './geometry.js';

const YEAR = 365.25 * 86400;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * `t` rounded to a whole millisecond. fmt prints the milliseconds of an instant by rounding the
 * fraction of its second, which turns .9996 into a four-digit ".1000" without carrying into the
 * seconds; handing it an already rounded time avoids that.
 */
export const roundMs = (t) => Math.round(t * 1000) / 1000;

/**
 * A share 0..1 as text, floored (a share is never rounded up to look further along than it is) and
 * held below 100 until it really is complete: floorPercent(0.2749) = "27", floorPercent(0.1349, 1) = "13.4".
 * @param decimals digits after the point (0 or 1)
 */
export function floorPercent(frac, decimals = 0) {
  const k = decimals === 0 ? 1 : 10;
  const f = Math.min(1, Math.max(0, frac));
  let v = Math.floor(f * 100 * k + 1e-7) / k; // the epsilon keeps 0.29 * 100 = 28.999999999999996 from reading 28
  if (f < 1 && v >= 100) v = 100 - 1 / k;
  return decimals === 0 ? String(v) : v.toFixed(decimals);
}

/**
 * Where a half-arc sits among its siblings, in words that say what the number counts:
 * "1 of 11 in this ζ half-arc" (its loop number inside the half-arc that carries it) or, for α,
 * "4 of 35 in the catalogue". `d` = engine.describe().
 */
export function loopText(d) {
  return d.parent === null ? `${d.n} of ${d.of} in the catalogue` : `${d.n} of ${d.of} in this ${d.parent} half-arc`;
}

/** What the loop number counts, for a title attribute. */
export function loopHint(d) {
  return d.parent === null
    ? `Its number among the ${d.of} α half-arcs of the whole catalogue`
    : `Its number among the ${d.of} half-arcs inside its ${d.parent} half-arc: the numbered loops of the picture`;
}

/**
 * The cycle this half-arc is half of, numbered like every other view numbers it ("6 / 11"):
 * "second half of η cycle 6 / 11 in ζ", "first half of α cycle 2 / 18". A cycle is a crest followed by a
 * trough, so its two halves can sit in different parent half-arcs.
 */
export function cycleText(d) {
  return `${d.half} half of ${d.letter} cycle ${d.cycleN} / ${d.cycleOf}${d.parent === null ? '' : ' in ' + d.parent}`;
}

/** One instant at a precision that suits a span of `dur` seconds (date only beyond 2 years, ms below 10 s). */
export function instantText(fmt, t, dur) {
  if (dur >= 2 * YEAR) return fmt.date(t);
  if (dur >= 86400) return fmt.dateTime(t, { seconds: false });
  return fmt.dateTime(dur < 10 ? roundMs(t) : t, { seconds: true, ms: dur < 10 });
}

/** The two ends of a span as text: [start, end], the end without its date when it is the same day. */
export function spanParts(fmt, start, end) {
  const dur = end - start;
  if (dur < 10) {
    // the milliseconds are rounded first, so that ".9996" carries into the next second (and day) before the dates are compared
    start = roundMs(start);
    end = roundMs(end);
  }
  const a = instantText(fmt, start, dur);
  let b = instantText(fmt, end, dur);
  if (dur < 86400 && fmt.date(start) === fmt.date(end)) b = fmt.time(end, { seconds: true, ms: dur < 10 });
  return [a, b];
}

/** "2026-03-02 12:00 → 2033-01-07 04:30"; the end drops its date when it is the same day. */
export function spanText(fmt, start, end) {
  return spanParts(fmt, start, end).join(' → ');
}

/**
 * A reading led by its Pentad (SPEC §7.5) as HTML: `lead(t)` is the mark of the moment t ('' when there is none) and
 * the text is escaped here. The two keep together: a span wraps at its arrow, never between the mark and its date.
 */
export const ledHTML = (lead, t, text) => {
  const mark = lead ? lead(t) : '';
  return mark ? `<span class="pentad-lead">${mark}<span class="pentad-rest">${esc(text)}</span></span>` : esc(text);
};

/**
 * The span as HTML, each end led by the Pentad it falls in like a weekday ("⬠II 2026-10-01 09:09 → ⬠III 2026-10-09 11:40");
 * the end repeats its mark only when it is in another Pentad (a clock under its date, the way the end drops a same-day date).
 * `pentad(t)` = the Pentad of a moment ({sync, index} or null), `mark(p)` = its mark HTML.
 */
export function spanHTML(fmt, start, end, pentad, mark) {
  const [a, b] = spanParts(fmt, start, end);
  if (!pentad) return `${esc(a)} → ${esc(b)}`;
  const pa = pentad(start);
  const pb = pentad(end);
  const same = pa && pb && pa.sync === pb.sync && pa.index === pb.index;
  return `${ledHTML(pa ? () => mark(pa) : null, start, a)} → ${ledHTML(pb && !same ? () => mark(pb) : null, end, b)}`;
}

/** fmt.countdown, with milliseconds for the very short cycles: "in 12 ms", "3 min 04 s ago". */
export function countdownText(fmt, sec) {
  const a = Math.abs(sec);
  if (a < 0.9995) return sec < 0 ? `${Math.round(a * 1000)} ms ago` : `in ${Math.round(a * 1000)} ms`;
  return fmt.countdown(sec);
}

/**
 * The two "what comes next" lines of the read-out for half-arc `d` (describe()) at time t, where
 * `h` is the reading of its level: [{dim, text}, {dim, text}] (dim = the quiet lead-in words).
 * First half: the apex and the end; second half: the end and what follows. After the last half-arc
 * of the catalogue nothing follows, whatever the level (the deep levels' last arc is not clipped).
 */
export function nextLines(fmt, eng, d, h, t) {
  const ends = { dim: 'ends', text: countdownText(fmt, d.end - t) };
  if (h.local < 0.5 && !d.clipped) return [{ dim: d.apex, text: countdownText(fmt, eng.timeAt(d.level, d.idx, 0.5) - t) }, ends];
  const last = d.clipped || d.idx + 1 >= eng.halfCount(d.level);
  return [ends, last ? { dim: 'catalogue ends here', text: '' } : { dim: 'then a', text: d.crest ? 'trough' : 'crest' }];
}

/** "starts in 3 d 04 h" / "ends in 2 h 03 min" / "ended 5 min ago" relative to the displayed time. */
export function whenText(fmt, d, now) {
  if (now < d.start) return `starts ${countdownText(fmt, d.start - now)}`;
  if (now >= d.end) return `ended ${countdownText(fmt, d.end - now)}`;
  return `ends ${countdownText(fmt, d.end - now)}`;
}

/** Value, direction and label of the phase glyph state `index` (SPEC §4). */
export function glyphState(F, index, strokes = 2) {
  const g = F.CBT.fromIndex(index, { depth: strokes });
  const v = Number(g.value);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const dir = g.derivative > 0 ? 'rising ↗' : g.derivative < 0 ? 'falling ↘' : 'turning point';
  return { value: v, derivative: g.derivative, label: `${sign}${Math.abs(v)}`, dir, index, states: 4 * ((3 ** strokes - 1) / 2) };
}

/**
 * Tooltip HTML for a half-arc, a point on it or one of the level markers.
 * @param a {{d:object, p:number|null, at:number|null, now:number, fmt, model, theme,
 *            marker?:boolean, action?:string}}
 *   d = engine.describe(), p = progress 0..1 of the hovered/marked point (null = none),
 *   at = Unix time of that point.
 */
export function tipHTML({ d, p, at, now, fmt, model, theme, marker = false, action = 'Click to jump here', pentad = null, mark = null }) {
  const lines = [];
  lines.push(
    `<div class="wave-tip-h"><span class="wave-tip-badge" style="--c:${theme.levelColor(d.level, 1, 64)}">${esc(d.letter)}</span>` +
      `<b>${marker ? 'marker · ' : ''}half-arc ${esc(d.signed)}</b>` +
      `<span class="wave-tip-sign">${d.crest ? 'crest' : 'trough'}</span></div>`,
  );
  lines.push(`<div class="wave-tip-r mono">${pentad ? spanHTML(fmt, d.start, d.end, pentad, mark) : esc(spanText(fmt, d.start, d.end))}</div>`);
  lines.push(`<div class="wave-tip-r dim">${esc(loopText(d))} · ${esc(cycleText(d))}</div>`);
  const bits = [`${fmt.duration(d.duration)} long`];
  if (now >= d.start && now < d.end) bits.push(`${floorPercent((now - d.start) / d.duration)} % of this half-arc travelled`);
  lines.push(`<div class="wave-tip-r dim">${esc(bits.join(' · '))}</div>`);
  lines.push(`<div class="wave-tip-r">${esc(whenText(fmt, d, now))}</div>`);
  if (d.clipped) lines.push('<div class="wave-tip-r dim">clipped by the end of the catalogue</div>');
  if (p !== null && p !== undefined) {
    const st = glyphState(model.F, glyphIndexAt(d.idx, p));
    const svg = model.glyphSVG(st.index, { strokes: 2, color: theme.levelColor(d.level, 1, 70), scale: 4.2, thickness: 0.3, padding: 0.3 });
    lines.push(
      `<div class="wave-tip-g"><span class="wave-tip-glyph" aria-hidden="true">${svg}</span>` +
        `<span><b class="mono">${esc(st.label)}</b> ${esc(st.dir)}<br>` +
        `<span class="dim">glyph index ${st.index} (0\u2013${st.states - 1}) ${marker ? 'at the displayed time' : 'at this point'}</span>` +
        (at !== null && at !== undefined && !marker
          ? `<br><span class="mono dim">${ledHTML(pentad ? (x) => (pentad(x) ? mark(pentad(x)) : '') : null, at, instantText(fmt, at, d.duration))}</span>`
          : '') +
        '</span></div>',
    );
  }
  if (action) lines.push(`<div class="wave-tip-a">${esc(action)}</div>`);
  return lines.join('');
}
