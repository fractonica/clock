# Module: sound  (addition #3 – cycle sonification)

Owns: `src/audio/*` (tuning.js, schedule.js, engine.js, …), `src/ui/sound.js`, `src/ui/sound/*`, `src/styles/sound.css`,
`test/sound.test.js`. CSS prefix `snd-`. Mounts into `#view-sound` (a tab) but the **engine runs whether or not the tab is
visible** (`alwaysOn: true`). Exposes `{ enabled, toggle(): Promise<boolean>, playMoment(t?), setEnabled(bool) }` on the
instance: `src/main.js` binds the header speaker button and the `M` key to `toggle()`, and other modules may call
`ctx.modules.sound.playMoment(t)`.

## Idea: the hierarchy is a just-intonation series

The prefixes `P(L) = 1, 5, 65, 325, 1625, 11375, 125125, 1126125, …` are the *frequency ratios* of the harmonic levels:
level L cycles `P(L)` times faster than α. Fold each ratio into one octave (`P / 2^⌊log2 P⌋`) and the clock becomes a chord:

| depth | letter | P | pitch class | cents |
|---|---|---|---|---|
| 1 | α | 1 | 1/1 | 0 |
| 2 | β | 5 | 5/4 | 386 |
| 3 | γ | 65 | 65/64 | 27 |
| 4 | δ | 325 | 325/256 | 413 |
| 5 | ε | 1625 | 1625/1024 | 800 |
| 6 | ζ | 11375 | 11375/8192 | 568 |
| 7 | η | 125125 | 125125/65536 | 1120 |
| 8 | θ, 9 ι | 1126125, 4504500 | 1126125/1048576 (same class, ι = θ + 2 octaves) | 124 |
| 10 | κ | 22522500 | … | 510 |
| 11–14 | λ μ ν ξ | … | … | 150, 537, 923, 692 |

(compute them exactly with BigInt from `model.levelInfo(L).prefix`.) And the deepest cycles are *physically audible*: ξ cycles at
22.5 Hz, ο (depth 15) at 247.7 Hz, π at 2.23 kHz, ρ at 8.92 kHz – the clock's own oscillation. Every sound the app makes
should be explainable from this: "this note is the cycle of depth N".

## What it must do

1. **Chord layer (default on)** – one soft voice per level in the selected set (default depths 1–12): a sine (+ very quiet
   second harmonic / slight detune pair for warmth) at `f_L = base · pitchClass(L) · 2^octave(L)`; `base` selectable
   (default ≈ 110 Hz), octave placement increasing with depth so coarse cycles are low and fine ones high (≈ 5 octaves
   total; make it a pure function with a few tested properties: monotone register, all f in [30 Hz, 4 kHz] by default).
   **Loudness follows the cycle**: gain = f(glyph value / M) so a voice swells to its peak, fades to its valley and returns
   (use `frame.level(L)` / `model.levelAt`; node → mid level; consider ±few cents of bend or a filter-brightness lift on the
   rising branch vs falling so direction is audible). Slow levels barely move in seconds but the *balance of the chord*
   tells where you are; at time-lapse speeds you hear it evolve. Fast levels (μ ν ξ) produce true amplitude modulation at
   their real rate (0.64 Hz, 3.2 Hz, 22 Hz) – keep that, it is the clock's audible heartbeat. Updates through
   `setTargetAtTime` / value curves, never zipper noise.
2. **Chime layer** – a short plucked/bell tone at the level's pitch whenever a quarter threshold (peak / node / valley / end,
   `levelAt().thresholds`, `model.boundaries`) of a sounding level is crossed. Character per threshold: peak bright, node soft,
   valley dark (octave lower), **end** = the biggest sound. Because a cycle end is also the end of every finer cycle, an
   end of level L sounds as a **strummed chord of all finer levels' notes** (coarse → fine, ~15 ms apart): the more levels turn
   over together, the fuller and longer it rings – so a *major cycle boundary is audible as a big chord*, a minor one as a
   single high bell. This is the core "how major is this event" cue. Rate-limit by *real-time* period: a level only chimes if
   `meanSeconds / |rate| ≥ 0.12 s` (configurable "chime floor"); cap polyphony (~48 voices) and ignore the rest.
3. **Time-lapse & tempo lock** – the engine is rate-aware (`store.rate`, discontinuities via `store.onTime`): event times are
   mapped from displayed time to `AudioContext` time (`when = ctx.currentTime + (tEvent − tNow) / rate`; paused = silence for
   chimes, drone holds; negative rate plays reversed order or is skipped – decide and document). Provide a **tempo lock**
   control: "make one cycle of depth [N] last [x] s" → sets `store.setRate(levelInfo(N).meanSeconds / x)` so the hierarchy
   becomes nested rhythm (quarters as beats, finer levels as 5:13:5:5:7:11… subdivisions). Show the resulting rate and BPM.
