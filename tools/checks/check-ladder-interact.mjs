// Interaction + performance checks for the ladder and up next cards (exit code 1 on any failure).
//   node tools/checks/check-ladder-interact.mjs
import { withApp } from '../browse.mjs';

const MINE = /\[(ladder|upnext)\]|ui\/ladder|ui\/upnext|ladder\.css/;
let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}${cond ? '' : '  ' + extra}`);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const A = 1791460800;

const st = (page) => page.evaluate(() => ({ t: __fractonica.store.t(), playing: __fractonica.store.playing, live: __fractonica.store.live, rate: __fractonica.store.rate, ...__fractonica.store.state }));
const levelAt = (page, L, t) => page.evaluate(([L, t]) => { const x = __fractonica.model.levelAt(t ?? __fractonica.store.t(), L); return x && { start: x.start, end: x.end, cycle: x.cycle }; }, [L, t ?? null]);
/** Bounding box of an element after scrolling it into the viewport: manual mouse moves need real coordinates. */
const box = async (page, sel) => {
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(60);
  return page.locator(sel).boundingBox();
};
const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

await withApp(
  async ({ page, url, errors }) => {
    // ---------------------------------------------------------------- structure + selection
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(600);
    ok((await page.locator('#slot-ladder [role=option]').count()) === 10, 'ladder lists depths 1..10');
    ok((await page.locator('#slot-ladder [role=listbox]').count()) === 1, 'ladder is a listbox');
    ok((await page.locator('#slot-ladder .ladder-row.is-selected').getAttribute('id')) === 'ladder-opt-6', 'selected row = depth 7 (?sel=7)');
    ok((await page.locator('#slot-ladder [role=listbox]').getAttribute('aria-activedescendant')) === 'ladder-opt-6', 'aria-activedescendant follows the selection');
    ok((await page.locator('#slot-ladder .ladder-detail').count()) === 1, 'exactly one expanded detail panel');
    ok((await page.locator('#slot-ladder #ladder-opt-6 .ladder-detail').count()) === 1, 'detail panel sits inside the selected row');

    // values agree with the model (spec vector A)
    const texts = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) => rows.map((r) => [r.querySelector('.ladder-count').textContent, r.querySelector('.ladder-left').textContent]));
    ok(texts[0][0] === 'cycle 6 of 18', 'alpha counter reads "cycle 6 of 18"', texts[0][0]);
    ok(texts[6][0] === '1 / 11', 'eta counter reads "1 / 11" (SPEC vector A)', texts[6][0]);
    ok(texts[7][0] === '8 / 9', 'theta counter reads "8 / 9"', texts[7][0]);
    ok(texts[6][1] === '56 min 12 s', 'eta time left = 56 min 12 s', texts[6][1]);

    // click selects
    await page.locator('#ladder-opt-5').click();
    ok((await st(page)).selectedLevel === 5, 'click on a row selects that level (shared store)');
    ok((await page.locator('#ladder-opt-5 .ladder-detail').count()) === 1, 'detail panel moved to the clicked row');
    ok((await page.locator('#ladder-opt-5').getAttribute('aria-selected')) === 'true', 'aria-selected set');

    // keyboard
    await page.locator('#slot-ladder [role=listbox]').focus();
    await page.keyboard.press('ArrowDown');
    ok((await st(page)).selectedLevel === 6, 'ArrowDown selects the next finer level');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    ok((await st(page)).selectedLevel === 4, 'ArrowUp twice');
    await page.keyboard.press('Home');
    ok((await st(page)).selectedLevel === 0, 'Home -> first level');
    await page.keyboard.press('End');
    ok((await st(page)).selectedLevel === 9, 'End -> last visible level');
    await page.keyboard.press('ArrowDown');
    ok((await st(page)).selectedLevel === 9, 'ArrowDown clamps at the last level');

    // Enter = go to just after the end of the selected cycle
    await page.keyboard.press('ArrowUp'); // level 8 (iota)
    let before = await levelAt(page, 8);
    await page.keyboard.press('Enter');
    let s = await st(page);
    ok(near(s.t, before.end + 0.001, 2e-3) && !s.live, 'Enter jumps to end+1ms of the selected cycle', `${s.t} vs ${before.end}`);
    const after = await levelAt(page, 8);
    ok(after.cycle === before.cycle + 1, 'now in the next iota cycle');

    // Shift+Enter = 2 s before the end, and runs in real time
    before = await levelAt(page, 8);
    await page.keyboard.press('Shift+Enter');
    s = await st(page);
    ok(near(s.t, before.end - 2, 0.05) && s.playing && s.rate === 1, 'Shift+Enter lands 2 s before the end and plays in real time', JSON.stringify(s));
    await page.waitForTimeout(2600);
    const passed = await levelAt(page, 8);
    ok(passed.cycle === before.cycle + 1, 'the cycle really turned over while watching');
    await page.evaluate(() => __fractonica.store.pause());

    // double click on a row
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(500);
    before = await levelAt(page, 5);
    await page.locator('#ladder-opt-5').dblclick();
    s = await st(page);
    ok(near(s.t, before.end + 0.001, 2e-3) && s.selectedLevel === 5, 'double click jumps to the end of that row\'s cycle', `${s.t} vs ${before.end}`);

    // double click on rows ABOVE and BELOW the selected one, with a real pause between the clicks (a frame passes, so the
    // first click has already moved the details under the pointer): it must still jump to the end of the clicked row
    for (const [selDepth, row] of [[5, 3], [5, 7], [5, 8], [2, 6], [8, 1], [7, 6], [7, 9]]) {
      await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=${selDepth}`));
      await page.waitForTimeout(450);
      const want = await levelAt(page, row);
      const hb = await box(page, `#ladder-opt-${row}`);
      const px = hb.x + 120;
      const py = hb.y + 12;
      await page.mouse.move(px, py);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(110);
      await page.mouse.down({ clickCount: 2 });
      await page.mouse.up({ clickCount: 2 });
      await page.waitForTimeout(80);
      s = await st(page);
      ok(near(s.t, want.end + 0.001, 2e-3) && s.selectedLevel === row && !s.playing, `double click on row ${row + 1} (selected ${selDepth}) jumps to the end of its cycle`, JSON.stringify({ t: s.t, end: want.end, sel: s.selectedLevel, playing: s.playing }));
    }
    // a single click followed (much later) by a click on a detail button is not a double click
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(450);
    const keep = (await st(page)).t;
    await page.locator('#ladder-opt-3').click();
    await page.waitForTimeout(700);
    ok(near((await st(page)).t, keep, 1e-6), 'a single click only selects');
    await page.locator('#slot-ladder .ladder-detail [data-act=start]').click();
    ok((await st(page)).t < keep, 'a later click on a detail button still acts');

    // detail buttons
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(500);
    before = await levelAt(page, 6);
    await page.locator('#slot-ladder .ladder-detail [data-act=start]').click();
    s = await st(page);
    ok(near(s.t, before.start + 0.001, 2e-3), 'detail "Start" jumps to the start of the cycle', `${s.t} vs ${before.start}`);
    await page.locator('#slot-ladder .ladder-detail [data-act=after]').click();
    s = await st(page);
    ok(near(s.t, before.end + 0.001, 2e-3), 'detail "Just after" lands 1 ms into the next cycle', `${s.t} vs ${before.end}`);
    await page.locator('#slot-ladder .ladder-detail [data-act=before]').click();
    s = await st(page);
    const l2 = await levelAt(page, 6, before.end + 0.001);
    ok(s.playing && near(s.t, l2.end - 2, 0.1), 'detail "Just before" lands 2 s before the next end and plays', JSON.stringify(s));
    await page.evaluate(() => __fractonica.store.pause());

    // detail content
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(500);
    const det = await page.locator('#slot-ladder .ladder-detail').innerText();
    ok(/Thu 8 Oct 2026, 12:56:12/.test(det), 'detail shows the Gregorian end in the selected zone', det);
    ok(/22\.927824 → 22\.927856/.test(det), 'detail shows the Saros-position span');
    ok((await page.locator('#slot-ladder .ladder-qi.is-past').count()) === 3 && (await page.locator('#slot-ladder .ladder-qi.is-next').count()) === 1, 'three passed quarters muted, one next');

    // ---------------------------------------------------------------- percent through each cycle, depth wording
    const phases = await page.evaluate(() => Array.from({ length: 10 }, (_, L) => __fractonica.model.levelAt(__fractonica.store.t(), L).phase));
    const pctCells = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) => rows.map((r) => r.querySelector('.ladder-pct').textContent));
    ok(pctCells.every((p, i) => p === `${Math.min(99, Math.floor(phases[i] * 100 + 1e-7))}\u202f%`), 'every ladder row shows its floored percent through the cycle', JSON.stringify([pctCells, phases]));
    ok(pctCells[6] === '81\u202f%' && pctCells[0] === '73\u202f%', 'SPEC vector A: eta 81 %, alpha 73 %', pctCells.join(','));
    const geo = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) =>
      rows.map((r) => {
        const b = r.querySelector('.ladder-bar').getBoundingClientRect();
        const p = r.querySelector('.ladder-pct').getBoundingClientRect();
        const l = r.querySelector('.ladder-left').getBoundingClientRect();
        const rr = r.getBoundingClientRect();
        const t = r.querySelector('.ladder-pct');
        return { gap: Math.round(p.left - b.right), under: Math.round(Math.abs(p.right - l.right)), inside: p.right <= rr.right && p.left >= rr.left, fits: t.scrollWidth <= t.clientWidth + 1 };
      }),
    );
    ok(geo.every((g) => g.gap >= 4 && g.inside && g.fits && g.under <= 1), 'percent sits at the end of each bar, right-aligned under the time left, never overlapping it', JSON.stringify(geo[0]));
    const labels = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')));
    ok(/^η, depth 7: 1 of 11, 8\d percent through this cycle, ends Thu 8 Oct 2026, 12:56:12$/.test(labels[6]), 'row aria-label gives the percent "through this cycle"', labels[6]);
    ok(labels.every((l) => !/\blevel\b/i.test(l)), 'row labels say depth, never level');
    const chipLabels = await page.locator('#slot-ladder .ladder-chip').evaluateAll((cs) => cs.map((c) => c.getAttribute('aria-label')));
    ok(chipLabels[4] === 'ε, depth 5' && chipLabels[9] === 'κ, depth 10', 'ladder chips carry "depth N" in their aria-label', chipLabels.join(' | '));
    const upChips = await page.evaluate(() => ({
      hero: [document.querySelector('#slot-upnext .upnext-badge').getAttribute('aria-label'), document.querySelector('#slot-upnext .upnext-badge').title],
      strip: document.querySelector('#slot-upnext .upnext-strip .upnext-chip').getAttribute('aria-label'),
      rows: [...document.querySelectorAll('#slot-upnext .upnext-item .upnext-chip')].map((c) => c.getAttribute('aria-label')),
    }));
    ok(upChips.hero[0] === 'ζ, depth 6' && upChips.hero[1] === 'ζ, depth 6' && upChips.strip === 'η, depth 7' && upChips.rows.every((r) => /^[α-ξ], depth \d+$/.test(r)), 'Up next chips carry "depth N"', JSON.stringify(upChips));
    ok(!/level/i.test(await page.locator('#slot-ladder').evaluate((e) => e.innerText + [...e.querySelectorAll('[title],[aria-label]')].map((x) => x.title + ' ' + (x.getAttribute('aria-label') ?? '')).join(' '))), 'no "level" anywhere in the ladder card (text, titles, aria-labels)');
    ok(!/level/i.test(await page.locator('#slot-upnext').evaluate((e) => e.innerText + [...e.querySelectorAll('[title],[aria-label]')].map((x) => x.title + ' ' + (x.getAttribute('aria-label') ?? '')).join(' '))), 'no "level" anywhere in the Up next card');
    const btns = await page.evaluate(() => ({
      ladder: [...document.querySelectorAll('#slot-ladder .ladder-actions .btn')].map((b) => [b.innerText.trim(), b.title, b.getAttribute('aria-label')]),
      hero: [...document.querySelectorAll('#slot-upnext .upnext-hero .upnext-actions .btn')].map((b) => [b.innerText.trim(), b.title, b.getAttribute('aria-label')]),
      pre: document.querySelector('#slot-upnext .upnext-pre').getAttribute('aria-label') + ' | ' + document.querySelector('#slot-upnext .upnext-pre').title,
      hint: document.getElementById('ladder-hint').textContent,
      note: document.querySelector('#slot-upnext .upnext-note').textContent,
    }));
    ok(btns.ladder.map((b) => b[0]).join() === 'Start,Just before,Just after' && /^Just before: jump to 2 s before this η 7 cycle ends/.test(btns.ladder[1][1]) && btns.ladder[1][1] === btns.ladder[1][2] && /^Just after: jump to 1 ms into the next η 7 cycle/.test(btns.ladder[2][1]), 'ladder buttons: Start / Just before / Just after, each with an explaining title and aria-label', JSON.stringify(btns.ladder));
    ok(btns.hero.map((b) => b[0]).join() === 'Just before,Just after' && /^Just before: jump to 2 s before the ζ 6 turnover/.test(btns.hero[0][1]) && btns.hero[0][1] === btns.hero[0][2] && /^Just after: jump to 1 ms into the next ζ 6 cycle/.test(btns.hero[1][1]) && btns.hero[1][1] === btns.hero[1][2], 'Up next hero buttons are Just before / Just after and explain themselves', JSON.stringify(btns.hero));
    ok(/^Just before: jump to 2 s before the ζ, depth 6 turnover/.test(btns.pre) && /Just after/.test(btns.note) && /Just before/.test(btns.note) && /Just after/.test(btns.hint) && /Just before/.test(btns.hint), 'list arrows, hint and note use the same two names', btns.pre + ' / ' + btns.note);
    const detTxt = await page.locator('#slot-ladder .ladder-detail').innerText();
    ok(/THROUGH\s+81\.4\s% of this cycle/i.test(detTxt) && /SECTOR\s+8th of 9 θ 8 sectors\s·\s33\s%\sthrough\sit/i.test(detTxt), 'the open details carry the tooltip facts: percent through the cycle and the sector', detTxt.replace(/\n+/g, ' | '));

    // ---------------------------------------------------------------- Just before / Just after at every depth, including mu, nu, xi
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.evaluate(() => __fractonica.store.set({ maxDepth: 14 }));
    await page.waitForTimeout(400);
    const pctFast = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) => rows.slice(10).map((r) => r.querySelector('.ladder-pct').textContent));
    ok(/^\d+\u202f%$/.test(pctFast[0]) && /^\d+\u202f%$/.test(pctFast[1]) && pctFast[2] === '—' && pctFast[3] === '—', 'lambda and mu tick a percent; nu and xi (too fast to read) show a dash', pctFast.join(','));
    for (const L of [5, 8, 10, 11, 12, 13]) {
      await page.evaluate((L) => __fractonica.store.set({ selectedLevel: L }), L);
      await frames(page, 3);
      const r = await page.evaluate((L) => {
        // everything happens inside one task: the clock runs in real time after "Just before", and xi lasts 44 ms
        const { store, model } = __fractonica;
        store.pause();
        const cur = model.levelAt(store.t(), L);
        const cycle = cur.cycle;
        document.querySelector('#slot-ladder .ladder-detail [data-act=before]').click();
        const t = store.t();
        const at = model.levelAt(t, L);
        const res = { cycle: at.cycle - cycle, ahead: cur.end - t, quarter: cur.duration / 4, rate: store.rate, playing: store.playing };
        store.pause();
        store.setTime(cur.start + cur.duration / 2);
        const key = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
        document.querySelector('#slot-ladder .ladder-list').dispatchEvent(key);
        const t2 = store.t();
        res.kbCycle = model.levelAt(t2, L).cycle - cycle;
        res.kbAhead = cur.end - t2;
        store.pause();
        store.setTime(cur.start + cur.duration / 2);
        document.querySelector('#slot-ladder .ladder-detail [data-act=after]').click();
        res.afterCycle = model.levelAt(store.t(), L).cycle - cycle;
        res.afterBy = store.t() - cur.end;
        store.pause();
        return res;
      }, L);
      const want = Math.min(2, r.quarter);
      ok(r.cycle === 0 && r.kbCycle === 0 && near(r.ahead, want, 2e-3) && near(r.kbAhead, want, 2e-3) && r.rate === 1 && r.playing, `depth ${L + 1}: Just before (button and Shift+Enter) lands ${want.toFixed(3)} s ahead, inside the same cycle, and plays`, JSON.stringify(r));
      ok(r.afterCycle === 1 && near(r.afterBy, 0.001, 2e-4), `depth ${L + 1}: Just after lands 1 ms into the next cycle`, JSON.stringify(r));
    }
    await page.evaluate(() => __fractonica.store.set({ maxDepth: 10, selectedLevel: 6 }));
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(400);

    // ---------------------------------------------------------------- range control
    await page.selectOption('#slot-ladder .ladder-sel[data-k=min]', '3');
    await frames(page);
    ok((await st(page)).minDepth === 3 && (await page.locator('#slot-ladder [role=option]').count()) === 8, 'min depth 3 -> 8 rows');
    await page.selectOption('#slot-ladder .ladder-sel[data-k=max]', '2');
    await frames(page);
    s = await st(page);
    ok(s.maxDepth === 2 && s.minDepth === 2 && (await page.locator('#slot-ladder [role=option]').count()) === 1, 'max below min drags min along', JSON.stringify([s.minDepth, s.maxDepth]));
    await page.selectOption('#slot-ladder .ladder-sel[data-k=min]', '1');
    await page.selectOption('#slot-ladder .ladder-sel[data-k=max]', '10');
    await frames(page);
    ok((await page.locator('#slot-ladder [role=option]').count()) === 10, 'back to 1..10');
    await page.locator('#slot-ladder .ladder-more').click();
    await frames(page);
    ok((await st(page)).maxDepth === 14 && (await page.locator('#slot-ladder [role=option]').count()) === 14, 'disclosure extends to 14 levels');
    ok(/Fewer/.test(await page.locator('#slot-ladder .ladder-more').innerText()), 'disclosure now offers fewer levels');
    const fast = await page.locator('#slot-ladder .ladder-row').evaluateAll((rows) => rows.slice(12).map((r) => r.querySelector('.ladder-left').textContent));
    ok(fast.every((x) => /ms$/.test(x)), 'nu / xi rows show their length instead of a countdown', fast.join(','));
    await page.locator('#slot-ladder .ladder-more').click();
    await frames(page);
    ok((await st(page)).maxDepth === 10 && (await page.locator('#slot-ladder [role=option]').count()) === 10, 'fewer levels returns to 10');

    // ---------------------------------------------------------------- hover tooltip
    await page.locator('#ladder-opt-3').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const hb = await box(page, '#ladder-opt-3');
    await page.mouse.move(hb.x + 40, hb.y + hb.height / 2 - 6);
    await page.mouse.move(hb.x + 60, hb.y + hb.height / 2);
    await page.waitForTimeout(250);
    ok(await page.locator('.ladder-tip').isVisible(), 'hovering a row shows the tooltip');
    const tipText = await page.locator('.ladder-tip').innerText();
    ok(/Ends .*2026/.test(tipText) && /\d+\s% through this cycle/.test(tipText) && /one sector per .+ cycle: now in the \d+(st|nd|rd|th) of \d+, \d+\s% through that sector/.test(tipText), 'tooltip names the end date, the percent through the cycle and the sector', tipText);
    await page.mouse.move(700, 700);
    await page.waitForTimeout(100);
    ok(!(await page.locator('.ladder-tip').isVisible()), 'tooltip hides on leave');

    // tooltip: not over the open details, hidden when the rows move, survives the hovered row disappearing
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(400);
    const dBox = await box(page, '#ladder-opt-6 .ladder-detail');
    await page.mouse.move(dBox.x + 40, dBox.y + 10);
    await page.mouse.move(dBox.x + 60, dBox.y + 14);
    await page.waitForTimeout(250);
    ok(!(await page.locator('.ladder-tip').isVisible()), 'no row tooltip over the open details');
    const r7 = await box(page, '#ladder-opt-7');
    await page.mouse.move(r7.x + 60, r7.y + 10);
    await page.mouse.move(r7.x + 70, r7.y + 12);
    await page.waitForTimeout(250);
    ok(await page.locator('.ladder-tip').isVisible(), 'tooltip shows over a collapsed row');
    await page.mouse.click(r7.x + 70, r7.y + 12);
    await page.waitForTimeout(250);
    ok(!(await page.locator('.ladder-tip').isVisible()), 'tooltip is hidden once the click has moved the rows');
    const errBefore = errors.length;
    const r10 = await box(page, '#ladder-opt-9');
    await page.mouse.move(700, 300);
    await page.mouse.move(r10.x + 60, r10.y + 10);
    await page.mouse.move(r10.x + 70, r10.y + 12);
    await page.waitForTimeout(250);
    await page.evaluate(() => __fractonica.store.set({ maxDepth: 5 }));
    await page.waitForTimeout(500);
    ok(!(await page.locator('.ladder-tip').isVisible()) && errors.slice(errBefore).filter((e) => MINE.test(e)).length === 0, 'the hovered row disappearing (range shrinks) hides the tooltip without errors', errors.slice(errBefore).join('\n'));
    await page.evaluate(() => __fractonica.store.set({ maxDepth: 10 }));

    // narrowing the range keeps the shared selection inside it, so Enter never acts on a hidden level
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(400);
    await page.selectOption('#slot-ladder .ladder-sel[data-k=max]', '4');
    await frames(page);
    s = await st(page);
    ok(s.selectedLevel === 3 && (await page.locator('#slot-ladder .ladder-row.is-selected').count()) === 1 && (await page.locator('#slot-ladder .ladder-detail').count()) === 1, 'max 4 moves the selection to the last listed level', String(s.selectedLevel));
    await page.selectOption('#slot-ladder .ladder-sel[data-k=min]', '6');
    await frames(page);
    s = await st(page);
    ok(s.selectedLevel === 5 && s.minDepth === 6 && s.maxDepth === 6 && (await page.locator('#slot-ladder .ladder-row.is-selected').count()) === 1, 'min above max drags the range and the selection along', JSON.stringify([s.minDepth, s.maxDepth, s.selectedLevel]));
    await page.selectOption('#slot-ladder .ladder-sel[data-k=min]', '1');
    await page.selectOption('#slot-ladder .ladder-sel[data-k=max]', '10');
    // a selection hidden by a deep link: Enter selects a listed level first instead of jumping with an invisible one
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=14`));
    await page.waitForTimeout(400);
    const t14 = (await st(page)).t;
    await page.locator('#slot-ladder [role=listbox]').focus();
    await page.keyboard.press('Enter');
    s = await st(page);
    ok(near(s.t, t14, 1e-6) && s.selectedLevel === 9, 'Enter with a hidden selection brings it into the list instead of jumping', JSON.stringify([s.t - t14, s.selectedLevel]));

    // garbage in shared state must not collapse or break the cards
    await page.goto(url(`?t=${A}&zone=UTC&view=rings`));
    await page.evaluate(() => localStorage.setItem('fractonica-clock/v1', JSON.stringify({ minDepth: 'x', maxDepth: null, selectedLevel: 99 })));
    await page.reload();
    await page.waitForTimeout(500);
    ok((await page.locator('#slot-ladder [role=option]').count()) === 10, 'garbage depths fall back to 1..10 (not a single row)');
    ok(/^[α-ξ]\s*\d+\b/.test((await page.locator('#slot-upnext .upnext-strip').innerText()).trim()), 'an unusable selected level still gives a valid chip in the Up next strip', await page.locator('#slot-upnext .upnext-strip').innerText());
    await page.evaluate(() => localStorage.clear());

    // ---------------------------------------------------------------- precise labels and layout of the details
    await page.goto(url(`?t=-10684827340.114&zone=UTC&view=rings&sel=14`));
    await page.waitForTimeout(400);
    await page.locator('#slot-ladder .ladder-more').click();
    await frames(page);
    let detailTxt = await page.locator('#slot-ladder .ladder-detail').innerText();
    ok(/started\s+Sat 31 May 1631, 00:24:19\.876/i.test(detailTxt) && /\+11 ms/.test(detailTxt) && !/0\.0 s/.test(detailTxt), 'xi details show the exact millisecond and quarter offsets instead of 0.0 s', detailTxt.replace(/\n+/g, ' | '));
    ok((await page.locator('#slot-ladder .ladder-qi.is-next').count()) === 0, 'no flashing quarter highlight on a cycle of 44 ms');
    await page.hover('#ladder-opt-13', { position: { x: 60, y: 8 } });
    await page.mouse.move(60, 400);
    await page.hover('#ladder-opt-13', { position: { x: 80, y: 10 } });
    await page.waitForTimeout(250);
    const tipTxt = await page.locator('.ladder-tip').innerText();
    ok(/one sector per finer cycle/.test(tipTxt) && !/ο/.test(tipTxt), 'the finest level does not name a level that does not exist', tipTxt.replace(/\n+/g, ' | '));
    await page.mouse.move(700, 700);
    await page.evaluate(() => localStorage.clear()); // back to the default depth range 1..10
    await page.goto(url(`?t=946684800&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(450);
    const cells = await page.evaluate(() => [...document.querySelectorAll('#slot-ladder .ladder-q-time')].map((e) => [e.textContent, e.scrollWidth > e.clientWidth]));
    ok(cells.every(([, over]) => !over) && /^Jan 1 /.test(cells[1][0]), 'quarter times of a cycle that spans New Year fit their column', JSON.stringify(cells));
    // ladder rows and the hero read the same countdown in the last seconds
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=6`));
    await page.waitForTimeout(400);
    const zEnd = (await levelAt(page, 5)).end;
    for (const dt of [9.96, 3.96, 1.06, 0.96, 125.6]) {
      await page.evaluate((t) => __fractonica.store.setTime(t), zEnd - dt);
      await frames(page, 4);
      const hero = await page.locator('#slot-upnext .upnext-count-v').innerText();
      const row = await page.locator('#ladder-opt-5 .ladder-left').innerText();
      const floored = dt < 10 ? `${(Math.floor(dt * 10) / 10).toFixed(1)} s` : null; // 9.96 -> 9.9, not 10.0
      ok(hero === row && (floored === null || hero === floored), `hero and ladder row agree ${dt} s before a turnover${floored ? ` (${floored})` : ''}`, `${hero} vs ${row}`);
    }

    // ---------------------------------------------------------------- up next
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(500);
    let ev = await page.evaluate(() => __fractonica.instances.upnext.events);
    ok(ev.length === 8 && ev.every((e) => e.top <= 5), 'up next: 8 events, importance alpha-zeta by default');
    ok((await page.locator('#slot-upnext .upnext-item').count()) === 7, 'up next: hero + 7 list rows');
    const heroTxt = await page.locator('#slot-upnext .upnext-hero').innerText();
    ok(/Sat 10 Oct 2026, 15:27:41/.test(heroTxt) && /in 2 d 03 h 27 min/.test(heroTxt), 'hero shows countdown and Gregorian time', heroTxt.replace(/\n/g, ' | '));
    ok(/ζ 6 ends — 4 finer cycles \(η, θ, ι, κ\) end with it\./.test(heroTxt), 'hero sentence', heroTxt.replace(/\n/g, ' | '));
    ok(/in 56 min 12 s|next end in 56 min 12 s/.test(await page.locator('#slot-upnext .upnext-strip').innerText()), 'strip shows the next threshold of the selected level');

    // importance
    await page.locator('#slot-upnext .upnext-imp [data-id="γ"]').click();
    await page.waitForTimeout(150);
    ev = await page.evaluate(() => __fractonica.instances.upnext.events);
    ok(ev.every((e) => e.top <= 2) && ev[0].time > A + 86400 * 30, 'alpha-gamma: only coarse turnovers', JSON.stringify(ev.slice(0, 2)));
    ok((await page.evaluate(() => localStorage.getItem('fractonica-clock/upnext/importance'))) === 'γ', 'importance persisted in localStorage');
    await page.reload();
    await page.waitForTimeout(500);
    ok((await page.locator('#slot-upnext .upnext-imp [aria-pressed=true]').innerText()) === 'α–γ', 'importance restored after reload');
    await page.locator('#slot-upnext .upnext-imp [data-id="η"]').click();
    await page.waitForTimeout(150);
    ev = await page.evaluate(() => __fractonica.instances.upnext.events);
    ok(ev.some((e) => e.top === 6), 'alpha-eta includes eta turnovers');
    await page.locator('#slot-upnext .upnext-imp [data-id="ζ"]').click();

    // hero + rows navigation
    await page.goto(url(`?t=${A}&zone=UTC&view=rings`));
    await page.waitForTimeout(500);
    ev = await page.evaluate(() => __fractonica.instances.upnext.events);
    await page.locator('#slot-upnext .upnext-hero [data-act=after]').click();
    s = await st(page);
    ok(near(s.t, ev[0].time + 0.001, 2e-3), 'hero "Just after" -> 1 ms after the turnover', `${s.t} vs ${ev[0].time}`);
    await page.waitForTimeout(300);
    const ev2 = await page.evaluate(() => __fractonica.instances.upnext.events);
    ok(ev2[0].key === ev[1].key, 'after the jump the list advanced by one event');
    await page.locator('#slot-upnext .upnext-item .upnext-go').nth(2).click();
    s = await st(page);
    ok(near(s.t, ev2[3].time + 0.001, 2e-3), 'list row click -> just after that turnover', `${s.t} vs ${ev2[3].time}`);
    await page.waitForTimeout(300);
    const evB = await page.evaluate(() => __fractonica.instances.upnext.events);
    await page.locator('#slot-upnext .upnext-item .upnext-pre').nth(1).click();
    s = await st(page);
    ok(near(s.t, evB[2].time - 2, 0.1) && s.playing, 'row "just before" -> 2 s before, running', JSON.stringify(s));
    await page.evaluate(() => __fractonica.store.pause());
    await page.locator('#slot-upnext .upnext-hero [data-act=before]').click();
    await page.evaluate(() => __fractonica.store.pause());

    // strip
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(500);
    const nxt = await page.evaluate(() => __fractonica.model.levelAt(__fractonica.store.t(), 6).next.time);
    await page.locator('#slot-upnext .upnext-strip').click();
    s = await st(page);
    ok(near(s.t, nxt + 0.001, 2e-3), 'strip click -> just after the next threshold of the selected level', `${s.t} vs ${nxt}`);

    // zone change relabels
    await page.selectOption('#zone', 'Asia/Tokyo');
    await page.waitForTimeout(250);
    const tokyo = await page.locator('#slot-upnext .upnext-hero').innerText();
    ok(/UTC\+09:00/.test(tokyo), 'hero follows the zone selector', tokyo.replace(/\n/g, ' | '));
    const tokyoLadder = await page.locator('#slot-ladder .ladder-detail').innerText();
    ok(/UTC\+09:00/.test(tokyoLadder), 'ladder detail follows the zone selector');

    // ---------------------------------------------------------------- time-lapse
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&rate=3600`));
    await page.waitForTimeout(400);
    const k0 = (await page.evaluate(() => __fractonica.instances.upnext.events))[0].key;
    const c0 = await page.locator('#slot-upnext .upnext-count-v').innerText();
    await page.waitForTimeout(1400);
    const c1 = await page.locator('#slot-upnext .upnext-count-v').innerText();
    ok(c0 !== c1, 'hero countdown ticks in time-lapse', `${c0} -> ${c1}`);
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&rate=86400`));
    await page.waitForTimeout(3000);
    const k1 = (await page.evaluate(() => __fractonica.instances.upnext.events))[0].key;
    ok(k0 !== k1, 'events pass in time-lapse and the list moves on');
    const keys = await page.evaluate(() => __fractonica.instances.upnext.events.map((e) => e.key));
    const domKeys = await page.locator('#slot-upnext .upnext-item .upnext-go').count();
    ok(keys.length === 8 && domKeys === 7, 'list is full after passes', `${keys.length} / ${domKeys}`);
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&rate=-86400`));
    await page.waitForTimeout(2500);
    const back = await page.evaluate(() => ({ t: __fractonica.store.t(), e: __fractonica.instances.upnext.events }));
    ok(back.e[0].time > back.t && back.e.every((e) => e.time > back.t), 'running backwards keeps only future events', JSON.stringify([back.t, back.e[0].time]));
    const fastDom = await page.evaluate(() => document.querySelectorAll('#slot-upnext .upnext-item').length);
    ok(fastDom === 7, 'backwards list still 7 rows');

    // very fast time-lapse (1 year per second)
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&rate=31557600`));
    await page.waitForTimeout(2500);
    ok((await page.locator('#slot-upnext .upnext-item').count()) === 7, 'list holds up at 1 y/s');

    // the card must describe turnovers that are still ahead of the displayed time in every frame, at every speed
    for (const rate of [31557600, 2629800, 604800, -31557600, -2629800]) {
      await page.goto(url(`?t=${A}&zone=UTC&view=rings&rate=${rate}`));
      await page.waitForTimeout(700);
      const r = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const inst = __fractonica.instances.upnext;
            const orig = inst.render;
            const res = { n: 0, past: 0, zeroHero: 0, zeroRows: 0, rows: 0 };
            inst.render = (f, i) => {
              orig(f, i);
              res.n++;
              const ev = inst.events;
              if (!ev.length || !(ev[0].time > f.t) || ev.some((e) => !(e.time > f.t))) res.past++;
              if (document.querySelector('.upnext-count-v').textContent === '0.0 s') res.zeroHero++;
              const rowTxt = [...document.querySelectorAll('.upnext-in-s')].map((e) => e.textContent);
              res.rows = Math.max(res.rows, rowTxt.length);
              if (rowTxt.length && rowTxt.every((x) => x === '0.0 s')) res.zeroRows++;
              if (res.n >= 150) {
                inst.render = orig;
                resolve(res);
              }
            };
          }),
      );
      ok(r.past === 0 && r.zeroHero === 0 && r.zeroRows === 0 && r.rows === 7, `up next lists only future turnovers at x${rate}`, JSON.stringify(r));
    }
    // the buttons use the turnover that is next when they are pressed
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&rate=31557600`));
    await page.waitForTimeout(900);
    const jumped = await page.evaluate(() => {
      const t0 = __fractonica.store.t();
      document.querySelector('#slot-upnext .upnext-hero [data-act=after]').click();
      return { t0, t1: __fractonica.store.t() };
    });
    ok(jumped.t1 > jumped.t0 && jumped.t1 - jumped.t0 < 86400 * 4, 'hero "Just after" at 1 y/s moves forward to the next turnover, not back', JSON.stringify(jumped));

    // "Just before" must leave real time running whatever the speed was
    for (const rate of [3600, -3600]) {
      await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7&rate=${rate}`));
      await page.waitForTimeout(400);
      await page.locator('#slot-upnext .upnext-hero [data-act=before]').click();
      ok((await st(page)).rate === 1, `up next "Just before" switches x${rate} to real time`);
      await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7&rate=${rate}`));
      await page.waitForTimeout(400);
      await page.locator('#slot-ladder .ladder-detail [data-act=before]').click();
      ok((await st(page)).rate === 1, `ladder "Just before" switches x${rate} to real time`);
      await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7&rate=${rate}`));
      await page.waitForTimeout(400);
      await page.locator('#slot-ladder [role=listbox]').focus();
      await page.keyboard.press('Shift+Enter');
      ok((await st(page)).rate === 1, `ladder Shift+Enter switches x${rate} to real time`);
    }
    await page.evaluate(() => __fractonica.store.pause());

    // keyboard focus stays in the list after a row has been used (it passes and is removed)
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(500);
    await page.locator('#slot-upnext .upnext-item .upnext-go').nth(2).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    ok(await page.evaluate(() => document.activeElement?.matches('#slot-upnext .upnext-item .upnext-go')), 'focus stays on an Up next row after keyboard activation');
    await page.locator('#slot-upnext .upnext-item .upnext-pre').nth(1).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    ok(await page.evaluate(() => document.activeElement?.matches('#slot-upnext .upnext-item .upnext-pre')), 'focus stays on the "just before" arrow after keyboard activation');
    await page.evaluate(() => __fractonica.store.pause());

    // a paused clock costs nothing (the card skips the frame)
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(500);
    const idle = await page.evaluate(() => {
      const inst = __fractonica.instances.upnext;
      const f = __fractonica.model.frame(__fractonica.store.t());
      const a = performance.now();
      for (let i = 0; i < 2000; i++) inst.render(f, { dirty: false, dt: 0.016 });
      return (performance.now() - a) / 2000;
    });
    ok(idle < 0.005, 'paused: up next render() of an unchanged frame is skipped', `${idle.toFixed(4)} ms`);

    // ---------------------------------------------------------------- reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url(`?t=${A}&zone=UTC&view=rings`));
    await page.waitForTimeout(400);
    const heroEv = await page.evaluate(() => __fractonica.instances.upnext.events[0].time);
    await page.evaluate((t) => __fractonica.store.setTime(t - 0.5), heroEv);
    await page.evaluate(() => __fractonica.store.setRate(1));
    await page.waitForTimeout(900);
    const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('#slot-upnext,#slot-ladder')).length);
    ok(anims === 0, 'no animations under prefers-reduced-motion', String(anims));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // positive control: with motion allowed the same pass does animate (hero glow + list shift)
    await page.goto(url(`?t=${A}&zone=UTC&view=rings`));
    await page.waitForTimeout(400);
    const heroEv2 = await page.evaluate(() => __fractonica.instances.upnext.events[0].time);
    await page.evaluate((t) => __fractonica.store.setTime(t - 0.4), heroEv2);
    await page.evaluate(() => __fractonica.store.setRate(1));
    let sawAnim = false;
    for (let i = 0; i < 20 && !sawAnim; i++) {
      await page.waitForTimeout(60);
      sawAnim = (await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('#slot-upnext')).length)) > 0;
    }
    ok(sawAnim, 'a passing turnover animates the list when motion is allowed');

    // ---------------------------------------------------------------- layout: no horizontal overflow
    for (const w of [360, 390, 600, 860, 1100, 1320, 1440, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url(`?t=${A}&zone=UTC&view=rings`));
      await page.waitForTimeout(350);
      const o = await page.evaluate(() => {
        const bad = [];
        for (const id of ['slot-ladder', 'slot-upnext']) {
          const card = document.getElementById(id);
          const r = card.getBoundingClientRect();
          for (const e of card.querySelectorAll('*')) {
            const b = e.getBoundingClientRect();
            if (b.width && (b.right > r.right + 1 || b.left < r.left - 1) && getComputedStyle(e).position !== 'fixed') bad.push(id + ' ' + e.className.toString().slice(0, 40) + ' ' + Math.round(b.right - r.right));
          }
        }
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad: bad.slice(0, 5) };
      });
      ok(o.bad.length === 0, `cards do not overflow at ${w}px (page scrollWidth ${o.sw})`, JSON.stringify(o));
    }

    // ---------------------------------------------------------------- render cost
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&rate=1`));
    await page.waitForTimeout(500);
    for (const [label, q] of [['real time', null], ['time-lapse 1 h/s', 3600], ['time-lapse 1 y/s', 31557600]]) {
      if (q) await page.evaluate((q) => __fractonica.store.setRate(q), q);
      const cost = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const res = {};
            for (const id of ['ladder', 'upnext']) {
              const inst = __fractonica.instances[id];
              const orig = inst.render;
              res[id] = [];
              inst.render = (f, i) => {
                const a = performance.now();
                orig(f, i);
                res[id].push(performance.now() - a);
              };
              inst.__orig = orig;
            }
            setTimeout(() => {
              for (const id of ['ladder', 'upnext']) __fractonica.instances[id].render = __fractonica.instances[id].__orig;
              const stat = (a) => ({ n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), max: +Math.max(...a).toFixed(3), p95: +[...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(3) });
              resolve({ ladder: stat(res.ladder), upnext: stat(res.upnext) });
            }, 2200);
          }),
      );
      console.log(`     render cost ${label}:`, JSON.stringify(cost));
      ok(cost.ladder.mean < 1.5 && cost.upnext.mean < 1.5 && cost.ladder.n > 60, `render() well under budget (${label})`);
    }

    // microbenchmark: 300 synthetic frames per call so timer granularity does not hide the cost
    const bench = await page.evaluate(() => {
      const out = {};
      const { model, instances, store } = __fractonica;
      for (const id of ['ladder', 'upnext']) {
        const inst = instances[id];
        const t0 = store.t();
        const a = performance.now();
        for (let i = 0; i < 300; i++) inst.render(model.frame(t0 + i * 0.0167), { dirty: true, dt: 0.0167 });
        out[id] = +((performance.now() - a) / 300).toFixed(3);
      }
      return out;
    });
    console.log('     synthetic render() mean ms incl. model.frame():', JSON.stringify(bench));
    ok(bench.ladder < 1.5 && bench.upnext < 1.5, 'render() under ~1.5 ms each (budget 3 ms)');

    const mine = errors.filter((e) => MINE.test(e));
    ok(mine.length === 0, 'no console errors from ladder / upnext files', mine.join('\n'));
  },
  { viewport: { width: 1440, height: 900 } },
);

