/**
 * Pure-mode tooltips of the timeline (HTML strings). The counterpart of the Gregorian tooltips written in
 * timeline.js: the same places answer (lane heads, ruler key, overview, eclipse markers, the plot) but in Fractonica
 * terms (SPEC §15, docs/design/80-pure.md revision 3):
 *   - the plot: the date in words (major periods with their quarter, then the Nuclide and the counts), the stamp in
 *     letters, the position, countdowns in ladder units (below ten Blinks as decimals, "0.4ν");
 *   - one row per lane: a major period's place and QUARTER WORD (its phase is never drawn), a minor depth's placing
 *     count and its phase as a glyph pair.
 * Names of units appear only where a unit is explained (lane heads, the ruler key).
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {object} h     hover state { gutter, kind, lane, x, y, t, inPlot }
 * @param {object} env   { model, store, pure, ruler, words, theme, levels, data, step, hoverEclipse, ovTime }
 * @returns {string} HTML (empty: no tooltip)
 */
export function pureTipHTML(h, env) {
  const { model, store, pure, ruler, words, theme, levels, data } = env;
  const IOTA = ruler.unitIndex('iota');
  const DELTA = ruler.unitIndex('delta');
  /** Where a position lies among the eclipses, in their own numbers: "between #22 and #23". */
  const between = (p) => {
    const k = Math.min(model.extent - 1, Math.floor(p));
    return `between ${pure.eclipseName(k)} and ${pure.eclipseName(k + 1)}`;
  };
  const chip = (L, extra = '') => {
    const inf = model.levelInfo(L);
    return `<span class="tl-tip-k" style="color:${theme.levelColor(L, 1, 72)}">${inf.letter} ${inf.depth}</span>${extra}`;
  };

  if (h.gutter) {
    if (h.kind === 'lane') {
      const L = levels[h.lane];
      if (L === undefined) return '';
      const inf = model.levelInfo(L);
      return `<div class="tl-tip-h"><span class="tl-tip-k" style="color:${theme.levelColor(L, 1, 72)}">${inf.letter}</span> <span class="dim">· depth ${inf.depth}</span></div><div class="tl-tip-p">${esc(words.laneTip(L, data.alpha.length))}</div><div class="tl-tip-p dim">Click to select this depth in every view.</div>`;
    }
    if (h.kind === 'eclipse') {
      return `<div class="tl-tip-h"><span class="tl-tip-k" style="color:${theme.TEAL}">Saros 141</span></div><div class="tl-tip-p">The ${model.catalogue.length} greatest-eclipse instants (${esc(words.rangeLabel())}) are the time base of the clock. They are numbered ${esc(pure.eclipseName(0))} – ${esc(pure.eclipseName(model.extent))}, like the position. Every fourth one starts an Alpha.</div>`;
    }
    if (h.kind === 'overview') {
      return `<div class="tl-tip-h">Catalogue map</div><div class="tl-tip-p">The whole Saros 141 catalogue (${esc(words.rangeLabel())}); the numbers are eclipse numbers, like the position (${esc(pure.eclipseName(10))} sits at pos 10). The teal frame is what the timeline shows. Drag it, or click to jump there.</div>`;
    }
    if (h.kind === 'axis' && env.step) {
      return `<div class="tl-tip-h">Ruler</div><div class="tl-tip-p">${esc(words.rulerTip(env.step))}</div>`;
    }
    return '';
  }

  if (h.kind === 'overview') {
    const t = env.ovTime(h.x);
    const inside = model.inRange(t);
    const p = inside ? model.positionOf(t) : null;
    return `<div class="tl-tip-h">${esc(inside ? pure.dateText(t, { form: 'full', upTo: 'delta' }) : words.outsideTitle)}</div>${p === null ? '' : `<div class="tl-tip-p mono dim">${esc(ruler.stampText(t, DELTA))} · pos ${p.toFixed(3)}</div>`}<div class="tl-tip-p dim">Click to centre the timeline here · drag the frame to scroll</div>`;
  }
  if (!h.inPlot || h.t === null) return '';
  const t = h.t;
  const real = store.realNow();

  if (h.kind === 'eclipse' && env.hoverEclipse >= 0) {
    const i = env.hoverEclipse;
    const e = data.eclipses[i];
    const inAlpha = ruler.chainAtTime(e, 0, 1);
    return `<div class="tl-tip-h"><span class="tl-tip-k" style="color:${theme.TEAL}">Eclipse ${words.eclipseLabel(i)}</span> <span class="dim">· one of ${data.eclipses.length}</span></div>
        <div class="tl-tip-p mono">pos ${i} <span class="dim">· in ${esc(inAlpha)}</span></div>
        <div class="tl-tip-p dim">Greatest eclipse of Saros 141${i % 4 === 0 ? ' · starts ' + esc(pure.periodName(0, i / 4 + 1)) : ''}<br><span class="dim">vs now</span> ${esc(ruler.relText(e, real))} · click to move the cursor here</div>`;
  }

  if (!model.inRange(t)) {
    return `<div class="tl-tip-h">${words.outsideTitle}</div><div class="tl-tip-p">The catalogue spans ${esc(words.rangeLabel())}; the clock is not extrapolated.</div>`;
  }
  const p = model.positionOf(t);
  // the date runs on two units below the tick unit ("Delta Trifracton End ε#5 33η 29ι 21λ 3ν" while the ticks are ι);
  // over major ticks it names every major period with its quarter
  const tick = env.step?.u ?? IOTA;
  const upTo = ruler.units[Math.max(DELTA, ruler.below(tick, 2))].id;
  const form = tick <= DELTA ? 'full' : 'short';
  const head = `<div class="tl-tip-h">${esc(pure.dateText(t, { form, upTo }))}</div><div class="tl-tip-p mono dim">${esc(ruler.stampText(t, ruler.unitIndex(upTo)))}</div>`;
  let rel = `<span class="dim">vs now</span> ${esc(ruler.relText(t, real))}`;
  if (!store.live) rel += `<br><span class="dim">vs cursor</span> ${esc(ruler.relText(t, store.t()))}`;

  let rows = '';
  let focus = null;
  levels.forEach((L, i) => {
    const r = model.levelAt(t, L);
    if (!r) return;
    const on = i === h.lane;
    const cyc = r.cycleBig ?? r.cycle;
    // a major period: its place and its quarter (the phase is implied by the minor counts); a minor depth: its placing count and phase pair
    const body = pure.isMajor(L)
      ? `<span class="mono">${r.local + 1}/${r.siblings ?? data.alpha.length}</span><span class="tl-tip-q">${esc(pure.QUARTER_WORDS[pure.quarterAt(t, L)])}</span>`
      : `<span class="mono">${esc(pure.cycleShort(L, cyc))}</span>${pure.pairHTML(r.phase)}`;
    rows += `<div class="tl-tip-row${on ? ' is-on' : ''}">${chip(L)}${body}</div>`;
    if (on) focus = { L, r, cyc };
  });
  let detail = '';
  if (focus) {
    const { L, r: f, cyc } = focus;
    const major = pure.isMajor(L);
    const last = f.end >= model.tMax - 1e-3;
    const into = words.endsInto(L, cyc, last);
    const ends = last ? 'ends with the catalogue' : `ends ${esc(ruler.relText(f.end, t))} → ${esc(into.say)} begins`;
    const title = major ? pure.majorText(t, L) : pure.cycleName(L, cyc);
    const facts = major ? [esc(pure.cycleShort(L, cyc)), `${f.local + 1}/${f.siblings ?? data.alpha.length}`, ends] : [esc(words.lastsText(L)), ends].filter(Boolean);
    detail = `<div class="tl-tip-p tl-tip-detail">${chip(L, ` <span class="mono">${esc(title)}</span>`)}<div class="tl-tip-sub dim">${facts.join(' · ')}</div></div>`;
  }
  return `${head}
      <div class="tl-tip-p mono dim">pos ${p.toFixed(6)} · ${between(p)}</div>
      <div class="tl-tip-p">${rel}</div>${detail}<div class="tl-tip-grid">${rows}</div>`;
}
