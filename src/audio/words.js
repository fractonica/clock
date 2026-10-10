/**
 * Pure-mode wording of the Sound panel (docs/design/80-pure.md, revision 2): pitch as ratio, octave offset and cents,
 * with the absolute pitch in pB (cycles per Blink, the replacement of Hz); cycle lengths counted in Fractonica periods
 * (always `pure.cycleLength(level)`: "1η", "13λ", "0.14ν" for ξ, never trimmed here); real-time spans in Blinks (one
 * Blink = one ν cycle at real time, 0.311 s of the device); speeds as `pure.rateLabel(rate)` ("η per Blink");
 * progress as a pair of 2-stroke glyphs. No Hz, no note names, no seconds, no BPM, no percent, no "beat", nothing
 * Gregorian. Unit NAMES (Helion, Preon …) only appear in prose: tooltips and help.
 *
 * Everything here is a pure function (node-testable). The audio itself never changes: only what the panel says.
 * The real-time conversions (seconds <-> Blinks, Hz <-> pB) are the core's (`pure.perBlink`, `pure.pbText`,
 * `pure.secondsToBlinks`); this module only adds the panel's own grouping and sentences.
 */

/** The word for one tick of real time (= `pure.BLINK`, asserted in test/sound.test.js). */
const BLINK = 'Blink';
const NNBSP = ' ';
/** 6231 -> "6 231" with a narrow no-break space, like `pure.groupDigits` (a digit group never looks like a year). */
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
const sign = (n) => (n < 0 ? '−' : '+');

/** A plain decimal of at most `digits` significant digits, never in exponent notation. */
export function plain(v, digits = 3) {
  if (v === 0) return '0';
  const n = Number(v.toPrecision(digits));
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}

// ---------------------------------------------------------------------------------------------
// pitch: ratio, octave offset, cents, and the absolute pitch in pB
// ---------------------------------------------------------------------------------------------

/** "1625/1024": the folded ratio of a tuning row. A slash, never a colon: "65:64" would read as a time of day. */
export const ratioText = (row) => `${row.num}/${row.den}`;

/** Register of a voice above the ground, as a signed offset: "octave +1". */
export const octaveOffset = (n) => `octave ${n === 0 ? '+0' : sign(n) + Math.abs(n)}`;

/** Transposition of the physical register: "no shift", "−1 octave", "+2 octaves". */
export function octaveShift(n) {
  if (n === 0) return 'no shift';
  const a = Math.abs(n);
  return `${sign(n)}${a} octave${a === 1 ? '' : 's'}`;
}

/** Whole cents with the cent sign: "801¢". */
export const cents = (c) => `${Math.round(c)}¢`;

/** A frequency ratio for display: "×1", "×2", "×½", "×1.5", "×0.749". */
export function ratioFactor(r) {
  if (Math.abs(r - 0.5) < 1e-9) return '×½';
  if (Math.abs(r - 0.25) < 1e-9) return '×¼';
  return `×${plain(r)}`;
}

/**
 * A pitch (or any real rate) in cycles per Blink: 110 Hz -> "34.2 pB", 22.5 Hz -> "7 pB", 8 915 Hz -> "2 772 pB". Rates
 * slower than one cycle per 25 Blinks read as the core says it, "1 per 643 500 Blinks" (a cycle length is better said
 * in units: `pure.cycleLength`). `hz` is cycles per device second, the unit of the audio engine.
 */
export const pbOf = (pure, hz) => (hz > 0 && Number.isFinite(hz) ? pure.pbText(pure.perBlink(hz)) : '—');

/**
 * The base pitch slider (-12..12 steps of 100 cents around the default) as an offset of the ground:
 *   0 -> "ground ×1",  12 -> "+1 octave ×2",  -12 -> "−1 octave ×½",  7 -> "+700¢ ×1.5"
 * @returns {{head:string, sub:string}}  head: the offset, sub: the ratio it makes
 */