// -------------------------------------------------------------------- touch device (390 x 844) + DOM write discipline
await withApp(
  async ({ browser, url, errors }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url(`?t=${A}&zone=UTC&view=rings&sel=7`));
    await page.waitForTimeout(700);
    await page.locator('#ladder-opt-3').tap();
    ok((await st(page)).selectedLevel === 3, 'tap selects a row');
    ok((await page.locator('#ladder-opt-3 .ladder-detail').count()) === 1, 'tap expands the details');
    ok(!(await page.locator('.ladder-tip').isVisible()), 'no hover tooltip on touch');
    const touchDet = await page.locator('#ladder-opt-3 .ladder-detail').innerText();
    ok(/THROUGH\s+\d+\.\d\s% of this cycle/i.test(touchDet) && /SECTOR\s+\d+(st|nd|rd|th) of 5 ε 5 sectors\s·\s\d+\s%\sthrough\sit/i.test(touchDet) && /ENDS/i.test(touchDet), 'on touch the tapped row opens details with the percent, the sector and the end (the tooltip facts)', touchDet.replace(/\n+/g, ' | '));
    ok(/^\d+\u202f%$/.test(await page.locator('#ladder-opt-3 .ladder-pct').innerText()), 'the percent is visible on a touch layout without any hover');
    const l3 = await levelAt(page, 3);
    await page.locator('#ladder-opt-3 [data-act=after]').tap();
    let s = await st(page);
    ok(near(s.t, l3.end + 0.001, 2e-3), 'tap on "Just after" jumps', `${s.t} vs ${l3.end}`);
    await page.waitForTimeout(300);
    const heroBefore = await page.evaluate(() => __fractonica.instances.upnext.events[0].time);
    await page.locator('#slot-upnext .upnext-hero [data-act=after]').tap();
    s = await st(page);
    ok(near(s.t, heroBefore + 0.001, 2e-3), 'tap on hero "Just after"');
    await page.waitForTimeout(300);
    const rowH = await page.locator('#slot-upnext .upnext-go').first().evaluate((e) => e.getBoundingClientRect().height);
    const preW = await page.locator('#slot-upnext .upnext-pre').first().evaluate((e) => e.getBoundingClientRect().width);
    ok(rowH >= 40 && preW >= 40, 'touch targets are at least 40 px', `${rowH} x ${preW}`);
    const small = await page.evaluate(() => {
      const bad = [];
      for (const sel of ['#slot-upnext .upnext-imp button', '#slot-upnext .upnext-actions .btn', '#slot-upnext .upnext-strip', '#slot-upnext .upnext-go', '#slot-upnext .upnext-pre', '#slot-ladder .ladder-sel', '#slot-ladder .ladder-more', '#slot-ladder .ladder-actions .btn']) {
        for (const e of document.querySelectorAll(sel)) {
          const r = e.getBoundingClientRect();
          if (r.width && (r.height < 39.5 || r.width < 39.5)) bad.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return { bad: [...new Set(bad)], overflow: document.documentElement.scrollWidth - innerWidth, head: document.querySelector('#slot-upnext .card-h').scrollWidth - document.querySelector('#slot-upnext .card-h').clientWidth };
    });
    ok(small.bad.length === 0 && small.overflow === 0 && small.head === 0, 'every control in both cards is at least 40 x 40 px on touch (and still fits 390 px)', JSON.stringify(small));
    ok(errs.filter((e) => MINE.test(e)).length === 0, 'no errors on touch device', errs.join('\n'));

    // frozen time: the cards must not touch the DOM at all
    await page.goto(url(`?t=${A}&zone=UTC&view=rings`));
    await page.waitForTimeout(700);
    const frozen = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const mo = new MutationObserver((l) => (n += l.length));
          for (const id of ['slot-ladder', 'slot-upnext']) mo.observe(document.getElementById(id), { subtree: true, childList: true, attributes: true, characterData: true });
          setTimeout(() => resolve(n), 1500);
        }),
    );
    ok(frozen === 0, 'paused time: zero DOM mutations in either card', String(frozen));
    // real time: only the text that changes is written
    await page.evaluate(() => __fractonica.store.setRate(1));
    const running = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const mo = new MutationObserver((l) => (n += l.length));
          for (const id of ['slot-ladder', 'slot-upnext']) mo.observe(document.getElementById(id), { subtree: true, childList: true, attributes: true, characterData: true });
          setTimeout(() => resolve(n), 3000);
        }),
    );
    console.log('     mutations in 3 s at real time:', running);
    ok(running < 450, 'real time: DOM writes stay modest', String(running));
    await ctx.close();
  },
  { viewport: { width: 1440, height: 900 } },
);

