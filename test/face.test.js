import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import { createPure } from '../src/core/pure.js';
import { judge } from '../tools/pure-scan.mjs';
import { createGlyphBook } from '../src/ui/face/glyphs.js';
import {
  SCREEN,
  UNIT,
  INK,
  ROWS,
  ROW_BOX,
  MINUS,
  PERIOD_DY,
  PERIOD_DX,
  SOLAR_DX,
  LABEL_DY,
  REGION_HALF,
  COUNTER_RADIUS,
  COUNTER_STEP_DEG,
  plateBox,
  intText,
  percentText,
  middleTap,
  infoSpeech,
  clampDepth,
  stepDepth,
  levelsFor,
  glyphOrigins,
  counterPositions,
  insideScreen,
  hitTest,
  clientToLogical,
  signed,
  stateInfo,
  describeState,
  overlayMode,
  middleTapAction,
  thresholdCaption,
  periodTooltip,
  solarTooltip,
  regionHint,
  rowAriaLabel,
  layoutFit,
  BEZEL,
  thresholdCaption as capOf,
} from '../src/ui/face/helpers.js';
import {
  inText,
  agoText,
  pairSpeech,
  pureInfoLabels,
  pureInfoSpeech,
  purePeriodTooltip,
  pureSolarTooltip,
  pureTooltipModel,
  pureRowAriaLabel,
  pureCaption,
  letterName,
  pureRange,
  PURE_SOLAR_NA,
  pureHowToLines,
  placeText,
  followerName,
  cycleAside,
  FROM_ONE,
  GLOSSARY_NOTE,
  CAPTION_NOTE,
  DRIFT_REF,
} from '../src/ui/face/pure.js';

const model = createModel();
const fmt = createFormatter(() => 'UTC');
const book = createGlyphBook(model.F);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);
const T_A = 1791460800; // SPEC §12 vector A

// ---- depth & levels -------------------------------------------------------------
test('top depth is clamped to 2..11 and stepping respects the ends (SPEC §10)', () => {
  assert.equal(clampDepth(7), 7);
  assert.equal(clampDepth(1), 2);
  assert.equal(clampDepth(0), 2);
  assert.equal(clampDepth(14), 11);
  assert.equal(clampDepth('9'), 9);
  assert.equal(clampDepth(NaN), 7);
  // not-a-number values fall back to the default instead of being read as 0 and clamped to 2
  for (const bad of [null, undefined, '', '  ', true, false, [], {}, 'abc', Infinity]) assert.equal(clampDepth(bad), 7, String(bad));
  assert.equal(clampDepth('9.4'), 9);
  assert.equal(clampDepth(7.5), 8);
  assert.equal(clampDepth(-3), 2);
  assert.equal(clampDepth(' 5 '), 5);
  assert.equal(stepDepth(7, -1), 6);
  assert.equal(stepDepth(7, 1), 8);
  assert.equal(stepDepth(2, -1), 2);
  assert.equal(stepDepth(11, 1), 11);
});

test('depth D shows level D-1 on top and level D below', () => {
  assert.deepEqual(levelsFor(7), { top: 6, bottom: 7 });
  assert.deepEqual(levelsFor(2), { top: 1, bottom: 2 });
  assert.deepEqual(levelsFor(11), { top: 10, bottom: 11 });
  assert.deepEqual(levelsFor(99), { top: 10, bottom: 11 });
});

// ---- geometry (SPEC §8, §9.2) ----------------------------------------------------
test('spec constants: 192 x 490 pill, u = 10 px, 3 px ink, rows at +-165 px, labels at +-90 px, counters on an 86 px arc', () => {
  assert.deepEqual({ ...SCREEN }, { w: 192, h: 490, r: 96, cx: 96, cy: 245 });
  assert.equal(UNIT, 10);
  assert.equal(Math.round(INK * UNIT * 1e6) / 1e6, 3, '3 px of ink');
  assert.equal(PERIOD_DY, 165);
  assert.equal(PERIOD_DX, 80);
  assert.equal(SOLAR_DX, 64);
  assert.equal(LABEL_DY, 90);
  assert.equal(REGION_HALF, 100);
  assert.equal(COUNTER_RADIUS, 86);
  assert.equal(COUNTER_STEP_DEG, 11.5);
  assert.deepEqual({ ...ROW_BOX.top }, { x: 22, y: 34, w: 148, h: 92 });
  assert.deepEqual({ ...ROW_BOX.solar }, { x: 22, y: 199, w: 148, h: 92 });
  assert.deepEqual({ ...ROW_BOX.bottom }, { x: 22, y: 364, w: 148, h: 92 });
});

test('glyph origins: stems 80 px apart in pairs, 64 px in the solar odometer, +-165 px from the centre', () => {
  const [a, b] = glyphOrigins('top');
  assert.equal(b.x - a.x, 80);
  assert.equal(glyphOrigins('bottom')[1].x - glyphOrigins('bottom')[0].x, 80);
  const s = glyphOrigins('solar');
  assert.equal(s.length, 3);
  assert.equal(s[1].x - s[0].x, 64);
  assert.equal(s[2].x - s[1].x, 64);
  // the origin is 20.5 px above the 90 px glyph frame centre (SPEC §9.2): frame centre = row centre
  near(a.y + 20.5, SCREEN.cy - 165, 1e-9);
  near(glyphOrigins('bottom')[0].y + 20.5, SCREEN.cy + 165, 1e-9);
  near(s[0].y + 20.5, SCREEN.cy, 1e-9);
  // 3 px ink needs stems on pixel centres: x and y end in .5
  for (const o of [a, b, ...s, glyphOrigins('bottom')[0]]) {
    assert.equal(o.x % 1, 0.5);
    assert.equal(o.y % 1, 0.5);
  }
  // symmetric about the screen centre (up to the half pixel shift)
  near((a.x + b.x) / 2, SCREEN.cx + 0.5, 1e-9);
  near(s[1].x, SCREEN.cx + 0.5, 1e-9);
});

test('counter dots: radius 86, 11.5 degree step, centred, left to right, concentric with the screen end', () => {
  for (const side of ['top', 'bottom']) {
    const cy = side === 'top' ? 96 : 394; // centres of the two semicircular ends
    for (const n of [1, 4, 5, 7, 9, 11, 13]) {
      const dots = counterPositions(n, side);
      assert.equal(dots.length, n);
      dots.forEach((d, i) => {
        near(Math.hypot(d.x - 96, d.y - cy), 86, 1e-9, `${side} n=${n} i=${i} radius`);
        if (i > 0) {
          assert.ok(d.x > dots[i - 1].x, 'read left to right');
          near(d.deg - dots[i - 1].deg, 11.5, 1e-9);
        }
        assert.ok(insideScreen(d.x, d.y), 'dot is on the screen');
        // top arc bulges upwards, bottom arc downwards
        if (side === 'top') assert.ok(d.y <= cy);
        else assert.ok(d.y >= cy);
      });
      near(dots[0].x + dots.at(-1).x, 192, 1e-9, 'symmetric about the vertical axis');
      near(dots[0].y, dots.at(-1).y, 1e-9);
    }
  }
  const one = counterPositions(1, 'top')[0];
  near(one.x, 96, 1e-9);
  near(one.y, 10, 1e-9);
  const widest = counterPositions(13, 'top');
  near(widest.at(-1).deg, 69, 1e-9);
});

test('counter dots: exact positions of a 3-dot arc on both ends (x = 96 +- 86 sin a, y = centre -+ 86 cos a)', () => {
  const sin = 86 * Math.sin((11.5 * Math.PI) / 180); // 17.1456
  const cos = 86 * Math.cos((11.5 * Math.PI) / 180); // 84.2736
  assert.ok(Math.abs(sin - 17.1456) < 1e-3 && Math.abs(cos - 84.2736) < 1e-3, 'literal check of the trigonometry');
  const top = counterPositions(3, 'top');
  const bottom = counterPositions(3, 'bottom');
  const want = (cy, sign) => [
    [96 - 17.1456, cy + sign * 84.2736],
    [96, cy + sign * 86],
    [96 + 17.1456, cy + sign * 84.2736],
  ];
  want(96, -1).forEach(([x, y], i) => {
    near(top[i].x, x, 1e-3, `top ${i} x`);
    near(top[i].y, y, 1e-3, `top ${i} y`);
  });
  want(394, 1).forEach(([x, y], i) => {
    near(bottom[i].x, x, 1e-3, `bottom ${i} x`);
    near(bottom[i].y, y, 1e-3, `bottom ${i} y`);
  });
  assert.deepEqual(top.map((d) => d.deg), [-11.5, 0, 11.5]);
  // an even count is centred between the two middle dots
  const four = counterPositions(4, 'top');
  assert.deepEqual(four.map((d) => d.deg), [-17.25, -5.75, 5.75, 17.25]);
  assert.deepEqual(counterPositions(0, 'top'), []);
});

