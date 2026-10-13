/**
 * Words of the wave view in both vocabularies.
 *
 * Normal mode delegates to tooltip.js (Gregorian spans, h / min countdowns, percentages). Pure mode says the
 * same things in Fractonica terms only (docs/design/80-pure.md, SPEC §15, revision 3): the major periods α β γ δ in
 * words with their quarter ("Delta Trifracton", "Valley quarter"; their phase is never drawn as a pair), the minor
 * cycles by where they start in their Nuclide ("ε#5 33η 28ι") with a pair of 2-stroke glyphs (256 states) instead of a
 * percentage, address chains instead of dates, durations counted on the ladder α β γ δ ε η ι λ ν, eclipses numbered
 * instead of dated. "Half-arc" is the view's own geometry (a cycle is a crest followed by a trough), not a unit:
 * lengths are always counted in units ("18ι").
 *
 * Everything here is a function of (mode, readings): the mode is asked each time (`isPure()`), so a text
 * built a moment ago is never reused after the switch. Pure helpers take the `pure` object of src/core/pure.js
 * and the model explicitly so they can be unit-tested in Node.
 */
import {
  countdownText,
  cycleText,
  floorPercent,
  glyphState,
  loopText,
  nextLines,
  roundMs,
  spanText,
  tipHTML,
  whenText,
} from './tooltip.js';
import { glyphIndexAt } from './geometry.js';
import { QUARTERS } from './solar.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);
/** A sync number as written: the app's minus (U+2212) for the syncs before the anchor, never a hyphen. */
const signed = (n) => (n < 0 ? '−' : '') + Math.abs(n);

// ------------------------------------------------------------------ pure wording helpers

/**
 * A span of `dpos` Saros positions in ladder units: "1ε", "5η 18ι" (pure.durationPos: up to `parts` non-zero counts,
 * zero units skipped). Below ten Blinks the core writes a decimal count of the Blink ("0.5ν").
 */
export function pureSpan(pure, dpos, parts = 2) {
  return pure.durationPos(dpos, { parts });
}

/**
 * The spoken form of a glyph pair ("half-arc phase 8 and 0 of 256"): the aria-label pure.pairHTML puts on the pair,
 * so what is read out for plain text (aria-label of a button, value text of a slider) is the same sentence.
 */
const ARIA_LABEL = /aria-label="([^"]*)"/;
export function pairSpoken(pure, fraction, label) {
  return ARIA_LABEL.exec(pure.pairHTML(fraction, { label }))[1];
}

/** Position distance between two instants (exact across eclipse intervals; the nearest interval outside the catalogue). */
export function positionSpan(pure, model, t1, t2) {
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  const a = model.positionOf(lo);
  const b = model.positionOf(hi);
  if (a !== null && b !== null) return b - a;
  return (hi - lo) / pure.secondsPerPosition(a === null ? model.tMin : model.tMax);
}

/** "in 1η 5ι" / "3ι ago": how far `to` lies from `from`, counted in ladder units. */
export function pureCountdown(pure, model, from, to, parts = 2) {
  const text = pureSpan(pure, positionSpan(pure, model, from, to), parts);
  return to >= from ? `in ${text}` : `${text} ago`;
}

/** The cycle length of a depth in ladder units, exact: "1δ", "1η", ζ "11η", θ "4ι", κ "13λ", μ "5ν", ξ "0.14ν". */
export const cycleLengthPure = (pure, level) => pure.cycleLength(level);
/** How many of the next unit make one cycle of a unit depth (δ 5ε, η 36ι …). */
const NEXT_UNIT = Object.freeze({ 0: [5, 'β'], 1: [13, 'γ'], 2: [5, 'δ'], 3: [5, 'ε'], 4: [77, 'η'], 6: [36, 'ι'], 8: [65, 'λ'], 10: [25, 'ν'] });
/**
 * What one cycle of a depth is, for the depth buttons: a major "1δ = 5ε", a minor unit "1η (Helion) = 36ι" (the Blink
 * "1ν (Blink)"), a depth between two units "11η" (ζ θ κ μ are no units and have no names), ξ "0.14ν".
 */
