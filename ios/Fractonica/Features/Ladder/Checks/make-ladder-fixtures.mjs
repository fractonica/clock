#!/usr/bin/env node
/**
 * Golden fixtures for the native ladder and Up next wording, generated from the web app's own modules
 * (src/ui/ladder/lib.js and src/ui/ladder/pure-text.js on src/core/model.js, pure.js and format.js).
 *
 *   node ios/Fractonica/Features/Ladder/Checks/make-ladder-fixtures.mjs     (from the repository root)
 *
 * Writes ladder-fixtures.json next to this script. LadderChecks.swift replays every record against the Swift port
 * (LadderText.swift, LadderPureText.swift, Turnovers.swift) and compares strings exactly.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../../../../fractonica.js';
import { createModel } from '../../../../../src/core/model.js';
import { createFormatter } from '../../../../../src/core/format.js';
import { createPure } from '../../../../../src/core/pure.js';
import * as lib from '../../../../../src/ui/ladder/lib.js';
import * as pt from '../../../../../src/ui/ladder/pure-text.js';

const here = dirname(fileURLToPath(import.meta.url));
const model = createModel();
const pure = createPure(model);
const zones = ['UTC', 'Europe/Kyiv', 'America/Los_Angeles'];
const fmts = Object.fromEntries(zones.map((z) => [z, createFormatter(() => z)]));
const A = 1791460800;

// a deterministic spread of instants (mulberry32)
let seed = 0x1adde4;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const instants = [
  A,
  946684800,
  2886085800,
  1e9,
  model.tMin + 1000,
  model.tMin + 0.25,
  model.tMax - 5000,
  model.tMax - 3 * 86400,
  model.tMax - 40 * 86400,
  model.tMax - 0.5,
];
for (let i = 0; i < 10; i++) instants.push(Math.round((model.tMin + rnd() * (model.tMax - model.tMin)) * 1000) / 1000);

const records = [];
for (const [i, t] of instants.entries()) {
  const zone = zones[i % zones.length];
  const fmt = fmts[zone];
  const levels = [];
  for (let L = 0; L <= 13; L++) {
    const lv = model.levelAt(t, L);
    const info = model.levelInfo(L);
    const seg = lib.segmentState(lv.phase, lv.factor);
    const span = lib.positionSpan(lv.cycleBig, info.prefix, model.extent, lv.clipped);
    const next = pt.nextCycle(model, pure, L, lv.cycleBig);
    const sec = pt.sectorName(pure, lv, seg.index, seg.frac);
    levels.push({
      level: L,
      cycle: lv.cycle,
      earth: {
        remaining: lib.remainingText(fmt, lv.remaining),
        countdown: lib.countdownText(fmt, lv.remaining),
        countdownLong: lib.countdownLong(fmt, lv.remaining),
        endFull: lib.whenFull(fmt, lv.end, { precise: lv.duration < 10 }),
        startFull: lib.whenFull(fmt, lv.start, { precise: lv.duration < 10 }),
        tag: fmt.tag(lv.end),
        duration: fmt.duration(lv.duration),
        quarters: [1, 2, 3, 4].map((k) => {
          const w = lv.thresholds[k]?.time;
          return w == null ? null : lib.whenLabel(fmt, w, lv.start, lv.duration);
        }),
        segIndex: seg.index,
        through: lib.pctTenthsText(lv.phase),
        sectorPct: Math.min(99, Math.floor(seg.frac * 100)),
        spanFrom: span.from,
        spanTo: span.to,
        lead: lib.leadText(lib.justBeforeLead(lv.duration)),
        every: fmt.duration(info.meanSeconds),
      },
      pure: {
        row: pt.rowLabel(pure, lv),
        title: pt.cycleTitle(pure, L, lv.cycleBig),
        address: pt.cycleAddress(model, pure, L, lv.cycleBig),
        next: next ? next.name : null,
        nextAddress: next ? next.address : null,
        ends: pt.endsText(next),
        left: pt.leftText(model, pure, t, lv.end),
        heroLeft: pt.heroLeft(model, pure, t, lv.end),
        started: pt.leftText(model, pure, lv.start, t),
        length: pt.lengthText(model, pure, lv),
        quarterWord: pt.quarterWord(pure, lv.phase),
        pair: pure.pairText(lv.phase),
        sector: `${sec.name}${sec.quarter ? ` ${sec.quarter}` : ''}`,
        sectorMajor: sec.major,
        where: [1, 2, 3, 4].map((k) => pt.quarterWhere(model, pure, lv.thresholds[k]?.time ?? null, L)),
        lead: pt.leadBlinks(pure, lib.justBeforeLead(lv.duration)),
      },
    });
  }
  const upnext = [];
  for (const imp of lib.IMPORTANCE) {
    for (const maxLevel of i < 3 ? [9, 13] : [9]) {
      const events = lib.buildEvents(model, t, { importance: imp, maxLevel, count: 8 });
      const days = lib.groupByDay(events.slice(1), fmt, t);
      const nuclides = pt.groupByNuclide(model, pure, events.slice(1));
      upnext.push({
        imp: imp.id,
        maxLevel,
        events: events.map((e, k) => {
          const info = pt.turnoverInfo(model, pure, e);
          const d = k > 0 ? days[k - 1] : null;
          const n = k > 0 ? nuclides[k - 1] : null;
          return {
            time: e.time,
            top: e.top,
            finer: e.finer,
            countdown: lib.countdownText(fmt, e.time - t),
            countdownLong: lib.countdownLong(fmt, e.time - t),
            full: lib.whenFull(fmt, e.time),
            sentence: lib.turnoverSentence(e.top, maxLevel),
            words: pt.turnoverWords(pure, e.top, maxLevel),
            heroLeft: pt.heroLeft(model, pure, t, e.time),
            left: pt.leftText(model, pure, t, e.time),
            before: lib.justBeforeEventTime(model, e.time, e.top),
            name: info.name,
            address: info.address,
            heading: info.heading,
            stamp: info.stamp,
            day: d ? d.day : null,
            clock: d ? d.clock : null,
            newDay: d ? d.newDay : null,
            head: n ? n.head : null,
            newNuclide: n ? n.newDay : null,
          };
        }),
      });
    }
  }
  records.push({ t, zone, levels, upnext });
}

const statics = {
  units: Array.from({ length: 14 }, (_, L) => ({
    level: L,
    clause: pt.unitClause(model, pure, L),
    sentence: pt.unitSentence(model, pure, L),
    periodBlinks: pt.periodBlinks(pure, model.levelInfo(L).meanSeconds),
    depthWords: pt.depthWords(pure, L),
    say: pt.levelSay(pure, L),
  })),
  sentences: [],
  words: [],
  countdowns: [0, 0.04, 0.96, 1.06, 3.96, 7.3, 9.96, 9.99, 10, 37.5, 59.9, 60, 125.6, 3599, 3600, 3700, 86399, 86400, 200000, 5e6, 3e7, 31557600, 1e9].map(
    (s) => ({ s, text: lib.countdownText(fmts.UTC, s), long: lib.countdownLong(fmts.UTC, s), remaining: lib.remainingText(fmts.UTC, s) }),
  ),
  leads: [2, 0.4, 0.0775, 0.011, 1.5, 0.001].map((s) => ({ s, text: lib.leadText(s), blinks: pt.leadBlinks(pure, s) })),
  labels: [],
  spans: [],
};
for (let top = 0; top <= 13; top++) {
  for (let max = top; max <= 13; max++) {
    statics.sentences.push({ top, max, text: lib.turnoverSentence(top, max) });
    statics.words.push({ top, max, text: pt.turnoverWords(pure, top, max) });
  }
}
const ref = Date.UTC(2026, 9, 18, 0, 0, 0) / 1000;
const refOther = Date.UTC(2026, 9, 9, 0, 0, 0) / 1000;
const refYear = Date.UTC(2025, 0, 1) / 1000;
for (const t of [Date.UTC(2026, 9, 18, 3, 41, 12, 250) / 1000, Date.UTC(2000, 0, 1, 0, 49, 43) / 1000, 1113199951.438, -10684827340.124, 28005212030.816]) {
  for (const r of [ref, refOther, refYear, t]) {
    for (const span of [72 * 365 * 86400, 90 * 86400, 90 * 86400 - 1, 16 * 86400, 86400, 86399, 5 * 3600, 7.77]) {
      statics.labels.push({ t, ref: r, span, text: lib.whenLabel(fmts.UTC, t, r, span) });
    }
  }
  statics.labels.push({ t, ref: t, span: -1, text: lib.whenFull(fmts.UTC, t, { precise: true }) });
  statics.labels.push({ t, ref: t, span: -2, text: lib.whenFull(fmts.UTC, t) });
  statics.labels.push({ t, ref: t, span: -3, text: lib.dayLabel(fmts.UTC, t, 2026) });
  statics.labels.push({ t, ref: t, span: -4, text: lib.clockLabel(fmts.UTC, t) });
}
for (const [cycle, prefix, clipped] of [[717211n, 125125n, false], [17n, 1n, true], [0n, 1n, false], [123456789n, 51238687500n, false]]) {
  const s = lib.positionSpan(cycle, prefix, model.extent, clipped);
  statics.spans.push({ cycle: String(cycle), prefix: String(prefix), clipped, from: s.from, to: s.to });
}

writeFileSync(join(here, 'ladder-fixtures.json'), JSON.stringify({ records, statics }));
console.log(`ladder-fixtures.json: ${records.length} instants`);