test('the row plate is inset from the hit box and stays clear of every sibling-counter dot', () => {
  const sd = (p, b) => {
    // signed distance from a point to a rounded rectangle
    const qx = Math.abs(p.x - (b.x + b.w / 2)) - (b.w / 2 - b.rx);
    const qy = Math.abs(p.y - (b.y + b.h / 2)) - (b.h / 2 - b.rx);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - b.rx;
  };
  for (const k of ROWS) {
    const p = plateBox(k);
    const r = ROW_BOX[k];
    assert.ok(p.x > r.x && p.x + p.w < r.x + r.w && p.y >= r.y && p.y + p.h <= r.y + r.h, `${k} plate inside its hit box`);
    assert.ok(p.rx <= p.h / 2 && p.rx <= p.w / 2);
  }
  // the largest dot (the current one, r = 4.1) must not touch the plate outline
  for (const side of ['top', 'bottom']) {
    for (const n of [4, 5, 7, 9, 11, 13]) {
      for (const d of counterPositions(n, side)) assert.ok(Math.abs(sd(d, plateBox(side))) > 4.1 + 0.5, `${side} n=${n} deg=${d.deg}`);
    }
  }
});

test('hit regions: thirds-like tap zones, glyph rows and the pill outline', () => {
  const at = (x, y) => hitTest(x, y);
  assert.deepEqual(at(96, 80), { region: 'top', row: 'top', ring: null });
  assert.deepEqual(at(96, 410), { region: 'bottom', row: 'bottom', ring: null });
  assert.deepEqual(at(96, 245), { region: 'middle', row: 'solar', ring: null });
  assert.deepEqual(at(96, 20), { region: 'top', row: null, ring: 'top' }, 'over the top counter arc');
  assert.deepEqual(at(96, 140), { region: 'top', row: null, ring: null });
  assert.deepEqual(at(96, 160), { region: 'middle', row: null, ring: null });
  assert.deepEqual(at(96, 330), { region: 'middle', row: null, ring: null });
  assert.deepEqual(at(96, 350), { region: 'bottom', row: null, ring: null });
  assert.deepEqual(at(96, 470), { region: 'bottom', row: null, ring: 'bottom' }, 'over the bottom counter arc');
  // every counter dot of every sibling count lies inside its ring band
  for (const side of ['top', 'bottom']) {
    for (const n of [4, 5, 7, 9, 11, 13]) for (const d of counterPositions(n, side)) assert.equal(at(d.x, d.y).ring, side, `${side} n=${n}`);
  }
  // outside the rounded outline: corners, bezel and margin
  assert.equal(at(2, 2), null);
  assert.equal(at(190, 488), null);
  assert.equal(at(-3, 245), null);
  assert.equal(at(96, 495), null);
  assert.ok(at(2, 245), 'the straight sides are inside');
  // every row box is inside the screen and inside its own region
  for (const k of ROWS) {
    const b = ROW_BOX[k];
    assert.ok(insideScreen(b.x + b.w / 2, b.y + b.h / 2));
    const r = hitTest(b.x + b.w / 2, b.y + b.h / 2);
    assert.equal(r.row, k);
    assert.equal(r.region, k === 'top' ? 'top' : k === 'bottom' ? 'bottom' : 'middle');
  }
});

test('client to logical coordinates', () => {
  const rect = { left: 100, top: 50, width: 204, height: 502 };
  const vb = { x: -BEZEL, y: -BEZEL, w: 204, h: 502 };
  assert.deepEqual(clientToLogical(rect, 100, 50, vb), { x: -6, y: -6 });
  const c = clientToLogical(rect, 100 + 102, 50 + 251, vb);
  near(c.x, 96, 1e-9);
  near(c.y, 245, 1e-9);
});

// ---- glyph states (SPEC §4.1) -------------------------------------------------------
test('state table of a 2-stroke glyph matches SPEC §4.1', () => {
  const seq = '0 1 2 3 4 3• 2• 1• 0• -1• -2• -3• -4 -3 -2 -1'.split(' ');
  const got = Array.from({ length: 16 }, (_, i) => {
    const s = stateInfo(i);
    return `${s.value}${s.dotted ? '•' : ''}`;
  });
  assert.deepEqual(got, seq);
  assert.equal(stateInfo(4).kind, 'peak');
  assert.equal(stateInfo(12).kind, 'valley');
  assert.equal(stateInfo(2).kind, 'rising');
  assert.equal(stateInfo(7).kind, 'falling');
  assert.equal(stateInfo(0).derivative, 1);
  assert.equal(stateInfo(8).derivative, -1);
  assert.equal(stateInfo(16).index, 0, 'wraps');
  assert.equal(stateInfo(-1).index, 15);
});

test('state table of a 3-stroke glyph: 0..13, 12..-12 dotted, -13, -12..-1', () => {
  const s = (i) => stateInfo(i, 3);
  assert.equal(s(0).states, 52);
  assert.equal(s(13).value, 13);
  assert.equal(s(13).kind, 'peak');
  assert.deepEqual([s(14).value, s(14).dotted], [12, true]);
  assert.deepEqual([s(38).value, s(38).dotted], [-12, true]);
  assert.equal(s(39).value, -13);
  assert.equal(s(39).kind, 'valley');
  assert.deepEqual([s(40).value, s(40).dotted], [-12, false]);
  assert.deepEqual([s(51).value, s(51).dotted], [-1, false]);
});

test('stateInfo agrees with the model for many instants and levels', () => {
  for (const t of [T_A, 946684800.25, 2886085800, 1.5e9, 4e8]) {
    for (const L of [1, 3, 6, 7, 10]) {
      const l = model.levelAt(t, L);
      const s = stateInfo(l.index);
      assert.deepEqual([s.value, s.derivative, s.dotted], [l.value, l.derivative, l.dotted], `L${L}@${t}`);
    }
  }
});

test('state wording', () => {
  assert.equal(signed(1), '+1');
  assert.equal(signed(2), '+2');
  assert.equal(signed(-1), MINUS + '1');
  assert.equal(signed(3), '+3');
  assert.equal(signed(-3), MINUS + '3');
  assert.equal(signed(0), '0');
  assert.equal(describeState(stateInfo(1)), 'value +1, rising \u2197');
  assert.equal(describeState(stateInfo(2)), 'value +2, rising \u2197');
  assert.equal(describeState(stateInfo(0)), 'value 0, rising \u2197');
  assert.equal(describeState(stateInfo(15)), `value ${MINUS}1, rising \u2197`);
  assert.equal(describeState(stateInfo(13)), `value ${MINUS}3, rising \u2197`);
  assert.equal(describeState(stateInfo(5)), 'value +3, falling \u2198 (dot)');
  assert.equal(describeState(stateInfo(4)), 'peak, value +4');
  assert.equal(describeState(stateInfo(12)), `valley, value ${MINUS}4`);
});

// ---- glyph book: the library's own geometry (SPEC §9.1) -----------------------------
test('glyph book composes CBT geometry: dots exactly on the falling branch, fixed bounds', () => {
  for (let i = 0; i < 16; i++) {
    const g = book.get(i);
    assert.equal(g.index, i);
    assert.equal(!!g.dot, i >= 5 && i <= 11, `dot @${i}`);
    if (g.dot) assert.deepEqual([g.dot.x, g.dot.y, g.dot.r], [0, -1.75, 0.3]);
    near(g.bounds.minX, -2.15, 1e-9);
    near(g.bounds.maxX, 2.15, 1e-9);
    near(g.bounds.minY, -2.2, 1e-9);
    near(g.bounds.maxY, 6.15, 1e-9);
    assert.ok(g.d.startsWith('M0 0 L0 3 M0 3 L0 6'), 'stems of the two trits');
  }
  // trit 0 = bar, +1 = curve down-right, -1 = curve up-left (SPEC §9.1); index 0 is value 0 = trits 0,0
  assert.equal(book.get(0).d, 'M0 0 L0 3 M0 3 L0 6 M-1 0 L1 0 M-1 3 L1 3');
  // index 1 = value +1 = trits (0, +1) MSB first: the least significant trit (+1, curve down-right) is on top
  assert.equal(book.get(1).d, 'M0 0 L0 3 M0 3 L0 6 M0 0 C0 0 0 1 1 1 C2 1 2 0 2 0 M-1 3 L1 3');
  // value -3 (index 13): trits (-1, 0) -> top = trit 0 (bar), second = -1 (curve up-left)
  assert.equal(book.get(13).d, 'M0 0 L0 3 M0 3 L0 6 M-1 0 L1 0 M0 3 C0 3 0 2 -1 2 C-2 2 -2 3 -2 3');
  // value +3 falling (index 5): trits (+1, 0): bar on top, +1 curve second, plus the dot
  assert.equal(book.get(5).d, 'M0 0 L0 3 M0 3 L0 6 M-1 0 L1 0 M0 3 C0 3 0 4 1 4 C2 4 2 3 2 3');
  assert.equal(book.get(16).index, 0);
});