export function groundWords(k) {
  const sub = ratioFactor(Math.pow(2, k / 12));
  if (k === 0) return { head: 'ground', sub };
  if (Math.abs(k) === 12) return { head: `${sign(k)}1 octave`, sub };
  return { head: `${sign(k)}${Math.abs(k) * 100}¢`, sub };
}
export const groundText = (k) => {
  const { head, sub } = groundWords(k);
  return `${head} ${sub}`;
};

/** The ground in a sentence: "ground ×1" or "ground +700¢ ×1.5"; with its absolute pitch: "ground ×1, 34.2 pB". */
export function groundPhrase(k, pb = '') {
  const base = k === 0 ? groundText(k) : `ground ${groundText(k)}`;
  return pb ? `${base}, ${pb}` : base;
}

/**
 * Octave lines of the spectrum in pure mode: the ground and its octaves that fall in [fMin, fMax] (the picture's
 * frequency axis stays what it is; only the labels become pB, ratios and octave offsets of the ground).
 * @param {(hz:number)=>string} [pbText]  how a line's pitch is written in pB (`(hz) => pbOf(pure, hz)`); without it `pb` is ''
 * @returns {{f:number, k:number, ratio:string, offset:string, pb:string}[]}
 */
export function octaveGrid(baseHz, fMin, fMax, pbText = null) {
  const out = [];
  for (let k = Math.ceil(Math.log2(fMin / baseHz) - 1e-9); ; k++) {
    const f = baseHz * Math.pow(2, k);
    if (f > fMax * (1 + 1e-9)) break;
    out.push({ f, k, ratio: ratioFactor(Math.pow(2, k)), offset: k === 0 ? '0' : `${sign(k)}${Math.abs(k)}`, pb: pbText ? pbText(f) : '' });
  }
  return out;
}

/** Label of the k-th 100-cent spoke of the pitch ring (0..11): only every third one is named. */
export function spokeLabel(k) {
  if (k % 3 !== 0) return '';
  return k === 0 ? '1/1' : `${k * 100}¢`;
}

// ---------------------------------------------------------------------------------------------
// counts of Blinks, rates in pB
// ---------------------------------------------------------------------------------------------

/** A count: "0.364", "4", "12.5", "1 235", "2.63 M", "1.82 G" (digit groups with a narrow space, like the helper's). */
export function fmtCount(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 9.995e8) return `${(v / 1e9).toFixed(v >= 9.995e9 ? 1 : 2)} G`;
  if (v >= 9.995e5) return `${(v / 1e6).toFixed(v >= 9.995e6 ? 1 : 2)} M`;
  if (v >= 999.5) return group(v);
  return plain(v);
}

/** A count of Blinks written out: "4 Blinks", "1 Blink", "0.364 Blinks", "2.63 M Blinks". NaN and ∞ read "—". */
export function fmtBlinks(b) {
  if (!Number.isFinite(b)) return '—';
  if (b > 0 && b < 0.001) return `<0.001 ${BLINK}s`; // no strings of leading zeros
  const n = fmtCount(b);
  return `${n} ${n === '1' ? BLINK : BLINK + 's'}`;
}

/** A span of device (real) seconds counted in Blinks: the tempo lock, quarters, rhythm chips, chime floors. */
export const blinkSpan = (pure, seconds) => fmtBlinks(pure.secondsToBlinks(seconds));

/** The chime floor options of the select: "1.61 Blinks · default". `f` is the floor in real seconds. */
export function floorLabel(pure, f, name) {
  return `${blinkSpan(pure, f)}${name ? ' · ' + name : ''}`;
}

/**
 * The tempo lock's default in Blinks. The stored default is 4 s (normal mode); pure mode shows the clean 12 Blinks next to
 * it: one η in 12 Blinks is exactly "3ι per Blink" (η = 36 ι). Only an untouched default is replaced.
 */
export const TEMPO_DEFAULT_BLINKS = 12;