4. **Hear this moment** – `playMoment(t = displayed time)`: a 3–4 s arpeggio of the current chord (α→ξ, each note's loudness =
   that level's phase height, gentle pan spread) that works even when the continuous engine is off (needs a user gesture).
   Button in the panel. This is how Fractonica time "sounds" at any scrubbed instant.
5. **Physical register (optional switch)** – instead of folded pitch classes, play the true cycle frequency × a chosen power of
   two shift so deep levels fall in the audible band; show the actual Hz of each level in the mixer. If you include it, keep it
   clearly labelled and simple.

## Panel UI (`#view-sound`)

- Big power button + status ("Audio on · 48 kHz · 11 voices"); master volume (default quiet ≈ −18 dB); reverb amount.
- Layer toggles (Chord · Chimes · Physical), base-pitch control, chime floor, tempo lock + rate presets (reuse `store.setRate`).
- **Level mixer**: one strip per depth 1–14 in level colour: mute toggle, live loudness meter (driven by the same phase
  function), label `ε 5 · 1625:1024 · 224.5 Hz · A#3 +13¢` with a tooltip giving the exact ratio, the true cycle period (e.g.
  "one cycle = 16.2 days") and the pitch derivation. Quick presets: "Slow (1–7)", "Default (1–12)", "All (1–14)".
- A live **spectrum/scope** canvas from an `AnalyserNode` (cheap, ~30 fps) so it is obvious sound is playing; a small
  pitch-class ring (12 + exact ratios) with active voices glowing is a welcome extra.
- Short explanatory text ("How to listen") – 4 lines max – and an honest note about browser autoplay (audio starts only after a click).
- Persist settings in localStorage (try/catch) under your own key. Settings changes must be glitch-free while playing.

## Engineering requirements

- **Separate pure logic from Web Audio** so it can be tested without a browser: `tuning.js` (pitch class ratios from exact
  BigInt prefixes, frequencies, note/cents labels), `schedule.js` (`eventsInWindow(model, tA, tB, opts)` → events with time,
  levels, kind, strength; loudness mapping), both unit-tested in `node --test` against the spec vectors (e.g. at vector A the
  depth-7 end at Unix 1791464172.428 is found, and coincident ends are merged into one chord event).
- `engine.js` takes an injected `AudioContext`/`OfflineAudioContext` factory so you can **render offline in headless
  Chromium** (`page.evaluate`) and verify: non-silence, no NaN/clipping (peak < 0 dBFS), spectral peaks at the tuned
  frequencies (simple FFT on the rendered buffer), the chime chord for a known cycle end, and the AM rate of a fast level.
  You cannot listen, so this analysis is your ears – report what you measured.
- Autoplay: create/resume the `AudioContext` only inside a user gesture (`toggle()` / button). Fade in/out ~100 ms. A dedicated
  `setInterval` (≈ 50 ms, lookahead ≥ 0.5 s, widen to ~2.5 s when `document.hidden`) schedules events; do not depend on
  `requestAnimationFrame` for scheduling (it stops in background tabs) – `render()` only updates meters/visuals.
- Safety: master `DynamicsCompressor` as limiter, conservative defaults, gentle envelopes (≥ 3 ms attack, no clicks), cap voices,
  clean `destroy()` (stop nodes, clear timers, close context).

## Final defaults (after the independent audio audit)

- Octave placement is an explicit non-decreasing vector `[0,0,1,1,1,2,2,2,3,3,4,4,4,4]` (ζ at 611 Hz for a 110 Hz base; no
  voice above ~3 kHz), so no two default fundamentals sit at the roughness maximum.
- A voice's 2nd-harmonic partial is omitted when it falls within ~120 cents of another sounding voice's fundamental.
- Amplitude modulation at a level's true rate is full below 25 Hz and fades out by 32 Hz (above that the voice rests at its mean
  loudness); the legend says so.
- Chime floor defaults to 0.5 s (calm); the valley bell is derived from the folded peak so it is always an octave lower; when the
  polyphony cap is reached the quietest/finest note is stolen so the coarse notes of a major boundary always sound.
- Tempo lock is a visible state ("Locked: one ζ = 4 s") with an unlock action; it clears when the rate changes elsewhere.

## Pure mode (revision 3: major periods in words, minor units ε η ι λ ν, Blinks, pB)

Same panel, same audio, said in Fractonica terms only (SPEC §15, docs/design/80-pure.md). Wording lives in
`src/audio/words.js` (pure functions, unit-tested); `src/ui/sound.js`, `src/ui/sound/*` only place it. Normal mode is unchanged.