// ---- overlays and taps (SPEC §8, §10) ----------------------------------------------
test('overlay: info replaces letters; letters stay when persistent or briefly after a change', () => {
  assert.equal(overlayMode({ now: 10, infoUntil: 0, lettersUntil: 0, showLetters: false }), 'none');
  assert.equal(overlayMode({ now: 10, infoUntil: 0, lettersUntil: 20, showLetters: false }), 'letters');
  assert.equal(overlayMode({ now: 25, infoUntil: 0, lettersUntil: 20, showLetters: false }), 'none');
  assert.equal(overlayMode({ now: 25, infoUntil: 0, lettersUntil: 20, showLetters: true }), 'letters');
  assert.equal(overlayMode({ now: 10, infoUntil: 15, lettersUntil: 20, showLetters: true }), 'info');
  assert.equal(overlayMode({ now: 16, infoUntil: 15, lettersUntil: 20, showLetters: true }), 'letters');
});

test('double tap: two middle taps within 400 ms toggle letters, otherwise info', () => {
  assert.equal(middleTapAction(null, 1000), 'info');
  assert.equal(middleTapAction({ region: 'middle', time: 700 }, 1000), 'letters');
  assert.equal(middleTapAction({ region: 'middle', time: 600 }, 1000), 'letters');
  assert.equal(middleTapAction({ region: 'middle', time: 599 }, 1000), 'info');
  assert.equal(middleTapAction({ region: 'top', time: 900 }, 1000), 'info');
});

test('double tap consumes the sequence: a quick third tap starts a new one instead of toggling back', () => {
  const a = middleTap(null, 1000);
  assert.deepEqual(a, { action: 'info', last: { region: 'middle', time: 1000 } });
  const b = middleTap(a.last, 1150);
  assert.equal(b.action, 'letters');
  assert.equal(b.last, null);
  const c = middleTap(b.last, 1300); // 150 ms after the double tap
  assert.equal(c.action, 'info');
  assert.deepEqual(c.last, { region: 'middle', time: 1300 });
  assert.equal(middleTap(c.last, 1350).action, 'letters', 'and the pair after it is a double tap again');
  // slow taps never pair up
  assert.equal(middleTap({ region: 'middle', time: 1000 }, 1401).action, 'info');
  assert.equal(middleTap({ region: 'middle', time: 1000 }, 1400).action, 'letters');
});

test('integers and percentages: true minus sign, floored to 0.1 %, and 100.0 % only when the cycle is really complete', () => {
  assert.equal(intText(4820), '4820');
  assert.equal(intText(0), '0');
  assert.equal(intText(-32927), `${MINUS}32927`);
  assert.equal(percentText(0), '0.0');
  assert.equal(percentText(0.3586), '35.8', 'floored, not rounded (35.86 % is not 35.9)');
  assert.equal(percentText(0.3589999), '35.8');
  assert.equal(percentText(0.5), '50.0');
  assert.equal(percentText(0.29), '29.0', 'an exact tenth is not floored one tenth too low');
  assert.equal(percentText(0.57), '57.0');
  assert.equal(percentText(0.99949), '99.9');
  assert.equal(percentText(0.99965), '99.9', 'a running sync never reads 100.0');
  assert.equal(percentText(0.999999), '99.9');
  assert.equal(percentText(1), '100.0');
  assert.equal(percentText(-0.2), '0.0');
  assert.equal(percentText(NaN), '0.0');
  assert.equal(percentText(1.3), '100.0');
  // the same rule as the rings text (floor to a tenth, 99.9 at most): never above the true value
  for (let i = 0; i < 2000; i++) {
    const p = i / 2000 + 1e-5;
    assert.ok(Number(percentText(p)) <= p * 100 + 1e-9, String(p));
    assert.ok(Number(percentText(p)) > p * 100 - 0.1 - 1e-9, String(p));
  }
});

test('threshold caption', () => {
  assert.equal(thresholdCaption('peak'), 'NEXT PEAK');
  assert.equal(thresholdCaption('end'), 'NEXT END');
});

// ---- tooltips on real clock readings ------------------------------------------------
test('period tooltip at SPEC vector A: depth 7 shows state 13, value -3, rising', () => {
  const info = model.levelInfo(6);
  const lv = model.levelAt(T_A, 6);
  const od = model.odometerAt(T_A, 6);
  const major = model.odometerAt(T_A, 6, { digits: 1 });
  const tip = periodTooltip(
    {
      letter: info.letter,
      depth: info.depth,
      meanSeconds: info.meanSeconds,
      state: stateInfo(od.digits[0]),
      fineIndex: od.digits[1],
      fineNext: od.nextTime,
      majorNext: major.nextTime,
      cycleEnd: lv.end,
      local: lv.local,
      siblings: lv.siblings,
      parentLetter: model.levelInfo(5).letter,
      now: T_A,
    },
    fmt,
  );
  assert.equal(tip.title, '\u03b7 \u00b7 depth 7');
  assert.equal(tip.aside, '\u2248 5 h 3 min per cycle');
  assert.equal(tip.lines.length, 4);
  assert.equal(tip.lines[0], `State 13 of 16: value ${MINUS}3, rising \u2197`);
  assert.equal(tip.lines[1], 'Right (fine) glyph: state 0 of 16, changes at 12:00:33');
  assert.match(tip.lines[2], /^Next change \d\d:\d\d:\d\d \(in \d+ min \d\d s\)$/);
  assert.equal(tip.lines[3], 'Cycle 1 of 11 in its \u03b6 \u00b7 ends 12:56:12');
  assert.match(tip.hint, /select/i);
});

test('the row hint says what a click does: select, plus the depth step the tap region performs (SPEC §10)', () => {
  const base = { letter: '\u03b7', depth: 7, meanSeconds: 18180, state: stateInfo(13), fineIndex: 0, fineNext: null, majorNext: null, cycleEnd: null, local: 0, siblings: null, parentLetter: null, now: T_A };
  const hint = (extra) => periodTooltip({ ...base, ...extra }, fmt).hint;
  assert.equal(hint({}), 'Click or tap: select this cycle in every view');
  assert.equal(hint({ step: 0, by: 'pointer' }), 'Click or tap: select this cycle in every view');
  assert.equal(hint({ step: -1 }), 'Click or tap: select this cycle in every view and show longer periods');
  assert.equal(hint({ step: 1 }), 'Click or tap: select this cycle in every view and show shorter periods');
  assert.equal(hint({ by: 'key', step: -1 }), 'Enter: select this cycle in every view', 'Enter only selects');
  // optional lines drop out cleanly
  const t = periodTooltip(base, fmt);
  assert.deepEqual(t.lines, [`State 13 of 16: value ${MINUS}3, rising \u2197`, 'Right (fine) glyph: state 0 of 16']);
});

test('solar tooltip at SPEC vector A: sync 4820, phase 35.8 % (35.87 floored), drift -13 h 27 min, next node', () => {
  const s = model.solarAt(T_A);
  const tip = solarTooltip({ sync: s.sync, phase: s.phase, drift: s.drift, thresholdName: s.threshold.name, thresholdTime: s.threshold.time, start: s.start, now: T_A }, fmt);
  assert.equal(tip.title, 'Solar sync #4820');
  assert.equal(tip.lines[0], 'Phase 35.8 % of this 4-day sync');
  assert.equal(tip.lines[1], `Drift against civil days ${MINUS}13 h 27 min`);
  assert.equal(tip.lines[2], 'Next node Oct 9 01:34');
  assert.equal(tip.lines[3], 'Sync time Oct 7 01:34');
  assert.equal(tip.aside, '19 \u03b7 cycles \u2248 4 days');
  assert.equal(tip.hint, 'Click or tap: info labels \u00b7 double tap: letters');
  assert.equal(tip.lines.length, 4);
  const key = solarTooltip({ sync: s.sync, phase: s.phase, drift: s.drift, thresholdName: s.threshold.name, thresholdTime: s.threshold.time, start: s.start, now: T_A, by: 'key' }, fmt);
  assert.equal(key.hint, 'Enter: show the info labels \u00b7 key l: keep the letters', 'keyboard focus names the keys, not clicks');
});

test('solar tooltip wording: signed drift, true minus in negative sync numbers, never 100 % before the sync ends', () => {
  const mk = (extra) => solarTooltip({ sync: 4820, phase: 0.5, drift: -60, thresholdName: 'peak', thresholdTime: T_A, start: T_A, now: T_A, ...extra }, fmt);
  assert.equal(mk({ drift: 10 }).lines[1], 'Drift against civil days +10 s');
  assert.equal(mk({ drift: -10 }).lines[1], `Drift against civil days ${MINUS}10 s`);
  assert.equal(mk({ sync: -1 }).title, `Solar sync #${MINUS}1`);
  assert.equal(mk({ sync: -32927 }).title, `Solar sync #${MINUS}32927`);
  assert.equal(mk({ phase: 0.99965 }).lines[0], 'Phase 99.9 % of this 4-day sync');
  assert.equal(mk({ phase: 0 }).lines[0], 'Phase 0.0 % of this 4-day sync');
  // a real reading from the model, three minutes before a sync ends
  const s = model.solarAt(model.solarSyncByNumber(4820).end - 100);
  assert.ok(s.phase < 1);
  assert.notEqual(solarTooltip({ sync: s.sync, phase: s.phase, drift: s.drift, thresholdName: s.threshold.name, thresholdTime: s.threshold.time, start: s.start, now: T_A }, fmt).lines[0], 'Phase 100.0 % of this 4-day sync');
});

