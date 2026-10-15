/**
 * The eclipse sheets (docs/design/90-diary.md, "Eclipses"): a Helion that holds an eclipse gets two sheets before its
 * regular sheet.
 *
 *   eclipse         (recto) the eclipse: its name and moment, a figure over the top half – the path on a gnomonic cube
 *                   net for a solar eclipse (src/diary/geo/eclipse-map.js), the Moon crossing the Earth's shadow for a
 *                   lunar one – then its circumstances and contacts, what the diary's place sees, and its Saros series
 *   saros           (verso) every eclipse of that Saros series with its date (normal mode), type and Fractonica address
 *   eclipse-helion  (recto) the eclipse's Helion in detail: a line per Preon, a Flavon ruler and the eclipse phases in
 *                   the inner margin, every contact on its moment with a picture of the discs
 *   canvas          (verso) a blank canvas for the Helion (render/helion.js)
 * Data: plan.eclipses[page.eclipse] = {ev, detail, local, saros, geo, d} (src/ui/diary/build.js; detail, local and
 * saros from src/diary/astro/eclipse-detail.js, geo from src/diary/geo/saros-geo.js); plan.world for the map.
 */
import { SIZE, n2, wrap, dodge, measure } from './common.js';
import { drawTable, paragraph } from './table.js';
import { sectionBoxes, drawSectionHeader, drawRuled, drawMajors, drawMargin, marginBounds } from './helion.js';
import { eclipseMapSvg } from '../geo/eclipse-map.js';

/** The penumbra's grey: light, but visible on print next to the paper's white. */
const PENUMBRA = '#e2e6ea';
let clipSeq = 0;
const clipId = () => `dyc${(++clipSeq).toString(36)}`;

const KIND_WORD = { total: 'total', annular: 'annular', hybrid: 'hybrid', partial: 'partial', penumbral: 'penumbral' };
const deg = (v, pos, neg) => (Number.isFinite(v) ? `${Math.abs(v).toFixed(1)}° ${v < 0 ? neg : pos}` : '—');
const isSolar = (x) => x.ev.name === 'solar-eclipse';
/** A local contact's name: C1 … C4 (normal); pure mode spells them out ("C1" reads like a note name there). */
const ORD = ['1st', '2nd', '3rd', '4th'];
const contactName = (cx, name) => (cx.pureMode && /^C[1-4]$/.test(name) ? `${ORD[Number(name[1]) - 1]} contact` : name);

/** A span of seconds: "4 min 28 s", "1 h 12 min" (normal); pure: in Fractonica units. */
function spanText(cx, s, t) {
  if (!(s > 0)) return '—';
  if (cx.pureMode) return cx.pure.duration(s, { at: t });
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}
/** A moment: "Sat 26 Sep 18:49 · 55η 27ι 37λ" (normal) or the clock alone (pure). */
const whenText = (cx, t) => (cx.greg ? `${cx.gDayTime(t)} · ${cx.fClock(t)}` : cx.fShort(t, 'lambda'));

/** Key–value rows in a column; returns the y below. */
function facts(svg, cx, x, y, w, rows, { size = 1.75, rowH = 3.3 } = {}) {
  const { pal } = cx;
  let yy = y;
  for (const r of rows) {
    if (!r) continue;
    yy += rowH;
    if (r.head) {
      svg.text(x, yy, r.head.toUpperCase(), { size: SIZE.tiny * 0.95, fill: r.fill ?? pal.ink3, ls: 0.12, maxW: w, weight: 600 });
      continue;
    }
    const lw = Math.min(w * 0.42, measure(r.k, size, { font: cx.font }) + 1.2);
    svg.text(x, yy, r.k, { size, fill: pal.ink3, maxW: lw });
    svg.text(x + w, yy, r.v, { size, fill: r.fill ?? pal.ink, anchor: 'end', weight: r.weight, maxW: w - lw - 0.8, min: size * 0.8 });
  }
  return yy;
}

// ---- page 1: the eclipse ---------------------------------------------------------------------------------------

