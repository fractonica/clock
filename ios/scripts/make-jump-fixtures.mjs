#!/usr/bin/env node
/**
 * Golden fixture for the jump grammars of FractonicaKit (Sources/FractonicaKit/Jump), generated from the web app's own
 * parsers: src/ui/calendar/parse.js (`parseJump`, the Earth jump box) and src/ui/calendar/pure-parse.js (`parsePure`,
 * the pure-mode box).
 *
 *   node ios/scripts/make-jump-fixtures.mjs        (from the repository root)
 *
 * Every input runs through the real JavaScript at several reference moments (the displayed time the box hangs relative
 * input off: SPEC vector A, 2000-01-01, 2061, both catalogue edges and a moment outside the catalogue), several time
 * zones, both slash-date orders and with and without a selected level. The Swift tests (JumpFixtureTests) replay every
 * case and compare the candidate list: the kind and the resolved Unix time of each candidate (±1 ms), the live flag,
 * and the label and detail text.
 *
 * Inputs: every documented example (design doc §1, the placeholders and example lists), the inputs of the web app's
 * own tests (test/calendar.test.js), variations of each form (case, spacing, Unicode dashes and spaces, ranges and
 * edges) and invalid ones, plus a seeded random sample of generated addresses, offsets, positions, syncs and dates
 * (mulberry32), so the file only changes when the JavaScript changes.
 *
 * City names follow each runtime's own zone list (Intl.supportedValuesOf in Node, TimeZone.knownTimeZoneIdentifiers
 * on Apple platforms). They differ for a few renamed zones (Node's ICU says Asia/Katmandu where Apple says
 * Asia/Kathmandu, so "Kathmandu" only reads natively), so the inputs only use cities both lists name the same way.
 *
 * Records are compact: a case is [parser, input index, ref index, zone index, options index, candidates], a candidate
 * [kind, time, label, detail, live]; the inputs, reference moments, zones and options are listed once.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';
import { createPure, LEVEL_NAMES, ORDINAL_NAMES, QUARTER_WORDS, UNITS } from '../../src/core/pure.js';
import { createFormatter } from '../../src/core/format.js';
import { parseJump, MAX_INPUT } from '../../src/ui/calendar/parse.js';
import { parsePure, pureExamples, PURE_PLACEHOLDER } from '../../src/ui/calendar/pure-parse.js';
import { examples as earthExamples, PLACEHOLDER } from '../../src/ui/jump.js';
import { syncRange } from '../../src/ui/calendar/convert.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../FractonicaKit/Tests/FractonicaKitTests/Fixtures');

const model = createModel();
const pure = createPure(model);
const { tMin, tMax } = model;
const A = 1791460800; // SPEC vector A, 2026-10-08T12:00:00Z

// ---- deterministic randomness ---------------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x1a3b5);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)); // inclusive
const pick = (xs) => xs[int(0, xs.length - 1)];

// ---- reference moments, zones, options --------------------------------------------------------------------------
const REFS = [
  A,
  946684800, // 2000-01-01
  2886085800, // 2061-06-17
  A + 3600 * 7.25 + 0.123, // a moment with milliseconds
  tMin + 3600, // an hour into the catalogue
  tMax - 3600, // an hour before it ends
  tMax + 86400 * 40, // outside the catalogue
  1475000000.5, // 2016-09-27, inside another eclipse interval
];
const ZONES = ['UTC', 'America/New_York', 'Europe/Kyiv', 'Asia/Kathmandu', 'Australia/Lord_Howe'];
/** [dayFirst (true / false / null = unknown), level (null = none selected)] */
const OPTIONS = [
  [null, 6],
  [true, 6],
  [false, 6],
  [null, null],
  [false, 4],
];

// ---- inputs -----------------------------------------------------------------------------------------------------
const earthInputs = new Set();
const pureInputs = new Set();
const addE = (...xs) => xs.forEach((x) => earthInputs.add(x));
const addP = (...xs) => xs.forEach((x) => pureInputs.add(x));

// documented examples and placeholders
for (const [t] of earthExamples(true)) addE(t);
for (const [t] of earthExamples(false)) addE(t);
for (const x of PLACEHOLDER.replace(/^Jump to…\s+/, '').split(' · ')) addE(x);
for (const [t] of pureExamples()) addP(t);
for (const x of PURE_PLACEHOLDER.replace(/^Jump to…\s+/, '').split(' · ')) addP(x);