test('region hints name the depth the tap leads to and the clamped ends', () => {
  const letters = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [i + 1, model.levelInfo(i).letter]));
  assert.equal(regionHint('top', { topDepth: 7, letters }), 'Click or tap: longer period, top becomes \u03b6, depth 6');
  assert.equal(regionHint('bottom', { topDepth: 7, letters }), 'Click or tap: shorter period, top becomes \u03b8, depth 8');
  assert.equal(regionHint('top', { topDepth: 2, letters }), 'Longest period shown: \u03b2, depth 2');
  assert.equal(regionHint('top', { topDepth: 3, letters }), 'Click or tap: longer period, top becomes \u03b2, depth 2');
  assert.equal(regionHint('bottom', { topDepth: 11, letters }), 'Shortest pair shown: \u03bb, depth 11 over \u03bc, depth 12');
  assert.equal(regionHint('bottom', { topDepth: 10, letters }), 'Click or tap: shorter period, top becomes \u03bb, depth 11');
  assert.equal(regionHint('middle', { topDepth: 7, letters }), 'Click or tap: info labels \u00b7 double tap: period letters');
  assert.ok(!/\([^)]*\(/.test(regionHint('bottom', { topDepth: 11, letters })), 'no nested parentheses');
  // without letters only the depth is named
  assert.equal(regionHint('top', { topDepth: 7 }), 'Click or tap: longer period, top becomes depth 6');
});

test('info labels are spoken in full, with a placeholder for undefined values', () => {
  const m = { topCap: 'NEXT END', topVal: '12:56:12', solarCap: 'NEXT NODE', solarVal: 'Oct 9 01:34', syncVal: 'Oct 7 01:34', solarOk: true };
  assert.equal(infoSpeech(m), 'Next end of the top period: 12:56:12. Next node of the solar sync: Oct 9 01:34. Sync time: Oct 7 01:34.');
  assert.equal(
    infoSpeech({ ...m, topVal: '\u2014', solarOk: false, solarVal: '\u2014', syncVal: '\u2014' }),
    'Next end of the top period: not defined. Solar sync: not defined within 3 days of the catalogue edge.',
  );
});

test('aria labels carry the state without arrow glyphs', () => {
  const l = rowAriaLabel('top', { letter: '\u03b7', depth: 7, state: stateInfo(13), local: 0, siblings: 11 });
  assert.match(l, /^\u03b7 depth 7: state 13 of 16, value \u22123, rising, cycle 1 of 11\. Activate to select this depth$/);
  assert.ok(!/[\u2197\u2198]/.test(l));
  assert.match(rowAriaLabel('solar', { sync: 4820, phase: 0.3586, digits: [5, 11, 13] }), /^Solar sync 4820, 35\.8 percent, glyphs 5, 11, 13\./);
  assert.match(rowAriaLabel('solar', { sync: -3, phase: 0.99991, digits: [0, 0, 0] }), new RegExp(`^Solar sync ${MINUS}3, 99\\.9 percent`));
  // one-cycle readings (alpha has no sibling counter) leave the cycle out
  assert.ok(!/cycle/.test(rowAriaLabel('top', { letter: '\u03b1', depth: 1, state: stateInfo(0), local: 0, siblings: null })));
});

// ---- fitting ------------------------------------------------------------------------
test('layoutFit keeps the aspect ratio and stays inside the stage', () => {
  const lw = 192 + 2 * BEZEL;
  const lh = 490 + 2 * BEZEL;
  for (const [w, h] of [
    [278, 628],
    [278, 380],
    [350, 540],
    [900, 300],
  ]) {
    const f = layoutFit({ width: w, height: h, dpr: 1, snap: false });
    assert.ok(f.width <= w + 1e-9 && f.height <= h + 1e-9);
    near(f.width / f.height, lw / lh, 1e-9);
    assert.ok(f.left >= 0 && f.top >= 0);
    // one dimension is exactly filled
    assert.ok(Math.abs(f.width - w) < 1e-9 || Math.abs(f.height - h) < 1e-9);
  }
  assert.equal(layoutFit({ width: 0, height: 100 }).scale, 0);
  // a width-bound stage: the pill fills the width and is centred vertically
  const wide = layoutFit({ width: 100, height: 1000, dpr: 1, snap: false });
  near(wide.scale, 100 / lw, 1e-12);
  near(wide.width, 100, 1e-9);
  near(wide.height, (lh * 100) / lw, 1e-9);
  near(wide.left, 0, 1e-9);
  near(wide.top, (1000 - wide.height) / 2, 1e-9);
  // a height-bound stage: filled height, centred horizontally
  const tall = layoutFit({ width: 600, height: 502, dpr: 1, snap: false });
  near(tall.scale, 1, 1e-12);
  near(tall.left, (600 - lw) / 2, 1e-9);
  near(tall.top, 0, 1e-9);
});

test('layoutFit snaps to whole device pixels per logical pixel when that costs < 10 %', () => {
  const lw = 192 + 2 * BEZEL;
  const lh = 490 + 2 * BEZEL;
  // fit scale 2.15 at dpr 1 -> 2 device px per logical px
  const f = layoutFit({ width: lw * 2.15, height: lh * 2.15, dpr: 1 });
  assert.equal(f.snapped, true);
  assert.equal(f.scale, 2);
  assert.equal(f.width, lw * 2);
  assert.equal(Number.isInteger(f.left), true);
  // centred and rounded to whole device pixels: (438.6 - 408) / 2 = 15.3 -> 15, (1079.3 - 1004) / 2 = 37.65 -> 38
  assert.equal(f.left, 15);
  assert.equal(f.top, 38);
  assert.equal(f.height, lh * 2);
  // at dpr 2 the same stage allows half steps: 4.3 device px -> 4 -> 2 css px per logical px
  const g = layoutFit({ width: lw * 2.15, height: lh * 2.15, dpr: 2 });
  assert.equal(g.scale, 2);
  assert.equal(Number.isInteger(g.left * 2), true);
  // too far from a whole number: keep the exact fit
  const h = layoutFit({ width: lw * 1.7, height: lh * 1.7, dpr: 1 });
  assert.equal(h.snapped, false);
  near(h.scale, 1.7, 1e-9);
  // below one device pixel per logical pixel nothing can snap
  assert.equal(layoutFit({ width: lw * 0.6, height: lh * 0.6, dpr: 1 }).snapped, false);
  // the boundaries: exactly 1 device px per logical px snaps (a no-op), half a CSS px at dpr 2 does too
  const one = layoutFit({ width: lw, height: lh, dpr: 1 });
  assert.deepEqual([one.snapped, one.scale, one.left, one.top], [true, 1, 0, 0]);
  const half = layoutFit({ width: lw / 2, height: lh / 2, dpr: 2 });
  assert.deepEqual([half.snapped, half.scale], [true, 0.5]);
  // 5 % below a whole number snaps, 15 % does not (tolerance 0.9)
  assert.equal(layoutFit({ width: lw * 2.2, height: lh * 2.2, dpr: 1 }).snapped, true);
  assert.equal(layoutFit({ width: lw * 2.3, height: lh * 2.3, dpr: 1 }).snapped, false);
  // 3 px ink needs whole device pixels: at dpr 2 and fit 2.15 the scale is a multiple of 0.5 and the offsets of 0.5 css px
  const hd = layoutFit({ width: lw * 2.15, height: lh * 2.15, dpr: 2 });
  assert.equal((hd.scale * 2) % 1, 0);
  assert.equal((hd.left * 2) % 1, 0);
  assert.equal((hd.top * 2) % 1, 0);
});

// ---- the SPEC's 0-based state numbering (SPEC §4.1: "numbered 0 to 4M-1") --------------------
/** Tooltip, aria label and model reading of a depth-7 row at instant t, built the way face.js builds them. */
function row7(t) {
  const info = model.levelInfo(6);
  const l = model.levelAt(t, 6);
  const od = model.odometerAt(t, 6);
  const d = {
    letter: info.letter,
    depth: info.depth,
    meanSeconds: info.meanSeconds,
    state: stateInfo(od.digits[0]),
    fineIndex: od.digits[1],
    fineNext: od.nextTime,
    majorNext: null,
    cycleEnd: l.end,
    local: l.local,
    siblings: l.siblings,
    parentLetter: model.levelInfo(5).letter,
    now: t,
  };
  return { l, od, tip: periodTooltip(d, fmt), label: rowAriaLabel('top', d) };
}

test('tooltips and aria labels print the SPEC state index, 0-based: a cycle starts in state 0 and ends in state 15, never 16', () => {
  const lv = model.levelAt(T_A, 6);
  const first = row7(lv.start + 0.001);
  assert.equal(first.l.index, 0);
  assert.equal(first.tip.lines[0], 'State 0 of 16: value 0, rising \u2197');
  assert.match(first.label, /: state 0 of 16, /);
  const last = row7(lv.end - 0.001);
  assert.equal(last.l.index, 15);
  assert.equal(last.tip.lines[0], `State 15 of 16: value ${MINUS}1, rising \u2197`);
  assert.match(last.label, /: state 15 of 16, /);
  assert.ok(!/state 16\b/i.test(last.tip.lines.join(' ') + last.label), 'there is no state 16');
});