export function renderEclipse(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const x = plan.eclipses?.[page.eclipse];
  if (!x) return;
  const ev = x.ev;
  const det = x.detail ?? {};
  const sar = x.saros;
  svg.runs(fr.x0, fr.y0 + 5, [
    { text: '●', size: 4, fill: pal.eclipse },
    { text: ev.label ?? 'Eclipse', size: 5, weight: 600, fill: pal.ink, gap: 1.4 },
  ], { maxW: fr.cw });
  svg.text(fr.x0, fr.y0 + 9.4, [cx.fStamp(ev.t, 'lambda'), cx.greg ? cx.gLong(ev.t) : null].filter(Boolean).join(' · '), { size: 1.9, fill: pal.ink2, maxW: fr.cw });
  const line3 = [sar ? `Saros ${sar.saros} · ${sar.member} of ${sar.count}` : null, Number.isFinite(det.magnitude ?? ev.magnitude) ? `magnitude ${(det.magnitude ?? ev.magnitude).toFixed(4)}` : null, Number.isFinite(det.gamma ?? ev.gamma) ? `γ ${(det.gamma ?? ev.gamma).toFixed(4)}` : null].filter(Boolean).join(' · ');
  svg.text(fr.x0, fr.y0 + 13, line3, { size: 1.8, fill: pal.ink3, maxW: fr.cw });

  // the figure: the top half of the page
  const box = { x: fr.x0, y: fr.y0 + 15.5, w: fr.cw, h: fr.ch * 0.5 };
  if (isSolar(x)) {
    if (x.geo && plan.world) {
      const place = plan.sky ? { lat: plan.sky.lat, lon: plan.sky.lon, place: plan.sky.place } : null;
      svg.add(eclipseMapSvg({ record: x.geo, world: plan.world, box, pal, place, pure: cx.pureMode }));
    } else {
      svg.rect(box.x, box.y, box.w, box.h, { stroke: pal.ruleStrong, sw: 0.2, fill: pal.shade });
      svg.text(box.x + box.w / 2, box.y + box.h / 2, 'No path data for this eclipse', { size: 2, fill: pal.ink3, anchor: 'middle', maxW: box.w - 4 });
    }
  } else lunarFigure(svg, cx, box, x);

  // below: circumstances and contacts | the place and the Saros series
  const top = box.y + box.h + 3;
  const colW = (fr.cw - 6) / 2;
  const left = [];
  const t = det.t ?? ev.t;
  left.push({ head: 'Greatest eclipse' });
  left.push({ k: 'Moment', v: cx.greg ? cx.gDayTime(t) : cx.fShort(t, 'lambda') });
  if (cx.greg) left.push({ k: 'Fractonica', v: cx.fClock(t) });
  if (isSolar(x)) {
    const g = det.greatest ?? {};
    left.push({ k: 'Where', v: `${deg(g.lat, 'N', 'S')}, ${deg(g.lon, 'E', 'W')}` });
    if (Number.isFinite(g.sunAlt)) left.push({ k: 'Solar altitude', v: `${g.sunAlt.toFixed(0)}°` });
    if (g.duration) left.push({ k: ev.kind === 'annular' ? 'Annularity' : 'Totality', v: spanText(cx, g.duration, t) });
    if (g.width) left.push({ k: 'Path width', v: `${Math.round(g.width)} km` });
  } else {
    if (Number.isFinite(det.umbral)) left.push({ k: 'Umbral magnitude', v: det.umbral.toFixed(4) });
    if (Number.isFinite(det.penumbral)) left.push({ k: 'Penumbral magnitude', v: det.penumbral.toFixed(4) });
    const c = Object.fromEntries((det.contacts ?? []).map((k) => [k.name, k.t]));
    if (c.U2 && c.U3) left.push({ k: 'Totality', v: spanText(cx, c.U3 - c.U2, t) });
    if (c.U1 && c.U4) left.push({ k: 'Umbral phases', v: spanText(cx, c.U4 - c.U1, t) });
    if (c.P1 && c.P4) left.push({ k: 'Whole eclipse', v: spanText(cx, c.P4 - c.P1, t) });
  }
  left.push({ head: 'Contacts' });
  for (const k of det.contacts ?? []) left.push({ k: `${k.name} ${k.label ?? ''}`.trim(), v: cx.greg ? cx.gDayTime(k.t) : cx.fShort(k.t, 'lambda'), fill: k.name === 'max' ? pal.eclipse : pal.ink });

  const right = [];
  const place = plan.sky?.place ?? (plan.sky ? `${deg(plan.sky.lat, 'N', 'S')}, ${deg(plan.sky.lon, 'E', 'W')}` : null);
  const loc = x.local;
  if (place && loc) {
    right.push({ head: `At ${place}` });
    if (isSolar(x)) {
      if (!loc.visible) right.push({ k: 'Seen', v: 'not from here', fill: pal.ink3 });
      else {
        right.push({ k: 'Seen as', v: KIND_WORD[loc.kind] ?? loc.kind });
        if (Number.isFinite(loc.magnitude)) right.push({ k: 'Magnitude', v: loc.magnitude.toFixed(3) });
        if (Number.isFinite(loc.obscuration)) right.push({ k: 'Obscuration', v: `${(loc.obscuration * 100).toFixed(1)}`.replace(/$/, cx.pureMode ? ' of 100' : ' %') });
        for (const k of loc.contacts ?? []) right.push({ k: `${contactName(cx, k.name)}${Number.isFinite(k.sunAlt) ? ` · ${Math.round(k.sunAlt) || 0}°` : ''}`, v: cx.greg ? cx.gDayTime(k.t) : cx.fShort(k.t, 'lambda'), fill: k.sunAlt < 0 ? pal.ink4 : pal.ink });
      }
    } else {
      const alts = loc.moonAlt ?? [];
      right.push({ k: 'Seen', v: loc.visible ? 'yes' : 'no: the Moon is down', fill: loc.visible ? pal.ink : pal.ink3 });
      (det.contacts ?? []).forEach((k, i) => Number.isFinite(alts[i]) && right.push({ k: `${k.name} lunar altitude`, v: `${Math.round(alts[i]) || 0}°`, fill: alts[i] < 0 ? pal.ink4 : pal.ink }));
    }
  }
  if (sar) {
    right.push({ head: `Saros ${sar.saros}` });
    right.push({ k: 'This one', v: `${sar.member} of ${sar.count}` });
    const one = (m, k) => m && right.push({ k, v: `${KIND_WORD[m.kind] ?? m.kind} · ${memberWhen(cx, m.t)}` });
    one(sar.prev, 'Previous');
    one(sar.next, 'Next');
    one(sar.members?.[0], 'First');
    one(sar.members?.at(-1), 'Last');
  }
  const rowH = Math.min(3.4, (fr.y1 - top - 1) / Math.max(left.length, right.length, 1));
  const size = Math.min(1.75, rowH * 0.56);
  facts(svg, cx, fr.x0, top, colW, left, { size, rowH });
  facts(svg, cx, fr.x0 + colW + 6, top, colW, right, { size, rowH });
  // credits of the path data
  if (isSolar(x) && x.geo) svg.text(fr.x1, box.y + box.h + 2.1, 'Path: NASA eclipse predictions (F. Espenak) · map: Natural Earth', { size: 1.5, fill: pal.ink3, anchor: "end", maxW: fr.cw });
}

