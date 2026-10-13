// Pure-mode check for the calendar tab and the header jump box (headless Chromium).
//   node tools/checks/check-calendar-pure.mjs [--soft] [--shots]
//
// Revision 3 of pure mode (SPEC §15): major periods in words with quarter words, the Nuclide and counts of Helions,
// Preons, Flavons and Blinks; one page = one Delta = 5 Nuclide rows x 7 columns of 11 Helions. 1. Leak scan: the shared scanner (tools/pure-scan.mjs) over the pure converter, the pure δ page and the jump box in
//    states it cannot reach by itself: open glyph picker, typed errors in every field, every jump-box input class
//    (names, addresses, stamps, offsets, boundaries, glyph states, Earth input, errors, examples, history), tooltips of
//    cells / η bands / sync marks / ribbon, keyboard-only tooltips, toasts, out-of-range moments, phone width.
//    Only leaks that belong to this module (cal- / jump- / its toasts and tips) fail the run.
// 2. Behaviour: counters, stamp field, address steppers, picker, sync, page navigation, cell clicks, jump box.
// 3. Live switching in both directions: nothing pure is left in the normal mode and nothing Earth-ish in pure mode.
import { withApp } from '../browse.mjs';
import { installHooks, scan, hoverSweep, hoverInteractive, formatLeaks } from '../pure-scan.mjs';

const soft = process.argv.includes('--soft');
const shots = process.argv.includes('--shots');
// --only=tab,converter,page,jump,live runs just those sections (default: all)
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const has = (name) => !only.length || only.includes(name);
const T = 1791460800; // SPEC vector A
const MINE = /(^|[\s.#])(cal-|jump-)|#toast|#slot-jump|\.tip\b/;
let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('  FAIL', msg);
  } else console.log('  ok  ', msg);
};
const all = [];
const note = (leaks) => {
  all.push(...leaks);
};