test('the printed state number is the library index at every state of a cycle, and the fine glyph stays within 0..15', () => {
  const lv = model.levelAt(T_A, 6);
  for (let k = 0; k < 16; k++) {
    const t = lv.start + ((k + 0.5) / 16) * (lv.end - lv.start);
    const r = row7(t);
    assert.equal(r.l.index, k, `model index at state ${k}`);
    assert.ok(r.tip.lines[0].startsWith(`State ${k} of 16: `), r.tip.lines[0]);
    assert.ok(r.label.includes(`: state ${k} of 16, `), r.label);
    const fine = Number(/^Right \(fine\) glyph: state (\d+) of 16/.exec(r.tip.lines[1])?.[1]);
    assert.ok(Number.isInteger(fine) && fine >= 0 && fine <= 15, r.tip.lines[1]);
    assert.equal(fine, r.od.digits[1]);
  }
});

// ---- wording: user-visible strings say "depth" (1-based), never "level" ---------------------------
const KEYWORDS = /^(?:const|let|var|of|in|return|typeof|new|case|else|void|delete|await|yield|export|function|import|from|as|instanceof|if|do|throw|async|get|set|static)$/;
/**
 * Occurrences of the word "level" in the strings of a source text: identifiers never contain a space, so a
 * word followed by " level" (after the keywords that may precede an identifier), a string that starts with
 * "Level" or "level's" can only be prose.
 */