// the web app's own tests (test/calendar.test.js), Earth box
const count7 = model.clock.count(6);
const sr = syncRange(model);
addE(
  '2031-06-01', '2031-06-01 14:30', '2031-06-01 14:30:15.250', '2031-06-01T14:30', '1 Jun 2031 2pm', 'June 1, 2031 14:30',
  '1st of June 2031', '2031/06/01', '1.6.2031', '2031', 'Jun 2031', '20310601', '2031-06-01T14:30Z', '2031-06-01T14:30:00+05:30',
  '2031-06-01 14:30 UTC-5', '2031-06-01 14:30 +0300', 'Thu 8 Oct 2026, 12:00:00', 'Fri 9 Oct 2026, 14:23:07', '12/31/2031', '14:30',
  'noon', '9am', '2031-02-30', '2031-13-01', '2031-06-01 25:00', '2031-06-01 12:61', '1500-01-01', '3000-01-01', 'xyz', '1791460800',
  'unix 1791460800', '1791460800000', '@1791460800.5', '-11253795486', '99999999999999999', 'now', 'today', 'tomorrow',
  'yesterday 18:00', 'tomorrow 9:30', '+3d', '-2h30m', 'in 2 weeks', '3 days ago', '+90min', '+1y', '+1mo', '+500ms', '+3', '+1d',
  '+24h', 'pos 22.927850216635', 'p22.927850216635', '22.927850216635', '22 + 0.927850216635', 'saros 0', 'pos 69', 'pos 70',
  'pos 69.5', 'α6 β4 γ9 δ3 ε5', 'ε5', 'δ3 ε5', 'ε1', 'α6 β4 γ9 δ3 ε5 peak', 'a6 b4 g9 d3 e5 node', 'a6 b4 g9 d3 e5 valley',
  'a6 b4 g9 d3 e5 end', 'α6 β6', 'α6 β4 γ14', 'α6 β4 γ9 δ3 ε6', 'α19', 'α0', 'α6 γ3', 'γ3 β2', 'α18 β3', 'α18 β2', 'η#717211',
  'd7#99999999', 'd15#1', 'sync 4820', 'S4820', 'sync 4820 node', 'sync 99999999', 'next ε', 'next end of ε', 'prev ε', 'next peak η',
  'next 3 ε', 'd7 16,0', `sync ${sr.last}`, `sync ${sr.first}`, `sync ${sr.last + 1}`, `sync ${sr.first - 1}`, 'Sept 5 2031',
  '5 sept 2031 18:45', 'NEXT Ε', 'last ζ', 'Α6 Β4 Γ9', 'α6 › β4 › γ9', 'a6 b4 g9', '-1mo', 'IN 2 WEEKS', '  +3 d  ',
  '2031-06-01   14:30', '2031-06-01 2:30 pm', '2031-06-01 12am', '2031-06-01 12pm', '2031-06-01 13pm', '2026-03-29 02:30',
  '2026-10-25 02:30', '2026-06-01 02:30', '2026-03-29 02:30 UTC', '0050-06-01', '0000-02-29', '1000-06-01', '1613-05-18', '1613-01',
  '2857-06-13 10:00', '1613-05-19 10:00', '2857-06-13 09:00', '2857-06-13', '2031-06-01 14:30 +14:00', '2031-06-01 14:30 +15:00',
  '2031-06-01T14:30:00+00:53:28', '−3d', '−2h30m', `d7#${count7 - 1n}`, `d7#${count7}`, 'after ε', 'before ε', 'α#6 β#4 γ#9 δ#3 ε#5',
  'ζ#6', 'ζ#4', 'ε 5', 'δ 3 ε 5', 'α 6 › β 4 › γ 9', 'α 6', 'ε#6', 'ε#0', 'α#19', 'd7#', 'next ζ', 'prev ζ', 'next α', 'next peak',
  'next peak ε', '1 Jun 2031', '2031-06-01 14:30 Moscow', '2031-06-01 14:30 Europe/Moscow', '2031-06-01 14:30 europe/moscow',
  '2031-06-01 14:30 Tokyo', '2031-06-01 14:30 New York', '2031-06-01 14:30 America/New_York', '1 Jun 2031 2pm Kyiv', '14:30 Tokyo',
  '2031-06-01 Tokyo', '2031-06-01 14:30 +03:00', '2027-03-14 02:30 New York', '2031-06-01 14:30 Atlantis', '2031-06-01 25:00 Moscow',
  '+100000000d', '9999999999999999999999 days ago', '+1000000d', 'sync ', 'sync 99999999999999999', '03/04/2031', '31/12/2031', 'ε',
  'd7 13,0', 'η [13,0]', 'prev d7 13,0', '', '   ', 'ζ 6', 'ε 6', 'ζ6', 'α 1', 'ξ 14', '06/01/2031 14:30', '06/06/2031', '06-01-2031',
  'x', '2027-03-14 02:30', '2026-11-01 01:30',
);

