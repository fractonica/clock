/**
 * Level mixer: one strip per depth 1..14 in the level colour. A strip toggles its voice (mute), shows the
 * live loudness of its cycle (the same phase function the engine plays) and names the note it stands for:
 *   epsilon 5 · 1625:1024      349.1 Hz · F4 −1¢ · 16.2 d
 * Hovering, focusing or (on a touch screen) tapping a strip explains where the note comes from.
 *
 * Pure mode (`getPure()` returns ctx.pure): the second line reads `octave +1 · 801¢ · 2ε½` (octave offset, cents above the
 * ground, cycle length counted in Fractonica periods) instead of Hz, note name and an Earth duration, the ratio is
 * written with a slash ("65/64"), and the tooltip speaks in ratios, cents, periods and glyph pairs.
 */
import { levelColor } from '../../core/theme.js';
import { frequencyOf, noteLabel } from '../../audio/tuning.js';
import { fmtHz, fmtPeriod, fmtInt } from '../../audio/format.js';
import * as W from '../../audio/words.js';

export function createMixer(root, { rows, model, fmt, tooltip, getBase, getLive, getPure = () => null, onToggle, onSelect }) {
  const strips = rows.map((row) => {
    const L = row.level;
    const info = model.levelInfo(L);
    const el = document.createElement('div');
    el.className = 'snd-strip';
    el.dataset.level = String(L);
    el.style.setProperty('--lv', levelColor(L, 1, 64));
    el.style.setProperty('--lv-dim', levelColor(L, 0.22, 64));
    const name = `depth ${row.depth} (${row.letter})`;
    const period = fmtPeriod(info.meanSeconds); // shown after the note, or at the end of the first line on a phone
    // the visible text is part of the accessible name (a voice-control user can say "1625:1024")
    el.innerHTML = `
      <button class="snd-strip-on" type="button" aria-pressed="true" aria-label="Sound ${name}">${row.letter}</button>
      <button class="snd-strip-main" type="button">
        <span class="sr-only">Select ${name}: </span>
        <span class="snd-l1"><span class="snd-depth mono">${row.depth}</span><span class="snd-ratio mono">${row.ratio}</span><span class="snd-per-n mono">${period}</span></span>
        <span class="snd-l2 mono"><span class="snd-hz"></span><span class="snd-note"></span><span class="snd-per">${period}</span></span>
      </button>
      <span class="snd-meter" aria-hidden="true"><i></i></span>`;
    root.append(el);
    const s = {
      L,
      el,
      on: el.querySelector('.snd-strip-on'),
      main: el.querySelector('.snd-strip-main'),
      ratio: el.querySelector('.snd-ratio'),
      perN: el.querySelector('.snd-per-n'),
      per: el.querySelector('.snd-per'),
      hz: el.querySelector('.snd-hz'),
      note: el.querySelector('.snd-note'),
      bar: el.querySelector('.snd-meter i'),
      lastHz: NaN,
      lastLoud: -1,
      lastOn: null,
      lastSel: null,
      lastFlash: false,
    };
    s.on.addEventListener('click', () => onToggle(L));
    s.main.addEventListener('click', () => onSelect(L));
    // tap on the row (not on the mute button) opens the explanation on touch screens
    tooltip.bind(el, () => tipHtml(row, info), { touch: '.snd-strip-main', describe: '.snd-strip-main' });
    return s;
  });

  function tipHtml(row, info) {
    const pu = getPure();
    if (pu) return W.voiceTip({ row, info, pure: pu, live: getLive(row.level), int: fmtInt, color: levelColor(row.level, 1, 70) });
    const base = getBase();
    const hz = frequencyOf(row, base);
    const live = getLive(row.level);
    const place = row.octave === 0 ? 'at the base octave' : `${row.octave} octave${row.octave > 1 ? 's' : ''} above the base`;
    const cents = row.pcCents.toFixed(1);
    const state = live ? `${Math.round(live.phase * 100)} % through its cycle (${live.state}), loudness ${Math.round(live.loud * 100)} %` : 'outside the catalogue';
    const p = info.prefixNum;
    const truth =
      p === 1
        ? 'The slowest cycle of the hierarchy is the base note itself: 1 : 1.'
        : `${fmtInt(p)} such cycles fit in one α cycle: its true rate is <b class="mono">${fmtInt(p)} : 1</b> to α.`;
    const sounds = row.rel === 1 ? '' : `, sounding at <b class="mono">${row.rel.toFixed(row.rel < 10 ? 2 : 1)} : 1</b> to α`;
    return `<b style="color:${levelColor(row.level, 1, 70)}">${row.letter}</b> <b>depth ${row.depth}</b> · one cycle = ${fmt.duration(info.meanSeconds, { parts: 2 })}
      <div class="snd-tip-row">${truth}</div>
      <div class="snd-tip-row">Folded into one octave: <b class="mono">${row.num}/${row.den}</b> = ${(Number(row.num) / Number(row.den)).toFixed(4)} (${cents}¢)</div>
      <div class="snd-tip-row">Placed ${place}: <b class="mono">${fmtHz(hz)}</b>, ${noteLabel(hz)}${sounds}</div>
      <div class="snd-tip-row dim">True rate of this cycle: ${fmtHz(row.trueHz)}</div>
      <div class="snd-tip-row">Now: ${state}</div>`;
  }

  /** Say the static parts of every strip in the vocabulary of the mode (`pu` = ctx.pure or null); the second line follows in update(). */
  function setPure(pu) {
    for (const s of strips) {
      const period = pu ? pu.cycleLength(s.L) : fmtPeriod(model.levelInfo(s.L).meanSeconds);
      s.ratio.textContent = pu ? W.ratioText(rows[s.L]) : rows[s.L].ratio;
      s.perN.textContent = period;
      s.per.textContent = period;
      s.lastHz = NaN; // rewrite the note line at the next update
    }
  }

  let lastLive = null;
  let lastQuiet = null;
  /**
   * @param {{on:boolean[], sounding:boolean, loud:number[], enabled:boolean, selected:number, flash:Set<number>}} s
   *   on        which depths are switched on (the mute toggles)
   *   sounding  the chord layer is on: only then a meter shows a drone that is really playing
   */
  function update({ on, sounding = true, loud, enabled, selected, flash }) {
    const base = getBase();
    const pu = getPure();
    for (const s of strips) {
      const L = s.L;
      if (pu) {
        // octave offset and cents above the ground do not depend on the base pitch: written once per mode
        if (s.lastHz !== -1) {
          s.hz.textContent = W.octaveOffset(rows[L].octave);
          s.note.textContent = W.cents(rows[L].pcCents);
          s.lastHz = -1;
        }
      } else {
        const hz = frequencyOf(rows[L], base);
        if (!(Math.abs(hz - s.lastHz) <= 1e-6)) {
          s.hz.textContent = fmtHz(hz);
          s.note.textContent = noteLabel(hz);
          s.lastHz = hz;
        }
      }
      if (s.lastOn !== on[L]) {
        s.on.setAttribute('aria-pressed', String(on[L]));
        s.el.classList.toggle('is-off', !on[L]);
        s.lastOn = on[L];
      }
      const q = on[L] && sounding ? Math.round(loud[L] * 200) / 200 : 0;
      if (q !== s.lastLoud) {
        s.bar.style.transform = `scaleX(${q})`;
        s.lastLoud = q;
      }
      const sel = L === selected;
      if (sel !== s.lastSel) {
        s.el.classList.toggle('is-selected', sel);
        if (sel) s.main.setAttribute('aria-current', 'true');
        else s.main.removeAttribute('aria-current');
        s.lastSel = sel;
      }
      const fl = flash.has(L);
      if (fl !== s.lastFlash) {
        s.el.classList.toggle('is-flash', fl);
        s.lastFlash = fl;
      }
    }
    if (lastLive !== enabled) {
      root.classList.toggle('is-live', enabled);
      lastLive = enabled;
    }
    if (lastQuiet !== !sounding) {
      root.classList.toggle('is-quiet', !sounding);
      lastQuiet = !sounding;
    }
  }

  return { update, setPure, strips, tipHtml: (L) => tipHtml(rows[L], model.levelInfo(L)) };
}