function levelWordHits(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1');
  const hits = [];
  for (const m of code.matchAll(/\b([A-Za-z][\w$]*)\s+levels?\b/g)) if (!KEYWORDS.test(m[1])) hits.push(m[0]);
  for (const m of code.matchAll(/['"`>]\s*Levels?\b/g)) hits.push(m[0]);
  for (const m of code.matchAll(/\blevels?['\u2019]s\b/gi)) hits.push(m[0]);
  return hits;
}
const sourceOf = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the wording scan itself: it sees prose "level" but not identifiers', () => {
  assert.deepEqual(levelWordHits('title="Zoom to the selected level\'s cycle"'), ['selected level', "level's"]);
  assert.deepEqual(levelWordHits("say(`Selected level ${n}`)"), ['Selected level']);
  assert.deepEqual(levelWordHits("const a = 'Level mixer';"), ["'Level"]);
  assert.deepEqual(levelWordHits('for (const level of levels) { let level = 1; return level; } // the level here\n/* a level */'), []);
  assert.deepEqual(levelWordHits('const levelInfo = model.levelInfo(selectedLevel); x.level(levelsFor(d));'), []);
});

test('no user-visible string of the face says "level"', () => {
  const dir = '../src/ui/face/';
  const files = ['../src/ui/face.js', '../src/styles/face.css', ...readdirSync(new URL(dir, import.meta.url)).map((f) => dir + f)];
  for (const f of files) assert.deepEqual(levelWordHits(sourceOf(f)), [], f);
});

// =====================================================================================================
// Pure mode (docs/design/80-pure.md, SPEC §15, revision 3): the face speaks Fractonica only. Major periods (α β γ δ)
// in words with their quarter, minor ones by letters and counts.
// =====================================================================================================
const pure = createPure(model, { now: () => T_A });
// the library's glyph SVGs carry their own <title>/<desc> ("vector CBT value 3 ..."): not part of the visible text
const stripTags = (html) => html.replace(/<(title|desc)>[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ' ');
/** Every user-visible / spoken string of a tooltip model, including the aria-label of embedded graphics, as scanner items. */
function tipItems(m, where = 'tip') {
  if (!m) return [];
  const out = [];
  const add = (kind, text) => text && out.push({ kind, text: String(text).replace(/\s+/g, ' ').trim(), where });
  add('text', m.title);
  add('text', m.aside);
  add('text', m.hint);
  for (const l of m.lines) {
    if (typeof l === 'string') add('text', l);
    else {
      add('text', stripTags(l.html));
      for (const a of l.html.matchAll(/aria-label="([^"]*)"/g)) add('attr:aria-label', a[1]);
    }
  }
  return out;
}
const hardLeaks = (items) => judge(items, 'test').filter((l) => l.severity === 'hard');
const frameA = model.frame(T_A);
const tipAt = (row, topDepth, by) => pureTooltipModel({ model, pure, frame: frameA, row, topDepth, by });

// the notation (header of src/core/pure.js): X#n is an ordinal from 1, nX counts units from 0 (the Helion of a date is numbered
// from 1: 1η … 77η in its Nuclide), "η 7" is a depth chip.
// Retired spellings: half units (revision 2), "beat", the unit names of revision 2 and fracton names for minor depths (revision 3).
const HALF = '½'; // the vulgar fraction: written as an escape so that no half-cycle spelling sits in this file
const OLD_SPELLINGS = [
  [new RegExp(`[αβγδεζηθικλμνξ]${HALF}`), 'a half-cycle unit'],
  [/\bbeats?\b/i, 'the retired word "beat" (real time is counted in Blinks)'],
  [/\b(Hadron|Quark|Chromon|Somon|Atom)s?\b/, 'a retired unit name (ζ θ κ μ are no units; δ is Delta)'],
  [/\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi)\s+\w*fracton\b/, 'a fracton name for a minor depth'],
  [/\d+·\d+/, 'a glyph pair written "13·4" (it reads as the number 13.4)'],
  [/(?<!depth )\b\d+ [αβγδεζηθικλμνξ](?![\wα-ω#])/, 'a count written with a space ("19 η")'],
];
const oldSpellings = (text) => OLD_SPELLINGS.filter(([re]) => re.test(text)).map(([, why]) => `${why}: ${text}`);

test('the notation scan itself: it sees the old spellings, not durations, counts, ordinals or depth chips', () => {
  for (const bad of [`δ${HALF}#3 ε${HALF}#2`, 'phase 13·4 of 256', '19 η per sync', 'one η per beat', 'one cycle = 1ζ (Hadron)', 'Eta Difracton begins', 'Atom']) assert.notDeepEqual(oldSpellings(bad), [], bad);
  for (const ok of ['δ#3 ε#5 34η 29ι', 'in 6ι 43λ', 'Ends in 43η 6ι → Delta Tetrafracton begins', 'Delta Trifracton End ε#5 34η 29ι', 'η 7 · θ 8', 'depth 7 η over depth 8 θ', 'phase 13 and 4 of 256', '19η per sync', 'state 13 of 16', '4ι per Blink']) {
    assert.deepEqual(oldSpellings(ok), [], ok);
  }
});

test('pure: the sync drift, the cycle names and the pair names come from the shared vocabulary (no local copies)', () => {
  const src = sourceOf('../src/ui/face/pure.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1');
  for (const gone of ['groupDigits', 'driftLambda', 'driftText = ', 'function driftText', 'cycleLengthText', 'tidyPair', 'prefixNum', 'NNBSP', 'Monofracton', 'ORDINAL']) assert.ok(!src.includes(gone), `${gone} was replaced by ctx.pure`);
  const sol = model.solarAt(T_A);
  const m = pureInfoLabels(pure, T_A, model.levelAt(T_A, 6), sol);
  assert.equal(m.syncVal, `drift ${pure.driftText(sol)}`);
  assert.match(m.syncVal, /^drift −\d{1,3}(\u202f\d{3})*λ$/, 'a true minus and narrow digit groups, as everywhere');
  const tip = tipAt('solar', 7);
  assert.equal(tip.lines[1], `Drift ${pure.driftText(sol)} ${DRIFT_REF}`);
  // names of cycles are the core's: majors in words, minors by where they start in their Nuclide
  for (let L = 1; L <= 11; L++) {
    const lv = model.levelAt(T_A, L);
    assert.equal(letterName(pure, L, lv.cycleBig), pure.cycleName(L, lv.cycleBig), `depth ${L + 1}`);
  }
  // a spoken pair is the accessible name of the drawn pair
  assert.equal(pairSpeech(pure, 0.5), 'phase 8 and 0 of 256');
  assert.equal(pairSpeech(pure, 13 / 16 + 4 / 256 + 1e-4), 'phase 13 and 4 of 256');
  assert.equal(pairSpeech(pure, 0.3, 'state'), pure.pairHTML(0.3, { label: 'state' }).match(/aria-label="([^"]*)"/)[1]);
});

test('pure: what one cycle of a depth is (the tooltip aside): majors and units name the next unit, the depths between count it', () => {
  const aside = (L) => cycleAside(pure, model, L);
  assert.deepEqual([0, 1, 2, 3].map(aside), ['one Alpha = 5β', 'one Beta = 13γ', 'one Gamma = 5δ', 'one Delta = 5ε']);
  assert.deepEqual([4, 6, 8, 10, 12].map(aside), ['one Nuclide = 77η', 'one Helion = 36ι', 'one Preon = 65λ', 'one Flavon = 25ν', 'one Blink, the finest unit']);
  // ζ θ κ μ are no units (no names): a cycle is a whole count of the next unit, the core's exact length
  assert.deepEqual([5, 7, 9, 11].map(aside), ['one cycle = 11η', 'one cycle = 4ι', 'one cycle = 13λ', 'one cycle = 5ν']);
  for (const L of [5, 7, 9, 11]) assert.equal(aside(L), `one cycle = ${pure.cycleLength(L)}`);
  for (let depth = 2; depth <= 11; depth++) {
    for (const row of ['top', 'bottom']) assert.equal(tipAt(row, depth).aside, aside(row === 'top' ? depth - 1 : depth));
  }
});

test('pure: countdowns are positions counted in ladder units, "ago" is the same span backwards', () => {
  const lv = model.levelAt(T_A, 6);
  assert.equal(inText(pure, T_A, lv.end), 'in ' + pure.between(T_A, lv.end));
  assert.equal(inText(pure, T_A, lv.end), 'in 6ι 43λ', 'SPEC §15.6: the depth-7 end at vector A');
  assert.equal(agoText(pure, lv.end, T_A), '6ι 43λ ago');
  assert.equal(inText(pure, T_A, null), '—');
  assert.equal(inText(pure, T_A, NaN), '—');
  assert.equal(agoText(pure, T_A, undefined), '—');
  // zero parts are the vocabulary's business: a whole η reads "1η", never "1η 0ι"
  assert.equal(inText(pure, lv.start, lv.end), 'in 1η');
  assert.equal(agoText(pure, lv.end, lv.start), '1η ago');
});

test('pure info labels: threshold countdowns and the sync number with its drift, never a clock time', () => {
  const lTop = model.levelAt(T_A, 6);
  const sol = model.solarAt(T_A);
  const m = pureInfoLabels(pure, T_A, lTop, sol);
  assert.equal(m.topCap, capOf(lTop.next.name));
  assert.equal(m.topVal, inText(pure, T_A, lTop.next.time));
  assert.equal(m.topVal, 'in 6ι 43λ');
  assert.equal(m.solarCap, 'NEXT NODE');
  assert.equal(m.solarVal, inText(pure, T_A, sol.threshold.time));
  assert.match(m.solarVal, /^in \d+η \d+ι$/, 'the node of the sync is Helions and Preons away');
  assert.equal(m.syncCap, 'SYNC 4820');
  assert.equal(m.syncVal, `drift ${pure.driftText(sol)}`);
  assert.equal(m.solarOk, true);
  assert.equal(m.pure, true);
  assert.deepEqual(hardLeaks(['topCap', 'topVal', 'solarCap', 'solarVal', 'syncCap', 'syncVal'].map((k) => ({ kind: 'text', text: m[k], where: k }))), []);
  const n = pureInfoLabels(pure, T_A, lTop, null);
  assert.deepEqual([n.solarCap, n.solarVal, n.syncCap, n.syncVal, n.solarOk], ['SOLAR SYNC', '—', 'SYNC', '—', false]);
  const none = pureInfoLabels(pure, T_A, { next: { name: 'end', time: null } }, sol);
  assert.equal(none.topVal, '—');
});

test('pure info speech reads the countdowns and the sync, with placeholders for undefined values', () => {
  const lTop = model.levelAt(T_A, 6);
  const sol = model.solarAt(T_A);
  const m = pureInfoLabels(pure, T_A, lTop, sol);
  const say = pureInfoSpeech(m);
  assert.equal(say, `Next ${lTop.next.name} of the top period: in 6ι 43λ. Next node of the solar sync: ${m.solarVal}. Solar sync 4820, ${m.syncVal}.`);
  assert.equal(pureInfoSpeech(pureInfoLabels(pure, T_A, lTop, null)), 'Next end of the top period: in 6ι 43λ. Solar sync: not defined within one sync of the catalogue edge.');
  assert.match(pureInfoSpeech({ ...m, topVal: '—' }), /^Next end of the top period: not defined\./);
  assert.deepEqual(hardLeaks([{ kind: 'text', text: say, where: 'speech' }]), []);
});

test('pure period tooltip at vector A, a minor row: the Helion by its number in the Nuclide, the end names the Helion that begins', () => {
  const m = tipAt('top', 7);
  assert.equal(m.title, 'η · depth 7');
  assert.equal(m.aside, 'one Helion = 36ι');
  assert.equal(m.lines[0], '34η of 77 in ε#5', 'SPEC §15.6: vector A is in the 34th Helion of the 5th Nuclide (Helions are numbered from 1)');
  assert.equal(m.lines[1], `State 13 of 16: value ${MINUS}3, rising ↗`);
  assert.match(m.lines[2], /^Right \(fine\) glyph: state 0 of 16, changes in [\d.]+\S+( \d+\S+)?$/);
  assert.match(m.lines[3], /^Next change in \d+\S+( \d+\S+)?$/);
  assert.equal(m.lines[4], 'Ends in 6ι 43λ → 35η begins');
  assert.equal(m.lines[5], FROM_ONE, 'which numbers count from 0 and which from 1');
  assert.equal(m.lines.length, 6);
  assert.equal(m.hint, 'Click or tap: select this cycle in every view and show longer periods');
  // the same glyph readings as normal mode: only the wording of the times changed
  const normal = periodTooltip(
    { letter: 'η', depth: 7, meanSeconds: 18180, state: stateInfo(13), fineIndex: 0, fineNext: null, majorNext: null, cycleEnd: null, local: 0, siblings: 11, parentLetter: 'ζ', now: T_A, step: -1 },
    fmt,
  );
  assert.equal(normal.lines[0], m.lines[1]);
  assert.equal(normal.hint, m.hint);
  // a depth between two units is said by the units it covers; the follower by the counts that change
  const b = tipAt('bottom', 7);
  assert.equal(b.title, 'θ · depth 8');
  assert.equal(b.aside, 'one cycle = 4ι');
  assert.equal(b.lines[0], '28ι to 31ι in 34η', 'what the clock reads while the θ runs, first to last');
  assert.match(b.lines.at(-2), /^Ends in \S+ \S+ → 32ι begins$/);
  assert.equal(tipAt('bottom', 5).lines[0], '34η to 44η in ε#5', 'a ζ covers eleven Helions, numbered 34 to 44');
  assert.ok(!/depth 7|row/.test(b.hint) && /shorter periods$/.test(b.hint));
  assert.equal(tipAt('top', 7, 'key').hint, 'Enter: select this cycle in every view');
  // the Nuclide by its ordinal in its Delta, which is said in words
  const e = tipAt('top', 5);
  assert.equal(e.lines[0], 'ε#5 of 5 in Delta Trifracton');
  assert.match(e.lines.at(-2), /→ ε#1 of Delta Tetrafracton begins$/, 'the last Nuclide of a Delta is followed by the first of the next Delta');
});

test('pure period tooltip, a major row: name and quarter in words, the quarter that ends next, the Delta that begins', () => {
  const d = tipAt('top', 4); // δ on top
  assert.equal(d.title, 'δ · depth 4');
  assert.equal(d.aside, 'one Delta = 5ε');
  assert.equal(d.lines[0], 'Delta Trifracton End · 3 of 5 in its γ', 'SPEC §15.6: vector A is in the End quarter of the 3rd Delta');
  assert.match(d.lines.at(-2), /^Ends in \d+η \d+ι → Delta Tetrafracton begins$/);
  assert.ok(!d.lines.some((l) => typeof l === 'string' && /^End ends/.test(l)), 'the End quarter ends with the cycle: no separate line');
  const g = tipAt('bottom', 2); // γ below β
  assert.equal(g.lines[0], 'Gamma Nonafracton Valley · 9 of 13 in its β');
  assert.ok(g.lines.some((l) => /^Valley ends in \S+ \S+ → End$/.test(l)), g.lines.join(' / '));
  assert.match(g.lines.at(-2), /→ Gamma Decafracton begins$/);
  const b = tipAt('top', 2);
  assert.equal(b.lines[0], 'Beta Tetrafracton Valley · 4 of 5 in its α');
  // no glyph pair is ever drawn for a major period (its phase follows from the Nuclide and Helion count)
  for (const m of [d, g, b]) assert.ok(m.lines.every((l) => typeof l === 'string'), 'text only');
  // Alpha has no parent: it counts in the catalogue
  const alpha = placeText(pure, 0, model.levelAt(T_A, 0), 'Valley');
  assert.equal(alpha, 'Alpha Hexafracton Valley · 6 of 18 in the catalogue');
});

test('pure period tooltip: the last cycle of a Nuclide is followed by the first of the next one; the catalogue end by nothing', () => {
  const eps = model.levelAt(T_A, 4);
  const t = eps.end - 60; // inside the last Helion of the Nuclide
  const m = pureTooltipModel({ model, pure, frame: model.frame(t), row: 'top', topDepth: 7 });
  assert.equal(m.lines[0], '77η of 77 in ε#5', 'the last Helion of a Nuclide is the 77th');
  assert.match(m.lines.at(-2), /→ ε#1 1η begins$/, 'a new Nuclide: the full placing, from its first Helion');
  const edge = pureTooltipModel({ model, pure, frame: model.frame(model.tMax - 5), row: 'top', topDepth: 7 });
  assert.match(edge.lines.at(-2), /^Ends in .+, with the catalogue$/);
  assert.equal(tipAt('top', 2).hint, 'Click or tap: select this cycle in every view');
  assert.equal(tipAt('bottom', 11).hint, 'Click or tap: select this cycle in every view');
});

test('pure followers say only the counts that change, inside one Nuclide', () => {
  const big = (L) => model.levelAt(T_A, L).cycleBig;
  assert.deepEqual(
    [3, 4, 5, 6, 7, 8, 9, 10, 11].map((L) => followerName(pure, L, big(L))),
    ['Delta Tetrafracton', 'ε#1 of Delta Tetrafracton', '45η', '35η', '32ι', '30ι', '26λ', '22λ', '5ν'],
  );
  // a roll-over of a finer count shows the coarser one that changes with it
  const iota = model.levelAt(T_A, 8);
  const lastIota = iota.cycleBig + BigInt(35 - 29); // the 36th Preon of the Helion
  assert.equal(followerName(pure, 8, lastIota), '35η 0ι');
});

test('pure solar tooltip: sync number, phase as a glyph pair, drift in λ, next quarter and age as ladder spans', () => {
  const s = model.solarAt(T_A);
  const m = tipAt('solar', 7);
  assert.equal(m.title, 'Solar sync #4820');
  assert.equal(m.aside, 'one sync = 19η (19 Helions)');
  assert.equal(m.lines.length, 4);
  assert.ok(typeof m.lines[0] === 'object' && typeof m.lines[0].html === 'string');
  assert.equal((m.lines[0].html.match(/<svg/g) || []).length, 2, 'two glyphs');
  assert.ok(!/<title>|vector CBT/.test(m.lines[0].html), 'no library jargon as a native tooltip (the shared helper strips it)');
  assert.ok(m.lines[0].html.includes('aria-label="phase 5 and 11 of 256"'), 'two digits spoken as two numbers, never "5.11"');
  assert.match(stripTags(m.lines[0].html).replace(/\s+/g, ' '), /^Phase +of this sync$/);
  assert.equal(m.lines[1], `Drift ${pure.driftText(s)} ${DRIFT_REF}`);
  assert.equal(m.lines[2], `Next node ${inText(pure, T_A, s.threshold.time)}`);
  assert.equal(m.lines[3], `Sync began ${pure.between(s.start, T_A)} ago`);
  assert.equal(m.hint, 'Click or tap: info labels · double tap: letters');
  assert.equal(tipAt('solar', 7, 'key').hint, 'Enter: show the info labels · key l: keep the letters');
  const early = pureSolarTooltip({ sync: -3, phase: 0.99999, drift: 5, nominalStart: s.nominalStart, thresholdName: 'end', thresholdTime: T_A + 100, start: T_A - 50, now: T_A }, pure);
  assert.equal(early.title, `Solar sync #${MINUS}3`);
  assert.ok(early.lines[0].html.includes('phase 15 and 15 of 256'));
  const edge = pureTooltipModel({ model, pure, frame: model.frame(model.tMin + 5), row: 'solar', topDepth: 7 });
  assert.deepEqual(edge, { title: 'Solar sync', aside: '', lines: ['The sync around this instant runs past the catalogue, so it is not defined here.'], hint: '' });
  assert.equal(pureTooltipModel({ model, pure, frame: model.frame(model.tMax + 10), row: 'top', topDepth: 7 }), null);
});

test('pure row aria labels: where the cycle sits (words for majors), and the phase pair spoken as two numbers', () => {
  const s = model.solarAt(T_A);
  const solar = pureRowAriaLabel('solar', { sync: s.sync, phase: s.phase, digits: s.digits3 }, pure);
  assert.equal(solar, `Solar sync 4820, phase 5 and 11 of 256, glyphs ${s.digits3.join(', ')}. Activate to show the info labels`);
  assert.doesNotMatch(solar, /percent|%|\d·\d/);
  const lv = model.levelAt(T_A, 6);
  const row = pureRowAriaLabel('top', { letter: 'η', depth: 7, place: placeText(pure, 6, lv), state: stateInfo(13) }, pure);
  assert.equal(row, `η depth 7 · 34η of 77 in ε#5: state 13 of 16, value ${MINUS}3, rising. Activate to select this depth`);
  assert.ok(!/[↗↘]/.test(row));
  const d = pureRowAriaLabel('top', { letter: 'δ', depth: 4, place: placeText(pure, 3, model.levelAt(T_A, 3), 'End'), state: stateInfo(14) }, pure);
  assert.match(d, /^δ depth 4 · Delta Trifracton End · 3 of 5 in its γ: state 14 of 16/);
});

test('pure caption: the short date in words (letters where the words do not fit), the same numbers as the stamp', () => {
  const words = pureCaption(pure, T_A);
  assert.equal(words, 'Delta Trifracton End ε#5 34η 29ι 21λ', 'SPEC §15.6 vector A, down to the Flavons');
  assert.equal(words, pure.dateText(T_A, { upTo: 'lambda' }));
  const letters = pureCaption(pure, T_A, { letters: true });
  assert.equal(letters, 'δ#3 ε#5 34η 29ι 21λ');
  assert.deepEqual(oldSpellings(words), []);
  // the letters are the tail of the stamp: the counts are the same everywhere
  for (const t of [T_A, 946684800.5, 2886085800.25, 125593320.816, model.tMin + 9, model.tMax - 9]) {
    assert.ok(pure.stamp(t, 'lambda').endsWith(pureCaption(pure, t, { letters: true })), `caption @ ${t}`);
    assert.match(pureCaption(pure, t), /^Delta [A-Z][a-z]+fracton (Peak|Node|Valley|End) ε#[1-5] \d+η \d+ι \d+λ$/);
    assert.match(pureCaption(pure, t, { letters: true }), /^δ#[1-5] ε#[1-5] \d+η \d+ι \d+λ$/);
  }
  // the longest caption in words is about 40 characters (the letter form is the fallback for the narrowest cards)
  assert.ok('Delta Pentafracton Valley ε#5 77η 35ι 64λ'.length <= 42);
  assert.equal(pureCaption(pure, model.tMax + 10), '');
  assert.equal(pureCaption(pure, model.tMin - 10), '');
  assert.deepEqual(hardLeaks([{ kind: 'text', text: words, where: 'caption' }, { kind: 'text', text: letters, where: 'caption' }]), []);
  assert.equal(CAPTION_NOTE, `${FROM_ONE} ${GLOSSARY_NOTE}`);
  assert.match(CAPTION_NOTE, /the Helion \(η\) count from 1.*ι λ ν from 0.*Press \? for the glossary\.$/);
  assert.deepEqual(hardLeaks([{ kind: 'attr:title', text: CAPTION_NOTE, where: 'caption' }]), []);
});

test('pure letters, range and texts for states without a reading', () => {
  const name = (L) => letterName(pure, L, model.levelAt(T_A, L).cycleBig);
  assert.deepEqual([1, 2, 3].map(name), ['Beta Tetrafracton', 'Gamma Nonafracton', 'Delta Trifracton'], 'majors in words');
  assert.deepEqual([4, 6, 7, 8].map(name), ['ε#5', 'ε#5 34η', 'ε#5 34η 28ι', 'ε#5 34η 29ι'], 'minors by where they start');
  const r = pureRange(pure);
  assert.deepEqual([r.from, r.to], ['α#1', 'α#18']);
  assert.deepEqual(r.lines, ['outside the', 'catalogue']);
  assert.equal(r.label, 'Fractonica clock face: outside the catalogue, no reading');
  assert.deepEqual([...PURE_SOLAR_NA.lines], ['not defined within', 'one sync of the edge']);
  const items = [...r.lines, `from ${r.from}`, `to ${r.to}`, r.label, PURE_SOLAR_NA.label, ...PURE_SOLAR_NA.lines].map((text) => ({ kind: 'text', text, where: 'oor' }));
  assert.deepEqual(hardLeaks(items), []);
  // the longest name still fits the 192 px screen at 9.5 px (about 5.6 px per letter): majors up to Gamma Tridecafracton,
  // minors down to μ (the bottom row at depth 12)
  const longest = Math.max('Gamma Tridecafracton'.length, 'ε#5 77η 35ι 64λ 20ν'.length);
  assert.ok(longest * 5.6 < 150, `longest name ${longest} letters`);
});

test('pure how-to: the five lines of normal mode, the reading (Helion number and phase, words for Alpha … Delta), numbers from 1 and counts from 0, the glossary', () => {
  const lines = pureHowToLines(pure.pairHTML(13 / 16 + 4 / 256 + 1e-4, { label: 'phase' }));
  assert.deepEqual(lines.map(([k]) => k), ['teal', 'dot', 'pair', 'count', 'units', 'zero', 'gold']);
  const units = lines[4][1];
  assert.match(units, /Helion is the basic reading/);
  assert.match(units, /its number and its phase/);
  assert.match(units, /Preons and Flavons are the fine time/);
  assert.match(units, /Alpha, Beta, Gamma and Delta are said in words with their quarter: Delta Trifracton End/);
  const zero = lines[5][1];
  assert.match(zero, /^<b>Numbers from 1, counts from 0\.<\/b>/);
  assert.match(zero, /34η is the 34th Helion of its Nuclide \(1–77\)/);
  assert.match(zero, /29ι 21λ count the Preons and Flavons completed, from 0/);
  assert.match(lines[6][1], /19η cycles, 19 Helions/);
  assert.doesNotMatch(lines[6][1], /civil|4-day|\bs\b|days|19 η/);
  assert.match(lines[2][1], /16 × 16 = 256 phases/);
  assert.ok(lines[2][1].includes('aria-label="phase 13 and 4 of 256"'));
  assert.equal(pureHowToLines(null).length, 7);
  const items = lines.flatMap(([, html]) => [{ kind: 'text', text: stripTags(html), where: 'howto' }, ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((a) => ({ kind: 'attr:aria-label', text: a[1], where: 'howto' }))]);
  assert.deepEqual(hardLeaks(items), []);
  for (const [, html] of lines) assert.deepEqual(oldSpellings(stripTags(html)), []);
  const howto = sourceOf('../src/ui/face/howto.js');
  assert.match(howto, /19 η cycles ≈ 4 civil days/, 'normal mode keeps its wording');
  assert.match(howto, /Press <span class="kbd">\?<\/span> for the glossary\./);
  assert.match(howto, /glossary\.hidden = !pure/);
  assert.match(howto, /else glossary\.replaceChildren\(\)/, 'normal mode keeps none of it in the DOM');
});

test('the scanner rules would catch a leak in these strings (sanity check of the wiring)', () => {
  const normal = periodTooltip({ letter: 'η', depth: 7, meanSeconds: 18180, state: stateInfo(13), fineIndex: 0, fineNext: T_A + 33, majorNext: T_A + 3372, cycleEnd: T_A + 3372, local: 0, siblings: 11, parentLetter: 'ζ', now: T_A }, fmt);
  assert.ok(hardLeaks(tipItems(normal)).length >= 3, 'clock times and "min" are flagged');
  const sol = model.solarAt(T_A);
  const normalSolar = solarTooltip({ sync: sol.sync, phase: sol.phase, drift: sol.drift, thresholdName: 'node', thresholdTime: sol.threshold.time, start: sol.start, now: T_A }, fmt);
  assert.ok(hardLeaks(tipItems(normalSolar)).some((l) => l.rule === 'percent'));
  assert.ok(hardLeaks([{ kind: 'text', text: 'Eta Difracton', where: 'x' }]).some((l) => l.rule === 'minor-fracton'));
});

test('pure: no tooltip, label, caption or info text of the face leaks an Earth reference or an old spelling (many instants, depths, rows)', () => {
  const instants = [T_A, 946684800, 2886085800, 125593320.816, model.tMin + 5, model.tMax - 5, model.tMin + 4e6, model.tMax - 4e6];
  for (let i = 0; i < 40; i++) instants.push(model.tMin + ((model.tMax - model.tMin) * (i + 0.37)) / 40);
  const items = [];
  const seen = new Set();
  const addAll = (xs) => xs.forEach((x) => seen.has(x.text) || (seen.add(x.text), items.push(x)));
  let tooltips = 0;
  for (const t of instants) {
    const frame = model.frame(t);
    for (const topDepth of [2, 4, 5, 7, 9, 11]) {
      for (const row of ['top', 'bottom', 'solar']) {
        for (const by of ['pointer', 'key']) {
          const m = pureTooltipModel({ model, pure, frame, row, topDepth, by });
          if (m) tooltips++;
          addAll(tipItems(m, `${row}@${t}/d${topDepth}`));
        }
      }
      const lv = levelsFor(topDepth);
      const lTop = frame.level(lv.top);
      let sol = null;
      try {
        sol = frame.solar();
      } catch {
        sol = null;
      }
      const info = pureInfoLabels(pure, t, lTop, sol);
      addAll(['topCap', 'topVal', 'solarCap', 'solarVal', 'syncCap', 'syncVal'].map((k) => ({ kind: 'text', text: info[k], where: `info.${k}` })));
      addAll([{ kind: 'text', text: pureInfoSpeech(info), where: 'speech' }]);
      for (const [kind, L] of [['top', lv.top], ['bottom', lv.bottom]]) {
        const cyc = frame.level(L);
        const od = frame.odometer(L);
        const q = pure.isMajor(L) ? pure.QUARTER_WORDS[Math.min(3, Math.floor(cyc.phase * 4))] : null;
        addAll([{ kind: 'attr:aria-label', text: pureRowAriaLabel(kind, { letter: model.levelInfo(L).letter, depth: L + 1, place: placeText(pure, L, cyc, q), state: stateInfo(od.digits[0]) }, pure), where: 'row' }]);
        addAll([{ kind: 'text', text: letterName(pure, L, cyc.cycleBig), where: 'letters' }]);
      }
    }
    if (model.solarAt(t)) {
      const s = model.solarAt(t);
      addAll([{ kind: 'attr:aria-label', text: pureRowAriaLabel('solar', { sync: s.sync, phase: s.phase, digits: s.digits3 }, pure), where: 'solarrow' }]);
    }
    addAll([{ kind: 'text', text: pureCaption(pure, t), where: 'caption' }]);
    addAll([{ kind: 'text', text: pureCaption(pure, t, { letters: true }), where: 'caption' }]);
  }
  assert.ok(tooltips > 900, `${tooltips} tooltips checked`);
  assert.ok(items.length > 2000, `${items.length} distinct strings checked`);
  assert.deepEqual(hardLeaks(items), []);
  assert.deepEqual(items.flatMap((i) => oldSpellings(i.text)), []);
  const drifts = items.filter((i) => i.where === 'info.syncVal' && i.text !== '—');
  assert.ok(drifts.length > 20, `${drifts.length} drift labels`);
  assert.deepEqual(drifts.filter((i) => !/^drift [−+]?\d{1,3}( \d{3})*λ$/.test(i.text)).map((i) => i.text), []);
  assert.ok(items.some((i) => /^drift 0λ$/.test(i.text)), 'the anchor sync has no drift');
  // spans skip zero units: never "1η 0ι"
  assert.deepEqual(items.filter((i) => /\b(in|Ends in|ends in) [1-9]\d*[αβγδεηιλν] 0[αβγδεηιλν]\b/.test(i.text)).map((i) => i.text), []);
  // no glyph pair speaks for a major row, and no fracton name for a minor one
  assert.deepEqual(items.filter((i) => /^[αβγδ] depth \d+ · .*phase \d+ and/.test(i.text)).map((i) => i.text), []);
  const soft = judge(items, 'soft').filter((l) => l.severity === 'soft');
  for (const l of soft) assert.ok(l.rule === 'year-number' && /Solar sync #|SYNC |Solar sync \d/.test(l.text), `${l.rule}: ${l.text}`);
});

test('the face source keeps the Earth vocabulary out of its pure strings', () => {
  const src = sourceOf('../src/ui/face/pure.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1');
  const strings = [...src.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2]);
  const items = strings.map((text) => ({ kind: 'text', text: text.replace(/\$\{[^}]*\}/g, ' '), where: 'pure.js' }));
  assert.ok(items.length > 30);
  assert.deepEqual(hardLeaks(items), []);
});

test('revisions 2 and 3: no half unit, no "beat", no retired unit name, no minor fracton name anywhere in the face (text or comments)', () => {
  const dir = '../src/ui/face/';
  const files = ['../src/ui/face.js', '../src/styles/face.css', ...readdirSync(new URL(dir, import.meta.url)).map((f) => dir + f)];
  for (const f of files) {
    const src = sourceOf(f);
    assert.doesNotMatch(src, new RegExp(`[αβγδεζηθικλμνξ]${HALF}`), `${f}: a half-cycle unit`);
    assert.doesNotMatch(src, /\bbeats?\b/i, `${f}: the retired word "beat"`);
    assert.doesNotMatch(src, /\b(Hadron|Quark|Chromon|Somon|Atom)s?\b/, `${f}: a retired unit name`);
    assert.doesNotMatch(src, /\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi)\s+\w*fracton\b/, `${f}: a minor fracton name`);
  }
  assert.deepEqual(['η', 'ι', 'λ'].map((s) => pure.unitOf(s).name), ['Helion', 'Preon', 'Flavon']);
  assert.equal(pure.unitName('η', 19), 'Helions');
  // the counts the face quotes are the model's own: a Nuclide is 7 × 11 = 77 Helions, a Helion 9 × 4 = 36 Preons
  assert.equal(model.levelInfo(5).siblings * model.levelInfo(6).siblings, 77);
  assert.equal(model.levelInfo(7).siblings * model.levelInfo(8).siblings, 36);
});