/** What the number box of the tempo lock shows for a stored length in seconds (3 digits; the untouched default is 12). */
export function tempoBlinks(pure, seconds, defaultSeconds) {
  if (Math.abs(seconds - defaultSeconds) < 1e-9) return TEMPO_DEFAULT_BLINKS;
  return Number(pure.secondsToBlinks(seconds).toPrecision(3));
}

/** The box's limits in Blinks equal to the stored limits in seconds: [0.25 s, 600 s] -> [0.8, 1930]. */
export function tempoBlinkLimits(pure, [lo, hi]) {
  return [Number(pure.secondsToBlinks(lo).toPrecision(2)), Math.round(pure.secondsToBlinks(hi))];
}

// ---------------------------------------------------------------------------------------------
// glyph pairs as spoken text
// ---------------------------------------------------------------------------------------------

/**
 * A pair of glyphs as plain text (aria-valuetext, screen-reader summaries): the very wording of the helper's own
 * accessible name, "volume 8 and 0 of 256", read out of `pure.pairHTML` so the two can never drift apart. Never the
 * "8·0" of `pairText`, which a screen reader says as the decimal 8.0.
 */
export function pairSay(pure, fraction, label) {
  return /aria-label="([^"]*)"/.exec(pure.pairHTML(fraction, { label }))?.[1] ?? `${label} of 256`;
}

// ---------------------------------------------------------------------------------------------
// speed chips
// ---------------------------------------------------------------------------------------------

/** Ids of pure.RATES offered as buttons of the Sound panel (real time plus five units per Blink). */
export const RATE_BUTTON_UNITS = Object.freeze(['lambda', 'iota', 'eta', 'zeta', 'delta']);

/**
 * Speed buttons of pure mode: [{key, label, unit, tip}]. `key` is what the click handler reads: 'live', 'rev' or the
 * numeric rate (displayed time per real time) as text. The words of a speed button are `pure.rateLabel(rate)`, the same
 * text the header's speed select shows, cut after the count so the unit can sit on its own line: "η" over "per Blink".
 * The tooltip says what passes in prose, with the unit's name: "One Helion passes every Blink".
 */
export function rateButtons(pure) {
  const rate = (id) => pure.RATES.find((r) => r.id === id).rate;
  const split = (say) => {
    const tail = ` per ${pure.BLINK}`;
    return say.endsWith(tail) ? [say.slice(0, -tail.length), tail.trim()] : [say, ''];
  };
  const speed = (r, tip) => {
    const [label, unit] = split(pure.rateLabel(r));
    return { key: String(r), label, unit, tip };
  };
  return [
    { key: 'live', label: 'Live', unit: 'follow now', tip: 'Jump to the present moment and follow it' },
    speed(1, 'Real time from the moment shown now'),
    ...RATE_BUTTON_UNITS.map((id) => speed(rate(id), `One ${pure.unitName(id)} passes every ${pure.BLINK}`)),
    { key: '0', label: 'Pause', unit: '', tip: 'Stop the clock: the drone holds, the bells wait' },
    { key: 'rev', label: 'Reverse', unit: '', tip: 'Run time backwards at the same speed: the bells play in reverse order' },
  ];
}

// ---------------------------------------------------------------------------------------------
// texts of the panel
// ---------------------------------------------------------------------------------------------

export const HOW = Object.freeze([
  ['Cycles are notes.', 'The ratios 1 : 5 : 65 : 325 … folded into one octave are the chord; a voice is loud at its cycle’s peak and silent at its valley.'],
  ['Bells are quarters.', 'One rings at each peak, node, valley and end; a cycle end strums every finer cycle ending with it, so a major turnover is a big chord.'],
  [
    'Speed makes rhythm.',
    'Real time is counted in Blinks: one Blink is one ν cycle at real time. Tempo lock sets how many Blinks one cycle lasts; its quarters become the pulses and the subdivisions 5 : 13 : 5 : 5 : 7 : 11 : 9 : 4 … (the series repeats) the rhythm.',
  ],
  ['Any moment sounds.', '“Hear this moment” plays the chord of the displayed instant, also while you scrub through time.'],
]);

