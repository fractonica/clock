/**
 * Pure-mode wording of the Sound panel (docs/design/80-pure.md): pitch as ratio, octave offset and cents; cycle lengths
 * counted in Fractonica periods (always `pure.cycleLength(level)`: "2ζ½", "1η", never trimmed here); real-time spans in
 * "beats" (one beat = one tick of the device's real time); speeds as `pure.rateLabel(rate)`; progress as a pair of
 * 2-stroke glyphs. No Hz, no note names, no seconds, no BPM, no percent, nothing Gregorian.
 *
 * Everything here is a pure function (node-testable). The audio itself never changes: only what the panel says.
 */

const GROUP = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
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
// pitch: ratio, octave offset, cents
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

/** The ground in a sentence: "ground ×1" or "ground +700¢ ×1.5". */
export const groundPhrase = (k) => (k === 0 ? groundText(k) : `ground ${groundText(k)}`);

/**
 * Octave lines of the spectrum in pure mode: the ground and its octaves that fall in [fMin, fMax] (the picture's
 * frequency axis stays what it is; only the labels become ratios and octave offsets of the ground).
 * @returns {{f:number, k:number, ratio:string, offset:string}[]}
 */
export function octaveGrid(baseHz, fMin, fMax) {
  const out = [];
  for (let k = Math.ceil(Math.log2(fMin / baseHz) - 1e-9); ; k++) {
    const f = baseHz * Math.pow(2, k);
    if (f > fMax * (1 + 1e-9)) break;
    out.push({ f, k, ratio: ratioFactor(Math.pow(2, k)), offset: k === 0 ? '0' : `${sign(k)}${Math.abs(k)}` });
  }
  return out;
}

/** Label of the k-th 100-cent spoke of the pitch ring (0..11): only every third one is named. */
export function spokeLabel(k) {
  if (k % 3 !== 0) return '';
  return k === 0 ? '1/1' : `${k * 100}¢`;
}

// ---------------------------------------------------------------------------------------------
// counts of beats and rates per beat
// ---------------------------------------------------------------------------------------------

/** A count: "0.364", "4", "12.5", "1,234", "2.63 M", "1.82 G". */
export function fmtCount(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 9.995e8) return `${(v / 1e9).toFixed(v >= 9.995e9 ? 1 : 2)} G`;
  if (v >= 9.995e5) return `${(v / 1e6).toFixed(v >= 9.995e6 ? 1 : 2)} M`;
  if (v >= 999.5) return GROUP.format(v);
  return plain(v);
}

/** A span of device time counted in beats: "4 beats", "1 beat", "0.364 beats", "2.63 M beats". */
export function fmtBeats(b) {
  if (b > 0 && b < 0.001) return '<0.001 beats'; // no strings of leading zeros
  const n = fmtCount(b);
  return `${n} ${n === '1' ? 'beat' : 'beats'}`;
}

/** The true rate of a cycle: "22.5 cycles per beat", "1 cycle per 12.1 beats", "1 cycle per 1.4 M beats". */
export function fmtPerBeat(hz) {
  if (!(hz > 0) || !Number.isFinite(hz)) return '—';
  if (Math.abs(hz - 1) < 0.005) return '1 cycle per beat';
  if (hz >= 1) return `${fmtRatePlain(hz)} cycles per beat`;
  const every = fmtCount(1 / hz);
  return `1 cycle per ${every} ${every === '1' ? 'beat' : 'beats'}`;
}
/** The bare number of a rate that is at least one per beat: "22.5", "247.7", "2,230". */
export function fmtRatePlain(hz) {
  if (hz >= 999.95) return GROUP.format(hz);
  if (hz >= 99.995) return hz.toFixed(1);
  return hz.toFixed(2);
}

/** The chime floor options of the select: "0.5 beats · default". */
export function floorLabel(f, name) {
  return `${fmtBeats(f)}${name ? ' · ' + name : ''}`;
}

// ---------------------------------------------------------------------------------------------
// cycle lengths in Fractonica periods
// ---------------------------------------------------------------------------------------------

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

/** Ids of pure.RATES offered as buttons of the Sound panel (real time plus five units per beat). */
export const RATE_BUTTON_UNITS = Object.freeze(['lambda', 'iota', 'eta', 'zeta-half', 'delta-half']);

/**
 * Speed buttons of pure mode: [{key, label, unit, tip}]. `key` is what the click handler reads: 'live', 'rev' or the
 * numeric rate (displayed time per real time) as text. The words of a speed button are `pure.rateLabel(rate)`, the same
 * text the header's speed select shows, cut after the count so the unit can sit on its own line: "η" over "per beat".
 */