export function cycleNamedPure(pure, info) {
  const len = cycleLengthPure(pure, info.level);
  const name = pure.levelKind(info.level) === 'unit' ? ` (${pure.unitName(info.level)})` : '';
  const made = NEXT_UNIT[info.level] ? ` = ${NEXT_UNIT[info.level][0]}${NEXT_UNIT[info.level][1]}` : '';
  return `${len}${name}${made}`;
}
/** The quarter of a cycle at `phase` (0..1): Peak, Node, Valley or End, the word that stands for a major's phase. */
export const quarterWord = (pure, phase) => pure.QUARTER_WORDS[Math.min(3, Math.max(0, Math.floor(phase * 4)))];
/** The phase of the cycle a half-arc belongs to, from the progress `local` (0..1) through the half-arc. */
export const cyclePhaseOf = (d, local) => (d.crest ? 0 : 0.5) + Math.min(1, Math.max(0, local)) / 2;
/** The length of half-arc `d`: half of a cycle counted in units ("18ι"; clipped ones are shorter). */
export const halfLengthPure = (pure, model, d) => pureSpan(pure, (2 * d.fraction) / model.levelInfo(d.level).prefixNum);

/**
 * "α#6 β#4 γ#9 δ#3 ε#5 33η": the address of cycle `cycleIdx` of `level`, the stamp of its start: the ordinals of the
 * major periods, then (from ε down) the Nuclide and the counts that place the cycle in it. At most `links` links,
 * deepest last.
 */
export function chainText(pure, model, level, cycleIdx, links = 5) {
  const big = BigInt(cycleIdx);
  const P = (l) => model.levelInfo(l).prefix;
  const items = [];
  for (let l = 0; l <= Math.min(level, 3); l++) items.push(pure.shortName(l, pure.ordinalOf(l, big / (P(level) / P(l)))));
  if (level >= 4) items.push(...pure.cycleName(level, big).split(' '));
  return items.length > links ? '… ' + items.slice(-links).join(' ') : items.join(' ');
}

/**
 * The displayed time written next to the focus marker: three consecutive tokens of the stamp (pure.stamp: the ordinals
 * α# β# γ# δ# ε#, then the counts η ι λ), chosen by the depth of the arc, like the date or clock a Gregorian label would
 * show at that scale:
 *   α -> "α#6 β#4 γ#9"     δ -> "δ#3 ε#5 33η"     ε -> "ε#5 33η 29ι"     ζ and finer -> "33η 29ι 21λ"
 */
export function nowLabelPure(pure, t, level) {
  const d = pure.date(t);
  if (!d) return '—';
  const start = Math.min(Math.max(level, 0), 5);
  const c = start >= 3 ? pure.clock(t) : null;
  const all = [`α#${d.alpha}`, `β#${d.beta}`, `γ#${d.gamma}`, `δ#${d.delta}`, `ε#${d.epsilon}`, c ? `${c.eta}η` : '', c ? `${c.iota}ι` : '', c ? `${c.lambda}λ` : ''];
  return all.slice(start, start + 3).join(' ');
}

/**
 * The cycle a half-arc is half of (opening = crest, closing = trough): a major one in words, numbered in its parent
 * ("opening half of Delta Trifracton · 3 of 5 in γ"), a minor one by where it starts ("closing half of ε#5 33η").
 */
export const cyclePure = (pure, d) =>
  pure.isMajor(d.level)
    ? `${d.crest ? 'opening' : 'closing'} half of ${pure.periodName(d.level, d.cycleN)} · ${d.cycleN}\u00a0of\u00a0${d.cycleOf}${d.parent === null ? '' : '\u00a0in\u00a0' + d.parent}`
    : `${d.crest ? 'opening' : 'closing'} half of ${pure.cycleName(d.level, d.cycle)}`;

/** "starts in 3η" / "ends in 1ι 4λ" / "ended 2ι ago" relative to the displayed time. */
export function whenPure(pure, model, d, now) {
  if (now < d.start) return `starts ${pureCountdown(pure, model, now, d.start)}`;
  if (now >= d.end) return `ended ${pureCountdown(pure, model, now, d.end)}`;
  return `ends ${pureCountdown(pure, model, now, d.end)}`;
}

/** The two "what comes next" lines of the read-out, in pure terms (the same decisions as tooltip.js nextLines). */
export function nextLinesPure(pure, model, eng, d, h, t) {
  const cd = (to) => pureCountdown(pure, model, t, to);
  const ends = { dim: 'ends', text: cd(d.end) };
  if (h.local < 0.5 && !d.clipped) return [{ dim: d.apex, text: cd(eng.timeAt(d.level, d.idx, 0.5)) }, ends];
  const last = d.clipped || d.idx + 1 >= eng.halfCount(d.level);
  return [ends, last ? { dim: 'catalogue ends here', text: '' } : { dim: 'then a', text: d.crest ? 'trough' : 'crest' }];
}

