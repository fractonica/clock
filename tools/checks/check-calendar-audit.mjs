// Checks for the audit round on the calendar tab and the jump box (headless Chromium): one notation (ε#5 is an
// ordinal, "ε 5" is a depth chip), a jump box that survives any paste, the converter's sync field and DST notes,
// floored percentages, the nominal count in the clipped last cycles, a pulse that costs nothing, touch footers.
//   node tools/checks/check-calendar-audit.mjs
import { withApp } from '../browse.mjs';

const mine = (e) => /calendar|jump|cal-/i.test(e);
let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('  FAIL', msg);
  } else console.log('  ok  ', msg);
};
const wait = (page, ms) => page.waitForTimeout(ms);
const text = (loc) => loc.innerText();

await withApp(
  async ({ page, url, errors, browser, shot }) => {
    const field = (label) => page.locator(`.cal-conv input[aria-label="${label}"]`);
    const open = async (q) => {
      await page.goto(url(q));
      await wait(page, 700);
    };
    const jumpItems = async () => page.evaluate(() => [...document.querySelectorAll('.jump-item')].map((li) => ({ kind: li.querySelector('.jump-kind')?.textContent, label: li.querySelector('.jump-label')?.textContent, detail: li.querySelector('.jump-detail')?.textContent ?? '' })));
    const type = async (txt) => {
      await page.locator('.jump-input').click();
      await page.evaluate(() => (document.querySelector('.jump-input').value = ''));
      await page.keyboard.insertText(txt);
      await wait(page, 120);
    };
    // (another module's time handler may throw while it is being edited: the store state is set before it is called)
    const store = (fn) =>
      page.evaluate((src) => {
        try {
          return new Function('f', 'return (' + src + ')(f)')(window.__fractonica);
        } catch (e) {
          return 'threw: ' + e.message;
        }
      }, fn.toString());

    // -----------------------------------------------------------------------------------------
    console.log('1. notation: ε#5 is an ordinal, a bare "ε 5" is only ever the depth chip of the other views');
    await open('?t=1791460800&view=calendar&zone=UTC&sel=4');
    const cells = await page.evaluate(() => ({
      segs: [...document.querySelectorAll('.cal-seg span')].map((s) => s.textContent).filter(Boolean),
      shown: document.querySelector('.cal-cell.is-shown .cal-day').getAttribute('aria-label'),
      insp: document.querySelector('.cal-inspect').innerText,
      legend: document.querySelector('.cal-legend').innerText,
      ribbon: [...document.querySelectorAll('.cal-rt.is-delta span')].map((s) => s.textContent),
      ysum: document.querySelector('.cal-ysum').innerText,
      chain: document.querySelector('.cal-result').innerText,
    }));
    ok(cells.segs.length > 5 && cells.segs.every((t) => /^(ε#\d|#\d|\d)$/.test(t)), 'month cell labels are ε#n / #n / n: ' + [...new Set(cells.segs)].join(' '));
    ok(!cells.segs.some((t) => /^ε\s?\d/.test(t)), 'no cell says "ε 5" or "ε5"');
    ok(/Epsilon cycles: ε#5 continuing/.test(cells.shown), 'the displayed day names ε#5: ' + cells.shown);
    ok(/ε#5/.test(cells.insp) && !/ε ?5\b/.test(cells.insp.replace(/ε#5/g, '')), 'the inspector says ε#5');
    ok(/ε#5.*5th ε inside its δ/.test(cells.legend), 'the legend explains the hash: ' + cells.legend.replace(/\n/g, ' '));
    ok(cells.ribbon.every((t) => /^δ#\d$/.test(t)) && /γ#\d+·δ#\d+/.test(cells.ysum), 'ribbon ticks and the year summary use it: ' + cells.ribbon.join(',') + ' | ' + cells.ysum);
    ok(/α#6 › β#4 › γ#9/.test(cells.chain), 'the converter result reads α#6 › β#4 › γ#9: ' + cells.chain.split('\n')[0]);
    await page.locator('.cal-cell[data-i="8"] .cal-seg').first().hover();
    await wait(page, 200);
    const tip = await text(page.locator('.cal-tip'));
    ok(/ε#5 · 5 \/ 5 in δ#3/.test(tip) && /global index \d+/.test(tip) && /d5#\d+/.test(tip), 'the segment tooltip: ' + tip.replace(/\n/g, ' | ').slice(0, 150));
    await page.mouse.move(5, 5);

    // the same cycle by three routes: the ladder's chip, the calendar cell, the jump box
    await open('?t=1791460800&view=calendar&zone=UTC&sel=5');
    const ladder = await page.evaluate(() => document.querySelector('#slot-ladder')?.innerText ?? '');
    ok(/ζ\s*6/.test(ladder) && /4\s*\/\s*7/.test(ladder), 'the ladder row for zeta reads ζ 6 · 4 / 7 (depth 6, 4th of 7): ' + (ladder.match(/ζ[^\n]*\n?[^\n]*/) ?? [''])[0].replace(/\n/g, ' '));
    await type('ζ 6');
    let items = await jumpItems();
    ok(items.length === 2 && items[0].label === 'The 6th ζ in the current ε' && items[1].label === 'The running ζ (depth 6)', 'typing the ladder label "ζ 6": ' + JSON.stringify(items.map((i) => i.label)));
    ok(/ζ#4 · 4 \/ 7 in its ε/.test(items[1].detail), 'the depth reading names it ζ#4, 4 / 7: ' + items[1].detail.slice(0, 120));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await wait(page, 300);
    const landed = await page.evaluate(() => {
      const f = window.__fractonica;
      const l = f.model.levelAt(f.store.t(), 5);
      return { local: l.local + 1, start: l.start, t: f.store.t() };
    });
    ok(landed.local === 4 && landed.t - landed.start < 0.01, 'choosing the second row goes to the start of the running ζ (ζ#4): ' + JSON.stringify(landed));
    await type('next ζ');
    items = await jumpItems();
    ok(/^ζ#\d+ ends · ζ#\d+ starts$/.test(items[0].detail.split(' · ').slice(-2).join(' · ')), 'next ζ says what ends and what starts: ' + items[0].detail);
    await page.keyboard.press('Escape');

    // -----------------------------------------------------------------------------------------
    console.log('2. jump box: a huge paste leaves the page responsive and is never echoed');
    await open('?t=1791460800&view=calendar&zone=UTC');
    ok((await page.locator('.jump-input').getAttribute('maxlength')) === '200', 'the input has maxlength 200');
    await page.locator('.jump-input').click();
    await page.keyboard.insertText('1,'.repeat(50000));
    ok((await page.locator('.jump-input').inputValue()).length === 200, 'a 100 KB paste is cut to 200 characters by the field');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    for (const [name, mk] of [
      ['1, x 50000', () => '1,'.repeat(50000)],
      ['α x 100000', () => 'α'.repeat(100000)],
      ['d7 1,… 40 KB', () => 'd7 ' + '1,'.repeat(20000)],
      ['sync 9… x 50000', () => 'sync ' + '9'.repeat(50000)],
    ]) {
      // (a script can set more than maxlength allows: the parser itself must hold)
      const frames = await page.evaluate(
        async (txt) => {
          const input = document.querySelector('.jump-input');
          input.focus();
          const t0 = performance.now();
          input.value = txt;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const typed = performance.now() - t0;
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const maxLabel = Math.max(...[...document.querySelectorAll('.jump-label')].map((l) => l.textContent.length), 0);
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { typed: Math.round(typed), total: Math.round(performance.now() - t0), maxLabel };
        },
        mk(),
      );
      ok(frames.total < 200 && frames.maxLabel <= 80, `${name}: input + Enter settle in ${frames.total} ms, longest label ${frames.maxLabel} characters`);
    }
    await type('x'.repeat(150));
    items = await jumpItems();
    ok(items.length === 1 && items[0].label.length <= 60 && /…"$/.test(items[0].label), 'a 150-character unknown input is echoed in ~40: ' + items[0].label);
    await type('+100000000d');
    items = await jumpItems();
    ok(/after the catalogue ends \(2857-06-13 UTC\)/.test(items[0].label) && !/Invalid/.test(items[0].label), 'a huge offset says "after the catalogue ends": ' + items[0].label);
    await page.keyboard.press('Escape');

    // -----------------------------------------------------------------------------------------
    console.log('3. converter: the solar sync box takes 309+ digits without an exception, DST gaps and folds are explained');
    await open('?t=1791460800&view=calendar&zone=America/New_York');
    const before = errors.length;
    const sync = page.locator('.cal-syncrow .cal-sv');
    await sync.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('9'.repeat(400));
    await wait(page, 250);
    ok(errors.length === before, 'no uncaught RangeError for 400 digits' + (errors.length > before ? ': ' + errors.slice(before).join(' | ') : ''));
    ok(await page.locator('.cal-syncrow ~ .cal-err').first().isVisible(), 'an inline message is shown: ' + (await text(page.locator('.cal-syncrow ~ .cal-err').first())));
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('-' + '1'.repeat(320));
    await wait(page, 200);
    ok(errors.length === before, 'nor for a negative number');
    await sync.press('Enter');
    await wait(page, 200);
    ok(/Too large/.test(await text(page.locator('.cal-syncrow ~ .cal-err').first())), 'Enter says it is too large, not "type a whole number"');
    await sync.press('Escape');
    await page.mouse.click(5, 300);
    await wait(page, 200);
    ok(/^-?\d+$/.test(await sync.inputValue()) && !(await page.locator('.cal-syncrow ~ .cal-err').first().isVisible()), 'Escape / blur bring the real sync number back');

    const timeIn = field('Time (HH:MM:SS.mmm)');
    const dateIn = field('Date');
    await dateIn.fill('2027-03-14');
    await dateIn.press('Enter');
    await timeIn.fill('02:30');
    await timeIn.press('Enter');
    await wait(page, 300);
    const gapNote = page.locator('.cal-note');
    ok(await gapNote.isVisible(), 'the gap note appears');
    ok(/02:30 does not exist in America\/New York \(the clocks skip it\): moved ahead to 03:30/.test(await text(gapNote)), 'wording: ' + (await text(gapNote)));
    ok((await timeIn.inputValue()) === '03:30:00.000', 'the Time field shows what was converted (03:30), not 02:30: ' + (await timeIn.inputValue()));
    ok((await field('ISO 8601').inputValue()).startsWith('2027-03-14T03:30:00.000-04:00'), 'ISO agrees: ' + (await field('ISO 8601').inputValue()));
    await dateIn.fill('2027-03-15');
    await dateIn.press('Enter');
    await wait(page, 250);
    ok(!(await gapNote.isVisible()), 'the note goes away when the instant changes');
    await dateIn.fill('2026-11-01');
    await dateIn.press('Enter');
    await timeIn.fill('01:30');
    await timeIn.press('Enter');
    await wait(page, 250);
    ok(/01:30 happens twice in America\/New York \(the clocks go back\): showing the first/.test(await text(gapNote)), 'fold wording: ' + (await text(gapNote)));
    ok((await field('ISO 8601').inputValue()).includes('-04:00'), 'the first (EDT) instance is used: ' + (await field('ISO 8601').inputValue()));
    const iso = field('ISO 8601');
    await iso.fill('2027-03-14T02:30:00');
    await iso.press('Enter');
    await wait(page, 250);
    ok(/does not exist/.test(await text(gapNote)) && (await timeIn.inputValue()) === '03:30:00.000', 'an ISO string without offset gets the same note and the Time field follows');
    await iso.fill('2027-03-14T02:30:00-05:00');
    await iso.press('Enter');
    await wait(page, 250);
    ok(!(await gapNote.isVisible()), 'with an explicit offset there is nothing to explain');
    // the same sentence as the jump box
    await type('2027-03-14 02:30');
    items = await jumpItems();
    ok(/02:30 does not exist there \(the clocks skip it\): moved ahead to 03:30/.test(items[0].detail), 'the jump box says it the same way: ' + items[0].detail.slice(-90));
    await page.keyboard.press('Escape');

    // -----------------------------------------------------------------------------------------
    console.log('4. percent through a cycle is floored (never 100.0 % before the cycle has ended)');
    const eta = await page.evaluate(() => {
      const f = window.__fractonica;
      return f.model.levelAt(1791460800, 6).end;
    });
    await open(`?t=${(eta - 0.001).toFixed(3)}&view=calendar&zone=UTC&sel=6`);
    const aria = await page.evaluate(() => document.querySelectorAll('.cal-gcell')[6].getAttribute('aria-label'));
    const barP = await page.evaluate(() => document.querySelectorAll('.cal-gcell')[6].querySelector('.cal-gbar').style.getPropertyValue('--p'));
    ok(/99\.9 percent/.test(aria) && !/100\.0/.test(aria), 'η glyph 1 ms before its end: ' + aria.replace(/.*state/, 'state').slice(0, 60));
    ok(barP === '99.9%', 'the bar variable is 99.9%: ' + barP);
    await page.locator('.cal-gcell').nth(6).hover();
    await wait(page, 200);
    ok(/99\.99 % through η#/.test(await text(page.locator('.cal-tip'))), 'the glyph tooltip floors too: ' + (await text(page.locator('.cal-tip'))).split('\n')[2]);
    await page.mouse.move(5, 5);
    await open('?t=1791460800&view=calendar&zone=UTC&sel=6');
    const eps = await page.evaluate(() => {
      const f = window.__fractonica;
      const l = f.model.levelAt(1791460800, 1);
      return [l.phase, document.querySelectorAll('.cal-gcell')[1].getAttribute('aria-label')];
    });
    const flo = (Math.floor(eps[0] * 1000 + 1e-7) / 10).toFixed(1);
    ok(eps[1].includes(`${flo} percent`), `β at vector A: phase ${eps[0]} prints ${flo}: ` + eps[1].match(/[\d.]+ percent/)?.[0]);

    // -----------------------------------------------------------------------------------------
    console.log('5. clipped last cycles show the nominal count and keep the stepper on cycles that exist');
    await open('?t=28005212030&view=calendar&zone=UTC');
    await page.locator('.cal-dchip').nth(6).click();
    await wait(page, 300);
    const steps = await page.evaluate(() =>
      [...document.querySelectorAll('.cal-step:not([hidden])')].map((s) => ({ v: s.querySelector('input').value, of: s.querySelector('.cal-sn').textContent, note: s.querySelector('.cal-snote').hidden ? '' : s.querySelector('.cal-snote').textContent })),
    );
    const want = [
      ['2', '/ 5', 'catalogue ends after 2'],
      ['4', '/ 13', 'catalogue ends after 4'],
      ['9', '/ 11', 'catalogue ends after 9'],
    ];
    ok(steps[1].v === '2' && steps[1].of === '/ 5' && steps[1].note === 'catalogue ends after 2', 'β: 2 / 5 and the note: ' + JSON.stringify(steps[1]));
    ok(steps[2].v === '4' && steps[2].of === '/ 13' && steps[2].note === 'catalogue ends after 4', 'γ: 4 / 13 and the note: ' + JSON.stringify(steps[2]));
    ok(steps[6].v === '9' && steps[6].of === '/ 11' && steps[6].note === 'catalogue ends after 9', 'η: 9 / 11 and the note: ' + JSON.stringify(steps[6]));
    ok(want.length === 3 && steps[0].note === '', 'α, whose parent is the catalogue, has no note');
    const beta = page.locator('.cal-step:nth-child(2) .cal-sv');
    await beta.fill('3');
    await wait(page, 200);
    const betaErr = await text(page.locator('.cal-step:nth-child(2) .cal-serr'));
    ok(/only 2 cycles here \(β#1 … β#2, the catalogue ends after β#2\)/.test(betaErr), 'typing 3 is refused: ' + betaErr);
    ok(await page.locator('.cal-step:nth-child(2) .cal-sb').nth(1).isEnabled(), '(the + button stays a button; stepping past the end toasts)');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.locator('.cal-dchip').nth(4).click();
    await wait(page, 250);
    const mid = await page.evaluate(() => [...document.querySelectorAll('.cal-step:not([hidden])')].map((s) => s.querySelector('.cal-sn').textContent + (s.querySelector('.cal-snote').hidden ? '' : '!')).join(' '));
    ok(/^\/ 18 \/ 5 \/ 13 \/ 5 \/ 5$/.test(mid), 'in the middle of the catalogue nothing is flagged: ' + mid);

    // -----------------------------------------------------------------------------------------
    console.log('6. the "following" dot pulses on the compositor only, and not at all when nothing moves');
    const animProps = () =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('.cal-root'))
          .map((a) => ({ name: a.animationName, props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)) })),
      );
    await open('?view=calendar&zone=UTC');
    let anims = await animProps();
    ok(anims.length === 1 && anims[0].name === 'cal-pulse' && anims[0].props.sort().join() === 'opacity,transform', 'live clock: one running animation (cal-pulse) that changes only opacity and transform: ' + JSON.stringify(anims));
    await open('?t=1791460800&view=calendar&zone=UTC');
    anims = await animProps();
    ok(anims.length === 0, 'a paused clock: nothing animates in the calendar tab (' + anims.length + ')');
    await store((f) => f.store.setRate(60));
    await wait(page, 300);
    ok((await animProps()).length === 1, 'time-lapse: the dot pulses');
    await store((f) => f.store.pause());
    await wait(page, 300);
    ok((await animProps()).length === 0, 'pausing stops it again');
    ok((await page.locator('.cal-dot.is-still').count()) === 1, 'the still dot keeps its place and colour');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open('?view=calendar&zone=UTC');
    ok((await animProps()).length === 0, 'prefers-reduced-motion: no pulse');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // idle cost of the tab, measured with the old box-shadow pulse injected for comparison
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const cpu = async (ms) => {
      const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
      const a = await task();
      await wait(page, ms);
      return (((await task()) - a) / (ms / 1000)) * 100;
    };
    // (the audit's scenario: the calendar tab with the clock paused cost ~12 % of a core against ~3 % for the other tabs)
    await open('?view=calendar&zone=UTC&t=1791460800&rate=0');
    await wait(page, 500);
    const now = await cpu(5000);
    await page.addStyleTag({ content: '.cal-dot.is-still{box-shadow:0 0 0 0 rgb(91 216 138/.6);animation:old-pulse 2.4s infinite} @keyframes old-pulse{70%{box-shadow:0 0 0 6px rgb(91 216 138/0)}100%{box-shadow:0 0 0 0 rgb(91 216 138/0)}}' });
    await wait(page, 500);
    const old = await cpu(5000);
    console.log(`   idle main-thread CPU, clock paused: ${now.toFixed(1)} % now, ${old.toFixed(1)} % with the old always-on box-shadow pulse injected`);
    ok(now < old && now < 6, `a paused calendar tab is as cheap as the others (${now.toFixed(1)} % vs ${old.toFixed(1)} %)`);

    // -----------------------------------------------------------------------------------------
    console.log('7. jump box: the key hints appear only where they help');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await page.locator('.jump-input').click();
    const foot0 = await page.evaluate(() => ({ t: document.querySelector('.jump-foot').textContent, hidden: document.querySelector('.jump-foot').hidden }));
    await type('+3d');
    const foot1 = await page.evaluate(() => ({ t: document.querySelector('.jump-foot').textContent, hidden: document.querySelector('.jump-foot').hidden, n: document.querySelectorAll('.jump-item').length }));
    ok(foot1.n === 1 && foot1.t === 'Enter go · Esc clear', 'one candidate: no "↑↓ choose": ' + JSON.stringify(foot1));
    await type('ζ 6');
    const foot2 = await page.evaluate(() => document.querySelector('.jump-foot').textContent);
    ok(foot2 === '↑↓ choose · Enter go · Esc clear', 'two candidates: the full hint: ' + foot2);
    await type('qqq zzz');
    const foot3 = await page.evaluate(() => ({ t: document.querySelector('.jump-foot').textContent, hidden: document.querySelector('.jump-foot').hidden }));
    ok(foot3.hidden && foot3.t === '', 'nothing to choose: no hint');
    await page.keyboard.press('Escape');
    ok(foot0.t.length >= 0, 'empty box: ' + JSON.stringify(foot0));
    await page.evaluate(() => localStorage.removeItem('fractonica-clock/jump/v1'));
    await page.reload();
    await wait(page, 600);
    await page.keyboard.press('/');
    await wait(page, 150);
    const exs = await jumpItems();
    ok(exs.length >= 8 && exs.every((e) => e.kind === 'Try'), 'examples are offered: ' + exs.map((e) => e.label).join(' · '));
    ok(exs.some((e) => /Tokyo/.test(e.label)) && exs.some((e) => /#6/.test(e.label)) && exs.some((e) => /slashes read/.test(e.detail)), 'they show a zone, the hash notation and how slashes are read');
    for (const e of exs.filter((x) => !/^d7/.test(x.label))) {
      await type(e.label);
      const r = await jumpItems();
      ok(r.length >= 1 && r[0].kind !== 'Check', `example "${e.label}" parses: ${r[0].kind} ${r[0].label.slice(0, 50)}`);
    }
    await page.keyboard.press('Escape');

    // en-US reads slashes month first; touch devices get no key hints
    const us = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    const up = await us.newPage();
    await up.goto(url('?t=1791460800&view=calendar&zone=UTC'));
    await up.waitForTimeout(600);
    await up.locator('.jump-input').click();
    await up.keyboard.insertText('06/01/2031 14:30');
    await up.waitForTimeout(150);
    const usItems = await up.evaluate(() => [...document.querySelectorAll('.jump-label')].map((l) => l.textContent));
    ok(/^Sun 1 Jun 2031.*month\/day/.test(usItems[0]) && /^Mon 6 Jan 2031.*day\/month/.test(usItems[1]), 'en-US: June 1 is the default row: ' + usItems.join(' | '));
    await up.keyboard.press('Enter');
    await up.waitForTimeout(250);
    ok((await up.evaluate(() => new Date(window.__fractonica.store.t() * 1000).toISOString())) === '2031-06-01T14:30:00.000Z', 'Enter takes June 1');
    await us.close();
    const gb = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
    const gp = await gb.newPage();
    await gp.goto(url('?t=1791460800&view=calendar&zone=UTC'));
    await gp.waitForTimeout(600);
    await gp.locator('.jump-input').click();
    await gp.keyboard.insertText('06/01/2031 14:30');
    await gp.waitForTimeout(150);
    const gbItems = await gp.evaluate(() => [...document.querySelectorAll('.jump-label')].map((l) => l.textContent));
    ok(/^Mon 6 Jan 2031/.test(gbItems[0]), 'en-GB: 6 January is the default row: ' + gbItems.join(' | '));
    await gb.close();

    const tc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const tp = await tc.newPage();
    tp.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await tp.goto(url('?t=1791460800&view=calendar&zone=UTC'));
    await tp.waitForTimeout(800);
    await tp.locator('.jump-input').tap();
    await tp.waitForTimeout(250);
    const tf = await tp.evaluate(() => ({ t: document.querySelector('.jump-foot').textContent, hidden: document.querySelector('.jump-foot').hidden, ph: document.querySelector('.jump-input').placeholder }));
    ok(!/↑|Enter|Esc/.test(tf.t) && /tap one/.test(tf.t), 'touch, empty box: the footer talks about tapping, not keys: ' + tf.t);
    await tp.keyboard.insertText('ζ 6');
    await tp.waitForTimeout(200);
    const tf2 = await tp.evaluate(() => ({ t: document.querySelector('.jump-foot').textContent, hidden: document.querySelector('.jump-foot').hidden }));
    ok(tf2.hidden && tf2.t === '', 'touch, results: no footer at all');
    console.log('   ', JSON.stringify(await tp.evaluate(() => [...document.querySelectorAll('.jump-item')].map((l) => l.querySelector('.jump-label').textContent))));
    await tp.screenshot({ path: 'tools/out/cal-audit-mobile-jump.png' });
    await tc.close();

    // -----------------------------------------------------------------------------------------
    console.log('8. screenshots');
    await open('?t=1791460800&view=calendar&zone=UTC');
    await shot('cal-audit-desktop.png');
    console.log('   tools/out/cal-audit-desktop.png');

    console.log('errors from my files:', errors.filter(mine));
    ok(errors.filter(mine).length === 0, 'no console errors from calendar / jump');
  },
  { viewport: { width: 1440, height: 900 } },
);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