/** Closing sentence of a pure-mode help text: the shell's glossary opens with the "?" button or the ? key. */
export const GLOSSARY_HINT = 'Press ? for the glossary.';

export const CAPTION =
  'Spectrum: every coloured tick is the note of one cycle, as tall as that cycle is loud right now; the vertical lines are the octaves of the ground, named by their pitch in pB (cycles per Blink) and their ratio. Ring: angle = pitch class folded into one octave, radius = depth (α outside); the corner shows the selected cycle’s pitch class in cents above the ground.';

export const LEGEND_MIXER =
  'Each row reads: depth and folded pitch ratio, then pitch in pB (cycles per Blink), octave, cents and cycle length. The coloured letter mutes a cycle; click or tap the row to select it and see where its note comes from.';

export const LEGEND_RHYTHM =
  '<b>♪</b> rings a bell on every quarter · <b>♪ end</b> rings once per cycle, on its end · no mark: too fast to ring at the current Chime floor. Up to about 9 pB such a cycle is still heard as the drone’s modulation; faster ones rest at their mean loudness. Dashed: switched off in the mixer.';

/** Tooltip of the Physical layer: the true rates of the deepest cycles in pB, whole numbers (7, 77, 693, 2 772). */
export function physicalTip(pure, rates) {
  const list = rates.map(([letter, hz]) => `${letter} ${pbOf(pure, hz)}`).join(', ');
  return `<b>Physical register</b><br>The true oscillation of the deepest cycles (${list}) as triangle waves, the glyph wave itself, transposed by whole octaves.`;
}

/** The "Now:" line of a voice tooltip in pure mode: phase and loudness are glyph pairs. */
export function nowPure(pure, live) {
  if (!live) return 'outside the catalogue';
  return `phase ${pure.pairHTML(live.phase, { label: 'phase' })} (${live.state}), loudness ${pure.pairHTML(live.loud, { label: 'loudness' })}`;
}

/**
 * Tooltip of one voice in pure mode (same teaching as normal mode, in ratios, octaves, cents, pB and Fractonica periods).
 * @param {object} row   tuning row (tuning.js buildTuning)
 * @param {object} info  model.levelInfo(L)
 * @param {object} pure  ctx.pure
 * @param {{phase:number, loud:number, state:string}|null} live
 * @param {(n:number)=>string} int  digit grouping (`pure.groupDigits`)
 * @param {string} color CSS colour of the letter
 * @param {number} [hz]  the voice's pitch now (frequencyOf(row, base)); written in pB after "Placed …"
 */
export function voiceTip({ row, info, pure, live, int, color, hz }) {
  const p = info.prefixNum;
  const place = row.octave === 0 ? 'in the ground octave' : `${row.octave} octave${row.octave > 1 ? 's' : ''} above the ground`;
  const at = hz > 0 ? `: <b class="mono">${pbOf(pure, hz)}</b>` : '';
  const truth =
    p === 1
      ? 'The slowest cycle of the hierarchy is the ground itself: 1 : 1.'
      : `${int(p)} such cycles fit in one α cycle: its true rate is <b class="mono">${int(p)} : 1</b> to α.`;
  const sounds = row.rel === 1 ? '' : `, sounding at <b class="mono">${plain(row.rel, row.rel < 10 ? 3 : 4)} : 1</b> to α`;
  return `<b style="color:${color}">${row.letter}</b> <b>depth ${row.depth}</b> · one cycle = ${pure.cycleLength(row.level)}
      <div class="snd-tip-row">${truth}</div>
      <div class="snd-tip-row">Folded into one octave: <b class="mono">${ratioText(row)}</b> = ×${plain(Number(row.num) / Number(row.den), 3)} (${row.pcCents.toFixed(1)}¢)</div>
      <div class="snd-tip-row">Placed ${place}${at}${sounds}</div>
      <div class="snd-tip-row dim">True rate of this cycle: ${pbOf(pure, row.trueHz)}</div>
      <div class="snd-tip-row">Now: ${nowPure(pure, live)}</div>`;
}