// variations of every Earth form
addE(
  // dates and times
  '2031-06-01 14:30 London', '2031-06-01 14:30 America/Los_Angeles', '2031-06-01 14:30 los angeles',
  '2031-06-01 14:30 Paris', '14:30 Sydney', '2031-06-01 14:30 Asia/Kolkata', '2031-06-01 14:30 Kolkata', '2031-06-01 14:30 Kyiv',
  '2031-06-01 14:30 Sao Paulo', '2031-06-01 14:30 Ho Chi Minh', '2031-06-01 14:30 UTC+05:45', '2031-06-01 14:30 GMT',
  '2031-06-01 14:30 z', '9:15pm', '12:00:00.5', '23:59:59.999', '2026-10-08T12:00:00.000Z', '2026-10-08T12:00:00+03:00',
  '2026-10-08t12:00z', 'oct 8', '8 oct', 'October 2026', '2026 october', '2026 oct 8', 'march', 'Thursday 8 October 2026 at noon',
  'midnight', 'tomorrow noon', 'today 25:00', 'tomorrow 2031', 'yesterday', 'tmrw 7am', 'today 14:30:15', 'tomorrow at 9pm',
  'today 2031-06-01', '2031-06-01T14:30:00.999Z', '2031-06-01 14:30:60', '2031-02-29', '2032-02-29', '1700-02-29', '2000-02-29',
  '29/02/2031', '13/13/2031', '00/01/2031', '2031-00-10', '2031-06-00', '1613-05-19', '1613-05-19 17:00', '1613', 'May 1613', '2857',
  '2857-06-14', '2858', '999', '1999', '31 Dec 1999 23:59:59', 'Jan 1 2000 00:00', '2026-03-08 02:30', '2026-03-29 03:30',
  '2026-10-25 01:30', '2026-10-04 02:15', '2026-04-05 01:45', '２０３１－０６－０１', '2031‒06‒01', '2031–06–01 14:30',
  '2031-06-01 14:30', '1/6/2031', '1-6-2031', '12-31-2031', '31.12.2031', '1.13.2031', '13.1.2031', '06/01/2031 2pm Tokyo',
  '2031 06 01', '2031/6', '2031.06', '6 2031', 'jun', 'june 31 2031', 'feb 29 2028', 'Sun 1 Jun 2031', 'mon 2 june 2031 noon',
  '2031-06-01 14:30 utc+3', '2031-06-01 14:30 gmt-0330', '2031-06-01 14:30 -03', '2031-06-01 14:30 +3:00', '2031-06-01 14:30 +99',
  '2031-06-01 0:00', '2031-06-01 0am', '2031-06-01 12:00am', '2031-06-01 12:30 pm', '14h', '2pm tomorrow', '3rd of march 2030',
  '22nd Feb 2030', 'the 1st of June 2031', 'on June 1st 2031 at 2pm', '20310631', '20311301', '2031060', '203106011',
  // unix
  'unix 0', '0', '12345', '1234', 'ts=1791460800', 'epoch 1791460800 s', '1791460800 ms', '1791460800123', '-1791460800',
  '@-11253795486', '@0', 'timestamp: 2000000000', 'unixtime 1e9', '1791460800.25', '17914608000000', '179146080000000',
  '8640000000000', '8640000000001', '-8640000000001',
  // offsets
  '+1w', '+2wk', '-90s', '+1.5d', '+1.5y', '+18mo', 'in 3 hours and 20 minutes', '3 days, 4 hours ago', '2 weeks later',
  '5 min from now', '+3x', '+0d', '-0.5h', 'in 1 year', '10 years ago', '500 years ago', '+999y', '1000 years later', '+12mo',
  '-13mo', '+1y 2mo 3d 4h 5min 6s 7ms', 'in 2 days hence', '3 hours before', '1 day after', '2 days ahead', '+ 3d', '- 3d',
  '+3 days', '+3days', '+3 dayz', '+-3d', 'in -3d', '+99999', '+123456', '-5', 'in 5', '1e3 days ago', '+0.5w', '+1.25h',
  '+7.5min', '+60s', '+1000ms', '+2.5mo', '-1y', '+100y', '+250y', '-450y', '-1000y',
  // positions
  'p0', 'p69', 'pos 24,5', 'saros:24.5', '24.5', '24.5000', '24 + .5', 'pos 1.2.3', 'position = 3.25', 'pos', 'pos -1',
  'saros 68.9999', 'p 12.', '0.5000', '69.0000', '70.0000', '24 + 0.5', '24+.25',
  // addresses
  'α#1', 'α#18', 'α#18 β#5', 'α#18 β#5 γ#13', 'α#18 β#2 γ#13', 'a1 b1 g1 d1 e1', 'α#6 β#4 γ#9 δ#3 ε#5 ζ#7',
  'α#6 β#4 γ#9 δ#3 ε#5 ζ#7 η#11', 'α#6 β#4 γ#9 δ#3 ε#5 ζ#7 η#11 θ#9 ι#4', 'ε#5 peak', 'ε#5 @ node', 'ζ#7 end', '6.4.9.3.5',
  '6.4', '6 › 4 › 9', 'γ#9', 'η#5', 'ι#2', 'ξ#3', 'ν#1', 'alpha 6 beta 4', 'alpha#6 beta#4 gamma#9', 'epsilon 5', 'zeta#3', 'th#2',
  'a6.b4.g9', 'a6 » b4 » g9', 'a6 > b4 > g9', 'a6|b4|g9', 'α6 β4 γ9 δ3 ε5 start', 'α6 β4 γ9 δ3 ε5 begin', 'α6 β4 γ9 δ3 ε5 mid',
  'α6 β4 γ9 δ3 ε5 middle', 'α6 β4 γ9 δ3 ε5 noon', 'ε#5 β#2', 'α#6 β#4 γ#9 ε#5', 'ω#1', 'q5', 'ε 1', 'δ 4', 'η 7', 'ν 13',
  'α 2', 'ε 5 peak',
  // global indices
  'd7#0', 'd7#717211 peak', 'd1#17', 'd1#18', 'd14#5', 'depth 7 #5', 'd0#1', 'd7 # 12', 'd13#1 valley', 'd5#99999', 'd4#5606',
  'd4#5607 end', `d14#${model.clock.count(13) - 1n}`, `d14#${model.clock.count(13) - 1n} end`,
  // syncs
  'sync -1', 'sync 0', 'S0', 'solar sync 4820 peak', 'solar 4820 valley', 's4820 end', 'sync #12', 'solarsync 100', 'sync 4820 mid',
  `sync ${sr.last} end`, `sync ${sr.first} begin`,
  // boundaries
  'next δ', 'next β', 'next 5 ζ', 'prev 2 η', 'previous peak ζ', 'next valley of γ', 'next node η', 'next end of α', 'last ε',
  'next d7', 'prev depth 9', 'next d15', 'next 500 η', 'next 0 ε', 'prev node', 'next 2 peak', 'before valley', 'after peak',
  'next start of ζ', 'next begin of η', 'prev mid ε', 'next ν', 'next ξ', 'next epsilon', 'next zeta peak', 'next q', 'next 600 ν',
  'prev 3 β', 'next 3 α', 'NEXT PEAK Η',
  // lone levels
  'α', 'beta', 'ν', 'xi', 'epsilon', 'Δ', 'ο',
  // odometer states
  'd7 [13, 0]', 'ε [0,0]', 'η (15,15)', 'next η [3,4]', 'prev ε 1,2', 'd7 13 0', 'η 13', 'η 13,', 'ζ [16,0]', 'd20 1,2',
  'κ 1,2,3', 'd1 [3]', 'α [3, 1]', 'ξ [1,2]', 'next d9 1,1,1', 'd7 1;2', 'd0 1,2',
  // anything else
  'now please', 'Now', 'NOW', 'live', 'hello', '!!!', '?', '#', 'ε#', '#5', 'next', 'prev', 'in', 'ago', 'Delta Trifracton Node',
  '+2ε 5η', '34η 29ι', 'Gamma Difracton', 'pos 24.5 please', 'α#6 β#4 γ#9 peak valley',
  // long input
  '2031-06-01' + ' '.repeat(MAX_INPUT - 10 + 50), 'x'.repeat(MAX_INPUT + 1), '1'.repeat(250), 'α#6 '.repeat(60).trim(),
);