/** The moment of a Saros member: its Gregorian date (normal mode) or its Fractonica address when the clock covers it. */
function memberWhen(cx, t) {
  if (cx.greg) return cx.gDay(t, { year: true, weekday: false });
  const m = cx.env.model;
  return m.inRange(t) ? cx.fStamp(t, 'eta') : 'beyond the catalogue';
}

/** The Moon's path through the Earth's shadow: penumbra and umbra, the Moon at every contact and at greatest eclipse. */
function lunarFigure(svg, cx, box, x) {
  const { pal } = cx;
  const det = x.detail;
  if (!det?.shadow || !det.at) return;
  const contacts = det.contacts ?? [];
  const pts = contacts.map((c) => ({ ...c, ...det.at(c.t) }));
  // fit: the penumbra and the Moon at P1 / P4
  const R = det.shadow.penumbra + det.shadow.moon;
  let ext = R;
  for (const p of pts) ext = Math.max(ext, Math.abs(p.x) + det.shadow.moon, Math.abs(p.y) + det.shadow.moon);
  const k = Math.min(box.w, box.h - 6) / (2 * ext * 1.06);
  const cx0 = box.x + box.w / 2;
  const cy0 = box.y + (box.h - 4) / 2;
  // sky orientation: north up, east LEFT (as the sky is seen from the Earth)
  const X = (v) => cx0 - v * k;
  const Y = (v) => cy0 - v * k;
  svg.circle(cx0, cy0, det.shadow.penumbra * k, PENUMBRA, { stroke: pal.rule, sw: 0.2 });
  svg.circle(cx0, cy0, det.shadow.umbra * k, pal.ink4, { stroke: pal.ink3, sw: 0.2 });
  // the path of the Moon's centre from first to last contact
  if (pts.length >= 2) {
    const t0 = pts[0].t;
    const t1 = pts.at(-1).t;
    const path = [];
    for (let i = 0; i <= 40; i++) {
      const p = det.at(t0 + ((t1 - t0) * i) / 40);
      path.push(`${n2(X(p.x))} ${n2(Y(p.y))}`);
    }
    svg.path(`M${path.join('L')}`, { stroke: pal.ink3, sw: 0.18, dash: '0.8 0.6' });
  }
  const r = det.shadow.moon * k;
  const labels = [];
  for (const p of pts) {
    const id = clipId();
    svg.add(`<clipPath id="${id}"><circle cx="${n2(X(p.x))}" cy="${n2(Y(p.y))}" r="${n2(r)}"/></clipPath>`);
    svg.add(`<g clip-path="url(#${id})"><circle cx="${n2(X(p.x))}" cy="${n2(Y(p.y))}" r="${n2(r)}" fill="#ffffff"/><circle cx="${n2(cx0)}" cy="${n2(cy0)}" r="${n2(det.shadow.penumbra * k)}" fill="${PENUMBRA}"/><circle cx="${n2(cx0)}" cy="${n2(cy0)}" r="${n2(det.shadow.umbra * k)}" fill="${pal.ink3}"/></g>`);
    svg.circle(X(p.x), Y(p.y), r, 'none', { stroke: p.name === 'max' ? pal.eclipse : pal.ink2, sw: p.name === 'max' ? 0.35 : 0.2 });
    labels.push({ p, want: Y(p.y) + r + 0.6, h: 2.2 });
  }
  // labels under each Moon, kept apart along x by alternating above / below when they crowd
  labels.forEach((l, i) => {
    const below = i % 2 === 0;
    const y = below ? Y(l.p.y) + r + 2.1 : Y(l.p.y) - r - 0.8;
    svg.text(X(l.p.x), y, l.p.name === 'max' ? 'max' : l.p.name, { size: 1.6, fill: l.p.name === 'max' ? pal.eclipse : pal.ink2, anchor: 'middle', weight: 600, halo: true });
  });
  svg.text(box.x + 1, box.y + 2.4, 'N ↑   E ←', { size: 1.5, fill: pal.ink3 });
  svg.text(box.x + box.w - 1, box.y + box.h - 1, 'penumbra · umbra · the Moon at each contact', { size: 1.6, fill: pal.ink3, anchor: 'end', maxW: box.w * 0.7 });
}