await withApp(
  async ({ page, url, errors, shot }) => {
    await installHooks(page);
    const t = () => page.evaluate(() => window.__fractonica.store.t());
    const jump = page.locator('.jump-input');
    const view = () => page.evaluate(() => window.__fractonica.instances.calendar.monthView);
    const goto = async (q) => {
      await page.goto(url(q));
      await page.waitForTimeout(700);
    };

    // ---------------------------------------------------------------- the pure tab at several instants
    if (has('tab')) {
    const INSTANTS = [
      ['vector A', T],
      ['year 2000', 946684800],
      ['year 2061', 2886085800],
      ['catalogue start', -11253795486 + 5],
      ['catalogue end', 28005212035 - 5],
      ['beyond the end', 28005212035 + 10],
      ['before the start', -11253795486 - 10],
    ];
    console.log('pure tab at several instants');
    for (const [name, tt] of INSTANTS) {
      await goto(`?pure=1&t=${tt}&view=calendar`);
      note(await scan(page, `calendar @ ${name}`));
      if (shots && name === 'vector A') await shot('calpure-A.png');
    }

    console.log('pure tab: tooltips and hover');
    await goto(`?pure=1&t=${T}&view=calendar`);
    const box = await page.locator('.cal-pmonth').boundingBox();
    note(await hoverSweep(page, 'page', { cols: 10, rows: 8, dwell: 50, box }));
    note(await hoverInteractive(page, 'page', { limit: 40, dwell: 150 }));
    const cbox = await page.locator('.cal-pconv').boundingBox();
    note(await hoverSweep(page, 'converter', { cols: 8, rows: 8, dwell: 50, box: { x: cbox.x, y: Math.max(0, cbox.y), width: cbox.width, height: Math.min(cbox.height, 900) } }));

    // the η band, a sync mark, an eclipse cell, the ribbon
    for (const sel of ['.cal-pm-seg', '.cal-pm-s', '.cal-rm', '.cal-pm-day']) {
      const loc = page.locator(sel).nth(3);
      if (await loc.count()) {
        await loc.hover({ force: true });
        await page.waitForTimeout(160);
        note(await scan(page, `hover ${sel}`));
      }
    }
    // keyboard-only tooltips: focus the grid and walk it
    await page.keyboard.press('Tab');
    await page.locator('.cal-pm-day[tabindex="0"]').focus();
    for (const key of ['ArrowRight', 'ArrowDown', 'End', 'Home', 'ArrowUp']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
      note(await scan(page, `grid key ${key}`));
    }
    }

    // ---------------------------------------------------------------- converter: typed errors, picker, depth, point, sync
    if (has('converter')) {
    console.log('pure converter: errors, picker, depth chips, point selector, sync');
    await goto(`?pure=1&t=${T}&view=calendar`);
    // behaviour first: every field edits the one moment
    {
      const conv = () => page.evaluate(() => window.__fractonica.instances.calendar.converterTime);
      const stampNow = () => page.evaluate(() => window.__fractonica.ctx.pure.stamp(window.__fractonica.instances.calendar.converterTime, 'lambda'));
      const field = (label) => page.locator(`.cal-pconv [aria-label="${label}"]`).first();
      ok(Math.abs((await conv()) - (await t())) < 1, 'unpinned, the converter follows the shown moment');
      await field('Stamp or name').fill('Gamma Difracton');
      await field('Stamp or name').press('Enter');
      await page.waitForTimeout(250);
      ok(/^α#6 β#4 γ#2 δ#1 ε#1 0η 0ι 0λ$/.test(await stampNow()), `a name sets the moment: ${await stampNow()}`);
      ok((await page.locator('.cal-pconv .cal-pin').getAttribute('aria-pressed')) === 'true', 'an edit pins the converter');
      ok(/α#6 β#4 γ#2/.test(await field('Stamp or name').inputValue()), 'the stamp field shows the new moment');
      ok(Math.abs((await t()) - T) < 1, 'the app itself did not move until Apply');
      // the Nuclide: + moves by one Nuclide; the counts are typed
      const c0 = await conv();
      await page.locator('.cal-pconv .cal-cstep').first().locator('button').nth(1).click();
      await page.waitForTimeout(200);
      ok(/δ#1 ε#2 0η/.test(await stampNow()), `ε + 1: ${await stampNow()}`);
      ok((await conv()) > c0, 'the counter moved the moment forward');
      await field('Helion count, 0 to 76').fill('40');
      await page.waitForTimeout(250);
      ok(/ε#2 40η/.test(await stampNow()), 'typing a Helion count sets it: ' + (await stampNow()));
      // a major period by its fracton name: the Delta select, with the quarter word beside it
      await page.selectOption('.cal-pconv select[aria-label="Delta of this moment, by its fracton name"]', '4');
      await page.waitForTimeout(250);
      ok(/δ#4 ε#2 40η/.test(await stampNow()), 'the Delta picker sets δ#4 and keeps what is finer: ' + (await stampNow()));
      const quarters = await page.locator('.cal-pconv .cal-mq').allInnerTexts();
      ok(quarters.length === 4 && quarters.every((q) => /^(Peak|Node|Valley|End)$/.test(q)), 'each major period shows its quarter word: ' + quarters.join(' '));
      ok((await page.locator('.cal-pconv .cal-mstep .cal-sl').allInnerTexts()).join(' ') === 'Alpha Beta Gamma Delta', 'the majors are named in words');
      // the minor entries are written in the notation: ε# before the number, the unit after a count
      ok((await page.locator('.cal-pconv .cal-cstep.is-ord .cal-sl').allInnerTexts()).join(' ') === 'ε#', 'the Nuclide is labelled ε#');
      ok((await page.locator('.cal-pconv .cal-cstep.is-count .cal-sl').allInnerTexts()).join(' ') === 'η ι λ ν', 'the counts are labelled η ι λ ν after the number');
      ok((await page.locator('.cal-pconv .cal-pc-clock .pure-pair').count()) === 1, 'the Helion reading carries its phase pair');
      ok((await page.locator('.cal-pconv .cal-pgcell.is-major').count()) === 4 && (await page.locator('.cal-pconv .cal-pgcell.is-major .pure-pair').count()) === 0, 'Alpha … Delta show a quarter word, no glyph pair');
      ok(/Press \? for the glossary/.test(await page.locator('.cal-pconv .cal-pc-moment .cal-help').first().innerText()), 'the converter help points to the glossary');
      // address steppers: ε + carries
      await page.locator('.cal-pconv .cal-dchip').nth(4).click();
      await page.waitForTimeout(200);
      const before = await stampNow();
      await page.locator('.cal-pconv .cal-chain .cal-step:not([hidden])').nth(4).locator('button').nth(1).click();
      await page.waitForTimeout(250);
      ok((await stampNow()) !== before, `ε + changes the moment (${before} -> ${await stampNow()})`);
      const res = await page.locator('.cal-pconv .cal-result').innerText();
      ok(/Begin of/.test(res) && /Delta \w+fracton/.test(res) && !/Epsilon \w*fracton/.test(res), 'the result names the majors in words and the Nuclide by number: ' + res.replace(/\s+/g, ' '));
      // a depth finer than the Nuclide is placed by its counts
      await page.locator('.cal-pconv .cal-dchip').nth(8).click();
      await page.waitForTimeout(200);
      ok(/^\d+η \d+ι$/.test(await page.locator('.cal-pconv .cal-placet').innerText()), 'an ι cycle is placed by its counts: ' + (await page.locator('.cal-pconv .cal-placet').innerText()));
      const pBefore = await stampNow();
      await page.locator('.cal-pconv .cal-place button').nth(1).click();
      await page.waitForTimeout(200);
      ok((await stampNow()) !== pBefore, 'the place stepper moves one cycle of its depth');
      // glyph picker: rows with stamps and countdowns
      await page.locator('.cal-pconv .cal-gcell').nth(6).click();
      await page.waitForTimeout(300);
      await page.locator('.cal-pconv .cal-states .cal-state').nth(13).click();
      await page.locator('.cal-pconv .cal-states2 .cal-state[data-j="4"]').click();
      await page.waitForTimeout(300);
      const rows = await page.locator('.cal-pconv .cal-pick-res .cal-trow').count();
      ok(rows >= 4, `the picker lists next / previous moments of 13·4 (${rows} rows)`);
      const first = await page.locator('.cal-pconv .cal-pick-res .cal-trow').first().innerText();
      ok(/α#\d+ β#\d γ#\d+/.test(first) && /(in|ago)/.test(first), 'a row is a stamp with a pure countdown: ' + first.replace(/\s+/g, ' '));
      const t0 = await t();
      await page.locator('.cal-pconv .cal-pick-res .cal-go').first().click();
      await page.waitForTimeout(300);
      ok(Math.abs((await t()) - t0) > 60, 'a go button moves the app');
      const odo = await page.evaluate(() => { const f = window.__fractonica; return f.model.odometerAt(f.store.t(), 6, { digits: 2 })?.digits.join(); });
      ok(odo === '13,4', 'the app now shows the pair 13·4 at depth 7: ' + odo);
      await page.keyboard.press('Escape');
      // solar sync stepper
      const sync0 = await field('Solar sync number').inputValue();
      await page.locator('.cal-pconv .cal-syncrow button').nth(1).click();
      await page.waitForTimeout(250);
      ok(Number(await field('Solar sync number').inputValue()) === Number(sync0) + 1, `sync + 1 (${sync0} -> ${await field('Solar sync number').inputValue()})`);
      ok(/Drift\s+[−+]?\d{1,3}(\u202f\d{3})*λ/.test((await page.locator('.cal-pconv .cal-syncbody').innerText()).replace(/\n/g, ' ')), 'the sync shows its drift in λ');
      await page.locator('.cal-pconv .cal-apply').click();
      await page.waitForTimeout(250);
      ok(Math.abs((await t()) - (await conv())) < 1, 'Apply moves the app to the converter moment');
      ok((await page.locator('.cal-pconv .cal-pin').getAttribute('aria-pressed')) === 'false', 'Apply unpins');
      await goto(`?pure=1&t=${T}&view=calendar`);
    }
    const typeIn = async (label, text, { enter = true } = {}) => {
      const loc = page.locator(`.cal-pconv [aria-label="${label}"]`).first();
      await loc.fill(text);
      if (enter) await loc.press('Enter');
      await page.waitForTimeout(160);
      note(await scan(page, `${label} ← ${text}`));
      await loc.press('Escape');
    };
    for (const bad of ['2031-06-01', '+3d', 'Moscow', 'xyz', '14:30', 'next ζ½ peak', 'δ½ 3', '+2ξ', '+2ζ', 'ζ#5', 'δ#6', 'α#19', 'Delta Trifracton Node ε#2 5η', '3γ', '77η', '33η 4ν', 'tomorrow', '1791460800', '3 beats', '+2 Hadrons', 'next Atom', 'Eta Difracton', '50%']) await typeIn('Stamp or name', bad);
    // every date form, counts and offsets in every unit (Blinks and unit names included) are read by the stamp field
    for (const good of ['+4 Blinks', '+2 Nuclides 5 Helions', '+2ε 5η', '+0.14ν', '-3ι', 'Delta Trifracton Node', 'Delta Trifracton End ε#5 33η 29ι', 'ε#2 5η', '33η 17ι']) await typeIn('Stamp or name', good);
    await typeIn('Eclipse number', '99');
    await typeIn('Fraction', 'abc');
    await typeIn('Exact position (Saros units)', '1e9');
    await typeIn('Solar sync number', '9999999999999999999999');
    await typeIn('Solar sync number', 'abc');
    for (const bad of ['99', 'x']) {
      const c = page.locator('.cal-pconv .cal-cstep input').first();
      await c.fill(bad);
      await c.press('Enter');
      await page.waitForTimeout(120);
      note(await scan(page, `counter ← ${bad}`));
      await c.press('Escape');
    }
    const stepperIn = page.locator('.cal-pconv .cal-chain .cal-step:not([hidden]) input').first();
    for (const bad of ['99', '0', 'x']) {
      await stepperIn.fill(bad);
      await stepperIn.press('Enter');
      await page.waitForTimeout(120);
      note(await scan(page, `address ← ${bad}`));
      await stepperIn.press('Escape');
    }
    // every point of the cycle, every depth
    for (const id of ['begin', 'peak', 'node', 'valley', 'end', 'phase']) {
      await page.selectOption('.cal-pconv .cal-point', id);
      await page.waitForTimeout(160);
      note(await scan(page, `point ${id}`));
    }
    for (const d of [0, 2, 5, 8, 11, 13]) {
      await page.locator('.cal-pconv .cal-dchip').nth(d).click();
      await page.waitForTimeout(160);
      note(await scan(page, `depth ${d + 1}`));
    }
    // the glyph picker with a coarse and a fine glyph
    await page.locator('.cal-pconv .cal-gcell').nth(6).click();
    await page.waitForTimeout(250);
    note(await scan(page, 'picker open'));
    await page.locator('.cal-pconv .cal-states .cal-state').nth(13).click();
    await page.waitForTimeout(200);
    note(await scan(page, 'picker coarse 13'));
    await page.locator('.cal-pconv .cal-states2 .cal-state[data-j="4"]').click();
    await page.waitForTimeout(200);
    note(await scan(page, 'picker 13·4'));
    note(await hoverInteractive(page, 'picker', { limit: 24, dwell: 120 }));
    await page.keyboard.press('Escape');
    // pin / use / apply / link / hear toasts
    await page.locator('.cal-pconv .cal-pin').click();
    await page.waitForTimeout(160);
    note(await scan(page, 'pinned'));
    for (const sel of ['.cal-pconv .cal-apply']) {
      await page.locator(sel).click();
      await page.waitForTimeout(260);
      note(await scan(page, `click ${sel}`));
    }
    await page.locator('.cal-pconv button[title="Copy a link to this moment"]').click();
    await page.waitForTimeout(260);
    note(await scan(page, 'link toast'));
    // out-of-range converter message and button: the store clamps every jump, so only a device clock outside the
    // catalogue (here: far in the future) can show it
    await goto(`?pure=1&view=calendar`);
    await page.evaluate(() => {
      window.__dateNow = Date.now;
      Date.now = () => 32503680000000;
    });
    await page.waitForTimeout(500);
    note(await scan(page, 'converter out of range (live clock beyond the catalogue)'));
    ok(await page.locator('.cal-pconv .cal-oor').first().isVisible(), 'the converter explains a moment outside the catalogue');
    note(await scan(page, 'page out of range'));
    await page.locator('.cal-pconv .cal-oor button').first().click();
    await page.waitForTimeout(250);
    note(await scan(page, 'after the edge button'));
    await page.evaluate(() => {
      Date.now = window.__dateNow;
    });
    }

    // ---------------------------------------------------------------- the page: navigation
    if (has('page')) {
    console.log('pure page: navigation, clicks, keys, selects');
    await goto(`?pure=1&t=${T}&view=calendar`);
    const v0 = await view();
    await page.locator('.cal-pmonth .cal-nb[aria-label="Forward one Delta"]').click();
    await page.waitForTimeout(250);
    const v1 = await view();
    ok(v1.hv === v0.hv + 1, `forward one Delta moves the page (${v0.hv} -> ${v1.hv})`);
    note(await scan(page, 'next page'));
    for (const [sym, pages] of [['Gamma', 5], ['Beta', 65], ['Alpha', 325]]) {
      await page.locator(`.cal-pm-step button:has-text("${sym}")`).click();
      const before = (await view()).hv;
      await page.locator('.cal-pmonth .cal-nb').nth(1).click();
      await page.waitForTimeout(250);
      ok((await view()).hv === before + pages, `the arrows step by one ${sym} (${pages} pages)`);
      note(await scan(page, `step ${sym}`));
      await page.locator('.cal-pmonth .cal-nb').nth(0).click();
      await page.waitForTimeout(150);
    }
    await page.locator('.cal-pm-step button:has-text("Delta")').click();
    await page.waitForTimeout(100);
    await page.selectOption('.cal-pmonth select[aria-label="Alpha of the page"]', '9');
    await page.waitForTimeout(250);
    note(await scan(page, 'alpha 9'));
    ok((await view()).info.alpha === 9, 'the α select jumps to α#9');
    ok((await page.locator('.cal-pm-cell').count()) === 35, 'a page is 35 cells (5 Nuclide rows x 7 columns of 11 Helions)');
    ok((await page.locator('.cal-pm-ch').allInnerTexts()).map((x) => x.replace(/\s+/g, '')).join(' ') === '0η 11η 22η 33η 44η 55η 66η', 'the columns are labelled by their first Helion count');
    ok(/Gamma \w+fracton\s·\s+Delta \w+fracton/.test(await page.locator('.cal-pm-tm').innerText()), 'the page is named in words: ' + (await page.locator('.cal-pm-tm').innerText()));
    // the quarter bar: Peak Node Valley End of the page's Delta; a click goes to where the quarter begins
    ok((await page.locator('.cal-pm-qseg').allInnerTexts()).join(' ') === 'Peak Node Valley End', 'the quarter bar names the four quarters');
    ok((await page.locator('.cal-pm-qline').count()) === 3, 'three quarter thresholds are marked inside the grid');
    await page.locator('.cal-pm-qseg').nth(2).click();
    await page.waitForTimeout(250);
    ok(/ Valley$/.test(await page.evaluate(() => window.__fractonica.ctx.pure.majorText(window.__fractonica.store.t(), 3))), 'a click on Valley goes to where the Valley quarter begins');
    ok((await page.locator('.cal-pm-qseg.is-cur').innerText()) === 'Valley', 'the current quarter is marked');
    // the band level: δ ε ζ cycles are whole cells, η cycles are inside them; the choice is the app-wide selected depth
    for (const [i, level] of [[0, 3], [1, 4], [2, 6]]) {
      await page.locator('.cal-pmonth .cal-ovseg button').nth(i).click();
      await page.waitForTimeout(250);
      ok((await page.evaluate(() => window.__fractonica.store.state.selectedLevel)) === level, `the band level ${'δεη'[i]} is the selected depth ${level + 1}`);
      ok((await page.locator('.cal-pm-seg').count()) >= 35, `the band has segments at level ${'δεη'[i]}`);
      await page.locator('.cal-pm-seg').nth(14).hover({ force: true });
      await page.waitForTimeout(120);
      note(await scan(page, `band ${'δεη'[i]}`));
    }
    await page.evaluate(() => window.__fractonica.store.set({ selectedLevel: 4 }));
    await page.waitForTimeout(250);
    ok((await page.locator('.cal-pmonth .cal-ovseg button[aria-pressed="true"]').innerText()) === 'ε', 'selecting ε elsewhere puts ε in the band');
    await page.evaluate(() => window.__fractonica.store.set({ selectedLevel: 6 }));
    await page.waitForTimeout(200);
    await page.locator('.cal-pmonth .cal-today').click();
    await page.waitForTimeout(250);
    note(await scan(page, 'Now'));
    await page.locator('.cal-pmonth .cal-shown').click();
    await page.waitForTimeout(250);
    ok((await view()).follow === true, 'the shown-cell button follows the displayed moment again');
    // a click on a cell goes there, at the same offset
    const t0 = await t();
    await page.locator('.cal-pm-cell').nth(20).locator('.cal-pm-day').click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(300);
    const t1 = await t();
    ok(Math.abs(t1 - t0) > 3600, `clicking a cell moves the app (${(t1 - t0).toFixed(0)} device units)`);
    await page.locator('.cal-pm-cell').nth(9).locator('.cal-pm-day').dblclick({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(300);
    note(await scan(page, 'after double click'));
    // the cells carry what is in them (the eclipse number, the sync that begins), not the 18 px phase pair
    {
      await goto(`?pure=1&t=1263569192.816&view=calendar`);
      ok((await page.locator('.cal-pm-pair').count()) === 0, 'no glyph pair in the cells');
      ok((await page.locator('.cal-pm-tag.is-ecl').first().innerText()) === '#22', 'the eclipse cell says #22 (numbered like the position)');
      ok(/eclipse number 22/.test((await page.locator('.cal-pm-cell:has(.cal-pm-tag.is-ecl) .cal-pm-day').first().getAttribute('aria-label')) ?? ''), 'its aria label says "eclipse number 22"');
      ok((await page.locator('.cal-pm-tag.is-sync').count()) >= 6, 'sync numbers label the cells where a sync begins');
      ok(/^S\d+$/.test(await page.locator('.cal-pm-tag.is-sync').first().innerText()), 'a sync label is S + its number');
      ok(/eclipse #22 \+ \.\d+/.test(await page.locator('.cal-pconv .cal-meta .cal-chip').first().innerText()), 'the converter chip names the same eclipse #22');
      // the eclipse is marked where it falls in its cell: 0, 1/4, 1/2 or 3/4 (#22 is k mod 4 = 2: the middle)
      const ex = await page.evaluate(() => {
        const c = document.querySelector('.cal-pm-cell:has(.cal-pm-tag.is-ecl)');
        const l = c?.querySelector('.cal-pm-eline');
        return l ? { left: l.style.left, icon: c.querySelector('.cal-pm-ecl')?.style.left } : null;
      });
      ok(ex && /^50(\.0+)?%$/.test(ex.left) && /^50(\.0+)?%$/.test(ex.icon), `the eclipse hairline sits at the middle of its cell: ${JSON.stringify(ex)}`);
      ok(/eclipse #22/.test(await page.locator('.cal-pconv .cal-eclipses').innerText()), 'the eclipse rows name #22 and #23: ' + (await page.locator('.cal-pconv .cal-eclipses').innerText()).replace(/\s+/g, ' '));
      await goto(`?pure=1&t=${T}&view=calendar`);
    }
    // the η band
    await page.locator('.cal-pm-cell.is-shown .cal-pm-seg').nth(1).click();
    await page.waitForTimeout(250);
    note(await scan(page, 'after an η click'));
    // keys: page change by PageDown, edge crossing keeps the focus
    await page.locator('.cal-pm-day[tabindex="0"]').focus();
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(250);
    note(await scan(page, 'PageDown'));
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    note(await scan(page, 'ArrowRight over the page edge'));
    // inspector rows (back to the page of the shown moment first)
    await page.locator('.cal-pmonth .cal-shown').click();
    await page.waitForTimeout(250);
    await page.locator('.cal-inspect .cal-go').first().click();
    await page.waitForTimeout(250);
    note(await scan(page, 'inspector go'));
    // time-lapse across pages
    for (const rate of [18188.9, 3501360, -100038.9]) {
      await page.evaluate((r) => window.__fractonica.store.setRate(r), rate);
      await page.waitForTimeout(900);
      note(await scan(page, `time-lapse ${rate}`));
    }
    await page.evaluate(() => window.__fractonica.store.goLive());
    }

    // ---------------------------------------------------------------- jump box
    if (has('jump')) {
    console.log('pure jump box: every class of input');
    await goto(`?pure=1&t=${T}&view=rings`);
    const typeJump = async (text, { enter = false } = {}) => {
      await jump.fill(text);
      await page.waitForTimeout(200);
      note(await scan(page, `jump ← ${text}`));
      if (enter) {
        await jump.press('Enter');
        await page.waitForTimeout(300);
        note(await scan(page, `jump ↵ ${text}`));
      }
    };
    await jump.focus();
    await page.waitForTimeout(150);
    note(await scan(page, 'jump examples (empty box)'));
    note(await hoverSweep(page, 'jump list', { cols: 3, rows: 8, dwell: 40, box: (await page.locator('.jump-pop').boundingBox()) ?? undefined }));
    const inputs = [
      'Gamma Difracton', 'Gamma Difracton in Beta Tetrafracton', 'Alpha Hexafracton Beta Tetrafracton Gamma Nonafracton', 'Difracton', 'Omega Monofracton',
      'Delta Trifracton', 'Delta Trifracton Node', 'Delta Trifracton Node ε#2 20η 12ι', 'Delta Trifracton Node ε#2 5η', 'Delta Trifracton End ε#5 33η 29ι',
      'Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End, ε#5 33η 29ι 21λ 3ν',
      'α#6 β#4 γ#9 δ#3 ε#5 33η 29ι 21λ 3ν', 'δ#3 ε#5 33η 29ι', 'α#6 β#4 γ#9', 'ε#5', 'ζ 6', 'a6 b3 g11', 'α#19', 'β#6', 'γ#14',
      'ε#2 5η', '33η 17ι', 'δ 3 ε 2 η 5', 'η 3', '33η29ι21λ3ν', 'δ#6', 'ε#6', '77η', '3γ', 'ν#3', '33η 4ν',
      '+2ε 5η', '-3ι', '3η ago', '+3', '+2δ', '+9999α', '+4 Blinks', '+0.14ν', '+2 Nuclides 5 Helions', '3 Preons ago', 'in 5 Flavons', '+12ν',
      'δ½ 3', 'ζ½', 'next ζ½', 'delta half 3', '+2ζ', '5ζ', 'ζ#5', 'θ#3', '+2θ', '+2ξ', '+2 Hadrons', 'next Atom', '3 Quarks ago', 'Eta Difracton', 'Epsilon Trifracton', '3 beats', '50%',
      'pos 22.9', 'pos 99', 'sync 4820', 'S4820 node', 'sync 99999999',
      'next ε', 'prev η', 'next Helion', 'next Delta', 'next Delta node', 'next node of Delta', 'next peak η', 'next 3 ε', 'next peak', 'next Nuclide', 'next Blink', 'next ζ', 'ε', 'Helion', 'Delta',
      'η [13,0]', 'η 13·4', 'η [16,0]', 'δ [3,0]', 'd7#717211', 'd7#99999999999', 'd20 1,2', 'now',
      '2031-06-01 14:30', 'Thu 8 Oct 2026', '+3d', 'in 2 weeks', 'tomorrow', '14:30 Tokyo', '1791460800', 'UTC',
      'xyz', '???', 'x'.repeat(300),
    ];
    for (const text of inputs) await typeJump(text);
    // what the header prints is read back: the short date in words (with the quarter word) and the stamp in letters,
    // also in a Nuclide that straddles two quarters of its Delta
    {
      const inst = await page.evaluate(() => {
        const { model, ctx } = window.__fractonica;
        const d = model.levelAt(1791460800, 3).cycle;
        const t = Math.round(model.cycleStartTime(3, d) + 0.3 * (model.cycleStartTime(3, d + 1) - model.cycleStartTime(3, d))) / 1;
        return { t, words: ctx.pure.dateText(t, { upTo: 'epsilon' }), short: ctx.pure.dateText(t), stamp: ctx.pure.stamp(t, 'iota') };
      });
      ok(/^Delta \w+fracton Node ε#2$/.test(inst.words), `the header's short date in a straddling Nuclide: ${inst.words}`);
      await goto(`?pure=1&t=${inst.t}&view=rings`);
      for (const [what, text, upTo] of [['words', inst.words, null], ['short date', inst.short, null], ['stamp', inst.stamp, 'iota']]) {
        await jump.fill(text);
        await page.waitForTimeout(250);
        const kind = await page.locator('.jump-item').first().locator('.jump-kind').innerText();
        ok(/^cycle$/i.test(kind), `the jump box reads the ${what} "${text}" (${kind})`);
        note(await scan(page, `jump ← the header ${what}`));
        await jump.press('Enter');
        await page.waitForTimeout(350);
        const shown = await page.evaluate(([w, u]) => (u ? window.__fractonica.ctx.pure.stamp(window.__fractonica.store.t(), u) : w === 'words' ? window.__fractonica.ctx.pure.dateText(window.__fractonica.store.t(), { upTo: 'epsilon' }) : window.__fractonica.ctx.pure.dateText(window.__fractonica.store.t())), [what, upTo]);
        ok(shown === text, `Enter lands on the same ${what}: ${shown}`);
        await goto(`?pure=1&t=${inst.t}&view=rings`);
      }
      // the old spelling of the stamp without hashes
      const old = inst.stamp.replace(/δ#(\d+)/, 'δ $1').replace(/ε#(\d+)/, 'ε $1').replace(/ (\d+)η (\d+)ι$/, ' η $1 ι $2');
      await jump.fill(old);
      await page.waitForTimeout(250);
      ok(/^cycle$/i.test(await page.locator('.jump-item').first().locator('.jump-kind').innerText()), `the old spelling "${old}" is still read`);
      await jump.press('Escape');
    }
    // pick one, remember it, see the history
    await typeJump('Gamma Difracton', { enter: true });
    await jump.focus();
    await page.waitForTimeout(150);
    note(await scan(page, 'jump history (empty box)'));
    await jump.press('Escape');
    await typeJump('now', { enter: true });
    await typeJump('next ε', { enter: true });
    await jump.focus();
    note(await scan(page, 'jump history 3'));
    // arrow keys inside the list and an example chosen with a click
    await jump.fill('');
    await jump.press('ArrowDown');
    await jump.press('ArrowDown');
    note(await scan(page, 'jump arrow keys'));
    await jump.press('Escape');
    // phone width
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(`?pure=1&t=${T}&view=calendar`);
    note(await scan(page, 'phone calendar'));
    if (shots) await shot('calpure-phone.png');
    await page.locator('.cal-switch button').nth(1).click();
    await page.waitForTimeout(300);
    note(await scan(page, 'phone page'));
    if (shots) await shot('calpure-phone-page.png');
    note(await hoverSweep(page, 'phone page', { cols: 5, rows: 8, dwell: 40 }));
    await jump.fill('Gamma Difracton');
    await page.waitForTimeout(200);
    note(await scan(page, 'phone jump'));
    if (shots) await shot('calpure-phone-jump.png');
    await jump.fill('');
    await page.setViewportSize({ width: 1440, height: 900 });
    }

    // ---------------------------------------------------------------- switching in both directions
    if (has('live')) {
    console.log('live switching');
    await goto(`?t=${T}&view=calendar&zone=UTC&pure=0`);
    const normalText = async () => page.evaluate(() => document.querySelector('#view-calendar').innerText + '\n' + document.querySelector('#slot-jump').innerText + ' ' + document.querySelector('.jump-input').placeholder);
    const before = await normalText();
    ok(/gregorian/i.test(before) && /2026-10-08/.test(await page.locator('.cal-conv input[aria-label="Date"]').inputValue()), 'normal mode starts as before (Gregorian panel, date field)');
    await jump.fill('2031-06-01');
    await page.keyboard.press('p'); // typing in the box: P must not toggle
    ok(!(await page.evaluate(() => document.body.dataset.pure)), 'P is ignored while typing in the box');
    await jump.fill('');
    await jump.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.press('p');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.body.dataset.pure === '1'), 'P switches pure mode on');
    note(await scan(page, 'toggled on with the P key (calendar)'));
    ok((await page.locator('.cal-pconv').isVisible()) && !(await page.locator('.cal-conv:not(.cal-pconv)').isVisible()), 'pure converter shown, Gregorian converter hidden');
    ok(/Jump to a moment/.test(await jump.getAttribute('aria-label')) && /Delta \w+fracton/.test(await jump.getAttribute('placeholder')), 'the jump box changed vocabulary at once');
    await jump.fill('Gamma Difracton');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.locator('#btn-pure').click(); // the header button, leaving pure mode
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => !document.body.dataset.pure), 'the header button switches pure mode off');
    const after = await normalText();
    ok(/converter/i.test(after) && /gregorian/i.test(after) && /cycle band/i.test(after), 'normal text is back (Gregorian panel, cycle band)');
    ok(!/\wfracton\b|Blink|glyph pair|cell \d+ of 35/i.test(after), 'no pure text is left in the normal mode (calendar tab and jump box)');
    ok((await jump.inputValue()) === '' && /2031-06-01/.test(await jump.getAttribute('placeholder')), 'the box is empty again with the normal placeholder');
    ok(/2026-10-08/.test(await page.locator('.cal-conv input[aria-label="Date"]').inputValue()), 'the Gregorian converter shows the shown time again');
    // the other direction: pure -> normal -> pure keeps working, deep link
    await page.keyboard.press('p');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.body.dataset.pure === '1'), 'pure again');
    note(await scan(page, 'toggled on again'));
    const stampNow = await page.locator('.cal-pconv [aria-label="Stamp or name"]').inputValue();
    ok(/^α#\d+ β#\d γ#\d+ δ#\d ε#\d \d+η \d+ι \d+λ \d+ν$/.test(stampNow), `pure converter stamp: ${stampNow}`);
    }

    // ---------------------------------------------------------------- report
    // (what the test itself typed into a field is not the module's text)
    const typed = (l) => l.kind === 'input-value' && /←|jump/.test(l.state);
    const mine = all.filter((l) => (MINE.test(l.where) || MINE.test(l.kind)) && !typed(l));
    const others = all.filter((l) => !mine.includes(l) && !typed(l));
    const hard = mine.filter((l) => l.severity === 'hard');
    console.log('\nleaks of this module (cal- / jump- / toasts / tips):');
    console.log(formatLeaks(mine, { soft }) || 'none');
    const byRule = {};
    for (const l of others) if (l.severity === 'hard') byRule[l.rule] = (byRule[l.rule] ?? 0) + 1;
    console.log(`\nleaks of other modules (ignored here): ${JSON.stringify(byRule)}`);
    console.log(`\n${hard.length} hard leak(s) in this module, ${mine.length - hard.length} soft (${soft ? 'listed above' : 'run with --soft to list'})`);
    const mine404 = errors.filter((e) => /calendar|jump|cal-/i.test(e));
    console.log('page errors from this module:', mine404.length ? mine404 : 'none');
    process.exitCode = failures || hard.length || mine404.length ? 1 : 0;
  },
  { viewport: { width: 1440, height: 900 } },
);