// pure box: the web app's tests
addP(
  'Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End, ε#5 34η 29ι 21λ 3ν',
  'Delta Trifracton End ε#5 34η 29ι', 'δ#3 ε#5 34η 29ι', 'α#6 β#4 γ#9 δ#3 ε#5 34η 29ι', 'Alpha Hexafracton, Beta Tetrafracton, Gamma Nonafracton',
  'Delta Trifracton Node', 'Delta Trifracton Node ε#2', 'Delta Trifracton Peak ε#2', 'δ#3 ε#2', 'Delta Trifracton Node ε#2 5η',
  'Delta Trifracton Valley ε#2', 'Gamma Nonafracton Peak, Delta Trifracton', 'Gamma Nonafracton Node, Delta Trifracton', 'ε#2 node',
  'δ#3 node', 'a6 b4 g9 d3 node', 'a6 b4 g9 node', 'Alpha Hexafracton Beta Tetrafracton Gamma Nonafracton Node', 'α#6 β#4 γ#9',
  'Gamma Difracton', 'γ#2', 'Gamma Difracton in Beta Tetrafracton', 'Delta Trifracton', 'δ#3', 'Alpha Hexafracton Beta Tetrafracton Gamma Nonafracton',
  'a6 b4 g9', '6.4.9', 'ε#2 5η', 'ε#2', 'ε#2 1η', 'ε#2 0η', '+0η', 'δ 3 · ε 2 · η 5', 'δ#3 ε#2 5η', 'ε#2 η#4', 'ε#2 4η', 'ε#2 4η ι#3',
  'ε#2 4η 2ι', 'η#0', '34η29ι21λ3ν', '34η 29ι 21λ 3ν', '+2ε 5η', '2ε 5η', 'in 2ε 5η', '-3ι', '3ι ago', '+3', '+999α', 'pos 22.9278',
  'pos 99', 'sync 4820 node', 'sync 99999999', 'now', 'd7#717211', '+2 Nuclides 5 Helions', '+4 Blinks', '+4ν', '+1 Gamma', '+1γ',
  '+0.14ν', '+2.6ν', '+12ν', 'next Delta', 'next Delta node', 'next node of Delta', 'next Helion', 'next ε', 'next 3 Nuclides', 'next ζ',
  'Helion [13,0]', 'η [13,0]', 'δ [3,0]', '+2ζ', 'ζ#5', 'θ#3', 'Epsilon Trifracton', 'next Atom', '+2 Hadrons', 'hello world', '50%',
  '33η 17ι', '0η 29ι', '3η', 'ζ 6', 'δ 4', 'Helion', 'x', '', '   ',
  'Difracton', 'Omega Monofracton', 'ε#5', 'ε#6', 'δ#6', 'a6 b3 g11', '6.3.11', 'α#19', 'β#6', 'γ#14', 'η 3', 'ι 17', '78η', '3γ',
  'α#6 β#4 3γ', 'ν#3', '33η 4ν', 'in 5λ', '3η ago', '+2δ', '+9999α', '3 Preons ago', 'in 5 Flavons', 'δ½ 3', 'ζ½', 'next ζ½', '5ζ',
  '+2θ', '+2ξ', '3 Quarks', 'Somons', 'Chromon', 'Eta Difracton', '3 beats', 'pos 22.9', 'S4820 node', 'sync 4820', 'prev η',
  'next peak η', 'next 3 ε', 'next peak', 'ι', 'θ', 'ξ', 'Delta', 'Blink', 'η 13·4', 'η [16,0]', 'd4#99999999999', 'd20 1,2',
  '2031-06-01', '+3d', 'Moscow', 'tomorrow', '1791460800', 'xyz', 'Monofracton', 'Octafracton', 'Octadecafracton', 'Decafracton',
  'Dodecafracton', 'Tetrafracton', 'Gamma Octafracton', 'Sunfracton', 'Monday', 'mon', 'oct 5', 'October', 'dec', 'Sat 3 Oct', 'sun',
  '14:30', 'x'.repeat(5000), 'Gamma Difracton' + ' '.repeat(400), 'δ1⁄2 3', 'ε#2 33η', '−1ι',
);
for (const [i, name] of LEVEL_NAMES.slice(0, 4).entries()) {
  for (const q of QUARTER_WORDS) addP(`${name} ${ORDINAL_NAMES[i === 0 ? 6 : 3]} ${q}`);
}
for (const q of QUARTER_WORDS) addP(`Delta Trifracton ${q}`, `Delta Trifracton ${q} ε#3`, `Delta Trifracton ${q} ε#5 34η`);
for (const u of UNITS) {
  addP(`+3 ${u.name}s`, `+3${u.sym}`, `+1 ${u.name.toLowerCase()}`, `+1${u.sym}`, `2 ${u.name}s ago`, `-2${u.sym}`, `next ${u.name}`, `next ${u.sym}`, u.name, `${u.name}s`);
}
// variations of every pure form
addP(
  'Alpha Hexafracton', 'Alpha Hexafracton Valley', 'Beta Tetrafracton', 'Gamma Nonafracton Valley', 'Delta Trifracton End ε#5',
  'delta trifracton end ε#5 34η', 'Delta Trifracton End ε#5 34η 29ι 21λ', 'Delta Trifracton End ε#5 34η 29ι 21λ 3ν', 'δ#3 ε#5 34η 29ι 21λ 3ν',
  'α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν', 'Delta Pentafracton', 'Delta Hexafracton', 'Gamma Tridecafracton', 'Gamma Tetradecafracton',
  'Beta Hexafracton', 'Alpha Octadecafracton', 'Alpha Nonadecafracton', 'Alpha Monofracton Peak', 'Alpha Octadecafracton End',
  'Alpha Octadecafracton, Beta Pentafracton', 'Alpha Octadecafracton, Beta Difracton, Gamma Tridecafracton', 'Gamma Difracton Node in Beta Tetrafracton',
  'Gamma-Difracton', 'Gamma Difracton of Alpha Hexafracton', 'Delta Trifracton Start', 'Delta Trifracton Begin ε#2', 'ε#1', '77η', '1η',
  '1η 0ι', '1η 35ι', '1η 36ι', '5η 17ι 64λ 24ν', '5η 17ι 65λ', '5η 17ι 64λ 25ν', 'η#77', 'η#78', 'ι#36', 'ι#1', 'λ#1', 'ν#25', 'ε#2 η#77 ι#36',
  '+1α', '+1β', '+1δ', '+1ε', '+1η', '+1ι', '+1λ', '+1ν', '+0.5ν', '+0.5η', '+1.5ε', '-1ι', '-2ε 5η', 'in 1 Delta', '+2 Deltas',
  '+3 Helions 4 Preons', '+1 flavon', '+10 Blinks', '+1η 1η 1η 1η 1η 1η 1η 1η 1η 1η', '+1η 1η 1η', '+1θ', '+1κ', '+1μ', '+1ο',
  'ζ#1', 'ζ#7', 'ζ#0', 'θ#4', 'κ#13', 'μ#5', 'ξ#2', 'next Nuclide', 'prev Helion', 'next Preon', 'next Flavon', 'next Blink', 'next Alpha',
  'next Beta', 'next Gamma', 'next Gamma peak', 'next valley of Beta', 'next peak δ', 'next θ', 'next 2 Deltas', 'Nuclide', 'Helions',
  'δ', 'ζ', 'η 7', 'ε 5', 'α 1', 'ν 13', 'β 2', 'γ 3', 'ε 2·3', 'd7 13,0', 'prev η [0,0]', 'ν [1,2]', 'Blink [3,4]', 'α [1,2]',
  'Delta [1,2]', 'Nuclide 1·2', 'next Helion [5,5]', 'p 0', 'pos 69', 'pos 70', 'pos 24,5', '24 + 0.5', '24.5000', 'sync 0', 'sync -5',
  'S4820 peak', 'solar 4820 valley', 'd7#0', 'd5#5', 'd5#99999999', 'd4#3 node', 'd15#1', 'd13#100 valley', 'live', 'Now', 'LIVE',
  'a6 b4 g9 d3 e5', 'a6 b4 g9 d3 e5 h3', 'a6 b4 g9 begin', 'a6 b4 g9 mid', 'a6 b4 d3', 'a6 b4 g9 d3 e5 peak', '6.4.9.3.5', '6.4.9.3.5.2',
  '18.5.13', '19.1', '6.0.9', 'delta half 3', 'ζ½ 5', 'δ-half', '+4 beats', 'beat', 'hadron', '+2 quarks', 'atoms', 'chromon', 'somon',
  'Zeta Difracton', 'epsilon-monofracton', 'Theta Trifracton', 'Lambda Hexafracton', 'in 2 weeks', 'jan 5', 'monday', '10 percent',
  '?', 'Delta Trifracton Banana', 'Delta Trifracton Node Peak', 'Delta Trifracton End ε#2', 'Delta Trifracton Node ε#3',
  'Gamma Nonafracton End, Delta Trifracton', 'Alpha Hexafracton Peak, Beta Tetrafracton', 'Beta Tetrafracton Valley, Gamma Nonafracton',
  'Delta Trifracton Peak ε#2 20η', 'Delta Trifracton Node ε#2 20η', 'Delta Trifracton Node ε#2 21η', 'Delta Trifracton Peak ε#2 21η',
  'δ#3 peak', '34 η 29 ι', '+ 2 ε 5 η', '+2ε, 5η', '+2ε and 5η', '+2ε5η', 'prev node', 'next η', 'next 2 ε', 'last ε', 'before η',
  'after ζ', 'next d7', 'next depth 5 node', 'next end of Delta', 'next Delta valley', 'next 500 ν', 'NEXT HELION', 'next helions',
  'next zeta', 'next nu', '5λ later', '2η after', '1ε ahead', '+1 Nuclides', '+1.5 Helions', '3 Blinks ago', 'in 7 blinks',
  '+2ε 5η 3ι 2λ 1ν', '+77η', '-77η', '+5ε', '+1.25δ', '+0.001ν', '+1e3η', 'η', 'Η', 'ΝΕΧΤ η', 'α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν 7ξ',
  'α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν peak', 'ε#5 34η Node', 'Alpha Hexafracton Node, ε#2', 'Beta Tetrafracton, ε#2',
  'Alpha Hexafracton, Beta Tetrafracton, Gamma Nonafracton, Delta Trifracton, ε#5, 34η, 29ι', 'α#18 β#2 γ#13 δ#5 ε#5',
  'α#18 β#2 γ#10', 'α#18 β#3', 'α#1 β#1 γ#1 δ#1 ε#1 1η 0ι 0λ 0ν', 'Alpha Monofracton', 'Alpha Monofracton Peak, Beta Monofracton',
);