// ---- page 2: the Saros series --------------------------------------------------------------------------------

export function renderSaros(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const x = plan.eclipses?.[page.eclipse];
  const sar = x?.saros;
  if (!sar) return;
  const solar = isSolar(x);
  svg.runs(fr.x0, fr.y0 + 5, [
    { text: `Saros ${sar.saros}`, size: 5, weight: 600, fill: pal.ink },
    { text: `${sar.count} ${solar ? 'solar' : 'lunar'} eclipses · this is ${sar.member}`, size: SIZE.small, fill: pal.ink3, gap: 2 },
  ], { maxW: fr.cw });
  const own = solar && sar.saros === 141;
  const sub = own
    ? 'The clock’s own series: its eclipses are the catalogue the Fractonica clock counts from (eclipse #k at pos k).'
    : solar
      ? 'One Saros (223 lunations) apart: each eclipse returns with nearly the same geometry, its path a third of the way round the Earth further west.'
      : 'One Saros (223 lunations) apart: each eclipse returns with nearly the same geometry, seen from a third of the way round the Earth further west.';
  paragraph(svg, cx, fr.x0, fr.y0 + 7.4, wrap(sub, fr.cw, 1.7, { maxLines: 2, font: cx.font }), { size: 1.7, maxW: fr.cw, fill: pal.ink3 });
  const members = sar.members ?? [];
  const cols = 2;
  const per = Math.ceil(members.length / cols);
  const top = fr.y0 + 14;
  const colW = (fr.cw - 4) / cols;
  const rowH = Math.min(4.2, (fr.y1 - top - 4) / Math.max(1, per));
  const inDiary = new Map(plan.eclipses.map((e) => [Math.round(e.ev.t), e.page]));
  for (let c = 0; c < cols; c++) {
    const slice = members.slice(c * per, c * per + per);
    const rows = slice.map((m) => {
      const me = m.member === sar.member;
      const pg = [...inDiary.entries()].find(([t]) => Math.abs(t - m.t) < 3600)?.[1];
      const addr = cx.env.model.inRange(m.t) ? cx.fStamp(m.t, 'eta') : '—';
      return {
        fill: me ? pal.eclipse : undefined,
        weight: me ? 600 : undefined,
        cells: {
          n: { text: String(m.member), fill: me ? pal.eclipse : pal.ink3 },
          date: cx.greg ? { text: cx.gDay(m.t, { year: true, weekday: false }), fill: me ? pal.eclipse : pal.ink2 } : '',
          kind: { text: KIND_WORD[m.kind] ?? m.kind ?? '', fill: me ? pal.eclipse : pal.ink2 },
          addr: { text: pg ? `${addr} · p${pg}` : addr, fill: me ? pal.eclipse : pal.ink },
        },
      };
    });
    drawTable(svg, cx, {
      x0: fr.x0 + c * (colW + 4),
      x1: fr.x0 + c * (colW + 4) + colW,
      y: top,
      rowH,
      size: Math.min(1.6, rowH * 0.5),
      gap: 1.2,
      cols: [{ key: 'n', align: 'end', min: 2.4 }, ...(cx.greg ? [{ key: 'date' }] : []), { key: 'kind' }, { key: 'addr', flex: true }],
      rows,
      header: { n: '#', date: 'Date', kind: 'Type', addr: 'Fractonica' },
      headH: 3.6,
    });
  }
}

