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

## Pure mode
Mixer rows read `ratio · octave · cents` with "ground" instead of Hz; cycle lengths are pure durations (`one cycle = 2ζ½`); true
rates are "cycles per beat"; speed chips use `pure.rateLabel` (`real time`, `η per beat`, `9ι per beat`); tempo lock counts beats.
Wording lives in `src/audio/words.js`. Audio output is unchanged.