// a seeded sample of generated inputs, both boxes
const LETTERS = 'αβγδεζηθικλμνξ';
for (let i = 0; i < 40; i++) {
  const depth = int(1, 6);
  const path = [int(1, 18), int(1, 5), int(1, 13), int(1, 5), int(1, 5), int(1, 7)].slice(0, depth);
  const text = path.map((n, k) => `${LETTERS[k]}#${n}`).join(' ');
  addE(text);
  addP(text);
}
for (let i = 0; i < 25; i++) {
  addE(`${pick(['+', '-', 'in '])}${int(1, 400)}${pick(['d', 'h', 'min', 'w', 'mo', 'y', 's'])}`);
  addE(`pos ${int(0, 69)}.${int(0, 99999)}`);
  addE(`sync ${int(sr.first - 3, sr.last + 3)}${pick(['', ' peak', ' node', ' valley', ' end'])}`);
  addE(`${int(1600, 2900)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 31)).padStart(2, '0')} ${int(0, 23)}:${String(int(0, 59)).padStart(2, '0')}`);
  addE(`${pick(['next', 'prev'])} ${pick(['', '2 ', '5 '])}${pick(['', 'peak ', 'node ', 'valley ', 'end of '])}${LETTERS[int(0, 13)]}`);
  addE(`d${int(1, 14)} ${int(0, 15)},${int(0, 15)}`);
  addP(`${pick(['+', '-', 'in '])}${int(1, 9)}${pick(['α', 'β', 'γ', 'δ', 'ε', 'η', 'ι', 'λ', 'ν'])} ${int(0, 30)}${pick(['η', 'ι', 'λ', 'ν'])}`);
  addP(`Delta ${ORDINAL_NAMES[int(1, 5)]} ${pick(QUARTER_WORDS)} ε#${int(1, 5)} ${int(1, 77)}η ${int(0, 35)}ι`);
  addP(`${int(1, 77)}η ${int(0, 35)}ι ${int(0, 64)}λ`);
  addP(`ε#${int(1, 5)} ${int(1, 77)}η`);
  addP(`${pick(['next', 'prev'])} ${pick(['', '2 '])}${pick(['', 'peak ', 'node ', 'valley '])}${pick(['Delta', 'Nuclide', 'Helion', 'Preon', 'Flavon', 'Blink', 'ζ', 'θ', 'Gamma'])}`);
  addP(`${pick(['η', 'ε', 'ι', 'λ', 'ζ', 'd7'])} [${int(0, 15)},${int(0, 15)}]`);
  addP(`pos ${int(0, 69)}.${int(0, 99999)}`);
  addP(`d${int(1, 14)}#${int(0, 400000)}${pick(['', ' peak', ' node'])}`);
}