- **Major and minor.** α β γ δ are major periods, said in words: the voice tooltip of a major depth names the running cycle with
  its quarter (`Now: Delta Trifracton End (rising), loudness ‹pair›`, `pure.majorText`) and **never draws its phase pair**; the
  loudness pair stays (it is the voice's volume). Minor depths keep their phase pair. Only α–δ have fracton names; the retired
  names (Hadron, Quark, Chromon, Somon, Atom) never appear.
- **What a depth is** (voice tooltip head): `δ depth 4 · Delta, a major period · one cycle = 1δ`, `η depth 7 · Helion, a minor
  unit · one cycle = 1η`, `ζ depth 6 · between two units · one cycle = 11η`, `ξ depth 14 · finer than a Blink · one cycle = 0.14ν`
  (`words.depthKind`).
- **Cycle lengths** are `pure.cycleLength(level)` on the unit ladder α β γ δ ε η ι λ ν: one unit for depths 1–5, 7, 9, 11, 13, and
  for the depths between them a count of the next unit: ζ `11η`, θ `4ι`, κ `13λ`, μ `5ν`; ξ `0.14ν`. Mixer strips end with it
  (`… · 799¢ · 1ε`, `… · 568¢ · 11η`).
- **Tempo lock depth list** (`words.depthOption`): the depth chip and the unit's name, or the length of a depth between units:
  `β 2 · Beta`, `δ 4 · Delta`, `ε 5 · Nuclide`, `ζ 6 · 11η`, `η 7 · Helion`, `θ 8 · 4ι` … `ξ 14 · 0.14ν`.
- **Pitch**: folded ratio with a slash (`65/64`, never `65:64`), octave offset (`octave +1`), cents above the ground (`799¢`), and
  the absolute pitch in **pB**, cycles per Blink (`pure.pbText(pure.perBlink(hz))`): the default 110 Hz ground is `34.2 pB`, ε at
  its place `108.5 pB`, the finest strip `932.6 pB`. Never Hz, kHz, a note name or BPM.
  - base-pitch read-out: `ground ×1` over `34.2 pB` (`+700¢ ×1.5` / `51.2 pB`, `+1 octave ×2` / `68.4 pB`); the slider's
    `aria-valuetext` is `ground ×1, 34.2 pB`.
  - mixer row: line 1 depth, ratio, cycle length (narrow); line 2 `108.5 pB · octave +1 · 799¢ · 1ε` (tighter separators; the three
    parts wrap instead of being cut below 330 px). Strip tooltip: `Placed 1 octave above the ground: 108.5 pB, sounding at 3.17 : 1 to α`,
    `True rate of this cycle: 1 per 4 504 500 Blinks` (ζ: `1 per 643 500 Blinks`).
  - ring centre: `ground` / `×1` / `34.2 pB`; spectrum axis: the octave lines of the ground, pB over ratio (`17.1 ×½`, `34.2 pB ground`,
    `68.4 ×2` … `2 189 ×64`; the unit is written once, on the ground's line).
- **Physical register**: the tooltip names the true rates, whole numbers of pB (`ξ 7 pB, ο 77 pB, π 693 pB, ρ 2 772 pB`); the list
  under the stepper shows what sounds after the transposition (`ο 38.5 pB · π 346.5 pB · ρ 1 386 pB` at −1 octave).
- **Real time is counted in Blinks** (1 Blink = one ν cycle at real time = 0.311 s; "beat" is retired, quarters are "pulses"):
  - chime floors `0.161 Blinks · dense`, `0.386 · lively`, `0.804`, `1.61 · default`, `3.22 · sparse` (the stored floors stay seconds);
  - **tempo lock**: the number box counts Blinks; the stored length stays in seconds (settings, audio, normal mode) and the box converts
    with `pure.blinksToSeconds` / `secondsToBlinks`. Limits are those of 0.25 s … 600 s (`0.8 … 1930`, any step). The untouched
    default (4 s) shows the clean **12 Blinks** (one η in 12 Blinks = `3ι per Blink`); clean locks hit the presets: one η in 36 Blinks
    is `ι per Blink`, in 9 Blinks `4ι per Blink` (the default Play speed), one ζ in 11 Blinks `η per Blink`, one ε in 7 Blinks
    `11η per Blink`. Normal mode shows the stored seconds with at most three decimals;
  - read-out `3ι per Blink: one η cycle lasts 12 Blinks; a quarter lasts 3 Blinks.`, rhythm chips `η 12 Blinks ♪ ×9 θ 1.33 Blinks …`
    (rates in the chips' tooltips are pB), lock chip `Locked: one η = 12 Blinks`, toast `Tempo locked: one η cycle = 12 Blinks (3ι per Blink)`;
  - counts use narrow-space digit groups like the helper (`58 500 Blinks`) and K / M / G above a million (`2.63 M Blinks`).
- **Speeds** are `pure.rateLabel` (only units are counted: `3ι`, `11η`, never ζ θ κ μ). Speed chips: `Live`, `real time`, `λ ι η ε δ`
  over `per Blink` (the header select's words), `Pause`, `Reverse`; tooltips in prose with the unit's name (`words.rateTip`): `One
  Helion passes every Blink`, and for the counted presets `Thirteen Flavons pass every Blink`, `Four Preons pass every Blink`.
- **Texts**: "Hear this moment" names the moment by the short date (`Delta Trifracton End ε#5 33η 29ι`); how-to ("one Blink is one ν
  cycle at real time"), rhythm legend ("Up to about 9 pB …": 30 Hz × 0.311), caption, mixer legend, tooltips, status line, toasts.

Kept on purpose: the stored tempo is seconds (so normal mode, the engine and saved settings are untouched); typing more than 600 s worth
of Blinks shows `1930`, the one number the soft "year" rule flags (it only appears after an out-of-range entry).
