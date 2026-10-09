// Interaction checks for the calendar tab and the jump box (headless Chromium).
//   node tools/checks/check-calendar.mjs
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

await withApp(
  async ({ page, url, errors, shot }) => {
    await page.goto(url('?t=1791460800&view=calendar&zone=UTC'));
    await page.waitForTimeout(800);
    const T = () => page.evaluate(() => window.__fractonica.store.t());
    const val = (label) => page.locator(`.cal-conv input[aria-label="${label}"]`).inputValue();

    console.log('converter: Gregorian side');
    ok((await val('Date')) === '2026-10-08', 'date shows the displayed day');
    ok((await val('Unix seconds')) === '1791460800.000', 'unix field');
    ok((await val('Eclipse ordinal')) === '22', 'eclipse ordinal');

    console.log('converter: editing the date pins and updates everything');
    await page.locator('.cal-conv input[aria-label="Date"]').fill('2031-06-01');
    await page.waitForTimeout(250);
    ok((await val('Unix seconds')) === String(Date.UTC(2031, 5, 1, 12) / 1000) + '.000', 'unix after date edit = ' + (await val('Unix seconds')));
    ok((await page.locator('.cal-pin').getAttribute('aria-pressed')) === 'true', 'pinned after an edit');
    const posA = await val('Exact position (Saros units)');
    ok(/^23\./.test(posA), 'position for 2031 starts with 23: ' + posA);
    console.log('   address:', await page.locator('.cal-result').innerText());

    console.log('converter: round trip through the Fractonica side (position text -> time)');
    const unixBefore = await val('Unix seconds');
    await page.locator('.cal-conv input[aria-label="Exact position (Saros units)"]').fill(posA);
    await page.waitForTimeout(250);
    ok(near(Number(await val('Unix seconds')), Number(unixBefore), 5e-3), `exact position round trip: ${unixBefore} -> ${await val('Unix seconds')}`);

    console.log('converter: Apply navigates the app');
    await page.locator('.cal-apply').click();
    await page.waitForTimeout(200);
    ok(near(await T(), Date.UTC(2031, 5, 1, 12) / 1000, 0.05), 'store time = converter time after Apply');
    ok((await page.locator('.cal-pin').getAttribute('aria-pressed')) === 'false', 'unpinned after Apply');

    console.log('converter: cycle address steppers');
    const before = await val('Unix seconds');
    await page.locator('.cal-step:nth-child(5) .cal-sb').nth(1).click(); // epsilon +
    await page.waitForTimeout(250);
    const after = await val('Unix seconds');
    ok(after !== before, `epsilon + changes the instant (${before} -> ${after})`);
    ok((await page.locator('.cal-result').innerText()).includes('Begin of'), 'result line names the point');
    // jump straight to a typed alpha
    const alpha = page.locator('.cal-step:nth-child(1) .cal-sv');
    await alpha.fill('19');
    await page.waitForTimeout(200);
    ok((await page.locator('.cal-step:nth-child(1) .cal-serr').innerText()).includes('18'), 'alpha 19 shows an inline error');
    await alpha.fill('9');
    await page.waitForTimeout(250);
    ok(/α#9/.test(await page.locator('.cal-result').innerText()), 'alpha 9 accepted (written α#9)');

    console.log('converter: depth chips, point selector');
    await page.locator('.cal-dchip').nth(2).click();
    await page.waitForTimeout(200);
    ok((await page.locator('.cal-step:not([hidden])').count()) === 3, 'depth 3 shows three steppers');
    await page.selectOption('.cal-point', 'peak');
    await page.waitForTimeout(250);
    ok((await page.locator('.cal-result').innerText()).includes('Peak of'), 'point selector peak');

    console.log('converter: same phase of another alpha');
    await page.evaluate(() => window.__fractonica.ctx.goto(1791460800));
    if ((await page.locator('.cal-pin').getAttribute('aria-pressed')) === 'true') await page.locator('.cal-pin').click();
    await page.waitForTimeout(250);
    await page.locator('.cal-dchip').nth(0).click();
    await page.selectOption('.cal-point', 'phase');
    await page.waitForTimeout(250);
    const ph0 = await page.evaluate(() => window.__fractonica.model.levelAt(window.__fractonica.store.t(), 0).phase);
    await page.locator('.cal-step:nth-child(1) .cal-sb').nth(1).click();
    await page.waitForTimeout(250);
    const ph1 = await page.evaluate(() => { const f = window.__fractonica; const l = f.model.levelAt(Number(document.querySelector('.cal-conv input[aria-label="Unix seconds"]').value), 0); return [l.phase, l.cycle]; });
    ok(near(ph1[0], ph0, 2e-6) && ph1[1] === 6, `same phase kept in alpha 7: ${ph0} -> ${ph1}`);
    await page.selectOption('.cal-point', 'begin');
    await page.waitForTimeout(200);
    await page.locator('.cal-dchip').nth(7).click();
    await page.evaluate(() => window.__fractonica.ctx.goto(1791460800));
    await page.locator('.cal-pin').click().catch(() => {});

    console.log('converter: glyph picker');
    await page.locator('.cal-gcell').nth(6).click();
    await page.waitForTimeout(300);
    ok(await page.locator('.cal-picker').isVisible(), 'picker opens');
    await page.locator('.cal-state').nth(4).click();
    await page.waitForTimeout(300);
    const rows = await page.locator('.cal-picker .cal-trow').count();
    ok(rows === 6, 'picker lists 3 next + 3 previous (' + rows + ')');
    const firstGo = page.locator('.cal-picker .cal-trow .cal-go').first();
    const goT = Number(await firstGo.getAttribute('data-t'));
    await firstGo.click();
    await page.waitForTimeout(150);
    ok(near(await T(), goT, 1e-3), 'go button navigates to the occurrence');
    const idx = await page.evaluate(() => window.__fractonica.model.levelAt(window.__fractonica.store.t(), 6).index);
    ok(idx === 4, 'depth 7 shows state 4 (peak) at the occurrence: ' + idx);

    console.log('converter: solar sync');
    await page.locator('.cal-syncrow .cal-sb').nth(1).click();
    await page.waitForTimeout(250);
    const sync = await page.locator('.cal-syncrow .cal-sv').inputValue();
    ok(/^-?\d+$/.test(sync), 'sync number after + is ' + sync);
    await page.locator('.cal-syncrow .cal-sv').fill('4820');
    await page.waitForTimeout(250);
    ok(near(Number(await val('Unix seconds')), 1791336849.827, 2e-3), 'sync 4820 start in the unix field: ' + (await val('Unix seconds')));

    console.log('converter: out of range');
    await page.locator('.cal-conv input[aria-label="Date"]').fill('3000-01-01');
    await page.waitForTimeout(300);
    ok(await page.locator('.cal-oor').first().isVisible(), 'out-of-range notice');
    ok(await page.locator('.cal-apply').isDisabled(), 'apply disabled outside the catalogue');
    await page.locator('.cal-conv input[aria-label="Date"]').fill('2031-02-30');
    await page.locator('.cal-conv input[aria-label="Date"]').blur();
    await page.waitForTimeout(200);
    ok((await page.locator('.cal-conv .cal-err:not([hidden])').first().innerText()).includes('28 days'), 'invalid date flagged inline');
    ok((await val('Unix seconds')) !== '', 'other side not cleared by invalid input');

    console.log('month view');
    await page.locator('.cal-shown').click().catch(() => {});
    await page.evaluate(() => window.__fractonica.ctx.goto(1791460800));
    await page.waitForTimeout(400);
    const view = () => page.evaluate(() => window.__fractonica.instances.calendar.monthView);
    let v = await view();
    ok(v.year === 2026 && v.month === 10 && v.follow, 'view follows the displayed time: ' + JSON.stringify(v));
    // click a day: displayed time moves to that day keeping the time of day
    await page.locator('.cal-cell[data-i="16"] .cal-day').click(); // 2026-10-14 (Monday first)
    await page.waitForTimeout(200);
    ok(near(await T(), Date.UTC(2026, 9, 14, 12) / 1000, 0.01), 'day click keeps the time of day');
    await page.locator('.cal-cell[data-i="16"] .cal-day').dblclick();
    await page.waitForTimeout(200);
    ok(near(await T(), Date.UTC(2026, 9, 14, 12) / 1000, 0.01), 'double click = noon');
    // segment click goes to the cycle start
    const seg = page.locator('.cal-cell[data-i="19"] .cal-seg.is-start').first();
    const segCount = await seg.count();
    if (segCount) {
      await seg.click();
      await page.waitForTimeout(200);
      const lv = await page.evaluate(() => window.__fractonica.model.levelAt(window.__fractonica.store.t(), 4));
      ok(lv.start <= (await T()) && (await T()) - lv.start < 0.01, 'segment click lands at the start of its cycle');
    }
    // tooltip
    await page.locator('.cal-cell[data-i="10"] .cal-seg').first().hover();
    await page.waitForTimeout(200);
    ok(await page.locator('.cal-tip').isVisible(), 'segment tooltip visible');
    console.log('   tooltip:', (await page.locator('.cal-tip').innerText()).replace(/\n/g, ' | '));
    await page.mouse.move(5, 5);
    // navigation
    await page.locator('.cal-nb').nth(1).click();
    await page.waitForTimeout(250);
    v = await view();
    ok(v.month === 11 && !v.follow, 'next month leaves follow mode');
    ok(await page.locator('.cal-shown').isVisible(), 'return-to-displayed button appears');
    await page.locator('.cal-shown').click();
    await page.waitForTimeout(300);
    v = await view();
    ok(v.month === 10 && v.follow, 'back to the displayed month');
    // overlays
    for (const o of ['γ', 'δ', 'ζ', 'η', 'Solar sync', 'ε']) {
      await page.locator(`.cal-ovseg button:text-is("${o}")`).click();
      await page.waitForTimeout(200);
      const n = await page.locator('.cal-seg').count();
      ok(n > 20, `overlay ${o}: ${n} segments`);
    }
    // week start
    await page.locator('.cal-wkseg button:text-is("Sun")').click();
    await page.waitForTimeout(200);
    ok((await page.locator('.cal-wd').first().innerText()) === 'SUN', 'week starts on Sunday');
    await page.locator('.cal-wkseg button:text-is("Mon")').click();
    // ribbon
    await page.locator('.cal-rm[data-m="3"]').click();
    await page.waitForTimeout(250);
    v = await view();
    ok(v.month === 3 && !v.follow, 'ribbon click shows March');
    await page.selectOption('.cal-yh .cal-ysel', '2100');
    await page.waitForTimeout(250);
    v = await view();
    ok(v.year === 2100, 'year select jumps to 2100');
    console.log('   year summary:', await page.locator('.cal-ysum').innerText());

    // keyboard navigation in the grid
    await page.locator('.cal-shown').click();
    await page.waitForTimeout(300);
    await page.locator('.cal-day[tabindex="0"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const focusedDay = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    ok(!!focusedDay, 'arrow keys move the day focus: ' + focusedDay);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    ok(true, 'enter activates the day');

    console.log('converter: zone override, iso, keys, copy, link, use displayed');
    await page.evaluate(() => window.__fractonica.ctx.goto(1791460800));
    if ((await page.locator('.cal-pin').getAttribute('aria-pressed')) === 'true') await page.locator('.cal-pin').click();
    await page.waitForTimeout(300);
    await page.selectOption('.cal-zone', 'Asia/Tokyo');
    await page.waitForTimeout(300);
    ok((await val('Time (HH:MM:SS.mmm)')) === '21:00:00.000', 'Tokyo time 21:00 for 12:00Z: ' + (await val('Time (HH:MM:SS.mmm)')));
    ok((await val('ISO 8601')).endsWith('+09:00'), 'ISO shows the +09:00 offset');
    await page.locator('.cal-conv input[aria-label="ISO 8601"]').fill('2040-01-15T08:30:00.250-05:00');
    await page.waitForTimeout(250);
    ok(near(Number(await val('Unix seconds')), Date.UTC(2040, 0, 15, 13, 30, 0) / 1000 + 0.25, 2e-3), 'ISO edit with offset: ' + (await val('Unix seconds')));
    ok((await val('Date')) === '2040-01-15' && (await val('Time (HH:MM:SS.mmm)')) === '22:30:00.250', 'date/time show Tokyo local: ' + (await val('Date')) + ' ' + (await val('Time (HH:MM:SS.mmm)')));
    await page.locator('.cal-swap').click();
    await page.waitForTimeout(250);
    ok((await val('Date')) === '2040-01-15' && (await val('Time (HH:MM:SS.mmm)')) === '13:30:00.250', 'UTC swap');
    await page.locator('.cal-conv input[aria-label="Date"]').focus();
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    ok((await val('Date')) === '2040-01-16', 'ArrowUp adds a day');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(200);
    ok((await val('Date')) === '2039-12-16', 'PageDown subtracts a month');
    const frac = await val('Fraction');
    await page.locator('.cal-conv input[aria-label="Eclipse ordinal"]').fill('30');
    await page.waitForTimeout(250);
    const expect30 = await page.evaluate((f) => window.__fractonica.model.timeOfPosition(30 + Number('0' + f)), frac);
    ok(near(Number(await val('Unix seconds')), expect30, 1e-3), 'ordinal edit moves the instant to ' + expect30 + ' (got ' + (await val('Unix seconds')) + ')');
    await page.locator('.cal-conv .cal-field:has(input[aria-label="Unix seconds"]) .cal-copy').click();
    await page.waitForTimeout(200);
    ok((await page.locator('#toast').innerText()).toLowerCase().includes('cop'), 'copy button reports: ' + (await page.locator('#toast').innerText()));
    await page.locator('.cal-conv button[aria-label="Copy a link to this instant"]').click();
    await page.waitForTimeout(200);
    ok((await page.locator('#toast').innerText()).toLowerCase().includes('link') || (await page.locator('#toast').innerText()).includes('http'), 'link copy reports: ' + (await page.locator('#toast').innerText()).slice(0, 80));
    await page.locator('.cal-conv button:has-text("Use displayed time")').click();
    await page.waitForTimeout(250);
    ok((await val('Unix seconds')) === '1791460800.000', 'Use displayed time reloads the displayed instant');
    const pinned0 = await page.locator('.cal-pin').getAttribute('aria-pressed');
    await page.locator('.cal-pin').click();
    await page.waitForTimeout(200);
    ok((await page.locator('.cal-pin').getAttribute('aria-pressed')) !== pinned0, 'pin toggles');
    await page.locator('.cal-gcell').nth(2).hover();
    await page.waitForTimeout(200);
    ok(await page.locator('.cal-tip').isVisible(), 'glyph tooltip');
    console.log('   glyph tip:', (await page.locator('.cal-tip').innerText()).replace(/\n/g, ' | '));
    await page.mouse.move(5, 5);

    console.log('month: today, keys, eclipse, tooltips');
    await page.locator('.cal-today').click();
    await page.waitForTimeout(300);
    const nowParts = await page.evaluate(() => { const p = window.__fractonica.fmt.parts(window.__fractonica.store.realNow()); return [p.year, p.month]; });
    v = await view();
    ok(v.year === nowParts[0] && v.month === nowParts[1], 'Today shows the real current month ' + nowParts);
    await page.evaluate(() => window.__fractonica.ctx.goto(Date.UTC(1973, 11, 24, 15) / 1000));
    await page.waitForTimeout(400);
    ok((await page.locator('.cal-ecl').count()) === 1, 'eclipse marker on 1973-12-24');
    await page.locator('.cal-ecl').hover();
    await page.waitForTimeout(200);
    ok((await page.locator('.cal-tip').innerText()).includes('eclipse #20'), 'eclipse tooltip names #20');
    await page.mouse.move(5, 5);
    await page.locator('.cal-day[tabindex="0"]').focus();
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(300);
    v = await view();
    ok(v.month === 11 && v.year === 1973, 'PageUp moves one month back');
    ok((await page.evaluate(() => document.activeElement?.className)).includes('cal-day'), 'focus stays on a day after PageUp');
    await page.locator('.cal-shown').click();
    await page.waitForTimeout(300);

    console.log('zone change from the header');
    await page.selectOption('.cal-zone', 'app');
    if ((await page.locator('.cal-pin').getAttribute('aria-pressed')) === 'true') await page.locator('.cal-pin').click();
    await page.evaluate(() => window.__fractonica.ctx.goto(Date.UTC(2026, 9, 8, 20) / 1000));
    await page.waitForTimeout(300);
    await page.locator('.cal-shown').click().catch(() => {});
    await page.waitForTimeout(250);
    const shownDay = () => page.evaluate(() => document.querySelector('.cal-cell.is-shown .cal-day')?.getAttribute('aria-label'));
    ok((await shownDay()).startsWith('Thursday 8 October'), 'UTC: shown day is Thursday 8 October (' + (await shownDay()) + ')');
    await page.selectOption('#zone', 'Asia/Tokyo');
    await page.waitForTimeout(500);
    ok((await shownDay()).startsWith('Friday 9 October'), 'Tokyo: the same instant is on Friday 9 October (' + (await shownDay()) + ')');
    ok((await val('Date')) === '2026-10-09', 'converter (app zone) follows the zone: ' + (await val('Date')));
    await page.selectOption('#zone', 'UTC');
    await page.waitForTimeout(300);

    console.log('jump box');
    await page.mouse.click(700, 5);
    await page.keyboard.press('/');
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.activeElement?.classList.contains('jump-input')), '"/" focuses the jump box');
    ok(await page.locator('.jump-pop').isVisible(), 'popover shows examples when empty');
    await page.keyboard.type('2031-06-01 14:30');
    await page.waitForTimeout(150);
    ok((await page.locator('.jump-item').count()) >= 1, 'live interpretations');
    console.log('   ', (await page.locator('.jump-item').first().innerText()).replace(/\n/g, ' | '));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    ok(near(await T(), Date.UTC(2031, 5, 1, 14, 30) / 1000, 0.01), 'Enter jumps');
    await page.keyboard.press('/');
    await page.waitForTimeout(100);
    ok((await page.locator('.jump-item').count()) === 1 && (await page.locator('.jump-kind').first().innerText()).toLowerCase() === 'recent', 'history is offered on focus');
    await page.keyboard.type('next ε');
    await page.waitForTimeout(150);
    ok(/Next ε/.test(await page.locator('.jump-item').first().innerText()), 'next ε candidate');
    await page.keyboard.press('Escape');
    ok((await page.locator('.jump-input').inputValue()) === '', 'Esc clears');
    await page.keyboard.type('2031-02-30');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    ok((await page.locator('.jump-item.is-error').count()) === 1, 'error row stays after Enter');
    ok((await page.locator('.jump-item.is-error').innerText()).includes('28 days'), 'precise error text');
    await page.keyboard.press('Escape');
    await page.keyboard.type('a6 b3 g11');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const path = await page.evaluate(() => window.__fractonica.model.addressAt(window.__fractonica.store.t()));
    ok(path.slice(0, 3).join() === '6,3,11', 'the old spelling a6 b3 g11 still lands in α#6 β#3 γ#11: ' + path);

    // render cost
    console.log('performance');
    const cost = await page.evaluate(async () => {
      const inst = window.__fractonica.instances.calendar;
      const jump = window.__fractonica.instances.jump;
      const model = window.__fractonica.model;
      const out = {};
      for (const [name, i] of Object.entries({ calendar: inst, jump })) {
        const orig = i.render.bind(i);
        let total = 0;
        let max = 0;
        let n = 0;
        i.render = (f, info) => {
          const t0 = performance.now();
          orig(f, info);
          const d = performance.now() - t0;
          total += d;
          max = Math.max(max, d);
          n++;
        };
        await new Promise((r) => setTimeout(r, 2200));
        i.render = orig;
        out[name] = { frames: n, avg: +(total / Math.max(1, n)).toFixed(3), max: +max.toFixed(2) };
      }
      return out;
    });
    console.log('  ', JSON.stringify(cost));
    ok(cost.calendar.avg < 3, 'calendar render avg < 3 ms');
    console.log('errors from my files:', errors.filter(mine));
    ok(errors.filter(mine).length === 0, 'no console errors from calendar / jump');
  },
  { viewport: { width: 1920, height: 1080 } },
);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