// -------------------------------------------------------------------- out of range (device clock outside the catalogue)
await withApp(
  async ({ page, url, errors }) => {
    await page.clock.install({ time: new Date('2900-03-01T00:00:00Z') });
    await page.goto(url('?zone=UTC&view=rings'));
    await page.waitForTimeout(600);
    ok(await page.locator('#slot-ladder .ladder-note').isVisible(), 'ladder shows the out-of-range message');
    ok((await page.locator('#slot-ladder .ladder-row.is-off').count()) === 10, 'rows are disabled out of range');
    ok(!(await page.locator('#slot-upnext .upnext-hero').isVisible()) && /Outside the Saros 141 catalogue/.test(await page.locator('#slot-upnext .upnext-empty').innerText()), 'up next explains the out-of-range state');
    await page.locator('#slot-ladder .ladder-edge').click();
    await page.waitForTimeout(400);
    ok((await page.evaluate(() => __fractonica.model.inRange(__fractonica.store.t()))) && !(await page.locator('#slot-ladder .ladder-note').isVisible()), 'edge button brings the clock back into the catalogue');
    ok(/Saros 141|1 \/ |cycle/.test(await page.locator('#slot-ladder').innerText()), 'ladder resumes after leaving the out-of-range state');
    const mine = errors.filter((e) => MINE.test(e));
    ok(mine.length === 0, 'no console errors from ladder / upnext files (out-of-range session)', mine.join('\n'));
  },
  { viewport: { width: 1440, height: 900 } },
);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