// ---- cases ------------------------------------------------------------------------------------------------------
const formatters = new Map(ZONES.map((z) => [z, createFormatter(() => z)]));
const r = (x) => (x === null || x === undefined ? null : x);
const candidate = (c) => [c.kind, r(c.time), c.label, c.detail ?? '', c.live ? 1 : 0];

const E = [...earthInputs];
const P = [...pureInputs];
const cases = [];
/** Which (ref, zone, options) combinations each Earth input runs at: every ref in UTC, a spread in the other zones. */
function earthCombos(i) {
  const combos = REFS.map((_, ref) => [ref, 0, 0]);
  combos.push([0, 1 + (i % 4), i % OPTIONS.length]);
  combos.push([3, 1 + ((i + 1) % 4), (i + 1) % OPTIONS.length]);
  combos.push([1, 1 + ((i + 2) % 4), (i + 3) % OPTIONS.length]);
  combos.push([0, 0, 1 + (i % (OPTIONS.length - 1))]);
  return combos;
}
E.forEach((text, i) => {
  for (const [ref, zi, oi] of earthCombos(i)) {
    const now = REFS[ref];
    const [dayFirst, level] = OPTIONS[oi];
    const zone = ZONES[zi];
    const out = parseJump(text, { model, now, real: now + 86400 * 3, zone, fmt: formatters.get(zone), dayFirst: dayFirst ?? undefined, level: level ?? undefined });
    cases.push(['e', i, ref, zi, oi, out.map(candidate)]);
  }
});
P.forEach((text, i) => {
  const combos = REFS.map((_, ref) => [ref, 0]);
  combos.push([0, 3], [3, 4], [1, 3]);
  for (const [ref, oi] of combos) {
    const now = REFS[ref];
    const level = OPTIONS[oi][1];
    const out = parsePure(text, { model, pure, now, real: now + 5, level: level ?? undefined });
    cases.push(['p', i, ref, 0, oi, out.map(candidate)]);
  }
});
// every input of each box through the other one too, at vector A (the pure box must turn Earth input away)
E.forEach((text, i) => cases.push(['E>p', i, 0, 0, 0, parsePure(text, { model, pure, now: A, real: A + 5, level: 6 }).map(candidate)]));
P.forEach((text, i) => {
  const out = parseJump(text, { model, now: A, real: A + 86400 * 3, zone: 'UTC', fmt: formatters.get('UTC'), level: 6 });
  cases.push(['P>e', i, 0, 0, 0, out.map(candidate)]);
});

const fixture = {
  about: 'parseJump (src/ui/calendar/parse.js) and parsePure (src/ui/calendar/pure-parse.js) over the inputs below; see ios/scripts/make-jump-fixtures.mjs',
  realOffset: { earth: 86400 * 3, pure: 5 },
  refs: REFS,
  zones: ZONES,
  options: OPTIONS,
  earthInputs: E,
  pureInputs: P,
  cases,
};
mkdirSync(OUT, { recursive: true });
const json = JSON.stringify(fixture);
writeFileSync(join(OUT, 'jump.json'), json + '\n');
const kinds = {};
for (const c of cases) for (const x of c[5]) kinds[x[0]] = (kinds[x[0]] ?? 0) + 1;
console.log(`jump.json  ${(json.length / 1024).toFixed(0)} KB · ${E.length} Earth inputs, ${P.length} pure inputs, ${cases.length} cases`);
console.log(Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(' · '));
