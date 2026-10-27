/**
 * Sound panel (tab `sound`) and owner of the sonification engine.
 *
 * The engine keeps running whether or not this tab is visible (`alwaysOn`): src/main.js binds the header
 * speaker and the `M` key to `toggle()`, other modules may call `ctx.modules.sound.playMoment(t)`.
 * `render()` only paints meters and visuals; the sound is scheduled by the engine's own timer.
 *
 * Exposed on the instance: { enabled, toggle(): Promise<boolean>, setEnabled(on), playMoment(t?), engine }
 *
 * Pure mode (docs/design/80-pure.md and SPEC §15, revision 3): the same panel and the same audio, said in Fractonica
 * terms only. Pitch is a ratio, an octave offset and cents (never a note name), the base pitch is an offset of the
 * "ground", and absolute pitch is counted in pB, cycles per Blink ("34.2 pB" for the 110 Hz ground; never Hz). Cycle
 * lengths are `pure.cycleLength(level)` on the unit ladder α β γ δ ε η ι λ ν ("1η"; the depths between the units are
 * counts: ζ "11η", θ "4ι", κ "13λ", μ "5ν"), real-time spans are Blinks (the chime floors, the tempo lock's number box:
 * `pure.blinksToSeconds` / `secondsToBlinks`; the stored settings stay in seconds), every speed (chips, buttons, the
 * tempo-lock read-out and toasts) is `pure.rateLabel(rate)` ("η per Blink", "3ι per Blink": never a bare "×4,547"),
 * and every percentage is a pair of 2-stroke glyphs, spoken as "volume 8 and 0 of 256" – except the phase of a major
 * period (α β γ δ), which is said in words with its quarter ("Delta Trifracton Node") and never drawn.
 * `applyMode()` rebuilds everything that is static when the mode changes; the words themselves live in
 * audio/words.js (pure, unit-tested).
 */
import { createEngine } from '../audio/engine.js';
import { loadSettings, saveSettings, PRESETS, presetLevels, matchPreset, FLOORS, LIMITS, DEFAULT_SETTINGS } from '../audio/settings.js';
import { phaseOf, voiceLoudness, cycleHz, tempoRate, tempoInfo, chimeMode, amZone } from '../audio/schedule.js';
import { physicalLevels, noteOf } from '../audio/tuning.js';
import { fmtHz, fmtRate, fmtSeconds, fmtSecondsShort, fmtDb, fmtOct, fmtPeriod } from '../audio/format.js';
import * as W from '../audio/words.js';
import { createTooltip } from './sound/tooltip.js';
import { createMixer } from './sound/mixer.js';
import { createScope } from './sound/scope.js';
import { createRing } from './sound/ring.js';
import { leadHTML } from './pentad.js';

const BASE_REF = 110;
const semitonesOf = (hz) => Math.round(12 * Math.log2(hz / BASE_REF));
const hzOfSemitones = (k) => BASE_REF * Math.pow(2, k / 12);
const FLOOR_LABEL = { 0.05: 'dense', 0.12: 'lively', 0.5: 'default', 1: 'sparse' };

const HOW = [
  ['Cycles are notes.', 'The ratios 1 : 5 : 65 : 325 … folded into one octave are the chord; a voice is loud at its cycle’s peak and silent at its valley.'],
  ['Bells are quarters.', 'One rings at each peak, node, valley and end; a cycle end strums every finer cycle ending with it, so a major turnover is a big chord.'],
  ['Speed makes rhythm.', 'Tempo lock turns quarters into beats and the subdivisions 5 : 13 : 5 : 5 : 7 : 11 : 9 : 4 … (the series repeats) into the rhythm.'],
  ['Any moment sounds.', '“Hear this moment” plays the chord of the displayed instant, also while you scrub through time.'],
];