// ---- page 3: the Helion in detail ---------------------------------------------------------------------------

const PHASE = { solar: [['P1', 'P4', 'eclipseSoft'], ['U1', 'U4', 'eclipse']], lunar: [['P1', 'P4', 'soft'], ['U1', 'U4', 'mid'], ['U2', 'U3', 'dark']] };

export function renderEclipseHelion(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const x = plan.eclipses?.[page.eclipse];
  const h = plan.helions[page.helion];
  if (!x || !h) return;
  const [box] = sectionBoxes(fr, 1);
  drawSectionHeader(svg, cx, fr, box, h, { badge: 'eclipse' });
  const reserve = drawRuled(svg, cx, fr, box, h, 36);
  // the eclipse itself is said by its contacts below
  drawMajors(svg, cx, fr, box, h, { reserveInner: Math.max(reserve, 4), skip: (e) => e.family === 'eclipse' });
  drawMargin(svg, cx, fr, box, h, marginBounds(fr, [box], 0));
  const bh = box.bodyBottom - box.bodyTop;
  const Y = (t) => box.bodyTop + ((t - h.t0) / (h.t1 - h.t0)) * bh;
  const inside = (t) => t >= h.t0 && t < h.t1;

  // the inner margin: a Flavon ruler (a tick every 13λ, longer at each Preon and at 9ι) and the eclipse phases
  const dirIn = -fr.dir;
  const X = (d) => fr.inner + dirIn * d;
  const ticks = [];
  for (let l = 0; l <= 36 * 65; l += 13) {
    const y = box.bodyTop + (l / (36 * 65)) * bh;
    const len = l % (9 * 65) === 0 ? 2.6 : l % 65 === 0 ? 1.7 : 0.8;
    ticks.push(`M${n2(X(1))} ${n2(y)}H${n2(X(1 + len))}`);
  }
  svg.path(ticks.join(''), { stroke: pal.ink3, sw: 0.12 });
  svg.line(X(1), box.bodyTop, X(1), box.bodyBottom, pal.ink3, 0.15);
  const det = x.detail ?? {};
  const c = Object.fromEntries((det.contacts ?? []).map((k) => [k.name, k.t]));
  const bands = isSolar(x) ? PHASE.solar : PHASE.lunar;
  bands.forEach(([a, b, tone], i) => {
    if (!c[a] || !c[b]) return;
    const y0 = Math.max(box.bodyTop, Y(c[a]));
    const y1 = Math.min(box.bodyBottom, Y(c[b]));
    if (y1 <= y0) return;
    const fill = tone === 'eclipse' ? pal.eclipse : tone === 'eclipseSoft' ? pal.eclipseSoft : tone === 'soft' ? pal.shade : tone === 'mid' ? pal.ink4 : pal.ink2;
    const xA = X(4.2 + i * 1.6);
    svg.rect(Math.min(xA, X(5.6 + i * 1.6)), y0, 1.4, y1 - y0, { fill });
  });

  // the contacts: a dashed rule at each moment inside the Helion, a label with a picture of the discs; those outside
  // the Helion are listed at its top or bottom with what they are
  const items = [];
  const all = [...(det.contacts ?? []).map((k) => ({ ...k, scope: 'global' })), ...(isSolar(x) && x.local?.visible ? (x.local.contacts ?? []).map((k) => ({ ...k, scope: 'local' })) : [])];
  const where = plan.sky?.place ?? 'the place';
  for (const k of all) {
    const ins = inside(k.t);
    const y = ins ? Y(k.t) : k.t < h.t0 ? box.bodyTop : box.bodyBottom;
    if (ins) svg.line(fr.x0, y, fr.x1, y, k.scope === 'local' ? pal.family('solar') : pal.eclipse, 0.22, { 'stroke-dasharray': '1.2 0.8' });
    const side = ins ? '' : k.t < h.t0 ? '↑ before this Helion · ' : '↓ after this Helion · ';
    const name = k.scope === 'local' ? `${contactName(cx, k.name)} at ${where}` : `${k.name}${k.label ? ' · ' + k.label : ''}`;
    const text = `${side}${name} · ${cx.greg ? cx.gTime(k.t) + ' · ' : ''}${cx.fClock(k.t)}`;
    items.push({ k, y, text, want: y - 3, h: 6 });
  }
  dodge(items, box.bodyTop + 0.6, box.bodyBottom - 0.6, 0.6);
  // the pictures stand clear of the line labels (a Moon beside the Sun reaches 2 radii out)
  const x0 = fr.recto ? fr.x0 + reserve + 4 : fr.x0 + 4;
  const xEnd = fr.recto ? fr.x1 - 2 : fr.x1 - reserve - 2;
  const R = 2.3;
  const tx = x0 + 2 * R + 3.2;
  for (const it of items) {
    const cyy = it.y + 3; // the picture's centre (dodged)
    const pc = x0 + R;
    if (Math.abs(cyy - it.y) > 1) svg.line(pc, it.y, pc, cyy - R - 0.2, pal.ink4, 0.12);
    discs(svg, cx, x, it.k, pc, cyy, R);
    const fill = it.k.scope === 'local' ? pal.family('solar') : pal.eclipse;
    const size = 1.7;
    const w = Math.min(measure(it.text, size, { weight: 600, font: cx.font }), xEnd - tx);
    svg.rect(tx - 0.6, cyy + 0.7 - size * 0.95, w + 1.2, size * 1.25, { fill: '#ffffff' });
    svg.text(tx, cyy + 0.7, it.text, { size, fill, weight: 600, maxW: xEnd - tx, min: 1.5 });
  }
}

