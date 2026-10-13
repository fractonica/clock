// Pure-mode check of the ladder + up next cards (exit code 1 on any failure):
//   node tools/checks/check-ladder-pure.mjs
//
//  1. Leak scan of everything these two cards can show in pure mode (visible text, attributes, tooltips, select
//     options, aria values, toasts), in many states the generic scanner cannot reach on its own: every selected
//     depth with its expanded details, every row and list item hovered, every importance, the catalogue edges, a
//     clipped last cycle, out-of-range frames, time-lapse speeds, a phone width.
//  2. Live switching in both directions (key P, header button, ?pure=1, store): a round trip leaves exactly the text
//     a fresh load shows, in either mode.
//  3. The pure cards behave like the normal ones (selection, keyboard, Just before / Just after, importance), the
//     vocabulary is revision 3's (SPEC §15: majors α–δ in words with a quarter word and no phase pair, minor cycles by
//     ordinal or count, the depths between the units unnamed), and every glyph pair is the odometer of its cycle at the
//     displayed instant, also right after a time jump that leaves the countdown text unchanged.
//  4. Layout: nothing truncated or overflowing at 1440 / 1100 / 800 / 390 px, rows as compact as normal rows,
//     two glyphs per row, render() cheap.
//
// The generic scanner (tools/pure-scan.mjs) reads the whole page; here everything but the two cards (and their
// tooltips and the toast) is made invisible first, so every leak reported is one of these two cards'.
import { withApp } from '../browse.mjs';
import { installHooks, scan, judge, formatLeaks } from '../pure-scan.mjs';

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}${cond ? '' : '  ' + extra}`);
};
const A = 1791460800; // SPEC vector A
const TMIN = -11253795486;
const TMAX = 28005212035;
const INSTANTS = [
  ['vector A', A],
  ['year 2000', 946684800],
  ['year 2061', 2886085800],
  ['catalogue start', TMIN + 5],
  ['catalogue end', TMAX - 5],
  ['200 s before the end', TMAX - 200],
];
const MASK = 'body{visibility:hidden !important}#slot-ladder,#slot-upnext,.ladder-tip,.upnext-tip,#toast{visibility:visible !important}';

const leaks = [];
const note = (list) => {
  leaks.push(...list.filter((l) => l.severity === 'hard'));
  softs.push(...list.filter((l) => l.severity !== 'hard'));
};
const softs = [];

/** Open a page in a mode, wait until both cards have rendered, and hide everything else. */
async function open(page, url, query, { mask = true } = {}) {
  await page.goto(url(query));
  await ready(page);
  if (mask) await page.addStyleTag({ content: MASK });
}
const ready = async (page) => {
  await page
    .waitForFunction(
      () =>
        document.querySelector('#slot-ladder .ladder-row, #slot-ladder .ladder-note:not([hidden])') &&
        (document.querySelector('#slot-upnext .upnext-hero:not([hidden])') || document.querySelector('#slot-upnext .upnext-empty:not([hidden])')),
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);
};
const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

/** aria-* values (valuetext, labels, descriptions...) of both cards, judged like visible text. */
async function ariaLeaks(page, state) {
  const items = await page.evaluate(() => {
    const out = [];
    const skip = new Set(['aria-hidden', 'aria-selected', 'aria-expanded', 'aria-pressed', 'aria-disabled', 'aria-activedescendant', 'aria-labelledby', 'aria-describedby', 'aria-live', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow']);
    for (const root of document.querySelectorAll('#slot-ladder, #slot-upnext, .ladder-tip, .upnext-tip')) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        for (const a of el.getAttributeNames()) if (a.startsWith('aria-') && !skip.has(a)) out.push({ kind: 'attr:' + a, text: el.getAttribute(a), where: String(el.className?.baseVal ?? el.className ?? '').split(' ')[0] });
      }
    }
    return out;
  });
  return judge(items, state);
}
async function check(page, state) {
  note(await scan(page, state));
  note(await ariaLeaks(page, state));
}

/** Text and attributes of both cards: what a user (or a screen reader) is given. */
const dump = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const id of ['slot-ladder', 'slot-upnext']) {
      const root = document.getElementById(id);
      const attrs = [];
      root.querySelectorAll('*').forEach((el) => {
        for (const a of ['title', 'aria-label', 'aria-valuenow', 'aria-valuemax', 'aria-valuetext', 'aria-selected', 'aria-expanded', 'aria-pressed', 'aria-disabled', 'aria-hidden', 'role', 'hidden', 'disabled']) {
          if (el.hasAttribute(a)) attrs.push(`${typeof el.className === 'string' ? el.className : ''}|${a}=${el.getAttribute(a)}`);
        }
      });
      out[id] = { text: root.innerText, attrs };
    }
    return out;
  });
const st = (page) => page.evaluate(() => ({ t: __fractonica.store.t(), playing: __fractonica.store.playing, live: __fractonica.store.live, rate: __fractonica.store.rate, ...__fractonica.store.state }));
const levelAt = (page, L, t) => page.evaluate(([L, t]) => { const x = __fractonica.model.levelAt(t ?? __fractonica.store.t(), L); return x && { start: x.start, end: x.end, cycle: x.cycle, duration: x.duration }; }, [L, t ?? null]);

/** Stop the app's animation loop (its next frame is swallowed); the page's own requestAnimationFrame keeps working for the scanner. */
const freezeLoop = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = () => 0;
        raf(() => raf(() => raf(() => { window.requestAnimationFrame = raf; resolve(); })));
      }),
  );
/** Render both cards once for a frame at time `t` (outside the catalogue if need be), in the mode the store is in. */
const renderAt = (page, t) =>
  page.evaluate((tt) => {
    const f = __fractonica.model.frame(tt);
    for (const id of ['ladder', 'upnext']) __fractonica.instances[id].render(f, { dirty: true });
  }, t);

/** Move the pointer onto an element the way a user does (leave, then arrive) and wait for its tooltip. */
async function hoverOn(page, locator, tipSel) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await page.mouse.move(Math.max(1, b.x - 6), 1);
  await page.mouse.move(b.x + Math.min(b.width / 2, 120), b.y + Math.min(b.height / 2, 10), { steps: 4 });
  await page.waitForSelector(`${tipSel}:not([hidden])`, { timeout: 2500 }).catch(() => {});
  await frames(page, 2);
}

await withApp(
  async ({ page, url, errors }) => {
    await installHooks(page);
    // every load starts from the defaults: settings (and the importance choice) are persisted per browser profile
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        /* blocked storage: nothing to clear */
      }
    });

    // ======================================================================= 1. leak scan
    for (const [name, t] of INSTANTS) {
      const base = `ladder+upnext @ ${name}`;
      await open(page, url, `?pure=1&t=${t}&view=rings`);
      await check(page, base);
      ok((await page.locator('#slot-ladder.is-pure').count()) === 1 && (await page.locator('#slot-upnext.is-pure').count()) === 1, `${name}: both cards are in pure mode from the first frame (?pure=1)`);

      // every depth selected, with the finest ones listed: the expanded details of each
      await page.evaluate(() => __fractonica.store.set({ minDepth: 1, maxDepth: 14 }));
      for (let sel = 0; sel < 14; sel++) {
        await page.evaluate((s) => __fractonica.store.set({ selectedLevel: s }), sel);
        await frames(page, 4);
        await check(page, `${base} · selected depth ${sel + 1}`);
      }
      await page.evaluate(() => __fractonica.store.set({ selectedLevel: 6, maxDepth: 10 }));

      // every importance
      for (const id of ['γ', 'δ', 'ε', 'ζ', 'η']) {
        await page.evaluate((i) => __fractonica.instances.upnext.setImportance(i), id);
        await frames(page, 4);
        await check(page, `${base} · importance ${id}`);
      }
      await page.evaluate(() => __fractonica.instances.upnext.setImportance('ζ'));
      await frames(page, 3);

      // tooltips: all rows at vector A, a few elsewhere
      const nRows = await page.locator('#slot-ladder .ladder-row').count();
      const rowIdx = name === 'vector A' ? [...Array(nRows).keys()] : [0, 6, nRows - 1];
      for (const i of rowIdx) {
        await hoverOn(page, page.locator('#slot-ladder .ladder-row').nth(i), '.ladder-tip');
        await check(page, `${base} · tooltip of row ${i}`);
        if (name === 'vector A') ok((await page.locator('.ladder-tip:not([hidden])').count()) === 1, `row ${i} shows its tooltip`);
        await page.mouse.move(1, 1);
      }
      const nItems = await page.locator('#slot-upnext .upnext-go').count();
      const itemIdx = name === 'vector A' ? [...Array(nItems).keys()] : nItems ? [0] : [];
      for (const i of itemIdx) {
        await hoverOn(page, page.locator('#slot-upnext .upnext-go').nth(i), '.upnext-tip');
        await check(page, `${base} · tooltip of list item ${i}`);
        await page.mouse.move(1, 1);
      }
      if (name === 'vector A') {
        for (const sel of ['#slot-upnext .upnext-badge', '#slot-upnext [data-act="before"]', '#slot-upnext [data-act="after"]', '#slot-upnext .upnext-strip', '#slot-ladder [data-act="before"]', '#slot-ladder .ladder-more', '#slot-ladder .ladder-sel']) {
          const el = page.locator(sel).first();
          if (!(await el.count())) continue;
          await el.scrollIntoViewIfNeeded();
          const b = await el.boundingBox();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.waitForTimeout(700);
          await check(page, `${base} · dwell on ${sel}`);
        }
        await page.mouse.move(1, 1);
      }
    }

    // keyboard-only text: focus the listbox, move, and read the names the page gives
    await open(page, url, `?pure=1&t=${A}&view=rings&sel=7`);
    await page.locator('#slot-ladder [role=listbox]').focus();
    await page.keyboard.press('ArrowDown');
    await frames(page, 3);
    await check(page, 'keyboard: listbox focused, arrow down');
    const names = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
    ok(names.every((n) => /^[A-Z][a-z]+, depth \d+: /.test(n)), 'every row is named like "Eta, depth 7: ε#5 33η, 1 of 11, phase 13 and 0 of 256, then 34η begins"', names[6]);
    ok(names.every((n) => !/\d·\d/.test(n)), 'no row name spells a pair as "13·0" (read as a decimal number)', names.find((n) => /\d·\d/.test(n)));
    ok(names[6] === 'Eta, depth 7: ε#5 33η, 1 of 11, phase 13 and 0 of 256, then 34η begins', 'the row of the current η says where it starts in its Nuclide and what begins at its end', names[6]);
    ok(names[3] === 'Delta, depth 4: Delta Trifracton, 3 of 5, End quarter, then Delta Tetrafracton begins', 'a major row says its name in words and its quarter, never a phase', names[3]);
    const hint = await page.locator('#ladder-hint').innerText().catch(() => '');
    ok(/0\.00322 Blinks/.test(hint) && /6\.43 Blinks/.test(hint) && !/beats?\b/i.test(hint), 'the keyboard hint counts the leads in Blinks (0.00322 and 6.43), never in beats', hint);
    ok((await page.locator('#slot-upnext [role=progressbar]').getAttribute('aria-valuemax')) === '255' && /^phase \d+ and \d+ of 256$/.test((await page.locator('#slot-upnext [role=progressbar]').getAttribute('aria-valuetext')) ?? ''), 'the hero progress bar reads as a phase of 256 states ("phase 8 and 0 of 256"), not a percentage');

    // time-lapse speeds and live
    await open(page, url, `?pure=1&t=${A}&view=rings`);
    for (const rate of [18188.9, -505.2, 100038.9, 3501360, 1.5e8]) {
      await page.evaluate((r) => __fractonica.store.setRate(r), rate);
      await page.waitForTimeout(450);
      await check(page, `time-lapse ×${rate}`);
    }
    await page.evaluate(() => __fractonica.store.goLive());
    await page.waitForTimeout(500);
    await check(page, 'live');

    // out of range frames and the toast of a last cycle (the clock itself never leaves the catalogue: render the cards a frame outside it)
    for (const [name, t] of [['after the end', TMAX + 10], ['before the start', TMIN - 10]]) {
      await open(page, url, `?pure=1&t=${A}&view=rings`);
      await freezeLoop(page); // the next frames are ours
      await renderAt(page, t);
      await frames(page, 2);
      await check(page, `out of range: ${name}`);
      const note = await page.locator('#slot-ladder .ladder-note').innerText();
      ok(/^Outside the catalogue \(α#1 – α#18\)\./.test(note), `${name}: the ladder says it in pure terms`, note);
      ok((await page.locator('#slot-upnext .upnext-empty').innerText()).startsWith('Outside the catalogue (α#1 – α#18)'), `${name}: up next says it in pure terms`);
      const btn = await page.locator('#slot-ladder .ladder-edge').innerText();
      ok(/^Go to the (start|end) \(α#\d+ β#\d+ γ#\d+ δ#\d+\)$/.test(btn), `${name}: the edge button names the stamp (majors in letters), not a date`, btn);
    }
    await open(page, url, `?pure=1&t=${TMAX - 5}&view=rings&sel=2`);
    await page.locator('#slot-ladder [role=listbox]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await check(page, 'toast of the last cycle');
    const toast = await page.locator('#toast').innerText().catch(() => '');
    ok(/^The last Beta cycle is clipped by the end of the catalogue$/.test(toast), 'the last-cycle toast names the cycle in pure terms', toast);

    // phone width
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, url, `?pure=1&t=${A}&view=rings&sel=3`);
    await page.evaluate(() => __fractonica.store.set({ maxDepth: 14 }));
    await frames(page, 4);
    await check(page, 'phone, depth 4 selected, all depths');
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log(`${leaks.length} hard leak(s) in pure mode`);
    if (leaks.length) console.log(formatLeaks(leaks));
    ok(leaks.length === 0, 'ladder + up next: zero hard leaks in every scanned state');
    const softHits = softs.filter((l) => l.severity === 'soft');
    ok(softHits.length === 0, 'ladder + up next: no soft hits either (no "Saros", no 4-digit numbers)', formatLeaks(softHits, { soft: true }).slice(0, 600));

    // ======================================================================= 2. live switching
    const settle = async () => { await frames(page, 4); await page.waitForTimeout(150); };
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&pure=0`));
    await ready(page);
    const normal1 = await dump(page);
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&pure=1`));
    await ready(page);
    const pure1 = await dump(page);
    ok(JSON.stringify(normal1) !== JSON.stringify(pure1), 'the two modes really differ');
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&pure=0`));
    await ready(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('p');
    await settle();
    ok(JSON.stringify(await dump(page)) === JSON.stringify(pure1), 'key P: normal -> pure shows exactly what a fresh pure load shows');
    await page.keyboard.press('p');
    await settle();
    ok(JSON.stringify(await dump(page)) === JSON.stringify(normal1), 'key P again: pure -> normal leaves exactly what a fresh normal load shows (nothing pure left behind)');
    ok(!(await page.evaluate(() => document.querySelector('#slot-ladder .ladder-q').hasAttribute('title') || document.querySelector('#slot-ladder .ladder-through-t').hasAttribute('aria-hidden'))), 'normal mode after a pure round trip: no pure title or aria-hidden left on the details');
    await page.click('#btn-pure');
    await settle();
    ok(JSON.stringify(await dump(page)) === JSON.stringify(pure1), 'header button: normal -> pure');
    await page.click('#btn-pure');
    await settle();
    ok(JSON.stringify(await dump(page)) === JSON.stringify(normal1), 'header button: pure -> normal');
    // with other states in play: another selection, all depths, an open tooltip, a different importance
    await page.evaluate(() => { __fractonica.store.set({ maxDepth: 14, selectedLevel: 11 }); __fractonica.instances.upnext.setImportance('η'); });
    await settle();
    const normal2 = await dump(page);
    await hoverOn(page, page.locator('#slot-ladder .ladder-row').nth(3), '.ladder-tip');
    await page.keyboard.press('p');
    await settle();
    const tipsAfter = await page.evaluate(() => [...document.querySelectorAll('.ladder-tip, .upnext-tip')].filter((x) => !x.hidden).map((x) => x.innerText));
    ok(tipsAfter.every((x) => !/%|\bUTC\b|\bUnix\b/.test(x)), 'a tooltip open while switching never shows normal text in pure mode', JSON.stringify(tipsAfter));
    await page.mouse.move(1, 1);
    await page.evaluate(() => __fractonica.store.set({ pure: false }));
    await settle();
    ok(JSON.stringify(await dump(page)) === JSON.stringify(normal2), 'store.set({pure:false}): back to exactly the normal text (all depths, depth 12 selected, importance α–η)');
    await page.evaluate(() => __fractonica.store.set({ pure: true }));
    await settle();
    await check(page, 'pure again after a round trip (all depths, depth 12 selected)');
    // out of range while switching (stub the loop, render a frame outside the catalogue in each mode)
    await freezeLoop(page);
    await page.evaluate(() => __fractonica.store.set({ pure: false }));
    await renderAt(page, TMAX + 10);
    ok(/Saros 141 catalogue \(1613–2857\)/.test(await page.locator('#slot-ladder .ladder-note').innerText()), 'out of range, normal mode: the normal note');
    await page.evaluate(() => __fractonica.store.set({ pure: true }));
    await renderAt(page, TMAX + 10);
    ok(/^Outside the catalogue \(α#1 – α#18\)/.test(await page.locator('#slot-ladder .ladder-note').innerText()), 'out of range, switched to pure: the pure note replaces it');
    await page.evaluate(() => __fractonica.store.set({ pure: false }));
    await renderAt(page, TMAX + 10);
    ok(/Saros 141 catalogue \(1613–2857\)/.test(await page.locator('#slot-ladder .ladder-note').innerText()) && /Saros 141 catalogue/.test(await page.locator('#slot-upnext .upnext-empty').innerText()), 'out of range, switched back: the normal texts return');

    // ======================================================================= 3. behaviour in pure mode
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    ok((await page.locator('#slot-ladder [role=option]').count()) === 10, 'pure: ladder lists depths 1..10');
    ok((await page.locator('#slot-ladder #ladder-opt-6.is-selected .ladder-detail').count()) === 1, 'pure: the detail panel sits in the selected row');
    const rowText = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) => rows.map((r) => [r.querySelector('.ladder-count').textContent, r.querySelector('.ladder-left').textContent, r.querySelectorAll('.ladder-glyph svg').length, r.querySelectorAll('.ladder-glyph .ladder-qpips i').length, r.querySelectorAll('.ladder-glyph .ladder-qpips i.is-cur').length]));
    ok(JSON.stringify(rowText.map((r) => r[0])) === JSON.stringify(['Hexafracton Valley', 'Tetrafracton Valley', 'Nonafracton Valley', 'Trifracton End', 'ε#5', '33η', '33η', '28ι', '29ι', '13λ']), 'pure: majors read ordinal + quarter word, minors their ordinal or placing count (SPEC §15.6, vector A)', JSON.stringify(rowText.map((r) => r[0])));
    ok(rowText[6][1] === '6ι 43λ', 'pure: η has 6ι 43λ left (SPEC §15.6: 3 372.428 s)', rowText[6][1]);
    ok(rowText.slice(0, 4).every((r) => r[2] === 0 && r[3] === 4 && r[4] === 1), 'pure: major rows (α–δ) draw no phase pair, but four quarter pips with one lit', JSON.stringify(rowText.slice(0, 4)));
    ok(rowText.slice(4).every((r) => r[2] === 2 && r[3] === 0), 'pure: every minor row ends in a pair of glyphs (two 2-stroke glyphs = 256 states)', JSON.stringify(rowText.slice(4)));
    ok(rowText.every((r) => r[1].split(' ').length <= 2 && !/ 0\D+$/u.test(r[1])), 'pure: rows count down in two parts at most, zero tails dropped', JSON.stringify(rowText.map((r) => r[1])));
    ok((await page.locator('#slot-ladder .ladder-pct').evaluateAll((els) => els.every((e) => getComputedStyle(e).display === 'none'))), 'pure: no percentage cell is shown');
    ok((await page.locator('#slot-ladder .ladder-end-v').innerText()) === '→ 34η begins', 'pure: the end is "→ 34η begins"');
    ok((await page.locator('#slot-ladder .ladder-cyc-n').innerText()) === 'ε#5 33η' && (await page.locator('#slot-ladder .ladder-cyc-a').innerText()) === 'α#6 β#4 γ#9 δ#3 ε#5 33η', 'pure: the detail names the cycle by where it starts, and its letter address');
    ok((await page.locator('#slot-ladder .ladder-sector-t').innerText()) === '28ι · 8 of 9', 'pure: the sector is the child cycle, placed by its count', await page.locator('#slot-ladder .ladder-sector-t').innerText());
    ok((await page.locator('#slot-ladder .ladder-length').innerText()) === '1η' && (await page.locator('#slot-ladder .ladder-length').getAttribute('title')) === 'A Helion (η) is 36ι.', 'pure: the length is one unit, its tooltip says what the unit holds');
    ok(/^\d+·\d+$/.test(await page.locator('#slot-ladder .ladder-through-t').innerText()) && (await page.locator('#slot-ladder .ladder-through-p svg').count()) === 2, 'pure: the phase is a glyph pair with its two digits');
    ok(/^phase \d+ and \d+ of 256$/.test((await page.locator('#slot-ladder .ladder-through-p .pure-pair').getAttribute('aria-label')) ?? '') && (await page.locator('#slot-ladder .ladder-through-t').getAttribute('aria-hidden')) === 'true', 'pure: the detail pair is named by pure.pairHTML ("phase 13 and 0 of 256") and its digits are not read twice');
    ok((await page.locator('#slot-ladder .ladder-q').getAttribute('title')) === 'Where each quarter ends: ordinals (ε#2) count from 1, counts (19η) are completed units from 0. Press ? for the glossary.', 'pure: the quarter list says how its readings count');
    const qTimes = await page.locator('#slot-ladder .ladder-q-time').allInnerTexts();
    ok(JSON.stringify(qTimes) === JSON.stringify(['33η 9ι', '33η 18ι', '33η 27ι', '34η 0ι']), 'pure: the quarters of an η are placed by counts (33η 9ι … 34η 0ι)', JSON.stringify(qTimes));
    // a major selected: the quarter word stands for the phase, the sector is a major in words with its quarter, no pair anywhere
    await page.locator('#ladder-opt-3').click();
    await frames(page, 3);
    const majorDetail = await page.evaluate(() => {
      const d = document.querySelector('#slot-ladder .ladder-detail');
      return {
        k: d.querySelector('.ladder-through-k').textContent,
        through: d.querySelector('.ladder-through-t').textContent,
        pips: d.querySelectorAll('.ladder-through-q:not([hidden]) i').length,
        pairs: d.querySelectorAll('.ladder-through-p svg').length,
        sector: d.querySelector('.ladder-sector-t').textContent,
        sectorPairs: d.querySelectorAll('.ladder-sector-p svg').length,
        cyc: d.querySelector('.ladder-cyc-n').textContent,
        end: d.querySelector('.ladder-end-v').textContent,
        q: [...d.querySelectorAll('.ladder-q-time')].map((e) => e.textContent),
        len: d.querySelector('.ladder-length').getAttribute('title'),
      };
    });
    ok(majorDetail.k === 'Quarter' && majorDetail.through === 'End · 4 of 4' && majorDetail.pips === 4 && majorDetail.pairs === 0, 'pure: a Delta shows its quarter word and pips instead of a phase pair', JSON.stringify(majorDetail));
    ok(majorDetail.sector === 'ε#5 · 5 of 5' && majorDetail.sectorPairs === 2 && majorDetail.cyc === 'Delta Trifracton' && majorDetail.end === '→ Delta Tetrafracton begins', 'pure: its sector is the Nuclide (a minor cycle: a pair), the end names the next Delta in words', JSON.stringify(majorDetail));
    ok(JSON.stringify(majorDetail.q) === JSON.stringify(['ε#2 19η', 'ε#3 38η', 'ε#4 57η', 'ε#1 0η']) && majorDetail.len === 'A Delta (δ) is 5ε.', 'pure: a Delta\'s quarters are placed to the Helion', JSON.stringify(majorDetail));
    await page.locator('#ladder-opt-2').click();
    await frames(page, 3);
    const gammaSector = await page.evaluate(() => [document.querySelector('#slot-ladder .ladder-sector-t').textContent, document.querySelectorAll('#slot-ladder .ladder-detail .ladder-sector-p svg').length]);
    ok(gammaSector[0] === 'Delta Trifracton End · 3 of 5' && gammaSector[1] === 0, 'pure: a Gamma\'s sector is a Delta in words with its quarter, no pair', JSON.stringify(gammaSector));
    await page.locator('#ladder-opt-6').click();
    await frames(page, 3);
    // the phase pair of a row agrees with the exact model
    const pairOk = await page.evaluate(() => {
      const t = __fractonica.store.t();
      return [...document.querySelectorAll('#slot-ladder .ladder-row')].every((r) => {
        const L = Number(r.dataset.level);
        const lv = __fractonica.model.levelAt(t, L);
        const o = __fractonica.model.odometerAt(t, L, { strokes: 2, digits: 2 });
        const label = r.getAttribute('aria-label');
        if (r.querySelector('.is-still')) return label.includes('too fast to follow');
        if (L <= 3) return label.includes(`${['Peak', 'Node', 'Valley', 'End'][Math.min(3, Math.floor(lv.phase * 4))]} quarter`) && !label.includes(' of 256');
        return label.includes(`phase ${o.digits[0]} and ${o.digits[1]} of 256`) || label.includes(`phase ${o.digits[0]} of 16`);
      });
    });
    ok(pairOk, 'pure: every row announces the phase the odometer of its cycle shows');

    // the glyph pair of every row (and of the open detail) is the odometer at the displayed instant: paused, jumping
    // between instants a few states apart (the countdown text of the fast rows often does not change), at every depth
    await page.evaluate(() => { __fractonica.store.set({ maxDepth: 14, selectedLevel: 11 }); __fractonica.store.pause(); });
    const pairsNow = () =>
      page.evaluate(() => {
        const t = __fractonica.store.t();
        const bad = [];
        const want = (L) => {
          const d = __fractonica.model.odometerAt(t, L, { strokes: 2, digits: 2 }).digits;
          return `phase ${d[0]} and ${d[1]} of 256`;
        };
        for (const r of document.querySelectorAll('#slot-ladder .ladder-row')) {
          const L = Number(r.dataset.level);
          if (L <= 3) {
            // a major period: no pair, the lit pip is its quarter
            const q = Math.min(3, Math.floor(__fractonica.model.levelAt(t, L).phase * 4));
            const pips = [...r.querySelectorAll('.ladder-qpips i')].map((i) => i.className);
            if (r.querySelector('.pure-pair') || pips.indexOf('is-cur') !== q) bad.push(`depth ${L + 1}: pips ${pips} for quarter ${q}`);
            continue;
          }
          const got = r.querySelector('.ladder-glyph .pure-pair')?.getAttribute('aria-label') ?? '(none)';
          if (got !== want(L)) bad.push(`depth ${L + 1}: shows "${got}", odometer "${want(L)}"`);
        }
        const sel = __fractonica.store.state.selectedLevel;
        const det = document.querySelector('#slot-ladder .ladder-through-p .pure-pair')?.getAttribute('aria-label');
        if (det !== want(sel)) bad.push(`detail of depth ${sel + 1}: shows "${det}", odometer "${want(sel)}"`);
        return bad;
      });
    let seed = 20260811;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const jumpBad = [];
    let jumps = 0;
    for (let i = 0; i < 60; i++) {
      const base = TMIN + 1e6 + rnd() * (TMAX - TMIN - 2e6);
      for (const dt of [0, 0.02, 0.11, 0.3, 1.7]) {
        await page.evaluate((t) => __fractonica.store.setTime(t), Math.round((base + dt) * 1000) / 1000);
        await frames(page, 2);
        jumps++;
        jumpBad.push(...(await pairsNow()).slice(0, 2));
      }
    }
    ok(jumpBad.length === 0, `pure: after ${jumps} jumps every pair is the odometer at the displayed instant (fast rows included)`, jumpBad.slice(0, 4).join(' | '));
    await page.evaluate(() => __fractonica.store.set({ maxDepth: 10, selectedLevel: 7 }));

    // selection, keyboard, navigation
    await page.locator('#ladder-opt-5').click();
    ok((await st(page)).selectedLevel === 5, 'pure: click selects the row');
    await page.locator('#slot-ladder [role=listbox]').focus();
    await page.keyboard.press('ArrowDown');
    ok((await st(page)).selectedLevel === 6, 'pure: arrow down selects the next depth');
    await page.keyboard.press('ArrowDown');
    let before = await levelAt(page, 7);
    await page.keyboard.press('Enter');
    let s = await st(page);
    ok(Math.abs(s.t - (before.end + 0.001)) < 2e-3 && !s.live, 'pure: Enter goes 1 ms into the next cycle', `${s.t} vs ${before.end}`);
    before = await levelAt(page, 7);
    await page.keyboard.press('Shift+Enter');
    s = await st(page);
    ok(Math.abs(s.t - (before.end - 2)) < 1 && s.playing && s.rate === 1, 'pure: Shift+Enter lands 2 s before the end and plays in real time', `${s.t - before.end} ${JSON.stringify(s)}`);
    await page.evaluate(() => __fractonica.store.pause());
    // up next
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    const ev = await page.evaluate(() => __fractonica.instances.upnext.events.map((e) => ({ time: e.time, top: e.top, key: e.key })));
    ok(ev.length === 8, 'pure: eight turnovers are listed');
    await page.locator('#slot-upnext [data-act="after"]').click();
    s = await st(page);
    ok(Math.abs(s.t - (ev[0].time + 0.001)) < 2e-3, 'pure: hero Just after goes 1 ms into the next cycle', `${s.t} vs ${ev[0].time}`);
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    await page.locator('#slot-upnext [data-act="before"]').click();
    s = await st(page);
    ok(Math.abs(s.t - (ev[0].time - 2)) < 1 && s.rate === 1 && s.playing, 'pure: hero Just before lands 2 s ahead and plays', JSON.stringify(s));
    await page.evaluate(() => __fractonica.store.pause());
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    await page.locator('#slot-upnext .upnext-go').nth(2).click();
    s = await st(page);
    ok(Math.abs(s.t - (ev[3].time + 0.001)) < 2e-3, 'pure: a list row goes just after its turnover', `${s.t} vs ${ev[3].time}`);
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    await page.locator('#slot-upnext .upnext-pre').nth(1).click();
    s = await st(page);
    ok(Math.abs(s.t - (ev[2].time - 2)) < 1 && s.rate === 1, 'pure: a row arrow goes just before its turnover', JSON.stringify(s));
    await page.evaluate(() => __fractonica.store.pause());
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    const heroText = await page.locator('#slot-upnext .upnext-hero').innerText();
    ok(/^NEXT MAJOR TURNOVER/i.test(heroText) && /in\s+10η 6ι \d+λ/.test(heroText) && /→ 44η begins/.test(heroText) && /α#6 β#4 γ#9 δ#3 ε#5 44η/.test(heroText) && /4 finer cycles \(η, θ, ι, κ\) end with it\./.test(heroText) && /began \d+ι \d+λ ago/.test(heroText), 'pure: the hero reads "in 10η 6ι 43λ · → 44η begins · address · began … ago" (three units at most)', heroText);
    const listText = await page.locator('#slot-upnext .upnext-list').innerText();
    ok(/55η/.test(listText) && /Delta Tetrafracton/.test(listText) && !/(?:Zeta|Eta) \w*fracton/.test(listText), 'pure: list rows carry what begins (majors in words, minors by count)', listText);
    // wide card (stacked full width): the short letter date of a turnover, δ#3 ε#5 55η, as pure.dateText writes it
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    const clocks = await page.locator('#slot-upnext .upnext-clock').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.textContent));
    ok(clocks.length >= 5 && clocks.every((c) => /^δ#\d+ ε#\d+ \d+η$/.test(c)), 'pure: the list rows of a wide card carry the short letter date (δ#3 ε#5 55η)', JSON.stringify(clocks));
    const headsWide = await page.locator('#slot-upnext .upnext-grp').evaluateAll((els) => els.filter((e) => e.getClientRects().length).length);
    ok(headsWide === 0, 'pure: a wide card writes the counters on every row and shows no group headings', String(headsWide));
    const stripText = await page.locator('#slot-upnext .upnext-strip').innerText();
    ok(/in 6ι \d+λ/.test(stripText) && /at 34η 0ι$/.test(stripText.trim()), 'pure: the strip tells a span ("in 6ι 43λ") and, apart, where the threshold falls ("at 34η 0ι")', stripText);
    // a major level selected: the strip says which quarter begins, never where in counts
    await page.evaluate(() => __fractonica.store.set({ selectedLevel: 3 }));
    await frames(page, 3);
    const stripMajor = [(await page.locator('#slot-upnext .upnext-strip').innerText()).replace(/\s+/g, ' ').trim(), await page.locator('#slot-upnext .upnext-strip').getAttribute('title')];
    ok(/next end in 43η 6ι → Peak$/.test(stripMajor[0]) && /^Just after: Delta Trifracton ends and Delta Tetrafracton begins;/.test(stripMajor[1]), 'pure: a Delta\'s strip says "→ Peak" and its title names the turnover in words', JSON.stringify(stripMajor));
    await page.evaluate(() => __fractonica.store.set({ selectedLevel: 2 }));
    await frames(page, 3);
    const stripGamma = (await page.locator('#slot-upnext .upnext-strip').innerText()).replace(/\s+/g, ' ').trim();
    ok(/next end in \d+δ \d+η → Peak$/.test(stripGamma) || /next \w+ in .+ → (Node|Valley|End)$/.test(stripGamma), 'pure: a Gamma\'s strip names the quarter that begins', stripGamma);
    await page.evaluate(() => __fractonica.store.set({ selectedLevel: 6 }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    ok((await page.locator('#slot-upnext .upnext-pct svg').count()) === 2, 'pure: the hero progress caption ends in a glyph pair');
    // importance chips and their legend
    await page.locator('#slot-upnext .upnext-imp [data-id="γ"]').click();
    await frames(page, 4);
    ok((await page.locator('#slot-upnext .upnext-cap').innerText()) === 'Counting α–γ turnovers · a Gamma (γ) is 5δ', 'pure: the legend says what a cycle of the finest counted depth holds', await page.locator('#slot-upnext .upnext-cap').innerText());
    // a major turnover in the hero: the caption gives its quarter word, never a pair
    const heroMajor = await page.evaluate(() => ({ when: document.querySelector('#slot-upnext .upnext-when-v').textContent, pct: document.querySelector('#slot-upnext .upnext-pct').textContent, svgs: document.querySelectorAll('#slot-upnext .upnext-pct svg').length, vt: document.querySelector('#slot-upnext [role=progressbar]').getAttribute('aria-valuetext') }));
    ok(/^→ Gamma [A-Z][a-z]+fracton begins$/.test(heroMajor.when) && /^(Peak|Node|Valley|End) quarter$/.test(heroMajor.pct) && heroMajor.svgs === 0 && /^(Peak|Node|Valley|End) quarter of Gamma [A-Z][a-z]+fracton$/.test(heroMajor.vt), 'pure: a Gamma turnover in the hero: "→ Gamma … begins", the quarter word instead of a pair', JSON.stringify(heroMajor));
    await page.locator('#slot-upnext .upnext-imp [data-id="ζ"]').click();
    await frames(page, 3);
    ok((await page.locator('#slot-upnext .upnext-cap').innerText()) === 'Counting α–ζ turnovers · a ζ cycle is 11η, not a unit', 'pure: the legend says a depth between the units is a count of the next one', await page.locator('#slot-upnext .upnext-cap').innerText());
    ok(/A ζ cycle is 11η, not a unit\./.test((await page.locator('#slot-upnext .upnext-imp [data-id="ζ"]').getAttribute('title')) ?? '') && /A Helion \(η\) is 36ι\./.test((await page.locator('#slot-upnext .upnext-imp [data-id="η"]').getAttribute('title')) ?? ''), 'pure: the importance buttons explain their cycles');
    ok((await page.locator('#slot-upnext .upnext-pct svg').count()) === 2, 'pure: a minor turnover in the hero shows the phase pair again');
    // η turnovers come several to a Nuclide: groups of two or more are headed by the Nuclide in words on the narrow card
    await page.locator('#slot-upnext .upnext-imp [data-id="η"]').click();
    await frames(page, 4);
    const heads = await page.locator('#slot-upnext .upnext-grp').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.textContent));
    ok(heads.length >= 1 && heads.every((h) => /^Delta [A-Z][a-z]+fracton ε#\d$/.test(h)), 'pure: a group of several events is headed by its Nuclide in words (Delta Trifracton ε#5)', JSON.stringify(heads));
    const sepsOk = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#slot-upnext .upnext-item')];
      // a heading sits on the first row of its group, never on a row that continues one
      return items.every((li, i) => !li.querySelector('.upnext-grp:not([hidden])') || i === 0 || li.classList.contains('is-newday'));
    });
    ok(sepsOk, 'pure: a heading only on the first row of a group (a separator line precedes it)');
    await page.locator('#slot-upnext .upnext-imp [data-id="ζ"]').click();

    // ======================================================================= 4. layout and cost
    for (const [w, h] of [[1440, 900], [1100, 900], [800, 900], [390, 844], [360, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const q of [`?t=${A}&view=rings&pure=1&sel=7`, `?t=${A}&view=rings&pure=1&sel=3`, `?t=${TMAX - 200}&view=rings&pure=1&sel=7`]) {
        await page.goto(url(q));
        await ready(page);
        await page.evaluate(() => __fractonica.store.set({ maxDepth: 14 }));
        await frames(page, 4);
        const bad = await page.evaluate(() => {
          const out = [];
          for (const root of document.querySelectorAll('#slot-ladder, #slot-upnext')) {
            if (root.scrollWidth > root.clientWidth + 1) out.push(`${root.id} overflows: ${root.scrollWidth} > ${root.clientWidth}`);
            for (const el of root.querySelectorAll('*')) {
              if (!el.getClientRects().length || el.closest('svg') || el.closest('.sr-only')) continue;
              const cs = getComputedStyle(el);
              if (!(cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden' || cs.overflowX === 'hidden')) continue;
              if (el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) out.push(`truncated ${el.className}: "${el.textContent.trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`);
            }
            for (const el of root.querySelectorAll('.ladder-row, .upnext-item, .ladder-detail, .upnext-hero')) {
              if (!el.getClientRects().length) continue;
              const r = el.getBoundingClientRect();
              const p = root.getBoundingClientRect();
              if (r.right > p.right + 1 || r.left < p.left - 1) out.push(`${el.className} sticks out of its card by ${Math.round(Math.max(r.right - p.right, p.left - r.left))} px`);
            }
          }
          if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${innerWidth}`);
          return out;
        });
        ok(bad.length === 0, `${w}px ${q.slice(q.indexOf('sel='), q.indexOf('sel=') + 5)} ${q.includes(String(TMAX - 200)) ? '(end)' : ''}: nothing truncated, nothing overflows`, bad.slice(0, 4).join(' | '));
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // rows as compact as the normal ones
    const heights = {};
    for (const pureFlag of [0, 1]) {
      await page.goto(url(`?t=${A}&view=rings&pure=${pureFlag}&sel=7&zone=UTC`));
      await ready(page);
      heights[pureFlag] = await page.evaluate(() => [...document.querySelectorAll('#slot-ladder .ladder-row:not(.is-selected)')].map((r) => Math.round(r.getBoundingClientRect().height)));
    }
    ok(heights[1].every((h, i) => Math.abs(h - heights[0][i]) <= 2), 'pure rows are as high as normal rows (compact)', `${heights[0]} vs ${heights[1]}`);

    // render cost in pure mode, under a time-lapse (the worst case: texts change every frame)
    await page.goto(url(`?t=${A}&view=rings&pure=1&sel=7`));
    await ready(page);
    await page.evaluate(() => { __fractonica.store.set({ maxDepth: 14 }); __fractonica.store.setRate(3600); });
    await frames(page, 6);
    const cost = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const out = {};
          for (const id of ['ladder', 'upnext']) {
            const inst = __fractonica.instances[id];
            const orig = inst.render;
            out[id] = [];
            inst.render = (f, i) => {
              const t0 = performance.now();
              orig(f, i);
              out[id].push(performance.now() - t0);
            };
            inst.__orig = orig;
          }
          setTimeout(() => {
            for (const id of ['ladder', 'upnext']) __fractonica.instances[id].render = __fractonica.instances[id].__orig;
            resolve(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) }])));
          }, 2500);
        }),
    );
    console.log('render cost (pure, 14 rows, ×3600):', JSON.stringify(cost));
    ok(cost.ladder.avg < 3 && cost.upnext.avg < 3, 'pure render() stays cheap (< 3 ms on average)', JSON.stringify(cost));

    const mine = errors.filter((e) => /\[(ladder|upnext)\]|ui\/ladder|ui\/upnext|ladder\.css|pure-text/.test(e));
    ok(mine.length === 0, 'no console errors from these modules', mine.join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall ladder + up next pure checks passed');
process.exit(failures ? 1 : 0);