export function mount(root, ctx) {
  const { model, store, fmt, theme, icons } = ctx;
  /** ctx.pure while pure mode is on, else null. `curPure` is the mode the DOM was last built for (applyMode). */
  const getPure = () => (ctx.isPure?.() && ctx.pure) || null;
  let curPure = null;
  let modeKey = null;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

  // ---------------------------------------------------------------------------------------------
  // engine
  // ---------------------------------------------------------------------------------------------
  const createContext = () => {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not available in this browser');
    return new AC({ latencyHint: 'interactive' });
  };
  const engine = createEngine({
    model,
    clock: { t: () => store.t(), rate: () => store.rate },
    createContext,
    settings: loadSettings(),
  });
  const rows = engine.tuning;
  const unsubTime = store.onTime(() => {
    engine.resync();
    onRateChange();
  });
  let S = engine.settings;

  function commit(patch) {
    S = engine.update(patch);
    saveSettings(S);
    syncControls();
    ctx.requestRender();
  }

  // ---------------------------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------------------------
  root.innerHTML = `
  <div class="snd" data-state="off">
    <section class="card snd-hero" aria-label="Sound">
      <button class="snd-power" type="button" aria-pressed="false" aria-label="Sound"></button>
      <div class="snd-hero-text">
        <h2 class="snd-title">Cycle sound</h2>
        <p class="snd-status" role="status" aria-live="polite"></p>
        <div class="snd-chips"></div>
      </div>
      <button class="btn snd-moment" type="button"><span class="snd-ico snd-ico-idle"></span><span class="snd-ico snd-ico-busy"></span><span>Hear this moment</span></button>
    </section>

    <section class="card snd-viz-card" aria-label="Spectrum and pitch ring">
      <div class="snd-viz">
        <canvas class="snd-scope" role="img" aria-label="Live spectrum and waveform of the sound. Coloured ticks mark the notes of the cycles and how loud each one is."></canvas>
        <canvas class="snd-ring" role="img" aria-label="Pitch ring: each cycle as a dot at its pitch class, deeper cycles toward the centre."></canvas>
      </div>
      <p class="snd-cap dim">Spectrum: every coloured tick is the note of one cycle, as tall as that cycle is loud right now. Ring: angle = pitch class folded into one octave, radius = depth (α outside); the corner shows the selected cycle’s pitch class in cents above the base note.</p>
    </section>

    <section class="card snd-ctl-card" aria-label="Mix">
      <div class="card-h"><h3>Mix</h3></div>
      <div class="card-b snd-ctl">
        <label class="snd-field"><span class="snd-lbl">Volume</span><input class="snd-vol" type="range" min="${LIMITS.volumeDb[0]}" max="${LIMITS.volumeDb[1]}" step="1"><output class="snd-out mono"></output></label>
        <label class="snd-field"><span class="snd-lbl">Reverb</span><input class="snd-rev" type="range" min="0" max="100" step="1"><output class="snd-out mono"></output></label>
        <label class="snd-field"><span class="snd-lbl snd-has-tip">Base pitch</span><input class="snd-base" type="range" min="-12" max="12" step="1"><output class="snd-out mono"></output></label>
        <div class="snd-field"><span class="snd-lbl">Layers</span>
          <div class="seg snd-layers" role="group" aria-label="Sound layers">
            <button type="button" data-layer="chord" aria-pressed="true">Chord</button>
            <button type="button" data-layer="chimes" aria-pressed="true">Chimes</button>
            <button type="button" data-layer="physical" aria-pressed="false">Physical</button>
          </div>
        </div>
        <label class="snd-field"><span class="snd-lbl snd-has-tip">Chime floor</span><select class="select snd-floor" aria-label="Chime floor"></select></label>
        <div class="snd-phys" hidden>
          <span class="snd-lbl">Physical register</span>
          <div class="snd-stepper" role="group" aria-label="Transpose the true cycle rates">
            <button class="btn btn-sm btn-icon" type="button" data-step="-1" aria-label="One octave down">−</button>
            <output class="snd-oct mono"></output>
            <button class="btn btn-sm btn-icon" type="button" data-step="1" aria-label="One octave up">+</button>
          </div>
          <p class="snd-phys-list mono dim"></p>
        </div>
      </div>
    </section>

    <section class="card snd-mixer-card" aria-label="Depth mixer">
      <div class="card-h"><h3>Depth mixer</h3><span class="spacer"></span>
        <div class="seg snd-presets" role="group" aria-label="Which depths sound"></div>
      </div>
      <div class="card-b">
        <p class="snd-legend dim">Each row reads: depth and folded pitch ratio, then frequency, note and cycle length. The coloured letter mutes a cycle; click or tap the row to select it and see where its note comes from.</p>
        <div class="snd-mixer"></div>
      </div>
    </section>

    <section class="card snd-tempo-card" aria-label="Tempo lock">
      <div class="card-h"><h3>Tempo lock</h3><span class="spacer"></span><span class="chip snd-chip snd-chip-lock" hidden><span class="snd-lock-txt"></span><button class="snd-unlock" type="button" aria-label="Unlock tempo">Unlock</button></span></div>
      <div class="card-b snd-tempo">
        <div class="snd-lock">
          <span>Make one cycle of depth</span>
          <select class="select snd-tdepth" aria-label="Depth to lock"></select>
          <span>last</span>
          <input class="input snd-secs mono" type="number" inputmode="decimal" min="${LIMITS.tempoSeconds[0]}" max="${LIMITS.tempoSeconds[1]}" step="0.25" aria-label="Seconds per cycle">
          <span class="snd-secs-unit">s</span>
          <button class="btn snd-lock-btn" type="button"><span class="snd-lock-label">Lock tempo</span></button>
        </div>
        <p class="snd-read"></p>
        <div class="snd-rhythm mono" aria-label="Nested rhythm"></div>
        <p class="snd-rh-legend dim"><b>♪</b> rings a bell on every quarter · <b>♪ end</b> rings once per cycle, on its end · no mark: too fast to ring at the current Chime floor. Up to about 30 Hz such a cycle is still heard as the drone’s modulation; faster ones rest at their mean loudness. Dashed: switched off in the mixer.</p>
        <div class="snd-rates" role="group" aria-label="Time-lapse speed"></div>
      </div>
    </section>

    <section class="card snd-how-card" aria-label="How to listen">
      <div class="card-h"><h3>How to listen</h3></div>
      <div class="card-b">
        <ol class="snd-how"></ol>
        <p class="snd-auto dim">Browsers only start audio after a click or key press, so the sound stays off until you press the speaker (or M). Settings are remembered on this device.</p>
      </div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const els = {
    app: $('.snd'),
    power: $('.snd-power'),
    status: $('.snd-status'),
    chips: $('.snd-chips'),
    lockChip: $('.snd-chip-lock'),
    lockTxt: $('.snd-lock-txt'),
    unlock: $('.snd-unlock'),
    moment: $('.snd-moment'),
    scope: $('.snd-scope'),
    ring: $('.snd-ring'),
    vol: $('.snd-vol'),
    rev: $('.snd-rev'),
    base: $('.snd-base'),
    layers: [...root.querySelectorAll('[data-layer]')],
    floor: $('.snd-floor'),
    phys: $('.snd-phys'),
    oct: $('.snd-oct'),
    physList: $('.snd-phys-list'),
    presets: $('.snd-presets'),
    mixer: $('.snd-mixer'),
    depth: $('.snd-tdepth'),
    secs: $('.snd-secs'),
    lock: $('.snd-lock-btn'),
    lockLabel: $('.snd-lock-label'),
    read: $('.snd-read'),
    rhythm: $('.snd-rhythm'),
    legend: $('.snd-rh-legend'),
    rates: $('.snd-rates'),
  };
  const outFor = (input) => input.parentElement.querySelector('output');
  // DOM writes only when the value changed (render() runs every animation frame)
  // one cache key for both helpers: a node written as text and later as markup (pure mode) is never taken for unchanged
  const text = (node, value) => {
    const k = `t${value}`;
    if (node.__k !== k) {
      node.textContent = value;
      node.__k = k;
    }
  };
  const html = (node, value) => {
    const k = `h${value}`;
    if (node.__k !== k) {
      node.innerHTML = value;
      node.__k = k;
    }
  };
  const attr = (node, name, value) => {
    const key = `__a_${name}`;
    if (node[key] !== value) {
      node.setAttribute(name, value);
      node[key] = value;
    }
  };

  // both icons are in the DOM and CSS picks one: replacing the button's content under a resting mouse
  // pointer makes the browser fire a second "pointerenter" and the tooltip would pop up again after a click
  els.power.innerHTML = `<span class="snd-power-ring"></span><span class="snd-ico snd-ico-off">${icons.soundOff}</span><span class="snd-ico snd-ico-on">${icons.soundOn}</span>`;
  $('.snd-ico-idle').innerHTML = icons.play;
  $('.snd-ico-busy').innerHTML = icons.soundOn;
  els.presets.innerHTML = Object.entries(PRESETS)
    .map(([k, p]) => `<button type="button" data-preset="${k}" aria-pressed="false">${p.label}</button>`)
    .join('');
  // [key, label, unit shown under the label, tooltip]. "Live" jumps to the device clock, "×1" only sets the speed.
  const RATE_PRESETS = [
    ['live', 'Live', 'device clock', 'Jump to the device clock and follow it'],
    ['1', fmtRate(1), 'real time', 'Real time from the time shown now'],
    ['60', fmtRate(60), '1 min/s', 'One minute of clock time per second'],
    ['3600', fmtRate(3600), '1 h/s', 'One hour of clock time per second'],
    ['86400', fmtRate(86400), '1 d/s', 'One day of clock time per second'],
    ['2629800', fmtRate(2629800), '1 mo/s', 'One month of clock time per second'],
    ['0', 'Pause', '', 'Stop the clock: the drone holds, the bells wait'],
    ['rev', 'Reverse', '', 'Run time backwards at the same speed: the bells play in reverse order'],
  ];

  // what differs between the two vocabularies and is built once per mode: lists, options, buttons, legends
  const buildHow = (pu) => (pu ? W.HOW : HOW).map(([h, p]) => `<li><b>${h}</b> ${p}</li>`).join('');
  const buildFloors = (pu) =>
    FLOORS.map((f) => `<option value="${f}">${pu ? W.floorLabel(pu, f, FLOOR_LABEL[f]) : `${f} s${FLOOR_LABEL[f] ? ' · ' + FLOOR_LABEL[f] : ''}`}</option>`).join('');
  // pure: the depth chip and the unit's name ("η 7 · Helion"), or the exact length of a depth between units ("ζ 6 · 11η")
  const buildDepths = (pu) =>
    rows
      .slice(1)
      .map((r) => `<option value="${r.depth}">${pu ? W.depthOption(pu, r) : `${r.depth} · ${r.letter} (${fmtPeriod(r.cycleSeconds)})`}</option>`)
      .join('');
  const buildRates = (pu) =>
    (pu ? W.rateButtons(pu).map((b) => [b.key, b.label, b.unit, b.tip]) : RATE_PRESETS)
      .map(([k, l, u, t]) => `<button class="btn btn-sm snd-rate" type="button" data-rate="${k}" aria-pressed="false" title="${t}"><span>${l}</span>${u ? `<small>${u}</small>` : ''}</button>`)
      .join('');
  const secsUnit = $('.snd-secs-unit');
  const normalTexts = {
    caption: $('.snd-cap').innerHTML,
    mixLegend: $('.snd-legend').innerHTML,
    rhLegend: els.legend.innerHTML,
    unit: secsUnit.textContent,
    secsLabel: els.secs.getAttribute('aria-label'),
    secsMin: els.secs.getAttribute('min'),
    secsMax: els.secs.getAttribute('max'),
    secsStep: els.secs.getAttribute('step'),
    auto: $('.snd-auto').textContent,
  };
  // The tempo lock is stored in real seconds (settings, audio, normal mode); pure mode counts it in Blinks. These two
  // are the whole bridge: the number box <-> the stored seconds. Normal mode shows at most three decimals (a lock made
  // in pure mode, 12 Blinks = 3.732254… s, must not print its float tail).
  const boxText = () => (curPure ? String(W.tempoBlinks(curPure, S.tempo.seconds, DEFAULT_SETTINGS.tempo.seconds)) : String(Number(S.tempo.seconds.toFixed(3))));
  const boxSeconds = (v) => (curPure ? curPure.blinksToSeconds(v) : v);

  // ---------------------------------------------------------------------------------------------
  // tooltips that teach
  // ---------------------------------------------------------------------------------------------
  const tooltip = createTooltip();
  const tipFor = {
    power: () => '<b>Sound on / off</b> (M)<br>Starts the drone and the bells. Audio can only start after a click, so it is off until you press this.',
    moment: () =>
      `<b>Hear this moment</b><br>Plays the chord of ${leadHTML(model, store.t(), curPure ? curPure.dateText(store.t()) : fmt.dateTime(store.t()), { cls: 'is-gold' })} as a short arpeggio from α to the finest voice; each note is as loud as its cycle is high right now. Works while the sound is off.`,
    chord: () => '<b>Chord</b><br>One soft voice per cycle at its just-intonation pitch. It swells to the cycle’s peak and fades to its valley; the fast cycles (μ ν ξ) modulate at their true rates, the clock’s heartbeat.',
    chimes: () => '<b>Chimes</b><br>A bell at every peak, node, valley and end. A cycle end strums all finer cycles that end with it: a major turnover rings as a big chord.',
    physical: () =>
      curPure
        ? W.physicalTip(curPure, [13, 14, 15, 16].map((L) => [model.levelInfo(L).letter, 1 / model.levelInfo(L).meanSeconds]))
        : '<b>Physical register</b><br>The true oscillation of the deepest cycles (ξ 22.5 Hz, ο 247.7 Hz, π 2.23 kHz, ρ 8.92 kHz) as triangle waves, the glyph wave itself, transposed by whole octaves.',
    floor: () =>
      `<b>Chime floor</b><br>A cycle rings a bell on every quarter only while its quarters are at least this far apart in real time. A cycle whose quarters come faster rings only its end, and one shorter than the floor in total rings nothing: up to about ${curPure ? '9 pB' : '30 Hz'} it is still heard as the drone’s modulation, faster ones rest at their mean loudness. Protects you from a rattle in a fast time-lapse.`,
    base: () =>
      curPure
        ? '<b>Base pitch</b><br>The ground of the chord: α stands on it as 1/1 and every other voice is an exact ratio above it. Its pitch is counted in pB, cycles per Blink of real time. The slider moves the whole chord up or down in steps of 100 cents, an octave at either end.'
        : '<b>Base pitch</b><br>The note of α, the 1/1 of the chord. Every other voice is an exact ratio above it.',
    lock: () =>
      lock
        ? `<b>Unlock tempo</b><br>Releases the lock. The speed stays as it is until you change it; editing the depth or the ${curPure ? 'Blinks' : 'seconds'} no longer re-tunes it.`
        : curPure
          ? '<b>Tempo lock</b><br>Sets the time-lapse so that one cycle of the chosen depth lasts the given number of Blinks. Its quarters become pulses; finer cycles become subdivisions. The lock holds while the speed is not changed elsewhere (header, Space, a link); until then, editing the depth or the Blinks re-tunes it.'
          : '<b>Tempo lock</b><br>Sets the time-lapse so that one cycle of the chosen depth lasts the given real seconds. Its quarters become beats; finer cycles become subdivisions. The lock holds while the speed is not changed elsewhere (header, Space, a link); until then, editing the depth or the seconds re-tunes it.',
  };
  tooltip.bind(els.power, tipFor.power, { touch: false });
  tooltip.bind(els.moment, tipFor.moment, { touch: false });
  for (const b of els.layers) tooltip.bind(b, tipFor[b.dataset.layer]);
  // on a touch screen the caption is the handle ("?" marker); a tap on the control itself operates it
  tooltip.bind(els.floor.parentElement, tipFor.floor, { touch: '.snd-lbl' });
  tooltip.bind(els.base.parentElement, tipFor.base, { touch: '.snd-lbl' });
  tooltip.bind(els.lock, tipFor.lock, { touch: false });

  // ---------------------------------------------------------------------------------------------
  // tempo lock: a visible state, not a one-shot. It holds while store.rate is the rate it set; any other
  // change of the speed (header, Space, a link, the preset buttons, the catalogue edge) releases it.
  // ---------------------------------------------------------------------------------------------
  let lock = null; // {depth, seconds, rate}
  let locking = false; // our own store.setRate() must not release the lock it is making

  function syncLock() {
    const on = lock !== null;
    if (els.lockChip.hidden === on) els.lockChip.hidden = !on;
    if (on) {
      const row = rows[lock.depth - 1];
      if (curPure) {
        text(els.lockTxt, `Locked: one ${row.letter} = ${W.blinkSpan(curPure, lock.seconds)}`);
        attr(els.lockChip, 'title', `Tempo lock: one ${row.letter} cycle lasts ${W.blinkSpan(curPure, lock.seconds)} of real time at ${curPure.rateLabel(lock.rate)}. It holds until the speed is changed.`);
      } else {
        text(els.lockTxt, `Locked: one ${row.letter} = ${fmtSecondsShort(lock.seconds)}`);
        attr(els.lockChip, 'title', `Tempo lock: one ${row.letter} cycle lasts ${fmtSecondsShort(lock.seconds)} of real time at ${fmtRate(lock.rate)}. It holds until the speed is changed.`);
      }
    }
    els.lock.classList.toggle('is-on', on);
    text(els.lockLabel, on ? 'Unlock tempo' : 'Lock tempo');
  }
  function onRateChange() {
    if (lock && !locking && (store.live || store.rate !== lock.rate)) {
      lock = null;
      syncLock();
    }
  }
  /** Set the speed from the tempo controls and hold it as the lock (also re-tunes an existing lock). */
  function applyLock({ announce = false } = {}) {
    const { depth, seconds } = S.tempo;
    if (lock && lock.depth === depth && lock.seconds === seconds && store.rate === lock.rate && !store.live) return;
    const rate = tempoRate(model, depth, seconds);
    locking = true;
    try {
      store.setRate(rate);
    } finally {
      locking = false;
    }
    lock = { depth, seconds, rate: store.rate };
    syncLock();
    ctx.requestRender();
    if (announce) {
      const how = curPure ? `${W.blinkSpan(curPure, seconds)} (${curPure.rateLabel(rate)})` : `${fmtSeconds(seconds)} (${fmtRate(rate)})`;
      ctx.toast(`Tempo locked: one ${rows[depth - 1].letter} cycle = ${how}`);
    }
  }
  /** Lock with the numbers in the controls. */
  function lockTempo() {
    const v = Number(els.secs.value);
    if (Number.isFinite(v) && v > 0) commit({ tempo: { seconds: boxSeconds(v) } });
    els.secs.value = boxText(); // show what was accepted (clamped or reverted)
    applyLock({ announce: true });
  }
  function unlockTempo() {
    if (!lock) return;
    const rate = lock.rate;
    lock = null;
    syncLock();
    ctx.requestRender();
    ctx.toast(`Tempo unlocked. The speed stays at ${curPure ? curPure.rateLabel(rate) : fmtRate(rate)} until you change it.`);
  }

  // ---------------------------------------------------------------------------------------------
  // live helpers
  // ---------------------------------------------------------------------------------------------
  let framePos = null;
  const loud = new Array(rows.length).fill(0);
  const silent = new Array(rows.length).fill(0);
  const liveOf = (L) => {
    if (framePos === null) return null;
    const ph = phaseOf(framePos, model.levelInfo(L).prefixNum);
    const v = loud[L];
    const state = Math.abs(ph - 0.25) < 0.02 ? 'at its peak' : Math.abs(ph - 0.75) < 0.02 ? 'in its valley' : ph < 0.25 || ph > 0.75 ? 'rising' : 'falling';
    // pure: a major period is said in words with its quarter, never by its phase
    const major = curPure?.isMajor(L) ? curPure.majorText(store.t(), L) : undefined;
    return { phase: ph, loud: v, state, major };
  };

  const mixer = createMixer(els.mixer, {
    rows,
    model,
    fmt,
    tooltip,
    getBase: () => S.baseHz,
    getLive: liveOf,
    getPure: () => curPure,
    onToggle: (L) => commit({ levels: S.levels.map((v, i) => (i === L ? !v : v)) }),
    onSelect: (L) => ctx.select(L),
  });
  const scope = createScope(els.scope);
  const ring = createRing(els.ring);

  // ring: the dot's note, explained like a mixer strip (hover with a mouse, tap on a touch screen)
  const ringSlop = coarse ? 20 : 12;
  let ringPointer = 'mouse';
  els.ring.addEventListener('pointerdown', (e) => {
    ringPointer = e.pointerType;
  });
  els.ring.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const L = ring.hit(e.clientX, e.clientY, ringSlop);
    els.ring.style.cursor = L >= 0 ? 'pointer' : 'default';
    if (L < 0) tooltip.hide(els.ring);
    else tooltip.show(els.ring, () => mixer.tipHtml(L), { x: e.clientX, y: e.clientY });
  });
  els.ring.addEventListener('pointerleave', () => tooltip.hide(els.ring));
  els.ring.addEventListener('click', (e) => {
    const L = ring.hit(e.clientX, e.clientY, ringSlop);
    if (L >= 0) ctx.select(L);
    if (ringPointer !== 'touch') return;
    if (L >= 0) tooltip.show(els.ring, () => mixer.tipHtml(L), { x: e.clientX, y: e.clientY });
    else tooltip.hide(els.ring);
  });

  // keyboard focus must not end up under the sticky header: keep its height as a scroll margin
  const topbar = document.getElementById('topbar');
  const measureTop = () => {
    const h = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0;
    els.app.style.setProperty('--snd-top', `${h + 12}px`);
  };
  measureTop();
  const topRO = topbar && typeof ResizeObserver === 'function' ? new ResizeObserver(measureTop) : null;
  topRO?.observe(topbar);

  // ---------------------------------------------------------------------------------------------
  // controls
  // ---------------------------------------------------------------------------------------------
  const fill = (input) => input.style.setProperty('--fill', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
  function syncControls() {
    els.vol.value = String(S.volumeDb);
    if (curPure) html(outFor(els.vol), curPure.pairHTML((S.volumeDb - LIMITS.volumeDb[0]) / (LIMITS.volumeDb[1] - LIMITS.volumeDb[0]), { label: 'volume' }));
    else text(outFor(els.vol), fmtDb(S.volumeDb));
    els.rev.value = String(Math.round(S.reverb * 100));
    if (curPure) html(outFor(els.rev), curPure.pairHTML(S.reverb, { label: 'reverb' }));
    else text(outFor(els.rev), `${Math.round(S.reverb * 100)} %`);
    const k = semitonesOf(S.baseHz);
    els.base.value = String(k);
    // pure: the ratio on the first line, the ground's pitch in pB under it
    if (curPure) html(outFor(els.base), `<span>${W.groundText(k)}</span> <span class="snd-out-sub">${W.pbOf(curPure, hzOfSemitones(k))}</span>`);
    else text(outFor(els.base), `${hzOfSemitones(k).toFixed(hzOfSemitones(k) < 100 ? 1 : 0)} Hz · ${noteOf(S.baseHz).name}`);
    for (const input of [els.vol, els.rev, els.base]) fill(input);
    // pure mode: what a screen reader says for a slider is the pair ("volume 10 and 10 of 256") or the ground, not the bare number
    const say = (input, v) => (v === null ? input.removeAttribute('aria-valuetext') : input.setAttribute('aria-valuetext', v));
    const range = (v, [lo, hi]) => (v - lo) / (hi - lo);
    say(els.vol, curPure ? W.pairSay(curPure, range(S.volumeDb, LIMITS.volumeDb), 'volume') : null);
    say(els.rev, curPure ? W.pairSay(curPure, S.reverb, 'reverb') : null);
    say(els.base, curPure ? `${W.groundText(k)}, ${W.pbOf(curPure, hzOfSemitones(k))}` : null);
    for (const b of els.layers) b.setAttribute('aria-pressed', String(!!S[b.dataset.layer]));
    const nearest = FLOORS.reduce((a, b) => (Math.abs(b - S.floor) < Math.abs(a - S.floor) ? b : a));
    els.floor.value = String(nearest);
    els.phys.hidden = !S.physical;
    text(els.oct, curPure ? W.octaveShift(S.physShift) : fmtOct(S.physShift));
    const audible = physicalLevels(model, S.physShift);
    text(
      els.physList,
      audible.length
        ? audible.map((p) => `${p.letter} ${curPure ? W.pbOf(curPure, p.hz) : fmtHz(p.hz)}`).join('  ·  ')
        : 'No cycle falls into the audible band at this transposition.',
    );
    const preset = matchPreset(S.levels);
    for (const b of els.presets.children) b.setAttribute('aria-pressed', String(b.dataset.preset === preset));
    els.depth.value = String(S.tempo.depth);
    if (document.activeElement !== els.secs) els.secs.value = boxText();
  }

  els.vol.addEventListener('input', () => commit({ volumeDb: Number(els.vol.value) }));
  els.rev.addEventListener('input', () => commit({ reverb: Number(els.rev.value) / 100 }));
  els.base.addEventListener('input', () => commit({ baseHz: hzOfSemitones(Number(els.base.value)) }));
  for (const b of els.layers) b.addEventListener('click', () => commit({ [b.dataset.layer]: !S[b.dataset.layer] }));
  els.floor.addEventListener('change', () => commit({ floor: Number(els.floor.value) }));
  for (const b of els.phys.querySelectorAll('[data-step]')) b.addEventListener('click', () => commit({ physShift: S.physShift + Number(b.dataset.step) }));
  for (const b of els.presets.children) {
    b.addEventListener('click', () => {
      const p = PRESETS[b.dataset.preset];
      commit({ levels: presetLevels(p.from, p.to) });
    });
  }
  els.depth.addEventListener('change', () => {
    commit({ tempo: { depth: Number(els.depth.value) } });
    if (lock) applyLock(); // a locked tempo follows the numbers
  });
  els.secs.addEventListener('change', () => {
    const v = Number(els.secs.value);
    commit({ tempo: { seconds: Number.isFinite(v) && v > 0 ? boxSeconds(v) : S.tempo.seconds } });
    els.secs.value = boxText(); // show what was accepted (clamped or reverted)
    if (lock) applyLock();
  });
  els.secs.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lockTempo(); // Enter always locks / re-tunes, it never unlocks
  });
  els.lock.addEventListener('click', () => (lock ? unlockTempo() : lockTempo()));
  els.unlock.addEventListener('click', unlockTempo);
  // delegated: the buttons are rebuilt when the mode changes
  els.rates.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rate]');
    if (!b || !els.rates.contains(b)) return;
    const k = b.dataset.rate;
    if (k === 'live') store.goLive();
    else if (k === 'rev') store.setRate(store.rate === 0 ? -1 : -store.rate);
    else store.setRate(Number(k));
  });

  async function powerClick() {
    try {
      await toggle();
    } catch (err) {
      ctx.toast('Audio could not start: ' + (err?.message ?? err));
    }
  }
  els.power.addEventListener('click', powerClick);
  els.moment.addEventListener('click', async () => {
    try {
      const m = await playMoment();
      if (!m) ctx.toast(curPure ? 'Outside the catalogue: no chord to play' : 'Outside the Saros 141 catalogue: no chord to play');
    } catch (err) {
      ctx.toast('Audio could not start: ' + (err?.message ?? err));
    }
  });

  // ---------------------------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------------------------
  async function toggle() {
    const on = await engine.toggle();
    ctx.requestRender();
    return on;
  }
  async function setEnabled(on) {
    const r = await engine.setEnabled(!!on);
    ctx.requestRender();
    return r;
  }
  async function playMoment(t = store.t()) {
    const m = await engine.playMoment(t);
    ctx.requestRender();
    return m;
  }

  // ---------------------------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------------------------
  let lastDraw = 0;
  let pendingDraw = true;
  let forceDraw = false; // the mode changed: repaint both canvases at once
  let drawUntil = 0; // keep painting a moment after the sound stops so the spectrum can fall to silence
  let lastFlash = -1;
  let lastTip = 0;
  let lastSummary = -1e9;
  let tempoKey = '';
  let wasVisible = false;
  const frameGap = reduced ? 90 : 33;
  const flash = new Set();

  const depthRange = () => {
    const on = S.levels.map((v, i) => (v ? i + 1 : 0)).filter(Boolean);
    if (!on.length) return 'no depth';
    const runs = [];
    let a = on[0];
    let p = on[0];
    for (const d of on.slice(1)) {
      if (d !== p + 1) {
        runs.push(a === p ? `${a}` : `${a}–${p}`);
        a = d;
      }
      p = d;
    }
    runs.push(a === p ? `${a}` : `${a}–${p}`);
    return `depth ${runs.join(', ')}`;
  };

  function statusLine(frame, st) {
    if (!frame.inRange) {
      const where = curPure ? `the catalogue (${curPure.catalogueText()})` : 'the Saros 141 catalogue (1613–2857)';
      return [`Outside ${where}: silent. Jump back inside to hear the clock.`, 'warn'];
    }
    if (engine.enabled) {
      const sr = !curPure && st.sampleRate ? `${+(st.sampleRate / 1000).toFixed(1)} kHz` : '';
      const bits = ['Audio on', sr, `${st.voices} voice${st.voices === 1 ? '' : 's'}`];
      if (st.state !== 'running') bits.push(st.state);
      return [bits.filter(Boolean).join(' · '), 'on'];
    }
    return ['Sound is off. Press the speaker (or M) to start.', 'off'];
  }

  function chips(st) {
    const rate = store.rate;
    const on = engine.enabled;
    const out = [];
    if (store.live) out.push(['live', curPure ? 'Live · real time' : 'Live · ×1']);
    else if (rate === 0) out.push(['paused', 'Paused']);
    else if (rate === 1) out.push(['live', curPure ? 'Real time' : 'Real time · ×1']);
    else if (curPure) out.push(['lapse', `${Math.abs(rate) < 1 ? 'Slow motion' : 'Time-lapse'} ${curPure.rateLabel(rate)}`]);
    else out.push(['lapse', `${rate < 0 ? 'Backwards' : Math.abs(rate) < 1 ? 'Slow motion' : 'Time-lapse'} ${fmtRate(Math.abs(rate))}`]);
    out.push(['set', depthRange()]);
    const layers = ['chord', 'chimes', 'physical'].filter((k) => S[k]);
    out.push(['set', layers.length ? layers.join(' + ') : 'no layer']);
    // always present (hidden while the sound is off) so the row never changes height when the sound starts
    const n = on ? st.bells : 0;
    out.push([on ? 'bells' : 'bells is-idle', `${n} bell${n === 1 ? '' : 's'}`]);
    return out.map(([k, t]) => `<span class="chip snd-chip snd-chip-${k}">${t}</span>`).join('');
  }

  function tempoText() {
    const rate = store.rate;
    const L = S.tempo.depth - 1;
    const row = rows[L];
    if (rate === 0) return { read: `Paused: the drone holds and the bells wait. Pick a tempo to start the time-lapse: the cycle you choose will last the ${curPure ? 'Blinks' : 'seconds'} you enter.`, rhythm: '' };
    const ti = tempoInfo(model, S.tempo.depth, rate);
    const read = curPure
      ? `${curPure.rateLabel(rate)}: one ${row.letter} cycle lasts ${W.blinkSpan(curPure, ti.cycle)}; a quarter lasts ${W.blinkSpan(curPure, ti.beat)}.`
      : `${fmtRate(rate)}: one ${row.letter} cycle lasts ${fmtSeconds(ti.cycle)}; a quarter (the beat) ${fmtSeconds(ti.beat)}${ti.beat < 20 ? ` = ${ti.bpm.toFixed(ti.bpm < 100 ? 1 : 0)} BPM` : ''}.`;
    const parts = [];
    let cycle = ti.cycle;
    for (let d = S.tempo.depth; d <= Math.min(rows.length, S.tempo.depth + 4); d++) {
      const r = rows[d - 1];
      const info = model.levelInfo(d - 1);
      const off = !S.levels[d - 1];
      const mode = off || !S.chimes ? null : chimeMode(info.meanSeconds, rate, S.floor);
      const mark = mode === 'quarters' ? ' <i>♪</i>' : mode === 'ends' ? ' <i>♪ end</i>' : '';
      const hz = 1 / cycle; // this cycle's rate in real time
      const zone = amZone(hz);
      const hzText = curPure ? W.pbOf(curPure, hz) : fmtHz(hz);
      let title;
      if (off) title = 'switched off in the Depth mixer: silent';
      else if (mode === 'quarters') title = 'rings on every quarter';
      else if (mode === 'ends') title = 'rings on its end only';
      else if (!S.chord) title = S.chimes ? 'too fast to ring; the Chord layer is off: silent' : 'chimes and chord are off: silent';
      else if (zone === 'full') title = `${S.chimes ? 'too fast to ring: ' : 'chimes are off: '}heard as the drone’s modulation at ${hzText}`;
      else if (zone === 'fade') title = `${S.chimes ? 'too fast to ring: ' : 'chimes are off: '}its modulation of the drone is fading out here (${hzText})`;
      else title = `${S.chimes ? 'too fast to ring and too fast to follow' : 'chimes are off'} (${hzText}): the voice rests at its mean loudness`;
      const cls = `snd-rh${mode ? ' is-bell' : ''}${off ? ' is-off' : ''}`;
      parts.push(`<span class="${cls}" style="--lv:${theme.levelColor(d - 1, 1, 66)}" title="${title}"><b>${r.letter}</b> ${curPure ? W.blinkSpan(curPure, cycle) : fmtSeconds(cycle)}${mark}</span>`);
      const next = cycle / info.factor;
      if (d >= rows.length || d >= S.tempo.depth + 4 || next < 0.004) break; // the multiplier only appears before a next chip
      parts.push(`<span class="snd-rh-x">×${info.factor}</span>`);
      cycle = next;
    }
    return { read, rhythm: parts.join('') };
  }

  function rateButtons() {
    const rate = store.rate;
    for (const b of els.rates.children) {
      const k = b.dataset.rate;
      const on = k === 'live' ? store.live : k === 'rev' ? rate < 0 : !store.live && rate === Number(k);
      attr(b, 'aria-pressed', String(on));
    }
  }

  /** What the two canvases show, in words (screen readers cannot see them); refreshed about once a second. */
  function summaries(on) {
    const order = rows
      .filter((r) => S.levels[r.level] && S.chord)
      .sort((a, b) => loud[b.level] - loud[a.level])
      .slice(0, 3)
      .map((r) => (curPure ? `${r.letter} ${W.pairSay(curPure, loud[r.level], 'loudness')}` : `${r.letter} ${Math.round(loud[r.level] * 100)} %`));
    const base = curPure ? W.groundPhrase(semitonesOf(S.baseHz), W.pbOf(curPure, S.baseHz)) : `base pitch ${noteOf(S.baseHz).name}`;
    attr(
      els.scope,
      'aria-label',
      `Live spectrum and waveform of the sound; coloured ticks mark the notes of the cycles. Sound is ${on ? 'on' : 'off'}, ${base}. ${order.length ? 'Loudest cycles now: ' + order.join(', ') + '.' : 'No cycle is sounding.'}`,
    );
    const sel = rows[store.state.selectedLevel];
    attr(
      els.ring,
      'aria-label',
      `Pitch ring: each cycle as a dot at its pitch class, deeper cycles toward the centre. ${curPure ? 'G' + base.slice(1) : 'Base pitch ' + noteOf(S.baseHz).name}.${sel ? ` Selected: ${sel.letter}, depth ${sel.depth}, ${sel.pcCents.toFixed(1)} cents above the ${curPure ? 'ground' : 'base note'}.` : ''}`,
    );
  }

  /**
   * Build everything that is static for the current vocabulary (lists, options, buttons, legends, the mixer strips)
   * and drop what was cached from the other one. Runs at mount and whenever pure mode is switched, also while the
   * panel is hidden, so showing it later never flashes stale labels.
   */
  function applyMode() {
    const pu = getPure();
    const key = pu ? 'pure' : 'normal';
    if (key === modeKey) return false;
    modeKey = key;
    curPure = pu;
    if (pu) els.app.setAttribute('data-pure', '');
    else els.app.removeAttribute('data-pure');
    root.querySelector('.snd-how').innerHTML = buildHow(pu);
    els.floor.innerHTML = buildFloors(pu);
    els.depth.innerHTML = buildDepths(pu);
    els.rates.innerHTML = buildRates(pu);
    $('.snd-cap').innerHTML = pu ? W.CAPTION : normalTexts.caption;
    $('.snd-legend').innerHTML = pu ? W.LEGEND_MIXER : normalTexts.mixLegend;
    els.legend.innerHTML = pu ? W.LEGEND_RHYTHM : normalTexts.rhLegend;
    $('.snd-auto').textContent = pu ? `${normalTexts.auto} ${W.GLOSSARY_HINT}` : normalTexts.auto;
    secsUnit.textContent = pu ? 'Blinks' : normalTexts.unit;
    els.secs.setAttribute('aria-label', pu ? 'Blinks per cycle' : normalTexts.secsLabel);
    // the number box counts Blinks in pure mode: the same limits as the stored seconds, any step (the spinner moves by 1)
    const [bMin, bMax] = pu ? W.tempoBlinkLimits(pu, LIMITS.tempoSeconds) : [normalTexts.secsMin, normalTexts.secsMax];
    els.secs.setAttribute('min', String(bMin));
    els.secs.setAttribute('max', String(bMax));
    els.secs.setAttribute('step', pu ? 'any' : normalTexts.secsStep);
    mixer.setPure(pu);
    tempoKey = ''; // the tempo read-out and the rhythm chips are rebuilt on the next frame
    lastSummary = -1e9; // so are the screen-reader summaries of the canvases
    pendingDraw = true;
    forceDraw = true;
    syncControls();
    syncLock();
    rateButtons();
    tooltip.invalidate(); // the hidden descriptions are written again when their element is used
    tooltip.refresh(); // an open tip is re-worded at once
    ctx.requestRender();
    return true;
  }

  function render(frame, info) {
    applyMode(); // before the early return: a hidden panel is up to date as well
    // the engine runs by itself; paint only while this tab is showing
    if (info.view !== 'sound') {
      wasVisible = false;
      return;
    }
    const force = !wasVisible || forceDraw;
    forceDraw = false;
    wasVisible = true;
    const now = performance.now();

    // loudness of every cycle right now: the glyph wave, exactly as the engine renders it
    framePos = frame.pos;
    const rate = store.rate;
    for (let L = 0; L < rows.length; L++) {
      loud[L] = framePos === null ? 0 : voiceLoudness(phaseOf(framePos, model.levelInfo(L).prefixNum), cycleHz(rows[L].cycleSeconds, rate));
    }

    const st = engine.stats();
    const on = engine.enabled;
    const [line, tone] = statusLine(frame, st);
    text(els.status, line);
    attr(els.app, 'data-state', tone);
    attr(els.power, 'aria-pressed', String(on));
    html(els.chips, chips(st));

    // the notes of "Hear this moment" that are sounding right now
    const m = engine.moment;
    const ac = engine.context;
    flash.clear();
    let flashMask = 0;
    let playing = false;
    if (m && ac) {
      const ct = ac.currentTime;
      playing = ct < m.end;
      for (const n of m.notes)
        if (ct >= n.at && ct < n.at + 0.45) {
          flash.add(n.level);
          flashMask |= 1 << n.level;
        }
    }
    attr(els.moment, 'aria-busy', String(playing));
    els.moment.classList.toggle('is-playing', playing);
    mixer.update({ on: S.levels, sounding: S.chord, loud, enabled: on, selected: store.state.selectedLevel, flash });

    // canvases: repaint when something changed, while sound is audible, or after a resize (not 30 times a second at rest)
    if (on) drawUntil = now + 900;
    if (force || info.dirty || now < drawUntil || flashMask !== lastFlash || scope.stale || ring.stale) pendingDraw = true;
    if (pendingDraw && (force || now - lastDraw >= frameGap)) {
      lastDraw = now;
      pendingDraw = false;
      lastFlash = flashMask;
      const voices = rows.map((r) => ({
        level: r.level,
        letter: r.letter,
        hz: engine.frequency(r.level),
        loud: loud[r.level],
        on: !!S.levels[r.level] && S.chord,
        flash: flash.has(r.level),
      }));
      scope.draw({
        analyser: engine.analyser,
        voices,
        enabled: on,
        hint: on ? '' : 'Press the speaker to listen',
        pure: curPure ? { pb: (hz) => W.pbOf(curPure, hz) } : false,
        baseHz: S.baseHz,
      });
      ring.draw({
        rows,
        on: S.levels,
        loud: S.chord ? loud : silent,
        enabled: on,
        selected: store.state.selectedLevel,
        baseHz: S.baseHz,
        reduced,
        flash,
        pure: curPure ? { ground: W.groundWords(semitonesOf(S.baseHz)), pb: W.pbOf(curPure, S.baseHz) } : null,
      });
    }
    if (now - lastSummary > 1000) {
      lastSummary = now;
      summaries(on);
    }
    if (now - lastTip > 250) {
      lastTip = now;
      tooltip.refresh(); // the "Now:" row of an open tip follows the clock
    }

    const key = `${rate}|${S.tempo.depth}|${S.floor}|${S.chimes}|${S.chord}|${S.levels.map(Number).join('')}|${modeKey}`;
    if (key !== tempoKey || force) {
      tempoKey = key;
      const tt = tempoText();
      text(els.read, tt.read);
      html(els.rhythm, tt.rhythm);
      els.legend.style.visibility = tt.rhythm ? '' : 'hidden'; // keeps its place: no shift when the time-lapse starts
    }
    rateButtons();
    if (force) {
      syncControls();
      syncLock();
    }
  }

  applyMode(); // builds the lists and options (also in pure mode when the page was opened with ?pure=1) and syncs the controls

  return {
    alwaysOn: true,
    render,
    get enabled() {
      return engine.enabled;
    },
    toggle,
    setEnabled,
    playMoment,
    engine,
    destroy() {
      unsubTime();
      engine.destroy();
      tooltip.destroy();
      scope.destroy();
      ring.destroy();
      topRO?.disconnect();
    },
  };
}
