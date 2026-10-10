/**
 * Pure-mode tooltips of the timeline (HTML strings). The counterpart of the Gregorian tooltips written in
 * timeline.js: the same places answer (lane heads, ruler key, overview, eclipse markers, the plot) but in Fractonica
 * terms – stamps, positions, cycle names, ladder durations and phase glyph pairs instead of dates and percentages.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {object} h     hover state { gutter, kind, lane, x, y, t, inPlot }
 * @param {object} env   { model, store, pure, ruler, words, theme, levels, data, step, hoverEclipse, ovTime }
 * @returns {string} HTML (empty: no tooltip)
 */
export function pureTipHTML(h, env) {
  const { model, store, pure, ruler, words, theme, levels, data } = env;
  /** First unit of the clock part (η ι λ …) of an address; the units before it are the date part. */
  const clockFrom = ruler.unitIndex('eta');
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
      return `<div class="tl-tip-h"><span class="tl-tip-k" style="color:${theme.TEAL}">Saros 141</span></div><div class="tl-tip-p">The ${model.catalogue.length} greatest-eclipse instants (${esc(words.rangeLabel())}) are the time base of the clock. They are numbered ${esc(pure.eclipseName(0))} – ${esc(pure.eclipseName(model.extent))}, like the position. Every fourth one starts an α cycle.</div>`;
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
    return `<div class="tl-tip-h mono">${esc(inside ? ruler.stampText(t, 2) : words.outsideTitle)}</div>${p === null ? '' : `<div class="tl-tip-p mono dim">pos ${p.toFixed(3)}</div>`}<div class="tl-tip-p dim">Click to centre the timeline here · drag the frame to scroll</div>`;
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
        <div class="tl-tip-p dim">Greatest eclipse of Saros 141${i % 4 === 0 ? ' · starts ' + esc(ruler.tokenText(0, i / 4 + 1)) : ''}<br><span class="dim">vs now</span> ${esc(ruler.relText(e, real))} · click to move the cursor here</div>`;
  }

  if (!model.inRange(t)) {
    return `<div class="tl-tip-h">${words.outsideTitle}</div><div class="tl-tip-p">The catalogue spans ${esc(words.rangeLabel())}; the clock is not extrapolated.</div>`;
  }
  const p = model.positionOf(t);
  const upTo = Math.min(ruler.units.length - 1, (env.step?.u ?? 7) + 2);
  const toks = ruler.tokensAtTime(t, 0, upTo); // read at the instant, like the header: never a unit ahead of it
  const date = toks.filter((x) => x.u < clockFrom);
  const clock = toks.filter((x) => x.u >= clockFrom);
  const head = clock.length
    ? `<div class="tl-tip-h mono">${esc(ruler.joinTokens(clock))}</div><div class="tl-tip-p mono dim">${esc(ruler.joinTokens(date))}</div>`
    : `<div class="tl-tip-h mono">${esc(ruler.joinTokens(date))}</div>`;
  let rel = `<span class="dim">vs now</span> ${esc(ruler.relText(t, real))}`;
  if (!store.live) rel += `<br><span class="dim">vs cursor</span> ${esc(ruler.relText(t, store.t()))}`;

  let rows = '';
  let focus = null;
  levels.forEach((L, i) => {
    const r = model.levelAt(t, L);
    if (!r) return;
    const on = i === h.lane;
    rows += `<div class="tl-tip-row${on ? ' is-on' : ''}">${chip(L)}<span class="mono">${r.local + 1}/${r.siblings}</span>${pure.pairHTML(r.phase)}</div>`;
    if (on) focus = { L, r };
  });
  let detail = '';
  if (focus) {
    const f = focus.r;
    const names = words.cycleNames(focus.L, f.cycle);
    const last = f.end >= model.tMax - 1e-3;
    const into = words.endsInto(focus.L, f.cycle, last);
    const ends = last ? 'ends with the catalogue' : `ends ${esc(ruler.relText(f.end, t))} → ${esc(into.short)} begins`;
    detail = `<div class="tl-tip-p tl-tip-detail">${chip(focus.L, ` <span class="mono">${esc(names.name)}</span>`)}<div class="tl-tip-sub dim">${esc(names.short)} · ${f.local + 1}/${f.siblings} · lasts ${esc(words.cycleLength(focus.L))} · ${ends}</div></div>`;
  }
  return `${head}
      <div class="tl-tip-p mono dim">pos ${p.toFixed(6)} · ${between(p)}</div>
      <div class="tl-tip-p">${rel}</div>${detail}<div class="tl-tip-grid">${rows}</div>`;
}