/**
 * Eclipse numbers for the catalogue overview, numbered like the position (eclipse k sits at pos k, #0 is the first):
 * the junction of α half-arc i is eclipse #(2i), the end of the catalogue #(extent).
 */
export function eclipseLabels(pure, model, halfCount) {
  return { marks: Array.from({ length: halfCount }, (_, i) => pure.eclipseName(2 * i)), end: pure.eclipseName(model.extent) };
}

/** Tooltip body of a half-arc, a point on it or a level marker, in pure terms. */
export function tipHTMLPure({ d, p, at, now, pure, model, theme, marker = false, action = 'Click to jump here' }) {
  const lines = [];
  lines.push(
    `<div class="wave-tip-h"><span class="wave-tip-badge" style="--c:${theme.levelColor(d.level, 1, 64)}">${esc(d.letter)}</span>` +
      `<b>${marker ? 'marker · ' : ''}half-arc ${esc(d.signed)}</b>` +
      `<span class="wave-tip-sign">${d.crest ? 'crest' : 'trough'}</span></div>`,
  );
  lines.push(`<div class="wave-tip-r mono">${esc(chainText(pure, model, d.level, d.cycle))}</div>`);
  lines.push(`<div class="wave-tip-r dim">${esc(loopText(d))} · ${esc(cyclePure(pure, d))}</div>`);
  let len = `${esc(halfLengthPure(pure, model, d))} long`;
  if (now >= d.start && now < d.end) {
    const local = (now - d.start) / d.duration;
    // a major period is read by its quarter, a minor one by the pair of how far through the half-arc it is
    len += pure.isMajor(d.level) ? ` · now in its ${quarterWord(pure, cyclePhaseOf(d, local))} quarter` : ` · ${pure.pairHTML(local, { label: 'half-arc phase' })} of this half-arc travelled`;
  }
  lines.push(`<div class="wave-tip-r dim wave-tip-len">${len}</div>`);
  lines.push(`<div class="wave-tip-r">${esc(whenPure(pure, model, d, now))}</div>`);
  if (d.clipped) lines.push('<div class="wave-tip-r dim">clipped by the end of the catalogue</div>');
  if (p !== null && p !== undefined) {
    const st = glyphState(model.F, glyphIndexAt(d.idx, p));
    const svg = model.glyphSVG(st.index, { strokes: 2, color: theme.levelColor(d.level, 1, 70), scale: 4.2, thickness: 0.3, padding: 0.3 });
    lines.push(
      `<div class="wave-tip-g"><span class="wave-tip-glyph" aria-hidden="true">${svg}</span>` +
        `<span><b class="mono">${esc(st.label)}</b> ${esc(st.dir)}<br>` +
        `<span class="dim">glyph index ${st.index} (0–${st.states - 1}) ${marker ? 'at the displayed time' : 'at this point'}</span>` +
        (at !== null && at !== undefined && !marker ? `<br><span class="mono dim">${esc(nowLabelPure(pure, at, d.level))}</span>` : '') +
        '</span></div>',
    );
  }
  if (action) lines.push(`<div class="wave-tip-a">${esc(action)}</div>`);
  return lines.join('');
}

// ------------------------------------------------------------------ the dispatching words object

/**
 * @param o {{fmt:object, pure:object, model:object, theme:object, isPure:()=>boolean}}
 */