/** A picture of the discs at a contact: the Sun and the Moon over the place (solar), the Moon in the shadow (lunar). */
function discs(svg, cx, x, k, X0, Y0, R) {
  const { pal } = cx;
  const id = clipId();
  if (isSolar(x)) {
    const a = x.local?.at?.(k.t);
    svg.circle(X0, Y0, R, pal.eclipseSoft, { stroke: pal.family('solar'), sw: 0.2 });
    if (!a || !(k.scope === 'local' || x.local?.visible)) {
      svg.circle(X0, Y0, R * 0.35, pal.eclipse);
      return;
    }
    const mx = X0 + a.x * R;
    const my = Y0 - a.y * R;
    svg.add(`<clipPath id="${id}"><circle cx="${n2(X0)}" cy="${n2(Y0)}" r="${n2(R)}"/></clipPath><circle cx="${n2(mx)}" cy="${n2(my)}" r="${n2(a.rMoon * R)}" fill="${pal.ink2}" clip-path="url(#${id})"/>`);
    svg.circle(mx, my, a.rMoon * R, 'none', { stroke: pal.ink3, sw: 0.12, dash: '0.4 0.4' });
    return;
  }
  const det = x.detail;
  if (!det?.at || !det.shadow) return;
  const p = det.at(k.t);
  const s = R / det.shadow.moon;
  const sx = X0 + p.x * s; // the shadow's centre, seen from the Moon's (east left: x mirrored)
  const sy = Y0 + p.y * s;
  svg.add(`<clipPath id="${id}"><circle cx="${n2(X0)}" cy="${n2(Y0)}" r="${n2(R)}"/></clipPath><g clip-path="url(#${id})"><circle cx="${n2(X0)}" cy="${n2(Y0)}" r="${n2(R)}" fill="#ffffff"/><circle cx="${n2(sx)}" cy="${n2(sy)}" r="${n2(det.shadow.penumbra * s)}" fill="${PENUMBRA}"/><circle cx="${n2(sx)}" cy="${n2(sy)}" r="${n2(det.shadow.umbra * s)}" fill="${pal.ink3}"/></g>`);
  svg.circle(X0, Y0, R, 'none', { stroke: pal.ink2, sw: 0.2 });
}
