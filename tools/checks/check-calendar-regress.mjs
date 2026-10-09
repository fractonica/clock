// Regression checks for the calendar tab and the jump box: one check per defect found in review
// (stale-cache repaint, blur pinning, month wrap-around, history replay, focus loss, scroll trap, ...).
//   node tools/checks/check-calendar-regress.mjs
import { withApp } from '../browse.mjs';

const mine = (e) => /calendar|jump|cal-/i.test(e);
let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('  FAIL', msg);
  } else console.log('  ok  ', msg);
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const wait = (page, ms) => page.waitForTimeout(ms);

await withApp(
  async ({ page, url, errors, browser }) => {
    const store = (fn, ...a) => page.evaluate(fn, ...a);
    const T = () => store(() => window.__fractonica.store.t());
    const field = (label) => page.locator(`.cal-conv input[aria-label="${label}"]`);
    const open = async (q) => {
      await page.goto(url(q));
      await wait(page, 700);
    };
    const mutations = (sel, ms, opts = { childList: true }) =>
      page.evaluate(
        async ([sel, ms, opts]) => {
          const el = document.querySelector(sel);
          let n = 0;
          const mo = new MutationObserver((l) => (n += l.length));
          mo.observe(el, opts);
          await new Promise((r) => setTimeout(r, ms));
          mo.disconnect();
          return n;
        },
        [sel, ms, opts],
      );

    console.log('converter: blurring an untouched field never pins');
    await open('?view=calendar&zone=UTC');
    for (const label of ['Unix seconds', 'Time (HH:MM:SS.mmm)', 'ISO 8601']) {
      await field(label).click();
      await wait(page, 1500);
      await page.mouse.click(5, 300);
      await wait(page, 200);
      ok((await page.locator('.cal-pin').getAttribute('aria-pressed')) === 'false', `${label}: still following after focus + blur`);
    }

    console.log('converter: the same instant repaints after an out-of-range excursion');
    await open('?t=1791460800&view=calendar&zone=UTC');
    const u = field('Unix seconds');
    await u.fill('1791460800');
    await u.press('Enter');
    await wait(page, 250);
    const before = (await page.locator('.cal-result').innerText()).length;
    await u.fill('99999999999');
    await u.press('Enter');
    await wait(page, 250);
    ok((await page.locator('.cal-result').innerText()) === '' && (await page.locator('.cal-syncbody').innerText()) === '', 'out of range clears the address and sync sections');
    ok(await page.locator('.cal-fracpanel-oor, .cal-oor').first().isVisible(), 'out-of-range notice is shown');
    await u.fill('1791460800');
    await u.press('Enter');
    await wait(page, 250);
    ok((await page.locator('.cal-result').innerText()).length === before && before > 20, 'cycle address is back');
    ok((await page.locator('.cal-syncbody').innerText()).length > 100, 'solar sync is back');
    ok(!(await page.locator('.cal-addr-copy, .cal-sec:has(h4:text-is("Cycle address")) .cal-copy').first().isDisabled()), 'address copy button is enabled again');

    console.log('converter: out-of-range Unix is flagged inline');
    await u.fill('253402300800');
    await u.press('Enter');
    await wait(page, 200);
    ok(await page.locator('.cal-field:has(input[aria-label="Unix seconds"]) .cal-err').isVisible(), 'inline error under the Unix field');
    ok(/1000 to 9999/.test(await page.locator('.cal-field:has(input[aria-label="Unix seconds"]) .cal-err').innerText()), 'it names the allowed years');

    console.log('converter: an emptied position field is "not finished", never 0');
    await open('?t=1791460800&view=calendar&zone=UTC');
    const ord = field('Eclipse ordinal');
    await ord.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await wait(page, 250);
    ok((await field('Date').inputValue()) !== '1630-02-09', 'clearing the ordinal does not jump to ordinal 0: ' + (await field('Date').inputValue()));
    await page.mouse.click(5, 300);
    await wait(page, 250);
    ok((await ord.inputValue()) !== '', 'an abandoned empty field shows the model value again');
    const frac = field('Fraction');
    const dBefore = await field('Unix seconds').inputValue();
    await frac.fill('');
    await wait(page, 250);
    ok((await field('Unix seconds').inputValue()) === dBefore, 'clearing the fraction does not snap to the eclipse');

    console.log('converter: solar sync at the catalogue edge');
    await open('?t=1791460800&view=calendar&zone=UTC');
    const sIn = page.locator('.cal-syncrow .cal-sv');
    await sIn.fill('-32927');
    await sIn.press('Enter');
    await wait(page, 250);
    await page.locator('.cal-syncrow .cal-sb').first().click();
    await wait(page, 200);
    ok(await page.locator('.cal-syncrow ~ .cal-err').first().isVisible(), 'stepping below the first sync shows an error');
    await u.fill('28005212030');
    await u.press('Enter');
    await wait(page, 300);
    ok((await sIn.inputValue()) === '' && (await page.locator('.cal-syncrow .cal-sb').first().isDisabled()) && (await page.locator('.cal-syncrow .cal-sb').nth(1).isDisabled()), 'no sync defined: empty box, ± disabled');
    ok(!(await page.locator('.cal-syncrow ~ .cal-err').first().isVisible()), 'the stale error is gone');
    await page.locator('.cal-syncbody button[data-sync]').click();
    await wait(page, 300);
    ok(/^-?\d+$/.test(await sIn.inputValue()) && near(Number(await u.inputValue()), 28004625444.1, 2), 'the button goes to the nearest full sync: ' + (await sIn.inputValue()));

    console.log('converter: copy button returns to its icon after two quick clicks');
    await open('?t=1791460800&view=calendar&zone=UTC');
    const cb = page.locator('.cal-field:has(input[aria-label="Date"]) .cal-copy');
    await cb.click();
    await wait(page, 100);
    await cb.click();
    await wait(page, 1500);
    ok(!(await cb.evaluate((b) => b.classList.contains('is-done'))) && !(await cb.innerHTML()).includes('M3 8.5l3.2'), 'copy icon is back');

    console.log('converter: sync and position rows are not rebuilt while the clock runs');
    await open('?view=calendar&zone=UTC');
    ok((await mutations('.cal-syncbody', 2500)) === 0, 'no childList mutation in the sync section (live)');
    ok((await mutations('.cal-frac .cal-meta', 2500)) === 0, 'no childList mutation in the position chips (live)');
    let hits = 0;
    for (let i = 0; i < 5; i++) {
      await store(() => window.__fractonica.store.goLive());
      await wait(page, 250);
      const b = page.locator('.cal-syncbody .cal-go').first();
      await b.scrollIntoViewIfNeeded();
      const box = await b.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await wait(page, 130);
      await page.mouse.up();
      await wait(page, 150);
      if ((await store(() => window.__fractonica.store.mode)) === 'travel') hits++;
    }
    ok(hits === 5, `a press-hold-release on a sync button navigates in live mode (${hits}/5)`);
    await store(() => window.__fractonica.store.goLive());
    await page.locator('.cal-syncbody .cal-go').first().focus();
    await wait(page, 700);
    ok(await page.evaluate(() => document.activeElement?.classList.contains('cal-go')), 'keyboard focus on a sync button survives the ticking clock');

    console.log('glyph picker keeps focus and clicks');
    await open('?t=1791460800&view=calendar&rate=1&zone=UTC');
    await page.locator('.cal-gcell').nth(6).click();
    await wait(page, 300);
    await page.locator('.cal-pin').click(); // follow the clock again
    await wait(page, 100);
    await page.locator('.cal-state').nth(4).focus();
    await wait(page, 1700);
    ok(await page.evaluate(() => document.activeElement?.classList.contains('cal-state')), 'focus stays on a state button while the clock runs');
    await page.keyboard.press('Enter');
    await wait(page, 300);
    ok(await page.evaluate(() => document.activeElement?.classList.contains('cal-state')), 'focus stays on the chosen state');
    ok((await page.locator('.cal-state.is-on').getAttribute('data-i')) === '4' && (await page.locator('.cal-picker .cal-trow').count()) === 6, 'the choice is applied (state 4, six times listed)');
    await page.keyboard.press('Escape');
    await wait(page, 200);
    ok(!(await page.locator('.cal-picker').isVisible()) && (await page.evaluate(() => document.activeElement?.classList.contains('cal-gcell'))), 'Esc closes the picker and returns the focus to its glyph');

    console.log('month view: navigation, follow, labels, writes');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.selectOption('.cal-msel', '1');
    await page.selectOption('.cal-nav .cal-ysel', '1613');
    await wait(page, 250);
    ok(await page.locator('button[aria-label="Previous month"]').isDisabled(), 'Previous is disabled at January 1613');
    await page.locator('.cal-day[tabindex="0"]').focus();
    await page.keyboard.press('PageUp');
    await wait(page, 250);
    let v = await store(() => window.__fractonica.instances.calendar.monthView);
    ok(v.year === 1613 && v.month === 1, 'PageUp at the first month stays: ' + JSON.stringify(v));
    await page.selectOption('.cal-msel', '12');
    await page.selectOption('.cal-nav .cal-ysel', '2857');
    await wait(page, 250);
    ok(await page.locator('button[aria-label="Next month"]').isDisabled(), 'Next is disabled at December 2857');
    await page.locator('.cal-day[tabindex="0"]').focus();
    await page.keyboard.press('PageDown');
    await wait(page, 250);
    v = await store(() => window.__fractonica.instances.calendar.monthView);
    ok(v.year === 2857 && v.month === 12, 'PageDown at the last month stays: ' + JSON.stringify(v));

    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.selectOption('.cal-yh .cal-ysel', '2031');
    await wait(page, 250);
    await store(() => window.__fractonica.store.setRate(3600));
    await wait(page, 300);
    await store(() => window.__fractonica.store.pause());
    await wait(page, 300);
    v = await store(() => window.__fractonica.instances.calendar.monthView);
    ok(v.year === 2031 && !v.follow, 'play / pause do not pull the browsed month back: ' + JSON.stringify(v));
    await store(() => window.__fractonica.ctx.goto(1791460800 + 86400));
    await wait(page, 300);
    v = await store(() => window.__fractonica.instances.calendar.monthView);
    ok(v.year === 2026 && v.follow, 'a real jump does');

    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.locator('.cal-ovseg button:text-is("η")').click();
    await wait(page, 300);
    const curRow = () => page.evaluate(() => [document.querySelector('.cal-ddr.is-current')?.dataset.key, document.querySelector('.cal-seg.is-current')?.dataset.key]);
    const c0 = await curRow();
    await store(() => window.__fractonica.store.setRate(3600));
    await wait(page, 6500);
    await store(() => window.__fractonica.store.pause());
    const c1 = await curRow();
    ok(c0[0] === c0[1] && c1[0] === c1[1] && c0[0] !== c1[0], `the inspector highlight follows the band: ${c0} -> ${c1}`);

    console.log('month view: accessibility labels');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.locator('.cal-ovseg button:text-is("ε")').click();
    await wait(page, 250);
    const lab = await page.evaluate(() => ({
      shown: document.querySelector('.cal-cell.is-shown .cal-day').getAttribute('aria-label'),
      today: document.querySelector('.cal-cell.is-today .cal-day')?.getAttribute('aria-label'),
      cur: document.querySelector('.cal-cell.is-today .cal-day')?.getAttribute('aria-current'),
    }));
    ok(/displayed time/.test(lab.shown) && /Epsilon cycles: ε#5/.test(lab.shown), 'the displayed day says so and names its cycles: ' + lab.shown);
    ok(lab.cur === 'date' && /today/.test(lab.today), "today's cell has aria-current=date");
    await store(() => window.__fractonica.ctx.goto(Date.UTC(2028, 0, 26, 12) / 1000));
    await wait(page, 400);
    ok(/eclipse number 23/.test(await page.locator('.cal-cell.is-shown .cal-day').getAttribute('aria-label')), 'an eclipse day names the eclipse');
    ok((await page.locator('.cal-inspect').getAttribute('aria-live')) === 'polite', 'the inspector is a polite live region');
    const tab0 = await page.evaluate(() => document.querySelector('.cal-day[tabindex="0"]').getAttribute('aria-label'));
    ok(/26 January 2028/.test(tab0), 'Tab enters the grid on the displayed day: ' + tab0);

    console.log('month view: idle frames write nothing, tooltips do not flicker');
    await open('?t=1791460800&view=calendar&zone=UTC');
    ok((await mutations('#view-calendar', 2000, { subtree: true, childList: true, attributes: true, characterData: true })) === 0, 'no DOM writes while nothing changes');
    const box = await page.locator('.cal-cell[data-i="8"]').boundingBox();
    await store(() => {
      window.__ev = [];
      const tip = document.querySelector('.cal-tip');
      new MutationObserver(() => window.__ev.push(tip.hidden ? 'hide' : 'show')).observe(tip, { attributes: true, attributeFilter: ['hidden'] });
    });
    for (let x = box.x - 10; x < box.x + box.width * 4; x += 2) await page.mouse.move(x, box.y + 14);
    ok((await store(() => window.__ev.filter((e) => e === 'hide').length)) === 0, 'sweeping across four cells never hides the tooltip');

    console.log('month view: layout');
    await open('?t=1791460800&view=calendar&zone=UTC');
    const geo = await page.evaluate(() => ({ rib: document.querySelector('.cal-ribbon').getBoundingClientRect().bottom, vh: innerHeight }));
    ok(geo.rib < geo.vh, `the year ribbon is above the fold at 1440x900 (${Math.round(geo.rib)} < ${geo.vh})`);
    await page.mouse.move(1100, 500);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 120);
    await wait(page, 400);
    ok((await store(() => scrollY)) > 200, 'the wheel over the calendar scrolls the page (no scroll trap): scrollY ' + (await store(() => scrollY)));
    ok(!(await page.evaluate(() => { const c = document.querySelector('.cal-month'); return c.scrollHeight > c.clientHeight + 2 && getComputedStyle(c).overflowY !== 'visible'; })), 'the card has no inner scrollbar');
    await store(() => scrollTo(0, 0));
    await page.locator('.cal-ovseg button:text-is("η")').click();
    const ribY = [];
    for (const d of [0, 1, 2, 3]) {
      await store((t) => window.__fractonica.ctx.goto(t), 1791460800 + d * 86400);
      await wait(page, 200);
      ribY.push(await page.evaluate(() => Math.round(document.querySelector('.cal-year').getBoundingClientRect().top)));
    }
    ok(new Set(ribY).size === 1, 'the year ribbon does not move when the day (and its cycle list) changes: ' + ribY);
    const hh = [];
    await open('?t=1791460800&view=calendar&zone=UTC');
    for (const act of ['none', 'pin', 'far']) {
      if (act === 'pin') await page.locator('.cal-pin').click();
      if (act === 'far') {
        await u.fill('2886085800');
        await u.press('Enter');
      }
      await wait(page, 250);
      hh.push(await page.evaluate(() => Math.round(document.querySelector('.cal-conv-h').getBoundingClientRect().height)));
    }
    ok(new Set(hh).size === 1, 'the converter header keeps its height when the status text changes: ' + hh);
    await open('?t=1791460800&view=calendar&zone=UTC&sel=5');
    const wrapFree = [];
    for (const [w, h] of [[1280, 800], [1500, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await wait(page, 300);
      const y0 = await page.evaluate(() => document.querySelector('.cal-grid').getBoundingClientRect().top);
      await page.locator('button[aria-label="Next month"]').click();
      await wait(page, 300);
      wrapFree.push((await page.evaluate(() => document.querySelector('.cal-grid').getBoundingClientRect().top)) === y0);
      await page.locator('.cal-today').click();
    }
    ok(wrapFree.every(Boolean), 'the day grid does not move when "Displayed day" appears');
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log('sound: "Hear this moment"');
    await open('?t=1791460800&view=calendar&zone=UTC');
    ok(await page.locator('.cal-conv .cal-hear').isVisible(), 'the converter has the button');
    ok(await page.locator('.cal-hear-day').isVisible(), 'the day inspector has the button');
    await store(() => {
      const inst = window.__fractonica.instances;
      window.__played = [];
      inst.sound.__orig = inst.sound.playMoment;
      inst.sound.playMoment = async (t) => (window.__played.push(t), { t, notes: [] });
    });
    await field('Unix seconds').fill('1791460800.5');
    await field('Unix seconds').press('Enter');
    await wait(page, 250);
    await page.locator('.cal-conv .cal-hear').click();
    await page.locator('.cal-hear-day').click();
    await wait(page, 200);
    const played = await store(() => window.__played);
    ok(played.length === 2 && near(played[0], 1791460800.5) && near(played[1], await T(), 1), 'the converter plays its own instant, the inspector the displayed one: ' + played);
    await store(() => {
      window.__fractonica.instances.sound.playMoment = async () => {
        throw new Error('The browser blocks audio until you click or press a key on this page');
      };
    });
    await page.locator('.cal-hear-day').click();
    await wait(page, 200);
    ok(/Audio could not start/.test(await page.locator('#toast').innerText()), 'a blocked browser gets a toast: ' + (await page.locator('#toast').innerText()));
    await store(() => {
      window.__fractonica.instances.sound.playMoment = async () => null;
    });
    await page.locator('.cal-conv .cal-hear').click();
    await wait(page, 200);
    ok(/Outside the Saros 141 catalogue/.test(await page.locator('#toast').innerText()), 'no chord outside the catalogue: toast');
    await store(() => {
      delete window.__fractonica.instances.sound;
    });
    await wait(page, 300);
    ok(!(await page.locator('.cal-conv .cal-hear').isVisible()) && !(await page.locator('.cal-hear-day').isVisible()), 'both buttons are hidden when the sound module is absent');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.locator('.cal-conv .cal-hear').click();
    await wait(page, 700);
    ok(!/could not start/.test(await page.locator('#toast').innerText().catch(() => '')), 'the real sound module plays (autoplay allowed in the harness)');

    console.log('keyboard: skip link');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.locator('.cal-skip').focus();
    ok(await page.locator('.cal-skip').isVisible(), 'the skip link is visible when focused');
    await page.keyboard.press('Enter');
    await wait(page, 200);
    ok(await page.evaluate(() => document.activeElement?.classList.contains('cal-day')), 'it moves the focus into the grid');

    console.log('jump box');
    await open('?view=calendar&zone=UTC');
    await page.keyboard.press('/');
    await page.keyboard.type('now');
    await page.keyboard.press('Enter');
    await wait(page, 400);
    ok((await store(() => window.__fractonica.store.mode)) === 'live', '"now" returns to the live device clock');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await store(() => localStorage.removeItem('fractonica-clock/jump/v1'));
    await page.reload();
    await wait(page, 600);
    await page.keyboard.press('/');
    ok(/Examples/.test(await page.locator('.jump-foot').innerText()), 'first run: the footer says Examples');
    await page.keyboard.press('Enter');
    await wait(page, 200);
    ok((await page.locator('.jump-input').inputValue()) !== '', 'Enter on an example copies it into the box');
    await page.keyboard.press('Escape');
    await page.keyboard.type('03/04/2031');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await wait(page, 300);
    const chosen = await T();
    await store(() => window.__fractonica.ctx.goto(1791460800));
    await page.keyboard.press('/');
    await wait(page, 200);
    await page.keyboard.press('Enter');
    await wait(page, 300);
    ok(near(await T(), chosen, 1), 'a recent entry replays the interpretation that was chosen (month/day)');
    for (const bad of ['{"items":5}', 'null', '"abc"', '{}', '{"items":[null,1,{"text":3}]}']) {
      const p2 = await page.context().newPage();
      await p2.addInitScript((b) => localStorage.setItem('fractonica-clock/jump/v1', b), bad);
      await p2.goto(url('?view=calendar&zone=UTC'));
      await p2.waitForTimeout(500);
      ok(await p2.locator('.jump-input').isVisible(), `damaged stored history ${bad} does not break the box`);
      await p2.close();
    }
    await page.keyboard.press('Escape');
    for (const [txt, re] of [
      ['1613-05-19', /Sun 19 May 1613, 17:41:53/],
      ['0050-06-01', /Year 50 is not supported/],
      ['2857-06-13 10:00', /09:33:55 UTC/],
    ]) {
      await page.keyboard.press('/');
      await page.keyboard.type(txt);
      await wait(page, 150);
      ok(re.test(await page.locator('.jump-item').first().innerText()), `${txt} -> ${(await page.locator('.jump-item').first().innerText()).replace(/\n/g, ' | ').slice(0, 90)}`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }

    console.log('zones that skipped a date');
    await open('?t=1324000000&view=calendar&zone=Pacific/Apia');
    await page.selectOption('.cal-msel', '12');
    await page.selectOption('.cal-nav .cal-ysel', '2011');
    await wait(page, 300);
    const skipped = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.cal-cell')].find((x) => x.querySelector('.cal-day').getAttribute('aria-label').startsWith('Friday 30 December 2011'));
      return { cls: c.className, label: c.querySelector('.cal-day').getAttribute('aria-label'), segs: c.querySelectorAll('.cal-seg').length };
    });
    ok(/is-skipped/.test(skipped.cls) && /skipped/.test(skipped.label) && skipped.segs === 0, 'Apia 2011-12-30 is marked as a skipped date without a band: ' + skipped.label);
    ok((await page.evaluate(() => [...document.querySelectorAll('.cal-cell')].find((x) => x.querySelector('.cal-day').getAttribute('aria-label').startsWith('Thursday 29 December 2011')).querySelector('.cal-day').getAttribute('aria-label'))).length > 20, 'the day before is a normal day');

    console.log('month view: inspector texts');
    await open('?t=28005212030&view=calendar&zone=UTC');
    await page.locator('.cal-ovseg button:text-is("Solar sync")').click();
    await wait(page, 300);
    ok(/No complete solar sync covers this day/.test(await page.locator('.cal-inspect').innerText()), 'an in-catalogue day without a complete sync says why');
    await page.selectOption('.cal-msel', '1');
    await page.selectOption('.cal-nav .cal-ysel', '1613');
    await wait(page, 300);
    ok(/before the catalogue starts/.test(await page.locator('.cal-inspect').innerText()), 'a month before the catalogue says so');

    console.log('touch: targets and the two-step band tap');
    const tc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const tp = await tc.newPage();
    tp.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await tp.goto(url('?t=1791460800&view=calendar&zone=UTC'));
    await tp.waitForTimeout(800);
    const small = await tp.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#view-calendar .cal-conv button, #view-calendar .cal-conv input, #view-calendar .cal-conv select, #slot-jump input')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]') && (r.height < 39.5 || r.width < 39.5)) bad.push(el.className.toString().split(' ')[0] + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      return bad;
    });
    ok(small.length === 0, 'every converter control is at least 40 px on touch: ' + small.slice(0, 6));
    const iso = await tp.evaluate(() => { const i = document.querySelector('input[aria-label="ISO 8601"]'); return i.scrollWidth <= i.clientWidth; });
    ok(iso, 'the whole ISO string is visible at 390 px');
    await tp.locator('.cal-switch button:text-is("Calendar")').click();
    await tp.waitForTimeout(300);
    const cell = tp.locator('.cal-cell[data-i="16"]');
    await cell.scrollIntoViewIfNeeded();
    const cb2 = await cell.boundingBox();
    await tp.touchscreen.tap(cb2.x + cb2.width / 2, cb2.y + cb2.height - 5);
    await tp.waitForTimeout(300);
    const t1 = await tp.evaluate(() => window.__fractonica.store.t());
    ok(near(t1, Date.UTC(2026, 9, 14, 12) / 1000, 1), 'the first tap on a band selects the day: ' + new Date(t1 * 1000).toISOString());
    await tp.touchscreen.tap(cb2.x + cb2.width / 2, cb2.y + cb2.height - 5);
    await tp.waitForTimeout(300);
    const t2 = await tp.evaluate(() => window.__fractonica.store.t());
    ok(t2 < t1 && near(t2, Date.UTC(2026, 9, 1, 9, 9, 8) / 1000, 2), 'the second tap goes to the cycle start: ' + new Date(t2 * 1000).toISOString());
    await tc.close();

    console.log('errors from my files:', errors.filter(mine));
    ok(errors.filter(mine).length === 0, 'no console errors from calendar / jump');
  },
  { viewport: { width: 1440, height: 900 } },
);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