export function createWords({ fmt, pure, model, theme, isPure }) {
  const on = () => !!isPure();
  const pct = (frac, decimals = 0) => `${floorPercent(frac, decimals)} %`;
  /** A share of something: "87 %" (normal) or the glyph pair (pure). */
  const share = (frac, label, decimals = 0) => (on() ? pure.pairHTML(frac, { label }) : esc(pct(frac, decimals)));

  return {
    on,
    share,
    cap,

    // ---- static labels
    /** Cycle length of a level for the depth buttons: "5.1 h" or "1η". */
    cycleLength: (info) => (on() ? cycleLengthPure(pure, info.level) : fmt.duration(info.meanSeconds)),
    /** Tooltip of a depth button: "η · depth 7 · cycle ≈ 5 h 3 min · 9 …" or "η · depth 7 · one cycle = 1η (Helion) = 36ι · 9 …". */
    chipTitle: (info) =>
      on()
        ? `${info.text} · depth ${info.depth} · one cycle = ${cycleNamedPure(pure, info)} · ${info.factor} child half-arcs per half-arc`
        : `${info.text} · depth ${info.depth} · cycle ≈ ${fmt.duration(info.meanSeconds)} · ${info.factor} child half-arcs per half-arc`,
    /** The spoken label of a depth button (its live reading is appended by chipLive). */
    chipAria: (info) =>
      on()
        ? `Depth ${info.depth}, ${info.text}, one cycle is ${cycleNamedPure(pure, info)}`
        : `Depth ${info.depth}, ${info.text}, cycle about ${fmt.duration(info.meanSeconds)}`,
    /** Half-arc length of a level for the "too fast to follow" badge. */
    halfLength: (info) => (on() ? pureSpan(pure, 2 / info.prefixNum) : fmt.duration(info.meanSeconds / 2)),
    catalogueTitle: (count) =>
      on()
        ? `Catalogue: the whole Saros 141 wave, ${count} α half-arcs, ${pure.catalogueText()}`
        : `Catalogue: the whole Saros 141 wave, ${count} α half-arcs from 1613 to 2857`,
    eclipseLegend: () =>
      on()
        ? 'an eclipse of the series, numbered like the position (#0 is the first); the thin loops are β and γ'
        : 'an eclipse of the series, with its year; the thin loops are β and γ',
    /** The pure help ends by pointing at the glossary of the header. */
    glossaryHint: () => (on() ? 'Press ? for the glossary.' : ''),

    // ---- readings
    loop: loopText,
    cycle: (d) => (on() ? cyclePure(pure, d) : cycleText(d)),
    span(d) {
      if (on()) return chainText(pure, model, d.level, d.cycle) + (d.clipped ? '  (clipped)' : '');
      return spanText(fmt, d.start, d.end) + (d.clipped ? '  (clipped)' : '');
    },
    catalogueSpan: () => (on() ? pure.catalogueText() : spanText(fmt, model.tMin, model.tMax)),
    /** Second line of the catalogue read-out: where the current α half-arc lies. */
    alphaSpan(d) {
      if (on()) {
        const a = 2 * d.idx;
        return `pos ${a} → ${Number((a + 2 * d.fraction).toFixed(3))}`;
      }
      return `${fmt.date(d.start)} → ${fmt.date(d.end)}`;
    },
    nextLines: (eng, d, h, t) => (on() ? nextLinesPure(pure, model, eng, d, h, t) : nextLines(fmt, eng, d, h, t)),
    when: (d, now) => (on() ? whenPure(pure, model, d, now) : whenText(fmt, d, now)),
    /** The label next to the displayed-time marker. `overview` = the catalogue scene. */
    nowLabel({ t, level, duration = 0, overview = false }) {
      if (on()) return nowLabelPure(pure, t, overview ? 0 : level);
      if (overview) return fmt.date(t);
      if (duration >= 2 * 365.25 * 86400) return fmt.date(t);
      if (duration >= 86400) return fmt.dateTime(t, { seconds: false });
      return fmt.time(duration < 10 ? roundMs(t) : t, { seconds: true, ms: duration < 10 });
    },
    /** Eclipse labels of the overview: years (normal) or numbers (pure). */
    eclipses(halfCount) {
      if (on()) return eclipseLabels(pure, model, halfCount);
      return {
        marks: Array.from({ length: halfCount }, (_, i) => String(fmt.parts(model.catalogue[2 * i]).year)),
        end: String(fmt.parts(model.tMax).year),
      };
    },
    outOfRange(t) {
      const before = t < model.tMin;
      const gap = before ? model.tMin - t : t - model.tMax;
      if (on()) {
        const far = pureSpan(pure, (gap / pure.secondsPerPosition(before ? model.tMin : model.tMax)) || 0);
        return `Outside the Saros 141 catalogue. The wave exists only between the first eclipse (${pure.eclipseName(0)}) and the last (${pure.eclipseName(model.extent)}); the displayed time is ${far} ${before ? 'before the first' : 'after the last'}, so the catalogue is shown greyed.`;
      }
      return `Outside the Saros 141 catalogue. The wave exists only between the first eclipse (${fmt.date(model.tMin)}) and the last (${fmt.date(model.tMax)}); the displayed time is ${fmt.duration(gap)} ${before ? 'before the first' : 'after the last'}, so the catalogue is shown greyed.`;
    },

    // ---- spoken
    /** A major period is said by its quarter, never by a phase pair (pure mode only). */
    isMajor: (level) => on() && pure.isMajor(level),
    /** The quarter of the cycle a half-arc reading belongs to: "Valley". */
    quarter: (d, local) => quarterWord(pure, cyclePhaseOf(d, local)),
    /** The checked depth button also says where its depth is now. */
    chipLive(base, d, h) {
      const through = on()
        ? pure.isMajor(d.level)
          ? `in the ${quarterWord(pure, cyclePhaseOf(d, h.local))} quarter of its cycle`
          : pairSpoken(pure, h.local, 'half-arc phase')
        : `${Math.floor(h.local * 20) * 5} % through this half-arc`;
      return `${base}. Now in half-arc ${d.signed}, ${d.crest ? 'crest' : 'trough'}, ${loopText(d)}, ${through}. ${cap(on() ? cyclePure(pure, d) : cycleText(d))}.`;
    },
    /** What is announced when the focused half-arc changes. */
    announce(d, t) {
      const c = on() ? cyclePure(pure, d) : cycleText(d);
      return `${d.letter} half-arc ${d.signed}, ${d.crest ? 'crest' : 'trough'}, ${loopText(d)}. ${cap(c)}. ${cap(this.when(d, t))}.`;
    },
    canvasLabel(d, local) {
      const part = on() ? (local < 0.5 ? 'opening' : 'closing') : local < 0.5 ? 'first' : 'second';
      return `Wave view focused on ${d.letter} half-arc ${d.signed} (${on() ? cyclePure(pure, d) : cycleText(d)}), now in the ${part} half of this half-arc.`;
    },
    overviewLabel(d) {
      return `Wave view of the whole catalogue. Now in α half-arc ${d.signed}: ${on() ? cyclePure(pure, d) : cycleText(d)}.`;
    },

    /** Tooltip HTML of a half-arc / marker (both modes). */
    tip(a) {
      if (on()) return tipHTMLPure({ ...a, pure, model, theme });
      return tipHTML({ ...a, fmt, model, theme });
    },

    // ---- the solar sync
    sunDefinition: () => (on() ? '19η' : '19 η cycles ≈ 4 days'),
    sunToggleTitle: () =>
      on()
        ? 'Solar sync wave: one yellow wave of 19η (19 Helions). A ripple rides the focused arc where one and a half or more syncs fit, and a dial shows the phase at every depth'
        : 'Solar sync wave: one yellow wave of 19 η cycles (about 4 days). A ripple rides the focused arc where one and a half or more syncs fit, and a dial shows the phase at every depth',
    sunCaption: () =>
      on()
        ? 'The yellow ripple is the solar sync: one wavelength is 19η (19 Helions), drawn along the focused arc where one and a half or more fit, with a dot at its present phase; the yellow dial shows the same phase at every depth.'
        : 'The yellow ripple is the solar sync: one wavelength is 19 η cycles (about 4 days), drawn along the focused arc where one and a half or more fit, with a dot at its present phase; the yellow dial shows the same phase at every depth.',
    sunLegend: () => (on() ? 'solar sync: 19η, peak · node · valley · end' : 'solar sync: 19 η cycles (about 4 days), peak · node · valley · end'),
    /** "#4820", "#−6718": the minus is the app's own (U+2212), never a hyphen. */
    sunNumber: (s) => `#${signed(s.sync)}`,
    /** "peak in 21 h 04 min" / "peak in 3η 2ι". */
    sunNext(s, t) {
      const name = s.threshold.name;
      return on() ? `${name} ${pureCountdown(pure, model, t, s.threshold.time)}` : `${name} ${countdownText(fmt, s.threshold.time - t)}`;
    },
    /** The signed drift of the sync: "−13 h 27 min" (normal) / "−623λ" (pure.driftText: counted in λ, the same everywhere). */
    sunDrift(s) {
      if (on()) return pure.driftText(s);
      return (s.drift > 0 ? '+' : '') + fmt.duration(s.drift);
    },
    /** The drift as one line: "Drift against civil days −13 h 27 min" / "Drift −623λ". */
    sunDriftLine(s, t) {
      return on() ? `Drift ${this.sunDrift(s, t)}` : `Drift against civil days ${this.sunDrift(s, t)}`;
    },
    sunEdge: () => (on() ? 'Not defined at the very edge of the catalogue: its first and last sync are cut short.' : 'Not defined within 3 days of the catalogue edge.'),
    /**
     * Where the ripple is drawn, as depths ("ripple at depths 4–5", levels are 0-based, depths 1-based): the depths whose
     * current half-arc really carries one on this stage (see rippleDepths). A gap is a list: "depths 3, 5".
     */
    sunRange(levels) {
      if (!levels.length) return 'no ripple here: these arcs are too short';
      const depths = levels.map((l) => l + 1);
      if (depths.length === 1) return `ripple at depth ${depths[0]}`;
      const run = depths.every((d, i) => i === 0 || d === depths[i - 1] + 1);
      return run ? `ripple at depths ${depths[0]}–${depths.at(-1)}` : `ripple at depths ${depths.join(', ')}`;
    },
    /** The phase as a screen reader says it (the value text of the dial's slider). */
    sunPhaseText: (s) => (on() ? `sync ${signed(s.sync)}, ${pairSpoken(pure, s.phase, 'phase')}` : `${floorPercent(s.phase)} percent of sync ${signed(s.sync)}`),
    /** The keys of the dial (its aria-description). */
    sunKeys: () => 'Arrow keys travel within the sync, Page Up and Page Down by a quarter, Home and End to its start and end',
    sunAria(s, t) {
      if (!s) return `Solar sync. ${this.sunEdge()}`;
      const phase = on() ? pairSpoken(pure, s.phase, 'phase') : `phase ${floorPercent(s.phase)} percent`;
      return `Solar sync ${signed(s.sync)}, ${phase}, next ${this.sunNext(s, t)}, ${this.sunDriftLine(s, t).replace(/^Drift/, 'drift')}.`;
    },
    /**
     * Tooltip of the sync, for the pin on the ripple (`by: 'pin'`), the dial (`'dial'`) and the focused dial (`'key'`).
     * The last line says how to travel within the sync, and it is true for the thing hovered.
     */
    sunTip(s, t, { by = 'dial', touch = false } = {}) {
      const head = `<div class="wave-tip-h"><i class="wave-sun-dot" aria-hidden="true"></i><b>Solar sync ${esc(this.sunNumber(s))}</b><span class="wave-tip-sign">${esc(this.sunDefinition())}</span></div>`;
      const phase = on() ? `Phase ${pure.pairHTML(s.phase, { label: 'sync phase' })} of this sync` : `Phase ${esc(pct(s.phase))} of this 4-day sync`;
      const action = by === 'pin' ? 'Drag the pin to travel within this sync' : by === 'key' ? 'Arrow keys travel within this sync, Page keys by a quarter' : `${touch ? 'Tap' : 'Click'} or drag the wave to travel within this sync`;
      const lines = [
        head,
        `<div class="wave-tip-r wave-tip-len">${phase}</div>`,
        `<div class="wave-tip-r">Next ${esc(this.sunNext(s, t))}</div>`,
        `<div class="wave-tip-r dim">${esc(this.sunDriftLine(s, t))}</div>`,
        `<div class="wave-tip-r dim">${QUARTERS.join(', ')}: ${on() ? 'a quarter of the sync apart' : 'about a day apart'}</div>`,
        ...(on() ? [`<div class="wave-tip-r dim">One sync is 19η: 19 ${pure.unitName('η', 19)}</div>`] : []),
        `<div class="wave-tip-a">${esc(action)}</div>`,
      ];
      return lines.join('');
    },
    /** The tooltip of the pin (or the dial) in the first and last sync of the catalogue, which the model leaves undefined. */
    sunEdgeTip(sync) {
      return (
        `<div class="wave-tip-h"><i class="wave-sun-dot" aria-hidden="true"></i><b>Solar sync ${esc(this.sunNumber({ sync }))}</b><span class="wave-tip-sign">${esc(this.sunDefinition())}</span></div>` +
        `<div class="wave-tip-r dim">${esc(this.sunEdge())}</div>`
      );
    },
  };
}