export function rateButtons(pure) {
  const rate = (id) => pure.RATES.find((r) => r.id === id).rate;
  const split = (say) => {
    const tail = ` per ${pure.BEAT}`;
    return say.endsWith(tail) ? [say.slice(0, -tail.length), tail.trim()] : [say, ''];
  };
  const speed = (r, tip) => {
    const [label, unit] = split(pure.rateLabel(r));
    return { key: String(r), label, unit, tip };
  };
  return [
    { key: 'live', label: 'Live', unit: 'follow now', tip: 'Jump to the present moment and follow it' },
    speed(1, 'Real time from the moment shown now'),
    ...RATE_BUTTON_UNITS.map((id) => {
      const sym = pure.UNITS.find((u) => u.id === id).sym;
      return speed(rate(id), `One ${sym} passes every ${pure.BEAT}`);
    }),
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
    'A beat is one tick of the device’s real time. Tempo lock sets how many beats one cycle lasts; its quarters become the pulses and the subdivisions 5 : 13 : 5 : 5 : 7 : 11 : 9 : 4 … (the series repeats) the rhythm.',
  ],
  ['Any moment sounds.', '“Hear this moment” plays the chord of the displayed instant, also while you scrub through time.'],
]);

/** Closing sentence of a pure-mode help text: the shell's glossary opens with the "?" button or the ? key. */
export const GLOSSARY_HINT = 'Press ? for the glossary.';

export const CAPTION =
  'Spectrum: every coloured tick is the note of one cycle, as tall as that cycle is loud right now; the vertical lines are the octaves of the ground. Ring: angle = pitch class folded into one octave, radius = depth (α outside); the corner shows the selected cycle’s pitch class in cents above the ground.';

export const LEGEND_MIXER =
  'Each row reads: depth and folded pitch ratio, then octave, cents and cycle length. The coloured letter mutes a cycle; click or tap the row to select it and see where its note comes from.';

export const LEGEND_RHYTHM =
  '<b>♪</b> rings a bell on every quarter · <b>♪ end</b> rings once per cycle, on its end · no mark: too fast to ring at the current Chime floor. Up to about 30 cycles per beat such a cycle is still heard as the drone’s modulation; faster ones rest at their mean loudness. Dashed: switched off in the mixer.';

/** Tooltip of the Physical layer: the true rates of the deepest cycles, as cycles per beat. */
export function physicalTip(rates) {
  const list = rates.map(([letter, hz]) => `${letter} ${fmtRatePlain(hz)}`).join(', ');
  return `<b>Physical register</b><br>The true oscillation of the deepest cycles (${list} cycles per beat) as triangle waves, the glyph wave itself, transposed by whole octaves.`;
}

/** The "Now:" line of a voice tooltip in pure mode: phase and loudness are glyph pairs. */
export function nowPure(pure, live) {
  if (!live) return 'outside the catalogue';
  return `phase ${pure.pairHTML(live.phase, { label: 'phase' })} (${live.state}), loudness ${pure.pairHTML(live.loud, { label: 'loudness' })}`;
}

/**
 * Tooltip of one voice in pure mode (same teaching as normal mode, in ratios, octaves, cents and Fractonica periods).
 * @param {object} row   tuning row (tuning.js buildTuning)
 * @param {object} info  model.levelInfo(L)
 * @param {object} pure  ctx.pure
 * @param {{phase:number, loud:number, state:string}|null} live
 * @param {(n:number)=>string} int  digit grouping
 * @param {string} color CSS colour of the letter
 */
export function voiceTip({ row, info, pure, live, int, color }) {
  const p = info.prefixNum;
  const place = row.octave === 0 ? 'in the ground octave' : `${row.octave} octave${row.octave > 1 ? 's' : ''} above the ground`;
  const truth =
    p === 1
      ? 'The slowest cycle of the hierarchy is the ground itself: 1 : 1.'
      : `${int(p)} such cycles fit in one α cycle: its true rate is <b class="mono">${int(p)} : 1</b> to α.`;
  const sounds = row.rel === 1 ? '' : `, sounding at <b class="mono">${plain(row.rel, row.rel < 10 ? 3 : 4)} : 1</b> to α`;
  return `<b style="color:${color}">${row.letter}</b> <b>depth ${row.depth}</b> · one cycle = ${pure.cycleLength(row.level)}
      <div class="snd-tip-row">${truth}</div>
      <div class="snd-tip-row">Folded into one octave: <b class="mono">${ratioText(row)}</b> = ×${plain(Number(row.num) / Number(row.den), 3)} (${row.pcCents.toFixed(1)}¢)</div>
      <div class="snd-tip-row">Placed ${place}${sounds}</div>
      <div class="snd-tip-row dim">True rate of this cycle: ${fmtPerBeat(row.trueHz)}</div>
      <div class="snd-tip-row">Now: ${nowPure(pure, live)}</div>`;
}
