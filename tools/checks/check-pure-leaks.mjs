// Pure-mode acceptance check: nothing Gregorian, Earth-unit or percentage may be visible anywhere in pure mode.
//   node tools/checks/check-pure-leaks.mjs [--soft] [tab ...]
import { withApp } from '../browse.mjs';
import { installHooks, scan, drainCanvas, hoverSweep, hoverInteractive, formatLeaks } from '../pure-scan.mjs';

const soft = process.argv.includes('--soft');
const onlyTabs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TABS = onlyTabs.length ? onlyTabs : ['rings', 'timeline', 'wave', 'calendar', 'sound', 'diary'];
const T = 1791460800; // SPEC vector A
const INSTANTS = [
  ['vector A', T],
  ['year 2000', 946684800],
  ['year 2061', 2886085800],
  ['catalogue start', -11253795486 + 5],
  ['catalogue end', 28005212035 - 5],
];
const all = [];
const note = (leaks) => { all.push(...leaks); };

await withApp(async ({ page, url, errors }) => {
  await installHooks(page);
  for (const tab of TABS) {
    for (const [name, t] of INSTANTS) {
      const state = `${tab} @ ${name}`;
      await page.goto(url(`?pure=1&t=${t}&view=${tab}`));
      await page.waitForTimeout(700);
      note(await scan(page, state));
      // open every help / details toggle
      const toggles = await page.$$('button[aria-expanded="false"], summary, button:has-text("How to read"), button:has-text("help")');
      for (const b of toggles.slice(0, 8)) { try { await b.click({ timeout: 500 }); } catch { /* not clickable */ } }
      await page.waitForTimeout(200);
      note(await scan(page, state + ' · help open'));
      if (name === 'vector A') {
        note(await hoverSweep(page, state, { cols: 10, rows: 6 }));
        note(await hoverInteractive(page, state));
        // other states: selected levels, depth ranges, time-lapse, scrubbing
        for (const sel of [0, 3, 8, 12]) {
          await page.evaluate((s) => __fractonica.store.set({ selectedLevel: s }), sel);
          await page.waitForTimeout(250);
          note(await scan(page, `${state} · selected depth ${sel + 1}`));
        }
        for (const rate of [18188.9, -505.2, 100038.9, 3501360]) {
          await page.evaluate((r) => __fractonica.store.setRate(r), rate);
          await page.waitForTimeout(500);
          note(await scan(page, `${state} · rate ${rate}`));
        }
        await page.evaluate(() => __fractonica.store.goLive());
        await page.waitForTimeout(500);
        note(await scan(page, `${state} · live`));
      }
    }
    if (tab === 'wave') {
      for (const depthSel of [4, 6]) {
        await page.goto(url(`?pure=1&t=${T}&view=wave&solar=1&sel=${depthSel}`));
        await page.waitForTimeout(800);
        note(await scan(page, `wave @ solar wave on, depth ${depthSel}`));
        note(await hoverSweep(page, `wave solar depth ${depthSel}`, { cols: 8, rows: 5 }));
      }
    }
    // narrow screen
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url(`?pure=1&t=${T}&view=${tab}`));
    await page.waitForTimeout(600);
    note(await scan(page, `${tab} @ phone`));
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  // toggling pure on and off must not leave anything behind either way
  await page.goto(url(`?t=${T}&view=rings&pure=0`));
  await page.waitForTimeout(400);
  await scan(page, 'normal mode before the toggle'); // drain what normal mode drew on canvases
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  await drainCanvas(page); // a frame drawn before the switch landed is not a pure-mode leak
  await page.waitForTimeout(200);
  note(await scan(page, 'toggled on with the P key'));
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  const back = await scan(page, 'toggled off again');
  console.log('page errors:', errors.length ? errors.slice(0, 6) : 'none');
  const hard = all.filter((l) => l.severity === 'hard');
  const text = formatLeaks(all, { soft });
  const byRule = {};
  for (const l of all) byRule[l.rule] = (byRule[l.rule] ?? 0) + 1;
  const shown = text.split('\n[').slice(0, process.argv.includes('--all') ? 1e9 : 60);
  console.log(shown.map((x, i) => (i ? '[' + x : x)).join('\n') || 'no leaks');
  console.log('\nleaks by rule:', JSON.stringify(byRule));
  console.log(`\n${hard.length} hard leak(s) in pure mode, ${all.length - hard.length} soft (${soft ? 'listed' : 'run with --soft to list'}); toggling back off shows normal text again: ${back.some((l) => /clock-time|month-name/.test(l.rule))}`);
  process.exitCode = hard.length || errors.length ? 1 : 0;
}, { viewport: { width: 1440, height: 900 } });
